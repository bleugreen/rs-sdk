#!/usr/bin/env bun
/**
 * Fixed-price NPC shop stock resold on the GE (docs/markets/phase2.md 'Shop stock'): shop prices follow
 * ObjType.cost and stock (shop.rs2 `calc_shop_value`), not the gp's value on the market, so a line whose GE price
 * sits far above its shop price is both an arbitrage at the shared restock and a hedge against gp inflation.
 *
 *   bun markets/methods/shop-hedge.ts [--shelf=docs/markets/data/shelf-readings-<stamp>.jsonl]
 *
 * Reads two pages of the GE item list (by 7-day volume and by coins bid; 3 s apart), every restocking shop line in
 * content, and the live shelf counts where a shelf reading has them, and prints the ranked table.
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { writerExclusion } from '../lib/accounts.ts';
import { Gentle } from '../lib/demo.ts';
import { DemoMarket, type MarketQuote } from '../lib/market.ts';
import { loadContent } from '../scan/content.ts';
import { restockPerHour, shopBuyTotal, shopUnitPrice } from './value.ts';

export interface ShopLine {
    shop: string;
    obj: string;
    cost: number;
    /** shop_sell_multiplier, per mille of cost at base stock. */
    sell: number;
    delta: number;
    base: number;
    /** Ticks per restocked unit (shared by the whole world). */
    rate: number;
    /** Units on the shelf now: a live reading, else the base. */
    stock: number;
}

export interface GeSide {
    bid: number | null;
    bidQuantity: number;
    ask: number | null;
    /** Units traded in 7 days and their volume-weighted price. */
    volume7d: number;
    vwap: number | null;
}

export interface HedgeRow extends ShopLine {
    /** The shop's price for the next unit at the current shelf. */
    price: number;
    /** What one unit nets on the GE: the best bid while it has depth, else the 7-day vwap, less 5%. */
    geNet: number;
    outlet: 'bid' | 'flow';
    margin: number;
    restockPerHour: number;
    /** Units an hour the outlet absorbs: bid depth spread over 24 h, or the 7-day flow over 168 h. */
    outletPerHour: number;
    coinsPerHour: number;
    /** Coins from emptying the shelf now down to the stock where the margin ends. */
    oneOff: number;
}

export function hedgeRow(l: ShopLine, ge: GeSide, tickMs: number): HedgeRow | null {
    const viaBid = ge.bid !== null && ge.bidQuantity > 0;
    const gross = viaBid ? ge.bid! : ge.vwap;
    if (!gross) return null;
    const geNet = gross - Math.floor(gross / 20);
    const price = Math.max(1, shopUnitPrice(l.cost, l.sell, l.stock, l.base, l.delta));
    const r = restockPerHour(l.rate, tickMs);
    const outletPerHour = viaBid ? ge.bidQuantity / 24 : ge.volume7d / 168;
    // restocked units sell at the price one unit under base stock is bought at, the shelf being kept drained
    const restockPrice = Math.max(1, shopUnitPrice(l.cost, l.sell, Math.max(0, l.base - 1), l.base, l.delta));
    const coinsPerHour = Math.max(0, geNet - restockPrice) * Math.min(r, outletPerHour);
    let oneOff = 0;
    for (let s = l.stock; s > 0; s--) {
        const m = geNet - Math.max(1, shopUnitPrice(l.cost, l.sell, s, l.base, l.delta));
        if (m <= 0) break;
        oneOff += m;
    }
    return { ...l, price, geNet, outlet: viaBid ? 'bid' : 'flow', margin: geNet - price, restockPerHour: r, outletPerHour, coinsPerHour, oneOff };
}

/** Ranked by coins an hour at the restock, then the one-off. */
export function rankHedge(rows: readonly HedgeRow[]): HedgeRow[] {
    return rows.filter(r => r.coinsPerHour > 0 || r.oneOff > 0).sort((a, b) => b.coinsPerHour - a.coinsPerHour || b.oneOff - a.oneOff);
}

export { shopBuyTotal };

async function main(): Promise<void> {
    const { values } = parseArgs({ args: Bun.argv.slice(2), options: { shelf: { type: 'string' }, 'placeholder-data': { type: 'boolean' } } });
    writerExclusion();
    const c = loadContent();
    const live = new Map<string, number>();
    if (values.shelf) {
        for (const line of readFileSync(values.shelf, 'utf8').split('\n').filter(Boolean)) {
            const r = JSON.parse(line) as { kind: string; inv?: string; obj?: string; count?: number };
            if (r.kind === 'item' && r.inv && r.obj && typeof r.count === 'number') live.set(`${r.inv}:${r.obj}`, r.count);
        }
    }
    const m = new DemoMarket(new Gentle());
    const quotes = new Map<string, MarketQuote>();
    for (const sort of ['volume', 'buyValue'] as const) for (const q of (await m.items('', { sort, limit: 100, days: 7 })).items) quotes.set(q.name.toLowerCase(), q);
    const rows: HedgeRow[] = [];
    for (const s of c.shops) {
        const inv = c.invs.get(s.inv);
        if (!inv?.restock) continue;
        for (const st of inv.stock) {
            const o = c.objs.get(st.obj);
            const q = o ? quotes.get(o.display.toLowerCase()) : undefined;
            if (!o || !q || st.rate <= 0) continue;
            const row = hedgeRow(
                { shop: s.title, obj: st.obj, cost: o.cost, sell: s.sell, delta: s.delta, base: st.base, rate: st.rate, stock: live.get(`${s.inv}:${st.obj}`) ?? st.base },
                { bid: q.bid, bidQuantity: q.buyQuantity, ask: q.ask, volume7d: q.volume, vwap: q.vwap },
                400
            );
            if (row) rows.push(row);
        }
    }
    console.log('| Shop | Item | Shelf / base | Shop price | GE net (outlet) | Restock / h | Outlet / h | Coins / h | One-off |\n|---|---|---|---|---|---|---|---|---|');
    for (const r of rankHedge(rows).slice(0, 25)) {
        console.log(`| ${r.shop} | ${r.obj} | ${r.stock} / ${r.base} | ${r.price} | ${r.geNet} (${r.outlet}) | ${r.restockPerHour.toFixed(0)} | ${r.outletPerHour.toFixed(0)} | ${Math.round(r.coinsPerHour).toLocaleString('en-US')} | ${Math.round(r.oneOff).toLocaleString('en-US')} |`);
    }
}

if (import.meta.main) await main();
