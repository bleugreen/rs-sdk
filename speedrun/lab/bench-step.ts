#!/usr/bin/env bun
// The step benchmark (cairn://p/rs/772): one step module evaluated the way autoresearch's train.py
// evaluates a model, on the lab engine only, cheaply and repeatably. Each of K runs is
// lab/dress-rehearsal.ts on a fresh lab account: --from=<the step's chunk> stages the chunk's start
// boundary (lab/boundary.ts: RUN-ORDER's levels, the ledger's pack and worn set, the quests before it,
// the first leg's start tile), run.ts's chain runs through --until=<the step>, and the run's tick log
// and --vitals file give the step's ticks, its pass or refusal, TICKMON's late / glued / gap counts
// over its minutes, its lowest HP and the food it ate.
//
//   LOCAL_STAFF_LEVEL=4 NODE_TICKRATE=150 LAB_RUNNERS=0 speedrun/lab/lab.sh benchlab 'speedrun/lab/bench-step.ts:S12:--k=3'
//   LOCAL_STAFF_LEVEL=4 NODE_TICKRATE=150 bun speedrun/lab/bench-step.ts <step> [--k=5] [--tick-ms=150] [--budget-min=M]
//       [--out=speedrun/lab/autoresearch/results.tsv] [--client=browser|lite] [--expected=N]
//       [--stub=<env>] [--ringers=<g1>,<g2>,<g3>] [--wine-giver=<lab.sh helper>] [--staff-steps=<id>,...]
//
// <step> is a RUN-ORDER id (S12), a range of consecutive ids (S10b..S12), or one chain step's name
// (woodcutting:oak-15-73, a band inside S07). Staging is at chunk granularity (boundary.ts chunkStart):
// the leg into the chunk and the chunk's steps before the target (S07's walk and normal band before
// its oak band) run as warm-up and are not counted. lab.sh's own bot (its first argument) is not used:
// every run logs in a new lab name, bench<tag><run>.
//
// Helpers: the launcher families a step meets (S03's droppers, S06's altar givers, S07's bone givers,
// S25a's anvil, H23's cannon holder) get fresh cairn_<tag><family><run><n> names per run, launched by
// dress-rehearsal.ts as it always does. The LAB_HELPERS families (S04's ring givers, S25c's wine giver)
// need lab.sh's lite runners, so their flags pass through as given. Hand-offs are staff-supplied
// (`supply: staff`, listed as a cheat) unless --stub names a stub giver. H12o's h45 is named in the
// config but never logs in (labRunConfig), so S15's top-up legs M and P each wait TOPUP_WAIT unanswered.
//
// Score (what a loop minimises): over the K runs that ran, a pass counts as the passing runs' median
// ticks and a failure as the ticks it spent + RUN-ORDER's manual restart + the step again (the restart
// line's "re-entering the interrupted step", priced at the step's expected), averaged. With no failure
// it is exactly the median over passing runs; a faster but flaky change loses.
//
// Output: one line per run, the summary beside RUN-ORDER's expected and best cells, each counted
// segment's median and range over the passing runs, `SCORE <n>`, a
// RESULT json line, and one row per run appended to results.tsv (untracked). Exit 0 the bench ran
// (the pass rate is in the summary), 2 usage, 3 refused (off a lab, a tick mismatch, a giver gap, or
// no run reached the step).

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { ROOT } from '../lib/session';
import { parseLog, type TickRow } from '../lib/ticks';
import { parseStepTable } from '../runner/chain';
import { STAFF_SUPPLY_STEP, STAND_IN_STEP } from '../runner/run-report';
import { S07_BONE_GIVERS } from './bone-launch';
import { formatBoundary, STAFF, type FamilyNeeds, type RehearsalPlan, type VitalsLine } from './dress-rehearsal';
import { DROPPERS } from './fm-row-launch';
import { labRefusal } from './stand-ins';

const DRESS = join(ROOT, 'speedrun/lab/dress-rehearsal.ts');
export const DEFAULT_K = 5;
export const RESULTS = join(ROOT, 'speedrun/lab/autoresearch/results.tsv');
/** S06's air-altar givers, one load each (SUPPLIES.md H5: 7 on the day). */
export const ALTAR_GIVERS = 7;
/** The run's measured castle lap (RUN-ORDER S03's row, rs/622's Commit A): the lab run config's firemakingTiles. */
export const CASTLE_LAP = '3222-3218@3219;3218-3243@3218;3242-3223@3219';
/** dress-rehearsal.ts flags a bench passes through unchanged. */
export const PASS_THROUGH = ['stub', 'ringers', 'wine-giver', 'staff-steps'] as const;

export interface BenchArgs {
    target: string;
    k: number;
    /** The engine's tick the bench must run at (null: the lab's NODE_TICKRATE). */
    tickMs: number | null;
    budgetMin: number | null;
    out: string;
    client: 'browser' | 'lite';
    /** The expected to score a band RUN-ORDER prices only inside its step (S07's oak band). */
    expected: number | null;
    /** dress-rehearsal.ts flags, `--name=value`. */
    pass: string[];
}

const positiveNumber = (flag: string, v: string): number => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`--${flag}=${v}: not a positive number`);
    return n;
};

/**
 * `[<lab.sh bot>] <step> [--flag=value | --flag value ...]`. Under lab.sh the bot comes first (ignored)
 * and a step name's colons arrive split, since lab.sh separates a script's arguments on `:`: with two
 * or more words, the first is the bot and the rest rejoin with `:` (bot woodcutting oak-15-73 ->
 * woodcutting:oak-15-73).
 */
export function benchArgs(argv: readonly string[]): BenchArgs {
    const positional: string[] = [];
    const flags: Record<string, string> = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]!;
        const m = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
        if (!m) {
            positional.push(arg);
            continue;
        }
        const value = m[2] ?? argv[++i];
        if (value === undefined) throw new Error(`--${m[1]} needs a value`);
        flags[m[1]!] = value;
    }
    if (!positional.length) throw new Error('expected [<lab.sh bot>] <step>, got nothing');
    const known = new Set(['k', 'tick-ms', 'budget-min', 'out', 'client', 'expected', ...PASS_THROUGH]);
    const unknown = Object.keys(flags).filter(f => !known.has(f));
    if (unknown.length) throw new Error(`unknown flag(s): ${unknown.map(f => `--${f}`).join(', ')}`);
    const k = flags.k === undefined ? DEFAULT_K : positiveNumber('k', flags.k);
    // Each run's index is one base-36 character of its account names.
    if (!Number.isInteger(k) || k > 35) throw new Error(`--k=${flags.k}: a whole number from 1 to 35`);
    const client = flags.client ?? 'browser';
    if (client !== 'browser' && client !== 'lite') throw new Error(`--client=${client}: browser or lite`);
    return {
        target: positional.length === 1 ? positional[0]! : positional.slice(1).join(':'),
        k,
        tickMs: flags['tick-ms'] === undefined ? null : positiveNumber('tick-ms', flags['tick-ms']),
        budgetMin: flags['budget-min'] === undefined ? null : positiveNumber('budget-min', flags['budget-min']),
        out: flags.out ?? RESULTS,
        client,
        expected: flags.expected === undefined ? null : positiveNumber('expected', flags.expected),
        pass: PASS_THROUGH.filter(f => flags[f] !== undefined).map(f => `--${f}=${flags[f]}`),
    };
}

// ------------------------------------------------------------------ the target on the chain

export type PlanStep = RehearsalPlan['chain'][number];

export interface Target {
    spec: string;
    /** The chain names whose rows are the target's ticks. */
    names: Set<string>;
    /** The counted step's last name in chain order: its ok row is the postcondition passing. */
    lastName: string;
    /** The RUN-ORDER ids the target spans (its expected is theirs; a band has its step's id). */
    ids: string[];
    /** One chain step inside an id (a band), which RUN-ORDER prices only as part of that id. */
    band: boolean;
    /** dress-rehearsal.ts --from (the chunk the target starts in) and --until. */
    chunk: string;
    until: string;
}

const ID = /^S\d\d[a-z]?$/;

export function resolveTarget(chain: readonly PlanStep[], spec: string): Target {
    const range = /^(S\d\d[a-z]?)\.\.(S\d\d[a-z]?)$/.exec(spec);
    let counted: PlanStep[];
    let until: string;
    let band = false;
    if (range) {
        const first = chain.findIndex(s => s.id === range[1]);
        const last = chain.findLastIndex(s => s.id === range[2]);
        if (first < 0) throw new Error(`${spec}: no step ${range[1]} on the chain`);
        if (last < 0) throw new Error(`${spec}: no step ${range[2]} on the chain`);
        if (last < first) throw new Error(`${spec}: ${range[2]} comes before ${range[1]} on the chain`);
        // A range is the stretch: its legs and hand-offs count, its 0-tick cue stops do not.
        counted = chain.slice(first, last + 1).filter(s => s.kind !== 'cue');
        until = range[2]!;
    } else if (ID.test(spec)) {
        // One id is RUN-ORDER's row: its own steps (S07's bands, not the T07a leg between them).
        counted = chain.filter(s => s.id === spec && s.kind !== 'cue');
        if (!counted.length) throw new Error(`${spec}: no step of that id on the chain`);
        until = spec;
    } else {
        const named = chain.filter(s => s.name === spec);
        if (!named.length) throw new Error(`${spec}: no chain step of that id or name`);
        if (named.length > 1) throw new Error(`${spec}: ${named.length} chain steps carry that name`);
        counted = named;
        until = spec;
        band = true;
    }
    const chunk = /^S\d\d/.exec(counted[0]!.id)?.[0];
    if (!chunk) throw new Error(`${spec}: starts on ${counted[0]!.id} (${counted[0]!.kind}), not a step: a bench stages a step's chunk`);
    const ids = [...new Set(counted.map(s => s.id).filter(id => ID.test(id)))];
    return { spec, names: new Set(counted.map(s => s.name)), lastName: counted.at(-1)!.name, ids, band, chunk, until };
}

// ------------------------------------------------------------------ one run's measurement

export interface RunMetrics {
    /** The counted rows' ticks: the step to its postcondition, or to where it failed. */
    ticks: number;
    /** The same ticks by counted chain step (a quest's segments, a skill's bands), in chain order. */
    bySegment: Record<string, number>;
    /** The counted rows logged (0: the run never reached the step). */
    rows: number;
    pass: boolean;
    refusal: string | null;
    /** Counted rows that failed before the step passed (a resume recovering them). */
    recovered: number;
    late: number;
    glued: number;
    gaps: number;
    /** TICKMON minutes overlapping the step's ticks (each counts whole). */
    minutes: number;
    /** The minutes' median measured tick period, ms. */
    periodMs: number | null;
    hpMin: number | null;
    food: number | null;
    cheats: string[];
}

const isStaffed = (r: TickRow) => r.step.startsWith(STAND_IN_STEP) || r.step.startsWith(STAFF_SUPPLY_STEP) || r.step.includes(`(${STAFF_SUPPLY_STEP})`);

export function median(xs: readonly number[]): number {
    if (!xs.length) throw new Error('median of nothing');
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** A failed phase's row is `<step>:<phase>` (runner/step.ts failRow): the step it belongs to. */
const stepOf = (row: string, names: ReadonlySet<string>) => (names.has(row) ? row : row.replace(/:[^:]+$/, ''));

export function runMetrics(rows: readonly TickRow[], vitals: readonly VitalsLine[], t: Target, exitCode: number): RunMetrics {
    const counted = rows.filter(r => !r.kind && t.names.has(stepOf(r.step, t.names)) && !isStaffed(r));
    const ticks = counted.reduce((a, r) => a + r.ticks, 0);
    const lastOk = counted.some(r => r.step === t.lastName && r.ok);
    const failed = counted.filter(r => !r.ok);
    const pass = exitCode === 0 && lastOk;
    const firstFail = failed[0] ?? rows.find(r => !r.kind && !r.ok);
    const refusal = pass ? null : firstFail ? `${counted.includes(firstFail) ? '' : 'before the step: '}${firstFail.step}: ${firstFail.error ?? 'failed'}` : null;

    const spans = counted.map(r => ({ sid: r.sessionId, start: r.startTick, end: r.endTick }));
    const inSpan = (sid: number, a: number, b: number) => spans.some(s => s.sid === sid && a <= s.end && b >= s.start);
    const mon = rows.filter(r => r.kind === 'tickmon' && inSpan(r.sessionId, r.startTick, r.endTick));
    const num = (r: TickRow, k: string) => (typeof r.meta?.[k] === 'number' ? (r.meta[k] as number) : 0);
    const periods = mon.map(r => r.meta?.periodMs).filter((p): p is number => typeof p === 'number');

    let hpMin: number | null = null;
    let food: number | null = null;
    for (const s of spans) {
        const lines = vitals.filter(v => v.sid === s.sid && v.tick <= s.end);
        const before = lines.filter(v => v.tick <= s.start).at(-1);
        const during = lines.filter(v => v.tick > s.start);
        let prev = before ?? during[0];
        if (!prev) continue;
        hpMin = Math.min(hpMin ?? prev.hp, prev.hp);
        food ??= 0;
        for (const v of during) {
            hpMin = Math.min(hpMin, v.hp);
            if (v.food < prev.food) food += prev.food - v.food;
            prev = v;
        }
    }

    const cheats = new Set<string>();
    for (const r of rows) {
        if (r.step.startsWith('(stage)')) {
            const unresolved = (r.meta?.unresolved as unknown[] | undefined)?.length ?? 0;
            cheats.add(`${r.step.replace(/^\(stage\) */, 'stage ')}${unresolved ? ` (${unresolved} unstaged)` : ''}`);
        } else if (r.step.startsWith(STAFF_SUPPLY_STEP)) cheats.add(r.step);
        else if (r.step.startsWith(STAND_IN_STEP)) cheats.add(r.step);
    }
    const bySegment: Record<string, number> = {};
    for (const name of t.names) {
        const own = counted.filter(r => stepOf(r.step, t.names) === name);
        if (own.length) bySegment[name] = own.reduce((x, r) => x + r.ticks, 0);
    }
    return {
        ticks,
        bySegment,
        rows: counted.length,
        pass,
        refusal,
        recovered: pass ? failed.length : 0,
        late: mon.reduce((a, r) => a + num(r, 'late'), 0),
        glued: mon.reduce((a, r) => a + num(r, 'glued'), 0),
        gaps: mon.reduce((a, r) => a + num(r, 'gaps'), 0),
        minutes: mon.length,
        periodMs: periods.length ? median(periods) : null,
        hpMin,
        food,
        cheats: [...cheats],
    };
}

export interface SegmentLine {
    name: string;
    /** Passing runs that logged the segment. */
    n: number;
    median: number;
    min: number;
    max: number;
}

/**
 * Each counted segment across the passing runs: median and range. A loop judges a segment by its
 * own spread (a walk or dialogue segment repeats within a few ticks; a fight's rolls spread tens),
 * which a whole-step median at small K hides.
 */
export function segmentTable(names: Iterable<string>, passing: readonly Record<string, number>[]): SegmentLine[] {
    return [...names].flatMap(name => {
        const xs = passing.map(p => p[name]).filter((x): x is number => x !== undefined);
        return xs.length ? [{ name, n: xs.length, median: median(xs), min: Math.min(...xs), max: Math.max(...xs) }] : [];
    });
}

export function formatSegments(table: readonly SegmentLine[]): string[] {
    const w = Math.max(7, ...table.map(s => s.name.length));
    return [`  ${'segment'.padEnd(w)}  median  min-max  (range)`, ...table.map(s => `  ${s.name.padEnd(w)}  ${String(s.median).padStart(6)}  ${`${s.min}-${s.max}`.padStart(7)}  (${s.max - s.min})${s.n < table[0]!.n ? ` n=${s.n}` : ''}`)];
}

// ------------------------------------------------------------------ the score

/** RUN-ORDER's manual-restart line: the ticks any thrown step costs before it is re-entered. */
export function restartTicks(runOrder: string): { ticks: number; line: string } {
    const m = /\*\*Any step that throws\*\* costs a manual restart, \*\*~(\d+(?:\.\d+)?) ticks([^*]*)\*\*/.exec(runOrder);
    if (!m) throw new Error("RUN-ORDER.md: no '**Any step that throws** costs a manual restart, **~N ticks' line");
    return { ticks: Number(m[1]), line: m[0].replace(/\*\*/g, '') };
}

/** What a failed run costs: the ticks it spent, the manual restart, then the step again from its start. */
export function failurePrice(spent: number, expected: number, restart: number): number {
    return spent + restart + expected;
}

export interface Scored {
    pass: boolean;
    ticks: number;
    /** The run never reached the step (a refusal before it, a setup failure): not scored. */
    refused: boolean;
}

/** The bench's score (lower is better), or null when no run reached the step or a failure has no price. */
export function benchScore(runs: readonly Scored[], expected: number | null, restart: number): number | null {
    const valid = runs.filter(r => !r.refused);
    if (!valid.length) return null;
    const passes = valid.filter(r => r.pass).map(r => r.ticks);
    const fails = valid.filter(r => !r.pass);
    const price = expected ?? (passes.length ? median(passes) : null);
    if (fails.length && price === null) return null;
    const total = (passes.length ? passes.length * median(passes) : 0) + fails.reduce((a, r) => a + failurePrice(r.ticks, price!, restart), 0);
    return Math.round((total / valid.length) * 10) / 10;
}

/** RUN-ORDER section 2's expected and best for the target: an id's cells, a range's sums, a band's step for context. */
export function runOrderCells(runOrder: string, t: Target): { expected: number | null; best: number | null; text: string } {
    const table = new Map(parseStepTable(runOrder).map(r => [r.id, r]));
    const rows = t.ids.map(id => table.get(id));
    if (t.band) {
        const r = rows[0];
        return { expected: null, best: null, text: `RUN-ORDER prices ${t.ids[0]} whole (expected ${r?.expected ?? '-'}, best ${r?.best ?? '-'}), not the band` };
    }
    const sum = (k: 'expected' | 'best') => (rows.every(r => r && r[k] !== null) ? Math.round(rows.reduce((a, r) => a + r![k]!, 0) * 10) / 10 : null);
    const expected = sum('expected');
    const best = sum('best');
    const legs = t.ids.length > 1 ? ' (the ids summed; legs and hand-offs between them unpriced)' : '';
    return { expected, best, text: `RUN-ORDER ${t.ids.join('+')} expected ${expected ?? '-'} best ${best ?? '-'}${legs}` };
}

// ------------------------------------------------------------------ accounts and the lab config

/** A run's fresh lab names: SCORED bench<tag><run>, a launcher-family helper cairn_<tag><family><run><n>. */
export function benchNames(tag: string, run: number): { scored: string; helper: (family: string, n: number) => string } {
    if (!/^[a-z0-9]{3}$/.test(tag)) throw new Error(`bench tag ${tag}: three of [a-z0-9]`);
    const r = run.toString(36);
    return { scored: `bench${tag}${r}`, helper: (family, n) => `cairn_${tag}${family}${r}${n.toString(36)}` };
}

/** The launcher families' flags for run `run`: fresh names in each family a step meets. */
export function helperFlags(needs: FamilyNeeds, tag: string, run: number): string[] {
    const { helper } = benchNames(tag, run);
    const many = (family: string, n: number) => Array.from({ length: n }, (_, i) => helper(family, i + 1)).join(',');
    return [
        ...(needs.droppers ? [`--droppers=${many('d', DROPPERS)}`] : []),
        ...(needs.altar ? [`--altar-givers=${many('a', ALTAR_GIVERS)}`] : []),
        ...(needs.bones ? [`--bone-givers=${many('b', S07_BONE_GIVERS)}`] : []),
        ...(needs.anvil ? [`--anvil=${helper('v', 1)}`] : []),
        ...(needs.holder ? [`--cannon-holder=${helper('c', 1)}`] : []),
    ];
}

/** The LAB_HELPERS families a slice meets whose flag the operator did not pass (they need lab.sh's lite runners). */
export function unservedLiteFamilies(needs: FamilyNeeds, pass: readonly string[]): string[] {
    const has = (f: string) => pass.some(p => p.startsWith(`--${f}=`));
    return [
        ...(needs.rings && !has('ringers') ? ['S04 needs its ring givers: --ringers=<g1>,<g2>,<g3>, lab.sh LAB_HELPERS accounts'] : []),
        ...(needs.wine && !has('wine-giver') ? ['S25c needs its wine giver: --wine-giver=<a LAB_HELPERS account>'] : []),
    ];
}

/** The h12o block's staging lead: h45 logs in ~300 ticks before the ladder's top (mule.md). Nothing reads it on the lab. */
export const H12O_LEAD_TICKS = 300;

/**
 * A lab run config every row of which is staff-supplied unless a flag names its helper. Its h12o block
 * names a lab h45 (`cairn_<tag>h45`) that never logs in, with its role and login folders under the
 * bench's `dir`, as rs/764's full-chain rehearsal ran it: the login trigger before S15:M writes a cue
 * nobody reads, and Monkey Madness's two top-up legs go unanswered (TOPUP_WAIT each, then on). Without
 * the block the trigger refuses, so no slice that crosses it could pass.
 */
export function labRunConfig(dir: string, tag: string): Record<string, unknown> {
    benchNames(tag, 1);
    return {
        partners: { H4m: STAFF }, firemakingTiles: CASTLE_LAP, rings: { giver: STAFF }, bones: { giver: STAFF }, courier: { giver: STAFF, below: 2 }, anvil: { giver: STAFF },
        h12o: { account: `cairn_${tag}h45`, cueDir: join(dir, 'h45-cue'), loginDir: join(dir, 'h45-login'), leadTicks: H12O_LEAD_TICKS },
    };
}

function writeBotEnv(name: string): string {
    const dir = join(ROOT, 'bots', name);
    if (existsSync(dir)) throw new Error(`bots/${name} already exists: a bench run logs in a fresh lab name`);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const web = process.env.WEB_PORT ?? '9300';
    const agent = process.env.AGENT_PORT ?? '8300';
    writeFileSync(join(dir, 'bot.env'), `BOT_USERNAME=${name}\nPASSWORD=${randomBytes(6).toString('hex')}\nSERVER=localhost:${web}\nGATEWAY_URL=ws://localhost:${agent}\nSHOW_CHAT=false\nTELEMETRY=false\n`, { mode: 0o600 });
    return dir;
}

// ------------------------------------------------------------------ results.tsv

/** `secs`: the run's wall time, staging and helpers included, for sizing K against a loop's budget. */
export const TSV_COLUMNS = ['commit', 'target', 'tick_ms', 'run', 'account', 'status', 'ticks', 'score', 'secs', 'late', 'glued', 'gaps', 'hp_min', 'food', 'cheats', 'notes', 'log', 'at'] as const;

export function tsvRow(row: Readonly<Record<(typeof TSV_COLUMNS)[number], string | number | null>>): string {
    return TSV_COLUMNS.map(c => String(row[c] ?? '').replace(/[\t\r\n]+/g, ' ')).join('\t') + '\n';
}

export function appendResults(path: string, rows: readonly string[]): void {
    mkdirSync(join(path, '..'), { recursive: true });
    if (!existsSync(path)) writeFileSync(path, TSV_COLUMNS.join('\t') + '\n');
    for (const r of rows) appendFileSync(path, r);
}

/** The commit under test: BENCH_COMMIT, else git's short HEAD (+dirty when tracked files differ), else unknown (a git-archive tree). */
export function commitLabel(env: Record<string, string | undefined> = process.env): string {
    if (env.BENCH_COMMIT) return env.BENCH_COMMIT;
    const head = Bun.spawnSync(['git', 'rev-parse', '--short=12', 'HEAD'], { cwd: ROOT, stderr: 'ignore' });
    if (head.exitCode !== 0) return 'unknown';
    const dirty = Bun.spawnSync(['git', 'status', '--porcelain', '--untracked-files=no'], { cwd: ROOT, stderr: 'ignore' });
    return `${head.stdout.toString().trim()}${dirty.stdout.toString().trim() ? '+dirty' : ''}`;
}

// ------------------------------------------------------------------ the runs

interface Child {
    code: number;
    timedOut: boolean;
    /** The child's REFUSED and outcome lines, for a run that logged no failing row. */
    said: string[];
}

/** dress-rehearsal.ts with `args`, its output to `out` (and ours, prefixed), SIGTERM at the budget, SIGKILL 30 s later. */
async function rehearse(args: readonly string[], o: { out: string; label: string; budgetMs: number }): Promise<Child> {
    // --no-install: puppeteer's import breaks under Bun's auto-install (executor-batches skill).
    const proc = Bun.spawn(['bun', '--no-install', DRESS, ...args], { cwd: ROOT, stdout: 'pipe', stderr: 'pipe', env: process.env });
    let timedOut = false;
    let kill: ReturnType<typeof setTimeout> | null = null;
    const term = setTimeout(() => {
        timedOut = true;
        proc.kill('SIGTERM');
        kill = setTimeout(() => proc.kill('SIGKILL'), 30_000);
    }, o.budgetMs);
    const said: string[] = [];
    const pump = async (stream: ReadableStream<Uint8Array>) => {
        const dec = new TextDecoder();
        const reader = stream.getReader();
        let carry = '';
        for (let r = await reader.read(); !r.done; r = await reader.read()) {
            const text = carry + dec.decode(r.value, { stream: true });
            const lines = text.split('\n');
            carry = lines.pop()!;
            for (const l of lines) {
                appendFileSync(o.out, l + '\n');
                console.log(`${o.label} ${l}`);
                if (/REFUSED|StepError|Terminated|failed:|error:/i.test(l)) said.push(l.trim());
            }
        }
        if (carry) appendFileSync(o.out, carry + '\n');
    };
    await Promise.all([pump(proc.stdout), pump(proc.stderr)]);
    const code = await proc.exited;
    clearTimeout(term);
    if (kill) clearTimeout(kill);
    return { code, timedOut, said };
}

async function plan(bot: string, config: string, args: readonly string[], file: string, label: string, out: string): Promise<RehearsalPlan> {
    rmSync(file, { force: true });
    const r = await rehearse([`--bot=${bot}`, `--config=${config}`, `--plan-out=${file}`, '--plan-only=1', ...args], { out, label, budgetMs: 120_000 });
    if (!existsSync(file)) throw new Error(`dress-rehearsal --plan-only wrote no plan (exit ${r.code}): ${r.said.join(' | ') || `see ${out}`}`);
    return JSON.parse(readFileSync(file, 'utf8')) as RehearsalPlan;
}

const readJsonl = <T>(path: string): T[] => (existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as T) : []);

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface RunResult extends RunMetrics, Scored {
    run: number;
    account: string;
    score: number | null;
    secs: number;
    notes: string;
    log: string;
}

async function main(argv: string[]): Promise<number> {
    let a: BenchArgs;
    try {
        a = benchArgs(argv);
    } catch (e) {
        console.error(`bench-step: ${message(e)}`);
        console.error('usage: LOCAL_STAFF_LEVEL=4 NODE_TICKRATE=<ms> bun speedrun/lab/bench-step.ts <S12 | S10b..S12 | step name> [--k=5] [--tick-ms=N] [--budget-min=M] [--out=results.tsv] [--client=browser|lite] [--expected=N] [--stub=..] [--ringers=..] [--wine-giver=..] [--staff-steps=..]');
        return 2;
    }
    const web = process.env.WEB_PORT ?? '9300';
    const agent = process.env.AGENT_PORT ?? '8300';
    const refusal = labRefusal({ staffLevel: process.env.LOCAL_STAFF_LEVEL, server: `localhost:${web}`, gateway: `ws://localhost:${agent}` });
    if (refusal) {
        console.error(`[bench] REFUSED: ${refusal}`);
        return 3;
    }
    // The engine's tick is set when the lab starts (lab.sh NODE_TICKRATE); the bench only checks it.
    const labTick = Number(process.env.NODE_TICKRATE);
    if (!(labTick > 0)) {
        console.error('[bench] REFUSED: NODE_TICKRATE is unset: run inside lab.sh, or export the running lab engine\'s NODE_TICKRATE');
        return 3;
    }
    if (a.tickMs !== null && a.tickMs !== labTick) {
        console.error(`[bench] REFUSED: --tick-ms=${a.tickMs}, but this lab's engine ticks at NODE_TICKRATE=${labTick}; start the lab with NODE_TICKRATE=${a.tickMs}`);
        return 3;
    }
    const runOrder = readFileSync(join(ROOT, 'docs/speedrun/RUN-ORDER.md'), 'utf8');
    const restart = restartTicks(runOrder);
    const commit = commitLabel();
    const tag = randomBytes(8).toString('hex').replace(/[^a-z0-9]/g, '').slice(0, 3).padEnd(3, '0');
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '');
    const dir = join(process.env.LAB_LOG ?? tmpdir(), 'bench', `${a.target.replace(/[^A-Za-z0-9.-]+/g, '_')}-${stamp}-${tag}`);
    mkdirSync(dir, { recursive: true });
    const config = join(dir, 'lab-run.json');
    writeFileSync(config, JSON.stringify(labRunConfig(dir, tag), null, 2));
    console.log(`[bench] ${a.target} x${a.k} at ${labTick} ms on commit ${commit}; tag ${tag}; files in ${dir}`);

    // The chain itself resolves the target, then the slice's own plan names its families.
    const probe = benchNames(tag, 0).scored;
    const probeDir = writeBotEnv(probe);
    let target: Target;
    let slice: RehearsalPlan;
    try {
        const whole = await plan(probe, config, [], join(dir, 'plan-chain.json'), '[plan]', join(dir, 'plan.out'));
        target = resolveTarget(whole.chain, a.target);
        slice = await plan(probe, config, [`--from=${target.chunk}`, `--until=${target.until}`, ...a.pass], join(dir, 'plan-slice.json'), '[plan]', join(dir, 'plan.out'));
    } catch (e) {
        console.error(`[bench] REFUSED: ${message(e)}`);
        return 3;
    } finally {
        rmSync(probeDir, { recursive: true, force: true });
    }
    const lite = unservedLiteFamilies(slice.needs, a.pass);
    if (lite.length) {
        for (const l of lite) console.error(`[bench] REFUSED: ${l}`);
        return 3;
    }
    const cells = runOrderCells(runOrder, target);
    const expected = a.expected ?? cells.expected;
    const budgetMin = a.budgetMin ?? (expected ? Math.max(10, Math.ceil((3 * expected * labTick) / 60_000) + 8) : 30);
    const families = helperFlags(slice.needs, tag, 1).map(f => f.replace(/=.*/, ''));
    console.log(`[bench] ${target.names.size} counted step(s) (${[...target.names].join(', ')}), from chunk ${target.chunk} at chain index ${slice.from} to ${target.until}; ${cells.text}${a.expected ? `; --expected ${a.expected}` : ''}`);
    console.log(`[bench] boundary: ${slice.boundary ? formatBoundary(slice.boundary) : 'none (from the start)'}${slice.boundary?.unresolved.length ? `; NOT STAGED ${slice.boundary.unresolved.join('; ')}` : ''}`);
    console.log(`[bench] helpers per run: ${families.join(' ') || 'none'}${a.pass.length ? `; passed through ${a.pass.join(' ')}` : ''}; budget ${budgetMin} min a run; a failure costs its ticks + ${restart.ticks} (restart) + ${expected ?? 'the passing median'}`);

    const results: RunResult[] = [];
    for (let run = 1; run <= a.k; run++) {
        const names = benchNames(tag, run);
        const runDir = join(dir, `run${run}`);
        mkdirSync(runDir, { recursive: true });
        const log = join(runDir, 'run.jsonl');
        const vitals = join(runDir, 'vitals.jsonl');
        const planFile = join(runDir, 'plan.json');
        const label = `[run ${run}/${a.k}]`;
        const botDir = writeBotEnv(names.scored);
        const t0 = Date.now();
        let child: Child;
        try {
            child = await rehearse(
                [`--bot=${names.scored}`, `--config=${config}`, `--from=${target.chunk}`, `--until=${target.until}`, `--client=${a.client}`, `--log=${log}`, `--vitals=${vitals}`, `--plan-out=${planFile}`, ...helperFlags(slice.needs, tag, run), ...a.pass],
                { out: join(runDir, 'dress.out'), label, budgetMs: budgetMin * 60_000 },
            );
        } finally {
            rmSync(botDir, { recursive: true, force: true });
        }
        const secs = Math.round((Date.now() - t0) / 1000);
        const chain = existsSync(planFile) ? (JSON.parse(readFileSync(planFile, 'utf8')) as RehearsalPlan).chain : slice.chain;
        const m = runMetrics(existsSync(log) ? parseLog(readFileSync(log, 'utf8')) : [], readJsonl<VitalsLine>(vitals), resolveTarget(chain, a.target), child.code);
        const refused = m.rows === 0;
        const refusal = child.timedOut ? `budget: ${budgetMin} min passed${m.refusal ? `; ${m.refusal}` : ''}` : m.refusal ?? (m.pass ? null : child.said.at(-1) ?? `exit ${child.code}`);
        const notes = [
            refusal,
            m.recovered ? `${m.recovered} failed attempt(s) recovered` : null,
            m.periodMs !== null && Math.abs(m.periodMs - labTick) > 0.2 * labTick ? `measured tick period ${m.periodMs} ms` : null,
        ].filter(Boolean).join('; ');
        const score = refused ? null : m.pass ? m.ticks : expected !== null ? failurePrice(m.ticks, expected, restart.ticks) : null;
        const r: RunResult = { ...m, run, account: names.scored, refused, score, secs, notes, log };
        results.push(r);
        const status = refused ? 'refused' : m.pass ? 'pass' : 'fail';
        appendResults(a.out, [tsvRow({ commit, target: a.target, tick_ms: labTick, run, account: names.scored, status, ticks: refused ? null : m.ticks, score, secs, late: m.late, glued: m.glued, gaps: m.gaps, hp_min: m.hpMin, food: m.food, cheats: m.cheats.join('; '), notes, log, at: new Date().toISOString() })]);
        console.log(`[bench] run ${run}/${a.k} ${status}: ${refused ? '-' : m.ticks} ticks in ${secs} s; TICKMON ${m.minutes} min late ${m.late} glued ${m.glued} gaps ${m.gaps}; hp min ${m.hpMin ?? '-'}; food ${m.food ?? '-'}; cheats ${m.cheats.join(', ') || 'none'}${notes ? `; ${notes}` : ''}`);
    }

    const ran = results.filter(r => !r.refused);
    const passed = ran.filter(r => r.pass);
    const ticks = passed.map(r => r.ticks);
    const score = benchScore(results, expected, restart.ticks);
    const spread = ticks.length ? `median ${median(ticks)} (min ${Math.min(...ticks)}, max ${Math.max(...ticks)})` : 'no pass';
    const sum = (k: 'late' | 'glued' | 'gaps') => ran.reduce((x, r) => x + r[k], 0);
    console.log(`\nBENCH ${a.target} @${labTick}ms K=${a.k}: ${spread}, pass ${passed.length}/${a.k}${ran.length < a.k ? ` (${a.k - ran.length} never reached the step)` : ''}; score ${score ?? '-'} | ${cells.text}${a.expected ? `; scored against --expected ${a.expected}` : ''} | TICKMON late ${sum('late')} glued ${sum('glued')} gaps ${sum('gaps')} | commit ${commit}`);
    const segments = segmentTable(target.names, passed.map(r => r.bySegment));
    if (segments.length) console.log(formatSegments(segments).join('\n'));
    console.log(`SCORE ${score ?? 'none'}`);
    console.log(`RESULT bench-step ${JSON.stringify({ target: a.target, tickMs: labTick, k: a.k, commit, score, expected, best: cells.best, restart: restart.ticks, segments, runs: results.map(({ run, account, pass, refused, ticks, bySegment, score, secs, late, glued, gaps, minutes, hpMin, food, cheats, notes, log }) => ({ run, account, pass, refused, ticks, bySegment, score, secs, late, glued, gaps, minutes, hpMin, food, cheats, notes, log })) })}`);
    console.log(`[bench] results appended to ${a.out}`);
    return ran.length ? 0 : 3;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
