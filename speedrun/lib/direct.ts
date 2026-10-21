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
// Root tsconfig excludes server/webclient and cannot resolve its `#/` import aliases, so the
// lite client is loaded with computed specifiers and typed here by the members used.

import type { ProbeSdk, ProbeState } from './hostgate';

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
}

export interface DirectProbeSdk extends ProbeSdk {
    readonly path: 'direct';
}

/**
 * Publish a state per decoded drain of server ticks. The label counts PLAYER_INFOs from the
 * adapter's creation, so it moves like the SDK's `state.tick` (a drain that held two ticks
 * moves it by two). Takes over the client's game-tick callback.
 */
export function directProbeSdk(client: DirectClient): DirectProbeSdk {
    const listeners = new Set<(s: ProbeState) => void>();
    let state: ProbeState | null = null;
    let label = 0;
    client.setOnGameTickCallback(n => {
        label += n;
        const p = client.getPlayerPosition();
        state = { tick: label, inGame: client.isInGame(), player: p ? { worldX: p.worldX, worldZ: p.worldZ } : null };
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

export interface DirectSession {
    readonly host: string;
    /** `https://host` or `http://host`: where the cache and `/playercount` are served. */
    readonly origin: string;
    readonly sdk: DirectProbeSdk;
    readonly client: DirectSessionClient;
    /** Resolve once the label has moved `n` ticks. */
    waitTicks(n: number): Promise<void>;
    close(): void;
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
    const sdk = directProbeSdk(client);

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
        }
    };
    const socket = connection.stream.socket as WebSocket;
    socket.addEventListener('message', () => void pump());
    const keepalive = setInterval(() => {
        client.writeOpcode(ClientProt.NO_TIMEOUT);
        client.flush();
    }, 1000);
    void pump();

    return {
        host: opts.host,
        origin,
        sdk,
        client,
        waitTicks: n =>
            new Promise<void>(resolve => {
                const target = (sdk.getState()?.tick ?? 0) + n;
                const off = sdk.onStateUpdate(s => {
                    if (s.tick < target) return;
                    off();
                    resolve();
                });
            }),
        close: () => {
            clearInterval(keepalive);
            connection.close();
        },
    };
}
