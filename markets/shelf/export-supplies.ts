// Merge shelf readings into the supplies table's data file (rs/503,
// markets/supplies/data/shelf.json): an array of {inv, obj, count, price, at}
// with content (debug) names.
//
//   bun markets/shelf/export-supplies.ts <readings.jsonl>... [--to markets/supplies/data/shelf.json]
//
// `price` is the server's own price for the next unit (the record's valuePrice),
// else the price computed from the content's stock config, and only then the
// SDK's buyPrice, which assumes the shelf holds its configured stock and is
// wrong whenever it does not (docs/markets/shelf-reader.md, "Prices"). `at` is
// the reading's UTC time. One entry per (inv, obj): the newest reading wins,
// in the readings and against the file; other entries in the file are kept.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { ItemRecord } from './stops';

export interface SupplyEntry {
    inv: string;
    obj: string;
    count: number;
    price: number;
    at: string;
}

export const DEFAULT_SUPPLIES = resolve(import.meta.dir, '..', 'supplies', 'data', 'shelf.json');

const key = (e: Pick<SupplyEntry, 'inv' | 'obj'>) => `${e.inv}\u0000${e.obj}`;

/** The entry an item reading gives, or why it gives none. */
export function supplyEntry(r: Partial<ItemRecord>): SupplyEntry | string {
    if (r.kind !== 'item') return 'not an item line';
    if (!r.inv || !r.obj) return `${r.stop}/${r.name}: no content inv or obj name`;
    const price = r.valuePrice ?? r.computedBuyPrice ?? r.buyPrice;
    if (typeof price !== 'number' || typeof r.count !== 'number' || !r.utc) return `${r.stop}/${r.name}: no price, count or time`;
    return { inv: r.inv, obj: r.obj, count: r.count, price, at: r.utc };
}

/** `incoming` over `existing`: per (inv, obj) the later `at` wins; existing order kept, new entries appended in reading order. */
export function mergeSupplies(existing: readonly SupplyEntry[], incoming: readonly SupplyEntry[]): SupplyEntry[] {
    const out = existing.map(e => ({ ...e }));
    const at = new Map(out.map((e, i) => [key(e), i]));
    for (const e of incoming) {
        const i = at.get(key(e));
        if (i === undefined) {
            at.set(key(e), out.length);
            out.push({ ...e });
        } else if (Date.parse(e.at) >= Date.parse(out[i]!.at)) out[i] = { ...e };
    }
    return out;
}

/** Entries from JSONL readings text, with the reasons for lines that gave none. */
export function readingsToEntries(text: string): { entries: SupplyEntry[]; dropped: string[] } {
    const entries: SupplyEntry[] = [];
    const dropped: string[] = [];
    for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        const r = JSON.parse(line) as Partial<ItemRecord>;
        if (r.kind !== 'item') continue;
        const e = supplyEntry(r);
        if (typeof e === 'string') dropped.push(e);
        else entries.push(e);
    }
    return { entries, dropped };
}

if (import.meta.main) {
    const args = process.argv.slice(2);
    const toAt = args.findIndex(a => a === '--to' || a.startsWith('--to='));
    const to = toAt < 0 ? DEFAULT_SUPPLIES : args[toAt]!.includes('=') ? args[toAt]!.slice(5) : args[toAt + 1]!;
    const files = args.filter((_, i) => toAt < 0 || (i !== toAt && (args[toAt]!.includes('=') || i !== toAt + 1)));
    if (files.length === 0 || !to) {
        console.error('usage: bun markets/shelf/export-supplies.ts <readings.jsonl>... [--to markets/supplies/data/shelf.json]');
        process.exit(2);
    }
    const existing = existsSync(to) ? (JSON.parse(readFileSync(to, 'utf8')) as SupplyEntry[]) : [];
    let merged = existing;
    let read = 0;
    for (const f of files) {
        const { entries, dropped } = readingsToEntries(readFileSync(f, 'utf8'));
        for (const d of dropped) console.error(`skipped: ${d}`);
        read += entries.length;
        merged = mergeSupplies(merged, entries);
    }
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, JSON.stringify(merged, null, 2) + '\n');
    console.log(`${to}: ${read} readings merged, ${existing.length} entries before, ${merged.length} after`);
}
