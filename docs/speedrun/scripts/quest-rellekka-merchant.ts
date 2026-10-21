// Fremennik Trials, Sigmund's merchant trial: the whole trade chain, walking
// between the NPCs with the SDK pathfinder (which opens doors itself), from the
// first click on the sailor to the flower handed to Sigmund.
//
//   bun docs/speedrun/scripts/quest-rellekka-merchant.ts <bot> [from=<n>]
//
// Staging: %viking 1, Sigmund's progress "started" (his first talk is timed in
// quest-rellekka-segments.ts councillors), 5000 coins for Askeladden. The bot
// starts beside Sigmund. Every NPC on the chain first offers "Ask about the
// Merchant's trial" while the trial is open; the item each one hands over is
// untradeable (viking.obj), so the scored account walks the whole chain.

import { runScript } from '../../../sdk/runner';
import { talkTo, walkTo } from '../../../speedrun/lib/act';
import { dialogueRuns } from '../../../speedrun/lib/converse';
import { currentTick, waitUntil } from '../../../speedrun/lib/wait';
import { chebyshev, findNpc, pos, type StateLike } from '../../../speedrun/lib/world';
import { result } from '../../../speedrun/lab/record';
import { clearInventory, getvar, give, mustTele, setvar } from '../../../speedrun/lab/setup';
const SIGMUND_STAGE_ONE = 1 << 23; // quest_viking.constant

const chain: Array<[string, RegExp]> = [
    ['sailor', /^Sailor$/], ['olaf', /Olaf/], ['yrsa', /Yrsa/], ['brundt', /Brundt/], ['sigli', /Sigli/],
    ['skulgrimen', /Skulgrimen/], ['fisherman', /^Fisherman$/], ['swensen', /Swensen/], ['peer', /Peer the Seer/],
    ['thorvald', /Thorvald/], ['manni', /Manni/], ['thora', /Thora/], ['askeladden', /Askeladden/],
    ['thora', /Thora/], ['manni', /Manni/], ['thorvald', /Thorvald/], ['peer', /Peer the Seer/], ['swensen', /Swensen/],
    ['fisherman', /^Fisherman$/], ['skulgrimen', /Skulgrimen/], ['sigli', /Sigli/], ['brundt', /Brundt/],
    ['yrsa', /Yrsa/], ['olaf', /Olaf/], ['sailor', /^Sailor$/], ['sigmund', /Sigmund/],
];

// Spawn tiles (quest-rellekka-map.ts npc ...).
const spawn: Record<string, [number, number]> = {
    sailor: [2629, 3693], olaf: [2673, 3683], yrsa: [2625, 3675], brundt: [2659, 3669], sigli: [2660, 3653],
    skulgrimen: [2663, 3694], fisherman: [2641, 3699], swensen: [2646, 3660], peer: [2634, 3668], thorvald: [2666, 3693],
    manni: [2660, 3673], thora: [2662, 3673], askeladden: [2658, 3660], sigmund: [2641, 3680],
};

await runScript(async ({ bot, sdk }) => {
    const out: Record<string, unknown> = { legs: [] as unknown[] };
    const legs = out.legs as unknown[];
    process.on('exit', () => result('rellekka-merchant', out));
    await bot.dismissBlockingUI();
    await clearInventory(sdk);
    await setvar(sdk, 'viking', 1);
    await setvar(sdk, 'viking_bits', SIGMUND_STAGE_ONE);
    await give(sdk, 'coins', 5000);
    await mustTele(sdk, 2641, 3681, 0);
    const T0 = currentTick(sdk);
    let pages = 0;
    let options = 0;
    for (const [name, re] of chain) {
        const p0 = pos(sdk);
        const t0 = currentTick(sdk);
        // NPCs out of view: walk towards the spawn tile first (counted in the leg).
        const npcVisible = (s: StateLike) => {
            const n = findNpc(s, re);
            return n !== null && n.distance <= 12;
        };
        const home = spawn[name];
        if (!npcVisible(sdk) && home) {
            await walkTo(bot, sdk, home[0], home[1], 4);
            await waitUntil(sdk, npcVisible, { maxTicks: 10 });
        }
        const npc = findNpc(sdk, re);
        if (!npc) throw new Error(`${name} not in view from ${JSON.stringify(pos(sdk))}`);
        // Walk to within 2 tiles with the pathfinder first, which opens the
        // houses' doors on the way; the talk-to click itself does not.
        if (npc.distance > 2) await walkTo(bot, sdk, npc.x, npc.z, 2);
        const t = await talkTo(sdk, re, [/Merchant's trial/, /^Yes$/], { keep: true, idle: 2, findTicks: 20 });
        if (!t.opened) throw new Error(`${name}: no dialogue opened (at ${JSON.stringify(pos(sdk))})`);
        pages += t.pages;
        options += t.options;
        const leg = {
            name, ticks: currentTick(sdk) - t0, dialogue: t.pages + t.options, runs: dialogueRuns(t.transcript),
            straight: chebyshev(pos(sdk), p0), inv: (sdk.getState()?.inventory ?? []).map(i => i.name).filter(n => n !== 'Coins').join('/'),
        };
        console.log('leg', JSON.stringify(leg));
        legs.push(leg);
    }
    out.total = { ticks: currentTick(sdk) - T0, pages, options, viking: await getvar(sdk, 'viking') };
}, { timeout: 1_800_000, printState: false });
