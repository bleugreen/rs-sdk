// What run.ts does after a dropped session (runResumable's `recover`), rs/511.
//
// A drop where the page itself fell out of the world (the client's own pageInGame false) while the
// world is up is not the watchdog's case: its verdict reads only the tick and the gateway, and its
// fallback is a client relaunch. Here the page logs itself back in where it stands (session.ts
// login, in page, the token URL as its fallback), the path every planned relog takes, against the
// run's relog budget (runner/relog-budget.ts).
//
// The race rule (adopt, never fight): the relog lock decides who logs SCORED in.
// - The operator holds it (tools/relog-now.ts): run.ts never starts its own; it waits for the lock
//   to go, then finds the page in the world and adopts that session. relog-now recorded it.
// - The page is back in the world when run.ts looks (a relog by hand that finished first): adopted
//   and recorded as a manual relog, the same budget.
// - Otherwise run.ts takes the lock, reads the page once more under it, checks the budget, logs in,
//   records the relog with the step and tick of the drop, and lets the lock go. relog-now refuses
//   while run.ts holds it.
// Past the budget the recover throws RelogBudgetSpent and the run stops with that reason.
//
// Anything else goes to the default path unchanged (link.restored: the watchdog's relaunch or its
// outage reconnect): a lite client, a tab with no DevTools, a world that is down.
//
// While the page is out nothing publishes ticks, so the waits here are ticks of wall time
// (n x tickMs(), lib/wait.ts's idle convention).

import { demoOrigin, samplePlayerCount } from '../lib/demo-status';
import { adoptSession, cdpUrl, login, pageWorld, type Session } from '../lib/session';
import { pageInGame } from '../lib/tab';
import { sleep, tickMs } from '../lib/wait';
import { RelogBudgetSpent, type RelogBudget, type RelogEntry } from './relog-budget';
import type { Link } from './resume';

/** Ticks run.ts waits for an operator's relog to let the lock go (relog-now's login is bounded at 90 s = 225 ticks at 400 ms). */
export const ADOPT_WAIT_TICKS = 300;
/**
 * Ticks a page that still says it is in game, with no tick advancing, is given to settle: a page whose
 * socket died notices it only some seconds later (about 7 s, 17 ticks at 400 ms, on the lab), then
 * either reconnects itself (adopted) or falls to the title screen (relogged here).
 */
export const SETTLE_TICKS = 40;

export interface DropRelogDeps {
    /** The page's own in-game flag; null when there is no tab or no DevTools to ask. */
    pageInGame(): Promise<boolean | null>;
    /** Whether the world answers (its /playercount). */
    worldUp(): Promise<boolean>;
    /** session.ts login in page, the token URL as fallback; resolves once in the world with an advancing tick. */
    login(): Promise<{ via: 'page' | 'launch'; wallMs?: number }>;
    /** session.ts adoptSession, then the wait for the adopted session's advancing tick. */
    adopt(tickBase: number | undefined): Promise<void>;
    /** The default path: wait for the session to come back by other means (the watchdog's). */
    restored(): Promise<void>;
    /** Wait `n` ticks of wall time. */
    waitTicks(n: number): Promise<void>;
    /** Whether an in-world tick advanced since the recovery began. */
    advanced(): boolean;
    pauseWatchdog(): void;
    resumeWatchdog(): void;
    now(): number;
    log?(line: string): void;
}

export type DropOutcome = 'relogged' | 'adopted' | 'default' | 'planned-out';

export interface DropRelogResult {
    outcome: DropOutcome;
    entry?: RelogEntry;
    why: string;
}

type Budget = Pick<RelogBudget, 'check' | 'record' | 'tryLock' | 'holder' | 'entries' | 'describe' | 'openPlanned'>;

/** One recovery after a drop at `at` (see the file comment). */
export async function recoverDrop(budget: Budget, deps: DropRelogDeps, reason: string, at: { step: string | null; tick: number }): Promise<DropRelogResult> {
    const since = new Date(deps.now()).toISOString();
    // From here no tick the session had before the drop counts as advancing.
    deps.pauseWatchdog();
    // Between the halves of a split planned relog (S21) the account is out on purpose: its login half
    // logs it in, so nothing here relogs or counts; the walk goes on to that half.
    const planned = budget.openPlanned();
    if (planned) {
        deps.log?.(`[relog] out between the halves of the planned ${planned.step}: not a drop, no relog`);
        return { outcome: 'planned-out', why: `the planned ${planned.step} is open` };
    }
    const page = await deps.pageInGame();
    if (page === null) {
        deps.resumeWatchdog();
        await deps.restored();
        return { outcome: 'default', why: 'no page to ask (no tab or no DevTools): the watchdog path' };
    }
    if (page === false && !(await deps.worldUp())) {
        deps.resumeWatchdog();
        await deps.restored();
        return { outcome: 'default', why: 'the world is down: the watchdog outage path' };
    }

    const adopt = async (how: string): Promise<DropRelogResult> => {
        const theirs = budget.entries().find(e => e.by === 'operator' && e.at >= since);
        let entry = theirs;
        if (!entry) {
            const room = budget.check('manual');
            if (room !== true) throw new RelogBudgetSpent(`${room}; the page was found back in the world after the drop at ${at.step ?? '?'} tick ${at.tick}`);
            entry = budget.record({ kind: 'manual', by: 'run', step: at.step, tick: at.tick, via: 'adopted', meta: { reason, how } });
        }
        const tb = entry.meta?.tickBase;
        await deps.adopt(typeof tb === 'number' ? tb : undefined);
        deps.log?.(`[relog] adopted (${how}) after the drop at ${at.step ?? '?'} tick ${at.tick}; ${budget.describe()}`);
        return { outcome: 'adopted', entry, why: how };
    };

    if (page === true) {
        // In game by its own word: ticking again (it reconnected itself), or not yet aware its socket died.
        for (let t = 0; t < SETTLE_TICKS; t++) {
            if (deps.advanced()) return adopt('the page was back in the world, ticking');
            const p = await deps.pageInGame();
            if (p === false) break;
            if (p === null) {
                deps.resumeWatchdog();
                await deps.restored();
                return { outcome: 'default', why: 'the page went away while it settled: the watchdog path' };
            }
            await deps.waitTicks(1);
        }
        if ((await deps.pageInGame()) !== false) {
            if (deps.advanced()) return adopt('the page was back in the world, ticking');
            deps.resumeWatchdog();
            await deps.restored();
            return { outcome: 'default', why: `the page says in game but has not ticked for ${SETTLE_TICKS} ticks: the watchdog path` };
        }
        deps.log?.(`[relog] the page fell out of the world after the drop at ${at.step ?? '?'} tick ${at.tick}`);
    }
    let waited = 0;
    for (;;) {
        const h = budget.holder();
        if (h) {
            if (waited === 0) deps.log?.(`[relog] the ${h.by}'s relog (pid ${h.pid}) holds the lock since ${h.at}: waiting, never relogging over it`);
            if (waited >= ADOPT_WAIT_TICKS) throw new Error(`the ${h.by}'s relog (pid ${h.pid}) has held the relog lock for ${waited} ticks since the drop at ${at.step ?? '?'} tick ${at.tick}`);
            await deps.waitTicks(1);
            waited++;
            continue;
        }
        if (waited > 0 && (await deps.pageInGame()) === true) return adopt('the operator relogged while run.ts waited');
        const lock = budget.tryLock('run');
        if (!lock.ok) continue;
        try {
            if ((await deps.pageInGame()) === true) return await adopt('the page was back in the world when run.ts took the lock');
            const room = budget.check('unplanned');
            if (room !== true) throw new RelogBudgetSpent(`${room}; the drop at ${at.step ?? '?'} tick ${at.tick} (${reason})`);
            const r = await deps.login();
            const entry = budget.record({ kind: 'unplanned', by: 'run', step: at.step, tick: at.tick, via: r.via, meta: { reason, ...(r.wallMs !== undefined ? { loginWallMs: r.wallMs } : {}) } });
            deps.log?.(`[relog] in-page relog after the drop at ${at.step ?? '?'} tick ${at.tick} (${reason}): in via ${r.via}; ${budget.describe()}`);
            return { outcome: 'relogged', entry, why: reason };
        } finally {
            lock.release();
        }
    }
}

/** The live deps on a run.ts session: the page over its DevTools, session.ts login and adoptSession, the link's restore. */
export function liveDropDeps(session: Session, link: Link, log: (line: string) => void = console.log): DropRelogDeps {
    const cdp = session.client === 'browser' ? cdpUrl(session.env) : undefined;
    let since = Date.now();
    return {
        advanced: () => session.lastAdvanceAt > since,
        pageInGame: async () => (cdp ? await pageInGame(cdp, session.name).catch(() => null) : null),
        worldUp: async () => (await samplePlayerCount(demoOrigin(pageWorld(session.env)))).players !== null,
        login: async () => {
            const r = await login(session, { inPage: true });
            return { via: r.via, wallMs: r.wallMs };
        },
        adopt: async tickBase => {
            adoptSession(session, tickBase);
            await link.restored(ADOPT_WAIT_TICKS * tickMs());
        },
        restored: () => link.restored(30 * 60_000),
        waitTicks: n => sleep(n * tickMs()),
        pauseWatchdog: () => {
            since = Date.now();
            session.watchdog?.pause();
        },
        resumeWatchdog: () => session.watchdog?.resume(),
        now: () => Date.now(),
        log,
    };
}

/** runResumable's `recover` for run.ts: recoverDrop on the live session. */
export function dropRecover(session: Session, budget: RelogBudget, link: Link, log: (line: string) => void = console.log): (reason: string, at: { step: string | null; tick: number }) => Promise<void> {
    const deps = liveDropDeps(session, link, log);
    return async (reason, at) => {
        await recoverDrop(budget, deps, reason, at);
    };
}
