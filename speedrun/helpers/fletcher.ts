// Fletching supplier: headless arrows and arrowheads for the scored account's
// Fletching (docs/speedrun/skills/fletching.md section 7, the adamant-cap list).
// Doc: docs/speedrun/helpers/fletcher.md.
//
//   ROLE_OPTIONS='{"mode":"headless","target":4245}' bun speedrun/helpers/fletcher.ts cairn_h78
//   ROLE_OPTIONS='{"mode":"camp","shop":"hickton"}'   bun speedrun/helpers/fletcher.ts cairn_h76
//   ROLE_OPTIONS='{"mode":"camp","shop":"dargaud"}'   bun speedrun/helpers/fletcher.ts cairn_h77
//
// mode 'headless' (Lumbridge side, banks at Draynor):
//   target: number        headless arrows to hold (bank + pack), default 4245
//   maxFeatherPrice       Gerrant's live price cap per feather, default 6
//   1. shafts: chop normal trees in the woods west of Lumbridge castle and cut
//      each log at once (15 shafts per log, stackable, so the pack never
//      fills), until shafts + headless arrows reach the target. Only normal
//      logs make shafts (cut_logs.dbrow). The knife comes from the Lumbridge
//      ground spawn. Not the trees beside Draynor bank: four level-26 Jail
//      guards (aggressive, huntrange 5, draynor.npc) spawn among them, and a
//      fresh account chopping there died twice in a minute on the demo. Every
//      walk between Lumbridge and Draynor bank goes round the guards to the
//      south (DRAYNOR_APPROACH).
//   2. feathers: from the bank, else bought at Gerrant (Port Sarim) with banked
//      coins; short of coins, it waits at Varrock west bank for a funder's trade.
//   3. attach: feather on shaft, 15 per action, one per tick, at Draynor bank.
//
// mode 'camp' (Kandarin): buy from one archery shop's restocks.
//   shop: 'hickton' | 'dargaud'
//   lines: [{ item, quantity, maxPrice? }]   default CAMP_LINES[shop]
//   coins: coins to carry over White Wolf Mountain (default remainingBudget(lines))
//   crossingHitpoints: Hitpoints to train before the crossing, default 40
//   passTicks: how long each line waits for a restock per pass, default 20
//   reportMinutes: bank and log holdings this often while camping, default 30
//   Shop stock is shared by the whole server and restocks one unit per
//   `stockrate` ticks up to its configured stock, whether or not anyone watches
//   (World.ts processCleanup). Hickton (archeryshop2, catherby.inv) restocks
//   mithril (400), adamant (200) and rune (100) arrowtips at +1 per 40 ticks
//   each, 300/h per item; Dargaud's adamant is 200, +1 per 50 (240/h). The price
//   is base x (1 + 0.01 x (stock - shelf)) (shop.rs2, delta 10), so a cap just
//   above base buys only off a near-full shelf: the same 300/h as draining it
//   (the restock is the limit), without paying up the drained shelf. A shelf
//   at its configured stock stops restocking, so the camper cycles through all
//   its lines with short waits (`passTicks`) and banks only every
//   `reportMinutes`. Out of coins, it walks back to Varrock west bank and waits
//   there for a funder, then crosses again with the budget for what is left.
//   Dargaud is inside the Ranging Guild (Ranged 40 at the door), so that
//   camper trains Ranged on cows first.
//
// mode 'bows' (Varrock west bank, beside the Grand Exchange): strung bows for the
// scored account, made by this account, training Fletching first when it must.
//   bows: [{ bow, count }]  strung bows to hold, in order (BOWS keys, e.g. 'magic shortbow')
//   level                   Fletching to reach before anything else is trained for (default 80)
//   trainLog                the log trained on, bought when the bank is short (default 'Yew logs')
//   maxPrices               GE caps per item name (default MAX_PRICES)
//   xpRate                  the server's xp multiplier (default 25, the demo's)
//   Each step is chosen from the live level, xp and holdings (bowsStep): a line
//   the level allows is made at once (cut, string, bank); otherwise it trains on
//   the best bow `trainLog` allows, cutting whole inventories with Make-X.
//   Unstrung and strung bows share a name in this revision ("Magic shortbow" is
//   both 72 and 861), so bows are counted and moved by item id.
//
// Every mode accepts funding trades (coins, or feathers in headless mode) from
// `funders` (default our helper accounts) while waiting at Varrock west bank,
// the place bidder.ts's `fund` trip and the handover role deliver to.
import { resolveSkillDialogProduct } from '../../sdk/action-quantity';
import { TRADE_REQUEST_CHAT_TYPE } from '../../sdk/types';
import type { BotWorldState, InventoryItem } from '../../sdk/types';
import { receiveFrom } from '../lib/trade';
import { tickMs } from '../lib/wait';
import { BANKS, Buyer, SHOPS } from './buyer';
import { cheb, crossFromKandarin, crossingSettings, crossToKandarin, inKandarin, trainHitpointsOnCows, trainOnCows, travel, type Pt, type Traveller } from '../lib/kandarin';
import { accountMatches, ChatCursor, DEFAULT_COURIERS, toRegExps } from './mule';
import { runStandalone, type Role, type RoleContext } from './role';

// ------------------------------------------------------------------ pure helpers (fletcher.test.ts)

export interface CampLine {
    item: string;
    quantity: number;
    maxPrice?: number;
}

/** Obj `cost` of the shop items this role buys (arrows.obj, fishing.obj). */
export const BASE_COST: Record<string, number> = {
    'bronze arrowtips': 1,
    'iron arrowtips': 2,
    'steel arrowtips': 6,
    'mithril arrowtips': 16,
    'adamant arrowtips': 40,
    'rune arrowtips': 200,
    'bronze arrow': 1,
    feather: 2
};

/** Live shop price of one unit with `shelf` in stock (shop.rs2 calc_shop_value, sell multiplier 1000). */
export function shelfPrice(base: number, shelf: number, stock: number, delta = 10): number {
    const shift = Math.min(1000, Math.max(-5000, (shelf - stock) * delta));
    return Math.floor((Math.max(100, 1000 - shift) * base) / 1000);
}

/** Patient caps: each buys only from a near-full shelf (shelfPrice; tests pin the shelf each allows). */
/** Adamant arrowtips (base 40, stock 200): a shelf of 196 or more. */
export const PATIENT_ADAMANT_PRICE = 41;
/** Rune arrowtips (base 200, stock 100 at Hickton): a shelf of 95 or more. */
export const PATIENT_RUNE_PRICE = 210;
/** Mithril arrowtips (base 16, stock 400 at Hickton): a shelf of 382 or more. */
export const PATIENT_MITHRIL_PRICE = 18;

/**
 * Default shopping lists (supply-fallbacks.md section 3, via rs/103): adamant
 * split between the shops in proportion to their restock rates; at Hickton
 * also rune arrowtips (Fletching 75+ stand-ins) and mithril arrowtips (which
 * fill the adamant shortfall; the 1,500 is shared with the Dargaud buyer of
 * rs/124). The small tiers come from Hickton's deep shelves at about base.
 */
export const CAMP_LINES: Record<'hickton' | 'dargaud', CampLine[]> = {
    hickton: [
        { item: 'Bronze arrowtips', quantity: 60 },
        { item: 'Iron arrowtips', quantity: 90 },
        { item: 'Steel arrowtips', quantity: 135 },
        { item: 'Adamant arrowtips', quantity: 2075, maxPrice: PATIENT_ADAMANT_PRICE },
        { item: 'Rune arrowtips', quantity: 560, maxPrice: PATIENT_RUNE_PRICE },
        { item: 'Mithril arrowtips', quantity: 1500, maxPrice: PATIENT_MITHRIL_PRICE }
    ],
    dargaud: [{ item: 'Adamant arrowtips', quantity: 1660, maxPrice: PATIENT_ADAMANT_PRICE }]
};

/** Coins a camper carries: each line at its cap (or 1.5x base), plus 5% and 500 spare. */
export function campBudget(lines: readonly CampLine[]): number {
    let sum = 0;
    for (const l of lines) {
        const base = BASE_COST[l.item.toLowerCase()] ?? 0;
        sum += l.quantity * (l.maxPrice ?? Math.ceil(base * 1.5));
    }
    return Math.ceil(sum * 1.05) + 500;
}

/** The budget for what is still to buy, given how many of each item are held (bank + pack). */
export function remainingBudget(lines: readonly CampLine[], held: (item: string) => number): number {
    return campBudget(lines.map(l => ({ ...l, quantity: Math.max(0, l.quantity - held(l.item)) })));
}

export interface HeadlessCounts {
    headless: number;
    shafts: number;
    feathers: number;
    logs: number;
}

/** What the headless line does next, from bank + pack counts. */
export function headlessStep(c: HeadlessCounts, target: number): 'done' | 'shafts' | 'feathers' | 'attach' {
    if (c.headless >= target) return 'done';
    const need = target - c.headless;
    if (c.shafts + c.logs * 15 < need) return 'shafts';
    if (c.feathers < Math.min(need, c.shafts)) return 'feathers';
    return 'attach';
}

/**
 * Bows by tier: the log, the level and base xp of cutting it (cut_logs.dbrow;
 * stringing gives the same), and the unstrung and strung item ids (obj.pack).
 * Strung and unstrung share the display name.
 */
export interface BowSpec {
    name: string;
    log: string;
    level: number;
    xp: number;
    unstrung: number;
    strung: number;
}
export const BOWS: Record<string, BowSpec> = {
    'willow shortbow': { name: 'Willow shortbow', log: 'Willow logs', level: 35, xp: 33.3, unstrung: 60, strung: 849 },
    'willow longbow': { name: 'Willow longbow', log: 'Willow logs', level: 40, xp: 41.5, unstrung: 58, strung: 847 },
    'maple shortbow': { name: 'Maple shortbow', log: 'Maple logs', level: 50, xp: 50, unstrung: 64, strung: 853 },
    'maple longbow': { name: 'Maple longbow', log: 'Maple logs', level: 55, xp: 58.3, unstrung: 62, strung: 851 },
    'yew shortbow': { name: 'Yew shortbow', log: 'Yew logs', level: 65, xp: 67.5, unstrung: 68, strung: 857 },
    'yew longbow': { name: 'Yew longbow', log: 'Yew logs', level: 70, xp: 75, unstrung: 66, strung: 855 },
    'magic shortbow': { name: 'Magic shortbow', log: 'Magic logs', level: 80, xp: 83.3, unstrung: 72, strung: 861 },
    'magic longbow': { name: 'Magic longbow', log: 'Magic logs', level: 85, xp: 91.5, unstrung: 70, strung: 859 }
};
export const BOW_STRING = 'Bow string';
/** GE caps (asks on 2026-10-22: yew logs 399, magic logs 2,250, bow string 146). */
export const MAX_PRICES: Record<string, number> = { 'Yew logs': 450, 'Maple logs': 300, 'Willow logs': 100, 'Magic logs': 2600, 'Bow string': 250 };
/** Bows made per bank trip: knife + logs + strings fill 27 of 28 slots. */
export const MAKE_PER_TRIP = 13;

export function bowSpec(bow: string): BowSpec {
    const spec = BOWS[bow.trim().toLowerCase()];
    if (!spec) throw new Error(`fletcher bows: unknown bow '${bow}' (one of ${Object.keys(BOWS).join(', ')})`);
    return spec;
}

/**
 * Experience at the start of `level` as the SDK reports it. This engine's curve
 * is 2^(l/10), not the standard 2^(l/7) (Player.ts levelExperience, which keeps
 * tenths): level 80 is 267,169, not 1,986,068.
 */
export function xpForLevel(level: number): number {
    let points = 0;
    for (let l = 1; l < level; l++) points += Math.floor(l + 300 * 2 ** (l / 10));
    return Math.floor(points / 4);
}

/** The best-xp bow `log` makes at `level`, or null when the level allows none. */
export function trainingBow(level: number, log: string): BowSpec | null {
    const options = Object.values(BOWS).filter(b => b.log.toLowerCase() === log.trim().toLowerCase() && b.level <= level);
    return options.sort((a, b) => b.xp - a.xp)[0] ?? null;
}

/** Logs of `bow` to cut from `xp` to the start of `level` at `xpRate` times base xp. */
export function logsToLevel(xp: number, level: number, bow: BowSpec, xpRate: number): number {
    return Math.max(0, Math.ceil((xpForLevel(level) - xp) / (bow.xp * xpRate)));
}

export interface BowLine {
    bow: string;
    count: number;
}
export interface BowsPlan {
    lines: BowLine[];
    level: number;
    trainLog: string;
    xpRate: number;
}
/** Bank + pack counts: bows by id (`strung`, `unstrung`), logs and strings by name (`item`, notes included). */
export interface BowHoldings {
    strung(bow: BowSpec): number;
    unstrung(bow: BowSpec): number;
    item(name: string): number;
}
export type BowStep =
    | { kind: 'make'; bow: BowSpec; make: number; cut: number; buyLogs: number; buyStrings: number }
    | { kind: 'train'; bow: BowSpec; target: number; logs: number; buyLogs: number }
    | { kind: 'done' }
    | { kind: 'stuck'; reason: string };

/**
 * What the bows mode does next. The first line short of its count that the
 * level allows is made (at most MAKE_PER_TRIP per trip, unstrung bows held
 * first). Otherwise it trains toward the plan's level, or the level of the
 * first line still short if that is higher, on the best bow of `trainLog`.
 */
export function bowsStep(level: number, xp: number, held: BowHoldings, plan: BowsPlan): BowStep {
    const short = plan.lines.map(l => ({ bow: bowSpec(l.bow), need: l.count - held.strung(bowSpec(l.bow)) })).filter(l => l.need > 0);
    const ready = short.find(l => l.bow.level <= level);
    if (ready) {
        const make = Math.min(ready.need, MAKE_PER_TRIP);
        const cut = make - Math.min(make, held.unstrung(ready.bow));
        return {
            kind: 'make',
            bow: ready.bow,
            make,
            cut,
            buyLogs: Math.max(0, cut - held.item(ready.bow.log)),
            buyStrings: Math.max(0, make - held.item(BOW_STRING))
        };
    }
    const target = Math.max(plan.level, ...short.map(l => l.bow.level));
    if (level >= target) return { kind: 'done' };
    const bow = trainingBow(level, plan.trainLog);
    if (!bow) return { kind: 'stuck', reason: `Fletching ${level} makes no bow from ${plan.trainLog}` };
    const logs = logsToLevel(xp, target, bow, plan.xpRate);
    return { kind: 'train', bow, target, logs, buyLogs: Math.max(0, logs - held.item(plan.trainLog)) };
}

interface DialogButton {
    index: number;
    text: string;
}
const squash = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, '');
const isMake = (t: string) => /^make(x|\d+)$/.test(squash(t));

/**
 * The button that makes the most of `product` in a skill_multi dialog, whose
 * products each have Make X, Make 10, Make 5 and a button carrying the
 * product's name (Make 1). The name button closes its group when the first
 * one is not the dialog's first option, and opens it otherwise.
 */
export function makeButton(options: readonly DialogButton[], product: DialogButton): { button: DialogButton; kind: 'x' | '10' | '5' | '1' } {
    const at = options.findIndex(o => o.index === product.index);
    const firstName = options.findIndex(o => o.text.trim() !== '' && !isMake(o.text));
    const group = firstName === 0 ? options.slice(at + 1, at + 4) : options.slice(Math.max(0, at - 3), at);
    for (const kind of ['x', '10', '5'] as const) {
        const button = group.find(o => squash(o.text) === `make${kind}`);
        if (button) return { button, kind };
    }
    return { button: product, kind: '1' };
}

// ------------------------------------------------------------------ places

/** Knife ground spawn south-east of Lumbridge castle (learnings/fletching.md); the GE asks 50,000 gp. */
export const KNIFE_SPAWN: Pt = { x: 3224, z: 3202 };
/**
 * The woods west of Lumbridge castle (m49_50, m50_50): about 100 normal trees
 * at x 3140-3190, z 3205-3255, with no aggressive spawn within 30 tiles.
 */
export const LUMBRIDGE_WOODS: Pt = { x: 3165, z: 3230 };
export const WOODS_RADIUS = 25;
const TREE = /^(tree|dead tree|evergreen)$/i;
/** Draynor jail guards' spawns (m48_50). They wander 5 tiles and chase to 7 from spawn (NpcType maxrange). */
export const JAIL_GUARDS: readonly Pt[] = [
    { x: 3109, z: 3237 },
    { x: 3120, z: 3238 },
    { x: 3121, z: 3249 },
    { x: 3127, z: 3248 }
];
/**
 * Waypoints from the Lumbridge side to Draynor bank, south of the guards. The
 * direct path passes one guard spawn at 1 tile; through these, every leg (both
 * directions, checked with sdk/pathfinding) stays 11 or more tiles from all four.
 */
export const DRAYNOR_APPROACH: readonly Pt[] = [
    { x: 3100, z: 3215 },
    { x: 3088, z: 3228 }
];
/** West of this x is the Draynor side of the guards; east is Lumbridge. */
const JAIL_SPLIT_X = 3100;

/** The approach waypoints to walk, in order, from `from` to `to` (none when both are on the same side). */
export function jailBypass(from: Pt, to: Pt): Pt[] {
    const band = (p: Pt) => p.z >= 3190 && p.z <= 3290;
    if (!band(from) || !band(to)) return [];
    const west = (p: Pt) => p.x < JAIL_SPLIT_X;
    if (west(from) === west(to)) return [];
    return west(to) ? [...DRAYNOR_APPROACH] : [...DRAYNOR_APPROACH].reverse();
}
/** Ranging Guild door (loc ranging_guild_door, m41_53 local 34,46) and a tile on each side. */
export const GUILD_DOOR = { x: 2658, z: 3438, id: 2514 };
const GUILD_OUTSIDE: Pt = { x: 2657, z: 3439 };
const GUILD_INSIDE: Pt = { x: 2660, z: 3436 };

const KNIFE = /^knife$/i;
/** Any woodcutting axe; shafts need one in the pack (a death loses the starter bronze axe). */
export const AXE = /^(bronze|iron|steel|black|mithril|adamant|rune|dragon) axe$/i;

/** What the shafts phase does about its axe: keep it, take one from the bank, or stop. */
export function axeAction(inPack: boolean, banked: number): 'ok' | 'withdraw' | 'none' {
    if (inPack) return 'ok';
    return banked > 0 ? 'withdraw' : 'none';
}
const LOGS = /^logs$/i;
const SHAFT = /^arrow shaft$/i;
const FEATHER = /^feather$/i;
const HEADLESS = /^headless arrow$/i;
const COINS = /^coins$/i;

class Stop extends Error {}

// ------------------------------------------------------------------ the role

class Fletcher {
    private readonly buyer: Buyer;
    private readonly requests: ChatCursor;
    private readonly funders: RegExp[];
    private bank = new Map<string, number>();
    private phase = '';

    constructor(private readonly ctx: RoleContext) {
        this.buyer = new Buyer(ctx);
        this.requests = new ChatCursor(ctx.sdk, [TRADE_REQUEST_CHAT_TYPE]);
        this.funders = toRegExps(ctx.options.funders ?? DEFAULT_COURIERS);
    }

    // ---------------------------------------------------------------- basics

    private get sdk() {
        return this.ctx.sdk;
    }
    private get bot() {
        return this.ctx.bot;
    }
    private state(): BotWorldState {
        const s = this.sdk.getState();
        if (!s?.player) throw new Error('no game state');
        return s;
    }
    private pos(): Pt {
        const p = this.state().player!;
        return { x: p.worldX, z: p.worldZ };
    }
    private tick(): number {
        return this.sdk.getState()?.tick ?? 0;
    }
    private checkSignal = () => {
        if (this.ctx.signal.aborted) throw new Stop();
    };
    private get traveller(): Traveller {
        return { bot: this.bot, sdk: this.sdk, log: this.ctx.log, checkSignal: this.checkSignal };
    }
    private setPhase(to: string, data: Record<string, unknown> = {}) {
        if (to === this.phase) return;
        this.ctx.log('phase', { from: this.phase || null, to, ...data });
        this.phase = to;
    }
    private inv(re: RegExp): number {
        return this.sdk.getInventory().filter(i => re.test(i.name)).reduce((a, i) => a + i.count, 0);
    }
    private banked(re: RegExp): number {
        let n = 0;
        for (const [name, c] of this.bank) if (re.test(name)) n += c;
        return n;
    }
    private held(re: RegExp): number {
        return this.inv(re) + this.banked(re);
    }
    private slot(re: RegExp): InventoryItem | undefined {
        return this.sdk.getInventory().find(i => re.test(i.name));
    }

    /** Walk to `dest`, going round the Draynor jail guards when the walk crosses them. */
    private async goTo(dest: Pt, tolerance: number, what: string): Promise<void> {
        for (const wp of jailBypass(this.pos(), dest)) await travel(this.traveller, wp, 2, `${what} (round the jail guards)`);
        await travel(this.traveller, dest, tolerance, what);
    }

    /** Open the bank at `at`, run `body`, refresh our bank counts and report them. */
    private async atBank<T>(at: Pt, body: () => Promise<T>): Promise<T> {
        await this.goTo(at, 3, 'bank');
        return this.buyer.atBank(at, async () => {
            try {
                return await body();
            } finally {
                this.bank = new Map(this.sdk.getBankItems().map(i => [i.name.toLowerCase(), i.count]));
            }
        });
    }

    private async deposit(re: RegExp): Promise<void> {
        if (this.inv(re) > 0) await this.bot.depositItem(re, -1);
    }
    private async withdraw(re: RegExp, n: number): Promise<number> {
        const have = this.sdk.getBankItems().find(i => re.test(i.name))?.count ?? 0;
        const take = Math.min(n, have);
        if (take > 0) await this.bot.withdrawItem(re, take);
        return take;
    }

    /**
     * Stand at Varrock west bank accepting trades from funders until `enough()`
     * (checked against carried + banked counts after each trade). Logs every
     * few minutes so a watcher can see what it is waiting for.
     */
    private async waitForFunds(what: string, enough: () => boolean): Promise<void> {
        this.setPhase('wait-funds', { what });
        await this.atBank(BANKS.varrockWest, async () => this.buyer.depositAllBut(['Knife', 'Shortbow', 'Bronze arrow', 'Bronze sword']));
        let lastLog = 0;
        while (!enough()) {
            this.checkSignal();
            if (Date.now() - lastLog > 180_000) {
                this.ctx.log('waiting for funds', { what, at: 'Varrock west bank', funders: this.funders.map(r => r.source), note: 'fund with bidder.ts <earner> fund, bidder = this account' });
                lastLog = Date.now();
            }
            const senders = [...new Set(this.requests.next().map(m => m.sender))].filter(n => this.funders.some(p => accountMatches(n, p)));
            for (const from of senders) {
                const r = await receiveFrom(this.sdk, from, { openTimeoutMs: 20_000 });
                this.ctx.log('funded', { from, ok: r.ok, reason: r.reason, received: r.received.map(i => `${i.name} x${i.count}`) });
            }
            if (senders.length > 0) await this.atBank(BANKS.varrockWest, async () => this.buyer.depositAllBut(['Knife', 'Shortbow', 'Bronze arrow', 'Bronze sword']));
            else await this.sdk.waitForTicks(5);
        }
    }

    // ---------------------------------------------------------------- headless mode

    private headlessCounts(): HeadlessCounts {
        return { headless: this.held(HEADLESS), shafts: this.held(SHAFT), feathers: this.held(FEATHER), logs: this.inv(LOGS) };
    }

    private async ensureKnife(): Promise<void> {
        if (this.slot(KNIFE)) return;
        if (this.banked(KNIFE) > 0) {
            await this.atBank(BANKS.draynor, async () => void (await this.withdraw(KNIFE, 1)));
            if (this.slot(KNIFE)) return;
        }
        this.setPhase('knife');
        await this.goTo(KNIFE_SPAWN, 1, 'knife spawn');
        for (let waited = 0; !this.slot(KNIFE); waited += 5) {
            this.checkSignal();
            const knife = this.state().groundItems.find(g => KNIFE.test(g.name) && cheb(g, KNIFE_SPAWN) <= 3);
            if (knife) {
                const r = await this.bot.pickupItem(knife);
                this.ctx.log('knife pickup', { ok: r.success, result: r.message });
                continue;
            }
            if (waited % 100 === 0) this.ctx.log('waiting for the knife to respawn', { waitedTicks: waited });
            await this.sdk.waitForTicks(5);
        }
    }

    private async ensureAxe(): Promise<void> {
        const act = axeAction(!!this.slot(AXE), this.banked(AXE));
        if (act === 'ok') return;
        if (act === 'withdraw') {
            await this.atBank(BANKS.draynor, async () => void (await this.withdraw(AXE, 1)));
            if (this.slot(AXE)) return;
        }
        // The GE has no axe sellers and the role does not buy one: bank one on this account and restart.
        throw new Error('no axe in the pack or the bank: the shafts phase needs one');
    }

    private async cutCarriedLogs(): Promise<void> {
        while (this.slot(LOGS)) {
            this.checkSignal();
            const r = await this.bot.fletchLogs('arrow shaft');
            if (!r.success) {
                const st = this.state();
                this.ctx.log('fletch failed', {
                    result: r.message,
                    logs: this.inv(LOGS),
                    knife: !!this.slot(KNIFE),
                    dialog: st.dialog.isOpen ? st.dialog.options?.map(o => o.text) : null,
                    iface: st.interface?.isOpen ? st.interface.options?.map(o => o.text) : null,
                    anim: st.player?.animId,
                    messages: st.gameMessages.slice(-4).map(m => m.text)
                });
                await this.bot.dismissBlockingUI();
                await this.sdk.waitForTicks(2);
                if (!this.slot(KNIFE)) return;
            }
        }
    }

    /** Chop one log from the nearest standing normal tree in the Lumbridge woods. */
    private async chopOne(): Promise<boolean> {
        if (cheb(this.pos(), LUMBRIDGE_WOODS) > WOODS_RADIUS) await this.goTo(LUMBRIDGE_WOODS, 3, 'Lumbridge woods');
        const trees = this.state()
            .nearbyLocs.filter(l => TREE.test(l.name) && l.level === 0 && cheb(l, LUMBRIDGE_WOODS) <= WOODS_RADIUS && l.optionsWithIndex.some(o => /chop/i.test(o.text)))
            .sort((a, b) => a.distance - b.distance);
        if (!trees[0]) {
            await this.sdk.waitForTicks(3);
            return false;
        }
        const r = await this.bot.chopTree(trees[0]);
        if (!r.success) await this.sdk.waitForTicks(1);
        return r.success;
    }

    private async makeShafts(target: number): Promise<void> {
        this.setPhase('shafts', { woodcutting: this.sdk.getSkill('Woodcutting')?.baseLevel, fletching: this.sdk.getSkill('Fletching')?.baseLevel });
        await this.ensureKnife();
        await this.ensureAxe();
        const t0 = this.tick();
        const shafts0 = this.held(SHAFT);
        let logs = 0;
        let lastBank = this.tick();
        while (headlessStep(this.headlessCounts(), target) === 'shafts') {
            this.checkSignal();
            await this.bot.dismissBlockingUI();
            if (!this.slot(KNIFE)) await this.ensureKnife();
            if (!this.slot(AXE)) await this.ensureAxe();
            if (this.slot(LOGS)) await this.cutCarriedLogs();
            else if (await this.chopOne()) logs++;
            // Bank the shafts every ~20 minutes so the ledger sees progress and a death costs little.
            if (this.tick() - lastBank > 4000) {
                await this.atBank(BANKS.draynor, () => this.deposit(SHAFT));
                const made = this.held(SHAFT) - shafts0;
                const hours = ((this.tick() - t0) * tickMs()) / 3_600_000;
                this.ctx.log('shafts banked', { shafts: this.held(SHAFT), made, logs, perHour: Math.round(made / Math.max(hours, 1e-6)), woodcutting: this.sdk.getSkill('Woodcutting')?.baseLevel });
                lastBank = this.tick();
            }
        }
        await this.cutCarriedLogs();
        await this.atBank(BANKS.draynor, () => this.deposit(SHAFT));
        const hours = ((this.tick() - t0) * tickMs()) / 3_600_000;
        this.ctx.log('shafts done', { shafts: this.held(SHAFT), made: this.held(SHAFT) - shafts0, logs, ticks: this.tick() - t0, perHour: Math.round((this.held(SHAFT) - shafts0) / Math.max(hours, 1e-6)) });
    }

    private async getFeathers(target: number): Promise<void> {
        const need = () => {
            const c = this.headlessCounts();
            return Math.min(target - c.headless, c.shafts) - c.feathers;
        };
        const maxPrice = Number(this.ctx.options.maxFeatherPrice ?? 6);
        while (need() > 0) {
            this.checkSignal();
            this.setPhase('feathers', { need: need() });
            const coinsNeeded = need() * maxPrice;
            if (this.held(COINS) < Math.min(coinsNeeded, 1000)) {
                await this.waitForFunds(`${need()} feathers or ${coinsNeeded} coins`, () => need() <= 0 || this.held(COINS) >= coinsNeeded);
                continue;
            }
            await this.atBank(BANKS.draynor, async () => {
                await this.buyer.depositAllBut(['Knife', 'Coins']);
                await this.buyer.setCoins(Math.min(this.held(COINS), coinsNeeded));
            });
            const r = await this.buyer.buyAtShop({ item: 'Feather', quantity: this.held(FEATHER) + need(), source: 'shop', shop: 'gerrant', maxPrice, maxWaitTicks: 600 });
            this.ctx.log('feathers', { ...r });
            await this.atBank(BANKS.draynor, () => this.buyer.depositAllBut(['Knife']));
            if (r.bought === 0 && r.note) await this.sdk.waitForTicks(20);
        }
    }

    /** Feather on shaft, one awaited action per tick (15 arrows each), withdrawing in rounds. */
    private async attach(target: number): Promise<void> {
        this.setPhase('attach');
        const t0 = this.tick();
        const before = this.held(HEADLESS);
        while (headlessStep(this.headlessCounts(), target) === 'attach') {
            this.checkSignal();
            const want = target - this.held(HEADLESS);
            await this.atBank(BANKS.draynor, async () => {
                await this.deposit(HEADLESS);
                if (this.inv(SHAFT) < want) await this.withdraw(SHAFT, want - this.inv(SHAFT));
                if (this.inv(FEATHER) < want) await this.withdraw(FEATHER, want - this.inv(FEATHER));
            });
            let stalls = 0;
            while (this.inv(SHAFT) > 0 && this.inv(FEATHER) > 0 && this.held(HEADLESS) < target && stalls < 5) {
                this.checkSignal();
                const f = this.slot(FEATHER)!;
                const s = this.slot(SHAFT)!;
                const had = this.inv(HEADLESS);
                await this.sdk.sendUseItemOnItem(f.slot, s.slot);
                const ok = await this.sdk.waitForCondition(st => st.inventory.filter(i => HEADLESS.test(i.name)).reduce((a, i) => a + i.count, 0) > had, 3000).then(() => true, () => false);
                stalls = ok ? 0 : stalls + 1;
                if (!ok) await this.bot.dismissBlockingUI();
            }
            if (stalls >= 5) throw new Error('attach stalled: feather on shaft had no effect 5 times');
        }
        await this.atBank(BANKS.draynor, () => this.deposit(HEADLESS));
        this.ctx.log('attached', { made: this.held(HEADLESS) - before, headless: this.held(HEADLESS), ticks: this.tick() - t0 });
    }

    async headless(): Promise<void> {
        const target = Number(this.ctx.options.target ?? 4245);
        // Auto-retaliate off: a stray hit would otherwise start a fight that stops the chopping.
        await crossingSettings(this.sdk, this.ctx.log);
        // Learn the bank first: every phase decides from bank + pack counts.
        await this.atBank(BANKS.draynor, () => this.buyer.depositAllBut(['Knife', 'Bronze axe', 'Coins']));
        this.ctx.log('start', { mode: 'headless', target, ...this.headlessCounts() });
        for (;;) {
            this.checkSignal();
            const step = headlessStep(this.headlessCounts(), target);
            if (step === 'done') break;
            if (step === 'shafts') await this.makeShafts(target);
            else if (step === 'feathers') await this.getFeathers(target);
            else await this.attach(target);
        }
        this.setPhase('done');
        this.ctx.log('done', { mode: 'headless', ...this.headlessCounts() });
    }

    // ---------------------------------------------------------------- camp mode

    /** True when the Ranging Guild's interior is reachable on foot from here (we are inside). */
    private async insideGuild(): Promise<boolean> {
        const { findLongPath, initPathfinding } = await import('../../sdk/pathfinding');
        initPathfinding();
        const p = this.pos();
        if (cheb(p, SHOPS.dargaud!.stand) > 40) return false;
        const path = findLongPath(0, p.x, p.z, SHOPS.dargaud!.stand.x, SHOPS.dargaud!.stand.z) as unknown;
        const wp = (Array.isArray(path) ? path : ((path as { waypoints?: Pt[] })?.waypoints ?? [])) as Pt[];
        const last = wp[wp.length - 1];
        return !!last && cheb(last, SHOPS.dargaud!.stand) <= 1;
    }

    private async useGuildDoor(entering: boolean): Promise<void> {
        if ((await this.insideGuild()) === entering) return;
        await travel(this.traveller, entering ? GUILD_OUTSIDE : GUILD_INSIDE, 1, entering ? 'Ranging Guild door (outside)' : 'Ranging Guild door (inside)');
        for (let attempt = 1; attempt <= 5; attempt++) {
            await this.sdk.sendInteractLoc(GUILD_DOOR.x, GUILD_DOOR.z, GUILD_DOOR.id, 1);
            for (let t = 0; t < 10; t++) {
                await this.sdk.waitForTicks(1);
                if ((await this.insideGuild()) === entering) {
                    this.ctx.log(entering ? 'entered the Ranging Guild' : 'left the Ranging Guild', { at: this.pos() });
                    return;
                }
            }
            this.ctx.log('guild door retry', { attempt, entering, at: this.pos(), ranged: this.sdk.getSkill('Ranged')?.baseLevel });
        }
        throw new Error(`could not ${entering ? 'enter' : 'leave'} the Ranging Guild`);
    }

    private arrowsLeft(): number {
        return this.inv(/^bronze arrow$/i) + this.sdk.getEquipment().filter(i => /^bronze arrow$/i.test(i.name)).reduce((a, i) => a + i.count, 0);
    }

    /** On the Lumbridge side: train what the shop and the crossing need, collect the coins, cross. */
    private async reachKandarin(shop: 'hickton' | 'dargaud', budgetOf: () => number, crossingHp: number): Promise<void> {
        // Evaluated after each bank visit, when the holdings are known.
        let budget = budgetOf();
        const hp = () => this.sdk.getSkill('Hitpoints')?.baseLevel ?? 10;
        const ranged = () => this.sdk.getSkill('Ranged')?.baseLevel ?? 1;
        const needRanged = shop === 'dargaud' ? 40 : 1;
        const coinsCarried = () => this.inv(COINS);
        // Coins at Varrock west, where funders deliver; the starter weapons stay in the pack.
        const collectCoins = async () => {
            await this.atBank(BANKS.varrockWest, async () => {
                await this.buyer.depositAllBut(['Shortbow', 'Bronze arrow', 'Bronze sword', 'Coins']);
                budget = budgetOf();
                await this.buyer.setCoins(Math.min(budget, this.held(COINS)));
            });
            if (coinsCarried() < budget) {
                await this.waitForFunds(`${budget} coins for ${shop}`, () => this.held(COINS) >= budget);
                await this.atBank(BANKS.varrockWest, async () => void (await this.buyer.setCoins(budget)));
            }
        };
        // The Dargaud camper buys its training arrows with these coins, so it collects them first;
        // the Hickton camper trains first and collects them on the way out.
        if (shop === 'dargaud') await collectCoins();
        if (ranged() < needRanged || hp() < crossingHp) {
            if (shop === 'dargaud') {
                while (ranged() < needRanged || hp() < crossingHp) {
                    this.checkSignal();
                    if (this.arrowsLeft() < 30) {
                        this.setPhase('buy-arrows');
                        const r = await this.buyer.buyAtShop({ item: 'Bronze arrow', quantity: this.inv(/^bronze arrow$/i) + 300, source: 'shop', shop: 'lowe', maxPrice: 3 });
                        this.ctx.log('arrows', { ...r });
                    }
                    for (const re of [/^shortbow$/i, /^bronze arrow$/i]) if (this.slot(re)) await this.bot.equipItem(re);
                    this.setPhase('train-ranged', { ranged: ranged(), hitpoints: hp() });
                    const kills = await trainOnCows(this.traveller, 'Ranged', () => (ranged() >= needRanged && hp() >= crossingHp) || this.arrowsLeft() === 0);
                    this.ctx.log('trained', { kills, ranged: ranged(), hitpoints: hp(), arrowsLeft: this.arrowsLeft() });
                }
            } else {
                if (this.slot(/^bronze sword$/i)) await this.bot.equipItem(/^bronze sword$/i);
                this.setPhase('train-hitpoints', { hitpoints: hp() });
                await trainHitpointsOnCows(this.traveller, crossingHp);
            }
        }
        if (coinsCarried() < budget) await collectCoins();
        this.setPhase('cross');
        await crossToKandarin(this.traveller, SHOPS[shop]!.bank, `${shop} bank`);
    }

    async camp(): Promise<void> {
        const shop = String(this.ctx.options.shop ?? '') as 'hickton' | 'dargaud';
        if (shop !== 'hickton' && shop !== 'dargaud') throw new Error(`fletcher camp: options.shop must be 'hickton' or 'dargaud', not '${shop}'`);
        const lines = (this.ctx.options.lines as CampLine[] | undefined) ?? CAMP_LINES[shop];
        const fixedCoins = this.ctx.options.coins === undefined ? null : Number(this.ctx.options.coins);
        const budget = () => fixedCoins ?? remainingBudget(lines, item => this.buyer.held(item));
        const crossingHp = Number(this.ctx.options.crossingHitpoints ?? 40);
        const passTicks = Number(this.ctx.options.passTicks ?? 20);
        const reportTicks = Math.round((Number(this.ctx.options.reportMinutes ?? 30) * 60_000) / tickMs());
        const spec = SHOPS[shop]!;
        const remaining = () => lines.filter(l => this.buyer.held(l.item) < l.quantity);
        const holdings = () => Object.fromEntries(lines.map(l => [l.item, this.buyer.held(l.item)]));
        this.ctx.log('start', { mode: 'camp', shop, lines, crossingHp, passTicks });
        await crossingSettings(this.sdk, this.ctx.log);
        let banked = false;
        // Per-item purchase rates since the first bank visit in Kandarin.
        let since: { tick: number; held: Record<string, number> } | null = null;
        let lastReport = 0;
        const report = () => {
            const held = holdings();
            const hours = since ? Math.max(((this.tick() - since.tick) * tickMs()) / 3_600_000, 1e-6) : 0;
            const perHour = since ? Object.fromEntries(lines.map(l => [l.item, Math.round((held[l.item]! - since!.held[l.item]!) / hours)])) : {};
            this.ctx.log('camp holdings', { held, perHour, hours: +hours.toFixed(2), coins: this.held(COINS) });
            lastReport = this.tick();
        };
        for (;;) {
            this.checkSignal();
            await this.bot.dismissBlockingUI();
            if (this.state().player!.isDead) {
                await this.sdk.waitForTicks(10);
                continue;
            }
            if (!inKandarin(this.state())) {
                await this.reachKandarin(shop, budget, crossingHp);
                banked = false;
                continue;
            }
            if (!banked) {
                if (shop === 'dargaud') await this.useGuildDoor(false);
                await this.atBank(spec.bank, () => this.buyer.depositAllBut(['Coins']));
                banked = true;
                if (!since) since = { tick: this.tick(), held: holdings() };
                report();
            }
            const todo = remaining();
            if (todo.length === 0) break;
            if (shop === 'dargaud') await this.useGuildDoor(true);
            this.setPhase('camp', { shop });
            // One pass: every line buys what its cap allows and waits at most passTicks for a restock,
            // so no shelf sits full (and stops restocking) while another line waits.
            let shortOfCoins = false;
            for (const line of todo) {
                const r = await this.buyer.buyAtShop({ item: line.item, quantity: line.quantity, source: 'shop', shop, maxPrice: line.maxPrice, maxWaitTicks: passTicks });
                if (r.bought > 0) this.ctx.log('camp line', { item: r.item, bought: r.bought, spent: r.spent, held: this.buyer.held(r.item), coins: this.inv(COINS) });
                if (r.note === 'out of coins') shortOfCoins = true;
            }
            if (shortOfCoins || this.tick() - lastReport >= reportTicks || remaining().length === 0) {
                if (shop === 'dargaud') await this.useGuildDoor(false);
                await this.atBank(spec.bank, () => this.buyer.depositAllBut(['Coins']));
                report();
            }
            if (shortOfCoins) {
                // Coins arrive only at Varrock west bank: go back, wait for a funder there, and cross
                // again with the budget for what is left (reachKandarin, next time round the loop).
                this.ctx.log('out of coins', { note: 'walking back to Varrock west bank for funding', budget: fixedCoins ?? remainingBudget(remaining(), item => this.buyer.held(item)), held: holdings() });
                this.setPhase('cross-back');
                await crossFromKandarin(this.traveller, BANKS.varrockWest, 'Varrock west bank');
            }
        }
        this.setPhase('done');
        this.ctx.log('done', { mode: 'camp', shop, held: holdings() });
    }

    // ---------------------------------------------------------------- bows mode

    private bankIds = new Map<number, number>();

    private invId(id: number): number {
        return this.sdk.getInventory().filter(i => i.id === id).reduce((a, i) => a + i.count, 0);
    }
    private heldId(id: number): number {
        return this.invId(id) + (this.bankIds.get(id) ?? 0);
    }
    private xp(): number {
        return this.sdk.getSkill('Fletching')?.experience ?? 0;
    }
    private level(): number {
        return this.sdk.getSkill('Fletching')?.baseLevel ?? 1;
    }
    private get holdings(): BowHoldings {
        return {
            strung: b => this.heldId(b.strung),
            unstrung: b => this.heldId(b.unstrung),
            // By name, so the GE's banknotes in the pack count too.
            item: name => this.held(new RegExp(`^${name}$`, 'i'))
        };
    }

    /** Varrock west bank, refreshing the per-id counts as well. */
    private async atVarrockBank<T>(body: () => Promise<T>): Promise<T> {
        return this.atBank(BANKS.varrockWest, async () => {
            try {
                return await body();
            } finally {
                this.bankIds = new Map(this.sdk.getBankItems().map(i => [i.id, i.count]));
            }
        });
    }

    /** Deposit everything but the knife, one id at a time (same-named bows are different ids). */
    private async depositAllButKnife(): Promise<void> {
        for (let pass = 0; pass < 3; pass++) {
            const item = this.sdk.getInventory().find(i => !KNIFE.test(i.name));
            if (!item) return;
            for (const id of [...new Set(this.sdk.getInventory().filter(i => !KNIFE.test(i.name)).map(i => i.id))]) {
                const it = this.sdk.getInventory().find(i => i.id === id);
                if (it) await this.bot.depositItem(it, -1);
            }
        }
    }

    private async withdrawId(id: number, n: number): Promise<number> {
        const b = this.sdk.getBankItems().find(i => i.id === id);
        const take = Math.min(n, b?.count ?? 0);
        if (b && take > 0) await this.bot.withdrawItem(b, take);
        return take;
    }

    /** Buy toward holding `quantity` of each line at the GE, waiting at Varrock west for funds when the coins fall short. */
    private async buyBowSupplies(lines: { item: string; quantity: number }[]): Promise<void> {
        const caps = { ...MAX_PRICES, ...((this.ctx.options.maxPrices as Record<string, number> | undefined) ?? {}) };
        const todo = lines.filter(l => l.quantity > this.held(new RegExp(`^${l.item}$`, 'i')));
        if (todo.length === 0) return;
        const cost = todo.reduce((a, l) => a + (l.quantity - this.held(new RegExp(`^${l.item}$`, 'i'))) * (caps[l.item] ?? 1000), 0);
        if (this.held(COINS) < cost) {
            this.setPhase('wait-funds', { cost });
            await this.waitForFunds(`${cost} coins for ${todo.map(l => `${l.item} x${l.quantity}`).join(', ')}`, () => this.held(COINS) >= cost);
        }
        this.setPhase('buy', { lines: todo });
        await this.atVarrockBank(async () => {
            await this.depositAllButKnife();
            await this.buyer.setCoins(Math.min(cost, this.held(COINS)));
        });
        for (const l of todo) {
            const r = await this.buyer.buyAtGE({ item: l.item, quantity: l.quantity, source: 'ge', maxPrice: caps[l.item] });
            this.ctx.log('ge', { ...r });
        }
        await this.atVarrockBank(() => this.depositAllButKnife());
    }

    private async ensureKnifeAtVarrock(): Promise<void> {
        if (this.slot(KNIFE)) return;
        await this.atVarrockBank(async () => void (await this.withdraw(KNIFE, 1)));
        if (!this.slot(KNIFE)) throw new Error('fletcher bows: no knife in the pack or the Varrock west bank');
    }

    /**
     * Cut every carried `bow.log` into unstrung `bow`s: knife on log, the bow's
     * Make-X with the carried count, then wait while the queued cuts land. The
     * queue is weak, so anything that interrupts it just costs a re-click.
     */
    private async cutCarried(bow: BowSpec): Promise<number> {
        const logRe = new RegExp(`^${bow.log}$`, 'i');
        const start = this.inv(logRe);
        let stalls = 0;
        while (this.inv(logRe) > 0 && stalls < 4) {
            this.checkSignal();
            await this.bot.dismissBlockingUI();
            const before = this.inv(logRe);
            const knife = this.slot(KNIFE);
            const log = this.slot(logRe);
            if (!knife || !log) break;
            await this.sdk.sendUseItemOnItem(knife.slot, log.slot);
            const opened = await this.sdk.waitForCondition(s => s.dialog.isOpen && s.dialog.options.some(o => isMake(o.text)), 5000).then(
                () => true,
                () => false
            );
            if (opened) {
                const options = this.state().dialog.options;
                const product = resolveSkillDialogProduct(options, bow.name);
                if (!product) throw new Error(`fletcher bows: no '${bow.name}' in the dialog (${options.map(o => o.text.trim()).join(' | ')})`);
                const { button, kind } = makeButton(options, product);
                await this.sdk.sendClickDialog(button.index);
                if (kind === 'x') {
                    await this.sdk.waitForTicks(1);
                    await this.sdk.sendCountDialog(before);
                }
                // Progress is one log every 2-3 ticks; 8 still ticks means the queue ended.
                let last = before;
                for (let idle = 0; this.inv(logRe) > 0 && idle < 8; ) {
                    await this.sdk.waitForTicks(1);
                    const n = this.inv(logRe);
                    if (n < last) {
                        last = n;
                        idle = 0;
                    } else idle++;
                }
            }
            if (this.inv(logRe) < before) stalls = 0;
            else {
                stalls++;
                const st = this.state();
                this.ctx.log('cut stalled', { bow: bow.name, logs: before, dialog: st.dialog.isOpen ? st.dialog.options.map(o => o.text.trim()) : null, messages: st.gameMessages.slice(-4).map(m => m.text) });
            }
        }
        return start - this.inv(logRe);
    }

    /** String every carried unstrung `bow`: one delay-free use per bow, each gated on the strung count rising. */
    private async stringCarried(bow: BowSpec): Promise<number> {
        const stringRe = /^bow string$/i;
        let made = 0;
        let stalls = 0;
        while (this.invId(bow.unstrung) > 0 && this.inv(stringRe) > 0 && stalls < 4) {
            this.checkSignal();
            await this.bot.dismissBlockingUI();
            const had = this.invId(bow.strung);
            const s = this.slot(stringRe)!;
            const u = this.sdk.getInventory().find(i => i.id === bow.unstrung)!;
            await this.sdk.sendUseItemOnItem(s.slot, u.slot);
            const ok = await this.sdk.waitForCondition(st => st.inventory.filter(i => i.id === bow.strung).reduce((a, i) => a + i.count, 0) > had, 3000).then(
                () => true,
                () => false
            );
            if (ok) {
                made++;
                stalls = 0;
            } else {
                stalls++;
                this.ctx.log('string stalled', { bow: bow.name, messages: this.state().gameMessages.slice(-3).map(m => m.text) });
            }
        }
        return made;
    }

    private async makeBows(step: Extract<BowStep, { kind: 'make' }>): Promise<void> {
        const { bow } = step;
        if (step.buyLogs > 0 || step.buyStrings > 0) {
            await this.buyBowSupplies([
                { item: bow.log, quantity: this.held(new RegExp(`^${bow.log}$`, 'i')) + step.buyLogs },
                { item: BOW_STRING, quantity: this.held(/^bow string$/i) + step.buyStrings }
            ]);
            return; // re-plan from the new holdings
        }
        this.setPhase(`make:${bow.name}`, { make: step.make, cut: step.cut, level: this.level() });
        await this.atVarrockBank(async () => {
            await this.depositAllButKnife();
            await this.withdrawId(bow.unstrung, step.make - step.cut);
            await this.withdraw(new RegExp(`^${bow.log}$`, 'i'), step.cut);
            await this.withdraw(/^bow string$/i, step.make);
        });
        const cut = await this.cutCarried(bow);
        const strung = await this.stringCarried(bow);
        await this.atVarrockBank(() => this.depositAllButKnife());
        this.ctx.log('made', { bow: bow.name, cut, strung, held: this.heldId(bow.strung), level: this.level() });
    }

    private async train(step: Extract<BowStep, { kind: 'train' }>): Promise<void> {
        const { bow } = step;
        if (step.buyLogs > 0) {
            await this.buyBowSupplies([{ item: bow.log, quantity: this.held(new RegExp(`^${bow.log}$`, 'i')) + step.buyLogs }]);
            return;
        }
        const logRe = new RegExp(`^${bow.log}$`, 'i');
        this.setPhase(`train:${bow.name}`, { level: this.level(), target: step.target, logs: step.logs });
        const t0 = this.tick();
        const xp0 = this.xp();
        let cut = 0;
        while (this.level() < step.target && this.held(logRe) > 0) {
            this.checkSignal();
            const before = this.tick();
            await this.atVarrockBank(async () => {
                await this.depositAllButKnife();
                await this.withdraw(logRe, 27);
            });
            if (this.inv(logRe) === 0) break;
            const n = await this.cutCarried(bow);
            cut += n;
            const hours = Math.max(((this.tick() - t0) * tickMs()) / 3_600_000, 1e-6);
            const left = logsToLevel(this.xp(), step.target, trainingBow(this.level(), bow.log) ?? bow, Number(this.ctx.options.xpRate ?? 25));
            this.ctx.log('trip', {
                bow: bow.name,
                cut: n,
                ticks: this.tick() - before,
                level: this.level(),
                xp: this.xp(),
                logsPerHour: Math.round(cut / hours),
                xpPerHour: Math.round((this.xp() - xp0) / hours),
                logsLeft: left,
                etaMinutes: Math.round((left / Math.max(cut / hours, 1)) * 60)
            });
            if (n === 0) throw new Error(`fletcher bows: cut no ${bow.log} in a whole trip`);
        }
        await this.atVarrockBank(() => this.depositAllButKnife());
    }

    async bows(): Promise<void> {
        const lines = ((this.ctx.options.bows as BowLine[] | undefined) ?? [{ bow: 'magic shortbow', count: 6 }]).map(l => ({ bow: bowSpec(l.bow).name, count: Number(l.count) }));
        const plan: BowsPlan = {
            lines,
            level: Number(this.ctx.options.level ?? 80),
            trainLog: String(this.ctx.options.trainLog ?? 'Yew logs'),
            xpRate: Number(this.ctx.options.xpRate ?? 25)
        };
        await this.ensureKnifeAtVarrock();
        await this.atVarrockBank(() => this.depositAllButKnife());
        this.ctx.log('start', { mode: 'bows', plan, level: this.level(), xp: this.xp() });
        for (;;) {
            this.checkSignal();
            const step = bowsStep(this.level(), this.xp(), this.holdings, plan);
            if (step.kind === 'done') break;
            if (step.kind === 'stuck') throw new Error(`fletcher bows: ${step.reason}`);
            if (step.kind === 'make') await this.makeBows(step);
            else await this.train(step);
        }
        this.setPhase('done');
        this.ctx.log('done', { mode: 'bows', level: this.level(), held: Object.fromEntries(lines.map(l => [l.bow, this.heldId(bowSpec(l.bow).strung)])) });
    }

    async run(): Promise<void> {
        await this.buyer.prepare();
        try {
            if (this.ctx.options.mode === 'camp') await this.camp();
            else if (this.ctx.options.mode === 'bows') await this.bows();
            else await this.headless();
        } catch (e) {
            if (e instanceof Stop) return;
            throw e;
        }
    }
}

export const role: Role = {
    name: 'fletcher',
    produces: [HEADLESS, SHAFT, /^(bronze|iron|steel|mithril|adamant) arrowtips$/i, /^(willow|maple|yew|magic) (short|long)bow$/i],
    async run(ctx: RoleContext) {
        await new Fletcher(ctx).run();
    }
};

if (import.meta.main) await runStandalone(role);
