// The Grand Tree's Daconia search (docs/speedrun/quests/grand_tree.md):
// 1. times a search of a root without the rock (click to the game message),
//    standing adjacent and from a few tiles away;
// 2. checks every %daconia_rock_root value 1..15 against its root, because
//    daconia_coords.enum lists the root at (2456,9886) twice (values 0 and 1),
//    so value 1 might never match.
// Run: bun docs/speedrun/scripts/quest-grandtree-roots.ts <botname>

import { runScript } from '../../../sdk/runner';
import { opLoc } from '../../../speedrun/lib/act';
import { converse } from '../../../speedrun/lib/converse';
import { pageText } from '../../../speedrun/lib/dialogue';
import { currentTick, waitTicks, waitUntil } from '../../../speedrun/lib/wait';
import { findLoc, invCount, messagesSince } from '../../../speedrun/lib/world';
import { result, stats } from '../../../speedrun/lab/record';
import { clearInventory, getvar, mustTele, setvar, tele } from '../../../speedrun/lab/setup';

const ROOTS: Record<number, [number, number]> = {
    1: [2456, 9886], 2: [2457, 9881], 3: [2455, 9874], 4: [2443, 9878], 5: [2439, 9881],
    6: [2444, 9893], 7: [2452, 9893], 8: [2465, 9891], 9: [2468, 9890], 10: [2467, 9896],
    11: [2473, 9897], 12: [2481, 9904], 13: [2485, 9885], 14: [2490, 9889], 15: [2467, 9872],
};

await runScript(async ({ sdk }) => {
    await clearInventory(sdk);
    await setvar(sdk, 'grandtree', 150);

    // Search a root by clicking it; ticks until its message (empty) or the rock's objbox page (found).
    const search = async (x: number, z: number): Promise<{ ticks: number; found: boolean }> => {
        const loc = await findLoc(sdk, { x, z, name: /root/i, op: /search/i });
        if (!loc) throw new Error(`no root at (${x},${z})`);
        const t0 = currentTick(sdk);
        await opLoc(sdk, loc, /search/i);
        const r = await waitUntil(sdk, s => messagesSince(s, t0 + 1, /root|interesting|nothing/i).length > 0 || (s.dialog.isOpen && /Daconia/i.test(pageText(s.dialog))), { maxTicks: 30 });
        const found = r.ok && r.state.dialog.isOpen;
        if (found) await converse(sdk, [], { idle: 2, closeModals: true });
        return { ticks: (r.ok ? r.tick : NaN) - t0, found };
    };

    // 1. Empty-root timing: value 15 is far from roots 10 and 8.
    await setvar(sdk, 'daconia_rock_root', 15);
    const adjacent: number[] = [];
    for (let i = 0; i < 5; i++) {
        await mustTele(sdk, 2466, 9896);
        await waitTicks(sdk, 2);
        adjacent.push((await search(2467, 9896)).ticks);
    }
    const fromFour: number[] = [];
    for (let i = 0; i < 3; i++) {
        await mustTele(sdk, 2463, 9896);
        await waitTicks(sdk, 2);
        fromFour.push((await search(2467, 9896)).ticks);
    }
    result('grandtree_root_search_empty', { adjacent: stats(adjacent), adjacentRaw: adjacent, fromFourTiles: stats(fromFour), fromFourRaw: fromFour });

    if (process.env.ROOTS_EMPTY_ONLY) return;
    // 2. Each value against its own root.
    const matches: Record<number, { found: boolean; ticks: number }> = {};
    for (const [v, [x, z]] of Object.entries(ROOTS).map(([k, xz]) => [Number(k), xz] as const)) {
        await clearInventory(sdk);
        await setvar(sdk, 'daconia_rock_root', v);
        // Stand on a walkable tile next to the root: try the four sides.
        let ok = false;
        for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
            if (await tele(sdk, x + dx, z + dz)) { ok = true; break; }
        }
        if (!ok) { matches[v] = { found: false, ticks: NaN }; continue; }
        await waitTicks(sdk, 2);
        const r = await search(x, z);
        const m = { found: invCount(sdk, /daconia/i) > 0 || r.found, ticks: r.ticks };
        matches[v] = m;
        console.log(`value ${v} root (${x},${z}): found=${m.found} ticks=${r.ticks}`);
    }
    result('grandtree_root_values', matches);
    console.log('daconia_rock_root now', await getvar(sdk, 'daconia_rock_root'));
}, { timeout: 600_000 });
