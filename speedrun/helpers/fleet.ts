#!/usr/bin/env bun
// Helper fleet supervisor: keeps the helper accounts listed in fleet.json
// logged in to the demo server, each running its role, and records their banks
// in stockpile.json. Operating guide: docs/speedrun/HELPERS.md.
//
//   bun speedrun/helpers/fleet.ts run                  # the supervisor (fleetctl start runs it under systemd)
//   bun speedrun/helpers/fleet.ts status [--json]
//   bun speedrun/helpers/fleet.ts add <range> [--count N] [--role R] [--options JSON]
//   bun speedrun/helpers/fleet.ts assign <account> <role> [--options JSON] [--then ROLE [--then-options JSON] | --return] [--disable]
//   bun speedrun/helpers/fleet.ts reload               # re-read fleet.json in the running supervisor
//   bun speedrun/helpers/fleet.ts peek <account>       # position, levels, inventory (read-only)
//
// Shape. One loopback SDK gateway (server/gateway/gateway.ts bound to
// 127.0.0.1, no login server) is a child of this process. Each account gets a
// headless lite client child (server/webclient/src/lite/runner.ts) that logs in
// to the demo server and publishes its state to that gateway, and one BotSDK in
// this process, connected to the same gateway, on which its role runs. So the
// role's round trips stay on the host, not the demo's public gateway, and a
// crashing client takes down one account, not the fleet.
//
// A runner process exits on any session end; this supervisor logs it back in
// with backoff through a fleet-wide login gate, except for exit code 3 (client
// revision older than the server's), which stops the whole fleet: every
// account would fail the same way and retrying cannot fix it.
//
// A role whose run() returns has finished (role.ts) and is not started again
// for that assignment (FleetRoleLoop); an assignment with `then` is rewritten
// in fleet.json to that role, which starts at once.
import { AsyncLocalStorage } from 'node:async_hooks';
import { createWriteStream, renameSync, statSync, type WriteStream } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format } from 'node:util';
import type { Subprocess } from 'bun';
import { BotActions } from '../../sdk/actions';
import { abortable, executionContext } from '../../sdk/execution-context';
import { BotSDK } from '../../sdk/index';
import { initPathfinding } from '../../sdk/pathfinding';
import { createAccountEnv, listAccounts, nextAccountName, parseBotEnv, parseRange } from './accounts';
import { LOGOUT_BUTTON } from '../lib/session';
import { COMBAT_LOGOUT_TICKS } from '../lib/world';
import { Backoff, LoginLimiter, loginFailurePolicy } from './backoff';
import { EventLog, parseEvents, summariseEvents, type FleetEventType } from './events';
import {
    activeAccounts,
    ConfigError,
    diffActive,
    loginLimitPolicy,
    parseFleetConfig,
    returnAssignment,
    ROLE_NAME_RE,
    sameAssignment,
    type AccountConfig,
    type Assignment,
    type FleetConfig
} from './fleet-config';
import { LedgerWriter, readLedger, writeJsonAtomic, type Ledger } from './ledger';
import { describeFreshState, waitForFreshState } from '../lib/fresh-state';
import { idleBoundMs } from '../lib/wait';
import { openRoleState, type BankSnapshot, type Role, type RoleContext, type RoleFinish } from './role';

const ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));

/** Everything the fleet reads or writes, relative to the checkout (the lite runner reads bots/ from there too). */
export const PATHS = {
    config: join(ROOT, 'fleet.json'),
    ledger: join(ROOT, 'stockpile.json'),
    events: join(ROOT, 'fleet-events.jsonl'),
    bots: join(ROOT, 'bots'),
    run: join(ROOT, 'fleet-run'),
    logs: join(ROOT, 'fleet-run', 'logs'),
    status: join(ROOT, 'fleet-run', 'status.json'),
    pid: join(ROOT, 'fleet-run', 'fleet.pid'),
    history: join(ROOT, 'fleet-run', 'bank-history.jsonl'),
    /** One RoleState file per account (role.ts), e.g. handover outcomes. */
    roleState: join(ROOT, 'fleet-run', 'role-state'),
    /** Written by `fleetctl update`: the ref and commit last deployed. */
    deployed: join(ROOT, 'fleet-run', 'deployed.json')
};

/** Which code is in the checkout: the deployed ref, HEAD, and whether speedrun/ differs from HEAD (an rsynced development copy). */
export interface CodeVersion {
    ref: string | null;
    sha: string | null;
    speedrunModified: boolean;
}

export async function codeVersion(): Promise<CodeVersion> {
    const git = (...args: string[]) => {
        const r = Bun.spawnSync(['git', ...args], { cwd: ROOT, stdout: 'pipe', stderr: 'ignore' });
        return r.exitCode === 0 ? r.stdout.toString().trim() : null;
    };
    const deployed = JSON.parse(await readFile(PATHS.deployed, 'utf8').catch(() => '{}')) as { ref?: string };
    const dirty = git('status', '--porcelain', '--', 'speedrun');
    return { ref: deployed.ref ?? null, sha: git('rev-parse', '--short', 'HEAD'), speedrunModified: !!dirty };
}

function describeCode(v: CodeVersion | undefined): string {
    if (!v) return 'unknown';
    return `${v.ref ?? '(ref not recorded)'} @ ${v.sha ?? '?'}${v.speedrunModified ? ' + development speedrun/' : ''}`;
}

const LOGIN_TIMEOUT_MS = 120_000; // first run downloads the cache and builds the world index
const SDK_HANDSHAKE_MS = 30_000;
const LIVE_STATE_TIMEOUT_MS = 45_000;
/** The engine sends PLAYER_INFO every tick, so this many ticks of silence on a live session means the client is wedged. */
const STATE_SILENCE_TICKS = 300;
const STOP_GRACE_MS = 15_000;
const WATCH_EVERY_MS = 15_000;
const STATUS_EVERY_MS = 10_000;
const LOG_ROTATE_BYTES = 20 * 1024 * 1024;
const EXIT_OUTDATED = 3;

// ------------------------------------------------------------------ small utilities

const iso = (t = Date.now()) => new Date(t).toISOString();
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Resolves after `ms`, or early (without throwing) when `signal` aborts. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise(resolve => {
        if (signal?.aborted) return resolve();
        const done = () => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', done);
            resolve();
        };
        const timer = setTimeout(done, ms);
        signal?.addEventListener('abort', done, { once: true });
    });
}

/** True if `p` settled within `ms`. */
async function settledWithin(p: Promise<unknown> | null, ms: number): Promise<boolean> {
    if (!p) return true;
    return Promise.race([p.then(() => true, () => true), sleep(ms).then(() => false)]);
}

function rejectAfter(ms: number, what: string): Promise<never> {
    return new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} timed out after ${ms / 1000}s`)), ms));
}

async function pipeLines(stream: ReadableStream<Uint8Array>, onLine: (line: string) => void): Promise<void> {
    const decoder = new TextDecoder();
    let buf = '';
    const reader = stream.getReader();
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            let i: number;
            while ((i = buf.indexOf('\n')) >= 0) {
                const line = buf.slice(0, i).trimEnd();
                buf = buf.slice(i + 1);
                if (line) onLine(line);
            }
        }
    } catch {
        // the pipe closes with the process
    }
    if (buf.trim()) onLine(buf.trim());
}

/** Append-only log file that rotates to <path>.1 past LOG_ROTATE_BYTES, so an unattended fleet cannot fill the disk. */
class RotatingLog {
    private stream!: WriteStream;
    private bytes = 0;
    private closed = false;

    constructor(readonly path: string) {
        this.open();
    }

    private open(): void {
        this.stream = createWriteStream(this.path, { flags: 'a' });
        try {
            this.bytes = statSync(this.path).size;
        } catch {
            this.bytes = 0;
        }
    }

    write(line: string): void {
        // A role that ignored its abort can still log after its account stopped; a
        // write after end() would be an unhandled stream error.
        if (this.closed) return;
        const text = line.endsWith('\n') ? line : `${line}\n`;
        if (this.bytes + text.length > LOG_ROTATE_BYTES) {
            this.stream.end();
            renameSync(this.path, `${this.path}.1`);
            this.open();
        }
        this.stream.write(text);
        this.bytes += Buffer.byteLength(text);
    }

    close(): Promise<void> {
        if (this.closed) return Promise.resolve();
        this.closed = true;
        return new Promise(resolve => this.stream.end(resolve));
    }
}

/** Linux /proc sample for the status file: resident memory and cumulative CPU ticks. */
async function procSample(pid: number | undefined): Promise<{ rssMB: number; cpuTicks: number } | null> {
    if (!pid || process.platform !== 'linux') return null;
    try {
        const [stat, status] = await Promise.all([
            readFile(`/proc/${pid}/stat`, 'utf8'),
            readFile(`/proc/${pid}/status`, 'utf8')
        ]);
        const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
        const cpuTicks = Number(fields[11]) + Number(fields[12]); // utime + stime
        const rssKB = Number(/VmRSS:\s+(\d+)/.exec(status)?.[1] ?? 0);
        return { rssMB: Math.round(rssKB / 1024), cpuTicks };
    } catch {
        return null;
    }
}

const CLK_TCK = 100;

class CpuMeter {
    private last = new Map<number, { ticks: number; at: number }>();

    /** Percent of one core since the previous sample of the same pid. */
    percent(pid: number, ticks: number, at = Date.now()): number | null {
        const prev = this.last.get(pid);
        this.last.set(pid, { ticks, at });
        if (!prev || at <= prev.at) return null;
        return Math.round(((ticks - prev.ticks) / CLK_TCK / ((at - prev.at) / 1000)) * 1000) / 10;
    }
}

// ------------------------------------------------------------------ logging

let fleetLogFile: RotatingLog | null = null;
const rawConsole = { log: console.log.bind(console), error: console.error.bind(console) };

function fleetLog(message: string): void {
    const line = `${iso()} ${message}`;
    fleetLogFile?.write(line);
    rawConsole.log(line);
}

/**
 * The account whose role is running in the current async call chain. Console
 * output from the SDK inside a role (walk retries, reconnect notices) carries no
 * account name, so it is routed to that account's log instead of an
 * interleaved stdout.
 */
const accountScope = new AsyncLocalStorage<AccountRunner>();

function attributeConsole(): void {
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
        const original = console[level].bind(console);
        console[level] = (...args: unknown[]) => {
            const runner = accountScope.getStore();
            if (!runner) return original(...args);
            const text = format(...args);
            runner.note(`[${level === 'log' || level === 'info' ? 'sdk' : `sdk ${level}`}] ${text}`);
            // e.g. "waitForTicks(1) safety timeout - no state updates received": worth correlating across accounts.
            if (/safety timeout|no state updates/i.test(text)) runner.sdkStall(text);
        };
    }
}

// ------------------------------------------------------------------ roles

const roleCache = new Map<string, Promise<Role>>();

/** speedrun/helpers/<name>.ts must export `role`. Cached for the life of the process: new role code needs a restart. */
export function loadRole(name: string): Promise<Role> {
    if (!ROLE_NAME_RE.test(name)) return Promise.reject(new Error(`bad role name "${name}"`));
    let p = roleCache.get(name);
    if (!p) {
        p = import(join(ROOT, 'speedrun', 'helpers', `${name}.ts`)).then((mod: { role?: Role }) => {
            const role = mod.role;
            if (!role || typeof role.run !== 'function') {
                throw new Error(`speedrun/helpers/${name}.ts does not export a \`role\``);
            }
            return role;
        });
        p.catch(() => roleCache.delete(name));
        roleCache.set(name, p);
    }
    return p;
}

function bankSummary(snapshot: BankSnapshot): string {
    const top = [...snapshot.items].sort((a, b) => b.count - a.count).slice(0, 4);
    return `${snapshot.items.length} stacks; ${top.map(i => `${i.name} x${i.count}`).join(', ')}`;
}

/** What FleetRoleLoop needs from its account (AccountRunner, or a fake in tests). */
export interface RoleLoopHooks {
    load(name: string): Promise<Role>;
    /** The context for one run of `cfg`'s role, its RoleState read afresh. */
    context(cfg: AccountConfig, signal: AbortSignal): Promise<RoleContext>;
    /** Run the role to its end; the fleet wraps it in the account's console and execution scope. */
    run(role: Role, ctx: RoleContext, signal: AbortSignal): Promise<void | RoleFinish>;
    started(role: Role, cfg: AccountConfig): void;
    failed(cfg: AccountConfig, e: unknown): void;
    /** A finished role asked for a person (RoleFinish.attention). */
    attention(text: string): void;
    note(text: string): void;
    event(type: FleetEventType, fields?: Record<string, unknown>): void;
    /** `finished` has a `then`: make it the account's assignment in fleet.json and return it, or null when that could not be done. */
    returnTo(finished: AccountConfig): Promise<AccountConfig | null>;
    isStopping(): boolean;
    sleep?(ms: number, signal: AbortSignal): Promise<void>;
}

/**
 * One account's role across its sessions. It is started on every session,
 * restarted promptly after a stall or a reassignment and with backoff after a
 * throw, and never started again for an assignment whose run() returned: that
 * role has finished its job (role.ts). A finished assignment with `then` hands
 * the account to that role, written to fleet.json first so a supervisor restart
 * does not run the finished one again; without `then` the account idles,
 * logged in, until it is reassigned. The run-machine launcher's RoleLoop
 * (standalone.ts) follows the same rule for role processes that exit 0.
 */
export class FleetRoleLoop {
    /** The running role's controller; the watchdog aborts it on a stall. */
    ctl: AbortController | null = null;
    /** The assignment that finished; idle while it is still `cfg`. */
    private done: AccountConfig | null = null;
    private wake: (() => void) | null = null;
    private readonly backoff = new Backoff({ initialMs: 15_000, maxMs: 10 * 60_000, resetAfterMs: 10 * 60_000 });

    constructor(
        public cfg: AccountConfig,
        private readonly h: RoleLoopHooks
    ) {}

    /** The account's current assignment has finished. */
    get finished(): boolean {
        return this.done === this.cfg;
    }

    /** A new role or options: stop the running role (or end the idle) and start the new one. */
    reconfigure(cfg: AccountConfig): void {
        this.cfg = cfg;
        this.interrupt('reconfigured');
    }

    /** The same role and options with other settings changed (`then`): nothing restarts, and a finished assignment stays finished. */
    update(cfg: AccountConfig): void {
        if (this.done === this.cfg) this.done = cfg;
        this.cfg = cfg;
    }

    interrupt(reason: string): void {
        this.ctl?.abort(new Error(reason));
        this.wake?.();
    }

    /** The role for one game session; resolves when the session ends or the account stops. */
    async run(session: AbortSignal): Promise<void> {
        const h = this.h;
        while (!session.aborted && !h.isStopping()) {
            const cfg = this.cfg;
            if (this.done === cfg) {
                await this.idle(session);
                continue;
            }
            const ctl = new AbortController();
            const relay = () => ctl.abort(session.reason);
            session.addEventListener('abort', relay, { once: true });
            this.ctl = ctl;
            const started = Date.now();
            let outcome: string;
            let finish: RoleFinish | null = null;
            try {
                const role = await h.load(cfg.role);
                h.started(role, cfg);
                h.note(`[fleet] starting role ${cfg.role} ${JSON.stringify(cfg.options)}`);
                const result = await h.run(role, await h.context(cfg, ctl.signal), ctl.signal);
                if (!ctl.signal.aborted) finish = result ?? {};
                outcome = ctl.signal.aborted ? `stopped: ${errText(ctl.signal.reason)}` : 'finished';
            } catch (e) {
                outcome = ctl.signal.aborted ? `stopped: ${errText(ctl.signal.reason)}` : `threw: ${errText(e)}`;
                if (!ctl.signal.aborted) h.failed(cfg, e);
            } finally {
                session.removeEventListener('abort', relay);
                this.ctl = null;
            }
            if (session.aborted || h.isStopping()) {
                h.note(`[fleet] role ${outcome}`);
                return;
            }
            if (finish) {
                await this.finish(cfg, finish);
                continue;
            }
            // Stalls and reconfigures restart promptly; crashes back off so a broken role cannot hot-loop.
            const delay = ctl.signal.aborted ? 3_000 : this.backoff.failure(started, Date.now());
            h.note(`[fleet] role ${outcome}; restarting it in ${Math.round(delay / 1000)}s`);
            await (h.sleep ?? sleep)(delay, session);
        }
    }

    private async finish(cfg: AccountConfig, f: RoleFinish): Promise<void> {
        const h = this.h;
        this.backoff.reset();
        // A reload may have replaced the entry while the role ran: a new `then` counts, a new role or options win.
        if (!sameAssignment(this.cfg, cfg)) return;
        const current = this.cfg;
        this.done = current;
        h.event('role_finished', { then: current.then?.role ?? null, ...(f.attention ? { attention: f.attention, needsAttention: true } : {}) });
        if (f.attention) {
            h.attention(f.attention);
            h.note(`[fleet] !!! ATTENTION, role ${cfg.role}: ${f.attention}`);
        }
        h.note(`[fleet] role ${cfg.role} finished; not restarting it`);
        if (!current.then) {
            h.note('[fleet] no `then` assignment: idle, logged in, until reassigned (fleetctl assign, then fleetctl reload)');
            return;
        }
        const next = await h.returnTo(current);
        if (this.cfg !== current) return;
        if (!next) {
            h.note(`[fleet] could not move on to ${describeAssignment(current.then)}; idle until reassigned`);
            return;
        }
        h.note(`[fleet] returning to ${describeAssignment(next)}`);
        this.cfg = next;
    }

    private idle(session: AbortSignal): Promise<void> {
        return new Promise(resolve => {
            if (session.aborted || this.h.isStopping()) return resolve();
            const done = () => {
                session.removeEventListener('abort', done);
                this.wake = null;
                resolve();
            };
            session.addEventListener('abort', done, { once: true });
            this.wake = done;
        });
    }
}

function describeAssignment(a: Assignment): string {
    return `role ${a.role} ${JSON.stringify(a.options)}`;
}

// ------------------------------------------------------------------ one account

type RunnerState = 'queued' | 'logging-in' | 'attaching' | 'online' | 'backoff' | 'stopping' | 'stopped' | 'outdated';

interface SessionExit {
    code: number | null;
    reason: string;
    /** Set when the server refused the login: its response code (LOGIN_RESPONSE) and message. */
    login?: { code: number; message: string };
}

/** A role's `ctx.log('phase', { phase: 'gather' })` (or 'phase gather'), as one short string. */
export function describePhase(message: string, data?: Record<string, unknown>): string | null {
    if (!/^phase\b/i.test(message)) return null;
    const named = data?.phase ?? data?.to;
    if (typeof named === 'string') return named;
    const rest = message.replace(/^phase\b\s*:?\s*/i, '');
    return rest || (data ? JSON.stringify(data) : 'phase');
}

class AccountRunner {
    state: RunnerState = 'queued';
    onlineSince: number | null = null;
    nextAttemptAt: number | null = null;
    lastLog: { at: number; text: string } | null = null;
    lastError: string | null = null;
    /** The role's latest `phase` log line. */
    rolePhase: { at: number; text: string } | null = null;
    private refusals = { code: -1, streak: 0 };
    private lastStallEventAt = 0;
    private roles: Promise<void> | null = null;
    readonly stats = { logins: 0, sessionEnds: 0, roleStarts: 0, roleFailures: 0, bankReports: 0 };

    private child: Subprocess<'ignore', 'pipe', 'pipe'> | null = null;
    private sdk: BotSDK | null = null;
    private bot: BotActions | null = null;
    private lastRoleActivity = 0;
    private loop: Promise<void> | null = null;
    private readonly stopCtl = new AbortController();
    private readonly log: RotatingLog;
    private readonly reloginBackoff = new Backoff({ initialMs: 10_000, maxMs: 60_000, resetAfterMs: 5 * 60_000 });
    private readonly roleLoop: FleetRoleLoop;

    constructor(
        cfg: AccountConfig,
        private readonly fleet: Fleet
    ) {
        this.log = new RotatingLog(join(PATHS.logs, `${cfg.account}.log`));
        this.roleLoop = new FleetRoleLoop(cfg, {
            load: loadRole,
            context: (c, signal) => this.context(c, signal),
            // abortable(): a role that ignores its signal must not hold the loop hostage.
            run: (role, ctx, signal) => accountScope.run(this, () => executionContext.run({ signal }, () => abortable(role.run(ctx), signal))),
            started: role => {
                this.lastRoleActivity = Date.now();
                this.stats.roleStarts++;
                // The SDK reads config.showChat on every state message, so this takes effect at
                // once and is reset when the account is reassigned to a role that does not chat.
                this.sdk!.config.showChat = role.readsChat === true;
            },
            failed: (_, e) => {
                this.stats.roleFailures++;
                this.lastError = `role threw: ${errText(e)}`;
                this.event('role_error', { error: errText(e).slice(0, 300) });
                if (e instanceof Error && e.stack) this.note(`[fleet] ${e.stack.split('\n').slice(0, 6).join(' | ')}`);
            },
            attention: text => {
                this.lastError = text;
            },
            note: text => this.note(text),
            event: (type, fields) => this.event(type, fields),
            returnTo: finished => this.fleet.returnTo(finished),
            isStopping: () => this.stopping
        });
    }

    get cfg(): AccountConfig {
        return this.roleLoop.cfg;
    }

    get account(): string {
        return this.cfg.account;
    }

    /** Its current assignment's role has finished and was not restarted. */
    get finished(): boolean {
        return this.roleLoop.finished;
    }

    get childPid(): number | undefined {
        return this.child?.pid;
    }

    private get stopping(): boolean {
        return this.stopCtl.signal.aborted;
    }

    note(text: string): void {
        const at = Date.now();
        this.lastLog = { at, text };
        this.log.write(`${iso(at)} ${text}`);
    }

    private event(type: FleetEventType, fields: Record<string, unknown> = {}): void {
        this.fleet.events.record(type, { account: this.account, role: this.cfg.role, ...fields });
    }

    sdkStall(line: string): void {
        if (Date.now() - this.lastStallEventAt < 30_000) return;
        this.lastStallEventAt = Date.now();
        this.event('sdk_stall', { line: line.slice(0, 200) });
    }

    start(): void {
        this.loop = this.supervise();
    }

    /** New role or options from a reload: the running role is stopped and the loop starts the new one. */
    reconfigure(cfg: AccountConfig): void {
        this.note(`[fleet] reconfigured: role ${cfg.role} ${JSON.stringify(cfg.options)}${cfg.then ? `, then ${describeAssignment(cfg.then)}` : ''}`);
        this.roleLoop.reconfigure(cfg);
    }

    /** A reload that kept role and options (it may have changed `then`): nothing restarts. */
    update(cfg: AccountConfig): void {
        this.roleLoop.update(cfg);
    }

    /**
     * Abort the role, log out with the logout button (the player leaves the world
     * that tick; a dropped socket leaves it in the world for hundreds of ticks and
     * blocks the next controller's login), and stop re-logging. Falls back to
     * closing the client if the logout is refused or never lands.
     */
    async stop(reason: string): Promise<void> {
        if (!this.stopping) {
            this.state = 'stopping';
            this.stopCtl.abort(new Error(reason));
            this.roleLoop.interrupt(reason);
            await settledWithin(this.roles, 5_000);
            const clean = await this.logout().catch(() => false);
            if (this.child) this.event(clean ? 'logout' : 'logout_forced', { reason });
            if (!clean) await this.killChild(reason);
        }
        await settledWithin(this.loop, STOP_GRACE_MS * 2);
        await this.sdk?.disconnect().catch(() => undefined);
        this.sdk = null;
        this.state = 'stopped';
        this.note(`[fleet] stopped (${reason})`);
        await this.log.close();
    }

    private async supervise(): Promise<void> {
        while (!this.stopping) {
            this.state = 'queued';
            await Promise.race([this.fleet.logins.take(), sleep(24 * 3600_000, this.stopCtl.signal)]);
            if (this.stopping) break;
            const started = Date.now();
            const exit = await this.session().catch((e): SessionExit => ({ code: null, reason: `supervisor error: ${errText(e)}` }));
            if (this.stopping) break;
            this.stats.sessionEnds++;
            if (exit.code === EXIT_OUTDATED) {
                this.state = 'outdated';
                this.lastError = exit.reason;
                this.event('session_end', { reason: exit.reason, exitCode: exit.code });
                this.fleet.outdated(this);
                return;
            }
            let delay = this.reloginBackoff.failure(this.onlineSince ?? started, Date.now());
            if (exit.login) {
                const { code, message } = exit.login;
                this.refusals = { code, streak: this.refusals.code === code ? this.refusals.streak + 1 : 1 };
                const policy = loginFailurePolicy(code, this.refusals.streak);
                this.event('login_error', { code, message, streak: this.refusals.streak, needsAttention: policy.needsAttention });
                if (policy.fleetPauseMs > 0) this.fleet.pauseLogins(policy.fleetPauseMs, `${this.account}: ${message} (code ${code})`);
                delay = Math.max(delay, Math.round(policy.accountDelayMs * (1 + 0.25 * Math.random())));
            } else {
                this.refusals = { code: -1, streak: 0 };
                const onlineSec = this.onlineSince ? Math.round((Date.now() - this.onlineSince) / 1000) : 0;
                this.event('session_end', { reason: exit.reason, exitCode: exit.code, onlineSec });
            }
            this.onlineSince = null;
            this.lastError = exit.reason;
            this.state = 'backoff';
            this.nextAttemptAt = Date.now() + delay;
            this.note(`[fleet] session over: ${exit.reason}; logging in again in ${Math.round(delay / 1000)}s`);
            await sleep(delay, this.stopCtl.signal);
            this.nextAttemptAt = null;
        }
    }

    private async readCredentials(): Promise<{ password: string; server: string } | string> {
        const path = join(PATHS.bots, this.account, 'bot.env');
        let env: Record<string, string>;
        try {
            env = parseBotEnv(await readFile(path, 'utf8'));
        } catch {
            return `no credentials at ${path} (create them with: fleet.ts add, or copy the sibling's bot.env)`;
        }
        if (env.BOT_USERNAME !== this.account || !env.PASSWORD) return `${path} has no BOT_USERNAME=${this.account} / PASSWORD`;
        if (!env.SERVER) return `${path} has no SERVER`;
        if (env.SERVER.startsWith('localhost') || env.SERVER.startsWith('127.')) return `${path} points at a local server (${env.SERVER}); the fleet runs demo accounts`;
        if (env.GATEWAY_URL && env.GATEWAY_URL !== this.fleet.gatewayUrl) {
            return `${path} sets GATEWAY_URL=${env.GATEWAY_URL}, which would bypass the fleet gateway; remove that line`;
        }
        return { password: env.PASSWORD, server: env.SERVER };
    }

    /** One game session: login, attach, run the role until the client exits. */
    private async session(): Promise<SessionExit> {
        const creds = await this.readCredentials();
        if (typeof creds === 'string') return { code: null, reason: creds };

        this.state = 'logging-in';
        this.stats.logins++;
        this.note(`[fleet] logging in to ${creds.server}`);
        const child = Bun.spawn([process.execPath, 'src/lite/runner.ts', this.account], {
            cwd: join(ROOT, 'server', 'webclient'),
            env: { ...process.env, GATEWAY_URL: this.fleet.gatewayUrl, LITE_LOGIN_JITTER_MS: '0' },
            stdin: 'ignore',
            stdout: 'pipe',
            stderr: 'pipe'
        });
        this.child = child;
        let lastLine = '';
        // A crash prints a source excerpt and ends with Bun's version line; the error line is the useful one.
        let errorLine = '';
        let refusal: { code: number; message: string } | undefined;
        let markLoggedIn: () => void = () => undefined;
        const loggedIn = new Promise<'in'>(r => (markLoggedIn = () => r('in')));
        const onLine = (line: string) => {
            lastLine = line;
            if (/^\w*Error: |^error: /.test(line)) errorLine = line;
            // The runner dies on a refused login with Bun's trace: "LoginError: <message>" then " code: <n>,".
            const refused = /^LoginError: (.*)$/.exec(line);
            if (refused) refusal = { code: 0, message: refused[1]! };
            const code = /^\s*code: (\d+),?$/.exec(line);
            if (code && refusal) refusal.code = Number(code[1]);
            this.note(`[lite] ${line}`);
            if (/^\[lite-runner\] '.+' logged into /.test(line)) markLoggedIn();
        };
        const piped = Promise.all([pipeLines(child.stdout, onLine), pipeLines(child.stderr, onLine)]);
        const exited = child.exited.then(async (code): Promise<SessionExit> => {
            await settledWithin(piped, 2000);
            const said = errorLine || lastLine;
            return { code, reason: `lite client exited with code ${code}${said ? ` (${said.slice(0, 200)})` : ''}`, ...(refusal ? { login: refusal } : {}) };
        });

        const first = await Promise.race([
            loggedIn,
            exited.then(() => 'exit' as const),
            sleep(LOGIN_TIMEOUT_MS).then(() => 'timeout' as const),
            sleep(24 * 3600_000, this.stopCtl.signal).then(() => 'stop' as const)
        ]);
        if (first !== 'in') {
            if (first !== 'exit') await this.killChild(first === 'timeout' ? 'login timed out' : 'stopping');
            this.child = null;
            const exit = await exited;
            return first === 'timeout' ? { code: null, reason: `login timed out after ${LOGIN_TIMEOUT_MS / 1000}s` } : exit;
        }

        this.state = 'attaching';
        try {
            await this.attachSdk(creds.password, creds.server);
            await this.waitForLiveState();
        } catch (e) {
            await this.killChild('attach failed');
            this.child = null;
            await exited;
            // The SDK may be the broken half (pre-empted by another controller turns its
            // reconnects off for good), so the next session builds a fresh one.
            await this.sdk?.disconnect().catch(() => undefined);
            this.sdk = null;
            this.bot = null;
            return { code: null, reason: `logged in, but the fleet could not attach: ${errText(e)}` };
        }

        this.state = 'online';
        this.onlineSince = Date.now();
        this.refusals = { code: -1, streak: 0 };
        this.note('[fleet] online');
        this.event('login', { login: this.stats.logins });
        const session = new AbortController();
        const roles = this.roleLoop.run(session.signal);
        this.roles = roles;
        const watchdog = setInterval(() => this.watch(), WATCH_EVERY_MS);
        const exit = await exited;
        clearInterval(watchdog);
        this.child = null;
        session.abort(new Error('game session ended'));
        await settledWithin(roles, STOP_GRACE_MS);
        return exit;
    }

    /**
     * One BotSDK per account for the life of the fleet: the gateway keeps an SDK
     * session across client reconnects and re-sends sdk_connected when the
     * client comes back, so a re-login needs no new SDK.
     */
    private async attachSdk(password: string, server: string): Promise<void> {
        if (this.sdk) return;
        const sdk = new BotSDK({
            botUsername: this.account,
            password,
            gatewayUrl: this.fleet.gatewayUrl,
            connectionMode: 'control',
            autoReconnect: true,
            autoLaunchBrowser: false,
            showChat: false,
            readyTimeout: 0,
            // The SDK derives its HTTP origin (Grand Exchange and market calls) from this,
            // else from the gateway URL, which here is loopback with no game server behind it.
            browserLaunchUrl: `https://${server.replace(/^wss?:\/\//, '').replace(/\/.*$/, '')}/bot`
        });
        try {
            await accountScope.run(this, () => Promise.race([sdk.connect(), rejectAfter(SDK_HANDSHAKE_MS, 'gateway handshake')]));
        } catch (e) {
            await sdk.disconnect().catch(() => undefined);
            throw e;
        }
        this.sdk = sdk;
        this.bot = new BotActions(sdk);
    }

    /**
     * The role starts on this client session's state, never on the one the gateway
     * replays from before it or the SDK kept across a relaunch (lib/fresh-state.ts).
     */
    private async waitForLiveState(): Promise<void> {
        const fresh = await waitForFreshState(this.sdk!, { timeoutMs: LIVE_STATE_TIMEOUT_MS, signal: this.stopCtl.signal });
        this.note(`[fleet] session state at ${describeFreshState(fresh)}`);
    }

    private watch(): void {
        if (this.state !== 'online' || !this.sdk) return;
        const age = this.sdk.getStateAge();
        if (age > idleBoundMs({ ticks: STATE_SILENCE_TICKS })) {
            this.note(`[fleet] no game state for ${Math.round(age / 1000)}s; restarting the client`);
            this.event('client_silent', { silentSec: Math.round(age / 1000) });
            void this.killChild('state went silent');
            return;
        }
        const quiet = Date.now() - this.lastRoleActivity;
        const ctl = this.roleLoop.ctl;
        if (ctl && quiet > this.cfg.stallMinutes * 60_000) {
            this.note(`[fleet] role has not logged for ${Math.round(quiet / 60_000)} min; restarting it`);
            this.event('role_stall', { quietMin: Math.round(quiet / 60_000) });
            ctl.abort(new Error(`stalled (${this.cfg.stallMinutes} min without a log line)`));
        }
    }

    private async context(cfg: AccountConfig, signal: AbortSignal): Promise<RoleContext> {
        const state = await openRoleState(join(PATHS.roleState, `${this.account}.json`));
        return {
            state,
            bot: this.bot!,
            sdk: this.sdk!,
            account: this.account,
            options: cfg.options,
            signal,
            log: (message, data) => {
                this.lastRoleActivity = Date.now();
                const phase = describePhase(message, data);
                if (phase !== null) this.rolePhase = { at: this.lastRoleActivity, text: phase };
                this.note(`[${cfg.role}] ${message}${data ? ` ${JSON.stringify(data)}` : ''}`);
            },
            reportBank: snapshot => {
                this.lastRoleActivity = Date.now();
                this.stats.bankReports++;
                this.note(`[fleet] bank: ${bankSummary(snapshot)}`);
                void this.fleet.ledger.record({ account: this.account, role: cfg.role, asOf: iso(), items: snapshot.items });
            }
        };
    }

    /**
     * Click the logout button and wait for the client to leave (its session ends
     * and the runner exits). The server refuses within COMBAT_LOGOUT_TICKS of
     * combat ("You can't log out ..."), so a refusal waits that out and retries once.
     */
    private async logout(): Promise<boolean> {
        const child = this.child;
        const sdk = this.sdk;
        if (!child || child.exitCode !== null || !sdk || !sdk.getState()?.inGame) return false;
        this.note('[fleet] logging out');
        for (let attempt = 0; attempt < 2; attempt++) {
            const clickTick = sdk.getState()?.tick ?? 0;
            await sdk.sendClickComponent(LOGOUT_BUTTON).catch(() => undefined);
            const refused = sdk
                .waitForCondition(s => s.gameMessages.some(m => /can't log ?out/i.test(m.text) && m.tick >= clickTick), 8_000)
                .then(() => 'refused' as const, () => new Promise<never>(() => undefined));
            const outcome = await Promise.race([child.exited.then(() => 'out' as const), refused, sleep(8_000).then(() => 'timeout' as const)]);
            if (outcome === 'out') return true;
            if (outcome === 'timeout') return false;
            if (attempt === 0) {
                const from = sdk.getState()?.tick ?? clickTick;
                await sdk.waitForCondition(s => s.tick >= from + COMBAT_LOGOUT_TICKS + 1, 15_000).catch(() => undefined);
            }
        }
        return false;
    }

    private async killChild(reason: string): Promise<void> {
        const child = this.child;
        if (!child || child.exitCode !== null) return;
        this.note(`[fleet] closing the lite client: ${reason}`);
        // The runner's SIGINT handler closes the game socket, which makes the engine save and log the player out.
        child.kill('SIGINT');
        if (!(await settledWithin(child.exited, STOP_GRACE_MS))) {
            child.kill('SIGKILL');
            await child.exited;
        }
    }
}

// ------------------------------------------------------------------ the loopback gateway

class GatewayProcess {
    restarts = 0;
    private child: Subprocess<'ignore', 'pipe', 'pipe'> | null = null;
    private stopping = false;
    private readonly log = new RotatingLog(join(PATHS.logs, 'gateway.log'));

    constructor(
        readonly port: number,
        private readonly onExit: (code: number | null) => void
    ) {}

    get pid(): number | undefined {
        return this.child?.pid;
    }

    async probe(): Promise<boolean> {
        try {
            const res = await fetch(`http://127.0.0.1:${this.port}/status`, { signal: AbortSignal.timeout(1500) });
            return res.ok;
        } catch {
            return false;
        }
    }

    async start(): Promise<void> {
        if (await this.probe()) {
            throw new Error(`something already answers on 127.0.0.1:${this.port}; is another fleet running? (fleetctl status)`);
        }
        this.spawn();
        const deadline = Date.now() + 20_000;
        while (!(await this.probe())) {
            if (Date.now() > deadline) throw new Error(`gateway did not come up on 127.0.0.1:${this.port}; see ${PATHS.logs}/gateway.log`);
            await sleep(250);
        }
        fleetLog(`[fleet] gateway listening on 127.0.0.1:${this.port}`);
    }

    private spawn(): void {
        const child = Bun.spawn([process.execPath, 'server/gateway/gateway.ts'], {
            cwd: ROOT,
            env: {
                ...process.env,
                AGENT_PORT: String(this.port),
                GATEWAY_HOSTNAME: '127.0.0.1',
                GATEWAY_PUBLIC_PORT: '0',
                // No login server: any local SDK connection is accepted, which is why it binds loopback only.
                LOGIN_SERVER: 'false',
                // No engine on this host; point the outdated-client lookup at a closed port so it fails fast.
                ENGINE_MANAGEMENT_URL: 'http://127.0.0.1:9'
            },
            stdin: 'ignore',
            stdout: 'pipe',
            stderr: 'pipe'
        });
        this.child = child;
        const onLine = (line: string) => this.log.write(`${iso()} ${line}`);
        void pipeLines(child.stdout, onLine);
        void pipeLines(child.stderr, onLine);
        void child.exited.then(code => {
            if (this.stopping) return;
            this.restarts++;
            this.onExit(code);
            fleetLog(`[fleet] gateway exited with code ${code}; restarting it in 5s (clients and SDKs reconnect on their own)`);
            setTimeout(() => {
                if (!this.stopping) this.spawn();
            }, 5000);
        });
    }

    async stop(): Promise<void> {
        this.stopping = true;
        const child = this.child;
        if (child && child.exitCode === null) {
            child.kill('SIGINT');
            if (!(await settledWithin(child.exited, 5000))) child.kill('SIGKILL');
        }
        await this.log.close();
    }
}

// ------------------------------------------------------------------ the fleet

async function loadConfig(path: string): Promise<FleetConfig> {
    let text: string;
    try {
        text = await readFile(path, 'utf8');
    } catch {
        throw new ConfigError([`cannot read ${path}`]);
    }
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch (e) {
        throw new ConfigError([`${path} is not valid JSON: ${errText(e)}`]);
    }
    return parseFleetConfig(raw);
}

function pidAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

async function readPid(): Promise<number | null> {
    const pid = Number((await readFile(PATHS.pid, 'utf8').catch(() => '')).trim());
    return Number.isInteger(pid) && pid > 0 && pidAlive(pid) ? pid : null;
}

export interface StatusAccount {
    account: string;
    role: string;
    state: RunnerState;
    /** The role's latest `phase` log line, and when. */
    rolePhase: string | null;
    rolePhaseAt: string | null;
    onlineSince: string | null;
    nextAttemptAt: string | null;
    lastLogAt: string | null;
    lastLog: string | null;
    lastError: string | null;
    stats: AccountRunner['stats'];
    pid: number | null;
    rssMB: number | null;
    cpuPct: number | null;
}

export interface FleetStatus {
    asOf: string;
    pid: number;
    running: boolean;
    startedAt: string;
    stoppedReason: string | null;
    gateway: { port: number; up: boolean; restarts: number; pid: number | null; rssMB: number | null; cpuPct: number | null };
    fleetProcess: { rssMB: number; cpuPct: number | null };
    /** The code this supervisor loaded at start. */
    code: CodeVersion;
    maxOnline: number;
    accounts: StatusAccount[];
}

class Fleet {
    config!: FleetConfig;
    readonly runners = new Map<string, AccountRunner>();
    readonly ledger = new LedgerWriter(PATHS.ledger, PATHS.history);
    readonly events = new EventLog(PATHS.events);
    logins!: LoginLimiter;
    private gateway!: GatewayProcess;
    private readonly startedAt = Date.now();
    private shuttingDown: string | null = null;
    private readonly cpu = new CpuMeter();
    private statusTimer: ReturnType<typeof setInterval> | null = null;
    private code!: CodeVersion;

    constructor(private readonly configPath: string) {}

    get gatewayUrl(): string {
        return `ws://127.0.0.1:${this.config.gatewayPort}`;
    }

    async run(): Promise<void> {
        this.config = await loadConfig(this.configPath);
        this.code = await codeVersion();
        await mkdir(PATHS.logs, { recursive: true });
        fleetLogFile = new RotatingLog(join(PATHS.logs, 'fleet.log'));
        const other = await readPid();
        if (other !== null && other !== process.pid) throw new Error(`another fleet is running (pid ${other}); stop it first`);
        await Bun.write(PATHS.pid, `${process.pid}\n`);

        this.logins = new LoginLimiter(loginLimitPolicy(this.config));
        this.gateway = new GatewayProcess(this.config.gatewayPort, code => this.events.record('gateway_exit', { code }));
        await this.gateway.start();
        // Synchronous and slow on first use; warm it before any socket exists (see sdk/runner.ts).
        initPathfinding();
        attributeConsole();

        process.on('SIGINT', () => void this.shutdown(0, 'SIGINT'));
        process.on('SIGTERM', () => void this.shutdown(0, 'SIGTERM'));
        process.on('SIGHUP', () => void this.reload());
        process.on('unhandledRejection', e => fleetLog(`[fleet] unhandled rejection: ${errText(e)}`));
        process.on('uncaughtException', e => fleetLog(`[fleet] uncaught exception: ${e.stack ?? errText(e)}`));

        const active = activeAccounts(this.config);
        fleetLog(
            `[fleet] started (pid ${process.pid}) on ${describeCode(this.code)}: ${active.length} accounts, maxOnline ${this.config.maxOnline}, ` +
            `logins at most ${this.config.loginsPerMinute}/min (burst ${this.config.loginBurst}, ${this.config.loginStaggerMs / 1000}s apart)`
        );
        this.events.record('fleet_start', { pid: process.pid, accounts: active.length, code: describeCode(this.code) });
        this.apply(active);
        this.statusTimer = setInterval(() => void this.writeStatus(), STATUS_EVERY_MS);
        void this.writeStatus();
    }

    private apply(next: AccountConfig[]): void {
        const diff = diffActive([...this.runners.values()].map(r => r.cfg), next);
        for (const name of diff.stop) {
            const runner = this.runners.get(name)!;
            this.runners.delete(name);
            fleetLog(`[fleet] ${name}: no longer active; logging it out`);
            void runner.stop('removed from the active set');
        }
        for (const cfg of diff.changed) this.runners.get(cfg.account)!.reconfigure(cfg);
        const touched = new Set([...diff.changed, ...diff.start].map(c => c.account));
        for (const cfg of next) if (!touched.has(cfg.account)) this.runners.get(cfg.account)?.update(cfg);
        for (const cfg of diff.start) {
            const runner = new AccountRunner(cfg, this);
            this.runners.set(cfg.account, runner);
            fleetLog(`[fleet] ${cfg.account}: queued for login as ${cfg.role}`);
            runner.start();
        }
    }

    private async reload(): Promise<void> {
        if (this.shuttingDown) return;
        try {
            const next = await loadConfig(this.configPath);
            if (next.gatewayPort !== this.config.gatewayPort) {
                fleetLog(`[fleet] reload: gatewayPort changed; that takes a restart (fleetctl restart). Other changes applied.`);
                next.gatewayPort = this.config.gatewayPort;
            }
            this.config = next;
            this.logins.setPolicy(loginLimitPolicy(next));
            fleetLog(`[fleet] reload: ${activeAccounts(next).length} active accounts`);
            this.apply(activeAccounts(next));
            void this.writeStatus();
        } catch (e) {
            fleetLog(`[fleet] reload refused, keeping the running config: ${errText(e)}`);
        }
    }

    private configWrites: Promise<unknown> = Promise.resolve();

    /**
     * A role with a `then` finished: rewrite its fleet.json entry to the `then`
     * role and options (returnAssignment) before anything starts it, so a
     * supervisor restart cannot run the finished role again. Writes are
     * serialised, since several accounts may finish together.
     */
    returnTo(finished: AccountConfig): Promise<AccountConfig | null> {
        const write = this.configWrites.then(async () => {
            const raw = JSON.parse(await readFile(this.configPath, 'utf8')) as unknown;
            const r = returnAssignment(raw, finished);
            if (typeof r === 'string') {
                fleetLog(`[fleet] ${finished.account}: ${finished.role} finished, but not moving it on: ${r}`);
                return null;
            }
            await writeJsonAtomic(this.configPath, r.config);
            this.config = { ...parseFleetConfig(r.config), gatewayPort: this.config.gatewayPort };
            fleetLog(`[fleet] ${finished.account}: ${finished.role} finished; fleet.json now assigns it ${describeAssignment(r.next)}`);
            return r.next;
        });
        const settled = write.catch((e: unknown) => {
            fleetLog(`[fleet] ${finished.account}: could not rewrite ${this.configPath}: ${errText(e)}`);
            return null;
        });
        this.configWrites = settled;
        return settled;
    }

    /** Hold every login for `ms`: the refusal was about the server or this IP, not one account. */
    pauseLogins(ms: number, why: string): void {
        const until = Date.now() + ms;
        if (until <= this.logins.pausedUntilMs) return;
        this.logins.pause(until);
        this.events.record('login_pause', { until: iso(until), why });
        fleetLog(`[fleet] pausing all logins for ${Math.round(ms / 1000)}s: ${why}`);
    }

    /** Exit code 3 from a client: the server moved to a new revision. Retrying cannot help, so stop everything. */
    outdated(runner: AccountRunner): void {
        const banner = '!'.repeat(78);
        fleetLog(banner);
        fleetLog(`[fleet] ${runner.account}: the lite client is OUTDATED for the server: ${runner.lastError}`);
        fleetLog('[fleet] Stopping the whole fleet. Update the checkout (fleetctl update), then fleetctl start.');
        fleetLog(banner);
        void this.shutdown(EXIT_OUTDATED, 'client outdated');
    }

    async shutdown(code: number, why: string): Promise<void> {
        if (this.shuttingDown) {
            fleetLog(`[fleet] ${why} again during shutdown; exiting now`);
            process.exit(code || 1);
        }
        this.shuttingDown = why;
        fleetLog(`[fleet] shutting down (${why}): logging out ${this.runners.size} accounts`);
        await Promise.all([...this.runners.values()].map(r => r.stop(why)));
        await this.gateway?.stop();
        if (this.statusTimer) clearInterval(this.statusTimer);
        await this.writeStatus();
        await rm(PATHS.pid, { force: true });
        this.events.record('fleet_stop', { why, exit: code });
        fleetLog(`[fleet] stopped (${why}), exit ${code}`);
        await fleetLogFile?.close();
        process.exit(code);
    }

    private async writeStatus(): Promise<void> {
        const now = Date.now();
        const accounts: StatusAccount[] = [];
        for (const r of this.runners.values()) {
            const sample = await procSample(r.childPid);
            accounts.push({
                account: r.account,
                role: r.cfg.role,
                state: r.state,
                rolePhase: r.finished ? 'finished' : (r.rolePhase?.text ?? null),
                rolePhaseAt: r.rolePhase ? iso(r.rolePhase.at) : null,
                onlineSince: r.onlineSince ? iso(r.onlineSince) : null,
                nextAttemptAt: r.nextAttemptAt ? iso(r.nextAttemptAt) : null,
                lastLogAt: r.lastLog ? iso(r.lastLog.at) : null,
                lastLog: r.lastLog?.text.slice(0, 300) ?? null,
                lastError: r.lastError?.slice(0, 300) ?? null,
                stats: r.stats,
                pid: r.childPid ?? null,
                rssMB: sample?.rssMB ?? null,
                cpuPct: sample && r.childPid ? this.cpu.percent(r.childPid, sample.cpuTicks, now) : null
            });
        }
        const gw = await procSample(this.gateway?.pid);
        const self = await procSample(process.pid);
        const status: FleetStatus = {
            asOf: iso(now),
            pid: process.pid,
            running: this.shuttingDown === null,
            startedAt: iso(this.startedAt),
            stoppedReason: this.shuttingDown,
            gateway: {
                port: this.config.gatewayPort,
                up: this.gateway ? await this.gateway.probe() : false,
                restarts: this.gateway?.restarts ?? 0,
                pid: this.gateway?.pid ?? null,
                rssMB: gw?.rssMB ?? null,
                cpuPct: gw && this.gateway?.pid ? this.cpu.percent(this.gateway.pid, gw.cpuTicks, now) : null
            },
            fleetProcess: {
                rssMB: Math.round(process.memoryUsage().rss / 1048576),
                cpuPct: self ? this.cpu.percent(process.pid, self.cpuTicks, now) : null
            },
            code: this.code,
            maxOnline: this.config.maxOnline,
            accounts
        };
        await writeJsonAtomic(PATHS.status, status).catch(e => fleetLog(`[fleet] could not write status: ${errText(e)}`));
    }
}

// ------------------------------------------------------------------ CLI

function flag(args: string[], name: string): string | undefined {
    const i = args.findIndex(a => a === `--${name}` || a.startsWith(`--${name}=`));
    if (i < 0) return undefined;
    const a = args[i]!;
    return a.includes('=') ? a.slice(a.indexOf('=') + 1) : args[i + 1];
}

/** Arguments that are neither flags nor the values of `valueFlags` (given as --name value). */
function positionals(args: string[], valueFlags: string[]): string[] {
    const out: string[] = [];
    for (let i = 0; i < args.length; i++) {
        const a = args[i]!;
        if (a.startsWith('--')) {
            if (!a.includes('=') && valueFlags.includes(a.slice(2))) i++;
            continue;
        }
        out.push(a);
    }
    return out;
}

function parseOptions(text: string | undefined, name = '--options'): Record<string, unknown> {
    if (!text) return {};
    const v = JSON.parse(text) as unknown;
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error(`${name} must be a JSON object`);
    return v as Record<string, unknown>;
}

function ago(t: string | null, now = Date.now()): string {
    if (!t) return '-';
    const s = Math.max(0, Math.round((now - Date.parse(t)) / 1000));
    if (s < 120) return `${s}s`;
    if (s < 7200) return `${Math.round(s / 60)}m`;
    return `${Math.floor(s / 3600)}h${String(Math.round((s % 3600) / 60)).padStart(2, '0')}m`;
}

function table(rows: string[][]): string {
    const widths = rows[0]!.map((_, c) => Math.max(...rows.map(r => (r[c] ?? '').length)));
    return rows.map(r => r.map((cell, c) => (c === r.length - 1 ? cell : cell.padEnd(widths[c]!))).join('  ')).join('\n');
}

/** Read the config the way an edit would leave it: parsed and validated, or a fresh one if none exists. */
async function readConfigForEdit(): Promise<{ maxOnline?: number; accounts: Record<string, unknown>[] } & Record<string, unknown>> {
    const text = await readFile(PATHS.config, 'utf8').catch(() => null);
    if (text === null) return { maxOnline: 40, accounts: [] };
    const raw = JSON.parse(text) as { accounts?: Record<string, unknown>[] } & Record<string, unknown>;
    parseFleetConfig(raw);
    return { ...raw, accounts: raw.accounts ?? [] };
}

async function writeConfig(raw: unknown): Promise<void> {
    parseFleetConfig(raw); // never write a config the supervisor would refuse
    await writeJsonAtomic(PATHS.config, raw);
}

async function cmdStatus(args: string[]): Promise<void> {
    const status = JSON.parse(await readFile(PATHS.status, 'utf8').catch(() => 'null')) as FleetStatus | null;
    const ledger: Ledger = await readLedger(PATHS.ledger);
    const config = await loadConfig(PATHS.config).catch((e: unknown) => e as Error);
    if (args.includes('--json')) {
        console.log(JSON.stringify({ status, ledger, config: config instanceof Error ? { error: config.message } : config }, null, 2));
        return;
    }
    const now = Date.now();
    const livePid = await readPid();
    if (!status) {
        console.log(`fleet: no status file yet (${PATHS.status})`);
    } else {
        const stale = now - Date.parse(status.asOf) > 3 * STATUS_EVERY_MS;
        const state = livePid ? (stale ? 'RUNNING BUT STATUS IS STALE' : 'running') : 'NOT RUNNING';
        const online = status.accounts.filter(a => a.state === 'online').length;
        const lite = status.accounts.filter(a => a.rssMB !== null);
        const liteRss = lite.reduce((s, a) => s + (a.rssMB ?? 0), 0);
        const liteCpu = lite.reduce((s, a) => s + (a.cpuPct ?? 0), 0);
        console.log(
            `fleet: ${state}${livePid ? ` (pid ${livePid}, up ${ago(status.startedAt, now)})` : status.stoppedReason ? ` (last stop: ${status.stoppedReason})` : ''}; ` +
            `status ${ago(status.asOf, now)} old; ${online}/${status.accounts.length} online (maxOnline ${status.maxOnline})`
        );
        console.log(
            `gateway 127.0.0.1:${status.gateway.port} ${status.gateway.up ? 'up' : 'DOWN'} (restarts ${status.gateway.restarts}); ` +
            `memory: supervisor ${status.fleetProcess.rssMB} MB, gateway ${status.gateway.rssMB ?? '?'} MB, lite clients ${liteRss} MB over ${lite.length}; ` +
            `cpu (% of one core): supervisor ${status.fleetProcess.cpuPct ?? '?'}, gateway ${status.gateway.cpuPct ?? '?'}, lite ${Math.round(liteCpu * 10) / 10}`
        );
        const onDisk = await codeVersion();
        const loaded = describeCode(status.code);
        console.log(`code: running ${loaded}${livePid && describeCode(onDisk) !== loaded ? `; checkout now has ${describeCode(onDisk)} (fleetctl restart to load it)` : ''}`);
        const rows = [['ACCOUNT', 'ROLE', 'STATE', 'FOR', 'PHASE', 'CLIENT PID', 'LOGINS', 'BANKS', 'LOG AGE', 'LAST LOG / ERROR']];
        for (const a of status.accounts) {
            const since = a.state === 'online' ? ago(a.onlineSince, now) : a.state === 'backoff' ? `retry ${a.nextAttemptAt ? Math.max(0, Math.round((Date.parse(a.nextAttemptAt) - now) / 1000)) : '?'}s` : '';
            const last = a.state === 'online' || !a.lastError ? a.lastLog : `${a.lastError}`;
            const phase = a.rolePhase ? `${a.rolePhase.slice(0, 24)} (${ago(a.rolePhaseAt, now)})` : '-';
            rows.push([a.account, a.role, a.state, since, phase, String(a.pid ?? '-'), String(a.stats.logins), String(a.stats.bankReports), ago(a.lastLogAt, now), (last ?? '').slice(0, 100)]);
        }
        console.log('');
        console.log(table(rows));
    }

    const events = parseEvents(await readFile(PATHS.events, 'utf8').catch(() => ''));
    const summary = summariseEvents(events, now);
    const counts = Object.entries(summary.counts).map(([type, n]) => `${type} ${n}`).join(', ');
    console.log(`\nevents, last hour (${PATHS.events}): ${counts || 'none'}`);
    const codes = Object.entries(summary.loginErrors).map(([code, n]) => `code ${code} x${n}`).join(', ');
    if (codes) console.log(`  login refusals: ${codes}`);
    for (const c of summary.clusters.slice(0, 8)) {
        const types = Object.entries(c.types).map(([type, n]) => `${type} x${n}`).join(', ');
        console.log(`  cluster ${c.minute.slice(11, 16)} UTC: ${c.accounts.length ? c.accounts.join(' ') : '(fleet-wide)'}: ${types}`);
    }
    if (config instanceof Error) {
        console.log(`\nfleet.json: ${config.message}`);
    } else {
        const running = new Set(status?.accounts.map(a => a.account) ?? []);
        const idle = config.accounts.filter(a => !running.has(a.account));
        if (idle.length) console.log(`\nconfigured but not running: ${idle.map(a => `${a.account} (${a.enabled ? 'waiting for a maxOnline slot or a reload' : 'disabled'})`).join(', ')}`);
    }
    console.log(`\nstock (${PATHS.ledger}${ledger.asOf ? `, newest bank visit ${ago(ledger.asOf, now)} ago` : ', empty'}):`);
    const totals = Object.entries(ledger.totals).sort((a, b) => b[1] - a[1]);
    console.log(totals.length ? table(totals.map(([name, n]) => [`  ${name}`, n.toLocaleString('en-US')])) : '  (no bank reports yet)');
}

async function cmdAdd(args: string[]): Promise<void> {
    const [rangeSpec] = positionals(args, ['count', 'role', 'options']);
    if (!rangeSpec) throw new Error('usage: fleet.ts add <range e.g. h01-h04> [--count N] [--role R] [--options JSON]');
    const range = parseRange(rangeSpec);
    const count = Number(flag(args, 'count') ?? 1);
    const role = flag(args, 'role');
    const options = parseOptions(flag(args, 'options'));
    if (role) await loadRole(role);
    const config = role ? await readConfigForEdit() : null;
    const created: string[] = [];
    for (let i = 0; i < count; i++) {
        const name = nextAccountName(await listAccounts(PATHS.bots), range);
        if (!name) {
            console.error(`range ${rangeSpec} is used up`);
            break;
        }
        const path = await createAccountEnv(PATHS.bots, name);
        created.push(name);
        console.log(`created ${path} (the account itself is created by its first login)`);
        config?.accounts.push({ account: name, role, ...(Object.keys(options).length ? { options } : {}) });
    }
    if (config && created.length) {
        await writeConfig(config);
        console.log(`added ${created.join(', ')} to ${PATHS.config} as ${role}; apply with: fleetctl reload`);
    }
}

const ASSIGN_USAGE = 'usage: fleet.ts assign <account> <role> [--options JSON] [--then ROLE [--then-options JSON] | --return] [--disable]';

/**
 * Put an account on a role. `--then ROLE [--then-options JSON]` is where it goes
 * once that role finishes; `--return` makes that its current assignment, with
 * the exact options (or, if the current one is itself finite, its `then`).
 */
async function cmdAssign(args: string[]): Promise<void> {
    const [account, role] = positionals(args, ['options', 'then', 'then-options']);
    if (!account || !role) throw new Error(ASSIGN_USAGE);
    await loadRole(role);
    const options = flag(args, 'options');
    const thenRole = flag(args, 'then');
    const thenOptions = flag(args, 'then-options');
    const back = args.includes('--return');
    if (thenRole !== undefined && back) throw new Error(`--then and --return are alternatives\n${ASSIGN_USAGE}`);
    if (thenOptions !== undefined && thenRole === undefined) throw new Error(`--then-options needs --then ROLE\n${ASSIGN_USAGE}`);
    if (thenRole !== undefined) await loadRole(thenRole);
    const config = await readConfigForEdit();
    const entry = config.accounts.find(a => a.account === account);
    let then: Assignment | undefined;
    if (thenRole !== undefined) then = { role: thenRole, options: parseOptions(thenOptions, '--then-options') };
    if (back) {
        if (!entry) throw new Error(`--return: ${account} has no assignment in ${PATHS.config} to return to`);
        then = (entry.then as Assignment | undefined) ?? { role: String(entry.role), options: (entry.options ?? {}) as Record<string, unknown> };
    }
    const next: Record<string, unknown> = { ...(entry ?? {}), account, role };
    delete next.then;
    if (options !== undefined) next.options = parseOptions(options);
    if (then) next.then = then;
    if (args.includes('--disable')) next.enabled = false;
    else delete next.enabled;
    if (entry) config.accounts[config.accounts.indexOf(entry)] = next;
    else config.accounts.push(next);
    const env = await readFile(join(PATHS.bots, account, 'bot.env'), 'utf8').catch(() => null);
    if (env === null) console.warn(`warning: ${PATHS.bots}/${account}/bot.env does not exist yet; the fleet will retry until it does`);
    await writeConfig(config);
    const after = then ? `, then ${describeAssignment(then)} once it finishes` : '';
    console.log(`${entry ? 'updated' : 'added'} ${account} -> ${role}${after}${next.enabled === false ? ' (disabled)' : ''}; apply with: fleetctl reload`);
}

/** Read-only look at one account through the fleet gateway: an observe-mode SDK never takes control from the role. */
async function cmdPeek(args: string[]): Promise<void> {
    const [account] = positionals(args, []);
    if (!account) throw new Error('usage: fleet.ts peek <account>');
    const config = await loadConfig(PATHS.config);
    const sdk = new BotSDK({
        botUsername: account,
        gatewayUrl: `ws://127.0.0.1:${config.gatewayPort}`,
        connectionMode: 'observe',
        autoReconnect: false,
        autoLaunchBrowser: false,
        showChat: false,
        readyTimeout: 0
    });
    await Promise.race([sdk.connect(), rejectAfter(10_000, 'gateway handshake')]);
    const s = await sdk.waitForCondition(st => !!st.player, 10_000).catch(() => null);
    await sdk.disconnect();
    if (!s?.player) throw new Error(`no live state for ${account} (is it online? fleetctl status)`);
    const levels = s.skills.filter(k => k.baseLevel > 1).map(k => `${k.name} ${k.baseLevel}`).join(', ');
    console.log(`${account} at (${s.player.worldX}, ${s.player.worldZ}, plane ${s.player.level}), tick ${s.tick}`);
    console.log(`levels above 1: ${levels || 'none'}`);
    console.log(`inventory (${s.inventory.length}/28): ${s.inventory.map(i => `${i.name} x${i.count}`).join(', ') || 'empty'}`);
    console.log(`equipment: ${s.equipment.map(i => i.name).join(', ') || 'none'}`);
    console.log(`last messages: ${s.gameMessages.slice(-4).map(m => m.text).join(' | ')}`);
}

async function cmdReload(): Promise<void> {
    const config = await loadConfig(PATHS.config);
    for (const role of new Set(activeAccounts(config).map(a => a.role))) await loadRole(role);
    const pid = await readPid();
    if (!pid) throw new Error('the fleet is not running (no live pid in fleet-run/fleet.pid); start it with fleetctl start');
    process.kill(pid, 'SIGHUP');
    console.log(`config is valid (${activeAccounts(config).length} active accounts); sent SIGHUP to the fleet (pid ${pid}). Watch: fleetctl status`);
}

async function main(): Promise<void> {
    const [cmd, ...args] = process.argv.slice(2);
    switch (cmd) {
        case 'run':
            await new Fleet(flag(args, 'config') ?? PATHS.config).run();
            return;
        case 'status':
            return cmdStatus(args);
        case 'add':
            return cmdAdd(args);
        case 'assign':
            return cmdAssign(args);
        case 'reload':
            return cmdReload();
        case 'peek':
            return cmdPeek(args);
        default:
            console.error('usage: bun speedrun/helpers/fleet.ts run | status [--json] | add <range> [--count N] [--role R] [--options JSON] | assign <account> <role> [--options JSON] [--then ROLE [--then-options JSON] | --return] [--disable] | reload | peek <account>');
            process.exit(2);
    }
}

if (import.meta.main) {
    main().catch(e => {
        rawConsole.error(e instanceof ConfigError ? e.message : `fleet: ${e instanceof Error ? (e.stack ?? e.message) : e}`);
        process.exit(2);
    });
}
