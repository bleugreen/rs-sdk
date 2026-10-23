/**
 * Summarise a phase-2 ledger (run.ts): each account's rate on its method, the per-method medians, the knights
 * ramp's decisions, redirects, Exchange errands and the logouts.
 *
 *   bun markets/phase2/report.ts <ledger.jsonl> [--tick-ms 400]
 *
 * Rates are ledger.ts `methodRates`: coins (carried and banked) gained from an account's first to its last line in
 * stage 'method' within one session, per hour at the run's tick length.
 */
import { readFileSync } from 'node:fs';
import { median } from '../lib/market.ts';
import { numberFlag, parseArgs } from '../methods/probe-sampler.ts';
import { methodRates, type AccountLine } from './ledger.ts';

export interface Report {
    rates: ReturnType<typeof methodRates>;
    /** Coins an hour per login on each method, and the bank's store value an hour where the bank was seen at both ends. */
    byMethod: Record<string, { n: number; median: number; min: number; max: number; boardMedian: number | null }>;
    ramp: Record<string, unknown>[];
    redirects: Record<string, unknown>[];
    errands: Record<string, unknown>[];
    end: Record<string, unknown> | null;
    lastTotals: Record<string, unknown> | null;
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
        errands: lines.filter(l => l.kind === 'buy' || l.kind === 'sale'),
        end: lines.findLast(l => l.kind === 'end') ?? null,
        lastTotals: lines.findLast(l => l.kind === 'totals') ?? null
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
    for (const l of r.errands) console.log(`REPORT ${l.kind} ${JSON.stringify(l)}`);
    console.log(`REPORT totals ${JSON.stringify(r.lastTotals)}`);
    console.log(`REPORT end ${JSON.stringify(r.end)}`);
}
