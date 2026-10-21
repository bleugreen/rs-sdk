// Route lengths for the Biohazard travel legs, from the SDK's offline collision
// map (no server or bot needed):
//
//   bun docs/speedrun/scripts/quest-biohazard-routes.ts
//
// Same method as quest-plague-city-routes.ts. The pathfinder treats doors and
// gates as open, so the Varrock legs are also run with the gate into Guidor's
// district (3264,3405-3406) blocked, to show that the district has no other
// entrance and the gate search cannot be walked around.

import { findLongPath, getDoorAt, initPathfinding } from '../../../sdk/pathfinding';
import { measure, type Leg } from './quest-plague-city-routes';

const legs: Leg[] = [
    // East Ardougne
    ['Ardougne teleport (2661,3301) -> Elena door (2592,3339), outside', 0, [2661, 3301], [2592, 3340]],
    ['Elena door inside -> Elena (2592,3336)', 0, [2592, 3338], [2592, 3337]],
    ['Elena door outside -> Jerico (2612,3324)', 0, [2592, 3340], [2612, 3325]],
    ['Jerico -> Jerico cupboard (2611,3326), stand east', 0, [2612, 3325], [2613, 3326]],
    ['cupboard -> pigeon cages (2618,3324)', 0, [2613, 3326], [2618, 3324]],
    ['pigeon cages -> watch tower (2563,3302), east side', 0, [2618, 3324], [2564, 3302]],
    ['watch tower -> Omart (2559,3266)', 0, [2564, 3302], [2559, 3267]],
    // West Ardougne (the ladder drops you at (2556,3267))
    ['ladder landing (2556,3267) -> rotten apple (2535,3333)', 0, [2556, 3267], [2535, 3333]],
    ['rotten apple -> cauldron (2543,3332)', 0, [2535, 3333], [2542, 3332]],
    ['cauldron -> nurse cupboard (2517,3276), stand east', 0, [2542, 3332], [2519, 3276]],
    ['nurse cupboard -> HQ door (2551,3320), outside', 0, [2519, 3276], [2551, 3319]],
    ['HQ door inside -> spiral stairs (2542,3324)', 0, [2551, 3321], [2543, 3324]],
    ['stairs top (2543,3325 L1) -> upstairs door (2547,3325 L1)', 1, [2543, 3326], [2546, 3325]],
    ['upstairs door -> mourner (2551,3324 L1)', 1, [2548, 3325], [2550, 3324]],
    ['mourner -> gate (2551,3325 L1)', 1, [2550, 3324], [2550, 3325]],
    ['gate -> distillator crate (2554,3327 L1)', 1, [2552, 3326], [2553, 3327]],
    ['ladder landing -> Kilron (2556,3266) (alternative way back)', 0, [2556, 3267], [2556, 3267]],
    ['Kilron ladder drop (2559,3267) -> Elena door', 0, [2559, 3267], [2592, 3340]],
    // Elena to the chemist, carrying the plague sample (no teleports)
    ['Elena door -> chemist (2934,3210), walking', 0, [2592, 3340], [2934, 3211]],
    ['Elena door -> Captain Barnaby (2681,3276)', 0, [2592, 3340], [2681, 3276]],
    ['Brimhaven dock (2772,3230) -> Musa Point customs officer (2954,3147)', 0, [2772, 3230], [2954, 3148]],
    ['Port Sarim gangplank (3029,3217) -> chemist', 0, [3029, 3217], [2934, 3211]],
    ['chemist -> errand boys (2931..2935,3219)', 0, [2934, 3211], [2933, 3218]],
    // Rimmington to Varrock, carrying the sample (no teleports)
    ['errand boys -> Varrock gate (3263,3405), west side', 0, [2933, 3218], [3263, 3405]],
    ['gate east side (3265,3405) -> Hops (3268,3389)', 0, [3265, 3405], [3268, 3390]],
    ['Hops -> Chancy (3270,3391)', 0, [3268, 3390], [3270, 3392]],
    ['Chancy -> Da Vinci (3274,3390)', 0, [3270, 3392], [3274, 3391]],
    ['Da Vinci -> Guidor door (3282,3382), outside', 0, [3274, 3391], [3282, 3383]],
    ['Guidor door inside -> Guidor (3285,3381)', 0, [3282, 3381], [3284, 3381]],
    // back to Ardougne
    ['Ardougne teleport -> Elena door', 0, [2661, 3301], [2592, 3340]],
    ['Elena door -> Lathas stairs (2571,3295)', 0, [2592, 3340], [2572, 3295]],
    ['Ardougne teleport -> Lathas stairs', 0, [2661, 3301], [2572, 3295]],
    ['stairs top (2571,3295 L1) -> King Lathas (2578,3293 L1)', 1, [2571, 3296], [2577, 3293]],
];

measure(legs);

// The gate into Guidor's district, closed.
const gate = [getDoorAt(0, 3264, 3405), getDoorAt(0, 3264, 3406)].filter(d => d !== undefined);
for (const [name, from] of [
    ['south of Varrock (3240,3330)', [3240, 3330]],
    ['Varrock square (3213,3424)', [3213, 3424]],
    ['Rimmington errand boys', [2933, 3218]],
] as const) {
    const wps = findLongPath(0, from[0], from[1], 3282, 3383, 2000, gate);
    const end = wps.at(-1);
    console.log(`gate closed: ${name} -> Guidor door: ${end && Math.max(Math.abs(end.x - 3282), Math.abs(end.z - 3383)) <= 1 ? 'reached' : `no route (stops ${end?.x},${end?.z})`}`);
}
