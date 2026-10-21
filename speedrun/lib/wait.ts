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

export type WaitResult =
    | { ok: true; state: BotWorldState; tick: number }
    | { ok: false; state: BotWorldState | null; tick: number };

export interface WaitOptions {
    /** Give up once this many ticks pass without `pred` holding. */
    maxTicks: number;
    /** Only states with `tick > after` count (default: the current state counts too). */
    after?: number;
}

/**
 * Resolve on the first published state satisfying `pred`, or `{ok:false}` once
 * `maxTicks` ticks pass. A wall-clock backstop of `(maxTicks + 10) * tickMs()`
 * covers a client that stops publishing altogether.
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
        const start = after ?? cur?.tick ?? 0;
        let last: BotWorldState | null = cur;
        let done = false;
        const finish = (r: WaitResult) => {
            if (done) return;
            done = true;
            unsubscribe();
            clearTimeout(wall);
            resolve(r);
        };
        const unsubscribe = sdk.onStateUpdate(s => {
            last = s;
            if (counts(s) && pred(s)) finish({ ok: true, state: s, tick: s.tick });
            else if (s.tick - start > maxTicks) finish({ ok: false, state: s, tick: s.tick });
        });
        const wall = setTimeout(() => finish({ ok: false, state: last, tick: last?.tick ?? -1 }), (maxTicks + 10) * tickMs());
    });
}

/** Resolve on the first state whose tick is past `after` (default: now). Throws if no tick arrives. */
export async function nextTick(sdk: StateSource, after: number = currentTick(sdk)): Promise<BotWorldState> {
    const r = await waitUntil(sdk, s => s.tick > after, { maxTicks: 3, after });
    if (!r.ok) throw new Error(`nextTick: no tick after ${after} (client stopped publishing?)`);
    return r.state;
}

/** Wait until `n` ticks have passed since now. Throws if the client stops publishing. */
export async function waitTicks(sdk: StateSource, n: number): Promise<BotWorldState> {
    const target = currentTick(sdk) + n;
    const r = await waitUntil(sdk, s => s.tick >= target, { maxTicks: n + 3 });
    if (!r.ok) throw new Error(`waitTicks(${n}): client stopped publishing`);
    return r.state;
}

export function sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
}
