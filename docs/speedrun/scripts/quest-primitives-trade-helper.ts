// Helper side of quest-primitives-trade.ts: trade-request the scored account,
// offer the gift the moment the screen opens, accept both screens at once.
// Run (normally spawned by quest-primitives-trade.ts):
//   bun docs/speedrun/scripts/quest-primitives-trade-helper.ts <helper> <scored> <trades>

import { runScript } from '../../../sdk/runner';
import { give, mustTele } from '../../../speedrun/lab/setup';
import { waitTicks, waitUntil } from '../../../speedrun/lib/wait';
import { invItem } from '../../../speedrun/lib/world';

const SCORED = (process.argv[3] ?? '').toLowerCase();
const TRADES = Number(process.argv[4] ?? 3);

await runScript(async ({ sdk }) => {
    // stand next to the scored account's tile (quest-primitives-trade.ts uses 3222,3218)
    await mustTele(sdk, 3223, 3218);
    for (let i = 0; i < TRADES; i++) {
        if (!invItem(sdk, /law rune/i)) await give(sdk, 'lawrune', 100);
        const partner = await waitUntil(sdk, s => s.nearbyPlayers.some(p => p.name.toLowerCase() === SCORED), { maxTicks: 100 });
        if (!partner.ok) throw new Error('scored account not nearby');
        const p = partner.state.nearbyPlayers.find(x => x.name.toLowerCase() === SCORED)!;
        await sdk.sendTradeRequest(p.index);
        console.log(`HELPER requested at ${sdk.getState()!.tick}`);
        const open = await waitUntil(sdk, s => s.trade?.isOpen === true && s.trade.screen === 'offer', { maxTicks: 100 });
        if (!open.ok) throw new Error('trade never opened');
        const slot = invItem(open.state, /law rune/i)!.slot;
        await sdk.sendOfferItem(slot, -1);
        await waitUntil(sdk, s => (s.trade?.myOffer.length ?? 0) > 0, { maxTicks: 20 });
        await sdk.sendAcceptTrade();
        const conf = await waitUntil(sdk, s => s.trade?.screen === 'confirm', { maxTicks: 60 });
        if (conf.ok) await sdk.sendAcceptTrade();
        await waitUntil(sdk, s => !s.trade?.isOpen, { maxTicks: 60 });
        await waitTicks(sdk, 5);
    }
}, { timeout: 300_000 });
