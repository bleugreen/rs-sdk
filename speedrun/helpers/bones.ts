// Bone collector: kills monsters for their bones (the scored account buries them for
// Prayer), loots coins and small valuables, catches and cooks its own food, banks, reports.
//
//   bun speedrun/helpers/bones.ts <account>
//   ROLE_OPTIONS='{"spot":"hill_giants","train":50}' bun speedrun/helpers/bones.ts <account>
//
// Stages, chosen afresh from observed state at the top of every cycle (so the role
// resumes from anywhere: mid-fight, mid-walk, full inventory, after a relog or a death):
//   1. tutorial      skip it.
//   2. train         Lumbridge cows until Attack, Strength and Defence reach `train`.
//   3. fishing kit   Draynor net fishing to Fishing 20, a fly fishing rod from Gerrant
//                    (Port Sarim, 5 gp), feathers from the Lumbridge chickens.
//   4. food          fly fish trout/salmon at Barbarian Village, cook on its fire.
//   5. bones         work the spot (Edgeville dungeon hill giants by default; the brass
//                    key from the dungeon floor opens the short route), bank at Varrock West.
// No food at all (fish: false, or no kit yet) falls back to resting at the bank.
// docs/speedrun/helpers/bones.md has the method comparison and the measured rates.
import type { BotActions } from '../../sdk/actions';
import type { BotSDK } from '../../sdk/index';
import type { BotWorldState, GroundItem, InventoryItem, NearbyNpc } from '../../sdk/types';
import type { Role, RoleContext } from './role';
import { runStandalone } from './role';

interface Box { x1: number; z1: number; x2: number; z2: number }
interface Tile { x: number; z: number }

const UNDERGROUND_Z = 6400;
const inBox = (b: Box, x: number, z: number) => x >= b.x1 && x <= b.x2 && z >= b.z1 && z <= b.z2;
const dist = (a: Tile, b: Tile) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
const exact = (name: string) => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');

// ---------------------------------------------------------------------------
// Places
// ---------------------------------------------------------------------------

const VARROCK_WEST_BANK: Tile = { x: 3185, z: 3436 };
const EDGEVILLE_BANK: Tile = { x: 3094, z: 3491 };
const DRAYNOR_BANK: Tile = { x: 3092, z: 3243 };
const FALADOR_WEST_BANK: Tile = { x: 2946, z: 3368 };
const BANKS = [VARROCK_WEST_BANK, EDGEVILLE_BANK, DRAYNOR_BANK, FALADOR_WEST_BANK];

const EDGEVILLE_TRAPDOOR: Tile = { x: 3097, z: 3468 };
const EDGEVILLE_LADDER_BOTTOM: Tile = { x: 3096, z: 9867 };
/** Brass-key house north-west of Varrock: door on its south wall, ladder down into the hill giants' room. */
const BRASS_DOOR: Tile = { x: 3115, z: 3450 };
const BRASS_DOOR_OUTSIDE: Tile = { x: 3115, z: 3449 };
const BRASS_LADDER_TOP: Tile = { x: 3116, z: 3452 };
const BRASS_LADDER_BOTTOM: Tile = { x: 3116, z: 9853 };
/** Ground spawn of the brass key, 15 tiles from the giants. */
const BRASS_KEY_SPAWN: Tile = { x: 3131, z: 9862 };
const BRASS_KEY = /^brass key$/i;

const COW_FIELD: Box = { x1: 3242, z1: 3255, x2: 3265, z2: 3298 };
const CHICKEN_COOP: Box = { x1: 3222, z1: 3293, x2: 3238, z2: 3303 };
const DRAYNOR_NET: Tile = { x: 3087, z: 3229 };
const GERRANT: Tile = { x: 3014, z: 3224 };
const BARBARIAN_FISH: Tile = { x: 3106, z: 3431 };
/** The Barbarian Village fire burns inside the longhall; cook from the tile south of it (entrance on the south side). */
const BARBARIAN_FIRE: Tile = { x: 3079, z: 3444 };
const LONGHALL: Box = { x1: 3076, z1: 3441, x2: 3081, z2: 3445 };

interface Spot {
    id: string;
    npc: RegExp;
    /** Bones this spot yields; always looted. */
    bones: RegExp;
    /** Where the monsters live; targets outside it are ignored so the helper stays put. */
    area: Box;
    centre: Tile;
    /** Get from wherever the player is to the centre of the area. */
    enter(r: Run): Promise<boolean>;
    /** Get from inside or near the area to a bank booth (any of BANKS). */
    leave(r: Run): Promise<boolean>;
    /** Item that must be carried to work this spot (a key). */
    requires?: RegExp;
    /** Optional upkeep run while standing in the area (e.g. fetching a key). */
    upkeep?(r: Run): Promise<void>;
}

/** Edgeville dungeon hill giants: 12 spawns around (3096-3120, 9816-9850), level 28, 35 hp, big bones. */
const HILL_GIANTS: Spot = {
    id: 'hill_giants',
    npc: /^giant$/i,
    bones: /^big bones$/i,
    area: { x1: 3088, z1: 9812, x2: 3126, z2: 9858 },
    centre: { x: 3108, z: 9836 },
    async enter(r) {
        if (!r.underground()) {
            if (r.carrying(BRASS_KEY)) {
                if (!(await r.throughBrassDoor(true))) return false;
                if (!(await r.climb(/ladder/i, /climb-down/i, true, BRASS_LADDER_TOP))) return false;
            } else {
                if (!(await r.walk(EDGEVILLE_TRAPDOOR.x, EDGEVILLE_TRAPDOOR.z + 1, 1, 300_000))) return false;
                if (!(await r.climb(/trapdoor/i, /climb-down|open/i, true, EDGEVILLE_TRAPDOOR))) return false;
            }
        }
        return r.walk(this.centre.x, this.centre.z, 4, 120_000);
    },
    async leave(r) {
        if (r.underground()) {
            if (r.carrying(BRASS_KEY)) {
                if (!(await r.walk(BRASS_LADDER_BOTTOM.x, BRASS_LADDER_BOTTOM.z, 1, 90_000))) return false;
                if (!(await r.climb(/ladder/i, /climb-up/i, false, BRASS_LADDER_BOTTOM))) return false;
            } else {
                if (!(await r.walk(EDGEVILLE_LADDER_BOTTOM.x, EDGEVILLE_LADDER_BOTTOM.z + 1, 2, 120_000))) return false;
                if (!(await r.climb(/ladder/i, /climb-up/i, false, EDGEVILLE_LADDER_BOTTOM))) return false;
                return r.walk(EDGEVILLE_BANK.x, EDGEVILLE_BANK.z, 3, 120_000);
            }
        }
        if (inBox({ x1: 3113, z1: 3450, x2: 3117, z2: 3453 }, r.pos().x, r.pos().z)) {
            if (!(await r.throughBrassDoor(false))) return false;
        }
        return r.walk(VARROCK_WEST_BANK.x, VARROCK_WEST_BANK.z, 3, 300_000);
    },
    async upkeep(r) {
        if (r.carrying(BRASS_KEY) || r.banked(BRASS_KEY) > 0) return;
        if (Date.now() < r.nextKeyLook) return;
        r.nextKeyLook = Date.now() + 5 * 60_000;
        if (!(await r.walk(BRASS_KEY_SPAWN.x, BRASS_KEY_SPAWN.z, 2, 60_000))) return;
        const key = (await r.sdk.scanGroundItems(6)).find(g => BRASS_KEY.test(g.name));
        if (!key) {
            r.ctx.log('brass key not on the floor; will look again');
            return;
        }
        await r.bot.pickupItem(key);
        if (r.carrying(BRASS_KEY)) r.ctx.log('picked up the brass key');
    }
};

const TAVERLEY_DUNGEON_LADDER: Tile = { x: 2884, z: 3397 };
const TAVERLEY_DUNGEON_BOTTOM: Tile = { x: 2884, z: 9798 };
const DUSTY_KEY_DOOR: Tile = { x: 2924, z: 9803 };
const DUSTY_KEY = /^dusty key$/i;

/**
 * Taverley dungeon baby blue dragons: 9 spawns behind the dusty-key door at (2924, 9803),
 * level 48, 50 hp, no dragonfire, babydragon bones (30 base). Needs a dusty key
 * (Velrak, Taverley jail). Written from the map data; not yet run on the demo.
 */
const BABY_BLUE: Spot = {
    id: 'baby_blue',
    npc: /^baby blue dragon$/i,
    bones: /^babydragon bones$/i,
    area: { x1: 2876, z1: 9740, x2: 2912, z2: 9800 },
    centre: { x: 2893, z: 9780 },
    requires: DUSTY_KEY,
    async enter(r) {
        if (!r.underground()) {
            if (!(await r.walk(TAVERLEY_DUNGEON_LADDER.x, TAVERLEY_DUNGEON_LADDER.z + 1, 2, 300_000))) return false;
            if (!(await r.climb(/ladder/i, /climb-down/i, true, TAVERLEY_DUNGEON_LADDER))) return false;
        }
        if (r.pos().x > DUSTY_KEY_DOOR.x) {
            if (!(await r.walk(DUSTY_KEY_DOOR.x + 1, DUSTY_KEY_DOOR.z, 1, 120_000))) return false;
            const door = (await r.sdk.scanNearbyLocs(4)).find(l => /door/i.test(l.name) && l.x === DUSTY_KEY_DOOR.x && l.z === DUSTY_KEY_DOOR.z);
            if (!door) return false;
            await r.bot.useItemOnLoc(DUSTY_KEY, door);
            await r.waitFor(s => (s.player?.worldX ?? 9999) < DUSTY_KEY_DOOR.x, 10);
        }
        return r.walk(this.centre.x, this.centre.z, 4, 90_000);
    },
    async leave(r) {
        if (r.underground()) {
            if (r.pos().x < DUSTY_KEY_DOOR.x) {
                if (!(await r.walk(DUSTY_KEY_DOOR.x - 1, DUSTY_KEY_DOOR.z, 1, 90_000))) return false;
                const door = (await r.sdk.scanNearbyLocs(4)).find(l => /door/i.test(l.name) && l.x === DUSTY_KEY_DOOR.x && l.z === DUSTY_KEY_DOOR.z);
                if (door) await r.bot.interactLoc(door, /open/i);
                await r.waitFor(s => (s.player?.worldX ?? 0) > DUSTY_KEY_DOOR.x, 10);
            }
            if (!(await r.walk(TAVERLEY_DUNGEON_BOTTOM.x, TAVERLEY_DUNGEON_BOTTOM.z, 2, 120_000))) return false;
            if (!(await r.climb(/ladder/i, /climb-up/i, false, TAVERLEY_DUNGEON_BOTTOM))) return false;
        }
        return r.walk(FALADOR_WEST_BANK.x, FALADOR_WEST_BANK.z, 3, 300_000);
    }
};

const SPOTS: Record<string, Spot> = { hill_giants: HILL_GIANTS, baby_blue: BABY_BLUE };

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

/** Valuables worth a pickup on top of the bones: stackables and small light items. */
const DEFAULT_LOOT = /^(coins|(law|nature|cosmic|death|chaos|blood|soul) rune|grimy .+|limpwurt root|uncut (sapphire|emerald|ruby|diamond|dragonstone)|.+ talisman|brass key|dusty key)$/i;

const FOOD = /^(shark|manta ray|sea turtle|swordfish|lobster|monkfish|bass|tuna|salmon|pike|trout|cod|herring|mackerel|sardine|anchovies|shrimps|cooked chicken|cooked meat|bread|cake|2\/3 cake|slice of cake|chocolate cake|meat pie|stew|kebab|plain pizza|meat pizza)$/i;
const RAW_FISH = /^raw (trout|salmon)$/i;
const NET_FISH = /^raw (shrimps|anchovies)$/i;
const NET = /^small fishing net$/i;
/** Cooking level each catch needs (cooking_generic.dbrow); below it the fire answers with a mesbox and cooks nothing. */
const COOK_REQ: Record<string, number> = { 'raw shrimps': 1, 'raw anchovies': 1, 'raw trout': 15, 'raw salmon': 25 };
const ROD = /^fly fishing rod$/i;
const FEATHER = /^feather$/i;

/** Items a bank visit leaves in the inventory: food, the fly fishing kit, keys, and the net and its catch while cooking practice still needs them. */
export function keepOnBank(name: string, lv: { fishing: number; cooking: number }, requires?: RegExp): boolean {
    return FOOD.test(name) || RAW_FISH.test(name) || ROD.test(name) || FEATHER.test(name) || BRASS_KEY.test(name) ||
        (requires?.test(name) ?? false) ||
        (NET.test(name) && (lv.fishing < 20 || lv.cooking < 15)) ||
        (NET_FISH.test(name) && lv.cooking < 15);
}

/** Bootstrap leftovers that only cost loot slots at the spot: raw net fish once Cooking is 15, and anything burnt. */
export function isClutter(name: string, cooking: number): boolean {
    return /^burnt /i.test(name) || (NET_FISH.test(name) && cooking >= 15);
}

const METALS = ['bronze', 'iron', 'steel', 'black', 'mithril', 'adamant', 'rune'];
const METAL_REQ: Record<string, number> = { bronze: 1, iron: 1, steel: 5, black: 10, mithril: 20, adamant: 30, rune: 40 };
const SLOTS: { slot: string; re: RegExp; skill: 'Attack' | 'Defence' }[] = [
    { slot: 'weapon', re: /^(\w+) (sword|longsword|scimitar)$/i, skill: 'Attack' },
    { slot: 'shield', re: /^(\w+) (kiteshield|sq shield)$/i, skill: 'Defence' },
    { slot: 'head', re: /^(\w+) (full helm|med helm)$/i, skill: 'Defence' },
    { slot: 'body', re: /^(\w+) (platebody|chainbody)$/i, skill: 'Defence' },
    { slot: 'legs', re: /^(\w+) (platelegs|plateskirt)$/i, skill: 'Defence' }
];

/** Slot and tier of a melee item we know how to rank, or null. Higher tier is better; within a metal, longswords/scimitars beat swords and full helms beat med helms. */
export function gearRank(name: string): { slot: string; tier: number; metal: string; skill: 'Attack' | 'Defence' } | null {
    if (/^wooden shield$/i.test(name)) return { slot: 'shield', tier: 0, metal: 'bronze', skill: 'Defence' };
    for (const s of SLOTS) {
        const m = s.re.exec(name);
        if (!m) continue;
        const metal = (m[1] ?? '').toLowerCase();
        const i = METALS.indexOf(metal);
        if (i < 0) return null;
        const sub = /longsword|scimitar|full helm|platebody|platelegs|kiteshield/i.test(m[2] ?? '') ? 1 : 0;
        return { slot: s.slot, tier: 2 + i * 2 + sub, metal, skill: s.skill };
    }
    return null;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

interface Options {
    spot: Spot;
    /** Train Attack, Strength and Defence on cows until all reach this. */
    train: number;
    /** Catch and cook food (trout/salmon at Barbarian Village). */
    fish: boolean;
    /** Raw fish to catch per food run. */
    fishPerTrip: number;
    /** Go for food when fewer than this many are carried. */
    minFood: number;
    /** With a full bag, drop food for a bone while more than minFood + spareFood are carried. */
    spareFood: number;
    /** Feathers to collect from chickens when the stock runs out. */
    feathers: number;
    /** Eat below this fraction of max hitpoints. */
    eatAt: number;
    /** With no food, leave for the bank below this fraction... */
    fleeAt: number;
    /** ...and rest there until hitpoints are back to this fraction. */
    restUntil: number;
    /** Extra loot on top of the spot's bones. */
    loot: RegExp;
    /** Skip a target with more than this many other players adjacent. */
    maxPlayersNearTarget: number;
    /** Stop training a combat skill at this level (the style picker skips it). */
    styleCap: number;
}

export function parseOptions(o: Record<string, unknown>): Options {
    const num = (k: string, d: number) => (typeof o[k] === 'number' ? (o[k] as number) : d);
    const spotId = typeof o.spot === 'string' ? o.spot : 'hill_giants';
    const spot = SPOTS[spotId];
    if (!spot) throw new Error(`bones: unknown spot '${spotId}' (known: ${Object.keys(SPOTS).join(', ')})`);
    return {
        spot,
        train: num('train', 50),
        fish: o.fish !== false,
        fishPerTrip: num('fishPerTrip', 10),
        minFood: num('minFood', 2),
        spareFood: num('spareFood', 3),
        feathers: num('feathers', 300),
        eatAt: num('eatAt', 0.55),
        fleeAt: num('fleeAt', 0.35),
        restUntil: num('restUntil', 0.9),
        loot: typeof o.loot === 'string' ? new RegExp(o.loot, 'i') : DEFAULT_LOOT,
        maxPlayersNearTarget: num('maxPlayersNearTarget', 0),
        styleCap: num('styleCap', 99)
    };
}

// ---------------------------------------------------------------------------
// Run: one account's live session
// ---------------------------------------------------------------------------

interface Target { npc: RegExp; area: Box; centre: Tile; loot: RegExp | null }
type Outcome = 'killed' | 'lost' | 'flee' | 'none' | 'full';

class Run {
    readonly bot: BotActions;
    readonly sdk: BotSDK;
    nextKeyLook = 0;
    private kills = 0;
    private looted: Record<string, number> = {};
    private deaths = 0;
    private readonly startedAt = Date.now();
    private lastRespawnCount: number | null = null;
    /** Bank contents as of the last visit (null until the first one). */
    private bankView: Map<string, number> | null = null;
    private currentPhase = 'start';

    /** Log each stage change once: train, kit:net, kit:rod, kit:feathers, food:cook, food:fish, bones:<spot>. */
    phase(to: string): void {
        if (to === this.currentPhase) return;
        this.ctx.log('phase', { from: this.currentPhase, to, levels: this.summary().levels });
        this.currentPhase = to;
    }

    constructor(readonly ctx: RoleContext, readonly opt: Options) {
        this.bot = ctx.bot;
        this.sdk = ctx.sdk;
    }

    // ---- state helpers ----

    state(): BotWorldState {
        const s = this.sdk.getState();
        if (!s?.player) throw new Error('no world state');
        return s;
    }
    pos(): Tile & { level: number } {
        const p = this.state().player!;
        return { x: p.worldX, z: p.worldZ, level: p.level };
    }
    underground(): boolean { return this.pos().z > UNDERGROUND_Z; }
    level(skill: string): number { return this.sdk.getSkill(skill)?.baseLevel ?? 1; }
    hpFrac(): number {
        const hp = this.sdk.getSkill('Hitpoints');
        const p = this.state().player!;
        return (hp?.level ?? p.hp) / Math.max(1, hp?.baseLevel ?? p.maxHp ?? 10);
    }
    freeSlots(): number { return 28 - this.state().inventory.length; }
    food(): InventoryItem[] { return this.state().inventory.filter(i => FOOD.test(i.name)); }
    carried(re: RegExp): number { return this.state().inventory.filter(i => re.test(i.name)).reduce((a, i) => a + i.count, 0); }
    carrying(re: RegExp): boolean { return this.carried(re) > 0; }
    banked(re: RegExp): number {
        let n = 0;
        for (const [name, c] of this.bankView ?? []) if (re.test(name)) n += c;
        return n;
    }
    owns(re: RegExp): boolean { return this.carrying(re) || this.banked(re) > 0; }
    aborted(): boolean { return this.ctx.signal.aborted; }

    async waitFor(pred: (s: BotWorldState) => boolean, ticks: number): Promise<boolean> {
        for (let i = 0; i < ticks; i++) {
            const s = this.sdk.getState();
            if (s && pred(s)) return true;
            await this.sdk.waitForTicks(1);
        }
        const s = this.sdk.getState();
        return !!s && pred(s);
    }

    async walk(x: number, z: number, tol: number, timeout: number): Promise<boolean> {
        for (let attempt = 0; attempt < 3; attempt++) {
            if (this.aborted()) return false;
            if (dist(this.pos(), { x, z }) <= tol) return true;
            const r = await this.bot.walkTo(x, z, tol, { timeout });
            await this.sdk.waitForTicks(1);
            if (dist(this.pos(), { x, z }) <= tol + 1) return true;
            this.ctx.log('walk retry', { to: [x, z], at: [this.pos().x, this.pos().z], reason: r.message });
        }
        return dist(this.pos(), { x, z }) <= tol + 1;
    }

    /** Use a ladder or trapdoor near `at`; `down` decides which side of UNDERGROUND_Z counts as done. Opens a closed trapdoor first. */
    async climb(name: RegExp, option: RegExp, down: boolean, at: Tile): Promise<boolean> {
        const done = (s: BotWorldState) => ((s.player?.worldZ ?? 0) > UNDERGROUND_Z) === down;
        for (let attempt = 0; attempt < 5; attempt++) {
            if (done(this.state())) return true;
            if (dist(this.pos(), at) > 4) await this.walk(at.x, at.z, 2, 60_000);
            const loc = (await this.sdk.scanNearbyLocs(10))
                .filter(l => name.test(l.name) && l.optionsWithIndex.some(o => option.test(o.text)))
                .sort((a, b) => dist(a, at) - dist(b, at))[0];
            if (!loc) {
                this.ctx.log('climb: no loc', { name: String(name), at: [this.pos().x, this.pos().z] });
                await this.sdk.waitForTicks(2);
                continue;
            }
            const climbOpt = loc.optionsWithIndex.find(o => /climb/i.test(o.text) && option.test(o.text));
            const openOpt = loc.optionsWithIndex.find(o => /^open$/i.test(o.text));
            await this.bot.interactLoc(loc, (climbOpt ?? openOpt)!.text);
            if (await this.waitFor(done, 8)) return true;
        }
        return done(this.state());
    }

    /** Unlock the brass-key house door with the key, going in (`entering`) or out. */
    async throughBrassDoor(entering: boolean): Promise<boolean> {
        const inside = (s: BotWorldState) => (s.player?.worldZ ?? 0) >= BRASS_DOOR.z;
        for (let attempt = 0; attempt < 4; attempt++) {
            if (inside(this.state()) === entering) return true;
            if (entering && !(await this.walk(BRASS_DOOR_OUTSIDE.x, BRASS_DOOR_OUTSIDE.z, 1, 300_000))) continue;
            const door = (await this.sdk.scanNearbyLocs(6)).find(l => l.x === BRASS_DOOR.x && l.z === BRASS_DOOR.z && /door/i.test(l.name));
            if (!door) {
                await this.sdk.waitForTicks(2);
                continue;
            }
            await this.bot.useItemOnLoc(BRASS_KEY, door);
            if (await this.waitFor(s => inside(s) === entering, 8)) return true;
        }
        return inside(this.state()) === entering;
    }

    // ---- bookkeeping ----

    noteRespawn(): void {
        const p = this.state().player!;
        if (this.lastRespawnCount !== null && p.respawnCount > this.lastRespawnCount) {
            this.deaths += p.respawnCount - this.lastRespawnCount;
            this.ctx.log('died', { deaths: this.deaths, at: [p.worldX, p.worldZ] });
        }
        this.lastRespawnCount = p.respawnCount;
    }

    summary(): Record<string, unknown> {
        const hours = (Date.now() - this.startedAt) / 3_600_000;
        const bones = Object.entries(this.looted).filter(([k]) => /bones/i.test(k)).reduce((a, [, v]) => a + v, 0);
        return {
            kills: this.kills,
            looted: this.looted,
            deaths: this.deaths,
            hours: Number(hours.toFixed(3)),
            bonesPerHour: hours > 0 ? Math.round(bones / hours) : 0,
            levels: ['Attack', 'Strength', 'Defence', 'Hitpoints', 'Fishing', 'Cooking'].map(s => `${s.slice(0, 2)}${this.level(s)}`).join(' ')
        };
    }

    // ---- equipment and style ----

    async equipUpgrades(): Promise<void> {
        const worn: Record<string, number> = {};
        for (const e of this.sdk.getEquipment()) {
            const r = gearRank(e.name);
            if (r) worn[r.slot] = Math.max(worn[r.slot] ?? -1, r.tier);
        }
        for (const item of this.state().inventory) {
            const r = gearRank(item.name);
            if (!r || r.tier <= (worn[r.slot] ?? -1)) continue;
            if (this.level(r.skill) < (METAL_REQ[r.metal] ?? 99)) continue;
            const res = await this.bot.equipItem(item);
            if (res.success) {
                worn[r.slot] = r.tier;
                this.ctx.log('equipped', { item: item.name });
            }
        }
    }

    async pickStyle(): Promise<void> {
        const cs = this.state().combatStyle;
        if (!cs?.styles?.length) return;
        const skills = (['Attack', 'Strength', 'Defence'] as const).filter(s => this.level(s) < this.opt.styleCap);
        if (!skills.length) return;
        const want = skills.reduce((a, b) => (this.level(b) < this.level(a) ? b : a));
        const style = cs.styles.find(s => s.trainsSkills.length === 1 && s.trainsSkills[0] === want)
            ?? cs.styles.find(s => s.trainsSkills.includes(want));
        if (style && cs.currentStyle !== style.index) {
            await this.sdk.sendSetCombatStyle(style.index);
            await this.waitFor(s => s.combatStyle?.currentStyle === style.index, 3);
        }
    }

    async eatIfLow(): Promise<boolean> {
        if (this.hpFrac() >= this.opt.eatAt) return false;
        const f = this.food()[0];
        if (!f) return false;
        const r = await this.bot.eatFood(f);
        return r.success;
    }

    // ---- banking (kept small so it can move to speedrun/lib) ----

    nearBank(): boolean { return !this.underground() && BANKS.some(b => dist(this.pos(), b) <= 8); }

    /**
     * Open the nearest bank (walking out of the spot first if needed), deposit everything
     * except the kit, take out `withdraw`, report, close. `why` names the trigger in the log.
     */
    async bank(why: string, spot: Spot | null, withdraw: { re: RegExp; n: number }[] = []): Promise<boolean> {
        const inv = this.state().inventory;
        const carried = {
            used: inv.length,
            food: inv.filter(i => FOOD.test(i.name)).length,
            bones: inv.filter(i => /bones$/i.test(i.name)).length
        };
        if (!this.nearBank()) {
            const ok = spot ? await spot.leave(this) : await this.walkToNearestBank();
            if (!ok) return false;
        }
        const open = await this.bot.openBank();
        if (!open.success) {
            this.ctx.log('bank: open failed', { why, reason: open.message });
            return false;
        }
        const lv = { fishing: this.level('Fishing'), cooking: this.level('Cooking') };
        const keep = (name: string) => keepOnBank(name, lv, spot?.requires);
        for (const name of [...new Set(this.state().inventory.map(i => i.name))].filter(n => !keep(n))) {
            await this.bot.depositItem(exact(name), -1);
        }
        for (const w of withdraw) {
            const have = this.carried(w.re);
            const item = this.sdk.getBankItems().find(b => w.re.test(b.name));
            if (item && have < w.n) await this.bot.withdrawItem(item, Math.min(item.count, w.n - have));
        }
        const items = this.sdk.getBankItems().map(b => ({ id: b.id, name: b.name, count: b.count }));
        this.bankView = new Map(items.map(i => [i.name, i.count]));
        this.ctx.reportBank({ items });
        const bones = items.filter(i => /bones/i.test(i.name)).map(i => `${i.name} ${i.count}`).join(', ');
        this.ctx.log('banked', { why, carried, stock: bones || 'no bones', ...this.summary() });
        await this.bot.closeBank();
        return true;
    }

    async walkToNearestBank(): Promise<boolean> {
        const b = BANKS.slice().sort((a, c) => dist(this.pos(), a) - dist(this.pos(), c))[0]!;
        return this.walk(b.x, b.z, 3, 300_000);
    }

    async rest(): Promise<void> {
        this.ctx.log('resting', { hp: Number(this.hpFrac().toFixed(2)) });
        while (!this.aborted() && this.hpFrac() < this.opt.restUntil && this.food().length === 0) {
            await this.sdk.waitForTicks(10);
            await this.bot.dismissBlockingUI();
        }
    }

    // ---- fighting ----

    pickTarget(t: Target): NearbyNpc | null {
        const s = this.state();
        const candidates = s.nearbyNpcs.filter(n =>
            t.npc.test(n.name) && n.hp !== 0 && inBox(t.area, n.x, n.z) &&
            n.optionsWithIndex.some(o => /attack/i.test(o.text)));
        // An NPC already on us comes first (giants aggress); otherwise skip ones in someone else's fight.
        const onMe = candidates.filter(n => n.inCombat && n.distance <= 2 && s.player!.combat.inCombat);
        if (onMe.length) return onMe.sort((a, b) => a.distance - b.distance)[0] ?? null;
        const crowded = (n: NearbyNpc) => s.nearbyPlayers.filter(p =>
            Math.max(Math.abs((p.worldX ?? p.x) - n.x), Math.abs((p.worldZ ?? p.z) - n.z)) <= 1).length > this.opt.maxPlayersNearTarget;
        return candidates.filter(n => !n.inCombat && !crowded(n)).sort((a, b) => a.distance - b.distance)[0] ?? null;
    }

    async fight(t: Target): Promise<Outcome> {
        const target = this.pickTarget(t);
        if (!target) return 'none';
        await this.pickStyle();
        const atk = await this.bot.attack(target);
        if (!atk.success) {
            await this.sdk.waitForTicks(1);
            return 'lost';
        }
        let last: Tile = { x: target.x, z: target.z };
        const deadline = Date.now() + 120_000;
        let idleTicks = 0;
        while (Date.now() < deadline && !this.aborted()) {
            await this.sdk.waitForTicks(1);
            const s = this.state();
            if (s.player!.isDead) return 'lost';
            if (this.hpFrac() < this.opt.eatAt) {
                if (!(await this.eatIfLow()) && this.hpFrac() < this.opt.fleeAt) return 'flee';
                // Eating interrupts the attack; re-engage.
                const again = this.state().nearbyNpcs.find(n => n.index === target.index);
                if (again && again.hp !== 0) await this.bot.attack(again);
            }
            const npc = this.state().nearbyNpcs.find(n => n.index === target.index);
            if (!npc) break; // despawned: dead (or out of view)
            last = { x: npc.x, z: npc.z };
            if (npc.hp === 0) {
                await this.waitFor(st => !st.nearbyNpcs.some(n => n.index === target.index), 6);
                break;
            }
            if (!s.player!.combat.inCombat && !npc.inCombat) {
                if (++idleTicks > 8) return 'lost';
            } else idleTicks = 0;
        }
        this.kills++;
        if (this.kills % 25 === 0) this.ctx.log('progress', this.summary());
        return t.loot ? this.loot(t.loot, last) : 'killed';
    }

    async loot(want: RegExp, at: Tile): Promise<Outcome> {
        await this.sdk.waitForTicks(1);
        const wanted = (g: GroundItem) => want.test(g.name) || this.upgrade(g.name);
        const bonesFirst = (g: GroundItem) => Number(/bones/i.test(g.name));
        for (let pass = 0; pass < 6; pass++) {
            const g = (await this.sdk.scanGroundItems(6))
                .filter(i => wanted(i) && dist(i, at) <= 2)
                .sort((a, b) => bonesFirst(b) - bonesFirst(a))[0];
            if (!g) return 'killed';
            const stacks = this.state().inventory.some(i => i.id === g.id) && /^(coins|.+ rune|feather)$/i.test(g.name);
            if (this.freeSlots() === 0 && !stacks) {
                // Make room by eating if hurt at all, or, for bones, by dropping a fish the trip
                // will not need (self-caught food is cheap; a bank walk is not). Otherwise the trip is over.
                if (this.food().length && this.hpFrac() < 0.95) await this.bot.eatFood(this.food()[0]!);
                else if (/bones/i.test(g.name) && this.food().length > this.opt.minFood + this.opt.spareFood) {
                    const f = this.food()[0]!;
                    await this.bot.dropItem(exact(f.name), 1);
                    await this.waitFor(s => s.inventory.length < 28, 3);
                }
                if (this.freeSlots() === 0) return 'full';
            }
            const before = this.sdk.countInventoryItems(exact(g.name));
            const r = await this.bot.pickupItem(g);
            const after = this.sdk.countInventoryItems(exact(g.name));
            if (after > before) this.looted[g.name] = (this.looted[g.name] ?? 0) + (after - before);
            else if (!r.success) return 'killed';
        }
        return 'killed';
    }

    upgrade(name: string): boolean {
        const r = gearRank(name);
        if (!r || this.level(r.skill) < (METAL_REQ[r.metal] ?? 99)) return false;
        let best = -1;
        for (const e of [...this.sdk.getEquipment(), ...this.state().inventory]) {
            const w = gearRank(e.name);
            if (w && w.slot === r.slot) best = Math.max(best, w.tier);
        }
        return r.tier > best;
    }

    /** Kill and loot inside a box on the surface (training, feathers); walks in first. */
    async surfaceFight(t: Target): Promise<void> {
        const p = this.pos();
        if (this.underground() || !inBox(t.area, p.x, p.z)) {
            if (this.underground()) {
                await this.bank('surface', this.opt.spot);
                return;
            }
            await this.walk(t.centre.x, t.centre.z, 4, 300_000);
            return;
        }
        const out = await this.fight(t);
        if (out === 'none') await this.sdk.waitForTicks(3);
    }

    // ---- fishing kit and food ----

    /** Net fish at Draynor until Fishing 20 (fly fishing); the catch is dropped. */
    async netFish(): Promise<void> {
        if (!this.carrying(/^small fishing net$/i)) {
            if (this.banked(/^small fishing net$/i) > 0 || this.bankView === null) {
                await this.bank('fetch net', null, [{ re: /^small fishing net$/i, n: 1 }]);
                if (this.carrying(/^small fishing net$/i)) return;
            }
            this.ctx.log('no small fishing net; fishing for food disabled');
            this.opt.fish = false;
            return;
        }
        if (dist(this.pos(), DRAYNOR_NET) > 8) {
            await this.walk(DRAYNOR_NET.x, DRAYNOR_NET.z, 3, 300_000);
            return;
        }
        await this.fishLoop(/^fishing spot$/i, /^net$/i, NET_FISH, () => this.level('Fishing') >= 20, DRAYNOR_NET);
    }

    /** Net a handful of shrimps at Draynor so the first cooking levels (trout needs 15) come from food that cooks at 1. */
    async netForCooking(spot: Spot): Promise<void> {
        if (!this.carrying(NET)) {
            await this.bank('fetch net', this.underground() ? spot : null, [{ re: NET, n: 1 }]);
            if (!this.carrying(NET)) {
                this.ctx.log('no small fishing net for cooking practice; fishing for food disabled');
                this.opt.fish = false;
            }
            return;
        }
        if (this.underground()) {
            await spot.leave(this);
            return;
        }
        if (dist(this.pos(), DRAYNOR_NET) > 8) {
            await this.walk(DRAYNOR_NET.x, DRAYNOR_NET.z, 3, 300_000);
            return;
        }
        await this.fishLoop(/^fishing spot$/i, /^net$/i, NET_FISH, () => this.carried(NET_FISH) >= 10 || this.freeSlots() === 0, DRAYNOR_NET);
    }

    /** Buy a fly fishing rod (and feathers with spare coins) from Gerrant in Port Sarim. */
    async buyRod(): Promise<void> {
        const coins = () => this.carried(/^coins$/i);
        if (coins() < 5) {
            await this.bank('fetch coins', null, [{ re: /^coins$/i, n: 1_000_000 }]);
            if (coins() < 5) {
                this.ctx.log('no coins for a fly fishing rod; fishing for food disabled until some are earned');
                this.opt.fish = false;
            }
            return;
        }
        if (dist(this.pos(), GERRANT) > 4) {
            await this.walk(GERRANT.x, GERRANT.z, 2, 300_000);
            return;
        }
        const open = await this.bot.openShop(/gerrant/i);
        if (!open.success) {
            this.ctx.log('gerrant: shop did not open', { reason: open.message });
            await this.sdk.waitForTicks(5);
            return;
        }
        await this.bot.buyFromShop(ROD, 1);
        const spare = coins() - 50;
        if (spare >= 2) await this.bot.buyFromShop(FEATHER, Math.min(500, Math.floor(spare / 2)));
        await this.bot.closeShop();
        this.ctx.log('bought fishing kit', { rod: this.carrying(ROD), feathers: this.carried(FEATHER) });
    }

    /** Fly fish at Barbarian Village until fishPerTrip raw fish or a full inventory. */
    async flyFish(): Promise<void> {
        if (dist(this.pos(), BARBARIAN_FISH) > 12) {
            await this.walk(BARBARIAN_FISH.x, BARBARIAN_FISH.z, 4, 300_000);
            return;
        }
        const target = this.carried(RAW_FISH) + Math.min(this.freeSlots(), this.opt.fishPerTrip - this.carried(RAW_FISH) - this.food().length);
        await this.fishLoop(/^fishing spot$/i, /^lure$/i, RAW_FISH,
            () => this.carried(RAW_FISH) >= target || this.freeSlots() === 0 || !this.carrying(FEATHER), BARBARIAN_FISH);
    }

    async fishLoop(spotName: RegExp, option: RegExp, catchRe: RegExp, done: () => boolean, home: Tile): Promise<void> {
        let idle = 0;
        let lastXp = this.sdk.getSkillXp('Fishing') ?? 0;
        const deadline = Date.now() + 10 * 60_000;
        while (!done() && !this.aborted() && Date.now() < deadline) {
            if (this.state().dialog.isOpen) await this.bot.dismissBlockingUI();
            if (this.freeSlots() === 0 && catchRe === NET_FISH) {
                if (this.level('Cooking') < 15) break; // keep them for cooking practice
                await this.bot.dropItem(NET_FISH, 'all');
                continue;
            }
            const xp = this.sdk.getSkillXp('Fishing') ?? 0;
            if (xp > lastXp) { lastXp = xp; idle = 0; }
            const fishing = (this.state().player!.animId ?? -1) !== -1;
            if (!fishing || idle > 30) {
                const spot = this.state().nearbyNpcs.filter(n => spotName.test(n.name) && n.optionsWithIndex.some(o => option.test(o.text)))
                    .sort((a, b) => a.distance - b.distance)[0];
                if (!spot) {
                    await this.walk(home.x, home.z, 3, 60_000);
                    await this.sdk.waitForTicks(3);
                    continue;
                }
                await this.bot.interactNpc(spot, option);
                idle = 0;
            }
            await this.sdk.waitForTicks(2);
            idle += 2;
        }
        if (catchRe === NET_FISH && this.carrying(NET_FISH) && this.level('Cooking') >= 15) await this.bot.dropItem(NET_FISH, 'all');
    }

    /**
     * Cook every raw catch the Cooking level allows on the Barbarian Village fire, lowest
     * requirement first so shrimps and trout level the cook up for the salmon. Raw fish
     * still above the level afterwards is dropped; so is anything burnt.
     */
    async cook(): Promise<void> {
        if (!inBox(LONGHALL, this.pos().x, this.pos().z)) {
            await this.walk(BARBARIAN_FIRE.x, BARBARIAN_FIRE.z, 0, 300_000);
            return;
        }
        const raw = () => this.state().inventory
            .filter(i => (RAW_FISH.test(i.name) || NET_FISH.test(i.name)) && (COOK_REQ[i.name.toLowerCase()] ?? 99) <= this.level('Cooking'))
            .sort((a, b) => (COOK_REQ[a.name.toLowerCase()] ?? 99) - (COOK_REQ[b.name.toLowerCase()] ?? 99))[0];
        let stuck = 0;
        let item: InventoryItem | undefined;
        while ((item = raw()) && !this.aborted() && stuck < 5) {
            if (this.state().dialog.isOpen) await this.bot.dismissBlockingUI();
            const fire = (await this.sdk.scanNearbyLocs(5)).filter(l => /^fire$/i.test(l.name))
                .sort((a, b) => Number(b.reachable !== false) - Number(a.reachable !== false) || a.distance - b.distance)[0];
            if (!fire) break;
            const before = this.state().inventory.length;
            const slotBefore = item.slot;
            await this.bot.useItemOnLoc(item, fire);
            const changed = await this.waitFor(s => s.inventory.find(i => i.slot === slotBefore)?.name !== item!.name || s.inventory.length !== before, 6);
            stuck = changed ? 0 : stuck + 1;
        }
        if (this.state().dialog.isOpen) await this.bot.dismissBlockingUI();
        const uncookable = this.state().inventory.filter(i => (RAW_FISH.test(i.name) || NET_FISH.test(i.name)) && (COOK_REQ[i.name.toLowerCase()] ?? 99) > this.level('Cooking'));
        for (const name of new Set(uncookable.map(i => i.name))) await this.bot.dropItem(exact(name), 'all');
        if (this.carrying(/^burnt /i)) await this.bot.dropItem(/^burnt /i, 'all');
        this.ctx.log('cooked', { food: this.food().length, stuck, levels: this.summary().levels });
    }

    // ---- the cycle ----

    trainingDone(): boolean { return ['Attack', 'Strength', 'Defence'].every(s => this.level(s) >= this.opt.train); }

    inTutorial(): boolean {
        const p = this.state().player!;
        return p.level === 0 && p.worldX >= 3050 && p.worldX <= 3160 && p.worldZ >= 3050 && p.worldZ <= 3135;
    }

    async cycle(): Promise<void> {
        const s = this.state();
        if (s.modalInterface === 3559 || this.inTutorial()) {
            const r = await this.bot.skipTutorial();
            this.ctx.log('tutorial skipped', { ok: r.success, detail: r.message });
            await this.sdk.waitForTicks(3);
            return;
        }
        await this.bot.dismissBlockingUI();
        if (this.sdk.isBankOpen() || s.shop?.isOpen) await this.bot.closeInterface();
        this.noteRespawn();
        await this.equipUpgrades();

        // 2. Train on cows (they never hurt).
        if (!this.trainingDone()) {
            this.phase('train');
            await this.surfaceFight({ npc: /^cow$/i, area: COW_FIELD, centre: { x: 3253, z: 3282 }, loot: null });
            return;
        }

        // 3. Fishing kit. Coins come from the spot's drops if the starting 25 are gone.
        if (this.opt.fish && this.bankView === null && !this.carrying(ROD)) {
            await this.bank('first look', this.underground() ? this.opt.spot : null);
            return;
        }
        if (this.opt.fish && !this.owns(ROD)) {
            if (this.level('Fishing') < 20) {
                this.phase('kit:net');
                await this.netFish();
            } else {
                this.phase('kit:rod');
                await this.buyRod();
            }
            return;
        }
        if (this.opt.fish && !this.owns(FEATHER) && !this.carrying(RAW_FISH) && this.food().length < this.opt.minFood) {
            this.phase('kit:feathers');
            const feathers: Target = { npc: /^chicken$/i, area: CHICKEN_COOP, centre: { x: 3230, z: 3298 }, loot: FEATHER };
            while (!this.aborted() && this.carried(FEATHER) < this.opt.feathers && this.freeSlots() > 0) {
                await this.surfaceFight(feathers);
                if (this.underground()) return;
            }
            this.ctx.log('collected feathers', { feathers: this.carried(FEATHER) });
            return;
        }

        const spot = this.opt.spot;
        if (this.opt.fish && this.level('Cooking') < 15) {
            this.phase('kit:cook');
            if (this.carried(NET_FISH) >= 6 || (this.carrying(NET_FISH) && this.freeSlots() === 0)) {
                if (this.underground()) await spot.leave(this);
                await this.cook();
            } else if (this.carrying(RAW_FISH)) {
                await this.bot.dropItem(RAW_FISH, 'all'); // trout/salmon this cook cannot cook yet
            } else {
                await this.netForCooking(spot);
            }
            return;
        }
        if (spot.requires && !this.carrying(spot.requires)) {
            await this.bank('fetch requirement', spot, [{ re: spot.requires, n: 1 }]);
            if (!this.carrying(spot.requires)) {
                this.ctx.log('missing requirement; switching to hill giants', { spot: spot.id, requires: String(spot.requires) });
                this.opt.spot = HILL_GIANTS;
            }
            return;
        }

        // 4. Food.
        if (this.carrying(RAW_FISH) && (this.food().length < this.opt.minFood || !this.underground())) {
            this.phase('food:cook');
            if (this.underground()) await spot.leave(this);
            await this.cook();
            return;
        }
        if (this.opt.fish && this.food().length < this.opt.minFood) {
            this.phase('food:fish');
            const haul = this.state().inventory.some(i => spot.bones.test(i.name) || /^coins$/i.test(i.name));
            if (haul || !this.carrying(ROD) || !this.carrying(FEATHER) || this.freeSlots() < 8) {
                await this.bank('out of food', spot, [{ re: ROD, n: 1 }, { re: FEATHER, n: 10_000 }, { re: BRASS_KEY, n: 1 }]);
                return;
            }
            if (this.underground()) {
                await spot.leave(this);
                return;
            }
            await this.flyFish();
            return;
        }

        // 5. Bones.
        this.phase(`bones:${spot.id}`);
        if (this.hpFrac() < this.opt.fleeAt && this.food().length === 0) {
            await this.bank('low hp, no food', spot);
            await this.rest();
            return;
        }
        await this.eatIfLow();
        for (const name of new Set(this.state().inventory.filter(i => isClutter(i.name, this.level('Cooking'))).map(i => i.name))) {
            await this.bot.dropItem(exact(name), 'all');
        }
        if (this.freeSlots() === 0) {
            await this.bank('full', spot, [{ re: ROD, n: 1 }, { re: FEATHER, n: 10_000 }, { re: BRASS_KEY, n: 1 }]);
            return;
        }
        const p = this.pos();
        if (!inBox(spot.area, p.x, p.z)) {
            if (!(await spot.enter(this))) {
                this.ctx.log('could not reach spot', { spot: spot.id, at: [this.pos().x, this.pos().z] });
                await this.sdk.waitForTicks(5);
            }
            return;
        }
        await spot.upkeep?.(this);
        const out = await this.fight({ npc: spot.npc, area: spot.area, centre: spot.centre, loot: new RegExp(`${spot.bones.source}|${this.opt.loot.source}`, 'i') });
        if (out === 'none') {
            // Everything is dead or taken; drift back to the centre and wait for respawns.
            if (dist(this.pos(), spot.centre) > 6) await this.walk(spot.centre.x, spot.centre.z, 4, 60_000);
            else await this.sdk.waitForTicks(3);
        } else if (out === 'flee') {
            this.ctx.log('fleeing', { hp: Number(this.hpFrac().toFixed(2)) });
            await this.bank('fled', spot);
            if (!this.opt.fish) await this.rest();
        } else if (out === 'full') {
            await this.bank('full', spot, [{ re: ROD, n: 1 }, { re: FEATHER, n: 10_000 }, { re: BRASS_KEY, n: 1 }]);
        }
    }
}

export const role: Role = {
    name: 'bones',
    produces: [/bones$/i],
    async run(ctx: RoleContext): Promise<void> {
        const opt = parseOptions(ctx.options);
        await ctx.sdk.waitForReady(60_000);
        const run = new Run(ctx, opt);
        ctx.log('start', { spot: opt.spot.id, train: opt.train, fish: opt.fish, ...run.summary() });
        let errors = 0;
        while (!ctx.signal.aborted) {
            try {
                await run.cycle();
                errors = 0;
            } catch (e) {
                errors++;
                ctx.log('cycle error', { error: String(e), errors });
                await new Promise(r => setTimeout(r, Math.min(30_000, 1000 * errors)));
            }
        }
        ctx.log('stopped', run.summary());
    }
};

if (import.meta.main) await runStandalone(role);
