// One two-way trade between lib/trade.ts swap() on SCORED's side and rs/41's mule giver
// (speedrun/helpers/mule.ts giveOpenTrade, burst mode) on the other, shaped like rs/185's Grand
// Tree hand-off: the mule gives a multi-stack package (unstackable bars, a noted stack, a log)
// while SCORED hands back unstackable bars and a noted stack in the same trade.
//
//   LAB_HELPERS=<mule> speedrun/lab/lab.sh <scored> 'speedrun/lab/swap-mule.ts:--mule=<mule>'
//
// Pass: both sides' items move in one trade, swap() reports ok with received/gave matching the
// packages, and the mule reports success.

import { giveOpenTrade } from '../helpers/mule';
import { closeSession, openSession, type Session } from '../lib/session';
import { sameName, swap, tradeOf } from '../lib/trade';
import { nextTick, waitTicks, waitUntil } from '../lib/wait';
import { arg, botArg, result } from './common';
import { cheat, tele, VARROCK_WEST_BANK } from './setup';

const scored = await openSession(botArg());
const mule = await openSession(arg('mule', 'srlab2'), { pathfinding: false });

async function stage(s: Session, gives: string[], count: number): Promise<void> {
    await cheat(s.sdk, 'setvar tutorial 1000');
    await cheat(s.sdk, '~clearinv inv');
    await waitUntil(s.sdk, st => st.inventory.length === 0, { maxTicks: 10 });
    for (const g of gives) await cheat(s.sdk, g);
    await waitUntil(s.sdk, st => st.inventory.length >= count, { maxTicks: 10 });
    await waitTicks(s.sdk, 2);
}

await tele(scored.sdk, VARROCK_WEST_BANK.x - 1, VARROCK_WEST_BANK.z);
await tele(mule.sdk, VARROCK_WEST_BANK.x + 1, VARROCK_WEST_BANK.z);
// Mule: 3 unstackable bronze bars (3 slots), 50 noted coal, 1 log. SCORED: 2 unstackable iron bars, 25 noted iron ore.
await stage(mule, ['give bronze_bar 3', 'give cert_coal 50', 'give logs 1'], 5);
await stage(scored, ['give iron_bar 2', 'give cert_iron_ore 25'], 3);

const scoredName = scored.sdk.getState()!.player!.name;
const muleName = mule.sdk.getState()!.player!.name;
const muleItems = mule.sdk.getState()!.inventory;

// The mule requests first and keeps the request standing, then gives on the open trade.
const muleSide = (async () => {
    let last = -99;
    for (let i = 0; i < 60; i++) {
        const st = await nextTick(mule.sdk);
        if (tradeOf(st).isOpen) break;
        const p = st.nearbyPlayers.find(x => sameName(x.name, scoredName));
        if (p && st.tick - last >= 4) {
            void mule.sdk.sendTradeRequest(p.index);
            last = st.tick;
        }
    }
    return giveOpenTrade(mule.sdk, mule.bot, scoredName, muleItems, 'burst', 30_000);
})();
await waitTicks(scored.sdk, 2);

const r = await swap(scored.sdk, muleName,
    [{ item: /^iron bar$/i }, { item: /^iron ore$/i }],
    [{ item: /^bronze bar$/i, amount: 3 }, { item: /^coal$/i, amount: 50 }, { item: /^logs$/i, amount: 1 }],
    { closeModals: true });
const m = await muleSide;

const sum = (items: Array<{ name: string; count: number }>) => Object.fromEntries(items.map(i => [i.name, i.count]));
const received = sum(r.received);
const gave = sum(r.gave);
const pass = r.ok && m.success
    && received['Bronze bar'] === 3 && received['Coal'] === 50 && received['Logs'] === 1
    && gave['Iron bar'] === 2 && gave['Iron ore'] === 25
    && sum(m.received)['Iron bar'] === 2 && sum(m.received)['Iron ore'] === 25;
result('swap-mule', {
    pass,
    swap: { ok: r.ok, ticks: r.ticks, openTicks: r.openTicks, received, gave, ...(r.reason ? { reason: r.reason } : {}) },
    mule: { success: m.success, message: m.message, ticks: m.ticks, gave: sum(m.gave), received: sum(m.received) },
    scoredInventory: sum(scored.sdk.getState()!.inventory),
});
await closeSession(scored);
await closeSession(mule);
process.exit(pass ? 0 : 1);
