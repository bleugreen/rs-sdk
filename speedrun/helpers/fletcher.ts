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
//   coins: coins to carry over White Wolf Mountain (default campBudget(lines))
//   crossingHitpoints: Hitpoints to train before the crossing, default 40
//   reportMinutes: bank and report this often while camping, default 30
//   Shop stock is shared by the whole server and restocks one unit per
//   `stockrate` ticks whether or not anyone watches (World.ts processCleanup;
//   a drained slot keeps restocking, Inventory.remove). Hickton's adamant
//   arrowtips: 200 shelf, +1 per 40 ticks (300/h); Dargaud's: 200, +1 per 50
//   (240/h). The price is base x (1 + 0.01 x (200 - shelf)) (shop.rs2, delta
//   10), so a cap of 41 buys only off a near-full shelf: the same 540 per hour
//   as draining it, at a third of the price. Dargaud is inside the Ranging
//   Guild (Ranged 40 at the door), so that camper trains Ranged on cows first.
//
// Both modes accept funding trades (coins, or feathers in headless mode) from
// `funders` (default our helper accounts) while waiting at Varrock west bank,
// the place bidder.ts's `fund` trip delivers to.
import { TRADE_REQUEST_CHAT_TYPE } from '../../sdk/types';
import type { BotWorldState, InventoryItem } from '../../sdk/types';
import { receiveFrom } from '../lib/trade';
import { BANKS, Buyer, SHOPS } from './buyer';
import { cheb, crossingSettings, crossToKandarin, inKandarin, trainHitpointsOnCows, trainOnCows, travel, type Pt, type Traveller } from '../lib/kandarin';
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
    'bronze arrow': 1,
    feather: 2
};

/** Live shop price of one unit with `shelf` in stock (shop.rs2 calc_shop_value, sell multiplier 1000). */
export function shelfPrice(base: number, shelf: number, stock: number, delta = 10): number {
    const shift = Math.min(1000, Math.max(-5000, (shelf - stock) * delta));
    return Math.floor((Math.max(100, 1000 - shift) * base) / 1000);
}

/** A cap of 41 on adamant arrowtips (base 40) buys only from a shelf of 196 or more (of 200). */
export const PATIENT_ADAMANT_PRICE = 41;

/**
 * Default split of the adamant-cap list between the two shops, in proportion to
 * their restock rates (300 and 240 per hour) so both finish together; the small
 * tiers come from Hickton's deep shelves at about base price.
 */
export const CAMP_LINES: Record<'hickton' | 'dargaud', CampLine[]> = {
    hickton: [
        { item: 'Bronze arrowtips', quantity: 60 },
        { item: 'Iron arrowtips', quantity: 90 },
        { item: 'Steel arrowtips', quantity: 135 },
        { item: 'Mithril arrowtips', quantity: 225 },
        { item: 'Adamant arrowtips', quantity: 2075, maxPrice: PATIENT_ADAMANT_PRICE }
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
        const t0 = this.tick();
        const shafts0 = this.held(SHAFT);
        let logs = 0;
        let lastBank = this.tick();
        while (headlessStep(this.headlessCounts(), target) === 'shafts') {
            this.checkSignal();
            await this.bot.dismissBlockingUI();
            if (!this.slot(KNIFE)) await this.ensureKnife();
            if (this.slot(LOGS)) await this.cutCarriedLogs();
            else if (await this.chopOne()) logs++;
            // Bank the shafts every ~20 minutes so the ledger sees progress and a death costs little.
            if (this.tick() - lastBank > 4000) {
                await this.atBank(BANKS.draynor, () => this.deposit(SHAFT));
                const made = this.held(SHAFT) - shafts0;
                const hours = ((this.tick() - t0) * 0.3) / 3600;
                this.ctx.log('shafts banked', { shafts: this.held(SHAFT), made, logs, perHour: Math.round(made / Math.max(hours, 1e-6)), woodcutting: this.sdk.getSkill('Woodcutting')?.baseLevel });
                lastBank = this.tick();
            }
        }
        await this.cutCarriedLogs();
        await this.atBank(BANKS.draynor, () => this.deposit(SHAFT));
        const hours = ((this.tick() - t0) * 0.3) / 3600;
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
    private async reachKandarin(shop: 'hickton' | 'dargaud', budget: number, crossingHp: number): Promise<void> {
        const hp = () => this.sdk.getSkill('Hitpoints')?.baseLevel ?? 10;
        const ranged = () => this.sdk.getSkill('Ranged')?.baseLevel ?? 1;
        const needRanged = shop === 'dargaud' ? 40 : 1;
        const coinsCarried = () => this.inv(COINS);
        // Coins at Varrock west, where funders deliver; the starter weapons stay in the pack.
        const collectCoins = async () => {
            await this.atBank(BANKS.varrockWest, async () => {
                await this.buyer.depositAllBut(['Shortbow', 'Bronze arrow', 'Bronze sword', 'Coins']);
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
        const budget = Number(this.ctx.options.coins ?? campBudget(lines));
        const crossingHp = Number(this.ctx.options.crossingHitpoints ?? 40);
        const reportTicks = Math.round(Number(this.ctx.options.reportMinutes ?? 30) * 200);
        const spec = SHOPS[shop]!;
        const remaining = () => lines.filter(l => this.buyer.held(l.item) < l.quantity);
        this.ctx.log('start', { mode: 'camp', shop, lines, budget, crossingHp });
        await crossingSettings(this.sdk, this.ctx.log);
        let banked = false;
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
            }
            const todo = remaining();
            if (todo.length === 0) break;
            if (shop === 'dargaud') await this.useGuildDoor(true);
            this.setPhase('camp', { shop });
            let shortOfCoins = false;
            for (const line of todo) {
                const r = await this.buyer.buyAtShop({ item: line.item, quantity: line.quantity, source: 'shop', shop, maxPrice: line.maxPrice, maxWaitTicks: reportTicks });
                this.ctx.log('camp line', { ...r, coins: this.inv(COINS) });
                if (r.note === 'out of coins') shortOfCoins = true;
            }
            if (shop === 'dargaud') await this.useGuildDoor(false);
            await this.atBank(spec.bank, () => this.buyer.depositAllBut(['Coins']));
            this.ctx.log('camp holdings', { held: Object.fromEntries(lines.map(l => [l.item, this.buyer.held(l.item)])), coins: this.held(COINS) });
            if (shortOfCoins && this.held(COINS) < 500) {
                // Coins live on the Lumbridge side; crossing back costs a trip and a death risk. Say so and wait.
                this.ctx.log('out of coins', { note: 'camping stopped: fund this account (it must cross back to Varrock west) or end the line', held: Object.fromEntries(lines.map(l => [l.item, this.buyer.held(l.item)])) });
                await this.sdk.waitForTicks(2000);
            }
        }
        this.setPhase('done');
        this.ctx.log('done', { mode: 'camp', shop, held: Object.fromEntries(lines.map(l => [l.item, this.buyer.held(l.item)])) });
    }

    async run(): Promise<void> {
        await this.buyer.prepare();
        try {
            if (this.ctx.options.mode === 'camp') await this.camp();
            else await this.headless();
        } catch (e) {
            if (e instanceof Stop) return;
            throw e;
        }
    }
}

export const role: Role = {
    name: 'fletcher',
    produces: [HEADLESS, SHAFT, /^(bronze|iron|steel|mithril|adamant) arrowtips$/i],
    async run(ctx: RoleContext) {
        await new Fletcher(ctx).run();
    }
};

if (import.meta.main) await runStandalone(role);
