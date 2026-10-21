// Page-side hop trace of the browser overlay's reaction path: the bot's page in Chrome, a
// tickmanip-latency.ts probe driving it over the loopback gateway, and every websocket
// message the page sends or receives timestamped on the page's clock. It is the page
// counterpart of relay-trace-preload.ts (rs/85, which wraps the lite runner): nothing in the
// bundle changes, the tracer wraps window.WebSocket before the page loads.
//
//   bun docs/speedrun/scripts/overlay-trace.ts <bot> --origin=http://localhost:8960
//       --gateway=ws://localhost:7860 [--trials=60] [--out=DIR]
//
// Headful by default (HEADLESS=1 for a machine without a display). Writes <out>/page.jsonl
// (one event per message: t, socket g|w, dir in|out, kind, bytes) and prints, in ms, p10 /
// p50 / p90 over the probe's actions:
//   arrival to wire   gateway action message in -> next game-socket message out
//   tick to state     game frame in -> next gateway state out
//   action back       that state out -> the action in (gateway, SDK decide, gateway)
//   page reaction     game frame in -> the reaction's packet out, all three hops
// Run it through overlay-trace-lab.sh, which starts the engine and gateway.
import { spawn } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import { loadavg } from 'os';
import { join } from 'path';
import puppeteer from 'puppeteer';
import { loadBotEnv } from '../../../speedrun/lib/session';

const bot = process.argv[2];
if (!bot) throw new Error('usage: overlay-trace.ts <bot> --origin=... --gateway=... [--trials=60] [--out=DIR]');
const flag = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const env = loadBotEnv(bot);
const origin = flag('origin') ?? `http://${env.SERVER ?? 'localhost:8888'}`;
const gateway = flag('gateway') ?? env.GATEWAY_URL;
const trials = Number(flag('trials') ?? 60);
const out = flag('out') ?? join(process.env.TMPDIR ?? '/tmp', `overlay-trace-${bot}`);
mkdirSync(out, { recursive: true });

type Ev = { t: number; s: 'g' | 'w' | 'p'; d: string; k: string; n: number };

const headless = process.env.HEADLESS === '1' || process.env.HEADLESS === 'true';
const browser = await puppeteer.launch({
    headless,
    defaultViewport: null,
    args: ['--no-sandbox', '--window-size=800,660', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows']
});
const page = (await browser.pages())[0] ?? (await browser.newPage());
page.on('pageerror', e => console.log(`[trace] page error: ${e}`));
await page.evaluateOnNewDocument((gatewayUrl: string) => {
    const w = window as unknown as Record<string, any>;
    const evs: Ev[] = (w.__trace = []);
    const kind = (data: unknown): [string, number] => {
        if (typeof data !== 'string') {
            const n = (data as ArrayBuffer)?.byteLength ?? (data as Uint8Array)?.byteLength ?? 0;
            return ['bin', n];
        }
        return [/"type":"([a-zA-Z_]+)"/.exec(data.slice(0, 120))?.[1] ?? '?', data.length];
    };
    const Base = window.WebSocket;
    class Traced extends Base {
        private readonly socket: 'g' | 'w';
        constructor(url: string | URL, protocols?: string | string[]) {
            super(url, protocols);
            this.socket = String(url).startsWith(gatewayUrl) ? 'g' : 'w';
            // Capture phase on the socket itself runs before the page's onmessage.
            this.addEventListener('message', (ev: MessageEvent) => {
                const [k, n] = kind(ev.data);
                evs.push({ t: performance.now(), s: this.socket, d: 'in', k, n });
            });
        }
        send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
            super.send(data);
            const [k, n] = kind(data);
            evs.push({ t: performance.now(), s: this.socket, d: 'out', k, n });
        }
    }
    window.WebSocket = Traced as typeof WebSocket;
}, gateway ?? '');

const q = new URLSearchParams({ bot: env.BOT_USERNAME, password: env.PASSWORD });
if (gateway) q.set('gateway', gateway);
await page.goto(`${origin}/bot?${q}`, { waitUntil: 'domcontentloaded' });
for (let i = 0; !(await page.evaluate(() => (window as any).gameClient?.ingame)); i++) {
    if (i > 600) throw new Error('page never reached the game');
    await new Promise(r => setTimeout(r, 200));
}
await new Promise(r => setTimeout(r, 3000));
console.log(`[trace] ${headless ? 'headless' : 'headful'} tab in game; load ${loadavg().map(l => l.toFixed(1)).join(' ')}`);
// In-page hops (socket 'p'): each executor call with the bytes then queued in `out`, and each
// Client.flushNow call (absent before rs/113) with the bytes it found.
await page.evaluate(() => {
    const w = window as any;
    const c = w.gameClient;
    const evs = w.__trace;
    const ex = c?.botOverlay?.executor;
    if (ex) {
        const execute = ex.execute.bind(ex);
        ex.execute = (a: { type: string }) => {
            const r = execute(a);
            evs.push({ t: performance.now(), s: 'p', d: 'exec', k: a.type, n: c.out.pos });
            return r;
        };
    }
    if (typeof c?.flushNow === 'function') {
        const flushNow = c.flushNow.bind(c);
        c.flushNow = () => {
            evs.push({ t: performance.now(), s: 'p', d: 'flush', k: c.ingame ? 'ingame' : 'off', n: c.out.pos });
            flushNow();
        };
    }
    evs.length = 0;
});

// Game loops and frames drawn per second over the probe: decoding on arrival wakes the run
// loop early once per tick, which must move its phase, not its pace.
const cycles = () => page.evaluate(() => {
    const C = (window as any).gameClient?.constructor;
    return { loop: C?.loopCycle ?? 0, draw: C?.drawCycle ?? 0, t: performance.now() };
});
const c0 = await cycles();
const probe = spawn('bun', ['docs/speedrun/scripts/tickmanip-latency.ts', bot, `--trials=${trials}`], { stdio: ['ignore', 'pipe', 'inherit'] });
let probeOut = '';
probe.stdout.on('data', d => { probeOut += d; });
const code = await new Promise<number>(r => probe.on('exit', c => r(c ?? 1)));
for (const line of probeOut.split('\n')) if (!/^\[(Runner|SDK|BotSDK)\]|Pathfinding/.test(line) && line.trim()) console.log(line);
const load = loadavg().map(l => l.toFixed(1)).join(' ');
const c1 = await cycles();
const secs = (c1.t - c0.t) / 1000;
const pace = `game loops ${((c1.loop - c0.loop) / secs).toFixed(1)}/s, frames drawn ${((c1.draw - c0.draw) / secs).toFixed(1)}/s over ${secs.toFixed(0)} s`;

const evs: Ev[] = await page.evaluate(() => (window as any).__trace);
await browser.close();
writeFileSync(join(out, 'page.jsonl'), evs.map(e => JSON.stringify(e)).join('\n') + '\n');

const arrival: number[] = [];
const toState: number[] = [];
const back: number[] = [];
const reaction: number[] = [];
let lastFrame = -1;
let lastState = -1;
let frameOfState = -1;
let pending: { at: number; state: number; frame: number } | null = null;
for (const e of evs) {
    if (e.s === 'w' && e.d === 'in') {
        lastFrame = e.t;
    } else if (e.s === 'g' && e.d === 'out' && e.k === 'state') {
        if (lastFrame >= 0 && lastFrame > frameOfState) {
            toState.push(e.t - lastFrame);
            frameOfState = lastFrame;
        }
        lastState = e.t;
    } else if (e.s === 'g' && e.d === 'in' && e.k === 'action') {
        if (!pending) pending = { at: e.t, state: lastState, frame: frameOfState };
    } else if (e.s === 'w' && e.d === 'out' && pending) {
        arrival.push(e.t - pending.at);
        if (pending.state >= 0) back.push(pending.at - pending.state);
        if (pending.frame >= 0) reaction.push(e.t - pending.frame);
        pending = null;
    }
}
const q3 = (xs: number[]) => {
    const a = [...xs].sort((u, v) => u - v);
    const at = (p: number) => (a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))]!.toFixed(1) : '-');
    return `${at(0.1)} / ${at(0.5)} / ${at(0.9)}  (n=${a.length})`;
};
console.log(`[trace] page hops, ms p10 / p50 / p90; load at end ${load}; ${join(out, 'page.jsonl')}`);
console.log(`  arrival to wire   ${q3(arrival)}`);
console.log(`  tick to state     ${q3(toState)}`);
console.log(`  action back       ${q3(back)}`);
console.log(`  page reaction     ${q3(reaction)}`);
console.log(`  ${pace}`);
if (process.env.TRACE_EXCERPT) {
    // The events around a few actions, relative to the action's arrival.
    const actions = evs.map((e, i) => (e.s === 'g' && e.k === 'action' ? i : -1)).filter(i => i >= 0);
    for (const i of actions.slice(5, 8)) {
        console.log(`  -- around action #${actions.indexOf(i)}`);
        for (const e of evs.slice(Math.max(0, i - 4), i + 6)) console.log(`     ${(e.t - evs[i]!.t).toFixed(2).padStart(8)} ${e.s} ${e.d} ${e.k} ${e.n}`);
    }
}
process.exit(code);
