// Route lengths for the Watchtower and Temple of Ikov feasibility estimates.
//
//   bun docs/speedrun/scripts/quest-wtikov-routes.ts
//
// Uses the SDK's own collision snapshot and route finder (sdk/pathfinding.ts),
// so no server is needed. The two Gu'Tanoth gates are blocked: their opening
// is scripted (quest_itwatchtower.rs2 open_gutanoth_gate), and the snapshot
// otherwise treats every door as passable. A leg prints its route tiles
// (Chebyshev steps along the waypoints) or UNREACHABLE with where the route
// stopped. These are route lengths, not measured walks: bot.walkTo costs about
// 0.57 ticks per tile and chained clicks 0.5 (primitives.md section 2).

import { findLongPath, getDoorAt } from '../../../sdk/pathfinding';

const gates = [[2549, 3028], [2550, 3028], [2504, 3062], [2504, 3063]]
    .map(([x, z]) => getDoorAt(0, x, z))
    .filter((d): d is NonNullable<typeof d> => !!d);

function leg(name: string, a: [number, number], b: [number, number]): number | null {
    const p = findLongPath(0, a[0], a[1], b[0], b[1], 2000, gates);
    const end = p[p.length - 1];
    let len = 0, prev = { x: a[0], z: a[1] };
    for (const w of p) { len += Math.max(Math.abs(w.x - prev.x), Math.abs(w.z - prev.z)); prev = w; }
    const ok = !!end && Math.max(Math.abs(end.x - b[0]), Math.abs(end.z - b[1])) <= 1;
    console.log(`${name.padEnd(58)} ${ok ? String(len).padStart(5) + ' tiles' : 'UNREACHABLE (stops at ' + (end ? end.x + ',' + end.z : 'start') + ')'}`);
    return ok ? len : null;
}

console.log(`gates blocked: ${gates.length}\n\n# Watchtower (surface)`);
const ardy: [number, number] = [2661, 3302];
const hill: [number, number] = [2546, 3065];
const yanille: [number, number] = [2544, 3109];
const ladderOut: [number, number] = [2500, 2988];
const gate1N: [number, number] = [2549, 3030];
leg('Ardougne teleport -> Watchtower ladder', ardy, yanille);
leg('Ardougne teleport -> Toban tunnel (2499,2989)', ardy, ladderOut);
leg('Toban plateau: tunnel exit (2576,3029) -> Gorad', [2576, 3029], [2577, 3022]);
leg('Toban plateau: Gorad -> ladder down (2575,3029)', [2577, 3022], [2575, 3030]);
leg('Toban ladder landing (2500,2988) -> east gate guard', ladderOut, gate1N);
leg('Gutanoth hill (pushed out) -> east gate guard', hill, gate1N);
leg('east gate, inside (2549,3027) -> city guard', [2549, 3027], [2541, 3031]);
leg('chasm jump landing (2530,3029) -> city guard', [2530, 3029], [2541, 3031]);
leg('south city (2499,2990) -> chasm jump guard', [2499, 2990], [2527, 3020]);
leg('south city (2499,2990) -> cave1 (2560,3022)', [2499, 2990], [2560, 3023]);
leg('south city (2499,2990) -> cave6 (2527,3011)', [2499, 2990], [2527, 3012]);
leg('east gate guard -> cave5 (2553,3033)', gate1N, [2553, 3034]);
leg('cave5 exit (2552,3034) -> cave4 (2552,3052)', [2552, 3034], [2552, 3053]);
leg('cave4 exit (2553,3054) -> cave3 (2539,3052)', [2553, 3054], [2539, 3053]);
leg('cave3 exit (2540,3054) -> cave2 (2522,3068)', [2540, 3054], [2522, 3069]);
leg('Gutanoth hill -> Grew rope tree (2499,3087)', hill, [2498, 3087]);
leg('Grew swing landing (2505,3087) -> Grew', [2505, 3087], [2513, 3083]);
leg('Watchtower -> west gate (2505,3062)', yanille, [2505, 3062]);
leg('west gate inside (2503,3062) -> enclave guard', [2503, 3062], [2506, 3037]);
leg('enclave cave exit (2540,3054) -> Watchtower', [2540, 3054], yanille);
leg('fingernail bush (2544,3134) -> Watchtower (not on the shortcut route)', [2544, 3133], yanille);

console.log('\n# Watchtower (underground)');
leg('cave5: arrival -> scared skavid -> exit', [2504, 9441], [2499, 9433]);
leg('cave1: arrival -> skavid (Nod)', [2498, 9418], [2503, 9415]);
leg('cave4: arrival -> skavid (Cur)', [2498, 9451], [2500, 9451]);
leg('cave3: arrival -> skavid (Ar)', [2518, 9455], [2515, 9452]);
leg('cave2: arrival -> skavid (Ig)', [2532, 9469], [2530, 9465]);
leg('cave6: arrival -> mad skavid', [2522, 9411], [2523, 9411]);
leg('cave6: mad skavid -> nightshade (2528,9415)', [2523, 9411], [2528, 9415]);
const shamanRoute: [number, number][] = [[2588, 9410], [2577, 9451], [2582, 9437], [2592, 9436], [2606, 9438], [2607, 9451], [2599, 9461], [2590, 9450], [2598, 9467]];
let shaman = 0;
for (let i = 1; i < shamanRoute.length; i++) shaman += leg(`shaman cave leg ${i}`, shamanRoute[i - 1], shamanRoute[i]) ?? NaN;
console.log(`shaman cave: arrival, six shamans, rock, exit = ${shaman} tiles (in listed order, not optimised)`);

console.log('\n# Temple of Ikov');
leg('Ardougne teleport -> Lucien (2573,3321)', ardy, [2573, 3321]);
leg('Lucien -> temple trapdoor (2637,3408)', [2573, 3321], [2637, 3409]);
leg('Varrock teleport (3213,3424) -> Lucien north of Varrock', [3213, 3424], [3176, 3477]);
leg('lit stairs landing (2641,9764) -> boots of lightness', [2641, 9764], [2654, 9767]);
leg('boots -> dark stairs up (2638,9763)', [2654, 9767], [2638, 9763]);
leg('dark stairs exit (2654,9809) -> lever piece (2637,9819)', [2654, 9809], [2637, 9819]);
leg('lever piece -> lever bracket (2671,9804)', [2637, 9819], [2671, 9805]);
leg('lever bracket -> trap lever (2665,9855)', [2671, 9805], [2665, 9856]);
leg('lever bracket -> ice chest (2710,9850)', [2671, 9805], [2710, 9851]);
leg('ice chests: (2710,9850) -> (2747,9848)', [2710, 9851], [2747, 9849]);
leg('ice chests: (2738,9835) -> (2745,9821)', [2738, 9836], [2745, 9822]);
leg('trap lever -> fire warrior door (2646,9870)', [2665, 9856], [2646, 9869]);
leg('fire warrior door -> Winelda (2656,9875)', [2646, 9871], [2656, 9874]);
leg('Winelda teleport landing (2664,9876) -> staff (2638,9906)', [2664, 9876], [2638, 9906]);
