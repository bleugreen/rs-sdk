#!/usr/bin/env bun
// rs/686: who holds the scarce-site goods, from public boards. The Lava Maze runite board (all time, week, today) and
// a bank-board search per uncut gem, casket and runite item, our accounts dropped (markets/lib/accounts.ts). Run it at
// the start and the end of a watch window: a stack that grows is being gathered or bought; one that sits still is held.
//
//   MARKETS_ACCOUNTS_FILE=... bun markets/research/rs686-holders.ts --out=FILE.json
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { writerExclusion } from '../lib/accounts.ts';
import { readBank, readRunite } from '../lib/boards.ts';
import { Gentle } from '../lib/demo.ts';

export const HOLDER_QUERIES = ['Uncut opal', 'Uncut jade', 'Uncut red topaz', 'Uncut sapphire', 'Uncut emerald', 'Uncut ruby', 'Uncut diamond', 'Casket', 'Runite ore', 'Runite bar'];

const { values } = parseArgs({ args: Bun.argv.slice(2), options: { out: { type: 'string' } } });
if (!values.out) throw new Error('--out=FILE.json is required');
const ex = writerExclusion();
const g = new Gentle();
const takenAt = new Date().toISOString();
const board = await readRunite(g);
const runite = { allTime: ex.keep(board.allTime), week: ex.keep(board.week), today: ex.keep(board.today) };
const searches: Record<string, unknown> = {};
for (const q of HOLDER_QUERIES) {
    const rows = ex.keep(await readBank(g, q));
    // Keep only the stacks the query is about; the rows also carry an account's other matches.
    searches[q] = rows.map(r => ({ rank: r.rank, name: r.name, items: r.items.filter(i => i.name.toLowerCase() === q.toLowerCase()) })).filter(r => r.items.length);
}
writeFileSync(values.out, JSON.stringify({ takenAt, source: g.origin, runite, searches }));
console.log(`${takenAt} -> ${values.out} (${g.requests} requests)`);
for (const [k, rows] of Object.entries(runite)) console.log(`runite ${k}: ${rows.map(r => `${r.name} ${r.count}`).join(', ')}`);
for (const [q, rows] of Object.entries(searches) as [string, { name: string; items: { count: number }[] }[]][]) console.log(`${q}: ${rows.slice(0, 12).map(r => `${r.name} ${r.items[0]!.count}`).join(', ')}`);
