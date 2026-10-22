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
// The probe runs over anything with `getState`, `onStateUpdate` and `sendWalk`: the SDK (the
// relay path: runner, gateway, lite client) or `direct.ts`'s adapter over the engine
// websocket (the direct path). The adapter says which path it is, and the result records it.
// While it runs, the probe records when each tick arrived (the adapter stamps the socket
// message; otherwise the publication time) and scores the stream's steadiness: interval p90,
// a 50 ms histogram, and catch-up ticks (`tickSteadiness`).
//
// `HostGate` turns probes into an on/off decision for a loop: probe before the first lock,
// again after the loop reports a lost lock (its xp-drop signal, not a second detector), and
// periodically while off so a host that quietens down gets the manipulation back. The
// decision follows the probe's path (`hostgate-verdict.ts`): on the direct path, the run's
// go/no-go (on time at least 58 of 60, tick p90, catch-ups, loop rate); on the relay path, a
// cost model (`gateDecision`: does the predicted knife cycle beat the plain one?). Either is
// overridden by the loop's measured ticks per drop (`drop`).
//
// `measureVantage` reads the preconditions for the direct path (Fly edge and TCP connect),
// which `vantageDecision` checks before anything logs in.
//
// The tick length T that (b) and (c) are read at comes from `resolveTickLength`: an explicit
// value (the CLI's --tick-ms), else the engine's spectator feed hello (`feedTickMs`, no login),
// else the probe's own median interval rounded to 50 ms (tickSteadiness). Never wait.ts
// `tickMs()`, whose fallback (DEMO_TICK_MS) is a default, not a reading.
//
// A constant latency costs nothing: a loop anchored on its own bootstrap send shifts every
// roll by the same amount, and a loop anchored on an observed roll sends `mode - 1` ticks
// early (the lead). What costs is a starter whose latency differs from the dominant one. In
// the cycle loops a starter that lands late writes nothing (the loop has re-armed the clock),
// that roll runs at the plain length, and the fixed 3-tick schedule drifts back into phase:
// no lock is lost, and the measured cost is about one plain cycle (willow 3.2 ticks, fly 5.3,
// with --inject-late). So the model takes p = `modeFraction` and a miss cost of one plain
// cycle unless the loop says otherwise.

import { spawnSync } from 'node:child_process';
import { type CycleModel, type DirectRule, type HostVerdict, hostVerdict, latencyHistogram, type ProbePath, type ProbeSummary, steadinessHistogram, summarizeProbe, type TickLength, type TickSteadiness, tickSteadiness, validTickMs, type VantageReading, verdictText } from './hostgate-verdict';
import { idleBoundMs } from './wait';

export * from './hostgate-verdict';

/** The part of a state the probe reads. `BotWorldState` has it. */
export interface ProbeState {
    tick: number;
    inGame: boolean;
    player: { worldX: number; worldZ: number } | null;
    /**
     * `performance.now()` when the socket message that completed this tick arrived. The direct
     * adapter sets it; without it the probe stamps the state's publication instead.
     */
    arrivalMs?: number;
}

/** What the probe drives: the SDK (relay), or `direct.ts`'s adapter, which sets `path: 'direct'`. */
export interface ProbeSdk {
    /** Absent means the SDK, the relay path. */
    readonly path?: ProbePath;
    getState(): ProbeState | null;
    onStateUpdate(listener: (s: ProbeState) => void): () => void;
    sendWalk(x: number, z: number, running?: boolean): Promise<unknown>;
}

export interface ProbeOptions {
    /** Counted trials (default 20: about 20 ticks on a quiet host). */
    trials?: number;
    /** A trial with no step after this many ticks is lost (counted, not on time). Default 8. */
    maxWait?: number;
    /** Pre-filter for the neighbour tiles tried, in order +x, -x, +z, -z. */
    walkable?: (x: number, z: number) => boolean;
    /**
     * After the trials, keep reading tick arrivals until they span this long, so steadiness
     * is scored over a whole probe minute (the run-night gate passes 60000). Default 0.
     */
    steadyMs?: number;
    /** The server's tick length for the steadiness (`resolveTickLength`); absent: the probe's median interval. */
    tick?: TickLength | null;
}

export interface ProbeResult extends ProbeSummary {
    /** The path the probe's packets took, from the probed object (`ProbeSdk.path`). */
    path: ProbePath;
    /** Per counted trial: label of the step minus label sent (1 = on time; maxWait+1 = lost). */
    latencies: number[];
    lost: number;
    /** Labels from the probe's start to its end. */
    ticks: number;
    /**
     * When each tick label arrived (`performance.now()` ms, one entry per label: a state that
     * moved the label by two adds two entries with one time), and its steadiness.
     */
    tickArrivals: number[];
    steadiness: TickSteadiness;
    /** How long each walk send took to resolve, ms. */
    sendMs: number[];
    /** Set when the probe could not run its trials (no player, no walkable neighbour). */
    reason?: string;
}

const NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * Measure how many walk packets land on the tick after the label they were sent on.
 * Rejects if the client stops publishing or relaunches mid-probe.
 */
export function probeOnTime(sdk: ProbeSdk, opts: ProbeOptions = {}): Promise<ProbeResult> {
    const trials = opts.trials ?? 20;
    const maxWait = opts.maxWait ?? 8;
    const steadyMs = opts.steadyMs ?? 0;
    const path = sdk.path ?? 'relay';
    return new Promise<ProbeResult>((resolve, reject) => {
        const s0 = sdk.getState();
        const empty = (reason: string): ProbeResult => ({ ...summarizeProbe([]), path, latencies: [], lost: 0, ticks: 0, tickArrivals: [], steadiness: tickSteadiness([], opts.tick), sendMs: [], reason });
        if (!s0?.inGame || !s0.player) {
            resolve(empty('not in game'));
            return;
        }
        const home: [number, number] = [s0.player.worldX, s0.player.worldZ];
        const homeKey = `${home[0]},${home[1]}`;
        const dirs = NEIGHBOURS.filter(([dx, dz]) => !opts.walkable || opts.walkable(home[0] + dx, home[1] + dz));
        const latencies: number[] = [];
        const tickArrivals: number[] = [];
        const sendMs: number[] = [];
        let dir = 0;
        let dirProven = false; // a step toward or from the current neighbour has been seen
        let lost = 0;
        let returning = false;
        let settling = false; // trials done and home; reading arrivals until steadyMs
        let pending: { label: number; from: string } | null = null;
        let lastTick = s0.tick;
        let done = false;
        const span = () => (tickArrivals.length > 1 ? tickArrivals[tickArrivals.length - 1]! - tickArrivals[0]! : 0);
        let wall: ReturnType<typeof setTimeout> | undefined;
        const armWall = () => {
            clearTimeout(wall);
            wall = setTimeout(() => fail(new Error(`probeOnTime: no tick after ${lastTick} (client stopped publishing?)`)), idleBoundMs({ ticks: maxWait + 10 }));
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
            resolve({ ...summarizeProbe(latencies), path, latencies, lost, ticks: endTick - s0.tick, tickArrivals, steadiness: tickSteadiness(tickArrivals, opts.tick), sendMs, ...(reason ? { reason } : {}) });
        };
        const trialsDone = (tick: number) => {
            if (span() >= steadyMs) return finish(tick);
            settling = true;
        };
        const walk = (s: ProbeState, x: number, z: number) => {
            pending = { label: s.tick, from: `${s.player!.worldX},${s.player!.worldZ}` };
            const t0 = performance.now();
            sdk.sendWalk(x, z, false).then(() => sendMs.push(performance.now() - t0)).catch(() => {});
        };
        const onState = (s: ProbeState) => {
            if (done || !s?.inGame || !s.player || s.tick === lastTick) return;
            if (s.tick < lastTick) return fail(new Error(`probeOnTime: tick went back from ${lastTick} to ${s.tick} (client relaunched?)`));
            armWall();
            const at = s.arrivalMs ?? performance.now();
            // the first fresh label after s0 has no known start: one entry, then one per label
            for (let k = tickArrivals.length ? s.tick - lastTick : 1; k > 0; k--) tickArrivals.push(at);
            lastTick = s.tick;
            if (settling) {
                if (span() >= steadyMs) finish(s.tick);
                return;
            }
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
                if (pos === homeKey) return trialsDone(s.tick);
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
 * Read the vantage preconditions from this machine, as rs/86's workflow does: one request
 * with `flyio-debug: doit` for Fly's routing fields, then `samples` fresh connections
 * `gapMs` apart (not a burst) for TCP connect, and `/playercount`. Needs curl on PATH.
 */
export async function measureVantage(host: string, opts: { samples?: number; gapMs?: number } = {}): Promise<VantageReading> {
    const samples = opts.samples ?? 20;
    const gapMs = opts.gapMs ?? 1000;
    const url = `https://${host}/cairn-vantage-probe-${Date.now()}`;
    const curl = (args: string[]) => spawnSync('curl', ['-s', '-o', '/dev/null', '-m', '10', ...args, url], { encoding: 'utf8' }).stdout ?? '';
    let fly: Record<string, unknown> = {};
    try {
        fly = JSON.parse(/^flyio-debug:\s*(.*)$/im.exec(curl(['-D', '-', '-H', 'flyio-debug: doit']))?.[1] ?? '{}');
    } catch {}
    const connectMs: number[] = [];
    for (let i = 0; i < samples; i++) {
        const t = Number(curl(['-w', '%{time_connect}']));
        if (t > 0) connectMs.push(Math.round(t * 1e4) / 10);
        if (i < samples - 1) await new Promise(r => setTimeout(r, gapMs));
    }
    let players: number | null = null;
    try {
        const j = (await (await fetch(`https://${host}/playercount`, { signal: AbortSignal.timeout(5000) })).json()) as { count?: number };
        players = typeof j.count === 'number' ? j.count : null;
    } catch {}
    const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
    return { edge: str(fly.nr), app: str(fly.sr), meshHop: str(fly.mhn), connectMs, players };
}

/**
 * The engine's configured tick length from its spectator feed (server/engine/src/web/worldfeed.ts):
 * the hello frame it sends on connect carries `tickMs` (World.tickRate). No login and no
 * subscription; the socket closes on the hello. Null when no usable hello arrives within
 * `timeoutMs`. wss:// for a remote host, ws:// for localhost.
 */
export function feedTickMs(host: string, opts: { timeoutMs?: number; socket?: (url: string) => WebSocket } = {}): Promise<number | null> {
    const local = host.startsWith('localhost') || host.startsWith('127.');
    const url = `${local ? 'ws' : 'wss'}://${host}/worldfeed`;
    return new Promise(resolve => {
        let ws: WebSocket;
        try {
            ws = (opts.socket ?? (u => new WebSocket(u)))(url);
        } catch {
            resolve(null);
            return;
        }
        let settled = false;
        const done = (v: number | null) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try {
                ws.close();
            } catch {}
            resolve(v);
        };
        const timer = setTimeout(() => done(null), opts.timeoutMs ?? 5000);
        ws.onmessage = event => {
            try {
                const m = JSON.parse(String(event.data)) as { t?: unknown; tickMs?: unknown };
                if (m.t === 'hello') done(validTickMs(m.tickMs));
            } catch {}
        };
        ws.onerror = () => done(null);
        ws.onclose = () => done(null);
    });
}

/**
 * The gate's tick length T: `explicitMs` (the CLI's --tick-ms) when given, else the feed hello's
 * `tickMs` from `host`, else null, which leaves T to the probe's median interval
 * (tickSteadiness, source `median`). Throws on an explicit value that is not a tick length.
 */
export async function resolveTickLength(opts: { explicitMs?: number; host?: string; feed?: (host: string) => Promise<number | null> }): Promise<TickLength | null> {
    if (opts.explicitMs !== undefined) {
        const T = validTickMs(opts.explicitMs);
        if (T === null) throw new Error(`--tick-ms must be a tick length in ms above 0, not ${opts.explicitMs}`);
        return { T, source: 'flag' };
    }
    if (!opts.host) return null;
    const T = await (opts.feed ?? feedTickMs)(opts.host).catch(() => null);
    return T !== null ? { T, source: 'feed' } : null;
}

/** One probe, one decision, by the probe's path. */
export async function shouldManipulate(sdk: ProbeSdk, model: CycleModel, opts: ProbeOptions = {}, direct?: DirectRule): Promise<HostVerdict> {
    return hostVerdict(await probeOnTime(sdk, opts), model, direct);
}

export interface GateOptions {
    /** The relay path's cost model. */
    model: CycleModel;
    /** The direct path's criterion (default 60 of 60, floor 58). */
    direct?: DirectRule;
    probe?: ProbeOptions;
    /**
     * The probe to run in place of `probeOnTime(sdk, probe)`: `probeInPage` for an in-page
     * loop (`gated-program.ts` `inPageGate`). `probe` is not passed to it.
     */
    probeWith?: () => Promise<ProbeResult>;
    /**
     * Measured override: after this many xp drops in one manipulating stretch, compare its
     * ticks per drop with the plain loop's (`plainTicksPerDrop`, else the last measured plain
     * stretch) and switch off if the knife is not faster. Default 120.
     *
     * The comparison is a sample mean. At a success chance of 0.5 to 0.65 per roll, a 30-drop
     * mean is good to about ±13%, wider than the knife's margin over plain, so an honest knife
     * gets switched off by bad luck alone, and each false switch-off holds plain for
     * `measuredOffTicks` (measured in the lab at about 850 ticks lost). A 120-drop mean is good
     * to about ±6%. A loop with a lower success chance is noisier and wants more drops.
     */
    measureDrops?: number;
    plainTicksPerDrop?: number;
    /**
     * The measured switch-off fires unless the knife stretch is at least this share faster
     * than plain: knife >= plain * (1 - measuredMargin). Default 0, not faster at all.
     */
    measuredMargin?: number;
    /** After a measured switch-off, stay off this long before probing again (default 3000). */
    measuredOffTicks?: number;
    /** While off, re-probe this many ticks after the last probe (default 500). */
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
    verdict?: HostVerdict;
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
    /** xp-drop ticks since the last probe or switch, all in the current mode, and the rolls each stands for. */
    private stretch: number[] = [];
    private stretchRolls: number[] = [];
    private lastPlainRate = Number.NaN;
    private readonly offReprobeTicks: number;
    private readonly minProbeGapTicks: number;
    private readonly measureDrops: number;
    private readonly measuredOffTicks: number;

    constructor(private readonly sdk: ProbeSdk, private readonly opts: GateOptions) {
        this.offReprobeTicks = opts.offReprobeTicks ?? 500;
        this.minProbeGapTicks = opts.minProbeGapTicks ?? 100;
        this.measureDrops = opts.measureDrops ?? 120;
        this.measuredOffTicks = opts.measuredOffTicks ?? 3000;
    }

    /** The loop's lost-lock signal: a predicted roll whose xp never came. Ignored while off. */
    slip(): void {
        if (this.on) this.slipPending = true;
    }

    /**
     * The loop saw an xp drop on `tick`. While manipulating, once `measureDrops` drops are in,
     * switch off if the stretch is not faster than plain. Returns true when it switched.
     * `rolls` is how many rolls the drop stands for (1 / success chance, for a stretch in ticks
     * per expected roll; `plainTicksPerDrop` is then per roll too). Default 1: ticks per drop.
     */
    drop(tick: number, rolls = 1): boolean {
        this.stretch.push(tick);
        this.stretchRolls.push(rolls);
        if (!this.on) {
            if (this.stretch.length >= this.measureDrops) this.lastPlainRate = this.stretchRate();
            return false;
        }
        if (this.stretch.length < this.measureDrops) return false;
        const knife = this.stretchRate();
        const plain = this.opts.plainTicksPerDrop ?? this.lastPlainRate;
        if (!(knife >= plain * (1 - (this.opts.measuredMargin ?? 0)))) return false;
        this.on = false;
        this.offUntil = tick + this.measuredOffTicks;
        this.stretch = [];
        this.stretchRolls = [];
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

    /** Ticks per roll over the stretch: its span over the rolls after its first drop (`ticksPerDrop` when each is 1). */
    private stretchRate(): number {
        if (this.stretch.length < 2) return Number.NaN;
        let rolls = 0;
        for (let i = 1; i < this.stretchRolls.length; i++) rolls += this.stretchRolls[i]!;
        return (this.stretch[this.stretch.length - 1]! - this.stretch[0]!) / rolls;
    }

    async probe(why: string): Promise<boolean> {
        const was = this.on;
        const first = !this.history.length;
        const result = await (this.opts.probeWith ? this.opts.probeWith() : probeOnTime(this.sdk, this.opts.probe));
        const tick = this.sdk.getState()?.tick ?? -1;
        const verdict = hostVerdict(result, this.opts.model, this.opts.direct);
        this.on = verdict.on;
        this.lead = verdict.lead;
        this.slipPending = false;
        this.lastProbeTick = tick;
        this.stretch = [];
        this.stretchRolls = [];
        const switched = !first && was !== this.on;
        this.history.push({ tick, why, on: this.on, switched, result, verdict });
        const mode = (on: boolean) => (on ? 'manipulate' : 'plain');
        const st = result.steadiness;
        this.opts.log?.(
            `T${tick} gate (${why}${result.path === 'direct' ? ', direct' : ''}): latency ${latencyHistogram(result.latencies) || '-'} of ${result.trials}` +
                `${result.reason ? ` (${result.reason})` : ''}, same as previous ${result.sameAsPrevious.toFixed(2)}, in ${result.ticks} ticks;` +
                ` ticks p50 ${st.p50} p90 ${st.p90} max ${st.max} ms, T ${st.T ?? '?'} (${st.TSource ?? 'none'}), ${st.catchUps} catch-ups (${steadinessHistogram(st) || '-'});` +
                ` ${verdictText(verdict)} -> ` +
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
