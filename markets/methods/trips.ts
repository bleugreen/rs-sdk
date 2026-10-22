// Trip accounting for the method loops: a loop reports its bank after every visit (RoleContext
// reportBank), and two consecutive snapshots bound one full loop, gathering plus the bank trip.
// What changed between them is the loop's net output, consumed food and runes included, because
// the bank is all the demo's wealth board counts (docs/markets/methods.md).

import { objPack } from '../../speedrun/lib/obj-pack';
import { costOf, objCosts, perHour, spread, type Spread } from './value';

export interface BankSnap {
    /** Server tick the snapshot was taken on. */
    tick: number;
    items: readonly { id: number; count: number }[];
}

export interface Trip {
    fromTick: number;
    toTick: number;
    ticks: number;
    /** Units gained (positive) or spent (negative), by obj debug name. */
    delta: Map<string, number>;
    /** Board value gained over the trip: the delta at ObjType.cost. */
    board: number;
}

export type NameOf = (id: number) => string;

export const debugNameOf: NameOf = id => objPack().names.get(id) ?? `obj_${id}`;

/** The bank's change from `a` to `b`, by debug name, without zero entries. */
export function bankDelta(a: BankSnap, b: BankSnap, nameOf: NameOf = debugNameOf): Map<string, number> {
    const out = new Map<string, number>();
    for (const i of a.items) out.set(nameOf(i.id), (out.get(nameOf(i.id)) ?? 0) - i.count);
    for (const i of b.items) out.set(nameOf(i.id), (out.get(nameOf(i.id)) ?? 0) + i.count);
    for (const [k, v] of out) if (v === 0) out.delete(k);
    return out;
}

export function boardOf(delta: ReadonlyMap<string, number>, costs: ReadonlyMap<string, number> = objCosts()): number {
    let v = 0;
    for (const [obj, n] of delta) v += (costOf(obj, costs) ?? 0) * n;
    return v;
}

/**
 * One trip per pair of consecutive bank visits. Snapshots within `mergeTicks` of the one before
 * belong to the same visit (a role may report after each deposit and withdrawal) and collapse to
 * the last.
 */
export function trips(snaps: readonly BankSnap[], nameOf: NameOf = debugNameOf, costs: ReadonlyMap<string, number> = objCosts(), mergeTicks = 20): Trip[] {
    const kept: BankSnap[] = [];
    let last = -Infinity;
    for (const s of snaps) {
        const same = kept.length > 0 && s.tick - last <= mergeTicks;
        last = s.tick;
        if (same) kept[kept.length - 1] = s;
        else kept.push(s);
    }
    const out: Trip[] = [];
    for (let i = 1; i < kept.length; i++) {
        const a = kept[i - 1]!, b = kept[i]!;
        const delta = bankDelta(a, b, nameOf);
        out.push({ fromTick: a.tick, toTick: b.tick, ticks: b.tick - a.tick, delta, board: boardOf(delta, costs) });
    }
    return out;
}

/**
 * Coins per unit at the outlet: `sell` for what a loop produces (a shop's buy price, the alch value,
 * or a GE bid less tax), `buy` for what it consumes (food, runes). Coins are worth 1 either way.
 */
export type Prices = Record<string, { sell?: number; buy?: number }>;

/** A delta's worth in coins: gains at `sell`, spends at `buy` (each falls back to the other). */
export function coinsOf(delta: ReadonlyMap<string, number>, prices: Prices): { coins: number; unpriced: string[] } {
    let coins = 0;
    const unpriced: string[] = [];
    for (const [obj, n] of delta) {
        const plain = obj.startsWith('cert_') ? obj.slice(5) : obj;
        if (plain === 'coins') {
            coins += n;
            continue;
        }
        const p = prices[plain];
        const unit = n > 0 ? (p?.sell ?? p?.buy) : (p?.buy ?? p?.sell);
        if (unit === undefined) unpriced.push(plain);
        else coins += unit * n;
    }
    return { coins, unpriced };
}

export interface RateSummary {
    trips: number;
    ticks: number;
    /** Board value per hour over every trip together. */
    boardPerHour: number;
    /** Spread of the per-trip board value per hour. */
    boardPerHourByTrip: Spread;
    /** Units per hour of every obj that changed, by debug name. */
    perHour: Record<string, number>;
    coinsPerHour?: number;
    coinsPerHourByTrip?: Spread;
    unpriced?: string[];
}

export function summarize(list: readonly Trip[], tickMs: number, prices?: Prices): RateSummary {
    const ticks = list.reduce((a, t) => a + t.ticks, 0);
    const total = new Map<string, number>();
    for (const t of list) for (const [k, v] of t.delta) total.set(k, (total.get(k) ?? 0) + v);
    const board = list.reduce((a, t) => a + t.board, 0);
    const out: RateSummary = {
        trips: list.length,
        ticks,
        boardPerHour: perHour(board, ticks, tickMs),
        boardPerHourByTrip: spread(list.map(t => perHour(t.board, t.ticks, tickMs))),
        perHour: Object.fromEntries([...total].map(([k, v]) => [k, perHour(v, ticks, tickMs)]))
    };
    if (prices) {
        const all = coinsOf(total, prices);
        out.coinsPerHour = perHour(all.coins, ticks, tickMs);
        out.coinsPerHourByTrip = spread(list.map(t => perHour(coinsOf(t.delta, prices).coins, t.ticks, tickMs)));
        if (all.unpriced.length) out.unpriced = all.unpriced;
    }
    return out;
}
