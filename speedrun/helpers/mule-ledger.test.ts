import { describe, expect, test } from 'bun:test';

import type { BankItem } from '../../sdk/types';
import { MANIFEST, parseLedger } from '../tools/slot-ledger';
import { readFileSync } from 'node:fs';
import { configPackages, MULE1_ROWS, muleDrift, muleFromLedger, packagesOf, stepAfter, stockWalk } from './mule-ledger';

// Rows in the inventory ledger's grammar (STEP-MANIFEST.md); the items are the test's own.
const TABLE = `
| row | in | out | equip | needAtStart | source |
|---|---|---|---|---|---|
| H1 | staff of water x1 [u]; air rune x81 [s]; normal logs x2 [u] | - | - | 4 | fixture (r) |
| S01 | - | - | +staff of water | 0 | fixture (r) |
| H12 | gold bar x1 [u]; monkey bones @3183 x1 [u]; prayer potion(4) x4 [u]; shark to 15 [u]; law rune x6 [s] | staff of fire x1 (swap); mithril scimitar x1 (swap); antipoison(*) all (swap); coins all (swap) | - | 22 | fixture (r) |
| S15 Y | - | - | - | 0 | fixture (r) |
| H21d | chisel x1 [u]; guam potion (unf) @91 x358 [n]; thread x187 [s] | <platebody> x5 (swap); hammer x1 (swap) | - | 3 | fixture (r) |
| S25d bank | - | - | - | 0 | fixture (r) |
| H22 | hammer x1 [u]; mithril scimitar x1 [u]; nails x12 [s]; coins to 1000 [s] | staff of fire x1 (swap) | - | 4 | fixture (r) |
| S26 | - | - | - | 0 | fixture (r) |
| H9 | knife x1 [s] | - | - | 1 | fixture (r) |
| S27 | - | - | - | 0 | fixture (r) |
`;
const ROWS = ['H22', 'H1', 'H12', 'H21d'];
const ask = () => muleFromLedger(TABLE, { rows: ROWS });
const fixed = () => muleFromLedger(TABLE, { rows: ROWS, form: 'fixed' });
const pkg = (row: string, form = ask()) => form.find(p => p.row === row)!;

describe('packages from the ledger', () => {
    test('each in entry is a line: game names, ids for NAME @ID, noted for [n]; ledger order', () => {
        const lp = ask();
        expect(lp.map(p => p.row)).toEqual(['H1', 'H12', 'H21d', 'H22']);
        expect(pkg('H1').package).toEqual({
            name: 'h1',
            items: [{ item: 'Staff of water', amount: 1 }, { item: 'Air rune', amount: 81 }, { item: 'Logs', amount: 2 }],
        });
        expect(pkg('H21d').package.items).toEqual([{ item: 'Chisel', amount: 1 }, { id: 91, amount: 358, noted: true }, { item: 'Thread', amount: 187 }]);
        expect(pkg('H21d').slots).toBe(3);
        expect(pkg('H21d').moduleLines).toEqual(['<platebody>']);
    });

    test('ask form: a top-up is topUp { max: to }, the package scoped to the next step', () => {
        const h12 = pkg('H12');
        expect(h12.package.items).toContainEqual({ item: 'Shark', topUp: { max: 15 } });
        expect(h12.package.items).toContainEqual({ id: 3183, amount: 1 });
        expect(h12.package.items).toContainEqual({ item: 'Prayer potion(4)', amount: 4 });
        expect(h12.package.scope).toEqual({ step: 'S15', family: 'mule' });
        expect(h12.step).toBe('S15');
        expect(h12.topUps).toEqual([{ item: 'shark', to: 15 }]);
        expect(h12.slots).toBe(1 + 1 + 4 + 15 + 1);
        expect(h12.takesBack.map(b => b.label)).toEqual(['staff of fire x1', 'mithril scimitar x1', 'antipoison(*) all', 'coins all']);
        expect(pkg('H22').package.scope).toEqual({ step: 'S26', family: 'mule' });
    });

    test('fixed form: the top-up is a fixed `to`, and the package takes no scope', () => {
        const h12 = pkg('H12', fixed());
        expect(h12.package.items).toContainEqual({ item: 'Shark', amount: 15 });
        expect(h12.package.scope).toBeUndefined();
        expect(pkg('H22', fixed()).package.items).toContainEqual({ item: 'Coins', amount: 1000 });
    });

    test('refuses a row the mule would size wrongly, an unknown row, and a row with no step after it', () => {
        expect(() => muleFromLedger(TABLE, { rows: ['H9'] })).toThrow('isStackableName reads Knife as unstackable');
        expect(() => muleFromLedger(TABLE, { rows: ['H5'] })).toThrow('no ledger row H5');
        const { rows } = parseLedger(TABLE);
        expect(stepAfter(rows, rows.findIndex(r => r.row === 'H21d'))).toBe('S25d');
        expect(() => stepAfter(rows, rows.length - 1)).toThrow('no step row after it');
    });
});

describe('muleDrift', () => {
    test('packages generated from the ledger have none, in either form', () => {
        expect(muleDrift({ packages: packagesOf(ask()) }, ask())).toEqual([]);
        expect(muleDrift(packagesOf(fixed()), fixed())).toEqual([]);
    });

    test('the fixed form against the ask form: each top-up and its scope', () => {
        expect(muleDrift(packagesOf(fixed()), ask())).toEqual([
            'H12: Shark: the package x15, the ledger top-up to 15',
            'H12: scope none, the ledger\'s S15/mule',
            'H22: Coins: the package x1000, the ledger top-up to 1000',
            'H22: scope none, the ledger\'s S26/mule',
        ]);
    });

    test('counts, lines, names for ids, noted, missing, extra and reordered packages', () => {
        const [h1, h12, h21d, h22] = packagesOf(ask()).map(p => structuredClone(p));
        h1!.items[1] = { item: 'Air rune', amount: 80 };
        h1!.items.push({ item: 'Banana', amount: 1 });
        h12!.items[1] = { item: 'Monkey bones', amount: 1 };
        h21d!.items[1] = { id: 91, amount: 358 };
        const drift = muleDrift({ packages: [h12, h1, h21d, { name: 'h99', items: [{ item: 'Logs', amount: 1 }] }] }, ask());
        expect(drift).toEqual([
            'h99: configured, but not one of this mule\'s ledger rows (h1, h12, h21d, h22)',
            'order: the packages run h12, h1, h21d; the ledger\'s order is h1, h12, h21d',
            'H1: Air rune: the package x80, the ledger x81',
            'H1: Banana x1 is not in the ledger row',
            'H12: obj 3183 not in the package (the ledger: x1)',
            'H12: Monkey bones x1 is not in the ledger row',
            'H21d: obj 91: the package x358, the ledger x358 noted',
            'H22: no package h22',
        ]);
        expect(h22).toBeDefined();
    });

    test('reads a fleet.json entry, and reports a package the mule would refuse', () => {
        const fleet = { accounts: [{ account: 'cairn_h01', role: 'coins', options: {} }, { account: 'cairn_mule1', role: 'mule', options: { serve: 'x', packages: [] } }] };
        expect(configPackages(fleet)).toEqual([]);
        expect(() => configPackages(fleet, 'cairn_mule2')).toThrow('no entry for cairn_mule2');
        expect(muleDrift([{ name: 'h1', items: [{ item: 'Logs' }] }], ask().slice(0, 1))[0]).toMatch(/^package 0: Package h1: bad amount for Logs/);
    });
});

describe('stockWalk', () => {
    const bank = (items: [number, string, number][]): BankItem[] => items.map(([id, name, count], slot) => ({ slot, id, name, count }));
    const full = (): BankItem[] =>
        bank([
            [1383, 'Staff of water', 1], [556, 'Air rune', 100], [1511, 'Logs', 2], [2357, 'Gold bar', 1], [3183, 'Monkey bones', 1],
            [2434, 'Prayer potion(4)', 4], [385, 'Shark', 20], [563, 'Law rune', 6], [1755, 'Chisel', 1], [91, 'Unfinished potion', 358],
            [1734, 'Thread', 187], [4819, 'Nails', 12], [995, 'Coins', 5000],
        ]);

    test('a later row is served from an earlier row\'s give-back', () => {
        // The scimitar comes back in H12 and the hammer in H21d; neither is in the bank before.
        expect(stockWalk(ask(), full())).toEqual([]);
    });

    test('what runs out, in order, with a top-up staged short', () => {
        const b = full().map(i => (i.name === 'Shark' ? { ...i, count: 10 } : i.name === 'Air rune' ? { ...i, count: 50 } : i));
        expect(stockWalk(ask(), b)).toEqual(['H1: Air rune wanted 81, the bank holds 50', 'H12: top-up Shark stages 10 of 15']);
        expect(stockWalk(fixed(), b)).toEqual(['H1: Air rune wanted 81, the bank holds 50', 'H12: Shark wanted 15, the bank holds 10']);
    });
});

describe('the manifest', () => {
    test('every mule1 row builds in both forms, fits 28 slots, and shows no drift against itself', () => {
        const manifest = readFileSync(MANIFEST, 'utf8');
        for (const form of ['ask', 'fixed'] as const) {
            const lp = muleFromLedger(manifest, { form });
            expect(lp.map(p => p.row).sort()).toEqual([...MULE1_ROWS].sort());
            for (const p of lp) expect(p.slots).toBeLessThanOrEqual(28);
            expect(muleDrift(packagesOf(lp), lp)).toEqual([]);
        }
    });

    test("H12's shark line takes its max from the row's `to`", () => {
        const manifest = readFileSync(MANIFEST, 'utf8');
        const row = parseLedger(manifest).rows.find(r => r.row === 'H12')!;
        const shark = row.in.find(e => e.name === 'shark' && e.topUp);
        const h12 = muleFromLedger(manifest, { rows: ['H12'] })[0]!;
        if (shark) expect(h12.package.items).toContainEqual({ item: 'Shark', topUp: { max: shark.count! } });
        else expect(h12.package.items.some(i => 'topUp' in i)).toBe(false);
    });
});
