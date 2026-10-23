import { describe, expect, test } from 'bun:test';
import { report } from './report.ts';

const line = (account: string, method: string, tick: number, coins: number, store: number | null, stage = 'method', session = 1) => ({
    kind: 'account',
    account,
    method,
    stage,
    session,
    tick,
    coins: { carried: 0, banked: coins, total: coins },
    bank: { seenTick: store === null ? null : tick, store, book: null, unpriced: [], unknownCost: [] }
});

describe('report', () => {
    test('rates per method from the method stretch, and the ledger events', () => {
        const lines = [
            line('a01', 'knights', 0, 999, 999, 'hp'),
            line('a01', 'knights', 100, 0, 0),
            line('a01', 'knights', 1000, 9_000, 9_000),
            line('a02', 'knights', 100, 0, 0),
            line('a02', 'knights', 1000, 18_000, 18_000),
            line('a03', 'iron', 0, 0, null),
            line('a03', 'iron', 900, 0, null),
            { kind: 'ramp', step: 1, action: 'next' },
            { kind: 'redirect', account: 'a04', to: 'guards' },
            { kind: 'sale', result: 'filled' },
            { kind: 'totals', final: true },
            { kind: 'end', clean: true }
        ];
        const r = report(lines, 400);
        // 9,000 coins over 900 ticks is 10 a tick: 90,000 an hour at 400 ms (9,000 ticks an hour)
        expect(r.rates.find(x => x.account === 'a01')!.coinsPerHour).toBe(90_000);
        expect(r.byMethod.knights).toEqual({ n: 2, median: 135_000, min: 90_000, max: 180_000, boardMedian: 135_000 });
        expect(r.byMethod.iron).toEqual({ n: 1, median: 0, min: 0, max: 0, boardMedian: null });
        expect(r.ramp).toHaveLength(1);
        expect(r.redirects).toHaveLength(1);
        expect(r.errands).toHaveLength(1);
        expect(r.end).toEqual({ kind: 'end', clean: true });
    });
});
