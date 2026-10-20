// Can several dialogue pages advance in one tick? Fires a choice click and a
// burst of "continue" clicks without waiting for each page, through the plain
// pages after the second choice of the Cook's Assistant "You don't look very
// happy" branch (quest_cook.rs2:10-28). The burst must cover every page up to
// the next choice, or the script waits for a choice that never appears.
//
// The stock lite client refuses a second continue until the next page arrives
// (server/webclient/src/lite/actions.ts, the resumedPauseButton guard), so this
// needs a lab client with that guard lifted, e.g. the condition replaced by
//   c.chatModalId !== -1 && (process.env.BLIND_RESUME === '1' || (!c.resumedPauseButton && !choicePending()))
// and the lite runner started with BLIND_RESUME=1. With the stock client the
// extra clicks are refused locally and the result degenerates to 1 page per
// round trip.
// Run: bun docs/speedrun/scripts/quest-primitives-dialogue-blind.ts <botname> [burst] [wrong|rest]

import { runScript } from '../../../sdk/runner';
import type { BotWorldState } from '../../../sdk/types';
import { cheat, dialogText, now, result, tele, waitTicks, waitUntil } from './quest-primitives-lib';

const BURST = Number(process.argv[3] ?? 5);
const CHOICE = process.argv[4] === 'rest' ? /rest of the day/ : /What's wrong/;
const PAGES = process.argv[4] === 'rest' ? 5 : 3;

await runScript(async ({ sdk }) => {
    const runs: Array<{ burstTick: number; nextChoiceTick: number; ticks: number; pages: number; events: number }> = [];
    for (let run = 0; run < 3; run++) {
        await cheat(sdk, 'setvar cookquest 0');
        await tele(sdk, 3209, 3215);
        await waitTicks(sdk, 2);
        const cook = sdk.findNearbyNpc(/^cook$/i)!;
        const talk = cook.optionsWithIndex.find(o => /talk/i.test(o.text))!;
        await sdk.sendInteractNpc(cook.index, talk.opIndex);

        const has = (re: RegExp) => (s: BotWorldState) => s.dialog.isOpen && s.dialog.options.some(o => re.test(o.text));
        // Page 1 -> choice 1 ("You don't look very happy") -> 2 pages -> choice 2 ("What's wrong?").
        await waitUntil(sdk, s => s.dialog.isOpen && !s.dialog.isWaiting, 20);
        await sdk.sendClickDialog(0);
        let r = await waitUntil(sdk, has(/look very happy/), 20);
        await sdk.sendClickDialog(r!.state.dialog.options.find(o => /look very happy/.test(o.text))!.index);
        for (let i = 0; i < 2; i++) {
            const t = now(sdk);
            await waitUntil(sdk, s => s.tick > t && s.dialog.isOpen && !s.dialog.isWaiting && s.dialog.options.length <= 1, 20);
            await sdk.sendClickDialog(0);
        }
        r = await waitUntil(sdk, has(/rest of the day/), 20);
        // Pick CHOICE and then fire the burst of continues without waiting.
        // "What's wrong?" is followed by 3 plain pages before the next choice,
        // "I'd take the rest of the day off" by 5 (quest_cook.rs2:12-28).
        const opt = r!.state.dialog.options.find(o => CHOICE.test(o.text))!;
        const burstTick = now(sdk);
        const sends = [sdk.sendClickDialog(opt.index)];
        for (let i = 0; i < BURST; i++) sends.push(sdk.sendClickDialog(0));
        await Promise.all(sends);
        const done = await waitUntil(sdk, has(/I'll help you/), 40);
        console.log(`run ${run}: burst@${burstTick} -> "Yes, I'll help" choice +${done!.tick - burstTick} (${dialogText(done!.state).slice(0, 50)})`);
        runs.push({ burstTick, nextChoiceTick: done!.tick, ticks: done!.tick - burstTick, pages: PAGES, events: 1 + Math.min(BURST, PAGES) });
        await sdk.sendClickDialog(done!.state.dialog.options.find(o => /I'll help/.test(o.text))!.index);
        await waitUntil(sdk, s => !s.dialog.isOpen || s.dialog.options.length <= 1, 20);
        for (let i = 0; i < 4 && sdk.getState()!.dialog.isOpen; i++) { await sdk.sendClickDialog(0); await waitTicks(sdk, 1); }
        await waitTicks(sdk, 3);
    }
    // Without blind resumes the choice click plus five pages costs 6 ticks (one per page).
    result('dialogue.blindBurst', { burst: BURST, runs });
}, { timeout: 200_000 });
