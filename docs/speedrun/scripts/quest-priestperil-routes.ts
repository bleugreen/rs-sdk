// Priest in Peril: route lengths (offline, SDK pathfinder over the bundled
// collision data) and a lab check of the deterministic iron-key monument.
//
//   bun docs/speedrun/scripts/quest-priestperil-routes.ts            # routes only, no server
//   bun docs/speedrun/scripts/quest-priestperil-routes.ts <botname>  # also the monument check
//
// Route lengths are Chebyshev tiles along the pathfinder's waypoints; at the
// measured 0.5 ticks per run tile (docs/speedrun/quests/primitives.md) a
// leg costs tiles / 2 ticks. Doors are masked by the SDK collision, so door
// and gate interactions are counted separately in priest_in_peril.md.
//
// Monument check: monuments.rs2 randomises the layout seed only when a
// monument is *studied*. Never studying keeps seed 0, so the iron key sits
// in priestperil_grave_base3 ((17*3) mod 7 + 1 = 3 = pipkey_iron in
// monument_graves_models), the monument at (3428,9890).

import { findLongPath } from '../../../sdk/pathfinding';

type P = [number, number];
const legs: [string, number, P, P][] = [
    ['Varrock teleport landing -> King Roald', 0, [3213, 3424], [3222, 3475]],
    ['King Roald -> temple doors (west side)', 0, [3222, 3475], [3407, 3488]],
    ['temple doors -> mausoleum trapdoor', 0, [3407, 3488], [3405, 3506]],
    ['mausoleum ladder foot -> temple guardian', 0, [3405, 9906], [3405, 9903]],
    ['mausoleum trapdoor -> King Roald (walking)', 0, [3405, 3506], [3222, 3475]],
    ['temple doors -> inside -> staircase', 0, [3407, 3488], [3416, 3484]],
    ['level 1 stair landing -> ladder', 1, [3416, 3485], [3410, 3486]],
    ['level 2 ladder -> cell door', 2, [3410, 3486], [3414, 3489]],
    ['cell door -> coffin', 2, [3414, 3489], [3413, 3487]],
    ['temple staircase -> doors -> mausoleum trapdoor', 0, [3416, 3484], [3405, 3506]],
    ['ladder foot -> gate 1 -> monument 3 (3428,9890)', 0, [3405, 9906], [3427, 9890]],
    ['monument 3 -> well', 0, [3427, 9890], [3424, 9890]],
    ['well -> ladder foot', 0, [3424, 9890], [3405, 9906]],
    ['ladder foot -> gate 2 -> Drezel (3440,9895)', 0, [3405, 9906], [3439, 9895]],
    ['Drezel -> holy barrier', 0, [3439, 9895], [3440, 9887]],
    ['barrier exit (3423,3485) -> Haunted Mine zealot (3444,3256)', 0, [3423, 3485], [3444, 3257]]
];

for (const [name, level, a, b] of legs) {
    const w = findLongPath(level, a[0], a[1], b[0], b[1], 2000);
    let n = 0;
    let [px, pz] = a;
    for (const p of w) {
        n += Math.max(Math.abs(p.x - px), Math.abs(p.z - pz));
        px = p.x;
        pz = p.z;
    }
    console.log(`${name}: ${n} tiles, ~${Math.ceil(n / 2)} ticks running`);
}

if (process.argv[2]) {
    const { runScript } = await import('../../../sdk/runner');
    const { cheat, getvar, tele, ticks } = await import('./quest-pip-hm-lib');
    await runScript(async ({ sdk }) => {
        await cheat(sdk, '~clearinv inv');
        await cheat(sdk, 'setvar priestperilvar 0'); // never studied: seed 0
        await cheat(sdk, 'setvar priestperil 5');
        await cheat(sdk, 'give pipkey_gold 1');
        await tele(sdk, 3426, 9890, 0);
        const m = (await sdk.scanNearbyLocs(5)).find(l => l.id === 3495)!; // priestperil_grave_base3
        const t0 = sdk.getState()!.tick;
        await sdk.sendUseItemOnLoc(sdk.findInventoryItem(/golden key/i)!.slot, m.x, m.z, m.id);
        await ticks(sdk, 5);
        console.log(`monument 3: ${sdk.getInventory().map(i => i.name).join(',')} | ${sdk.getState()!.gameMessages.slice(-1).map(x => x.text)} | ${sdk.getState()!.tick - t0} ticks | priestperilvar ${await getvar(sdk, 'priestperilvar')}`);
    }, { timeout: 60_000 });
}
