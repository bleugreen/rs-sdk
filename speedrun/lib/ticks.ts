// Tick instrumentation: one JSONL row per measured step, and a per-step report.
//
//   bun speedrun/lib/ticks.ts report speedrun/runs/<runId>.jsonl
//
// The scored quantity is in-world ticks, read from `state.tick`. The client
// counter resets when the client relaunches, so a step that spans a relaunch
// is flagged `crossedSession` and its tick count is a lower bound (a dropped
// connection keeps the player in the world for ticks nobody observed). An
// in-page login (session.ts) starts a new game session on the same count, so a
// step spanning one is still its plain end minus start.

import { appendFileSync, mkdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import type { StateSource } from './wait';
import { tickMs } from './wait';

/**
 * Annotation rows describe the run rather than one stretch of it, so they overlap the step rows:
 * `session` (client tick 0 to the logout click), `program` (an in-page program's final status),
 * `gate` (a gate reading taken before or during the run), `reach` (the tick a level was first
 * observed), `hiscore` (the public row read after logout, against the log), `players` (a
 * /playercount read during the attempt), `tickmon` (one minute of the in-run tick-cadence monitor,
 * tick-monitor.ts; its `ticks` are the tick arrivals it read), `note` (figures a step records about
 * its own run, such as a fight's cast count, written with `logNote`), `travel` (a transition leg's per-hop breakdown, runner/legs.ts,
 * overlapping that leg's step row), `tabmem` (one minute of the browser tab's memory, tab-memory.ts). `report` lists them
 * apart and never sums them into the total. A row without a kind is a step, boundary or runner
 * row, and the step and boundary rows together cover the run.
 */
export type RowKind = 'session' | 'program' | 'gate' | 'reach' | 'hiscore' | 'players' | 'tickmon' | 'note' | 'travel' | 'tabmem';

export interface TickRow {
    v: 1;
    kind?: RowKind;
    runId: string;
    account: string;
    sessionId: number;
    step: string;
    startTick: number;
    endTick: number;
    ticks: number;
    wallMs: number;
    ok: boolean;
    error?: string;
    meta?: Record<string, unknown>;
    crossedSession?: boolean;
    tickMs: number;
    at: string;
}

const DEFAULT_DIR = join(import.meta.dir, '..', 'runs');

export class TickLog {
    readonly rows: TickRow[] = [];

    private constructor(readonly runId: string, readonly path: string | null) {}

    /** Open (append to) `speedrun/runs/<runId>.jsonl`, or `path`, or `$SPEEDRUN_LOG`. */
    static open(runId: string = newRunId(), path?: string): TickLog {
        const file = path ?? process.env.SPEEDRUN_LOG ?? join(DEFAULT_DIR, `${runId}.jsonl`);
        mkdirSync(dirname(file), { recursive: true });
        return new TickLog(runId, file);
    }

    /** A log that keeps rows in memory only (tests, dry runs). */
    static memory(runId: string = newRunId()): TickLog {
        return new TickLog(runId, null);
    }

    append(row: TickRow): void {
        this.rows.push(row);
        if (this.path) appendFileSync(this.path, JSON.stringify(row) + '\n');
    }
}

export function newRunId(date: Date = new Date()): string {
    return date.toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
}

/**
 * What `measure` reads its clock from: a bare SDK, or a session (session.ts)
 * whose `sessionId` bumps on every game session and `launchId` on every client
 * launch (the count's restart).
 */
export type MeasureTarget = StateSource | { sdk: StateSource; name?: string; sessionId?: number; launchId?: number };

/**
 * Which tick count a source's `state.tick` belongs to: its `launchId`, since only a client launch
 * restarts the count. A source without one (a test fake, a lab script's bare session) falls back to
 * its `sessionId`, so every new session reads as a restart there.
 */
export function tickCounter(t: { sessionId?: number; launchId?: number }): number {
    return t.launchId ?? t.sessionId ?? 0;
}

function resolveTarget(t: MeasureTarget): { sdk: StateSource; account: () => string; sessionId: () => number; counter: () => number } {
    if ('sdk' in t) {
        return {
            sdk: t.sdk,
            account: () => t.name ?? t.sdk.getState()?.player?.name ?? '?',
            sessionId: () => t.sessionId ?? 0,
            counter: () => tickCounter(t),
        };
    }
    return { sdk: t, account: () => t.getState()?.player?.name ?? '?', sessionId: () => 0, counter: () => 0 };
}

/**
 * Run `fn` and log the in-world ticks it took. Rethrows `fn`'s error after
 * logging the row with `ok:false`. A step that returns `{ok:false}` is logged
 * as not ok but not thrown, matching the primitives' result objects.
 */
export async function measure<T>(
    log: TickLog,
    target: MeasureTarget,
    step: string,
    fn: () => Promise<T>,
    meta?: Record<string, unknown>
): Promise<T> {
    const t = resolveTarget(target);
    const startTick = t.sdk.getState()?.tick ?? -1;
    const startCounter = t.counter();
    const account = t.account();
    const t0 = Date.now();
    let ok = true;
    let error: string | undefined;
    let result: T | undefined;
    try {
        result = await fn();
        if (result && typeof result === 'object' && (result as { ok?: unknown }).ok === false) {
            ok = false;
            const reason = (result as { reason?: unknown }).reason;
            if (reason !== undefined) error = String(reason);
        }
        return result;
    } catch (e) {
        ok = false;
        error = e instanceof Error ? e.message : String(e);
        throw e;
    } finally {
        const endTick = t.sdk.getState()?.tick ?? -1;
        const span = tickSpan(startTick, endTick, startCounter, t.counter());
        log.append({
            v: 1,
            runId: log.runId,
            account,
            sessionId: t.sessionId(),
            step,
            startTick,
            endTick,
            ticks: span.ticks,
            wallMs: Date.now() - t0,
            ok,
            ...(error !== undefined ? { error } : {}),
            ...(meta ? { meta } : {}),
            ...(span.crossedSession ? { crossedSession: true } : {}),
            tickMs: tickMs(),
            at: new Date().toISOString(),
        });
    }
}

/** Append a zero-tick `note` row: what `step` measured about itself, in `meta`. Being a kinded row, it never counts toward a total. */
export function logNote(log: TickLog, target: MeasureTarget, step: string, meta: Record<string, unknown>): void {
    const t = resolveTarget(target);
    const tick = t.sdk.getState()?.tick ?? -1;
    log.append({
        v: 1, kind: 'note', runId: log.runId, account: t.account(), sessionId: t.sessionId(), step,
        startTick: tick, endTick: tick, ticks: 0, wallMs: 0, ok: true, meta, tickMs: tickMs(), at: new Date().toISOString(),
    });
}

/**
 * Ticks between two observations, each tagged with its tick count (`tickCounter`). Across a
 * relaunch the counter restarts near zero, so the best we know is the ticks observed in the new
 * count; on one count (in-page logins included) it is the plain difference.
 */
export function tickSpan(startTick: number, endTick: number, startCounter: number, endCounter: number): { ticks: number; crossedSession: boolean } {
    const crossedSession = startCounter !== endCounter || endTick < startTick;
    if (!crossedSession) return { ticks: Math.max(0, endTick - startTick), crossedSession };
    return { ticks: Math.max(0, endTick), crossedSession };
}

export interface StepReport {
    step: string;
    count: number;
    failures: number;
    totalTicks: number;
    mean: number;
    min: number;
    max: number;
    /** True when any sample crossed a client relaunch, so the totals are lower bounds. */
    lowerBound: boolean;
}

export interface AnnotationReport {
    kind: RowKind;
    step: string;
    count: number;
    totalTicks: number;
}

export interface RunReport {
    steps: StepReport[];
    totalTicks: number;
    lowerBound: boolean;
    /** Annotation rows per kind and name, outside `totalTicks`. */
    annotations: AnnotationReport[];
}

/** Aggregate rows per step name, in first-seen order. Annotation rows are counted apart. */
export function report(rows: TickRow[]): RunReport {
    const byStep = new Map<string, TickRow[]>();
    const notes = new Map<string, AnnotationReport>();
    for (const r of rows) {
        if (r.kind) {
            const key = `${r.kind}\u0000${r.step}`;
            const a = notes.get(key) ?? { kind: r.kind, step: r.step, count: 0, totalTicks: 0 };
            a.count++;
            a.totalTicks += r.ticks;
            notes.set(key, a);
            continue;
        }
        const list = byStep.get(r.step);
        if (list) list.push(r);
        else byStep.set(r.step, [r]);
    }
    const steps: StepReport[] = [];
    for (const [step, list] of byStep) {
        const ticks = list.map(r => r.ticks);
        const total = ticks.reduce((a, b) => a + b, 0);
        steps.push({
            step,
            count: list.length,
            failures: list.filter(r => !r.ok).length,
            totalTicks: total,
            mean: Math.round((total / list.length) * 100) / 100,
            min: Math.min(...ticks),
            max: Math.max(...ticks),
            lowerBound: list.some(r => r.crossedSession === true),
        });
    }
    return {
        steps,
        totalTicks: steps.reduce((a, s) => a + s.totalTicks, 0),
        lowerBound: steps.some(s => s.lowerBound),
        annotations: [...notes.values()],
    };
}

export function parseLog(text: string): TickRow[] {
    return text
        .split('\n')
        .filter(l => l.trim() !== '')
        .map(l => JSON.parse(l) as TickRow)
        .filter(r => r.v === 1);
}

export function formatReport(rep: RunReport): string {
    const header = ['step', 'n', 'fail', 'total', 'mean', 'min', 'max'];
    const body = rep.steps.map(s => [
        s.step + (s.lowerBound ? ' (>=)' : ''),
        String(s.count),
        String(s.failures),
        String(s.totalTicks),
        String(s.mean),
        String(s.min),
        String(s.max),
    ]);
    body.push(['TOTAL' + (rep.lowerBound ? ' (>=)' : ''), '', '', String(rep.totalTicks), '', '', '']);
    const widths = header.map((h, i) => Math.max(h.length, ...body.map(r => r[i]!.length)));
    const line = (cells: string[]) => cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]!) : c.padStart(widths[i]!))).join('  ');
    const table = [line(header), line(widths.map(w => '-'.repeat(w))), ...body.map(line)];
    if (rep.annotations.length) {
        table.push('', 'annotations (not in TOTAL):');
        for (const a of rep.annotations) table.push(`  ${a.kind.padEnd(8)} ${a.step}  n=${a.count}  ticks=${a.totalTicks}`);
    }
    return table.join('\n');
}

if (import.meta.main) {
    const [cmd, file] = process.argv.slice(2);
    if (cmd !== 'report' || !file) {
        console.error('Usage: bun speedrun/lib/ticks.ts report <file.jsonl>');
        process.exit(2);
    }
    console.log(formatReport(report(parseLog(readFileSync(file, 'utf-8')))));
}
