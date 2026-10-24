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
//   page's own reconnect): adopted and recorded as an adopt, which no budget is charged for: no
//   login was sent and SCORED never left the world.
// - Otherwise run.ts takes the lock, reads the page once more under it, checks the budget, logs in,
//   records the relog with the step and tick of the drop, and lets the lock go. relog-now refuses
//   while run.ts holds it.
// Past the budget the recover throws RelogBudgetSpent and the run stops with that reason.
//
// Close first after a long silence. A page silent for its whole hold window (page-hold.ts) is out,
// whatever it says: either it says in game with no tick (the zombie: the host's runs D and E, the
// in-page login then timing out, the account's body still in the world), or it fell out at its own
// no-data timeout. Its in-place reconnect is not relied on. Under the relog lock the recovery closes
// the old tab (closeTab: lib/tab.ts closeBotTabs, confirmed gone from Chrome's targets, and with it
// the page's socket), waits CLOSE_SETTLE_MS (the server removed the body within ~10 s of that close
// on the host), then logs in on a fresh tab (session.ts relaunchOwnTab: the watchdog's launchClient on
// a new token URL, checked by its launch identity, rs/668). A short silence (a socket that closed:
// the page out at once) is still relogged in page at once.
//
// The relog never fails the run after one attempt. A login refused because the account is still
// logged in (session.ts ALREADY_LOGGED_IN), one that timed out (session.ts LoginTimedOut), or a fresh
// tab that did not get in is retried every ALREADY_IN_RETRY_MS, the lock held, for up to
// ALREADY_IN_BOUND_MS from the first failure, every retry a fresh tab, never another in-page login on
// the tab that just failed. One unplanned relog is recorded when a login lands; past the bound it
// fails. Any other refusal (a bad password, a full world) fails at once. The watchdog stays paused
// throughout and stands down for the out page, as for any running recovery.
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
// A gone page closes first too. A browser client whose page cannot answer, because its tab has left
// Chrome's targets or its renderer crashed or hangs (OOM-killed, `kill -9`: the target stays listed
// and its Runtime.evaluate rejects or never answers; lib/tab.ts probePage, every read bounded by
// PAGE_READ_TIMEOUT_MS), reads out of the world once a second read RECHECK_TICKS later agrees. A page
// mid-navigation can fail one read. From then on it takes the same route as a long silence: whatever
// is left of its tab closed under the lock, CLOSE_SETTLE_MS, a fresh tab, in the same bounded retry
// loop and on one unplanned relog. A dead renderer's game socket closed with its process. Before this,
// such a page read as no page at all and went to the watchdog, whose logout cannot land on a dead page
// and whose relaunch re-navigates the dead tab.
//
// The drop must reach this recovery first. A dead renderer's gateway socket closes with it, so our
// gateway reads the bot dead at once and the watchdog's verdict is a logout. That logout cannot land
// on a dead page, but it clears expectInWorld, which hides the drop from the link. On the lab's
// renderer kill (fedora, 2026-10-24) the run then stopped 'already logged out' with exit 4, before any
// recovery. So on run.ts the link reads a gone page as out of the world (linkPage), declaring the
// drop once the tick has stood PAGE_CHECK_TICKS. The watchdog stands down for a gone page
// (recoveryStandDown), on one bounded read.
//
// Only a session with no page to ask at all (a lite client, or no DevTools port configured) takes
// the default path: link.restored, the watchdog's relaunch or its outage reconnect.
//
// While the page is out nothing publishes ticks, so the waits here are ticks of wall time
// (n x tickMs(), lib/wait.ts's idle convention).

import { demoOrigin, samplePlayerCount } from '../lib/demo-status';
import {
    adoptSession,
    ALREADY_LOGGED_IN,
    alreadyLoggedIn,
    cdpUrl,
    gatewayStatus,
    login,
    LoginRefused,
    loginTimedOut,
    pageWorld,
    relaunchOwnTab,
    sdkConnected,
    type Session,
    type WatchdogVerdict,
} from '../lib/session';
import { probePage, type PageGone } from '../lib/tab';
import { sleep, tickMs } from '../lib/wait';
import { RelogBudgetSpent, type RelogBudget, type RelogEntry } from './relog-budget';
import { NO_DATA_TIMEOUT_MS } from '../../server/webclient/src/client/NoDataTimeout';
import { closeBotTabs } from '../lib/tab';
import { PAGE_HOLD_MARGIN_MS, PAGE_HOLD_MS, pageHoldStandDown, pageHoldTicks } from './page-hold';
import type { Link } from './resume';

/** Ticks run.ts waits for an operator's relog to let the lock go, and for an adopted session to tick (relog-now's login is bounded at 90 s = 225 ticks at 400 ms). */
export const ADOPT_WAIT_TICKS = 300;
/** Ticks between the page reads while the recovery waits for the session to come back. */
export const RECHECK_TICKS = 3;
/** Ticks the recovery waits for a session to come back by other means (the watchdog's path, a world or gateway outage): 30 min at 400 ms. */
export const RESTORE_WAIT_TICKS = 4_500;
/** Times one recovery relogs a session that fell out of the world again while it waited, before it gives up. */
export const MAX_FALLS = 2;
/**
 * Wall ms between relog attempts after one is refused as already logged in, times out, or a fresh tab
 * does not get in. Short, because the old tab is closed first: the server removed the body within
 * ~10 s of that close on the host (runs D and E). Wall time: nothing publishes ticks while out.
 */
export const ALREADY_IN_RETRY_MS = 20_000;
/** Wall ms between closing the old tab and the fresh tab's login: the body's ~10 s to leave the world. */
export const CLOSE_SETTLE_MS = 10_000;
/**
 * A page that fell out this far into the settle fell out at its own no-data timeout (the margin
 * covers the link's detection before the settle began): a long silence, so close first.
 */
export const LONG_SILENCE_MS = NO_DATA_TIMEOUT_MS - PAGE_HOLD_MARGIN_MS;
/**
 * Wall ms from the first such refusal past which no retry starts: the server's 1,000-tick
 * TIMEOUT_NO_RESPONSE at 400 ms (6.7 min) and a margin. Measured on a block of the scored tab's
 * socket (no FIN): every login after a 20 s hold was refused until the old player timed out.
 */
export const ALREADY_IN_BOUND_MS = 8 * 60_000;
/**
 * Wall ms one request of a page read may take before the page counts as gone. A live page answers in
 * milliseconds; a crashed renderer's Runtime.evaluate can reject or never answer, and an unbounded read
 * would stall the recovery on it.
 */
export const PAGE_READ_TIMEOUT_MS = 3_000;

/** A page read: its in-game flag, a page that could not answer (PageGone), or null with no page to ask at all. */
export type PageAnswer = boolean | null | PageGone;

const isGone = (p: PageAnswer): p is PageGone => typeof p === 'object' && p !== null;

/** The live page read on a browser session's DevTools port (lib/tab.ts probePage). */
export async function readPage(cdp: string, botName: string, timeoutMs = PAGE_READ_TIMEOUT_MS): Promise<PageAnswer> {
    const p = await probePage(cdp, botName, timeoutMs);
    return 'inGame' in p ? p.inGame : p;
}

/**
 * The page as run.ts's link asks it (resume.ts sessionLink): a gone page is out of the world, so the
 * link declares the drop once the tick has stood PAGE_CHECK_TICKS. A read that failed once only cuts
 * the step: the recovery confirms a gone page before it closes anything.
 */
export function linkPage(read: () => Promise<PageAnswer>): () => Promise<boolean | null> {
    return async () => {
        const p = await read();
        return isGone(p) ? false : p;
    };
}

/**
 * The watchdog's stand-down on a run with this recovery (run.ts), on the one bounded page read `read`:
 * - A gone page: a logout or stop is held. It cannot land on a dead page, and the expectInWorld it
 *   clears would hide the drop (see the file comment). A relaunch, reached only after a logout that
 *   failed, is held while the silence is within PAGE_HOLD_MS, and is the backstop past it.
 * - An out page while a recovery runs: held, since the recovery relogs it.
 * - Otherwise the page hold (page-hold.ts).
 */
export async function recoveryStandDown(at: { verdict: WatchdogVerdict; msSinceAdvance: number }, read: () => Promise<PageAnswer>, acting: () => boolean): Promise<string | null> {
    const p = await read();
    if (isGone(p)) {
        if (at.verdict === 'relaunch' && at.msSinceAdvance > PAGE_HOLD_MS) return null;
        return `the page is gone (${p.gone}): the drop recovery closes what is left of its tab and opens a fresh one`;
    }
    if (acting() && p === false) return 'the page is out of the world: the running drop recovery relogs it in page';
    return pageHoldStandDown(at, async () => p);
}

export interface DropRelogDeps {
    /**
     * The page's own in-game flag. A PageGone when this browser client's page cannot answer: no tab
     * for it in Chrome's targets, a renderer that crashed or hangs, a DevTools port that does not
     * answer. Null only when there is no page to ask at all: a lite client, or no DevTools configured.
     */
    pageInGame(): Promise<PageAnswer>;
    /** Whether the world answers (its /playercount). */
    worldUp(): Promise<boolean>;
    /** Whether our own gateway answers (the SDK's socket to it up, its status read): a login cannot be seen landing without it. */
    gatewayUp(): Promise<boolean>;
    /** session.expectInWorld: false while someone's logout runs (the watchdog's), whose out page is not a drop. */
    expectInWorld(): boolean;
    /**
     * session.ts login in page, the token URL as fallback; resolves once in the world with an
     * advancing tick. A refusal as already logged in throws at once (session.ts LoginRefused), a
     * timeout as session.ts LoginTimedOut.
     */
    login(): Promise<{ via: 'page' | 'launch'; wallMs?: number }>;
    /**
     * session.ts relaunchOwnTab: the tab re-navigated to a new token URL and its launch's own session
     * waited for. Every relog attempt after the first, and the first for a zombie page.
     */
    relaunch(): Promise<{ via: 'page' | 'launch'; wallMs?: number }>;
    /** Close the old tab and confirm it gone (its page and sockets with it); a line for the log. */
    closeTab(): Promise<string>;
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

    let falls = 0;
    // Set once the page said in game through its whole hold window without a tick: from then on its
    // claim counts only with a tick behind it.
    let zombie = false;
    // Set after a long silence (the zombie, or a page out at its own no-data timeout) or for a gone
    // page: the relog closes the old tab first and logs in on a fresh one.
    let closeFirst = false;
    // Why the page could not answer, once two reads found it gone.
    let gone: string | null = null;
    /** Wait `ms` of wall time in ticks, ending on it (RECHECK_TICKS steps, the last one short). */
    const waitWall = async (ms: number) => {
        const until = deps.now() + ms;
        while (deps.now() < until) await deps.waitTicks(Math.max(1, Math.min(RECHECK_TICKS, Math.ceil((until - deps.now()) / tickMs()))));
    };
    /**
     * Read the page. A first gone read is read again RECHECK_TICKS later; gone twice, the page reads
     * out of the world and its tab is closed first. Once confirmed, a gone read needs no second one.
     */
    const ask = async (): Promise<boolean | null> => {
        let p = await deps.pageInGame();
        if (isGone(p) && gone === null) {
            await deps.waitTicks(RECHECK_TICKS);
            p = await deps.pageInGame();
        }
        if (!isGone(p)) return p;
        if (gone === null) deps.log?.(`[relog] the page is gone after ${where} (${p.gone}): closing what is left of its tab, then a fresh one`);
        gone ??= p.gone;
        closeFirst = true;
        return false;
    };
    const pageIn = async (): Promise<boolean | null> => {
        const p = await ask();
        return p === true && zombie && !deps.advanced() ? false : p;
    };

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
                if (!deps.expectInWorld() || (await ask()) !== false) continue;
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
        deps.log?.(`[relog] the page fell out of the world during ${what} after ${where}: ${closeFirst ? 'closing its tab, then a fresh one' : 'relogging it in page'}`);
        deps.pauseWatchdog();
        return relogInPage(charged);
    };

    const adopt = async (how: string, charged: RelogEntry | null): Promise<DropRelogResult> => {
        // The operator's relog found done is its own (charged) entry; an adopt with no login behind it
        // is recorded uncharged, whatever the budget holds.
        const entry =
            charged ??
            budget.entries().find(e => e.by === 'operator' && e.at >= since) ??
            budget.record({ kind: 'adopt', by: 'run', step: at.step, tick: at.tick, via: 'adopted', meta: { reason, how } });
        const tb = entry.meta?.tickBase;
        deps.adopt(typeof tb === 'number' ? tb : undefined);
        if ((await untilBack(ADOPT_WAIT_TICKS, 'the adopt')) === 'out') return fellOut(`the adopt (${how})`, entry);
        deps.log?.(`[relog] adopted (${how}) after ${where}; ${budget.describe()}`);
        return { outcome: 'adopted', entry, why: how };
    };

    /**
     * The first attempt in page (a fresh tab when `freshFirst`), every later one a fresh tab, waiting
     * out the server's hold on the dropped player (ALREADY_IN_*) after a refusal as already logged in,
     * a timeout, or a fresh tab that did not get in; any other failure throws as it came.
     */
    const loginPastHold = async (
        freshFirst: boolean
    ): Promise<Awaited<ReturnType<DropRelogDeps['login']>> & { refusals: number; timeouts: number; attempts: number; freshTabs: number; heldMs: number }> => {
        let first: number | null = null;
        let refusals = 0;
        let timeouts = 0;
        let freshTabs = 0;
        for (let n = 0; ; n++) {
            const fresh = freshFirst || n > 0;
            if (fresh) freshTabs++;
            try {
                const r = fresh ? await deps.relaunch() : await deps.login();
                return { ...r, refusals, timeouts, attempts: n + 1, freshTabs, heldMs: first === null ? 0 : deps.now() - first };
            } catch (e) {
                let why: string;
                if (alreadyLoggedIn(e)) {
                    refusals++;
                    why = `the server still holds SCORED in the world (reply ${ALREADY_LOGGED_IN})`;
                } else if (e instanceof LoginRefused) throw e;
                else if (loginTimedOut(e)) {
                    timeouts++;
                    why = `the ${fresh ? 'fresh-tab' : 'in-page'} login timed out`;
                } else if (fresh && e instanceof Error && !(e instanceof RelogBudgetSpent)) why = `the fresh tab did not get in (${e.message})`;
                else throw e;
                const now = deps.now();
                first ??= now;
                const heldS = Math.round((now - first) / 1000);
                if (now - first + ALREADY_IN_RETRY_MS > ALREADY_IN_BOUND_MS) {
                    throw new Error(
                        `${e.message}; ${n + 1} relog attempt(s) failed over ${heldS} s after ${where} (${refusals} refused as already logged in, ${timeouts} timed out), past the ${ALREADY_IN_BOUND_MS / 60_000}-min bound on the server's hold of the dropped player`
                    );
                }
                deps.log?.(`[relog] attempt ${n + 1} after ${where} failed, ${heldS} s since the first: ${why}; a fresh tab in ${ALREADY_IN_RETRY_MS / 1000} s`);
                await waitWall(now + ALREADY_IN_RETRY_MS - deps.now());
            }
        }
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
            if (waited > 0 && (await pageIn()) === true) return adopt('the operator relogged while run.ts waited', charged);
            const lock = budget.tryLock('run');
            if (!lock.ok) continue;
            // An adopt waits on the session, so it runs after the lock is let go.
            let found = false;
            try {
                if ((await pageIn()) === true) found = true;
                else {
                    // An adopt of ours that fell out was never charged: this login is, on the adopt's entry, so one drop is one entry.
                    const reuse = charged?.by === 'run' ? charged : null;
                    const room = budget.check('unplanned');
                    if (room !== true) throw new RelogBudgetSpent(`${room}; ${where} (${reason})`);
                    let closed: string | undefined;
                    if (closeFirst) {
                        closed = await deps.closeTab().catch((e: unknown) => `close failed (${e instanceof Error ? e.message : String(e)}); the fresh tab's navigation replaces the page`);
                        deps.log?.(`[relog] closed the old tab first after ${where}: ${closed}; a fresh tab in ${CLOSE_SETTLE_MS / 1000} s`);
                        await waitWall(CLOSE_SETTLE_MS);
                    }
                    const r = await loginPastHold(closeFirst);
                    const meta = {
                        reason,
                        ...(r.wallMs !== undefined ? { loginWallMs: r.wallMs } : {}),
                        ...(r.refusals ? { alreadyLoggedIn: { refusals: r.refusals, heldMs: r.heldMs } } : {}),
                        ...(r.attempts > 1 || r.freshTabs ? { attempts: { tries: r.attempts, freshTabs: r.freshTabs, timeouts: r.timeouts, heldMs: r.heldMs } } : {}),
                        ...(zombie ? { zombie: true } : {}),
                        ...(gone !== null ? { pageGone: gone } : {}),
                        ...(closed !== undefined ? { closedFirst: closed } : {}),
                        ...(reuse ? { adoptedFirst: { at: reuse.at, ...reuse.meta } } : {}),
                    };
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

    const page = await ask();
    if (page === null) {
        deps.resumeWatchdog();
        await deps.restored(new AbortController().signal);
        return { outcome: 'default', why: 'no page to ask (a lite client, or no DevTools configured): the watchdog path' };
    }

    if (page === true) {
        // In game by its own word: ticking again (its socket resumed, or it reconnected itself), or still
        // holding a silent socket. Settle for the page's hold window (page-hold.ts): nothing is sent that
        // could fight the original socket; the page's own timeout reads it out of the world by then.
        const settle = pageHoldTicks();
        for (let t = 0; t < settle; t++) {
            if (deps.advanced()) return adopt('the page was back in the world, ticking', null);
            const p = await ask();
            if (p === false) {
                // A gone page has set closeFirst already.
                closeFirst ||= t * tickMs() >= LONG_SILENCE_MS;
                break;
            }
            if (p === null) {
                deps.resumeWatchdog();
                await deps.restored(new AbortController().signal);
                return { outcome: 'default', why: 'no page to ask while it settled: the watchdog path' };
            }
            await deps.waitTicks(1);
        }
        const after = await ask();
        if (after !== false) {
            if (deps.advanced()) return adopt('the page was back in the world, ticking', null);
            const down = !(await deps.worldUp()) ? 'the world is down' : !(await deps.gatewayUp()) ? 'our gateway is down' : null;
            if (after === null || down) {
                // No page to ask, or no tick could be seen with the world or our gateway down: the
                // silence is not the page's, so it is waited out on the watchdog's path.
                const what = `the watchdog path (the page did not tick for ${settle} ticks${down ? `; ${down}` : ''})`;
                deps.resumeWatchdog();
                if ((await untilBack(RESTORE_WAIT_TICKS, what)) === 'out') return fellOut(what, null);
                return { outcome: 'default', why: `${what}: back by other means` };
            }
            zombie = true;
            closeFirst = true;
            deps.log?.(`[relog] the page says in game but has not ticked for ${settle} ticks (${PAGE_HOLD_MS / 1000} s, its whole hold window) after ${where}, the world and our gateway up: not in game; closing its tab, then a fresh one`);
            return relogInPage(null);
        }
        if (gone === null) deps.log?.(`[relog] the page fell out of the world after ${where}${closeFirst ? ' at its own no-data timeout: closing its tab, then a fresh one' : ''}`);
    }
    const down = !(await deps.worldUp()) ? 'the world is down' : !(await deps.gatewayUp()) ? 'our gateway is down' : null;
    if (down) {
        deps.resumeWatchdog();
        if ((await untilBack(RESTORE_WAIT_TICKS, down)) === 'back') return { outcome: 'default', why: `${down}: the session came back by other means` };
        deps.log?.(`[relog] ${down.replace(' is down', '')} is back and the page is out after ${where}: ${closeFirst ? 'closing its tab, then a fresh one' : 'relogging it in page'}`);
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
        pageInGame: async () => (cdp ? readPage(cdp, session.name) : null),
        worldUp: async () => (await samplePlayerCount(demoOrigin(pageWorld(session.env)))).players !== null,
        gatewayUp: async () => sdkConnected(session) && (await gatewayStatus(session)) !== null,
        expectInWorld: () => session.expectInWorld,
        login: async () => {
            const r = await login(session, { inPage: true, stopOnReply: [ALREADY_LOGGED_IN] });
            return { via: r.via, wallMs: r.wallMs };
        },
        relaunch: async () => {
            const r = await relaunchOwnTab(session);
            return { via: r.via, wallMs: r.wallMs };
        },
        closeTab: async () => {
            if (!cdp) return 'no DevTools port: nothing to close';
            const c = await closeBotTabs(cdp, session.name, 5_000, { blankIfLast: true });
            return `${c.closed} tab(s) closed and gone from Chrome's targets`;
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
