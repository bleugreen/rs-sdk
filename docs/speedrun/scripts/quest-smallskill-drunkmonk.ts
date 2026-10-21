// Monk's Friend end to end on the lab server (docs/speedrun/quests/monks_friend.md).
// Resets %drunkmonkquest, gives what one helper trade would carry (a jug of water,
// logs, Ardougne teleport runes), sets Plague City complete for the teleport,
// casts Ardougne teleport from Lumbridge and plays the quest.
// Run: bash docs/speedrun/scripts/quest-smallskill-lab.sh <bot> docs/speedrun/scripts/quest-smallskill-drunkmonk.ts

import { runScript } from '../../../sdk/runner';
import type { BotSDK } from '../../../sdk/index';
import { cheat, clearInv, getvar, give, invCount, locId, locOp, now, pickup, pos, Recorder, setstats, setvar, talk, tele, teleport, waitTicks, waitUntil, walkTo, withRuns } from './quest-smallskill-lib';

const OMAD = { x: 2604, z: 3209 };
const CEDRIC = { x: 2614, z: 3259 };   // he wanders the forest north of the monastery
const STONES = { x: 2561, z: 3222 };   // ^blanket_ladder_coord (quest_drunkmonk.constant:1)
const BLANKET = { x: 2570, z: 9604 };  // childs_blanket ground spawn (maps/m40_150.jm2)
const stage = (sdk: BotSDK) => getvar(sdk, 'drunkmonkquest');

await runScript(async ({ bot, sdk }) => {
    const rec = new Recorder('monks_friend');
    await clearInv(sdk);
    await setvar(sdk, 'drunkmonkquest', 0);
    await setvar(sdk, 'elenaquest', 30);
    await setstats(sdk, { magic: 99, woodcutting: 1, attack: 70, strength: 70, defence: 70, hitpoints: 70 });
    for (const [o, n] of [['jug_water', 1], ['logs', 1], ['lawrune', 4], ['waterrune', 4], ['shark', 3]] as const) await give(sdk, o, n);
    await tele(sdk, 3222, 3218);
    await waitTicks(sdk, 6);
    await cheat(sdk, '~energy');
    const xp0 = sdk.getSkill('woodcutting')!.experience;
    const T0 = now(sdk);

    rec.add(await teleport(sdk, 'ardougne'), '1a');
    rec.add(await walkTo(bot, sdk, OMAD.x, OMAD.z, 2), '1b walk to Brother Omad');
    rec.add(withRuns(await talk(sdk, /^Brother Omad$/i, [/Why can't you sleep/, /Can I help at all/])), '2 Omad: start');
    console.log('stage', await stage(sdk));

    // The ladder only appears while you stand within 2 tiles of the stone ring (timer, quest_drunkmonk.rs2:1-6).
    rec.add(await walkTo(bot, sdk, STONES.x + 1, STONES.z + 1, 0), '3a walk to the ring of stones');
    {
        const t0 = now(sdk);
        const r = await waitUntil(sdk, s => (s.nearbyLocs ?? []).some(l => l.x === STONES.x && l.z === STONES.z && /ladder/i.test(l.name)), 10);
        rec.add({ name: 'wait for the ladder to appear', ticks: (r?.tick ?? NaN) - t0 }, '3b');
    }
    rec.add(await locId(sdk, STONES.x, STONES.z, 1765, 1, s => pos(s).z > 9000, { label: 'climb down', maxTicks: 20 }), '3c');
    rec.add(await walkTo(bot, sdk, BLANKET.x, BLANKET.z, 1), '4a walk to the blanket');
    rec.add(await pickup(sdk, /child'?s blanket/i), '4b');
    rec.add(await walkTo(bot, sdk, 2561, 9621, 1), '4c back to the ladder');
    rec.add(await locOp(sdk, /^ladder$/i, /climb-up/i, s => pos(s).z < 9000, 20), '4d climb up');
    console.log('hp', sdk.getState()!.player!.hp, 'pos', pos(sdk.getState()));

    rec.add(await walkTo(bot, sdk, OMAD.x, OMAD.z, 2), '5a back to Omad');
    rec.add(withRuns(await talk(sdk, /^Brother Omad$/i, [])), '5b Omad: blanket');
    console.log('stage', await stage(sdk));
    rec.add(withRuns(await talk(sdk, /^Brother Omad$/i, [/Who's Brother Cedric/, /Where should I look/])), '5c Omad: party, find Cedric');
    console.log('stage', await stage(sdk));

    rec.add(await walkTo(bot, sdk, CEDRIC.x, CEDRIC.z, 3), '6a walk to Brother Cedric');
    rec.add(withRuns(await talk(sdk, /^Brother Cedric$/i, [])), '6b Cedric: drunk');
    rec.add(withRuns(await talk(sdk, /^Brother Cedric$/i, [/happy to/])), '6c Cedric: water, cart');
    rec.add(withRuns(await talk(sdk, /^Brother Cedric$/i, [])), '6d Cedric: logs');
    console.log('stage', await stage(sdk));

    rec.add(await walkTo(bot, sdk, OMAD.x, OMAD.z, 2), '7a back to Omad');
    {
        // The party is ~33 ticks of p_delay with the chat box closed, then a queued completion.
        const t0 = now(sdk);
        const r = await talk(sdk, /^Brother Omad$/i, [], { idle: 40 });
        const done = await waitUntil(sdk, s => (s.skills.find(k => k.name.toLowerCase() === 'woodcutting')?.experience ?? 0) > xp0, 80);
        rec.add(withRuns({ ...r, ticks: (done?.tick ?? NaN) - t0, note: `xp at +${(done?.tick ?? NaN) - t0}` }), '7b Omad: party to quest complete');
    }
    await waitTicks(sdk, 2);
    const gained = sdk.getSkill('woodcutting')!.experience - xp0;
    console.log('stage', await stage(sdk), 'woodcutting xp gained', gained, '=', gained / 25, 'base; law runes', invCount(sdk.getState(), /law rune/i));
    console.log('wall ticks start->finish', now(sdk) - T0);
    rec.summary();
}, { timeout: 900_000 });
