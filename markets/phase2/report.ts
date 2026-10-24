/**
 * Summarise a phase-2 ledger (run.ts): each account's rate on its method, the per-method medians, the knights
 * ramp's decisions, redirects, Exchange errands, the deaths (by account, cause and pickpocket target), the stalls and
 * parks by stage, the trips (`travel`), and the logouts.
 *
 *   bun markets/phase2/report.ts <ledger.jsonl> [--tick-ms 400]
 *
 * Rates are ledger.ts `methodRates`: coins (carried and banked) gained from an account's first to its last line in
 * stage 'method' within one session, per hour at the run's tick length.
 *
 * Hitpoints: each account's time from its first login to its target (the ledger's 'hp' lines) and, from the
 * events.jsonl beside the ledger, any npc two of our accounts targeted at once (`hpCollisions`).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { median } from '../lib/market.ts';
import { numberFlag, parseArgs } from '../methods/probe-sampler.ts';
import { methodRates, type AccountLine } from './ledger.ts';

export interface Report {
    rates: ReturnType<typeof methodRates>;
    /** Coins an hour per login on each method, and the bank's store value an hour where the bank was seen at both ends. */
    byMethod: Record<string, { n: number; median: number; min: number; max: number; boardMedian: number | null }>;
    ramp: Record<string, unknown>[];
    redirects: Record<string, unknown>[];
    parked: Record<string, unknown>[];
    errands: Record<string, unknown>[];
    deaths: Deaths;
    stalls: Stalls;
    trips: Trips;
    end: Record<string, unknown> | null;
    lastTotals: Record<string, unknown> | null;
    hp: HpSummary | null;
}

export interface HpSummary {
    /** Accounts that reached their target in this run. */
    n: number;
    /** Of those, how many within `withinMinutes` of their first login. */
    within: number;
    withinMinutes: number;
    minutesFromLogin: { min: number; median: number; max: number };
    bySite: Record<string, { n: number; medianFromLogin: number; medianTraining: number }>;
    /** Accounts that waited for a site, and the longest wait. */
    queued: number;
    longestQueueMinutes: number;
}

export function hpSummary(lines: readonly Record<string, unknown>[], withinMinutes = 25): HpSummary | null {
    const hp = lines.filter(l => l.kind === 'hp');
    if (!hp.length) return null;
    const from = hp.map(l => Number(l.minutesFromLogin));
    const bySite: HpSummary['bySite'] = {};
    for (const site of new Set(hp.map(l => String(l.site)))) {
        const mine = hp.filter(l => String(l.site) === site);
        bySite[site] = { n: mine.length, medianFromLogin: median(mine.map(l => Number(l.minutesFromLogin))), medianTraining: median(mine.map(l => Number(l.minutesTraining))) };
    }
    const queued = lines.filter(l => l.kind === 'hp-site' && Number(l.queuedMinutes) > 0);
    return {
        n: hp.length,
        within: from.filter(m => m <= withinMinutes).length,
        withinMinutes,
        minutesFromLogin: { min: Math.min(...from), median: median([...from]), max: Math.max(...from) },
        bySite,
        queued: queued.length,
        longestQueueMinutes: Math.max(0, ...queued.map(l => Number(l.queuedMinutes)))
    };
}

const RELEASES = ['hp-train: dropped target', 'hp-train: switched target', 'hp-train: released target'];

export interface Collision {
    index: number;
    accounts: [string, string];
    gapMs: number;
    at: string;
}

/**
 * Npcs two of our accounts targeted at once: the same npc index picked by a second account less than `windowMs`
 * after the first picked it, with no release from the first in between (its 'dropped target', 'switched target'
 * or 'released target' at the end of its fight). Every low Hitpoints target respawns in 20 s or more (chickens 50
 * ticks) and a kill stays claimed for 5 s, so a shorter gap is two bots on one live npc. Reads the trainer's events
 * (events.jsonl).
 */
export function hpCollisions(events: readonly Record<string, unknown>[], windowMs = 10_000): { targets: number; collisions: Collision[] } {
    const last = new Map<number, { account: string; at: number; dropped: boolean }>();
    const collisions: Collision[] = [];
    let targets = 0;
    for (const e of [...events].sort((a, b) => Date.parse(String(a.t)) - Date.parse(String(b.t)))) {
        const index = Number(e.index);
        if (!Number.isFinite(index)) continue;
        const account = String(e.account);
        const at = Date.parse(String(e.t));
        if (RELEASES.includes(String(e.message))) {
            const l = last.get(index);
            if (l && l.account === account) l.dropped = true;
        } else if (e.message === 'hp-train: target') {
            targets++;
            const l = last.get(index);
            if (l && l.account !== account && !l.dropped && at - l.at < windowMs) collisions.push({ index, accounts: [l.account, account], gapMs: at - l.at, at: String(e.t) });
            last.set(index, { account, at, dropped: false });
        }
    }
    return { targets, collisions };
}

export interface Deaths {
    total: number;
    byAccount: Record<string, number>;
    /** By cause (deaths.ts): 'pickpocket', 'npc:<name>', 'kebab', 'player' or 'unknown'. */
    byCause: Record<string, number>;
    /** By stage, and by pickpocket target within a stage: 'method/guard'. */
    byWhere: Record<string, number>;
    lines: Record<string, unknown>[];
}

export function deathsOf(lines: readonly Record<string, unknown>[]): Deaths {
    const deaths = lines.filter(l => l.kind === 'death');
    const count = (key: (l: Record<string, unknown>) => string) => {
        const out: Record<string, number> = {};
        for (const l of deaths) out[key(l)] = (out[key(l)] ?? 0) + 1;
        return out;
    };
    return {
        total: deaths.length,
        byAccount: count(l => String(l.account)),
        byCause: count(l => String(l.cause ?? 'unknown')),
        byWhere: count(l => (l.target ? `${l.stage}/${l.target}` : String(l.stage))),
        lines: deaths
    };
}

export interface Stalls {
    /** Stall aborts by stage. */
    byStage: Record<string, number>;
    /** Parks by stage, for any reason (unreachable, stalled, food). */
    parkedByStage: Record<string, number>;
    lines: Record<string, unknown>[];
}

const tally = (lines: readonly Record<string, unknown>[], key: (l: Record<string, unknown>) => string): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const l of lines) out[key(l)] = (out[key(l)] ?? 0) + 1;
    return out;
};

export function stallsOf(lines: readonly Record<string, unknown>[]): Stalls {
    const stalls = lines.filter(l => l.kind === 'stall');
    return { byStage: tally(stalls, l => String(l.stage)), parkedByStage: tally(lines.filter(l => l.kind === 'parked'), l => String(l.stage ?? 'unknown')), lines: stalls };
}

export interface Trips {
    n: number;
    /** Each leg's count and median ticks, by its name: a voyage, a passage, 'fares', 'walk'. */
    byLeg: Record<string, { n: number; medianTicks: number }>;
    fares: number;
    lines: Record<string, unknown>[];
}

export function tripsOf(lines: readonly Record<string, unknown>[]): Trips {
    const trips = lines.filter(l => l.kind === 'trip');
    const ticks = new Map<string, number[]>();
    for (const t of trips) for (const leg of (t.legs as { leg: string; ticks: number }[] | undefined) ?? []) ticks.set(leg.leg, [...(ticks.get(leg.leg) ?? []), leg.ticks]);
    const byLeg = Object.fromEntries([...ticks].map(([leg, v]) => [leg, { n: v.length, medianTicks: median(v) }]));
    return { n: trips.length, byLeg, fares: trips.reduce((n, t) => n + Number(t.fares ?? 0), 0), lines: trips };
}

export function report(lines: readonly Record<string, unknown>[], tickMs: number): Report {
    const rates = methodRates(lines.filter(l => l.kind === 'account') as unknown as AccountLine[], tickMs);
    const byMethod: Report['byMethod'] = {};
    for (const m of new Set(rates.map(r => r.method))) {
        const mine = rates.filter(r => r.method === m);
        const v = mine.map(r => r.coinsPerHour);
        const board = mine.flatMap(r => (r.boardPerHour === null ? [] : [r.boardPerHour]));
        byMethod[m] = { n: v.length, median: Math.round(median([...v])), min: Math.round(Math.min(...v)), max: Math.round(Math.max(...v)), boardMedian: board.length ? Math.round(median(board)) : null };
    }
    return {
        rates,
        byMethod,
        ramp: lines.filter(l => l.kind === 'ramp' || l.kind === 'ramp-hold'),
        redirects: lines.filter(l => l.kind === 'redirect'),
        parked: lines.filter(l => l.kind === 'parked'),
        errands: lines.filter(l => l.kind === 'buy' || l.kind === 'sale'),
        deaths: deathsOf(lines),
        stalls: stallsOf(lines),
        trips: tripsOf(lines),
        end: lines.findLast(l => l.kind === 'end') ?? null,
        lastTotals: lines.findLast(l => l.kind === 'totals') ?? null,
        hp: hpSummary(lines)
    };
}

if (import.meta.main) {
    const a = parseArgs(process.argv.slice(2));
    const file = a.positional[0];
    if (!file) {
        console.error('usage: bun markets/phase2/report.ts <ledger.jsonl> [--tick-ms 400]');
        process.exit(2);
    }
    const lines = readFileSync(file, 'utf8').trim().split('\n').map(l => JSON.parse(l) as Record<string, unknown>);
    const start = lines.find(l => l.kind === 'start');
    const r = report(lines, numberFlag(a, 'tick-ms', Number(start?.tickMs ?? 400), { min: 1 }));
    console.log('REPORT rates (coins an hour on the method, longest stretch in one session)');
    for (const x of [...r.rates].sort((p, q) => p.account.localeCompare(q.account))) console.log(`  ${x.account} ${x.method.padEnd(8)} ${String(x.ticks).padStart(6)} ticks ${String(Math.round(x.coinsPerHour)).padStart(8)} coins/h ${x.boardPerHour === null ? '       -' : String(Math.round(x.boardPerHour)).padStart(8)} bank store/h`);
    console.log(`REPORT by method ${JSON.stringify(r.byMethod)}`);
    for (const l of r.ramp) console.log(`REPORT ${l.kind} ${JSON.stringify(l)}`);
    for (const l of r.redirects) console.log(`REPORT redirect ${JSON.stringify(l)}`);
    for (const l of r.parked) console.log(`REPORT parked ${JSON.stringify(l)}`);
    for (const l of r.errands) console.log(`REPORT ${l.kind} ${JSON.stringify(l)}`);
    const d = r.deaths;
    console.log(`REPORT deaths ${d.total} ${JSON.stringify({ byAccount: d.byAccount, byCause: d.byCause, byWhere: d.byWhere })}`);
    for (const l of d.lines) {
        const at = l.at as { x: number; z: number } | undefined;
        console.log(`REPORT death ${l.t} ${l.account} ${l.stage}${l.target ? `/${l.target}` : ''} cause=${l.cause} damage=${JSON.stringify(l.damage)} thieving=${l.thieving} maxHp=${l.maxHp} at=${at ? `${at.x},${at.z}` : '?'} coins=${l.carriedCoins} food=${l.food}${l.missed ? ' (seen from the respawn)' : ''}`);
    }
    console.log(`REPORT stalls ${r.stalls.lines.length} ${JSON.stringify({ byStage: r.stalls.byStage, parkedByStage: r.stalls.parkedByStage })}`);
    for (const l of r.stalls.lines) console.log(`REPORT stall ${l.t} ${l.account} ${l.stage} ${l.action} retry=${l.retry}/${l.retries} at=${JSON.stringify(l.at)} after ${l.stalledMinutes} min`);
    console.log(`REPORT trips ${r.trips.n} ${JSON.stringify({ byLeg: r.trips.byLeg, fares: r.trips.fares })}`);
    for (const l of r.trips.lines) console.log(`REPORT trip ${l.t} ${l.account} ${l.stage} ${((l.legs as { leg: string; ticks: number }[]) ?? []).map(g => `${g.leg}:${g.ticks}`).join(' ')} (${l.ticks} ticks, ${l.fares} coins)`);
    if (r.hp) {
        console.log(`REPORT hp ${JSON.stringify(r.hp)}`);
        for (const l of lines.filter(x => x.kind === 'hp').sort((p, q) => Number(p.minutesFromLogin) - Number(q.minutesFromLogin)))
            console.log(`  ${l.account} HP ${l.level} on ${String(l.site).padEnd(9)} ${String(l.minutesFromLogin).padStart(6)} min from login (${l.ticksFromLogin} ticks), ${l.minutesTraining} min training, ${l.queuedMinutes} queued`);
    }
    const events = join(dirname(file), 'events.jsonl');
    if (existsSync(events)) {
        const c = hpCollisions(readFileSync(events, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l) as Record<string, unknown>));
        console.log(`REPORT hp targets ${c.targets}, collisions between our accounts ${c.collisions.length}${c.collisions.length ? ' ' + JSON.stringify(c.collisions.slice(0, 10)) : ''}`);
    }
    console.log(`REPORT totals ${JSON.stringify(r.lastTotals)}`);
    console.log(`REPORT end ${JSON.stringify(r.end)}`);
}
