import { describe, expect, test } from 'bun:test';

import type { BankItem } from '../../sdk/types';
import { MANIFEST, parseLedger } from '../tools/slot-ledger';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { packageForCue, requestPackage } from './mule';
import { cueDir } from './altar-cue';
import { configPackages, MULE1_NO_PACKAGE, MULE1_ON_REQUEST, MULE1_ORDER, muleCueDir, muleDrift, muleFromLedger, muleRunOptions, onRequestGaps, packagesOf, parseFallbacks, stepAfter, stockWalk } from './mule-ledger';

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

### Fallback hand-offs (not walked)

| row | in | out | equip | needAtStart | source |
|---|---|---|---|---|---|
| H4e | law rune x1 [s]; air rune x5 [s] | rune axe x1 (swap) | - | 1 | fixture (r) |
| H4m | babydragon bones x16 [u] | - | - | 16 | fixture (r) |
`;
const ROWS = ['H1', 'H12', 'H21d', 'H22'];
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
            scope: { step: 'H1', family: 'mule' },
        });
        expect(pkg('H21d').package.items).toEqual([{ item: 'Chisel', amount: 1 }, { id: 91, amount: 358, noted: true }, { item: 'Thread', amount: 187 }]);
        expect(pkg('H21d').slots).toBe(3);
        expect(pkg('H21d').moduleLines).toEqual(['<platebody>']);
    });

    test('ask form: a top-up is topUp { max: to }; the package is scoped to its hand-off id and records the step it feeds', () => {
        const h12 = pkg('H12');
        expect(h12.package.items).toContainEqual({ item: 'Shark', topUp: { max: 15 } });
        expect(h12.package.items).toContainEqual({ id: 3183, amount: 1 });
        expect(h12.package.items).toContainEqual({ item: 'Prayer potion(4)', amount: 4 });
        expect(h12.package.scope).toEqual({ step: 'H12', family: 'mule' });
        expect(h12.step).toBe('S15');
        expect(h12.topUps).toEqual([{ item: 'shark', to: 15 }]);
        expect(h12.slots).toBe(1 + 1 + 4 + 15 + 1);
        expect(h12.takesBack.map(b => b.label)).toEqual(['staff of fire x1', 'mithril scimitar x1', 'antipoison(*) all', 'coins all']);
        expect(pkg('H22').package.scope).toEqual({ step: 'H22', family: 'mule' });
    });

    test("a drop is left on SCORED's tile: never among what the mule takes back", () => {
        const md = [
            '| row | in | out | equip | needAtStart | source |',
            '|---|---|---|---|---|---|',
            '| H13 | staff of fire x1 [u] | magic shortbow x1 (swap); khazard helmet x1 (drop: unworn first) | +staff of fire | 1 | fixture (r) |',
            '| S16 | - | - | - | 0 | fixture (r) |',
        ].join('\n');
        const [h13] = muleFromLedger(md, { rows: ['H13'] });
        expect(h13!.takesBack.map(b => b.label)).toEqual(['magic shortbow x1']);
        expect(h13!.package.items).toEqual([{ item: 'Staff of fire', amount: 1 }]);
    });

    test('fixed form: the top-up is a fixed `to`; the package keeps its hand-off scope', () => {
        const h12 = pkg('H12', fixed());
        expect(h12.package.items).toContainEqual({ item: 'Shark', amount: 15 });
        expect(h12.package.scope).toEqual({ step: 'H12', family: 'mule' });
        expect(pkg('H22', fixed()).package.items).toContainEqual({ item: 'Coins', amount: 1000 });
    });

    test('the fallback table: its rows, their lines as in the file; none without the heading', () => {
        const fb = parseFallbacks(TABLE);
        expect(fb.map(r => r.row)).toEqual(['H4e', 'H4m']);
        expect(TABLE.split('\n')[fb[0]!.line - 1]).toStartWith('| H4e |');
        expect(parseFallbacks(TABLE.replace('### Fallback hand-offs (not walked)', ''))).toEqual([]);
        // The walk never reads it.
        expect(parseLedger(TABLE).rows.some(r => r.row === 'H4e')).toBe(false);
    });

    test('on-request packages come last and are marked; the ordered list must follow the ledger', () => {
        const lp = muleFromLedger(TABLE, { rows: ['H1', 'H12'], onRequest: ['H4e'] });
        expect(lp.map(p => [p.row, p.onRequest, p.step])).toEqual([['H1', false, 'S01'], ['H12', false, 'S15'], ['H4e', true, null]]);
        expect(lp[2]!.package).toEqual({ name: 'h4e', items: [{ item: 'Law rune', amount: 1 }, { item: 'Air rune', amount: 5 }], scope: { step: 'H4e', family: 'mule' }, onRequest: true });
        expect(lp[2]!.takesBack.map(b => b.label)).toEqual(['rune axe x1']);
        expect(() => muleFromLedger(TABLE, { rows: ['H12', 'H1'] })).toThrow('H1 is listed after H12, but comes before it in the ledger');
        expect(() => muleFromLedger(TABLE, { rows: ['H1'], onRequest: ['H12'] })).toThrow('no fallback hand-off row H12');
        expect(onRequestGaps(TABLE)).toEqual([]);
        expect(onRequestGaps(TABLE.replace(/^\| H4e .*\n/m, ''))).toEqual(['H4e']);
    });

    test('refuses a row the mule would size wrongly, an unknown row, and a row with no step after it', () => {
        expect(() => muleFromLedger(TABLE, { rows: ['H9'] })).toThrow('isStackableName reads Knife as unstackable');
        expect(() => muleFromLedger(TABLE, { rows: ['H5'] })).toThrow('no ledger row H5');
        const { rows } = parseLedger(TABLE);
        expect(stepAfter(rows, rows.findIndex(r => r.row === 'H21d'))).toBe('S25d');
        expect(() => stepAfter(rows, rows.length - 1)).toThrow('no step row after it');
    });
});

describe('cues', () => {
    test('two mule hand-offs feeding one step get distinct cues, each asking for its own package', () => {
        const two = `
| row | in | out | equip | needAtStart | source |
|---|---|---|---|---|---|
| H4 | clay x6 [u] | - | - | 6 | fixture (r) |
| H4b | law rune x2 [s] | - | - | 1 | fixture (r) |
| S05 | - | - | - | 0 | fixture (r) |
`;
        const lp = muleFromLedger(two, { rows: ['H4', 'H4b'] });
        expect(lp.map(p => p.step)).toEqual(['S05', 'S05']);
        expect(lp.map(p => p.package.scope)).toEqual([{ step: 'H4', family: 'mule' }, { step: 'H4b', family: 'mule' }]);
        const dir = mkdtempSync(join(tmpdir(), 'mule-ledger-cue-'));
        for (const want of lp) {
            const cue = requestPackage(dir, 'cairn_h94', want.row, { tick: 1, ms: 1 });
            expect(packageForCue(cue, packagesOf(lp), 'cairn_h94')?.name).toBe(want.package.name);
        }
    });
});

describe('muleDrift', () => {
    test("the mule's cue directory is its own, <cue root>/mule: in the run-day options, and checked as drift", () => {
        expect(muleCueDir('/run/rc-cue')).toBe('/run/rc-cue/mule');
        expect(muleCueDir(cueDir({ RC_CUE_DIR: '/run/rc-cue' }))).toBe('/run/rc-cue/mule');
        const want = '/run/rc-cue/mule';
        const opts = muleRunOptions(ask(), '/run/rc-cue');
        expect(opts).toEqual({ serveMode: 'request', cueDir: want, packages: packagesOf(ask()) });
        expect(muleDrift(opts, ask(), { cueDir: want })).toEqual([]);
        expect(muleDrift({ ...opts, cueDir: '/run/rc-cue/mule/' }, ask(), { cueDir: want })).toEqual([]);
        expect(muleDrift({ ...opts, cueDir: '/run/rc-cue' }, ask(), { cueDir: want })).toEqual(["cueDir /run/rc-cue, the run's /run/rc-cue/mule"]);
        const { cueDir: _, ...shared } = opts;
        const fleet = (entry: Record<string, unknown>) => ({ accounts: [{ account: 'cairn_mule1', role: 'mule', ...entry }] });
        expect(muleDrift(fleet({ options: shared }), ask(), { cueDir: want })).toEqual(["cueDir none (the shared cue directory), the run's /run/rc-cue/mule"]);
        // A launcher entry's own cueDir is the one its role reads (standalone.ts).
        expect(muleDrift(fleet({ cueDir: want, options: shared }), ask(), { cueDir: want })).toEqual([]);
        // Without o.cueDir nothing about the directory is compared.
        expect(muleDrift(shared, ask())).toEqual([]);
    });

    test('packages generated from the ledger have none, in either form', () => {
        expect(muleDrift({ packages: packagesOf(ask()) }, ask())).toEqual([]);
        expect(muleDrift(packagesOf(fixed()), fixed())).toEqual([]);
    });

    test('the fixed form against the ask form: each top-up and its scope', () => {
        expect(muleDrift(packagesOf(fixed()), ask())).toEqual([
            'H12: Shark: the package x15, the ledger top-up to 15',
            'H22: Coins: the package x1000, the ledger top-up to 1000',
        ]);
        const { scope: _, ...unkeyed } = packagesOf(ask())[0]!;
        expect(muleDrift([unkeyed, ...packagesOf(ask()).slice(1)], ask())).toEqual(["H1: scope none, the ledger's H1/mule"]);
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

    test('an on-request package: its flag is compared, and it never counts in the order', () => {
        const lp = muleFromLedger(TABLE, { rows: ['H1', 'H12'], onRequest: ['H4e'] });
        const [h1, h12, h4e] = packagesOf(lp);
        expect(muleDrift([h4e, h1, h12], lp)).toEqual([]);
        const { onRequest: _, ...plain } = h4e!;
        expect(muleDrift([h1, h12, plain], lp)).toEqual(['H4e: served in order, but only on request in the ledger list']);
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
    test("MULE1_ORDER is rs/158's list of cairn_mule1's trades in run order; H4e is served on request", () => {
        expect([...MULE1_ORDER]).toEqual(['H1', 'H4', 'H4k', 'H6', 'H4p', 'H7', 'H8', 'H9', 'H10', 'H12', 'H13', 'H14', 'H15', 'H16', 'H18', 'H19', 'H20', 'H21d', 'H22']);
        expect([...MULE1_ON_REQUEST]).toEqual(['H4e', 'H4m']);
    });

    test("every SUPPLIES.md hand-off the trade giver serves is mule1's package, on-request package, or named as having none", () => {
        const lines = readFileSync(MANIFEST.replace('STEP-MANIFEST.md', 'SUPPLIES.md'), 'utf8').split('\n');
        const header = lines.findIndex(l => /^\|\s*ID\s*\|.*\|\s*Giver/i.test(l));
        expect(header).toBeGreaterThan(0);
        const giverCol = lines[header]!.split('|').findIndex(c => /^\s*Giver/i.test(c));
        const supplies: string[] = [];
        for (let i = header + 2; i < lines.length && lines[i]!.startsWith('|'); i++) {
            const c = lines[i]!.split('|');
            const id = c[1]!.replace(/\*/g, '').trim().split(/\s/)[0]!;
            // The trade giver (cairn_mule1), not trade giver 2 (cairn_mule2, H21c's wine giver).
            if (/^\s*\**(the )?trade giver(?! 2)/i.test(c[giverCol] ?? '')) supplies.push(id);
        }
        const ours = new Set<string>([...MULE1_ORDER, ...MULE1_ON_REQUEST, ...Object.keys(MULE1_NO_PACKAGE)]);
        expect(supplies.filter(id => !ours.has(id))).toEqual([]);
        // Every ordered trade is a trade-giver row there (a row with no package may leave it, as H3 will).
        expect(MULE1_ORDER.filter(id => !supplies.includes(id))).toEqual([]);
    });

    test('every mule1 row builds in both forms, fits 28 slots, and shows no drift against itself', () => {
        const manifest = readFileSync(MANIFEST, 'utf8');
        for (const form of ['ask', 'fixed'] as const) {
            const lp = muleFromLedger(manifest, { form });
            const onRequest = MULE1_ON_REQUEST.filter(id => !onRequestGaps(manifest).includes(id));
            expect(lp.map(p => p.row)).toEqual([...MULE1_ORDER, ...onRequest]);
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
