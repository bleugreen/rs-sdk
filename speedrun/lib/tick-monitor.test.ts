import { describe, expect, test } from 'bun:test';
import { parseLog, report, TickLog } from './ticks';
import { startRunTickMonitor, startTickMonitor, TickCadence, type TickCadenceConfig, tickMonitorSetting, tickMonLine, type TickMonMinute, summarizeWindow } from './tick-monitor';

const CFG: TickCadenceConfig = { tickMs: 300, lateMs: 120, gluedMs: 5, gapTicks: 17 };

/** Feed (label, ms) arrivals and take the counts. */
function classify(arrivals: Array<[number, number]>, cfg: TickCadenceConfig = CFG) {
    const c = new TickCadence(cfg);
    for (const [l, t] of arrivals) c.arrive(l, t);
    return c.take();
}

/** Labels 1..n on a 300 ms cadence with a small deterministic jitter (never over 10 ms). */
const clean = (n: number): Array<[number, number]> => Array.from({ length: n }, (_, i) => [i + 1, (i + 1) * 300 + ((i * 7) % 11) - 5] as [number, number]);

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

describe('tickMonLine', () => {
    test('stable grep-able form', () => {
        const m = summarizeWindow({ ticks: 200, glued: 2, late: 3, gaps: 0, offsets: [0, 1, 2, 150, -150], firstTick: 1, lastTick: 200 }, 4, Date.UTC(2026, 9, 21, 16, 23, 0, 412), 60, 120);
        expect(tickMonLine(m)).toBe('TICKMON minute=4 at=2026-10-21T16:23:00Z secs=60 ticks=200 glued=2 late=3 p50=1 p90=150 max=150 gaps=0 lateMs=120');
    });

    test('a window with no offsets prints dashes', () => {
        const m = summarizeWindow({ ticks: 0, glued: 0, late: 0, gaps: 0, offsets: [], firstTick: null, lastTick: null }, 0, 0, 60, 120);
        expect(tickMonLine(m)).toContain('ticks=0 glued=0 late=0 p50=- p90=- max=-');
    });
});

/** A source with a hand-driven gateway clock. */
function source() {
    const listeners = new Set<(s: { tick: number; inGame: boolean }) => void>();
    let receivedAt = 0;
    return {
        onStateUpdate(l: (s: { tick: number; inGame: boolean }) => void) {
            listeners.add(l);
            return () => listeners.delete(l);
        },
        getStateReceivedAt: () => receivedAt,
        publish(tick: number, at: number, inGame = true) {
            receivedAt = at;
            for (const l of [...listeners]) l({ tick, inGame });
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
        expect(String(row.meta!.line)).toMatch(/^TICKMON minute=0 at=\S+ secs=0 ticks=5 glued=0 late=0 p50=0 p90=0 max=0 gaps=0 lateMs=120$/);
        expect(printed).toEqual([row.meta!.line as string]);
        const rep = report(parseLog(JSON.stringify(row) + '\n'));
        expect([rep.totalTicks, rep.annotations]).toEqual([0, [{ kind: 'tickmon', step: 'tickmon', count: 1, totalTicks: 5 }]]);
    });

    test('SPEEDRUN_TICKMON=off turns it off; SPEEDRUN_TICKMON_LATE_MS sets the threshold', () => {
        expect(tickMonitorSetting(undefined, { SPEEDRUN_TICKMON: 'off' })).toBe(false);
        expect(tickMonitorSetting(false, {})).toBe(false);
        expect(tickMonitorSetting(undefined, { SPEEDRUN_TICKMON_LATE_MS: '90' })).toEqual({ lateMs: 90 });
        expect(tickMonitorSetting({ lateMs: 60 }, { SPEEDRUN_TICKMON_LATE_MS: '90' })).toEqual({ lateMs: 60 });
        expect(tickMonitorSetting(undefined, { SPEEDRUN_TICKMON_LATE_MS: 'x' })).toEqual({});
    });
});
