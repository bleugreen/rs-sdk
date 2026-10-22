import { describe, expect, test } from 'bun:test';
import { FakeSdk, baseState } from './fake-sdk';
import { formatReport, measure, parseLog, report, TickLog, tickSpan, type TickRow } from './ticks';
import { tickMs } from './wait';

const row = (step: string, ticks: number, extra: Partial<TickRow> = {}): TickRow => ({
    v: 1, runId: 'r', account: 'a', sessionId: 1, step, startTick: 0, endTick: ticks, ticks, wallMs: 0, ok: true, tickMs: 300, at: '', ...extra,
});

describe('report', () => {
    test('aggregates per step in first-seen order with a grand total', () => {
        const rep = report([row('bank', 5), row('trade', 12), row('bank', 7, { ok: false })]);
        expect(rep.steps).toEqual([
            { step: 'bank', count: 2, failures: 1, totalTicks: 12, mean: 6, min: 5, max: 7, lowerBound: false },
            { step: 'trade', count: 1, failures: 0, totalTicks: 12, mean: 12, min: 12, max: 12, lowerBound: false },
        ]);
        expect(rep.totalTicks).toBe(24);
        expect(rep.lowerBound).toBe(false);
    });

    test('a row that crossed a client relaunch marks its step and the total as lower bounds', () => {
        const rep = report([row('x', 3), row('x', 40, { crossedSession: true })]);
        expect(rep.steps[0]!.lowerBound).toBe(true);
        expect(rep.lowerBound).toBe(true);
        expect(formatReport(rep)).toContain('x (>=)');
    });

    test('annotation rows are listed apart and never summed into the total', () => {
        const rep = report([
            row('(session)', 40, { kind: 'session' }),
            row('S00', 6),
            row('(boundary)', 1),
            row('(program)', 30, { kind: 'program' }),
            row('(program)', 12, { kind: 'program' }),
        ]);
        expect(rep.steps.map(s => s.step)).toEqual(['S00', '(boundary)']);
        expect(rep.totalTicks).toBe(7);
        expect(rep.annotations).toEqual([
            { kind: 'session', step: '(session)', count: 1, totalTicks: 40 },
            { kind: 'program', step: '(program)', count: 2, totalTicks: 42 },
        ]);
        expect(formatReport(rep)).toContain('annotations (not in TOTAL)');
    });

    test('parseLog skips blank lines and other versions', () => {
        const text = JSON.stringify(row('a', 1)) + '\n\n' + JSON.stringify({ ...row('b', 2), v: 2 }) + '\n';
        expect(parseLog(text).map(r => r.step)).toEqual(['a']);
    });
});

describe('tickSpan', () => {
    test('same session: plain difference', () => {
        expect(tickSpan(100, 112, 1, 1)).toEqual({ ticks: 12, crossedSession: false });
    });
    test('relaunch: the new session counter is the lower bound', () => {
        expect(tickSpan(500, 30, 1, 2)).toEqual({ ticks: 30, crossedSession: true });
        expect(tickSpan(500, 30, 1, 1)).toEqual({ ticks: 30, crossedSession: true });
    });
});

describe('measure', () => {
    test('logs ticks from the state clock and passes the result through', async () => {
        const sdk = new FakeSdk(baseState({ tick: 10 }));
        const log = TickLog.memory('run');
        const out = await measure(log, { sdk, name: 'acct', sessionId: 4 }, 'step', async () => {
            sdk.tick();
            sdk.tick();
            return { ok: true, n: 3 };
        }, { k: 1 });
        expect(out).toEqual({ ok: true, n: 3 });
        expect(log.rows[0]).toMatchObject({ runId: 'run', account: 'acct', sessionId: 4, step: 'step', startTick: 10, endTick: 12, ticks: 2, ok: true, meta: { k: 1 } });
    });

    test('a thrown error and an {ok:false} result are both logged as not ok', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1 }));
        const log = TickLog.memory();
        await expect(measure(log, sdk as never, 'boom', async () => { throw new Error('bad'); })).rejects.toThrow('bad');
        await measure(log, sdk as never, 'soft', async () => ({ ok: false, reason: 'timeout' }));
        expect(log.rows.map(r => [r.step, r.ok, r.error])).toEqual([['boom', false, 'bad'], ['soft', false, 'timeout']]);
    });
});

test('tickMs reads SPEEDRUN_TICK_MS, then NODE_TICKRATE, else DEMO_TICK_MS (400)', () => {
    expect(tickMs({ SPEEDRUN_TICK_MS: '100', NODE_TICKRATE: '600' })).toBe(100);
    expect(tickMs({ NODE_TICKRATE: '600' })).toBe(600);
    expect(tickMs({})).toBe(400);
});
