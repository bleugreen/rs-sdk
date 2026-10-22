// Jug supplier (cairn://p/rs/47): buys empty jugs from a general store as it
// restocks, fills them at a fountain nearby, and banks jugs of water. Every store in
// JUG_STORES holds 2 jugs and restocks one per 100 ticks (stock2=jug_empty,2,100 in
// varrock.inv, falador.inv and lumbridge.inv), so one account tops out near 120 jugs
// an hour unless other players have sold jugs into its store. The shelf, not the
// walk, sets the rate: each store is its own supply, so give each account its own.
//
//   bun speedrun/helpers/jugs.ts <account>
//   ROLE_OPTIONS='{"target":600,"store":"falador"}' bun speedrun/helpers/jugs.ts <account>
//
// Options: store (a JUG_STORES key, default 'varrock'), target (stop once the bank
// holds this many jugs of water, default 600), batch (empty jugs to collect before
// a fill-and-bank trip, default 26). An account that starts in Al Kharid pays the
// toll on its way out.
// Coins: withdraws its bank's coins; when they run out it sells the tutorial
// starter gear to the store, then waits for a coin delivery (logs 'need coins').
import type { Role, RoleContext } from './role';
import { runStandalone } from './role';
import { isEastOfTollGate, travelTo, type Tile } from '../lib/toll-gate';
import { ITEM, checkAbort, closeBank, depositAllExcept, dismissDialogs, freeSlots, invCount, openBank, position, prepare, reportBank, walkNear } from './wine-common';

export interface JugStore {
    /** Beside the shop keeper. */
    shop: Tile;
    /** A fountain (category watersource: fills jugs; a well fills only buckets, water_sources.rs2). */
    water: Tile;
    /** The bank the trips use. */
    bank: Tile;
}

/** General stores that stock jugs, with the fountain and bank each one's trips use (fountain tiles from the server's maps). */
export const JUG_STORES = {
    varrock: { shop: { x: 3216, z: 3414 }, water: { x: 3238, z: 3434 }, bank: { x: 3253, z: 3420 } },
    falador: { shop: { x: 2957, z: 3386 }, water: { x: 2949, z: 3381 }, bank: { x: 2946, z: 3369 } },
    // Lumbridge castle's bank is upstairs, so the trips bank at Draynor.
    lumbridge: { shop: { x: 3211, z: 3246 }, water: { x: 3221, z: 3226 }, bank: { x: 3092, z: 3245 } }
} as const satisfies Record<string, JugStore>;

export type JugStoreName = keyof typeof JUG_STORES;

export interface JugsOptions {
    store: JugStoreName;
    target: number;
    batch: number;
}

export function jugsOptions(raw: Record<string, unknown>): JugsOptions {
    const store = raw.store ?? 'varrock';
    if (typeof store !== 'string' || !Object.hasOwn(JUG_STORES, store)) {
        throw new Error(`jugs: options.store must be one of ${Object.keys(JUG_STORES).join(', ')} (got ${JSON.stringify(store)})`);
    }
    return {
        store: store as JugStoreName,
        target: typeof raw.target === 'number' ? raw.target : 600,
        batch: typeof raw.batch === 'number' ? raw.batch : 26
    };
}

/** Walk near `t`, through the toll gate when it lies across the Al Kharid fence. */
async function go(ctx: RoleContext, t: Tile, tolerance: number): Promise<void> {
    if (isEastOfTollGate(position(ctx.sdk)) === isEastOfTollGate(t)) return walkNear(ctx, t.x, t.z, tolerance);
    const r = await travelTo(ctx.bot, ctx.sdk, t, { tolerance, log: ctx.log, signal: ctx.signal });
    if (!r.ok) throw new Error(`could not travel to ${t.x},${t.z}: ${r.reason}`);
}
/** Tutorial kit the store will buy; sold only when the jug fund is empty. */
const STARTER = /^(bronze (axe|pickaxe|dagger|sword|arrow)|wooden shield|shortbow|tinderbox|small fishing net|bucket|pot|(air|mind|water|earth|body) rune)$/i;

interface Stats {
    bought: number;
    filled: number;
    banked: number;
    startedAt: number;
}

async function bankTrip(ctx: RoleContext, s: Stats, store: JugStore): Promise<number> {
    const { bot, sdk } = ctx;
    await go(ctx, store.bank, 4);
    await openBank(ctx, store.bank);
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

async function fill(ctx: RoleContext, s: Stats, store: JugStore): Promise<void> {
    const { bot, sdk } = ctx;
    if (invCount(sdk, ITEM.jugEmpty) === 0) return;
    await go(ctx, store.water, 3);
    const fountain = (await sdk.scanNearbyLocs(8)).find(l => /^fountain$/i.test(l.name));
    if (!fountain) throw new Error(`no fountain near ${store.water.x},${store.water.z}`);
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
async function buy(ctx: RoleContext, s: Stats, batch: number, store: JugStore): Promise<void> {
    const { bot, sdk } = ctx;
    await go(ctx, store.shop, 4);
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
        const { store: storeName, target, batch } = jugsOptions(ctx.options);
        const store: JugStore = JUG_STORES[storeName];
        await prepare(ctx);
        ctx.log('start', { store: storeName, target, batch });
        const s: Stats = { bought: 0, filled: 0, banked: 0, startedAt: Date.now() };
        let errors = 0;
        let stock = 0;
        while (!ctx.signal.aborted) {
            try {
                await dismissDialogs(ctx.bot, ctx.sdk);
                if (ctx.sdk.getState()?.shop?.isOpen) await ctx.bot.closeShop();
                if (invCount(ctx.sdk, ITEM.jugWater) > 0 || invCount(ctx.sdk, ITEM.coins) === 0 || freeSlots(ctx.sdk) === 0) {
                    stock = await bankTrip(ctx, s, store);
                    if (stock >= target) {
                        ctx.log('target reached', { stock, target });
                        return;
                    }
                }
                const coinsBefore = invCount(ctx.sdk, ITEM.coins);
                await buy(ctx, s, batch, store);
                if (invCount(ctx.sdk, ITEM.jugEmpty) >= batch || freeSlots(ctx.sdk) === 0 || invCount(ctx.sdk, ITEM.coins) < 2) {
                    await fill(ctx, s, store);
                    if (invCount(ctx.sdk, ITEM.jugWater) > 0) stock = await bankTrip(ctx, s, store);
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
