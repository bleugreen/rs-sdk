// Sessions: open a controlled SDK connection, launch the game client (lite or
// browser), log out cleanly, log back in, and a watchdog that relaunches a
// client that died or went stale.
//
// Why explicit logout matters: the hiscore clock counts ticks in the world. A
// logout click outside combat removes the player on the next tick. A closed
// socket leaves the player in the world for 500 ticks (World.ts
// TIMEOUT_NO_CONNECTION), a silent open one for 1000 (TIMEOUT_NO_RESPONSE), and
// a live lite runner with nothing driving it forever: it sends NO_TIMEOUT every
// second on its own (lite/session.ts). So a launched client is never left
// behind: a failed openSession, a crash, SIGTERM or SIGHUP log it out (or, if
// the click cannot land, kill it), and the watchdog logs a wedged client out
// instead of killing it. Measured in docs/speedrun/research/competitors/
// hiscore-timestamps.md section 5.
//
// The lite runner exits with code 1 when its game session ends and never
// re-logs itself; code 3 means the client revision is outdated and a relaunch
// cannot help. The SDK reconnects to the gateway but never relaunches a client,
// which is the watchdog's job here.

import { appendFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { Subprocess } from 'bun';
import { BotSDK, deriveGatewayUrl } from '../../sdk/index';
import type { BotActions } from '../../sdk/actions';
import type { BotStatus, BotWorldState } from '../../sdk/types';
import { ensureRunOn, RUN_CONFIRM_TICKS, RUN_PRESSES, type EnsureRunResult, type RunSdk } from './run-mode';
import { pageClickComponent, pageInGame, pageLaunchState, pageLogin, pageLoginState, type PageLoginStart } from './tab';
import {
    awaitScene,
    idleBoundMs,
    SCENE_READY_MAX_TICKS,
    type SceneWait,
    sleep,
    STALLED,
    TickPeriod,
    tickMs,
    waitUntil,
} from './wait';
import { COMBAT_LOGOUT_TICKS, inCombatWindow, onTutorialIsland } from './world';
import { DeathWatch, type Death, type HeldLogout } from '../runner/death';

export const ROOT = join(import.meta.dir, '..', '..');
export const LOGOUT_BUTTON = 2458; // logout:try_logout
/** Longest wait between the SDK's reconnect attempts to our gateway. */
export const GATEWAY_RECONNECT_MAX_MS = 2_000;

export type ClientKind = 'lite' | 'browser';

export interface BotEnv {
    BOT_USERNAME: string;
    PASSWORD: string;
    SERVER?: string;
    GATEWAY_URL?: string;
    [k: string]: string | undefined;
}

export function parseBotEnv(text: string): BotEnv {
    const env: Record<string, string> = {};
    for (const line of text.split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const eq = t.indexOf('=');
        if (eq > 0) env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
    }
    if (!env.BOT_USERNAME || !env.PASSWORD) throw new Error('bot.env needs BOT_USERNAME and PASSWORD');
    return env as BotEnv;
}

export function loadBotEnv(name: string, botsDir: string = join(ROOT, 'bots')): BotEnv {
    const path = join(botsDir, name, 'bot.env');
    if (!existsSync(path)) throw new Error(`no bot.env at ${path} (bun bots/create-bot.ts ${name})`);
    return parseBotEnv(readFileSync(path, 'utf-8'));
}

/**
 * How the browser page gets the password. `token`: a one-time token from the
 * page server (server/webclient/proxy.ts, login-token.ts), so the password is
 * never in a URL. `insecureQueryLogin`: the password in the query, as the
 * engine's own bot page takes it; only for a world on loopback (the local lab).
 */
export type BrowserLogin = { token: string } | { insecureQueryLogin: true };

/** The host name of `host`, `host:port`, `[v6]:port` or a bare IPv6 address, lowercased. */
function hostName(host: string): string {
    const h = host.trim().toLowerCase();
    if (h.startsWith('[')) {
        const end = h.indexOf(']');
        return h.slice(1, end > 0 ? end : undefined);
    }
    const parts = h.split(':');
    return parts.length > 2 ? h : parts[0]!;
}

/** localhost, 127.0.0.0/8 or ::1, with or without a port. */
export function isLoopbackHost(host: string): boolean {
    const name = hostName(host);
    return name === 'localhost' || name === '::1' || /^127(\.\d{1,3}){3}$/.test(name);
}

/**
 * Which way a session's SDK reaches its client. `direct`: the in-process bridge (lib/direct.ts,
 * a `direct://` URL). `loopback`: a gateway on this machine. `public`: anything else, which on a
 * remote world is its public relay gateway.
 */
export type GatewayPath = 'direct' | 'loopback' | 'public';

export function gatewayPath(url: string): GatewayPath {
    let u: URL;
    try {
        u = new URL(url);
    } catch {
        return 'public';
    }
    if (u.protocol === 'direct:') return 'direct';
    return (u.protocol === 'ws:' || u.protocol === 'wss:') && isLoopbackHost(u.hostname) ? 'loopback' : 'public';
}

/**
 * The gateway URL a session on `world` uses, the one the SDK and the lite runner it launches both
 * pick (server/webclient/src/lite/runner.ts): bot.env GATEWAY_URL, else the process's, else the
 * one derived from SERVER, which for a remote world is its public relay.
 *
 * A remote world (anything not on loopback: the demo) is refused unless that URL is a loopback
 * gateway or the direct bridge. Through the demo's public relay the state arrives 10-60 ticks
 * late and actions are lost, so every timing taken that way is wrong (rs/287's first demo
 * attempt). A local engine is never refused. `allowRelay` opens on the relay anyway, for a probe
 * that measures it, and says so on `warn`.
 */
export function sessionGateway(env: BotEnv, world: string, opts: { allowRelay?: boolean; warn?: (line: string) => void } = {}): string {
    const set = env.GATEWAY_URL
        ? { value: env.GATEWAY_URL, from: 'bot.env' }
        : process.env.GATEWAY_URL
          ? { value: process.env.GATEWAY_URL, from: 'the environment' }
          : null;
    const url = set?.value ?? deriveGatewayUrl(env.SERVER);
    if (isLoopbackHost(world) || gatewayPath(url) !== 'public') return url;
    const seen = set ? `GATEWAY_URL=${set.value} (from ${set.from})` : `GATEWAY_URL unset (so ${url})`;
    const why =
        `${env.BOT_USERNAME} on ${world} with ${seen}: a demo session must use a loopback gateway (GATEWAY_URL=ws://127.0.0.1:<port>) ` +
        `or the direct path, because the demo's public relay delivers state 10-60 ticks late and loses actions ` +
        `(rs/287: first state at tick 62, a missed 12-tick dialogue window, a refused logout)`;
    if (!opts.allowRelay) throw new Error(`refusing to open ${why}`);
    (opts.warn ?? console.error)(`[speedrun] !!! allowRelay: opening ${why}; every tick figure from this session carries the relay's latency !!!`);
    return url;
}

/**
 * The environment a session's lite runner must read when it is not the runner's own default. The
 * runner (server/webclient/src/lite/runner.ts) is given only the login name: it reads LITE_BOT_ENV,
 * else bots/<login>/bot.env, and its gateway is that file's GATEWAY_URL, else the process's. A session
 * opened with an `env`, or from another bot dir (an alias such as bots/host-oneoff: the scored login on
 * an isolated gateway), would otherwise launch a runner on the default file's gateway while its SDK
 * waits on another: a stale first state, "tick did not advance", and a connectionless body left in the
 * world for 500 ticks (attempt 4's one-offs at 02:47Z and 12:54Z, 24 Oct).
 */
export interface RunnerEnv {
    /** The bot.env the session was loaded from; absent for an env passed in, which each launch writes out. */
    file?: string;
    env: BotEnv;
    /** The gateway the session's SDK uses (sessionGateway). */
    gatewayUrl: string;
}

/**
 * The RunnerEnv of a session opened as `botName`, with `explicit` the env passed to openSession (if
 * any) and `env` what it resolved to. Undefined when the session came from bots/<login>/bot.env itself:
 * its runner resolves its environment exactly as it always has, an inherited LITE_BOT_ENV included.
 */
export function runnerEnvFor(botName: string, explicit: BotEnv | undefined, env: BotEnv, gatewayUrl: string, botsDir: string = join(ROOT, 'bots')): RunnerEnv | undefined {
    if (explicit) return { env: explicit, gatewayUrl };
    if (botName === env.BOT_USERNAME) return undefined;
    return { file: join(botsDir, botName, 'bot.env'), env, gatewayUrl };
}

/**
 * Refuse a session from bots/<login>/bot.env while this process exports LITE_BOT_ENV. Its SDK would
 * read that bot.env, and a lite runner on the account would read the exported file: the runner
 * launchClient spawns inherits the export, as does one a wrapper started on it. That puts the two
 * sides on two gateways, the reverse of RunnerEnv's trap. A session with an explicit env or from an
 * alias dir carries its own RunnerEnv and is never refused; with LITE_BOT_ENV unset nothing changes.
 */
export function refuseInheritedRunnerEnv(
    botName: string,
    runnerEnv: RunnerEnv | undefined,
    inherited: string | undefined = process.env.LITE_BOT_ENV,
    botsDir: string = join(ROOT, 'bots')
): void {
    if (runnerEnv || !inherited) return;
    throw new Error(
        `refusing to open ${botName}: its SDK reads ${join(botsDir, botName, 'bot.env')}, but this process exports LITE_BOT_ENV=${inherited}, ` +
            `which its lite runner reads instead, so the two could be on different gateways; pass that environment to openSession ` +
            `({ env: loadBotEnv(<alias>) }), open the alias dir, or unset LITE_BOT_ENV. Nothing was sent to the account`
    );
}

/** Directories of env files written for launched runners: each goes when its runner exits, all of them when this process does. */
const runnerEnvDirs = new Set<string>();
let runnerEnvExitHook = false;

/** `env` as a bot.env, in the form parseBotEnv (and the lite runner) reads back. */
export function formatBotEnv(env: BotEnv): string {
    let out = '';
    for (const [k, v] of Object.entries(env)) {
        if (v === undefined) continue;
        if (/[\r\n]/.test(k + v)) throw new Error(`${env.BOT_USERNAME}: ${k} holds a line break, which a bot.env cannot carry`);
        out += `${k}=${v}\n`;
    }
    return out;
}

/** Write `env` to a private bot.env (its own 700 directory, the file 600) for one runner to read; `remove` deletes it. */
export function writeRunnerEnvFile(env: BotEnv, dir: string = join(process.env.TMPDIR ?? '/tmp', 'speedrun')): { path: string; remove: () => void } {
    const text = formatBotEnv(env);
    mkdirSync(dir, { recursive: true });
    const own = mkdtempSync(join(dir, 'runner-env-'));
    const path = join(own, 'bot.env');
    runnerEnvDirs.add(own);
    if (!runnerEnvExitHook) {
        runnerEnvExitHook = true;
        process.on('exit', () => {
            for (const d of runnerEnvDirs) rmSync(d, { recursive: true, force: true });
        });
    }
    writeFileSync(path, text, { mode: 0o600 });
    return {
        path,
        remove: () => {
            runnerEnvDirs.delete(own);
            rmSync(own, { recursive: true, force: true });
        },
    };
}

/**
 * The lite runner's process env for one launch of `session`: `base` (the process's) with the login
 * jitter off unless set. A session with a RunnerEnv also sets LITE_BOT_ENV to its environment's file
 * (written out for an env passed in) and GATEWAY_URL to the session's gateway, over anything
 * inherited, so the runner publishes where the SDK listens. `remove` deletes a file written for it.
 */
export function liteRunnerEnv(
    session: Pick<Session, 'runnerEnv'>,
    base: Record<string, string | undefined> = process.env
): { env: Record<string, string | undefined>; remove: () => void } {
    const env = { ...base, LITE_LOGIN_JITTER_MS: base.LITE_LOGIN_JITTER_MS ?? '0' };
    const r = session.runnerEnv;
    if (!r) return { env, remove: () => {} };
    if (r.file) return { env: { ...env, LITE_BOT_ENV: r.file, GATEWAY_URL: r.gatewayUrl }, remove: () => {} };
    const written = writeRunnerEnvFile(r.env);
    return { env: { ...env, LITE_BOT_ENV: written.path, GATEWAY_URL: r.gatewayUrl }, remove: written.remove };
}

/** The world the page logs in to: CLIENT_URL's ?server= when it names one, else SERVER. */
export function pageWorld(env: BotEnv): string {
    if (env.CLIENT_URL) {
        const server = new URL(env.CLIENT_URL).searchParams.get('server');
        if (server) return server;
    }
    return env.SERVER ?? 'localhost';
}

function withQuery(base: string, q: string): string {
    return `${base}${base.includes('?') ? '&' : '?'}${q}`;
}

/**
 * The browser client URL for a bot. CLIENT_URL in the bot.env is the page, the
 * run client served by proxy.ts with ?server= and ?gateway= already on it; a
 * token login needs it, because the token is only good at the server that
 * minted it. The bot name stays in the URL: tab.ts finds the tab by it. `launch` is the launch id
 * the page echoes in every state it publishes (Session.launchTag).
 */
export function browserUrl(env: BotEnv, login: BrowserLogin, launch?: string): string {
    const bot = `bot=${encodeURIComponent(env.BOT_USERNAME)}${launch ? `&launch=${encodeURIComponent(launch)}` : ''}`;
    if ('token' in login) {
        if (!env.CLIENT_URL) throw new Error(`${env.BOT_USERNAME}: a token login needs CLIENT_URL (the proxy.ts page) in bot.env`);
        return withQuery(env.CLIENT_URL, `${bot}&token=${encodeURIComponent(login.token)}`);
    }
    const world = pageWorld(env);
    if (!isLoopbackHost(world)) {
        throw new Error(`${env.BOT_USERNAME}: --insecure-query-login puts the password in the URL; it is for the local lab only, not ${world}`);
    }
    const q = `${bot}&password=${encodeURIComponent(env.PASSWORD)}`;
    if (env.CLIENT_URL) return withQuery(env.CLIENT_URL, q);
    const host = world.includes(':') ? world : `${world}:8888`;
    return `http://${host}/bot?${q}`;
}

/** Ask the page server behind CLIENT_URL for a one-time login token (POST /bot/login-token). */
export async function mintLoginToken(env: BotEnv, fetchFn: (url: string, init: RequestInit) => Promise<Response> = fetch): Promise<string> {
    if (!env.CLIENT_URL) throw new Error(`${env.BOT_USERNAME}: a token login needs CLIENT_URL (the proxy.ts page) in bot.env`);
    const { loginTokenProof } = await import('../../server/webclient/login-token');
    const endpoint = new URL('/bot/login-token', env.CLIENT_URL).toString();
    const res = await fetchFn(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bot: env.BOT_USERNAME, proof: loginTokenProof(env.BOT_USERNAME, env.PASSWORD) }),
    });
    if (!res.ok) throw new Error(`${env.BOT_USERNAME}: no login token from ${endpoint}: HTTP ${res.status} ${await res.text()}`);
    const { token } = (await res.json()) as { token?: unknown };
    if (typeof token !== 'string' || !token) throw new Error(`${env.BOT_USERNAME}: ${endpoint} answered without a token`);
    return token;
}

/**
 * The browser launch: re-navigate (or open) the bot's tab over CDP to a fresh
 * token URL. The token form needs CDP because any other way of opening a URL
 * passes it on a command line. The query form opens the URL however it can,
 * and only for the local lab.
 */
export async function openBrowserClient(env: BotEnv, opts: { cdp?: string; insecureQueryLogin?: boolean; launch?: string }): Promise<string> {
    const { reloadOrOpenTab } = await import('./tab');
    if (opts.insecureQueryLogin) {
        const url = browserUrl(env, { insecureQueryLogin: true }, opts.launch);
        if (opts.cdp) return reloadOrOpenTab(opts.cdp, url, env.BOT_USERNAME);
        await (await import('open')).default(url);
        return 'opened';
    }
    if (!opts.cdp) {
        throw new Error(
            `${env.BOT_USERNAME}: the browser client logs in with a one-time token sent over CDP; set CDP_URL (or SPEEDRUN_CDP_URL), ` +
                'or pass --insecure-query-login for the local lab'
        );
    }
    return reloadOrOpenTab(opts.cdp, browserUrl(env, { token: await mintLoginToken(env) }, opts.launch), env.BOT_USERNAME);
}

/** A fresh launch id for a browser tab (Session.launchTag). */
export function newLaunchTag(): string {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
}

export interface Session {
    readonly name: string;
    readonly client: ClientKind;
    readonly env: BotEnv;
    /** The environment its lite runner reads, when not the runner's default (runnerEnvFor); absent: as the runner resolves it. */
    readonly runnerEnv?: RunnerEnv;
    /** Browser launches put the password in the URL (local lab only; see browserUrl). */
    readonly insecureQueryLogin: boolean;
    readonly sdk: BotSDK;
    readonly bot: BotActions;
    /**
     * Bumps on every game session: each client launch, whose tick counter restarts with it, each
     * in-page login (login's `inPage`), whose page keeps counting from its earlier sessions, and each
     * adopted login (adoptSession). It is also the generation every logout click carries
     * (sendLogoutClick): a click issued under an older id is never sent.
     */
    sessionId: number;
    /**
     * What the client's tick count stood at when this game session began: 0 after a launch, the
     * page's earlier count after an in-page login. `state.tick - tickBase` is the session's own tick,
     * the one a freshly launched client would publish (1 on its first in-world tick).
     */
    tickBase: number;
    /**
     * Bumps on each client launch only: which tick count `state.tick` belongs to (lib/ticks.ts
     * tickCounter). An in-page login keeps it, since the page goes on counting.
     */
    launchId: number;
    /**
     * Browser: the launch id the last launched tab was given in its URL (`?launch=`) and echoes in
     * every state it publishes (BotWorldState.launch), so a state is known to be that tab's own and
     * not a cached or foreign one (waitOwnLaunch). An in-page login keeps it, as the page is not
     * reloaded. Null for the lite client and for a session that attached without launching.
     */
    launchTag: string | null;
    /** Whether the account should be in the world (false around an intended logout). */
    expectInWorld: boolean;
    child: Subprocess | null;
    childExit: number | null;
    /** Last tick seen while inGame, and when it last advanced (wall ms). */
    lastInWorldTick: number;
    lastAdvanceAt: number;
    /** The tick period this client observes, fed by every advancing in-world tick: what silence bounds are sized from (wait.ts idleBoundMs). */
    period: TickPeriod;
    /** Wall ms of the last client launch. */
    launchedAt: number;
    /** Observed in-world ticks since the bot's last markProgress (read by the watchdog's progressStaleTicks); counts on across a relaunch. */
    ticksSinceProgress: number;
    watchdog: Watchdog | null;
    logPath: string;
    /** The last launch's wait for the client's scene (settleScene); absent when none was waited for. */
    scene?: SceneWait;
    /**
     * Run before every login() (relog, the watchdog's login, the outage reconnect; not the first,
     * which openSession makes): run.ts's tick preflight. A throw refuses the login.
     */
    beforeLogin?: () => Promise<void>;
    /**
     * The first death seen on this session: by a logout while it held (logoutClean), or by a leg
     * (runner/legs.ts runLeg). Once set, nothing logs the account back in on its own: the watchdog
     * leaves it out after its logout and relog refuses.
     */
    died?: Death;
}

export interface OpenOptions {
    client?: ClientKind;
    /** Launch the client (default false: attach to one that is already running). */
    launch?: boolean;
    /** Attach to an intentionally logged-out client without waiting for player ticks. Cannot launch. */
    awaitInWorld?: false;
    /** Warm the pathfinder before connecting (needed by bot.walkTo / bot.openBank). Default true. */
    pathfinding?: boolean;
    readyTimeoutMs?: number;
    /**
     * Browser client: log in with the password in the page URL instead of a
     * one-time token. Local lab only (browserUrl refuses any other world).
     * Defaults to whether the process was started with --insecure-query-login.
     */
    insecureQueryLogin?: boolean;
    /**
     * Open on a remote world through its public relay gateway instead of refusing (sessionGateway).
     * Only for a probe that measures the relay itself: it warns, and its timings are not the run's.
     */
    allowRelay?: boolean;
    /** The bot's env, instead of reading bots/<name>/bot.env. A launched lite runner reads this env too (liteRunnerEnv). */
    env?: BotEnv;
    /** Asked before a failed launch's abandon logs a socketless body in to take it over (abandonTab). */
    takeover?: TakeoverGate;
}

/**
 * Connect a control SDK to `botName` (from bots/<name>/bot.env), optionally
 * launching its client, and wait for a live, advancing tick, then turn run on
 * (lib/run-mode.ts; a press only when it reads off, which closes any open
 * modal). Unlike runScript, a disconnect is not fatal: logout and relaunch are
 * normal events here.
 *
 * A launched browser tab is judged by identity, not freshness: only states carrying its own launch
 * id count (waitOwnLaunch), and anything else refuses the launch with a reason before anything is
 * sent to the account. Every failure after a launch abandons the client (abandonClient: a
 * confirmed logout), and the thrown error says how that went.
 */
export async function openSession(botName: string, opts: OpenOptions = {}): Promise<Session> {
    if (opts.awaitInWorld === false && opts.launch) throw new Error('an offline attach cannot launch a client');
    const env = opts.env ?? loadBotEnv(botName);
    const client = opts.client ?? 'lite';
    const gatewayUrl = sessionGateway(env, client === 'browser' ? pageWorld(env) : env.SERVER || 'localhost', { allowRelay: opts.allowRelay });
    const runnerEnv = runnerEnvFor(botName, opts.env, env, gatewayUrl);
    refuseInheritedRunnerEnv(botName, runnerEnv);
    const { BotActions } = await import('../../sdk/actions');
    if (opts.pathfinding !== false) (await import('../../sdk/pathfinding')).initPathfinding();
    const sdk = new BotSDK({
        botUsername: env.BOT_USERNAME,
        password: env.PASSWORD,
        gatewayUrl,
        connectionMode: 'control',
        autoReconnect: true,
        // The gateway is ours (sessionGateway refuses the public relay): a refused reconnect costs
        // nothing, and the SDK's 30 s default cap would leave the run blind for up to 75 ticks after
        // the gateway is back.
        reconnectMaxDelay: GATEWAY_RECONNECT_MAX_MS,
        // connect() returns at the handshake: the waits below are this session's own, and the SDK's
        // accepts any in-game state, a cached one included.
        readyTimeout: 0,
        autoLaunchBrowser: false,
        showChat: env.SHOW_CHAT?.toLowerCase() !== 'false',
    });
    const logDir = join(process.env.TMPDIR ?? '/tmp', 'speedrun');
    mkdirSync(logDir, { recursive: true });
    const session: Session = {
        name: env.BOT_USERNAME,
        client,
        env,
        ...(runnerEnv ? { runnerEnv } : {}),
        insecureQueryLogin: opts.insecureQueryLogin ?? process.argv.includes('--insecure-query-login'),
        sdk,
        bot: new BotActions(sdk),
        sessionId: 0,
        tickBase: 0,
        launchId: 0,
        launchTag: null,
        expectInWorld: opts.awaitInWorld !== false,
        child: null,
        childExit: null,
        lastInWorldTick: -1,
        lastAdvanceAt: Date.now(),
        period: new TickPeriod(),
        launchedAt: 0,
        ticksSinceProgress: 0,
        watchdog: null,
        logPath: join(logDir, `${env.BOT_USERNAME}-${client}.log`),
    };
    sdk.onStateUpdate(s => track(session, s));
    if (opts.launch) await launchClient(session);
    try {
        await sdk.connect();
        if (opts.awaitInWorld === false) return session;
        // On connect the gateway can hand back the bot's last published state, which
        // still reads inGame from the previous session. A launched tab is waited on by
        // its own launch id (waitOwnLaunch), so that state never counts for it. A
        // freshly launched client takes ~20 s on the demo to log in, so a launch gets
        // the whole budget rather than the short attach-time window.
        const ready = opts.readyTimeoutMs ?? 120_000;
        if (session.launchTag) await waitOwnLaunch(session, ready);
        else await waitAdvancingTick(session, ready, opts.launch ? ready : undefined);
        // A client we attach to may have logged in on its own (lab runners, a
        // relaunch by another process); every login leaves run off.
        await ensureRunOn(sdk);
        await setAutoRetaliate(sdk, false);
        // A launched browser tab returns here seconds before its scene is built (rs/41's probe:
        // first locs ~7 s later), so a step acting at once could see an empty scene.
        if (client === 'browser' && opts.launch) await settleScene(session);
    } catch (err) {
        // The client we launched may be in the world even though this process never
        // saw it advance; left running it would hold the player there indefinitely.
        let out = err;
        if (opts.launch) {
            const a = await abandonClient(session, undefined, { ...(opts.takeover ? { takeover: opts.takeover } : {}) }).catch((e: unknown) => abandonFailed(e));
            if (a) {
                const line = describeAbandon(a);
                appendFileSync(session.logPath, `[speedrun] session ${session.sessionId}: start failed, ${line}\n`);
                out = new Error(`${err instanceof Error ? err.message : String(err)}; ${line}`, { cause: err });
            }
        }
        await sdk.disconnect().catch(() => {});
        throw out;
    }
    return session;
}

/**
 * Wall ms a launched page must read as ended (PageLaunchState: auto-login made, neither in game nor
 * logging in) before its launch is refused. The page's own retry after a lost game socket reads that
 * way for the moment the retry takes; a login that ended reads that way for good.
 */
export const PAGE_ENDED_HOLD_MS = 1_000;

/**
 * Wait for the launched tab's own session: two in-game states carrying `session.launchTag` with
 * different ticks. Identity, not freshness: a state without this launch's id is never taken for
 * it, however new, so the gateway's cached state from an earlier client (attempt 3's 04:2xZ start:
 * a lite one-off's state, 210 s old) cannot stand in for the tab.
 *
 * Refused, with the reason, before anything is sent to the account:
 * - in-game states from another launch, or with no launch id, advancing: another client drives the
 *   account, or the page's bundle predates the launch echo;
 * - the page (asked over CDP, and only once it shows this launch's URL) made its auto-login and is
 *   neither in game nor logging in for PAGE_ENDED_HOLD_MS: its login ended, or it dropped out;
 * - the page in game but publishing nothing of this launch's for GATEWAY_BACK_GRACE_TICKS: its
 *   states do not reach our gateway;
 * - nothing of this launch's within `timeoutMs`.
 */
export async function waitOwnLaunch(session: Session, timeoutMs: number): Promise<BotWorldState> {
    const tag = session.launchTag;
    if (!tag) throw new Error(`${session.name}: waitOwnLaunch needs a launched browser tab`);
    const cdp = cdpUrl(session.env);
    const refuse = (why: string) => new Error(`${session.name}: refusing launch ${tag}: ${why}; nothing was sent to the account`);
    const seen = {
        ownFirst: null as number | null,
        lastOwnAt: 0,
        ready: null as BotWorldState | null,
        other: null as BotWorldState | null,
        firstTick: new Map<string, number>(),
        live: null as { launch: string; ticks: [number, number] } | null,
    };
    const see = (s: BotWorldState) => {
        if (!s.inGame) return;
        if (s.launch === tag) {
            seen.lastOwnAt = Date.now();
            if (seen.ownFirst === null) seen.ownFirst = s.tick;
            else if (s.tick !== seen.ownFirst) seen.ready ??= s;
            return;
        }
        seen.other ??= s;
        const who = s.launch ?? 'none';
        const first = seen.firstTick.get(who);
        if (first === undefined) seen.firstTick.set(who, s.tick);
        else if (first !== s.tick) seen.live ??= { launch: who, ticks: [first, s.tick] };
    };
    const current = session.sdk.getState();
    if (current) see(current);
    const unsubscribe = session.sdk.onStateUpdate(see);
    try {
        const deadline = Date.now() + timeoutMs;
        let nextPage = 0;
        let endedSince: number | null = null;
        let inGameSince: number | null = null;
        for (;;) {
            if (seen.ready) return seen.ready;
            if (seen.live) {
                const { launch, ticks } = seen.live;
                throw refuse(
                    launch === 'none'
                        ? `in-game states with no launch id are advancing (ticks ${ticks[0]} then ${ticks[1]}): another client is in the world as this account, or the page's bundle predates the launch echo (rebuild it: cd server/webclient && bun run build)`
                        : `in-game states from launch ${launch} are advancing (ticks ${ticks[0]} then ${ticks[1]}): another tab or process drives this account`
                );
            }
            const now = Date.now();
            if (now >= deadline) {
                const o = seen.other;
                throw refuse(
                    `no in-game state from this launch within ${timeoutMs} ms` +
                        (o ? `; the only in-game state was not this launch's (tick ${o.tick}, launch ${o.launch ?? 'none'}): a cached or foreign state` : '')
                );
            }
            if (cdp && now >= nextPage) {
                nextPage = now + ENDED_POLL_MS;
                const p = await pageLaunchState(cdp, session.name).catch(() => null);
                // Until the tab shows this launch's URL it may still be the page it replaced.
                if (p && p.launch === tag && p.hasClient) {
                    const ended = p.loadingComplete && p.autoLoginAttempted && !p.inGame && !p.loginInProgress;
                    endedSince = ended ? (endedSince ?? now) : null;
                    if (endedSince !== null && now - endedSince >= PAGE_ENDED_HOLD_MS) {
                        throw refuse(`the page's login ended without getting in, or it dropped out of the game (title screen: ${p.message || 'no message'})`);
                    }
                    inGameSince = p.inGame ? (inGameSince ?? now) : null;
                    const silentMs = idleBoundMs({ ticks: GATEWAY_BACK_GRACE_TICKS, period: session.period });
                    if (inGameSince !== null && now - Math.max(inGameSince, seen.lastOwnAt) >= silentMs) {
                        throw refuse(`the page is in game but none of its states reached our gateway for ${silentMs} ms`);
                    }
                }
            }
            await sleep(50);
        }
    } finally {
        unsubscribe();
    }
}

/**
 * Wait for the session's scene (lib/wait.ts awaitScene, the wait the resume walk uses too), record it
 * as `session.scene`, and warn on a timeout. Never throws: past the bound the caller goes on.
 */
export async function settleScene(session: Pick<Session, 'sdk' | 'name'> & { scene?: SceneWait }, maxTicks = SCENE_READY_MAX_TICKS): Promise<SceneWait> {
    const r = await awaitScene(session.sdk, maxTicks);
    session.scene = r;
    if (!r.ready) console.warn(`[session] ${session.name}: the scene was not ready after ${r.ticks} ticks; going on`);
    return r;
}

/** Tell the watchdog the bot is still making progress (see progressStaleTicks). */
export function markProgress(session: Pick<Session, 'ticksSinceProgress'>): void {
    session.ticksSinceProgress = 0;
}

/** Every published state: the advancing in-world tick, the observed period, and the ticks since the bot's last progress. */
export function track(session: Pick<Session, 'sdk' | 'lastInWorldTick' | 'lastAdvanceAt' | 'period' | 'ticksSinceProgress'>, s: BotWorldState): void {
    if (!s.inGame) return;
    const prev = session.lastInWorldTick;
    if (s.tick === prev) return;
    // A label that went back is a relaunch's restarted count: one new tick, not a negative step.
    session.ticksSinceProgress += prev >= 0 && s.tick > prev ? s.tick - prev : 1;
    session.lastInWorldTick = s.tick;
    session.lastAdvanceAt = Date.now();
    session.period.see(s.tick, session.sdk.getStateReceivedAt?.() || session.lastAdvanceAt);
}

/** Wait until the client publishes in-game state with a tick that advances. */
export async function waitAdvancingTick(session: Session, timeoutMs: number, advanceMs: number = Math.max(5_000, idleBoundMs({ ticks: 20, period: session.period }))): Promise<BotWorldState> {
    const first = await waitFor(session.sdk, s => s.inGame, timeoutMs);
    if (!first) throw new Error(`${session.name}: no in-game state within ${timeoutMs} ms`);
    const t = first.tick;
    const next = await waitFor(session.sdk, s => s.inGame && s.tick !== t, advanceMs);
    if (!next) throw new Error(`${session.name}: tick did not advance (no live client?)`);
    return next;
}

function waitFor(sdk: BotSDK, pred: (s: BotWorldState) => boolean, ms: number): Promise<BotWorldState | null> {
    return sdk.waitForCondition(pred, ms).catch(() => null);
}

/** Start the game client: a lite runner child, or the browser tab. Bumps sessionId and launchId. */
export async function launchClient(session: Session): Promise<void> {
    session.sessionId++;
    session.launchId++;
    session.tickBase = 0;
    session.childExit = null;
    session.launchedAt = Date.now();
    if (session.client === 'lite') {
        appendFileSync(session.logPath, `[speedrun] launch session ${session.sessionId} at ${new Date().toISOString()}\n`);
        // Its own process group: a terminal Ctrl-C goes to this process (the step
        // runner's stop signal, which logs out cleanly) and not to the runner,
        // whose SIGINT handler would just close the socket and leave the player
        // in the world for 500 ticks.
        // `detached` (setpgid) works in Bun 1.3 but is missing from bun-types.
        // The runner sleeps a random 0-5 s before logging in to a secured world
        // (lite/session.ts) to spread fleet starts. One account gains nothing
        // from it, and on a takeover the dropped player is in the world meanwhile;
        // liteRunnerEnv turns it off, and points the runner at the session's own environment.
        const runner = liteRunnerEnv(session);
        const spawnOpts = {
            cwd: join(ROOT, 'server', 'webclient'),
            stdout: openSync(session.logPath, 'a'),
            stderr: 'inherit',
            env: runner.env,
            detached: true,
        } as { cwd: string; stdout: number; stderr: 'inherit'; env: Record<string, string | undefined> };
        let child: Subprocess;
        try {
            child = Bun.spawn(['bun', 'src/lite/runner.ts', session.name], spawnOpts);
        } catch (e) {
            runner.remove();
            throw e;
        }
        session.child = child;
        guardLaunched(session);
        // A signal-killed child can report a null code; count it as 128+SIGKILL.
        void child.exited.then(code => {
            runner.remove();
            if (session.child === child) session.childExit = code ?? 137;
        });
        return;
    }
    // With CDP the one tab is re-navigated (lib/tab.ts) to a fresh token URL.
    session.launchTag = newLaunchTag();
    const how = await openBrowserClient(session.env, { cdp: cdpUrl(session.env), insecureQueryLogin: session.insecureQueryLogin, launch: session.launchTag });
    appendFileSync(session.logPath, `[speedrun] session ${session.sessionId}: tab ${how} (launch ${session.launchTag}) at ${new Date().toISOString()}\n`);
}

/** Stop a lite child that is still running (recovery only; never a way to log out). */
async function killChild(session: Session): Promise<void> {
    const child = session.child;
    if (!child || session.childExit !== null) return;
    child.kill('SIGKILL');
    await child.exited.catch(() => {});
}

/** How abandonClient left the account. */
export interface AbandonResult {
    /**
     * Confirmed out of the world. Browser: the page out of game and the world's player list without
     * the account. Lite: the runner exited on the server's LOGOUT.
     */
    ok: boolean;
    /** Logout clicks sent. */
    sends: number;
    /** In-page logins made to take a socketless body over so that it could be logged out (browser). */
    takeovers: number;
    wallMs: number;
    reason?: string;
}

/** One line for a log or an error: how abandonClient left the account. */
export function describeAbandon(a: AbandonResult): string {
    const how = `${a.sends} logout click(s)${a.takeovers ? `, ${a.takeovers} takeover login(s)` : ''}, ${a.wallMs} ms`;
    return a.ok ? `logged out, confirmed (${how})` : `NOT confirmed logged out: ${a.reason ?? 'unknown'} (${how})`;
}

/**
 * Asked before abandonTab logs a socketless body in to take it over, a login the per-address order
 * and the playtime both see: a function to call once that login has started or failed (a lock's
 * release) to go ahead, or the reason not to. Without one the takeover goes ahead.
 */
export type TakeoverGate = () => Promise<(() => void) | string>;

export interface AbandonOptions {
    takeover?: TakeoverGate;
    /** abandonTab's wall bound (default ABANDON_TIMEOUT_MS). */
    timeoutMs?: number;
}

/** An AbandonResult for an abandon that threw. */
export function abandonFailed(e: unknown): AbandonResult {
    return { ok: false, sends: 0, takeovers: 0, wallMs: 0, reason: `the abandon threw: ${e instanceof Error ? e.message : String(e)}` };
}

/**
 * Get a launched client's player out of the world when this process is giving it up.
 *
 * Lite: the logout click removes an in-world player on the next tick and the runner exits on the
 * server's LOGOUT; if it has not exited within `waitMs` (the click could not land), SIGKILL, which
 * bounds the stay to the 500-tick no-connection timeout instead of the indefinite stay of a live
 * runner. Null when there is no running child.
 *
 * Browser: abandonTab, a logout through the page itself, confirmed by the page and the world.
 */
export async function abandonClient(session: Session, waitMs: number = Math.max(2_000, 10 * tickMs()), opts: AbandonOptions = {}): Promise<AbandonResult | null> {
    if (session.client === 'browser') return abandonTab(session, opts);
    const child = session.child;
    if (!child || session.childExit !== null) return null;
    const t0 = Date.now();
    session.expectInWorld = false;
    const sent = sendLogoutClick(session);
    const exited = await Promise.race([child.exited.then(() => true), sleep(waitMs).then(() => false)]);
    if (!exited) await killChild(session);
    return {
        ok: exited,
        sends: sent ? 1 : 0,
        takeovers: 0,
        wallMs: Date.now() - t0,
        ...(exited ? {} : { reason: `the runner did not exit within ${waitMs} ms of the click; killed (the account stays up to 500 ticks)` }),
    };
}

/**
 * Log a browser tab's account out through the page itself and confirm it, for a process giving the
 * tab up (a failed start). Over CDP, so neither our gateway nor the page's gateway socket has to be
 * up: the logout button is clicked inside the page (tab.ts pageClickComponent), straight down its
 * game socket, and re-sent each LOGOUT_CONFIRM_TICKS it goes unconfirmed, up to ABANDON_SENDS. It is
 * confirmed when the page is out of game and the world's player list (/playerpositions) no longer
 * has the account; the page alone cannot say, since a page whose game socket dropped is out of game
 * while its body stays in the world for 500 ticks.
 *
 * That socketless body (attempt 3's 04:2xZ start) cannot be clicked out: nothing is connected to it.
 * Once the page has been out, with the world still listing the account, for longer than a removal
 * takes to show, the page logs in again in place (a fresh token, login's in-page path), which the
 * engine lets take the body over (World.ts "kick the existing session"); then the click logs it out.
 * At most ABANDON_TAKEOVERS such logins, each one asked of `opts.takeover` first.
 *
 * A session that launched its tab acts only on that launch's page: a tab showing another launch is
 * left alone. Each click carries the session generation it was issued under, as sendLogoutClick's
 * do: once a newer session begins elsewhere (an adopt) nothing more is sent. Without DevTools only
 * the gateway is left: one click through it, reported unconfirmed.
 */
export async function abandonTab(session: Session, opts: AbandonOptions = {}): Promise<AbandonResult> {
    const t0 = Date.now();
    session.expectInWorld = false;
    session.watchdog?.pause();
    let sends = 0;
    let takeovers = 0;
    const done = (ok: boolean, reason?: string): AbandonResult => ({ ok, sends, takeovers, wallMs: Date.now() - t0, ...(reason ? { reason } : {}) });
    const cdp = cdpUrl(session.env);
    if (!cdp) {
        if (sendLogoutClick(session)) sends++;
        return done(false, 'no DevTools port (CDP_URL), so no page to ask: one logout click sent through the gateway, unconfirmed');
    }
    const { demoOrigin, listedInWorld } = await import('./demo-status');
    const origin = demoOrigin(pageWorld(session.env));
    const account = session.env.BOT_USERNAME ?? session.name;
    const resendMs = () => idleBoundMs({ ticks: LOGOUT_CONFIRM_TICKS, period: session.period });
    // The world list is cached 1 s server side and read every WORLD_LIST_EVERY_MS: a removal under
    // way shows within three reads.
    const takeoverAfterMs = () => Math.max(3 * WORLD_LIST_EVERY_MS, resendMs());
    const deadline = t0 + (opts.timeoutMs ?? ABANDON_TIMEOUT_MS);
    let gen = session.sessionId;
    let sentAt = -Infinity;
    let outListedSince: number | null = null;
    let world: boolean | null = null;
    let nextWorld = 0;
    let why = '';
    for (;;) {
        if (session.sessionId !== gen) return done(false, `superseded: session ${session.sessionId} began while the abandon of session ${gen} ran; nothing more sent`);
        const now = Date.now();
        if (now >= nextWorld) {
            nextWorld = now + WORLD_LIST_EVERY_MS;
            world = await listedInWorld(origin, account);
        }
        const page = await pageLaunchState(cdp, session.name).catch((e: unknown) => {
            why = `DevTools did not answer (${e instanceof Error ? e.message : String(e)})`;
            return undefined;
        });
        if (page && session.launchTag && page.launch !== session.launchTag) {
            return done(false, `the bot's tab is not this session's launch ${session.launchTag} (it shows ${page.launch ?? 'none'}); left alone`);
        }
        if (page?.inGame) {
            outListedSince = null;
            if (now - sentAt >= resendMs()) {
                if (sends >= ABANDON_SENDS) return done(false, `still in game after ${sends} logout clicks`);
                if (session.sessionId === gen) {
                    const click = await pageClickComponent(cdp, session.name, LOGOUT_BUTTON).catch(() => null);
                    if (click?.sent) {
                        sends++;
                        sentAt = Date.now();
                    } else why = `the page would not click logout (${click?.reason ?? 'no answer'})`;
                }
            }
        } else if (page === null || (page && !page.loginInProgress)) {
            // No tab, or a page out of game with no login under way: the world says where the body is.
            if (world === false) return done(true);
            if (world === null) why = `the world's player list (${origin}/playerpositions) did not answer`;
            else if (page === null) why = 'the world lists the account and there is no tab for it';
            else {
                outListedSince ??= now;
                why = 'the page is out of game and the world still lists the account';
                if (now - outListedSince >= takeoverAfterMs()) {
                    if (takeovers >= ABANDON_TAKEOVERS) why = `${why}, after ${takeovers} takeover login(s)`;
                    else if (page.hasClient && page.loadingComplete) {
                        const gate = opts.takeover ? await opts.takeover().catch((e: unknown) => `the takeover gate threw: ${e instanceof Error ? e.message : String(e)}`) : () => {};
                        if (typeof gate === 'string') return done(false, `${why}; no takeover login: ${gate}`);
                        takeovers++;
                        appendFileSync(session.logPath, `[speedrun] session ${session.sessionId}: abandon: the page is out and the world lists the account; logging in in page to take that body over, then out\n`);
                        try {
                            const start = await loginInPage(session, cdp, {});
                            if (start.started) gen = session.sessionId;
                            else why = `the takeover login did not start (${start.reason})`;
                        } finally {
                            gate();
                        }
                        outListedSince = null;
                    }
                }
            }
        }
        // A page logging in (its own retry, or our takeover) is waited for.
        if (Date.now() >= deadline) return done(false, why || 'timed out');
        await sleep(Math.min(ENDED_POLL_MS, tickMs()));
    }
}

const launchedSessions = new Set<Session>();
let exitGuardsInstalled = false;

/**
 * Never let a launched runner outlive this process. A crash, SIGTERM or SIGHUP
 * logs every launched client out (abandonClient) before exiting; any other exit
 * (process.exit with a client still running) can only kill it synchronously.
 * SIGINT is left to the caller: the step runner uses it to stop at a safe
 * boundary and log out itself. SIGKILL cannot be caught; run the scored account
 * where nothing SIGKILLs the controller.
 */
function guardLaunched(session: Session): void {
    launchedSessions.add(session);
    if (exitGuardsInstalled) return;
    exitGuardsInstalled = true;
    const live = () => [...launchedSessions].filter(s => s.child && s.childExit === null);
    process.on('exit', () => {
        for (const s of live()) {
            try {
                s.child!.kill('SIGKILL');
            } catch {}
        }
    });
    let ending = false;
    const fatal = (code: number) => async (err?: unknown) => {
        if (err instanceof Error) console.error(err);
        if (ending) return;
        ending = true;
        await Promise.all(live().map(s => abandonClient(s).catch(() => {})));
        process.exit(code);
    };
    process.on('uncaughtException', fatal(1));
    process.on('unhandledRejection', fatal(1));
    process.on('SIGTERM', fatal(143));
    process.on('SIGHUP', fatal(129));
}

/** Chrome's DevTools origin for a browser session: the env's CDP_URL, else SPEEDRUN_CDP_URL. */
export function cdpUrl(env: BotEnv): string | undefined {
    return env.CDP_URL ?? process.env.SPEEDRUN_CDP_URL;
}

/**
 * What showed the account had left the world: the published state (`inGame: false`), the lite
 * child's exit, the browser page's own in-game flag read over CDP, or the gateway (lite only).
 */
export type LogoutSignal = 'state' | 'child' | 'page' | 'gateway' | 'world';

/** LogoutResult.reason when the server refused both clicks for combat (its "can't log out" message, CANT_LOGOUT). */
export const LOGOUT_REFUSED_COMBAT = 'logout refused (combat)';

export interface LogoutResult {
    ok: boolean;
    clickTick: number;
    lastInWorldTick: number;
    /** Ticks from the logout click to the last tick in the world (0 = same tick). */
    latencyTicks: number;
    wallMs: number;
    /** Set when ok. */
    confirmedBy?: LogoutSignal;
    reason?: string;
    /** Logout clicks sent: 1 unless a click went unconfirmed for LOGOUT_CONFIRM_TICKS and was sent again. */
    sends?: number;
    /** Observed ticks from the first click to the read that confirmed the account out (set when ok). */
    confirmTicks?: number;
    /**
     * A newer game session began while this logout waited (an adopt, a launch or an in-page login):
     * the logout belongs to the old one, so it stopped and nothing more was sent. Not a failed logout.
     */
    superseded?: boolean;
    /** Set when the logout waited before its click (the post-combat window, a refused click's retry): what the wait held. */
    held?: HeldLogout;
    /** Set when the account died while the logout held (runner/death.ts DeathWatch). `ok` still says only whether it got out. */
    death?: Death;
}

/** Whether the SDK's socket to the gateway is up (not reconnecting or closed). */
export function sdkConnected(session: Pick<Session, 'sdk'>): boolean {
    return session.sdk.getConnectionState() === 'connected';
}

/**
 * Send one logout click for game session `gen` (the sessionId it was issued under), or nothing;
 * true when it was sent. Dropped once a newer session has begun: an adopt, a launch or an in-page
 * login means the click would log out a session it was never meant for. And never handed to an SDK
 * that is not connected: BotSDK queues an action sent while it reconnects and dispatches it the
 * moment the gateway is back (sdk/index.ts dispatchAction), by which time the session it was meant
 * for may be gone (rs/659: a watchdog logout queued through a gateway outage logged out the session
 * run.ts had just adopted). A logout that cannot be sent now is not sent; the caller tries again.
 */
export function sendLogoutClick(session: Session, gen: number = session.sessionId): boolean {
    const live = () => session.sessionId === gen && sdkConnected(session);
    if (!live()) return false;
    void Promise.resolve()
        .then(() => (live() ? session.sdk.sendClickComponent(LOGOUT_BUTTON) : undefined))
        .catch(() => {});
    return true;
}

const CANT_LOGOUT = /can't log out/i;

/**
 * Observed ticks one logout click gets to show the account out before it is sent again. A click
 * removes an idle player in its own tick: 0 ticks in 42 of 42 lab relogs (research/wine-window.md),
 * 0 ticks in 215-431 ms on the twin (rs/164, rs/172), 2 ticks on the demo with a 1-in-29 tail
 * (wine.md). Twice the demo's figure. A click not confirmed by then is sent again rather than waited
 * on: on rs/310's Agility rehearsal an unconfirmed tab logout left the account in the world for 117
 * ticks, all of them playtime. The queued level-up case (LOGOUT_WAIT_TICKS) stays covered: a
 * re-send while the queue runs out is harmless, and the overall bound is unchanged.
 */
export const LOGOUT_CONFIRM_TICKS = 4;

/**
 * Default wait for a logout to complete. A logout normally leaves the world in
 * the click's tick, but the engine removes a player only once its engine queue
 * is empty (World.ts processLogouts), running one queued script per tick until
 * then, so a chain of queued level-ups (one per level a single xp drop crossed;
 * 40 or more after a wine firing) keeps the account in the world that many
 * ticks longer.
 */
const LOGOUT_WAIT_TICKS = 60;

/** Most logout clicks abandonTab sends: one per LOGOUT_CONFIRM_TICKS over LOGOUT_WAIT_TICKS. */
export const ABANDON_SENDS = Math.ceil(LOGOUT_WAIT_TICKS / LOGOUT_CONFIRM_TICKS);
/** Most takeover logins abandonTab makes. */
export const ABANDON_TAKEOVERS = 2;
/**
 * abandonTab's wall bound. Wall time, not ticks: the page it works on may be out of the world and
 * publishing nothing. Room for the full re-send window at the demo's 600 ms and two takeover logins.
 */
export const ABANDON_TIMEOUT_MS = 90_000;

/**
 * Log out with the logout button, verified. Waits out the post-combat window
 * first; if the server still refuses, waits the remaining ticks and retries
 * once. Verification: no in-game tick after the click, and the lite child
 * exited (session end) or the gateway reports the bot dead / the browser
 * publishes inGame:false (loggedOutBy). A click not confirmed within
 * LOGOUT_CONFIRM_TICKS observed ticks is sent again, up to LOGOUT_WAIT_TICKS
 * after the first; `timeoutMs` stays the wall-clock backstop for a client that
 * publishes nothing.
 *
 * The logout belongs to the game session it began in: once a newer one begins (an adopt, a launch,
 * an in-page login) it stops, sends nothing more, and reports `superseded`.
 *
 * Every state from the call to the account's leaving is watched (runner/death.ts DeathWatch): a
 * death while the logout held rides on the result (`death`) and on `session.died`; a wait before the
 * click on it as `held`. A logout with neither returns what it always did.
 */
export async function logoutClean(session: Session, opts: { timeoutMs?: number } = {}): Promise<LogoutResult> {
    session.watchdog?.pause();
    const t0 = Date.now();
    const s = session.sdk.getState();
    if (!s?.inGame) return { ok: false, clickTick: -1, lastInWorldTick: session.lastInWorldTick, latencyTicks: 0, wallMs: 0, reason: 'not in game' };
    const watch = new DeathWatch(s, 'before the logout landed');
    const unwatch = session.sdk.onStateUpdate(st => watch.see(st));
    try {
        const r = await clickOut(session, s, t0, opts, watch);
        const death = watch.death();
        if (death) session.died ??= death;
        return { ...r, ...(watch.holding ? { held: watch.held(r.clickTick) } : {}), ...(death ? { death } : {}) };
    } finally {
        unwatch();
    }
}

async function clickOut(session: Session, s: BotWorldState, t0: number, opts: { timeoutMs?: number }, watch: DeathWatch): Promise<LogoutResult> {
    const { sdk } = session;
    const gen = session.sessionId;
    const superseded = (clickTick: number, sends: number): LogoutResult => ({
        ok: false,
        clickTick,
        lastInWorldTick: session.lastInWorldTick,
        latencyTicks: 0,
        wallMs: Date.now() - t0,
        sends,
        superseded: true,
        reason: `superseded: session ${session.sessionId} began while the logout of session ${gen} waited`,
    });

    // lastDamageTick is -1 when the player was never hit (sdk/types.ts): no combat window to wait out.
    const lastHit = s.player?.combat?.lastDamageTick ?? -1;
    const combatTick = lastHit < 0 ? -Infinity : lastHit;
    if (inCombatWindow(s)) {
        watch.holding = true;
        const until = Math.max(s.tick, combatTick) + COMBAT_LOGOUT_TICKS + 1;
        await waitUntil(sdk, st => st.tick >= until && !st.player?.combat?.inCombat, { maxTicks: COMBAT_LOGOUT_TICKS + 30 });
    }

    if (session.sessionId !== gen) return superseded(-1, 0);
    session.expectInWorld = false;
    let sends = 0;
    for (let attempt = 0; attempt < 2; attempt++) {
        const clickTick = sdk.getState()?.tick ?? -1;
        const w = await waitLoggedOutSignal(session, opts.timeoutMs ?? Math.max(5_000, LOGOUT_WAIT_TICKS * tickMs()), clickTick, gen);
        sends += w.sends;
        const out = w.out;
        if (out === 'superseded') return superseded(clickTick, sends);
        if (out === 'refused' && attempt === 0) {
            watch.holding = true;
            await waitUntil(sdk, () => false, { maxTicks: COMBAT_LOGOUT_TICKS + 1 });
            continue;
        }
        const lastInWorldTick = session.lastInWorldTick;
        const ok = out !== 'refused' && out !== 'timeout';
        return {
            ok,
            clickTick,
            lastInWorldTick,
            latencyTicks: Math.max(0, lastInWorldTick - clickTick),
            wallMs: Date.now() - t0,
            sends,
            ...(ok
                ? { confirmedBy: out, confirmTicks: w.ticks }
                : { reason: out === 'refused' ? LOGOUT_REFUSED_COMBAT : sends === 0 ? 'never sent: the gateway was unreachable' : 'still in game after timeout' }),
        };
    }
    throw new Error('unreachable');
}

/** Wall ms between /playerpositions reads while a lite logout waits (the server caches the list 1 s). */
const WORLD_LIST_EVERY_MS = 1_000;

/**
 * Send the logout click and wait for loggedOutBy, sending it again each LOGOUT_CONFIRM_TICKS
 * observed ticks it goes unconfirmed, until LOGOUT_WAIT_TICKS ticks after the first or `timeoutMs`
 * of wall time (the backstop for a client that publishes nothing). A click that cannot be sent (the
 * SDK reconnecting) is tried again on the next poll; once session `gen` is superseded, nothing more
 * is sent and the wait ends.
 */
async function waitLoggedOutSignal(
    session: Session,
    timeoutMs: number,
    clickTick: number,
    gen: number
): Promise<{ out: LogoutSignal | 'refused' | 'timeout' | 'superseded'; sends: number; ticks: number }> {
    const deadline = Date.now() + timeoutMs;
    let sends = 0;
    let sentAt = -Infinity;
    let nextWorld = Date.now() + WORLD_LIST_EVERY_MS;
    let ticks = 0;
    for (;;) {
        if (session.sessionId !== gen) return { out: 'superseded', sends, ticks };
        const s = session.sdk.getState();
        ticks = Math.max(ticks, (s?.tick ?? clickTick) - clickTick);
        if (ticks - sentAt >= LOGOUT_CONFIRM_TICKS && ticks < LOGOUT_WAIT_TICKS && sendLogoutClick(session, gen)) {
            sentAt = ticks;
            sends++;
        }
        if (s?.gameMessages.some(m => CANT_LOGOUT.test(m.text) && m.tick >= clickTick)) return { out: 'refused', sends, ticks };
        const world = Date.now() >= nextWorld;
        if (world) nextWorld = Date.now() + WORLD_LIST_EVERY_MS;
        const by = await loggedOutBy(session, { world });
        if (by) return { out: by, sends, ticks };
        if (ticks >= LOGOUT_WAIT_TICKS || Date.now() >= deadline) return { out: 'timeout', sends, ticks };
        await sleep(Math.min(100, tickMs() / 3));
    }
}

/**
 * What shows the account has left the world, or null while nothing does.
 *
 * A browser tab is never judged by the gateway: once the page logs out it stops publishing, so the
 * gateway keeps its last state (`inGame: true`, status `stale`) and the SDK state stays in game. The
 * page is asked itself over CDP (`window.gameClient.ingame`). A missing tab does not count as out: a
 * closed tab is a dropped client, which the server keeps in the world. Without CDP only a published
 * `inGame: false` confirms a browser logout.
 *
 * A lite client with nothing else to show (its child still running, the gateway still holding the
 * last in-game state) is out once the world's own player list (/playerpositions, which lists a
 * player until the server has removed it) no longer has it; asked only with `world`, since it is an
 * HTTP read (rs/461: a lite logout reported unconfirmed with the account already gone).
 */
export async function loggedOutBy(session: Session, o: { world?: boolean } = {}): Promise<LogoutSignal | null> {
    const worldGone = async () => {
        if (!o.world) return false;
        const { demoOrigin, listedInWorld } = await import('./demo-status');
        return (await listedInWorld(demoOrigin(session.env.SERVER), session.env.BOT_USERNAME ?? session.name)) === false;
    };
    if (session.client === 'lite' && session.child) return session.childExit !== null ? 'child' : (await worldGone()) ? 'world' : null;
    const s = session.sdk.getState();
    if (s && !s.inGame) return 'state';
    if (session.client === 'browser') {
        const cdp = cdpUrl(session.env);
        if (!cdp) return null;
        const inGame = await pageInGame(cdp, session.name).catch(() => null);
        return inGame === false ? 'page' : null;
    }
    const status = await gatewayStatus(session);
    if (status?.status === 'dead' || status?.inGame === false) return 'gateway';
    return (await worldGone()) ? 'world' : null;
}

/** True once the account has left the world (see loggedOutBy). */
export async function isLoggedOut(session: Session): Promise<boolean> {
    return (await loggedOutBy(session)) !== null;
}

export async function gatewayStatus(session: Session): Promise<BotStatus | null> {
    try {
        return await session.sdk.checkBotStatus();
    } catch {
        return null;
    }
}

/** Assert the account is logged out, then wait `ms` of wall time, which costs no ticks. */
export async function waitLoggedOut(session: Session, ms: number): Promise<void> {
    if (!(await isLoggedOut(session))) throw new Error(`${session.name} is still in the world; log out before waiting`);
    await sleep(ms);
}

/** The title screen's text for the login replies callers tell apart (Client.ts's loginMes1 and loginMes2). */
const REPLY_TEXT: readonly (readonly [number, RegExp])[] = [
    [5, /Your account is already logged in\./],
    [7, /This world is full\./],
    [8, /Login server offline\./],
    [9, /Login limit exceeded\./],
    [13, /Could not complete login\./],
    [14, /The server is being updated\./],
    [16, /Login attempts exceeded\./],
];

/** The login reply a title screen's message shows, or null for none told apart here. */
export function loginReplyCode(message: string): number | null {
    return REPLY_TEXT.find(([, re]) => re.test(message))?.[0] ?? null;
}

/**
 * Reply 5, "Your account is already logged in. Try again in 60 secs". The world sends it while the
 * account's old player is still there: briefly while a logout's save flushes (World.ts "old session
 * is mid-logout", which login's own retries ride out), and for a dropped player whose socket went
 * silent without closing until TIMEOUT_NO_RESPONSE, 1,000 ticks after its last packet.
 */
export const ALREADY_LOGGED_IN = 5;

/** A login ended by a server reply the caller listed in LoginOptions.stopOnReply, read from the page's title screen. */
export class LoginRefused extends Error {
    override name = 'LoginRefused';
    constructor(
        readonly reply: number,
        readonly pageMessage: string,
        readonly attempts: number,
        message: string
    ) {
        super(message);
    }
}

/** Whether `e` is a login the server refused because the account is still logged in (ALREADY_LOGGED_IN). */
export function alreadyLoggedIn(e: unknown): e is LoginRefused {
    return e instanceof LoginRefused && e.reply === ALREADY_LOGGED_IN;
}

/**
 * A login that saw no advancing in-world tick within its timeout. After a long silence the page can
 * be left claiming in game on a socket that carries nothing (the host's run D: 'Connecting to
 * server...', the account absent from the world), so runner/drop-relog.ts retries it on a fresh tab.
 */
export class LoginTimedOut extends Error {
    override name = 'LoginTimedOut';
}

export function loginTimedOut(e: unknown): e is LoginTimedOut {
    return e instanceof LoginTimedOut;
}

export interface LoginOptions {
    timeoutMs?: number;
    attempts?: number;
    /**
     * Browser only: log the tab back in where it stands (lib/tab.ts pageLogin) instead of
     * navigating it to a fresh token URL. The page keeps its loaded client, its game cache and its
     * socket to the gateway, so the bot sees the new session from its first ticks. If the page cannot
     * (no tab, no DevTools port, no client, the token refused) the attempt navigates instead, as
     * without this option.
     */
    inPage?: boolean;
    /** Refuse instead of navigating when the existing page cannot start this login. */
    requireInPage?: boolean;
    /** Re-read admission after async gates/token preparation; return its absolute freshness deadline. */
    beforeDispatch?: () => number;
    /**
     * Login replies (loginReplyCode) that end the login at once with LoginRefused when an in-page
     * attempt ends on one, instead of navigating and retrying: the caller keeps its own schedule
     * for them (runner/drop-relog.ts waits out the server's hold on a dropped session).
     */
    stopOnReply?: readonly number[];
}

export interface LoginResult {
    wallMs: number;
    attempts: number;
    /** How the last attempt got in: a client launch (the tab navigated, or a lite child), or the page in place. */
    via: 'launch' | 'page';
    /** session.tickBase for the new session. */
    tickBase: number;
    /** The run toggle after login turned it on, with `reason` when it would not (lib/run-mode.ts); not counted in wallMs. */
    run: EnsureRunResult;
    /** Auto-retaliate after login turned it off (setAutoRetaliate), with `reason` when it would not; not counted in wallMs. */
    retaliate: RetaliateResult;
}

/** controls:com_2 / com_3 (player_controls.rs2): auto-retaliate on / off, varp option_nodef, published as autoRetaliateEnabled. */
export const IF_RETALIATE_ON = 150;
export const IF_RETALIATE_OFF = 151;

export interface RetaliateResult {
    /** Auto-retaliate as published when setAutoRetaliate returned (null: not published). */
    on: boolean | null;
    /** Button presses sent (0 when it already read as asked, or was unavailable). */
    presses: number;
    /** Set when nothing was tried because the button cannot work here. */
    unavailable?: 'tutorial-island';
    /** Set when it is not confirmed as asked: it would not take, the client does not publish it, or the player is out of the world. */
    reason?: string;
}

/**
 * Set auto-retaliate and confirm it from published state, on the run toggle's rules (run-mode.ts):
 * nothing is sent when it already reads so, since the button runs if_close and p_stopaction; a
 * press the server ignores (a busy player only resyncs the varp) is sent once more; on Tutorial
 * Island the controls tab is hidden, so nothing is tried. Never throws: a setting that will not
 * take comes back with `reason` and is passed to `warn`.
 *
 * Every login turns it off (openSession, login): the run's fights are all module-initiated, and
 * with it on a hit during a walk or a loc click turns the player to fight back, which drops the
 * click (rs/391: TGV segment H). A phase that wants it on (ranged.ts) sets it itself.
 */
export async function setAutoRetaliate(sdk: RunSdk, on: boolean, warn: (msg: string) => void = m => console.warn(m)): Promise<RetaliateResult> {
    const fail = (r: RetaliateResult): RetaliateResult => {
        warn(`[speedrun] auto-retaliate not confirmed ${on ? 'on' : 'off'}, continuing: ${r.reason}`);
        return r;
    };
    const s = sdk.getState();
    if (!s?.inGame) return fail({ on: s?.autoRetaliateEnabled ?? null, presses: 0, reason: 'not in the world' });
    if (onTutorialIsland(s.player)) return { on: s.autoRetaliateEnabled ?? null, presses: 0, unavailable: 'tutorial-island' };
    if (s.autoRetaliateEnabled === undefined) return fail({ on: null, presses: 0, reason: 'this client does not publish autoRetaliateEnabled (update the client)' });
    if (s.autoRetaliateEnabled === on) return { on, presses: 0 };
    let why = '';
    for (let press = 1; press <= RUN_PRESSES; press++) {
        await sdk.sendClickComponent(on ? IF_RETALIATE_ON : IF_RETALIATE_OFF);
        const r = await waitUntil(sdk, st => st.autoRetaliateEnabled === on, { maxTicks: RUN_CONFIRM_TICKS });
        if (r.ok) return { on, presses: press };
        why = r.reason === 'idle' ? STALLED : `still ${on ? 'off' : 'on'} ${RUN_CONFIRM_TICKS} ticks later`;
    }
    return fail({
        on: sdk.getState()?.autoRetaliateEnabled ?? null,
        presses: RUN_PRESSES,
        reason: `auto-retaliate did not turn ${on ? 'on' : 'off'} after ${RUN_PRESSES} presses (${why}): the server ignores the button while the player is busy (p_finduid)`,
    });
}

/**
 * Log back in after a logout and wait for an advancing tick: by default a client launch (a lite
 * child, or the tab re-navigated to a fresh token URL), with `inPage` the page itself.
 *
 * A login seconds after a logout can be accepted by the login thread and then
 * dropped by the world while the old session's save is still flushing
 * (World.ts: "old session is mid-logout"); the lite client then ends its
 * session at once, and an in-page login falls back to the title screen. So a
 * login that ends before its first in-world tick is retried with backoff, up to
 * `attempts` times; after an in-page attempt the retries navigate.
 *
 * Once in, it turns run on (lib/run-mode.ts ensureRunOn: the toggle is not
 * saved, so every login starts walking) and auto-retaliate off (setAutoRetaliate);
 * a setting that will not take is recorded in `run` / `retaliate` and warned, not thrown. Relog, the watchdog's login and the
 * outage reconnect all come through here.
 */
export async function login(session: Session, opts: LoginOptions = {}): Promise<LoginResult> {
    if (session.beforeLogin) await session.beforeLogin();
    const t0 = Date.now();
    const deadline = t0 + (opts.timeoutMs ?? 90_000);
    const maxAttempts = opts.attempts ?? 6;
    const cdp = session.client === 'browser' && !session.insecureQueryLogin ? cdpUrl(session.env) : undefined;
    let inPage = opts.inPage === true && cdp !== undefined;
    if ((opts.requireInPage || opts.beforeDispatch) && !inPage) throw new Error('guarded login requires an in-page browser login');
    for (let attempt = 1; ; attempt++) {
        const sinceTick = session.lastInWorldTick;
        const sinceAdvance = session.lastAdvanceAt;
        let via: LoginResult['via'] = 'launch';
        if (inPage) {
            const start = await loginInPage(session, cdp!, opts);
            if (start.started) via = 'page';
            else {
                if (opts.requireInPage || opts.beforeDispatch) throw new Error(`in-page login refused: ${start.reason}`);
                // The page cannot log itself in, now or later: navigate from here on.
                appendFileSync(session.logPath, `[speedrun] session ${session.sessionId}: in-page login unavailable (${start.reason}); navigating the tab\n`);
                inPage = false;
            }
        }
        if (via === 'launch') await launchClient(session);
        let endedOn = '';
        const ended =
            via === 'page'
                ? async () => {
                      const message = await pageLoginEnded(session, cdp!);
                      if (message === null) return false;
                      endedOn = message;
                      return true;
                  }
                : undefined;
        const outcome = await waitInWorldOrExit(session, sinceTick, sinceAdvance, Math.max(1_000, deadline - Date.now()), ended);
        if (outcome === 'in-world') {
            session.expectInWorld = true;
            session.watchdog?.resume();
            const wallMs = Date.now() - t0;
            const run = await ensureRunOn(session.sdk);
            const retaliate = await setAutoRetaliate(session.sdk, false);
            return { wallMs, attempts: attempt, via, tickBase: session.tickBase, run, retaliate };
        }
        const reply = outcome === 'exited' && via === 'page' ? loginReplyCode(endedOn) : null;
        if (reply !== null && opts.stopOnReply?.includes(reply)) {
            throw new LoginRefused(reply, endedOn, attempt, `${session.name}: login refused after ${attempt} attempt(s) (reply ${reply}: ${endedOn})`);
        }
        if (outcome === 'timeout' || attempt >= maxAttempts || session.childExit === 3) {
            throw new (outcome === 'timeout' ? LoginTimedOut : Error)(`${session.name}: login failed after ${attempt} attempt(s) (${outcome}, ${via === 'page' ? 'in page' : `exit ${session.childExit}`})`);
        }
        // An in-page login that ended without getting in is not tried in the page again: a page
        // whose client cannot log in twice (a bundle before rs/183's autoLogin fix) would fail every
        // attempt, and a navigation costs the same ticks, only some seconds more.
        if (via === 'page' && !opts.requireInPage && !opts.beforeDispatch) inPage = false;
        await sleep(backoffMs(attempt));
    }
}

/** How long relaunchOwnTab waits for its launch's own session (openSession's launch budget). */
export const RELAUNCH_READY_MS = 120_000;

/**
 * Log SCORED's tab in afresh: the watchdog's relaunch (launchClient: the one tab re-navigated to a new
 * token URL, a new launch tag) checked by its launch identity (waitOwnLaunch, rs/668), so a cached or
 * foreign state never counts as this login. Never an in-page login: the tab it replaces may be a
 * zombie that says in game on a dead socket. A launch whose page ends on a login reply the title
 * screen tells apart (loginReplyCode) throws LoginRefused with that reply; any other failure throws
 * waitOwnLaunch's refusal. Browser only.
 */
export async function relaunchOwnTab(session: Session, timeoutMs: number = RELAUNCH_READY_MS): Promise<LoginResult> {
    if (session.client !== 'browser') throw new Error(`${session.name}: relaunchOwnTab relaunches a browser tab`);
    if (session.beforeLogin) await session.beforeLogin();
    const t0 = Date.now();
    await launchClient(session);
    try {
        await waitOwnLaunch(session, timeoutMs);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const reply = loginReplyCode(message);
        if (reply !== null) throw new LoginRefused(reply, message, 1, `${session.name}: fresh-tab login refused (reply ${reply}): ${message}`);
        throw err;
    }
    session.expectInWorld = true;
    session.watchdog?.resume();
    const wallMs = Date.now() - t0;
    const run = await ensureRunOn(session.sdk);
    const retaliate = await setAutoRetaliate(session.sdk, false);
    await settleScene(session);
    return { wallMs, attempts: 1, via: 'launch', tickBase: session.tickBase, run, retaliate };
}

/**
 * Start an in-page login with a fresh one-time token, and on success begin the new game session
 * (sessionId, launchedAt, tickBase) the way launchClient does for a launch.
 */
async function loginInPage(session: Session, cdp: string, opts: LoginOptions): Promise<{ started: boolean; reason?: string }> {
    let token: string;
    try { token = await mintLoginToken(session.env); }
    catch (err) {
        if (opts.requireInPage || opts.beforeDispatch) throw err;
        return { started: false, reason: (err as Error).message };
    }
    // Admission refusals must not become an unavailable-page result and trigger navigation.
    const validUntil = opts.beforeDispatch?.();
    if (validUntil !== undefined && (!Number.isFinite(validUntil) || Date.now() >= validUntil)) throw new Error('login readiness expired');
    let start: PageLoginStart | null;
    try {
        start = await pageLogin(cdp, session.name, token, validUntil);
    } catch (err) {
        return { started: false, reason: (err as Error).message };
    }
    if (!start) return { started: false, reason: 'no tab for this bot' };
    if (!start.started) return { started: false, reason: start.reason };
    session.sessionId++;
    // Without a reload the page goes on counting; its last published tick is the fallback base.
    session.tickBase = start.tickBase ?? session.lastInWorldTick;
    session.childExit = null;
    session.launchedAt = Date.now();
    appendFileSync(
        session.logPath,
        `[speedrun] session ${session.sessionId}: in-page login at ${new Date().toISOString()} (tick base ${session.tickBase}, gateway socket ${start.gatewayConnected === null ? 'unknown' : start.gatewayConnected ? 'up' : 'down'})\n`
    );
    return { started: true };
}

/**
 * The title screen's message once an in-page login has ended without getting in (the page neither
 * in game nor logging in), else null. Unknown reads as not ended.
 */
async function pageLoginEnded(session: Session, cdp: string): Promise<string | null> {
    const st = await pageLoginState(cdp, session.name).catch(() => null);
    if (!st || st.inGame || st.loginInProgress) return null;
    appendFileSync(session.logPath, `[speedrun] session ${session.sessionId}: in-page login ended on the title screen (${st.message || 'no message'}${st.error ? `; threw ${st.error}` : ''})\n`);
    return st.message;
}

export interface RelogResult {
    logout: LogoutResult;
    /**
     * Client tick of the new session's first in-world state, comparable with
     * state.tick. After a launch the counter restarts, so this is also the
     * in-world ticks the login cost before the state was visible; after an
     * in-page login the page counts on, and that cost is loginTick - tickBase.
     */
    loginTick: number;
    /** session.tickBase for the new session (0 after a launch). */
    tickBase: number;
    /** How login got in: a client launch, or the page logging in where it stands. */
    via: LoginResult['via'];
    loginWallMs: number;
    attempts: number;
}

/**
 * Clean logout, `offlineMs` of wall time (no in-world ticks pass while logged
 * out; a little of it spares the login a retry while the old session's save
 * flushes), and a fresh login. A relog re-arms the login timers (wine's
 * fermentation among them). It does not skip queued level-up pages: the
 * logout runs them out first, one per in-world tick (LOGOUT_WAIT_TICKS).
 *
 * A browser tab with CDP logs back in where it stands (login's `inPage`, on by
 * default here), which falls back to navigating it; a lite client relaunches.
 */
export async function relog(session: Session, opts: { offlineMs?: number; loginTimeoutMs?: number; inPage?: boolean } = {}): Promise<RelogResult> {
    const logout = await logoutClean(session);
    if (!logout.ok) throw new Error(`${session.name}: logout failed: ${logout.reason}`);
    // Logging back in would carry on from the respawn as if nothing happened.
    if (logout.death) throw new Error(`${session.name}: no relog after a death: ${logout.death.reason}`);
    if (opts.offlineMs ?? 2_000) await sleep(opts.offlineMs ?? 2_000);
    const before = Date.now();
    let first: number | null = null;
    const unsub = session.sdk.onStateUpdate(st => {
        // Only states from the new session count; its launch or in-page login starts after `before`.
        if (first === null && session.launchedAt >= before && st.inGame && (st.player?.worldX ?? 0) > 0) first = st.tick;
    });
    try {
        const r = await login(session, { timeoutMs: opts.loginTimeoutMs, inPage: opts.inPage ?? true });
        return { logout, loginTick: first ?? session.sdk.getState()?.tick ?? 0, tickBase: r.tickBase, via: r.via, loginWallMs: r.wallMs, attempts: r.attempts };
    } finally {
        unsub();
    }
}

/**
 * Begin, on this session, a game session someone else logged the page into (the operator's
 * relog-now while run.ts waited after a drop), as loginInPage does for one of our own: sessionId,
 * tickBase (the page's count when that login started, when known), launchedAt; and the watchdog back
 * on. The caller then waits for the advancing tick (resume.ts sessionLink restored).
 *
 * The new session id supersedes everything issued under the old one: a logoutClean still waiting
 * stops, and a logout click from before is never sent (sendLogoutClick).
 */
export function adoptSession(session: Session, tickBase: number = session.lastInWorldTick): void {
    session.sessionId++;
    session.tickBase = tickBase;
    session.childExit = null;
    session.launchedAt = Date.now();
    session.expectInWorld = true;
    session.watchdog?.resume();
    appendFileSync(session.logPath, `[speedrun] session ${session.sessionId}: adopted a login made outside this process at ${new Date().toISOString()} (tick base ${tickBase})\n`);
}

/**
 * How often waitInWorldOrExit asks `ended` (a page read through the browser tab). A wall cadence
 * bounding that read's cost, not a tick: before the login lands there are no ticks to count.
 */
const ENDED_POLL_MS = 300;

/**
 * Resolve once the tick advances past what was seen before the launch, or the login ends without
 * getting in: the lite child exits, or `ended` (polled every ENDED_POLL_MS) says so.
 */
async function waitInWorldOrExit(
    session: Session,
    sinceTick: number,
    sinceAdvance: number,
    ms: number,
    ended?: () => Promise<boolean>
): Promise<'in-world' | 'exited' | 'timeout'> {
    const deadline = Date.now() + ms;
    let firstTick: number | null = null;
    let nextEndedCheck = Date.now() + ENDED_POLL_MS;
    while (Date.now() < deadline) {
        if (session.client === 'lite' && session.childExit !== null) return 'exited';
        if (ended && Date.now() >= nextEndedCheck) {
            nextEndedCheck = Date.now() + ENDED_POLL_MS;
            if (await ended()) return 'exited';
        }
        const s = session.sdk.getState();
        if (s?.inGame && session.lastAdvanceAt > sinceAdvance && session.lastAdvanceAt > session.launchedAt) {
            if (firstTick === null) firstTick = s.tick;
            else if (s.tick !== firstTick && s.tick !== sinceTick) return 'in-world';
        }
        await sleep(50);
    }
    return 'timeout';
}

// ---------------------------------------------------------------- watchdog

export interface WatchdogInputs {
    expectInWorld: boolean;
    paused: boolean;
    now: number;
    /** Wall ms since the in-game tick last advanced. */
    msSinceAdvance: number;
    staleMs: number;
    /** Wall ms since the last client launch, and whether a tick has advanced since. */
    msSinceLaunch: number;
    tickedSinceLaunch: boolean;
    /** How long a fresh client may take to log in before staleness counts. */
    launchGraceMs: number;
    gateway: BotStatus['status'] | null;
    /**
     * Our own gateway cannot be seen through: the SDK's socket to it is down (reconnecting), its
     * status does not answer, or it came back GATEWAY_BACK_GRACE_TICKS ago at most with no tick
     * since (the page reconnects to it on its own timer). Nothing about the client can be told then,
     * and no click can land.
     */
    gatewayDown?: boolean;
    /** Lite child exit code, null while running or for the browser. */
    childExit: number | null;
    nextAttemptAt: number;
    /** A clean logout was already tried during the current wedge and not confirmed. */
    logoutFailed: boolean;
    /** Observed ticks since the bot's last markProgress, and the limit; null when progress is not tracked. */
    ticksSinceProgress: number | null;
    progressStaleTicks: number | null;
    /** The world itself is gone (demo restart, or our network): lib/reconnect.ts. Probed only when unhealthy. */
    serverDown: boolean;
    /** A bank or trade interface open in the last published state (null or absent: none). */
    interfaceOpen?: 'bank' | 'trade' | null;
    /** Wall ms the watchdog has held its logout for that interface, and how long it may (INTERFACE_HOLD_TICKS). */
    msInterfaceHeld?: number;
    interfaceHoldMs?: number;
}

/**
 * Ticks (of wall time: a wedged client publishes none) the watchdog holds a logout while a bank or
 * trade is open, before it logs out anyway. A bank burst or a trade's accepts end within a few
 * ticks and the step's own waits fail long before this; a logout click then would close the
 * interface under the step (the button runs if_close), and the server keeps a player with a modal
 * open in the world anyway. Bounded, so a stuck interface still ends in the old verdict.
 */
export const INTERFACE_HOLD_TICKS = 100;

/** What the watchdog's logout would close: an open bank or trade in `s`. */
export function openInterface(s: Pick<BotWorldState, 'bank' | 'trade'> | null | undefined): 'bank' | 'trade' | null {
    if (s?.bank?.isOpen) return 'bank';
    if (s?.trade?.isOpen) return 'trade';
    return null;
}

/**
 * - `logout`: the client is wedged but its process is alive. Log out cleanly
 *   (the player leaves on the next tick), then log back in.
 * - `relaunch`: the client is gone (or would not log out). Launch a fresh one;
 *   its login takes the session over in the engine (World.ts "kick the existing
 *   session"), which is the only way out faster than the 500/1000-tick timeouts.
 * - `stop`: the client is healthy but the bot stopped making progress. Log out
 *   cleanly and stay out: a live client keeps an idle player in the world forever.
 * - `outage`: the client is gone or wedged because the server is. Nothing is on
 *   the clock (the world died with the process) and nothing can be taken over;
 *   wait for the world and log in once it accepts logins (reconnectAfterOutage).
 * - `gateway_down`: the tick stopped because our own gateway did, which is no
 *   evidence the client is wedged or out (the page may be playing on, unseen),
 *   and a logout through it cannot land. Wait for it; nothing is done.
 */
export type WatchdogVerdict = 'ok' | 'wait' | 'logout' | 'relaunch' | 'stop' | 'outage' | 'gateway_down' | 'give_up';

/**
 * Ticks after our gateway is reachable again during which a stale tick still reads as the gateway's
 * and not the client's: the page's gateway connection retries every 3 s on its own
 * (webclient GatewayConnection), the SDK's within GATEWAY_RECONNECT_MAX_MS. 10 s at 400 ms.
 */
export const GATEWAY_BACK_GRACE_TICKS = 25;

/**
 * Pure decision. While the account should be in the world: a lite child that
 * exited gets a relaunch; a stale tick or a dead/stale gateway with the client
 * still running gets a clean logout first, and a relaunch only if that logout
 * was not confirmed; a stalled bot gets a stop. A stale tick while our own
 * gateway is down is the gateway's, not the client's: `gateway_down`, before
 * the server probe. Never relaunch after exit code 3 (outdated client);
 * relaunches respect the backoff window, a logout does not.
 */
export function watchdogDecision(i: WatchdogInputs): WatchdogVerdict {
    if (i.paused || !i.expectInWorld) return 'ok';
    if (i.childExit === 3) return 'give_up';
    const relaunch = i.now >= i.nextAttemptAt ? 'relaunch' : 'wait';
    if (i.childExit !== null) return i.serverDown ? 'outage' : relaunch;
    // A client that is still logging in is not stale; only its exit counts.
    if (!i.tickedSinceLaunch && i.msSinceLaunch < i.launchGraceMs) return 'ok';
    const wedged = i.msSinceAdvance > i.staleMs || i.gateway === 'dead' || i.gateway === 'stale';
    // The logout refuses while a bank or trade is open, for a bounded hold (INTERFACE_HOLD_TICKS).
    const held = !!i.interfaceOpen && (i.msInterfaceHeld ?? 0) <= (i.interfaceHoldMs ?? Infinity);
    if (wedged) return i.gatewayDown ? 'gateway_down' : i.serverDown ? 'outage' : i.logoutFailed ? relaunch : held ? 'wait' : 'logout';
    if (i.progressStaleTicks !== null && i.ticksSinceProgress !== null && i.ticksSinceProgress > i.progressStaleTicks) return held ? 'wait' : 'stop';
    return 'ok';
}

/** Backoff after the n-th consecutive relaunch: 1 s, 2 s, 4 s, ... capped at 30 s. */
export function backoffMs(attempt: number): number {
    return Math.min(30_000, 1_000 * 2 ** Math.max(0, attempt - 1));
}

export interface Watchdog {
    stop(): void;
    pause(): void;
    resume(): void;
    /** Run one decision and act on it now (the timer calls this every tick). */
    check(): Promise<void>;
    readonly relaunches: number;
    readonly logouts: number;
    readonly outages: number;
    readonly gaveUp: boolean;
}

export interface WatchdogEvent {
    at: number;
    verdict: WatchdogVerdict;
    reason: string;
    sessionId: number;
}

/** What the watchdog does about a verdict; replaceable in tests. */
export interface WatchdogActions {
    logout(session: Session, timeoutMs: number): Promise<LogoutResult>;
    login(session: Session): Promise<unknown>;
    relaunch(session: Session): Promise<void>;
    /** Back into the world after the server went away (default reconnectAfterOutage). */
    reconnect(session: Session): Promise<unknown>;
}

const liveActions: WatchdogActions = {
    reconnect: async session => (await import('./reconnect')).reconnectAfterOutage(session),
    logout: (session, timeoutMs) => logoutClean(session, { timeoutMs }),
    login: session => login(session),
    relaunch: async session => {
        await killChild(session);
        await launchClient(session);
    },
};

export interface WatchdogOptions {
    /**
     * Ticks without an advancing in-world tick before the client counts as wedged
     * (default 17, ~5 s: the demo has gone ~2 s without a frame and recovered,
     * rs/102; a dead client is seen at once through its exit, not this).
     */
    staleTicks?: number;
    launchGraceMs?: number;
    /** How long the clean logout of a wedged client may take before it counts as not landing (default 8 ticks, at least 2 s). */
    logoutTimeoutMs?: number;
    /** Opt in: ticks without markProgress before a healthy client's bot counts as stalled (verdict stop). */
    progressStaleTicks?: number;
    onEvent?: (e: WatchdogEvent) => void;
    /** Default true; false leaves the checks to wd.check() (tests). */
    timer?: boolean;
    actions?: Partial<WatchdogActions>;
    /**
     * Is the world itself gone? Asked only when the client looks unhealthy, before
     * any logout or relaunch (reconnect.ts serverDownProbe over a DemoMonitor).
     * Without it every drop is treated as the client's.
     */
    serverDown?: () => Promise<boolean>;
    /**
     * Asked before a logout, relaunch or stop: a reason to stand down instead (run.ts: the page is
     * out of the world, which its drop recovery relogs in page; a logout and relaunch here would
     * race it with a client relaunch; or the page still says in game inside its hold window,
     * runner/page-hold.ts). `verdict` is the one about to be acted on, `msSinceAdvance` the silence
     * behind it. Null: act as usual.
     */
    standDown?: (at: { verdict: WatchdogVerdict; msSinceAdvance: number }) => Promise<string | null>;
}

/**
 * Keep the scored account either playing or out of the world. A wedged client
 * is logged out cleanly and logged back in (leaves on the next tick, costs no
 * counted ticks while out); one that will not log out, or whose process died,
 * is replaced by a fresh launch, whose login takes the session over. A bot that
 * stops calling markProgress (when progressStaleTicks is set) is logged out and
 * left out. Nothing here kills a running client except as the fallback before a
 * relaunch.
 */
export function startWatchdog(session: Session, opts: WatchdogOptions = {}): Watchdog {
    // Silence has no ticks to count: the stale bound is that many ticks of the longer of the
    // nominal and the observed period (wait.ts idleBoundMs), re-read on every check.
    const staleMs = () => idleBoundMs({ ticks: opts.staleTicks ?? 17, period: session.period });
    const launchGraceMs = opts.launchGraceMs ?? 30_000;
    const logoutTimeoutMs = opts.logoutTimeoutMs ?? Math.max(2_000, 8 * tickMs());
    const progressStaleTicks = opts.progressStaleTicks ?? null;
    const actions: WatchdogActions = { ...liveActions, ...opts.actions };
    let paused = false;
    let stopped = false;
    let gaveUp = false;
    let relaunches = 0;
    let logouts = 0;
    let outages = 0;
    let attempt = 0;
    let nextAttemptAt = 0;
    let logoutFailed = false;
    let busy = false;
    let gateway: BotStatus['status'] | null = null;
    let gatewayAnswers = true;
    let lastGatewayPoll = 0;
    // While our gateway is unreachable, and when it last became reachable again (0: not since start).
    let gatewayWasDown = false;
    let gatewayBackAt = 0;
    const interfaceHoldMs = INTERFACE_HOLD_TICKS * tickMs();
    let heldSince: number | null = null;
    let lastWait = '';

    const emit = (verdict: WatchdogVerdict, reason: string) => opts.onEvent?.({ at: Date.now(), verdict, reason, sessionId: session.sessionId });
    const backOff = () => {
        attempt++;
        nextAttemptAt = Date.now() + backoffMs(attempt);
    };

    const check = async () => {
        if (stopped || busy || gaveUp) return;
        busy = true;
        try {
            const now = Date.now();
            if (now - lastGatewayPoll > 2_000) {
                lastGatewayPoll = now;
                const st = await gatewayStatus(session);
                gatewayAnswers = st !== null;
                gateway = st?.status ?? null;
            }
            const connected = sdkConnected(session);
            const unreachable = !connected || !gatewayAnswers;
            if (unreachable) gatewayWasDown = true;
            else if (gatewayWasDown) {
                gatewayWasDown = false;
                gatewayBackAt = Date.now();
            }
            const returning = gatewayBackAt > 0 && session.lastAdvanceAt < gatewayBackAt && Date.now() - gatewayBackAt < GATEWAY_BACK_GRACE_TICKS * tickMs();
            const gatewayDown = unreachable || returning;
            const msSinceAdvance = Date.now() - session.lastAdvanceAt;
            const interfaceOpen = openInterface(session.sdk.getState());
            if (!interfaceOpen) heldSince = null;
            const stale = staleMs();
            const decide = (serverDown: boolean) => watchdogDecision({
                expectInWorld: session.expectInWorld, paused, now: Date.now(), msSinceAdvance, staleMs: stale,
                msSinceLaunch: Date.now() - session.launchedAt, tickedSinceLaunch: session.lastAdvanceAt > session.launchedAt, launchGraceMs,
                gateway, gatewayDown, childExit: session.child ? session.childExit : null, nextAttemptAt, logoutFailed,
                ticksSinceProgress: progressStaleTicks === null ? null : session.ticksSinceProgress, progressStaleTicks, serverDown,
                interfaceOpen, msInterfaceHeld: heldSince === null ? 0 : Date.now() - heldSince, interfaceHoldMs,
            });
            let verdict = decide(false);
            if ((verdict === 'logout' || verdict === 'relaunch' || verdict === 'wait') && opts.serverDown) {
                if (await opts.serverDown().catch(() => false)) verdict = decide(true);
            }
            if (verdict === 'ok') {
                if (msSinceAdvance < stale) {
                    attempt = 0;
                    logoutFailed = false;
                }
                lastWait = '';
                return;
            }
            const why = `childExit=${session.childExit} sinceAdvance=${msSinceAdvance}ms gateway=${gateway}${unreachable ? ` (unreachable, sdk ${connected ? 'connected' : 'not connected'})` : returning ? ' (back, no tick yet)' : ''}`;
            if (verdict === 'gateway_down') {
                // Said once per outage, not every tick.
                const line = returning ? 'our gateway is back; waiting for the page to publish through it' : 'our gateway is unreachable: no logout can land and the client cannot be judged; waiting';
                if (lastWait !== line) emit('gateway_down', `${line} (${why})`);
                lastWait = line;
                return;
            }
            if (verdict === 'wait' && interfaceOpen && !logoutFailed) {
                // The logout is held for the open interface: said once per hold, not every tick.
                heldSince ??= Date.now();
                const line = `logout held: the ${interfaceOpen} is open (${why})`;
                if (lastWait !== line.split(' (')[0]) emit('wait', line);
                lastWait = line.split(' (')[0]!;
                return;
            }
            if ((verdict === 'logout' || verdict === 'relaunch' || verdict === 'stop') && opts.standDown) {
                const hold = await opts.standDown({ verdict, msSinceAdvance }).catch(() => null);
                if (hold) {
                    if (lastWait !== hold) emit('wait', `${verdict} held: ${hold} (${why})`);
                    lastWait = hold;
                    return;
                }
            }
            lastWait = '';
            emit(verdict, why);
            if (verdict === 'give_up') {
                gaveUp = true;
                return;
            }
            if (verdict === 'outage') {
                outages++;
                logoutFailed = false;
                try {
                    await actions.reconnect(session);
                    attempt = 0;
                    emit('relaunch', `back in after the outage (session ${session.sessionId})`);
                } catch (err) {
                    // Leave it to the next check: still down means another outage pass.
                    session.expectInWorld = true;
                    paused = false;
                    backOff();
                    emit('outage', `reconnect failed: ${err}`);
                }
                gateway = null;
                lastGatewayPoll = Date.now() + 5_000;
                return;
            }
            if (verdict === 'logout' || verdict === 'stop') {
                logouts++;
                const out = await actions.logout(session, logoutTimeoutMs);
                if (out.superseded) {
                    // An adopt or a relog began a newer session meanwhile; it set expectInWorld and resumed us.
                    emit('logout', `logout dropped: ${out.reason}`);
                    return;
                }
                if (!out.ok && out.sends === 0) {
                    // Never sent (the gateway went away mid-logout): nothing failed to land, so no relaunch.
                    session.expectInWorld = true;
                    paused = false;
                    emit('logout', `logout not sent (${out.reason})`);
                    return;
                }
                if (!out.ok) {
                    // The click did not land (frozen client, broken relay). logoutClean
                    // paused us and cleared expectInWorld; the account is still in, so
                    // the next check relaunches.
                    logoutFailed = true;
                    session.expectInWorld = true;
                    paused = false;
                    emit('logout', `logout not confirmed (${out.reason}); relaunching`);
                    return;
                }
                emit(verdict, `logged out: last in-world tick ${out.lastInWorldTick}, ${out.latencyTicks} tick(s) after the click`);
                if (verdict === 'stop') return; // stay out, paused; the bot is not driving
                if (out.death) {
                    // A login now would carry the chain on from the respawn as if nothing happened.
                    emit('stop', `${out.death.reason}: left out for R8's recovery`);
                    return;
                }
                try {
                    await actions.login(session);
                    emit('relaunch', `logged back in (session ${session.sessionId})`);
                } catch (err) {
                    // Out of the world is safe; let the relaunch path retry with backoff.
                    session.expectInWorld = true;
                    paused = false;
                    backOff();
                    emit('relaunch', `login after logout failed: ${err}`);
                }
                return;
            }
            if (verdict === 'relaunch') {
                relaunches++;
                logoutFailed = false;
                backOff();
                await actions.relaunch(session);
                gateway = null;
                lastGatewayPoll = Date.now() + 5_000; // let the new client register before polling
            }
        } finally {
            busy = false;
        }
    };
    const timer = opts.timer === false ? null : setInterval(() => void check(), Math.max(100, tickMs()));
    const wd: Watchdog = {
        stop: () => {
            stopped = true;
            if (timer) clearInterval(timer);
        },
        pause: () => {
            paused = true;
        },
        resume: () => {
            paused = false;
            session.lastAdvanceAt = Date.now();
            session.ticksSinceProgress = 0;
            // A gateway status read while the session was out (stale, dead) says nothing about the new
            // one: without this the first check after a relog logs the healthy page out (rs/511's lab).
            gateway = null;
            lastGatewayPoll = Date.now();
        },
        check,
        get relaunches() {
            return relaunches;
        },
        get logouts() {
            return logouts;
        },
        get outages() {
            return outages;
        },
        get gaveUp() {
            return gaveUp;
        },
    };
    session.watchdog = wd;
    return wd;
}

/** Disconnect the SDK and stop the watchdog (does not log out). */
export async function closeSession(session: Session): Promise<void> {
    session.watchdog?.stop();
    await session.sdk.disconnect().catch(() => {});
}
