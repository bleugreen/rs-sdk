#!/usr/bin/env bun
// Login-free tick-length read from the engine's spectator feed (server/engine/src/web/worldfeed.ts),
// run by host-gate-read.sh before the gate logs in.
//
//   bun host-gate-feed.ts <server> [--seconds=60]
//
// Connects to wss://<server>/worldfeed, takes the hello frame's tickMs (World.tickRate, the
// configured rate) and tick, subscribes to an empty 1x1 tile and collects the {t:'tick', k, ms}
// frames for --seconds. `ms` is the engine's own interval between feed cycles. The first tick
// frame is left out of the interval stats: the engine only advances its clock while a feed client
// is connected, so that frame can carry the whole gap since the last client left. Prints one JSON
// line {tickMsConfigured, feedTick, feedTickMs: {n, p50, p90, max, min} | null, feedTickGaps}
// (gaps: consecutive frames whose k jumps by more than 1) and exits 0, or exits 1 with no output
// when no hello arrived. The engine expires feeds idle for 2 min; this one closes itself first.

const server = process.argv[2];
const seconds = Number(process.argv.find(a => a.startsWith('--seconds='))?.slice(10) ?? 60);
if (!server || !/^[A-Za-z0-9.-]+(:[0-9]+)?$/.test(server) || !(seconds > 0)) {
    console.error('usage: bun host-gate-feed.ts <server> [--seconds=60]');
    process.exit(64);
}

// Nearest rank, as tickSteadiness (speedrun/lib/hostgate-verdict.ts) takes its quantiles.
function stats(values: number[]) {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
    return { n: sorted.length, p50: q(0.5), p90: q(0.9), max: sorted[sorted.length - 1]!, min: sorted[0]! };
}
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

let hello: { tick?: unknown; tickMs?: unknown } | null = null;
const intervals: number[] = [];
let frames = 0;
let lastK: number | null = null;
let gaps = 0;
let finished = false;

const ws = new WebSocket(`wss://${server}/worldfeed`);
const finish = () => {
    if (finished) return;
    finished = true;
    try {
        ws.close();
    } catch {
        // already closed
    }
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
    process.exit(0);
};
const noHello = setTimeout(finish, 8000);

ws.onmessage = event => {
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
        setTimeout(finish, seconds * 1000);
    } else if (m.t === 'tick' && hello) {
        const k = num(m.k);
        const ms = num(m.ms);
        if (k === null || ms === null) return;
        if (lastK !== null && k - lastK > 1) gaps++;
        lastK = k;
        if (frames++ > 0) intervals.push(ms);
    }
};
ws.onerror = finish;
ws.onclose = finish;
