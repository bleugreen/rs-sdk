import { describe, expect, test } from 'bun:test';
import { censusItems } from './bank-read';

describe('bank-read census', () => {
    test('items by id with counts; slots only where asked; empties dropped', () => {
        const inv = [
            { slot: 0, id: 536, name: 'Dragon bones', count: 1 },
            { slot: 1, id: -1, name: '', count: 0 },
            { slot: 2, id: 563, name: 'Law rune', count: 1 }
        ];
        expect(censusItems(inv, true)).toEqual([
            { id: 536, name: 'Dragon bones', count: 1, slot: 0 },
            { id: 563, name: 'Law rune', count: 1, slot: 2 }
        ]);
        expect(censusItems(inv, false)).toEqual([
            { id: 536, name: 'Dragon bones', count: 1 },
            { id: 563, name: 'Law rune', count: 1 }
        ]);
        expect(censusItems(undefined, true)).toEqual([]);
    });
});
