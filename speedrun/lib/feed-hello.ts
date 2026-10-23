// The tick preflight: the demo's tick length, read login-free from the spectator feed's hello
// (server/engine/src/web/worldfeed.ts: {t:'hello', v, rev, tick, tickMs, players}), against the
// length recorded at the floor freeze (lib/run-floor.ts parseFloorTickMs) and against this process's
// own tickMs() (lib/wait.ts), which sizes every `N x tickMs()` bound. run.ts checks it before S00
// and before every later login (Session.beforeLogin); a mismatch or an unreadable feed refuses, and
// only the operator's --tick-override goes past it, logged with the reading.

import type { TickMsParse } from './run-floor';
import { idleBoundMs, TickPeriod } from './wait';

export interface FeedHello {
    tickMs: number;
    players: number;
    tick: number;
    rev?: unknown;
    v?: unknown;
}

export type FeedRead = { ok: true; url: string; hello: FeedHello; wallMs: number } | { ok: false; url: string; reason: string };

/** The world's feed: SPEEDRUN_FEED_URL, else ws://<local>/worldfeed for a localhost world, else wss://<world>/worldfeed; SPEEDRUN_FEED_TOKEN as ?token=. */
export function feedUrl(world: string, env: Record<string, string | undefined> = process.env): string {
    const base = env.SPEEDRUN_FEED_URL ?? (world === 'localhost' || world.startsWith('localhost:') ? `ws://${world.includes(':') ? world : `localhost:${env.WEB_PORT ?? 80}`}/worldfeed` : `wss://${world}/worldfeed`);
    return env.SPEEDRUN_FEED_TOKEN ? `${base}${base.includes('?') ? '&' : '?'}token=${encodeURIComponent(env.SPEEDRUN_FEED_TOKEN)}` : base;
}

/** A hello's fields, or why the message is not one. */
export function parseHello(data: string): FeedHello | string {
    let m: unknown;
    try {
        m = JSON.parse(data);
    } catch {
        return 'the first message is not JSON';
    }
    const h = m as Partial<FeedHello> & { t?: unknown };
    if (h.t !== 'hello') return `the first message is not a hello (t=${JSON.stringify(h.t)})`;
    if (typeof h.tickMs !== 'number' || !(h.tickMs > 0)) return `the hello carries no tickMs (${JSON.stringify(h.tickMs)})`;
    return { tickMs: h.tickMs, players: typeof h.players === 'number' ? h.players : -1, tick: typeof h.tick === 'number' ? h.tick : -1, rev: h.rev, v: h.v };
}

type Socket = { onopen: (() => void) | null; onmessage: ((e: { data: unknown }) => void) | null; onerror: ((e: unknown) => void) | null; onclose: ((e: { code?: number }) => void) | null; close(): void };

/** Open the feed, take its hello, close. Never throws: a timeout, an error or a non-hello comes back as `reason`. */
export async function readFeedHello(url: string, o: { timeoutMs?: number; connect?: (url: string) => Socket } = {}): Promise<FeedRead> {
    const t0 = Date.now();
    const timeoutMs = o.timeoutMs ?? 10_000;
    const shown = url.replace(/token=[^&]*/, 'token=***');
    let ws: Socket;
    try {
        ws = (o.connect ?? (u => new WebSocket(u) as unknown as Socket))(url);
    } catch (e) {
        return { ok: false, url: shown, reason: `cannot open ${shown}: ${e instanceof Error ? e.message : e}` };
    }
    return new Promise<FeedRead>(done => {
        let settled = false;
        const finish = (r: FeedRead) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try {
                ws.close();
            } catch {}
            done(r);
        };
        const timer = setTimeout(() => finish({ ok: false, url: shown, reason: `no hello from ${shown} within ${timeoutMs} ms` }), timeoutMs);
        ws.onmessage = e => {
            const h = parseHello(typeof e.data === 'string' ? e.data : String(e.data));
            finish(typeof h === 'string' ? { ok: false, url: shown, reason: `${shown}: ${h}` } : { ok: true, url: shown, hello: h, wallMs: Date.now() - t0 });
        };
        ws.onerror = () => finish({ ok: false, url: shown, reason: `${shown}: connection error (is WORLD_FEED on there?)` });
        ws.onclose = e => finish({ ok: false, url: shown, reason: `${shown} closed before a hello (code ${e.code ?? '?'})` });
    });
}

export interface TickPreflight {
    ok: boolean;
    /** Problems found; with `overridden`, the run went on past them. */
    problems: string[];
    overridden: boolean;
    reading: { url: string; feedTickMs: number | null; players: number | null; feedTick: number | null; recordedTickMs: number | null; localTickMs: number; error?: string };
}

/**
 * The decision, on readings only: the feed must be read, its tickMs must equal the freeze's (when
 * `recorded` is given; null skips it, for a lab or a rehearsal with no floor) and this process's
 * tickMs(). Every problem refuses unless `override`, which passes and is reported as overridden.
 */
export function tickPreflight(feed: FeedRead, recorded: TickMsParse | null, localTickMs: number, override = false): TickPreflight {
    const problems: string[] = [];
    if (!feed.ok) problems.push(`the world feed is unreadable: ${feed.reason}`);
    if (recorded && !recorded.ok) problems.push(recorded.reason);
    if (feed.ok) {
        const t = feed.hello.tickMs;
        if (recorded?.ok && recorded.tickMs !== t) problems.push(`the server runs ${t} ms ticks, the floor froze at ${recorded.tickMs} (STEP-MANIFEST.md:${recorded.line})`);
        if (localTickMs !== t) problems.push(`this process's tickMs() is ${localTickMs} (SPEEDRUN_TICK_MS / NODE_TICKRATE) but the server runs ${t}: set SPEEDRUN_TICK_MS=${t}`);
    }
    return {
        ok: problems.length === 0 || override,
        problems,
        overridden: override && problems.length > 0,
        reading: {
            url: feed.url,
            feedTickMs: feed.ok ? feed.hello.tickMs : null,
            players: feed.ok ? feed.hello.players : null,
            feedTick: feed.ok ? feed.hello.tick : null,
            recordedTickMs: recorded?.ok ? recorded.tickMs : null,
            localTickMs,
            ...(feed.ok ? {} : { error: feed.reason }),
        },
    };
}

/** One line for a gate or a log: the reading, then the verdict. */
export function describePreflight(p: TickPreflight): string {
    const r = p.reading;
    const read = `feed ${r.feedTickMs ?? '?'} ms (${r.players ?? '?'} players, tick ${r.feedTick ?? '?'}), freeze ${r.recordedTickMs ?? '-'}, tickMs() ${r.localTickMs}`;
    if (!p.problems.length) return `${read}: agree`;
    return `${read}: ${p.overridden ? 'OVERRIDDEN by --tick-override: ' : ''}${p.problems.join('; ')}`;
}


export interface FeedBeacon {
    tick: number;
    /** Local receipt time, not an elapsed-time tick estimate. */
    ms: number;
}

export interface FeedClock {
    /** The next observed world tick after `after`; silence and a restarted world reject. */
    next(after: number): Promise<FeedBeacon>;
    close(): void;
}

type TickSocket = Socket & { send(data: string): void };

/**
 * A login-free clock for work done while the player is deliberately out of the world. Subscribe
 * to one empty tile: tick frames still arrive, without carrying a world's worth of entities.
 * Only the server's tick labels advance the clock. Wall time can detect silence, never readiness.
 */
export function watchFeedTicks(url: string, o: { connect?: (url: string) => TickSocket; idleMs?: number } = {}): FeedClock {
    const period = new TickPeriod();
    let latest: FeedBeacon | null = null;
    let failure: Error | null = null;
    const waiting = new Set<{ after: number; resolve(b: FeedBeacon): void; reject(e: Error): void }>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ping: ReturnType<typeof setInterval> | undefined;
    const ws = (o.connect ?? (u => new WebSocket(u) as unknown as TickSocket))(url);
    const stop = (reason: string) => {
        if (failure) return;
        failure = new Error(reason);
        clearTimeout(timer);
        clearInterval(ping);
        ws.onclose = null;
        try { ws.close(); } catch {}
        for (const w of waiting) w.reject(failure);
        waiting.clear();
    };
    const arm = () => {
        clearTimeout(timer);
        timer = setTimeout(() => stop('world feed stopped: no advancing observed tick'), o.idleMs ?? idleBoundMs({ ticks: 25, period }));
    };
    ws.onopen = () => {
        try {
            ws.send(JSON.stringify({ t: 'sub', x: 0, z: 0, w: 1, h: 1 }));
            // The feed expires idle subscribers even while it is sending them frames.
            ping = setInterval(() => {
                try { ws.send(JSON.stringify({ t: 'ping' })); }
                catch { stop('world feed connection error'); }
            }, 10_000);
        } catch { stop('world feed connection error'); }
    };
    ws.onmessage = e => {
        let m: { t?: unknown; k?: unknown };
        try { m = JSON.parse(String(e.data)); } catch { return; }
        if (!m || m.t !== 'tick' || typeof m.k !== 'number' || !Number.isSafeInteger(m.k) || m.k < 0) return;
        if (latest && m.k < latest.tick) {
            stop('world feed tick went backwards: world restarted');
            return;
        }
        if (failure || (latest && m.k === latest.tick)) return;
        latest = { tick: m.k, ms: Date.now() };
        period.see(latest.tick, latest.ms);
        arm();
        for (const w of waiting) {
            if (latest.tick > w.after) {
                waiting.delete(w);
                w.resolve(latest);
            }
        }
    };
    ws.onerror = () => stop('world feed connection error');
    ws.onclose = () => stop('world feed closed before the wait finished');
    arm();
    return {
        next: after => {
            if (failure) return Promise.reject(failure);
            if (latest && latest.tick > after) return Promise.resolve(latest);
            return new Promise((resolve, reject) => waiting.add({ after, resolve, reject }));
        },
        close: () => stop('world feed closed'),
    };
}
