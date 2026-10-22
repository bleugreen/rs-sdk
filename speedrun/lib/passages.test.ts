import { describe, expect, test } from 'bun:test';
import type { NearbyLoc } from '../../sdk/types';
import { awaitPassageLoc, crossingsBetween, LOC_WAIT_TICKS, PASSAGES, type Passage, reachesOnGround, type Tile } from './passages';

// A fake world: three rooms in a row, A | B | C, joined by passages A-B and B-C.
const room = (t: Tile) => (t.x < 10 ? 'A' : t.x < 20 ? 'B' : 'C');
const reaches = (a: Tile, b: Tile) => room(a) === room(b);
const door = (name: string, x: number): Passage => ({ name, loc: /door/i, option: /open/i, at: { x, z: 0 }, sides: [{ x: x - 1, z: 0 }, { x: x + 1, z: 0 }] });
const ab = door('ab', 10);
const bc = door('bc', 20);
const names = (r: ReturnType<typeof crossingsBetween>) => r?.map(c => `${c.passage.name}:${c.to.x}`);

describe('crossingsBetween', () => {
    test('none when a plain walk gets there', () => {
        expect(crossingsBetween({ x: 1, z: 0 }, { x: 5, z: 0 }, reaches, [ab, bc])).toEqual([]);
    });
    test('the passages in order, in either direction', () => {
        expect(names(crossingsBetween({ x: 1, z: 0 }, { x: 25, z: 0 }, reaches, [bc, ab]))).toEqual(['ab:11', 'bc:21']);
        expect(names(crossingsBetween({ x: 25, z: 0 }, { x: 1, z: 0 }, reaches, [ab, bc]))).toEqual(['bc:19', 'ab:9']);
    });
    test('null when no passage leads there', () => {
        expect(crossingsBetween({ x: 1, z: 0 }, { x: 25, z: 0 }, reaches, [ab])).toBeNull();
    });
});

describe('the Gnome Stronghold on the collision snapshot', () => {
    const [gate, doors] = PASSAGES;
    test('Ardougne to the grocers ladder: through the gate, then the tree doors', () => {
        const r = crossingsBetween({ x: 2654, z: 3283 }, { x: 2466, z: 3494 });
        expect(r?.map(c => c.passage)).toEqual([gate!, doors!]);
    });
    test('from the ladder out to the Barbarian Outpost: the doors, then the gate', () => {
        const r = crossingsBetween({ x: 2466, z: 3494 }, { x: 2552, z: 3574 });
        expect(r?.map(c => c.passage)).toEqual([doors!, gate!]);
    });
    test('elsewhere, no crossings', () => {
        expect(crossingsBetween({ x: 2654, z: 3283 }, { x: 2615, z: 3333 })).toEqual([]);
        expect(reachesOnGround({ x: 3222, z: 3218 }, { x: 3092, z: 3245 })).toBe(true);
    });
});

describe('awaitPassageLoc on a busy gate', () => {
    const gate = PASSAGES[0]!;
    const loc = (name: string, x: number, z: number, options: string[]): NearbyLoc =>
        ({ id: 190, name, x, z, level: 0, distance: 2, options, optionsWithIndex: options.map((text, i) => ({ text, opIndex: i + 1 })) }) as NearbyLoc;
    const closed = loc('Gate', 2459, 3383, ['Open']);
    // Scans in order; past the end the last one repeats. Counts the ticks waited.
    const world = (scans: NearbyLoc[][]) => {
        let i = 0;
        const w = {
            ticks: 0,
            scanNearbyLocs: async () => scans[Math.min(i++, scans.length - 1)]!,
            waitForTicks: async (n: number) => {
                w.ticks += n;
            }
        };
        return w;
    };

    test('waits out a crossing that swapped the gate away (gnome_gate.rs2 loc_del 5)', async () => {
        const w = world([[], [loc('Gate', 2462, 3383, [])], [], [closed]]);
        expect(await awaitPassageLoc(w as never, gate)).toBe(closed);
        expect(w.ticks).toBe(3);
    });
    test('takes the gate at once when it is there', async () => {
        const w = world([[closed]]);
        expect(await awaitPassageLoc(w as never, gate)).toBe(closed);
        expect(w.ticks).toBe(0);
    });
    test('null after the wait when it never shows', async () => {
        const w = world([[loc('Gnome statue', 2459, 3381, [])]]);
        expect(await awaitPassageLoc(w as never, gate)).toBeNull();
        expect(w.ticks).toBe(LOC_WAIT_TICKS);
    });
});
