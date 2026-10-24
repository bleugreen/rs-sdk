// The scored run's chain, S00 to S17: one table of the run's steps in RUN-ORDER.md order, each
// tagged with its RUN-ORDER id, built from the step modules' own `steps()` (the call selects the
// run's portion; nothing here filters a module by anything but the names it emits), the transition
// legs (runner/legs.ts, the body-altar catalogue), and the hand-offs the modules do not perform
// themselves (runner/handoff.ts, one per inventory-ledger row, placed by PLACEMENT below).
//
// Pure: buildChain reads STEP-MANIFEST.md's ledger and calls the modules' builders, and touches
// neither the game nor the cue directory. speedrun/run.ts runs it; lab/dress-rehearsal.ts runs it
// with the missing steps swapped for lab stand-ins.
//
// Wrappers (each a Step around a Step, so the runner and the resume walk see ordinary steps):
// - whenNeeded: a fallback that is a 0-tick note when its milestone already holds (runSteps does
//   not skip a step whose `done` holds mid-chain);
// - missingStep: a step whose module is not on main yet refuses with the owner's name, and its
//   `done` is the quest's completion, so an account that has it is walked past;
// - withCue: the helper's cue for the step's scope is opened before the module runs, on `run` and
//   on `resume` (a resumed step writes a fresh session, which a separate cue step would miss);
// - censused: a 0-tick `(census)` note before every step (pack, free slots, worn items).
//
// Expected figures are not copied here: the report reads them from RUN-ORDER.md section 2
// (parseStepTable), the one source, at report time.

import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import type { BotWorldState } from '../../sdk/types';
import { writeAnvilPlan } from '../helpers/anvil';
import { CueWriter, writeJsonAtomicSync, writeTopUpAsk, type CueScope } from '../helpers/altar-cue';
import { GO_FILE, type GoCue } from '../helpers/fm-row';
import { INVENTORY_SIZE } from '../lib/items';
import { questDone, type QuestKey } from '../lib/quests';
import type { GiveSpec } from '../lib/trade';
import { tickMs } from '../lib/wait';
import { skillLevel } from '../lib/world';
import * as cooksAssistant from '../quests/cooks-assistant';
import * as doricsQuest from '../quests/dorics-quest';
import * as dragonSlayer from '../quests/dragon-slayer';
import * as druidicRitual from '../quests/druidic-ritual';
import * as goblinDiplomacy from '../quests/goblin-diplomacy';
import * as romeoJuliet from '../quests/romeo-juliet';
import * as dwarfCannon from '../quests/dwarf-cannon';
import * as fightArena from '../quests/fight-arena';
import * as fishingContest from '../quests/fishing-contest';
import * as grandTree from '../quests/grand-tree';
import * as mageArena from '../quests/mage-arena';
import * as monkeyMadness from '../quests/monkey-madness';
import * as plagueCity from '../quests/plague-city';
import * as seaSlug from '../quests/sea-slug';
import * as treeGnomeVillage from '../quests/tree-gnome-village';
import * as agility from '../skills/agility';
import * as cooking from '../skills/cooking';
import * as crafting from '../skills/crafting';
import * as firemaking from '../skills/firemaking';
import * as fletching from '../skills/fletching';
import * as fishing from '../skills/fishing';
import * as herblore from '../skills/herblore';
import * as magic from '../skills/magic';
import * as mining from '../skills/mining';
import * as prayer from '../skills/prayer';
import * as ranged from '../skills/ranged';
import * as runecraft from '../skills/runecraft';
import * as smithing from '../skills/smithing';
import * as start from '../skills/start';
import * as thieving from '../skills/thieving';
import * as woodcutting from '../skills/woodcutting';
import { MANIFEST, parseLedger, type LedgerRow } from '../tools/slot-ledger';
import { askFor, handOffFrom, handOffStep, type HandOffPlan, type HandOffRecord } from './handoff';
import { legById, legsFor, splitLeg, type LegStep } from './legs';
import { type Probe, stepProbes } from './resume';
import { scoredLoginStep, scoredLogoutStep } from './scored-relog';
import { RelogBudget } from './relog-budget';
import type { ObservedCheck, Step, StepContext } from './step';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyStep = Step<any>;

export type ChainKind = 'step' | 'leg' | 'handoff' | 'missing' | 'fallback' | 'cue';

export type ChainStep = AnyStep & {
    /** The RUN-ORDER id (S07), the leg id (T13-14a) or the ledger row (H9). */
    id: string;
    kind: ChainKind;
    /** kind 'missing': who builds it. */
    owner?: string;
    /** A step this run config cannot run, and why (the H12o login with an incomplete h12o block): it refuses on the path. */
    refuses?: string;
    /** withCue: the helper cue opened before it runs. */
    cue?: CueScope;
    /** cueAround: whether a success ends the cue with a final stop (a throw's stop is never final). */
    finalStop?: boolean;
};

// ------------------------------------------------------------------ the run config

/**
 * The run's helpers, from the run config (gitignored: account names). `partners` names the partner
 * of every placed ledger row and every quest kit row (H6, H7, H8, H16, H22); the rest are the
 * modules' own helpers.
 */
export interface RunConfig {
    partners: Readonly<Record<string, string>>;
    /** S03's row, the same tiles the fm-row droppers lay (HS6). */
    firemakingTiles: NonNullable<firemaking.FiremakingOptions['tiles']>;
    /** S04's ring giver (H3) and its loads (default magic.ts ROUTE_LOADS). */
    rings: { giver: string; loads?: magic.MagicOptions['loads'] };
    /** S07's bone giver (H4.x). */
    bones: woodcutting.BonesOptions;
    /**
     * S07's close target, the Prayer level its last band closes at and its early last load fires at
     * (an integer from 1 to 99; absent: S07_PRAYER_TO). Below 99 only when a later step buries the
     * rest: the chain's Prayer-99 check (S25b's fallback) stays where it is.
     */
    s07PrayerTo?: number;
    /** S18's courier (H14.x) and the food count below which it tops up. */
    courier: { giver: string; below: number };
    /** S25a's anvil helper (H21a). */
    anvil: { giver: string };
    /** S25c's wine giver (H21c; default cooking.ts WINE_GIVER). */
    wineGiver?: string;
    /** S21's body-altar giver roster, login names, for its pre-login (default: runecraft.ts's count, helpers/roster.ts BODY_ROSTER_SIZE). */
    s21Givers?: readonly string[];
    /** The cue directory the helpers read (run.ts sets RC_CUE_DIR to it, so thieving's asks land there too). */
    cueDir: string;
    /** mule1's own cue directory, where its package cues and top-up asks go (default muleCueDir: <cueDir>/mule). */
    muleCueDir?: string;
    /**
     * H12o's helper (h45, SUPPLIES.md H12o). `account` is its login name, the partner of both receive
     * legs (Monkey Madness's topUpFrom); `cueDir` is its role folder, which Monkey Madness's module
     * alone writes (H12oM and H12oP, opens and stops); `loginDir` is the launcher's login-only folder
     * (its entry's `loginOn.cueDir`), which h12oLogin alone writes, once, at segment M's start (rs/185),
     * ahead of M's travel to the H12o-M leg; `leadTicks` is the staging lead h45 needs before M, checked
     * and never assumed. Absent or incomplete: the top-ups are off and the login step refuses.
     */
    h12o?: { account?: string; cueDir: string; loginDir: string; leadTicks?: number };
    /**
     * The banked delivery carriers' run (runner/delivery-owner.ts): `run` is the attempt's one
     * delivery id (e.g. `a1-20261023`), the `--delivery-run` every carrier's config is generated with
     * (helpers/mule-ledger.ts); `launcherConfig` is the helper launcher's config those carriers run
     * from, which run.ts's preflight checks against it. Required when the path has a mule row.
     */
    delivery?: { run: string; launcherConfig: string };
    /**
     * The helper launcher configs the role-phase gate reads to learn who serves each step and each bone
     * giver's sites (run.ts hostPhaseGates). Default: `delivery.launcherConfig` alone. Give every
     * launcher file when the families are split across several.
     */
    helperLaunchers?: readonly string[];
}

/**
 * S09's mining options: a contested zoo band may move to any other site whose hunters leave SCORED's
 * combat level alone (`fallback: 'auto'`, mining.ts nextSite with the `safeFrom` gate, #371).
 * `acceptHazards` is never set for SCORED: it is for rehearsals that mean to walk into a site's hunters.
 */
export const S09_MINING: mining.MiningOpts = { travel: 'none', dropAtExit: true, fallback: 'auto' };

/** mule1's cue directory (STEP-MANIFEST.md "Cue layout"): the run config's `muleCueDir`, else `<cueDir>/mule`. */
export function muleCueDir(cfg: Pick<RunConfig, 'cueDir' | 'muleCueDir'>): string {
    return cfg.muleCueDir ?? join(cfg.cueDir, 'mule');
}

/** Where the modules' cues go: run.ts's CueKeeper, a recorder in tests. */
export interface CueSink {
    /** Open `scope`'s cue (a fresh session when `fresh`, else only when another scope or none is open). */
    open(scope: CueScope, ctx: Pick<StepContext<unknown>, 'sdk'>, o: { fresh: boolean }): Promise<void>;
    /** Write the stop of `scope`'s cue if it is the open one (`failed`: the step threw). */
    stop(scope: CueScope, ctx: StepContext<unknown>, o?: { final?: boolean; failed?: boolean }): void;
    /** Rewrite `scope`'s open delivery cue now, just before its trade; record-only sinks may omit this. */
    refresh?(scope: CueScope): boolean;
    /** Runtime ownership of a module's direct writer; record-only sinks may omit this. */
    writer?(scope: CueScope): runecraft.CueSink;
    /**
     * True until the owned scope ends, including between Runecraft segment sessions: a cue stop is
     * `done` once its scope is no longer open. Without it the stop has no `done`.
     */
    isOpen?(scope: CueScope): boolean;
}

export interface ChainOptions {
    /** STEP-MANIFEST.md's text (default: read from MANIFEST). */
    manifest?: string;
    cues: CueSink;
    /** SCORED's relog between S21's pre-login and its band (run.ts --s21-relog; default on). */
    s21Relog?: boolean;
    relogs?: RelogBudget;
    /**
     * The attempt's hand-off completion record (run.ts: <run dir>/handoffs.json under `attempt`), which
     * keeps a placed hand-off done once its band has eaten into what it brought (handoff.ts, Resume).
     * Absent: a hand-off reads done from the state and the next milestone only.
     */
    handOffs?: HandOffRecord;
    /**
     * The attempt's id, the same in every process that resumes it (run.ts: the run id of its tick log's
     * first row). A cue whose givers count work per session takes its session from it (S07's bone cue,
     * boneSession), so a resume carries the session on. Absent: each process has its own.
     */
    attempt?: string;
}

/** S07's bone cue session for an attempt. */
export const boneSession = (attempt: string): string => `${attempt}.S07.bone`;

/** S07's close target when the run config names none: Prayer 99 inside S07 (fold-in 23). */
export const S07_PRAYER_TO = 99;

/** The run config's S07 close target (`s07PrayerTo`), validated; S07_PRAYER_TO when absent. */
export function s07PrayerTo(cfg: Pick<RunConfig, 's07PrayerTo'>): number {
    const v = cfg.s07PrayerTo;
    if (v === undefined) return S07_PRAYER_TO;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 99) throw new Error(`run config: s07PrayerTo must be an integer from 1 to 99, got ${JSON.stringify(v)}`);
    return v;
}

/**
 * S07's woodcutting options: burying from the oaks to 99 (so the oak and willow bands run the knife,
 * woodcutting.ts bandTechnique), Prayer to the run config's s07PrayerTo (99 unless it says), the axe
 * dropped at the end, and the attempt's bone cue session for a giver group.
 */
export function s07Woodcutting(cfg: Pick<RunConfig, 'bones' | 's07PrayerTo'>, attempt?: string): woodcutting.WoodcuttingOptions {
    return { bury: true, bones: cfg.bones, dropAxe: true, prayerTo: s07PrayerTo(cfg), ...(attempt && cfg.bones.group ? { boneSession: boneSession(attempt) } : {}) };
}

// ------------------------------------------------------------------ hand-off placement

export type Placement =
    /** The hand-off is the step itself (S01 is H1). */
    | { as: string }
    /** Just before the first step of `before`. */
    | { before: string }
    /** Between the parts of leg `leg` split after hop `afterHop` (the Ardougne landing). */
    | { leg: string; afterHop: number; firstTicks?: number; firstSource?: string };

/**
 * Every ledger hand-off run.ts performs and where. Rows a fold-in may split (H12 into H12a + H12b,
 * fold-in 23) are all listed; buildChain places those the ledger in force has (ALTERNATIVES).
 */
export const PLACEMENT: Readonly<Record<string, Placement>> = {
    H1: { as: 'S01' },
    H4k: { before: 'S07' },
    H9: { leg: 'T11-12', afterHop: 0 },
    H10: { leg: 'T12-13', afterHop: 0 },
    H11: { leg: 'T13-14', afterHop: 0 },
    H11r: { leg: 'T14-15', afterHop: 1, firstTicks: 70, firstSource: 'RUN-ORDER.md section 2 T14-15: X14n 66 to Wilderness 20 + the teleport 4' },
    // The quest kit rows, traded at the quest's arrival so the kit segment only checks (rs/185, rs/186).
    H6: { before: 'S08' },
    H4p: { before: 'S09' },
    H7: { before: 'S10b' },
    H8: { before: 'S11b' },
    H16: { before: 'S20' },
    H22: { before: 'S26' },
    H13: { leg: 'T15-16', afterHop: 0 },
    H14: { before: 'S18' },
    H15: { before: 'S19' },
    H18: { before: 'S22' },
    H19: { before: 'S23' },
    H20: { before: 'S24' },
    H21d: { before: 'S25d' },
    H23: { leg: 'T26-27', afterHop: 0 },
};

/**
 * Rows a module trades itself whose partner the run config names (kitFrom): S05's H4 and S15's H12
 * (or H12a + H12b, both traded in Monkey Madness's one gtSwap, so one partner for both), each
 * required when the ledger in force carries it.
 */
export const KIT_PARTNER_ROWS = ['H4', 'H12', 'H12a', 'H12b'] as const;

/** Exactly one group of each set is in the ledger in force (the ledger is the switch). */
export const ALTERNATIVES: readonly (readonly (readonly string[])[])[] = [[['H12'], ['H12a', 'H12b']]];

/** Rows a module still trades itself that a lab stand-in for it must supply: the stand-in's hand-offs. */
export const STAND_IN_ROWS: Readonly<Record<string, readonly string[]>> = { S15: ['H12', 'H12a', 'H12b'] };

/** Rows a step module trades itself (do not double them with a handOff). */
export const INTERNAL: Readonly<Record<string, string>> = {
    H2: 'S03 firemaking (the fm-row droppers; its trade fallback)',
    H3: 'S04 magic (ring loads)',
    H4: "S05 Doric's Quest, segment A (the ledger row through handoff.ts; rs/416)",
    'H4.x': 'S07 woodcutting (bone loads)',
    H5: 'S06 runecraft (cue-driven essence)',
    // Traded in S15's segment A (gtSwap by h12Plan with kitFrom, on its {H12, mule} cue: KIT_SEGMENTS).
    H12: 'S15 monkey-madness (gtSwap at King Narnode)',
    H12a: 'S15 monkey-madness (gtSwap at King Narnode)',
    H12b: 'S15 monkey-madness (gtSwap at King Narnode)',
    // rs/185's ruling: both H12o legs trade inside Monkey Madness; run.ts only fires the helper's login trigger before M.
    'H12o-M': 'S15 monkey-madness, segment M (H12o\'s first leg)',
    'H12o-P': 'S15 monkey-madness, segment P (H12o\'s second leg)',
    'H14.x': 'S18 thieving (idle top-ups)',
    H17: 'S21 runecraft (altar roster)',
    H17e: 'S21 runecraft (hand-back)',
    H21a: 'S25a smithing (bars in, platebodies back)',
    H21c: 'S25c cooking (wine delivery)',
};

/** Ledger rows that are not trades: no `in` and no `out` (retired, or a placeholder). */
export const NOT_TRADES: readonly string[] = ['H2', 'H4m.x', 'H21b'];

/**
 * The cannon rows: the holder (cannon.ts serve mode) serves only the receiver its cue names, so
 * these hand-offs go through handoff.ts's cue option (the one cannon receiver; the lab stand-in
 * helpers/cannon-receiver.ts runs the same sequence), the cue opened by the run's CueSink so S14's
 * and S27's own cues continue the same session.
 */
export const CANNON_ROWS: Readonly<Record<string, CueScope>> = { H11: { step: 'S14', family: 'cannon' }, H23: { step: 'S27', family: 'cannon' } };

/**
 * mule1's rows (rs/443; SUPPLIES.md's helper column), H3 being h81-h83's. Its request mode serves
 * exactly the package its {<row>, mule} cue names. H4 is cued around Doric's segment A, the trade
 * that runs it (KIT_SEGMENTS), and H12 around Monkey Madness's segment A, whose gtSwap trades it by
 * h12Plan; the other quest kit rows are placed hand-offs at their quest's arrival. The split H12a +
 * H12b (one swap, two packages) is not cued. H4e and H4m are cued only on their fallbacks.
 */
export const MULE_ROWS: readonly string[] = ['H1', 'H4', 'H4k', 'H6', 'H4p', 'H7', 'H8', 'H9', 'H10', 'H12', 'H12a', 'H12b', 'H13', 'H14', 'H15', 'H16', 'H18', 'H19', 'H20', 'H21d', 'H22'];

/**
 * The kit rows a module trades itself, by the name of the segment step that trades them: mule1's
 * {row, mule} cue is opened around that segment (muleCued), and the lab staff-supplies the row just
 * before it (lab/dress-rehearsal.ts labChain). H4 is Doric's segment A (quests/dorics-quest.ts h4Plan),
 * H12 Monkey Madness's (quests/monkey-madness.ts gtSwap).
 */
export const KIT_SEGMENTS: Readonly<Record<string, string>> = { H4: 'S05:A-h4-swap', H12: 'S15:A-narnode' };

/** A mule package's scope: for family 'mule' the step is the hand-off id (rs/158, rs/186), every other family keeps the step id. */
export const muleScope = (row: string): CueScope => ({ step: row, family: 'mule' });

/**
 * `step` with mule1's {row, mule} cue around it (cueAround): a repeated hand-off rewrites its own
 * package's cue, and one skipped as done writes none and leaves none open, so the next cue always
 * names its own package. A served carrier keeps its stand until its session's stop (helpers/mule.ts
 * keepsStandAfterServe): `final` ends it there for good, a plain stop only releases it for a later row.
 */
export function muleCued(step: ChainStep, row: string, cues: CueSink, o: { final?: boolean } = {}): ChainStep {
    return cueAround(step, muleScope(row), cues, { final: o.final ?? false });
}

/**
 * The chain's mule cues, decided over the whole built chain: each step in `rows` (step to its ledger
 * row) is muleCued, and each carrier's last such step in chain order stops final on success, so no
 * carrier stands until the launcher ends; every earlier row of that carrier stops plain. 'Last' is over
 * the steps present, so an alternative or fallback the ledger in force leaves out never counts.
 */
export function cueMuleRows(chain: readonly ChainStep[], rows: ReadonlyMap<ChainStep, string>, carrierOf: (row: string) => string, cues: CueSink): ChainStep[] {
    const last = new Map<string, ChainStep>();
    for (const s of chain) {
        const row = rows.get(s);
        if (row !== undefined) last.set(carrierOf(row), s);
    }
    const finals = new Set(last.values());
    return chain.map(s => {
        const row = rows.get(s);
        return row === undefined ? s : muleCued(s, row, cues, { final: finals.has(s) });
    });
}

/**
 * The families whose cue is only the helper launcher's trigger: logged in on the scope's open, out on
 * its stop. S03's droppers still start laying on the go cue (dropperGoCue); S04's ring givers trade
 * on magic.ts's own requests.
 */
export const FAMILY_CUES = { S03: { step: 'S03', family: 'fmrow' }, S04: { step: 'S04', family: 'ring' } } as const satisfies Record<string, CueScope>;

/**
 * `step` with `scope`'s cue opened afresh before it and stopped after it, failed or not: the stop is the
 * family's logout trigger. A throw (a failed step, or one a drop cut that runResumable walks back into)
 * stops it non-final, so the helpers stand down for the resumed step or the re-run instead of retiring
 * (cue-keeper.ts exitStopIsFinal).
 */
export function cueAround(step: ChainStep, scope: CueScope, cues: CueSink, stop: { final?: boolean } = { final: true }): ChainStep {
    const wrap = (f: (ctx: StepContext<unknown>) => Promise<void>) => async (ctx: StepContext<unknown>) => {
        await cues.open(scope, ctx, { fresh: true });
        try {
            await f(ctx);
        } catch (e) {
            cues.stop(scope, ctx, { final: false, failed: true });
            throw e;
        }
        cues.stop(scope, ctx, stop);
    };
    return { ...step, cue: scope, finalStop: stop.final ?? true, run: wrap(step.run), resume: wrap(step.resume ?? step.run) };
}

export function ledgerRows(manifest: string): LedgerRow[] {
    const { rows, errors } = parseLedger(manifest);
    if (errors.length) throw new Error(`the inventory ledger does not parse: ${errors.join('; ')}`);
    return rows;
}

/** Every H row is placed, internal, or not a trade, and each alternative set has exactly one group. */
export function ledgerCoverage(rows: readonly LedgerRow[]): string[] {
    const ids = new Set(rows.map(r => r.row));
    const out: string[] = [];
    for (const r of rows) {
        if (!/^H/.test(r.row)) continue;
        if (PLACEMENT[r.row] || INTERNAL[r.row]) continue;
        if (NOT_TRADES.includes(r.row)) {
            if (r.in.length || r.out.length) out.push(`${r.row} (line ${r.line}) is listed as not a trade but has ${r.in.length} in and ${r.out.length} out`);
            continue;
        }
        out.push(`${r.row} (line ${r.line}) is neither placed, internal to a module, nor a non-trade: chain.ts must place it`);
    }
    for (const set of ALTERNATIVES) {
        const whole = set.filter(g => g.every(id => ids.has(id)));
        const partial = set.filter(g => g.some(id => ids.has(id)) && !g.every(id => ids.has(id)));
        if (whole.length !== 1 || partial.length) out.push(`the ledger must carry exactly one of ${set.map(g => g.join(' + ')).join(' or ')} (has ${set.flat().filter(id => ids.has(id)).join(', ') || 'none'})`);
    }
    return out;
}

// ------------------------------------------------------------------ wrappers

/**
 * `step`, a module's own trade with a standing mule partner (S15's gtSwap for H12), with the row's
 * top-up ask written on the first frame showing that trade open, as handoff.ts writes a placed row's:
 * mule.ts offers a top-up line (H12's `shark to 15`) only on SCORED's ask. Sized from the state the
 * step starts in; nothing is written when every top-up is met.
 */
export function askedOnTrade(step: ChainStep, plan: HandOffPlan, partner: string, dir: string): ChainStep {
    const wrap = (f: (ctx: StepContext<unknown>) => Promise<void>) => async (ctx: StepContext<unknown>) => {
        const s = ctx.sdk.getState();
        const items = s ? askFor(s, plan) : [];
        const off = items.length ? monkeyMadness.onTradeOpen(ctx.sdk, partner, () => void writeTopUpAsk(dir, items, Date.now(), muleScope(plan.id))) : () => {};
        try {
            await f(ctx);
        } finally {
            off();
        }
    };
    return { ...step, run: wrap(step.run), resume: wrap(step.resume ?? step.run) };
}

/** A copy of `s` whose methods stay bound to `s`, so it survives the runner's object spreads. */
function bound(s: AnyStep): AnyStep {
    return {
        ...s,
        preconditions: s.preconditions.bind(s),
        postconditions: s.postconditions.bind(s),
        run: s.run.bind(s),
        ...(s.resume ? { resume: s.resume.bind(s) } : {}),
        ...(s.done ? { done: s.done.bind(s) } : {}),
        ...(s.inProgress ? { inProgress: s.inProgress.bind(s) } : {}),
    };
}

export function tag(id: string, kind: ChainKind, s: AnyStep, extra: Partial<ChainStep> = {}): ChainStep {
    return { ...bound(s), id, kind, ...extra };
}

/** A 0-tick `note` row in the step's log. */
export function noteRow(ctx: Pick<StepContext<unknown>, 'log' | 'session' | 'sdk'>, step: string, meta: Record<string, unknown>): void {
    const tick = ctx.sdk.getState()?.tick ?? -1;
    ctx.log.append({
        v: 1, kind: 'note', runId: ctx.log.runId, account: ctx.session.name, sessionId: ctx.session.sessionId, step,
        startTick: tick, endTick: tick, ticks: 0, wallMs: 0, ok: true, meta, tickMs: tickMs(), at: new Date().toISOString(),
    });
}

export type Met = (s: BotWorldState) => boolean;

/** A fallback: a 0-tick note when `met` already holds, else `step` itself. */
export function whenNeeded(id: string, step: ChainStep | AnyStep, met: Met, why: string): ChainStep {
    const s = bound(step);
    const skip = async (ctx: StepContext<unknown>, entry: (ctx: StepContext<unknown>) => Promise<void>) => {
        const st = ctx.sdk.getState();
        if (st && met(st)) return noteRow(ctx, `${s.name} (not needed)`, { id, why });
        await entry(ctx);
    };
    return {
        ...s,
        id,
        kind: 'fallback',
        ...('owner' in step && step.owner ? { owner: step.owner } : {}),
        name: `${s.name} (fallback)`,
        preconditions: (st, c) => (met(st) ? true : s.preconditions(st, c)),
        postconditions: (st, c) => (met(st) ? true : s.postconditions(st, c)),
        run: ctx => skip(ctx, s.run),
        resume: ctx => skip(ctx, s.resume ?? s.run),
        done: (o, c) => met(o.state) || !!s.done?.(o, c),
        inProgress: (o, c) => !met(o.state) && !!s.inProgress?.(o, c),
    };
}

/** A step whose module is not on main: refuses with `owner`; `done` is the quest's completion. */
export function missingStep(id: string, name: string, owner: string, quest?: QuestKey): ChainStep {
    const why = `${id} not built (${owner})`;
    return {
        id, kind: 'missing', owner, name, logoutSafe: true,
        preconditions: () => why,
        postconditions: () => why,
        run: async () => {
            throw new Error(why);
        },
        ...(quest ? { done: questDone(quest) } : {}),
    };
}

/** `step` with `scope`'s cue opened before `run` (when not open) and before every `resume` (fresh). */
export function withCue(step: ChainStep, scope: CueScope, cues: CueSink): ChainStep {
    const s = step;
    return {
        ...s,
        cue: scope,
        run: async ctx => {
            await cues.open(scope, ctx, { fresh: false });
            await s.run(ctx);
        },
        resume: async ctx => {
            await cues.open(scope, ctx, { fresh: true });
            await (s.resume ?? s.run)(ctx);
        },
    };
}

/**
 * S03's droppers' go cue (helpers/fm-row.ts `start: 'cue'`, GO_FILE; STEP-MANIFEST.md HS6 and entry
 * 16): written at S01, the run's first login, so log 0's 100-tick private window runs while SCORED
 * trades H1, walks to the coop and strikes S02. The droppers count from the tick they see it
 * (`cueAt: 'seen'`), so the file's ms is a record, not a clock.
 *
 * Written once per run: `done` is the file's presence (prepareCueDir removes it at a fresh start
 * only), so a resume walks past it, and a run never rewrites it, which would restart the droppers.
 */
export function dropperGoCue(cueDir: string): ChainStep {
    const file = join(cueDir, GO_FILE);
    const run = async (ctx: StepContext<unknown>) => {
        if (existsSync(file)) return noteRow(ctx, 'S03 dropper go cue', { file: GO_FILE, kept: true });
        const cue: GoCue = { v: 1, ms: Date.now() };
        writeJsonAtomicSync(file, cue);
        noteRow(ctx, 'S03 dropper go cue', { file: GO_FILE });
    };
    return {
        id: 'S03 go cue', kind: 'cue', name: 'S03 dropper go cue', logoutSafe: true, marker: true,
        preconditions: () => true, postconditions: () => true, run, resume: run, done: () => existsSync(file),
    };
}

/** The one scope h45's login-only folder carries. */
export const H12O_LOGIN: CueScope = { step: 'H12o', family: 'mule' };

/** Why h45's login trigger cannot fire with this config, or null. */
export function h12oLoginRefusal(cfg: Pick<RunConfig, 'cueDir' | 'muleCueDir' | 'h12o'>): string | null {
    const h = cfg.h12o;
    if (!h) return 'H12o login: the run config has no h12o block (h45\'s role and login folders)';
    if (typeof h.account !== 'string' || !h.account) return 'H12o login: the run config gives no h12o.account, h45\'s login name, the partner of both top-up legs';
    if (h.leadTicks === undefined) return 'H12o login: the run config gives no h12o.leadTicks, the lead before segment M; none is assumed';
    if (!Number.isSafeInteger(h.leadTicks) || h.leadTicks <= 0) return `H12o login: h12o.leadTicks ${h.leadTicks} is not a positive whole number of ticks`;
    const roles = [cfg.cueDir, muleCueDir(cfg), h.cueDir].map(d => resolve(d));
    if (roles.includes(resolve(h.loginDir))) return `H12o login: ${h.loginDir} is a role folder; the trigger writes only h45's login-only folder`;
    return null;
}

/** Monkey Madness's top-ups (both H12o legs) from the run config's h12o block, or none while it refuses. */
export function h12oTopUp(cfg: Pick<RunConfig, 'cueDir' | 'muleCueDir' | 'h12o'>): monkeyMadness.TopUp | undefined {
    return h12oLoginRefusal(cfg) === null ? { from: cfg.h12o!.account!, m: true, p: true, cueDir: cfg.h12o!.cueDir } : undefined;
}

/**
 * h45's login trigger: one H12o/mule cue in its login-only folder. It only logs h45 in; the launcher
 * stops reading the folder once the login settles (helpers/standalone.ts CueGate), and refuses it once
 * h45's role folder has closed H12oP. There is one, at segment M's start; P has none.
 *
 * `done` is Monkey Madness past M, so a resume into N..Z does not write it again. Not past P: a
 * second trigger after h45's session dropped would never log it back in, the launcher no longer
 * reading the folder, so a resume into N..P costs P's top-up (the leg's bounded wait, then on).
 */
export function h12oLogin(cfg: Pick<RunConfig, 'cueDir' | 'muleCueDir' | 'h12o'>): ChainStep {
    const run = async (ctx: StepContext<unknown>) => {
        const why = h12oLoginRefusal(cfg);
        if (why) throw new Error(why);
        const st = ctx.sdk.getState();
        const receiver = st?.player?.name;
        if (!st || !receiver) throw new Error('H12o login: no game frame with a player to beacon the cue from');
        new CueWriter(cfg.h12o!.loginDir, receiver, H12O_LOGIN).write({ beacons: [{ tick: st.tick, ms: Date.now() }], turns: [] });
        noteRow(ctx, 'H12o login', { dir: cfg.h12o!.loginDir, leadTicks: cfg.h12o!.leadTicks });
    };
    const refuses = h12oLoginRefusal(cfg);
    return {
        id: 'H12o login', kind: 'cue', name: 'H12o h45 login trigger', logoutSafe: true, preconditions: () => true, postconditions: () => true, run, resume: run,
        done: monkeyMadness.doneAt('M'), probes: [monkeyMadness.JOURNAL_PROBE], ...(refuses ? { refuses } : {}),
    };
}

/**
 * A 0-tick step that writes the stop of `scope`'s cue. `done` once that cue is no longer open (the
 * sink's isOpen), so a resume after the stop never writes a late one
 * into a helper's newer session; a marker, so a resume before it finishes the step before it first.
 */
export function cueStop(scope: CueScope, cues: CueSink): ChainStep {
    const run = async (ctx: StepContext<unknown>) => cues.stop(scope, ctx);
    return {
        id: `${scope.step} cue stop`, kind: 'cue', name: `${scope.step} ${scope.family} cue stop`, logoutSafe: true, marker: true,
        preconditions: () => true, postconditions: () => true, run, resume: run,
        ...(cues.isOpen ? { done: () => !cues.isOpen!(scope) } : {}),
    };
}

/** A cueStop step; `of` narrows it to the stop that ends that step's band. */
export function isCueStop(s: ChainStep, of?: string): boolean {
    return s.kind === 'cue' && (of === undefined ? s.id.endsWith(' cue stop') : s.id === `${of} cue stop`);
}

/** What the pack holds at a boundary. */
export function census(s: BotWorldState): { inventory: { name: string; count: number }[]; free: number; worn: string[] } {
    return { inventory: s.inventory.map(i => ({ name: i.name, count: i.count })), free: INVENTORY_SIZE - s.inventory.length, worn: s.equipment.map(e => e.name) };
}

export const CENSUS_STEP = '(census)';

/** `step` with a 0-tick `(census)` note before it runs or resumes. */
export function censused(step: ChainStep): ChainStep {
    const at = (ctx: StepContext<unknown>) => {
        const st = ctx.sdk.getState();
        if (st) noteRow(ctx, CENSUS_STEP, { before: step.name, id: step.id, ...census(st) });
    };
    return {
        ...step,
        run: async ctx => {
            at(ctx);
            await step.run(ctx);
        },
        resume: async ctx => {
            at(ctx);
            await (step.resume ?? step.run)(ctx);
        },
    };
}

// ------------------------------------------------------------------ module selection

/** The steps of `all` named in `names`, in that order; a name the module does not emit is an error. */
export function pick(module: string, all: readonly AnyStep[], names: readonly string[]): AnyStep[] {
    return names.map(n => {
        const s = all.find(x => x.name === n);
        if (!s) throw new Error(`${module}: emits no step "${n}" (it emits ${all.map(x => x.name).join(', ')})`);
        return s;
    });
}

function byPrefix(module: string, all: readonly AnyStep[], prefix: string): AnyStep[] {
    const out = all.filter(s => s.name.startsWith(prefix));
    if (!out.length) throw new Error(`${module}: emits no step named "${prefix}..."`);
    return out;
}

const at99 = (skill: string): Met => s => skillLevel(s, skill) >= 99;

/** S25a's `announce`: each plan smithing.ts sends goes to the anvil helper's anvil-plan.json. */
export function anvilAnnounce(cueDir: string): NonNullable<smithing.SmithingOptions['announce']> {
    return m => void writeAnvilPlan(cueDir, m);
}

/** H21a's swap-outs, from the ledger row smithing.ts takes them back by. */
export function h21aGiveBack(manifest: string): GiveSpec[] {
    return handOffFrom(manifest, 'H21a').give.map(g => ({ item: g.ids ? g.ids[0]! : g.pattern, n: g.count }));
}

// ------------------------------------------------------------------ the chain

interface PendingHandOff {
    kind: 'pending-handoff';
    row: string;
    id: string;
}

type Entry = ChainStep | PendingHandOff;

/** The scored run's chain, S00 to S17. Throws on a config that names no partner for a placed row. */
/** Every step module the chain is built from, for the probes they export (chainProbes). */
const MODULES = [
    cooksAssistant, doricsQuest, dragonSlayer, druidicRitual, goblinDiplomacy, romeoJuliet, dwarfCannon, fightArena, fishingContest, grandTree, mageArena,
    monkeyMadness, plagueCity, treeGnomeVillage, agility, cooking, crafting, firemaking, fletching, fishing, herblore, magic, mining, prayer, ranged, runecraft, smithing,
    start, thieving, woodcutting,
] as const;

/** runResumable's probes for `chain`, from MODULES' exported PROBES and the quest journals; throws naming any nothing provides. */
export function chainProbes(chain: readonly ChainStep[]): Record<string, Probe> {
    return stepProbes(chain, MODULES);
}

export function buildChain(cfg: RunConfig, o: ChainOptions): ChainStep[] {
    const manifest = o.manifest ?? readFileSync(MANIFEST, 'utf8');
    const rows = ledgerRows(manifest);
    const inLedger = new Set(rows.map(r => r.row));
    const coverage = ledgerCoverage(rows);
    if (coverage.length) throw new Error(`ledger coverage: ${coverage.join('; ')}`);
    const placed = Object.keys(PLACEMENT).filter(id => inLedger.has(id));
    const missingPartners = [...placed, ...KIT_PARTNER_ROWS.filter(id => inLedger.has(id))].filter(id => !cfg.partners[id]);
    if (missingPartners.length) throw new Error(`the run config names no partner for ${missingPartners.join(', ')}`);
    const partner = (id: string) => cfg.partners[id]!;
    const kitFrom = (id: string) => ({ kitFrom: partner(id) });

    const legs = legsFor({ s21Altar: 'body' });
    const L = (id: string): ChainStep => tag(id, 'leg', legById(id, legs));
    const step = (id: string, s: AnyStep): ChainStep => tag(id, 'step', s);
    const steps = (id: string, ss: readonly AnyStep[]) => ss.map(s => step(id, s));
    const cued = (scope: CueScope, ss: ChainStep[]) => ss.map(s => withCue(s, scope, o.cues));
    const hand = (row: string, id = row): Entry[] => (inLedger.has(row) ? [{ kind: 'pending-handoff', row, id }] : []);
    /** The hand-offs placed before `id`, in PLACEMENT order. */
    const before = (id: string): Entry[] => Object.entries(PLACEMENT).flatMap(([row, p]) => ('before' in p && p.before === id ? hand(row) : []));
    /** Leg `id`, split at its hand-off when PLACEMENT puts one on it. */
    const legWith = (id: string, after: ChainStep[] = []): Entry[] => {
        const at = Object.entries(PLACEMENT).find(([row, p]) => 'leg' in p && p.leg === id && inLedger.has(row));
        if (!at) return [L(id)];
        const [row, p] = at as [string, Extract<Placement, { leg: string }>];
        const [a, b] = splitLeg(legById(id, legs), p.afterHop, { ...(p.firstTicks ? { firstTicks: p.firstTicks } : {}), ...(p.firstSource ? { firstSource: p.firstSource } : {}) });
        return [tag(a.def.id, 'leg', a), ...hand(row), ...after, tag(b.def.id, 'leg', b)];
    };

    const s14: CueScope = { step: 'S14', family: 'cannon' };
    const s27: CueScope = { step: 'S27', family: 'cannon' };
    /** The steps mule1's {row, mule} cue goes around, cued by cueMuleRows once the chain is built. */
    const muleRows = new Map<ChainStep, string>();
    const mule = (s: ChainStep, row: string): ChainStep => {
        muleRows.set(s, row);
        return s;
    };

    const woodcuttingAll = woodcutting.steps(s07Woodcutting(cfg, o.attempt));
    const wc = (n: string) => pick('woodcutting', woodcuttingAll, [n]);
    // S07's {bone} cue has one writer: woodcutting.ts for a giver group (BoneCue, one session across
    // both bands), the chain for one giver, for which woodcutting.ts writes none. Both writing the group's
    // would be two sessions in one cue file, and a resume's fresh open writes the stop the givers leave on.
    const boneCued = (ss: ChainStep[]) => (cfg.bones.group ? ss : cued({ step: 'S07', family: 'bone' }, ss));
    const rcDeps: Partial<runecraft.RunecraftDeps> = o.cues.writer ? { openCue: (_dir, _receiver, scope) => o.cues.writer!(scope) } : {};
    const s21Opts: runecraft.RunecraftOptions = { s21Altar: 'body', cueDir: cfg.cueDir, deps: rcDeps, ...(cfg.s21Givers ? { s21Givers: cfg.s21Givers } : {}) };
    const runecraftS21 = pick('runecraft', runecraft.steps(s21Opts), ['S21 runecraft']);
    const relogs = o.relogs ?? new RelogBudget(join(cfg.cueDir, '..'));
    // S15 (rs/185's options): fixed dialogue, the ruled per-segment eating, the H12 kit from its partner
    // (segment A's gtSwap, on its {H12, mule} cue with its shark ask), and both H12o legs from h45;
    // h45's login trigger goes in at segment M's start.
    const h12Rows = ALTERNATIVES[0]!.find(g => g.every(id => inLedger.has(id))) ?? [];
    const h12Givers = [...new Set(h12Rows.map(partner))];
    if (h12Givers.length > 1) throw new Error(`S15's gtSwap trades ${h12Rows.join(' + ')} in one swap: the run config names ${h12Givers.join(', ')}, not one partner for both`);
    const s15 = steps('S15', monkeyMadness.steps({
        dialogue: 'fixed',
        eating: monkeyMadness.SEGMENT_EATING,
        ...(h12Givers.length ? { kitFrom: h12Givers[0]! } : {}),
        ...(h12oTopUp(cfg) ? { topUpFrom: h12oTopUp(cfg)! } : {}),
    })).map(s => (s.name === KIT_SEGMENTS.H12 && inLedger.has('H12') ? mule(askedOnTrade(s, handOffFrom(manifest, 'H12'), partner('H12'), muleCueDir(cfg)), 'H12') : s));
    const atM = s15.findIndex(s => s.name.startsWith('S15:M-'));
    if (atM < 0) throw new Error('monkey-madness: emits no segment M step for the H12o login trigger');
    const preLogin = runecraft.preLoginStep(s21Opts);
    const logout = scoredLogoutStep({ budget: relogs });
    const s21Logout = {
        ...logout,
        // Resume considers this milestone before the preceding transient travel leg.
        preconditions: (s: BotWorldState, c: unknown) => {
            const live = logout.preconditions(s, c);
            return live === true ? legById('T20-21', legs).postconditions(s, c) : live;
        },
    };
    const s21Login = scoredLoginStep({
        budget: relogs,
        beforeDispatch: () => runecraft.preLoginDeadline(s21Opts),
        beforeLogin: async ctx => {
            if (runecraft.preLoginReady(s21Opts) !== true) await preLogin.run(ctx);
            const ready = runecraft.preLoginReady(s21Opts);
            if (ready !== true) throw new Error(ready);
        }
    });


    const entries: Entry[] = [
        ...steps('S00', start.steps()),
        dropperGoCue(cfg.cueDir),
        ...hand('H1', 'S01'),
        L('T01-02'),
        ...steps('S02', pick('magic', magic.steps({ strikeUntil: 7 }), [magic.S02_ID])),
        L('T02-03'),
        ...steps('S03', firemaking.steps({ tiles: cfg.firemakingTiles, supply: 'row' })).map(s => cueAround(s, FAMILY_CUES.S03, o.cues)),
        ...steps('S04', pick('magic', magic.steps({ untilLevel: 59, giver: cfg.rings.giver, ...(cfg.rings.loads ? { loads: cfg.rings.loads } : {}) }), [magic.S04_ID])).map(s => cueAround(s, FAMILY_CUES.S04, o.cues)),
        L('T04-05'),
        ...steps('S05', doricsQuest.steps(kitFrom('H4'))).map(s => (s.name === KIT_SEGMENTS.H4 ? mule(s, 'H4') : s)),
        L('T05-06'),
        // Runecraft drives the writer's turns; the run owns its lifetime, including aborts.
        ...steps('S06', pick('runecraft', runecraft.steps({ untilLevel: 44, cueDir: cfg.cueDir, deps: rcDeps }), ['S06 runecraft'])),
        cueStop({ step: 'S06', family: 'altar' }, o.cues),
        L('T06-07'),
        ...before('S07'),
        ...boneCued(steps('S07', [...wc('woodcutting:walk-oaks'), ...wc('woodcutting:normal-1-15'), ...wc('woodcutting:oak-15-73')])),
        L('T07a'),
        ...boneCued(steps('S07', [...wc('woodcutting:willow-73-99'), ...wc('woodcutting:drop-axe')])),
        L('T07-08'),
        // The quests' kit rows are placed hand-offs at the arrival tile: each kit segment then only checks.
        ...before('S08'),
        ...steps('S08', plagueCity.steps()),
        L('T08-09'),
        // H4p, the run's only rune pickaxe, is a placed hand-off (no kitGiver: mining emits no kit step).
        ...before('S09'),
        ...steps('S09', pick('mining', mining.steps(S09_MINING), ['mining.iron-63', 'mining.exit'])),
        L('T09-10'),
        ...before('S10b'),
        ...steps('S10b', treeGnomeVillage.steps()),
        L('T10-11'),
        // To 25: the Grand Tree's climb to Glough's pillars needs it, and no Agility potion is carried (grand-tree.ts kitCheck).
        ...steps('S11a', pick('agility', agility.steps({ to: 25 }), ['agility:gnome'])),
        L('T11a'),
        ...before('S11b'),
        ...steps('S11b', grandTree.steps()),
        ...legWith('T11-12'),
        ...steps('S12', fightArena.steps()),
        ...legWith('T12-13'),
        ...steps('S13', dwarfCannon.steps()),
        ...legWith('T13-14'),
        ...cued(s14, steps('S14', ranged.steps({ which: 'cannonSession' }))),
        ...legWith('T14-15', [cueStop(s14, o.cues)]),
        ...before('S15'),
        ...s15.slice(0, atM),
        h12oLogin(cfg),
        ...s15.slice(atM),
        ...legWith('T15-16'),
        ...steps('S16', mageArena.steps()),
        L('T16-18'),
        ...before('S18'),
        ...cued({ step: 'S18', family: 'courier' }, steps('S18', pick('thieving', thieving.steps({ topUp: { giver: cfg.courier.giver, below: cfg.courier.below, mode: 'idle' }, stunPack: { superheat: { casts: 2 }, chargeUnlocked: true } }), ['thieving:knights']))),
        cueStop({ step: 'S18', family: 'courier' }, o.cues),
        ...fletching.steps().map(s => whenNeeded('S18d-fallback', s, st => fletching.finished(st), 'Fletching 99 with the rune arrows kept, inside S18')),
        L('T18-19'),
        ...before('S19'),
        // H15 (placed before it) brings the kit, so segment A finds it held.
        ...steps('S19', seaSlug.steps()),
        L('T19-20'),
        ...before('S20'),
        ...steps('S20', fishingContest.steps()),
        L('T20-21'),
        // SCORED stays out while the givers log in, then joins behind the entire ready roster.
        ...steps('S21', o.s21Relog === false ? [preLogin] : [s21Logout, preLogin, s21Login]),
        ...steps('S21', runecraftS21),
        // The band includes the rune hand-back; a program segment's stop is not this boundary.
        cueStop({ step: 'S21', family: 'altar' }, o.cues),
        L('T21-22'),
        ...before('S22'),
        ...steps('S22', pick('fishing', fishing.steps(), ['fishing:fly-78-99'])),
        L('T22-23'),
        ...before('S23'),
        ...steps('S23', cooksAssistant.steps()),
        L('T23-24'),
        ...before('S24'),
        // rs/416's three quests, Goblin Diplomacy in two parts around Druidic Ritual; the legs between
        // them are keyed to the segments' names (plan v37).
        ...steps('S24', goblinDiplomacy.steps({ part: 'anchor' })),
        L('L24a'),
        ...steps('S24', druidicRitual.steps()),
        L('L24b'),
        ...steps('S24', goblinDiplomacy.steps({ part: 'village' })),
        L('L24c'),
        ...steps('S24', romeoJuliet.steps()),
        L('T24-25'),
        ...cued(
            { step: 'S25a', family: 'anvil' },
            steps('S25a', byPrefix('smithing', smithing.steps({ giver: cfg.anvil.giver, announce: anvilAnnounce(cfg.cueDir), giveBack: h21aGiveBack(manifest) }), 'S25a smithing'))
        ),
        cueStop({ step: 'S25a', family: 'anvil' }, o.cues),
        ...before('S25d'),
        ...steps('S25d', crafting.steps()),
        ...steps('S25e', herblore.steps()),
        // S25b's bones are buried inside S07 (fold-in 23); the booth runs only if Prayer is short.
        ...prayer.steps().map(s => whenNeeded('S25b-fallback', s, at99('prayer'), 'Prayer 99 inside S07 (fold-in 23)')),
        ...steps('S25c', cooking.steps(cfg.wineGiver ? { giver: cfg.wineGiver } : {})),
        L('T25-26'),
        ...before('S26'),
        ...steps('S26', dragonSlayer.steps()),
        ...legWith('T26-27'),
        ...cued(s27, steps('S27', ranged.steps({ which: 'combatFinish' }))),
        // A cue stop's `done` is the sink's, and a fresh process has no scope open: a done-less leg
        // between the band and its stop would be walked past on a crash-restart.
        cueStop(s27, o.cues),
        L('T27-17'),
        ...steps('S17', pick('agility', agility.steps({ to: 99 }), ['agility:wilderness'])),
    ];

    // Hand-offs: each superseded by the next milestone's own `done` (ruling 3), computed here, and
    // done once the attempt's record has it (handoff.ts, Resume).
    const out: ChainStep[] = [];
    for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i]!;
        if (e.kind !== 'pending-handoff') {
            out.unshift(e);
            continue;
        }
        // A marker's `done` says nothing about the game (a cue file), so it never supersedes a trade.
        const next = out.find(s => s.done && !s.marker);
        const supersededBy: ObservedCheck<unknown> | undefined = next?.done ? (ob, c) => next.done!(ob, c) : undefined;
        const plan = handOffFrom(manifest, e.row);
        const scope = CANNON_ROWS[e.row];
        // A row with a `to N` entry is served by a standing giver that sizes it from SCORED's ask (mule.ts, rs/429), scoped to the row.
        const ask = !scope && plan.receive.some(r => r.topUp) ? { scope: muleScope(e.row), ask: { dir: muleCueDir(cfg) } } : undefined;
        const cue = scope ? { scope, open: (ctx: Pick<StepContext<unknown>, 'sdk'>) => o.cues.open(scope, ctx, { fresh: false }) } : ask;
        const muleRow = !scope && MULE_ROWS.includes(e.row);
        const beforeTrade = muleRow ? { beforeTrade: () => { o.cues.refresh?.(muleScope(e.row)); } } : {};
        const s = tag(e.id, 'handoff', handOffStep(plan, { partner: partner(e.row), ...(supersededBy ? { supersededBy } : {}), ...(o.handOffs ? { record: o.handOffs } : {}), ...(cue ? { cue } : {}), ...beforeTrade }), cue ? { cue: cue.scope } : {});
        out.unshift(muleRow ? mule(s, e.row) : s);
    }
    return cueMuleRows(out, muleRows, partner, o.cues).map(censused);
}

// ------------------------------------------------------------------ slicing

const matchesRef = (s: ChainStep, ref: string) => s.id === ref || s.name === ref;

/** `--until=<id or step name>`: the chain through the last step of that id's group. */
export function sliceUntil(chain: readonly ChainStep[], until: string | undefined): ChainStep[] {
    if (until === undefined) return [...chain];
    let last = -1;
    chain.forEach((s, i) => {
        if (matchesRef(s, until)) last = i;
    });
    if (last < 0) throw new Error(`--until=${until}: no step with that id or name`);
    return chain.slice(0, last + 1);
}

/** `--from=<id or step name>`: the index of the first step of that id's group. */
export function resolveFrom(chain: readonly ChainStep[], from: string | undefined): number | undefined {
    if (from === undefined) return undefined;
    if (/^\d+$/.test(from)) return Number(from);
    const i = chain.findIndex(s => matchesRef(s, from));
    if (i < 0) throw new Error(`--from=${from}: no step with that id or name`);
    return i;
}

/** The refusing steps on the chain, in order: the modules not on main (`owner` builds them) and the steps this run config cannot run (`owner` is why). */
export function missingOnPath(chain: readonly ChainStep[]): { index: number; id: string; name: string; owner: string }[] {
    return chain.flatMap((s, index) => {
        const why = s.kind === 'missing' ? s.owner : s.refuses;
        return why ? [{ index, id: s.id, name: s.name, owner: why }] : [];
    });
}

// ------------------------------------------------------------------ RUN-ORDER.md section 2

export interface StepTableRow {
    id: string;
    line: number;
    /** Inside another step (S25b, S18b-d), retired (S10a), or a block heading (S25, S24 legs): not a chain step. */
    chained: boolean;
    expected: number | null;
    best: number | null;
}

const firstNumber = (cell: string | undefined): number | null => {
    const m = /(-?\d[\d,]*(?:\.\d+)?)/.exec((cell ?? '').replace(/\*\*/g, ''));
    return m ? Number(m[1]!.replace(/,/g, '')) : null;
};

/** RUN-ORDER.md section 2's step rows (`| Sxx |`), in order. */
export function parseStepTable(runOrder: string): StepTableRow[] {
    const lines = runOrder.split('\n');
    const startAt = lines.findIndex(l => /^## 2\. /.test(l));
    const endAt = lines.findIndex((l, i) => i > startAt && /^## /.test(l));
    if (startAt < 0) throw new Error('RUN-ORDER.md has no "## 2." section');
    const out: StepTableRow[] = [];
    for (let i = startAt; i < (endAt < 0 ? lines.length : endAt); i++) {
        const cells = lines[i]!.split('|').map(c => c.trim());
        const id = cells[1] ?? '';
        if (!/^S\d\d[a-z]?( legs)?$/.test(id)) continue;
        const where = cells[3] ?? '';
        const what = cells[4] ?? '';
        const chained = !/ legs$/.test(id) && id !== 'S25' && !/^\*\*inside|^inside/i.test(where) && !/\*\*retired\*\*/.test(what);
        out.push({ id, line: i + 1, chained, expected: firstNumber(cells[6]), best: firstNumber(cells[7]) });
    }
    return out;
}

/** The chain's step ids in order, one per group, without the legs, hand-offs, cue stops and fallbacks. */
export function chainIds(chain: readonly ChainStep[]): string[] {
    const ids: string[] = [];
    for (const s of chain) {
        if (s.kind === 'leg' || s.kind === 'cue' || s.kind === 'fallback' || (s.kind === 'handoff' && s.id !== 'S01')) continue;
        if (ids[ids.length - 1] !== s.id) ids.push(s.id);
    }
    return ids;
}

export type { LegStep };
