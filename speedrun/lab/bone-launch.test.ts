import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { boneGiverOptions, S07_SITES } from '../helpers/bone-giver';
import { parseLaunchConfig } from '../helpers/standalone';
import { buildChain, KIT_PARTNER_ROWS, PLACEMENT } from '../runner/chain';
import { BONE_LOAD, CAMELOT_RUNES, S07_BONE_CUE, SITES, steps as woodcutting } from '../skills/woodcutting';
import {
    assertS07RunBundle,
    boneGiverGaps,
    boneGiverLaunch,
    boneGiverReady,
    lastS07Step,
    runsS07,
    s07RunBones,
    s07RunLaunch,
    S07_BONE_GIVERS,
    S07_BONE_PRIORITY,
    S07_FINAL_EXTRAS,
    S07_LAB_LOADS,
    S07_LAST_LOAD,
    S07_RUN_GIVERS,
    S07_RUN_LOADS,
    withBoneGivers,
} from './bone-launch';

const GIVERS = ['cairn_lb1', 'cairn_lb2', 'cairn_lb3', 'cairn_lb4'];
const launch = () => boneGiverLaunch({ givers: GIVERS, botsDir: '/tmp/b', runDir: '/tmp/r', gatewayPort: 8307 });

describe('boneGiverLaunch', () => {
    test("standalone.ts's own parser takes it as written: four bone-giver entries on the relay path, logged in in order, none a receiver", () => {
        const c = parseLaunchConfig(launch());
        expect(c).toMatchObject({ gatewayPort: 8307, loginSpacingMs: 2000 });
        expect(c.accounts.map(e => [e.account, e.role, e.path, e.after, e.receiver, e.final])).toEqual(GIVERS.map(g => [g, 'bone-giver', 'relay', 'login', false, false]));
    });

    test("bone-giver.ts's own option parser: one group of all four, the group's 25 loads, ::give restock, the {S07, bone} scope, the Taverley sites; the last alone carries the runes beside 21 bones", () => {
        const parsed = launch().accounts.map(e => boneGiverOptions(e.options, {}));
        for (const [i, o] of parsed.entries()) {
            expect(o).toMatchObject({ mode: 'standing', item: 'Dragon bones', n: BONE_LOAD, group: GIVERS, trades: S07_LAB_LOADS, scope: S07_BONE_CUE, sites: S07_SITES });
            expect(o.restock.kind).toBe('cheat');
            expect(o.finalExtras).toEqual(i === GIVERS.length - 1 ? S07_FINAL_EXTRAS.map(e => ({ ...e })) : []);
        }
        expect(parsed.at(-1)!.finalN).toBe(S07_LAST_LOAD);
        expect(S07_LAST_LOAD).toBe(21);
    });

    test('a group is two or more', () => {
        expect(() => boneGiverLaunch({ givers: ['cairn_lb1'], botsDir: 'b', runDir: 'r', gatewayPort: 1 })).toThrow(/at least two/);
    });

    test("the givers' sites are the stands the chain's woodcutting chops at (its default route, taverley)", () => {
        expect(S07_SITES.map(s => [s.receiver.x, s.receiver.z])).toEqual([[...SITES.oak.stand], [...SITES.willow.stand]]);
    });

    test("the runes are woodcutting.ts's CAMELOT_RUNES, and 25 loads carry SUPPLIES.md's 555 dragon bones to Prayer 99", () => {
        expect(S07_FINAL_EXTRAS.map(e => [e.count, CAMELOT_RUNES.findIndex(w => w.item instanceof RegExp && w.item.test(e.item) && w.amount === e.count)])).toEqual([
            [1, 0],
            [5, 1],
        ]);
        expect((S07_LAB_LOADS - 1) * BONE_LOAD + S07_LAST_LOAD).toBeGreaterThanOrEqual(555);
    });
});

describe("the run config's bones", () => {
    test('the group and the last load the givers serve, as the scored config names them', () => {
        expect(withBoneGivers(GIVERS)).toEqual({ group: GIVERS, lastLoad: S07_LAST_LOAD });
    });

    test("woodcutting.ts takes it with the chain's options, and the chain builds on it", () => {
        expect(() => woodcutting({ bury: true, bones: withBoneGivers(GIVERS), dropAxe: true, prayerTo: 99 })).not.toThrow();
        // The module's own contract: a group of one is no group, and a lastLoad above the load refuses.
        expect(() => woodcutting({ bury: true, bones: withBoneGivers(['cairn_lb1']) })).toThrow(/at least two/);
        const partners = Object.fromEntries([...Object.keys(PLACEMENT), ...KIT_PARTNER_ROWS].map(id => [id, 'STAFF']));
        const cfg = { partners, firemakingTiles: '3240,3296', rings: { giver: 'r' }, bones: withBoneGivers(GIVERS), courier: { giver: 'c', below: 3 }, anvil: { giver: 'a' }, cueDir: '/tmp/x' };
        const chain = buildChain(cfg, { cues: { open: async () => {}, stop: () => {} } });
        expect(chain.filter(s => s.id === 'S07').map(s => s.name)).toContain('woodcutting:oak-15-73');
    });
});

describe('boneGiverGaps', () => {
    const S07 = [{ id: 'T06-07' }, { id: 'S07', name: 'woodcutting:oak-15-73' }, { id: 'S07', name: 'woodcutting:willow-73-99' }];

    test('a slice that runs S07 with no bone givers refuses, naming S07 and --bone-givers', () => {
        const gaps = boneGiverGaps(S07, {});
        expect(gaps).toHaveLength(1);
        expect(gaps[0]).toStartWith('S07 ');
        expect(gaps[0]).toContain('--bone-givers=');
    });

    test('S07 not run, or staff-jumped past, needs none', () => {
        expect(boneGiverGaps([{ id: 'S06' }, { id: 'S08' }], {})).toEqual([]);
        const jumped = [{ id: 'S07', name: 'STAND-IN S07 (staff jump to T07-08)' }];
        expect(runsS07(jumped)).toBe(false);
        expect(boneGiverGaps(jumped, {})).toEqual([]);
    });

    test('four distinct cairn_ names, none on LAB_HELPERS or named for another family', () => {
        expect(boneGiverGaps(S07, { boneGivers: GIVERS })).toEqual([]);
        expect(boneGiverGaps(S07, { boneGivers: GIVERS.slice(0, 3) })).toEqual([`S07: --bone-givers names 3 bone giver(s); S07's rotation is ${S07_BONE_GIVERS} (SUPPLIES.md H4.1-H4.n)`]);
        expect(boneGiverGaps(S07, { boneGivers: [...GIVERS.slice(0, 3), 'cairn_lb1'] })[0]).toContain('names a giver twice');
        expect(boneGiverGaps(S07, { boneGivers: [...GIVERS.slice(0, 3), 'lab_b4'] })).toEqual(['S07: --bone-givers lab_b4 is not a cairn_ helper name standalone.ts launches']);
        expect(boneGiverGaps(S07, { boneGivers: GIVERS, labHelpers: ['cairn_lb2'] })[0]).toContain('cairn_lb2 is on LAB_HELPERS');
        expect(boneGiverGaps(S07, { boneGivers: GIVERS, others: { '--ringers': ['cairn_lb3'], '--altar-givers': ['cairn_lb4'] } })).toEqual([
            'S07: cairn_lb3 is named by both --ringers and --bone-givers',
            'S07: cairn_lb4 is named by both --altar-givers and --bone-givers',
        ]);
    });
});

describe('lastS07Step', () => {
    test("the last of S07's steps, past the leg between its bands; none when the slice has no S07", () => {
        const chain = [{ id: 'S07', name: 'a' }, { id: 'T07a', name: 'leg' }, { id: 'S07', name: 'b' }, { id: 'S07', name: 'c' }, { id: 'T07-08', name: 'leg' }];
        expect(lastS07Step(chain)?.name).toBe('c');
        expect(lastS07Step([{ id: 'S08' }])).toBeUndefined();
    });
});

describe('boneGiverReady', () => {
    test("this launch's fresh status, loaded, waiting at or travelling to a site", () => {
        const dir = mkdtempSync(join(tmpdir(), 'bone-ready-'));
        const now = Date.now();
        const put = (account: string, s: Record<string, unknown>) =>
            writeFileSync(join(dir, `bones-${account}.json`), JSON.stringify({ v: 1, account, phase: 'waiting', held: 23, n: 23, trades: 0, bounces: 0, tile: null, readyAt: now, session: null, final: false, loads: 25, ms: now, ...s }));
        put('cairn_lb1', {});
        put('cairn_lb2', { phase: 'travel', readyAt: null });
        put('cairn_lb3', { phase: 'restock', held: 0 });
        put('cairn_lb4', { ms: now - 60_000 });
        const ready = boneGiverReady(dir, now - 30_000);
        expect(GIVERS.map(g => ready(g, now))).toEqual([true, true, false, false]);
        // A status from before this launch is an earlier run's.
        expect(boneGiverReady(dir, now + 1)('cairn_lb1', now)).toBe(false);
        expect(ready('cairn_lb9', now)).toBe(false);
    });
});

describe("S07's run-night bundle (bank restock, 42 loads)", () => {
    const run = () => s07RunLaunch({ botsDir: '/r/bots', runDir: '/r/s07', gatewayPort: 7788 });

    test("standalone.ts's and bone-giver.ts's own parsers: b01-b04 on the bank, dragon first, 42 loads each, the runes on cairn_b04 alone beside 21, no rehearsal return", () => {
        const c = parseLaunchConfig(run());
        expect(c.accounts.map(e => [e.account, e.role, e.receiver, e.final])).toEqual(S07_RUN_GIVERS.map(g => [g, 'bone-giver', false, false]));
        const parsed = run().accounts.map(e => boneGiverOptions(e.options, {}));
        for (const [i, o] of parsed.entries()) {
            expect(o).toMatchObject({ mode: 'standing', items: [...S07_BONE_PRIORITY], n: BONE_LOAD, group: [...S07_RUN_GIVERS], trades: S07_RUN_LOADS, scope: S07_BONE_CUE, acceptReturn: false, sites: S07_SITES });
            expect(o.restock.kind).toBe('bank');
            expect(o.finalExtras.map(e => [e.item, e.count])).toEqual(i === 3 ? [['Law rune', 1], ['Air rune', 5]] : []);
        }
        expect(parsed[3]!.finalN).toBe(21);
        expect((S07_RUN_LOADS - 1) * BONE_LOAD + S07_LAST_LOAD).toBe(964);
        // The lab's default is unchanged.
        expect(launch().accounts.every(e => e.options.restock.kind === 'cheat' && e.options.item === undefined && e.options.trades === S07_LAB_LOADS)).toBe(true);
    });

    test('assertS07RunBundle passes the generated pair and refuses any drift', () => {
        expect(() => assertS07RunBundle(run(), s07RunBones())).not.toThrow();
        const drift = (f: (c: ReturnType<typeof run>) => void) => {
            const c = run();
            f(c);
            return () => assertS07RunBundle(c, s07RunBones());
        };
        expect(drift(c => (c.accounts[1]!.options.trades = 41))).toThrow(/cairn_b02: n 23, trades 41/);
        expect(drift(c => (c.accounts[0]!.options.finalExtras = c.accounts[3]!.options.finalExtras))).toThrow(/cairn_b01: final extras/);
        expect(drift(c => (c.accounts[2]!.options.item = ['Babydragon bones', 'Dragon bones']))).toThrow(/cairn_b03: bones Babydragon bones, Dragon bones/);
        expect(drift(c => ((c.accounts[0]!.options as Record<string, unknown>).acceptReturn = true))).toThrow(/acceptReturn true/);
        expect(() => assertS07RunBundle(run(), { group: [...S07_RUN_GIVERS].reverse(), lastLoad: 21 })).toThrow(/receiver bones/);
        expect(() => assertS07RunBundle(launch(), withBoneGivers(GIVERS))).toThrow(/S07 run bundle refused/);
    });

    test("the receiver's bones builds the chain's S07", () => {
        expect(s07RunBones()).toEqual({ group: [...S07_RUN_GIVERS], lastLoad: 21 });
        expect(() => woodcutting({ bury: true, bones: s07RunBones(), dropAxe: true, prayerTo: 99 })).not.toThrow();
    });
});
