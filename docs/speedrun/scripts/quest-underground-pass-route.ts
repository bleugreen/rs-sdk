// Offline route planner for the Underground Pass. Dijkstra over map tiles
// (8-way moves checked with the engine's canTravel on the SDK's bundled
// collision data, 0.5 ticks per tile at run speed) plus every scripted
// crossing: rockslides, broken bridges, stone bridges, the rope swings, pipes,
// levers, cage gates, the ledge, the well, doors, stairs and quest teleports.
// Each crossing costs EDGE_COST ticks (its success time, measured by
// quest-underground-pass-rolls.ts and -segments.ts where available) and
// carries the loc to click, so quest-underground-pass-segments.ts can walk
// the planned route.
//
//   bun docs/speedrun/scripts/quest-underground-pass-route.ts [leg-substring...] [--no=kind,kind]
//
// Prints the cheapest route for each leg in LEGS (or the matching ones): its
// cost, the tiles walked and each crossing used. --no excludes crossing kinds
// (for example --no=railing5 for an account below Thieving 50). Agility rolls
// are not modelled; see docs/speedrun/quests/underground_pass.md.

import * as rsmod from '../../../server/vendor/rsmod-pathfinder';
import { CollisionType } from '../../../server/vendor/rsmod-pathfinder';
import { initPathfinding, isTileWalkable } from '../../../sdk/pathfinding';
import { execSync } from 'child_process';

initPathfinding();

export type T = [number, number, number]; // x, z, level
const K = (t: T) => `${t[2]},${t[0]},${t[1]}`;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const inBox = (x: number, z: number, l: number) =>
    l === 0 ? x >= 2290 && x <= 2500 && z >= 9540 && z <= 9935 : x >= 1980 && x <= 2180 && z >= 4540 && z <= 4740;

/** Crossing costs in ticks, click (from the adjacent tile) to idle on the far side. */
export const EDGE_COST: Record<string, number> = {
    rockslide: 3, bridge: 6, stonebridge: 3, ropeswing: 16, swing2: 6, pipe4: 8, pipe6: 12, lever_bridge: 7,
    portcullis: 5, well_down: 3, mudpile_up: 3, mud_dig: 5, cage_pick: 5, railing5: 4, ledge: 7,
    unicorn_door: 2, temple_door2: 2, stairs: 2, rockpile: 5, enter_cave: 5, exit_cave: 5, fire_arrow_bridge: 34,
};

/** What to click for a crossing: op on a loc, or use an item on it. */
export interface Click { id: number; x: number; z: number; op?: number; item?: RegExp }
export interface Edge { from: T; to: T; kind: string; note: string; click?: Click }
const edges = new Map<string, Edge[]>();
const addEdge = (from: T, to: T, kind: string, note = '', click?: Click) => {
    const k = K(from);
    if (!edges.has(k)) edges.set(k, []);
    edges.get(k)!.push({ from, to, kind, note, click });
};

const find = (kind: string, names: string) =>
    execSync(`bun ${import.meta.dir}/quest-regicide-find.ts ${kind} ${names}`).toString().split('\n')
        .map(line => line.match(/^(\S+)\t\((\d+),(\d+),(\d+)\)/)).filter(Boolean)
        .map(m => ({ name: m![1], x: Number(m![2]), z: Number(m![3]), l: Number(m![4]) }));

const walkable = (t: T) => isTileWalkable(t[2], t[0], t[1]);
// One-tile rockslides: cross from one neighbour to the opposite one (upass_obstacles.rs2:3-31).
for (const r of find('loc', 'rockslide2_obstacle_upass')) {
    for (const [a, b] of [[[r.x, r.z + 1], [r.x, r.z - 1]], [[r.x + 1, r.z], [r.x - 1, r.z]]] as const) {
        const ta: T = [a[0], a[1], r.l];
        const tb: T = [b[0], b[1], r.l];
        if (walkable(ta) && walkable(tb)) {
            const click = { id: 3309, x: r.x, z: r.z, op: 1 };
            addEdge(ta, tb, 'rockslide', `(${r.x},${r.z})`, click);
            addEdge(tb, ta, 'rockslide', `(${r.x},${r.z})`, click);
        }
    }
}
// Three-tile broken bridges in Iban's cavern: land on loc-1 or loc+3 along the
// approach axis (upass_obstacles.rs2:368-407).
for (const r of find('loc', 'bridgecollapsed1 bridgecollapsed2')) {
    const id = r.name === 'bridgecollapsed1' ? 3254 : 3255;
    for (const [a, b] of [[[r.x, r.z - 1], [r.x, r.z + 3]], [[r.x - 1, r.z], [r.x + 3, r.z]]] as const) {
        const ta: T = [a[0], a[1], r.l];
        const tb: T = [b[0], b[1], r.l];
        if (walkable(ta) && walkable(tb)) {
            const click = { id, x: r.x, z: r.z, op: 1 };
            addEdge(ta, tb, 'bridge', `(${r.x},${r.z})`, click);
            addEdge(tb, ta, 'bridge', `(${r.x},${r.z})`, click);
        }
    }
}
// Stone bridges in area 2: land on loc-1/+1 along x (upass_obstacles.rs2:295-328).
// The map keeps them on level 1 with the bridge flag; the engine and the
// collision data treat them as level 0.
for (const r of find('loc', 'walkway_upass_narrow_mid_top')) {
    const ta: T = [r.x - 1, r.z, 0];
    const tb: T = [r.x + 1, r.z, 0];
    const click = { id: 3276, x: r.x, z: r.z, op: 1 };
    addEdge(ta, tb, 'stonebridge', `(${r.x},${r.z})`, click);
    addEdge(tb, ta, 'stonebridge', `(${r.x},${r.z})`, click);
}

// Scripted moves, read from the quest scripts.
const one = (from: T, to: T, kind: string, note: string, click?: Click) => addEdge(from, to, kind, note, click);
one([2434, 3313, 0], [2494, 9716, 0], 'enter_cave', 'quest_upass.rs2:95-97', { id: 3213, x: 2433, z: 3313, op: 1 });
one([2495, 9713, 0], [2436, 3315, 0], 'exit_cave', 'quest_upass.rs2:99-103', { id: 3214, x: 2496, z: 9713, op: 1 });
// Bridge shot from the east bank, (2446,9722) measured; upass_bridge.rs2:33-87.
one([2446, 9722, 0], [2442, 9716, 0], 'fire_arrow_bridge', 'lit arrow and bow, upass_bridge.rs2:33-87', { id: 3340, x: 2443, z: 9718, op: 1 });
one([2437, 9716, 0], [2447, 9716, 0], 'lever_bridge', 'west to east only, upass_bridge.rs2:89-106', { id: 3241, x: 2436, z: 9716, op: 1 });
one([2462, 9699, 0], [2466, 9699, 0], 'ropeswing', 'uses up a rope, upass_obstacles.rs2:93-128', { id: 2276, x: 2460, z: 9699, item: /^Rope$/i });
one([2465, 9692, 0], [2460, 9692, 0], 'swing2', 'east to west, upass_obstacles.rs2:130-148', { id: 2274, x: 2461, z: 9692, op: 1 });
one([2451, 9688, 0], [2451, 9694, 0], 'pipe4', 'south to north, upass_obstacles.rs2:61-79', { id: 3235, x: 2451, z: 9689, op: 1 });
one([2466, 9673, 0], [2464, 9677, 0], 'portcullis', 'upass_grid.rs2:1-43', { id: 3337, x: 2466, z: 9672, op: 1 });
// Locs used from any walkable neighbour tile.
const around = (x: number, z: number, l: number) => {
    const out: T[] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if ((dx || dz) && walkable([x + dx, z + dz, l])) out.push([x + dx, z + dz, l]);
    return out;
};
for (const t of around(2416, 9674, 0)) one(t, [2423, 9660, 0], 'well_down', 'needs the four orb bits, quest_upass.rs2:119-129', { id: 3264, x: 2416, z: 9674, op: 1 });
for (const z of [9716, 9717, 9718, 9719, 9720]) for (const x of [2369, 2370]) if (walkable([x, z, 0])) one([x, z, 0], [2173, 4725, 1], 'temple_door2', 'unlocked by badges and horn, quest_upass.rs2:394-405', { id: 3220, x: 2368, z: 9717, op: 1 });
one([2423, 9662, 0], [2418, 9674, 0], 'mudpile_up', 'quest_upass.rs2:149-154', { id: 3307, x: 2423, z: 9661, op: 1 });
for (const t of [[2442, 9652, 0], [2444, 9652, 0], [2443, 9653, 0], [2442, 9651, 0], [2444, 9651, 0], [2442, 9650, 0], [2443, 9650, 0], [2444, 9650, 0]] as T[]) {
    if (walkable(t)) one(t, [2482, 9715, 0], 'rockpile', 'upass_obstacles.rs2:50-55', { id: 3265, x: 2443, z: 9651, op: 1 });
}
one([2393, 9655, 0], [2393, 9654, 0], 'cage_pick', 'thieving 128/400 roll, quest_upass.rs2:226-240', { id: 3266, x: 2393, z: 9655, op: 1 });
one([2393, 9654, 0], [2393, 9655, 0], 'cage_pick', 'quest_upass.rs2:226-240', { id: 3266, x: 2393, z: 9655, op: 1 });
one([2393, 9651, 0], [2392, 9646, 0], 'mud_dig', 'spade, quest_upass.rs2:210-224', { id: 3216, x: 2393, z: 9650, item: /^Spade$/i });
one([2375, 9644, 0], [2374, 9638, 0], 'ledge', 'agility 200/260 roll, upass_obstacles.rs2:246-293', { id: 3238, x: 2374, z: 9644, op: 1 });
one([2380, 9619, 0], [2381, 9619, 0], 'railing5', 'Thieving 50, quest_upass.rs2:247-266', { id: 3268, x: 2380, z: 9619, op: 1 });
one([2403, 9620, 0], [2404, 9620, 0], 'railing5', 'Thieving 50, quest_upass.rs2:247-266', { id: 3268, x: 2404, z: 9620, op: 1 });
// Tunnels: the pair at z 9611 (used from the south) leads to area 3; the pair at z 9665 (used from the north) leads back.
for (const [x, id] of [[2375, 3219], [2376, 3218], [2400, 3219], [2401, 3218]]) one([x, 9610, 0], [2371, 9666, 0], 'unicorn_door', 'quest_upass.rs2:318-327', { id, x, z: 9611, op: 1 });
for (const [x, id] of [[2370, 3218], [2371, 3219]]) one([x, 9666, 0], [2376, 9610, 0], 'unicorn_door', 'at upass >= 4, quest_upass.rs2:322-323', { id, x, z: 9665, op: 1 });
one([2369, 9718, 0], [2173, 4725, 1], 'temple_door2', 'unlocked by badges and horn, quest_upass.rs2:394-405', { id: 3220, x: 2368, z: 9717, op: 1 });
one([2173, 4724, 1], [2370, 9719, 0], 'temple_door2', 'quest_upass.rs2:396-397', { id: 3221, x: 2174, z: 4724, op: 1 });
one([2150, 4546, 1], [2336, 9794, 0], 'stairs', 'quest_upass.rs2:407-409', { id: 3222, x: 2150, z: 4545, op: 1 });
one([2113, 4729, 1], [2305, 9915, 0], 'stairs', 'quest_upass.rs2:407-409', { id: 3222, x: 2112, z: 4729, op: 1 });
one([2336, 9794, 0], [2150, 4546, 1], 'stairs', 'quest_upass.rs2:417-419', { id: 3223, x: 2336, z: 9793, op: 1 });
one([2305, 9915, 0], [2113, 4729, 1], 'stairs', 'quest_upass.rs2:417-419', { id: 3223, x: 2304, z: 9915, op: 1 });
// Pipes in the unicorn area once %upass >= 4: 3 tiles in, telejump 26, 3 out (upass_obstacles.rs2:330-366).
one([2387, 9605, 0], [2387 + 32, 9605, 0], 'pipe6', 'upass >= 4', { id: 3237, x: 2388, z: 9605, op: 1 });
one([2412, 9605, 0], [2412 + 32, 9605, 0], 'pipe6', 'upass >= 4', { id: 3237, x: 2413, z: 9605, op: 1 });
one([2419, 9605, 0], [2419 - 32, 9605, 0], 'pipe6', 'upass >= 4', { id: 3237, x: 2417, z: 9605, op: 1 });

/**
 * Trap tiles. Spear traps hit a player on the trap tile or the tile north of it,
 * every tick (10% of current hp + 1, upass_obstacles.rs2:178-183); the flat
 * rocks of the double spring traps hit a player standing on them (8% of base
 * hp + 1, upass_obstacles.rs2:183-188). The planner steers round them at
 * TRAP_PENALTY ticks per tile and reports the ones a route still crosses.
 */
export const TRAP_TILES = new Set<string>([
    ...[[2430, 9676], [2432, 9676], [2435, 9676], [2440, 9677], [2443, 9677]].map(([x, z]) => `0,${x},${z}`),
    ...[[2393, 9676], [2396, 9677], [2401, 9675], [2404, 9675], [2408, 9674], [2416, 9689], [2418, 9681], [2418, 9685], [2406, 9719], [2406, 9725]].map(([x, z]) => `0,${x},${z}`),
]);
export let TRAP_PENALTY = 8;
export function setTrapPenalty(v: number) { TRAP_PENALTY = v; }

for (const list of edges.values()) for (const e of list) {
    if (!walkable(e.from)) console.warn(`route: ${e.kind} ${e.note} starts on a blocked tile ${e.from}`);
}

/** The crossing edges leaving a tile (for debugging routes). */
export const edgesFrom = (t: T) => edges.get(K(t)) ?? [];

export interface Plan { cost: number; tiles: number; crossings: string[]; traps: string[]; steps: Array<{ t: T; edge?: Edge }>; end: T }

/** Cheapest route; arrives on or next to dst. */
export function plan(src: T, dst: T, allow: (kind: string) => boolean = () => true): Plan | null {
    const dist = new Map<string, number>();
    const prev = new Map<string, { k: string; edge?: Edge; t: T }>();
    const heap: Array<[number, T]> = [[0, src]];
    dist.set(K(src), 0);
    const push = (d: number, t: T) => {
        heap.push([d, t]);
        let i = heap.length - 1;
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (heap[p][0] <= heap[i][0]) break;
            [heap[p], heap[i]] = [heap[i], heap[p]];
            i = p;
        }
    };
    const pop = () => {
        const top = heap[0];
        const last = heap.pop()!;
        if (heap.length) {
            heap[0] = last;
            let i = 0;
            for (;;) {
                const l = 2 * i + 1, r = l + 1;
                let m = i;
                if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
                if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
                if (m === i) break;
                [heap[m], heap[i]] = [heap[i], heap[m]];
                i = m;
            }
        }
        return top;
    };
    const near = (t: T) => t[2] === dst[2] && Math.max(Math.abs(t[0] - dst[0]), Math.abs(t[1] - dst[1])) <= (walkable(dst) ? 0 : 1);
    while (heap.length) {
        const [d, t] = pop();
        const k = K(t);
        if (d > (dist.get(k) ?? Infinity)) continue;
        if (near(t)) {
            const steps: Array<{ t: T; edge?: Edge }> = [];
            let cur: string | undefined = k;
            let ct = t;
            while (cur && cur !== K(src)) {
                const p = prev.get(cur)!;
                steps.push({ t: ct, edge: p.edge });
                cur = p.k;
                ct = p.t;
            }
            steps.reverse();
            let tiles = 0;
            const crossings: string[] = [];
            const traps: string[] = [];
            for (const s of steps) {
                if (s.edge) crossings.push(`${s.edge.kind}${s.edge.note ? ' ' + s.edge.note : ''}`);
                else tiles++;
                if (!s.edge && TRAP_TILES.has(K(s.t))) traps.push(`(${s.t[0]},${s.t[1]})`);
            }
            return { cost: d - traps.length * TRAP_PENALTY, tiles, crossings, traps, steps, end: t };
        }
        const [x, z, l] = t;
        for (const [dx, dz] of DIRS) {
            const nt: T = [x + dx, z + dz, l];
            if (!inBox(nt[0], nt[1], l) || !rsmod.canTravel(l, x, z, dx, dz, 1, 0, CollisionType.NORMAL)) continue;
            const nk = K(nt);
            const nd = d + 0.5 + (TRAP_TILES.has(nk) ? TRAP_PENALTY : 0);
            if (nd < (dist.get(nk) ?? Infinity)) {
                dist.set(nk, nd);
                prev.set(nk, { k, t });
                push(nd, nt);
            }
        }
        for (const e of edges.get(k) ?? []) {
            if (!allow(e.kind)) continue;
            const nd = d + (EDGE_COST[e.kind] ?? 4);
            const nk = K(e.to);
            if (nd < (dist.get(nk) ?? Infinity)) {
                dist.set(nk, nd);
                prev.set(nk, { k, t, edge: e });
                push(nd, e.to);
            }
        }
    }
    return null;
}

export const P: Record<string, T> = {
    caveOutside: [2434, 3313, 0], landing: [2494, 9716, 0], koftik2: [2449, 9716, 0], shootSpot: [2446, 9722, 0], bridgeWest: [2442, 9716, 0],
    plank: [2435, 9726, 0], swingStart: [2462, 9699, 0], koftik3: [2479, 9679, 0], gridEast: [2477, 9677, 0], portcullisLever: [2466, 9673, 0],
    afterPortcullis: [2464, 9677, 0], furnace: [2454, 9682, 0], well: [2416, 9674, 0], orb1trap: [2382, 9668, 0], orb2: [2386, 9677, 0], orb3: [2385, 9685, 0], orb4: [2416, 9698, 0],
    wellBottom: [2423, 9660, 0], cageGate: [2393, 9655, 0], mud: [2393, 9651, 0], afterMud: [2392, 9646, 0], ledgeTop: [2375, 9644, 0], ledgeEnd: [2374, 9638, 0],
    pipeEast: [2419, 9605, 0], unicornArea: [2412, 9605, 0], unicornCage: [2397, 9606, 0], boulder: [2396, 9597, 0],
    smashedCage: [2371, 9603, 0], area3: [2371, 9666, 0], paladins: [2424, 9719, 0], bloodwell: [2373, 9718, 0], templeDoor2: [2369, 9718, 0],
    mainArrival: [2173, 4725, 1], stairsSouth: [2150, 4546, 1], stairsNorth: [2113, 4729, 1], dwarfStairsFoot: [2336, 9794, 0], nilhoof: [2315, 9806, 0],
    barrel: [2327, 9799, 0], tomb: [2356, 9800, 0], kalrag: [2356, 9911, 0], kalragStairs: [2305, 9915, 0],
    cat: [2131, 4602, 1], witchDoor: [2158, 4566, 1], doomion: [2134, 4565, 1], holthion: [2132, 4554, 1], othainian: [2122, 4562, 1], shadowChest: [2136, 4578, 1],
    doveCage: [2134, 4702, 1], disciples: [2153, 4646, 1], templeDoor: [2144, 4647, 1], ibanLanding: [2482, 9607, 0], koftik5: [2443, 9607, 0], koftikTele: [2481, 9717, 0], exit: [2495, 9713, 0],
};

const LEGS: Array<[string, string, string]> = [
    ['landing -> shoot spot (bridge)', 'landing', 'shootSpot'],
    ['bridge west bank -> rope swing', 'bridgeWest', 'swingStart'],
    ['bridge west bank -> plank', 'bridgeWest', 'plank'],
    ['rope swing -> grid east edge', 'swingStart', 'gridEast'],
    ['portcullis -> furnace', 'afterPortcullis', 'furnace'],
    ['portcullis -> orb 4', 'afterPortcullis', 'orb4'],
    ['furnace -> orb 4 (north flat rocks)', 'furnace', 'orb4'],
    ['orb 4 -> orb 3', 'orb4', 'orb3'],
    ['orb 3 -> orb 2', 'orb3', 'orb2'],
    ['orb 2 -> orb 1 trap', 'orb2', 'orb1trap'],
    ['orb 1 trap -> furnace', 'orb1trap', 'furnace'],
    ['furnace -> well', 'furnace', 'well'],
    ['well bottom -> cage gate', 'wellBottom', 'cageGate'],
    ['after mud -> ledge', 'afterMud', 'ledgeTop'],
    ['ledge end -> pipe east end', 'ledgeEnd', 'pipeEast'],
    ['unicorn area -> unicorn cage', 'unicornArea', 'unicornCage'],
    ['smashed cage -> unicorn door (area 3)', 'smashedCage', 'area3'],
    ['area 3 -> paladins', 'area3', 'paladins'],
    ['paladins -> well of flames', 'paladins', 'bloodwell'],
    ['main arrival -> south stairs', 'mainArrival', 'stairsSouth'],
    ['dwarf stairs foot -> Nilhoof', 'dwarfStairsFoot', 'nilhoof'],
    ['south stairs top -> cat', 'stairsSouth', 'cat'],
    ['cat -> witch door', 'cat', 'witchDoor'],
    ['witch door -> Doomion', 'witchDoor', 'doomion'],
    ['Doomion -> Holthion', 'doomion', 'holthion'],
    ['Holthion -> Othainian', 'holthion', 'othainian'],
    ['Othainian -> shadow chest', 'othainian', 'shadowChest'],
    ['shadow chest -> south stairs', 'shadowChest', 'stairsSouth'],
    ['dwarf stairs foot -> barrel', 'dwarfStairsFoot', 'barrel'],
    ['barrel -> tomb', 'barrel', 'tomb'],
    ['tomb -> Kalrag', 'tomb', 'kalrag'],
    ['Kalrag -> north stairs foot', 'kalrag', 'kalragStairs'],
    ['north stairs top -> dove cage', 'stairsNorth', 'doveCage'],
    ['dove cage -> disciples', 'doveCage', 'disciples'],
    ['disciples -> temple door', 'disciples', 'templeDoor'],
    ['main arrival -> temple door', 'mainArrival', 'templeDoor'],
    ['Iban landing -> Koftik', 'ibanLanding', 'koftik5'],
    ['Koftik teleport -> exit', 'koftikTele', 'exit'],
    ['POST: landing -> temple door', 'landing', 'templeDoor'],
];

if (import.meta.main) {
    const args = process.argv.slice(2);
    const no = new Set((args.find(a => a.startsWith('--no='))?.slice(5) ?? '').split(',').filter(Boolean));
    const pick = args.filter(a => !a.startsWith('--'));
    console.log(`| Leg | Cost (ticks, success) | Tiles walked | Crossings |${no.size ? ` (without ${[...no].join(', ')})` : ''}`);
    console.log('|---|---|---|---|');
    for (const [name, a, b] of LEGS) {
        if (pick.length && !pick.some(p => name.includes(p))) continue;
        const r = plan(P[a], P[b], k => !no.has(k));
        if (!r) {
            console.log(`| ${name} | unreachable | | |`);
            continue;
        }
        console.log(`| ${name} | ${r.cost.toFixed(1)} | ${r.tiles} | ${r.crossings.join('; ') || '-'} | ${r.traps.length ? 'traps ' + r.traps.join(' ') : ''}`);
    }
}
