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
import type { FrameSummary } from '../../server/webclient/src/bot/programs/frames';
import { type ProbeResult, summarizeProbe, type TickLength, tickSteadiness } from './hostgate';
import { idleBoundMs, keepInput, type KeepInputOptions, type TickPeriod } from './wait';

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
    /** Per-event tick stamps published while the run goes; read them with `marksSince`. */
    marks: Record<string, ProgramMark>;
    packets: number;
    deferred: number;
    skippedTicks: number;
    maxTickMs: number;
    /**
     * Server frame intervals during the run, from raw arrivals: a catch-up is an interval
     * under 1/2 T right after one over 7/6 T (server overrun; tick-rule.ts), T the run's
     * `tickMs` start parameter or else its median interval. The in-run gate rule reads
     * `frames.catchUpsLastMinute` and `publish.p90`.
     */
    frames: FrameSummary;
    /** The page's state publication intervals during the run. */
    publish: FrameSummary;
    /** Wall ms from the newest decoded frame's arrival to the program's decision. */
    react: { n: number; p50: number; p90: number; max: number };
    /** The page's game-loop rate (its reaction granularity until decoding runs on message arrival). */
    loops: { last: number; p10Last10s: number; min: number };
    /** Structured data the program shares while it runs (rc-cycle: RcShared). */
    shared?: unknown;
    last?: string;
    fault?: string;
    faultDetail?: unknown;
    result?: unknown;
    endedTick?: number;
    logTail?: string[];
}

/** server/webclient/src/bot/programs/types.ts: `count` grows through a run, `ticks` keeps the last 64 stamps. */
export interface ProgramMark {
    count: number;
    ticks: number[];
}

/**
 * The stamps of mark `name` since a poll that had seen `seen` of them (0 at a new runId):
 * `ticks` the new ones in order, `count` the value to pass next time, and `missed` the new
 * stamps that already fell out of the page's window (the poller was too slow).
 */
export function marksSince(status: ProgramStatus | null | undefined, name: string, seen: number): { count: number; ticks: number[]; missed: number } {
    const m = status?.marks?.[name];
    if (!m) return { count: seen, ticks: [], missed: 0 };
    const fresh = Math.max(0, m.count - seen);
    const ticks = m.ticks.slice(m.ticks.length - Math.min(fresh, m.ticks.length));
    return { count: m.count, ticks, missed: fresh - ticks.length };
}

/** The page's own summary type, so the two cannot drift. */
export type { FrameSummary } from '../../server/webclient/src/bot/programs/frames';

/**
 * The `tickMs` start parameter for a measured tick length (a flag or the feed): the page judges
 * the run's frames at it. Nothing for a median, which the page measures itself.
 */
export function tickParam(tick: TickLength | null | undefined): { tickMs?: number } {
    return tick && tick.source !== 'median' ? { tickMs: tick.T } : {};
}

export type ProgramName = 'probe' | 'knife-cycle' | 'knife-mine' | 'pickpocket' | 'agility' | 'rc-cycle' | 'item-cycle';

export type ProgramSdk = Pick<BotSDK, 'getState' | 'onStateUpdate' | 'sendWait'>;

export class ProgramError extends Error {
    constructor(message: string, readonly status: ProgramStatus | null) {
        super(message);
        this.name = 'ProgramError';
    }
}

type ProgramAction = { op: 'start'; name: string; params?: Record<string, unknown> } | { op: 'stop' } | { op: 'status' } | { op: 'list' } | { op: 'input'; data: unknown };

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
    /** Give up once this many ticks pass while the run is still going (default: no limit); counted on ticks, so a slow minute does not shorten it. */
    maxTicks?: number;
    /**
     * Reject when no state arrives for this long: the tab is wedged or gone, and the
     * session watchdog will relaunch it (default 20 ticks of the longer of the nominal and
     * `period`'s observed length: wait.ts idleBoundMs).
     */
    staleMs?: number;
    /** The observed tick period the default `staleMs` is sized from. */
    period?: TickPeriod;
    /** Every published status of this run while it is running. */
    onProgress?: (status: ProgramStatus) => void;
    /** The keep-input's clock and report (wait.ts keepInput); it runs whatever is given here. */
    keepInput?: KeepInputOptions;
}

/**
 * Resolve when run `runId` ends with done, stopped or replaced; reject with a
 * ProgramError when it faults, when the page stops publishing, or when the run
 * disappears (the page reloaded, so its runtime and run ids restarted).
 *
 * The program's own clicks never reset the client's idle timer (wait.ts CLIENT_IDLE_LOGOUT_MS), so
 * while the run goes this sends a keep-input every KEEP_INPUT_MS of wall time (wait.ts keepInput),
 * and none once it has ended: a run shorter than that sends nothing.
 */
export function awaitProgram(sdk: ProgramSdk, runId: number, opts: AwaitOptions = {}): Promise<ProgramStatus> {
    const staleMs = opts.staleMs ?? idleBoundMs({ ticks: 20, period: opts.period });
    const keep = keepInput(sdk, opts.keepInput);
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
            keep.stop();
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
            if (opts.maxTicks !== undefined && s.tick - firstTick > opts.maxTicks && !(st && st.runId === runId && st.phase !== 'running')) {
                return finish(() => reject(new ProgramError(`program run ${runId} still running after ${opts.maxTicks} ticks`, st)));
            }
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
            if (!settled && s?.inGame) keep.see(s);
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

/**
 * Ticks whose sixth and later user events the engine deferred to the next tick (the page's
 * `counters.overBudget`: a tick of 5 sends that held a routed op was 6 events). As a row's
 * meta: `{ overBudget }` when there were any, else nothing, so a row without overflow is
 * unchanged.
 */
export function overBudgetMeta(status: Pick<ProgramStatus, 'counters'> | null | undefined): { overBudget?: number } {
    const n = status?.counters?.overBudget ?? 0;
    return n > 0 ? { overBudget: n } : {};
}

/** The running (or last) program's counters, from the latest state. */
export function programCounters(sdk: ProgramSdk): Record<string, number> {
    return programStatus(sdk.getState())?.counters ?? {};
}

/** Hand data to the running program (its onInput); resolves with its reply, rejects if it refused. */
export async function sendProgramInput(sdk: ProgramSdk, data: unknown): Promise<unknown> {
    const r = await relay(sdk, { op: 'input', data });
    if (!r.success) throw new ProgramError(`program input refused: ${r.message}`, programStatus(sdk.getState()));
    return r.data;
}

// ---------------------------------------------------------------- rc-cycle
// The page's Runecraft hand-off program (server/webclient/src/bot/programs/rc-cycle.ts)
// owns the schedule; the step that drives it owns cue.json (speedrun/helpers/altar-cue.ts,
// rs/117) and relays between the two:
//   - into the page: `sendProgramInput(sdk, {givers})`, the givers whose status files say
//     ready or armed, in the room and beside the scored tile, oldest readyAt first, each with
//     its readyAt and `schedule: 'tuned'` only if it logged in before the scored account;
//   - out of the page: `rcCueFields(status)` into `CueWriter.write` whenever its `key`
//     changes. A new program run (runId) is a new cue session (a new CueWriter).

export type RcSchedule = 'tuned' | 'robust';

/** rc-cycle.ts RcShared. */
export interface RcShared {
    v: 1;
    open: number;
    schedule: RcSchedule;
    beacons: Array<{ tick: number; ms: number }>;
    turns: Array<{ giver: string; T: number; schedule: RcSchedule }>;
    results: Array<{ giver: string; T: number; schedule: RcSchedule; outcome: 'gave' | 'missed' | 'late' | 'no-giver'; tick: number; craft?: number; order?: 'giver-first' | 'scored-first'; salvaged?: boolean; seen: Record<string, number>; detail?: string }>;
    queue: string[];
    waiting: 'giver' | null;
    stop?: true;
}

/** What cue.json takes from the page (CueWriter.write's fields), plus `key`: rewrite the cue when it changes. */
export function rcCueFields(status: ProgramStatus | null | undefined): { beacons: RcShared['beacons']; turns: RcShared['turns']; schedule: RcSchedule; open: number; stop?: boolean; key: string } | null {
    const s = status?.name === 'rc-cycle' ? (status.shared as RcShared | undefined) : undefined;
    if (!s || s.v !== 1 || s.beacons.length === 0) return null;
    const stop = s.stop === true;
    return {
        beacons: s.beacons,
        turns: s.turns,
        schedule: s.schedule,
        open: s.open,
        ...(stop ? { stop } : {}),
        key: JSON.stringify([status!.runId, s.turns, s.schedule, s.open, stop])
    };
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
 *
 * `dirs` are the neighbour steps the probe tries, in order (the page's default is E, W, N, S).
 * Each blocked one costs maxWait + 1 ticks before the next is tried, so a caller that knows
 * which neighbours are free (a tree stand) passes those.
 */
export async function probeInPage(
    sdk: ProgramSdk,
    opts: { trials?: number; maxWait?: number; maxTicks?: number; dirs?: ReadonlyArray<readonly [number, number]>; tick?: TickLength | null } = {}
): Promise<DirectProbeResult> {
    const trials = opts.trials ?? 20;
    const params = { trials, maxWait: opts.maxWait ?? 8, ...(opts.dirs ? { dirs: opts.dirs.map(d => [d[0], d[1]]) } : {}), ...tickParam(opts.tick) };
    const end = await runProgram(sdk, 'probe', params, { maxTicks: opts.maxTicks ?? trials * 3 + 60 });
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
        steadiness: tickSteadiness(tickArrivals, opts.tick),
        sendMs: [],
        ...(r.reason ? { reason: r.reason } : {}),
        path: 'direct',
        source: 'in-page'
    };
}
