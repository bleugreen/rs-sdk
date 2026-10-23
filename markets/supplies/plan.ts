// What it costs in coins to obtain a run's count of an item, buying each next unit from whichever
// source is cheapest at that moment: the NPC shops' curves from a full (configured) shelf, and the
// Grand Exchange's open asks. One visit per shop, no waiting for restocks.
import { unitPrice, type Pricing } from './curve';

export interface ShelfSource {
    label: string;
    pricing: Pricing;
    /** Units on the shelf when the buying starts (default: the configured base). */
    stock?: number;
}

export interface GeSource {
    /** Best open ask. */
    ask: number;
    /**
     * Open sell quantity across the whole book. The public API reports the book's total quantity and
     * value, not its price levels, so every unit is priced at `price` (the caller chooses the best ask
     * or the book's mean).
     */
    depth: number;
    price?: number;
}

export interface Fill {
    /** Units obtained: the need, or fewer when every source runs out. */
    units: number;
    cost: number;
    /** Units taken from each shop, by label, and from the exchange. */
    taken: Record<string, number>;
    ge: number;
    /** The price of the last unit bought: what one more unit would cost at the margin. */
    marginal: number | null;
}

export function cheapestFill(need: number, shelves: ShelfSource[], ge?: GeSource | null): Fill {
    const left = shelves.map(s => s.stock ?? s.pricing.base);
    const taken: Record<string, number> = {};
    const gePrice = ge ? (ge.price ?? ge.ask) : 0;
    let geLeft = ge ? ge.depth : 0;
    let geTaken = 0;
    let cost = 0;
    let units = 0;
    let marginal: number | null = null;
    while (units < need) {
        let best = -1;
        let bestPrice = Infinity;
        shelves.forEach((s, i) => {
            if (left[i]! <= 0) return;
            const p = unitPrice(s.pricing, left[i]!);
            if (p < bestPrice) [best, bestPrice] = [i, p];
        });
        if (geLeft > 0 && gePrice < bestPrice) {
            const n = best < 0 ? Math.min(geLeft, need - units) : 1;
            geLeft -= n;
            geTaken += n;
            units += n;
            cost += n * gePrice;
            marginal = gePrice;
            continue;
        }
        if (best < 0) break;
        left[best]!--;
        taken[shelves[best]!.label] = (taken[shelves[best]!.label] ?? 0) + 1;
        units++;
        cost += bestPrice;
        marginal = bestPrice;
    }
    return { units, cost, taken, ge: geTaken, marginal };
}
