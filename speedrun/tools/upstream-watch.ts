#!/usr/bin/env bun
/**
 * Upstream watch: reports every upstream commit that touches a watched path, with its diff,
 * and any change to the demo server's hiscore #1. Design and usage: docs/speedrun/UPSTREAM-WATCH.md.
 *
 * Exit codes: 0 nothing to report, 1 findings, 2 tool or git error.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const TOOL_DIR = import.meta.dir;
const REPO_ROOT = resolve(TOOL_DIR, '../..');
export const DEFAULT_WATCHLIST = join(TOOL_DIR, 'upstream-watchlist.json');
export const DEFAULT_STATE = join(TOOL_DIR, 'upstream-watch.state.json');
export const DOC_PATH = join(REPO_ROOT, 'docs/speedrun/UPSTREAM-WATCH.md');

/** GitHub caps issue bodies and comments at 65,536 characters; leave room for the title prefix and footer. */
export const ISSUE_BODY_BUDGET = 60_000;
export const PER_FILE_DIFF_LINES = 300;
const HISCORE_TIMEOUT_MS = 60_000;
const USER_AGENT = 'rs-sdk-upstream-watch (+https://github.com/bleugreen/rs-sdk)';

/**
 * The operator's global git config rewrites https://github.com/ to SSH, which agent sandboxes
 * cannot reach. Upstream is public, so the cache repo ignores global and system config entirely.
 */
export const ISOLATED_GIT_ENV = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };

export class ToolError extends Error {}

// ---------------------------------------------------------------------------
// Watchlist and state

export interface WatchEntry {
    id: string;
    title: string;
    paths: string[];
    why: string;
    /** 0-based index of the path segment that names a sub-group (4 = the quest directory). */
    groupBy?: number;
    /** "stat" reports only +/- counts per file; for high-churn merge-relevance entries. */
    diff?: 'full' | 'stat';
}

export interface Watchlist {
    upstream: { url: string; branch: string; web: string };
    hiscores: { url: string };
    entries: WatchEntry[];
}

export interface HiscoreRecord {
    name: string;
    level: number;
    ticks: number;
    time: string;
}

export interface WatchState {
    upstream: { commit: string };
    hiscore: HiscoreRecord | null;
}

function isString(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

export function parseWatchlist(json: unknown): Watchlist {
    const w = json as Watchlist;
    if (!w || !w.upstream || !isString(w.upstream.url) || !isString(w.upstream.branch) || !isString(w.upstream.web)) {
        throw new ToolError('watchlist: upstream.url, upstream.branch and upstream.web are required');
    }
    if (!w.hiscores || !isString(w.hiscores.url)) {
        throw new ToolError('watchlist: hiscores.url is required');
    }
    if (!Array.isArray(w.entries) || w.entries.length === 0) {
        throw new ToolError('watchlist: entries must be a non-empty array');
    }
    const ids = new Set<string>();
    for (const e of w.entries) {
        if (!isString(e.id) || !isString(e.title) || !isString(e.why) || !Array.isArray(e.paths) || e.paths.length === 0 || !e.paths.every(isString)) {
            throw new ToolError(`watchlist: entry ${JSON.stringify(e.id)} needs id, title, why and a non-empty paths array`);
        }
        if (ids.has(e.id)) throw new ToolError(`watchlist: duplicate entry id ${e.id}`);
        ids.add(e.id);
        if (e.diff !== undefined && e.diff !== 'full' && e.diff !== 'stat') {
            throw new ToolError(`watchlist: entry ${e.id} has diff ${JSON.stringify(e.diff)}; use "full" or "stat"`);
        }
        if (e.groupBy !== undefined && (!Number.isInteger(e.groupBy) || e.groupBy < 0)) {
            throw new ToolError(`watchlist: entry ${e.id} groupBy must be a non-negative integer`);
        }
    }
    return w;
}

export function loadWatchlist(path: string): Watchlist {
    return parseWatchlist(JSON.parse(readFileSync(path, 'utf8')));
}

export function loadState(path: string): WatchState {
    const s = JSON.parse(readFileSync(path, 'utf8')) as WatchState;
    if (!s || !s.upstream || !isString(s.upstream.commit)) {
        throw new ToolError(`state ${path}: upstream.commit is required`);
    }
    return { upstream: { commit: s.upstream.commit }, hiscore: s.hiscore ?? null };
}

// ---------------------------------------------------------------------------
// Path attribution

/** Attributes a path to the first entry whose glob matches; entries are ordered specific-first. */
export class Matcher {
    private readonly compiled: { entry: WatchEntry; globs: InstanceType<typeof Bun.Glob>[] }[];

    constructor(readonly entries: WatchEntry[]) {
        this.compiled = entries.map(entry => ({ entry, globs: entry.paths.map(p => new Bun.Glob(p)) }));
    }

    attribute(path: string): WatchEntry | undefined {
        for (const { entry, globs } of this.compiled) {
            if (globs.some(g => g.match(path))) return entry;
        }
        return undefined;
    }

    /** Patterns that match none of `files`: usually an upstream rename that orphaned a watch. */
    stalePatterns(files: string[]): { entry: WatchEntry; pattern: string }[] {
        const stale: { entry: WatchEntry; pattern: string }[] = [];
        for (const { entry, globs } of this.compiled) {
            globs.forEach((g, i) => {
                if (!files.some(f => g.match(f))) stale.push({ entry, pattern: entry.paths[i]! });
            });
        }
        return stale;
    }
}

export function groupKey(entry: WatchEntry, path: string): string | undefined {
    if (entry.groupBy === undefined) return undefined;
    const segments = path.split('/');
    // A file directly in the watched directory has no group segment of its own.
    return segments.length > entry.groupBy + 1 ? segments[entry.groupBy] : '(top level)';
}

// ---------------------------------------------------------------------------
// Git

export interface FileChange {
    status: string;
    path: string;
    oldPath?: string;
}

export interface CommitInfo {
    sha: string;
    date: string;
    author: string;
    subject: string;
    files: FileChange[];
}

export interface WatchedFile {
    change: FileChange;
    entry: WatchEntry;
    group?: string;
}

interface GitResult {
    ok: boolean;
    stdout: string;
    stderr: string;
}

function runGit(args: string[], allowFail = false): GitResult {
    const proc = Bun.spawnSync(['git', ...args], { env: { ...process.env, ...ISOLATED_GIT_ENV }, stdout: 'pipe', stderr: 'pipe' });
    const result = { ok: proc.exitCode === 0, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
    if (!result.ok && !allowFail) {
        throw new ToolError(`git ${args.join(' ')} failed (${proc.exitCode}): ${result.stderr.trim()}`);
    }
    return result;
}

export class UpstreamCache {
    constructor(readonly gitDir: string) {}

    git(args: string[], allowFail = false): GitResult {
        return runGit([`--git-dir=${this.gitDir}`, '-c', 'core.quotePath=false', ...args], allowFail);
    }

    /** Blobless fetch of the upstream branch into refs/upstream/main; blobs arrive lazily when diffed. */
    fetch(url: string, branch: string): void {
        if (!existsSync(join(this.gitDir, 'HEAD'))) {
            mkdirSync(dirname(this.gitDir), { recursive: true });
            runGit(['init', '--bare', '--quiet', this.gitDir]);
        }
        const current = this.git(['config', '--get', 'remote.upstream.url'], true);
        if (!current.ok) this.git(['remote', 'add', 'upstream', url]);
        else if (current.stdout.trim() !== url) this.git(['remote', 'set-url', 'upstream', url]);
        this.git(['fetch', '--quiet', '--no-tags', '--filter=blob:none', 'upstream', `+refs/heads/${branch}:refs/upstream/main`]);
    }

    resolveCommit(rev: string): string | undefined {
        const r = this.git(['rev-parse', '--verify', '--quiet', `${rev}^{commit}`], true);
        return r.ok ? r.stdout.trim() : undefined;
    }

    isAncestor(ancestor: string, descendant: string): boolean {
        return this.git(['merge-base', '--is-ancestor', ancestor, descendant], true).ok;
    }

    log(base: string, head: string): CommitInfo[] {
        const out = this.git(['log', '--no-merges', '--reverse', '-M', '--name-status', '--format=%x1e%H%x1f%aI%x1f%an%x1f%s', `${base}..${head}`]);
        return parseLog(out.stdout);
    }

    countCommits(base: string, head: string): number {
        return Number(this.git(['rev-list', '--count', '--no-merges', `${base}..${head}`]).stdout.trim());
    }

    /** One diff call per commit, restricted to the watched paths, split back into per-file diffs. */
    diffs(sha: string, files: FileChange[]): Map<string, string> {
        const paths = [...new Set(files.flatMap(f => (f.oldPath ? [f.oldPath, f.path] : [f.path])))];
        const out = this.git(['show', '--format=', '--no-color', '-M', sha, '--', ...paths.map(p => `:(literal)${p}`)]);
        return splitDiff(out.stdout);
    }

    listFiles(rev: string): string[] {
        return this.git(['ls-tree', '-r', '--name-only', rev]).stdout.split('\n').filter(Boolean);
    }
}

export function parseLog(text: string): CommitInfo[] {
    const commits: CommitInfo[] = [];
    for (const record of text.split('\x1e')) {
        if (!record.trim()) continue;
        const [headerLine = '', ...rest] = record.split('\n');
        const [sha = '', date = '', author = '', subject = ''] = headerLine.split('\x1f');
        const files: FileChange[] = [];
        for (const line of rest) {
            if (!line) continue;
            const [status = '', a = '', b] = line.split('\t');
            if (status.startsWith('R') || status.startsWith('C')) files.push({ status: status[0]!, oldPath: a, path: b ?? a });
            else files.push({ status: status[0]!, path: a });
        }
        commits.push({ sha, date, author, subject, files });
    }
    return commits;
}

/** Splits `git show` output into per-file diffs keyed by the file's post-change path. */
export function splitDiff(text: string): Map<string, string> {
    const result = new Map<string, string>();
    const chunks = text.split(/^(?=diff --git )/m).filter(c => c.startsWith('diff --git '));
    for (const chunk of chunks) {
        const lines = chunk.split('\n');
        const find = (prefix: string) => lines.find(l => l.startsWith(prefix))?.slice(prefix.length);
        const plus = find('+++ b/');
        const path = find('rename to ') ?? plus ?? (find('+++ /dev/null') !== undefined ? find('--- a/') : undefined) ?? headerPath(lines[0]!);
        if (path !== undefined) result.set(path, chunk.replace(/\n+$/, ''));
    }
    return result;
}

function headerPath(header: string): string | undefined {
    // "diff --git a/P b/P" for an unrenamed file: P occupies exactly half of what remains.
    const rest = header.slice('diff --git a/'.length);
    const len = (rest.length - 3) / 2;
    if (!Number.isInteger(len)) return undefined;
    const p = rest.slice(0, len);
    return rest === `${p} b/${p}` ? p : undefined;
}

export function diffStat(diff: string): { added: number; removed: number; binary: boolean } {
    let added = 0;
    let removed = 0;
    let inHunk = false;
    for (const line of diff.split('\n')) {
        if (line.startsWith('@@')) inHunk = true;
        else if (!inHunk) continue;
        else if (line.startsWith('+')) added++;
        else if (line.startsWith('-')) removed++;
    }
    return { added, removed, binary: /^Binary files /m.test(diff) };
}

export function matchCommit(commit: CommitInfo, matcher: Matcher): WatchedFile[] {
    const watched: WatchedFile[] = [];
    for (const change of commit.files) {
        // A rename into or out of a watched path counts either way.
        let matchedPath = change.path;
        let entry = matcher.attribute(change.path);
        if (!entry && change.oldPath) {
            entry = matcher.attribute(change.oldPath);
            matchedPath = change.oldPath;
        }
        if (entry) watched.push({ change, entry, group: groupKey(entry, matchedPath) });
    }
    return watched;
}

// ---------------------------------------------------------------------------
// Hiscores

export function parseHiscoreTop(html: string): HiscoreRecord | undefined {
    const name = html.match(/href="\/hiscores\/player\/([^"?]+)\?profile=/)?.[1];
    const level = html.match(/<b>Level<\/b><br>\s*([\d,]+)<br>/)?.[1];
    const time = html.match(/<span title="([\d,]+) ticks"[^>]*>([^<]+)<\/span>/);
    if (!name || !level || !time) return undefined;
    return {
        name: decodeURIComponent(name),
        level: Number(level.replaceAll(',', '')),
        ticks: Number(time[1]!.replaceAll(',', '')),
        time: time[2]!.trim()
    };
}

export type HiscoreFetch = { status: 'ok'; record: HiscoreRecord } | { status: 'unreachable' | 'unparsed'; error: string } | { status: 'skipped' };

export async function fetchHiscoreTop(url: string): Promise<HiscoreFetch> {
    let html: string;
    try {
        const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(HISCORE_TIMEOUT_MS) });
        if (!res.ok) return { status: 'unreachable', error: `HTTP ${res.status} ${res.statusText}` };
        html = await res.text();
    } catch (err) {
        return { status: 'unreachable', error: err instanceof Error ? err.message : String(err) };
    }
    const record = parseHiscoreTop(html);
    return record ? { status: 'ok', record } : { status: 'unparsed', error: `could not find row 1 in ${html.length} characters of HTML` };
}

export interface HiscoreFinding {
    status: HiscoreFetch['status'];
    previous: HiscoreRecord | null;
    current?: HiscoreRecord;
    error?: string;
    /** True when #1's name, level or tick count differs from the state, or the page no longer parses. */
    finding: boolean;
}

export function compareHiscore(previous: HiscoreRecord | null, fetched: HiscoreFetch): HiscoreFinding {
    switch (fetched.status) {
        case 'ok': {
            const cur = fetched.record;
            const same = previous !== null && previous.name === cur.name && previous.level === cur.level && previous.ticks === cur.ticks;
            return { status: 'ok', previous, current: cur, finding: !same };
        }
        case 'unparsed':
            return { status: 'unparsed', previous, error: fetched.error, finding: true };
        case 'unreachable':
            return { status: 'unreachable', previous, error: fetched.error, finding: false };
        case 'skipped':
            return { status: 'skipped', previous, finding: false };
    }
}

// ---------------------------------------------------------------------------
// Report

export interface WatchedCommit {
    commit: CommitInfo;
    files: WatchedFile[];
    diffs: Map<string, string>;
}

export interface WatchReport {
    web: string;
    base: string;
    head: string;
    /** "ok", or the baseline is gone from upstream history ("missing") or not behind head ("not-ancestor"). */
    baseStatus: 'ok' | 'missing' | 'not-ancestor';
    commitsTotal: number;
    watched: WatchedCommit[];
    hiscore: HiscoreFinding;
    stale: { entry: WatchEntry; pattern: string }[];
    warnings: string[];
}

export function hasFindings(r: WatchReport): boolean {
    return r.baseStatus !== 'ok' || r.watched.length > 0 || r.hiscore.finding;
}

export const short = (sha: string) => sha.slice(0, 7);
const num = (n: number) => n.toLocaleString('en-US');
const cell = (s: string) => s.replaceAll('|', '\\|').replaceAll('\n', ' ');
const compareUrl = (r: WatchReport) => `${r.web}/compare/${r.base}...${r.head}`;
const describeHiscore = (h: HiscoreRecord) => `**${h.name}**, level ${num(h.level)}, ${h.time} (${num(h.ticks)} ticks)`;

export function reportTitle(r: WatchReport): string {
    const parts: string[] = [];
    if (r.baseStatus !== 'ok') parts.push(`upstream history rewritten (baseline ${short(r.base)} ${r.baseStatus === 'missing' ? 'not found' : 'not an ancestor'})`);
    if (r.watched.length > 0) {
        const n = r.watched.length;
        parts.push(`${short(r.base)}..${short(r.head)} (${n} commit${n === 1 ? '' : 's'} touch${n === 1 ? 'es' : ''} watched paths)`);
    }
    const h = r.hiscore;
    if (h.status === 'unparsed') parts.push('hiscores page format changed');
    else if (h.finding && h.current) {
        if (!h.previous) parts.push(`hiscore #1 recorded (${h.current.name})`);
        else if (h.previous.name !== h.current.name) parts.push(`hiscore #1 changed (${h.previous.name} → ${h.current.name})`);
        else parts.push(`hiscore #1 changed (${h.current.name} ${h.previous.time} → ${h.current.time})`);
    }
    return `Upstream watch: ${parts.length ? parts.join('; ') : 'nothing new'}`;
}

function renderHeader(r: WatchReport): string {
    const lines = [`## Upstream watch: \`${short(r.base)}\`..\`${short(r.head)}\``, ''];
    if (r.baseStatus !== 'ok') {
        lines.push(
            `**The recorded baseline \`${r.base}\` is ${r.baseStatus === 'missing' ? 'no longer in' : 'not an ancestor of'} upstream \`main\`**, so upstream rewrote or force-pushed its history. ` +
                `Nothing could be diffed and the baseline resets to \`${short(r.head)}\`. Review [upstream's recent commits](${r.web}/commits/${r.head}) by hand.`
        );
    } else {
        lines.push(`Upstream [${r.web.replace('https://github.com/', '')}](${r.web}): ${r.commitsTotal} commit${r.commitsTotal === 1 ? '' : 's'} in range, ${r.watched.length} touch${r.watched.length === 1 ? 'es' : ''} watched paths. [Compare on GitHub](${compareUrl(r)}).`);
    }
    return lines.join('\n');
}

function renderHiscore(h: HiscoreFinding): string {
    const lines = ['### Hiscore #1 (overall)', ''];
    switch (h.status) {
        case 'skipped':
            lines.push(`Not checked this run.${h.previous ? ` Last recorded: ${describeHiscore(h.previous)}.` : ''}`);
            break;
        case 'unreachable':
            lines.push(`Could not fetch the hiscores page (${h.error}). This is a warning only; the record stays ${h.previous ? describeHiscore(h.previous) : 'unset'}.`);
            break;
        case 'unparsed':
            lines.push(`**The hiscores page loaded but row 1 could not be parsed** (${h.error}). The ranking page's markup changed; check the hiscores entry's diffs and update \`parseHiscoreTop\`.`);
            break;
        case 'ok': {
            const cur = h.current!;
            if (!h.finding) lines.push(`Unchanged: ${describeHiscore(cur)}.`);
            else if (!h.previous) lines.push(`Recorded for the first time: ${describeHiscore(cur)}.`);
            else {
                const delta = cur.ticks - h.previous.ticks;
                const deltaText = delta === 0 ? 'the same tick count' : `${num(Math.abs(delta))} ticks ${delta < 0 ? 'faster' : 'slower'}`;
                lines.push(`**Changed** from ${describeHiscore(h.previous)} to ${describeHiscore(cur)}: ${deltaText}.`);
            }
        }
    }
    return lines.join('\n');
}

function entriesTouched(w: WatchedCommit): string {
    const titles: string[] = [];
    for (const f of w.files) {
        const t = f.group ? `${f.entry.title} (${f.group})` : f.entry.title;
        if (!titles.includes(t)) titles.push(t);
    }
    return titles.join(', ');
}

function renderCommitTable(r: WatchReport): string {
    if (r.watched.length === 0) return '';
    const rows = r.watched.map(w => `| [\`${short(w.commit.sha)}\`](${r.web}/commit/${w.commit.sha}) | ${w.commit.date.slice(0, 10)} | ${cell(w.commit.author)} | ${cell(w.commit.subject)} | ${cell(entriesTouched(w))} |`);
    return ['### Commits touching watched paths', '', '| Commit | Date | Author | Subject | Watched |', '|---|---|---|---|---|', ...rows].join('\n');
}

function fence(body: string): string {
    const longest = Math.max(0, ...[...body.matchAll(/`+/g)].map(m => m[0].length));
    const f = '`'.repeat(Math.max(3, longest + 1));
    return `${f}diff\n${body}\n${f}`;
}

const STATUS_WORDS: Record<string, string> = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed', C: 'copied', T: 'type changed' };

function fileLabel(change: FileChange): string {
    const word = STATUS_WORDS[change.status] ?? change.status;
    return change.oldPath ? `\`${change.oldPath}\` → \`${change.path}\` (${word})` : `\`${change.path}\` (${word})`;
}

/** The diff section as ordered pieces, so a budgeted render can stop between any two of them. */
function diffPieces(r: WatchReport, perFileLines: number): string[] {
    const pieces: string[] = [];
    for (const w of r.watched) {
        pieces.push(`#### [\`${short(w.commit.sha)}\`](${r.web}/commit/${w.commit.sha}) ${w.commit.subject}`);
        const groups = new Map<string, WatchedFile[]>();
        for (const f of w.files) {
            const key = f.group ? `${f.entry.id}\u0000${f.group}` : f.entry.id;
            groups.set(key, [...(groups.get(key) ?? []), f]);
        }
        for (const files of groups.values()) {
            const { entry, group } = files[0]!;
            const stat = entry.diff === 'stat';
            pieces.push(`**${entry.title}${group ? ` / ${group}` : ''}**${stat ? ' (counts only)' : ''}: ${entry.why}`);
            if (stat) {
                const list = files.map(f => {
                    const diff = w.diffs.get(f.change.path) ?? '';
                    const s = diffStat(diff);
                    return `- ${fileLabel(f.change)} ${s.binary ? 'binary' : `+${s.added} −${s.removed}`}`;
                });
                pieces.push(`${list.join('\n')}\n\nFull diff: [commit ${short(w.commit.sha)}](${r.web}/commit/${w.commit.sha}).`);
                continue;
            }
            for (const f of files) {
                const diff = w.diffs.get(f.change.path);
                if (diff === undefined) {
                    pieces.push(`${fileLabel(f.change)}: no textual diff.`);
                    continue;
                }
                const lines = diff.split('\n');
                const shown = lines.length > perFileLines ? lines.slice(0, perFileLines) : lines;
                const cut = lines.length - shown.length;
                pieces.push(`${fileLabel(f.change)}\n\n${fence(shown.join('\n'))}${cut > 0 ? `\n\n_${num(cut)} more diff lines in this file; see [the commit](${r.web}/commit/${w.commit.sha})._` : ''}`);
            }
        }
    }
    return pieces;
}

function renderTail(r: WatchReport): string {
    const out: string[] = [];
    if (r.stale.length > 0) {
        out.push(
            ['### Stale watchlist patterns', '', 'These patterns match no file in upstream any more. Upstream probably moved the code; update `speedrun/tools/upstream-watchlist.json`.', '', ...r.stale.map(s => `- ${s.entry.title}: \`${s.pattern}\``)].join('\n')
        );
    }
    if (r.warnings.length > 0) out.push(['### Warnings', '', ...r.warnings.map(w => `- ${w}`)].join('\n'));
    return out.join('\n\n');
}

/**
 * Renders the markdown report. With a budget, the header, hiscore section, commit table and tail
 * always appear; diffs follow in order, each capped at PER_FILE_DIFF_LINES, until the budget runs out.
 */
export function renderReport(r: WatchReport, budget = Infinity): string {
    const budgeted = Number.isFinite(budget);
    const fixedHead = [renderHeader(r), renderHiscore(r.hiscore), renderCommitTable(r)].filter(Boolean).join('\n\n');
    const tail = renderTail(r);
    const pieces = diffPieces(r, budgeted ? PER_FILE_DIFF_LINES : Infinity);
    const omitted = (n: number) => `_Diffs truncated to fit a GitHub issue: ${n} more section${n === 1 ? '' : 's'} omitted. Full diffs: [compare on GitHub](${compareUrl(r)}) and the \`upstream-watch-report\` artifact of this workflow run._`;

    const parts = [fixedHead];
    if (pieces.length > 0) {
        const reserve = tail.length + omitted(pieces.length).length + 64;
        let used = fixedHead.length + '\n\n### Diffs'.length;
        const shown: string[] = [];
        for (const piece of pieces) {
            if (used + piece.length + 2 + reserve > budget) break;
            shown.push(piece);
            used += piece.length + 2;
        }
        parts.push(['### Diffs', ...shown].join('\n\n'));
        if (shown.length < pieces.length) parts.push(omitted(pieces.length - shown.length));
    }
    if (tail) parts.push(tail);
    let out = parts.join('\n\n') + '\n';
    if (out.length > budget) {
        // Only reachable when the always-included sections alone overflow (thousands of commits).
        const marker = `\n\n_Report truncated to fit a GitHub issue. Full report: [compare on GitHub](${compareUrl(r)}) and the \`upstream-watch-report\` artifact._\n`;
        out = out.slice(0, budget - marker.length) + marker;
    }
    return out;
}

export interface WatchSummary {
    hasFindings: boolean;
    stateChanged: boolean;
    title: string;
    base: string;
    head: string;
    baseStatus: WatchReport['baseStatus'];
    commitsTotal: number;
    commitsWatched: number;
    watchedCommits: string[];
    hiscore: { status: HiscoreFinding['status']; changed: boolean; previous: HiscoreRecord | null; current: HiscoreRecord | null };
    hiscoreChanged: boolean;
    warnings: string[];
}

export function summarize(r: WatchReport, stateChanged: boolean): WatchSummary {
    return {
        hasFindings: hasFindings(r),
        stateChanged,
        title: reportTitle(r),
        base: r.base,
        head: r.head,
        baseStatus: r.baseStatus,
        commitsTotal: r.commitsTotal,
        commitsWatched: r.watched.length,
        watchedCommits: r.watched.map(w => w.commit.sha),
        hiscore: { status: r.hiscore.status, changed: r.hiscore.finding, previous: r.hiscore.previous, current: r.hiscore.current ?? null },
        hiscoreChanged: r.hiscore.finding,
        warnings: r.warnings
    };
}

/** State after this run: upstream advances to head; the hiscore record moves only on a successful parse. */
export function nextState(state: WatchState, r: WatchReport): WatchState {
    return { upstream: { commit: r.head }, hiscore: r.hiscore.status === 'ok' ? r.hiscore.current! : state.hiscore };
}

// ---------------------------------------------------------------------------
// Generated documentation table

export const DOC_START = '<!-- watchlist:start -->';
export const DOC_END = '<!-- watchlist:end -->';

export function renderWatchlistTable(w: Watchlist): string {
    const rows = w.entries.map(e => {
        const paths = e.paths.map(p => `\`${p}\``).join('<br>');
        const title = e.diff === 'stat' ? `${e.title} (counts only)` : e.groupBy !== undefined ? `${e.title} (grouped by directory)` : e.title;
        return `| ${cell(title)} | ${paths} | ${cell(e.why)} |`;
    });
    return ['| Entry | Paths | Why it matters |', '|---|---|---|', ...rows].join('\n');
}

export function replaceGeneratedSection(doc: string, table: string): string {
    const start = doc.indexOf(DOC_START);
    const end = doc.indexOf(DOC_END);
    if (start === -1 || end === -1 || end < start) throw new ToolError(`doc is missing the ${DOC_START} / ${DOC_END} markers`);
    return `${doc.slice(0, start + DOC_START.length)}\n${table}\n${doc.slice(end)}`;
}

// ---------------------------------------------------------------------------
// CLI

export interface RunOptions {
    watchlist: Watchlist;
    state: WatchState;
    cacheDir: string;
    since?: string;
    until?: string;
    hiscores: boolean;
}

export async function runWatch(opts: RunOptions): Promise<WatchReport> {
    const { watchlist, state } = opts;
    const cache = new UpstreamCache(opts.cacheDir);
    cache.fetch(watchlist.upstream.url, watchlist.upstream.branch);

    const head = cache.resolveCommit(opts.until ?? 'refs/upstream/main');
    if (!head) throw new ToolError(`cannot resolve --until ${opts.until} in upstream`);
    const baseRev = opts.since ?? state.upstream.commit;
    const base = cache.resolveCommit(baseRev);
    const baseStatus = !base ? 'missing' : cache.isAncestor(base, head) ? 'ok' : 'not-ancestor';

    const hiscorePromise = opts.hiscores ? fetchHiscoreTop(watchlist.hiscores.url) : Promise.resolve<HiscoreFetch>({ status: 'skipped' });
    const matcher = new Matcher(watchlist.entries);
    const watched: WatchedCommit[] = [];
    let commitsTotal = 0;
    if (baseStatus === 'ok') {
        commitsTotal = cache.countCommits(base!, head);
        for (const commit of cache.log(base!, head)) {
            const files = matchCommit(commit, matcher);
            if (files.length > 0) watched.push({ commit, files, diffs: cache.diffs(commit.sha, files.map(f => f.change)) });
        }
    }

    const hiscore = compareHiscore(state.hiscore, await hiscorePromise);
    const warnings: string[] = [];
    if (hiscore.status === 'unreachable') warnings.push(`Hiscores page unreachable: ${hiscore.error}. Not treated as a finding.`);

    const report: WatchReport = { web: watchlist.upstream.web, base: base ?? baseRev, head, baseStatus, commitsTotal, watched, hiscore, stale: [], warnings };
    // Only worth listing alongside other findings; a stale pattern alone never triggers a report.
    if (hasFindings(report)) report.stale = matcher.stalePatterns(cache.listFiles(head));
    return report;
}

function defaultCacheDir(): string {
    return join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'rs-upstream-watch', 'upstream.git');
}

const USAGE = `usage: bun speedrun/tools/upstream-watch.ts [--update] [--since SHA] [--until SHA] [--no-hiscores]
    [--state PATH] [--watchlist PATH] [--cache-dir PATH]
    [--report PATH] [--issue-body PATH] [--summary-json PATH] [--write-doc]`;

export async function main(argv: string[]): Promise<number> {
    const { values } = parseArgs({
        args: argv,
        options: {
            update: { type: 'boolean', default: false },
            since: { type: 'string' },
            until: { type: 'string' },
            'no-hiscores': { type: 'boolean', default: false },
            state: { type: 'string', default: DEFAULT_STATE },
            watchlist: { type: 'string', default: DEFAULT_WATCHLIST },
            'cache-dir': { type: 'string', default: defaultCacheDir() },
            report: { type: 'string' },
            'issue-body': { type: 'string' },
            'summary-json': { type: 'string' },
            'write-doc': { type: 'boolean', default: false },
            help: { type: 'boolean', default: false }
        },
        strict: true
    });
    if (values.help) {
        console.log(USAGE);
        return 0;
    }

    const watchlist = loadWatchlist(values.watchlist!);
    if (values['write-doc']) {
        writeFileSync(DOC_PATH, replaceGeneratedSection(readFileSync(DOC_PATH, 'utf8'), renderWatchlistTable(watchlist)));
        console.error(`wrote the watchlist table into ${DOC_PATH}`);
        return 0;
    }

    const state = loadState(values.state!);
    const report = await runWatch({ watchlist, state, cacheDir: values['cache-dir']!, since: values.since, until: values.until, hiscores: !values['no-hiscores'] });

    const next = nextState(state, report);
    const stateChanged = report.baseStatus !== 'ok' || report.base !== report.head || JSON.stringify(next.hiscore) !== JSON.stringify(state.hiscore);
    const full = renderReport(report);
    process.stdout.write(full);
    if (values.report) writeFileSync(values.report, full);
    if (values['issue-body']) writeFileSync(values['issue-body'], renderReport(report, ISSUE_BODY_BUDGET));
    if (values['summary-json']) writeFileSync(values['summary-json'], JSON.stringify(summarize(report, stateChanged), null, 2) + '\n');
    if (values.update && stateChanged) {
        writeFileSync(values.state!, JSON.stringify(next, null, 2) + '\n');
        console.error(`state updated: upstream ${short(next.upstream.commit)}${next.hiscore ? `, hiscore #1 ${next.hiscore.name}` : ''}`);
    }
    return hasFindings(report) ? 1 : 0;
}

if (import.meta.main) {
    try {
        process.exit(await main(process.argv.slice(2)));
    } catch (err) {
        console.error(`upstream-watch: ${err instanceof Error ? err.message : String(err)}`);
        if (!(err instanceof ToolError) && err instanceof Error && err.stack) console.error(err.stack);
        process.exit(2);
    }
}
