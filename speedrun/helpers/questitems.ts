// Quest-item gatherer (cairn://p/rs/126): gathers and banks the tradeable items the
// scored account's quests take from helpers (docs/speedrun/SUPPLIES.md H4, H6, H12,
// H15, H16, H19, H20, H22; docs/speedrun/quests/README.md section 4).
//
//   ROLE_OPTIONS='{"set":"southwest"}' bun speedrun/helpers/questitems.ts <account>
//
// Every item comes from a task: a short errand (pick up a spawn, buy at a shop, pay
// an NPC through dialogue, mine, kill for a drop) whose targets are counts the
// account should HOLD, bank plus inventory. The loop reads its holdings at a bank,
// runs the first task in its set that is short and ready, and repeats, so a restart
// or a second run does only what is missing. Tasks are listed in route order, so a
// fresh account walks the set once. It stops when every target in the set is held.
//
// Errands overseas are reached by ship (speedrun/lib/ships.ts): the far set
// sails to Karamja and on to Kandarin, and the carp set does the same to reach
// the Hemenster fishing contest. Upstairs errands climb the nearest ladder or
// stairs.
//
// Options:
//   set    which errands this account runs (default 'southwest'; see SETS)
//   spare  gather a spare of each item where it is cheap (default true)
//   only   task ids to run (default: the whole set)
//   skip   task ids to leave out
//   coins  float carried for shops and NPC fees (default 400); below 100 the account
//          pickpockets Lumbridge men back up to it
//   counts held targets by item name that replace the tasks' own, for a bulk run of an
//          errand, e.g. {"only":["snapegrass"],"counts":{"Snape grass":102}}; a name no
//          selected task gathers is refused at start
import { resolveSkillDialogProduct } from '../../sdk/action-quantity';
import type { BotWorldState, NearbyLoc } from '../../sdk/types';
import { advance, classifyPage, resetDialogueMemory } from '../lib/dialogue';
import { CROSSING_HITPOINTS, crossingSettings, trainHitpointsOnCows } from '../lib/kandarin';
import { cross, crossingsBetween } from '../lib/passages';
import { FARE, regionOf, sailTo, voyagesBetween } from '../lib/ships';
import { isEastOfTollGate, travelTo } from '../lib/toll-gate';
import { waitUntil } from '../lib/wait';
import { Buyer, SHOPS, type Tile } from './buyer';
import { runStandalone, type Role, type RoleContext } from './role';
import { Aborted, checkAbort, closeBank, depositAllExcept, dismissDialogs, freeSlots, openBank, position, prepare, reportBank, walkNear } from './wine-common';

export interface Want {
    item: string;
    count: number;
}

export interface Task {
    id: string;
    /** What the task gathers, as held targets. Empty means nothing is needed right now. */
    makes(g: Gatherer): Want[];
    /** Inputs that must be held before the task can run (it is skipped until then). */
    ready?(g: Gatherer): boolean;
    /** Items to have in the inventory before `run` (withdrawn at the bank when short). */
    carry?(g: Gatherer): Want[];
    run(g: Gatherer): Promise<void>;
    /** The task fights: the set wields the tutorial's sword and shield before it leaves the first bank. */
    fights?: boolean;
    /** Items to bank before the task runs whenever any are carried. */
    stash?: string[];
}

/** A tile and the floor it is on; an upstairs place names the ground tile beside its ladder or stairs. */
export interface Place extends Tile {
    level?: number;
    via?: Tile;
}

/** Bank booths the loop uses, ground level only (Lumbridge's and the Gnome Stronghold's banks are upstairs). */
export const BANKS: Tile[] = [
    { x: 3092, z: 3245 }, // Draynor
    { x: 2946, z: 3369 }, // Falador west
    { x: 3013, z: 3356 }, // Falador east
    { x: 3185, z: 3436 }, // Varrock west
    { x: 3253, z: 3421 }, // Varrock east
    { x: 3094, z: 3491 }, // Edgeville
    { x: 2654, z: 3283 }, // Ardougne south
    { x: 2615, z: 3333 }, // Ardougne north
    { x: 2725, z: 3491 }, // Seers' Village
    { x: 2809, z: 3439 }, // Catherby
    { x: 2612, z: 3090 } // Yanille
];

/**
 * The bank to use from `here`: the nearest on this land mass, else the one fewest
 * voyages away (Karamja has none), nearest to where the last ship lands.
 */
export function nearestBank(here: Tile): Tile {
    const trip = (b: Tile) => voyagesBetween(regionOf(here), regionOf(b));
    const dist = (b: Tile) => cheb(b, trip(b).at(-1)?.lands ?? here);
    return [...BANKS].sort((a, b) => trip(a).length - trip(b).length || dist(a) - dist(b))[0]!;
}

/** Kept in the inventory across bank visits: the float and the tools tasks reuse. */
const KEEP = /^(coins|bronze pickaxe|bronze axe|tinderbox|bucket)$/i;
/** Tutorial food, eaten while pickpocketing. */
const FOOD = /^(shrimps|bread|cooked chicken|cooked meat|anchovies)$/i;

const norm = (s: string) => s.trim().toLowerCase();
/** A level want's item name, e.g. `Fishing level` (`levelWant`). */
const LEVEL = /^(\w+) level$/i;
const exact = (name: string) => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
const cheb = (a: Tile, b: Tile) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

export class Gatherer {
    /** Bank counts by lower-cased name, as of the last bank visit. */
    bank = new Map<string, number>();
    readonly buyer: Buyer;

    constructor(
        readonly ctx: RoleContext,
        readonly spare: boolean,
        readonly float: number,
        readonly counts: ReadonlyMap<string, number> = new Map()
    ) {
        this.buyer = new Buyer(ctx);
    }

    get bot() {
        return this.ctx.bot;
    }
    get sdk() {
        return this.ctx.sdk;
    }
    log(message: string, data?: Record<string, unknown>): void {
        this.ctx.log(message, data);
    }

    /** `base`, plus `extra` when gathering spares. */
    n(base: number, extra = 1): number {
        return this.spare ? base + extra : base;
    }
    /** The task the loop is running, with `counts` applied: the one source of its targets. */
    current: Task | null = null;
    /** The running task's held targets, read live (some depend on what is already held). */
    wants(): Want[] {
        if (!this.current) throw new Error('questitems: no task is running');
        return this.current.makes(this);
    }
    /** The running task's held target for `item`; 0 when it wants none. */
    target(item: string): number {
        return this.wants().find(w => norm(w.item) === norm(item))?.count ?? 0;
    }
    inv(name: string): number {
        return this.sdk.getInventory().reduce((a, i) => (norm(i.name) === norm(name) ? a + i.count : a), 0);
    }
    /** Bank plus inventory; for a level want (`levelWant`) the skill's base level. */
    held(name: string): number {
        const skill = LEVEL.exec(name)?.[1];
        if (skill) return this.level(skill);
        return (this.bank.get(norm(name)) ?? 0) + this.inv(name);
    }
    level(skill: string): number {
        return this.sdk.getSkill(skill)?.baseLevel ?? 1;
    }
    xp(skill: string): number {
        return this.sdk.getSkill(skill)?.experience ?? 0;
    }
    here(): Tile {
        const p = position(this.sdk);
        return { x: p.x, z: p.z };
    }

    async ticks(n: number): Promise<void> {
        await this.sdk.waitForTicks(n);
    }
    /** Wait up to `maxTicks` for `pred`; true when it held. */
    async until(pred: () => boolean, maxTicks: number): Promise<boolean> {
        return (await waitUntil(this.sdk, () => pred(), { maxTicks })).ok;
    }
    floor(): number {
        return position(this.sdk).level;
    }
    /** A bank on this land mass (Karamja has none, and reaching one means a voyage). */
    bankHere(): boolean {
        return regionOf(nearestBank(this.here())) === regionOf(this.here());
    }

    /** Walk to a place: down from upstairs, across the sea, up a ladder and through the toll gate as needed. */
    async walk(t: Place, tolerance = 3): Promise<void> {
        const level = t.level ?? 0;
        if (this.floor() > 0 && (this.floor() !== level || cheb(this.here(), t) > 40)) await this.climb('down');
        if (regionOf(this.here()) !== regionOf(t)) await this.sail(t);
        if (level > 0 && this.floor() === 0) {
            if (!t.via) throw new Error(`no way up to ${t.x},${t.z} (level ${level})`);
            await this.walk(t.via, 2);
            await this.climb('up', t.via);
        }
        if (this.floor() > 0) return this.walkOnFloor(t, tolerance);
        if (isEastOfTollGate(this.here()) !== isEastOfTollGate(t)) {
            const r = await travelTo(this.bot, this.sdk, t, { tolerance, log: (m, d) => this.log(m, d), signal: this.ctx.signal });
            if (!r.ok) throw new Error(`could not reach ${t.x},${t.z}: ${r.reason}`);
            return;
        }
        // Scripted gates and doors the walk cannot open (the Gnome Stronghold's), in order.
        const crosser = { bot: this.bot, sdk: this.sdk, log: (m: string, d?: Record<string, unknown>) => this.log(m, d), walk: (p: Tile) => walkNear(this.ctx, p.x, p.z, 1) };
        for (const c of crossingsBetween(this.here(), t) ?? []) await cross(crosser, c);
        await walkNear(this.ctx, t.x, t.z, tolerance);
    }

    /** Sail to `t`'s land mass; fares not carried come from a bank on this one, without banking what is carried. */
    private async sail(t: Tile): Promise<void> {
        const fares = voyagesBetween(regionOf(this.here()), regionOf(t)).length * FARE;
        if (this.inv('Coins') < fares) {
            if (!this.bankHere()) throw new Error(`${fares} coins needed to sail from ${JSON.stringify(this.here())}, and no bank here`);
            await this.atBank(() => this.setCoins(fares + FARE), false);
        }
        await sailTo({ bot: this.bot, sdk: this.sdk, log: (m, d) => this.log(m, d), walk: p => walkNear(this.ctx, p.x, p.z, 2) }, t);
    }

    /** Climb the nearest ladder or staircase (to `near`) one floor up or down. */
    async climb(dir: 'up' | 'down', near?: Tile): Promise<void> {
        const from = this.floor();
        // The grocers extend past the ladder's scan radius. Return to the central
        // landing before descending, including after a restart on that floor.
        const here = this.here();
        if (dir === 'down' && from === 1 && here.x >= 2440 && here.x <= 2505 && here.z >= 3480 && here.z <= 3520) {
            near = T.heckel.via;
            await this.walkOnFloor(near, 2);
        }
        const option = dir === 'up' ? /^climb[- ]up$/i : /^climb[- ]down$/i;
        for (let attempt = 0; attempt < 4 && this.floor() === from; attempt++) {
            checkAbort(this.ctx);
            const at = near ?? this.here();
            const loc = (await this.sdk.scanNearbyLocs(20))
                .filter(l => /ladder|stair/i.test(l.name) && l.optionsWithIndex.some(o => option.test(o.text)))
                .sort((a, b) => cheb(a, at) - cheb(b, at))[0];
            if (!loc) throw new Error(`no ladder or stairs ${dir} near ${at.x},${at.z}`);
            await this.bot.interactLoc(loc, option);
            await this.until(() => this.floor() !== from, 15);
        }
        if (this.floor() === from) throw new Error(`could not climb ${dir} at ${JSON.stringify(position(this.sdk))}`);
    }

    /** Plain pathfinding on an upper floor, where walkNear (ground level only) does not apply. */
    private async walkOnFloor(t: Tile, tolerance: number): Promise<void> {
        for (let attempt = 0; attempt < 4; attempt++) {
            if (cheb(this.here(), t) <= tolerance) return;
            const r = await this.bot.walkTo(t.x, t.z, tolerance, { timeout: 60_000 });
            if (r.success || cheb(this.here(), t) <= tolerance) return;
            this.log('walk retry', { to: t, level: this.floor(), detail: r.message });
            await this.ticks(3);
        }
        throw new Error(`could not walk to ${t.x},${t.z} on level ${this.floor()}`);
    }

    // ------------------------------------------------------------------ bank

    private readBank(): void {
        const m = new Map<string, number>();
        for (const i of this.sdk.getBankItems()) m.set(norm(i.name), (m.get(norm(i.name)) ?? 0) + i.count);
        this.bank = m;
    }

    /** Open the nearest bank (`nearestBank`), deposit everything but KEEP unless told not to, run `body`, report and close. */
    async atBank<T>(body: () => Promise<T> = async () => undefined as T, deposit = true): Promise<T> {
        const at = nearestBank(this.here());
        if (this.floor() > 0 || regionOf(at) !== regionOf(this.here()) || cheb(at, this.here()) > 12) await this.walk(at, 3);
        await openBank(this.ctx, at);
        try {
            if (deposit) await depositAllExcept(this.sdk, i => KEEP.test(i.name));
            this.readBank();
            const r = await body();
            this.readBank();
            return r;
        } finally {
            reportBank(this.ctx);
            await closeBank(this.bot, this.sdk);
        }
    }

    /** Withdraw up to `n` of an item; the bank must be open. Returns what arrived. */
    async withdraw(name: string, n: number): Promise<number> {
        const item = this.sdk.getBankItems().find(i => norm(i.name) === norm(name));
        if (!item || n <= 0) return 0;
        const before = this.inv(name);
        await this.bot.withdrawItem(item, Math.min(n, item.count), { asNote: false });
        await this.until(() => this.inv(name) > before, 4);
        // Let the bank state catch up: a withdrawal that empties a slot shifts the rest,
        // and the next withdrawal would otherwise address a stale slot.
        await this.ticks(1);
        this.readBank();
        return this.inv(name) - before;
    }

    /** Make the inventory carry `want` coins where the bank allows (bank open). */
    async setCoins(want: number): Promise<void> {
        const have = this.inv('Coins');
        if (have > want) await this.bot.depositItem(/^coins$/i, have - want);
        else if (have < want) await this.withdraw('Coins', want - have);
        await this.until(() => this.inv('Coins') !== have, 3);
    }

    // --------------------------------------------------------------- errands

    /** Pick up `item` from its ground spawns until `done`, waiting at the spawns for respawns. */
    async pickup(item: string, spots: Tile[], done: () => boolean, maxWaitTicks = 600): Promise<void> {
        const re = exact(item);
        let waited = 0;
        let missed = 0;
        while (!done()) {
            checkAbort(this.ctx);
            if (freeSlots(this.sdk) === 0) throw new Error('inventory full');
            let found = false;
            for (const spot of spots) {
                await this.walk(spot, 3);
                const g = (await this.sdk.scanGroundItems(8)).find(i => re.test(i.name) && cheb(i, spot) <= 1);
                if (!g) continue;
                found = true;
                const before = this.inv(item);
                const r = await this.bot.pickupItem(g);
                if (!(await this.until(() => this.inv(item) > before, 6))) {
                    this.log('pickup missed', { item, at: spot, detail: r.message });
                    // A spawn behind a door the pathfinder will not open never succeeds.
                    if (++missed >= 5) throw new Error(`cannot pick up ${item} at ${spot.x},${spot.z}: ${r.message}`);
                }
                break;
            }
            if (found) continue;
            if (waited >= maxWaitTicks) throw new Error(`no ${item} at its spawns after ${waited} ticks`);
            await this.ticks(10);
            waited += 10;
        }
    }

    /**
     * Buy at a SHOPS shop until the account holds `target` (bank + inventory). The
     * walk there is ours (ships, ladders); `at` is the shopkeeper's place when it is
     * upstairs, where the buyer's own walk cannot climb.
     */
    async buy(shop: string, item: string, target: number, maxWaitTicks = 400, at?: Place): Promise<void> {
        // The buyer counts only the inventory here, so ask it for the bank's shortfall.
        const quantity = target - (this.bank.get(norm(item)) ?? 0);
        if (quantity <= this.inv(item)) return;
        const stand = at ?? SHOPS[shop]?.stand;
        if (stand && !this.sdk.getState()?.shop?.isOpen) await this.walk(stand, 4);
        const rep = await this.buyer.buyAtShop({ item, quantity, source: 'shop', shop, maxWaitTicks });
        this.log('shop', { ...rep });
    }

    /**
     * Talk to an NPC and follow its dialogue to the end, answering every choice page
     * with the option matching `choose`. Returns the options taken.
     */
    async talk(npc: RegExp, at: Tile, choose: RegExp): Promise<string[]> {
        await this.walk(at, 4);
        const r = await this.bot.talkTo(npc);
        if (!r.success) throw new Error(`talk to ${npc}: ${r.message}`);
        return this.followDialogue(choose);
    }

    /** Advance the open dialogue to its end; a choice without a `choose` match is closed. */
    async followDialogue(choose?: RegExp, maxPages = 25): Promise<string[]> {
        // A repeat of the same conversation opens on the same page id as the last one
        // acted on, which the dialogue helper would otherwise take for a stale page.
        resetDialogueMemory(this.sdk);
        const taken: string[] = [];
        for (let p = 0; p < maxPages; p++) {
            const page = await waitUntil(this.sdk, s => s.dialog.isOpen, { maxTicks: 4 });
            if (!page.ok) break;
            if (classifyPage(page.state.dialog) === 'choice') {
                const opt = choose ? page.state.dialog.options.find(o => choose.test(o.text)) : undefined;
                if (!opt) {
                    this.log('dialogue: no wanted option', { options: page.state.dialog.options.map(o => o.text) });
                    await this.bot.dismissBlockingUI();
                    break;
                }
                taken.push(opt.text);
            }
            const a = await advance(this.sdk, { choose, maxTicks: 4 });
            if (!a.ok) break;
        }
        return taken;
    }

    /** Use an inventory item on an NPC, then follow whatever dialogue it opens. */
    async useOnNpc(item: string, npc: RegExp, at: Tile): Promise<void> {
        await this.walk(at, 4);
        const r = await this.bot.useItemOnNpc(exact(item), npc);
        if (!r.success) throw new Error(`use ${item} on ${npc}: ${r.message}`);
        await this.followDialogue();
    }

    /** Use one inventory item on another (same as the client's "Use X -> Y"). */
    async useOnItem(a: string, b: string): Promise<boolean> {
        const src = this.sdk.getInventory().find(i => norm(i.name) === norm(a));
        const dst = this.sdk.getInventory().find(i => norm(i.name) === norm(b) && i.slot !== src?.slot);
        if (!src || !dst) return false;
        const before = this.inv(a);
        await this.sdk.sendUseItemOnItem(src.slot, dst.slot);
        if (!(await this.until(() => this.inv(a) < before, 5))) return false;
        // Item-on-item recipes such as soft clay delay the player (p_delay(1), two
        // ticks), and a use sent during the delay is dropped.
        await this.ticks(2);
        return true;
    }

    /** Mine `rock` near `at` until `done` or the inventory is full. */
    async mine(rock: RegExp, at: Tile, done: () => boolean): Promise<void> {
        await this.walk(at, 5);
        let fails = 0;
        while (!done() && freeSlots(this.sdk) > 0) {
            checkAbort(this.ctx);
            await dismissDialogs(this.bot, this.sdk);
            const r = await this.bot.mineRock(rock, { timeout: 30_000 });
            if (r.success) {
                fails = 0;
                continue;
            }
            if (++fails > 15) throw new Error(`mining ${rock}: ${r.message}`);
            if (cheb(this.here(), at) > 8) await this.walk(at, 5);
            await this.ticks(3);
        }
    }

    /** Chop trees near `at` until `done` or the inventory is full. */
    async chop(at: Tile, done: () => boolean): Promise<void> {
        await this.walk(at, 5);
        let fails = 0;
        while (!done() && freeSlots(this.sdk) > 0) {
            checkAbort(this.ctx);
            await dismissDialogs(this.bot, this.sdk);
            const r = await this.bot.chopTree(/^tree$/i);
            if (r.success) {
                fails = 0;
                continue;
            }
            if (++fails > 15) throw new Error(`chopping: ${r.message}`);
            if (cheb(this.here(), at) > 10) await this.walk(at, 5);
            await this.ticks(3);
        }
    }

    /** Pick a loc (onions, wheat) near `at` until `done`. */
    async pickLoc(loc: RegExp, item: string, at: Tile, done: () => boolean): Promise<void> {
        await this.walk(at, 3);
        let fails = 0;
        while (!done()) {
            checkAbort(this.ctx);
            if (freeSlots(this.sdk) === 0) throw new Error('inventory full');
            const target = await this.sdk.scanFindNearbyLoc(loc, 10);
            if (!target) {
                if (++fails > 60) throw new Error(`no ${loc} near ${at.x},${at.z}`);
                await this.ticks(5);
                continue;
            }
            const before = this.inv(item);
            await this.bot.interactLoc(target, /^pick/i);
            if (await this.until(() => this.inv(item) > before, 8)) fails = 0;
            else if (++fails > 60) throw new Error(`picking ${loc} gave no ${item}`);
        }
    }

    /** Fill every empty bucket in the inventory at the nearest fountain, sink or well. */
    async fillBuckets(at: Tile, max = 28): Promise<void> {
        await this.walk(at, 4);
        const source = (await this.sdk.scanNearbyLocs(15)).find(l => /^(fountain|sink|well|water pump)$/i.test(l.name));
        if (!source) throw new Error(`no water source near ${at.x},${at.z}`);
        let filled = 0;
        let stalls = 0;
        while (this.inv('Bucket') > 0 && filled < max) {
            checkAbort(this.ctx);
            const before = this.inv('Bucket');
            const r = await this.bot.useItemOnLoc(/^bucket$/i, source);
            if (await this.until(() => this.inv('Bucket') < before, 6)) {
                filled++;
                stalls = 0;
                // A fill delays the player for the tick (p_delay(0) in water_sources.rs2),
                // and the server drops a use sent during it.
                await this.ticks(1);
            } else if (++stalls >= 3) throw new Error(`filling a bucket at the ${source.name}: ${r.message}`);
        }
    }

    /**
     * Kill `npc` near `at` and loot `drop` until `done`. Picks targets nobody else is
     * fighting, loots every `drop` in sight before the next attack, and rests while
     * Hitpoints are under half (helpers carry no food).
     */
    async kill(npc: RegExp, at: Tile, drop: string, done: () => boolean, maxKills = 400): Promise<number> {
        const re = exact(drop);
        await this.gearUp();
        await this.walk(at, 6);
        let kills = 0;
        let misses = 0;
        while (!done() && kills < maxKills) {
            checkAbort(this.ctx);
            await dismissDialogs(this.bot, this.sdk);
            if (freeSlots(this.sdk) === 0) throw new Error('inventory full');
            const loot = (await this.sdk.scanGroundItems(10)).find(i => re.test(i.name));
            if (loot) {
                const before = this.inv(drop);
                await this.bot.pickupItem(loot);
                await this.until(() => this.inv(drop) > before, 6);
                continue;
            }
            if (await this.rest()) continue;
            const target = this.sdk
                .getNearbyNpcs()
                .filter(n => npc.test(n.name) && !n.inCombat && n.reachable !== false)
                .sort((a, b) => a.distance - b.distance)[0];
            if (!target) {
                if (cheb(this.here(), at) > 10) await this.walk(at, 6);
                await this.ticks(5);
                continue;
            }
            await this.balanceStyle();
            const r = await this.bot.attack(target);
            if (!r.success) {
                if (++misses > 20) throw new Error(`attacking ${npc}: ${r.message}`);
                await this.ticks(2);
                continue;
            }
            misses = 0;
            // Dead when it leaves the NPC list; its drop lands a tick or two later.
            if (await this.until(() => !this.sdk.getNearbyNpcs().some(n => n.index === target.index), 100)) {
                kills++;
                if (kills % 20 === 0) {
                    const lv = (s: string) => this.level(s);
                    this.log('kills', { npc: String(npc), kills, [drop]: this.held(drop), attack: lv('Attack'), strength: lv('Strength'), defence: lv('Defence'), hitpoints: lv('Hitpoints') });
                }
                await this.ticks(2);
            }
        }
        return kills;
    }

    /**
     * Under half Hitpoints, wait where the account stands until 80% (helpers carry no food):
     * resting to 80% rather than going on just above half. True when it rested.
     */
    async rest(): Promise<boolean> {
        const hp = this.sdk.getSkill('Hitpoints');
        if (!hp || hp.level * 2 >= hp.baseLevel) return false;
        this.log('resting', { hp: hp.level, of: hp.baseLevel });
        await this.until(() => {
            const h = this.sdk.getSkill('Hitpoints');
            return !h || h.level * 5 >= h.baseLevel * 4;
        }, 1500);
        return true;
    }

    /** Train whichever of Attack, Strength and Defence is lowest: an even account kills faster and is hit less. */
    async balanceStyle(): Promise<void> {
        const cs = this.sdk.getState()?.combatStyle;
        if (!cs?.known) return;
        const lowest = ['Defence', 'Strength', 'Attack'].sort((a, b) => this.level(a) - this.level(b))[0]!;
        const style = cs.styles.find(s => s.trainsSkills.length === 1 && s.trainsSkills[0] === lowest);
        if (style && style.index !== cs.currentStyle) {
            await this.sdk.sendSetCombatStyle(style.index);
            await this.until(() => this.sdk.getState()?.combatStyle?.currentStyle === style.index, 3);
        }
    }

    /** Wield the tutorial's bronze sword and wooden shield if nothing better is worn. */
    async gearUp(): Promise<void> {
        const kit = ['Bronze sword', 'Wooden shield'];
        const worn = () => this.sdk.getEquipment().map(i => norm(i.name));
        const missing = () => kit.filter(k => !worn().includes(norm(k)));
        if (missing().length === 0 || this.sdk.getEquipment().length > 1) return;
        const fetch = missing().filter(k => this.inv(k) === 0 && this.held(k) > 0);
        if (fetch.length > 0)
            await this.atBank(async () => {
                for (const k of fetch) await this.withdraw(k, 1);
            });
        for (const k of missing()) {
            if (this.inv(k) === 0) continue;
            await this.bot.equipItem(exact(k));
            await this.until(() => worn().includes(norm(k)), 4);
        }
        this.log('gear', { worn: worn() });
    }

    /** Pickpocket Lumbridge men until the account holds `target` coins. */
    async pickpocket(target: number): Promise<void> {
        const stand = { x: 3231, z: 3218 };
        await this.walk(stand, 6);
        while (this.held('Coins') < target) {
            checkAbort(this.ctx);
            await dismissDialogs(this.bot, this.sdk);
            const hp = this.sdk.getSkill('Hitpoints');
            if (hp && hp.level <= 3) {
                const food = this.sdk.getInventory().find(i => FOOD.test(i.name));
                if (food) await this.bot.eatFood(food);
                else {
                    // One Hitpoint per 100 ticks: rest back to 80%, or the next failed
                    // pickpocket puts it straight back here.
                    this.log('resting', { hp: hp.level, of: hp.baseLevel, coins: this.held('Coins'), thieving: this.level('Thieving') });
                    await this.until(() => {
                        const h = this.sdk.getSkill('Hitpoints');
                        return !h || h.level * 5 >= h.baseLevel * 4;
                    }, 1500);
                }
                continue;
            }
            const r = await this.bot.pickpocketNpc(/^(man|woman)$/i);
            if (!r.success) {
                if (r.reason === 'npc_not_found' || r.reason === 'cant_reach') await this.walk(stand, 6);
                await this.ticks(r.reason === 'stunned' ? 5 : 2);
            }
        }
    }
}

// ---------------------------------------------------------------- the tasks

const T = {
    lumbridgeMen: { x: 3231, z: 3218 },
    lumbridgeKnife: { x: 3224, z: 3202 },
    lumbridgeFountain: { x: 3221, z: 3228 },
    lumbridgeCows: { x: 3255, z: 3278 },
    lumbridgeEggs: [
        { x: 3226, z: 3301 },
        { x: 3229, z: 3299 }
    ],
    lumbridgeTrees: { x: 3192, z: 3236 },
    fredOnions: { x: 3189, z: 3267 },
    rimmingtonMine: { x: 2979, z: 3240 },
    sarahSink: { x: 3022, z: 3288 },
    sarahBuckets: [
        { x: 3020, z: 3291 },
        { x: 3026, z: 3289 }
    ],
    wyson: { x: 3027, z: 3379 },
    risingSun: { x: 2957, z: 3371 },
    barbarianWheel: { x: 3088, z: 3410 },
    varrockRedberries: [
        { x: 3267, z: 3371 },
        { x: 3271, z: 3366 },
        { x: 3278, z: 3374 }
    ],
    varrockCadava: [
        { x: 3266, z: 3361 },
        { x: 3273, z: 3375 },
        { x: 3277, z: 3370 }
    ],
    aggie: { x: 3086, z: 3259 },
    lumbridgeGoblins: { x: 3185, z: 3245 },
    lumbridgeChickens: { x: 3230, z: 3298 },
    swampRats: { x: 3195, z: 3205 },
    brownBears: { x: 3165, z: 3229 },
    snapeGrass: [
        { x: 2906, z: 3297 },
        { x: 2907, z: 3295 },
        { x: 2917, z: 3274 }
    ],
    // Karamja: three monkeys on the walk west from Musa Point, and its net spots.
    musaMonkeys: { x: 2877, z: 3155 },
    musaNet: { x: 2924, z: 3178 },
    // Kandarin. The gnome grocers are on the Stronghold's upper floor, up the ladder at (2466,3495)
    // inside the Grand Tree: the walk there goes through the Stronghold gate and the tree doors (passages.ts).
    heckel: { x: 2493, z: 3488, level: 1, via: { x: 2466, z: 3494 } },
    hudo: { x: 2448, z: 3509, level: 1, via: { x: 2466, z: 3494 } },
    outpostPlanks: [
        { x: 2552, z: 3574 },
        { x: 2553, z: 3575 },
        { x: 2554, z: 3574 },
        { x: 2556, z: 3573 }
    ],
    // Fishing Contest. The tunnel dwarf has a twin at each end of the tunnel; this is the Kandarin end.
    morganCupboard: { x: 3096, z: 3267, level: 1, via: { x: 3098, z: 3266 } },
    tunnelDwarf: { x: 2819, z: 3486 },
    // The loose railing at (2662,3500) is the wood's west wall: outside is (2661,3500), and squeezing
    // lands on the railing's own tile (measured in the lab).
    woodOutside: { x: 2661, z: 3500 },
    woodInside: { x: 2662, z: 3500 },
    redVine: { x: 2632, z: 3497 }
} as const;

/** Crafting xp for level 8 (the unfired bowl) and per unfired pot at the server's 25x. */
const CRAFTING_8_XP = 801;
const POT_XP = 6.3 * 25;
/** Clay kept for Doric's Quest (6) and its spare; the bowl task softens only clay beyond this. */
const clayReserve = (g: Gatherer) => g.n(6);
/** Soft clay still to make into pots for Crafting 8, plus the bowls. */
function clayForBowls(g: Gatherer): number {
    const bowls = Math.max(0, g.n(1) - g.held('Unfired bowl'));
    if (bowls === 0) return 0;
    const pots = g.level('Crafting') >= 8 ? 0 : Math.ceil((CRAFTING_8_XP - g.xp('Crafting')) / POT_XP);
    return Math.max(0, pots + bowls - g.held('Soft clay'));
}

const want = (item: string, count: number): Want => ({ item, count });
/** A skill level as a want: held is the base level, so a level gained counts as progress. */
const levelWant = (skill: string, level: number): Want => want(`${skill} level`, level);

// ------------------------------------------------------------ fishing contest

/**
 * Catches a helper may make in one round. The third catch ends the contest and
 * Bonzo takes the giant carp (hemenster_fishing.rs2: %hemenster_comp_stage
 * counts the fee as 1 and each catch as 1 more, and 4 hands the catch in).
 */
export const MAX_CATCHES_PER_ROUND = 2;
export const CONTEST_FEE = 5;

export type ContestStep = 'enter' | 'pay' | 'stash' | 'fish' | 'leave' | 'done';

export interface RoundView {
    /** Inside Hemenster's fence. */
    inside: boolean;
    /** Catches this round, or null when the round was not started by us (a restart inside the fence). */
    catches: number | null;
    paid: boolean;
    /** Bonzo has given us the stranger's spot by the pipes, where a worm catches a giant carp. */
    atPipes: boolean;
    /** Fishing or stash attempts this round that changed nothing. */
    misses: number;
    worms: number;
    garlic: number;
    coins: number;
    /** A fishing rod is carried. */
    rod: boolean;
}

/**
 * The next move in a contest round. Every way out goes through the gate, where
 * Bonzo's quit dialogue resets the round (bonzo.rs2 bonzo_quits), so the carp
 * caught stays ours. Leaving is chosen before a third catch is possible, and
 * whenever the round's catches are unknown.
 */
export function contestStep(r: RoundView): ContestStep {
    // Entering pays the fee, so only with everything a catch needs: the rod, a worm, and garlic for the pipes.
    if (!r.inside) return r.worms > 0 && r.rod && r.garlic > 0 && r.coins >= CONTEST_FEE ? 'enter' : 'done';
    if (r.catches === null || r.catches >= MAX_CATCHES_PER_ROUND) return 'leave';
    if (!r.rod || r.worms === 0 || r.misses >= 2) return 'leave';
    if (!r.paid) return r.coins >= CONTEST_FEE ? 'pay' : 'leave';
    if (!r.atPipes) return r.garlic > 0 ? 'stash' : 'leave';
    return 'fish';
}

/** Inside Hemenster's fence: west of the gate at x 2642 (the gate tile counts as inside, quest_fishingcompo.rs2). */
export const inContest = (t: Tile): boolean => t.x >= 2620 && t.x <= 2642 && t.z >= 3410 && t.z <= 3452;

const CONTEST = {
    gate: { x: 2642, z: 3441 },
    outside: { x: 2644, z: 3441 },
    bonzo: { x: 2641, z: 3439 },
    /** The Sinister Stranger's spot: a red vine worm catches a giant carp here, and only here. */
    pipeSpot: { x: 2637, z: 3444 },
    /**
     * Where garlic goes in: the pipe (garlicpipe, a straight wall decoration on the fence) is
     * placed on 2636-2638,3446, and the engine only lets you use an item on that shape from
     * its own tile (ReachStrategy.reachWallDecor1). Only 2638 is land; the other two are lake.
     */
    pipe: { x: 2638, z: 3446 }
};

/** The garlic pipe to use: the one on the land tile we can stand on. */
export function pickPipe(locs: NearbyLoc[]): NearbyLoc | undefined {
    return locs.find(l => /^wall pipe$/i.test(l.name) && l.x === CONTEST.pipe.x && l.z === CONTEST.pipe.z);
}

/** Whether a dialogue since `since` gave us the pipes (Bonzo's set_places once garlic is in the pipe). */
export function pipesAssigned(s: BotWorldState | null, since: number): boolean {
    return (s?.recentDialogs ?? []).some(d => d.tick >= since && /beside the pipes/i.test(d.text.join(' ')));
}

async function contestGate(g: Gatherer) {
    const gate = (await g.sdk.scanNearbyLocs(8)).filter(l => /^gate$/i.test(l.name) && l.optionsWithIndex.some(o => /open/i.test(o.text))).sort((a, b) => cheb(a, CONTEST.gate) - cheb(b, CONTEST.gate))[0];
    if (!gate || cheb(gate, CONTEST.gate) > 2) throw new Error('the contest gate is not in view');
    return gate;
}

/** Through the gate past Morris, who wants to see the pass. */
async function enterContest(g: Gatherer): Promise<void> {
    await g.walk(CONTEST.outside, 1);
    for (let attempt = 0; attempt < 3 && !inContest(g.here()); attempt++) {
        await g.bot.interactLoc(await contestGate(g), /open/i);
        await g.followDialogue();
        await g.until(() => inContest(g.here()), 6);
    }
    if (!inContest(g.here())) throw new Error('Morris did not let us in');
}

/** Pay Bonzo the fee. True when he put us by the pipes already (garlic stashed in an earlier round). */
async function payBonzo(g: Gatherer): Promise<boolean> {
    const since = g.sdk.getState()?.tick ?? 0;
    const coins = g.inv('Coins');
    await g.talk(/^bonzo$/i, CONTEST.bonzo, /enter the competition/i);
    await g.ticks(1);
    if (g.inv('Coins') >= coins) g.log('contest: no fee taken', { coins });
    return pipesAssigned(g.sdk.getState(), since);
}

/** Garlic in the pipe, after paying, moves the stranger and gives us his spot (quest_fishingcompo.rs2 stash_garlic). */
async function stashGarlic(g: Gatherer): Promise<boolean> {
    const pipe = pickPipe(await g.sdk.scanNearbyLocs(10));
    if (!pipe) throw new Error('no wall pipe in view at the land tile');
    const before = g.inv('Garlic');
    // Stand on the pipe's own tile, then use the garlic on it there.
    await g.walk(CONTEST.pipe, 0);
    const garlic = g.sdk.getInventory().find(i => /^garlic$/i.test(i.name));
    const response = garlic ? await g.sdk.sendUseItemOnLoc(garlic.slot, pipe.x, pipe.z, pipe.id) : undefined;
    const ok = await g.until(() => g.inv('Garlic') < before, 8);
    g.log('contest: stash garlic', {
        pipe: { id: pipe.id, x: pipe.x, z: pipe.z, options: pipe.optionsWithIndex.map(o => o.text) },
        response: response && { success: response.success, message: response.message },
        garlic: { before, after: g.inv('Garlic') }
    });
    await g.followDialogue();
    return ok;
}

/** One catch at the pipe spot; true when it used a worm. */
async function fishAtPipes(g: Gatherer): Promise<boolean> {
    const spot = g.sdk
        .getNearbyNpcs()
        .filter(n => /^fishing spot$/i.test(n.name))
        .sort((a, b) => cheb(a, CONTEST.pipeSpot) - cheb(b, CONTEST.pipeSpot))[0];
    if (!spot || cheb(spot, CONTEST.pipeSpot) > 1) throw new Error('the pipe fishing spot is not in view');
    const worms = g.inv('Red vine worm');
    await g.bot.interactNpc(spot, /^fish$/i);
    const caught = await g.until(() => g.inv('Red vine worm') < worms, 12);
    // The stranger's "my spot" dialogue when the pipes are not ours, or a level-up.
    await dismissDialogs(g.bot, g.sdk);
    return caught;
}

/** Out through the gate, answering Bonzo so the round resets (not walking out mid-round without him). */
async function leaveContest(g: Gatherer): Promise<void> {
    for (let attempt = 0; attempt < 3 && inContest(g.here()); attempt++) {
        await dismissDialogs(g.bot, g.sdk);
        await g.bot.interactLoc(await contestGate(g), /open/i);
        await g.followDialogue(/compete again another day/i);
        await g.until(() => !inContest(g.here()), 6);
    }
    if (inContest(g.here())) throw new Error('could not leave the contest');
}

/** Contest rounds until the worms carried are used: each round pays, takes the pipes, catches at most two, and leaves. */
async function runContest(g: Gatherer): Promise<void> {
    const startedInside = inContest(g.here());
    const r = { inside: startedInside, catches: startedInside ? null : (0 as number | null), paid: false, atPipes: false, misses: 0, wormsAtEntry: 0 };
    for (let step = 0; step < 30; step++) {
        checkAbort(g.ctx);
        const worms = g.inv('Red vine worm');
        // Every catch uses one bait, and only worms are carried in, so the worms used are the catches.
        if (r.inside && r.catches !== null) r.catches = r.wormsAtEntry - worms;
        const next = contestStep({ ...r, worms, garlic: g.inv('Garlic'), coins: g.inv('Coins'), rod: g.inv('Fishing rod') > 0 });
        g.log('contest', { step: next, catches: r.catches, worms, paid: r.paid, atPipes: r.atPipes, carp: g.inv('Raw giant carp') });
        if (next === 'done') return;
        if (next === 'enter') {
            await enterContest(g);
            Object.assign(r, { inside: true, catches: 0, paid: false, atPipes: false, misses: 0, wormsAtEntry: g.inv('Red vine worm') });
        } else if (next === 'pay') {
            r.atPipes = await payBonzo(g);
            r.paid = true;
        } else if (next === 'stash') {
            if (await stashGarlic(g)) r.atPipes = true;
            else r.misses++;
        } else if (next === 'fish') {
            if (!(await fishAtPipes(g))) r.misses++;
        } else {
            await leaveContest(g);
            // One trip is one scheduler attempt. A failed round must return so the
            // gatherer's normal three-strike policy owns any retry, rather than
            // paying and failing several more rounds in this invocation.
            return;
        }
    }
}

/** The walkable vine (red_worm_vine): the rest of the patch is solid ground decor, often with no route to it. */
const RED_WORM_VINE = 58;

/** The red vine to dig: a reachable one, the walkable vine first, then the nearest. */
export function pickVine(locs: NearbyLoc[]): NearbyLoc | undefined {
    return locs
        .filter(l => /^vine$/i.test(l.name) && l.reachable !== false)
        .sort((a, b) => Number(b.id === RED_WORM_VINE) - Number(a.id === RED_WORM_VINE) || a.distance - b.distance)[0];
}

/** Giant carps still to catch, which is also the worms still to dig. */
const carpsShort = (g: Gatherer) => Math.max(0, (g.counts.get('raw giant carp') ?? g.n(1)) - g.held('Raw giant carp'));

/** Through McGrubor's loose railing, between the walk outside (2661,3500) and the wood (quest doc: the pathfinder takes the locked gate for a door). */
async function squeezeRailing(g: Gatherer, from: Tile, to: Tile): Promise<void> {
    await g.walk(from, 0);
    for (let attempt = 0; attempt < 3 && cheb(g.here(), to) > 0; attempt++) {
        const railing = (await g.sdk.scanNearbyLocs(4)).find(l => /^loose railing$/i.test(l.name));
        if (!railing) throw new Error("McGrubor's loose railing is not in view");
        await g.bot.interactLoc(railing, /squeeze/i);
        await g.until(() => cheb(g.here(), to) === 0, 8);
    }
    if (cheb(g.here(), to) > 0) throw new Error(`squeezing through the railing left us at ${JSON.stringify(g.here())}`);
}

/** Bears (level 21) and the hobgoblins by the snape grass want a few combat levels first. */
async function trainOnGoblins(g: Gatherer): Promise<void> {
    const ready = () => g.level('Attack') >= 20 && g.level('Hitpoints') >= 20;
    if (!ready()) await g.kill(/^goblin$/i, T.lumbridgeGoblins, 'Goblin mail', ready);
}
/** The wants still short. */
const short = (g: Gatherer, ws: Want[]) => ws.filter(w => g.held(w.item) < w.count);

/** The `counts` option by lower-cased item name; throws on anything but non-negative integers. */
export function parseCounts(raw: unknown): Map<string, number> {
    if (raw === undefined) return new Map();
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('questitems: counts must be an object of item name to held target');
    return new Map(
        Object.entries(raw).map(([item, n]) => {
            if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) throw new Error(`questitems: counts[${JSON.stringify(item)}] must be a non-negative integer, got ${JSON.stringify(n)}`);
            return [norm(item), n];
        })
    );
}

/** `t` with its held targets replaced where `counts` names the item. */
export function withCounts(t: Task, counts: ReadonlyMap<string, number>): Task {
    if (counts.size === 0) return t;
    return { ...t, makes: g => t.makes(g).map(w => (counts.has(norm(w.item)) ? want(w.item, counts.get(norm(w.item))!) : w)) };
}

export const TASKS: Record<string, Task> = {
    goblinmail: {
        id: 'goblinmail',
        // Goblin Diplomacy's three mails: 5 in 128 per Lumbridge goblin (goblin.rs2).
        makes: g => [want('Goblin mail', g.n(3))],
        run: async g => {
            // Chickens (max hit 1) first: Lumbridge goblins out-damage a 10-Hitpoint account.
            if (g.level('Attack') < 10) await g.kill(/^chicken$/i, T.lumbridgeChickens, 'Feather', () => g.level('Attack') >= 10);
            const kills = await g.kill(/^goblin$/i, T.lumbridgeGoblins, 'Goblin mail', () => g.held('Goblin mail') >= g.target('Goblin mail'));
            g.log('kills', { npc: 'goblin', kills, held: g.held('Goblin mail') });
        }
    },
    ratmeat: {
        id: 'ratmeat',
        // Druidic Ritual: every giant rat drops raw rat meat (giant_rat.rs2).
        makes: g => [want('Raw rat meat', g.n(1))],
        run: async g => void (await g.kill(/^giant rat$/i, T.swampRats, 'Raw rat meat', () => g.held('Raw rat meat') >= g.target('Raw rat meat')))
    },
    bearmeat: {
        id: 'bearmeat',
        // Druidic Ritual: every bear drops raw bear meat (bear.rs2).
        makes: g => [want('Raw bear meat', g.n(1))],
        run: async g => {
            await trainOnGoblins(g);
            await g.kill(/^(grizzly |brown )?bear$/i, T.brownBears, 'Raw bear meat', () => g.held('Raw bear meat') >= g.target('Raw bear meat'));
        }
    },
    snapegrass: {
        id: 'snapegrass',
        // Plague City: spawns on the hobgoblin peninsula, so after some combat.
        makes: g => [want('Snape grass', g.n(1))],
        run: async g => {
            await trainOnGoblins(g);
            // The hobgoblins there cost a ~50-Hitpoint account about 10 a pack of grass,
            // so a bulk run rests at the bank between trips.
            await g.rest();
            await g.pickup('Snape grass', [...T.snapeGrass], () => g.held('Snape grass') >= g.target('Snape grass'));
        }
    },
    hitpoints: {
        id: 'hitpoints',
        // Overseas errands pass aggressive NPCs (Karamja's snakes and scorpions, McGrubor's guard dogs);
        // the lab's 10-Hitpoint accounts died at both. Lumbridge cows hit for at most 1 (kandarin.ts).
        makes: () => [levelWant('Hitpoints', CROSSING_HITPOINTS)],
        fights: true,
        run: async g => void (await trainHitpointsOnCows({ bot: g.bot, sdk: g.sdk, log: (m, d) => g.log(m, d), checkSignal: () => checkAbort(g.ctx) }))
    },
    coins: {
        id: 'coins',
        makes: g => (g.held('Coins') < 100 ? [want('Coins', g.float)] : []),
        run: g => g.pickpocket(g.float)
    },
    knife: {
        id: 'knife',
        makes: g => [want('Knife', g.n(1))],
        run: g => g.pickup('Knife', [T.lumbridgeKnife], () => g.held('Knife') >= g.target('Knife'))
    },
    buckets: {
        id: 'buckets',
        // Plague City's 4 buckets of water; milk for Plague City and Cook's Assistant.
        makes: g => [want('Bucket of water', g.n(4)), want('Bucket of milk', g.n(2))],
        carry: () => [want('Coins', 80)],
        async run(g) {
            const water = Math.max(0, g.target('Bucket of water') - g.held('Bucket of water'));
            const milk = Math.max(0, g.target('Bucket of milk') - g.held('Bucket of milk'));
            // Lumbridge general store holds 2 buckets and restocks one per 100 ticks.
            await g.buy('lumbridgeGeneral', 'Bucket', water + milk, 1200);
            if (milk > 0) {
                await g.walk(T.lumbridgeCows, 6);
                let made = 0;
                for (let tries = 0; made < milk && g.inv('Bucket') > 0 && tries < milk + 6; tries++) {
                    const before = g.inv('Bucket of milk');
                    const r = await g.bot.useItemOnNpc(/^bucket$/i, /^cow$/i);
                    if (await g.until(() => g.inv('Bucket of milk') > before, 6)) made++;
                    else g.log('milking missed', { detail: r.message });
                }
            }
            if (g.inv('Bucket') > 0 && g.held('Bucket of water') < g.target('Bucket of water')) await g.fillBuckets(T.lumbridgeFountain, g.target('Bucket of water') - g.held('Bucket of water'));
        }
    },
    egg: {
        id: 'egg',
        makes: g => [want('Egg', g.n(1))],
        run: g => g.pickup('Egg', [...T.lumbridgeEggs], () => g.held('Egg') >= g.target('Egg'))
    },
    onions: {
        id: 'onions',
        // Two per yellow dye; the orange dye is red + yellow.
        makes: g => (g.held('Orange dye') >= g.n(1) ? [] : [want('Onion', 2 * (g.n(1) - g.held('Orange dye') - g.held('Yellow dye')))]),
        run: g => g.pickLoc(/^onion$/i, 'Onion', T.fredOnions, () => g.held('Onion') >= g.target('Onion'))
    },
    logs: {
        id: 'logs',
        makes: g => [want('Logs', g.n(6))],
        carry: () => [want('Bronze axe', 1)],
        run: g => g.chop(T.lumbridgeTrees, () => g.held('Logs') >= g.target('Logs'))
    },
    wydin: {
        id: 'wydin',
        // Cook's Assistant flour, Monkey Madness bananas, Druidic Ritual beef and chicken.
        makes: g => [want('Pot of flour', g.n(1)), want('Banana', g.n(5)), want('Raw beef', g.n(1)), want('Raw chicken', g.n(1))],
        carry: () => [want('Coins', 120)],
        async run(g) {
            for (const w of short(g, g.wants())) await g.buy('wydin', w.item, w.count, 600);
        }
    },
    gerrant: {
        id: 'gerrant',
        // Fishing Contest's rod and bait, Dragon Slayer's lobster pot.
        makes: g => [want('Fishing rod', g.n(1)), want('Fishing bait', g.n(1, 4)), want('Lobster pot', g.n(1))],
        carry: () => [want('Coins', 120)],
        async run(g) {
            for (const w of short(g, g.wants())) await g.buy('gerrant', w.item, w.count);
        }
    },
    mine: {
        id: 'mine',
        // Doric's Quest: 6 clay, 4 copper, 2 iron (Mining 15: about six copper at 25x),
        // and the clay the bowl task turns into pots for Crafting 8. Tin is for bulk runs
        // only (`counts`, e.g. the Superheat fallback's ore): no quest here takes it.
        makes: g => [want('Copper ore', g.n(4)), want('Iron ore', g.n(2)), want('Clay', clayReserve(g) + clayForBowls(g)), want('Tin ore', 0)],
        // The tutorial's pickaxe is kept across bank visits, but an account whose bank was
        // handed over (or emptied by a deposit-all) starts without it.
        carry: () => [want('Bronze pickaxe', 1)],
        async run(g) {
            const copper = g.target('Copper ore');
            const iron = g.target('Iron ore');
            const clay = g.target('Clay');
            const tin = g.target('Tin ore');
            await g.mine(/copper/i, T.rimmingtonMine, () => g.held('Copper ore') >= copper && g.level('Mining') >= 15);
            await g.mine(/iron/i, T.rimmingtonMine, () => g.held('Iron ore') >= iron);
            await g.mine(/clay/i, T.rimmingtonMine, () => g.held('Clay') >= clay);
            if (tin > 0) await g.mine(/tin/i, T.rimmingtonMine, () => g.held('Tin ore') >= tin);
        }
    },
    softclay: {
        id: 'softclay',
        // Softened at the sink by Sarah's farm, with the bucket spawns beside it.
        // Soft clay for every pot still needed for Crafting 8 and every bowl.
        makes: g => [want('Soft clay', g.held('Soft clay') + clayForBowls(g))],
        ready: g => clayForBowls(g) > 0 && g.held('Clay') - clayReserve(g) >= clayForBowls(g),
        carry: g => [want('Clay', clayForBowls(g))],
        async run(g) {
            const target = g.inv('Soft clay') + clayForBowls(g);
            if (g.inv('Bucket') + g.inv('Bucket of water') < 2) await g.pickup('Bucket', [...T.sarahBuckets], () => g.inv('Bucket') + g.inv('Bucket of water') >= 2);
            while (g.inv('Soft clay') < target && g.inv('Clay') > 0) {
                checkAbort(g.ctx);
                if (g.inv('Bucket of water') === 0) await g.fillBuckets(T.sarahSink);
                if (!(await g.useOnItem('Clay', 'Bucket of water'))) throw new Error('softening clay failed');
            }
        }
    },
    woad: {
        id: 'woad',
        // Wyson sells two woad leaves for 20 coins; Aggie makes blue dye from two.
        makes: g => (g.held('Blue dye') >= g.n(1) ? [] : [want('Woad leaf', 2 * (g.n(1) - g.held('Blue dye')))]),
        carry: () => [want('Coins', 60)],
        async run(g) {
            const target = g.target('Woad leaf');
            for (let i = 0; i < 4 && g.held('Woad leaf') < target; i++) await g.talk(/^wyson/i, T.wyson, /woad leaves|20 coins/i);
        }
    },
    mindbomb: {
        id: 'mindbomb',
        makes: g => [want("Wizard's mind bomb", g.n(1))],
        carry: () => [want('Coins', 10)],
        async run(g) {
            for (let i = 0; i < 4 && g.held("Wizard's mind bomb") < g.target("Wizard's mind bomb"); i++) await g.talk(/^barmaid$/i, T.risingSun, /mind bomb/i);
        }
    },
    bowl: {
        id: 'bowl',
        // Dragon Slayer's unfired bowl needs Crafting 8: about six unfired pots first.
        makes: g => [want('Unfired bowl', g.n(1))],
        ready: g => clayForBowls(g) === 0 || g.held('Soft clay') > 0,
        carry: g => [want('Soft clay', g.held('Soft clay'))],
        async run(g) {
            await g.walk(T.barbarianWheel, 3);
            const wheel = await g.sdk.scanFindNearbyLoc(/potter'?s wheel/i, 8);
            if (!wheel) throw new Error('no potter\'s wheel at Barbarian Village');
            while (g.inv('Soft clay') > 0 && g.held('Unfired bowl') < g.target('Unfired bowl')) {
                checkAbort(g.ctx);
                const product = g.level('Crafting') >= 8 ? 'Bowl' : 'Pot';
                const before = g.inv('Soft clay');
                await g.bot.useItemOnLoc(/^soft clay$/i, wheel);
                // The make-1 buttons are labelled with the product after literal "\n" padding.
                const menu = await waitUntil(g.sdk, s => s.dialog.isOpen && resolveSkillDialogProduct(s.dialog.options, product) !== null, { maxTicks: 6 });
                if (!menu.ok) throw new Error(`no pottery menu (options: ${g.sdk.getState()?.dialog.options.map(o => o.text).join(' | ')})`);
                const opt = resolveSkillDialogProduct(menu.state.dialog.options, product)!;
                await g.sdk.sendClickDialog(opt.index);
                if (!(await g.until(() => g.inv('Soft clay') < before, 8))) throw new Error(`no ${product} made`);
                await dismissDialogs(g.bot, g.sdk);
            }
            // The pots were only for the Crafting xp.
            if (g.inv('Unfired pot') > 0) await g.bot.dropItem(/^unfired pot$/i, 'all');
        }
    },
    silk: {
        id: 'silk',
        makes: g => [want('Silk', g.n(1))],
        carry: () => [want('Coins', 100)],
        run: g => g.buy('thessalia', 'Silk', g.target('Silk'))
    },
    berries: {
        id: 'berries',
        // Romeo & Juliet's Cadava berries; redberries for Aggie's red dye (three per dye).
        makes: g => [want('Cadava berries', g.n(1)), ...(g.held('Orange dye') >= g.n(1) ? [] : [want('Redberries', 3 * (g.n(1) - g.held('Orange dye') - g.held('Red dye')))])],
        async run(g) {
            const cadava = g.target('Cadava berries');
            const red = g.target('Redberries');
            await g.pickup('Cadava berries', [...T.varrockCadava], () => g.held('Cadava berries') >= cadava);
            if (red > 0) await g.pickup('Redberries', [...T.varrockRedberries], () => g.held('Redberries') >= red);
        }
    },
    dyes: {
        id: 'dyes',
        // Goblin Diplomacy: orange (red + yellow) and blue, from Aggie at 5 coins each.
        makes: g => [want('Orange dye', g.n(1)), want('Blue dye', g.n(1))],
        ready: g => {
            const orange = g.held('Orange dye') < g.n(1) ? 1 : 0;
            const blue = g.held('Blue dye') < g.n(1) ? 1 : 0;
            const redOk = g.held('Red dye') > 0 || g.held('Redberries') >= 3;
            const yellowOk = g.held('Yellow dye') > 0 || g.held('Onion') >= 2;
            return (orange > 0 && redOk && yellowOk) || (blue > 0 && g.held('Woad leaf') >= 2);
        },
        carry: g => [want('Coins', 40), want('Onion', g.held('Onion')), want('Redberries', g.held('Redberries')), want('Woad leaf', g.held('Woad leaf')), want('Red dye', g.held('Red dye')), want('Yellow dye', g.held('Yellow dye'))],
        async run(g) {
            await g.walk(T.aggie, 4);
            // Aggie hands the dye over a tick after her dialogue closes.
            const dye = async (input: string, out: string) => {
                const before = g.inv(out);
                await g.useOnNpc(input, /^aggie$/i, T.aggie);
                if (!(await g.until(() => g.inv(out) > before, 6))) throw new Error(`Aggie made no ${out.toLowerCase()} from ${input.toLowerCase()}`);
            };
            while (g.held('Orange dye') < g.target('Orange dye')) {
                checkAbort(g.ctx);
                if (g.inv('Yellow dye') === 0 && g.inv('Onion') >= 2) await dye('Onion', 'Yellow dye');
                if (g.inv('Red dye') === 0 && g.inv('Redberries') >= 3) await dye('Redberries', 'Red dye');
                if (g.inv('Red dye') === 0 || g.inv('Yellow dye') === 0) break;
                if (!(await g.useOnItem('Red dye', 'Yellow dye'))) throw new Error('mixing orange dye failed');
            }
            while (g.held('Blue dye') < g.target('Blue dye') && g.inv('Woad leaf') >= 2) {
                checkAbort(g.ctx);
                await dye('Woad leaf', 'Blue dye');
            }
        }
    },

    // ---------------------------------------------------------- far set (Karamja and Kandarin)
    monkeybones: {
        id: 'monkeybones',
        // Monkey Madness: a monkey drops its bones unless the killer has Tai Bwo Wannai Trio in progress (monkey.rs2).
        makes: g => [want('Monkey bones', g.n(1))],
        fights: true,
        // The fares to Karamja and on to Ardougne, and Jiminua's prices, all from the mainland.
        carry: () => [want('Coins', 300)],
        run: async g => void (await g.kill(/^monkey$/i, T.musaMonkeys, 'Monkey bones', () => g.held('Monkey bones') >= g.target('Monkey bones'), 60))
    },
    jiminua: {
        id: 'jiminua',
        // Sea Slug's unlit torch ("Torch" in game; Jiminua's is the only shop with it); Plague City's rope and spade.
        makes: g => [want('Torch', g.n(1)), want('Rope', g.n(1)), want('Spade', g.n(1))],
        carry: () => [want('Coins', 300)],
        async run(g) {
            for (const w of short(g, g.wants())) await g.buy('jiminua', w.item, w.count);
        }
    },
    swamppaste: {
        id: 'swamppaste',
        // Sea Slug: Port Khazard general store, stock 500.
        makes: g => [want('Swamp paste', g.n(1))],
        carry: () => [want('Coins', 150)],
        run: g => g.buy('khazard', 'Swamp paste', g.target('Swamp paste'))
    },
    wool: {
        id: 'wool',
        // Monkey Madness: Aemad's, East Ardougne, stock 30.
        makes: g => [want('Ball of wool', g.n(1))],
        carry: () => [want('Coins', 30)],
        run: g => g.buy('aemad', 'Ball of wool', g.target('Ball of wool'))
    },
    gnome: {
        id: 'gnome',
        // Plague City: the Stronghold grocers (Heckel Funch, else Hudo) stock 3 dwellberries and 5 chocolate dust each.
        makes: g => [want('Dwellberries', g.n(1)), want('Chocolate dust', g.n(1))],
        carry: () => [want('Coins', 100)],
        async run(g) {
            for (const [shop, at] of [['heckel', T.heckel], ['hudo', T.hudo]] as const)
                for (const w of short(g, g.wants())) await g.buy(shop, w.item, w.count, 100, at);
        }
    },
    planks: {
        id: 'planks',
        // Dragon Slayer: there is no sawmill here, and the Barbarian Outpost's four are the only safe spawns.
        makes: g => [want('Plank', g.n(3))],
        run: g => g.pickup('Plank', [...T.outpostPlanks], () => g.held('Plank') >= g.target('Plank'), 900)
    },

    // ---------------------------------------------------------- carp set (Fishing Contest)
    garlic: {
        id: 'garlic',
        // For the contest's pipe: Morgan's cupboard upstairs in Draynor gives a clove per search (cupboards.rs2).
        makes: g => carpsShort(g) > 0 ? [want('Garlic', g.n(1))] : [],
        async run(g) {
            await g.walk(T.morganCupboard, 2);
            for (let i = 0; i < 12 && g.held('Garlic') < g.target('Garlic'); i++) {
                checkAbort(g.ctx);
                const cupboard = (await g.sdk.scanNearbyLocs(6)).filter(l => /cupboard/i.test(l.name)).sort((a, b) => a.distance - b.distance)[0];
                if (!cupboard) throw new Error("no cupboard in Morgan's house");
                const before = g.inv('Garlic');
                if (cupboard.optionsWithIndex.some(o => /search/i.test(o.text))) {
                    await g.bot.interactLoc(cupboard, /search/i);
                    await g.until(() => g.inv('Garlic') > before, 6);
                } else {
                    await g.bot.interactLoc(cupboard, /open/i);
                    await g.ticks(2);
                }
            }
        }
    },
    rod: {
        id: 'rod',
        makes: () => [want('Fishing rod', 1)],
        carry: () => [want('Coins', 40)],
        run: g => g.buy('gerrant', 'Fishing rod', g.target('Fishing rod'))
    },
    fishing: {
        id: 'fishing',
        // The contest spots need Fishing 10 (hemenster_fishing.rs2): shrimps at Musa Point, where the Port Sarim ship lands.
        makes: () => [levelWant('Fishing', 10)],
        ready: g => g.held('Small fishing net') > 0,
        carry: () => [want('Small fishing net', 1), want('Coins', 150)],
        async run(g) {
            await g.walk(T.musaNet, 4);
            let misses = 0;
            while (g.level('Fishing') < 10) {
                checkAbort(g.ctx);
                if (freeSlots(g.sdk) === 0) await g.bot.dropItem(/^raw shrimps$/i, 'all');
                const spot = g.sdk
                    .getNearbyNpcs()
                    .filter(n => /^fishing spot$/i.test(n.name) && n.optionsWithIndex.some(o => /^net$/i.test(o.text)))
                    .sort((a, b) => a.distance - b.distance)[0];
                const xp = g.xp('Fishing');
                if (spot) await g.bot.interactNpc(spot, /^net$/i);
                if (spot && (await g.until(() => g.xp('Fishing') > xp, 20))) misses = 0;
                else if (++misses > 15) throw new Error('netting shrimps at Musa Point gave no xp');
            }
        }
    },
    spade: {
        id: 'spade',
        // For the red vine worms: only Jiminua sells spades, and the reachable spawns are behind doors.
        makes: () => [want('Spade', 1)],
        carry: () => [want('Coins', 100)],
        run: g => g.buy('jiminua', 'Spade', g.target('Spade'))
    },
    pass: {
        id: 'pass',
        // Starting the quest at the tunnel dwarf hands over the competition pass (mountain_dwarf.rs2).
        makes: () => [want('Fishing pass', 1)],
        async run(g) {
            await g.talk(/^mountain dwarf$/i, T.tunnelDwarf, /wondering what was down|^why not|if you were my friend|let's be friends|how am i meant|alright at fishing|another competition pass/i);
            await g.until(() => g.inv('Fishing pass') > 0, 4);
        }
    },
    worms: {
        id: 'worms',
        // A red vine worm per carp, dug in McGrubor's Wood with a spade (mcgrubors_wood.rs2).
        makes: g => [want('Red vine worm', carpsShort(g))],
        ready: g => g.held('Spade') > 0,
        carry: () => [want('Spade', 1)],
        async run(g) {
            const target = Math.max(0, g.target('Red vine worm') - (g.bank.get('red vine worm') ?? 0));
            // Guard dogs (level 44) roam the wood: keep walking when bitten instead of fighting back.
            await crossingSettings(g.sdk, (m, d) => g.log(m, d));
            await squeezeRailing(g, T.woodOutside, T.woodInside);
            try {
                await g.walk(T.redVine, 1);
                for (let i = 0; i < target + 4 && g.inv('Red vine worm') < target; i++) {
                    checkAbort(g.ctx);
                    const vine = pickVine(await g.sdk.scanNearbyLocs(6));
                    if (!vine) throw new Error(`no reachable red vine in view from ${JSON.stringify(g.here())}`);
                    const before = g.inv('Red vine worm');
                    const r = await g.bot.interactLoc(vine, /check/i);
                    if (!(await g.until(() => g.inv('Red vine worm') > before, 6))) g.log('dig missed', { vine: { id: vine.id, x: vine.x, z: vine.z }, detail: r.message });
                    await g.ticks(1);
                }
                if (g.inv('Red vine worm') < target) throw new Error(`dug ${g.inv('Red vine worm')} of ${target} red vine worms`);
            } finally {
                await squeezeRailing(g, T.woodInside, T.woodOutside);
            }
        }
    },
    carp: {
        id: 'carp',
        // Fishing Contest's raw giant carp, caught ahead and banked (tradeable, keeps): see runContest.
        makes: g => [want('Raw giant carp', g.n(1))],
        ready: g => g.held('Fishing pass') > 0 && g.held('Fishing rod') > 0 && g.held('Red vine worm') > 0 && g.held('Garlic') > 0 && g.level('Fishing') >= 10,
        carry: g => [want('Fishing pass', 1), want('Fishing rod', 1), want('Red vine worm', Math.min(MAX_CATCHES_PER_ROUND, carpsShort(g))), want('Garlic', 1), want('Coins', 20)],
        // Bank old carp and all bait first, then withdraw at most two worms.
        // Ordinary bait must not allow a third catch after the worms run out.
        stash: ['Raw giant carp', 'Red vine worm', 'Fishing bait'],
        run: runContest
    }
};

/**
 * Task sets, one per account, each in route order. southwest starts at Lumbridge
 * (where a fresh account lands) and ends at Draynor.
 */
export const SETS: Record<string, string[]> = {
    // Combat drops, Lumbridge first: the goblins train the account for the bears and
    // the hobgoblins beside the snape grass.
    drops: ['goblinmail', 'ratmeat', 'bearmeat', 'snapegrass'],
    // Karamja by ship from Port Sarim (monkeys by Musa Point, then Jiminua), on to Ardougne
    // from Brimhaven, then Port Khazard, Aemad, the Gnome Stronghold and the Barbarian Outpost.
    far: ['coins', 'hitpoints', 'monkeybones', 'jiminua', 'swamppaste', 'wool', 'gnome', 'planks'],
    // The Fishing Contest carp helper: garlic and a rod on the mainland, Fishing 10 and a
    // spade on Karamja, then the pass, the worms and the contest in Kandarin.
    carp: ['coins', 'hitpoints', 'garlic', 'rod', 'fishing', 'spade', 'pass', 'worms', 'carp'],
    southwest: ['coins', 'knife', 'buckets', 'egg', 'onions', 'logs', 'wydin', 'gerrant', 'mine', 'softclay', 'woad', 'mindbomb', 'bowl', 'silk', 'berries', 'dyes']
};

function progress(g: Gatherer, t: Task): number {
    return t.makes(g).reduce((a, w) => a + Math.min(g.held(w.item), w.count), 0);
}

async function carryFor(g: Gatherer, t: Task): Promise<void> {
    const short = () => (t.carry?.(g) ?? []).filter(w => w.count > 0 && g.inv(w.item) < w.count);
    const stash = (t.stash ?? []).some(item => g.inv(item) > 0);
    if (short().length === 0 && !stash) return;
    // Overseas without a bank, the task makes do with what is carried rather than sail for it.
    if (!g.bankHere()) return g.log('carry: no bank here', { task: t.id, short: short() });
    // What is short is judged after the bank's deposit, which takes the carried items in too.
    await g.atBank(async () => {
        for (const w of short()) {
            // Exactly what the task needs: the rest stays banked, out of reach of a death.
            if (norm(w.item) === 'coins') await g.setCoins(w.count);
            else await g.withdraw(w.item, w.count - g.inv(w.item));
        }
    });
}

export async function runGatherer(ctx: RoleContext): Promise<void> {
    const o = ctx.options;
    const setName = typeof o.set === 'string' ? o.set : 'southwest';
    const ids = SETS[setName];
    if (!ids) throw new Error(`questitems: unknown set ${setName} (sets: ${Object.keys(SETS).join(', ')})`);
    const only = Array.isArray(o.only) ? (o.only as string[]) : null;
    const skip = Array.isArray(o.skip) ? (o.skip as string[]) : [];
    const counts = parseCounts(o.counts);
    const tasks = ids.filter(id => (!only || only.includes(id)) && !skip.includes(id)).map(id => withCounts(TASKS[id]!, counts));
    const g = new Gatherer(ctx, o.spare !== false, typeof o.float === 'number' ? o.float : 400, counts);

    await prepare(ctx);
    const gathered = new Set(tasks.flatMap(t => t.makes(g).map(w => norm(w.item))));
    const unmatched = [...counts.keys()].filter(item => !gathered.has(item));
    if (unmatched.length > 0) throw new Error(`questitems: counts names items no selected task gathers: ${unmatched.join(', ')}`);
    await g.buyer.prepare();
    // A restarted contest has an unknown catch count: quit before banking or paying again.
    if (setName === 'carp' && inContest(g.here())) await leaveContest(g);
    await g.atBank();
    // Worn before the set leaves the first bank: Karamja, where it fights, has none.
    if (tasks.some(t => t.fights)) await g.gearUp();
    ctx.log('phase', { phase: setName, tasks: tasks.map(t => t.id) });

    const fails = new Map<string, number>();
    const parkedUntil = new Map<string, number>();
    while (!ctx.signal.aborted) {
        const now = Date.now();
        const open = tasks.filter(t => short(g, t.makes(g)).length > 0);
        if (open.length === 0) {
            await g.atBank();
            ctx.log('done', { set: setName, holdings: Object.fromEntries(tasks.flatMap(t => t.makes(g)).map(w => [w.item, g.held(w.item)])) });
            return;
        }
        const next = open.find(t => (parkedUntil.get(t.id) ?? 0) <= now && (t.ready?.(g) ?? true));
        if (!next) {
            ctx.log('waiting', { open: open.map(t => ({ id: t.id, parked: (parkedUntil.get(t.id) ?? 0) > now, short: short(g, t.makes(g)) })) });
            await g.ticks(200);
            continue;
        }
        ctx.log('phase', { phase: next.id, short: short(g, next.makes(g)) });
        const before = progress(g, next);
        try {
            await dismissDialogs(g.bot, g.sdk);
            if (g.sdk.getState()?.shop?.isOpen) await g.bot.closeShop();
            g.current = next;
            await carryFor(g, next);
            await next.run(g);
        } catch (e) {
            if (e instanceof Aborted || ctx.signal.aborted) break;
            ctx.log('task error', { task: next.id, error: String(e) });
        }
        const gained = progress(g, next) - before;
        if (gained > 0 || short(g, next.makes(g)).length === 0) fails.set(next.id, 0);
        else {
            const f = (fails.get(next.id) ?? 0) + 1;
            fails.set(next.id, f);
            // Three tries without progress park the task for half an hour; the rest go on.
            if (f >= 3) {
                parkedUntil.set(next.id, Date.now() + 30 * 60_000);
                fails.set(next.id, 0);
                ctx.log('task parked', { task: next.id, short: short(g, next.makes(g)) });
            }
        }
        ctx.log('task end', { task: next.id, gained, short: short(g, next.makes(g)) });
        if (freeSlots(g.sdk) < 8 && g.bankHere()) await g.atBank();
    }
    ctx.log('stopped');
}

export const role: Role = {
    name: 'questitems',
    produces: [
        /^(clay|copper ore|iron ore|logs|knife|bucket of water|bucket of milk|spade|rope|egg|pot of flour|banana|raw (beef|chicken|rat meat|bear meat|giant carp))$/i,
        /^(dwellberries|chocolate dust|snape grass|gold bar|ball of wool|monkey bones|swamp paste|torch|unlit torch|fishing rod|fishing bait|goblin mail|orange dye|blue dye|cadava berries)$/i,
        /^(wizard's mind bomb|silk|lobster pot|unfired bowl|plank|nails)$/i
    ],
    run: runGatherer
};

if (import.meta.main) await runStandalone(role);
