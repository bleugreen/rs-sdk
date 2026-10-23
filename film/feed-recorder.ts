// Records an engine's world feed (server/engine/src/web/worldfeed.ts, `WORLD_FEED=true`; protocol v1):
// every server frame verbatim, one JSONL line each with the wall-clock ms it was received,
//
//   {"recv":<epoch ms>,"frame":<the frame exactly as sent>}
//   {"recv":<epoch ms>,"sent":<a message this recorder sent: sub or roster>}
//
// the same lines as the document thread's live recorder, so one replay loader (rs-dash) reads a lab
// clip and the real run alike, and a clip's trace.jsonl and video line up with it on the same clock.
// It needs only a ws URL, an area (or a player to follow) and an output path, so it can be pointed
// at any engine that serves the feed. No login: the feed is a spectator stream.
//
// Following: with `follow` set, the one area subscription is re-centred on that player's roster
// position when it is more than 48 tiles from the centre, at most every 10 s (the roster comes every
// 10 ticks). Reconnects back off from 30 s to 5 min and stop for good after 6 disconnects in an hour.
// Player names are never printed.
//
//   bun film/feed-recorder.ts --url=ws://localhost:9700/worldfeed --out=FILE|DIR/ [--centre=x,z]
//       [--size=192] [--follow=NAME] [--seconds=N] [--stop-file=PATH] [--remote]
//
// An --out ending in / writes hourly files feed-YYYYMMDDHHZ.jsonl there. The CLI refuses a
// non-loopback host without --remote.

import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FeedTick } from './trace';

export interface Area {
    x: number;
    z: number;
    w: number;
    h: number;
}

export interface FeedHello {
    t: 'hello';
    v: number;
    rev: number;
    tick: number;
    tickMs: number;
    players: number;
}

export type RosterEntry = [slot: number, name: string, x: number, z: number, level: number, combat: number];

export interface FeedRecorder {
    /** The first hello (protocol version, tick, configured tick length). */
    readonly hello: Promise<FeedHello>;
    /** The area subscribed now, and every one subscribed so far. */
    readonly area: Area;
    readonly areas: readonly Area[];
    /** Every tick frame received so far, in order. */
    ticks(): readonly FeedTick[];
    /** The followed player's roster slot, once seen. */
    readonly followedSlot: number | null;
    readonly frames: number;
    stop(): Promise<void>;
}

export interface RecordOptions {
    url: string;
    /** A file, or a directory for hourly files (`hourly`). */
    out: string;
    hourly?: boolean;
    centre: { x: number; z: number };
    /** The area's side in tiles (default 192; the engine's limit is 384). */
    size?: number;
    /** A player's name to follow by roster position (matched case- and space/underscore-blind). */
    follow?: string;
    log?: (line: string) => void;
    now?: () => number;
}

export const FOLLOW_TILES = 48;
export const RESUB_MIN_MS = 10_000;
const HEARTBEAT_MS = 30_000;
const BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 300_000;
const MAX_DISCONNECTS_PER_HOUR = 6;

export const normName = (s: string) => s.toLowerCase().replace(/[\s_]+/g, ' ').trim();

/** A square area of side `size` centred on a tile (clamped at 0). */
export function areaAround(x: number, z: number, size = 192): Area {
    return { x: Math.max(0, x - (size >> 1)), z: Math.max(0, z - (size >> 1)), w: size, h: size };
}

/** Whether a followed player at x, z calls for a new area around it. */
export function shouldRecentre(centre: { x: number; z: number }, x: number, z: number, msSinceSub: number): boolean {
    return msSinceSub >= RESUB_MIN_MS && (Math.abs(x - centre.x) > FOLLOW_TILES || Math.abs(z - centre.z) > FOLLOW_TILES);
}

export function hourlyFile(dir: string, ms: number): string {
    return join(dir, `feed-${new Date(ms).toISOString().slice(0, 13).replace(/[-:T]/g, '')}Z.jsonl`);
}

export function recordFeed(o: RecordOptions): FeedRecorder {
    const now = o.now ?? Date.now;
    const log = o.log ?? (() => {});
    const size = o.size ?? 192;
    if (o.hourly) mkdirSync(o.out, { recursive: true });
    else writeFileSync(o.out, '');
    const file = () => (o.hourly ? hourlyFile(o.out, now()) : o.out);
    const write = (line: string) => appendFileSync(file(), line + '\n');
    const follow = o.follow ? normName(o.follow) : null;

    const ticks: FeedTick[] = [];
    const areas: Area[] = [];
    let centre = o.centre;
    let area = areaAround(centre.x, centre.z, size);
    let lastSub = 0;
    let frames = 0;
    let followedSlot: number | null = null;
    let stopped = false;
    let ws: WebSocket | null = null;
    let backoff = BACKOFF_MS;
    let failures: number[] = [];
    let reconnect: ReturnType<typeof setTimeout> | null = null;
    let resolveHello!: (h: FeedHello) => void;
    let rejectHello!: (e: Error) => void;
    let helloSeen = false;
    const hello = new Promise<FeedHello>((res, rej) => ((resolveHello = res), (rejectHello = rej)));
    hello.catch(() => {});

    const connect = () => {
        const sock = new WebSocket(o.url);
        ws = sock;
        let heartbeat: ReturnType<typeof setInterval> | null = null;
        const send = (m: Record<string, unknown>, record = true) => {
            if (sock.readyState !== WebSocket.OPEN) return;
            sock.send(JSON.stringify(m));
            if (record) write(JSON.stringify({ recv: now(), sent: m }));
        };
        const sub = (c: { x: number; z: number }) => {
            centre = c;
            area = areaAround(c.x, c.z, size);
            areas.push(area);
            lastSub = now();
            send({ t: 'sub', ...area });
        };
        sock.onmessage = ev => {
            const recv = now();
            const text = typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data as ArrayBuffer).toString('utf8');
            write(`{"recv":${recv},"frame":${text}}`);
            frames++;
            // Only the kind, tick and roster are read here; everything stays verbatim in the file.
            if (text.startsWith('{"t":"tick"')) {
                const k = /^\{"t":"tick","k":(\d+)/.exec(text);
                if (k) ticks.push({ rx: recv, k: Number(k[1]) });
                return;
            }
            let msg: { t?: string; p?: RosterEntry[] };
            try {
                msg = JSON.parse(text);
            } catch {
                return;
            }
            if (msg.t === 'hello') {
                backoff = BACKOFF_MS;
                const h = msg as FeedHello;
                log(`hello v${h.v} rev ${h.rev} tick ${h.tick} tickMs ${h.tickMs} players ${h.players}`);
                if (!helloSeen) {
                    helloSeen = true;
                    resolveHello(h);
                }
                send({ t: 'roster', on: true });
                sub(centre);
                heartbeat ??= setInterval(() => send({ t: 'ping' }, false), HEARTBEAT_MS);
            } else if (msg.t === 'roster' && follow && Array.isArray(msg.p)) {
                const me = msg.p.find(p => normName(String(p[1])) === follow);
                followedSlot = me ? me[0] : followedSlot;
                if (me && shouldRecentre(centre, me[2], me[3], now() - lastSub)) sub({ x: me[2], z: me[3] });
            }
        };
        sock.onerror = () => {
            if (!helloSeen) rejectHello(new Error(`world feed ${o.url}: connection failed (is the engine running with WORLD_FEED=true?)`));
        };
        sock.onclose = ev => {
            if (heartbeat) clearInterval(heartbeat);
            if (stopped) return;
            const t = now();
            failures = [...failures.filter(f => t - f < 3_600_000), t];
            log(`socket closed (code ${ev.code}); ${failures.length} disconnects in the last hour`);
            if (failures.length >= MAX_DISCONNECTS_PER_HOUR) {
                log(`${MAX_DISCONNECTS_PER_HOUR} disconnects within an hour: stopping`);
                stopped = true;
                return;
            }
            const wait = backoff;
            backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
            log(`reconnecting in ${wait / 1000} s`);
            reconnect = setTimeout(connect, wait);
        };
    };
    connect();

    return {
        hello,
        get area() {
            return area;
        },
        get areas() {
            return areas;
        },
        get frames() {
            return frames;
        },
        get followedSlot() {
            return followedSlot;
        },
        ticks: () => ticks,
        async stop() {
            stopped = true;
            if (reconnect) clearTimeout(reconnect);
            const sock = ws;
            if (sock && (sock.readyState === WebSocket.OPEN || sock.readyState === WebSocket.CONNECTING)) {
                const closed = new Promise<void>(res => sock.addEventListener('close', () => res()));
                sock.close();
                await Promise.race([closed, Bun.sleep(2_000)]);
            }
        }
    };
}

if (import.meta.main) {
    const flag = (n: string) => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
    const url = flag('url');
    const out = flag('out');
    const centreArg = (flag('centre') ?? '3222,3218').split(',').map(Number);
    if (!url || !out || centreArg.length !== 2 || centreArg.some(n => !Number.isInteger(n))) {
        throw new Error('usage: bun film/feed-recorder.ts --url=ws://HOST:PORT/worldfeed --out=FILE|DIR/ [--centre=x,z] [--size=192] [--follow=NAME] [--seconds=N] [--stop-file=PATH] [--remote]');
    }
    const host = new URL(url).hostname;
    if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host) && !process.argv.includes('--remote')) {
        throw new Error(`refusing ${host}: not a loopback host; pass --remote to record another engine's feed`);
    }
    const say = (m: string) => console.log(`${new Date().toISOString()} [feed] ${m}`);
    const rec = recordFeed({
        url,
        out,
        hourly: out.endsWith('/'),
        centre: { x: centreArg[0]!, z: centreArg[1]! },
        size: Number(flag('size') ?? 192),
        follow: flag('follow'),
        log: say
    });
    const stop = async (why: string) => {
        await rec.stop();
        say(`${why}: ${rec.frames} frames, ${rec.ticks().length} ticks`);
        process.exit(0);
    };
    process.on('SIGINT', () => void stop('SIGINT'));
    process.on('SIGTERM', () => void stop('SIGTERM'));
    const stopFile = flag('stop-file');
    if (stopFile) setInterval(() => existsSync(stopFile) && void stop('stop file present'), 5_000);
    const seconds = Number(flag('seconds') ?? '0');
    if (seconds > 0) setTimeout(() => void stop(`${seconds} s`), seconds * 1000);
    setInterval(() => say(`frames ${rec.frames}, ticks ${rec.ticks().length}, following ${rec.followedSlot !== null ? 'yes' : 'no'}, area ${rec.area.x},${rec.area.z} ${rec.area.w}x${rec.area.h}`), 60_000);
}
