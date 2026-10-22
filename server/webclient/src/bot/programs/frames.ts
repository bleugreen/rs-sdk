// Tick cadence as the page lived it, for the host gate's in-run rule
// (cairn://p/rs/83 and rs/102, docs/speedrun/research/demo-latency.md).
//
// A catch-up is an interval under 1/2 T right after one over 7/6 T, T the tick length
// (tick-rule.ts; 150 and 350 ms at T = 300): the server overran a tick and the next one
// followed at once. A reaction to the long tick then misses about half the time. Fed from
// raw frame arrivals (the websocket message that carried each PLAYER_INFO), never from
// game-loop passes, which merge back-to-back ticks into one and would hide exactly these.
//
// T is the driver's (the `tickMs` start parameter, source `driver`); without one it is the
// run's own median interval so far, rounded to the nearest 50 ms (source `median`), so each
// interval is judged against the T known when it arrived.

import { isCatchUp, type TickSource, tickFromMedian, tickLimits } from './tick-rule.js';

export interface FrameSummary {
    /** Intervals measured. */
    n: number;
    p50: number;
    p90: number;
    max: number;
    /** Intervals under 1/2 T, and over 7/6 T. */
    underHalfT: number;
    overSevenSixthsT: number;
    catchUps: number;
    /** Catch-ups in the 60 s before the last arrival. */
    catchUpsLastMinute: number;
    /** Catch-ups per minute over the whole run. */
    catchUpsPerMinute: number;
    /** The tick length the intervals were judged by, ms, and where it came from; null before any interval without a driver's T. */
    T: number | null;
    TSource: TickSource | null;
}

export interface MsSummary {
    n: number;
    p50: number;
    p90: number;
    max: number;
}

/** Millisecond values in fixed buckets: bounded memory for runs of any length. */
export class MsHistogram {
    private readonly hist: Uint32Array;
    n = 0;
    max = 0;

    constructor(private readonly bucketMs: number, private readonly buckets: number) {
        this.hist = new Uint32Array(buckets);
    }

    add(ms: number): void {
        const i = Math.min(this.buckets - 1, Math.max(0, Math.floor(ms / this.bucketMs)));
        this.hist[i] = (this.hist[i] ?? 0) + 1;
        if (ms > this.max) this.max = ms;
        this.n++;
    }

    /** Value at quantile q (bucket upper edge, ms); 0 before any value. */
    percentile(q: number): number {
        if (!this.n) return 0;
        const target = Math.ceil(q * this.n);
        let seen = 0;
        for (let i = 0; i < this.buckets; i++) {
            seen += this.hist[i]!;
            if (seen >= target) return (i + 1) * this.bucketMs;
        }
        return this.buckets * this.bucketMs;
    }

    summary(): MsSummary {
        return { n: this.n, p50: this.percentile(0.5), p90: this.percentile(0.9), max: Math.round(this.max * 10) / 10 };
    }
}

export class FrameStats {
    private last: number | null = null;
    private first: number | null = null;
    private prevGap: number | null = null;
    // 10 ms buckets up to 3 s; longer intervals land in the last bucket
    private readonly gaps = new MsHistogram(10, 301);
    private underHalfT = 0;
    private overSevenSixthsT = 0;
    private catchUps = 0;

    private readonly recentCatchUps: number[] = [];

    /** `tickMs`: the driver's tick length; absent or null judges by the running median. */
    constructor(private readonly tickMs: number | null = null) {}

    /** The tick length now: the driver's, else the median interval so far rounded to 50 ms. */
    tick(): number | null {
        return this.tickMs ?? (this.gaps.n ? tickFromMedian(this.gaps.percentile(0.5)) : null);
    }

    /** A frame arrived at `at` (wall ms, performance.now()). */
    add(at: number): void {
        if (this.last === null) {
            this.first = at;
            this.last = at;
            return;
        }
        const gap = at - this.last;
        this.last = at;
        this.gaps.add(gap);
        const T = this.tick();
        if (T !== null) {
            const l = tickLimits(T);
            if (gap < l.catchUpUnderMs) this.underHalfT++;
            if (gap > l.catchUpAfterOverMs) this.overSevenSixthsT++;
            if (isCatchUp(gap, this.prevGap, T)) {
                this.catchUps++;
                this.recentCatchUps.push(at);
            }
        }
        this.prevGap = gap;
        while (this.recentCatchUps.length && this.recentCatchUps[0]! < at - 60_000) this.recentCatchUps.shift();
    }

    summary(): FrameSummary {
        const minutes = this.first !== null && this.last !== null ? (this.last - this.first) / 60_000 : 0;
        const T = this.tick();
        return {
            n: this.gaps.n,
            p50: this.gaps.percentile(0.5),
            p90: this.gaps.percentile(0.9),
            max: Math.round(this.gaps.max),
            underHalfT: this.underHalfT,
            overSevenSixthsT: this.overSevenSixthsT,
            catchUps: this.catchUps,
            catchUpsLastMinute: this.recentCatchUps.length,
            catchUpsPerMinute: minutes > 0 ? Math.round((this.catchUps / Math.max(1, minutes)) * 100) / 100 : 0,
            T,
            TSource: this.tickMs !== null ? 'driver' : T !== null ? 'median' : null
        };
    }
}

export interface LoopSummary {
    /** Game-loop passes per second over the last tick interval. */
    last: number;
    /** 10th percentile of the per-interval rate over the last 10 s. */
    p10Last10s: number;
    /** Lowest per-interval rate this run. */
    min: number;
}

/**
 * The page's game-loop rate. Until decoding runs on message arrival, a reaction
 * waits for the next loop pass, so this is the page's reaction granularity: about
 * 74/s in a visible tab, and a few per second if Chrome throttles a hidden or
 * occluded one.
 */
export class LoopRate {
    private lastAt: number | null = null;
    private lastCount = 0;
    private readonly recent: Array<{ at: number; rate: number }> = [];
    private min = Number.POSITIVE_INFINITY;

    add(at: number, count: number): void {
        if (this.lastAt !== null && at > this.lastAt) {
            const rate = ((count - this.lastCount) * 1000) / (at - this.lastAt);
            this.recent.push({ at, rate });
            if (rate < this.min) this.min = rate;
            while (this.recent.length && this.recent[0]!.at < at - 10_000) this.recent.shift();
        }
        this.lastAt = at;
        this.lastCount = count;
    }

    summary(): LoopSummary {
        const rates = this.recent.map(r => r.rate).sort((a, b) => a - b);
        const r1 = (x: number) => Math.round(x * 10) / 10;
        return {
            last: r1(this.recent.at(-1)?.rate ?? 0),
            p10Last10s: r1(rates.length ? rates[Math.floor(0.1 * (rates.length - 1))]! : 0),
            min: r1(Number.isFinite(this.min) ? this.min : 0)
        };
    }
}
