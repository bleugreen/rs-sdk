// Item matching shared by the bank and trade planners.

export type ItemPattern = string | RegExp | number;

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
 */
export function amountButtons(n: number, stack: number): number[] {
    if (!Number.isInteger(n) || n <= 0) throw new Error(`invalid amount ${n}`);
    if (n >= stack) return [-1];
    if (n === 1 || n === 5 || n === 10) return [n];
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
