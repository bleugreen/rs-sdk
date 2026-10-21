// GE bidder (role `bidder`): keeps a standing Grand Exchange buy offer for one
// item just above the competing best bid until a target quantity is held, then
// parks. Rules, options and the holdings log: docs/speedrun/helpers/bidder.md.
//
//   ROLE_OPTIONS='{"item":"Grapes","target":520,"tranche":150,"maxPrice":3000}' \
//     bun speedrun/helpers/bidder.ts cairn_h61
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

export interface BidderOptions {
    /** Item name as the game spells it, or its id. */
    item: string | number;
    /** Stop bidding once this many are held (bank + inventory + uncollected fills). */
    target: number;
    /** Quantity kept resting on the book while short of the target. */
    tranche: number;
    /** Hard cap per item: never bid above it. */
    maxPrice: number;
    /** Minutes between rechecks of the market. */
    recheckMinutes: number;
    /** How far above the competing bid we place. */
    outbidBy: number;
    /** Never bid below this (used when nobody else is bidding). */
    minPrice: number;
    /** Accounts (login-name RegExps) whose trades are accepted as funding. */
    funders: RegExp[];
}

export function bidderOptions(raw: Record<string, unknown>): BidderOptions {
    const num = (key: string, fallback: number | undefined, min: number): number => {
        const v = raw[key] ?? fallback;
        if (typeof v !== 'number' || !Number.isFinite(v) || v < min) throw new Error(`bidder: option ${key} must be a number >= ${min} (got ${JSON.stringify(raw[key])})`);
        return v;
    };
    const item = raw.item;
    if (typeof item !== 'string' && typeof item !== 'number') throw new Error('bidder: option item is required (name or id)');
    return {
        item,
        target: Math.floor(num('target', undefined, 1)),
        tranche: Math.floor(num('tranche', 150, 1)),
        maxPrice: Math.floor(num('maxPrice', 3000, 1)),
        recheckMinutes: num('recheckMinutes', 30, 0.5),
        outbidBy: Math.floor(num('outbidBy', 25, 1)),
        minPrice: Math.floor(num('minPrice', 0, 0)),
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
    const base: Competition = { competing: quote.bid, outbid: false, tie: false, belowAvg: null, stale: false };
    if (ours.length === 0) return base;
    const ourPrice = Math.max(...ours.map(o => o.price));
    if (quote.bid === null) return { ...base, competing: null, stale: true };
    if (quote.bid > ourPrice) return { ...base, outbid: true };
    // Below ours: the quote predates our offer, so its best bid is someone else's.
    if (quote.bid < ourPrice) return { ...base, stale: true };
    const otherQty = quote.buyQuantity - ours.reduce((a, o) => a + o.remaining, 0);
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
    /** Coins we can spend now (carried + banked), excluding escrow. */
    coins: number;
    options: BidderOptions;
}

export interface BidDecision {
    /**
     * done: the target is held; cancel what still rests and stop.
     * hold: keep the book as it is.
     * place: add an offer (fresh, or a top-up at our price while we are still the best bid).
     * replace: we are outbid; cancel ours, then re-decide with a fresh quote and place again.
     * short: no offer resting and not enough coins for even one item.
     */
    action: 'done' | 'hold' | 'place' | 'replace' | 'short';
    competition: Competition;
    /** Offers to cancel first (done, replace). */
    cancel: number[];
    /** place: the new offer's price; replace: the price the replacement aims at. */
    price: number | null;
    quantity: number;
    /** The competing bid is at or above maxPrice: we sit at maxPrice and do not raise. */
    capped: boolean;
    /** Coins missing to rest a whole tranche (0 when funded). */
    coinsShort: number;
    reason: string;
}

/** Our price for a new offer: just above the competing bid, never below minPrice or above maxPrice. */
export function bidPrice(competing: number | null, quote: MarketView, o: BidderOptions): { price: number; capped: boolean } {
    const wanted = competing !== null ? competing + o.outbidBy : Math.max(quote.lastPrice ?? 1, 1);
    const price = Math.min(Math.max(wanted, o.minPrice), o.maxPrice);
    return { price, capped: competing !== null && competing >= o.maxPrice };
}

export function decideBid(input: BidInput): BidDecision {
    const { held, quote, coins, options: o } = input;
    const ours = input.ours.filter(x => x.side === 'buy' && x.state === 'open' && x.remaining > 0);
    const competition = competingBid(quote, ours);
    const out = (d: Partial<BidDecision> & Pick<BidDecision, 'action' | 'reason'>): BidDecision => ({ competition, cancel: [], price: null, quantity: 0, capped: false, coinsShort: 0, ...d });
    const need = o.target - held;
    if (need <= 0) return out({ action: 'done', cancel: ours.map(x => x.id), reason: `holding ${held} of ${o.target}` });

    const wanted = Math.min(o.tranche, need);
    const resting = ours.reduce((a, x) => a + x.remaining, 0);
    const escrow = ours.reduce((a, x) => a + x.remaining * x.price, 0);

    if (ours.length > 0) {
        const ourPrice = Math.max(...ours.map(x => x.price));
        if (competition.outbid) {
            if (ourPrice >= o.maxPrice) return out({ action: 'hold', price: ourPrice, capped: true, reason: `outbid at ${competition.competing}, already at maxPrice ${o.maxPrice}` });
            const { price, capped } = bidPrice(competition.competing, quote, o);
            const quantity = Math.min(wanted, Math.floor((coins + escrow) / price));
            return out({
                action: 'replace',
                cancel: ours.map(x => x.id),
                price,
                quantity,
                capped,
                coinsShort: Math.max(0, wanted * price - coins - escrow),
                reason: `outbid at ${competition.competing}; ours ${ourPrice}`
            });
        }
        // Still the best bid. Top the book back up to a tranche once a quarter of it has filled.
        const topUp = wanted - resting;
        if (topUp < Math.max(1, Math.ceil(o.tranche / 4))) return out({ action: 'hold', price: ourPrice, reason: `best bid at ${ourPrice}, ${resting} resting` });
        const quantity = Math.min(topUp, Math.floor(coins / ourPrice));
        const coinsShort = Math.max(0, topUp * ourPrice - coins);
        if (quantity <= 0) return out({ action: 'hold', price: ourPrice, coinsShort, reason: `best bid at ${ourPrice}; no coins to top up ${topUp}` });
        return out({ action: 'place', price: ourPrice, quantity, coinsShort, reason: `top up ${resting} resting to ${resting + quantity}` });
    }

    const { price, capped } = bidPrice(competition.competing, quote, o);
    const quantity = Math.min(wanted, Math.floor(coins / price));
    const coinsShort = Math.max(0, wanted * price - coins);
    if (quantity <= 0) return out({ action: 'short', price, capped, coinsShort, reason: `${coins} gp buys none at ${price}` });
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

export class Bidder {
    private readonly o: BidderOptions;
    private readonly buyer: Buyer;
    private readonly requests: ChatCursor;
    private item: { id: number; name: string } = { id: 0, name: '' };
    private lastCycle = 0;
    private lastLog = Date.now();
    private reached = false;
    private wantEarly = false;
    private last: Record<string, unknown> = {};

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

    private ours(): OwnOffer[] {
        return openOwn(this.ctx.sdk.getGEState()?.offers ?? [], this.item.id);
    }

    private async openGE(): Promise<void> {
        const r = await this.ctx.bot.openGE();
        if (!r.success) throw new Error(`openGE: ${r.message}`);
    }

    async run(): Promise<void> {
        const { ctx } = this;
        await this.buyer.prepare();
        await ctx.bot.dismissBlockingUI();
        if (ctx.sdk.getTradeState().isOpen) await ctx.bot.declineTrade();
        this.item = await this.buyer.resolveItem(this.o.item);
        this.log('phase', { phase: 'bid', item: this.item.name, id: this.item.id, target: this.o.target, tranche: this.o.tranche, maxPrice: this.o.maxPrice, recheckMinutes: this.o.recheckMinutes });

        while (!ctx.signal.aborted) {
            const due = Date.now() - this.lastCycle >= this.o.recheckMinutes * 60_000;
            const early = this.wantEarly && Date.now() - this.lastCycle >= EARLY_MIN_GAP_MS;
            if (!this.reached && (due || early)) {
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
                if (!this.reached) await this.watchFills();
            } catch (e) {
                this.log('poll error', { error: String(e) });
            }
            if (Date.now() - this.lastLog >= HEARTBEAT_MS) {
                const nextMin = Math.max(0, Math.round((this.lastCycle + this.o.recheckMinutes * 60_000 - Date.now()) / 60_000));
                this.log(this.reached ? 'parked' : 'waiting', { ...this.last, nextRecheckMin: this.reached ? null : nextMin });
            }
            await sleep(POLL_MS, ctx.signal);
        }
    }

    /** Between rechecks: keep the exchange open and cycle early once a fill is waiting. */
    private async watchFills(): Promise<void> {
        if (!this.ctx.sdk.getGEState()) await this.openGE();
        const offers = (this.ctx.sdk.getGEState()?.offers ?? []).filter(o => o.item === this.item.id);
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

    /**
     * One recheck: collect fills and refunds, bank them and take every coin, decide
     * against a fresh quote, act, collect instant fills, bank, log holdings.
     */
    private async cycle(): Promise<void> {
        const { bot, sdk } = this.ctx;
        const name = this.item.name;
        // 1. Fills and refunds count only once collected.
        await this.openGE();
        await this.buyer.collectFills();
        await bot.closeInterface();
        // 2. Bank the produce; GE offers are paid from the inventory, so carry every coin.
        await this.buyer.atBank(VARROCK_WEST, async () => {
            await this.buyer.depositAllBut(['Coins']);
            const inBank = sdk.getBankItems().find(i => i.name === 'Coins')?.count ?? 0;
            await this.buyer.setCoins(this.coins() + inBank);
        });
        // 3. Decide against a fresh quote.
        await this.openGE();
        const quote = await sdk.getMarketItem(this.item.id);
        let d = decideBid({ held: this.buyer.held(name), ours: this.ours(), quote, coins: this.coins(), options: this.o });
        this.log('decision', { action: d.action, reason: d.reason, price: d.price, quantity: d.quantity, cancel: d.cancel, bid: quote.bid, ask: quote.ask, ...d.competition });
        if (d.action === 'done' || d.action === 'replace') {
            for (const id of d.cancel) {
                const r = await bot.cancelGEOffer(id);
                this.log('cancel', { id, success: r.success, message: r.message });
            }
            await this.buyer.collectFills();
            if (d.action === 'replace') {
                // Ours is gone from the book now: decide again from scratch.
                const fresh = await sdk.getMarketItem(this.item.id);
                d = decideBid({ held: this.buyer.held(name), ours: this.ours(), quote: fresh, coins: this.coins(), options: this.o });
                this.log('decision', { action: d.action, reason: d.reason, price: d.price, quantity: d.quantity, bid: fresh.bid, ask: fresh.ask, ...d.competition });
            }
        }
        if (d.action === 'place' && d.price !== null) {
            const r = await bot.placeGEOffer({ item: this.item.id, side: 'buy', quantity: d.quantity, price: d.price });
            this.log('offer', { success: r.success, message: r.message, reason: r.reason, outcome: r.outcome, id: r.offer?.id, price: d.price, quantity: d.quantity, filled: r.offer?.filled });
            await this.buyer.collectFills();
        }
        if (d.capped) this.log('capped', { competing: d.competition.competing, maxPrice: this.o.maxPrice, price: d.price, note: 'competitor at or past maxPrice: not raising; tell cairn://p/rs/41' });
        if (d.coinsShort > 0) this.log('short', { coinsShort: d.coinsShort, price: d.price, coins: this.coins(), note: 'fund the bidder: bidder.ts <earner> fund' });
        const ours = this.ours();
        await bot.closeInterface();
        // 4. Bank what came in and the leftover coins, and report.
        await this.buyer.atBank(VARROCK_WEST, () => this.buyer.depositAllBut([]));
        const held = this.buyer.held(name);
        const best = ours.slice().sort((a, b) => b.price - a.price)[0];
        this.last = {
            item: name,
            held,
            target: this.o.target,
            offer: best ? best.id : null,
            price: best ? best.price : null,
            remaining: ours.reduce((a, o) => a + o.remaining, 0),
            offers: ours.length,
            competing: d.competition.competing,
            competingBelow: d.competition.belowAvg,
            coins: this.buyer.held('Coins'),
            escrow: ours.reduce((a, o) => a + o.remaining * o.price, 0)
        };
        this.log('holdings', this.last);
        if (held >= this.o.target && ours.length === 0) {
            this.reached = true;
            this.log('phase', { phase: 'parked', held, target: this.o.target, note: 'target held; bidding stopped' });
        }
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
    /** The bidder account to give coins to. */
    bidder: string;
    /** Coins to give (default: all, less `keep`). */
    amount?: number;
    /** Coins left in this account's bank (default 0). */
    keep?: number;
}

/** One trip: walk to Varrock west bank, withdraw coins, trade them to the bidder, bank anything left. */
export async function fundTrip(ctx: RoleContext): Promise<{ ok: boolean; gave: number }> {
    const o = ctx.options as unknown as FundOptions;
    if (!o.bidder) throw new Error('fund: options.bidder is required');
    const buyer = new Buyer(ctx);
    await buyer.prepare();
    await ctx.bot.dismissBlockingUI();
    if (ctx.sdk.getTradeState().isOpen) await ctx.bot.declineTrade();
    const coins = () => ctx.sdk.getInventory().filter(i => i.name === 'Coins').reduce((a, i) => a + i.count, 0);
    let carried = 0;
    await buyer.atBank(VARROCK_WEST, async () => {
        await buyer.depositAllBut(['Coins']);
        const total = coins() + (ctx.sdk.getBankItems().find(i => i.name === 'Coins')?.count ?? 0);
        carried = await buyer.setCoins(Math.max(0, Math.min(o.amount ?? Infinity, total - (o.keep ?? 0))));
    });
    if (carried <= 0) {
        ctx.log('fund: no coins to give');
        return { ok: false, gave: 0 };
    }
    ctx.log('fund: trading', { bidder: o.bidder, coins: carried });
    const r = await give(ctx.sdk, o.bidder, [{ item: /^coins$/i, n: carried }], { openTimeoutMs: 180_000 });
    const gave = r.gave.filter(i => i.name === 'Coins').reduce((a, i) => a + i.count, 0);
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
