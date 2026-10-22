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

/**
 * The demo server's tick length since its 2026-10-22 19:56Z restart: the spectator feed's hello
 * (wss://rs-sdk-demo.fly.dev/worldfeed) reports `tickMs: 400` (rs/83, measured p50 402 ms).
 * Nominal only: it sizes wall-clock backstops. Anything that turns wall time into ticks reads the
 * observed period (`TickPeriod`, `periodMs`), and every wait that stands for ticks counts them.
 */
export const DEMO_TICK_MS = 400;

/** Milliseconds per server tick: SPEEDRUN_TICK_MS, else NODE_TICKRATE (a lab engine's own), else DEMO_TICK_MS. */
export function tickMs(env: Record<string, string | undefined> = process.env): number {
    for (const raw of [env.SPEEDRUN_TICK_MS, env.NODE_TICKRATE]) {
        const n = Number(raw);
        if (raw && Number.isFinite(n) && n > 0) return n;
    }
    return DEMO_TICK_MS;
}

/**
 * The server tick at a wall time, as the client will count it, from a tick the client was current
 * on (`tick0`, received at `wall0`). A starved browser tab decodes ticks behind the server, so the
 * tick it reads when it executes a click can be many ticks short of the tick the click reached;
 * take the larger of the two. Wall time is turned into ticks at `period`'s observed length when it
 * has one (`periodMs`), else the nominal `tickMs()`.
 */
export function serverClock(tick0: number, wall0: number, period?: TickPeriod): (wallMs: number) => number {
    return wallMs => tick0 + Math.max(0, Math.floor((wallMs - wall0) / periodMs(period)));
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

/**
 * Wall milliseconds an idle bound stands for: IDLE_TICKS x tickMs() without one. This is the one
 * form of a "no new tick for N ticks" detector: silence has no ticks to count, so it is N ticks of
 * the longer of the nominal and the observed period, never shorter than N real ticks.
 */
export function idleBoundMs(bound?: IdleBound): number {
    if (!bound) return IDLE_TICKS * tickMs();
    return bound.ticks * Math.max(tickMs(), bound.period?.msPerTick(IDLE_PERIOD_MIN_SPAN_MS) ?? 0);
}

/**
 * Milliseconds per tick for turning a wall interval into ticks: `period`'s observed length once it
 * has watched `minSpanMs` of ticks, else the nominal `tickMs()`.
 */
export function periodMs(period?: TickPeriod, minSpanMs: number = IDLE_PERIOD_MIN_SPAN_MS): number {
    return period?.msPerTick(minSpanMs) ?? tickMs();
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

/** Ticks one period sample spans (`TickPeriod`). */
export const PERIOD_SPAN_TICKS = 8;
/** Period samples the rolling median is taken over: about 16 s of ticks at 400 ms. */
export const PERIOD_WINDOW = 40;
/** Samples before the median replaces the nominal tick length: from the 13th tick. */
export const PERIOD_MIN_SAMPLES = 5;
/** A label jump larger than this restarts the span instead of counting the ticks between (the watchdog's stale bound). */
export const PERIOD_GAP_TICKS = 17;

/**
 * The server's tick period as this side observes it, the one estimator for turning wall time into
 * ticks: the rolling median of the last `PERIOD_WINDOW` per-tick intervals, each measured across
 * `PERIOD_SPAN_TICKS` ticks, and the nominal length until `PERIOD_MIN_SAMPLES` of them exist.
 *
 * Why a span and not single intervals: a held tick and the one glued behind it give single
 * intervals of +hold and ~0, and a path that pairs ticks (every other one held) alternates them,
 * where a median of single intervals flips between ~0 and twice the period. Across 8 ticks a hold
 * moves only the samples starting or ending on it, by hold / 8, and a lasting shift (a stall)
 * raises 8 samples of 40 by shift / 8, which the median ignores. The window follows the demo's
 * period as it moves between minutes (161-177 ticks a minute on 2026-10-21) while a minute of
 * holds cannot drag it. A relaunch (the label going back) restarts the span, so time spent away
 * is never read as ticks; the samples so far stand, since a relaunch does not change the server's tick.
 */
export class TickPeriod {
    private last: number | null = null;
    /** Arrival times of the last `PERIOD_SPAN_TICKS + 1` consecutive labels, ending at `last`. */
    private times: number[] = [];
    private samples: number[] = [];
    private median: number | null = null;
    private firstAt: number | null = null;
    private lastAt: number | null = null;

    constructor(readonly nominalMs: number = tickMs(), readonly gapTicks: number = PERIOD_GAP_TICKS) {}

    /** Milliseconds per tick: the rolling median once measured, else the nominal length. */
    get ms(): number {
        return this.median ?? this.nominalMs;
    }

    get measured(): boolean {
        return this.median !== null;
    }

    /**
     * The measured period, or null until it is measured and the arrivals it has watched span at
     * least `minSpanMs` (a caller that wants a longer look than the warm-up asks for one).
     */
    msPerTick(minSpanMs: number): number | null {
        if (this.median === null || this.firstAt === null || this.lastAt === null || this.lastAt - this.firstAt < minSpanMs) return null;
        return this.median;
    }

    /**
     * Tick `label` arrived at `at` (ms). A repeat is ignored; a publication that moves the label
     * by k is k arrivals at one time; a label that goes back or jumps past `gapTicks` restarts
     * the span.
     */
    see(label: number, at: number): void {
        const last = this.last;
        if (last === label) return;
        this.last = label;
        this.firstAt ??= at;
        this.lastAt = at;
        if (last === null || label < last || label - last > this.gapTicks) {
            this.times = [at];
            return;
        }
        for (let l = last + 1; l <= label; l++) {
            this.times.push(at);
            if (this.times.length > PERIOD_SPAN_TICKS + 1) this.times.shift();
            if (this.times.length === PERIOD_SPAN_TICKS + 1) this.sample((at - this.times[0]!) / PERIOD_SPAN_TICKS);
        }
    }

    private sample(ms: number): void {
        this.samples.push(ms);
        if (this.samples.length > PERIOD_WINDOW) this.samples.shift();
        if (this.samples.length < PERIOD_MIN_SAMPLES) return;
        const s = [...this.samples].sort((a, b) => a - b);
        const mid = s.length >> 1;
        this.median = s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
    }
}

/**
 * Feed `period` the source's current state and every one after it, each timed on receipt (the
 * gateway's receipt time when the SDK has it, else now). Returns the unsubscribe.
 */
export function feedTickPeriod(sdk: StateSource & { getStateReceivedAt?(): number }, period: TickPeriod): () => void {
    const at = () => sdk.getStateReceivedAt?.() || Date.now();
    const cur = sdk.getState();
    if (cur) period.see(cur.tick, at());
    return sdk.onStateUpdate(s => period.see(s.tick, at()));
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
