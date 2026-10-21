// Route lengths for the Regicide travel legs, from the SDK's offline collision
// map (no server or bot needed):
//
//   bun docs/speedrun/scripts/quest-regicide-routes.ts [--tiles]
//
// Tiles are summed along the pathfinder's waypoints (Chebyshev steps), which is
// the route a run click follows. For every leg the script also lists the
// Regicide trap tiles (woodspring trigger tiles, tripwires, pitfalls) and the
// cross-over locs that lie on or next to the route, so a leg that the plain
// pathfinder routes through a trap or past a cross-over is visible. The
// collision map treats the cross-overs and the log balances as blocking, so a
// route found here never uses one; `--tiles` prints each route's tiles.
// Convert with primitives.md: 0.5 ticks per tile (+1 to the first step).

import { findLongPath, initPathfinding } from '../../../sdk/pathfinding';

type Leg = [name: string, level: number, from: [number, number], to: [number, number]];

export const legs: Leg[] = [
    // Well of Voyage underground (0_36_150) and the surface exit
    ['well landing (2343,9622) -> temple exit (2312,9623)', 0, [2343, 9622], [2313, 9623]],
    ['temple exit surface (2312,3216) -> Lord Iorwerth (2205,3252)', 0, [2312, 3216], [2206, 3252]],
    ['Iorwerth -> old-camp tracker (2257,3149)', 0, [2206, 3252], [2257, 3150]],
    ['tracker -> footprints (2240,3150)', 0, [2257, 3150], [2241, 3150]],
    ['footprints -> tracker', 0, [2241, 3150], [2257, 3150]],
    ['tracker -> first cross-over east side (2239,3149)', 0, [2257, 3150], [2239, 3149]],
    ['old-camp guard spot (2231,3149) -> Tyras camp cross-over north (2188,3172)', 0, [2231, 3149], [2188, 3172]],
    ['Tyras camp inside (2188,3168) -> Iorwerth', 0, [2188, 3168], [2206, 3252]],
    ['Iorwerth -> barrel (2205,3257)', 0, [2206, 3252], [2205, 3257]],
    ['Iorwerth -> loom (2198,3249)', 0, [2206, 3252], [2199, 3249]],
    ['loom -> tar pools (2263,3128)', 0, [2199, 3249], [2263, 3128]],
    ['tar pools -> sulphur (2258,3128)', 0, [2263, 3128], [2258, 3127]],
    ['sulphur -> Tyras camp furnace (2193,3146) [inside camp]', 0, [2258, 3127], [2194, 3146]],
    ['Iorwerth -> Arandar gate south side (2385,3333)', 0, [2206, 3252], [2385, 3333]],
    ['tar pools -> Arandar gate south side', 0, [2263, 3128], [2385, 3333]],
    ['Tyras camp inside -> Arandar gate south side', 0, [2188, 3168], [2385, 3333]],
    ['Arandar gate north side (2385,3336) -> Arianwyn zone (2584..2591,3296..3303)?', 0, [2385, 3336], [2585, 3300]],
    ['Tyras camp inside -> catapult (2185,3184)', 0, [2188, 3168], [2185, 3185]],
    ['catapult landing (2183,3185) -> Iorwerth', 0, [2183, 3185], [2206, 3252]],
    ['temple exit surface -> catapult (lazy guard side)', 0, [2312, 3216], [2185, 3185]],
    ['temple exit surface -> tar pools', 0, [2312, 3216], [2263, 3128]],
    // Kandarin side
    ['Arandar gate north -> West Ardougne gate', 0, [2385, 3336], [2558, 3300]],
    ['Ardougne teleport (2661,3301) -> Lathas stairs (2572,3296)', 0, [2661, 3301], [2572, 3297]],
    ['Falador teleport (2965,3378) -> Rimmington still (2927,3212)', 0, [2965, 3378], [2927, 3213]],
    ['Draynor glory (3105,3251) -> still', 0, [3105, 3251], [2927, 3213]],
    ['Arandar gate north -> still (walk)', 0, [2385, 3336], [2927, 3213]],
];

// Regicide trap trigger tiles (regicide_zones.rs2 softtimer/timer tiles and the trap locs).
const traps: Array<[string, number, number]> = [
    ['woodspring 2295,3214', 2295, 3214], ['woodspring trig', 2295, 3215],
    ['woodspring 2257,3227', 2257, 3227], ['woodspring trig', 2258, 3227],
    ['woodspring 2181,3209', 2181, 3209], ['woodspring trig', 2181, 3210], ['woodspring trig', 2181, 3211],
    ['woodspring 2235,3181', 2235, 3181], ['woodspring trig', 2236, 3181], ['woodspring trig', 2237, 3181],
    ['woodspring 2200,3169', 2200, 3169], ['woodspring trig', 2201, 3169],
    ['woodspring 2275,3163', 2275, 3163], ['woodspring trig', 2276, 3163],
    ['tripwire', 2215, 3154], ['tripwire', 2220, 3153], ['tripwire', 2251, 3168], ['tripwire', 2285, 3188], ['tripwire', 2294, 3243],
];
for (const [cx, cz] of [[2209, 3203], [2267, 3203], [2274, 3174], [2277, 3262]]) {
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) traps.push([`pitfall ${cx},${cz}`, cx + dx, cz + dz]);
}

export function routeTiles(level: number, sx: number, sz: number, dx: number, dz: number) {
    const wps = findLongPath(level, sx, sz, dx, dz, 4000);
    const tiles: Array<[number, number]> = [];
    let x = sx, z = sz;
    for (const w of wps) {
        while (x !== w.x || z !== w.z) {
            x += Math.sign(w.x - x);
            z += Math.sign(w.z - z);
            tiles.push([x, z]);
        }
    }
    const last = wps[wps.length - 1];
    return { tiles, reached: !!last && last.x === dx && last.z === dz, end: last };
}

if (import.meta.main) {
    initPathfinding();
    const showTiles = process.argv.includes('--tiles');
    console.log('| Leg | Straight line | Route tiles | Ticks at 0.5/tile + 1 | Traps on route |');
    console.log('|---|---|---|---|---|');
    for (const [name, level, [sx, sz], [dx, dz]] of legs) {
        const r = routeTiles(level, sx, sz, dx, dz);
        const straight = Math.max(Math.abs(dx - sx), Math.abs(dz - sz));
        const hits = traps.filter(([, tx, tz]) => r.tiles.some(([x, z]) => x === tx && z === tz)).map(t => `${t[0]}@${t[1]},${t[2]}`);
        const n = r.tiles.length;
        const reach = r.reached ? '' : ` (UNREACHED, ends ${r.end ? `${r.end.x},${r.end.z}` : 'nowhere'})`;
        console.log(`| ${name} | ${straight} | ${n}${reach} | ${Math.ceil(n / 2) + 1} | ${[...new Set(hits)].join('; ') || '-'} |`);
        if (showTiles) console.log('  ' + r.tiles.map(([x, z]) => `${x},${z}`).join(' '));
    }
}
