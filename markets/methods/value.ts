// Pure valuation and rate arithmetic for the markets method measurements (docs/markets/methods.md).
//
// Two units, per login:
// - board value: what the demo's bank board counts, sum of ObjType.cost x count over the bank
//   (server/engine/src/server/login/LoginServer.ts, 'Update bank hiscore'). A note counts at its
//   own obj's cost, which the packer copies from the item it certifies, and coins count 1 each.
// - coins: the output sold at its best realistic outlet (a shop, High Alchemy, or a standing GE
//   bid less the 5% seller tax).
//
// Every engine rule here is read from content and named where it is used, so a test can pin it.

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

export const CONTENT_SCRIPTS = join(import.meta.dir, '../../server/content/scripts');

/** Ticks in an hour at a tick length in ms (9,000 at 400 ms, 12,000 at 300 ms). */
export function ticksPerHour(tickMs: number): number {
    return 3_600_000 / tickMs;
}

/** An amount earned over `ticks` server ticks, scaled to one hour at `tickMs`. */
export function perHour(amount: number, ticks: number, tickMs: number): number {
    if (ticks <= 0) return 0;
    return (amount / ticks) * ticksPerHour(tickMs);
}

export interface Spread {
    n: number;
    mean: number;
    min: number;
    max: number;
    sd: number;
}

/** Count, mean, range and sample standard deviation of a list (all 0 for an empty list). */
export function spread(values: readonly number[]): Spread {
    const n = values.length;
    if (n === 0) return { n: 0, mean: 0, min: 0, max: 0, sd: 0 };
    const mean = values.reduce((a, v) => a + v, 0) / n;
    const sd = n > 1 ? Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1)) : 0;
    return { n, mean, min: Math.min(...values), max: Math.max(...values), sd };
}

// ------------------------------------------------------------------ obj costs

/**
 * `cost=` of every obj in the given .obj source texts, by debug name. An obj with no `cost=` line
 * costs 1 (ObjType's default). Certificates (`cert_x`) are not listed in content; `costOf` maps them
 * to the item they certify.
 */
export function parseObjCosts(texts: readonly string[]): Map<string, number> {
    const costs = new Map<string, number>();
    for (const text of texts) {
        let current: string | null = null;
        for (const raw of text.split('\n')) {
            const line = raw.trim();
            const head = /^\[([^\]]+)\]$/.exec(line);
            if (head) {
                current = head[1]!;
                if (!costs.has(current)) costs.set(current, 1);
                continue;
            }
            const cost = /^cost=(\d+)$/.exec(line);
            if (current && cost) costs.set(current, Number(cost[1]));
        }
    }
    return costs;
}

function objFiles(dir: string): string[] {
    const out: string[] = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) out.push(...objFiles(p));
        else if (e.name.endsWith('.obj')) out.push(p);
    }
    return out;
}

let loaded: Map<string, number> | null = null;

/** Every obj's cost read from server/content/scripts (cached). */
export function objCosts(): Map<string, number> {
    if (!loaded) loaded = parseObjCosts(objFiles(CONTENT_SCRIPTS).map(f => readFileSync(f, 'utf8')));
    return loaded;
}

/** Cost of an obj by debug name; a `cert_x` note costs what x costs. Undefined when unknown. */
export function costOf(debugName: string, costs: ReadonlyMap<string, number> = objCosts()): number | undefined {
    const plain = debugName.startsWith('cert_') ? debugName.slice(5) : debugName;
    return costs.get(plain);
}

export interface Held {
    /** Debug name (obj.pack), e.g. `coins`, `shark`, `cert_shark`. */
    obj: string;
    count: number;
}

/** The bank board's value of a set of stacks: sum of cost x count. Unknown objs count 0 and are returned. */
export function boardValue(items: readonly Held[], costs: ReadonlyMap<string, number> = objCosts()): { value: number; unknown: string[] } {
    let value = 0;
    const unknown: string[] = [];
    for (const i of items) {
        const c = costOf(i.obj, costs);
        if (c === undefined) unknown.push(i.obj);
        else value += c * i.count;
    }
    return { value, unknown };
}

// ------------------------------------------------------------------ outlets

/** High Alchemy's coins for an obj of this cost: max(scale(6, 10, cost), 1) (alchemy.rs2). */
export function highAlch(cost: number): number {
    return Math.max(Math.floor((cost * 6) / 10), 1);
}

/** Low Alchemy's coins: max(scale(4, 10, cost), 1) (alchemy.rs2). */
export function lowAlch(cost: number): number {
    return Math.max(Math.floor((cost * 4) / 10), 1);
}

/** What a sale into a GE bid nets after the 5% seller tax (sdk/MARKET.md), per unit. */
export function bidNet(bid: number): number {
    return bid * 0.95;
}

/**
 * shop.rs2 `calc_shop_value`: the price of one unit when the shop holds `stock` of an item whose
 * configured stock is `base` (-1 when the shop does not list it). `multiplier` is the npc's
 * shop_sell_multiplier when the player buys and shop_buy_multiplier when the player sells; `delta`
 * is shop_delta (default 10).
 */
export function shopUnitPrice(cost: number, multiplier: number, stock: number, base: number, delta = 10): number {
    const diff = base === -1 ? stock : stock - base;
    let m = Math.min(1000, Math.max(-5000, diff * delta));
    m = Math.max(100, multiplier - m);
    return Math.floor((m * cost) / 1000);
}

/** Total coins to buy `n` units from a shop now holding `stock` (each unit priced at the stock before it leaves; buy prices floor at 1). */
export function shopBuyTotal(cost: number, sellMultiplier: number, stock: number, base: number, n: number, delta = 10): number {
    let total = 0;
    for (let i = 0; i < n && stock - i > 0; i++) total += Math.max(1, shopUnitPrice(cost, sellMultiplier, stock - i, base, delta));
    return total;
}

/** Total coins for selling `n` units to a shop now holding `stock` (each unit priced at the stock before it arrives). */
export function shopSellTotal(cost: number, buyMultiplier: number, stock: number, base: number, n: number, delta = 10): number {
    let total = 0;
    for (let i = 0; i < n; i++) total += shopUnitPrice(cost, buyMultiplier, stock + i, base, delta);
    return total;
}

/**
 * A shop line restocks one unit on every world tick divisible by `stockrate` while it holds less than
 * its configured stock (World.ts, the world-inv reset). Units an hour at `tickMs`, shared by every
 * player in the world: this does not scale with logins.
 */
export function restockPerHour(stockrate: number, tickMs: number): number {
    return ticksPerHour(tickMs) / stockrate;
}

// ------------------------------------------------------------------ pickpocketing

/**
 * `stat_random(thieving, lo, hi)` (PlayerOps.ts): the chance a roll at level L succeeds,
 * (floor(lo(99-L)/98) + floor(hi(L-1)/98) + 1) / 256, capped at 1.
 */
export function pickpocketChance(level: number, lo: number, hi: number): number {
    const n = Math.floor((lo * (99 - level)) / 98) + Math.floor((hi * (level - 1)) / 98) + 1;
    return Math.min(1, n / 256);
}

export interface LootEntry {
    obj: string;
    min: number;
    max: number;
    /** The dbrow's rarity numerator. */
    weight: number;
}

/**
 * Expected units of each obj per successful pickpocket. thieving.rs2
 * `pick_pocket_check_for_reward` walks the loot list from its last entry to its first with a
 * denominator that starts at 128 and loses each entry's weight after that entry's roll; an entry
 * pays when random(d) >= d - weight. Every entry is rolled (there is no early return), so one
 * success can pay several entries, and the first entry whose weights reach 128 always pays
 * (paladins always give both coins and chaos runes).
 */
export function lootPerSuccess(entries: readonly LootEntry[]): Map<string, number> {
    const out = new Map<string, number>();
    let d = 128;
    for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i]!;
        const after = d - e.weight;
        // random(d) is uniform on [0, d); random(0) or below returns 0, which is >= any after <= 0
        const p = d <= 0 ? 1 : Math.min(1, Math.max(0, (d - Math.max(after, 0)) / d));
        d = after;
        out.set(e.obj, (out.get(e.obj) ?? 0) + (p * (e.min + e.max)) / 2);
    }
    return out;
}

export interface PickpocketTarget {
    lo: number;
    hi: number;
    stunTicks: number;
    stunDamage: number;
    loot: readonly LootEntry[];
}

/**
 * Ticks per roll when the bot clicks every tick: 2 for a success and stun + 3 for a failure
 * (docs/speedrun/skills/thieving.md section 4), before walking and eating.
 */
export function pickpocketTicksPerRoll(p: number, stunTicks: number): number {
    return 2 * p + (stunTicks + 3) * (1 - p);
}

/** pickpocket.dbrow rows for the targets the methods table covers. */
export const PICKPOCKET: Record<string, PickpocketTarget> = {
    man: { lo: 180, hi: 240, stunTicks: 8, stunDamage: 1, loot: [{ obj: 'coins', min: 3, max: 3, weight: 128 }] },
    farmer: { lo: 150, hi: 240, stunTicks: 8, stunDamage: 1, loot: [{ obj: 'coins', min: 9, max: 9, weight: 123 }] },
    warrior: { lo: 100, hi: 240, stunTicks: 8, stunDamage: 2, loot: [{ obj: 'coins', min: 18, max: 18, weight: 128 }] },
    guard: { lo: 50, hi: 240, stunTicks: 8, stunDamage: 2, loot: [{ obj: 'coins', min: 30, max: 30, weight: 128 }] },
    knight: { lo: 50, hi: 240, stunTicks: 8, stunDamage: 3, loot: [{ obj: 'coins', min: 50, max: 50, weight: 128 }] },
    watchman: { lo: 15, hi: 160, stunTicks: 8, stunDamage: 3, loot: [{ obj: 'coins', min: 60, max: 60, weight: 128 }, { obj: 'bread', min: 1, max: 1, weight: 128 }] },
    paladin: { lo: 50, hi: 150, stunTicks: 8, stunDamage: 3, loot: [{ obj: 'coins', min: 80, max: 80, weight: 128 }, { obj: 'chaosrune', min: 2, max: 2, weight: 128 }] },
    hero: {
        lo: 6, hi: 100, stunTicks: 10, stunDamage: 4,
        loot: [
            { obj: 'coins', min: 200, max: 300, weight: 105 },
            { obj: 'deathrune', min: 2, max: 2, weight: 8 },
            { obj: 'jug_wine', min: 1, max: 1, weight: 6 },
            { obj: 'bloodrune', min: 1, max: 1, weight: 5 },
            { obj: 'fire_orb', min: 1, max: 1, weight: 2 },
            { obj: 'diamond', min: 1, max: 1, weight: 1 },
            { obj: 'gold_ore', min: 1, max: 1, weight: 1 }
        ]
    }
};

/** Expected loot per server tick for a target at a level, clicking every tick with no walking. */
export function pickpocketPerTick(t: PickpocketTarget, level: number): Map<string, number> {
    const p = pickpocketChance(level, t.lo, t.hi);
    const ticks = pickpocketTicksPerRoll(p, t.stunTicks);
    const out = new Map<string, number>();
    for (const [obj, n] of lootPerSuccess(t.loot)) out.set(obj, (n * p) / ticks);
    return out;
}
