/**
 * Summarise a phase-2 ledger (run.ts): each account's rate on its method, the per-method medians, the knights
 * ramp's decisions, redirects, Exchange errands and the logouts.
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
