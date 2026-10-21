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
// Stop with SIGINT or SIGTERM (or let a `final` role exit): roles are stopped,
// each account clicks logout (component 2458) and only then is its client
// closed. Processes are only ever signalled through their own child handles.
//
// Config (JSON):
//   gatewayPort      loopback gateway port (default 7795; the fleet uses 7790-7799 on bbs)
//   botsDir          directory of <account>/bot.env (default <checkout>/bots)
//   runDir           logs, launcher.json and the cue directory (default <checkout>/run-machine)
//   loginSpacingMs   pause between consecutive logins (default 5000)
//   accounts         [{ account, role, options?, args?, receiver?, final?, after? }]
//                    receiver: a stand-in for the scored side; not counted in helpersReady
//                    final:    when this role exits, stop everything
//                    after:    'ready': log in only once every earlier altar-giver reports ready
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Subprocess } from 'bun';
import { BotSDK } from '../../sdk/index';
import { COMBAT_LOGOUT_TICKS, LOGOUT_BUTTON } from '../lib/session';
import { parseBotEnv } from './accounts';
import { assertUntracked, readStatuses, writeJsonAtomicSync } from './altar-cue';
import { Backoff, LoginLimiter, loginFailurePolicy } from './backoff';
import { ACCOUNT_NAME_RE, FORBIDDEN_ACCOUNTS, ROLE_NAME_RE } from './fleet-config';

const ROOT = resolve(import.meta.dir, '..', '..');

export interface LaunchEntry {
    account: string;
    role: string;
    options: Record<string, unknown>;
    args: string[];
    receiver: boolean;
    final: boolean;
    after: 'login' | 'ready';
}

export interface LaunchConfig {
    gatewayPort: number;
    botsDir: string;
    runDir: string;
    loginSpacingMs: number;
    accounts: LaunchEntry[];
}

/** Validate a launcher config. Paths resolve against the checkout. Refuses the scored account and anything outside cairn_*. */
export function parseLaunchConfig(raw: unknown, root = ROOT): LaunchConfig {
    if (!raw || typeof raw !== 'object') throw new Error('config must be a JSON object');
    const r = raw as Record<string, unknown>;
    const port = Number(r.gatewayPort ?? 7795);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error(`bad gatewayPort ${r.gatewayPort}`);
    if (!Array.isArray(r.accounts) || r.accounts.length === 0) throw new Error('accounts must be a non-empty list');
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
        return {
            account,
            role,
            options: (a.options ?? {}) as Record<string, unknown>,
            args: Array.isArray(a.args) ? a.args.map(String) : [],
            receiver: a.receiver === true,
            final: a.final === true,
            after
        };
    });
    return {
        gatewayPort: port,
        botsDir: resolve(root, String(r.botsDir ?? 'bots')),
        runDir: resolve(root, String(r.runDir ?? 'run-machine')),
        loginSpacingMs: Number(r.loginSpacingMs ?? 5000),
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

/** The environment a role process gets: its bot.env (minus GATEWAY_URL), the loopback gateway, options and the cue directory. */
export function roleEnv(base: Record<string, string | undefined>, botEnv: Record<string, string>, e: LaunchEntry, gatewayUrl: string, runDir: string, loggedInAt: number): Record<string, string> {
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
        LOGGED_IN_AT: String(loggedInAt)
    };
}

export type AccountState = 'queued' | 'logging-in' | 'online' | 'backoff' | 'stopping' | 'stopped';

export interface LauncherStatus {
    pid: number;
    startedAt: number;
    gatewayPort: number;
    /** Every non-receiver account is online (logged in since the launcher started it). */
    helpersReady: boolean;
    accounts: { account: string; role: string; receiver: boolean; state: AccountState; loggedInAt: number | null; logins: number }[];
    ms: number;
}

export function helpersReady(accounts: LauncherStatus['accounts']): boolean {
    const helpers = accounts.filter(a => !a.receiver);
    return helpers.length > 0 && helpers.every(a => a.state === 'online');
}

// ------------------------------------------------------------------ processes

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const iso = () => new Date().toISOString();
const LOGIN_TIMEOUT_MS = 90_000;

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

async function exitedWithin(child: { exited: Promise<unknown> }, ms: number): Promise<boolean> {
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
    private stopping: string | null = null;
    private readonly logins = new LoginLimiter({ perMinute: 6, burst: 3, minSpacingMs: 4000 });
    readonly startedAt = Date.now();
    readonly logDir: string;

    constructor(readonly cfg: LaunchConfig) {
        this.logDir = join(cfg.runDir, 'logs');
        this.accounts = cfg.accounts.map(e => new AccountRun(this, e));
    }

    get gatewayUrl(): string {
        return `ws://127.0.0.1:${this.cfg.gatewayPort}`;
    }

    get isStopping(): boolean {
        return this.stopping !== null;
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
        await this.startGateway();
        const timer = setInterval(() => this.writeStatus(), 2000);
        let code = 0;
        const stop = (why: string, c = 0) => {
            if (this.stopping) return;
            this.stopping = why;
            code = c;
        };
        process.on('SIGINT', () => stop('SIGINT'));
        process.on('SIGTERM', () => stop('SIGTERM'));
        this.onStop = stop;
        try {
            // Sequential, in config order: the next account logs in only after the previous one is in the world.
            for (const a of this.accounts) {
                if (this.stopping) break;
                if (a.entry.after === 'ready') await this.waitForGiversReady(a);
                await a.start();
                this.writeStatus();
                if (cfg.loginSpacingMs > 0) await sleep(cfg.loginSpacingMs);
            }
            this.log(`[launcher] all accounts started; helpersReady=${this.status().helpersReady}`);
            while (!this.stopping) await sleep(500);
        } finally {
            this.log(`[launcher] stopping: ${this.stopping}`);
            for (const a of [...this.accounts].reverse()) await a.stop();
            await this.stopGateway();
            clearInterval(timer);
            this.writeStatus();
        }
        return code;
    }

    onStop: (why: string, code?: number) => void = () => undefined;

    private async waitForGiversReady(a: AccountRun): Promise<void> {
        const earlier = this.accounts.slice(0, this.accounts.indexOf(a)).filter(x => x.entry.role === 'altar-giver').map(x => x.entry.account);
        const dir = String(process.env.RC_CUE_DIR ?? join(this.cfg.runDir, 'rc-cue'));
        this.log(`[launcher] ${a.entry.account} waits for ${earlier.join(', ')} to be ready`);
        while (!this.stopping) {
            const ready = new Set(readStatuses(dir).filter(s => s.phase === 'ready' && Date.now() - s.ms < 5000).map(s => s.account));
            if (earlier.every(n => ready.has(n))) return;
            await sleep(1000);
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
        const deadline = Date.now() + 20_000;
        while (!(await this.probe())) {
            if (child.exitCode !== null || Date.now() > deadline) throw new Error(`gateway did not come up on 127.0.0.1:${this.cfg.gatewayPort}; see ${logPath}`);
            await sleep(250);
        }
        void child.exited.then(c => {
            if (!this.stopping) this.onStop(`gateway exited with code ${c}`, 1);
        });
        this.log(`[launcher] gateway on 127.0.0.1:${this.cfg.gatewayPort}`);
    }

    private async stopGateway(): Promise<void> {
        const g = this.gateway;
        if (!g || g.exitCode !== null) return;
        g.kill('SIGINT');
        if (!(await exitedWithin(g, 5000))) g.kill('SIGKILL');
    }
}

class AccountRun {
    state: AccountState = 'queued';
    loggedInAt: number | null = null;
    logins = 0;
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
            spawn: () => this.spawnRole(),
            isStopping: () => this.L.isStopping,
            log: line => this.L.log(line),
            onFinal: (why, code) => this.L.onStop(why, code)
        });
    }

    private get envPath(): string {
        return join(this.L.cfg.botsDir, this.entry.account, 'bot.env');
    }

    summary(): LauncherStatus['accounts'][number] {
        return { account: this.entry.account, role: this.entry.role, receiver: this.entry.receiver, state: this.state, loggedInAt: this.loggedInAt, logins: this.logins };
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
        const first = await this.session();
        this.supervising = this.supervise(first);
        await Promise.race([sleep(1000), this.roles.start()]);
    }

    /** One login: resolves once the client is in the world, with a promise for the session's end. */
    private async session(): Promise<{ ended: Promise<{ code: number | null; login?: { code: number } }> }> {
        for (;;) {
            if (this.L.isStopping) return { ended: Promise.resolve({ code: null }) };
            await this.L.takeLogin();
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
        const env = roleEnv(process.env, this.botEnv, e, this.L.gatewayUrl, this.L.cfg.runDir, this.loggedInAt ?? Date.now());
        const child = Bun.spawn([process.execPath, `speedrun/helpers/${e.role}.ts`, e.account, ...e.args], { ...OWN_GROUP, cwd: ROOT, env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
        const onLine = (line: string) => {
            this.note('role', line);
            if (line.startsWith('RESULT ')) this.L.log(`[${e.account}] ${line}`);
        };
        const exited = Promise.all([pipeLines(child.stdout, onLine), pipeLines(child.stderr, onLine), child.exited]).then(() => child.exitCode);
        return {
            pid: child.pid,
            get exitCode() {
                return child.exitCode;
            },
            exited,
            kill: signal => child.kill(signal)
        };
    }

    /** Role first (it may be mid-trade), then logout by the button, then the client. */
    async stop(): Promise<void> {
        if (this.state === 'queued') {
            this.state = 'stopped';
            return;
        }
        this.state = 'stopping';
        const role = this.roles.running;
        if (role && role.exitCode === null) {
            role.kill('SIGTERM');
            if (!(await exitedWithin(role, 15_000))) role.kill('SIGKILL');
        }
        await this.roles.done.catch(() => undefined);
        const lite = this.lite;
        if (lite && lite.exitCode === null) {
            const out = await this.logout(lite).catch(e => {
                this.L.log(`[launcher] ${this.entry.account}: logout failed: ${e}`);
                return false;
            });
            if (!out) {
                this.L.log(`[launcher] ${this.entry.account}: no clean logout; closing the client`);
                lite.kill('SIGINT');
                if (!(await exitedWithin(lite, 5000))) lite.kill('SIGKILL');
            }
        }
        await this.supervising?.catch(() => undefined);
        this.state = 'stopped';
        this.L.log(`[launcher] ${this.entry.account}: stopped`);
    }

    /** Click logout through our own SDK connection and wait for the client to leave. Refused in combat: wait it out once. */
    private async logout(lite: Subprocess): Promise<boolean> {
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
        try {
            await Promise.race([sdk.connect(), sleep(10_000).then(() => Promise.reject(new Error('gateway handshake timed out')))]);
            for (let attempt = 0; attempt < 2; attempt++) {
                const clickTick = sdk.getState()?.tick ?? 0;
                await sdk.sendClickComponent(LOGOUT_BUTTON).catch(() => undefined);
                if (await exitedWithin(lite, 8_000)) return true;
                const refused = sdk.getState()?.gameMessages.some(m => /can't log ?out/i.test(m.text) && m.tick >= clickTick);
                if (!refused) return false;
                await sdk.waitForCondition(s => s.tick >= clickTick + COMBAT_LOGOUT_TICKS + 1, 15_000).catch(() => undefined);
            }
            return false;
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
