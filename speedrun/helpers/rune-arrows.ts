// Rune arrows: buy them at Dargaud's Bow and Arrows in the Ranging Guild, the
// only shop that keeps them in stock (ranging.inv: 400 on the shelf at 400 gp,
// one restocked per 130 ticks, shared by every player). Nobody sells them on
// the Grand Exchange. Notes: docs/speedrun/helpers/rune-arrows.md.
//
//   ROLE_OPTIONS='{"target":650,"maxPrice":410}' bun speedrun/helpers/rune-arrows.ts <account>
//
// Options:
//   target             rune arrows to hold, bank and pack (default 650)
//   maxPrice           most to pay for one arrow (default 410; see Price)
//   bankEvery          arrows bought between trips to the Seers' bank (default 100)
//   crossingHitpoints  Hitpoints to train before White Wolf Mountain (default 30)
//   extras             more of Dargaud's stock to buy between rune-arrow waits:
//                      [{"item":"Mithril arrowtips","target":750,"maxPrice":24}], each
//                      a holding target and a unit cap; rune arrows come first
//
// Phases, each skipped when already done, so a restart resumes where it was:
// 1. train: the guild door opens for Ranged 40 (ranging_guild_door.rs2) and the
//    walk over White Wolf Mountain wants Hitpoints 30 (lib/kandarin.ts). A
//    shortbow and bronze arrows from Lowe's in Varrock, rapid style, Lumbridge
//    cows. On this server's curve (2^(level/10), 25x) Ranged 40 is ~160 damage
//    and Hitpoints 30 ~190, so Ranged ends a little past 40.
// 2. trek: bank the pack at Draynor (a death keeps only 3 items), then walk via
//    Taverley to the Seers' bank. Coins come out of the bank on the far side.
// 3. buy: through the guild door, buy while the next arrow costs at most
//    maxPrice and wait for restocks otherwise; bank at Seers' every bankEvery.
//
// Price: base 400 plus 4 gp for every arrow the shelf is below 400 (shop_delta
// 10; buyer.ts). The restock, not the price, limits throughput: ~92 arrows an
// hour on 300 ms ticks whatever the cap, so a cap a few gp above 400 buys each
// arrow within a restock or two of a full shelf. A higher cap only front-loads.
import { cheb, COW_PEN, CROSSING_HITPOINTS, crossToKandarin, inCowPen, type Pt, travel, type Traveller, westOfTaverley } from '../lib/kandarin';
import { BANKS, Buyer } from './buyer';
import { runStandalone, type Role, type RoleContext } from './role';

const RUNE_ARROW = 'Rune arrow';
const TRAINING_ARROW = 'Bronze arrow';
const TRAINING_ARROWS = 400;
const BOW = 'Shortbow';
const GUILD_RANGED = 40;
/** Ticks buyAtShop waits for restocks per call; the role logs between calls. */
const WAIT_TICKS = 1200;
/** The wait per call while extras are wanted too, so they are bought between rune-arrow waits. */
const EXTRA_WAIT_TICKS = 400;
/** Units of each extra to carry coins for from the bank. */
const EXTRA_UNITS = 300;

/** The guild door: a diagonal door on the compound's north-west corner (m41_53, loc 2514). */
const GUILD_DOOR: Pt = { x: 2658, z: 3438 };
/** The door's script counts anything west or north of it as outside; Ranged 40 teleports the player two tiles south-east, and back. */
const OUTSIDE_DOOR: Pt = { x: 2657, z: 3439 };
const INSIDE_DOOR: Pt = { x: 2659, z: 3437 };

/**
 * Inside the guild compound: south or east of the door (its own test; the tile
 * just south of it, 2658,3437, is inside) and south-west of the diagonal
 * barricade on the north-east side (wood_wall_barricadel, 2677,3438 to
 * 2681,3434). Only the part around the door and Dargaud matters here.
 */
export function inGuild(p: Pt): boolean {
    return p.x >= GUILD_DOOR.x && p.x <= 2700 && p.z >= 3400 && p.z < GUILD_DOOR.z && p.x + p.z <= 6114;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const exactly = (name: string) => new RegExp(`^${name}$`, 'i');

export interface Options {
    target: number;
    maxPrice: number;
    bankEvery: number;
    crossingHitpoints: number;
    extras: Extra[];
}

/** Another of Dargaud's lines: hold `target`, paying at most `maxPrice` a unit. */
export interface Extra {
    item: string;
    target: number;
    maxPrice: number;
}

function parseExtras(v: unknown): Extra[] {
    if (!Array.isArray(v)) return [];
    const ok = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
    return v
        .filter((e): e is Extra => !!e && typeof e.item === 'string' && ok(e.target) && ok(e.maxPrice))
        .map(e => ({ item: e.item, target: e.target, maxPrice: e.maxPrice }));
}

export function parseOptions(o: Record<string, unknown>): Options {
    const num = (key: string, fallback: number) => {
        const v = o[key];
        return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback;
    };
    return {
        target: num('target', 650),
        maxPrice: num('maxPrice', 410),
        bankEvery: Math.max(1, num('bankEvery', 100)),
        crossingHitpoints: num('crossingHitpoints', CROSSING_HITPOINTS),
        extras: parseExtras(o.extras)
    };
}

class Aborted extends Error {}

export class RuneArrows {
    readonly buyer: Buyer;
    private readonly traveller: Traveller;

    constructor(
        private readonly ctx: RoleContext,
        private readonly opt: Options
    ) {
        this.buyer = new Buyer(ctx);
        this.traveller = { bot: ctx.bot, sdk: ctx.sdk, log: ctx.log, checkSignal: () => this.checkSignal() };
    }

    private get sdk() {
        return this.ctx.sdk;
    }
    private get bot() {
        return this.ctx.bot;
    }
    private here(): Pt {
        const p = this.sdk.getState()!.player!;
        return { x: p.worldX, z: p.worldZ };
    }
    private tick(): number {
        return this.sdk.getState()?.tick ?? 0;
    }
    private level(skill: string): number {
        return this.sdk.getSkill(skill)?.baseLevel ?? 1;
    }
    private checkSignal(): void {
        if (this.ctx.signal.aborted) throw new Aborted();
    }
    trained(): boolean {
        return this.level('Ranged') >= GUILD_RANGED && this.level('Hitpoints') >= this.opt.crossingHitpoints;
    }
    private bowEquipped(): boolean {
        return this.sdk.getEquipment().some(i => same(i.name, BOW));
    }
    private ammo(): number {
        return this.sdk.getEquipment().filter(i => same(i.name, TRAINING_ARROW)).reduce((a, i) => a + i.count, 0);
    }
    private carried(name: string): number {
        return this.sdk.getState()!.inventory.filter(i => same(i.name, name)).reduce((a, i) => a + i.count, 0);
    }

    async run(): Promise<void> {
        await this.buyer.prepare();
        if (!westOfTaverley(this.here())) {
            if (!this.trained()) await this.train();
            await this.trek();
        } else if (this.level('Ranged') < GUILD_RANGED) {
            throw new Error(`west of Taverley with Ranged ${this.level('Ranged')}: the guild door needs ${GUILD_RANGED}`);
        }
        await this.buy();
    }

    // ---------------------------------------------------------------- travel

    /** kandarin.ts travel: walkTo with retries; a death ends the role (the account respawns in Lumbridge and a restart resumes). */
    private travel(dest: Pt, tolerance: number, what: string, timeout?: number): Promise<void> {
        return travel(this.traveller, dest, tolerance, what, timeout);
    }

    /** Through the guild door from `side`, which must be the door's tile on the side we are on. */
    private async throughDoor(side: Pt, entering: boolean): Promise<void> {
        await this.travel(side, 1, entering ? 'outside the guild door' : 'inside the guild door');
        for (let attempt = 1; attempt <= 4; attempt++) {
            this.checkSignal();
            const door = this.sdk.getState()!.nearbyLocs.find(l => /^guild door$/i.test(l.name) && cheb(l, GUILD_DOOR) <= 1);
            if (!door) {
                this.ctx.log('guild door not in view', { attempt, at: this.here() });
                await this.sdk.waitForTicks(2);
                continue;
            }
            await this.bot.interactLoc(door, 'Open');
            const through = await this.sdk
                .waitForCondition(s => !!s.player && inGuild({ x: s.player.worldX, z: s.player.worldZ }) === entering, 10_000)
                .then(
                    () => true,
                    () => false
                );
            if (through) return;
            await this.bot.dismissBlockingUI(); // the doorman's "You must be a level 40 ranger"
            this.ctx.log('guild door retry', { attempt, at: this.here(), ranged: this.level('Ranged') });
        }
        throw new Error(`could not ${entering ? 'enter' : 'leave'} the Ranging Guild from (${this.here().x}, ${this.here().z})`);
    }

    async enterGuild(): Promise<void> {
        if (!inGuild(this.here())) await this.throughDoor(OUTSIDE_DOOR, true);
    }

    async leaveGuild(): Promise<void> {
        if (inGuild(this.here())) await this.throughDoor(INSIDE_DOOR, false);
    }

    // ---------------------------------------------------------------- 1. train

    private async train(): Promise<void> {
        const t0 = this.tick();
        this.ctx.log('phase', { phase: 'train', ranged: this.level('Ranged'), hitpoints: this.level('Hitpoints'), crossingHitpoints: this.opt.crossingHitpoints });
        let kills = 0;
        while (!this.trained()) {
            this.checkSignal();
            if (this.ammo() === 0 || !this.bowEquipped()) await this.gearUp();
            kills += await this.fightCows();
        }
        this.ctx.log('trained', { ranged: this.level('Ranged'), hitpoints: this.level('Hitpoints'), kills, ticks: this.tick() - t0 });
    }

    /** Shortbow and bronze arrows from the bank or Lowe's, wielded, rapid style. */
    private async gearUp(): Promise<void> {
        await this.buyer.atBank(BANKS.varrockEast, async () => {
            await this.buyer.depositAllBut(['Coins', BOW, TRAINING_ARROW]);
            const banked = (name: string) => this.sdk.getBankItems().find(i => same(i.name, name))?.count ?? 0;
            if (!this.bowEquipped() && this.carried(BOW) === 0 && banked(BOW) > 0) await this.bot.withdrawItem(exactly(BOW), 1);
            if (banked(TRAINING_ARROW) > 0) await this.bot.withdrawItem(exactly(TRAINING_ARROW), banked(TRAINING_ARROW));
            await this.buyer.setCoins(2_000);
        });
        if (!this.bowEquipped() && this.carried(BOW) === 0) {
            const r = await this.buyer.buyAtShop({ item: BOW, quantity: 1, source: 'shop', shop: 'lowe', maxPrice: 100 });
            this.ctx.log('bought', { ...r });
        }
        if (this.carried(TRAINING_ARROW) < TRAINING_ARROWS / 4) {
            const r = await this.buyer.buyAtShop({ item: TRAINING_ARROW, quantity: TRAINING_ARROWS, source: 'shop', shop: 'lowe', maxPrice: 3 });
            this.ctx.log('bought', { ...r });
        }
        if (!this.bowEquipped()) await this.bot.equipItem(exactly(BOW));
        if (this.carried(TRAINING_ARROW) > 0) await this.bot.equipItem(exactly(TRAINING_ARROW));
        if (!this.bowEquipped() || this.ammo() === 0) throw new Error(`no ${BOW} or ${TRAINING_ARROW} to wield after Lowe's`);
        const cs = this.sdk.getState()!.combatStyle;
        const rapid = cs?.styles.find(s => /rapid/i.test(s.type));
        if (rapid && cs!.currentStyle !== rapid.index) await this.sdk.sendSetCombatStyle(rapid.index);
        this.ctx.log('geared', { ammo: this.ammo(), style: rapid?.name ?? cs?.styles.find(s => s.index === cs.currentStyle)?.name });
    }

    /** Shoot cows until trained, or the bow or arrows are gone. Returns the kills. */
    private async fightCows(): Promise<number> {
        let kills = 0;
        let heartbeat = this.tick();
        while (!this.trained() && this.ammo() > 0 && this.bowEquipped()) {
            this.checkSignal();
            await this.bot.dismissBlockingUI();
            const s = this.sdk.getState()!;
            if (s.player!.isDead) throw new Error('died at the cows');
            if (!inCowPen(this.here())) await this.travel(COW_PEN, 4, 'Lumbridge cow pen');
            if (this.tick() - heartbeat >= 500) {
                heartbeat = this.tick();
                this.ctx.log('training', { ranged: this.level('Ranged'), hitpoints: this.level('Hitpoints'), kills, ammo: this.ammo() });
            }
            const cow = s.nearbyNpcs
                .filter(n => /^cow$/i.test(n.name) && !n.inCombat && inCowPen(n) && n.optionsWithIndex.some(o => /attack/i.test(o.text)))
                .sort((a, b) => a.distance - b.distance)[0];
            if (!cow) {
                await this.sdk.waitForTicks(2);
                continue;
            }
            const r = await this.bot.attack(cow);
            if (!r.success) {
                await this.sdk.waitForTicks(1);
                continue;
            }
            // Until the cow is gone (dead) or the fight has visibly stopped.
            let idle = 0;
            for (let t = 0; t < 100; t++) {
                await this.sdk.waitForTicks(1);
                const st = this.sdk.getState();
                if (!st?.player) break;
                if (st.dialog.isOpen) await this.bot.dismissBlockingUI();
                if (!st.nearbyNpcs.some(n => n.index === cow.index && /^cow$/i.test(n.name))) {
                    kills++;
                    break;
                }
                idle = st.player.combat?.inCombat ? 0 : idle + 1;
                if (idle >= 8) break;
            }
        }
        return kills;
    }

    // ---------------------------------------------------------------- 2. trek

    private async trek(): Promise<void> {
        const t0 = this.tick();
        this.ctx.log('phase', { phase: 'trek', from: this.here(), hitpoints: this.level('Hitpoints') });
        await this.buyer.atBank(BANKS.draynor, () => this.buyer.depositAllBut([]));
        await crossToKandarin(this.traveller, BANKS.seers, "Seers' bank");
        this.ctx.log('arrived', { at: "Seers' bank", ticks: this.tick() - t0 });
    }

    // ---------------------------------------------------------------- 3. buy

    private pendingExtras(): Extra[] {
        return this.opt.extras.filter(e => this.buyer.held(e.item) < e.target);
    }

    async buy(): Promise<void> {
        let goal = await this.bankAtSeers();
        // The shelves are shared: our rate against the shop's restocks (rune arrows
        // ~92 an hour) is the share we win.
        const startedAt = Date.now();
        const totals = new Map<string, { bought: number; spent: number }>();
        const buyLine = async (item: string, quantity: number, maxPrice: number, maxWaitTicks: number) => {
            const r = await this.buyer.buyAtShop({ item, quantity, source: 'shop', shop: 'dargaud', maxPrice, maxWaitTicks });
            const t = totals.get(item) ?? { bought: 0, spent: 0 };
            t.bought += r.bought;
            t.spent += r.spent;
            totals.set(item, t);
            const hours = (Date.now() - startedAt) / 3_600_000;
            this.ctx.log('buying', {
                item,
                bought: r.bought,
                spent: r.spent,
                note: r.note,
                held: this.buyer.held(item),
                goal: quantity,
                coins: this.carried('Coins'),
                perHour: hours > 0 ? +(t.bought / hours).toFixed(1) : null,
                averagePrice: t.bought > 0 ? Math.round(t.spent / t.bought) : null
            });
            if (r.note === 'not sold here' || r.note?.startsWith('openShop')) throw new Error(`Dargaud's ${item}: ${r.note}`);
            return r;
        };
        while (goal > 0 || this.pendingExtras().length > 0) {
            this.checkSignal();
            await this.enterGuild();
            const extras = this.pendingExtras();
            let bank = false;
            if (goal > 0) {
                const r = await buyLine(RUNE_ARROW, goal, this.opt.maxPrice, extras.length > 0 ? EXTRA_WAIT_TICKS : WAIT_TICKS);
                bank = this.buyer.held(RUNE_ARROW) >= goal || r.note === 'out of coins';
            }
            for (const e of extras) {
                // Between rune-arrow waits take only what is under the cap now; alone, wait for restocks.
                const r = await buyLine(e.item, e.target, e.maxPrice, goal > 0 ? 0 : EXTRA_WAIT_TICKS);
                bank ||= r.note === 'out of coins';
            }
            if (!bank) continue;
            goal = await this.bankAtSeers();
            const pending = this.pendingExtras();
            if (goal === 0 && pending.length > 0 && this.carried('Coins') < Math.min(...pending.map(e => e.maxPrice))) {
                this.ctx.log('out of coins', { extras: this.pendingExtras().map(e => e.item) });
                return;
            }
        }
    }

    /**
     * Bank the purchases at Seers' and carry coins for the next `bankEvery` rune
     * arrows plus up to EXTRA_UNITS of each extra still wanted. Returns the rune
     * arrow holding (bank + pack) to buy up to next, or 0 when that target is
     * held or there are no coins for another arrow.
     */
    async bankAtSeers(): Promise<number> {
        await this.leaveGuild();
        let goal = 0;
        await this.buyer.atBank(BANKS.seers, async () => {
            await this.buyer.depositAllBut(['Coins']);
            const banked = (name: string) => this.sdk.getBankItems().find(i => same(i.name, name))?.count ?? 0;
            const held = banked(RUNE_ARROW);
            const want = Math.max(0, Math.min(this.opt.target - held, this.opt.bankEvery));
            const extras = Object.fromEntries(this.opt.extras.map(e => [e.item, banked(e.item)]));
            const extraCoins = this.opt.extras.reduce((a, e) => a + Math.max(0, Math.min(e.target - banked(e.item), EXTRA_UNITS)) * e.maxPrice, 0);
            if (want === 0 && extraCoins === 0) {
                await this.buyer.setCoins(0);
                this.ctx.log('done', { held, target: this.opt.target, extras });
                return;
            }
            const coins = await this.buyer.setCoins(want * this.opt.maxPrice + extraCoins);
            // Rune arrows first: the extras get whatever the coins leave.
            const affordable = Math.min(want, Math.floor(coins / Math.max(1, this.opt.maxPrice)));
            if (want > 0 && affordable <= 0) this.ctx.log('out of coins', { held, target: this.opt.target, coins });
            goal = affordable > 0 ? held + affordable : 0;
            this.ctx.log('banked', { held, goal, target: this.opt.target, coins, extras });
        });
        return goal;
    }
}

export const role: Role = {
    name: 'rune-arrows',
    produces: [/^rune arrow$/i],
    async run(ctx) {
        try {
            await new RuneArrows(ctx, parseOptions(ctx.options)).run();
        } catch (e) {
            if (e instanceof Aborted || ctx.signal.aborted) return;
            throw e;
        }
    }
};

if (import.meta.main) await runStandalone(role);
