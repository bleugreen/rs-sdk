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
 * Sales need the account at the Exchange, so plan.ts allows them only for methods with a way there (`SALE_ROUTE`): on
 * foot from the Varrock guards, or by ship from the Ardougne side and back (`sellByShip`, lib/sea-route.ts).
 */
import type { GEOffer } from '../../sdk/ge-types';
import type { BotWorldState } from '../../sdk/types';
import { depositMatching } from '../../speedrun/lib/bank';
import { waitTicks, waitUntil } from '../../speedrun/lib/wait';
import { regionOf } from '../../speedrun/lib/ships';
import type { MarketQuote } from '../lib/market.ts';
import { FARE_BANKS, faresOf, hereOf, routeBetween, runRoute, travel, withdrawFares } from '../lib/sea-route.ts';
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

type ErrandCtx = Pick<StageCtx, 'sdk' | 'bot' | 'signal' | 'event' | 'reportBank' | 'bankCoins' | 'trip'>;

const countIn = (items: readonly { id?: number; name: string; count: number }[], re: RegExp) => items.filter(i => re.test(i.name)).reduce((n, i) => n + i.count, 0);
const exact = (name: string) => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
const state = (x: ErrandCtx): BotWorldState => {
    const s = x.sdk.getState();
    if (!s?.player) throw new Error('no game state');
    return s;
};

/** At the Varrock west bank with it open, from wherever the account stood (lib/sea-route.ts `travel`). */
async function atBank(x: ErrandCtx): Promise<void> {
    await travel(x, VARROCK_WEST_BANK, 3);
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

const SHARK = /^shark$/i;
/** What an errand keeps carried when it makes room: coins, and a pickaxe (the iron fallback wields the tutorial's). */
const KEEP = /^coins$|pickaxe$/i;

/**
 * Bank everything carried but coins and pickaxes, at a bank already open, so a collect has room: a note still takes a
 * slot, and with none free the Exchange collects nothing and reports success (run-b3 a07: 'Collected 0 items and 46
 * gp. Any overflow remains in the exchange.').
 */
async function makeRoom(x: ErrandCtx): Promise<void> {
    const ids = [...new Set(state(x).inventory.filter(i => !KEEP.test(i.name)).map(i => i.id))];
    if (!ids.length) return;
    const d = await depositMatching(x.sdk, ids);
    if (!d.ok) x.event('deposit incomplete', { reason: d.reason, remaining: d.remaining.map(i => i.name) });
}

const collectRecord = (c: { success: boolean; coins?: number; items?: number; message: string }) => ({ success: c.success, coins: c.coins ?? null, items: c.items ?? null, message: c.message });

/**
 * Collect a buy offer's items as notes, at an open Exchange. A collect that took fewer items than the offer held
 * failed whatever its `success` says: make room at the bank, reopen the Exchange and collect once more. Returns the
 * items still uncollected.
 */
async function collectBuy(x: ErrandCtx, offerId: number, rec: Record<string, unknown>, key: string): Promise<number> {
    const claim = () => x.sdk.getGEState()?.offers.find(o => o.id === offerId)?.items ?? 0;
    const before = claim();
    const col = await x.bot.collectGEOffer(offerId, true);
    rec[key] = collectRecord(col);
    let left = x.sdk.getGEState() ? claim() : col.success ? Math.max(0, before - (col.items ?? 0)) : before;
    if (left === 0) return 0;
    await x.bot.closeInterface().catch(() => undefined);
    const opened = await x.bot.openBank();
    if (opened.success) {
        await makeRoom(x);
        await x.bot.closeBank();
    }
    const ge = await x.bot.openGE();
    if (!ge.success) return left;
    const again = await x.bot.collectGEOffer(offerId, true);
    rec[`${key}Retry`] = collectRecord(again);
    left = x.sdk.getGEState() ? claim() : again.success ? Math.max(0, left - (again.items ?? 0)) : left;
    return left;
}

/**
 * Cancel what is left open, collect the rest (a buy's items as notes, `collectBuy`), and close the Exchange. Returns
 * the items the offer still holds uncollected.
 */
async function settle(x: ErrandCtx, offer: GEOffer, rec: Record<string, unknown>): Promise<number> {
    if (offer.remaining > 0 && offer.state === 'open') {
        const c = await x.bot.cancelGEOffer(offer.id);
        rec.cancelled = c.success ? offer.remaining : `failed: ${c.message}`;
    }
    let uncollected = 0;
    if (offer.side === 'buy') uncollected = await collectBuy(x, offer.id, rec, 'collect');
    else rec.collect = collectRecord(await x.bot.collectGEOffer(offer.id, true));
    await x.bot.closeInterface().catch(() => undefined);
    return uncollected;
}

/**
 * Collect what earlier shark buys left on the Exchange (a collect with no room, an attempt stopped mid-errand), at an
 * open Exchange. Only offers no longer open: an open one may still be filling. Returns the sharks collected and left.
 */
async function collectLeftovers(x: ErrandCtx, rec: Record<string, unknown>): Promise<{ collected: number; left: number }> {
    const offers = (x.sdk.getGEState()?.offers ?? []).filter(o => o.item === SHARK_ID && o.side === 'buy' && o.state !== 'open' && o.items > 0);
    let collected = 0;
    let left = 0;
    const out: Record<string, unknown>[] = [];
    for (const o of offers) {
        const r: Record<string, unknown> = { offerId: o.id, items: o.items };
        const remaining = await collectBuy(x, o.id, r, 'collect');
        collected += o.items - remaining;
        left += remaining;
        out.push(r);
        if (!x.sdk.getGEState() && !(await x.bot.openGE()).success) break;
    }
    if (out.length) rec.leftovers = out;
    return { collected, left };
}

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
 * Buy up to `perAccount` sharks less those banked, with a limit at the ceiling, paid from the bank's coins. The pack is
 * emptied of all but coins and a pickaxe first, so the collect has room, and what earlier buys left on the Exchange is
 * collected before the book is read. Returns the errand's record and the sharks it can eat after it (`banked`: bank
 * and pack, `sharksAfter`; the parts, with what is still on the Exchange, in the record's `after`). Sharks left on the
 * Exchange make the result 'uncollected', which the runner retries (sharks.ts). The runner records the outcome.
 */
export async function buySharks(x: ErrandCtx, cfg: SharkConfig, book: BookReader): Promise<{ record: Record<string, unknown>; banked: number }> {
    const rec: Record<string, unknown> = { kind: 'buy', item: SHARK_ID, ceiling: cfg.ceiling };
    let leftovers = 0;
    const finish = async (bank: readonly { name: string; count: number }[], uncollected = 0, bought = 0) => {
        const after = await sharksAfter(x, bank, uncollected, ((rec.held as number | undefined) ?? 0) + leftovers + bought);
        const banked = heldAfter(after);
        rec.after = after;
        rec.banked = banked;
        if (after.uncollected > 0) {
            rec.purchase = rec.result;
            rec.result = 'uncollected';
            rec.reason = `${after.uncollected} sharks left on the Exchange after the collect and its retry`;
        }
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
    await makeRoom(x);
    await waitTicks(x.sdk, 1);
    const bank = x.sdk.getBankItems();
    const held = countIn(bank, SHARK);
    rec.held = held;
    if (cfg.perAccount - held <= 0) {
        await x.bot.closeBank();
        rec.result = 'enough';
        return finish(bank);
    }
    await x.bot.closeBank();
    const ge0 = await x.bot.openGE();
    if (!ge0.success) throw new Error(`openGE: ${ge0.message}`);
    const left0 = await collectLeftovers(x, rec);
    leftovers = left0.collected;
    await x.bot.closeInterface().catch(() => undefined);
    const want = cfg.perAccount - held - leftovers;
    rec.want = want;
    if (want <= 0) {
        rec.result = 'enough';
        return finish(await bankProceeds(x, SHARK), left0.left);
    }
    await atBank(x);
    const bankNow = x.sdk.getBankItems();
    const coinStack = bankNow.find(i => /^coins$/i.test(i.name));
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
        return finish(await bankProceeds(x, SHARK), left0.left);
    }
    const opened = await x.bot.openGE();
    if (!opened.success) throw new Error(`openGE: ${opened.message}`);
    const placed = await x.bot.placeGEOffer({ item: SHARK_ID, side: 'buy', quantity: d.quantity, price: d.price });
    if (!placed.success || !placed.offer) {
        rec.result = placed.outcome === 'unknown' ? 'unknown' : 'not placed';
        rec.reason = `${placed.reason}: ${placed.message}`;
        await x.bot.closeInterface().catch(() => undefined);
        return finish(await bankProceeds(x, SHARK), left0.left);
    }
    rec.offerId = placed.offer.id;
    rec.quantity = d.quantity;
    const offer = await waitFill(x, placed.offer.id, cfg.fillMinutes, placed.offer);
    rec.filled = offer.filled;
    const uncollected = await settle(x, offer, rec);
    rec.result = offer.filled === d.quantity ? 'filled' : offer.filled > 0 ? 'partial' : 'unfilled';
    return finish(await bankProceeds(x, SHARK), left0.left + uncollected, offer.filled);
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

/** Take coins from this side's fare bank (lib/sea-route.ts FARE_BANKS) until the pack holds `need`, as far as it has them. */
async function fareCoins(x: ErrandCtx, need: number): Promise<void> {
    const bank = FARE_BANKS[regionOf(hereOf(state(x)))];
    if (bank) await withdrawFares(x, bank, need);
}

/**
 * A sale for an account that works across the sea (SALE_ROUTE 'ship'): carry the round trip's fares (topped up from
 * this side's bank), sail to the Exchange, sell with `sellAtExchange`, and sail back to where it stood. The record
 * gets `trip`: both ways' ticks by leg, and the whole errand's ticks. Refused without moving when the fares are short.
 */
export async function sellByShip(x: ErrandCtx, cfg: SaleConfig, book: BookReader): Promise<Record<string, unknown>> {
    // The sale fell due as the method reported its bank, so the method stopped inside that visit. Counting the pack
    // before its deposit had landed once found 162 coins that were already banked, and the first ship refused the
    // account (lab, rs/732): close the visit and let the state settle first.
    if (x.sdk.getState()?.bank?.isOpen) {
        await x.bot.closeBank();
        await waitUntil(x.sdk, s => !s.bank?.isOpen, { maxTicks: 5 });
    }
    await waitTicks(x.sdk, 2);
    const s0 = state(x);
    const home = hereOf(s0);
    const out = routeBetween(home, VARROCK_WEST_BANK);
    const back = routeBetween(VARROCK_WEST_BANK, home, 2);
    const fares = faresOf(out) + faresOf(back);
    if (carriedCoins(s0) < fares) await fareCoins(x, fares);
    const held = carriedCoins(state(x));
    if (held < fares) {
        const rec = { kind: 'sale', item: cfg.item.id, name: cfg.item.name, floor: cfg.floor, cap: cfg.cap, result: 'refused', reason: `the round trip's fares are ${fares} coins and only ${held} could be found` };
        x.event('sale', rec);
        return rec;
    }
    const there = await runRoute(x, out);
    const t1 = state(x).tick;
    const rec = await sellAtExchange(x, cfg, book);
    const t2 = state(x).tick;
    const returned = await runRoute(x, back);
    rec.trip = { out: there, saleTicks: t2 - t1, back: returned, ticks: state(x).tick - s0.tick, fares };
    x.event('sale trip', { result: rec.result, ...(rec.trip as Record<string, unknown>) });
    return rec;
}
