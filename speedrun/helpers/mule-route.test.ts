import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { initPathfinding, isTileWalkable } from '../../sdk/pathfinding';
import { canTravel, CollisionType } from '../../server/vendor/rsmod-pathfinder';
import { muleDelivery } from './mule-itinerary';
import { deliveryVia, groundPath, JAIL_DETOUR, JAIL_GUARD_CLEARANCE, JAIL_GUARD_SPAWNS, nearJailGuards } from './mule-route';

type Tile = { x: number; z: number };
const cheb = (a: Tile, b: Tile) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
const content = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

/** NPC spawns of `id` on the ground floor of a map square, as world tiles. */
function spawns(square: string, id: number): Tile[] {
    const [mx, mz] = square.slice(1).split('_').map(Number) as [number, number];
    const section = content(`server/content/maps/${square}.jm2`).split('==== NPC ====')[1]!.split('====')[0]!;
    return [...section.matchAll(/^0 (\d+) (\d+): (\d+)$/gm)].filter(m => Number(m[3]) === id)
        .map(m => ({ x: mx * 64 + Number(m[1]), z: mz * 64 + Number(m[2]) }));
}

/** One NPC config block's keys (first value of each). */
function npcConfig(path: string, name: string): Record<string, string> {
    const block = content(path).split(/^(?=\[)/m).find(b => b.startsWith(`[${name}]`))!;
    return Object.fromEntries([...block.matchAll(/^(\w+)=(.*)$/gm)].map(m => [m[1], m[2]]).reverse());
}

/** Every tile a guard can stand on: the engine's wander steps (canTravel) within maxrange 7 of its spawn. */
function wanderArea(): Tile[] {
    initPathfinding();
    const area: Tile[] = [];
    for (const s of JAIL_GUARD_SPAWNS) {
        const seen = new Set([`${s.x},${s.z}`]);
        const queue = [{ ...s }];
        while (queue.length) {
            const c = queue.shift()!;
            area.push(c);
            for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
                const n = { x: c.x + dx, z: c.z + dz };
                if (seen.has(`${n.x},${n.z}`) || cheb(n, s) > 7 || !canTravel(0, c.x, c.z, dx, dz, 1, 0, CollisionType.NORMAL)) continue;
                seen.add(`${n.x},${n.z}`);
                queue.push(n);
            }
        }
    }
    return area;
}

/** The walk deliveryWalk makes: each waypoint, then the destination, on the SDK's ground route. */
function walked(from: Tile, to: Tile): { tiles: Tile[]; arrived: boolean; via: Tile[] } {
    const via = deliveryVia(from, to);
    const tiles: Tile[] = [];
    let cur = from;
    let arrived = true;
    for (const p of [...via, to]) {
        const stretch = groundPath(cur, p);
        arrived &&= !!stretch.length && cheb(stretch.at(-1)!, p) === 0;
        tiles.push(...stretch);
        cur = p;
    }
    return { tiles, arrived, via: via.map(({ x, z }) => ({ x, z })) };
}

const D = (row: string) => muleDelivery(row);
const west = JAIL_DETOUR.map(({ x, z }) => ({ x, z }));
const east = [...west].reverse();
/** mule1's eastern walks (H20 is h03's): [name, from, to, waypoints]. */
const LEGS: Array<[string, Tile, Tile, Tile[]]> = [
    ['H1 staging (Draynor bank -> Lumbridge spawn)', D('H1').bank, D('H1').at, west],
    ['H1 -> H4 bank (Falador west)', D('H1').at, D('H4').bank, east],
    ['H4k -> H18 bank (Draynor)', D('H4k').at, D('H18').bank, []],
    ['H18 staging (Draynor bank -> fly spots)', D('H18').bank, D('H18').at, west],
    ['H18 -> H19 bank (Draynor)', D('H18').at, D('H19').bank, east],
    ['H19 staging (Draynor bank -> cook)', D('H19').bank, D('H19').at, west],
    ['H19 -> H21d bank (Varrock west)', D('H19').at, D('H21d').bank, []]
];

describe('the Draynor jail guards, from the game content', () => {
    test('spawns are the four jailguard (917) lines in m48_50', () => {
        const byXZ = (a: Tile, b: Tile) => a.x - b.x || a.z - b.z;
        expect(spawns('m48_50', 917).sort(byXZ)).toEqual([...JAIL_GUARD_SPAWNS].sort(byXZ));
    });

    test('clearance is maxrange (default wanderrange 5, + 2) plus huntrange 5, plus one', () => {
        const guard = npcConfig('server/content/scripts/areas/area_draynor/configs/draynor.npc', 'jailguard');
        expect(guard.huntmode).toBe('aggressive_melee');
        expect(guard.wanderrange).toBeUndefined();
        expect(guard.maxrange).toBeUndefined();
        const npcType = content('server/engine/src/cache/config/NpcType.ts');
        expect(npcType).toContain('wanderrange = 5;');
        expect(npcType).toContain('this.maxrange = this.wanderrange + 2;');
        expect(JAIL_GUARD_CLEARANCE).toBe(5 + 2 + Number(guard.huntrange) + 1);
    });
});

describe('the jail detour', () => {
    test('pins the lane north of Draynor, west to east, on standable tiles clear of the guards', () => {
        expect(JAIL_DETOUR).toEqual([{ x: 3106, z: 3262, level: 0 }, { x: 3134, z: 3266, level: 0 }]);
        for (const t of JAIL_DETOUR) {
            expect(isTileWalkable(0, t.x, t.z)).toBe(true);
            expect(nearJailGuards(t)).toBe(false);
        }
        const stretch = groundPath(JAIL_DETOUR[0]!, JAIL_DETOUR[1]!);
        expect(stretch.at(-1)).toEqual({ x: 3134, z: 3266 });
        expect(stretch.some(nearJailGuards)).toBe(false);
    });

    test('applies only to a walk across the jail whose route comes near a guard, in walking order', () => {
        const near = () => [{ x: 3121, z: 3251 }];
        const clear = () => [{ x: 3121, z: 3270 }];
        expect(deliveryVia({ x: 3092, z: 3245 }, { x: 3241, z: 3248 }, near)).toEqual([...JAIL_DETOUR]);
        expect(deliveryVia({ x: 3241, z: 3248 }, { x: 3092, z: 3245 }, near)).toEqual([...JAIL_DETOUR].reverse());
        expect(deliveryVia({ x: 3092, z: 3245 }, { x: 3241, z: 3248 }, clear)).toEqual([]);
        expect(deliveryVia({ x: 3092, z: 3245 }, { x: 3080, z: 3250 }, near)).toEqual([]);
        expect(deliveryVia({ x: 3209, z: 3215 }, { x: 3241, z: 3248 }, near)).toEqual([]);
    });

    test('a walk retried from inside the lane keeps to the waypoints still ahead', () => {
        const near = () => [{ x: 3121, z: 3251 }];
        expect(deliveryVia({ x: 3106, z: 3262 }, { x: 3241, z: 3248 }, near)).toEqual([JAIL_DETOUR[1]!]);
        expect(deliveryVia({ x: 3120, z: 3264 }, { x: 3241, z: 3248 }, near)).toEqual([JAIL_DETOUR[1]!]);
        expect(deliveryVia({ x: 3120, z: 3264 }, { x: 3092, z: 3245 }, near)).toEqual([JAIL_DETOUR[0]!]);
        expect(deliveryVia({ x: 3134, z: 3266 }, { x: 3092, z: 3245 }, near)).toEqual([JAIL_DETOUR[0]!]);
    });

    const area = wanderArea();
    for (const [name, from, to, via] of LEGS) {
        test(`${name}: every tile ${JAIL_GUARD_CLEARANCE}+ from each guard spawn and over 5 from where a guard can stand`, () => {
            const w = walked(from, to);
            expect(w.via).toEqual(via);
            expect(w.arrived).toBe(true);
            expect(Math.min(...w.tiles.flatMap(t => JAIL_GUARD_SPAWNS.map(s => cheb(t, s))))).toBeGreaterThanOrEqual(JAIL_GUARD_CLEARANCE);
            expect(Math.min(...w.tiles.flatMap(t => area.map(a => cheb(t, a))))).toBeGreaterThan(5);
            // The detour costs at most 6 tiles over the road it replaces, which came within 2 of a guard.
            if (via.length) {
                const road = groundPath(from, to);
                expect(road.some(nearJailGuards)).toBe(true);
                expect(w.tiles.length - road.length).toBeLessThanOrEqual(6);
            }
        });
    }

    test('Draynor dark wizards (174): past the booth\'s doorway, every tile stays outside their hunt reach', () => {
        // young_dark_wizard: wanderrange 3 (maxrange 5) + huntrange 3 = 8. The booth and its doorway step
        // sit inside the bank's walls, and both hunt modes need line of sight.
        const wizards = spawns('m48_50', 174);
        expect(wizards).toEqual([{ x: 3084, z: 3236 }, { x: 3085, z: 3238 }]);
        const booth = D('H18').bank;
        for (const [, from, to] of LEGS) {
            const outside = walked(from, to).tiles.filter(t => cheb(t, booth) > 1);
            expect(Math.min(...outside.flatMap(t => wizards.map(s => cheb(t, s))))).toBeGreaterThan(8);
        }
    });
});
