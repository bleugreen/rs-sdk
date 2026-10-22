// Monkey Madness walk legs on the lab engine: can the SDK pathfinder
// (bot.walkTo) walk each Ape Atoll leg, and what does it cost? Each leg starts
// from a staff teleport. The bot wears the Karamjan gree-gree on the atoll so
// guards and archers leave it alone: this probes the paths, not the jail risk.
//
//   speedrun/lab/lab.sh <bot> speedrun/lab/measure-mm-routes.ts[:--only=dungeon]

import { openSession } from '../lib/session';
import { waitTicks, waitUntil } from '../lib/wait';
import { arg, botArg, result } from './common';
import { ROUTE_LEVELS } from './quests/monkey-madness';
import { cheat, give, setstat, tele } from './setup';

const session = await openSession(botArg());
const { sdk, bot } = session;
const only = arg('only', '');

/**
 * `via` hops are walked first: 'p' = bot.walkTo (the SDK pathfinder), 'c' = one
 * walk click (the client's own router, short range), 'l' = op1 on the ladder at
 * that tile on the current level, done when the level changes.
 */
interface Leg { name: string; from: [number, number, number]; to: [number, number]; tol?: number; monkey?: boolean; via?: Array<[number, number, 'p' | 'c' | 'l']>; routeLevels?: true }

/** The western warehouse is closed on the ground (its door is locked): out over the roofs and the temple's first floor. */
const ROOFS: Array<[number, number, 'p' | 'c' | 'l']> = [[2752, 2767, 'l'], [2748, 2768, 'l'], [2786, 2793, 'p'], [2787, 2795, 'l'], [2794, 2774, 'p'], [2794, 2773, 'l']];
const LEGS: Leg[] = [
    { name: 'landing->dungeon-ladder', from: [2801, 2707, 0], to: [2763, 2704] },
    { name: 'dungeon-ladder->zooknock', from: [2763, 9103, 0], to: [2804, 9145], tol: 2 },
    { name: 'zooknock->dungeon-ladder', from: [2804, 9145, 0], to: [2763, 9104] },
    { name: 'cell-exit->garkor', from: [2771, 2796, 0], to: [2805, 2762], tol: 1 },
    { name: 'garkor->denture-crate-east', from: [2805, 2762, 0], to: [2768, 2769] },
    { name: 'cellar-landing->mould-crate', from: [2801, 9169, 0], to: [2782, 9171] },
    { name: 'mould-crate->west-rope', from: [2782, 9171, 0], to: [2764, 9166] },
    { name: 'west-rope-top->bridge-ladder', from: [2749, 2768, 0], to: [2803, 2735] },
    { name: 'cell-exit->temple-ladder', from: [2771, 2796, 0], to: [2794, 2774] },
    { name: 'temple-floor1', from: [2794, 2773, 1], to: [2806, 2785] },
    { name: 'temple-top->child', from: [2807, 2786, 0], to: [2743, 2797], tol: 1 },
    { name: 'child->bridge-ladder', from: [2743, 2797, 0], to: [2803, 2735] },
    { name: 'garkor->elder-guard', from: [2805, 2762, 0], to: [2801, 2755], tol: 1 },
    { name: 'west-gate-outside->garkor', from: [2716, 2766, 0], to: [2805, 2762], tol: 1 },
    { name: 'zoo->grand-tree', from: [2614, 3273, 0], to: [2465, 3496], tol: 2, monkey: false },
    // Candidate detours for the legs above that fail.
    { name: 'garkor->denture-crate-east/via-cell', from: [2805, 2762, 0], via: [[2771, 2796, 'p']], to: [2768, 2769] },
    { name: 'garkor->denture-crate-east/via-2790', from: [2805, 2762, 0], via: [[2795, 2772, 'c'], [2780, 2770, 'c']], to: [2768, 2769] },
    { name: 'west-gate-outside->garkor/via-cell', from: [2716, 2766, 0], via: [[2771, 2796, 'p']], to: [2805, 2762], tol: 1 },
    { name: 'west-rope-top->bridge-ladder/via-cell', from: [2749, 2768, 0], via: [[2771, 2796, 'p']], to: [2803, 2735] },
    { name: 'west-rope-top->bridge-ladder/via-child', from: [2749, 2768, 0], via: [[2743, 2797, 'p']], to: [2803, 2735] },
    { name: 'temple-top->child/click-out', from: [2807, 2786, 0], via: [[2800, 2790, 'c'], [2790, 2795, 'c']], to: [2743, 2797], tol: 1 },
    { name: 'temple-top->child/via-cell', from: [2807, 2786, 0], via: [[2771, 2796, 'p']], to: [2743, 2797], tol: 1 },
    { name: 'west-rope-top->bridge-ladder/doorway', from: [2749, 2768, 0], via: [[2753, 2771, 'c'], [2753, 2774, 'c']], to: [2803, 2735] },
    ...[0, 1, 2, 3, 4].map(i => ({ name: `east-rope->bridge-ladder/human-${i}`, from: [2797, 9169, 0] as [number, number, number], via: [[2798, 9169, 'l']] as Array<[number, number, 'l']>, to: [2803, 2735] as [number, number], monkey: false, routeLevels: true as const })),
    { name: 'west-rope-top->bridge-ladder/roofs', from: [2749, 2768, 0], via: ROOFS, to: [2803, 2735] },
    { name: 'west-rope-top->bridge-ladder/roofs-human', from: [2749, 2768, 0], via: ROOFS, to: [2803, 2735], monkey: false },
    { name: 'west-rope-top->bridge-ladder/doorway-clicks', from: [2749, 2768, 0], via: [[2753, 2771, 'c'], [2753, 2774, 'c'], [2762, 2784, 'c'], [2771, 2796, 'c']], to: [2803, 2735] },
    { name: 'west-rope-top->bridge-ladder/doorway-east', from: [2749, 2768, 0], via: [[2753, 2771, 'c'], [2753, 2774, 'c'], [2770, 2776, 'c'], [2785, 2770, 'c']], to: [2803, 2735] },
    { name: 'west-rope-top->bridge-ladder/doorway-far', from: [2749, 2768, 0], via: [[2753, 2771, 'c'], [2753, 2774, 'c'], [2771, 2790, 'p']], to: [2803, 2735] },
    { name: 'west-rope-top->bridge-ladder/click-east', from: [2749, 2768, 0], via: [[2756, 2766, 'c'], [2768, 2770, 'c'], [2780, 2770, 'c']], to: [2803, 2735] },
    { name: 'west-rope-top->bridge-ladder/click-north', from: [2749, 2768, 0], via: [[2756, 2766, 'c'], [2760, 2780, 'c'], [2771, 2790, 'c']], to: [2803, 2735] },
    { name: 'west-rope-top->bridge-ladder/click-south', from: [2749, 2768, 0], via: [[2756, 2766, 'c'], [2765, 2755, 'c'], [2780, 2745, 'c']], to: [2803, 2735] },
    { name: 'zoo->grand-tree/via-ardougne-market', from: [2614, 3273, 0], via: [[2662, 3305, 'p']], to: [2465, 3496], tol: 2, monkey: false },
];

async function hop(x: number, z: number, mode: 'p' | 'c' | 'l', tol: number) {
    if (mode === 'p') return (await bot.walkTo(x, z, tol)).message ?? '';
    if (mode === 'l') {
        const level = sdk.getState()!.player!.level;
        const loc = (await sdk.scanNearbyLocs(30)).find(l => l.x === x && l.z === z && /ladder|rope/i.test(l.name));
        if (!loc) return `no ladder at ${x},${z},${level}`;
        const t0 = sdk.getState()!.tick;
        for (let i = 0; i < 3; i++) {
            await sdk.sendInteractLoc(loc.x, loc.z, loc.id, loc.optionsWithIndex[0]?.opIndex ?? 1);
            const z0 = sdk.getState()!.player!.worldZ;
        const r = await waitUntil(sdk, s => s.player!.level !== level || Math.abs(s.player!.worldZ - z0) > 1000, { maxTicks: 25 });
            if (r.ok) return `climbed to ${r.state.player!.worldX},${r.state.player!.worldZ},${r.state.player!.level} in ${r.tick - t0}`;
        }
        return `ladder at ${x},${z} did not move the player`;
    }
    await sdk.sendWalk(x, z, true);
    const r = await waitUntil(sdk, s => Math.max(Math.abs(s.player!.worldX - x), Math.abs(s.player!.worldZ - z)) <= tol, { maxTicks: 40 });
    return r.ok ? 'Arrived (click)' : `click stopped at ${sdk.getState()!.player!.worldX},${sdk.getState()!.player!.worldZ}`;
}

await setstat(sdk, 'hitpoints', 99);
await cheat(sdk, 'setvar mm_main 4');
await waitTicks(sdk, 1);
await give(sdk, ['mm_monkey_greegree_for_normal_monkey']);

for (const leg of LEGS.filter(l => !only || l.name.includes(only))) {
    const [x, z, level] = leg.from;
    if (!(await tele(sdk, x, z, level))) { result('mm_route', { leg: leg.name, error: 'tele failed' }); continue; }
    const onAtoll = x >= 2688 && x < 2816 && ((z >= 2688 && z < 2816) || z >= 9088);
    const gg = sdk.getState()!.inventory.find(i => /greegree/i.test(i.name));
    if (onAtoll && leg.monkey !== false && gg) {
        await sdk.sendUseItem(gg.slot, gg.optionsWithIndex.find(o => /hold|wield|wear/i.test(o.text))?.opIndex ?? 2);
        await waitUntil(sdk, s => s.equipment.some(i => /greegree/i.test(i.name)), { maxTicks: 5 });
    }
    if (leg.routeLevels) {
        for (const [k, v] of Object.entries(ROUTE_LEVELS)) await setstat(sdk, k, v);
        const worn = sdk.getState()!.equipment.find(i => /greegree/i.test(i.name));
        if (worn) await sdk.sendUseEquipmentItem(worn.slot, 1);
    } else await cheat(sdk, 'setstat hitpoints 99');
    const s0 = sdk.getState()!;
    const jail0 = s0.gameMessages.length;
    let knockedOut = -1;
    const ko = sdk.onStateUpdate(s => { const p = s.player; if (knockedOut < 0 && p && p.worldX >= 2770 && p.worldX <= 2776 && p.worldZ >= 2793 && p.worldZ <= 2794 && p.level === 0) knockedOut = s.tick - s0.tick; });
    let tiles = 0, last = { x: s0.player!.worldX, z: s0.player!.worldZ };
    const stop = sdk.onStateUpdate(s => { const p = s.player; if (!p) return; const d = Math.max(Math.abs(p.worldX - last.x), Math.abs(p.worldZ - last.z)); if (d <= 2) tiles += d; last = { x: p.worldX, z: p.worldZ }; });
    const hops: string[] = [];
    for (const [vx, vz, mode] of leg.via ?? []) hops.push(`${vx},${vz}/${mode}: ${await hop(vx, vz, mode, 1)}`);
    const r = await bot.walkTo(leg.to[0], leg.to[1], leg.tol ?? 0);
    stop();
    ko();
    if (knockedOut >= 0) hops.push(`knocked out ${knockedOut} ticks in; messages: ${sdk.getState()!.gameMessages.slice(jail0).map(m => m.text).slice(-4).join(' | ')}`);
    const s1 = sdk.getState()!;
    const at = [s1.player!.worldX, s1.player!.worldZ, s1.player!.level];
    const reached = Math.max(Math.abs(at[0]! - leg.to[0]), Math.abs(at[1]! - leg.to[1])) <= (leg.tol ?? 0) + 1;
    result('mm_route', { leg: leg.name, ok: r.success, reached, ticks: s1.tick - s0.tick, tiles, at, message: r.message, ...(hops.length ? { hops } : {}), hpLost: 99 - (s1.player?.hp ?? 0) });
}
process.exit(0);
