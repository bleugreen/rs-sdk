// Headless Chrome on the browser webclient, for the browser mode of the demo-latency
// workflow (.github/workflows/demo-latency-probe.yml, mode=browser).
//
// Run it with `bun --no-install` (see the workflow's header: auto-install breaks puppeteer's load).
//
//   bun --no-install docs/speedrun/scripts/demo-browser-page.ts open --dir=DIR --url=http://127.0.0.1:8899/bot?bot=NAME
//       [--chrome=PATH] [--gateway-port=7851] [--load-only]
//     Opens the page (served by the branch's server/webclient/proxy.ts, which adds ?server= and
//     ?gateway=), logs BOT_USERNAME in with gameClient.autoLogin and writes DIR/ready once in
//     game. PASSWORD comes from the environment and goes into the page as a function argument,
//     so it is in no URL and no log. It holds the session until DIR/stop exists or it gets
//     SIGINT/SIGTERM, then closes the page: the game socket closes, which the engine treats as
//     a logout. Meanwhile it records every websocket frame of the page (DIR/frames.jsonl: wall
//     ms, socket, direction, bytes, gateway message type), the in-game flag every 5 s
//     (DIR/health.jsonl) and page errors (DIR/page.log). --load-only holds the loaded client
//     without logging in: a check of the page server, bundle, Chrome and eval with no session.
//
//   bun docs/speedrun/scripts/demo-browser-page.ts eval --dir=DIR [--progress=EXPR] [--every=15]
//       [--json=FILE] [--timeout-min=30] EXPR
//     Connects to the held browser, evaluates EXPR in the page (a promise is awaited, polling
//     --progress every --every seconds), and prints the result as JSON. A tick program's final
//     status (rsPrograms.run on the in-page branch) also gets summary lines: the probe's
//     counts in the "latency in ticks" form tickmanip-latency.ts prints, or the knife cycle's
//     ticks per roll. Exits 1 on an exception or a program that ends in fault.
//
//   bun docs/speedrun/scripts/demo-browser-page.ts frames --dir=DIR [--from=MS] [--to=MS]
//     Where the time goes on the page's sockets between two epoch-ms marks: the interval
//     between tick outputs arriving on the game socket (and the catch-up ticks: under 150 ms
//     right after one over 350 ms), how long after a tick's output each
//     game packet leaves, and for every gateway action the chain
//       tick output in -> state out to the gateway -> action in from the gateway -> game packet out.
//     Frame times are the browser's own (Chrome DevTools Network events), so they exclude
//     the driver's event delivery.
import puppeteer, { type Page } from 'puppeteer';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const [cmd, ...rest] = process.argv.slice(2);
const opt = (name: string, def?: string) => rest.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? def;
const positional = rest.filter(a => !a.startsWith('--'));
const DIR = opt('dir');
if (!cmd || !DIR || !['open', 'eval', 'frames'].includes(cmd)) {
    console.error('usage: demo-browser-page.ts open|eval|frames --dir=DIR ... (see the header)');
    process.exit(2);
}
mkdirSync(DIR, { recursive: true });
const ENDPOINT = join(DIR, 'endpoint');
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const stamp = () => new Date().toISOString();
const HOUR = 60 * 60_000;

const q = (xs: number[], p: number) => {
    if (!xs.length) return NaN;
    const a = [...xs].sort((u, v) => u - v);
    return a[Math.min(a.length - 1, Math.floor(p * a.length))]!;
};
const quantiles = (xs: number[]) => xs.length
    ? `p10 ${q(xs, 0.1).toFixed(0)} p50 ${q(xs, 0.5).toFixed(0)} p90 ${q(xs, 0.9).toFixed(0)} max ${q(xs, 1).toFixed(0)} (n ${xs.length})`
    : 'none';

if (cmd === 'open') await open();
else if (cmd === 'eval') await evaluate();
else frames();

async function open() {
    const url = opt('url');
    const user = process.env.BOT_USERNAME;
    const password = process.env.PASSWORD;
    delete process.env.PASSWORD;
    const loadOnly = rest.includes('--load-only');
    if (!url || (!loadOnly && (!user || !password))) {
        console.error('open needs --url, BOT_USERNAME and PASSWORD');
        process.exit(2);
    }
    const log = (line: string) => { const l = `${stamp()} ${line}`; console.log(l); appendFileSync(join(DIR!, 'page.log'), l + '\n'); };

    const browser = await puppeteer.launch({
        executablePath: opt('chrome') || undefined,
        headless: true,
        protocolTimeout: HOUR,
        defaultViewport: { width: 1024, height: 768 },
        args: [
            '--no-sandbox',
            '--mute-audio',
            '--autoplay-policy=no-user-gesture-required',
            // A headless tab is never visible: keep its timers and frames at full rate, as in a focused tab.
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-ipc-flooding-protection',
            '--disable-dev-shm-usage',
            '--window-size=1024,768'
        ]
    });
    writeFileSync(ENDPOINT, browser.wsEndpoint());
    log(`chrome ${await browser.version()}`);
    const page = await browser.newPage();
    page.on('pageerror', e => log(`pageerror ${e instanceof Error ? e.message : String(e)}`));
    page.on('console', m => { if (m.type() === 'error' || m.type() === 'warn') log(`console.${m.type()} ${m.text().slice(0, 300)}`); });
    page.on('requestfailed', r => log(`requestfailed ${r.url().slice(0, 120)} ${r.failure()?.errorText ?? ''}`));
    const flushFrames = await recordFrames(page, join(DIR!, 'frames.jsonl'), opt('gateway-port', '7851')!);

    let stopping = false;
    const stop = () => { stopping = true; };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);

    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        log(`page ${page.url()}`);
        await page.waitForFunction(
            () => { const c = (window as any).gameClient; return !!c?.autoLogin && c.lastProgressPercent >= 100; },
            { timeout: 180_000, polling: 500 }
        );
        log('client loaded');
        await sleep(500);
        // The engine refuses a login while the previous session of the account is still
        // being removed, so try a few times.
        for (let attempt = 1; attempt <= 4 && !stopping && !loadOnly; attempt++) {
            await page.evaluate((u: string, p: string) => { void (window as any).gameClient.autoLogin(u, p); }, user!, password!);
            try {
                await page.waitForFunction(() => (window as any).gameClient?.ingame === true, { timeout: 45_000, polling: 250 });
                break;
            } catch {
                log(`login attempt ${attempt}: not in game after 45 s`);
                await sleep(10_000);
            }
        }
        const ingameNow = await page.evaluate(() => (window as any).gameClient?.ingame === true);
        if (!loadOnly && !ingameNow) throw new Error('not in game after 4 login attempts');
        log(loadOnly ? 'loaded, holding without a login (--load-only)' : `in game as ${user}`);
        writeFileSync(join(DIR!, 'ready'), stamp() + '\n');

        let lastIngame = ingameNow;
        while (!stopping && !existsSync(join(DIR!, 'stop'))) {
            const ingame = await page.evaluate(() => (window as any).gameClient?.ingame === true);
            appendFileSync(join(DIR!, 'health.jsonl'), JSON.stringify({ t: Date.now(), ingame }) + '\n');
            if (ingame !== lastIngame) log(ingame ? 'back in game' : 'NOT in game');
            lastIngame = ingame;
            await sleep(5_000);
        }
        log('stopping: closing the page (game socket close = logout)');
    } catch (e) {
        log(`error: ${e instanceof Error ? e.message : String(e)}`);
        process.exitCode = 1;
    } finally {
        flushFrames();
        await page.close({ runBeforeUnload: false }).catch(() => {});
        await sleep(2_000);
        await browser.close().catch(() => {});
    }
}

/** Records websocket frames with the browser's own timestamps; returns a final flush. */
async function recordFrames(page: Page, file: string, gatewayPort: string): Promise<() => void> {
    const cdp = await page.createCDPSession();
    await cdp.send('Network.enable');
    const socket = new Map<string, string>();
    // DevTools frame times are monotonic seconds; a handshake carries both clocks.
    let base: { mono: number; wall: number } | null = null;
    let buf: string[] = [];
    cdp.on('Network.webSocketCreated', e => {
        socket.set(e.requestId, new URL(e.url).port === gatewayPort ? 'gw' : 'game');
    });
    cdp.on('Network.webSocketWillSendHandshakeRequest', e => {
        if (!base) base = { mono: e.timestamp, wall: e.wallTime };
    });
    const onFrame = (d: 'in' | 'out') => (e: { requestId: string; timestamp: number; response: { opcode: number; payloadData: string } }) => {
        if (!base) return;
        const s = socket.get(e.requestId) ?? 'other';
        const t = Math.round((base.wall + (e.timestamp - base.mono)) * 10_000) / 10;
        const text = e.response.opcode === 1;
        const n = text ? e.response.payloadData.length : Math.floor((e.response.payloadData.length * 3) / 4);
        const k = text ? /"type"\s*:\s*"(\w+)"/.exec(e.response.payloadData.slice(0, 200))?.[1] : undefined;
        buf.push(JSON.stringify(k ? { t, s, d, n, k } : { t, s, d, n }));
    };
    cdp.on('Network.webSocketFrameSent', onFrame('out'));
    cdp.on('Network.webSocketFrameReceived', onFrame('in'));
    const flush = () => { if (buf.length) { appendFileSync(file, buf.join('\n') + '\n'); buf = []; } };
    setInterval(flush, 1_000).unref();
    return flush;
}

async function evaluate() {
    const expr = positional.join(' ');
    if (!expr) { console.error('eval needs an expression'); process.exit(2); }
    const progress = opt('progress');
    const every = Number(opt('every', '15')) * 1000;
    const deadline = Date.now() + Number(opt('timeout-min', '30')) * 60_000;
    const browser = await puppeteer.connect({ browserWSEndpoint: readFileSync(ENDPOINT, 'utf8').trim(), protocolTimeout: HOUR, defaultViewport: null });
    const page = (await browser.pages()).find(p => p.url().includes('/bot'));
    if (!page) { console.error('no /bot page in the held browser'); process.exit(1); }

    console.log(`${stamp()} eval ${expr}`);
    // A string goes through DevTools' Runtime.evaluate, which the page's CSP does not restrict.
    await page.evaluate(`(() => { const w = window; w.__rs95 = undefined;
        Promise.resolve().then(() => (${expr})).then(v => { w.__rs95 = { ok: true, v }; }, e => { w.__rs95 = { ok: false, e: String((e && e.stack) || e) }; }); })()`);
    let nextProgress = Date.now() + every;
    let out: { ok: boolean; v?: unknown; e?: string } | undefined;
    while (Date.now() < deadline) {
        out = await page.evaluate(() => (window as any).__rs95);
        if (out) break;
        if (progress && Date.now() >= nextProgress) {
            const p = await page.evaluate(`(() => { try { return JSON.stringify(${progress}); } catch (e) { return String(e); } })()`).catch(e => String(e));
            console.log(`${stamp()} progress ${String(p).slice(0, 400)}`);
            nextProgress += every;
        }
        await sleep(1_000);
    }
    browser.disconnect();
    if (!out) { console.log(`${stamp()} eval timed out`); process.exit(1); }
    if (!out.ok) { console.log(`${stamp()} eval threw: ${out.e}`); process.exit(1); }
    const json = JSON.stringify(out.v);
    const file = opt('json');
    if (file) writeFileSync(file, json + '\n');
    console.log(`${stamp()} result ${json.length > 4000 ? json.slice(0, 4000) + '...' : json}`);
    if (summarise(out.v) === 'fault') process.exit(1);
}

/** Summary lines for a tick program's final status (shape posted by rs/97). */
function summarise(v: any): 'fault' | 'ok' {
    if (!v || typeof v !== 'object') return 'ok';
    const r = v.result ?? v;
    if (Array.isArray(r?.latencies)) {
        const counts: Record<number, number> = {};
        for (const l of r.latencies as number[]) counts[l] = (counts[l] ?? 0) + 1;
        const hist = Object.keys(counts).map(Number).sort((a, b) => a - b).map(k => `${k}:${counts[k]}`).join(' ');
        console.log(`latency in ticks (in-page probe, label of the step - label sent): ${hist}  (${r.trials ?? r.latencies.length} trials, ${r.lost ?? 0} lost, ${r.ticks ?? '?'} ticks)${r.reason ? `  ${r.reason}` : ''}`);
        console.log(`on time ${r.onTime ?? counts[1] ?? 0}/${r.trials ?? r.latencies.length}`);
        if (Array.isArray(r.tickMs)) console.log(`decoded tick interval ms (page): ${quantiles(r.tickMs)}`);
    }
    if (r?.ticksPerRoll !== undefined) {
        const f = (x: unknown) => typeof x === 'number' ? x.toFixed(2) : String(x);
        console.log(`knife-cycle: ${r.rolls} rolls, ${r.ticks} ticks, ${f(r.ticksPerRoll)} ticks per roll (mean gap), ${f(r.ticksPerRollOverSpan)} over the span of ${r.span}; gaps ${JSON.stringify(r.histogram)}; starters ${r.starters}, resyncs ${r.resyncs}, moves ${r.moves}, level-ups ${Array.isArray(r.levelUps) ? r.levelUps.length : r.levelUps}`);
    }
    if (typeof v.phase === 'string') {
        console.log(`program ${v.name} ${v.phase}${v.fault ? ` (fault: ${typeof v.fault === 'string' ? v.fault : JSON.stringify(v.fault)})` : ''}: deferred ${v.deferred}, skippedTicks ${v.skippedTicks}, maxTickMs ${v.maxTickMs}, packets ${v.packets}`);
        if (v.phase === 'fault') return 'fault';
    }
    return 'ok';
}

function frames() {
    const from = Number(opt('from', '0'));
    const to = Number(opt('to', String(Number.MAX_SAFE_INTEGER)));
    const path = join(DIR!, 'frames.jsonl');
    if (!existsSync(path)) { console.log('no frames recorded'); return; }
    type F = { t: number; s: string; d: 'in' | 'out'; n: number; k?: string };
    const all: F[] = readFileSync(path, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as F).filter(f => f.t >= from && f.t <= to);
    const of = (s: string, d: string, k?: string) => all.filter(f => f.s === s && f.d === d && (k === undefined || f.k === k)).map(f => f.t);

    // A tick's output arrives within a few ms; a frame more than 20 ms after the previous one
    // starts the next tick. (A wider grouping merges a late tick with the catch-up tick the demo
    // sends right after it, and charges the gap to the page.)
    const ticks: number[] = [];
    let prev = -Infinity;
    for (const t of of('game', 'in')) { if (t - prev > 20) ticks.push(t); prev = t; }
    const last = (xs: number[], t: number) => { let lo = 0, hi = xs.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (xs[m]! <= t) { r = m; lo = m + 1; } else hi = m - 1; } return r < 0 ? NaN : xs[r]!; };
    const first = (xs: number[], t: number) => { let lo = 0, hi = xs.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (xs[m]! >= t) { r = m; hi = m - 1; } else lo = m + 1; } return r < 0 ? NaN : xs[r]!; };

    console.log(`window ${new Date(from).toISOString()} - ${to === Number.MAX_SAFE_INTEGER ? 'end' : new Date(to).toISOString()}: ${all.length} frames`);
    const intervals = ticks.slice(1).map((t, i) => t - ticks[i]!);
    // A catch-up: a tick under 150 ms after one that came over 350 ms late (rs/97's definition).
    const catchUps = intervals.filter((v, i) => i > 0 && v < 150 && intervals[i - 1]! > 350).length;
    const minutes = ticks.length > 1 ? (ticks[ticks.length - 1]! - ticks[0]!) / 60_000 : 0;
    console.log(`tick output arrival interval ms: ${quantiles(intervals)}; catch-ups ${catchUps} in ${minutes.toFixed(1)} min`);
    const gameOut = of('game', 'out');
    console.log(`game packet out, ms after its tick's output arrived: ${quantiles(gameOut.map(t => t - last(ticks, t)).filter(Number.isFinite))}`);

    const states = of('gw', 'out', 'state');
    const actions = of('gw', 'in', 'action');
    if (!actions.length) return;
    const rows = actions.map(a => {
        const s = last(states, a);
        const r = last(ticks, s);
        const g = first(gameOut, a);
        return { publish: s - r, relay: a - s, flush: g - a, total: g - r };
    }).filter(x => [x.publish, x.relay, x.flush].every(Number.isFinite) && x.relay < 1000 && x.flush < 1000);
    console.log(`gateway actions: ${actions.length}, ${rows.length} following a state within 1 s`);
    console.log(`  tick output in -> state out (page publication): ${quantiles(rows.map(x => x.publish))}`);
    console.log(`  state out -> action in (gateway, SDK script, gateway): ${quantiles(rows.map(x => x.relay))}`);
    console.log(`  action in -> game packet out (overlay drain to flush): ${quantiles(rows.map(x => x.flush))}`);
    console.log(`  tick output in -> game packet out (whole reaction in the page's view): ${quantiles(rows.map(x => x.total))}`);
}
