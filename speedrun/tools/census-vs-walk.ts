// Census against walk: every `(census)` row of a run's tick log diffed against the slot ledger's
// walked held set at the same point in the chain, so an item a step leaves in the pack that no
// ledger row models (S07's kept willow log, T07-08's carried bones, F10's prayer potion and pack-held
// M'speak amulet, S22's arrow shafts and raw salmon) shows in one table the run it first appears in,
// not hours later when a step with a tight free-slot precondition refuses.
//
//   bun speedrun/tools/census-vs-walk.ts RUN.jsonl [MORE.jsonl ...] [--ledger=FILE | --ledger-commit=REF] [--strict] [--rows]
//
// The ledger defaults to docs/speedrun/STEP-MANIFEST.md in this tree; a run is judged against the
// ledger it ran on, so pass --ledger-commit=<the run's commit> (git show REF:docs/speedrun/STEP-MANIFEST.md)
// when this tree has moved on. Several logs (a run and its staged chunks) are read in turn, each
// placed on its own.
//
// Where a census sits. A `(census)` row is the pack just before the chain step `before`, whose
// ledger row is `id` (runner/chain.ts censused). Its walk point is the held set after the ledger row
// before it, as slot-ledger.ts walks it:
// - a step's FIRST census (a boundary row): before the step's ledger row; or, when hand-off rows just
//   before it are traded inside the step (runner/chain.ts INTERNAL, or PLACEMENT `as`: H1 at S01, H3
//   in S04, H4.x in S07, H21a in S25a), before the first of them, unless the lab supplied that row by
//   staff commands (the gate row's `staffed`), which happens before the step's census;
// - a split leg's part a: before the leg's row; part b: after the hand-offs PLACEMENT puts inside
//   that leg (H9 in T11-12, H11r in T14-15);
// - every later census of the same step, and a census whose id is no ledger row (a cue stop, T07a,
//   L24a, H4m.k, H12o's login, a -fallback row): a MID-STEP row of the current row.
// So a step's exit census is the next row's boundary census, before the following leg spends its
// teleport runes (rs/158's rule F).
//
// How an item matches. A walk stack named `NAME @ID` matches the census item of that id or its note
// (obj.pack's cert link); every stack also matches by name, lower-cased with a potion's dose stripped
// on both sides (`Prayer potion(2)` is the walk's prayer potion(4); rule B); a `<NAME>` placeholder
// matches its category (CATEGORIES). Worn items carry names only in the census.
//
// What a census row reports, rs/158's allow-list (cairn://p/rs/158/2/coordinator, 2026-10-24):
// - live but not in the walk (pack or worn): FAIL, the defect class. An empty Vial is never allowed.
// - a pack item the walk has worn: FAIL (F10's M'speak amulet; rule D), but for WORN_IN_PACK_ALLOWED
//   (the staff of water from S01 to S04).
// - more of an unstackable than the walk holds: FAIL, a slot the walk does not count.
// - LOOSE stacks (runes, coins, sharks, feathers, cannonballs, arrows and tips, nails, thread; rule A)
//   compare by name and place only, and bones are allowed inside BONES_INSIDE (S07, S09).
// - on a mid-step row nothing fails: a step's own withdrawals, quest items and products are its own
//   business (rules C and G), and what outlives the step fails at the next boundary row.
// - in the walk but not live, on boundary rows: informational (eaten, drunk, consumed).
//
// Exit: 0 with no FAIL, or any without --strict; 1 under --strict with a FAIL; 2 when a log or the
// ledger cannot be read.

import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { basename, join } from 'path';
import { noteOf } from '../lib/items';
import { CENSUS_STEP, INTERNAL, PLACEMENT } from '../runner/chain';
import { itemLabel, MANIFEST, parseLedger, walk, type Held, type LedgerEntry, type LedgerRow } from './slot-ledger';

// ------------------------------------------------------------------ the allow-list

/** Rule A: stacks the walk models only loosely, compared by name and place, not count. */
export const LOOSE: readonly RegExp[] = [/ rune$/, /^coins$/, /^shark$/, /^feathers?$/, /^cannonballs?$/, /arrows?$/, /arrowtips$/, /arrowheads$/, /nails$/, /^thread$/];

/** Rule A's bones: allowed live inside these rows, whose loads the walk holds as `<bones>` or not at all (H4m is a fallback row). */
export const BONES_INSIDE: readonly string[] = ['H4.x', 'S07', 'S09'];

/** Rule D's exceptions: a pack item the walk has worn, allowed from row `from` to row `to`. */
export interface Allowance {
    item: string;
    from: string;
    to: string;
    cite: string;
}

export const WORN_IN_PACK_ALLOWED: readonly Allowance[] = [
    { item: 'staff of water', from: 'S01', to: 'S04', cite: "S01's note (cc931157): the walk wields it at S01, magic.ts inside S04" },
];

/** What a `<NAME>` placeholder stands for in the game. */
export const CATEGORIES: Readonly<Record<string, RegExp>> = {
    bones: /bones$/i,
    'gem ring': /^(sapphire|emerald|ruby|diamond|dragonstone) ring$/i,
    'enchanted ring': /^ring of /i,
    bars: / bar$/i,
    platebody: /platebody$/i,
};

// ------------------------------------------------------------------ the log

export interface CensusItem {
    name: string;
    count: number;
    id?: number;
}

export interface Census {
    log: string;
    /** 1-based line in the log. */
    line: number;
    tick: number;
    at: string;
    /** The chain step about to run. */
    before: string;
    /** Its ledger row id, or a cue stop's, a sub-leg's, a fallback's. */
    id: string;
    label?: string;
    inventory: CensusItem[];
    worn: string[];
}

/** The `(census)` rows of a tick log, and the rows its dress-rehearsal gate says the lab supplied by staff commands. */
export function readCensus(text: string, log: string): { census: Census[]; staffed: string[]; bad: number } {
    const census: Census[] = [];
    const staffed = new Set<string>();
    let bad = 0;
    text.split('\n').forEach((line, i) => {
        if (!line.trim()) return;
        let r: { step?: string; startTick?: number; at?: string; meta?: Record<string, unknown> };
        try {
            r = JSON.parse(line);
        } catch {
            bad++;
            return;
        }
        const m = r.meta;
        if (m && Array.isArray(m.staffed)) for (const s of m.staffed) if (typeof s === 'string') staffed.add(s);
        if (r.step !== CENSUS_STEP || !m || typeof m.before !== 'string' || !Array.isArray(m.inventory)) return;
        const inventory = (m.inventory as CensusItem[]).filter(x => typeof x?.name === 'string' && typeof x.count === 'number');
        const worn = Array.isArray(m.worn) ? (m.worn as unknown[]).filter((x): x is string => typeof x === 'string') : [];
        census.push({
            log,
            line: i + 1,
            tick: r.startTick ?? -1,
            at: r.at ?? '',
            before: m.before,
            id: typeof m.id === 'string' ? m.id : m.before.split(' ')[0]!,
            ...(typeof m.label === 'string' && m.label ? { label: m.label } : {}),
            inventory,
            worn,
        });
    });
    return { census, staffed: [...staffed], bad };
}

// ------------------------------------------------------------------ placing a census on the walk

export type Phase = 'boundary' | 'mid';

export interface Placed {
    census: Census;
    /** The walk point: the held set after ledger row at - 1 (before row `at`). */
    at: number;
    /** The ledger row the census belongs to: a mid-step row compares against this row's start, `in` and end. */
    row: number;
    phase: Phase;
}

export interface PlaceOptions {
    /** The step id a hand-off row is traded inside, when its module trades it (default: chain.ts INTERNAL and PLACEMENT `as`). */
    tradedIn?: (row: string) => string | undefined;
    /** The leg a hand-off row is placed inside (default: chain.ts PLACEMENT `leg`). */
    placedInLeg?: (row: string) => string | undefined;
    /** Rows the lab supplied by staff commands, before the step's census. */
    staffed?: ReadonlySet<string>;
}

const chainTradedIn = (row: string): string | undefined => {
    const p = PLACEMENT[row];
    if (p && 'as' in p) return p.as;
    return INTERNAL[row]?.split(' ')[0];
};
const chainPlacedInLeg = (row: string): string | undefined => {
    const p = PLACEMENT[row];
    return p && 'leg' in p ? p.leg : undefined;
};

const SPLIT_LEG = /^(T\d+-\d+)([ab])$/;

/** Each census's walk point, in log order; a census before any ledger row is unplaced. */
export function place(census: readonly Census[], rows: readonly LedgerRow[], o: PlaceOptions = {}): { placed: Placed[]; unplaced: Census[] } {
    const tradedIn = o.tradedIn ?? chainTradedIn;
    const placedInLeg = o.placedInLeg ?? chainPlacedInLeg;
    const staffed = o.staffed ?? new Set<string>();
    const index = new Map(rows.map((r, i) => [r.row, i]));
    const placed: Placed[] = [];
    const unplaced: Census[] = [];
    let prev: Placed | null = null;
    for (const c of census) {
        if (prev && prev.census.log !== c.log) prev = null;
        // The same step censused again (a re-run, a resume into it): the same point.
        if (prev && prev.census.before === c.before) {
            placed.push({ ...prev, census: c });
            continue;
        }
        let p: Omit<Placed, 'census'> | null = null;
        const i = index.get(c.id);
        const split = SPLIT_LEG.exec(c.id);
        if (i !== undefined) {
            if (prev && prev.row === i) p = { at: i, row: i, phase: 'mid' };
            else {
                let s = i;
                while (s > 0 && /^H/.test(rows[s - 1]!.row) && tradedIn(rows[s - 1]!.row) === c.id && !staffed.has(rows[s - 1]!.row)) s--;
                p = { at: s, row: i, phase: 'boundary' };
            }
        } else if (split && index.has(split[1]!)) {
            const leg = index.get(split[1]!)!;
            let s = leg;
            if (split[2] === 'b') {
                s = leg + 1;
                while (s < rows.length && placedInLeg(rows[s]!.row) === split[1]) s++;
            }
            p = { at: s, row: s === leg ? leg : s - 1, phase: 'boundary' };
        } else if (prev) p = { at: prev.row, row: prev.row, phase: 'mid' };
        if (!p) {
            unplaced.push(c);
            continue;
        }
        prev = { census: c, ...p };
        placed.push(prev);
    }
    return { placed, unplaced };
}

// ------------------------------------------------------------------ matching

/** A name as compared: lower-case, a potion's dose stripped (rule B). */
export const baseName = (name: string) => name.toLowerCase().replace(/\s*\(\d\)$/, '').trim();

const safeNote = (id: number): number | undefined => {
    try {
        return noteOf(id);
    } catch {
        return undefined;
    }
};

/** Whether walk stack `h` names the live item. */
export function matchesHeld(h: Held, item: { name: string; id?: number }): boolean {
    if (h.placeholder) return (CATEGORIES[h.name] ?? new RegExp(`\\b${h.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')).test(item.name);
    if (h.id !== undefined && item.id !== undefined && (item.id === h.id || item.id === safeNote(h.id))) return true;
    return baseName(item.name) === baseName(h.name);
}

const loose = (name: string) => LOOSE.some(r => r.test(baseName(name)));

// ------------------------------------------------------------------ the comparison

export type FindingKind = 'not in walk' | 'worn in walk' | 'surplus';

export interface Finding {
    placed: Placed;
    /** The live names, dose kept. */
    item: string;
    where: 'pack' | 'worn';
    live: number;
    /** What the walk holds of it; null when unknown. */
    walk: number | null;
    kind: FindingKind;
    verdict: 'FAIL' | 'allowed';
    /** The allow-list rule that allowed it. */
    rule?: 'A' | 'C' | 'D';
    note?: string;
}

export interface Missing {
    placed: Placed;
    item: string;
    where: 'pack' | 'worn';
    walk: number | null;
}

export interface RowResult {
    placed: Placed;
    findings: Finding[];
    missing: Missing[];
    /** Slots: the census's pack entries and the walk's count at the point. */
    liveUsed: number;
    walkUsed: number | null;
}

export interface CompareOptions {
    wornInPack?: readonly Allowance[];
}

const EMPTY = { inv: [] as readonly Held[], worn: [] as readonly Held[] };
const asHeld = (row: LedgerRow): Held[] => row.in.map(e => ({ name: e.name, ...(e.id !== undefined ? { id: e.id } : {}), ...(e.family ? { family: true as const } : {}), ...(e.placeholder ? { placeholder: true as const } : {}), kind: e.kind, count: null }));

/** One census row against the walk. */
export function compareRow(p: Placed, rows: readonly LedgerRow[], entries: readonly LedgerEntry[], o: CompareOptions = {}): RowResult {
    const before = p.at > 0 ? entries[p.at - 1]!.stacks : EMPTY;
    const mid = p.phase === 'mid';
    const inv = mid ? [...before.inv, ...asHeld(rows[p.row]!), ...entries[p.row]!.stacks.inv] : [...before.inv];
    const worn = mid ? [...before.worn, ...entries[p.row]!.stacks.worn] : [...before.worn];
    const rowId = rows[p.row]!.row;
    const index = new Map(rows.map((r, i) => [r.row, i]));

    interface Group { names: Set<string>; where: 'pack' | 'worn'; live: number; inv: number[]; worn: number[] }
    const groups = new Map<string, Group>();
    const usedInv = new Set<number>();
    const usedWorn = new Set<number>();
    const add = (item: { name: string; id?: number }, count: number, where: 'pack' | 'worn') => {
        const mi = inv.flatMap((h, i) => (matchesHeld(h, item) ? [i] : []));
        const mw = worn.flatMap((h, i) => (matchesHeld(h, item) ? [i] : []));
        mi.forEach(i => usedInv.add(i));
        mw.forEach(i => usedWorn.add(i));
        const key = `${where}|${mi.length ? `inv:${mi}` : mw.length ? `worn:${mw}` : `none:${baseName(item.name)}`}`;
        const g = groups.get(key) ?? { names: new Set(), where, live: 0, inv: mi, worn: mw };
        g.names.add(item.name);
        g.live += count;
        groups.set(key, g);
    };
    for (const i of p.census.inventory) add(i, i.count, 'pack');
    for (const w of p.census.worn) add({ name: w }, 1, 'worn');

    const findings: Finding[] = [];
    const sum = (list: readonly Held[], at: number[]) => (at.some(i => list[i]!.count === null) ? null : at.reduce((a, i) => a + list[i]!.count!, 0));
    for (const g of groups.values()) {
        const item = [...g.names].join(' / ');
        const name = [...g.names][0]!;
        let f: Omit<Finding, 'placed' | 'item' | 'where' | 'live' | 'verdict'> | null = null;
        if (g.where === 'pack') {
            if (g.inv.length) {
                const w = sum(inv, g.inv);
                const unstackable = g.inv.every(i => inv[i]!.kind === 'u');
                if (!loose(name) && unstackable && w !== null && g.live > w) f = { walk: w, kind: 'surplus' };
            } else if (g.worn.length) {
                const ok = (o.wornInPack ?? WORN_IN_PACK_ALLOWED).find(a => baseName(a.item) === baseName(name) && index.has(a.from) && index.has(a.to) && p.row >= index.get(a.from)! && p.row <= index.get(a.to)!);
                f = { walk: sum(worn, g.worn), kind: 'worn in walk', ...(ok ? { rule: 'D' as const, note: ok.cite } : {}) };
            } else {
                f = { walk: 0, kind: 'not in walk', ...(/bones$/i.test(name) && BONES_INSIDE.includes(rowId) ? { rule: 'A' as const, note: `bones inside ${rowId}` } : {}) };
            }
        } else if (!g.worn.length && !g.inv.length) f = { walk: 0, kind: 'not in walk' };
        if (!f) continue;
        const rule = f.rule ?? (mid ? ('C' as const) : undefined);
        findings.push({ placed: p, item, where: g.where, live: g.live, ...f, verdict: rule ? 'allowed' : 'FAIL', ...(rule ? { rule } : {}), ...(mid && !f.rule ? { note: 'mid-step' } : {}) });
    }

    const missing: Missing[] = [];
    if (!mid) {
        inv.forEach((h, i) => usedInv.has(i) || missing.push({ placed: p, item: itemLabel(h), where: 'pack', walk: h.count }));
        worn.forEach((h, i) => usedWorn.has(i) || missing.push({ placed: p, item: itemLabel(h), where: 'worn', walk: h.count }));
    }
    return { placed: p, findings, missing, liveUsed: p.census.inventory.length, walkUsed: mid ? null : p.at > 0 ? entries[p.at - 1]!.used : 0 };
}

// ------------------------------------------------------------------ the report

/** A census row as the tables name it: its step's segment or id. */
export function rowLabel(c: Census): string {
    if (c.id.includes(' ')) return c.id;
    if (c.before.startsWith(c.id)) return c.before.split(' ')[0]!;
    return `${c.id} ${c.before.length > 26 ? `${c.before.slice(0, 25)}…` : c.before}`;
}

export interface Group {
    log: string;
    item: string;
    where: 'pack' | 'worn';
    kind: FindingKind | 'walk not live';
    verdict: 'FAIL' | 'allowed' | 'info';
    rule?: string;
    note?: string;
    first: Census;
    last: Census;
    rows: number;
    live: Set<number>;
    walk: Set<number | null>;
}

function groupOf(list: readonly (Finding | (Missing & { kind: 'walk not live' }))[]): Group[] {
    const out = new Map<string, Group>();
    for (const f of list) {
        const verdict = 'verdict' in f ? f.verdict : 'info';
        const rule = 'rule' in f ? f.rule : undefined;
        const key = [f.placed.census.log, f.item, f.where, f.kind, verdict, rule ?? ''].join('|');
        const g = out.get(key);
        if (!g) {
            out.set(key, {
                log: f.placed.census.log, item: f.item, where: f.where, kind: f.kind, verdict, ...(rule ? { rule } : {}), ...('note' in f && f.note ? { note: f.note } : {}),
                first: f.placed.census, last: f.placed.census, rows: 1, live: new Set('live' in f ? [f.live] : []), walk: new Set([f.walk]),
            });
            continue;
        }
        g.last = f.placed.census;
        g.rows++;
        if ('live' in f) g.live.add(f.live);
        g.walk.add(f.walk);
    }
    return [...out.values()];
}

const counts = (s: Set<number | null>) => {
    const v = [...s];
    if (v.some(x => x === null)) return '?';
    const n = v as number[];
    const lo = Math.min(...n);
    const hi = Math.max(...n);
    return lo === hi ? String(lo) : `${lo}-${hi}`;
};

const cell = (s: string) => s.replace(/\|/g, '\\|');

export function renderGroups(groups: readonly Group[], logs: number): string {
    const head = ['rows', 'item', 'live', 'walk', 'first tick', 'class', 'rule', ...(logs > 1 ? ['log'] : [])];
    const body = groups.map(g => [
        `${rowLabel(g.first)}${g.rows > 1 ? ` .. ${rowLabel(g.last)}` : ''} (${g.rows})`,
        `${g.item}${g.where === 'worn' ? ' (worn)' : ''}`,
        g.verdict === 'info' ? '0' : counts(g.live),
        counts(g.walk),
        String(g.first.tick),
        g.verdict === 'info' ? 'info: walk not live' : `${g.verdict}: ${g.kind}`,
        g.rule ? `${g.rule}${g.note ? ` (${g.note})` : ''}` : '-',
        ...(logs > 1 ? [g.log] : []),
    ]);
    return [head, head.map(() => '---'), ...body].map(r => `| ${r.map(cell).join(' | ')} |`).join('\n');
}

export function renderRows(results: readonly RowResult[], rows: readonly LedgerRow[]): string {
    const head = ['log:line', 'tick', 'census', 'phase', 'walk point', 'slots live/walk', 'live but not in walk', 'walk but not live'];
    const body = results.map(r => [
        `${r.placed.census.log}:${r.placed.census.line}`,
        String(r.placed.census.tick),
        rowLabel(r.placed.census),
        r.placed.phase,
        r.placed.phase === 'mid' ? `in ${rows[r.placed.row]!.row}` : `before ${rows[r.placed.at]?.row ?? '(the end)'}`,
        `${r.liveUsed}/${r.walkUsed ?? '-'}`,
        r.findings.map(f => `${f.verdict === 'FAIL' ? 'FAIL ' : ''}${f.item} x${f.live}${f.kind !== 'not in walk' ? ` (${f.kind}, walk ${f.walk ?? '?'})` : ''}${f.rule ? ` [${f.rule}]` : ''}`).join('; ') || '-',
        r.missing.map(m => `${m.item} x${m.walk ?? '?'}`).join('; ') || '-',
    ]);
    return [head, head.map(() => '---'), ...body].map(r => `| ${r.map(cell).join(' | ')} |`).join('\n');
}

export interface Report {
    results: RowResult[];
    unplaced: Census[];
    findings: Group[];
    missing: Group[];
    failed: number;
}

/** Every census of `logs` against the walk of `rows`. */
export function censusVsWalk(logs: readonly { name: string; text: string }[], rows: readonly LedgerRow[], o: CompareOptions & Pick<PlaceOptions, 'tradedIn' | 'placedInLeg'> = {}): Report {
    const entries = walk(rows);
    const results: RowResult[] = [];
    const unplaced: Census[] = [];
    for (const l of logs) {
        const { census, staffed } = readCensus(l.text, l.name);
        const p = place(census, rows, { ...o, staffed: new Set(staffed) });
        unplaced.push(...p.unplaced);
        for (const x of p.placed) results.push(compareRow(x, rows, entries, o));
    }
    const findings = groupOf(results.flatMap(r => r.findings));
    const missing = groupOf(results.flatMap(r => r.missing.map(m => ({ ...m, kind: 'walk not live' as const }))));
    return { results, unplaced, findings, missing, failed: findings.filter(g => g.verdict === 'FAIL').length };
}

const ROOT = join(import.meta.dir, '../..');

export function main(argv: string[]): number {
    const strict = argv.includes('--strict');
    const perRow = argv.includes('--rows');
    const opt = (k: string) => argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
    const files = argv.filter(a => !a.startsWith('--'));
    if (!files.length) {
        console.error('usage: bun speedrun/tools/census-vs-walk.ts RUN.jsonl [MORE.jsonl ...] [--ledger=FILE | --ledger-commit=REF] [--strict] [--rows]');
        return 2;
    }
    let manifest: string;
    let source: string;
    try {
        const commit = opt('ledger-commit');
        if (commit) {
            manifest = execFileSync('git', ['show', `${commit}:docs/speedrun/STEP-MANIFEST.md`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
            source = `docs/speedrun/STEP-MANIFEST.md at ${commit}`;
        } else {
            source = opt('ledger') ?? MANIFEST;
            manifest = readFileSync(source, 'utf8');
        }
    } catch (e) {
        console.error(`census-vs-walk: cannot read the ledger: ${(e as Error).message}`);
        return 2;
    }
    const { rows, errors } = parseLedger(manifest);
    if (errors.length) {
        console.error(`census-vs-walk: the ledger does not parse:\n${errors.map(e => `  ${e}`).join('\n')}`);
        return 2;
    }
    const logs: { name: string; text: string }[] = [];
    for (const f of files) {
        try {
            logs.push({ name: files.length > 1 ? `${basename(join(f, '..'))}/${basename(f)}` : basename(f), text: readFileSync(f, 'utf8') });
        } catch (e) {
            console.error(`census-vs-walk: cannot read ${f}: ${(e as Error).message}`);
            return 2;
        }
    }
    const r = censusVsWalk(logs, rows);
    const boundary = r.results.filter(x => x.placed.phase === 'boundary').length;
    console.log(`census vs walk: ${files.join(', ')}\nledger: ${source} (${rows.length} rows)\n${r.results.length} census rows placed (${boundary} boundary, ${r.results.length - boundary} mid-step)${r.unplaced.length ? `, ${r.unplaced.length} before any ledger row` : ''}\n`);
    if (perRow) console.log(`${renderRows(r.results, rows)}\n`);
    console.log('## Live but not in the walk\n');
    console.log(r.findings.length ? renderGroups(r.findings, logs.length) : '(none)');
    console.log('\n## In the walk but not live (boundary rows; informational)\n');
    console.log(r.missing.length ? renderGroups(r.missing, logs.length) : '(none)');
    console.log(`\n${r.failed} FAIL, ${r.findings.length - r.failed} allowed, ${r.missing.length} walk-not-live${strict ? ' (strict)' : ''}`);
    return strict && r.failed > 0 ? 1 : 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
