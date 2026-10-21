// Dragon Slayer start: is the Guildmaster reachable across the Champions'
// Guild door below 32 quest points, and how long do the Guildmaster and
// Oziach conversations take on the shortest dialogue path?
// Run: bun docs/speedrun/scripts/quest-dragon-guild.ts <botname>
//
// Phases (all on a lab account with staff level 4):
//  1. qp 0, standing outside the door: talk-to the Guildmaster (3191,3362),
//     then try the door. Expect the door to refuse (champions_guild.rs2:2).
//  2. qp 32: open the door from outside, then talk to the Guildmaster and pick
//     "Do you know where I could get a Rune Plate mail body?" (stage 1).
//  3. Oziach (3069,3517): the full briefing in one conversation (stage 2, the
//     maze key, and the oracle/goblin/shield varps).

import { runScript } from '../../../sdk/runner';
import { cheat, now, pos, result, tele, waitTicks, waitUntil } from './quest-primitives-lib';
import { clickLoc, converseSeq, talk } from './quest-dragon-lib';

await runScript(async ({ sdk }) => {
    const out: Record<string, unknown> = {};
    for (const v of ['dragonquest 0', 'dragon_oracle 0', 'dragon_goblin 0', 'dragon_shield 0', 'qp 0']) { await cheat(sdk, 'setvar ' + v); await waitTicks(sdk, 1); }

    // 1. Below 32 qp, from outside (north of the door at 3191,3363).
    await tele(sdk, 3191, 3365);
    await waitTicks(sdk, 3);
    const gm = sdk.findNearbyNpc(/^guild master$/i);
    out.guildmasterSeen = gm ? { x: gm.x, z: gm.z, distance: gm.distance } : null;
    const t0 = now(sdk);
    await talk(sdk, /^guild master$/i).catch(e => { out.talkError = String(e); });
    const opened = await waitUntil(sdk, s => s.dialog.isOpen, 15);
    out.belowQp_talkAcrossDoor = opened ? { dialogOpenedAfter: opened.tick - t0, text: opened.state.dialog.text } : 'no dialog within 15 ticks';
    if (opened) { await sdk.sendCloseModal(); await waitTicks(sdk, 2); }
    await tele(sdk, 3191, 3364);
    const before = pos(sdk.getState());
    await clickLoc(sdk, /^door$/i, /^open$/i, { x: 3191, z: 3363 });
    await waitTicks(sdk, 6);
    out.belowQp_door = { before, after: pos(sdk.getState()), chat: sdk.getChat({ limit: 3 }).map(m => m.text) };
    if (sdk.getState()!.dialog.isOpen) { await sdk.sendClickDialog(0); await waitTicks(sdk, 2); }
    result('guild.belowQp', out);

    // 2. With 32 qp: door, then the Guildmaster's start dialogue.
    await cheat(sdk, 'setvar qp 32'); await waitTicks(sdk, 1);
    await tele(sdk, 3191, 3364);
    await waitTicks(sdk, 2);
    const tDoor = now(sdk);
    const door = await converseSeq(sdk, () => clickLoc(sdk, /^door$/i, /^open$/i, { x: 3191, z: 3363 }), [], s => pos(s).z < 3363 && !s.dialog.isOpen, 30);
    const gmTalk = await converseSeq(sdk, () => talk(sdk, /^guild master$/i), [/Rune Plate mail/i], s => !s.dialog.isOpen && now(sdk) > tDoor + door.ticks! + 3, 60);
    result('guild.start', { door, guildmaster: gmTalk });

    // 3. Oziach, everything in one conversation.
    await tele(sdk, 3068, 3515);
    await waitTicks(sdk, 3);
    const oz = await converseSeq(sdk, () => talk(sdk, /^oziach$/i), [
        /Can you sell me some Rune plate mail/i,
        /guildmaster of the Champions' Guild told me/i,
        /So how am I meant to prove that/i,
        /A dragon, that sounds like fun/i,
        /So where can I find this dragon/i,
        /Where is the first piece/i,
        /Where is the second piece/i,
        /Where is the third piece/i,
        /antidragon shield/i,
        /Ok I'll try and get everything together/i,
    ], s => !s.dialog.isOpen && now(sdk) > 0, 150);
    // wait for the conversation to actually end (the predicate above can be true before the first page)
    const end = await waitUntil(sdk, s => !s.dialog.isOpen, 150);
    result('guild.oziach', { ...oz, endTick: end?.tick, key: sdk.getState()!.inventory.filter(i => /key/i.test(i.name)).map(i => i.name) });
}, { timeout: 300_000 });
