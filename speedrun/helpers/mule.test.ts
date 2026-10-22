import { describe, expect, test } from 'bun:test';

import type { BankItem, InventoryItem } from '../../sdk/types';
import {
    accountMatches,
    canonName,
    countById,
    courierPicks,
    firstSlotPerId,
    holds,
    isStackableName,
    parsePackageRequest,
    planPackage,
    playerPattern,
    sameItems,
    toRegExps,
    type Package
} from './mule';

const bank = (items: [number, string, number][]): BankItem[] => items.map(([id, name, count], slot) => ({ slot, id, name, count }));
const inv = (items: [number, number, string, number][]): InventoryItem[] =>
    items.map(([slot, id, name, count]) => ({ slot, id, name, count, optionsWithIndex: [] }));

describe('account names', () => {
    test('login and display names compare equal', () => {
        expect(canonName('Cairn H05')).toBe('cairn_h05');
        expect(canonName('cairn_dot_md')).toBe(canonName('Cairn Dot Md'));
    });

    test('playerPattern matches the display name exactly', () => {
        const re = playerPattern('cairn_dot_md');
        expect(re.test('Cairn Dot Md')).toBe(true);
        expect(re.test('cairn_dot_md')).toBe(true);
        expect(re.test('Cairn Dot Md2')).toBe(false);
        expect(re.test('xCairn Dot Md')).toBe(false);
    });

    test('courier filter is written against login names but accepts display names', () => {
        const [re] = toRegExps('^cairn_h\\d+$');
        expect(accountMatches('Cairn H05', re!)).toBe(true);
        expect(accountMatches('Cairn H12', re!)).toBe(true);
        expect(accountMatches('Cairn Mule1', re!)).toBe(false);
        expect(accountMatches('Cairn H05 X', re!)).toBe(false);
        expect(accountMatches(null, re!)).toBe(false);
    });
});

describe('packages', () => {
    const pkgs: Package[] = [
        { name: 'wine', items: [{ item: 'Jug of wine', amount: 28 }] },
        { name: 'bars', items: [{ item: 'Adamantite bar', amount: 100, noted: true }, { item: 'Coins', amount: 5000 }] }
    ];

    test('PM text selects a package by name, with or without the pkg prefix', () => {
        expect(parsePackageRequest('bars', pkgs)?.name).toBe('bars');
        expect(parsePackageRequest('pkg WINE ', pkgs)?.name).toBe('wine');
        expect(parsePackageRequest('hello', pkgs)).toBeNull();
    });

    test('plan maps package items onto bank items and counts slots', () => {
        const plan = planPackage(pkgs[1]!, bank([[2361, 'Adamantite bar', 300], [995, 'Coins', 10_000]]));
        expect(plan.missing).toEqual([]);
        expect(plan.withdrawals.map(w => [w.bankItem.id, w.amount, w.noted])).toEqual([
            [2361, 100, true],
            [995, 5000, false]
        ]);
        expect(plan.slots).toBe(2);
    });

    test('plan reports shortfalls and oversize unnoted packages', () => {
        const short = planPackage(pkgs[1]!, bank([[2361, 'Adamantite bar', 50]]));
        expect(short.missing).toEqual([
            { item: 'Adamantite bar', wanted: 100, have: 50 },
            { item: 'Coins', wanted: 5000, have: 0 }
        ]);
        const big = planPackage({ name: 'x', items: [{ item: 'Jug of wine', amount: 30 }] }, bank([[1993, 'Jug of wine', 40]]));
        expect(big.slots).toBe(30);
    });

    test('amount -1 takes the whole bank stack', () => {
        const plan = planPackage({ name: 'all', items: [{ item: 'logs', amount: -1, noted: true }] }, bank([[1511, 'Logs', 77]]));
        expect(plan.withdrawals[0]!.amount).toBe(77);
    });

    test('stackable guess covers coins, runes and ammunition but not plain items', () => {
        for (const n of ['Coins', 'Law rune', 'Rune arrows', 'Mithril dart tips', 'Feather', 'Rune arrowtips']) expect(isStackableName(n)).toBe(true);
        for (const n of ['Rune essence', 'Logs', 'Shark', 'Rune platebody', 'Knife']) expect(isStackableName(n)).toBe(false);
        expect(isStackableName('Rune knife')).toBe(true);
    });
});

describe('offer verification', () => {
    test('sameItems is exact multiset equality by id', () => {
        const a = countById([{ id: 1, count: 5 }, { id: 2, count: 1 }, { id: 2, count: 1 }]);
        expect(sameItems(a, new Map([[1, 5], [2, 2]]))).toBe(true);
        expect(sameItems(a, new Map([[1, 5], [2, 1]]))).toBe(false);
        expect(sameItems(a, new Map([[1, 5], [2, 2], [3, 1]]))).toBe(false);
    });

    test('holds tolerates extra inventory but not a shortfall', () => {
        const have = new Map([[1, 5], [2, 2], [9, 1]]);
        expect(holds(have, new Map([[1, 5], [2, 2]]))).toBe(true);
        expect(holds(have, new Map([[1, 6]]))).toBe(false);
    });

    test('one offer per item id, lowest slot first (Offer-All moves every slot of that id)', () => {
        const items = inv([[5, 379, 'Lobster', 1], [0, 379, 'Lobster', 1], [3, 1512, 'Logs', 40], [1, 379, 'Lobster', 1]]);
        expect(firstSlotPerId(items).map(i => [i.slot, i.id])).toEqual([
            [0, 379],
            [3, 1512]
        ]);
    });
});

describe('courier', () => {
    test('picks every matching bank stack, capped by free slots', () => {
        const b = bank([[1511, 'Logs', 100], [1521, 'Oak logs', 50], [995, 'Coins', 10], [1515, 'Yew logs', 0]]);
        expect(courierPicks(b, toRegExps(['logs$']), 28).map(i => i.name)).toEqual(['Logs', 'Oak logs']);
        expect(courierPicks(b, toRegExps(['logs$']), 1).map(i => i.name)).toEqual(['Logs']);
        expect(courierPicks(b, toRegExps([]), 28)).toEqual([]);
    });
});
