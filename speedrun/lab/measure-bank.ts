// Bank: ours vs stock, at the lab tick rate.
//   deposit 24 distinct stacks:  depositAll       vs bot.depositItem(/./, -1)
//   withdraw 28 distinct items:  withdrawMany     vs bot.withdrawItem loop
//   withdraw 28 of one item:     withdrawMany fill vs bot.withdrawItem(ore, 28)
// Ticks run from a fresh tick to the confirmed end state (bank already open).

import { depositAll, withdrawMany, type WithdrawSpec } from '../lib/bank';
import { closeSession, openSession } from '../lib/session';
import { formatReport, report } from '../lib/ticks';
import { arg, botArg, labLog, sample } from './common';
import { bankFixture, isLabItem, LAB_ITEMS, leaveTutorial } from './setup';

const n = Number(arg('n', '3'));
const session = await openSession(botArg());
const { sdk, bot } = session;
const log = labLog('bank');
await leaveTutorial(session);

await bankFixture(session, { ironOre: 100 });
const labIds = LAB_ITEMS.map(d => sdk.getState()!.bank.items.find(i => isLabItem(i.name, d))?.id).filter((id): id is number => id !== undefined);
if (labIds.length < 28) throw new Error(`bank holds only ${labIds.length} lab items`);
const ore = sdk.getState()!.bank.items.find(i => i.name === 'Iron ore')!.id;
const specs = (k: number): WithdrawSpec[] => labIds.slice(0, k).map(id => ({ item: id, n: 1 }));

async function stage(k: number) {
    const r = await withdrawMany(sdk, specs(k));
    if (!r.ok || sdk.getState()!.inventory.length !== k) throw new Error(`staging ${k} items failed: ${JSON.stringify(r)}`);
}
/** Fail the sample unless the inventory ends with exactly `slots` items. */
async function verified(p: Promise<unknown>, slots: number): Promise<{ ok: boolean; reason?: string }> {
    await p;
    const len = sdk.getState()!.inventory.length;
    return len === slots ? { ok: true } : { ok: false, reason: `inventory holds ${len} items, expected ${slots}` };
}
async function clear() {
    const r = await depositAll(sdk);
    if (!r.ok) throw new Error(`clear failed: ${r.reason}`);
}

for (let i = 0; i < n; i++) {
    await stage(24);
    await sample(log, session, 'deposit 24 distinct (ours)', () => verified(depositAll(sdk), 0));
    await stage(24);
    await sample(log, session, 'deposit 24 distinct (stock)', () => verified(bot.depositItem(/./, -1), 0));
    await clear();

    await sample(log, session, 'withdraw 28 distinct (ours)', () => verified(withdrawMany(sdk, specs(28)), 28));
    await clear();
    await sample(log, session, 'withdraw 28 distinct (stock)', () => verified((async () => {
        // A bare number is a bank slot to withdrawItem; pass the bank item itself.
        for (const id of labIds.slice(0, 28)) await bot.withdrawItem(sdk.getState()!.bank.items.find(i => i.id === id)!, 1);
    })(), 28));
    await clear();

    await sample(log, session, 'withdraw 28 of one (ours)', () => verified(withdrawMany(sdk, [{ item: ore, n: 'fill' }]), 28));
    await clear();
    await sample(log, session, 'withdraw 28 of one (stock)', () => verified(bot.withdrawItem(sdk.getState()!.bank.items.find(i => i.id === ore)!, 28), 28));
    await clear();
}

console.log(formatReport(report(log.rows)));
console.log(`log: ${log.path}`);
await closeSession(session);
process.exit(0);
