// Open a bot's browser webclient page in Chrome and keep it open: the tab the in-page
// tick programs run in (docs/speedrun/tick-programs.md).
//
//   bun docs/speedrun/scripts/tickprog-tab.ts <bot> [--origin=http://localhost:8960]
//       [--gateway=ws://localhost:7860] [--server=host:port] [--query=k=v&...] [--out=DIR]
//       [--debug-port=9397]
//
// Headful by default (the scored run is a visible tab); HEADLESS=1 for a runner
// without a display, HEADLESS=shell for one whose sandbox kills full Chrome. The password comes from bots/<bot>/bot.env: through a proxy.ts
// origin as a one-time login token (the bot.env must be mode 600), on the local
// lab's engine page in the query. Prints TAB-READY once
// the page is in game, and one `[program] end {json}` line per finished program run,
// read from the page's window.rsPrograms.history (the production bundle strips console
// calls, so the page's own log lines appear only in a dev build). Once a second it appends a render
// sample to <out>/stats.log: frames drawn, game loops, requestAnimationFrame calls and
// the longest main-thread stall, so a run can show the tab kept rendering while a
// program ran. Runs until killed.
import { appendFileSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import puppeteer from 'puppeteer';
import { browserUrl, loadBotEnv, mintLoginToken } from '../../../speedrun/lib/session';

const bot = process.argv[2];
if (!bot) throw new Error('usage: tickprog-tab.ts <bot> [--origin=...] [--gateway=...] [--server=...] [--query=...]');
const flag = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const env = loadBotEnv(bot);
const origin = flag('origin') ?? `http://${env.SERVER ?? 'localhost:8888'}`;
const out = flag('out') ?? join(process.env.TMPDIR ?? '/tmp', `tickprog-tab-${bot}`);
mkdirSync(out, { recursive: true });
const stats = join(out, 'stats.log');
writeFileSync(stats, '');

const q = new URLSearchParams();
if (flag('gateway')) q.set('gateway', flag('gateway')!);
if (flag('server')) q.set('server', flag('server')!);
for (const [k, v] of new URLSearchParams(flag('query') ?? '')) q.set(k, v);
// A proxy.ts origin logs the page in with a one-time token; the engine's own page
// (the local lab) only takes the password in the query, which browserUrl allows
// for a loopback world alone.
const pageEnv = { ...env, CLIENT_URL: `${origin}/bot${q.size ? `?${q}` : ''}` };
const url = await mintLoginToken(pageEnv).then(
    token => browserUrl(pageEnv, { token }),
    err => {
        console.log(`[tab] no login token from ${origin} (${(err as Error).message}); trying the local-lab query login`);
        return browserUrl(pageEnv, { insecureQueryLogin: true });
    }
);

// HEADLESS=shell runs chrome-headless-shell, for a batch sandbox where full Chrome crashes at launch
const headless = process.env.HEADLESS === 'shell' ? 'shell' : process.env.HEADLESS === '1' || process.env.HEADLESS === 'true';
// Chrome throttles timers and frames in a hidden, minimised or covered tab, and a
// program reacts once per game-loop pass, so by default the tab runs with throttling
// off. --stock-chrome keeps Chrome's defaults (what a hand-opened browser does).
const unthrottled = process.argv.includes('--stock-chrome') ? [] : ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'];
const browser = await puppeteer.launch({
    headless,
    defaultViewport: null,
    args: ['--no-sandbox', '--window-size=800,660', ...unthrottled, `--remote-debugging-port=${flag('debug-port') ?? 9397}`]
});
console.log(`[tab] chrome ${unthrottled.length ? 'with background throttling off' : 'stock (background throttling on)'}`);
const page = (await browser.pages())[0] ?? (await browser.newPage());
page.on('console', m => {
    const t = m.text();
    if (t.startsWith('[program ')) console.log(t);
});
page.on('pageerror', e => console.log(`[tab] page error: ${e}`));
await page.evaluateOnNewDocument(() => {
    const w = window as unknown as Record<string, any>;
    w.__lag = { max: 0, over50: 0, over100: 0 };
    let last = performance.now();
    setInterval(() => {
        const now = performance.now();
        const gap = now - last - 10;
        last = now;
        const L = w.__lag;
        if (gap > L.max) L.max = gap;
        if (gap > 50) L.over50++;
        if (gap > 100) L.over100++;
    }, 10);
    w.__frames = 0;
    const raf = () => {
        w.__frames++;
        requestAnimationFrame(raf);
    };
    requestAnimationFrame(raf);
});
console.log(`[tab] ${headless ? 'headless' : 'headful'} ${url.replace(/(password|token)=[^&]*/, '$1=***')}`);
await page.goto(url, { waitUntil: 'domcontentloaded' });

let ready = false;
let lastEnded = 0; // highest run id printed
let last = { draw: 0, loop: 0, frames: 0 };
const t0 = Date.now();
setInterval(async () => {
    try {
        const s = await page.evaluate(() => {
            const w = window as unknown as Record<string, any>;
            const c = w.gameClient;
            const C = c?.constructor;
            const L = { ...w.__lag };
            w.__lag.max = 0;
            w.__lag.over50 = 0;
            w.__lag.over100 = 0;
            const p = w.rsPrograms?.status?.();
            return { ingame: !!c?.ingame, fps: c?.fps, draw: C?.drawCycle ?? 0, loop: C?.loopCycle ?? 0, frames: w.__frames, lag: L, program: p ? `${p.name}#${p.runId}:${p.phase}` : '-', ended: (w.rsPrograms?.history ?? []).map((h: { runId: number }) => ({ id: h.runId, json: JSON.stringify(h) })) as Array<{ id: number; json: string }> };
        });
        if (s.ingame && !ready) {
            ready = true;
            console.log('TAB-READY');
        }
        for (const h of s.ended) {
            if (h.id <= lastEnded) continue;
            console.log(`[program] end ${h.json}`);
            lastEnded = h.id;
        }
        appendFileSync(stats, [`${((Date.now() - t0) / 1000).toFixed(0)}s`, `ingame=${s.ingame}`, `fps=${s.fps}`, `draws/s=${s.draw - last.draw}`, `loops/s=${s.loop - last.loop}`, `raf/s=${s.frames - last.frames}`, `lagmax=${Number(s.lag.max).toFixed(0)}`, `>50=${s.lag.over50}`, `>100=${s.lag.over100}`, `program=${s.program}`].join(' ') + '\n');
        last = { draw: s.draw, loop: s.loop, frames: s.frames };
    } catch (e) {
        appendFileSync(stats, `sample error ${e}\n`);
    }
}, 1000);
const close = async () => {
    await browser.close().catch(() => {});
    process.exit(0);
};
process.on('SIGINT', close);
process.on('SIGTERM', close);
