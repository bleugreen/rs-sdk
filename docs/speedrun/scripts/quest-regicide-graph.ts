// Isafdar (Tirannwn forest) connectivity for Regicide, offline from the SDK
// collision map:
//
//   bun docs/speedrun/scripts/quest-regicide-graph.ts [--components]
//
// The forest is split into walkable regions joined only by scripted crossings:
// log balances (Agility 45, quest_regicide.rs2:341-386), pitfalls ("leaves",
// jumped with stat_random(agility,160,300), :228-281) and cross-overs (Agility 56
// and %regicide_quest >= spoken_tracker2, :388-477). This script flood-fills the
// regions with the engine's own canTravel, adds one edge per crossing (start and
// landing tiles computed exactly as the script does), and runs Dijkstra between
// the quest's points, once with the cross-overs allowed and once without.
// Walking edges are route tiles from findLongPath; crossings are reported by
// type so their tick cost can be applied from the measured figures.

import * as rsmod from '../../../server/vendor/rsmod-pathfinder';
import { CollisionType } from '../../../server/vendor/rsmod-pathfinder';
import { findLongPath, initPathfinding } from '../../../sdk/pathfinding';

type P = [number, number];
const key = (x: number, z: number) => `${x},${z}`;

initPathfinding();

// Tiles a walk must never touch: the 3x3 leaves of each pitfall (stepping on one
// drops the player into the pit, regicide_zones.rs2:73-82), the woodspring
// trigger tiles (:53-66) and the tripwire tiles. All are blockwalk=no locs, so
// the collision map marks them walkable; block them for this analysis.
export const hazardTiles: Array<[number, number]> = [];
for (const [cx, cz] of [[2209, 3203], [2267, 3203], [2274, 3174], [2277, 3262]]) {
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) hazardTiles.push([cx + dx, cz + dz]);
}
hazardTiles.push([2295, 3214], [2295, 3215], [2257, 3227], [2258, 3227], [2181, 3210], [2181, 3211], [2236, 3181], [2237, 3181], [2200, 3169], [2201, 3169], [2275, 3163], [2276, 3163]);
for (const [x, z] of [[2215, 3154], [2220, 3153], [2251, 3168], [2285, 3188], [2294, 3243]]) hazardTiles.push([x, z]);
for (const [x, z] of hazardTiles) rsmod.changeFloor(x, z, 0, true);

const X0 = 2130, X1 = 2430, Z0 = 3060, Z1 = 3345;
const comp = new Map<string, number>();
const compSize: number[] = [];
const dirs: P[] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
function canStep(x: number, z: number, dx: number, dz: number) {
    return rsmod.canTravel(0, x, z, dx, dz, 1, 0, CollisionType.NORMAL);
}
function walkable(x: number, z: number) {
    // a tile is walkable if some neighbour can step onto it or it can step out
    return dirs.some(([dx, dz]) => canStep(x, z, dx, dz));
}
let nComp = 0;
for (let x = X0; x <= X1; x++) {
    for (let z = Z0; z <= Z1; z++) {
        if (comp.has(key(x, z)) || !walkable(x, z)) continue;
        const id = nComp++;
        let size = 0;
        const q: P[] = [[x, z]];
        comp.set(key(x, z), id);
        while (q.length) {
            const [cx, cz] = q.pop()!;
            size++;
            for (const [dx, dz] of dirs) {
                const nx = cx + dx, nz = cz + dz;
                if (nx < X0 || nx > X1 || nz < Z0 || nz > Z1) continue;
                if (comp.has(key(nx, nz))) continue;
                if (!canStep(cx, cz, dx, dz)) continue;
                comp.set(key(nx, nz), id);
                q.push([nx, nz]);
            }
        }
        compSize[id] = size;
    }
}

type Crossing = { kind: string; a: P; b: P; note: string };
const crossings: Crossing[] = [];
// Log balances: forcemove onto the start loc, then 1+2+2 tiles (quest_regicide.rs2:367-386).
crossings.push({ kind: 'log', a: [2196, 3237], b: [2202, 3237], note: 'logbalance1 (2197/2201,3237)' });
crossings.push({ kind: 'log', a: [2258, 3250], b: [2264, 3250], note: 'logbalance2 (2259/2263,3250)' });
crossings.push({ kind: 'log', a: [2290, 3232], b: [2290, 3239], note: 'logbalance3 (2290,3233/3238)' });
// Pitfalls: from 2 tiles outside the centre to 2 tiles beyond it, both axes (:239-281).
for (const [cx, cz] of [[2209, 3203], [2267, 3203], [2274, 3174], [2277, 3262]] as P[]) {
    crossings.push({ kind: 'pitfall', a: [cx - 2, cz], b: [cx + 2, cz], note: `pitfall ${cx},${cz} E-W` });
    crossings.push({ kind: 'pitfall', a: [cx, cz - 2], b: [cx, cz + 2], note: `pitfall ${cx},${cz} N-S` });
}
// Woodsprings ("Sticks", op Pass, stat_random(agility,30,155)), :31-77. Landing
// tiles per angle: east crosses x to loc+2 / loc-1, west to loc-1 / loc+3,
// north z to loc+3 / loc-1, south z to loc-1 / loc+3. Walking onto the trigger
// tiles (regicide_zones.rs2) springs the trap and throws the player back.
const woodsprings: Array<[number, number, number]> = [
    [2181, 3209, 3], [2200, 3169, 2], [2235, 3181, 0], [2257, 3227, 2], [2275, 3163, 2], [2295, 3214, 1],
];
for (const [x, z, angle] of woodsprings) {
    const note = `woodspring (${x},${z})`;
    if (angle === 2) crossings.push({ kind: 'woodspring', a: [x - 1, z], b: [x + 2, z], note });
    else if (angle === 0) crossings.push({ kind: 'woodspring', a: [x - 1, z], b: [x + 3, z], note });
    else if (angle === 1) crossings.push({ kind: 'woodspring', a: [x, z - 1], b: [x, z + 3], note });
    else crossings.push({ kind: 'woodspring', a: [x, z - 1], b: [x, z + 3], note });
}
// Tripwires (op Step-over, length 2), :136-188: crossed 2 tiles perpendicular to
// the wire; walking into one also carries the player across (with poison and
// two 5-damage hits) via [timer,regicide_tripwire].
const tripwires: Array<[number, number, number]> = [[2215, 3154, 2], [2220, 3153, 0], [2251, 3168, 3], [2285, 3188, 3], [2294, 3243, 0]];
for (const [x, z, angle] of tripwires) {
    const note = `tripwire (${x},${z})`;
    if (angle === 0 || angle === 2) crossings.push({ kind: 'tripwire', a: [x, z - 1], b: [x, z + 1], note });
    else crossings.push({ kind: 'tripwire', a: [x - 1, z], b: [x + 1, z], note });
}
// Cross-overs (angle from the map; 0 west, 1 north, 2 east, 3 south), :430-455.
const crossOvers: Array<[string, number, number, number]> = [
    ['cross_over1', 2232, 3148, 3], ['cross_over1', 2233, 3218, 1], ['cross_over1', 2237, 3248, 3], ['cross_over1', 2272, 3191, 1],
    ['cross_over1', 2278, 3226, 2], ['cross_over1', 2302, 3214, 0], ['cross_over1_tyras_camp', 2187, 3163, 2],
    ['cross_over2', 2216, 3164, 2], ['cross_over2', 2227, 3218, 1], ['cross_over2', 2231, 3248, 3], ['cross_over2', 2235, 3148, 3],
    ['cross_over2', 2266, 3191, 1], ['cross_over2', 2278, 3223, 2], ['cross_over2', 2302, 3217, 2], ['cross_over2', 2302, 3223, 2],
    ['cross_over2_tyras_camp', 2187, 3169, 2],
    ['cross_over3', 2165, 3189, 3], ['cross_over3', 2173, 3156, 2], ['cross_over3', 2187, 3166, 2], ['cross_over3', 2216, 3161, 2],
    ['cross_over3', 2216, 3167, 2], ['cross_over3', 2230, 3218, 1], ['cross_over3', 2234, 3248, 3], ['cross_over3', 2236, 3218, 1],
    ['cross_over3', 2238, 3148, 3], ['cross_over3', 2269, 3191, 1], ['cross_over3', 2278, 3229, 0], ['cross_over3', 2302, 3220, 0],
];
for (const [name, x, z, angle] of crossOvers) {
    if (angle === 1 || angle === 3) crossings.push({ kind: 'crossover', a: [x - 1, z + 1], b: [x + 2, z + 1], note: `${name} (${x},${z}) E-W` });
    else crossings.push({ kind: 'crossover', a: [x + 1, z - 1], b: [x + 1, z + 2], note: `${name} (${x},${z}) N-S` });
}

export const points: Record<string, P> = {
    templeExit: [2312, 3216],
    iorwerth: [2206, 3252],
    tracker: [2257, 3150],
    footprints: [2241, 3150],
    guardSpot: [2231, 3149],
    tyrasCampNorth: [2188, 3172],
    tyrasCampInside: [2188, 3168],
    furnace: [2194, 3146],
    lazyGuard: [2182, 3185],
    catapultLanding: [2183, 3185],
    loom: [2199, 3249],
    barrelIorwerth: [2205, 3257],
    tarPools: [2263, 3128],
    sulphur: [2258, 3127],
    arandarSouth: [2385, 3333],
};

const compOf = (p: P) => comp.get(key(p[0], p[1]));
if (process.argv.includes('--components')) {
    const used = new Set<number>();
    for (const c of crossings) { used.add(compOf(c.a) ?? -1); used.add(compOf(c.b) ?? -1); }
    for (const [n, p] of Object.entries(points)) used.add(compOf(p) ?? -1);
    for (const id of [...used].sort((a, b) => a - b)) console.log(`component ${id}: ${compSize[id] ?? '?'} tiles`);
    for (const [n, p] of Object.entries(points)) console.log(`point ${n} ${p} -> component ${compOf(p)}`);
    for (const c of crossings) console.log(`${c.kind} ${c.note}: ${c.a} [${compOf(c.a)}] <-> ${c.b} [${compOf(c.b)}]`);
}

// Graph nodes: crossing endpoints and points.
function walkTiles(a: P, b: P): number | null {
    if (a[0] === b[0] && a[1] === b[1]) return 0;
    const ca = compOf(a), cb = compOf(b);
    if (ca === undefined || ca !== cb) return null;
    const wps = findLongPath(0, a[0], a[1], b[0], b[1], 4000);
    const last = wps[wps.length - 1];
    if (!last || last.x !== b[0] || last.z !== b[1]) return null;
    let n = 0, x = a[0], z = a[1];
    for (const w of wps) { n += Math.max(Math.abs(w.x - x), Math.abs(w.z - z)); x = w.x; z = w.z; }
    return n;
}

// Crossing cost in tile-equivalents (0.5 tick per tile) for ranking only; the
// document applies measured ticks per crossing type.
// Measured ticks x 2 (quest-regicide-obstacles.ts): log 8-9, pitfall 2 (+ a 7%
// fall at Agility 56), chained cross-over 6, woodspring about 11 expected,
// tripwire step-over 5.
const crossCost: Record<string, number> = { log: 17, pitfall: 6, crossover: 12, woodspring: 22, tripwire: 10 };

export function solve(from: P, to: P, allowCrossovers: boolean) {
    const nodes: P[] = [from, to];
    const nodeKey = (p: P) => key(p[0], p[1]);
    // Snap an endpoint that lands on a blocked or one-tile pocket to the
    // nearest tile of a real region (within 2 tiles).
    void nodes;
    const usable = crossings.filter(c => allowCrossovers || c.kind !== 'crossover');
    for (const c of usable) { nodes.push(c.a, c.b); }
    const uniq = new Map<string, P>();
    for (const n of nodes) if (compOf(n) !== undefined) uniq.set(nodeKey(n), n);
    const list = [...uniq.values()];
    const dist = new Map<string, number>();
    const prev = new Map<string, { from: string; how: string; tiles: number }>();
    dist.set(nodeKey(from), 0);
    const done = new Set<string>();
    const walkCache = new Map<string, number | null>();
    while (true) {
        let best: P | null = null, bd = Infinity;
        for (const n of list) { const d = dist.get(nodeKey(n)); if (d !== undefined && !done.has(nodeKey(n)) && d < bd) { bd = d; best = n; } }
        if (!best) break;
        const bk = nodeKey(best);
        done.add(bk);
        if (bk === nodeKey(to)) break;
        for (const n of list) {
            const nk = nodeKey(n);
            if (done.has(nk) || compOf(n) !== compOf(best)) continue;
            const ck = bk < nk ? `${bk}|${nk}` : `${nk}|${bk}`;
            if (!walkCache.has(ck)) walkCache.set(ck, walkTiles(best, n));
            const w = walkCache.get(ck);
            if (w === null || w === undefined) continue;
            if (bd + w < (dist.get(nk) ?? Infinity)) { dist.set(nk, bd + w); prev.set(nk, { from: bk, how: 'walk', tiles: w }); }
        }
        for (const c of usable) {
            for (const [s, e] of [[c.a, c.b], [c.b, c.a]] as Array<[P, P]>) {
                if (nodeKey(s) !== bk) continue;
                const ek = nodeKey(e);
                const nd = bd + crossCost[c.kind];
                if (nd < (dist.get(ek) ?? Infinity)) { dist.set(ek, nd); prev.set(ek, { from: bk, how: `${c.kind}: ${c.note}`, tiles: 0 }); }
            }
        }
    }
    const steps: Array<{ at: string; how: string; tiles: number }> = [];
    let cur = nodeKey(to);
    if (!prev.has(cur) && cur !== nodeKey(from)) return null;
    while (cur !== nodeKey(from)) { const p = prev.get(cur)!; steps.unshift({ at: cur, how: p.how, tiles: p.tiles }); cur = p.from; }
    const tiles = steps.reduce((a, s) => a + s.tiles, 0);
    const kinds: Record<string, number> = {};
    for (const s of steps) if (s.how !== 'walk') { const k = s.how.split(':')[0]; kinds[k] = (kinds[k] ?? 0) + 1; }
    return { tiles, kinds, steps };
}

if (import.meta.main) {
    const legs: Array<[string, string]> = [
        ['templeExit', 'iorwerth'], ['iorwerth', 'tracker'], ['tracker', 'footprints'], ['footprints', 'tracker'],
        ['tracker', 'guardSpot'], ['guardSpot', 'tyrasCampInside'], ['tyrasCampInside', 'iorwerth'],
        ['iorwerth', 'loom'], ['iorwerth', 'tarPools'], ['loom', 'tarPools'], ['tarPools', 'furnace'], ['furnace', 'lazyGuard'],
        ['tarPools', 'arandarSouth'], ['furnace', 'arandarSouth'], ['iorwerth', 'arandarSouth'], ['templeExit', 'tarPools'],
        ['templeExit', 'furnace'], ['templeExit', 'lazyGuard'], ['catapultLanding', 'iorwerth'], ['tyrasCampInside', 'tarPools'],
        ['iorwerth', 'furnace'], ['loom', 'furnace'], ['lazyGuard', 'iorwerth'], ['tyrasCampInside', 'lazyGuard'],
    ];
    for (const allow of [false, true]) {
        console.log(`\n## cross-overs ${allow ? 'allowed (stage >= 8, Agility 56)' : 'not used'}`);
        for (const [f, t] of legs) {
            const r = solve(points[f], points[t], allow);
            if (!r) { console.log(`${f} -> ${t}: NO ROUTE`); continue; }
            console.log(`${f} -> ${t}: ${r.tiles} tiles, crossings ${JSON.stringify(r.kinds)}`);
            for (const s of r.steps) console.log(`    ${s.how === 'walk' ? `walk ${s.tiles}` : s.how} -> ${s.at}`);
        }
    }
}
