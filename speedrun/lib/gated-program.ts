// One loop that drives an in-page knife program (`knife-cycle`, `knife-mine`) under the
// run-time host gate (`hostgate.ts` `HostGate`), for the skill step modules.
//
// With technique 'auto', before each run of the program and whenever the gate falls due
// (first, after a slip while manipulating, every `offReprobeTicks` while plain) the loop
// stops the program and probes. It then starts the program with its knife parameters when
// the gate is on and the in-run pause rule is not holding, and with its plain parameters
// otherwise. While a run goes, each new drop (the program's roll or ore counter) goes to
// `gate.drop` and each new slip to `gate.slip`.
//
// The pause rule (STEP-MANIFEST.md entry 0): catch-ups per minute over `pause.above` in the
// knife run's frames pause to plain; once plain has run `pause.minTicks` (about a minute)
// with catch-ups under `pause.below`, the loop re-probes and resumes on the verdict. Paused
// drops are not fed to the gate, so a plain stretch never counts as a knife one, and the
// resume probe starts the gate's next stretch clean.
//
// The measured switch-off is in ticks per expected roll: each drop is weighted by the rolls it
// stands for (`rollsPerDrop`, 1 / success chance at the current level, as
// tickmanip-demo-report.ts weights logs), and the plain reference is plain ticks per roll
// (`inPageGate`'s `plainTicksPerRoll`), which does not move with level. knife-mine counts
// ores, every one a success at 63+, so its unit is ticks per ore.
//
// Any switch stops the running program and starts a new run; each run is one segment.
// The program's count budget (`logs`/`rolls`, `ores`) and `maxTicks` carry across segments;
// level and xp ends pass through as given. The knife programs are only wrapped: their
// reaction and lock recovery are their own.

import type { BotWorldState } from '../../sdk/types';
import { type DirectRule, type GateOptions, HostGate, type ProbeSdk } from './hostgate';
import { awaitProgram, probeInPage, ProgramError, type ProgramSdk, type ProgramStatus, startProgram, stopProgram } from './programs';
import { tickMs } from './wait';

export type GatedTechnique = 'auto' | 'knife' | 'plain';
export type SegmentTechnique = 'knife' | 'plain';
/**
 * Why a segment ended: the program finished (`done`), the gate fell due (`probe`), the
 * measured switch-off (`measured`), the pause rule (`pause`, `resume`), the caller's signal
 * (`aborted`), someone else stopped or replaced the run (`stopped`), or it faulted.
 */
export type SegmentEnd = 'done' | 'probe' | 'measured' | 'pause' | 'resume' | 'aborted' | 'stopped' | 'fault';

/** How a program switches technique, and which counter is its drops (and its count budget). */
export interface ProgramSwitch {
    knife: Record<string, unknown>;
    plain: Record<string, unknown>;
    /** Names of the drop counter, first present wins; the same name is the count-budget parameter. */
    drops: string[];
}

export const GATED_PROGRAMS: Record<string, ProgramSwitch> = {
    // knife-cycle's xp-event counter is `rolls` today; rs/159 renames it `logs`
    'knife-cycle': { knife: { technique: 'knife' }, plain: { technique: 'plain' }, drops: ['logs', 'rolls'] },
    'knife-mine': { knife: { starter: 'knife' }, plain: { starter: 'none' }, drops: ['ores'] }
};

const dropsOf = (sw: ProgramSwitch, st: ProgramStatus): number => {
    for (const k of sw.drops) if (st.counters[k] !== undefined) return st.counters[k]!;
    return 0;
};

export interface GatedSegment {
    technique: SegmentTechnique;
    reason: SegmentEnd;
    /** The run's final status. */
    status: ProgramStatus;
}

export interface PauseRule {
    /** Pause to plain when the knife run's `frames.catchUpsLastMinute` exceeds this (default 5). */
    above?: number;
    /** Resume when it is under this (default 1)... */
    below?: number;
    /** ...after plain has run this many ticks (default one minute of ticks). */
    minTicks?: number;
}

export interface GatedOptions {
    /** Required for 'auto'; ignored by 'knife' and 'plain', which never probe. */
    gate?: HostGate;
    technique: GatedTechnique;
    /**
     * The expected rolls one drop stands for, read at each drop: 1 / the success chance at the
     * player's level (knife-cycle). Default 1 (knife-mine: every ore at 63+ succeeds).
     */
    rollsPerDrop?: (state: BotWorldState | null) => number;
    pause?: PauseRule;
    /** For a program not in `GATED_PROGRAMS`. */
    program?: ProgramSwitch;
    /** Each segment as it ends (fault included, before the error is thrown). */
    onSegment?: (segment: GatedSegment) => void;
    /** Every published status of every run. */
    onProgress?: (status: ProgramStatus, technique: SegmentTechnique) => void;
    /** Abort stops the running program and resolves with `ended: 'aborted'`. */
    signal?: AbortSignal;
    /** `awaitProgram`'s staleMs. */
    staleMs?: number;
    log?: (line: string) => void;
}

export interface GatedRun {
    segments: GatedSegment[];
    ended: 'done' | 'aborted' | 'stopped';
}

/** The rule for a 20-trial in-page probe: the run night's 58 of 60, read as 19 of 20 (20 passes). */
export const IN_PAGE_RULE: DirectRule = { trials: 20, pass: 20, floor: 19 };

export interface InPageGateOptions extends Omit<GateOptions, 'probeWith' | 'probe' | 'model' | 'plainTicksPerDrop'> {
    /**
     * The plain loop's ticks per expected roll (knife-cycle: its roll cadence, e.g. willow 4,
     * fly about 5.35 measured) or per ore (knife-mine). The measured switch-off compares the
     * knife stretch, in the same unit (`rollsPerDrop`), with it: the knife stays on only while
     * strictly faster than `plainTicksPerRoll * (1 - measuredMargin)`. Required, so the
     * switch-off is armed from the first stretch.
     */
    plainTicksPerRoll: number;
    /** The relay path's cost model; unused by the in-page probe (default from plainTicksPerRoll). */
    model?: GateOptions['model'];
    /** Probe trials (default 20). Every probe is on the account's clock. */
    trials?: number;
    maxWait?: number;
}

/** A HostGate that probes in the page (`probeInPage`) and judges by `IN_PAGE_RULE`, scaled to `trials`. */
export function inPageGate(sdk: ProgramSdk & ProbeSdk, opts: InPageGateOptions): HostGate {
    const { trials = 20, maxWait, plainTicksPerRoll, model, ...rest } = opts;
    return new HostGate(sdk, {
        direct: IN_PAGE_RULE,
        ...rest,
        model: model ?? { plainCycle: plainTicksPerRoll },
        plainTicksPerDrop: plainTicksPerRoll,
        probeWith: () => probeInPage(sdk, { trials, ...(maxWait !== undefined ? { maxWait } : {}) })
    });
}

/**
 * Run `name` to its end under the gate. `params` may be a function of the technique, for
 * parameters only one technique accepts (knife-cycle's `bury` is knife-only).
 */
export async function runGatedProgram(
    sdk: ProgramSdk,
    name: string,
    params: Record<string, unknown> | ((technique: SegmentTechnique) => Record<string, unknown>),
    opts: GatedOptions
): Promise<GatedRun> {
    const sw = opts.program ?? GATED_PROGRAMS[name];
    if (!sw) throw new Error(`runGatedProgram: no technique switch for '${name}' (pass opts.program)`);
    const auto = opts.technique === 'auto';
    const gate = opts.gate;
    if (auto && !gate) throw new Error("runGatedProgram: technique 'auto' needs a gate");
    const above = opts.pause?.above ?? 5;
    const below = opts.pause?.below ?? 1;
    const pauseTicks = opts.pause?.minTicks ?? Math.ceil(60000 / tickMs());
    const log = opts.log ?? (() => {});
    const paramsFor = typeof params === 'function' ? params : () => params;
    const base = paramsFor('knife');
    const budgetKey = sw.drops.find(k => typeof base[k] === 'number');
    const budget = budgetKey ? (base[budgetKey] as number) : undefined;
    const maxTicks = typeof base.maxTicks === 'number' ? base.maxTicks : undefined;
    const rollsPerDrop = opts.rollsPerDrop ?? (() => 1);
    const firstTick = sdk.getState()?.tick ?? 0;
    const segments: GatedSegment[] = [];
    let used = 0;
    let paused = false;
    let resumeProbe = false;

    for (;;) {
        if (opts.signal?.aborted) return { segments, ended: 'aborted' };
        if (auto) {
            const tick = sdk.getState()?.tick ?? 0;
            if (resumeProbe || gate!.due(tick)) {
                const why = resumeProbe ? 'resume' : !gate!.history.length ? 'start' : gate!.on ? 'slip' : 'off';
                resumeProbe = false;
                await gate!.probe(why);
                if (!gate!.on) paused = false;
                if (opts.signal?.aborted) return { segments, ended: 'aborted' };
            }
        }
        const technique: SegmentTechnique = auto ? (gate!.on && !paused ? 'knife' : 'plain') : (opts.technique as SegmentTechnique);
        const run: Record<string, unknown> = { ...paramsFor(technique), ...sw[technique] };
        if (budgetKey) run[budgetKey] = budget! - used;
        if (maxTicks !== undefined) run.maxTicks = maxTicks - ((sdk.getState()?.tick ?? firstTick) - firstTick);
        if ((budget !== undefined && budget - used <= 0) || (maxTicks !== undefined && (run.maxTicks as number) <= 0)) return { segments, ended: 'done' };

        const started = await startProgram(sdk, name, run);
        log(`T${started.tick} ${name} run ${started.runId} ${technique}${paused ? ' (paused)' : ''}`);
        let stopFor: SegmentEnd | null = null;
        let drops = 0;
        let slips = 0;
        const requestStop = (why: SegmentEnd) => {
            if (stopFor) return;
            stopFor = why;
            stopProgram(sdk).catch(() => {});
        };
        const onAbort = () => requestStop('aborted');
        opts.signal?.addEventListener('abort', onAbort, { once: true });
        let status: ProgramStatus;
        try {
            status = await awaitProgram(sdk, started.runId, {
                ...(opts.staleMs !== undefined ? { staleMs: opts.staleMs } : {}),
                onProgress: st => {
                    opts.onProgress?.(st, technique);
                    if (stopFor || !auto) return;
                    const d = dropsOf(sw, st);
                    if (drops < d && !paused) {
                        const rolls = rollsPerDrop(sdk.getState());
                        for (let i = drops; i < d; i++) if (gate!.drop(st.tick, rolls)) requestStop('measured');
                    }
                    drops = d;
                    for (const s = st.counters.slips ?? 0; slips < s; slips++) gate!.slip();
                    if (stopFor) return;
                    const catchUps = st.frames?.catchUpsLastMinute ?? 0;
                    if (technique === 'knife' && catchUps > above) {
                        paused = true;
                        log(`T${st.tick} pause: ${catchUps} catch-ups in the last minute, over ${above}: plain`);
                        requestStop('pause');
                    } else if (paused && st.tick - st.startedTick >= pauseTicks && catchUps < below) {
                        log(`T${st.tick} resume: ${catchUps} catch-ups in the last minute, under ${below}: re-probe`);
                        requestStop('resume');
                    } else if (gate!.due(st.tick)) requestStop('probe');
                }
            });
        } catch (e) {
            if (e instanceof ProgramError && e.status) {
                const seg: GatedSegment = { technique, reason: 'fault', status: e.status };
                segments.push(seg);
                opts.onSegment?.(seg);
            }
            throw e;
        } finally {
            opts.signal?.removeEventListener('abort', onAbort);
        }
        const reason: SegmentEnd = status.phase === 'done' ? 'done' : (stopFor ?? 'stopped');
        const seg: GatedSegment = { technique, reason, status };
        segments.push(seg);
        opts.onSegment?.(seg);
        used += dropsOf(sw, status);
        log(`T${status.tick} ${name} run ${status.runId} ${technique} ended: ${reason}, ${dropsOf(sw, status)} drops`);
        if (reason === 'done' || reason === 'aborted' || reason === 'stopped') return { segments, ended: reason };
        if (reason === 'resume') {
            paused = false;
            resumeProbe = true;
        }
    }
}
