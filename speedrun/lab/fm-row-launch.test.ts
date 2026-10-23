import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { fmRowOptions, INVENTORY, LAB_ROW, ownLogs, rowPlan, S03_LOGS, S03_TOTAL } from '../helpers/fm-row';
import { parseLaunchConfig } from '../helpers/standalone';
import { buildChain, KIT_PARTNER_ROWS, PLACEMENT, resolveFrom, sliceUntil } from '../runner/chain';
import { STAND_IN_STEP } from '../runner/run-report';
import { resolveOptions as firemakingOptions } from '../skills/firemaking';
import { giverGaps } from './dress-rehearsal';
import { dropperArmed, dropperGaps, dropperLaunch, DROPPERS, GO_CUE_ID, labCueDropperOptions, runsS03 } from './fm-row-launch';

/** rs/228's Lumbridge lap (rehearsals/firemaking.md), as a run config's firemakingTiles. */
const LAP = '3222-3218@3219;3218-3243@3218;3242-3223@3219';
const FD = Array.from({ length: 6 }, (_, i) => `cairn_fd${i + 1}`);
const partners = Object.fromEntries([...Object.keys(PLACEMENT), ...KIT_PARTNER_ROWS].map(id => [id, 'lab_stub']));
const chain = buildChain({ partners, firemakingTiles: LAP, rings: { giver: 'r' }, bones: { giver: 'b' }, courier: { giver: 'c', below: 3 }, anvil: { giver: 'a' }, cueDir: '/tmp/x' }, { cues: { open: async () => {}, stop: () => {} } });
const span = (from: string | undefined, until: string | undefined) => sliceUntil(chain, until).slice(resolveFrom(chain, from) ?? 0);
const none = { ringers: [], altarGivers: [] };
const launch = () => dropperLaunch({ droppers: FD, tiles: LAP, cueDir: '/tmp/cue', botsDir: '/tmp/b', runDir: '/tmp/r', gatewayPort: 8306 });

describe('the refusal: S03 without its droppers', () => {
    test('a slice that runs S03 with no droppers refuses before SCORED logs in, naming S03 and --droppers; six named, nothing refuses', () => {
        const gaps = giverGaps(span(undefined, 'S03'), none);
        expect(gaps).toHaveLength(1);
        expect(gaps[0]).toContain('S03');
        expect(gaps[0]).toContain('--droppers=');
        expect(giverGaps(span(undefined, 'S03'), { ...none, droppers: FD })).toEqual([]);
    });

    test('one per inventory (6, as on run day); cairn_ names standalone.ts logs in, none on LAB_HELPERS, named twice or by another flag', () => {
        expect(DROPPERS).toBe(6);
        const s03 = span(undefined, 'S03');
        expect(dropperGaps(s03, { droppers: FD.slice(0, 5) })).toEqual(["S03: --droppers names 5 dropper(s) for the route's 6 inventories (one each, as on run day)"]);
        expect(dropperGaps(s03, { droppers: FD, labHelpers: ['cairn_fd2'] })).toEqual(["S03: --droppers cairn_fd2 is on LAB_HELPERS, so lab.sh has it logged in already; standalone.ts logs the droppers in itself"]);
        expect(dropperGaps(s03, { droppers: ['lab_d1', ...FD.slice(1)] })).toEqual(['S03: --droppers lab_d1 is not a cairn_ helper name standalone.ts launches']);
        expect(dropperGaps(s03, { droppers: [...FD.slice(0, 5), 'cairn_fd1'] })).toEqual(['S03: --droppers names cairn_fd1 twice']);
        expect(giverGaps(span(undefined, 'S04'), { ringers: ['lab_r1', 'lab_r2', 'cairn_fd3'], altarGivers: [], droppers: FD })[0]).toBe('S03: cairn_fd3 is named by --droppers and by another giver flag');
    });

    test('a slice past S03, or with S03 staff-jumped, needs none; one that runs S03 but not its S01 go cue refuses, since they would never start', () => {
        expect(chain.some(s => s.id === GO_CUE_ID)).toBe(true);
        expect(dropperGaps(span('S05', 'S05'), { droppers: [] })).toEqual([]);
        const jumped = span(undefined, 'S03').map(s => (s.id === 'S03' ? { ...s, name: `${STAND_IN_STEP} S03 (staff jump to T03-04)` } : s));
        expect(runsS03(jumped)).toBe(false);
        expect(dropperGaps(jumped, { droppers: [] })).toEqual([]);
        const fromS02 = span('S02', 'S03');
        expect(runsS03(fromS02)).toBe(true);
        expect(dropperGaps(fromS02, { droppers: FD })).toEqual(['S03 runs but its droppers\' go cue (written at S01) is not in this slice, so they would never start: run from S00']);
    });
});

describe('the launch config', () => {
    test('one fm-row entry per dropper on the relay path: part k of 6, started by the go file in the run cue dir, restocked by ::give', () => {
        const c = launch();
        expect(c).toMatchObject({ gatewayPort: 8306, botsDir: '/tmp/b', runDir: '/tmp/r', loginSpacingMs: 2000 });
        const tiles = firemakingOptions({ tiles: LAP }).tiles.map(([x, z]) => [x, z]);
        expect(c.accounts).toEqual(FD.map((account, part) => ({ account, role: 'fm-row', options: { tiles, part, parts: 6, start: 'cue', cueDir: '/tmp/cue', restock: { kind: 'cheat' } } })));
        const parsed = parseLaunchConfig(c);
        expect(parsed.accounts.map(e => [e.account, e.role, e.path, e.after, e.receiver, e.final])).toEqual(FD.map(d => [d, 'fm-row', 'relay', 'login', false, false]));
    });

    test("the role takes each entry as written: cueAt seen, one inventory each, the six together the route's 157 logs", () => {
        const all: number[] = [];
        for (const e of launch().accounts) {
            const o = fmRowOptions(e.options, {});
            expect([o.start, o.cueAt, o.cueDir, o.restock.kind, o.parts, o.skipOccupied]).toEqual(['cue', 'seen', '/tmp/cue', 'cheat', 6, false]);
            const own = ownLogs(S03_TOTAL, o.part, o.parts);
            expect(new Set(own.map(i => Math.floor(i / INVENTORY))).size).toBe(1);
            all.push(...own);
        }
        expect(all.sort((a, b) => a - b)).toEqual(Array.from({ length: S03_TOTAL }, (_, i) => i));
    });

    test("the droppers' row is the run config's firemakingTiles: log i lies on the tile S03's lighter lights it on", () => {
        const s03 = firemakingOptions({ tiles: LAP, supply: 'row' }).tiles;
        expect(s03).toHaveLength(51);
        const o = fmRowOptions(launch().accounts[0]!.options, {});
        expect(o.tiles!.map(t => [t.x, t.z])).toEqual(s03.map(([x, z]) => [x, z]));
        const plan = rowPlan(o.tiles!, S03_LOGS);
        expect(plan).toHaveLength(S03_TOTAL);
        for (const p of plan) expect([p.tile.x, p.tile.z]).toEqual([...s03[p.i % s03.length]!]);
        expect(() => dropperLaunch({ droppers: FD, tiles: '', cueDir: '/c', botsDir: '/b', runDir: '/r', gatewayPort: 1 })).toThrow('no firemakingTiles');
    });

    test("labCueDropperOptions with a snake (firemaking-accept.ts's row) is the role's cue start on that row", () => {
        const o = fmRowOptions(labCueDropperOptions({ row: LAB_ROW }, { cueDir: '/c', lead: 4 }), {});
        expect([o.row, o.tiles, o.part, o.parts, o.start, o.cueDir, o.restock.kind, o.lead]).toEqual([LAB_ROW, null, 0, 1, 'cue', '/c', 'cheat', 4]);
    });

    test("armed means the role log holds fm-row's own `phase` line with phase armed (launcher-prefixed role log lines)", () => {
        const runDir = mkdtempSync(join(tmpdir(), 'fm-row-launch-test-'));
        mkdirSync(join(runDir, 'logs'));
        const line = (a: string, phase: string) => `2026-10-22T20:00:00.000Z ${JSON.stringify({ t: '2026-10-22T20:00:00.000Z', account: a, role: 'fm-row', message: 'phase', phase })}\n`;
        writeFileSync(join(runDir, 'logs', 'cairn_fd1.role.log'), line('cairn_fd1', 'restock'));
        writeFileSync(join(runDir, 'logs', 'cairn_fd2.role.log'), line('cairn_fd2', 'restock') + line('cairn_fd2', 'armed'));
        expect(FD.slice(0, 3).filter(d => dropperArmed(runDir, d))).toEqual(['cairn_fd2']);
    });

    test('dress-rehearsal.ts launches them through here on the run config\'s tiles and stops them once S03 returns; firemaking-accept.ts takes its options from here', () => {
        const dress = readFileSync(join(import.meta.dir, 'dress-rehearsal.ts'), 'utf8');
        expect(dress).toMatch(/launchDroppers\(\{[^}]*tiles: cfg\.firemakingTiles/);
        expect(dress).toContain("if (s.id === 'S03' && needDroppers) return hooked(s, { done: () => void stopDrop() });");
        expect(dress).not.toContain("role: 'fm-row'");
        const accept = readFileSync(join(import.meta.dir, 'firemaking-accept.ts'), 'utf8');
        expect(accept).toContain('labCueDropperOptions({ row }');
        expect(accept).not.toContain("restock: { kind: 'cheat' }");
    });
});
