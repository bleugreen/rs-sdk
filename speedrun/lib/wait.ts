// Tick-keyed waits shared by every speedrun module.
//
// Clock: `state.tick` is the client's count of PLAYER_INFO packets, which the
// server sends once per tick, so the difference between two observed ticks is
// server ticks. It resets when the client relaunches (see session.ts).
//
// Never wait on bare `waitForStateChange` for a game effect: the client
// republishes state after every executed action within the same tick, so an
// "any change" wait resolves against a snapshot that predates the effect.

import type { BotSDK } from '../../sdk/index';
import type { BotWorldState } from '../../sdk/types';

export type StateSource = Pick<BotSDK, 'getState' | 'onStateUpdate'>;
export type Pred = (s: BotWorldState) => boolean;

/** Milliseconds per server tick: SPEEDRUN_TICK_MS, else NODE_TICKRATE, else 300 (production). */
export function tickMs(env: Record<string, string | undefined> = process.env): number {
    for (const raw of [env.SPEEDRUN_TICK_MS, env.NODE_TICKRATE]) {
        const n = Number(raw);
        if (raw && Number.isFinite(n) && n > 0) return n;
    }
    return 300;
}

export function currentTick(sdk: StateSource): number {
    return sdk.getState()?.tick ?? -1;
}

/**
 * Ticks without a new tick after which a wait concludes the client stopped
 * publishing. A dead-client detector, not a time budget: the demo goes quiet
 * for a few seconds with nothing wrong, so this stays at or above
 * runner/resume.ts LOST_AFTER_TICKS; a silence long enough to be a disconnect
 * is the resumable runner's to recover from.
 */
export const IDLE_TICKS = 20;

/** `maxTicks`: that many ticks passed without `pred` holding. `idle`: no new tick for IDLE_TICKS ticks of wall time. */
export type WaitFailure = 'maxTicks' | 'idle';

export type WaitResult =
    | { ok: true; state: BotWorldState; tick: number }
    | { ok: false; reason: WaitFailure; state: BotWorldState | null; tick: number };

export interface WaitOptions {
    /**
     * Give up once this many ticks pass without `pred` holding. Ticks are
     * counted as forward steps of `state.tick`, so the count carries on across
     * a client relaunch, whose tick clock restarts.
     */
    maxTicks: number;
    /** Only states with `tick > after` count (default: the current state counts too). */
    after?: number;
}

const STALLED = `no new tick for ${IDLE_TICKS} ticks (client stopped publishing?)`;

/**
 * Resolve on the first published state satisfying `pred`, or `{ok:false}`:
 * `reason: 'maxTicks'` once `maxTicks` ticks pass, the only bound on how long
 * a ticking wait runs, however slow the ticks; `reason: 'idle'` once no new
 * tick arrives for `IDLE_TICKS * tickMs()`. Republishes within one tick do not
 * hold the idle timer off, since they can never bring `maxTicks` closer.
 */
export function waitUntil(sdk: StateSource, pred: Pred, opts: WaitOptions): Promise<WaitResult> {
    const { maxTicks, after } = opts;
    return new Promise(resolve => {
        const cur = sdk.getState();
        const counts = (s: BotWorldState) => after === undefined || s.tick > after;
        if (cur && counts(cur) && pred(cur)) {
            resolve({ ok: true, state: cur, tick: cur.tick });
            return;
        }
        const idleMs = IDLE_TICKS * tickMs();
        let prevTick = after ?? cur?.tick ?? 0;
        let elapsed = 0;
        let last: BotWorldState | null = cur;
        let done = false;
        let idle: ReturnType<typeof setTimeout> | undefined;
        const finish = (r: WaitResult) => {
            if (done) return;
            done = true;
            unsubscribe();
            clearTimeout(idle);
            resolve(r);
        };
        const armIdle = () => {
            clearTimeout(idle);
            idle = setTimeout(() => finish({ ok: false, reason: 'idle', state: last, tick: last?.tick ?? -1 }), idleMs);
        };
        const unsubscribe = sdk.onStateUpdate(s => {
            const fresh = s.tick !== last?.tick;
            last = s;
            elapsed += Math.max(0, s.tick - prevTick);
            prevTick = s.tick;
            if (counts(s) && pred(s)) finish({ ok: true, state: s, tick: s.tick });
            else if (elapsed > maxTicks) finish({ ok: false, reason: 'maxTicks', state: s, tick: s.tick });
            else if (fresh) armIdle();
        });
        armIdle();
    });
}

/** `waitUntil`, throwing "timed out after N ticks waiting for: <what>" (or the idle reason) instead of returning `ok:false`. */
export async function waitOrThrow(sdk: StateSource, pred: Pred, maxTicks: number, what: string): Promise<BotWorldState> {
    const t0 = currentTick(sdk);
    const r = await waitUntil(sdk, pred, { maxTicks });
    if (!r.ok) throw new Error(r.reason === 'idle' ? `${STALLED} waiting for: ${what}` : `timed out after ${r.tick - t0} ticks waiting for: ${what}`);
    return r.state;
}

/** Resolve on the first state whose tick is past `after` (default: now). Throws only on the idle timeout. */
export async function nextTick(sdk: StateSource, after: number = currentTick(sdk)): Promise<BotWorldState> {
    const r = await waitUntil(sdk, s => s.tick > after, { maxTicks: Infinity, after });
    if (!r.ok) throw new Error(`nextTick: ${STALLED} after tick ${after}`);
    return r.state;
}

/** Wait until `n` ticks have passed since now. Throws if the client stops publishing or its tick clock restarts. */
export async function waitTicks(sdk: StateSource, n: number): Promise<BotWorldState> {
    const target = currentTick(sdk) + n;
    const r = await waitUntil(sdk, s => s.tick >= target, { maxTicks: n + 3 });
    if (!r.ok) throw new Error(r.reason === 'idle' ? `waitTicks(${n}): ${STALLED}` : `waitTicks(${n}): tick ${target} not reached in ${n + 3} ticks (tick clock went back: client relaunched?)`);
    return r.state;
}

export function sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
}
