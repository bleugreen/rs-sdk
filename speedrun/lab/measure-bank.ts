// Bank: ours vs stock, at the lab tick rate.
//   deposit 24 distinct stacks:  depositAll       vs bot.depositItem(/./, -1)
//   withdraw 28 distinct items:  withdrawMany     vs bot.withdrawItem loop
//   withdraw 28 of one item:     withdrawMany fill vs bot.withdrawItem(ore, 28)
// Ticks run from a fresh tick to the confirmed end state (bank already open).

import { depositAll, withdrawMany, type WithdrawSpec } from '../lib/bank';
import { closeSession, openSession } from '../lib/session';
import { formatReport, report } from '../lib/ticks';
import { arg, botArg, labLog, normName, sample } from './common';
import { bankFixture, LAB_ITEMS } from './setup';

const n = Number(arg('n', '3'));
const session = await openSession(botArg());
const { sdk, bot } = session;
const log = labLog('bank');

await bankFixture(session, { ironOre: 100 });
const wanted = new Set(LAB_ITEMS.map(normName));
const labIds = sdk.getState()!.bank.items.filter(i => wanted.has(normName(i.name))).map(i => i.id);
if (labIds.length < 28) throw new Error(`bank holds only ${labIds.length} lab items`);
const ore = sdk.getState()!.bank.items.find(i => i.name === 'Iron ore')!.id;
const specs = (k: number): WithdrawSpec[] => labIds.slice(0, k).map(id => ({ item: id, n: 1 }));

async function stage(k: number) {
    const r = await withdrawMany(sdk, specs(k));
    if (!r.ok || sdk.getState()!.inventory.length !== k) throw new Error(`staging ${k} items failed: ${JSON.stringify(r)}`);
}
async function clear() {
    const r = await depositAll(sdk);
    if (!r.ok) throw new Error(`clear failed: ${r.reason}`);
}

for (let i = 0; i < n; i++) {
    await stage(24);
    await sample(log, session, 'deposit 24 distinct (ours)', () => depositAll(sdk));
    await stage(24);
    await sample(log, session, 'deposit 24 distinct (stock)', () => bot.depositItem(/./, -1));
    await clear();

    await sample(log, session, 'withdraw 28 distinct (ours)', () => withdrawMany(sdk, specs(28)));
    await clear();
    await sample(log, session, 'withdraw 28 distinct (stock)', async () => {
        for (const id of labIds.slice(0, 28)) await bot.withdrawItem(id, 1);
    });
    await clear();

    await sample(log, session, 'withdraw 28 of one (ours)', () => withdrawMany(sdk, [{ item: ore, n: 'fill' }]));
    await clear();
    await sample(log, session, 'withdraw 28 of one (stock)', () => bot.withdrawItem(ore, 28));
    await clear();
}

console.log(formatReport(report(log.rows)));
console.log(`log: ${log.path}`);
await closeSession(session);
process.exit(0);
