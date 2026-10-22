// In-run tick-cadence monitor: a passive read of the scored session's tick stream that writes one
// `TICKMON` line per minute to the run log. It acts on nothing.
//
// The start gate (tickmanip-latency.ts --path=direct) reads the host's path once, before the run.
// This watches the run's own connection for the rest of it: a path that starts holding ticks
// mid-run (a tick arriving 135-218 ms late, glued to the next one 0.1-0.3 ms behind it, as the
// host's paired gate reads showed on 2026-10-21) shows up here within a minute.
//
// What it reads: one arrival per tick label, timed by the gateway's receipt of the client's
// publication (`BotSDK.getStateReceivedAt`, captured by the SDK before any listener runs; local
// receipt time when the source has none). On the run host the gateway is on loopback beside the
// tab, so this is the tab's tick stream as the run scripts see it. A publication that moves the
// label by k counts as k arrivals at one time, as hostgate.ts's probe counts them: a tick the
// client never published arrived glued to the one after it.
//
// Off the reactive path: the state listener only appends (label, time) when the label changes.
// Classification, percentiles and the log write happen on the minute timer.
//
// Per minute, counted on `TickCadence`:
// - glued: an arrival under `gluedMs` (5) after the one before it;
// - late: an arrival more than `lateMs` (120) after its expected cadence point, which is the
//   anchor arrival plus whole ticks of the observed period (`TickPeriod`), not the nominal
//   `tickMs`: the demo server ticks at 340-370 ms, and against 300 ms every offset would carry
//   the difference, eating that much of the late threshold on every tick. The anchor moves to every arrival that is on time and not
//   glued, so slow drift between the server's and this machine's clocks is followed. A glued
//   arrival never moves it: the tick glued behind a held one reads early against the cadence,
//   and anchoring on it would make the next on-time tick read late (one hold, counted twice).
//   Two late arrivals in a row, neither glued, move it too: the engine's fixed grid catches up
//   at most two ticks (World.ts), so a longer stall shifts the cadence for good, and without
//   this every later tick would read late. A lasting shift therefore costs two late ticks;
// - the arrival offsets against the cadence: p50, p90 and max, in ms;
// - gaps: the label went back (a relaunch restarts the client's counter) or jumped more than
//   `gapTicks` (17, the watchdog's stale bound) at once. The cadence restarts there and the
//   jump is not counted as glued or late;
// - the period the window's arrivals were measured against (median, ms);
// - overBudget: ticks in the window whose sixth and later user events the engine deferred, summed
//   from the page program's `counters.overBudget` as each publication carries it (lib/programs.ts
//   overBudgetMeta). Printed only when nonzero, so a minute with no overflow reads as it always did.

import type { TickLog, TickRow } from './ticks';
import { PERIOD_GAP_TICKS, tickMs as defaultTickMs, TickPeriod } from './wait';

// The observed-period estimator lives in wait.ts (one implementation); the monitor reads its
// cadence against it, and its constants are re-exported for the monitor's readers.
export { PERIOD_MIN_SAMPLES, PERIOD_SPAN_TICKS, PERIOD_WINDOW, TickPeriod } from './wait';

export interface TickCadenceConfig {
    /** Nominal milliseconds per server tick (default `tickMs()`): the period until `TickPeriod` has measured one. */
    tickMs: number;
    /** An arrival more than this after its expected cadence point is late. */
    lateMs: number;
    /** An arrival closer than this to the one before it is glued to it. */
    gluedMs: number;
    /** A label jump larger than this restarts the cadence instead of counting the ticks between. */
    gapTicks: number;
}

export const TICKMON_DEFAULTS: Omit<TickCadenceConfig, 'tickMs'> = { lateMs: 120, gluedMs: 5, gapTicks: PERIOD_GAP_TICKS };

/** What one window of arrivals came to. */
export interface CadenceCounts {
    /** Arrivals classified (one per tick label). */
    ticks: number;
    glued: number;
    late: number;
    gaps: number;
    /** Offset of each arrival from its expected cadence point, ms; arrivals that set the cadence have none. */
    offsets: number[];
    /** The tick period each offset was measured against, ms (parallel to `offsets`). */
    periods: number[];
    firstTick: number | null;
    lastTick: number | null;
}

const emptyCounts = (): CadenceCounts => ({ ticks: 0, glued: 0, late: 0, gaps: 0, offsets: [], periods: [], firstTick: null, lastTick: null });

/** The classifier: feed arrivals in order with `arrive`, collect and reset the counts with `take`. */
export class TickCadence {
    private prevLabel: number | null = null;
    private prevAt = 0;
    private anchorLabel = 0;
    private anchorAt = 0;
    /** Whether the last arrival that was not glued was late. */
    private soloLate = false;
    private counts = emptyCounts();
    private readonly period: TickPeriod;

    constructor(readonly cfg: TickCadenceConfig) {
        this.period = new TickPeriod(cfg.tickMs, cfg.gapTicks);
    }

    /** One publication: tick `label`, received at `at` (ms). A repeat of the current label is ignored. */
    arrive(label: number, at: number): void {
        const prev = this.prevLabel;
        if (prev === label) return;
        const c = this.counts;
        c.firstTick ??= label;
        c.lastTick = label;
        if (prev === null || label < prev || label - prev > this.cfg.gapTicks) {
            if (prev !== null) c.gaps++;
            c.ticks++;
            this.prevLabel = this.anchorLabel = label;
            this.prevAt = this.anchorAt = at;
            this.soloLate = false;
            this.period.see(label, at);
            return;
        }
        // measured before this arrival joins it: the expectation comes from the ticks before
        const period = this.period.ms;
        for (let l = prev + 1; l <= label; l++) {
            const glued = at - this.prevAt < this.cfg.gluedMs;
            const offset = at - (this.anchorAt + (l - this.anchorLabel) * period);
            const late = offset > this.cfg.lateMs;
            c.ticks++;
            c.offsets.push(offset);
            c.periods.push(period);
            if (glued) c.glued++;
            if (late) c.late++;
            if (!glued) {
                if (!late || this.soloLate) {
                    this.anchorLabel = l;
                    this.anchorAt = at;
                }
                this.soloLate = late;
            }
            this.prevAt = at;
        }
        this.prevLabel = label;
        this.period.see(label, at);
    }

    /** The counts since the last `take`; the cadence itself carries on. */
    take(): CadenceCounts {
        const c = this.counts;
        this.counts = emptyCounts();
        return c;
    }
}

/** One emitted window. */
export interface TickMonMinute extends Omit<CadenceCounts, 'offsets' | 'periods'> {
    /** 0 for the minute that began at the first in-world tick. */
    minute: number;
    /** Wall-clock start of the window (epoch ms) and its length in seconds (60 but for a final partial one). */
    startedAt: number;
    secs: number;
    /** Offset percentiles, ms; null when no arrival in the window had a cadence to read against. */
    p50: number | null;
    p90: number | null;
    max: number | null;
    lateMs: number;
    /** Median tick period the window's offsets were measured against, ms; null with no offsets. */
    periodMs: number | null;
    /** Over-budget ticks the page's program counted in the window (`OverBudgetCount`). */
    overBudget: number;
}

function quantile(sorted: number[], p: number): number | null {
    return sorted.length ? Math.round(sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!) : null;
}

export function summarizeWindow(c: CadenceCounts, minute: number, startedAt: number, secs: number, lateMs: number, overBudget = 0): TickMonMinute {
    const { offsets, periods, ...rest } = c;
    const sorted = [...offsets].sort((a, b) => a - b);
    const periodMs = quantile([...periods].sort((a, b) => a - b), 0.5);
    return { ...rest, minute, startedAt, secs, p50: quantile(sorted, 0.5), p90: quantile(sorted, 0.9), max: quantile(sorted, 1), lateMs, periodMs, overBudget };
}

/**
 * `TICKMON minute=3 at=2026-10-21T16:23:00Z secs=60 ticks=176 glued=0 late=1 p50=0 p90=2 max=151 gaps=0 lateMs=120 periodMs=341`,
 * ending ` overBudget=N` in a minute where the page's program had over-budget ticks.
 */
export function tickMonLine(m: TickMonMinute): string {
    const v = (x: number | null) => (x === null ? '-' : String(x));
    const at = new Date(m.startedAt).toISOString().replace(/\.\d+Z$/, 'Z');
    const over = m.overBudget > 0 ? ` overBudget=${m.overBudget}` : '';
    return `TICKMON minute=${m.minute} at=${at} secs=${m.secs} ticks=${m.ticks} glued=${m.glued} late=${m.late} p50=${v(m.p50)} p90=${v(m.p90)} max=${v(m.max)} gaps=${m.gaps} lateMs=${m.lateMs} periodMs=${v(m.periodMs)}${over}`;
}

/** The page program's status as a publication carries it (lib/programs.ts ProgramStatus). */
export interface PublishedProgram {
    runId: number;
    counters?: Record<string, number>;
}

/**
 * The over-budget ticks the page's programs counted since the last `take`. The page publishes
 * each run's running total (`counters.overBudget`); this keeps the increments. A run first seen
 * already counting (one started before the monitor) contributes its whole count.
 */
export class OverBudgetCount {
    private runId: number | null = null;
    private seen = 0;
    private total = 0;

    see(program: PublishedProgram | null | undefined): void {
        if (!program) return;
        if (program.runId !== this.runId) {
            this.runId = program.runId;
            this.seen = 0;
        }
        const n = program.counters?.overBudget ?? 0;
        if (n > this.seen) this.total += n - this.seen;
        this.seen = n;
    }

    take(): number {
        const n = this.total;
        this.total = 0;
        return n;
    }
}

/** The part of the SDK the monitor reads. */
export interface TickMonitorSource {
    onStateUpdate(listener: (s: { tick: number; inGame: boolean; program?: PublishedProgram | null }) => void): () => void;
    /** When the gateway received the state just published (epoch ms); 0 or absent means unknown. */
    getStateReceivedAt?(): number;
}

export interface TickMonitorOptions extends Partial<TickCadenceConfig> {
    emit: (m: TickMonMinute) => void;
    /** Window length (default 60 000 ms). */
    windowMs?: number;
    /** A final window shorter than this is dropped at stop (default 10 000 ms): it says nothing per minute. */
    minPartialMs?: number;
    /** Wall clock (default Date.now). */
    now?: () => number;
    /** Default true; false leaves the window boundaries to `roll()` (tests). */
    timer?: boolean;
}

export interface TickMonitor {
    /** Close the current window now and emit it. */
    roll(): void;
    /** Unsubscribe and emit the final window (if it is at least `minPartialMs` long). Idempotent. */
    stop(): void;
}

/** Start watching `source`. The first window opens at the first in-world tick. */
export function startTickMonitor(source: TickMonitorSource, opts: TickMonitorOptions): TickMonitor {
    const cfg: TickCadenceConfig = {
        tickMs: opts.tickMs ?? defaultTickMs(),
        lateMs: opts.lateMs ?? TICKMON_DEFAULTS.lateMs,
        gluedMs: opts.gluedMs ?? TICKMON_DEFAULTS.gluedMs,
        gapTicks: opts.gapTicks ?? TICKMON_DEFAULTS.gapTicks,
    };
    const windowMs = opts.windowMs ?? 60_000;
    const minPartialMs = opts.minPartialMs ?? 10_000;
    const now = opts.now ?? Date.now;
    const cadence = new TickCadence(cfg);
    const overBudget = new OverBudgetCount();
    // Raw arrivals since the last roll, and the program's over-budget increments; the listener does nothing else.
    let labels: number[] = [];
    let times: number[] = [];
    let lastLabel: number | null = null;
    let minute = 0;
    let windowStart: number | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let stopped = false;

    const unsubscribe = source.onStateUpdate(s => {
        if (!s.inGame) return;
        // every publication, a same-label one too: a status republished after an action is newer
        overBudget.see(s.program);
        if (s.tick === lastLabel) return;
        lastLabel = s.tick;
        labels.push(s.tick);
        times.push(source.getStateReceivedAt?.() || now());
        if (windowStart === null) {
            windowStart = now();
            if (opts.timer !== false) {
                timer = setInterval(roll, windowMs);
                (timer as { unref?: () => void }).unref?.();
            }
        }
    });

    function roll(): void {
        if (windowStart === null) return;
        const ls = labels;
        const ts = times;
        labels = [];
        times = [];
        for (let i = 0; i < ls.length; i++) cadence.arrive(ls[i]!, ts[i]!);
        const end = now();
        const m = summarizeWindow(cadence.take(), minute++, windowStart, Math.round((end - windowStart) / 1000), cfg.lateMs, overBudget.take());
        windowStart = end;
        opts.emit(m);
    }

    return {
        roll,
        stop() {
            if (stopped) return;
            stopped = true;
            unsubscribe();
            if (timer) clearInterval(timer);
            if (windowStart !== null && now() - windowStart >= minPartialMs) roll();
        },
    };
}

/** The run's settings: `false` turns the monitor off; otherwise overrides of the defaults. */
export type TickMonitorSetting = false | Partial<TickCadenceConfig>;

/**
 * The settings the environment asks for on top of `setting`: SPEEDRUN_TICKMON=off turns it off,
 * SPEEDRUN_TICKMON_LATE_MS sets the late threshold.
 */
export function tickMonitorSetting(setting: TickMonitorSetting | undefined, env: Record<string, string | undefined> = process.env): TickMonitorSetting {
    if (setting === false || env.SPEEDRUN_TICKMON?.toLowerCase() === 'off') return false;
    const late = Number(env.SPEEDRUN_TICKMON_LATE_MS);
    return { ...(env.SPEEDRUN_TICKMON_LATE_MS && Number.isFinite(late) && late > 0 ? { lateMs: late } : {}), ...setting };
}

export function tickMonRow(log: TickLog, session: { name: string; sessionId: number }, m: TickMonMinute, tickMs: number): TickRow {
    return {
        v: 1,
        kind: 'tickmon',
        runId: log.runId,
        account: session.name,
        sessionId: session.sessionId,
        step: 'tickmon',
        startTick: m.firstTick ?? -1,
        endTick: m.lastTick ?? -1,
        ticks: m.ticks,
        wallMs: m.secs * 1000,
        ok: true,
        meta: { line: tickMonLine(m), minute: m.minute, glued: m.glued, late: m.late, p50: m.p50, p90: m.p90, max: m.max, gaps: m.gaps, lateMs: m.lateMs, periodMs: m.periodMs, ...(m.overBudget > 0 ? { overBudget: m.overBudget } : {}) },
        tickMs,
        at: new Date(m.startedAt).toISOString(),
    };
}

/**
 * The run's monitor: on the session's SDK, one `tickmon` row per minute in the run log (the
 * `TICKMON` line is in its `meta.line`), and the same line on stdout. Null when turned off.
 */
export function startRunTickMonitor(
    session: { name: string; sessionId: number; sdk: TickMonitorSource },
    log: TickLog,
    setting?: TickMonitorSetting,
): TickMonitor | null {
    const s = tickMonitorSetting(setting);
    if (s === false) return null;
    const ms = s.tickMs ?? defaultTickMs();
    return startTickMonitor(session.sdk, {
        ...s,
        tickMs: ms,
        emit: m => {
            const row = tickMonRow(log, session, m, ms);
            log.append(row);
            console.log(row.meta!.line);
        },
    });
}
