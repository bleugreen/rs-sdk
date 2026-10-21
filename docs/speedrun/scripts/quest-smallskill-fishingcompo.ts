// Fishing Contest end to end on the lab server (docs/speedrun/quests/fishing_contest.md).
//
// Default route (helper carp): a helper who has entered the contest catches a
// raw giant carp and leaves (the carp is tradeable, skill_fishing/configs/
// fishing.obj; the hand-in only checks inv_total, bonzo.rs2:58). The scored
// account then needs the pass from the dwarf, one fish of any kind inside the
// contest (any catch moves %hemenster_comp_stage past paidfee), and Bonzo.
// VARIANT=self instead digs a red vine worm in McGrubor's Wood, stashes garlic
// in the pipe and catches the carp itself at the pipe spot.
//
// Gives one helper trade's worth (fishing rod, bait, 5 coins, Camelot runes; for
// the default route a raw giant carp; for VARIANT=self a spade and garlic).
// Run: [VARIANT=self] bash docs/speedrun/scripts/quest-smallskill-lab.sh <bot> docs/speedrun/scripts/quest-smallskill-fishingcompo.ts

import { runScript } from '../../../sdk/runner';
import type { BotSDK } from '../../../sdk/index';
import { clearInv, cheat, dialogue, getvar, give, invCount, locId, now, pos, Recorder, setstats, setvar, talk, tele, teleport, useOnLoc, waitTicks, waitUntil, walkTo, withRuns } from './quest-smallskill-lib';

const SELF = process.env.VARIANT === 'self';
const STAIRS = { x: 2820, z: 3484, id: 55 };  // tunnelstairstop, next to the tunnel dwarf (2820,3487)
const GATE = { x: 2642, z: 3441, id: 48 };    // fishinggateclosedr; Morris (2643,3440) checks the pass
const RAILING = { x: 2662, z: 3500, id: 51 }; // mcgruborlooserailing
const VINE = { x: 2631, z: 3498 };            // red_worm_vine (mcgrubors_wood.rs2:26-48)
const PIPE = { x: 2637, z: 3446, id: 41 };    // garlicpipe
const stage = (sdk: BotSDK) => getvar(sdk, 'fishingcompo');

await runScript(async ({ bot, sdk }) => {
    const rec = new Recorder(SELF ? 'fishing_contest_self' : 'fishing_contest');
    await clearInv(sdk);
    await setvar(sdk, 'fishingcompo', 0);
    await setvar(sdk, 'hemenster_comp_stage', 0);
    await setvar(sdk, 'hemenster_pipe_stashed', 0);
    await setstats(sdk, { magic: 99, fishing: 74 });
    const items: [string, number][] = [['fishing_rod', 1], ['fishing_bait', 5], ['coins', 5], ['lawrune', 4], ['airrune', 20]];
    if (SELF) items.push(['spade', 1], ['garlic', 1]); else items.push(['raw_giant_carp', 1]);
    for (const [o, n] of items) await give(sdk, o, n);
    await tele(sdk, 3222, 3218);
    await waitTicks(sdk, 6);
    await cheat(sdk, '~energy');
    const xp0 = sdk.getSkill('fishing')!.experience;
    const T0 = now(sdk);

    // 1. The tunnel dwarf east of Camelot gives the pass. Clicking the stairs makes him
    // stop you, which starts the conversation one option closer to the pass than Talk-to.
    rec.add(await teleport(sdk, 'camelot'), '1a');
    rec.add(await walkTo(bot, sdk, STAIRS.x, STAIRS.z + 1, 1), '1b walk to the tunnel stairs');
    rec.add(withRuns(await locId(sdk, STAIRS.x, STAIRS.z, STAIRS.id, 1, () => false, {
        label: 'tunnel stairs: the dwarf stops you',
        answers: [/^Why not\?/, /If you were my friend/, /let's be friends/i, /how am I meant to do that/i, /Fortunately I'm alright/i],
        maxTicks: 120,
    })), '2 dwarf: pass');
    console.log('stage', await stage(sdk), 'pass', invCount(sdk.getState(), /competition pass/i));

    if (SELF) {
        // McGrubor's Wood: squeeze through the loose railing, dig a red vine worm, back out.
        rec.add(await teleport(sdk, 'camelot'), '3a');
        rec.add(await walkTo(bot, sdk, RAILING.x + 1, RAILING.z, 0), '3b walk to the loose railing');
        rec.add(await locId(sdk, RAILING.x, RAILING.z, RAILING.id, 1, s => pos(s).x <= RAILING.x, { label: 'squeeze through', maxTicks: 20 }), '3c');
        rec.add(await walkTo(bot, sdk, VINE.x, VINE.z - 1, 1), '3d walk to the vines');
        const vine = (await sdk.scanNearbyLocs(6)).find(l => /vine/i.test(l.name) && l.optionsWithIndex.length > 0);
        if (!vine) throw new Error('no vine loc near ' + JSON.stringify(pos(sdk.getState())));
        rec.add(await locId(sdk, vine.x, vine.z, vine.id, vine.optionsWithIndex[0]!.opIndex, s => invCount(s, /red vine worm/i) > 0, { label: 'dig ' + vine.name, maxTicks: 20 }), '3e');
        rec.add(await walkTo(bot, sdk, RAILING.x, RAILING.z, 0), '3f back to the railing');
        rec.add(await locId(sdk, RAILING.x, RAILING.z, RAILING.id, 1, s => pos(s).x > RAILING.x, { label: 'squeeze out', maxTicks: 20 }), '3g');
        rec.add(await walkTo(bot, sdk, GATE.x + 2, GATE.z, 1), '4a walk to Hemenster');
    } else {
        rec.add(await teleport(sdk, 'camelot'), '3a');
        rec.add(await walkTo(bot, sdk, GATE.x + 2, GATE.z, 1), '4a walk to Hemenster');
    }

    // 2. Through Morris's gate, (garlic in the pipe), pay Bonzo, one catch, Bonzo again.
    rec.add(withRuns(await locId(sdk, GATE.x, GATE.z, GATE.id, 1, s => pos(s).x <= GATE.x, { label: 'gate: Morris checks the pass', maxTicks: 30 })), '4b');
    if (SELF) rec.add(await useOnLoc(sdk, /^garlic$/i, PIPE.id, PIPE.x, PIPE.z, s => invCount(s, /^garlic$/i) === 0), '4c garlic in the pipe');
    rec.add(withRuns(await talk(sdk, /^Bonzo$/i, [/enter the competition/i], { idle: 4 })), '5 Bonzo: pay and get a spot');
    console.log('stage', await stage(sdk), 'comp', await getvar(sdk, 'hemenster_comp_stage'));
    {
        const spot = SELF ? { x: 2637, z: 3444 } : { x: 2630, z: 3435 };
        const caught = (s: Parameters<Parameters<typeof waitUntil>[1]>[0]) => invCount(s, /^raw (shrimps|sardine|giant carp)$/i) > (SELF ? 0 : 1);
        const fish = sdk.getState()!.nearbyNpcs.filter(n => /fishing spot/i.test(n.name)).sort((a, b) => Math.max(Math.abs(a.x - spot.x), Math.abs(a.z - spot.z)) - Math.max(Math.abs(b.x - spot.x), Math.abs(b.z - spot.z)))[0];
        if (!fish) throw new Error('no fishing spot');
        const t0 = now(sdk);
        const d = dialogue(sdk, [], { startTimeout: 30, idle: 2 });
        await sdk.sendInteractNpc(fish.index, fish.optionsWithIndex[0]!.opIndex);
        const r = await waitUntil(sdk, caught, 60);
        await d;
        rec.add({ name: `fish at (${fish.x},${fish.z}) ${fish.optionsWithIndex[0]!.text}`, ticks: (r?.tick ?? NaN) - t0, note: sdk.getState()!.inventory.map(i => i.name).join(',') }, '6 one catch');
    }
    rec.add(withRuns(await talk(sdk, /^Bonzo$/i, [], { idle: 4 })), '7 Bonzo: hand over, trophy');
    console.log('stage', await stage(sdk), 'trophy', invCount(sdk.getState(), /trophy/i));

    // 3. Back to the dwarf with the trophy.
    rec.add(await teleport(sdk, 'camelot'), '8a');
    rec.add(await walkTo(bot, sdk, STAIRS.x, STAIRS.z + 1, 1), '8b walk to the tunnel stairs');
    rec.add(withRuns(await talk(sdk, /dwarf/i, [], { idle: 4 })), '9 dwarf: trophy');
    await waitUntil(sdk, s => (s.skills.find(k => k.name.toLowerCase() === 'fishing')?.experience ?? 0) > xp0, 20);
    const gained = sdk.getSkill('fishing')!.experience - xp0;
    console.log('stage', await stage(sdk), 'fishing xp gained', gained, '=', gained / 25, 'base');
    console.log('wall ticks start->finish', now(sdk) - T0);
    rec.summary();
}, { timeout: 900_000 });
