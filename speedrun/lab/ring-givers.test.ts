import { describe, expect, test } from 'bun:test';
import { parseTiles } from '../skills/firemaking';
import { TILES } from '../runner/legs';
import { giverTiles } from './ring-givers';

// The measured castle lap (docs/speedrun/rehearsals/firemaking.md), the run config's firemakingTiles.
const ROW = new Set(parseTiles('3222-3218@3219;3218-3243@3218;3242-3223@3219').map(([x, z]) => `${x},${z}`));

describe('giverTiles', () => {
    test("S04's stands beside S03's end: the two doorway tiles, then the nearest past the castle wall's corner, none inside the castle", () => {
        const tiles = giverTiles(3, TILES.s03End, ROW);
        expect(tiles).toEqual([{ x: 3217, z: 3219 }, { x: 3217, z: 3218 }, { x: 3221, z: 3220 }]);
        // The large doors' west edge is a wall a trade request does not open: nothing at x 3216 or less.
        expect(tiles.every(t => t.x >= 3217 && !ROW.has(`${t.x},${t.z}`))).toBe(true);
    });

    test('a tile across a closed door is never a stand, however close', () => {
        const near = giverTiles(6, TILES.s03End, ROW);
        expect(near.some(t => t.x <= 3216)).toBe(false);
    });
});
