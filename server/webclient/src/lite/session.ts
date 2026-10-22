// One bot session: bootstrap the cache, log in, and pump packets.
//
// The loop is deliberately dumb compared to GameShell.run(): there is no redraw
// to pace against. It drains the socket as soon as a message arrives, because a
// tick's state reaches the bot - and the bot's reaction reaches the engine - only
// as fast as the drain runs, and the engine reads input once per tick: a polled
// drain spent up to a full LOOP_MS of the gap a reaction has to land in. The
// client frame counter, keepalive and idle watchdog still step every LOOP_MS,
// because they count client cycles (the browser's 20ms frames), not messages.
//
// Death policy. A session that ends never resumes itself - reconnecting is the
// caller's call, because it owns whatever state was mid-flight. What this file
// guarantees is that an ending is always *noticed*: every exit resolves `stopped`
// (and calls `onEnd`) with a reason, including the two that used to be silent -
// a remote hang-up, which leaves `available` at 0 forever, and a socket that goes
// quiet without closing. A single bad packet is not an ending; see handlePacket.

import './dom-shim.js';
import { loginJitterMs } from './LoginBackoff.js';

import { invalidateCache, loadCache } from './cache.js';
import { CLIENT_VERSION, GameConnection, LoginError, OutdatedClientError } from './net/GameConnection.js';
import { LiteClient } from './LiteClient.js';
import { LocIndex } from './world/LocIndex.js';
import { ClientProt } from '#/io/ClientProt.js';
import WordFilter from '#/wordfilter/WordFilter.js';

/** One client cycle: the browser's 50Hz frame, which SeqType delays are denominated in. */
const LOOP_MS = 20;
/** Engine drops a socket after TIMEOUT_NO_RESPONSE; NO_TIMEOUT keeps it alive. */
const KEEPALIVE_CYCLES = 50;
/**
 * The engine writes PLAYER_INFO to every logged-in player every tick
 * (NetworkPlayer.updatePlayers), so a socket that has gone this long without a
 * single byte is dead even if no FIN ever arrived - a half-open connection that
 * a NAT dropped looks exactly like a healthy idle one otherwise.
 */
const IDLE_CYCLES = 3000; // ~60s, i.e. ~200 missed server ticks

export interface SessionOptions {
    /** Spread remote fleet starts over 5s by default; 0 disables the delay. */
    loginJitterMs?: number;
    host: string;
    username: string;
    password: string;
    secured?: boolean;
    cacheDir?: string;
    members?: boolean;
    maxMessageLength?: number;
    /**
     * Local chat censoring (WordFilter). Default on. Process-wide (WordFilter is
     * static), so in a multi-bot process like swarm.ts the last session started
     * wins. Cosmetic unless the server's NODE_PROFANITY_FILTER is also off - the
     * engine censors chat before it reaches any client.
     */
    profanityFilter?: boolean;
    quiet?: boolean;
    /**
     * Called exactly once when the packet loop ends, whatever the cause. Fires
     * before `stopped` resolves, so a supervisor can re-login straight away.
     */
    onEnd?(end: SessionEnd): void;
}

/**
 * Why a session ended. Only 'stopped' is us asking; everything else is a bot
 * that has left the game and will not come back on its own.
 */
export type SessionEndReason =
    /** stop() was called. */
    | 'stopped'
    /** The server sent LOGOUT (death of the account's session, world shutdown, ...). */
    | 'logged-out'
    /** The socket is gone. */
    | 'disconnected'
    /** The socket is nominally open but the server stopped talking. */
    | 'idle'
    /** The packet loop threw: stream desync, or handlers failing in a burst. */
    | 'error';

export interface SessionEnd {
    reason: SessionEndReason;
    /** Set when reason === 'error'. */
    error?: unknown;
}

export interface LiteSession {
    client: LiteClient;
    stop(): void;
    stopped: Promise<SessionEnd>;
}

/** What the packet loop needs from the game socket. GameConnection is the real one. */
export interface PacketSocket {
    /** Call `listener` after each inbound message has been buffered for reading. */
    onReceive(listener: () => void): void;
    close(): void;
}

export interface PacketLoop {
    stop(): void;
    stopped: Promise<SessionEnd>;
}

/**
 * The packet loop's wait: resolves when the next client cycle is due, or as soon
 * as the socket delivers data. A message that lands while the loop is busy
 * draining is remembered, so the next wait returns at once rather than sleeping
 * on bytes that already arrived.
 */
class PacketWake {
    private pending = false;
    private waiter: (() => void) | null = null;

    readonly notify = (): void => {
        const waiter = this.waiter;
        if (waiter) {
            this.waiter = null;
            waiter();
        } else {
            this.pending = true;
        }
    };

    wait(ms: number): Promise<void> {
        if (this.pending) {
            this.pending = false;
            return Promise.resolve();
        }
        return new Promise(resolve => {
            const timer = setTimeout(() => {
                this.waiter = null;
                resolve();
            }, Math.max(0, ms));
            this.waiter = () => {
                clearTimeout(timer);
                resolve();
            };
        });
    }
}

/**
 * Drive a logged-in client until its session ends: drain and flush whenever the
 * socket delivers, and step the client cycle (frame counter, keepalive, idle
 * watchdog) every LOOP_MS whether or not anything arrived. A stall drops the
 * cycles it missed instead of replaying them in a burst.
 */
export function runPacketLoop(
    client: LiteClient,
    socket: PacketSocket,
    opts: { username: string; onEnd?(end: SessionEnd): void }
): PacketLoop {
    let running = true;
    const wake = new PacketWake();
    socket.onReceive(wake.notify);

    const loop = async (): Promise<SessionEnd> => {
        let end: SessionEnd = { reason: 'stopped' };
        let cycles = 0;
        let idle = 0;
        let seenPackets = 0;
        let nextCycleAt = performance.now();

        while (running) {
            if (client.isLoggedOut()) {
                end = { reason: 'logged-out' };
                break;
            }
            if (!client.isInGame()) {
                end = { reason: 'disconnected' };
                break;
            }

            let cycled = false;
            try {
                await client.pumpPackets();

                const now = performance.now();
                if (now >= nextCycleAt) {
                    cycled = true;
                    nextCycleAt = now - nextCycleAt < LOOP_MS ? nextCycleAt + LOOP_MS : now + LOOP_MS;
                    if (++cycles % KEEPALIVE_CYCLES === 0) {
                        client.writeOpcode(ClientProt.NO_TIMEOUT);
                    }
                }
                client.flush();
                if (cycled) {
                    client.tickCycle();
                }
            } catch (err) {
                if (!running) {
                    break;
                }
                // Individual bad packets are contained in handlePacket, so a throw
                // that reaches here is the stream or the socket, not one handler.
                end = client.isInGame() ? { reason: 'error', error: err } : { reason: 'disconnected' };
                break;
            }

            if (client.packetsReceived !== seenPackets) {
                seenPackets = client.packetsReceived;
                idle = 0;
            } else if (cycled && ++idle > IDLE_CYCLES) {
                end = { reason: 'idle' };
                break;
            }

            await wake.wait(nextCycleAt - performance.now());
        }

        socket.close();
        // Say so on the way out: a bot that dies quietly in a fleet just looks idle.
        if (end.reason !== 'stopped') {
            console.error(`[lite] ${opts.username}: session ended (${end.reason})`, end.error ?? '');
        }
        try {
            opts.onEnd?.(end);
        } catch (err) {
            console.error(`[lite] ${opts.username}: onEnd handler threw:`, err);
        }
        return end;
    };

    const stopped = loop();
    return {
        stop(): void {
            running = false;
            socket.close();
            wake.notify();
        },
        stopped
    };
}

/** The server's game revision from /api/version, or null if it doesn't say (older server, network). */
async function fetchServerRevision(origin: string): Promise<number | null> {
    try {
        const res = await fetch(`${origin}/api/version`, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) {
            return null;
        }
        const body = (await res.json()) as { revision?: unknown };
        return typeof body.revision === 'number' ? body.revision : null;
    } catch {
        return null;
    }
}

export async function startSession(opts: SessionOptions): Promise<LiteSession> {
    if (opts.profanityFilter !== undefined) {
        WordFilter.enabled = opts.profanityFilter;
    }
    const secured = opts.secured ?? !(opts.host.startsWith('localhost') || opts.host.startsWith('127.'));
    const origin = `${secured ? 'https' : 'http'}://${opts.host}`;
    const cacheDir = opts.cacheDir ?? `${process.env.HOME}/.cache/rs-sdk-lite`;

    // Fail with the fix, not a decode error or an opaque login response 6, when the server
    // has moved to another revision. Servers without /api/version skip the check.
    const serverRevision = await fetchServerRevision(origin);
    if (serverRevision !== null && serverRevision !== CLIENT_VERSION) {
        throw new OutdatedClientError(origin, serverRevision);
    }

    let { checksums } = await loadCache({ origin, cacheDir, members: opts.members, quiet: opts.quiet });
    let locIndex = await LocIndex.load({ origin, cacheDir, versionlistCrc: checksums[5], quiet: opts.quiet });

    const connect = async () => {
        await Bun.sleep(loginJitterMs(opts.loginJitterMs ?? Number(process.env.LITE_LOGIN_JITTER_MS ?? (secured ? 5000 : 0))));
        return GameConnection.connect({
            host: opts.host,
            secured,
            username: opts.username,
            password: opts.password,
            checksums,
            // Lab only: an engine started with FLY_APP_NAME trusts fly-client-ip, so this
            // places the client in another player-loop bucket (World.ts playerLoop).
            ...(process.env.LITE_CLIENT_IP ? { headers: { 'fly-client-ip': process.env.LITE_CLIENT_IP } } : {})
        });
    };

    let connection: GameConnection;
    try {
        connection = await connect();
    } catch (err) {
        // Login response 6 from a long-lived process usually means the server's
        // content was redeployed under us and the memoized CRCs are stale, not
        // that this build is actually out of date. Re-fetch /crc once and retry;
        // if the checksums come back unchanged the mismatch is real, so rethrow.
        if (!(err instanceof LoginError) || err.code !== 6) {
            throw err;
        }
        const stale = checksums;
        invalidateCache();
        ({ checksums } = await loadCache({ origin, cacheDir, members: opts.members, quiet: opts.quiet }));
        if (checksums.every((crc, i) => crc === stale[i])) {
            // still refused with fresh CRCs: the revision is the likely cause unless the
            // server confirmed it matches
            throw serverRevision === null ? new OutdatedClientError(origin, null) : err;
        }
        console.error(`[lite] ${opts.username}: stale archive CRCs after server redeploy, re-fetched /crc and retrying login`);
        locIndex = await LocIndex.load({ origin, cacheDir, versionlistCrc: checksums[5], quiet: opts.quiet });
        connection = await connect();
    }

    const client = new LiteClient({
        connection,
        locIndex,
        username: opts.username,
        password: opts.password,
        maxMessageLength: opts.maxMessageLength
    });

    const loop = runPacketLoop(client, connection, { username: opts.username, onEnd: opts.onEnd });
    return { client, stop: loop.stop, stopped: loop.stopped };
}
