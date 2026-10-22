// Woodcutter: takes a fresh account to the Woodcutting level it needs and stockpiles
// logs in its bank, magic logs being the long pole. Everything happens around one
// bank, Seers' Village, which has every tier within ~115 tiles of its booths.
//
//   bun speedrun/helpers/woodcutter.ts <account>        (lite client already running)
//
// Options (ROLE_OPTIONS JSON or fleet config):
//   tree: 'auto'|'normal'|'oak'|'willow'|'maple'|'yew'|'magic'
//       The tier to stockpile. 'auto' (default) always chops the best tier the
//       level allows. A fixed tier above the account's level trains on 'auto'
//       until the level is reached, then chops only that tier.
//   location: string   spot-id prefix restricting where to chop: '' (default, every
//                      spot in SPOTS order), 'seers', 'catherby', or one spot id
//                      such as 'seers-magic-north' to pin an account to it. Tiers
//                      with no matching spot fall back to every spot of that tier.
//   target: number     stop once the bank holds this many logs of the chosen tier
//                      ('auto' counts magic logs). Default: run until aborted.
//   buyAxe: boolean    (default true) buy the best axe Bob (Lumbridge) sells that
//                      the account can afford whenever it is on that side of the
//                      map, and once it reaches magic trees with a worse axe than
//                      steel, sell banked yews at Catherby for the 200 coins and
//                      make the trip (fetchBetterAxe). false: keep the starter axe.
//   crossingHitpoints: number  Hitpoints level to train on Lumbridge cows before
//                      the first walk over White Wolf Mountain (default 30; see
//                      trainForCrossing). 0 skips it.
//
// Engine facts this role leans on (server/content/scripts/skill_woodcutting):
// - Axes have no Woodcutting requirement in this revision, and an axe in the
//   pack works as well as a wielded one (woodcutting_axe_checker). Wielding only
//   frees a slot; it needs the Attack level in axes.obj `levelrequire`.
// - One chop roll every 4 ticks while the server loops the oploc; success when
//   floor(low*(99-L)/98) + floor(high*(L-1)/98) + 1 beats a random byte
//   (PlayerOps STAT_RANDOM, trees.dbrow successchance). The loop keeps going
//   until the tree turns into a stump or the pack is full, so we click once.
// - Every non-normal tree has a 1/8 chance per log to deplete for everyone, then
//   respawns after trees.dbrow `respawnrate` ticks (magic 400, yew 200, maple
//   120, willow/oak 30). Several players can chop one tree at once.
// - This server's xp curve is 2^(level/10) at 25x: Woodcutting 75 is 7,549 base
//   xp, about 30 yew logs, so training is minutes and the long pole is magic logs.
// - Random events are off on the demo (fly.toml NODE_RANDOM_EVENTS=false).
import type { BotActions } from '../../sdk/actions';
import type { BotSDK } from '../../sdk/index';
import type { BotWorldState, InventoryItem, NearbyLoc } from '../../sdk/types';
import { cheb, CROSSING_HITPOINTS, crossingSettings, inKandarin, restForCrossing, TAVERLEY, trainHitpointsOnCows, travel, type Pt, type Traveller } from '../lib/kandarin';
import { tickMs } from '../lib/wait';
import type { Role, RoleContext } from './role';
import { runStandalone } from './role';

type Tier = 'normal' | 'oak' | 'willow' | 'maple' | 'yew' | 'magic';

/**
 * Best first. Levels and `respawn` (ticks) from trees.dbrow `levelrequired` and
 * `respawnrate` (normal trees say 0; 30 is used so a bare spot still gets a pause);
 * names from the .loc configs.
 */
const TIERS: { tier: Tier; level: number; respawn: number; tree: RegExp; log: RegExp }[] = [
    { tier: 'magic', level: 75, respawn: 400, tree: /^magic tree$/i, log: /^magic logs$/i },
    { tier: 'yew', level: 60, respawn: 200, tree: /^yew$/i, log: /^yew logs$/i },
    { tier: 'maple', level: 45, respawn: 120, tree: /^maple tree$/i, log: /^maple logs$/i },
    { tier: 'willow', level: 30, respawn: 30, tree: /^willow$/i, log: /^willow logs$/i },
    { tier: 'oak', level: 15, respawn: 30, tree: /^oak$/i, log: /^oak logs$/i },
    { tier: 'normal', level: 1, respawn: 30, tree: /^(tree|dead tree|evergreen)$/i, log: /^logs$/i }
];
const ANY_LOGS = /^(logs|oak logs|willow logs|maple logs|yew logs|magic logs)$/i;
const AXE = /^(bronze|iron|steel|black|mithril|adamant|rune) axe$/i;
/** Best first. `price` is Bob's Brilliant Axes in Lumbridge (wiki/shops/bobs-brilliant-axes.md). */
const AXES: { name: RegExp; label: string; price?: number }[] = [
    { name: /^rune axe$/i, label: 'Rune axe' },
    { name: /^adamant axe$/i, label: 'Adamant axe' },
    { name: /^mithril axe$/i, label: 'Mithril axe' },
    { name: /^black axe$/i, label: 'Black axe' },
    { name: /^steel axe$/i, label: 'Steel axe', price: 200 },
    { name: /^iron axe$/i, label: 'Iron axe', price: 56 },
    { name: /^bronze axe$/i, label: 'Bronze axe', price: 16 }
];
const COINS = /^coins$/i;
/** The axe worth a trip back to Bob once the account chops magic trees (see fetchBetterAxe). */
const UPGRADE_AXE = AXES.find(a => a.label === 'Steel axe')!;
/**
 * Arhein's general store in Catherby, next to the Catherby bank: the nearest shop
 * in Kandarin that buys logs. catherby.npc: shop_buy_multiplier 400, shop_delta 30.
 */
const ARHEIN = { x: 2804, z: 3431 };
const ARHEIN_BUY = { multiplier: 400, delta: 30 };
/** Logs worth selling for coins, best first, with their obj `cost` (skill_firemaking/configs/firemaking.obj). */
const SELLABLE_LOGS: { name: string; cost: number }[] = [
    { name: 'Yew logs', cost: 160 },
    { name: 'Maple logs', cost: 80 }
];
// Coordinates read from the map files (server/content/maps/*.jm2) and checked with
// the SDK pathfinder (sdk/pathfinding.ts) from the bank stand tiles.
const BANKS = {
    seers: { x: 2725, z: 3491 }, // booths 2721-2729,3494
    catherby: { x: 2809, z: 3439 }, // booths 2806-2812,3442
    draynor: { x: 3092, z: 3243 } // bankers 3088-3090,3242-3245
};
type BankId = keyof typeof BANKS;
const BOB = { x: 3230, z: 3203 }; // Bob's Brilliant Axes, npc spawn 3232,3203

interface Spot {
    id: string;
    tier: Tier;
    bank: BankId;
    /** A walkable tile among the trees; trees within `radius` of it belong to the spot. */
    stand: Pt;
    radius: number;
}
/** In preference order per tier. */
const SPOTS: Spot[] = [
    // 3 trees 69-73 tiles from the bank, and 4 more ~115 tiles out. The only
    // magic trees outside quest areas: the rest are in the Gnome Stronghold
    // (bank upstairs) and Tirannwn (Regicide).
    { id: 'seers-magic-north', tier: 'magic', bank: 'seers', stand: { x: 2693, z: 3426 }, radius: 6 },
    { id: 'seers-magic-south', tier: 'magic', bank: 'seers', stand: { x: 2701, z: 3400 }, radius: 6 },
    // Catherby first: 7 trees and, on the demo, no other player on our tree (332
    // yews/h); the 3 Seers yews had 33-43 players around them (72-133/h).
    { id: 'catherby-yews', tier: 'yew', bank: 'catherby', stand: { x: 2761, z: 3435 }, radius: 12 },
    { id: 'seers-yews', tier: 'yew', bank: 'seers', stand: { x: 2709, z: 3462 }, radius: 7 },
    { id: 'seers-maples', tier: 'maple', bank: 'seers', stand: { x: 2727, z: 3498 }, radius: 7 },
    { id: 'seers-maples-south', tier: 'maple', bank: 'seers', stand: { x: 2724, z: 3472 }, radius: 10 },
    { id: 'seers-willows', tier: 'willow', bank: 'seers', stand: { x: 2711, z: 3507 }, radius: 9 },
    { id: 'catherby-willows', tier: 'willow', bank: 'catherby', stand: { x: 2777, z: 3430 }, radius: 10 },
    { id: 'seers-oaks', tier: 'oak', bank: 'seers', stand: { x: 2726, z: 3485 }, radius: 10 },
    { id: 'catherby-oaks', tier: 'oak', bank: 'catherby', stand: { x: 2766, z: 3455 }, radius: 12 },
    { id: 'seers-trees', tier: 'normal', bank: 'seers', stand: { x: 2724, z: 3478 }, radius: 10 },
    { id: 'catherby-trees', tier: 'normal', bank: 'catherby', stand: { x: 2762, z: 3462 }, radius: 10 }
];

const onTutorialIsland = (s: BotWorldState | null) =>
    !!s?.player && s.player.worldX >= 3050 && s.player.worldX <= 3156 && s.player.worldZ >= 3056 && s.player.worldZ <= 3136;
const exact = (name: string) => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
const axeRank = (name: string) => {
    const i = AXES.findIndex(a => a.name.test(name));
    return i < 0 ? Infinity : i;
};

/**
 * Chance per 4-tick roll of getting a log: floor(lo*(99-L)/98) + floor(hi*(L-1)/98) + 1
 * out of 256 (PlayerOps STAT_RANDOM with trees.dbrow successchance lo,hi). On a magic
 * tree at level 75: bronze 5/256, iron 7, steel 10, rune 17.
 */
export function chopChance(level: number, lo: number, hi: number): number {
    return (Math.floor((lo * (99 - level)) / 98) + Math.floor((hi * (level - 1)) / 98) + 1) / 256;
}

/**
 * What a shop pays for the n-th unit sold (n from 0) when it already holds `held`
 * above its base stock (shop.rs2 calc_shop_value with the shop's buy multiplier).
 */
export function shopBuyPrice(cost: number, n: number, held = 0, shop = ARHEIN_BUY): number {
    const multiplier = Math.max(100, shop.multiplier - Math.min(1000, Math.max(-5000, (held + n) * shop.delta)));
    return Math.floor((multiplier * cost) / 1000);
}

/**
 * Logs to take out of the bank to raise `need` coins at Arhein's, yews first, plus
 * `spare` more of the last kind used in case other players have sold the same logs
 * there recently (which lowers his price). null when the bank cannot raise it.
 */
export function planLogSale(need: number, bank: Record<string, number>, spare = 2): { name: string; count: number }[] | null {
    if (need <= 0) return [];
    const plan: { name: string; count: number }[] = [];
    let raised = 0;
    for (const log of SELLABLE_LOGS) {
        const have = bank[log.name] ?? 0;
        let count = 0;
        while (count < have && raised < need) raised += shopBuyPrice(log.cost, count++);
        if (count === 0) continue;
        plan.push({ name: log.name, count: Math.min(have, count + (raised >= need ? spare : 0)) });
        if (raised >= need) return plan;
    }
    return null;
}

class Stop extends Error {}

class Woodcutter {
    private bot: BotActions;
    private sdk: BotSDK;
    private readonly startedAt = Date.now();
    private readonly startTick: number;
    private wantTier: Tier | 'auto';
    private location: string;
    private target: number;
    private buyAxe: boolean;
    private crossingHitpoints: number;
    /** Index into the current tier's spot list; advanced when a spot is crowded or bare. */
    private spotIndex = 0;
    private spotTier: Tier | null = null;
    /** Logs banked and ticks spent (walk + chop + bank) per tier during this run. */
    private perTier: Record<string, { logs: number; ticks: number }> = {};
    private trips = 0;
    private lastLevel = 0;
    private phase = 'start';
    private bankLogs: Record<string, number> = {};
    /** Trees that refused us recently (unreachable): `x,z` -> tick until which to skip. */
    private avoid = new Map<string, number>();
    /** fetchBetterAxe runs at most once per process, so a sold-out Bob cannot loop it. */
    private upgradeTried = false;
    /** Spot id -> tick it was last given up as bare or crowded. */
    private gaveUp = new Map<string, number>();
    /** Axes the server refused to wield (the Attack level is short); they work from the pack. */
    private unwieldable = new Set<string>();

    constructor(private ctx: RoleContext) {
        this.bot = ctx.bot;
        this.sdk = ctx.sdk;
        this.startTick = ctx.sdk.getState()?.tick ?? 0;
        const tree = String(ctx.options.tree ?? 'auto');
        if (tree !== 'auto' && !TIERS.some(t => t.tier === tree)) throw new Error(`unknown tree option '${tree}'`);
        this.wantTier = tree as Tier | 'auto';
        this.location = String(ctx.options.location ?? '');
        this.target = Number(ctx.options.target ?? Infinity);
        this.buyAxe = ctx.options.buyAxe !== false;
        this.crossingHitpoints = Number(ctx.options.crossingHitpoints ?? CROSSING_HITPOINTS);
    }

    // ---------------------------------------------------------------- basics

    private state(): BotWorldState {
        const s = this.sdk.getState();
        if (!s?.player) throw new Error('no game state');
        return s;
    }
    private tick(): number {
        return this.sdk.getState()?.tick ?? 0;
    }
    private pos() {
        const p = this.state().player!;
        return { x: p.worldX, z: p.worldZ, level: p.level };
    }
    private checkSignal() {
        if (this.ctx.signal.aborted) throw new Stop();
    }
    private wc(): number {
        return this.sdk.getSkill('Woodcutting')?.baseLevel ?? 1;
    }
    /** One log line per phase change (tutorial, train-hitpoints, trek, chop-<tier>), so a watcher can tell training from a stuck loop. */
    private setPhase(to: string) {
        if (to === this.phase) return;
        this.ctx.log('phase', { from: this.phase, to, levels: { woodcutting: this.wc(), hitpoints: this.sdk.getSkill('Hitpoints')?.baseLevel } });
        this.phase = to;
    }
    private freeSlots(): number {
        return 28 - this.sdk.getInventory().length;
    }
    private messagesSince(tick: number): string[] {
        return (this.sdk.getState()?.gameMessages ?? []).filter(m => m.tick >= tick && m.type === 0).map(m => m.text);
    }
    private wornAxe(): InventoryItem | undefined {
        return this.sdk.getEquipment().find(i => AXE.test(i.name));
    }
    private bestPackAxe(): InventoryItem | undefined {
        return this.sdk.getInventory().filter(i => AXE.test(i.name)).sort((a, b) => axeRank(a.name) - axeRank(b.name))[0];
    }
    /** The best axe on us, worn or carried. */
    private heldAxe(): InventoryItem | undefined {
        return [this.wornAxe(), this.bestPackAxe()].filter((i): i is InventoryItem => !!i).sort((a, b) => axeRank(a.name) - axeRank(b.name))[0];
    }
    /** The pack axe worth keeping: the best carried one, if it beats the worn one. */
    private keptPackAxe(): InventoryItem | undefined {
        const pack = this.bestPackAxe();
        const worn = this.wornAxe();
        return pack && (!worn || axeRank(pack.name) < axeRank(worn.name)) ? pack : undefined;
    }
    /** Anything in the pack that is neither logs nor the axe we keep. */
    private junk(): InventoryItem[] {
        const keep = this.keptPackAxe();
        return this.sdk.getInventory().filter(i => !ANY_LOGS.test(i.name) && i.slot !== keep?.slot);
    }

    /** The tier to chop now: the wanted tier once the level allows it, else the best one the level allows. */
    private tierNow() {
        const level = this.wc();
        if (this.wantTier !== 'auto') {
            const want = TIERS.find(t => t.tier === this.wantTier)!;
            if (level >= want.level) return want;
        }
        return TIERS.find(t => level >= t.level)!;
    }
    private spotsFor(tier: Tier): Spot[] {
        const all = SPOTS.filter(s => s.tier === tier);
        const mine = all.filter(s => s.id.startsWith(this.location));
        return mine.length ? mine : all;
    }
    private currentSpot(): Spot {
        const tier = this.tierNow().tier;
        if (this.spotTier !== tier) {
            this.spotTier = tier;
            this.spotIndex = 0;
        }
        const spots = this.spotsFor(tier);
        const spot = spots[this.spotIndex % spots.length];
        if (!spot) throw new Error(`no spot for ${tier}`);
        return spot;
    }

    private get traveller(): Traveller {
        return { bot: this.bot, sdk: this.sdk, log: this.ctx.log, checkSignal: () => this.checkSignal() };
    }

    /** Walk with the SDK pathfinder, retrying from wherever the last attempt stopped. */
    private async travel(dest: Pt, tolerance = 2, what = '', timeout = 180_000): Promise<void> {
        await travel(this.traveller, dest, tolerance, what, timeout);
    }

    // ---------------------------------------------------------------- bank and shop (small, so they can switch to speedrun/lib)

    private async openBankAt(bank: BankId): Promise<void> {
        await this.travel(BANKS[bank], 3, `${bank} bank`);
        for (let attempt = 1; attempt <= 3; attempt++) {
            const r = await this.bot.openBank();
            if (r.success) return;
            this.ctx.log('openBank retry', { bank, attempt, reason: r.message });
            await this.sdk.waitForTicks(2);
        }
        throw new Error(`could not open the ${bank} bank`);
    }

    private async deposit(pattern: RegExp): Promise<void> {
        const r = await this.bot.depositItem(pattern, -1);
        if (!r.success) this.ctx.log('deposit short', { item: String(pattern), reason: r.message });
    }

    private reportBank(bank: BankId) {
        const items = this.sdk.getBankItems().map(i => ({ id: i.id, name: i.name, count: i.count }));
        this.ctx.reportBank({ items });
        this.bankLogs = Object.fromEntries(items.filter(i => ANY_LOGS.test(i.name)).map(i => [i.name, i.count]));
        return items;
    }

    /**
     * With the bank open: deposit everything except the best axe (withdrawing a
     * better one from the bank if it holds one), and optionally withdraw coins.
     */
    private async depositAllButAxe(withdrawCoins = false): Promise<void> {
        if (this.sdk.countInventoryItems(ANY_LOGS) > 0) await this.deposit(ANY_LOGS);
        const banked = this.sdk.getBankItems().filter(i => AXE.test(i.name)).sort((a, b) => axeRank(a.name) - axeRank(b.name))[0];
        const held = this.heldAxe();
        const takeBanked = !!banked && (!held || axeRank(banked.name) < axeRank(held.name));
        const keep = takeBanked ? undefined : this.keptPackAxe();
        for (const item of [...this.sdk.getInventory()]) {
            if (item.slot === keep?.slot) continue;
            if (!this.sdk.getInventory().some(i => i.slot === item.slot && i.id === item.id)) continue; // deposited with a twin
            await this.deposit(exact(item.name));
        }
        if (takeBanked) {
            // A worse worn axe stays worn; wieldBestAxe swaps them if Attack allows.
            const w = await this.bot.withdrawItem(exact(banked!.name), 1);
            this.ctx.log('withdrew axe', { axe: banked!.name, ok: w.success });
        }
        if (withdrawCoins) {
            const coins = this.sdk.getBankItems().find(i => COINS.test(i.name));
            if (coins) await this.bot.withdrawItem(COINS, coins.count);
        }
    }

    /** Wield the best carried axe if the Attack level allows; otherwise it works from the pack. */
    private async wieldBestAxe(): Promise<void> {
        const carried = this.keptPackAxe();
        if (!carried || this.unwieldable.has(carried.name) || !carried.optionsWithIndex.some(o => /wield/i.test(o.text))) return;
        const r = await this.bot.equipItem(carried);
        if (!r.success) {
            this.unwieldable.add(carried.name);
            this.ctx.log('axe stays in the pack', { axe: carried.name, reason: r.message });
        }
    }

    /** Bank at the spot's bank: logs in, junk in, best axe out, bank reported. */
    private async bank(bank: BankId): Promise<Record<string, number>> {
        const carrying: Record<string, number> = {};
        for (const i of this.sdk.getInventory()) if (ANY_LOGS.test(i.name)) carrying[i.name] = (carrying[i.name] ?? 0) + i.count;
        await this.openBankAt(bank);
        await this.depositAllButAxe();
        this.reportBank(bank);
        await this.bot.closeBank();
        await this.wieldBestAxe();
        return carrying;
    }

    /** Buy the best axe Bob sells that the held coins afford and that beats the held axe. */
    private async visitBob(): Promise<void> {
        await this.travel(BOB, 3, "Bob's Brilliant Axes");
        const open = await this.bot.openShop(/^bob$/i);
        if (!open.success) throw new Error(`could not open Bob's shop: ${open.message}`);
        const coins = this.sdk.countInventoryItems(COINS);
        const held = this.heldAxe();
        const pick = AXES.find(a => a.price !== undefined && a.price <= coins && (!held || axeRank(a.label) < axeRank(held.name)));
        if (pick) {
            const r = await this.bot.buyFromShop(pick.name, 1);
            this.ctx.log('bought axe', { axe: pick.label, ok: r.success, coins, reason: r.success ? undefined : r.message });
        }
        await this.bot.closeShop();
        await this.wieldBestAxe();
    }

    /**
     * At magic trees the bronze axe is the bottleneck: the Seers trees are camped
     * (20+ other players), every log goes to whoever's roll lands first, so an
     * account's share scales with chopChance. Steel doubles it (10 vs 5 per 256 at
     * level 75). No better axe is listed on the exchange, so the upgrade is Bob's
     * steel axe; the trip (sell yews at Catherby, cross east, buy, cross back) costs
     * about 10 minutes and pays back in about 30.
     */
    private wantsBetterAxe(): boolean {
        const held = this.heldAxe();
        return this.buyAxe && !this.upgradeTried && this.tierNow().tier === 'magic' && !!held && axeRank(held.name) > axeRank(UPGRADE_AXE.label);
    }

    /**
     * Raise Bob's price by selling banked yews (then maples) to Arhein in Catherby,
     * and walk out of Kandarin. The main loop then runs trekToSeers, which buys the
     * axe at Bob's and crosses back. A death on the way east respawns in Lumbridge
     * with the coins (a top-3 item), so it only shortens the walk.
     */
    private async fetchBetterAxe(): Promise<void> {
        this.upgradeTried = true;
        const price = UPGRADE_AXE.price!;
        this.setPhase('axe-upgrade');
        await this.openBankAt('seers');
        await this.depositAllButAxe(true);
        const bank = Object.fromEntries(this.sdk.getBankItems().map(i => [i.name, i.count]));
        const plan = planLogSale(price - this.sdk.countInventoryItems(COINS), bank);
        if (plan) for (const { name, count } of plan) await this.bot.withdrawItem(exact(name), count);
        this.reportBank('seers');
        await this.bot.closeBank();
        if (!plan) {
            this.ctx.log('axe upgrade skipped: not enough logs to sell', { coins: this.sdk.countInventoryItems(COINS), price });
            return;
        }
        if (plan.length > 0) {
            await this.travel(ARHEIN, 3, "Arhein's store");
            const open = await this.bot.openShop(/^arhein$/i);
            if (!open.success) throw new Error(`could not open Arhein's store: ${open.message}`);
            for (const { name } of plan) {
                while (this.sdk.countInventoryItems(COINS) < price && this.sdk.countInventoryItems(exact(name)) > 0) {
                    const r = await this.bot.sellToShop(exact(name), 1);
                    if (!r.success) {
                        this.ctx.log('sell refused', { item: name, reason: r.message });
                        break;
                    }
                }
            }
            await this.bot.closeShop();
        }
        const coins = this.sdk.countInventoryItems(COINS);
        this.ctx.log('axe upgrade: walking to Bob', { coins, price, sold: plan });
        if (coins < price) return; // the coins and leftover logs are banked on the next cycle
        await restForCrossing(this.traveller);
        await this.travel(TAVERLEY, 4, 'Taverley', 300_000);
    }

    // ---------------------------------------------------------------- getting set up

    /** Auto-retaliate off and run on, for White Wolf Mountain (speedrun/lib/kandarin.ts). */
    private async travelSettings(): Promise<void> {
        await crossingSettings(this.sdk, this.ctx.log);
    }

    /** Train Hitpoints on Lumbridge cows until the account can survive White Wolf Mountain (speedrun/lib/kandarin.ts). */
    private async trainForCrossing(): Promise<void> {
        if ((this.sdk.getSkill('Hitpoints')?.baseLevel ?? 10) >= this.crossingHitpoints) return;
        this.setPhase('train-hitpoints');
        await trainHitpointsOnCows(this.traveller, this.crossingHitpoints);
    }

    /** On the Lumbridge side: stash the starter kit at Draynor, sort out the axe, then walk to Seers. */
    private async trekToSeers(): Promise<void> {
        const t0 = this.tick();
        const affordable = (coins: number) =>
            AXES.find(a => a.price !== undefined && a.price <= coins && (!this.heldAxe() || axeRank(a.label) < axeRank(this.heldAxe()!.name)));
        if (this.buyAxe && affordable(this.sdk.countInventoryItems(COINS))) await this.visitBob();
        await this.wieldBestAxe();
        await this.trainForCrossing();
        // A death keeps only the 3 most valuable items, and the 16 gp bronze axe is
        // worth less than the starter sword and bow: bank everything else first.
        if (this.junk().length > 0 || !this.heldAxe()) {
            await this.openBankAt('draynor');
            const bankCoins = this.sdk.getBankItems().find(i => COINS.test(i.name))?.count ?? 0;
            const needAxe = !this.heldAxe() && !this.sdk.getBankItems().some(i => AXE.test(i.name));
            const upgrade = this.buyAxe && affordable(bankCoins + this.sdk.countInventoryItems(COINS));
            await this.depositAllButAxe(needAxe || !!upgrade);
            this.reportBank('draynor');
            await this.bot.closeBank();
            await this.wieldBestAxe();
            if (needAxe || upgrade) {
                if (this.sdk.countInventoryItems(COINS) < 16 && !this.heldAxe()) throw new Error('no axe anywhere and under 16 coins');
                await this.visitBob();
                if (this.junk().some(i => !COINS.test(i.name))) throw new Error('unexpected items after buying an axe');
            }
        }
        if (!this.heldAxe()) throw new Error('no axe after visiting Bob');
        this.setPhase('trek');
        this.ctx.log('trek to Seers', { from: this.pos(), axe: this.heldAxe()!.name });
        await restForCrossing(this.traveller);
        await this.travel(TAVERLEY, 4, 'Taverley', 300_000);
        await this.travel(BANKS.seers, 3, "Seers' bank", 300_000);
        this.ctx.log('arrived at Seers', { ticks: this.tick() - t0, hitpoints: this.sdk.getSkill('Hitpoints')?.level });
    }

    /** In Kandarin with no axe on us: take the best one from the bank, or go back east to buy one. */
    private async ensureAxe(): Promise<void> {
        if (this.heldAxe()) return;
        await this.openBankAt('seers');
        await this.depositAllButAxe(true);
        this.reportBank('seers');
        await this.bot.closeBank();
        await this.wieldBestAxe();
        if (this.heldAxe()) return;
        if (this.sdk.countInventoryItems(COINS) < 16) throw new Error('no axe in pack, equipment or bank, and under 16 coins');
        this.ctx.log('no axe: walking back to Bob');
        await restForCrossing(this.traveller);
        await this.travel(TAVERLEY, 4, 'Taverley', 300_000);
        await this.visitBob();
    }

    // ---------------------------------------------------------------- chopping

    private treesAt(spot: Spot, locs: NearbyLoc[], tree: RegExp): NearbyLoc[] {
        return locs.filter(l => tree.test(l.name) && l.level === 0 && cheb(l, spot.stand) <= spot.radius && l.optionsWithIndex.some(o => /chop/i.test(o.text)));
    }
    private othersNear(t: Pt, within = 2): number {
        const me = this.state().player!.name;
        // Trees are anchored at their south-west tile and magic/yew trees are 2x2.
        return this.state().nearbyPlayers.filter(p => p.name !== me && p.x >= t.x - within && p.x <= t.x + 1 + within && p.z >= t.z - within && p.z <= t.z + 1 + within).length;
    }

    /**
     * Chop at the current spot until the pack is full. Returns early (without
     * banking) when the tier changes or the spot is given up for another.
     */
    private async chopUntilFull(stats: { spotPlayers: Set<string>; maxOthersAtTree: number; waits: number }): Promise<void> {
        let spot = this.currentSpot();
        const tier = this.tierNow();
        this.setPhase(`chop-${tier.tier}`);
        await this.travel(spot.stand, Math.min(4, spot.radius), spot.id);
        let bareSince = 0;
        let crowdedSince = 0;
        let heartbeat = this.tick();
        while (this.freeSlots() > 0) {
            this.checkSignal();
            // A magic trip can run 40+ minutes; the fleet restarts a role that logs
            // nothing for 20 (HELPERS.md, stallMinutes), so report every 10.
            if (this.tick() - heartbeat >= 2000) {
                heartbeat = this.tick();
                const carried = Object.fromEntries(
                    TIERS.map(t => [t.tier, this.sdk.countInventoryItems(t.log)] as const).filter(([, n]) => n > 0)
                );
                this.ctx.log('chopping', { spot: spot.id, carried, woodcutting: this.wc(), playersNear: this.state().nearbyPlayers.filter(p => p.name !== this.state().player!.name).length });
            }
            if (this.tierNow().tier !== tier.tier) return; // levelled into a new tier: go to its spot with what we carry
            const s = this.state();
            if (s.player!.isDead) throw new Error('died at the trees');
            if (s.dialog.isOpen || s.interface?.isOpen) await this.bot.dismissBlockingUI();
            const locs = await this.sdk.scanNearbyLocs(spot.radius + 12);
            const now = this.tick();
            for (const p of s.nearbyPlayers) if (cheb(p, spot.stand) <= spot.radius + 2 && p.name !== s.player!.name) stats.spotPlayers.add(p.name);
            const trees = this.treesAt(spot, locs, tier.tree).filter(t => (this.avoid.get(`${t.x},${t.z}`) ?? 0) < now);
            const alternatives = this.spotsFor(tier.tier).length > 1;
            if (trees.length === 0) {
                bareSince ||= now;
                // Every tree here is a stump: after a short wait, move to another spot
                // that has a standing tree (or is out of sight), else keep waiting here.
                // Moving blindly ping-pongs between two bare magic clusters and arrives
                // late to every respawn.
                if (alternatives && now - bareSince > 10) {
                    const next = await this.spotWithStandingTree(tier, spot);
                    if (next !== undefined) {
                        this.ctx.log('spot bare, moving', { from: spot.id, to: this.spotsFor(tier.tier)[next]!.id });
                        this.spotIndex = next;
                        return;
                    }
                }
                stats.waits++;
                await this.sdk.waitForTicks(2);
                continue;
            }
            bareSince = 0;
            const me = { x: s.player!.worldX, z: s.player!.worldZ };
            const scored = trees.map(t => ({ t, others: this.othersNear(t), d: cheb(t, me) })).sort((a, b) => a.others - b.others || a.d - b.d);
            const best = scored[0]!;
            stats.maxOthersAtTree = Math.max(stats.maxOthersAtTree, best.others);
            // Sharing a tree is allowed but halves its life for each of us; if every
            // live tree has two or more other players on it, try the next spot.
            if (best.others >= 2 && alternatives) {
                crowdedSince ||= now;
                if (now - crowdedSince > 30) {
                    const next = await this.spotWithStandingTree(tier, spot);
                    if (next !== undefined) {
                        this.ctx.log('spot crowded, moving', { from: spot.id, to: this.spotsFor(tier.tier)[next]!.id, others: best.others });
                        this.spotIndex = next;
                        return;
                    }
                    crowdedSince = now;
                }
            } else crowdedSince = 0;
            await this.chopTree(best.t, tier.tree);
            spot = this.currentSpot();
        }
    }

    /**
     * The index (into spotsFor(tier)) of the next other spot that has a standing
     * tree, or that is out of sight and was not given up within one respawn time.
     * The lite client's scene spans the loaded map region, so a 40-tile scan covers
     * both Seers magic clusters; Catherby is out of sight from Seers, and without
     * the respawn memory an account ping-pongs between two bare yew spots. Records
     * the current spot as given up when it returns a move.
     */
    private async spotWithStandingTree(tier: (typeof TIERS)[number], current: Spot): Promise<number | undefined> {
        const SCAN = 40;
        const spots = this.spotsFor(tier.tier);
        const locs = await this.sdk.scanNearbyLocs(SCAN);
        const me = this.pos();
        const now = this.tick();
        const start = Math.max(0, spots.indexOf(current));
        for (let k = 1; k < spots.length; k++) {
            const i = (start + k) % spots.length;
            const spot = spots[i]!;
            const visible = cheb(me, spot.stand) + spot.radius <= SCAN;
            const go = visible
                ? this.treesAt(spot, locs, tier.tree).some(t => (this.avoid.get(`${t.x},${t.z}`) ?? 0) < now)
                : now - (this.gaveUp.get(spot.id) ?? -Infinity) >= tier.respawn;
            if (go) {
                this.gaveUp.set(current.id, now);
                return i;
            }
        }
        return undefined;
    }

    /** Click a tree once and keep watching while the server loops the chop. */
    private async chopTree(tree: NearbyLoc, name: RegExp): Promise<void> {
        const clickTick = this.tick();
        const r = await this.bot.interactLoc(tree, /chop/i);
        const msgs = this.messagesSince(clickTick);
        if (msgs.some(m => /do not have an axe/i.test(m))) throw new Error('the server says we have no usable axe');
        if (msgs.some(m => /need a woodcutting level/i.test(m))) throw new Error(`level too low for ${tree.name}: ${msgs.join(' | ')}`);
        if (!r.success) {
            // Felled by someone else on the way, or unreachable from where we stand.
            const still = this.sdk.getState()?.nearbyLocs.some(l => l.x === tree.x && l.z === tree.z && name.test(l.name));
            if (still) this.avoid.set(`${tree.x},${tree.z}`, this.tick() + 50);
            this.ctx.log('chop refused', { tree: tree.name, at: { x: tree.x, z: tree.z }, reason: r.message, msgs });
            return;
        }
        let idle = 0;
        let logs = this.sdk.countInventoryItems(ANY_LOGS);
        while (this.freeSlots() > 0) {
            this.checkSignal();
            await this.sdk.waitForTicks(1);
            const s = this.sdk.getState();
            if (!s?.player) return;
            // Level-up dialogs stop the loop: dismiss and re-click.
            if (s.dialog.isOpen) {
                await this.bot.dismissBlockingUI();
                return;
            }
            const standing = s.nearbyLocs.some(l => l.x === tree.x && l.z === tree.z && name.test(l.name));
            if (!standing) return; // stump: pick the next tree
            const n = this.sdk.countInventoryItems(ANY_LOGS);
            if (n > logs) {
                logs = n;
                idle = 0;
                const level = this.wc();
                if (level !== this.lastLevel) this.onLevel(level);
                if (this.tierNow().tier !== TIERS.find(t => t.tree === name)?.tier) return;
            }
            // The chop animation replays on each 4-tick roll; six idle ticks in a
            // row means the server dropped the loop (interrupted, or never ran).
            idle = s.player.animId === -1 ? idle + 1 : 0;
            if (idle >= 6) return;
        }
    }

    private onLevel(level: number) {
        const prev = this.lastLevel;
        this.lastLevel = level;
        if (prev === 0) return;
        const ticks = this.tick() - this.startTick;
        const crossed = [15, 30, 45, 60, 75, 99].filter(m => prev < m && level >= m);
        this.ctx.log('level', { woodcutting: level, ticksThisRun: ticks, minutesThisRun: Math.round((Date.now() - this.startedAt) / 60_000), milestone: crossed[0] });
    }

    // ---------------------------------------------------------------- main loop

    private targetReached(): boolean {
        if (!Number.isFinite(this.target)) return false;
        const tier = TIERS.find(t => t.tier === (this.wantTier === 'auto' ? 'magic' : this.wantTier))!;
        const have = Object.entries(this.bankLogs).find(([n]) => tier.log.test(n))?.[1] ?? 0;
        return have >= this.target;
    }

    private async trip(): Promise<void> {
        const t0 = this.tick();
        const tier = this.tierNow().tier;
        const spot = this.currentSpot();
        const stats = { spotPlayers: new Set<string>(), maxOthersAtTree: 0, waits: 0 };
        await this.chopUntilFull(stats);
        if (this.freeSlots() > 0) return; // moved spot or tier: keep chopping before banking
        const t1 = this.tick();
        const banked = await this.bank(this.currentSpot().bank);
        const t2 = this.tick();
        this.trips++;
        const hours = ((this.tick() - this.startTick) * tickMs()) / 3_600_000;
        for (const [name, count] of Object.entries(banked)) {
            const k = name.toLowerCase();
            this.perTier[k] ??= { logs: 0, ticks: 0 };
            this.perTier[k].logs += count;
        }
        const main = Object.entries(banked).sort((a, b) => b[1] - a[1])[0]?.[0]?.toLowerCase();
        if (main) this.perTier[main]!.ticks += t2 - t0;
        this.ctx.log('trip', {
            trip: this.trips,
            tier,
            spot: spot.id,
            banked,
            ticks: t2 - t0,
            ticksChopping: t1 - t0,
            ticksBanking: t2 - t1,
            woodcutting: this.wc(),
            axe: this.heldAxe()?.name,
            otherPlayersAtSpot: [...stats.spotPlayers].length,
            maxOthersAtTree: stats.maxOthersAtTree,
            respawnWaits: stats.waits,
            bankLogs: this.bankLogs,
            logsPerHour: Object.fromEntries(Object.entries(this.perTier).filter(([, v]) => v.ticks > 0).map(([k, v]) => [k, Math.round(v.logs / ((v.ticks * tickMs()) / 3_600_000))])),
            hoursThisRun: Math.round(hours * 100) / 100
        });
    }

    async run(): Promise<void> {
        await this.sdk.waitForReady(30_000);
        if (onTutorialIsland(this.state())) {
            this.setPhase('tutorial');
            for (let i = 0; i < 30 && onTutorialIsland(this.state()); i++) {
                await this.bot.skipTutorial();
                await this.sdk.waitForTicks(3);
            }
            this.ctx.log('tutorial skipped', { at: this.pos() });
        }
        this.lastLevel = this.wc();
        await this.travelSettings();
        this.ctx.log('start', { woodcutting: this.lastLevel, tree: this.wantTier, location: this.location, at: this.pos(), axe: this.heldAxe()?.name ?? null });
        let failures = 0;
        while (!this.ctx.signal.aborted && !this.targetReached()) {
            try {
                await this.bot.dismissBlockingUI();
                if (this.state().player!.isDead) {
                    await this.sdk.waitForTicks(10);
                    continue;
                }
                if (!inKandarin(this.state())) await this.trekToSeers();
                await this.ensureAxe();
                if (this.wantsBetterAxe()) {
                    await this.fetchBetterAxe();
                    continue;
                }
                if (this.freeSlots() === 0 || this.junk().length > 0) {
                    await this.bank(this.currentSpot().bank);
                    if (this.junk().length > 0) throw new Error(`could not bank ${this.junk().map(i => i.name).join(', ')}`);
                }
                await this.trip();
                failures = 0;
            } catch (e) {
                if (e instanceof Stop) break;
                failures++;
                this.ctx.log('cycle failed', { error: String((e as Error)?.message ?? e), failures, at: this.sdk.getState()?.player ? this.pos() : null });
                if (failures >= 8) throw e;
                await this.sdk.waitForTicks(5 * failures);
            }
        }
        this.ctx.log('stopping', { trips: this.trips, bankLogs: this.bankLogs, perTier: this.perTier });
    }
}

export const role: Role = {
    name: 'woodcutter',
    produces: [ANY_LOGS],
    async run(ctx: RoleContext) {
        await new Woodcutter(ctx).run();
    }
};

if (import.meta.main) await runStandalone(role);
