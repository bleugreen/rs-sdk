// Trade timing: ticks for the scored account to take one trade from a helper
// standing next to it. Spawns quest-primitives-trade-helper.ts for the helper.
// The helper requests first; the scored account then clicks trade back,
// accepts the offer screen once the gift is on it and the helper has
// accepted, and accepts the confirm screen.
// Run: bun docs/speedrun/scripts/quest-primitives-trade.ts <scored> <helper> [trades]

import { runScript } from '../../../sdk/runner';
import { mustTele } from '../../../speedrun/lab/setup';
import { result, stats } from '../../../speedrun/lab/record';
import { currentTick, waitTicks, waitUntil } from '../../../speedrun/lib/wait';
import { invCount } from '../../../speedrun/lib/world';

const HELPER = process.argv[3] ?? 'qphelper';
const TRADES = Number(process.argv[4] ?? 3);

await runScript(async ({ sdk }) => {
    await mustTele(sdk, 3222, 3218);
    const me = sdk.getState()!.player!.name;
    const helperProc = Bun.spawn(['bun', 'docs/speedrun/scripts/quest-primitives-trade-helper.ts', HELPER, me, String(TRADES)], { stdout: 'inherit', stderr: 'ignore' });
    const samples = [];
    for (let i = 0; i < TRADES; i++) {
        const startTick = currentTick(sdk);
        // A trade request is chat type 4, not a game message (type 0).
        const req = await waitUntil(sdk, s => s.gameMessages.some(m => m.type === 4 && m.tick > startTick && /wishes to trade/i.test(m.text)), { maxTicks: 200 });
        if (!req.ok) throw new Error('no trade request');
        const helper = await waitUntil(sdk, s => s.nearbyPlayers.some(p => p.name.toLowerCase() === HELPER.toLowerCase()), { maxTicks: 20 });
        if (!helper.ok) throw new Error('helper not nearby');
        const hp = helper.state.nearbyPlayers.find(p => p.name.toLowerCase() === HELPER.toLowerCase())!;
        const laws0 = invCount(sdk, /law rune/i);
        const t0 = currentTick(sdk);
        await sdk.sendTradeRequest(hp.index);
        const open = await waitUntil(sdk, s => s.trade?.isOpen === true, { maxTicks: 40 });
        const offered = await waitUntil(sdk, s => (s.trade?.theirOffer.length ?? 0) > 0 && s.trade!.partnerAccepted, { maxTicks: 40 });
        await sdk.sendAcceptTrade();
        const conf = await waitUntil(sdk, s => s.trade?.screen === 'confirm', { maxTicks: 40 });
        await sdk.sendAcceptTrade();
        const done = await waitUntil(sdk, s => !s.trade?.isOpen && invCount(s, /law rune/i) > laws0, { maxTicks: 40 });
        const sample = {
            requestSeenAfterHelperClick: null as number | null,
            clickToOpen: open.ok ? open.tick - t0 : null,
            openToHelperOfferAccepted: open.ok && offered.ok ? offered.tick - open.tick : null,
            acceptToConfirm: offered.ok && conf.ok ? conf.tick - offered.tick : null,
            confirmToDone: conf.ok && done.ok ? done.tick - conf.tick : null,
            scoredClickToItems: done.ok ? done.tick - t0 : null,
            requestSeenToItems: done.ok ? done.tick - req.tick : null,
        };
        console.log(JSON.stringify(sample));
        samples.push(sample);
        await waitTicks(sdk, 3);
    }
    await helperProc.exited;
    result('trade', { samples, scoredClickToItems: stats(samples.map(s => s.scoredClickToItems ?? NaN)), requestSeenToItems: stats(samples.map(s => s.requestSeenToItems ?? NaN)) });
}, { timeout: 400_000 });
