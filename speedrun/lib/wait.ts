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

/**
 * The server tick at a wall time, as the client will count it, from a tick the client was current
 * on (`tick0`, received at `wall0`). A starved browser tab decodes ticks behind the server, so the
 * tick it reads when it executes a click can be many ticks short of the tick the click reached;
 * take the larger of the two. Wall time here only ever lengthens a tick bound: on a current tab the
 * two agree, and a slower real tick (the demo's 340-370 ms) only overestimates.
 */
export function serverClock(tick0: number, wall0: number): (wallMs: number) => number {
    return wallMs => tick0 + Math.max(0, Math.floor((wallMs - wall0) / tickMs()));
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

/** `maxTicks`: that many ticks passed without `pred` holding. `idle`: no new tick for the idle bound's wall time (IDLE_TICKS ticks unless the wait set `idle`). */
export type WaitFailure = 'maxTicks' | 'idle';

export type WaitResult =
    | { ok: true; state: BotWorldState; tick: number }
    /** `silentMs`: wall time from the last new tick (or the wait's start) to the failure. */
    | { ok: false; reason: WaitFailure; state: BotWorldState | null; tick: number; silentMs: number };

/**
 * An idle bound longer than IDLE_TICKS, for a wait that spans a window where a live client
 * publishes nothing: the browser client decodes no tick while it rebuilds a region after a
 * teleport, so a starved tab is silent for seconds and then publishes the landing as the next tick.
 */
export interface IdleBound {
    /** Ticks of wall time without a new tick before the wait fails with `idle`. */
    ticks: number;
    /**
     * The client's observed tick period. The bound is `ticks` of it, never shorter than
     * `ticks * tickMs()`: right after a login ticks arrive in bursts and read short.
     */
    period?: TickPeriod;
}

/** The shortest span of ticks an IdleBound's `period` is trusted over. */
export const IDLE_PERIOD_MIN_SPAN_MS = 2_000;

/** Wall milliseconds an idle bound stands for: IDLE_TICKS x tickMs() without one. */
export function idleBoundMs(bound?: IdleBound): number {
    if (!bound) return IDLE_TICKS * tickMs();
    return bound.ticks * Math.max(tickMs(), bound.period?.msPerTick(IDLE_PERIOD_MIN_SPAN_MS) ?? 0);
}

export interface WaitOptions {
    /**
     * Give up once this many ticks pass without `pred` holding. Ticks are
     * counted as forward steps of `state.tick`, so the count carries on across
     * a client relaunch, whose tick clock restarts.
     */
    maxTicks: number;
    /** Only states with `tick > after` count (default: the current state counts too). */
    after?: number;
    /** The idle bound (default: IDLE_TICKS x tickMs()). Never a time budget: only silence trips it. */
    idle?: IdleBound;
}

/** Why a wait failed with reason `idle`, for messages. */
export const STALLED = `no new tick for ${IDLE_TICKS} ticks (client stopped publishing?)`;

export interface TickClock {
    /** Ticks seen since `from`, as forward steps of `state.tick`, so the count carries on across a client relaunch, whose tick clock restarts. */
    readonly elapsed: number;
    /** Feed every published state. Only a new tick re-arms the idle timer: republishes within one tick never bring a tick limit closer. */
    see(s: BotWorldState): void;
    /** Wall milliseconds since the last new tick, or since the clock was created. */
    readonly silentMs: number;
    /** Disarm for good; later `see` calls only count. */
    stop(): void;
}

/**
 * The tick count and dead-client detector for anything that listens to
 * published states with a tick limit: `onIdle` fires once no new tick has
 * arrived for `idleMs` (default `IDLE_TICKS * tickMs()`). Armed on creation; `lastTick` is the
 * tick already seen (it does not count as new). Counting starts at `from`, or
 * at the first state seen when `from` is undefined. There is deliberately no
 * total-time budget: ticks are the limit, however slowly they come.
 */
export function tickClock(from: number | undefined, onIdle: () => void, lastTick?: number, idleMs: number = idleBoundMs()): TickClock {
    let prev = from;
    let last = lastTick;
    let elapsed = 0;
    let stopped = false;
    let armedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
        clearTimeout(timer);
        armedAt = Date.now();
        timer = setTimeout(onIdle, idleMs);
    };
    arm();
    return {
        get elapsed() {
            return elapsed;
        },
        get silentMs() {
            return Date.now() - armedAt;
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

/** A client's tick period as it observes it, for turning wall time into ticks (`tickPeriod`). */
export interface TickPeriod {
    /** Feed every published state. */
    see(s: BotWorldState): void;
    /**
     * Milliseconds per tick over the window: the wall-clock span from the first new tick in it
     * to the newest, over the ticks `tickClock` counted between them. Null while that span is
     * under `minSpanMs`, where a few ticks' arrival jitter would weigh too much.
     */
    msPerTick(minSpanMs: number): number | null;
}

/**
 * The tick period this client observes over its last `windowMs`, for anything that has to turn
 * a wall-clock interval into ticks: the demo has run at 340-370 ms a tick, so the nominal
 * `tickMs()` overcounts. Each new tick is timed on arrival; republishes within a tick are not.
 * A relaunch (the tick going back) restarts the measurement, since the time spent away is not
 * ticks this client saw.
 */
export function tickPeriod(windowMs: number, now: () => number = () => Date.now()): TickPeriod {
    const clock = tickClock(undefined, () => {});
    clock.stop();
    let marks: Array<{ ms: number; n: number }> = [];
    let last: number | undefined;
    return {
        see(s) {
            if (last !== undefined && s.tick < last) marks = [];
            last = s.tick;
            clock.see(s);
            if (marks.at(-1)?.n === clock.elapsed) return;
            const ms = now();
            marks.push({ ms, n: clock.elapsed });
            const keep = marks.findIndex(m => m.ms >= ms - windowMs);
            if (keep > 0) marks.splice(0, keep);
        },
        msPerTick(minSpanMs) {
            const a = marks[0];
            const b = marks.at(-1);
            if (!a || !b || b.n === a.n || b.ms - a.ms < minSpanMs) return null;
            return (b.ms - a.ms) / (b.n - a.n);
        }
    };
}

/**
 * Resolve on the first published state satisfying `pred`, or `{ok:false}`:
 * `reason: 'maxTicks'` once `maxTicks` ticks pass, the only bound on how long
 * a ticking wait runs, however slow the ticks; `reason: 'idle'` once no new
 * tick arrives for the idle bound (`opts.idle`, default `IDLE_TICKS * tickMs()`).
 * Republishes within one tick do not hold the idle timer off, since they can
 * never bring `maxTicks` closer.
 */
export function waitUntil(sdk: StateSource, pred: Pred, opts: WaitOptions): Promise<WaitResult> {
    const { maxTicks, after, idle } = opts;
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
        const fail = (reason: WaitFailure): WaitResult => ({ ok: false, reason, state: last, tick: last?.tick ?? -1, silentMs: clock.silentMs });
        const clock = tickClock(after ?? cur?.tick ?? 0, () => finish(fail('idle')), cur?.tick, idleBoundMs(idle));
        const unsubscribe = sdk.onStateUpdate(s => {
            last = s;
            clock.see(s);
            if (counts(s) && pred(s)) finish({ ok: true, state: s, tick: s.tick });
            else if (clock.elapsed > maxTicks) finish(fail('maxTicks'));
        });
    });
}

export type StepResult<T> = { ok: true; value: T } | { ok: false; reason: WaitFailure };

/** The reason string a result with a free-text `reason` reports for a failed wait: STALLED for `idle`, 'timeout' for `maxTicks`. */
export function failureReason(r: WaitFailure): string {
    return r === 'idle' ? STALLED : 'timeout';
}

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

/**
 * Longest wait for the client's scene after a login (a launch, a relog, a resume walk) before the
 * caller goes on anyway; the one bound for the launch path and the resume walk (main's ruling). rs/41's
 * cold-profile probe at Varrock west (rs/424): the scene ready at tick 73, 351 loc models draining at
 * ~15 files a second after the maps were in at +0.7 s.
 */
export const SCENE_READY_MAX_TICKS = 200;

export interface SceneWait {
    ready: boolean;
    ticks: number;
}

/**
 * Wait for the client's own scene-ready signal (`sceneReady`; undefined on an older client counts
 * as ready). Never throws: past `maxTicks` it reports `ready: false` and the caller goes on. Nearby
 * locs and NPCs cannot stand in for it: an empty list is also a normal empty scene.
 */
export async function awaitScene(sdk: StateSource, maxTicks = SCENE_READY_MAX_TICKS): Promise<SceneWait> {
    const t0 = currentTick(sdk);
    const r = await waitUntil(sdk, s => s.sceneReady !== false, { maxTicks });
    return { ready: r.ok, ticks: currentTick(sdk) - t0 };
}
