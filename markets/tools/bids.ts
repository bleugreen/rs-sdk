#!/usr/bin/env bun
/**
 * Every open GE bid, one request: item, units, coins committed, mean and best bid, and 90-day traded volume.
 * Public HTTP only. These are the outlets a gatherer can sell into at once; the means (not the best bids) are
 * what a large sale realises (see markets/lib/market.ts realisable()).
 *
 *   bun markets/tools/bids.ts [--out=docs/markets/data]
 *
 * Writes bids-<stamp>.json and prints the table as markdown.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { writerExclusion } from '../lib/accounts.ts';
import { Gentle } from '../lib/demo.ts';
import { bidPool, bookDepth, DemoMarket, readBids } from '../lib/market.ts';

const stamp = (d: Date) => d.toISOString().replace(/[:]/g, '').replace(/\.\d+Z$/, 'Z');
const n = (x: number | null, digits = 0) => (x === null ? '-' : x.toLocaleString('en-US', { maximumFractionDigits: digits }));

async function main(): Promise<void> {
    const { values } = parseArgs({ args: Bun.argv.slice(2), options: { out: { type: 'string' }, 'placeholder-data': { type: 'boolean' } } });
    // The book carries no player names, but every snapshot writer takes the same gate.
    writerExclusion();
    const out = values.out ? resolve(values.out) : resolve(import.meta.dir, '../../docs/markets/data');
    const takenAt = new Date();
    const book = await readBids(new DemoMarket(new Gentle()), 90);
    const bids = book.items.filter(i => i.buyQuantity > 0).map(bookDepth);
    const pool = bidPool(book);
    mkdirSync(out, { recursive: true });
    const file = join(out, `bids-${stamp(takenAt)}.json`);
    writeFileSync(file, JSON.stringify({ takenAt: takenAt.toISOString(), days: 90, pool, bids }));
    console.log(`${file}: ${pool.items} items bid, ${n(pool.quantity)} units, ${n(pool.value)} coins committed\n`);
    console.log('| Item | Units | Coins committed | Mean bid | Best bid | Base | 90-day volume |\n|---|---|---|---|---|---|---|');
    for (const b of bids) console.log(`| ${b.name} | ${n(b.bidQuantity)} | ${n(b.bidValue)} | ${n(b.meanBid, 1)} | ${n(b.bestBid)} | ${n(b.basePrice)} | ${n(b.periodVolume)} |`);
}

if (import.meta.main) await main();
