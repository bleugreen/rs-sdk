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
// - a state older than one tick of wall time is waited past, because the
//   server has already moved on and the next publication is due.
// Every boundary is logged as a `(boundary)` row, so the ledger's total is
// the whole run, idle ticks included.

import type { BotWorldState } from '../../sdk/types';
import type { Session } from '../lib/session';
import { measure, tickSpan, type TickLog } from '../lib/ticks';
import { currentTick, nextTick, tickMs, type StateSource } from '../lib/wait';
import { meterDispatch, TickWindow, type WindowSnapshot } from './budget';

export type Check<C> = (s: BotWorldState, c: C) => true | string;

export type RunnerSession = Pick<Session, 'sdk' | 'bot' | 'name' | 'sessionId'>;

export interface StepContext<C> {
    session: RunnerSession;
    sdk: RunnerSession['sdk'];
    bot: RunnerSession['bot'];
    c: C;
    log: TickLog;
}

export interface Step<C = Record<string, never>> {
    name: string;
    preconditions: Check<C>;
    run(ctx: StepContext<C>): Promise<void>;
    postconditions: Check<C>;
    /** True when the account can log out right after this step and resume at the next. */
    logoutSafe: boolean;
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
}

export interface RunStepsResult {
    /** Steps completed in this call. */
    completed: number;
    /** Set when stopped at a logout-safe boundary: the index to resume from. */
    resumeAt?: number;
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
    const unmeter = meterDispatch(sdk, window);
    try {
        let boundary = openBoundary(session, '(start)');
        for (let i = start; i < steps.length; i++) {
            const step = steps[i]!;
            const ctx: StepContext<C> = { session, sdk, bot: session.bot, c: opts.c, log: opts.log };

            let waited = false;
            if (i > start) {
                boundary.budget = window.snapshot();
                if (boundary.budget.free < 1) {
                    boundary.waits.push('budget');
                    await nextTick(sdk);
                    waited = true;
                }
            }
            if (!waited && (!sdk.getState() || window.ageMs(Date.now()) >= tickMs())) {
                boundary.waits.push('stale');
                await nextTick(sdk);
            }
            const pre = await check(sdk, step.preconditions, opts.c, boundary, 'pre-recheck');
            if (pre !== true) {
                failRow(opts.log, session, step.name, 'precondition', pre);
                throw new StepError(step.name, 'precondition', pre);
            }
            closeBoundary(opts.log, session, boundary, step.name, i);

            try {
                await measure(opts.log, session, step.name, () => step.run(ctx), { index: i });
            } catch (e) {
                throw new StepError(step.name, 'run', e instanceof Error ? e.message : String(e));
            }

            boundary = openBoundary(session, step.name);
            const post = await check(sdk, step.postconditions, opts.c, boundary, 'post-recheck');
            if (post !== true) {
                failRow(opts.log, session, step.name, 'postcondition', post);
                throw new StepError(step.name, 'postcondition', post);
            }

            if (step.logoutSafe && i + 1 < steps.length && shouldStop()) {
                closeBoundary(opts.log, session, boundary, '(logout)', i + 1);
                await logout(session);
                return { completed: i + 1 - start, resumeAt: i + 1 };
            }
        }
        if (start < steps.length) closeBoundary(opts.log, session, boundary, '(end)', steps.length);
        return { completed: steps.length - start };
    } finally {
        unmeter();
        unsubscribe();
        if (installed) process.off('SIGINT', onSigint);
    }
}
