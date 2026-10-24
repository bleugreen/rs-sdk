import { expect, test } from 'bun:test';
import { diffAccount, loadSearches, type Searches } from './searches.ts';

const row = (name: string, items: [number, string, number, number][]) => ({ rank: 1, name, gp: 0, items: items.map(([id, n, count, gp]) => ({ id, name: n, count, gp })) });

test('diffAccount pairs an account\'s stacks across the queries both files ran', () => {
    const before: Searches = { rune: [row('stein', [[1436, 'Rune essence', 100, 400], [1079, 'Rune platelegs', 2, 128000]])], logs: [row('stein', [[1515, 'Yew logs', 10, 1600]])], only: [] };
    const after: Searches = { rune: [row('stein', [[1436, 'Rune essence', 100, 400]]), row('x', [[1079, 'Rune platelegs', 9, 1]])], logs: [], coins: [row('stein', [[995, 'Coins', 5, 5]])] };
    expect(diffAccount(before, after, 'stein')).toEqual([
        { id: 1079, name: 'Rune platelegs', before: 2, after: null, gpBefore: 128000, gpAfter: null },
        { id: 1515, name: 'Yew logs', before: 10, after: null, gpBefore: 1600, gpAfter: null },
        { id: 1436, name: 'Rune essence', before: 100, after: 100, gpBefore: 400, gpAfter: 400 }
    ]);
});

test('loadSearches accepts a searches file, a snapshot and a census file', () => {
    const s: Searches = { a: [] };
    expect(loadSearches(s)).toBe(s);
    expect(loadSearches({ bank: { searches: s } })).toBe(s);
    expect(loadSearches({ searches: s })).toBe(s);
});
