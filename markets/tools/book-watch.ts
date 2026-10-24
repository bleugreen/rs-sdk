#!/usr/bin/env bun
/**
 * Watches a few items' GE quotes over hours: per-side units and coins, best bid and ask, the newest open ask's
 * creation time, and the selected period's trades, once every --every seconds (300 at the least), one JSON line per
 * round. Hourly history (7 days) and daily history (90 days) are taken at the start and again at the end, so the
 * trades inside the window are in the file too. Market data carries no player names. Public HTTP only.
 *
 *   bun markets/tools/book-watch.ts --out=FILE.jsonl [--items=1617,1619,...] [--every=600] [--hours=13]
 *
 * Defaults to the seven uncut gems the gem rocks give, plus runite ore and runite bars.
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Gentle } from '../lib/demo.ts';
import { DAY_MS, DemoMarket, HOUR_MS, type MarketQuote } from '../lib/market.ts';

/** Uncut opal, jade, red topaz, sapphire, emerald, ruby and diamond; runite ore and runite bar. */
export const WATCH_IDS = [1625, 1627, 1629, 1623, 1621, 1619, 1617, 451, 2363];
export const MIN_EVERY_S = 300;

export type QuoteRow = Pick<MarketQuote, 'id' | 'bid' | 'ask' | 'buyQuantity' | 'buyValue' | 'sellQuantity' | 'sellValue' | 'lastSellAt' | 'volume' | 'trades' | 'lastPrice' | 'lastTradeAt'>;

export const quoteRow = (q: MarketQuote): QuoteRow => ({
    id: q.id, bid: q.bid, ask: q.ask, buyQuantity: q.buyQuantity, buyValue: q.buyValue, sellQuantity: q.sellQuantity, sellValue: q.sellValue,
    lastSellAt: q.lastSellAt, volume: q.volume, trades: q.trades, lastPrice: q.lastPrice, lastTradeAt: q.lastTradeAt,
});

async function histories(m: DemoMarket, ids: number[], now: number) {
    const out: Record<number, { hourly: unknown[]; daily: unknown[] }> = {};
    for (const id of ids) {
        const hourly = await m.history(id, { interval: HOUR_MS, from: now - 7 * DAY_MS, to: now });
        const daily = await m.history(id, { interval: DAY_MS, from: now - 90 * DAY_MS, to: now });
        out[id] = { hourly: hourly.history, daily: daily.history };
    }
    return out;
}

async function main(): Promise<void> {
    const { values } = parseArgs({ args: Bun.argv.slice(2), options: { out: { type: 'string' }, items: { type: 'string' }, every: { type: 'string' }, hours: { type: 'string' } } });
    if (!values.out) throw new Error('--out=FILE.jsonl is required');
    const everyS = Number(values.every ?? 600);
    if (!(everyS >= MIN_EVERY_S)) throw new Error(`--every must be at least ${MIN_EVERY_S} seconds`);
    const ids = values.items ? values.items.split(',').map(Number) : WATCH_IDS;
    const stopAt = Date.now() + Number(values.hours ?? 13) * 3_600_000;
    const out = resolve(values.out);
    mkdirSync(dirname(out), { recursive: true });
    const g = new Gentle();
    const m = new DemoMarket(g);
    const names: Record<number, string> = {};
    for (const id of ids) names[id] = (await m.item(id)).name;
    writeFileSync(out, JSON.stringify({ v: 1, origin: g.origin, started: new Date().toISOString(), everySeconds: everyS, names }) + '\n');
    appendFileSync(out, JSON.stringify({ at: new Date().toISOString(), history: await histories(m, ids, Date.now()) }) + '\n');
    for (let next = Date.now(); next < stopAt; next += everyS * 1000) {
        const at = new Date().toISOString();
        const quotes: QuoteRow[] = [];
        for (const id of ids) {
            try {
                quotes.push(quoteRow(await m.item(id, { days: 1 })));
            } catch (e) {
                console.log(`${at} ${id}: ${e instanceof Error ? e.message : e}`);
            }
        }
        appendFileSync(out, JSON.stringify({ at, quotes }) + '\n');
        console.log(`${at} ` + quotes.map(q => `${names[q.id]} ${q.buyQuantity}@${q.bid ?? '-'} / ${q.sellQuantity}@${q.ask ?? '-'}`).join(' | '));
        const wait = next + everyS * 1000 - Date.now();
        if (next + everyS * 1000 < stopAt && wait > 0) await Bun.sleep(wait);
    }
    appendFileSync(out, JSON.stringify({ at: new Date().toISOString(), history: await histories(m, ids, Date.now()) }) + '\n');
    console.log(`BOOK WATCH DONE -> ${out} (${g.requests} requests)`);
}

if (import.meta.main) await main();
