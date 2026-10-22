#!/usr/bin/env bun
/**
 * GE quotes and history for the goods the wealth leaders hold: a fixed list (the runes, sharks, bass, oyster and
 * the uncut gems) plus every stack in the bank board's top rows. Daily buckets over 90 days and hourly buckets
 * over the last 7, three seconds between requests. Public HTTP only.
 *
 *   bun markets/tools/ge-history.ts [--out=docs/markets/data] [--top=10]
 *
 * Writes ge-history-<stamp>.json and prints, per item, what traded, when volume or price moved, and how each
 * leader's stack compares with everything that ever traded.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { readBank } from '../lib/boards.ts';
import { writerExclusion } from '../lib/accounts.ts';
import { Gentle } from '../lib/demo.ts';
import { DAY_MS, DemoMarket, historyMoves, historyTotals, HOUR_MS, type MarketHistory, type MarketQuote } from '../lib/market.ts';

export const WATCH_ITEMS = [
    'Air rune', 'Mind rune', 'Fire rune', 'Raw shark', 'Shark', 'Raw bass', 'Oyster',
    'Uncut opal', 'Uncut jade', 'Uncut red topaz', 'Uncut sapphire', 'Uncut emerald', 'Uncut ruby', 'Uncut diamond', 'Uncut dragonstone'
];

const COINS = 995;
const day = (t: number) => new Date(t).toISOString().slice(0, 10);
const hour = (t: number) => new Date(t).toISOString().slice(0, 13) + 'Z';
const stamp = (d: Date) => d.toISOString().replace(/[:]/g, '').replace(/\.\d+Z$/, 'Z');
const n = (x: number) => x.toLocaleString('en-US', { maximumFractionDigits: 1 });

async function main(): Promise<void> {
    const { values } = parseArgs({ args: Bun.argv.slice(2), options: { out: { type: 'string' }, top: { type: 'string' }, 'placeholder-data': { type: 'boolean' } } });
    const ex = writerExclusion();
    const out = values.out ? resolve(values.out) : resolve(import.meta.dir, '../../docs/markets/data');
    const g = new Gentle();
    const m = new DemoMarket(g);
    const takenAt = new Date();
    const now = takenAt.getTime();

    const leaders = ex.keep(await readBank(g)).slice(0, Number(values.top ?? 10));
    const ids = new Map<number, string>();
    for (const r of leaders) for (const i of r.items) if (i.id !== COINS) ids.set(i.id, i.name);
    for (const name of WATCH_ITEMS) {
        if ([...ids.values()].includes(name)) continue;
        const q = await m.find(name);
        if (q) ids.set(q.id, q.name);
        else console.error(`${name}: not a tradeable market item`);
    }

    const items: Record<number, { name: string; quote: MarketQuote; daily: MarketHistory['history']; hourly: [number, number, number, number, number, number][] }> = {};
    const untradeable: string[] = [];
    for (const [id, name] of ids) {
        let quote: MarketQuote;
        try {
            quote = await m.item(id, { days: 90 });
        } catch (e) {
            // A leader's stack can be an item the GE does not list (quest items, untradeables): note it and go on.
            untradeable.push(name);
            console.error(`${name} (${id}): ${e instanceof Error ? e.message : e}`);
            continue;
        }
        const daily = await m.history(id, { interval: DAY_MS, from: now - 90 * DAY_MS, to: now });
        const hourly = await m.history(id, { interval: HOUR_MS, from: now - 7 * DAY_MS, to: now });
        items[id] = { name, quote, daily: daily.history, hourly: hourly.history.map(b => [b.time, b.volume, b.vwap, b.low, b.high, b.trades]) };

        const t = historyTotals(daily);
        console.log(`\n## ${name} (${id}) base ${quote.basePrice}, bid ${quote.bid ?? '-'} ask ${quote.ask ?? '-'} last ${quote.lastPrice ?? '-'}`);
        console.log(`traded ${n(t.volume)} in ${n(t.trades)} trades over ${t.buckets} days (${t.first ? day(t.first) : '-'} .. ${t.last ? day(t.last) : '-'}), vwap ${t.vwap ? n(t.vwap) : '-'}, low ${t.low ?? '-'} high ${t.high ?? '-'}; book: ${n(quote.buyQuantity)} bid, ${n(quote.sellQuantity)} asked`);
        for (const mv of historyMoves(daily, { volumeFactor: 3 })) console.log(`  day ${day(mv.time)} ${mv.kind}: volume ${n(mv.volume)} vwap ${n(mv.vwap)} (ref ${n(mv.ref)})`);
        for (const mv of historyMoves(hourly)) console.log(`  hour ${hour(mv.time)} ${mv.kind}: volume ${n(mv.volume)} vwap ${n(mv.vwap)} (ref ${n(mv.ref)})`);
        for (const r of leaders) {
            const stack = r.items.find(i => i.id === id);
            if (stack) console.log(`  ${r.name} holds ${n(stack.count)} = ${t.volume ? n(stack.count / t.volume) : 'inf'} x everything traded`);
        }
    }

    mkdirSync(out, { recursive: true });
    const file = join(out, `ge-history-${stamp(takenAt)}.json`);
    writeFileSync(file, JSON.stringify({ takenAt: takenAt.toISOString(), source: g.origin, hourlyColumns: ['time', 'volume', 'vwap', 'low', 'high', 'trades'], leaders, untradeable, items }));
    console.log(`\n${file}: ${g.requests} requests`);
}

if (import.meta.main) await main();
