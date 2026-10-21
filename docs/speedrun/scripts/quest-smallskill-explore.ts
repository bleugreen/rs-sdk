// Scratch exploration for the Sea Slug platform: opening the glass room door at
// (2765,3277) and taking the broken glass. Prints messages after each action.
// Run: bash docs/speedrun/scripts/quest-smallskill-lab.sh <bot> docs/speedrun/scripts/quest-smallskill-explore.ts

import { runScript } from '../../../sdk/runner';
import { now, pos, setvar, tele, waitTicks } from './quest-smallskill-lib';

await runScript(async ({ sdk }) => {
    await setvar(sdk, 'seaslugquest', 3);
    await tele(sdk, 2766, 3277, 0);
    const t0 = now(sdk);
    const msgs = () => sdk.getState()!.gameMessages.filter(m => m.tick >= t0).map(m => `${m.tick - t0}:${m.text}`).join(' | ');
    for (const op of [1, 2]) {
        const r = await sdk.sendInteractLoc(2765, 3277, 1533, op);
        await waitTicks(sdk, 4);
        console.log('door op', op, JSON.stringify(r), pos(sdk.getState()), 'MSGS', msgs());
    }
    const g = (await sdk.scanGroundItems(10)).find(i => /broken glass/i.test(i.name));
    console.log('glass', JSON.stringify(g));
    if (g) {
        const r = await sdk.sendPickup(g.x, g.z, g.id);
        await waitTicks(sdk, 6);
        console.log('pickup', JSON.stringify(r), pos(sdk.getState()), 'INV', sdk.getState()!.inventory.map(i => i.name).join(','), 'MSGS', msgs());
    }
    // Walk-in test: click the glass tile itself.
    await sdk.sendWalk(2765, 3278);
    await waitTicks(sdk, 5);
    console.log('after walk click', pos(sdk.getState()), 'MSGS', msgs());
}, { timeout: 200_000 });
