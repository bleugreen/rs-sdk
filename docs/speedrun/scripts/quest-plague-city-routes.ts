// Route lengths for the Plague City travel legs, from the SDK's offline
// collision map (no server or bot needed):
//
//   bun docs/speedrun/scripts/quest-plague-city-routes.ts
//
// Tiles are summed along the pathfinder's waypoints (Chebyshev steps), which is
// the route a run click follows. The pathfinder treats doors as open; `doors`
// lists the doors the route touches at a waypoint. Convert with primitives.md:
// 0.5 ticks per tile (+1 to the first step), 2 per door, 1-2 per climb.
// Coordinates are the NPC, loc and spawn tiles read from server/content/maps.

import { findDoorsAlongPath, findLongPath, initPathfinding } from '../../../sdk/pathfinding';

export type Leg = [name: string, level: number, from: [number, number], to: [number, number]];

const legs: Leg[] = [
    // getting to East Ardougne before the Ardougne teleport is unlocked
    ['Camelot teleport (2757,3478) -> Edmond (2568,3334)', 0, [2757, 3478], [2568, 3335]],
    ['Ardougne ship from Brimhaven, deck exit (2683,3271) -> Edmond', 0, [2683, 3271], [2568, 3335]],
    // Edmond's house
    ['Edmond (2568,3334) -> picture spawn (2576,3334)', 0, [2568, 3335], [2576, 3334]],
    ['picture -> Alrena (2573,3333)', 0, [2576, 3334], [2574, 3333]],
    ['Alrena -> Edmond', 0, [2574, 3333], [2568, 3335]],
    ['Edmond -> mud patch (2566,3332), stand east', 0, [2568, 3335], [2567, 3332]],
    // sewer under East Ardougne (fall lands on the mud pile tile)
    ['mud pile landing (2561,9738) -> sewer pipe (2530,9701), stand south', 0, [2561, 9737], [2530, 9702]],
    ['sewer pipe -> Edmond in the sewer (2535,9719)', 0, [2530, 9702], [2535, 9718]],
    ['sewer Edmond -> sewer pipe', 0, [2535, 9718], [2530, 9702]],
    // West Ardougne (the pipe lands at the manhole tile (2529,3304))
    ['manhole exit (2529,3304) -> Jethick (2540,3305)', 0, [2529, 3304], [2539, 3305]],
    ['Jethick -> Rehnison door (2531,3328), outside', 0, [2539, 3305], [2531, 3327]],
    ['Rehnison door inside -> Ted (2531,3331)', 0, [2531, 3329], [2531, 3330]],
    ['Ted -> Rehnison stairs (2527,3332)', 0, [2531, 3330], [2528, 3332]],
    ['stairs top (2527,3331 L1) -> Milli (2531,3330 L1)', 1, [2527, 3331], [2530, 3330]],
    ['Rehnison house -> plague house door (2533,3272), outside', 0, [2531, 3327], [2532, 3272]],
    ['plague house door -> clerk (2528,3317)', 0, [2532, 3272], [2528, 3316]],
    ['clerk -> Bravek door (2530,3314)', 0, [2528, 3316], [2530, 3314]],
    ['Bravek door -> Bravek (2536,3314)', 0, [2531, 3314], [2535, 3314]],
    ['Bravek -> plague house door, outside', 0, [2535, 3314], [2532, 3272]],
    ['plague house door inside -> barrel (2534,3268)', 0, [2533, 3272], [2534, 3269]],
    ['barrel -> stairs down (2536,3268)', 0, [2534, 3269], [2536, 3269]],
    ['basement landing (2537,9670) -> Elena door (2539,9672)', 0, [2537, 9670], [2538, 9672]],
    ['Elena door -> Elena (2541,9672)', 0, [2539, 9672], [2540, 9672]],
    ['Elena -> basement stairs up (2536,9671)', 0, [2540, 9672], [2537, 9671]],
    ['stairs up landing (2536,3271) -> plague house door', 0, [2536, 3271], [2533, 3272]],
    ['plague house door outside -> manhole (2529,3303)', 0, [2532, 3272], [2529, 3304]],
    ['manhole landing in sewer (2530,9703) -> mud pile (2561,9738)', 0, [2530, 9703], [2561, 9737]],
    ['garden landing (2566,3331) -> Edmond', 0, [2566, 3331], [2568, 3335]],
];

export function measure(list: Leg[]): void {
    initPathfinding();
    console.log('| Leg | Floor | Straight line | Route tiles | Ticks at 0.5/tile + 1 | Doors on route |');
    console.log('|---|---|---|---|---|---|');
    for (const [name, level, [sx, sz], [dx, dz]] of list) {
        const wps = findLongPath(level, sx, sz, dx, dz, 2000);
        let tiles = 0;
        let px = sx;
        let pz = sz;
        for (const w of wps) {
            tiles += Math.max(Math.abs(w.x - px), Math.abs(w.z - pz));
            px = w.x;
            pz = w.z;
        }
        const end = wps.at(-1) ?? { x: sx, z: sz };
        const reached = Math.max(Math.abs(end.x - dx), Math.abs(end.z - dz)) <= 1;
        const doors = findDoorsAlongPath(wps).map(d => `${d.x},${d.z}`);
        const straight = Math.max(Math.abs(dx - sx), Math.abs(dz - sz));
        console.log(`| ${name} | ${level} | ${straight} | ${reached ? tiles : `no route (stops ${end.x},${end.z})`} | ${reached ? Math.ceil(tiles / 2) + 1 : ''} | ${doors.join(' ') || '-'} |`);
    }
}

if (import.meta.main) measure(legs);
