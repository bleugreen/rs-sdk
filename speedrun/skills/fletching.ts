// S18d-fallback, Fletching standalone (STEP-MANIFEST.md entry 32; docs/speedrun/skills/fletching.md).
// Fletching's own path is inside S18's stuns (thieving.ts's stun pack, the `arrows` preset): this
// step finishes it off-stun when S18 ends below 99 (a stun-pack fault, a knife-off night, a short
// courier). Arrowheads on headless arrows, 15 an action, all stacks, no bank, in place: the page's
// item-cycle program in stack mode (server/webclient/src/bot/programs/item-cycle.ts, driven by
// lib/item-cycle.ts) sends ceil(stack / 15) actions a tick, at most 5, best tier first, re-picking
// the tier from the observed level every tick. One OPHELDU is one user event and there are no loc
// clicks, so a tick carries 5 actions.
//
// The rune keep. S27 fires the 570 rune arrows SCORED fletches from its 570 rune arrowtips, so
// the step ends only with `keepRune` rune arrows held (pack and quiver). Two things could lose
// them, and the plan guards both. Below 75, lower tiers share the headless arrows the rune tips
// need: when going best-first to 75 would leave less than the rune tips' share plus a margin for
// the page's level lag at the band edges, the run to 75 is capped with `maxActions`, which holds
// whatever the lag (an action takes at most 15). And when Fletching reaches
// `toLevel` with rune tips still held, a last run fletches rune only until the keep is made. In
// S18 the tiers go best first (stun-actions.ts STUN_PRESETS.arrows): the adamant from Fletching
// 60, the rune from 75; the courier delivers the rune tips on the top-up after the adamant's, by
// about stun 45-50 (thieving.ts topUpAsk), so a short band leaves rune tips held, not on the courier. The step refuses up front when the stock cannot end
// with the keep.
//
// Free slots. `make_arrows` never checks space (arrows.rs2) and INV_ADD drops what does not fit at
// the player's feet (InvOps.ts), so each new arrow stack needs a free slot on the tier's first
// action, unless that action empties an input stack first (inv_del runs before inv_add). The plan
// walks the slots action by action and the step refuses where a stack would not fit.
//
// The step re-plans from observed state before each program run, so a resume at any point (or a
// run cut short) picks up where the stacks are; every tick boundary is logout-safe.

import type { BotWorldState } from '../../sdk/types';
import { ARROW_TIERS, ARROWS_PER_ACTION, HEADLESS_ARROW, type ArrowTier, type ArrowTierRow } from '../lib/arrows';
import { runItemCycle, type ItemCycleResult, type ItemRecipe } from '../lib/item-cycle';
import { waitUntil } from '../lib/wait';
import { levelForXp, XP_RATE, xpForLevel } from '../lib/xp';
import type { Observed, Step, StepContext } from '../runner/step';

export const skill = 'fletching';

export const STEP_ID = 'S18d-fallback';
export const STEP_NAME = `${STEP_ID} fletching`;

/** Rune arrows S27 fires, made from S18's 570 rune arrowtips (the inventory ledger's S18 row). */
export const RUNE_KEEP = 570;
/** User events the engine decodes per player per tick (ClientGameProtCategory.ts). */
export const PER_TICK = 5;
const INVENTORY = 28;
const RUNE = ARROW_TIERS.find(t => t.tier === 'rune')!;
/**
 * The headroom over the rune tips' share below which the run to 75 is capped. The page picks the
 * tier from the level it last saw, so at each band edge (15, 30, 45, 60, 75) a burst or two still
 * goes to the old tier and the route spends more headless arrows than the plan's walk. 2 ticks of
 * 5 actions of 15 at each of the five edges; the cap itself holds whatever the lag, since an action
 * takes at most 15.
 */
export const RESERVE_MARGIN = 2 * PER_TICK * ARROWS_PER_ACTION * 5;
/** Program runs one step makes at most (reserve, route, rune), plus one re-plan after a short run. */
const MAX_RUNS = 4;

export interface FletchingOptions {
    /** Target level (default 99). */
    toLevel?: number;
    /** Rune arrows held (pack and quiver) when the step ends (default RUNE_KEEP; 0: no keep). */
    keepRune?: number;
    /** Tiers to play (default all): the demo's bronze only. */
    tiers?: ArrowTier[];
    /** A cap on actions (the demo's 20 ticks): the step then ends there, not at `toLevel`. */
    maxActions?: number;
    /** Arrows are members-only (arrows.rs2); the state carries no world flag, the demo is members. */
    members?: boolean;
    log?: (msg: string, data?: Record<string, unknown>) => void;
    /** Each program run's plan and result, for the lab. */
    onRun?: (run: FletchRun, result: ItemCycleResult) => void;
}

// ------------------------------------------------------------------ reading the state

function fletchSkill(s: BotWorldState) {
    return s.skills.find(k => k.name.toLowerCase() === 'fletching');
}

export function fletchingLevel(s: BotWorldState): number {
    return fletchSkill(s)?.baseLevel ?? 1;
}

export function fletchingXp(s: BotWorldState): number {
    return fletchSkill(s)?.experience ?? 0;
}

const count = (items: BotWorldState['inventory'], id: number) => items.filter(i => i.id === id).reduce((n, i) => n + Math.max(0, i.count), 0);

/** What the plan needs from the state: the stacks by tier, the quiver's rune arrows, the free slots. */
export interface FletchStock {
    /** Game xp. */
    xp: number;
    headless: number;
    tips: Partial<Record<ArrowTier, number>>;
    /** Finished arrows in the pack, by tier. */
    arrows: Partial<Record<ArrowTier, number>>;
    /** Rune arrows worn in the quiver. */
    runeWorn: number;
    free: number;
}

export function stockOf(s: BotWorldState): FletchStock {
    const inv = s.inventory;
    return {
        xp: Math.max(0, fletchingXp(s)),
        headless: count(inv, HEADLESS_ARROW),
        tips: Object.fromEntries(ARROW_TIERS.map(t => [t.tier, count(inv, t.tips)])),
        arrows: Object.fromEntries(ARROW_TIERS.map(t => [t.tier, count(inv, t.arrow)])),
        runeWorn: count(s.equipment ?? [], RUNE.arrow),
        free: INVENTORY - inv.filter(i => i.count > 0).length
    };
}

export function runeArrowsOf(st: FletchStock): number {
    return (st.arrows.rune ?? 0) + st.runeWorn;
}

/** Rune arrows this stock can still make: rune tips with headless arrows, at Fletching 75. */
function runeFletchable(st: FletchStock): number {
    return levelForXp(st.xp) >= RUNE.level ? Math.min(st.tips.rune ?? 0, st.headless) : 0;
}

// ------------------------------------------------------------------ the plan

/**
 * One program run. `reserve`: below 75, lower tiers capped so the rune tips keep their headless
 * arrows; `route`: best tier first to `toLevel`; `rune`: past `toLevel`, rune only, to the keep.
 */
export interface FletchRun {
    kind: 'reserve' | 'route' | 'rune' | 'capped';
    tiers: ArrowTier[];
    untilLevel?: number;
    maxActions?: number;
    actions: number;
    byTier: Partial<Record<ArrowTier, number>>;
    /**
     * The program's work ticks: 5 actions a tick; with `fill` a tier switch shares its tick when the
     * tick's starting level already allows the new tier, else it leaves the tick short.
     */
    ticks: number;
    levelFrom: number;
    levelTo: number;
}

export interface FletchPlan {
    runs: FletchRun[];
    actions: number;
    ticks: number;
    level: number;
    xp: number;
    reaches: boolean;
    /** Base xp still missing at `toLevel` (0 when it reaches). */
    baseShort: number;
    /** Rune arrows held at the end, pack and quiver. */
    runeArrows: number;
    keeps: boolean;
    /** Why a planned action has no slot for its new arrow stack. */
    slotFault?: string;
    /** Why the keep is out of reach because reaching 75 needs the rune tips' headless arrows. */
    reserveBlock?: string;
    left: FletchStock;
}

function tierRows(tiers?: readonly ArrowTier[]): ArrowTierRow[] {
    if (!tiers) return [...ARROW_TIERS];
    for (const t of tiers) if (!ARROW_TIERS.some(r => r.tier === t)) throw new Error(`unknown arrow tier '${t}' (have: ${ARROW_TIERS.map(r => r.tier).join(', ')})`);
    return ARROW_TIERS.filter(r => tiers.includes(r.tier));
}

const clone = (st: FletchStock): FletchStock => ({ ...st, tips: { ...st.tips }, arrows: { ...st.arrows } });

/**
 * The page's stack mode, action by action: the best tier the level allows with both stacks held,
 * min(15, tips, headless) an action, until `untilLevel` or `maxActions`. Mutates `st`.
 */
function simulate(st: FletchStock, rows: readonly ArrowTierRow[], kind: FletchRun['kind'], stop: { untilLevel?: number; maxActions?: number }): { run: FletchRun; slotFault?: string } {
    const levelFrom = levelForXp(st.xp);
    const byTier: FletchRun['byTier'] = {};
    let n = 0;
    let slotFault: string | undefined;
    // The page's ticks: 5 actions a tick, and with `fill` a tier switch stays in its tick only when
    // the level the tick started from already allows the new tier.
    let ticks = 0;
    let inTick = 0;
    let tickLevel = levelFrom;
    let tickTier: ArrowTier | null = null;
    for (;;) {
        const level = levelForXp(st.xp);
        if (stop.untilLevel !== undefined && level >= stop.untilLevel) break;
        if (stop.maxActions !== undefined && n >= stop.maxActions) break;
        const r = rows.find(x => x.level <= level && (st.tips[x.tier] ?? 0) > 0 && st.headless > 0);
        if (!r) break;
        const tips = st.tips[r.tier]!;
        const k = Math.min(ARROWS_PER_ACTION, tips, st.headless);
        if (inTick === 0 || inTick >= PER_TICK || (r.tier !== tickTier && r.level > tickLevel)) {
            ticks++;
            inTick = 0;
            tickLevel = level;
        }
        inTick++;
        tickTier = r.tier;
        // inv_del runs before inv_add: an input stack this action empties frees its slot first
        const freed = (k === tips ? 1 : 0) + (k === st.headless ? 1 : 0);
        if ((st.arrows[r.tier] ?? 0) === 0) {
            if (st.free + freed < 1) {
                slotFault = `no free slot for ${r.tier} arrows at Fletching ${level}: make_arrows does not check space and the engine drops what does not fit (InvOps INV_ADD), so free a slot first`;
                break;
            }
            st.free -= 1;
        }
        st.free += freed;
        st.tips[r.tier] = tips - k;
        st.headless -= k;
        st.arrows[r.tier] = (st.arrows[r.tier] ?? 0) + k;
        st.xp += k * r.xpPerArrow * XP_RATE;
        byTier[r.tier] = (byTier[r.tier] ?? 0) + 1;
        n++;
    }
    const run: FletchRun = {
        kind,
        tiers: rows.map(r => r.tier),
        ...(stop.untilLevel !== undefined ? { untilLevel: stop.untilLevel } : {}),
        ...(stop.maxActions !== undefined ? { maxActions: stop.maxActions } : {}),
        actions: n,
        byTier,
        ticks,
        levelFrom,
        levelTo: levelForXp(st.xp)
    };
    return { run, ...(slotFault ? { slotFault } : {}) };
}

export function planFletch(stock: FletchStock, opts: FletchingOptions = {}): FletchPlan {
    const to = opts.toLevel ?? 99;
    const rows = tierRows(opts.tiers);
    const runeAllowed = rows.some(r => r.tier === 'rune');
    const keep = opts.keepRune ?? RUNE_KEEP;
    const st = clone(stock);
    const runs: FletchRun[] = [];
    let slotFault: string | undefined;
    let reserveBlock: string | undefined;
    const needRune = () => (runeAllowed ? Math.max(0, keep - runeArrowsOf(st)) : 0);
    const add = (r: { run: FletchRun; slotFault?: string }) => {
        if (r.run.actions > 0) runs.push(r.run);
        slotFault ??= r.slotFault;
    };

    if (opts.maxActions !== undefined) {
        add(simulate(st, rows, 'capped', { untilLevel: to, maxActions: opts.maxActions }));
    } else {
        const lower = rows.filter(r => r.tier !== 'rune');
        const gate = Math.min(RUNE.level, to);
        if (levelForXp(st.xp) < gate && needRune() > 0 && (st.tips.rune ?? 0) > 0) {
            // Would best-first to 75 leave the rune tips their headless arrows, with the page's lag to spare?
            const reserve = Math.min(needRune(), st.tips.rune ?? 0);
            const probe = clone(st);
            simulate(probe, lower, 'route', { untilLevel: gate });
            if (probe.headless - reserve < RESERVE_MARGIN) {
                const cap = Math.floor(Math.max(0, st.headless - reserve) / ARROWS_PER_ACTION);
                add(simulate(st, lower, 'reserve', { untilLevel: gate, maxActions: cap }));
                if (!slotFault && levelForXp(st.xp) < gate) {
                    reserveBlock = `reaching Fletching ${gate} needs the headless arrows the rune tips need: ${stock.headless} headless arrows, ${reserve} kept for rune, take the lower tiers only to Fletching ${levelForXp(st.xp)}`;
                }
            }
        }
        if (!slotFault && !reserveBlock && levelForXp(st.xp) < to) add(simulate(st, rows, 'route', { untilLevel: to }));
        if (!slotFault && !reserveBlock && levelForXp(st.xp) >= Math.max(to, RUNE.level) && needRune() > 0) {
            const n = Math.ceil(Math.min(needRune(), st.tips.rune ?? 0, st.headless) / ARROWS_PER_ACTION);
            if (n > 0) add(simulate(st, [RUNE], 'rune', { maxActions: n }));
        }
    }

    const level = levelForXp(st.xp);
    const target = xpForLevel(to);
    const actions = runs.reduce((a, r) => a + r.actions, 0);
    return {
        runs,
        actions,
        ticks: runs.reduce((a, r) => a + r.ticks, 0),
        level,
        xp: st.xp,
        reaches: level >= to,
        baseShort: Math.max(0, Math.ceil((target - st.xp) / XP_RATE)),
        runeArrows: runeArrowsOf(st),
        keeps: keep <= 0 || runeArrowsOf(st) >= keep,
        ...(slotFault ? { slotFault } : {}),
        ...(reserveBlock ? { reserveBlock } : {}),
        left: st
    };
}

/** The program's recipe for a tier (item-cycle.ts CycleRecipe, stack mode: a headless, b tips). */
export function recipeFor(row: ArrowTierRow): ItemRecipe {
    return { name: `${row.tier}arrow`, level: row.level, xp: row.xpPerArrow * ARROWS_PER_ACTION, a: HEADLESS_ARROW, b: row.tips, products: [row.arrow], per: ARROWS_PER_ACTION };
}

function describe(plan: FletchPlan): string {
    const by: Partial<Record<ArrowTier, number>> = {};
    for (const r of plan.runs) for (const [t, n] of Object.entries(r.byTier)) by[t as ArrowTier] = (by[t as ArrowTier] ?? 0) + n!;
    const used = ARROW_TIERS.filter(t => by[t.tier]).map(t => `${t.tier} ${by[t.tier]}`).join(', ');
    return used ? `${plan.actions} actions: ${used}` : 'nothing to fletch at this level';
}

// ------------------------------------------------------------------ the step

/** Fletching at the target, and the rune keep made or nothing left to make it from. */
export function finished(s: BotWorldState, opts: FletchingOptions = {}): boolean {
    if (fletchingLevel(s) < (opts.toLevel ?? 99)) return false;
    const keep = opts.keepRune ?? RUNE_KEEP;
    if (keep <= 0 || (opts.tiers && !opts.tiers.includes('rune'))) return true;
    const st = stockOf(s);
    return runeArrowsOf(st) >= keep || runeFletchable(st) === 0;
}

export function preconditions(s: BotWorldState, opts: FletchingOptions = {}): true | string {
    if (!s.inGame || !s.player) return 'not in game';
    if (opts.maxActions === undefined && finished(s, opts)) return true; // nothing to do: S18's stuns got there
    if (opts.members === false) return 'not a members world: arrows are members-only (arrows.rs2)';
    let rows: ArrowTierRow[];
    try {
        rows = tierRows(opts.tiers);
    } catch (e) {
        return e instanceof Error ? e.message : String(e);
    }
    const st = stockOf(s);
    const level = fletchingLevel(s);
    if (st.headless === 0) return 'no headless arrows held';
    const usable = rows.filter(r => r.level <= level);
    if (!usable.some(r => (st.tips[r.tier] ?? 0) > 0)) return `no arrowtips Fletching ${level} can use held (${usable.map(r => r.tier).join(', ')})`;
    const plan = planFletch(st, opts);
    if (plan.slotFault) return plan.slotFault;
    if (plan.reserveBlock) return `rune keep: ${plan.reserveBlock}`;
    if (opts.maxActions === undefined && !plan.reaches) return `supplies short: ${plan.baseShort} base xp (they reach Fletching ${plan.level}; ${describe(plan)})`;
    if (!plan.keeps) {
        const keep = opts.keepRune ?? RUNE_KEEP;
        return `rune keep: the stock ends with ${plan.runeArrows} rune arrows (pack and quiver), below ${keep} (rune tips ${st.tips.rune ?? 0}, rune arrows ${runeArrowsOf(st)}, headless after the route ${plan.left.headless})`;
    }
    return true;
}

export function postconditions(s: BotWorldState, opts: FletchingOptions = {}): true | string {
    if (opts.maxActions !== undefined) return true;
    const to = opts.toLevel ?? 99;
    if (fletchingLevel(s) < to) return `Fletching ${fletchingLevel(s)} < ${to}`;
    const keep = opts.keepRune ?? RUNE_KEEP;
    if (keep > 0 && (!opts.tiers || opts.tiers.includes('rune'))) {
        const held = runeArrowsOf(stockOf(s));
        if (held < keep) return `rune keep: ${held} rune arrows held (pack and quiver), below ${keep}`;
    }
    return true;
}

export function fletchingStep(opts: FletchingOptions = {}): Step<any> {
    const entry = async (ctx: StepContext<any>) => {
        for (let i = 0; i < MAX_RUNS; i++) {
            const s = ctx.sdk.getState();
            if (!s) throw new Error('no state');
            const plan = planFletch(stockOf(s), opts);
            const run = plan.runs[0];
            if (!run) return;
            if (plan.slotFault) throw new Error(plan.slotFault);
            opts.log?.(`fletching run ${i + 1}: ${run.kind}, ${run.actions} actions planned (${run.tiers.join('/')}), ${plan.runs.length - 1} more`, { run, planned: plan.actions, plannedTicks: plan.ticks });
            const result = await runItemCycle(
                { sdk: ctx.sdk, session: ctx.session, log: ctx.log },
                {
                    mode: 'stack',
                    skill: 'fletching',
                    // a tick whose tier runs out finishes on the next tier the level allows (rune into adamant, adamant into mithril)
                    fill: true,
                    recipes: tierRows(run.tiers).map(recipeFor),
                    ...(run.untilLevel !== undefined ? { untilLevel: run.untilLevel } : {}),
                    ...(run.maxActions !== undefined ? { maxActions: run.maxActions } : {}),
                    maxTicks: run.ticks * 2 + 30,
                    // between runs the next run's first OPHELDU closes a level-up page (OpHeldUHandler)
                    ...(plan.runs.length > 1 ? { clearTicks: 0 } : {}),
                    step: STEP_NAME,
                    ...(opts.log ? { log: opts.log } : {})
                }
            );
            opts.onRun?.(run, result);
            if (result.actions === 0) {
                // The program credits an action by the xp it sees before it ends, so a batch that lands a
                // tick late (seen on the live world) is made but never credited: the state decides.
                const made = await waitUntil(ctx.sdk, st => stockOf(st).headless < stockOf(s).headless, { maxTicks: 3 });
                if (!made.ok) throw new Error(`fletching run ${run.kind} ended ${result.ended} with no arrows made`);
            }
            if (opts.maxActions !== undefined) return;
        }
        const s = ctx.sdk.getState();
        if (s && planFletch(stockOf(s), opts).runs.length) throw new Error(`fletching: still work left after ${MAX_RUNS} program runs`);
    };
    return {
        name: STEP_NAME,
        preconditions: s => preconditions(s, opts),
        run: entry,
        resume: entry,
        postconditions: s => postconditions(s, opts),
        logoutSafe: true,
        done: (o: Observed) => finished(o.state, opts),
        inProgress: (o: Observed) => !!o.state.player && !finished(o.state, opts) && fletchingXp(o.state) > 0
    };
}

/** The step-module convention (`skill`, `steps()`): one step, S18d-fallback. */
export function steps(opts: FletchingOptions = {}): Step<any>[] {
    return [fletchingStep(opts)];
}
