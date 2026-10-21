// Drive the browser page's in-page tick programs from a step script
// (server/webclient/src/bot/programs; docs/speedrun/tick-programs.md).
//
// The reactive loops (knife mining, fishing and woodcutting, the pickpocket
// re-click, Agility obstacles) run inside the page, reacting on the decoded tick
// with no gateway hop; the SDK starts one with parameters, watches its counters
// in the published state (`state.program`), and awaits its end. Only one program
// runs at a time; starting another replaces it.
//
// Every call here rides the SDK's ordinary `sdk_action` relay, so `sdk/` needs no
// new API: the `program` action has no typed wrapper on BotSDK, and the relay
// method that every wrapper calls is reached directly (`relay` below).

import type { BotSDK } from '../../sdk/index';
import type { ActionResult, BotWorldState } from '../../sdk/types';
import { type ProbeResult, summarizeProbe, tickSteadiness } from './hostgate';
import { tickMs } from './wait';

/** The page's published program status (server/webclient/src/bot/programs/types.ts). */
export interface ProgramStatus {
    runId: number;
    name: string;
    phase: 'running' | 'done' | 'fault' | 'stopped' | 'replaced';
    params: Record<string, unknown>;
    startedTick: number;
    tick: number;
    progressTick: number;
    counters: Record<string, number>;
    gauges: Record<string, number>;
    packets: number;
    deferred: number;
    skippedTicks: number;
    maxTickMs: number;
    /**
     * Server frame intervals during the run, from raw arrivals: a catch-up is an interval
     * under 150 ms right after one over 350 ms (server overrun). The in-run gate rule
     * reads `frames.catchUpsLastMinute` and `publish.p90`.
     */
    frames: FrameSummary;
    /** The page's state publication intervals during the run. */
    publish: FrameSummary;
    /** Wall ms from the newest decoded frame's arrival to the program's decision. */
    react: { n: number; p50: number; p90: number; max: number };
    /** The page's game-loop rate (its reaction granularity until decoding runs on message arrival). */
    loops: { last: number; p10Last10s: number; min: number };
    last?: string;
    fault?: string;
    faultDetail?: unknown;
    result?: unknown;
    endedTick?: number;
    logTail?: string[];
}

/** server/webclient/src/bot/programs/frames.ts */
export interface FrameSummary {
    n: number;
    p50: number;
    p90: number;
    max: number;
    under150: number;
    over350: number;
    catchUps: number;
    catchUpsLastMinute: number;
    catchUpsPerMinute: number;
}

export type ProgramName = 'probe' | 'knife-cycle' | 'knife-mine' | 'pickpocket' | 'agility';

export type ProgramSdk = Pick<BotSDK, 'getState' | 'onStateUpdate'>;

export class ProgramError extends Error {
    constructor(message: string, readonly status: ProgramStatus | null) {
        super(message);
        this.name = 'ProgramError';
    }
}

type ProgramAction = { op: 'start'; name: string; params?: Record<string, unknown> } | { op: 'stop' } | { op: 'status' } | { op: 'list' };

function relay(sdk: ProgramSdk, action: ProgramAction): Promise<ActionResult> {
    const send = (sdk as unknown as { sendAction?: (a: unknown) => Promise<ActionResult> }).sendAction;
    if (typeof send !== 'function') throw new Error('this SDK has no action relay (BotSDK.sendAction)');
    return send.call(sdk, { type: 'program', ...action, reason: 'speedrun' });
}

/** The program status the page published with this state (null on a lite client or before any start). */
export function programStatus(state: BotWorldState | null | undefined): ProgramStatus | null {
    return ((state as { program?: ProgramStatus | null } | null | undefined)?.program) ?? null;
}

/** Start (or replace the running program with) `name`. Resolves with the new run's status. */
export async function startProgram(sdk: ProgramSdk, name: ProgramName | string, params: Record<string, unknown> = {}): Promise<ProgramStatus> {
    const r = await relay(sdk, { op: 'start', name, params });
    const status = (r.data as ProgramStatus | undefined) ?? null;
    if (!r.success || !status) throw new ProgramError(`program ${name} did not start: ${r.message}`, status);
    return status;
}

/** Stop the running program; resolves with its final status (null if none ever ran). */
export async function stopProgram(sdk: ProgramSdk): Promise<ProgramStatus | null> {
    const r = await relay(sdk, { op: 'stop' });
    if (!r.success) throw new ProgramError(`program stop failed: ${r.message}`, null);
    return (r.data as ProgramStatus | null) ?? null;
}

export interface AwaitOptions {
    /** Give up after this much wall time (default: no limit). */
    timeoutMs?: number;
    /**
     * Reject when no state arrives for this long: the tab is wedged or gone, and the
     * session watchdog will relaunch it (default 20 ticks).
     */
    staleMs?: number;
    /** Every published status of this run while it is running. */
    onProgress?: (status: ProgramStatus) => void;
}

/**
 * Resolve when run `runId` ends with done, stopped or replaced; reject with a
 * ProgramError when it faults, when the page stops publishing, or when the run
 * disappears (the page reloaded, so its runtime and run ids restarted).
 */
export function awaitProgram(sdk: ProgramSdk, runId: number, opts: AwaitOptions = {}): Promise<ProgramStatus> {
    const staleMs = opts.staleMs ?? 20 * tickMs();
    return new Promise<ProgramStatus>((resolve, reject) => {
        let settled = false;
        let lastTick = sdk.getState()?.tick ?? -1;
        // The start reply comes back before the page publishes a state that carries the
        // run, so its absence only counts once it has been seen, or after a few ticks.
        let seen = false;
        const firstTick = lastTick;
        let stale: ReturnType<typeof setTimeout> | undefined;
        let overall: ReturnType<typeof setTimeout> | undefined;
        let unsubscribe: () => void = () => {};
        const finish = (fn: () => void) => {
            if (settled) return;
            settled = true;
            clearTimeout(stale);
            clearTimeout(overall);
            unsubscribe();
            fn();
        };
        const armStale = () => {
            clearTimeout(stale);
            stale = setTimeout(() => finish(() => reject(new ProgramError(`no state for ${staleMs} ms while program run ${runId} was running (tab wedged?)`, null))), staleMs);
        };
        const check = (s: BotWorldState) => {
            if (!s?.inGame) return;
            if (s.tick < lastTick) return finish(() => reject(new ProgramError(`tick went back from ${lastTick} to ${s.tick} (page reloaded?); program run ${runId} is gone`, programStatus(s))));
            lastTick = s.tick;
            const st = programStatus(s);
            if (!st || st.runId < runId) {
                if (!seen && s.tick - firstTick <= 10) return;
                return finish(() => reject(new ProgramError(`program run ${runId} is not in the page's state (page reloaded?)`, st)));
            }
            seen = true;
            if (st.runId > runId) return finish(() => resolve({ ...st, runId, phase: 'replaced' }));
            if (st.phase === 'running') return opts.onProgress?.(st);
            if (st.phase === 'fault') return finish(() => reject(new ProgramError(`program ${st.name} faulted: ${st.fault}`, st)));
            finish(() => resolve(st));
        };
        unsubscribe = sdk.onStateUpdate(s => {
            armStale();
            check(s);
        });
        armStale();
        if (opts.timeoutMs !== undefined) overall = setTimeout(() => finish(() => reject(new ProgramError(`program run ${runId} still running after ${opts.timeoutMs} ms`, programStatus(sdk.getState())))), opts.timeoutMs);
        const now = sdk.getState();
        if (now) check(now);
    });
}

/** Start `name` and await its end. */
export async function runProgram(sdk: ProgramSdk, name: ProgramName | string, params: Record<string, unknown> = {}, opts: AwaitOptions = {}): Promise<ProgramStatus> {
    const started = await startProgram(sdk, name, params);
    return awaitProgram(sdk, started.runId, opts);
}

/** The running (or last) program's counters, from the latest state. */
export function programCounters(sdk: ProgramSdk): Record<string, number> {
    return programStatus(sdk.getState())?.counters ?? {};
}

/** What the page's probe program returns (server/webclient/src/bot/programs/probe.ts). */
interface InPageProbeResult {
    trials: number;
    latencies: number[];
    lost: number;
    ticks: number;
    tickMs: number[];
    reason?: string;
}

export type DirectProbeResult = ProbeResult & { path: 'direct'; source: 'in-page' };

/**
 * The host gate's latency probe issued from the page itself (the direct path a
 * reactive program uses): the same walk trial as `probeOnTime`, summarized by the
 * same function, so the gate reads both paths alike. Ends on its start tile.
 */
export async function probeInPage(sdk: ProgramSdk, opts: { trials?: number; maxWait?: number; timeoutMs?: number } = {}): Promise<DirectProbeResult> {
    const trials = opts.trials ?? 20;
    const end = await runProgram(sdk, 'probe', { trials, maxWait: opts.maxWait ?? 8 }, { timeoutMs: opts.timeoutMs ?? (trials * 3 + 60) * tickMs() });
    const r = end.result as InPageProbeResult | undefined;
    if (!r) throw new ProgramError('probe ended without a result', end);
    // the page reports gaps between decoded ticks; the gate scores arrivals
    const tickArrivals = r.tickMs.reduce<number[]>((a, ms) => [...a, a[a.length - 1]! + ms], [0]);
    return {
        ...summarizeProbe(r.latencies),
        latencies: r.latencies,
        lost: r.lost,
        ticks: r.ticks,
        tickArrivals,
        steadiness: tickSteadiness(tickArrivals),
        sendMs: [],
        ...(r.reason ? { reason: r.reason } : {}),
        path: 'direct',
        source: 'in-page'
    };
}
