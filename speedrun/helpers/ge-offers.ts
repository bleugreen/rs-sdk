// The bidder's own record of its open Grand Exchange buy offers and recent fills, as a
// small JSON file under fleet-run/. The bidder writes it (bidder.ts, option
// `offersFile`); the ambassador's bounty board (ambassador/bounty.ts) only reads it.
// The public order book cannot tell our bid from a competitor's, so a bounty is
// announced from this file, never from the market API.
//
// The file is replaced whole (write to a temp file, then rename), so a reader never
// sees half of it. Everything except the two file functions is pure.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));

/** Default path, shared by writer and reader: <root>/fleet-run/ge-offers.json (on bbs, ~/rs-fleet/fleet-run/). */
export const DEFAULT_OFFERS_FILE = join(ROOT, 'fleet-run', 'ge-offers.json');

export const OFFERS_FILE = {
    /** Fills older than this are dropped from the file. */
    fillsKeptMs: 7 * 24 * 3600_000,
    fillsKept: 200
} as const;

export interface SnapshotOffer {
    /** The exchange's offer id. */
    id: number;
    /** Item name as the game spells it. */
    item: string;
    itemId: number;
    side: 'buy' | 'sell';
    state: string;
    price: number;
    quantity: number;
    remaining: number;
    filled: number;
}

export interface SnapshotFill {
    item: string;
    /** Items that came in. */
    n: number;
    /** ISO time the bidder collected them. */
    at: string;
}

export interface OffersSnapshot {
    version: 1;
    /** The bidder account (login name) whose offers these are. */
    account: string;
    /** ISO time of writing; a reader treats an old file as no offers at all. */
    writtenAt: string;
    offers: SnapshotOffer[];
    /** Fills collected recently, oldest first. */
    fills: SnapshotFill[];
}

export interface OfferInput {
    id: number;
    item: number;
    side: 'buy' | 'sell';
    state: string;
    price: number;
    quantity: number;
    remaining: number;
    filled: number;
}

/** The snapshot for `offers` (the account's own, from the GE state) with item names from `names` (id to name). */
export function offersSnapshot(account: string, offers: readonly OfferInput[], names: ReadonlyMap<number, string>, fills: readonly SnapshotFill[], now: number): OffersSnapshot {
    return {
        version: 1,
        account,
        writtenAt: new Date(now).toISOString(),
        offers: offers
            .filter(o => names.has(o.item))
            .map(o => ({ id: o.id, item: names.get(o.item)!, itemId: o.item, side: o.side, state: o.state, price: o.price, quantity: o.quantity, remaining: o.remaining, filled: o.filled })),
        fills: pruneFills(fills, now)
    };
}

/** Fills worth keeping: the last week, at most OFFERS_FILE.fillsKept, oldest first. */
export function pruneFills(fills: readonly SnapshotFill[], now: number): SnapshotFill[] {
    return fills.filter(f => now - Date.parse(f.at) < OFFERS_FILE.fillsKeptMs).slice(-OFFERS_FILE.fillsKept);
}

const int = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** Accept a file of unknown provenance; anything malformed is null (no offers). */
export function parseOffers(raw: unknown): OffersSnapshot | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const r = raw as Record<string, unknown>;
    if (r.version !== 1 || typeof r.account !== 'string' || typeof r.writtenAt !== 'string' || !Number.isFinite(Date.parse(r.writtenAt))) return null;
    if (!Array.isArray(r.offers) || !Array.isArray(r.fills)) return null;
    const offers: SnapshotOffer[] = [];
    for (const o of r.offers as Record<string, unknown>[]) {
        if (!o || typeof o !== 'object' || typeof o.item !== 'string') continue;
        if (![o.id, o.itemId, o.price, o.quantity, o.remaining, o.filled].every(int)) continue;
        if (o.side !== 'buy' && o.side !== 'sell') continue;
        offers.push({ id: o.id as number, item: o.item, itemId: o.itemId as number, side: o.side, state: String(o.state), price: o.price as number, quantity: o.quantity as number, remaining: o.remaining as number, filled: o.filled as number });
    }
    const fills: SnapshotFill[] = [];
    for (const f of r.fills as Record<string, unknown>[]) {
        if (f && typeof f === 'object' && typeof f.item === 'string' && int(f.n) && f.n > 0 && typeof f.at === 'string' && Number.isFinite(Date.parse(f.at))) fills.push({ item: f.item, n: f.n, at: f.at });
    }
    return { version: 1, account: r.account, writtenAt: r.writtenAt, offers, fills };
}

export function readOffersFile(path: string): OffersSnapshot | null {
    try {
        return parseOffers(JSON.parse(readFileSync(path, 'utf8')));
    } catch {
        return null;
    }
}

/** Replace the file whole (temp file, then rename). */
export function writeOffersFile(path: string, snapshot: OffersSnapshot): void {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(snapshot, null, 1)}\n`);
    renameSync(tmp, path);
}
