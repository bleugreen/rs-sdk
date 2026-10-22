import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { liveBounties, boardConfig } from './ambassador/bounty';
import { OFFERS_FILE, offersSnapshot, parseOffers, pruneFills, readOffersFile, writeOffersFile, type OfferInput } from './ge-offers';

const T0 = Date.parse('2026-10-21T12:00:00Z');
const TALISMAN = 1444;
const offer = (over: Partial<OfferInput> = {}): OfferInput => ({ id: 7, item: TALISMAN, side: 'buy', state: 'open', price: 30_000, quantity: 6, remaining: 5, filled: 1, ...over });

describe('the offers snapshot', () => {
    test("lists the bidder's offers for its own lines, by name, with the account and time", () => {
        const s = offersSnapshot('cairn_h61', [offer(), offer({ id: 8, item: 999 })], new Map([[TALISMAN, 'Nature talisman']]), [], T0);
        expect(s).toEqual({
            version: 1,
            account: 'cairn_h61',
            writtenAt: '2026-10-21T12:00:00.000Z',
            offers: [{ id: 7, item: 'Nature talisman', itemId: TALISMAN, side: 'buy', state: 'open', price: 30_000, quantity: 6, remaining: 5, filled: 1 }],
            fills: []
        });
    });

    test('keeps a week of fills, at most 200', () => {
        const old = { item: 'Nature talisman', n: 1, at: new Date(T0 - 8 * 86400_000).toISOString() };
        const recent = Array.from({ length: 250 }, (_, i) => ({ item: 'Nature talisman', n: 1, at: new Date(T0 - (250 - i) * 60_000).toISOString() }));
        const kept = pruneFills([old, ...recent], T0);
        expect(kept).toHaveLength(OFFERS_FILE.fillsKept);
        expect(kept.at(-1)).toEqual(recent.at(-1)!);
    });

    test('written whole, read back, and understood by the bounty board', () => {
        const dir = mkdtempSync(join(tmpdir(), 'ge-offers-'));
        const path = join(dir, 'sub', 'ge-offers.json');
        const fills = [{ item: 'Nature talisman', n: 1, at: new Date(T0 - 60_000).toISOString() }];
        writeOffersFile(path, offersSnapshot('cairn_h61', [offer()], new Map([[TALISMAN, 'Nature talisman']]), fills, T0));
        expect(readdirSync(join(dir, 'sub'))).toEqual(['ge-offers.json']);
        const back = readOffersFile(path);
        expect(back?.fills).toEqual(fills);
        const cfg = boardConfig({ bidder: 'cairn_h61', offersFile: path, list: [{ item: 'Nature talisman', quantity: 6, maxPrice: 30_000 }] });
        if (!cfg.ok) throw new Error(cfg.error);
        expect(liveBounties(cfg.value, back, T0 + 60_000).map(b => [b.item, b.price, b.quantity])).toEqual([['Nature talisman', 30_000, 5]]);
    });

    test('a missing, torn or malformed file is no offers', () => {
        const dir = mkdtempSync(join(tmpdir(), 'ge-offers-'));
        expect(readOffersFile(join(dir, 'none.json'))).toBeNull();
        writeFileSync(join(dir, 'torn.json'), '{"version":1,"acc');
        expect(readOffersFile(join(dir, 'torn.json'))).toBeNull();
        expect(parseOffers({ version: 2, account: 'a', writtenAt: new Date(T0).toISOString(), offers: [], fills: [] })).toBeNull();
        expect(parseOffers({ version: 1, account: 'a', writtenAt: 'yesterday', offers: [], fills: [] })).toBeNull();
        // Bad entries are dropped, good ones kept.
        const s = parseOffers({ version: 1, account: 'a', writtenAt: new Date(T0).toISOString(), offers: [{ id: 1, item: 'X', price: -5 }, { ...offer(), item: 'Nature talisman', itemId: TALISMAN }], fills: [{ item: 'X', n: 0, at: 'x' }] });
        expect(s?.offers.map(o => o.item)).toEqual(['Nature talisman']);
        expect(s?.fills).toEqual([]);
    });
});
