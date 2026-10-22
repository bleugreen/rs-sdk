// S25c, Cooking 30 (after Cook's Assistant; any start works) to 99 by wine at the Varrock west booth, with uncut gems cut in the waits
// (STEP-MANIFEST.md entry 29; docs/speedrun/skills/cooking.md; research/wine-window.md section
// 5 B; helpers/wine.md "Default sequence for the scored account").
//
// The step IS the run's two planned relogs. Relog 1 arms fermenting_wine at login + 20; the
// wine giver, beside the booth, trades the 520 noted unfermented wines on SCORED's return
// (wine.ts giveWine afterRelog); rs/41's splitDelivery deposits 29 for that firing and the rest
// after it, then relog 2 arms the second firing. This module adds only the work in the waits,
// through splitDelivery's window hooks:
//
//   burst 1  inside the deposit-29 burst: withdraw the chisel (S25d stowed it) and the fewest
//            uncut gem stacks that fill the free slots (sapphire All: 10 events, 2 ticks)
//   W1       item-cycle's tool mode on the held load (held, bank: false: the 491 notes held now
//            must stay out of the bank), then blind continues through the due tick
//   P1       splitDelivery's own booth click and two continues a tick, then one burst: the
//            notes All, each cut gem All, close
//   W2 + P2  item-cycle's booth cycle with mixed loads (27, 27, 27) and stow; its cuts close the
//            second firing's Cooking pages, and the hook clears whatever is left
//
// Resume: any login arms the timer, so the reconnect login is itself an arming login and a
// crash never costs an extra planned relog. The wineBank probe reads the bank, and
// splitStage picks where splitDelivery re-enters.

import type { BotWorldState } from '../../sdk/types';
import { classifyPage } from '../lib/dialogue';
import { type BurstExtra, CONTINUES_PER_TICK, drainChat, openBankThroughPages, splitDelivery, splitStage, type ReceiverSdk, SECOND_WAIT_SLACK, type SplitStage, type SplitWindows, type WineBank, wineBankOf } from '../helpers/wine-receive';
import { GEM } from '../helpers/jeweller';
import { ITEM as WINE } from '../helpers/wine-common';
import { runItemCycle, type Booth, type ItemRecipe } from '../lib/item-cycle';
import type { RelogResult, Session } from '../lib/session';
import { logNote } from '../lib/ticks';
import { travelTo } from '../lib/toll-gate';
import { onStates } from '../lib/wait';
import { xpForLevel, XP_RATE } from '../lib/xp';
import type { Observed, RunnerSession, Step, StepContext } from '../runner/step';
import { handoffXpOf, stagedCounts, type StagedGem } from './crafting';
import { boothFor, boothLoc, VARROCK_WEST } from './herblore';

export const skill = 'cooking';

export const STEP_NAME = 'S25c cooking';

const INVENTORY = 28;

/** The booth and SCORED's stand tile (herblore.ts; S25d and S25e bank there too). */
export const BOOTH: Booth = VARROCK_WEST;
/** The wine giver's tile, beside SCORED's stand, so the trade needs no walk (rs/331 staging, H21c). */
export const GIVER_TILE = { x: 3184, z: 3436 } as const;
/** The run-day wine giver (rs/331, SUPPLIES H21c). */
export const WINE_GIVER = 'cairn_mule2';
/** The noted unfermented wines H21c delivers (rs/118). */
export const WINES = 520;
/** The first firing's batch: 29 rolls of one wine each (wine.md: 30 rolls as fifteen batches of 2). */
export const FIRST_BATCH = 29;
/** A logout waits 16 ticks after a hit (relog-probe.ts), on the scored clock. */
export const COMBAT_LOGOUT_TICKS = 16;

export const CHISEL = 1755;

type GemName = keyof typeof GEM;
const GEM_NAMES: readonly GemName[] = ['diamond', 'ruby', 'emerald', 'sapphire'];

/** Chisel on each uncut gem the windows cut (uncut_gem.rs2; jeweller.ts GEM), as data: the program picks by xp. */
export const GEM_RECIPES: readonly ItemRecipe[] = GEM_NAMES.map(g => ({ name: g, level: GEM[g].level, xp: GEM[g].cutXp, a: GEM[g].uncut, tool: CHISEL, products: [GEM[g].cut] }));
export const UNCUT_IDS: readonly number[] = GEM_NAMES.map(g => GEM[g].uncut);
export const CUT_IDS: readonly number[] = GEM_NAMES.map(g => GEM[g].cut);

/**
 * The windows' gem plan: the uncut gems staged for them (H21d's row, which crafting.ts reads and
 * S25d's stop comes from), by gem; how many the windows cut; and S25d's hand-off they start from.
 */
export interface WindowPlan {
    counts: Readonly<Record<GemName, number>>;
    total: number;
    handoffXp: number;
}

/** The plan for `stagedGems` (default H21d's row); a string says why the list is refused. */
export function windowPlan(opts: Pick<CookingOptions, 'stagedGems'> = {}): WindowPlan | string {
    const counts = stagedCounts(opts.stagedGems);
    if (typeof counts === 'string') return counts;
    return { counts, total: GEM_NAMES.reduce((n, g) => n + counts[g], 0), handoffXp: handoffXpOf(counts) };
}

/** Game xp the windows give cutting `counts`, by this module's own recipes. */
export function windowsXp(counts: Readonly<Record<GemName, number>>, recipes: readonly ItemRecipe[] = GEM_RECIPES): number {
    return GEM_NAMES.reduce((xp, g) => xp + counts[g] * (recipes.find(r => r.a === GEM[g].uncut)?.xp ?? 0), 0) * XP_RATE;
}

/** Crafting xp once the windows have cut the plan: S25d's hand-off plus the windows' xp, 99 exactly. */
export function craftingAfterWindows(plan: WindowPlan): number {
    return plan.handoffXp + windowsXp(plan.counts);
}

export interface CookingOptions {
    /** The wine giver beside the booth (default WINE_GIVER). */
    giver?: string;
    /** The first firing's batch (default FIRST_BATCH); the rest ferments at relog 2's login. */
    first?: number;
    /** 'gems' (default): cut the uncut gems in the waits; 'none': the plain sequence (Crafting then 121). */
    windowWork?: 'gems' | 'none';
    /**
     * The uncut gems staged for the windows (default H21d's row read from STEP-MANIFEST.md): the
     * windows cut their total, and S25d's hand-off (the S25d check) is theirs. A gem banked beyond
     * them (the fleet's 108th) stays banked.
     */
    stagedGems?: readonly StagedGem[];
    /** The gem recipes, as data (default GEM_RECIPES; the lab's comparability fixture passes dragonstone). */
    recipes?: readonly ItemRecipe[];
    /** The tab relog (default session.relog with no options: in page, navigation as the fallback). */
    relog?: (session: Session) => Promise<RelogResult>;
    booth?: Booth;
    /** Lab fixtures: skip the S25a, S25d and S25e checks (their levels are the lab's own). */
    lab?: boolean;
    /**
     * Demo and lab only: a walk to the stand tile before the step (the rehearsal harness lands a
     * fresh account at Lumbridge). On run day the run chain's legs bring SCORED to the booth.
     */
    walkIn?: boolean;
}

// ------------------------------------------------------------------ state reads

function stat(s: BotWorldState, name: string) {
    return s.skills.find(k => k.name.toLowerCase() === name);
}
export const level = (s: BotWorldState, name: string) => stat(s, name)?.baseLevel ?? 0;
export const xpOf = (s: BotWorldState, name: string) => stat(s, name)?.experience ?? 0;
const held = (s: BotWorldState, ids: readonly number[]) => s.inventory.filter(i => i.count > 0 && ids.includes(i.id)).reduce((n, i) => n + i.count, 0);
export const notesHeld = (s: BotWorldState) => held(s, [WINE.wineNote]);
export const uncutHeld = (s: BotWorldState) => held(s, UNCUT_IDS);
export const cutHeld = (s: BotWorldState) => held(s, CUT_IDS);
const usedSlots = (s: BotWorldState) => s.inventory.filter(i => i.count > 0).length;

// the chisel is not here: the plain sequence never touches it, and the gem cycle's stow banks it
const OURS = new Set<number>([WINE.wineNote, ...UNCUT_IDS, ...CUT_IDS]);
/** The step's own items held (the notes, gems): none once it ends. */
export function oursHeld(s: BotWorldState): string[] {
    return s.inventory.filter(i => i.count > 0 && OURS.has(i.id)).map(i => i.name);
}

function pageOpen(s: BotWorldState): boolean {
    return !!s.dialog?.isOpen;
}

// ------------------------------------------------------------------ preconditions

export function preconditions(s: BotWorldState, opts: CookingOptions = {}): true | string {
    if (!s.inGame || !s.player) return 'not in game';
    const plan = windowPlan(opts);
    if (typeof plan === 'string') return plan;
    if (level(s, 'cooking') >= 99) return true;
    const booth = opts.booth ?? BOOTH;
    const stand = booth.stand ?? { x: booth.x - 1, z: booth.z };
    const dx = Math.abs(s.player.worldX - stand.x);
    const dz = Math.abs(s.player.worldZ - stand.z);
    if (dx > 1 || dz > 1) return `not beside the booth: at (${s.player.worldX},${s.player.worldZ}), the stand is (${stand.x},${stand.z})`;
    // right after a login the position is published before the scene's locs
    if (s.nearbyLocs.length && !boothLoc(s, booth)) return `no bank booth (${booth.x},${booth.z}) in view`;
    if (!opts.lab) {
        if (level(s, 'smithing') < 99) return `S25a not done: Smithing ${level(s, 'smithing')}`;
        if (level(s, 'herblore') < 99) return `S25e not done: Herblore ${level(s, 'herblore')}`;
        if (xpOf(s, 'crafting') < plan.handoffXp) return `S25d not done: Crafting xp ${xpOf(s, 'crafting')} < ${plan.handoffXp} (the hand-off for the ${plan.total} staged gems)`;
    }
    // the notes take one slot when they arrive; held already (a resume), they need none
    if (notesHeld(s) === 0 && usedSlots(s) > INVENTORY - 1) {
        const other = s.inventory.filter(i => i.count > 0 && i.id !== CHISEL).map(i => i.name);
        return `${other.length} other items (${[...new Set(other)].join(', ')}): need 1 free slots`;
    }
    const c = s.player.combat;
    if (c?.inCombat) return 'in combat: the relog would wait out the logout timer on the scored clock';
    if (c && c.lastDamageTick >= 0 && s.tick - c.lastDamageTick <= COMBAT_LOGOUT_TICKS) return `hit ${s.tick - c.lastDamageTick} ticks ago: a relog waits ${COMBAT_LOGOUT_TICKS} ticks out of combat`;
    return true;
}

/** The window work in force: 'none' when asked, or when Crafting is already 99 (no gem has xp left to give). */
export function windowWorkFor(s: BotWorldState, opts: CookingOptions = {}): 'gems' | 'none' {
    if (opts.windowWork === 'none') return 'none';
    return xpOf(s, 'crafting') >= xpForLevel(99) ? 'none' : 'gems';
}

// ------------------------------------------------------------------ the bursts

export interface GemStack {
    id: number;
    count: number;
    xp: number;
}

/**
 * The bank stacks burst 1 withdraws to fill `room` slots in the fewest packets: one stack that
 * fills it alone (the highest-xp such stack), else the largest stacks first.
 */
export function chooseStacks(stacks: readonly GemStack[], room: number): Array<{ id: number; take: number }> {
    const avail = stacks.filter(s => s.count > 0);
    if (room <= 0 || !avail.length) return [];
    const single = avail.filter(s => s.count >= room).sort((a, b) => b.xp - a.xp)[0];
    if (single) return [{ id: single.id, take: room }];
    const out: Array<{ id: number; take: number }> = [];
    let left = room;
    for (const s of [...avail].sort((a, b) => b.count - a.count || b.xp - a.xp)) {
        if (left <= 0) break;
        const take = Math.min(s.count, left);
        out.push({ id: s.id, take });
        left -= take;
    }
    return out;
}

/** Withdraw buttons for exactly `take`: All when All gives that, else 10s, a 5 and 1s (never the count dialog). */
export function withdrawButtons(take: number, allGives: number): number[] {
    if (take === allGives) return [-1];
    const out: number[] = Array(Math.floor(take / 10)).fill(10);
    if (take % 10 >= 5) out.push(5);
    for (let i = 0; i < take % 5; i++) out.push(1);
    return out;
}

/** What a run of the step knows as it goes. */
export interface CookingRun {
    windowWork: 'gems' | 'none';
    recipes: readonly ItemRecipe[];
    /** Gems cut so far over the windows. */
    cut: number;
    gems: number;
    /** Cooking xp when the step (or its resume) began: a rise means the first firing happened. */
    xp0: number;
    planned2: boolean;
    /** From a resume stage past the first firing: every relog is a deadline relog. */
    pastFirst: boolean;
    relogs: Array<{ kind: RelogKind; via: string; tickBase: number; loginTick: number; armedAt: number; cost: number; logoutLatency: number }>;
}

export type RelogKind = 'planned-1' | 'planned-2' | 'deadline';

export function newRun(s: BotWorldState, opts: CookingOptions = {}): CookingRun {
    const plan = windowPlan(opts);
    if (typeof plan === 'string') throw new Error(plan);
    return { windowWork: windowWorkFor(s, opts), recipes: opts.recipes ?? GEM_RECIPES, cut: 0, gems: plan.total, xp0: xpOf(s, 'cooking'), planned2: false, pastFirst: false, relogs: [] };
}

const gemsLeft = (run: CookingRun) => Math.max(0, run.gems - run.cut);
/** The run's uncut gems held, by its own recipes. */
const inputsHeld = (s: BotWorldState, run: CookingRun) => held(s, run.recipes.map(r => r.a));

/**
 * The label of a relog splitDelivery asks for: the arming relog (planned-2) once the first
 * firing has shown, else the deadline fallback.
 */
export function relogKind(run: CookingRun, s: BotWorldState): RelogKind {
    if (!run.pastFirst && !run.planned2 && xpOf(s, 'cooking') > run.xp0) return 'planned-2';
    return 'deadline';
}

type Ctx = StepContext<any>;

function state(ctx: Ctx): BotWorldState {
    const s = ctx.sdk.getState();
    if (!s) throw new Error('no state');
    return s;
}

function note(ctx: Ctx, meta: Record<string, unknown>): void {
    logNote(ctx.log, { sdk: ctx.sdk, name: ctx.session.name, sessionId: ctx.session.sessionId }, STEP_NAME, meta);
}

/**
 * Burst 1's extra packets: the chisel when it is banked, then the gem stacks that fill the free
 * slots. With the chisel banked (S25d stows it) the run's burst is 7 deposits + chisel + one
 * stack + close = 10 events, the 2 ticks WW measured for its load; with it held, 9.
 */
export function firstBurst(ctx: Ctx, run: CookingRun): BurstExtra {
    return s => {
        if (run.windowWork !== 'gems') return 0;
        const bank = s.bank.items.filter(i => i.count > 0);
        let sent = 0;
        let used = usedSlots(s);
        const stacks = run.recipes.map(r => ({ id: r.a, xp: r.xp, count: bank.filter(i => i.id === r.a).reduce((n, i) => n + i.count, 0) }));
        // every window gem is banked by now (S25d's first visit): a short supply caps the windows' count
        const onHand = stacks.reduce((n, x) => n + x.count, 0) + inputsHeld(s, run);
        if (onHand === 0) {
            run.windowWork = 'none';
            note(ctx, { what: 'no uncut gems banked: the plain sequence (Crafting then 121)' });
            return 0;
        }
        if (onHand < gemsLeft(run)) {
            note(ctx, { what: `gems on hand ${onHand}, ${gemsLeft(run)} planned: the windows cut ${onHand}` });
            run.gems = run.cut + onHand;
        }
        if (!s.inventory.some(i => i.id === CHISEL && i.count > 0)) {
            const chisel = bank.find(i => i.id === CHISEL);
            if (!chisel) {
                run.windowWork = 'none';
                note(ctx, { what: 'no chisel held or banked: the plain sequence (Crafting then 121)' });
                return 0;
            }
            void ctx.sdk.sendBankWithdraw(chisel.slot, 1);
            sent++;
            used++;
        }
        // the notes stay held through W1 (only `first` of them go now)
        const room = Math.min(INVENTORY - used, gemsLeft(run));
        const pick = chooseStacks(stacks, room);
        let free = INVENTORY - used;
        for (const p of pick) {
            const slot = bank.find(i => i.id === p.id)!.slot;
            const count = stacks.find(x => x.id === p.id)!.count;
            for (const amount of withdrawButtons(p.take, Math.min(count, free))) {
                void ctx.sdk.sendBankWithdraw(slot, amount);
                sent++;
            }
            free -= p.take;
        }
        const load = pick.reduce((n, p) => n + p.take, 0);
        note(ctx, { what: 'burst 1', chiselWithdrawn: sent > pick.length ? 1 : 0, slotsUsedBefore: usedSlots(s), load, stacks: pick, packets: sent, ...(load < INVENTORY - 2 ? { warning: `W1 load will be ${load} gems` } : {}) });
        return sent;
    };
}

/** P1's extra packets: deposit All of each cut gem held, before the close. */
export function restBurst(ctx: Ctx, run: CookingRun): BurstExtra {
    return s => {
        if (run.windowWork !== 'gems') return 0;
        let sent = 0;
        for (const id of new Set(run.recipes.flatMap(r => r.products))) {
            const it = s.inventory.find(i => i.id === id && i.count > 0);
            if (!it) continue;
            void ctx.sdk.sendBankDeposit(it.slot, -1);
            sent++;
        }
        return sent;
    };
}

/** W1: cut the held load (no bank visit), then blind continues through the due tick. */
/**
 * Blind continues (two a tick) on every state that shows a page, through the state of `last`
 * inclusive, quiet chat or not: a level-up page open on the due tick holds the timer unless a
 * continue in that tick's packets closes it first (wine-window.md section 3), and the queue can
 * show no page for a tick between two scripts. Stopping after `last` = due - 1 leaves the due
 * tick's sends to P1.
 */
export async function continueThrough(ctx: Ctx, last: number): Promise<void> {
    let sentOn = -1;
    const step = (s: BotWorldState): true | undefined => {
        if (s.tick > last) return true;
        if (s.tick > sentOn && classifyPage(s.dialog) === 'continue') {
            sentOn = s.tick;
            for (let i = 0; i < CONTINUES_PER_TICK; i++) void ctx.sdk.sendClickDialog(0, { blind: true });
        }
        return s.tick >= last ? true : undefined;
    };
    const now = state(ctx);
    if (step(now) === true) return;
    await onStates(ctx.sdk, last - now.tick + 2, step);
}

export function firstWait(ctx: Ctx, run: CookingRun): (due: number) => Promise<void> {
    return async due => {
        const s = state(ctx);
        const n = Math.min(inputsHeld(s, run), gemsLeft(run));
        if (run.windowWork === 'gems' && n > 0 && s.inventory.some(i => i.id === CHISEL)) {
            const r = await runItemCycle(
                { sdk: ctx.sdk, session: ctx.session, log: ctx.log },
                { mode: 'tool', skill: 'crafting', recipes: run.recipes, held: true, bank: false, mixed: true, maxActions: n, clearTicks: 0, step: `${STEP_NAME} W1` }
            );
            run.cut += r.actions;
        }
        await continueThrough(ctx, due - 1);
        note(ctx, { what: 'W1 end', due, cut: run.cut, slotsUsed: usedSlots(state(ctx)) });
    };
}

/**
 * W2 + P2: the booth cycle on mixed loads with stow, through the second firing (its cuts close
 * the Cooking pages); then, should the cutting end first, wait for the firing and clear its pages.
 */
export function secondWait(ctx: Ctx, run: CookingRun, opts: CookingOptions = {}): (due: number) => Promise<void> {
    return async due => {
        const xp0 = xpOf(state(ctx), 'cooking');
        await cutGems(ctx, run, opts);
        const now = state(ctx).tick;
        if (xpOf(state(ctx), 'cooking') <= xp0) await onStates(ctx.sdk, Math.max(1, due + SECOND_WAIT_SLACK - now + 1), s => (xpOf(s, 'cooking') > xp0 ? true : undefined));
        await drainChat(ctx.sdk);
    };
}

/** The gem cycle at the booth: mixed loads in xp order, the last visit stowing the chisel and the cut gems. */
async function cutGems(ctx: Ctx, run: CookingRun, opts: CookingOptions): Promise<void> {
    if (run.windowWork !== 'gems' || gemsLeft(run) <= 0) return;
    const s = state(ctx);
    const r = await runItemCycle(
        { sdk: ctx.sdk, session: ctx.session, log: ctx.log },
        { mode: 'tool', skill: 'crafting', recipes: run.recipes, booth: boothFor(s, opts.booth ?? BOOTH), mixed: true, stow: true, maxActions: gemsLeft(run), step: `${STEP_NAME} W2` }
    );
    run.cut += r.actions;
    note(ctx, { what: 'W2/P2 end', cut: run.cut, visits: r.visits, byRecipe: r.byRecipe, stowed: r.stowed });
}

export function windows(ctx: Ctx, run: CookingRun, opts: CookingOptions = {}): SplitWindows {
    return { firstBurst: firstBurst(ctx, run), firstWait: firstWait(ctx, run), restBurst: restBurst(ctx, run), secondWait: secondWait(ctx, run, opts) };
}

// ------------------------------------------------------------------ relogs

/**
 * The tick the login armed fermenting_wine on: the session's own tick 1, tickBase + 1. The first
 * published state can come a tick or two later (the lab measured both firings at tick 21 with
 * first states at 1 and 2), so a deadline counted from loginTick could be a tick late.
 */
export function armedAt(r: Pick<RelogResult, 'loginTick' | 'tickBase'>): number {
    return Math.min(r.loginTick, r.tickBase + 1);
}

const defaultRelog = async (s: Session) => (await import('../lib/session')).relog(s);

/**
 * The only path to a relog: no bank or trade open, any page drained first (paid either way,
 * and kept off the logout), then the tab relog, logged with its cost and path.
 */
export async function relogGuarded(ctx: Ctx, run: CookingRun, kind: RelogKind, opts: CookingOptions = {}): Promise<RelogResult> {
    const s = state(ctx);
    if (s.bank?.isOpen) throw new Error(`relog (${kind}) with the bank open`);
    if (s.trade?.isOpen) throw new Error(`relog (${kind}) with a trade open`);
    if (pageOpen(s)) await drainChat(ctx.sdk, { maxTicks: 60 });
    const r = await (opts.relog ?? defaultRelog)(ctx.session as Session);
    const row = { kind, via: r.via, tickBase: r.tickBase, loginTick: r.loginTick, armedAt: armedAt(r), cost: r.loginTick - r.tickBase, logoutLatency: r.logout?.latencyTicks ?? -1 };
    if (kind === 'planned-2') run.planned2 = true;
    run.relogs.push(row);
    note(ctx, { what: 'relog', ...row });
    return r;
}

// ------------------------------------------------------------------ the sequence

async function split(ctx: Ctx, run: CookingRun, opts: CookingOptions, from: SplitStage, loginTick: number): Promise<void> {
    const r = await splitDelivery({ sdk: ctx.sdk as unknown as ReceiverSdk, log: (message, data) => note(ctx, { what: message, ...data }) }, opts.giver ?? WINE_GIVER, {
        loginTick,
        first: opts.first ?? FIRST_BATCH,
        arming: 'relog',
        from,
        relog: async () => armedAt(await relogGuarded(ctx, run, relogKind(run, state(ctx)), opts)),
        windows: windows(ctx, run, opts)
    });
    if (r.received && r.received < WINES) note(ctx, { what: `wines delivered: ${r.received} of ${WINES} (logged, not refused: the wine is in hand)` });
    note(ctx, { what: 'S25c end', from, ...r, relogs: run.relogs, cut: run.cut });
}

/** The wine and gems the bank holds, read by the wineBank probe. */
export interface WineBankProbe {
    wine: WineBank;
    uncutGems: number;
    cutGems: number;
}

/** Open the booth in sight (Use-quickly), read the wine and gems, close: about 3 ticks. Null with no booth in sight. */
export async function wineBankProbe(session: RunnerSession): Promise<WineBankProbe | null> {
    const sdk = session.sdk;
    const s = sdk.getState();
    if (!s || !boothLoc(s, BOOTH)) return null;
    const open = await openBankThroughPages(sdk as unknown as ReceiverSdk, { maxTicks: 20 });
    if (!open.ok) return null;
    const items = sdk.getState()!.bank.items;
    const n = (ids: readonly number[]) => items.filter(i => ids.includes(i.id)).reduce((k, i) => k + i.count, 0);
    const out = { wine: wineBankOf(items), uncutGems: n(UNCUT_IDS), cutGems: n(CUT_IDS) };
    void sdk.sendCloseModal();
    await onStates(sdk, 6, st => (!st.bank.isOpen ? true : undefined));
    return out;
}

/** The probes this module's step reads (registered by run.ts). */
export const PROBES = { wineBank: wineBankProbe } as const;

const probeOf = (o: Observed | undefined): WineBankProbe | null | undefined => o?.probed.wineBank as WineBankProbe | null | undefined;

export function cookingStep(opts: CookingOptions = {}): Step<any> {
    const done = (o: Observed) => {
        const s = o.state;
        if (level(s, 'cooking') < 99 || oursHeld(s).length) return false;
        if (opts.windowWork === 'none' || xpOf(s, 'crafting') >= xpForLevel(99)) return true;
        const p = probeOf(o);
        return p !== undefined && p !== null && p.uncutGems === 0;
    };
    return {
        name: STEP_NAME,
        preconditions: s => preconditions(s, opts),
        async run(ctx) {
            const s = state(ctx);
            const run = newRun(s, opts);
            if (level(s, 'cooking') >= 99) return cutGems(ctx, run, opts);
            note(ctx, { what: 'S25c start', windowWork: run.windowWork, gems: run.gems, slotsUsed: usedSlots(s), cooking: level(s, 'cooking'), craftingXp: xpOf(s, 'crafting') });
            const r1 = await relogGuarded(ctx, run, 'planned-1', opts);
            await split(ctx, run, opts, 'trade', armedAt(r1));
        },
        async resume(ctx) {
            const s = state(ctx);
            const run = newRun(s, opts);
            const p = probeOf(ctx.observed);
            run.cut = (p?.cutGems ?? 0) + cutHeld(s);
            if (level(s, 'cooking') >= 99) return cutGems(ctx, run, opts);
            if (!p) throw new Error('S25c resume needs the wineBank probe (no booth in sight to read the wine)');
            const stage = splitStage(notesHeld(s), p.wine);
            if (stage === 'exhausted') throw new Error(`wine exhausted at Cooking ${level(s, 'cooking')}: none held or banked (the kebab or fish fallback, R17)`);
            run.pastFirst = stage === 'deposit-rest' || stage === 'await-second';
            // this login armed the timer; tickBase is where its count starts (never later than the login)
            const loginTick = ctx.session.tickBase ?? s.tick;
            note(ctx, { what: 'S25c resume', stage, loginTick, probe: p, notes: notesHeld(s), cut: run.cut });
            await split(ctx, run, opts, stage, loginTick);
        },
        postconditions: s => {
            if (level(s, 'cooking') < 99) return `Cooking ${level(s, 'cooking')} < 99`;
            const mine = oursHeld(s);
            if (mine.length) return `still held: ${[...new Set(mine)].join(', ')}`;
            if (s.bank?.isOpen || pageOpen(s)) return 'a bank window or chat page is open';
            return true;
        },
        logoutSafe: true,
        probes: ['wineBank'],
        done,
        inProgress: o => {
            if (!o.state.player || done(o)) return false;
            const s = o.state;
            if (notesHeld(s) > 0 || oursHeld(s).length || level(s, 'cooking') >= 99) return true;
            const p = probeOf(o);
            return !!p && (p.wine.unfermented > 0 || p.wine.fermented > 0);
        }
    };
}

/** `walkIn`: to the stand tile, exactly (no milestone: a transient step, never a checkpoint). */
export function walkInStep(opts: CookingOptions = {}): Step<any> {
    const booth = opts.booth ?? BOOTH;
    const stand = booth.stand ?? { x: booth.x - 1, z: booth.z };
    const there = (s: BotWorldState) => !!s.player && Math.abs(s.player.worldX - stand.x) <= 1 && Math.abs(s.player.worldZ - stand.z) <= 1;
    return {
        name: 'S25c walk-in',
        preconditions: s => (s.inGame && s.player ? true : 'not in game'),
        async run(ctx) {
            const r = await travelTo(ctx.bot as never, ctx.sdk as never, stand, { tolerance: 0, attempts: 20 });
            note(ctx, { what: 'walk-in', ...r, at: [state(ctx).player?.worldX, state(ctx).player?.worldZ] });
            if (!r.ok) throw new Error(`walk-in to (${stand.x},${stand.z}) failed: ${r.reason ?? 'not there'}`);
        },
        postconditions: s => (there(s) ? true : `not at the stand (${stand.x},${stand.z})`),
        logoutSafe: true
    };
}

/**
 * The step-module convention (`skill`, `steps()`): one step, S25c. Options may arrive as strings
 * (the rehearsal harness's `--skill-opt=k=v`): 'true' and 'false' are read as booleans.
 */
export function steps(opts: CookingOptions = {}): Step<any>[] {
    const bool = (v: unknown) => v === true || v === 'true';
    const o: CookingOptions = { ...opts, lab: bool(opts.lab), walkIn: bool(opts.walkIn) };
    return o.walkIn ? [walkInStep(o), cookingStep(o)] : [cookingStep(o)];
}
