// The in-page program runtime: a registry of tick programs and at most one
// running instance, driven from the decoded-tick hook.
//
// One program at a time is deliberate. Every reactive step owns the player's
// interaction and the tick's packet budget; two would fight over both. Starting
// a program replaces the running one in the same call.
//
// The budget: the engine decodes at most 5 user events (OPLOC, OPHELD, IF_BUTTON,
// MOVE_OPCLICK, ...) per player per tick and leaves the rest in the socket, so a sixth
// is not refused but deferred: it is decoded on the next tick (NetworkPlayer.decodeIn,
// ClientGameProtCategory.USER_EVENT). The runtime refuses a sixth send in a tick
// instead and counts it as `deferred`; programs order their sends by priority.
//
// That gate counts sends, but a routed op is two user events (MOVE_OPCLICK, then the op),
// so a tick of 5 sends can be 6 events. The runtime counts the events the client reports
// (`packets`) and, in `counters.overBudget`, the ticks whose sixth and later events the
// engine deferred. A program that relies on the exact count budgets events itself
// (item-cycle, with userEventsOf).

import type { ActionResult } from '../ActionExecutor.js';
import type { BotAction, BotWorldState } from '../types.js';
import { FrameStats, LoopRate, MsHistogram } from './frames.js';
import type { ProgramAction, ProgramCommand, ProgramContext, ProgramEnd, ProgramFactory, ProgramParams, ProgramStatus, TickProgram } from './types.js';

export const USER_EVENTS_PER_TICK = 5;

/**
 * Actions whose browser-client method routes first: on finding a route (including the
 * zero-step route from a tile already in reach) it writes MOVE_OPCLICK, a user event, ahead
 * of the op (Client.tryMove), so one send is two of the tick's five.
 */
export const ROUTING_ACTIONS: ReadonlySet<string> = new Set(['interactLoc', 'useItemOnLoc', 'interactNpc', 'talkToNpc', 'interactPlayer', 'useItemOnNpc', 'spellOnNpc', 'spellOnPlayer', 'spellOnGroundItem', 'pickupItem', 'interactGroundItem']);

/** Actions that take `route: false`: the op alone, refused by the client unless already in reach. */
export const UNROUTABLE_ACTIONS: ReadonlySet<string> = new Set(['interactLoc', 'interactNpc', 'interactGroundItem', 'pickupItem']);

/** User events a send writes at most: 2 for an action that may route, 1 otherwise (an unrouted op is 1). */
export function userEventsOf(action: { type: string; route?: boolean }): number {
    if (action.route === false && UNROUTABLE_ACTIONS.has(action.type)) return 1;
    return ROUTING_ACTIONS.has(action.type) ? 2 : 1;
}

/** Start parameters the runtime itself reads, accepted for every program. */
export const RUNTIME_PARAMS: readonly string[] = ['stallTicks', 'hold'];

export interface RuntimeOptions {
    /** Sends one action now (ActionExecutor.execute for the synchronous actions programs use). */
    dispatch: (action: BotAction) => ActionResult | Promise<ActionResult>;
    /** Packets per tick a program may send (default 5). */
    packetsPerTick?: number;
    /**
     * Fault a program that reports no progress for this many ticks (default 60).
     * A program can override it with the `stallTicks` start parameter.
     */
    stallTicks?: number;
    now?: () => number;
    /** Date.now(): frame arrivals are converted to this scale (`ctx.frames`). */
    wallNow?: () => number;
    /** The client's game-loop pass counter, for the loop rate a run publishes. */
    loopCount?: () => number;
    /** Every log line, prefixed with the program name (console in the page). */
    log?: (line: string) => void;
    /** Called once when a run ends, with its final status. */
    onEnd?: (status: ProgramStatus) => void;
    /** The draw for the `hold` parameter (default Math.random). */
    random?: () => number;
}

interface Run {
    program: TickProgram;
    status: ProgramStatus;
    stallTicks: number;
    ended: boolean;
    tail: string[];
    frames: FrameStats;
    publish: FrameStats;
    /** 1 ms buckets up to 200 ms. */
    react: MsHistogram;
    loops: LoopRate;
    /** Share of starter bundles to hold one tick (`hold` start parameter, test only). */
    hold: number;
    /** This tick's starter bundle is being held: its sends queue in `held`. */
    holding: boolean;
    held: Array<{ action: ProgramAction; what?: string }>;
}

const LOG_TAIL = 40;
/** Stamps a mark keeps: 64 events at a 3-tick cadence span about 2 minutes, far beyond any poll interval. */
export const MARK_TAIL = 64;

/** The `hold` start parameter: absent is 0; otherwise a share in [0, 1]. */
function parseHold(value: unknown): number {
    if (value === undefined) return 0;
    if (typeof value !== 'number' || !(value >= 0 && value <= 1)) throw new Error(`hold must be a share of starters in [0, 1], got ${JSON.stringify(value)}`);
    return value;
}

export class ProgramRuntime {
    private readonly registry = new Map<string, ProgramFactory>();
    private run: Run | null = null;
    /** The last run, kept after it ends so a step script can read its result. */
    private lastStatus: ProgramStatus | null = null;
    private nextRunId = 1;
    private lastState: BotWorldState | null = null;
    private readonly packetsPerTick: number;
    private readonly defaultStallTicks: number;
    private readonly now: () => number;
    private readonly wallNow: () => number;

    constructor(private readonly opts: RuntimeOptions) {
        this.packetsPerTick = opts.packetsPerTick ?? USER_EVENTS_PER_TICK;
        this.defaultStallTicks = opts.stallTicks ?? 60;
        this.now = opts.now ?? (() => performance.now());
        this.wallNow = opts.wallNow ?? (() => Date.now());
    }

    register(name: string, factory: ProgramFactory): this {
        if (!Array.isArray(factory.params)) throw new Error(`program '${name}' declares no parameter keys (set ${factory.name || 'its factory'}.params)`);
        this.registry.set(name, factory);
        return this;
    }

    names(): string[] {
        return [...this.registry.keys()].sort();
    }

    /** The start parameter keys a registered program accepts, the runtime's own included. */
    accepts(name: string): string[] | undefined {
        const factory = this.registry.get(name);
        return factory ? [...factory.params, ...RUNTIME_PARAMS] : undefined;
    }

    get active(): boolean {
        return this.run !== null && !this.run.ended;
    }

    /** The running program's status, else the last one's (null before any start). */
    status(): ProgramStatus | null {
        return this.run ? this.run.status : this.lastStatus;
    }

    start(name: string, params: ProgramParams = {}): ProgramStatus {
        const factory = this.registry.get(name);
        if (!factory) throw new Error(`unknown program '${name}' (have: ${this.names().join(', ')})`);
        if (this.run && !this.run.ended) this.end(this.run, 'replaced');
        const tick = this.lastState?.tick ?? -1;
        const status: ProgramStatus = {
            runId: this.nextRunId++,
            name,
            phase: 'running',
            params,
            startedTick: tick,
            tick,
            progressTick: tick,
            counters: {},
            gauges: {},
            marks: {},
            packets: 0,
            deferred: 0,
            skippedTicks: 0,
            maxTickMs: 0,
            frames: new FrameStats().summary(),
            publish: new FrameStats().summary(),
            react: new MsHistogram(1, 200).summary(),
            loops: new LoopRate().summary()
        };
        const tail: string[] = [];
        const log = (line: string) => this.log(status, line, tail);
        let program: TickProgram;
        let hold: number;
        try {
            const accepted = new Set([...factory.params, ...RUNTIME_PARAMS]);
            const unknown = Object.keys(params).filter(k => !accepted.has(k));
            if (unknown.length) throw new Error(`${name} does not declare ${unknown.join(', ')} (accepts: ${[...accepted].join(', ')})`);
            hold = parseHold(params.hold);
            program = factory(params, { state: this.lastState, log });
        } catch (e) {
            status.phase = 'fault';
            status.fault = `bad parameters: ${e instanceof Error ? e.message : String(e)}`;
            status.endedTick = tick;
            this.run = null;
            this.lastStatus = status;
            this.opts.onEnd?.(status);
            return status;
        }
        const stall = Number(params.stallTicks ?? program.stallTicks);
        this.run = { program, status, stallTicks: Number.isFinite(stall) && stall > 0 ? stall : this.defaultStallTicks, ended: false, tail, frames: new FrameStats(), publish: new FrameStats(), react: new MsHistogram(1, 200), loops: new LoopRate(), hold, holding: false, held: [] };
        log(`start ${JSON.stringify(params)}`);
        return status;
    }

    stop(): ProgramStatus | null {
        if (this.run && !this.run.ended) this.end(this.run, 'stopped');
        return this.status();
    }

    /** Hand data to the running program; throws when none runs, it takes no input, or it refuses this data. */
    input(data: unknown): unknown {
        const run = this.run;
        if (!run || run.ended) throw new Error('no program is running');
        if (!run.program.onInput) throw new Error(`program ${run.status.name} takes no input`);
        const reply = run.program.onInput(data);
        this.log(run.status, `input ${JSON.stringify(data)}`, run.tail);
        return reply;
    }

    /** The overlay action handler: start / stop / status / list. */
    command(cmd: ProgramCommand): ActionResult {
        try {
            switch (cmd.op) {
                case 'start': {
                    if (typeof cmd.name !== 'string') return { success: false, message: 'program start needs a name', phase: 'validation', reason: 'invalid_argument' };
                    const s = this.start(cmd.name, cmd.params ?? {});
                    if (s.phase === 'fault') return { success: false, message: s.fault ?? 'fault', phase: 'validation', reason: 'invalid_argument', data: s };
                    return { success: true, message: `program ${cmd.name} started (run ${s.runId})`, phase: 'dispatch', data: s };
                }
                case 'stop': {
                    const s = this.stop();
                    return { success: true, message: s ? `program ${s.name} ${s.phase}` : 'no program', phase: 'dispatch', data: s };
                }
                case 'status':
                    return { success: true, message: 'program status', data: this.status() };
                case 'list':
                    return { success: true, message: 'programs', data: this.names() };
                case 'input':
                    return { success: true, message: 'program input taken', phase: 'dispatch', data: this.input(cmd.data) };
                default:
                    return { success: false, message: `unknown program op ${(cmd as { op?: unknown }).op}`, phase: 'validation', reason: 'invalid_argument' };
            }
        } catch (e) {
            return { success: false, message: e instanceof Error ? e.message : String(e), phase: 'validation', reason: 'invalid_argument' };
        }
    }

    /**
     * Hand a decoded tick to the running program. Call it after the tick's
     * packets are applied and before the pass flushes (BotOverlay.onGameTick).
     * `arrivals` are the wall times (performance.now()) the frames of the decoded
     * ticks arrived, for the run's cadence statistics.
     */
    onTick(state: BotWorldState, ticksAdvanced = 1, arrivals: readonly number[] = []): void {
        this.lastState = state;
        const run = this.run;
        if (!run || run.ended || !state.inGame) return;
        const st = run.status;
        if (ticksAdvanced > 1) st.skippedTicks += ticksAdvanced - 1;
        st.tick = state.tick;
        if (st.startedTick < 0) {
            st.startedTick = state.tick;
            st.progressTick = state.tick;
        }
        const budget = this.packetsPerTick;
        let sent = 0;
        let events = 0;
        const t0 = this.now();
        const wall = this.wallNow();
        // One PLAYER_INFO, so one arrival, per decoded tick: the last arrival is this tick's frame.
        const frames = arrivals.map((at, i) => ({ tick: state.tick - (arrivals.length - 1 - i), ms: Math.round((wall - (t0 - at)) * 10) / 10 }));
        for (const at of arrivals) run.frames.add(at);
        run.publish.add(t0);
        if (arrivals.length) run.react.add(t0 - arrivals[arrivals.length - 1]!);
        st.frames = run.frames.summary();
        st.publish = run.publish.summary();
        st.react = run.react.summary();
        if (this.opts.loopCount) {
            run.loops.add(t0, this.opts.loopCount());
            st.loops = run.loops.summary();
        }
        const ctx: ProgramContext = {
            state,
            tick: state.tick,
            ticksAdvanced,
            nowMs: t0,
            wallMs: wall,
            frames,
            get budget() {
                return Math.max(0, budget - sent);
            },
            send: (action: ProgramAction, what?: string) => {
                if (run.ended) return false;
                if (run.holding) {
                    // a held bundle reads as sent: the program carries on as if the host were late
                    run.held.push({ action, what });
                    return true;
                }
                if (sent >= budget) {
                    st.deferred++;
                    this.log(st, `T${state.tick} over budget, not sent: ${what ?? action.type}`, run.tail);
                    return false;
                }
                const result = this.opts.dispatch({ ...action, reason: `program ${st.name}` } as BotAction);
                if (result instanceof Promise) {
                    // Only synchronous actions belong in a tick program: an async one
                    // (count dialogs) would finish in some later pass.
                    sent++;
                    events++;
                    st.packets++;
                    void result.catch(() => {});
                    return true;
                }
                if (!result.success) {
                    st.counters.rejected = (st.counters.rejected ?? 0) + 1;
                    this.log(st, `T${state.tick} rejected ${what ?? action.type}: ${result.message}`, run.tail);
                    return false;
                }
                // the user events the client wrote: 2 for a routed op
                const used = typeof result.userEvents === 'number' ? result.userEvents : 1;
                sent++;
                events += used;
                st.packets += used;
                return true;
            },
            count: (name, by = 1) => {
                st.counters[name] = (st.counters[name] ?? 0) + by;
            },
            gauge: (name, value) => {
                st.gauges[name] = value;
            },
            starter: () => {
                if (run.hold <= 0 || run.holding || !((this.opts.random ?? Math.random)() < run.hold)) return;
                run.holding = true;
                st.counters.held = (st.counters.held ?? 0) + 1;
                this.log(st, `T${state.tick} hold: starter bundle held to the next tick`, run.tail);
            },
            mark: name => {
                const m = (st.marks[name] ??= { count: 0, ticks: [] });
                m.count++;
                m.ticks.push(state.tick);
                if (m.ticks.length > MARK_TAIL) m.ticks.shift();
            },
            share: data => {
                st.shared = data;
            },
            progress: () => {
                st.progressTick = state.tick;
            },
            log: line => this.log(st, `T${state.tick} ${line}`, run.tail),
            done: result => {
                if (result !== undefined) st.result = result;
                this.end(run, 'done');
            },
            fault: (reason, detail) => {
                st.fault = reason;
                if (detail !== undefined) st.faultDetail = detail;
                this.end(run, 'fault');
            }
        };
        // last tick's held bundle goes out first, ahead of anything the program sends now
        run.holding = false;
        for (const { action, what } of run.held.splice(0)) ctx.send(action, `${what ?? action.type} (held)`);
        try {
            run.program.onTick(ctx);
        } catch (e) {
            if (!run.ended) {
                st.fault = `exception: ${e instanceof Error ? e.message : String(e)}`;
                st.faultDetail = e instanceof Error ? e.stack : undefined;
                this.end(run, 'fault');
            }
        }
        if (events > budget) {
            st.counters.overBudget = (st.counters.overBudget ?? 0) + 1;
            this.log(st, `T${state.tick} ${events} user events sent: the last ${events - budget} land a tick late`, run.tail);
        }
        const ms = this.now() - t0;
        if (ms > st.maxTickMs) st.maxTickMs = Math.round(ms * 10) / 10;
        if (!run.ended && state.tick - st.progressTick > run.stallTicks) {
            st.fault = `stalled: no progress for ${state.tick - st.progressTick} ticks`;
            this.end(run, 'fault');
        }
    }

    private end(run: Run, why: ProgramEnd): void {
        if (run.ended) return;
        run.ended = true;
        const st = run.status;
        st.phase = why;
        st.endedTick = st.tick;
        if (st.result === undefined && run.program.snapshot) {
            try {
                st.result = run.program.snapshot();
            } catch {
                // a snapshot is a courtesy; the counters are already published
            }
        }
        try {
            run.program.onStop?.(why);
        } catch {
            // ignore: the run is over either way
        }
        this.log(st, `${why}${st.fault ? `: ${st.fault}` : ''}`, run.tail);
        st.logTail = run.tail;
        this.lastStatus = st;
        if (this.run === run) this.run = null;
        this.opts.onEnd?.(st);
    }

    private log(st: ProgramStatus, line: string, tail?: string[]): void {
        st.last = line;
        if (tail) {
            tail.push(line);
            if (tail.length > LOG_TAIL) tail.shift();
        }
        this.opts.log?.(`[program ${st.name}#${st.runId}] ${line}`);
    }
}

/** Parse the `program` overlay action's payload (validated at the boundary: it comes off the wire). */
export function parseProgramCommand(raw: unknown): ProgramCommand | string {
    if (!raw || typeof raw !== 'object') return 'program action needs an object';
    const r = raw as Record<string, unknown>;
    switch (r.op) {
        case 'start':
            if (typeof r.name !== 'string' || !r.name) return 'program start needs a name';
            if (r.params !== undefined && (typeof r.params !== 'object' || r.params === null || Array.isArray(r.params))) return 'program params must be an object';
            return { op: 'start', name: r.name, params: (r.params as ProgramParams | undefined) ?? {} };
        case 'stop':
        case 'status':
        case 'list':
            return { op: r.op };
        case 'input':
            if (r.data === undefined) return 'program input needs data';
            return { op: 'input', data: r.data };
        default:
            return `unknown program op '${String(r.op)}' (start, stop, status, list, input)`;
    }
}
