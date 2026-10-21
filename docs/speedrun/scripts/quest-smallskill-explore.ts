// Scratch exploration for the Sea Slug platform: is the glass room door at
// (2765,3277) usable from inside, and can a staff-teleported player take the
// glass and leave? Prints messages after each action.
// Run: bash docs/speedrun/scripts/quest-smallskill-lab.sh <bot> docs/speedrun/scripts/quest-smallskill-explore.ts

import { runScript } from '../../../sdk/runner';
import { now, pos, setvar, tele, waitTicks } from './quest-smallskill-lib';

await runScript(async ({ sdk }) => {
    await setvar(sdk, 'seaslugquest', 3);
    const t0 = now(sdk);
    const P = () => JSON.stringify(pos(sdk.getState()));
    const msgs = () => sdk.getState()!.gameMessages.filter(m => m.tick >= t0).map(m => `${m.tick - t0}:${m.text}`).join(' | ');
    // Outside: search the crate on the far side of the wall, and the door, both from (2766,3277).
    await tele(sdk, 2766, 3277, 0);
    await sdk.sendInteractLoc(2765, 3275, 366, 1); await waitTicks(sdk, 5);
    console.log('outside crate', P(), msgs());
    await sdk.sendInteractLoc(2765, 3277, 1533, 1); await waitTicks(sdk, 4);
    console.log('outside door', P(), msgs());
    // Inside.
    await tele(sdk, 2764, 3277, 0);
    console.log('inside at', P());
    const g = (await sdk.scanGroundItems(10)).find(i => /broken glass/i.test(i.name));
    console.log('glass seen', JSON.stringify(g));
    if (g) { await sdk.sendPickup(g.x, g.z, g.id); await waitTicks(sdk, 5); }
    console.log('inv', sdk.getState()!.inventory.map(i => i.name).join(','), msgs());
    await sdk.sendInteractLoc(2765, 3277, 1533, 1); await waitTicks(sdk, 4);
    console.log('inside door', P(), msgs());
    await sdk.sendWalk(2767, 3277); await waitTicks(sdk, 5);
    console.log('walk out', P(), msgs());
}, { timeout: 200_000 });
