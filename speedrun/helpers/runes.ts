// Runes: buys and makes the scored run's magic supplies on one helper account:
// the staves (Zaff), spare air talismans (Duke Horacio), Magic 66 on training
// runes from Aubury and Betty, then every rune line at the Magic Guild (blood,
// law, death, chaos and the elementals), then cosmic runes (and laws if still
// short) from Lundail in the Mage Arena cellar. Sources, rates, costs and the
// hazards that shaped this: docs/speedrun/helpers/runes.md.
//
//   ROLE_OPTIONS='{"funders":["^cairn_h47$"]}' bun speedrun/helpers/runes.ts cairn_h88
//
// Every target is a holding (bank + inventory + worn), so a restart, a death or a
// second run only does what is still missing. Phases run in order and the role
// loops over them until every phase reports done, or a phase can't progress.
//
// Coins: the account never walks carrying more than one purchase, and a purchase
// is capped at `maxCarry` (limitToCarry); walk() refuses to move while carrying
// more than the current purchase allows. A death drops everything carried, and a
// low-level helper dies easily: combat random events (Swarm, Triffid) fire on any
// player every few hours, and the only road west crosses White Wolf Mountain.
import { TRADE_REQUEST_CHAT_TYPE } from '../../sdk/types';
import type { BotWorldState, InventoryItem } from '../../sdk/types';
import { Spells } from '../../sdk/spells';
import { advance } from '../lib/dialogue';
import { withLevelUpDismissal } from '../lib/levelup';
import { receiveFrom } from '../lib/trade';
import { waitTicks, waitUntil } from '../lib/wait';
import { BANKS, Buyer, SHOPS, type ListLine, type Tile } from './buyer';
import { accountMatches, ChatCursor, toRegExps } from './mule';
import { runStandalone, type Role, type RoleContext } from './role';

// ------------------------------------------------------------------ places

/** Tiles and planes (level) from server/content/maps; see docs/speedrun/helpers/runes.md. */
export const PLACES = {
    varrockWestBank: BANKS.varrockWest,
    ardougneBank: { x: 2655, z: 3283 },
    yanilleBank: { x: 2613, z: 3092 },
    /** Lumbridge castle south spiral stairs (plane 0 and 1), and Duke Horacio on plane 1. */
    lumbridgeStairs: { x: 3205, z: 3209 },
    duke: { x: 3211, z: 3220 },
    /** Cow field east of Lumbridge: Magic training targets. */
    cows: { x: 3258, z: 3277 },
    /** Magic Guild: west door (Magic 66), stairs to plane 1, the store owner on plane 1. */
    guildDoorOutside: { x: 2583, z: 3088 },
    guildStairs: { x: 2591, z: 3089 },
    guildShop: { x: 2594, z: 3087 },
    /** East Ardougne lever <-> Deserted Keep lever (the only Wilderness lever pair in this revision). */
    ardougneLever: { x: 2562, z: 3311 },
    keepLever: { x: 3154, z: 3923 },
    /**
     * The Deserted Keep's only way out is north through a spider web (bigweb_slashable,
     * m49_61), cut with a wielded slash weapon (web.rs2, slash_checker.rs2). It regrows
     * 100 ticks after it is cut, so the walk back cuts it again.
     */
    keepWeb: { x: 3158, z: 3951 },
    keepWebSouth: { x: 3158, z: 3950 },
    keepWebNorth: { x: 3158, z: 3952 },
    /** Mage Arena: the cellar ladder outside Kolodion's barrier, and Lundail in the cellar. */
    arenaLadder: { x: 3091, z: 3956 },
    lundail: { x: 2536, z: 4718 }
} satisfies Record<string, Tile>;

/** Inside the Deserted Keep, south of its web. */
export function inKeep(x: number, z: number): boolean {
    return x >= 3140 && x <= 3175 && z >= 3910 && z <= 3950;
}

// The buyer walks to `stand` on whatever plane the account is on, so the two
// shops reached by stairs or a ladder are only used after this role climbs.
SHOPS.zaff ??= { npc: /^zaff$/i, stand: { x: 3203, z: 3431 }, bank: BANKS.varrockWest };
SHOPS.magicGuild ??= { npc: /^magic store owner$/i, stand: PLACES.guildShop, bank: PLACES.yanilleBank };
SHOPS.lundail ??= { npc: /^lundail$/i, stand: PLACES.lundail, bank: PLACES.ardougneBank };

// ------------------------------------------------------------------ pure helpers (runes.test.ts)

/**
 * Price of the next unit from an NPC shop when it already stocks `below` units
 * fewer than its configured level: shop.rs2 `calc_shop_value` with the shop's
 * `shop_sell_multiplier` (1000 for every rune shop here) and `shop_delta`.
 */
export function shopUnitPrice(base: number, delta: number, below: number, sell = 1000): number {
    const markup = Math.min(1000, Math.max(-5000, -below * delta));
    const scaled = Math.max(100, sell - markup);
    return Math.max(1, Math.floor((scaled * base) / 1000));
}

/** Coins for `n` units bought one by one, starting `below` units under the configured stock. */
export function shopCost(base: number, delta: number, n: number, below = 0): number {
    let total = 0;
    for (let k = 0; k < n; k++) total += shopUnitPrice(base, delta, below + k);
    return total;
}

/** Total xp at a level (the classic table). */
export function xpForLevel(level: number): number {
    let points = 0;
    for (let l = 1; l < level; l++) points += Math.floor(l + 300 * Math.pow(2, l / 7));
    return Math.floor(points / 4);
}

/**
 * Strike casts still needed to reach `targetLevel` from `xp` (displayed xp, the
 * server's rate already applied). A strike gives its base xp plus 2 per damage
 * (combat.rs2); `perCast` is a conservative base-xp average that counts splashes.
 */
export function castsToLevel(xp: number, targetLevel: number, xpRate = 25, perCast = 13): number {
    const need = xpForLevel(targetLevel) - xp;
    return need <= 0 ? 0 : Math.ceil(need / (xpRate * perCast));
}

/**
 * The strike to cast at a Magic level. Wind Strike (1 air, 1 mind) until 9, then
 * Earth Strike with a staff of earth wielded, which also costs 1 air and 1 mind
 * but gives 9.5 base xp instead of 5.5.
 */
export function strikeFor(level: number): { spell: number; name: string; staff: string | null } {
    if (level >= 9) return { spell: Spells.EARTH_STRIKE, name: 'Earth Strike', staff: 'Staff of earth' };
    return { spell: Spells.WIND_STRIKE, name: 'Wind Strike', staff: null };
}

export type Phase = 'fund' | 'shops' | 'talismans' | 'magic' | 'guild' | 'lundail';
export const ALL_PHASES: Phase[] = ['fund', 'shops', 'talismans', 'magic', 'guild', 'lundail'];

/** The run's totals (docs/speedrun/SUPPLIES.md section 2), plus 2 cosmics to enchant the two amulets. */
export const DEFAULT_TARGETS: Record<string, number> = {
    'Cosmic rune': 62,
    'Blood rune': 570,
    'Death rune': 110,
    'Chaos rune': 40,
    'Air rune': 1650,
    'Law rune': 50,
    'Water rune': 30,
    'Fire rune': 85,
    'Earth rune': 52,
    'Mind rune': 4,
    'Staff of water': 1,
    'Staff of fire': 1,
    'Air talisman': 3
};

/** What the Magic Guild store sells of the manifest (magic_guild.inv: 1000-3000 of each at base price). */
export const GUILD_ITEMS = ['Blood rune', 'Law rune', 'Death rune', 'Chaos rune', 'Air rune', 'Water rune', 'Fire rune', 'Earth rune', 'Mind rune'];
/** Lundail's lines, cosmic first: the only cosmic source. */
export const LUNDAIL_ITEMS = ['Cosmic rune', 'Law rune'];

export interface RunesOptions {
    phases: Phase[];
    funders: RegExp[];
    /** Wait for funding at Varrock west bank until the account holds this many coins. */
    minCoins: number;
    fundWaitMinutes: number;
    targets: Record<string, number>;
    magicLevel: number;
    xpRate: number;
    /** Highest price paid per unit for each item; above it the buyer leaves and a later round comes back. */
    maxPrice: Record<string, number>;
    /** Ticks the buyer may wait at a shop for restocks. 0: never stand idle in a shop. */
    shopWaitTicks: number;
    /** Ticks to wait in Lundail's cellar for cosmic restocks (1 per 100 ticks); only at `minHitpointsWest`. */
    lundailWaitTicks: number;
    /** NPC names to train Magic on near PLACES.cows. */
    trainOn: RegExp[];
    /** Most coins one purchase may carry; every trip is cut to fit (limitToCarry). */
    maxCarry: number;
    /** Training runes bought per shop visit, in casts. */
    trainChunk: number;
    /** Hitpoints before the account walks west over White Wolf Mountain or waits in a shop. */
    minHitpointsWest: number;
    /** Weapons that can slash the Deserted Keep web, in order of preference (bank names). */
    webWeapons: RegExp[];
    /** Passes over the phase list before giving up. */
    rounds: number;
}

export const DEFAULT_MAX_PRICE: Record<string, number> = {
    // About 3x base: a drained Aubury or Betty shelf climbs to 6x, and leaving to come back
    // after restocks is cheaper than paying up. The guild's 3000-deep shelves sell at base.
    'Air rune': 12,
    'Mind rune': 9,
    'Fire rune': 12,
    'Water rune': 12,
    'Earth rune': 12,
    'Death rune': 90,
    'Chaos rune': 45,
    'Law rune': 120,
    'Cosmic rune': 30,
    // Blood at the guild is still far below the GE (~600) at the 6x cap.
    'Blood rune': 300,
    'Staff of water': 1600,
    'Staff of fire': 1600,
    'Staff of earth': 1600
};

export const DEFAULT_WEB_WEAPONS = ['^bronze axe$', '^bronze sword$', '^bronze scimitar$', '^iron (axe|sword|scimitar)$', '^steel (axe|sword|scimitar)$'];

export function runesOptions(raw: Record<string, unknown>): RunesOptions {
    const num = (k: string, d: number) => (typeof raw[k] === 'number' && Number.isFinite(raw[k]) ? (raw[k] as number) : d);
    const phases = Array.isArray(raw.phases) ? (raw.phases as string[]) : ALL_PHASES;
    for (const p of phases) if (!ALL_PHASES.includes(p as Phase)) throw new Error(`runes: unknown phase ${p}`);
    return {
        phases: phases as Phase[],
        funders: toRegExps(raw.funders ?? '^cairn_h47$'),
        minCoins: num('minCoins', 0),
        fundWaitMinutes: num('fundWaitMinutes', 60),
        targets: { ...DEFAULT_TARGETS, ...((raw.targets as Record<string, number>) ?? {}) },
        magicLevel: num('magicLevel', 66),
        xpRate: num('xpRate', 25),
        maxPrice: { ...DEFAULT_MAX_PRICE, ...((raw.maxPrice as Record<string, number>) ?? {}) },
        shopWaitTicks: num('shopWaitTicks', 0),
        lundailWaitTicks: num('lundailWaitTicks', 4500),
        trainOn: toRegExps(raw.trainOn ?? ['^cow$', '^cow calf$', '^chicken$']),
        maxCarry: num('maxCarry', 30_000),
        trainChunk: num('trainChunk', 300),
        minHitpointsWest: num('minHitpointsWest', 30),
        webWeapons: toRegExps(raw.webWeapons ?? DEFAULT_WEB_WEAPONS),
        rounds: num('rounds', 8)
    };
}

/** Coins a list of shop lines can cost at worst: every unit still missing at its cap. */
export function purchaseBudget(lines: ListLine[], held: (item: string) => number): number {
    return lines.reduce((a, l) => a + Math.max(0, l.quantity - held(String(l.item))) * (l.maxPrice ?? 0), 0);
}

/**
 * Cut a purchase to what `maxCarry` coins can pay for at the lines' caps, in line
 * order: the first lines are filled first, the last one may be partial, lines that
 * don't fit are dropped. Quantities stay holding targets (held + units to buy). The
 * result's purchaseBudget never exceeds maxCarry, so neither do the coins carried.
 */
export function limitToCarry(lines: ListLine[], held: (item: string) => number, maxCarry: number): ListLine[] {
    const out: ListLine[] = [];
    let left = maxCarry;
    for (const l of lines) {
        const have = held(String(l.item));
        const need = Math.max(0, l.quantity - have);
        if (need === 0) continue;
        const price = Math.max(1, l.maxPrice ?? 1);
        const n = Math.min(need, Math.floor(left / price));
        if (n <= 0) break;
        out.push({ ...l, quantity: have + n });
        left -= n * price;
    }
    return out;
}

/** Zaff's lines for the `shops` phase: the manifest's staves, and the staff of earth while training. */
export function staffLines(o: RunesOptions, training: boolean): ListLine[] {
    const want: Record<string, number> = { 'Staff of water': o.targets['Staff of water'] ?? 0, 'Staff of fire': o.targets['Staff of fire'] ?? 0 };
    if (training) want['Staff of earth'] = Math.max(o.targets['Staff of earth'] ?? 0, 1);
    return Object.entries(want)
        .filter(([, n]) => n > 0)
        .map(([item, quantity]) => ({ item, quantity, source: 'shop' as const, shop: 'zaff', maxPrice: o.maxPrice[item], maxWaitTicks: 0 }));
}

/**
 * One shop's training-rune lines: air and mind to hold `casts` of each (a strike
 * costs one of each). Training spends every air and mind it holds; the guild phase
 * buys the manifest's own elementals afterwards.
 */
export function trainingLines(o: RunesOptions, shop: 'aubury' | 'betty', casts: number): ListLine[] {
    if (casts <= 0) return [];
    return ['Air rune', 'Mind rune'].map(item => ({ item, quantity: casts, source: 'shop' as const, shop, maxPrice: o.maxPrice[item], maxWaitTicks: o.shopWaitTicks }));
}

/** Lines for one shop's manifest items that are still short. */
export function manifestLines(o: RunesOptions, shop: string, items: string[], maxWaitTicks: number): ListLine[] {
    return items
        .filter(item => (o.targets[item] ?? 0) > 0)
        .map(item => ({ item, quantity: o.targets[item]!, source: 'shop' as const, shop, maxPrice: o.maxPrice[item], maxWaitTicks }));
}

// ------------------------------------------------------------------ the role

type Status = 'done' | 'skip' | 'blocked';

/** Errors that mean the session dropped, not that the phase failed. */
const STALE_STATE = /no fresh world state|waitForStateChange timed out|no game state|not connected/i;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const exactly = (name: string) => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');

export class Runes {
    readonly o: RunesOptions;
    private readonly buyer: Buyer;
    private readonly requests: ChatCursor;
    /** Coins walk() lets the account carry: the current purchase's budget, 0 between purchases. */
    private carryLimit = 0;

    constructor(private readonly ctx: RoleContext) {
        this.o = runesOptions(ctx.options);
        this.buyer = new Buyer(ctx);
        this.requests = new ChatCursor(ctx.sdk, [TRADE_REQUEST_CHAT_TYPE]);
    }

    private get state(): BotWorldState {
        const s = this.ctx.sdk.getState();
        if (!s?.player) throw new Error('no game state');
        return s;
    }

    private get plane(): number {
        return this.state.player!.level;
    }

    private near(t: Tile, r = 3): boolean {
        const p = this.state.player!;
        return Math.max(Math.abs(p.worldX - t.x), Math.abs(p.worldZ - t.z)) <= r;
    }

    private inv(name: string | RegExp): number {
        return this.state.inventory.filter(i => (typeof name === 'string' ? sameName(i.name, name) : name.test(i.name))).reduce((a, i) => a + i.count, 0);
    }

    /** Bank (as of the last bank visit, the buyer's included) + inventory + worn. */
    held(name: string): number {
        const worn = this.ctx.bot.getEquipment().filter(i => sameName(i.name, name)).length;
        return this.buyer.held(name) + worn;
    }

    private magic(): { level: number; xp: number } {
        const s = this.state.skills.find(k => /^magic$/i.test(k.name));
        return { level: s?.baseLevel ?? 1, xp: s?.experience ?? 0 };
    }

    private hitpoints(): number {
        return this.state.skills.find(k => /^hitpoints$/i.test(k.name))?.baseLevel ?? 10;
    }

    private coins(): number {
        return this.inv('Coins');
    }

    /** Walk, refusing to move while carrying more coins than the current purchase allows. */
    private async walk(t: Tile, what: string, timeout = 300_000): Promise<void> {
        if (this.coins() > this.carryLimit) {
            this.ctx.log('carry guard', { carrying: this.coins(), limit: this.carryLimit, to: what });
            throw new Error(`carry guard: ${this.coins()} coins carried, the purchase allows ${this.carryLimit}`);
        }
        for (let i = 0; i < 4 && !this.ctx.signal.aborted; i++) {
            const r = await this.ctx.bot.walkTo(t.x, t.z, 2, { timeout });
            if (r.success || this.near(t)) return;
            this.ctx.log('walk retry', { to: what, message: r.message });
            await waitTicks(this.ctx.sdk, 3);
        }
        if (!this.near(t)) throw new Error(`could not reach ${what}`);
    }

    /** Open the bank at `at`, run `body`, report the bank (the buyer's counts), close it. */
    private async atBank<T>(at: Tile, body: () => Promise<T>): Promise<T> {
        return this.buyer.atBank(at, body);
    }

    /** Run `body` with walk() allowing `limit` coins; the limit drops back to 0 after. */
    private async carrying<T>(limit: number, body: () => Promise<T>): Promise<T> {
        this.carryLimit = limit;
        try {
            return await body();
        } finally {
            this.carryLimit = 0;
        }
    }

    /** Climb a ladder or stairs (a loc offering `option`) until the plane or position changes. */
    private async climb(loc: RegExp, option: RegExp, arrived: (s: BotWorldState) => boolean, what: string): Promise<void> {
        for (let i = 0; i < 3; i++) {
            const r = await this.ctx.bot.interactLoc(loc, option);
            const w = await waitUntil(this.ctx.sdk, s => !!s.player && arrived(s), { maxTicks: 12 });
            if (w.ok) return;
            this.ctx.log('climb retry', { what, message: r.message });
        }
        throw new Error(`could not ${what}`);
    }

    /**
     * Page through an open (or opening) dialogue: continue pages are continued and
     * choice pages answered with any of `answers`, until `done` holds or no fresh
     * page arrives. The page kind is only known once advance() sees the fresh page,
     * so every page is offered the whole answer set.
     */
    private async pageThrough(answers: RegExp[], done: (s: BotWorldState) => boolean = () => false, maxPages = 20): Promise<string[]> {
        const { sdk } = this.ctx;
        const choose = answers.length ? new RegExp(answers.map(a => a.source).join('|'), 'i') : undefined;
        const seen: string[] = [];
        for (let i = 0; i < maxPages; i++) {
            const s = sdk.getState();
            if (s && done(s)) break;
            const r = await advance(sdk, { choose, maxTicks: 8 });
            if (!r.ok) {
                if (r.reason === 'no fresh page') break;
                throw new Error(`dialogue: ${r.reason} on "${r.text}"`);
            }
            seen.push(r.text);
        }
        return seen;
    }

    /** Talk to an NPC and page through its whole dialogue. */
    private async converse(npc: RegExp, answers: RegExp[]): Promise<string[]> {
        const t = await this.ctx.bot.talkTo(npc);
        if (!t.success) throw new Error(`talk to ${npc}: ${t.message}`);
        return this.pageThrough(answers);
    }

    /**
     * Back on plane 0 from wherever a failed phase left the account: Lumbridge
     * castle (planes 1-2) and the Magic Guild store (plane 1) are the only upper
     * floors this role uses; the Mage Arena cellar is left by its ladder.
     */
    private async toGround(): Promise<void> {
        if (this.ctx.sdk.getState()?.dialog.isOpen) await this.ctx.bot.dismissBlockingUI();
        if (this.state.player!.worldZ > 4600 && this.near(PLACES.lundail, 20)) {
            await this.climb(/^ladder$/i, /climb-up/i, s => s.player!.worldZ < 4600, 'climb out of the cellar');
        }
        for (let i = 0; i < 3 && this.plane > 0; i++) {
            const from = this.plane;
            await this.climb(/staircase/i, /climb-down/i, s => s.player!.level < from, `climb down from plane ${from}`);
        }
    }

    private nearestBank(): Tile {
        const p = this.state.player!;
        // Al Kharid is behind the toll gate, which a fresh account can't always pay.
        return [BANKS.varrockWest, BANKS.varrockEast, BANKS.draynor, BANKS.faladorWest, PLACES.ardougneBank, PLACES.yanilleBank].sort(
            (a, b) => Math.max(Math.abs(a.x - p.worldX), Math.abs(a.z - p.worldZ)) - Math.max(Math.abs(b.x - p.worldX), Math.abs(b.z - p.worldZ))
        )[0]!;
    }

    /** Whether the account may cross White Wolf Mountain (aggressive wolves) or stand still somewhere. */
    private sturdy(what: string): boolean {
        if (this.hitpoints() >= this.o.minHitpointsWest) return true;
        this.ctx.log(`${what}: waits for Hitpoints ${this.o.minHitpointsWest} (Magic training raises it)`, { hitpoints: this.hitpoints() });
        return false;
    }

    // ------------------------------------------------------------ phases

    /** Wait at Varrock west bank for coins from a funder until the account holds `minCoins`. */
    async fund(): Promise<Status> {
        const { sdk, log } = this.ctx;
        if (this.o.minCoins <= 0) return 'skip';
        await this.atBank(PLACES.varrockWestBank, () => this.buyer.depositAllBut([]));
        if (this.held('Coins') >= this.o.minCoins) return 'done';
        log('fund: waiting for coins', { have: this.held('Coins'), want: this.o.minCoins, funders: this.o.funders.map(String) });
        const deadline = Date.now() + this.o.fundWaitMinutes * 60_000;
        while (Date.now() < deadline && !this.ctx.signal.aborted) {
            const senders = [...new Set(this.requests.next().map(m => m.sender))].filter(n => this.o.funders.some(p => accountMatches(n, p)));
            for (const from of senders) {
                const before = this.coins();
                const r = await receiveFrom(sdk, from, { openTimeoutMs: 20_000 });
                log('funded', { from, ok: r.ok, reason: r.reason, received: r.received.map(i => `${i.name} x${i.count}`), gained: this.coins() - before });
                if (r.ok) await this.atBank(PLACES.varrockWestBank, () => this.buyer.depositAllBut([]));
                log('fund: bank coins', { coins: this.held('Coins') });
            }
            if (this.held('Coins') >= this.o.minCoins) return 'done';
            await waitTicks(sdk, 5);
        }
        return this.held('Coins') > 0 ? 'done' : 'blocked';
    }

    /** Zaff's staves (the manifest's two, and the staff of earth for training). One shop: one purchase. */
    async shops(): Promise<Status> {
        const training = this.magic().level < this.o.magicLevel;
        const lines = staffLines(this.o, training).filter(l => this.held(String(l.item)) < l.quantity);
        if (lines.length === 0) return 'skip';
        await this.buyer.run(limitToCarry(lines, n => this.held(n), this.o.maxCarry));
        return staffLines(this.o, training).every(l => this.held(String(l.item)) >= l.quantity) ? 'done' : 'blocked';
    }

    /** Duke Horacio gives an air talisman whenever the account holds none (duke_horacio.rs2): drop, ask, pick up. */
    async talismans(): Promise<Status> {
        const { bot, sdk, log } = this.ctx;
        const target = this.o.targets['Air talisman'] ?? 0;
        if (this.held('Air talisman') >= target) return 'skip';
        // Free the inventory (the duke's mesbox needs one slot per talisman), and take every
        // banked talisman out: the Duke only hands one over when none is held anywhere.
        await this.atBank(BANKS.draynor, async () => {
            await this.buyer.depositAllBut([]);
            const banked = sdk.getBankItems().find(i => sameName(i.name, 'Air talisman'))?.count ?? 0;
            if (banked > 0) await bot.withdrawItem(/^air talisman$/i, banked);
        });
        if (this.plane === 0) {
            await this.walk(PLACES.lumbridgeStairs, 'Lumbridge castle stairs');
            await this.climb(/staircase/i, /climb-up/i, s => s.player!.level === 1, 'climb to the Duke');
        }
        const dropped: Tile[] = [];
        let carried = this.inv('Air talisman');
        while (carried + dropped.length < target && !this.ctx.signal.aborted) {
            // Drop every carried talisman so obj_gettotal(air_talisman) is 0.
            for (const it of this.state.inventory.filter(i => sameName(i.name, 'Air talisman'))) {
                const p = this.state.player!;
                const d = await bot.dropItem(it, 1);
                if (d.success) dropped.push({ x: p.worldX, z: p.worldZ });
            }
            const before = this.inv('Air talisman');
            const pages = await this.converse(/^duke horacio$/i, [/any quests for me/i, /sure, no problem/i]);
            const w = await waitUntil(sdk, s => s.inventory.filter(i => sameName(i.name, 'Air talisman')).length > before, { maxTicks: 6 });
            if (!w.ok) {
                log('talismans: the duke gave nothing', { pages });
                break;
            }
            carried = this.inv('Air talisman');
            log('talismans: got one', { carried, dropped: dropped.length });
        }
        // Our drops are private to us for 100 ticks; take them back.
        for (let i = 0; i < dropped.length + 2; i++) {
            const g = sdk.findGroundItem(/^air talisman$/i);
            if (!g || g.distance > 8) break;
            await bot.pickupItem(g);
            await waitTicks(sdk, 1);
        }
        log('talismans: carrying', { airTalismans: this.inv('Air talisman') });
        await this.climb(/staircase/i, /climb-down/i, s => s.player!.level === 0, 'climb down from the Duke');
        await this.atBank(BANKS.draynor, () => this.buyer.depositAllBut([]));
        return this.held('Air talisman') >= target ? 'done' : 'blocked';
    }

    /**
     * Magic to `magicLevel` in chunks: buy one chunk of air and mind at Aubury (then
     * Betty for what Aubury's shelf couldn't give), strike cows with all of it, repeat.
     * A chunk that buys nothing (drained shelves, no coins) ends the phase for this round.
     */
    async train(): Promise<Status> {
        const { log } = this.ctx;
        while (!this.ctx.signal.aborted && this.magic().level < this.o.magicLevel) {
            const casts = Math.min(this.o.trainChunk, castsToLevel(this.magic().xp, this.o.magicLevel, this.o.xpRate));
            for (const shop of ['aubury', 'betty'] as const) {
                const lines = trainingLines(this.o, shop, casts).filter(l => this.held(String(l.item)) < l.quantity);
                if (lines.length) await this.buyer.run(limitToCarry(lines, n => this.held(n), this.o.maxCarry));
            }
            const runes = Math.min(this.held('Air rune'), this.held('Mind rune'));
            if (runes <= 0) {
                log('magic: no air and mind runes to cast (shelves above the caps, or no coins); a later round comes back');
                return 'blocked';
            }
            const before = this.magic().xp;
            await this.castAll();
            if (this.magic().xp <= before) return 'blocked';
        }
        return this.magic().level >= this.o.magicLevel ? 'done' : 'blocked';
    }

    /** Strike cows east of Lumbridge with every air and mind rune held, then bank. */
    private async castAll(): Promise<void> {
        const { bot, sdk, log } = this.ctx;
        await this.atBank(BANKS.draynor, async () => {
            await this.buyer.depositAllBut([]);
            const inBank = (n: string) => sdk.getBankItems().find(i => sameName(i.name, n))?.count ?? 0;
            const casts = Math.min(inBank('Air rune'), inBank('Mind rune'));
            if (casts > 0) {
                await bot.withdrawItem(/^air rune$/i, casts);
                await bot.withdrawItem(/^mind rune$/i, casts);
            }
            if (inBank('Staff of earth') > 0 && !bot.getEquipment().some(i => sameName(i.name, 'Staff of earth'))) await bot.withdrawItem(/^staff of earth$/i, 1);
        });
        await this.walk(PLACES.cows, 'the Lumbridge cow field');
        const start = this.magic();
        let casts = 0;
        let failures = 0;
        await withLevelUpDismissal(sdk, async () => {
            while (!this.ctx.signal.aborted && this.magic().level < this.o.magicLevel && this.inv('Mind rune') > 0 && this.inv('Air rune') > 0) {
                const strike = strikeFor(this.magic().level);
                if (strike.staff && !bot.getEquipment().some(i => sameName(i.name, strike.staff!))) {
                    const staff = this.state.inventory.find(i => sameName(i.name, strike.staff!));
                    if (staff) await bot.equipItem(staff);
                }
                const target = sdk
                    .getNearbyNpcs()
                    .filter(n => this.o.trainOn.some(p => p.test(n.name)) && n.reachable !== false && (n.hp ?? 1) > 0 && (!n.inCombat || n.targetIndex >= 0))
                    .sort((a, b) => a.distance - b.distance)[0];
                if (!target) {
                    await this.walk(PLACES.cows, 'the Lumbridge cow field');
                    await waitTicks(sdk, 5);
                    continue;
                }
                const r = await bot.castSpell(target, strike.spell, 6000);
                if (r.success) {
                    casts++;
                    failures = 0;
                } else {
                    failures++;
                    if (r.reason === 'no_runes') break;
                    if (failures > 20) throw new Error(`magic: 20 failed casts in a row (${r.reason}: ${r.message})`);
                    await waitTicks(sdk, 2);
                }
                if (casts % 100 === 0 && r.success) log('magic: progress', { level: this.magic().level, xp: this.magic().xp, hitpoints: this.hitpoints(), casts, mind: this.inv('Mind rune'), air: this.inv('Air rune') });
            }
        });
        const end = this.magic();
        log('magic: session', { from: start.level, to: end.level, hitpoints: this.hitpoints(), casts, xpPerCast: casts ? Math.round((end.xp - start.xp) / casts / this.o.xpRate) : null });
        await this.atBank(BANKS.draynor, () => this.buyer.depositAllBut([]));
    }

    /** Read every shelf of an open shop into the log (live stock is the measurement this role exists to make). */
    private logShelf(where: string): void {
        const items = this.state.shop.shopItems.map(i => `${i.name} ${i.count}`);
        this.ctx.log('shelf', { shop: where, items });
    }

    /**
     * Magic Guild store (Yanille, plane 1): every manifest rune line, in trips of at
     * most `maxCarry` coins from Yanille bank (the guild is a short walk away).
     */
    async guild(): Promise<Status> {
        const { bot, log } = this.ctx;
        if (this.magic().level < 66) return 'blocked';
        const short = () => manifestLines(this.o, 'magicGuild', GUILD_ITEMS, 0).filter(l => this.held(String(l.item)) < l.quantity);
        if (short().length === 0) return 'skip';
        if (!this.sturdy('guild')) return 'blocked';
        for (let trip = 1; trip <= 12 && !this.ctx.signal.aborted && short().length > 0; trip++) {
            const lines = limitToCarry(short(), n => this.held(n), this.o.maxCarry);
            const budget = purchaseBudget(lines, n => this.held(n));
            const heldBefore = lines.map(l => this.held(String(l.item)));
            await this.atBank(PLACES.yanilleBank, async () => {
                await this.buyer.depositAllBut([]);
                await this.buyer.setCoins(budget);
            });
            log('guild: trip', { trip, budget, carried: this.coins(), lines: lines.map(l => `${l.item} to ${l.quantity}`) });
            await this.carrying(budget, async () => {
                if (this.plane === 0) {
                    await this.walk(PLACES.guildDoorOutside, 'the Magic Guild door');
                    await bot.openDoor(/door/i);
                    await this.walk(PLACES.guildStairs, 'the Magic Guild stairs');
                    await this.climb(/^staircase$/i, /climb-up/i, s => s.player!.level === 1, 'climb to the guild store');
                }
                const opened = await bot.openShop(/^magic store owner$/i);
                if (!opened.success) throw new Error(`guild shop: ${opened.message}`);
                this.logShelf('magic guild');
                await bot.closeShop();
                for (const line of lines) log('guild: line', { ...(await this.buyer.buyAtShop(line, 0)) });
                await this.climb(/^staircase$/i, /climb-down/i, s => s.player!.level === 0, 'climb down from the guild store');
            });
            await this.atBank(PLACES.yanilleBank, () => this.buyer.depositAllBut([]));
            if (lines.every((l, i) => this.held(String(l.item)) <= heldBefore[i]!)) {
                log('guild: a trip bought nothing (shelves above the caps); a later round comes back');
                break;
            }
        }
        return short().length === 0 ? 'done' : 'blocked';
    }

    /**
     * Cut the Deserted Keep's web and step through it, `north` (out of the keep) or
     * south (back in, to the lever). Slashing succeeds half the time (web.rs2).
     */
    private async crossWeb(to: 'north' | 'south'): Promise<void> {
        const { bot, sdk, log } = this.ctx;
        const [from, dest] = to === 'north' ? [PLACES.keepWebSouth, PLACES.keepWebNorth] : [PLACES.keepWebNorth, PLACES.keepWebSouth];
        const across = (s: BotWorldState) => (to === 'north' ? s.player!.worldZ >= dest.z : s.player!.worldZ <= dest.z);
        if (across(this.state)) return;
        await this.walk(from, 'the keep web');
        for (let i = 0; i < 16 && !this.ctx.signal.aborted; i++) {
            const web = sdk.getNearbyLocs().find(l => /^web$/i.test(l.name) && l.x === PLACES.keepWeb.x && l.z === PLACES.keepWeb.z);
            if (web) {
                await bot.interactLoc(web, /slash/i);
                await waitTicks(sdk, 3);
                continue;
            }
            await sdk.sendWalk(dest.x, dest.z);
            const w = await waitUntil(sdk, s => !!s.player && across(s), { maxTicks: 6 });
            if (w.ok) {
                log('lundail: through the web', { to, tries: i + 1 });
                return;
            }
        }
        throw new Error(`lundail: could not get ${to} through the keep web`);
    }

    /**
     * Lundail (Mage Arena cellar): cosmic runes, and laws if still short. The walk
     * from the Deserted Keep lever to the cellar ladder is Wilderness level ~51-55;
     * the cellar itself is outside every wilderness_zones rectangle. Carries coins
     * and a wielded slash weapon for the keep's web, nothing else.
     */
    async lundail(): Promise<Status> {
        const { bot, sdk, log } = this.ctx;
        const short = () => manifestLines(this.o, 'lundail', LUNDAIL_ITEMS, 0).filter(l => this.held(String(l.item)) < l.quantity);
        if (short().length === 0) return 'skip';
        const inCellar = (s: BotWorldState) => s.player!.worldZ > 4600;
        const inWild = (s: BotWorldState) => s.player!.worldZ > 3520 && s.player!.worldZ < 4000;
        const lines = limitToCarry(short(), n => this.held(n), this.o.maxCarry).map(l => ({
            ...l,
            maxWaitTicks: l.item === 'Cosmic rune' && this.hitpoints() >= this.o.minHitpointsWest ? this.o.lundailWaitTicks : 0
        }));
        const budget = purchaseBudget(lines, n => this.held(n));
        if (!inCellar(this.state) && !inWild(this.state)) {
            if (!this.sturdy('lundail')) return 'blocked';
            // Nothing worn but the web weapon goes into the Wilderness.
            for (const e of bot.getEquipment()) if (!this.o.webWeapons.some(p => p.test(e.name))) await bot.unequipItem(e.name);
            await this.atBank(PLACES.ardougneBank, async () => {
                await this.buyer.depositAllBut([]);
                if (!bot.getEquipment().some(e => this.o.webWeapons.some(p => p.test(e.name)))) {
                    const bank = sdk.getBankItems();
                    const weapon = this.o.webWeapons.map(p => bank.find(i => p.test(i.name))).find(Boolean);
                    if (weapon) await bot.withdrawItem(exactly(weapon.name), 1);
                }
                await this.buyer.setCoins(budget);
            });
            const weapon = this.state.inventory.find(i => this.o.webWeapons.some(p => p.test(i.name)));
            if (weapon) await bot.equipItem(weapon);
            if (!bot.getEquipment().some(e => this.o.webWeapons.some(p => p.test(e.name)))) {
                log('lundail: no weapon that can slash the keep web (a bronze axe or sword will do)');
                await this.atBank(PLACES.ardougneBank, () => this.buyer.depositAllBut([]));
                return 'blocked';
            }
        }
        await this.carrying(Math.max(budget, this.coins()), async () => {
            if (!inCellar(this.state) && !inWild(this.state)) {
                await this.walk(PLACES.ardougneLever, 'the Ardougne lever');
                await bot.interactLoc(/^lever$/i, /pull/i);
                // The first pull warns (a mesbox, then a three-way choice): "Yes I'm brave."
                await waitUntil(sdk, s => s.dialog.isOpen || inWild(s), { maxTicks: 6 });
                if (sdk.getState()?.dialog.isOpen) await this.pageThrough([/brave/i], s => !!s.player && inWild(s), 5);
                const w = await waitUntil(sdk, s => !!s.player && inWild(s), { maxTicks: 15 });
                if (!w.ok) throw new Error('lundail: the Ardougne lever did not teleport');
                log('lundail: in the Wilderness', { at: { x: this.state.player!.worldX, z: this.state.player!.worldZ }, carried: this.coins() });
            }
            if (!inCellar(this.state)) {
                if (inKeep(this.state.player!.worldX, this.state.player!.worldZ)) await this.crossWeb('north');
                await this.walk(PLACES.arenaLadder, 'the Mage Arena cellar ladder');
                await this.climb(/^ladder$/i, /climb-down/i, inCellar, 'climb down to Lundail');
            }
            const opened = await bot.openShop(/^lundail$/i);
            if (!opened.success) throw new Error(`lundail: ${opened.message}`);
            this.logShelf('lundail');
            await bot.closeShop();
            for (const line of lines) log('lundail: line', { ...(await this.buyer.buyAtShop(line, line.maxWaitTicks)) });
            await this.climb(/^ladder$/i, /climb-up/i, s => !inCellar(s), 'climb out of the cellar');
            await this.walk(PLACES.keepWebNorth, 'the keep web');
            await this.crossWeb('south');
            await this.walk(PLACES.keepLever, 'the Deserted Keep lever');
            await bot.interactLoc(/^lever$/i, /pull/i);
            const out = await waitUntil(sdk, s => !!s.player && s.player.worldZ < 3520, { maxTicks: 15 });
            if (!out.ok) throw new Error('lundail: the keep lever did not teleport');
        });
        await this.atBank(PLACES.ardougneBank, () => this.buyer.depositAllBut([]));
        return short().length === 0 ? 'done' : 'blocked';
    }

    // ------------------------------------------------------------ loop

    private async runPhase(p: Phase): Promise<Status> {
        switch (p) {
            case 'fund':
                return this.fund();
            case 'shops':
                return this.shops();
            case 'talismans':
                return this.talismans();
            case 'magic':
                return this.train();
            case 'guild':
                return this.guild();
            case 'lundail':
                return this.lundail();
        }
    }

    holdings(): Record<string, string> {
        const out: Record<string, string> = {};
        for (const [item, n] of Object.entries(this.o.targets)) out[item] = `${this.held(item)}/${n}`;
        return out;
    }

    async run(): Promise<void> {
        const { ctx } = this;
        await this.buyer.prepare();
        await ctx.bot.dismissBlockingUI();
        if (ctx.sdk.getTradeState().isOpen) await ctx.bot.declineTrade();
        await this.toGround().catch(e => ctx.log('could not get back to plane 0', { error: String(e) }));
        // Learn the bank's contents at the nearest booth (banks are shared, so any booth will do).
        await this.atBank(this.nearestBank(), () => this.buyer.depositAllBut([])).catch(e => ctx.log('first bank visit failed', { error: String(e) }));
        const status = new Map<Phase, Status>();
        let offline = 0;
        for (let round = 1; round <= this.o.rounds && !ctx.signal.aborted; round++) {
            for (const p of this.o.phases) {
                if (ctx.signal.aborted || status.get(p) === 'done' || status.get(p) === 'skip') continue;
                try {
                    await this.toGround();
                    status.set(p, await this.runPhase(p));
                } catch (e) {
                    status.set(p, 'blocked');
                    ctx.log('phase failed', { phase: p, error: String(e) });
                    // A dropped session (the server logs accounts out; the client relogs) is not a
                    // failed phase: wait for the world state to come back and don't spend the round.
                    if (STALE_STATE.test(String(e)) && offline < 20) {
                        offline++;
                        ctx.log('runes: no live world state; waiting for the session to come back', { waits: offline });
                        await sleep(60_000);
                        round--;
                        break;
                    }
                    await ctx.bot.dismissBlockingUI().catch(() => undefined);
                }
                ctx.log('phase', { phase: p, status: status.get(p), round, holdings: this.holdings(), magic: this.magic(), hitpoints: this.hitpoints() });
            }
            if (this.o.phases.every(p => status.get(p) === 'done' || status.get(p) === 'skip')) break;
        }
        ctx.log('runes: finished', { status: Object.fromEntries(status), holdings: this.holdings() });
    }
}

export const role: Role = {
    name: 'runes',
    produces: [/ rune$/i, /^staff of (water|fire|earth)$/i, /^air talisman$/i],
    async run(ctx: RoleContext) {
        await new Runes(ctx).run();
    }
};

if (import.meta.main) await runStandalone(role);

export type { InventoryItem };
