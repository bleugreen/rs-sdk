import { describe, expect, test } from 'bun:test';
import { fermentBank, LEVEL_TENTHS, levelOf, rollChance } from './wine-ferment';

describe('level table', () => {
    test('matches the standard thresholds (in tenths)', () => {
        expect(LEVEL_TENTHS[0]).toBe(830); // level 2 = 83 xp
        expect(LEVEL_TENTHS[97]).toBe(130_344_310); // level 99 = 13,034,431 xp
        expect(levelOf(0)).toBe(1);
        expect(levelOf(830)).toBe(2);
        expect(levelOf(130_344_310)).toBe(99);
    });
});

describe('stat_random(cooking, 48, 352)', () => {
    test('about 19% at level 1 and certain from 68', () => {
        expect(rollChance(1)).toBeCloseTo(49 / 256, 6);
        expect(rollChance(67)).toBeLessThan(1);
        expect(rollChance(68)).toBe(1);
    });
});

describe('fermentBank', () => {
    test('15 equal batches then singles: 32 wines are 15 rolls of 2 and 2 rolls of 1', () => {
        let rolls = 0;
        const r = fermentBank(32, 0, 25, () => {
            rolls++;
            return 0; // every roll succeeds
        });
        expect(rolls).toBe(17);
        expect(r.good).toBe(32);
        expect(r.tenths).toBe(32 * 1100 * 25);
    });

    test('a failed roll loses its whole batch', () => {
        let k = 0;
        const r = fermentBank(450, 0, 25, () => (k++ === 0 ? 0.99 : 0)); // first roll fails
        expect(r.bad).toBe(30);
        expect(r.good).toBe(420);
    });
});
