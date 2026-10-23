// The tick preflight: the demo's tick length, read login-free from the spectator feed's hello
// (server/engine/src/web/worldfeed.ts: {t:'hello', v, rev, tick, tickMs, players}), against the
// length recorded at the floor freeze (lib/run-floor.ts parseFloorTickMs) and against this process's
// own tickMs() (lib/wait.ts), which sizes every `N x tickMs()` bound. run.ts checks it before S00
// and before every later login (Session.beforeLogin); a mismatch or an unreadable feed refuses, and
// only the operator's --tick-override goes past it, logged with the reading.

import type { TickMsParse } from './run-floor';

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
