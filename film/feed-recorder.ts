// Records an engine's world feed (server/engine/src/web/worldfeed.ts, `WORLD_FEED=true`): every
// server frame verbatim, one JSONL line each with the wall-clock ms it was received,
//
//   {"rx":<epoch ms>,"frame":<the frame exactly as sent>}
//   {"rx":<epoch ms>,"sent":<what this recorder sent: a sub or roster toggle>}
//
// so a viewer (rs-dash) can replay it tick by tick, and a clip's trace.jsonl and video line up with it
// on the same clock. It needs only a ws URL, an area and an output path, so it can be pointed at any
// engine that serves the feed. No login: the feed is a spectator stream.
//
//   bun film/feed-recorder.ts --url=ws://localhost:9700/worldfeed --area=2950,3300,128,128 \
//       --out=feed.jsonl [--roster] [--seconds=N] [--remote]
//
// The CLI refuses a non-loopback host without --remote.

import { appendFileSync, writeFileSync } from 'node:fs';
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
    /** The server's hello (protocol version, tick, configured tick length). */
    readonly hello: Promise<FeedHello>;
    /** Subscribe to a new area (the feed's limit is 384 x 384); recorded as a `sent` line. */
    setArea(area: Area): void;
    readonly area: Area | null;
    /** Every tick frame received so far, in order. */
    ticks(): readonly FeedTick[];
    /** The last roster frame's players. */
    roster(): readonly RosterEntry[];
    /** Frames written so far. */
    readonly frames: number;
    stop(): Promise<void>;
}

export interface RecordOptions {
    url: string;
    out: string;
    area?: Area;
    /** Also ask for the all-player roster (every 10 ticks). Default true. */
    roster?: boolean;
    now?: () => number;
}

/** The engine expires a socket that sends nothing for WORLD_FEED_IDLE_TIMEOUT_MS (default 120 s). */
const HEARTBEAT_MS = 30_000;

export function recordFeed(o: RecordOptions): FeedRecorder {
    const now = o.now ?? Date.now;
    writeFileSync(o.out, '');
    const ws = new WebSocket(o.url);
    const ticks: FeedTick[] = [];
    let roster: RosterEntry[] = [];
    let frames = 0;
    let area: Area | null = null;
    let resolveHello!: (h: FeedHello) => void;
    let rejectHello!: (e: Error) => void;
    const hello = new Promise<FeedHello>((res, rej) => ((resolveHello = res), (rejectHello = rej)));
    hello.catch(() => {});
    const opened = new Promise<void>((res, rej) => {
        ws.onopen = () => res();
        ws.onerror = () => {
            const e = new Error(`world feed ${o.url}: connection failed (is the engine running with WORLD_FEED=true?)`);
            rej(e);
            rejectHello(e);
        };
    });
    opened.catch(() => {});
    const write = (s: string) => appendFileSync(o.out, s + '\n');
    const sendJson = (msg: Record<string, unknown>, log = true) => {
        void opened.then(() => {
            if (ws.readyState !== WebSocket.OPEN) return;
            ws.send(JSON.stringify(msg));
            if (log) write(`{"rx":${now()},"sent":${JSON.stringify(msg)}}`);
        });
    };

    ws.onmessage = ev => {
        const rx = now();
        const text = typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data as ArrayBuffer).toString('utf8');
        write(`{"rx":${rx},"frame":${text}}`);
        frames++;
        // Only the frame kind and tick are read here; everything else stays verbatim in the file.
        if (text.startsWith('{"t":"tick"')) {
            const k = /^\{"t":"tick","k":(\d+)/.exec(text);
            if (k) ticks.push({ rx, k: Number(k[1]) });
            return;
        }
        try {
            const msg = JSON.parse(text) as { t?: string; p?: RosterEntry[] };
            if (msg.t === 'hello') resolveHello(msg as FeedHello);
            else if (msg.t === 'roster' && Array.isArray(msg.p)) roster = msg.p;
        } catch {
            // A frame that is not JSON is still recorded above.
        }
    };

    const heartbeat = setInterval(() => sendJson({ t: 'ping' }, false), HEARTBEAT_MS);
    const rec: FeedRecorder = {
        hello,
        get area() {
            return area;
        },
        get frames() {
            return frames;
        },
        setArea(a) {
            area = { x: Math.trunc(a.x), z: Math.trunc(a.z), w: Math.trunc(a.w), h: Math.trunc(a.h) };
            sendJson({ t: 'sub', ...area });
        },
        ticks: () => ticks,
        roster: () => roster,
        async stop() {
            clearInterval(heartbeat);
            if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                const closed = new Promise<void>(res => (ws.onclose = () => res()));
                ws.close();
                await Promise.race([closed, Bun.sleep(2_000)]);
            }
        }
    };
    if (o.roster !== false) sendJson({ t: 'roster', on: true });
    if (o.area) rec.setArea(o.area);
    return rec;
}

/** A square area of side `size` centred on a tile. */
export function areaAround(x: number, z: number, size = 128): Area {
    return { x: x - (size >> 1), z: z - (size >> 1), w: size, h: size };
}

if (import.meta.main) {
    const flag = (n: string) => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
    const url = flag('url');
    const out = flag('out');
    const areaArg = flag('area')?.split(',').map(Number);
    if (!url || !out || !areaArg || areaArg.length !== 4 || areaArg.some(n => !Number.isInteger(n))) {
        throw new Error('usage: bun film/feed-recorder.ts --url=ws://HOST:PORT/worldfeed --area=x,z,w,h --out=FILE [--roster] [--seconds=N] [--remote]');
    }
    const host = new URL(url).hostname;
    if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host) && !process.argv.includes('--remote')) {
        throw new Error(`refusing ${host}: not a loopback host; pass --remote to record another engine's feed`);
    }
    const [x, z, w, h] = areaArg as [number, number, number, number];
    const rec = recordFeed({ url, out, area: { x, z, w, h }, roster: process.argv.includes('--roster') });
    const hello = await rec.hello;
    console.log(`[feed] ${url}: v${hello.v}, tick ${hello.tick}, ${hello.tickMs} ms ticks; recording to ${out}`);
    const seconds = Number(flag('seconds') ?? '0');
    const stop = async () => {
        await rec.stop();
        console.log(`[feed] ${rec.frames} frames, ${rec.ticks().length} ticks`);
        process.exit(0);
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    if (seconds > 0) setTimeout(stop, seconds * 1000);
}
