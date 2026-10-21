import { describe, expect, test } from 'bun:test';
import { chopChance, planLogSale, shopBuyPrice } from './woodcutter';

describe('chopChance', () => {
    test('magic tree at level 75 (trees.dbrow successchance)', () => {
        expect(chopChance(75, 2, 6) * 256).toBe(5); // bronze
        expect(chopChance(75, 3, 9) * 256).toBe(7); // iron
        expect(chopChance(75, 4, 12) * 256).toBe(10); // steel
        expect(chopChance(75, 7, 21) * 256).toBe(17); // rune
    });
});

describe('shopBuyPrice at Arhein (multiplier 400, delta 30)', () => {
    test('yew logs fall 3% of their value per unit the shop holds', () => {
        expect([0, 1, 2, 3].map(n => shopBuyPrice(160, n))).toEqual([64, 59, 54, 49]);
    });
    test('never below 10% of value', () => {
        expect(shopBuyPrice(160, 50)).toBe(16);
    });
});

describe('planLogSale', () => {
    test('nothing to sell when the coins already cover it', () => {
        expect(planLogSale(0, {})).toEqual([]);
        expect(planLogSale(-5, { 'Yew logs': 3 })).toEqual([]);
    });
    test('a steel axe from 25 coins: three yews plus two spare', () => {
        expect(planLogSale(175, { 'Yew logs': 20 })).toEqual([{ name: 'Yew logs', count: 5 }]);
    });
    test('spare is capped by what the bank holds', () => {
        expect(planLogSale(175, { 'Yew logs': 3 })).toEqual([{ name: 'Yew logs', count: 3 }]);
    });
    test('falls back to maples after the yews', () => {
        // 2 yews raise 123; maples pay 32, 29, ... so 2 more cover the 175.
        expect(planLogSale(175, { 'Yew logs': 2, 'Maple logs': 10 })).toEqual([
            { name: 'Yew logs', count: 2 },
            { name: 'Maple logs', count: 4 }
        ]);
    });
    test('null when the bank cannot raise it', () => {
        expect(planLogSale(175, { 'Maple logs': 2 })).toBeNull();
        expect(planLogSale(175, {})).toBeNull();
    });
});
