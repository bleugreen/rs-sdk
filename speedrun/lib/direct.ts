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

export interface DirectLogoutOptions {
    /** Wall-clock bound on the whole logout, clicks and retries included. Default max(10 s, 40 ticks). */
    timeoutMs?: number;
    /** Re-click when this many ticks pass with the player still in (the server refused: combat). Default 17. */
    retryTicks?: number;
}

export interface DirectLogoutResult {
    /** The server took the player out: it sent LOGOUT, or it closed the socket after the click. */
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
    /** Resolve once the label has moved `n` ticks. */
    waitTicks(n: number): Promise<void>;
    /**
     * Leave the world and end the session: click logout, wait for the server's LOGOUT (or its
     * close of the socket), re-click while it refuses, then close. Always closes, confirmed or
     * not; calling it again returns the first call's result.
     */
    logout(opts?: DirectLogoutOptions): Promise<DirectLogoutResult>;
    /** Close the socket without logging out: the server sees a dropped client. Prefer logout(). */
    close(): void;
}

/** The engine connection under a direct session: its websocket, and who closed it. */
export interface DirectConnection {
    readonly socket: { addEventListener(type: 'message' | 'close', listener: () => void): void };
    /** Closed by us or hung up on by the server. */
    readonly isClosed: boolean;
    close(): void;
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
    const conn: DirectConnection = {
        socket: connection.stream.socket as WebSocket,
        get isClosed() {
            return connection.isClosed;
        },
        close: () => connection.close(),
    };
    return startDirectSession(conn, client, { host: opts.host, origin, noTimeoutOpcode: ClientProt.NO_TIMEOUT });
}

/**
 * The session core over a logged-in client: pump on every socket message, keepalives, tick
 * waits, and the clean logout. `openDirectSession` calls it after login; tests drive it with
 * a scripted socket and client.
 */
export function startDirectSession(conn: DirectConnection, client: DirectSessionClient, opts: { host: string; origin: string; noTimeoutOpcode: number }): DirectSession {
    let lastArrival = performance.now();
    const sdk = directProbeSdk(client, () => lastArrival);
    // Called after every drain and on socket close, for waits on non-tick events (LOGOUT).
    const watchers = new Set<() => void>();
    const notify = () => {
        for (const w of [...watchers]) w();
    };

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
            notify();
        }
    };
    conn.socket.addEventListener('message', () => {
        lastArrival = performance.now();
        void pump();
    });
    conn.socket.addEventListener('close', notify);
    const keepalive = setInterval(() => {
        client.writeOpcode(opts.noTimeoutOpcode);
        client.flush();
    }, 1000);
    void pump();

    let closedByUs = false;
    const close = () => {
        clearInterval(keepalive);
        closedByUs = true;
        conn.close();
    };
    const label = () => sdk.getState()?.tick ?? 0;
    const outcome = (): DirectLogoutResult['via'] => (client.isLoggedOut() ? 'logout' : conn.isClosed && !closedByUs ? 'server-close' : null);

    /** Resolve true once `done()` holds after a drain, tick or close; false at `deadline`. */
    const until = (done: () => boolean, deadline: number) =>
        new Promise<boolean>(resolve => {
            if (done()) return resolve(true);
            const finish = (v: boolean) => {
                clearTimeout(timer);
                watchers.delete(check);
                offTick();
                resolve(v);
            };
            const check = () => {
                if (done()) finish(true);
            };
            const timer = setTimeout(() => finish(done()), Math.max(0, deadline - performance.now()));
            watchers.add(check);
            const offTick = sdk.onStateUpdate(check);
        });

    const runLogout = async (lo: DirectLogoutOptions): Promise<DirectLogoutResult> => {
        const t0 = performance.now();
        const deadline = t0 + (lo.timeoutMs ?? Math.max(10_000, 40 * tickMs()));
        const retryTicks = lo.retryTicks ?? COMBAT_LOGOUT_TICKS + 1;
        const clickTick = label();
        const result = (via: DirectLogoutResult['via'], clicks: number, reason?: string): DirectLogoutResult => {
            close();
            return { ok: via !== null, via, clicks, clickTick, endTick: label(), wallMs: performance.now() - t0, ...(reason ? { reason } : {}) };
        };
        if (client.isLoggedOut()) return result('logout', 0);
        if (conn.isClosed) return result(null, 0, closedByUs ? 'already closed' : 'socket closed by the server before the logout');
        if (!client.isInGame()) return result(null, 0, 'not in game');
        let clicks = 0;
        while (performance.now() < deadline) {
            // The server ignores a click inside the post-combat window (logout.rs2), so keep
            // clicking every retryTicks until it takes or the deadline passes.
            if (client.clickComponent(LOGOUT_BUTTON)) clicks++;
            client.flush();
            const sent = label();
            await until(() => outcome() !== null || label() >= sent + retryTicks, deadline);
            const via = outcome();
            if (via) return result(via, clicks);
        }
        return result(null, clicks, `still in the world after ${Math.round(performance.now() - t0)} ms`);
    };
    let logout: Promise<DirectLogoutResult> | null = null;

    return {
        host: opts.host,
        origin: opts.origin,
        sdk,
        client,
        waitTicks: n =>
            new Promise<void>(resolve => {
                const target = label() + n;
                const off = sdk.onStateUpdate(s => {
                    if (s.tick < target) return;
                    off();
                    resolve();
                });
            }),
        logout: (lo = {}) => (logout ??= runLogout(lo)),
        close,
    };
}
