// Sea Slug end to end on the lab server (docs/speedrun/quests/sea_slug.md).
// Resets %seaslugquest, gives what one helper trade would carry (swamp paste,
// an unlit torch, Ardougne teleport runes), sets Plague City complete for the
// Ardougne teleport and Firemaking 99 (so the stick rub cannot fail; at 30 it
// succeeds 77% of the time), casts Ardougne teleport from Lumbridge and plays
// the quest. Bailey is skipped: his only job is to hand out the torch.
// Run: bash docs/speedrun/scripts/quest-smallskill-lab.sh <bot> docs/speedrun/scripts/quest-smallskill-seaslug.ts

import { runScript } from '../../../sdk/runner';
import type { BotSDK } from '../../../sdk/index';
import { cheat, clearInv, clickWalk, getvar, give, invCount, invOp, locId, msgSince, now, pickup, pos, Recorder, setstats, setvar, talk, tele, teleport, useOnItem, waitTicks, waitUntil, walkTo, withRuns } from './quest-smallskill-lib';

// Loc ids and tiles from server/content/maps/m43_51.jm2 (quest-smallskill-locate.ts).
// The platform's ground floor is server level 0, its upper floor level 1.
const LADDER_UP = { x: 2784, z: 3286, id: 2517 };   // slugladder
const LADDER_DOWN = { x: 2784, z: 3286, id: 1746 }; // laddertop
const KWALL = { x: 2764, z: 3287, id: 2519 };       // kennithwall
const PANEL = { x: 2765, z: 3288, id: 2518 };       // loosepanel
const CRANE = { x: 2768, z: 3286, id: 2520 };       // fishingcrane, used from z >= 3289 (quest_seaslug.rs2:97)

const stage = (sdk: BotSDK) => getvar(sdk, 'seaslugquest');

/**
 * Get to (tx, tz) through the door at (dx, dz), which the client cannot see on a
 * bridged floor. Walks to the outside tile, tries the target, and only clicks
 * the door if that fails (a click on an open door would close it). One record
 * covers the whole crossing.
 */
async function viaDoor(sdk: BotSDK, out: [number, number], door: [number, number, number], target: [number, number]) {
    const t0 = now(sdk);
    const a = await clickWalk(sdk, out[0], out[1], 0, 40);
    let b = await clickWalk(sdk, target[0], target[1], 0, 6);
    let opened = false;
    if (!Number.isFinite(b.ticks)) {
        opened = true;
        await sdk.sendInteractLoc(door[0], door[1], door[2], 1);
        await waitTicks(sdk, 2);
        b = await clickWalk(sdk, target[0], target[1], 0, 12);
    }
    const ok = Number.isFinite(b.ticks);
    return { name: `via door (${door[0]},${door[1]}) to (${target[0]},${target[1]})${opened ? ' (opened it)' : ' (already open)'}`, ticks: ok ? now(sdk) - t0 : NaN, note: `${a.tiles + b.tiles} tiles${ok ? '' : ' FAILED at ' + JSON.stringify(pos(sdk.getState()))}` };
}
const KDOOR: [number, number, number] = [2764, 3285, 1530]; // loc_1530, the room in front of Kennith's wall
const GDOOR: [number, number, number] = [2765, 3277, 1533]; // loc_1533, the room with the broken glass

await runScript(async ({ bot, sdk }) => {
    const rec = new Recorder('sea_slug');
    await clearInv(sdk);
    await setvar(sdk, 'seaslugquest', 0);
    await setvar(sdk, 'elenaquest', 30);
    await setstats(sdk, { magic: 99, firemaking: 99, fishing: 1, hitpoints: 60 });
    for (const [o, n] of [['swamppaste', 1], ['torch_unlit', 1], ['lawrune', 4], ['waterrune', 4]] as const) await give(sdk, o, n);
    await tele(sdk, 3222, 3218);
    await waitTicks(sdk, 6); // a teleport cast straight after ::setstat magic is dropped
    await cheat(sdk, '~energy');
    await waitTicks(sdk, 2);
    const xp0 = sdk.getSkill('fishing')!.experience;
    const T0 = now(sdk);
    const lvl = (l: number) => (s: Parameters<Parameters<typeof waitUntil>[1]>[0]) => pos(s).level === l;

    // Witchaven: Caroline, then Holgart twice (the second talk sails).
    rec.add(await teleport(sdk, 'ardougne'), '1a');
    rec.add(await walkTo(bot, sdk, 2717, 3303, 1), '1b walk to Caroline');
    rec.add(withRuns(await talk(sdk, /^Caroline$/i, [/how do I get there/])), '2 Caroline start');
    console.log('stage', await stage(sdk));
    rec.add(withRuns(await talk(sdk, /^Holgart$/i, [])), '3 Holgart, ask for the boat');
    console.log('stage', await stage(sdk));
    rec.add(withRuns(await talk(sdk, /^Holgart$/i, [/lets do it/i], { idle: 6, done: s => pos(s).x > 2760 && !s.dialog.isOpen })), '4 Holgart, paste and sail');
    console.log('stage', await stage(sdk), pos(sdk.getState()));

    // Platform, first visit: glass and damp sticks, dry them, then Kennith upstairs.
    // The glass is in the west room behind the door at (2765,3277); open it from the pier tile beside it.
    rec.add(await viaDoor(sdk, [2766, 3277], GDOOR, [2765, 3278]), '5a-b into the glass room');
    rec.add(await pickup(sdk, /^broken glass$/i), '5c');
    rec.add(await clickWalk(sdk, 2784, 3289, 0), '5d walk to damp sticks');
    rec.add(await pickup(sdk, /^damp sticks$/i), '5e');
    rec.add(await useOnItem(sdk, /^broken glass$/i, /^damp sticks$/i, s => invCount(s, /^dry sticks$/i) > 0), '5f dry the sticks');
    rec.add(await locId(sdk, LADDER_UP.x, LADDER_UP.z, LADDER_UP.id, 1, lvl(1), { label: 'climb up' }), '6a');
    rec.add(await viaDoor(sdk, [2765, 3285], KDOOR, [KWALL.x, KWALL.z - 1]), 'into the room by Kennith\'s wall 1');
    rec.add(withRuns(await locId(sdk, KWALL.x, KWALL.z, KWALL.id, 1, () => false, { label: 'Kennith through the wall', maxTicks: 40 })), '6b Kennith 1');
    console.log('stage', await stage(sdk), pos(sdk.getState()));
    rec.add(await clickWalk(sdk, LADDER_DOWN.x, LADDER_DOWN.z - 1, 1), 'walk to the ladder');
    rec.add(await locId(sdk, LADDER_DOWN.x, LADDER_DOWN.z, LADDER_DOWN.id, 1, lvl(0), { label: 'climb down' }), '6c');

    // Holgart takes you to Kent's island.
    rec.add(withRuns(await talk(sdk, /^Holgart$/i, [], { idle: 6, done: s => pos(s).z > 3310 && !s.dialog.isOpen })), '7 Holgart on the platform, sail to the island');
    console.log('stage', await stage(sdk), pos(sdk.getState()));
    rec.add(withRuns(await talk(sdk, /^Kent$/i, [], { idle: 6 })), '8 Kent');
    console.log('stage', await stage(sdk));
    rec.add(withRuns(await talk(sdk, /^Holgart$/i, [], { idle: 6, done: s => pos(s).z < 3300 && !s.dialog.isOpen })), '9 Holgart on the island, back to the platform');
    console.log('stage', await stage(sdk), pos(sdk.getState()));

    // Light the torch, then Kennith, the panel, Kennith again and the crane.
    rec.add(await invOp(sdk, /^dry sticks$/i, /rub/i, s => invCount(s, /^lit torch$|^torch$/i) > 0 && invCount(s, /unlit torch/i) === 0), '10 rub the sticks');
    console.log('stage', await stage(sdk), sdk.getState()!.inventory.map(i => i.name));
    rec.add(await locId(sdk, LADDER_UP.x, LADDER_UP.z, LADDER_UP.id, 1, lvl(1), { label: 'climb up with the torch' }), '11a');
    rec.add(await viaDoor(sdk, [2765, 3285], KDOOR, [KWALL.x, KWALL.z - 1]), 'into the room by Kennith\'s wall 2');
    rec.add(withRuns(await locId(sdk, KWALL.x, KWALL.z, KWALL.id, 1, () => false, { label: 'Kennith through the wall', maxTicks: 40 })), '11b Kennith 2');
    console.log('stage', await stage(sdk));
    const s9 = async () => (await stage(sdk)) === 9;
    rec.add(await clickWalk(sdk, PANEL.x + 1, PANEL.z, 0), 'walk to the panel');
    rec.add(await locId(sdk, PANEL.x, PANEL.z, PANEL.id, 1, msgSince(/opening big enough/i, now(sdk)), { label: 'kick the loose panel', maxTicks: 20, idle: 1 }), '12 kick panel');
    console.log('stage', await stage(sdk), 'panel done', await s9());
    rec.add(await viaDoor(sdk, [2765, 3285], KDOOR, [KWALL.x, KWALL.z - 1]), 'into the room by Kennith\'s wall 3');
    rec.add(withRuns(await locId(sdk, KWALL.x, KWALL.z, KWALL.id, 1, () => false, { label: 'Kennith through the wall', maxTicks: 40 })), '13 Kennith 3');
    console.log('stage', await stage(sdk));
    rec.add(await clickWalk(sdk, CRANE.x, CRANE.z + 4, 0), '14a stand north of the crane'); // its footprint blocks z 3286-3289
    rec.add(await locId(sdk, CRANE.x, CRANE.z, CRANE.id, 1, msgSince(/row boat waiting below/i, now(sdk)), { label: 'crane', maxTicks: 20, idle: 1 }), '14b crane');
    console.log('stage', await stage(sdk));
    rec.add(await clickWalk(sdk, LADDER_DOWN.x, LADDER_DOWN.z - 1, 1), 'walk to the ladder');
    rec.add(await locId(sdk, LADDER_DOWN.x, LADDER_DOWN.z, LADDER_DOWN.id, 1, lvl(0), { label: 'climb down' }), '15a');
    rec.add(withRuns(await talk(sdk, /^Holgart$/i, [], { idle: 6, done: s => pos(s).x < 2760 && !s.dialog.isOpen })), '15b Holgart, back to shore');
    console.log('stage', await stage(sdk), pos(sdk.getState()));
    rec.add(await walkTo(bot, sdk, 2717, 3303, 1), '16a walk to Caroline');
    rec.add(withRuns(await talk(sdk, /^Caroline$/i, [])), '16b Caroline, reward');
    await waitUntil(sdk, s => (s.skills.find(k => k.name.toLowerCase() === 'fishing')?.experience ?? 0) > xp0, 20);
    const gained = sdk.getSkill('fishing')!.experience - xp0;
    console.log('stage', await stage(sdk), 'fishing xp gained', gained, '=', gained / 25, 'base');
    console.log('wall ticks start->finish', now(sdk) - T0);
    rec.summary();
}, { timeout: 900_000 });
