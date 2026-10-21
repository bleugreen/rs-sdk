// GE bidder (role `bidder`): keeps standing Grand Exchange buy offers for a list
// of items, each just above its competing best bid, until each line's target is
// held, then parks. Rules, options and the holdings log: docs/speedrun/helpers/bidder.md.
//
//   ROLE_OPTIONS='{"lines":[
//       {"item":"Dragon bones","target":555,"tranche":30,"maxPrice":12000,"minPrice":6000,"step":1000,"stepAfterIdleMinutes":60},
//       {"item":"Grapes","target":520,"tranche":150,"maxPrice":3000,"minPrice":1650}]}' \
//     bun speedrun/helpers/bidder.ts cairn_h61
//
// Lines take coins in list order: a line short of coins reserves what it is
// missing, and later lines spend only what is above the reservations.
//
// Funding: one trip on a coin earner trades its banked coins to the bidder, which
// accepts trades from `funders` (our helper accounts) and gives nothing back:
//
//   ROLE_OPTIONS='{"bidder":"cairn_h61"}' bun speedrun/helpers/bidder.ts cairn_h60 fund
import type { GEOffer, MarketQuote } from '../../sdk/index';
import { TRADE_REQUEST_CHAT_TYPE } from '../../sdk/types';
import { give, receiveFrom } from '../lib/trade';
import { BANKS, Buyer } from './buyer';
import { accountMatches, ChatCursor, DEFAULT_COURIERS, toRegExps } from './mule';
import { runStandalone, type Role, type RoleContext } from './role';

// ------------------------------------------------------------------ options

export interface LineOptions {
    /** Item name as the game spells it, or its id. */
    item: string | number;
    /** Stop bidding once this many are held (bank + inventory + uncollected fills). */
    target: number;
    /** Quantity kept resting on the book while short of the target. */
    tranche: number;
    /** Hard cap per item: never bid above it. */
    maxPrice: number;
    /**
     * Never bid below this. The bidder also never lowers its own price: a new
     * tranche starts at the highest price it has bid, so sellers who answered
     * that price keep finding it.
     */
    minPrice: number;
    /** How far above a competing bid we place (when `step` is not set). */
    outbidBy: number;
    /** Step mode: our price moves only in whole steps from our own price, never jumping. */
    step: number | null;
    /** Step mode: raise one step after this many minutes without a fill. */
    stepAfterIdleMinutes: number | null;
}

export interface BidderOptions {
    /** In priority order: earlier lines are funded first. */
    lines: LineOptions[];
    /** Minutes between rechecks of the market. */
    recheckMinutes: number;
    /**
     * Minutes between peeks at our offers for fills waiting to be collected. The
     * exchange is opened only for the peek: an account with it open answers trade
     * requests with "busy", which would turn funders away.
     */
    fillCheckMinutes: number;
    /** Accounts (login-name RegExps) whose trades are accepted as funding. */
    funders: RegExp[];
}

/** Offers per line the bidder will hold at once (the server allows 6 per account). */
export const MAX_OFFERS_PER_LINE = 2;

function numberOption(raw: Record<string, unknown>, where: string) {
    return (key: string, fallback: number | undefined, min: number): number => {
        const v = raw[key] ?? fallback;
        if (typeof v !== 'number' || !Number.isFinite(v) || v < min) throw new Error(`bidder: ${where}${key} must be a number >= ${min} (got ${JSON.stringify(raw[key])})`);
        return v;
    };
}

export function lineOptions(raw: Record<string, unknown>, where = ''): LineOptions {
    const num = numberOption(raw, where);
    const item = raw.item;
    if (typeof item !== 'string' && typeof item !== 'number') throw new Error(`bidder: ${where}item is required (name or id)`);
    const step = raw.step === undefined ? null : Math.floor(num('step', undefined, 1));
    const idle = raw.stepAfterIdleMinutes === undefined ? null : num('stepAfterIdleMinutes', undefined, 1);
    if (idle !== null && step === null) throw new Error(`bidder: ${where}stepAfterIdleMinutes needs step`);
    return {
        item,
        target: Math.floor(num('target', undefined, 1)),
        tranche: Math.floor(num('tranche', 150, 1)),
        maxPrice: Math.floor(num('maxPrice', undefined, 1)),
        minPrice: Math.floor(num('minPrice', 0, 0)),
        outbidBy: Math.floor(num('outbidBy', 25, 1)),
        step,
        stepAfterIdleMinutes: idle
    };
}

/** `lines` is the list; without it, the options themselves are the one line. */
export function bidderOptions(raw: Record<string, unknown>): BidderOptions {
    const num = numberOption(raw, '');
    const rawLines = raw.lines === undefined ? [raw] : raw.lines;
    if (!Array.isArray(rawLines) || rawLines.length === 0) throw new Error('bidder: lines must be a non-empty list');
    const lines = rawLines.map((l, i) => lineOptions(l as Record<string, unknown>, raw.lines === undefined ? '' : `lines[${i}].`));
    const keys = lines.map(l => String(l.item).toLowerCase());
    if (new Set(keys).size !== keys.length) throw new Error('bidder: an item appears in two lines');
    return {
        lines,
        recheckMinutes: num('recheckMinutes', 30, 0.5),
        fillCheckMinutes: num('fillCheckMinutes', 3, 0.5),
        funders: toRegExps(raw.funders ?? DEFAULT_COURIERS)
    };
}

// ------------------------------------------------------------------ decisions (pure)

export type OwnOffer = Pick<GEOffer, 'id' | 'item' | 'side' | 'state' | 'price' | 'quantity' | 'remaining' | 'filled' | 'items' | 'coins'>;
export type MarketView = Pick<MarketQuote, 'bid' | 'ask' | 'buyQuantity' | 'buyValue' | 'lastPrice'>;

/** Our open buy offers for the item that still have something left to fill. */
export function openOwn(offers: readonly OwnOffer[], itemId: number): OwnOffer[] {
    return offers.filter(o => o.item === itemId && o.side === 'buy' && o.state === 'open' && o.remaining > 0);
}

export interface Competition {
    /** The best bid that is not ours, when it is known; null when nobody else is visible above ours. */
    competing: number | null;
    /** Someone bids above our best price. */
    outbid: boolean;
    /** Every other resting bid is at exactly our price. We placed first, so we keep time priority. */
    tie: boolean;
    /** Our offer is the best and others rest below it: their average price (their best is at least this). */
    belowAvg: number | null;
    /** Quantity bid by everyone else. */
    otherQty: number;
    /** The market does not show our offer yet (its quotes lag a placement by seconds). */
    stale: boolean;
}

/**
 * The competing best bid, excluding our own offers. The market API shows only the
 * best bid and the totals of every open bid (`buyQuantity`, `buyValue` = coins in
 * escrow), so subtract ours from the totals: whatever is left belongs to others.
 * When ours is the best, the others' best is unknown, but if their escrow equals
 * their quantity at our price, they all sit at our price (a tie).
 */
export function competingBid(quote: MarketView, ours: readonly OwnOffer[]): Competition {
    const ourQty = ours.reduce((a, o) => a + o.remaining, 0);
    const otherQty = Math.max(0, quote.buyQuantity - ourQty);
    const base: Competition = { competing: quote.bid, outbid: false, tie: false, belowAvg: null, otherQty, stale: false };
    if (ours.length === 0) return { ...base, otherQty: quote.buyQuantity };
    const ourPrice = Math.max(...ours.map(o => o.price));
    if (quote.bid === null) return { ...base, competing: null, stale: true };
    if (quote.bid > ourPrice) return { ...base, outbid: true };
    // Below ours: the quote predates our offer, so its best bid is someone else's.
    if (quote.bid < ourPrice) return { ...base, stale: true, otherQty: quote.buyQuantity };
    const otherValue = quote.buyValue - ours.reduce((a, o) => a + o.remaining * o.price, 0);
    if (otherQty <= 0) return { ...base, competing: null };
    if (otherValue >= otherQty * ourPrice) return { ...base, competing: ourPrice, tie: true };
    return { ...base, competing: null, belowAvg: Math.round(otherValue / otherQty) };
}

export interface BidInput {
    /** Items held: bank + inventory + fills waiting in the exchange. */
    held: number;
    /** Our open offers for the item (openOwn). */
    ours: readonly OwnOffer[];
    quote: MarketView;
    /** Coins this line may spend now (carried + banked), excluding escrow. */
    coins: number;
    options: LineOptions;
    /** The highest price this bidder has bid for the item (its price never goes down). */
    floor?: number;
    /** Minutes since this line last saw a fill (step mode's idle rule). */
    idleMinutes?: number;
}

export interface BidDecision {
    /**
     * done: the target is held; cancel what still rests and stop.
     * hold: keep the book as it is.
     * place: add an offer (fresh, or a top-up at our price while we are still the best bid).
     * replace: raise (outbid, idle step, or below our floor): cancel ours, then place at `price` or above.
     * short: no offer resting and not enough coins for even one item.
     */
    action: 'done' | 'hold' | 'place' | 'replace' | 'short';
    competition: Competition;
    /** Offers to cancel first (done, replace). */
    cancel: number[];
    /** place: the new offer's price; replace: the price the replacement starts from. */
    price: number | null;
    quantity: number;
    /** At maxPrice and wanting to go higher: we do not raise. */
    capped: boolean;
    /** Coins missing to rest a whole tranche (0 when funded). */
    coinsShort: number;
    /**
     * Coins this line wants kept for itself beyond what it has placed: a top-up
     * waiting for a free slot or for enough coins, or a tranche it cannot fund.
     * Lines after it spend only what is above the reservations.
     */
    reserve: number;
    reason: string;
}

/**
 * The price for an offer that starts from `base` (our floor, or our price when
 * outbid) and must beat `competing`: competing + outbidBy, or in step mode the
 * first whole step from `base` above it. Never above maxPrice.
 */
export function priceAbove(competing: number | null, base: number, o: LineOptions): { price: number; capped: boolean } {
    let wanted = base;
    if (competing !== null && competing >= base) {
        wanted = o.step !== null ? base + (Math.floor((competing - base) / o.step) + 1) * o.step : competing + o.outbidBy;
    }
    return { price: Math.min(wanted, o.maxPrice), capped: competing !== null && competing >= o.maxPrice };
}

export function decideBid(input: BidInput): BidDecision {
    const { held, quote, coins, options: o } = input;
    const ours = input.ours.filter(x => x.side === 'buy' && x.state === 'open' && x.remaining > 0);
    const competition = competingBid(quote, ours);
    const out = (d: Partial<BidDecision> & Pick<BidDecision, 'action' | 'reason'>): BidDecision => ({ competition, cancel: [], price: null, quantity: 0, capped: false, coinsShort: 0, reserve: d.coinsShort ?? 0, ...d });
    const need = o.target - held;
    if (need <= 0) return out({ action: 'done', cancel: ours.map(x => x.id), reason: `holding ${held} of ${o.target}` });

    const wanted = Math.min(o.tranche, need);
    const resting = ours.reduce((a, x) => a + x.remaining, 0);
    const escrow = ours.reduce((a, x) => a + x.remaining * x.price, 0);
    const floorPrice = Math.min(Math.max(o.minPrice, input.floor ?? 0), o.maxPrice);
    const replace = (price: number, capped: boolean, reason: string) =>
        out({ action: 'replace', cancel: ours.map(x => x.id), price, quantity: Math.min(wanted, Math.floor((coins + escrow) / price)), capped, coinsShort: Math.max(0, wanted * price - coins - escrow), reason });

    if (ours.length > 0) {
        const ourPrice = Math.max(...ours.map(x => x.price));
        if (competition.outbid) {
            if (ourPrice >= o.maxPrice) return out({ action: 'hold', price: ourPrice, capped: true, reason: `outbid at ${competition.competing}, already at maxPrice ${o.maxPrice}` });
            const { price, capped } = priceAbove(competition.competing, Math.max(ourPrice, floorPrice), o);
            return replace(price, capped, `outbid at ${competition.competing}; ours ${ourPrice}`);
        }
        // Resting below our own floor (minPrice raised, or an offer from before a restart): re-price up.
        if (ourPrice < floorPrice) return replace(floorPrice, false, `ours ${ourPrice} is below our floor ${floorPrice}`);
        // Step mode: no fills for a while means sellers want more; one step, never a jump.
        if (o.step !== null && o.stepAfterIdleMinutes !== null && (input.idleMinutes ?? 0) >= o.stepAfterIdleMinutes) {
            if (ourPrice >= o.maxPrice) return out({ action: 'hold', price: ourPrice, capped: true, reason: `no fills for ${Math.round(input.idleMinutes ?? 0)} min, already at maxPrice ${o.maxPrice}` });
            return replace(Math.min(ourPrice + o.step, o.maxPrice), false, `no fills for ${Math.round(input.idleMinutes ?? 0)} min: one step up from ${ourPrice}`);
        }
        // Still the best bid. Top the book back up to a tranche once a quarter of it has
        // filled, never with less than a quarter tranche (each offer takes one of 6 slots).
        const minTopUp = Math.max(1, Math.ceil(o.tranche / 4));
        const topUp = wanted - resting;
        if (topUp < minTopUp) return out({ action: 'hold', price: ourPrice, reason: `best bid at ${ourPrice}, ${resting} resting` });
        if (ours.length >= MAX_OFFERS_PER_LINE) return out({ action: 'hold', price: ourPrice, reserve: topUp * ourPrice, reason: `best bid at ${ourPrice}; ${ours.length} offers already, top up when one completes` });
        const quantity = Math.min(topUp, Math.floor(coins / ourPrice));
        const coinsShort = Math.max(0, topUp * ourPrice - coins);
        if (quantity < minTopUp) return out({ action: 'hold', price: ourPrice, coinsShort, reserve: topUp * ourPrice, reason: `best bid at ${ourPrice}; coins for ${quantity} of a ${topUp} top-up` });
        return out({ action: 'place', price: ourPrice, quantity, coinsShort, reason: `top up ${resting} resting to ${resting + quantity}` });
    }

    // No offer: start from our floor, or from the last trade when we have none.
    const base = floorPrice > 0 ? floorPrice : competition.competing === null ? Math.max(quote.lastPrice ?? 1, 1) : 0;
    const { price, capped } = priceAbove(competition.competing, base, o);
    const quantity = Math.min(wanted, Math.floor(coins / price));
    const coinsShort = Math.max(0, wanted * price - coins);
    if (quantity <= 0) return out({ action: 'short', price, capped, coinsShort, reserve: wanted * price, reason: `${coins} gp buys none at ${price}` });
    return out({ action: 'place', price, quantity, capped, coinsShort, reason: competition.competing === null ? 'no competing bid' : `competing bid ${competition.competing}` });
}

// ------------------------------------------------------------------ the role

const POLL_MS = 10_000;
const HEARTBEAT_MS = 10 * 60_000;
/** At most one early cycle (fills waiting, coins arrived) per this long. */
const EARLY_MIN_GAP_MS = 2 * 60_000;
const VARROCK_WEST = BANKS.varrockWest;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise(resolve => {
        if (signal.aborted) return resolve();
        const timer = setTimeout(done, ms);
        signal.addEventListener('abort', done, { once: true });
        function done() {
            clearTimeout(timer);
            signal.removeEventListener('abort', done);
            resolve();
        }
    });
}

const iso = (ms: number | null) => (ms ? new Date(ms).toISOString() : null);

/** What the market showed at a recheck, to report competitor moves and trades between rechecks. */
interface MarketMemo {
    competing: number | null;
    belowAvg: number | null;
    otherQty: number;
    lastPrice: number | null;
    lastTradeAt: number | null;
    volume: number;
}

interface Line {
    o: LineOptions;
    id: number;
    name: string;
    floor: number;
    lastFillAt: number;
    fillsSinceLog: number;
    reached: boolean;
    prev: MarketMemo | null;
}

export class Bidder {
    private readonly o: BidderOptions;
    private readonly buyer: Buyer;
    private readonly requests: ChatCursor;
    private lines: Line[] = [];
    private lastCycle = 0;
    private lastPeek = 0;
    private lastLog = Date.now();
    private wantEarly = false;
    private last: Record<string, unknown>[] = [];

    constructor(private readonly ctx: RoleContext) {
        this.o = bidderOptions(ctx.options);
        this.buyer = new Buyer(ctx);
        this.requests = new ChatCursor(ctx.sdk, [TRADE_REQUEST_CHAT_TYPE]);
    }

    private log(message: string, data?: Record<string, unknown>): void {
        this.lastLog = Date.now();
        this.ctx.log(message, data);
    }

    private coins(): number {
        return this.ctx.sdk.getInventory().filter(i => i.name === 'Coins').reduce((a, i) => a + i.count, 0);
    }

    private ours(line: Line): OwnOffer[] {
        const ours = openOwn(this.ctx.sdk.getGEState()?.offers ?? [], line.id);
        for (const o of ours) line.floor = Math.max(line.floor, o.price);
        return ours;
    }

    private async openGE(): Promise<void> {
        const r = await this.ctx.bot.openGE();
        if (!r.success) throw new Error(`openGE: ${r.message}`);
    }

    private get parked(): boolean {
        return this.lines.every(l => l.reached);
    }

    async run(): Promise<void> {
        const { ctx } = this;
        await this.buyer.prepare();
        await ctx.bot.dismissBlockingUI();
        if (ctx.sdk.getTradeState().isOpen) await ctx.bot.declineTrade();
        const now = Date.now();
        for (const o of this.o.lines) {
            const { id, name } = await this.buyer.resolveItem(o.item);
            this.lines.push({ o, id, name, floor: 0, lastFillAt: now, fillsSinceLog: 0, reached: false, prev: null });
        }
        this.log('phase', { phase: 'bid', lines: this.lines.map(l => ({ ...l.o, item: l.name, id: l.id })), recheckMinutes: this.o.recheckMinutes });

        while (!ctx.signal.aborted) {
            const due = Date.now() - this.lastCycle >= this.o.recheckMinutes * 60_000;
            const early = this.wantEarly && Date.now() - this.lastCycle >= EARLY_MIN_GAP_MS;
            if (!this.parked && (due || early)) {
                try {
                    await this.cycle();
                } catch (e) {
                    this.log('cycle error', { error: String(e) });
                }
                this.lastCycle = Date.now();
                this.wantEarly = false;
            }
            try {
                await this.acceptFunding();
                if (!this.parked && Date.now() - this.lastPeek >= this.o.fillCheckMinutes * 60_000) {
                    this.lastPeek = Date.now();
                    await this.peekFills();
                }
            } catch (e) {
                this.log('poll error', { error: String(e) });
            }
            if (Date.now() - this.lastLog >= HEARTBEAT_MS) {
                const nextMin = Math.max(0, Math.round((this.lastCycle + this.o.recheckMinutes * 60_000 - Date.now()) / 60_000));
                this.log(this.parked ? 'parked' : 'waiting', { nextRecheckMin: this.parked ? null : nextMin, lines: this.last });
            }
            await sleep(POLL_MS, ctx.signal);
        }
    }

    /** Between rechecks: glance at our offers and cycle early once a fill is waiting. */
    private async peekFills(): Promise<void> {
        await this.openGE();
        const ids = new Set(this.lines.map(l => l.id));
        const offers = (this.ctx.sdk.getGEState()?.offers ?? []).filter(o => ids.has(o.item));
        await this.ctx.bot.closeInterface();
        if (offers.some(o => o.items > 0 || o.coins > 0)) this.wantEarly = true;
    }

    /** Accept a trade from a funder: they give, we give nothing. */
    private async acceptFunding(): Promise<void> {
        const { sdk, bot } = this.ctx;
        const senders = [...new Set(this.requests.next().map(m => m.sender))].filter(n => this.o.funders.some(p => accountMatches(n, p)));
        for (const from of senders) {
            if (sdk.getGEState()) await bot.closeInterface();
            const before = this.coins();
            const r = await receiveFrom(sdk, from, { openTimeoutMs: 20_000 });
            this.log('funded', { from, ok: r.ok, reason: r.reason, received: r.received.map(i => `${i.name} x${i.count}`), coinsCarried: this.coins(), gained: this.coins() - before });
            if (r.ok) this.wantEarly = true;
        }
    }

    /** Collect everything waiting at the open exchange, crediting each line's fills first. */
    private async collect(): Promise<void> {
        const offers = this.ctx.sdk.getGEState()?.offers ?? [];
        for (const line of this.lines) {
            const n = offers.filter(o => o.item === line.id).reduce((a, o) => a + o.items, 0);
            if (n > 0) {
                line.lastFillAt = Date.now();
                line.fillsSinceLog += n;
            }
        }
        await this.buyer.collectFills();
    }

    /**
     * One recheck: collect fills and refunds, bank them and take every coin, decide
     * each line in priority order against a fresh quote, act, collect instant fills,
     * bank, and log holdings per line.
     */
    private async cycle(): Promise<void> {
        const { bot, sdk } = this.ctx;
        // 1. Fills and refunds count only once collected.
        await this.openGE();
        await this.collect();
        await bot.closeInterface();
        // 2. Bank the produce; GE offers are paid from the inventory, so carry every coin.
        await this.buyer.atBank(VARROCK_WEST, async () => {
            await this.buyer.depositAllBut(['Coins']);
            const inBank = sdk.getBankItems().find(i => i.name === 'Coins')?.count ?? 0;
            await this.buyer.setCoins(this.coins() + inBank);
        });
        // 3. Each line in order. A line short of coins reserves what it is missing, and
        // the lines after it get only the coins above all earlier reservations. A line's
        // own refund after a cancel counts like any other coin.
        await this.openGE();
        let reserved = 0;
        const available = () => Math.max(0, this.coins() - reserved);
        const seen = new Map<Line, { quote: MarketQuote; d: BidDecision }>();
        for (const line of this.lines) {
            if (line.reached) continue;
            const quote = await sdk.getMarketItem(line.id);
            const decide = (q: MarketView) =>
                decideBid({
                    held: this.buyer.held(line.name),
                    ours: this.ours(line),
                    quote: q,
                    coins: available(),
                    options: line.o,
                    floor: line.floor,
                    idleMinutes: (Date.now() - line.lastFillAt) / 60_000
                });
            let d = decide(quote);
            this.log('decision', { item: line.name, action: d.action, reason: d.reason, price: d.price, quantity: d.quantity, cancel: d.cancel, bid: quote.bid, ask: quote.ask, coins: available(), reserved, ...d.competition });
            if (d.action === 'done' || d.action === 'replace') {
                for (const id of d.cancel) {
                    const r = await bot.cancelGEOffer(id);
                    this.log('cancel', { item: line.name, id, success: r.success, result: r.message });
                }
                await this.collect();
                if (d.action === 'replace' && d.price !== null) {
                    // A raise sets the floor, and restarts the idle clock. Then decide again
                    // from scratch: ours is gone from the book.
                    line.floor = Math.max(line.floor, d.price);
                    line.lastFillAt = Date.now();
                    d = decide(await sdk.getMarketItem(line.id));
                    this.log('decision', { item: line.name, action: d.action, reason: d.reason, price: d.price, quantity: d.quantity, coins: available(), reserved, ...d.competition });
                }
            }
            if (d.action === 'place' && d.price !== null) {
                const r = await bot.placeGEOffer({ item: line.id, side: 'buy', quantity: d.quantity, price: d.price });
                if (r.success) line.floor = Math.max(line.floor, d.price);
                this.log('offer', { item: line.name, success: r.success, result: r.message, reason: r.reason, outcome: r.outcome, id: r.offer?.id, price: d.price, quantity: d.quantity, filled: r.offer?.filled });
                await this.collect();
            }
            if (d.capped) this.log('capped', { item: line.name, competing: d.competition.competing, maxPrice: line.o.maxPrice, price: d.price, note: 'at maxPrice and wanting more: not raising; tell cairn://p/rs/41 with the fill history' });
            reserved += d.reserve;
            if (d.coinsShort > 0 && d.action !== 'done') this.log('short', { item: line.name, coinsShort: d.coinsShort, price: d.price, coins: this.coins(), reserved, note: 'fund the bidder: bidder.ts <earner> fund' });
            seen.set(line, { quote, d });
        }
        const offersNow = new Map(this.lines.map(l => [l, this.ours(l)] as const));
        await bot.closeInterface();
        // 4. Bank what came in and the leftover coins, and report.
        await this.buyer.atBank(VARROCK_WEST, () => this.buyer.depositAllBut([]));
        this.last = [];
        for (const line of this.lines) {
            const s = seen.get(line);
            if (!s) continue;
            this.last.push(this.holdings(line, offersNow.get(line) ?? [], s.quote, s.d));
        }
    }

    /** Log the line's holdings, with competitor moves and market trades since the last recheck. */
    private holdings(line: Line, ours: OwnOffer[], quote: MarketQuote, d: BidDecision): Record<string, unknown> {
        const held = this.buyer.held(line.name);
        const best = ours.slice().sort((a, b) => b.price - a.price)[0];
        const memo: MarketMemo = {
            competing: d.competition.competing,
            belowAvg: d.competition.belowAvg,
            otherQty: d.competition.otherQty,
            lastPrice: quote.lastPrice,
            lastTradeAt: quote.lastTradeAt,
            volume: quote.volume
        };
        const prev = line.prev;
        // The others' best bid, whether it shows as the market bid or (under ours) as their average.
        const theirBid = (m: MarketMemo) => m.competing ?? m.belowAvg;
        const competitorMoved =
            prev !== null && (theirBid(prev) !== theirBid(memo) || prev.otherQty !== memo.otherQty)
                ? { from: { bid: theirBid(prev), depth: prev.otherQty }, to: { bid: theirBid(memo), depth: memo.otherQty } }
                : null;
        const traded = prev === null || (memo.lastTradeAt ?? 0) > (prev.lastTradeAt ?? 0) ? { lastPrice: memo.lastPrice, at: iso(memo.lastTradeAt), volume7d: memo.volume, volumeDelta: prev ? memo.volume - prev.volume : null } : null;
        line.prev = memo;
        const row = {
            item: line.name,
            held,
            target: line.o.target,
            offer: best ? best.id : null,
            price: best ? best.price : null,
            remaining: ours.reduce((a, o) => a + o.remaining, 0),
            offers: ours.length,
            filledSinceLast: line.fillsSinceLog,
            lastFillAt: iso(line.lastFillAt),
            competing: d.competition.competing,
            competingBelow: d.competition.belowAvg,
            otherDepth: d.competition.otherQty,
            competitorMoved,
            traded,
            coins: this.buyer.held('Coins'),
            escrow: ours.reduce((a, o) => a + o.remaining * o.price, 0)
        };
        line.fillsSinceLog = 0;
        this.log('holdings', row);
        if (competitorMoved) this.log('competitor', { item: line.name, ...competitorMoved, at: new Date().toISOString() });
        if (held >= line.o.target && ours.length === 0) {
            line.reached = true;
            this.log('phase', { phase: this.parked ? 'parked' : 'bid', item: line.name, held, target: line.o.target, note: 'target held; this line stops bidding' });
        }
        return row;
    }
}

export const role: Role = {
    name: 'bidder',
    produces: [],
    async run(ctx) {
        await new Bidder(ctx).run();
    }
};

// ------------------------------------------------------------------ funding trip

export interface FundOptions {
    /** The account to give to (the bidder, or any receiver waiting at Varrock west bank). */
    bidder: string;
    /** A stackable item to give instead of coins, by exact name (default 'Coins'), e.g. 'Feather'. */
    item?: string;
    /** How many to give (default: all, less `keep`). */
    amount?: number;
    /** How many to leave in this account's bank (default 0). */
    keep?: number;
}

/** What a fund trip carries, given how many the giver holds (bank + pack): `item` (default Coins), all of it less `keep`, at most `amount`. */
export function fundPlan(o: Pick<FundOptions, 'item' | 'amount' | 'keep'>, held: number): { item: string; count: number } {
    return { item: o.item ?? 'Coins', count: Math.max(0, Math.min(o.amount ?? Infinity, held - (o.keep ?? 0))) };
}

/** One trip: walk to Varrock west bank, withdraw coins (or `item`), trade them to the receiver, bank anything left. */
export async function fundTrip(ctx: RoleContext): Promise<{ ok: boolean; gave: number }> {
    const o = ctx.options as unknown as FundOptions;
    if (!o.bidder) throw new Error('fund: options.bidder is required');
    const item = fundPlan(o, 0).item;
    const buyer = new Buyer(ctx);
    await buyer.prepare();
    await ctx.bot.dismissBlockingUI();
    if (ctx.sdk.getTradeState().isOpen) await ctx.bot.declineTrade();
    const carriedNow = () => ctx.sdk.getInventory().filter(i => i.name === item).reduce((a, i) => a + i.count, 0);
    let carried = 0;
    await buyer.atBank(VARROCK_WEST, async () => {
        await buyer.depositAllBut([item]);
        const total = carriedNow() + (ctx.sdk.getBankItems().find(i => i.name === item)?.count ?? 0);
        const want = fundPlan(o, total).count;
        if (item === 'Coins') carried = await buyer.setCoins(want);
        else {
            if (carriedNow() > want) await ctx.bot.depositItem(item, carriedNow() - want);
            if (carriedNow() < want) await ctx.bot.withdrawItem(item, want - carriedNow());
            carried = carriedNow();
        }
    });
    if (carried <= 0) {
        ctx.log('fund: nothing to give', { item });
        return { ok: false, gave: 0 };
    }
    ctx.log('fund: trading', { bidder: o.bidder, item, count: carried });
    const r = await give(ctx.sdk, o.bidder, [{ item, n: carried }], { openTimeoutMs: 180_000 });
    const gave = r.gave.filter(i => i.name === item).reduce((a, i) => a + i.count, 0);
    ctx.log('fund: trade', { ok: r.ok, reason: r.reason, gave, ticks: r.ticks });
    // A failed trade leaves the coins carried: put them back.
    await buyer.atBank(VARROCK_WEST, () => buyer.depositAllBut([]));
    return { ok: r.ok, gave };
}

export const funder: Role = {
    name: 'bidder-fund',
    produces: [],
    async run(ctx) {
        await fundTrip(ctx);
    }
};

if (import.meta.main) await runStandalone(process.argv[3] === 'fund' ? funder : role);
