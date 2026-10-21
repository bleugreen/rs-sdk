// Fishing: STEP-MANIFEST.md entry 5 (S22), and the bands below it a fresh account needs.
//
// Fly fishing at the Lumbridge river with the in-page knife loop (`knife-cycle`, preset
// `fly`), driven by rs/156's gated loop so the host gate picks knife or plain, and the
// small net at Draynor below level 20 (docs/speedrun/skills/fishing.md sections 1-2).
// Five level-driven steps; each reads the level and xp from the state, so a band already
// passed is a no-op and the module runs from any start:
//
//   fishing:to-draynor  walk to the Draynor net spots (below level 20 only)
//   fishing:net-1-20    small net, plain: the net's attempt label stops on the knife's +2
//                       clock (fishing.md section 4), so it never takes the knife
//   fishing:to-river    walk to the river's standing tile, between the two spot clusters
//   fishing:fly-20-78   fly, gated, up to the S22 start xp (Sea Slug + Fishing Contest)
//   fishing:fly-78-99   fly, gated, to `to`: the run's S22 band, with its own gate probe,
//                       bootstrap and measure row, so it is priced as the run pays it
//
// On the scored run (9,612 base at S22) the first four are no-ops.
//
// Every catch is dropped on the label that shows it, with a re-click, so both land on R+1:
// the knife bundle carries the drop, and the plain loop does it with `dropEach`. Plain also
// follows a moved spot by its tile (`followSpot`). Level-ups are answered inside the page by
// the program on the reaction path, so no SDK-side watcher runs beside it.

import type { BotWorldState } from '../../sdk/types';
import { type GatedSegment, type GatedTechnique, inPageGate, type InPageGateOptions, runGatedProgram } from '../lib/gated-program';
import type { ProgramStatus } from '../lib/programs';
import type { TickLog } from '../lib/ticks';
import { tickMs } from '../lib/wait';
import { baseToXp, levelForXp, XP_RATE, xpForLevel } from '../lib/xp';
import type { RunnerSession, Step, StepContext } from '../runner/step';

export const skill = 'fishing';

/** The Draynor net standing tile, beside spots (3085-3086, 3227-3231). */
export const DRAYNOR = { x: 3088, z: 3229 } as const;
/** The river standing tile between the spot clusters (3239, 3241-3244) and (3238, 3251-3255). */
export const RIVER = { x: 3241, z: 3248 } as const;
/** A walk is skipped, and a band may start, within this many tiles of its standing tile. */
export const NEAR = 8;
/** Sea Slug 7,175 + Fishing Contest 2,437 base (fishing.md section 3): S22's start, level 78. */
export const S22_START_BASE = 9612;
/** Fly fishing needs level 20 (freshfish.rs2). */
export const FLY_LEVEL = 20;

/**
 * The small net as a knife-cycle method object; there is no preset because the net cannot
 * take the knife. Net re-arms +5, so a roll every 6 ticks (saltfish.rs2, measured 6).
 */
export const NET_METHOD = { skill: 'fishing', kind: 'npc', target: '^fishing spot$', option: '^net$', product: '^raw ', clickOnRoll: true, r0: 5, plainCycle: 6, lockWindow: 45 } as const;

/** STEP-MANIFEST.md entry 5's parameters; dropEach and followSpot apply to the plain segments. */
export const FLY_PARAMS = { method: 'fly', reanchor: 'xp', dismiss: 'now', dropEach: true, followSpot: true } as const;
const NET_PARAMS = { method: NET_METHOD, dropEach: true, followSpot: true } as const;

/**
 * The plain fly loop's ticks per expected roll, the gate's reference for its measured
 * switch-off: 4,837 ticks from 20 to 99 at 300 ms (fishing-rate.ts, 673 catches; fishing.md
 * section 2, measured) over the 905 rolls the model below expects there. Per catch that is
 * about 21.7 ticks at level 20 and 6.3 at 99, which is why the gate judges rolls, not catches.
 */
export const PLAIN_TICKS_PER_ROLL = 5.35;

/** Feathers carried per expected catch. */
export const FEATHER_MARGIN = 1.15;

// ------------------------------------------------------------------ roll model

export type FishKind = 'fly' | 'net';

interface Fish {
    lo: number;
    hi: number;
    base: number;
    from: number;
}

/**
 * Each roll tries the better fish first, then the base one (fishing.rs2, the `$fish2` then
 * `$fish1` stat_random), with the bounds and base xp from fishing.struct (read).
 */
export const ROLLS: Record<FishKind, readonly Fish[]> = {
    fly: [
        { lo: 16, hi: 96, base: 70, from: 30 }, // salmon
        { lo: 32, hi: 192, base: 50, from: 20 } // trout
    ],
    net: [
        { lo: 24, hi: 128, base: 40, from: 15 }, // anchovies
        { lo: 48, hi: 256, base: 10, from: 1 } // shrimps
    ]
};

/** The engine's stat_random (PlayerOps): the chance out of 256 that a roll at `level` succeeds. */
export function statRandom(level: number, lo: number, hi: number): number {
    const l = Math.min(level, 99);
    return Math.min(1, (Math.floor((lo * (99 - l)) / 98) + Math.floor((hi * (l - 1)) / 98) + 1) / 256);
}

/** One roll at `level`: the chance it catches anything, and its expected base xp. */
export function rollYield(kind: FishKind, level: number): { p: number; base: number } {
    let miss = 1;
    let base = 0;
    for (const f of ROLLS[kind]) {
        if (level < f.from) continue;
        const p = statRandom(level, f.lo, f.hi);
        base += miss * p * f.base;
        miss *= 1 - p;
    }
    return { p: 1 - miss, base };
}

/**
 * The rolls and catches expected between two xp values (game xp): each level's stretch of xp
 * over that level's expected xp per roll. This is the denominator for ticks per expected roll,
 * the roll cadence a level does not change (rs/147 addendum 4).
 */
export function expectedRolls(kind: FishKind, fromXp: number, toXp: number): { rolls: number; catches: number } {
    let rolls = 0;
    let catches = 0;
    let x = fromXp;
    while (x < toXp) {
        const level = levelForXp(x);
        const next = level < 99 ? Math.min(toXp, xpForLevel(level + 1)) : toXp;
        const y = rollYield(kind, level);
        if (y.base <= 0) throw new Error(`no ${kind} catch is possible at Fishing ${level}`);
        const r = (next - x) / XP_RATE / y.base;
        rolls += r;
        catches += r * y.p;
        x = next;
    }
    return { rolls, catches };
}

/** Feathers to carry from `xp` to `toXp`: one per catch (fishing.rs2), with a margin. */
export function feathersNeeded(xp: number, toXp: number): number {
    return xp >= toXp ? 0 : Math.ceil(expectedRolls('fly', xp, toXp).catches * FEATHER_MARGIN);
}

/** The rolls one fly catch stands for at the state's level: the gate weights each drop by it. */
export function flyRollsPerCatch(s: BotWorldState | null): number {
    return s ? 1 / rollYield('fly', Math.max(fishingOf(s).level, FLY_LEVEL)).p : 1;
}

// ------------------------------------------------------------------ state

const ROD = /^fly fishing rod$/i;
const FEATHER = /^feathers?$/i;
const NET = /^small fishing net$/i;
const KNIFE = /^knife$/i;
const LOGS = /^logs$/i;

export function fishingOf(s: BotWorldState): { level: number; xp: number } {
    const k = s.skills.find(x => x.name.toLowerCase() === 'fishing');
    return { level: k?.baseLevel ?? 1, xp: k?.experience ?? 0 };
}

function carried(s: BotWorldState, re: RegExp): number {
    return s.inventory.filter(i => re.test(i.name)).reduce((n, i) => n + Math.max(1, i.count), 0);
}

function near(s: BotWorldState, tile: { x: number; z: number }, r: number): boolean {
    const p = s.player;
    return !!p && Math.max(Math.abs(p.worldX - tile.x), Math.abs(p.worldZ - tile.z)) <= r;
}

// ------------------------------------------------------------------ options

export interface FishingOptions {
    /** Target level (default 99). */
    to?: number | string;
    /** 'auto' (default): rs/156's in-page gate picks knife or plain per segment. */
    technique?: GatedTechnique;
    /** Game xp where fly-20-78 ends and fly-78-99 starts (default S22's 9,612 base). */
    runStartXp?: number | string;
    /** inPageGate options over the module's own (plainTicksPerRoll defaults to PLAIN_TICKS_PER_ROLL). */
    gate?: Partial<InPageGateOptions>;
    /** Extra knife-cycle parameters, test and lab only (rs/156's forced-slip `hold`); never set on an attempt. */
    params?: Record<string, unknown>;
    /** Test seams for the gated loop and the gate. */
    runGated?: typeof runGatedProgram;
    makeGate?: typeof inPageGate;
    log?: (line: string) => void;
    [k: string]: unknown;
}

interface Resolved {
    to: number;
    technique: GatedTechnique;
    runStartXp: number;
    netTo: number;
    flyToXp: number;
    gate: Partial<InPageGateOptions>;
    params: Record<string, unknown>;
    runGated: typeof runGatedProgram;
    makeGate: typeof inPageGate;
    log: (line: string) => void;
}

function resolve(opts: FishingOptions): Resolved {
    const to = Number(opts.to ?? 99);
    if (!Number.isInteger(to) || to < 2 || to > 99) throw new Error(`fishing: to must be an integer from 2 to 99, got ${opts.to}`);
    const technique = opts.technique ?? 'auto';
    if (!['auto', 'knife', 'plain'].includes(technique)) throw new Error(`fishing: technique must be auto, knife or plain, got ${technique}`);
    const runStartXp = Number(opts.runStartXp ?? baseToXp(S22_START_BASE));
    if (!Number.isFinite(runStartXp) || runStartXp < xpForLevel(FLY_LEVEL)) throw new Error(`fishing: runStartXp must be game xp at or above level ${FLY_LEVEL}, got ${opts.runStartXp}`);
    return {
        to,
        technique,
        runStartXp,
        netTo: Math.min(FLY_LEVEL, to),
        flyToXp: Math.min(runStartXp, xpForLevel(to)),
        gate: opts.gate ?? {},
        params: opts.params ?? {},
        runGated: opts.runGated ?? runGatedProgram,
        makeGate: opts.makeGate ?? inPageGate,
        log: opts.log ?? (() => {})
    };
}

/** The band step the state is in, or null once the target level is reached. */
export function bandFor(s: BotWorldState, opts: FishingOptions = {}): 'fishing:net-1-20' | 'fishing:fly-20-78' | 'fishing:fly-78-99' | null {
    const o = resolve(opts);
    const f = fishingOf(s);
    if (f.level >= o.to) return null;
    if (f.level < o.netTo) return 'fishing:net-1-20';
    if (f.xp < o.flyToXp) return 'fishing:fly-20-78';
    return 'fishing:fly-78-99';
}

// ------------------------------------------------------------------ band summaries

/** A gated segment with the xp it started and ended on (read when it ended). */
export interface BandSegment extends GatedSegment {
    fromXp: number;
    toXp: number;
}

/** The knife-cycle result fields read here. */
interface CycleResult {
    fellBack?: string;
    histogram?: Record<string, number>;
    moves?: number;
    moveGaps?: number[];
    resyncs?: number;
    levelUps?: number;
}

/** knife-cycle's xp-drop counter (a catch): `rolls`, which rs/159 renames `logs`. */
export function catchesOf(status: ProgramStatus): number {
    return status.counters.logs ?? status.counters.rolls ?? 0;
}

export interface SegmentSummary {
    technique: 'knife' | 'plain';
    reason: string;
    ticks: number;
    catches: number;
    expectedRolls: number;
    /** The roll cadence, the primary figure: knife about 3, plain about 5.3 for fly. */
    ticksPerExpectedRoll: number;
    ticksPerCatch: number;
    gap3Share: number;
    resyncs: number;
    phaseResyncs: number;
    slips: number;
    levelUps: number;
    moves: number;
    /** The program fell back to plain inside the segment (`out of logs`, `no knife`). */
    fellBack?: string;
}

export interface BandSummary extends Omit<SegmentSummary, 'technique' | 'reason' | 'gap3Share' | 'fellBack'> {
    segments: SegmentSummary[];
    histogram: Record<number, number>;
    gap3Share: number;
    medianGap: number;
    /** Each spot move's cost: the gap that spans it minus the band's median gap. */
    moveCosts: number[];
    /** Ticks per expected roll by technique, over that technique's segments. */
    byTechnique: Partial<Record<'knife' | 'plain', { ticks: number; expectedRolls: number; ticksPerExpectedRoll: number; catches: number; ticksPerCatch: number }>>;
    /** `knife->plain (measured)` style list of the segment ends that switched technique. */
    switches: string[];
}

const r3 = (n: number) => (Number.isFinite(n) ? Math.round(n * 1000) / 1000 : Number.NaN);

function histogramOf(segs: BandSegment[]): Record<number, number> {
    const h: Record<number, number> = {};
    for (const s of segs) for (const [gap, n] of Object.entries((s.status.result as CycleResult | undefined)?.histogram ?? {})) h[Number(gap)] = (h[Number(gap)] ?? 0) + n;
    return h;
}

function share3(h: Record<number, number>): number {
    const total = Object.values(h).reduce((a, b) => a + b, 0);
    return total ? r3((h[3] ?? 0) / total) : Number.NaN;
}

function median(h: Record<number, number>): number {
    const total = Object.values(h).reduce((a, b) => a + b, 0);
    if (!total) return Number.NaN;
    let seen = 0;
    for (const gap of Object.keys(h).map(Number).sort((a, b) => a - b)) {
        seen += h[gap]!;
        if (seen * 2 >= total) return gap;
    }
    return Number.NaN;
}

/** Per-segment and per-band figures for the findings doc, knife and plain in ticks per expected roll first. */
export function summarizeBand(kind: FishKind, segments: BandSegment[]): BandSummary {
    const segs = segments.map(seg => {
        const st = seg.status;
        const res = (st.result ?? {}) as CycleResult;
        const ticks = Math.max(0, (st.endedTick ?? st.tick) - st.startedTick);
        const catches = catchesOf(st);
        const exp = seg.toXp > seg.fromXp ? expectedRolls(kind, seg.fromXp, seg.toXp).rolls : 0;
        return {
            technique: seg.technique,
            reason: seg.reason,
            ticks,
            catches,
            expectedRolls: r3(exp),
            ticksPerExpectedRoll: r3(ticks / exp),
            ticksPerCatch: r3(ticks / catches),
            gap3Share: share3(histogramOf([seg])),
            resyncs: res.resyncs ?? st.counters.resyncs ?? 0,
            phaseResyncs: st.counters.phaseResyncs ?? 0,
            slips: st.counters.slips ?? 0,
            levelUps: res.levelUps ?? st.counters.levelUps ?? 0,
            moves: res.moves ?? st.counters.moves ?? 0,
            ...(res.fellBack ? { fellBack: res.fellBack } : {})
        } satisfies SegmentSummary;
    });
    const sum = (f: (s: SegmentSummary) => number, of = segs) => of.reduce((a, s) => a + f(s), 0);
    const histogram = histogramOf(segments);
    const medianGap = median(histogram);
    const byTechnique: BandSummary['byTechnique'] = {};
    for (const t of ['knife', 'plain'] as const) {
        const of = segs.filter(s => s.technique === t);
        if (!of.length) continue;
        const ticks = sum(s => s.ticks, of);
        const exp = sum(s => s.expectedRolls, of);
        const catches = sum(s => s.catches, of);
        byTechnique[t] = { ticks, expectedRolls: r3(exp), ticksPerExpectedRoll: r3(ticks / exp), catches, ticksPerCatch: r3(ticks / catches) };
    }
    const ticks = sum(s => s.ticks);
    const exp = sum(s => s.expectedRolls);
    const catches = sum(s => s.catches);
    return {
        ticks,
        catches,
        expectedRolls: r3(exp),
        ticksPerExpectedRoll: r3(ticks / exp),
        ticksPerCatch: r3(ticks / catches),
        resyncs: sum(s => s.resyncs),
        phaseResyncs: sum(s => s.phaseResyncs),
        slips: sum(s => s.slips),
        levelUps: sum(s => s.levelUps),
        moves: sum(s => s.moves),
        segments: segs,
        histogram,
        gap3Share: share3(histogram),
        medianGap,
        moveCosts: segments.flatMap(s => ((s.status.result as CycleResult | undefined)?.moveGaps ?? []).map(g => g - medianGap)),
        byTechnique,
        switches: segs.slice(0, -1).flatMap((s, i) => (segs[i + 1]!.technique !== s.technique ? [`${s.technique}->${segs[i + 1]!.technique} (${s.reason})`] : []))
    };
}

// ------------------------------------------------------------------ steps

function annotation(log: TickLog, session: RunnerSession, step: string, startTick: number, endTick: number, ok: boolean, meta: Record<string, unknown>): void {
    // A 0-tick row: the band's own measure row carries its ticks, so report() never counts these.
    log.append({ v: 1, runId: log.runId, account: session.name, sessionId: session.sessionId, step, startTick, endTick, ticks: 0, wallMs: 0, ok, meta, tickMs: tickMs(), at: new Date().toISOString() });
}

function walkStep(name: string, tile: { x: number; z: number }, needed: (s: BotWorldState) => boolean): Step {
    return {
        name,
        preconditions: () => true,
        async run({ sdk, bot }) {
            const s = sdk.getState();
            if (!s || !needed(s) || near(s, tile, NEAR)) return;
            const r = await bot.walkTo(tile.x, tile.z, 2);
            if (!r.success) throw new Error(`walkTo ${tile.x},${tile.z}: ${r.message}`);
        },
        postconditions: s => (!needed(s) || near(s, tile, NEAR) ? true : `not within ${NEAR} tiles of ${tile.x},${tile.z}`),
        logoutSafe: true
    };
}

interface Band {
    name: string;
    kind: FishKind;
    tile: { x: number; z: number };
    /** The band's effect is in the state (and stays there). */
    passed(s: BotWorldState): boolean;
    /** The band's end as knife-cycle parameters. */
    end: { untilLevel: number } | { untilXp: number };
    endXp: number;
}

function bandStep(o: Resolved, b: Band): Step {
    const fly = b.kind === 'fly';
    const technique: GatedTechnique = fly ? o.technique : 'plain';
    const pre = (s: BotWorldState): true | string => {
        if (b.passed(s)) return true;
        const f = fishingOf(s);
        if (!near(s, b.tile, NEAR)) return `not within ${NEAR} tiles of ${b.tile.x},${b.tile.z}`;
        if (!fly) return carried(s, NET) ? (s.inventory.length < 28 ? true : 'no free inventory slot') : 'no small fishing net';
        if (f.level < FLY_LEVEL) return `Fishing ${f.level}, fly fishing needs ${FLY_LEVEL}`;
        if (!carried(s, ROD)) return 'no fly fishing rod';
        const need = feathersNeeded(f.xp, b.endXp);
        const have = carried(s, FEATHER);
        if (have < need) return `${have} feathers, ${need} needed to reach the band end (Fishing ${f.level})`;
        if (technique !== 'plain' && (!carried(s, KNIFE) || !carried(s, LOGS))) return `technique ${technique} needs a knife and a normal log`;
        return true;
    };
    const run = async (ctx: StepContext<Record<string, never>>) => {
        const { sdk, session, log } = ctx;
        const s0 = sdk.getState();
        if (!s0 || b.passed(s0)) return;
        const start = fishingOf(s0);
        // A fresh gate per band: its first probe and bootstrap are the band's own, as on the run.
        const gate = technique === 'auto' ? o.makeGate(sdk, { plainTicksPerRoll: PLAIN_TICKS_PER_ROLL, log: o.log, ...o.gate }) : undefined;
        const segments: BandSegment[] = [];
        let fromXp = start.xp;
        let noFeathersAt: number | null = null;
        let kitLost: string | null = null;
        const params = { ...(fly ? FLY_PARAMS : NET_PARAMS), ...o.params, ...b.end };
        const runWith = (tech: GatedTechnique) => {
            const stop = new AbortController();
            return o.runGated(sdk, 'knife-cycle', params, {
                technique: tech,
                ...(gate && tech === 'auto' ? { gate } : {}),
                ...(fly ? { rollsPerDrop: flyRollsPerCatch } : {}),
                signal: stop.signal,
                log: o.log,
                onProgress: () => {
                    if (!fly || stop.signal.aborted) return;
                    const s = sdk.getState();
                    if (!s) return;
                    // Without this the fly attempt goes silent and the program faults at its stall window.
                    if (carried(s, FEATHER) === 0) {
                        noFeathersAt = fishingOf(s).level;
                        stop.abort();
                    } else if (tech !== 'plain' && (!carried(s, KNIFE) || !carried(s, LOGS))) {
                        // A completed fletch used the last log (or the knife is gone): the program is
                        // already plain, and a gate restart with the knife would fault on its start check.
                        kitLost = `${carried(s, KNIFE) ? 'out of logs' : 'no knife'} at Fishing ${fishingOf(s).level}`;
                        stop.abort();
                    }
                },
                onSegment: seg => {
                    const st = sdk.getState();
                    const toXp = st ? fishingOf(st).xp : fromXp;
                    segments.push({ ...seg, fromXp, toXp });
                    annotation(log, session, `${b.name}:segment`, seg.status.startedTick, seg.status.endedTick ?? seg.status.tick, seg.reason !== 'fault', {
                        technique: seg.technique, reason: seg.reason, fromXp, toXp, runId: seg.status.runId, counters: seg.status.counters,
                        result: seg.status.result, frames: seg.status.frames, skippedTicks: seg.status.skippedTicks, deferred: seg.status.deferred
                    });
                    fromXp = toXp;
                }
            });
        };
        let result = await runWith(technique);
        if (kitLost !== null && noFeathersAt === null) {
            o.log(`${b.name}: ${kitLost}: finishing the band plain`);
            result = await runWith('plain');
        }
        const end = sdk.getState();
        annotation(log, session, `${b.name}:summary`, segments[0]?.status.startedTick ?? s0.tick, end?.tick ?? s0.tick, result.ended === 'done', {
            ended: result.ended, ...(kitLost ? { kitLost } : {}), startLevel: start.level, endLevel: end ? fishingOf(end).level : start.level, ...summarizeBand(b.kind, segments),
            ...(gate ? { gate: { history: gate.history.map(h => ({ tick: h.tick, why: h.why, on: h.on, switched: h.switched, ...(h.measured ? { measured: h.measured } : {}) })), switches: gate.switches() } } : {})
        });
        if (noFeathersAt !== null) throw new Error(`out of feathers at Fishing ${noFeathersAt}`);
        if (result.ended !== 'done') throw new Error(`knife-cycle ended ${result.ended} at Fishing ${end ? fishingOf(end).level : '?'}`);
    };
    return {
        name: b.name,
        preconditions: pre,
        run,
        resume: run,
        postconditions: s => (b.passed(s) ? true : `Fishing ${fishingOf(s).level} (${fishingOf(s).xp} xp): the band did not reach its end`),
        logoutSafe: true,
        done: ({ state }) => b.passed(state),
        inProgress: ({ state }) => !b.passed(state) && near(state, b.tile, NEAR) && (fly ? fishingOf(state).level >= FLY_LEVEL : true)
    };
}

/** The fishing steps from the current state to `to` (see the file comment). */
export function steps(opts: FishingOptions = {}): Step[] {
    const o = resolve(opts);
    const lvl = (s: BotWorldState) => fishingOf(s).level;
    const xp = (s: BotWorldState) => fishingOf(s).xp;
    return [
        walkStep('fishing:to-draynor', DRAYNOR, s => lvl(s) < o.netTo),
        bandStep(o, { name: 'fishing:net-1-20', kind: 'net', tile: DRAYNOR, passed: s => lvl(s) >= o.netTo, end: { untilLevel: o.netTo }, endXp: xpForLevel(o.netTo) }),
        walkStep('fishing:to-river', RIVER, s => lvl(s) >= FLY_LEVEL && lvl(s) < o.to),
        bandStep(o, { name: 'fishing:fly-20-78', kind: 'fly', tile: RIVER, passed: s => lvl(s) >= o.to || xp(s) >= o.flyToXp, end: { untilXp: o.flyToXp }, endXp: o.flyToXp }),
        bandStep(o, { name: 'fishing:fly-78-99', kind: 'fly', tile: RIVER, passed: s => lvl(s) >= o.to, end: { untilLevel: o.to }, endXp: xpForLevel(o.to) })
    ];
}
