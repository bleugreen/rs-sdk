// Wealth methods the content and the GE book imply, each priced in board value (store cost,
// what /hiscores/bank counts) and in coins, per action and per hour at a given tick period.
//
// Shop prices port shop.rs2: calc_shop_value(cost, delta, multiplier, stock - base) =
// max(100, multiplier - clamp((stock - base) * delta, -5000, 1000)) * cost / 1000, where a
// general store (base -1) prices on its whole stock; a purchase never costs below 1 gp.
// High alchemy pays max(1, 0.6 * cost) (alchemy.rs2). The GE charges sellers 5% (sdk/MARKET.md).
import type { Content, Inv, Obj, ShopOpener } from './content.ts';
import type { BookRow } from './ge-book.ts';

export const GE_SELLER_FEE = 0.05;
/** A general store's unlisted stock decays by one unit every 100 ticks (World.ts INV_STOCKRATE). */
export const GENERAL_DECAY_TICKS = 100;

export function ticksPerHour(tickMs: number): number {
    return 3_600_000 / tickMs;
}

export function shopValue(cost: number, delta: number, multiplier: number, diff: number): number {
    const swing = Math.min(1000, Math.max(-5000, diff * delta));
    const m = Math.max(100, multiplier - swing);
    return Math.trunc((m * cost) / 1000);
}

/** What a player pays for one unit while the shop holds `stock` (base -1 for a general store's unlisted item). */
export function buyFromShop(cost: number, shop: Pick<ShopOpener, 'sell' | 'delta'>, stock: number, base: number): number {
    return Math.max(1, shopValue(cost, shop.delta, shop.sell, base === -1 ? stock : stock - base));
}

/** What a shop pays a player for one unit while it holds `stock`. */
export function sellToShop(cost: number, shop: Pick<ShopOpener, 'buy' | 'delta'>, stock: number, base: number): number {
    return shopValue(cost, shop.delta, shop.buy, base === -1 ? stock : stock - base);
}

export function highAlch(cost: number): number {
    return Math.max(1, Math.trunc((6 * cost) / 10));
}

/** Can this shop take `obj` from a player (shop.rs2 can_sell_obj, on a members world)? */
export function shopAccepts(inv: Inv, obj: Obj): boolean {
    if (obj.name === 'coins' || !obj.tradeable) return false;
    if (inv.name === 'generalshop3' && obj.name === 'silk') return false;
    return inv.allstock || inv.stock.some(l => l.obj === obj.name);
}

export interface Tile {
    x: number;
    z: number;
    level: number;
}

export function keeperTiles(c: Content, shop: ShopOpener): Tile[] {
    return shop.source === 'npc' ? c.npcSpawns.get(shop.keeper) ?? [] : [];
}

/** Chebyshev tiles between the closest spawns of two keepers (null when either is unknown). */
export function tilesBetween(a: Tile[], b: Tile[]): number | null {
    let best: number | null = null;
    for (const p of a) for (const q of b) {
        const d = Math.max(Math.abs(p.x - q.x), Math.abs(p.z - q.z));
        if (best === null || d < best) best = d;
    }
    return best;
}

function where(c: Content, shop: ShopOpener): string {
    const t = keeperTiles(c, shop)[0];
    return t ? `${t.x},${t.z}${t.level ? `,${t.level}` : ''}` : shop.source === 'script' ? shop.keeper : '?';
}

/** One shop stock line priced at base stock. */
export interface ShopLine {
    shop: string;
    title: string;
    keeper: string;
    at: string;
    obj: string;
    display: string;
    cost: number;
    base: number;
    rate: number;
    restocks: boolean;
    /** Price of the unit bought at base stock. */
    price: number;
    /** cost / price: board value per coin. */
    boardPerCoin: number;
    /** Units an hour the world-clock restock provides (0 when the shop never restocks). */
    unitsPerHour: number;
    /** Board value gained per hour buying every restocked unit at base: (cost - price) x units. */
    boardGainPerHour: number;
    /** Units below base still priced under cost: a one-off gain when the shop is full. */
    oneOffUnits: number;
    oneOffGain: number;
}

export function shopLines(c: Content, tickMs: number): ShopLine[] {
    const tph = ticksPerHour(tickMs);
    const out: ShopLine[] = [];
    for (const shop of c.shops) {
        const inv = c.invs.get(shop.inv);
        if (!inv) continue;
        for (const l of inv.stock) {
            const o = c.objs.get(l.obj);
            if (!o || l.base <= 0) continue;
            const price = buyFromShop(o.cost, shop, l.base, l.base);
            let oneOffUnits = 0;
            let oneOffGain = 0;
            for (let k = 0; k < l.base; k++) {
                const p = buyFromShop(o.cost, shop, l.base - k, l.base);
                if (p >= o.cost) break;
                oneOffUnits++;
                oneOffGain += o.cost - p;
            }
            const unitsPerHour = inv.restock && l.rate > 0 ? tph / l.rate : 0;
            out.push({
                shop: shop.inv, title: shop.title, keeper: shop.keeperDisplay, at: where(c, shop),
                obj: o.name, display: o.display, cost: o.cost, base: l.base, rate: l.rate, restocks: inv.restock,
                price, boardPerCoin: o.cost / price, unitsPerHour,
                boardGainPerHour: Math.max(0, o.cost - price) * unitsPerHour,
                oneOffUnits, oneOffGain,
            });
        }
    }
    return out;
}

/** Shops whose multipliers would let a player buy back above what they sold for, or sell above cost. */
export function multiplierAnomalies(c: Content): ShopOpener[] {
    return c.shops.filter(s => s.buy >= s.sell || s.sell < 1000 || s.buy > 1000 || s.defaulted);
}

export interface Arbitrage {
    obj: string;
    display: string;
    cost: number;
    from: string;
    fromAt: string;
    buy: number;
    to: string;
    toAt: string;
    /** What the second shop pays for the first unit at its base (or empty, for a general store). */
    sell: number;
    margin: number;
    unitsPerHour: number;
    coinsPerHour: number;
    tiles: number | null;
}

/** Buy at one shop's base price, sell to another shop that pays more for the first unit. */
export function shopArbitrage(c: Content, tickMs: number): Arbitrage[] {
    const tph = ticksPerHour(tickMs);
    const out: Arbitrage[] = [];
    for (const a of c.shops) {
        const invA = c.invs.get(a.inv);
        if (!invA) continue;
        for (const l of invA.stock) {
            const o = c.objs.get(l.obj);
            if (!o || l.base <= 0) continue;
            const buy = buyFromShop(o.cost, a, l.base, l.base);
            for (const b of c.shops) {
                if (b.inv === a.inv) continue;
                const invB = c.invs.get(b.inv);
                if (!invB || !shopAccepts(invB, o)) continue;
                const lineB = invB.stock.find(s => s.obj === o.name);
                const sell = lineB ? sellToShop(o.cost, b, lineB.base, lineB.base) : sellToShop(o.cost, b, 0, -1);
                if (sell <= buy) continue;
                // Units the pair moves at these prices: the slower of A's restock and B's overstock decay.
                const rateA = invA.restock && l.rate > 0 ? l.rate : Infinity;
                const rateB = lineB ? (invB.restock && lineB.rate > 0 ? lineB.rate : Infinity) : GENERAL_DECAY_TICKS;
                const unitsPerHour = tph / Math.max(rateA, rateB);
                out.push({
                    obj: o.name, display: o.display, cost: o.cost,
                    from: a.title, fromAt: where(c, a), buy, to: b.title, toAt: where(c, b), sell,
                    margin: sell - buy, unitsPerHour, coinsPerHour: (sell - buy) * unitsPerHour,
                    tiles: tilesBetween(keeperTiles(c, a), keeperTiles(c, b)),
                });
            }
        }
    }
    return out;
}

export interface AlchLine {
    obj: string;
    display: string;
    cost: number;
    alch: number;
    shop: string;
    price: number;
    /** Coins per cast after the item and a nature rune at `natureCost`. */
    profit: number;
    unitsPerHour: number;
    coinsPerHour: number;
}

/** High alchemy of shop-bought items, against the cheapest nature rune price given. */
export function alchFromShops(lines: ShopLine[], natureCost: number): AlchLine[] {
    return lines.map(l => {
        const alch = highAlch(l.cost);
        const profit = alch - l.price - natureCost;
        return { obj: l.obj, display: l.display, cost: l.cost, alch, shop: l.title, price: l.price, profit, unitsPerHour: l.unitsPerHour, coinsPerHour: profit * l.unitsPerHour };
    }).filter(a => a.profit > 0);
}

export interface BidLine {
    id: number;
    obj: string | null;
    display: string;
    cost: number;
    bid: number;
    /** Mean price across all open bids: buyValue / buyQuantity. Equal to `bid` when the depth is all at the best. */
    meanBid: number;
    depth: number;
    committed: number;
    /** Coins received per unit after the seller fee, at the best bid. */
    net: number;
    /** net / cost: coins per unit of board value given up by selling instead of banking. */
    overCost: number;
    /** Best shop price for the item at base stock, if any shop sells it. */
    shopPrice: number | null;
    shop: string | null;
    /** net - shopPrice: coins per unit buying from that shop and filling the bid. */
    shopMargin: number | null;
    /** Best of high alchemy and any shop's base buy price. */
    bestNonGe: number;
}

export function bidLines(c: Content, rows: BookRow[], lines: ShopLine[]): BidLine[] {
    const byId = new Map<number, Obj>();
    for (const o of c.objs.values()) if (o.id !== null) byId.set(o.id, o);
    const out: BidLine[] = [];
    for (const r of rows) {
        if (r.bid === null || r.buyQuantity <= 0) continue;
        const o = byId.get(r.id) ?? null;
        const cost = o?.cost ?? r.basePrice;
        const net = Math.floor(r.bid * (1 - GE_SELLER_FEE));
        const sellers = o ? lines.filter(l => l.obj === o.name) : [];
        const cheapest = sellers.sort((a, b) => a.price - b.price)[0] ?? null;
        let shopBuy = 0;
        if (o) for (const s of c.shops) {
            const inv = c.invs.get(s.inv);
            if (!inv || !shopAccepts(inv, o)) continue;
            const l = inv.stock.find(x => x.obj === o.name);
            shopBuy = Math.max(shopBuy, l ? sellToShop(cost, s, l.base, l.base) : sellToShop(cost, s, 0, -1));
        }
        out.push({
            id: r.id, obj: o?.name ?? null, display: r.name, cost, bid: r.bid,
            meanBid: r.buyValue / r.buyQuantity, depth: r.buyQuantity, committed: r.buyValue,
            net, overCost: net / cost,
            shopPrice: cheapest?.price ?? null, shop: cheapest ? `${cheapest.title} (${cheapest.at})` : null,
            shopMargin: cheapest ? net - cheapest.price : null,
            bestNonGe: Math.max(highAlch(cost), shopBuy),
        });
    }
    return out;
}

export interface AskLine {
    id: number;
    display: string;
    cost: number;
    ask: number;
    meanAsk: number;
    depth: number;
    /** cost / ask: board value per coin spent. */
    boardPerCoin: number;
    /** Board value gained buying the whole listed depth at the mean ask (negative when it loses). */
    gainAtDepth: number;
}

export function askLines(c: Content, rows: BookRow[]): AskLine[] {
    const byId = new Map<number, Obj>();
    for (const o of c.objs.values()) if (o.id !== null) byId.set(o.id, o);
    return rows.filter(r => r.ask !== null && r.sellQuantity > 0).map(r => {
        const cost = byId.get(r.id)?.cost ?? r.basePrice;
        const meanAsk = r.sellValue / r.sellQuantity;
        return { id: r.id, display: r.name, cost, ask: r.ask!, meanAsk, depth: r.sellQuantity, boardPerCoin: cost / r.ask!, gainAtDepth: (cost - meanAsk) * r.sellQuantity };
    });
}

export interface GroundLine {
    obj: string;
    display: string;
    cost: number;
    /** Spawn points in the cluster (one 64x64 map square). */
    spawns: number;
    units: number;
    respawn: number;
    square: string;
    at: string;
    /** Board value an hour if every spawn in the square is taken the moment it respawns. */
    boardPerHour: number;
}

export function groundSpawns(c: Content, tickMs: number): GroundLine[] {
    const tph = ticksPerHour(tickMs);
    const groups = new Map<string, GroundLine>();
    for (const s of c.groundObjs) {
        const o = c.objs.get(s.obj);
        if (!o || !o.tradeable) continue;
        const square = `${s.x >> 6}_${s.z >> 6}`;
        const key = `${o.name}@${square}`;
        const g = groups.get(key) ?? { obj: o.name, display: o.display, cost: o.cost, spawns: 0, units: 0, respawn: o.respawnrate, square, at: `${s.x},${s.z}${s.level ? `,${s.level}` : ''}`, boardPerHour: 0 };
        g.spawns++;
        g.units += s.count;
        g.boardPerHour = (g.units * o.cost * tph) / Math.max(1, o.respawnrate);
        groups.set(key, g);
    }
    return [...groups.values()];
}

export interface ThievingLine {
    kind: 'pickpocket' | 'stall';
    row: string;
    targets: string;
    level: number;
    /** Chance an attempt succeeds at Thieving 99 (stalls: 1). */
    success: number;
    /** Expected loot per success, valued at store cost, and the coin share of it. */
    valuePerSuccess: number;
    coinsPerSuccess: number;
    /** Modelled expected value per tick at 99: successes take 2 ticks, failures 2 + the stun. */
    valuePerTick: number;
    loot: string;
}

/** pick_pocket_check_for_reward: each entry, last first, rolls random(128 - weights already rolled). */
export function pickpocketExpectation(loot: { obj: string; min: number; max: number; weight: number }[], cost: (o: string) => number): { value: number; coins: number } {
    let denom = 128;
    let value = 0;
    let coins = 0;
    for (let i = loot.length - 1; i >= 0; i--) {
        const l = loot[i]!;
        // Once the denominator reaches 0, random(0) is 0 and every remaining entry is awarded.
        const p = denom <= 0 ? 1 : Math.min(1, l.weight / denom);
        denom -= l.weight;
        const v = p * ((l.min + l.max) / 2) * cost(l.obj);
        value += v;
        if (l.obj === 'coins') coins += v;
    }
    return { value, coins };
}

export function thievingLines(c: Content, chance: (low: number, high: number, level: number) => number): ThievingLine[] {
    const cost = (o: string) => c.objs.get(o)?.cost ?? 0;
    const out: ThievingLine[] = [];
    for (const p of c.pickpockets) {
        const success = chance(p.chance[0], p.chance[1], 99);
        const e = pickpocketExpectation(p.loot, cost);
        const ticks = success * 2 + (1 - success) * (2 + p.stunTicks);
        out.push({
            kind: 'pickpocket', row: p.row, targets: p.npcs.join(' '), level: p.level, success,
            valuePerSuccess: e.value, coinsPerSuccess: e.coins, valuePerTick: (success * e.value) / ticks,
            loot: p.loot.map(l => `${l.obj} ${l.min === l.max ? l.min : `${l.min}-${l.max}`} (${l.weight})`).join(', '),
        });
    }
    for (const s of c.stalls) {
        const total = s.lootTotal || s.loot.reduce((a, l) => a + l.weight, 0);
        let value = 0;
        let coins = 0;
        for (const l of s.loot) {
            const v = (l.weight / total) * ((l.min + l.max) / 2) * cost(l.obj);
            value += v;
            if (l.obj === 'coins') coins += v;
        }
        out.push({
            kind: 'stall', row: s.row, targets: s.loc, level: s.level, success: 1, valuePerSuccess: value, coinsPerSuccess: coins,
            valuePerTick: value / Math.max(1, s.respawnTicks),
            loot: s.loot.map(l => `${l.obj} (${l.weight}/${total})`).join(', '),
        });
    }
    return out;
}
