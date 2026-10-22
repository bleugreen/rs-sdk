/**
 * Bank-board history: loading the speedrun competitor snapshots and the markets poller's files into one shape,
 * an account's holdings over time, the jumps between two reads, and the poll file codec.
 *
 * A poll file (docs/markets/data/poll-*.json) covers one block of UTC hours. Each poll records the board's rank
 * order and only the rows that changed since the previous poll in the same file (the first poll carries all of
 * them), plus the online count and where the family accounts stand. decodePolls rebuilds every full board.
 */
import type { ValueRow } from './boards.ts';
import type { Position } from './positions.ts';

export interface Stack {
    id: number;
    count: number;
    name?: string;
}

export interface BankRow {
    rank: number;
    name: string;
    gp: number;
    items: Stack[];
}

export interface BankTop {
    at: string;
    source: string;
    rows: BankRow[];
}

export type CompactRow = [name: string, gp: number, items: number[]];
export type CompactPosition = [name: string, x: number, z: number, level: number];

export interface PollRecord {
    at: string;
    /** Players in /playerpositions; null when that read failed. */
    online: number | null;
    /** Board names in rank order; null when the bank read failed. */
    order: string[] | null;
    rows: CompactRow[];
    families: CompactPosition[];
    /** Every player standing in each watched zone (positions.ts ZONES); absent in polls before it was recorded. */
    zones?: Record<string, string[]>;
}

export interface PollFile {
    v: 1;
    source: string;
    polls: PollRecord[];
}

export interface Poll {
    at: string;
    online: number | null;
    bank: BankRow[] | null;
    families: Position[];
    zones: Record<string, string[]> | null;
}

const compact = (r: BankRow): CompactRow => [r.name, r.gp, r.items.flatMap(i => [i.id, i.count])];
const sameRow = (a: CompactRow, b: CompactRow): boolean => a[1] === b[1] && a[2].length === b[2].length && a[2].every((v, i) => v === b[2][i]);

function expand(row: CompactRow, rank: number): BankRow {
    const items: Stack[] = [];
    for (let i = 0; i + 1 < row[2].length; i += 2) items.push({ id: row[2][i]!, count: row[2][i + 1]! });
    return { rank, name: row[0], gp: row[1], items };
}

export function decodePolls(file: PollFile): Poll[] {
    const state = new Map<string, CompactRow>();
    return file.polls.map(p => {
        for (const row of p.rows) state.set(row[0], row);
        const bank = p.order?.map((name, i) => {
            const row = state.get(name);
            if (!row) throw new Error(`poll ${p.at}: ${name} is ranked but has no row in this file`);
            return expand(row, i + 1);
        });
        return { at: p.at, online: p.online, bank: bank ?? null, families: p.families.map(([name, x, z, level]) => ({ name, x, z, level })), zones: p.zones ?? null };
    });
}

/** The record to append to `file` for one poll; `isFamily` picks whose positions are kept, `roster` names zones. */
export function encodePoll(
    file: PollFile,
    at: string,
    bank: BankRow[] | null,
    positions: Position[] | null,
    isFamily: (name: string) => boolean,
    roster?: (positions: Position[]) => Record<string, string[]>
): PollRecord {
    const state = new Map<string, CompactRow>();
    for (const p of file.polls) for (const row of p.rows) state.set(row[0], row);
    const rows = (bank ?? []).map(compact).filter(r => {
        const before = state.get(r[0]);
        return !before || !sameRow(before, r);
    });
    return {
        at,
        online: positions?.length ?? null,
        order: bank?.map(r => r.name) ?? null,
        rows,
        families: (positions ?? []).filter(p => isFamily(p.name)).map(p => [p.name, p.x, p.z, p.level]),
        ...(positions && roster ? { zones: roster(positions) } : {})
    };
}

/** One poll per line, so a file under git diffs by appended lines. */
export const formatPollFile = (file: PollFile): string =>
    `{"v":${file.v},"source":${JSON.stringify(file.source)},"polls":[\n${file.polls.map(p => JSON.stringify(p)).join(',\n')}\n]}\n`;

/** `2026-10-21T080427Z` (a scraper file stamp) as an ISO time, or null. */
export function stampFromFile(file: string): string | null {
    const m = file.match(/(\d{4}-\d\d-\d\d)T(\d\d)(\d\d)(\d\d)Z/);
    return m ? `${m[1]}T${m[2]}:${m[3]}:${m[4]}.000Z` : null;
}

const asRows = (rows: ValueRow[] | BankRow[]): BankRow[] => rows.map(r => ({ rank: r.rank, name: r.name, gp: r.gp, items: r.items.map(i => ({ ...i })) }));

/**
 * Every full bank top-50 read in a parsed data file: a hiscore-scrape snapshot (bank.top), a census file (bank),
 * or a poll file (one per successful poll). Files without the top board (bank searches, positions) give none.
 */
export function bankTops(json: unknown, file: string): BankTop[] {
    const j = json as { v?: number; polls?: unknown; takenAt?: string; bank?: { top?: ValueRow[] } | ValueRow[] };
    if (j?.v === 1 && Array.isArray(j.polls)) {
        return decodePolls(j as PollFile).flatMap(p => (p.bank ? [{ at: p.at, source: file, rows: p.bank }] : []));
    }
    const at = j?.takenAt ?? stampFromFile(file);
    const top = Array.isArray(j?.bank) ? j.bank : j?.bank?.top;
    if (!at || !Array.isArray(top)) return [];
    return [{ at: new Date(at).toISOString(), source: file, rows: asRows(top) }];
}

export interface HoldingPoint {
    at: string;
    source: string;
    rank: number;
    gp: number;
    items: Stack[];
}

/** `name`'s rows across `tops`, oldest first; reads where the account is off the top 50 are absent. */
export function holdingsOf(tops: BankTop[], name: string): HoldingPoint[] {
    return tops
        .flatMap(t => t.rows.filter(r => r.name === name).map(r => ({ at: t.at, source: t.source, rank: r.rank, gp: r.gp, items: r.items })))
        .sort((a, b) => a.at.localeCompare(b.at));
}

export interface Jump {
    name: string;
    /** Null for an account new to the top 50. */
    from: number | null;
    to: number;
    delta: number;
}

export interface JumpOptions {
    /** A gain at least this large between two reads is a jump. */
    minDelta?: number;
    /** So is a gain of at least this fraction of the earlier total (with at least `minRatioDelta` gp). */
    minRatio?: number;
    minRatioDelta?: number;
    /** A newcomer to the top 50 at or above this total is a jump. */
    newcomerGp?: number;
}

/** Gains between two board reads too large or too fast for ordinary play; the evidence a generator would leave. */
export function jumps(before: BankRow[], after: BankRow[], opts: JumpOptions = {}): Jump[] {
    const { minDelta = 100_000_000, minRatio = 1, minRatioDelta = 10_000_000, newcomerGp = 1_000_000_000 } = opts;
    const prior = new Map(before.map(r => [r.name, r.gp]));
    const out: Jump[] = [];
    for (const r of after) {
        const from = prior.get(r.name);
        if (from === undefined) {
            // Off the top 50 before means at most the 50th row's total.
            if (before.length && r.gp >= newcomerGp) out.push({ name: r.name, from: null, to: r.gp, delta: r.gp - (before.at(-1)?.gp ?? 0) });
            continue;
        }
        const delta = r.gp - from;
        if (delta >= minDelta || (delta >= minRatioDelta && delta >= minRatio * from)) out.push({ name: r.name, from, to: r.gp, delta });
    }
    return out.sort((a, b) => b.delta - a.delta);
}
