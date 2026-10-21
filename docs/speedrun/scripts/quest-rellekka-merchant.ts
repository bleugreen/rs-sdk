// Fremennik Trials, Sigmund's merchant trial: the whole trade chain, walking
// between the NPCs with the SDK's talkTo (which paths and opens doors itself),
// from the first click on the sailor to the flower handed to Sigmund.
//
//   bun docs/speedrun/scripts/quest-rellekka-merchant.ts <bot> [from=<n>]
//
// Staging: %viking 1, Sigmund's progress "started" (his first talk is timed in
// quest-rellekka-segments.ts councillors), 5000 coins for Askeladden. The bot
// starts beside Sigmund. Every NPC on the chain first offers "Ask about the
// Merchant's trial" while the trial is open; the item each one hands over is
// untradeable (viking.obj), so the scored account walks the whole chain.

import { runScript } from '../../../sdk/runner';
import * as L from './quest-rellekka-lib';

const chain: Array<[string, RegExp]> = [
    ['sailor', /^Sailor$/], ['olaf', /Olaf/], ['yrsa', /Yrsa/], ['brundt', /Brundt/], ['sigli', /Sigli/],
    ['skulgrimen', /Skulgrimen/], ['fisherman', /^Fisherman$/], ['swensen', /Swensen/], ['peer', /Peer the Seer/],
    ['thorvald', /Thorvald/], ['manni', /Manni/], ['thora', /Thora/], ['askeladden', /Askeladden/],
    ['thora', /Thora/], ['manni', /Manni/], ['thorvald', /Thorvald/], ['peer', /Peer the Seer/], ['swensen', /Swensen/],
    ['fisherman', /^Fisherman$/], ['skulgrimen', /Skulgrimen/], ['sigli', /Sigli/], ['brundt', /Brundt/],
    ['yrsa', /Yrsa/], ['olaf', /Olaf/], ['sailor', /^Sailor$/], ['sigmund', /Sigmund/]
];

await runScript(async ({ bot, sdk }) => {
    const legs: unknown[] = [];
    process.on('exit', () => L.report('Merchant chain', { legs }));
    await L.clearInv(sdk, bot);
    await L.cheat(sdk, 'setvar viking 1');
    await L.cheat(sdk, `setvar viking_bits ${L.BITS.sigmund(1)}`);
    await L.give(sdk, 'coins', 5000);
    await L.tele(sdk, 2641, 3681, 0);
    await sdk.waitForTicks(3);
    const T0 = L.tick(sdk);
    let pages = 0;
    let options = 0;
    for (const [name, re] of chain) {
        const p0 = L.pos(sdk);
        const t0 = L.tick(sdk);
        // Find the NPC even when it is beyond the loaded view: walk towards its spawn first.
        if (!sdk.findNearbyNpc(re)) throw new Error(`${name} not in view from ${JSON.stringify(p0)}`);
        const t = await L.talk(sdk, bot, re, [/Merchant's trial/, /^Yes$/]);
        const p1 = L.pos(sdk);
        pages += t.pages;
        options += t.options;
        const leg = { name, ticks: L.tick(sdk) - t0, dialogue: t.pages + t.options, runs: t.runs, straight: Math.max(Math.abs(p1.x - p0.x), Math.abs(p1.z - p0.z)), inv: sdk.getInventory().map(i => i.name).filter(n => n !== 'Coins').join('/') };
        console.log('leg', JSON.stringify(leg));
        legs.push(leg);
    }
    console.log('total', JSON.stringify({ ticks: L.tick(sdk) - T0, pages, options, viking: await L.getVar(sdk, 'viking') }));
}, { timeout: 1_800_000, printState: false });
