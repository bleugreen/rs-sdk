import { describe, expect, test } from 'bun:test';
import { bankStalls, byMinute, holdRows, loads, placements, rateByLoad, samplesOf, stretches, warmupCurve, windowRate } from './crowding.ts';

const T0 = Date.parse('2026-10-24T06:00:00Z');
const MIN = 60_000;

/** Account lines every 20 s (50 ticks at 400 ms) from minute `from` to `to`, coins at `gpTick` from `idle` minutes on. */
function lines(account: string, o: { from: number; to: number; gpTick: number; idle?: number; stage?: string; target?: number | null; session?: number }) {
    const out: Record<string, unknown>[] = [];
    for (let at = o.from * MIN; at <= o.to * MIN; at += 20_000) {
        const working = Math.max(0, at - (o.from + (o.idle ?? 0)) * MIN);
        out.push({
            kind: 'account',
            t: new Date(T0 + at).toISOString(),
            account,
            method: 'knights',
            stage: o.stage ?? 'method',
            session: o.session ?? 1,
            tick: at / 400,
            coins: { carried: 0, banked: 0, total: Math.round((working / 400) * o.gpTick) },
            pos: [2660, 3305],
            target: o.target === null ? null : { index: o.target ?? 1, x: 2661, z: 3305 }
        });
    }
    return out;
}

describe('crowding', () => {
    test('stretches split at a stage change and at a new session', () => {
        const by = samplesOf([...lines('a01', { from: 0, to: 2, gpTick: 10 }), ...lines('a01', { from: 2.5, to: 3, gpTick: 10, stage: 'to-ardougne' }), ...lines('a01', { from: 3.5, to: 5, gpTick: 10, session: 2 })]);
        expect(stretches(by.get('a01')!).map(s => s.length)).toEqual([7, 5]);
    });

    test("the warm-up curve shows an arrival's idle minutes, then its working rate", () => {
        const by = samplesOf([...lines('a01', { from: 0, to: 20, gpTick: 16, idle: 3 }), ...lines('a02', { from: 1, to: 21, gpTick: 16, idle: 3 })]);
        const c = warmupCurve(by, 6);
        expect(c.map(r => r.n)).toEqual([2, 2, 2, 2, 2, 2]);
        expect(c.slice(0, 3).map(r => r.median)).toEqual([0, 0, 0]);
        expect(c[4]!.median).toBeCloseTo(16, 6);
        expect(byMinute(samplesOf(lines('a03', { from: 0, to: 1, gpTick: 5 })).get('a03')!, 3)).toEqual([5, null, null]);
    });

    test('hold rows: a newcomer that arrived with the hold reads low from the start, its rate past the warm-up', () => {
        const by = samplesOf([...lines('a01', { from: 0, to: 40, gpTick: 16 }), ...lines('a09', { from: 20, to: 40, gpTick: 16, idle: 3 })]);
        const rows = holdRows(by, new Map([['a01', 1], ['a09', 2]]), 2, T0 + 20 * MIN, T0 + 35 * MIN, 5 * MIN);
        const [inc, nw] = rows;
        expect(inc).toMatchObject({ account: 'a01', newcomer: false });
        expect(inc!.fromStart).toBeCloseTo(16, 6);
        expect(nw).toMatchObject({ account: 'a09', newcomer: true, arrivedBeforeHoldMin: 0 });
        expect(nw!.fromStart!).toBeCloseTo(16 * 0.8, 6);
        expect(nw!.warm).toBeCloseTo(16, 6);
        // not admitted by this step: no row
        expect(holdRows(by, new Map([['a01', 1], ['a09', 2]]), 1, T0, T0 + 15 * MIN, 0).map(r => r.account)).toEqual(['a01']);
        expect(windowRate(by.get('a01')!, T0 + 50 * MIN, T0 + 60 * MIN)).toBeNull();
    });

    test('with work counts a hold row and a placement give the rate at the knights and its share of ticks', () => {
        // at the knights 9 ticks in 10 (a bank trip's share), 16 gp a tick there
        const ls = lines('a01', { from: 0, to: 20, gpTick: 16 * 0.9 }).map(l => ({ ...l, workTicks: Math.round(Number(l.tick) * 0.9) }));
        const by = samplesOf(ls);
        const [row] = holdRows(by, new Map([['a01', 1]]), 1, T0 + 5 * MIN, T0 + 20 * MIN, 0);
        expect(row!.warm).toBeCloseTo(14.4, 1);
        expect(row!.knights).toBeCloseTo(16, 1);
        expect(placements(by, 0)[0]!.workShare).toBeCloseTo(0.9, 2);
        // no work counts: null, not a guess
        expect(holdRows(samplesOf(lines('a02', { from: 0, to: 20, gpTick: 16 })), new Map([['a02', 1]]), 1, T0, T0 + 20 * MIN, 0)[0]!.knights).toBeNull();
    });

    test('load counts our bots on the same knight, and rate by load pools past the warm-up', () => {
        // two on knight 1 at 14 gp a tick, one alone on knight 2 at 16, one with no knight in view
        const by = samplesOf([
            ...lines('a01', { from: 0, to: 10, gpTick: 14, target: 1 }),
            ...lines('a02', { from: 0, to: 10, gpTick: 14, target: 1 }),
            ...lines('a03', { from: 0, to: 10, gpTick: 16, target: 2 }),
            ...lines('a04', { from: 0, to: 10, gpTick: 0, target: null })
        ]);
        const l = loads(by);
        expect(l.get(`a01@${T0 + 5 * MIN}`)).toBe(2);
        expect(l.get(`a03@${T0 + 5 * MIN}`)).toBe(1);
        expect(l.get(`a04@${T0 + 5 * MIN}`)).toBe(0);
        const r = rateByLoad(by, 2 * MIN);
        expect(r.map(x => [x.load, x.accounts])).toEqual([
            [0, 1],
            [1, 1],
            [2, 2]
        ]);
        expect(r.find(x => x.load === 2)!.rate).toBeCloseTo(14, 6);
        expect(r.find(x => x.load === 1)!.rate).toBeCloseTo(16, 6);
        const p = placements(by, 2 * MIN);
        expect(p.find(x => x.account === 'a01')).toMatchObject({ none: 0, meanLoad: 2, medianDistance: 1, knights: { '1': 25 } });
        expect(p.find(x => x.account === 'a04')).toMatchObject({ none: 1, meanLoad: null });
    });

    test('a bank stall runs from the deposit to the next coins carried', () => {
        const ls = lines('a01', { from: 0, to: 10, gpTick: 10 }).map((l, i) => ({ ...l, coins: { ...(l.coins as object), carried: i >= 6 && i < 12 ? 0 : 100 } }));
        const s = bankStalls(samplesOf(ls));
        expect(s.map(x => x.minutes)).toEqual([2]);
        // a stall the stretch ends in is not measured
        const open = lines('a02', { from: 0, to: 2, gpTick: 10 }).map((l, i) => ({ ...l, coins: { ...(l.coins as object), carried: i >= 3 ? 0 : 100 } }));
        expect(bankStalls(samplesOf(open))).toEqual([]);
    });

    test('a target older than 30 s does not count towards another login\'s load', () => {
        const by = samplesOf([...lines('a01', { from: 0, to: 1, gpTick: 10, target: 1 }), ...lines('a02', { from: 0, to: 5, gpTick: 10, target: 1 })]);
        const l = loads(by);
        expect(l.get(`a02@${T0 + 40_000}`)).toBe(2);
        expect(l.get(`a02@${T0 + 3 * MIN}`)).toBe(1);
    });
});
