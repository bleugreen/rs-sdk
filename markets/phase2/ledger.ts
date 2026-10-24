/**
 * The phase-2 ledger: one JSON line per account every `ledger.everyTicks` game ticks, and a totals line across
 * accounts on the same cadence and at the end. Pure: the runner passes holdings, item costs and the book in.
 *
 * Values (docs/markets/methods.md 'Units'):
 * - coins: carried and banked. The bank is only visible while it is open, so `banked` is its count at the last
 *   visit (`bank.seenTick`), null before the first.
 * - store: the bank at ObjType.cost, what the wealth board counts (coins at 1).
 * - book: the bank at what it would realise sold into the open bids now (`realisable`, low and high), less the
 *   5% seller fee; coins at face value, items with no bid in `unpriced`. The totals merge every account's stacks
 *   before pricing them, so two accounts holding the same item do not both count the same bid.
 */
import { realisable, type MarketQuote } from '../lib/market.ts';
import { perHour } from '../methods/value.ts';
import type { MethodId } from './plan.ts';

export const COINS_ID = 995;

export interface Stack {
    id: number;
    name: string;
    count: number;
}

export interface Valuer {
    /** ObjType.cost of one unit; undefined when unknown. */
    cost(s: Stack): number | undefined;
    /** The latest book read for the item, if any. */
    quote(id: number): MarketQuote | undefined;
}

/** What a seller receives for `gross`: the engine burns floor(gross / 20) per sell offer (MarketStore.ts). */
export const netOfFee = (gross: number): number => gross - Math.floor(gross / 20);

const isCoins = (s: Stack) => s.id === COINS_ID || /^coins$/i.test(s.name);
export const coinsOf = (items: readonly Stack[] | null): number => (items ?? []).filter(isCoins).reduce((a, s) => a + s.count, 0);

export function storeValue(items: readonly Stack[], cost: Valuer['cost']): { value: number; unknown: string[] } {
    let value = 0;
    const unknown: string[] = [];
    for (const s of items) {
        if (isCoins(s)) value += s.count;
        else {
            const c = cost(s);
            if (c === undefined) unknown.push(s.name);
            else value += c * s.count;
        }
    }
    return { value, unknown: [...new Set(unknown)] };
}

export function bookValue(items: readonly Stack[], quote: Valuer['quote']): { low: number; high: number; unpriced: string[] } {
    let low = 0;
    let high = 0;
    const unpriced: string[] = [];
    for (const s of merge(items)) {
        if (isCoins(s)) {
            low += s.count;
            high += s.count;
            continue;
        }
        const q = quote(s.id);
        if (!q || q.buyQuantity <= 0) {
            unpriced.push(s.name);
            continue;
        }
        const r = realisable(q, s.count);
        if (r.unsold > 0) unpriced.push(`${s.name} (${r.unsold} past the bids)`);
        low += netOfFee(Math.floor(r.low));
        high += netOfFee(Math.floor(r.high));
    }
    return { low, high, unpriced };
}

/** Stacks of the same item summed. */
export function merge(items: readonly Stack[]): Stack[] {
    const by = new Map<number, Stack>();
    for (const s of items) {
        const e = by.get(s.id);
        if (e) e.count += s.count;
        else by.set(s.id, { ...s });
    }
    return [...by.values()];
}

export interface AccountSnapshot {
    account: string;
    method: MethodId;
    stage: string;
    /** Bumps on every login, so ticks compare only within one session. */
    session: number;
    tick: number;
    carried: Stack[];
    bank: Stack[] | null;
    bankTick: number | null;
    /** Wall ms per tick observed this session, if measured. */
    msPerTick?: number | null;
    /** Deaths over every session of the run (deaths.ts). */
    deaths: number;
    /** The account's tile. */
    pos?: [x: number, z: number] | null;
    /** The npc the method works now (pickpocket.ts's target) and its tile, when it is in view. */
    target?: NpcAt | null;
    /** Ticks of this session spent at the npcs (pickpocket.ts's thieve errand). */
    workTicks?: number | null;
}

export interface NpcAt {
    index: number;
    x: number;
    z: number;
}

export interface AccountLine {
    kind: 'account';
    t: string;
    account: string;
    method: MethodId;
    stage: string;
    session: number;
    tick: number;
    coins: { carried: number; banked: number | null; total: number };
    bank: { seenTick: number | null; store: number | null; book: { low: number; high: number } | null; unpriced: string[]; unknownCost: string[] };
    carriedStore: number;
    msPerTick: number | null;
    deaths: number;
    pos: [x: number, z: number] | null;
    target: NpcAt | null;
    workTicks: number | null;
}

export function accountLine(s: AccountSnapshot, v: Valuer, now: Date): AccountLine {
    const carried = coinsOf(s.carried);
    const banked = s.bank ? coinsOf(s.bank) : null;
    const store = s.bank ? storeValue(s.bank, v.cost) : null;
    const book = s.bank ? bookValue(s.bank, v.quote) : null;
    return {
        kind: 'account',
        t: now.toISOString(),
        account: s.account,
        method: s.method,
        stage: s.stage,
        session: s.session,
        tick: s.tick,
        coins: { carried, banked, total: carried + (banked ?? 0) },
        bank: { seenTick: s.bankTick, store: store?.value ?? null, book: book ? { low: book.low, high: book.high } : null, unpriced: book?.unpriced ?? [], unknownCost: store?.unknown ?? [] },
        carriedStore: storeValue(s.carried, v.cost).value,
        msPerTick: s.msPerTick ?? null,
        deaths: s.deaths,
        pos: s.pos ?? null,
        target: s.target ?? null,
        workTicks: s.workTicks ?? null
    };
}

export interface MethodTotals {
    accounts: number;
    coins: number;
    bankStore: number;
}

export interface TotalsLine {
    kind: 'totals';
    t: string;
    final: boolean;
    accounts: number;
    sessions: { pending: number; inWorld: number };
    /** Accounts by what they are doing: a stage name, or `method:<id>`. */
    stages: Record<string, number>;
    byMethod: Partial<Record<MethodId, MethodTotals>>;
    coins: number;
    bankStore: number;
    bankBook: { low: number; high: number; unpriced: string[] };
    /** Accounts whose bank has not been seen yet: their banked value is missing from the totals. */
    bankUnseen: number;
    /** Deaths across the accounts over the run. */
    deaths: number;
}

/** Totals over each account's latest snapshot (one per account). */
export function totalsLine(latest: readonly AccountSnapshot[], v: Valuer, sessions: TotalsLine['sessions'], now: Date, final = false): TotalsLine {
    const byMethod: TotalsLine['byMethod'] = {};
    const stages: Record<string, number> = {};
    let coins = 0;
    let bankStore = 0;
    let bankUnseen = 0;
    let deaths = 0;
    const banks: Stack[] = [];
    for (const s of latest) {
        deaths += s.deaths;
        const c = coinsOf(s.carried) + coinsOf(s.bank);
        const store = s.bank ? storeValue(s.bank, v.cost).value : 0;
        if (!s.bank) bankUnseen++;
        else banks.push(...s.bank);
        coins += c;
        bankStore += store;
        const m = (byMethod[s.method] ??= { accounts: 0, coins: 0, bankStore: 0 });
        m.accounts++;
        m.coins += c;
        m.bankStore += store;
        const st = s.stage === 'method' ? `method:${s.method}` : s.stage;
        stages[st] = (stages[st] ?? 0) + 1;
    }
    return { kind: 'totals', t: now.toISOString(), final, accounts: latest.length, sessions, stages, byMethod, coins, bankStore, bankBook: bookValue(banks, v.quote), bankUnseen, deaths };
}

// ------------------------------------------------------------------ rates from a ledger

export interface MethodRate {
    account: string;
    method: MethodId;
    ticks: number;
    coins: number;
    bankStore: number | null;
    coinsPerHour: number;
    boardPerHour: number | null;
}

/**
 * Each account's rate on its method: from its first to its last ledger line in stage 'method' within one session
 * (the longest such stretch), coins (carried plus banked) and bank store value gained, per hour at `tickMs`.
 * Banked coins count only once the bank has been seen, so a stretch is measured from its first line with the bank
 * seen when it has one: from an earlier line, savings banked before the method would count as earnings.
 */
export function methodRates(lines: readonly AccountLine[], tickMs: number): MethodRate[] {
    const by = new Map<string, AccountLine[]>();
    for (const l of lines) {
        if (l.kind !== 'account' || l.stage !== 'method') continue;
        const k = `${l.account}\u0000${l.session}\u0000${l.method}`;
        const list = by.get(k) ?? [];
        list.push(l);
        by.set(k, list);
    }
    const best = new Map<string, MethodRate>();
    for (const list of by.values()) {
        const a = list.find(l => l.bank.store !== null) ?? list[0]!;
        const b = list.at(-1)!;
        const ticks = b.tick - a.tick;
        if (ticks <= 0) continue;
        const coins = b.coins.total - a.coins.total;
        const bankStore = a.bank.store !== null && b.bank.store !== null ? b.bank.store - a.bank.store : null;
        const r: MethodRate = {
            account: a.account,
            method: a.method,
            ticks,
            coins,
            bankStore,
            coinsPerHour: perHour(coins, ticks, tickMs),
            boardPerHour: bankStore === null ? null : perHour(bankStore, ticks, tickMs)
        };
        const prev = best.get(a.account);
        if (!prev || prev.ticks < ticks) best.set(a.account, r);
    }
    return [...best.values()];
}
