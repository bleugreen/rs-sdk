// The scored account's side of the wine hand-off (cairn://p/rs/88; design and
// measurements in docs/speedrun/helpers/wine.md): take the noted wines in one
// trade, get them into the bank before the fermenting_wine timer fires, clear the
// level-up pages each firing queues, and arm the next firing.
//
// Engine facts this relies on (World.ts processPlayers, Player.ts):
//
//  - Each tick runs the client's packets, then the player's queues, timers, the
//    engine queue and interactions, in that order. A normal timer fires only when
//    the player has no modal open, and the bank and trade windows are modals, so
//    once the bank is open the timer waits for it to close and a deposit may land
//    after the due tick. What must happen before the due tick is the bank
//    OPENING: for the login timer (due at login + 20) the bank must open by
//    login + 19 on the receiver's clock. Between the trade window closing and the
//    bank opening the account is free, and a timer that comes due then fires on
//    whatever the bank holds.
//  - Every stat_advance that crosses a level enqueues its own level-up script on
//    the engine queue (Player.ts addXp). Over 29 wines from Cooking 1 that is
//    about 16 scripts, each a chat page, and two pages each when the final level
//    is one of Cooking's unlock levels (53, 55, ...). Dismissing one ends its
//    script and the engine queue starts the next in the same tick, before
//    interactions, so the bank cannot open until the last page is gone: at
//    least one tick per page.
//  - A logout does not skip them: the engine removes a player only when its
//    engine queue is empty, running one queued script per tick until then
//    (World.ts processLogouts).
import type { BotSDK } from '../../sdk/index';
import type { BotWorldState } from '../../sdk/types';
import { classifyPage } from '../lib/dialogue';
import { receiveFrom, type TradeSdk } from '../lib/trade';
import { failureReason, onStates, STALLED, type StateSource } from '../lib/wait';
import { ITEM, WINE_COOKING_LEVEL } from './wine-common';

/** login.rs2 -> ~ferment_wines_login: settimer(fermenting_wine, 20); a make does the same (wine.rs2). */
export const FERMENT_TIMER_TICKS = 20;

export type ReceiverSdk = StateSource &
    TradeSdk &
    Pick<BotSDK, 'sendBankDeposit' | 'sendCloseModal' | 'sendInteractLoc' | 'sendClickDialog' | 'sendUseItemOnItem'>;

export interface ReceiverCtx {
    sdk: ReceiverSdk;
    log?: (message: string, data?: Record<string, unknown>) => void;
}

export interface LoginWindow {
    /** The tick of this session's first in-world state, on the receiver's own clock. */
    loginTick: number;
    /**
     * Clean logout and login (speedrun/lib/session.ts `relog`); resolves to the new
     * session's first in-world tick. Needed when a deposit misses the timer.
     */
    relog?: () => Promise<number>;
}

// ---------------------------------------------------------------- decisions

/**
 * Whether a timer due at `dueTick` waits for this bank visit. The timer phase of
 * a tick runs before its interactions, so a bank that opens on the due tick is
 * already too late; one that opened earlier holds the timer until it closes.
 */
export function timerHeld(bankOpenTick: number, dueTick: number): boolean {
    return bankOpenTick < dueTick;
}

/** What to do after a deposit meant for the timer due at `dueTick`. */
export function afterDeposit(bankOpenTick: number, dueTick: number): 'await-firing' | 'relog' {
    return timerHeld(bankOpenTick, dueTick) ? 'await-firing' : 'relog';
}

/**
 * Deposit buttons that move exactly `n` of a stack: All, or 10/5/1 clicks when
 * there are at most ten of them (two ticks at the engine's five events per
 * tick, with no count-dialog round trip), else one X amount. 29 is 10,10,5,1,1,1,1.
 */
export function depositButtons(n: number, stack: number): number[] {
    if (!Number.isInteger(n) || n <= 0) throw new Error(`invalid amount ${n}`);
    if (n >= stack) return [-1];
    const tens = Math.floor(n / 10);
    const fives = Math.floor((n % 10) / 5);
    const ones = n % 5;
    if (tens + fives + ones > 10) return [n];
    return [...Array(tens).fill(10), ...Array(fives).fill(5), ...Array(ones).fill(1)];
}

// ---------------------------------------------------------------- state reads

function count(s: BotWorldState | null | undefined, id: number): number {
    return s?.inventory.reduce((n, i) => (i.id === id ? n + i.count : n), 0) ?? 0;
}

function cooking(s: BotWorldState | null | undefined): { level: number; xp: number } {
    const k = s?.skills.find(x => x.name === 'Cooking');
    return { level: k?.baseLevel ?? 1, xp: k?.experience ?? 0 };
}

function bankClosed(s: BotWorldState): boolean {
    return !s.bank.isOpen && !s.interface.isOpen;
}

export interface Booth {
    x: number;
    z: number;
    id: number;
    op: number;
}

/**
 * The nearest bank booth and its op that opens the bank directly: Bank, else
 * Use-quickly. Plain Use starts a banker conversation (a choice page).
 */
export function findBooth(s: BotWorldState): Booth | null {
    const booths = s.nearbyLocs
        .filter(l => /bank booth/i.test(l.name))
        .map(l => ({ l, opt: l.optionsWithIndex.find(o => /^bank$/i.test(o.text)) ?? l.optionsWithIndex.find(o => /use.quickly/i.test(o.text)) }))
        .filter(b => b.opt)
        .sort((a, b) => a.l.distance - b.l.distance);
    const b = booths[0];
    return b ? { x: b.l.x, z: b.l.z, id: b.l.id, op: b.opt!.opIndex } : null;
}

// ---------------------------------------------------------------- primitives

export interface ChatDrain {
    ok: boolean;
    /** Continue pages seen (a page re-opened under the same id counts once per opening). */
    pages: number;
    /** Blind continues sent: one per tick while a continue page shows. */
    resumes: number;
    startTick: number;
    endTick: number;
    reason?: string;
}

/**
 * Blind continues sent per tick while a page shows. The engine resumes paused
 * scripts in the packet phase but starts the next queued level-up script only in
 * the player phase, so a second continue in the same tick cannot reach the next
 * level-up: it ends a second page only inside the same script (the unlock page a
 * level-up shows at Cooking's unlock levels). Two per tick therefore clear one
 * level-up script per tick whether or not it has an unlock page; any extra
 * continue finds no paused script and is ignored.
 */
export const CONTINUES_PER_TICK = 2;

/**
 * Tracks the chat while level-up pages chain, and sends `perTick` blind
 * continues per tick while a continue page shows. Blind: the lite client would
 * otherwise wait to see the next page before sending, which costs a round trip
 * per page on the demo; sending every tick lets the server end a script per tick
 * however long the round trip is.
 */
class PageClicker {
    pages = 0;
    resumes = 0;
    private lastResume = -1;
    private wasOpen = false;
    private lastWaiting = false;

    constructor(private readonly sdk: Pick<BotSDK, 'sendClickDialog'>, private readonly perTick = CONTINUES_PER_TICK) {}

    /** 'continue' while a continue page shows, 'choice' for a page that is not ours, 'closed' otherwise. */
    see(s: BotWorldState): 'continue' | 'choice' | 'closed' {
        const kind = classifyPage(s.dialog);
        if (kind === 'none') {
            this.wasOpen = false;
            return 'closed';
        }
        if (kind === 'choice') return 'choice';
        if (!this.wasOpen || (this.lastWaiting && !s.dialog.isWaiting)) this.pages++;
        this.wasOpen = true;
        this.lastWaiting = s.dialog.isWaiting;
        if (s.tick > this.lastResume) {
            this.lastResume = s.tick;
            for (let i = 0; i < this.perTick; i++) {
                this.resumes++;
                void this.sdk.sendClickDialog(0, { blind: true });
            }
        }
        return 'continue';
    }
}

/**
 * Dismiss chained continue pages (level-ups) until the chat is closed and stays
 * closed over `quietTicks` more ticks. Never answers a choice page.
 */
export async function drainChat(sdk: StateSource & Pick<BotSDK, 'sendClickDialog'>, opts: { maxTicks?: number; quietTicks?: number; perTick?: number } = {}): Promise<ChatDrain> {
    const startTick = sdk.getState()?.tick ?? 0;
    const quiet = opts.quietTicks ?? 1;
    const clicker = new PageClicker(sdk, opts.perTick);
    let closedAt = -1;
    const r = await onStates(sdk, opts.maxTicks ?? 120, s => {
        const kind = clicker.see(s);
        if (kind === 'choice') return { ok: false, tick: s.tick, reason: 'a choice page is open' };
        if (kind === 'continue') {
            closedAt = -1;
            return undefined;
        }
        if (closedAt < 0) closedAt = s.tick;
        return s.tick - closedAt >= quiet ? { ok: true, tick: closedAt } : undefined;
    });
    const out = r.ok ? r.value : { ok: false, tick: sdk.getState()?.tick ?? startTick, reason: failureReason(r.reason) };
    return { ok: out.ok, pages: clicker.pages, resumes: clicker.resumes, startTick, endTick: out.tick, ...('reason' in out && out.reason ? { reason: out.reason } : {}) };
}

export interface BankOpen {
    ok: boolean;
    openTick: number;
    startTick: number;
    pages: number;
    resumes: number;
    reason?: string;
}

/**
 * Open the nearest bank booth, clicking through any level-up pages on the way.
 * The booth op is sent first and stays pending while the pages chain, so the
 * bank opens in the very tick the last page is dismissed. The op is re-sent if
 * neither a page nor the bank shows for `resendTicks` ticks.
 */
export async function openBankThroughPages(sdk: ReceiverSdk, opts: { maxTicks?: number; resendTicks?: number; perTick?: number } = {}): Promise<BankOpen> {
    const s0 = sdk.getState();
    if (!s0) throw new Error('openBankThroughPages: no state');
    const startTick = s0.tick;
    if (s0.bank.isOpen) return { ok: true, openTick: s0.tick, startTick, pages: 0, resumes: 0 };
    const booth = findBooth(s0);
    if (!booth) return { ok: false, openTick: -1, startTick, pages: 0, resumes: 0, reason: 'no bank booth in sight' };
    const resend = opts.resendTicks ?? 4;
    const clicker = new PageClicker(sdk, opts.perTick);
    let lastOp = s0.tick;
    let lastPage = s0.tick;
    void sdk.sendInteractLoc(booth.x, booth.z, booth.id, booth.op);
    const r = await onStates(sdk, opts.maxTicks ?? 120, s => {
        if (s.bank.isOpen) return { ok: true, tick: s.tick };
        const kind = clicker.see(s);
        if (kind === 'choice') return { ok: false, tick: s.tick, reason: 'a choice page is open' };
        if (kind === 'continue') lastPage = s.tick;
        else if (s.tick - Math.max(lastOp, lastPage) >= resend) {
            lastOp = s.tick;
            void sdk.sendInteractLoc(booth.x, booth.z, booth.id, booth.op);
        }
        return undefined;
    });
    const out = r.ok ? r.value : { ok: false, tick: -1, reason: failureReason(r.reason) };
    return { ok: out.ok, openTick: out.tick, startTick, pages: clicker.pages, resumes: clicker.resumes, ...('reason' in out && out.reason ? { reason: out.reason } : {}) };
}

export interface NoteDeposit {
    ok: boolean;
    deposited: number;
    /** Tick the deposit (and the close, when asked) was seen done. */
    doneTick: number;
    reason?: string;
}

/**
 * Extra bank packets for a deposit burst, sent after the deposit buttons and before
 * the close, on the state the burst starts from (bank slots do not move while the
 * bank is open). Returns how many packets it sent, so the wait covers them.
 */
export type BurstExtra = (s: BotWorldState) => number;

/**
 * With the bank open, deposit `amount` noted wines (the bank stores them
 * unnoted) and, with `close`, close the bank in the same burst: the engine
 * handles the deposit clicks before the close request, which it applies later
 * in the same tick. `extra` rides in the burst ahead of the close (the cooking
 * windows' chisel and gem withdrawals).
 */
export async function depositNotes(sdk: ReceiverSdk, amount: number | 'all', opts: { close?: boolean; maxTicks?: number; extra?: BurstExtra } = {}): Promise<NoteDeposit> {
    const s = sdk.getState();
    if (!s?.bank.isOpen) return { ok: false, deposited: 0, doneTick: -1, reason: 'bank not open' };
    const note = s.inventory.find(i => i.id === ITEM.wineNote);
    if (!note) return { ok: false, deposited: 0, doneTick: -1, reason: 'no noted wine held' };
    const held = count(s, ITEM.wineNote);
    const n = amount === 'all' ? held : Math.min(amount, held);
    const left = held - n;
    const buttons = depositButtons(n, held);
    for (const b of buttons) void sdk.sendBankDeposit(note.slot, b);
    const extra = opts.extra ? opts.extra(s) : 0;
    if (opts.close) void sdk.sendCloseModal();
    const xAmount = buttons.some(b => b !== -1 && b !== 1 && b !== 5 && b !== 10);
    const r = await onStates(sdk, opts.maxTicks ?? Math.ceil((buttons.length + extra) / 5) + (xAmount ? 10 : 6), st =>
        count(st, ITEM.wineNote) <= left && (!opts.close || bankClosed(st)) ? st.tick : undefined
    );
    const after = count(sdk.getState(), ITEM.wineNote);
    if (!r.ok) return { ok: false, deposited: held - after, doneTick: -1, reason: failureReason(r.reason) };
    return { ok: true, deposited: held - after, doneTick: r.value };
}

export interface Firing {
    fired: boolean;
    tick: number;
    level: number;
    xpGained: number;
}

/**
 * Wait for a fermenting_wine firing (Cooking xp rising) due at `dueTick`, or
 * until `slack` ticks after max(dueTick, now). A firing in which every roll
 * failed gives no xp and no message, so it reads as not fired.
 */
export async function awaitFiring(sdk: StateSource, dueTick: number, slack = 3): Promise<Firing> {
    const s0 = sdk.getState();
    const xp0 = cooking(s0).xp;
    const until = Math.max(dueTick, s0?.tick ?? 0) + slack;
    const r = await onStates(sdk, until - (s0?.tick ?? 0) + 1, s => (cooking(s).xp > xp0 ? s : s.tick > until ? null : undefined));
    const fired = r.ok ? r.value : null;
    const c = cooking(fired ?? sdk.getState());
    return { fired: c.xp > xp0, tick: fired ? fired.tick : -1, level: c.level, xpGained: c.xp - xp0 };
}

export interface Make {
    ok: boolean;
    tick: number;
    reason?: string;
}

/** Use grapes on a jug of water once (needs Cooking 35): arms the timer for 20 ticks from the make. */
export async function makeOneWine(sdk: ReceiverSdk, maxTicks = 6): Promise<Make> {
    const s = sdk.getState();
    if (!s) throw new Error('makeOneWine: no state');
    if (cooking(s).level < WINE_COOKING_LEVEL) return { ok: false, tick: -1, reason: `Cooking ${cooking(s).level} < ${WINE_COOKING_LEVEL}` };
    const g = s.inventory.find(i => i.id === ITEM.grapes);
    const j = s.inventory.find(i => i.id === ITEM.jugWater);
    if (!g || !j) return { ok: false, tick: -1, reason: 'no grapes and jug of water held' };
    const before = count(s, ITEM.wine);
    void sdk.sendUseItemOnItem(g.slot, j.slot);
    const r = await onStates(sdk, maxTicks, st => (count(st, ITEM.wine) > before ? st.tick : undefined));
    return r.ok ? { ok: true, tick: r.value } : { ok: false, tick: -1, reason: r.reason === 'idle' ? STALLED : 'the make was not accepted' };
}

// ---------------------------------------------------------------- the deposit for a timer

export interface TimedDeposit {
    deposited: number;
    bankOpenTick: number;
    doneTick: number;
    /** Ticks from the bank click to the bank closed again, level-up pages included. */
    bankTicks: number;
    pages: number;
    /** The timer due at `dueTick` waited for this deposit. */
    held: boolean;
}

/** Open the bank (through any level-up pages), deposit `amount` notes, close; judge it against the timer due at `dueTick`. */
export async function depositForTimer(ctx: ReceiverCtx, amount: number | 'all', dueTick: number, extra?: BurstExtra): Promise<TimedDeposit> {
    const { sdk } = ctx;
    const t0 = sdk.getState()?.tick ?? 0;
    const open = await openBankThroughPages(sdk);
    if (!open.ok) throw new Error(`could not open the bank: ${open.reason}`);
    const d = await depositNotes(sdk, amount, { close: true, ...(extra ? { extra } : {}) });
    if (!d.ok) throw new Error(`deposit failed: ${d.reason}`);
    const out = { deposited: d.deposited, bankOpenTick: open.openTick, doneTick: d.doneTick, bankTicks: d.doneTick - t0, pages: open.pages, held: timerHeld(open.openTick, dueTick) };
    ctx.log?.('wine deposit', { ...out, dueTick });
    return out;
}

// ---------------------------------------------------------------- the trade

/** Observed ticks the wine trade gets to open by default (the 120 s wall default it replaces, at 300 ms). */
export const WINE_OPEN_TICKS = 400;

async function takeTrade(ctx: ReceiverCtx, giver: string, wantNotes: number, kit: boolean, openTimeoutMs: number | undefined): Promise<{ received: number; tradeTicks: number; skipped: boolean }> {
    const { sdk } = ctx;
    const s = sdk.getState();
    const hasKit = count(s, ITEM.grapes) >= 1 && count(s, ITEM.jugWater) >= 1;
    // Restart after a relog: the trade already happened.
    if (count(s, ITEM.wineNote) >= wantNotes && (!kit || hasKit)) return { received: 0, tradeTicks: 0, skipped: true };
    const before = count(s, ITEM.wineNote);
    const want = [{ item: /^unfermented wine$/i, amount: wantNotes - before }];
    if (kit) want.push({ item: /^grapes$/i, amount: 1 }, { item: /^jug of water$/i, amount: 1 });
    const r = await receiveFrom(sdk, giver, { want, ...(openTimeoutMs === undefined ? { openMaxTicks: WINE_OPEN_TICKS } : { openTimeoutMs }) });
    // The inventory is the truth: on the demo a receiver reported a declined trade
    // whose items had arrived (its decline landed after the trade completed).
    const received = count(sdk.getState(), ITEM.wineNote) - before;
    if (received <= 0) throw new Error(`wine trade failed: ${r.reason ?? 'no wine arrived'}`);
    if (!r.ok) ctx.log?.('wine trade reported failure but the notes arrived', { reason: r.reason, received });
    return { received, tradeTicks: r.ticks, skipped: false };
}

function requireRelog(w: LoginWindow): () => Promise<number> {
    if (!w.relog) throw new Error('the deposit missed the login timer and no relog was given');
    return w.relog;
}

// ---------------------------------------------------------------- window variant

export interface ReceiveResult {
    received: number;
    deposited: number;
    tradeTicks: number;
    bankTicks: number;
    firstClickTick: number;
    bankOpenTick: number;
    doneTick: number;
    held: boolean;
    /** Relogs the deadline fallback made, and the login tick of the session the wine ferments in. */
    relogs: number;
    loginTick: number;
}

/**
 * Window variant: take one trade of noted wine from `giver` and deposit it (all,
 * or `depositAmount`) for the login timer of the current session. If the bank
 * opened too late for that timer, the wine is still deposited, and the account
 * relogs once: the new login's timer ferments it at its login + 20. Does not wait
 * for the firing. Stand next to a bank booth.
 */
export async function receiveWine(ctx: ReceiverCtx, giver: string, opts: LoginWindow & { depositAmount?: number; minWines?: number; openTimeoutMs?: number }): Promise<ReceiveResult> {
    const firstClickTick = ctx.sdk.getState()?.tick ?? 0;
    const t = await takeTrade(ctx, giver, opts.minWines ?? 1, false, opts.openTimeoutMs);
    const dep = await depositForTimer(ctx, opts.depositAmount ?? 'all', opts.loginTick + FERMENT_TIMER_TICKS);
    let loginTick = opts.loginTick;
    let relogs = 0;
    if (!dep.held) {
        loginTick = await requireRelog(opts)();
        relogs++;
    }
    return { received: t.received, deposited: dep.deposited, tradeTicks: t.tradeTicks, bankTicks: dep.bankTicks, firstClickTick, bankOpenTick: dep.bankOpenTick, doneTick: dep.doneTick, held: dep.held, relogs, loginTick };
}

// ---------------------------------------------------------------- split variant

export type SecondArming = 'make' | 'relog';

/**
 * Work for the scored account to do inside the split's waits (S25c's gem cutting,
 * skills/cooking.ts). Every hook is optional, and with none the split sends exactly
 * what it sends without them.
 */
export interface SplitWindows {
    /** Extra packets in the first deposit's burst, before its close (withdraw the chisel and a gem stack). */
    firstBurst?: BurstExtra;
    /**
     * Runs alongside the wait for the first firing, due at `due`; awaitFiring starts first so
     * its xp baseline is read before the window acts. It must leave no modal open on `due`.
     */
    firstWait?: (due: number) => Promise<void>;
    /** Extra packets in the rest's deposit burst, before its close (deposit the cut gems). */
    restBurst?: BurstExtra;
    /**
     * Runs alongside the wait for the second firing and replaces the final drainChat: it
     * owns that firing's level-up pages. Its bank visits may hold the timer a tick or two,
     * so the firing is awaited with SECOND_WAIT_SLACK.
     */
    secondWait?: (due: number) => Promise<void>;
}

/** awaitFiring's slack for the second firing when a window's bank visits may hold the timer. */
export const SECOND_WAIT_SLACK = 6;

/**
 * Where a split delivery starts. 'trade' is the whole sequence; the others resume it
 * after a reconnect, whose login is itself an arming login (any login sets
 * fermenting_wine for login + 20), so a resume never needs an extra relog:
 *  - 'deposit-first': the notes are held, nothing banked: deposit `first` for this login's timer;
 *  - 'await-first': the first batch is banked: wait for this login's firing;
 *  - 'deposit-rest': the first firing is done and the rest still held: deposit it for this
 *    login's timer (no arming relog; the deadline relog if the bank opens too late);
 *  - 'await-second': the rest is banked: wait for this login's firing.
 */
export type SplitStage = 'trade' | 'deposit-first' | 'await-first' | 'deposit-rest' | 'await-second';
const STAGES: readonly SplitStage[] = ['trade', 'deposit-first', 'await-first', 'deposit-rest', 'await-second'];

/** The wine in the bank: unfermented (1995), and fermented (jugs of wine 1993 and bad wine 1991). */
export interface WineBank {
    unfermented: number;
    fermented: number;
}

export function wineBankOf(items: ReadonlyArray<{ id: number; count: number }>): WineBank {
    const n = (id: number) => items.reduce((k, i) => (i.id === id ? k + i.count : k), 0);
    return { unfermented: n(ITEM.wine), fermented: n(ITEM.jugWine) + n(ITEM.badWine) };
}

/**
 * The stage a split resumes at, from the noted wine held and the bank. A firing turns
 * every banked unfermented wine into wine or bad wine, so fermented wine in the bank
 * means the first firing is done. That holds only for a bank with no wine before the
 * split (SCORED's, on run day): an account with leftover jugs of wine or bad wine reads
 * as past its first firing. 'exhausted': no wine left anywhere.
 */
export function splitStage(notesHeld: number, bank: WineBank): SplitStage | 'exhausted' {
    if (bank.fermented > 0) {
        if (notesHeld > 0) return 'deposit-rest';
        return bank.unfermented > 0 ? 'await-second' : 'exhausted';
    }
    if (notesHeld > 0) return bank.unfermented > 0 ? 'await-first' : 'deposit-first';
    // all of it banked before any firing: this login's firing rolls it in one
    return bank.unfermented > 0 ? 'await-second' : 'trade';
}

/** awaitFiring for `due`, with `window` run beside it; awaitFiring starts first (its xp baseline). */
async function firingWith(sdk: StateSource, due: number, slack: number, window?: (due: number) => Promise<void>): Promise<Firing> {
    const firing = awaitFiring(sdk, due, slack);
    if (!window) return firing;
    const [f, w] = await Promise.allSettled([firing, window(due)]);
    if (w.status === 'rejected') throw w.reason;
    if (f.status === 'rejected') throw f.reason;
    return f.value;
}

export interface SplitResult {
    received: number;
    first: number;
    rest: number;
    tradeTicks: number;
    tradeSkipped: boolean;
    /** First bank visit (deposit `first`), ticks on the receiver's clock. */
    firstBankTicks: number;
    firstBankOpenTick: number;
    firstHeld: boolean;
    /** Relogs the deadline fallback made (0 normally). */
    missRelogs: number;
    /** Login tick of the session whose login timer fermented the first batch. */
    loginTick: number;
    firstFermentTick: number;
    levelAfterFirst: number;
    /** How the second firing was armed. */
    arming: SecondArming | 'none';
    /** Second bank visit: from the first firing to the bank closed with the rest deposited (pages included). */
    secondBankTicks: number;
    /** Of which: from the first firing to the bank opening (the level-up pages). */
    pagesTicks: number;
    pagesAfterFirst: number;
    resumesAfterFirst: number;
    rearmMakeTick: number;
    /** Login tick of the arming relog (arming 'relog'). */
    secondLoginTick: number;
    secondFermentTick: number;
    levelAfterSecond: number;
    finalPagesTicks: number;
    finalPages: number;
}

export interface SplitOptions extends LoginWindow {
    /** Wines in the first firing (default 29: 29 rolls of one wine each). */
    first?: number;
    /**
     * How the second firing is armed: 'relog' (default: bank the rest, then a
     * clean relog, whose login timer fires at login + 20; about 2 scored ticks on
     * the demo) or 'make' (one wine mixed by the receiver; needs Cooking 35 and
     * one grapes + one jug of water in the trade). Below Cooking 35, 'make' falls
     * back to a relog when one is given, else the rest stays banked for the next
     * login.
     */
    arming?: SecondArming;
    /** Click through the second firing's level-up pages (default true; `windows.secondWait` replaces it). */
    drainFinal?: boolean;
    openTimeoutMs?: number;
    /** Work inside the waits (none by default). */
    windows?: SplitWindows;
    /** Where to start (default 'trade'); a resume derives it with `splitStage`. */
    from?: SplitStage;
}

/**
 * The scored account's side of the split delivery (wine.md). Ferment a small
 * first batch (default 29) on the login timer to lift Cooking off level 1, then
 * the rest at the higher level:
 *
 *  1. receive the noted wines (+ one grapes and one jug of water for 'make') in
 *     one trade, unless they are already held (a restart after a relog);
 *     the scored account should log in at the bank with the giver beside it,
 *     which in the run means right after a planned relog there;
 *  2. deposit `first` notes; the bank must open by login + 19. If it opened
 *     later, the timer has fired on whatever the bank held before: the deposit
 *     is finished anyway and the account relogs, and the new login's timer
 *     ferments the batch;
 *  3. after the first firing, click through the level-up pages to the bank,
 *     deposit the rest and close in one burst, and arm the second firing: a
 *     clean relog (arming 'relog', the default; the new login's timer fires at
 *     login + 20) or one wine mixed by the receiver (arming 'make', 20 ticks
 *     after the make).
 *
 * Stand next to a bank booth, and keep out of modals when a timer is due.
 */
export async function splitDelivery(ctx: ReceiverCtx, giver: string, opts: SplitOptions): Promise<SplitResult> {
    const { sdk } = ctx;
    const first = opts.first ?? 29;
    const win = opts.windows ?? {};
    const from = opts.from ?? 'trade';
    const reaches = (stage: SplitStage) => STAGES.indexOf(from) <= STAGES.indexOf(stage);
    let arming: SecondArming = opts.arming ?? 'relog';
    const t = reaches('trade') ? await takeTrade(ctx, giver, first + 1, arming === 'make', opts.openTimeoutMs) : { received: 0, tradeTicks: 0, skipped: true };
    const received = t.skipped ? 0 : t.received;

    // First firing: the login timer.
    let loginTick = opts.loginTick;
    let missRelogs = 0;
    const bank1 = reaches('deposit-first') ? await depositForTimer(ctx, first, loginTick + FERMENT_TIMER_TICKS, win.firstBurst) : null;
    if (bank1 && !bank1.held) {
        loginTick = await requireRelog(opts)();
        missRelogs++;
    }
    let f1: Firing = { fired: false, tick: -1, level: cooking(sdk.getState()).level, xpGained: 0 };
    if (reaches('await-first')) {
        f1 = await firingWith(sdk, loginTick + FERMENT_TIMER_TICKS, 3, win.firstWait);
        if (!f1.fired && (bank1?.held ?? true) && opts.relog) {
            // Rare: the bank opened on the boundary tick and the timer fired just before
            // it, or every roll failed (0.81^29, 0.2%). A relog settles both: the new
            // login's timer rolls whatever is still unfermented.
            loginTick = await opts.relog();
            missRelogs++;
            f1 = await firingWith(sdk, loginTick + FERMENT_TIMER_TICKS, 3, win.firstWait);
        }
    }
    const rest = count(sdk.getState(), ITEM.wineNote);
    if (reaches('await-first')) ctx.log?.('wine first firing', { ...f1, loginTick, rest });

    const out: SplitResult = {
        received, first, rest, tradeTicks: t.tradeTicks, tradeSkipped: t.skipped,
        firstBankTicks: bank1?.bankTicks ?? 0, firstBankOpenTick: bank1?.bankOpenTick ?? -1, firstHeld: bank1?.held ?? true, missRelogs, loginTick,
        firstFermentTick: f1.tick, levelAfterFirst: f1.level, arming: 'none',
        secondBankTicks: 0, pagesTicks: 0, pagesAfterFirst: 0, resumesAfterFirst: 0, rearmMakeTick: -1, secondLoginTick: -1,
        secondFermentTick: -1, levelAfterSecond: f1.level, finalPagesTicks: 0, finalPages: 0
    };
    if (from === 'deposit-rest' || from === 'await-second') return secondFiring(ctx, opts, out, from, win);
    if (rest <= 0) return out;

    if (arming === 'make' && f1.level < WINE_COOKING_LEVEL) {
        if (!opts.relog) {
            // Two-login variant: bank the rest; it ferments at the next login.
            const d = await depositForTimer(ctx, 'all', Infinity);
            out.secondBankTicks = d.bankTicks;
            return out;
        }
        arming = 'relog';
    }
    out.arming = arming;

    let due: number;
    if (arming === 'make') {
        const t2 = sdk.getState()?.tick ?? 0;
        const open = await openBankThroughPages(sdk);
        if (!open.ok) throw new Error(`split delivery: second bank visit: ${open.reason}`);
        out.pagesTicks = open.openTick - t2;
        out.pagesAfterFirst = open.pages;
        out.resumesAfterFirst = open.resumes;
        const d = await depositNotes(sdk, 'all', { close: true, ...(win.restBurst ? { extra: win.restBurst } : {}) });
        if (!d.ok) throw new Error(`split delivery: deposit of the rest failed (${d.reason})`);
        out.secondBankTicks = d.doneTick - t2;
        const mk = await makeOneWine(sdk);
        if (!mk.ok) throw new Error(`split delivery: re-arming make failed (${mk.reason})`);
        out.rearmMakeTick = mk.tick;
        due = mk.tick + FERMENT_TIMER_TICKS;
    } else {
        // Bank the rest before the relog: the bank only opens once the level-up
        // pages are gone, and a logout would run them out anyway (one per tick), so
        // the new session starts with nothing to do but wait for login + 20.
        const doRelog = requireRelog(opts);
        const t2 = sdk.getState()?.tick ?? 0;
        const open = await openBankThroughPages(sdk);
        if (!open.ok) throw new Error(`split delivery: second bank visit: ${open.reason}`);
        out.pagesTicks = open.openTick - t2;
        out.pagesAfterFirst = open.pages;
        out.resumesAfterFirst = open.resumes;
        const d = await depositNotes(sdk, 'all', { close: true, ...(win.restBurst ? { extra: win.restBurst } : {}) });
        if (!d.ok) throw new Error(`split delivery: deposit of the rest failed (${d.reason})`);
        out.secondBankTicks = d.doneTick - t2;
        const login2 = await doRelog();
        out.secondLoginTick = login2;
        due = login2 + FERMENT_TIMER_TICKS;
    }
    return awaitSecond(ctx, opts, out, due, win);
}

/** The resume stages past the first firing: this login's timer is the second firing (no arming relog). */
async function secondFiring(ctx: ReceiverCtx, opts: SplitOptions, out: SplitResult, from: 'deposit-rest' | 'await-second', win: SplitWindows): Promise<SplitResult> {
    let due = out.loginTick + FERMENT_TIMER_TICKS;
    if (from === 'deposit-rest') {
        const d = await depositForTimer(ctx, 'all', due, win.restBurst);
        out.secondBankTicks = d.bankTicks;
        out.pagesAfterFirst = d.pages;
        if (!d.held) {
            const login = await requireRelog(opts)();
            out.missRelogs++;
            out.secondLoginTick = login;
            due = login + FERMENT_TIMER_TICKS;
        }
    }
    return awaitSecond(ctx, opts, out, due, win);
}

async function awaitSecond(ctx: ReceiverCtx, opts: SplitOptions, out: SplitResult, due: number, win: SplitWindows): Promise<SplitResult> {
    const { sdk } = ctx;
    const f2 = await firingWith(sdk, due, win.secondWait ? SECOND_WAIT_SLACK : 3, win.secondWait);
    out.secondFermentTick = f2.tick;
    out.levelAfterSecond = f2.level;
    ctx.log?.('wine second firing', { ...f2, due });
    if (f2.fired && opts.drainFinal !== false && !win.secondWait) {
        const dr = await drainChat(sdk);
        out.finalPagesTicks = dr.endTick - dr.startTick;
        out.finalPages = dr.pages;
    }
    return out;
}
