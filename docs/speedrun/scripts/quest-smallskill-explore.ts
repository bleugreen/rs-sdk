// Scratch exploration for the Sea Slug platform: with the glass room door at
// (2765,3277) open, can the bot route in, take the broken glass and route out?
// Run: bash docs/speedrun/scripts/quest-smallskill-lab.sh <bot> docs/speedrun/scripts/quest-smallskill-explore.ts

import { runScript } from '../../../sdk/runner';
import { clickWalk, now, pickup, pos, setvar, tele, waitTicks, waitUntil } from './quest-smallskill-lib';

await runScript(async ({ bot, sdk }) => {
    await setvar(sdk, 'seaslugquest', 3);
    const P = () => JSON.stringify(pos(sdk.getState()));
    const open = () => (sdk.getState()!.nearbyLocs ?? []).some(l => l.id === 1534 && Math.abs(l.x - 2765) <= 1 && Math.abs(l.z - 3277) <= 1);
    await tele(sdk, 2770, 3277, 0);
    console.log('door open at start?', open());
    console.log('walk', JSON.stringify(await clickWalk(sdk, 2766, 3277, 0)), P());
    await waitTicks(sdk, 1);
    if (!open()) {
        const t0 = now(sdk);
        const r = await sdk.sendInteractLoc(2765, 3277, 1533, 1);
        const w = await waitUntil(sdk, open, 8);
        console.log('open', r.message, 'ticks', w ? w.tick - t0 : 'never', P());
    }
    const g = (await sdk.scanGroundItems(6)).find(i => /broken glass/i.test(i.name));
    console.log('glass', JSON.stringify(g));
    console.log('pickup', JSON.stringify(await pickup(sdk, /^broken glass$/i, 20)), P(), sdk.getState()!.gameMessages.slice(-3).map(m => m.text).join(' | '));
    console.log('walk out', JSON.stringify(await clickWalk(sdk, 2770, 3280, 0)), P());
}, { timeout: 200_000 });
