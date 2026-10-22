// Live probe: pickpocketing the East Ardougne market knights (docs/markets/probes.md).
//
//   bun markets/methods/probe-knights.ts <account> --minutes N [--out file.jsonl]
//       [--withdraw 1000] [--food 20] [--bank-at 25000] [--keep-coins 500] [--food-source shop]
//
// Start: Thieving 55+, anywhere on the Lumbridge side or in Al Kharid (or already in East
// Ardougne), coins in the bank. It takes `--withdraw` coins from the nearest bank on its side
// (Draynor, or Al Kharid), sails to Ardougne by Port Sarim, Karamja and Brimhaven
// (speedrun/lib/ships.ts; the land route over White Wolf Mountain kills a 10-Hitpoints account),
// buys food from the market Baker, then clicks the nearest knight once per game tick for
// `--minutes` of wall clock from its arrival, as speedrun/helpers/coins.ts does: the server drops
// clicks sent while the player is delayed or stunned, so a click every tick costs nothing and
// never misses the first free tick.
//
// Food: the Baker's shop (bread 5 HP, cake 3 bites of 4, chocolate slice 5; stock 10/3/8,
// shared and restocking; ardougne_east.inv); sold out, it waits at the shop for the restock. With
// `stall` in --food-source, also the east baker's stall, for accounts with combat stats only: in
// the lab a guard caught a 10-Hitpoints account there within 51 ticks and took it to 4. The stall from the tile north of it (speedrun/helpers/kits.ts: the stall body hides the player from
// the baker; nothing is clicked for STALL_BACKOFF_TICKS after any combat contact, since a click in
// the engine's 10-tick combat window is refused). A theft makes the Baker call the guards on
// the next trade for 1,500 ticks (baker.rs2, ^baker_stall_timer), so the shop is skipped then.
// Coins over `--bank-at` go to the East Ardougne south bank, keeping `--keep-coins`.
//
// Never drops, trades or sells anything.
import type { BotWorldState, InventoryItem, NearbyNpc } from '../../sdk/types';
import { BAKER_STALL, BAKER_STALL_TILE, lastContact, STALL_BACKOFF_TICKS } from '../../speedrun/helpers/kits';
import { sailTo } from '../../speedrun/lib/ships';
import { inAlKharid, travelTo, WEST_OF_GATE } from '../../speedrun/lib/toll-gate';
import { nextTick, waitTicks, waitUntil } from '../../speedrun/lib/wait';
import { ARDOUGNE_SOUTH_BANK, inEastArdougne } from '../../speedrun/skills/thieving';
import { cheb, coinsIn, commonOptions, here, numberFlag, runProbe, walk, type Args, type CommonOptions, type ProbeContext, type ProbeSpec, type Tile } from './probe-sampler';

/** The eastern knights wander least (docs/speedrun/skills/thieving.md section 6; thieving.ts BANDS). */
export const KNIGHT_ANCHOR: Tile = { x: 2670, z: 3305 };
/** Knights further than this from the anchor are ignored (spawns at 2669,3298 and 2671,3311; m41_51.jm2). */
export const KNIGHT_RADIUS = 10;
export const KNIGHT = /^Knight of Ardougne$/i;
/** Fixed stun damage per failure (pickpocket.dbrow). */
export const KNIGHT_DAMAGE = 3;
export const MIN_THIEVING = 55;
/** From the Ardougne landing into the market (thieving.ts SHIP_ROUTE.market). */
const MARKET: Tile = { x: 2665, z: 3290 };
const BAKER = /^Baker$/i;
/** ^baker_stall_timer (stealing.constant): ticks after a theft during which a trade with the Baker calls the guards. */
export const BAKER_ALERT_TICKS = 1500;
/** With no food at all, the shop is tried again this often, this many times, before the probe stops. */
const SOLD_OUT_WAIT_TICKS = 50;
const SOLD_OUT_RETRIES = 12;
/** Shop names, best first (HP per gp at base price: bread 5 for 12, slice 5, cake 12 for 50). */
const SHOP_FOOD = ['Bread', 'Chocolate slice', 'Cake'];
/** speedrun/helpers/buyer.ts BANKS: the start-side banks. */
const DRAYNOR_BANK: Tile = { x: 3092, z: 3245 };
const AL_KHARID_BANK: Tile = { x: 3270, z: 3167 };

export const FOOD = /^(cake|2\/3 cake|slice of cake|bread|chocolate slice)$/i;
/** The smallest heal among FOOD (a cake bite). */
const MIN_HEAL = 4;
/** Eating with a stun or skill clock pending adds 3 ticks of delay; in a success window it is free (consume.rs2). */
export const FORCED_EAT_TICKS = 3;

export type FoodSource = 'shop' | 'stall';

export interface KnightsOptions extends CommonOptions {
    withdraw: number;
    food: number;
    bankAt: number;
    keepCoins: number;
    foodSource: FoodSource[];
}

export const KNIGHTS_USAGE =
    'usage: bun markets/methods/probe-knights.ts <account> --minutes N [--out file.jsonl] [--withdraw 1000] [--food 20] [--bank-at 25000] [--keep-coins 500] [--food-source shop|stall|shop,stall]';

export function parseKnights(a: Args): KnightsOptions {
    const common = commonOptions(a, ['withdraw', 'food', 'bank-at', 'keep-coins', 'food-source']);
    const foodSource = (a.flags['food-source'] ?? 'shop').split(',').map(s => s.trim()).filter(Boolean);
    if (!foodSource.length || foodSource.some(s => s !== 'shop' && s !== 'stall')) throw new Error(`--food-source takes shop, stall or both (shop,stall), not '${a.flags['food-source']}'`);
    const keepCoins = numberFlag(a, 'keep-coins', 500, { min: 0, integer: true });
    const bankAt = numberFlag(a, 'bank-at', 25_000, { min: 1, integer: true });
    if (bankAt <= keepCoins) throw new Error(`--bank-at (${bankAt}) must be above --keep-coins (${keepCoins})`);
    return {
        ...common,
        // the two fares (60) and the toll (10) are the floor
        withdraw: numberFlag(a, 'withdraw', 1000, { min: 70, integer: true }),
        food: numberFlag(a, 'food', 20, { min: 1, max: 27, integer: true }),
        bankAt,
        keepCoins,
        foodSource: foodSource as FoodSource[],
    };
}

// ------------------------------------------------------------------ pure decisions

export const foodItems = (s: BotWorldState): InventoryItem[] => s.inventory.filter(i => FOOD.test(i.name) && i.optionsWithIndex.some(o => /^eat$/i.test(o.text)));
const thieving = (s: BotWorldState) => s.skills.find(k => k.name === 'Thieving');

/**
 * Whether to eat this tick, as coins.ts: free in a success window (no stun pending, 3+ ticks after
 * the last bite) once a bite fits under the cap; forced, whatever it costs, when the next failure
 * could leave the player at 0.
 */
export function eatDecision(i: { hp: number; maxHp: number; success: boolean; tick: number; stunEnd: number; lastEat: number; haveFood: boolean }): 'free' | 'forced' | null {
    if (!i.haveFood) return null;
    if (i.hp <= KNIGHT_DAMAGE + 1 && i.tick - i.lastEat >= 2) return 'forced';
    const eatBelow = i.maxHp - Math.min(MIN_HEAL, i.maxHp - KNIGHT_DAMAGE - 1);
    if (i.success && i.tick - i.stunEnd >= 4 && i.tick - i.lastEat >= 3 && i.hp <= eatBelow) return 'free';
    return null;
}

/** The knight to click: the one already targeted while it is in range, else the nearest in range. */
export function pickKnight(s: BotWorldState, current: number | null, skip: ReadonlyMap<number, number>): NearbyNpc | undefined {
    const inRange = (n: NearbyNpc) => KNIGHT.test(n.name) && n.reachable !== false && cheb({ x: n.x, z: n.z }, KNIGHT_ANCHOR) <= KNIGHT_RADIUS;
    const cur = current === null ? undefined : s.nearbyNpcs.find(n => n.index === current && inRange(n));
    if (cur) return cur;
    return s.nearbyNpcs.filter(n => inRange(n) && (skip.get(n.index) ?? -1) < s.tick).sort((a, b) => a.distance - b.distance)[0];
}

// ------------------------------------------------------------------ the probe

type Ctx = ProbeContext<KnightsOptions>;

interface KnightTotals {
    successes: number;
    failures: number;
    coinsGained: number;
    xpGained: number;
    arrivedTick: number | null;
    ticksAtKnights: number;
    foodEaten: number;
    eatsFree: number;
    eatsForced: number;
    /** FORCED_EAT_TICKS per forced bite (the model in eatDecision; a free bite costs none). */
    eatTicks: number;
    restocks: number;
    foodBought: number;
    coinsOnFood: number;
    stallSteals: number;
    foodStolen: number;
    bankVisits: number;
    coinsBanked: number;
    deaths: number;
    stopReason: string;
}

export class KnightsProbe {
    readonly t: KnightTotals;
    private lastTheft = -BAKER_ALERT_TICKS;

    constructor(private readonly ctx: Ctx) {
        this.t = ctx.totals as unknown as KnightTotals;
        Object.assign(this.t, {
            successes: 0, failures: 0, coinsGained: 0, xpGained: 0, arrivedTick: null, ticksAtKnights: 0, foodEaten: 0, eatsFree: 0, eatsForced: 0, eatTicks: 0,
            restocks: 0, foodBought: 0, coinsOnFood: 0, stallSteals: 0, foodStolen: 0, bankVisits: 0, coinsBanked: 0, deaths: 0, stopReason: '',
        } satisfies KnightTotals);
    }

    private get s(): BotWorldState {
        const s = this.ctx.sdk.getState();
        if (!s?.player) throw new Error('no game state');
        return s;
    }

    private phase(p: string): void {
        this.ctx.sampler.phase = p;
    }

    private walk(to: Tile, tolerance = 2): Promise<void> {
        return walk(this.ctx.bot, this.ctx.sdk, to, { tolerance, signal: this.ctx.signal, tickMs: Number(process.env.NODE_TICKRATE) || 600 });
    }

    async run(): Promise<void> {
        const { ctx } = this;
        await ctx.sdk.waitForCondition(s => (s.player?.worldX ?? 0) > 0, 60_000);
        const level = thieving(this.s)?.baseLevel ?? 1;
        if (level < MIN_THIEVING) throw new Error(`Thieving ${level} is below the knights' ${MIN_THIEVING}`);
        await this.toArdougne();
        if (ctx.signal.aborted) return;
        await this.restock();
        if (ctx.signal.aborted) return;
        await this.walk(KNIGHT_ANCHOR, 3);
        this.t.arrivedTick = this.s.tick;
        const until = Date.now() + ctx.options.minutes * 60_000;
        ctx.event('at the knights', { minutes: ctx.options.minutes, thieving: level, hp: this.s.player!.hp, food: foodItems(this.s).length, coins: coinsIn(this.s) });
        const xp0 = thieving(this.s)?.experience ?? 0;
        try {
            while (!ctx.signal.aborted && Date.now() < until) {
                const why = await this.pickpocket(until);
                if (why === 'done' || why === 'aborted') break;
                if (why === 'died') {
                    this.t.stopReason = 'died';
                    return;
                }
                if (why === 'food') await this.restock();
                else if (why === 'bank') await this.bank();
                if (!ctx.signal.aborted && Date.now() < until) await this.walk(KNIGHT_ANCHOR, 3);
            }
            this.t.stopReason = ctx.signal.aborted ? 'signal' : 'minutes';
        } finally {
            this.t.ticksAtKnights = this.s.tick - (this.t.arrivedTick ?? this.s.tick);
            this.t.xpGained = (thieving(this.s)?.experience ?? 0) - xp0;
        }
    }

    // ------------------------------------------------------------ travel

    private async toArdougne(): Promise<void> {
        const { ctx } = this;
        if (inEastArdougne(this.s)) return;
        const need = ctx.options.withdraw - coinsIn(this.s);
        if (need > 0) {
            const bank = inAlKharid(this.s) ? AL_KHARID_BANK : DRAYNOR_BANK;
            this.phase('travel');
            const r = await travelTo(ctx.bot, ctx.sdk, bank, { tolerance: 3, signal: ctx.signal, log: (m, d) => ctx.event(m, d) });
            if (!r.ok) throw new Error(`could not reach the bank at ${bank.x},${bank.z}: ${r.reason}`);
            this.phase('bank');
            const opened = await ctx.bot.openBank();
            if (!opened.success) throw new Error(`openBank: ${opened.message}`);
            const inBank = ctx.sdk.getBankItems().find(i => /^coins$/i.test(i.name))?.count ?? 0;
            const take = Math.min(inBank, need);
            if (take > 0) await ctx.bot.withdrawItem(/^coins$/i, take);
            await waitUntil(ctx.sdk, s => coinsIn(s) > 0, { maxTicks: 5 });
            ctx.event('withdrew coins', { take, bank: inBank, carried: coinsIn(this.s) });
            this.t.bankVisits++;
            await ctx.bot.closeBank();
            if (coinsIn(this.s) < 60 + (inAlKharid(this.s) ? 10 : 0)) throw new Error(`only ${coinsIn(this.s)} coins: the ships need 60 (and the toll 10)`);
        }
        this.phase('travel');
        if (inAlKharid(this.s)) {
            const r = await travelTo(ctx.bot, ctx.sdk, WEST_OF_GATE, { tolerance: 3, signal: ctx.signal });
            if (!r.ok) throw new Error(`could not leave Al Kharid: ${r.reason}`);
        }
        const t0 = this.s.tick;
        await sailTo({ bot: ctx.bot, sdk: ctx.sdk, log: (m, d) => ctx.event(m, d), walk: t => this.walk(t, 2) }, KNIGHT_ANCHOR);
        await this.walk(MARKET, 3);
        ctx.event('in East Ardougne', { ticks: this.s.tick - t0, coins: coinsIn(this.s), hp: this.s.player!.hp });
    }

    // ------------------------------------------------------------ pickpocketing

    /** Click a knight every tick until the minutes end or an errand is due. */
    private async pickpocket(until: number): Promise<'done' | 'aborted' | 'food' | 'bank' | 'died'> {
        const { ctx } = this;
        this.phase('knights');
        const sdk = ctx.sdk;
        let s = this.s;
        let lastXp = thieving(s)?.experience ?? 0;
        let lastCoins = coinsIn(s);
        let lastHp = s.player!.hp;
        let stunEnd = -100;
        let lastEat = -100;
        let lastProgress = s.tick;
        let target: number | null = null;
        const skip = new Map<number, number>();
        while (!ctx.signal.aborted) {
            s = await nextTick(sdk, s.tick);
            const p = s.player!;
            const t = s.tick;
            const xp = thieving(s)?.experience ?? lastXp;
            const coins = coinsIn(s);
            let success = false;
            if (xp > lastXp) {
                this.t.successes++;
                success = true;
                lastProgress = t;
            }
            if (coins > lastCoins) this.t.coinsGained += coins - lastCoins;
            if (p.hp < lastHp && p.hp > 0) {
                this.t.failures++;
                stunEnd = t + 8;
                lastProgress = t;
            }
            lastXp = xp;
            lastCoins = coins;
            if (p.isDead || p.hp <= 0) {
                this.t.deaths++;
                ctx.event('died', { coins, tick: t });
                return 'died';
            }
            lastHp = p.hp;
            if (Date.now() >= until) return 'done';
            if (s.dialog.isOpen) await sdk.sendClickDialog(0); // a level-up page blocks every op
            if (coins >= ctx.options.bankAt) return 'bank';

            const food = foodItems(s);
            const eat = eatDecision({ hp: p.hp, maxHp: p.maxHp, success, tick: t, stunEnd, lastEat, haveFood: food.length > 0 });
            if (eat) {
                const op = food[0]!.optionsWithIndex.find(o => /^eat$/i.test(o.text))!;
                await sdk.sendUseItem(food[0]!.slot, op.opIndex);
                this.t.foodEaten++;
                if (eat === 'free') this.t.eatsFree++;
                else {
                    this.t.eatsForced++;
                    this.t.eatTicks += FORCED_EAT_TICKS;
                }
                lastEat = t;
            } else if (food.length === 0 && p.hp <= KNIGHT_DAMAGE + 1) return 'food';

            if (cheb(here(s), KNIGHT_ANCHOR) > KNIGHT_RADIUS + 6) await sdk.sendWalk(KNIGHT_ANCHOR.x, KNIGHT_ANCHOR.z, true);
            if (t - lastProgress > 40) {
                // nothing resolved for 40 ticks: that knight is out of reach
                if (target !== null) skip.set(target, t + 100);
                target = null;
                lastProgress = t;
            }
            const knight = pickKnight(s, target, skip);
            target = knight?.index ?? null;
            const op = knight?.optionsWithIndex.find(o => /pickpocket/i.test(o.text));
            if (knight && op) await sdk.sendInteractNpc(knight.index, op.opIndex);
        }
        return 'aborted';
    }

    // ------------------------------------------------------------ food

    private async restock(): Promise<void> {
        const { ctx } = this;
        this.phase('food');
        this.t.restocks++;
        const o = ctx.options;
        const want = () => Math.min(o.food, foodItems(this.s).length + 28 - this.s.inventory.length) - foodItems(this.s).length;
        const shopOpen = () => o.foodSource.includes('shop') && this.s.tick - this.lastTheft >= BAKER_ALERT_TICKS;
        if (shopOpen() && want() > 0) await this.buyFood(want);
        if (o.foodSource.includes('stall') && want() > 0) await this.stealFood(want);
        // sold out (the stock is shared and restocks): wait at the shop rather than give up
        for (let i = 0; i < SOLD_OUT_RETRIES && shopOpen() && foodItems(this.s).length === 0 && !ctx.signal.aborted; i++) {
            ctx.event('baker sold out: waiting for the restock', { ticks: SOLD_OUT_WAIT_TICKS });
            await waitTicks(ctx.sdk, SOLD_OUT_WAIT_TICKS);
            await this.buyFood(want);
        }
        ctx.event('restocked', { food: foodItems(this.s).length, hp: this.s.player!.hp, coins: coinsIn(this.s) });
        if (foodItems(this.s).length === 0 && this.s.player!.hp <= KNIGHT_DAMAGE + 1) throw new Error('no food to be had and too few hitpoints for the knights');
    }

    private async buyFood(want: () => number): Promise<void> {
        const { ctx } = this;
        const baker = ctx.sdk.findNearbyNpc(BAKER);
        if (!baker) await this.walk({ x: 2669, z: 3312 }, 3);
        const opened = await ctx.bot.openShop(BAKER);
        if (!opened.success) {
            ctx.event('baker shop did not open', { message: opened.message });
            return;
        }
        const coins0 = coinsIn(this.s);
        let bought = 0;
        for (const name of SHOP_FOOD) {
            const item = this.s.shop.shopItems.find(i => i.name === name);
            const n = Math.min(want(), item?.count ?? 0);
            if (n <= 0 || coinsIn(this.s) <= 0) continue;
            const r = await ctx.bot.buyFromShop(name, n);
            bought += r.amountBought ?? 0;
        }
        await ctx.bot.closeShop();
        this.t.foodBought += bought;
        this.t.coinsOnFood += coins0 - coinsIn(this.s);
        ctx.event('bought food', { bought, gp: coins0 - coinsIn(this.s), stock: this.s.shop.shopItems.filter(i => SHOP_FOOD.includes(i.name)).map(i => `${i.name} ${i.count}`) });
    }

    /**
     * kits.ts's stall loop without its drops: steal while the stall is up and no combat contact
     * came in the last STALL_BACKOFF_TICKS, eat below half, and leave on a contact below half health
     * or after 600 ticks. Bread and chocolate slices are kept: both are food.
     */
    private async stealFood(want: () => number): Promise<void> {
        const { ctx } = this;
        const sdk = ctx.sdk;
        await this.walk(BAKER_STALL_TILE, 0);
        let contact = -STALL_BACKOFF_TICKS;
        const t0 = this.s.tick;
        const food0 = foodItems(this.s).length;
        while (!ctx.signal.aborted && want() > 0 && this.s.tick - t0 < 600) {
            const s = await nextTick(sdk, this.s.tick);
            contact = lastContact(s, contact);
            const p = s.player!;
            if (p.hp * 2 < p.maxHp) {
                const f = foodItems(s)[0];
                if (f && s.tick - contact >= 2) await ctx.bot.eatFood(f);
                else if (s.tick - contact < STALL_BACKOFF_TICKS) {
                    ctx.event('stall: left on a guard contact', { hp: p.hp });
                    break;
                }
                continue;
            }
            if (p.worldX !== BAKER_STALL_TILE.x || p.worldZ !== BAKER_STALL_TILE.z) {
                await sdk.sendWalk(BAKER_STALL_TILE.x, BAKER_STALL_TILE.z, true);
                continue;
            }
            const stall = s.nearbyLocs.find(l => l.x === BAKER_STALL.x && l.z === BAKER_STALL.z && l.optionsWithIndex.some(o => /^steal/i.test(o.text)));
            if (stall && s.tick - contact >= STALL_BACKOFF_TICKS) {
                await sdk.sendInteractLoc(stall.x, stall.z, stall.id, stall.optionsWithIndex.find(o => /^steal/i.test(o.text))!.opIndex);
                this.t.stallSteals++;
                this.lastTheft = s.tick;
            }
        }
        this.t.foodStolen += Math.max(0, foodItems(this.s).length - food0);
        ctx.event('stall', { clicks: this.t.stallSteals, food: foodItems(this.s).length, ticks: this.s.tick - t0 });
    }

    // ------------------------------------------------------------ bank

    private async bank(): Promise<void> {
        const { ctx } = this;
        this.phase('bank');
        await this.walk(ARDOUGNE_SOUTH_BANK, 2);
        const opened = await ctx.bot.openBank();
        if (!opened.success) {
            ctx.event('bank failed', { message: opened.message });
            return;
        }
        const amount = coinsIn(this.s) - ctx.options.keepCoins;
        if (amount > 0) {
            const r = await ctx.bot.depositItem(/^coins$/i, amount);
            if (r.success) this.t.coinsBanked += amount;
        }
        this.t.bankVisits++;
        ctx.event('banked', { amount, bank: ctx.sdk.getBankItems().find(i => /^coins$/i.test(i.name))?.count ?? 0 });
        await ctx.bot.closeBank();
    }
}

export const knightsProbe: ProbeSpec<KnightsOptions> = {
    name: 'probe-knights',
    usage: KNIGHTS_USAGE,
    parse: parseKnights,
    items: { food: FOOD },
    run: async ctx => new KnightsProbe(ctx).run(),
};

if (import.meta.main) process.exit(await runProbe(knightsProbe, process.argv.slice(2)));
