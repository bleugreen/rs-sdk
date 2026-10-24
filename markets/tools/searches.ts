#!/usr/bin/env bun
/**
 * Bank board item searches, three seconds apart, saved in the same shape as the speedrun competitor
 * bank-searches files (query -> rows), and an item-by-item diff of named accounts against an earlier file. The
 * bank board shows only an account's six largest stacks; a search shows its stacks matching the query, so a
 * diff over many searches is the closest public view of a whole bank changing. Public HTTP only.
 *
 *   bun markets/tools/searches.ts [--out=DIR] [--q=a,b,c] [--diff=OLD.json --name=stein[,other]]
 *   bun markets/tools/searches.ts --diff=OLD.json --against=NEW.json --name=stein   (offline)
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { BANK_SEARCHES } from '../../speedrun/tools/hiscore-scrape.ts';
import { readBank, type ValueRow } from '../lib/boards.ts';
import { writerExclusion } from '../lib/accounts.ts';
import { Gentle } from '../lib/demo.ts';
import { CENSUS_SEARCHES } from './census.ts';

export type Searches = Record<string, ValueRow[]>;
export const DEFAULT_QUERIES = [...new Set([...BANK_SEARCHES, 'charge', 'pure', ...CENSUS_SEARCHES])];

/** Reads a bank-searches file, or the searches inside a scraper snapshot or census file. */
export function loadSearches(json: unknown): Searches {
    const j = json as { bank?: { searches?: Searches }; searches?: Searches };
    return j.bank?.searches ?? j.searches ?? (json as Searches);
}

export interface StackDiff {
    id: number;
    name: string;
    before: number | null;
    after: number | null;
    gpBefore: number | null;
    gpAfter: number | null;
}

/** `account`'s stacks over every query both files ran; null where the account had no row for that stack. */
export function diffAccount(before: Searches, after: Searches, account: string): StackDiff[] {
    const collect = (s: Searches, q: string) => new Map((s[q] ?? []).filter(r => r.name === account).flatMap(r => r.items).map(i => [i.id, i]));
    const out = new Map<number, StackDiff>();
    for (const q of Object.keys(before).filter(q => q in after)) {
        const b = collect(before, q);
        const a = collect(after, q);
        for (const id of new Set([...b.keys(), ...a.keys()])) {
            if (out.has(id)) continue;
            const x = b.get(id);
            const y = a.get(id);
            out.set(id, { id, name: (x ?? y)!.name, before: x?.count ?? null, after: y?.count ?? null, gpBefore: x?.gp ?? null, gpAfter: y?.gp ?? null });
        }
    }
    return [...out.values()].sort((p, q) => Math.abs((q.gpAfter ?? 0) - (q.gpBefore ?? 0)) - Math.abs((p.gpAfter ?? 0) - (p.gpBefore ?? 0)));
}

const stamp = (d: Date) => d.toISOString().replace(/[:]/g, '').replace(/\.\d+Z$/, 'Z');
const n = (x: number | null) => (x === null ? '-' : x.toLocaleString('en-US'));

async function main(): Promise<void> {
    const { values } = parseArgs({
        args: Bun.argv.slice(2),
        options: { out: { type: 'string' }, q: { type: 'string' }, diff: { type: 'string' }, against: { type: 'string' }, name: { type: 'string' }, 'placeholder-data': { type: 'boolean' } }
    });
    // Reading live and writing a file needs the accounts list; an offline diff only prints.
    const ex = values.against ? null : writerExclusion();
    let now: Searches;
    if (values.against) {
        now = loadSearches(JSON.parse(readFileSync(values.against, 'utf8')));
    } else {
        const g = new Gentle();
        const queries = values.q ? values.q.split(',') : DEFAULT_QUERIES;
        const takenAt = new Date();
        now = {};
        for (const q of queries) now[q] = ex!.keep(await readBank(g, q));
        const out = values.out ? resolve(values.out) : resolve(import.meta.dir, '../../docs/markets/data');
        mkdirSync(out, { recursive: true });
        const file = join(out, `bank-searches-${stamp(takenAt)}.json`);
        writeFileSync(file, JSON.stringify(now));
        console.log(`${file}: ${g.requests} requests`);
    }
    if (!values.diff) return;
    const before = loadSearches(JSON.parse(readFileSync(values.diff, 'utf8')));
    for (const account of (values.name ?? '').split(',').filter(Boolean)) {
        console.log(`\n### ${account}\n\n| Stack | Before | After | gp change |\n|---|---|---|---|`);
        for (const d of diffAccount(before, now, account)) console.log(`| ${d.name} | ${n(d.before)} | ${n(d.after)} | ${n((d.gpAfter ?? 0) - (d.gpBefore ?? 0))} |`);
    }
}

if (import.meta.main) await main();
