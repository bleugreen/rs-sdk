import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MANIFEST } from '../tools/slot-ledger';
import { h45FromLedger, h45LauncherEntry, main, materializeDeliveryPackage, muleFromLedger } from './mule-ledger';
import { parseLaunchConfig } from './standalone';

const manifest = readFileSync(MANIFEST, 'utf8');
const saved = join(import.meta.dir, '../../docs/speedrun/scripts/h45-carried-packages.json');

describe('ledger-derived carried h45 entry', () => {
    test('maps only atoll rows to existing scopes; preserves ids, potion-first order and caps', () => {
        const ledger = h45FromLedger(manifest);
        expect(ledger.map(l => [l.row, l.package.name, l.package.scope?.step, l.slots])).toEqual([
            ['H12o-M', 'H12oM', 'H12oM', 15],
            ['H12o-P', 'H12oP', 'H12oP', 10],
        ]);
        expect(ledger.map(l => l.package.items)).toEqual([
            [{ id: 385, topUp: { max: 15 } }],
            [{ id: 2448, topUp: { max: 1 } }, { id: 385, topUp: { max: 9 } }],
        ]);
        expect(ledger.map(l => l.package.at)).toEqual([{ x: 2763, z: 2704 }, { x: 2803, z: 2724 }]);
    });

    test('caps come from row quantities, not another handwritten package', () => {
        const changed = manifest.replace('| H12o-M | shark to 15 [u]', '| H12o-M | shark to 14 [u]')
            .replace('| H12o-P | superantipoison(4) @2448 x1 [u]; shark x9 [u]',
                '| H12o-P | superantipoison(4) @2448 x1 [u]; shark x7 [u]');
        const ledger = h45FromLedger(changed);
        expect(ledger.map(l => l.package.items)).toEqual([
            [{ id: 385, topUp: { max: 14 } }],
            [{ id: 2448, topUp: { max: 1 } }, { id: 385, topUp: { max: 7 } }],
        ]);
        // Generic row semantics are unchanged: only the carried adapter interprets P as ask caps.
        expect(muleFromLedger(manifest, { rows: ['H12o-P'] })[0]!.package.items).toEqual([
            { id: 2448, amount: 1 }, { item: 'Shark', amount: 9 },
        ]);
    });

    test('canonical materializer binds identities and refuses ambiguous or untradeable replacements', () => {
        const materialize = (items: Parameters<typeof materializeDeliveryPackage>[0]['items']) =>
            materializeDeliveryPackage({ name: 'identity-boundary', scope: { step: 'H12oM', family: 'mule' }, items });
        expect(materialize([{ item: 'Shark', topUp: { max: 15 } }, { id: 2448, amount: 1 }]).items)
            .toEqual([{ id: 385, topUp: { max: 15 } }, { id: 2448, amount: 1 }]);
        for (const id of [74, 75, 4021, 617, 2511]) {
            expect(() => materialize([{ id, amount: 1 }])).toThrow(/untradeable/);
        }
        expect(() => materialize([{ item: 'Pot of flour', amount: 1 }])).toThrow(/require explicit ledger @ID/);
        expect(() => materialize([{ item: 'not an actual game object', amount: 1 }])).toThrow(/0 tradeable object ids/);
        expect(materialize([{ id: 1933, amount: 1 }]).items).toEqual([{ id: 1933, amount: 1 }]);
    });

    test('25 delivery slots leave only three for every retained item and guard food combined', () => {
        const deliverySlots = h45FromLedger(manifest).reduce((n, l) => n + l.slots, 0);
        expect(deliverySlots).toBe(25);
        expect(deliverySlots + 3).toBe(28);
        // Parent-supplied logout observation: coins and five quest leftovers occupy six slots.
        // Even allocating its existing 11 sharks to delivery does not make that real pack fit.
        expect(deliverySlots + 6).toBe(31);
        expect(deliverySlots + 6).toBeGreaterThan(28);
        expect(() => h45FromLedger(manifest.replace('| H12o-M | shark to 15 [u]', '| H12o-M | shark to 19 [u]')))
            .toThrow(/29 slots; capacity refused/);
    });

    test('missing rows fail closed rather than silently omitting a carried leg', () => {
        expect(() => h45FromLedger(manifest.replace('| H12o-M |', '| H12o-X |'))).toThrow(/no ledger row H12o-M/);
    });

    test('persisted exact config is generated from the current ledger', () => {
        const entry = h45LauncherEntry(manifest);
        expect(readFileSync(saved, 'utf8')).toBe(JSON.stringify(entry, null, 2) + '\n');
        expect(main(['--carried-h45', '--check', saved])).toBe(0);
    });

    test('exact config check rejects stale cap, fixed P, wrong order, scope, tile and extra fields', () => {
        const dir = mkdtempSync(join(tmpdir(), 'h45-config-'));
        const path = join(dir, 'config.json');
        for (const mutate of [
            (c: any) => { c.options.packages[0].items[0].topUp.max = 13; },
            (c: any) => { c.options.packages[1].items[0] = { id: 2448, amount: 1 }; },
            (c: any) => { c.options.packages[1].items.reverse(); },
            (c: any) => { c.options.packages[0].scope.step = 'H12o-M'; },
            (c: any) => { c.options.packages[1].at.x++; },
            (c: any) => { c.options.carried = false; },
            (c: any) => { c.loginOn.step = 'H12o-M'; },
            (c: any) => { c.options.unreviewed = true; },
        ]) {
            const entry = h45LauncherEntry(manifest);
            mutate(entry);
            writeFileSync(path, JSON.stringify(entry));
            expect(main(['--carried-h45', '--check', path])).toBe(1);
        }
    });

    test('closesOnStop only on request: the default entry has none; with it, stopOn H12oP closes on its first stop, and the launcher takes the entry', () => {
        const plain = h45LauncherEntry(manifest);
        expect(plain.stopOn).toEqual({ step: 'H12oP', family: 'mule' });
        expect(plain.stopOn).not.toHaveProperty('closesOnStop');
        const fallback = h45LauncherEntry(manifest, { closesOnStop: true });
        expect(fallback.stopOn).toEqual({ step: 'H12oP', family: 'mule', closesOnStop: true });
        expect({ ...fallback, stopOn: plain.stopOn }).toEqual(plain); // nothing else changes
        for (const e of [plain, fallback]) {
            const parsed = parseLaunchConfig({ accounts: [e] }).accounts[0]!;
            expect(parsed).toMatchObject({ account: 'cairn_h45', loginOn: { step: 'H12oM', family: 'mule' }, stopOn: e.stopOn, final: false });
        }
        const dir = mkdtempSync(join(tmpdir(), 'h45-closes-'));
        const path = join(dir, 'h45.json');
        writeFileSync(path, JSON.stringify(fallback));
        expect(main(['--carried-h45', '--closes-on-stop', '--check', path])).toBe(0);
        expect(main(['--carried-h45', '--check', path])).toBe(1);
        expect(main(['--carried-h45', '--closes-on-stop', '--check', saved])).toBe(1);
    });

    test('exclusive carried CLI refuses banked or fixed overrides and missing arguments', () => {
        for (const flag of ['--form', '--rows', '--on-request', '--bank', '--account', '--cue-root', '--delivery-run']) {
            expect(() => main(['--carried-h45', flag, 'override'])).toThrow(/does not accept/);
        }
        expect(() => main(['--carried-h45', '--manifest'])).toThrow(/needs a file/);
        expect(() => main(['--carried-h45', '--check', '--manifest'])).toThrow(/needs a file/);
    });
});
