#!/usr/bin/env bun
/**
 * Hiscore scraper for the public rs-sdk demo (read-only; it never touches a game account).
 * Findings and method: docs/speedrun/research/competitors/hiscores.md.
 *
 *   bun speedrun/tools/hiscore-scrape.ts snapshot [--out DIR] [--overall-pages N]
 *       Crawls the overall board, every skill board, Quest Points, bank (top + item searches)
 *       and equipment boards, then every player page in scope. Writes DIR/snapshot-<stamp>.json.
 *   bun speedrun/tools/hiscore-scrape.ts players NAME... [--out DIR] [--tag TAG]
 *       Player pages only (climber re-snapshots). Writes DIR/<tag>-<stamp>.json.
 *   bun speedrun/tools/hiscore-scrape.ts boards [--out DIR] [--overall-pages N] [--tag TAG]
 *       Ranked boards only (overall pages, two pages of every skill board, Quest Points).
 *   bun speedrun/tools/hiscore-scrape.ts analyze SNAPSHOT.json [NAME...]
 *       Prints the per-account stamp ordering (batches, gaps) as markdown.
 *   bun speedrun/tools/hiscore-scrape.ts diff OLD.json NEW.json
 *       Prints every player row whose level changed between two snapshots (climber progress).
 *   --cache STAMP (snapshot, players) rebuilds from speedrun/runs/hiscore-cache/STAMP without refetching.
 *
 * Politeness: one request at a time, at least MIN_INTERVAL_MS apart, retried with exponential
 * backoff (the demo cold-starts on Fly). Raw HTML is cached per run under speedrun/runs/.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const REPO_ROOT = resolve(import.meta.dir, '../..');
export const BASE_URL = 'https://rs-sdk-demo.fly.dev';
export const DEFAULT_OUT = join(REPO_ROOT, 'docs/speedrun/research/competitors/data');
const CACHE_ROOT = join(REPO_ROOT, 'speedrun/runs/hiscore-cache');
const USER_AGENT = 'rs-sdk-hiscore-research (+https://github.com/bleugreen/rs-sdk)';
const MIN_INTERVAL_MS = 550;
const TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 5;
export const BOARD_PAGE_SIZE = 21;

/** Board category ids, in the order the player page lists them. */
export const SKILLS: Record<number, string> = {
    1: 'Attack', 2: 'Defence', 3: 'Strength', 4: 'Hitpoints', 5: 'Ranged', 6: 'Prayer', 7: 'Magic',
    8: 'Cooking', 9: 'Woodcutting', 10: 'Fletching', 11: 'Fishing', 12: 'Firemaking', 13: 'Crafting',
    14: 'Smithing', 15: 'Mining', 16: 'Herblore', 17: 'Agility', 18: 'Thieving', 21: 'Runecraft'
};
export const OVERALL = 0;
export const QUEST_POINTS = 100;
export const CATEGORY_NAMES: Record<number, string> = { [OVERALL]: 'Overall', ...SKILLS, [QUEST_POINTS]: 'Quest Points' };

/** Name prefixes of the operator families above us on the boards. */
export const FAMILY_PATTERN = /^(stun|nick|asukalabs|zayne|soko|lach)/;
/** Accounts named in the brief that may not surface on any crawled board page. */
export const SEED_PLAYERS = [
    'stunbaron', 'stunhard', 'stunless', 'stunking', 'stunmine', 'stunmaxing', 'stunlord', 'stunfast',
    'nickoverall', 'nickquarry', 'nickminer1', 'nickmax', 'nickai', 'nickai2', 'nickai3',
    'asukalabs', 'asukalabs1', 'zayne', 'zaynelab06', 'soko', 'sokobot', 'lachmine003'
];
export const BANK_SEARCHES = [
    'grapes', 'jug of wine', 'wine', 'dragon bones', 'big bones', 'pure essence', 'rune essence', 'logs',
    'bar', 'feather', 'herb', 'rune', 'unfinished', 'arrow shaft', 'bow string', 'flax', 'coal', 'iron ore',
    'headless arrow', 'arrowtips', 'rune arrow', 'dart', 'uncut', 'dragonstone', 'diamond', 'sapphire', 'opal',
    'vial of water', 'potion', 'unstrung', 'bones', 'tinderbox', 'chisel', 'knife', 'orb', 'talisman', 'essence'
];

// ---------------------------------------------------------------------------
// Parsing

const num = (s: string): number => Number(s.replaceAll(',', '').trim());

/**
 * A Time cell's hover title carries the exact stamp in one of three forms:
 *   `N ticks`                              the engine's own page (lab worlds), and the demo until about 19:34 UTC 2026-10-22;
 *   `S seconds of game time`               the demo from then until its ~19:56 UTC restart: S = ticks x tickMs / 1000,
 *                                          with thousands separators and at most one decimal (`998.7` = 3,329 ticks at 300 ms);
 *   `N ticks normalized to M ms per tick`  the demo since that restart, which runs 400 ms ticks; the displayed time is N x M ms.
 * Both later forms are deploy markers for engine code not on GitHub (first seen by rs/455 and rs/147).
 * The seconds form carries no rate, so it converts only under one the caller supplies (worldfeedTickMs reads
 * the server's current rate); no rate is ever assumed.
 */
export interface TitleStamp {
    ticks: number;
    /** The rate the title is stated in (`normalized to M ms`) or a seconds title was converted under; absent for `N ticks`. */
    tickMs?: number;
}

const NUMBER = String.raw`[\d,]+(?:\.\d+)?`;
const TITLE_FORMS = new RegExp(`^(${NUMBER}) (?:(ticks)(?: normalized to (${NUMBER}) ms per tick)?|seconds of game time)$`);

/** Thrown for a seconds-form title parsed without a tick rate: the caller can look the rate up and parse again. */
export class TickRateNeeded extends Error {}

/**
 * The stamp in one Time title (the attribute's text). A title in no known form, a fractional tick count, or a
 * seconds value that is not a whole number of ticks under `tickMs` throws rather than rounds, because a rounded
 * stamp would pass rehearse.ts's 2-tick log check while wrong.
 */
export function titleTicks(title: string, tickMs?: number): TitleStamp {
    const m = title.match(TITLE_FORMS);
    if (!m) throw new Error(`time title "${title}" is in no known form; the hiscore time format has changed`);
    const n = num(m[1]!);
    if (m[2]) {
        if (!Number.isInteger(n)) throw new Error(`time title "${title}" is not a whole tick count`);
        if (m[3] === undefined) return { ticks: n };
        const ms = num(m[3]);
        if (!(ms > 0)) throw new Error(`time title "${title}" names no usable tick rate`);
        return { ticks: n, tickMs: ms };
    }
    if (tickMs === undefined) throw new TickRateNeeded(`time title "${title}" is in seconds and no tick rate was given to convert it under`);
    const exact = (n * 1000) / tickMs;
    const ticks = Math.round(exact);
    if (Math.abs(exact - ticks) > 1e-6) {
        throw new Error(`time title "${title}" is not a whole number of ${tickMs} ms ticks; the hiscore time format or tick rate has changed`);
    }
    return { ticks, tickMs };
}

/** Every Time title's stamp in `html` (a Time column or cell), in page order. */
export const timeTitleTicks = (html: string, tickMs?: number): TitleStamp[] => [...html.matchAll(/title="([^"]*)"/g)].map(m => titleTicks(m[1]!, tickMs));

/** The `tickMs` a row carries: present only when its title stated or was converted under a rate. */
const rateOf = (s: TitleStamp | undefined): { tickMs?: number } => (s?.tickMs === undefined ? {} : { tickMs: s.tickMs });

/** The server's current tick length in ms, from the login-free world feed's hello frame. */
export async function worldfeedTickMs(origin = BASE_URL, timeoutMs = 10_000): Promise<number> {
    const url = `${origin.replace(/^http/, 'ws').replace(/\/$/, '')}/worldfeed`;
    return await new Promise<number>((resolve, reject) => {
        const ws = new WebSocket(url);
        const done = (err: Error | null, ms?: number) => {
            clearTimeout(timer);
            ws.close();
            if (err) reject(err);
            else resolve(ms!);
        };
        const timer = setTimeout(() => done(new Error(`${url}: no hello within ${timeoutMs} ms`)), timeoutMs);
        ws.onmessage = ev => {
            let msg: { t?: string; tickMs?: unknown };
            try {
                msg = JSON.parse(String(ev.data));
            } catch {
                return;
            }
            if (msg.t !== 'hello') return;
            if (typeof msg.tickMs === 'number' && msg.tickMs > 0) done(null, msg.tickMs);
            else done(new Error(`${url}: hello carries no tickMs`));
        };
        ws.onerror = () => done(new Error(`${url}: connection failed`));
    });
}

/**
 * `parse()`, and again under the world feed's current rate at `origin` if the page is in seconds form: such a
 * page is rendered under the rate the server runs now, so that rate converts it exactly.
 */
export async function withServerRate<T>(origin: string, parse: (tickMs?: number) => T): Promise<T> {
    try {
        return parse();
    } catch (e) {
        if (!(e instanceof TickRateNeeded)) throw e;
        return parse(await worldfeedTickMs(origin));
    }
}

export interface BoardRow {
    rank: number;
    name: string;
    level: number;
    ticks: number;
    tickMs?: number;
}

/**
 * The ranked boards render four parallel columns (Rank, Name, Level, Time), each a `<br>` list.
 * `tickMs` converts seconds-form titles (see titleTicks); without it such a board throws TickRateNeeded.
 */
export function parseBoard(html: string, tickMs?: number): BoardRow[] {
    const column = (label: string): string => {
        const m = html.match(new RegExp(`<b>${label}</b><br>([\\s\\S]*?)</td>`));
        return m ? m[1]! : '';
    };
    const ranks = column('Rank').split('<br>').map(s => s.trim()).filter(Boolean).map(num);
    const names = [...column('Name').matchAll(/\/hiscores\/player\/([^?"]+)\?/g)].map(m => decodeURIComponent(m[1]!));
    // Quest Points heads its level column "Points".
    const levels = (column('Level') || column('Points')).split('<br>').map(s => s.trim()).filter(Boolean).map(num);
    const stamps = timeTitleTicks(column('Time'), tickMs);
    const n = Math.min(ranks.length, names.length, levels.length, stamps.length);
    if (n !== names.length || n !== ranks.length) throw new Error(`board columns disagree: ${ranks.length}/${names.length}/${levels.length}/${stamps.length}`);
    return Array.from({ length: n }, (_, i) => ({ rank: ranks[i]!, name: names[i]!, level: levels[i]!, ticks: stamps[i]!.ticks, ...rateOf(stamps[i]) }));
}

export interface PlayerRow {
    category: number;
    skill: string;
    rank: number | null;
    level: number | null;
    /** Hiscore stamp in ticks; null when the skill has no row (under level 15). */
    ticks: number | null;
    /** The rate the stamp's title stated or was converted under (TitleStamp.tickMs). */
    tickMs?: number;
}

/** The lowest level a skill row is written at; Overall is written at every save whatever the levels (LoginServer.ts updateHiscores). */
export const ROW_MIN_LEVEL = 15;

/** A row that exists on the page: a level and a stamp (skills under ROW_MIN_LEVEL have neither). */
export const isStamped = (r: PlayerRow): boolean => r.level !== null && r.ticks !== null;

/**
 * Whether the page shows any save. A player page exists from the account's first login, but its rows come
 * only from saves, and every save stamps Overall: a page whose Overall is blank was read before the first save.
 */
export const hasSave = (rows: readonly PlayerRow[]): boolean => rows.some(r => r.category === OVERALL && isStamped(r));

/**
 * Every row of a player page (Overall, each skill, Quest Points), in page order; null for a missing player.
 * `tickMs` converts seconds-form titles (see titleTicks); without it such a page throws TickRateNeeded.
 */
export function parsePlayer(html: string, tickMs?: number): PlayerRow[] | null {
    if (/Player "[^"]*" not found/.test(html)) return null;
    const rows: PlayerRow[] = [];
    // Row links carry whichever profile the page was requested with.
    const re = /<a href="\/hiscores\?category=(\d+)&profile=[^"&]*"[^>]*>(?:<img[^>]*>)?([^<]+)<\/a><\/td>\s*<td align="right">([^<]*)<\/td>\s*<td align="right">([^<]*)<\/td>\s*<td align="right">([\s\S]*?)<\/td>/g;
    for (const m of html.matchAll(re)) {
        const rank = m[3]!.trim();
        const level = m[4]!.trim();
        const stamp = timeTitleTicks(m[5]!, tickMs)[0];
        rows.push({
            category: Number(m[1]),
            skill: m[2]!.trim(),
            rank: rank === '-' ? null : num(rank),
            level: level === '-' ? null : num(level),
            ticks: stamp?.ticks ?? null,
            ...rateOf(stamp)
        });
    }
    if (rows.length === 0) throw new Error('player page: no skill rows parsed');
    return rows;
}

export interface Item {
    id: number;
    name: string;
    count: number;
    gp: number;
}

export interface ValueRow {
    rank: number;
    name: string;
    gp: number;
    items: Item[];
}

function splitRows(html: string): string[] {
    return html.split(/<tr>/).filter(r => /\/hiscores\/player\//.test(r) && /<td align="right">\d+<\/td>/.test(r));
}

/** Bank board (top items carry id and exact count) and its item search. */
export function parseBank(html: string): ValueRow[] {
    return splitRows(html).map(r => ({
        rank: num(r.match(/<td align="right">(\d+)<\/td>/)![1]!),
        name: decodeURIComponent(r.match(/\/hiscores\/player\/([^?"]+)\?/)![1]!),
        gp: num(r.match(/title="([\d,]+) gp"/)?.[1] ?? '0'),
        items: [...r.matchAll(/data-item-id="(\d+)" data-item-count="(\d+)" title="([^"]*?)(?: [\d.]+[KMB]?)? \(([\d,]+) gp\)"/g)].map(m => ({
            id: Number(m[1]),
            count: Number(m[2]),
            name: m[3]!,
            gp: num(m[4]!)
        }))
    }));
}

/** Equipment board: worn items as sprite images titled "Name (value gp)". */
export function parseOutfit(html: string): ValueRow[] {
    return splitRows(html).map(r => ({
        rank: num(r.match(/<td align="right">(\d+)<\/td>/)![1]!),
        name: decodeURIComponent(r.match(/\/hiscores\/player\/([^?"]+)\?/)![1]!),
        gp: num(r.match(/class="yellow" title="([\d,]+) gp"/)?.[1] ?? '0'),
        items: [...r.matchAll(/\/sprite\/item\/(\d+)\.png" title="([^"]*?) \(([\d,]+) gp\)"/g)].map(m => ({
            id: Number(m[1]),
            count: 1,
            name: m[2]!,
            gp: num(m[3]!)
        }))
    }));
}

// ---------------------------------------------------------------------------
// Analysis

export interface Stamp {
    skill: string;
    level: number;
    ticks: number;
    /** Ticks since the previous distinct stamp (the first stamp counts from 0). */
    gap: number;
    /** Shared with at least one other row: a logout-playtime fallback, or one event that levelled several skills. */
    batched: boolean;
}

export interface AccountAnalysis {
    total: number | null;
    overallTicks: number | null;
    stamps: Stamp[];
    batches: { ticks: number; skills: string[] }[];
    /** Rows whose stamp is later than the overall stamp: only a logout fallback can do that. */
    laterThanOverall: string[];
}

/**
 * Sorts every stamped row and groups identical stamps (docs/speedrun/research/competitors/hiscore-timestamps.md).
 * Quest Points takes part: its stamp is always a save-time playtime, so a skill sharing it is a logout value.
 * Overall does not: it always equals the largest stamp, so it would join every account's last batch.
 */
export function analyzeAccount(rows: PlayerRow[]): AccountAnalysis {
    const overall = rows.find(r => r.category === OVERALL);
    const stamped = rows.filter(r => r.category !== OVERALL && isStamped(r));
    const byTicks = new Map<number, string[]>();
    for (const r of stamped) byTicks.set(r.ticks!, [...(byTicks.get(r.ticks!) ?? []), r.skill]);
    const sorted = [...stamped].sort((a, b) => a.ticks! - b.ticks! || a.category - b.category);
    let prev = 0;
    const stamps = sorted.map(r => {
        const gap = r.ticks! - prev;
        prev = r.ticks!;
        return { skill: r.skill, level: r.level!, ticks: r.ticks!, gap, batched: byTicks.get(r.ticks!)!.length > 1 };
    });
    // Identical stamps after the first member of a batch carry a gap of 0; keep that, it is honest.
    const overallTicks = overall?.ticks ?? null;
    return {
        total: overall?.level ?? null,
        overallTicks,
        stamps,
        batches: [...byTicks].filter(([, s]) => s.length > 1).map(([ticks, skills]) => ({ ticks, skills })).sort((a, b) => a.ticks - b.ticks),
        laterThanOverall: overallTicks === null ? [] : stamped.filter(r => r.category !== QUEST_POINTS && r.ticks! > overallTicks).map(r => r.skill)
    };
}

export function renderAnalysis(name: string, a: AccountAnalysis): string {
    const lines = [`### ${name} (total ${a.total ?? '?'}, overall ${a.overallTicks?.toLocaleString('en-US') ?? '?'} ticks)`, '', '| # | Skill | Level | Stamp | Gap | Batched |', '|---|---|---|---|---|---|'];
    a.stamps.forEach((s, i) => lines.push(`| ${i + 1} | ${s.skill} | ${s.level} | ${s.ticks.toLocaleString('en-US')} | ${s.gap.toLocaleString('en-US')} | ${s.batched ? 'yes' : ''} |`));
    if (a.laterThanOverall.length) lines.push('', `Later than overall (fallback): ${a.laterThanOverall.join(', ')}`);
    return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Fetching

export class PoliteFetcher {
    private last = 0;
    requests = 0;
    constructor(
        private cacheDir: string,
        readonly startedAt = new Date(),
        /** Another hiscore server (a lab engine's HISCORES_WEB_PORT), default the demo. */
        readonly baseUrl = BASE_URL
    ) {
        mkdirSync(cacheDir, { recursive: true });
    }

    async get(path: string): Promise<string> {
        const file = join(this.cacheDir, path.replace(/^\//, '').replace(/[^\w.=-]+/g, '_') + '.html');
        if (existsSync(file)) return readFileSync(file, 'utf8');
        let lastError = '';
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            const wait = this.last + MIN_INTERVAL_MS - Date.now();
            if (wait > 0) await Bun.sleep(wait);
            this.last = Date.now();
            this.requests++;
            try {
                const res = await fetch(this.baseUrl + path, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
                const body = await res.text();
                // A missing player is a 404 page with a parseable "not found" message; keep it.
                if (res.ok || (res.status === 404 && /not found/.test(body))) {
                    writeFileSync(file, body);
                    return body;
                }
                lastError = `HTTP ${res.status}`;
            } catch (err) {
                lastError = err instanceof Error ? err.message : String(err);
            }
            await Bun.sleep(1000 * 2 ** attempt);
        }
        throw new Error(`${path}: gave up after ${MAX_ATTEMPTS} attempts (${lastError})`);
    }
}

const boardPath = (category: number, rank = 1) => `/hiscores?category=${category}&profile=main${rank > 1 ? `&rank=${rank}` : ''}`;
export const playerPath = (name: string) => `/hiscores/player/${encodeURIComponent(name)}?profile=main`;

export interface PlayerSnapshot {
    fetchedAt: string;
    rows: PlayerRow[] | null;
}

export interface Snapshot {
    takenAt: string;
    source: string;
    boards: Record<string, BoardRow[]>;
    bank: { top: ValueRow[]; searches: Record<string, ValueRow[]> };
    outfit: ValueRow[];
    players: Record<string, PlayerSnapshot>;
}

async function fetchPlayers(f: PoliteFetcher, names: Iterable<string>, into: Record<string, PlayerSnapshot>): Promise<void> {
    for (const name of names) {
        if (into[name]) continue;
        try {
            into[name] = { fetchedAt: f.startedAt.toISOString(), rows: parsePlayer(await f.get(playerPath(name))) };
        } catch (err) {
            console.error(`player ${name}: ${err instanceof Error ? err.message : err}`);
        }
    }
}

export async function fetchBoards(f: PoliteFetcher, overallPages: number): Promise<Record<string, BoardRow[]>> {
    const boards: Record<string, BoardRow[]> = {};
    const overall: BoardRow[] = [];
    for (let p = 0; p < overallPages; p++) overall.push(...parseBoard(await f.get(boardPath(OVERALL, 1 + p * BOARD_PAGE_SIZE))));
    boards.Overall = overall;
    for (const cat of [...Object.keys(SKILLS).map(Number), QUEST_POINTS]) {
        boards[CATEGORY_NAMES[cat]!] = [...parseBoard(await f.get(boardPath(cat))), ...parseBoard(await f.get(boardPath(cat, 1 + BOARD_PAGE_SIZE)))];
    }
    return boards;
}

export interface RowChange {
    name: string;
    skill: string;
    from: { level: number | null; ticks: number | null };
    to: { level: number | null; ticks: number | null };
}

/** Rows whose level or stamp changed between two snapshots; players absent from either side are skipped. */
export function diffPlayers(older: Record<string, PlayerSnapshot>, newer: Record<string, PlayerSnapshot>): RowChange[] {
    const changes: RowChange[] = [];
    for (const [name, snap] of Object.entries(newer)) {
        if (!older[name]) continue;
        const before = new Map((older[name].rows ?? []).map(r => [r.category, r]));
        for (const r of snap.rows ?? []) {
            const b = before.get(r.category);
            if (b?.level === r.level && b?.ticks === r.ticks) continue;
            changes.push({ name, skill: r.skill, from: { level: b?.level ?? null, ticks: b?.ticks ?? null }, to: { level: r.level, ticks: r.ticks } });
        }
    }
    return changes;
}

export async function takeSnapshot(f: PoliteFetcher, overallPages: number, extraPlayers: string[] = []): Promise<Snapshot> {
    const snap: Snapshot = { takenAt: f.startedAt.toISOString(), source: BASE_URL, boards: await fetchBoards(f, overallPages), bank: { top: [], searches: {} }, outfit: [], players: {} };
    const overall = snap.boards.Overall!;
    snap.bank.top = parseBank(await f.get('/hiscores/bank?profile=main'));
    for (const q of BANK_SEARCHES) snap.bank.searches[q] = parseBank(await f.get(`/hiscores/bank?profile=main&q=${encodeURIComponent(q)}`));
    snap.outfit = parseOutfit(await f.get('/hiscores/outfit?profile=main'));

    const scope = new Set<string>([...SEED_PLAYERS, ...extraPlayers]);
    overall.slice(0, 25).forEach(r => scope.add(r.name));
    for (const [board, rows] of Object.entries(snap.boards)) if (board !== 'Overall') rows.slice(0, 10).forEach(r => scope.add(r.name));
    snap.bank.top.slice(0, 25).forEach(r => scope.add(r.name));
    snap.outfit.slice(0, 25).forEach(r => scope.add(r.name));
    const seen = [...Object.values(snap.boards).flat(), ...snap.bank.top, ...snap.outfit, ...Object.values(snap.bank.searches).flat()];
    seen.filter(r => FAMILY_PATTERN.test(r.name)).forEach(r => scope.add(r.name));
    await fetchPlayers(f, scope, snap.players);
    return snap;
}

const stampName = (d: Date) => d.toISOString().replace(/[:]/g, '').replace(/\.\d+Z$/, 'Z');

async function main(): Promise<void> {
    const { values, positionals } = parseArgs({
        args: Bun.argv.slice(2),
        allowPositionals: true,
        options: { out: { type: 'string' }, tag: { type: 'string' }, 'overall-pages': { type: 'string' }, players: { type: 'string' }, cache: { type: 'string' } }
    });
    const [cmd, ...rest] = positionals;
    const out = values.out ? resolve(values.out) : DEFAULT_OUT;
    // --cache <stamp> rebuilds from an earlier run's raw HTML (and keeps that run's time) without refetching.
    const now = values.cache ? new Date(values.cache.replace(/^(\d{4}-\d\d-\d\dT\d\d)(\d\d)(\d\d)Z$/, '$1:$2:$3Z')) : new Date();
    if (Number.isNaN(now.getTime())) throw new Error(`--cache: not a run stamp: ${values.cache}`);
    const fetcher = () => new PoliteFetcher(join(CACHE_ROOT, stampName(now)), now);
    if (cmd === 'snapshot') {
        const f = fetcher();
        const snap = await takeSnapshot(f, Number(values['overall-pages'] ?? 10), values.players ? values.players.split(',') : []);
        mkdirSync(out, { recursive: true });
        const file = join(out, `snapshot-${stampName(now)}.json`);
        writeFileSync(file, JSON.stringify(snap));
        console.log(`${file}: ${Object.keys(snap.players).length} players, ${f.requests} requests`);
    } else if (cmd === 'players') {
        const f = fetcher();
        const players: Record<string, PlayerSnapshot> = {};
        await fetchPlayers(f, rest, players);
        mkdirSync(out, { recursive: true });
        const file = join(out, `${values.tag ?? 'players'}-${stampName(now)}.json`);
        writeFileSync(file, JSON.stringify({ takenAt: now.toISOString(), source: BASE_URL, players }));
        console.log(`${file}: ${Object.keys(players).length} players, ${f.requests} requests`);
    } else if (cmd === 'boards') {
        const f = fetcher();
        const boards = await fetchBoards(f, Number(values['overall-pages'] ?? 10));
        mkdirSync(out, { recursive: true });
        const file = join(out, `${values.tag ?? 'boards'}-${stampName(now)}.json`);
        writeFileSync(file, JSON.stringify({ takenAt: now.toISOString(), source: BASE_URL, boards }));
        console.log(`${file}: ${f.requests} requests`);
    } else if (cmd === 'diff') {
        const [a, b] = rest;
        if (!a || !b) throw new Error('diff needs two snapshot files');
        const load = (p: string) => JSON.parse(readFileSync(p, 'utf8')) as Pick<Snapshot, 'players' | 'takenAt'>;
        const older = load(a);
        const newer = load(b);
        console.log(`${older.takenAt} -> ${newer.takenAt}`);
        const fmt = (s: RowChange['from']) => `${s.level ?? '-'}@${s.ticks?.toLocaleString('en-US') ?? '-'}`;
        for (const c of diffPlayers(older.players, newer.players)) console.log(`${c.name}\t${c.skill}\t${fmt(c.from)} -> ${fmt(c.to)}`);
    } else if (cmd === 'analyze') {
        const [file, ...names] = rest;
        if (!file) throw new Error('analyze needs a snapshot file');
        const snap = JSON.parse(readFileSync(file, 'utf8')) as Pick<Snapshot, 'players'>;
        for (const name of names.length ? names : Object.keys(snap.players)) {
            const rows = snap.players[name]?.rows;
            if (rows) console.log(renderAnalysis(name, analyzeAccount(rows)) + '\n');
        }
    } else {
        console.error('usage: hiscore-scrape.ts snapshot|players|analyze ... (see the header comment)');
        process.exit(2);
    }
}

if (import.meta.main) await main();
