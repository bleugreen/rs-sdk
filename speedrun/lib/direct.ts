// The direct path: a lite client on the engine websocket, in this process, with no runner or
// gateway between it and the code that drives it (tick-manipulation.md, "Run-time host gate";
// docs/speedrun/helpers/altar-giver.md, "The direct path").
//
// One session, two surfaces:
// - `sdk` (`directProbeSdk`): the host gate probe's surface (`getState`, `onStateUpdate`,
//   `sendWalk`), labelled per PLAYER_INFO and stamped with socket arrival times. It costs
//   nothing per tick, so the probe measures the bare client.
// - `connectSdk()`: a real BotSDK and BotActions whose socket is a `DirectBridge` in this
//   process. On every decoded tick the bridge collects `LiteClient.collectBotState(tick)` and
//   hands it to the SDK before the client's tick callback returns. An action the SDK sends
//   from a state listener runs through `LiteClient.executeBotAction()` and is flushed to the
//   engine inside that same callback. A role written against the SDK runs unchanged and
//   reacts on the frame it sees, without the four loopback hops of the relay
//   (lite runner -> gateway -> SDK -> gateway -> lite runner).
//
// A direct session ends with `logout()`, never a bare close: a closed socket leaves the
// player in the world for 500 ticks on the server's dropped-client path (session.ts header).
//
// The session itself is the lite runner's (server/webclient/src/lite/session.ts): it drains
// the socket the moment a message arrives, keeps the connection alive, and reports why it
// ended. Root tsconfig excludes server/webclient and cannot resolve its `#/` import aliases,
// so those modules are loaded with computed specifiers and typed here by the members used.

import { BotActions } from '../../sdk/actions';
import { BotSDK } from '../../sdk/index';
import type { ActionResult, BotAction, BotWorldState } from '../../sdk/types';
import type { ProbeSdk, ProbeState } from './hostgate';
import { LOGOUT_BUTTON } from './session';
import { COMBAT_LOGOUT_TICKS } from './world';
import { tickMs } from './wait';

/** The LiteClient members the probe adapter uses. */
export interface DirectClient {
    setOnGameTickCallback(cb: ((ticks: number) => void) | null): void;
    getPlayerPosition(): { worldX: number; worldZ: number } | null;
    isInGame(): boolean;
    walkTo(worldX: number, worldZ: number, running?: boolean): { moved: boolean };
    flush(): void;
}

/** The LiteClient members the SDK bridge uses. */
export interface DirectBotClient {
    collectBotState(serverTick: number): BotWorldState;
    executeBotAction(action: BotAction): ActionResult | Promise<ActionResult>;
    flush(): void;
    getMaxMessageLength(): number;
}

/** The rest of LiteClient a direct session's callers use: lab setup on a first login. */
export interface DirectSessionClient extends DirectClient, DirectBotClient {
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

// ------------------------------------------------------------------ the SDK bridge

/** An action waiting for, or holding, the client. */
export interface QueuedAction {
    action: BotAction;
    actionId: string | null;
}

/** server/webclient/src/bot/ActionQueue.ts's BotActionQueue, typed by the members used. */
export interface DirectActionQueue {
    enqueue(entry: QueuedAction, ttlMs?: number): QueuedAction | null;
    expirePending(): QueuedAction[];
    expireActive(): QueuedAction | null;
    startNext(): QueuedAction | null;
    readonly active: QueuedAction | null;
    complete(entry: QueuedAction): boolean;
    clear(): void;
}

/** Paces `wait` actions and queue expiry in browser draw-loop frames, as the lite runner does. */
const FRAME_MS = 20;
const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 3;

type Listener = (ev: { type: string; data?: string; code?: number }) => void;

/**
 * The BotSDK's end of the bridge: the subset of the WebSocket API BotSDK uses. Messages are
 * the gateway's SDK protocol as JSON text, so the SDK parses them exactly as it parses the
 * gateway's. Delivery is synchronous, which is the point of the direct path.
 */
class DirectSocket {
    readyState = CONNECTING;
    onopen: Listener | null = null;
    onmessage: Listener | null = null;
    onclose: Listener | null = null;
    onerror: Listener | null = null;
    private readonly listeners = new Map<string, Map<Listener, boolean>>();

    constructor(private readonly bridge: DirectBridge) {
        queueMicrotask(() => {
            if (this.readyState !== CONNECTING) return;
            this.readyState = OPEN;
            this.emit({ type: 'open' });
        });
    }

    send(data: string): void {
        if (this.readyState === OPEN) this.bridge.receive(this, JSON.parse(data));
    }

    close(): void {
        if (this.readyState === CLOSED) return;
        this.readyState = CLOSED;
        this.bridge.detach(this);
        queueMicrotask(() => this.emit({ type: 'close', code: 1000 }));
    }

    addEventListener(type: string, listener: Listener, opts?: { once?: boolean }): void {
        let m = this.listeners.get(type);
        if (!m) this.listeners.set(type, (m = new Map()));
        m.set(listener, opts?.once === true);
    }

    removeEventListener(type: string, listener: Listener): void {
        this.listeners.get(type)?.delete(listener);
    }

    deliver(data: string): void {
        if (this.readyState === OPEN) this.emit({ type: 'message', data });
    }

    private emit(ev: { type: string; data?: string; code?: number }): void {
        const handler = (this as unknown as Record<string, Listener | null>)[`on${ev.type}`];
        const listeners = this.listeners.get(ev.type);
        for (const l of [...(handler ? [handler] : []), ...(listeners?.keys() ?? [])]) {
            if (listeners?.get(l)) listeners.delete(l);
            try {
                l(ev);
            } catch (e) {
                console.error('[direct] socket listener failed', e);
            }
        }
    }
}

/**
 * The gateway and the lite runner in one object, for BotSDKs in this process. Feed it the
 * client's game ticks with `onTick`, and give `openSocket` to a BotSDK as its socket.
 *
 * On a tick it collects the client's state and delivers it to every SDK synchronously, so
 * state listeners run inside the tick callback. Actions run one at a time in arrival order
 * (the lite runner's BotActionQueue), each flushed to the engine as soon as it has run, so an
 * action sent from a state listener is on the wire before the tick callback returns. The
 * state that follows an action, and action results, are delivered after the current call
 * stack (a microtask), never re-entering a listener that is still running.
 */
export class DirectBridge {
    private serverTick = 0;
    private readonly sockets = new Set<DirectSocket>();
    private last: { state: BotWorldState; at: number } | null = null;
    private waitFrames = 0;
    private frames: ReturnType<typeof setInterval> | null = null;
    private republish = false;

    constructor(
        private readonly client: DirectBotClient,
        private readonly queue: DirectActionQueue,
        private readonly frameMs = FRAME_MS
    ) {}

    /** The client's game-tick callback: one state per decoded drain, as the lite runner publishes. */
    onTick(ticks: number): void {
        this.serverTick += ticks;
        if (this.sockets.size) this.publish();
    }

    /** `SDKConfig.openSocket` for a BotSDK on this client. */
    readonly openSocket = (_url: string): WebSocket => {
        const socket = new DirectSocket(this);
        this.sockets.add(socket);
        this.frames ??= setInterval(() => this.frame(), this.frameMs);
        return socket as unknown as WebSocket;
    };

    /** Close every SDK socket (each SDK sees a disconnect) and drop queued work. */
    close(): void {
        for (const s of [...this.sockets]) s.close();
        this.queue.clear();
        this.waitFrames = 0;
    }

    /** @internal A message from an SDK. */
    receive(socket: DirectSocket, msg: { type?: string; action?: BotAction; actionId?: string; actionTimeoutMs?: number; mode?: string; screenshotId?: string }): void {
        if (msg.type === 'sdk_connect') {
            queueMicrotask(() => {
                socket.deliver(JSON.stringify({ type: 'sdk_connected', success: true, mode: msg.mode ?? 'control', otherControllers: 0, maxMessageLength: this.client.getMaxMessageLength() }));
                if (this.last) socket.deliver(JSON.stringify({ type: 'sdk_state', state: this.last.state, stateReceivedAt: this.last.at }));
            });
        } else if (msg.type === 'sdk_action' && msg.action) {
            this.onAction(msg.action, msg.actionId ?? null, msg.actionTimeoutMs);
        } else if (msg.type === 'sdk_screenshot_request') {
            // Headless, as the lite runner answers: no canvas.
            queueMicrotask(() => socket.deliver(JSON.stringify({ type: 'sdk_screenshot_response', screenshotId: msg.screenshotId, dataUrl: '' })));
        }
    }

    /** @internal */
    detach(socket: DirectSocket): void {
        this.sockets.delete(socket);
        if (this.sockets.size === 0 && this.frames) {
            clearInterval(this.frames);
            this.frames = null;
        }
    }

    private publish(): void {
        const state = this.client.collectBotState(this.serverTick);
        const at = Date.now();
        this.last = { state, at };
        const data = JSON.stringify({ type: 'sdk_state', state, stateReceivedAt: at });
        for (const s of [...this.sockets]) s.deliver(data);
    }

    private publishSoon(): void {
        if (this.republish) return;
        this.republish = true;
        queueMicrotask(() => {
            this.republish = false;
            if (this.sockets.size) this.publish();
        });
    }

    private result(actionId: string | null, result: ActionResult): void {
        if (!actionId) return;
        const data = JSON.stringify({ type: 'sdk_action_result', actionId, result });
        queueMicrotask(() => {
            for (const s of [...this.sockets]) s.deliver(data);
        });
    }

    private onAction(action: BotAction, actionId: string | null, actionTimeoutMs?: number): void {
        const ttl = actionTimeoutMs === undefined ? undefined : Math.max(0, actionTimeoutMs - 1_000);
        if (!this.queue.enqueue({ action, actionId }, ttl)) {
            this.result(actionId, { success: false, message: 'Action queue is full', phase: 'validation', reason: 'busy' } as ActionResult);
            return;
        }
        this.startQueued();
    }

    /** Run queued actions until one is still in flight (an async action or a `wait`). */
    private startQueued(): void {
        while (this.waitFrames === 0 && !this.queue.active) {
            const q = this.queue.startNext();
            if (!q) return;
            let r: ActionResult | Promise<ActionResult>;
            try {
                r = this.client.executeBotAction(q.action);
            } catch (e) {
                this.flush();
                this.finish(q, executionError(e));
                continue;
            }
            this.flush();
            if (r instanceof Promise) {
                r.catch(executionError).then(res => {
                    this.flush();
                    this.finish(q, res);
                    this.startQueued();
                });
                return;
            }
            if (q.action.type === 'wait' && r.success) {
                this.waitFrames = (q.action as { ticks?: number }).ticks || 1;
                return;
            }
            this.finish(q, r);
        }
    }

    /** One draw-loop frame: expire queued work the SDK has given up on, count down a `wait`. */
    private frame(): void {
        for (const q of this.queue.expirePending()) {
            this.result(q.actionId, { success: false, message: `Action expired in queue: ${q.action.type}`, phase: 'validation', reason: 'queue_expired' } as ActionResult);
        }
        const stuck = this.queue.expireActive();
        if (stuck) {
            this.result(stuck.actionId, { success: false, message: `Action expired while active: ${stuck.action.type}`, phase: 'completion', reason: 'queue_expired' } as ActionResult);
            this.waitFrames = 0;
        }
        if (this.waitFrames > 0 && --this.waitFrames === 0 && this.queue.active) {
            this.finish(this.queue.active, { success: true, message: 'Wait complete', phase: 'completion' } as ActionResult);
        }
        this.startQueued();
    }

    private finish(q: QueuedAction, result: ActionResult): void {
        if (!this.queue.complete(q)) return;
        this.result(q.actionId, result);
        this.publishSoon();
    }

    private flush(): void {
        try {
            this.client.flush();
        } catch {
            // A write failure leaves the bytes queued; the session loop's own flush ends the session with a reason.
        }
    }
}

function executionError(e: unknown): ActionResult {
    return { success: false, message: `Error: ${e}`, phase: 'completion', reason: 'execution_error' } as ActionResult;
}

// ------------------------------------------------------------------ the session

export interface DirectSessionOptions {
    /** Game host as in bot.env SERVER: `rs-sdk-demo.fly.dev`, or `localhost:8960` for a lab. */
    host: string;
    username: string;
    password: string;
    /** Default: TLS unless the host is localhost or 127.x (as the lite session decides). */
    secured?: boolean;
    cacheDir?: string;
    /** Local chat censoring, as bot.env PROFANITY_FILTER sets it for the lite runner. */
    profanityFilter?: boolean;
}

/**
 * How a direct session ended. `logged-out`: the server sent LOGOUT. `disconnected`: the
 * server hung up. `closed`: this process closed the socket. `idle`, `error`: the lite session's.
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
    /** The server answered a click with its can't-log-out message (combat). Only the relay's logout reads chat. */
    refused?: boolean;
}

/**
 * What a logout came to. `out`: the server removed the player. `queued`: the click went out on
 * a live session that kept receiving ticks, so the server has it and will remove the player on
 * its turn, even after the socket closes. The demo removes at most one logging-out player per
 * tick across the whole world, lowest player slot first (World.processLogouts: each removal is
 * a whole-world checkpoint inside a 50 ms budget), so with ~1,700 players online a clicked
 * account can wait minutes. `unconfirmed`: nothing shows the click was served (no ticks after
 * it, a refusal, or no click), so the player may be held until the server times it out.
 */
export type LogoutOutcome = 'out' | 'queued' | 'unconfirmed';

/** Ticks served after the first click before an unconfirmed logout counts as queued: the click's own cycle and one more. */
export const QUEUED_AFTER_TICKS = 2;

export function logoutOutcome(r: DirectLogoutResult): LogoutOutcome {
    if (r.ok) return 'out';
    return r.clicks > 0 && !r.refused && r.endTick - r.clickTick >= QUEUED_AFTER_TICKS ? 'queued' : 'unconfirmed';
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
    /**
     * A BotSDK and BotActions on this client through the in-process bridge: the surface a role
     * gets through the gateway, with its state listeners called inside the tick callback.
     */
    connectSdk(opts?: { showChat?: boolean }): Promise<{ sdk: BotSDK; bot: BotActions }>;
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
        const timedOut = await until(s, () => end !== null || label() >= sent + retryTicks, deadline);
        if (end) return verdict(end, clicks);
        // a timer can fire before performance.now() reaches the deadline: trust the timeout, not the clock
        if (timedOut) break;
    }
    return result(null, clicks, `still in the world after ${Math.round(performance.now() - t0)} ms`);
}

/**
 * Resolve once `done()` holds after a tick or the session's end, or at `deadline`. Resolves
 * true when it ended at the deadline.
 */
function until(s: DirectLogoutTarget, done: () => boolean, deadline: number): Promise<boolean> {
    return new Promise<boolean>(resolve => {
        if (done()) return resolve(false);
        let settled = false;
        const finish = (timedOut: boolean) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            offTick();
            resolve(timedOut);
        };
        const check = () => {
            if (done()) finish(false);
        };
        const timer = setTimeout(() => finish(true), Math.max(0, deadline - performance.now()));
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
    const served = `${r.endTick - r.clickTick} tick(s) arrived after the first click`;
    if (logoutOutcome(r) === 'queued') return `QUEUED (${r.reason}; ${clicks}; ${served}): the server has the click and removes the player on its turn`;
    return `NOT CONFIRMED (${r.reason}${r.refused ? '; refused in combat' : ''}; ${clicks}; ${served}): the server may hold the player until it times out`;
}

const LITE = new URL('../../server/webclient/src/lite/', import.meta.url);
const lite = (path: string) => import(new URL(path, LITE).href);

/** server/webclient's BotActionQueue, the queue the lite runner and the browser overlay use. */
export async function loadActionQueue(): Promise<DirectActionQueue> {
    const { BotActionQueue } = await lite('../bot/ActionQueue.ts');
    return new BotActionQueue();
}

/**
 * Log in with a lite client on the engine websocket. Needs server/webclient's dependencies
 * installed (`cd server/webclient && bun install`). The account must not be logged in
 * elsewhere (a lite runner on the same bot, say). Login errors are the lite client's
 * (`LoginError` with `code`, `OutdatedClientError` when the server runs another revision).
 */
export async function openDirectSession(opts: DirectSessionOptions): Promise<DirectSession> {
    const [{ startSession }, queue] = await Promise.all([lite('session.ts'), loadActionQueue()]);
    const secured = opts.secured ?? !(opts.host.startsWith('localhost') || opts.host.startsWith('127.'));
    const origin = `${secured ? 'https' : 'http'}://${opts.host}`;
    const session = await startSession({
        host: opts.host,
        username: opts.username,
        password: opts.password,
        secured,
        cacheDir: opts.cacheDir,
        profanityFilter: opts.profanityFilter,
        loginJitterMs: 0,
        quiet: true,
    });
    const client = session.client as DirectSessionClient & { conn: { onReceive(l: () => void): void } };
    let lastArrival = performance.now();
    // Runs after the session's own wake-up listener, and before the drain it wakes.
    client.conn.onReceive(() => (lastArrival = performance.now()));

    const bridge = new DirectBridge(client, queue);
    let probeTick: ((n: number) => void) | null = null;
    const sdk = directProbeSdk(
        {
            setOnGameTickCallback: cb => (probeTick = cb),
            getPlayerPosition: () => client.getPlayerPosition(),
            isInGame: () => client.isInGame(),
            walkTo: (x, z, running) => client.walkTo(x, z, running),
            flush: () => client.flush(),
        },
        () => lastArrival
    );
    // The bridge first: a role's tick-critical action leaves before the probe's bookkeeping.
    client.setOnGameTickCallback(n => {
        bridge.onTick(n);
        probeTick?.(n);
    });
    // The lite session's 'stopped' is our own close().
    const ended: Promise<DirectSessionEnd> = session.stopped.then((end: DirectSessionEnd) => {
        bridge.close();
        return end.reason === 'stopped' ? { ...end, reason: 'closed' } : end;
    });

    let logout: Promise<DirectLogoutResult> | null = null;
    const direct: DirectSession = {
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
        async connectSdk(o = {}) {
            const botSdk = new BotSDK({
                botUsername: opts.username,
                // The bridge authenticates nothing; the credentials stay with the game connection.
                password: '',
                gatewayUrl: `direct://${opts.username}`,
                connectionMode: 'control',
                autoReconnect: false,
                autoLaunchBrowser: false,
                readyTimeout: 0,
                showChat: o.showChat ?? false,
                openSocket: bridge.openSocket,
            });
            await botSdk.connect();
            return { sdk: botSdk, bot: new BotActions(botSdk) };
        },
        logout: lo => (logout ??= logoutDirect(direct, lo)),
        close: () => {
            bridge.close();
            session.stop();
        },
    };
    return direct;
}
