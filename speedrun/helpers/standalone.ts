// Run-machine launcher: runs helper roles on any machine with a checkout,
// without the bbs fleet. For helpers whose hand-off is tick-exact beside the
// scored account (altar-giver; the mule's scored-account giver; the wine giver),
// which must run on the same machine as the scored account's client. Operating
// guide: docs/speedrun/HELPERS.md, "Helpers on the run machine".
//
//   bun speedrun/helpers/standalone.ts <config.json>
//
// It starts one loopback SDK gateway (server/gateway/gateway.ts on 127.0.0.1, no
// login server), then for each account in config order: the headless lite client
// (credentials from <botsDir>/<account>/bot.env, published to that gateway), and
// once it is in the world, the role as its own process
// (`bun speedrun/helpers/<role>.ts <account> [args]` with ROLE_OPTIONS). Logins
// are strictly sequential in list order, because the engine handles players in
// login order within an IP bucket and the blind Runecraft schedule needs every
// giver handled before the scored account (docs/speedrun/skills/runecraft.md
// section 6). When every helper is in, <runDir>/launcher.json says
// helpersReady: true; the scored account's run script logs in after that.
//
// A client that exits is logged in again with backoff, and its role is then
// restarted (RoleLoop.relaunched) so that it re-reads the new session's state.
//
// An account with path 'direct' has no lite runner and no gateway hop: its role
// process logs in with its own lite client and drives it in-process
// (HELPER_PATH=direct, speedrun/helpers/role.ts runDirect, speedrun/lib/direct.ts),
// still in config order: the next account starts only once this one prints that
// it is in the world. Its logout is the role process's own; a restart of the
// role is a new login.
//
// Stop with SIGINT or SIGTERM (or let a `final` role exit): roles are stopped,
// each account clicks logout (component 2458) and only then is its client
// closed. Every account stops at once under one deadline (stopDeadlineMs), and
// whatever of the launcher's own children is still alive at it is SIGKILLed
// before the launcher exits: the children run in their own process groups, so
// an outer `timeout` that kills the launcher would otherwise leave them running.
// Processes are only ever signalled through their own child handles.
//
// The server, not the client, paces the leaving: the demo removes at most one
// logging-out player per tick across the whole world, lowest player slot first,
// so a clicked account can wait minutes behind everyone else logging out. Each
// account's logout wait therefore ends inside the deadline and reports its
// outcome (lib/direct.ts LogoutOutcome: out, queued or unconfirmed); a queued
// account leaves on its turn after its socket closes. Each account's first login
// waits until the server no longer lists it, because a copy still in the world
// refuses the login (code 5).
//
// Config (JSON):
//   gatewayPort      loopback gateway port (default 7795; the fleet uses 7790-7799 on bbs)
//   botsDir          directory of <account>/bot.env (default <checkout>/bots)
//   runDir           logs, launcher.json and the cue directory (default <checkout>/run-machine)
//   loginSpacingMs   pause between consecutive logins (default 5000)
//   stopDeadlineMs   a stop's whole budget, accounts and gateway (default 25000; at least 5000)
//   accounts         [{ account, role, options?, args?, receiver?, final?, after?, path? }]
//                    receiver: a stand-in for the scored side; not counted in helpersReady
//                    final:    when this role exits, stop everything
//                    after:    'ready': log in only once every earlier altar-giver reports ready
//                    path:     'relay' (default): lite runner + loopback gateway; 'direct': the role's own client
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Subprocess } from 'bun';
import { BotSDK } from '../../sdk/index';
import { demoOrigin, listedInWorld } from '../lib/demo-status';
import { type DirectLogoutResult, directLogoutText, type LogoutOutcome, logoutOutcome } from '../lib/direct';
import { COMBAT_LOGOUT_TICKS, LOGOUT_BUTTON } from '../lib/session';
import { parseBotEnv } from './accounts';
import { assertUntracked, readStatuses, writeJsonAtomicSync } from './altar-cue';
import { Backoff, LoginLimiter, loginFailurePolicy } from './backoff';
import { ACCOUNT_NAME_RE, FORBIDDEN_ACCOUNTS, ROLE_NAME_RE } from './fleet-config';
import { DIRECT_IN_WORLD_RE, DIRECT_LOGOUT_RE, DIRECT_REFUSED_RE } from './role';

const ROOT = resolve(import.meta.dir, '..', '..');

export interface LaunchEntry {
    account: string;
    role: string;
    options: Record<string, unknown>;
    args: string[];
    receiver: boolean;
    final: boolean;
    after: 'login' | 'ready';
    path: 'relay' | 'direct';
}

export interface LaunchConfig {
    gatewayPort: number;
    botsDir: string;
    runDir: string;
    loginSpacingMs: number;
    stopDeadlineMs: number;
    accounts: LaunchEntry[];
}

/** Validate a launcher config. Paths resolve against the checkout. Refuses the scored account and anything outside cairn_*. */
export function parseLaunchConfig(raw: unknown, root = ROOT): LaunchConfig {
    if (!raw || typeof raw !== 'object') throw new Error('config must be a JSON object');
    const r = raw as Record<string, unknown>;
    const port = Number(r.gatewayPort ?? 7795);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error(`bad gatewayPort ${r.gatewayPort}`);
    if (!Array.isArray(r.accounts) || r.accounts.length === 0) throw new Error('accounts must be a non-empty list');
    const stopDeadlineMs = Number(r.stopDeadlineMs ?? 25_000);
    if (!Number.isFinite(stopDeadlineMs) || stopDeadlineMs < 5000) throw new Error(`bad stopDeadlineMs ${r.stopDeadlineMs}: at least 5000`);
    const seen = new Set<string>();
    const accounts = r.accounts.map((a: Record<string, unknown>, i: number): LaunchEntry => {
        const account = String(a.account ?? '');
        if (!ACCOUNT_NAME_RE.test(account)) throw new Error(`accounts[${i}]: "${account}" is not a cairn_ helper name`);
        if (FORBIDDEN_ACCOUNTS.has(account)) throw new Error(`accounts[${i}]: refusing ${account}`);
        if (seen.has(account)) throw new Error(`accounts[${i}]: ${account} listed twice`);
        seen.add(account);
        const role = String(a.role ?? '');
        if (!ROLE_NAME_RE.test(role)) throw new Error(`accounts[${i}]: bad role "${role}"`);
        if (!existsSync(join(root, 'speedrun', 'helpers', `${role}.ts`))) throw new Error(`accounts[${i}]: no speedrun/helpers/${role}.ts`);
        const after = a.after ?? 'login';
        if (after !== 'login' && after !== 'ready') throw new Error(`accounts[${i}]: after must be login or ready`);
        const path = a.path ?? 'relay';
        if (path !== 'relay' && path !== 'direct') throw new Error(`accounts[${i}]: path must be relay or direct`);
        return {
            account,
            role,
            options: (a.options ?? {}) as Record<string, unknown>,
            args: Array.isArray(a.args) ? a.args.map(String) : [],
            receiver: a.receiver === true,
            final: a.final === true,
            after,
            path
        };
    });
    return {
        gatewayPort: port,
        botsDir: resolve(root, String(r.botsDir ?? 'bots')),
        runDir: resolve(root, String(r.runDir ?? 'run-machine')),
        loginSpacingMs: Number(r.loginSpacingMs ?? 5000),
        stopDeadlineMs,
        accounts
    };
}

/** Credentials check: null when usable, else why not. */
export function checkBotEnv(env: Record<string, string>, account: string, gatewayUrl: string): string | null {
    if (env.BOT_USERNAME !== account) return `BOT_USERNAME is ${env.BOT_USERNAME ?? 'missing'}, expected ${account}`;
    if (!env.PASSWORD) return 'no PASSWORD';
    if (!env.SERVER) return 'no SERVER';
    if (env.GATEWAY_URL && env.GATEWAY_URL !== gatewayUrl) return `GATEWAY_URL=${env.GATEWAY_URL} would bypass the launcher's gateway; remove that line`;
    return null;
}

/**
 * How long a direct-path role may wait for its LOGOUT once stopped: it must write its outcome
 * and exit before the launcher's per-account kill (the deadline less the gateway's share),
 * with room to abort the role and exit.
 */
export function directLogoutBudgetMs(stopDeadlineMs: number): number {
    return Math.max(2000, stopDeadlineMs - GATEWAY_STOP_RESERVE_MS - 3000);
}

/** The environment a role process gets: its bot.env (minus GATEWAY_URL), the loopback gateway, options and the cue directory. */
export function roleEnv(
    base: Record<string, string | undefined>,
    botEnv: Record<string, string>,
    e: LaunchEntry,
    gatewayUrl: string,
    runDir: string,
    loggedInAt: number,
    stopDeadlineMs = 25_000
): Record<string, string> {
    const { GATEWAY_URL: _ignored, ...creds } = botEnv;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(base)) if (v !== undefined) out[k] = v;
    return {
        ...out,
        ...creds,
        SHOW_CHAT: 'false',
        GATEWAY_URL: gatewayUrl,
        ROLE_OPTIONS: JSON.stringify(e.options),
        RC_CUE_DIR: base.RC_CUE_DIR ?? join(runDir, 'rc-cue'),
        // The role's RoleState (role.ts): what a handover already gave survives a role restart.
        ROLE_STATE_DIR: base.ROLE_STATE_DIR ?? join(runDir, 'role-state'),
        LOGGED_IN_AT: String(loggedInAt),
        HELPER_PATH: e.path,
        ...(e.path === 'direct' ? { DIRECT_LOGOUT_MS: String(directLogoutBudgetMs(stopDeadlineMs)) } : {})
    };
}

export type AccountState = 'queued' | 'logging-in' | 'online' | 'backoff' | 'stopping' | 'stopped';

/** How an account's stop ended: its logout's outcome, killed at the deadline before reporting one, or nothing to log out of. */
export type StopOutcome = LogoutOutcome | 'killed' | 'not-in-world';

const STOP_LABELS: [StopOutcome, string][] = [
    ['out', 'logged out'],
    ['queued', "logout queued at the server (clicked and served, still in its removal queue at the deadline; each leaves on its turn)"],
    ['unconfirmed', 'logout unconfirmed (no tick served after the click, or refused in combat)'],
    ['killed', 'killed at the deadline before reporting'],
    ['not-in-world', 'not in the world']
];

/** One line for a finished stop: counts by outcome, naming every account that did not log out. */
export function stopSummary(accounts: { account: string; logout?: StopOutcome | null }[]): string {
    const parts: string[] = [];
    for (const [outcome, label] of STOP_LABELS) {
        const names = accounts.filter(a => a.logout === outcome).map(a => a.account);
        if (names.length) parts.push(outcome === 'out' || outcome === 'not-in-world' ? `${names.length} ${label}` : `${names.length} ${label}: ${names.join(', ')}`);
    }
    const lingering = accounts.some(a => a.logout === 'queued' || a.logout === 'unconfirmed' || a.logout === 'killed');
    return `${parts.join('; ') || 'nothing to stop'}${lingering ? ". The next launch's first login of each waits until the server no longer lists it" : ''}`;
}

/** How long an account's first login waits for the server to drop a copy of it an earlier stop left in the world (rs/214: 2-5 min at 1,745 players). */
const LINGER_WAIT_MS = 6 * 60_000;
const LINGER_POLL_MS = 5000;

/**
 * Wait while `listed()` says the account is still in the world, polling every `everyMs`, for at
 * most `maxMs`. An unanswered check (null) doesn't hold anything up.
 */
export async function waitWhileListed(
    listed: () => Promise<boolean | null>,
    o: { maxMs: number; everyMs: number; stopped: () => boolean; onWait?: () => void; pause?: (ms: number) => Promise<void>; now?: () => number }
): Promise<{ result: 'absent' | 'unknown' | 'still-listed' | 'stopped'; waitedMs: number }> {
    const now = o.now ?? Date.now;
    const pause = o.pause ?? sleep;
    const t0 = now();
    let waiting = false;
    for (;;) {
        if (o.stopped()) return { result: 'stopped', waitedMs: now() - t0 };
        const l = await listed();
        if (l !== true) return { result: l === null ? 'unknown' : 'absent', waitedMs: now() - t0 };
        if (!waiting) o.onWait?.();
        waiting = true;
        if (now() - t0 >= o.maxMs) return { result: 'still-listed', waitedMs: now() - t0 };
        await pause(Math.min(o.everyMs, Math.max(0, o.maxMs - (now() - t0))));
    }
}

export interface LauncherStatus {
    pid: number;
    startedAt: number;
    gatewayPort: number;
    /** Every non-receiver account is online (logged in since the launcher started it). */
    helpersReady: boolean;
    accounts: { account: string; role: string; receiver: boolean; path: LaunchEntry['path']; state: AccountState; loggedInAt: number | null; logins: number; logout?: StopOutcome | null }[];
    ms: number;
}

export function helpersReady(accounts: LauncherStatus['accounts']): boolean {
    const helpers = accounts.filter(a => !a.receiver);
    return helpers.length > 0 && helpers.every(a => a.state === 'online');
}

// ------------------------------------------------------------------ processes

function sleep(ms: number): Promise<void> {
    return new Promise<void>(r => setTimeout(r, ms));
}
const iso = () => new Date().toISOString();
const LOGIN_TIMEOUT_MS = 90_000;
/** A direct-path role's logout outside a launcher stop (its own DIRECT_LOGOUT_MS budget is inside the stop's deadline). */
const DIRECT_STOP_GRACE_MS = 40_000;
/** A relay account's logout wait ends this long before its deadline, leaving the client time to close. */
const RELAY_CLOSE_RESERVE_MS = 1500;

async function pipeLines(stream: ReadableStream<Uint8Array>, onLine: (line: string) => void): Promise<void> {
    const decoder = new TextDecoder();
    const reader = stream.getReader();
    let buf = '';
    for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
            onLine(buf.slice(0, nl));
            buf = buf.slice(nl + 1);
        }
    }
    if (buf) onLine(buf);
}

// Every child gets its own process group, so a terminal's Ctrl-C (SIGINT to the
// whole foreground group) reaches only the launcher, which then stops the roles
// and logs each account out before closing its client. Without it the clients
// die with the launcher and the accounts linger in the world until the server
// times them out. Bun 1.3 honours `detached` though its types don't declare it.
const OWN_GROUP = { detached: true } as {};

/** The gateway's share of a stop's deadline: the relay accounts log out through it, so it goes last. */
const GATEWAY_STOP_RESERVE_MS = 2000;

/** What a stop needs of an account: a graceful stop whose waits end by `deadline`, and a hard kill of its own children. */
export interface Stoppable {
    stop(deadline: number): Promise<void>;
    kill(): void;
}

/**
 * Stop every account at once; at `deadline` SIGKILL (through `kill`) each one
 * whose stop has not finished. Resolves by the deadline with how many were killed.
 */
export async function stopAllWithin(items: Stoppable[], deadline: number): Promise<number> {
    let killed = 0;
    await Promise.all(
        items.map(async it => {
            let timer: ReturnType<typeof setTimeout> | undefined;
            const late = new Promise<false>(r => (timer = setTimeout(() => r(false), Math.max(0, deadline - Date.now()))));
            const done = await Promise.race([it.stop(deadline).then(() => true, () => true), late]);
            clearTimeout(timer);
            if (!done) {
                killed++;
                it.kill();
            }
        })
    );
    return killed;
}

/**
 * A stop request. The first one wins and its arrival fixes the deadline, so the
 * bound runs from the signal, not from whenever the launcher gets round to
 * stopping. If the stop has not `finished()` by the deadline (plus `slackMs`),
 * `onOverdue` runs: the launcher's last resort, which kills its children and exits.
 */
export class StopRequest {
    why: string | null = null;
    code = 0;
    deadline = Infinity;
    /** Resolves when a stop is requested; the start loop races its waits against it. */
    readonly requested: Promise<void>;
    private resolve: () => void = () => undefined;
    private watchdog: ReturnType<typeof setTimeout> | undefined;

    constructor(
        private readonly budgetMs: number,
        private readonly onOverdue: () => void,
        private readonly slackMs = 500
    ) {
        this.requested = new Promise<void>(r => (this.resolve = r));
    }

    request(why: string, code = 0): void {
        if (this.why !== null) return;
        this.why = why;
        this.code = code;
        this.deadline = Date.now() + this.budgetMs;
        this.watchdog = setTimeout(this.onOverdue, this.budgetMs + this.slackMs);
        this.resolve();
    }

    finished(): void {
        clearTimeout(this.watchdog);
    }
}

/** `ms`, cut to what is left before `deadline`. */
const remaining = (deadline: number, ms: number) => Math.max(0, Math.min(ms, deadline - Date.now()));

async function exitedWithin(child: { exited: Promise<unknown> }, ms: number): Promise<boolean> {
    if (ms <= 0) return Promise.race([child.exited.then(() => true), Promise.resolve(false)]);
    return Promise.race([child.exited.then(() => true), sleep(ms).then(() => false)]);
}

/** What RoleLoop needs of a role process (a Bun Subprocess, or a fake in tests). */
export interface RoleProcess {
    readonly pid: number;
    readonly exitCode: number | null;
    readonly exited: Promise<number | null>;
    kill(signal: 'SIGTERM' | 'SIGKILL'): void;
}

export interface RoleLoopHooks {
    /** Before every start: a direct-path role logs in when it starts, so this is where it waits for a login slot. */
    beforeSpawn?(): Promise<void>;
    /** Start the role process. Called afresh for every start, so its environment carries the current login. */
    spawn(): RoleProcess;
    isStopping(): boolean;
    log(line: string): void;
    /** A `final` role exited on its own: stop everything. */
    onFinal(why: string, code: number): void;
    /** Grace before SIGKILL when a relaunch terminates the role (default 15 s). */
    killGraceMs?: number;
}

/**
 * One account's role process: started once its client is in the world,
 * restarted with backoff when it fails, left alone once it finishes (exit 0),
 * and restarted at once on every client relaunch. A relaunched client is a new
 * session behind the same loopback gateway, but the SDK connection the old role
 * holds keeps reporting the old session's state with inGame true and no
 * reconnect signal; only a fresh role start passes through runStandalone's
 * fresh-state gate. Roles are restartable by contract, so restarting is safe.
 */
export class RoleLoop {
    private proc: RoleProcess | null = null;
    private relaunch = false;
    private ended = false;
    private wake: (() => void) | null = null;
    private readonly backoff = new Backoff({ initialMs: 15_000, maxMs: 5 * 60_000, resetAfterMs: 10 * 60_000 });
    done: Promise<void> = Promise.resolve();

    constructor(
        readonly entry: Pick<LaunchEntry, 'account' | 'role' | 'final'>,
        private readonly h: RoleLoopHooks
    ) {}

    get running(): RoleProcess | null {
        return this.proc;
    }

    start(): Promise<void> {
        this.done = this.loop().finally(() => {
            this.ended = true;
        });
        return this.done;
    }

    private async loop(): Promise<void> {
        const { account, role, final } = this.entry;
        while (!this.h.isStopping()) {
            await this.h.beforeSpawn?.();
            if (this.h.isStopping()) return;
            const started = Date.now();
            const child = this.h.spawn();
            this.proc = child;
            this.h.log(`[launcher] ${account}: role ${role} started (pid ${child.pid})`);
            await child.exited;
            this.proc = null;
            if (this.h.isStopping()) return;
            if (this.takeRelaunch()) continue;
            if (final) {
                this.h.onFinal(`${account}: final role ${role} exited with code ${child.exitCode}`, child.exitCode ?? 1);
                return;
            }
            if (child.exitCode === 0) {
                // The role finished its job (handover, a bounded giver run); the account stays logged in until the stop.
                this.h.log(`[launcher] ${account}: role ${role} finished; not restarting it`);
                return;
            }
            const wait = this.backoff.failure(started, Date.now());
            this.h.log(`[launcher] ${account}: role exited with code ${child.exitCode}; restarting in ${Math.round(wait / 1000)}s`);
            await this.pause(wait);
            this.takeRelaunch();
        }
    }

    private takeRelaunch(): boolean {
        if (!this.relaunch) return false;
        this.relaunch = false;
        this.backoff.reset();
        this.h.log(`[launcher] ${this.entry.account}: client relaunched; restarting role ${this.entry.role}`);
        return true;
    }

    private pause(ms: number): Promise<void> {
        return new Promise(resolve => {
            const done = () => {
                clearTimeout(timer);
                clearInterval(poll);
                this.wake = null;
                resolve();
            };
            const timer = setTimeout(done, ms);
            const poll = setInterval(() => this.h.isStopping() && done(), 500);
            this.wake = done;
        });
    }

    /** The account's client was relaunched and is in the world again: restart the role now, without backoff. */
    async relaunched(): Promise<void> {
        if (this.ended || this.h.isStopping()) return;
        this.relaunch = true;
        const p = this.proc;
        if (p && p.exitCode === null) {
            p.kill('SIGTERM');
            if (!(await exitedWithin(p, this.h.killGraceMs ?? 15_000))) p.kill('SIGKILL');
        } else this.wake?.();
    }
}

class Launcher {
    private gateway: Subprocess<'ignore', 'pipe', 'pipe'> | null = null;
    private readonly accounts: AccountRun[];
    private readonly stopReq: StopRequest;
    private readonly logins = new LoginLimiter({ perMinute: 6, burst: 3, minSpacingMs: 4000 });
    readonly startedAt = Date.now();
    readonly logDir: string;

    constructor(readonly cfg: LaunchConfig) {
        this.logDir = join(cfg.runDir, 'logs');
        this.accounts = cfg.accounts.map(e => new AccountRun(this, e));
        this.stopReq = new StopRequest(cfg.stopDeadlineMs, () => this.overdue());
    }

    /** The stop's deadline passed with something still pending: kill every child we hold and exit. */
    private overdue(): void {
        this.log(`[launcher] stop not finished ${this.cfg.stopDeadlineMs} ms after ${this.stopReq.why}; killing every child process and exiting`);
        for (const a of this.accounts) a.kill();
        if (this.gateway && this.gateway.exitCode === null) this.gateway.kill('SIGKILL');
        process.exit(this.stopReq.code || 1);
    }

    get gatewayUrl(): string {
        return `ws://127.0.0.1:${this.cfg.gatewayPort}`;
    }

    get isStopping(): boolean {
        return this.stopReq.why !== null;
    }

    /** Wait `ms`, or less if a stop is requested meanwhile. */
    private pauseUnlessStopped(ms: number): Promise<void> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        return Promise.race([new Promise<void>(r => (timer = setTimeout(r, ms))), this.stopReq.requested]).finally(() => clearTimeout(timer));
    }

    log(line: string): void {
        console.log(`${iso()} ${line}`);
    }

    takeLogin(): Promise<void> {
        return this.logins.take();
    }

    pauseLogins(ms: number, why: string): void {
        this.logins.pause(Date.now() + ms);
        this.log(`[launcher] logins paused ${Math.round(ms / 1000)}s: ${why}`);
    }

    status(): LauncherStatus {
        const accounts = this.accounts.map(a => a.summary());
        return { pid: process.pid, startedAt: this.startedAt, gatewayPort: this.cfg.gatewayPort, helpersReady: helpersReady(accounts), accounts, ms: Date.now() };
    }

    writeStatus(): void {
        writeJsonAtomicSync(join(this.cfg.runDir, 'launcher.json'), this.status());
    }

    async run(): Promise<number> {
        const { cfg } = this;
        assertUntracked(cfg.runDir);
        for (const a of this.accounts) a.preflight();
        mkdirSync(this.logDir, { recursive: true, mode: 0o700 });
        // Before anything is started: a signal from here on stops what exists, within the deadline from its arrival.
        const stop = (why: string, c = 0) => this.stopReq.request(why, c);
        process.on('SIGINT', () => stop('SIGINT'));
        process.on('SIGTERM', () => stop('SIGTERM'));
        this.onStop = stop;
        const timer = setInterval(() => this.writeStatus(), 2000);
        try {
            await this.startGateway();
            // Sequential, in config order: the next account logs in only after the previous one is in the world.
            // Each wait is raced against a stop: a login still pending is the account's stop's to end.
            for (const a of this.accounts) {
                if (this.isStopping) break;
                if (a.entry.after === 'ready') await this.waitForGiversReady(a);
                if (this.isStopping) break;
                await Promise.race([a.start(), this.stopReq.requested]);
                this.writeStatus();
                if (cfg.loginSpacingMs > 0) await this.pauseUnlessStopped(cfg.loginSpacingMs);
            }
            if (!this.isStopping) this.log(`[launcher] all accounts started; helpersReady=${this.status().helpersReady}`);
            await this.stopReq.requested;
        } finally {
            if (!this.isStopping) this.stopReq.request('startup failed', 1);
            this.log(`[launcher] stopping: ${this.stopReq.why}`);
            const deadline = this.stopReq.deadline;
            await stopAllWithin(this.accounts, deadline - GATEWAY_STOP_RESERVE_MS);
            this.log(`[launcher] stop: ${stopSummary(this.accounts.map(a => a.summary()))}`);
            await this.stopGateway(deadline);
            this.stopReq.finished();
            clearInterval(timer);
            this.writeStatus();
        }
        return this.stopReq.code;
    }

    onStop: (why: string, code?: number) => void = () => undefined;

    private async waitForGiversReady(a: AccountRun): Promise<void> {
        const earlier = this.accounts.slice(0, this.accounts.indexOf(a)).filter(x => x.entry.role === 'altar-giver').map(x => x.entry.account);
        const dir = String(process.env.RC_CUE_DIR ?? join(this.cfg.runDir, 'rc-cue'));
        this.log(`[launcher] ${a.entry.account} waits for ${earlier.join(', ')} to be ready`);
        while (!this.isStopping) {
            const ready = new Set(readStatuses(dir).filter(s => s.phase === 'ready' && Date.now() - s.ms < 5000).map(s => s.account));
            if (earlier.every(n => ready.has(n))) return;
            await this.pauseUnlessStopped(1000);
        }
    }

    private async probe(): Promise<boolean> {
        try {
            const res = await fetch(`http://127.0.0.1:${this.cfg.gatewayPort}/status`, { signal: AbortSignal.timeout(1500) });
            return res.ok;
        } catch {
            return false;
        }
    }

    private async startGateway(): Promise<void> {
        if (await this.probe()) throw new Error(`something already answers on 127.0.0.1:${this.cfg.gatewayPort}; pick another gatewayPort`);
        const logPath = join(this.logDir, 'gateway.log');
        const child = Bun.spawn([process.execPath, 'server/gateway/gateway.ts'], {
            ...OWN_GROUP,
            cwd: ROOT,
            env: {
                ...process.env,
                AGENT_PORT: String(this.cfg.gatewayPort),
                GATEWAY_HOSTNAME: '127.0.0.1',
                GATEWAY_PUBLIC_PORT: '0',
                // No login server: any local SDK connection is accepted, which is why it binds loopback only.
                LOGIN_SERVER: 'false',
                ENGINE_MANAGEMENT_URL: 'http://127.0.0.1:9'
            },
            stdin: 'ignore',
            stdout: 'pipe',
            stderr: 'pipe'
        });
        this.gateway = child;
        const onLine = (l: string) => appendFileSync(logPath, `${iso()} ${l}\n`);
        void pipeLines(child.stdout, onLine);
        void pipeLines(child.stderr, onLine);
        this.log(`[launcher] gateway started (pid ${child.pid})`);
        const deadline = Date.now() + 20_000;
        while (!(await this.probe())) {
            if (this.isStopping) return;
            if (child.exitCode !== null || Date.now() > deadline) throw new Error(`gateway did not come up on 127.0.0.1:${this.cfg.gatewayPort}; see ${logPath}`);
            await sleep(250);
        }
        void child.exited.then(c => {
            if (!this.isStopping) this.onStop(`gateway exited with code ${c}`, 1);
        });
        this.log(`[launcher] gateway on 127.0.0.1:${this.cfg.gatewayPort}`);
    }

    private async stopGateway(deadline: number): Promise<void> {
        const g = this.gateway;
        if (!g || g.exitCode !== null) return;
        g.kill('SIGINT');
        if (!(await exitedWithin(g, remaining(deadline, 5000)))) g.kill('SIGKILL');
    }
}

class AccountRun implements Stoppable {
    state: AccountState = 'queued';
    loggedInAt: number | null = null;
    logins = 0;
    stopOutcome: StopOutcome | null = null;
    private lite: Subprocess<'ignore', 'pipe', 'pipe'> | null = null;
    private botEnv: Record<string, string> = {};
    private readonly relogin = new Backoff({ initialMs: 10_000, maxMs: 60_000, resetAfterMs: 5 * 60_000 });
    private supervising: Promise<void> | null = null;
    private readonly roles: RoleLoop;

    constructor(
        private readonly L: Launcher,
        readonly entry: LaunchEntry
    ) {
        this.roles = new RoleLoop(entry, {
            beforeSpawn: () => this.beforeRoleStart(),
            spawn: () => this.spawnRole(),
            // A direct-path role logs out before it exits, which can take a combat timer.
            ...(entry.path === 'direct' ? { killGraceMs: DIRECT_STOP_GRACE_MS } : {}),
            isStopping: () => this.L.isStopping,
            log: line => this.L.log(line),
            onFinal: (why, code) => this.L.onStop(why, code)
        });
    }

    private get envPath(): string {
        return join(this.L.cfg.botsDir, this.entry.account, 'bot.env');
    }

    summary(): LauncherStatus['accounts'][number] {
        return {
            account: this.entry.account,
            role: this.entry.role,
            receiver: this.entry.receiver,
            path: this.entry.path,
            state: this.state,
            loggedInAt: this.loggedInAt,
            logins: this.logins,
            logout: this.stopOutcome
        };
    }

    /**
     * Before this run's first login of the account: a copy an earlier stop left in the world (its
     * logout still in the server's removal queue, or a killed client) refuses the login with code 5
     * and spends the login limiter's attempts, so wait until the server no longer lists it.
     */
    private async waitForEarlierCopy(): Promise<void> {
        if (this.logins > 0) return;
        const origin = demoOrigin(this.botEnv.SERVER);
        const name = this.entry.account;
        const { result, waitedMs } = await waitWhileListed(() => listedInWorld(origin, name), {
            maxMs: LINGER_WAIT_MS,
            everyMs: LINGER_POLL_MS,
            stopped: () => this.L.isStopping,
            onWait: () => this.L.log(`[launcher] ${name}: still in the world from an earlier session; its login waits until ${origin}/playerpositions drops it (at most ${LINGER_WAIT_MS / 60_000} min)`)
        });
        if (result === 'still-listed') this.L.log(`[launcher] ${name}: still listed after ${Math.round(waitedMs / 1000)}s; logging in anyway`);
        else if (waitedMs > 0 && result === 'absent') this.L.log(`[launcher] ${name}: left the world after ${Math.round(waitedMs / 1000)}s`);
    }

    private note(stream: 'lite' | 'role', line: string): void {
        appendFileSync(join(this.L.logDir, `${this.entry.account}.${stream}.log`), `${iso()} ${line}\n`);
    }

    /** Before anything starts: credentials are readable, sane, and not committable. */
    preflight(): void {
        assertUntracked(join(this.L.cfg.botsDir, this.entry.account));
        let text: string;
        try {
            text = readFileSync(this.envPath, 'utf8');
        } catch {
            throw new Error(`${this.entry.account}: no credentials at ${this.envPath}`);
        }
        this.botEnv = parseBotEnv(text);
        // Credentials travel only by environment or the 600-mode file; argv is visible to every user in ps.
        if (this.entry.args.some(a => this.botEnv.PASSWORD && a.includes(this.botEnv.PASSWORD))) {
            throw new Error(`${this.entry.account}: a role argument carries the account's password; pass credentials only through bot.env`);
        }
        const why = checkBotEnv(this.botEnv, this.entry.account, this.L.gatewayUrl);
        if (why) throw new Error(`${this.entry.account}: ${this.envPath}: ${why}`);
    }

    /** Log in (waiting for it), start the role, and keep both running in the background. */
    async start(): Promise<void> {
        if (this.entry.path === 'direct') return this.startDirect();
        const first = await this.session();
        this.supervising = this.supervise(first);
        await Promise.race([sleep(1000), this.roles.start()]);
    }

    private markIn: (() => void) | null = null;
    private refusal: number | null = null;

    /** Direct path: the role process is the client. Resolves once it says it is in the world (or gives up waiting). */
    private async startDirect(): Promise<void> {
        const inWorld = new Promise<'in'>(r => (this.markIn = () => r('in')));
        const first = await Promise.race([inWorld, this.roles.start().then(() => 'ended' as const), sleep(LOGIN_TIMEOUT_MS).then(() => 'timeout' as const)]);
        if (first === 'timeout') this.L.log(`[launcher] ${this.entry.account}: not in the world after ${LOGIN_TIMEOUT_MS / 1000}s; starting the next account, this one keeps trying`);
    }

    /** Before each direct-path start (a login): honour a refusal's delay, then take a login slot. */
    private async beforeRoleStart(): Promise<void> {
        if (this.entry.path !== 'direct') return;
        if (this.refusal !== null) {
            const p = loginFailurePolicy(this.refusal);
            if (p.fleetPauseMs) this.L.pauseLogins(p.fleetPauseMs, `${this.entry.account} refused with code ${this.refusal}`);
            if (p.needsAttention) this.L.log(`[launcher] ${this.entry.account}: login refused with code ${this.refusal}; check its credentials`);
            this.refusal = null;
            const until = Date.now() + p.accountDelayMs;
            while (Date.now() < until && !this.L.isStopping) await sleep(500);
        }
        if (this.L.isStopping) return;
        await this.waitForEarlierCopy();
        if (this.L.isStopping) return;
        await this.L.takeLogin();
        this.state = 'logging-in';
        this.logins++;
        this.L.log(`[launcher] ${this.entry.account}: logging in to ${this.botEnv.SERVER} (direct)`);
    }

    /** One login: resolves once the client is in the world, with a promise for the session's end. */
    private async session(): Promise<{ ended: Promise<{ code: number | null; login?: { code: number } }> }> {
        for (;;) {
            if (this.L.isStopping) return { ended: Promise.resolve({ code: null }) };
            await this.waitForEarlierCopy();
            if (this.L.isStopping) return { ended: Promise.resolve({ code: null }) };
            await this.L.takeLogin();
            if (this.L.isStopping) return { ended: Promise.resolve({ code: null }) };
            this.state = 'logging-in';
            this.logins++;
            this.L.log(`[launcher] ${this.entry.account}: logging in to ${this.botEnv.SERVER}`);
            const child = Bun.spawn([process.execPath, 'src/lite/runner.ts', this.entry.account], {
                ...OWN_GROUP,
                cwd: join(ROOT, 'server', 'webclient'),
                env: { ...process.env, LITE_BOT_ENV: this.envPath, GATEWAY_URL: this.L.gatewayUrl, LITE_LOGIN_JITTER_MS: '0' },
                stdin: 'ignore',
                stdout: 'pipe',
                stderr: 'pipe'
            });
            this.lite = child;
            this.L.log(`[launcher] ${this.entry.account}: client started (pid ${child.pid})`);
            let markIn: () => void = () => undefined;
            const inWorld = new Promise<'in'>(r => (markIn = () => r('in')));
            let refusal: { code: number } | undefined;
            const onLine = (line: string) => {
                this.note('lite', line);
                if (/^LoginError: /.test(line)) refusal = { code: 0 };
                const code = /^\s*code: (\d+),?$/.exec(line);
                if (code && refusal) refusal.code = Number(code[1]);
                if (/^\[lite-runner\] '.+' logged into /.test(line)) markIn();
            };
            const piped = Promise.all([pipeLines(child.stdout, onLine), pipeLines(child.stderr, onLine)]);
            const ended = child.exited.then(async code => {
                await Promise.race([piped, sleep(2000)]);
                return { code, ...(refusal ? { login: refusal } : {}) };
            });
            const first = await Promise.race([inWorld, ended.then(() => 'exit' as const), sleep(LOGIN_TIMEOUT_MS).then(() => 'timeout' as const)]);
            if (first === 'in') {
                this.loggedInAt = Date.now();
                this.state = 'online';
                this.L.log(`[launcher] ${this.entry.account}: in the world (login ${this.logins})`);
                this.L.writeStatus();
                return { ended };
            }
            if (first === 'timeout') {
                child.kill('SIGINT');
                if (!(await exitedWithin(child, 5000))) child.kill('SIGKILL');
            }
            const exit = await ended;
            if (exit.code === 3) {
                this.L.onStop(`${this.entry.account}: client revision is older than the server's (exit 3)`, 3);
                return { ended: Promise.resolve(exit) };
            }
            await this.backoff(exit, null);
        }
    }

    private async backoff(exit: { code: number | null; login?: { code: number } }, onlineSince: number | null): Promise<void> {
        this.state = 'backoff';
        let wait = this.relogin.failure(onlineSince, Date.now());
        if (exit.login) {
            const p = loginFailurePolicy(exit.login.code);
            wait = Math.max(wait, p.accountDelayMs);
            if (p.fleetPauseMs) this.L.pauseLogins(p.fleetPauseMs, `${this.entry.account} refused with code ${exit.login.code}`);
            if (p.needsAttention) this.L.log(`[launcher] ${this.entry.account}: login refused with code ${exit.login.code}; check its credentials`);
        }
        this.L.log(`[launcher] ${this.entry.account}: client exited (${exit.code}); next login in ${Math.round(wait / 1000)}s`);
        const until = Date.now() + wait;
        while (Date.now() < until && !this.L.isStopping) await sleep(500);
    }

    /** Re-login after unexpected client exits. A relog puts the account at the end of its processing bucket; the giver notices. */
    private async supervise(first: { ended: Promise<{ code: number | null; login?: { code: number } }> }): Promise<void> {
        let s = first;
        while (!this.L.isStopping) {
            const exit = await s.ended;
            this.lite = null;
            if (this.L.isStopping || this.state === 'stopping') return;
            await this.backoff(exit, this.loggedInAt);
            if (this.L.isStopping) return;
            s = await this.session();
            if (this.state === 'online' && !this.L.isStopping) await this.roles.relaunched();
        }
    }

    /** One role process, its output piped to <account>.role.log; it resolves `exited` only once that output is drained. */
    private spawnRole(): RoleProcess {
        const e = this.entry;
        const env = roleEnv(process.env, this.botEnv, e, this.L.gatewayUrl, this.L.cfg.runDir, this.loggedInAt ?? Date.now(), this.L.cfg.stopDeadlineMs);
        const child = Bun.spawn([process.execPath, `speedrun/helpers/${e.role}.ts`, e.account, ...e.args], { ...OWN_GROUP, cwd: ROOT, env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
        const onLine = (line: string) => {
            this.note('role', line);
            if (line.startsWith('RESULT ')) this.L.log(`[${e.account}] ${line}`);
            if (e.path !== 'direct') return;
            if (DIRECT_IN_WORLD_RE.test(line)) {
                this.loggedInAt = Date.now();
                this.state = 'online';
                this.L.log(`[launcher] ${e.account}: in the world (login ${this.logins}, direct)`);
                this.L.writeStatus();
                this.markIn?.();
            }
            const refused = DIRECT_REFUSED_RE.exec(line);
            if (refused) this.refusal = Number(refused[1]);
            const logout = DIRECT_LOGOUT_RE.exec(line);
            if (logout) this.stopOutcome = logout[1] as LogoutOutcome;
        };
        const exited = Promise.all([pipeLines(child.stdout, onLine), pipeLines(child.stderr, onLine), child.exited]).then(() => {
            if (e.path === 'direct' && this.state !== 'stopping') {
                // The client went with the process: offline until the next start logs in again.
                this.state = child.exitCode === 0 ? 'stopped' : 'backoff';
                if (child.exitCode === 3) this.L.onStop(`${e.account}: client revision is older than the server's (exit 3)`, 3);
                this.L.writeStatus();
            }
            return child.exitCode;
        });
        return {
            pid: child.pid,
            get exitCode() {
                return child.exitCode;
            },
            exited,
            kill: signal => child.kill(signal)
        };
    }

    /** Role first (it may be mid-trade), then logout by the button, then the client; every wait ends by `deadline`. */
    async stop(deadline: number): Promise<void> {
        if (this.state === 'queued') {
            this.state = 'stopped';
            return;
        }
        // A relay client that never got into the world has nothing to log out of: close it at once.
        const inWorld = this.state === 'online';
        this.state = 'stopping';
        const direct = this.entry.path === 'direct';
        const role = this.roles.running;
        if (role && role.exitCode === null) {
            role.kill('SIGTERM');
            // A direct role logs out itself, within DIRECT_LOGOUT_MS, and reports how (DIRECT_LOGOUT_RE).
            if (!(await exitedWithin(role, remaining(deadline, direct ? DIRECT_STOP_GRACE_MS : 15_000)))) {
                role.kill('SIGKILL');
                if (direct) this.stopOutcome ??= 'killed';
            }
        }
        await this.roles.done.catch(() => undefined);
        if (direct) this.stopOutcome ??= inWorld ? 'unconfirmed' : 'not-in-world';
        const lite = this.lite;
        // Left unset while a relay logout runs, so a kill in the middle of it reads 'killed'.
        if (!direct && !(inWorld && lite && lite.exitCode === null)) this.stopOutcome = 'not-in-world';
        if (lite && lite.exitCode === null) {
            if (inWorld) {
                const r = await this.relayLogout(lite, deadline);
                this.stopOutcome = logoutOutcome(r);
                this.L.log(`[launcher] ${this.entry.account}: logout: ${directLogoutText(r)}`);
            }
            if (lite.exitCode === null) {
                this.L.log(`[launcher] ${this.entry.account}: ${inWorld ? `logout ${this.stopOutcome}` : 'not in the world'}; closing the client`);
                lite.kill('SIGINT');
                if (!(await exitedWithin(lite, remaining(deadline, 5000)))) lite.kill('SIGKILL');
            }
        }
        await this.supervising?.catch(() => undefined);
        this.state = 'stopped';
        this.L.log(`[launcher] ${this.entry.account}: stopped (logout: ${this.stopOutcome})`);
    }

    /** Past the stop's deadline: SIGKILL this account's own role and client, whatever they are doing. */
    kill(): void {
        for (const p of [this.roles.running, this.lite]) if (p && p.exitCode === null) p.kill('SIGKILL');
        this.state = 'stopped';
        // A logout already reported queued or out stays so: the server holds the click, not the process.
        this.stopOutcome ??= 'killed';
        this.L.log(`[launcher] ${this.entry.account}: killed at the stop deadline (logout: ${this.stopOutcome})`);
    }

    /**
     * Click logout through our own SDK connection and wait, until shortly before the deadline, for
     * the client to leave: the server's removal queue can hold a clicked player far longer than a
     * tick. Refused in combat: wait the combat window out and click again.
     */
    private async relayLogout(lite: Subprocess, deadline: number): Promise<DirectLogoutResult> {
        const waitUntil = deadline - RELAY_CLOSE_RESERVE_MS;
        const t0 = performance.now();
        let clicks = 0;
        let clickTick = 0;
        let refused = false;
        const sdk = new BotSDK({
            botUsername: this.entry.account,
            password: this.botEnv.PASSWORD!,
            gatewayUrl: this.L.gatewayUrl,
            connectionMode: 'control',
            autoReconnect: false,
            autoLaunchBrowser: false,
            showChat: false,
            readyTimeout: 0
        });
        const tick = () => sdk.getState()?.tick ?? 0;
        const refusedSince = (t: number) => sdk.getState()?.gameMessages.some(m => /can't log ?out/i.test(m.text) && m.tick >= t) ?? false;
        const result = (ok: boolean, reason?: string): DirectLogoutResult => ({
            ok,
            via: ok ? 'logout' : null,
            clicks,
            clickTick,
            endTick: tick(),
            wallMs: performance.now() - t0,
            ...(reason ? { reason } : {}),
            ...(refused ? { refused } : {})
        });
        try {
            await Promise.race([sdk.connect(), sleep(remaining(waitUntil, 10_000)).then(() => Promise.reject(new Error('gateway handshake timed out')))]);
            clickTick = tick();
            while (Date.now() < waitUntil) {
                const sent = tick();
                await sdk.sendClickComponent(LOGOUT_BUTTON).catch(() => undefined);
                clicks++;
                refused = false;
                while (lite.exitCode === null && Date.now() < waitUntil && !(refused = refusedSince(sent))) await sleep(100);
                if (lite.exitCode !== null) return result(true);
                if (!refused) break;
                await sdk.waitForCondition(s => s.tick >= sent + COMBAT_LOGOUT_TICKS + 1, remaining(waitUntil, 15_000)).catch(() => undefined);
            }
            return result(false, `still in the world after ${Math.round(performance.now() - t0)} ms`);
        } catch (e) {
            return result(false, `logout failed: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
            await sdk.disconnect().catch(() => undefined);
        }
    }
}

if (import.meta.main) {
    const path = process.argv[2];
    if (!path) {
        console.error('usage: bun speedrun/helpers/standalone.ts <config.json>');
        process.exit(2);
    }
    const cfg = parseLaunchConfig(JSON.parse(readFileSync(path, 'utf8')));
    const code = await new Launcher(cfg).run();
    process.exit(code);
}
