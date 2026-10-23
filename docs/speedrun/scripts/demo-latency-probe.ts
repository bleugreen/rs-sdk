// Demo-server latency probe (docs/speedrun/research/demo-latency.md).
//
//   cd server/webclient && bun install && cd ../..        # once per checkout (lite client deps)
//   bun docs/speedrun/scripts/demo-latency-probe.ts --label=mac [--bot=NAME] [phases...]
//
// Runs the same way on any machine with bun and curl (a GitHub Actions runner, a cloud VM,
// a home box). Credentials come from BOT_USERNAME/PASSWORD in the environment, else from
// bots/<--bot>/bot.env. Use a throwaway cairn_-prefixed account; the demo auto-registers it on
// first login. Writes one JSON file (--out, default $TMPDIR) and prints a text summary. A
// localhost or 127.* --host (a lab engine) is reached over plain http and ws, as the lite session
// does; the http and ws phases measure the demo's Fly routing and assume TLS.
//
// Phases (default: http,ws,react). Every request is spaced out; nothing here is a load test.
//   http    --http=N fresh-connection GETs of a nonexistent path through curl, --http-gap-ms
//           apart (jittered): TCP connect, TLS, first byte, and Fly's flyio-debug routing
//           fields (edge region nr, app region sr, edge-to-app rtt mrtt). The same on the
//           gateway's own port 7443, which is a separate process from the game engine and so
//           is the network-only control.
//   ws      --ws=N websocket handshakes each on the game path (wss://host/, upgraded by the
//           engine on its tick thread), wss://host/gateway (relayed by the engine), and
//           wss://host:7443 (the gateway process directly).
//   react   logs in with an event-driven lite session (no 20 ms poll, no gateway: the floor
//           for any client at this placement) and walks one tile on a fresh tick, --trials
//           times per entry of --react-delay (ms added between decoding tick T and sending).
//           Each trial records the frame's arrival time, the send time, and the tick on which
//           the step appears. Meanwhile a warm keep-alive GET is timed every ~1.1 s and placed
//           against the tick arrivals, so its server-side wait can be read against tick phase.
//   burst   --bursts=B times: on a fresh tick, --burst-n (<=4) walks --burst-spacing ms apart;
//           reports the tick each lands on, after T and relative to the first.
//   blind   --blind=N walks on a fixed --blind-period (ms, default one tick) clock, not waiting for state (the
//           knife loop's shape), each aimed at the tick after the latest one seen; reports the
//           share landing on the aimed tick and the slip distribution by send phase.
//           burst and blind walk inside a 2x2 block of open ground: run react first, or stand
//           the account somewhere open (tickmanip-latency.ts leaves it in Lumbridge courtyard).
//   sample  --minutes=M of tick steadiness: inbound frame intervals plus /playercount every
//           30 s, no input beyond keepalives.
//
// Ending early. The JSON is rewritten after each unit of work (an http round, a react-delay
// group, a burst, a sample), so even a SIGKILL keeps most of a run. On every other exit it is
// written once more, with `status` and the text summary of what was gathered: the normal end
// (exit 0), a lost game socket (exit 3), SIGTERM or SIGINT (exit 143 or 130; `timeout` sends
// SIGTERM) and an uncaught error (exit 1). An early end records `aborted: {utc, phase, reason,
// kind}` and prints `ABORTED at <utc>: <reason>`. The game socket counts as lost on its close or
// error event, on a failed send, once the connection reports itself closed, or after
// SILENCE_TICKS ticks without a tick. The probe then stops rather than logging in again: a world
// that has just restarted is refilling, which is not a reading of the conditions being measured.
//
// Tick length. tickMs() from speedrun/lib/wait.ts: SPEEDRUN_TICK_MS, else NODE_TICKRATE, else
// 300. The demo announces its tick length in the spectator feed's hello (`tickMs`); pass it as
// SPEEDRUN_TICK_MS. It sets the blind clock's default period, the send-phase buckets and the
// silence watchdog, and is recorded as `tickMs` (and `tickMsFrom`). The frame-interval
// thresholds in frameStats (over400, catchUps) are the run gate's definitions in fixed ms and do
// not follow it.
//
// Timing model. The engine reads input once at the start of a tick and flushes all output at
// its end, on the same thread that serves HTTP and websocket upgrades. A packet sent r ms after
// the tick-T frame arrives lands on T+k when r + RTT < k*tick - C, where C is the time from tick
// start to output flush. So the delay at which reactions flip from k to k+1 ticks measures C.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir, hostname } from 'node:os';
import { join } from 'node:path';
import { tickMs } from '../../../speedrun/lib/wait';

const args = new Map<string, string>();
for (const a of process.argv.slice(2)) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    if (m) args.set(m[1]!, m[2] ?? 'true');
}
const HOST = args.get('host') ?? 'rs-sdk-demo.fly.dev';
const LABEL = args.get('label') ?? hostname();
const PHASES = (args.get('phases') ?? 'http,ws,react').split(',');
const HTTP_N = Number(args.get('http') ?? 40);
const HTTP_GAP = Number(args.get('http-gap-ms') ?? 1500);
const WS_N = Number(args.get('ws') ?? 5);
const TRIALS = Number(args.get('trials') ?? 20);
const DELAYS = (args.get('react-delay') ?? '0').split(',').map(Number);
const MINUTES = Number(args.get('minutes') ?? 10);
const STARTED = new Date();
const OUT = args.get('out') ?? join(process.env.TMPDIR ?? tmpdir(), `demo-latency-${LABEL}-${STARTED.toISOString().replace(/[:.]/g, '-')}.json`);
const REPO = new URL('../../../', import.meta.url).pathname;
const SECURED = !(HOST.startsWith('localhost') || HOST.startsWith('127.'));
const ORIGIN = `${SECURED ? 'https' : 'http'}://${HOST}`;
const TICK_MS = tickMs();
const TICK_MS_FROM = ['SPEEDRUN_TICK_MS', 'NODE_TICKRATE'].find(k => Number(process.env[k]) === TICK_MS && tickMs({ [k]: process.env[k] }) === TICK_MS) ?? 'default';
/**
 * Ticks without a tick after which the game session counts as lost: for a socket that stays open
 * with nothing behind it. The demo's worst recorded overrun is about 1.5 s, far inside this.
 */
const SILENCE_TICKS = 12;

/** Wall clock in ms with sub-ms resolution. */
const now = (): number => performance.timeOrigin + performance.now();
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const jitter = (ms: number) => ms * (0.75 + Math.random() * 0.5);
const pdt = (t: number) => new Date(t).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', hour12: false });

function quantiles(xs: number[]): Record<string, number> | null {
    if (!xs.length) return null;
    const a = [...xs].sort((u, v) => u - v);
    const q = (p: number) => a[Math.min(a.length - 1, Math.floor(p * a.length))]!;
    const r = (v: number) => Math.round(v * 10) / 10;
    return { n: a.length, min: r(a[0]!), p10: r(q(0.1)), p50: r(q(0.5)), p90: r(q(0.9)), max: r(a[a.length - 1]!), mean: r(a.reduce((s, v) => s + v, 0) / a.length) };
}
const fmtQ = (q: Record<string, number> | null) => (q ? `p10 ${q.p10} p50 ${q.p50} p90 ${q.p90} max ${q.max} (n=${q.n})` : '-');
const hist = (xs: number[]) => {
    const h: Record<number, number> = {};
    for (const v of xs) h[v] = (h[v] ?? 0) + 1;
    return h;
};

const report: any = {
    label: LABEL,
    machine: hostname(),
    platform: `${process.platform}/${process.arch}`,
    host: HOST,
    startedUtc: STARTED.toISOString(),
    startedPdt: pdt(STARTED.getTime()),
    args: Object.fromEntries(args),
    tickMs: TICK_MS,
    tickMsFrom: TICK_MS_FROM,
    status: 'running',
    aborted: null
};
/** Summary lines of the phases that have finished; a running phase adds its own (see inPhase). */
const summary: string[] = [`demo-latency-probe ${LABEL} (${hostname()}) ${report.startedPdt} PDT -> ${HOST}, tick ${TICK_MS} ms (${TICK_MS_FROM})`];

// ------------------------------------------------------------------ lifecycle

/** The game socket is gone. `at` is when the probe noticed (wall ms). */
class SessionLost extends Error {
    constructor(
        message: string,
        readonly at: number
    ) {
        super(message);
    }
}

/** A readable reason for a thrown value: ClientStream throws the WebSocket itself on a dead socket. */
function describe(e: unknown): string {
    if (e instanceof Error) return e.message || e.name;
    if (e instanceof WebSocket) return `write to a dead game socket (readyState ${e.readyState})`;
    return String(e);
}

let currentPhase = 'start';
/** The phase in progress and how to write up what it has gathered so far. */
let running: { name: string; snapshot: () => string[] } | null = null;
let aborted: { utc: string; phase: string; reason: string; kind: 'socket' | 'signal' | 'error' } | null = null;
let session: { close: () => void } | null = null;
let finished = false;

/**
 * Run one phase. `snapshot` sets the phase's report section from what it holds now and returns
 * its summary lines; it runs at checkpoints, on an exit mid-phase, and once when the phase ends
 * (however it ends), so it must be idempotent and cope with a phase that stopped anywhere.
 */
async function inPhase(name: string, snapshot: () => string[], body: () => Promise<void>) {
    currentPhase = name;
    running = { name, snapshot };
    try {
        await body();
    } finally {
        running = null;
        summary.push(...snapshot());
    }
}

function composeReport(status: 'running' | 'complete' | 'aborted'): string[] {
    const lines = [...summary, ...(running?.snapshot() ?? [])];
    if (aborted) lines.push(`ABORTED at ${aborted.utc}: ${aborted.reason} (phase ${aborted.phase})`);
    report.status = status;
    report.aborted = aborted;
    report.summary = lines;
    return lines;
}

/** Write through a temporary file, so a kill mid-write leaves the previous checkpoint intact. */
function saveReport() {
    writeFileSync(`${OUT}.partial`, JSON.stringify(report));
    renameSync(`${OUT}.partial`, OUT);
}

/** Rewrite the JSON with everything gathered so far. Call only between timing-sensitive steps. */
function checkpoint() {
    try {
        composeReport('running');
        saveReport();
    } catch (e) {
        console.error(`[probe] checkpoint to ${OUT} failed: ${describe(e)}`);
    }
}

/** Write the JSON and print the summary (once, whichever path gets here first), then exit. */
function finish(code: number): never {
    if (!finished) {
        finished = true;
        try {
            session?.close();
        } catch {}
        report.endedUtc = new Date().toISOString();
        report.endedPdt = pdt(Date.now());
        const lines = composeReport(aborted ? 'aborted' : 'complete');
        try {
            saveReport();
        } catch (e) {
            console.error(`[probe] writing ${OUT} failed: ${describe(e)}`);
        }
        console.log(lines.join('\n'));
        console.log(`json: ${OUT}`);
    }
    process.exit(code);
}

function abort(kind: 'socket' | 'signal' | 'error', reason: string, code: number, at: number = now()): never {
    aborted ??= { utc: new Date(at).toISOString(), phase: currentPhase, reason, kind };
    return finish(code);
}

process.on('SIGTERM', () => abort('signal', 'SIGTERM', 143));
process.on('SIGINT', () => abort('signal', 'SIGINT', 130));
process.on('uncaughtException', e => abort('error', `uncaught: ${describe(e)}`, 1));
process.on('unhandledRejection', e => abort('error', `unhandled rejection: ${describe(e)}`, 1));

const playercount = (): Promise<number | null> =>
    fetch(`${ORIGIN}/playercount`, { signal: AbortSignal.timeout(10_000) })
        .then(r => r.json())
        .then((j: any) => j.count as number)
        .catch(() => null);

/** A note when the world's tick, as measured, is not the tick length the probe was given. */
function tickNote(intervals: Record<string, number> | null): string[] {
    const p50 = intervals?.p50;
    if (!p50 || Math.abs(p50 - TICK_MS) <= 0.15 * TICK_MS) return [];
    return [`note: tick interval p50 ${p50} ms, but the probe ran on tickMs ${TICK_MS} (${TICK_MS_FROM}); set SPEEDRUN_TICK_MS to the world's tick`];
}

// ------------------------------------------------------------------ http

interface CurlSample {
    t: number;
    url: string;
    code: number;
    connectMs: number;
    tlsMs: number;
    ttfbMs: number;
    fly: Record<string, unknown> | null;
    /** ttfb minus TLS minus Fly's own edge-to-app rtt: what is left is the app (plus edge processing). */
    appMs: number | null;
}

function curlOnce(url: string): CurlSample | null {
    const t = now();
    const r = spawnSync('curl', ['-s', '-o', '/dev/null', '-D', '-', '-m', '10', '-H', 'flyio-debug: doit', '-w', '\n@@%{http_code} %{time_connect} %{time_appconnect} %{time_starttransfer}', url], { encoding: 'utf8' });
    const m = /@@(\d+) ([\d.]+) ([\d.]+) ([\d.]+)/.exec(r.stdout ?? '');
    if (!m) return null;
    const dbg = /^flyio-debug:\s*(.*)$/im.exec(r.stdout)?.[1];
    let fly: Record<string, unknown> | null = null;
    try {
        fly = dbg ? JSON.parse(dbg) : null;
    } catch {}
    const [connectMs, tlsMs, ttfbMs] = [m[2], m[3], m[4]].map(v => Number(v) * 1000) as [number, number, number];
    const mrtt = typeof fly?.mrtt === 'number' ? (fly.mrtt as number) : null;
    return { t, url, code: Number(m[1]), connectMs, tlsMs, ttfbMs, fly, appMs: mrtt === null ? null : ttfbMs - tlsMs - mrtt };
}

async function phaseHttp() {
    // http:// is answered by the Fly edge itself (force_https redirect): the edge-only control.
    const targets = [`http://${HOST}/cairn-latency-probe-404`, `https://${HOST}/cairn-latency-probe-404`, `https://${HOST}:7443/cairn-latency-probe-404`];
    const kind = (url: string) => (url.startsWith('http:') ? 'edge' : url.includes(':7443') ? 'gateway' : 'engine');
    const samples: CurlSample[] = [];
    const snapshot = (): string[] => {
        report.http = { samples };
        const lines: string[] = [];
        const fields = new Set<string>();
        for (const s of samples) if (s.fly) fields.add(`nr=${s.fly.nr} sr=${s.fly.sr} sdc=${s.fly.sdc} mhn=${s.fly.mhn}`);
        lines.push(`http fly routes: ${[...fields].join(' | ') || 'none'}`);
        for (const url of targets) {
            const ss = samples.filter(s => s.url === url);
            const mrtt = ss.map(s => s.fly?.mrtt).filter((v): v is number => typeof v === 'number');
            const st = { url, codes: hist(ss.map(s => s.code)), connect: quantiles(ss.map(s => s.connectMs)), tls: quantiles(ss.map(s => s.tlsMs)), ttfb: quantiles(ss.map(s => s.ttfbMs)), mrtt: quantiles(mrtt), app: quantiles(ss.map(s => s.appMs).filter((v): v is number => v !== null)) };
            report.http[kind(url)] = st;
            lines.push(`http ${kind(url).padEnd(7)} ${url} codes ${JSON.stringify(st.codes)}`);
            lines.push(`  connect ${fmtQ(st.connect)}`);
            lines.push(`  tls     ${fmtQ(st.tls)}`);
            lines.push(`  ttfb    ${fmtQ(st.ttfb)}`);
            lines.push(`  mrtt    ${fmtQ(st.mrtt)}`);
            lines.push(`  app = ttfb - tls - mrtt: ${fmtQ(st.app)}`);
        }
        return lines;
    };
    await inPhase('http', snapshot, async () => {
        for (let i = 0; i < HTTP_N; i++) {
            for (const url of targets) {
                const s = curlOnce(url);
                if (s) samples.push(s);
                await sleep(jitter(HTTP_GAP / 2));
            }
            checkpoint();
        }
    });
}

// ------------------------------------------------------------------ ws

function wsHandshake(url: string, protocol?: string): Promise<number | null> {
    return new Promise(resolve => {
        const t0 = performance.now();
        let done = false;
        const ws = protocol ? new WebSocket(url, protocol) : new WebSocket(url);
        const finish = (v: number | null) => {
            if (done) return;
            done = true;
            try {
                ws.close();
            } catch {}
            resolve(v);
        };
        ws.onopen = () => finish(performance.now() - t0);
        ws.onerror = () => finish(null);
        setTimeout(() => finish(null), 10_000);
    });
}

async function phaseWs() {
    const targets: [string, string, string?][] = [
        ['game', `wss://${HOST}/`, 'binary'],
        ['relay', `wss://${HOST}/gateway`],
        ['gateway', `wss://${HOST}:7443`]
    ];
    const res: Record<string, number[]> = { game: [], relay: [], gateway: [] };
    const snapshot = (): string[] => {
        report.ws = Object.fromEntries(Object.entries(res).map(([k, v]) => [k, { samples: v, q: quantiles(v) }]));
        return Object.entries(res).map(([k, v]) => `ws handshake ${k.padEnd(7)} (fresh TCP+TLS+upgrade) ${fmtQ(quantiles(v))}`);
    };
    await inPhase('ws', snapshot, async () => {
        for (let i = 0; i < WS_N; i++) {
            for (const [name, url, proto] of targets) {
                const v = await wsHandshake(url, proto);
                if (v !== null) res[name]!.push(v);
                await sleep(jitter(1000));
            }
            checkpoint();
        }
    });
}

// ------------------------------------------------------------------ session

function credentials(): { username: string; password: string } {
    if (process.env.BOT_USERNAME && process.env.PASSWORD) return { username: process.env.BOT_USERNAME, password: process.env.PASSWORD };
    const bot = args.get('bot');
    const path = bot ? join(REPO, 'bots', bot, 'bot.env') : '';
    if (!bot || !existsSync(path)) throw new Error('no credentials: set BOT_USERNAME and PASSWORD, or pass --bot=NAME with bots/NAME/bot.env');
    const env = Object.fromEntries(
        readFileSync(path, 'utf8')
            .split('\n')
            .filter(l => l.includes('=') && !l.startsWith('#'))
            .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
    );
    if (!env.BOT_USERNAME || !env.PASSWORD) throw new Error(`no credentials: ${path} lacks BOT_USERNAME or PASSWORD`);
    return { username: env.BOT_USERNAME, password: env.PASSWORD };
}

interface Frame {
    /** Arrival of the websocket message (wall ms). */
    t: number;
    bytes: number;
}
interface Tick {
    label: number;
    /** Arrival of the last frame decoded in this drain. */
    arrival: number;
    decoded: number;
    x: number;
    z: number;
}

/**
 * A lite session driven by socket events rather than session.ts's 20 ms poll, so the reaction
 * starts within a millisecond of the frame arriving.
 */
async function openSession() {
    await import('../../../server/webclient/src/lite/dom-shim.js');
    const { loadCache } = await import('../../../server/webclient/src/lite/cache.js');
    const { LocIndex } = await import('../../../server/webclient/src/lite/world/LocIndex.js');
    const { GameConnection } = await import('../../../server/webclient/src/lite/net/GameConnection.js');
    const { LiteClient } = await import('../../../server/webclient/src/lite/LiteClient.js');
    const { ClientProt } = await import('../../../server/webclient/src/io/ClientProt.js');

    const { username, password } = credentials();
    const cacheDir = `${process.env.HOME ?? tmpdir()}/.cache/rs-sdk-lite`;
    const { checksums } = await loadCache({ origin: ORIGIN, cacheDir, quiet: true });
    const locIndex = await LocIndex.load({ origin: ORIGIN, cacheDir, versionlistCrc: checksums[5]!, quiet: true });
    const tLogin = now();
    const connection = await GameConnection.connect({ host: HOST, secured: SECURED, username, password, checksums });
    const loginMs = now() - tLogin;
    const client = new LiteClient({ connection, locIndex, username, password });

    const frames: Frame[] = [];
    const ticks: Tick[] = [];
    const listeners: ((t: Tick) => void)[] = [];
    let label = 0;
    let lastArrival = 0;
    let lastTickAt = now();
    let pumping = false;
    let again = false;

    // The session ends when the socket does: its close or error event, a failed send, the
    // connection reporting itself closed, or SILENCE_TICKS ticks without a tick. Every wait on
    // the server races `lostP` (guard), so a phase stops at once instead of waiting for ticks that
    // will not come.
    let lost: SessionLost | null = null;
    let closedByUs = false;
    let rejectLost!: (e: SessionLost) => void;
    const lostP = new Promise<never>((_, reject) => (rejectLost = reject));
    lostP.catch(() => {});
    const markLost = (reason: string) => {
        if (lost || closedByUs) return;
        lost = new SessionLost(reason, now());
        clearInterval(keepalive);
        clearInterval(watchdog);
        console.error(`[probe] game session lost: ${reason}`);
        rejectLost(lost);
    };
    /** Queue packets with `queue` and flush them; false (and the session lost) if the socket is gone. */
    const trySend = (queue: () => void = () => {}): boolean => {
        if (lost) return false;
        if (connection.isClosed) {
            markLost('game connection closed');
            return false;
        }
        try {
            queue();
            client.flush();
            return true;
        } catch (e) {
            markLost(`send failed: ${describe(e)}`);
            return false;
        }
    };

    const pump = async () => {
        if (pumping) {
            again = true;
            return;
        }
        pumping = true;
        try {
            do {
                again = false;
                const arrival = lastArrival;
                await client.pumpPackets();
                client.tickCycle();
                client.flush();
                (pump as any).arrival = arrival;
            } while (again);
        } catch (e) {
            if (connection.isClosed || e instanceof WebSocket) markLost(`pump failed: ${describe(e)}`);
            else console.error('[probe] pump failed', e);
        } finally {
            pumping = false;
        }
    };
    client.setOnGameTickCallback(n => {
        label += n;
        lastTickAt = now();
        const p = client.getPlayerPosition();
        const t: Tick = { label, arrival: lastArrival, decoded: now(), x: p?.worldX ?? -1, z: p?.worldZ ?? -1 };
        ticks.push(t);
        for (const l of listeners) l(t);
    });
    const keepalive = setInterval(() => trySend(() => client.writeOpcode(ClientProt.NO_TIMEOUT)), 1000);
    const watchdog = setInterval(() => {
        const silent = now() - lastTickAt;
        if (connection.isClosed) markLost('game connection closed');
        else if (silent > SILENCE_TICKS * TICK_MS) markLost(`no game tick for ${Math.round(silent)} ms (${SILENCE_TICKS} ticks of ${TICK_MS} ms)`);
    }, 250);
    const sock = (connection.stream as any).socket as WebSocket;
    sock.addEventListener('message', (ev: MessageEvent) => {
        lastArrival = now();
        frames.push({ t: lastArrival, bytes: (ev.data as ArrayBuffer).byteLength ?? 0 });
        void pump();
    });
    sock.addEventListener('close', (ev: CloseEvent) => markLost(`game socket closed (code ${ev.code}${ev.reason ? ` ${ev.reason}` : ''})`));
    sock.addEventListener('error', () => markLost('game socket error'));
    void pump();

    return {
        client,
        frames,
        ticks,
        loginMs,
        username,
        onTick: (l: (t: Tick) => void) => listeners.push(l),
        offTick: (l: (t: Tick) => void) => listeners.splice(listeners.indexOf(l), 1),
        trySend,
        /** trySend, throwing SessionLost if the socket is gone. */
        send: (queue?: () => void) => {
            if (!trySend(queue)) throw lost!;
        },
        /** Throw SessionLost if the socket is gone. */
        check: () => {
            if (lost) throw lost;
        },
        /** `p`, or SessionLost as soon as the socket is gone. */
        guard: <T>(p: Promise<T>): Promise<T> => Promise.race([p, lostP]),
        close: () => {
            closedByUs = true;
            clearInterval(keepalive);
            clearInterval(watchdog);
            connection.close();
        }
    };
}
type Session = Awaited<ReturnType<typeof openSession>>;

/** Warm keep-alive GETs spaced ~1.1 s apart, until stop() resolves. */
function warmHttpSampler(urls: string[]) {
    const samples: { url: string; t0: number; t1: number }[] = [];
    let running = true;
    const loop = (async () => {
        for (const u of urls) await fetch(u).then(r => r.arrayBuffer()).catch(() => {}); // open the pooled connections
        let i = 0;
        while (running) {
            const url = urls[i++ % urls.length]!;
            const t0 = now();
            try {
                const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
                const t1 = now();
                await r.arrayBuffer();
                samples.push({ url, t0, t1 });
            } catch {}
            await sleep(jitter(1100));
        }
    })();
    return {
        samples,
        stop: async () => {
            running = false;
            await loop;
        }
    };
}

/** Index of the last frame that arrived at or before t (binary search). */
function frameBefore(frames: Frame[], t: number): number {
    let lo = 0;
    let hi = frames.length - 1;
    let best = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (frames[mid]!.t <= t) {
            best = mid;
            lo = mid + 1;
        } else hi = mid - 1;
    }
    return best;
}

/**
 * A tick's output can arrive as several websocket messages, and the demo also sends small
 * non-tick frames (1-4 bytes) between ticks. Group messages of at least 5 bytes that arrive less
 * than 8 ms apart into one burst and measure the intervals between burst starts. A wider grouping
 * (this used 60 ms) merges a catch-up tick into the tick before it and hides overruns
 * (cairn://p/rs/102). For per-trial intervals, prefer the decoded tick timeline (`react.ticks`).
 */
function frameStats(frames: Frame[]) {
    const bursts: { t: number; n: number; bytes: number; spanMs: number }[] = [];
    for (const f of frames) {
        if (f.bytes < 5) continue;
        const b = bursts.at(-1);
        if (b && f.t - (b.t + b.spanMs) < 8) {
            b.n++;
            b.bytes += f.bytes;
            b.spanMs = f.t - b.t;
        } else bursts.push({ t: f.t, n: 1, bytes: f.bytes, spanMs: 0 });
    }
    const iv: number[] = [];
    for (let i = 1; i < bursts.length; i++) iv.push(bursts[i]!.t - bursts[i - 1]!.t);
    return {
        intervals: quantiles(iv),
        over400: iv.filter(v => v > 400).length,
        /** an interval under 150 ms right after one over 350 ms: the engine catching up after an overrun */
        catchUps: iv.filter((v, i) => i > 0 && v < 150 && iv[i - 1]! > 350).length,
        n: iv.length,
        messagesPerBurst: quantiles(bursts.map(b => b.n)),
        burstSpanMs: quantiles(bursts.map(b => b.spanMs)),
        raw: frames.map(f => [Math.round(f.t * 10) / 10, f.bytes])
    };
}

async function waitTicks(s: Session, n: number) {
    const target = (s.ticks.at(-1)?.label ?? 0) + n;
    while ((s.ticks.at(-1)?.label ?? 0) < target) {
        s.check();
        await sleep(20);
    }
}

interface Trial {
    delay: number;
    label: number;
    arrival: number;
    decoded: number;
    sent: number;
    /** sent - arrival of the tick-T frame */
    reactMs: number;
    ticks: number;
    /** arrival of the frame that showed the step, minus arrival of the tick-T frame */
    effectMs: number | null;
}

async function phaseReact(s: Session) {
    let home: [number, number] | null = null;
    const steps: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    let stepIdx = 0;
    const trials: Trial[] = [];
    let http: ReturnType<typeof warmHttpSampler> | null = null;
    // The gateway on :7443 is the demo's; a lab engine has none.
    const warmUrls = SECURED ? [`${ORIGIN}/cairn-latency-probe-404`, `https://${HOST}:7443/cairn-latency-probe-404`] : [`${ORIGIN}/cairn-latency-probe-404`];
    await inPhase('react', () => reactSnapshot(s, home, trials, http?.samples ?? []), async () => {
        try {
            await waitTicks(s, 5);
            const start = s.ticks.at(-1)!;
            const at: [number, number] = (home = [start.x, start.z]);
            http = warmHttpSampler(warmUrls);
            for (const delay of DELAYS) {
                await s.guard(reactGroup(delay, at));
                checkpoint();
            }
            await http.stop();
        } finally {
            void http?.stop();
        }
    });

    function reactGroup(delay: number, home: [number, number]) {
        let done = 0;
        return new Promise<void>(resolve => {
            let pending: { label: number; from: string; arrival: number; decoded: number; sent: number } | null = null;
            let cooldown = 2;
            const l = (t: Tick) => {
                const pos = `${t.x},${t.z}`;
                if (pending) {
                    if (pending.sent === 0) return; // delayed send not out yet
                    if (pos !== pending.from || t.label - pending.label > 6) {
                        const moved = pos !== pending.from;
                        trials.push({ delay, label: pending.label, arrival: pending.arrival, decoded: pending.decoded, sent: pending.sent, reactMs: pending.sent - pending.arrival, ticks: moved ? t.label - pending.label : 99, effectMs: moved ? t.arrival - pending.arrival : null });
                        if (!moved) stepIdx++;
                        pending = null;
                        cooldown = 2;
                        if (++done >= TRIALS) {
                            s.offTick(l);
                            resolve();
                        }
                    }
                    return;
                }
                if (cooldown-- > 0) return;
                const atHome = t.x === home[0] && t.z === home[1];
                const [dx, dz] = steps[stepIdx % steps.length]!;
                const [tx, tz] = atHome ? [home[0] + dx, home[1] + dz] : home;
                const p = { label: t.label, from: pos, arrival: t.arrival, decoded: t.decoded, sent: 0 };
                pending = p;
                const send = () => {
                    let moved = true;
                    if (!s.trySend(() => (moved = s.client.walkTo(tx, tz, false).moved))) return; // lost: s.guard ends the group
                    p.sent = now();
                    if (!moved) stepIdx++;
                };
                if (delay > 0) setTimeout(send, Math.max(0, t.arrival + delay - now()));
                else send();
            };
            s.onTick(l);
        });
    }
}

/** The react phase's report section and summary from the trials gathered so far. */
function reactSnapshot(s: Session, home: [number, number] | null, trials: Trial[], warmSamples: { url: string; t0: number; t1: number }[]): string[] {
    // Per trial: the landed tick, and the tick-to-tick arrival intervals around the trigger, so a
    // slow trial can be tied to an overrun (interval well over a tick) or a short idle gap.
    const arrivalOf = new Map(s.ticks.map(t => [t.label, t.arrival]));
    const gap = (a: number, b: number) => (arrivalOf.has(a) && arrivalOf.has(b) ? Math.round((arrivalOf.get(b)! - arrivalOf.get(a)!) * 10) / 10 : null);
    for (const t of trials as (Trial & Record<string, unknown>)[]) {
        t.landedLabel = t.ticks === 99 ? null : t.label + t.ticks;
        t.prevIntervalMs = gap(t.label - 1, t.label);
        t.nextIntervalMs = gap(t.label, t.label + 1);
        t.landedIntervalMs = t.ticks === 99 ? null : gap(t.label + t.ticks - 1, t.label + t.ticks);
    }

    // Place each warm request against the tick frames: phase = time since the last frame arrival.
    const warm = warmSamples.map(h => {
        const i = frameBefore(s.frames, h.t0);
        return { gateway: h.url.includes(':7443'), ttfbMs: h.t1 - h.t0, phaseMs: i >= 0 ? h.t0 - s.frames[i]!.t : null, t0: h.t0 };
    });
    report.react = { home, trials, warm, frames: frameStats(s.frames), ticks: s.ticks.map(t => [t.label, Math.round(t.arrival * 10) / 10, Math.round(t.decoded * 10) / 10]) };
    const lines = [`react: login ${s.loginMs.toFixed(0)} ms, ${s.frames.length} messages, msgs/tick ${fmtQ(report.react.frames.messagesPerBurst)}, tick interval ${fmtQ(report.react.frames.intervals)}`];
    lines.push(...tickNote(report.react.frames.intervals));
    for (const delay of DELAYS) {
        const ts = trials.filter(t => t.delay === delay);
        if (ts.length) lines.push(`react delay +${delay} ms: ticks ${JSON.stringify(hist(ts.map(t => t.ticks)))}  reactMs ${fmtQ(quantiles(ts.map(t => t.reactMs)))}`);
    }
    const missing = DELAYS.filter(d => !trials.some(t => t.delay === d));
    if (missing.length) lines.push(`react: no trials at +${missing.join(', +')} ms`);
    for (const gw of [false, true]) {
        const ws = warm.filter(w => w.gateway === gw);
        lines.push(`warm GET ${gw ? 'gateway:7443' : 'engine:443 '} ttfb ${fmtQ(quantiles(ws.map(w => w.ttfbMs)))}`);
        // ttfb by phase bucket (50 ms buckets since last frame arrival, up to two ticks)
        const buckets: Record<string, number[]> = {};
        for (const w of ws) if (w.phaseMs !== null && w.phaseMs < 2 * TICK_MS) (buckets[String(Math.floor(w.phaseMs / 50) * 50)] ??= []).push(w.ttfbMs);
        lines.push('  by phase since frame: ' + Object.entries(buckets).sort((a, b) => Number(a[0]) - Number(b[0])).map(([k, v]) => `${k}:${quantiles(v)!.p50}(${v.length})`).join(' '));
    }
    return lines;
}

// ------------------------------------------------------------------ burst and blind
//
// Both walk inside a 2x2 block of tiles at `home`. Every tile of the block is adjacent to every
// other, so each landed walk completes in the tick it lands, and the position at a tick is the
// destination of the last walk the server processed by then. Consecutive packets aim at different
// tiles, so a packet is either visible (its tile shows on the tick it landed) or absorbed by the
// next one on the same tick (the server keeps the last walk). Harmless: four tiles of open ground.
const BLOCK: [number, number][] = [[1, 0], [1, 1], [0, 1], [0, 0]];
const BURSTS = Number(args.get('bursts') ?? 20);
const BURST_N = Math.min(4, Number(args.get('burst-n') ?? 3));
const BURST_SPACING = Number(args.get('burst-spacing') ?? 70);
const BLIND_N = Number(args.get('blind') ?? 200);
const BLIND_PERIOD = Number(args.get('blind-period') ?? TICK_MS);
const BLIND_OFFSET = Number(args.get('blind-offset') ?? 0);

function nextTick(s: Session): Promise<Tick> {
    return s.guard(
        new Promise(resolve => {
            const l = (t: Tick) => {
                s.offTick(l);
                resolve(t);
            };
            s.onTick(l);
        })
    );
}

async function goHome(s: Session, home: [number, number]) {
    for (let i = 0; i < 3; i++) {
        const t = s.ticks.at(-1)!;
        if (t.x === home[0] && t.z === home[1]) return;
        s.send(() => s.client.walkTo(home[0], home[1], false));
        await waitTicks(s, 4);
    }
}

const blockIndex = (t: Tick, home: [number, number]) => BLOCK.findIndex(([dx, dz]) => t.x === home[0] + dx && t.z === home[1] + dz);

async function phaseBurst(s: Session) {
    let home: [number, number] | null = null;
    const bursts: { label: number; arrival: number; sentOffsetMs: number[]; landed: (number | null)[]; absorbed: boolean[]; nextIntervalMs: number | null }[] = [];
    const snapshot = (): string[] => {
        report.burst = { home, n: BURST_N, spacingMs: BURST_SPACING, bursts };
        const lines = [`burst: ${bursts.length} of ${BURSTS} bursts of ${BURST_N} walks, ${BURST_SPACING} ms apart after the tick frame`];
        for (let i = 0; i < BURST_N; i++) {
            const ls = bursts.map(b => b.landed[i]).filter((v): v is number => v !== null);
            const rel = bursts.filter(b => b.landed[i] !== null && b.landed[0] !== null).map(b => b.landed[i]! - b.landed[0]!);
            lines.push(`  packet ${i} (+${i * BURST_SPACING} ms): ticks after T ${JSON.stringify(hist(ls))}  relative to packet 0 ${JSON.stringify(hist(rel))}  undetected ${bursts.length - ls.length}`);
        }
        return lines;
    };
    await inPhase('burst', snapshot, async () => {
        await waitTicks(s, 3);
        const at: [number, number] = (home = [s.ticks.at(-1)!.x, s.ticks.at(-1)!.z]);
        for (let b = 0; b < BURSTS; b++) {
            bursts.push(await burstOnce(at));
            checkpoint();
        }
        await goHome(s, at);
    });

    async function burstOnce(home: [number, number]) {
        await goHome(s, home);
        await waitTicks(s, 1);
        const t = await nextTick(s);
        const sent: number[] = [];
        for (let i = 0; i < BURST_N; i++) {
            const due = t.arrival + i * BURST_SPACING;
            if (due > now()) await sleep(due - now());
            s.send(() => s.client.walkTo(home[0] + BLOCK[i]![0], home[1] + BLOCK[i]![1], false));
            sent.push(now() - t.arrival);
        }
        await waitTicks(s, 7);
        const landed: (number | null)[] = Array(BURST_N).fill(null);
        const absorbed: boolean[] = Array(BURST_N).fill(false);
        let last = -1;
        for (const o of s.ticks.filter(o => o.label > t.label && o.label <= t.label + 7)) {
            const idx = blockIndex(o, home);
            // home is BLOCK[3]; it only counts once the player has left it
            if (idx > last && idx < BURST_N && (idx !== 3 || last >= 0)) {
                for (let j = last + 1; j <= idx; j++) {
                    landed[j] = o.label - t.label;
                    absorbed[j] = j < idx;
                }
                last = idx;
            }
        }
        const next = s.ticks.find(o => o.label === t.label + 1);
        return { label: t.label, arrival: t.arrival, sentOffsetMs: sent.map(v => Math.round(v * 10) / 10), landed, absorbed, nextIntervalMs: next ? Math.round((next.arrival - t.arrival) * 10) / 10 : null };
    }
}

async function phaseBlind(s: Session) {
    let home: [number, number] | null = null;
    const sends: { k: number; sent: number; aimed: number; phaseMs: number; landed: number | null; absorbed: boolean }[] = [];
    let last = -1;
    const l = (t: Tick) => {
        if (!home) return;
        // smallest k beyond the last visible packet whose tile matches; packets in between were absorbed
        for (let k = last + 1; k < sends.length; k++) {
            if (BLOCK[k % 4]![0] === t.x - home[0] && BLOCK[k % 4]![1] === t.z - home[1]) {
                for (let j = last + 1; j <= k; j++) {
                    sends[j]!.landed = t.label;
                    sends[j]!.absorbed = j < k;
                }
                last = k;
                break;
            }
        }
    };
    const snapshot = (): string[] => {
        const slips = sends.filter(x => x.landed !== null).map(x => x.landed! - x.aimed);
        report.blind = { home, periodMs: BLIND_PERIOD, offsetMs: BLIND_OFFSET, sends };
        const lines = [`blind: ${sends.length} of ${BLIND_N} walks every ${BLIND_PERIOD} ms, aimed at (latest tick seen)+1`];
        lines.push(`  slip (landed - aimed) ${JSON.stringify(hist(slips))}  on aim ${((slips.filter(v => v === 0).length / Math.max(1, slips.length)) * 100).toFixed(0)}%  absorbed ${sends.filter(x => x.absorbed).length}  undetected ${sends.length - slips.length}`);
        const buckets: Record<string, number[]> = {};
        for (const x of sends) if (x.landed !== null && x.phaseMs < 2 * TICK_MS) (buckets[String(Math.floor(x.phaseMs / 50) * 50)] ??= []).push(x.landed - x.aimed);
        lines.push('  on-aim share by send phase since frame: ' + Object.entries(buckets).sort((a, b) => Number(a[0]) - Number(b[0])).map(([k, v]) => `${k}:${Math.round((v.filter(x => x === 0).length / v.length) * 100)}%(${v.length})`).join(' '));
        return lines;
    };
    await inPhase('blind', snapshot, async () => {
        await waitTicks(s, 3);
        await goHome(s, home0(s));
        const at: [number, number] = (home = [s.ticks.at(-1)!.x, s.ticks.at(-1)!.z]);
        s.onTick(l);
        try {
            const first = await nextTick(s);
            const t0 = first.arrival + BLIND_OFFSET;
            // No checkpoints inside the clock: writing the JSON would shift the sends it is timing.
            for (let k = 0; k < BLIND_N; k++) {
                const due = t0 + k * BLIND_PERIOD;
                if (due > now()) await sleep(due - now());
                const seen = s.ticks.at(-1)!;
                s.send(() => s.client.walkTo(at[0] + BLOCK[k % 4]![0], at[1] + BLOCK[k % 4]![1], false));
                const sent = now();
                sends.push({ k, sent, aimed: seen.label + 1, phaseMs: Math.round((sent - seen.arrival) * 10) / 10, landed: null, absorbed: false });
            }
            await waitTicks(s, 6);
        } finally {
            s.offTick(l);
        }
        await goHome(s, at);
    });
}
const home0 = (s: Session): [number, number] => [s.ticks.at(-1)!.x, s.ticks.at(-1)!.z];

async function phaseSample(s: Session) {
    const counts: { t: number; count: number | null }[] = [];
    const first = s.frames.length;
    const snapshot = (): string[] => {
        report.sample = { minutes: MINUTES, counts, frames: frameStats(s.frames.slice(first)) };
        const cs = counts.map(c => c.count).filter((v): v is number => v !== null);
        const minutes = counts.length ? Math.round(((counts.at(-1)!.t - counts[0]!.t) / 60_000) * 10) / 10 : 0;
        return [`sample ${MINUTES} min (${minutes} min between first and last count): players ${cs.length ? `${Math.min(...cs)}-${Math.max(...cs)}` : '-'}, tick interval ${fmtQ(report.sample.frames.intervals)}, >400 ms: ${report.sample.frames.over400}/${report.sample.frames.n}`, ...tickNote(report.sample.frames.intervals)];
    };
    await inPhase('sample', snapshot, async () => {
        const end = now() + MINUTES * 60_000;
        while (now() < end) {
            counts.push({ t: now(), count: await s.guard(playercount()) });
            checkpoint();
            await s.guard(sleep(30_000));
        }
    });
}

// ------------------------------------------------------------------ main

try {
    report.playercountStart = await playercount();
    summary.push(`players online at start: ${report.playercountStart}`);
    if (PHASES.includes('http')) await phaseHttp();
    if (PHASES.includes('ws')) await phaseWs();
    if (['react', 'burst', 'blind', 'sample'].some(p => PHASES.includes(p))) {
        currentPhase = 'login';
        const s = await openSession();
        session = s;
        try {
            if (PHASES.includes('react')) await phaseReact(s);
            if (PHASES.includes('burst')) await phaseBurst(s);
            if (PHASES.includes('blind')) await phaseBlind(s);
            if (PHASES.includes('sample')) await phaseSample(s);
        } finally {
            s.close();
        }
    }
    currentPhase = 'end';
    report.playercountEnd = await playercount();
    summary.push(`players online at end: ${report.playercountEnd}`);
} catch (e) {
    if (e instanceof SessionLost) abort('socket', e.message, 3, e.at);
    abort('error', describe(e), 1);
}
finish(0);
