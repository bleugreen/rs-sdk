/**
 * The shark purchase's recorded outcome and the decisions made on it (docs/markets/phase2.md 'Shark resupply'). Pure:
 * the errand that buys is errands.ts `buySharks`, the runner that acts on these is run.ts.
 *
 * RoleState holds one SharkState per account under SHARKS_KEY. The buy-sharks stage is done only when its status is
 * 'done', so a purchase can be made more than once:
 *
 * - 'done': the last purchase settled (filled, partial, unfilled, refused for the book or the coins, or its
 *   transient retries ran out). Whether the account eats on is the runner's minimum check against what it banked.
 * - 'retry': the last attempt was refused for a transient reason (a bank or Exchange timeout, a closed interface);
 *   the stage runs the errand again, after a backoff, at most SHARK_RETRY.tries attempts in a row.
 * - 'due': a food-redirected account has earned enough for a rebuy (`rebuyDecision`); the stage runs again.
 *
 * A value written by the runner before this module (the errand's bare record) still loads: `loadSharks` classifies it
 * as the runner would have had it known, so a transient refusal recorded as done becomes a retry.
 */
import { NEEDS, type MethodId } from './plan.ts';

/** RoleState key the shark purchase records its outcome under. */
export const SHARKS_KEY = 'phase2.sharks';

export type SharkStatus = 'done' | 'retry' | 'due';

export interface SharkState {
    status: SharkStatus;
    /** Transient refusals in a row since the purchase last settled. */
    tries: number;
    /** The last attempt: the errand's record (errands.ts buySharks), or `{ result: 'error', reason }` when it threw. */
    last: Record<string, unknown> | null;
    /** When the status was last set (ISO). */
    at: string;
    /** Why the status is 'due' or why a retry bound settled it. */
    note?: string;
    /** Set when a settled purchase left fewer than the plan's minimum banked: why (`shortfall`). */
    short?: string;
}

/** A purchase attempt as the runner saw it: the errand's record, or the message it threw. */
export type SharkAttempt = { record: Record<string, unknown> } | { error: string };

/** Attempts in a row before a transient refusal settles the purchase, and the backoff between them. */
export const SHARK_RETRY = { tries: 4, baseMs: 15_000, maxMs: 120_000 };

/** Wall ms to wait before attempt `tries + 1`, after `tries` transient refusals in a row. */
export function retryDelayMs(tries: number, policy: Pick<typeof SHARK_RETRY, 'baseMs' | 'maxMs'> = SHARK_RETRY): number {
    return Math.min(policy.maxMs, policy.baseMs * 2 ** Math.max(0, tries - 1));
}

/**
 * SDK failures that say nothing about the book or the account's coins, so the same errand can succeed a moment later:
 * a bank, deposit, withdraw or exchange observation that timed out (actions.ts 'Timeout waiting for ...'), an
 * Exchange interface that closed or was not open (ge-actions.ts no_interface, session_changed before dispatch,
 * stale_state, busy), a bank that would not open or was walked away from, and a stale or missing game state.
 */
const TRANSIENT = [
    /Timeout waiting for /i,
    /^openBank: /i,
    /^openGE: /i,
    /Bank is not open/i,
    /^walk to the Varrock west bank: /i,
    /^(no_interface|stale_state|busy|timeout): /,
    /Open the Grand Exchange at its table or teller first/i,
    /did not open a structured exchange/i,
    /No fresh game connection/i,
    /^no game state$/i
];

export const isTransientMessage = (m: unknown): boolean => typeof m === 'string' && TRANSIENT.some(re => re.test(m));

/**
 * Whether an attempt failed for a transient reason. A placement whose outcome is unknown is never transient: a second
 * offer could double the trade (errands.ts). A refusal for coins counts as transient only when the coin withdrawal
 * itself failed (the demo's 'Timeout waiting for Coins to be withdrawn' left the pack empty); with the withdrawal fine
 * the coins really are short. A refusal for the book (no asks, the best ask above the ceiling) is never transient.
 */
export function isTransient(a: SharkAttempt): boolean {
    if ('error' in a) return isTransientMessage(a.error);
    const r = a.record;
    if (r.result === 'unknown') return false;
    if (r.result === 'refused') return /coins do not cover/i.test(String(r.reason ?? '')) && isTransientMessage(r.withdraw);
    if (r.result === 'not placed') return isTransientMessage(r.reason);
    // bought, but some still on the Exchange: the next attempt collects them first (errands.ts collectLeftovers)
    if (r.result === 'uncollected') return true;
    return false;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const STATUSES: readonly SharkStatus[] = ['done', 'retry', 'due'];

/**
 * The account's SharkState from RoleState; null when it never attempted a purchase. A bare errand record (the runner's
 * format before SharkState) is migrated here: retry when it was a transient refusal, else done.
 */
export function loadSharks(raw: unknown): SharkState | null {
    if (raw === undefined || raw === null) return null;
    if (isObj(raw) && STATUSES.includes(raw.status as SharkStatus)) {
        return {
            status: raw.status as SharkStatus,
            tries: typeof raw.tries === 'number' && raw.tries >= 0 ? raw.tries : 0,
            last: isObj(raw.last) ? raw.last : null,
            at: typeof raw.at === 'string' ? raw.at : new Date(0).toISOString(),
            ...(typeof raw.note === 'string' ? { note: raw.note } : {}),
            ...(typeof raw.short === 'string' ? { short: raw.short } : {})
        };
    }
    const last = isObj(raw) ? raw : { value: raw };
    const transient = isTransient({ record: last });
    return { status: transient ? 'retry' : 'done', tries: transient ? 1 : 0, last, at: typeof last.at === 'string' ? last.at : new Date(0).toISOString(), note: 'loaded from a record written before SharkState' };
}

/** Whether the buy-sharks stage's goal holds. */
export const sharksSettled = (raw: unknown): boolean => loadSharks(raw)?.status === 'done';

/** The state after an attempt: a transient refusal retries until `maxTries` in a row, then settles. */
export function afterAttempt(prev: SharkState | null, a: SharkAttempt, now: Date, maxTries = SHARK_RETRY.tries): SharkState {
    const last = 'error' in a ? { kind: 'buy', result: 'error', reason: a.error } : a.record;
    const at = now.toISOString();
    if (!isTransient(a)) return { status: 'done', tries: 0, last, at };
    const tries = (prev?.status === 'retry' ? prev.tries : 0) + 1;
    if (tries < maxTries) return { status: 'retry', tries, last, at };
    return { status: 'done', tries, last, at, note: `${tries} transient refusals in a row: settled; a rebuy can follow from the food fallback` };
}

/**
 * Why a settled purchase left fewer than `minimum` sharks banked, or null when it did not. 'insufficient coins': the
 * coins covered none, or fewer than wanted (a fresh account reaches buy-sharks with a few hundred). It is not a
 * reason to hold a rebuy: the rebuy waits only for the coins.
 */
export function shortfall(record: Record<string, unknown> | null, minimum: number): string | null {
    if (!record || typeof record.banked !== 'number' || record.banked >= minimum) return null;
    if (/coins do not cover/i.test(String(record.reason ?? ''))) return 'insufficient coins';
    if (typeof record.quantity === 'number' && typeof record.want === 'number' && record.quantity < record.want && record.result !== 'unfilled') return 'insufficient coins';
    if (bookRefused(record)) return 'the book';
    return 'short';
}

/**
 * Why a shark eater must not sail to its method, or null when it may: fewer than `minimum` sharks between its bank and
 * its pack. The bank is the one last seen this run; before the first bank visit after a restart, the purchase's
 * recorded `banked`. With neither known it may sail (its first bank visit there finds out).
 */
export function shortForVoyage(i: { bankSharks: number | null; carriedSharks: number; sharks: SharkState | null; minimum: number }): string | null {
    const recorded = i.sharks?.last?.banked;
    const bank = i.bankSharks ?? (typeof recorded === 'number' ? recorded : null);
    if (bank === null) return null;
    const have = bank + i.carriedSharks;
    if (have >= i.minimum) return null;
    const why = i.sharks?.short ?? shortfall(i.sharks?.last ?? null, i.minimum);
    return `${have} sharks ${i.bankSharks === null ? 'recorded after the last purchase' : 'banked and carried'}, below the minimum of ${i.minimum}${why ? ` (${why})` : ''}: not sailing`;
}

/** Where an account's sharks are after a purchase errand. */
export interface SharksAfter {
    bank: number;
    /** Carried, items and notes. */
    pack: number;
    /** Still on the Exchange: the offer's collectible items. */
    uncollected: number;
}

/**
 * Sharks the account can eat: bank and pack. What is still on the Exchange is not among them (a knight in Ardougne
 * cannot collect it); the errand reports it as 'uncollected', a transient result, so it is collected on a retry.
 */
export const heldAfter = (a: SharksAfter): number => a.bank + a.pack;

/**
 * Whether the errand reads the bank again before trusting its count: everything it can account for is below what it
 * held before plus what it bought (a bank list read before it refreshed), or the pack still holds sharks (a deposit
 * that timed out).
 */
export const needsReread = (a: SharksAfter, expected: number): boolean => a.bank + a.pack + a.uncollected < expected || a.pack > 0;

/** The state that sends the account through buy-sharks again (a rebuy). */
export function requestRebuy(prev: SharkState | null, now: Date, note: string): SharkState {
    return { status: 'due', tries: 0, last: prev?.last ?? null, at: now.toISOString(), note };
}

/** How long after a purchase the book refused (or whose placement is unknown) a rebuy waits. */
export const REBUY_HOLD_MS = 30 * 60_000;

export interface RebuyInput {
    /** The method the food fallback took the account from; null when it is not on the food fallback. */
    foodFrom: MethodId | null;
    /** The method it works now. */
    method: MethodId;
    source: 'bank' | 'buy';
    runEnded: boolean;
    /** Coins banked (at the last bank visit) plus carried: what the purchase pays from. */
    coins: number;
    ceiling: number;
    /** Sharks the coins must cover at the ceiling. */
    minSharks: number;
    sharks: SharkState | null;
    nowMs: number;
    holdMs?: number;
}

export type RebuyDecision = { rebuy: true; reason: string } | { rebuy: false; reason: string };

const bookRefused = (last: Record<string, unknown> | null): boolean =>
    !!last && (last.result === 'unknown' || last.result === 'unfilled' || (last.result === 'refused' && /no asks|above the ceiling/i.test(String(last.reason ?? ''))));

/**
 * Whether a food-redirected shark eater goes back to buy sharks and its method. Only an account the food fallback
 * moved qualifies (a ramp redirect is not about food), only with a buying plan, and only once its coins cover
 * `minSharks` at the ceiling. After a purchase the book refused, the rebuy waits `holdMs` rather than walking into
 * the same refusal at every bank visit.
 */
export function rebuyDecision(i: RebuyInput): RebuyDecision {
    const no = (reason: string): RebuyDecision => ({ rebuy: false, reason });
    if (i.foodFrom === null) return no('not on the food fallback');
    if (!NEEDS[i.foodFrom].sharks) return no(`${i.foodFrom} eats no sharks`);
    if (i.method === i.foodFrom) return no(`already on ${i.method}`);
    if (i.source !== 'buy') return no('the plan does not buy sharks');
    if (!i.runEnded) return no("main has not announced the scored run's end");
    const need = i.minSharks * i.ceiling;
    if (i.coins < need) return no(`${i.coins} coins, ${need} needed for ${i.minSharks} sharks at the ${i.ceiling} ceiling`);
    const s = i.sharks;
    const hold = i.holdMs ?? REBUY_HOLD_MS;
    if (s && s.status === 'done' && bookRefused(s.last) && i.nowMs - Date.parse(s.at) < hold) {
        return no(`the last purchase (${String(s.last?.result)}: ${String(s.last?.reason ?? '')}) was under ${Math.round(hold / 60_000)} minutes ago`);
    }
    return { rebuy: true, reason: `${i.coins} coins cover ${Math.floor(i.coins / i.ceiling)} sharks at the ${i.ceiling} ceiling (at least ${i.minSharks})` };
}
