// Trade: receiver clock (scored account) for ours vs stock.
//   bun speedrun/lab/measure-trade.ts <receiver> --giver=srlab2 [--n=3]
// Cases: 1 noted stack, and 23 noted stacks. The giver requests first, as a
// helper would; the receiver's clock starts at its own first click, after it
// has seen the request. Items are handed back (unmeasured) between samples.

import type { TradeItemSpec } from '../../sdk/types';
import { closeSession, openSession, type Session } from '../lib/session';
import { formatReport, report } from '../lib/ticks';
import { giveAll, receiveFrom } from '../lib/trade';
import { waitTicks } from '../lib/wait';
import { arg, botArg, labLog, result, sample } from './common';
import { give, LAB_ITEMS, tele, VARROCK_WEST_BANK } from './setup';

const n = Number(arg('n', '3'));
const recv = await openSession(botArg());
const giver = await openSession(arg('giver', 'srlab2'), { pathfinding: false });
const log = labLog('trade');

await tele(recv.sdk, VARROCK_WEST_BANK.x - 2, VARROCK_WEST_BANK.z);
await tele(giver.sdk, VARROCK_WEST_BANK.x, VARROCK_WEST_BANK.z);

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Move everything the `from` session holds to `to`, with our own primitives. */
async function handBack(from: Session, to: Session) {
    if (from.sdk.getState()!.inventory.length === 0) return;
    const req = to.sdk.waitForTradeRequest({ from: from.name, timeout: 20_000 });
    const g = giveAll(from.sdk, to.name);
    await req;
    const r = await receiveFrom(to.sdk, from.name);
    const gr = await g;
    if (!r.ok || !gr.ok) throw new Error(`hand-back failed: ${r.reason ?? ''} ${gr.reason ?? ''}`);
    await waitTicks(to.sdk, 2);
}

async function stageGiver(names: readonly string[], count: number) {
    await handBack(recv, giver);
    if (giver.sdk.getState()!.inventory.length === 0) await give(giver.sdk, names.map(x => `cert_${x}`), count);
}

async function oursSample(label: string) {
    const req = recv.sdk.waitForTradeRequest({ from: giver.name, timeout: 20_000 });
    const g = giveAll(giver.sdk, recv.name);
    if (!(await req)) throw new Error('no trade request');
    const r = await sample(log, recv, `${label} (ours)`, () => receiveFrom(recv.sdk, giver.name));
    const gr = await g;
    result(`${label} (ours) detail`, { receiverTicks: r.ticks, giverTicks: gr.ticks, giverEvents: gr.sent, ok: r.ok && gr.ok, reason: r.reason ?? gr.reason });
}

async function stockSample(label: string) {
    const items = giver.sdk.getState()!.inventory;
    const giveSpecs: TradeItemSpec[] = items.map(i => ({ item: new RegExp(`^${esc(i.name)}$`), amount: -1 }));
    const want: TradeItemSpec[] = items.map(i => ({ item: new RegExp(`^${esc(i.name)}$`), amount: i.count }));
    const req = recv.sdk.waitForTradeRequest({ from: giver.name, timeout: 20_000 });
    const g = giver.bot.trade(recv.name, { give: giveSpecs });
    if (!(await req)) throw new Error('no trade request');
    const r = await sample(log, recv, `${label} (stock)`, async () => {
        const t = await recv.bot.trade(giver.name, { want });
        return { ok: t.success, reason: t.reason };
    });
    await g;
    result(`${label} (stock) detail`, r);
}

const cases: Array<{ label: string; names: readonly string[]; count: number }> = [
    { label: 'trade receive 1 stack', names: ['iron_ore'], count: 100 },
    { label: 'trade receive 23 noted stacks', names: LAB_ITEMS.slice(0, 23), count: 10 },
];
for (const c of cases) {
    for (let i = 0; i < n; i++) {
        await stageGiver(c.names, c.count);
        await oursSample(c.label);
        await stageGiver(c.names, c.count);
        await stockSample(c.label);
    }
    // Leave the giver empty for the next case.
    await handBack(recv, giver);
    if (giver.sdk.getState()!.inventory.length) {
        await giver.bot.openBank();
        const { depositAll } = await import('../lib/bank');
        await depositAll(giver.sdk);
        await giver.bot.closeBank();
    }
}

console.log(formatReport(report(log.rows)));
console.log(`log: ${log.path}`);
await closeSession(recv);
await closeSession(giver);
process.exit(0);
