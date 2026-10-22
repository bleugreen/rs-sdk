import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { parseOptions, serveOptions } from '../helpers/cannon';
import { serveDrift, serveFromLedger } from '../helpers/cannon-receiver';
import { parseLaunchConfig } from '../helpers/standalone';
import { STAND_IN_STEP } from '../runner/run-report';
import { MANIFEST } from '../tools/slot-ledger';
import { cannonHolderGaps, cannonHolderLaunch, holderReady, labServeLoad, runsH23 } from './cannon-launch';
import { giverGaps, LANDING_HELPER_TILE } from './dress-rehearsal';

const manifest = readFileSync(MANIFEST, 'utf8');
const H23 = [{ id: 'T26-27a', name: 'leg' }, { id: 'H23', name: 'H23 hand-off' }, { id: 'T26-27b', name: 'leg' }, { id: 'S27', name: 'S27 combat finish' }];
const JUMPED = [{ id: 'T26-27a', name: 'leg' }, { id: 'H23', name: `${STAND_IN_STEP} H23 (staff jump to T26-27b)` }, { id: 'S27', name: 'S27 combat finish' }];
const none = { ringers: [], altarGivers: [] };

describe('cannonHolderLaunch', () => {
    test("H23's holder: role cannon, serve on the landing helper tile with the ledger row's balls and extras exactly (no drift), lab stock, the {S27, cannon} scope; standalone.ts and cannon.ts take it as written", () => {
        const c = cannonHolderLaunch({ account: 'cairn_h92', tile: LANDING_HELPER_TILE, botsDir: '/tmp/b', runDir: '/tmp/r', gatewayPort: 8311, manifest });
        expect(c).toMatchObject({ gatewayPort: 8311, botsDir: '/tmp/b', runDir: '/tmp/r', loginSpacingMs: 2000 });
        expect(c.accounts).toHaveLength(1);
        const e = c.accounts[0]!;
        expect([e.account, e.role]).toEqual(['cairn_h92', 'cannon']);
        expect(e.options.serve).toMatchObject({ tile: { x: 2658, z: 3301 }, labStock: true, scope: { step: 'S27', family: 'cannon' } });
        const ledger = serveFromLedger('H23', manifest);
        expect(e.options.serve.balls).toBe(ledger.balls);
        expect(serveDrift(e.options.serve, ledger)).toEqual([]);
        const parsed = parseLaunchConfig(c);
        expect(parsed.accounts.map(a => [a.role, a.path])).toEqual([['cannon', 'relay']]);
        const so = serveOptions(parsed.accounts[0]!.options.serve, {});
        expect(so).toMatchObject({ tile: { x: 2658, z: 3301 }, balls: ledger.balls, labStock: true, returnTile: null, scope: { step: 'S27', family: 'cannon' } });
        expect(so.extras.every(x => typeof x.obj === 'string')).toBe(true);
        expect(parseOptions(parsed.accounts[0]!.options).serve).not.toBeNull();
    });

    test('labServeLoad serves a top-up at its full to count (the lab receiver starts empty), as cannon-handoff.ts does for H11', () => {
        const l = labServeLoad('H11', manifest);
        const ledger = serveFromLedger('H11', manifest);
        expect(l.balls).toBe(ledger.balls);
        expect(l.extras).toEqual([...ledger.extras, ...ledger.topUps.map(t => ({ item: t.item, count: t.to, obj: t.obj }))]);
        expect(readFileSync(join(import.meta.dir, 'cannon-handoff.ts'), 'utf8')).toContain("labServeLoad('H11')");
    });
});

test('holderReady: the last phase the role logged is serve-waiting or later', () => {
    const dir = mkdtempSync(join(tmpdir(), 'holder-ready-'));
    mkdirSync(join(dir, 'logs'));
    const ready = holderReady(dir);
    const put = (...to: string[]) => writeFileSync(join(dir, 'logs', 'cairn_h92.role.log'), to.map(t => JSON.stringify({ account: 'cairn_h92', role: 'cannon', message: 'phase', to: t })).join('\n'));
    expect(ready('cairn_h92')).toBe(false);
    put('serve-load', 'serve-travel');
    expect(ready('cairn_h92')).toBe(false);
    put('serve-load', 'serve-travel', 'serve-waiting');
    expect(ready('cairn_h92')).toBe(true);
});

describe('cannonHolderGaps (H23 without its holder refuses, before SCORED logs in)', () => {
    test('a slice running H23 with no --cannon-holder refuses, naming H23, the flag and --staff-steps', () => {
        const gaps = cannonHolderGaps(H23, {});
        expect(gaps).toHaveLength(1);
        expect(gaps[0]).toContain('H23');
        expect(gaps[0]).toContain('--cannon-holder=');
        expect(gaps[0]).toContain('--staff-steps=H23');
    });

    test('a slice without H23, or with H23 staff-jumped, needs no holder', () => {
        expect(cannonHolderGaps([{ id: 'S26' }], {})).toEqual([]);
        expect(runsH23(JUMPED)).toBe(false);
        expect(cannonHolderGaps(JUMPED, {})).toEqual([]);
    });

    test('the holder is a cairn_ name, not on LAB_HELPERS, and no other flag names it', () => {
        expect(cannonHolderGaps(H23, { cannonHolder: 'cairn_h92', labHelpers: ['lab_x'], others: ['cairn_anv1'] })).toEqual([]);
        expect(cannonHolderGaps(H23, { cannonHolder: 'lab_h' })[0]).toContain('not a cairn_ helper name');
        expect(cannonHolderGaps(H23, { cannonHolder: 'cairn_h92', labHelpers: ['cairn_h92'] })[0]).toContain('is on LAB_HELPERS');
        expect(cannonHolderGaps(H23, { cannonHolder: 'cairn_h92', others: ['cairn_h92'] })[0]).toContain('named by --cannon-holder and by another giver flag');
    });

    test('giverGaps carries it: refused without --cannon-holder, clear with it, clear when --staff-steps jumped H23', () => {
        expect(giverGaps(H23, none)[0]).toContain('--cannon-holder=');
        expect(giverGaps(H23, { ...none, cannonHolder: 'cairn_h92' })).toEqual([]);
        expect(giverGaps(JUMPED, none)).toEqual([]);
        expect(giverGaps(H23, { ...none, anvil: 'cairn_h92', cannonHolder: 'cairn_h92' }).join(' ')).toContain('cairn_h92 is named by --cannon-holder and by another giver flag');
    });
});
