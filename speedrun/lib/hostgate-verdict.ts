// The run-time host gate's decision rules (docs/speedrun/skills/tick-manipulation.md,
// "Run-time host gate"). This module imports nothing and touches no Node, Bun or SDK global,
// so the in-page tick programs in the browser webclient can call the same functions as the
// SDK-side gate. `hostgate.ts` holds the probe and the HostGate state machine, and re-exports
// everything here.
//
// The probe's path picks the rule:
// - direct: the reaction is issued in-page by the browser webclient, or in-process on the
//   engine websocket, with no relay hop. From a host next to the demo this read 60 of 60 at
//   1 tick. The rule is pass at 60 of 60 on time, start but flag at 58-59, and below that
//   floor don't start: a direct path that misses ticks is a broken host or client to
//   investigate, not a cost to model.
// - relay (runner, gateway, lite client): the dominant-offset cost model, `gateDecision`.

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

/** The direct path's criterion: `pass` and `floor` are on-time trials out of `trials`. */
export interface DirectRule {
    trials?: number;
    pass?: number;
    floor?: number;
}

export const DIRECT_RULE = { trials: 60, pass: 60, floor: 58 } as const;

/** The direct path's verdict: a pass/fail criterion, not a cost model. */
export interface DirectVerdict {
    path: 'direct';
    /** Start the in-page knife loops (pass or marginal). */
    on: boolean;
    /** pass: start. marginal: start, but the host is short of a clean read. investigate: don't start. */
    status: 'pass' | 'marginal' | 'investigate';
    onTime: number;
    trials: number;
    /** On-time trials this probe needed to pass and to clear the floor: the rule scaled to its trial count, rounded up. */
    passAt: number;
    floorAt: number;
    /** A direct path that passes reacts on the next tick, so no schedule sends early. */
    lead: 0;
}

/**
 * Pass at `pass` of `trials` on time (default 60 of 60), floor `floor` (default 58). A probe
 * with a different trial count is held to the same shares, rounded up: a 20-trial probe needs
 * 20 of 20 for both. Below the floor, or with no trials, the verdict is "investigate".
 */
export function directDecision(r: ProbeSummary, rule: DirectRule = {}): DirectVerdict {
    const of = rule.trials ?? DIRECT_RULE.trials;
    const scale = (k: number) => Math.ceil((r.trials * k) / of - 1e-9);
    const passAt = scale(rule.pass ?? of);
    const floorAt = scale(rule.floor ?? DIRECT_RULE.floor);
    const status = r.trials === 0 || r.onTime < floorAt ? 'investigate' : r.onTime >= passAt ? 'pass' : 'marginal';
    return { path: 'direct', on: status !== 'investigate', status, onTime: r.onTime, trials: r.trials, passAt, floorAt, lead: 0 };
}

export type HostVerdict = GateVerdict | DirectVerdict;

/** The rule for the probe's path: `directDecision` on the direct path, `gateDecision` otherwise. */
export function hostVerdict(r: ProbeSummary & { path?: ProbePath }, model: CycleModel, direct?: DirectRule): HostVerdict {
    return r.path === 'direct' ? directDecision(r, direct) : gateDecision(r, model);
}

/** The verdict's numbers, for logs. */
export function verdictText(v: HostVerdict): string {
    if (v.path === 'relay') return `p ${v.p.toFixed(2)}, predicted knife ${v.knife.toFixed(2)} vs plain ${v.plain.toFixed(2)}, lead ${v.lead}`;
    return `on time ${v.onTime}/${v.trials}, pass at ${v.passAt}, floor ${v.floorAt}: ${v.status}`;
}
