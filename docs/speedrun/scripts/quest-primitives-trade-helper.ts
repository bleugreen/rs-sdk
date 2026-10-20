// Helper side of quest-primitives-trade.ts: trade-request the scored account,
// offer the gift the moment the screen opens, accept both screens at once.
// Run (normally spawned by quest-primitives-trade.ts):
//   bun docs/speedrun/scripts/quest-primitives-trade-helper.ts <helper> <scored> <trades>

import { runScript } from '../../../sdk/runner';
import { give, waitTicks, waitUntil } from './quest-primitives-lib';

const SCORED = (process.argv[3] ?? '').toLowerCase();
const TRADES = Number(process.argv[4] ?? 3);

await runScript(async ({ sdk }) => {
    for (let i = 0; i < TRADES; i++) {
        if (!sdk.getState()!.inventory.some(x => /law rune/i.test(x.name))) await give(sdk, 'lawrune', 100);
        const partner = await waitUntil(sdk, s => s.nearbyPlayers.some(p => p.name.toLowerCase() === SCORED), 100);
        if (!partner) throw new Error('scored account not nearby');
        const p = partner.state.nearbyPlayers.find(x => x.name.toLowerCase() === SCORED)!;
        await sdk.sendTradeRequest(p.index);
        console.log(`HELPER requested at ${sdk.getState()!.tick}`);
        const open = await waitUntil(sdk, s => s.trade?.isOpen === true && s.trade.screen === 'offer', 100);
        if (!open) throw new Error('trade never opened');
        const slot = open.state.inventory.find(x => /law rune/i.test(x.name))!.slot;
        await sdk.sendOfferItem(slot, -1);
        await waitUntil(sdk, s => (s.trade?.myOffer.length ?? 0) > 0, 20);
        await sdk.sendAcceptTrade();
        const conf = await waitUntil(sdk, s => s.trade?.screen === 'confirm', 60);
        if (conf) await sdk.sendAcceptTrade();
        await waitUntil(sdk, s => !s.trade?.isOpen, 60);
        await waitTicks(sdk, 5);
    }
}, { timeout: 300_000 });
