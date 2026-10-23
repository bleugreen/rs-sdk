// Joins the parsed content into one row per (shop, item): where the item is sold, the shop's price
// params, the curve's figures, the shelf's restock rate per hour and the shopkeeper's spawn tiles.
import type { Content, ShopInv, ShopOwner, Spawn } from './content';
import { buyCost, ceilingPrice, restockPerHour, unitPrice, unitsToCeiling, type Pricing } from './curve';

export interface ShopRow {
    obj: string;
    name: string;
    id?: number;
    inv: string;
    invFile: string;
    owner: ShopOwner;
    spawns: Spawn[];
    pricing: Pricing;
    /** Configured stock: what a full shelf holds (live shelves can sit below or above it). */
    base: number;
    /** Ticks per restocked unit; 0 for a shelf that never restocks. */
    rate: number;
    restockPerHour: number;
    /** Price of the first unit from a full shelf. */
    priceAtBase: number;
    /** Price of the last unit (one left on the shelf). */
    priceAtOne: number;
    ceiling: number;
    /** Units from a full shelf before the ceiling (null: the shelf empties first). */
    toCeiling: number | null;
    /** Coins to empty a full shelf. */
    buyout: number;
    members: boolean;
}

/**
 * One owner per shelf. A shop inv is one inventory however many NPCs open it (a shop keeper and its
 * assistant, Aemad and Kortan), so owners of the same inv at the same prices merge into one, named
 * "A / B", with every spawn.
 */
export function shelves(c: Content): { owner: ShopOwner; spawns: Spawn[] }[] {
    const out = new Map<string, { owner: ShopOwner; spawns: Spawn[] }>();
    for (const o of c.owners) {
        const key = `${o.inv}|${o.sell}|${o.buy}|${o.delta}`;
        const spawns = c.spawns.get(o.npc) ?? [];
        const had = out.get(key);
        if (!had) {
            out.set(key, { owner: { ...o }, spawns: [...spawns] });
            continue;
        }
        const name = o.npcName ?? o.npc;
        const names = (had.owner.npcName ?? had.owner.npc).split(' / ');
        if (!names.includes(name)) had.owner.npcName = [...names, name].join(' / ');
        had.spawns.push(...spawns);
    }
    return [...out.values()];
}

export function shopRows(c: Content): ShopRow[] {
    const rows: ShopRow[] = [];
    for (const { owner, spawns } of shelves(c)) {
        const inv: ShopInv | undefined = c.invs.get(owner.inv);
        if (!inv) continue;
        for (const s of inv.stock) {
            const o = c.objs.get(s.obj);
            if (!o) continue;
            const pricing: Pricing = { cost: o.cost, sell: owner.sell, delta: owner.delta, base: s.count };
            rows.push({
                obj: s.obj,
                name: o.name,
                id: o.id,
                inv: inv.name,
                invFile: inv.file,
                owner,
                spawns,
                pricing,
                base: s.count,
                rate: inv.restock ? s.rate : 0,
                // A shelf restocks towards its base; one configured at 0 only drains what players sell it.
                restockPerHour: inv.restock && s.count > 0 ? restockPerHour(s.rate) : 0,
                priceAtBase: unitPrice(pricing, s.count),
                priceAtOne: unitPrice(pricing, 1),
                ceiling: ceilingPrice(pricing),
                toCeiling: unitsToCeiling(pricing),
                buyout: buyCost(pricing, s.count) ?? 0,
                members: o.members,
            });
        }
    }
    return rows;
}

/** Rows for the objs whose display name or debugname matches, cheapest first. */
export function rowsFor(rows: ShopRow[], match: RegExp): ShopRow[] {
    return rows.filter(r => match.test(r.name) || match.test(r.obj)).sort((a, b) => a.priceAtBase - b.priceAtBase || b.base - a.base);
}
