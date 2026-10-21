// Scratch exploration for the Sea Slug platform: which broken glass is reachable,
// and what the door at (2765,3277) says. Prints dialogue text and messages.
// Run: bash docs/speedrun/scripts/quest-smallskill-lab.sh <bot> docs/speedrun/scripts/quest-smallskill-explore.ts

import { runScript } from '../../../sdk/runner';
import { dialogText, locId, now, pathTiles, pickup, pos, setvar, tele, waitTicks, walkTo } from './quest-smallskill-lib';

await runScript(async ({ bot, sdk }) => {
    await setvar(sdk, 'seaslugquest', 3);
    await tele(sdk, 2782, 3273, 0);
    for (const [x, z] of [[2765, 3278], [2765, 3289], [2784, 3289]]) console.log('path to', x, z, JSON.stringify(pathTiles(0, 2782, 3273, x, z)));
    const t0 = now(sdk);
    const unsub = sdk.onStateUpdate(s => { if (s.dialog.isOpen) console.log('DIALOG', s.tick - t0, dialogText(s).slice(0, 160)); });
    const r = await locId(sdk, 2765, 3277, 1533, 1, () => false, { label: 'door', maxTicks: 25 });
    console.log(JSON.stringify(r.run.log), pos(sdk.getState()));
    console.log('MSGS', sdk.getState()!.gameMessages.slice(-5).map(m => m.text).join(' | '));
    const g2 = await walkTo(bot, sdk, 2765, 3289, 0);
    console.log('walk to glass 2', JSON.stringify(g2), pos(sdk.getState()));
    console.log(JSON.stringify(await pickup(sdk, /^broken glass$/i)));
    console.log('INV', sdk.getState()!.inventory.map(i => i.name).join(','));
    console.log('MSGS', sdk.getState()!.gameMessages.slice(-5).map(m => m.text).join(' | '));
    unsub();
    await waitTicks(sdk, 1);
}, { timeout: 200_000 });
