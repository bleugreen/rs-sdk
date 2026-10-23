#!/usr/bin/env bun
// The scored run, S00 to S17 (cairn://p/rs/393): runner/chain.ts's chain under runner/resume.ts's
// resumable runner, through lib/attempt.ts runAttempt (the attempt's stops: the host reservation at
// every logout-safe boundary, Ctrl-C, SIGTERM).
//
//   bun speedrun/run.ts --bot=<env name> --config=<run config json> [--client=browser|lite]
//       [--from=<id|step name|index>] [--until=<id|step name>] [--dry-run] [--log=<file>]
//       [--run-commit=<rev>] [--run-dir=<dir>] [--host-reservation=<file>] [--claim-owner=<rs/NNN>]
//       [--cannon-serve=<file>]
//
// Before the gates, the run config must build the chain (every placed and kit row's partner named,
// the ledger covered) and its cue directory must be the helpers' writers' one: else exit 3.
// Start gates, each checked once before anything logs in (any refusal: exit 3, nothing logged in):
// 1. the run commit includes the run-commit floor, read at run time from STEP-MANIFEST.md entry 0
//    on main (lib/run-floor.ts; no floor lives in code);
// 2. the host reservation is live and the run's own claim (--claim-owner / $SPEEDRUN_CLAIM_OWNER);
// 3. the slot ledger (speedrun/tools/slot-ledger.ts) exits 0;
// 4. no refusing step (a module not on main) on the path to --until;
// 5. the helpers are in: <run dir>/launcher.json says helpersReady;
// 6. when the path reaches H11 or H23: the cannon holder's run-day serve options (--cannon-serve,
//    default <run dir>/cannon-serve.json: `{ "H11": <serve>, "H23": <serve> }`, cannon.ts serve
//    options as h92 runs them, written from fleet.json by rs/41) agree with the ledger rows SCORED
//    will want (helpers/cannon-receiver.ts serveDrift; H11's returnExtras against H11r's row).
//
// The tick log defaults to <run dir>/run.jsonl, so running the same command again resumes into the
// same log: the walk starts from game state, the run's cue files are kept, and the report covers
// every session. A new run takes a new --log (or a cleared run dir).
// --dry-run evaluates every gate (the floor included) and lists the chain and every refusing step,
// and logs nothing in. No option skips or replaces a gate: --run-commit names the commit the floor
// check judges (default HEAD), never the floor.
//
// The report at the end (runner/run-report.ts) is per RUN-ORDER id against section 2's figures.
//
// The run config (JSON, gitignored: it names accounts) is runner/chain.ts's RunConfig less
// `cueDir`: the cue directory is <run dir>/rc-cue unless $RC_CUE_DIR says otherwise, and run.ts
// sets RC_CUE_DIR so every writer (runecraft's cues, thieving's asks, the anvil plan) shares it.
//
// Log identity: every row carries the account `SCORED`; the login name is used only inside the cue
// writers (as its sha256). A fresh start (an empty log, no --from) clears the run's own stale cue
// files first.
//
// The end: S17's final logout (agility's `finish: 'final-logout'`), confirmed; the total level read
// from the last state against 1,881; the run's claim released (rs-claim release).
//
// Exit: 0 the run done at 1,881 (or the --until slice done), 1 error or a short total, 2 usage,
// 3 refused by a start gate, 4 stopped (resume), 5 host reserved (paused; resume once it is gone).

import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import type { BotWorldState } from '../sdk/types';
import { cueDir as defaultCueDir, RUN_DIR } from './helpers/altar-cue';
import { annotation, ProgramTracker, programRow, ReachTracker, reachRow, runAttempt, SessionClock, type AttemptResult } from './lib/attempt';
import { claimBin, claimOwner, EXIT_HOST_RESERVED, readReservation, ReservationWatch, reservationPath, claimToucher, type ReservationWatch as Watch } from './lib/host-reservation';
import { programStatus } from './lib/programs';
import { describePreflight, feedUrl, readFeedHello, tickPreflight, type TickPreflight } from './lib/feed-hello';
import { checkRunFloor, gitIn, type FloorCheck, type TickMsParse } from './lib/run-floor';
import { type ClientKind, cdpUrl, closeSession, loadBotEnv, logoutClean, type LogoutResult, openSession, pageWorld, ROOT, type Session, startWatchdog } from './lib/session';
import { pageInGame, pageLoginState, type PageLoginState } from './lib/tab';
import { tickMs } from './lib/wait';
import { returnExtrasFromLedger, serveDrift, serveFromLedger } from './helpers/cannon-receiver';
import { newRunId, parseLog, TickLog, type TickRow } from './lib/ticks';
import { startRunTabMemory, type TabMemorySetting } from './lib/tab-memory';
import { formatRunReport, runReport } from './runner/run-report';
import { patchMethod } from './runner/fence';
import { buildChain, chainProbes, missingOnPath, muleCueDir, resolveFrom, sliceUntil, type ChainOptions, type ChainStep, type CueSink, type RunConfig } from './runner/chain';
import { exitStopIsFinal, prepareCueDir, RunCues } from './runner/cue-keeper';
import { dropRecover } from './runner/drop-relog';
import { LOST_AFTER_TICKS, sessionLink } from './runner/resume';
import { RelogBudget } from './runner/relog-budget';
import { HandOffRecord } from './runner/handoff';
import { SCORED_LOGIN, SCORED_RELOG } from './runner/scored-relog';

/** Ticks past the link's stale bound before the watchdog acts, with the drop recovery on. */
export const WATCHDOG_AFTER_LINK_TICKS = 10;

export class UsageError extends Error {
    override name = 'UsageError';
}

export const USAGE = `usage: bun speedrun/run.ts --bot=<env name> --config=<run config json> [--client=browser|lite]
    [--from=<id|step name|index>] [--until=<id|step name>] [--dry-run] [--log=<file>]
    [--run-commit=<rev>] [--run-dir=<dir>] [--host-reservation=<file>] [--claim-owner=<rs/NNN>]
    [--s21-relog=on|off]  (SCORED's relog after S21's givers are ready; default on)
    [--tick-override]  (operator only: go past a tick preflight refusal, logged as overridden)`;

/** The account every log row carries. */
export const LOG_ACCOUNT = 'SCORED';
/** The 19 skills at 99 (STEP-MANIFEST.md entry 0's postcondition). */
export const TARGET_TOTAL = 1881;
/** The client's unused skill slots (SKILL_NAMES 'Stat18', 'Stat19'): not skills, not in the total. */
const PLACEHOLDER_SKILL = /^Stat\d+$/;
export const EXIT_REFUSED = 3;

export interface RunArgs {
    bot: string;
    config: string;
    client: ClientKind;
    from?: string;
    until?: string;
    dryRun: boolean;
    /** The tick log (default <run dir>/run.jsonl: a re-run of the same command resumes into it). */
    log: string;
    runCommit?: string;
    runDir: string;
    hostReservation?: string;
    claimOwner?: string;
    /** The cannon holder's run-day serve options (default <run dir>/cannon-serve.json). */
    cannonServe: string;
    /** Operator only: go past a tick preflight refusal, which is then logged as overridden. */
    tickOverride: boolean;
    /** SCORED's in-page relog between S21's pre-login and its first trade (--s21-relog=on|off, default on). */
    s21Relog: boolean;
}

const VALUE_FLAGS = new Set(['bot', 'config', 'client', 'from', 'until', 'log', 'run-commit', 'run-dir', 'host-reservation', 'claim-owner', 'cannon-serve', 's21-relog']);
const SWITCHES = new Set(['dry-run', 'tick-override']);

export function parseArgs(argv: readonly string[]): RunArgs {
    const v: Record<string, string> = {};
    const on = new Set<string>();
    for (const arg of argv) {
        const m = /^--([a-z0-9-]+)(?:=(.*))?$/.exec(arg);
        if (!m) throw new UsageError(`unexpected argument ${arg}`);
        const [, key, value] = m as unknown as [string, string, string | undefined];
        if (SWITCHES.has(key)) {
            if (value !== undefined) throw new UsageError(`--${key} takes no value`);
            on.add(key);
        } else if (VALUE_FLAGS.has(key)) {
            if (!value) throw new UsageError(`--${key} needs a value`);
            v[key] = value;
        } else throw new UsageError(`unknown flag --${key}`);
    }
    if (!v.bot) throw new UsageError('--bot is required');
    if (!v.config) throw new UsageError('--config is required (the run config: helpers and partners)');
    const client = (v.client ?? 'browser') as ClientKind;
    if (client !== 'browser' && client !== 'lite') throw new UsageError(`--client must be browser or lite, not ${v.client}`);
    const relog = v['s21-relog'] ?? 'on';
    if (relog !== 'on' && relog !== 'off') throw new UsageError(`--s21-relog must be on or off, not ${relog}`);
    const runDir = resolve(v['run-dir'] ?? RUN_DIR);
    return {
        bot: v.bot, config: v.config, client, dryRun: on.has('dry-run'), tickOverride: on.has('tick-override'), s21Relog: relog === 'on', runDir,
        log: resolve(v.log ?? join(runDir, 'run.jsonl')), cannonServe: resolve(v['cannon-serve'] ?? join(runDir, 'cannon-serve.json')),
        ...(v.from ? { from: v.from } : {}), ...(v.until ? { until: v.until } : {}),
        ...(v['run-commit'] ? { runCommit: v['run-commit'] } : {}), ...(v['host-reservation'] ? { hostReservation: v['host-reservation'] } : {}),
        ...(v['claim-owner'] ? { claimOwner: v['claim-owner'] } : {}),
    };
}

/** The run config file, with the cue directory resolved (and RC_CUE_DIR set to it when `setEnv`). */
export function loadRunConfig(path: string, runDir: string, env: Record<string, string | undefined> = process.env, setEnv = true): RunConfig {
    let raw: unknown;
    try {
        raw = JSON.parse(readFileSync(path, 'utf8'));
    } catch (e) {
        throw new UsageError(`--config ${path}: ${e instanceof Error ? e.message : e}`);
    }
    const c = raw as Partial<RunConfig>;
    const need = ['partners', 'firemakingTiles', 'rings', 'bones', 'courier', 'anvil'] as const;
    const absent = need.filter(k => c[k] === undefined);
    if (absent.length) throw new UsageError(`--config ${path} lacks ${absent.join(', ')}`);
    const dir = env.RC_CUE_DIR || join(runDir, 'rc-cue');
    if (setEnv) env.RC_CUE_DIR = dir;
    const h12o = c.h12o && typeof c.h12o.cueDir === 'string' && typeof c.h12o.loginDir === 'string'
        ? { h12o: { ...c.h12o, cueDir: resolve(c.h12o.cueDir), loginDir: resolve(c.h12o.loginDir) } }
        : {};
    return { ...(c as RunConfig), cueDir: resolve(dir), ...(typeof c.muleCueDir === 'string' ? { muleCueDir: resolve(c.muleCueDir) } : {}), ...h12o };
}

/** The attempt a process runs: the one its tick log already holds (resumed), else this process's run id. */
export function attemptOf(earlier: readonly { runId?: string }[], runId: string): string {
    return earlier.find(r => typeof r.runId === 'string' && r.runId.length > 0)?.runId ?? runId;
}

/**
 * The chain, or why the run config cannot build it (a placed or kit row with no partner, such as
 * S05's H4 giver; a ledger row the chain does not cover; a probe a step reads that no module
 * exports): a start-gate refusal, never a crash.
 */
export function chainOrRefusal(cfg: RunConfig, cues: CueSink, o: Pick<ChainOptions, 's21Relog' | 'relogs' | 'attempt' | 'handOffs'> = {}): { chain: ChainStep[] } | { refusal: string } {
    try {
        const chain = buildChain(cfg, { cues, ...o });
        chainProbes(chain);
        return { chain };
    } catch (e) {
        return { refusal: e instanceof Error ? e.message : String(e) };
    }
}

// ------------------------------------------------------------------ start gates

export interface Gate {
    gate: string;
    ok: boolean;
    detail: string;
    /** The gate's readings, for the start annotation. */
    meta?: Record<string, unknown>;
}

export interface GateIO {
    floor(): Promise<FloorCheck>;
    /** The tick preflight (lib/feed-hello.ts) against the freeze's tickMs as the floor read it. */
    tick(recorded: TickMsParse): Promise<TickPreflight>;
    /** The reservation file's state and the claim owner the run is under. */
    reservation(): { owner: string | undefined; state: ReturnType<typeof readReservation>; path: string };
    /** speedrun/tools/slot-ledger.ts's exit code and output. */
    slotLedger(): Promise<{ code: number; out: string }>;
    /** <run dir>/launcher.json's helpersReady (null: no file or unreadable). */
    helpersReady(): boolean | null;
    /** The cannon holder's run-day serve options by ledger row, or why they cannot be read. */
    cannonServe(): { path: string; serve: CannonServeFile | null; error?: string };
    /** The run dir's relog budget (runner/relog-budget.ts): what earlier sessions of this run spent. */
    relogs?(): { room: true | string; used: string; path: string };
}

/** cannon.ts serve options, per cannon row, as h92 runs them on the day. */
export type CannonServeFile = Partial<Record<'H11' | 'H23', { balls: number; extras?: { item: string; count: number }[]; returnExtras?: { item: string; count: number }[] }>>;

/** Where the holder's serve differs from the ledger rows SCORED will want ([] when they agree). */
export function cannonServeDrift(serve: CannonServeFile, rows: readonly ('H11' | 'H23')[], manifest?: string): string[] {
    const out: string[] = [];
    for (const row of rows) {
        const s = serve[row];
        if (!s) {
            out.push(`${row}: no serve options for the row`);
            continue;
        }
        out.push(...serveDrift(s, serveFromLedger(row, manifest)));
        if (row === 'H11') {
            const want = returnExtrasFromLedger(manifest).map(e => `${e.item.toLowerCase()} x${e.count}`).sort();
            const back = (s.returnExtras ?? []).map(e => `${e.item.toLowerCase()} x${e.count}`).sort();
            if (want.join() !== back.join()) out.push(`H11r: serve.returnExtras [${back.join(', ')}], the H11r row [${want.join(', ')}]`);
        }
    }
    return out;
}

/** The freeze's tick length as the floor check read it; a floor that could not be read gives none. */
export function freezeTickMs(f: FloorCheck): TickMsParse {
    return f.tickMs ?? { ok: false, reason: `STEP-MANIFEST.md was not read (${f.ok ? 'no manifest text' : f.reason}), so the freeze's tickMs is unknown` };
}

/**
 * Every later login (a relog, the watchdog's, an outage reconnect) is preceded by the tick preflight,
 * logged with its reading; a refusal throws, so the login does not happen.
 */
export function tickBeforeLogin(io: Pick<GateIO, 'tick'>, recorded: TickMsParse, record: (t: TickPreflight) => void): () => Promise<void> {
    return async () => {
        const t = await io.tick(recorded);
        record(t);
        if (!t.ok) throw new Error(`tick preflight refused the login: ${t.problems.join('; ')}`);
    };
}

/** The start gates, each checked once, in order; every one is evaluated (a dry run lists them all). */
export async function startGates(chain: readonly ChainStep[], io: GateIO): Promise<Gate[]> {
    const out: Gate[] = [];
    const f = await io.floor();
    out.push({ gate: 'run-commit floor', ok: f.ok, detail: f.ok ? `RUN_COMMIT ${f.runCommit.slice(0, 10)} includes the floor ${f.floor} (STEP-MANIFEST.md:${f.line} on main)` : f.reason });
    const recorded = freezeTickMs(f);
    const t = await io.tick(recorded);
    out.push({ gate: 'demo tick rate', ok: t.ok, detail: describePreflight(t), meta: { recorded, ...t } });
    const r = io.reservation();
    const rs = r.state;
    const res = rs.state === 'live' || rs.state === 'expired' ? rs.reservation : null;
    const resOk = !!r.owner && rs.state === 'live' && res?.owner === r.owner;
    out.push({
        gate: 'host reservation',
        ok: resOk,
        detail: !r.owner
            ? 'the run names no claim owner (--claim-owner or $SPEEDRUN_CLAIM_OWNER): the scored run runs only under its own live claim'
            : rs.state === 'live'
              ? res!.owner === r.owner ? `live, ours (${r.owner} until ${res!.until})` : `live, but ${res!.owner}'s, not ours (${r.owner})`
              : rs.state === 'malformed' ? `${r.path} is malformed: ${rs.error}` : `no live claim in ${r.path} (${rs.state}): take it (rs-claim take ${r.owner} ...) first`,
    });
    const led = await io.slotLedger();
    out.push({ gate: 'slot ledger', ok: led.code === 0, detail: led.code === 0 ? 'exit 0' : `exit ${led.code}: ${led.out.trim().split('\n').slice(-3).join(' | ')}` });
    const missing = missingOnPath(chain);
    out.push({ gate: 'no refusing step on the path', ok: missing.length === 0, detail: missing.length ? missing.map(m => `#${m.index} ${m.name} (${m.owner})`).join('; ') : `${chain.length} steps, none refusing` });
    const ready = io.helpersReady();
    out.push({ gate: 'helpers ready', ok: ready === true, detail: ready === null ? 'no launcher.json in the run dir: start the helpers first' : ready ? 'launcher.json: helpersReady' : 'launcher.json: helpers not ready yet' });
    if (io.relogs) {
        // Unplanned relogs left: none left refuses, since the next drop would stop the run anyway.
        const r = io.relogs();
        out.push({ gate: 'relog budget', ok: r.room === true, detail: r.room === true ? `${r.used} (${r.path})` : `${r.room} (${r.path})` });
    }
    const cannonRows = (['H11', 'H23'] as const).filter(r => chain.some(s => s.id === r));
    if (cannonRows.length) {
        const c = io.cannonServe();
        const drift = c.serve ? cannonServeDrift(c.serve, cannonRows) : [];
        out.push({
            gate: 'cannon serve',
            ok: !!c.serve && drift.length === 0,
            detail: !c.serve ? `${c.path}: ${c.error ?? 'missing'} (rs/41 writes h92's run-day serve options there)` : drift.length ? drift.join('; ') : `${cannonRows.join(', ')} served as the ledger rows want (${c.path})`,
        });
    }
    return out;
}

export function hostGateIO(a: RunArgs, owner: string | undefined, relogs?: RelogBudget): GateIO {
    const git = gitIn(ROOT);
    const path = reservationPath(a.hostReservation);
    const world = pageWorld(loadBotEnv(a.bot));
    return {
        floor: () => checkRunFloor(git, a.runCommit ? { runCommit: a.runCommit } : {}),
        tick: async recorded => tickPreflight(await readFeedHello(feedUrl(world)), recorded, tickMs(), a.tickOverride),
        reservation: () => ({ owner, state: readReservation(path), path }),
        slotLedger: async () => {
            const p = Bun.spawn(['bun', join(ROOT, 'speedrun/tools/slot-ledger.ts')], { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' });
            const [o, e, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
            return { code, out: `${o}${e}` };
        },
        helpersReady: () => {
            try {
                return (JSON.parse(readFileSync(join(a.runDir, 'launcher.json'), 'utf8')) as { helpersReady?: boolean }).helpersReady === true;
            } catch {
                return null;
            }
        },
        cannonServe: () => {
            try {
                return { path: a.cannonServe, serve: JSON.parse(readFileSync(a.cannonServe, 'utf8')) as CannonServeFile };
            } catch (e) {
                return { path: a.cannonServe, serve: null, error: e instanceof Error ? e.message : String(e) };
            }
        },
        ...(relogs ? { relogs: () => ({ room: relogs.check('unplanned'), used: relogs.describe(), path: relogs.file }) } : {}),
    };
}

// ------------------------------------------------------------------ the run on a session

/** Rows written for the login `real` carry `alias` instead: the log never holds the scored name. */
export function aliasAccount(log: TickLog, real: string, alias: string = LOG_ACCOUNT): () => void {
    return patchMethod(log, 'append', append => (row: TickRow) => append(row.account === real ? { ...row, account: alias } : row));
}

/** The total level from a state: the real skills' base levels summed. */
export function totalLevel(s: Pick<BotWorldState, 'skills'>): number {
    return s.skills.reduce((a, k) => a + (PLACEHOLDER_SKILL.test(k.name) ? 0 : k.baseLevel), 0);
}

export interface ChainRunOptions {
    log: TickLog;
    chain: readonly ChainStep[];
    reservation: Watch;
    from?: number;
    cues?: RunCues;
    /** The chain runs to the run's end (no --until slice): only then is a code-0 finish a completed run, whose cue close is final. */
    wholeRun?: boolean;
    /** Console tag (default 'run'). */
    label?: string;
    /** A browser session's per-minute tab memory rows (lib/tab-memory.ts): the launched Chrome's pid, the chunk's label. */
    tabMemory?: TabMemorySetting;
    /** The run's relog budget: with it a drop is recovered by runner/drop-relog.ts (an in-page relog, the race rule). */
    relogs?: RelogBudget;
    /** The process's signals and exit (tests inject them). */
    signals?: SignalDeps;
}

/** Longest the callers' cleanup may run after a signal before the process exits anyway. */
export const TERM_CLEANUP_MS = 60_000;

/**
 * A signal ended the chain: SCORED is logged out, and the callers' cleanup is still to run. Each
 * caller lets it through its `finally`, then exits with `exitCode` itself after `disarm()`; a
 * cleanup that has not finished TERM_CLEANUP_MS after the signal is cut off by exiting anyway.
 */
export class Terminated extends Error {
    constructor(readonly exitCode: number, readonly signal: string, private readonly hardExit: ReturnType<typeof setTimeout>) {
        super(`${signal}: logged out; exit ${exitCode} once cleanup has run`);
        this.name = 'Terminated';
    }

    /** Cleanup is done: cancel the bounded hard exit. */
    disarm(): void {
        clearTimeout(this.hardExit);
    }
}

export interface SignalDeps {
    on(signal: NodeJS.Signals, fn: () => void): void;
    off(signal: NodeJS.Signals, fn: () => void): void;
    exit(code: number): void;
    cleanupMs?: number;
    log?: (message: string) => void;
}

const PROCESS_SIGNALS: SignalDeps = { on: (s, f) => void process.on(s, f), off: (s, f) => void process.off(s, f), exit: c => process.exit(c) };

export interface SignalShutdown {
    stopAsked(): boolean;
    /** The logout a signal started, or null. */
    leaving(): Promise<unknown> | null;
    /** The Terminated a signal produced, or null. */
    termination(): Terminated | null;
    /** Rejects with the Terminated once a signal's logout has finished; never settles otherwise. */
    readonly terminated: Promise<never>;
    dispose(): void;
}

/**
 * The chain's signals. Ctrl-C asks for a stop at the next logout-safe boundary; a second Ctrl-C
 * (exit 130), SIGTERM or SIGHUP (exit 143) logs out now and then ends the chain with Terminated,
 * so the callers' cleanup (helper launchers, the browser, the token proxy) runs before the exit.
 */
export function signalShutdown(tag: string, leave: () => Promise<unknown>, deps: SignalDeps = PROCESS_SIGNALS): SignalShutdown {
    const say = deps.log ?? ((m: string) => console.error(m));
    let stopAsked = false;
    let leaving: Promise<unknown> | null = null;
    let term: Terminated | null = null;
    let reject!: (e: Terminated) => void;
    const terminated = new Promise<never>((_, r) => (reject = r));
    terminated.catch(() => {});
    const now = (code: number, signal: string) => {
        if (leaving) return;
        stopAsked = true;
        say(`${tag} ${signal}: logging out now; cleanup, then exit ${code}`);
        const ms = deps.cleanupMs ?? TERM_CLEANUP_MS;
        const hard = setTimeout(() => {
            say(`${tag} cleanup still running ${ms} ms after ${signal}: exiting ${code}`);
            deps.exit(code);
        }, ms);
        const t = new Terminated(code, signal, hard);
        term = t;
        leaving = leave().catch(() => {}).finally(() => reject(t));
    };
    const onInt = () => {
        if (stopAsked) return now(130, 'SIGINT');
        stopAsked = true;
        say(`${tag} stop requested: logging out at the next logout-safe boundary (Ctrl-C again to log out now)`);
    };
    const onTerm = () => now(143, 'SIGTERM');
    const onHup = () => now(143, 'SIGHUP');
    deps.on('SIGINT', onInt);
    deps.on('SIGTERM', onTerm);
    deps.on('SIGHUP', onHup);
    return {
        stopAsked: () => stopAsked,
        leaving: () => leaving,
        termination: () => term,
        terminated,
        dispose: () => {
            deps.off('SIGINT', onInt);
            deps.off('SIGTERM', onTerm);
            deps.off('SIGHUP', onHup);
        },
    };
}

/** `p`, or the signal's Terminated once its logout is done when a signal ended the chain first (or made `p` fail). */
export async function untilTerminated<T>(p: Promise<T>, sig: SignalShutdown): Promise<T> {
    p.catch(() => {});
    const out = await Promise.race([p, sig.terminated]).catch(async e => {
        const t = sig.termination();
        if (!t) throw e;
        await sig.leaving();
        throw t;
    });
    const t = sig.termination();
    if (t) {
        await sig.leaving();
        throw t;
    }
    return out;
}

export interface ChainRunResult {
    result: AttemptResult;
    lastLogout: LogoutResult | null;
    lastState: BotWorldState | null;
}

/**
 * The chain on an open session: the session, reach and program rows (rehearse.ts's trackers), the
 * watchdog, the signals (signalShutdown: Ctrl-C stops at the next logout-safe boundary; twice,
 * SIGTERM or SIGHUP log out now and throw Terminated for the caller's cleanup), runAttempt, then
 * out of the world.
 */
export async function runChainOnSession(session: Session, o: ChainRunOptions): Promise<ChainRunResult> {
    // First, so a probe nothing provides throws before anything is watched or written.
    const probes = chainProbes(o.chain);
    const tag = `[${o.label ?? 'run'}]`;
    const account = session.name;
    const log = o.log;
    const clock = new SessionClock();
    const reach = new ReachTracker();
    const programs = new ProgramTracker();
    let lastState: BotWorldState | null = null;
    const unsubscribe = session.sdk.onStateUpdate(s => {
        if (s.inGame) lastState = s;
        clock.track(log, account, session, s);
        for (const r of reach.observe(s)) log.append(reachRow(log, account, session, r));
        for (const st of programs.observe(programStatus(s))) log.append(programRow(log, account, session.sessionId, st));
    });
    const unCues = o.cues?.attach(session.sdk);
    // With the drop recovery on, a browser page's own in-game flag decides a drop: the link asks it
    // (a dropped page publishes nothing) and the watchdog stands down for it (drop-relog relogs in page).
    const cdp = o.relogs && session.client === 'browser' ? cdpUrl(session.env) : undefined;
    const page = cdp ? () => pageInGame(cdp, session.name).catch(() => null) : undefined;
    const wd = startWatchdog(session, {
        onEvent: e => console.log(`[watchdog] ${e.verdict}: ${e.reason}`),
        // The link (LOST_AFTER_TICKS) sees a stale tick first and drop-relog pauses the watchdog; at the
        // same bound the watchdog's logout and relaunch won the race on the lab (rs/511).
        ...(o.relogs ? { staleTicks: LOST_AFTER_TICKS + WATCHDOG_AFTER_LINK_TICKS } : {}),
        ...(page ? { standDown: async () => ((await page()) === false ? 'the page is out of the world: run.ts relogs it in page' : null) } : {}),
    });
    const tabMem = startRunTabMemory(session, log, o.tabMemory);

    let lastLogout: LogoutResult | null = null;
    const leave = async (): Promise<LogoutResult> => {
        const r = await logoutClean(session);
        lastLogout = r;
        console.log(`${tag} logout: ${r.ok ? `out after the click on tick ${r.clickTick}` : `NOT confirmed (${r.reason})`}`);
        return r;
    };
    const sig = signalShutdown(tag, leave, o.signals);
    const link = sessionLink(session, page ? { pageInGame: page } : {});
    let result: AttemptResult | null = null;
    try {
        result = await untilTerminated(runAttempt(session, o.chain, {
            log, account, link, reservation: o.reservation, probes,
            ...(o.relogs ? { recover: dropRecover(session, o.relogs, link, line => console.log(line)) } : {}),
            stopAsked: sig.stopAsked, gateStop: () => null, logout: () => leave(), label: o.label ?? 'run',
            ...(o.from !== undefined ? { from: o.from } : {}),
            onEvent: e => console.log(`[resume] ${JSON.stringify(e)}`),
        }), sig);
        if (session.expectInWorld && !sig.leaving()) await leave();
        return { result, lastLogout, lastState };
    } finally {
        wd.stop();
        await tabMem?.stop();
        // A foreign cue is refused, but that must not leak subscriptions or signal handlers.
        try {
            if (o.cues) {
                const signal = sig.termination()?.signal ?? null;
                const final = exitStopIsFinal({ completed: o.wholeRun === true && (result as AttemptResult | null)?.code === 0, signal });
                console.log(`${tag} cues closed ${final ? 'final' : 'non-final: a re-run re-arms the helpers'}`);
                o.cues.close({ final });
            }
        } finally {
        unCues?.();
        sig.dispose();
        for (const st of programs.flush()) log.append(programRow(log, account, session.sessionId, st));
        unsubscribe();
        const out = lastLogout as LogoutResult | null;
        clock.close(log, account, session.sessionId, 'logout', out?.ok ? out.lastInWorldTick : session.lastInWorldTick, out ?? undefined);
        }
    }
}

// ------------------------------------------------------------------ main

async function releaseClaim(owner: string): Promise<string> {
    const bin = claimBin();
    if (!bin) return `rs-claim not installed: release the claim by hand (rs-claim release ${owner})`;
    const p = Bun.spawn([bin, 'release', owner], { stdout: 'pipe', stderr: 'pipe' });
    const [o, e, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    return code === 0 ? `claim released (${owner})` : `rs-claim release ${owner} exited ${code}: ${`${o}${e}`.trim()}`;
}

/**
 * An open planned S21 relog must attach without launching SCORED. Recheck the givers and finish
 * the login half before the normal in-world resume walk (which needs a scene and player ticks).
 */
export async function openRunSession(bot: string, o: {
    client: ClientKind; chain: readonly ChainStep[]; relogs: RelogBudget; log: TickLog;
    beforeLogin?: () => Promise<void>;
}, deps: { open?: typeof openSession; close?: typeof closeSession; pageState?: (s: Session) => Promise<PageLoginState | null> } = {}): Promise<Session> {
    const pending = o.relogs.planned(SCORED_RELOG) === 'open';
    const ready = pending ? o.chain.find(s => s.name === 'S21 runecraft:pre-login') : null;
    const loginHalf = pending ? o.chain.find(s => s.name === SCORED_LOGIN) : null;
    if (pending && (!ready || !loginHalf)) throw new Error('open S21 relog requires its giver wait and login half; do not disable or slice past it');
    const session = await (deps.open ?? openSession)(bot, { client: o.client, launch: !pending, ...(pending ? { awaitInWorld: false as const } : {}) });
    session.beforeLogin = o.beforeLogin;
    if (!pending) return session;
    const unalias = aliasAccount(o.log, session.name);
    try {
        const state = await (deps.pageState ?? (async (s: Session) => {
            const cdp = s.client === 'browser' ? cdpUrl(s.env) : undefined;
            return cdp ? pageLoginState(cdp, s.name) : null;
        }))(session).catch(() => null);
        // The journal survived the process, not necessarily the browser's login completion.
        // Neither a live page nor a pending login proves which login established its order.
        if (!state || state.inGame || state.loginInProgress) {
            const why = !state ? 'page state unproven' : state.inGame ? 'page already live' : 'login in progress';
            throw new Error(`open S21 relog: ${why}; manual reconciliation required before resuming (no login sent)`);
        }
        session.expectInWorld = false;
        session.watchdog?.pause();
        const ctx = { session, sdk: session.sdk, bot: session.bot, c: {}, log: o.log };
        await ready!.run(ctx);
        await loginHalf!.run(ctx);
        return session;
    } catch (e) {
        o.log.append(annotation(o.log, session.name, 'note', '(startup) S21 recovery refused', {
            ok: false, error: e instanceof Error ? e.message : String(e),
        }));
        await (deps.close ?? closeSession)(session);
        throw e;
    } finally {
        unalias();
    }
}

async function main(argv: string[]): Promise<number> {
    const a = parseArgs(argv);
    const cfg = loadRunConfig(a.config, a.runDir);
    const owner = claimOwner(a.claimOwner);
    if (cfg.cueDir !== defaultCueDir()) {
        console.error(`[gate] REFUSED cue directory: ${cfg.cueDir} is not the one the helpers' writers use (${defaultCueDir()})`);
        return EXIT_REFUSED;
    }
    // The cues name the login (hashed), never the bot's env directory.
    const keeper = new RunCues({ main: cfg.cueDir, mule: muleCueDir(cfg) }, loadBotEnv(a.bot).BOT_USERNAME);
    const relogs = new RelogBudget(a.runDir);
    const earlier = existsSync(a.log) ? parseLog(readFileSync(a.log, 'utf8')) : [];
    const runId = `run-${newRunId()}`;
    const attempt = attemptOf(earlier, runId);
    const built = chainOrRefusal(cfg, keeper, { s21Relog: a.s21Relog, relogs, attempt, handOffs: new HandOffRecord(a.runDir, attempt) });
    if ('refusal' in built) {
        console.error(`[gate] REFUSED run config: ${built.refusal}`);
        console.error('[run] nothing was logged in');
        return EXIT_REFUSED;
    }
    const full = built.chain;
    const chain = sliceUntil(full, a.until);
    const from = resolveFrom(chain, a.from);

    const fresh = earlier.length === 0 && from === undefined;
    // A fresh run's budget is whole: the last run's relogs and any stale lock go (prepareCueDir's rule).
    if (fresh && !a.dryRun) relogs.clear();
    const io = hostGateIO(a, owner, relogs);
    const gates = await startGates(chain, io);
    for (const g of gates) console.log(`[gate] ${g.ok ? 'ok     ' : 'REFUSED'} ${g.gate}: ${g.detail}`);
    if (a.dryRun) {
        console.log(`\n${chain.length} steps${a.until ? ` (--until=${a.until})` : ''}:`);
        chain.forEach((s, i) => console.log(`${String(i).padStart(3)}  ${s.id.padEnd(14)} ${s.kind.padEnd(8)} ${s.name}${s.owner ? `  [refuses: ${s.owner}]` : ''}`));
        return gates.every(g => g.ok) ? 0 : EXIT_REFUSED;
    }
    if (!gates.every(g => g.ok)) {
        console.error('[run] nothing was logged in');
        return EXIT_REFUSED;
    }

    const removed = [...prepareCueDir(cfg.cueDir, { fresh }), ...prepareCueDir(muleCueDir(cfg), { fresh }).map(f => `mule/${f}`)];
    const log = TickLog.open(runId, a.log);
    const bin = owner ? claimBin() : null;
    const reservation = new ReservationWatch(reservationPath(a.hostReservation), { label: 'run', ...(owner ? { owner, touch: bin ? claimToucher(bin) : null } : {}) });
    const recorded = gates.find(g => g.gate === 'demo tick rate')!.meta!.recorded as TickMsParse;
    const beforeLogin = tickBeforeLogin(io, recorded, t => {
        log.append(annotation(log, loadBotEnv(a.bot).BOT_USERNAME, 'gate', '(gate) demo tick rate before login', { ok: t.ok, meta: { ...t } }));
        console.log(`[gate] ${t.ok ? 'ok     ' : 'REFUSED'} demo tick rate before login: ${describePreflight(t)}`);
    });
    const session = await openRunSession(a.bot, { client: a.client, chain, relogs, log, beforeLogin });
    const unalias = aliasAccount(log, session.name);
    log.append(annotation(log, session.name, 'gate', '(gate) start', { meta: { gates, fresh, cueDir: cfg.cueDir, removed, until: a.until ?? null, steps: chain.length, s21Relog: a.s21Relog } }));
    console.log(`[run] ${LOG_ACCOUNT} on ${a.client}; ${chain.length} steps${a.until ? ` to ${a.until}` : ''}; log ${log.path}`);
    let code = 1;
    let term: Terminated | null = null;
    try {
        // A signal: SCORED is out, then closeSession still closes the browser before the exit.
        const ran = await runChainOnSession(session, { log, chain, reservation, cues: keeper, relogs, wholeRun: a.until === undefined, ...(from !== undefined ? { from } : {}) }).catch(e => {
            if (!(e instanceof Terminated)) throw e;
            term = e;
            return null;
        });
        if (!ran) {
            const t = term as unknown as Terminated;
            code = t.exitCode;
            console.log(`[run] ${t.message}`);
            return code;
        }
        const { result, lastState } = ran;
        code = result.code;
        console.log(`[run] ${result.outcome}`);
        if (code === 0 && a.until === undefined) {
            const total = lastState ? totalLevel(lastState) : null;
            const ok = total === TARGET_TOTAL && !session.expectInWorld;
            log.append(annotation(log, session.name, 'note', '(run) total', { ok, meta: { total, target: TARGET_TOTAL, loggedOut: !session.expectInWorld } }));
            console.log(`[run] total ${total ?? '?'} of ${TARGET_TOTAL}; ${session.expectInWorld ? 'NOT logged out' : 'logged out'}`);
            if (!ok) code = 1;
            if (owner && !session.expectInWorld) console.log(`[run] ${await releaseClaim(owner)}`);
        }
        if (code === EXIT_HOST_RESERVED) console.log(`[run] resume: once ${reservation.path} is gone or expired, run the same command again`);
        if (code === 4) console.log('[run] resume: run the same command again (the walk starts from game state)');
    } finally {
        unalias();
        await closeSession(session);
        (term as Terminated | null)?.disarm();
    }
    console.log('\n' + formatRunReport(runReport([...earlier, ...log.rows], chain, readFileSync(join(ROOT, 'docs/speedrun/RUN-ORDER.md'), 'utf8'))));
    return code;
}

if (import.meta.main) {
    try {
        process.exit(await main(process.argv.slice(2)));
    } catch (e) {
        if (e instanceof UsageError) {
            console.error(`${e.message}\n${USAGE}`);
            process.exit(2);
        }
        throw e;
    }
}
