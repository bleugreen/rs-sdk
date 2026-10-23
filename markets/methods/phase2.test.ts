import { describe, expect, test } from 'bun:test';
import { holdings, span } from './trips';
import { chooseRock, RespawnTracker, respawnTicks } from './mine';
import { drifted, priceDrift } from './book';
import { hedgeRow, rankHedge } from './shop-hedge';

const names = (id: number) => ({ 1: 'coins', 2: 'shark', 3: 'rune_pickaxe' })[id] ?? `obj_${id}`;
const costs = new Map([['coins', 1], ['shark', 300], ['rune_pickaxe', 32000]]);

describe('whole-run holdings', () => {
    test('bank, pack and worn slots sum by id', () => {
        const h = holdings(10, [{ id: 1, count: 5 }], [{ id: 1, count: 2 }, { id: 2, count: 3 }], [{ id: 3, count: 1 }]);
        expect(h.tick).toBe(10);
        expect(Object.fromEntries(h.items.map(i => [i.id, i.count]))).toEqual({ 1: 7, 2: 3, 3: 1 });
    });
    test('food carried out and not eaten nets to zero; only what was eaten is charged', () => {
        // first bank visit: 1000 sharks banked less 20 withdrawn, 20 in the pack, pickaxe worn
        const a = holdings(100, [{ id: 2, count: 980 }], [{ id: 2, count: 20 }], [{ id: 3, count: 1 }]);
        // stop mid-trip: bank unchanged, 6 sharks eaten, 30,000 coins carried, pickaxe now in the pack
        const b = holdings(2500, [{ id: 2, count: 980 }], [{ id: 2, count: 14 }, { id: 1, count: 30000 }, { id: 3, count: 1 }]);
        const t = span(a, b, names, costs);
        expect(t.ticks).toBe(2400);
        expect(Object.fromEntries(t.delta)).toEqual({ shark: -6, coins: 30000 });
        expect(t.board).toBe(30000 - 6 * 300);
    });
    test('a span is never merged, however short', () => {
        const t = span(holdings(0, [{ id: 1, count: 1 }]), holdings(5, [{ id: 1, count: 4 }]), names, costs);
        expect(t.ticks).toBe(5);
        expect(t.board).toBe(3);
    });
});

describe('mining', () => {
    test('respawn scales with player count as player_count.rs2 does', () => {
        expect(respawnTicks(200, 1400)).toBe(130);
        expect(respawnTicks(20, 1400)).toBe(13);
        expect(respawnTicks(2400, 1400)).toBe(1560);
        expect(respawnTicks(200, 5000)).toBe(100); // capped at 2,000 players
        expect(respawnTicks(200, 1)).toBe(199);
    });
    const site = { rocks: [2111], box: { x0: 0, x1: 10, z0: 0, z1: 10 } };
    const loc = (id: number, x: number, z: number, distance: number, reachable?: boolean) => ({ id, x, z, distance, reachable });
    test('nearest live rock of the site', () => {
        const r = chooseRock([loc(2111, 5, 5, 4), loc(2111, 2, 2, 2), loc(9999, 1, 1, 1), loc(2111, 20, 20, 0)], site, []);
        expect(r).toMatchObject({ x: 2, z: 2 });
    });
    test('a rock with another player beside it loses to a farther free one', () => {
        const r = chooseRock([loc(2111, 2, 2, 2), loc(2111, 8, 8, 6)], site, [{ x: 3, z: 2 }]);
        expect(r).toMatchObject({ x: 8, z: 8 });
    });
    test('unreachable rocks and an empty site give null', () => {
        expect(chooseRock([loc(2111, 2, 2, 2, false)], site, [])).toBeNull();
        expect(chooseRock([], site, [])).toBeNull();
    });
    test('respawn tracker records depleted-to-live intervals seen at both ends', () => {
        const t = new RespawnTracker();
        const all = () => true;
        t.update(0, new Set(['1,1', '2,2']), all);
        t.update(5, new Set(['2,2']), all); // 1,1 depleted at 5
        t.update(6, new Set([]), all); // 2,2 depleted at 6
        t.update(135, new Set(['1,1']), all);
        t.update(136, new Set(['1,1', '2,2']), all);
        expect(t.samples).toEqual([130, 130]);
        expect(t.depletions).toBe(2);
    });
    test('an interval with an unseen end is dropped', () => {
        const t = new RespawnTracker();
        t.update(0, new Set(['1,1']), () => true);
        t.update(5, new Set(), () => false); // walked away
        t.update(50, new Set(), () => true); // back, still depleted: start unknown
        t.update(135, new Set(['1,1']), () => true);
        expect(t.samples).toEqual([]);
    });
});

describe('price drift', () => {
    const day = 86_400_000;
    test('a price rising 2% a day is fitted as 2% a day', () => {
        const b = Array.from({ length: 10 }, (_, i) => ({ time: i * day, volume: 100, gross: 100 * 1000 * 1.02 ** i }));
        expect(priceDrift(b)!.perDay).toBeCloseTo(0.02, 6);
    });
    test('flat and short series', () => {
        const b = Array.from({ length: 5 }, (_, i) => ({ time: i * day, volume: 10, gross: 25000 }));
        expect(priceDrift(b)!.perDay).toBeCloseTo(0, 9);
        expect(priceDrift(b.slice(0, 3))).toBeNull();
        expect(priceDrift(b, 3 * day, 2)!.buckets).toBe(2);
    });
    test('drifted compounds over the horizon', () => {
        expect(drifted(1000, 0.01, 24)).toBeCloseTo(1010, 6);
        expect(drifted(1000, 0.01, 72)).toBeCloseTo(1030.301, 3);
        expect(drifted(1000, 0.01, 6)).toBeCloseTo(1000 * 1.01 ** 0.25, 6);
    });
});

describe('shop stock against the GE', () => {
    const line = { shop: 'Magic Guild', obj: 'bloodrune', cost: 50, sell: 1000, delta: 10, base: 1000, rate: 300, stock: 1000 };
    test('a full shelf: restock at base price into a deep bid, plus the one-off', () => {
        const r = hedgeRow(line, { bid: 1301, bidQuantity: 17120, ask: 1447, volume7d: 14591, vwap: 745 }, 400)!;
        expect(r.outlet).toBe('bid');
        expect(r.geNet).toBe(1301 - 65);
        expect(r.price).toBe(50);
        expect(r.restockPerHour).toBe(30);
        expect(r.coinsPerHour).toBe((1236 - 50) * 30);
        expect(r.oneOff).toBeGreaterThan(0);
    });
    test('a drained shelf restocks at the drained price', () => {
        const r = hedgeRow({ ...line, stock: 0 }, { bid: 1301, bidQuantity: 17120, ask: null, volume7d: 0, vwap: null }, 400)!;
        expect(r.price).toBe(300); // six times cost at the -5000 clamp
        expect(r.coinsPerHour).toBe((1236 - 300) * 30);
        expect(r.oneOff).toBe(0);
    });
    test('without a bid the 7-day flow is the outlet and caps the units', () => {
        const r = hedgeRow({ ...line, rate: 10 }, { bid: null, bidQuantity: 0, ask: 450, volume7d: 168 * 50, vwap: 440 }, 400)!;
        expect(r.outlet).toBe('flow');
        expect(r.outletPerHour).toBe(50);
        expect(r.coinsPerHour).toBe((440 - 22 - 50) * 50);
        expect(hedgeRow(line, { bid: null, bidQuantity: 0, ask: null, volume7d: 0, vwap: null }, 400)).toBeNull();
    });
    test('rank drops lines with nothing to gain', () => {
        const good = hedgeRow(line, { bid: 1301, bidQuantity: 100, ask: null, volume7d: 0, vwap: null }, 400)!;
        const bad = hedgeRow({ ...line, cost: 5000 }, { bid: 100, bidQuantity: 100, ask: null, volume7d: 0, vwap: null }, 400)!;
        expect(rankHedge([bad, good])).toEqual([good]);
    });
});
