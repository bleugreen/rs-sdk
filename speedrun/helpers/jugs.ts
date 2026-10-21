// Jug supplier (cairn://p/rs/47): buys empty jugs from the Varrock general store as it
// restocks, fills them at the fountain east of Varrock square, and banks jugs of
// water at Varrock east bank. The store holds 2 jugs and restocks one per 100 ticks
// (varrock.inv stock2=jug_empty,2,100), so one account tops out near 120 jugs an
// hour unless other players have sold jugs into the store.
//
//   bun speedrun/helpers/jugs.ts <account>
//   ROLE_OPTIONS='{"target":600}' bun speedrun/helpers/jugs.ts <account>
//
// Options: target (stop once the bank holds this many jugs of water, default 600),
// batch (empty jugs to collect before a fill-and-bank trip, default 26).
// Coins: withdraws its bank's coins; when they run out it sells the tutorial
// starter gear to the store, then waits for a coin delivery (logs 'need coins').
import type { Role, RoleContext } from './role';
import { runStandalone } from './role';
import { ITEM, checkAbort, closeBank, depositAllExcept, dismissDialogs, freeSlots, invCount, openBank, prepare, reportBank, walkNear } from './wine-common';

const STORE = { x: 3216, z: 3414 };
const FOUNTAIN = { x: 3238, z: 3434 };
const EAST_BANK = { x: 3253, z: 3420 };
/** Tutorial kit the store will buy; sold only when the jug fund is empty. */
const STARTER = /^(bronze (axe|pickaxe|dagger|sword|arrow)|wooden shield|shortbow|tinderbox|small fishing net|bucket|pot|(air|mind|water|earth|body) rune)$/i;

interface Stats {
    bought: number;
    filled: number;
    banked: number;
    startedAt: number;
}

async function bankTrip(ctx: RoleContext, s: Stats): Promise<number> {
    const { bot, sdk } = ctx;
    await walkNear(ctx, EAST_BANK.x, EAST_BANK.z, 4);
    await openBank(ctx, EAST_BANK);
    const water = invCount(sdk, ITEM.jugWater);
    await depositAllExcept(sdk, i => i.id === ITEM.coins || i.id === ITEM.jugEmpty);
    s.banked += water;
    const coinsInBank = sdk.getBankItems().find(i => i.id === ITEM.coins);
    if (coinsInBank) await bot.withdrawItem(coinsInBank, -1);
    let starter = 0;
    if (invCount(sdk, ITEM.coins) < 10) {
        for (const item of sdk.getBankItems().filter(i => STARTER.test(i.name))) {
            if (freeSlots(sdk) < 2) break;
            await bot.withdrawItem(item, item.count, { asNote: false });
            starter++;
        }
    }
    reportBank(ctx);
    const stock = sdk.getBankItems().find(i => i.id === ITEM.jugWater)?.count ?? 0;
    ctx.log('banked', { jugsOfWater: stock, coins: invCount(sdk, ITEM.coins), starterWithdrawn: starter, ...rates(s) });
    await closeBank(bot, sdk);
    return stock;
}

function rates(s: Stats): Record<string, number> {
    const h = (Date.now() - s.startedAt) / 3_600_000;
    return { bought: s.bought, filled: s.filled, banked: s.banked, hours: Number(h.toFixed(3)), jugsPerHour: h > 0 ? Math.round(s.filled / h) : 0 };
}

async function fill(ctx: RoleContext, s: Stats): Promise<void> {
    const { bot, sdk } = ctx;
    if (invCount(sdk, ITEM.jugEmpty) === 0) return;
    await walkNear(ctx, FOUNTAIN.x, FOUNTAIN.z, 3);
    const fountain = (await sdk.scanNearbyLocs(8)).find(l => /^fountain$/i.test(l.name));
    if (!fountain) throw new Error('no fountain near Varrock square');
    // The first use walks over; the rest are one packet per jug (fill_container_water, p_delay(0)).
    let stall = 0;
    let first = true;
    while (invCount(sdk, ITEM.jugEmpty) > 0 && stall < 3) {
        const before = invCount(sdk, ITEM.jugEmpty);
        const jug = sdk.getInventory().find(i => i.id === ITEM.jugEmpty)!;
        if (first || stall > 0) await bot.useItemOnLoc(jug, fountain);
        else await sdk.sendUseItemOnLoc(jug.slot, fountain.x, fountain.z, fountain.id);
        first = false;
        const ok = await sdk.waitForCondition(() => invCount(sdk, ITEM.jugEmpty) < before, 3_000).then(() => true, () => false);
        if (ok) {
            s.filled += before - invCount(sdk, ITEM.jugEmpty);
            stall = 0;
        } else stall++;
    }
}

async function sellStarter(ctx: RoleContext): Promise<void> {
    const { bot, sdk } = ctx;
    for (const item of sdk.getInventory().filter(i => STARTER.test(i.name))) {
        await bot.sellToShop(item, 'all');
    }
}

/** Stand at the store with the shop open, buying jugs as they restock, until `batch` empty jugs are held. */
async function buy(ctx: RoleContext, s: Stats, batch: number): Promise<void> {
    const { bot, sdk } = ctx;
    await walkNear(ctx, STORE.x, STORE.z, 4);
    const open = await bot.openShop(/shop keeper|shop assistant/i);
    if (!open.success) throw new Error(`openShop: ${open.message}`);
    if (invCount(sdk, ITEM.coins) < 5) await sellStarter(ctx);
    let waited = 0;
    while (invCount(sdk, ITEM.jugEmpty) < batch && freeSlots(sdk) > 0) {
        checkAbort(ctx);
        const shop = sdk.getState()?.shop;
        if (!shop?.isOpen) break;
        const jug = shop.shopItems.find(i => i.id === ITEM.jugEmpty);
        const coins = invCount(sdk, ITEM.coins);
        if (jug && jug.count > 0) {
            if (coins < jug.buyPrice) {
                ctx.log('need coins', { coins, price: jug.buyPrice });
                break;
            }
            const n = Math.min(jug.count, batch - invCount(sdk, ITEM.jugEmpty), freeSlots(sdk), Math.floor(coins / Math.max(1, jug.buyPrice)));
            const r = await bot.buyFromShop(jug, n);
            s.bought += r.amountBought ?? 0;
            waited = 0;
        } else {
            await sdk.waitForTicks(5);
            if (++waited % 60 === 0) ctx.log('waiting for restock', { held: invCount(sdk, ITEM.jugEmpty), ...rates(s) });
        }
    }
    await bot.closeShop();
}

export const role: Role = {
    name: 'jugs',
    produces: [/^jug of water$/i, /^jug$/i],
    async run(ctx) {
        await prepare(ctx);
        const target = typeof ctx.options.target === 'number' ? ctx.options.target : 600;
        const batch = typeof ctx.options.batch === 'number' ? ctx.options.batch : 26;
        const s: Stats = { bought: 0, filled: 0, banked: 0, startedAt: Date.now() };
        let errors = 0;
        let stock = 0;
        while (!ctx.signal.aborted) {
            try {
                await dismissDialogs(ctx.bot, ctx.sdk);
                if (ctx.sdk.getState()?.shop?.isOpen) await ctx.bot.closeShop();
                if (invCount(ctx.sdk, ITEM.jugWater) > 0 || invCount(ctx.sdk, ITEM.coins) === 0 || freeSlots(ctx.sdk) === 0) {
                    stock = await bankTrip(ctx, s);
                    if (stock >= target) {
                        ctx.log('target reached', { stock, target });
                        return;
                    }
                }
                const coinsBefore = invCount(ctx.sdk, ITEM.coins);
                await buy(ctx, s, batch);
                if (invCount(ctx.sdk, ITEM.jugEmpty) >= batch || freeSlots(ctx.sdk) === 0 || invCount(ctx.sdk, ITEM.coins) < 2) {
                    await fill(ctx, s);
                    if (invCount(ctx.sdk, ITEM.jugWater) > 0) stock = await bankTrip(ctx, s);
                }
                if (invCount(ctx.sdk, ITEM.coins) < 2 && coinsBefore < 2 && invCount(ctx.sdk, ITEM.jugEmpty) === 0) {
                    ctx.log('need coins: waiting for a delivery', { stock });
                    await ctx.sdk.waitForTicks(200);
                }
                errors = 0;
            } catch (e) {
                if (ctx.signal.aborted) break;
                errors++;
                ctx.log('cycle error', { error: String(e), errors });
                await ctx.sdk.waitForTicks(Math.min(60, 5 * errors)).catch(() => {});
            }
        }
        ctx.log('stopped', rates(s));
    }
};

if (import.meta.main) await runStandalone(role);
