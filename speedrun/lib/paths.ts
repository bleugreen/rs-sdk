// Route lengths on the SDK's collision map. Kept apart from world.ts because
// importing sdk/pathfinding loads the whole collision map.

import { findLongPath } from '../../sdk/pathfinding';
import { chebyshev, routeTiles } from './world';

/**
 * Tiles walked on the shortest route the SDK pathfinder finds between two
 * tiles on one level (doors treated as open). At run speed (2 tiles a tick)
 * that is ceil(tiles / 2) ticks with energy to spare.
 */
export function pathTiles(level: number, x1: number, z1: number, x2: number, z2: number, maxWaypoints = 4000): { tiles: number; reached: boolean } {
    const wps = findLongPath(level, x1, z1, x2, z2, maxWaypoints);
    const tiles = routeTiles({ x: x1, z: z1 }, wps);
    const last = wps[wps.length - 1];
    const reached = last ? chebyshev(last, { x: x2, z: z2 }) <= 1 : x1 === x2 && z1 === z2;
    return { tiles, reached };
}
