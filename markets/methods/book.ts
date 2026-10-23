#!/usr/bin/env bun
/**
 * The phase-2 book: one quote (7-day period) for every output and input the phase-2 methods touch, and 90 days of
 * daily history for the outputs, so docs/markets/phase2.md can price output at real depth and estimate each price's
 * drift. Public HTTP only, one request every 3 s (markets/lib/demo.ts Gentle).
 *
 *   bun markets/methods/book.ts [--out=docs/markets/data]
 *
 * Writes phase2-book-<stamp>.json: { takenAt, quotes: BookDepth & {obj}, history: {obj: buckets} }.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { objPack } from '../../speedrun/lib/obj-pack';
import { writerExclusion } from '../lib/accounts.ts';
import { Gentle } from '../lib/demo.ts';
import { bookDepth, DAY_MS, DemoMarket, type Bucket } from '../lib/market.ts';

/** Outputs (history read too) and inputs of the phase-2 methods, by debug name. */
export const OUTPUTS = [
    'uncut_opal', 'uncut_jade', 'uncut_red_topaz', 'uncut_sapphire', 'uncut_emerald', 'uncut_ruby', 'uncut_diamond',
    'iron_ore', 'coal', 'steel_bar', 'runite_ore', 'runite_bar', 'deathrune', 'bloodrune', 'fire_orb', 'jug_wine', 'gold_ore',
    'water_battlestaff', 'raw_shark'
] as const;
export const INPUTS = ['shark', 'swordfish', 'lobster', 'tuna', 'battlestaff', 'stafforb', 'water_orb', 'cosmicrune', 'waterrune', 'rune_pickaxe', 'adamant_pickaxe'] as const;

/**
 * A price's drift, from daily buckets: the volume-weighted least-squares slope of ln(vwap) against days, as a
 * fraction a day, over buckets at or after `since`. Null with fewer than `minBuckets` buckets.
 */
export function priceDrift(buckets: readonly Pick<Bucket, 'time' | 'volume' | 'gross'>[], since = -Infinity, minBuckets = 4): { perDay: number; buckets: number } | null {
    const pts = buckets.filter(b => b.time >= since && b.volume > 0 && b.gross > 0).map(b => ({ t: b.time / DAY_MS, y: Math.log(b.gross / b.volume), w: Math.sqrt(b.volume) }));
    if (pts.length < minBuckets) return null;
    const sw = pts.reduce((s, p) => s + p.w, 0);
    const mt = pts.reduce((s, p) => s + p.w * p.t, 0) / sw;
    const my = pts.reduce((s, p) => s + p.w * p.y, 0) / sw;
    const sxx = pts.reduce((s, p) => s + p.w * (p.t - mt) ** 2, 0);
    if (sxx === 0) return null;
    const slope = pts.reduce((s, p) => s + p.w * (p.t - mt) * (p.y - my), 0) / sxx;
    return { perDay: Math.expm1(slope), buckets: pts.length };
}

/** A price after `hours` at a constant daily drift. */
export function drifted(price: number, perDay: number, hours: number): number {
    return price * (1 + perDay) ** (hours / 24);
}

const stamp = (d: Date) => d.toISOString().replace(/[:]/g, '').replace(/\.\d+Z$/, 'Z');

async function main(): Promise<void> {
    const { values } = parseArgs({ args: Bun.argv.slice(2), options: { out: { type: 'string' }, 'placeholder-data': { type: 'boolean' } } });
    writerExclusion();
    const out = values.out ? resolve(values.out) : resolve(import.meta.dir, '../../docs/markets/data');
    const ids = objPack().ids;
    const m = new DemoMarket(new Gentle());
    const takenAt = new Date();
    const quotes: Record<string, unknown> = {};
    const history: Record<string, Bucket[]> = {};
    for (const obj of [...OUTPUTS, ...INPUTS]) {
        const id = ids.get(obj);
        if (id === undefined) throw new Error(`no obj id for ${obj}`);
        const q = await m.item(id, { days: 7 });
        quotes[obj] = { obj, ...bookDepth(q), gross7d: q.gross, trades7d: q.trades };
        console.log(`${obj}: bid ${q.bid} x ${q.buyQuantity} (mean ${q.buyQuantity ? (q.buyValue / q.buyQuantity).toFixed(1) : '-'}), ask ${q.ask} x ${q.sellQuantity}, 7d ${q.volume} @ ${q.vwap}`);
        if ((OUTPUTS as readonly string[]).includes(obj)) {
            const h = await m.history(id, { from: takenAt.getTime() - 90 * DAY_MS, to: takenAt.getTime(), interval: DAY_MS });
            history[obj] = h.history;
        }
    }
    mkdirSync(out, { recursive: true });
    const file = join(out, `phase2-book-${stamp(takenAt)}.json`);
    writeFileSync(file, JSON.stringify({ takenAt: takenAt.toISOString(), quotes, history }));
    console.log(file);
}

if (import.meta.main) await main();
