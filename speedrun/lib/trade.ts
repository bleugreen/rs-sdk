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
import { countInventoryById, diffInventories, offerSatisfies, shortfall } from '../../sdk/trade-helpers';
import { amountButtons, isXAmount, matchesItem, type ItemPattern } from './items';
import { tickMs, type StateSource } from './wait';

export type TradeSdk = StateSource &
    Pick<BotSDK, 'sendTradeRequest' | 'sendOfferItem' | 'sendAcceptTrade' | 'sendDeclineTrade'>;

/** A want spec: at least `amount` (default 1) of items whose name matches. */
export interface WantSpec {
    item: string | RegExp;
    amount?: number;
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
    return expect ? offerSatisfies(expect, [...theirs]) : theirs.length === 0;
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
    /** Tick of our first trade click. */
    firstClickTick: number;
    reason?: 'player_not_found' | 'no_response';
}

/** trade.rs2 [opplayer4]: the engine's refusal of a request while the target is busy (a delay, a level-up page). */
export const TRADE_BUSY_RE = /is busy at the moment/i;

/** trade.rs2 [opplayer4]'s `<name>:tradereq:`, as both clients show it: chat type 4 from the requester. */
export const TRADE_REQUEST_RE = /wishes to trade/i;

export function isTradeRequest(m: GameMessage): boolean {
    return m.type === 4 && TRADE_REQUEST_RE.test(m.text);
}

/**
 * Open a trade with `partner` by name. A trade request to a player who has
 * already requested us is the acceptance and opens both screens at once. A
 * request refused because the partner is busy is re-sent on the frame that
 * shows the refusal; one that stands unanswered is re-sent every 8 s.
 *
 * The partner's own request, arriving after our click has landed, is answered
 * on the frame it shows. It proves our request is not standing (had it been,
 * their click would have opened the trade): the engine drops a click from a
 * delayed player without a word (OpPlayerHandler), so a request sent during a
 * craft's delay is lost. A request shown on the frame our click lands on is not
 * answered: that click may be the answer, and a click on an open trade closes
 * it (clearPendingAction).
 */
export async function openTrade(sdk: TradeSdk, partner: string, opts: { timeoutMs?: number } = {}): Promise<OpenResult> {
    const timeoutMs = opts.timeoutMs ?? 60_000;
    const deadline = Date.now() + timeoutMs;
    const now = sdk.getState();
    const open = now ? tradeOf(now) : CLOSED;
    if (open.isOpen && sameName(open.partner, partner)) return { ok: true, firstClickTick: now!.tick };
    if (open.isOpen) await sdk.sendDeclineTrade();

    let firstClickTick = -1;
    let lastRefusal = -1;
    let lastAnswered = -1;
    while (Date.now() < deadline) {
        const s = sdk.getState();
        const player = s?.nearbyPlayers.find(p => sameName(p.name, partner));
        if (!player) {
            if (firstClickTick < 0 && Date.now() + tickMs() * 5 > deadline) return { ok: false, firstClickTick, reason: 'player_not_found' };
            await waitState(sdk, st => st.nearbyPlayers.some(p => sameName(p.name, partner)), Math.min(5 * tickMs(), deadline - Date.now()));
            if (!sdk.getState()?.nearbyPlayers.some(p => sameName(p.name, partner))) return { ok: false, firstClickTick, reason: 'player_not_found' };
            continue;
        }
        if (firstClickTick < 0) firstClickTick = s!.tick;
        const clickTick = s!.tick;
        void sdk.sendTradeRequest(player.index);
        const refusal = (st: BotWorldState) => st.gameMessages.find(m => m.tick >= clickTick && m.tick > lastRefusal && TRADE_BUSY_RE.test(m.text));
        const asked = (st: BotWorldState) =>
            st.tick >= clickTick + 2 ? st.gameMessages.find(m => m.tick > clickTick && m.tick > lastAnswered && isTradeRequest(m) && sameName(m.sender, partner)) : undefined;
        await waitState(sdk, st => tradeOf(st).isOpen || refusal(st) !== undefined || asked(st) !== undefined, Math.min(8_000, deadline - Date.now()));
        const after = sdk.getState();
        if (after && tradeOf(after).isOpen) return { ok: true, firstClickTick };
        const refused = after ? refusal(after) : undefined;
        if (refused) lastRefusal = refused.tick;
        const request = after ? asked(after) : undefined;
        if (request) lastAnswered = request.tick;
    }
    return { ok: false, firstClickTick, reason: 'no_response' };
}

/** Wall-clock bounded wait used where the bound is "seconds", not ticks. */
function waitState(sdk: StateSource, pred: (s: BotWorldState) => boolean, ms: number): Promise<boolean> {
    return new Promise(resolve => {
        const cur = sdk.getState();
        if (cur && pred(cur)) return resolve(true);
        const unsub = sdk.onStateUpdate(s => {
            if (pred(s)) finish(true);
        });
        const timer = setTimeout(() => finish(false), Math.max(0, ms));
        function finish(v: boolean) {
            unsub();
            clearTimeout(timer);
            resolve(v);
        }
    });
}

// ---------------------------------------------------------------- drivers

/** Feed every published state to `step` until it returns a terminal value. */
function drive<T>(sdk: StateSource, maxTicks: number, step: (s: BotWorldState) => T | undefined): Promise<T | 'timeout'> {
    return new Promise(resolve => {
        const start = sdk.getState()?.tick ?? 0;
        let done = false;
        const finish = (v: T | 'timeout') => {
            if (done) return;
            done = true;
            unsub();
            clearTimeout(wall);
            resolve(v);
        };
        const handle = (s: BotWorldState) => {
            if (done) return;
            const r = step(s);
            if (r !== undefined) finish(r);
            else if (s.tick - start > maxTicks) finish('timeout');
        };
        const unsub = sdk.onStateUpdate(handle);
        const wall = setTimeout(() => finish('timeout'), (maxTicks + 10) * tickMs());
        const cur = sdk.getState();
        if (cur) handle(cur);
    });
}

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
export async function receiveFrom(sdk: TradeSdk, partner: string, opts: { want?: WantSpec[]; maxTicks?: number; openTimeoutMs?: number } = {}): Promise<ReceiveResult> {
    const s0 = sdk.getState();
    if (!s0) throw new Error('receiveFrom: no state');
    let ctx = newReceiverCtx(partner, s0.inventory, opts.want);
    const open = await openTrade(sdk, partner, { timeoutMs: opts.openTimeoutMs ?? 60_000 });
    if (!open.ok) return { ok: false, ticks: 0, received: [], reason: open.reason };
    const start = open.firstClickTick;
    const outcome = await drive(sdk, opts.maxTicks ?? 100, s => {
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
    if (outcome === 'timeout') return { ok: false, ticks: (sdk.getState()?.tick ?? start) - start, received: [], reason: 'timeout' };
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
    openTimeoutMs?: number;
}

async function giveImpl(sdk: TradeSdk, partner: string, specs: readonly GiveSpec[] | 'all', opts: GiveOptions): Promise<GiveResult> {
    const open = await openTrade(sdk, partner, { timeoutMs: opts.openTimeoutMs ?? 60_000 });
    if (!open.ok) return { ok: false, ticks: 0, gave: [], sent: 0, reason: open.reason };
    const start = open.firstClickTick;
    const s0 = sdk.getState()!;
    const plan = planOffers(s0.inventory, specs);
    if (plan.length === 0) {
        await sdk.sendDeclineTrade();
        return { ok: false, ticks: 0, gave: [], sent: 0, reason: 'nothing to give' };
    }
    let ctx = newGiverCtx(partner, s0.inventory, plan, opts.expectTheirs);
    let sent = 0;
    const outcome = await drive(sdk, opts.maxTicks ?? 100, s => {
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
    if (outcome === 'timeout') return { ok: false, ticks: (sdk.getState()?.tick ?? start) - start, gave: [], sent, reason: 'timeout' };
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

export type { ActionResult };
