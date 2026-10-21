// Sessions: open a controlled SDK connection, launch the game client (lite or
// browser), log out cleanly, log back in, and a watchdog that relaunches a
// client that died or went stale.
//
// Why explicit logout matters: the hiscore clock counts ticks in the world. A
// logout click outside combat removes the player in the same tick. A dropped
// connection leaves the player in the world until the 500-tick no-connection
// timeout (1000 with no response), so it is never used as a way to leave.
//
// The lite runner exits with code 1 when its game session ends and never
// re-logs itself; code 3 means the client revision is outdated and a relaunch
// cannot help. The SDK reconnects to the gateway but never relaunches a client,
// which is the watchdog's job here.

import { existsSync, mkdirSync, readFileSync } from 'fs';
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
        watchdog: null,
        logPath: join(logDir, `${env.BOT_USERNAME}-${opts.client ?? 'lite'}.log`),
    };
    sdk.onStateUpdate(s => track(session, s));
    if (opts.launch) await launchClient(session);
    await sdk.connect();
    await waitAdvancingTick(session, opts.readyTimeoutMs ?? 120_000);
    return session;
}

function track(session: Session, s: BotWorldState): void {
    if (!s.inGame) return;
    if (s.tick !== session.lastInWorldTick) {
        session.lastInWorldTick = s.tick;
        session.lastAdvanceAt = Date.now();
    }
}

/** Wait until the client publishes in-game state with a tick that advances. */
export async function waitAdvancingTick(session: Session, timeoutMs: number): Promise<BotWorldState> {
    const first = await waitFor(session.sdk, s => s.inGame, timeoutMs);
    if (!first) throw new Error(`${session.name}: no in-game state within ${timeoutMs} ms`);
    const t = first.tick;
    const next = await waitFor(session.sdk, s => s.inGame && s.tick !== t, Math.max(5_000, 20 * tickMs()));
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
    session.lastAdvanceAt = Date.now();
    if (session.client === 'lite') {
        const child = Bun.spawn(['bun', 'src/lite/runner.ts', session.name], {
            cwd: join(ROOT, 'server', 'webclient'),
            stdout: Bun.file(session.logPath),
            stderr: 'inherit',
            env: { ...process.env },
        });
        session.child = child;
        void child.exited.then(code => {
            if (session.child === child) session.childExit = code;
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

/** Relaunch the client after a logout and wait for an advancing tick. */
export async function login(session: Session, opts: { timeoutMs?: number } = {}): Promise<{ wallMs: number }> {
    const t0 = Date.now();
    await launchClient(session);
    await waitAdvancingTick(session, opts.timeoutMs ?? 60_000);
    session.expectInWorld = true;
    session.watchdog?.resume();
    return { wallMs: Date.now() - t0 };
}

// ---------------------------------------------------------------- watchdog

export interface WatchdogInputs {
    expectInWorld: boolean;
    paused: boolean;
    now: number;
    /** Wall ms since the in-game tick last advanced. */
    msSinceAdvance: number;
    staleMs: number;
    gateway: BotStatus['status'] | null;
    /** Lite child exit code, null while running or for the browser. */
    childExit: number | null;
    nextAttemptAt: number;
}

export type WatchdogVerdict = 'ok' | 'wait' | 'relaunch' | 'give_up';

/**
 * Pure staleness decision. Relaunch when the account should be in the world
 * and the tick stopped advancing, the gateway reports the bot dead or stale,
 * or the lite child exited. Never relaunch after exit code 3 (outdated
 * client); respect the backoff window between attempts.
 */
export function watchdogDecision(i: WatchdogInputs): WatchdogVerdict {
    if (i.paused || !i.expectInWorld) return 'ok';
    if (i.childExit === 3) return 'give_up';
    const unhealthy = i.childExit !== null || i.msSinceAdvance > i.staleMs || i.gateway === 'dead' || i.gateway === 'stale';
    if (!unhealthy) return 'ok';
    return i.now >= i.nextAttemptAt ? 'relaunch' : 'wait';
}

/** Backoff after the n-th consecutive relaunch: 1 s, 2 s, 4 s, ... capped at 30 s. */
export function backoffMs(attempt: number): number {
    return Math.min(30_000, 1_000 * 2 ** Math.max(0, attempt - 1));
}

export interface Watchdog {
    stop(): void;
    pause(): void;
    resume(): void;
    readonly relaunches: number;
    readonly gaveUp: boolean;
}

export interface WatchdogEvent {
    at: number;
    verdict: WatchdogVerdict;
    reason: string;
    sessionId: number;
}

export function startWatchdog(session: Session, opts: { staleTicks?: number; onEvent?: (e: WatchdogEvent) => void } = {}): Watchdog {
    const staleMs = (opts.staleTicks ?? 10) * tickMs();
    let paused = false;
    let stopped = false;
    let gaveUp = false;
    let relaunches = 0;
    let attempt = 0;
    let nextAttemptAt = 0;
    let busy = false;
    let gateway: BotStatus['status'] | null = null;
    let lastGatewayPoll = 0;

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
            const verdict = watchdogDecision({ expectInWorld: session.expectInWorld, paused, now: Date.now(), msSinceAdvance, staleMs, gateway, childExit: session.child ? session.childExit : null, nextAttemptAt });
            if (verdict === 'ok') {
                if (msSinceAdvance < staleMs) attempt = 0;
                return;
            }
            const reason = `childExit=${session.childExit} sinceAdvance=${msSinceAdvance}ms gateway=${gateway}`;
            opts.onEvent?.({ at: Date.now(), verdict, reason, sessionId: session.sessionId });
            if (verdict === 'give_up') {
                gaveUp = true;
                return;
            }
            if (verdict === 'relaunch') {
                attempt++;
                relaunches++;
                nextAttemptAt = Date.now() + backoffMs(attempt);
                await killChild(session);
                await launchClient(session);
                gateway = null;
                lastGatewayPoll = Date.now() + 5_000; // let the new client register before polling
            }
        } finally {
            busy = false;
        }
    };
    const timer = setInterval(() => void check(), Math.max(100, tickMs()));
    const wd: Watchdog = {
        stop: () => {
            stopped = true;
            clearInterval(timer);
        },
        pause: () => {
            paused = true;
        },
        resume: () => {
            paused = false;
            session.lastAdvanceAt = Date.now();
        },
        get relaunches() {
            return relaunches;
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
