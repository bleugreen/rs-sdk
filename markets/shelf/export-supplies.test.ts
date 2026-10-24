import { describe, expect, test } from 'bun:test';
import { mergeSupplies, readingsToEntries, supplyEntry } from './export-supplies';

const item = {
    kind: 'item' as const,
    utc: '2026-10-23T09:12:00.000Z',
    stop: 'aubury',
    read: 1,
    shopTitle: "Aubury's Rune Shop.",
    inv: 'runeshop',
    slot: 7,
    itemId: 560,
    name: 'Death rune',
    obj: 'deathrune',
    count: 979,
    stockBase: 1000,
    inBaseConfig: true,
    baseCost: 30,
    buyPrice: 30,
    sellPrice: 16,
    valuePrice: 36,
    computedBuyPrice: 36,
    computedSellPrice: 22,
    tick: 900
};

describe('supplies export', () => {
    test('the documented shape, priced by the server Value, not the SDK buyPrice', () => {
        expect(supplyEntry(item)).toEqual({ inv: 'runeshop', obj: 'deathrune', count: 979, price: 36, at: '2026-10-23T09:12:00.000Z' });
        expect(supplyEntry({ ...item, valuePrice: null })).toMatchObject({ price: 36 });
        expect(supplyEntry({ ...item, valuePrice: null, computedBuyPrice: null })).toMatchObject({ price: 30 });
    });

    test('lines without content names are reported, not exported', () => {
        expect(supplyEntry({ ...item, obj: null })).toMatch(/no content inv or obj/);
        const text = [JSON.stringify({ kind: 'shop', stop: 'aubury' }), JSON.stringify(item), JSON.stringify({ ...item, obj: null, name: 'Mystery' }), ''].join('\n');
        const { entries, dropped } = readingsToEntries(text);
        expect(entries).toHaveLength(1);
        expect(dropped).toEqual(['aubury/Mystery: no content inv or obj name']);
    });

    test('merge: newest reading per inv and obj wins, other entries kept in place', () => {
        const existing = [
            { inv: 'runeshop', obj: 'airrune', count: 950, price: 4, at: '2026-10-23T09:00:00Z' },
            { inv: 'runeshop', obj: 'deathrune', count: 1000, price: 30, at: '2026-10-23T09:00:00Z' }
        ];
        const newer = { inv: 'runeshop', obj: 'deathrune', count: 979, price: 36, at: '2026-10-23T09:12:00Z' };
        const older = { ...newer, count: 990, price: 33, at: '2026-10-23T08:00:00Z' };
        const added = { inv: 'magicshop', obj: 'deathrune', count: 1000, price: 30, at: '2026-10-23T09:13:00Z' };
        expect(mergeSupplies(existing, [newer, older, added])).toEqual([existing[0]!, newer, added]);
        expect(existing[1]!.price).toBe(30); // inputs untouched
    });
});
