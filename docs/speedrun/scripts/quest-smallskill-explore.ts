// Scratch exploration for the Sea Slug platform: does the server open the glass
// room door at (2765,3277) when the bot clicks it from the pier? Lists every
// loc the client knows on that tile before and after.
// Run: bash docs/speedrun/scripts/quest-smallskill-lab.sh <bot> docs/speedrun/scripts/quest-smallskill-explore.ts

import { runScript } from '../../../sdk/runner';
import { now, pos, setvar, tele, waitTicks } from './quest-smallskill-lib';

await runScript(async ({ sdk }) => {
    await setvar(sdk, 'seaslugquest', 3);
    const show = async (label: string) => {
        const locs = (await sdk.scanNearbyLocs(6)).filter(l => Math.abs(l.x - 2765) <= 1 && Math.abs(l.z - 3277) <= 1);
        console.log(label, locs.map(l => `${l.name}#${l.id}@${l.x},${l.z},L${l.level}[${l.optionsWithIndex.map(o => o.text).join('/')}]`).join('  '));
    };
    await tele(sdk, 2766, 3277, 0);
    await show('before');
    const t0 = now(sdk);
    const r = await sdk.sendInteractLoc(2765, 3277, 1533, 1);
    for (let i = 0; i < 4; i++) { await waitTicks(sdk, 1); await show(`after +${now(sdk) - t0}`); }
    console.log('op result', r.message, 'msgs', sdk.getState()!.gameMessages.filter(m => m.tick >= t0).map(m => m.text).join(' | '), JSON.stringify(pos(sdk.getState())));
}, { timeout: 200_000 });
