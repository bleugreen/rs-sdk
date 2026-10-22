// The overlay side of the page's item-cycle program (server/webclient/src/bot/programs/
// item-cycle.ts): delay-free item actions at a bank booth (Herblore pair mode, gem cutting
// in tool mode) or on two stacks (arrows), 5 per tick, every reaction in the page.
// docs/speedrun/skills/herblore.md section 9 has the design and the measured figures.
//
// Callers: skills/herblore.ts (S25e), skills/crafting.ts (S25d: hard leather bodies in tool
// mode, the thread a `keep` item, `stow` on the last visit), skills/cooking.ts (S25c's wine
// windows: `held` + `bank: false` on the load held in W1, `mixed` gem loads and `stow` in
// W2/P2). The Fletching fallback (entry 32) calls `runItemCycle` with its own recipes.
//
// `planRoute` is the program's own recipe rule run on paper: at each bank visit, the
// highest-xp recipe the level allows whose inputs are both on hand, for min(load, A, B)
// actions. Shared secondaries (eye of newt for guam then irit; limpwurt root for tarromin
// then kwuarm) go to whichever band comes first, as the run spends them.

import type { BotWorldState } from '../../sdk/types';
import { startLevelUpWatcher, type LevelUpSdk } from './levelup';
import { awaitProgram, overBudgetMeta, ProgramError, startProgram, type ProgramSdk, type ProgramStatus } from './programs';
import { logNote, type TickLog } from './ticks';
import { tickMs, waitTicks } from './wait';
import { levelForXp, XP_RATE, xpForLevel } from './xp';

export type ItemCycleMode = 'pair' | 'tool' | 'stack';

/** One recipe in obj ids (item-cycle.ts CycleRecipe): unfinished potions all share one name in game. */
export interface ItemRecipe {
    name: string;
    level: number;
    /** Base xp per action. */
    xp: number;
    a: number;
    b?: number;
    tool?: number;
    products: number[];
    /** Stack mode: items one action takes from each stack (default 15). */
    per?: number;
    /**
     * Tool mode: items held beside the tool through every visit, never deposited; `every`: the
     * content wears one out every `every` actions (thread, 5). item-cycle.ts KeepItem.
     */
    keep?: Array<{ id: number; every?: number }>;
}

export interface Booth {
    x: number;
    z: number;
    id: number;
    /** The booth's quick-bank op index, never one that opens a banker dialogue. */
    option: number;
    /**
     * The tile the account banks from. While it stands there the program sends the booth click
     * unrouted (the OPLOC alone, one user event), so the click rides with the last 4 actions and
     * a pair inventory is 4 ticks. Without it every click is routed (MOVE_OPCLICK + OPLOC): 5 ticks.
     */
    stand?: { x: number; z: number };
}

/** The program's parameters, plus the step name the ledger rows carry. */
export interface ItemCycleSpec {
    mode: ItemCycleMode;
    skill: string;
    recipes: readonly ItemRecipe[];
    /** Required for pair and tool modes. */
    booth?: Booth;
    untilLevel?: number;
    untilXp?: number;
    /** A cap on actions (the cooking gem windows). */
    maxActions?: number;
    perTick?: number;
    maxTicks?: number;
    stallTicks?: number;
    /** At the stop, one more visit deposits everything held, the tool and kept items too. */
    stow?: boolean;
    /** The first load is the one held now: no booth click before it. */
    held?: boolean;
    /** false (with `held`): no bank visit at all; the run ends 'load done' once the held load is sent. */
    bank?: boolean;
    /** Tool mode: a load holds several recipes' inputs, filled in xp order (the cooking windows' gems). */
    mixed?: boolean;
    /**
     * Ticks the level-up watcher runs after the program (default LEVEL_UP_CLEAR_TICKS). 0: none, for
     * a caller that clears the pages itself against a deadline (cooking's W1, through the due tick).
     */
    clearTicks?: number;
    step: string;
    log?: (msg: string, data?: Record<string, unknown>) => void;
    onProgress?: (status: ProgramStatus) => void;
}

/** item-cycle.ts ItemCycleResult. */
export interface ItemCycleResult {
    ended: string | null;
    actions: number;
    sent: number;
    visits: number;
    resets: number;
    drift: number;
    levelups: number;
    byRecipe: Record<string, number>;
    ticks: number;
    cycleGaps: number[];
    sendsPerTick: Record<number, number>;
    xpDropsPerTick: Record<number, number>;
    /** With `stow`: whether the last visit left the inventory empty. */
    stowed?: boolean;
}

/** item-cycle.ts TickRecord, as the program shares it. */
export interface ItemCycleTick {
    t: number;
    phase: string;
    pending: number;
    sent: number;
    actions: number;
    landed: number;
}

/** item-cycle.ts ItemCycleShared. */
export interface ItemCycleShared {
    v: 1;
    mode: ItemCycleMode;
    phase: string;
    recipe: string | null;
    timeline: ItemCycleTick[];
    sendsPerTick: Record<number, number>;
    xpDropsPerTick: Record<number, number>;
    cycleGaps: number[];
    visits: Array<{ seen: number; kind: 'canonical' | 'reset' | 'stow'; recipe: string | null; n: number; refill?: number }>;
}

export function itemCycleShared(status: ProgramStatus | null | undefined): ItemCycleShared | undefined {
    const s = status?.name === 'item-cycle' ? (status.shared as ItemCycleShared | undefined) : undefined;
    return s?.v === 1 ? s : undefined;
}

// ------------------------------------------------------------------ planning

/** Items on hand by obj id. */
export type Stock = ReadonlyMap<number, number>;

/**
 * Bank plus inventory by obj id, a banknote counted as its item (`notes` maps note id to
 * item id). A bank read while the bank is closed is whatever the state last carried.
 */
export function stockFrom(state: BotWorldState, notes: ReadonlyMap<number, number> = new Map()): Map<number, number> {
    const m = new Map<number, number>();
    const add = (id: number, n: number) => m.set(id, (m.get(id) ?? 0) + n);
    for (const b of state.bank?.items ?? []) if (b.count > 0) add(b.id, b.count);
    for (const i of state.inventory) if (i.count > 0) add(notes.get(i.id) ?? i.id, i.count);
    return m;
}

export interface PlannedLoad {
    recipe: string;
    n: number;
    /** Xp drops in this load that raised the level: one level-up page each. */
    levelups: number;
    xpAfter: number;
}

export interface RoutePlan {
    loads: PlannedLoad[];
    actions: number;
    /** Actions by recipe name. */
    byRecipe: Record<string, number>;
    reaches: boolean;
    /** Game xp still missing when the supplies run out (0 when it reaches). */
    xpShort: number;
    /** The level the supplies reach. */
    level: number;
    /** Ticks per inventory x loads + ticks per level-up drop x drops; the lab calibrates both. */
    expectedTicks: number;
    /** What is left of each input. */
    left: Record<number, number>;
}

export interface PlanOptions {
    xpRate?: number;
    /** Actions per inventory: 14 pair, 27 tool. */
    load?: number;
    /** Measured steady cycle: 4 ticks per 14-potion inventory (herblore.md section 2). */
    ticksPerInventory?: number;
    /** Booth delay per level-up page left at the visit (levelup-cost.md section 1, about 0.3, inferred). */
    ticksPerLevelupDrop?: number;
}

export function planRoute(fromXp: number, toLevel: number, recipes: readonly ItemRecipe[], stock: Stock, opts: PlanOptions = {}): RoutePlan {
    const rate = opts.xpRate ?? XP_RATE;
    const load = opts.load ?? 14;
    const target = xpForLevel(toLevel);
    const left = new Map(stock);
    const has = (id: number | undefined) => id === undefined || (left.get(id) ?? 0) > 0;
    const byXp = [...recipes].sort((x, y) => y.xp - x.xp);
    const loads: PlannedLoad[] = [];
    const byRecipe: Record<string, number> = {};
    let xp = fromXp;
    let actions = 0;
    let drops = 0;
    while (xp < target) {
        const level = levelForXp(xp);
        const r = byXp.find(x => x.level <= level && has(x.a) && has(x.b) && has(x.tool));
        if (!r) break;
        const n = Math.min(load, left.get(r.a)!, r.b === undefined ? Infinity : left.get(r.b)!);
        let done = 0;
        let ups = 0;
        for (; done < n && xp < target; done++) {
            const before = levelForXp(xp);
            xp += r.xp * rate;
            if (levelForXp(xp) > before) ups++;
        }
        left.set(r.a, left.get(r.a)! - done);
        if (r.b !== undefined) left.set(r.b, left.get(r.b)! - done);
        loads.push({ recipe: r.name, n: done, levelups: ups, xpAfter: xp });
        byRecipe[r.name] = (byRecipe[r.name] ?? 0) + done;
        actions += done;
        drops += ups;
    }
    const perInv = opts.ticksPerInventory ?? 4;
    const perDrop = opts.ticksPerLevelupDrop ?? 0.3;
    return {
        loads,
        actions,
        byRecipe,
        reaches: xp >= target,
        xpShort: Math.max(0, target - xp),
        level: levelForXp(xp),
        expectedTicks: Math.round((loads.length * perInv + drops * perDrop) * 10) / 10,
        left: Object.fromEntries(recipes.flatMap(r => [r.a, ...(r.b === undefined ? [] : [r.b])]).map(id => [id, left.get(id) ?? 0]))
    };
}

// ------------------------------------------------------------------ running

export type ItemCycleSdk = ProgramSdk & LevelUpSdk;

export interface ItemCycleContext {
    sdk: ItemCycleSdk;
    session: { name: string; sessionId: number };
    log: TickLog;
}

/** Ticks the level-up watcher runs after the program, for a page the last burst left. */
export const LEVEL_UP_CLEAR_TICKS = 3;

export function programParams(spec: ItemCycleSpec): Record<string, unknown> {
    const p: Record<string, unknown> = { mode: spec.mode, skill: spec.skill, recipes: spec.recipes.map(r => ({ ...r, ...(r.keep ? { keep: r.keep.map(k => ({ ...k })) } : {}) })) };
    if (spec.booth) p.booth = { ...spec.booth };
    for (const k of ['untilLevel', 'untilXp', 'maxActions', 'perTick', 'maxTicks', 'stallTicks', 'stow', 'held', 'bank', 'mixed'] as const) if (spec[k] !== undefined) p[k] = spec[k];
    return p;
}

/**
 * Run the page's item-cycle program to its end. Resolves with its result when it ends
 * done; throws (a ProgramError from awaitProgram) on a fault, after logging it. Either way
 * the ledger gets one `program` row (kinded, so the step's own row keeps the total) and
 * one note with the per-tick histograms, and a level-up watcher clears any page left over.
 */
export async function runItemCycle(ctx: ItemCycleContext, spec: ItemCycleSpec): Promise<ItemCycleResult> {
    const { sdk } = ctx;
    const t0 = Date.now();
    const started = await startProgram(sdk, 'item-cycle', programParams(spec));
    let last: ProgramStatus = started;
    let final: ProgramStatus | null = null;
    let error: unknown = null;
    try {
        final = await awaitProgram(sdk, started.runId, {
            ...(spec.maxTicks !== undefined ? { maxTicks: spec.maxTicks + 20 } : {}),
            onProgress: st => {
                last = st;
                spec.onProgress?.(st);
            }
        });
        if (final.phase !== 'done') throw new ProgramError(`item-cycle run ${started.runId} ended ${final.phase} (another program was started?)`, final);
        const result = final.result as ItemCycleResult | undefined;
        if (!result) throw new ProgramError('item-cycle ended without a result', final);
        return result;
    } catch (e) {
        error = e;
        if (e instanceof ProgramError && e.status && e.status.runId === started.runId) final = e.status;
        throw e;
    } finally {
        ledgerRows(ctx, spec, final ?? last, error, t0);
        await clearLevelUps(sdk, spec.clearTicks ?? LEVEL_UP_CLEAR_TICKS);
    }
}

function ledgerRows(ctx: ItemCycleContext, spec: ItemCycleSpec, st: ProgramStatus, error: unknown, t0: number): void {
    const { log, session, sdk } = ctx;
    const tick = sdk.getState()?.tick ?? -1;
    const startTick = st.startedTick >= 0 ? st.startedTick : tick;
    const endTick = st.endedTick ?? st.tick ?? tick;
    const result = (st.phase === 'done' ? st.result : (st.faultDetail as Record<string, unknown> | undefined)) as Partial<ItemCycleResult> | undefined;
    const message = error instanceof Error ? error.message : error ? String(error) : undefined;
    const summary = {
        program: 'item-cycle',
        runId: st.runId,
        phase: st.phase,
        mode: spec.mode,
        recipes: spec.recipes.map(r => r.name),
        counters: st.counters,
        ...overBudgetMeta(st),
        ...(result ? { result: { ended: result.ended, actions: result.actions, sent: result.sent, visits: result.visits, resets: result.resets, drift: result.drift, levelups: result.levelups, byRecipe: result.byRecipe, ticks: result.ticks, ...(result.stowed !== undefined ? { stowed: result.stowed } : {}) } } : {}),
        ...(st.fault ? { fault: st.fault } : {})
    };
    log.append({
        v: 1,
        kind: 'program',
        runId: log.runId,
        account: session.name,
        sessionId: session.sessionId,
        step: spec.step,
        startTick,
        endTick,
        ticks: Math.max(0, endTick - startTick),
        wallMs: Date.now() - t0,
        ok: st.phase === 'done' && !error,
        ...(message ? { error: message } : {}),
        meta: summary,
        tickMs: tickMs(),
        at: new Date().toISOString()
    });
    logNote(log, { sdk, name: session.name, sessionId: session.sessionId }, spec.step, {
        what: 'item-cycle end',
        phase: st.phase,
        ...(st.fault ? { fault: st.fault } : {}),
        counters: st.counters,
        deferred: st.deferred,
        cycleGaps: result?.cycleGaps ?? [],
        sendsPerTick: result?.sendsPerTick ?? {},
        xpDropsPerTick: result?.xpDropsPerTick ?? {}
    });
    spec.log?.(`item-cycle ${st.phase}${st.fault ? `: ${st.fault}` : ''}`, summary);
}

async function clearLevelUps(sdk: ItemCycleSdk, ticks: number): Promise<void> {
    if (ticks <= 0) return;
    const watcher = startLevelUpWatcher(sdk);
    try {
        await waitTicks(sdk, ticks);
    } catch {
        // a dropped session ends the wait; the watcher has nothing left to do
    } finally {
        watcher.stop();
    }
}
