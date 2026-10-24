/**
 * Knights crowding from a phase-2 run's ledger (docs/markets/phase2.md 'Knights crowding'):
 *
 *   bun markets/phase2/crowding.ts <run dir | ledger.jsonl> [--warmup 5] [--tick-ms 400]
 *
 * - the warm-up curve: a knights login's gp a tick by whole minute since it reached the method (its arrival at the
 *   Ardougne docks), the median across arrivals, which sets the ramp's `warmupMinutes`;
 * - each ramp hold: every login's rate from the hold start (the rule before the warm-up) and from the end of its
 *   warm-up, split into incumbents (admitted at an earlier step) and newcomers;
 * - rate by load: gp a tick over each ledger interval against how many of our knights logins worked the same knight
 *   at its start (`target` in the account lines), pooled past the warm-up; 'none' is no knight in view (the bank
 *   trip, a walk, a roam);
 * - per login: the knights it worked, how often it had none in view, and how far it stood from its knight.
 */
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { median } from '../lib/market.ts';
import { numberFlag, parseArgs } from '../methods/probe-sampler.ts';
import type { NpcAt } from './ledger.ts';

export interface Sample {
    account: string;
    at: number;
    session: number;
    tick: number;
    stage: string;
    coins: number;
    pos: [number, number] | null;
    target: NpcAt | null;
    /** Ticks of the session spent in the thieve errand (ledger `workTicks`), when recorded. */
    work: number | null;
}

type Line = Record<string, unknown>;

/** Every knights account line as a sample, by account, oldest first. */
export function samplesOf(lines: readonly Line[]): Map<string, Sample[]> {
    const out = new Map<string, Sample[]>();
    for (const l of lines) {
        if (l.kind !== 'account' || l.method !== 'knights') continue;
        const s: Sample = {
            account: String(l.account),
            at: Date.parse(String(l.t)),
            session: Number(l.session),
            tick: Number(l.tick),
            stage: String(l.stage),
            coins: Number((l.coins as { total?: number } | undefined)?.total ?? 0),
            pos: (l.pos as [number, number] | null | undefined) ?? null,
            target: (l.target as NpcAt | null | undefined) ?? null,
            work: typeof l.workTicks === 'number' ? l.workTicks : null
        };
        const list = out.get(s.account) ?? [];
        list.push(s);
        out.set(s.account, list);
    }
    for (const list of out.values()) list.sort((a, b) => a.at - b.at);
    return out;
}

/** Runs of consecutive samples on the method within one session. */
export function stretches(samples: readonly Sample[]): Sample[][] {
    const out: Sample[][] = [];
    let cur: Sample[] = [];
    for (const s of samples) {
        if (s.stage === 'method' && (cur.length === 0 || cur.at(-1)!.session === s.session)) cur.push(s);
        else {
            if (cur.length) out.push(cur);
            cur = s.stage === 'method' ? [s] : [];
        }
    }
    if (cur.length) out.push(cur);
    return out;
}

/** gp a tick in each whole minute since the stretch began (each interval counted in the minute it starts), up to `minutes`. */
export function byMinute(stretch: readonly Sample[], minutes: number): (number | null)[] {
    const coins = new Array<number>(minutes).fill(0);
    const ticks = new Array<number>(minutes).fill(0);
    const t0 = stretch[0]?.at ?? 0;
    for (let i = 1; i < stretch.length; i++) {
        const m = Math.floor((stretch[i - 1]!.at - t0) / 60_000);
        if (m >= minutes) break;
        coins[m]! += stretch[i]!.coins - stretch[i - 1]!.coins;
        ticks[m]! += stretch[i]!.tick - stretch[i - 1]!.tick;
    }
    return coins.map((c, m) => (ticks[m]! > 0 ? c / ticks[m]! : null));
}

/**
 * The median across arrivals (every account's first stretch long enough to reach `minutes`) of the gp a tick in each
 * minute since arrival.
 */
export function warmupCurve(by: Map<string, Sample[]>, minutes: number): { minute: number; median: number | null; n: number }[] {
    const curves = [...by.values()].flatMap(s => {
        const first = stretches(s)[0];
        return first && first.at(-1)!.at - first[0]!.at >= minutes * 60_000 ? [byMinute(first, minutes)] : [];
    });
    return Array.from({ length: minutes }, (_, m) => {
        const v = curves.flatMap(c => (c[m] === null || c[m] === undefined ? [] : [c[m]!]));
        return { minute: m, median: v.length ? median(v) : null, n: v.length };
    });
}

/**
 * A login's gp a tick from its first sample at or after `from` to its last sample at or before `to`, within one
 * stretch: over wall ticks (`rate`), and over the ticks at the knights (`knights`, null without work counts or under
 * half the window there) with that share (`workShare`).
 */
export function windowRate(stretch: readonly Sample[], from: number, to: number): { rate: number; knights: number | null; workShare: number | null; minutes: number } | null {
    const a = stretch.find(s => s.at >= from);
    const b = stretch.findLast(s => s.at <= to);
    if (!a || !b || b.tick <= a.tick) return null;
    const ticks = b.tick - a.tick;
    const work = a.work !== null && b.work !== null ? b.work - a.work : null;
    return {
        rate: (b.coins - a.coins) / ticks,
        knights: work !== null && work >= ticks / 2 ? (b.coins - a.coins) / work : null,
        workShare: work === null ? null : work / ticks,
        minutes: (b.at - a.at) / 60_000
    };
}

export interface HoldRow {
    account: string;
    /** The ramp step that admitted it. */
    step: number | null;
    newcomer: boolean;
    /** Measured from the hold start (the rule before the warm-up). */
    fromStart: number | null;
    /** Measured from the later of the hold start and `warmup` minutes after it reached the method. */
    warm: number | null;
    /** The same window, at the knights only (ramp.ts workRate): the step rule's measure. */
    knights: number | null;
    arrivedBeforeHoldMin: number | null;
}

/** Every knights login's rates over a hold [start, end], by both rules. */
export function holdRows(by: Map<string, Sample[]>, admitStep: Map<string, number>, step: number, start: number, end: number, warmupMs: number): HoldRow[] {
    const rows: HoldRow[] = [];
    for (const [account, samples] of by) {
        const st = admitStep.get(account) ?? null;
        if (st === null || st > step) continue;
        const s = stretches(samples).find(x => x[0]!.at <= end && x.at(-1)!.at >= start);
        if (!s) {
            rows.push({ account, step: st, newcomer: st === step, fromStart: null, warm: null, knights: null, arrivedBeforeHoldMin: null });
            continue;
        }
        const arrived = s[0]!.at;
        const warm = windowRate(s, Math.max(start, arrived + warmupMs), end);
        rows.push({
            account,
            step: st,
            newcomer: st === step,
            fromStart: windowRate(s, start, end)?.rate ?? null,
            warm: warm?.rate ?? null,
            knights: warm?.knights ?? null,
            arrivedBeforeHoldMin: Math.round((start - arrived) / 6_000) / 10
        });
    }
    return rows.sort((a, b) => a.account.localeCompare(b.account));
}

/** How long a sample's target stands for another account's load: a little over the ledger's 50-tick cadence. */
const LOAD_STALE_MS = 30_000;

/**
 * For every sample on the method, how many of the knights accounts (itself included) had the same knight as their
 * latest target, a sample no older than 30 s; 0 when it has no knight in view. Keyed `account@at`.
 */
export function loads(by: Map<string, Sample[]>): Map<string, number> {
    const all = [...by.values()].flat().sort((a, b) => a.at - b.at);
    const latest = new Map<string, Sample>();
    const out = new Map<string, number>();
    for (const s of all) {
        latest.set(s.account, s);
        if (s.stage !== 'method') continue;
        if (!s.target) {
            out.set(`${s.account}@${s.at}`, 0);
            continue;
        }
        let n = 0;
        for (const o of latest.values()) if (o.stage === 'method' && o.target?.index === s.target.index && s.at - o.at <= LOAD_STALE_MS) n++;
        out.set(`${s.account}@${s.at}`, n);
    }
    return out;
}

/**
 * gp a tick pooled over every ledger interval past the warm-up (and inside [from, to]), by the load at its start:
 * the bots on that knight, 0 for none in view.
 */
export function rateByLoad(by: Map<string, Sample[]>, warmupMs: number, from = -Infinity, to = Infinity): { load: number; rate: number; intervals: number; accounts: number }[] {
    const load = loads(by);
    const acc = new Map<number, { coins: number; ticks: number; n: number; who: Set<string> }>();
    for (const samples of by.values()) {
        for (const s of stretches(samples)) {
            for (let i = 1; i < s.length; i++) {
                const a = s[i - 1]!, b = s[i]!;
                if (a.at - s[0]!.at < warmupMs || a.at < from || b.at > to) continue;
                const k = load.get(`${a.account}@${a.at}`) ?? 0;
                const e = acc.get(k) ?? { coins: 0, ticks: 0, n: 0, who: new Set<string>() };
                e.coins += b.coins - a.coins;
                e.ticks += b.tick - a.tick;
                e.n++;
                e.who.add(a.account);
                acc.set(k, e);
            }
        }
    }
    return [...acc.entries()].sort((a, b) => a[0] - b[0]).map(([k, e]) => ({ load: k, rate: e.ticks > 0 ? e.coins / e.ticks : 0, intervals: e.n, accounts: e.who.size }));
}

export interface Placement {
    account: string;
    samples: number;
    /** Share of samples with no knight in view. */
    none: number;
    /** Samples by knight index. */
    knights: Record<string, number>;
    /** Mean load (our bots on its knight, itself included) over the samples with a knight. */
    meanLoad: number | null;
    /** Median Chebyshev distance to its knight. */
    medianDistance: number | null;
    /** Share of its ticks spent at the knights (the thieve errand), when recorded: the rest is bank trips and walks. */
    workShare: number | null;
}

/** Where each knights login worked over [from, to], past its warm-up. */
export function placements(by: Map<string, Sample[]>, warmupMs: number, from = -Infinity, to = Infinity): Placement[] {
    const load = loads(by);
    const out: Placement[] = [];
    for (const [account, samples] of by) {
        const xs = stretches(samples).flatMap(s => s.filter(x => x.at - s[0]!.at >= warmupMs && x.at >= from && x.at <= to));
        if (!xs.length) continue;
        const knights: Record<string, number> = {};
        const ls: number[] = [];
        const ds: number[] = [];
        for (const x of xs) {
            if (!x.target) continue;
            knights[x.target.index] = (knights[x.target.index] ?? 0) + 1;
            ls.push(load.get(`${x.account}@${x.at}`) ?? 0);
            if (x.pos) ds.push(Math.max(Math.abs(x.pos[0] - x.target.x), Math.abs(x.pos[1] - x.target.z)));
        }
        let work = 0, ticks = 0, counted = false;
        for (const s of stretches(samples)) {
            const w = s.filter(x => x.at - s[0]!.at >= warmupMs && x.at >= from && x.at <= to);
            const a = w[0], b = w.at(-1);
            if (!a || !b || a.work === null || b.work === null) continue;
            work += b.work - a.work;
            ticks += b.tick - a.tick;
            counted = true;
        }
        out.push({
            account,
            samples: xs.length,
            workShare: counted && ticks > 0 ? work / ticks : null,
            none: (xs.length - ls.length) / xs.length,
            knights,
            meanLoad: ls.length ? ls.reduce((a, b) => a + b, 0) / ls.length : null,
            medianDistance: ds.length ? median(ds) : null
        });
    }
    return out.sort((a, b) => a.account.localeCompare(b.account));
}

function readLedger(path: string): Line[] {
    const file = statSync(path).isDirectory() ? join(path, 'ledger.jsonl') : path;
    return readFileSync(file, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(l => JSON.parse(l) as Line);
}

if (import.meta.main) {
    const a = parseArgs(process.argv.slice(2));
    const path = a.positional[0];
    if (!path) {
        console.error('usage: bun markets/phase2/crowding.ts <run dir | ledger.jsonl> [--warmup 5] [--tick-ms 400]');
        process.exit(2);
    }
    const lines = readLedger(path);
    const warmupMs = numberFlag(a, 'warmup', 5, { min: 0 }) * 60_000;
    const tickMs = numberFlag(a, 'tick-ms', Number(lines.find(l => l.kind === 'start')?.tickMs ?? 400), { min: 1 });
    const perHour = (r: number | null) => (r === null ? '-' : `${r.toFixed(2)} (${Math.round((r * 3_600_000) / tickMs / 100) / 10}k/h)`);
    const by = samplesOf(lines);
    const admitStep = new Map(lines.filter(l => l.kind === 'admit').map(l => [String(l.account), Number(l.step)]));

    console.log('WARMUP gp a tick by minute since reaching the method (median over arrivals)');
    for (const r of warmupCurve(by, 15)) console.log(`  min ${String(r.minute).padStart(2)}  ${r.median === null ? '-' : r.median.toFixed(2)}  n=${r.n}`);

    const holds = lines.filter(l => l.kind === 'ramp' && typeof l.holdStart === 'string');
    for (const h of holds) {
        const step = Number(h.step);
        const start = Date.parse(String(h.holdStart)), end = Date.parse(String(h.holdEnd));
        const rows = holdRows(by, admitStep, step, start, end, warmupMs);
        const med = (xs: (number | null)[]) => {
            const v = xs.filter((x): x is number => x !== null);
            return v.length ? median(v) : null;
        };
        const inc = rows.filter(r => !r.newcomer), nw = rows.filter(r => r.newcomer);
        console.log(`HOLD step ${step} ${h.holdStart} - ${h.holdEnd}: runner median ${Number(h.median).toFixed(2)} ratio ${h.ratio ?? '-'}`);
        console.log(`  from the hold start: all ${perHour(med(rows.map(r => r.fromStart)))}  incumbents ${perHour(med(inc.map(r => r.fromStart)))}  newcomers ${perHour(med(nw.map(r => r.fromStart)))}`);
        console.log(`  past a ${warmupMs / 60_000}-min warm-up: all ${perHour(med(rows.map(r => r.warm)))}  incumbents ${perHour(med(inc.map(r => r.warm)))}  newcomers ${perHour(med(nw.map(r => r.warm)))}`);
        console.log(`  at the knights, past the warm-up: all ${perHour(med(rows.map(r => r.knights)))}  incumbents ${perHour(med(inc.map(r => r.knights)))}  newcomers ${perHour(med(nw.map(r => r.knights)))}`);
        for (const r of rows) console.log(`    ${r.account} step ${r.step}${r.newcomer ? ' new' : '    '} arrived ${r.arrivedBeforeHoldMin ?? '-'} min before  start ${r.fromStart?.toFixed(2) ?? '-'}  warm ${r.warm?.toFixed(2) ?? '-'}  knights ${r.knights?.toFixed(2) ?? '-'}`);
        const p = placements(by, warmupMs, start, end);
        console.log(`  placement over the hold (load = our bots on its knight)`);
        for (const x of p) console.log(`    ${x.account} none ${(x.none * 100).toFixed(0)}%  load ${x.meanLoad?.toFixed(2) ?? '-'}  dist ${x.medianDistance ?? '-'}  at knights ${x.workShare === null ? '-' : `${(x.workShare * 100).toFixed(1)}%`}  knights ${JSON.stringify(x.knights)}`);
        console.log(`  rate by load: ${JSON.stringify(rateByLoad(by, warmupMs, start, end).map(r => ({ ...r, rate: Math.round(r.rate * 100) / 100 })))}`);
    }
    console.log('LOAD whole run past the warm-up (load 0 = no knight in view)');
    for (const r of rateByLoad(by, warmupMs)) console.log(`  ${r.load} bots  ${perHour(r.rate)}  intervals ${r.intervals}  accounts ${r.accounts}`);
    const whole = placements(by, warmupMs).filter(x => x.workShare !== null);
    if (whole.length) console.log(`AT KNIGHTS whole run past the warm-up: median share of ticks ${(median(whole.map(x => x.workShare!)) * 100).toFixed(1)}% (${whole.length} logins); the rest is bank trips and walks`);
}
