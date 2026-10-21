// Scratch exploration for the Sea Slug platform: from which tiles does the glass
// room door at (2765,3277) open? Tries Open from every tile around it and
// reports whether the player could then step through.
// Run: bash docs/speedrun/scripts/quest-smallskill-lab.sh <bot> docs/speedrun/scripts/quest-smallskill-explore.ts

import { runScript } from '../../../sdk/runner';
import { now, pos, setvar, tele, waitTicks } from './quest-smallskill-lib';

await runScript(async ({ sdk }) => {
    await setvar(sdk, 'seaslugquest', 3);
    const P = () => JSON.stringify(pos(sdk.getState()));
    for (const [x, z] of [[2765, 3277], [2766, 3277], [2764, 3277], [2765, 3276], [2765, 3278], [2766, 3278]]) {
        if (!(await tele(sdk, x, z, 0))) { console.log('cannot stand on', x, z); continue; }
        const t0 = now(sdk);
        const r = await sdk.sendInteractLoc(2765, 3277, 1533, 1);
        await waitTicks(sdk, 4);
        const msgs = sdk.getState()!.gameMessages.filter(m => m.tick >= t0).map(m => m.text).join(' | ');
        // Try to step across the door line.
        const across = x >= 2766 ? [2765, 3277] : [2766, 3277];
        await sdk.sendWalk(across[0]!, across[1]!);
        await waitTicks(sdk, 4);
        console.log('from', x, z, 'op:', r.message, '| msgs:', msgs || '-', '| after step to', across.join(','), '->', P());
    }
}, { timeout: 200_000 });
