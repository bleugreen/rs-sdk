#!/usr/bin/env bun
/**
 * Scans files for any name on the markets accounts list (markets/lib/accounts.ts): run it where the list exists
 * before committing data or opening a PR. Matches a listed name as a whole word, case-insensitive, with spaces
 * or underscores. Exits 1 and lists file and line for every hit; never prints the names list itself beyond hits.
 *
 *   bun markets/tools/check-excluded.ts [PATH...]   (default: docs/markets, markets)
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadExclusion } from '../lib/accounts.ts';
import { readAccountsFile, ACCOUNTS_FILE_ENV, DEFAULT_ACCOUNTS_FILE } from '../lib/accounts.ts';

const REPO = resolve(import.meta.dir, '../..');

function* files(path: string): Generator<string> {
    const s = statSync(path);
    if (s.isFile()) yield path;
    else if (s.isDirectory()) for (const e of readdirSync(path)) if (e !== 'node_modules' && !e.startsWith('accounts.local')) yield* files(join(path, e));
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Hits of `names` (playerNameKey keys) in `text`: [line number, name]. */
export function findNames(text: string, names: string[]): [number, string][] {
    const res = names.map(n => [n, new RegExp(`(?<![A-Za-z0-9_])${n.split(' ').map(escape).join('[ _]')}(?![A-Za-z0-9_])`, 'i')] as const);
    const hits: [number, string][] = [];
    text.split('\n').forEach((line, i) => {
        for (const [n, re] of res) if (re.test(line)) hits.push([i + 1, n]);
    });
    return hits;
}

function main(): void {
    const path = process.env[ACCOUNTS_FILE_ENV] ?? DEFAULT_ACCOUNTS_FILE;
    loadExclusion();
    const names = readAccountsFile(path) ?? [];
    const targets = Bun.argv.slice(2).length ? Bun.argv.slice(2).map(p => resolve(p)) : [join(REPO, 'docs/markets'), join(REPO, 'markets')];
    let hits = 0;
    for (const t of targets) {
        for (const f of files(t)) {
            for (const [line, name] of findNames(readFileSync(f, 'utf8'), names)) {
                hits++;
                console.log(`${f}:${line}: ${name}`);
            }
        }
    }
    console.log(hits ? `${hits} listed-name hits` : `clean: ${names.length} listed names, none found`);
    if (hits) process.exit(1);
}

if (import.meta.main) {
    try {
        main();
    } catch (e) {
        console.error(`refusing to scan: ${e instanceof Error ? e.message : e}`);
        process.exit(2);
    }
}
