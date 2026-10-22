// Step runner skeleton. A step checks its preconditions from state, runs,
// verifies its postconditions, and logs its in-world ticks. Stops (SIGINT by
// default) are honoured only after a step marked logoutSafe, by logging out
// cleanly and returning the index to resume from.
//
// The scored account's clock runs between steps too, so a boundary waits for
// a tick only when it has to:
// - checks read the state already published for the current tick (both clients
//   publish a tick only after decoding all of it); a failing check waits exactly
//   one tick and is checked once more, which covers an effect that lands a tick
//   after the step returned;
// - the next step starts in the same tick when this tick's user-event budget
//   (budget.ts) still has room for its first packet, otherwise on the next tick,
//   never later;
// - a state older than one tick (the observed tick length, lib/wait.ts periodMs)
//   is waited past, because the server has already moved on and the next
//   publication is due.
// Every boundary is logged as a `(boundary)` row, so the ledger's total is
// the whole run, idle ticks included.
//
// Run is on from login (lib/session.ts); a step with `running: false` (lab A/B
// only) has it turned off at its boundary and back on at the next one's.

import type { BotWorldState } from '../../sdk/types';
import type { Session } from '../lib/session';
import { startRunTickMonitor, type TickMonitorSetting } from '../lib/tick-monitor';
import { ensureRun } from '../lib/run-mode';
import { measure, tickSpan, type TickLog } from '../lib/ticks';
import { currentTick, feedTickPeriod, nextTick, periodMs, TickPeriod, tickMs, type StateSource } from '../lib/wait';
import { meterDispatch, TickWindow, type WindowSnapshot } from './budget';

export type Check<C> = (s: BotWorldState, c: C) => true | string;

/**
 * `tickBase` (optional so test fakes need not carry it; a real Session always does): the tick
 * the current login's count starts from, which a resumed step that times a login-armed
 * deadline reads (skills/cooking.ts).
 */
export type RunnerSession = Pick<Session, 'sdk' | 'bot' | 'name' | 'sessionId'> & Partial<Pick<Session, 'tickBase'>>;

/**
 * What the resume walk (runner/resume.ts) knows about the game: the published
 * state, plus the results of any probes the steps asked for (a bank-open probe,
 * a quest-journal read). A probe that could not run (not at a bank) is null.
 */
export interface Observed {
    state: BotWorldState;
    probed: Readonly<Record<string, unknown>>;
}

export type ObservedCheck<C> = (o: Observed, c: C) => boolean;

export interface StepContext<C> {
    session: RunnerSession;
    sdk: RunnerSession['sdk'];
    bot: RunnerSession['bot'];
    c: C;
    log: TickLog;
    /** Set when the step is entered through `resume` after a restart: what the walk observed. */
    observed?: Observed;
}

export interface Step<C = Record<string, never>> {
    name: string;
    preconditions: Check<C>;
    run(ctx: StepContext<C>): Promise<void>;
    postconditions: Check<C>;
    /** True when the account can log out right after this step and resume at the next. */
    logoutSafe: boolean;
    /**
     * false: runSteps turns the run toggle off before this step and back on
     * before the next step that does not opt out (lib/run-mode.ts). For lab A/B
     * measurement of a loop walking versus running only; the scored run always
     * runs, and a step does not set this on run day. Default (absent): on.
     */
    running?: boolean;

    // Resume protocol (runner/resume.ts). All optional: a step without `done` is
    // transient (travel, banking) and is never a checkpoint.

    /**
     * A milestone: true once this step's effect is in the game state, and true
     * for every later state of the run (levels, xp, quest stage, items owned).
     * The walk resumes at the first milestone that is not done.
     */
    done?: ObservedCheck<C>;
    /** The step was started and not finished (say, Mining between 64 and 99 at the rocks). */
    inProgress?: ObservedCheck<C>;
    /** Entry when `inProgress` holds; default `run`. Must work from any state `inProgress` admits. */
    resume?(ctx: StepContext<C>): Promise<void>;
    /** Probes (names in the resumable runner's `probes`) that `done` / `inProgress` read. */
    probes?: readonly string[];
}

export class StepError extends Error {
    constructor(readonly step: string, readonly phase: 'precondition' | 'run' | 'postcondition', readonly detail: string) {
        super(`step "${step}" ${phase} failed: ${detail}`);
        this.name = 'StepError';
    }
}

export interface RunStepsOptions<C> {
    log: TickLog;
    c: C;
    /** Index or name of the first step to run (resume point). */
    from?: number | string;
    /** Polled after each logoutSafe step; default: true once SIGINT was received. */
    shouldStop?: () => boolean;
    /** How to leave the world at a stop (default: logoutClean). */
    logout?: (session: RunnerSession) => Promise<unknown>;
    /**
     * 'resume' enters the first step through its `resume` handler (default
     * `run`) without its precondition check: the resume walk already found it in
     * progress, which its start preconditions need not admit.
     */
    startMode?: 'run' | 'resume';
    /** Handed to the resumed step's context. */
    observed?: Observed;
    /** Checked before each step and before a stop's logout: once aborted, return without starting anything. */
    signal?: AbortSignal;
    /**
     * The in-run tick-cadence monitor (lib/tick-monitor.ts), on by default for the call: a
     * `tickmon` row per minute in `log`. false turns it off (runResumable runs one across its
     * attempts instead); an object overrides its thresholds.
     */
    tickMonitor?: TickMonitorSetting;
}

export interface RunStepsResult {
    /** Steps completed in this call. */
    completed: number;
    /** Set when stopped at a logout-safe boundary (or aborted): the index to resume from. */
    resumeAt?: number;
    /** The signal aborted the run (a dropped connection, runner/resume.ts). */
    aborted?: true;
}

export function resolveStart(steps: ReadonlyArray<{ name: string }>, from: number | string | undefined): number {
    if (from === undefined) return 0;
    if (typeof from === 'number') {
        if (from < 0 || from > steps.length) throw new Error(`--from ${from} is out of range 0..${steps.length}`);
        return from;
    }
    const i = steps.findIndex(s => s.name === from);
    if (i < 0) throw new Error(`no step named "${from}"`);
    return i;
}

function failRow(log: TickLog, session: RunnerSession, step: string, phase: string, detail: string): void {
    const tick = session.sdk.getState()?.tick ?? -1;
    log.append({
        v: 1, runId: log.runId, account: session.name, sessionId: session.sessionId, step: `${step}:${phase}`,
        startTick: tick, endTick: tick, ticks: 0, wallMs: 0, ok: false, error: detail, tickMs: tickMs(), at: new Date().toISOString(),
    });
}

/** The step name of the ledger rows that cover the ticks between steps. */
export const BOUNDARY_STEP = '(boundary)';

/** Why a boundary waited for a tick. */
export type BoundaryWait = 'post-recheck' | 'budget' | 'stale' | 'pre-recheck';

interface Boundary {
    from: string;
    startTick: number;
    startSession: number;
    t0: number;
    waits: BoundaryWait[];
    budget?: WindowSnapshot;
}

function openBoundary(session: RunnerSession, from: string): Boundary {
    return { from, startTick: currentTick(session.sdk), startSession: session.sessionId, t0: Date.now(), waits: [] };
}

function closeBoundary(log: TickLog, session: RunnerSession, b: Boundary, to: string, index: number): void {
    const endTick = currentTick(session.sdk);
    const span = tickSpan(b.startTick, endTick, b.startSession, session.sessionId);
    log.append({
        v: 1, runId: log.runId, account: session.name, sessionId: session.sessionId, step: BOUNDARY_STEP,
        startTick: b.startTick, endTick, ticks: span.ticks, wallMs: Date.now() - b.t0, ok: true,
        meta: { from: b.from, to, index, waits: b.waits, ...(b.budget ? { budget: b.budget } : {}) },
        ...(span.crossedSession ? { crossedSession: true } : {}),
        tickMs: tickMs(), at: new Date().toISOString(),
    });
}

/** Check the published state; on failure wait exactly one tick and check once more. */
async function check<C>(sdk: StateSource, fn: Check<C>, c: C, b: Boundary, wait: BoundaryWait): Promise<true | string> {
    const s = sdk.getState() ?? (await nextTick(sdk));
    if (fn(s, c) === true) return true;
    b.waits.push(wait);
    return fn(await nextTick(sdk, s.tick), c);
}

export async function runSteps<C>(session: RunnerSession, steps: ReadonlyArray<Step<C>>, opts: RunStepsOptions<C>): Promise<RunStepsResult> {
    const start = resolveStart(steps, opts.from);
    let sigint = false;
    const onSigint = () => {
        if (sigint) process.exit(130);
        sigint = true;
        console.error('[runSteps] stop requested: finishing to the next logout-safe step (Ctrl-C again to abort)');
    };
    const installed = !opts.shouldStop;
    if (installed) process.on('SIGINT', onSigint);
    const shouldStop = opts.shouldStop ?? (() => sigint);
    const logout = opts.logout ?? (async (s: RunnerSession) => (await import('../lib/session')).logoutClean(s as Session));
    const sdk = session.sdk;
    const window = new TickWindow(currentTick(sdk), sdk.getStateReceivedAt?.() || Date.now());
    const unsubscribe = sdk.onStateUpdate(s => window.observe(s.tick, Date.now()));
    // A state older than one tick of the observed period is stale (a nominal tick shorter than
    // the real one would call a current state stale and spend a tick waiting for the next).
    const period = new TickPeriod();
    const unperiod = feedTickPeriod(sdk, period);
    const unmeter = meterDispatch(sdk, window);
    const monitor = startRunTickMonitor(session, opts.log, opts.tickMonitor);
    // The run mode this call set: undefined until a step opts out (login left run on).
    let runSet: boolean | undefined;
    try {
        let boundary = openBoundary(session, '(start)');
        for (let i = start; i < steps.length; i++) {
            const step = steps[i]!;
            if (opts.signal?.aborted) return { completed: i - start, resumeAt: i, aborted: true };
            const resuming = i === start && opts.startMode === 'resume';
            const ctx: StepContext<C> = { session, sdk, bot: session.bot, c: opts.c, log: opts.log, ...(resuming && opts.observed ? { observed: opts.observed } : {}) };

            let waited = false;
            if (i > start) {
                boundary.budget = window.snapshot();
                if (boundary.budget.free < 1) {
                    boundary.waits.push('budget');
                    await nextTick(sdk);
                    waited = true;
                }
            }
            if (!waited && (!sdk.getState() || window.ageMs(Date.now()) >= periodMs(period))) {
                boundary.waits.push('stale');
                await nextTick(sdk);
            }
            const wantRun = step.running !== false;
            if (!wantRun || runSet === false) {
                try {
                    await ensureRun(sdk, wantRun);
                } catch (e) {
                    const detail = e instanceof Error ? e.message : String(e);
                    failRow(opts.log, session, step.name, 'precondition', detail);
                    throw new StepError(step.name, 'precondition', detail);
                }
                runSet = wantRun;
            }
            if (!resuming) {
                const pre = await check(sdk, step.preconditions, opts.c, boundary, 'pre-recheck');
                if (pre !== true) {
                    failRow(opts.log, session, step.name, 'precondition', pre);
                    throw new StepError(step.name, 'precondition', pre);
                }
            }
            closeBoundary(opts.log, session, boundary, step.name, i);

            const entry = resuming && step.resume ? step.resume.bind(step) : step.run.bind(step);
            try {
                await measure(opts.log, session, step.name, () => entry(ctx), { index: i, ...(resuming ? { resumed: true } : {}) });
            } catch (e) {
                throw new StepError(step.name, 'run', e instanceof Error ? e.message : String(e));
            }

            boundary = openBoundary(session, step.name);
            const post = await check(sdk, step.postconditions, opts.c, boundary, 'post-recheck');
            if (post !== true) {
                failRow(opts.log, session, step.name, 'postcondition', post);
                throw new StepError(step.name, 'postcondition', post);
            }

            if (opts.signal?.aborted) return { completed: i + 1 - start, resumeAt: i + 1, aborted: true };
            if (step.logoutSafe && i + 1 < steps.length && shouldStop()) {
                closeBoundary(opts.log, session, boundary, '(logout)', i + 1);
                await logout(session);
                return { completed: i + 1 - start, resumeAt: i + 1 };
            }
        }
        if (start < steps.length) closeBoundary(opts.log, session, boundary, '(end)', steps.length);
        return { completed: steps.length - start };
    } finally {
        monitor?.stop();
        unmeter();
        unperiod();
        unsubscribe();
        if (installed) process.off('SIGINT', onSigint);
    }
}
