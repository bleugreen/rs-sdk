/**
 * The phase-2 runner's two Exchange decisions, pure: a sale into the open bids, and the shark purchase. The
 * errands that act on them are in `errands.ts`.
 *
 * Sales (off by default, plan `sell`): read the book first, never sell below the item's floor, never more than
 * the per-call cap. The offer's limit price is the floor itself: the engine fills a sell against the resting bids
 * best price first, each at its own price (MarketStore.ts `executionPrice = resting.price`), so the floor is
 * the least any unit fetches and the remainder below it is cancelled unfilled.
 *
 * Sharks (plan `sharks.source: 'buy'`): a fleet input on docs/speedrun/SUPPLIES.md, so nothing is bought until
 * main has announced the scored run's end (`--run-ended`). The planned quantity is bounded on the ask side
 * (`buyCost`) and logged against the ceiling; logins a thin book cannot feed go to the low-food fallback at once.
 * Each account's buy is a limit offer at the ceiling, so no shark ever costs more, and an account whose fill
 * comes short of the plan's minimum goes to the fallback then.
 */
import { asksAtOrBelow, bidsAtOrAbove, buyCost, type MarketQuote } from '../lib/market.ts';
import { netOfFee } from './ledger.ts';
import { HARD_SALE_CAP } from './plan.ts';

export const SHARK_ID = 385;

export type SaleDecision =
    | {
          sell: true;
          quantity: number;
          /** The offer's limit price: the floor. */
          price: number;
          /** Units the bids provably hold at or above the floor; the rest of `quantity` may go unfilled. */
          sure: number;
          /** Coins after the fee: every unit at the floor, and every unit at the best bid. */
          expected: { low: number; high: number };
      }
    | { sell: false; reason: string };

export function saleDecision(q: MarketQuote | null, i: { held: number; floor: number; cap: number }): SaleDecision {
    if (!(i.floor > 0)) return { sell: false, reason: 'no floor for this item' };
    if (!q || q.bid === null || q.buyQuantity <= 0) return { sell: false, reason: 'no open bid' };
    if (q.bid < i.floor) return { sell: false, reason: `best bid ${q.bid} is below the floor of ${i.floor}` };
    const cap = Math.min(i.cap, HARD_SALE_CAP);
    const quantity = Math.max(0, Math.min(i.held, cap, q.buyQuantity));
    if (quantity === 0) return { sell: false, reason: i.held <= 0 ? 'nothing to sell' : 'the cap is 0' };
    return {
        sell: true,
        quantity,
        price: i.floor,
        sure: Math.min(quantity, bidsAtOrAbove(q, i.floor)),
        expected: { low: netOfFee(quantity * i.floor), high: netOfFee(quantity * q.bid) }
    };
}

export interface SupplyInput {
    /** Logins that eat sharks. */
    logins: number;
    perLoginHour: number;
    hours: number;
    ceiling: number;
    /** Main has announced the scored run's end. */
    runEnded: boolean;
}

export interface SharkSupply {
    allowed: boolean;
    reason: string;
    /** Sharks the plan eats over `hours`. */
    wanted: number;
    /** buyCost of `wanted` on the open asks. */
    cost: { units: number; low: number; high: number; short: number } | null;
    perUnitHigh: number | null;
    withinCeiling: boolean;
    /** Units provably on offer at or below the ceiling. */
    atCeiling: number;
    feedLogins: number;
    fallbackLogins: number;
}

/** The whole-plan check before any shark purchase. */
export function sharkSupply(q: MarketQuote | null, i: SupplyInput): SharkSupply {
    const perLogin = i.perLoginHour * i.hours;
    const wanted = Math.ceil(i.logins * perLogin);
    const none = (reason: string): SharkSupply => ({ allowed: false, reason, wanted, cost: null, perUnitHigh: null, withinCeiling: false, atCeiling: 0, feedLogins: 0, fallbackLogins: i.logins });
    if (!i.runEnded) return none("refused: sharks are a fleet input (SUPPLIES.md); nothing is bought until main announces the scored run's end (--run-ended)");
    if (i.logins <= 0 || wanted <= 0) return { ...none('no shark-eating logins'), allowed: true, fallbackLogins: 0 };
    if (!q || q.ask === null || q.sellQuantity <= 0) return none('no sharks are offered on the Exchange');
    const cost = buyCost(q, wanted);
    const perUnitHigh = cost.units ? cost.high / cost.units : null;
    const withinCeiling = perUnitHigh !== null && perUnitHigh <= i.ceiling;
    const atCeiling = asksAtOrBelow(q, i.ceiling);
    // A book too thin for the plan feeds the logins its depth covers. Above the ceiling the totals prove almost
    // nothing under it (at most ~1/(ceiling + 1 - ask) of the side once the mean is past it), so the logins are
    // not cut here: each buys with a limit at the ceiling, and one whose fill comes short of the minimum falls back.
    const feedLogins = Math.min(i.logins, perLogin > 0 ? Math.floor(cost.units / perLogin) : i.logins);
    const bound = `${wanted} sharks cost ${Math.round(cost.low)}-${Math.round(cost.high)} (at most ${perUnitHigh!.toFixed(1)} each)`;
    const thin = cost.short > 0 ? `; the asks hold ${cost.units} of them: ${feedLogins} of ${i.logins} logins fed` : '';
    const reason = withinCeiling
        ? `${bound}, within the ${i.ceiling} ceiling${thin}`
        : `${bound}, above the ${i.ceiling} ceiling: every buy is a limit at ${i.ceiling}, ${atCeiling} provably offered at or below it; a login whose buy fills short of the minimum falls back${thin}`;
    return { allowed: true, reason, wanted, cost, perUnitHigh, withinCeiling, atCeiling, feedLogins, fallbackLogins: i.logins - feedLogins };
}

export type BuyDecision = { buy: true; quantity: number; price: number; escrow: number } | { buy: false; reason: string };

/** One account's buy: a limit offer at the ceiling for what it wants and its coins cover. */
export function buyDecision(q: MarketQuote | null, i: { want: number; coins: number; ceiling: number; runEnded: boolean }): BuyDecision {
    if (!i.runEnded) return { buy: false, reason: "main has not announced the scored run's end" };
    if (!q || q.ask === null || q.sellQuantity <= 0) return { buy: false, reason: 'no asks' };
    if (q.ask > i.ceiling) return { buy: false, reason: `best ask ${q.ask} is above the ceiling of ${i.ceiling}` };
    const quantity = Math.max(0, Math.min(i.want, Math.floor(i.coins / i.ceiling), q.sellQuantity));
    if (quantity === 0) return { buy: false, reason: i.want <= 0 ? 'nothing wanted' : `${i.coins} coins do not cover one shark at the ceiling of ${i.ceiling}` };
    return { buy: true, quantity, price: i.ceiling, escrow: quantity * i.ceiling };
}
