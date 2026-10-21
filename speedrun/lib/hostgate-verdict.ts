// The run-time host gate's decision rules (docs/speedrun/skills/tick-manipulation.md,
// "Run-time host gate"). This module imports nothing and touches no Node, Bun, DOM or SDK
// global, so the in-page tick programs in the browser webclient can call the same functions
// as the SDK-side gate. `hostgate.ts` holds the probe, the vantage measurement and the
// HostGate state machine, and re-exports everything here.
//
// The probe's path picks the rule:
// - direct: the reaction is issued in-page by the browser webclient, or in-process on the
//   engine websocket, with no relay hop. The go/no-go measured on the run machine, with
//   main's 2026-10-21 defaults: pass lines (a) on-time trials at least 58 of 60, (c) at most 2
//   catch-up ticks per minute, (d) the page's game-loop rate p10 at least 50 per second; and
//   (b) tick arrival p90 at most 400 ms, reported but not a pass line unless the rule says so
//   (it agreed with (a) less often than (c) did). Failing (c) is an overrun period on the
//   demo: wait and re-measure. Failing (d) is a throttled tab. Failing (a) alone is a broken
//   host or client to investigate, not a cost to model.
// - relay (runner, gateway, lite client): the dominant-offset cost model, `gateDecision`.
// Before either, `vantageDecision` checks that the machine sits beside the app.

export type ProbePath = 'direct' | 'relay';

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

/** Summarize per-trial latencies in ticks (label of the step minus label sent; 1 = on time). */
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

// ------------------------------------------------------------------ tick steadiness

/**
 * A catch-up is an interval under `underMs` immediately after one over `afterOverMs`: the
 * server overran a tick and, on its fixed 300 ms grid, ran the next one at once. A reaction
 * to the long tick then misses about half the time (demo-latency.md, rs/102).
 */
export const CATCH_UP = { underMs: 150, afterOverMs: 350 } as const;

/** Width of the interval histogram's buckets. */
export const STEADINESS_BUCKET_MS = 50;

export interface TickSteadiness {
    /** Intervals between consecutive tick arrivals. */
    n: number;
    /** First arrival to last. */
    spanMs: number;
    p10: number;
    p50: number;
    p90: number;
    max: number;
    over350: number;
    under150: number;
    catchUps: number;
    /**
     * Catch-ups per minute of arrivals. A window shorter than a minute counts as one minute,
     * so its raw count stands against the per-minute limit.
     */
    catchUpsPerMinute: number;
    /** Intervals per 50 ms bucket, keyed by the bucket's lower edge: {250: 31, 300: 24}. */
    histogram: Record<number, number>;
}

/**
 * Steadiness of a tick stream from its arrival times (ms, one entry per tick label, in
 * order). Two ticks decoded from one socket read carry the same time, so their interval is
 * 0. Feed it raw per-tick arrivals: grouping frames into windows (frameStats' 60 ms, or the
 * under-200 count) merges a catch-up tick into the tick before it and hides exactly these.
 */
export function tickSteadiness(arrivals: readonly number[]): TickSteadiness {
    const iv: number[] = [];
    for (let i = 1; i < arrivals.length; i++) iv.push(arrivals[i]! - arrivals[i - 1]!);
    const sorted = [...iv].sort((a, b) => a - b);
    const q = (p: number) => (sorted.length ? round1(sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!) : 0);
    const histogram: Record<number, number> = {};
    for (const v of iv) {
        const b = Math.floor(v / STEADINESS_BUCKET_MS) * STEADINESS_BUCKET_MS;
        histogram[b] = (histogram[b] ?? 0) + 1;
    }
    const catchUps = iv.filter((v, i) => i > 0 && v < CATCH_UP.underMs && iv[i - 1]! > CATCH_UP.afterOverMs).length;
    const spanMs = arrivals.length > 1 ? arrivals[arrivals.length - 1]! - arrivals[0]! : 0;
    return {
        n: iv.length,
        spanMs: round1(spanMs),
        p10: q(0.1),
        p50: q(0.5),
        p90: q(0.9),
        max: sorted.length ? round1(sorted[sorted.length - 1]!) : 0,
        over350: iv.filter(v => v > CATCH_UP.afterOverMs).length,
        under150: iv.filter(v => v < CATCH_UP.underMs).length,
        catchUps,
        catchUpsPerMinute: Math.round(((catchUps * 60_000) / Math.max(spanMs, 60_000)) * 100) / 100,
        histogram,
    };
}

/** `250:31 300:24 450:2` - the interval histogram, for logs. */
export function steadinessHistogram(s: Pick<TickSteadiness, 'histogram'>): string {
    return Object.entries(s.histogram)
        .map(([k, c]) => [Number(k), c] as const)
        .sort((a, b) => a[0] - b[0])
        .map(([k, c]) => `${k}:${c}`)
        .join(' ');
}

const round1 = (v: number) => Math.round(v * 10) / 10;

// ------------------------------------------------------------------ vantage preconditions

/** Where the machine reaches the demo from: Fly's routing header and fresh TCP connects. */
export interface VantageReading {
    /** `flyio-debug` `nr`: the Fly edge region the machine enters at. */
    edge: string | null;
    /** `flyio-debug` `sr`: the app's region. */
    app: string | null;
    /** `flyio-debug` `mhn`: set when the edge forwards to the app over Fly's mesh. */
    meshHop: string | null;
    /** TCP connect times of fresh connections, ms. */
    connectMs: number[];
    /** `GET /playercount`, recorded beside the verdict. */
    players?: number | null;
}

export interface VantageRule {
    /** Required edge and app region (default iad, Ashburn). 'any' disables either check. */
    edge?: string;
    app?: string;
    /** Default 5: Ashburn reads 2-4 ms; a Quebec runner on the iad edge read 24 and missed 4 of 60. */
    maxConnectP50Ms?: number;
}

export const VANTAGE_RULE = { edge: 'iad', app: 'iad', maxConnectP50Ms: 5 } as const;

export interface VantageVerdict {
    ok: boolean;
    edge: string | null;
    app: string | null;
    meshHop: string | null;
    connectP50: number | null;
    players: number | null;
    /** One line per failed precondition, by name. */
    failures: string[];
}

/** The preconditions for a direct probe: run it only when these pass. */
export function vantageDecision(v: VantageReading, rule: VantageRule = {}): VantageVerdict {
    const edge = rule.edge ?? VANTAGE_RULE.edge;
    const app = rule.app ?? VANTAGE_RULE.app;
    const maxConnect = rule.maxConnectP50Ms ?? VANTAGE_RULE.maxConnectP50Ms;
    const sorted = [...v.connectMs].sort((a, b) => a - b);
    const connectP50 = sorted.length ? round1(sorted[Math.floor(0.5 * sorted.length)]!) : null;
    const failures: string[] = [];
    if (edge !== 'any' && v.edge !== edge) failures.push(`Fly edge is '${v.edge ?? 'unknown'}', not '${edge}'`);
    if (app !== 'any' && v.app !== app) failures.push(`app region is '${v.app ?? 'unknown'}', not '${app}'`);
    if (v.meshHop) failures.push(`the edge forwards over Fly's mesh (${v.meshHop}): not beside the app`);
    if (connectP50 === null) failures.push('no TCP connect samples');
    else if (connectP50 > maxConnect) failures.push(`TCP connect p50 ${connectP50} ms, over ${maxConnect}`);
    return { ok: failures.length === 0, edge: v.edge, app: v.app, meshHop: v.meshHop, connectP50, players: v.players ?? null, failures };
}

// ------------------------------------------------------------------ relay rule

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
     * Extra ticks a starter off the dominant latency costs. Default: one plain cycle (measured
     * with --inject-late: willow 3.2, fly 5.3; tick-manipulation.md "Run-time host gate").
     * The closed-loop mining executor loses only the late tick: 1.
     */
    missCost?: number;
}

/** The relay path's verdict: the cost model. */
export interface GateVerdict {
    path: 'relay';
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
    const missCost = model.missCost ?? model.plainCycle;
    const p = r.modeFraction;
    const knife = knifeCycle + (1 - p) * missCost;
    return { path: 'relay', on: r.trials > 0 && knife < model.plainCycle, p, knife, plain: model.plainCycle, lead: Math.max(0, r.mode - 1) };
}

// ------------------------------------------------------------------ direct rule

/** The direct path's limits; every one is configurable, and the defaults are `DIRECT_RULE`. */
export interface DirectRule {
    /** (a) `pass` and `floor` are on-time trials out of `trials`. */
    trials?: number;
    pass?: number;
    floor?: number;
    /** (b) Tick arrival interval p90 over the probe window. */
    maxTickP90Ms?: number;
    /** Make (b) a pass line (failing it reads re-measure). Default false: (b) is reported only. */
    tickP90PassLine?: boolean;
    /** (c) Catch-ups per minute over the probe window (rs/102 calibrates the final value). */
    maxCatchUpsPerMinute?: number;
    /** (d) The page's game-loop rate p10 over the probe window, loops per second. */
    minLoopRateP10?: number;
}

export const DIRECT_RULE = { trials: 60, pass: 60, floor: 58, maxTickP90Ms: 400, tickP90PassLine: false, maxCatchUpsPerMinute: 2, minLoopRateP10: 50 } as const;

/**
 * What the direct rule reads. A `ProbeResult` from `probeOnTime` is one (it carries its own
 * steadiness); in-page code passes its probe's counts, its frame summary (`p90`,
 * `catchUpsPerMinute` over the probe minute) and its loop rate.
 */
export interface DirectEvidence {
    onTime: number;
    trials: number;
    /** Tick arrivals over the probe window; absent or null reads (b) and (c) as not measured. */
    steadiness?: Pick<TickSteadiness, 'p90' | 'catchUpsPerMinute'> | null;
    /** The page's game-loop rate p10, loops/s; absent for an in-process probe, which has no page loop. */
    loopRateP10?: number | null;
}

export interface GateCheck {
    id: 'a' | 'b' | 'c' | 'd';
    name: string;
    /** pass: a pass line, failing it holds the loops. report: printed, never decides. */
    role: 'pass' | 'report';
    /** Within the limit. null: not measured on this probe (it neither passes nor fails the gate). */
    ok: boolean | null;
    value: number | null;
    limit: number;
}

/**
 * pass: start the in-page loops. marginal: start, but (a) is short of a clean read.
 * re-measure: (c), or (b) as a pass line, failed: an overrun period on the demo; wait and probe again.
 * throttled: (d) failed; fix the tab (run-machine setup) and probe again.
 * investigate: (a) below the floor on a steady server, or no trials: don't start the loops.
 */
export type DirectStatus = 'pass' | 'marginal' | 're-measure' | 'throttled' | 'investigate';

/** The direct path's verdict: pass/fail criteria, not a cost model. */
export interface DirectVerdict {
    path: 'direct';
    /** Start the in-page knife loops (pass or marginal). */
    on: boolean;
    status: DirectStatus;
    onTime: number;
    trials: number;
    /** On-time trials this probe needed to pass and to clear the floor: the rule scaled to its trial count, rounded up. */
    passAt: number;
    floorAt: number;
    checks: GateCheck[];
    /** One line per failed pass line, by name; the first names the status. */
    failures: string[];
    /** A direct path that passes reacts on the next tick, so no schedule sends early. */
    lead: 0;
}

/**
 * The direct path's go/no-go (cairn://p/rs/tenets/11). (a) holds a probe with a different
 * trial count to the same shares, rounded up: a 20-trial probe needs 20 of 20 to pass and 20
 * to clear the floor. The status takes the most specific cause: an overrun period explains
 * misses, so (c) failing (or (b), when it is a pass line) reads re-measure even when (a)
 * failed too. A report-only (b) is in `checks` with its value and never in `failures`.
 */
export function directDecision(r: DirectEvidence, rule: DirectRule = {}): DirectVerdict {
    const of = rule.trials ?? DIRECT_RULE.trials;
    const scale = (k: number) => Math.ceil((r.trials * k) / of - 1e-9);
    const passAt = scale(rule.pass ?? of);
    const floorAt = scale(rule.floor ?? DIRECT_RULE.floor);
    const maxP90 = rule.maxTickP90Ms ?? DIRECT_RULE.maxTickP90Ms;
    const maxCatchUps = rule.maxCatchUpsPerMinute ?? DIRECT_RULE.maxCatchUpsPerMinute;
    const minLoop = rule.minLoopRateP10 ?? DIRECT_RULE.minLoopRateP10;
    const s = r.steadiness ?? null;
    const loop = r.loopRateP10 ?? null;
    const a: GateCheck = { id: 'a', name: 'on-time trials', role: 'pass', ok: r.trials > 0 && r.onTime >= floorAt, value: r.onTime, limit: floorAt };
    const b: GateCheck = { id: 'b', name: 'tick p90', role: (rule.tickP90PassLine ?? DIRECT_RULE.tickP90PassLine) ? 'pass' : 'report', ok: s ? s.p90 <= maxP90 : null, value: s?.p90 ?? null, limit: maxP90 };
    const c: GateCheck = { id: 'c', name: 'catch-ups per minute', role: 'pass', ok: s ? s.catchUpsPerMinute <= maxCatchUps : null, value: s?.catchUpsPerMinute ?? null, limit: maxCatchUps };
    const d: GateCheck = { id: 'd', name: 'loop rate p10', role: 'pass', ok: loop === null ? null : loop >= minLoop, value: loop, limit: minLoop };
    const failed = (k: GateCheck) => k.role === 'pass' && k.ok === false;
    const overrun = failed(b) || failed(c);
    const failures: string[] = [];
    if (overrun) {
        const why = [failed(c) ? `${c.value} catch-ups per minute over ${maxCatchUps}` : '', failed(b) ? `tick p90 ${b.value} ms over ${maxP90}` : ''].filter(Boolean).join(', ');
        failures.push(`overrun period, re-measure (${why})`);
    }
    if (failed(d)) failures.push(`tab throttled: loop rate p10 ${loop}/s under ${minLoop} (check the run-machine setup)`);
    if (!a.ok) failures.push(r.trials === 0 ? 'no probe trials' : `on time ${r.onTime}/${r.trials}, under the floor of ${floorAt}`);
    const status: DirectStatus = overrun ? 're-measure' : failed(d) ? 'throttled' : !a.ok ? 'investigate' : r.onTime >= passAt ? 'pass' : 'marginal';
    return { path: 'direct', on: status === 'pass' || status === 'marginal', status, onTime: r.onTime, trials: r.trials, passAt, floorAt, checks: [a, b, c, d], failures, lead: 0 };
}

export type HostVerdict = GateVerdict | DirectVerdict;

/** The rule for the probe's path: `directDecision` on the direct path, `gateDecision` otherwise. */
export function hostVerdict(r: ProbeSummary & DirectEvidence & { path?: ProbePath }, model: CycleModel, direct?: DirectRule): HostVerdict {
    return r.path === 'direct' ? directDecision(r, direct) : gateDecision(r, model);
}

/**
 * The verdict's numbers, for logs: (a) to (d) in order, each marked pass or FAIL (a pass line),
 * report (a report-only check, with `over` when it is past its limit), or not measured.
 */
export function verdictText(v: HostVerdict): string {
    if (v.path === 'relay') return `p ${v.p.toFixed(2)}, predicted knife ${v.knife.toFixed(2)} vs plain ${v.plain.toFixed(2)}, lead ${v.lead}`;
    const [a, b, c, d] = v.checks as [GateCheck, GateCheck, GateCheck, GateCheck];
    const mark = (k: GateCheck) => (k.ok === null ? 'not measured' : k.role === 'report' ? (k.ok ? 'report' : 'report, over') : k.ok ? 'pass' : 'FAIL');
    const val = (k: GateCheck, unit: string) => (k.value === null ? '' : `${k.value}${unit} `);
    return (
        `(a) on time ${v.onTime}/${v.trials}, pass ${v.passAt}, floor ${v.floorAt} ${mark(a)};` +
        ` (b) tick p90 ${val(b, ' ms')}<= ${b.limit} ${mark(b)};` +
        ` (c) catch-ups ${val(c, '/min')}<= ${c.limit} ${mark(c)};` +
        ` (d) loop p10 ${val(d, '/s')}>= ${d.limit} ${mark(d)}: ${v.status}`
    );
}
