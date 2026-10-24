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

import { hpCollisions, hpSummary } from './report.ts';

describe('Hitpoints in the report', () => {
    const ev = (t: number, account: string, message: string, index: number) => ({ t: new Date(t).toISOString(), account, message, index });
    test('a second account on a live npc within the window is a collision; after a drop, a respawn or another npc it is not', () => {
        const r = hpCollisions([
            ev(0, 'a01', 'hp-train: target', 7),
            ev(800, 'a02', 'hp-train: target', 7), // collision
            ev(1_000, 'a03', 'hp-train: target', 8),
            ev(6_000, 'a03', 'hp-train: dropped target', 8),
            ev(7_000, 'a04', 'hp-train: target', 8), // after a03 dropped it
            ev(40_000, 'a05', 'hp-train: target', 7) // the cow has respawned
        ]);
        expect(r.targets).toBe(5);
        expect(r.collisions).toEqual([{ index: 7, accounts: ['a01', 'a02'], gapMs: 800, at: new Date(800).toISOString() }]);
    });
    test('times from login, per site, and the queue', () => {
        const s = hpSummary([
            { kind: 'hp-site', account: 'a01', site: 'cows', queuedMinutes: 0 },
            { kind: 'hp-site', account: 'a03', site: 'cows', queuedMinutes: 12.5 },
            { kind: 'hp', account: 'a01', site: 'cows', minutesFromLogin: 20, minutesTraining: 17 },
            { kind: 'hp', account: 'a02', site: 'farm', minutesFromLogin: 24, minutesTraining: 19 },
            { kind: 'hp', account: 'a03', site: 'cows', minutesFromLogin: 40, minutesTraining: 22 }
        ]);
        expect(s).toEqual({
            n: 3,
            within: 2,
            withinMinutes: 25,
            minutesFromLogin: { min: 20, median: 24, max: 40 },
            bySite: { cows: { n: 2, medianFromLogin: 30, medianTraining: 19.5 }, farm: { n: 1, medianFromLogin: 24, medianTraining: 19 } },
            queued: 1,
            longestQueueMinutes: 12.5
        });
        expect(hpSummary([])).toBeNull();
    });
});
