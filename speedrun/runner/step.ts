// Step runner skeleton. A step checks its preconditions from state, runs,
// verifies its postconditions, and logs its in-world ticks. Stops (SIGINT by
// default) are honoured only after a step marked logoutSafe, by logging out
// cleanly and returning the index to resume from.

import type { BotWorldState } from '../../sdk/types';
import type { Session } from '../lib/session';
import { measure, type TickLog } from '../lib/ticks';
import { nextTick, tickMs } from '../lib/wait';

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
    try {
        for (let i = start; i < steps.length; i++) {
            const step = steps[i]!;
            const ctx: StepContext<C> = { session, sdk: session.sdk, bot: session.bot, c: opts.c, log: opts.log };

            const before = await nextTick(session.sdk);
            const pre = step.preconditions(before, opts.c);
            if (pre !== true) {
                failRow(opts.log, session, step.name, 'precondition', pre);
                throw new StepError(step.name, 'precondition', pre);
            }

            try {
                await measure(opts.log, session, step.name, () => step.run(ctx), { index: i });
            } catch (e) {
                throw new StepError(step.name, 'run', e instanceof Error ? e.message : String(e));
            }

            const after = await nextTick(session.sdk);
            const post = step.postconditions(after, opts.c);
            if (post !== true) {
                failRow(opts.log, session, step.name, 'postcondition', post);
                throw new StepError(step.name, 'postcondition', post);
            }

            if (step.logoutSafe && i + 1 < steps.length && shouldStop()) {
                await logout(session);
                return { completed: i + 1 - start, resumeAt: i + 1 };
            }
        }
        return { completed: steps.length - start };
    } finally {
        if (installed) process.off('SIGINT', onSigint);
    }
}
