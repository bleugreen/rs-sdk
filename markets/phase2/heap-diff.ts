/**
 * Compare two V8-format heap snapshots of the phase-2 runner (heap-probe.ts writes them; docs/markets/phase2.md 'Memory'):
 * objects and self size by node type and name, the largest changes first.
 *
 *   bun markets/phase2/heap-diff.ts <before.heapsnapshot> <after.heapsnapshot> [--top N]
 */
import { readFileSync } from 'node:fs';

interface Snapshot {
    snapshot: { meta: { node_fields: string[]; node_types: [string[], ...unknown[]] } };
    nodes: number[];
    strings: string[];
}

export interface Group {
    count: number;
    size: number;
}

/** Objects and self size by `type:name` (names of strings and numbers folded into their type). */
export function groups(s: Snapshot): Map<string, Group> {
    const f = s.snapshot.meta.node_fields;
    const width = f.length;
    const [iType, iName, iSize] = [f.indexOf('type'), f.indexOf('name'), f.indexOf('self_size')];
    const types = s.snapshot.meta.node_types[0];
    const out = new Map<string, Group>();
    for (let i = 0; i < s.nodes.length; i += width) {
        const type = types[s.nodes[i + iType]!] ?? '?';
        const name = type === 'string' || type === 'number' || type === 'concatenated string' || type === 'sliced string' ? '' : (s.strings[s.nodes[i + iName]!] ?? '?').slice(0, 60);
        const key = `${type}:${name}`;
        const g = out.get(key) ?? { count: 0, size: 0 };
        g.count++;
        g.size += s.nodes[i + iSize]!;
        out.set(key, g);
    }
    return out;
}

export function diff(a: Map<string, Group>, b: Map<string, Group>): { key: string; count: number; size: number; before: Group; after: Group }[] {
    const keys = new Set([...a.keys(), ...b.keys()]);
    const zero = { count: 0, size: 0 };
    return [...keys]
        .map(key => {
            const before = a.get(key) ?? zero;
            const after = b.get(key) ?? zero;
            return { key, count: after.count - before.count, size: after.size - before.size, before, after };
        })
        .sort((x, y) => Math.abs(y.size) - Math.abs(x.size));
}

if (import.meta.main) {
    const args = process.argv.slice(2);
    const top = Number(args[args.indexOf('--top') + 1]) || 30;
    const [before, after] = args.filter(a => !a.startsWith('--') && !/^\d+$/.test(a));
    if (!before || !after) {
        console.error('usage: bun markets/phase2/heap-diff.ts <before.heapsnapshot> <after.heapsnapshot> [--top N]');
        process.exit(2);
    }
    const [a, b] = [before, after].map(p => groups(JSON.parse(readFileSync(p, 'utf8')) as Snapshot));
    const total = (g: Map<string, Group>) => [...g.values()].reduce((t, x) => ({ count: t.count + x.count, size: t.size + x.size }), { count: 0, size: 0 });
    const [ta, tb] = [total(a!), total(b!)];
    const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;
    console.log(`total: ${ta.count} -> ${tb.count} objects, ${kb(ta.size)} -> ${kb(tb.size)}`);
    for (const d of diff(a!, b!).slice(0, top)) console.log(`${d.size >= 0 ? '+' : ''}${kb(d.size).padStart(10)}  ${d.count >= 0 ? '+' : ''}${String(d.count).padStart(8)}  ${d.key}  (${d.before.count} -> ${d.after.count})`);
}
