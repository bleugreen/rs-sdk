// The slot ledger: SCORED's inventory walked row by row through STEP-MANIFEST.md's
// "Inventory ledger" table, S00 to S27 in run order, failing on any row whose free slots
// do not cover its need.
//
//   bun speedrun/tools/slot-ledger.ts [TABLE.md] [--strict]
//
// TABLE.md defaults to docs/speedrun/STEP-MANIFEST.md, whose `## Inventory ledger` section holds
// the table; any other markdown file is searched whole (the fixtures under
// speedrun/tools/fixtures/slot-ledger/). The table is the only item list: nothing here knows an
// item. Its grammar is the one in the manifest section's own grammar block (agreed by rs/303 and
// rs/304, 2026-10-22):
//
//   | row | in | out | equip | needAtStart | source |
//   in      NAME xCOUNT [K] (note); ...      K: s stackable, u unstackable, n noted
//   out     NAME xCOUNT (REASON ...); NAME all (REASON ...)
//           REASON: drop, trade, swap, consume, hand-in, deposit; `swap` leaves in the same
//           trade as the row's `in`, so it frees its slots before the need check
//   equip   +NAME (inventory to worn); -NAME (worn to inventory)
//   needAtStart  free slots the row needs at its start, after its swap outs
//   source  citations labelled (m), (r) or (i)
//
// Within a row: (1) swap outs; (2) free >= needAtStart; (3) the other outs; (4) `in`, which for a
// hand-off (an H row) must fit the free slots as one trade; (5) equip; (6) used <= 28.
// Stackable and noted items take one slot per NAME whatever the count; unstackables one per item;
// worn items none. A COUNT of `?` is carried as unknown: an unstackable at `x?` takes no slots and
// leaves every row while it is held 'unknown' rather than 'pass', since its slots are not known.
//
// Exit: 0 when no row fails (unknown rows are listed; --strict fails them too), 1 when a row
// fails, 2 when the table is missing or does not parse.

import { readFileSync } from 'fs';
import { join } from 'path';

export const INVENTORY_SLOTS = 28;

export type Kind = 's' | 'u' | 'n';
export const REASONS = ['drop', 'trade', 'swap', 'consume', 'hand-in', 'deposit'] as const;
export type Reason = (typeof REASONS)[number];
export type Evidence = 'm' | 'r' | 'i';

export interface InEntry {
    name: string;
    count: number | null;
    kind: Kind;
}

export interface OutEntry {
    name: string;
    /** A number, 'all' (everything held under the name), or null for `?`. */
    count: number | 'all' | null;
    reason: Reason;
}

export interface EquipEntry {
    name: string;
    /** true: `+NAME`, inventory to worn; false: `-NAME`, worn to inventory. */
    on: boolean;
}

export interface LedgerRow {
    row: string;
    /** 1-based line in the source file. */
    line: number;
    in: InEntry[];
    out: OutEntry[];
    equip: EquipEntry[];
    /** null for `?`. */
    need: number | null;
    source: string;
    /** The labels the source cites. */
    evidence: Evidence[];
}

export interface ParseResult {
    rows: LedgerRow[];
    errors: string[];
}

export const HEADER = ['row', 'in', 'out', 'equip', 'needAtStart', 'source'] as const;
const SECTION = /^##\s+(?:\d+\.\s*)?Inventory ledger\s*$/;

// ------------------------------------------------------------------ parsing

/** Split on `sep` outside parentheses and backticks. */
function splitTop(text: string, sep: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let code = false;
    let cur = '';
    for (let i = 0; i < text.length; i++) {
        const c = text[i]!;
        if (c === '`') code = !code;
        else if (!code && c === '(') depth++;
        else if (!code && c === ')') depth = Math.max(0, depth - 1);
        if (!code && depth === 0 && text.startsWith(sep, i)) {
            out.push(cur);
            cur = '';
            i += sep.length - 1;
            continue;
        }
        cur += c;
    }
    out.push(cur);
    return out.map(s => s.trim()).filter(s => s.length > 0);
}

/** The cells of a markdown table line, `\|` unescaped. */
export function cells(line: string): string[] {
    const body = line.trim().replace(/^\|/, '').replace(/\|$/, '');
    const out: string[] = [];
    let cur = '';
    for (let i = 0; i < body.length; i++) {
        if (body[i] === '\\' && body[i + 1] === '|') {
            cur += '|';
            i++;
        } else if (body[i] === '|') {
            out.push(cur.trim());
            cur = '';
        } else cur += body[i];
    }
    out.push(cur.trim());
    return out;
}

const empty = (cell: string) => cell === '-' || cell === '';
const count = (text: string): number | null => (text === '?' ? null : Number(text));

export function parseIn(cell: string): InEntry[] {
    if (empty(cell)) return [];
    return splitTop(cell, '; ').map(e => {
        const m = e.match(/^(.+?) x(\d+|\?) \[([sun])\](?:\s*\(.*\))?$/);
        if (!m) throw new Error(`in entry "${e}": expected NAME xCOUNT [s|u|n]`);
        return { name: m[1]!, count: count(m[2]!), kind: m[3] as Kind };
    });
}

export function parseOut(cell: string): OutEntry[] {
    if (empty(cell)) return [];
    return splitTop(cell, '; ').map(e => {
        const m = e.match(/^(.+?) (?:x(\d+|\?)|(all)) \((.*)\)$/);
        if (!m) throw new Error(`out entry "${e}": expected NAME xCOUNT (REASON ...) or NAME all (REASON ...)`);
        const reason = m[4]!.trim().split(/[\s:;,]/)[0]!;
        if (!(REASONS as readonly string[]).includes(reason)) throw new Error(`out entry "${e}": reason "${reason}" is not one of ${REASONS.join(', ')}`);
        return { name: m[1]!, count: m[3] ? 'all' : count(m[2]!), reason: reason as Reason };
    });
}

export function parseEquip(cell: string): EquipEntry[] {
    if (empty(cell)) return [];
    return splitTop(cell, '; ').map(e => {
        const m = e.match(/^([+-])(\S.*)$/);
        if (!m) throw new Error(`equip entry "${e}": expected +NAME or -NAME`);
        return { name: m[2]!.trim(), on: m[1] === '+' };
    });
}

export function evidenceOf(source: string): Evidence[] {
    const found = new Set<Evidence>();
    for (const m of source.matchAll(/\((m|r|i)\)/g)) found.add(m[1] as Evidence);
    return (['m', 'r', 'i'] as const).filter(e => found.has(e));
}

/** A row resting only on inferred citations (or none). */
export const inferred = (row: Pick<LedgerRow, 'evidence'>) => !row.evidence.includes('m') && !row.evidence.includes('r');

/**
 * The ledger table in `markdown`: inside its `## Inventory ledger` section when the file has one,
 * else anywhere, outside fenced code (the grammar block may quote the header). The table runs from
 * the header line to the first line not starting with `|`.
 */
export function parseLedger(markdown: string): ParseResult {
    const lines = markdown.split('\n');
    let from = 0;
    let to = lines.length;
    const start = lines.findIndex(l => SECTION.test(l));
    if (start >= 0) {
        from = start + 1;
        const next = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
        if (next >= 0) to = next;
    }
    let fence = false;
    let header = -1;
    for (let i = from; i < to; i++) {
        if (/^\s*(```|~~~)/.test(lines[i]!)) fence = !fence;
        else if (!fence && lines[i]!.trim().startsWith('|') && cells(lines[i]!).join('|') === HEADER.join('|')) {
            header = i;
            break;
        }
    }
    if (header < 0) return { rows: [], errors: [`no table with the header | ${HEADER.join(' | ')} |${start >= 0 ? ' in the Inventory ledger section' : ''}`] };
    const rows: LedgerRow[] = [];
    const errors: string[] = [];
    for (let i = header + 1; i < to && lines[i]!.trim().startsWith('|'); i++) {
        const c = cells(lines[i]!);
        if (c.every(x => /^:?-+:?$/.test(x))) continue; // the separator
        const at = `line ${i + 1}${c[0] ? ` (${c[0]})` : ''}`;
        if (c.length !== HEADER.length) {
            errors.push(`${at}: ${c.length} cells, expected ${HEADER.length}`);
            continue;
        }
        const [row, inCell, outCell, equipCell, needCell, source] = c as [string, string, string, string, string, string];
        try {
            if (!/^(\d+|\?)$/.test(needCell)) throw new Error(`needAtStart "${needCell}": expected an integer or ?`);
            rows.push({ row, line: i + 1, in: parseIn(inCell), out: parseOut(outCell), equip: parseEquip(equipCell), need: count(needCell), source, evidence: evidenceOf(source) });
        } catch (e) {
            errors.push(`${at}: ${(e as Error).message}`);
        }
    }
    if (!rows.length && !errors.length) errors.push(`line ${header + 1}: the table has no rows`);
    return { rows, errors };
}

// ------------------------------------------------------------------ the walk

interface Held {
    kind: Kind;
    /** null: unknown. */
    count: number | null;
}

export type Verdict = 'pass' | 'unknown' | 'SHORT' | 'OVERFLOW' | 'ERROR';
export const FAILING: readonly Verdict[] = ['SHORT', 'OVERFLOW', 'ERROR'];

export interface LedgerEntry {
    row: LedgerRow;
    /** Free slots at the need check, after the swap outs. */
    free: number;
    need: number | null;
    /** Slots used once the row is done. */
    used: number;
    verdict: Verdict;
    /** Why the verdict is not a pass, and the row's `?` counts. */
    notes: string[];
    /** The inventory and the worn set once the row is done. */
    held: string;
    worn: string;
}

const isHandOff = (row: string) => /^H/.test(row);

class Pack {
    inv = new Map<string, Held>();
    worn = new Map<string, Held>();

    used(): number {
        let n = 0;
        for (const h of this.inv.values()) n += h.kind === 'u' ? (h.count ?? 0) : 1;
        return n;
    }

    /** Unstackables held at an unknown count: their slots are not known. */
    unknownSlots(): string[] {
        return [...this.inv].filter(([, h]) => h.kind === 'u' && h.count === null).map(([n]) => n);
    }

    /** Slots `e` would add to the inventory as it stands. */
    adds(e: InEntry): number {
        if (e.kind === 'u') return e.count ?? 0;
        return this.inv.has(e.name) ? 0 : 1;
    }

    add(map: Map<string, Held>, name: string, kind: Kind, n: number | null): void {
        const h = map.get(name);
        if (h && h.kind !== kind) throw new Error(`${name} is held as [${h.kind}], added as [${kind}]`);
        map.set(name, { kind, count: h ? (h.count === null || n === null ? null : h.count + n) : n });
    }

    take(map: Map<string, Held>, name: string, n: number | 'all' | null): Held {
        const h = map.get(name)!;
        if (n === 'all') {
            map.delete(name);
            return h;
        }
        if (n !== null && h.count !== null && n > h.count) throw new Error(`${name}: ${n} out, ${h.count} held`);
        const left = n === null || h.count === null ? null : h.count - n;
        if (left === 0) map.delete(name);
        else map.set(name, { ...h, count: left });
        return { kind: h.kind, count: n === null ? null : n };
    }

    out(e: OutEntry): void {
        if (this.inv.has(e.name)) this.take(this.inv, e.name, e.count);
        else if (this.worn.has(e.name)) this.take(this.worn, e.name, e.count);
        else throw new Error(`${e.name} out (${e.reason}) but neither held nor worn`);
    }

    /** Wear one unstackable, or a whole stack (the quiver). */
    equip(e: EquipEntry): void {
        const [from, to] = e.on ? [this.inv, this.worn] : [this.worn, this.inv];
        const h = from.get(e.name);
        if (!h) throw new Error(`${e.on ? '+' : '-'}${e.name}: not ${e.on ? 'held' : 'worn'}`);
        const moved = this.take(from, e.name, h.kind === 'u' ? 1 : 'all');
        this.add(to, e.name, moved.kind, moved.count);
    }

    static show(map: Map<string, Held>): string {
        return [...map].map(([n, h]) => `${n} x${h.count ?? '?'}${h.kind === 'n' ? ' (noted)' : ''}`).join(', ') || '-';
    }
}

/** Walk the rows in order from an empty pack and nothing worn. */
export function walk(rows: readonly LedgerRow[]): LedgerEntry[] {
    const pack = new Pack();
    return rows.map(row => {
        const notes: string[] = [];
        let verdict: Verdict = 'pass';
        const worse = (v: Verdict) => {
            const rank: Verdict[] = ['pass', 'unknown', 'SHORT', 'OVERFLOW', 'ERROR'];
            if (rank.indexOf(v) > rank.indexOf(verdict)) verdict = v;
        };
        const attempt = (what: () => void) => {
            try {
                what();
            } catch (e) {
                worse('ERROR');
                notes.push((e as Error).message);
            }
        };
        const unknownCounts = [...row.in.filter(e => e.count === null).map(e => `in ${e.name} x?`), ...row.out.filter(e => e.count === null).map(e => `out ${e.name} x?`)];

        // (1) swap outs, then (2) the need check.
        for (const e of row.out.filter(e => e.reason === 'swap')) attempt(() => pack.out(e));
        const free = INVENTORY_SLOTS - pack.used();
        if (free < 0) {
            worse('OVERFLOW');
            notes.push(`${-free} over before the row, carried from an earlier one`);
        } else if (row.need === null) {
            worse('unknown');
            notes.push('needAtStart ?');
        } else if (free < row.need) {
            worse('SHORT');
            notes.push(`${free} free against ${row.need}: ${row.need - free} short`);
        }
        // (3) the other outs, (4) in.
        for (const e of row.out.filter(e => e.reason !== 'swap')) attempt(() => pack.out(e));
        const freeForIn = INVENTORY_SLOTS - pack.used();
        const adds = row.in.reduce((a, e) => a + pack.adds(e), 0);
        if (isHandOff(row.row) && adds > 0 && freeForIn >= 0 && adds > freeForIn) {
            worse('SHORT');
            notes.push(`the trade adds ${adds} slots, ${freeForIn} free`);
        }
        if (isHandOff(row.row) && row.need !== null && adds > row.need) notes.push(`needAtStart ${row.need} understates the ${adds} slots its in adds`);
        for (const e of row.in) attempt(() => pack.add(pack.inv, e.name, e.kind, e.count));
        // (5) equip, (6) the 28.
        for (const e of row.equip) attempt(() => pack.equip(e));
        const used = pack.used();
        if (used > INVENTORY_SLOTS) {
            worse('OVERFLOW');
            notes.push(`${used} slots used after the row`);
        }
        const vague = pack.unknownSlots();
        if (vague.length) {
            worse('unknown');
            notes.push(`held at an unknown count: ${vague.join(', ')}`);
        }
        if (unknownCounts.length) notes.push(`? counts: ${unknownCounts.join(', ')}`);
        return { row, free, need: row.need, used, verdict, notes, held: Pack.show(pack.inv), worn: Pack.show(pack.worn) };
    });
}

// ------------------------------------------------------------------ report

export const evidenceLabel = (row: LedgerRow) => (inferred(row) ? 'INFERRED' : row.evidence.includes('m') ? 'm' : 'r');

export function render(entries: readonly LedgerEntry[]): string {
    const head = ['row', 'evidence', 'free', 'need', 'used', 'verdict', 'held after the row', 'worn', 'notes'];
    const body = entries.map(e => [e.row.row, evidenceLabel(e.row), String(e.free), e.need === null ? '?' : String(e.need), `${e.used}/${INVENTORY_SLOTS}`, e.verdict, e.held, e.worn, e.notes.join('; ')]);
    // Pad the short columns; the item lists run on.
    const fixed = 6;
    const width = head.slice(0, fixed).map((h, i) => Math.max(h.length, ...body.map(r => r[i]!.length)));
    const line = (r: string[]) => [...r.slice(0, fixed).map((c, i) => c.padEnd(width[i]!)), ...r.slice(fixed)].join(' | ');
    return [line(head), ...body.map(line)].join('\n');
}

export function summary(entries: readonly LedgerEntry[], strict = false): { failed: LedgerEntry[]; unknown: LedgerEntry[]; text: string; ok: boolean } {
    const failed = entries.filter(e => FAILING.includes(e.verdict));
    const unknown = entries.filter(e => e.verdict === 'unknown');
    const inferredRows = entries.filter(e => inferred(e.row));
    const lines = [
        `${entries.length} rows: ${entries.length - failed.length - unknown.length} pass, ${unknown.length} unknown, ${failed.length} fail; ${inferredRows.length} INFERRED`,
        ...(failed.length ? [`first failing row: ${failed[0]!.row.row}; a later row may only carry its excess`] : []),
        ...failed.map(e => `FAIL ${e.row.row} (line ${e.row.line}): ${e.verdict}: ${e.notes.join('; ')}`),
        ...unknown.map(e => `${strict ? 'FAIL' : 'unknown'} ${e.row.row} (line ${e.row.line}): ${e.notes.join('; ')}`),
    ];
    return { failed, unknown, text: lines.join('\n'), ok: failed.length === 0 && (!strict || unknown.length === 0) };
}

export const MANIFEST = join(import.meta.dir, '../../docs/speedrun/STEP-MANIFEST.md');

export function main(argv: string[]): number {
    const strict = argv.includes('--strict');
    const file = argv.find(a => !a.startsWith('--')) ?? MANIFEST;
    let text: string;
    try {
        text = readFileSync(file, 'utf8');
    } catch (e) {
        console.error(`slot-ledger: cannot read ${file}: ${(e as Error).message}`);
        return 2;
    }
    const { rows, errors } = parseLedger(text);
    if (errors.length) {
        console.error(`slot-ledger: ${file}: the table does not parse:\n${errors.map(e => `  ${e}`).join('\n')}`);
        return 2;
    }
    const entries = walk(rows);
    const s = summary(entries, strict);
    console.log(`slot ledger: ${file}\n`);
    console.log(render(entries));
    console.log(`\n${s.text}`);
    return s.ok ? 0 : 1;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
