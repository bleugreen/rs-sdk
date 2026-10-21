// Bar supplier: mines ore and coal around Falador and smelts mithril / adamantite bars,
// plus steel and iron bars to a per-account quota.
//
//   bun speedrun/helpers/smelter.ts <account>            (ROLE_OPTIONS='{"mode":"full"}')
//
// Modes (options.mode):
//   full  (default) train Mining and Smithing from a fresh account, mine ore + coal, smelt
//         bars at the Falador furnace, bank everything at Falador east bank.
//   mine  only mine (no Smithing needed): bank ore and coal for a separate smelter.
//   smelt only smelt what is already in this account's bank (ore handed over by trade).
// Other options:
//   tier        'auto' | 'mithril' | 'adamant'  which bars to smelt (auto: adamantite when
//               the account has Smithing 70 and the ore, otherwise mithril)
//   site        'auto' | 'guild' | 'west' | 'rimmington' | 'barbarian' | 'dwarven'   where to mine
//               (auto: west or Rimmington below Mining 60, the Mining Guild from 60, the addy
//               site once the account can make adamantite bars; barbarian is coal only)
//   addy        'dwarven' | 'none'   where an adamant-tier account mines adamantite ore (dwarven:
//               the Dwarven Mine through the Mining Guild's south door; none: stay in the guild)
//   combat      combat level to train to on Lumbridge cows before using a site whose NPCs
//               attack (default: the site's own threshold + 2)
//   steel, iron bars of each to hold in this account's bank (default 0); the role buys the iron
//               ore on the Grand Exchange (or mines it while it waits for adamantite respawns)
//               and smelts with banked coal
//   buyOre      false to never buy iron ore (default true: buy at the ask up to maxOrePrice,
//               funded by coins and then by selling coal the quotas do not need)
//   maxOrePrice highest iron ore ask to pay (default 200 gp)
//   smeltMin    bars' worth of ore and coal in the bank before a production (mithril or
//               adamantite) smelting session starts (25); smelt mode ignores it
//   pickaxe     false to never buy pickaxes (default true: sell steel bars, iron bars and,
//               if needed, coal on the Grand Exchange and buy adamant/rune from Nurmof)
//
// Every cycle re-derives what to do from observed state (position, inventory, last bank
// snapshot), so the role restarts cleanly from any point: tutorial, mid-trip, full
// inventory, at the furnace, after a relog.
import type { BotActions } from '../../sdk/actions';
import type { BotSDK } from '../../sdk/index';
import type { BotWorldState, InventoryItem, NearbyLoc } from '../../sdk/types';
import { COW_CENTRE, COW_FIELD, Run as CombatRun, parseOptions as combatOptions } from './bones';
import { Buyer } from './buyer';
import { pointMarketAtServer } from './mule';
import { runStandalone, type Role, type RoleContext } from './role';

// ---------------------------------------------------------------- ids (server/content/pack)

const ITEM = {
    copper: 436, tin: 438, iron: 440, coal: 453, mith: 447, addy: 449,
    bronzeBar: 2349, ironBar: 2351, steelBar: 2353, mithBar: 2359, addyBar: 2361,
    coins: 995
} as const;

/** Best first. level = Mining level to use it (pickaxe_checker.rs2), price at Nurmof. */
const PICKAXES = [
    { id: 1275, name: 'Rune pickaxe', level: 41, price: 32000 },
    { id: 1271, name: 'Adamant pickaxe', level: 31, price: 3200 },
    { id: 1273, name: 'Mithril pickaxe', level: 21, price: 1300 },
    { id: 1269, name: 'Steel pickaxe', level: 6, price: 500 },
    { id: 1267, name: 'Iron pickaxe', level: 1, price: 140 },
    { id: 1265, name: 'Bronze pickaxe', level: 1, price: 1 }
];
const PICKAXE_IDS = new Set(PICKAXES.map(p => p.id));
/** Varrock west bank's exchange table; openGE() walks here itself but with a 120 s budget. */
const GE_STAND = { x: 3181, z: 3443 };

type Ore = 'copper' | 'tin' | 'iron' | 'coal' | 'mith' | 'addy';
const ROCKS: Record<Ore, number[]> = {
    copper: [2090, 2091], tin: [2094, 2095], iron: [2092, 2093],
    coal: [2096, 2097], mith: [2102, 2103], addy: [2104, 2105]
};
const ORE_ITEM: Record<Ore, number> = {
    copper: ITEM.copper, tin: ITEM.tin, iron: ITEM.iron, coal: ITEM.coal, mith: ITEM.mith, addy: ITEM.addy
};
const ORE_LEVEL: Record<Ore, number> = { copper: 1, tin: 1, iron: 15, coal: 30, mith: 55, addy: 70 };
const ROCK_ORE = new Map<number, Ore>();
for (const [ore, ids] of Object.entries(ROCKS) as [Ore, number[]][]) for (const id of ids) ROCK_ORE.set(id, ore);

/** Smelting recipes (smelting.struct) and the furnace interface's "Smelt 10" buttons (interface.pack). */
export type Bar = 'bronze' | 'iron' | 'steel' | 'mith' | 'addy';
const BARS: Record<Bar, { bar: number; ore: number; second?: number; secondCount: number; level: number; smelt10: number }> = {
    bronze: { bar: ITEM.bronzeBar, ore: ITEM.copper, second: ITEM.tin, secondCount: 1, level: 1, smelt10: 2807 },
    iron: { bar: ITEM.ironBar, ore: ITEM.iron, secondCount: 0, level: 15, smelt10: 3989 },
    steel: { bar: ITEM.steelBar, ore: ITEM.iron, second: ITEM.coal, secondCount: 2, level: 30, smelt10: 3997 },
    mith: { bar: ITEM.mithBar, ore: ITEM.mith, second: ITEM.coal, secondCount: 4, level: 50, smelt10: 6397 },
    addy: { bar: ITEM.addyBar, ore: ITEM.addy, second: ITEM.coal, secondCount: 6, level: 70, smelt10: 7443 }
};

// ---------------------------------------------------------------- places (server/content/maps)

type Point = { x: number; z: number };
const BANK_EAST: Point = { x: 3013, z: 3357 }; // Falador east bank, booths on z=3354
const BANK_WEST: Point = { x: 2946, z: 3369 }; // Falador west bank, booths on z=3367; nearest the furnace
const BANK_EDGE: Point = { x: 3093, z: 3491 }; // Edgeville bank, booths on x=3095-3098 (no furnace here in 2004)
const FURNACE: Point = { x: 2974, z: 3370 }; // Falador furnace at 2975,3368
const NURMOF: Point = { x: 2998, z: 9846 }; // pickaxe shop, north Dwarven Mine
// The Dwarven Mine's north entrance (trapdoor in the Ice Mountain hut) lands among
// non-aggressive dwarves beside Nurmof. Its south entrance (stairs east of Falador) lands
// among 12 scorpions and 2 king scorpions, aggressive below combat 29: never use it.
const ICE_TRAPDOOR: Point = { x: 3019, z: 3450 };
const LADDERS_UP = new Set([1755]); // ladder_from_cellar (guild cellar, Nurmof)

interface Site {
    name: 'guild' | 'west' | 'rimmington' | 'barbarian' | 'dwarven';
    /** Underground sites: surface loc that leads down. */
    down?: { id: number; x: number; z: number };
    /**
     * Sites entered from another site through a door: the door loc, and the tiles to stand
     * on before using it from `from` (outside) and from this site (inside).
     */
    door?: { from: Site['name']; id: number; at: Point; outside: Point; inside: Point };
    box: { x0: number; x1: number; z0: number; z1: number };
    centre: Point;
    bank: Point;
    /**
     * Lowest combat level its aggressive NPCs ignore: outside the Wilderness a `cowardly`
     * NPC hunts only players at most twice its level (Npc.ts, HuntCheckNotTooStrong).
     */
    combat?: number;
    /** NPCs that attack even at `combat`: rocks near them are skipped, a hit means retreat. */
    danger?: RegExp;
}
const SITES: Record<Site['name'], Site> = {
    // miningguildladder (Mining 60) -> ladder_from_cellar. 5 mithril, ~37 coal, only dwarves.
    guild: { name: 'guild', down: { id: 2113, x: 3019, z: 3339 }, box: { x0: 3014, x1: 3058, z0: 9728, z1: 9755 }, centre: { x: 3042, z: 9740 }, bank: BANK_EAST }, // the ladder lands at 3017,9739
    // North Dwarven Mine, through the guild's south door (miningguilddoor, Mining 60, walks the
    // player through and shuts). 3 adamantite, 2 mithril, 5 iron, 10 coal. 10 scorpions (level
    // 14, hunt range 2, wander 12) ignore combat 29+; the 2 king scorpions (32, spawns 3040,9775
    // and 3048,9770, wander 8) attack below 65 and sit beside two of the adamantite rocks.
    dwarven: {
        name: 'dwarven',
        door: { from: 'guild', id: 2112, at: { x: 3046, z: 9756 }, outside: { x: 3046, z: 9755 }, inside: { x: 3046, z: 9757 } },
        box: { x0: 3030, x1: 3056, z0: 9757, z1: 9779 },
        centre: { x: 3039, z: 9766 },
        bank: BANK_EAST,
        combat: 29,
        danger: /^king scorpion$/i
    },
    // West of Falador: 2 copper, 6 tin, 3 iron, 2 coal, no NPC spawns.
    west: { name: 'west', box: { x0: 2898, x1: 2915, z0: 3348, z1: 3371 }, centre: { x: 2907, z: 3360 }, bank: BANK_WEST },
    // Rimmington: 6 iron, 5 copper, 2 tin, no NPC spawns.
    rimmington: { name: 'rimmington', box: { x0: 2963, x1: 2991, z0: 3228, z1: 3253 }, centre: { x: 2975, z: 3240 }, bank: BANK_WEST },
    // Barbarian Village: 4 coal (3087-3089, 3431-3434), barbarians and goblins never attack.
    // Coal only and no furnace nearby: an opt-in site for mine-mode accounts when the guild is camped.
    barbarian: { name: 'barbarian', box: { x0: 3082, x1: 3094, z0: 3426, z1: 3438 }, centre: { x: 3088, z: 3430 }, bank: BANK_EDGE }
};
const TRAINING_SITES: Site['name'][] = ['west', 'rimmington'];
const ADDY_SITES = ['dwarven'] as const;
type AddySite = (typeof ADDY_SITES)[number];

const underground = (z: number) => z > 6400;
const inBox = (b: Site['box'], x: number, z: number) => x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1;

// ---------------------------------------------------------------- options

interface Opts {
    mode: 'full' | 'mine' | 'smelt';
    tier: 'auto' | 'mithril' | 'adamant';
    site: 'auto' | Site['name'];
    addy: AddySite | 'none';
    /** Combat level to train to before an aggressive site; null: the site's threshold + 2. */
    combat: number | null;
    smeltMin: number;
    pickaxe: boolean;
    quota: Quota;
    buyOre: boolean;
    maxOrePrice: number;
}
export interface Quota {
    steel: number;
    iron: number;
}
export function readOpts(o: Record<string, unknown>): Opts {
    const pick = <T extends string>(v: unknown, allowed: readonly T[], d: T): T => (allowed.includes(v as T) ? (v as T) : d);
    const count = (v: unknown) => (typeof v === 'number' && v > 0 ? Math.floor(v) : 0);
    return {
        mode: pick(o.mode, ['full', 'mine', 'smelt'] as const, 'full'),
        tier: pick(o.tier, ['auto', 'mithril', 'adamant'] as const, 'auto'),
        site: pick(o.site, ['auto', 'guild', 'west', 'rimmington', 'barbarian', 'dwarven'] as const, 'auto'),
        addy: pick(o.addy, [...ADDY_SITES, 'none'] as const, 'dwarven'),
        combat: typeof o.combat === 'number' && o.combat > 0 ? o.combat : null,
        smeltMin: typeof o.smeltMin === 'number' && o.smeltMin > 0 ? o.smeltMin : 25,
        pickaxe: o.pickaxe !== false,
        quota: { steel: count(o.steel), iron: count(o.iron) },
        buyOre: o.buyOre !== false,
        maxOrePrice: typeof o.maxOrePrice === 'number' && o.maxOrePrice > 0 ? o.maxOrePrice : 200
    };
}

/** Coal kept back from sales: the quotas' steel (2 per bar), banked adamantite ore (6 each), and a margin. */
const COAL_MARGIN = 300;

export interface OrePlan {
    /** Iron ore to buy. */
    buy: number;
    /** Coal to sell first so the coins cover it. */
    sellCoal: number;
}

/**
 * How much iron ore to buy at `ask` and how much coal to sell at `coalBid` to pay for it,
 * keeping the coal the bars still need. Buys less than `need` when coins and spare coal
 * cannot cover it all; null when nothing can be bought.
 */
export function planOreBuy(need: number, ask: number, coins: number, coal: number, coalNeeded: number, coalBid: number | null): OrePlan | null {
    if (need <= 0 || ask <= 0) return null;
    const spare = Math.max(0, coal - coalNeeded - COAL_MARGIN);
    const perCoal = coalBid && coalBid > 0 ? coalBid * 0.95 : 0;
    const affordable = Math.floor((coins + Math.floor(spare * perCoal)) / ask);
    const buy = Math.min(need, affordable);
    if (buy <= 0) return null;
    const short = buy * ask - coins;
    const sellCoal = short > 0 ? Math.min(spare, Math.ceil(short / perCoal)) : 0;
    return { buy, sellCoal };
}

class Abort extends Error {}

// ---------------------------------------------------------------- decisions (pure)

export interface BarChoice {
    smithing: number;
    /** Banked count of an item id. */
    banked: (id: number) => number;
    mode: Opts['mode'];
    tier: Opts['tier'];
    smeltMin: number;
    /** A session is under way: any complete set keeps it going. */
    continuing: boolean;
    /** Steel and iron bars to hold in the bank (made from banked iron ore and coal). */
    quota?: Quota;
}

/** Iron smelts fail half the time without a Ring of Forging (smelting.rs2). */
const IRON_ORE_PER_BAR = 2;
/** Furnace trips per inventory: sets that fit in 28 slots. */
const perTrip = (b: Bar) => Math.floor(28 / (1 + BARS[b].secondCount));

/** Bars still owed to each quota, given banked bars. */
export function quotaShort(q: Quota, banked: (id: number) => number) {
    return { steel: Math.max(0, q.steel - banked(ITEM.steelBar)), iron: Math.max(0, q.iron - banked(ITEM.ironBar)) };
}

/** Iron ore still to mine for the quotas, after what is held (bank plus inventory). */
export function ironOreShort(q: Quota, held: (id: number) => number) {
    const short = quotaShort(q, held);
    return Math.max(0, short.steel + IRON_ORE_PER_BAR * short.iron - held(ITEM.iron));
}

/**
 * Which bar to smelt next from banked materials, or null. A production tier (mithril,
 * adamantite) starts a session only with `smeltMin` sets banked, so the furnace walk is
 * paid once per batch; smelt mode smelts whatever it has. Quota bars (steel, iron) start
 * a session with a full trip's worth, or whatever the quota still needs. Training bars are
 * made only in full mode below Smithing 50.
 */
export function chooseBar(c: BarChoice): Bar | null {
    const sets = (b: Bar) => {
        const r = BARS[b];
        const ore = c.banked(r.ore);
        return r.second ? Math.min(ore, Math.floor(c.banked(r.second) / r.secondCount)) : ore;
    };
    if (c.tier !== 'mithril' && c.smithing >= BARS.addy.level) {
        const n = sets('addy');
        if (n > 0 && (c.continuing || c.mode === 'smelt' || n >= c.smeltMin)) return 'addy';
    }
    if (c.quota) {
        const short = quotaShort(c.quota, c.banked);
        for (const b of ['steel', 'iron'] as const) {
            if (short[b] <= 0 || c.smithing < BARS[b].level) continue;
            const need = b === 'iron' ? IRON_ORE_PER_BAR * short[b] : short[b];
            const n = sets(b);
            if (n > 0 && (c.continuing || n >= Math.min(perTrip(b), need))) return b;
        }
    }
    if ((c.tier !== 'adamant' || c.smithing < 70) && c.smithing >= BARS.mith.level) {
        const n = sets('mith');
        if (n > 0 && (c.continuing || c.mode === 'smelt' || n >= c.smeltMin)) return 'mith';
    }
    if (c.smithing >= 50 || c.mode !== 'full') return null;
    if (c.smithing >= 30 && sets('steel') >= 9) return 'steel';
    if (c.smithing >= 15 && c.smithing < 30 && sets('iron') >= 10) return 'iron';
    if (c.smithing < 15 && sets('bronze') >= 5) return 'bronze';
    return null;
}

export type Pickaxe = (typeof PICKAXES)[number];
export interface Sellable {
    id: number;
    n: number;
    /** Current best bid, gp each. */
    price: number;
}
/** Coins left over after the purchase, for rounding and the next shop visit. */
const PURCHASE_MARGIN = 50;
const afterTax = (n: number, price: number) => Math.floor(n * price * 0.95);

/**
 * The best pickaxe in `candidates` (best first) that coins plus everything in `offers`
 * can fund after the exchange's 5% tax, and what to sell for it. Offers are sold in the
 * order given; bars are surplus and sold whole, coal is product and sold only as far as
 * the price needs.
 */
export function planPickaxePurchase(candidates: readonly Pickaxe[], coins: number, offers: readonly Sellable[]): { target: Pickaxe; sell: Sellable[] } | null {
    const worth = coins + offers.reduce((sum, o) => sum + afterTax(o.n, o.price), 0);
    const target = candidates.find(p => p.price + PURCHASE_MARGIN <= worth);
    if (!target) return null;
    const goal = target.price + PURCHASE_MARGIN;
    const sell: Sellable[] = [];
    let funds = coins;
    for (const o of offers) {
        if (funds >= goal) break;
        const need = Math.ceil((goal - funds) / (o.price * 0.95));
        const take = o.id === ITEM.coal ? Math.min(o.n, need) : o.n;
        sell.push({ ...o, n: take });
        funds += afterTax(take, o.price);
    }
    return { target, sell };
}

/** Why mineRock stopped working a rock; counted per inventory so a slow inventory explains itself. */
type RockOutcome = 'ore' | 'full' | 'depleted' | 'switched' | 'gaveUp' | 'timeout' | 'attacked';

const cheb = (a: Point, b: Point) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
/** Ticks after a hit during which we count as under attack. */
const HIT_WINDOW = 2;

// ---------------------------------------------------------------- the role

class Smelter {
    private bot: BotActions;
    private sdk: BotSDK;
    private o: Opts;
    /** Last observed bank contents (id -> count); null until the first bank visit. */
    private bank: Map<number, number> | null = null;
    private shopCooldownUntil = 0;
    /** Training mine in use below Mining 60; rotates when its rocks are camped. */
    private trainSite: Site['name'] = 'west';
    private stats = { start: Date.now(), startTick: 0, trips: 0, smelted: 0 };
    /** Adamantite bookkeeping at an addy site: ore we mined, rocks others emptied in view, retreats. */
    private addy = { ore: 0, others: 0, retreats: 0, lastOreTick: 0 };
    /** Live adamantite rocks seen last tick ("x,z"), and the one we just emptied ourselves. */
    private liveAddy = new Set<string>();
    private ourAddyTile: string | null = null;
    private combatRun: CombatRun | null = null;

    constructor(private ctx: RoleContext) {
        this.bot = ctx.bot;
        this.sdk = ctx.sdk;
        this.o = readOpts(ctx.options);
        pointMarketAtServer(this.sdk);
    }

    // ------------------------------------------------------------ state helpers

    private s(): BotWorldState {
        const s = this.sdk.getState();
        if (!s) throw new Error('no world state');
        return s;
    }
    private check() {
        if (this.ctx.signal.aborted) throw new Abort();
    }
    private lvl(skill: string) {
        return this.sdk.getSkill(skill)?.baseLevel ?? 1;
    }
    private inv(id: number) {
        return this.s().inventory.filter(i => i.id === id).reduce((n, i) => n + i.count, 0);
    }
    private banked(id: number) {
        return this.bank?.get(id) ?? 0;
    }
    private have(id: number) {
        return this.inv(id) + this.banked(id);
    }
    private pos() {
        const p = this.s().player!;
        return { x: p.worldX, z: p.worldZ };
    }
    private async ticks(n: number) {
        this.check();
        await this.sdk.waitForTicks(n);
    }
    /** Best pickaxe usable at the current Mining level, in inventory or (last seen) bank. */
    private bestPickaxe(where: 'inv' | 'any') {
        const m = this.lvl('mining');
        return PICKAXES.find(p => p.level <= m && (this.inv(p.id) > 0 || (where === 'any' && this.banked(p.id) > 0)));
    }
    private inTutorial() {
        const { x, z } = this.pos();
        return x >= 3050 && x <= 3160 && z >= 3050 && z <= 3135;
    }

    /**
     * Where to mine next. The guild from Mining 60 when coal or mithril is what we need;
     * a surface training mine for copper, tin and iron (and below 60).
     */
    private combatLevel() {
        return this.s().player?.combatLevel ?? 3;
    }

    /** The adamantite site, once this account mines adamantite ore for bars (or for a smelter in mine mode). */
    private addySite(): Site | null {
        if (this.o.addy === 'none' || this.o.tier === 'mithril' || this.o.mode === 'smelt') return null;
        if (this.lvl('mining') < ORE_LEVEL.addy) return null;
        if (this.o.mode === 'full' && this.lvl('smithing') < BARS.addy.level) return null;
        return SITES[this.o.site !== 'auto' && ADDY_SITES.includes(this.o.site as AddySite) ? this.o.site : this.o.addy];
    }

    private combatNeeded(site: Site) {
        return this.o.combat ?? (site.combat ? site.combat + 2 : 0);
    }

    /** Hit within the last HIT_WINDOW ticks. */
    private underAttack() {
        const s = this.s();
        const t = s.player?.combat?.lastDamageTick ?? -1;
        return t >= 0 && s.tick - t <= HIT_WINDOW;
    }

    private site(): Site {
        if (this.o.site !== 'auto') return SITES[this.o.site];
        if (this.lvl('mining') < 60) return SITES[this.trainSite];
        const addy = this.addySite();
        if (addy) return addy;
        const first = this.wanted().find(o => o !== 'mith' && o !== 'addy');
        return first && first !== 'coal' ? SITES[this.trainSite] : SITES.guild;
    }

    private siteAt(): Site | undefined {
        const { x, z } = this.pos();
        return Object.values(SITES).find(st => inBox(st.box, x, z));
    }

    /** The bank for where we are: the site's own bank, else the nearest of Falador east/west and Edgeville. */
    private nearestBank(): Point {
        const site = this.siteAt();
        if (site) return site.bank;
        const { x, z } = this.pos();
        if (underground(z)) return BANK_EAST;
        const d = (b: Point) => Math.hypot(x - b.x, z - b.z);
        return [BANK_EAST, BANK_WEST, BANK_EDGE].reduce((a, b) => (d(b) < d(a) ? b : a));
    }

    // ------------------------------------------------------------ main loop

    async run() {
        this.stats.startTick = this.s().tick;
        this.ctx.log('start', { options: this.o, mining: this.lvl('mining'), smithing: this.lvl('smithing') });
        // runStandalone discards the script result, so an escaping error would end the
        // process silently. Log it and re-plan instead; only the fleet's signal stops us.
        let errors = 0;
        for (;;) {
            try {
                this.check();
                await this.cycle();
                errors = 0;
            } catch (e) {
                if (e instanceof Abort || this.ctx.signal.aborted) {
                    this.ctx.log('stopped', { reason: 'signal' });
                    return;
                }
                errors++;
                this.ctx.log('cycle error', { error: String((e as Error)?.stack ?? e).slice(0, 600), errors });
                await new Promise(r => setTimeout(r, Math.min(60_000, 2_000 * errors)));
            }
        }
    }

    private phaseName = '';
    /** Coarse phase for watchers: training is long but must not look like a stuck loop. */
    private phase(): string {
        if (this.inTutorial()) return 'tutorial';
        if (this.o.mode === 'smelt') return 'smelt';
        const m = this.lvl('mining');
        const sm = this.lvl('smithing');
        if (this.o.mode === 'full' && sm < 50) return 'train-smithing';
        if (m < 60) return 'train-mining';
        const site = this.addySite();
        if (site && this.combatLevel() < this.combatNeeded(site)) return 'train-combat';
        const addy = m >= 70 && (this.o.mode === 'mine' || sm >= 70) && this.o.tier !== 'mithril';
        return addy ? `produce-adamant${site ? `:${site.name}` : ''}` : 'produce-mithril';
    }

    private async cycle() {
        const phase = this.phase();
        if (phase !== this.phaseName) {
            this.ctx.log('phase', { from: this.phaseName || null, to: phase, levels: { mining: this.lvl('mining'), smithing: this.lvl('smithing'), combat: this.combatLevel() } });
            this.phaseName = phase;
        }
        if (this.inTutorial()) {
            const r = await this.bot.skipTutorial();
            this.ctx.log('tutorial', { ok: r.success, why: r.message });
            await this.ticks(2);
            return;
        }
        await this.clearUi();

        const s = this.s();
        const full = s.inventory.length >= 28;
        const loot = s.inventory.some(i => !PICKAXE_IDS.has(i.id) && i.id !== ITEM.coins);
        // Bank first when we know nothing about the bank, carry anything, or lack a pickaxe.
        if (this.bank === null || full || (loot && !this.atMiningSite()) || (this.o.mode !== 'smelt' && !this.bestPickaxe('inv'))) {
            await this.bankVisit();
            return;
        }
        if (this.o.mode === 'smelt') {
            // Nothing to smelt: wait for a hand-over (the fleet or mule tops the bank up).
            this.ctx.log('idle', { reason: 'no ore to smelt' });
            for (let i = 0; i < 100; i++) await this.ticks(1);
            this.bank = null; // re-read the bank next cycle
            return;
        }
        if (phase === 'train-combat') {
            await this.trainCombat();
            return;
        }
        await this.mineInventory();
    }

    /**
     * Lumbridge cows until the combat level that the addy site's NPCs ignore. bones.ts owns
     * the fighting (style rotation, re-engage, gear upgrades); this only gets it to the surface.
     */
    private async trainCombat() {
        if (underground(this.pos().z) && !(await this.toSurface())) return;
        this.combatRun ??= new CombatRun(this.ctx, combatOptions({ fish: false }));
        await this.combatRun.equipUpgrades();
        await this.combatRun.surfaceFight({ npc: /^cow$/i, area: COW_FIELD, centre: COW_CENTRE, loot: null });
    }

    private atMiningSite() {
        return this.siteAt() !== undefined;
    }

    /** Close level-up dialogs and stray modals; never leave a product menu open. */
    private async clearUi() {
        const s = this.s();
        if (s.dialog.isOpen || s.modalOpen || s.interface?.isOpen) {
            await this.bot.dismissBlockingUI();
            const t = this.s();
            if (t.modalOpen || t.interface?.isOpen) {
                await this.sdk.sendCloseModal();
                await this.ticks(1);
            }
        }
    }

    // ------------------------------------------------------------ travel

    private async walk(x: number, z: number, tol = 2, timeout = 180_000) {
        for (let attempt = 0; attempt < 4; attempt++) {
            this.check();
            // Surface and underground are separate maps joined only by ladders.
            if (underground(z) !== underground(this.pos().z)) return false;
            const r = await this.bot.walkTo(x, z, tol, { timeout });
            const p = this.pos();
            if (Math.max(Math.abs(p.x - x), Math.abs(p.z - z)) <= tol + 1) return true;
            this.ctx.log('walk retry', { to: [x, z], at: [p.x, p.z], why: r.message });
            if (/died/i.test(r.message ?? '')) return false;
            await this.ticks(2);
        }
        return false;
    }

    /** Use a ladder/staircase and wait for the plane change (z jumps by 6400). */
    private async climb(locId: number, option: RegExp, wantUnderground: boolean) {
        for (let attempt = 0; attempt < 4; attempt++) {
            this.check();
            const loc = this.s().nearbyLocs.filter(l => l.id === locId).sort((a, b) => a.distance - b.distance)[0];
            if (!loc) {
                this.ctx.log('climb: loc not visible', { locId });
                return false;
            }
            await this.bot.interactLoc(loc, option);
            try {
                await this.sdk.waitForCondition(st => underground(st.player?.worldZ ?? 0) === wantUnderground, 15_000);
                await this.ticks(1);
                return true;
            } catch {
                await this.clearUi();
            }
        }
        return false;
    }

    /**
     * Pass `site`'s door: into the site (`entering`) or back out to the site it opens from.
     * The guild door walks the player through and shuts again, so success is judged by
     * which box we stand in, never by the door's state.
     */
    private async throughDoor(site: Site, entering: boolean) {
        const door = site.door!;
        const target = entering ? site : SITES[door.from];
        const done = () => {
            const { x, z } = this.pos();
            return inBox(target.box, x, z);
        };
        for (let attempt = 0; attempt < 4 && !done(); attempt++) {
            this.check();
            const stand = entering ? door.outside : door.inside;
            if (cheb(this.pos(), stand) > 1) await this.walk(stand.x, stand.z, 1, 60_000);
            const loc = this.s().nearbyLocs.find(l => l.id === door.id && l.x === door.at.x && l.z === door.at.z);
            if (!loc) {
                this.ctx.log('door not visible', { site: site.name, at: this.pos() });
                await this.ticks(2);
                continue;
            }
            const open = loc.optionsWithIndex.find(o => /open/i.test(o.text));
            await this.sdk.sendInteractLoc(loc.x, loc.z, loc.id, open?.opIndex ?? 1);
            try {
                await this.sdk.waitForCondition(st => !!st.player && inBox(target.box, st.player.worldX, st.player.worldZ), 6_000);
            } catch {
                await this.clearUi();
            }
        }
        if (!done()) this.ctx.log('door failed', { site: site.name, entering, at: this.pos() });
        return done();
    }

    /** Leave a door site the way it was entered (a door site's own box has no ladder). */
    private async leaveDoorSite() {
        const here = this.siteAt();
        return here?.door ? this.throughDoor(here, false) : true;
    }

    /** Climb out of the guild cellar or the north Dwarven Mine by the nearest ladder. */
    private async toSurface() {
        if (!underground(this.pos().z)) return true;
        if (!(await this.leaveDoorSite())) return false;
        let up = this.s().nearbyLocs.filter(l => LADDERS_UP.has(l.id)).sort((a, b) => a.distance - b.distance)[0];
        if (!up) {
            // Ladder out of sight: walk to the known one for this part of the mine.
            const { z } = this.pos();
            const target = z < 9800 ? { x: 3020, z: 9740 } : { x: 3019, z: 9849 };
            await this.walk(target.x, target.z, 2);
            up = this.s().nearbyLocs.filter(l => LADDERS_UP.has(l.id)).sort((a, b) => a.distance - b.distance)[0];
        }
        if (!up) {
            this.ctx.log('no ladder up in view', { at: this.pos() });
            return false;
        }
        if (up.distance > 3) await this.walk(up.x, up.z, 2);
        return this.climb(up.id, /climb-up/i, false);
    }

    private async toSite(site: Site): Promise<boolean> {
        const { x, z } = this.pos();
        if (inBox(site.box, x, z)) return true;
        const here = this.siteAt();
        if (here?.door && here.door.from === site.name) return this.throughDoor(here, false);
        if (site.door) {
            if (!(await this.toSite(SITES[site.door.from]))) return false;
            if (!(await this.throughDoor(site, true))) return false;
            return this.walk(site.centre.x, site.centre.z, 3);
        }
        if (underground(z) && !(await this.toSurface())) return false;
        if (!site.down) return this.walk(site.centre.x, site.centre.z, 4);
        if (!(await this.walk(site.down.x, site.down.z, 3))) return false;
        return this.climb(site.down.id, /climb-down/i, true);
    }

    /** Down the Ice Mountain trapdoor to Nurmof, avoiding the scorpions in the south mine. */
    private async toNurmof() {
        if (!underground(this.pos().z)) {
            if (!(await this.walk(ICE_TRAPDOOR.x, ICE_TRAPDOOR.z - 1, 2, 240_000))) return false;
            for (let attempt = 0; attempt < 3 && !underground(this.pos().z); attempt++) {
                const door = this.s().nearbyLocs.filter(l => /trapdoor/i.test(l.name)).sort((a, b) => a.distance - b.distance)[0];
                if (!door) return false;
                const climb = door.optionsWithIndex.find(o => /climb-down/i.test(o.text));
                if (!climb) {
                    await this.bot.interactLoc(door, /open/i);
                    await this.ticks(2);
                    continue;
                }
                await this.climb(door.id, /climb-down/i, true);
            }
        }
        return underground(this.pos().z) && this.walk(NURMOF.x, NURMOF.z, 3);
    }

    private async toBank(bank: Point = this.nearestBank()) {
        if (underground(this.pos().z) && !(await this.toSurface())) return false;
        return this.walk(bank.x, bank.z, 3);
    }

    // ------------------------------------------------------------ banking

    private async openBank(): Promise<boolean> {
        for (let attempt = 0; attempt < 4; attempt++) {
            this.check();
            if (!this.s().bank.isOpen) {
                const r = await this.bot.openBank();
                if (!r.success) {
                    this.ctx.log('openBank failed', { why: r.message });
                    await this.ticks(2);
                    continue;
                }
            }
            // The item list lands a tick or more after the interface opens.
            try {
                await this.sdk.waitForCondition(st => st.bank.isOpen && st.bank.items.length > 0, 5_000);
            } catch {
                /* an empty bank is legitimate */
            }
            if (this.s().bank.isOpen) return true;
        }
        return false;
    }

    private snapshotBank() {
        const items = this.sdk.getBankItems();
        this.bank = new Map();
        for (const it of items) this.bank.set(it.id, (this.bank.get(it.id) ?? 0) + it.count);
        this.ctx.reportBank({ items: items.map(i => ({ id: i.id, name: i.name, count: i.count })) });
    }

    /** Deposit every inventory item except `keep` ids. */
    private async depositAllExcept(keep: Set<number>) {
        for (let pass = 0; pass < 3; pass++) {
            const todo = [...new Set(this.s().inventory.filter(i => !keep.has(i.id)).map(i => i.id))];
            if (todo.length === 0) return true;
            for (const id of todo) {
                const item = this.s().inventory.find(i => i.id === id);
                if (item) await this.bot.depositItem(item, -1);
            }
        }
        return this.s().inventory.every(i => keep.has(i.id));
    }

    private async withdraw(id: number, count: number, asNote = false) {
        const item = this.sdk.getBankItems().find(b => b.id === id);
        if (!item || count <= 0) return 0;
        const r = await this.bot.withdrawItem(item, Math.min(count, item.count), { asNote });
        return r.amountWithdrawn ?? (r.success ? Math.min(count, item.count) : 0);
    }

    private async bankVisit() {
        const t0 = this.s().tick;
        if (!(await this.toBank()) || !(await this.openBank())) {
            this.ctx.log('bank unreachable');
            await this.ticks(5);
            return;
        }
        const carried = this.s().inventory.filter(i => !PICKAXE_IDS.has(i.id)).map(i => `${i.name}x${i.count}`);
        // Keep the best usable pickaxe in the inventory; bank everything else.
        this.snapshotBank();
        const best = this.bestPickaxe('any');
        await this.depositAllExcept(new Set(best && this.inv(best.id) > 0 ? [best.id] : []));
        this.snapshotBank();
        this.stats.trips++;
        this.ctx.log('bank', { carried, bankTicks: this.s().tick - t0, ...this.progress() });

        if (this.o.mode !== 'smelt' && !this.bestPickaxe('any')) {
            await this.replacePickaxe();
            return;
        }
        if (this.o.pickaxe && this.o.mode !== 'smelt' && (await this.maybeUpgradePickaxe())) return;
        if (this.o.mode !== 'mine' && (await this.maybeBuyOre())) return;
        if (this.o.mode !== 'mine') await this.smeltSession();

        if (this.o.mode !== 'smelt') {
            if (!this.s().bank.isOpen) await this.openBank();
            const pick = this.bestPickaxe('any');
            if (pick && this.inv(pick.id) === 0) await this.withdraw(pick.id, 1);
            if (!this.bestPickaxe('inv')) this.ctx.log('no usable pickaxe in bank or inventory');
        }
        if (this.s().bank.isOpen) await this.bot.closeBank();
    }

    private progress() {
        const hours = (Date.now() - this.stats.start) / 3_600_000;
        return {
            mining: this.lvl('mining'),
            smithing: this.lvl('smithing'),
            combat: this.combatLevel(),
            bank: {
                coal: this.banked(ITEM.coal), mith: this.banked(ITEM.mith), addy: this.banked(ITEM.addy), iron: this.banked(ITEM.iron),
                mithBar: this.banked(ITEM.mithBar), addyBar: this.banked(ITEM.addyBar), steelBar: this.banked(ITEM.steelBar),
                ironBar: this.banked(ITEM.ironBar), coins: this.banked(ITEM.coins)
            },
            addy: this.addy,
            hours: Math.round(hours * 100) / 100,
            ticks: this.s().tick - this.stats.startTick
        };
    }

    // ------------------------------------------------------------ smelting

    private nextBar(continuing: boolean): Bar | null {
        const { mode, tier, smeltMin, quota } = this.o;
        return chooseBar({ smithing: this.lvl('smithing'), banked: id => this.banked(id), mode, tier, smeltMin, continuing, quota });
    }

    private async smeltSession() {
        let bar = this.nextBar(false);
        if (!bar) return;
        const tierAtStart = bar;
        this.ctx.log('smelt session', { bar, ...this.progress() });
        // Free the pickaxe slot for the session (adamantite fits 4 sets in 28 slots, 3 in 27).
        while (bar && bar === tierAtStart) {
            this.check();
            if (!this.s().bank.isOpen && !(await this.openBank())) return;
            await this.depositAllExcept(new Set());
            const r = BARS[bar];
            const perSet = 1 + r.secondCount;
            const sets = Math.min(Math.floor(28 / perSet), this.banked(r.ore), r.second ? Math.floor(this.banked(r.second) / r.secondCount) : Infinity);
            if (sets <= 0) break;
            const gotOre = await this.withdraw(r.ore, sets);
            if (r.second) await this.withdraw(r.second, sets * r.secondCount);
            this.snapshotBank();
            if (gotOre === 0) break;
            await this.bot.closeBank();
            const t0 = this.s().tick;
            const made = await this.smeltInventory(bar);
            if (!(await this.toBank(BANK_WEST)) || !(await this.openBank())) return;
            await this.depositAllExcept(new Set());
            this.snapshotBank();
            this.stats.smelted += made;
            this.ctx.log('smelt trip', { bar, made, ticks: this.s().tick - t0, smithing: this.lvl('smithing') });
            if (made === 0) break;
            bar = this.nextBar(true) === bar ? bar : null;
        }
    }

    /** Walk to the furnace and smelt the carried ore into `bar`. Returns bars made. */
    private async smeltInventory(bar: Bar): Promise<number> {
        const r = BARS[bar];
        const before = this.inv(r.bar);
        if (!(await this.walk(FURNACE.x, FURNACE.z, 3))) return 0;
        // Each bar consumes one primary ore 4-5 ticks after the last (smelting.rs2: the
        // queue re-arms with delay 4). Every ore consumed is progress, including a failed
        // iron smelt. A level-up dialog ends the queue; re-open and click again after 7
        // quiet ticks. Give up after 4 clicks in a row that consume nothing.
        const QUIET = 7;
        let idle = QUIET;
        let fruitless = 0;
        let lastOre = this.inv(r.ore);
        let oreAtClick = lastOre;
        while (this.inv(r.ore) > 0 && (!r.second || this.inv(r.second) >= r.secondCount) && fruitless < 4) {
            this.check();
            if (idle >= QUIET) {
                if (this.inv(r.ore) === oreAtClick && oreAtClick !== -1) fruitless++;
                oreAtClick = this.inv(r.ore);
                await this.clearUi();
                const furnace = this.sdk.findNearbyLoc(/furnace/i, { withOption: /smelt/i });
                if (!furnace || furnace.distance > 6) {
                    await this.walk(FURNACE.x, FURNACE.z, 2);
                    idle = QUIET;
                    continue;
                }
                const smelt = furnace.optionsWithIndex.find(o => /smelt/i.test(o.text));
                await this.sdk.sendInteractLoc(furnace.x, furnace.z, furnace.id, smelt?.opIndex ?? 2);
                idle = 0;
                try {
                    await this.sdk.waitForCondition(st => st.dialog.isOpen || st.interface?.isOpen || st.modalOpen, 15_000);
                } catch {
                    idle = QUIET;
                    continue;
                }
                await this.sdk.sendClickComponent(r.smelt10);
            }
            await this.ticks(1);
            const ore = this.inv(r.ore);
            if (ore !== lastOre) {
                idle = 0;
                fruitless = 0;
            } else idle++;
            lastOre = ore;
        }
        await this.clearUi();
        return this.inv(r.bar) - before;
    }

    // ------------------------------------------------------------ mining

    /** Ores wanted right now, best first, given levels, mode and banked stock. */
    private wanted(): Ore[] {
        const m = this.lvl('mining');
        const sm = this.lvl('smithing');
        const ok = (o: Ore) => m >= ORE_LEVEL[o];
        // At the addy site: adamantite, plus iron while the bar quotas still lack ore (mined
        // in the respawn waits; mineRock drops it the moment an adamantite rock is live).
        if (this.addySite()) {
            const out: Ore[] = ['addy'];
            if (ironOreShort(this.o.quota, id => this.have(id)) > 0) out.push('iron');
            return out;
        }
        const out: Ore[] = [];
        if (ok('addy')) out.push('addy');
        if (ok('mith')) out.push('mith');
        if (this.o.mode === 'full' && sm < 50) {
            // Smithing training materials.
            if (sm < 15 || m < 15) {
                out.push(this.have(ITEM.copper) <= this.have(ITEM.tin) ? 'copper' : 'tin', 'copper', 'tin');
            } else if (sm < 30 || !ok('coal')) {
                out.push('iron');
                if (ok('coal')) out.push('coal');
            } else {
                // steel: 1 iron : 2 coal
                out.push(this.have(ITEM.coal) < 2 * this.have(ITEM.iron) ? 'coal' : 'iron', 'coal', 'iron');
            }
            return [...new Set(out)];
        }
        // Below the guild, level on iron (fast rocks, plenty at the training mines).
        if (m >= 60) out.push('coal');
        else if (ok('iron')) out.push('iron', 'coal');
        else out.push(this.have(ITEM.copper) <= this.have(ITEM.tin) ? 'copper' : 'tin', 'copper', 'tin');
        return [...new Set(out)];
    }

    private rockValue(ore: Ore, wanted: Ore[]) {
        if (ore === 'addy') return 100;
        if (ore === 'mith') return 60;
        const i = wanted.indexOf(ore);
        return i < 0 ? 0 : 10 - i;
    }

    /**
     * Pick the best live rock: value, then distance, avoiding rocks other players stand at.
     * A mithril or adamantite rock with a player beside it is skipped outright: one success
     * depletes it for 400-800 ticks, and the player already swinging usually wins it.
     */
    private chooseRock(site: Site, wanted: Ore[]): NearbyLoc | null {
        const s = this.s();
        const players = s.nearbyPlayers ?? [];
        const danger = site.danger ? s.nearbyNpcs.filter(n => site.danger!.test(n.name)) : [];
        let best: NearbyLoc | null = null;
        let bestScore = -Infinity;
        for (const loc of s.nearbyLocs) {
            const ore = ROCK_ORE.get(loc.id);
            if (!ore || !wanted.includes(ore) || !inBox(site.box, loc.x, loc.z) || loc.reachable === false) continue;
            const crowd = players.filter(p => Math.abs(p.x - loc.x) <= 1 && Math.abs(p.z - loc.z) <= 1).length;
            if (crowd > 0 && (ore === 'mith' || ore === 'addy')) continue;
            // Hunt range is 2; one tile of slack for the NPC's render position trailing its route tile.
            if (danger.some(n => cheb({ x: n.tileX ?? n.x, z: n.tileZ ?? n.z }, loc) <= 3)) continue;
            const score = this.rockValue(ore, wanted) * 10 - loc.distance - crowd * 40;
            if (score > bestScore) {
                bestScore = score;
                best = loc;
            }
        }
        return best;
    }

    private async mineInventory() {
        const site = this.site();
        if (!(await this.toSite(site))) {
            this.ctx.log('cannot reach site', { site: site.name });
            await this.ticks(10);
            return;
        }
        const t0 = this.s().tick;
        const got: Record<string, number> = {};
        const outcomes: Partial<Record<RockOutcome, number>> = {};
        let waited = 0;
        let emptyTicks = 0;
        while (this.s().inventory.length < 28) {
            this.check();
            const { x, z } = this.pos();
            if (!inBox(site.box, x, z)) {
                // Died, or dragged off by something: re-plan from wherever we are.
                this.ctx.log('left site', { site: site.name, at: [x, z], hp: this.s().player?.hp });
                break;
            }
            if (site.door && this.underAttack()) {
                await this.retreat(site);
                break;
            }
            this.observeAddy(site);
            const wanted = this.wanted();
            const rock = this.chooseRock(site, wanted);
            if (!rock) {
                if (emptyTicks > 60 && TRAINING_SITES.includes(site.name) && this.o.site === 'auto') {
                    // Camped: try the other training mine.
                    this.trainSite = TRAINING_SITES.find(n => n !== site.name)!;
                    this.ctx.log('training site camped', { site: site.name, next: this.trainSite, players: this.s().nearbyPlayers.length });
                    break;
                }
                // Everything depleted or crowded: stand near the middle and wait for respawns.
                if (emptyTicks++ % 20 === 0) {
                    const { x, z } = this.pos();
                    if (Math.abs(x - site.centre.x) + Math.abs(z - site.centre.z) > 6) await this.walk(site.centre.x, site.centre.z, 3);
                }
                waited++;
                await this.ticks(1);
                continue;
            }
            emptyTicks = 0;
            const ore = ROCK_ORE.get(rock.id)!;
            const { n, why } = await this.mineRock(rock, site, wanted);
            outcomes[why] = (outcomes[why] ?? 0) + 1;
            if (n > 0) got[ore] = (got[ore] ?? 0) + n;
            if (n > 0 && ore === 'addy') {
                const t = this.s().tick;
                this.addy.ore += n;
                this.ctx.log('addy', {
                    carried: this.inv(ITEM.addy), ore: this.addy.ore, others: this.addy.others, retreats: this.addy.retreats,
                    sinceLast: this.addy.lastOreTick ? t - this.addy.lastOreTick : null, players: this.playersIn(site)
                });
                this.addy.lastOreTick = t;
            }
            if (why === 'attacked') {
                await this.retreat(site);
                break;
            }
        }
        const spent = this.s().tick - t0;
        const pickaxe = this.bestPickaxe('inv')?.name ?? null;
        this.ctx.log('inventory', { site: site.name, got, ticks: spent, waited, outcomes, pickaxe, players: this.s().nearbyPlayers?.length ?? 0, mining: this.lvl('mining') });
        if (spent < 2) await this.ticks(5); // never spin if the site check keeps failing
    }

    /** Mine one rock until it yields, depletes, or a more valuable rock appears. */
    private async mineRock(rock: NearbyLoc, site: Site, wanted: Ore[]): Promise<{ n: number; why: RockOutcome }> {
        const ore = ROCK_ORE.get(rock.id)!;
        const item = ORE_ITEM[ore];
        const before = this.inv(item);
        const value = this.rockValue(ore, wanted);
        const option = rock.optionsWithIndex.find(o => /^mine$/i.test(o.text))?.opIndex ?? 1;
        const click = async () => {
            await this.clearUi();
            await this.sdk.sendInteractLoc(rock.x, rock.z, rock.id, option);
        };
        await click();
        let still = 0;
        let reclicks = 0;
        const deadline = this.s().tick + 200;
        let lastPos = this.pos();
        while (this.s().tick < deadline) {
            await this.ticks(1);
            const s = this.s();
            const gained = this.inv(item) - before;
            if (gained > 0) {
                if (ore === 'addy') this.ourAddyTile = `${rock.x},${rock.z}`;
                this.observeAddy(site);
                return { n: gained, why: 'ore' };
            }
            this.observeAddy(site);
            if (site.door && this.underAttack()) return { n: 0, why: 'attacked' };
            if (s.inventory.length >= 28) return { n: 0, why: 'full' }; // a gem filled the last slot
            // Depleted by someone else: the loc at that tile changed id without our ore.
            if (!s.nearbyLocs.some(l => l.x === rock.x && l.z === rock.z && l.id === rock.id)) return { n: 0, why: 'depleted' };
            if (s.dialog.isOpen) {
                await click();
                continue;
            }
            // A more valuable rock respawned: switch.
            if (value < 60) {
                const better = this.chooseRock(site, wanted);
                if (better && this.rockValue(ROCK_ORE.get(better.id)!, wanted) >= 60) return { n: 0, why: 'switched' };
            }
            const p = this.pos();
            const moving = p.x !== lastPos.x || p.z !== lastPos.z;
            lastPos = p;
            if (!moving && (s.player?.animId ?? -1) === -1) still++;
            else still = 0;
            if (still >= 4) {
                if (++reclicks > 3) return { n: 0, why: 'gaveUp' };
                still = 0;
                await click();
            }
        }
        return { n: 0, why: 'timeout' };
    }

    private playersIn(site: Site) {
        return (this.s().nearbyPlayers ?? []).filter(p => inBox(site.box, p.x, p.z)).length;
    }

    /**
     * Count adamantite rocks that went from live to depleted in view without our ore: the
     * measure of contention at the site. Rocks more than 12 tiles away are ignored, so a
     * rock leaving view is not mistaken for one mined by someone else.
     */
    private observeAddy(site: Site) {
        const me = this.pos();
        const live = new Set<string>();
        for (const l of this.s().nearbyLocs) {
            if (ROCK_ORE.get(l.id) === 'addy' && inBox(site.box, l.x, l.z) && cheb(me, l) <= 12) live.add(`${l.x},${l.z}`);
        }
        for (const k of this.liveAddy) {
            if (live.has(k) || k === this.ourAddyTile) continue;
            const [x, z] = k.split(',').map(Number);
            if (cheb(me, { x: x!, z: z! }) <= 12) this.addy.others++;
        }
        this.ourAddyTile = null;
        this.liveAddy = live;
    }

    /**
     * Hit at a door site: step back through the door (NPCs do not follow through it) and wait
     * until nothing has hit us for 20 ticks and hitpoints are at least half (they regenerate
     * about one per 100 ticks; capped at 1,500 ticks of rest).
     */
    private async retreat(site: Site) {
        const s = this.s();
        const attackers = s.nearbyNpcs.filter(n => n.inCombat && n.distance <= 3).map(n => `${n.name} (${n.combatLevel})`);
        this.addy.retreats++;
        this.ctx.log('retreat', { site: site.name, hp: s.player?.hp, maxHp: s.player?.maxHp, attackers, retreats: this.addy.retreats });
        this.liveAddy.clear();
        await this.throughDoor(site, false);
        for (let i = 0; i < 1_500; i++) {
            const p = this.s().player!;
            const quiet = p.combat.lastDamageTick < 0 || this.s().tick - p.combat.lastDamageTick > 20;
            if (quiet && p.hp * 2 >= p.maxHp) break;
            await this.ticks(1);
        }
    }

    // ------------------------------------------------------------ pickaxe upgrades

    private async quote(id: number): Promise<{ bid: number | null; ask: number | null }> {
        try {
            const host = process.env.SERVER && !process.env.SERVER.startsWith('localhost') ? process.env.SERVER : 'rs-sdk-demo.fly.dev';
            const r = await fetch(`https://${host}/api/market/items/${id}`, { signal: AbortSignal.timeout(5000) });
            const j = (await r.json()) as { bid: number | null; ask: number | null };
            return { bid: j.bid ?? null, ask: j.ask ?? null };
        } catch {
            return { bid: null, ask: null };
        }
    }
    private async bid(id: number): Promise<number | null> {
        return (await this.quote(id)).bid;
    }

    private oreCooldownUntil = 0;

    /**
     * With the bank open: if the steel/iron quotas lack iron ore and the exchange sells it
     * at or under maxOrePrice, sell spare coal as needed, buy the ore, and carry the notes
     * to Falador west bank. Returns true if a trip was made (the caller re-plans; the next
     * bank visit deposits the ore and the smelt session turns it into bars).
     */
    private async maybeBuyOre(): Promise<boolean> {
        if (!this.o.buyOre || Date.now() < this.oreCooldownUntil) return false;
        const need = ironOreShort(this.o.quota, id => this.have(id));
        if (need <= 0) return false;
        const [iron, coal] = [await this.quote(ITEM.iron), await this.quote(ITEM.coal)];
        const coalNeeded = 2 * quotaShort(this.o.quota, id => this.have(id)).steel + 6 * this.have(ITEM.addy);
        const plan = iron.ask !== null && iron.ask <= this.o.maxOrePrice
            ? planOreBuy(need, iron.ask, this.have(ITEM.coins), this.banked(ITEM.coal), coalNeeded, coal.bid)
            : null;
        this.ctx.log('ore plan', { need, ask: iron.ask, coalBid: coal.bid, coins: this.have(ITEM.coins), coal: this.banked(ITEM.coal), coalNeeded, plan });
        if (!plan) {
            this.oreCooldownUntil = Date.now() + 20 * 60_000;
            return false;
        }
        await this.depositAllExcept(new Set());
        if (this.banked(ITEM.coins) > 0) await this.withdraw(ITEM.coins, this.banked(ITEM.coins));
        if (plan.sellCoal > 0) await this.withdraw(ITEM.coal, plan.sellCoal, true);
        this.snapshotBank();
        await this.bot.closeBank();
        await this.toSurface();
        if (!(await this.walk(GE_STAND.x, GE_STAND.z, 3, 300_000))) {
            this.oreCooldownUntil = Date.now() + 10 * 60_000;
            return true;
        }
        if (plan.sellCoal > 0) {
            const ge = await this.bot.openGE();
            if (!ge.success) {
                this.ctx.log('openGE failed', { why: ge.message });
                this.oreCooldownUntil = Date.now() + 20 * 60_000;
                return true;
            }
            const qty = this.inv(ITEM.coal) + this.inv(ITEM.coal + 1); // coal notes are 454
            const r = await this.bot.placeGEOffer({ item: ITEM.coal, side: 'sell', quantity: qty, price: coal.bid! });
            this.ctx.log('ge sell', { item: ITEM.coal, qty, price: coal.bid, ok: r.success, why: r.message });
            await this.ticks(3);
            const c = await this.bot.collectGE();
            this.ctx.log('ge collect', { ok: c.success, coins: c.coins, why: c.message });
            await this.bot.closeInterface();
        }
        const report = await new Buyer(this.ctx).buyAtGE({ item: ITEM.iron, quantity: plan.buy, maxPrice: this.o.maxOrePrice, source: 'ge' });
        this.ctx.log('ore bought', { ...report });
        if (report.bought <= 0) this.oreCooldownUntil = Date.now() + 20 * 60_000;
        await this.walk(BANK_WEST.x, BANK_WEST.z, 3, 300_000);
        return true;
    }

    /**
     * With the bank open: if steel/iron bars (and, failing that, coal) can fund a better
     * pickaxe, sell them on the Grand Exchange and buy the best one they fund from Nurmof.
     * Returns true if a trip was made (the caller re-plans from scratch).
     */
    private async maybeUpgradePickaxe(): Promise<boolean> {
        if (Date.now() < this.shopCooldownUntil) return false;
        const m = this.lvl('mining');
        const current = PICKAXES.findIndex(p => p.level <= m && this.have(p.id) > 0);
        // Only the big steps are worth a trip: rune (rate 2), adamant (3), mithril (4);
        // from Mining 28 adamant is close enough that mithril is skipped.
        const candidates = PICKAXES.slice(0, 3).filter(
            (p, i) => p.level <= m && (current < 0 || i < current) && !(p.name === 'Mithril pickaxe' && m >= 28)
        );
        if (candidates.length === 0) return false;
        const coins = this.have(ITEM.coins);
        // Price every sellable once, then aim at the best pickaxe the whole lot can fund.
        const offers: Sellable[] = [];
        for (const id of [ITEM.steelBar, ITEM.ironBar, ITEM.coal]) {
            const n = this.banked(id);
            if (n <= 0) continue;
            const bid = await this.bid(id);
            if (bid && bid > 0) offers.push({ id, n, price: bid });
        }
        const plan = planPickaxePurchase(candidates, coins, offers);
        if (!plan) return false;
        const { target, sell } = plan;
        this.ctx.log('pickaxe trip', { target: target.name, coins, sell });

        // Withdraw coins and sellables (noted).
        await this.depositAllExcept(new Set());
        if (this.banked(ITEM.coins) > 0) await this.withdraw(ITEM.coins, this.banked(ITEM.coins));
        for (const it of sell) await this.withdraw(it.id, it.n, true);
        this.snapshotBank();
        await this.bot.closeBank();

        if (sell.length > 0) {
            await this.toSurface();
            await this.walk(GE_STAND.x, GE_STAND.z, 3, 300_000);
            const ge = await this.bot.openGE();
            if (!ge.success) {
                this.ctx.log('openGE failed', { why: ge.message });
                this.shopCooldownUntil = Date.now() + 20 * 60_000;
                return true;
            }
            for (const it of sell) {
                // Banknotes take the next id after the item (coal 453 -> 454).
                const qty = this.s().inventory.filter(i => i.id === it.id || i.id === it.id + 1).reduce((n, i) => n + i.count, 0) || it.n;
                const r = await this.bot.placeGEOffer({ item: it.id, side: 'sell', quantity: qty, price: it.price });
                this.ctx.log('ge sell', { item: it.id, qty, price: it.price, ok: r.success, why: r.message });
                await this.ticks(2);
            }
            await this.ticks(3);
            const c = await this.bot.collectGE();
            this.ctx.log('ge collect', { ok: c.success, coins: c.coins, why: c.message });
            await this.bot.closeInterface();
        }

        if (!(await this.buyAtNurmof(candidates.slice(candidates.indexOf(target))))) this.shopCooldownUntil = Date.now() + 30 * 60_000;
        // Next cycle banks the old pickaxe, leftover coins and notes.
        return true;
    }

    /**
     * With the bank open and no pickaxe anywhere (lost on a death: the three items kept
     * are the most valuable, and ore can outrank a bronze pickaxe): take the coins to
     * Nurmof and buy the best usable pickaxe they cover. Fresh accounts bank 25 coins.
     */
    private async replacePickaxe() {
        const m = this.lvl('mining');
        const coins = this.have(ITEM.coins);
        const options = PICKAXES.filter(p => p.level <= m && p.price <= coins);
        this.ctx.log('no pickaxe: buying one', { coins, options: options.map(p => p.name) });
        if (options.length === 0) {
            for (let i = 0; i < 200; i++) await this.ticks(1);
            return;
        }
        await this.depositAllExcept(new Set());
        await this.withdraw(ITEM.coins, this.banked(ITEM.coins));
        this.snapshotBank();
        await this.bot.closeBank();
        await this.buyAtNurmof(options);
    }

    /** Walk to Nurmof and buy the first affordable pickaxe in `candidates` (best first). */
    private async buyAtNurmof(candidates: typeof PICKAXES): Promise<boolean> {
        if (!(await this.toNurmof())) {
            this.ctx.log('could not reach Nurmof', { at: this.pos() });
            return false;
        }
        const shop = await this.bot.openShop(/nurmof/i);
        let bought = false;
        if (shop.success) {
            for (const p of candidates) {
                if (this.inv(ITEM.coins) < p.price) continue;
                const r = await this.bot.buyFromShop(p.name, 1);
                this.ctx.log('buy pickaxe', { pickaxe: p.name, ok: r.success, why: r.message });
                if (r.success) {
                    bought = true;
                    break;
                }
            }
            await this.bot.closeShop();
        } else {
            this.ctx.log('Nurmof shop failed', { why: shop.message });
        }
        return bought;
    }
}

export const role: Role = {
    name: 'smelter',
    produces: [/^(mithril|adamantite) (bar|ore)$/i, /^coal$/i, /^(steel|iron) bar$/i],
    async run(ctx: RoleContext) {
        await new Smelter(ctx).run();
    }
};

if (import.meta.main) await runStandalone(role);
