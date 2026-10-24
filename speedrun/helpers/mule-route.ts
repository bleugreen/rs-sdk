// The mule delivery's route around aggressive NPCs. Its own module, importing no helper, so mule.ts can
// use it without a cycle through mule-itinerary.ts -> questitems.ts -> buyer.ts -> mule.ts.
import { findLongPath } from '../../sdk/pathfinding';
import { expandRoute } from '../lib/travel';
import type { WorldTile } from './mule-readiness';

interface Tile {
    x: number;
    z: number;
}

/**
 * The Draynor jail guards (npc 917 `jailguard`, area_draynor/configs/draynor.npc; spawns in maps/m48_50.jm2).
 * They hunt `aggressive_melee` with huntrange 5 and the default wanderrange 5, so the engine's maxrange 7
 * (NpcType.ts): a guard can stand up to 7 tiles from its spawn and starts a hunt on anyone within 5 of where
 * it stands. The Draynor-Lumbridge road passes 2 tiles from the north pair, and they hit the Magic 1, HP 10
 * carrier there on nearly every pass (rs/658).
 */
export const JAIL_GUARD_SPAWNS: readonly Tile[] = [
    { x: 3109, z: 3237 }, { x: 3120, z: 3238 }, { x: 3121, z: 3249 }, { x: 3127, z: 3248 }
];
/** Chebyshev distance from a spawn that no guard can hunt: maxrange 7 + huntrange 5, plus one. */
export const JAIL_GUARD_CLEARANCE = 13;

/** Within JAIL_GUARD_CLEARANCE of a guard spawn. */
export function nearJailGuards(t: Tile): boolean {
    return JAIL_GUARD_SPAWNS.some(s => Math.max(Math.abs(t.x - s.x), Math.abs(t.z - s.z)) < JAIL_GUARD_CLEARANCE);
}

/**
 * The lane north of Draynor's houses, west to east, that keeps JAIL_GUARD_CLEARANCE between Draynor and
 * Lumbridge. It costs at most 2 tiles over the road on the H1, H18 and H19 walks. Nothing tighter exists:
 * Draynor bank's doorway is itself 13 from the southwest guard.
 */
export const JAIL_DETOUR: readonly WorldTile[] = [{ x: 3106, z: 3262, level: 0 }, { x: 3134, z: 3266, level: 0 }];

/** Every tile of the SDK's ground route from `a` to `b`, the route runTo walks without `via`. */
export function groundPath(a: Tile, b: Tile): Tile[] {
    return expandRoute(a, findLongPath(0, a.x, a.z, b.x, b.z, 500));
}

/**
 * Waypoints for a ground walk from `from` to `to`: JAIL_DETOUR, in walking order, when the walk crosses from
 * one side of the jail to the other and `path` (the ground route it would take) comes within
 * JAIL_GUARD_CLEARANCE of a guard; otherwise none.
 */
export function deliveryVia(from: Tile, to: Tile, path: (a: Tile, b: Tile) => readonly Tile[] = groundPath): WorldTile[] {
    const west = JAIL_DETOUR[0]!;
    const east = JAIL_DETOUR.at(-1)!;
    const eastward = from.x < west.x && to.x > east.x;
    const westward = from.x > east.x && to.x < west.x;
    if ((!eastward && !westward) || !path(from, to).some(nearJailGuards)) return [];
    return (eastward ? JAIL_DETOUR : [...JAIL_DETOUR].reverse()).map(t => ({ ...t }));
}
