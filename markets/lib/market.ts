/**
 * The GE book, quotes and history through the SDK's MarketClient (sdk/market.ts), pointed at the game's HTTP
 * origin that Gentle derives (see demo.ts) and paced by the same gate as every other read. Also the history
 * arithmetic the timeline needs: totals, the buckets where volume or price moved, and how a stack compares with
 * everything that traded.
 */
import {
    GEUnavailableError,
    MarketClient,
    type GEAvailability,
    type MarketHistory,
    type MarketHistoryOptions,
    type MarketItemOptions,
    type MarketItems,
    type MarketItemsOptions,
    type MarketQuote
} from '../../sdk/market.ts';
import type { Gentle } from './demo.ts';

export type { GEAvailability, MarketHistory, MarketItems, MarketQuote };
export type Bucket = MarketHistory['history'][number];

export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

/** MarketClient reports an HTTP status as `Market API <status>:`; a 4xx other than 429 is final. */
const marketRetryable = (e: unknown): boolean => {
    if (e instanceof GEUnavailableError) return false;
    const status = Number((e instanceof Error ? e.message : '').match(/^Market API (\d{3})/)?.[1]);
    return !(status >= 400 && status < 500 && status !== 429);
};

export class DemoMarket {
    readonly client: MarketClient;
    constructor(private readonly g: Gentle) {
        this.client = new MarketClient(g.origin);
    }
    status(): Promise<GEAvailability> {
        return this.g.pace('market status', () => this.client.status(), marketRetryable);
    }
    items(query = '', options: MarketItemsOptions = {}): Promise<MarketItems> {
        return this.g.pace(`market items ${query}`, () => this.client.items(query, options), marketRetryable);
    }
    item(id: number, options: MarketItemOptions = {}): Promise<MarketQuote> {
        return this.g.pace(`market item ${id}`, () => this.client.item(id, options), marketRetryable);
    }
    history(id: number, options: MarketHistoryOptions = {}): Promise<MarketHistory> {
        return this.g.pace(`market history ${id}`, () => this.client.history(id, options), marketRetryable);
    }
    /** The tradeable item whose name is exactly `name` (any case), or null. */
    async find(name: string): Promise<MarketQuote | null> {
        const want = name.toLowerCase();
        return (await this.items(name, { limit: 50 })).items.find(i => i.name.toLowerCase() === want) ?? null;
    }
}

/**
 * The open book's shape for one item. The market API exposes the best bid and ask and, per side, the remaining
 * quantity and the gp it is offered at in total, not individual price levels, so depth is totals and means.
 */
export interface BookDepth {
    id: number;
    name: string;
    /** The fixed per-item value the bank board counts (`basePrice`). */
    basePrice: number;
    bestBid: number | null;
    bestAsk: number | null;
    bidQuantity: number;
    bidValue: number;
    /** bidValue / bidQuantity: the average price the open bids pay. */
    meanBid: number | null;
    askQuantity: number;
    askValue: number;
    meanAsk: number | null;
    /** Units traded in the quote's period (7 days unless the quote was read with another `days`). */
    periodVolume: number;
    periodVwap: number | null;
    lastPrice: number | null;
}

export function bookDepth(q: MarketQuote): BookDepth {
    return {
        id: q.id,
        name: q.name,
        basePrice: q.basePrice,
        bestBid: q.bid,
        bestAsk: q.ask,
        bidQuantity: q.buyQuantity,
        bidValue: q.buyValue,
        meanBid: q.buyQuantity ? q.buyValue / q.buyQuantity : null,
        askQuantity: q.sellQuantity,
        askValue: q.sellValue,
        meanAsk: q.sellQuantity ? q.sellValue / q.sellQuantity : null,
        periodVolume: q.volume,
        periodVwap: q.vwap,
        lastPrice: q.lastPrice
    };
}

export interface Realisable {
    /** Units the open bids absorb now. */
    units: number;
    /** gp those units fetch before the 5% seller fee: exact when the whole bid side fills, else between `low` and `high`. */
    low: number;
    high: number;
    /** Units with no bid to sell into. */
    unsold: number;
}

/**
 * What selling `quantity` into the open bids would fetch at once. Bids fill best price first, so a partial fill
 * pays at least the mean bid and at most the best bid per unit; filling the whole side pays exactly its value.
 */
export function realisable(q: MarketQuote, quantity: number): Realisable {
    const units = Math.min(quantity, q.buyQuantity);
    if (units === q.buyQuantity) return { units, low: q.buyValue, high: q.buyValue, unsold: quantity - units };
    const mean = q.buyValue / q.buyQuantity;
    return { units, low: units * mean, high: units * (q.bid ?? mean), unsold: quantity - units };
}

export interface BuyCost {
    /** Units the open asks supply now. */
    units: number;
    /**
     * gp those units cost: exact when the whole ask side fills, else between `low` (every unit at the best ask) and
     * `high` (the mean ask: asks fill cheapest first, so the cheapest `units` cost at most their share of the side).
     */
    low: number;
    high: number;
    /** Units the asks cannot supply. */
    short: number;
}

/** What buying `quantity` from the open asks would cost at once: `realisable` for the ask side. */
export function buyCost(q: MarketQuote, quantity: number): BuyCost {
    const units = Math.max(0, Math.min(quantity, q.sellQuantity));
    const short = quantity - units;
    if (units === 0) return { units, low: 0, high: 0, short };
    if (units === q.sellQuantity) return { units, low: q.sellValue, high: q.sellValue, short };
    const mean = q.sellValue / q.sellQuantity;
    return { units, low: units * (q.ask ?? mean), high: units * mean, short };
}

/**
 * Units the open asks certainly hold at or below `price`. The API gives only the best ask and the side's totals,
 * so this is a lower bound: every unit above `price` costs at least `price + 1`, so their count is at most the
 * side's value above the best ask divided by `price + 1 - ask`.
 */
export function asksAtOrBelow(q: MarketQuote, price: number): number {
    if (!q.sellQuantity || q.ask === null || price < q.ask) return 0;
    const excess = q.sellValue - q.sellQuantity * q.ask;
    return Math.max(0, q.sellQuantity - Math.floor(excess / (price + 1 - q.ask)));
}

/** Units the open bids certainly hold at or above `price`: `asksAtOrBelow` for the bid side. */
export function bidsAtOrAbove(q: MarketQuote, price: number): number {
    if (!q.buyQuantity || q.bid === null || price > q.bid) return 0;
    const shortfall = q.buyQuantity * q.bid - q.buyValue;
    return Math.max(0, q.buyQuantity - Math.floor(shortfall / (q.bid + 1 - price)));
}

export interface BidPool {
    /** Items with at least one open bid. */
    items: number;
    quantity: number;
    /** Coins committed to open bids across the book. */
    value: number;
}

/** Totals of the open bid side over a buyValue-sorted book page (the whole book while it has at most `limit` bid items). */
export function bidPool(book: Pick<MarketItems, 'items'>): BidPool {
    const bids = book.items.filter(i => i.buyQuantity > 0);
    return { items: bids.length, quantity: bids.reduce((s, i) => s + i.buyQuantity, 0), value: bids.reduce((s, i) => s + i.buyValue, 0) };
}

/** The book with every open bid: one request, ranked by coins committed. */
export const readBids = (m: DemoMarket, days: MarketItemsOptions['days'] = 90): Promise<MarketItems> => m.items('', { sort: 'buyValue', limit: 100, days });

export interface HistoryTotals {
    buckets: number;
    volume: number;
    gross: number;
    trades: number;
    first: number | null;
    last: number | null;
    low: number | null;
    high: number | null;
    /** Gross over volume across the whole window. */
    vwap: number | null;
}

export function historyTotals(h: Pick<MarketHistory, 'history'>): HistoryTotals {
    const b = h.history;
    const volume = b.reduce((s, x) => s + x.volume, 0);
    const gross = b.reduce((s, x) => s + x.gross, 0);
    return {
        buckets: b.length,
        volume,
        gross,
        trades: b.reduce((s, x) => s + x.trades, 0),
        first: b[0]?.time ?? null,
        last: b.at(-1)?.time ?? null,
        low: b.length ? Math.min(...b.map(x => x.low)) : null,
        high: b.length ? Math.max(...b.map(x => x.high)) : null,
        vwap: volume ? gross / volume : null
    };
}

export const median = (xs: number[]): number => {
    if (!xs.length) return 0;
    const s = [...xs].sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

export interface Move {
    time: number;
    kind: 'volume' | 'price';
    volume: number;
    vwap: number;
    /** The median bucket volume (volume moves) or the previous bucket's vwap (price moves). */
    ref: number;
}

export interface MoveOptions {
    /** A volume move is a bucket at least this many times the median bucket. */
    volumeFactor?: number;
    /** ...and at least this many items, so a thin market's noise stays out. */
    minVolume?: number;
    /** A price move is a vwap this fraction away from the previous non-empty bucket's. */
    priceChange?: number;
}

/** Buckets where traded volume spiked or the price stepped; empty periods are absent from history already. */
export function historyMoves(h: Pick<MarketHistory, 'history'>, opts: MoveOptions = {}): Move[] {
    const { volumeFactor = 5, minVolume = 1_000, priceChange = 0.25 } = opts;
    const med = median(h.history.map(b => b.volume));
    const moves: Move[] = [];
    h.history.forEach((b, i) => {
        if (b.volume >= minVolume && b.volume >= volumeFactor * med) moves.push({ time: b.time, kind: 'volume', volume: b.volume, vwap: b.vwap, ref: med });
        const prev = h.history[i - 1];
        if (prev && prev.vwap > 0 && Math.abs(b.vwap - prev.vwap) / prev.vwap >= priceChange) {
            moves.push({ time: b.time, kind: 'price', volume: b.volume, vwap: b.vwap, ref: prev.vwap });
        }
    });
    return moves;
}

/** How many times over the window's whole traded volume a stack is: above 1, the GE alone cannot have supplied it. */
export const stackOverVolume = (stack: number, h: Pick<MarketHistory, 'history'>): number => {
    const volume = historyTotals(h).volume;
    return volume ? stack / volume : Number.POSITIVE_INFINITY;
};
