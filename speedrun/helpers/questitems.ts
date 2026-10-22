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
import { advance, classifyPage, resetDialogueMemory } from '../lib/dialogue';
import { waitUntil } from '../lib/wait';
import { Buyer, type Tile } from './buyer';
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
}

/** Bank booths the loop uses, ground level only (Lumbridge's bank is upstairs). */
const BANKS: Tile[] = [
    { x: 3092, z: 3245 }, // Draynor
    { x: 2946, z: 3369 }, // Falador west
    { x: 3013, z: 3356 }, // Falador east
    { x: 3185, z: 3436 }, // Varrock west
    { x: 3253, z: 3421 }, // Varrock east
    { x: 3094, z: 3491 } // Edgeville
];

/** Kept in the inventory across bank visits: the float and the tools tasks reuse. */
const KEEP = /^(coins|bronze pickaxe|bronze axe|tinderbox|bucket)$/i;
/** Tutorial food, eaten while pickpocketing. */
const FOOD = /^(shrimps|bread|cooked chicken|cooked meat|anchovies)$/i;

const norm = (s: string) => s.trim().toLowerCase();
const exact = (name: string) => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
const cheb = (a: Tile, b: Tile) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

export class Gatherer {
    /** Bank counts by lower-cased name, as of the last bank visit. */
    bank = new Map<string, number>();
    readonly buyer: Buyer;

    constructor(
        readonly ctx: RoleContext,
        readonly spare: boolean,
        readonly float: number
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
    held(name: string): number {
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
    async walk(t: Tile, tolerance = 3): Promise<void> {
        await walkNear(this.ctx, t.x, t.z, tolerance);
    }

    // ------------------------------------------------------------------ bank

    private readBank(): void {
        const m = new Map<string, number>();
        for (const i of this.sdk.getBankItems()) m.set(norm(i.name), (m.get(norm(i.name)) ?? 0) + i.count);
        this.bank = m;
    }

    /** Open the nearest bank, deposit everything but KEEP, run `body`, report and close. */
    async atBank<T>(body: () => Promise<T> = async () => undefined as T): Promise<T> {
        const here = this.here();
        const at = [...BANKS].sort((a, b) => cheb(a, here) - cheb(b, here))[0]!;
        await openBank(this.ctx, at);
        try {
            await depositAllExcept(this.sdk, i => KEEP.test(i.name));
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

    /** Buy at a SHOPS shop until the account holds `target` (bank + inventory). */
    async buy(shop: string, item: string, target: number, maxWaitTicks = 400): Promise<void> {
        // The buyer counts only the inventory here, so ask it for the bank's shortfall.
        const quantity = target - (this.bank.get(norm(item)) ?? 0);
        if (quantity <= this.inv(item)) return;
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
    ]
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
        // and the clay the bowl task turns into pots for Crafting 8.
        makes: g => [want('Copper ore', g.n(4)), want('Iron ore', g.n(2)), want('Clay', clayReserve(g) + clayForBowls(g))],
        async run(g) {
            const copper = g.target('Copper ore');
            const iron = g.target('Iron ore');
            const clay = g.target('Clay');
            await g.mine(/copper/i, T.rimmingtonMine, () => g.held('Copper ore') >= copper && g.level('Mining') >= 15);
            await g.mine(/iron/i, T.rimmingtonMine, () => g.held('Iron ore') >= iron);
            await g.mine(/clay/i, T.rimmingtonMine, () => g.held('Clay') >= clay);
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
    southwest: ['coins', 'knife', 'buckets', 'egg', 'onions', 'logs', 'wydin', 'gerrant', 'mine', 'softclay', 'woad', 'mindbomb', 'bowl', 'silk', 'berries', 'dyes']
};

function progress(g: Gatherer, t: Task): number {
    return t.makes(g).reduce((a, w) => a + Math.min(g.held(w.item), w.count), 0);
}

async function carryFor(g: Gatherer, t: Task): Promise<void> {
    const need = (t.carry?.(g) ?? []).filter(w => w.count > 0 && g.inv(w.item) < w.count);
    if (need.length === 0) return;
    await g.atBank(async () => {
        for (const w of need) {
            if (norm(w.item) === 'coins') await g.setCoins(Math.max(w.count, g.inv('Coins')));
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
    const g = new Gatherer(ctx, o.spare !== false, typeof o.float === 'number' ? o.float : 400);

    await prepare(ctx);
    const gathered = new Set(tasks.flatMap(t => t.makes(g).map(w => norm(w.item))));
    const unmatched = [...counts.keys()].filter(item => !gathered.has(item));
    if (unmatched.length > 0) throw new Error(`questitems: counts names items no selected task gathers: ${unmatched.join(', ')}`);
    await g.buyer.prepare();
    await g.atBank();
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
        if (freeSlots(g.sdk) < 8) await g.atBank();
    }
    ctx.log('stopped');
}

export const role: Role = {
    name: 'questitems',
    produces: [
        /^(clay|copper ore|iron ore|logs|knife|bucket of water|bucket of milk|spade|rope|egg|pot of flour|banana|raw (beef|chicken|rat meat|bear meat|giant carp))$/i,
        /^(dwellberries|chocolate dust|snape grass|gold bar|ball of wool|monkey bones|swamp paste|torch|unlit torch|fishing rod|fishing bait|goblin mail|orange dye|blue dye|cadava berries)$/i,
        /^(wizard's mind bomb|silk|lobster pot|unfired bowl|plank|steel nails)$/i
    ],
    run: runGatherer
};

if (import.meta.main) await runStandalone(role);
