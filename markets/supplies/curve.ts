// The NPC shop price curve and restock rate (shop.rs2 `calc_shop_value`, World.ts restock pass).
//
// The price of one unit when the shelf holds `stock` units against a configured `base`:
//   cost * max(100, sell - clamp((stock - base) * delta, -5000, 1000)) / 1000, at least 1 gp
// so each unit below base adds delta/10 % of cost, to a ceiling of (sell + 5000)/1000 x cost.
// `shop.rs2` `buy_item` prices every unit of a purchase separately at the stock it leaves.

/** Game ticks per hour at the demo's tick (400 ms). */
export const TICKS_PER_HOUR = 9_000;

export interface Pricing {
    /** obj `cost=`. */
    cost: number;
    /** `shop_sell_multiplier`. */
    sell: number;
    /** `shop_delta`. */
    delta: number;
    /** The stock line's configured count. */
    base: number;
}

/** What the next unit costs with `stock` on the shelf. */
export function unitPrice(p: Pricing, stock: number): number {
    const markup = Math.min(1000, Math.max(-5000, (stock - p.base) * p.delta));
    const scaled = Math.max(100, p.sell - markup);
    return Math.max(1, Math.floor((scaled * p.cost) / 1000));
}

/**
 * Coins for `n` units bought one after another from a shelf holding `stock` (default: full, at base),
 * or null when the shelf runs out first.
 */
export function buyCost(p: Pricing, n: number, stock = p.base): number | null {
    if (n > stock) return null;
    let total = 0;
    for (let k = 0; k < n; k++) total += unitPrice(p, stock - k);
    return total;
}

/** The highest price the curve reaches: (sell + 5000)/1000 x cost. */
export function ceilingPrice(p: Pricing): number {
    return unitPrice(p, p.base - 1_000_000);
}

/** How many units from a full shelf before the price reaches its ceiling (null if the shelf empties first). */
export function unitsToCeiling(p: Pricing): number | null {
    if (p.delta <= 0) return null;
    const below = Math.ceil(5000 / p.delta);
    return below <= p.base ? below : null;
}

/** Units a shelf can restock in an hour (1 per `rate` ticks, shared by every buyer on the world). */
export function restockPerHour(rate: number, ticksPerHour = TICKS_PER_HOUR): number {
    return rate > 0 ? ticksPerHour / rate : 0;
}

/**
 * The steady price paid by a buyer who takes each unit as it restocks onto a shelf sitting `below`
 * units under base (0: a shelf kept full, as with an uncontested camper, pays the base price).
 */
export function steadyPrice(p: Pricing, below = 0): number {
    return unitPrice(p, p.base - below);
}
