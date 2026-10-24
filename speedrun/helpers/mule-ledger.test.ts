import { describe, expect, test } from 'bun:test';

import type { BankItem } from '../../sdk/types';
import { MANIFEST, parseLedger } from '../tools/slot-ledger';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { deliveryGroup, muleOptions, packageForCue, planCarryGroup, planPackage, requestPackage } from './mule';
import { H4M_STAND, muleDelivery } from './mule-itinerary';
import { parseLaunchConfig } from './standalone';
import { cueDir } from './altar-cue';
import { configPackages, h4mLoadRows, H4M_ANCHOR, materializeDeliveryPackage, MULE1_NO_PACKAGE, MULE1_ON_REQUEST, MULE1_ORDER, muleCueDir, muleDrift, muleFromLedger, muleRunOptions, muleRunOptionsByAccount, onRequestGaps, packagesOf, parseFallbacks, stepAfter, stockWalk } from './mule-ledger';
import { cpSync, mkdirSync, symlinkSync } from 'node:fs';

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
| H4m.1-H4m.3 | big bones @532 x20 [u] | - | - | 20 | fixture (r) |
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
        expect(fb.map(r => r.row)).toEqual(['H4e', 'H4m.1-H4m.3']);
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
        const runtimeLedger = ask().filter(l => l.row !== 'H12');
        expect(muleCueDir('/run/rc-cue')).toBe('/run/rc-cue/mule');
        expect(muleCueDir(cueDir({ RC_CUE_DIR: '/run/rc-cue' }))).toBe('/run/rc-cue/mule');
        const want = '/run/rc-cue/mule';
        const opts = muleRunOptions(runtimeLedger, '/run/rc-cue', { deliveryRun: 'test-attempt-1', serve: 'receiver' });
        expect(opts).toEqual({ serveMode: 'request', cueDir: want, deliveryRun: 'test-attempt-1', serve: 'receiver', packages: runtimeLedger.map(l => ({ ...materializeDeliveryPackage(l.package), at: muleDelivery(l.row).at, bank: muleDelivery(l.row).bank })) });
        expect(muleDrift(opts, runtimeLedger, { cueDir: want })).toEqual([]);
        expect(muleDrift({ ...opts, cueDir: '/run/rc-cue/mule/' }, runtimeLedger, { cueDir: want })).toEqual([]);
        expect(muleDrift({ ...opts, cueDir: '/run/rc-cue' }, runtimeLedger, { cueDir: want })).toEqual(["cueDir /run/rc-cue, the run's /run/rc-cue/mule"]);
        const { cueDir: _, ...shared } = opts;
        const fleet = (entry: Record<string, unknown>) => ({ accounts: [{ account: 'cairn_mule1', role: 'mule', ...entry }] });
        expect(muleDrift(fleet({ options: shared }), runtimeLedger, { cueDir: want })).toEqual(["cueDir none (the shared cue directory), the run's /run/rc-cue/mule"]);
        // A launcher entry's own cueDir is the one its role reads (standalone.ts).
        expect(muleDrift(fleet({ cueDir: want, options: shared }), runtimeLedger, { cueDir: want })).toEqual([]);
        // Without o.cueDir nothing about the directory is compared.
        expect(muleDrift(shared, runtimeLedger)).toEqual([]);
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
            [1734, 'Thread', 187], [1539, 'Nails', 12], [995, 'Coins', 5000],
        ]);

    test('a later row is served from an earlier row\'s give-back', () => {
        // The scimitar comes back in H12 and the hammer in H21d; neither is in the bank before.
        expect(stockWalk(ask(), full())).toEqual([]);
    });

    test('what runs out, in order, with a top-up staged short', () => {
        const b = full().map(i => (i.name === 'Shark' ? { ...i, count: 10 } : i.name === 'Air rune' ? { ...i, count: 50 } : i));
        expect(stockWalk(ask(), b)).toEqual(['H1: obj 556 wanted 81, the bank holds 50', 'H12: top-up obj 385 stages 10 of 15']);
        expect(stockWalk(fixed(), b)).toEqual(['H1: obj 556 wanted 81, the bank holds 50', 'H12: obj 385 wanted 15, the bank holds 10']);
    });
});

describe('the manifest', () => {
    test("MULE1_ORDER is rs/158's list of cairn_mule1's trades in run order; H4e is served on request", () => {
        expect([...MULE1_ORDER]).toEqual(['H1', 'H4', 'H4k', 'H6', 'H4p', 'H7', 'H8', 'H9', 'H10', 'H12', 'H13', 'H14', 'H15', 'H16', 'H18', 'H19', 'H20', 'H21d', 'H22']);
        expect([...MULE1_ON_REQUEST]).toEqual(['H4e']);
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
        // H4m's loads follow H4p when the ledger carries the row (rs/41)
        const order: string[] = [...MULE1_ORDER];
        order.splice(order.indexOf('H4p') + 1, 0, ...h4mLoadRows(manifest));
        for (const form of ['ask', 'fixed'] as const) {
            const lp = muleFromLedger(manifest, { form });
            const onRequest = MULE1_ON_REQUEST.filter(id => !onRequestGaps(manifest).includes(id));
            expect(lp.map(p => p.row)).toEqual([...order, ...onRequest]);
            for (const p of lp) expect(p.slots).toBeLessThanOrEqual(28);
            expect(muleDrift(packagesOf(lp), lp)).toEqual([]);
        }
    });

    test("H12's shark line takes its max from the row's `to`", () => {
        const manifest = readFileSync(MANIFEST, 'utf8').replace(/^\| H4m\.1-H4m\.\d+ \|.*\n/m, '');
        const row = parseLedger(manifest).rows.find(r => r.row === 'H12')!;
        const shark = row.in.find(e => e.name === 'shark' && e.topUp);
        const h12 = muleFromLedger(manifest, { rows: ['H12'] })[0]!;
        if (shark) expect(h12.package.items).toContainEqual({ item: 'Shark', topUp: { max: shark.count! } });
        else expect(h12.package.items.some(i => 'topUp' in i)).toBe(false);
    });

    test("H13's package, regenerated from the ledger, carries `shark to 2` as a top-up of 2 (T15-16b's food)", () => {
        const h13 = muleFromLedger(readFileSync(MANIFEST, 'utf8').replace(/^\| H4m\.1-H4m\.\d+ \|.*\n/m, ''), { rows: ['H13'] })[0]!;
        expect(h13.package.items).toContainEqual({ item: 'Shark', topUp: { max: 2 } });
        expect(h13.topUps).toContainEqual({ item: expect.stringMatching(/^shark$/i), to: 2 });
    });
});


describe('deliverable runtime configurations', () => {
    const delivery = { deliveryRun: 'attempt-unique-01', serve: 'receiver' };
    const generated = () => {
        const ledger = muleFromLedger(undefined, { rows: ['H1', 'H4', 'H4k'] });
        return { ledger, config: muleRunOptions(ledger, '/run/cues', delivery) };
    };

    // The archived owner projection is lab-only; it must never replace MANIFEST implicitly.
    const labArtifact = () => {
        const artifact = JSON.parse(readFileSync(join(import.meta.dir, '../../docs/speedrun/research/mule-delivery-production.json'), 'utf8')) as {
            purpose: string; sourceRevision: string; manifest: { path: string; sha256: string };
            provenance: { path: string; sha256: string };
            deliveryRun: string; receiver: { name: string; kind: string }; cueRoot: string; rows: string[]; onRequest: string[];
            excluded: Record<string, string>; assignmentApproval: Record<string, unknown>;
            validation: { fullReceiverFixture: string; fullRoute: string; blockers: Array<{ id: string; status: string }>; failedHistory: Array<{ id: string; status: string }> };
            accounts: Array<{ account: string; role: string; options: ReturnType<typeof muleRunOptions> }>;
        };
        const manifest = readFileSync(join(import.meta.dir, '../..', artifact.manifest.path), 'utf8');
        expect(createHash('sha256').update(manifest).digest('hex')).toBe(artifact.manifest.sha256);
        const provenanceText = readFileSync(join(import.meta.dir, '../..', artifact.provenance.path), 'utf8');
        expect(createHash('sha256').update(provenanceText).digest('hex')).toBe(artifact.provenance.sha256);
        const provenance = JSON.parse(provenanceText);
        expect(provenance.purpose).toBe('LAB_ONLY_NOT_LIVE_AUTHORIZATION');
        expect(provenance.projection).toEqual(artifact.manifest);
        return { artifact, manifest };
    };

    test('owner-authorized full LAB projection produces regional configs in both forms, not route acceptance', () => {
        const { artifact, manifest } = labArtifact();
        for (const form of ['ask', 'fixed'] as const) {
            const ledger = muleFromLedger(manifest, { form, rows: artifact.rows, onRequest: artifact.onRequest });
            expect(() => muleRunOptions(ledger, '/run/cues', delivery)).toThrow('Unsafe cross-region');
            const east = new Set(['H1', 'H4', 'H4k', 'H18', 'H19', 'H20', 'H21d', 'H22', 'H4e']);
            // Fixture names do not authorize deploying any real carrier.
            const accounts = Object.fromEntries(ledger.map(l => [l.row, east.has(l.row) ? 'east_fixture' : 'west_fixture']));
            const partitioned = muleRunOptionsByAccount(ledger, '/run/cues', { ...delivery, accounts });
            expect(partitioned).toHaveLength(2);
            for (const { account, options: config } of partitioned) {
                const assigned = ledger.filter(l => accounts[l.row] === account);
                expect(muleOptions({ ...config }).packages).toEqual(config.packages);
                expect(muleDrift(config, assigned, { delivery })).toEqual([]);
                expect(config.packages.map(p => p.items)).toEqual(packagesOf(assigned).map(p => materializeDeliveryPackage(p).items));
                expect(config.packages.map(p => p.scope?.step)).toEqual(assigned.map(l => l.row));
                expect(config.packages.filter(p => p.onRequest).map(p => p.scope!.step)).toEqual(assigned.filter(l => l.onRequest).map(l => l.row));
                expect(JSON.stringify(config)).not.toContain('"final":true');
                for (const p of config.packages) {
                    expect(p.at).toEqual(muleDelivery(p.scope!.step).at);
                    expect(p.bank).toEqual(muleDelivery(p.scope!.step).bank);
                }
            }
            const all = partitioned.flatMap(p => p.options.packages);
            expect(all).toHaveLength(ledger.length);
            for (const l of ledger) expect(all.filter(p => p.scope?.step === l.row)).toHaveLength(1);
            expect(all.find(p => p.scope?.step === 'H7')!.items).toContainEqual({ id: 1727, amount: 1 });
        }
    });

    test('persisted production LAB artifact matches its explicitly hashed projection, not the default manifest', () => {
        const { artifact, manifest } = labArtifact();
        expect(artifact.purpose).toBe('LAB_ONLY_NOT_LIVE_AUTHORIZATION');
        expect(artifact.sourceRevision).toMatch(/^[a-f0-9]{40}$/);
        expect(artifact.manifest.sha256).toMatch(/^[a-f0-9]{64}$/);
        expect(artifact.rows).toEqual([...MULE1_ORDER]);
        expect(artifact.onRequest).toEqual(['H4e']);
        expect(artifact.accounts.map(a => a.account)).toEqual(['cairn_mule1', 'cairn_h55', 'cairn_h03']);
        const ledger = muleFromLedger(manifest, { rows: artifact.rows, onRequest: artifact.onRequest });
        const rowAccounts = Object.fromEntries(artifact.accounts.flatMap(a => a.options.packages.map(p => [p.scope!.step, a.account])));
        expect(Object.keys(rowAccounts).sort()).toEqual(ledger.map(l => l.row).sort());
        const delivery = { deliveryRun: artifact.deliveryRun, serve: artifact.receiver.name, accounts: rowAccounts };
        expect(artifact.accounts.map(({ account, options }) => ({ account, options })))
            .toEqual(muleRunOptionsByAccount(ledger, artifact.cueRoot, delivery));
        for (const entry of artifact.accounts) {
            expect(entry.role).toBe('mule');
            expect(muleDrift(artifact, ledger.filter(l => rowAccounts[l.row] === entry.account), {
                account: entry.account, delivery, cueDir: muleCueDir(artifact.cueRoot),
            })).toEqual([]);
            expect(JSON.stringify(entry)).not.toContain('"final":true');
        }
        const packages = artifact.accounts.flatMap(a => a.options.packages);
        expect(packages).toHaveLength(20);
        for (const item of packages.flatMap(p => p.items)) {
            expect(Number.isInteger(item.id)).toBe(true);
            expect(item.item).toBeUndefined();
        }
        expect(artifact.validation.fullReceiverFixture).toBe('BLOCKED');
        expect(artifact.validation.fullRoute).toBe('BLOCKED');
        expect(artifact.validation.blockers).toContainEqual(expect.objectContaining({ id: 'H13', status: 'PROJECTION_REFRESHED_PENDING_OWNER' }));
        expect(artifact.validation.failedHistory).toContainEqual(expect.objectContaining({ id: 'H19->H20', status: 'FAILED_SAME_CARRIER' }));
        expect(artifact.validation.blockers).toContainEqual(expect.objectContaining({ id: 'H20', status: 'UNPROVEN_INDEPENDENT_CARRIER' }));
    });

    test('actual launcher artifact assigns only H20 to h03 without changing any delivery or implying route acceptance', () => {
        const { artifact } = labArtifact();
        expect(artifact.accounts.map(a => [a.account, a.options.packages.map(p => p.scope!.step)])).toEqual([
            ['cairn_mule1', ['H1', 'H4', 'H4k', 'H18', 'H19', 'H21d', 'H22', 'H4e']],
            ['cairn_h55', ['H6', 'H4p', 'H7', 'H8', 'H9', 'H10', 'H12', 'H13', 'H14', 'H15', 'H16']],
            ['cairn_h03', ['H20']],
        ]);
        const packages = artifact.accounts.flatMap(a => a.options.packages);
        // The package payload fingerprint is independent of account partitioning.
        const unchangedPackages = [...artifact.rows, ...artifact.onRequest].map(row => packages.find(p => p.scope!.step === row));
        expect(createHash('sha256').update(JSON.stringify(unchangedPackages)).digest('hex'))
            .toBe('fd8c7f58463fafefd48b9f1e600935621ec97b2a63af54370e0c00ed699266eb');
        expect(artifact.deliveryRun).toBe('rs529-production-lab-20261023');
        expect(artifact.receiver).toEqual({ name: 'mdr529production', kind: 'anonymous lab receiver; not scored credentials' });
        expect(artifact.cueRoot).toBe('/tmp/rs529-production-lab-20261023/cues');
        expect(artifact.excluded).toEqual({
            H3: 'Production three ring givers; not a mule delivery',
            H4m: 'Attempt 1 stock-only overflow fix; retained in canonical conditional audit, no fabricated receiver',
        });
        const parsed = parseLaunchConfig(artifact);
        const h03 = parsed.accounts.find(a => a.account === 'cairn_h03')!;
        const raw = artifact.accounts.find(a => a.account === 'cairn_h03')!;
        expect(Object.keys(raw).sort()).toEqual(['account', 'options', 'role', 'stopOn']);
        expect(h03).toMatchObject({ role: 'mule', stopOn: { step: 'H20', family: 'mule' }, loginOn: null, final: false });
        expect(h03.options).toEqual({ ...raw.options });
        expect(h03.cueDir).toBe(muleCueDir(artifact.cueRoot));
        expect(Object.keys(h03.options).sort()).toEqual(['cueDir', 'deliveryRun', 'packages', 'serve', 'serveMode']);
        expect(parsed.accounts.every(a => !a.final && a.loginOn === null)).toBe(true);
        expect(parsed.accounts.filter(a => a.stopOn !== null).map(a => a.account)).toEqual(['cairn_h03']);
        expect(artifact.assignmentApproval).toEqual({
            scope: 'CONFIG_LAB_ONLY',
            authority: 'main 2026-10-22 19:19 PDT, relayed by cairn://p/rs/529/1/builder',
            account: 'cairn_h03', rows: ['H20'],
            observedProfile: {
                skills: { hitpoints: 69, attack: 85, thieving: 99, allOthers: 1 },
                equipment: [], inventory: [{ item: 'Kebab', count: 9 }, { item: 'Coins', count: 1940 }],
                at: { x: 3211, z: 3463, level: 0 }, quests: 'unknown',
            },
            preparation: { phase: 'S22', login: 'before SCORED', idleDurationMinutes: '>10' },
            loginBudget: { addedAtStart: 1, start: 25, s21Peak: 26, r8Reserve: 1 },
            gates: { profileRoute: 'UNPROVEN', idleOverTenMinutes: 'UNPROVEN', healthReadiness: 'UNPROVEN', rowStopLogout: 'UNPROVEN' },
        });
    });

    test('raw H19 names its flour by id; the same row without the id refuses ambiguous flour rather than using the lab projection', () => {
        // STEP-MANIFEST H19 now reads `pot of flour @1933 x1 [u]`.
        const live = readFileSync(MANIFEST, 'utf8').replace(/^\| H4m\.1-H4m\.\d+ \|.*\n/m, '');
        expect(live).toContain('pot of flour @1933 x1 [u]');
        const ledger = muleFromLedger(undefined, { rows: ['H19'] });
        expect(ledger[0]!.package.items).toContainEqual({ id: 1933, amount: 1 });
        expect(() => muleRunOptions(ledger, undefined, delivery)).not.toThrow();
        const unnamed = muleFromLedger(live.replace('pot of flour @1933 x1 [u]', 'pot of flour x1 [u]'), { rows: ['H19'] });
        expect(unnamed[0]!.package.items).toContainEqual({ item: 'Pot of flour', amount: 1 });
        expect(() => muleRunOptions(unnamed, undefined, delivery))
            .toThrow(/Package h19: Pot of flour resolves to 2 tradeable object ids .*require explicit ledger @ID/);
    });

    test('account partitions require exact coverage and cannot hide a crossing behind display-name aliases', () => {
        const ledger = muleFromLedger(undefined, { rows: ['H1', 'H6'] });
        for (const accounts of [undefined, {}, { H1: 'east' }, { H1: 'east', H6: '' }, { H1: 'east', H6: 'west', H99: 'extra' }]) {
            expect(() => muleRunOptionsByAccount(ledger, undefined, { ...delivery, accounts } as Parameters<typeof muleRunOptionsByAccount>[2])).toThrow();
        }
        expect(() => muleRunOptionsByAccount(ledger, undefined, { ...delivery, accounts: { H1: 'Carrier One', H6: 'carrier_one' } })).toThrow('Unsafe cross-region');
        expect(muleRunOptionsByAccount(ledger, undefined, { ...delivery, accounts: { H1: 'east', H6: 'west' } }).map(p => p.account)).toEqual(['east', 'west']);
    });

    test('rejects absent identity, receiver, empty/duplicate rows and malformed scope', () => {
        const ledger = muleFromLedger();
        for (const bad of [undefined, {}, { deliveryRun: '', serve: 'x' }, { deliveryRun: 'run:row', serve: 'x' }, { deliveryRun: 'unique', serve: '' }]) {
            expect(() => muleRunOptions(ledger, undefined, bad as typeof delivery)).toThrow();
        }
        expect(() => muleRunOptions([], undefined, delivery)).toThrow('nonempty');
        expect(() => muleRunOptions([ledger[0]!, ledger[0]!], undefined, delivery)).toThrow('Duplicate');
        const wrong = structuredClone(ledger[0]!);
        wrong.package.scope!.step = 'H99';
        expect(() => muleRunOptions([wrong], undefined, delivery)).toThrow('scope');
    });

    test('actual config drift rejects missing/empty locations, wrong planes, wrong rows, final and stock drift', () => {
        const { ledger, config } = generated();
        for (const field of ['at', 'bank'] as const) {
            for (const tile of [undefined, {}, null, { x: 3222, z: 3222 }, { ...config.packages[0]![field], level: 1 }]) {
                const changed = structuredClone(config) as unknown as { packages: Record<string, unknown>[] };
                changed.packages[0]![field] = tile;
                expect(muleDrift(changed, ledger, { delivery }).some(s => s.includes(field))).toBe(true);
            }
        }
        for (const change of [{ deliveryRun: undefined }, { serve: '' }, { final: true }, { packages: [] }]) {
            expect(muleDrift({ ...config, ...change }, ledger, { delivery }).length).toBeGreaterThan(0);
        }
        const changed = structuredClone(config);
        changed.packages[0]!.items[0] = { id: 1383, amount: 2 };
        expect(muleDrift(changed, ledger, { delivery }).some(s => s.includes('x2'))).toBe(true);
        expect(muleDrift({ accounts: [{ account: 'cairn_mule1', options: config }] }, ledger, { delivery })).toEqual([]);
        expect(muleDrift({ accounts: [{ account: 'cairn_mule1', final: true, options: config }] }, ledger, { delivery })).toContain('delivery: Delivery must not set final:true');
        expect(muleDrift(config, ledger, { delivery: { ...delivery, deliveryRun: 'different-attempt' } })).toContain('deliveryRun differs from the expected run different-attempt');
    });

    test('explicit transformed rehearsal manifest supplies H3 items; no quantity rewrite or production reassignment', () => {
        // The rehearsal owner supplies applyLedgerSubs output; this fixture stands for that boundary.
        const manifest = TABLE.replace('| H12 |', '| H3 | law rune x47 [s]; air rune x221 [s]; fire rune x9 [s]; mind rune x32 [s] | - | - | 4 | approved rehearsal (r) |\n| S04 | - | - | - | 0 | fixture (r) |\n| H12 |');
        const ledger = muleFromLedger(manifest, { rows: ['H1', 'H3', 'H21d'] });
        expect(() => muleRunOptions(ledger, undefined, delivery)).toThrow('ring givers');
        const rehearsal = { ...delivery, itinerary: { rehearsal: { firemakingEnd: { x: 3223, z: 3219, level: 0 } } } };
        const config = muleRunOptions(ledger, undefined, rehearsal);
        expect(config.packages[1]!.items).toEqual(materializeDeliveryPackage(ledger[1]!.package).items);
        expect(config.packages[1]!.at).toEqual(rehearsal.itinerary.rehearsal.firemakingEnd);
        expect(muleDrift(config, ledger, { delivery: rehearsal })).toEqual([]);
    });

    test('CLI requires explicit run and receiver, emits complete actual options, and rejects unknown rows', () => {
        const cli = (args: string[]) => Bun.spawnSync([process.execPath, 'speedrun/helpers/mule-ledger.ts', ...args]);
        expect(cli([]).exitCode).not.toBe(0);
        expect(cli(['--delivery-run', 'cli-attempt']).exitCode).not.toBe(0);
        expect(cli(['--delivery-run', 'cli-attempt', '--serve', 'receiver']).exitCode).not.toBe(0);
        const selected = ['--rows', 'H1,H4,H4k'];
        const result = cli([...selected, '--delivery-run', 'cli-attempt', '--serve', 'receiver']);
        expect(result.exitCode).toBe(0);
        const options = JSON.parse(result.stdout.toString());
        expect(muleOptions(options).deliveryRun).toBe('cli-attempt');
        expect(muleDrift(options, muleFromLedger(undefined, { rows: ['H1', 'H4', 'H4k'] }))).toEqual([]);
        expect(options.final).toBeUndefined();
        const path = join(mkdtempSync(join(tmpdir(), 'mule-runtime-check-')), 'options.json');
        writeFileSync(path, JSON.stringify(options));
        const checkArgs = [...selected, '--check', path, '--delivery-run', 'cli-attempt', '--serve', 'receiver'];
        expect(cli(checkArgs).exitCode).toBe(0);
        delete options.packages[0].at.level;
        writeFileSync(path, JSON.stringify(options));
        expect(cli(checkArgs).exitCode).toBe(1);
        expect(cli(['--rows', 'H99', '--delivery-run', 'cli-attempt', '--serve', 'receiver']).exitCode).not.toBe(0);
        // Eight sequential CLI spawns: about 2.7 s each on a loaded host, far past bun's 5 s default.
    }, 60_000);
});


describe('ledger-derived carry-ahead and independent carrier stock', () => {
    const delivery = { deliveryRun: 'carry-test', serve: 'receiver' };

    test('H4 carries H4k without duplicating stock lines and bounds all twenty returned rings', () => {
        const ledger = muleFromLedger(undefined, { rows: ['H4', 'H4k'] });
        const config = muleRunOptions(ledger, undefined, delivery);
        expect(config.packages[0]!.carryNext).toBe(true);
        expect(config.packages[0]!.takeBackSlots).toBe(20);
        expect(ledger[0]!.takeBackSlots).toBe(20);
        expect(ledger[0]!.takesBack).toEqual([]); // placeholder returns are not bank-stock credits
        expect(config.packages[1]!.carryNext).toBeUndefined();
        expect(config.packages.map(p => p.items)).toEqual(ledger.map(l => materializeDeliveryPackage(l.package).items));
        expect(muleDrift(config, ledger, { delivery })).toEqual([]);
        const withoutCarry = structuredClone(config);
        delete withoutCarry.packages[0]!.carryNext;
        expect(muleDrift(withoutCarry, ledger, { delivery })).toContain('H4: carryNext differs from canonical carry plan');
        const wrongReturn = structuredClone(config);
        wrongReturn.packages[0]!.takeBackSlots = 0;
        expect(muleDrift(wrongReturn, ledger, { delivery })).toContain('H4: takeBackSlots differs from canonical carry plan');
    });

    test('carry binds only immediately adjacent ordered rows on the same assigned carrier', () => {
        for (const row of ['H4', 'H4k']) {
            const ledger = muleFromLedger(undefined, { rows: [row] });
            expect(muleRunOptions(ledger, undefined, delivery).packages[0]!.carryNext).toBeUndefined();
        }
        const ledger = muleFromLedger(undefined, { rows: ['H4', 'H4k'] });
        const split = muleRunOptionsByAccount(ledger, undefined, { ...delivery, accounts: { H4: 'giver_a', H4k: 'giver_b' } });
        expect(split.every(e => !e.options.packages.some(p => p.carryNext))).toBe(true);
        const unbounded = structuredClone(ledger);
        unbounded[0]!.takeBackSlots = null;
        expect(() => muleRunOptions(unbounded, undefined, delivery)).toThrow('bounded ledger return-slot');
    });

    test('a split carrier does not inherit stock returned to another account', () => {
        const ledger = muleFromLedger(undefined, { rows: ['H12', 'H22'] });
        const split = muleRunOptionsByAccount(ledger, undefined, { ...delivery, accounts: { H12: 'west_fixture', H22: 'east_fixture' } });
        const east = ledger.filter(l => split.find(p => p.account === 'east_fixture')!.options.packages.some(p => p.scope?.step === l.row));
        expect(stockWalk(east, []).some(s => s.includes('obj 1329 wanted 1'))).toBe(true);
        // This credit is legal only for a single account, which topology now refuses to route.
        expect(stockWalk(ledger, []).some(s => s.includes('obj 1329 wanted 1'))).toBe(false);
        expect(() => muleRunOptions(ledger, undefined, delivery)).toThrow('Unsafe cross-region');
    });
});

describe('delivery object identity boundary', () => {
    const delivery = { deliveryRun: 'identity-bound-run', serve: 'receiver' };
    const generatedRow = (row: string) => muleRunOptions(muleFromLedger(undefined, { rows: [row] }), undefined, delivery);

    test('actual generated H4k rejects a bank containing only tutorial logs', () => {
        const config = generatedRow('H4k');
        const plan = planPackage(config.packages[0]!, [
            { slot: 0, id: 1359, name: 'Rune axe', count: 1 },
            { slot: 1, id: 946, name: 'Knife', count: 1 },
            { slot: 2, id: 2511, name: 'Logs', count: 1 },
        ]);
        expect(plan.withdrawals.some(w => w.bankItem.id === 2511)).toBe(false);
        expect(plan.missing).toContainEqual({ item: 'obj 1511', wanted: 1, have: 0 });
    });

    test('actual generated H9 rejects a bank containing only quest coins', () => {
        const config = generatedRow('H9');
        const plan = planPackage(config.packages[0]!, [
            { slot: 0, id: 617, name: 'Coins', count: 5 },
            { slot: 1, id: 563, name: 'Law rune', count: 1 },
            { slot: 2, id: 555, name: 'Water rune', count: 2 },
            { slot: 3, id: 385, name: 'Shark', count: 3 },
        ]);
        expect(plan.withdrawals.some(w => w.bankItem.id === 617)).toBe(false);
        expect(plan.missing).toContainEqual({ item: 'obj 995', wanted: 5, have: 0 });
    });

    test('runtime refuses an explicit untradeable object before staging', () => {
        const config = generatedRow('H4k');
        for (const id of [2511, 617, 74, 75]) {
            const bad = structuredClone(config);
            bad.packages[0]!.items = [{ id, amount: 1 }];
            expect(() => muleOptions({ ...bad })).toThrow('untradeable');
        }
    });

    test('runtime requires bound object ids rather than names from a stale generated config', () => {
        const config = generatedRow('H4k');
        config.packages[0]!.items = [{ item: 'Logs', amount: 1 }];
        expect(() => muleOptions({ ...config })).toThrow('id');
    });
});

describe('content-backed delivery materialization', () => {
    test('ambiguous and unknown names require an explicit ledger identity', () => {
        for (const item of ['Pot of flour', 'Unfinished potion', 'No such object']) {
            expect(() => materializeDeliveryPackage({ name: 'ambiguous', items: [{ item, amount: 1 }] })).toThrow('explicit ledger @ID');
        }
        expect(materializeDeliveryPackage({ name: 'pinned', items: [{ id: 1933, amount: 1 }] }).items).toEqual([{ id: 1933, amount: 1 }]);
    });

    test('notes and top-up maxima retain their original form and quantity', () => {
        const fixed = materializeDeliveryPackage({ name: 'noted', items: [{ id: 92, amount: 358 }] });
        expect(fixed.items).toEqual([{ id: 92, amount: 358 }]);
        const plan = planPackage(fixed, [{ id: 91, name: 'Unfinished potion', slot: 0, count: 358 }]);
        expect(plan.withdrawals[0]).toMatchObject({ amount: 358, noted: true });
        expect(plan.slots).toBe(1);
        expect(materializeDeliveryPackage({ name: 'top-up', scope: { step: 'H22', family: 'mule' }, items: [{ item: 'Coins', topUp: { max: 126000 } }] }).items)
            .toEqual([{ id: 995, topUp: { max: 126000 } }]);
        expect(() => materializeDeliveryPackage({ name: 'bad', items: [{ id: 2511, amount: 1 }] })).toThrow('untradeable');
    });

    test('stock credits retain canonical identity and stackability after a return', () => {
        const table = `
| row | in | out | equip | needAtStart | source |
|---|---|---|---|---|---|
| H1 | knife x1 [u] | coins @995 x1000 (swap) | - | 1 | fixture (r) |
| S01 | - | - | - | 0 | fixture (r) |
| H9 | coins @995 x1000 [s] | - | - | 1 | fixture (r) |
| S12 | - | - | - | 0 | fixture (r) |
`;
        const ledger = muleFromLedger(table, { rows: ['H1', 'H9'] });
        expect(stockWalk(ledger, [{ id: 946, name: 'Knife', slot: 0, count: 1 }])).toEqual([]);
        expect(stockWalk(muleFromLedger(undefined, { rows: ['H9'] }), [{ id: 617, name: 'Coins', slot: 0, count: 5 }]))
            .toContain('H9: obj 995 wanted 5, the bank holds 0');
    });
});

describe("H4m's loads: one fallback row, N ordered packages after H4p on its carrier", () => {
    const live = readFileSync(MANIFEST, 'utf8').replace(/^\| H4m\.1-H4m\.\d+ \|.*\n/m, '');
    // rs/701's row (rs/158 writes it once main rules H4m in): one load per line, N loads in the id.
    const ROW = '| H4m.1-H4m.10 | big bones @532 x20 [u] | - | - | 20 | rs/701 fixture (r) |';
    const withRow = (row = ROW) => {
        expect(live).toContain('| H4e |');
        return live.replace(/^\| H4e \|/m, `${row}\n| H4e |`);
    };
    const LOADS = Array.from({ length: 10 }, (_, k) => `H4m.${k + 1}`);
    const delivery = { deliveryRun: 'h4m-test', serve: 'receiver' };
    const west = { H6: 'cairn_h55', H4p: 'cairn_h55', H7: 'cairn_h55' };

    test('the row is the switch: no H4m row on the run manifest, so no loads anywhere', () => {
        expect(parseFallbacks(live).some(r => /^H4m/.test(r.row))).toBe(false);
        // the run's own manifest carries the row in force since main's GO (attempt 4)
        expect(h4mLoadRows()).toEqual(['H4m.1', 'H4m.2', 'H4m.3', 'H4m.4', 'H4m.5']);
        expect(muleFromLedger(live, { rows: ['H6', 'H4p', 'H7'] }).map(l => l.row)).toEqual(['H6', 'H4p', 'H7']);
        expect(h4mLoadRows(withRow())).toEqual(LOADS);
        expect(h4mLoadRows(withRow(ROW.replace('H4m.1-H4m.10', 'H4m.1-H4m.1')))).toEqual(['H4m.1']);
    });

    test('the row expands into N packages right after H4p, each its own scope, the one load, feeding S09', () => {
        const ledger = muleFromLedger(withRow(), { rows: ['H6', 'H4p', 'H7'] });
        expect(ledger.map(l => l.row)).toEqual(['H6', 'H4p', ...LOADS, 'H7']);
        const loads = ledger.filter(l => l.anchor !== undefined);
        expect(loads.map(l => l.row)).toEqual(LOADS);
        for (const [k, l] of loads.entries()) {
            expect(l.package).toEqual({ name: `h4m.${k + 1}`, items: [{ id: 532, amount: 20 }], scope: { step: `H4m.${k + 1}`, family: 'mule' } });
            expect(l).toMatchObject({ onRequest: false, step: 'S09', anchor: H4M_ANCHOR, slots: 20, takeBackSlots: 0, takesBack: [], topUps: [] });
        }
        expect(ledger.find(l => l.row === 'H4p')!.step).toBe('S09');
        // Each load is a separate object: changing one cannot change another.
        loads[0]!.package.items[0] = { id: 532, amount: 1 };
        expect(loads[1]!.package.items).toEqual([{ id: 532, amount: 20 }]);
        // The rows around them are exactly what they are without the row.
        expect(ledger.filter(l => l.anchor === undefined)).toEqual(muleFromLedger(live, { rows: ['H6', 'H4p', 'H7'] }));
        for (const form of ['ask', 'fixed'] as const) expect(muleFromLedger(withRow(), { form }).map(l => l.row)).toEqual([...MULE1_ORDER.slice(0, 5), ...LOADS, ...MULE1_ORDER.slice(5), 'H4e']);
    });

    test('no H4p selected, no loads; never selected or requested by name; one well-formed row, a fixed load with nothing back', () => {
        expect(muleFromLedger(withRow(), { rows: ['H6', 'H7'] }).map(l => l.row)).toEqual(['H6', 'H7']);
        expect(() => muleFromLedger(withRow(), { rows: ['H4p', 'H4m.1'] })).toThrow("H4m.1: H4m's loads come with H4p");
        expect(() => muleFromLedger(withRow(), { rows: ['H4p'], onRequest: ['H4m'] })).toThrow("H4m: H4m's loads come with H4p");
        for (const bad of ['H4m.1-H4m.0', 'H4m.2-H4m.10', 'H4m.x', 'H4m.1-H4m.10x']) {
            expect(() => muleFromLedger(withRow(ROW.replace('H4m.1-H4m.10', bad)), { rows: ['H4p'] })).toThrow('must be the one row H4m.1-H4m.N');
        }
        // A bare H4m row is attempt 1's retired on-request package: not the switch.
        expect(muleFromLedger(withRow(ROW.replace('H4m.1-H4m.10', 'H4m')), { rows: ['H4p'] }).map(l => l.row)).toEqual(['H4p']);
        expect(h4mLoadRows(withRow(ROW.replace('H4m.1-H4m.10', 'H4m')))).toEqual([]);
        expect(() => muleFromLedger(withRow(`${ROW}\n${ROW}`), { rows: ['H4p'] })).toThrow('must be the one row');
        expect(() => muleFromLedger(withRow(ROW.replace('big bones @532 x20 [u]', 'big bones @532 to 20 [u]')), { rows: ['H4p'] })).toThrow('a load is a fixed count');
        expect(() => muleFromLedger(withRow(ROW.replace('| - | - | 20 |', '| bones x1 (swap) | - | 20 |')), { rows: ['H4p'] })).toThrow('a load takes nothing back');
        expect(() => muleFromLedger(withRow(ROW.replace('x20 [u]', 'x29 [u]')), { rows: ['H4p'] })).toThrow('more than the mule');
    });

    test("h55's order: H6, H4p, H4m.1..N, H7; load 1 carried with H4p (22 of 28 slots), each load at the stand, banked at Ardougne south", () => {
        const ledger = muleFromLedger(withRow(), { rows: ['H6', 'H4p', 'H7'] });
        const [entry, ...rest] = muleRunOptionsByAccount(ledger, '/run/cues', { ...delivery, accounts: west });
        expect(rest).toEqual([]);
        expect(entry!.account).toBe('cairn_h55');
        const packages = entry!.options.packages;
        expect(packages.map(p => p.scope!.step)).toEqual(['H6', 'H4p', ...LOADS, 'H7']);
        const h4p = packages[1]!;
        expect(h4p.carryNext).toBe(true);
        expect(h4p.takeBackSlots).toBe(0);
        for (const p of packages.slice(2)) {
            expect(p.carryNext).toBeUndefined();
            expect(p.takeBackSlots).toBeUndefined();
        }
        for (const p of packages.slice(2, 12)) {
            expect(p.at).toEqual(H4M_STAND);
            expect(p.bank).toEqual({ x: 2654, z: 3283, level: 0 });
            expect(p.items).toEqual([{ id: 532, amount: 20 }]);
        }
        expect(muleDrift(entry!.options, ledger, { delivery })).toEqual([]);
        const uncarried = structuredClone(entry!.options);
        delete uncarried.packages[1]!.carryNext;
        expect(muleDrift(uncarried, ledger, { delivery })).toContain('H4p: carryNext differs from canonical carry plan');
        // The carry group the carrier stages from its bank: H4p's pickaxe and log, then 20 big bones.
        const options = muleOptions({ ...entry!.options });
        const ordered = options.packages.filter(p => !p.onRequest);
        const group = deliveryGroup(ordered, ordered[1]!);
        expect(group.map(p => p.name)).toEqual(['h4p', 'h4m.1']);
        const stage = planCarryGroup(group, [
            { slot: 0, id: 1275, name: 'Rune pickaxe', count: 1 }, { slot: 1, id: 1511, name: 'Logs', count: 7 }, { slot: 2, id: 532, name: 'Big bones', count: 200 },
        ]);
        expect(stage.peakSlots).toBe(22);
        expect(Object.fromEntries(stage.inventory)).toEqual({ 1275: 1, 1511: 1, 532: 20 });
        // Two loads never fit: H4m.2 and later each take a bank trip.
        expect(() => planCarryGroup([...group, ordered[3]!], [{ slot: 0, id: 1275, name: 'Rune pickaxe', count: 1 }, { slot: 1, id: 1511, name: 'Logs', count: 7 }, { slot: 2, id: 532, name: 'Big bones', count: 200 }])).toThrow('42 slots');
    });

    test("loads ride H4p's carrier: no binding of their own needed, a different one refused, and a carrier without H4p gets none", () => {
        const ledger = muleFromLedger(withRow(), { rows: ['H6', 'H4p', 'H7'] });
        expect(muleRunOptionsByAccount(ledger, undefined, { ...delivery, accounts: { ...west, 'H4m.3': 'Cairn H55' } })[0]!.options.packages).toHaveLength(13);
        expect(() => muleRunOptionsByAccount(ledger, undefined, { ...delivery, accounts: { ...west, 'H4m.3': 'cairn_mule2' } })).toThrow("H4m.3: a load rides H4p's carrier, cairn_h55");
        expect(() => muleRunOptionsByAccount(ledger, undefined, { ...delivery, accounts: { H6: 'cairn_h55', H7: 'cairn_h55' } })).toThrow('H4p: explicit account binding');
        // H4p and H4m.1 on different carriers: no carry.
        const split = muleRunOptionsByAccount(ledger.filter(l => l.row !== 'H6' && l.row !== 'H7'), undefined, { ...delivery, accounts: { H4p: 'west_a' } });
        expect(split[0]!.options.packages[0]!.carryNext).toBe(true);
        const alone = muleRunOptions(ledger.filter(l => l.row === 'H4p'), undefined, delivery);
        expect(alone.packages[0]!.carryNext).toBeUndefined();
    });

    test("the production binding puts every load on h55 between H4p and H7; mule1's and h03's configs are unchanged", () => {
        const prod = JSON.parse(readFileSync(join(import.meta.dir, '../../docs/speedrun/research/mule-delivery-production.json'), 'utf8')) as {
            rows: string[]; onRequest: string[]; accounts: { account: string; options: { packages: { scope?: { step: string; family: string } }[] } }[];
        };
        // carriers-gen.ts's own reading of the binding.
        const accounts: Record<string, string> = {};
        for (const a of prod.accounts) for (const p of a.options.packages) if (p.scope?.family === 'mule') accounts[p.scope.step] = a.account;
        const rows = prod.rows.filter(r => accounts[r]);
        const gen = (manifest: string) => muleRunOptionsByAccount(muleFromLedger(manifest, { form: 'ask', rows, onRequest: prod.onRequest }), '/run/cues', { ...delivery, accounts });
        const before = gen(live);
        const after = gen(withRow());
        expect(after.map(a => a.account)).toEqual(before.map(a => a.account));
        const steps = (e: (typeof after)[number]) => e.options.packages.map(p => p.scope!.step);
        expect(steps(before.find(a => a.account === 'cairn_h55')!)).toEqual(['H6', 'H4p', 'H7', 'H8', 'H9', 'H10', 'H12', 'H13', 'H14', 'H15', 'H16']);
        expect(steps(after.find(a => a.account === 'cairn_h55')!)).toEqual(['H6', 'H4p', ...LOADS, 'H7', 'H8', 'H9', 'H10', 'H12', 'H13', 'H14', 'H15', 'H16']);
        for (const account of ['cairn_mule1', 'cairn_h03']) expect(after.find(a => a.account === account)).toEqual(before.find(a => a.account === account)!);
    });

    test('carriers-gen.ts at this commit: byte-identical output without the row; with it, only h55 gains the loads and the H4p carry', () => {
        const root = join(import.meta.dir, '../..');
        // A scratch checkout: speedrun copied (MANIFEST is resolved from slot-ledger.ts's own directory),
        // the STEP-MANIFEST given or not the row, everything else linked.
        const checkout = (manifest: string) => {
            const c = mkdtempSync(join(tmpdir(), 'h4m-carriers-'));
            cpSync(join(root, 'speedrun'), join(c, 'speedrun'), { recursive: true });
            for (const f of ['sdk', 'server', 'node_modules', 'package.json', 'tsconfig.json', 'bunfig.toml']) symlinkSync(join(root, f), join(c, f));
            mkdirSync(join(c, 'docs/speedrun/research'), { recursive: true });
            writeFileSync(join(c, 'docs/speedrun/STEP-MANIFEST.md'), manifest);
            cpSync(join(root, 'docs/speedrun/research/mule-delivery-production.json'), join(c, 'docs/speedrun/research/mule-delivery-production.json'));
            return c;
        };
        const run = (c: string) => {
            const out = join(mkdtempSync(join(tmpdir(), 'h4m-carriers-out-')), 'carriers.json');
            const r = Bun.spawnSync([process.execPath, join(root, 'docs/speedrun/scripts/carriers-gen.ts'), '/run/rc-cue', out], { env: { ...process.env, CHECKOUT: c, SCORED_NAME: 'lab_scored' }, stdout: 'pipe', stderr: 'pipe' });
            expect(r.stderr.toString()).toBe('');
            expect(r.exitCode).toBe(0);
            return readFileSync(out, 'utf8');
        };
        const today = run(root);
        const absent = run(checkout(live));
        const present = run(checkout(withRow()));
        expect(absent).not.toContain('h4m');
        // The checkout's own ledger carries the row in force (attempt 4): its output is the row-less one plus exactly the loads and the H4p carry.
        {
            type Pkgs = { accounts: { account: string; options: { packages: { name: string; carryNext?: true; takeBackSlots?: number }[] } }[] };
            const inForce = JSON.parse(today) as Pkgs;
            const o = inForce.accounts.find(a => a.account === 'cairn_h55')!.options;
            expect(o.packages.filter(p => p.name.startsWith('h4m.')).map(p => p.name)).toEqual(h4mLoadRows(readFileSync(MANIFEST, 'utf8')).map(r => r.toLowerCase()));
            o.packages = o.packages.filter(p => !p.name.startsWith('h4m.'));
            delete o.packages.find(p => p.name === 'h4p')!.carryNext;
            delete o.packages.find(p => p.name === 'h4p')!.takeBackSlots;
            expect(JSON.stringify(inForce, null, 2) + '\n').toBe(absent);
        }
        type Out = { accounts: { account: string; options: { packages: { name: string; carryNext?: true; takeBackSlots?: number }[] } }[] };
        const without = JSON.parse(absent) as Out;
        const withLoads = JSON.parse(present) as Out;
        const h55 = withLoads.accounts.find(a => a.account === 'cairn_h55')!.options;
        expect(h55.packages.filter(p => p.name.startsWith('h4m.')).map(p => p.name)).toEqual(LOADS.map(r => r.toLowerCase()));
        expect(h55.packages.find(p => p.name === 'h4p')).toMatchObject({ carryNext: true, takeBackSlots: 0 });
        // Strip what the row adds; the rest is today's output byte for byte.
        h55.packages = h55.packages.filter(p => !p.name.startsWith('h4m.'));
        delete h55.packages.find(p => p.name === 'h4p')!.carryNext;
        delete h55.packages.find(p => p.name === 'h4p')!.takeBackSlots;
        expect(JSON.stringify(withLoads, null, 2) + '\n').toBe(JSON.stringify(without, null, 2) + '\n');
        expect(JSON.stringify(without, null, 2) + '\n').toBe(absent);
    }, 120_000);
});
