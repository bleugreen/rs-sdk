#!/usr/bin/env bun
// Login-free tick reads from the engine's spectator feed (server/engine/src/web/worldfeed.ts) for
// host-gate-read.sh, and the path check that sets the gate probe's tick arrivals against them.
//
//   bun host-gate-feed.ts <server> [--seconds=60] [--log=PATH]
//   bun host-gate-feed.ts --pathcheck <FEED_LOG> <GATE_JSON> <PROBE_END_ISO> [--tick-ms=T]
//
// Read: connects to wss://<server>/worldfeed, takes the hello frame's tickMs (World.tickRate, the
// configured rate) and tick, subscribes to an empty 1x1 tile and collects the {t:'tick', k, ms}
// frames. `ms` is the engine's own interval between feed cycles, which run on the tick thread right
// after the tick's client output is flushed. The first tick frame is left out of the interval
// stats: the engine only advances its clock while a feed client is connected, so that frame can
// carry the whole gap since the last client left. After --seconds it prints one JSON line
// {tickMsConfigured, feedTick, feedTickMs: {n, p50, p90, max, min} | null, feedTickGaps} (gaps:
// consecutive frames whose k jumps by more than 1), or exits 1 with no output when no hello
// arrived. Without --log it then exits 0. With --log it keeps the socket open until SIGTERM or the
// socket closes, appending every tick frame to PATH as it arrives, one JSON line [k, ms, at]: `at`
// is the local arrival time in epoch ms to 0.01 ms, and the first frame's ms is null. The engine
// expires a feed that sends nothing for 2 min, so this one sends {t:'ping'} every 60 s.
//
// Path check: aligns the gate's tick arrivals (`result.tickArrivalsMs`, relative to its first
// frame) with a --log file and prints one JSON line {pathCheck, feedLog}, both null when the check
// cannot be made. The probe prints PROBE_END_ISO as its last tick arrives, which places its frames
// on the epoch clock to a few ms; `pathCheck` below says what is done with them. T is --tick-ms,
// else the feed's median interval. Report-only: nothing here feeds the gate's verdict.

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

// ------------------------------------------------------------------ path check

/** One feed frame: server tick, the engine's interval since the previous tick (null: unknown), local arrival (epoch ms). */
export interface FeedTick {
    k: number;
    ms: number | null;
    at: number;
}

/** main's tick rule (22 Oct): late is over 7/6 T; a catch-up is under T/2 right after a late one. */
export const LATE_OVER_T = 7 / 6;
export const CATCH_UP_UNDER_T = 0.5;

export type PathLabel = 'server slow' | 'server catch-up' | 'path-held' | 'unmatched';

export interface PathAnomaly {
    /** Server tick of the probe frame that closes the interval. */
    k: number;
    /** The probe's interval into this tick and the engine's own (null: no feed frame for it). */
    probeMs: number;
    serverMs: number | null;
    /** How much later this probe frame arrived than its feed copy, beyond the fitted offset. */
    heldMs: number | null;
    label: PathLabel;
}

export interface PathCheck {
    /** Median of probe arrival minus feed arrival for the same tick, ms (the game frame leaves first). */
    offsetMs: number;
    /** Median absolute deviation of that difference: how tightly the two sockets moved together. */
    offsetSpreadMs: number;
    /** Server tick of the probe's first frame. */
    probeFirstTick: number;
    /** Probe frames whose tick has a feed frame, out of tickArrivalsMs' length. */
    ticksMatched: number;
    /** Late probe intervals (> 7/6 T) the engine's own interval shows too. */
    serverSlow: number;
    /** Probe catch-ups (< T/2 after > 7/6 T) the engine's own intervals show too. */
    serverCatchUp: number;
    /** Late intervals and catch-ups the engine did not produce: the frame was held between the two. */
    pathHeld: number;
    /** Late intervals and catch-ups with no feed frame to compare. */
    unmatched: number;
    /** Every late interval and catch-up, labelled, in probe order. */
    anomalies: PathAnomaly[];
}

const round1 = (v: number) => Math.round(v * 10) / 10 || 0;

function median(values: readonly number[]): number {
    const s = [...values].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** A --log file: one [k, ms, at] line per frame. Unreadable lines are skipped. */
export function parseFeedLog(text: string): FeedTick[] {
    const out: FeedTick[] = [];
    for (const line of text.split('\n')) {
        let v: unknown;
        try {
            v = JSON.parse(line);
        } catch {
            continue;
        }
        if (!Array.isArray(v) || v.length !== 3) continue;
        const [k, ms, at] = v;
        if (!Number.isInteger(k) || !(ms === null || Number.isFinite(ms)) || !Number.isFinite(at)) continue;
        out.push({ k, ms, at });
    }
    return out;
}

/**
 * Which of the probe's late and short ticks the server produced, and which the network path did.
 *
 * `arrivalsMs` is the gate's `result.tickArrivalsMs`: one entry per consecutive tick label,
 * relative to the first, so frame i is server tick k0 + i. `endEpochMs` places the last entry on
 * the epoch clock. Each probe frame within T/2 of a feed frame votes for k0, and of the shifts
 * within 3 ticks of the most voted, the one whose median arrival difference (probe minus feed) is
 * smallest in size is taken, so held frames cannot move the match. That median is the offset; a
 * match that leaves it over T/3, or covers under half the probe, is not a match: the check is null.
 *
 * Then, with the probe interval d into tick k and the engine's own s(k):
 * - late, d > 7/6 T: `server slow` when s(k) > 7/6 T, else `path-held`;
 * - catch-up, d < T/2 right after a late interval: `server catch-up` when s(k-1) > 7/6 T and
 *   s(k) < T/2, else `path-held` (the frame was held and released glued to the next);
 * - `unmatched` when s(k) (or s(k-1) for a catch-up) is unknown.
 * A catch-up's late interval is counted on its own as well, so one server overrun reads 1 slow and
 * 1 catch-up, and one frame held into the next reads 2 path-held.
 */
export function pathCheck(feed: readonly FeedTick[], arrivalsMs: readonly number[], endEpochMs: number, T: number): PathCheck | null {
    const n = arrivalsMs.length;
    if (n < 2 || feed.length < 2 || !(T > 0) || !Number.isFinite(endEpochMs) || !arrivalsMs.every(Number.isFinite)) return null;
    const byK = new Map(feed.map(f => [f.k, f]));
    const base = endEpochMs - arrivalsMs[n - 1]!;
    const abs = arrivalsMs.map(a => base + a);
    // each probe frame within half a tick of a feed frame votes for k0
    const byAt = [...feed].sort((a, b) => a.at - b.at);
    const votes = new Map<number, number>();
    abs.forEach((a, i) => {
        let lo = 0;
        let hi = byAt.length - 1;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (byAt[mid]!.at < a) lo = mid + 1;
            else hi = mid;
        }
        const f = [byAt[lo - 1], byAt[lo]].filter(x => x !== undefined).sort((x, y) => Math.abs(x.at - a) - Math.abs(y.at - a))[0]!;
        if (Math.abs(f.at - a) < T / 2) votes.set(f.k - i, (votes.get(f.k - i) ?? 0) + 1);
    });
    if (votes.size === 0) return null;
    const voted = [...votes].reduce((x, y) => (y[1] > x[1] ? y : x))[0];
    let best: { k0: number; offset: number; res: (number | null)[] } | null = null;
    for (const d of [0, -1, 1, -2, 2, -3, 3]) {
        const k0 = voted + d;
        const res = abs.map((a, i) => {
            const f = byK.get(k0 + i);
            return f ? a - f.at : null;
        });
        const got = res.filter((r): r is number => r !== null);
        if (got.length < n / 2) continue;
        const offset = median(got);
        if (!best || Math.abs(offset) < Math.abs(best.offset)) best = { k0, offset, res };
    }
    if (!best || Math.abs(best.offset) > T / 3) return null;
    const { k0, offset, res } = best;
    const matched = res.filter((r): r is number => r !== null);
    const serverMs = (k: number) => byK.get(k)?.ms ?? null;
    const late = T * LATE_OVER_T;
    const short = T * CATCH_UP_UNDER_T;
    const anomalies: PathAnomaly[] = [];
    for (let i = 1; i < n; i++) {
        const d = arrivalsMs[i]! - arrivalsMs[i - 1]!;
        const isLate = d > late;
        const isCatchUp = i > 1 && d < short && arrivalsMs[i - 1]! - arrivalsMs[i - 2]! > late;
        if (!isLate && !isCatchUp) continue;
        const k = k0 + i;
        const s = serverMs(k);
        const sPrev = serverMs(k - 1);
        const r = res[i];
        let label: PathLabel;
        if (s === null || (isCatchUp && sPrev === null)) label = 'unmatched';
        else if (isLate) label = s > late ? 'server slow' : 'path-held';
        else label = sPrev! > late && s < short ? 'server catch-up' : 'path-held';
        anomalies.push({ k, probeMs: round1(d), serverMs: s, heldMs: r === null || r === undefined ? null : round1(r - offset), label });
    }
    const count = (l: PathLabel) => anomalies.filter(a => a.label === l).length;
    return {
        offsetMs: round1(offset),
        offsetSpreadMs: round1(median(matched.map(r => Math.abs(r - offset)))),
        probeFirstTick: k0,
        ticksMatched: matched.length,
        serverSlow: count('server slow'),
        serverCatchUp: count('server catch-up'),
        pathHeld: count('path-held'),
        unmatched: count('unmatched'),
        anomalies,
    };
}

/** The feed log as kept in the gate record: ticks from k0, the engine's ms and arrivals after t0 (0.1 ms). */
export function compactFeedLog(feed: readonly FeedTick[]) {
    if (feed.length === 0) return null;
    const t0 = feed[0]!.at;
    return { k0: feed[0]!.k, t0EpochMs: round1(t0), k: feed.map(f => f.k - feed[0]!.k), ms: feed.map(f => f.ms), at: feed.map(f => round1(f.at - t0)) };
}

// ------------------------------------------------------------------ feed read

// Nearest rank, as tickSteadiness (speedrun/lib/hostgate-verdict.ts) takes its quantiles.
function stats(values: number[]) {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
    return { n: sorted.length, p50: q(0.5), p90: q(0.9), max: sorted[sorted.length - 1]!, min: sorted[0]! };
}
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function readFeed(server: string, seconds: number, log: string | null) {
    let hello: { tick?: unknown; tickMs?: unknown } | null = null;
    const intervals: number[] = [];
    let frames = 0;
    let lastK: number | null = null;
    let gaps = 0;
    let reported = false;
    let ping: ReturnType<typeof setInterval> | undefined;
    if (log) writeFileSync(log, '');

    const ws = new WebSocket(`wss://${server}/worldfeed`);
    // the 60 s statistics, once; exits unless the log keeps the socket open
    const report = () => {
        if (reported) return;
        reported = true;
        if (!hello) process.exit(1);
        const tickMs = num(hello.tickMs);
        console.log(
            JSON.stringify({
                tickMsConfigured: tickMs !== null && tickMs > 0 ? tickMs : null,
                feedTick: num(hello.tick),
                feedTickMs: stats(intervals),
                feedTickGaps: frames > 0 ? gaps : null,
            })
        );
        if (!log) end();
    };
    const end = () => {
        clearInterval(ping);
        try {
            ws.close();
        } catch {
            // already closed
        }
        report();
        process.exit(0);
    };
    const noHello = setTimeout(end, 8000);
    for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) process.once(signal, end);

    ws.onmessage = event => {
        const at = performance.timeOrigin + performance.now();
        let m: { t?: unknown; k?: unknown; ms?: unknown; tick?: unknown; tickMs?: unknown };
        try {
            m = JSON.parse(String(event.data));
        } catch {
            return;
        }
        if (m.t === 'hello' && !hello) {
            hello = m;
            clearTimeout(noHello);
            ws.send(JSON.stringify({ t: 'sub', x: 2560, z: 2560, w: 1, h: 1 }));
            setTimeout(report, seconds * 1000);
            if (log) ping = setInterval(() => ws.send('{"t":"ping"}'), 60_000);
        } else if (m.t === 'tick' && hello) {
            const k = num(m.k);
            const ms = num(m.ms);
            if (k === null || ms === null) return;
            if (log) appendFileSync(log, `${JSON.stringify([k, frames === 0 ? null : ms, Math.round(at * 100) / 100])}\n`);
            if (reported) return;
            if (lastK !== null && k - lastK > 1) gaps++;
            lastK = k;
            if (frames++ > 0) intervals.push(ms);
        }
    };
    ws.onerror = end;
    ws.onclose = end;
}

// ------------------------------------------------------------------ CLI

function pathCheckCli(logPath: string | undefined, gatePath: string | undefined, endIso: string | undefined, tickArg: string | undefined) {
    let out: { pathCheck: PathCheck | null; feedLog: ReturnType<typeof compactFeedLog> } = { pathCheck: null, feedLog: null };
    try {
        const feed = parseFeedLog(readFileSync(logPath ?? '', 'utf8'));
        out.feedLog = compactFeedLog(feed);
        const gate = JSON.parse(readFileSync(gatePath ?? '', 'utf8')) as { result?: { tickArrivalsMs?: unknown } };
        const arrivals = gate.result?.tickArrivalsMs;
        const known = feed.map(f => f.ms).filter((v): v is number => v !== null);
        const T = Number(tickArg) > 0 ? Number(tickArg) : known.length ? median(known) : NaN;
        if (Array.isArray(arrivals) && endIso) out.pathCheck = pathCheck(feed, arrivals as number[], Date.parse(endIso), T);
    } catch {
        // report-only: whatever could not be read stays null
    }
    console.log(JSON.stringify(out));
}

if (import.meta.main) {
    const args = process.argv.slice(2);
    const opt = (name: string) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
    if (args[0] === '--pathcheck') {
        const [logPath, gatePath, endIso] = args.slice(1).filter(a => !a.startsWith('--'));
        pathCheckCli(logPath, gatePath, endIso, opt('tick-ms'));
    } else {
        const server = args[0];
        const seconds = Number(opt('seconds') ?? 60);
        if (!server || !/^[A-Za-z0-9.-]+(:[0-9]+)?$/.test(server) || !(seconds > 0)) {
            console.error('usage: bun host-gate-feed.ts <server> [--seconds=60] [--log=PATH]\n       bun host-gate-feed.ts --pathcheck <FEED_LOG> <GATE_JSON> <PROBE_END_ISO> [--tick-ms=T]');
            process.exit(64);
        }
        readFeed(server, seconds, opt('log') ?? null);
    }
}
