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
