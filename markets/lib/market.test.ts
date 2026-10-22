import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Gentle } from './demo.ts';
import { bidPool, bookDepth, DemoMarket, historyMoves, historyTotals, realisable, stackOverVolume, type Bucket } from './market.ts';

const fixture = (name: string) => readFileSync(join(import.meta.dir, 'fixtures', name), 'utf8');
const realFetch = globalThis.fetch;
afterEach(() => {
    globalThis.fetch = realFetch;
});

/** Serves recorded market replies by path; MarketClient calls the global fetch. */
function serve(routes: Record<string, () => Response>, asked: string[] = []) {
    globalThis.fetch = (async (input: string | URL) => {
        const url = new URL(String(input));
        asked.push(url.pathname + url.search);
        const route = routes[url.pathname];
        return route ? route() : new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
    }) as unknown as typeof fetch;
    return asked;
}

const gate = () => new Gentle({ minIntervalMs: 0, sleep: async () => {} });

describe('DemoMarket (recorded replies)', () => {
    test('reads status, the book and one quote from the game HTTP origin', async () => {
        const asked = serve({
            '/api/market/status': () => new Response(fixture('market-status.json')),
            '/api/market/items': () => new Response(fixture('market-items.json')),
            '/api/market/items/556': () => new Response(fixture('market-item-556.json'))
        });
        const m = new DemoMarket(gate());
        expect(await m.status()).toEqual({ enabled: true });
        const book = await m.items('', { sort: 'buyValue', limit: 100 });
        expect(book.items.length).toBeGreaterThan(50);
        expect(book.summary.totalItems).toBe(1443);
        const air = await m.item(556);
        expect(air).toMatchObject({ name: 'Air rune', basePrice: 4, lastPrice: 21 });
        expect(asked).toEqual(['/api/market/status', '/api/market/items?q=&sort=buyValue&limit=100', '/api/market/items/556']);
    });

    test('does not retry a 404', async () => {
        const asked = serve({});
        await expect(new DemoMarket(gate()).item(99999)).rejects.toThrow('Market API 404');
        expect(asked).toHaveLength(1);
    });

    test('find matches the exact item name', async () => {
        serve({ '/api/market/items': () => new Response(fixture('market-items.json')) });
        expect((await new DemoMarket(gate()).find('uncut dragonstone'))?.id).toBe(1631);
        expect(await new DemoMarket(gate()).find('uncut')).toBeNull();
    });
});

test('bidPool totals the open bid side of a book page', () => {
    const book = JSON.parse(fixture('market-items.json'));
    const pool = bidPool(book);
    expect(pool.items).toBe(book.items.filter((i: { buyQuantity: number }) => i.buyQuantity > 0).length);
    expect(pool.value).toBe(book.items.reduce((s: number, i: { buyValue: number }) => s + i.buyValue, 0));
    expect(pool.value / 1e6).toBeCloseTo(1108.5, 0);
});

describe('book depth', () => {
    const air = JSON.parse(fixture('market-item-556.json'));

    test('totals and means per side', () => {
        const d = bookDepth(air);
        expect(d).toMatchObject({ bestBid: 5, bestAsk: 21, bidQuantity: 101_281, bidValue: 407_121, askQuantity: 154_231, basePrice: 4 });
        expect(d.meanBid).toBeCloseTo(4.0197, 3);
        expect(d.meanAsk).toBeCloseTo(21.0, 1);
    });

    test('realisable value fills the bids and leaves the rest unsold', () => {
        expect(realisable(air, 1_923_311_135)).toEqual({ units: 101_281, low: 407_121, high: 407_121, unsold: 1_923_311_135 - 101_281 });
        const part = realisable(air, 1000);
        expect(part.units).toBe(1000);
        expect(part.low).toBeCloseTo(4019.7, 0);
        expect(part.high).toBe(5000);
        expect(realisable({ ...air, buyQuantity: 0, buyValue: 0, bid: null }, 10)).toEqual({ units: 0, low: 0, high: 0, unsold: 10 });
    });
});

describe('history arithmetic', () => {
    const history = JSON.parse(fixture('market-history-556.json'));

    test('totals a recorded week of air rune trades', () => {
        const t = historyTotals(history);
        expect(t.buckets).toBe(113);
        expect(t.volume).toBe(history.history.reduce((s: number, b: Bucket) => s + b.volume, 0));
        expect(t.low).toBeLessThanOrEqual(t.vwap!);
        expect(t.high).toBeGreaterThanOrEqual(t.vwap!);
        // nickai3's 1.92B air runes are thousands of times everything traded that week.
        expect(stackOverVolume(1_923_311_135, history)).toBeGreaterThan(1000);
    });

    test('finds a volume spike and a price step', () => {
        const b = (time: number, volume: number, vwap: number): Bucket => ({ time, volume, gross: volume * vwap, tax: 0, low: vwap, high: vwap, vwap, trades: 1 });
        const moves = historyMoves({ history: [b(1, 2000, 10), b(2, 2000, 10), b(3, 50_000, 10), b(4, 2000, 15), b(5, 2000, 15)] });
        expect(moves).toEqual([
            { time: 3, kind: 'volume', volume: 50_000, vwap: 10, ref: 2000 },
            { time: 4, kind: 'price', volume: 2000, vwap: 15, ref: 10 }
        ]);
        expect(historyMoves({ history: [] })).toEqual([]);
        expect(stackOverVolume(5, { history: [] })).toBe(Number.POSITIVE_INFINITY);
    });
});
