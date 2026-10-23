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
//   accounts         [{ account, role, options?, args?, receiver?, final?, after?, path?, stopOn?, loginOn?, cueDir? }]
//                    receiver: a stand-in for the scored side; not counted in helpersReady
//                    final:    when this role exits, stop everything
//                    after:    'ready': log in only once every earlier altar-giver reports ready
//                    path:     'relay' (default): lite runner + loopback gateway; 'direct': the role's own client
//                    stopOn:   { step, family }: when the scope closes (its final stop, or the next scope's
//                              cue after its stop), stop the role and log the account out at once; a
//                              plain stop (one session of several) leaves it in (closed before its
//                              login: it never logs in)
//                    loginOn:  { step, family, waitMinutes?, cueDir? }: stay logged out until a cue addressed
//                              to it opens, then log in and start the role; its scope is also the stop scope
//                              unless stopOn names another. Waits at most waitMinutes (default 600).
//                              cueDir: a login-only folder with its own writer, read for the login alone
//                              and only until the login settles; the role and stopOn stay on the account's
//                              cueDir (which must then be named, with stopOn, and no final)
//                    cueDir:   the cue directory of this account's role and cue gate (default RC_CUE_DIR,
//                              else <runDir>/rc-cue; the role's options.cueDir, when set, is the same)
//
// The cue gate (stopOn, loginOn; CueGate) reads cue.json with altar-cue.ts's CueWatcher, the one
// cue reader, and counts only cues written since the launcher started: cue.json outlives a launch,
// and an earlier attempt's stop must not log this one's helpers out. Docs: HELPERS.md, "The cue gate".
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Subprocess } from 'bun';
import { BotSDK } from '../../sdk/index';
import { demoOrigin, listedInWorld } from '../lib/demo-status';
import { type DirectLogoutResult, directLogoutText, type LogoutOutcome, logoutOutcome } from '../lib/direct';
import { COMBAT_LOGOUT_TICKS, LOGOUT_BUTTON } from '../lib/session';
import { parseBotEnv } from './accounts';
import { assertUntracked, type Cue, type CueScope, CueWatcher, readStatuses, scopeError, writeJsonAtomicSync } from './altar-cue';
import { Backoff, LoginLimiter, type LoginLimitPolicy, loginFailurePolicy } from './backoff';
import { ACCOUNT_NAME_RE, FORBIDDEN_ACCOUNTS, ROLE_NAME_RE } from './fleet-config';
import { DIRECT_IN_WORLD_RE, DIRECT_LOGOUT_RE, DIRECT_REFUSED_RE } from './role';

const ROOT = resolve(import.meta.dir, '..', '..');

/**
 * The launcher's login limiter: every login it makes (config order, cue-triggered, relogins) queues
 * on it. A burst of 3 back to back, then 6 a minute, never two within 4 s.
 */
export const LAUNCHER_LOGIN_POLICY: Readonly<LoginLimitPolicy> = { perMinute: 6, burst: 3, minSpacingMs: 4_000 };

export interface LaunchEntry {
    account: string;
    role: string;
    options: Record<string, unknown>;
    args: string[];
    receiver: boolean;
    final: boolean;
    after: 'login' | 'ready';
    path: 'relay' | 'direct';
    /** Log out at once when this scope closes (CueGate); loginOn's scope when not set. */
    stopOn: CueScope | null;
    /** Stay logged out until a cue addressed to this scope opens. */
    loginOn: LoginOn | null;
    /** The account's cue directory, absolute; null: RC_CUE_DIR, else <runDir>/rc-cue. */
    cueDir: string | null;
}

export interface LoginOn extends CueScope {
    /** How long the account waits logged out for its cue before it gives up (never logs in). */
    waitMs: number;
    /**
     * A login-only folder, absolute: the login scope is read there and nowhere else, and only until
     * the login settles; the role and the stop scope stay on the account's cueDir. Null: the login
     * scope is read in the account's cueDir with the stop scope.
     */
    cueDir: string | null;
}

/** loginOn's default bound: longer than the whole run (9 h), so only a cue that never comes ends it. */
export const DEFAULT_LOGIN_WAIT_MINUTES = 600;

export const scopeText = (s: CueScope): string => `${s.step}/${s.family}`;

function scopeField(raw: unknown, name: string): CueScope {
    const err = scopeError(raw);
    if (err) throw new Error(`${name}: ${err}`);
    const s = raw as CueScope;
    return { step: s.step, family: s.family };
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
        const options = (a.options ?? {}) as Record<string, unknown>;
        let loginOn: LoginOn | null = null;
        if (a.loginOn !== undefined) {
            const l = (a.loginOn ?? {}) as Record<string, unknown>;
            const minutes = Number(l.waitMinutes ?? DEFAULT_LOGIN_WAIT_MINUTES);
            if (!Number.isFinite(minutes) || minutes <= 0) throw new Error(`accounts[${i}].loginOn: waitMinutes must be a positive number (got ${JSON.stringify(l.waitMinutes)})`);
            if (after === 'ready') throw new Error(`accounts[${i}]: loginOn and after: 'ready' are alternatives`);
            if (l.cueDir !== undefined && (typeof l.cueDir !== 'string' || !l.cueDir.trim())) {
                throw new Error(`accounts[${i}].loginOn.cueDir: a folder path is required (got ${JSON.stringify(l.cueDir)})`);
            }
            const loginDir = typeof l.cueDir === 'string' ? resolve(root, l.cueDir) : null;
            loginOn = { ...scopeField(l, `accounts[${i}].loginOn`), waitMs: minutes * 60_000, cueDir: loginDir };
        }
        const stopOn = a.stopOn === undefined ? (loginOn ? { step: loginOn.step, family: loginOn.family } : null) : scopeField(a.stopOn, `accounts[${i}].stopOn`);
        // The gate must read the directory the role reads: options.cueDir, when given, is that directory.
        const own = a.cueDir === undefined ? null : resolve(root, String(a.cueDir));
        const roles = typeof options.cueDir === 'string' ? resolve(root, options.cueDir) : null;
        if (own && roles && own !== roles) throw new Error(`accounts[${i}]: cueDir ${own} and options.cueDir ${roles} differ`);
        if (loginOn?.cueDir) {
            // One writer per folder: the login trigger's writer owns the login folder, the role's cue writer the role's.
            const at = `accounts[${i}].loginOn.cueDir`;
            const roleDir = own ?? roles;
            if (!roleDir) throw new Error(`${at}: a login-only folder needs the role's own cue folder named too (cueDir)`);
            if (loginOn.cueDir === roleDir) throw new Error(`${at}: ${roleDir} is the role's cue folder; the login folder must be another (one writer per folder)`);
            if (a.stopOn === undefined) throw new Error(`${at}: a login-only folder needs stopOn, the role folder's scope whose close logs the account out`);
            if (scopeText(stopOn!) === scopeText(loginOn)) throw new Error(`${at}: stopOn must be another scope than the login trigger's ${scopeText(loginOn)}`);
            if (a.final === true) throw new Error(`${at}: an account logged in on a login folder leaves on its stop scope; final would stop the whole launcher when its role exits`);
        }
        return {
            account,
            role,
            options,
            args: Array.isArray(a.args) ? a.args.map(String) : [],
            receiver: a.receiver === true,
            final: a.final === true,
            after,
            path,
            stopOn,
            loginOn,
            cueDir: own ?? roles
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

/** The same directory: the same path, or (both existing) the same device and inode, as through a symlink. */
export function sameCueDir(a: string, b: string): boolean {
    if (resolve(a) === resolve(b)) return true;
    try {
        const x = statSync(a);
        const y = statSync(b);
        return x.dev === y.dev && x.ino === y.ino;
    } catch {
        return false;
    }
}

/** Create a role folder and a login folder, refusing them as one directory: each folder has one writer. */
export function assertDistinctCueDirs(roleDir: string, loginDir: string): void {
    for (const d of [roleDir, loginDir]) mkdirSync(d, { recursive: true, mode: 0o700 });
    if (sameCueDir(roleDir, loginDir)) throw new Error(`login folder ${loginDir} is the role's cue folder ${roleDir}; one writer per folder`);
}

/** An account's cue directory: its own (cueDir), else RC_CUE_DIR, else <runDir>/rc-cue. */
export function accountCueDir(e: Pick<LaunchEntry, 'cueDir'>, runDir: string, base: Record<string, string | undefined> = process.env): string {
    return e.cueDir ?? resolve(base.RC_CUE_DIR ?? join(runDir, 'rc-cue'));
}

/**
 * The environment a role process gets: its bot.env (minus GATEWAY_URL), the loopback gateway, options
 * and the cue directory; for an account logged in on a cue (loginOn), that cue's write time.
 */
export function roleEnv(
    base: Record<string, string | undefined>,
    botEnv: Record<string, string>,
    e: LaunchEntry,
    gatewayUrl: string,
    runDir: string,
    loggedInAt: number,
    stopDeadlineMs = 25_000,
    loginCueMs?: number
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
        RC_CUE_DIR: e.cueDir ?? base.RC_CUE_DIR ?? join(runDir, 'rc-cue'),
        // The mule serves the cue it was logged in on however long the login took (mule.ts cueEpoch).
        ...(loginCueMs !== undefined ? { LOGIN_CUE_MS: String(loginCueMs) } : {}),
        // The role's RoleState (role.ts): what a handover already gave survives a role restart.
        ROLE_STATE_DIR: base.ROLE_STATE_DIR ?? join(runDir, 'role-state'),
        LOGGED_IN_AT: String(loggedInAt),
        HELPER_PATH: e.path,
        ...(e.path === 'direct' ? { DIRECT_LOGOUT_MS: String(directLogoutBudgetMs(stopDeadlineMs)) } : {})
    };
}

/** awaiting-cue: a loginOn account, logged out until its cue opens. */
export type AccountState = 'queued' | 'awaiting-cue' | 'logging-in' | 'online' | 'backoff' | 'stopping' | 'stopped';

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
 * most `maxMs`. An unanswered check (null) doesn't hold anything up. `waited` says whether the
 * account was ever listed (onWait fired): `waitedMs` includes the checks' own time, so it is above
 * zero even for an account that was never there.
 */
export async function waitWhileListed(
    listed: () => Promise<boolean | null>,
    o: { maxMs: number; everyMs: number; stopped: () => boolean; onWait?: () => void; pause?: (ms: number) => Promise<void>; now?: () => number }
): Promise<{ result: 'absent' | 'unknown' | 'still-listed' | 'stopped'; waitedMs: number; waited: boolean }> {
    const now = o.now ?? Date.now;
    const pause = o.pause ?? sleep;
    const t0 = now();
    let waiting = false;
    for (;;) {
        if (o.stopped()) return { result: 'stopped', waitedMs: now() - t0, waited: waiting };
        const l = await listed();
        if (l !== true) return { result: l === null ? 'unknown' : 'absent', waitedMs: now() - t0, waited: waiting };
        if (!waiting) o.onWait?.();
        waiting = true;
        if (now() - t0 >= o.maxMs) return { result: 'still-listed', waitedMs: now() - t0, waited: true };
        await pause(Math.min(o.everyMs, Math.max(0, o.maxMs - (now() - t0))));
    }
}

/**
 * Where an account's cue gate stands. waiting: logged out until its login cue opens; opened: it opened
 * (the account logs in, or is in); watching: in the run until its scope closes; stood-down: its scope's
 * session stopped without closing the scope (a program segment), so it stays in the world for the next
 * session; stopped: its scope closed (logged out at once, or never logged in); expired: no login cue
 * within loginOn's wait (never logged in).
 */
export type GateState = 'waiting' | 'opened' | 'watching' | 'stood-down' | 'stopped' | 'expired';

export interface AccountCueStatus {
    /** loginOn's scope, as step/family. */
    login: string | null;
    /** stopOn's scope, as step/family. */
    stop: string | null;
    state: GateState;
    /** Date.now() when `state` was reached. */
    ms: number;
}

export interface LauncherStatus {
    pid: number;
    startedAt: number;
    gatewayPort: number;
    /** Every helper the scored account waits for is in: see helpersReady. */
    helpersReady: boolean;
    accounts: {
        account: string;
        role: string;
        receiver: boolean;
        path: LaunchEntry['path'];
        state: AccountState;
        loggedInAt: number | null;
        logins: number;
        logout?: StopOutcome | null;
        cue?: AccountCueStatus | null;
    }[];
    ms: number;
}

/**
 * A helper is where the run wants it: online, or logged out waiting for its login cue (a family the
 * run logs in later), or out of the run on its gate (its scope closed, or its login cue never came),
 * so the flag neither waits for a cued family nor drops when one logs out. Logging in after its cue
 * opened, or relogging, is not ready.
 */
export function helperReady(a: Pick<LauncherStatus['accounts'][number], 'state' | 'cue'>): boolean {
    if (a.state === 'online') return true;
    const gate = a.cue?.state;
    return gate === 'waiting' || gate === 'stopped' || gate === 'expired';
}

/** Every helper is ready-or-waiting (helperReady); receivers, the scored side's stand-ins, don't count. */
export function helpersReady(accounts: LauncherStatus['accounts']): boolean {
    const helpers = accounts.filter(a => !a.receiver);
    return helpers.length > 0 && helpers.every(helperReady);
}

// ------------------------------------------------------------------ the cue gate

/**
 * What a cue means to the launcher: nothing when it was written before `since` (the launcher's start:
 * cue.json outlives a launch, and an earlier attempt's stop must not log this one's accounts out),
 * else a final stop (Cue.final), a stop, or an open (any other write).
 */
export function gateEvent(cue: Pick<Cue, 'stop' | 'final' | 'ms'>, since: number): 'open' | 'stop' | 'final' | null {
    if (!(cue.ms >= since)) return null;
    if (!cue.stop) return 'open';
    return cue.final ? 'final' : 'stop';
}

/** A scope that is over for the launcher: its final stop, or `cue`, the next scope's, after its stop `after`. */
export type ScopeClosed = { scope: CueScope; cue: Cue } & ({ why: 'final' } | { why: 'next-scope'; after: Cue });

export function closedText(c: ScopeClosed): string {
    const at = (cue: Cue) => `session ${cue.session}, seq ${cue.seq}`;
    if (c.why === 'final') return `final stop for ${scopeText(c.scope)} (${at(c.cue)})`;
    return `cue for ${scopeText(c.cue.scope)} (${at(c.cue)}) after ${scopeText(c.scope)}'s stop (${at(c.after)})`;
}

/**
 * One scope's sessions as the launcher sees them. A plain stop ends a session and stands the scope
 * down: the step may open another (runecraft.ts's program segments, its stock rung and hand-back, a
 * resumed step's reopen). The scope closes on a final stop, or on a cue for another scope written
 * after its stop: cue.json holds one scope at a time, so the next scope's cue means this one is over.
 * A cue from before `since` changes nothing. Each method returns the transition it made, if any.
 */
export class ScopeSessions {
    state: 'none' | 'open' | 'stood-down' | 'closed' = 'none';
    closed: ScopeClosed | null = null;
    private lastStop: Cue | null = null;

    constructor(
        readonly scope: CueScope,
        private readonly since: number
    ) {}

    /** A new cue addressed to the scope. */
    own(cue: Cue): 'open' | 'stood-down' | 'closed' | null {
        const ev = gateEvent(cue, this.since);
        if (!ev || this.state === 'closed') return null;
        if (ev === 'final') {
            this.closed = { scope: this.scope, cue, why: 'final' };
            this.state = 'closed';
            return 'closed';
        }
        if (ev === 'stop') {
            const was = this.state;
            this.lastStop = cue;
            this.state = 'stood-down';
            return was === 'stood-down' ? null : 'stood-down';
        }
        if (this.state === 'open') return null;
        this.state = 'open';
        return 'open';
    }

    /** A new cue addressed to another scope. */
    other(cue: Cue): 'closed' | null {
        if (!gateEvent(cue, this.since) || this.state !== 'stood-down' || !this.lastStop) return null;
        this.closed = { scope: this.scope, cue, why: 'next-scope', after: this.lastStop };
        this.state = 'closed';
        return 'closed';
    }
}

export type LoginWait = { result: 'open'; cue: Cue } | { result: 'stop'; closed: ScopeClosed } | { result: 'expired' } | { result: 'stopped' };

export interface CueGateOptions {
    /** The role's cue folder: the stop scope's, and the login scope's unless `loginDir` is set. */
    dir: string;
    /**
     * A login-only folder (loginOn.cueDir), never `dir`: the login scope is read there alone, and only
     * until the login settles, so nothing written there afterwards reaches the account.
     */
    loginDir?: string;
    /** loginOn's scope: its first open lets the account log in; its closing before that keeps it out. */
    login: CueScope | null;
    /** stopOn's scope: its closing ends the account's run (onStop). */
    stop: CueScope | null;
    /** Cues written before this (Date.now()) are an earlier launch's. */
    since: number;
    /** `stop`'s scope closed, once; called outside the watcher's callback. */
    onStop(closed: ScopeClosed): void;
    /** `stop`'s scope opened a session, or stood down (a stop that does not close it); called outside the watcher's callback. */
    onSession?(event: 'open' | 'stood-down', cue: Cue): void;
    /** CueWatcher's notes (cues for other scopes) and the gate's own. */
    log(line: string): void;
    /** CueWatcher's poll beside fs.watch (default 100 ms). */
    pollMs?: number;
}

/**
 * One account's view of the cue directory for the launcher (stopOn, loginOn), through CueWatcher, the
 * one cue reader: its stop and its login trigger, each scope's sessions followed by ScopeSessions.
 * Each is decided once: the stop scope's closing is the stop, and the login is settled by the login
 * scope's first open or its closing (or the stop scope's), whichever comes first. With `loginDir` the
 * login scope is read in that folder alone, and its watcher closes once the login is settled.
 */
export class CueGate {
    private login: 'waiting' | { result: 'open'; cue: Cue } | { result: 'stop'; closed: ScopeClosed } = 'waiting';
    private stopped: ScopeClosed | null = null;
    private readonly loginScope: ScopeSessions | null;
    private readonly stopScope: ScopeSessions | null;
    private readonly watchers: { dir: string; watcher: CueWatcher }[] = [];
    /** The login folder's watcher (loginDir), until the login settles. */
    private loginWatcher: CueWatcher | null = null;
    /** The stop scope's watcher, re-read before an open from the login folder counts (stopClosedNow). */
    private stopWatcher: CueWatcher | null = null;
    private readonly wakes = new Set<() => void>();
    private early = false;

    constructor(private readonly o: CueGateOptions) {
        const log = (m: string, d?: Record<string, unknown>) => o.log(`${m} ${JSON.stringify(d ?? {})}`);
        if (o.loginDir !== undefined) {
            if (!o.login) throw new Error('CueGate: a login folder needs a login scope');
            assertDistinctCueDirs(o.dir, o.loginDir);
        }
        const same = o.loginDir === undefined && !!o.login && !!o.stop && scopeText(o.login) === scopeText(o.stop);
        this.loginScope = o.login ? new ScopeSessions(o.login, o.since) : null;
        this.stopScope = same ? this.loginScope : o.stop ? new ScopeSessions(o.stop, o.since) : null;
        // The role folder first: a login folder's open already on disk is read only after it (onCue).
        const order = o.loginDir !== undefined ? [this.stopScope, this.loginScope] : [this.loginScope, this.stopScope];
        for (const s of new Set(order)) {
            if (!s) continue;
            const own = s === this.loginScope && o.loginDir !== undefined;
            const dir = own ? o.loginDir! : o.dir;
            const watcher = new CueWatcher(dir, s.scope, cue => this.onCue(s, cue), { log, pollMs: o.pollMs ?? 100, onOther: cue => this.changed(s, s.other(cue), cue) });
            this.watchers.push({ dir, watcher });
            if (own) this.loginWatcher = watcher;
            if (s === this.stopScope) this.stopWatcher = watcher;
        }
    }

    /**
     * The stop scope's close, re-reading the role folder now. With a login folder the two folders' writes
     * have no common order, so a close already written there must win over a login about to happen
     * however the watchers' polls fall; the launcher asks just before each login.
     */
    stopClosedNow(): ScopeClosed | null {
        this.stopWatcher?.check();
        return this.stopped;
    }

    /** The folders read now, one entry per watcher. */
    get watching(): string[] {
        return this.watchers.map(w => w.dir);
    }

    private onCue(s: ScopeSessions, cue: Cue): void {
        if (!gateEvent(cue, this.o.since)) {
            if (!this.early) this.o.log(`cue for ${scopeText(cue.scope)} written before this launch ignored (session ${cue.session}, seq ${cue.seq})`);
            this.early = true;
            return;
        }
        // An open from the login folder counts only after the role folder is read: its close wins.
        if (s === this.loginScope && this.loginWatcher && this.login === 'waiting') this.stopWatcher?.check();
        this.changed(s, s.own(cue), cue);
    }

    private changed(s: ScopeSessions, change: 'open' | 'stood-down' | 'closed' | null, cue: Cue): void {
        if (!change) return;
        if (s === this.loginScope && this.login === 'waiting') {
            if (change === 'open') this.login = this.stopped ? { result: 'stop', closed: this.stopped } : { result: 'open', cue };
            if (change === 'closed') this.login = { result: 'stop', closed: s.closed! };
        }
        if (s === this.stopScope) {
            if (change === 'closed' && !this.stopped) {
                const closed = s.closed!;
                this.stopped = closed;
                queueMicrotask(() => this.o.onStop(closed));
            } else if (change !== 'closed' && this.o.onSession) {
                const onSession = this.o.onSession;
                queueMicrotask(() => onSession(change, cue));
            }
        }
        // The login folder triggers one login, never a stop: once the login is settled it is not read again.
        if (this.loginWatcher && this.loginResult()) this.closeLoginFolder();
        for (const w of this.wakes) w();
    }

    private closeLoginFolder(): void {
        const w = this.loginWatcher!;
        this.loginWatcher = null;
        w.close();
        const i = this.watchers.findIndex(x => x.watcher === w);
        if (i >= 0) this.watchers.splice(i, 1);
    }

    /** The login's outcome so far: open, or stop (the login scope closed, or the stop scope did), or null while waiting. */
    private loginResult(): LoginWait | null {
        if (this.login !== 'waiting') return this.login;
        if (this.stopped) return { result: 'stop', closed: this.stopped };
        return null;
    }

    /** Settles on the login scope's first open or stop (or the stop scope's stop), after `maxMs` (expired), or when `cancelled` resolves (stopped). */
    async waitForLogin(maxMs: number, cancelled: Promise<unknown>): Promise<LoginWait> {
        const deadline = Date.now() + maxMs;
        for (;;) {
            const settled = this.loginResult();
            if (settled) return settled;
            let wake: () => void = () => undefined;
            let timer: ReturnType<typeof setTimeout> | undefined;
            const woken = new Promise<'cue'>(r => (wake = () => r('cue')));
            this.wakes.add(wake);
            const r = await Promise.race([woken, new Promise<'expired'>(res => (timer = setTimeout(() => res('expired'), Math.max(0, deadline - Date.now())))), cancelled.then(() => 'stopped' as const)]);
            clearTimeout(timer);
            this.wakes.delete(wake);
            // A cue that settled it meanwhile still counts.
            if (r !== 'cue') return this.loginResult() ?? { result: r };
        }
    }

    close(): void {
        for (const w of this.watchers) w.watcher.close();
        this.watchers.length = 0;
        this.loginWatcher = null;
        this.stopWatcher = null;
    }
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
    private readonly logins = new LoginLimiter({ ...LAUNCHER_LOGIN_POLICY });
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

    /** Resolves when the launcher's stop is requested. */
    get stopRequested(): Promise<void> {
        return this.stopReq.requested;
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
            // From here on a stop cue counts, even for an account still waiting its turn to log in.
            for (const a of this.accounts) a.arm();
            await this.startGateway();
            // Sequential, in config order: the next account logs in only after the previous one is in the world.
            // Each wait is raced against a stop: a login still pending is the account's stop's to end.
            for (const a of this.accounts) {
                if (this.isStopping) break;
                if (a.entry.loginOn) {
                    // It logs in when its cue opens, whenever that is; the accounts after it don't wait for it.
                    void a.startOnCue().catch(e => stop(`${a.entry.account}: login on cue failed: ${e instanceof Error ? e.message : String(e)}`, 1));
                    continue;
                }
                if (a.retired) continue; // its stop cue came before its turn: it never logs in
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
            for (const a of this.accounts) a.disarm();
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
        // A giver that logs in only on a cue, or has already left on its stop, is not waited for.
        const earlier = this.accounts
            .slice(0, this.accounts.indexOf(a))
            .filter(x => x.entry.role === 'altar-giver' && !x.entry.loginOn && !x.retired)
            .map(x => x.entry.account);
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
    /** Why the account left the run before the launcher's stop (its stop cue, or no login cue in time); null while in it. */
    retired: string | null = null;
    private gate: CueGate | null = null;
    private cue: AccountCueStatus | null = null;
    /** The cue that logged this account in (loginOn). */
    private loginCue: Cue | null = null;
    private stopping: Promise<void> | null = null;

    constructor(
        private readonly L: Launcher,
        readonly entry: LaunchEntry
    ) {
        this.roles = new RoleLoop(entry, {
            beforeSpawn: () => this.beforeRoleStart(),
            spawn: () => this.spawnRole(),
            // A direct-path role logs out before it exits, which can take a combat timer.
            ...(entry.path === 'direct' ? { killGraceMs: DIRECT_STOP_GRACE_MS } : {}),
            isStopping: () => this.halted,
            log: line => this.L.log(line),
            onFinal: (why, code) => this.L.onStop(why, code)
        });
    }

    private get envPath(): string {
        return join(this.L.cfg.botsDir, this.entry.account, 'bot.env');
    }

    /** The launcher is stopping, or this account has left the run: nothing logs in or restarts. */
    private get halted(): boolean {
        return this.L.isStopping || this.retired !== null;
    }

    private get cueDir(): string {
        return accountCueDir(this.entry, this.L.cfg.runDir);
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
            logout: this.stopOutcome,
            ...(this.cue ? { cue: { ...this.cue } } : {})
        };
    }

    private setGate(state: GateState): void {
        if (this.cue) this.cue = { ...this.cue, state, ms: Date.now() };
    }

    /** Start reading the account's login and stop cues (loginOn, stopOn), if it has any. */
    arm(): void {
        const { loginOn, stopOn, account } = this.entry;
        if (!loginOn && !stopOn) return;
        this.cue = { login: loginOn ? scopeText(loginOn) : null, stop: stopOn ? scopeText(stopOn) : null, state: loginOn ? 'waiting' : 'watching', ms: Date.now() };
        this.gate = new CueGate({
            dir: this.cueDir,
            ...(loginOn?.cueDir ? { loginDir: loginOn.cueDir } : {}),
            login: loginOn,
            stop: stopOn,
            since: this.L.startedAt,
            onStop: closed => this.onScopeClosed(closed),
            onSession: (event, cue) => this.onStopScopeSession(event, cue),
            // Every account sees every other family's cues go by: those notes go to its own log.
            log: line => this.note('cue', line)
        });
        const loginAt = loginOn?.cueDir ? ` in its login folder ${loginOn.cueDir} (read only until it logs in)` : '';
        this.L.log(
            `[launcher] ${account}: reading ${this.cueDir}${loginOn ? `; logs in when a cue for ${scopeText(loginOn)} opens${loginAt}` : ''}${stopOn ? `; logs out when ${scopeText(stopOn)} closes (its final stop, or the next scope's cue after its stop)` : ''}`
        );
    }

    disarm(): void {
        this.gate?.close();
        this.gate = null;
    }

    /** Out of the run before logging in: nothing to log out of. */
    private neverLogsIn(why: string, gate: GateState): void {
        this.retired ??= why;
        this.setGate(gate);
        this.state = 'stopped';
        this.stopOutcome = 'not-in-world';
        this.disarm();
        this.L.writeStatus();
    }

    /** Logged in (or logging in), as opposed to waiting its turn or its login cue. */
    private get inRun(): boolean {
        return this.state !== 'queued' && this.state !== 'awaiting-cue';
    }

    /**
     * Just before a login: for an account with a login folder, its role folder is re-read now (CueGate
     * stopClosedNow), so a stop scope's close already written wins over the login whatever the polls'
     * timing; one never logged in stays out for good, and a relogin waits for the stop it is part of.
     * One folder needs no re-read: cue.json orders its own writes.
     */
    private loginBlocked(): boolean {
        if (this.halted) return true;
        if (!this.entry.loginOn?.cueDir || !this.gate) return false;
        const closed = this.gate.stopClosedNow();
        if (!closed) return false;
        if (this.retired === null && !this.inRun) {
            const why = closedText(closed);
            this.L.log(`[launcher] ${this.entry.account}: ${why} before its login: it never logs in`);
            this.neverLogsIn(why, 'stopped');
        }
        return true;
    }

    /**
     * stopOn's scope stopped a session without closing (a program segment: the step opens another), or
     * opened one: the account stays in the world either way; its role stands down on the stop itself.
     */
    private onStopScopeSession(event: 'open' | 'stood-down', cue: Cue): void {
        if (this.retired !== null || this.L.isStopping || !this.cue) return;
        const { account } = this.entry;
        const at = `${scopeText(cue.scope)} (session ${cue.session}, seq ${cue.seq})`;
        if (event === 'stood-down') {
            if (!this.inRun) {
                this.L.log(`[launcher] ${account}: stop for ${at} does not close it: ${this.state === 'awaiting-cue' ? 'still waits for its open' : 'logs in on its turn'}`);
                return;
            }
            this.setGate('stood-down');
            this.L.log(`[launcher] ${account}: stop for ${at} does not close it: stood down, stays in the world until its final stop or the next scope's cue`);
        } else {
            if (this.cue.state !== 'stood-down') return;
            this.setGate(this.entry.loginOn ? 'opened' : 'watching');
            this.L.log(`[launcher] ${account}: new session for ${at}: watching it`);
        }
        this.L.writeStatus();
    }

    /** stopOn's scope closed: the account leaves the run now, without waiting for the launcher's stop. */
    private onScopeClosed(closed: ScopeClosed): void {
        if (this.retired !== null || this.L.isStopping) return;
        const { account } = this.entry;
        const why = closedText(closed);
        if (!this.inRun) {
            this.L.log(`[launcher] ${account}: ${why} before its login: it never logs in`);
            this.neverLogsIn(why, 'stopped');
            return;
        }
        this.retired = why;
        this.setGate('stopped');
        this.L.log(`[launcher] ${account}: ${why}: stopping role ${this.entry.role} and logging out now`);
        // The launcher's own stop path for this one account (a combat refusal waited out and clicked
        // again), under the same budget, with the same kill at its end.
        void stopAllWithin([this], Date.now() + this.L.cfg.stopDeadlineMs).then(() => {
            this.disarm();
            this.L.log(`[launcher] ${account}: out of the run on its stop cue (logout: ${this.stopOutcome})`);
            this.L.writeStatus();
        });
    }

    /** loginOn: logged out until the login cue opens, then the normal start (login, then role). */
    async startOnCue(): Promise<void> {
        const on = this.entry.loginOn!;
        const { account } = this.entry;
        if (this.halted || !this.gate) return;
        this.state = 'awaiting-cue';
        const wait = on.waitMs < 120_000 ? `${Math.round(on.waitMs / 1000)} s` : `${Math.round(on.waitMs / 60_000)} min`;
        this.L.log(`[launcher] ${account}: logged out until a cue for ${scopeText(on)} opens (at most ${wait})`);
        this.L.writeStatus();
        const w = await this.gate.waitForLogin(on.waitMs, this.L.stopRequested);
        if (w.result === 'stopped' || this.L.isStopping) return;
        if (w.result === 'stop') {
            // onScopeClosed has handled stopOn's scope closing; this is the login scope's, when stopOn names another.
            if (this.retired === null) {
                const why = closedText(w.closed);
                this.L.log(`[launcher] ${account}: ${why} before its login: it never logs in`);
                this.neverLogsIn(why, 'stopped');
            }
            return;
        }
        if (w.result === 'expired') {
            const why = `no cue for ${scopeText(on)} within ${wait}`;
            this.L.log(`[launcher] !!! ${account}: ${why}: it never logs in`);
            this.neverLogsIn(why, 'expired');
            return;
        }
        if (this.halted) return;
        this.loginCue = w.cue;
        this.setGate('opened');
        this.L.log(`[launcher] ${account}: cue for ${scopeText(on)} opened (session ${w.cue.session}, seq ${w.cue.seq}): logging in`);
        this.state = 'queued';
        await this.start();
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
        const { result, waitedMs, waited } = await waitWhileListed(() => listedInWorld(origin, name), {
            maxMs: LINGER_WAIT_MS,
            everyMs: LINGER_POLL_MS,
            stopped: () => this.halted,
            onWait: () => this.L.log(`[launcher] ${name}: still in the world from an earlier session; its login waits until ${origin}/playerpositions drops it (at most ${LINGER_WAIT_MS / 60_000} min)`)
        });
        if (result === 'still-listed') this.L.log(`[launcher] ${name}: still listed after ${Math.round(waitedMs / 1000)}s; logging in anyway`);
        else if (waited && result === 'absent') this.L.log(`[launcher] ${name}: left the world after ${Math.round(waitedMs / 1000)}s`);
    }

    private note(stream: 'lite' | 'role' | 'cue', line: string): void {
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
        if (this.entry.loginOn || this.entry.stopOn) assertUntracked(this.cueDir);
        const loginDir = this.entry.loginOn?.cueDir;
        if (loginDir) {
            assertUntracked(loginDir);
            assertDistinctCueDirs(this.cueDir, loginDir);
        }
    }

    /** Log in (waiting for it), start the role, and keep both running in the background. */
    async start(): Promise<void> {
        if (this.halted) return;
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
            while (Date.now() < until && !this.halted) await sleep(500);
        }
        if (this.halted) return;
        await this.waitForEarlierCopy();
        if (this.halted) return;
        await this.L.takeLogin();
        if (this.loginBlocked()) return;
        this.state = 'logging-in';
        this.logins++;
        this.L.log(`[launcher] ${this.entry.account}: logging in to ${this.botEnv.SERVER} (direct)`);
    }

    /** One login: resolves once the client is in the world, with a promise for the session's end. */
    private async session(): Promise<{ ended: Promise<{ code: number | null; login?: { code: number } }> }> {
        for (;;) {
            if (this.halted) return { ended: Promise.resolve({ code: null }) };
            await this.waitForEarlierCopy();
            if (this.halted) return { ended: Promise.resolve({ code: null }) };
            await this.L.takeLogin();
            if (this.loginBlocked()) return { ended: Promise.resolve({ code: null }) };
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
        // A client closed by a stop is not a failure, and the stop owns the account's state.
        if (this.halted) return;
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
        while (Date.now() < until && !this.halted) await sleep(500);
    }

    /** Re-login after unexpected client exits. A relog puts the account at the end of its processing bucket; the giver notices. */
    private async supervise(first: { ended: Promise<{ code: number | null; login?: { code: number } }> }): Promise<void> {
        let s = first;
        while (!this.halted) {
            const exit = await s.ended;
            this.lite = null;
            if (this.halted || this.state === 'stopping') return;
            await this.backoff(exit, this.loggedInAt);
            if (this.halted) return;
            s = await this.session();
            if (this.state === 'online' && !this.halted) await this.roles.relaunched();
        }
    }

    /** One role process, its output piped to <account>.role.log; it resolves `exited` only once that output is drained. */
    private spawnRole(): RoleProcess {
        const e = this.entry;
        const env = roleEnv(process.env, this.botEnv, e, this.L.gatewayUrl, this.L.cfg.runDir, this.loggedInAt ?? Date.now(), this.L.cfg.stopDeadlineMs, this.loginCue?.ms);
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

    /**
     * Role first (it may be mid-trade), then logout by the button, then the client; every wait ends by
     * `deadline`. Once: a launcher stop that finds the account already leaving on its stop cue waits for that.
     */
    stop(deadline: number): Promise<void> {
        this.stopping ??= this.stopNow(deadline);
        return this.stopping;
    }

    private async stopNow(deadline: number): Promise<void> {
        if (this.state === 'queued' || this.state === 'awaiting-cue') {
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
