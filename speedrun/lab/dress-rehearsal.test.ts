import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { buildChain, KIT_PARTNER_ROWS, PLACEMENT, sliceUntil } from '../runner/chain';
import { STAND_IN_STEP } from '../runner/run-report';
import { MANIFEST } from '../tools/slot-ledger';
import { LANDING_HELPER_TILE, labChain, meetingTile, STAFF } from './dress-rehearsal';
import type { LabWorld } from './stand-ins';

const manifest = readFileSync(MANIFEST, 'utf8');
const world = (): LabWorld => ({ staffLevel: '4', server: 'localhost', gateway: 'ws://localhost:8300' });
const partners = (name: string) => Object.fromEntries([...Object.keys(PLACEMENT), ...KIT_PARTNER_ROWS].map(id => [id, name]));
const cfg = (name: string) => ({ partners: partners(name), firemakingTiles: '3240,3296', rings: { giver: 'r' }, bones: { giver: 'b' }, courier: { giver: 'c', below: 3 }, anvil: { giver: 'a' }, cueDir: '/tmp/x' });
const cues = { open: async () => {}, stop: () => {} };

describe('labChain', () => {
    test('each missing group becomes one STAND-IN step, and nothing refuses', () => {
        const lab = labChain(buildChain(cfg('lab_stub'), { cues }), { manifest, stub: 'lab_stub', world });
        expect(lab.standIns).toEqual(['S15', 'S19']);
        expect(lab.chain.filter(s => s.name.startsWith(STAND_IN_STEP)).map(s => s.id)).toEqual(['S15', 'S19']);
        expect(lab.chain.filter(s => /^L24/.test(s.id)).map(s => s.id)).toEqual(['L24a', 'L24b', 'L24c']);
        expect(lab.chain.some(s => s.kind === 'missing')).toBe(false);
        expect(lab.chain.filter(s => s.preconditions.toString().includes('not built')).length).toBe(0);
    });

    test('with a stub giver: every placed row but the cannon rows is the stub\'s, at its meeting tile; the cannon rows are staff-supplied', () => {
        const chain = buildChain(cfg('lab_stub'), { cues });
        const lab = labChain(chain, { manifest, stub: 'lab_stub', world });
        expect(lab.staffed).toEqual(['H11', 'H23']);
        expect(lab.stubRows.map(r => r.row)).toEqual(['H1', 'H4k', 'H9', 'H10', 'H11r', 'H12', 'H13', 'H14', 'H15', 'H18', 'H19', 'H20', 'H21d']);
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
        expect([lab.cueServed, lab.staffed]).toEqual([['H11'], ['H23']]);
        const h11 = lab.chain.find(s => s.id === 'H11')!;
        expect([h11.name, h11.cue]).toEqual(['H11 hand-off', { step: 'S14', family: 'cannon' }]);
        expect(lab.stubRows.map(r => r.row)).not.toContain('H11');
    });

    test('without a stub giver every placed row is staff-supplied, S01 included', () => {
        const lab = labChain(sliceUntil(buildChain(cfg(STAFF), { cues }), 'S07'), { manifest, stub: null, world });
        expect(lab.staffed).toEqual(['H1', 'H4k']);
        expect(lab.chain.find(s => s.id === 'S01')!.name).toBe('H1 hand-off (supply: staff)');
        expect(lab.stubRows).toEqual([]);
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
