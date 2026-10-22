// In-page tick programs: the contract between the runtime and a program.
//
// A program is a state machine driven by decoded server ticks. The runtime calls
// `onTick` once per game-loop pass that decoded at least one server tick, after
// the whole tick is applied and before the pass flushes its outgoing packets, so
// anything a program sends there leaves in that pass and is processed on the
// next server tick. There is no round trip to the gateway on that path.

import type { BotAction, BotWorldState } from '../types.js';
import type { FrameSummary, LoopSummary, MsSummary } from './frames.js';

/** A packet a program asks for: any synchronous overlay action, without its free-text reason. */
export type ProgramAction = Exclude<BotAction, { type: 'program' }> extends infer A ? (A extends { reason: string } ? Omit<A, 'reason'> : never) : never;

export type ProgramParams = Record<string, unknown>;

export interface ProgramContext {
    /** State collected for this tick (the same object the overlay publishes). */
    readonly state: BotWorldState;
    /** state.tick. */
    readonly tick: number;
    /**
     * Server ticks this call covers: 1 normally, more when the page fell behind
     * and decoded several ticks in one pass. A schedule keyed on tick numbers
     * must not assume it saw every label.
     */
    readonly ticksAdvanced: number;
    /** Wall ms (performance.now()) when this tick was handed to the program. */
    readonly nowMs: number;
    /** Date.now() when this tick was handed to the program: the scale other processes on the machine share. */
    readonly wallMs: number;
    /**
     * The server frames this pass decoded, oldest first: each frame's tick and the
     * Date.now() instant its websocket message arrived (not when it was decoded).
     * Empty when the caller passed no arrival times.
     */
    readonly frames: readonly FrameStamp[];
    /** Packets this program may still send this tick (the server reads at most 5 user events per tick). */
    readonly budget: number;
    /**
     * Send now. False when the budget for this tick is spent (the packet is not
     * sent and counts as `deferred`) or the client rejected the action.
     */
    send(action: ProgramAction, what?: string): boolean;
    /** Add to a named counter published with the program's status. */
    count(name: string, by?: number): void;
    /** Set a published gauge (last value wins). */
    gauge(name: string, value: number): void;
    /** Stamp this tick under a named mark: an event a poller must be able to time one by one (`ProgramStatus.marks`). */
    mark(name: string): void;
    /**
     * Publish structured data with the status (`ProgramStatus.shared`) for the driver
     * to read while the run goes. The object is published by reference, so later
     * mutations show too, including ones made in onStop.
     */
    share(data: unknown): void;
    /** Mark progress: resets the runtime's stall detector. */
    progress(): void;
    log(line: string): void;
    /** Finish successfully with an optional result object. */
    done(result?: unknown): void;
    /** Finish with a fault the SDK side should act on. */
    fault(reason: string, detail?: unknown): void;
}

export interface TickProgram {
    onTick(ctx: ProgramContext): void;
    /** Called once when the program leaves the runtime for any reason. */
    onStop?(reason: ProgramEnd): void;
    /** A snapshot of the program's own result so far, published when it is stopped from outside. */
    snapshot?(): unknown;
    /**
     * Data the driver sends a running program (the `input` op), validated by the
     * program: throw to refuse it. The return value goes back to the sender. The
     * program applies it on its next tick; this runs between ticks.
     */
    onInput?(data: unknown): unknown;
    /**
     * Ticks without progress() before the runtime faults the run (a start
     * parameter `stallTicks` overrides it; default the runtime's 60).
     */
    stallTicks?: number;
}

export interface ProgramInit {
    /** The last state the runtime saw before the start, or null before the first tick. */
    state: BotWorldState | null;
    log(line: string): void;
}

export interface ProgramFactory {
    (params: ProgramParams, init: ProgramInit): TickProgram;
    /**
     * Every start parameter key the program reads (besides the runtime's own,
     * RUNTIME_PARAMS). A start with any other key faults: a key the page does not
     * know means a typo or a page built from a commit without that program change,
     * and either way the run would not be the program the caller asked for.
     */
    readonly params: readonly string[];
}

export type ProgramEnd = 'done' | 'fault' | 'stopped' | 'replaced';

/** One server frame: its tick and the Date.now() instant it arrived. */
export interface FrameStamp {
    tick: number;
    ms: number;
}

export type ProgramPhase = 'running' | ProgramEnd;

/**
 * A mark's running record. `count` only grows during a run; `ticks` holds the last
 * MARK_TAIL stamps (runtime.ts), oldest first. A poller that saw `count` = c last time
 * takes the last (count - c) entries of `ticks`; more new stamps than `ticks` holds means
 * it polled too slowly and lost the excess.
 */
export interface ProgramMark {
    count: number;
    ticks: number[];
}

/** What the page publishes as `state.program` (and window.rsPrograms.status()). */
export interface ProgramStatus {
    /** Bumps on every start; a step script awaits its own run by id. */
    runId: number;
    name: string;
    phase: ProgramPhase;
    params: ProgramParams;
    startedTick: number;
    /** Last tick the program ran on. */
    tick: number;
    /** Last tick it reported progress. */
    progressTick: number;
    counters: Record<string, number>;
    gauges: Record<string, number>;
    /**
     * Per-event tick stamps, published while the run goes (`ctx.mark`). A stamp is the
     * decoded tick the program saw the event on: when the page decodes several ticks in
     * one pass it is the last of them.
     */
    marks: Record<string, ProgramMark>;
    /** Packets sent, and packets refused because the tick's budget was spent. */
    packets: number;
    deferred: number;
    /** Ticks the page skipped (decoded more than one tick in a pass) while running. */
    skippedTicks: number;
    /** Slowest onTick in wall ms. */
    maxTickMs: number;
    /**
     * Intervals between the server frames (websocket messages carrying a PLAYER_INFO)
     * that arrived during this run, with catch-ups (frames.ts). The host gate's in-run
     * rule reads these beside the program's slips.
     */
    frames: FrameSummary;
    /** Intervals between the page's state publications (decode passes) during this run. */
    publish: FrameSummary;
    /**
     * Wall ms from the newest decoded frame's arrival to the program deciding on it: the
     * page's own share of a reaction (its packets leave in the flush that ends this pass).
     */
    react: MsSummary;
    /** The page's game-loop rate while this run ran (its reaction granularity; frames.ts). */
    loops: LoopSummary;
    /** Structured data the program shares while it runs (`ctx.share`). */
    shared?: unknown;
    /** Last log line. */
    last?: string;
    fault?: string;
    faultDetail?: unknown;
    /** The program's result once it ends. */
    result?: unknown;
    endedTick?: number;
    /** The run's last log lines, attached when it ends (the production bundle has no console). */
    logTail?: string[];
}

/** The overlay action that drives the runtime (relayed by the gateway like any other). */
export type ProgramCommand =
    | { op: 'start'; name: string; params?: ProgramParams }
    | { op: 'stop' }
    | { op: 'status' }
    | { op: 'list' }
    /** Hand data to the running program (TickProgram.onInput). */
    | { op: 'input'; data: unknown };
