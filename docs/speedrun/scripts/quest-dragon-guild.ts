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
import { mustTele, setvar } from '../../../speedrun/lab/setup';
import { result } from '../../../speedrun/lab/record';
import { opLoc, talkTo } from '../../../speedrun/lib/act';
import { converse, dialogueRuns, type ConverseResult } from '../../../speedrun/lib/converse';
import { pageText } from '../../../speedrun/lib/dialogue';
import { currentTick, waitTicks, waitUntil } from '../../../speedrun/lib/wait';
import { findNpc, opIndex, pos } from '../../../speedrun/lib/world';

const DOOR = { name: /^door$/i, near: { x: 3191, z: 3363 } };

await runScript(async ({ sdk }) => {
    const summary = (r: ConverseResult) => ({ ok: r.ok, ticks: r.opened ? r.ticks : null, pages: r.pages, options: r.options, levelUps: r.levelUps, runs: dialogueRuns(r.transcript), ...(r.reason ? { reason: r.reason } : {}), at: pos(sdk) });
    const out: Record<string, unknown> = {};
    for (const name of ['dragonquest', 'dragon_oracle', 'dragon_goblin', 'dragon_shield', 'qp']) await setvar(sdk, name, 0);

    // 1. Below 32 qp, from outside (north of the door at 3191,3363).
    await mustTele(sdk, 3191, 3365);
    await waitTicks(sdk, 3);
    const gm = findNpc(sdk, /^guild master$/i);
    out.guildmasterSeen = gm ? { x: gm.x, z: gm.z, distance: gm.distance } : null;
    // A probe of whether one Talk-to click across the door opens anything, so a raw click with no re-click.
    const t0 = currentTick(sdk);
    if (gm) await sdk.sendInteractNpc(gm.index, opIndex(gm, /talk/i) ?? 1);
    else out.talkError = `npc not found /^guild master$/i near ${JSON.stringify(pos(sdk))}`;
    const opened = await waitUntil(sdk, s => s.dialog.isOpen, { maxTicks: 15 });
    out.belowQp_talkAcrossDoor = opened.ok ? { dialogOpenedAfter: opened.tick - t0, text: pageText(opened.state.dialog) } : 'no dialog within 15 ticks';
    if (opened.ok) { await sdk.sendCloseModal(); await waitTicks(sdk, 2); }
    await mustTele(sdk, 3191, 3364);
    const before = pos(sdk);
    await opLoc(sdk, DOOR, /^open$/i); // one click: below 32 qp the door refuses with a Guildmaster page
    await waitTicks(sdk, 6);
    out.belowQp_door = { before, after: pos(sdk), chat: sdk.getChat({ limit: 3 }).map(m => m.text) };
    if (sdk.getState()!.dialog.isOpen) await converse(sdk, [], { maxTicks: 20 });
    result('guild.belowQp', out);

    // 2. With 32 qp: door, then the Guildmaster's start dialogue. At 32 qp the
    // door opens with no dialogue (champions_guild.rs2), so it is timed from
    // the click to standing south of it.
    await setvar(sdk, 'qp', 32);
    await mustTele(sdk, 3191, 3364);
    await waitTicks(sdk, 2);
    const door = await opLoc(sdk, DOOR, /^open$/i, s => pos(s).z < 3363 && !s.dialog.isOpen, { maxTicks: 30 });
    const gmTalk = await talkTo(sdk, /^guild master$/i, [/Rune Plate mail/i], { maxTicks: 60, unmatched: 'stop' });
    result('guild.start', { door: { ok: door.ok, ticks: door.ok ? door.ticks : null, resends: door.resends }, guildmaster: summary(gmTalk) });

    // 3. Oziach, everything in one conversation.
    await mustTele(sdk, 3068, 3515);
    await waitTicks(sdk, 3);
    const oz = await talkTo(sdk, /^oziach$/i, [
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
    ], { maxTicks: 150, unmatched: 'stop' });
    result('guild.oziach', { ...summary(oz), remaining: oz.remaining.map(String), endTick: oz.endTick, key: sdk.getState()!.inventory.filter(i => /key/i.test(i.name)).map(i => i.name) });
}, { timeout: 300_000 });
