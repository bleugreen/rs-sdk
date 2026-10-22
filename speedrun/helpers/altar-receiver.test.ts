import { describe, expect, test } from 'bun:test';

import type { NearbyPlayer } from '../../sdk/types';
import type { GiverStatus } from './altar-cue';
import { giverOptions } from './altar-giver';
import { altarData, count, ESSENCE, findItem, NOTE_IDS, roomTiles } from './altar-room';
import { chooseBatch, planTurns } from './altar-receiver';

const status = (account: string, over: Partial<GiverStatus> = {}): GiverStatus => ({
    v: 1,
    account,
    phase: 'ready',
    loggedInAt: 100,
    essence: 27,
    tile: null,
    inRoom: true,
    readyAt: 1,
    gave: 0,
    ms: 10_000,
    ...over
});
const player = (name: string, x: number, z: number, index: number): NearbyPlayer => ({ kind: 'player', index, name, combatLevel: 3, x, z, distance: 1 });

describe('room tiles', () => {
    test('air altar at (2843,4833): receiver (2844,4832), givers east, west, south', () => {
        expect(roomTiles({ x: 2843, z: 4833 })).toEqual({
            receiver: { x: 2844, z: 4832 },
            givers: [{ x: 2845, z: 4832 }, { x: 2843, z: 4832 }, { x: 2844, z: 4831 }]
        });
    });
});

describe('chooseBatch', () => {
    const me = { x: 2844, z: 4832 };
    const nearby = [player('Cairn H70', 2845, 4832, 11), player('Cairn H71', 2843, 4832, 12), player('Cairn H72', 2845, 4831, 13)];
    const base = { schedule: 'tuned' as const, autoRobust: true, myLoggedInAt: 500, now: 11_000 };

    test('ready, fresh, adjacent givers, oldest ready first; diagonal ones are skipped', () => {
        const b = chooseBatch([status('cairn_h71', { readyAt: 5 }), status('cairn_h70', { readyAt: 3 }), status('cairn_h72')], nearby, me, base);
        expect(b).toEqual([
            { giver: 'cairn_h70', schedule: 'tuned', index: 11 },
            { giver: 'cairn_h71', schedule: 'tuned', index: 12 }
        ]);
    });

    test('stale, restocking or empty givers are skipped', () => {
        const b = chooseBatch([status('cairn_h70', { ms: 1 }), status('cairn_h71', { phase: 'restock' })], nearby, me, base);
        expect(b).toEqual([]);
        expect(chooseBatch([status('cairn_h70', { essence: 0 })], nearby, me, base)).toEqual([]);
    });

    test('a giver that logged in after the receiver gets the robust schedule', () => {
        const b = chooseBatch([status('cairn_h70', { loggedInAt: 600 }), status('cairn_h71', { loggedInAt: 400, readyAt: 2 })], nearby, me, base);
        expect(b.map(c => c.schedule)).toEqual(['robust', 'tuned']);
        expect(chooseBatch([status('cairn_h70', { loggedInAt: 600 })], nearby, me, { ...base, autoRobust: false })[0]!.schedule).toBe('tuned');
    });

    test('names and batch size limit the batch', () => {
        const all = [status('cairn_h70'), status('cairn_h71', { readyAt: 2 })];
        expect(chooseBatch(all, nearby, me, { ...base, names: ['cairn_h71'] }).map(c => c.giver)).toEqual(['cairn_h71']);
        expect(chooseBatch(all, nearby, me, { ...base, batch: 1 }).map(c => c.giver)).toEqual(['cairn_h70']);
    });
});

describe('planTurns', () => {
    test('7 ticks per tuned turn, 8 per robust, chained from T0', () => {
        const turns = planTurns(
            [
                { giver: 'a', schedule: 'tuned', index: 1 },
                { giver: 'b', schedule: 'robust', index: 2 },
                { giver: 'c', schedule: 'tuned', index: 3 }
            ],
            100,
            5
        );
        expect(turns.map(t => t.T)).toEqual([100, 107, 115]);
    });
});

describe('giver options', () => {
    test('defaults and validation', () => {
        const o = giverOptions({}, { RC_CUE_DIR: '/tmp/cue' });
        expect(o).toMatchObject({ altar: 'air', slot: 0, essence: 27, gapMs: 0, cueDir: '/tmp/cue', restock: { kind: 'bank', essence: 27 } });
        expect(o.schedule).toBeUndefined();
        expect(giverOptions({ essence: 10, restock: { kind: 'cheat' } }).restock).toEqual({ kind: 'cheat', essence: 10 });
        expect(() => giverOptions({ essence: 28 })).toThrow();
        expect(() => giverOptions({ slot: 3 })).toThrow();
        expect(() => giverOptions({ schedule: 'fast' })).toThrow();
        expect(() => giverOptions({ restock: { kind: 'teleport' } })).toThrow();
    });
});

describe('carried items', () => {
    const inv = (items: [number, string, number][]) =>
        ({ inventory: items.map(([id, name, n], slot) => ({ slot, id, name, count: n, optionsWithIndex: [] })) }) as never;
    const AIR = /^air talisman$/i;

    test('notes are not a load: 200 noted essence and a noted talisman count as none', () => {
        const s = inv([[1437, 'Rune essence', 200], [1439, 'Air talisman', 1]]);
        expect(count(s, ESSENCE)).toBe(0);
        expect(count(s, AIR)).toBe(0);
        expect(findItem(s, ESSENCE)).toBeUndefined();
    });

    test('real items count, and the slot to offer is a real one even behind a note', () => {
        const s = inv([[1437, 'Rune essence', 50], [1438, 'Air talisman', 1], ...Array.from({ length: 27 }, () => [1436, 'Rune essence', 1] as [number, string, number])]);
        expect(count(s, ESSENCE)).toBe(27);
        expect(count(s, AIR)).toBe(1);
        expect(findItem(s, ESSENCE)?.slot).toBe(2);
    });

    test('body altar: its talisman, Edgeville bank, and a noted body talisman is not a load', () => {
        const body = altarData('body');
        expect(body.level).toBe(20);
        expect(body.bank).toEqual({ x: 3094, z: 3491 });
        expect(body.ruins).toEqual({ level: 0, x: 3053, z: 3445 });
        expect(NOTE_IDS.has(1447)).toBe(true);
        const s = inv([[1447, 'Body talisman', 5], [1446, 'Body talisman', 1]]);
        expect(count(s, body.talisman)).toBe(1);
        expect(findItem(s, body.talisman)?.slot).toBe(1);
    });
});
