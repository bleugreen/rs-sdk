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

import { appendFileSync, existsSync, mkdirSync, openSync, readFileSync } from 'fs';
import { join } from 'path';
import type { Subprocess } from 'bun';
import { BotSDK, deriveGatewayUrl } from '../../sdk/index';
import type { BotActions } from '../../sdk/actions';
import type { BotStatus, BotWorldState } from '../../sdk/types';
import { ensureRunOn, RUN_CONFIRM_TICKS, RUN_PRESSES, type EnsureRunResult, type RunSdk } from './run-mode';
import { pageInGame, pageLogin, pageLoginState, type PageLoginStart } from './tab';
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
import { onTutorialIsland } from './world';

export const ROOT = join(import.meta.dir, '..', '..');
export const LOGOUT_BUTTON = 2458; // logout:try_logout
/** p_preventlogout(..., 16) after combat (logout.rs2). */
export const COMBAT_LOGOUT_TICKS = 16;
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
 * minted it. The bot name stays in the URL: tab.ts finds the tab by it.
 */
export function browserUrl(env: BotEnv, login: BrowserLogin): string {
    const bot = `bot=${encodeURIComponent(env.BOT_USERNAME)}`;
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
export async function openBrowserClient(env: BotEnv, opts: { cdp?: string; insecureQueryLogin?: boolean }): Promise<string> {
    const { reloadOrOpenTab } = await import('./tab');
    if (opts.insecureQueryLogin) {
        const url = browserUrl(env, { insecureQueryLogin: true });
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
    return reloadOrOpenTab(opts.cdp, browserUrl(env, { token: await mintLoginToken(env) }), env.BOT_USERNAME);
}

export interface Session {
    readonly name: string;
    readonly client: ClientKind;
    readonly env: BotEnv;
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
}

/**
 * Connect a control SDK to `botName` (from bots/<name>/bot.env), optionally
 * launching its client, and wait for a live, advancing tick, then turn run on
 * (lib/run-mode.ts; a press only when it reads off, which closes any open
 * modal). Unlike runScript, a disconnect is not fatal: logout and relaunch are
 * normal events here.
 */
export async function openSession(botName: string, opts: OpenOptions = {}): Promise<Session> {
    if (opts.awaitInWorld === false && opts.launch) throw new Error('an offline attach cannot launch a client');
    const env = loadBotEnv(botName);
    const client = opts.client ?? 'lite';
    const gatewayUrl = sessionGateway(env, client === 'browser' ? pageWorld(env) : env.SERVER || 'localhost', { allowRelay: opts.allowRelay });
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
        autoLaunchBrowser: false,
        showChat: env.SHOW_CHAT?.toLowerCase() !== 'false',
    });
    const logDir = join(process.env.TMPDIR ?? '/tmp', 'speedrun');
    mkdirSync(logDir, { recursive: true });
    const session: Session = {
        name: env.BOT_USERNAME,
        client,
        env,
        insecureQueryLogin: opts.insecureQueryLogin ?? process.argv.includes('--insecure-query-login'),
        sdk,
        bot: new BotActions(sdk),
        sessionId: 0,
        tickBase: 0,
        launchId: 0,
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
        // still reads inGame from the previous session. A freshly launched client
        // takes ~20 s on the demo to log in and advance past it, so give the advance
        // the whole budget rather than the short attach-time window.
        const ready = opts.readyTimeoutMs ?? 120_000;
        await waitAdvancingTick(session, ready, opts.launch ? ready : undefined);
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
        if (opts.launch) await abandonClient(session);
        await sdk.disconnect().catch(() => {});
        throw err;
    }
    return session;
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
        const spawnOpts = {
            cwd: join(ROOT, 'server', 'webclient'),
            stdout: openSync(session.logPath, 'a'),
            stderr: 'inherit',
            // The runner sleeps a random 0-5 s before logging in to a secured world
            // (lite/session.ts) to spread fleet starts. One account gains nothing
            // from it, and on a takeover the dropped player is in the world meanwhile.
            env: { ...process.env, LITE_LOGIN_JITTER_MS: process.env.LITE_LOGIN_JITTER_MS ?? '0' },
            detached: true,
        } as { cwd: string; stdout: number; stderr: 'inherit'; env: Record<string, string | undefined> };
        const child = Bun.spawn(['bun', 'src/lite/runner.ts', session.name], spawnOpts);
        session.child = child;
        guardLaunched(session);
        // A signal-killed child can report a null code; count it as 128+SIGKILL.
        void child.exited.then(code => {
            if (session.child === child) session.childExit = code ?? 137;
        });
        return;
    }
    // With CDP the one tab is re-navigated (lib/tab.ts) to a fresh token URL.
    const how = await openBrowserClient(session.env, { cdp: cdpUrl(session.env), insecureQueryLogin: session.insecureQueryLogin });
    appendFileSync(session.logPath, `[speedrun] session ${session.sessionId}: tab ${how} at ${new Date().toISOString()}\n`);
}

/** Stop a lite child that is still running (recovery only; never a way to log out). */
async function killChild(session: Session): Promise<void> {
    const child = session.child;
    if (!child || session.childExit !== null) return;
    child.kill('SIGKILL');
    await child.exited.catch(() => {});
}

/**
 * Get a launched lite client's player out of the world when this process is
 * giving it up. The logout click removes an in-world player on the next tick
 * and the runner exits on the server's LOGOUT; if it has not exited within
 * `waitMs` (the click could not land), SIGKILL, which bounds the stay to the
 * 500-tick no-connection timeout instead of the indefinite stay of a live runner.
 */
export async function abandonClient(session: Session, waitMs: number = Math.max(2_000, 10 * tickMs())): Promise<void> {
    const child = session.child;
    if (session.client !== 'lite' || !child || session.childExit !== null) return;
    session.expectInWorld = false;
    sendLogoutClick(session);
    const exited = await Promise.race([child.exited.then(() => true), sleep(waitMs).then(() => false)]);
    if (!exited) await killChild(session);
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
 */
export async function logoutClean(session: Session, opts: { timeoutMs?: number } = {}): Promise<LogoutResult> {
    const { sdk } = session;
    const gen = session.sessionId;
    session.watchdog?.pause();
    const t0 = Date.now();
    const s = sdk.getState();
    if (!s?.inGame) return { ok: false, clickTick: -1, lastInWorldTick: session.lastInWorldTick, latencyTicks: 0, wallMs: 0, reason: 'not in game' };
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
    if (s.player?.combat?.inCombat || s.tick - combatTick <= COMBAT_LOGOUT_TICKS) {
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
                : { reason: out === 'refused' ? 'logout refused (combat)' : sends === 0 ? 'never sent: the gateway was unreachable' : 'still in game after timeout' }),
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
        const ended = via === 'page' ? () => pageLoginEnded(session, cdp!) : undefined;
        const outcome = await waitInWorldOrExit(session, sinceTick, sinceAdvance, Math.max(1_000, deadline - Date.now()), ended);
        if (outcome === 'in-world') {
            session.expectInWorld = true;
            session.watchdog?.resume();
            const wallMs = Date.now() - t0;
            const run = await ensureRunOn(session.sdk);
            const retaliate = await setAutoRetaliate(session.sdk, false);
            return { wallMs, attempts: attempt, via, tickBase: session.tickBase, run, retaliate };
        }
        if (outcome === 'timeout' || attempt >= maxAttempts || session.childExit === 3) {
            throw new Error(`${session.name}: login failed after ${attempt} attempt(s) (${outcome}, ${via === 'page' ? 'in page' : `exit ${session.childExit}`})`);
        }
        // An in-page login that ended without getting in is not tried in the page again: a page
        // whose client cannot log in twice (a bundle before rs/183's autoLogin fix) would fail every
        // attempt, and a navigation costs the same ticks, only some seconds more.
        if (via === 'page' && !opts.requireInPage && !opts.beforeDispatch) inPage = false;
        await sleep(backoffMs(attempt));
    }
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
 * True once an in-page login has ended without getting in: the page is neither in game nor logging
 * in (it is back on the title screen, whose message says why). Unknown reads as not ended.
 */
async function pageLoginEnded(session: Session, cdp: string): Promise<boolean> {
    const st = await pageLoginState(cdp, session.name).catch(() => null);
    if (!st || st.inGame || st.loginInProgress) return false;
    appendFileSync(session.logPath, `[speedrun] session ${session.sessionId}: in-page login ended on the title screen (${st.message || 'no message'}${st.error ? `; threw ${st.error}` : ''})\n`);
    return true;
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
     * race it with a client relaunch). Null: act as usual.
     */
    standDown?: () => Promise<string | null>;
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
                const hold = await opts.standDown().catch(() => null);
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
