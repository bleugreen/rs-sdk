/**
 * The phase-2 runner's two Exchange errands, on a live session at the Varrock west bank: the shark purchase and a
 * sale into the open bids. The decisions are exchange.ts's; this walks, banks and places the offers.
 *
 * Both read the book before anything leaves the bank, and again just before the offer, since a bank visit takes
 * seconds and the book can move. A placement whose outcome is unknown (an observation timeout after the click) is
 * recorded and never retried: a second offer could double the trade. Other transient refusals of the shark purchase
 * are retried by the runner (sharks.ts). An offer still open when the account is
 * stopped stays on the Exchange; the next errand's `collect` returns its assets.
 *
 * Sales need the account at the Exchange, so plan.ts allows them only for methods worked within walking distance of
 * it (`SALE_ROUTE`): no return trip from Ardougne or Shilo exists yet.
 */
import type { GEOffer } from '../../sdk/ge-types';
import type { BotWorldState } from '../../sdk/types';
import { walkTo } from '../../speedrun/lib/act';
import { depositMatching } from '../../speedrun/lib/bank';
import { waitTicks, waitUntil } from '../../speedrun/lib/wait';
import type { MarketQuote } from '../lib/market.ts';
import { buyDecision, saleDecision, SHARK_ID } from './exchange.ts';
import { heldAfter, needsReread, type SharksAfter } from './sharks.ts';
import { carriedCoins, type StageCtx } from './stages.ts';

/** Stand inside the Varrock west bank; the Exchange table and teller are on its west side (sdk/MARKET.md). */
export const VARROCK_WEST_BANK = { x: 3185, z: 3436 };
/** Coins an account keeps in the pack after an errand: the ship to Ardougne costs 60. */
export const KEEP_COINS = 200;

export interface BookReader {
    item(id: number): Promise<MarketQuote>;
}

type ErrandCtx = Pick<StageCtx, 'sdk' | 'bot' | 'signal' | 'event' | 'reportBank'>;

const countIn = (items: readonly { id?: number; name: string; count: number }[], re: RegExp) => items.filter(i => re.test(i.name)).reduce((n, i) => n + i.count, 0);
const exact = (name: string) => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
const state = (x: ErrandCtx): BotWorldState => {
    const s = x.sdk.getState();
    if (!s?.player) throw new Error('no game state');
    return s;
};

async function atBank(x: ErrandCtx): Promise<void> {
    const w = await walkTo(x.bot, x.sdk, VARROCK_WEST_BANK.x, VARROCK_WEST_BANK.z, 3);
    if (!w.ok) throw new Error(`walk to the Varrock west bank: ${w.message}`);
    const opened = await x.bot.openBank();
    if (!opened.success) throw new Error(`openBank: ${opened.message}`);
}

/** Bank everything matching `items`, and the coins above KEEP_COINS. Returns the bank as it stood before closing. */
async function bankProceeds(x: ErrandCtx, items: RegExp): Promise<{ id: number; name: string; count: number }[]> {
    await atBank(x);
    const d = await depositMatching(x.sdk, [items]);
    if (!d.ok) x.event('deposit incomplete', { reason: d.reason });
    const coins = state(x).inventory.find(i => /^coins$/i.test(i.name));
    if (coins && coins.count > KEEP_COINS) {
        const r = await x.bot.depositItem(coins, coins.count - KEEP_COINS);
        if (!r.success) x.event('coins deposit failed', { message: r.message });
    }
    await waitTicks(x.sdk, 1);
    // read before closing: a closed bank publishes no items
    const bank = x.sdk.getBankItems().map(i => ({ id: i.id, name: i.name, count: i.count }));
    x.reportBank(bank);
    await x.bot.closeBank();
    return bank;
}

/** Watch an offer until it fills or `minutes` pass. */
async function waitFill(x: ErrandCtx, id: number, minutes: number, first: GEOffer): Promise<GEOffer> {
    const deadline = Date.now() + minutes * 60_000;
    let offer = first;
    while (Date.now() < deadline && !x.signal.aborted) {
        if (!x.sdk.getGEState()) await x.bot.openGE();
        offer = x.sdk.getGEState()?.offers.find(o => o.id === id) ?? offer;
        if (offer.remaining === 0 || offer.state === 'completed') break;
        await x.sdk.waitForTicks(2).catch(() => undefined);
    }
    return offer;
}

/**
 * Cancel what is left open, collect the rest (items as notes; one retry, reopening the Exchange, when the collect
 * fails), and close the Exchange. Returns the items the offer still holds uncollected, as last seen.
 */
async function settle(x: ErrandCtx, offer: GEOffer, rec: Record<string, unknown>): Promise<number> {
    if (offer.remaining > 0 && offer.state === 'open') {
        const c = await x.bot.cancelGEOffer(offer.id);
        rec.cancelled = c.success ? offer.remaining : `failed: ${c.message}`;
    }
    let col = await x.bot.collectGEOffer(offer.id, true);
    rec.collect = { success: col.success, coins: col.coins ?? null, items: col.items ?? null, message: col.message };
    if (!col.success) {
        await waitTicks(x.sdk, 2);
        if (!x.sdk.getGEState()) await x.bot.openGE();
        col = await x.bot.collectGEOffer(offer.id, true);
        rec.collectRetry = { success: col.success, coins: col.coins ?? null, items: col.items ?? null, message: col.message };
    }
    const seen = x.sdk.getGEState()?.offers.find(o => o.id === offer.id);
    const uncollected = seen ? seen.items : col.success ? 0 : offer.items;
    await x.bot.closeInterface().catch(() => undefined);
    return uncollected;
}

const SHARK = /^shark$/i;

/**
 * Sharks the account holds after the errand (a noted shark is also named 'Shark'): the bank, read again (after
 * depositing what the pack still holds) while the total is below `expected` or the pack is not empty, at most
 * `reads` reads in all; the pack; and what the Exchange still holds uncollected.
 */
async function sharksAfter(x: ErrandCtx, bank0: readonly { name: string; count: number }[], uncollected: number, expected: number, reads = 3): Promise<SharksAfter & { reads: number }> {
    let a: SharksAfter = { bank: countIn(bank0, SHARK), pack: countIn(state(x).inventory, SHARK), uncollected };
    let n = 1;
    while (needsReread(a, expected) && n < reads) {
        await waitTicks(x.sdk, 2);
        const bank = await bankProceeds(x, SHARK);
        n++;
        a = { bank: countIn(bank, SHARK), pack: countIn(state(x).inventory, SHARK), uncollected };
    }
    return { ...a, reads: n };
}

export interface SharkConfig {
    perAccount: number;
    ceiling: number;
    runEnded: boolean;
    fillMinutes: number;
}

/**
 * Buy up to `perAccount` sharks less those banked, with a limit at the ceiling, paid from the bank's coins. Returns the
 * errand's record and the sharks held after it (`banked`: bank, pack and uncollected, `sharksAfter`; the parts are in
 * the record's `after`); the runner records the outcome (sharks.ts) and decides on a retry.
 */
export async function buySharks(x: ErrandCtx, cfg: SharkConfig, book: BookReader): Promise<{ record: Record<string, unknown>; banked: number }> {
    const rec: Record<string, unknown> = { kind: 'buy', item: SHARK_ID, ceiling: cfg.ceiling };
    const finish = async (bank: readonly { name: string; count: number }[], uncollected = 0, bought = 0) => {
        const after = await sharksAfter(x, bank, uncollected, ((rec.held as number | undefined) ?? 0) + bought);
        const banked = heldAfter(after);
        rec.after = after;
        rec.banked = banked;
        rec.at = new Date().toISOString();
        x.event('shark purchase', rec);
        return { record: rec, banked };
    };
    if (!cfg.runEnded) {
        rec.result = 'refused';
        rec.reason = "main has not announced the scored run's end";
        return { record: rec, banked: 0 };
    }
    await atBank(x);
    const bank = x.sdk.getBankItems();
    const held = countIn(bank, /^shark$/i);
    const want = cfg.perAccount - held;
    rec.held = held;
    rec.want = want;
    if (want <= 0) {
        await x.bot.closeBank();
        rec.result = 'enough';
        return finish(bank);
    }
    const coinStack = bank.find(i => /^coins$/i.test(i.name));
    const need = want * cfg.ceiling - carriedCoins(state(x));
    if (coinStack && need > 0) {
        const w = await x.bot.withdrawItem(coinStack, Math.min(need, coinStack.count));
        if (!w.success) rec.withdraw = w.message;
        await waitUntil(x.sdk, s => carriedCoins(s) > 0, { maxTicks: 5 });
    }
    await x.bot.closeBank();

    const q = await book.item(SHARK_ID);
    rec.quote = { ask: q.ask, sellQuantity: q.sellQuantity, sellValue: q.sellValue, at: new Date().toISOString() };
    const d = buyDecision(q, { want, coins: carriedCoins(state(x)), ceiling: cfg.ceiling, runEnded: cfg.runEnded });
    if (!d.buy) {
        rec.result = 'refused';
        rec.reason = d.reason;
        return finish(await bankProceeds(x, SHARK));
    }
    const opened = await x.bot.openGE();
    if (!opened.success) throw new Error(`openGE: ${opened.message}`);
    const placed = await x.bot.placeGEOffer({ item: SHARK_ID, side: 'buy', quantity: d.quantity, price: d.price });
    if (!placed.success || !placed.offer) {
        rec.result = placed.outcome === 'unknown' ? 'unknown' : 'not placed';
        rec.reason = `${placed.reason}: ${placed.message}`;
        await x.bot.closeInterface().catch(() => undefined);
        return finish(await bankProceeds(x, SHARK));
    }
    rec.offerId = placed.offer.id;
    rec.quantity = d.quantity;
    const offer = await waitFill(x, placed.offer.id, cfg.fillMinutes, placed.offer);
    rec.filled = offer.filled;
    const uncollected = await settle(x, offer, rec);
    rec.result = offer.filled === d.quantity ? 'filled' : offer.filled > 0 ? 'partial' : 'unfilled';
    return finish(await bankProceeds(x, SHARK), uncollected, offer.filled);
}

export interface SaleConfig {
    item: { id: number; name: string };
    floor: number;
    cap: number;
    fillMinutes: number;
}

/**
 * Sell up to `cap` of a banked item into the open bids, never below `floor`: read the book, take the quantity out of
 * the bank as notes, read again, offer at the floor (each unit fills at its bid's own price, best first), wait for
 * the fill, cancel the rest, bank the coins and what came back. Returns the sale's record for the ledger.
 */
export async function sellAtExchange(x: ErrandCtx, cfg: SaleConfig, book: BookReader): Promise<Record<string, unknown>> {
    const rec: Record<string, unknown> = { kind: 'sale', item: cfg.item.id, name: cfg.item.name, floor: cfg.floor, cap: cfg.cap };
    const re = exact(cfg.item.name);
    const refuse = (reason: string) => {
        rec.result = 'refused';
        rec.reason = reason;
        x.event('sale', rec);
        return rec;
    };
    await atBank(x);
    const stack = x.sdk.getBankItems().find(i => i.id === cfg.item.id);
    const q0 = await book.item(cfg.item.id);
    rec.quoteBefore = { bid: q0.bid, buyQuantity: q0.buyQuantity, buyValue: q0.buyValue, at: new Date().toISOString() };
    const d0 = saleDecision(q0, { held: stack?.count ?? 0, floor: cfg.floor, cap: cfg.cap });
    if (!d0.sell) {
        await x.bot.closeBank();
        return refuse(d0.reason);
    }
    const w = await x.bot.withdrawItem(stack!, d0.quantity, { asNote: true });
    if (!w.success) rec.withdraw = w.message;
    await waitUntil(x.sdk, s => countIn(s.inventory, re) >= d0.quantity, { maxTicks: 5 });
    await x.bot.closeBank();

    const q = await book.item(cfg.item.id);
    rec.quote = { bid: q.bid, buyQuantity: q.buyQuantity, buyValue: q.buyValue, at: new Date().toISOString() };
    const d = saleDecision(q, { held: countIn(state(x).inventory, re), floor: cfg.floor, cap: cfg.cap });
    if (!d.sell) {
        await bankProceeds(x, re);
        return refuse(d.reason);
    }
    const coins0 = carriedCoins(state(x));
    const opened = await x.bot.openGE();
    if (!opened.success) throw new Error(`openGE: ${opened.message}`);
    const placed = await x.bot.placeGEOffer({ item: cfg.item.id, side: 'sell', quantity: d.quantity, price: d.price });
    if (!placed.success || !placed.offer) {
        rec.result = placed.outcome === 'unknown' ? 'unknown' : 'not placed';
        rec.reason = `${placed.reason}: ${placed.message}`;
        await x.bot.closeInterface().catch(() => undefined);
        await bankProceeds(x, re);
        x.event('sale', rec);
        return rec;
    }
    Object.assign(rec, { offerId: placed.offer.id, quantity: d.quantity, price: d.price, sure: d.sure, expected: d.expected });
    const offer = await waitFill(x, placed.offer.id, cfg.fillMinutes, placed.offer);
    rec.filled = offer.filled;
    await settle(x, offer, rec);
    await waitUntil(x.sdk, s => carriedCoins(s) > coins0 || offer.filled === 0, { maxTicks: 5 });
    rec.coinsReceived = carriedCoins(state(x)) - coins0;
    rec.result = offer.filled === d.quantity ? 'filled' : offer.filled > 0 ? 'partial' : 'unfilled';
    await bankProceeds(x, re);
    x.event('sale', rec);
    return rec;
}
