// Buyer: executes a shopping list at the Grand Exchange and at NPC shops, then
// banks what it bought and reports.
//
//   ROLE_OPTIONS='{"list":[{"item":"Feather","quantity":200,"source":"shop","shop":"gerrant","maxPrice":6},
//                          {"item":"Shark","quantity":5,"source":"ge","maxPrice":500}]}' \
//     bun speedrun/helpers/buyer.ts <account>
//
// Quantities are TARGETS for what the account holds (bank + inventory), not
// amounts to add, so a restart or a second run buys only the shortfall.
// Coins come from the account's own bank (it withdraws what the list needs).
//
// Grand Exchange lines buy at the current ask (the lowest open sell offer),
// never above `maxPrice`. If there is no ask, or the ask is above `maxPrice`,
// a resting bid at `maxPrice` is left open (it fills while we are offline and
// a later run collects it); without a `maxPrice` the line is skipped. An offer
// for more than the ask's depth fills what it can and leaves the rest resting
// at the ask price, so the buyer never chases the book upwards.
//
// Shop lines buy in steps of at most 10 and re-read the live price before each
// step: a shop's price rises by 1% of the item's base cost for every unit its
// stock is below the configured level (shop.rs2 calc_shop_value, shop_delta
// 10), up to 6x base. A step is bought only while the price is at most
// `maxPrice` (default 3x the item's base cost). When stock is gone or too
// dear, the buyer waits with the shop open for restocks (one unit per
// `stockrate` ticks per line, World.ts) up to `maxWaitTicks`, then moves on.
import type { BotActions } from '../../sdk/actions';
import type { BotSDK } from '../../sdk/index';
import type { BotWorldState } from '../../sdk/types';
import { besideGateWest, crossTollGate, inAlKharid, isEastOfTollGate, TOLL_GP, WEST_OF_GATE } from '../lib/toll-gate';
import { pointMarketAtServer } from './mule';
import { runStandalone, type Role, type RoleContext } from './role';

export interface Tile {
    x: number;
    z: number;
}

export interface ShopSpec {
    /** NPC that offers Trade. */
    npc: RegExp;
    /** A tile next to the shopkeeper (walkTo target). */
    stand: Tile;
    /** Nearest bank booth area, for non-stackable purchases and the final deposit. */
    bank: Tile;
    /** Underground shops: where the way down is on the surface, and the ladder back up below. */
    below?: Below;
}

export interface Below {
    /** Surface tile beside the trapdoor or ladder that leads down. */
    down: Tile;
    /** Underground tile beside the ladder that leads back up. */
    up: Tile;
}

export const BANKS = {
    varrockWest: { x: 3185, z: 3438 },
    varrockEast: { x: 3253, z: 3421 },
    draynor: { x: 3092, z: 3245 },
    alKharid: { x: 3270, z: 3167 },
    faladorWest: { x: 2946, z: 3369 },
    faladorEast: { x: 3013, z: 3357 },
    edgeville: { x: 3093, z: 3491 },
    catherby: { x: 2809, z: 3439 },
    seers: { x: 2725, z: 3491 }
} satisfies Record<string, Tile>;

/**
 * Shops the buyer knows how to reach. Prices and stock: docs/speedrun/helpers/market.md;
 * stands are the shopkeepers' spawns in wiki/shops/*.md.
 */
export const SHOPS: Record<string, ShopSpec> = {
    aubury: { npc: /^aubury$/i, stand: { x: 3253, z: 3401 }, bank: BANKS.varrockEast },
    gerrant: { npc: /^gerrant$/i, stand: { x: 3014, z: 3224 }, bank: BANKS.draynor },
    betty: { npc: /^betty$/i, stand: { x: 3013, z: 3258 }, bank: BANKS.draynor },
    lumbridgeGeneral: { npc: /^shop (keeper|assistant)$/i, stand: { x: 3211, z: 3246 }, bank: BANKS.draynor },
    varrockGeneral: { npc: /^shop (keeper|assistant)$/i, stand: { x: 3217, z: 3413 }, bank: BANKS.varrockWest },
    zeke: { npc: /^zeke$/i, stand: { x: 3287, z: 3188 }, bank: BANKS.alKharid },
    /** Rune pickaxe, stock 1. North Dwarven Mine, by the Ice Mountain trapdoor: the south entrance lands among aggressive scorpions. */
    nurmof: { npc: /^nurmof$/i, stand: { x: 2998, z: 9846 }, bank: BANKS.faladorEast, below: { down: { x: 3019, z: 3449 }, up: { x: 3019, z: 9849 } } },
    /** Adamant chainbody, stock 1. */
    wayne: { npc: /^wayne$/i, stand: { x: 2973, z: 3312 }, bank: BANKS.faladorEast },
    /** Adamant full helm, stock 1 (Barbarian Village). */
    peksa: { npc: /^peksa$/i, stand: { x: 3076, z: 3429 }, bank: BANKS.edgeville },
    /** Knife, stock 10; outside the pass gate, so no Shantay pass is needed. */
    shantay: { npc: /^shantay$/i, stand: { x: 3304, z: 3123 }, bank: BANKS.alKharid },
    /** Adamant platelegs, stock 1. */
    louie: { npc: /^louie legs$/i, stand: { x: 3316, z: 3175 }, bank: BANKS.alKharid },
    lowe: { npc: /^lowe$/i, stand: { x: 3231, z: 3423 }, bank: BANKS.varrockEast },
    // Kandarin, past White Wolf Mountain (speedrun/lib/kandarin.ts). Dargaud is inside the
    // Ranging Guild, whose door needs Ranged 40 and which walkTo cannot path
    // through: fletcher.ts enters and leaves it before using this entry.
    hickton: { npc: /^hickton$/i, stand: { x: 2821, z: 3442 }, bank: BANKS.catherby },
    dargaud: { npc: /^bow and arrow salesman$/i, stand: { x: 2672, z: 3434 }, bank: BANKS.seers }
};

/** Underground maps sit 6,400 tiles north of the surface they belong to. */
export const isUnderground = (t: Tile): boolean => t.z > 6400;

export type Leg = 'climb-up' | 'toll-east' | 'toll-west' | 'climb-down' | 'walk';

/**
 * What a trip from `from` to `to` has to do besides walking, in order: leave the
 * underground, cross the Al Kharid toll gate (pathfinding cannot pay it), go down.
 * Underground tiles count as west of the gate.
 */
export function travelPlan(from: Tile, to: Tile): Leg[] {
    const legs: Leg[] = [];
    if (isUnderground(from) && !isUnderground(to)) legs.push('climb-up');
    const fromEast = isEastOfTollGate(from);
    const toEast = isEastOfTollGate(to);
    if (fromEast !== toEast) legs.push(toEast ? 'toll-east' : 'toll-west');
    if (!isUnderground(from) && isUnderground(to)) legs.push('climb-down');
    legs.push('walk');
    return legs;
}

export interface ListLine {
    /** Item name as the game spells it ("Feather", "Cosmic rune") or its id. */
    item: string | number;
    quantity: number;
    maxPrice?: number;
    source: 'ge' | 'shop';
    /** Key of SHOPS, for shop lines. */
    shop?: string;
    /** Shop lines: ticks to wait for restocks when stock is gone or above maxPrice (default 300). */
    maxWaitTicks?: number;
}

export interface LineReport {
    item: string;
    source: string;
    target: number;
    heldBefore: number;
    bought: number;
    spent: number;
    /** GE only: an offer left resting for the remainder. */
    restingOffer?: { id: number; price: number; remaining: number };
    note?: string;
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const coinsIn = (s: BotWorldState) => s.inventory.filter(i => i.name === 'Coins').reduce((a, i) => a + i.count, 0);
const inTutorial = (s: BotWorldState) => s.player!.worldX >= 3050 && s.player!.worldX <= 3160 && s.player!.worldZ >= 3050 && s.player!.worldZ <= 3140;
/** Inventory count of an item including its banknote form. */
const heldInInventory = (s: BotWorldState, name: string) => s.inventory.filter(i => sameName(i.name, name)).reduce((a, i) => a + i.count, 0);

async function waitTicks(sdk: BotSDK, n: number): Promise<BotWorldState> {
    for (let i = 0; i < n; i++) await sdk.waitForStateUpdate();
    return sdk.getState()!;
}

export class Buyer {
    private readonly bot: BotActions;
    private readonly sdk: BotSDK;
    private bankCounts = new Map<string, number>();
    /** The way down last taken, so the walk back knows which ladder leads up. */
    private below: Below | null = null;
    /** Per shop and item, the last measured price of the next unit and the shelf count it was measured at (buyAtShop). */
    private readonly shopPrices = new Map<string, { unitPrice: number; priceAtCount: number }>();
    readonly reports: LineReport[] = [];

    constructor(private readonly ctx: RoleContext) {
        this.bot = ctx.bot;
        this.sdk = ctx.sdk;
        // The SDK derives market and GE-availability URLs from the gateway; behind a
        // loopback gateway that is wrong, so point it at the game server (SERVER).
        pointMarketAtServer(this.sdk);
    }

    private get state(): BotWorldState {
        const s = this.sdk.getState();
        if (!s?.player) throw new Error('no game state');
        return s;
    }

    private get here(): Tile {
        const p = this.state.player!;
        return { x: p.worldX, z: p.worldZ };
    }

    /** Walk to `t`, climbing and paying the toll gate on the way as travelPlan says. `below` is needed to go underground. */
    async walk(t: Tile, below?: Below): Promise<boolean> {
        for (const leg of travelPlan(this.here, t)) {
            if (this.ctx.signal.aborted) return false;
            if (leg === 'climb-up' && !(await this.climbOut())) return false;
            if (leg === 'toll-east' || leg === 'toll-west') {
                const r = await crossTollGate(this.bot, this.sdk, leg === 'toll-east', this.ctx.log);
                if (!r.ok) return false;
            }
            if (leg === 'climb-down') {
                if (!below) {
                    this.ctx.log('walk: no way down known', { to: t });
                    return false;
                }
                if (!(await this.climbDown(below))) return false;
            }
        }
        if (besideGateWest(this.here) && !isEastOfTollGate(t) && !besideGateWest(t)) await this.walkHere(WEST_OF_GATE);
        return this.walkHere(t);
    }

    /** Use the nearest loc named `name` with an option matching `option`, until `arrived` holds. */
    private async useLoc(name: RegExp, option: RegExp, near: Tile, arrived: () => boolean): Promise<boolean> {
        for (let attempt = 0; attempt < 4 && !arrived() && !this.ctx.signal.aborted; attempt++) {
            const loc = this.state.nearbyLocs
                .filter(l => name.test(l.name) && l.optionsWithIndex.some(o => option.test(o.text) || /^open$/i.test(o.text)))
                .sort((a, b) => Math.hypot(a.x - near.x, a.z - near.z) - Math.hypot(b.x - near.x, b.z - near.z))[0];
            if (!loc) {
                this.ctx.log('loc not in view', { name: String(name), at: this.here });
                await waitTicks(this.sdk, 2);
                continue;
            }
            // A closed trapdoor offers only Open; the next attempt climbs.
            const op = loc.optionsWithIndex.find(o => option.test(o.text)) ?? loc.optionsWithIndex.find(o => /^open$/i.test(o.text))!;
            await this.bot.interactLoc(loc, op.text);
            await this.sdk.waitForCondition(() => arrived(), 10_000).catch(() => undefined);
            await waitTicks(this.sdk, 1);
        }
        return arrived();
    }

    private async climbDown(below: Below): Promise<boolean> {
        if (!(await this.walkHere(below.down))) return false;
        const ok = await this.useLoc(/trapdoor|ladder|stair/i, /climb-down|climb down/i, below.down, () => isUnderground(this.here));
        if (ok) this.below = below;
        return ok;
    }

    private async climbOut(): Promise<boolean> {
        const up = this.below?.up;
        if (up && Math.max(Math.abs(this.here.x - up.x), Math.abs(this.here.z - up.z)) > 4) await this.walkHere(up);
        return this.useLoc(/ladder|stair/i, /climb-up|climb up/i, up ?? this.here, () => !isUnderground(this.here));
    }

    /** Plain pathfinding with retries; no ladders or toll gate. */
    private async walkHere(t: Tile): Promise<boolean> {
        for (let i = 0; i < 5 && !this.ctx.signal.aborted; i++) {
            const r = await this.bot.walkTo(t.x, t.z, 2);
            const p = this.state.player!;
            if (r.success || Math.max(Math.abs(p.worldX - t.x), Math.abs(p.worldZ - t.z)) <= 3) return true;
            this.ctx.log('walk retry', { to: t, message: r.message });
            await waitTicks(this.sdk, 2);
        }
        return false;
    }

    /** Open the bank at `at`, run `body` with it open, report the bank, close it. */
    async atBank<T>(at: Tile, body: () => Promise<T>): Promise<T> {
        // openBank opens the NEAREST bank, so a failed walk (an unpaid toll gate)
        // would otherwise silently bank on the wrong side.
        if (!(await this.walk(at))) throw new Error(`bank: could not reach (${at.x}, ${at.z}) from (${this.here.x}, ${this.here.z})`);
        const opened = await this.bot.openBank();
        if (!opened.success) throw new Error(`bank: ${opened.message}`);
        await this.sdk.waitForCondition(s => s.bank?.isOpen === true, 5000).catch(() => undefined);
        try {
            return await body();
        } finally {
            const items = this.sdk.getBankItems();
            this.bankCounts = new Map(items.map(i => [i.name.toLowerCase(), i.count]));
            this.ctx.reportBank({ items: items.map(i => ({ id: i.id, name: i.name, count: i.count })) });
            await this.bot.closeBank();
        }
    }

    /** Deposit every inventory stack except `keep` (names, case-insensitive). */
    async depositAllBut(keep: string[] = []): Promise<void> {
        const seen = new Set<string>();
        for (const it of this.state.inventory) {
            if (keep.some(k => sameName(k, it.name)) || seen.has(it.name)) continue;
            seen.add(it.name);
            await this.bot.depositItem(it.name, -1);
        }
    }

    /** Make the inventory hold exactly `want` coins (bank must be open). */
    async setCoins(want: number): Promise<number> {
        const have = coinsIn(this.state);
        if (have > want) await this.bot.depositItem(/^coins$/i, have - want);
        else if (have < want) {
            const inBank = this.sdk.getBankItems().find(i => i.name === 'Coins')?.count ?? 0;
            const take = Math.min(want - have, inBank);
            if (take > 0) await this.bot.withdrawItem(/^coins$/i, take);
        }
        return coinsIn(this.state);
    }

    held(name: string): number {
        return (this.bankCounts.get(name.toLowerCase()) ?? 0) + heldInInventory(this.state, name);
    }

    async resolveItem(item: string | number): Promise<{ id: number; name: string }> {
        if (typeof item === 'number') {
            const q = await this.sdk.getMarketItem(item);
            return { id: q.id, name: q.name };
        }
        const found = await this.sdk.getMarketItems(item, { limit: 25 });
        const exact = found.items.find(i => sameName(i.name, item));
        if (!exact) throw new Error(`unknown item ${item}`);
        return { id: exact.id, name: exact.name };
    }

    /** Wait for the player, leave the tutorial, and come out of Al-Kharid: every run starts here. */
    async prepare(): Promise<void> {
        await this.sdk.waitForCondition(s => (s.player?.worldX ?? 0) > 0, 60_000);
        if (inTutorial(this.state)) {
            const r = await this.bot.skipTutorial();
            this.ctx.log('tutorial', { success: r.success, result: r.message });
            await waitTicks(this.sdk, 3);
        }
        if (!inAlKharid(this.state)) return;
        // A run that ended in Al Kharid banked every coin there: take the toll first.
        if (coinsIn(this.state) < TOLL_GP) await this.atBank(BANKS.alKharid, () => this.setCoins(TOLL_GP));
        await crossTollGate(this.bot, this.sdk, false, this.ctx.log);
    }

    // ------------------------------------------------------------ Grand Exchange

    /**
     * Collect every claim waiting at the open exchange (fills as notes, refunds as
     * coins) into the inventory. Skipped when nothing is waiting. Returns what came in.
     */
    async collectFills(): Promise<{ items: number; coins: number }> {
        const waiting = this.sdk.getGEState()?.offers.filter(o => o.items > 0 || o.coins > 0) ?? [];
        if (waiting.length === 0) return { items: 0, coins: 0 };
        const r = await this.bot.collectGE();
        this.ctx.log('ge collect', { success: r.success, items: r.items ?? 0, coins: r.coins ?? 0, result: r.message });
        await waitTicks(this.sdk, 2);
        return { items: r.items ?? 0, coins: r.coins ?? 0 };
    }

    /** Buy toward `line.quantity` at the Varrock west Grand Exchange; coins must be carried. */
    async buyAtGE(line: ListLine, waitTicksForFill = 20): Promise<LineReport> {
        const { id, name } = await this.resolveItem(line.item);
        const report: LineReport = { item: name, source: 'ge', target: line.quantity, heldBefore: this.held(name), bought: 0, spent: 0 };
        // openGE walks with plain pathfinding, which cannot pay the toll gate or climb.
        if (travelPlan(this.here, BANKS.varrockWest).length > 1 && !(await this.walk(BANKS.varrockWest))) {
            return { ...report, note: `could not reach the Grand Exchange from (${this.here.x}, ${this.here.z})` };
        }
        const opened = await this.bot.openGE();
        if (!opened.success) return { ...report, note: `openGE: ${opened.message}` };
        // Collect before counting: an earlier offer that filled while we were away
        // sits in the exchange, not the inventory, and must count toward the target,
        // or a rerun buys the same quantity again.
        await this.collectFills();
        const heldBefore = this.held(name);
        report.heldBefore = heldBefore;
        const need = line.quantity - heldBefore;
        if (need <= 0) {
            await this.bot.closeInterface();
            return { ...report, note: 'already held' };
        }

        // An earlier run's resting offer for this item counts toward the target.
        const existing = this.sdk.getGEState()?.offers.find(o => o.item === id && o.side === 'buy' && o.state === 'open');
        const coinsBefore = coinsIn(this.state);

        if (!existing) {
            const quote = await this.sdk.getMarketItem(id);
            const cap = line.maxPrice ?? Infinity;
            let price: number;
            if (quote.ask !== null && quote.ask <= cap) price = quote.ask;
            else if (line.maxPrice !== undefined) price = line.maxPrice;
            else return { ...report, note: quote.ask === null ? 'no sellers and no maxPrice' : `ask ${quote.ask} above maxPrice` };
            const affordable = Math.floor(coinsBefore / price);
            const quantity = Math.min(need, affordable);
            if (quantity <= 0) return { ...report, note: `cannot afford at ${price}` };
            const placed = await this.bot.placeGEOffer({ item: id, side: 'buy', quantity, price });
            this.ctx.log('ge offer', { item: name, quantity, price, ask: quote.ask, askDepth: quote.sellQuantity, success: placed.success, message: placed.message });
            if (!placed.success) return { ...report, note: `place: ${placed.reason ?? ''} ${placed.message}` };
        }

        // Fills against an existing ask are immediate; give partial fills a moment.
        for (let i = 0; i < waitTicksForFill; i++) {
            const o = this.sdk.getGEState()?.offers.find(x => x.item === id && x.side === 'buy');
            if (!o || o.state !== 'open' || o.remaining === 0) break;
            await waitTicks(this.sdk, 1);
        }
        await this.collectFills();
        const offer = this.sdk.getGEState()?.offers.find(x => x.item === id && x.side === 'buy' && x.state === 'open');
        if (offer) report.restingOffer = { id: offer.id, price: offer.price, remaining: offer.remaining };
        report.bought = this.held(name) - heldBefore;
        // Coins still in escrow for an offer placed now are committed, not spent
        // (an earlier run's offer was paid for before coinsBefore was measured).
        report.spent = coinsBefore - coinsIn(this.state) - (offer && !existing ? offer.remaining * offer.price : 0);
        await this.bot.closeInterface();
        return report;
    }

    // ------------------------------------------------------------ shops

    /** Buy toward `line.quantity` from an NPC shop; coins must be carried. */
    async buyAtShop(line: ListLine, maxWaitTicks = line.maxWaitTicks ?? 300): Promise<LineReport> {
        const shop = line.shop ? SHOPS[line.shop] : undefined;
        const name = typeof line.item === 'string' ? line.item : (await this.resolveItem(line.item)).name;
        const heldBefore = this.held(name);
        const report: LineReport = { item: name, source: `shop:${line.shop}`, target: line.quantity, heldBefore, bought: 0, spent: 0 };
        if (!shop) return { ...report, note: `unknown shop ${line.shop}` };
        if (line.quantity - heldBefore <= 0) return { ...report, note: 'already held' };

        const coinsAtStart = coinsIn(this.state);
        let waited = 0;
        // The live price is only knowable by paying it: ShopItem.buyPrice is the
        // price at the shop's CONFIGURED stock (StateCollector computes it with a
        // stock difference of 0), and a drained shop charges up to 6x that. So
        // probe with one unit, then track the price from what each step costs.
        // The measurement outlives the call, so a caller that waits on a restocking
        // shop in several calls probes once instead of paying blind each time.
        const priceKey = `${line.shop}:${name.toLowerCase()}`;
        const known = this.shopPrices.get(priceKey);
        let unitPrice: number | null = known?.unitPrice ?? null;
        /** Shelf count when unitPrice was measured; each unit restocked since lowers the price by `rise`. */
        let priceAtCount = known?.priceAtCount ?? 0;
        while (!this.ctx.signal.aborted) {
            const remaining = line.quantity - this.held(name);
            if (remaining <= 0) break;
            if (!this.state.shop.isOpen) {
                await this.walk(shop.stand, shop.below);
                const opened = await this.bot.openShop(shop.npc);
                if (!opened.success) {
                    report.note = `openShop: ${opened.message}`;
                    break;
                }
            }
            const item = this.state.shop.shopItems.find(i => sameName(i.name, name));
            if (!item) {
                report.note = 'not sold here';
                break;
            }
            const cap = line.maxPrice ?? item.baseCost * 3;
            // Each unit bought below the configured stock adds haggle/1000 of base.
            const rise = (item.baseCost * (this.state.shop.shopConfig?.haggle ?? 10)) / 1000;
            const predicted = unitPrice === null ? null : unitPrice - rise * (item.count - priceAtCount);
            if (item.count <= 0 || (predicted !== null && predicted > cap)) {
                if (waited >= maxWaitTicks) {
                    report.note = item.count <= 0 ? 'out of stock' : `price ~${predicted?.toFixed(1)} above ${cap}`;
                    break;
                }
                // Wait for restocks (one unit per stockrate ticks) to bring the price down.
                await waitTicks(this.sdk, 10);
                waited += 10;
                continue;
            }
            const inv = this.state.inventory;
            const stacks = inv.some(i => i.id === item.id && i.count > 1);
            if (inv.length >= 28 && !inv.some(i => i.id === item.id && stacks)) {
                // Non-stackable and the pack is full: bank and come back.
                await this.bot.closeShop();
                await this.atBank(shop.bank, () => this.depositAllBut(['Coins']));
                continue;
            }
            const price = predicted ?? item.buyPrice;
            const underCap = predicted === null ? 1 : rise > 0 ? Math.floor((cap - predicted) / rise) + 1 : 10;
            const step = Math.min(10, remaining, item.count, underCap, Math.floor(coinsIn(this.state) / Math.max(price, 1)));
            if (step <= 0) {
                report.note = 'out of coins';
                break;
            }
            const coinsBefore = coinsIn(this.state);
            const r = await this.bot.buyFromShop(item, step);
            const got = r.amountBought ?? 0;
            if (got > 0) {
                const average = (coinsBefore - coinsIn(this.state)) / got;
                unitPrice = average + (rise * (got - 1)) / 2 + rise; // estimate for the next unit
                priceAtCount = this.state.shop.shopItems.find(i => i.id === item.id)?.count ?? 0;
                this.shopPrices.set(priceKey, { unitPrice, priceAtCount });
                if (heldBefore === this.held(name) - got) this.ctx.log('shop price', { item: name, paid: average, nextUnit: +unitPrice.toFixed(2), cap, stock: item.count });
            } else {
                this.ctx.log('shop buy failed', { item: name, step, message: r.message });
                await waitTicks(this.sdk, 2);
            }
        }
        if (this.state.shop.isOpen) await this.bot.closeShop();
        report.bought = this.held(name) - heldBefore;
        report.spent = coinsAtStart - coinsIn(this.state);
        return report;
    }

    // ------------------------------------------------------------ the list

    /** Estimated coins for a line (generous: shop prices creep up as stock drains). */
    private async budget(line: ListLine): Promise<number> {
        const need = Math.max(0, line.quantity - this.held(typeof line.item === 'string' ? line.item : (await this.resolveItem(line.item)).name));
        if (line.maxPrice !== undefined) return need * line.maxPrice;
        if (line.source === 'ge') {
            const { id } = await this.resolveItem(line.item);
            const q = await this.sdk.getMarketItem(id);
            return need * (q.ask ?? 0);
        }
        const { id } = await this.resolveItem(line.item);
        const q = await this.sdk.getMarketItem(id);
        return need * q.basePrice * 3;
    }

    async run(list: ListLine[]): Promise<LineReport[]> {
        await this.prepare();
        // Start at Varrock west: learn holdings, withdraw the whole budget once.
        let budget = 0;
        await this.atBank(BANKS.varrockWest, async () => {
            await this.depositAllBut(['Coins']);
            this.bankCounts = new Map(this.sdk.getBankItems().map(i => [i.name.toLowerCase(), i.count]));
            for (const line of list) budget += await this.budget(line);
            const carried = await this.setCoins(budget);
            this.ctx.log('budget', { budget, carried });
        });

        const ordered = [...list.filter(l => l.source === 'ge'), ...list.filter(l => l.source === 'shop')];
        let lastBank: Tile = BANKS.varrockWest;
        for (const line of ordered) {
            if (this.ctx.signal.aborted) break;
            try {
                const rep = line.source === 'ge' ? await this.buyAtGE(line) : await this.buyAtShop(line);
                if (line.source === 'shop' && line.shop && SHOPS[line.shop] && rep.note !== 'already held') lastBank = SHOPS[line.shop]!.bank;
                this.reports.push(rep);
                this.ctx.log('line done', { ...rep });
            } catch (e) {
                this.reports.push({ item: String(line.item), source: line.source, target: line.quantity, heldBefore: 0, bought: 0, spent: 0, note: String(e) });
                this.ctx.log('line failed', { item: line.item, error: String(e) });
            }
        }
        // Bank everything, coins included.
        await this.atBank(lastBank, () => this.depositAllBut([]));
        const spent = this.reports.reduce((a, r) => a + r.spent, 0);
        this.ctx.log('done', { spent, lines: this.reports });
        return this.reports;
    }
}

export const role: Role = {
    name: 'buyer',
    produces: [],
    async run(ctx: RoleContext) {
        const list = (ctx.options.list ?? []) as ListLine[];
        if (!Array.isArray(list) || list.length === 0) throw new Error('buyer: options.list is empty');
        await new Buyer(ctx).run(list);
    }
};

if (import.meta.main) await runStandalone(role);
