// Tile counts for every travel leg of The Dig Site and The Tourist Trap,
// from the SDK's bundled collision data (sdk/pathfinding.ts, the same
// pathfinder bot.walkTo uses). No server or bot needed:
//
//   bun docs/speedrun/scripts/quest-digsite-touristtrap-paths.ts
//
// A leg's length is the sum of Chebyshev distances between consecutive
// waypoints (the pathfinder emits turn points, and diagonal steps cost one
// tile). Running covers 2 tiles per tick, so ticks = ceil(tiles / 2).

import { findLongPath, initPathfinding } from '../../../sdk/pathfinding';

type P = [number, number];
type Leg = { quest: string; name: string; from: P; to: P; level?: number };

const DIG: Record<string, P> = {
    examiner: [3361, 3341],
    rockPickCupboard: [3355, 3337],
    jarCupboard: [3354, 3332],
    expert: [3355, 3333],
    varrockTele: [3213, 3424],
    curator: [3255, 3445],
    panningGuide: [3376, 3377],
    panningPoint: [3376, 3372],
    trayGround: [3369, 3378],
    chest: [3374, 3378],
    barrel: [3364, 3378],
    bushSample: [3357, 3372],
    workmanSouth: [3359, 3396],
    student1: [3359, 3401],
    student2: [3358, 3420],
    student3: [3360, 3409],
    sacks: [3358, 3418],
    level3SiteWest: [3354, 3408],
    winch1: [3352, 3417],
    winch2: [3370, 3428],
};

const TT: Record<string, P> = {
    gloryAlKharid: [3293, 3163],
    irena: [3303, 3113],
    shantayGateNorth: [3302, 3118],
    shantayGateSouth: [3302, 3114],
    campCaptain: [3270, 3029],
    campGateOutside: [3272, 3028],
    campGateInside: [3274, 3028],
    slave: [3302, 3030],
    mineDoors: [3301, 3037],
    siadLadder: [3290, 3036],
    bedabinShabim: [3171, 3025],
    bedabinGuard: [3170, 3045],
    anvil: [3171, 3048],
    winchSurface: [3279, 3017],
    upperBarrel: [3278, 3017],
    cartDriver: [3287, 3022],
    cartEscapeDrop: [3258, 3029],
};

const MINE: Record<string, P> = {
    mineArrival: [3278, 9426],
    caveGuard: [3279, 9416],
    caveWestSide: [3280, 9415],
    caveEastArrival: [3286, 9415],
    lowerMinecart: [3303, 9417],
    emptyBarrel: [3303, 9418],
    lift: [3292, 9423],
    cartArrival: [3319, 9431],
    ana: [3302, 9466],
    upperMinecart: [3318, 9430],
    lowerCartReturn: [3302, 9417],
    caveEastSide: [3284, 9415],
    caveWestArrival: [3278, 9415],
    mineExitDoors: [3278, 9425],
};

const legs: Leg[] = [
    // The Dig Site
    { quest: 'digsite', name: 'examiner -> varrock museum curator (walk)', from: DIG.examiner, to: DIG.curator },
    { quest: 'digsite', name: 'varrock teleport -> curator', from: DIG.varrockTele, to: DIG.curator },
    { quest: 'digsite', name: 'curator -> examiner (walk back)', from: DIG.curator, to: DIG.examiner },
    { quest: 'digsite', name: 'examiner -> rock pick cupboard', from: DIG.examiner, to: DIG.rockPickCupboard },
    { quest: 'digsite', name: 'rock pick cupboard -> jar cupboard', from: DIG.rockPickCupboard, to: DIG.jarCupboard },
    { quest: 'digsite', name: 'examiner -> panning guide', from: DIG.examiner, to: DIG.panningGuide },
    { quest: 'digsite', name: 'panning guide -> panning point', from: DIG.panningGuide, to: DIG.panningPoint },
    { quest: 'digsite', name: 'panning point -> bush sample', from: DIG.panningPoint, to: DIG.bushSample },
    { quest: 'digsite', name: 'bush sample -> workman (south)', from: DIG.bushSample, to: DIG.workmanSouth },
    { quest: 'digsite', name: 'workman -> student1', from: DIG.workmanSouth, to: DIG.student1 },
    { quest: 'digsite', name: 'student1 -> student3', from: DIG.student1, to: DIG.student3 },
    { quest: 'digsite', name: 'student3 -> student2', from: DIG.student3, to: DIG.student2 },
    { quest: 'digsite', name: 'student2 -> examiner', from: DIG.student2, to: DIG.examiner },
    { quest: 'digsite', name: 'examiner -> level 3 site (west)', from: DIG.examiner, to: DIG.level3SiteWest },
    { quest: 'digsite', name: 'level 3 site -> expert', from: DIG.level3SiteWest, to: DIG.expert },
    { quest: 'digsite', name: 'expert -> workman (south)', from: DIG.expert, to: DIG.workmanSouth },
    { quest: 'digsite', name: 'workman -> winch2 (private)', from: DIG.workmanSouth, to: DIG.winch2 },
    { quest: 'digsite', name: 'winch2 -> winch1', from: DIG.winch2, to: DIG.winch1 },
    { quest: 'digsite', name: 'winch1 -> chest/barrels', from: DIG.winch1, to: DIG.chest },
    { quest: 'digsite', name: 'chest -> expert', from: DIG.chest, to: DIG.expert },
    { quest: 'digsite', name: 'expert -> winch1', from: DIG.expert, to: DIG.winch1 },
    // The Tourist Trap, surface
    { quest: 'touristtrap', name: 'glory (Al Kharid) -> Irena', from: TT.gloryAlKharid, to: TT.irena },
    { quest: 'touristtrap', name: 'Shantay gate (south side) -> mining camp captain', from: TT.shantayGateSouth, to: TT.campCaptain },
    { quest: 'touristtrap', name: 'camp gate (inside) -> surface slave', from: TT.campGateInside, to: TT.slave },
    { quest: 'touristtrap', name: 'surface slave -> mine doors', from: TT.slave, to: TT.mineDoors },
    { quest: 'touristtrap', name: 'mine doors -> camp gate (inside)', from: TT.mineDoors, to: TT.campGateInside },
    { quest: 'touristtrap', name: 'camp gate (outside) -> Al Shabim', from: TT.campGateOutside, to: TT.bedabinShabim },
    { quest: 'touristtrap', name: 'Al Shabim -> camp gate (outside)', from: TT.bedabinShabim, to: TT.campGateOutside },
    { quest: 'touristtrap', name: 'camp gate (inside) -> Siad ladder', from: TT.campGateInside, to: TT.siadLadder },
    { quest: 'touristtrap', name: 'Siad ladder -> camp gate (inside)', from: TT.siadLadder, to: TT.campGateInside },
    { quest: 'touristtrap', name: 'Al Shabim -> tent guard', from: TT.bedabinShabim, to: TT.bedabinGuard },
    { quest: 'touristtrap', name: 'anvil -> Al Shabim', from: TT.anvil, to: TT.bedabinShabim },
    { quest: 'touristtrap', name: 'mine doors -> surface winch', from: TT.mineDoors, to: TT.winchSurface },
    { quest: 'touristtrap', name: 'upper barrel -> mine cart driver', from: TT.upperBarrel, to: TT.cartDriver },
    { quest: 'touristtrap', name: 'cart escape drop -> Shantay gate (south side)', from: TT.cartEscapeDrop, to: TT.shantayGateSouth },
    // The Tourist Trap, underground (level 0, z ~ 9400)
    { quest: 'touristtrap', name: 'mine arrival -> cave guard', from: MINE.mineArrival, to: MINE.caveGuard },
    { quest: 'touristtrap', name: 'cave guard -> cave passage (west side)', from: MINE.caveGuard, to: MINE.caveWestSide },
    { quest: 'touristtrap', name: 'cave east arrival -> empty barrel', from: MINE.caveEastArrival, to: MINE.emptyBarrel },
    { quest: 'touristtrap', name: 'empty barrel -> lower minecart', from: MINE.emptyBarrel, to: MINE.lowerMinecart },
    { quest: 'touristtrap', name: 'cart arrival -> Ana', from: MINE.cartArrival, to: MINE.ana },
    { quest: 'touristtrap', name: 'Ana -> upper minecart', from: MINE.ana, to: MINE.upperMinecart },
    { quest: 'touristtrap', name: 'lower cart return -> lift', from: MINE.lowerCartReturn, to: MINE.lift },
    { quest: 'touristtrap', name: 'lift -> cave passage (east side)', from: MINE.lift, to: MINE.caveEastSide },
    { quest: 'touristtrap', name: 'cave west arrival -> mine exit doors', from: MINE.caveWestArrival, to: MINE.mineExitDoors },
];

function chebyshev(a: { x: number; z: number }, b: { x: number; z: number }) {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

initPathfinding();
const quest = process.argv[2];
console.log('| Quest | Leg | Tiles | Ticks at run | Reached |');
console.log('|---|---|---|---|---|');
for (const leg of legs) {
    if (quest && leg.quest !== quest) continue;
    const level = leg.level ?? 0;
    const wps = findLongPath(level, leg.from[0], leg.from[1], leg.to[0], leg.to[1], 2000);
    let tiles = 0;
    let prev = { x: leg.from[0], z: leg.from[1] };
    for (const wp of wps) {
        tiles += chebyshev(prev, wp);
        prev = wp;
    }
    const last = wps.length ? wps[wps.length - 1] : { x: leg.from[0], z: leg.from[1] };
    const reached = chebyshev(last, { x: leg.to[0], z: leg.to[1] }) <= 1 ? 'yes' : `no (ends ${last.x},${last.z})`;
    console.log(`| ${leg.quest} | ${leg.name} | ${tiles} | ${Math.ceil(tiles / 2)} | ${reached} |`);
}
