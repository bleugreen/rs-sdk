// The host gate's tick-length rule: every millisecond limit on tick arrivals is a fraction of the
// server's tick length T (docs/speedrun/skills/tick-manipulation.md, "Run-time host gate").
//
// (c) A catch-up is an interval under 1/2 T right after one over 7/6 T: the server overran a tick
//     and ran the next one at once. A reaction to the long tick then misses about half the time.
// (b) The tick arrival p90's report line is 4/3 T.
// At T = 300 these are 150, 350 and 400 ms, the limits the gate was calibrated with.
//
// This is the one definition. The page's frame counter (frames.ts) uses it in the bundle, and the
// SDK-side gate (speedrun/lib/hostgate-verdict.ts) imports it from here, so the module imports
// nothing and touches no DOM or Node global.

/** Each limit as [numerator, denominator] of T, so T = 300 gives exactly 150, 350 and 400. */
export const TICK_FRACTIONS = {
    catchUpUnder: [1, 2],
    catchUpAfterOver: [7, 6],
    tickP90Report: [4, 3]
} as const;

/**
 * Where T came from. flag: given on the command line; feed: the engine's spectator feed hello
 * (`tickMs`); driver: passed in by the SDK driver (the page's `tickMs` start parameter); median:
 * the median of the measured intervals, rounded to the nearest TICK_ROUND_MS.
 */
export type TickSource = 'flag' | 'feed' | 'driver' | 'median';

export interface TickLength {
    /** Tick length, ms. */
    T: number;
    source: TickSource;
}

/** A median interval is rounded to this before it stands for T. */
export const TICK_ROUND_MS = 50;

const ofT = (T: number, [n, d]: readonly [number, number]) => (T * n) / d;

export interface TickLimits {
    T: number;
    /** (c) The short interval of a catch-up is under this... */
    catchUpUnderMs: number;
    /** ...right after one over this. */
    catchUpAfterOverMs: number;
    /** (b) The tick p90's report line. */
    tickP90Ms: number;
}

/** The limits in ms for tick length T (exact; round them only to print). */
export function tickLimits(T: number): TickLimits {
    return {
        T,
        catchUpUnderMs: ofT(T, TICK_FRACTIONS.catchUpUnder),
        catchUpAfterOverMs: ofT(T, TICK_FRACTIONS.catchUpAfterOver),
        tickP90Ms: ofT(T, TICK_FRACTIONS.tickP90Report)
    };
}

/** Interval `gap` is a catch-up when it follows `prevGap` (null: none before it) at tick length T. */
export function isCatchUp(gap: number, prevGap: number | null, T: number): boolean {
    if (prevGap === null) return false;
    const l = tickLimits(T);
    return gap < l.catchUpUnderMs && prevGap > l.catchUpAfterOverMs;
}

/** A median interval as T: rounded to the nearest TICK_ROUND_MS; null when that is not positive. */
export function tickFromMedian(medianMs: number): number | null {
    const T = Math.round(medianMs / TICK_ROUND_MS) * TICK_ROUND_MS;
    return Number.isFinite(T) && T > 0 ? T : null;
}

/** A usable tick length (a finite number of ms above 0), else null. */
export function validTickMs(v: unknown): number | null {
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

/** `< 150 after > 350 ms`: (c)'s limits at T, whole ms, for logs. */
export function catchUpText(T: number): string {
    const l = tickLimits(T);
    return `< ${Math.round(l.catchUpUnderMs)} after > ${Math.round(l.catchUpAfterOverMs)} ms`;
}
