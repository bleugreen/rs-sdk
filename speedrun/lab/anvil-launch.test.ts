import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { anvilOptions, statusFile } from '../helpers/anvil';
import { parseLaunchConfig } from '../helpers/standalone';
import { STAND_IN_STEP } from '../runner/run-report';
import { anvilGaps, anvilLaunch, anvilReady, runsS25a } from './anvil-launch';
import { giverGaps } from './dress-rehearsal';

const S25A = [{ id: 'T24-25', name: 'leg' }, { id: 'S25a', name: 'S25a smithing 01/31 bronze' }, { id: 'S25a', name: 'S25a smithing 02/31 iron' }, { id: 'S25d', name: 'S25d crafting' }];
const JUMPED = [{ id: 'T24-25', name: 'leg' }, { id: 'S25a', name: `${STAND_IN_STEP} S25a (staff jump to S25d)` }, { id: 'S25d', name: 'S25d crafting' }];
const none = { ringers: [], altarGivers: [] };

describe('anvilLaunch', () => {
    test("one anvil entry, the run day's (relay path, bank restock, the {S25a, anvil} scope) with lab stock; standalone.ts and anvil.ts take it as written", () => {
        const c = anvilLaunch({ account: 'cairn_h85', botsDir: '/tmp/b', runDir: '/tmp/r', gatewayPort: 8310 });
        expect(c).toEqual({ gatewayPort: 8310, botsDir: '/tmp/b', runDir: '/tmp/r', loginSpacingMs: 2000, accounts: [{ account: 'cairn_h85', role: 'anvil', options: { restock: { kind: 'bank', labStock: true }, scope: { step: 'S25a', family: 'anvil' } } }] });
        const parsed = parseLaunchConfig(c);
        expect(parsed.accounts.map(e => [e.account, e.role, e.path, e.after])).toEqual([['cairn_h85', 'anvil', 'relay', 'login']]);
        expect(anvilOptions(parsed.accounts[0]!.options, { RC_CUE_DIR: '/tmp/cue' })).toMatchObject({ restock: { kind: 'bank', labStock: true }, scope: { step: 'S25a', family: 'anvil' }, cueDir: '/tmp/cue' });
    });
});

describe('anvilReady', () => {
    test("serving phases with a fresh status are ready; start, fault, off or a stale file are not", () => {
        const dir = mkdtempSync(`${tmpdir()}/anvil-ready-`);
        const ready = anvilReady(dir);
        const now = 1_000_000;
        const put = (phase: string, ms: number) => writeFileSync(statusFile(dir, 'cairn_h85'), JSON.stringify({ v: 1, account: 'cairn_h85', phase, delivered: null, trades: 0, tile: null, ms }));
        expect(ready('cairn_h85', now)).toBe(false);
        put('waiting', now - 1000);
        expect(ready('cairn_h85', now)).toBe(true);
        put('restock', now - 1000);
        expect(ready('cairn_h85', now)).toBe(true);
        put('waiting', now - 60_000);
        expect(ready('cairn_h85', now)).toBe(false);
        for (const p of ['start', 'fault', 'off']) {
            put(p, now - 1000);
            expect(ready('cairn_h85', now)).toBe(false);
        }
    });
});

describe('anvilGaps (S25a without its anvil helper refuses, before SCORED logs in)', () => {
    test('a slice running S25a with no --anvil refuses, naming S25a, --anvil and --staff-steps', () => {
        const gaps = anvilGaps(S25A, {});
        expect(gaps).toHaveLength(1);
        expect(gaps[0]).toContain('S25a');
        expect(gaps[0]).toContain('--anvil=');
        expect(gaps[0]).toContain('--staff-steps=S25a');
    });

    test('a slice without S25a, or with S25a staff-jumped, needs no anvil helper', () => {
        expect(anvilGaps([{ id: 'S25d' }], {})).toEqual([]);
        expect(runsS25a(JUMPED)).toBe(false);
        expect(anvilGaps(JUMPED, {})).toEqual([]);
    });

    test('the helper is a cairn_ name, not on LAB_HELPERS, and no other flag names it', () => {
        expect(anvilGaps(S25A, { anvil: 'cairn_h85', labHelpers: ['lab_x'], others: ['cairn_rcg1'] })).toEqual([]);
        expect(anvilGaps(S25A, { anvil: 'lab_anvil' })[0]).toContain('not a cairn_ helper name');
        expect(anvilGaps(S25A, { anvil: 'cairn_h85', labHelpers: ['cairn_h85'] })[0]).toContain('is on LAB_HELPERS');
        expect(anvilGaps(S25A, { anvil: 'cairn_h85', others: ['cairn_h85'] })[0]).toContain('named by --anvil and by another giver flag');
    });

    test('giverGaps carries it: refused without --anvil, clear with it, clear when --staff-steps jumped S25a', () => {
        expect(giverGaps(S25A, none)[0]).toContain('--anvil=');
        expect(giverGaps(S25A, { ...none, anvil: 'cairn_h85' })).toEqual([]);
        expect(giverGaps(JUMPED, none)).toEqual([]);
    });
});
