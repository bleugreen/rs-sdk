import { describe, expect, test } from 'bun:test';
import { bankDelta, boardOf, coinsOf, summarize, trips, type BankSnap } from './trips';
import { parseObjCosts } from './value';

const names: Record<number, string> = { 995: 'coins', 385: 'shark', 554: 'firerune' };
const nameOf = (id: number) => names[id] ?? `obj_${id}`;
const costs = parseObjCosts(['[coins]\ncost=1\n[shark]\ncost=300\n[firerune]\ncost=4']);

describe('bank deltas', () => {
    test('gains and spends by name, zeros dropped', () => {
        const a: BankSnap = { tick: 0, items: [{ id: 995, count: 100 }, { id: 385, count: 50 }, { id: 554, count: 9 }] };
        const b: BankSnap = { tick: 10, items: [{ id: 995, count: 2100 }, { id: 385, count: 23 }, { id: 554, count: 9 }] };
        const d = bankDelta(a, b, nameOf);
        expect(Object.fromEntries(d)).toEqual({ coins: 2000, shark: -27 });
        expect(boardOf(d, costs)).toBe(2000 - 27 * 300);
    });
    test('an item that leaves the bank entirely counts as spent', () => {
        const d = bankDelta({ tick: 0, items: [{ id: 385, count: 3 }] }, { tick: 1, items: [] }, nameOf);
        expect(d.get('shark')).toBe(-3);
    });
});

describe('trips', () => {
    const snaps: BankSnap[] = [
        { tick: 100, items: [{ id: 995, count: 0 }, { id: 385, count: 100 }] },
        { tick: 100, items: [{ id: 995, count: 0 }, { id: 385, count: 73 }] },
        { tick: 1000, items: [{ id: 995, count: 15000 }, { id: 385, count: 46 }] },
        { tick: 2800, items: [{ id: 995, count: 45000 }, { id: 385, count: 19 }] }
    ];
    test('same-tick snapshots collapse to the last, and each pair is a trip', () => {
        const t = trips(snaps, nameOf, costs);
        expect(t.map(x => x.ticks)).toEqual([900, 1800]);
        expect(t.map(x => x.board)).toEqual([15000 - 27 * 300, 30000 - 27 * 300]);
    });
    test('reports a few ticks apart are one visit (deposit, then withdraw)', () => {
        const visits: BankSnap[] = [
            { tick: 0, items: [] },
            { tick: 400, items: [{ id: 995, count: 24 }] },
            { tick: 404, items: [{ id: 995, count: 30 }] },
            { tick: 800, items: [{ id: 995, count: 60 }] }
        ];
        expect(trips(visits, nameOf, costs).map(x => [x.ticks, x.board])).toEqual([[404, 30], [396, 30]]);
        expect(trips(visits, nameOf, costs, 0)).toHaveLength(3);
    });
    test('summary: board and coins per hour, per trip spread', () => {
        const s = summarize(trips(snaps, nameOf, costs), 400, { shark: { buy: 800 } });
        expect(s.trips).toBe(2);
        expect(s.ticks).toBe(2700);
        // 45,000 coins less 54 sharks at 300 board, over 2,700 ticks (0.3 h)
        expect(s.boardPerHour).toBeCloseTo((45000 - 54 * 300) / 0.3, 6);
        expect(s.coinsPerHour).toBeCloseTo((45000 - 54 * 800) / 0.3, 6);
        expect(s.perHour.shark).toBeCloseTo(-180, 6);
        expect(s.boardPerHourByTrip.n).toBe(2);
    });
});

describe('coins at the outlet', () => {
    test('gains at sell, spends at buy, notes as their item, unknowns listed', () => {
        const d = new Map([['coins', 10], ['cert_shark', 2], ['firerune', -5], ['mystery', 1]]);
        expect(coinsOf(d, { shark: { sell: 700, buy: 900 }, firerune: { sell: 2 } })).toEqual({ coins: 10 + 1400 - 10, unpriced: ['mystery'] });
    });
});
