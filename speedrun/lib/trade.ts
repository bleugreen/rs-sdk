// Batched trade: a giver that offers everything and accepts in one burst, and
// a receiver that accepts as soon as the offer is good and re-verifies it on
// the confirm screen.
//
// Server facts (interface_trade/scripts/trade.rs2): there is no delay anywhere
// in the trade scripts. Any add or remove resets BOTH players' accepts. The
// first-screen accept moves both players to the confirm screen once both have
// accepted; the confirm accept swaps items once both have accepted. Offer-All
// is one event per item id.
//
// Safety: speed comes from fewer waits, not fewer checks. The receiver only
// accepts the confirm screen when its final `theirOffer` still satisfies
// `want` (or, with no `want`, still equals what was on the offer screen when
// it accepted), and its own offer is empty. Nothing changes hands otherwise.
// The giver checks both offers on the confirm screen too.
//
// Completion race: the confirm accept that completes the trade runs
// [if_close,tradeconfirm], whose inv_stoptransmit packets leave the server at
// once, mid-tick; the inventory update and the interface close follow in the
// tick's end-of-tick batch (WSClientSocket batching). A bot can therefore be
// published one state with the confirm screen still open, both offer lists
// empty and its inventory unchanged. Both sides wait out an empty confirm
// list, and a decline sent after our own confirm accept is not taken as the
// outcome: the trade may have completed before it landed.
//
// Settling such a decline needs the server's word, not just a closed screen:
// the browser client's sendDeclineTrade closes the modal locally at once, so it
// publishes the trade closed while the giver's offered items are still out of
// its inventory, a tick or two before the server refunds them. The server's
// word is either the refund (our offered items back in the inventory) or the
// "Accepted trade." message it sends both players as the items swap.

import type { BotSDK } from '../../sdk/index';
import type { ActionResult, BotWorldState, GameMessage, InventoryItem, TradeItem, TradeState } from '../../sdk/types';
import { countInventoryById, diffInventories, shortfall } from '../../sdk/trade-helpers';
import { amountButtons, isXAmount, matchesItem, type ItemPattern } from './items';
import { failureReason, onStates, tickClock, tickMs, type StateSource } from './wait';

export type TradeSdk = StateSource &
    Pick<BotSDK, 'sendTradeRequest' | 'sendOfferItem' | 'sendAcceptTrade' | 'sendDeclineTrade'>;

/** A want spec: at least `amount` (default 1) of items it matches (matchesItem: a name, or an obj id). */
export interface WantSpec {
    item: ItemPattern;
    amount?: number;
}

/**
 * True when the offer holds every want at its amount; no wants is any offer, nothing included.
 * speedrun's one want rule (the receiver, the giver's check of the partner's offer, the mule): a name
 * want counts as sdk/trade-helpers.ts's offerSatisfies does (a string is a case-blind substring of
 * the item name, a RegExp is tested on it, the counts of every matching offer entry summed, a noted
 * and an unnoted stack alike since they share the name), and an obj id (a number) counts by id,
 * which the sdk's name-only rule cannot express.
 */
export function offerSatisfies(want: readonly WantSpec[] | undefined, offer: readonly TradeItem[]): boolean {
    return (want ?? []).every(w => offer.reduce((n, i) => n + (matchesItem(i, w.item) ? i.count : 0), 0) >= (w.amount ?? 1));
}

export interface GiveSpec {
    item: ItemPattern;
    /** How many to offer (default 'all'). */
    n?: number | 'all';
}

const CLOSED: TradeState = { isOpen: false, screen: null, partner: null, myOffer: [], theirOffer: [], myAccepted: false, partnerAccepted: false };

export function tradeOf(s: BotWorldState): TradeState {
    return s.trade ?? CLOSED;
}

export function sameName(a: string | null | undefined, b: string | null | undefined): boolean {
    if (!a || !b) return false;
    const norm = (x: string) => x.toLowerCase().replace(/[\s_ ]+/g, ' ').trim();
    return norm(a) === norm(b);
}

/** Item counts keyed by id. */
function byId(items: ReadonlyArray<{ id: number; count: number }>): Map<number, number> {
    const m = new Map<number, number>();
    for (const i of items) m.set(i.id, (m.get(i.id) ?? 0) + i.count);
    return m;
}

/** True when two offers hold the same ids at the same counts. */
export function sameOffer(a: readonly TradeItem[], b: readonly TradeItem[]): boolean {
    const ma = byId(a);
    const mb = byId(b);
    if (ma.size !== mb.size) return false;
    for (const [id, n] of ma) if (mb.get(id) !== n) return false;
    return true;
}

// ---------------------------------------------------------------- offers

export interface OfferEntry {
    slot: number;
    id: number;
    name: string;
    /** Offer buttons: -1 All, 1/5/10, anything else an X amount. */
    amounts: number[];
    /** Count that should end up in myOffer. */
    expected: number;
}

/** One entry per distinct item id; `'all'` offers the whole inventory. */
export function planOffers(inventory: readonly InventoryItem[], specs: readonly GiveSpec[] | 'all'): OfferEntry[] {
    const totals = byId(inventory);
    const firstSlot = new Map<number, InventoryItem>();
    for (const i of [...inventory].sort((a, b) => a.slot - b.slot)) if (!firstSlot.has(i.id)) firstSlot.set(i.id, i);

    const out: OfferEntry[] = [];
    const used = new Set<number>();
    const add = (item: InventoryItem, n: number | 'all') => {
        if (used.has(item.id)) return;
        used.add(item.id);
        const total = totals.get(item.id) ?? 0;
        const want = n === 'all' ? total : n;
        // An id held in more than one slot is unstackable: one press only.
        const singlePress = item.count < total;
        out.push({ slot: item.slot, id: item.id, name: item.name, amounts: amountButtons(want, total, { singlePress }), expected: Math.min(want, total) });
    };
    if (specs === 'all') {
        for (const item of firstSlot.values()) add(item, 'all');
    } else {
        for (const spec of specs) {
            const item = [...firstSlot.values()].find(i => !used.has(i.id) && matchesItem(i, spec.item));
            if (item) add(item, spec.n ?? 'all');
        }
    }
    // X offers last: each holds the client queue for its count dialog.
    return [...out.filter(e => !e.amounts.some(isXAmount)), ...out.filter(e => e.amounts.some(isXAmount))];
}

export function expectedOffer(plan: readonly OfferEntry[]): TradeItem[] {
    return plan.map(e => ({ slot: -1, id: e.id, name: e.name, count: e.expected }));
}

// ---------------------------------------------------------------- receiver decision

export interface ReceiverCtx {
    partner: string;
    want?: WantSpec[];
    invBefore: Map<number, { name: string; count: number }>;
    /** theirOffer when we accepted the offer screen (used when there is no `want`). */
    snapshot: TradeItem[] | null;
    /** theirOffer when we accepted the confirm screen. */
    confirmOffer: TradeItem[] | null;
    lastAcceptTick: number;
    sawOpen: boolean;
    closedSince: number | null;
    /** First tick the confirm screen showed an empty partner offer. */
    confirmEmptySince?: number | null;
    /** Tick of our first confirm-screen accept; -1 before it. */
    confirmTick: number;
    /** Why we declined after accepting the confirm screen; the outcome then waits for the server. */
    declined: string | null;
    declineTick: number;
}

/**
 * Ticks an empty offer list on the confirm screen is taken as not read yet
 * before declining: the list may be published a state after the screen, or
 * emptied as the trade completes (see the completion race above; demo traders
 * on both sides declined trades whose items then changed hands). A non-empty
 * offer that does not match is declined at once.
 */
export const CONFIRM_EMPTY_GRACE_TICKS = 3;

/** Ticks between decline re-sends while a trade we declined after confirming stays open. */
export const REDECLINE_TICKS = 3;

/**
 * Ticks a trade we declined after confirming may sit closed without the
 * server's word on the outcome before the call gives up on it as unsettled.
 */
export const SETTLE_TICKS = 10;

/**
 * The server's word that the trade completed: [if_button,tradeconfirm:accept]
 * sends "Accepted trade." to both players as the items swap. Messages are
 * stamped with the tick they were first seen, so one at or after our own
 * confirm accept belongs to this trade.
 */
export function sawTradeAccepted(state: BotWorldState, confirmTick: number): boolean {
    if (confirmTick < 0) return false;
    return state.gameMessages.some(m => m.type === 0 && !m.fromSelf && m.tick >= confirmTick && /^accepted trade\.?$/i.test(m.text.trim()));
}

/**
 * A decline is `settle` when we had already accepted the confirm screen: the
 * trade may have completed before the decline lands, so the driver sends it
 * and keeps reading states until the inventory shows the outcome.
 */
export type DeclineAction = { action: 'decline'; reason: string; settle: boolean };

export type ReceiverAction =
    | { action: 'wait' }
    | { action: 'accept' }
    | DeclineAction
    | { action: 'done'; received: TradeItem[] }
    | { action: 'closed'; reason?: string };

export function newReceiverCtx(partner: string, inventory: readonly InventoryItem[], want?: WantSpec[]): ReceiverCtx {
    return { partner, ...(want ? { want } : {}), invBefore: countInventoryById([...inventory]), snapshot: null, confirmOffer: null, lastAcceptTick: -1, sawOpen: false, closedSince: null, confirmTick: -1, declined: null, declineTick: -1 };
}

interface Settling {
    declined: string | null;
    declineTick: number;
}

function decline<C extends Settling>(next: C, tick: number, reason: string, settle: boolean): { next: C } & DeclineAction {
    if (settle) {
        next.declined = reason;
        next.declineTick = tick;
    }
    return { next, action: 'decline', reason, settle };
}

/** While settling and the trade is still open: re-send the decline every REDECLINE_TICKS, else wait. */
function settleOpen<C extends Settling>(next: C, tick: number): { next: C } & (DeclineAction | { action: 'wait' }) {
    if (next.declined !== null && tick - next.declineTick >= REDECLINE_TICKS) return decline(next, tick, next.declined, true);
    return { next, action: 'wait' };
}

function closedAction(ctx: Settling): { action: 'closed'; reason?: string } {
    return ctx.declined !== null ? { action: 'closed', reason: ctx.declined } : { action: 'closed' };
}

function unsettled(ctx: Settling): { action: 'closed'; reason: string } {
    return { action: 'closed', reason: `no settlement seen after declining: ${ctx.declined}` };
}

/**
 * One receiver step per published state. Returns the action to take and the
 * updated context (the input is not mutated).
 *
 * - Offer screen: accept once per tick when `theirOffer` satisfies `want`; with
 *   no `want`, accept when the partner has accepted (the giver's "offer is
 *   final" signal) and snapshot `theirOffer`.
 * - Confirm screen: accept only if `theirOffer` still satisfies `want` (or
 *   equals the snapshot) and `myOffer` is empty; otherwise decline.
 * - After our confirm accept, a decline settles: the trade may have completed
 *   first, so the outcome is read from the inventory once it closes.
 * - Closed: done once the inventory delta shows the confirmed items arrived;
 *   a close without the delta is final only after 2 ticks (the offer-to-confirm
 *   transition can publish a closed frame in between), or SETTLE_TICKS when we
 *   declined late and the server said "Accepted trade.".
 */
export function decideReceiver(state: BotWorldState, ctx: ReceiverCtx): { next: ReceiverCtx } & ReceiverAction {
    const t = tradeOf(state);
    const next: ReceiverCtx = { ...ctx };
    const settle = ctx.confirmOffer !== null;
    if (t.isOpen) {
        next.sawOpen = true;
        next.closedSince = null;
        if (ctx.declined !== null) return settleOpen(next, state.tick);
        if (t.partner && !sameName(t.partner, ctx.partner)) return decline(next, state.tick, `wrong partner ${t.partner}`, settle);
        if (t.myOffer.length > 0) return decline(next, state.tick, 'my offer is not empty', settle);
        const canAccept = !t.myAccepted && state.tick !== ctx.lastAcceptTick;
        if (t.screen === 'offer') {
            const good = ctx.want ? offerSatisfies(ctx.want, t.theirOffer) : t.partnerAccepted;
            if (good && canAccept) {
                next.lastAcceptTick = state.tick;
                if (!ctx.want) next.snapshot = t.theirOffer.map(i => ({ ...i }));
                return { next, action: 'accept' };
            }
            return { next, action: 'wait' };
        }
        if (t.screen === 'confirm') {
            const good = ctx.want ? offerSatisfies(ctx.want, t.theirOffer) : ctx.snapshot !== null && sameOffer(ctx.snapshot, t.theirOffer);
            if (!good && t.theirOffer.length === 0) {
                next.confirmEmptySince = ctx.confirmEmptySince ?? state.tick;
                if (state.tick - next.confirmEmptySince < CONFIRM_EMPTY_GRACE_TICKS) return { next, action: 'wait' };
            }
            if (!good) return decline(next, state.tick, 'confirm screen offer does not match', settle);
            if (canAccept) {
                next.lastAcceptTick = state.tick;
                if (ctx.confirmTick < 0) next.confirmTick = state.tick;
                next.confirmOffer = t.theirOffer.map(i => ({ ...i }));
                return { next, action: 'accept' };
            }
            return { next, action: 'wait' };
        }
        return { next, action: 'wait' };
    }

    if (!ctx.sawOpen) return { next, action: 'wait' };
    const gained = diffInventories(ctx.invBefore, countInventoryById(state.inventory)).gained;
    if (ctx.confirmOffer !== null) {
        const arrived = ctx.confirmOffer.length > 0
            ? shortfall(ctx.confirmOffer, gained).length === 0
            : gained.length > 0;
        if (arrived && (!ctx.want || offerSatisfies(ctx.want, gained))) return { next, action: 'done', received: gained };
    }
    // Success needs the items in hand; the server's word only buys them time.
    const patience = ctx.declined !== null && sawTradeAccepted(state, ctx.confirmTick) ? SETTLE_TICKS : 2;
    if (ctx.closedSince === null) next.closedSince = state.tick;
    else if (state.tick - ctx.closedSince >= patience) return { next, ...closedAction(ctx) };
    return { next, action: 'wait' };
}

// ---------------------------------------------------------------- giver decision

export interface GiverCtx {
    partner: string;
    plan: OfferEntry[];
    /** What the partner may offer; default: nothing. */
    expectTheirs?: WantSpec[];
    invBefore: Map<number, { name: string; count: number }>;
    burstTick: number | null;
    lastAcceptTick: number;
    confirmAccepted: boolean;
    sawOpen: boolean;
    closedSince: number | null;
    /** First tick the confirm screen showed our offer empty. */
    confirmEmptySince: number | null;
    /** Tick of our first confirm-screen accept; -1 before it. */
    confirmTick: number;
    /** Why we declined after accepting the confirm screen; the outcome then waits for the server. */
    declined: string | null;
    declineTick: number;
}

export type GiverAction =
    | { action: 'wait' }
    | { action: 'burst' }
    | { action: 'accept' }
    | DeclineAction
    | { action: 'done'; gave: TradeItem[] }
    | { action: 'closed'; reason?: string };

export function newGiverCtx(partner: string, inventory: readonly InventoryItem[], plan: OfferEntry[], expectTheirs?: WantSpec[]): GiverCtx {
    return { partner, plan, ...(expectTheirs ? { expectTheirs } : {}), invBefore: countInventoryById([...inventory]), burstTick: null, lastAcceptTick: -1, confirmAccepted: false, sawOpen: false, closedSince: null, confirmEmptySince: null, confirmTick: -1, declined: null, declineTick: -1 };
}

function theirsAcceptable(theirs: readonly TradeItem[], expect: WantSpec[] | undefined): boolean {
    return expect ? offerSatisfies(expect, theirs) : theirs.length === 0;
}

/**
 * One giver step per published state.
 *
 * - Offer screen, first sight: `burst` (fire every offer and the accept behind
 *   them; FIFO puts the accept after the last offer on the server).
 * - Offer screen after the burst: if an offer change reset our accept,
 *   re-accept at most once per tick, but only while our offer is complete and
 *   theirs is acceptable.
 * - Confirm screen: both offers must be exactly as intended, else decline. An
 *   empty own offer is waited out for CONFIRM_EMPTY_GRACE_TICKS first: it is
 *   what the completing trade publishes just before it closes.
 * - After our confirm accept, a decline settles: the trade may have completed
 *   first, and a closed screen is no evidence (the browser client closes it
 *   locally before the server refunds). Failed once the offered items are
 *   back; done once they are gone and the server said "Accepted trade.";
 *   failed as unsettled after SETTLE_TICKS closed with neither.
 * - Closed: done once the inventory lost what we offered.
 */
export function decideGiver(state: BotWorldState, ctx: GiverCtx): { next: GiverCtx } & GiverAction {
    const t = tradeOf(state);
    const next: GiverCtx = { ...ctx };
    const mine = expectedOffer(ctx.plan);
    const settle = ctx.confirmAccepted;
    if (t.isOpen) {
        next.sawOpen = true;
        next.closedSince = null;
        if (ctx.declined !== null) return settleOpen(next, state.tick);
        if (t.partner && !sameName(t.partner, ctx.partner)) return decline(next, state.tick, `wrong partner ${t.partner}`, settle);
        if (t.screen === 'offer') {
            if (ctx.burstTick === null) {
                next.burstTick = state.tick;
                next.lastAcceptTick = state.tick;
                return { next, action: 'burst' };
            }
            const ready = sameOffer(t.myOffer, mine) && theirsAcceptable(t.theirOffer, ctx.expectTheirs);
            if (ready && !t.myAccepted && state.tick > ctx.lastAcceptTick) {
                next.lastAcceptTick = state.tick;
                return { next, action: 'accept' };
            }
            return { next, action: 'wait' };
        }
        if (t.screen === 'confirm') {
            if (t.myOffer.length === 0) {
                next.confirmEmptySince = ctx.confirmEmptySince ?? state.tick;
                if (state.tick - next.confirmEmptySince < CONFIRM_EMPTY_GRACE_TICKS) return { next, action: 'wait' };
            }
            if (!sameOffer(t.myOffer, mine)) return decline(next, state.tick, 'my confirm offer is not what was planned', settle);
            if (!theirsAcceptable(t.theirOffer, ctx.expectTheirs)) return decline(next, state.tick, 'partner confirm offer is not acceptable', settle);
            if (!t.myAccepted && state.tick > ctx.lastAcceptTick) {
                next.lastAcceptTick = state.tick;
                if (!ctx.confirmAccepted) next.confirmTick = state.tick;
                next.confirmAccepted = true;
                return { next, action: 'accept' };
            }
            return { next, action: 'wait' };
        }
        return { next, action: 'wait' };
    }

    if (!ctx.sawOpen) return { next, action: 'wait' };
    const lost = diffInventories(ctx.invBefore, countInventoryById(state.inventory)).lost;
    const gone = mine.length > 0 && shortfall(mine, lost).length === 0;
    if (ctx.declined !== null) {
        if (!gone) return { next, ...closedAction(ctx) };
        if (sawTradeAccepted(state, ctx.confirmTick)) return { next, action: 'done', gave: lost };
        if (ctx.closedSince === null) next.closedSince = state.tick;
        else if (state.tick - ctx.closedSince >= SETTLE_TICKS) return { next, ...unsettled(ctx) };
        return { next, action: 'wait' };
    }
    if (ctx.confirmAccepted && gone) return { next, action: 'done', gave: lost };
    if (ctx.closedSince === null) next.closedSince = state.tick;
    else if (state.tick - ctx.closedSince >= 2) return { next, ...closedAction(ctx) };
    return { next, action: 'wait' };
}

/** The result reason for a trade that completed although we declined it after confirming. */
function completedDespite(declined: string | null): { reason?: string } {
    return declined !== null ? { reason: `completed as the decline landed: ${declined}` } : {};
}

// ---------------------------------------------------------------- opening

export interface OpenResult {
    ok: boolean;
    /** Tick of our first trade click (the open tick when the trade was already open). */
    firstClickTick: number;
    /** Tick the screens were first seen open; -1 when they never opened. */
    openTick: number;
    /** First frame a click of ours was answered "Sending trade offer..." without the screens open (our request stood); -1 if none was. */
    landedTick: number;
    sends: number;
    /** Clicks re-sent on a busy refusal. */
    bounces: number;
    reason?: 'player_not_found' | 'no_response' | 'stopped';
}

/** trade.rs2 [opplayer4]: the engine's refusal of a request while the target is busy (a delay, a level-up page, an open modal). */
export const TRADE_BUSY_RE = /is busy at the moment/i;

/** trade.rs2 [opplayer4]: what every request the engine processes says to its sender, the one that opens the trade included. */
export const TRADE_SENT_RE = /^sending trade offer/i;

/** trade.rs2 [opplayer4]'s `<name>:tradereq:`, as both clients show it: chat type 4 from the requester. */
export const TRADE_REQUEST_RE = /wishes to trade/i;

export function isTradeRequest(m: GameMessage): boolean {
    return m.type === 4 && TRADE_REQUEST_RE.test(m.text);
}

/**
 * The server's reply (a game message) to a trade click of ours that landed after `sinceTick` (trade.rs2
 * [opplayer4]): 'sent' ("Sending trade offer...", which it sends even when the click opens
 * the trade), 'busy' (the partner is busy; nothing opened), or null for no reply yet.
 */
export function tradeClickReply(s: BotWorldState, sinceTick: number): 'sent' | 'busy' | null {
    let reply: 'sent' | 'busy' | null = null;
    for (const m of s.gameMessages) {
        // Only the server's game messages answer a click: player chat can say anything.
        if (m.tick <= sinceTick || m.type !== 0) continue;
        if (TRADE_SENT_RE.test(m.text)) reply = 'sent';
        else if (reply === null && TRADE_BUSY_RE.test(m.text)) reply = 'busy';
    }
    return reply;
}

// ---------------------------------------------------------------- when a trade click may go out
//
// One rule decides it, for every trade click this code sends (openTrade below, and
// through it receiveFrom, give, swap, the bone giver's standing request, the anvil and
// cannon holders and the mule; the mule's pre-request calls decideTradeClick itself).
// What it rests on, from the engine (OpPlayerHandler, trade.rs2 [opplayer4]):
// - Every click the server processes is answered on the tick it lands: the screens
//   open, "Sending trade offer..." (our request now stands until a trade opens or
//   closes), or "<name> is busy at the moment" (a delay, a level-up page, a modal).
// - A click from a delayed player is dropped without a word. A click sent on the
//   frame a craft or a smith lands is lost that way, and the level-up dialog that
//   opens as the delay ends then makes us busy to the partner's requests until our
//   next click closes it.
// - A click that reaches an open trade closes it (clearPendingAction).
// So:
// - Nothing is sent while the trade is open, or while our last click's action result
//   is still pending. The demo relay holds actions for tens of ticks and delivers them
//   in a batch (one click came back 34 ticks after it went out, with 7 re-clicks
//   queued behind it, and those closed the trade the first had opened), so silence
//   before the result is back means nothing.
// - Silence is counted from the frame the result came back. With `noReplyTicks` set
//   (DROPPED_TICKS, 2: one frame carries the tick the click landed on, the second is
//   slack for a frame published late), that many silent frames mean the click was
//   dropped, and it is re-sent. It is opt-in, for a caller that knows it is already
//   beside the partner: the server answers only once the clicking player is adjacent,
//   so a click from range is silent for its whole approach walk, and a short count
//   would re-click all the way there. By default an unanswered click waits
//   `resendTicks`, like a standing one.
// - A busy refusal is answered on the frame that shows it.
// - A request that stood ("Sending trade offer...") is re-sent after `resendTicks`
//   without a trade, in case the partner relogged; its request may have lapsed.
// Ticks are observed ticks throughout; wall clock only ever gives up.

/** The opt-in `noReplyTicks` for a caller beside its partner: silent frames after a click's action result before it counts as dropped. */
export const DROPPED_TICKS = 2;

/** Observed ticks a standing request waits for a trade before it is re-sent. */
export const RESEND_TICKS = 27;

/** Observed ticks an open gets by default (what the old 60 s wall default stood for at 300 ms). */
export const OPEN_MAX_TICKS = 200;

/**
 * The wall-clock backstop for an open bounded by `maxTicks` observed ticks: twice their nominal
 * length, so it only ends an open whose ticks come at under half speed (the idle detector ends a
 * client that stopped publishing). No backstop for an open with no tick bound.
 */
export function openBackstopMs(maxTicks: number): number {
    return Number.isFinite(maxTicks) ? 2 * maxTicks * tickMs() : Infinity;
}

export interface ClickCtx {
    /** Frame our latest click went out on; -1 before the first. */
    sentTick: number;
    /** Frame its action result came back on; -1 while it is pending. */
    backTick: number;
    sends: number;
    bounces: number;
}

export const newClickCtx = (): ClickCtx => ({ sentTick: -1, backTick: -1, sends: 0, bounces: 0 });

/** The click sent on `sentTick` has its action result back, on `tick`. A result for an older click changes nothing. */
export function clickBack(ctx: ClickCtx, sentTick: number, tick: number): ClickCtx {
    return ctx.sentTick === sentTick && ctx.backTick < 0 ? { ...ctx, backTick: Math.max(tick, sentTick) } : ctx;
}

export interface ClickRule {
    /** Silent frames after the click's result before it counts as dropped and is re-sent. Default Infinity (walk-safe: only the `resendTicks` re-send); DROPPED_TICKS beside the partner. */
    noReplyTicks?: number;
    /** Default RESEND_TICKS. */
    resendTicks?: number;
}

export type ClickWhy = 'first' | 'busy' | 'dropped' | 'standing';
export type ClickDecision = { next: ClickCtx } & ({ action: 'open' | 'wait' } | { action: 'send'; why: ClickWhy });

/**
 * May a trade click go out on this frame (the rule above)? 'open' when the screens are
 * open, 'send' with why, or 'wait'. Pure; call it on every frame, a repeat within the
 * frame a click went out on is a wait. After a 'send', report the click's action result
 * with clickBack (sendTradeClick does).
 */
export function decideTradeClick(s: BotWorldState, ctx: ClickCtx, rule: ClickRule = {}): ClickDecision {
    if (tradeOf(s).isOpen) return { action: 'open', next: ctx };
    const send = (why: ClickWhy): ClickDecision => ({
        action: 'send',
        why,
        next: { sentTick: s.tick, backTick: -1, sends: ctx.sends + 1, bounces: ctx.bounces + (why === 'busy' ? 1 : 0) }
    });
    if (ctx.sentTick < 0) return send('first');
    if (ctx.backTick < 0 || s.tick <= ctx.sentTick) return { action: 'wait', next: ctx };
    const reply = tradeClickReply(s, ctx.sentTick);
    if (reply === 'busy') return send('busy');
    const since = s.tick - ctx.backTick;
    const resend = rule.resendTicks ?? RESEND_TICKS;
    if (reply === 'sent') return since >= resend ? send('standing') : { action: 'wait', next: ctx };
    return since >= Math.min(rule.noReplyTicks ?? Infinity, resend) ? send('dropped') : { action: 'wait', next: ctx };
}

/** Send the click decideTradeClick asked for (its `next.sentTick`); `back` gets clickBack's arguments when the action result returns. */
export function sendTradeClick(sdk: TradeSdk, playerIndex: number, sentTick: number, back: (sentTick: number, tick: number) => void): void {
    void sdk
        .sendTradeRequest(playerIndex)
        .catch(() => undefined)
        .then(() => back(sentTick, sdk.getState()?.tick ?? sentTick));
}

export interface OpenOptions extends ClickRule {
    /** Observed ticks to get the screens open (default OPEN_MAX_TICKS, or no tick limit when `timeoutMs` is given). */
    maxTicks?: number;
    /** Wall-clock give-up (default openBackstopMs(maxTicks); Infinity for none). A caller that sets only this keeps a wall-only bound. */
    timeoutMs?: number;
    /** Ticks the partner may be out of sight before player_not_found (default 5). */
    goneTicks?: number;
    /**
     * Send CLOSE_MODAL with each trade click while a chat or main modal is open: an open
     * modal makes us busy() (Player.ts), and the partner's request bounces. Needs `sendCloseModal`.
     */
    closeModals?: boolean;
    /** Checked on every frame the screens are not open, with that frame: true ends the open with reason 'stopped'. */
    stopped?: (s: BotWorldState) => boolean;
}

/**
 * Open a trade with `partner` by name, clicking by decideTradeClick. A click on a
 * player who has requested us is the acceptance and opens both screens at once;
 * otherwise our request stands and the partner's click opens them. Resolves on the
 * frame the screens are first seen open (with anyone: callers check the partner), so a
 * caller's first step runs on that same frame. A trade already open with someone else
 * is declined first.
 */
export async function openTrade(sdk: TradeSdk & Partial<Pick<BotSDK, 'sendCloseModal'>>, partner: string, opts: OpenOptions = {}): Promise<OpenResult> {
    const now = sdk.getState();
    const open = now ? tradeOf(now) : CLOSED;
    if (open.isOpen && sameName(open.partner, partner)) return { ok: true, firstClickTick: now!.tick, openTick: now!.tick, landedTick: -1, sends: 0, bounces: 0 };
    if (open.isOpen) await sdk.sendDeclineTrade();
    const maxTicks = opts.maxTicks ?? (opts.timeoutMs === undefined ? OPEN_MAX_TICKS : Infinity);
    const goneTicks = opts.goneTicks ?? 5;
    const timeoutMs = opts.timeoutMs ?? openBackstopMs(maxTicks);

    let ctx = newClickCtx();
    let firstClickTick = -1;
    let landedTick = -1;
    let unseenSince = -1;
    return new Promise<OpenResult>(resolve => {
        let done = false;
        const finish = (r: Pick<OpenResult, 'ok' | 'openTick' | 'reason'>) => {
            if (done) return;
            done = true;
            unsubscribe();
            clock.stop();
            if (timer) clearTimeout(timer);
            resolve({ firstClickTick, landedTick, sends: ctx.sends, bounces: ctx.bounces, ...r, ...(r.ok ? {} : { openTick: -1 }) });
        };
        const fail = (reason: NonNullable<OpenResult['reason']>) => finish({ ok: false, openTick: -1, reason });
        // maxTicks counts observed ticks however slowly they come; the idle detector (a
        // client that stopped publishing) and the wall clock only give up.
        // Giving up without ever having clicked means the partner was never in sight to click.
        const giveUp = () => fail(firstClickTick < 0 ? 'player_not_found' : 'no_response');
        const clock = tickClock(now?.tick, giveUp, now?.tick);
        const timer = Number.isFinite(timeoutMs) ? setTimeout(giveUp, Math.max(0, timeoutMs)) : undefined;
        const step = (s: BotWorldState) => {
            if (done) return;
            clock.see(s);
            if (tradeOf(s).isOpen) return finish({ ok: true, openTick: s.tick });
            if (opts.stopped?.(s)) return fail('stopped');
            if (clock.elapsed > maxTicks) return fail('no_response');
            if (landedTick < 0 && ctx.sentTick >= 0 && tradeClickReply(s, ctx.sentTick) === 'sent') landedTick = s.tick;
            const player = s.nearbyPlayers.find(p => sameName(p.name, partner));
            if (!player) {
                if (unseenSince < 0) unseenSince = s.tick;
                if (s.tick - unseenSince >= goneTicks) fail('player_not_found');
                return;
            }
            unseenSince = -1;
            const d = decideTradeClick(s, ctx, opts);
            ctx = d.next;
            if (d.action !== 'send') return;
            if (opts.closeModals && (s.dialog.isOpen || s.modalOpen)) void sdk.sendCloseModal?.();
            if (firstClickTick < 0) firstClickTick = s.tick;
            sendTradeClick(sdk, player.index, ctx.sentTick, (sent, tick) => (ctx = clickBack(ctx, sent, tick)));
        };
        const unsubscribe = sdk.onStateUpdate(step);
        if (now) step(now);
    });
}

// ---------------------------------------------------------------- drivers

export interface ReceiveResult {
    ok: boolean;
    /** Receiver clock: ticks from our first trade click to the items arriving. */
    ticks: number;
    received: TradeItem[];
    /** Why it failed; on success, set only when the trade completed although we declined it. */
    reason?: string;
}

/**
 * Receive a trade from `partner` (the scored-account side). Clicks trade on
 * the partner (accepting a pending request, or requesting), then accepts as
 * soon as the offer is good and re-verifies on the confirm screen.
 */
export async function receiveFrom(
    sdk: TradeSdk,
    partner: string,
    opts: {
        want?: WantSpec[];
        /** Observed ticks from the screens opening to the outcome (default 100). */
        maxTicks?: number;
        /** Observed ticks to get the trade open, from this call (openTrade's `maxTicks`). An absolute deadline is `deadline - now`. */
        openMaxTicks?: number;
        openTimeoutMs?: number;
        /** openTrade's `noReplyTicks` (opt-in DROPPED_TICKS beside the partner). */
        noReplyTicks?: number;
    } = {}
): Promise<ReceiveResult> {
    const s0 = sdk.getState();
    if (!s0) throw new Error('receiveFrom: no state');
    let ctx = newReceiverCtx(partner, s0.inventory, opts.want);
    const open = await openTrade(sdk, partner, { maxTicks: opts.openMaxTicks, timeoutMs: opts.openTimeoutMs, noReplyTicks: opts.noReplyTicks });
    if (!open.ok) return { ok: false, ticks: 0, received: [], reason: open.reason };
    const start = open.firstClickTick;
    const r = await onStates(sdk, opts.maxTicks ?? 100, s => {
        const d = decideReceiver(s, ctx);
        ctx = d.next;
        switch (d.action) {
            case 'accept': void sdk.sendAcceptTrade(); return undefined;
            case 'decline':
                void sdk.sendDeclineTrade();
                return d.settle ? undefined : { ok: false, tick: s.tick, received: [] as TradeItem[], reason: d.reason };
            case 'done': return { ok: true, tick: s.tick, received: d.received, ...completedDespite(ctx.declined) };
            case 'closed': return { ok: false, tick: s.tick, received: [] as TradeItem[], reason: d.reason ?? 'closed without the items arriving' };
            default: return undefined;
        }
    });
    if (!r.ok) return { ok: false, ticks: (sdk.getState()?.tick ?? start) - start, received: [], reason: failureReason(r.reason) };
    const outcome = r.value;
    return { ok: outcome.ok, ticks: outcome.tick - start, received: outcome.received, ...(outcome.reason ? { reason: outcome.reason } : {}) };
}

export interface GiveResult {
    ok: boolean;
    /** Giver clock: ticks from our first trade click to the items leaving. */
    ticks: number;
    gave: TradeItem[];
    sent: number;
    /** Why it failed; on success, set only when the trade completed although we declined it. */
    reason?: string;
}

/** Give the whole inventory to `partner`. */
export function giveAll(sdk: TradeSdk, partner: string, opts: GiveOptions = {}): Promise<GiveResult> {
    return giveImpl(sdk, partner, 'all', opts);
}

/** Give the matching items to `partner`. */
export function give(sdk: TradeSdk, partner: string, specs: readonly GiveSpec[], opts: GiveOptions = {}): Promise<GiveResult> {
    return giveImpl(sdk, partner, specs, opts);
}

/** expectTheirs for a giver that takes back whatever the partner hands over in the same trade, including nothing. */
export const ANY_OFFER: WantSpec[] = [{ item: /./, amount: 0 }];

export interface GiveOptions {
    /** What the partner may put up (default: nothing; ANY_OFFER for anything). */
    expectTheirs?: WantSpec[];
    maxTicks?: number;
    /** Observed ticks to get the trade open (openTrade's `maxTicks`: default OPEN_MAX_TICKS). */
    openMaxTicks?: number;
    /** Wall-clock give-up for opening (openTrade's `timeoutMs`: default openBackstopMs). */
    openTimeoutMs?: number;
    /** openTrade's `noReplyTicks` (opt-in DROPPED_TICKS beside the partner). */
    noReplyTicks?: number;
    /** openTrade's `resendTicks` (default RESEND_TICKS; Infinity: a standing request is never re-sent). */
    resendTicks?: number;
    /** Checked on every published state from the open on: a reason declines the trade and ends the give. */
    stopIf?: (s: BotWorldState) => string | null;
}

async function giveImpl(sdk: TradeSdk, partner: string, specs: readonly GiveSpec[] | 'all', opts: GiveOptions): Promise<GiveResult> {
    const stopIf = opts.stopIf;
    let stopWhy = null as string | null;
    const open = await openTrade(sdk, partner, {
        maxTicks: opts.openMaxTicks,
        timeoutMs: opts.openTimeoutMs,
        noReplyTicks: opts.noReplyTicks,
        ...(opts.resendTicks !== undefined ? { resendTicks: opts.resendTicks } : {}),
        ...(stopIf ? { stopped: (s: BotWorldState) => !!(stopWhy = stopIf(s)) } : {})
    });
    if (!open.ok) return { ok: false, ticks: 0, gave: [], sent: 0, reason: open.reason === 'stopped' && stopWhy ? `stopped: ${stopWhy}` : open.reason };
    const start = open.firstClickTick;
    const s0 = sdk.getState()!;
    const plan = planOffers(s0.inventory, specs);
    if (plan.length === 0) {
        await sdk.sendDeclineTrade();
        return { ok: false, ticks: 0, gave: [], sent: 0, reason: 'nothing to give' };
    }
    let ctx = newGiverCtx(partner, s0.inventory, plan, opts.expectTheirs);
    let sent = 0;
    const r = await onStates(sdk, opts.maxTicks ?? 100, s => {
        const why = stopIf?.(s);
        if (why) {
            void sdk.sendDeclineTrade();
            return { ok: false, tick: s.tick, gave: [] as TradeItem[], reason: `stopped: ${why}` };
        }
        const d = decideGiver(s, ctx);
        ctx = d.next;
        switch (d.action) {
            case 'burst': sent = burst(sdk, plan); return undefined;
            case 'accept': void sdk.sendAcceptTrade(); return undefined;
            case 'decline':
                void sdk.sendDeclineTrade();
                return d.settle ? undefined : { ok: false, tick: s.tick, gave: [] as TradeItem[], reason: d.reason };
            case 'done': return { ok: true, tick: s.tick, gave: d.gave, ...completedDespite(ctx.declined) };
            case 'closed': return { ok: false, tick: s.tick, gave: [] as TradeItem[], reason: d.reason ?? 'closed before completing' };
            default: return undefined;
        }
    });
    if (!r.ok) return { ok: false, ticks: (sdk.getState()?.tick ?? start) - start, gave: [], sent, reason: failureReason(r.reason) };
    const outcome = r.value;
    return { ok: outcome.ok, ticks: outcome.tick - start, gave: outcome.gave, sent, ...(outcome.reason ? { reason: outcome.reason } : {}) };
}

/**
 * Fire every offer, then the accept, without waiting between them. Button
 * offers are queued synchronously in order; an X offer awaits its own count
 * dialog (the SDK sends the count after the click resolves), so the accept is
 * queued only after the last X offer's count is in.
 */
function burst(sdk: TradeSdk, plan: readonly OfferEntry[]): number {
    let events = 0;
    const xs: Array<{ slot: number; amount: number }> = [];
    for (const e of plan) {
        for (const amount of e.amounts) {
            if (isXAmount(amount)) xs.push({ slot: e.slot, amount });
            else void sdk.sendOfferItem(e.slot, amount);
            events++;
        }
    }
    if (xs.length === 0) {
        void sdk.sendAcceptTrade();
    } else {
        void (async () => {
            for (const x of xs) await sdk.sendOfferItem(x.slot, x.amount);
            await sdk.sendAcceptTrade();
        })();
    }
    return events + 1;
}

// ---------------------------------------------------------------- swap (two-way)
//
// One trade that hands items over and takes items back: the anvil helper offers
// the next inventory's bars while the scored account offers the products it just
// made (docs/speedrun/skills/smithing.md section 4); a quest kit comes in while
// the previous step's gear goes out. receiveFrom() cannot do it (the receiver
// declines a non-empty offer of its own), but the giver can: decideGiver with
// `expectTheirs` offers, checks both offers on both screens and judges the
// outcome. swap() is a driver around it, or around decideReceiver when there is
// nothing to give, so every trade rule has one home above.
//
// It opens through openTrade (the one rule for when a trade click may go out). An id may
// not be both given and wanted: the outcome is read as an inventory delta by id,
// so such a call is refused rather than a refund misjudged as a delivery.
//
// The partner's half, which a helper role implements (give() with
// `expectTheirs`, or helpers/mule.ts giveOpenTrade, does all of it):
// - Opening: either side may request. A partner whose request stands opens the
//   trade on our first click that lands; a partner that requests us instead
//   opens it on our next click.
// - Offer screen: the partner offers its items and accepts. Our offer landing
//   after its accept resets both accepts (trade.rs2), so it re-accepts once our
//   offer is up.
// - Confirm screen: both accept; neither side changes anything there.
// - Done: for us, the giver's rule (our items gone after our confirm accept), or
//   with nothing given the receiver's (the wanted items arrived); for the
//   partner, its own items gone.

export type SwapSdk = TradeSdk & Pick<BotSDK, 'sendCloseModal'>;

export interface SwapOptions {
    /** Ticks to get the screens open from our first click (default 30). */
    openTicks?: number;
    /** Ticks from the screens opening to the outcome (default 40). */
    maxTicks?: number;
    /**
     * Send CLOSE_MODAL with each trade click while a chat or main modal is open:
     * an open modal makes us busy() (Player.ts), and the partner's request bounces.
     */
    closeModals?: boolean;
}

export interface SwapResult {
    ok: boolean;
    /** Our clock: ticks from our first trade click (or the screens opening, if they opened first) to the outcome. */
    ticks: number;
    /** Ticks from our first trade click to the screens opening; -1 when they never opened. */
    openTicks: number;
    received: TradeItem[];
    gave: TradeItem[];
    /** Why it failed; on success, set only when the trade completed although we declined it. */
    reason?: string;
}

/**
 * Trade `give` to `partner` and take `want` back in the same trade.
 *
 * `give` is planned from the inventory as it is now (planOffers: one Offer-All
 * per item id unless a count is asked for); `want` is what the partner's offer
 * must cover on both screens. `received` and `gave` are the inventory delta at
 * the outcome.
 */
export async function swap(sdk: SwapSdk, partner: string, give: readonly GiveSpec[], want: readonly WantSpec[], opts: SwapOptions = {}): Promise<SwapResult> {
    const s0 = sdk.getState();
    if (!s0) throw new Error('swap: no state');
    const openTicks = opts.openTicks ?? 30;
    const plan = give.length ? planOffers(s0.inventory, give) : [];
    const overlap = plan.filter(e => want.some(w => matchesItem(e, w.item)));
    if (overlap.length) throw new Error(`swap: ${overlap.map(e => e.name).join(', ')} both given and wanted; the outcome is judged by the inventory delta, so give and want must not share an item`);
    if (plan.length === 0 && want.length === 0) throw new Error('swap: nothing to give and nothing wanted');

    let giver = plan.length > 0 ? newGiverCtx(partner, s0.inventory, plan, want.length ? [...want] : undefined) : null;
    let receiver = giver ? null : newReceiverCtx(partner, s0.inventory, [...want]);
    const decide = (s: BotWorldState): GiverAction | ReceiverAction => {
        if (giver) {
            const d = decideGiver(s, giver);
            giver = d.next;
            return d;
        }
        const d = decideReceiver(s, receiver!);
        receiver = d.next;
        return d;
    };
    const declined = () => (giver ?? receiver!).declined;
    const invBefore = countInventoryById([...s0.inventory]);

    const start = s0.tick;
    type Outcome = { ok: boolean; tick: number; received: TradeItem[]; gave: TradeItem[]; reason?: string };
    const fail = (tick: number, reason: string): Outcome => ({ ok: false, tick, received: [], gave: [], reason });
    // Beside the partner (the anvil helper's tile): a silent click was dropped (our own delay).
    const open = await openTrade(sdk, partner, { maxTicks: openTicks, goneTicks: openTicks, closeModals: opts.closeModals, timeoutMs: Infinity, noReplyTicks: DROPPED_TICKS });
    const from = open.firstClickTick >= 0 ? open.firstClickTick : start;
    if (!open.ok) return { ok: false, ticks: (sdk.getState()?.tick ?? from) - from, openTicks: -1, received: [], gave: [], reason: open.reason };
    // openTrade resolved on the frame the screens opened: the first step below runs on it.
    const r = await onStates<Outcome>(sdk, opts.maxTicks ?? 40, s => {
        const d = decide(s);
        switch (d.action) {
            case 'burst': burst(sdk, plan); return undefined;
            case 'accept': void sdk.sendAcceptTrade(); return undefined;
            case 'decline':
                void sdk.sendDeclineTrade();
                return d.settle ? undefined : fail(s.tick, d.reason);
            case 'done': {
                const moved = diffInventories(invBefore, countInventoryById(s.inventory));
                return { ok: true, tick: s.tick, received: moved.gained, gave: moved.lost, ...completedDespite(declined()) };
            }
            case 'closed': return fail(s.tick, d.reason ?? (giver ? 'closed before completing' : 'closed without the items arriving'));
            default: return undefined;
        }
    });
    const opened = open.openTick - from;
    if (!r.ok) return { ok: false, ticks: (sdk.getState()?.tick ?? from) - from, openTicks: opened, received: [], gave: [], reason: failureReason(r.reason) };
    const outcome = r.value;
    return { ok: outcome.ok, ticks: outcome.tick - from, openTicks: opened, received: outcome.received, gave: outcome.gave, ...(outcome.reason ? { reason: outcome.reason } : {}) };
}

export type { ActionResult };
