// Delay-free item actions at a bank booth (Herblore, gem cutting) or on two stacks
// (arrows), up to 5 per tick, driven on the decoded tick. Design and measured
// figures: docs/speedrun/skills/herblore.md section 9.
//
// pair  14 A + 14 B per inventory; each action uses a B on an A (secondary on
//       unfinished potion). Cycle: work -> opening -> banking -> refill -> work.
// tool  a tool kept in the inventory and up to 27 items it is used on (chisel on
//       uncut gems). Same cycle. A recipe's `keep` items stay held beside the
//       tool through every visit (thread beside the needle for hard leather
//       bodies, 26 a load), topped up from the bank when they cannot cover a load.
//
// `stow`: at the stop, one more visit deposits everything held, the tool and the
// kept items too, so the next step starts with a free inventory.
// `held`: the first load is the one already held (no booth click first); with
// `bank: false` it is the only one (the run ends 'load done'), for a wait in which
// other items held must stay out of the bank (the wine notes in Cooking's W1).
// `mixed` (tool mode): a load holds several recipes' inputs, filled in xp order
// (the cooking windows' diamond, ruby, emerald and sapphire). The blind plan is
// each recipe's slots ascending, all below the first hole: uncut_gem.rs2 deletes
// the first matching uncut gem and adds the cut one to the first free slot, so
// every cut stays in its slot whatever the order of the types.
// stack no bank: two stacks (arrowheads on headless arrows), `per` items an action.
//       One tier a tick by default. `fill`: when the best tier's stack runs out
//       inside the tick's room, the rest of the tick goes to the next-best tier
//       the seen level allows and the inventory holds (the slots never move, so
//       the sends stay blind). A tier the level reaches only when this tick's
//       burst lands is not filled in: the server would refuse it.
//
// The mixes are blind: the whole list for an inventory is fixed on the tick the
// refilled inventory is seen, and each tick sends the next ones without reading
// the state. That is safe because the content deletes the first matching item and
// adds the product to the first free slot (herblore.rs2 ~brew_potion), so as long
// as every A slot used lies below every B slot and below the first empty slot, the
// product of action i lands in A's slot i and no later action's slots change
// (`planMixes`). The client builds an OPHELDU from its own inventory view, so the
// first mixes wait for the tick that shows the refill.
//
// Bank visits use only All / 1 / 5 / 10 (synchronous in ActionExecutor; X opens
// the count dialog, which would finish in some later pass). Bank slots do not move
// while the bank is open (an emptied stack is removed on close, bank.rs2), so slots
// read on the visit's first tick stay valid for every packet of the visit.

import type { BankItem, BotWorldState, InventoryItem } from '../types.js';
import { userEventsOf } from './runtime.js';
import type { ProgramAction, ProgramContext, ProgramParams, TickProgram } from './types.js';
import { baseLevel, num, oneOf, skillXp, XP_RATE } from './util.js';

export type CycleMode = 'pair' | 'tool' | 'stack';

/** One recipe, with obj ids (the overlay resolves names; unfinished potions all share one name). */
export interface CycleRecipe {
    name: string;
    level: number;
    /** Base xp per action. */
    xp: number;
    a: number;
    /** pair: the item used on A (the secondary); stack: the second stack (arrowheads). */
    b?: number;
    /** tool: the item kept in the inventory and used on each A. */
    tool?: number;
    /** Everything an action leaves behind; a visit deposits each type. */
    products: number[];
    /** stack: items one action takes from each stack (default 15). */
    per?: number;
    /** tool: items held beside the tool through every visit, never deposited (thread). */
    keep?: KeepItem[];
}

export interface KeepItem {
    id: number;
    /**
     * The content wears one out every `every` actions (thread: one per 5 hard leather
     * bodies, leather.rs2 %thread_used). Absent: never consumed.
     */
    every?: number;
}

/**
 * The held count of a kept item that covers n actions in the worst case. The wear counter
 * is a server-only varp, so it may stand one short of wearing one out: the first action
 * can take one, then one every `every`.
 */
export function keepNeed(k: KeepItem, n: number): number {
    if (n <= 0) return 0;
    if (!k.every) return 1;
    return Math.floor((n - 1 + k.every - 1) / k.every) + 1;
}

/** The most actions `held` of a kept item covers in the worst case (keepNeed's inverse). */
export function keepCovers(k: KeepItem, held: number): number {
    if (held <= 0) return 0;
    if (!k.every) return Infinity;
    return k.every * (held - 1) + 1;
}

export interface CycleBooth {
    x: number;
    z: number;
    id: number;
    /** The booth's bank op (1-5). */
    option: number;
    /**
     * The tile the account banks from. Standing on it, the click goes unrouted (route: false):
     * the OPLOC alone, one user event, so it fits beside the last 4 actions and the cycle is 4
     * ticks. Anywhere else it is the routed click (MOVE_OPCLICK + OPLOC, two events: 5 ticks).
     */
    stand?: { x: number; z: number };
}

export const PAIR_LOAD = 14;
const INVENTORY = 28;
const TIMELINE_KEEP = 1200;
const VISITS_KEEP = 64;
/** Ticks the booth may be out of view (a login publishes the player before the scene) before the run faults. */
const BOOTH_GRACE = 5;
/** Ticks a visit waits for its deposits to show before it faults. */
const DEPOSIT_WAIT = 5;
/** Ticks the bank may stay open after the close before the close is sent again. */
const RECLOSE = 3;

export interface Mix {
    /** useItemOnItem sourceSlot: B (pair), the tool (tool), the arrowheads (stack). */
    src: number;
    dst: number;
}

/**
 * The blind action list for this inventory, at most `cap` long, or null when no
 * action can be sent blind. pair: A slots ascending, each with the next B slot; every
 * A used must lie below the first B and below the first empty slot, so each product
 * lands in its A's slot. tool: every A used below the first empty slot.
 */
export function planMixes(inventory: readonly InventoryItem[], r: CycleRecipe, mode: 'pair' | 'tool', cap = Infinity): Mix[] | null {
    const held = inventory.filter(i => i.count > 0);
    const occupied = new Set(held.map(i => i.slot));
    let hole = 0;
    while (hole < INVENTORY && occupied.has(hole)) hole++;
    const slotsOf = (id: number | undefined) => held.filter(i => i.id === id).map(i => i.slot).sort((x, y) => x - y);
    const as = slotsOf(r.a);
    if (mode === 'tool') {
        const tool = held.find(i => i.id === r.tool)?.slot;
        const n = Math.min(as.length, cap);
        if (tool === undefined || n <= 0 || !(as[n - 1]! < hole)) return null;
        return as.slice(0, n).map(dst => ({ src: tool, dst }));
    }
    const bs = slotsOf(r.b);
    const n = Math.min(as.length, bs.length, cap);
    if (n <= 0 || !(as[n - 1]! < hole && as[n - 1]! < bs[0]!)) return null;
    return as.slice(0, n).map((dst, i) => ({ src: bs[i]!, dst }));
}

/**
 * Tool mode's blind list for a load of several recipes' inputs, at most `cap` long, or null
 * when none can be sent blind: each recipe's `planMixes` in the order given (highest xp
 * first), so each type's slots go ascending. Each recipe's own check keeps every slot used
 * below the first hole, which is all a mixed load needs: every cut lands in its own slot, so
 * no later action's slot changes.
 */
export function planMixedLoad(inventory: readonly InventoryItem[], recipes: readonly CycleRecipe[], cap = Infinity): Array<{ mix: Mix; recipe: CycleRecipe }> | null {
    const out: Array<{ mix: Mix; recipe: CycleRecipe }> = [];
    for (const r of recipes) {
        if (out.length >= cap) break;
        const plan = planMixes(inventory, r, 'tool', cap - out.length);
        if (plan) for (const mix of plan) out.push({ mix, recipe: r });
    }
    return out.length ? out : null;
}

/** The bank buttons that withdraw exactly n: All when that is n, else 10s, a 5, then 1s. */
export function withdrawAmounts(n: number, allGives: number): number[] {
    if (!Number.isInteger(n) || n <= 0) throw new Error(`invalid withdraw amount ${n}`);
    if (n === allGives) return [-1];
    const out: number[] = Array(Math.floor(n / 10)).fill(10);
    if (n % 10 >= 5) out.push(5);
    for (let i = 0; i < n % 5; i++) out.push(1);
    return out;
}

type Packet =
    | { kind: 'deposit'; slot: number; id: number }
    | { kind: 'withdraw'; slot: number; id: number; amount: number }
    | { kind: 'close' }
    /** Wait until the deposits show, then read the bank and plan the withdrawals. */
    | { kind: 'barrier' };

/** canonical: the steady deposit-and-refill; reset: everything out, exact withdrawals; stow: everything out, nothing back. */
type VisitKind = 'canonical' | 'reset' | 'stow';

interface Visit {
    kind: VisitKind;
    /** Null until a barrier resolves it. With `mixed`, the load's highest-xp recipe. */
    recipe: CycleRecipe | null;
    /** `mixed`: the recipes the load was filled from, as the visit record names them. */
    label?: string;
    queue: Packet[];
    /** Actions the refilled inventory must allow. */
    expect: number;
    seen: number;
    depositIds: number[];
    waits: number;
    closeSent: number | null;
}

export interface VisitRecord {
    seen: number;
    kind: VisitKind;
    recipe: string | null;
    n: number;
    refill?: number;
}

export interface TickRecord {
    t: number;
    phase: Phase;
    /** Actions still to send when the tick began (work ticks only). */
    pending: number;
    /** Packets this tick: actions, booth clicks, bank packets and dialog continues. */
    sent: number;
    actions: number;
    /** Actions whose xp this tick's state shows. */
    landed: number;
}

/** What the program shares while it runs (`status.shared`). */
export interface ItemCycleShared {
    v: 1;
    mode: CycleMode;
    phase: Phase;
    recipe: string | null;
    timeline: TickRecord[];
    /** Over ticks that began with actions pending: packets sent that tick -> ticks. */
    sendsPerTick: Record<number, number>;
    /** Over ticks whose state showed xp: actions landed -> ticks. */
    xpDropsPerTick: Record<number, number>;
    cycleGaps: number[];
    visits: VisitRecord[];
}

export interface ItemCycleResult {
    /** Why it ended: 'target', 'maxActions', 'out of supplies' (stack mode), or null for a snapshot. */
    ended: string | null;
    /** Actions landed (from xp). */
    actions: number;
    /** Actions sent. */
    sent: number;
    visits: number;
    resets: number;
    drift: number;
    levelups: number;
    byRecipe: Record<string, number>;
    ticks: number;
    /** Ticks between consecutive bank-open ticks. */
    cycleGaps: number[];
    sendsPerTick: Record<number, number>;
    xpDropsPerTick: Record<number, number>;
    /** With `stow`: whether the last visit left the inventory empty. */
    stowed?: boolean;
}

export type Phase = 'opening' | 'banking' | 'refill' | 'work' | 'ending';

function int(value: unknown, name: string): number {
    if (!Number.isInteger(value)) throw new Error(`${name} must be an integer`);
    return value as number;
}

function recipesParam(value: unknown, mode: CycleMode): CycleRecipe[] {
    if (!Array.isArray(value) || value.length === 0) throw new Error('recipes must be a non-empty array of {name, level, xp, a, b?, tool?, products, per?}');
    return value.map((v, i) => {
        const at = `recipes[${i}]`;
        if (!v || typeof v !== 'object') throw new Error(`${at} must be an object`);
        const r = v as Record<string, unknown>;
        if (typeof r.name !== 'string' || !r.name) throw new Error(`${at}.name must be a string`);
        const xp = Number(r.xp);
        if (!(xp > 0)) throw new Error(`${at}.xp must be a positive number`);
        if (!Array.isArray(r.products)) throw new Error(`${at}.products must be an array of obj ids`);
        const recipe: CycleRecipe = { name: r.name, level: int(r.level, `${at}.level`), xp, a: int(r.a, `${at}.a`), products: r.products.map((p, k) => int(p, `${at}.products[${k}]`)) };
        if (mode === 'pair' || mode === 'stack') recipe.b = int(r.b, `${at}.b`);
        if (mode === 'tool') recipe.tool = int(r.tool, `${at}.tool`);
        if (mode !== 'stack' && recipe.products.length === 0) throw new Error(`${at}.products is empty: a visit would bank nothing`);
        if (r.per !== undefined) recipe.per = int(r.per, `${at}.per`);
        if (r.keep !== undefined) {
            if (mode !== 'tool') throw new Error(`${at}.keep applies to tool mode only`);
            if (!Array.isArray(r.keep)) throw new Error(`${at}.keep must be an array of {id, every?}`);
            recipe.keep = r.keep.map((k, j) => {
                const kk = k as Record<string, unknown> | null;
                if (!kk || typeof kk !== 'object') throw new Error(`${at}.keep[${j}] must be {id, every?}`);
                const item: KeepItem = { id: int(kk.id, `${at}.keep[${j}].id`) };
                if (kk.every !== undefined) {
                    item.every = int(kk.every, `${at}.keep[${j}].every`);
                    if (item.every < 1) throw new Error(`${at}.keep[${j}].every must be at least 1`);
                }
                if (item.id === recipe.a || item.id === recipe.tool) throw new Error(`${at}.keep[${j}] is the recipe's own input or tool`);
                return item;
            });
        }
        return recipe;
    });
}

function boothParam(value: unknown): CycleBooth {
    if (!value || typeof value !== 'object') throw new Error('booth must be {x, z, id, option} (pair and tool modes bank)');
    const b = value as Record<string, unknown>;
    const booth: CycleBooth = { x: int(b.x, 'booth.x'), z: int(b.z, 'booth.z'), id: int(b.id, 'booth.id'), option: int(b.option, 'booth.option') };
    if (b.stand !== undefined) {
        const st = b.stand as Record<string, unknown> | null;
        if (!st || typeof st !== 'object') throw new Error('booth.stand must be {x, z}');
        booth.stand = { x: int(st.x, 'booth.stand.x'), z: int(st.z, 'booth.stand.z') };
    }
    return booth;
}

function bump(h: Record<number, number>, key: number): void {
    h[key] = (h[key] ?? 0) + 1;
}

createItemCycle.params = ['mode', 'skill', 'recipes', 'booth', 'untilLevel', 'untilXp', 'maxActions', 'perTick', 'maxTicks', 'stow', 'held', 'bank', 'mixed', 'fill'] as const;
export function createItemCycle(params: ProgramParams): TickProgram {
    if (params.mode === undefined) throw new Error('mode is required: pair, tool or stack');
    const mode: CycleMode = oneOf(params.mode, ['pair', 'tool', 'stack'] as const, 'pair', 'mode');
    const skill = params.skill;
    if (typeof skill !== 'string' || !skill) throw new Error('skill must be a skill name');
    const recipes = recipesParam(params.recipes, mode);
    // Each key is read as params.<key> so index.test.ts's declared-equals-read check can see it.
    const flag = (name: 'stow' | 'held' | 'bank' | 'mixed' | 'fill', v: unknown): boolean | undefined => {
        if (v !== undefined && typeof v !== 'boolean') throw new Error(`${name} must be a boolean`);
        return v as boolean | undefined;
    };
    const stow = flag('stow', params.stow) === true;
    if (stow && mode === 'stack') throw new Error('stow applies to the pair and tool modes (stack mode never banks)');
    const heldStart = flag('held', params.held) === true;
    const banks = flag('bank', params.bank) !== false;
    const mixed = flag('mixed', params.mixed) === true;
    if (heldStart && mode === 'stack') throw new Error('held applies to the pair and tool modes (stack mode always works on what is held)');
    if (!banks && mode === 'stack') throw new Error('bank applies to the pair and tool modes (stack mode never banks)');
    if (!banks && !heldStart) throw new Error('bank: false needs held: true (with no visit, the held load is all there is)');
    if (!banks && stow) throw new Error('stow needs a bank visit: it cannot go with bank: false');
    if (mixed && mode !== 'tool') throw new Error('mixed applies to tool mode only');
    if (mixed && recipes.some(r => r.keep)) throw new Error('mixed loads take no keep items');
    const fill = flag('fill', params.fill) === true;
    if (fill && mode !== 'stack') throw new Error('fill applies to stack mode only');
    const booth = mode === 'stack' || (!banks && params.booth === undefined) ? null : boothParam(params.booth);
    const untilLevel = num(params.untilLevel, 0, 'untilLevel');
    const untilXp = num(params.untilXp, 0, 'untilXp');
    const maxActions = num(params.maxActions, Infinity, 'maxActions');
    if (!untilLevel && !untilXp && maxActions === Infinity) throw new Error('give untilLevel, untilXp or maxActions (the stopping target)');
    const perTick = num(params.perTick, 5, 'perTick');
    const maxTicks = num(params.maxTicks, Infinity, 'maxTicks');

    /** Items a visit leaves in the inventory: the tools and the kept items. */
    const kept = new Set(recipes.flatMap(r => [...(r.tool === undefined ? [] : [r.tool]), ...(r.keep ?? []).map(k => k.id)]));
    const known = new Set(recipes.flatMap(r => [r.a, ...(r.b === undefined ? [] : [r.b]), ...r.products]));
    // the highest-xp recipe first: `pick` takes the first fillable one
    const byXp = [...recipes].sort((x, y) => y.xp - x.xp);

    let started = false;
    let startTick = 0;
    let lastXp = 0;
    let lastLevel = 0;
    let phase: Phase = 'opening';
    let mixes: Mix[] = [];
    /** `mixed`: the recipe of each of `mixes`. */
    let mixRecipes: CycleRecipe[] = [];
    /** `mixed` and `fill`: the recipes of the actions sent and not yet seen landed, oldest first. */
    const inFlight: CycleRecipe[] = [];
    let heldPending = heldStart;
    let next = 0;
    /** The recipe whose actions are in flight: landed xp is credited to it (`mixed`: the load's first). */
    let current: CycleRecipe | null = null;
    let visit: Visit | null = null;
    let forceReset = false;
    let sentActions = 0;
    let landedTotal = 0;
    const byRecipe: Record<string, number> = {};
    let visits = 0;
    let resets = 0;
    let drift = 0;
    let levelups = 0;
    let lastSeen: number | null = null;
    let boothMissing = 0;
    let endReason: string | null = null;
    /** stow: the stop is reached and the last visit is under way; why the run stops. */
    let stowing = false;
    let stopReason = 'target';
    let stowed = false;
    let lastTick = 0;
    const shared: ItemCycleShared = { v: 1, mode, phase, recipe: null, timeline: [], sendsPerTick: {}, xpDropsPerTick: {}, cycleGaps: [], visits: [] };

    const remaining = () => maxActions - sentActions;
    const result = (ended: string | null): ItemCycleResult => ({
        ended,
        actions: landedTotal,
        sent: sentActions,
        visits,
        resets,
        drift,
        levelups,
        byRecipe: { ...byRecipe },
        ticks: lastTick - startTick,
        cycleGaps: [...shared.cycleGaps],
        sendsPerTick: { ...shared.sendsPerTick },
        xpDropsPerTick: { ...shared.xpDropsPerTick },
        ...(stow ? { stowed } : {})
    });

    return {
        stallTicks: 40,
        snapshot: () => result(null),
        onTick(ctx: ProgramContext) {
            const s = ctx.state;
            const t = ctx.tick;
            if (!s.player) return;
            if (!started) {
                started = true;
                startTick = t;
                lastXp = skillXp(s, skill);
                lastLevel = baseLevel(s, skill);
            }
            lastTick = t;

            const xp = skillXp(s, skill);
            let landed = 0;
            if (xp > lastXp && (mixed || fill)) {
                // credit the oldest actions in flight whose xp the gain covers (at least one)
                const gained = xp - lastXp;
                let acc = 0;
                while (inFlight.length && (landed === 0 || acc + inFlight[0]!.xp * XP_RATE <= gained + 0.5)) {
                    const r = inFlight.shift()!;
                    acc += r.xp * XP_RATE;
                    byRecipe[r.name] = (byRecipe[r.name] ?? 0) + 1;
                    landed++;
                }
                lastXp = xp;
                if (landed) {
                    landedTotal += landed;
                    bump(shared.xpDropsPerTick, landed);
                }
                ctx.count('actions', landed);
                ctx.progress();
            } else if (xp > lastXp) {
                const r = current;
                landed = r ? Math.max(1, Math.round((xp - lastXp) / (r.xp * XP_RATE))) : 0;
                lastXp = xp;
                if (r) {
                    landedTotal += landed;
                    byRecipe[r.name] = (byRecipe[r.name] ?? 0) + landed;
                    bump(shared.xpDropsPerTick, landed);
                }
                ctx.count('actions', landed);
                ctx.progress();
            }
            const level = baseLevel(s, skill);
            if (level > lastLevel) {
                levelups += level - lastLevel;
                ctx.count('levelups', level - lastLevel);
                ctx.mark('levelup');
                lastLevel = level;
            }

            let sent = 0;
            let acted = 0;
            let pending = 0;
            const tickPhase = phase;
            // sends are counted in user events, the unit the engine decodes 5 of a tick
            const room = (need = 1) => sent + need <= perTick && ctx.budget >= need;
            const send = (action: ProgramAction, what: string): boolean => {
                const need = userEventsOf(action);
                if (!room(need)) return false;
                const ok = ctx.send(action, what);
                if (ok) sent += need;
                return ok;
            };
            const record = () => {
                shared.timeline.push({ t, phase: tickPhase, pending, sent, actions: acted, landed });
                if (shared.timeline.length > TIMELINE_KEEP) shared.timeline.splice(0, shared.timeline.length - TIMELINE_KEEP);
                if (pending > 0) bump(shared.sendsPerTick, sent);
                shared.phase = phase;
                shared.recipe = current?.name ?? null;
                ctx.gauge('pending', mode === 'stack' ? pending : mixes.length - next);
                ctx.share(shared);
            };
            let closed = false;
            const finish = (ended: string) => {
                if (s.bank?.isOpen) send({ type: 'closeModal' }, 'close bank');
                record();
                closed = true;
                ctx.done(result(ended));
            };
            const fault = (reason: string, detail?: unknown) => {
                record();
                closed = true;
                ctx.fault(reason, { ...result(null), ...(detail === undefined ? {} : { detail }) });
            };

            const bankItems = (): BankItem[] => (s.bank?.items ?? []).filter(i => i.count > 0);
            const bankSlot = (id: number) => bankItems().find(i => i.id === id)?.slot;
            const bankCount = (id: number) => bankItems().filter(i => i.id === id).reduce((n, i) => n + i.count, 0);
            const invCount = (id: number) => s.inventory.filter(i => i.id === id).reduce((n, i) => n + i.count, 0);
            const total = (id: number) => bankCount(id) + invCount(id);
            const fillable = (r: CycleRecipe) => total(r.a) > 0 && (r.b === undefined || total(r.b) > 0) && (r.tool === undefined || total(r.tool) > 0) && (r.keep ?? []).every(k => total(k.id) > 0);
            const pick = () => byXp.find(r => r.level <= level && fillable(r)) ?? null;
            const supplies = () =>
                Object.fromEntries(
                    recipes.map(r => [
                        r.name,
                        { level: r.level, a: total(r.a), ...(r.b === undefined ? {} : { b: total(r.b) }), ...(r.tool === undefined ? {} : { tool: total(r.tool) }), ...(r.keep ? { keep: Object.fromEntries(r.keep.map(k => [k.id, total(k.id)])) } : {}) }
                    ])
                );
            const outOfSupplies = () => fault(`out of supplies: no recipe at ${skill} ${level} has both inputs in the bank or inventory`, { level, supplies: supplies() });

            const openBooth = (): boolean => {
                const b = booth!;
                if (!s.nearbyLocs.some(l => l.id === b.id && l.x === b.x && l.z === b.z)) {
                    if (++boothMissing > BOOTH_GRACE) {
                        fault(`no booth: loc ${b.id} at (${b.x},${b.z}) not in view`);
                        return false;
                    }
                    return true;
                }
                boothMissing = 0;
                const click = { type: 'interactLoc' as const, x: b.x, z: b.z, locId: b.id, optionIndex: b.option };
                const onStand = !!b.stand && s.player!.worldX === b.stand.x && s.player!.worldZ === b.stand.z;
                if (onStand && room(1)) {
                    if (send({ ...click, route: false }, 'booth (unrouted)')) {
                        ctx.count('boothClicks');
                        return true;
                    }
                    // the client found the tile out of reach: the routed click, now or next tick
                    ctx.count('unroutedRefused');
                }
                if (send(click, 'booth')) {
                    ctx.count('boothClicks');
                    ctx.count('routedClicks');
                }
                return true;
            };

            /** The recipes the level allows, highest xp first. */
            const eligible = () => byXp.filter(r => r.level <= level);

            /**
             * The blind list for the inventory as it stands: with `mixed`, every allowed recipe's
             * in xp order; else the first allowed recipe (highest xp) that plans.
             */
            const loadPlan = (): { mixes: Mix[]; by: CycleRecipe[] } | null => {
                if (mixed) {
                    const p = planMixedLoad(s.inventory, eligible(), remaining());
                    return p ? { mixes: p.map(x => x.mix), by: p.map(x => x.recipe) } : null;
                }
                for (const r of eligible()) {
                    const p = planMixes(s.inventory, r, mode as 'pair' | 'tool', remaining());
                    if (p) return { mixes: p, by: p.map(() => r) };
                }
                return null;
            };

            /**
             * `mixed`: the withdrawals that fill `room` slots from the allowed recipes in xp order,
             * All of each (exact counts for the last when `remaining()` caps it). Counts are bank
             * plus inventory, as a visit's deposits land ahead of them. Null when nothing is on
             * hand, or when an input is held but has no bank slot yet (read it after the deposits).
             */
            const mixedFill = (room: number): { packets: Packet[]; n: number; label: string } | null => {
                const packets: Packet[] = [];
                const names: string[] = [];
                let n = 0;
                for (const r of eligible()) {
                    if (room <= 0 || remaining() - n <= 0) break;
                    const tot = total(r.a);
                    if (tot <= 0) continue;
                    const slot = bankSlot(r.a);
                    if (slot === undefined) return null;
                    const k = Math.min(tot, room, remaining() - n);
                    for (const amount of withdrawAmounts(k, Math.min(tot, room))) packets.push({ kind: 'withdraw', slot, id: r.a, amount });
                    room -= k;
                    n += k;
                    names.push(r.name);
                }
                return n > 0 ? { packets, n, label: names.join('+') } : null;
            };

            /** Kept items not held now: each takes a slot when the visit withdraws it. */
            const keepsMissing = (r: CycleRecipe) => (r.keep ?? []).filter(k => invCount(k.id) === 0).length;

            /**
             * The kept-item withdrawals for a load of up to n, and the n they allow. A kept item
             * not held, or held short of the load at its worst-case wear, is withdrawn All (a
             * stack, one slot); what is then on hand caps the load.
             */
            const keepLoad = (r: CycleRecipe, n: number): { packets: Packet[]; n: number } | string => {
                const packets: Packet[] = [];
                for (const k of r.keep ?? []) {
                    let have = invCount(k.id);
                    const slot = bankSlot(k.id);
                    if (have < keepNeed(k, n) && slot !== undefined) {
                        packets.push({ kind: 'withdraw', slot, id: k.id, amount: -1 });
                        have += bankCount(k.id);
                    }
                    const covers = keepCovers(k, have);
                    if (covers <= 0) return `out of obj ${k.id}: none held or banked for ${r.name}`;
                    n = Math.min(n, covers);
                }
                return { packets, n };
            };

            /**
             * Withdrawals and close for a reset visit. Counts are bank plus inventory: the visit's
             * deposits go out ahead of these, so that is what the bank holds when they land.
             */
            const resetWithdrawals = (r: CycleRecipe): { packets: Packet[]; n: number } | string => {
                const out: Packet[] = [];
                const free = INVENTORY - s.inventory.filter(i => i.count > 0 && kept.has(i.id)).length;
                const withdraw = (id: number, n: number, allGives: number): string | null => {
                    const slot = bankSlot(id);
                    if (slot === undefined) return `obj ${id} is not in the bank`;
                    for (const amount of withdrawAmounts(n, allGives)) out.push({ kind: 'withdraw', slot, id, amount });
                    return null;
                };
                if (mode === 'tool') {
                    let room = free;
                    if (!s.inventory.some(i => i.id === r.tool && i.count > 0)) {
                        const err = withdraw(r.tool!, 1, -2);
                        if (err) return `no tool (${err})`;
                        room -= 1;
                    }
                    if (mixed) {
                        const f = mixedFill(room);
                        if (!f) return `no input for a ${r.name} load in the bank`;
                        out.push(...f.packets, { kind: 'close' });
                        return { packets: out, n: f.n };
                    }
                    room -= keepsMissing(r);
                    const totA = total(r.a);
                    const k = keepLoad(r, Math.min(totA, room, remaining()));
                    if (typeof k === 'string') return k;
                    out.push(...k.packets);
                    const err = withdraw(r.a, k.n, Math.min(totA, room));
                    if (err) return err;
                    out.push({ kind: 'close' });
                    return { packets: out, n: k.n };
                }
                const totA = total(r.a);
                const totB = total(r.b!);
                const n = Math.min(totA, totB, PAIR_LOAD, remaining());
                const errA = withdraw(r.a, n, totA);
                if (errA) return errA;
                // after n of A, All of B fills the free slots: 28 - n, which is n only at 14
                const errB = withdraw(r.b!, n, n === PAIR_LOAD ? n : totB);
                if (errB) return errB;
                out.push({ kind: 'close' });
                return { packets: out, n };
            };

            const planVisit = (): Visit | null => {
                const held = s.inventory.filter(i => i.count > 0);
                if (stowing) {
                    // the last visit: every item type out, the tool and the kept items too, nothing back
                    const ids = [...new Set(held.map(i => i.id))];
                    const queue: Packet[] = [...ids.map(id => ({ kind: 'deposit' as const, slot: held.find(i => i.id === id)!.slot, id })), { kind: 'close' }];
                    return { seen: t, depositIds: ids, waits: 0, closeSent: null, kind: 'stow', recipe: null, queue, expect: 0 };
                }
                const out = held.filter(i => !kept.has(i.id));
                const depositIds = [...new Set(out.map(i => i.id))];
                const deposits: Packet[] = depositIds.map(id => ({ kind: 'deposit', slot: out.find(i => i.id === id)!.slot, id }));
                const base = { seen: t, depositIds, waits: 0, closeSent: null };
                const deferred = (): Visit => ({ ...base, kind: 'reset', recipe: null, queue: [...deposits, { kind: 'barrier' }], expect: 0 });
                // an item the recipes do not name (a banknote on the first visit): read the bank after it lands
                if (out.some(i => !known.has(i.id))) return deferred();
                const r = pick();
                if (!r) {
                    outOfSupplies();
                    return null;
                }
                if (!forceReset && mode === 'pair') {
                    const productsOnly = out.length === PAIR_LOAD && out.every(i => i.slot < PAIR_LOAD && i.id !== r.a && i.id !== r.b);
                    if (productsOnly && bankCount(r.a) >= PAIR_LOAD && bankCount(r.b!) >= PAIR_LOAD && remaining() >= PAIR_LOAD) {
                        // B first: All fills exactly the 14 free slots 14-27; then the products go and A fills 0-13
                        const queue: Packet[] = [{ kind: 'withdraw', slot: bankSlot(r.b!)!, id: r.b!, amount: -1 }, ...deposits, { kind: 'withdraw', slot: bankSlot(r.a)!, id: r.a, amount: -1 }, { kind: 'close' }];
                        return { ...base, kind: 'canonical', recipe: r, queue, expect: PAIR_LOAD };
                    }
                }
                if (!forceReset && mode === 'tool' && mixed && held.some(i => i.id === r.tool)) {
                    // every non-kept item goes, then All of each input in xp order fills the room
                    const f = mixedFill(INVENTORY - held.filter(i => kept.has(i.id)).length);
                    if (f) return { ...base, kind: 'canonical', recipe: r, label: f.label, queue: [...deposits, ...f.packets, { kind: 'close' }], expect: f.n };
                }
                if (!forceReset && mode === 'tool' && !mixed) {
                    const toolHeld = held.some(i => i.id === r.tool);
                    const slot = bankSlot(r.a);
                    if (toolHeld && slot !== undefined) {
                        // every non-kept item goes, so All of A fills the free slots below the first hole
                        const room = INVENTORY - held.filter(i => kept.has(i.id)).length - keepsMissing(r);
                        const totA = total(r.a);
                        const k = keepLoad(r, Math.min(totA, room, remaining()));
                        if (typeof k === 'string') {
                            fault(k);
                            return null;
                        }
                        const queue: Packet[] = [...deposits, ...k.packets, ...withdrawAmounts(k.n, Math.min(totA, room)).map(amount => ({ kind: 'withdraw' as const, slot, id: r.a, amount })), { kind: 'close' }];
                        return { ...base, kind: 'canonical', recipe: r, queue, expect: k.n };
                    }
                }
                // a reset: everything but the tool goes, then exactly n of each input. Inputs held but not banked
                // get their bank slot only once deposited: read it after the deposits land.
                const inputs = mixed ? eligible().filter(x => total(x.a) > 0).map(x => x.a) : [r.a, ...(r.b === undefined ? [] : [r.b])];
                const toolNeeded = mode === 'tool' && !held.some(i => i.id === r.tool);
                if (inputs.some(id => bankSlot(id) === undefined) || (toolNeeded && bankSlot(r.tool!) === undefined)) return deferred();
                const w = resetWithdrawals(r);
                if (typeof w === 'string') {
                    fault(w);
                    return null;
                }
                return { ...base, kind: 'reset', recipe: r, queue: [...deposits, ...w.packets], expect: w.n };
            };

            const resolveBarrier = (v: Visit): boolean => {
                if (v.depositIds.some(id => invCount(id) > 0)) {
                    if (++v.waits > DEPOSIT_WAIT) fault(`deposits did not land in ${DEPOSIT_WAIT} ticks`, { pending: v.depositIds.filter(id => invCount(id) > 0) });
                    return false;
                }
                const r = pick();
                if (!r) {
                    send({ type: 'closeModal' }, 'close bank');
                    outOfSupplies();
                    return false;
                }
                const w = resetWithdrawals(r);
                if (typeof w === 'string') {
                    send({ type: 'closeModal' }, 'close bank');
                    fault(w);
                    return false;
                }
                v.recipe = r;
                v.expect = w.n;
                if (mixed) v.label = eligible().filter(x => total(x.a) > 0).map(x => x.name).join('+');
                v.queue.splice(0, 1, ...w.packets);
                return true;
            };

            const work = () => {
                pending = mixes.length - next;
                // a kept stack worn out mid-load: the rest would open the content's objbox and stall
                const worn = pending > 0 ? current?.keep?.find(k => k.every && invCount(k.id) === 0) : undefined;
                if (worn) {
                    if (s.dialog?.isOpen || s.modalOpen) send({ type: 'closeModal' }, 'close objbox');
                    return fault(`out of obj ${worn.id} mid-load: ${pending} ${current!.name} unsent (keepNeed assumed the worst-case wear)`, { pending, inventory: s.inventory.map(i => [i.slot, i.id, i.count]) });
                }
                while (next < mixes.length && room()) {
                    const m = mixes[next]!;
                    const by = mixRecipes[next];
                    next++;
                    if (send({ type: 'useItemOnItem', sourceSlot: m.src, targetSlot: m.dst }, `use ${m.src}->${m.dst}`)) {
                        sentActions++;
                        acted++;
                        if (mixed && by) inFlight.push(by);
                    } else {
                        ctx.count('actionRejected');
                    }
                }
                if (next < mixes.length) return;
                if (remaining() <= 0 && stow) {
                    // the stow visit's booth click rides with the last actions
                    beginStow('maxActions');
                    phase = 'opening';
                    openBooth();
                    return;
                }
                if (remaining() <= 0) {
                    // the last actions land next tick; end there so their xp is counted
                    phase = 'ending';
                    endReason = 'maxActions';
                    return;
                }
                if (!banks) {
                    // the held load was the only one: end as maxActions does
                    phase = 'ending';
                    endReason = 'load done';
                    return;
                }
                phase = 'opening';
                openBooth();
            };

            /** Take a planned load into `work`. */
            const install = (plan: { mixes: Mix[]; by: CycleRecipe[] }) => {
                current = plan.by[0] ?? null;
                mixes = plan.mixes;
                mixRecipes = plan.by;
                next = 0;
                phase = 'work';
            };

            const beginStow = (reason: string) => {
                if (stowing) return;
                stowing = true;
                stopReason = reason;
                ctx.mark('stow');
            };

            const opening = () => {
                if (stowing && !s.inventory.some(i => i.count > 0)) {
                    stowed = true;
                    return finish(stopReason);
                }
                if (s.bank?.isOpen) return startVisit();
                // a level-up page holds the booth: answer it ahead of the click when both fit
                if (s.dialog?.isOpen && room(3)) send({ type: 'clickDialogOption', optionIndex: 0 }, 'continue');
                openBooth();
            };

            const startVisit = () => {
                visits++;
                ctx.count('visits');
                ctx.mark('visit');
                ctx.progress();
                if (lastSeen !== null) shared.cycleGaps.push(t - lastSeen);
                lastSeen = t;
                const v = planVisit();
                if (!v) return;
                forceReset = false;
                if (v.kind === 'reset') {
                    resets++;
                    ctx.count('resets');
                }
                visit = v;
                shared.visits.push({ seen: t, kind: v.kind, recipe: v.label ?? v.recipe?.name ?? null, n: v.expect });
                if (shared.visits.length > VISITS_KEEP) shared.visits.shift();
                phase = 'banking';
                banking();
            };

            const banking = () => {
                const v = visit!;
                if (!s.bank?.isOpen && v.seen !== t) {
                    // closed before the visit's close (a click elsewhere): start over with a reset
                    ctx.count('bankLost');
                    forceReset = true;
                    visit = null;
                    phase = 'opening';
                    return opening();
                }
                while (v.queue.length && room()) {
                    const p = v.queue[0]!;
                    if (p.kind === 'barrier') {
                        if (!resolveBarrier(v)) return;
                        const rec = shared.visits[shared.visits.length - 1];
                        if (rec && rec.seen === v.seen) {
                            rec.recipe = v.label ?? v.recipe!.name;
                            rec.n = v.expect;
                        }
                        continue;
                    }
                    v.queue.shift();
                    if (p.kind === 'deposit') send({ type: 'bankDeposit', slot: p.slot, amount: -1 }, `deposit obj ${p.id}`);
                    else if (p.kind === 'withdraw') send({ type: 'bankWithdraw', slot: p.slot, amount: p.amount }, `withdraw obj ${p.id} x${p.amount}`);
                    else {
                        send({ type: 'closeModal' }, 'close bank');
                        v.closeSent = t;
                        phase = 'refill';
                        return;
                    }
                    ctx.progress();
                }
            };

            const refill = () => {
                const v = visit!;
                if (s.bank?.isOpen) {
                    if (t - v.closeSent! >= RECLOSE) {
                        send({ type: 'closeModal' }, 'close bank again');
                        v.closeSent = t;
                        ctx.count('reclose');
                    }
                    return;
                }
                if (v.kind === 'stow') {
                    if (v.depositIds.some(id => invCount(id) > 0)) {
                        if (++v.waits > DEPOSIT_WAIT) fault(`the stow visit left items held after ${DEPOSIT_WAIT} ticks`, { inventory: s.inventory.map(i => [i.slot, i.id, i.count]) });
                        return;
                    }
                    stowed = true;
                    return finish(stopReason);
                }
                if (stowing) {
                    // the stop came while a load was being withdrawn: go back for the stow visit
                    visit = null;
                    phase = 'opening';
                    return opening();
                }
                const r = v.recipe!;
                const mixedPlan = mixed ? loadPlan() : null;
                const plan = mixed ? (mixedPlan?.mixes ?? null) : planMixes(s.inventory, r, mode as 'pair' | 'tool', remaining());
                if (!plan || plan.length < v.expect) {
                    drift++;
                    ctx.count('drift');
                    const detail = { recipe: r.name, expect: v.expect, planned: plan?.length ?? 0, inventory: s.inventory.map(i => [i.slot, i.id, i.count]) };
                    if (v.kind === 'reset') return fault('layout drift after a reset visit', detail);
                    ctx.log(`drift after a ${v.kind} visit: ${JSON.stringify(detail)}`);
                    forceReset = true;
                    visit = null;
                    phase = 'opening';
                    return opening();
                }
                ctx.mark('refill');
                ctx.progress();
                const rec = shared.visits[shared.visits.length - 1];
                if (rec && rec.seen === v.seen) rec.refill = t;
                visit = null;
                install(mixedPlan ?? { mixes: plan, by: plan.map(() => r) });
                work();
            };

            const stack = () => {
                const has = (id: number | undefined) => s.inventory.find(i => i.id === id && i.count > 0);
                const usable = byXp.filter(x => x.level <= level && has(x.a) && has(x.b));
                const r = usable[0];
                if (!r) return finish('out of supplies');
                if (remaining() <= 0) return finish('maxActions');
                current = r;
                if (!fill) {
                    const heads = has(r.b)!;
                    const shafts = has(r.a)!;
                    pending = Math.ceil(Math.min(heads.count, shafts.count) / (r.per ?? 15));
                    const k = Math.min(pending, remaining());
                    for (let i = 0; i < k && room(); i++) {
                        if (!send({ type: 'useItemOnItem', sourceSlot: heads.slot, targetSlot: shafts.slot }, `use ${heads.slot}->${shafts.slot}`)) break;
                        sentActions++;
                        acted++;
                    }
                    return;
                }
                // fill: tier after tier, each action taking min(per, its tips, the shared stack left)
                const left = new Map<number, number>();
                const count = (it: InventoryItem) => left.get(it.slot) ?? it.count;
                pending = 0;
                for (const x of usable) {
                    const heads = has(x.b)!;
                    const shafts = has(x.a)!;
                    const per = x.per ?? 15;
                    for (let h = count(heads), a = count(shafts); h > 0 && a > 0; ) {
                        const n = Math.min(per, h, a);
                        h -= n;
                        a -= n;
                        pending++;
                        if (remaining() <= 0 || !room()) continue;
                        if (!send({ type: 'useItemOnItem', sourceSlot: heads.slot, targetSlot: shafts.slot }, `use ${heads.slot}->${shafts.slot}`)) continue;
                        sentActions++;
                        acted++;
                        inFlight.push(x);
                        left.set(heads.slot, h);
                        left.set(shafts.slot, a);
                    }
                }
            };

            const atTarget = !!((untilLevel && level >= untilLevel) || (untilXp && xp >= untilXp));
            if (atTarget && !stow) return finish('target');
            if (endReason) return finish(endReason);
            if (t - startTick > maxTicks) return fault(`still running after ${maxTicks} ticks`);
            if (stow && !stowing && (atTarget || (remaining() <= 0 && next >= mixes.length))) {
                // the stop: no more actions, the last visit next (a run started past it only stows)
                beginStow(atTarget ? 'target' : 'maxActions');
                if (phase === 'work') phase = 'opening';
            }
            if (heldPending && !stowing) {
                // `held`: the first load is the one held now; no booth click before it
                heldPending = false;
                const plan = loadPlan();
                if (!plan) return fault('held load not plannable', { level, inventory: s.inventory.map(i => [i.slot, i.id, i.count]) });
                install(plan);
            }

            if (mode === 'stack') stack();
            else if (phase === 'work') work();
            else if (phase === 'opening') opening();
            else if (phase === 'banking') banking();
            else if (phase === 'refill') refill();
            if (!closed) record();
        }
    };
}
