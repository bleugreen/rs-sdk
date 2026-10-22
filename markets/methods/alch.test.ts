import { describe, expect, test } from 'bun:test';
import { alchCoinsPerHour } from './alch';

describe('alchCoinsPerHour', () => {
    test('pays floor(0.6 x cost) a cast, less the item and the nature rune', () => {
        // a ruby ring (cost 2,025) bought from Irksol at 1,012, natures at 20: 1,215 - 1,032 = 183 a cast
        expect(alchCoinsPerHour({ cost: 2025, buy: 1012, nature: 20, spell: 'high', castsPerHour: 1 })).toBe(183);
        expect(alchCoinsPerHour({ cost: 2025, buy: 1012, nature: 20, spell: 'high', castsPerHour: 1800 })).toBe(183 * 1800);
    });
    test('low alchemy pays 0.4 and at least 1', () => {
        expect(alchCoinsPerHour({ cost: 100, buy: 0, nature: 0, spell: 'low', castsPerHour: 1 })).toBe(40);
        expect(alchCoinsPerHour({ cost: 1, buy: 0, nature: 0, spell: 'low', castsPerHour: 1 })).toBe(1);
    });
    test('a loss is negative', () => {
        expect(alchCoinsPerHour({ cost: 2025, buy: 1012, nature: 621, spell: 'high', castsPerHour: 1 })).toBe(1215 - 1012 - 621);
    });
});
