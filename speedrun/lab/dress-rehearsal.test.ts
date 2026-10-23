import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { buildChain, KIT_PARTNER_ROWS, KIT_SEGMENTS, PLACEMENT, resolveFrom, sliceUntil, type ChainStep } from '../runner/chain';
import { TILES } from '../runner/legs';
import { resolveOptions as magicOptions, ROUTE_LOADS } from '../skills/magic';
import { STAND_IN_STEP } from '../runner/run-report';
import { MANIFEST } from '../tools/slot-ledger';
import { baseState } from '../lib/fake-sdk';
import { giverGaps, hooked, KIT_PLANS, LANDING_HELPER_TILE, labChain, meetingTile, ringerTile, ringLoads, STAFF, withRingers } from './dress-rehearsal';
import type { LabWorld } from './stand-ins';

const manifest = readFileSync(MANIFEST, 'utf8');
const world = (): LabWorld => ({ staffLevel: '4', server: 'localhost', gateway: 'ws://localhost:8300' });
const partners = (name: string) => Object.fromEntries([...Object.keys(PLACEMENT), ...KIT_PARTNER_ROWS].map(id => [id, name]));
const cfg = (name: string) => ({ partners: partners(name), firemakingTiles: '3240,3296', rings: { giver: 'r' }, bones: { giver: 'b' }, courier: { giver: 'c', below: 3 }, anvil: { giver: 'a' }, cueDir: '/tmp/x' });
const cues = { open: async () => {}, stop: () => {} };
const tileOf = (lab: ReturnType<typeof labChain>, row: string) => lab.stubRows.find(r => r.row === row)!.tile;

describe('labChain', () => {
    test('no group is missing (S15 is Monkey Madness\'s own steps), so there is no STAND-IN step, and nothing refuses as unbuilt', () => {
        const lab = labChain(buildChain(cfg('lab_stub'), { cues }), { manifest, stub: 'lab_stub', world });
        expect(lab.standIns).toEqual([]);
        expect(lab.chain.filter(s => s.name.startsWith(STAND_IN_STEP)).map(s => s.id)).toEqual([]);
        expect(lab.chain.filter(s => /^L24/.test(s.id)).map(s => s.id)).toEqual(['L24a', 'L24b', 'L24c']);
        expect(lab.chain.some(s => s.kind === 'missing')).toBe(false);
        expect(lab.chain.filter(s => s.preconditions.toString().includes('not built')).length).toBe(0);
    });

    test('with a stub giver: every placed row but the cannon rows is the stub\'s, at its meeting tile; the cannon rows are staff-supplied', () => {
        const chain = buildChain(cfg('lab_stub'), { cues });
        const lab = labChain(chain, { manifest, stub: 'lab_stub', world });
        // H12 is Monkey Madness's own trade, staff-supplied just before its segment A (KIT_SEGMENTS), S15's first step.
        expect(lab.staffed).toEqual(['H4', 'H11', 'H12', 'H23']);
        expect(lab.chain.map(s => s.id).indexOf('H12') + 1).toBe(lab.chain.map(s => s.id).indexOf('S15'));
        expect(lab.stubRows.map(r => r.row)).toEqual(['H1', 'H4k', 'H6', 'H4p', 'H7', 'H8', 'H9', 'H10', 'H11r', 'H13', 'H14', 'H15', 'H16', 'H18', 'H19', 'H20', 'H21d', 'H22']);
        expect(tileOf(lab, 'H7')).toEqual({ x: 2504, z: 3191 });
        expect(tileOf(lab, 'H22')).toEqual({ x: 3191, z: 3364 });
        const tile = (row: string) => lab.stubRows.find(r => r.row === row)!.tile;
        expect(tile('H9')).toEqual(LANDING_HELPER_TILE);
        expect(tile('H11r')).toEqual(LANDING_HELPER_TILE);
        expect(tile('H1')).toEqual({ x: 3222, z: 3222 });
        expect(tile('H4k')).toEqual({ x: 2912, z: 3495 });
        expect(tile('H14')).toEqual({ x: 2670, z: 3305 });
        expect(lab.chain.find(s => s.id === 'S01')!.name).toBe('H1 hand-off');
    });

    test('a cannon row whose lab holder the config names stays SCORED\'s real cue-served step; an unnamed one is staff-supplied', () => {
        const chain = buildChain(cfg('lab_stub'), { cues });
        const lab = labChain(chain, { manifest, stub: 'lab_stub', world, cannonServed: ['H11'] });
        expect([lab.cueServed, lab.staffed]).toEqual([['H11'], ['H4', 'H12', 'H23']]);
        const h11 = lab.chain.find(s => s.id === 'H11')!;
        expect([h11.name, h11.cue]).toEqual(['H11 hand-off', { step: 'S14', family: 'cannon' }]);
        expect(lab.stubRows.map(r => r.row)).not.toContain('H11');
    });

    test('without a stub giver every placed row is staff-supplied, S01 included', () => {
        const lab = labChain(sliceUntil(buildChain(cfg(STAFF), { cues }), 'S07'), { manifest, stub: null, world });
        expect(lab.staffed).toEqual(['H1', 'H4', 'H4k']);
        expect(lab.chain.find(s => s.id === 'S01')!.name).toBe('H1 hand-off (supply: staff)');
        expect(lab.stubRows).toEqual([]);
    });

    test("H4's lab plan reads the ledger text it is given (not a path) and gives back the rings held", () => {
        const s = baseState({ inventory: [{ slot: 0, id: 2550, name: 'Ring of forging', count: 1, optionsWithIndex: [] }] } as never);
        const plan = KIT_PLANS.H4!(s, manifest);
        expect(plan.give.map(g => [g.name, g.ids])).toEqual([['enchanted ring', [2550]]]);
        expect(plan.receive.map(r => r.name)).toContain('air talisman');
    });

    test("H4 is staff-supplied just before Doric's segment A, which still runs (it then finds H4 landed); a named H4 giver trades for real", () => {
        const sliced = sliceUntil(buildChain(cfg(STAFF), { cues }), 'S05');
        const lab = labChain(sliced, { manifest, stub: null, world });
        const names = lab.chain.map(s => s.name);
        const a = names.indexOf(KIT_SEGMENTS.H4!);
        expect(names[a - 1]).toBe('H4 hand-off (supply: staff)');
        expect(lab.chain[a - 1]!.id).toBe('H4');
        expect(lab.chain[a]!.cue).toEqual({ step: 'H4', family: 'mule' });
        const served = labChain(sliced, { manifest, stub: null, world, kitServed: ['H4'] });
        expect(served.staffed).not.toContain('H4');
        expect(served.chain.map(s => s.name)).not.toContain('H4 hand-off (supply: staff)');
    });

    test('--until=S04 needs no stand-in at all', () => {
        const lab = labChain(sliceUntil(buildChain(cfg('lab_stub'), { cues }), 'S04'), { manifest, stub: 'lab_stub', world });
        expect([lab.standIns, lab.staffed, lab.stubRows.map(r => r.row)]).toEqual([[], [], ['H1']]);
    });

    test('a row with no leg before it and no fixed tile is an error, not a guess', () => {
        const chain = buildChain(cfg('lab_stub'), { cues });
        const i = chain.findIndex(s => s.id === 'H21d');
        expect(meetingTile(chain, i)).toEqual({ x: 3185, z: 3436 });
        expect(() => meetingTile([{ ...chain[i]!, name: 'H99 hand-off' }], 0)).toThrow('no leg before it');
    });
});

describe('the real S04 and S06 givers', () => {
    const chain = buildChain(cfg('lab_stub'), { cues });
    const RINGERS = ['lab_r1', 'lab_r2', 'lab_r3'];
    const ALTAR = Array.from({ length: 7 }, (_, i) => `cairn_rcg${i + 1}`);
    const none = { ringers: [], altarGivers: [] };
    /** S03's droppers, named wherever a slice runs S03 but the test is about another step (fm-row-launch.test.ts tests them). */
    const FD = Array.from({ length: 6 }, (_, i) => `cairn_fd${i + 1}`);
    /** S07's bone givers (bone-launch.test.ts tests them). */
    const BG = ['cairn_lb1', 'cairn_lb2', 'cairn_lb3', 'cairn_lb4'];
    const span = (from: string | undefined, until: string | undefined) => sliceUntil(chain, until).slice(resolveFrom(chain, from) ?? 0);

    test('a slice that runs S04 with no ring givers refuses, naming S04 and --ringers', () => {
        const gaps = giverGaps(span(undefined, 'S04'), { ...none, droppers: FD });
        expect(gaps).toHaveLength(1);
        expect(gaps[0]).toContain('S04');
        expect(gaps[0]).toContain('--ringers=');
    });

    test('a slice that runs S06 with no altar givers refuses, naming S06 and --altar-givers', () => {
        const gaps = giverGaps(span('S05', 'S06'), none);
        expect(gaps).toHaveLength(1);
        expect(gaps[0]).toContain('S06');
        expect(gaps[0]).toContain('--altar-givers=');
    });

    test('the whole chain with none of them refuses for each', () => {
        const gaps = giverGaps(chain, none);
        expect(gaps.map(g => g.split(' ')[0]).sort()).toEqual(['H23', 'S03', 'S04', 'S06', 'S07', 'S25a', 'S25c']);
    });

    test('a slice from S05 to S05 needs none; one from S08 to S09 needs none; one from S07 needs only the bone givers, the anvil, the wine giver and the cannon holder', () => {
        expect(span('S05', 'S05').some(s => s.id === 'S05')).toBe(true);
        expect(giverGaps(span('S05', 'S05'), none)).toEqual([]);
        expect(giverGaps(span('S08', 'S09'), none)).toEqual([]);
        expect(giverGaps(span('S07', undefined), none).map(g => g.split(' ')[0]).sort()).toEqual(['H23', 'S07', 'S25a', 'S25c']);
        expect(giverGaps(span('S07', undefined), { ...none, boneGivers: BG, anvil: 'cairn_anv1', cannonHolder: 'cairn_h92', wineGiver: 'lab_wine' })).toEqual([]);
    });

    test('with every set named, nothing refuses', () => {
        expect(giverGaps(chain, { ringers: RINGERS, altarGivers: ALTAR, droppers: FD, boneGivers: BG, anvil: 'cairn_anv1', cannonHolder: 'cairn_h92', wineGiver: 'lab_wine', labHelpers: [...RINGERS, 'lab_wine'] })).toEqual([]);
    });

    test('a slice that runs S07 with no bone givers refuses, naming S07 and --bone-givers; a name another flag uses refuses too', () => {
        const gaps = giverGaps(span('S07', 'S07'), none);
        expect(gaps).toHaveLength(1);
        expect(gaps[0]).toStartWith('S07 ');
        expect(gaps[0]).toContain('--bone-givers=');
        expect(giverGaps(span('S07', 'S07'), { ringers: [], altarGivers: ['cairn_lb4'], boneGivers: BG })).toEqual(['S07: cairn_lb4 is named by both --altar-givers and --bone-givers']);
    });

    test('one ring giver per load; ring givers need a lite runner, altar givers must not have one', () => {
        expect(giverGaps(span(undefined, 'S04'), { ringers: RINGERS.slice(0, 2), altarGivers: [], droppers: FD })).toEqual(['S04: --ringers names 2 ring giver(s) for 3 loads (one per load)']);
        expect(giverGaps(span(undefined, 'S04'), { ringers: RINGERS, altarGivers: [], droppers: FD, labHelpers: ['lab_r1', 'lab_r2'] })[0]).toContain('lab_r3 is not on LAB_HELPERS');
        const onHelpers = giverGaps(span('S05', 'S06'), { ringers: [], altarGivers: ['cairn_rcg1'], labHelpers: ['cairn_rcg1'] });
        expect(onHelpers).toHaveLength(1);
        expect(onHelpers[0]).toContain('cairn_rcg1 is on LAB_HELPERS');
        expect(giverGaps(span('S05', 'S06'), { ringers: [], altarGivers: ['lab_a1'] })[0]).toContain('lab_a1 is not a cairn_ helper name');
    });

    test("--ringers becomes the run config's rings: load i from the i-th giver, as magic.ts resolves them", () => {
        const rings = withRingers({ giver: 'r' }, RINGERS);
        expect(ringLoads(rings)).toEqual(ROUTE_LOADS.map(l => ({ ...l })));
        expect(magicOptions({ giver: rings.giver, ...(rings.loads ? { loads: rings.loads } : {}) }).loads.map(l => l.giver)).toEqual(RINGERS);
        const s04 = buildChain({ ...cfg('lab_stub'), rings }, { cues }).find(s => s.id === 'S04');
        expect(s04?.name).toBe('S04 magic');
    });

    test("the ring givers stand beside S04's tile, the start of the leg after it (where S03 leaves SCORED, T04-05's start)", () => {
        expect(ringerTile(chain)).toEqual({ x: 3218, z: 3219 });
        expect(ringerTile(chain)).toEqual(TILES.s03End);
        expect(() => ringerTile(sliceUntil(chain, 'S04'))).toThrow('no leg after it');
    });

    test('a hooked step calls start as it runs and done once it returns, not when it throws', async () => {
        const calls: string[] = [];
        let fail = false;
        const step = { id: 'S04', kind: 'step', name: 'S04 magic', preconditions: () => true, postconditions: () => true, run: async () => { calls.push('run'); if (fail) throw new Error('x'); } } as unknown as ChainStep;
        const h = hooked(step, { start: () => calls.push('start'), done: () => calls.push('done') });
        await h.run({} as never);
        expect(calls).toEqual(['start', 'run', 'done']);
        fail = true;
        await expect(h.run({} as never)).rejects.toThrow('x');
        expect(calls).toEqual(['start', 'run', 'done', 'start', 'run']);
        expect(h.resume).toBeUndefined();
    });
});
