// Doric's Quest end to end on the lab server (docs/speedrun/quests/dorics_quest.md).
// Resets %doricquest, gives what one helper trade would carry (6 clay, 4 copper
// ore, 2 iron ore, Falador teleport runes), casts Falador teleport from Lumbridge
// and plays the quest the way the scored account would.
// Run: bash docs/speedrun/scripts/quest-smallskill-lab.sh <bot> docs/speedrun/scripts/quest-smallskill-doric.ts

import { runScript } from '../../../sdk/runner';
import { cheat, clearInv, getvar, give, now, pathTiles, pos, Recorder, setstats, setvar, talk, tele, teleport, waitTicks, waitUntil, walkTo, withRuns } from './quest-smallskill-lib';

const DORIC = { x: 2952, z: 3451 };

await runScript(async ({ bot, sdk }) => {
    const rec = new Recorder('dorics_quest');
    await clearInv(sdk);
    await setvar(sdk, 'doricquest', 0);
    await setstats(sdk, { magic: 99, mining: 1 });
    for (const [o, n] of [['clay', 6], ['copper_ore', 4], ['iron_ore', 2], ['lawrune', 5], ['airrune', 15], ['waterrune', 5]] as const) await give(sdk, o, n);
    await tele(sdk, 3222, 3218);
    await cheat(sdk, '~energy');
    await waitTicks(sdk, 2);
    const xp0 = sdk.getSkill('mining')!.experience;
    const T0 = now(sdk);

    const tp = rec.add(await teleport(sdk, 'falador'), '1a');
    const p1 = pos(sdk.getState());
    const route = pathTiles(0, p1.x, p1.z, DORIC.x, DORIC.z);
    rec.add(await walkTo(bot, sdk, DORIC.x, DORIC.z, 2), `1b walk to Doric (pathfinder ${route.tiles} tiles)`);
    rec.add(withRuns(await talk(sdk, /^Doric$/i, [/use your anvils/, /Yes, I will get you materials/], { idle: 3 })), '2 Doric start');
    console.log('doricquest', await getvar(sdk, 'doricquest'));
    rec.add(withRuns(await talk(sdk, /^Doric$/i, [], { idle: 3 })), '3 Doric hand-in');
    await waitUntil(sdk, s => (s.skills.find(k => k.name.toLowerCase() === 'mining')?.experience ?? 0) > xp0, 20);
    const gained = sdk.getSkill('mining')!.experience - xp0;
    console.log('doricquest', await getvar(sdk, 'doricquest'), 'mining xp gained', gained, '=', gained / 25, 'base; teleport', tp.ticks);
    console.log('wall ticks start->finish', now(sdk) - T0);
    rec.summary();
}, { timeout: 300_000 });
