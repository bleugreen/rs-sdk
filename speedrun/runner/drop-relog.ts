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
// - The page is back in the world when run.ts looks (a relog by hand that finished first, or the
//   page's own reconnect): adopted and recorded as a manual relog, the same budget.
// - Otherwise run.ts takes the lock, reads the page once more under it, checks the budget, logs in,
//   records the relog with the step and tick of the drop, and lets the lock go. relog-now refuses
//   while run.ts holds it.
// Past the budget the recover throws RelogBudgetSpent and the run stops with that reason.
//
// Every wait here keeps asking the page (rs/659). Waiting on the session alone deadlocked attempt 3:
// an adopted page was logged out a tick later, the adopt wait watched only for ticks, and the
// watchdog stood down because "the drop recovery relogs it". So while the recovery waits (on an
// adopted session, on the watchdog's path, on a world or gateway that is down), a page that reads
// out of the world with the account meant to be in, the world up and our gateway up is relogged
// here, under the same lock and budget; an adopt that fell out is relogged on the adopt's own budget
// entry, so one drop never costs two. With the world or our gateway down the page is left out until
// both are back: a login cannot land, or cannot be seen landing, before then.
//
// With no page to ask (a lite client, a tab with no DevTools) the default path is unchanged:
// link.restored, the watchdog's relaunch or its outage reconnect.
//
// While the page is out nothing publishes ticks, so the waits here are ticks of wall time
// (n x tickMs(), lib/wait.ts's idle convention).

import { demoOrigin, samplePlayerCount } from '../lib/demo-status';
import { adoptSession, cdpUrl, gatewayStatus, login, pageWorld, sdkConnected, type Session } from '../lib/session';
import { pageInGame } from '../lib/tab';
import { sleep, tickMs } from '../lib/wait';
import { RelogBudgetSpent, type RelogBudget, type RelogEntry } from './relog-budget';
import { pageHoldTicks } from './page-hold';
import type { Link } from './resume';

/** Ticks run.ts waits for an operator's relog to let the lock go, and for an adopted session to tick (relog-now's login is bounded at 90 s = 225 ticks at 400 ms). */
export const ADOPT_WAIT_TICKS = 300;
/** Ticks between the page reads while the recovery waits for the session to come back. */
export const RECHECK_TICKS = 3;
/** Ticks the recovery waits for a session to come back by other means (the watchdog's path, a world or gateway outage): 30 min at 400 ms. */
export const RESTORE_WAIT_TICKS = 4_500;
/** Times one recovery relogs a session that fell out of the world again while it waited, before it gives up. */
export const MAX_FALLS = 2;

export interface DropRelogDeps {
    /** The page's own in-game flag; null when there is no tab or no DevTools to ask. */
    pageInGame(): Promise<boolean | null>;
    /** Whether the world answers (its /playercount). */
    worldUp(): Promise<boolean>;
    /** Whether our own gateway answers (the SDK's socket to it up, its status read): a login cannot be seen landing without it. */
    gatewayUp(): Promise<boolean>;
    /** session.expectInWorld: false while someone's logout runs (the watchdog's), whose out page is not a drop. */
    expectInWorld(): boolean;
    /** session.ts login in page, the token URL as fallback; resolves once in the world with an advancing tick. */
    login(): Promise<{ via: 'page' | 'launch'; wallMs?: number }>;
    /** session.ts adoptSession: begin the session the page is in (a new session id, expectInWorld on, the watchdog resumed). */
    adopt(tickBase: number | undefined): void;
    /** The link's restored: resolves once the session is back in the world with an advancing tick; rejects when `signal` aborts or at its own backstop. */
    restored(signal: AbortSignal): Promise<void>;
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

type Budget = Pick<RelogBudget, 'check' | 'record' | 'amend' | 'tryLock' | 'holder' | 'entries' | 'describe' | 'openPlanned'>;

/** One recovery after a drop at `at` (see the file comment). */
export async function recoverDrop(budget: Budget, deps: DropRelogDeps, reason: string, at: { step: string | null; tick: number }): Promise<DropRelogResult> {
    const since = new Date(deps.now()).toISOString();
    const where = `the drop at ${at.step ?? '?'} tick ${at.tick}`;
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
        await deps.restored(new AbortController().signal);
        return { outcome: 'default', why: 'no page to ask (no tab or no DevTools): the watchdog path' };
    }

    let falls = 0;

    /**
     * Wait up to `maxTicks` for the session to come back: 'back' once it is, 'out' as soon as the page
     * reads out of the world with the account meant to be in and the world and our gateway both up.
     */
    const untilBack = async (maxTicks: number, what: string): Promise<'back' | 'out'> => {
        const stop = new AbortController();
        const back = deps.restored(stop.signal).then(() => 'back' as const);
        back.catch(() => {});
        let blockedBy = '';
        try {
            for (let t = 0; t < maxTicks; t += RECHECK_TICKS) {
                const r = await Promise.race([back, deps.waitTicks(RECHECK_TICKS).then(() => 'tick' as const)]);
                if (r === 'back') return 'back';
                if (!deps.expectInWorld() || (await deps.pageInGame()) !== false) continue;
                const blocked = !(await deps.worldUp()) ? 'the world' : !(await deps.gatewayUp()) ? 'our gateway' : '';
                if (!blocked) return 'out';
                if (blocked !== blockedBy) deps.log?.(`[relog] the page is out of the world after ${where}; waiting for ${blocked} before relogging it`);
                blockedBy = blocked;
            }
            throw new Error(`not back in the world within ${maxTicks} ticks of ${what} after ${where}`);
        } finally {
            stop.abort();
        }
    };

    /** The session fell out of the world while the recovery waited: relog it (bounded by MAX_FALLS), on `charged` when it is run.ts's own entry. */
    const fellOut = (what: string, charged: RelogEntry | null): Promise<DropRelogResult> => {
        falls++;
        if (falls > MAX_FALLS) throw new Error(`the session fell out of the world ${falls} times while run.ts recovered from ${where}`);
        deps.log?.(`[relog] the page fell out of the world during ${what} after ${where}: relogging it in page`);
        deps.pauseWatchdog();
        return relogInPage(charged);
    };

    const adopt = async (how: string, charged: RelogEntry | null): Promise<DropRelogResult> => {
        let entry = charged ?? budget.entries().find(e => e.by === 'operator' && e.at >= since) ?? null;
        if (!entry) {
            const room = budget.check('manual');
            if (room !== true) throw new RelogBudgetSpent(`${room}; the page was found back in the world after ${where}`);
            entry = budget.record({ kind: 'manual', by: 'run', step: at.step, tick: at.tick, via: 'adopted', meta: { reason, how } });
        }
        const tb = entry.meta?.tickBase;
        deps.adopt(typeof tb === 'number' ? tb : undefined);
        if ((await untilBack(ADOPT_WAIT_TICKS, 'the adopt')) === 'out') return fellOut(`the adopt (${how})`, entry);
        deps.log?.(`[relog] adopted (${how}) after ${where}; ${budget.describe()}`);
        return { outcome: 'adopted', entry, why: how };
    };

    const relogInPage = async (charged: RelogEntry | null): Promise<DropRelogResult> => {
        let waited = 0;
        for (;;) {
            const h = budget.holder();
            if (h) {
                if (waited === 0) deps.log?.(`[relog] the ${h.by}'s relog (pid ${h.pid}) holds the lock since ${h.at}: waiting, never relogging over it`);
                if (waited >= ADOPT_WAIT_TICKS) throw new Error(`the ${h.by}'s relog (pid ${h.pid}) has held the relog lock for ${waited} ticks since ${where}`);
                await deps.waitTicks(1);
                waited++;
                continue;
            }
            if (waited > 0 && (await deps.pageInGame()) === true) return adopt('the operator relogged while run.ts waited', charged);
            const lock = budget.tryLock('run');
            if (!lock.ok) continue;
            // An adopt waits on the session, so it runs after the lock is let go.
            let found = false;
            try {
                if ((await deps.pageInGame()) === true) found = true;
                else {
                    // An adopt of ours that fell out is the one login this drop is charged; the relog takes its entry over.
                    const reuse = charged?.by === 'run' ? charged : null;
                    if (!reuse) {
                        const room = budget.check('unplanned');
                        if (room !== true) throw new RelogBudgetSpent(`${room}; ${where} (${reason})`);
                    }
                    const r = await deps.login();
                    const meta = { reason, ...(r.wallMs !== undefined ? { loginWallMs: r.wallMs } : {}), ...(reuse ? { adoptedFirst: { at: reuse.at, ...reuse.meta } } : {}) };
                    const fields = { kind: 'unplanned' as const, by: 'run' as const, step: at.step, tick: at.tick, via: r.via, meta };
                    const entry = reuse ? budget.amend(reuse, fields) : budget.record(fields);
                    deps.log?.(`[relog] in-page relog after ${where} (${reason}): in via ${r.via}${reuse ? ', on the adopt\'s entry' : ''}; ${budget.describe()}`);
                    return { outcome: 'relogged', entry, why: reason };
                }
            } finally {
                lock.release();
            }
            if (found) return adopt('the page was back in the world when run.ts took the lock', charged);
        }
    };

    if (page === true) {
        // In game by its own word: ticking again (its socket resumed, or it reconnected itself), or still
        // holding a silent socket. Settle for the page's hold window (page-hold.ts): nothing is sent that
        // could fight the original socket; the page's own timeout reads it out of the world by then.
        const settle = pageHoldTicks();
        for (let t = 0; t < settle; t++) {
            if (deps.advanced()) return adopt('the page was back in the world, ticking', null);
            const p = await deps.pageInGame();
            if (p === false) break;
            if (p === null) {
                deps.resumeWatchdog();
                await deps.restored(new AbortController().signal);
                return { outcome: 'default', why: 'the page went away while it settled: the watchdog path' };
            }
            await deps.waitTicks(1);
        }
        if ((await deps.pageInGame()) !== false) {
            if (deps.advanced()) return adopt('the page was back in the world, ticking', null);
            const what = `the watchdog path (the page said in game but did not tick for ${settle} ticks)`;
            deps.resumeWatchdog();
            if ((await untilBack(RESTORE_WAIT_TICKS, what)) === 'out') return fellOut(what, null);
            return { outcome: 'default', why: `the page says in game but has not ticked for ${settle} ticks: the watchdog path` };
        }
        deps.log?.(`[relog] the page fell out of the world after ${where}`);
    }
    const down = !(await deps.worldUp()) ? 'the world is down' : !(await deps.gatewayUp()) ? 'our gateway is down' : null;
    if (down) {
        deps.resumeWatchdog();
        if ((await untilBack(RESTORE_WAIT_TICKS, down)) === 'back') return { outcome: 'default', why: `${down}: the session came back by other means` };
        deps.log?.(`[relog] ${down.replace(' is down', '')} is back and the page is out after ${where}: relogging it in page`);
        deps.pauseWatchdog();
    }
    return relogInPage(null);
}

/** link.restored's backstop inside the recovery's own tick-bounded waits. */
const RESTORE_BACKSTOP_MS = 30 * 60_000;

/** The live deps on a run.ts session: the page over its DevTools, session.ts login and adoptSession, the link's restore. */
export function liveDropDeps(session: Session, link: Link, log: (line: string) => void = console.log): DropRelogDeps {
    const cdp = session.client === 'browser' ? cdpUrl(session.env) : undefined;
    let since = Date.now();
    return {
        advanced: () => session.lastAdvanceAt > since,
        pageInGame: async () => (cdp ? await pageInGame(cdp, session.name).catch(() => null) : null),
        worldUp: async () => (await samplePlayerCount(demoOrigin(pageWorld(session.env)))).players !== null,
        gatewayUp: async () => sdkConnected(session) && (await gatewayStatus(session)) !== null,
        expectInWorld: () => session.expectInWorld,
        login: async () => {
            const r = await login(session, { inPage: true });
            return { via: r.via, wallMs: r.wallMs };
        },
        adopt: tickBase => adoptSession(session, tickBase),
        restored: signal => link.restored(RESTORE_BACKSTOP_MS, signal),
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

export interface DropRecovery {
    /** runResumable's `recover`: recoverDrop on the live session. */
    recover(reason: string, at: { step: string | null; tick: number }): Promise<void>;
    /**
     * Whether a recovery is running. Each of its waits relogs an out page itself, so the watchdog
     * stands down for an out page only then; with none running nothing would relog it.
     */
    acting(): boolean;
}

/** run.ts's drop recovery on its session (see DropRecovery). */
export function dropRecovery(session: Session, budget: RelogBudget, link: Link, log: (line: string) => void = console.log): DropRecovery {
    const deps = liveDropDeps(session, link, log);
    let running = 0;
    return {
        recover: async (reason, at) => {
            running++;
            try {
                await recoverDrop(budget, deps, reason, at);
            } finally {
                running--;
            }
        },
        acting: () => running > 0,
    };
}
