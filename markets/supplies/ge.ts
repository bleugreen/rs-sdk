// Live Grand Exchange reads through the public market API (sdk/market.ts MarketClient): the quote
// (best bid and ask, the whole book's open quantities, the period's volume and last trade) and the
// daily trade history. Read-only and paced: one request at a time with a gap between them.
import { MarketClient, type MarketHistory, type MarketQuote } from '../../sdk/market';

export interface GeRead {
    id: number;
    /** Unix ms of the quote read. */
    at: number;
    quote: MarketQuote | null;
    /** Daily buckets over the last `days` days; omitted for an item that never traded in the period. */
    history?: MarketHistory['history'];
    error?: string;
}

export interface GeSummary {
    ask: number | null;
    /** Open sell quantity across every ask price (the API reports the whole book, not the best level). */
    askDepth: number;
    /** Mean price of the open asks (sellValue / sellQuantity): above `ask` when the book climbs. */
    askMean: number | null;
    bid: number | null;
    bidDepth: number;
    volume: number;
    trades: number;
    lastPrice: number | null;
    lastTradeAt: number | null;
    /** Lowest and highest trade price in the history window. */
    low: number | null;
    high: number | null;
    /** Average units traded per hour over the history window: what the GE has actually supplied. */
    perHour: number | null;
}

export function summarize(r: GeRead, days = 7): GeSummary {
    const q = r.quote;
    const h = r.history ?? [];
    const vol = h.reduce((s, b) => s + b.volume, 0);
    return {
        ask: q?.ask ?? null,
        askDepth: q?.sellQuantity ?? 0,
        askMean: q && q.sellQuantity > 0 ? Math.round(q.sellValue / q.sellQuantity) : null,
        bid: q?.bid ?? null,
        bidDepth: q?.buyQuantity ?? 0,
        volume: q?.volume ?? 0,
        trades: q?.trades ?? 0,
        lastPrice: q?.lastPrice ?? null,
        lastTradeAt: q?.lastTradeAt ?? null,
        low: h.length ? Math.min(...h.map(b => b.low)) : null,
        high: h.length ? Math.max(...h.map(b => b.high)) : null,
        perHour: h.length ? vol / (days * 24) : q ? 0 : null,
    };
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Read every id in turn, `gapMs` between requests (the demo is a shared public server: keep it to
 * one request every few seconds). History is read only for items that traded in the period.
 */
export async function readMarket(origin: string, ids: number[], { gapMs = 3_000, days = 7 as 7, log = (_: string) => {} } = {}): Promise<GeRead[]> {
    const client = new MarketClient(origin);
    const out: GeRead[] = [];
    for (const id of ids) {
        const read: GeRead = { id, at: Date.now(), quote: null };
        try {
            read.quote = await client.item(id, { days });
            log(`${id} ${read.quote.name}: ask ${read.quote.ask} x${read.quote.sellQuantity}, bid ${read.quote.bid} x${read.quote.buyQuantity}, vol ${read.quote.volume}`);
            if (read.quote.volume > 0) {
                await sleep(gapMs);
                const to = Date.now();
                read.history = (await client.history(id, { from: to - days * 86_400_000, to, interval: 86_400_000 })).history;
            }
        } catch (e) {
            read.error = String(e);
            log(`${id}: ${read.error}`);
        }
        out.push(read);
        await sleep(gapMs);
    }
    return out;
}
