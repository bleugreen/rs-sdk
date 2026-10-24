import { describe, expect, test } from 'bun:test';
import type { MarketQuote } from '../lib/market.ts';
import { buyDecision, saleDecision, sharkSupply } from './exchange.ts';
import { netOfFee } from './ledger.ts';

const book = (o: Partial<MarketQuote>): MarketQuote => ({ id: 1, name: '', basePrice: 0, item: 1, bid: null, ask: null, buyQuantity: 0, buyValue: 0, sellQuantity: 0, sellValue: 0, ...o }) as MarketQuote;
// the iron ore bid at 08:45Z; the shark asks at 12:0xZ (phase2.md, rs/544's brief)
const iron = book({ id: 440, bid: 110, buyQuantity: 993_853, buyValue: 79_508_240 });
const shark = book({ id: 385, ask: 507, sellQuantity: 2_003_290, sellValue: 1_403_983_415 });

describe('saleDecision', () => {
    test('sells at the floor, capped per call', () => {
        const d = saleDecision(iron, { held: 27_000, floor: 80, cap: 500 });
        expect(d).toMatchObject({ sell: true, quantity: 500, price: 80, expected: { low: netOfFee(500 * 80), high: netOfFee(500 * 110) } });
    });
    test('the cap never passes the hard cap in code', () => {
        expect(saleDecision(iron, { held: 1e6, floor: 80, cap: 1e6 })).toMatchObject({ quantity: 5_000 });
    });
    test('never more than is held or than the bids take', () => {
        expect(saleDecision(iron, { held: 12, floor: 80, cap: 500 })).toMatchObject({ quantity: 12 });
        expect(saleDecision(book({ bid: 90, buyQuantity: 7, buyValue: 630 }), { held: 100, floor: 80, cap: 500 })).toMatchObject({ quantity: 7, sure: 7 });
    });
    test('refuses below the floor, with no bid, with nothing held or no floor', () => {
        expect(saleDecision(iron, { held: 10, floor: 111, cap: 500 })).toEqual({ sell: false, reason: 'best bid 110 is below the floor of 111' });
        expect(saleDecision(book({}), { held: 10, floor: 80, cap: 500 })).toEqual({ sell: false, reason: 'no open bid' });
        expect(saleDecision(null, { held: 10, floor: 80, cap: 500 })).toEqual({ sell: false, reason: 'no open bid' });
        expect(saleDecision(iron, { held: 0, floor: 80, cap: 500 })).toEqual({ sell: false, reason: 'nothing to sell' });
        expect(saleDecision(iron, { held: 10, floor: 0, cap: 500 })).toEqual({ sell: false, reason: 'no floor for this item' });
    });
    test('reports how much of the offer the bids provably fill at the floor', () => {
        const d = saleDecision(iron, { held: 5_000, floor: 100, cap: 5_000 });
        expect(d.sell && d.sure).toBeLessThan(5_000);
    });
});

describe('sharkSupply', () => {
    const plan = { logins: 43, perLoginHour: 30, hours: 72, ceiling: 701, runEnded: true };

    test('refuses every purchase until the run has ended', () => {
        const s = sharkSupply(shark, { ...plan, runEnded: false });
        expect(s.allowed).toBe(false);
        expect(s.reason).toMatch(/--run-ended/);
        expect(s.fallbackLogins).toBe(43);
    });
    test("plan A's 92,880 sharks are within the 701 ceiling on the 12:0xZ book", () => {
        const s = sharkSupply(shark, plan);
        expect(s.wanted).toBe(92_880);
        expect(s.cost!.low).toBe(92_880 * 507);
        expect(s.perUnitHigh).toBeCloseTo(700.84, 2);
        expect(s.withinCeiling).toBe(true);
        expect(s.feedLogins).toBe(43);
        expect(s.fallbackLogins).toBe(0);
    });
    test('above the ceiling it logs the bound and leaves the cut to each limit buy', () => {
        const s = sharkSupply(shark, { ...plan, ceiling: 650 });
        expect(s.withinCeiling).toBe(false);
        expect(s.atCeiling).toBe(0);
        expect(s.feedLogins).toBe(43);
        expect(s.reason).toMatch(/above the 650 ceiling: every buy is a limit at 650/);
        // With the mean above the ceiling the totals prove at most ~1/(ceiling + 1 - ask) of the side under it:
        // a mean of 590.5 against a 590 ceiling proves 5,495 of a million, two logins' worth.
        const t = sharkSupply(book({ ask: 500, sellQuantity: 1_000_000, sellValue: 590_500_000 }), { ...plan, ceiling: 590 });
        expect(t.withinCeiling).toBe(false);
        expect(t.atCeiling).toBe(1_000_000 - Math.floor(90_500_000 / 91));
        expect(t.atCeiling).toBe(5_495);
    });
    test('a thin book feeds what it holds', () => {
        const s = sharkSupply(book({ ask: 500, sellQuantity: 5_000, sellValue: 2_600_000 }), plan);
        expect(s.cost!.short).toBe(92_880 - 5_000);
        expect(s.feedLogins).toBe(2);
        expect(s.fallbackLogins).toBe(41);
    });
});

describe('buyDecision', () => {
    test('a limit buy at the ceiling for what the coins cover', () => {
        expect(buyDecision(shark, { want: 200, coins: 100_000, ceiling: 701, runEnded: true })).toEqual({ buy: true, quantity: 142, price: 701, escrow: 142 * 701 });
        expect(buyDecision(shark, { want: 200, coins: 1e9, ceiling: 701, runEnded: true })).toMatchObject({ quantity: 200 });
    });
    test('refuses before the run ends, above the ceiling, or without the coins', () => {
        expect(buyDecision(shark, { want: 200, coins: 1e9, ceiling: 701, runEnded: false }).buy).toBe(false);
        expect(buyDecision(shark, { want: 200, coins: 1e9, ceiling: 506, runEnded: true })).toEqual({ buy: false, reason: 'best ask 507 is above the ceiling of 506' });
        expect(buyDecision(shark, { want: 200, coins: 700, ceiling: 701, runEnded: true })).toEqual({ buy: false, reason: '700 coins do not cover one shark at the ceiling of 701' });
    });
});
