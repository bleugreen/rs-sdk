// Run-time host gate for the predicted tick-manipulation loops
// (docs/speedrun/skills/tick-manipulation.md, "Run-time host gate").
//
// Every predicted loop assumes a packet sent while state label c is current is processed on
// server tick c+1. `probeOnTime` checks that directly: on a fresh label c the bot walks one
// tile; the server processes the walk and steps the player in the same tick, so the new
// position shows at label c+1 if the packet made it, and at c+2 or later if it was late.
// Trials alternate between the starting tile and a neighbour, each sent on the label that
// showed the previous step (the loops' own send-on-a-fresh-label pattern), and the probe
// ends on the tile it started from. The walks clear the current interaction and close any
// modal, so call it where the loop is about to re-bootstrap anyway.
//
// `HostGate` turns probes into an on/off decision for a loop: probe before the first lock,
// again after the loop reports a lost lock (its xp-drop signal, not a second detector), and
// periodically while off so a host that quietens down gets the manipulation back. The
// decision is a cost model (`gateDecision`: does the predicted knife cycle beat the plain
// one?), overridden by the loop's measured ticks per drop (`drop`).
//
// A constant latency costs nothing: a loop anchored on its own bootstrap send shifts every
// roll by the same amount, and a loop anchored on an observed roll sends `mode - 1` ticks
// early (the lead). What costs is a starter whose latency differs from the dominant one. In
// the cycle loops a starter that lands late writes nothing (the loop has re-armed the clock),
// that roll runs at the plain length, and the fixed 3-tick schedule drifts back into phase
// within three cycles: about one knife cycle lost, no lock lost. So the model takes
// p = `modeFraction` and a miss cost of one knife cycle unless the loop says otherwise.

import type { BotSDK } from '../../sdk/index';
import type { BotWorldState } from '../../sdk/types';
import { tickMs } from './wait';

export type ProbeSdk = Pick<BotSDK, 'getState' | 'onStateUpdate' | 'sendWalk'>;

export interface ProbeOptions {
    /** Counted trials (default 20: about 20 ticks, 6 s at 300 ms, on a quiet host). */
    trials?: number;
    /** A trial with no step after this many ticks is lost (counted, not on time). Default 8. */
    maxWait?: number;
    /** Pre-filter for the neighbour tiles tried, in order +x, -x, +z, -z. */
    walkable?: (x: number, z: number) => boolean;
}

export interface ProbeSummary {
    trials: number;
    onTime: number;
    /** onTime / trials; 0 when no trial ran. */
    fraction: number;
    /** How many ticks late each late trial was (1 = processed on c+2); a lost trial reads maxWait. */
    lateTicks: number[];
    /** Trials per latency in ticks, e.g. {1: 0, 2: 25, 3: 35}. */
    counts: Record<number, number>;
    /** The most common latency (the smaller on a tie); 0 when no trial ran. */
    mode: number;
    /** Share of trials at `mode`: the chance a starter lands on its tick once the loop is in phase. */
    modeFraction: number;
    /** Share of consecutive trials with the same latency (reported; how bursty the jitter is). */
    sameAsPrevious: number;
}

export interface ProbeResult extends ProbeSummary {
    /** Per counted trial: label of the step minus label sent (1 = on time; maxWait+1 = lost). */
    latencies: number[];
    lost: number;
    /** Labels from the probe's start to its end. */
    ticks: number;
    /** Wall-clock gaps between fresh labels, and how long each walk send took to resolve. */
    publishMs: number[];
    sendMs: number[];
    /** Set when the probe could not run its trials (no player, no walkable neighbour). */
    reason?: string;
}

const NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function summarizeProbe(latencies: number[]): ProbeSummary {
    const n = latencies.length;
    const onTime = latencies.filter(l => l <= 1).length;
    const counts: Record<number, number> = {};
    for (const l of latencies) counts[l] = (counts[l] ?? 0) + 1;
    let mode = 0;
    for (const [l, c] of Object.entries(counts)) if (c > (counts[mode] ?? 0) || (c === counts[mode] && Number(l) < mode)) mode = Number(l);
    let same = 0;
    for (let i = 1; i < n; i++) if (latencies[i] === latencies[i - 1]) same++;
    return {
        trials: n,
        onTime,
        fraction: n ? onTime / n : 0,
        lateTicks: latencies.filter(l => l > 1).map(l => l - 1),
        counts,
        mode,
        modeFraction: n ? (counts[mode] ?? 0) / n : 0,
        sameAsPrevious: n > 1 ? same / (n - 1) : 0,
    };
}

/** `1:18 2:2` - a histogram of latencies in ticks, for logs. */
export function latencyHistogram(latencies: number[]): string {
    const h = new Map<number, number>();
    for (const l of latencies) h.set(l, (h.get(l) ?? 0) + 1);
    return [...h].sort((a, b) => a[0] - b[0]).map(([k, c]) => `${k}:${c}`).join(' ');
}

/**
 * Measure how many walk packets land on the tick after the label they were sent on.
 * Rejects if the client stops publishing or relaunches mid-probe.
 */
export function probeOnTime(sdk: ProbeSdk, opts: ProbeOptions = {}): Promise<ProbeResult> {
    const trials = opts.trials ?? 20;
    const maxWait = opts.maxWait ?? 8;
    return new Promise<ProbeResult>((resolve, reject) => {
        const s0 = sdk.getState();
        const empty = (reason: string): ProbeResult => ({ ...summarizeProbe([]), latencies: [], lost: 0, ticks: 0, publishMs: [], sendMs: [], reason });
        if (!s0?.inGame || !s0.player) {
            resolve(empty('not in game'));
            return;
        }
        const home: [number, number] = [s0.player.worldX, s0.player.worldZ];
        const homeKey = `${home[0]},${home[1]}`;
        const dirs = NEIGHBOURS.filter(([dx, dz]) => !opts.walkable || opts.walkable(home[0] + dx, home[1] + dz));
        const latencies: number[] = [];
        const publishMs: number[] = [];
        const sendMs: number[] = [];
        let dir = 0;
        let dirProven = false; // a step toward or from the current neighbour has been seen
        let lost = 0;
        let returning = false;
        let pending: { label: number; from: string } | null = null;
        let lastTick = s0.tick;
        let lastPub = 0;
        let done = false;
        let wall: ReturnType<typeof setTimeout> | undefined;
        const armWall = () => {
            clearTimeout(wall);
            wall = setTimeout(() => fail(new Error(`probeOnTime: no tick after ${lastTick} (client stopped publishing?)`)), (maxWait + 10) * tickMs());
        };
        const stop = () => {
            done = true;
            clearTimeout(wall);
            unsubscribe();
        };
        const fail = (e: Error) => {
            if (done) return;
            stop();
            reject(e);
        };
        const finish = (endTick: number, reason?: string) => {
            if (done) return;
            stop();
            resolve({ ...summarizeProbe(latencies), latencies, lost, ticks: endTick - s0.tick, publishMs, sendMs, ...(reason ? { reason } : {}) });
        };
        const walk = (s: BotWorldState, x: number, z: number) => {
            pending = { label: s.tick, from: `${s.player!.worldX},${s.player!.worldZ}` };
            const t0 = performance.now();
            sdk.sendWalk(x, z, false).then(() => sendMs.push(performance.now() - t0)).catch(() => {});
        };
        const onState = (s: BotWorldState) => {
            if (done || !s?.inGame || !s.player || s.tick === lastTick) return;
            if (s.tick < lastTick) return fail(new Error(`probeOnTime: tick went back from ${lastTick} to ${s.tick} (client relaunched?)`));
            armWall();
            const now = performance.now();
            if (lastPub) publishMs.push(now - lastPub);
            lastPub = now;
            lastTick = s.tick;
            const pos = `${s.player.worldX},${s.player.worldZ}`;
            if (pending) {
                const dt = s.tick - pending.label;
                if (pos !== pending.from) {
                    if (!returning) latencies.push(dt);
                    dirProven = true;
                    pending = null;
                } else if (dt > maxWait) {
                    pending = null;
                    if (returning) return finish(s.tick, 'could not walk back to the start tile');
                    if (dirProven) {
                        latencies.push(maxWait + 1);
                        lost++;
                    } else if (++dir >= dirs.length) {
                        return finish(s.tick, 'no walkable neighbour');
                    }
                } else return;
            }
            if (latencies.length >= trials) {
                if (pos === homeKey) return finish(s.tick);
                returning = true;
                return walk(s, home[0], home[1]);
            }
            if (!dirs.length) return finish(s.tick, 'no walkable neighbour');
            const [dx, dz] = dirs[dir]!;
            if (pos === homeKey) walk(s, home[0] + dx, home[1] + dz);
            else walk(s, home[0], home[1]);
        };
        const unsubscribe = sdk.onStateUpdate(onState);
        armWall();
    });
}

/**
 * What a loop gains and risks, in ticks per roll (tick-manipulation.md, "Run-time host gate").
 * A starter that lands off its tick costs `missCost` on top of the knife cycle.
 */
export interface CycleModel {
    /** The plain loop's ticks per roll (woodcutting 4, fly 5, lobster 6; iron rotation 3.61). */
    plainCycle: number;
    /** The manipulated cycle (3). */
    knifeCycle?: number;
    /**
     * Extra ticks a starter off the dominant latency costs. Default: one knife cycle (the roll it
     * should have started is lost and the schedule re-locks; measured with --inject-late,
     * tick-manipulation.md "Run-time host gate").
     */
    missCost?: number;
}

export interface GateVerdict {
    on: boolean;
    /** Probability a starter lands on its tick, from the probe. */
    p: number;
    /** Predicted ticks per roll with the knife: knifeCycle + (1 - p) * missCost. */
    knife: number;
    plain: number;
    /** Ticks to send early on an xp-anchored schedule: mode - 1. */
    lead: number;
}

/** Manipulate when the predicted knife cycle beats the plain one. A probe with no trials says no. */
export function gateDecision(r: ProbeSummary, model: CycleModel): GateVerdict {
    const knifeCycle = model.knifeCycle ?? 3;
    const missCost = model.missCost ?? knifeCycle;
    const p = r.modeFraction;
    const knife = knifeCycle + (1 - p) * missCost;
    return { on: r.trials > 0 && knife < model.plainCycle, p, knife, plain: model.plainCycle, lead: Math.max(0, r.mode - 1) };
}

/** One probe, one decision. */
export async function shouldManipulate(sdk: ProbeSdk, model: CycleModel, opts: ProbeOptions = {}): Promise<GateVerdict> {
    return gateDecision(await probeOnTime(sdk, opts), model);
}

export interface GateOptions {
    model: CycleModel;
    probe?: ProbeOptions;
    /**
     * Measured override: after this many xp drops in one manipulating stretch, compare its
     * ticks per drop with the plain loop's (`plainTicksPerDrop`, else the last measured plain
     * stretch) and switch off if the knife is not faster. Default 30.
     */
    measureDrops?: number;
    plainTicksPerDrop?: number;
    /** After a measured switch-off, stay off this long before probing again (default 3000). */
    measuredOffTicks?: number;
    /** While off, re-probe this many ticks after the last probe (default 500, 2.5 min at 300 ms). */
    offReprobeTicks?: number;
    /** Never probe again sooner than this after the last probe ended (default 100). */
    minProbeGapTicks?: number;
    log?: (line: string) => void;
}

export interface GateEvent {
    tick: number;
    why: string;
    on: boolean;
    switched: boolean;
    /** Set for probes. */
    result?: ProbeResult;
    verdict?: GateVerdict;
    /** Set for a measured switch-off: ticks per drop of the knife stretch and of plain. */
    measured?: { knife: number; plain: number };
}

/** Ticks per drop over a stretch of xp-drop ticks; NaN below two drops. */
export function ticksPerDrop(drops: number[]): number {
    return drops.length > 1 ? (drops[drops.length - 1]! - drops[0]!) / (drops.length - 1) : Number.NaN;
}

export class HostGate {
    /** Manipulate (true) or run the plain loop (false). False until the first probe. */
    on = false;
    /** Ticks an xp-anchored schedule should send early (mode - 1 of the last probe). */
    lead = 0;
    readonly history: GateEvent[] = [];
    private slipPending = false;
    private lastProbeTick = Number.NEGATIVE_INFINITY;
    private offUntil = Number.NEGATIVE_INFINITY;
    /** xp-drop ticks since the last probe or switch, all in the current mode. */
    private stretch: number[] = [];
    private lastPlainRate = Number.NaN;
    private readonly offReprobeTicks: number;
    private readonly minProbeGapTicks: number;
    private readonly measureDrops: number;
    private readonly measuredOffTicks: number;

    constructor(private readonly sdk: ProbeSdk, private readonly opts: GateOptions) {
        this.offReprobeTicks = opts.offReprobeTicks ?? 500;
        this.minProbeGapTicks = opts.minProbeGapTicks ?? 100;
        this.measureDrops = opts.measureDrops ?? 30;
        this.measuredOffTicks = opts.measuredOffTicks ?? 3000;
    }

    /** The loop's lost-lock signal: a predicted roll whose xp never came. Ignored while off. */
    slip(): void {
        if (this.on) this.slipPending = true;
    }

    /**
     * The loop saw an xp drop on `tick`. While manipulating, once `measureDrops` drops are in,
     * switch off if the stretch is not faster than plain. Returns true when it switched.
     */
    drop(tick: number): boolean {
        this.stretch.push(tick);
        if (!this.on) {
            if (this.stretch.length >= this.measureDrops) this.lastPlainRate = ticksPerDrop(this.stretch);
            return false;
        }
        if (this.stretch.length < this.measureDrops) return false;
        const knife = ticksPerDrop(this.stretch);
        const plain = this.opts.plainTicksPerDrop ?? this.lastPlainRate;
        if (!(knife >= plain)) return false;
        this.on = false;
        this.offUntil = tick + this.measuredOffTicks;
        this.stretch = [];
        this.history.push({ tick, why: 'measured', on: false, switched: true, measured: { knife, plain } });
        this.opts.log?.(`T${tick} gate (measured): knife ${knife.toFixed(2)} ticks per drop over ${this.measureDrops} drops, plain ${plain.toFixed(2)} -> SWITCH manipulate -> plain`);
        return true;
    }

    /**
     * Whether the loop should call `probe` at `tick`: before the first probe, after a slip
     * while on, and every `offReprobeTicks` while off (after a measured switch-off, not before
     * `measuredOffTicks`); never within `minProbeGapTicks` of the last probe.
     */
    due(tick: number): boolean {
        if (!this.history.length) return true;
        if (tick - this.lastProbeTick < this.minProbeGapTicks) return false;
        if (this.on) return this.slipPending;
        return tick >= this.offUntil && tick - this.lastProbeTick >= this.offReprobeTicks;
    }

    async probe(why: string): Promise<boolean> {
        const was = this.on;
        const first = !this.history.length;
        const result = await probeOnTime(this.sdk, this.opts.probe);
        const tick = this.sdk.getState()?.tick ?? -1;
        const verdict = gateDecision(result, this.opts.model);
        this.on = verdict.on;
        this.lead = verdict.lead;
        this.slipPending = false;
        this.lastProbeTick = tick;
        this.stretch = [];
        const switched = !first && was !== this.on;
        this.history.push({ tick, why, on: this.on, switched, result, verdict });
        const mode = (on: boolean) => (on ? 'manipulate' : 'plain');
        this.opts.log?.(
            `T${tick} gate (${why}): latency ${latencyHistogram(result.latencies) || '-'} of ${result.trials}` +
                `${result.reason ? ` (${result.reason})` : ''}, same as previous ${result.sameAsPrevious.toFixed(2)}, in ${result.ticks} ticks;` +
                ` p ${verdict.p.toFixed(2)}, predicted knife ${verdict.knife.toFixed(2)} vs plain ${verdict.plain.toFixed(2)}, lead ${verdict.lead} -> ` +
                (switched ? `SWITCH ${mode(was)} -> ${mode(this.on)}` : mode(this.on))
        );
        return this.on;
    }

    /** Ticks spent with the gate off, from the first probe to `now`. */
    plainTicks(now: number): number {
        let total = 0;
        let offSince: number | null = null;
        for (const h of this.history) {
            if (!h.on && offSince === null) offSince = h.tick;
            if (h.on && offSince !== null) {
                total += h.tick - offSince;
                offSince = null;
            }
        }
        return offSince === null ? total : total + Math.max(0, now - offSince);
    }

    /** `T120 plain->manipulate T880 manipulate->plain` for summaries. */
    switches(): string {
        return this.history.filter(h => h.switched).map(h => `T${h.tick} ${h.on ? 'plain->manipulate' : 'manipulate->plain'}${h.why === 'measured' ? ' (measured)' : ''}`).join(' ');
    }

    /** `T122 start 1:20, T900 slip 1:18 2:2, T1400 measured` for summaries. */
    summary(): string {
        return this.history.map(h => `T${h.tick} ${h.why}${h.result ? ` ${latencyHistogram(h.result.latencies) || '-'}` : ''}`).join(', ');
    }
}
