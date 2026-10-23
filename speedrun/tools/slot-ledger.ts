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
//   in      ITEM xCOUNT [K] (note); ...      K: s stackable, u unstackable, n noted
//           ITEM to N [K] (note): a top-up to N counting what is held, pack and worn (the H10 form)
//   out     ITEM xCOUNT (REASON ...); ITEM all (REASON ...)
//   ITEM    NAME        the game name (lower-case; a potion's dose suffix optional), matched by name
//           NAME @ID    obj ID, always the UNNOTED one: matched by id, NAME only a label; with [n]
//                       the noted form, whose id runner/handoff.ts reads through the obj's cert
//           NAME(*)     any dose of the potion NAME (antipoison(*) all): each dose form held is
//                       a stack of its own, and an out takes from every one
//           <NAME>      a category placeholder (<bars>, <gem ring>), supplied by the module the
//                       row's source names; handoff.ts never trades it, the walk counts its slots
//           REASON: drop, trade, swap, consume, hand-in, deposit; `swap` leaves in the same
//           trade as the row's `in`, so it frees its slots before the need check; in a hand-off
//           only swap, trade and drop, a `drop` left on the tile before the trade (runner/handoff.ts),
//           never offered, so an obj the engine will not trade is always a drop
//   equip   +NAME (inventory to worn); -NAME (worn to inventory)
//   needAtStart  free slots the row needs at its start, after its swap outs
//   source  citations labelled (m), (r) or (i)
//
// Within a row: (1) swap outs; (2) free >= needAtStart; (3) the other outs; (4) `in`, which for a
// hand-off (an H row) must fit the free slots as one trade; (5) equip; (6) used <= 28.
// Stackable and noted items take one slot per stack whatever the count; unstackables one per item;
// worn items none. A stack is keyed by its id where an entry gives one (two noted stacks sharing a
// game name, @91 and @101, are two slots), else by its name. An entry finds what is held by its id,
// then by name among stacks that carry no id, so a table converted to ids one row at a time walks
// as it did by name; an unmarked NAME matching two id stacks is ambiguous unless it takes `all`. A COUNT of `?` is carried as unknown: an unstackable at `x?` takes no slots and
// leaves every row while it is held 'unknown' rather than 'pass', since its slots are not known.
// A top-up brings max(0, N - held) in, as runner/handoff.ts's trade asks: an unstackable takes that
// many slots, a stack or noted item one slot when the pack holds none of it and some comes, else none.
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

/** The item an entry names: one of the four ITEM forms. */
export interface ItemRef {
    /** The game name, or with `id` a label; without the `(*)` or `<>` marks. */
    name: string;
    /** `NAME @ID`: the unnoted obj id. */
    id?: number;
    /** `NAME(*)`: any dose of the potion NAME. */
    family?: true;
    /** `<NAME>`: a category placeholder, left to the module the row's source names. */
    placeholder?: true;
}

export interface InEntry extends ItemRef {
    /** COUNT, or a top-up's N; null for `?`. */
    count: number | null;
    kind: Kind;
    /** `NAME to N [K]`: bring the held count (pack and worn) up to `count`, not add `count`. */
    topUp?: boolean;
}

export interface OutEntry extends ItemRef {
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

/** An entry's ITEM: `NAME`, `NAME @ID`, `NAME(*)` or `<NAME>`. */
export function parseItem(text: string): ItemRef {
    let m = text.match(/^<([^<>@]+)>$/);
    if (m) return { name: m[1]!.trim(), placeholder: true };
    m = text.match(/^([^<>@]+?)\s*\(\*\)$/);
    if (m) return { name: m[1]!, family: true };
    m = text.match(/^([^<>@]+?) @(\d+)$/);
    if (m) return { name: m[1]!, id: Number(m[2]) };
    if (/[<>@]|\(\*\)/.test(text)) throw new Error(`item "${text}": expected NAME, NAME @ID, NAME(*) or <NAME>`);
    return { name: text };
}

/** An ITEM as the ledger writes it. */
export const itemLabel = (e: ItemRef) => (e.placeholder ? `<${e.name}>` : e.family ? `${e.name}(*)` : e.id !== undefined ? `${e.name} @${e.id}` : e.name);

export function parseIn(cell: string): InEntry[] {
    if (empty(cell)) return [];
    return splitTop(cell, '; ').map(e => {
        const m = e.match(/^(.+?) (?:x(\d+|\?)|to (\d+)) \[([sun])\](?:\s*\(.*\))?$/);
        if (!m) throw new Error(`in entry "${e}": expected NAME xCOUNT [s|u|n] or NAME to N [s|u|n] (NAME, NAME @ID, NAME(*) or <NAME>)`);
        const item = parseItem(m[1]!);
        if (m[3] !== undefined) return { ...item, count: Number(m[3]), kind: m[4] as Kind, topUp: true };
        return { ...item, count: count(m[2]!), kind: m[4] as Kind };
    });
}

export function parseOut(cell: string): OutEntry[] {
    if (empty(cell)) return [];
    return splitTop(cell, '; ').map(e => {
        const m = e.match(/^(.+?) (?:x(\d+|\?)|(all)) \((.*)\)$/);
        if (!m) throw new Error(`out entry "${e}": expected NAME xCOUNT (REASON ...) or NAME all (REASON ...)`);
        const reason = m[4]!.trim().split(/[\s:;,]/)[0]!;
        if (!(REASONS as readonly string[]).includes(reason)) throw new Error(`out entry "${e}": reason "${reason}" is not one of ${REASONS.join(', ')}`);
        return { ...parseItem(m[1]!), count: m[3] ? 'all' : count(m[2]!), reason: reason as Reason };
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

/** A stack held, or worn: one slot when stackable or noted, one per item when not. */
export interface Held extends ItemRef {
    kind: Kind;
    /** null: unknown. */
    count: number | null;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `name` is a dose form of the potion `family` (or the family's own name). */
export const isDoseOf = (family: string, name: string) => new RegExp(`^${escapeRe(family)}(?:\\(\\d\\))?$`).test(name);

/** How a stack shows in the report: its name, `(*)` for a family stack. */
const shown = (h: Held) => (h.family ? `${h.name}(*)` : h.name);

/**
 * The stacks in `list` that `e` names: a family every dose form of it; an id the stack of that id,
 * else a stack of its name that carries no id (one an unconverted row brought in); a name every
 * stack of that name.
 */
function named(list: readonly Held[], e: ItemRef): Held[] {
    if (e.family) return list.filter(h => isDoseOf(e.name, h.name));
    if (e.id !== undefined) {
        const byId = list.filter(h => h.id === e.id);
        return byId.length ? byId : list.filter(h => h.id === undefined && !h.family && h.name === e.name);
    }
    return list.filter(h => !h.family && h.name === e.name);
}

/** The one stack `e` names in `list`, if any; refused when it names more than one. */
function one(list: readonly Held[], e: ItemRef): Held | undefined {
    const found = named(list, e);
    if (found.length > 1) throw new Error(`${itemLabel(e)} names ${found.length} stacks (${found.map(h => `${shown(h)}${h.id !== undefined ? ` @${h.id}` : ''}`).join(', ')}); name it by id`);
    return found[0];
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
    /** The same, as stacks (copies): what tools/rune-pins.ts reads the runes and the worn staff from. */
    stacks: { inv: readonly Held[]; worn: readonly Held[] };
}

const isHandOff = (row: string) => /^H/.test(row);

/** The item part of a stack: what an add merges on. */
const refOf = (e: ItemRef): ItemRef => ({ name: e.name, ...(e.id !== undefined ? { id: e.id } : {}), ...(e.family ? { family: true as const } : {}), ...(e.placeholder ? { placeholder: true as const } : {}) });

class Pack {
    inv: Held[] = [];
    worn: Held[] = [];

    used(): number {
        let n = 0;
        for (const h of this.inv) n += h.kind === 'u' ? (h.count ?? 0) : 1;
        return n;
    }

    /** Unstackables held at an unknown count: their slots are not known. */
    unknownSlots(): string[] {
        return this.inv.filter(h => h.kind === 'u' && h.count === null).map(shown);
    }

    /** The count of `e` held in the pack and worn; null when any of it is unknown. */
    held(e: ItemRef): number | null {
        let n: number | null = 0;
        for (const h of [...named(this.inv, e), ...named(this.worn, e)]) n = n === null || h.count === null ? null : n + h.count;
        return n;
    }

    /** How many of `e` arrive: its COUNT, or for a top-up what is lacking (null when unknown). */
    arriving(e: InEntry): number | null {
        if (!e.topUp) return e.count;
        const h = this.held(e);
        return h === null ? null : Math.max(0, e.count! - h);
    }

    /** The stack an `in` of `e` lands on: a family entry its own family stack, else the one `e` names. */
    private stackFor(list: readonly Held[], e: ItemRef): Held | undefined {
        return e.family ? list.find(h => h.family && h.name === e.name) : one(list, e);
    }

    /** Slots `e` would add to the inventory as it stands. */
    adds(e: InEntry): number {
        const n = this.arriving(e);
        if (e.kind === 'u') return n ?? 0;
        if (e.topUp && n === 0) return 0;
        return this.stackFor(this.inv, e) ? 0 : 1;
    }

    add(list: Held[], e: ItemRef, kind: Kind, n: number | null): void {
        const h = this.stackFor(list, e);
        if (!h) {
            list.push({ ...refOf(e), kind, count: n });
            return;
        }
        if (h.kind !== kind) throw new Error(`${shown(h)} is held as [${h.kind}], added as [${kind}]`);
        h.count = h.count === null || n === null ? null : h.count + n;
        // A stack an unconverted row brought in by name learns its id.
        if (e.id !== undefined) h.id = e.id;
    }

    take(list: Held[], h: Held, n: number | 'all' | null): Held {
        if (n === 'all') {
            list.splice(list.indexOf(h), 1);
            return h;
        }
        if (n !== null && h.count !== null && n > h.count) throw new Error(`${shown(h)}: ${n} out, ${h.count} held`);
        const left = n === null || h.count === null ? null : h.count - n;
        if (left === 0) list.splice(list.indexOf(h), 1);
        else h.count = left;
        return { ...refOf(h), kind: h.kind, count: n === null ? null : n };
    }

    out(e: OutEntry): void {
        const inv = named(this.inv, e);
        const where = inv.length ? this.inv : this.worn;
        const found = inv.length ? inv : named(this.worn, e);
        if (!found.length) throw new Error(`${itemLabel(e)} out (${e.reason}) but neither held nor worn`);
        if (e.count === 'all') {
            // Everything held under the item: every dose form of a family, every stack of a name.
            for (const list of [this.inv, this.worn]) for (const h of named(list, e)) this.take(list, h, 'all');
            return;
        }
        if (!e.family) {
            this.take(where, one(where, e)!, e.count);
            return;
        }
        // A family's count comes out of its dose forms in turn.
        const total = this.held(e);
        if (e.count === null || total === null) {
            this.take(where, found[0]!, e.count);
            return;
        }
        if (e.count > total) throw new Error(`${itemLabel(e)}: ${e.count} out, ${total} held`);
        let left = e.count;
        for (const list of [this.inv, this.worn]) {
            for (const h of named(list, e)) {
                const n = Math.min(left, h.count!);
                if (n > 0) this.take(list, h, n);
                left -= n;
            }
        }
    }

    /** Wear one unstackable, or a whole stack (the quiver). */
    equip(e: EquipEntry): void {
        const [from, to] = e.on ? [this.inv, this.worn] : [this.worn, this.inv];
        const h = one(from, { name: e.name });
        if (!h) throw new Error(`${e.on ? '+' : '-'}${e.name}: not ${e.on ? 'held' : 'worn'}`);
        const moved = this.take(from, h, h.kind === 'u' ? 1 : 'all');
        this.add(to, moved, moved.kind, moved.count);
    }

    static show(list: readonly Held[]): string {
        return list.map(h => `${shown(h)} x${h.count ?? '?'}${h.kind === 'n' ? ' (noted)' : ''}`).join(', ') || '-';
    }
}

/** Walk the rows in order from an empty pack and nothing worn. */
export function walk(rows: readonly LedgerRow[]): LedgerEntry[] {
    const pack = new Pack();
    return rows.map(row => {
        const notes: string[] = [];
        let verdict: Verdict = 'pass';
        const worse = (v: Verdict) => {
            // A short row is the cause; the overflow it leaves is its consequence.
            const rank: Verdict[] = ['pass', 'unknown', 'OVERFLOW', 'SHORT', 'ERROR'];
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
        const unknownCounts = [...row.in.filter(e => e.count === null).map(e => `in ${itemLabel(e)} x?`), ...row.out.filter(e => e.count === null).map(e => `out ${itemLabel(e)} x?`)];
        for (const e of row.in.filter(e => e.topUp && pack.held(e) === null)) unknownCounts.push(`in ${itemLabel(e)} to ${e.count}: held at an unknown count`);

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
        let adds = 0;
        attempt(() => (adds = row.in.reduce((a, e) => a + pack.adds(e), 0)));
        if (isHandOff(row.row) && adds > 0 && freeForIn >= 0 && adds > freeForIn) {
            worse('SHORT');
            notes.push(`the trade adds ${adds} slots, ${freeForIn} free`);
        }
        if (isHandOff(row.row) && row.need !== null && adds > row.need) notes.push(`needAtStart ${row.need} understates the ${adds} slots its in adds`);
        for (const e of row.in) {
            const n = pack.arriving(e);
            if (e.topUp && n === 0) continue;
            attempt(() => pack.add(pack.inv, e, e.kind, n));
        }
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
        const stacks = { inv: pack.inv.map(h => ({ ...h })), worn: pack.worn.map(h => ({ ...h })) };
        return { row, free, need: row.need, used, verdict, notes, held: Pack.show(pack.inv), worn: Pack.show(pack.worn), stacks };
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
