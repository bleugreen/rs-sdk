// Route lengths for the travel legs of Merlin's Crystal and Holy Grail, from
// the SDK's offline collision map (no server or bot needed):
//
//   bun docs/speedrun/scripts/quest-arthur-grail-routes.ts
//
// Each leg is one floor. Tiles are summed along the pathfinder's waypoints
// (Chebyshev steps), which is the route a run click follows. Doors are
// treated as open by the pathfinder; `doors` lists those the route touches at
// a waypoint, so it can undercount doors on straight stretches. Convert with
// primitives.md: 0.5 ticks per tile (+1 to the first step), 2 per door,
// 1-2 per climb.

import { findLongPath, findDoorsAlongPath, initPathfinding } from '../../../sdk/pathfinding';

type Leg = [name: string, level: number, from: [number, number], to: [number, number]];

const legs: Leg[] = [
    // Merlin's Crystal
    ['mc: Camelot teleport -> King Arthur', 0, [2757, 3478], [2764, 3512]],
    ['mc: King Arthur -> Sir Gawain', 0, [2764, 3512], [2763, 3507]],
    ['mc: Sir Gawain -> hall staircase (2750,3510)', 0, [2763, 3507], [2751, 3510]],
    ['mc: staircase top -> Sir Lancelot (L1)', 1, [2751, 3512], [2759, 3514]],
    ['mc: hall staircase -> Catherby crate (2801,3442)', 0, [2751, 3510], [2801, 3443]],
    ['mc: Camelot teleport -> Catherby crate', 0, [2757, 3478], [2801, 3443]],
    ['mc: keep front door -> candle maker (measured 39-41 ticks)', 0, [2763, 3401], [2800, 3440]],
    ['mc: candle maker -> Lady of the Lake (walk)', 0, [2800, 3440], [2924, 3404]],
    ['mc: Falador teleport -> Lady of the Lake', 0, [2965, 3378], [2924, 3404]],
    ['mc: Lady of the Lake -> jeweller door, Port Sarim (walk)', 0, [2924, 3404], [3016, 3245]],
    ['mc: Draynor glory -> jeweller door', 0, [3105, 3251], [3016, 3245]],
    ['mc: Falador teleport -> jeweller door', 0, [2965, 3378], [3016, 3245]],
    ['mc: Edgeville glory -> chaos altar (3239,3608)', 0, [3087, 3496], [3239, 3607]],
    ['mc: Varrock teleport -> chaos altar', 0, [3213, 3424], [3239, 3607]],
    ['mc: Camelot teleport -> magic symbol (2780,3515)', 0, [2757, 3478], [2780, 3514]],
    ['mc: magic symbol -> tower ladder (2769,3493)', 0, [2780, 3514], [2769, 3494]],
    ['mc: tower ladder L1 -> ladder up (2767,3491)', 1, [2769, 3494], [2767, 3492]],
    ['mc: ladder L2 -> giant crystal (2767,3493)', 2, [2767, 3491], [2767, 3492]],
    ['mc: tower ladder L0 -> King Arthur', 0, [2769, 3494], [2764, 3512]],
    // Holy Grail
    ['hg: staircase top -> Merlin workshop door (L1)', 1, [2751, 3512], [2764, 3504]],
    ['hg: Draynor glory -> Draynor bank', 0, [3105, 3251], [3092, 3245]],
    ['hg: Draynor bank -> Port Sarim monks', 0, [3092, 3245], [3047, 3236]],
    ['hg: Draynor glory -> Port Sarim monks (no bank)', 0, [3105, 3251], [3047, 3236]],
    ['hg: Entrana gangplank -> High Priest', 0, [2834, 3335], [2851, 3348]],
    ['hg: High Priest -> Entrana monk', 0, [2851, 3348], [2834, 3336]],
    ['hg: Camelot teleport -> Galahad (2612,3474)', 0, [2757, 3478], [2612, 3475]],
    ['hg: Draynor bank -> Draynor Manor front door', 0, [3092, 3245], [3108, 3352]],
    ['hg: Draynor glory -> Draynor Manor front door', 0, [3105, 3251], [3108, 3352]],
    ['hg: Karamja glory -> crossing (2741,3235)', 0, [2918, 3176], [2741, 3235]],
    ['hg: Ardougne teleport -> Captain Barnaby', 0, [2661, 3301], [2675, 3275]],
    ['hg: Brimhaven dock -> crossing', 0, [2772, 3230], [2741, 3235]],
    ['hg: Falador teleport -> goblin village sacks (2960,3507)', 0, [2965, 3378], [2959, 3506]],
    ['hg: Camelot teleport -> goblin village sacks', 0, [2757, 3478], [2959, 3506]],
    ['hg: healed realm arrival -> castle staircase (measured 85 ticks)', 0, [2678, 4715], [2648, 4684]],
];

initPathfinding();
console.log('| Leg | Floor | Straight line | Route tiles | Ticks at 0.5/tile + 1 | Doors on route |');
console.log('|---|---|---|---|---|---|');
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
    console.log(`| ${name} | ${level} | ${straight} | ${reached ? tiles : `no route (stops ${end ? `${end.x},${end.z}` : 'at start'})`} | ${reached ? Math.ceil(tiles / 2) + 1 : ''} | ${doors.join(' ') || '-'} |`);
}
