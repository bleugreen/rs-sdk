import { describe, expect, test } from 'bun:test';
import { nextErrand, shouldEat } from './pickpocket';

describe('shouldEat', () => {
    const base = { maxHp: 70, heal: 20, damage: 3, window: true, ticksSinceEat: 10 };
    test('in a success window, eat once a shark would not be wasted', () => {
        expect(shouldEat({ ...base, hp: 51 })).toBe(false);
        expect(shouldEat({ ...base, hp: 50 })).toBe(true);
    });
    test('out of the window, only when the next failure could kill', () => {
        expect(shouldEat({ ...base, hp: 10, window: false })).toBe(false);
        expect(shouldEat({ ...base, hp: 4, window: false })).toBe(true);
        expect(shouldEat({ ...base, hp: 4, window: false, ticksSinceEat: 1 })).toBe(false);
    });
    test('at 10 HP a shark is always partly wasted: eat in the window at two failures from the floor', () => {
        const low = { ...base, maxHp: 10 };
        expect(shouldEat({ ...low, hp: 8 })).toBe(false);
        expect(shouldEat({ ...low, hp: 7 })).toBe(true);
    });
});

describe('nextErrand', () => {
    test('bank when out of food or carrying bankAt coins; else thieve at the station', () => {
        expect(nextErrand({ food: 0, coins: 0, bankAt: 50000, atStation: true })).toBe('bank');
        expect(nextErrand({ food: 5, coins: 50000, bankAt: 50000, atStation: true })).toBe('bank');
        expect(nextErrand({ food: 5, coins: 10, bankAt: 50000, atStation: false })).toBe('go');
        expect(nextErrand({ food: 5, coins: 10, bankAt: 50000, atStation: true })).toBe('thieve');
    });
});
