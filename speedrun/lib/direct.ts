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
// The session itself is the lite runner's (server/webclient/src/lite/session.ts): it drains
// the socket the moment a message arrives, keeps the connection alive, and reports why it
// ended. Root tsconfig excludes server/webclient and cannot resolve its `#/` import aliases,
// so those modules are loaded with computed specifiers and typed here by the members used.

import { BotActions } from '../../sdk/actions';
import { BotSDK } from '../../sdk/index';
import type { ActionResult, BotAction, BotWorldState } from '../../sdk/types';
import type { ProbeSdk, ProbeState } from './hostgate';

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

/** Why a session ended: the lite session's reasons ('stopped' is `close()`). */
export interface DirectSessionEnd {
    reason: 'stopped' | 'logged-out' | 'disconnected' | 'idle' | 'error';
    error?: unknown;
}

export interface DirectSession {
    readonly host: string;
    /** `https://host` or `http://host`: where the cache and `/playercount` are served. */
    readonly origin: string;
    readonly sdk: DirectProbeSdk;
    readonly client: DirectSessionClient;
    /** Resolves once, when the session ends for any reason. */
    readonly ended: Promise<DirectSessionEnd>;
    /** Resolve once the label has moved `n` ticks. */
    waitTicks(n: number): Promise<void>;
    /**
     * A BotSDK and BotActions on this client through the in-process bridge: the surface a role
     * gets through the gateway, with its state listeners called inside the tick callback.
     */
    connectSdk(opts?: { showChat?: boolean }): Promise<{ sdk: BotSDK; bot: BotActions }>;
    close(): void;
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
    const ended: Promise<DirectSessionEnd> = session.stopped.then((end: DirectSessionEnd) => {
        bridge.close();
        return end;
    });

    return {
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
        close: () => {
            bridge.close();
            session.stop();
        },
    };
}
