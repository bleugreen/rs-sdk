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

/** Why a wait failed with reason `idle`, for messages. */
export const STALLED = `no new tick for ${IDLE_TICKS} ticks (client stopped publishing?)`;

export interface TickClock {
    /** Ticks seen since `from`, as forward steps of `state.tick`, so the count carries on across a client relaunch, whose tick clock restarts. */
    readonly elapsed: number;
    /** Feed every published state. Only a new tick re-arms the idle timer: republishes within one tick never bring a tick limit closer. */
    see(s: BotWorldState): void;
    /** Disarm for good; later `see` calls only count. */
    stop(): void;
}

/**
 * The tick count and dead-client detector for anything that listens to
 * published states with a tick limit: `onIdle` fires once no new tick has
 * arrived for `IDLE_TICKS * tickMs()`. Armed on creation; `lastTick` is the
 * tick already seen (it does not count as new). Counting starts at `from`, or
 * at the first state seen when `from` is undefined. There is deliberately no
 * total-time budget: ticks are the limit, however slowly they come.
 */
export function tickClock(from: number | undefined, onIdle: () => void, lastTick?: number): TickClock {
    const idleMs = IDLE_TICKS * tickMs();
    let prev = from;
    let last = lastTick;
    let elapsed = 0;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
        clearTimeout(timer);
        timer = setTimeout(onIdle, idleMs);
    };
    arm();
    return {
        get elapsed() {
            return elapsed;
        },
        see(s) {
            if (prev !== undefined) elapsed += Math.max(0, s.tick - prev);
            prev = s.tick;
            if (s.tick === last) return;
            last = s.tick;
            if (!stopped) arm();
        },
        stop() {
            stopped = true;
            clearTimeout(timer);
        },
    };
}

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
        let last: BotWorldState | null = cur;
        let done = false;
        const finish = (r: WaitResult) => {
            if (done) return;
            done = true;
            unsubscribe();
            clock.stop();
            resolve(r);
        };
        const clock = tickClock(after ?? cur?.tick ?? 0, () => finish({ ok: false, reason: 'idle', state: last, tick: last?.tick ?? -1 }), cur?.tick);
        const unsubscribe = sdk.onStateUpdate(s => {
            last = s;
            clock.see(s);
            if (counts(s) && pred(s)) finish({ ok: true, state: s, tick: s.tick });
            else if (clock.elapsed > maxTicks) finish({ ok: false, reason: 'maxTicks', state: s, tick: s.tick });
        });
    });
}

export type StepResult<T> = { ok: true; value: T } | { ok: false; reason: WaitFailure };

/**
 * Feed every published state, the current one first, to `step` until it
 * returns a value (anything but undefined). Fails with `reason: 'maxTicks'`
 * once more than `maxTicks` ticks pass without one (counted from the current
 * tick, as `tickClock` counts), or `reason: 'idle'` once the client stops
 * publishing.
 */
export function onStates<T>(sdk: StateSource, maxTicks: number, step: (s: BotWorldState) => T | undefined): Promise<StepResult<T>> {
    return new Promise(resolve => {
        let done = false;
        const finish = (r: StepResult<T>) => {
            if (done) return;
            done = true;
            unsubscribe();
            clock.stop();
            resolve(r);
        };
        const cur = sdk.getState();
        const clock = tickClock(cur?.tick ?? 0, () => finish({ ok: false, reason: 'idle' }), cur?.tick);
        const handle = (s: BotWorldState) => {
            if (done) return;
            clock.see(s);
            const v = step(s);
            if (v !== undefined) finish({ ok: true, value: v });
            else if (clock.elapsed > maxTicks) finish({ ok: false, reason: 'maxTicks' });
        };
        const unsubscribe = sdk.onStateUpdate(handle);
        if (cur) handle(cur);
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
