// Item matching shared by the bank and trade planners.

import { readFileSync } from 'fs';
import { join } from 'path';

export type ItemPattern = string | RegExp | number;

/** Every obj's id and debug name, one `id=name` line each. */
export const OBJ_PACK = join(import.meta.dir, '../../server/content/pack/obj.pack');

let objs: { byId: Map<number, string>; byName: Map<string, number> } | null = null;

function objPack() {
    if (!objs) {
        objs = { byId: new Map(), byName: new Map() };
        for (const line of readFileSync(OBJ_PACK, 'utf8').split('\n')) {
            const m = line.match(/^(\d+)=(\S+)$/);
            if (!m) continue;
            objs.byId.set(Number(m[1]), m[2]!);
            objs.byName.set(m[2]!, Number(m[1]));
        }
    }
    return objs;
}

/** The obj's debug name (`guamvial`), or undefined when obj.pack has no such id. */
export function objName(id: number): string | undefined {
    return objPack().byId.get(id);
}

/**
 * The id of the obj's banknote, or undefined when it has none. The packer links obj X to the obj
 * named `cert_X` (its certlink, server/engine/tools/pack/config/ObjConfig.ts), so the note is read
 * from obj.pack by that name rather than assumed to be the next id.
 */
export function noteOf(id: number): number | undefined {
    const name = objName(id);
    return name === undefined || name.startsWith('cert_') ? undefined : objPack().byName.get(`cert_${name}`);
}

/**
 * A number matches the item id; a string is a case-insensitive substring of
 * the name (the SDK's convention); a RegExp is tested against the name.
 */
export function matchesItem(item: { id: number; name: string }, pattern: ItemPattern): boolean {
    if (typeof pattern === 'number') return item.id === pattern;
    if (typeof pattern === 'string') return item.name.toLowerCase().includes(pattern.toLowerCase());
    pattern.lastIndex = 0;
    return pattern.test(item.name);
}

export function matchesAny(item: { id: number; name: string }, patterns: readonly ItemPattern[]): boolean {
    return patterns.some(p => matchesItem(item, p));
}

/** Total count per item name (noted and unnoted copies share a name). */
export function countByName(items: ReadonlyArray<{ name: string; count: number }>): Map<string, number> {
    const m = new Map<string, number>();
    for (const i of items) m.set(i.name, (m.get(i.name) ?? 0) + i.count);
    return m;
}

/**
 * Buttons that move exactly `n` of a stack of `stack` through a 1 / 5 / 10 /
 * All / X interface (bank withdraw, trade offer). `-1` is All; any other value
 * not in {1, 5, 10} is an X amount, which costs a count-dialog round trip and
 * holds the client's action queue while it waits. Up to three 10/5/1 clicks
 * are preferred over X.
 *
 * `singlePress` limits the result to one button (All, 1/5/10, or X). Use it
 * when the count is spread one item per slot (an unstackable item in the
 * inventory): every press names a slot, the server takes the item from that
 * slot first, and a second press on the now-empty slot moves nothing.
 */
export function amountButtons(n: number, stack: number, opts: { singlePress?: boolean } = {}): number[] {
    if (!Number.isInteger(n) || n <= 0) throw new Error(`invalid amount ${n}`);
    if (n >= stack) return [-1];
    if (n === 1 || n === 5 || n === 10 || opts.singlePress) return [n];
    const tens = Math.floor(n / 10);
    const fives = Math.floor((n % 10) / 5);
    const ones = n % 5;
    if (tens + fives + ones <= 3) {
        return [...Array(tens).fill(10), ...Array(fives).fill(5), ...Array(ones).fill(1)];
    }
    return [n];
}

export function isXAmount(amount: number): boolean {
    return amount !== -1 && amount !== 1 && amount !== 5 && amount !== 10;
}

export const INVENTORY_SIZE = 28;
