import { describe, expect, test } from 'bun:test';
import { parseLog, report, TickLog } from './ticks';
import { OverBudgetCount, PERIOD_MIN_SAMPLES, PERIOD_SPAN_TICKS, startRunTickMonitor, startTickMonitor, TickCadence, type TickCadenceConfig, tickMonitorSetting, tickMonLine, type TickMonMinute, TickPeriod, summarizeWindow } from './tick-monitor';

const CFG: TickCadenceConfig = { tickMs: 300, lateMs: 120, gluedMs: 5, gapTicks: 17 };

/** Feed (label, ms) arrivals and take the counts. */
function classify(arrivals: Array<[number, number]>, cfg: TickCadenceConfig = CFG) {
    const c = new TickCadence(cfg);
    for (const [l, t] of arrivals) c.arrive(l, t);
    return c.take();
}

/** Labels 1..n on a `ms` cadence with a small deterministic jitter (never over 10 ms). */
const clean = (n: number, ms = 300): Array<[number, number]> => Array.from({ length: n }, (_, i) => [i + 1, (i + 1) * ms + ((i * 7) % 11) - 5] as [number, number]);

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1]!;

describe('TickCadence', () => {
    test('a clean minute: 200 ticks, nothing glued, nothing late', () => {
        const c = classify(clean(200));
        expect([c.ticks, c.glued, c.late, c.gaps]).toEqual([200, 0, 0, 0]);
        expect(Math.max(...c.offsets)).toBeLessThan(15);
        expect([c.firstTick, c.lastTick]).toEqual([1, 200]);
    });

    test('injected holds: exact glued and late counts', () => {
        const a = new Map<number, number>(Array.from({ length: 200 }, (_, i) => [i + 1, (i + 1) * 300]));
        a.set(50, 50 * 300 + 150); // held 150 ms ...
        a.set(51, 50 * 300 + 150.2); // ... and the next tick glued 0.2 ms behind it
        a.set(100, 100 * 300 + 200); // held 200 ms on its own; 101 on time
        a.delete(150); // never published: 151's publication moves the label by two
        const c = classify([...a].sort((x, y) => x[0] - y[0]));
        // late: 50, 100, and 150 (arrived with 151, 300 ms after its point); glued: 51, 151
        expect([c.ticks, c.glued, c.late, c.gaps]).toEqual([200, 2, 3, 0]);
        expect(Math.max(...c.offsets)).toBe(300);
    });

    test('the tick glued behind a held one does not move the cadence: one hold, one late', () => {
        // 51 reads 150 ms early against the cadence; anchoring on it would make 52 read 150 ms late
        const c = classify([[48, 14400], [49, 14700], [50, 15150], [51, 15150.2], [52, 15600], [53, 15900], [54, 16200]]);
        expect([c.late, c.glued]).toEqual([1, 1]);
        expect(c.offsets.map(Math.round)).toEqual([0, 150, -150, 0, 0, 0]);
    });

    test('a held tick followed by an on-time one re-anchors there: the next ticks are on time', () => {
        const c = classify([[1, 300], [2, 600], [3, 1050], [4, 1200], [5, 1500], [6, 1800]]);
        expect([c.late, c.glued]).toEqual([1, 0]);
    });

    test('a lasting shift of the cadence costs two late ticks, then the cadence follows it', () => {
        const before = Array.from({ length: 10 }, (_, i) => [i + 1, (i + 1) * 300] as [number, number]);
        const after = Array.from({ length: 50 }, (_, i) => [i + 11, (i + 11) * 300 + 400] as [number, number]);
        const c = classify([...before, ...after]);
        expect([c.ticks, c.late, c.glued]).toEqual([60, 2, 0]);
    });

    test('slow clock drift is followed, not counted', () => {
        // 2 ms per tick: 400 ms behind the starting cadence after 200 ticks
        const c = classify(Array.from({ length: 200 }, (_, i) => [i + 1, (i + 1) * 302] as [number, number]));
        expect(c.late).toBe(0);
    });

    test('a label that goes back or jumps past gapTicks restarts the cadence and counts a gap', () => {
        const c = classify([[100, 300], [101, 600], [3, 5000], [4, 5300], [40, 20000], [41, 20300]]);
        expect([c.ticks, c.gaps, c.glued, c.late]).toEqual([6, 2, 0, 0]);
        expect(c.offsets).toEqual([0, 0, 0]);
    });

    test('a 300 ms stream measures a 300 ms period: the nominal cadence, as before', () => {
        const c = classify(clean(200));
        expect(Math.round(median(c.periods))).toBe(300);
        // the fixture's jitter steps +7 or -4 between ticks, so the median offset is -4 either way
        expect(Math.abs(median(c.offsets))).toBeLessThan(5);
    });

    describe('a slow server (the demo ticks at 340-370 ms against the nominal 300)', () => {
        test('a steady 340 ms stream: nothing late, offsets about 0, period 340', () => {
            const c = classify(clean(176, 340));
            expect([c.ticks, c.glued, c.late, c.gaps]).toEqual([176, 0, 0, 0]);
            // against the nominal 300 every offset read +40
            expect(Math.abs(median(c.offsets))).toBeLessThan(5);
            expect(Math.round(median(c.periods))).toBe(340);
        });

        test('three ticks held 180 ms in a 340 ms stream: exactly three late', () => {
            const a = clean(176, 340).map(([l, t]) => [l, [40, 90, 140].includes(l) ? t + 180 : t] as [number, number]);
            const c = classify(a);
            expect([c.ticks, c.glued, c.late, c.gaps]).toEqual([176, 0, 3, 0]);
        });

        test('holds under lateMs are not late at 370 ms (against 300 they read 70 ms more, 160)', () => {
            const a = clean(162, 370).map(([l, t]) => [l, [40, 90, 140].includes(l) ? t + 90 : t] as [number, number]);
            expect(classify(a).late).toBe(0);
            // the same holds at 130 ms are late either way
            const b = clean(162, 370).map(([l, t]) => [l, [40, 90, 140].includes(l) ? t + 130 : t] as [number, number]);
            expect(classify(b).late).toBe(3);
        });

        test('held-and-glued pairs leave the period alone, and are counted as before', () => {
            // every 10th tick held 200 ms with the next glued behind it: 17 pairs
            const a = clean(176, 340).map(([l, t]) => [l, l % 10 === 0 ? l * 340 + 200 : l % 10 === 1 && l > 1 ? (l - 1) * 340 + 200.2 : t] as [number, number]);
            const c = classify(a);
            expect([c.glued, c.late]).toEqual([17, 17]);
            expect(Math.abs(median(c.periods.slice(20)) - 340)).toBeLessThan(2);
        });
    });

    test('take resets the counts but not the cadence', () => {
        const c = new TickCadence(CFG);
        c.arrive(1, 300);
        c.arrive(2, 600);
        expect(c.take().ticks).toBe(2);
        c.arrive(3, 1050);
        const next = c.take();
        expect([next.ticks, next.late, next.offsets[0]]).toEqual([1, 1, 150]);
    });
});

describe('TickPeriod', () => {
    test('the nominal length until PERIOD_MIN_SAMPLES span samples, then their median', () => {
        const p = new TickPeriod(300);
        // SPAN + 1 consecutive labels make the first sample, so labels 0..warm-1 make MIN_SAMPLES - 1
        const warm = PERIOD_SPAN_TICKS + PERIOD_MIN_SAMPLES - 1;
        for (let l = 0; l < warm; l++) p.see(l, l * 340);
        expect([p.measured, p.ms]).toEqual([false, 300]);
        p.see(warm, warm * 340);
        expect([p.measured, p.ms]).toEqual([true, 340]);
    });

    test('repeats are ignored; a k-label step is k arrivals; a gap restarts the span but keeps the median', () => {
        const p = new TickPeriod(300);
        for (let l = 1; l <= 30; l++) {
            p.see(l, l * 340);
            p.see(l, l * 340 + 50); // a republish within the tick
        }
        expect(p.ms).toBe(340);
        p.see(32, 32 * 340); // 31 never published: arrives with 32
        expect(Math.abs(p.ms - 340)).toBeLessThan(1);
        p.see(5, 99_000); // relaunch: the label went back
        p.see(6, 99_340);
        expect(Math.abs(p.ms - 340)).toBeLessThan(1);
    });
});

describe('tickMonLine', () => {
    test('stable grep-able form, the measured period last', () => {
        const m = summarizeWindow({ ticks: 200, glued: 2, late: 3, gaps: 0, offsets: [0, 1, 2, 150, -150], periods: [340, 340.4, 341, 341.2, 342], firstTick: 1, lastTick: 200 }, 4, Date.UTC(2026, 9, 21, 16, 23, 0, 412), 60, 120);
        expect(tickMonLine(m)).toBe('TICKMON minute=4 at=2026-10-21T16:23:00Z secs=60 ticks=200 glued=2 late=3 p50=1 p90=150 max=150 gaps=0 lateMs=120 periodMs=341');
    });

    test('a window with no offsets prints dashes', () => {
        const m = summarizeWindow({ ticks: 0, glued: 0, late: 0, gaps: 0, offsets: [], periods: [], firstTick: null, lastTick: null }, 0, 0, 60, 120);
        expect(tickMonLine(m)).toContain('ticks=0 glued=0 late=0 p50=- p90=- max=-');
        expect(tickMonLine(m)).toEndWith('periodMs=-');
    });
});

type Pub = { tick: number; inGame: boolean; program?: { runId: number; counters?: Record<string, number> } | null };

/** A source with a hand-driven gateway clock. */
function source() {
    const listeners = new Set<(s: Pub) => void>();
    let receivedAt = 0;
    return {
        onStateUpdate(l: (s: Pub) => void) {
            listeners.add(l);
            return () => listeners.delete(l);
        },
        getStateReceivedAt: () => receivedAt,
        publish(tick: number, at: number, inGame = true, program?: Pub['program']) {
            receivedAt = at;
            for (const l of [...listeners]) l({ tick, inGame, ...(program !== undefined ? { program } : {}) });
        },
        get listeners() {
            return listeners.size;
        },
    };
}

describe('startTickMonitor', () => {
    test('windows open at the first in-world tick, read the gateway receipt time, and skip repeats', () => {
        const src = source();
        let clock = 1_000_000;
        const out: TickMonMinute[] = [];
        const mon = startTickMonitor(src, { ...CFG, emit: m => out.push(m), now: () => clock, timer: false });
        src.publish(7, 1, false); // not in game: ignored
        mon.roll();
        expect(out).toEqual([]); // no window before the first in-world tick
        src.publish(1, 300);
        src.publish(1, 310); // the same label republished after an action: ignored
        src.publish(2, 600);
        src.publish(3, 1050); // late
        src.publish(4, 1050.3); // glued
        clock += 60_000;
        mon.roll();
        src.publish(5, 1500);
        clock += 60_000;
        mon.roll();
        expect(out.map(m => [m.minute, m.secs, m.ticks, m.glued, m.late])).toEqual([[0, 60, 4, 1, 1], [1, 60, 1, 0, 0]]);
        expect(out[0]!.startedAt).toBe(1_000_000);
        mon.stop();
        expect(src.listeners).toBe(0);
    });

    test('stop emits the final window only when it is long enough to mean something', () => {
        const src = source();
        let clock = 0;
        const out: TickMonMinute[] = [];
        const short = startTickMonitor(src, { ...CFG, emit: m => out.push(m), now: () => clock, timer: false });
        src.publish(1, 300);
        clock += 5_000;
        short.stop();
        short.stop();
        expect(out).toEqual([]);
        const long = startTickMonitor(src, { ...CFG, emit: m => out.push(m), now: () => clock, timer: false });
        src.publish(2, 600);
        clock += 30_000;
        long.stop();
        expect(out.map(m => [m.minute, m.secs, m.ticks])).toEqual([[0, 30, 1]]);
    });
});

describe('the run log', () => {
    test('one tickmon row per minute: grep-able line in meta, parseable, listed apart by report', () => {
        const log = TickLog.memory('r1');
        const src = source();
        const session = { name: 'acct', sessionId: 2, sdk: src };
        const mon = startRunTickMonitor(session, log, { tickMs: 300 });
        expect(mon).not.toBeNull();
        for (let i = 1; i <= 5; i++) src.publish(i, i * 300);
        const log0 = console.log;
        const printed: string[] = [];
        console.log = (s: string) => void printed.push(s);
        try {
            mon!.roll();
        } finally {
            console.log = log0;
        }
        mon!.stop();
        expect(log.rows).toHaveLength(1);
        const row = log.rows[0]!;
        expect([row.kind, row.step, row.account, row.sessionId, row.startTick, row.endTick, row.ticks]).toEqual(['tickmon', 'tickmon', 'acct', 2, 1, 5, 5]);
        expect(String(row.meta!.line)).toMatch(/^TICKMON minute=0 at=\S+ secs=0 ticks=5 glued=0 late=0 p50=0 p90=0 max=0 gaps=0 lateMs=120 periodMs=300$/);
        expect(row.meta!.periodMs).toBe(300);
        expect(printed).toEqual([row.meta!.line as string]);
        const rep = report(parseLog(JSON.stringify(row) + '\n'));
        expect([rep.totalTicks, rep.annotations]).toEqual([0, [{ kind: 'tickmon', step: 'tickmon', count: 1, totalTicks: 5 }]]);
    });

    test("the page program's over-budget ticks: summed per minute into the line and the row's meta, absent when none", () => {
        const log = TickLog.memory('r1');
        const src = source();
        const mon = startRunTickMonitor({ name: 'acct', sessionId: 2, sdk: src }, log, { tickMs: 300 });
        const log0 = console.log;
        console.log = () => {};
        try {
            src.publish(1, 300, true, { runId: 4, counters: { overBudget: 0 } });
            src.publish(2, 600, true, { runId: 4, counters: { overBudget: 1 } });
            src.publish(2, 610, true, { runId: 4, counters: { overBudget: 2 } }); // a same-label republication still counts
            src.publish(3, 900, true, { runId: 4, counters: { overBudget: 2 } });
            mon!.roll();
            src.publish(4, 1200, true, { runId: 5, counters: { overBudget: 1 } }); // a new run counts from 0
            mon!.roll();
            src.publish(5, 1500, true, { runId: 5, counters: { overBudget: 1 } });
            src.publish(6, 1800, true, null);
            mon!.roll();
        } finally {
            console.log = log0;
        }
        mon!.stop();
        const lines = log.rows.map(r => String(r.meta!.line));
        expect(lines[0]).toEndWith('periodMs=300 overBudget=2');
        expect(lines[1]).toEndWith(' overBudget=1');
        expect(lines[2]).toEndWith('periodMs=300');
        expect(log.rows.map(r => r.meta!.overBudget)).toEqual([2, 1, undefined]);
    });

    test('OverBudgetCount keeps increments across runs and ignores states without a program', () => {
        const c = new OverBudgetCount();
        c.see(undefined);
        c.see({ runId: 1, counters: {} });
        expect(c.take()).toBe(0);
        c.see({ runId: 1, counters: { overBudget: 3 } }); // first seen already counting: all of it
        c.see({ runId: 1, counters: { overBudget: 3 } });
        expect(c.take()).toBe(3);
        c.see({ runId: 2, counters: { overBudget: 2 } });
        c.see({ runId: 2, counters: { overBudget: 5 } });
        expect(c.take()).toBe(5);
        expect(c.take()).toBe(0);
    });

    test('SPEEDRUN_TICKMON=off turns it off; SPEEDRUN_TICKMON_LATE_MS sets the threshold', () => {
        expect(tickMonitorSetting(undefined, { SPEEDRUN_TICKMON: 'off' })).toBe(false);
        expect(tickMonitorSetting(false, {})).toBe(false);
        expect(tickMonitorSetting(undefined, { SPEEDRUN_TICKMON_LATE_MS: '90' })).toEqual({ lateMs: 90 });
        expect(tickMonitorSetting({ lateMs: 60 }, { SPEEDRUN_TICKMON_LATE_MS: '90' })).toEqual({ lateMs: 60 });
        expect(tickMonitorSetting(undefined, { SPEEDRUN_TICKMON_LATE_MS: 'x' })).toEqual({});
    });
});
