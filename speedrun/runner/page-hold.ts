// How long run.ts leaves a silent page alone while the page still says it is in game: a network hold.
//
// The browser client keeps its socket through a silence up to its own no-data timeout
// (server/webclient/src/client/NoDataTimeout.ts), then declares the connection lost itself: in game off
// at once, then its own reconnect. Until then the original socket can still resume, and the hold costs
// only its ticks. What costs more is anything run.ts sends meanwhile: a fresh login or a relaunch opens
// a second socket while the server still holds the first (refused as already logged in, a relog spent).
//
// So while the page says in game and the silence is inside PAGE_HOLD_MS, nothing logs in or relaunches:
// the drop recovery's settle (drop-relog.ts) waits pageHoldTicks(), and the watchdog stands down
// (pageHoldStandDown, run.ts). The link still declares the drop at its own bound (resume.ts
// LOST_AFTER_TICKS), so a step that stalls is cut as a drop, not failed. Past the window the page has
// spoken (out of the world, or back by its own reconnect), and the usual paths apply.
//
// A socket that closes is not a hold: the page reads out of the world within about a second, and the
// recovery relogs it at once.

import { NO_DATA_TIMEOUT_MS } from '../../server/webclient/src/client/NoDataTimeout';
import type { WatchdogVerdict } from '../lib/session';
import { tickMs } from '../lib/wait';

/** Past the page's own timeout, room for it to be read out of the world (lostCon clears in game before its reconnect). */
export const PAGE_HOLD_MARGIN_MS = 15_000;

/** Wall milliseconds of silence a page that still says in game is waited for. */
export const PAGE_HOLD_MS = NO_DATA_TIMEOUT_MS + PAGE_HOLD_MARGIN_MS;

/** PAGE_HOLD_MS in ticks of wall time (lib/wait.ts tickMs), for the waits that count ticks. */
export function pageHoldTicks(): number {
    return Math.ceil(PAGE_HOLD_MS / tickMs());
}

/**
 * The watchdog's stand-down for a hold: a reason to hold a logout or relaunch while the tick has been
 * silent no longer than PAGE_HOLD_MS and the page (`page`, lib/tab.ts pageInGame) says in game; null
 * otherwise. A progress stop is never held: its tick is advancing, so it is not a silence.
 */
export async function pageHoldStandDown(at: { verdict: WatchdogVerdict; msSinceAdvance: number }, page: () => Promise<boolean | null>): Promise<string | null> {
    if (at.verdict === 'stop' || at.msSinceAdvance > PAGE_HOLD_MS) return null;
    if ((await page()) !== true) return null;
    return `the page still says in game: its socket may resume until its own ${NO_DATA_TIMEOUT_MS / 1000} s no-data timeout (held to ${PAGE_HOLD_MS / 1000} s of silence)`;
}
