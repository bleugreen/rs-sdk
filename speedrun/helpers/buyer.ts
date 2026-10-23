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
import { cross, crossingsBetween, type Crosser } from '../lib/passages';
import { pointMarketAtServer } from './mule';
import { runStandalone, type Role, type RoleContext } from './role';

export interface Tile {
    x: number;
    z: number;
    /** Floor; 0 (the default) on the ground. Underground maps are level 0 too, 6,400 tiles north (isUnderground). */
    level?: number;
}

/**
 * A ladder, trapdoor or staircase between the surface and a floor off it: the
 * surface tile beside it, and the tile beside it on the other floor (upstairs or
 * underground). A plain ladder keeps x and z (ladders.rs2 climb_ladder), so its
 * two tiles differ only in level.
 */
export interface Ladder {
    ground: Tile;
    other: Tile;
}

/** Where the buyer goes: a tile, and for one off the surface the ladder that reaches it. */
export interface Place extends Tile {
    ladder?: Ladder;
}

export interface ShopSpec {
    /** NPC that offers Trade. */
    npc: RegExp;
    /** A tile next to the shopkeeper (walkTo target). */
    stand: Place;
    /** Nearest bank booth area, for non-stackable purchases and the final deposit. */
    bank: Place;
}

/** North Dwarven Mine, by the Ice Mountain trapdoor: the south entrance lands among aggressive scorpions. */
const ICE_MOUNTAIN_TRAPDOOR: Ladder = { ground: { x: 3019, z: 3449 }, other: { x: 3019, z: 9849 } };
/**
 * The Gnome Stronghold's first floor, up the Grand Tree's ladder (m38_54: ladder and laddermiddle at
 * 2466,3495), inside the tree doors. Its bank and both grocers are on that floor and walkable from the
 * ladder without another climb; the walk to the ladder crosses the Stronghold gate and the tree doors
 * (passages.ts).
 */
const GRAND_TREE_LADDER: Ladder = { ground: { x: 2466, z: 3494 }, other: { x: 2466, z: 3494, level: 1 } };

export const BANKS = {
    varrockWest: { x: 3185, z: 3438 },
    varrockEast: { x: 3253, z: 3421 },
    draynor: { x: 3092, z: 3245 },
    alKharid: { x: 3270, z: 3167 },
    faladorWest: { x: 2946, z: 3369 },
    faladorEast: { x: 3013, z: 3357 },
    edgeville: { x: 3093, z: 3491 },
    catherby: { x: 2809, z: 3439 },
    seers: { x: 2725, z: 3491 },
    yanille: { x: 2613, z: 3092 },
    ardougneSouth: { x: 2654, z: 3283 },
    ardougneNorth: { x: 2615, z: 3333 },
    /** In the Grand Tree, north of the booths at (2448-2450, 3481). */
    gnomeStronghold: { x: 2449, z: 3482, level: 1, ladder: GRAND_TREE_LADDER }
} satisfies Record<string, Place>;

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
    /** Rune pickaxe, stock 1. */
    nurmof: { npc: /^nurmof$/i, stand: { x: 2998, z: 9846, ladder: ICE_MOUNTAIN_TRAPDOOR }, bank: BANKS.faladorEast },
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
    dargaud: { npc: /^bow and arrow salesman$/i, stand: { x: 2672, z: 3434 }, bank: BANKS.seers },
    /** Zaff's Superior Staffs, Varrock (staffshop: 2 staffs of fire and of air). */
    zaff: { npc: /^zaff$/i, stand: { x: 3203, z: 3432 }, bank: BANKS.varrockWest },
    /** Varrock Swordshop (wiki/shops/varrock-swordshop.md): swords and longswords to adamant. */
    varrockSwords: { npc: /^shop (keeper|assistant)$/i, stand: { x: 3204, z: 3398 }, bank: BANKS.varrockWest },
    /** Bob's Brilliant Axes, Lumbridge (wiki/shops/bobs-brilliant-axes.md): bronze axe 16 gp, stock 10. */
    bob: { npc: /^bob$/i, stand: { x: 3231, z: 3203 }, bank: BANKS.draynor },
    /**
     * Magic Guild store, Yanille (magicguildshop: every elemental, mind, chaos, death and law rune,
     * staffs of fire). Upstairs behind a Magic-66 door, so it has no ladder: the caller climbs to it
     * first (dragons.ts enterGuild).
     */
    magicGuild: { npc: /^magic store owner$/i, stand: { x: 2594, z: 3087, level: 1 }, bank: BANKS.yanille },
    // Port Sarim food store: pot of flour 3, raw beef 1, raw chicken 1, banana 3, redberries 1 (port_sarim.inv wydinstore).
    wydin: { npc: /^wydin$/i, stand: { x: 3015, z: 3205 }, bank: BANKS.draynor },
    // Varrock clothes shop: silk 5 (varrock.inv clotheshop).
    thessalia: { npc: /^thessalia$/i, stand: { x: 3205, z: 3416 }, bank: BANKS.varrockWest },
    // Overseas and upstairs shops: questitems walks there by ship and ladder before buying.
    jiminua: { npc: /^jiminua$/i, stand: { x: 2767, z: 3122 }, bank: BANKS.ardougneSouth },
    khazard: { npc: /^shop keeper$/i, stand: { x: 2641, z: 3170 }, bank: BANKS.ardougneSouth },
    aemad: { npc: /^(aemad|kortan)$/i, stand: { x: 2613, z: 3293 }, bank: BANKS.ardougneNorth },
    // Gnome Stronghold grocers (gnome.inv gnomeshop_heck, gnomeshop_hudo): chocolate bar and dust,
    // stock 5 each, one unit back per 100 ticks. Spawns from m38_54, both on the first floor.
    heckel: { npc: /^heckel funch$/i, stand: { x: 2493, z: 3488, level: 1, ladder: GRAND_TREE_LADDER }, bank: BANKS.gnomeStronghold },
    hudo: { npc: /^hudo$/i, stand: { x: 2448, z: 3509, level: 1, ladder: GRAND_TREE_LADDER }, bank: BANKS.gnomeStronghold }
};

/** Underground maps sit 6,400 tiles north of the surface they belong to. */
export const isUnderground = (t: Tile): boolean => t.z > 6400;

/** 0 on the surface, the level upstairs, -1 underground. */
export const floorOf = (t: Tile): number => (isUnderground(t) ? -1 : (t.level ?? 0));

const cheb = (a: Tile, b: Tile) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
const sameLadder = (a: Ladder, b: Ladder) => a.ground.x === b.ground.x && a.ground.z === b.ground.z && floorOf(a.other) === floorOf(b.other);

/** How far from a known place a tile off the surface is taken to be reached by that place's ladder. */
const LADDER_REACH = 64;

/**
 * The ladder that reaches `t`, when `t` is off the surface: its own, else that of the
 * nearest known shop or bank on the same floor (an account that starts upstairs or
 * underground does not know which way it came). Undefined when nothing is near.
 */
export function ladderNear(t: Place, known: Place[] = [...Object.values(BANKS), ...Object.values(SHOPS).flatMap(s => [s.stand, s.bank])]): Ladder | undefined {
    if (floorOf(t) === 0) return undefined;
    if (t.ladder) return t.ladder;
    const near = known.filter(p => p.ladder && floorOf(p) === floorOf(t) && cheb(p, t) <= LADDER_REACH).sort((a, b) => cheb(a, t) - cheb(b, t))[0];
    return near?.ladder;
}

export type Leg = 'climb-up' | 'toll-east' | 'toll-west' | 'climb-down' | 'walk';

/**
 * What a trip from `from` to `to` has to do besides walking, in order: leave the
 * floor `from` is on (up out of the underground, down from upstairs), cross the Al
 * Kharid toll gate (pathfinding cannot pay it) between the two ladders' surface
 * tiles, climb to the floor `to` is on. Two places on one floor are a walk unless
 * their ladders are known to differ. Off the surface without a ladder counts as
 * west of the gate.
 */
export function travelPlan(from: Place, to: Place): Leg[] {
    const fromFloor = floorOf(from);
    const toFloor = floorOf(to);
    if (fromFloor === toFloor && fromFloor !== 0 && (!from.ladder || !to.ladder || sameLadder(from.ladder, to.ladder))) return ['walk'];
    const legs: Leg[] = [];
    if (fromFloor !== 0) legs.push(fromFloor > 0 ? 'climb-down' : 'climb-up');
    const fromEast = isEastOfTollGate(fromFloor === 0 ? from : (from.ladder?.ground ?? from));
    const toEast = isEastOfTollGate(toFloor === 0 ? to : (to.ladder?.ground ?? to));
    if (fromEast !== toEast) legs.push(toEast ? 'toll-east' : 'toll-west');
    if (toFloor !== 0) legs.push(toFloor > 0 ? 'climb-up' : 'climb-down');
    legs.push('walk');
    return legs;
}

/** The bank a list starts at and withdraws its budget from: Varrock west (by the Grand Exchange) for a list with GE lines, else its first shop's. */
export function homeBank(list: ListLine[]): Place {
    if (list.some(l => l.source === 'ge')) return BANKS.varrockWest;
    const shop = list.map(l => (l.shop ? SHOPS[l.shop] : undefined)).find(s => s !== undefined);
    return shop?.bank ?? BANKS.varrockWest;
}

/** Shop-line notes that a restock can clear (buyAtShop): camping revisits those lines. */
export const waitsOnRestock = (note: string | undefined): boolean => note === 'out of stock' || /^price ~/.test(note ?? '');

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

const CLIMB = { 'climb-up': /^climb[- ]up$/i, 'climb-down': /^climb[- ]down$/i } as const;

async function waitTicks(sdk: BotSDK, n: number): Promise<BotWorldState> {
    for (let i = 0; i < n; i++) await sdk.waitForStateUpdate();
    return sdk.getState()!;
}

export class Buyer {
    private readonly bot: BotActions;
    private readonly sdk: BotSDK;
    private bankCounts = new Map<string, number>();
    /** The ladder last climbed off the surface, so the walk back knows which leads out. */
    private ladder: Ladder | null = null;
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
        return { x: p.worldX, z: p.worldZ, level: p.level ?? 0 };
    }

    /** Where the account is, with the ladder that leads back to the surface when it is off it. */
    private get place(): Place {
        const here = this.here;
        return floorOf(here) === 0 ? here : { ...here, ladder: this.ladder ?? ladderNear(here) };
    }

    /** Walk to `t`, climbing and paying the toll gate on the way as travelPlan says. */
    async walk(t: Place): Promise<boolean> {
        for (const leg of travelPlan(this.place, t)) {
            if (this.ctx.signal.aborted) return false;
            if (leg === 'climb-up' || leg === 'climb-down') {
                const ok = floorOf(this.here) !== 0 ? await this.leaveFloor(leg) : await this.enterFloor(t, leg);
                if (!ok) return false;
            }
            if (leg === 'toll-east' || leg === 'toll-west') {
                const r = await crossTollGate(this.bot, this.sdk, leg === 'toll-east', this.ctx.log);
                if (!r.ok) return false;
            }
        }
        return floorOf(this.here) === 0 && floorOf(t) === 0 ? this.walkOnSurface(t) : this.walkHere(t);
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

    /** Climb from the surface to `t`'s floor by its ladder. */
    private async enterFloor(t: Place, leg: 'climb-up' | 'climb-down'): Promise<boolean> {
        const ladder = t.ladder;
        if (!ladder) {
            this.ctx.log('walk: no way to that floor known', { to: t });
            return false;
        }
        if (!(await this.walkOnSurface(ladder.ground))) return false;
        const floor = floorOf(t);
        const ok = await this.useLoc(/trapdoor|ladder|stair/i, CLIMB[leg], ladder.ground, () => floorOf(this.here) === floor);
        if (ok) this.ladder = ladder;
        return ok;
    }

    /** Climb back to the surface by the ladder that leads there (the nearest, when none is known). */
    private async leaveFloor(leg: 'climb-up' | 'climb-down'): Promise<boolean> {
        const at = this.place.ladder?.other;
        if (at && cheb(this.here, at) > 4) await this.walkHere(at);
        const ok = await this.useLoc(/trapdoor|ladder|stair/i, CLIMB[leg], at ?? this.here, () => floorOf(this.here) === 0);
        if (ok) this.ladder = null;
        return ok;
    }

    /**
     * Walk on the surface: step clear of the toll gate's west side, and cross the
     * scripted gates and doors on the way (the Gnome Stronghold's), which the
     * pathfinder cannot open.
     */
    private async walkOnSurface(t: Tile): Promise<boolean> {
        if (besideGateWest(this.here) && !isEastOfTollGate(t) && !besideGateWest(t)) await this.walkHere(WEST_OF_GATE);
        const crosser: Crosser = {
            bot: this.bot,
            sdk: this.sdk,
            log: this.ctx.log,
            walk: async p => {
                if (!(await this.walkHere(p, 1))) throw new Error(`could not reach (${p.x}, ${p.z})`);
            }
        };
        try {
            for (const c of crossingsBetween(this.here, t) ?? []) await cross(crosser, c);
        } catch (e) {
            this.ctx.log('walk: passage', { to: t, error: String(e) });
            return false;
        }
        return this.walkHere(t);
    }

    /** Plain pathfinding on the current floor with retries; no ladders, passages or toll gate. */
    private async walkHere(t: Tile, tolerance = 2): Promise<boolean> {
        for (let i = 0; i < 5 && !this.ctx.signal.aborted; i++) {
            const r = await this.bot.walkTo(t.x, t.z, tolerance);
            if (r.success || cheb(this.here, t) <= tolerance + 1) return true;
            this.ctx.log('walk retry', { to: t, message: r.message });
            await waitTicks(this.sdk, 2);
        }
        return false;
    }

    /** Open the bank at `at`, run `body` with it open, report the bank, close it. */
    async atBank<T>(at: Place, body: () => Promise<T>): Promise<T> {
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
        // Every return closes the exchange: a window left open is taken for the bank by the
        // caller's next openBank, whose deposits and bank read then come back empty.
        try {
            // Collect before counting: an earlier offer that filled while we were away
            // sits in the exchange, not the inventory, and must count toward the target,
            // or a rerun buys the same quantity again.
            await this.collectFills();
            const heldBefore = this.held(name);
            report.heldBefore = heldBefore;
            const need = line.quantity - heldBefore;
            if (need <= 0) return { ...report, note: 'already held' };

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
            return report;
        } finally {
            await this.bot.closeInterface();
        }
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
                // openShop paths to the shopkeeper itself, which covers a stand the walk fell short of.
                if (!(await this.walk(shop.stand))) this.ctx.log('shop: walk fell short', { shop: line.shop, at: this.here });
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

    /**
     * Buy the list. With `campTicks`, shop lines left short by an empty or too dear
     * shelf are revisited in passes, in list order, until they are met or `campTicks`
     * have gone by since the budget was withdrawn: one account camping restocking shops.
     */
    async run(list: ListLine[], campTicks = 0): Promise<LineReport[]> {
        await this.prepare();
        // Learn holdings and withdraw the whole budget once, at the bank the list starts from.
        let budget = 0;
        await this.atBank(homeBank(list), async () => {
            await this.depositAllBut(['Coins']);
            this.bankCounts = new Map(this.sdk.getBankItems().map(i => [i.name.toLowerCase(), i.count]));
            for (const line of list) budget += await this.budget(line);
            const carried = await this.setCoins(budget);
            this.ctx.log('budget', { budget, carried });
        });
        const campUntil = this.state.tick + campTicks;

        const ordered = [...list.filter(l => l.source === 'ge'), ...list.filter(l => l.source === 'shop')];
        let lastBank: Place = homeBank(list);
        const buy = async (line: ListLine, maxWaitTicks?: number): Promise<LineReport> => {
            try {
                const rep = line.source === 'ge' ? await this.buyAtGE(line) : await this.buyAtShop(line, maxWaitTicks);
                if (line.source === 'shop' && line.shop && SHOPS[line.shop] && rep.note !== 'already held') lastBank = SHOPS[line.shop]!.bank;
                this.ctx.log('line done', { ...rep });
                return rep;
            } catch (e) {
                this.ctx.log('line failed', { item: line.item, error: String(e) });
                return { item: String(line.item), source: line.source, target: line.quantity, heldBefore: 0, bought: 0, spent: 0, note: String(e) };
            }
        };
        for (const line of ordered) {
            if (this.ctx.signal.aborted) break;
            this.reports.push(await buy(line));
        }
        while (!this.ctx.signal.aborted && this.state.tick < campUntil) {
            const waiting = this.reports.map((r, i) => ({ r, line: ordered[i]! })).filter(({ r }) => waitsOnRestock(r.note));
            if (waiting.length === 0) break;
            let bought = 0;
            for (const { r, line } of waiting) {
                const left = campUntil - this.state.tick;
                if (left <= 0 || this.ctx.signal.aborted) break;
                const rep = await buy(line, Math.min(line.maxWaitTicks ?? 300, left));
                Object.assign(r, { bought: r.bought + rep.bought, spent: r.spent + rep.spent, note: rep.note });
                bought += rep.bought;
            }
            this.ctx.log('camp pass', { bought, ticksLeft: campUntil - this.state.tick, held: this.reports.map(r => `${r.item}:${this.held(r.item)}`) });
            // Every shelf was bare: wait out one restock (World.ts, a unit per stockrate ticks) rather than walk the round again.
            if (bought === 0) await waitTicks(this.sdk, Math.max(0, Math.min(100, campUntil - this.state.tick)));
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
        await new Buyer(ctx).run(list, Number(ctx.options.campTicks ?? 0));
    }
};

if (import.meta.main) await runStandalone(role);
