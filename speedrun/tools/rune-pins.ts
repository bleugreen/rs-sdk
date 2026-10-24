// Rune pins: every consumer's rune use held to STEP-MANIFEST.md's inventory ledger. The slot ledger
// (slot-ledger.ts) trusts each row's out lines, so a step that casts more than its row says passes
// there and runs short later (S11b cast 5 law where its row took 3, and T11-12 found none).
//
//   bun speedrun/tools/rune-pins.ts [TABLE.md]
//
// Consumers:
//   - every leg of runner/legs.ts (the body-altar catalogue, which the ledger's T20-21 row is): its
//     runes are lib/travel.ts hopNeeds over its hops, less the element of any staff the ledger has
//     worn at the leg's row. A leg's row is its own id, or `<step> legs` for a leg inside a step
//     (L24a-c), or none for a leg that changes nothing.
//   - every step module (speedrun/quests, speedrun/skills) that exports RUNE_USE, the shape agreed
//     with rs/185 (lib/travel.ts RuneUseTable): per segment letter of its stepId, or per ledger row
//     id. Beside it RUNE_NEED (what a segment's precondition wants held, default its RUNE_USE),
//     RUNE_STAFF (the worn staff its counts leave out) and RUNE_USE_FALLBACK (reported only).
//     A key that is a ledger row id is that row; a letter falls on the step's last lettered sub-row
//     at or before it (`S15 Y` takes Y onward), else the step's main row.
//
// Checks:
//   - pin: a step's (or a leg row's) declared use equals the rune `consume` outs of its rows: the
//     step's main row and sub-rows, less `<step> legs`, which is the legs'.
//   - held: the ledger walked by slot-ledger's own walk with each pinned row's rune consumes
//     replaced by the declared use; at each part, in letter order, the runes held cover its need
//     less what the row's earlier parts used.
//   - staff: a RUNE_STAFF not in the ledger's worn set at a row its use falls on.
// Rows that consume runes and no consumer pins, modules without RUNE_USE, `?` counts and stale
// pending entries are listed, not failed. PENDING lists known findings awaiting a ledger fold-in:
// each matches one exact finding, so the check is required again the moment the ledger changes.
//
// Exit: 0 when nothing fails, 1 when a finding fails, 2 when the table is missing or does not parse.

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { objPack } from '../lib/obj-pack';
import { hopNeeds, runeName, staffElement, type Hop, type Rune, type RuneName, type RuneUseTable } from '../lib/travel';
import { legsFor } from '../runner/legs';
import { MANIFEST, parseLedger, walk, type Held, type ItemRef, type LedgerRow } from './slot-ledger';

// ------------------------------------------------------------------ rune names

export const RUNES_OBJ = join(import.meta.dir, '../../server/content/scripts/skill_magic/configs/runes.obj');

let runeTable: { label: Map<string, string>; byName: Map<string, RuneName> } | null = null;

/** runes.obj's `[debugname]` sections and their `name=`: the debug name to the ledger's (lower-case) name. */
function runeNames() {
    if (!runeTable) {
        const label = new Map<string, string>();
        const byName = new Map<string, RuneName>();
        let section: string | null = null;
        for (const line of readFileSync(RUNES_OBJ, 'utf8').split('\n')) {
            const s = line.match(/^\[(\w+)\]\s*$/);
            if (s) section = s[1]!;
            const n = line.match(/^name=(.+)$/);
            if (section && n) {
                label.set(section, n[1]!.trim().toLowerCase());
                byName.set(n[1]!.trim().toLowerCase(), section as RuneName);
                section = null;
            }
        }
        runeTable = { label, byName };
    }
    return runeTable;
}

export const isRune = (key: string): key is RuneName => runeNames().label.has(key);
/** The ledger's name for a rune: `law rune`. */
export const runeLabel = (r: RuneName): string => runeNames().label.get(r) ?? r;

/** The rune a ledger entry names: by obj id through obj.pack where it has one, else by name; null for anything else. */
export function runeOf(e: ItemRef): RuneName | null {
    if (e.family || e.placeholder) return null;
    if (e.id !== undefined) {
        const debug = objPack().names.get(e.id);
        return debug !== undefined && isRune(debug) ? debug : null;
    }
    return runeNames().byName.get(e.name.toLowerCase()) ?? null;
}

// ------------------------------------------------------------------ counts

export type Counts = Partial<Record<RuneName, number>>;

const entriesOf = (c: Counts) => (Object.entries(c) as [RuneName, number][]).filter(([, n]) => n !== 0);
const add = (a: Counts, b: Counts): Counts => {
    const out: Counts = { ...a };
    for (const [r, n] of entriesOf(b)) out[r] = (out[r] ?? 0) + n;
    return out;
};
export const fmtCounts = (c: Counts) => entriesOf(c).map(([r, n]) => `${runeLabel(r)} ${n}`).join(', ') || 'none';

/** Runes in a list of stacks; a rune held at an unknown count is in `unknown`. */
function runesIn(stacks: readonly Held[]): { counts: Counts; unknown: Set<RuneName> } {
    const counts: Counts = {};
    const unknown = new Set<RuneName>();
    for (const h of stacks) {
        const r = runeOf(h);
        if (!r) continue;
        if (h.count === null) unknown.add(r);
        else counts[r] = (counts[r] ?? 0) + h.count;
    }
    return { counts, unknown };
}

/** A row's rune `consume` outs: `?` in `unknown`, `all` as what was held before the row. */
function ledgerUse(row: LedgerRow, before: readonly Held[]): { use: Counts; unknown: Set<RuneName> } {
    const use: Counts = {};
    const unknown = new Set<RuneName>();
    const held = runesIn(before);
    for (const e of row.out) {
        const r = e.reason === 'consume' ? runeOf(e) : null;
        if (!r) continue;
        if (e.count === null || (e.count === 'all' && held.unknown.has(r))) unknown.add(r);
        else use[r] = (use[r] ?? 0) + (e.count === 'all' ? (held.counts[r] ?? 0) : e.count);
    }
    return { use, unknown };
}

const isRuneConsume = (e: LedgerRow['out'][number]) => e.reason === 'consume' && runeOf(e) !== null;

/** A leg's runes: lib/travel.ts hopNeeds over its hops, less the element of any staff in `worn`. */
export function legUse(hops: readonly Hop[], worn: readonly { name: string }[]): Counts {
    const supplied = new Set(worn.map(h => staffElement(h.name)).filter((e): e is Rune => e !== null));
    const use: Counts = {};
    for (const [r, n] of Object.entries(hopNeeds(hops).runes) as [Rune, number][]) if (n && !supplied.has(r)) use[runeName(r)] = n;
    return use;
}

// ------------------------------------------------------------------ consumers

/** What the check needs of a leg (runner/legs.ts LegDef). */
export interface LegLike {
    id: string;
    after: string;
    before: string;
    hops: readonly Hop[];
}

/** A step module's exports, as read (unvalidated). */
export interface ModuleDecl {
    /** `quests/grand-tree.ts`. */
    file: string;
    stepId?: unknown;
    LETTERS?: unknown;
    RUNE_USE?: unknown;
    RUNE_NEED?: unknown;
    RUNE_STAFF?: unknown;
    RUNE_USE_FALLBACK?: unknown;
}

/** A module's figures held here until the module exports them itself; then the stand-in is stale. */
export interface StandIn {
    file: string;
    stepId: string;
    RUNE_USE: RuneUseTable;
    RUNE_NEED?: RuneUseTable;
    RUNE_STAFF?: string;
    source: string;
}

/** Modules' figures held here until they export them. None now: the Grand Tree's exports its own. */
export const STAND_INS: readonly StandIn[] = [];

export type FindingKind = 'mismatch' | 'short' | 'staff' | 'no-row' | 'bad-export' | 'unknown';
export const FAILING_KINDS: readonly FindingKind[] = ['mismatch', 'short', 'staff', 'no-row', 'bad-export'];

/** A known finding awaiting a ledger change: `declared` against `ledger` (for `short`, the need against what is held). */
export interface Pending {
    kind: 'mismatch' | 'short';
    row: string;
    rune: RuneName;
    declared: number;
    ledger: number;
    why: string;
}

export interface Finding {
    kind: FindingKind;
    /** The pin's group (a step, or a leg's row) or the row checked. */
    row: string;
    rune?: RuneName;
    declared?: number;
    ledger?: number;
    /** The consumer(s). */
    who: string;
    text: string;
    pending?: Pending;
}

/** A share of a consumer's use on one ledger row. */
interface Part {
    key: string;
    row: string;
    use: Counts;
    need: Counts;
    /** Sort order within the row. */
    order: number;
    /** The segment, for a module key that is not the row's own id. */
    segment?: string;
}

interface Consumer {
    who: string;
    /** The pin's group: a step id, or a leg's row. */
    group: string;
    parts: Part[];
    staff?: string;
}

const rowStep = (row: string) => row.split(' ')[0]!;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The ledger row a leg's runes come off: its own, `<step> legs` for a leg inside a step, or none. */
export function legRow(leg: Pick<LegLike, 'id' | 'after' | 'before'>, rowIds: ReadonlySet<string>): string | null {
    if (rowIds.has(leg.id)) return leg.id;
    const step = (s: string) => s.match(/^(S\d+[a-z]?)\b/)?.[1];
    const a = step(leg.after);
    if (a && a === step(leg.before) && rowIds.has(`${a} legs`)) return `${a} legs`;
    return null;
}

/** A declared table checked against the agreed shape: every key a record of rune debug names to whole counts. */
function checkTable(v: unknown, what: string): { table?: RuneUseTable; error?: string } {
    if (v === undefined) return {};
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return { error: `${what} is not a record of segments` };
    for (const [key, use] of Object.entries(v)) {
        if (typeof use !== 'object' || use === null || Array.isArray(use)) return { error: `${what}.${key} is not a record of runes (the agreed shape is per segment: { B: { lawrune: 2 } })` };
        for (const [r, n] of Object.entries(use)) {
            if (!isRune(r)) return { error: `${what}.${key}.${r} is not a rune debug name (runes.obj)` };
            if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) return { error: `${what}.${key}.${r} is ${String(n)}, not a whole count` };
        }
    }
    return { table: v as RuneUseTable };
}

/** The row a module's key falls on (the header's rule), or null. */
function partRow(key: string, stepId: string | undefined, rowIds: ReadonlySet<string>, cmp: (a: string, b: string) => number): string | null {
    if (rowIds.has(key)) return key;
    if (!stepId) return null;
    const sub = new RegExp(`^${escapeRe(stepId)} ([A-Z]\\d*)$`);
    let row = rowIds.has(stepId) ? stepId : null;
    let at: string | null = null;
    for (const id of rowIds) {
        const l = id.match(sub)?.[1];
        if (l && cmp(l, key) <= 0 && (at === null || cmp(l, at) > 0)) {
            row = id;
            at = l;
        }
    }
    return row;
}

export interface Report {
    findings: Finding[];
    /** Findings that fail: of a failing kind and not pending. */
    failing: Finding[];
    /** Modules with a stepId and no RUNE_USE (or stand-in), with their step's ledger use. */
    missing: string[];
    /** Rows that consume runes and nothing pins. */
    unclaimed: string[];
    /** Pending entries and stand-ins that match nothing: delete them. */
    stale: string[];
    /** Informational lines: stand-ins in use, fallbacks. */
    notes: string[];
    text: string;
}

export interface Input {
    legs: readonly LegLike[];
    modules: readonly ModuleDecl[];
    standIns?: readonly StandIn[];
}

export function analyze(rows: readonly LedgerRow[], input: Input, pending: readonly Pending[] = []): Report {
    const findings: Finding[] = [];
    const notes: string[] = [];
    const stale: string[] = [];
    const missing: string[] = [];
    const rowIds = new Set(rows.map(r => r.row));
    const index = new Map(rows.map((r, i) => [r.row, i]));
    const plain = walk(rows);
    const before = (row: string) => {
        const i = index.get(row)!;
        return i > 0 ? plain[i - 1]!.stacks : { inv: [], worn: [] };
    };
    const groupRows = (group: string): string[] => (rowIds.has(group) && !/^S/.test(group)) || / legs$/.test(group) ? [group] : rows.map(r => r.row).filter(r => rowStep(r) === group && r !== `${group} legs`);

    // -------- consumers
    const consumers: Consumer[] = [];
    let order = 0;
    for (const leg of input.legs) {
        const row = legRow(leg, rowIds);
        const use = legUse(leg.hops, row ? before(row).worn : []);
        if (!row) {
            if (entriesOf(use).length) findings.push({ kind: 'no-row', row: leg.id, who: `leg ${leg.id}`, text: `leg ${leg.id} casts (${fmtCounts(use)}) but the ledger has no row for it` });
            continue;
        }
        consumers.push({ who: `leg ${leg.id}`, group: row, parts: [{ key: leg.id, row, use, need: use, order: order++ }] });
    }

    const standIns = input.standIns ?? [];
    const exported = new Set(input.modules.filter(m => m.RUNE_USE !== undefined).map(m => m.file));
    for (const s of standIns) if (exported.has(s.file)) stale.push(`stand-in for ${s.file} (${s.stepId}): the module exports RUNE_USE now, so delete it from STAND_INS`);
    const decls: ModuleDecl[] = [
        ...input.modules.map(m => {
            const s = standIns.find(x => x.file === m.file);
            if (m.RUNE_USE !== undefined || !s) return m;
            notes.push(`stand-in for ${s.file} (${s.stepId}), until it exports RUNE_USE: ${s.source}`);
            return { ...m, stepId: m.stepId ?? s.stepId, RUNE_USE: s.RUNE_USE, RUNE_NEED: s.RUNE_NEED, RUNE_STAFF: s.RUNE_STAFF };
        }),
        ...standIns.filter(s => !input.modules.some(m => m.file === s.file)).map(s => {
            notes.push(`stand-in for ${s.file} (${s.stepId}), the module not in this tree: ${s.source}`);
            return { file: s.file, stepId: s.stepId, RUNE_USE: s.RUNE_USE, RUNE_NEED: s.RUNE_NEED, RUNE_STAFF: s.RUNE_STAFF };
        }),
    ];
    const incomplete = new Set<string>();
    for (const m of decls) {
        const stepId = typeof m.stepId === 'string' ? m.stepId : undefined;
        const who = `${stepId ? `${stepId} ` : ''}${m.file}`;
        if (m.RUNE_USE === undefined) {
            if (!stepId) continue;
            incomplete.add(stepId);
            const rowsOf = groupRows(stepId);
            const use = rowsOf.reduce((a, r) => add(a, ledgerUse(rows[index.get(r)!]!, before(r).inv).use), {} as Counts);
            missing.push(`${m.file} (${stepId}): no RUNE_USE; the ledger's ${stepId} rows consume ${rowsOf.length ? fmtCounts(use) : 'nothing (no row)'}`);
            continue;
        }
        const use = checkTable(m.RUNE_USE, 'RUNE_USE');
        const need = checkTable(m.RUNE_NEED, 'RUNE_NEED');
        const fallback = checkTable(m.RUNE_USE_FALLBACK, 'RUNE_USE_FALLBACK');
        const staff = m.RUNE_STAFF;
        const error = use.error ?? need.error ?? fallback.error ?? (staff !== undefined && typeof staff !== 'string' ? 'RUNE_STAFF is not a string' : undefined);
        if (error) {
            findings.push({ kind: 'bad-export', row: stepId ?? m.file, who, text: `${who}: ${error}` });
            if (stepId) incomplete.add(stepId);
            continue;
        }
        const letters = Array.isArray(m.LETTERS) ? (m.LETTERS as string[]) : null;
        const rank = (k: string) => (letters ? letters.indexOf(k) : -1);
        const cmp = (a: string, b: string) => (rank(a) >= 0 && rank(b) >= 0 ? rank(a) - rank(b) : a.localeCompare(b));
        const keys = [...new Set([...Object.keys(use.table!), ...Object.keys(need.table ?? {})])].sort(cmp);
        const byGroup = new Map<string, Part[]>();
        for (const key of keys) {
            const row = partRow(key, stepId, rowIds, cmp);
            const u: Counts = { ...(use.table![key] ?? {}) };
            if (!row) {
                findings.push({ kind: 'no-row', row: key, who, text: `${who}: key ${key} falls on no ledger row${stepId ? ` (no ${stepId} row)` : ''}` });
                continue;
            }
            const group = rowStep(row);
            if (!byGroup.has(group)) byGroup.set(group, []);
            byGroup.get(group)!.push({ key, row, use: u, need: { ...(need.table?.[key] ?? u) }, order: order++, ...(key !== row ? { segment: key } : {}) });
        }
        for (const [group, parts] of byGroup) consumers.push({ who, group, parts, ...(typeof staff === 'string' ? { staff } : {}) });
        if (fallback.table) {
            const total = Object.values(fallback.table).reduce((a, u) => add(a, u), {} as Counts);
            notes.push(`${who}: RUNE_USE_FALLBACK totals ${fmtCounts(total)} (reported, not pinned)`);
        }
    }

    // -------- pins
    const groups = new Map<string, Consumer[]>();
    for (const c of consumers) {
        if (incomplete.has(c.group)) continue;
        if (!groups.has(c.group)) groups.set(c.group, []);
        groups.get(c.group)!.push(c);
    }
    for (const s of incomplete) for (const c of consumers.filter(c => c.group === s)) notes.push(`${c.who}: not pinned, other modules of ${s} export no RUNE_USE`);
    const pinnedRows = new Set<string>();
    for (const [group, cs] of groups) {
        const rowsOf = groupRows(group);
        rowsOf.forEach(r => pinnedRows.add(r));
        const who = cs.map(c => c.who).join(' + ');
        const declared = cs.flatMap(c => c.parts).reduce((a, p) => add(a, p.use), {} as Counts);
        let ledger: Counts = {};
        const unknown = new Set<RuneName>();
        for (const r of rowsOf) {
            const l = ledgerUse(rows[index.get(r)!]!, before(r).inv);
            ledger = add(ledger, l.use);
            l.unknown.forEach(x => unknown.add(x));
        }
        for (const rune of new Set([...entriesOf(declared), ...entriesOf(ledger)].map(([r]) => r).concat([...unknown]))) {
            const d = declared[rune] ?? 0;
            if (unknown.has(rune)) {
                findings.push({ kind: 'unknown', row: group, rune, declared: d, who, text: `${group}: ${who} declares ${runeLabel(rune)} ${d}; the ledger's count is ?` });
                continue;
            }
            const l = ledger[rune] ?? 0;
            if (d !== l) findings.push({ kind: 'mismatch', row: group, rune, declared: d, ledger: l, who, text: `${group}: ${who} uses ${runeLabel(rune)} ${d}; the ledger's ${rowsOf.join(', ')} take ${l}` });
        }
    }

    // -------- held: the ledger walked with the pinned rows' rune consumes replaced by the declared use
    const pinnedParts = [...groups.values()].flat().flatMap(c => c.parts.map(p => ({ ...p, who: c.who, staff: c.staff })));
    const partsOn = (row: string) => pinnedParts.filter(p => p.row === row).sort((a, b) => a.order - b.order);
    const substituted = rows.map(r => {
        if (!pinnedRows.has(r.row)) return r;
        const use = partsOn(r.row).reduce((a, p) => add(a, p.use), {} as Counts);
        return { ...r, out: [...r.out.filter(e => !isRuneConsume(e)), ...entriesOf(use).map(([rune, n]) => ({ name: runeLabel(rune), count: n, reason: 'consume' as const }))] };
    });
    const walked = walk(substituted);
    for (const r of rows) {
        const parts = partsOn(r.row);
        if (!parts.length) continue;
        const i = index.get(r.row)!;
        const held = runesIn(i > 0 ? walked[i - 1]!.stacks.inv : []);
        const worn = (i > 0 ? walked[i - 1]!.stacks.worn : []).map(h => h.name.toLowerCase());
        let avail: Counts = { ...held.counts };
        const unworn = new Set<string>();
        for (const p of parts) {
            for (const [rune, n] of entriesOf(p.need)) {
                if (held.unknown.has(rune)) continue;
                const have = avail[rune] ?? 0;
                if (have < n) findings.push({ kind: 'short', row: r.row, rune, declared: n, ledger: have, who: p.who, text: `${r.row}: ${p.who}${p.segment ? ` at ${p.segment}` : ''} needs ${runeLabel(rune)} ${n} held, has ${have} with each pinned consumer's own use walked` });
            }
            avail = add(avail, Object.fromEntries(entriesOf(p.use).map(([k, n]) => [k, -n])) as Counts);
            if (p.staff && entriesOf(p.need).length && !worn.includes(p.staff.toLowerCase()) && !unworn.has(p.who)) {
                unworn.add(p.who);
                findings.push({ kind: 'staff', row: r.row, who: p.who, text: `${r.row}: ${p.who} leaves out the ${p.staff}'s element, but the ledger has ${worn.length ? worn.join(', ') : 'nothing'} worn there` });
            }
        }
    }

    // -------- what nothing pins
    const unclaimed: string[] = [];
    for (const r of rows) {
        if (pinnedRows.has(r.row)) continue;
        const l = ledgerUse(r, before(r.row).inv);
        const counted = [...entriesOf(l.use).map(([x, n]) => `${runeLabel(x)} ${n}`), ...[...l.unknown].map(x => `${runeLabel(x)} ?`)];
        if (counted.length) unclaimed.push(`${r.row}: consumes ${counted.join(', ')}, pinned by nothing`);
    }

    // -------- pending
    const used = new Set<Pending>();
    for (const f of findings) {
        const p = pending.find(p => p.kind === f.kind && p.row === f.row && p.rune === f.rune && p.declared === f.declared && p.ledger === f.ledger);
        if (p) {
            f.pending = p;
            used.add(p);
        }
    }
    for (const p of pending) if (!used.has(p)) stale.push(`pending ${p.kind} ${p.row} ${runeLabel(p.rune)} ${p.declared} against ${p.ledger} matches nothing now (${p.why}): delete it`);

    const failing = findings.filter(f => FAILING_KINDS.includes(f.kind) && !f.pending);
    const text = [
        `rune pins: ${consumers.length} consumers on ${pinnedRows.size} rows; ${failing.length} failing, ${findings.filter(f => f.pending).length} pending, ${missing.length} modules without RUNE_USE, ${unclaimed.length} rows unpinned`,
        ...failing.map(f => `FAIL ${f.kind}: ${f.text}`),
        ...findings.filter(f => f.pending).map(f => `pending ${f.kind}: ${f.text} (${f.pending!.why})`),
        ...findings.filter(f => f.kind === 'unknown').map(f => `unknown: ${f.text}`),
        ...missing.map(m => `missing: ${m}`),
        ...unclaimed.map(u => `unpinned: ${u}`),
        ...stale.map(s => `stale: ${s}`),
        ...notes.map(n => `note: ${n}`),
    ].join('\n');
    return { findings, failing, missing, unclaimed, stale, notes, text };
}

// ------------------------------------------------------------------ the real inputs

/** Every step module in speedrun/quests and speedrun/skills that has a stepId or declares RUNE_USE. */
export async function loadModules(dirs: readonly string[] = ['quests', 'skills']): Promise<ModuleDecl[]> {
    const root = join(import.meta.dir, '..');
    const out: ModuleDecl[] = [];
    for (const d of dirs) {
        for (const f of readdirSync(join(root, d)).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts')).sort()) {
            const m = await import(join(root, d, f));
            if (m.RUNE_USE === undefined && typeof m.stepId !== 'string') continue;
            out.push({ file: `${d}/${f}`, stepId: m.stepId, LETTERS: m.LETTERS, RUNE_USE: m.RUNE_USE, RUNE_NEED: m.RUNE_NEED, RUNE_STAFF: m.RUNE_STAFF, RUNE_USE_FALLBACK: m.RUNE_USE_FALLBACK });
        }
    }
    return out;
}

/** The legs the ledger walks: the body-altar plan in force (its T20-21 row is the Falador teleport). */
export const ledgerLegs = (): LegLike[] => legsFor({ s21Altar: 'body' }).map(l => l.def);

/**
 * Known findings on main's ledger, each awaiting the change named. Empty since rs/158's fold-in 28:
 * fold-in 25's H8 / S11b / T11-12 runes and rs/451's S11b, S24 legs and S18 findings are in the rows.
 */
export const PENDING: readonly Pending[] = [];

export async function main(argv: string[]): Promise<number> {
    const file = argv.find(a => !a.startsWith('--')) ?? MANIFEST;
    let text: string;
    try {
        text = readFileSync(file, 'utf8');
    } catch (e) {
        console.error(`rune-pins: cannot read ${file}: ${(e as Error).message}`);
        return 2;
    }
    const { rows, errors } = parseLedger(text);
    if (errors.length) {
        console.error(`rune-pins: ${file}: the table does not parse:\n${errors.map(e => `  ${e}`).join('\n')}`);
        return 2;
    }
    const report = analyze(rows, { legs: ledgerLegs(), modules: await loadModules(), standIns: STAND_INS }, PENDING);
    console.log(`rune pins: ${file}\n\n${report.text}`);
    return report.failing.length ? 1 : 0;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
