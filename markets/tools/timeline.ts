#!/usr/bin/env bun
/**
 * The wealth leaders' holdings over time, from every saved bank top-50 read: hiscore-scrape snapshots
 * (docs/speedrun/research/competitors/data), census files and poll files (docs/markets/data). Offline; no requests.
 *
 *   bun markets/tools/timeline.ts [--dir=DIR]... [--top=10] [NAME...]
 *
 * Prints, per account, its total at each read and, per stack, the count at first and last read, the change and
 * its hourly rate, and whether the count is a round number. Default accounts: the latest read's top N.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { writerExclusion } from '../lib/accounts.ts';
import { bankTops, holdingsOf, type BankTop } from '../lib/snapshots.ts';

const REPO = resolve(import.meta.dir, '../..');
export const DEFAULT_DIRS = [join(REPO, 'docs/speedrun/research/competitors/data'), join(REPO, 'docs/markets/data')];

export function loadTops(dirs: string[]): BankTop[] {
    const tops: BankTop[] = [];
    for (const dir of dirs) {
        let files: string[];
        try {
            files = readdirSync(dir).filter(f => f.endsWith('.json'));
        } catch {
            continue;
        }
        for (const f of files) tops.push(...bankTops(JSON.parse(readFileSync(join(dir, f), 'utf8')), f));
    }
    return tops.sort((a, b) => a.at.localeCompare(b.at));
}

/** The largest power of ten (at least 1,000) that divides `n`, or null: stacks handed over tend to be round. */
export function roundness(n: number): number | null {
    let best: number | null = null;
    for (let p = 1_000; p <= n && n % p === 0; p *= 10) best = p;
    return best;
}

export interface StackChange {
    id: number;
    name: string;
    first: { at: string; count: number };
    last: { at: string; count: number };
    perHour: number | null;
    round: number | null;
}

/** Per item, the first and last count over an account's reads; an item off its six shown stacks is absent there. */
export function stackChanges(tops: BankTop[], name: string, names: Map<number, string>): StackChange[] {
    const byItem = new Map<number, { at: string; count: number }[]>();
    for (const h of holdingsOf(tops, name)) for (const s of h.items) byItem.set(s.id, [...(byItem.get(s.id) ?? []), { at: h.at, count: s.count }]);
    return [...byItem].map(([id, seen]) => {
        const first = seen[0]!;
        const last = seen.at(-1)!;
        const hours = (Date.parse(last.at) - Date.parse(first.at)) / 3_600_000;
        return { id, name: names.get(id) ?? `item ${id}`, first, last, perHour: hours > 0 ? (last.count - first.count) / hours : null, round: roundness(last.count) };
    });
}

const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 });

function main(): void {
    const { values, positionals } = parseArgs({
        args: Bun.argv.slice(2),
        allowPositionals: true,
        options: { dir: { type: 'string', multiple: true }, top: { type: 'string' }, 'placeholder-data': { type: 'boolean' } }
    });
    const ex = writerExclusion();
    const tops = loadTops(values.dir?.length ? values.dir.map(d => resolve(d)) : DEFAULT_DIRS).map(t => ({ ...t, rows: ex.keep(t.rows) }));
    if (!tops.length) throw new Error('no bank reads found');
    const names = new Map<number, string>();
    for (const t of tops) for (const r of t.rows) for (const i of r.items) if (i.name) names.set(i.id, i.name);
    const accounts = (positionals.length ? positionals : tops.at(-1)!.rows.slice(0, Number(values.top ?? 10)).map(r => r.name)).filter(n => !ex.excludes(n));
    console.log(`${tops.length} bank reads, ${tops[0]!.at} .. ${tops.at(-1)!.at}`);
    for (const name of accounts) {
        const h = holdingsOf(tops, name);
        console.log(`\n### ${name}\n`);
        // Collapse runs of identical totals so a quiet account prints a few lines, not one per poll.
        const lines: string[] = [];
        let lastGp: number | null = null;
        for (const p of h) {
            if (p.gp === lastGp && p !== h.at(-1)) continue;
            lines.push(`| ${p.at.slice(0, 16)}Z | ${p.rank} | ${fmt(p.gp)} |`);
            lastGp = p.gp;
        }
        console.log(['| Read | Rank | Total gp |', '|---|---|---|', ...lines].join('\n'));
        console.log('\n| Stack | First | Last | Change/hour | Round |\n|---|---|---|---|---|');
        for (const c of stackChanges(tops, name, names)) {
            console.log(`| ${c.name} | ${fmt(c.first.count)} @${c.first.at.slice(5, 16)} | ${fmt(c.last.count)} @${c.last.at.slice(5, 16)} | ${c.perHour === null ? '-' : fmt(c.perHour)} | ${c.round ? fmt(c.round) : ''} |`);
        }
    }
}

if (import.meta.main) main();
