// The Taverley dungeon dragon room: its spawns, its bounds and the engine's leash rule. Shared by
// the magic killer (dragons.ts) and the melee bone spot (bones.ts blue_dragon). A leaf module:
// dragons.ts reads bones.ts constants while it loads, so bones.ts cannot import dragons.ts back.

export interface Tile { x: number; z: number }

/** An NPC spawn: its SW tile, footprint and leash as the engine applies it. */
export interface Spawn extends Tile {
    name: string;
    size: number;
    /** NpcType maxrange: wanderrange + 2 unless set. */
    maxrange: number;
}

const adult = (x: number, z: number): Spawn => ({ name: 'Blue dragon', x, z, size: 4, maxrange: 6 });
const baby = (x: number, z: number): Spawn => ({ name: 'Baby blue dragon', x, z, size: 2, maxrange: 6 });

/** Taverley dungeon dragon room spawns (server/content/maps/m45_153.jm2: npc 55 blue_dragon, 52 babybluedragon). */
export const TAVERLEY_ADULTS: Spawn[] = [adult(2897, 9797), adult(2899, 9802), adult(2904, 9802)];
export const TAVERLEY_BABIES: Spawn[] = [
    baby(2892, 9799), baby(2904, 9796), baby(2909, 9806), baby(2911, 9797), baby(2911, 9808), baby(2917, 9801)
];
export const TAVERLEY_ROOM_NPCS: Spawn[] = [...TAVERLEY_ADULTS, ...TAVERLEY_BABIES];

/** Npc.targetWithinMaxRange for an op-trigger NPC: true while `p` is a target the NPC keeps. */
export function leashHolds(spawn: Spawn, p: Tile): boolean {
    const dx = Math.abs(p.x - spawn.x);
    const dz = Math.abs(p.z - spawn.z);
    const r = spawn.maxrange + 1;
    if (Math.max(dx, dz) > r) return false;
    return !(dx === r && dz === r);
}

/** The dragon room, west of the dusty-key door; inRoom also checks the door side. */
export const ROOM: { x1: number; z1: number; x2: number; z2: number } = { x1: 2876, z1: 9786, x2: 2923, z2: 9816 };
