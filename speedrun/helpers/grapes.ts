// Grape gatherer (cairn://p/rs/47; rates and shortfall math in docs/speedrun/helpers/wine.md).
// Grapes have no shop in this revision; the sources are two ground spawns and one
// rare drop:
//
//   guild    Cooking Guild top floor, (3144,3450) level 2: 1 grape, respawn 80 ticks
//            (wine.obj respawnrate=80), so at most ~135 an hour for one camper.
//            The grape lies on a table (bigtable, 3144,3449-3450) that blocks its
//            tile, so the camper stands west of it at (3143,3450).
//            The door needs Cooking 32 and a worn chef's hat (cooking_guild.rs2).
//            A jug spawns on the same floor (3141,3447) and the ground-floor sink
//            (3146,3451) fills it, so the camper also supplies jugs of water.
//   phoenix  Phoenix Gang hideout, (3237,9761): same 80-tick spawn, behind a door
//            that opens for Phoenix Gang members (not implemented; see wine.md).
//   goblins  Goblin Village goblins drop grapes 1/128 (goblin.rs2 goblin_village_drop_table).
//
// A fresh account fetches its tutorial sword and shield (Draynor bank), then kills
// the chickens north-east of Lumbridge and cooks them on the cooking pot in the
// house at the pen: that trains melee and Cooking (to 35 for 'guild', so the same
// account can make wine with wine.ts) and stocks cooked chickens as food. A
// 'guild' account then farms a chef's hat from the Lumbridge goblins (3/128 per
// kill) and camps the spawn. Hitpoints regenerate only ~1 per 100 ticks, so
// fighting without food is mostly resting. Etiquette: one camper per spawn.
//
//   ROLE_OPTIONS='{"source":"guild"}' bun speedrun/helpers/grapes.ts <account>
//
// Every start reads where the account is and what it has and resumes from there
// (situation / choosePhase): a camper restarted at its spawn camps again, and a
// phase that works on the surface first climbs out of the hideout or the guild.
// A cycle that fails backs off (5, 10, 20 ... 200 ticks); five failures in a row
// log the phase 'stuck' until a cycle succeeds again.
//
// Options: source ('guild' | 'phoenix' | 'goblins'), cooking (Cooking level to train before
// camping, default 35), bankAt (grapes held before banking, default 26), fightLevel
// (Attack/Strength/Defence trained on chickens before goblins, default 10).
import type { BotSDK } from '../../sdk/index';
import type { BotWorldState, GroundItem, NearbyLoc, NearbyNpc } from '../../sdk/types';
import { advance } from '../lib/dialogue';
import { waitUntil } from '../lib/wait';
import type { Role, RoleContext } from './role';
import { runStandalone } from './role';
import {
    ITEM,
    checkAbort,
    closeBank,
    depositAllExcept,
    dismissDialogs,
    freeSlots,
    invCount,
    openBank,
    position,
    prepare,
    reportBank,
    skillLevel,
    tick,
    VARROCK_WEST_BANK,
    walkNear
} from './wine-common';

interface Tile {
    x: number;
    z: number;
}
interface Box {
    x1: number;
    z1: number;
    x2: number;
    z2: number;
}
const inBox = (b: Box, x: number, z: number) => x >= b.x1 && x <= b.x2 && z >= b.z1 && z <= b.z2;
const dist = (a: Tile, b: Tile) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

const DRAYNOR_BANK: Tile = { x: 3092, z: 3243 };
const LUMBRIDGE_GOBLINS: Box = { x1: 3236, z1: 3222, x2: 3266, z2: 3256 };
const LUMBRIDGE_GOBLINS_CENTRE: Tile = { x: 3250, z: 3238 };
const CHICKENS: Box = { x1: 3224, z1: 3286, x2: 3238, z2: 3302 };
const CHICKENS_CENTRE: Tile = { x: 3231, z: 3295 };
/**
 * The cooking pot in the house at the chicken pen (fireplacecookingpot, loc 2727,
 * m50_51.jm2): a cooking_fire that anyone may use. The Lumbridge castle range is the
 * Cook's and refuses anyone without Cook's Assistant (quest_cook.rs2).
 */
const CHICKEN_POT: Tile = { x: 3225, z: 3290 };
/** Locs that cook (cooking_fire / cooking_oven); "Cooking range" is the Cook's own and is excluded. */
const COOK_ON = /^(cooking pot|fire|fireplace|range)$/i;
/** Normal trees around the pen (m50_51.jm2 LOC 1276/1278), for a fallback fire. */
const TREES_NEAR_CHICKENS: Tile[] = [
    { x: 3230, z: 3279 },
    { x: 3213, z: 3287 },
    { x: 3212, z: 3297 },
    { x: 3236, z: 3317 }
];
const GOBLIN_VILLAGE: Box = { x1: 2940, z1: 3488, x2: 2972, z2: 3520 };
const GOBLIN_VILLAGE_CENTRE: Tile = { x: 2956, z: 3504 };
/** Falador west bank, the nearest to Goblin Village. */
const FALADOR_WEST_BANK: Tile = { x: 2946, z: 3368 };
/**
 * The guild's door (chefdoor, loc 2712) is on the south edge of (3143,3444), so
 * (3143,3443) is outside and (3143,3444) inside (m49_53.jm2). Spiral stairs
 * (3144,3447) lead to level 1, a ladder (3144,3446) to level 2.
 */
const GUILD_DOOR: Tile = { x: 3143, z: 3444 };
const GUILD_OUTSIDE: Tile = { x: 3143, z: 3443 };
const GUILD_INSIDE: Tile = { x: 3143, z: 3445 };
const GUILD_GROUND: Box = { x1: 3137, z1: 3444, x2: 3150, z2: 3455 };
/** The door is reached from the south-west, around the fence east of the guild (SDK route from Varrock west bank). */
const GUILD_APPROACH_SOUTH: Tile = { x: 3152, z: 3422 };
const GUILD_APPROACH_SW: Tile = { x: 3148, z: 3426 };
const GUILD_APPROACH_WEST: Tile = { x: 3142, z: 3436 };
/** The yard south-west of the guild, from which the door is a straight walk. */
const GUILD_WEST_YARD: Box = { x1: 3136, z1: 3427, x2: 3148, z2: 3443 };
/** Brick house east of the guild (m49_53.jm2 brickwall 1902) and its one door, on the east wall. */
const EAST_HOUSE: Box = { x1: 3149, z1: 3434, x2: 3155, z2: 3441 };
const EAST_HOUSE_DOOR = { x: 3155, z: 3438, id: 1533 };
const GUILD_GRAPES = { x: 3144, z: 3450, level: 2 };
/** The grape lies on bigtable (loc 594, m49_53.jm2 level 2, rotated over 3144,3449-3450); the camper stands west of it. */
const GUILD_STAND = { x: 3143, z: 3450, level: 2 };
/** The guild's upper floors, where every way out is the stairs and the ladder. */
const GUILD_FLOORS: Box = { x1: 3137, z1: 3444, x2: 3150, z2: 3455 };
const GUILD_JUG = { x: 3141, z: 3447, level: 2 };
const GUILD_SINK = { x: 3146, z: 3451 };
const GRAPE_RESPAWN_TICKS = 80;

// Phoenix Gang hideout (m50_152.jm2, underground) and the solo half of Shield of Arrav
// that opens its door (quest_blackarmgang.rs2 phoenixdoor: %phoenixgang >= joined).
const PHOENIX_GRAPES = { x: 3237, z: 9761, level: 0 };
/** The grapes lie on a table (loc 595) that blocks their tile; the camper stands just south. */
const PHOENIX_STAND = { x: 3237, z: 9762, level: 0 };
/** Ladder down (loc 1754, m50_52.jm2) in the VTAM building, south-east Varrock. */
const PHOENIX_LADDER_DOWN = { x: 3244, z: 3383, id: 1754 };
const PHOENIX_DOOR = { x: 3247, z: 9779, id: 2397 };
/**
 * The walled room around the spawn (oldwall_blackback, m50_152.jm2). It is only
 * reached through the members' door, so an account standing in it is a member.
 */
const PHOENIX_SPAWN_ROOM: Box = { x1: 3232, z1: 9760, x2: 3243, z2: 9773 };
/** The whole hideout map square: underground here, the only way up is the ladder. */
const PHOENIX_HIDEOUT: Box = { x1: 3200, z1: 9728, x2: 3263, z2: 9791 };
const VARROCK_EAST_BANK: Tile = { x: 3253, z: 3420 };
const RELDO: Tile = { x: 3209, z: 3495 };
/** questbookcase (loc 2402) in the palace library: op2 Search gives the book while the quest is started. */
const ARRAV_BOOKCASE = { x: 3212, z: 3493, id: 2402 };
const BARAEK: Tile = { x: 3218, z: 3435 };
/** Jonny the Beard in the Blue Moon Inn; he always drops the intelligence report. */
const BLUE_MOON_INN: Box = { x1: 3214, z1: 3390, x2: 3232, z2: 3404 };
const JONNY: Tile = { x: 3223, z: 3395 };
const ARRAV_BOOK = 757;
// Shows as "Scroll" on the ground and in the inventory (obj intelligence_report).
const INTELLIGENCE_REPORT = 761;
const underground = (p: { z: number }) => p.z > 9000;

/** A grape ground spawn and how to get to it and away from it. */
interface Spawn {
    name: string;
    tile: { x: number; z: number; level: number };
    /** Where the camper stands, when the spawn's own tile is not walkable. Defaults to `tile`. */
    stand?: { x: number; z: number; level: number };
    jug?: { x: number; z: number; level: number };
    bank: Tile;
    /** True when the account is in the spawn's building (and must leave before banking). */
    inside(): boolean;
    goTo(): Promise<void>;
    leave(): Promise<void>;
}

class NotPhoenixMember extends Error {
    constructor() {
        super('not a Phoenix Gang member yet');
    }
}

/** Tutorial kit pieces this role uses: weapon and shield worn, axe and tinderbox for a fallback fire. */
const STARTER_GEAR = /^(bronze sword|wooden shield|bronze axe|tinderbox)$/i;
const WEARABLE = /^(bronze sword|wooden shield|chef's hat)$/i;
const RAW_CHICKEN = 2138;
const COOKED_CHICKEN = 2140;
const FOOD = /^(cooked chicken|shrimps|bread)$/i;
/** Cooked chickens kept as food; the rest are dropped when the inventory fills. */
const KEEP_FOOD = 12;
/** Cooked chickens an account carries before it starts a fight phase. */
const MIN_FOOD = 6;
/** Worn-inventory slot of the weapon (wearpos right hand). */
const WEAPON_SLOT = 3;

export type Source = 'guild' | 'phoenix' | 'goblins';
export type Phase = 'camp-guild' | 'camp-phoenix' | 'fetch-kit' | 'chickens' | 'goblin-village' | 'phoenix-quest' | 'hat-hunt';

/** What the start of a cycle knows about the account: where it is and what it has. */
export interface Situation {
    source: Source;
    at: { x: number; z: number; level: number };
    cooking: number;
    /** Cooking the source needs before it gathers (the guild door's 32, or the wine maker's 35); 0 for the others. */
    cookTo: number;
    /** Attack, Strength and Defence all at the fight level. */
    combatOk: boolean;
    food: number;
    /** Chef's hat worn. */
    hat: boolean;
    /** A weapon worn, or the tutorial sword or shield carried. */
    armed: boolean;
    /** Jonny the Beard's intelligence report carried: the gang's door is one talk away. */
    report: boolean;
    /** Phoenix Gang membership: observed at the door, inferred from standing in the spawn room, or unknown. */
    phoenixMember: boolean | null;
}

export function inPhoenixSpawnRoom(p: { x: number; z: number; level: number }): boolean {
    return p.level === 0 && inBox(PHOENIX_SPAWN_ROOM, p.x, p.z);
}

/** Read the account's situation. `phoenixMember` is what this run has seen at the door (null before it has tried). */
export function situation(sdk: BotSDK, source: Source, opts: { cooking: number; fightLevel: number }, phoenixMember: boolean | null): Situation {
    const at = position(sdk);
    const equipment = sdk.getEquipment();
    const inventory = sdk.getInventory();
    return {
        source,
        at,
        cooking: skillLevel(sdk, 'Cooking'),
        cookTo: source === 'guild' ? Math.max(32, opts.cooking) : 0,
        combatOk: ['Attack', 'Strength', 'Defence'].every(s => skillLevel(sdk, s) >= opts.fightLevel),
        food: invCount(sdk, COOKED_CHICKEN),
        hat: equipment.some(e => e.id === ITEM.chefsHat),
        armed: equipment.some(e => e.slot === WEAPON_SLOT) || inventory.some(i => /^(bronze sword|wooden shield)$/i.test(i.name)),
        report: inventory.some(i => i.id === INTELLIGENCE_REPORT),
        phoenixMember: phoenixMember ?? (source === 'phoenix' && inPhoenixSpawnRoom(at) ? true : null)
    };
}

/**
 * The phase a cycle runs, from the situation alone, so a restart anywhere resumes.
 * Campers camp as soon as they can; only the phases that fight (chickens, the hat
 * hunt, goblins, Jonny the Beard) need the tutorial kit, food and the fight level.
 * A Phoenix account of unknown membership that can fight goes to the camp: the
 * gang's door decides (a refusal records it as not a member).
 */
export function choosePhase(s: Situation, kitTried: boolean): Phase {
    if (s.source === 'guild' && s.hat && s.cooking >= s.cookTo) return 'camp-guild';
    if (s.source === 'phoenix') {
        if (s.phoenixMember === true || (s.phoenixMember === null && s.combatOk)) return 'camp-phoenix';
        if (s.report) return 'phoenix-quest';
    }
    if (!s.armed && !kitTried) return 'fetch-kit';
    if (s.cooking < s.cookTo || !s.combatOk || s.food < MIN_FOOD) return 'chickens';
    if (s.source === 'goblins') return 'goblin-village';
    if (s.source === 'phoenix') return 'phoenix-quest';
    return 'hat-hunt';
}

/**
 * The npc to attack: one already fighting us (a restart mid-fight finishes it),
 * else the nearest idle one in the area.
 */
export function pickTarget(s: BotWorldState, npc: RegExp, area: Box): NearbyNpc | null {
    const c = s.nearbyNpcs.filter(n => npc.test(n.name) && n.hp !== 0 && inBox(area, n.x, n.z) && n.optionsWithIndex.some(o => /attack/i.test(o.text)) && n.reachable !== false);
    const onMe = c.filter(n => n.inCombat && n.distance <= 2 && s.player!.combat.inCombat);
    if (onMe.length) return onMe.sort((a, b) => a.distance - b.distance)[0]!;
    return c.filter(n => !n.inCombat).sort((a, b) => a.distance - b.distance)[0] ?? null;
}

/** Consecutive failed cycles before the role reports the phase 'stuck'. */
export const STUCK_AFTER = 5;
/** Ticks to wait after the n-th consecutive failed cycle: 5, 10, 20 ... capped at 200 (two minutes). */
export function retryDelayTicks(failures: number): number {
    return Math.min(200, 5 * 2 ** Math.max(0, failures - 1));
}

interface Stats {
    startedAt: number;
    kills: number;
    grapes: number;
    hats: number;
    jugs: number;
    /** Spawn watch: respawns seen, grapes others took, ticks from gone to visible again. */
    seen: number;
    takenByOthers: number;
    respawnGaps: number[];
}

function summary(s: Stats): Record<string, unknown> {
    const h = (Date.now() - s.startedAt) / 3_600_000;
    const gaps = s.respawnGaps.slice(-20);
    return {
        hours: Number(h.toFixed(3)),
        kills: s.kills,
        grapes: s.grapes,
        grapesPerHour: h > 0 ? Math.round(s.grapes / h) : 0,
        killsPerHour: h > 0 ? Math.round(s.kills / h) : 0,
        hats: s.hats,
        jugs: s.jugs,
        seen: s.seen,
        takenByOthers: s.takenByOthers,
        meanRespawnGap: gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : null
    };
}

class Gatherer {
    readonly s: Stats = { startedAt: Date.now(), kills: 0, grapes: 0, hats: 0, jugs: 0, seen: 0, takenByOthers: 0, respawnGaps: [] };
    constructor(readonly ctx: RoleContext) {}

    get sdk() {
        return this.ctx.sdk;
    }
    get bot() {
        return this.ctx.bot;
    }
    state(): BotWorldState {
        const s = this.sdk.getState();
        if (!s?.player) throw new Error('no world state');
        return s;
    }
    hpFrac(): number {
        const hp = this.sdk.getSkill('Hitpoints');
        return (hp?.level ?? 10) / Math.max(1, hp?.baseLevel ?? 10);
    }
    wearingHat(): boolean {
        return this.sdk.getEquipment().some(e => e.id === ITEM.chefsHat);
    }

    // ---- banking (Draynor for the Lumbridge phases, Varrock west for the guild) ----

    /** Bank everything but the hat, coins, starter kit and (with keepFood) the cooked chickens. */
    async bank(at: Tile, withdraw: RegExp | null = null, keepFood = true): Promise<void> {
        await walkNear(this.ctx, at.x, at.z, 4);
        await openBank(this.ctx, at);
        await depositAllExcept(this.sdk, i => i.id === ITEM.chefsHat || i.id === ITEM.coins || (keepFood && i.id === COOKED_CHICKEN) || STARTER_GEAR.test(i.name));
        if (withdraw) {
            for (const item of this.sdk.getBankItems().filter(i => withdraw.test(i.name))) {
                if (this.sdk.getInventory().some(i => i.id === item.id) || this.sdk.getEquipment().some(e => e.id === item.id)) continue;
                await this.bot.withdrawItem(item, 1);
            }
        }
        const hat = this.sdk.getBankItems().find(i => i.id === ITEM.chefsHat);
        if (hat && !this.wearingHat()) await this.bot.withdrawItem(hat, 1);
        reportBank(this.ctx);
        this.ctx.log('banked', {
            grapesInBank: this.sdk.getBankItems().find(i => i.id === ITEM.grapes)?.count ?? 0,
            jugsOfWaterInBank: this.sdk.getBankItems().find(i => i.id === ITEM.jugWater)?.count ?? 0,
            ...summary(this.s)
        });
        await closeBank(this.bot, this.sdk);
        for (const item of this.sdk.getInventory().filter(i => WEARABLE.test(i.name))) await this.bot.equipItem(item);
    }

    // ---- fighting (a compact version of bones.ts's loop) ----

    /** Kill one npc in `area` and loot items matching `loot` within 2 tiles of it. */
    async fightOne(npc: RegExp, area: Box, centre: Tile, loot: RegExp): Promise<'killed' | 'none' | 'lost' | 'low'> {
        if (this.hpFrac() < 0.4) return 'low';
        const p = position(this.sdk);
        if (!inBox(area, p.x, p.z)) {
            await walkNear(this.ctx, centre.x, centre.z, 4);
            return 'none';
        }
        const target = pickTarget(this.state(), npc, area);
        if (!target) {
            if (dist(p, centre) > 6) await walkNear(this.ctx, centre.x, centre.z, 4);
            else await this.sdk.waitForTicks(3);
            return 'none';
        }
        const atk = await this.bot.attack(target);
        if (!atk.success) {
            await this.sdk.waitForTicks(1);
            return 'lost';
        }
        let last: Tile = { x: target.tileX ?? target.x, z: target.tileZ ?? target.z };
        const deadline = Date.now() + 90_000;
        let idle = 0;
        while (Date.now() < deadline) {
            await this.sdk.waitForTicks(1);
            const s = this.state();
            if (s.player!.isDead) return 'lost';
            if (s.dialog.isOpen) await this.bot.dismissBlockingUI();
            const n = s.nearbyNpcs.find(x => x.index === target.index);
            if (!n) break;
            last = { x: n.tileX ?? n.x, z: n.tileZ ?? n.z };
            if (n.hp === 0) {
                for (let i = 0; i < 6 && this.state().nearbyNpcs.some(x => x.index === target.index); i++) await this.sdk.waitForTicks(1);
                break;
            }
            if (!s.player!.combat.inCombat && !n.inCombat) {
                if (++idle > 8) return 'lost';
            } else idle = 0;
            if (this.hpFrac() < 0.25) return 'low';
        }
        this.s.kills++;
        await this.loot(last, loot);
        return 'killed';
    }

    async loot(at: Tile, pattern: RegExp): Promise<void> {
        await this.sdk.waitForTicks(1);
        for (let pass = 0; pass < 5; pass++) {
            const g = (await this.sdk.scanGroundItems(5)).filter(x => pattern.test(x.name) && dist(x, at) <= 2)[0];
            if (!g) return;
            if (freeSlots(this.sdk) === 0 && !/^coins$/i.test(g.name)) return;
            const before = this.sdk.countInventoryItems(new RegExp(`^${g.name}$`, 'i'));
            await this.bot.pickupItem(g);
            const got = this.sdk.countInventoryItems(new RegExp(`^${g.name}$`, 'i')) - before;
            if (got <= 0) return;
            if (g.id === ITEM.grapes) this.s.grapes += got;
            if (g.id === ITEM.chefsHat) this.s.hats += got;
            this.ctx.log('loot', { item: g.name, count: got, kills: this.s.kills });
        }
    }

    food() {
        return this.sdk.getInventory().find(i => FOOD.test(i.name));
    }

    async rest(): Promise<void> {
        this.ctx.log('resting', { hp: Number(this.hpFrac().toFixed(2)), food: invCount(this.sdk, COOKED_CHICKEN) });
        while (!this.ctx.signal.aborted && this.hpFrac() < 0.9) {
            const food = this.food();
            if (food) await this.bot.eatFood(food);
            else await this.sdk.waitForTicks(10);
            await this.bot.dismissBlockingUI();
        }
    }

    /** Eat between fights rather than resting (hitpoints regenerate ~1 per 100 ticks). */
    async eatIfLow(): Promise<void> {
        if (this.hpFrac() >= 0.6) return;
        const food = this.food();
        if (food) await this.bot.eatFood(food);
    }

    /** Set the combat style to whichever melee stat is lowest. */
    async pickStyle(): Promise<void> {
        const cs = this.sdk.getState()?.combatStyle;
        if (!cs?.styles?.length) return;
        const want = (['Attack', 'Strength', 'Defence'] as const).reduce((a, b) => (skillLevel(this.sdk, b) < skillLevel(this.sdk, a) ? b : a));
        const style = cs.styles.find(s => s.trainsSkills.length === 1 && s.trainsSkills[0] === want);
        if (style && cs.currentStyle !== style.index) await this.sdk.sendSetCombatStyle(style.index);
    }

    /** The tutorial kit (bronze sword, wooden shield) is banked by skipTutorial: fetch and wear it once. */
    async ensureKit(): Promise<boolean> {
        if (this.sdk.getEquipment().some(e => e.slot === WEAPON_SLOT)) return true;
        const inInv = this.sdk.getInventory().filter(i => /^(bronze sword|wooden shield)$/i.test(i.name));
        if (inInv.length) {
            for (const i of inInv) await this.bot.equipItem(i);
            return true;
        }
        if (this.kitTried) return true;
        this.kitTried = true;
        await this.bank(DRAYNOR_BANK, STARTER_GEAR);
        return false;
    }
    kitTried = false;
    treeIndex = 0;

    /**
     * Kill the chickens at the pen and cook them on the pot there: trains melee and
     * Cooking together, and the cooked chickens are the food for later fights.
     */
    async chickens(): Promise<void> {
        const raw = invCount(this.sdk, RAW_CHICKEN);
        if (raw > 0 && (freeSlots(this.sdk) === 0 || raw >= 18)) {
            await this.cookAll();
            return;
        }
        if (freeSlots(this.sdk) === 0) {
            for (const i of this.sdk.getInventory().filter(i => /^(burnt chicken|bones|feather)$/i.test(i.name))) await this.bot.dropItem(i, 'all');
            const extra = invCount(this.sdk, COOKED_CHICKEN) - KEEP_FOOD;
            if (extra > 0) await this.bot.dropItem(/^cooked chicken$/i, extra);
            // Still full: the rest of the tutorial kit (net, pot, runes...) goes to the bank.
            if (freeSlots(this.sdk) === 0) await this.bank(DRAYNOR_BANK);
            return;
        }
        await this.pickStyle();
        const r = await this.fightOne(/^chicken$/i, CHICKENS, CHICKENS_CENTRE, /^raw chicken$/i);
        if (r === 'low') await this.rest();
        if (r === 'killed' && this.s.kills % 20 === 0) this.ctx.log('chickens', { cooking: skillLevel(this.sdk, 'Cooking'), att: skillLevel(this.sdk, 'Attack'), str: skillLevel(this.sdk, 'Strength'), def: skillLevel(this.sdk, 'Defence'), food: invCount(this.sdk, COOKED_CHICKEN), ...summary(this.s) });
    }

    // ---- phase: chef's hat from Lumbridge goblins ----

    async getHat(): Promise<void> {
        const hat = this.sdk.getInventory().find(i => i.id === ITEM.chefsHat);
        if (hat) {
            await this.bot.equipItem(hat);
            return;
        }
        await this.eatIfLow();
        await this.pickStyle();
        const r = await this.fightOne(/^goblin$/i, LUMBRIDGE_GOBLINS, LUMBRIDGE_GOBLINS_CENTRE, /^(chef's hat|coins)$/i);
        if (r === 'low') await this.rest();
        if (this.s.kills % 20 === 0 && r === 'killed') this.ctx.log('hat hunt', summary(this.s));
    }

    // ---- cooking ----

    /** Cook every raw chicken, one use per chicken (cooking.rs2: p_delay(1) per item). */
    async cookAll(): Promise<void> {
        let stall = 0;
        while (invCount(this.sdk, RAW_CHICKEN) > 0 && stall < 6) {
            checkAbort(this.ctx);
            const source = await this.cookSource();
            if (!source) {
                stall++;
                continue;
            }
            const before = invCount(this.sdk, RAW_CHICKEN);
            await this.bot.useItemOnLoc(/^raw chicken$/i, source);
            const ok = await this.sdk.waitForCondition(() => invCount(this.sdk, RAW_CHICKEN) < before, 8_000).then(() => true, () => false);
            if (!ok) this.ctx.log('cook not accepted', { on: source.name, at: { x: source.x, z: source.z }, dialog: this.sdk.getState()?.dialog.text ?? null });
            stall = ok ? 0 : stall + 1;
            await this.bot.dismissBlockingUI();
        }
        for (const i of this.sdk.getInventory().filter(i => /^(burnt chicken|bones|feather)$/i.test(i.name))) await this.bot.dropItem(i, 'all');
        const extra = invCount(this.sdk, COOKED_CHICKEN) - KEEP_FOOD;
        if (extra > 0) await this.bot.dropItem(/^cooked chicken$/i, extra);
        this.ctx.log('cooked', { cooking: this.sdk.getSkill('Cooking') });
    }

    /** The nearest loc that cooks: the pen's cooking pot, else a fire of our own. */
    async cookSource(): Promise<NearbyLoc | null> {
        const nearest = async (r: number) => (await this.sdk.scanNearbyLocs(r)).filter(l => COOK_ON.test(l.name)).sort((a, b) => a.distance - b.distance)[0] ?? null;
        const here = await nearest(12);
        if (here) return here;
        if (dist(position(this.sdk), CHICKEN_POT) > 3) {
            await walkNear(this.ctx, CHICKEN_POT.x + 1, CHICKEN_POT.z, 2);
            const pot = await nearest(12);
            if (pot) return pot;
        }
        this.ctx.log('no cooking pot in sight; lighting a fire', { at: position(this.sdk) });
        return this.fire();
    }

    /** A burning fire within 4 tiles, lighting one from fresh logs if there is none. */
    async fire(): Promise<NearbyLoc | null> {
        const near = (await this.sdk.scanNearbyLocs(6)).filter(l => /^fire$/i.test(l.name) && l.distance <= 4).sort((a, b) => a.distance - b.distance)[0];
        if (near) return near;
        if (!this.sdk.findInventoryItem(/^tinderbox$/i) || !this.sdk.findInventoryItem(/^bronze axe$/i)) {
            this.kitTried = false;
            await this.bank(DRAYNOR_BANK, STARTER_GEAR);
            return null;
        }
        if (!this.sdk.findInventoryItem(/^logs$/i)) {
            if (freeSlots(this.sdk) === 0) await this.bot.dropItem(/^(bones|feather|burnt chicken)$/i, 'all');
            if (!this.sdk.findNearbyLoc(/^tree$/i)) {
                const t = TREES_NEAR_CHICKENS[this.treeIndex++ % TREES_NEAR_CHICKENS.length]!;
                await walkNear(this.ctx, t.x, t.z + 2, 2);
            }
            const t = await this.bot.chopTree(/^tree$/i);
            if (!t.success) {
                this.ctx.log('chop failed', { detail: t.message, at: position(this.sdk) });
                const next = TREES_NEAR_CHICKENS[this.treeIndex++ % TREES_NEAR_CHICKENS.length]!;
                await walkNear(this.ctx, next.x, next.z + 2, 2);
                await this.sdk.waitForTicks(2);
                return null;
            }
        }
        const b = await this.bot.burnLogs(/^logs$/i);
        if (!b.success) {
            // Some tiles refuse a fire; step aside and retry next call.
            this.ctx.log('light failed', { detail: b.message });
            const p = position(this.sdk);
            await this.bot.walkTo(p.x + 2, p.z + 1, 0);
            await this.sdk.waitForTicks(2);
            return null;
        }
        await this.sdk.waitForTicks(1);
        return (await this.sdk.scanNearbyLocs(4)).filter(l => /^fire$/i.test(l.name)).sort((a, c) => a.distance - c.distance)[0] ?? null;
    }

    // ---- phase: camp the Cooking Guild spawn ----

    async climb(up: boolean): Promise<void> {
        const want = position(this.sdk).level + (up ? 1 : -1);
        for (let attempt = 0; attempt < 4 && position(this.sdk).level !== want; attempt++) {
            const opt = up ? /climb-up|climb up/i : /climb-down|climb down/i;
            const loc = (await this.sdk.scanNearbyLocs(10))
                .filter(l => /stair|ladder/i.test(l.name) && l.optionsWithIndex.some(o => opt.test(o.text) || /^climb$/i.test(o.text)))
                .sort((a, b) => a.distance - b.distance)[0];
            if (!loc) throw new Error(`no stairs ${up ? 'up' : 'down'} near ${JSON.stringify(position(this.sdk))}`);
            const o = loc.optionsWithIndex.find(x => opt.test(x.text)) ?? loc.optionsWithIndex.find(x => /^climb$/i.test(x.text))!;
            await this.bot.interactLoc(loc, o.text);
            for (let i = 0; i < 10 && position(this.sdk).level !== want; i++) {
                const d = this.sdk.getState()?.dialog;
                if (d?.isOpen && d.options.length) await this.sdk.clickDialogByText(up ? /up/i : /down/i);
                await this.sdk.waitForTicks(1);
            }
        }
        if (position(this.sdk).level !== want) throw new Error(`climb ${up ? 'up' : 'down'} failed`);
    }

    /** Inside the house east of the guild: open its only door (east wall) and step out. */
    async escapeHouse(): Promise<void> {
        const p = position(this.sdk);
        if (p.level !== 0 || !inBox(EAST_HOUSE, p.x, p.z)) return;
        this.ctx.log('in the house east of the guild; opening its door', { at: p });
        await this.sdk.sendInteractLoc(EAST_HOUSE_DOOR.x, EAST_HOUSE_DOOR.z, EAST_HOUSE_DOOR.id, 1);
        await this.sdk.waitForTicks(8);
        await this.sdk.sendWalk(EAST_HOUSE_DOOR.x + 2, EAST_HOUSE_DOOR.z);
        await this.sdk.waitForTicks(8);
        this.ctx.log('house escape', { now: position(this.sdk) });
    }

    /**
     * Walk to a tile. The SDK's offline collision map can leave a tile with no route
     * out (it happened on the strip east of the guild, x 3149+, z 3428-3441), so on
     * failure send raw walks and let the server's pathfinder move us (first toward the
     * target, then via the approach south-west of the guild), then retry.
     */
    async walkOrOpen(t: Tile, tolerance: number): Promise<void> {
        try {
            await walkNear(this.ctx, t.x, t.z, tolerance);
            return;
        } catch (e) {
            this.ctx.log('walk blocked; trying server-side walks', { to: t, at: position(this.sdk) });
        }
        for (const step of [t, GUILD_APPROACH_SOUTH, GUILD_APPROACH_WEST, t]) {
            const from = position(this.sdk);
            await this.sdk.sendWalk(step.x, step.z);
            await this.sdk.waitForTicks(12);
            this.ctx.log('server walk', { to: step, from, now: position(this.sdk) });
            try {
                await walkNear(this.ctx, t.x, t.z, tolerance);
                return;
            } catch {
                // keep stepping
            }
        }
        throw new Error(`could not reach ${t.x},${t.z} from ${JSON.stringify(position(this.sdk))}`);
    }

    async enterGuild(): Promise<void> {
        await this.escapeHouse();
        // Go round by the south-west: a direct walk from Varrock routes through the
        // house east of the guild, whose door can be shut behind us.
        const start = position(this.sdk);
        if (!inBox(GUILD_WEST_YARD, start.x, start.z)) {
            for (const w of [GUILD_APPROACH_SOUTH, GUILD_APPROACH_SW, GUILD_APPROACH_WEST]) await this.walkOrOpen(w, 2);
        }
        await this.walkOrOpen(GUILD_OUTSIDE, 0);
        // The door script (cooking_guild.rs2, open_and_close_door) moves the player
        // through and swaps the door for an invisible wall while it swings, also when
        // another player passes. So the entry is gated on being inside, not on the door
        // looking open; a door that is mid-swing is waited out and asked again.
        const inside = (s: BotWorldState) => !!s.player && s.player.level === 0 && inBox(GUILD_GROUND, s.player.worldX, s.player.worldZ);
        for (let attempt = 0; attempt < 5; attempt++) {
            if (inside(this.state())) break;
            const door = (await this.sdk.scanNearbyLocs(4)).find(l => l.x === GUILD_DOOR.x && l.z === GUILD_DOOR.z && /door/i.test(l.name));
            const open = door?.optionsWithIndex.find(o => /^open$/i.test(o.text));
            if (!door || !open) {
                await this.sdk.waitForTicks(2);
                continue;
            }
            await this.sdk.sendInteractLoc(door.x, door.z, door.id, open.opIndex);
            const r = await waitUntil(this.sdk, s => inside(s) || s.dialog.isOpen, { maxTicks: 8 });
            if (r.ok && !inside(r.state)) {
                const said = r.state.dialog.text ?? '';
                await this.bot.dismissBlockingUI();
                throw new Error(`guild door refused: ${said} (Cooking ${skillLevel(this.sdk, 'Cooking')}, hat ${this.wearingHat()})`);
            }
        }
        if (!inside(this.state())) throw new Error(`could not enter the guild from ${JSON.stringify(position(this.sdk))}`);
        await this.bot.walkTo(GUILD_INSIDE.x, GUILD_INSIDE.z, 0);
    }

    async goToSpawn(): Promise<void> {
        let p = position(this.sdk);
        if (p.level === 0) {
            if (!inBox(GUILD_GROUND, p.x, p.z)) await this.enterGuild();
            await this.climb(true);
            p = position(this.sdk);
        }
        if (p.level === 1) await this.climb(true);
        const w = await this.bot.walkTo(GUILD_STAND.x, GUILD_STAND.z, 0);
        if (!w.success) throw new Error(`guild: could not reach the stand tile: ${w.message}`);
    }

    /** Out of the hideout or down out of the guild, for a phase that works on the surface. */
    async toSurface(): Promise<void> {
        const p = position(this.sdk);
        if (underground(p) && inBox(PHOENIX_HIDEOUT, p.x, p.z)) await this.leaveHideout();
        else if (p.level > 0 && inBox(GUILD_FLOORS, p.x, p.z)) await this.leaveGuild();
    }

    async leaveGuild(): Promise<void> {
        while (position(this.sdk).level > 0) await this.climb(false);
        if (invCount(this.sdk, ITEM.jugEmpty) > 0) {
            await walkNear(this.ctx, GUILD_SINK.x, GUILD_SINK.z, 2);
            const sink = (await this.sdk.scanNearbyLocs(6)).find(l => /^sink$/i.test(l.name));
            while (sink && invCount(this.sdk, ITEM.jugEmpty) > 0) {
                const before = invCount(this.sdk, ITEM.jugEmpty);
                await this.bot.useItemOnLoc(/^jug$/i, sink);
                if (!(await this.sdk.waitForCondition(() => invCount(this.sdk, ITEM.jugEmpty) < before, 3_000).then(() => true, () => false))) break;
            }
        }
        const door = (await this.sdk.scanNearbyLocs(6)).find(l => l.x === GUILD_DOOR.x && l.z === GUILD_DOOR.z && /door/i.test(l.name));
        if (door?.optionsWithIndex.some(o => /^open$/i.test(o.text))) {
            await this.bot.walkTo(GUILD_DOOR.x, GUILD_DOOR.z, 0);
            await this.bot.openDoor(door);
        }
        await walkNear(this.ctx, GUILD_OUTSIDE.x, GUILD_OUTSIDE.z, 1);
    }

    groundAt(t: { x: number; z: number }, id: number): GroundItem | undefined {
        return this.state().groundItems.find(g => g.id === id && g.x === t.x && g.z === t.z);
    }

    readonly guild: Spawn = {
        name: 'guild',
        tile: GUILD_GRAPES,
        stand: GUILD_STAND,
        jug: GUILD_JUG,
        bank: VARROCK_WEST_BANK,
        inside: () => position(this.sdk).level > 0,
        goTo: () => this.goToSpawn(),
        leave: () => this.leaveGuild()
    };

    readonly phoenix: Spawn = {
        name: 'phoenix',
        tile: PHOENIX_GRAPES,
        stand: PHOENIX_STAND,
        bank: VARROCK_EAST_BANK,
        inside: () => underground(position(this.sdk)),
        goTo: () => this.enterHideout(),
        leave: () => this.leaveHideout()
    };

    async camp(bankAt: number, spawn: Spawn = this.guild): Promise<void> {
        if (invCount(this.sdk, ITEM.grapes) >= bankAt || freeSlots(this.sdk) <= 1) {
            if (spawn.inside()) await spawn.leave();
            await this.bank(spawn.bank, null, false);
            return;
        }
        const p = position(this.sdk);
        if (p.level !== spawn.tile.level || dist(p, spawn.tile) > 4 || (spawn.name === 'phoenix' && !underground(p))) {
            await spawn.goTo();
            return;
        }
        const spot = spawn.tile;
        const stand = spawn.stand ?? spot;
        // The spawn is a race (other players camp it too): stand on (or by) the spawn, watch
        // every tick from shortly before the respawn is due, and send the pickup packet
        // the tick the grape appears. The jug spawn is only visited when no grape is due.
        const onSpawn = () => {
            const q = position(this.sdk);
            return q.x === stand.x && q.z === stand.z && q.level === stand.level;
        };
        // A walk to the stand that fails throws, so the cycle backs off instead of re-walking every tick.
        const toStand = async () => {
            const w = await this.bot.walkTo(stand.x, stand.z, 0);
            if (!w.success) throw new Error(`${spawn.name}: could not reach the stand tile ${stand.x},${stand.z}: ${w.message}`);
        };
        if (!onSpawn()) await toStand();
        this.ctx.log('camping', { spawn: spawn.name, at: position(this.sdk), grapesHeld: invCount(this.sdk, ITEM.grapes), freeSlots: freeSlots(this.sdk) });
        let lastGone = tick(this.sdk);
        let visibleSince = -1;
        while (invCount(this.sdk, ITEM.grapes) < bankAt && freeSlots(this.sdk) > 1) {
            checkAbort(this.ctx);
            await dismissDialogs(this.bot, this.sdk);
            const since = tick(this.sdk) - lastGone;
            const due = since >= GRAPE_RESPAWN_TICKS - 15;
            const g = this.groundAt(spot, ITEM.grapes);
            if (g) {
                if (visibleSince < 0) {
                    visibleSince = tick(this.sdk);
                    this.s.seen++;
                    this.s.respawnGaps.push(visibleSince - lastGone);
                }
                const before = invCount(this.sdk, ITEM.grapes);
                await this.sdk.sendPickup(g.x, g.z, g.id);
                await waitUntil(this.sdk, () => invCount(this.sdk, ITEM.grapes) > before || !this.groundAt(spot, ITEM.grapes), { maxTicks: 4 });
                const got = invCount(this.sdk, ITEM.grapes) - before;
                if (got > 0) {
                    this.s.grapes += got;
                    this.ctx.log('grape', { held: invCount(this.sdk, ITEM.grapes), taken: this.s.grapes, seen: this.s.seen, takenByOthers: this.s.takenByOthers });
                    if (this.s.grapes % 10 === 0) this.ctx.log('grapes', summary(this.s));
                } else if (!this.groundAt(spot, ITEM.grapes)) this.s.takenByOthers++;
                else continue; // still there: our packet did not land yet, try again
                lastGone = tick(this.sdk);
                visibleSince = -1;
                continue;
            }
            if (visibleSince >= 0) {
                // vanished between two looks without our pickup
                this.s.takenByOthers++;
                lastGone = tick(this.sdk);
                visibleSince = -1;
            }
            const jug = spawn.jug ? this.groundAt(spawn.jug, ITEM.jugEmpty) : undefined;
            if (!due && jug && freeSlots(this.sdk) > 2) {
                const before = invCount(this.sdk, ITEM.jugEmpty);
                await this.bot.pickupItem(jug);
                this.s.jugs += invCount(this.sdk, ITEM.jugEmpty) - before;
                await toStand();
                continue;
            }
            if (!onSpawn() && !due) await toStand();
            await this.sdk.waitForTicks(due ? 1 : Math.min(5, GRAPE_RESPAWN_TICKS - 15 - since));
        }
    }

    // ---- the Phoenix Gang hideout spawn ----

    phoenixMember: boolean | null = null;

    async enterHideout(): Promise<void> {
        if (!underground(position(this.sdk))) {
            await walkNear(this.ctx, PHOENIX_LADDER_DOWN.x, PHOENIX_LADDER_DOWN.z, 2);
            const ladder = (await this.sdk.scanNearbyLocs(6)).find(l => l.id === PHOENIX_LADDER_DOWN.id || (l.x === PHOENIX_LADDER_DOWN.x && l.z === PHOENIX_LADDER_DOWN.z));
            if (ladder) await this.bot.interactLoc(ladder, /climb-down|climb down|climb/i);
            else await this.sdk.sendInteractLoc(PHOENIX_LADDER_DOWN.x, PHOENIX_LADDER_DOWN.z, PHOENIX_LADDER_DOWN.id, 1);
            const down = await waitUntil(this.sdk, s => (s.player?.worldZ ?? 0) > 9000, { maxTicks: 20 });
            if (!down.ok) throw new Error(`could not climb down into the hideout from ${JSON.stringify(position(this.sdk))}`);
        }
        // Through the gang's door (open only to members), then to the spawn.
        const reach = await this.bot.walkTo(PHOENIX_STAND.x, PHOENIX_STAND.z, 0);
        if (dist(position(this.sdk), PHOENIX_GRAPES) <= 1) {
            this.phoenixMember = true;
            return;
        }
        await walkNear(this.ctx, PHOENIX_DOOR.x - 1, PHOENIX_DOOR.z + 1, 1).catch(() => {});
        await this.sdk.sendInteractLoc(PHOENIX_DOOR.x, PHOENIX_DOOR.z, PHOENIX_DOOR.id, 1);
        await this.sdk.waitForTicks(4);
        if (this.sdk.getState()?.dialog.isOpen) {
            // Straven stopped us: not a member.
            await this.bot.dismissBlockingUI();
            this.phoenixMember = false;
            throw new NotPhoenixMember();
        }
        await this.bot.walkTo(PHOENIX_STAND.x, PHOENIX_STAND.z, 0);
        if (dist(position(this.sdk), PHOENIX_GRAPES) > 1) throw new Error(`hideout: could not reach the spawn (${reach.message})`);
        this.phoenixMember = true;
    }

    async leaveHideout(): Promise<void> {
        await this.bot.walkTo(PHOENIX_LADDER_DOWN.x, 9783, 1);
        const up = (await this.sdk.scanNearbyLocs(8)).find(l => /ladder/i.test(l.name) && l.optionsWithIndex.some(o => /climb/i.test(o.text)));
        if (up) await this.bot.interactLoc(up, /climb-up|climb up|climb/i);
        const r = await waitUntil(this.sdk, s => (s.player?.worldZ ?? 0) < 9000, { maxTicks: 20 });
        if (!r.ok) throw new Error('could not climb out of the hideout');
    }

    /**
     * Talk to an npc and walk its dialogue: on a choice page take the first option
     * matching one of `prefer` (in the option list's order), else the last option
     * (an exit such as "Why not?"); continue pages are clicked through.
     */
    async converse(npc: RegExp, prefer: RegExp[]): Promise<string[]> {
        const said: string[] = [];
        const t = await this.bot.talkTo(npc);
        if (!t.success) throw new Error(`talk to ${npc}: ${t.message}`);
        const choose = new RegExp(prefer.map(p => p.source).join('|'), 'i');
        for (let i = 0; i < 60; i++) {
            const r = await advance(this.sdk, { choose, maxTicks: 6 });
            if (!r.ok && r.reason === 'no fresh page' && !this.sdk.getState()?.dialog.isOpen) break;
            if (r.text) said.push(r.text.slice(0, 120));
            if (!r.ok && r.kind === 'choice') {
                const opts = this.sdk.getState()?.dialog.options ?? [];
                const last = opts[opts.length - 1];
                if (last) await this.sdk.sendClickDialog(last.index);
                await this.sdk.waitForTicks(1);
            }
        }
        this.ctx.log('conversation', { npc: npc.source, said: said.slice(-6) });
        return said;
    }

    /**
     * Join the Phoenix Gang: the solo first half of Shield of Arrav. Every step is safe
     * to repeat (the quest options only appear at their stage), so a restart replays
     * the chain from the top; the intelligence report in the inventory skips to the end.
     */
    async joinPhoenixGang(): Promise<void> {
        const { sdk, bot } = this;
        const report = () => sdk.getInventory().some(i => i.id === INTELLIGENCE_REPORT);
        if (!report()) {
            if (invCount(sdk, ITEM.coins) < 20) {
                await walkNear(this.ctx, VARROCK_WEST_BANK.x, VARROCK_WEST_BANK.z, 3);
                await openBank(this.ctx);
                const c = sdk.getBankItems().find(i => i.id === ITEM.coins);
                if (c) await bot.withdrawItem(c, -1);
                await closeBank(bot, sdk);
                if (invCount(sdk, ITEM.coins) < 20) throw new Error('Phoenix route: Baraek wants 20 coins and there are not 20');
            }
            if (underground(position(sdk))) await this.leaveHideout();
            await walkNear(this.ctx, RELDO.x, RELDO.z, 3);
            await this.converse(/^reldo$/i, [/in search of a quest/, /what do you do/]);
            // The book shows in the inventory as "Book" (obj the_shield_of_arrav), so match its id.
            if (!sdk.getInventory().some(i => i.id === ARRAV_BOOK)) {
                await sdk.sendInteractLoc(ARRAV_BOOKCASE.x, ARRAV_BOOKCASE.z, ARRAV_BOOKCASE.id, 2);
                await waitUntil(sdk, s => s.inventory.some(i => i.id === ARRAV_BOOK), { maxTicks: 15 });
                await bot.dismissBlockingUI();
            }
            const book = sdk.getInventory().find(i => i.id === ARRAV_BOOK);
            if (book) {
                await sdk.sendUseItem(book.slot, 1);
                await sdk.waitForTicks(3);
                await bot.closeInterface().catch(() => undefined);
            }
            await this.converse(/^reldo$/i, [/what do you do/]);
            await walkNear(this.ctx, BARAEK.x, BARAEK.z, 3);
            await this.converse(/^baraek$/i, [/find the phoenix gang/, /have 20 gold coins/, /in search of a quest/]);
            await this.enterHideout().catch(e => {
                if (!(e instanceof NotPhoenixMember)) throw e;
            });
            if (this.phoenixMember) return;
            await this.converse(/^straven$/i, [/i know who you are/, /offer you my services/, /why not/]);
            await this.leaveHideout();
            // Kill Jonny the Beard for his report.
            for (let attempt = 0; attempt < 40 && !report(); attempt++) {
                checkAbort(this.ctx);
                await this.eatIfLow();
                const r = await this.fightOne(/^jonny the beard$/i, BLUE_MOON_INN, JONNY, /^scroll$/i);
                const jonny = sdk.getState()?.nearbyNpcs.filter(n => /jonny/i.test(n.name)).map(n => ({ x: n.x, z: n.z, hp: n.hp, inCombat: n.inCombat, reachable: n.reachable, options: n.optionsWithIndex.map(o => o.text) }));
                if (attempt % 5 === 0 || r === 'killed') this.ctx.log('jonny', { attempt, result: r, at: position(sdk), jonny, report: report() });
                if (r === 'low') await this.rest();
                if (r === 'none') await sdk.waitForTicks(5);
            }
            if (!report()) throw new Error('Phoenix route: no intelligence report from Jonny the Beard');
        }
        await this.enterHideout().catch(e => {
            if (!(e instanceof NotPhoenixMember)) throw e;
        });
        if (this.phoenixMember) return;
        await this.converse(/^straven$/i, [/intelligence report/]);
        // Straven keeps the report when he lets you join.
        if (!report()) this.phoenixMember = true;
        this.ctx.log('phoenix', { joined: !report() });
    }

    // ---- goblins: the drop-table source ----

    async goblins(bankAt: number): Promise<void> {
        if (freeSlots(this.sdk) <= 1 || invCount(this.sdk, ITEM.grapes) >= bankAt) {
            await this.bank(FALADOR_WEST_BANK);
            return;
        }
        await this.eatIfLow();
        await this.pickStyle();
        const r = await this.fightOne(/^goblin$/i, GOBLIN_VILLAGE, GOBLIN_VILLAGE_CENTRE, /^(grapes|coins|chef's hat)$/i);
        if (r === 'low') await this.rest();
        if (r === 'killed' && this.s.kills % 25 === 0) this.ctx.log('goblins', summary(this.s));
    }

    async runPhase(phase: Phase, bankAt: number): Promise<void> {
        switch (phase) {
            case 'camp-guild':
                return this.camp(bankAt, this.guild);
            case 'camp-phoenix':
                try {
                    await this.camp(bankAt, this.phoenix);
                } catch (e) {
                    if (!(e instanceof NotPhoenixMember)) throw e;
                }
                return;
            case 'phoenix-quest':
                return this.joinPhoenixGang();
        }
        await this.toSurface();
        if (!(await this.ensureKit())) return;
        switch (phase) {
            case 'fetch-kit':
                return;
            case 'chickens':
                return this.chickens();
            case 'goblin-village':
                return this.goblins(bankAt);
            case 'hat-hunt':
                return this.getHat();
        }
    }
}


export const role: Role = {
    name: 'grapes',
    produces: [/^grapes$/i, /^jug of water$/i],
    async run(ctx) {
        await prepare(ctx);
        const source = (typeof ctx.options.source === 'string' ? ctx.options.source : 'guild') as Source;
        const cooking = typeof ctx.options.cooking === 'number' ? ctx.options.cooking : 35;
        const bankAt = typeof ctx.options.bankAt === 'number' ? ctx.options.bankAt : 26;
        const fightLevel = typeof ctx.options.fightLevel === 'number' ? ctx.options.fightLevel : 10;
        if (!['guild', 'phoenix', 'goblins'].includes(source)) throw new Error(`grapes: unknown source '${source}'`);
        const g = new Gatherer(ctx);
        const first = situation(ctx.sdk, source, { cooking, fightLevel }, null);
        ctx.log('start', { source, at: first.at, cooking: first.cooking, hat: first.hat, armed: first.armed, food: first.food, phoenixMember: first.phoenixMember, equipment: ctx.sdk.getEquipment().map(e => `${e.slot}:${e.name}`) });
        let failures = 0;
        let stuck = false;
        let phase = '';
        const levels = () => Object.fromEntries(['Attack', 'Strength', 'Defence', 'Hitpoints', 'Cooking'].map(s => [s, skillLevel(ctx.sdk, s)]));
        const enter = (to: string, extra: Record<string, unknown> = {}) => {
            if (to !== phase) ctx.log('phase', { from: phase || null, to, ...extra, at: position(ctx.sdk), levels: levels(), hat: g.wearingHat(), ...summary(g.s) });
            phase = to;
        };
        while (!ctx.signal.aborted) {
            const cycleStart = tick(ctx.sdk);
            let next: Phase | null = null;
            try {
                await dismissDialogs(ctx.bot, ctx.sdk);
                if (ctx.sdk.isBankOpen() || ctx.sdk.getState()?.shop?.isOpen) await ctx.bot.closeInterface();
                const s = situation(ctx.sdk, source, { cooking, fightLevel }, g.phoenixMember);
                g.phoenixMember = s.phoenixMember;
                next = choosePhase(s, g.kitTried);
                // While stuck the phase stays 'stuck' until a cycle gets through.
                if (!stuck) enter(next);
                await g.runPhase(next, bankAt);
                if (stuck) {
                    stuck = false;
                    enter(next, { recoveredAfter: failures });
                }
                failures = 0;
                // A cycle that changed nothing must not spin the loop.
                if (tick(ctx.sdk) === cycleStart) await ctx.sdk.waitForTicks(1);
            } catch (e) {
                if (ctx.signal.aborted) break;
                failures++;
                const wait = retryDelayTicks(failures);
                ctx.log('cycle error', { error: String(e), errors: failures, phase: next, at: position(ctx.sdk), retryInTicks: wait });
                if (failures >= STUCK_AFTER && !stuck) {
                    stuck = true;
                    enter('stuck', { while: next, error: String(e) });
                }
                await ctx.sdk.waitForTicks(wait).catch(() => {});
            }
        }
        ctx.log('stopped', summary(g.s));
    }
};

if (import.meta.main) await runStandalone(role);
