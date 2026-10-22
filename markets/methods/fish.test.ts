import { describe, expect, test } from 'bun:test';
import { bigNetPerRoll, junk, shouldReclick } from './fish';

describe('bigNetPerRoll', () => {
    test('at 99: bass 41/256, oyster 8/256, two mackerel rolls', () => {
        const r = bigNetPerRoll(99);
        expect(r.get('raw_bass')).toBeCloseTo(41 / 256, 9);
        expect(r.get('oystershell')).toBeCloseTo(8 / 256, 9);
        expect(r.get('raw_mackerel')).toBeCloseTo((66 + 11) / 256, 9);
    });
    test('no bass below 46 and no cod below 23', () => {
        expect(bigNetPerRoll(45).has('raw_bass')).toBe(false);
        expect(bigNetPerRoll(22).has('raw_cod')).toBe(false);
        expect(bigNetPerRoll(46).has('raw_bass')).toBe(true);
    });
    test('the bass to oyster ratio rises with level, 5.1 at 99', () => {
        const ratio = (l: number) => bigNetPerRoll(l).get('raw_bass')! / bigNetPerRoll(l).get('oystershell')!;
        expect(ratio(99)).toBeCloseTo(41 / 8, 6);
        expect(ratio(60)).toBeLessThan(ratio(99));
    });
});

describe('shouldReclick', () => {
    test('click first, and again when the clicked spot moved', () => {
        expect(shouldReclick({ clicked: false, spotThere: false, sinceCatch: 0 })).toBe(true);
        expect(shouldReclick({ clicked: true, spotThere: false, sinceCatch: 0 })).toBe(true);
        expect(shouldReclick({ clicked: true, spotThere: true, sinceCatch: 10 })).toBe(false);
    });
    test('a long dry spell re-clicks; a short one never does (a click restarts the roll clock)', () => {
        expect(shouldReclick({ clicked: true, spotThere: true, sinceCatch: 149 })).toBe(false);
        expect(shouldReclick({ clicked: true, spotThere: true, sinceCatch: 150 })).toBe(true);
    });
});

describe('junk', () => {
    const inv = [
        { slot: 0, name: 'Big fishing net' },
        { slot: 1, name: 'Raw bass' },
        { slot: 2, name: 'Raw mackerel' },
        { slot: 3, name: 'Oyster' },
        { slot: 4, name: 'Seaweed' }
    ];
    test('drops what is neither the tool nor kept', () => {
        expect(junk(inv, /^big fishing net$/i, ['Raw bass', 'oyster'])).toEqual([2, 4]);
    });
    test('no keep list: drop nothing (bank everything)', () => {
        expect(junk(inv, /^big fishing net$/i, null)).toEqual([]);
    });
});
