// The Grand Tree's Daconia search (docs/speedrun/quests/grand_tree.md):
// 1. times a search of a root without the rock (click to the game message),
//    standing adjacent and from a few tiles away;
// 2. checks every %daconia_rock_root value 1..15 against its root, because
//    daconia_coords.enum lists the root at (2456,9886) twice (values 0 and 1),
//    so value 1 might never match.
// Run: bun docs/speedrun/scripts/quest-grandtree-roots.ts <botname>

import { runScript } from '../../../sdk/runner';
import { cheat, dialogue, getvar, give, invCount, now, result, setvar, stats, tele, waitTicks, waitUntil } from './quest-gnome-lib';

const ROOTS: Record<number, [number, number]> = {
    1: [2456, 9886], 2: [2457, 9881], 3: [2455, 9874], 4: [2443, 9878], 5: [2439, 9881],
    6: [2444, 9893], 7: [2452, 9893], 8: [2465, 9891], 9: [2468, 9890], 10: [2467, 9896],
    11: [2473, 9897], 12: [2481, 9904], 13: [2485, 9885], 14: [2490, 9889], 15: [2467, 9872],
};

await runScript(async ({ sdk }) => {
    await cheat(sdk, '~clearinv');
    await setvar(sdk, 'grandtree', 150);

    // Search a root by clicking it; ticks until its message (empty) or the rock's objbox page (found).
    const search = async (x: number, z: number): Promise<{ ticks: number; found: boolean }> => {
        const loc = (await sdk.scanNearbyLocs(20)).find(l => l.x === x && l.z === z && /root/i.test(l.name))!;
        const op = loc.optionsWithIndex.find(o => /search/i.test(o.text))!;
        const t0 = now(sdk);
        await sdk.sendInteractLoc(x, z, loc.id, op.opIndex);
        const r = await waitUntil(sdk, s => s.gameMessages.some(m => m.tick > t0 && /root|interesting|nothing/i.test(m.text)) || (s.dialog.isOpen && /Daconia/i.test(JSON.stringify(s.dialog.allComponents ?? []))), 30);
        const found = !!r && r.state.dialog.isOpen;
        if (found) {
            await dialogue(sdk, [], { idle: 2 });
        }
        return { ticks: (r?.tick ?? NaN) - t0, found };
    };

    // 1. Empty-root timing: value 15 is far from roots 10 and 8.
    await setvar(sdk, 'daconia_rock_root', 15);
    const adjacent: number[] = [];
    for (let i = 0; i < 5; i++) {
        await tele(sdk, 2466, 9896);
        await waitTicks(sdk, 2);
        adjacent.push((await search(2467, 9896)).ticks);
    }
    const fromFour: number[] = [];
    for (let i = 0; i < 3; i++) {
        await tele(sdk, 2463, 9896);
        await waitTicks(sdk, 2);
        fromFour.push((await search(2467, 9896)).ticks);
    }
    result('grandtree_root_search_empty', { adjacent: stats(adjacent), adjacentRaw: adjacent, fromFourTiles: stats(fromFour), fromFourRaw: fromFour });

    if (process.env.ROOTS_EMPTY_ONLY) return;
    // 2. Each value against its own root.
    const matches: Record<number, { found: boolean; ticks: number }> = {};
    for (const v of Object.keys(ROOTS).map(Number)) {
        await cheat(sdk, '~clearinv');
        await setvar(sdk, 'daconia_rock_root', v);
        const [x, z] = ROOTS[v];
        // Stand on a walkable tile next to the root: try the four sides.
        let ok = false;
        for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            if (await tele(sdk, x + dx, z + dz)) { ok = true; break; }
        }
        if (!ok) { matches[v] = { found: false, ticks: NaN }; continue; }
        await waitTicks(sdk, 2);
        const r = await search(x, z);
        matches[v] = { found: invCount(sdk.getState(), /daconia/i) > 0 || r.found, ticks: r.ticks };
        console.log(`value ${v} root (${x},${z}): found=${matches[v].found} ticks=${r.ticks}`);
    }
    result('grandtree_root_values', matches);
    console.log('daconia_rock_root now', await getvar(sdk, 'daconia_rock_root'));
    void give;
}, { timeout: 600_000 });
