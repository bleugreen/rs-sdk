import { describe, expect, test } from 'bun:test';
import { lookAtRow } from './row-scout';

const tiles = [[3222, 3219], [3221, 3219], [3240, 3219]] as const;
const state = (extra: { locs?: { name: string; x: number; z: number }[]; items?: { name: string; x: number; z: number; count?: number }[]; players?: { name: string; x: number; z: number }[] } = {}) =>
    ({
        player: { worldX: 3222, worldZ: 3220 },
        nearbyLocs: extra.locs ?? [],
        groundItems: (extra.items ?? []).map(i => ({ count: 1, ...i })),
        nearbyPlayers: extra.players ?? [],
    }) as any;

describe('lookAtRow', () => {
    test('a clear row: every tile within view is seen, nothing found', () => {
        const r = lookAtRow(state(), tiles, 'd01');
        expect(r.seen).toEqual(['3222,3219', '3221,3219']);
        expect(r.findings).toEqual([]);
    });

    test('coins, bones and ashes on a planned tile are notes, not findings (ground objs do not block a fire)', () => {
        const r = lookAtRow(state({ items: [{ name: 'Coins', x: 3222, z: 3219, count: 5 }, { name: 'Bones', x: 3221, z: 3219 }, { name: 'Ashes', x: 3221, z: 3219 }] }), tiles, 'd01');
        expect(r.findings).toEqual([]);
        expect(r.notes).toHaveLength(3);
    });

    test('a log on a planned tile blocks', () => {
        const r = lookAtRow(state({ items: [{ name: 'Magic logs', x: 3221, z: 3219 }, { name: 'Logs', x: 3222, z: 3219 }] }), tiles, 'd01');
        expect(r.findings).toEqual(['1 Magic logs on 3221,3219, seen by d01', '1 Logs on 3222,3219, seen by d01']);
    });

    test('a fire, or any loc, on a planned tile blocks; off the row it does not', () => {
        const r = lookAtRow(state({ locs: [{ name: 'Fire', x: 3222, z: 3219 }, { name: 'Crate', x: 3221, z: 3219 }, { name: 'Fire', x: 3222, z: 3222 }] }), tiles, 'd01');
        expect(r.findings).toEqual(['loc Fire on 3222,3219, seen by d01', 'loc Crate on 3221,3219, seen by d01']);
    });

    test('players on planned tiles are reported, not refused', () => {
        const r = lookAtRow(state({ players: [{ name: 'Lealclam', x: 3222, z: 3219 }] }), tiles, 'd01');
        expect(r.findings).toEqual([]);
        expect([...r.players]).toEqual([['Lealclam', ['3222,3219']]]);
    });
});
