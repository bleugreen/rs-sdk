// Route lengths for the Fremennik Trials travel legs, from the SDK's offline
// collision map (no server or bot needed):
//
//   bun docs/speedrun/scripts/quest-rellekka-routes.ts
//
// Same method as quest-arthur-grail-routes.ts: tiles summed along the
// pathfinder's waypoints, converted at 0.5 ticks per tile + 1 (primitives.md
// section 2). Doors are treated as open; `doors` lists those touched at a
// waypoint. The leg order is the route in fremennik_trials.md.

import { findLongPath, findDoorsAlongPath, initPathfinding } from '../../../sdk/pathfinding';

type Leg = [name: string, level: number, from: [number, number], to: [number, number]];

const legs: Leg[] = [
    ['1 Camelot teleport -> Brundt (longhall)', 0, [2757, 3478], [2659, 3670]],
    ['1w Seers bank -> Brundt (walk-in alternative)', 0, [2725, 3491], [2659, 3670]],
    ['2 Brundt -> Peer\'s entry door (outside)', 0, [2659, 3670], [2631, 3668]],
    ['3 Peer\'s exit door (outside) -> Thorvald\'s ladder', 0, [2636, 3668], [2667, 3693]],
    ['4 Thorvald\'s house (ground) -> Manni', 0, [2667, 3693], [2660, 3672]],
    ['5 Manni -> keg table', 0, [2660, 3672], [2660, 3677]],
    ['6 keg table -> Olaf', 0, [2660, 3677], [2672, 3683]],
    ['7 Olaf -> Sigli', 0, [2672, 3683], [2660, 3654]],
    ['8 Sigli -> Swensen\'s ladder', 0, [2660, 3654], [2645, 3657]],
    ['9 Swensen (maze exit) -> Lalli', 0, [2649, 3661], [2770, 3621]],
    ['10 Lalli -> Askeladden', 0, [2770, 3621], [2658, 3661]],
    ['11 Askeladden -> Lalli', 0, [2658, 3661], [2770, 3621]],
    ['12 Lalli/cauldron -> musical tree', 0, [2771, 3622], [2737, 3637]],
    ['13 Camelot teleport -> Seers spinning wheel stairs', 0, [2757, 3478], [2714, 3471]],
    ['14 Seers house stairs -> Poison Salesman (2737,3491)', 0, [2714, 3471], [2736, 3491]],
    ['14b Seers house stairs -> Poison Salesman (2695,3495)', 0, [2714, 3471], [2696, 3495]],
    ['15 Poison Salesman (2737,3491) -> Fossegrimen altar', 0, [2736, 3491], [2626, 3599]],
    ['15b Poison Salesman (2695,3495) -> Fossegrimen altar', 0, [2696, 3495], [2626, 3599]],
    ['16 altar -> Council workman', 0, [2626, 3599], [2656, 3592]],
    ['17 workman -> longhall pipe', 0, [2656, 3592], [2663, 3675]],
    ['18 pipe -> keg swap spot -> Manni', 0, [2663, 3675], [2660, 3672]],
    ['19 Manni -> backstage door', 0, [2660, 3672], [2668, 3683]],
    ['20 stage -> Sigmund', 0, [2661, 3683], [2641, 3681]],
    ['21 Sigmund (merchant chain end) -> Brundt', 0, [2641, 3681], [2659, 3670]],
    ['x Rellekka south gate -> Lalli', 0, [2662, 3645], [2770, 3621]]
];

initPathfinding();
console.log('| Leg | Straight line | Route tiles | Ticks at 0.5/tile + 1 | Doors on route |');
console.log('|---|---|---|---|---|');
for (const [name, level, [sx, sz], [dx, dz]] of legs) {
    const wps = findLongPath(level, sx, sz, dx, dz, 2000);
    let tiles = 0;
    let px = sx;
    let pz = sz;
    for (const w of wps) {
        tiles += Math.max(Math.abs(w.x - px), Math.abs(w.z - pz));
        px = w.x;
        pz = w.z;
    }
    const end = wps.at(-1);
    const reached = end !== undefined && Math.max(Math.abs(end.x - dx), Math.abs(end.z - dz)) <= 1;
    const doors = findDoorsAlongPath(wps).map(d => `${d.x},${d.z}`);
    const straight = Math.max(Math.abs(dx - sx), Math.abs(dz - sz));
    console.log(`| ${name} | ${straight} | ${reached ? tiles : `no route (stops ${end ? `${end.x},${end.z}` : 'at start'})`} | ${reached ? Math.ceil(tiles / 2) + 1 : ''} | ${doors.join(' ') || '-'} |`);
}
