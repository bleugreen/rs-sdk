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
import type { BotSDK } from '../../sdk/index';
import type { BotActions } from '../../sdk/actions';
import type { BotStatus, BotWorldState } from '../../sdk/types';
import { sleep, tickMs, waitUntil } from './wait';

export const ROOT = join(import.meta.dir, '..', '..');
export const LOGOUT_BUTTON = 2458; // logout:try_logout
/** p_preventlogout(..., 16) after combat (logout.rs2). */
export const COMBAT_LOGOUT_TICKS = 16;

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

export function loadBotEnv(name: string): BotEnv {
    const path = join(ROOT, 'bots', name, 'bot.env');
    if (!existsSync(path)) throw new Error(`no bot.env at ${path} (bun bots/create-bot.ts ${name})`);
    return parseBotEnv(readFileSync(path, 'utf-8'));
}

/** The browser client URL for a bot (the same shape BotSDK opens). */
export function browserUrl(env: BotEnv): string {
    const server = env.SERVER ?? 'localhost';
    const q = `bot=${encodeURIComponent(env.BOT_USERNAME)}&password=${encodeURIComponent(env.PASSWORD)}`;
    if (server.startsWith('localhost') || server.startsWith('127.')) {
        const host = server.includes(':') ? server : `${server}:8888`;
        return `http://${host}/bot?${q}`;
    }
    const origin = /^wss?:\/\//.test(server) ? server.replace(/^ws/, 'http').replace(/\/gateway$/, '') : `https://${server}`;
    return `${origin}/bot?${q}`;
}

export interface Session {
    readonly name: string;
    readonly client: ClientKind;
    readonly env: BotEnv;
    readonly sdk: BotSDK;
    readonly bot: BotActions;
    /** Bumps on every client launch; the client's tick counter restarts with it. */
    sessionId: number;
    /** Whether the account should be in the world (false around an intended logout). */
    expectInWorld: boolean;
    child: Subprocess | null;
    childExit: number | null;
    /** Last tick seen while inGame, and when it last advanced (wall ms). */
    lastInWorldTick: number;
    lastAdvanceAt: number;
    /** Wall ms of the last client launch. */
    launchedAt: number;
    /** Wall ms of the bot's last markProgress (read by the watchdog's progressStaleTicks). */
    lastProgressAt: number;
    watchdog: Watchdog | null;
    logPath: string;
}

export interface OpenOptions {
    client?: ClientKind;
    /** Launch the client (default false: attach to one that is already running). */
    launch?: boolean;
    /** Warm the pathfinder before connecting (needed by bot.walkTo / bot.openBank). Default true. */
    pathfinding?: boolean;
    readyTimeoutMs?: number;
}

/**
 * Connect a control SDK to `botName` (from bots/<name>/bot.env), optionally
 * launching its client, and wait for a live, advancing tick. Unlike runScript,
 * a disconnect is not fatal: logout and relaunch are normal events here.
 */
export async function openSession(botName: string, opts: OpenOptions = {}): Promise<Session> {
    const env = loadBotEnv(botName);
    const { BotSDK, deriveGatewayUrl } = await import('../../sdk/index');
    const { BotActions } = await import('../../sdk/actions');
    if (opts.pathfinding !== false) (await import('../../sdk/pathfinding')).initPathfinding();
    const sdk = new BotSDK({
        botUsername: env.BOT_USERNAME,
        password: env.PASSWORD,
        gatewayUrl: env.GATEWAY_URL ?? deriveGatewayUrl(env.SERVER),
        connectionMode: 'control',
        autoReconnect: true,
        autoLaunchBrowser: false,
        showChat: env.SHOW_CHAT?.toLowerCase() !== 'false',
    });
    const logDir = join(process.env.TMPDIR ?? '/tmp', 'speedrun');
    mkdirSync(logDir, { recursive: true });
    const session: Session = {
        name: env.BOT_USERNAME,
        client: opts.client ?? 'lite',
        env,
        sdk,
        bot: new BotActions(sdk),
        sessionId: 0,
        expectInWorld: true,
        child: null,
        childExit: null,
        lastInWorldTick: -1,
        lastAdvanceAt: Date.now(),
        launchedAt: 0,
        lastProgressAt: Date.now(),
        watchdog: null,
        logPath: join(logDir, `${env.BOT_USERNAME}-${opts.client ?? 'lite'}.log`),
    };
    sdk.onStateUpdate(s => track(session, s));
    if (opts.launch) await launchClient(session);
    try {
        await sdk.connect();
        // On connect the gateway can hand back the bot's last published state, which
        // still reads inGame from the previous session. A freshly launched client
        // takes ~20 s on the demo to log in and advance past it, so give the advance
        // the whole budget rather than the short attach-time window.
        const ready = opts.readyTimeoutMs ?? 120_000;
        await waitAdvancingTick(session, ready, opts.launch ? ready : undefined);
    } catch (err) {
        // The client we launched may be in the world even though this process never
        // saw it advance; left running it would hold the player there indefinitely.
        if (opts.launch) await abandonClient(session);
        await sdk.disconnect().catch(() => {});
        throw err;
    }
    return session;
}

/** Tell the watchdog the bot is still making progress (see progressStaleTicks). */
export function markProgress(session: Session): void {
    session.lastProgressAt = Date.now();
}

function track(session: Session, s: BotWorldState): void {
    if (!s.inGame) return;
    if (s.tick !== session.lastInWorldTick) {
        session.lastInWorldTick = s.tick;
        session.lastAdvanceAt = Date.now();
    }
}

/** Wait until the client publishes in-game state with a tick that advances. */
export async function waitAdvancingTick(session: Session, timeoutMs: number, advanceMs: number = Math.max(5_000, 20 * tickMs())): Promise<BotWorldState> {
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

/** Start the game client: a lite runner child, or the browser tab. Bumps sessionId. */
export async function launchClient(session: Session): Promise<void> {
    session.sessionId++;
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
            env: { ...process.env },
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
    const open = (await import('open')).default;
    await open(browserUrl(session.env));
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
    void session.sdk.sendClickComponent(LOGOUT_BUTTON).catch(() => {});
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

export interface LogoutResult {
    ok: boolean;
    clickTick: number;
    lastInWorldTick: number;
    /** Ticks from the logout click to the last tick in the world (0 = same tick). */
    latencyTicks: number;
    wallMs: number;
    reason?: string;
}

const CANT_LOGOUT = /can't log out/i;

/**
 * Log out with the logout button, verified. Waits out the post-combat window
 * first; if the server still refuses, waits the remaining ticks and retries
 * once. Verification: no in-game tick after the click, and the lite child
 * exited (session end) or the gateway reports the bot dead / the browser
 * publishes inGame:false.
 */
export async function logoutClean(session: Session, opts: { timeoutMs?: number } = {}): Promise<LogoutResult> {
    const { sdk } = session;
    session.watchdog?.pause();
    const t0 = Date.now();
    const s = sdk.getState();
    if (!s?.inGame) return { ok: false, clickTick: -1, lastInWorldTick: session.lastInWorldTick, latencyTicks: 0, wallMs: 0, reason: 'not in game' };

    const combatTick = s.player?.combat?.lastDamageTick ?? -Infinity;
    if (s.player?.combat?.inCombat || s.tick - combatTick <= COMBAT_LOGOUT_TICKS) {
        const until = Math.max(s.tick, combatTick) + COMBAT_LOGOUT_TICKS + 1;
        await waitUntil(sdk, st => st.tick >= until && !st.player?.combat?.inCombat, { maxTicks: COMBAT_LOGOUT_TICKS + 30 });
    }

    session.expectInWorld = false;
    for (let attempt = 0; attempt < 2; attempt++) {
        const clickTick = sdk.getState()?.tick ?? -1;
        void sdk.sendClickComponent(LOGOUT_BUTTON);
        const out = await waitLoggedOutSignal(session, opts.timeoutMs ?? Math.max(5_000, 15 * tickMs()), clickTick);
        if (out === 'refused' && attempt === 0) {
            await waitUntil(sdk, () => false, { maxTicks: COMBAT_LOGOUT_TICKS + 1 });
            continue;
        }
        const lastInWorldTick = session.lastInWorldTick;
        const ok = out === 'out';
        return {
            ok,
            clickTick,
            lastInWorldTick,
            latencyTicks: Math.max(0, lastInWorldTick - clickTick),
            wallMs: Date.now() - t0,
            ...(ok ? {} : { reason: out === 'refused' ? 'logout refused (combat)' : 'still in game after timeout' }),
        };
    }
    throw new Error('unreachable');
}

async function waitLoggedOutSignal(session: Session, timeoutMs: number, clickTick: number): Promise<'out' | 'refused' | 'timeout'> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const s = session.sdk.getState();
        if (s?.gameMessages.some(m => CANT_LOGOUT.test(m.text) && m.tick >= clickTick)) return 'refused';
        if (await isLoggedOut(session)) return 'out';
        await sleep(Math.min(100, tickMs() / 3));
    }
    return 'timeout';
}

/** True once the account has left the world, by the client's own exit or the gateway. */
export async function isLoggedOut(session: Session): Promise<boolean> {
    if (session.client === 'lite' && session.child) return session.childExit !== null;
    const s = session.sdk.getState();
    if (s && !s.inGame) return true;
    const status = await gatewayStatus(session);
    return status?.status === 'dead' || status?.inGame === false;
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

/**
 * Relaunch the client after a logout and wait for an advancing tick.
 *
 * A login seconds after a logout can be accepted by the login thread and then
 * dropped by the world while the old session's save is still flushing
 * (World.ts: "old session is mid-logout"); the lite client then ends its
 * session at once. So a client that exits before its first in-world tick is
 * relaunched with backoff, up to `attempts` times.
 */
export async function login(session: Session, opts: { timeoutMs?: number; attempts?: number } = {}): Promise<{ wallMs: number; attempts: number }> {
    const t0 = Date.now();
    const deadline = t0 + (opts.timeoutMs ?? 90_000);
    const maxAttempts = opts.attempts ?? 6;
    for (let attempt = 1; ; attempt++) {
        const sinceTick = session.lastInWorldTick;
        const sinceAdvance = session.lastAdvanceAt;
        await launchClient(session);
        const outcome = await waitInWorldOrExit(session, sinceTick, sinceAdvance, Math.max(1_000, deadline - Date.now()));
        if (outcome === 'in-world') {
            session.expectInWorld = true;
            session.watchdog?.resume();
            return { wallMs: Date.now() - t0, attempts: attempt };
        }
        if (outcome === 'timeout' || attempt >= maxAttempts || session.childExit === 3) {
            throw new Error(`${session.name}: login failed after ${attempt} attempt(s) (${outcome}, exit ${session.childExit})`);
        }
        await sleep(backoffMs(attempt));
    }
}

/** Resolve once the tick advances past what was seen before the launch, or the lite child exits. */
async function waitInWorldOrExit(session: Session, sinceTick: number, sinceAdvance: number, ms: number): Promise<'in-world' | 'exited' | 'timeout'> {
    const deadline = Date.now() + ms;
    let firstTick: number | null = null;
    while (Date.now() < deadline) {
        if (session.client === 'lite' && session.childExit !== null) return 'exited';
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
    /** Lite child exit code, null while running or for the browser. */
    childExit: number | null;
    nextAttemptAt: number;
    /** A clean logout was already tried during the current wedge and not confirmed. */
    logoutFailed: boolean;
    /** Wall ms since the bot's last markProgress, and the limit; null when progress is not tracked. */
    msSinceProgress: number | null;
    progressStaleMs: number | null;
}

/**
 * - `logout`: the client is wedged but its process is alive. Log out cleanly
 *   (the player leaves on the next tick), then log back in.
 * - `relaunch`: the client is gone (or would not log out). Launch a fresh one;
 *   its login takes the session over in the engine (World.ts "kick the existing
 *   session"), which is the only way out faster than the 500/1000-tick timeouts.
 * - `stop`: the client is healthy but the bot stopped making progress. Log out
 *   cleanly and stay out: a live client keeps an idle player in the world forever.
 */
export type WatchdogVerdict = 'ok' | 'wait' | 'logout' | 'relaunch' | 'stop' | 'give_up';

/**
 * Pure decision. While the account should be in the world: a lite child that
 * exited gets a relaunch; a stale tick or a dead/stale gateway with the client
 * still running gets a clean logout first, and a relaunch only if that logout
 * was not confirmed; a stalled bot gets a stop. Never relaunch after exit code
 * 3 (outdated client); relaunches respect the backoff window, a logout does not.
 */
export function watchdogDecision(i: WatchdogInputs): WatchdogVerdict {
    if (i.paused || !i.expectInWorld) return 'ok';
    if (i.childExit === 3) return 'give_up';
    const relaunch = i.now >= i.nextAttemptAt ? 'relaunch' : 'wait';
    if (i.childExit !== null) return relaunch;
    // A client that is still logging in is not stale; only its exit counts.
    if (!i.tickedSinceLaunch && i.msSinceLaunch < i.launchGraceMs) return 'ok';
    const wedged = i.msSinceAdvance > i.staleMs || i.gateway === 'dead' || i.gateway === 'stale';
    if (wedged) return i.logoutFailed ? relaunch : 'logout';
    if (i.progressStaleMs !== null && i.msSinceProgress !== null && i.msSinceProgress > i.progressStaleMs) return 'stop';
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
}

const liveActions: WatchdogActions = {
    logout: (session, timeoutMs) => logoutClean(session, { timeoutMs }),
    login: session => login(session),
    relaunch: async session => {
        await killChild(session);
        await launchClient(session);
    },
};

export interface WatchdogOptions {
    /** Ticks without an advancing in-world tick before the client counts as wedged (default 10). */
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
    const staleMs = (opts.staleTicks ?? 10) * tickMs();
    const launchGraceMs = opts.launchGraceMs ?? 30_000;
    const logoutTimeoutMs = opts.logoutTimeoutMs ?? Math.max(2_000, 8 * tickMs());
    const progressStaleMs = opts.progressStaleTicks === undefined ? null : opts.progressStaleTicks * tickMs();
    const actions: WatchdogActions = { ...liveActions, ...opts.actions };
    let paused = false;
    let stopped = false;
    let gaveUp = false;
    let relaunches = 0;
    let logouts = 0;
    let attempt = 0;
    let nextAttemptAt = 0;
    let logoutFailed = false;
    let busy = false;
    let gateway: BotStatus['status'] | null = null;
    let lastGatewayPoll = 0;

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
                gateway = (await gatewayStatus(session))?.status ?? null;
            }
            const msSinceAdvance = Date.now() - session.lastAdvanceAt;
            const verdict = watchdogDecision({
                expectInWorld: session.expectInWorld, paused, now: Date.now(), msSinceAdvance, staleMs,
                msSinceLaunch: Date.now() - session.launchedAt, tickedSinceLaunch: session.lastAdvanceAt > session.launchedAt, launchGraceMs,
                gateway, childExit: session.child ? session.childExit : null, nextAttemptAt, logoutFailed,
                msSinceProgress: progressStaleMs === null ? null : Date.now() - session.lastProgressAt, progressStaleMs,
            });
            if (verdict === 'ok') {
                if (msSinceAdvance < staleMs) {
                    attempt = 0;
                    logoutFailed = false;
                }
                return;
            }
            emit(verdict, `childExit=${session.childExit} sinceAdvance=${msSinceAdvance}ms gateway=${gateway}`);
            if (verdict === 'give_up') {
                gaveUp = true;
                return;
            }
            if (verdict === 'logout' || verdict === 'stop') {
                logouts++;
                const out = await actions.logout(session, logoutTimeoutMs);
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
            session.lastProgressAt = Date.now();
        },
        check,
        get relaunches() {
            return relaunches;
        },
        get logouts() {
            return logouts;
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
