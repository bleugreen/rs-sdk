// hides (role): kill cows in a Lumbridge cow field, take only the cowhides, have
// the Al Kharid tanner (Ellis) tan them to hard leather, and bank the leather at
// Al Kharid. Optionally buys thread and needles at Dommik's on the same side of
// the toll gate. It finishes once this account's bank holds `target` hard leather
// (and the thread and needles asked for), so a borrowed account goes back to its
// own job by itself. Supplies the hard-leather-body line of S25d Crafting
// (docs/speedrun/skills/crafting.md); notes in docs/speedrun/helpers/hides.md.
//
//   bun speedrun/helpers/hides.ts <account>   (standalone; ROLE_OPTIONS='{"field":"east","target":400}')
//
// Meant for accounts that one-hit a cow (8 hitpoints): cows respawn 90 ticks
// after they die, so the field's ten spawns, not the kill, set the pace.
import type { GroundItem, InventoryItem, NearbyNpc } from '../../sdk/types';
import { TOLL_GP, travelTo, type Tile } from '../lib/toll-gate';
import { currentTick, waitTicks, waitUntil } from '../lib/wait';
import { closeBank, depositAllExcept, ensureOutOfTutorial, openBank } from './mule';
import { runStandalone, type Role, type RoleContext } from './role';

export interface Field {
    /** Cows and hides outside this box belong to another field or another player's walk. */
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    /** A walkable tile inside the field (a cow spawn) to walk to. */
    stand: Tile;
}

// Cow (npc 81) spawns from server/content/maps.
export const FIELDS: Readonly<Record<string, Field>> = {
    // m50_50 + m50_51: ten cows at x 3243-3261, z 3258-3295, between Lumbridge and the Al Kharid fence.
    east: { minX: 3240, maxX: 3265, minZ: 3255, maxZ: 3299, stand: { x: 3255, z: 3278 } },
    // m49_51 + m49_52: seven cows at x 3154-3203, z 3318-3342.
    north: { minX: 3150, maxX: 3207, minZ: 3314, maxZ: 3346, stand: { x: 3182, z: 3329 } }
};

/** The tanner (npc 804, 'Tanner') spawns at (3276,3193); `Trade` (op3) opens the tanning screen (tanner.rs2). */
export const TANNER_TILE: Tile = { x: 3275, z: 3192 };
export const AL_KHARID_BANK: Tile = { x: 3269, z: 3167 };
/** Dommik (npc 545) at (3322,3194): craftingshop2, needle 3 and thread 100 in stock, thread restocking every 5 ticks (alkharid.inv). */
export const DOMMIK_TILE: Tile = { x: 3321, z: 3194 };
/** interface.pack: 679 = tanner, 8690 = tanner:com_98, the hard leather 'All' button (@tan_hard_leather(inv_total(cow_hide))). */
export const TANNER_IF = 679;
export const TAN_HARD_ALL = 8690;
/** ^tanner_hard_leather_cost (tanner.constant). */
export const TAN_GP = 3;

const COINS = /^coins$/i;
const COWHIDE = /^cowhide$/i;
const HARD_LEATHER = /^hard leather$/i;
const THREAD = /^thread$/i;
const NEEDLE = /^needle$/i;
const COW = /^cow$/i;
const TANNER = /^(tanner|ellis)$/i;

/**
 * Thread a run of `bodies` hard leather bodies needs (leather.rs2 @craft_leather):
 * a body is refused unless one thread is held, and one thread is deleted when
 * %thread_used passes 4, i.e. on every fifth body. `used` is the crafter's
 * %thread_used at the start (a saved varp, 0-4; 4 is the worst case).
 */
export function threadNeeded(bodies: number, used = 4): number {
    if (bodies <= 0) return 0;
    return Math.floor((bodies - 1 + used) / 5) + 1;
}

export interface HidesOptions {
    field: string;
    /** Finish once the bank holds this much hard leather. */
    target: number;
    /** Thread to have in the bank before finishing (bought at Dommik's). */
    thread: number;
    /** Needles to have in the bank before finishing. */
    needle: number;
    /** Coins carried out of every bank visit: tanning (3 gp a hide), two tolls, shopping. */
    carryCoins: number;
}

const nonNegInt = (raw: unknown, key: string, fallback: number): number => {
    if (raw === undefined) return fallback;
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) throw new Error(`hides: options.${key} must be a whole number >= 0`);
    return raw;
};

export function hidesOptions(raw: Record<string, unknown>): HidesOptions {
    const field = String(raw.field ?? 'east');
    if (!FIELDS[field]) throw new Error(`hides: unknown field "${field}"; options.field is one of ${Object.keys(FIELDS).join(', ')}`);
    const target = nonNegInt(raw.target, 'target', NaN);
    if (!Number.isFinite(target) || target < 1) throw new Error('hides: options.target (hard leather to bank) is required and at least 1');
    const o = { field, target, thread: nonNegInt(raw.thread, 'thread', 0), needle: nonNegInt(raw.needle, 'needle', 0), carryCoins: nonNegInt(raw.carryCoins, 'carryCoins', 1000) };
    if (o.carryCoins < minCoins()) throw new Error(`hides: options.carryCoins must be at least ${minCoins()}`);
    return o;
}

/** Enough for a full inventory's tanning and the two crossings of a round trip. */
export const minCoins = () => 27 * TAN_GP + 2 * TOLL_GP;

export interface Carried {
    hides: number;
    leather: number;
    thread: number;
    needle: number;
    coins: number;
    /** Anything else (food, a borrowed account's tools): banked on the first visit. */
    other: number;
    freeSlots: number;
}

const total = (items: readonly InventoryItem[], re: RegExp) => items.filter(i => re.test(i.name)).reduce((s, i) => s + i.count, 0);

export function carried(items: readonly InventoryItem[]): Carried {
    const known = [COWHIDE, HARD_LEATHER, THREAD, NEEDLE, COINS];
    return {
        hides: total(items, COWHIDE),
        leather: total(items, HARD_LEATHER),
        thread: total(items, THREAD),
        needle: total(items, NEEDLE),
        coins: total(items, COINS),
        other: items.filter(i => !known.some(re => re.test(i.name))).length,
        freeSlots: 28 - items.length
    };
}

export interface Banked {
    leather: number;
    thread: number;
    needle: number;
    coins: number;
    hides: number;
}

export function banked(items: readonly { name: string; count: number }[]): Banked {
    const t = (re: RegExp) => items.filter(i => re.test(i.name)).reduce((s, i) => s + i.count, 0);
    return { leather: t(HARD_LEATHER), thread: t(THREAD), needle: t(NEEDLE), coins: t(COINS), hides: t(COWHIDE) };
}

export type Step = 'tan' | 'bank' | 'shop' | 'gather' | 'done';

export interface Situation {
    inv: Carried;
    /** The bank as last seen, null before this run's first visit. */
    bank: Banked | null;
    /** A shop visit is owed since the last bank visit (false once tried, so an empty shelf can't loop). */
    shopDue: boolean;
}

/**
 * What to do next. Hides go to the tanner before anything is banked (the bank
 * would swallow them), leather and shopping go to the bank, and the role is done
 * only from the bank, where the count is read.
 */
export function nextStep(s: Situation, o: HidesOptions): Step {
    const { inv, bank } = s;
    const enough = bank !== null && bank.leather + inv.hides >= o.target;
    if (inv.hides > 0 && (inv.freeSlots === 0 || bank === null || enough)) return 'tan';
    if (bank === null || inv.leather > 0 || inv.thread > 0 || inv.needle > 0 || inv.other > 0 || inv.coins < minCoins()) return 'bank';
    if (s.shopDue && shopNeed(bank, o) !== null) return 'shop';
    if (bank.leather >= o.target && shopNeed(bank, o) === null) return 'done';
    return 'gather';
}

/**
 * Whether a bank visit makes a shop visit due. Not when it only banked what the
 * shop just sold: the shelf restocks one thread every 5 ticks, so going straight
 * back would shuttle between Dommik and the bank for a handful each time instead
 * of gathering. One visit per trip finds the shelf refilled by minutes of work.
 */
export const shopDueAfterBank = (previous: Step | null): boolean => previous !== 'shop';

/** Thread and needles still to buy, or null when the bank already holds them. */
export function shopNeed(bank: Banked, o: HidesOptions): { thread: number; needle: number } | null {
    const need = { thread: Math.max(0, o.thread - bank.thread), needle: Math.max(0, o.needle - bank.needle) };
    return need.thread > 0 || need.needle > 0 ? need : null;
}

const inField = (t: { x: number; z: number }, f: Field) => t.x >= f.minX && t.x <= f.maxX && t.z >= f.minZ && t.z <= f.maxZ;
const npcTile = (n: NearbyNpc) => ({ x: n.tileX ?? n.x, z: n.tileZ ?? n.z });

/** The nearest cow in the field nobody is fighting, that we can reach, and haven't just failed on. */
export function pickCow(npcs: readonly NearbyNpc[], f: Field, avoid: ReadonlyMap<number, number>, now: number): NearbyNpc | undefined {
    return npcs
        .filter(n => COW.test(n.name) && n.reachable !== false && !n.inCombat && inField(npcTile(n), f))
        .filter(n => n.optionsWithIndex.some(op => /^attack$/i.test(op.text)))
        .filter(n => (avoid.get(n.index) ?? 0) <= now)
        .sort((a, b) => a.distance - b.distance)[0];
}

/** The nearest cowhide pile in the field we can stand on and haven't just failed to take. */
export function pickHide(items: readonly GroundItem[], f: Field, avoid: ReadonlyMap<string, number>, now: number): GroundItem | undefined {
    return items
        .filter(g => COWHIDE.test(g.name) && g.reachable !== false && inField(g, f))
        .filter(g => (avoid.get(`${g.x},${g.z}`) ?? 0) <= now)
        .sort((a, b) => a.distance - b.distance)[0];
}

interface Tally {
    kills: number;
    picked: number;
    tanned: number;
    trips: number;
    startedAt: number;
    startLeather: number | null;
}

async function go(ctx: RoleContext, to: Tile, tolerance: number, what: string): Promise<void> {
    const r = await travelTo(ctx.bot, ctx.sdk, to, { tolerance, log: ctx.log, signal: ctx.signal });
    if (!r.ok) throw new Error(`could not reach ${what}: ${r.reason}`);
}

async function tan(ctx: RoleContext, tally: Tally): Promise<void> {
    const { sdk } = ctx;
    const before = carried(sdk.getInventory()).hides;
    await go(ctx, TANNER_TILE, 4, 'the tanner');
    for (let attempt = 1; attempt <= 3; attempt++) {
        const tanner = sdk.getState()!.nearbyNpcs.filter(n => TANNER.test(n.name)).sort((a, b) => a.distance - b.distance)[0];
        const trade = tanner?.optionsWithIndex.find(op => /^trade$/i.test(op.text));
        if (!tanner || !trade) {
            ctx.log('tanner not in view', { attempt });
            await waitTicks(sdk, 3);
            continue;
        }
        await sdk.sendInteractNpc(tanner.index, trade.opIndex);
        const open = await waitUntil(sdk, s => s.interface.isOpen && s.interface.interfaceId === TANNER_IF, { maxTicks: 15 });
        if (!open.ok) {
            ctx.log('tanning screen did not open', { attempt, reason: open.reason });
            continue;
        }
        await sdk.sendClickComponent(TAN_HARD_ALL);
        const done = await waitUntil(sdk, s => carried(s.inventory).hides === 0, { maxTicks: 6 });
        await ctx.bot.dismissBlockingUI();
        const after = carried(sdk.getInventory());
        tally.tanned += before - after.hides;
        ctx.log('tanned', { hides: before - after.hides, leather: after.leather, left: after.hides, coins: after.coins });
        if (done.ok) return;
        if (after.coins < TAN_GP) throw new Error('out of coins at the tanner');
    }
    throw new Error('could not tan at the tanner after 3 attempts');
}

async function bank(ctx: RoleContext, o: HidesOptions, tally: Tally): Promise<Banked> {
    const { sdk, bot } = ctx;
    await go(ctx, AL_KHARID_BANK, 3, 'Al Kharid bank');
    if (!(await openBank(ctx))) throw new Error('could not open Al Kharid bank');
    const coinId = sdk.getInventory().find(i => COINS.test(i.name))?.id;
    if (!(await depositAllExcept(sdk, new Map(coinId === undefined ? [] : [[coinId, 1]])))) ctx.log('deposit incomplete', { left: sdk.getInventory().map(i => i.name) });
    const held = carried(sdk.getInventory()).coins;
    if (held < o.carryCoins) {
        const inBank = banked(sdk.getBankItems()).coins;
        const n = Math.min(o.carryCoins - held, inBank);
        if (n > 0) {
            const w = await bot.withdrawItem(COINS, n);
            if (!w.success) ctx.log('coin withdraw short', { asked: n, message: w.message });
        }
    }
    const items = sdk.getBankItems().map(i => ({ id: i.id, name: i.name, count: i.count }));
    ctx.reportBank({ items });
    await closeBank(ctx);
    const b = banked(items);
    const coins = carried(sdk.getInventory()).coins;
    if (coins < minCoins()) throw new Error(`only ${coins} coins carried and ${b.coins} banked; needs ${minCoins()} for a trip`);
    tally.startLeather ??= b.leather;
    tally.trips++;
    const hours = (Date.now() - tally.startedAt) / 3_600_000;
    const gained = b.leather - tally.startLeather;
    ctx.log('banked', {
        leather: b.leather,
        target: o.target,
        thread: b.thread,
        needle: b.needle,
        hidesInBank: b.hides,
        coinsCarried: coins,
        session: { trips: tally.trips, kills: tally.kills, picked: tally.picked, tanned: tally.tanned, leatherGained: gained, hours: Number(hours.toFixed(2)), perHour: hours > 0.05 ? Math.round(gained / hours) : null }
    });
    return b;
}

async function shop(ctx: RoleContext, need: { thread: number; needle: number }): Promise<void> {
    const { sdk, bot } = ctx;
    await go(ctx, DOMMIK_TILE, 4, "Dommik's");
    const open = await bot.openShop(/^dommik$/i);
    if (!open.success) {
        ctx.log('shop did not open', { message: open.message });
        return;
    }
    for (const [re, n] of [[THREAD, need.thread], [NEEDLE, need.needle]] as const) {
        const shelf = sdk.getState()?.shop.shopItems.find(i => re.test(i.name));
        const amount = Math.min(n, shelf?.count ?? 0);
        if (amount <= 0) continue;
        const r = await bot.buyFromShop(shelf!, amount);
        ctx.log('bought', { item: shelf!.name, asked: amount, got: r.amountBought ?? 0, shelf: shelf!.count, message: r.message });
    }
    await bot.closeShop();
}

/** One step at the field: take a hide, or kill a cow, or wait for a respawn. */
async function gather(ctx: RoleContext, f: Field, tally: Tally, avoidNpc: Map<number, number>, avoidTile: Map<string, number>): Promise<void> {
    const { sdk, bot } = ctx;
    const p = sdk.getState()?.player;
    if (!p) {
        await waitTicks(sdk, 1);
        return;
    }
    if (!inField({ x: p.worldX, z: p.worldZ }, f)) {
        await go(ctx, f.stand, 4, 'the cow field');
        return;
    }
    const now = Date.now();
    const pile = pickHide(await sdk.scanGroundItems(15), f, avoidTile, now);
    if (pile) {
        const r = await bot.pickupItem(pile);
        if (r.success) tally.picked++;
        else avoidTile.set(`${pile.x},${pile.z}`, now + 30_000);
        return;
    }
    const cow = pickCow(sdk.getState()!.nearbyNpcs, f, avoidNpc, now);
    if (!cow) {
        await waitTicks(sdk, 3);
        return;
    }
    const attack = await bot.attack(cow);
    if (!attack.success) {
        avoidNpc.set(cow.index, now + 20_000);
        return;
    }
    // A one-hit kill leaves the npc list a couple of ticks after the swing; the hide lands the tick after.
    const died = await waitUntil(sdk, s => !s.nearbyNpcs.some(n => n.index === cow.index), { maxTicks: 25 });
    if (died.ok) {
        tally.kills++;
        await waitTicks(sdk, 1);
    } else {
        avoidNpc.set(cow.index, Date.now() + 20_000);
    }
}

export const role: Role = {
    name: 'hides',
    produces: [HARD_LEATHER, THREAD, NEEDLE],
    async run(ctx) {
        const o = hidesOptions(ctx.options);
        const f = FIELDS[o.field]!;
        await ensureOutOfTutorial(ctx);
        ctx.log('phase', { phase: 'hides', ...o, tick: currentTick(ctx.sdk) });

        const tally: Tally = { kills: 0, picked: 0, tanned: 0, trips: 0, startedAt: Date.now(), startLeather: null };
        const avoidNpc = new Map<number, number>();
        const avoidTile = new Map<string, number>();
        let seen: Banked | null = null;
        let shopDue = false;
        let last: Step | null = null;
        let lastProgress = Date.now();

        while (!ctx.signal.aborted) {
            await ctx.bot.dismissBlockingUI();
            const step = nextStep({ inv: carried(ctx.sdk.getInventory()), bank: seen, shopDue }, o);
            switch (step) {
                case 'tan':
                    await tan(ctx, tally);
                    break;
                case 'bank':
                    seen = await bank(ctx, o, tally);
                    shopDue = shopDueAfterBank(last);
                    break;
                case 'shop':
                    shopDue = false;
                    await shop(ctx, shopNeed(seen!, o)!);
                    break;
                case 'done':
                    ctx.log('finished', { leather: seen!.leather, thread: seen!.thread, needle: seen!.needle, kills: tally.kills });
                    return;
                case 'gather':
                    shopDue = false;
                    await gather(ctx, f, tally, avoidNpc, avoidTile);
                    break;
            }
            last = step;
            if (Date.now() - lastProgress > 5 * 60_000) {
                lastProgress = Date.now();
                const inv = carried(ctx.sdk.getInventory());
                ctx.log('progress', { kills: tally.kills, picked: tally.picked, carried: inv.hides, bankedLeather: seen?.leather ?? null });
            }
        }
    }
};

if (import.meta.main) await runStandalone(role);
