import { describe, expect, test } from 'bun:test';
import { baseToXp, levelForXp, XP_RATE, xpForLevel } from './xp';

describe('xp', () => {
    test('the curve matches the base-xp table in docs/speedrun/skills/README.md', () => {
        expect(xpForLevel(1)).toBe(0);
        expect(xpForLevel(10) / XP_RATE).toBe(39.2);
        expect(xpForLevel(20) / XP_RATE).toBe(124.2);
        expect(xpForLevel(57) / XP_RATE).toBe(2143.72);
        expect(xpForLevel(91) / XP_RATE).toBe(22932.4);
        expect(xpForLevel(99) / XP_RATE).toBe(39938.32);
    });

    test('levels by xp, at and either side of a threshold', () => {
        expect(levelForXp(0)).toBe(1);
        expect(levelForXp(xpForLevel(20) - 1)).toBe(19);
        expect(levelForXp(xpForLevel(20))).toBe(20);
        expect(levelForXp(xpForLevel(99))).toBe(99);
        expect(levelForXp(10 ** 9)).toBe(99);
    });

    test('Sea Slug and Fishing Contest (9,612 base) give level 78', () => {
        expect(baseToXp(9612)).toBe(240300);
        expect(levelForXp(baseToXp(9612))).toBe(78);
        expect(baseToXp(7175)).toBe(179375);
        expect(levelForXp(baseToXp(7175))).toBe(74);
    });

    test('levels outside 1-99 are refused', () => {
        expect(() => xpForLevel(0)).toThrow(/1 to 99/);
        expect(() => xpForLevel(100)).toThrow(/1 to 99/);
    });
});
