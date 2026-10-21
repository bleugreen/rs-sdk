// Grape gatherer (cairn://p/rs/47; rates and shortfall math in docs/speedrun/helpers/wine.md).
// Grapes have no shop in this revision; the sources are two ground spawns and one
// rare drop:
//
//   guild    Cooking Guild top floor, (3144,3450) level 2: 1 grape, respawn 80 ticks
//            (wine.obj respawnrate=80), so at most ~135 an hour for one camper.
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
// Options: source ('guild' | 'goblins'), cooking (Cooking level to train before
// camping, default 35), bankAt (grapes held before banking, default 26), fightLevel
// (Attack/Strength/Defence trained on chickens before goblins, default 10).
import type { BotWorldState, GroundItem, NearbyLoc, NearbyNpc } from '../../sdk/types';
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
const GUILD_GRAPES = { x: 3144, z: 3450, level: 2 };
const GUILD_JUG = { x: 3141, z: 3447, level: 2 };
const GUILD_SINK = { x: 3146, z: 3451 };
const GRAPE_RESPAWN_TICKS = 80;

/** Tutorial kit pieces this role uses: weapon and shield worn, axe and tinderbox for a fallback fire. */
const STARTER_GEAR = /^(bronze sword|wooden shield|bronze axe|tinderbox)$/i;
const WEARABLE = /^(bronze sword|wooden shield|chef's hat)$/i;
const RAW_CHICKEN = 2138;
const COOKED_CHICKEN = 2140;
const FOOD = /^(cooked chicken|shrimps|bread)$/i;
/** Cooked chickens kept as food; the rest are dropped when the inventory fills. */
const KEEP_FOOD = 12;

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

    async bank(at: Tile, withdraw: RegExp | null = null): Promise<void> {
        await walkNear(this.ctx, at.x, at.z, 4);
        await openBank(this.ctx, at);
        await depositAllExcept(this.sdk, i => i.id === ITEM.chefsHat || i.id === ITEM.coins || i.id === COOKED_CHICKEN || STARTER_GEAR.test(i.name));
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

    pickTarget(npc: RegExp, area: Box): NearbyNpc | null {
        const s = this.state();
        const c = s.nearbyNpcs.filter(n => npc.test(n.name) && n.hp !== 0 && inBox(area, n.x, n.z) && n.optionsWithIndex.some(o => /attack/i.test(o.text)) && n.reachable !== false);
        const onMe = c.filter(n => n.inCombat && n.distance <= 2 && s.player!.combat.inCombat);
        if (onMe.length) return onMe.sort((a, b) => a.distance - b.distance)[0]!;
        return c.filter(n => !n.inCombat).sort((a, b) => a.distance - b.distance)[0] ?? null;
    }

    /** Kill one npc in `area` and loot items matching `loot` within 2 tiles of it. */
    async fightOne(npc: RegExp, area: Box, centre: Tile, loot: RegExp): Promise<'killed' | 'none' | 'lost' | 'low'> {
        if (this.hpFrac() < 0.4) return 'low';
        const p = position(this.sdk);
        if (!inBox(area, p.x, p.z)) {
            await walkNear(this.ctx, centre.x, centre.z, 4);
            return 'none';
        }
        const target = this.pickTarget(npc, area);
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

    combatLevelOk(level: number): boolean {
        return ['Attack', 'Strength', 'Defence'].every(s => skillLevel(this.sdk, s) >= level);
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
        if (this.sdk.getEquipment().some(e => /bronze sword/i.test(e.name))) return true;
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

    /** Walk to a tile; if no path exists (shut in behind a closed door), open the nearest door and retry once. */
    async walkOrOpen(t: Tile, tolerance: number): Promise<void> {
        try {
            await walkNear(this.ctx, t.x, t.z, tolerance);
        } catch (e) {
            const r = await this.bot.openDoor();
            this.ctx.log('walk blocked; opened a door', { to: t, at: position(this.sdk), door: r.message });
            await walkNear(this.ctx, t.x, t.z, tolerance);
        }
    }

    async enterGuild(): Promise<void> {
        await this.walkOrOpen(GUILD_OUTSIDE, 0);
        const door = (await this.sdk.scanNearbyLocs(4)).find(l => l.x === GUILD_DOOR.x && l.z === GUILD_DOOR.z && /door/i.test(l.name));
        if (door?.optionsWithIndex.some(o => /^open$/i.test(o.text))) {
            const r = await this.bot.openDoor(door);
            if (!r.success) throw new Error(`guild door: ${r.message} (Cooking ${skillLevel(this.sdk, 'Cooking')}, hat ${this.wearingHat()})`);
        }
        const w = await this.bot.walkTo(GUILD_INSIDE.x, GUILD_INSIDE.z, 0);
        const p = position(this.sdk);
        if (!inBox(GUILD_GROUND, p.x, p.z)) throw new Error(`could not enter the guild: ${w.message}`);
    }

    async goToSpawn(): Promise<void> {
        let p = position(this.sdk);
        if (p.level === 0) {
            if (!inBox(GUILD_GROUND, p.x, p.z)) await this.enterGuild();
            await this.climb(true);
            p = position(this.sdk);
        }
        if (p.level === 1) await this.climb(true);
        await this.bot.walkTo(GUILD_GRAPES.x, GUILD_GRAPES.z, 1);
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

    async camp(bankAt: number): Promise<void> {
        if (invCount(this.sdk, ITEM.grapes) >= bankAt || freeSlots(this.sdk) <= 1) {
            if (position(this.sdk).level > 0) await this.leaveGuild();
            await this.bank(VARROCK_WEST_BANK);
            return;
        }
        const p = position(this.sdk);
        if (p.level !== GUILD_GRAPES.level || dist(p, GUILD_GRAPES) > 4) {
            await this.goToSpawn();
            return;
        }
        // Watch the spawn tick by tick: take it when it appears, and note when someone else does.
        let lastGone = tick(this.sdk);
        let visibleSince = -1;
        while (invCount(this.sdk, ITEM.grapes) < bankAt && freeSlots(this.sdk) > 1) {
            checkAbort(this.ctx);
            await dismissDialogs(this.bot, this.sdk);
            const jug = this.groundAt(GUILD_JUG, ITEM.jugEmpty);
            if (jug && freeSlots(this.sdk) > 2) {
                const before = invCount(this.sdk, ITEM.jugEmpty);
                await this.bot.pickupItem(jug);
                this.s.jugs += invCount(this.sdk, ITEM.jugEmpty) - before;
            }
            const g = this.groundAt(GUILD_GRAPES, ITEM.grapes);
            if (g) {
                if (visibleSince < 0) {
                    visibleSince = tick(this.sdk);
                    this.s.seen++;
                    this.s.respawnGaps.push(visibleSince - lastGone);
                }
                const before = invCount(this.sdk, ITEM.grapes);
                const r = await this.bot.pickupItem(g);
                const got = invCount(this.sdk, ITEM.grapes) - before;
                if (got > 0) {
                    this.s.grapes += got;
                    if (this.s.grapes % 10 === 0) this.ctx.log('grapes', summary(this.s));
                } else if (r.reason === 'taken_by_other') this.s.takenByOthers++;
                lastGone = tick(this.sdk);
                visibleSince = -1;
            } else {
                if (visibleSince >= 0) {
                    // vanished without us taking it
                    this.s.takenByOthers++;
                    lastGone = tick(this.sdk);
                    visibleSince = -1;
                }
                const wait = Math.max(1, Math.min(5, GRAPE_RESPAWN_TICKS - (tick(this.sdk) - lastGone) - 2));
                await this.sdk.waitForTicks(wait);
            }
        }
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
}

export const role: Role = {
    name: 'grapes',
    produces: [/^grapes$/i, /^jug of water$/i],
    async run(ctx) {
        await prepare(ctx);
        const source = typeof ctx.options.source === 'string' ? ctx.options.source : 'guild';
        const cooking = typeof ctx.options.cooking === 'number' ? ctx.options.cooking : 35;
        const bankAt = typeof ctx.options.bankAt === 'number' ? ctx.options.bankAt : 26;
        const fightLevel = typeof ctx.options.fightLevel === 'number' ? ctx.options.fightLevel : 10;
        if (!['guild', 'goblins'].includes(source)) throw new Error(`grapes: unknown source '${source}'`);
        const g = new Gatherer(ctx);
        ctx.log('start', { source, cooking: ctx.sdk.getSkill('Cooking'), hat: g.wearingHat() });
        let errors = 0;
        let phase = '';
        const levels = () => Object.fromEntries(['Attack', 'Strength', 'Defence', 'Hitpoints', 'Cooking'].map(s => [s, skillLevel(ctx.sdk, s)]));
        const enter = (to: string) => {
            if (to !== phase) ctx.log('phase', { from: phase || null, to, levels: levels(), hat: g.wearingHat(), ...summary(g.s) });
            phase = to;
        };
        while (!ctx.signal.aborted) {
            try {
                await dismissDialogs(ctx.bot, ctx.sdk);
                if (ctx.sdk.isBankOpen() || ctx.sdk.getState()?.shop?.isOpen) await ctx.bot.closeInterface();
                const cookTo = source === 'guild' ? Math.max(32, cooking) : 0;
                const fightReady = g.combatLevelOk(fightLevel) && invCount(ctx.sdk, COOKED_CHICKEN) >= 6;
                if (source === 'guild' && g.wearingHat() && skillLevel(ctx.sdk, 'Cooking') >= cookTo) {
                    enter('camp-guild');
                    await g.camp(bankAt);
                } else if (!(await g.ensureKit())) {
                    enter('fetch-kit');
                } else if (skillLevel(ctx.sdk, 'Cooking') < cookTo || (!fightReady && (source === 'goblins' || !g.wearingHat()))) {
                    enter('chickens');
                    await g.chickens();
                } else if (source === 'goblins') {
                    enter('goblin-village');
                    await g.goblins(bankAt);
                } else {
                    enter('hat-hunt');
                    await g.getHat();
                }
                errors = 0;
            } catch (e) {
                if (ctx.signal.aborted) break;
                errors++;
                ctx.log('cycle error', { error: String(e), errors, at: position(ctx.sdk) });
                await ctx.sdk.waitForTicks(Math.min(60, 3 * errors)).catch(() => {});
            }
        }
        ctx.log('stopped', summary(g.s));
    }
};

if (import.meta.main) await runStandalone(role);
