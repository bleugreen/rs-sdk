// One snapshot of the Grand Exchange book, from the public market API: every item with a
// standing ask (`sort=sellRecent`) and every item with a standing bid (`sort=buyValue`).
// Reads go through sdk/market.ts's MarketClient at the demo's HTTP origin (speedrun/lib/
// demo-status.ts demoOrigin, the same derivation speedrun/ uses), one page every few seconds.
//
//   bun markets/scan/ge-book.ts [--origin=https://rs-sdk-demo.fly.dev] [--out=docs/markets/data/ge-book-<stamp>.json]
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MarketClient, type MarketQuote, type MarketSort } from '../../sdk/market.ts';
import { demoOrigin } from '../../speedrun/lib/demo-status.ts';

/** The fields of a quote the scan uses. */
export interface BookRow {
    id: number;
    name: string;
    /** The server's base price for the item (its store cost). */
    basePrice: number;
    bid: number | null;
    ask: number | null;
    /** Units in all open bids, and the coins they commit. */
    buyQuantity: number;
    buyValue: number;
    /** Units in all open asks, and the coins they ask in total (sellValue / sellQuantity = mean ask). */
    sellQuantity: number;
    sellValue: number;
    lastPrice: number | null;
    vwap: number | null;
    /** Units traded over the last 7 days. */
    volume: number;
}

export interface Book {
    at: string;
    origin: string;
    rows: BookRow[];
}

export function bookRow(q: MarketQuote): BookRow {
    return {
        id: q.id, name: q.name, basePrice: q.basePrice, bid: q.bid, ask: q.ask,
        buyQuantity: q.buyQuantity, buyValue: q.buyValue, sellQuantity: q.sellQuantity, sellValue: q.sellValue,
        lastPrice: q.lastPrice, vwap: q.vwap, volume: q.volume,
    };
}

/** Merges pages into one row per item id. */
export function mergeRows(pages: MarketQuote[][]): BookRow[] {
    const byId = new Map<number, BookRow>();
    for (const page of pages) for (const q of page) byId.set(q.id, bookRow(q));
    return [...byId.values()].sort((a, b) => a.id - b.id);
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function fetchBook(client: MarketClient, gapMs = 4_000, log: (s: string) => void = () => {}): Promise<BookRow[]> {
    const pages: MarketQuote[][] = [];
    for (const sort of ['sellRecent', 'buyValue'] as MarketSort[]) {
        for (let offset = 0; ; offset += 100) {
            const res = await client.items('', { sort, limit: 100, offset, days: 7 });
            pages.push(res.items);
            log(`${sort} offset ${offset}: ${res.items.length} of ${res.total}`);
            await sleep(gapMs);
            if (offset + 100 >= res.total || res.items.length === 0) break;
        }
    }
    return mergeRows(pages);
}

if (import.meta.main) {
    const arg = (k: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
    const origin = demoOrigin(arg('origin') ?? 'rs-sdk-demo.fly.dev');
    const at = new Date().toISOString();
    const rows = await fetchBook(new MarketClient(origin), 4_000, s => console.error(s));
    const out = arg('out') ?? join(import.meta.dir, '..', '..', 'docs', 'markets', 'data', `ge-book-${at.slice(0, 16).replace(':', '')}Z.json`);
    const book: Book = { at, origin, rows };
    writeFileSync(out, JSON.stringify(book, null, 0).replace(/\},\{/g, '},\n{') + '\n');
    console.error(`${rows.length} items -> ${out}`);
}
