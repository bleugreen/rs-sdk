// Lab probe for the item-count edges a bulk generator would need (rs/499, docs/markets/generator-content-shops.md):
//   A  bank withdraw-X with X far above the banked count, unnoted and noted
//   B  deposit into a bank stack already at 2^31-1, then withdraw-all into a held stack
//   C  shop round trip at the Varrock general store: sell one then buy it back, and buy one then sell it back
// Each probe prints bank, inventory and nearby-ground counts and the bank board value
// (sum of ObjType.cost * count, LoginServer.ts updateHiscores) before and after, and fails
// if any item or coin appears that was not there before.
//
//   speedrun/lab/lab.sh <bot> markets/research/content-edges.ts
//
// Lab-only: uses staff cheats (::give, ::tele). Never run against the demo server.

import { readFileSync } from 'node:fs';

import type { BotWorldState } from '../../sdk/types';
import { depositAll } from '../../speedrun/lib/bank';
import { closeSession, openSession } from '../../speedrun/lib/session';
import { waitTicks, waitUntil } from '../../speedrun/lib/wait';
import { botArg, result } from '../../speedrun/lab/common';
import { cheat, clearInventory, leaveTutorial, mustTele, VARROCK_WEST_BANK } from '../../speedrun/lab/setup';

const MAX = 0x7fffffff;
const VARROCK_GENERAL_STORE = { x: 3217, z: 3415 };

// ---- board value: ObjType.cost by id, with a cert costing what its linked item costs (ObjType.toCertificate)
function loadCosts(): Map<number, number> {
    const idOf = new Map<string, number>();
    for (const line of readFileSync('server/content/pack/obj.pack', 'utf8').split('\n')) {
        const m = /^(\d+)=(\w+)/.exec(line);
        if (m) idOf.set(m[2]!, Number(m[1]));
    }
    // Older unpacked revisions first, the current one next, hand-written configs last, so later wins.
    const files = [...new Bun.Glob('**/*.obj').scanSync('server/content/scripts')].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    function rank(f: string): number {
        const m = /^_unpack\/(\d+)\//.exec(f);
        return m ? Number(m[1]) : 10_000;
    }
    const costOf = new Map<string, number>();
    for (const f of files) {
        let cur: string | null = null;
        for (const raw of readFileSync(`server/content/scripts/${f}`, 'utf8').split('\n')) {
            const line = raw.trim();
            const head = /^\[(\w+)\]$/.exec(line);
            if (head) { cur = head[1]!; continue; }
            const c = /^cost=(\d+)$/.exec(line);
            if (cur && c) costOf.set(cur, Number(c[1]));
        }
    }
    const byId = new Map<number, number>();
    for (const [name, id] of idOf) {
        const base = name.startsWith('cert_') ? name.slice(5) : name;
        byId.set(id, costOf.get(name) ?? costOf.get(base) ?? 1);
    }
    return byId;
}
const costs = loadCosts();

type Snap = { bank: Record<string, number>; inv: Record<string, number>; ground: Record<string, number>; boardValue: number };
function snap(s: BotWorldState | null): Snap {
    const add = (o: Record<string, number>, k: string, n: number) => { o[k] = (o[k] ?? 0) + n; };
    const bank: Record<string, number> = {}, inv: Record<string, number> = {}, ground: Record<string, number> = {};
    let boardValue = 0;
    for (const i of s?.bank.items ?? []) { add(bank, i.name, i.count); boardValue += (costs.get(i.id) ?? 1) * i.count; }
    for (const i of s?.inventory ?? []) add(inv, i.name, i.count);
    for (const g of s?.groundItems ?? []) if (g.distance <= 3) add(ground, g.name, g.count);
    return { bank, inv, ground, boardValue };
}
const total = (x: Snap, name: string) => (x.bank[name] ?? 0) + (x.inv[name] ?? 0) + (x.ground[name] ?? 0);

const session = await openSession(botArg());
const { sdk, bot } = session;
const failures: string[] = [];
function expect(probe: string, ok: boolean, detail: unknown) {
    result(probe, { ok, ...(detail as object) });
    if (!ok) failures.push(probe);
}

async function openBankHere(): Promise<void> {
    const r = await bot.openBank();
    if (!r.success) throw new Error(`openBank: ${r.message}`);
}
async function setNoteMode(on: boolean): Promise<void> {
    if (sdk.getState()!.bank.noteMode === on) return;
    await sdk.sendClickComponent(on ? 5386 : 5387); // bank_main:com_93 (note) / com_94 (item), as sdk/actions.ts withdrawItem
    await waitUntil(sdk, s => s.bank.noteMode === on, { maxTicks: 10 });
}
function bankSlot(name: string) {
    return sdk.getState()!.bank.items.find(i => i.name === name);
}

await leaveTutorial(session);
await mustTele(sdk, VARROCK_WEST_BANK.x, VARROCK_WEST_BANK.z);
await openBankHere();
await depositAll(sdk);

// ---- A: withdraw-X far above the banked count (bank.rs2 bank_withdraw clamps to inv_total; InvOps INV_MOVEITEM_CERT
// would drop count - completed on the floor if a caller ever passed more than was held)
for (const noted of [false, true]) {
    const probe = `A withdraw-X above held (${noted ? 'noted' : 'unnoted'})`;
    await cheat(sdk, 'give cert_iron_ore 100', 3);
    await depositAll(sdk);
    await setNoteMode(noted);
    const before = snap(sdk.getState());
    const ore = bankSlot('Iron ore');
    if (!ore) throw new Error('no iron ore in bank');
    const ask = ore.count + 1_000_000;
    await sdk.sendBankWithdraw(ore.slot, ask);
    await waitTicks(sdk, 4);
    const after = snap(sdk.getState());
    const held = after.inv['Iron ore'] ?? 0;
    expect(probe, total(after, 'Iron ore') === total(before, 'Iron ore') && held > 0 && after.boardValue <= before.boardValue, {
        asked: ask, bankBefore: before.bank['Iron ore'] ?? 0, bankAfter: after.bank['Iron ore'] ?? 0, invAfter: held,
        groundBefore: before.ground['Iron ore'] ?? 0, groundAfter: after.ground['Iron ore'] ?? 0,
        boardBefore: before.boardValue, boardAfter: after.boardValue,
    });
    await setNoteMode(false);
    await depositAll(sdk);
}

// ---- B: full stacks. Bank coins at exactly 2^31-1, then deposit 1000 more (bank_deposit_request refuses), then
// withdraw-all while 1000 coins are held (bank_withdraw_request takes inv_itemspace2's overflow off the amount).
{
    const probe = 'B full-stack deposit and withdraw';
    await clearInventory(sdk);
    await openBankHere();
    const bankCoins0 = bankSlot('Coins')?.count ?? 0;
    if (bankCoins0 < MAX) {
        // Top the bank up to exactly 2^31-1 from an inventory holding no coins, so nothing is capped on the way.
        await cheat(sdk, `give coins ${MAX - bankCoins0}`, 3);
        await depositAll(sdk);
    }
    if ((bankSlot('Coins')?.count ?? 0) !== MAX) throw new Error(`bank coins ${bankSlot('Coins')?.count}, expected ${MAX}`);
    await cheat(sdk, 'give coins 1000', 3);
    const before = snap(sdk.getState());
    const coinsInv = sdk.getState()!.inventory.find(i => i.name === 'Coins');
    if (coinsInv) await sdk.sendBankDeposit(coinsInv.slot, -1);
    await waitTicks(sdk, 3);
    const mid = snap(sdk.getState());
    const bankCoins = bankSlot('Coins');
    if (bankCoins) await sdk.sendBankWithdraw(bankCoins.slot, -1);
    await waitTicks(sdk, 3);
    const after = snap(sdk.getState());
    const msgs = (sdk.getState()?.gameMessages ?? []).slice(-6).map(m => m.text);
    const conserved = total(mid, 'Coins') === total(before, 'Coins') && total(after, 'Coins') === total(before, 'Coins');
    const noWrap = Object.values({ ...after.bank, ...after.inv }).every(n => n >= 0 && n <= MAX);
    expect(probe, conserved && noWrap && after.boardValue <= before.boardValue, {
        before: { bank: before.bank['Coins'], inv: before.inv['Coins'], ground: before.ground['Coins'] ?? 0 },
        afterDeposit: { bank: mid.bank['Coins'], inv: mid.inv['Coins'], ground: mid.ground['Coins'] ?? 0 },
        afterWithdrawAll: { bank: after.bank['Coins'] ?? 0, inv: after.inv['Coins'], ground: after.ground['Coins'] ?? 0 },
        boardBefore: before.boardValue, boardAfter: after.boardValue, lastMessages: msgs,
    });
}

// ---- C: shop round trips (shop.rs2 sell_item / buy_item with ~calc_shop_value)
{
    await bot.closeBank();
    await clearInventory(sdk);
    await mustTele(sdk, VARROCK_GENERAL_STORE.x, VARROCK_GENERAL_STORE.z);
    const opened = await bot.openShop(/shop keeper/i);
    if (!opened.success) throw new Error(`openShop: ${opened.message}`);
    await waitUntil(sdk, s => s.shop.isOpen, { maxTicks: 20 });
    await cheat(sdk, 'give coins 10000', 2);
    await cheat(sdk, 'give iron_bar 1', 3);
    const coins = () => sdk.getState()!.inventory.filter(i => i.name === 'Coins').reduce((a, i) => a + i.count, 0);

    for (const [label, itemName, first] of [['sell then buy back', 'Iron bar', 'sell'], ['buy then sell back', 'Pot', 'buy']] as const) {
        const probe = `C shop ${label} (${itemName})`;
        const c0 = coins();
        const has0 = sdk.getState()!.inventory.filter(i => i.name === itemName).length;
        const doSell = async () => {
            const it = sdk.getState()!.shop.playerItems.find(i => i.name === itemName);
            if (it) await sdk.sendShopSell(it.slot, 1);
            await waitTicks(sdk, 2);
        };
        const doBuy = async () => {
            const it = sdk.getState()!.shop.shopItems.find(i => i.name === itemName);
            if (it) await sdk.sendShopBuy(it.slot, 1);
            await waitTicks(sdk, 2);
        };
        if (first === 'sell') { await doSell(); await doBuy(); } else { await doBuy(); await doSell(); }
        const c1 = coins();
        const has1 = sdk.getState()!.inventory.filter(i => i.name === itemName).length;
        expect(probe, c1 <= c0 && has1 === has0, { coinsBefore: c0, coinsAfter: c1, net: c1 - c0, heldBefore: has0, heldAfter: has1 });
    }

    // Selling into a coin stack already at 2^31-1: shop.rs2 sell_item calls inv_add(coins) after the item has
    // moved, and Inventory.add caps the stack, so the proceeds are lost. A loss to the seller, never a gain.
    {
        await cheat(sdk, `give coins ${MAX}`, 2);
        await cheat(sdk, 'give iron_bar 1', 3);
        const c0 = coins();
        const it = sdk.getState()!.shop.playerItems.find(i => i.name === 'Iron bar');
        if (it) await sdk.sendShopSell(it.slot, 1);
        await waitTicks(sdk, 2);
        const sold = !sdk.getState()!.inventory.some(i => i.name === 'Iron bar');
        expect('C shop sell into a full coin stack (informational)', coins() <= MAX, { coinsBefore: c0, coinsAfter: coins(), itemGone: sold });
    }
    await sdk.sendCloseShop();
}

result('content-edges summary', { failures });
await closeSession(session);
process.exit(failures.length ? 1 : 0);
