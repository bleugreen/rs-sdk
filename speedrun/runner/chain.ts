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

import { readFileSync } from 'fs';
import type { BotWorldState } from '../../sdk/types';
import { writeAnvilPlan } from '../helpers/anvil';
import type { CueScope } from '../helpers/altar-cue';
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
import * as plagueCity from '../quests/plague-city';
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
import { handOffFrom, handOffStep } from './handoff';
import { legById, legsFor, splitLeg, type LegStep } from './legs';
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
    /** withCue: the helper cue opened before it runs. */
    cue?: CueScope;
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
    /** S18's courier (H14.x) and the food count below which it tops up. */
    courier: { giver: string; below: number };
    /** S25a's anvil helper (H21a). */
    anvil: { giver: string };
    /** S25c's wine giver (H21c; default cooking.ts WINE_GIVER). */
    wineGiver?: string;
    /** The cue directory the helpers read (run.ts sets RC_CUE_DIR to it, so thieving's asks land there too). */
    cueDir: string;
}

/** Where the modules' cues go: run.ts's CueKeeper, a recorder in tests. */
export interface CueSink {
    /** Open `scope`'s cue (a fresh session when `fresh`, else only when another scope or none is open). */
    open(scope: CueScope, ctx: Pick<StepContext<unknown>, 'sdk'>, o: { fresh: boolean }): Promise<void>;
    /** Write the stop of `scope`'s cue if it is the open one. */
    stop(scope: CueScope, ctx: StepContext<unknown>): void;
}

export interface ChainOptions {
    /** STEP-MANIFEST.md's text (default: read from MANIFEST). */
    manifest?: string;
    cues: CueSink;
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
    H12: { before: 'S15' },
    H12a: { before: 'S15' },
    H12b: { before: 'S15' },
    H13: { leg: 'T15-16', afterHop: 0 },
    H14: { before: 'S18' },
    H15: { before: 'S19' },
    H18: { before: 'S22' },
    H19: { before: 'S23' },
    H20: { before: 'S24' },
    H21d: { before: 'S25d' },
    H23: { leg: 'T26-27', afterHop: 0 },
};

/** Rows a module trades itself whose partner the run config names (kitFrom): S05's H4, the quests' kits. */
export const KIT_PARTNER_ROWS = ['H4', 'H4p', 'H6', 'H7', 'H8', 'H16', 'H22'] as const;

/** Exactly one group of each set is in the ledger in force (the ledger is the switch). */
export const ALTERNATIVES: readonly (readonly (readonly string[])[])[] = [[['H12'], ['H12a', 'H12b']]];

/** Rows a step module trades itself (do not double them with a handOff). */
export const INTERNAL: Readonly<Record<string, string>> = {
    H2: 'S03 firemaking (the fm-row droppers; its trade fallback)',
    H3: 'S04 magic (ring loads)',
    H4: "S05 Doric's Quest, segment A (the ledger row through handoff.ts; rs/416)",
    'H4.x': 'S07 woodcutting (bone loads)',
    H4p: 'S09 mining (mining.kit: H4p)',
    H5: 'S06 runecraft (cue-driven essence)',
    H6: 'S08 plague-city (kit segment)',
    H7: 'S10b tree-gnome-village (kit segment)',
    H8: 'S11b grand-tree (kit segment)',
    'H14.x': 'S18 thieving (idle top-ups)',
    H16: 'S20 fishing-contest (kit segment)',
    H17: 'S21 runecraft (altar roster)',
    H17e: 'S21 runecraft (hand-back)',
    H21a: 'S25a smithing (bars in, platebodies back)',
    H21c: 'S25c cooking (wine delivery)',
    H22: 'S26 dragon-slayer (kit segment)',
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

/** A 0-tick step that writes the stop of `scope`'s cue. */
export function cueStop(scope: CueScope, cues: CueSink): ChainStep {
    const run = async (ctx: StepContext<unknown>) => cues.stop(scope, ctx);
    return { id: `${scope.step} cue stop`, kind: 'cue', name: `${scope.step} ${scope.family} cue stop`, logoutSafe: true, preconditions: () => true, postconditions: () => true, run, resume: run };
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
export function buildChain(cfg: RunConfig, o: ChainOptions): ChainStep[] {
    const manifest = o.manifest ?? readFileSync(MANIFEST, 'utf8');
    const rows = ledgerRows(manifest);
    const inLedger = new Set(rows.map(r => r.row));
    const coverage = ledgerCoverage(rows);
    if (coverage.length) throw new Error(`ledger coverage: ${coverage.join('; ')}`);
    const placed = Object.keys(PLACEMENT).filter(id => inLedger.has(id));
    const missingPartners = [...placed, ...KIT_PARTNER_ROWS].filter(id => !cfg.partners[id]);
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

    const woodcuttingAll = woodcutting.steps({ bury: true, bones: cfg.bones, dropAxe: true, prayerTo: 99 });
    const wc = (n: string) => pick('woodcutting', woodcuttingAll, [n]);
    const runecraftS21 = pick('runecraft', runecraft.steps({ s21Altar: 'body', cueDir: cfg.cueDir }), ['S21 runecraft']);

    const entries: Entry[] = [
        ...steps('S00', start.steps()),
        ...hand('H1', 'S01'),
        L('T01-02'),
        ...steps('S02', pick('magic', magic.steps({ strikeUntil: 7 }), [magic.S02_ID])),
        L('T02-03'),
        ...steps('S03', firemaking.steps({ tiles: cfg.firemakingTiles, supply: 'row' })),
        ...steps('S04', pick('magic', magic.steps({ untilLevel: 59, giver: cfg.rings.giver, ...(cfg.rings.loads ? { loads: cfg.rings.loads } : {}) }), [magic.S04_ID])),
        L('T04-05'),
        ...steps('S05', doricsQuest.steps(kitFrom('H4'))),
        L('T05-06'),
        // runecraft writes its own {S06, altar} cue.
        ...steps('S06', pick('runecraft', runecraft.steps({ untilLevel: 44, cueDir: cfg.cueDir }), ['S06 runecraft'])),
        L('T06-07'),
        ...before('S07'),
        ...cued({ step: 'S07', family: 'bone' }, [
            ...steps('S07', [...wc('woodcutting:walk-oaks'), ...wc('woodcutting:normal-1-15'), ...wc('woodcutting:oak-15-73')]),
        ]),
        L('T07a'),
        ...cued({ step: 'S07', family: 'bone' }, steps('S07', [...wc('woodcutting:willow-73-99'), ...wc('woodcutting:drop-axe')])),
        L('T07-08'),
        ...steps('S08', plagueCity.steps(kitFrom('H6'))),
        L('T08-09'),
        // H4p is the run's only rune pickaxe: its giver is a required config row (KIT_PARTNER_ROWS).
        ...steps('S09', pick('mining', mining.steps({ travel: 'none', kitGiver: partner('H4p'), dropAtExit: true }), ['mining.kit: H4p', 'mining.iron-63', 'mining.exit'])),
        L('T09-10'),
        ...steps('S10b', treeGnomeVillage.steps(kitFrom('H7'))),
        L('T10-11'),
        ...steps('S11a', pick('agility', agility.steps({ to: 22 }), ['agility:gnome'])),
        L('T11a'),
        ...steps('S11b', grandTree.steps(kitFrom('H8'))),
        ...legWith('T11-12'),
        ...steps('S12', fightArena.steps()),
        ...legWith('T12-13'),
        ...steps('S13', dwarfCannon.steps()),
        ...legWith('T13-14'),
        ...cued(s14, steps('S14', ranged.steps({ which: 'cannonSession' }))),
        ...legWith('T14-15', [cueStop(s14, o.cues)]),
        ...before('S15'),
        missingStep('S15', 'S15 Monkey Madness', 'rs/185', 'mm'),
        ...legWith('T15-16'),
        ...steps('S16', mageArena.steps()),
        L('T16-18'),
        ...before('S18'),
        ...cued({ step: 'S18', family: 'courier' }, steps('S18', pick('thieving', thieving.steps({ topUp: { giver: cfg.courier.giver, below: cfg.courier.below, mode: 'idle' }, stunPack: { superheat: { casts: 2 }, chargeUnlocked: true } }), ['thieving:knights']))),
        ...fletching.steps().map(s => whenNeeded('S18d-fallback', s, st => fletching.finished(st), 'Fletching 99 with the rune arrows kept, inside S18')),
        L('T18-19'),
        ...before('S19'),
        missingStep('S19', 'S19 Sea Slug', 'rs/185 (rs/414)', 'seaslug'),
        L('T19-20'),
        ...steps('S20', fishingContest.steps(kitFrom('H16'))),
        L('T20-21'),
        ...steps('S21', runecraftS21),
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
        ...before('S25d'),
        ...steps('S25d', crafting.steps()),
        ...steps('S25e', herblore.steps()),
        // S25b's bones are buried inside S07 (fold-in 23); the booth runs only if Prayer is short.
        ...prayer.steps().map(s => whenNeeded('S25b-fallback', s, at99('prayer'), 'Prayer 99 inside S07 (fold-in 23)')),
        ...steps('S25c', cooking.steps(cfg.wineGiver ? { giver: cfg.wineGiver } : {})),
        L('T25-26'),
        ...steps('S26', dragonSlayer.steps(kitFrom('H22'))),
        ...legWith('T26-27'),
        ...cued(s27, steps('S27', ranged.steps({ which: 'combatFinish' }))),
        L('T27-17'),
        cueStop(s27, o.cues),
        ...steps('S17', pick('agility', agility.steps({ to: 99 }), ['agility:wilderness'])),
    ];

    // Hand-offs: each superseded by the next milestone's own `done` (ruling 3), computed here.
    const out: ChainStep[] = [];
    for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i]!;
        if (e.kind !== 'pending-handoff') {
            out.unshift(e);
            continue;
        }
        const next = out.find(s => s.done);
        const supersededBy: ObservedCheck<unknown> | undefined = next?.done ? (ob, c) => next.done!(ob, c) : undefined;
        const scope = CANNON_ROWS[e.row];
        const cue = scope ? { scope, open: (ctx: Pick<StepContext<unknown>, 'sdk'>) => o.cues.open(scope, ctx, { fresh: false }) } : undefined;
        out.unshift(tag(e.id, 'handoff', handOffStep(handOffFrom(manifest, e.row), { partner: partner(e.row), ...(supersededBy ? { supersededBy } : {}), ...(cue ? { cue } : {}) }), cue ? { cue: scope } : {}));
    }
    return out.map(censused);
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

/** The refusing steps on the chain (the modules not on main), in order. */
export function missingOnPath(chain: readonly ChainStep[]): { index: number; id: string; name: string; owner: string }[] {
    return chain.flatMap((s, index) => (s.owner && s.kind === 'missing' ? [{ index, id: s.id, name: s.name, owner: s.owner }] : []));
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
