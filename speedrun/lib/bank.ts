// Batched bank deposit and withdraw.
//
// Stock `bot.depositItem` / `bot.withdrawItem` wait for each send's effect
// before the next. Here every send is fired without waiting, the client runs
// them FIFO, and the server meters them at 5 USER events per tick (excess
// stays buffered for the next tick; nothing is dropped). One wait on the
// expected end state confirms the whole batch.
//
// Server facts the planners rely on:
// - INV_BUTTON is validated against the live slot and item id, so a stale
//   target is refused, never misapplied.
// - Deposit-All (button 4) moves every unit of that item id, so a deposit
//   costs one event per distinct id, not per slot. Inventory slots do not
//   shift when items leave.
// - Bank slots DO compact when a stack is withdrawn completely, shifting every
//   later slot down by one. Withdraws are therefore ordered by descending slot.
// - Note mode is the sticky varp %bankcert, set by IF_BUTTON 5386 (note) or
//   5387 (item) with no delay; it costs one event.
// - Amounts other than 1 / 5 / 10 / All open the X count dialog, which holds
//   the client's action queue until it is answered, so X sends go last.

import type { BotSDK } from '../../sdk/index';
import type { ActionResult, BankState, InventoryItem } from '../../sdk/types';
import { amountButtons, countByName, INVENTORY_SIZE, isXAmount, matchesAny, matchesItem, type ItemPattern } from './items';
import { waitUntil, type StateSource } from './wait';

export const NOTE_MODE_ON = 5386; // bank_main:com_93
export const NOTE_MODE_OFF = 5387; // bank_main:com_94

export type BankSdk = StateSource & Pick<BotSDK, 'sendBankDeposit' | 'sendBankWithdraw' | 'sendClickComponent'>;

// ---------------------------------------------------------------- deposit

export interface DepositEntry {
    slot: number;
    id: number;
    name: string;
}

/** One Deposit-All per distinct item id, using the first slot that holds it. */
export function planDeposits(inventory: readonly InventoryItem[], patterns?: readonly ItemPattern[]): DepositEntry[] {
    const seen = new Set<number>();
    const out: DepositEntry[] = [];
    for (const item of [...inventory].sort((a, b) => a.slot - b.slot)) {
        if (seen.has(item.id)) continue;
        if (patterns && !matchesAny(item, patterns)) continue;
        seen.add(item.id);
        out.push({ slot: item.slot, id: item.id, name: item.name });
    }
    return out;
}

export interface DepositResult {
    ok: boolean;
    ticks: number;
    sent: number;
    /** Inventory items of a planned id still present when the wait ended. */
    remaining: InventoryItem[];
    reason?: 'bank_not_open' | 'timeout' | 'refused';
}

/** Deposit every inventory item. Requires the bank to be open. */
export function depositAll(sdk: BankSdk): Promise<DepositResult> {
    return deposit(sdk, undefined);
}

/** Deposit every inventory item matching any pattern (id, name substring, or RegExp). */
export function depositMatching(sdk: BankSdk, patterns: readonly ItemPattern[]): Promise<DepositResult> {
    return deposit(sdk, patterns);
}

async function deposit(sdk: BankSdk, patterns: readonly ItemPattern[] | undefined): Promise<DepositResult> {
    const s = sdk.getState();
    if (!s?.bank.isOpen) return { ok: false, ticks: 0, sent: 0, remaining: [], reason: 'bank_not_open' };
    const plan = planDeposits(s.inventory, patterns);
    if (plan.length === 0) return { ok: true, ticks: 0, sent: 0, remaining: [] };

    const ids = new Set(plan.map(p => p.id));
    const left = (inv: readonly InventoryItem[]) => inv.filter(i => ids.has(i.id));
    const done = waitUntil(sdk, st => left(st.inventory).length === 0, { maxTicks: Math.ceil(plan.length / 5) + 4 });
    const acks = await Promise.all(plan.map(p => sdk.sendBankDeposit(p.slot, -1)));
    const r = await done;
    const remaining = left(r.state?.inventory ?? []);
    const refused = acks.some(a => !a.success);
    return {
        ok: r.ok,
        ticks: Math.max(0, r.tick - s.tick),
        sent: plan.length,
        remaining,
        ...(r.ok ? {} : { reason: refused ? 'refused' : 'timeout' }),
    } as DepositResult;
}

// ---------------------------------------------------------------- withdraw

export interface WithdrawSpec {
    item: ItemPattern;
    /**
     * A number withdraws exactly that many (or the whole stack if it is
     * smaller). `'all'` takes the whole stack. `'fill'` is one Withdraw-All
     * meant to fill the free inventory slots with a non-stackable item: the
     * server stops when the inventory is full, so a partial fill is expected.
     * "28 of one item into an empty inventory" is `{item, n:'fill'}`.
     */
    n: number | 'all' | 'fill';
    asNote?: boolean;
}

export type BankSend =
    | { kind: 'note'; noteMode: boolean; component: number }
    | { kind: 'withdraw'; spec: number; slot: number; id: number; name: string; amount: number };

export interface WithdrawPlan {
    sends: BankSend[];
    /** Specs with no matching bank item. */
    missing: WithdrawSpec[];
    /** Expected inventory gain per item name (upper bound for 'fill'/'all' when slots run out). */
    expected: Map<string, number>;
    /** Note mode after the plan runs. */
    finalNoteMode: boolean;
}

interface Entry {
    spec: number;
    slot: number;
    id: number;
    name: string;
    buttons: number[];
    asNote: boolean;
    /** Contains an All, so the stack may leave the bank and later slots shift. */
    mayEmpty: boolean;
}

/**
 * Turn withdraw specs into an ordered send list.
 *
 * Order rules: X amounts go last (they hold the client queue). Withdraws are
 * grouped by note mode, current mode first, so at most one toggle is needed,
 * and are sorted by descending bank slot within each group. Grouping is only
 * used when it is slot-safe, i.e. no send in an earlier group may empty a
 * stack below a later send's slot; otherwise the plan falls back to one global
 * descending order with a toggle at every mode change.
 */
export function planWithdraws(bank: BankState, specs: readonly WithdrawSpec[], opts: { restoreNoteMode?: boolean } = {}): WithdrawPlan {
    const missing: WithdrawSpec[] = [];
    const expected = new Map<string, number>();
    const entries: Entry[] = [];
    specs.forEach((spec, i) => {
        const item = bank.items.find(b => matchesItem(b, spec.item));
        if (!item) {
            missing.push(spec);
            return;
        }
        const asNote = spec.asNote ?? false;
        const n = spec.n === 'all' || spec.n === 'fill' ? item.count : spec.n;
        const buttons = amountButtons(n, item.count);
        entries.push({ spec: i, slot: item.slot, id: item.id, name: item.name, buttons, asNote, mayEmpty: buttons.includes(-1) });
        expected.set(item.name, (expected.get(item.name) ?? 0) + Math.min(n, item.count));
    });

    const plain = entries.filter(e => !e.buttons.some(isXAmount));
    const xs = entries.filter(e => e.buttons.some(isXAmount));

    const ordered = orderEntries(plain, bank.noteMode);
    // X sends after everything else, still descending and slot-safe among themselves.
    const startMode = ordered.length ? ordered[ordered.length - 1]!.asNote : bank.noteMode;
    const orderedX = orderEntries(xs, startMode);
    const all = [...ordered, ...orderedX];

    const sends: BankSend[] = [];
    let mode = bank.noteMode;
    for (const e of all) {
        if (e.asNote !== mode) {
            mode = e.asNote;
            sends.push(noteSend(mode));
        }
        for (const amount of e.buttons) {
            sends.push({ kind: 'withdraw', spec: e.spec, slot: e.slot, id: e.id, name: e.name, amount });
        }
    }
    if (opts.restoreNoteMode && mode !== bank.noteMode) {
        mode = bank.noteMode;
        sends.push(noteSend(mode));
    }
    return { sends, missing, expected, finalNoteMode: mode };
}

function noteSend(noteMode: boolean): BankSend {
    return { kind: 'note', noteMode, component: noteMode ? NOTE_MODE_ON : NOTE_MODE_OFF };
}

const bySlotDesc = (a: Entry, b: Entry) => b.slot - a.slot;

/** True when no entry may empty a stack below a slot that a later entry targets. */
export function slotSafe(order: ReadonlyArray<{ slot: number; mayEmpty: boolean }>): boolean {
    let lowestEmpty = Infinity;
    for (const e of order) {
        if (e.slot > lowestEmpty) return false;
        if (e.mayEmpty) lowestEmpty = Math.min(lowestEmpty, e.slot);
    }
    return true;
}

function toggles(order: readonly Entry[], startMode: boolean): number {
    let n = 0;
    let mode = startMode;
    for (const e of order) {
        if (e.asNote !== mode) {
            n++;
            mode = e.asNote;
        }
    }
    return n;
}

function orderEntries(entries: readonly Entry[], startMode: boolean): Entry[] {
    const same = entries.filter(e => e.asNote === startMode).sort(bySlotDesc);
    const other = entries.filter(e => e.asNote !== startMode).sort(bySlotDesc);
    const candidates = [[...same, ...other], [...other, ...same], [...entries].sort(bySlotDesc)].filter(slotSafe);
    // The global descending order is always slot-safe, so candidates is never empty.
    candidates.sort((a, b) => toggles(a, startMode) - toggles(b, startMode));
    return candidates[0]!;
}

export interface WithdrawResult {
    ok: boolean;
    ticks: number;
    sent: number;
    /** Inventory gain per item name when the wait ended. */
    gained: Map<string, number>;
    missing: WithdrawSpec[];
    /** True when the inventory filled before every expected item arrived. */
    partial: boolean;
    reason?: 'bank_not_open' | 'missing' | 'timeout';
}

/**
 * Fire the whole withdraw plan, then wait once until every expected count has
 * arrived or the inventory is full. Note mode is left as the plan ends unless
 * `restoreNoteMode` is set (it costs an event).
 */
export async function withdrawMany(sdk: BankSdk, specs: readonly WithdrawSpec[], opts: { restoreNoteMode?: boolean } = {}): Promise<WithdrawResult> {
    const s = sdk.getState();
    if (!s?.bank.isOpen) {
        return { ok: false, ticks: 0, sent: 0, gained: new Map(), missing: [], partial: false, reason: 'bank_not_open' };
    }
    const plan = planWithdraws(s.bank, specs, opts);
    const before = countByName(s.inventory);
    const gainedIn = (inv: readonly InventoryItem[]) => {
        const now = countByName(inv);
        const g = new Map<string, number>();
        for (const name of plan.expected.keys()) g.set(name, (now.get(name) ?? 0) - (before.get(name) ?? 0));
        return g;
    };
    const satisfied = (inv: readonly InventoryItem[]) => {
        const g = gainedIn(inv);
        return [...plan.expected].every(([name, want]) => (g.get(name) ?? 0) >= want);
    };
    const full = (inv: readonly InventoryItem[]) => inv.length >= INVENTORY_SIZE;
    const withdraws = plan.sends.filter(x => x.kind === 'withdraw').length;
    const lastIsNote = plan.sends.length > 0 && plan.sends[plan.sends.length - 1]!.kind === 'note';
    const done = waitUntil(
        sdk,
        st => (satisfied(st.inventory) || full(st.inventory)) && (!lastIsNote || st.bank.noteMode === plan.finalNoteMode),
        { maxTicks: Math.ceil(plan.sends.length / 5) + 4 }
    );
    await Promise.all(plan.sends.map(x => fire(sdk, x)));
    const r = await done;
    const inv = r.state?.inventory ?? [];
    const partial = r.ok && !satisfied(inv);
    const reason = !r.ok ? 'timeout' : plan.missing.length ? 'missing' : undefined;
    return {
        ok: r.ok && plan.missing.length === 0,
        ticks: Math.max(0, r.tick - s.tick),
        sent: withdraws,
        gained: gainedIn(inv),
        missing: plan.missing,
        partial,
        ...(reason ? { reason } : {}),
    };
}

function fire(sdk: BankSdk, x: BankSend): Promise<ActionResult> {
    return x.kind === 'note' ? sdk.sendClickComponent(x.component) : sdk.sendBankWithdraw(x.slot, x.amount);
}
