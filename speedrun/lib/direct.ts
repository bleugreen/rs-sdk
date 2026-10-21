// The direct path for the host gate's probe: a lite client on the engine websocket, in this
// process, with no runner or gateway in between (tick-manipulation.md, "Run-time host gate").
// `directProbeSdk` gives `probeOnTime` the same surface the SDK does (`getState`,
// `onStateUpdate`, `sendWalk`) and marks it `path: 'direct'`. A walk goes out inside the
// tick callback, so it leaves within a millisecond of the tick's frame being decoded.
//
// The session core comes from `openSession` in docs/speedrun/scripts/demo-latency-probe.ts
// (cairn://p/rs/85, cairn://p/rs/86), which measured this path at 60 of 60 on time from
// Azure eastus. It pumps the client on every websocket message instead of session.ts's 20 ms
// poll.
//
// A direct session ends with `logout()`, never a bare close: a closed socket leaves the
// player in the world for 500 ticks on the server's dropped-client path (session.ts header).
//
// Root tsconfig excludes server/webclient and cannot resolve its `#/` import aliases, so the
// lite client is loaded with computed specifiers and typed here by the members used.

import type { ProbeSdk, ProbeState } from './hostgate';
import { COMBAT_LOGOUT_TICKS, LOGOUT_BUTTON } from './session';
import { tickMs } from './wait';

/** The LiteClient members the adapter uses. */
export interface DirectClient {
    setOnGameTickCallback(cb: ((ticks: number) => void) | null): void;
    getPlayerPosition(): { worldX: number; worldZ: number } | null;
    isInGame(): boolean;
    walkTo(worldX: number, worldZ: number, running?: boolean): { moved: boolean };
    flush(): void;
}

/** The rest of LiteClient a direct session drives: the pump, keepalives and lab setup. */
export interface DirectSessionClient extends DirectClient {
    pumpPackets(): Promise<void>;
    tickCycle(): void;
    writeOpcode(opcode: number): void;
    say(message: string): unknown;
    isModalOpen(): boolean;
    getModalInterface(): number;
    acceptCharacterDesign(): boolean;
    /** Queue IF_BUTTON for `componentId`; false when not in game. */
    clickComponent(componentId: number): boolean;
    /** The server sent LOGOUT (as opposed to the socket dying). */
    isLoggedOut(): boolean;
}

export interface DirectProbeSdk extends ProbeSdk {
    readonly path: 'direct';
}

/**
 * Publish a state per decoded drain of server ticks. The label counts PLAYER_INFOs from the
 * adapter's creation, so it moves like the SDK's `state.tick` (a drain that held two ticks
 * moves it by two). `arrival` returns when the socket message being drained arrived
 * (`performance.now()`), stamped on the state as `arrivalMs` so the probe scores steadiness
 * from arrivals rather than decode times. Takes over the client's game-tick callback.
 */
export function directProbeSdk(client: DirectClient, arrival?: () => number): DirectProbeSdk {
    const listeners = new Set<(s: ProbeState) => void>();
    let state: ProbeState | null = null;
    let label = 0;
    client.setOnGameTickCallback(n => {
        label += n;
        const p = client.getPlayerPosition();
        state = { tick: label, inGame: client.isInGame(), player: p ? { worldX: p.worldX, worldZ: p.worldZ } : null, ...(arrival ? { arrivalMs: arrival() } : {}) };
        for (const l of [...listeners]) l(state);
    });
    return {
        path: 'direct',
        getState: () => state,
        onStateUpdate(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        sendWalk(x, z, running = false) {
            const r = client.walkTo(x, z, running);
            client.flush();
            return Promise.resolve({ success: r.moved, message: r.moved ? 'walk sent' : 'no path' });
        },
    };
}

export interface DirectSessionOptions {
    /** Game host as in bot.env SERVER: `rs-sdk-demo.fly.dev`, or `localhost:8960` for a lab. */
    host: string;
    username: string;
    password: string;
    /** Default: TLS unless the host is localhost or 127.x (as the lite session decides). */
    secured?: boolean;
    cacheDir?: string;
}

/**
 * How a direct session ended. `logged-out`: the server sent LOGOUT. `disconnected`: the
 * server hung up. `closed`: this process closed the socket.
 */
export interface DirectSessionEnd {
    reason: 'logged-out' | 'disconnected' | 'closed' | (string & {});
    error?: unknown;
}

export interface DirectLogoutOptions {
    /** Wall-clock bound on the whole logout, clicks and retries included. Default max(10 s, 40 ticks). */
    timeoutMs?: number;
    /** Re-click when this many ticks pass with the player still in (the server refused: combat). Default 17. */
    retryTicks?: number;
}

export interface DirectLogoutResult {
    /** The server took the player out: it sent LOGOUT, or it hung up after the click. */
    ok: boolean;
    via: 'logout' | 'server-close' | null;
    /** Logout clicks sent (more than one when the server refused the first). */
    clicks: number;
    /** Session tick label at the first click, and when the outcome was seen. */
    clickTick: number;
    endTick: number;
    wallMs: number;
    reason?: string;
}

export interface DirectSession {
    readonly host: string;
    /** `https://host` or `http://host`: where the cache and `/playercount` are served. */
    readonly origin: string;
    readonly sdk: DirectProbeSdk;
    readonly client: DirectSessionClient;
    /** Resolves once, when the session ends, with how it ended. */
    readonly ended: Promise<DirectSessionEnd>;
    /** Resolve once the label has moved `n` ticks. */
    waitTicks(n: number): Promise<void>;
    /** Leave the world, then close (`logoutDirect`). Calling it again returns the first call's result. */
    logout(opts?: DirectLogoutOptions): Promise<DirectLogoutResult>;
    /** Close the socket without logging out: the server sees a dropped client. Prefer logout(). */
    close(): void;
}

/** What the logout sequence needs from a session. */
export interface DirectLogoutTarget {
    readonly sdk: Pick<ProbeSdk, 'getState' | 'onStateUpdate'>;
    readonly client: Pick<DirectSessionClient, 'clickComponent' | 'flush' | 'isInGame'>;
    readonly ended: Promise<DirectSessionEnd>;
    close(): void;
}

/**
 * Click logout (logout:try_logout) and wait for the session to end: the server's LOGOUT is the
 * confirmation, and a hang-up after the click counts too. The server ignores a click inside
 * the post-combat window (logout.rs2), so the click repeats every `retryTicks` until it
 * lands or `timeoutMs` passes. Always closes the session at the end, confirmed or not.
 */
export async function logoutDirect(s: DirectLogoutTarget, opts: DirectLogoutOptions = {}): Promise<DirectLogoutResult> {
    const t0 = performance.now();
    const deadline = t0 + (opts.timeoutMs ?? Math.max(10_000, 40 * tickMs()));
    const retryTicks = opts.retryTicks ?? COMBAT_LOGOUT_TICKS + 1;
    const label = () => s.sdk.getState()?.tick ?? 0;
    let end: DirectSessionEnd | null = null;
    void s.ended.then(e => (end = e));
    // a session that has already ended resolves first in the race
    end = await Promise.race([s.ended, Promise.resolve(null)]);
    const clickTick = label();
    const result = (via: DirectLogoutResult['via'], clicks: number, reason?: string): DirectLogoutResult => {
        s.close();
        return { ok: via !== null, via, clicks, clickTick, endTick: label(), wallMs: performance.now() - t0, ...(reason ? { reason } : {}) };
    };
    const verdict = (e: DirectSessionEnd, clicks: number) =>
        e.reason === 'logged-out' ? result('logout', clicks) : e.reason === 'disconnected' && clicks > 0 ? result('server-close', clicks) : result(null, clicks, `session ended before a logout: ${e.reason}`);
    if (end) return verdict(end, 0);
    if (!s.client.isInGame()) return result(null, 0, 'not in game');

    let clicks = 0;
    while (performance.now() < deadline) {
        if (s.client.clickComponent(LOGOUT_BUTTON)) clicks++;
        s.client.flush();
        const sent = label();
        await until(s, () => end !== null || label() >= sent + retryTicks, deadline);
        if (end) return verdict(end, clicks);
    }
    return result(null, clicks, `still in the world after ${Math.round(performance.now() - t0)} ms`);
}

/** Resolve once `done()` holds after a tick or the session's end, or at `deadline`. */
function until(s: DirectLogoutTarget, done: () => boolean, deadline: number): Promise<void> {
    return new Promise<void>(resolve => {
        if (done()) return resolve();
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            offTick();
            resolve();
        };
        const check = () => {
            if (done()) finish();
        };
        const timer = setTimeout(finish, Math.max(0, deadline - performance.now()));
        const offTick = s.sdk.onStateUpdate(check);
        // after logoutDirect's own then() on ended, so `end` is set when check runs
        void s.ended.then(() => queueMicrotask(check));
    });
}

/** One line for a logout result, as the probe prints it. */
export function directLogoutText(r: DirectLogoutResult): string {
    const clicks = `${r.clicks} click${r.clicks === 1 ? '' : 's'}, ${Math.round(r.wallMs)} ms`;
    if (r.ok) {
        const how = r.via === 'logout' ? 'server sent LOGOUT' : 'server closed the socket';
        return `out of the world: ${how} ${r.endTick - r.clickTick} tick(s) after the first click (${clicks})`;
    }
    return `NOT CONFIRMED (${r.reason}; ${clicks}): the socket is closed, so the server may hold the player up to 500 ticks`;
}

const LITE = new URL('../../server/webclient/src/lite/', import.meta.url);
const lite = (path: string) => import(new URL(path, LITE).href);

/**
 * Log in with a lite client on the engine websocket and pump it on every socket message.
 * Needs server/webclient's dependencies installed (`cd server/webclient && bun install`).
 * The account must not be logged in elsewhere (a lite runner on the same bot, say).
 */
export async function openDirectSession(opts: DirectSessionOptions): Promise<DirectSession> {
    await lite('dom-shim.ts');
    const [{ loadCache }, { LocIndex }, { GameConnection }, { LiteClient }, { ClientProt }] = await Promise.all([
        lite('cache.ts'),
        lite('world/LocIndex.ts'),
        lite('net/GameConnection.ts'),
        lite('LiteClient.ts'),
        lite('../io/ClientProt.ts'),
    ]);
    const secured = opts.secured ?? !(opts.host.startsWith('localhost') || opts.host.startsWith('127.'));
    const origin = `${secured ? 'https' : 'http'}://${opts.host}`;
    const cacheDir = opts.cacheDir ?? `${process.env.HOME}/.cache/rs-sdk-lite`;
    const { checksums } = await loadCache({ origin, cacheDir, quiet: true });
    const locIndex = await LocIndex.load({ origin, cacheDir, versionlistCrc: checksums[5], quiet: true });
    const connection = await GameConnection.connect({ host: opts.host, secured, username: opts.username, password: opts.password, checksums });
    const client: DirectSessionClient = new LiteClient({ connection, locIndex, username: opts.username, password: opts.password });
    let lastArrival = performance.now();
    const sdk = directProbeSdk(client, () => lastArrival);
    let endWith: (e: DirectSessionEnd) => void = () => {};
    const ended = new Promise<DirectSessionEnd>(resolve => (endWith = resolve));

    // One drain at a time; a message that arrives mid-drain runs another pass after it.
    let pumping = false;
    let again = false;
    const pump = async () => {
        if (pumping) {
            again = true;
            return;
        }
        pumping = true;
        try {
            do {
                again = false;
                await client.pumpPackets();
                client.tickCycle();
                client.flush();
            } while (again);
        } catch (e) {
            console.error('[direct] pump failed', e);
        } finally {
            pumping = false;
            if (client.isLoggedOut()) endWith({ reason: 'logged-out' });
        }
    };
    let closedByUs = false;
    const socket = connection.stream.socket as WebSocket;
    socket.addEventListener('message', () => {
        lastArrival = performance.now();
        void pump();
    });
    socket.addEventListener('close', () => endWith({ reason: client.isLoggedOut() ? 'logged-out' : closedByUs ? 'closed' : 'disconnected' }));
    const keepalive = setInterval(() => {
        client.writeOpcode(ClientProt.NO_TIMEOUT);
        client.flush();
    }, 1000);
    void pump();

    let logout: Promise<DirectLogoutResult> | null = null;
    const session: DirectSession = {
        host: opts.host,
        origin,
        sdk,
        client,
        ended,
        waitTicks: n =>
            new Promise<void>(resolve => {
                const target = (sdk.getState()?.tick ?? 0) + n;
                const off = sdk.onStateUpdate(s => {
                    if (s.tick < target) return;
                    off();
                    resolve();
                });
            }),
        logout: lo => (logout ??= logoutDirect(session, lo)),
        close: () => {
            clearInterval(keepalive);
            closedByUs = true;
            connection.close();
            endWith({ reason: 'closed' });
        },
    };
    return session;
}
