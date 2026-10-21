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
// periodically while off so a host that quietens down gets the manipulation back.

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
    const onTime = latencies.filter(l => l <= 1).length;
    return {
        trials: latencies.length,
        onTime,
        fraction: latencies.length ? onTime / latencies.length : 0,
        lateTicks: latencies.filter(l => l > 1).map(l => l - 1),
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
 * Default 0.95: at most one late trial in 20. A host like rs/53's quiet one (110 of 110 on
 * time) passes nearly always, a host with half its packets late essentially never, and
 * demanding 20 of 20 would switch the knife off on a host losing 3% of packets about half
 * the time (tick-manipulation.md, "Run-time host gate").
 */
export const DEFAULT_THRESHOLD = 0.95;

export function gateDecision(r: ProbeSummary, threshold: number = DEFAULT_THRESHOLD): boolean {
    return r.trials > 0 && r.fraction >= threshold;
}

/** One probe, one decision: true when the host lands packets on time often enough to manipulate. */
export async function shouldManipulate(sdk: ProbeSdk, opts: ProbeOptions & { threshold?: number } = {}): Promise<boolean> {
    return gateDecision(await probeOnTime(sdk, opts), opts.threshold ?? DEFAULT_THRESHOLD);
}

export interface GateOptions {
    threshold?: number;
    probe?: ProbeOptions;
    /** While off, re-probe this many ticks after the last probe (default 500, 2.5 min at 300 ms). */
    offReprobeTicks?: number;
    /** Never probe again sooner than this after the last probe ended (default 100). */
    minProbeGapTicks?: number;
    log?: (line: string) => void;
}

export interface GateProbe {
    tick: number;
    why: string;
    on: boolean;
    switched: boolean;
    result: ProbeResult;
}

export class HostGate {
    /** Manipulate (true) or run the plain loop (false). False until the first probe. */
    on = false;
    readonly history: GateProbe[] = [];
    private slipPending = false;
    private lastProbeTick = Number.NEGATIVE_INFINITY;
    private readonly threshold: number;
    private readonly offReprobeTicks: number;
    private readonly minProbeGapTicks: number;

    constructor(private readonly sdk: ProbeSdk, private readonly opts: GateOptions = {}) {
        this.threshold = opts.threshold ?? DEFAULT_THRESHOLD;
        this.offReprobeTicks = opts.offReprobeTicks ?? 500;
        this.minProbeGapTicks = opts.minProbeGapTicks ?? 100;
    }

    /** The loop's lost-lock signal: a predicted roll whose xp never came. Ignored while off. */
    slip(): void {
        if (this.on) this.slipPending = true;
    }

    /**
     * Whether the loop should call `probe` at `tick`: before the first probe, after a slip
     * while on, and every `offReprobeTicks` while off; never within `minProbeGapTicks` of
     * the last probe.
     */
    due(tick: number): boolean {
        if (!this.history.length) return true;
        if (tick - this.lastProbeTick < this.minProbeGapTicks) return false;
        return this.on ? this.slipPending : tick - this.lastProbeTick >= this.offReprobeTicks;
    }

    async probe(why: string): Promise<boolean> {
        const was = this.on;
        const first = !this.history.length;
        const result = await probeOnTime(this.sdk, this.opts.probe);
        const tick = this.sdk.getState()?.tick ?? -1;
        this.on = gateDecision(result, this.threshold);
        this.slipPending = false;
        this.lastProbeTick = tick;
        const switched = !first && was !== this.on;
        this.history.push({ tick, why, on: this.on, switched, result });
        const mode = (on: boolean) => (on ? 'manipulate' : 'plain');
        this.opts.log?.(
            `T${tick} gate (${why}): ${result.onTime}/${result.trials} on time, latency ${latencyHistogram(result.latencies) || '-'}` +
                `${result.reason ? ` (${result.reason})` : ''}, ${result.ticks} ticks -> ` +
                (switched ? `SWITCH ${mode(was)} -> ${mode(this.on)}` : mode(this.on))
        );
        return this.on;
    }

    /** `T120 plain->manipulate T880 manipulate->plain` for summaries. */
    switches(): string {
        return this.history.filter(h => h.switched).map(h => `T${h.tick} ${h.on ? 'plain->manipulate' : 'manipulate->plain'}`).join(' ');
    }
}
