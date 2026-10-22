import { describe, expect, test } from 'bun:test';
import { junk, shouldReclick } from './fish';

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
