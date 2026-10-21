// Offline route planner for the Underground Pass. Dijkstra over map tiles
// (8-way moves checked with the engine's canTravel on the SDK's bundled
// collision data, 0.5 ticks per tile at run speed) plus every scripted
// crossing: rockslides, broken bridges, the rope swings, pipes, levers, the
// well, doors, stairs and the quest teleports, each at the cost in ticks set in
// EDGE_COST (from the timed scripts where measured). Prints the cheapest
// route between named points, the tiles walked and each crossing used.
//
//   bun docs/speedrun/scripts/quest-underground-pass-route.ts [leg...]
//
// With no arguments every leg in LEGS is planned. Agility rolls are not
// modelled: the cost of a crossing is its success time; see
// docs/speedrun/quests/underground_pass.md for failure rates.

import * as rsmod from '../../../server/vendor/rsmod-pathfinder';
import { CollisionType } from '../../../server/vendor/rsmod-pathfinder';
import { initPathfinding, isTileWalkable } from '../../../sdk/pathfinding';
import { execSync } from 'child_process';

initPathfinding();

type T = [number, number, number]; // x, z, level
const K = (t: T) => `${t[2]},${t[0]},${t[1]}`;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const inBox = (x: number, z: number, l: number) =>
    l === 0 ? x >= 2290 && x <= 2500 && z >= 9540 && z <= 9935 : x >= 1980 && x <= 2180 && z >= 4540 && z <= 4740;

/** Crossing costs in ticks, click to standing on the far side (success). */
export const EDGE_COST: Record<string, number> = {
    rockslide: 5,
    bridge: 6,
    stonebridge: 6,
    ropeswing: 8,
    swing2: 6,
    pipe4: 8,
    pipe6: 12,
    lever_bridge: 7,
    portcullis: 4,
    well_down: 3,
    mudpile_up: 3,
    mud_dig: 4,
    cage_pick: 6,
    railing5: 4,
    ledge: 8,
    unicorn_door: 2,
    temple_door2: 2,
    stairs: 2,
    rockpile: 5,
    witch_door: 6,
};

interface Edge { from: T; to: T; kind: string; note: string }
const edges = new Map<string, Edge[]>();
const addEdge = (from: T, to: T, kind: string, note = '') => {
    const k = K(from);
    if (!edges.has(k)) edges.set(k, []);
    edges.get(k)!.push({ from, to, kind, note });
};

const find = (kind: string, names: string) =>
    execSync(`bun ${import.meta.dir}/quest-regicide-find.ts ${kind} ${names}`).toString().split('\n')
        .map(line => line.match(/^(\S+)\t\((\d+),(\d+),(\d+)\)/)).filter(Boolean)
        .map(m => ({ name: m![1], x: Number(m![2]), z: Number(m![3]), l: Number(m![4]) }));

const walkable = (t: T) => isTileWalkable(t[2], t[0], t[1]);
// One-tile obstacles (rockslides): cross from one neighbour to the opposite one.
for (const r of find('loc', 'rockslide2_obstacle_upass')) {
    for (const [a, b] of [[[r.x, r.z + 1], [r.x, r.z - 1]], [[r.x + 1, r.z], [r.x - 1, r.z]]] as const) {
        const ta: T = [a[0], a[1], r.l];
        const tb: T = [b[0], b[1], r.l];
        if (walkable(ta) && walkable(tb)) {
            addEdge(ta, tb, 'rockslide', `(${r.x},${r.z})`);
            addEdge(tb, ta, 'rockslide', `(${r.x},${r.z})`);
        }
    }
}
// Three-tile broken bridges: upass_obstacles.rs2 upass_cross_bridge lands on
// loc-1 or loc+3 along the axis the player approaches from. Map files keep
// them on level 1, which is where Iban's cavern is.
for (const r of find('loc', 'bridgecollapsed1 bridgecollapsed2')) {
    for (const [a, b] of [[[r.x, r.z - 1], [r.x, r.z + 3]], [[r.x - 1, r.z], [r.x + 3, r.z]]] as const) {
        const ta: T = [a[0], a[1], r.l];
        const tb: T = [b[0], b[1], r.l];
        if (walkable(ta) && walkable(tb)) {
            addEdge(ta, tb, 'bridge', `(${r.x},${r.z})`);
            addEdge(tb, ta, 'bridge', `(${r.x},${r.z})`);
        }
    }
}
// Stone bridges in area 2 (walkway_upass_narrow_mid_top): end = loc -1/+1 along x
// from the side the player stands on. The map stores them on level 1 with the
// bridge flag; the collision data has them on level 0.
for (const r of find('loc', 'walkway_upass_narrow_mid_top')) {
    const ta: T = [r.x - 1, r.z, 0];
    const tb: T = [r.x + 1, r.z, 0];
    addEdge(ta, tb, 'stonebridge', `(${r.x},${r.z})`);
    addEdge(tb, ta, 'stonebridge', `(${r.x},${r.z})`);
}

// Scripted moves, read from the quest scripts (coordinates converted from
// level_mx_mz_lx_lz).
const one = (from: T, to: T, kind: string, note: string) => addEdge(from, to, kind, note);
one([2433, 3313, 0], [2494, 9716, 0], 'enter_cave', 'quest_upass.rs2:95-97');
one([2495, 9713, 0], [2436, 3315, 0], 'exit_cave', 'quest_upass.rs2:99-103');
// Bridge shot from the east bank (x >= 2443, z >= 9720), upass_bridge.rs2:33-87.
for (let x = 2444; x <= 2456; x++) for (let z = 9720; z <= 9724; z++) one([x, z, 0], [2442, 9716, 0], 'fire_arrow_bridge', 'upass_bridge.rs2:63-87');
one([2437, 9716, 0], [2447, 9716, 0], 'lever_bridge', 'west to east only, upass_bridge.rs2:89-106');
one([2462, 9699, 0], [2466, 9699, 0], 'ropeswing', 'needs a rope, upass_obstacles.rs2:93-128');
one([2465, 9692, 0], [2460, 9692, 0], 'swing2', 'east to west, upass_obstacles.rs2:130-148');
one([2451, 9688, 0], [2451, 9694, 0], 'pipe4', 'south to north, upass_obstacles.rs2:61-79');
one([2466, 9673, 0], [2464, 9677, 0], 'portcullis', 'upass_grid.rs2:1-43');
one([2416, 9675, 0], [2423, 9660, 0], 'well_down', 'needs the four orb bits, quest_upass.rs2:119-129');
one([2417, 9674, 0], [2423, 9660, 0], 'well_down', 'quest_upass.rs2:119-129');
one([2423, 9662, 0], [2418, 9674, 0], 'mudpile_up', 'quest_upass.rs2:149-154');
one([2443, 9652, 0], [2482, 9715, 0], 'rockpile', 'upass_obstacles.rs2:50-55');
one([2394, 9650, 0], [2392, 9646, 0], 'mud_dig', 'spade, quest_upass.rs2:210-224');
one([2393, 9651, 0], [2392, 9646, 0], 'mud_dig', 'spade, quest_upass.rs2:210-224');
for (const d of [[2375, 9612], [2376, 9612], [2400, 9612], [2401, 9612]]) one([d[0], d[1], 0], [2371, 9666, 0], 'unicorn_door', 'quest_upass.rs2:318-327');
for (const d of [[2370, 9664], [2371, 9664]]) one([d[0], d[1], 0], [2376, 9610, 0], 'unicorn_door', 'at upass >= 4, quest_upass.rs2:322-323');
for (const z of [9717, 9718, 9719]) one([2369, z, 0], [2173, 4725, 1], 'temple_door2', 'door unlocked by badges and horn, quest_upass.rs2:394-405');
one([2173, 4724, 1], [2370, 9719, 0], 'temple_door2', 'quest_upass.rs2:396-397');
one([2150, 4546, 1], [2336, 9794, 0], 'stairs', 'quest_upass.rs2:407-409');
one([2113, 4729, 1], [2305, 9915, 0], 'stairs', 'quest_upass.rs2:407-409');
one([2336, 9794, 0], [2150, 4546, 1], 'stairs', 'quest_upass.rs2:417-419');
one([2305, 9915, 0], [2113, 4729, 1], 'stairs', 'quest_upass.rs2:417-419');
// Pipes in the unicorn area once %upass >= 4: 3 tiles in, telejump 26, 3 out.
one([2387, 9605, 0], [2387 + 32, 9605, 0], 'pipe6', 'upass >= 4, upass_obstacles.rs2:330-366');
one([2412, 9605, 0], [2412 + 32, 9605, 0], 'pipe6', 'upass >= 4');
one([2419, 9605, 0], [2419 - 32, 9605, 0], 'pipe6', 'upass >= 4');

// Dijkstra over tiles; walking costs 0.5 per tile (run).
function plan(src: T, dst: T, allow: (kind: string) => boolean) {
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
    const near = (t: T) => t[2] === dst[2] && Math.max(Math.abs(t[0] - dst[0]), Math.abs(t[1] - dst[1])) <= 1;
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
            for (const s of steps) {
                if (s.edge) crossings.push(`${s.edge.kind}${s.edge.note ? ' ' + s.edge.note : ''}`);
                else tiles++;
            }
            return { cost: d, tiles, crossings, end: t };
        }
        const [x, z, l] = t;
        for (const [dx, dz] of DIRS) {
            const nt: T = [x + dx, z + dz, l];
            if (!inBox(nt[0], nt[1], l) || !rsmod.canTravel(l, x, z, dx, dz, 1, 0, CollisionType.NORMAL)) continue;
            const nd = d + 0.5;
            const nk = K(nt);
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

const P: Record<string, T> = {
    caveEntrance: [2433, 3313, 0], landing: [2494, 9716, 0], koftik2: [2449, 9716, 0], bridgeWest: [2442, 9716, 0],
    plank: [2435, 9726, 0], swingStart: [2462, 9699, 0], koftik3: [2479, 9679, 0], gridEast: [2477, 9677, 0], portcullisLever: [2466, 9673, 0],
    afterPortcullis: [2464, 9677, 0], furnace: [2454, 9682, 0], well: [2416, 9674, 0], orb1trap: [2382, 9668, 0], orb2: [2386, 9677, 0], orb3: [2385, 9685, 0], orb4: [2416, 9698, 0],
    wellBottom: [2423, 9660, 0], mud: [2393, 9650, 0], afterMud: [2392, 9646, 0], unicornCage: [2397, 9606, 0], boulder: [2396, 9597, 0],
    smashedCage: [2371, 9603, 0], area3: [2371, 9666, 0], paladins: [2424, 9719, 0], bloodwell: [2373, 9718, 0], templeDoor2: [2369, 9718, 0],
    mainArrival: [2173, 4725, 1], stairsSouth: [2150, 4546, 1], stairsNorth: [2113, 4729, 1], dwarfStairsFoot: [2336, 9794, 0], nilhoof: [2315, 9806, 0],
    barrel: [2327, 9799, 0], tomb: [2356, 9800, 0], kalrag: [2356, 9911, 0], kalragStairs: [2305, 9915, 0],
    cat: [2131, 4602, 1], witchDoor: [2158, 4566, 1], doomion: [2134, 4565, 1], holthion: [2132, 4554, 1], othainian: [2122, 4562, 1], shadowChest: [2136, 4578, 1],
    doveCage: [2134, 4702, 1], disciples: [2153, 4646, 1], templeDoor: [2144, 4647, 1], ibanLanding: [2482, 9607, 0], koftik5: [2443, 9607, 0], koftikTele: [2481, 9717, 0], exit: [2495, 9713, 0],
};

const LEGS: Array<[string, string, string, string[]?]> = [
    ['landing -> Koftik (bridge)', 'landing', 'koftik2'],
    ['bridge west bank -> rope swing', 'bridgeWest', 'swingStart'],
    ['bridge west bank -> plank', 'bridgeWest', 'plank'],
    ['rope swing -> grid east edge', 'swingStart', 'gridEast'],
    ['grid east -> portcullis lever (grid walked)', 'gridEast', 'portcullisLever'],
    ['portcullis -> furnace', 'afterPortcullis', 'furnace'],
    ['furnace -> orb 4 (north flat rocks)', 'furnace', 'orb4'],
    ['orb 4 -> orb 3', 'orb4', 'orb3'],
    ['orb 3 -> orb 2', 'orb3', 'orb2'],
    ['orb 2 -> orb 1 trap', 'orb2', 'orb1trap'],
    ['orb 1 trap -> furnace', 'orb1trap', 'furnace'],
    ['furnace -> well', 'furnace', 'well'],
    ['well bottom -> mud', 'wellBottom', 'mud'],
    ['after mud -> unicorn cage', 'afterMud', 'unicornCage'],
    ['unicorn cage -> boulder', 'unicornCage', 'boulder'],
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
    // Post-quest traversal (Regicide): orb bits, door bits and the grid answer persist.
    ['POST: landing -> temple door', 'landing', 'templeDoor'],
];

const pick = process.argv.slice(2);
console.log('| Leg | Cost (ticks, success) | Tiles walked | Crossings |');
console.log('|---|---|---|---|');
for (const [name, a, b] of LEGS) {
    if (pick.length && !pick.some(p => name.includes(p))) continue;
    const r = plan(P[a], P[b], () => true);
    if (!r) {
        console.log(`| ${name} | unreachable | | |`);
        continue;
    }
    console.log(`| ${name} | ${r.cost.toFixed(1)} | ${r.tiles} | ${r.crossings.join('; ') || '-'} |`);
}
