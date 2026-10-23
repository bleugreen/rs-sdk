// Jeweller (role `jeweller`): makes the scored run's enchanting rings and strung amulets
// from uncut gems and gold, starting from a fresh account.
//
//   bun speedrun/helpers/jeweller.ts <account>     (ROLE_OPTIONS='{"rings":{"emerald":27}}')
//
// Each cycle re-derives the next step from what it observes (levels, inventory, the last
// bank snapshot), so the role restarts from any state. In order:
//   1. tutorial      bot.skipTutorial()
//   2. wool          Crafting 1 -> 5 (gold rings need 5): shears from the Lumbridge general
//                    store, shear the sheep north of Lumbridge, spin at the castle wheel.
//                    The balls also string the amulets.
//   3. smith         Mining and Smithing 40 (gold rocks and gold smelting need 40): runs the
//                    smelter role in full mode (smelter.ts) until both are reached.
//   4. tools         chisel, ring mould and amulet mould from Rommik in Rimmington.
//   5. gold          mine gold ore at Rimmington's two rocks, smelt it at the Falador
//                    furnace, bank at Falador west (only with gold: 'mine').
//   6. train         Crafting 5 -> 20 on gold rings (sapphire rings and cutting need 20).
//   7. cut           uncut gems -> cut gems with a chisel at the bank, only as many as the
//                    remaining products need (uncut diamonds are also a supply line).
//   8. craft         rings and amulets at the Falador furnace, 13 per trip; string amulets.
//   9. receive       anything still missing: wait at Varrock west bank for courier trades
//                    (gems, gold bars, coins) and buy the missing gems on the GE (geBuy).
// Levels (jewellery.struct, gem.dbrow): sapphire 20, emerald 27, ruby 34, diamond 43 for both
// cutting and the ring; sapphire amulet 24, ruby amulet 50; gold ring 5.
import type { BotActions } from '../../sdk/actions';
import type { BotSDK } from '../../sdk/index';
import { TRADE_REQUEST_CHAT_TYPE, type BotWorldState, type InventoryItem, type NearbyLoc } from '../../sdk/types';
import { depositAll, withdrawMany, type WithdrawSpec } from '../lib/bank';
import { receiveFrom } from '../lib/trade';
import { Buyer } from './buyer';
import { accountMatches, ChatCursor, DEFAULT_COURIERS, MULE_STAND, pointMarketAtServer, toRegExps } from './mule';
import { runStandalone, type Role, type RoleContext } from './role';
import { role as smelterRole } from './smelter';

// ---------------------------------------------------------------- ids (server/content/pack/obj.pack, loc.pack)

export type Gem = 'sapphire' | 'emerald' | 'ruby' | 'diamond';
export const GEMS: readonly Gem[] = ['sapphire', 'emerald', 'ruby', 'diamond'];
export type AmuletGem = 'sapphire' | 'ruby';

export const ITEM = {
    coins: 995,
    chisel: 1755,
    ringMould: 1592,
    amuletMould: 1595,
    shears: 1735,
    wool: 1737,
    ballOfWool: 1759,
    goldOre: 444,
    goldBar: 2357,
    goldRing: 1635
} as const;

interface GemInfo {
    uncut: number;
    cut: number;
    ring: number;
    /** Crafting level to cut the gem and to make its ring. */
    level: number;
    /** Slot of the gem's row in the jewellery interface (sdk JEWELRY_GEM_SLOTS). */
    slot: number;
    /** Base xp of the cut (gem.dbrow) and of the ring (jewellery.struct), in base units. */
    cutXp: number;
    ringXp: number;
}
export const GEM: Record<Gem, GemInfo> = {
    sapphire: { uncut: 1623, cut: 1607, ring: 1637, level: 20, slot: 1, cutXp: 50, ringXp: 40 },
    emerald: { uncut: 1621, cut: 1605, ring: 1639, level: 27, slot: 2, cutXp: 67.5, ringXp: 55 },
    ruby: { uncut: 1619, cut: 1603, ring: 1641, level: 34, slot: 3, cutXp: 85, ringXp: 70 },
    diamond: { uncut: 1617, cut: 1601, ring: 1643, level: 43, slot: 4, cutXp: 107.5, ringXp: 85 }
};
export const AMULET: Record<AmuletGem, { unstrung: number; strung: number; level: number }> = {
    sapphire: { unstrung: 1675, strung: 1694, level: 24 },
    ruby: { unstrung: 1679, strung: 1698, level: 50 }
};
/** crafting_jewelry inventory components (rings_inv, amulets_inv) and the furnace's gold Smelt 10 button (smelting:com_29). */
const RINGS_INV = 4233;
const AMULETS_INV = 4245;
const JEWELLERY_IF = 4161;
const SMELT_GOLD_10 = 4001;
const MAKE_10 = 3; // inv_button3 = make 10 (jewellery.rs2)
const GOLD_ROCKS = new Set([2098, 2099]); // goldrock1, goldrock2
const GOLD_RING_XP = 15;
const SHEEP_UNSHORN = 43;

// ---------------------------------------------------------------- places (server/content/maps)

type Point = { x: number; z: number };
const FALADOR_WEST_BANK: Point = { x: 2946, z: 3369 };
const FURNACE: Point = { x: 2974, z: 3370 }; // Falador furnace at 2975,3368
const RIMMINGTON_GOLD: Point = { x: 2976, z: 3235 }; // gold rocks at 2977,3233 and 2975,3234
const ROMMIK: Point = { x: 2947, z: 3206 }; // Rimmington crafting shop
const LUMBRIDGE_STORE: Point = { x: 3211, z: 3246 };
const SHEEP_FIELD: Point = { x: 3200, z: 3266 }; // 3193-3207, 3259-3272
const LUMBRIDGE_STAIRS: Point = { x: 3206, z: 3209 };
const CASTLE_WHEEL: Point = { x: 3209, z: 3214 }; // spinning wheel at 3209,3212 on level 1
/** Where to wait for couriers: inside Varrock west bank, within their 4-tile reach of the mule's spot, not on it. */
const RECEIVE_STAND: Point = { x: MULE_STAND.x - 1, z: MULE_STAND.z + 2 };
const VARROCK_WEST_BANK: Point = { x: 3185, z: 3438 };

// ---------------------------------------------------------------- xp curve (server/engine/src/engine/entity/Player.ts)

const LEVEL_XP: number[] = (() => {
    const out: number[] = [];
    let acc = 0;
    for (let level = 1; level <= 99; level++) {
        acc += Math.floor(level + Math.pow(2, level / 10) * 300);
        out.push(Math.floor(acc / 4)); // real xp to reach level+1
    }
    return out;
})();
/** Real xp needed for a level (the engine stores tenths; the SDK publishes real xp). */
export function xpForLevel(level: number): number {
    return level <= 1 ? 0 : LEVEL_XP[level - 2]!;
}
/** Real xp a base-xp action awards on the demo (NODE_XPRATE 25). */
export const XP_RATE = 25;

// ---------------------------------------------------------------- options

export interface Opts {
    rings: Record<Gem, number>;
    amulets: Record<AmuletGem, number>;
    /** 'mine': train Mining/Smithing and mine and smelt gold; 'receive': only use gold bars handed over. */
    gold: 'mine' | 'receive';
    /** Accounts whose trades are accepted (they give, we give nothing). */
    couriers: RegExp[];
    /** Minutes to wait at Varrock west for couriers before re-planning. */
    receiveMinutes: number;
    /** Missing gems to buy on the GE: gem -> max price per uncut gem. Needs coins in the bank. */
    geBuy: Partial<Record<Gem, number>>;
}

export const DEFAULT_RINGS: Record<Gem, number> = { sapphire: 12, emerald: 27, ruby: 16, diamond: 5 };
export const DEFAULT_AMULETS: Record<AmuletGem, number> = { sapphire: 1, ruby: 1 };

export function readOpts(o: Record<string, unknown>): Opts {
    const counts = <K extends string>(v: unknown, keys: readonly K[], d: Record<K, number>): Record<K, number> => {
        const out = { ...d };
        if (v && typeof v === 'object') {
            for (const k of keys) {
                const n = (v as Record<string, unknown>)[k];
                if (typeof n === 'number' && n >= 0) out[k] = Math.floor(n);
            }
        }
        return out;
    };
    const ge: Partial<Record<Gem, number>> = {};
    if (o.geBuy && typeof o.geBuy === 'object') {
        for (const g of GEMS) {
            const p = (o.geBuy as Record<string, unknown>)[g];
            if (typeof p === 'number' && p > 0) ge[g] = p;
        }
    }
    return {
        rings: counts(o.rings, GEMS, DEFAULT_RINGS),
        amulets: counts(o.amulets, ['sapphire', 'ruby'] as const, DEFAULT_AMULETS),
        gold: o.gold === 'receive' ? 'receive' : 'mine',
        couriers: toRegExps(o.couriers ?? DEFAULT_COURIERS),
        receiveMinutes: typeof o.receiveMinutes === 'number' && o.receiveMinutes > 0 ? o.receiveMinutes : 20,
        geBuy: ge
    };
}

// ---------------------------------------------------------------- the plan (pure)

export interface Product {
    kind: 'ring' | 'amulet';
    gem: Gem;
    remaining: number;
    level: number;
}

export interface Plan {
    products: Product[];
    /** Cut gems the remaining products still consume, per gem. */
    cutNeeded: Record<Gem, number>;
    /** Uncut gems worth cutting now (never more than the products need). */
    toCut: Record<Gem, number>;
    /** Gems missing outright: needed minus cut minus uncut held. */
    gemShort: Record<Gem, number>;
    /** Gold rings to make for Crafting 20, if it is not reached yet. */
    trainingRings: number;
    /** Gold bars for the remaining products and the training rings. */
    barsNeeded: number;
    /** Bars still to come: needed minus bars held minus gold ore held. */
    barsShort: number;
    /** Balls of wool still needed to string the remaining amulets. */
    woolShort: number;
    done: boolean;
}

/**
 * What remains to do, from held counts (bank + inventory, by item id) and the current
 * Crafting xp. Products already made count against the targets, so a restart never
 * makes more than asked; strung amulets count, and so do unstrung ones (they only need
 * a ball of wool).
 */
export function plan(held: (id: number) => number, craftingXp: number, o: Pick<Opts, 'rings' | 'amulets'>): Plan {
    const products: Product[] = [];
    const cutNeeded = { sapphire: 0, emerald: 0, ruby: 0, diamond: 0 } as Record<Gem, number>;
    let woolShort = 0;
    for (const g of GEMS) {
        const r = Math.max(0, o.rings[g] - held(GEM[g].ring));
        if (r > 0) products.push({ kind: 'ring', gem: g, remaining: r, level: GEM[g].level });
        cutNeeded[g] += r;
    }
    for (const g of ['sapphire', 'ruby'] as const) {
        const strung = held(AMULET[g].strung);
        const unstrung = held(AMULET[g].unstrung);
        const left = Math.max(0, o.amulets[g] - strung);
        const toMake = Math.max(0, left - unstrung);
        woolShort += left;
        if (toMake > 0) products.push({ kind: 'amulet', gem: g, remaining: toMake, level: AMULET[g].level });
        cutNeeded[g] += toMake;
    }
    woolShort = Math.max(0, woolShort - held(ITEM.ballOfWool));
    const toCut = {} as Record<Gem, number>;
    const gemShort = {} as Record<Gem, number>;
    for (const g of GEMS) {
        const stillToCut = Math.max(0, cutNeeded[g] - held(GEM[g].cut));
        toCut[g] = Math.min(stillToCut, held(GEM[g].uncut));
        gemShort[g] = stillToCut - toCut[g];
    }
    const need20 = xpForLevel(20) - craftingXp;
    const trainingRings = need20 > 0 ? Math.ceil(need20 / (GOLD_RING_XP * XP_RATE)) : 0;
    const productBars = products.reduce((n, p) => n + p.remaining, 0);
    const barsNeeded = productBars + trainingRings;
    const barsShort = Math.max(0, barsNeeded - held(ITEM.goldBar) - held(ITEM.goldOre));
    return { products, cutNeeded, toCut, gemShort, trainingRings, barsNeeded, barsShort, woolShort, done: products.length === 0 && woolShort === 0 };
}

export type Step = 'tutorial' | 'look' | 'wool' | 'smith' | 'tools' | 'gold' | 'smelt' | 'train' | 'cut' | 'craft' | 'string' | 'receive' | 'done';

/**
 * The step to take while the bank is unseen (after a start, a relog, or the smelter phase).
 * Every step except the tutorial, the first wool trip (Crafting 1-4) and the Smithing
 * training decides from bank counts, so look in the bank first. Without this, banked balls
 * of wool read as missing (another shearing trip) and banked gems as missing (a 20-minute
 * wait for couriers at Varrock).
 */
export function withBankKnown(step: Step, bankKnown: boolean, crafting: number): Step {
    if (bankKnown || step === 'tutorial' || step === 'smith' || (step === 'wool' && crafting < 5)) return step;
    return 'look';
}

export interface StepInput {
    inTutorial: boolean;
    levels: { crafting: number; mining: number; smithing: number };
    plan: Plan;
    held: (id: number) => number;
    gold: Opts['gold'];
}

/**
 * The next step, in the order the module header lists. Gems are cut before anything is
 * crafted so Crafting climbs past every product's level on the cuts alone.
 */
export function nextStep(i: StepInput): Step {
    const { plan: p, levels: l, held } = i;
    if (i.inTutorial) return 'tutorial';
    if (p.done) return 'done';
    // Balls of wool: Crafting 5 for gold rings, and one per amulet to string.
    if (l.crafting < 5 || p.woolShort > 0) return 'wool';
    if (i.gold === 'mine' && p.barsShort > 0 && (l.mining < 40 || l.smithing < 40)) return 'smith';
    const needsRingMould = p.trainingRings > 0 || p.products.some(x => x.kind === 'ring');
    const needsAmuletMould = p.products.some(x => x.kind === 'amulet');
    const needsChisel = GEMS.some(g => p.toCut[g] > 0 || p.gemShort[g] > 0);
    if ((needsRingMould && held(ITEM.ringMould) === 0) || (needsAmuletMould && held(ITEM.amuletMould) === 0) || (needsChisel && held(ITEM.chisel) === 0)) return 'tools';
    if (held(ITEM.goldOre) > 0 && l.smithing >= 40) return 'smelt';
    if (i.gold === 'mine' && p.barsShort > 0) return 'gold';
    if (p.trainingRings > 0 && held(ITEM.goldBar) > 0) return 'train';
    if (GEMS.some(g => p.toCut[g] > 0 && l.crafting >= GEM[g].level)) return 'cut';
    const craftable = p.products.some(x => l.crafting >= x.level && held(GEM[x.gem].cut) > 0 && held(ITEM.goldBar) > 0);
    if (craftable) return 'craft';
    if (held(AMULET.sapphire.unstrung) + held(AMULET.ruby.unstrung) > 0 && held(ITEM.ballOfWool) > 0) return 'string';
    return 'receive';
}

/** Best first; gold needs Mining 40, which every tier allows. */
const PICKAXE_TIERS = ['rune', 'adamant', 'mithril', 'steel', 'iron', 'bronze'];

/** Id of the best pickaxe among `items` (a bank or an inventory), or null. */
export function bestPickaxe(items: readonly { id: number; name: string }[]): number | null {
    for (const tier of PICKAXE_TIERS) {
        const it = items.find(i => i.name.toLowerCase() === `${tier} pickaxe`);
        if (it) return it.id;
    }
    return null;
}

// ---------------------------------------------------------------- the role

class Stop extends Error {}

const inTutorialAt = (x: number, z: number) => x >= 3050 && x <= 3160 && z >= 3050 && z <= 3135;
const near = (s: BotWorldState, p: Point, tol: number) => !!s.player && Math.abs(s.player.worldX - p.x) <= tol && Math.abs(s.player.worldZ - p.z) <= tol;

class Jeweller {
    private bot: BotActions;
    private sdk: BotSDK;
    private o: Opts;
    /** Last observed bank (id -> count); null until the first bank visit. */
    private bank: Map<number, number> | null = null;
    private requests: ChatCursor;
    private lastStep: Step | null = null;
    private stats = { start: Date.now(), made: 0, cut: 0, goldMined: 0, smelted: 0 };
    private lastDoneLog = 0;

    constructor(private ctx: RoleContext) {
        this.bot = ctx.bot;
        this.sdk = ctx.sdk;
        this.o = readOpts(ctx.options);
        pointMarketAtServer(this.sdk);
        this.requests = new ChatCursor(this.sdk, [TRADE_REQUEST_CHAT_TYPE]);
    }

    // ------------------------------------------------------------ state helpers

    private s(): BotWorldState {
        const s = this.sdk.getState();
        if (!s?.player) throw new Error('no world state');
        return s;
    }
    private check() {
        if (this.ctx.signal.aborted) throw new Stop();
    }
    private lvl(skill: string) {
        return this.sdk.getSkill(skill)?.baseLevel ?? 1;
    }
    private xp(skill: string) {
        return this.sdk.getSkill(skill)?.experience ?? 0;
    }
    private inv(id: number) {
        return this.s().inventory.filter(i => i.id === id).reduce((n, i) => n + i.count, 0);
    }
    private held = (id: number) => this.inv(id) + (this.bank?.get(id) ?? 0);
    private pos() {
        const p = this.s().player!;
        return { x: p.worldX, z: p.worldZ, level: p.level };
    }
    private async ticks(n: number) {
        this.check();
        await this.sdk.waitForTicks(n);
    }
    private async until(pred: (s: BotWorldState) => boolean, ms: number) {
        try {
            await this.sdk.waitForCondition(pred, ms);
            return true;
        } catch {
            return false;
        }
    }
    private plan(): Plan {
        return plan(this.held, this.xp('crafting'), this.o);
    }
    private levels() {
        return { crafting: this.lvl('crafting'), mining: this.lvl('mining'), smithing: this.lvl('smithing') };
    }

    // ------------------------------------------------------------ main loop

    async run() {
        this.ctx.log('start', { options: { ...this.o, couriers: this.o.couriers.map(String) }, levels: this.levels() });
        let errors = 0;
        for (;;) {
            try {
                this.check();
                await this.cycle();
                errors = 0;
            } catch (e) {
                if (e instanceof Stop || this.ctx.signal.aborted) {
                    this.ctx.log('stopped', { reason: 'signal' });
                    return;
                }
                errors++;
                this.ctx.log('cycle error', { error: String((e as Error)?.stack ?? e).slice(0, 600), errors, at: this.pos() });
                await new Promise(r => setTimeout(r, Math.min(60_000, 2_000 * errors)));
            }
        }
    }

    private async cycle() {
        await this.clearUi();
        const { x, z } = this.pos();
        const inTutorial = inTutorialAt(x, z);
        const p = this.plan();
        const levels = this.levels();
        const step = withBankKnown(nextStep({ inTutorial, levels, plan: p, held: this.held, gold: this.o.gold }), this.bank !== null, levels.crafting);
        if (step !== this.lastStep) {
            this.ctx.log('phase', { from: this.lastStep, to: step, levels, plan: this.summary(p) });
            this.lastStep = step;
        }
        switch (step) {
            case 'tutorial': {
                const r = await this.bot.skipTutorial();
                this.ctx.log('tutorial', { ok: r.success, why: r.message });
                await this.ticks(3);
                return;
            }
            case 'look':
                await this.openBankAt(FALADOR_WEST_BANK);
                await this.depositEverything();
                return this.closeBank();
            case 'wool':
                return this.woolStep(p);
            case 'smith':
                return this.smithStep();
            case 'tools':
                return this.toolsStep(p);
            case 'smelt':
                return this.smeltStep();
            case 'gold':
                return this.goldStep(p);
            case 'train':
                return this.craftTrip({ kind: 'ring', gem: null, n: Math.min(p.trainingRings, 27) });
            case 'cut':
                return this.cutStep(p);
            case 'craft':
                return this.craftStep(p);
            case 'string':
                return this.stringStep();
            case 'receive':
                return this.receiveStep(p);
            case 'done':
                return this.doneStep(p);
        }
    }

    private summary(p: Plan) {
        return {
            products: p.products.map(x => `${x.gem} ${x.kind} ${x.remaining}`),
            toCut: p.toCut,
            gemShort: p.gemShort,
            trainingRings: p.trainingRings,
            barsNeeded: p.barsNeeded,
            barsShort: p.barsShort,
            woolShort: p.woolShort
        };
    }

    /** Close level-up dialogs and stray modals; never leave a product menu open. */
    private async clearUi() {
        const s = this.s();
        if (s.dialog.isOpen || s.modalOpen || s.interface?.isOpen || s.shop?.isOpen) {
            await this.bot.dismissBlockingUI();
            const t = this.s();
            if (t.shop?.isOpen) await this.bot.closeShop();
            if (t.modalOpen || t.interface?.isOpen || t.bank.isOpen) {
                await this.sdk.sendCloseModal();
                await this.ticks(1);
            }
        }
    }

    // ------------------------------------------------------------ travel

    private async walk(p: Point, tol = 2, timeout = 180_000): Promise<void> {
        await this.toGround();
        for (let attempt = 1; attempt <= 5; attempt++) {
            this.check();
            if (near(this.s(), p, tol)) return;
            await this.clearUi();
            const r = await this.bot.walkTo(p.x, p.z, tol, { timeout });
            if (near(this.s(), p, tol + 1)) return;
            this.ctx.log('walk retry', { to: p, at: this.pos(), attempt, why: r.message });
            await this.ticks(3);
        }
        throw new Error(`could not reach ${JSON.stringify(p)} from ${JSON.stringify(this.pos())}`);
    }

    private async findLoc(name: RegExp, option: RegExp, radius = 20): Promise<NearbyLoc | null> {
        const locs = await this.sdk.scanNearbyLocs(radius);
        const level = this.pos().level;
        return locs.filter(l => name.test(l.name) && l.level === level && l.optionsWithIndex.some(o => option.test(o.text))).sort((a, b) => a.distance - b.distance)[0] ?? null;
    }

    /** Use a staircase and wait for the plane change. */
    private async stairs(option: RegExp, toLevel: number) {
        for (let attempt = 1; attempt <= 4 && this.pos().level !== toLevel; attempt++) {
            this.check();
            const loc = await this.findLoc(/stair/i, option, 12);
            if (!loc) throw new Error(`no staircase (${option}) near ${JSON.stringify(this.pos())}`);
            await this.bot.interactLoc(loc, option);
            await this.until(st => st.player?.level === toLevel, 15_000);
        }
        if (this.pos().level !== toLevel) throw new Error(`stairs did not take us to level ${toLevel}`);
    }

    private async toGround() {
        for (let i = 0; i < 3 && this.pos().level > 0; i++) await this.stairs(/climb-down/i, this.pos().level - 1);
    }

    // ------------------------------------------------------------ bank

    private async openBankAt(p: Point) {
        await this.walk(p, 3);
        for (let attempt = 1; attempt <= 4; attempt++) {
            this.check();
            if (!this.s().bank.isOpen) {
                const r = await this.bot.openBank();
                if (!r.success) {
                    this.ctx.log('openBank failed', { why: r.message, attempt });
                    await this.ticks(2);
                    continue;
                }
            }
            await this.until(st => st.bank.isOpen && st.bank.items.length > 0, 5_000);
            if (this.s().bank.isOpen) {
                this.snapshot();
                return;
            }
        }
        throw new Error('bank would not open');
    }

    private snapshot() {
        const items = this.sdk.getBankItems();
        this.bank = new Map();
        for (const it of items) this.bank.set(it.id, (this.bank.get(it.id) ?? 0) + it.count);
        this.ctx.reportBank({ items: items.map(i => ({ id: i.id, name: i.name, count: i.count })) });
    }

    private async depositEverything() {
        if (this.s().inventory.length === 0) return;
        const r = await depositAll(this.sdk);
        if (!r.ok) this.ctx.log('deposit incomplete', { reason: r.reason, remaining: r.remaining.map(i => i.name) });
        this.snapshot();
    }

    /** Withdraw by id; counts are clipped to what the bank holds. Returns what arrived. */
    private async withdraw(specs: { id: number; n: number | 'all' }[]) {
        const wanted: WithdrawSpec[] = specs.filter(s => (this.bank?.get(s.id) ?? 0) > 0 && s.n !== 0).map(s => ({ item: s.id, n: s.n }));
        if (wanted.length === 0) return;
        const r = await withdrawMany(this.sdk, wanted);
        if (!r.ok && r.reason !== 'missing') this.ctx.log('withdraw incomplete', { reason: r.reason, partial: r.partial });
        this.snapshot();
    }

    private async closeBank() {
        if (this.s().bank.isOpen) await this.bot.closeBank();
    }

    // ------------------------------------------------------------ 2. wool

    private async woolStep(p: Plan) {
        const balls = () => this.inv(ITEM.ballOfWool);
        const want = () => (this.lvl('crafting') < 5 ? Math.max(balls() + 1, 6) : 0) + p.woolShort;
        if (this.inv(ITEM.shears) === 0 && this.inv(ITEM.wool) + balls() < want()) await this.buyShears();
        // Shear until we carry enough wool to spin.
        while (this.inv(ITEM.wool) + balls() < Math.max(want(), 1) && this.s().inventory.length < 28) {
            this.check();
            await this.shearOne();
        }
        if (this.inv(ITEM.wool) > 0) await this.spinAll();
        this.ctx.log('wool', { balls: balls(), crafting: this.lvl('crafting') });
    }

    private async buyShears() {
        await this.walk(LUMBRIDGE_STORE, 3);
        const shop = await this.bot.openShop(/shop keeper|shop assistant/i);
        if (!shop.success) throw new Error(`Lumbridge store: ${shop.message}`);
        // A fresh account's 25 coins are in the bank; the general store buys anything, so a
        // starter-kit weapon pays for the shears without a bank trip.
        if (this.inv(ITEM.coins) < 2) {
            const spare = this.s().inventory.find(i => /^bronze (dagger|sword)$|^wooden shield$|^shortbow$/i.test(i.name));
            if (!spare) throw new Error('no coins and nothing to sell for shears');
            const sold = await this.bot.sellToShop(spare, 1);
            this.ctx.log('sold for shears', { item: spare.name, ok: sold.success, why: sold.message, coins: this.inv(ITEM.coins) });
        }
        const r = await this.bot.buyFromShop(/^shears$/i, 1);
        this.ctx.log('buy shears', { ok: r.success, why: r.message });
        await this.bot.closeShop();
    }

    private async shearOne() {
        const s = this.s();
        if (!near(s, SHEEP_FIELD, 9)) await this.walk(SHEEP_FIELD, 4);
        const sheep = this.s().nearbyNpcs.filter(n => n.id === SHEEP_UNSHORN).sort((a, b) => a.distance - b.distance)[0];
        if (!sheep) {
            await this.ticks(5); // all shorn: they regrow
            return;
        }
        const before = this.inv(ITEM.wool);
        const r = await this.bot.useItemOnNpc(/^shears$/i, sheep, { timeout: 15_000 });
        await this.until(st => st.inventory.filter(i => i.id === ITEM.wool).length > before || st.dialog.isOpen, 6_000);
        await this.clearUi();
        if (this.inv(ITEM.wool) === before) this.ctx.log('shear missed', { why: r.message });
    }

    private async spinAll() {
        if (this.pos().level !== 1) {
            await this.walk(LUMBRIDGE_STAIRS, 2);
            await this.stairs(/climb-up/i, 1);
        }
        // Walking on level 1 of the castle: the pathfinder handles the plane the player is on.
        await this.bot.walkTo(CASTLE_WHEEL.x, CASTLE_WHEEL.z, 2, { timeout: 30_000 });
        let idle = 0;
        while (this.inv(ITEM.wool) > 0 && idle < 4) {
            this.check();
            const wheel = await this.findLoc(/spinning wheel/i, /spin/i, 8);
            const wool = this.s().inventory.find(i => i.id === ITEM.wool);
            if (!wheel || !wool) throw new Error('no spinning wheel in reach');
            const before = this.inv(ITEM.wool);
            await this.clearUi();
            await this.sdk.sendUseItemOnLoc(wool.slot, wheel.x, wheel.z, wheel.id);
            const spun = await this.until(st => st.inventory.filter(i => i.id === ITEM.wool).length < before, 8_000);
            idle = spun ? 0 : idle + 1;
        }
        await this.toGround();
    }

    // ------------------------------------------------------------ 3. smith (delegates to smelter.ts)

    /**
     * Mining and Smithing to 40 by running the smelter role in full mode until both are
     * reached. It trains on copper/tin, iron and steel at Falador and buys a better pickaxe
     * from its own bars; its produce stays in this account's bank.
     */
    private async smithStep() {
        const child = new AbortController();
        const stop = () => child.abort();
        this.ctx.signal.addEventListener('abort', stop);
        const timer = setInterval(() => {
            if (this.lvl('mining') >= 40 && this.lvl('smithing') >= 40) child.abort();
        }, 3_000);
        this.ctx.log('smith: running smelter role', { levels: this.levels() });
        try {
            await smelterRole.run({
                ...this.ctx,
                options: { mode: 'full', pickaxe: true },
                signal: child.signal,
                log: (message, data) => this.ctx.log(`smelter: ${message}`, data)
            });
        } finally {
            clearInterval(timer);
            this.ctx.signal.removeEventListener('abort', stop);
        }
        this.bank = null; // the smelter banked things we did not see
        this.check();
        this.ctx.log('smith: done', { levels: this.levels() });
    }

    // ------------------------------------------------------------ 4. tools

    private async toolsStep(p: Plan) {
        const want: { id: number; name: RegExp }[] = [];
        if (this.held(ITEM.chisel) === 0) want.push({ id: ITEM.chisel, name: /^chisel$/i });
        if (this.held(ITEM.ringMould) === 0 && (p.trainingRings > 0 || p.products.some(x => x.kind === 'ring'))) want.push({ id: ITEM.ringMould, name: /^ring mould$/i });
        if (this.held(ITEM.amuletMould) === 0 && p.products.some(x => x.kind === 'amulet')) want.push({ id: ITEM.amuletMould, name: /^amulet mould$/i });
        if (this.inv(ITEM.coins) < 30) {
            await this.openBankAt(FALADOR_WEST_BANK);
            await this.depositEverything();
            await this.withdraw([{ id: ITEM.coins, n: 'all' }]);
            await this.closeBank();
        }
        if (this.inv(ITEM.coins) < 10) throw new Error('no coins for tools');
        await this.walk(ROMMIK, 3);
        const shop = await this.bot.openShop(/rommik/i);
        if (!shop.success) throw new Error(`Rommik: ${shop.message}`);
        for (const t of want) {
            const r = await this.bot.buyFromShop(t.name, 1);
            this.ctx.log('buy tool', { item: String(t.name), ok: r.success, why: r.message });
        }
        await this.bot.closeShop();
    }

    // ------------------------------------------------------------ 5. gold

    private async goldStep(p: Plan) {
        // Start every trip with an empty pack and a pickaxe. The smelter phase can end with
        // the pickaxe banked and nothing carried, so a missing pickaxe also means the bank.
        const holding = () => this.wieldingPickaxe() || this.s().inventory.some(i => /pickaxe$/i.test(i.name));
        if (!holding() || this.s().inventory.some(i => !/pickaxe$/i.test(i.name))) {
            await this.openBankAt(FALADOR_WEST_BANK);
            await this.depositEverything();
            if (!this.wieldingPickaxe()) {
                const pick = bestPickaxe(this.sdk.getBankItems());
                if (pick !== null) await this.withdraw([{ id: pick, n: 1 }]);
            }
            await this.closeBank();
        }
        if (!this.wieldingPickaxe() && !this.s().inventory.some(i => /pickaxe$/i.test(i.name))) throw new Error('no pickaxe for gold');
        await this.walk(RIMMINGTON_GOLD, 3);
        const target = Math.min(p.barsShort, 28 - this.s().inventory.length);
        const t0 = this.s().tick;
        let got = 0;
        let waited = 0;
        while (got < target && this.s().inventory.length < 28 && waited < 1_200) {
            this.check();
            // Gold trips are most of a run's wall time, so couriers deliver here at the rocks
            // rather than waiting for the receive step that only comes once the bars are done.
            await this.acceptCouriers();
            const rock = this.s().nearbyLocs.filter(l => GOLD_ROCKS.has(l.id)).sort((a, b) => a.distance - b.distance)[0];
            if (!rock) {
                waited++;
                await this.ticks(1);
                continue;
            }
            const before = this.inv(ITEM.goldOre);
            await this.mineRock(rock);
            const n = this.inv(ITEM.goldOre) - before;
            got += Math.max(0, n);
        }
        this.stats.goldMined += got;
        this.ctx.log('gold trip', { got, ticks: this.s().tick - t0, waited, mining: this.lvl('mining'), players: this.s().nearbyPlayers?.length ?? 0 });
        await this.smeltStep();
    }

    private wieldingPickaxe() {
        return (this.sdk.getState()?.equipment ?? []).some(i => /pickaxe$/i.test(i.name));
    }

    /** Mine one rock until it yields or depletes (the loc id at the tile changes). */
    private async mineRock(rock: NearbyLoc) {
        const option = rock.optionsWithIndex.find(o => /^mine$/i.test(o.text))?.opIndex ?? 1;
        const before = this.inv(ITEM.goldOre);
        await this.sdk.sendInteractLoc(rock.x, rock.z, rock.id, option);
        let still = 0;
        for (let t = 0; t < 200; t++) {
            await this.ticks(1);
            const s = this.s();
            if (this.inv(ITEM.goldOre) > before || s.inventory.length >= 28) return;
            if (!s.nearbyLocs.some(l => l.x === rock.x && l.z === rock.z && l.id === rock.id)) return;
            if (s.dialog.isOpen) await this.clearUi();
            still = (s.player?.animId ?? -1) === -1 ? still + 1 : 0;
            if (still >= 4) {
                still = 0;
                await this.sdk.sendInteractLoc(rock.x, rock.z, rock.id, option);
            }
        }
    }

    /** Smelt carried (or banked) gold ore into bars at the Falador furnace, then bank. */
    private async smeltStep() {
        if (this.inv(ITEM.goldOre) === 0) {
            await this.openBankAt(FALADOR_WEST_BANK);
            await this.depositEverything();
            await this.withdraw([{ id: ITEM.goldOre, n: 28 }]);
            await this.closeBank();
        }
        if (this.inv(ITEM.goldOre) === 0) return;
        await this.walk(FURNACE, 3);
        const QUIET = 7;
        let idle = QUIET;
        let fruitless = 0;
        let last = this.inv(ITEM.goldOre);
        const start = last;
        while (this.inv(ITEM.goldOre) > 0 && fruitless < 4) {
            this.check();
            if (idle >= QUIET) {
                fruitless++;
                await this.clearUi();
                const furnace = this.sdk.findNearbyLoc(/furnace/i, { withOption: /smelt/i });
                if (!furnace) throw new Error('no furnace in view');
                const op = furnace.optionsWithIndex.find(o => /smelt/i.test(o.text))?.opIndex ?? 2;
                await this.sdk.sendInteractLoc(furnace.x, furnace.z, furnace.id, op);
                idle = 0;
                if (!(await this.until(st => st.dialog.isOpen || !!st.interface?.isOpen || st.modalOpen, 15_000))) {
                    idle = QUIET;
                    continue;
                }
                await this.sdk.sendClickComponent(SMELT_GOLD_10);
            }
            await this.ticks(1);
            const now = this.inv(ITEM.goldOre);
            if (now !== last) {
                idle = 0;
                fruitless = 0;
            } else idle++;
            last = now;
        }
        await this.clearUi();
        const made = start - this.inv(ITEM.goldOre);
        this.stats.smelted += made;
        this.ctx.log('smelt', { bars: made, smithing: this.lvl('smithing') });
        await this.openBankAt(FALADOR_WEST_BANK);
        await this.depositEverything();
        await this.closeBank();
    }

    // ------------------------------------------------------------ 7. cut

    /** Cut the gems the products need, one inventory at a time, at Falador west bank. */
    private async cutStep(p: Plan) {
        await this.openBankAt(FALADOR_WEST_BANK);
        await this.depositEverything();
        const crafting = this.lvl('crafting');
        const gem = GEMS.find(g => p.toCut[g] > 0 && crafting >= GEM[g].level);
        if (!gem) return this.closeBank();
        const n = Math.min(p.toCut[gem], 27);
        await this.withdraw([{ id: ITEM.chisel, n: 1 }, { id: GEM[gem].uncut, n }]);
        await this.closeBank();
        let misses = 0;
        while (this.inv(GEM[gem].uncut) > 0 && misses < 5) {
            this.check();
            const inv = this.s().inventory;
            const chisel = inv.find(i => i.id === ITEM.chisel);
            const uncut = inv.find(i => i.id === GEM[gem].uncut);
            if (!chisel || !uncut) break;
            const before = this.inv(GEM[gem].uncut);
            await this.sdk.sendUseItemOnItem(chisel.slot, uncut.slot);
            const ok = await this.until(st => st.inventory.filter(i => i.id === GEM[gem].uncut).length < before, 5_000);
            misses = ok ? 0 : misses + 1;
            if (!ok) await this.clearUi();
        }
        const cut = this.inv(GEM[gem].cut);
        this.stats.cut += cut;
        this.ctx.log('cut', { gem, cut, crafting: this.lvl('crafting') });
        await this.openBankAt(FALADOR_WEST_BANK);
        await this.depositEverything();
        await this.closeBank();
    }

    // ------------------------------------------------------------ 6/8. craft at the furnace

    private async craftStep(p: Plan) {
        const crafting = this.lvl('crafting');
        const next = p.products.find(x => crafting >= x.level && this.held(GEM[x.gem].cut) > 0);
        if (!next) return;
        return this.craftTrip({ kind: next.kind, gem: next.gem, n: Math.min(next.remaining, 13) });
    }

    /**
     * One furnace trip: withdraw the mould, n bars and n cut gems (gem null = gold rings),
     * make them with "make 10" clicks, bank the products.
     */
    private async craftTrip(job: { kind: 'ring' | 'amulet'; gem: Gem | null; n: number }) {
        const mould = job.kind === 'ring' ? ITEM.ringMould : ITEM.amuletMould;
        await this.openBankAt(FALADOR_WEST_BANK);
        await this.depositEverything();
        const perGem = job.gem ? 2 : 1;
        const n = Math.max(1, Math.min(job.n, Math.floor(27 / perGem), this.bank?.get(ITEM.goldBar) ?? 0, job.gem ? (this.bank?.get(GEM[job.gem].cut) ?? 0) : 27));
        const specs: { id: number; n: number }[] = [{ id: mould, n: 1 }, { id: ITEM.goldBar, n }];
        if (job.gem) specs.push({ id: GEM[job.gem].cut, n });
        await this.withdraw(specs);
        await this.closeBank();
        if (this.inv(mould) === 0 || this.inv(ITEM.goldBar) === 0) throw new Error(`craft: missing mould or bars (${JSON.stringify(specs)})`);
        const product = job.kind === 'ring' ? (job.gem ? GEM[job.gem].ring : ITEM.goldRing) : AMULET[job.gem as AmuletGem].unstrung;
        const component = job.kind === 'ring' ? RINGS_INV : AMULETS_INV;
        const slot = job.gem ? GEM[job.gem].slot : 0;
        await this.walk(FURNACE, 3);
        const made0 = this.inv(product);
        let fruitless = 0;
        while (this.inv(ITEM.goldBar) > 0 && (!job.gem || this.inv(GEM[job.gem].cut) > 0) && fruitless < 4) {
            this.check();
            await this.clearUi();
            const furnace = this.sdk.findNearbyLoc(/furnace/i);
            const bar = this.s().inventory.find(i => i.id === ITEM.goldBar);
            if (!furnace || !bar) throw new Error('craft: no furnace in view');
            await this.sdk.sendUseItemOnLoc(bar.slot, furnace.x, furnace.z, furnace.id);
            if (!(await this.until(st => !!st.interface?.isOpen && st.interface.interfaceId === JEWELLERY_IF, 10_000))) {
                fruitless++;
                continue;
            }
            await this.sdk.sendClickComponentWithOption(component, MAKE_10, slot);
            // One item per 3 ticks (p_delay(2)); a level-up box or the last bar ends the chain.
            let last = this.inv(product);
            let quiet = 0;
            while (quiet < 6 && this.inv(ITEM.goldBar) > 0) {
                await this.ticks(1);
                const now = this.inv(product);
                quiet = now === last ? quiet + 1 : 0;
                last = now;
            }
            fruitless = this.inv(product) > made0 ? 0 : fruitless + 1;
        }
        await this.clearUi();
        const made = this.inv(product) - made0;
        this.stats.made += made;
        this.ctx.log('crafted', { kind: job.kind, gem: job.gem ?? 'gold', made, crafting: this.lvl('crafting') });
        await this.openBankAt(FALADOR_WEST_BANK);
        await this.depositEverything();
        await this.closeBank();
    }

    private async stringStep() {
        await this.openBankAt(FALADOR_WEST_BANK);
        await this.depositEverything();
        await this.withdraw([
            { id: ITEM.ballOfWool, n: 2 },
            { id: AMULET.sapphire.unstrung, n: 'all' },
            { id: AMULET.ruby.unstrung, n: 'all' }
        ]);
        await this.closeBank();
        for (const g of ['sapphire', 'ruby'] as const) {
            while (this.inv(AMULET[g].unstrung) > 0 && this.inv(ITEM.ballOfWool) > 0) {
                this.check();
                const r = await this.bot.stringAmulet(new RegExp(`^${g} amulet$`, 'i'));
                this.ctx.log('string', { gem: g, ok: r.success, why: r.message });
                if (!r.success) break;
            }
        }
        await this.openBankAt(FALADOR_WEST_BANK);
        await this.depositEverything();
        await this.closeBank();
    }

    // ------------------------------------------------------------ 9. receive / done

    /**
     * Wait at Varrock west bank for courier trades (gems, gold bars, coins), buy missing
     * gems on the GE if allowed, bank everything, then re-plan.
     */
    private async receiveStep(p: Plan) {
        await this.openBankAt(VARROCK_WEST_BANK);
        await this.depositEverything();
        await this.closeBank();
        if (this.bank && GEMS.some(g => p.gemShort[g] > 0 && this.o.geBuy[g])) await this.buyGems(this.plan());
        const short = this.summary(this.plan());
        this.ctx.log('waiting for supplies', { at: 'Varrock west bank', minutes: this.o.receiveMinutes, gemShort: short.gemShort, barsShort: short.barsShort });
        await this.walk(RECEIVE_STAND, 1);
        const deadline = Date.now() + this.o.receiveMinutes * 60_000;
        let gotSomething = false;
        while (Date.now() < deadline) {
            this.check();
            if (await this.acceptCouriers()) gotSomething = true;
            if (gotSomething && this.s().inventory.length > 20) break;
            await this.ticks(3);
        }
        await this.openBankAt(VARROCK_WEST_BANK);
        await this.depositEverything();
        await this.closeBank();
    }

    private async acceptCouriers(): Promise<boolean> {
        const senders = [...new Set(this.requests.next().map(m => m.sender))].filter(n => this.o.couriers.some(p => accountMatches(n, p)));
        let any = false;
        for (const from of senders) {
            const before = this.s().inventory.length;
            const r = await receiveFrom(this.sdk, from, { openTimeoutMs: 20_000 });
            this.ctx.log('received', { from, ok: r.ok, reason: r.reason, items: r.received.map(i => `${i.name} x${i.count}`), slotsBefore: before });
            if (r.ok) any = true;
        }
        return any;
    }

    private async buyGems(p: Plan) {
        const buyer = new Buyer(this.ctx);
        const coins = this.bank?.get(ITEM.coins) ?? 0;
        if (coins <= 0) return;
        await this.openBankAt(VARROCK_WEST_BANK);
        await this.withdraw([{ id: ITEM.coins, n: 'all' }]);
        await this.closeBank();
        for (const g of GEMS) {
            const max = this.o.geBuy[g];
            if (!max || p.gemShort[g] <= 0) continue;
            const uncutName = `Uncut ${g}`;
            const report = await buyer.buyAtGE({ item: uncutName, quantity: buyer.held(uncutName) + p.gemShort[g], maxPrice: max, source: 'ge' });
            this.ctx.log('ge buy', { ...report });
        }
        await this.openBankAt(VARROCK_WEST_BANK);
        await this.depositEverything();
        await this.closeBank();
    }

    private async doneStep(p: Plan) {
        if (Date.now() - this.lastDoneLog > 10 * 60_000) {
            this.lastDoneLog = Date.now();
            const made: Record<string, number> = {};
            for (const g of GEMS) made[`${g} ring`] = this.held(GEM[g].ring);
            for (const g of ['sapphire', 'ruby'] as const) made[`strung ${g} amulet`] = this.held(AMULET[g].strung);
            this.ctx.log('done', { made, stats: this.stats, plan: this.summary(p) });
        }
        if (!near(this.s(), FALADOR_WEST_BANK, 6)) {
            await this.openBankAt(FALADOR_WEST_BANK);
            await this.depositEverything();
            await this.closeBank();
        }
        await this.acceptCouriers();
        for (let i = 0; i < 100; i++) await this.ticks(1);
    }
}

export const role: Role = {
    name: 'jeweller',
    produces: [/^(sapphire|emerald|ruby|diamond) ring$/i, /^(sapphire|ruby) amulet$/i, /^gold bar$/i],
    async run(ctx: RoleContext) {
        await new Jeweller(ctx).run();
    }
};

if (import.meta.main) await runStandalone(role);
