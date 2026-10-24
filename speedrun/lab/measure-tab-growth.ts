#!/usr/bin/env bun
// The browser tab's renderer growth, bisected (cairn://p/rs/778): several bots walk at once on one
// lab engine, each in a Chrome of its own, each under a different variant of what run.ts attaches
// to the page, and each renderer's footprint is sampled every 30 s. The result is MB/min and MB/tick
// per variant, by least squares over the samples after the first minute.
//
//   NODE_TICKRATE=150 LAB_RUNNERS=0 LAB_BOTS="tg778b tg778c" WEB_PORT=9700 ... \
//     speedrun/lab/lab.sh tg778a speedrun/lab/measure-tab-growth.ts:--bots=tg778a,tg778b,tg778c:--variants=baseline,detached,plain:--minutes=10
//
// The parent spawns one child per variant (`--variant=<v>`, its own bot and DevTools port) and prints
// each child's RESULT line at the end. Variants (VARIANTS below) differ in:
// - chrome: 'attached' keeps puppeteer's launch connection open for the whole run, as every lab
//   script's launchLabBrowser does; 'detached' disconnects it right after the launch, so no DevTools
//   session is attached to the tab between the one-shot commands;
// - tabmem: run.ts's per-minute TABMEM sampler (a one-shot CDP connection that enables, reads and
//   disables the Performance domain), on or off (SPEEDRUN_TABMEM);
// - runTs: the walk runs as a chain step under run.ts's runChainOnSession (TICKMON, the watchdog,
//   the trackers), or as a bare SDK loop with nothing of run.ts attached;
// - discard: every minute, a one-shot Runtime.discardConsoleEntries + Log.clear on the tab;
// - throttle: the page's gateway state publications cut to every Nth (a WebSocket.prototype.send
//   wrapper evaluated once in the page), to price the overlay's per-tick publication.
//
// Footprint: Linux reads /proc/<pid>/smaps_rollup (Pss, Rss) of every `--type=renderer` process
// under the launched Chrome; elsewhere `ps` RSS. The tab's renderer is the one largest at the end.

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReservationWatch } from '../lib/host-reservation';
import { closeSession, openSession, type Session } from '../lib/session';
import { botTabs, cdpCommands, evaluateInTab, type CdpTarget } from '../lib/tab';
import { labLog } from './common';
import { waitTicks, waitUntil } from '../lib/wait';
import type { ChainStep } from '../runner/chain';
import { launchLabBrowser } from './browser';
import { leaveTutorial, mustTele, near, setStats, tele } from './setup';

export interface Variant {
    chrome: 'attached' | 'detached';
    tabmem: boolean;
    runTs: boolean;
    discard?: boolean;
    /** Publish every Nth gateway state. */
    throttle?: number;
    /** Full Chrome with a window (needs a display: Xvfb) instead of chrome-headless-shell. */
    headed?: boolean;
    /** More Chrome switches. */
    args?: readonly string[];
    /**
     * What the bot does: 'walk' back and forth across one courtyard (no new map region ever loads);
     * 'tele' a staff teleport to a far town every 10 ticks (a new region each time); 'travel' the
     * pathfinder's long walks between towns, as the legs run.
     */
    work?: 'walk' | 'tele' | 'travel';
}

export const VARIANTS: Record<string, Variant> = {
    /** run.ts as the lab runs it today. */
    baseline: { chrome: 'attached', tabmem: true, runTs: true },
    /** No DevTools session left attached and no TABMEM: only openSession's one-shot commands touch CDP. */
    detached: { chrome: 'detached', tabmem: false, runTs: true },
    'detached-tabmem': { chrome: 'detached', tabmem: true, runTs: true },
    'attached-notabmem': { chrome: 'attached', tabmem: false, runTs: true },
    discard: { chrome: 'attached', tabmem: true, runTs: true, discard: true },
    throttle: { chrome: 'attached', tabmem: true, runTs: true, throttle: 5 },
    /** The host's control: the tab walked by the SDK, nothing of run.ts attached. */
    plain: { chrome: 'attached', tabmem: false, runTs: false },
    'plain-detached': { chrome: 'detached', tabmem: false, runTs: false },
    /** Headed Chrome, a 1920x1080 window: a compositor, as the run machine's visible tab has. */
    headed: { chrome: 'attached', tabmem: true, runTs: true, headed: true },
    'headed-nogpu': { chrome: 'attached', tabmem: true, runTs: true, headed: true, args: ['--disable-gpu'] },
    'headed-plain': { chrome: 'detached', tabmem: false, runTs: false, headed: true },
    tele: { chrome: 'attached', tabmem: true, runTs: true, work: 'tele' },
    'tele-plain': { chrome: 'detached', tabmem: false, runTs: false, work: 'tele' },
    'headed-tele': { chrome: 'attached', tabmem: true, runTs: true, headed: true, work: 'tele' },
    travel: { chrome: 'attached', tabmem: true, runTs: true, work: 'travel' },
};

export interface RendererReading {
    pid: number;
    /** KiB. Pss where /proc has it, else RSS. */
    pssKb: number;
    rssKb: number;
    /** The GPU process (compositing and raster in a headed Chrome); absent for a renderer. */
    gpu?: true;
}

export interface GrowthSample {
    variant: string;
    /** Epoch ms. */
    at: number;
    /** The last published tick, or null. */
    tick: number | null;
    renderers: RendererReading[];
    error?: string;
}

/** `Pss:` and `Rss:` of a /proc/<pid>/smaps_rollup text, KiB. */
export function parseSmapsRollup(text: string): { pssKb: number; rssKb: number } | null {
    const kb = (key: string) => {
        const m = new RegExp(`^${key}:\\s+(\\d+) kB`, 'm').exec(text);
        return m ? Number(m[1]) : null;
    };
    const pss = kb('Pss');
    const rss = kb('Rss');
    return pss === null || rss === null ? null : { pssKb: pss, rssKb: rss };
}

/** Least-squares slope of y over x; null with fewer than two distinct x. */
export function slope(points: readonly { x: number; y: number }[]): number | null {
    const n = points.length;
    if (n < 2) return null;
    const mx = points.reduce((a, p) => a + p.x, 0) / n;
    const my = points.reduce((a, p) => a + p.y, 0) / n;
    const sxx = points.reduce((a, p) => a + (p.x - mx) ** 2, 0);
    if (sxx === 0) return null;
    return points.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0) / sxx;
}

export interface GrowthSummary {
    variant: string;
    samples: number;
    minutes: number;
    ticks: number | null;
    /** The tab's renderer (largest at the last sample). */
    pid: number | null;
    firstMB: number | null;
    lastMB: number | null;
    mbPerMin: number | null;
    mbPerTick: number | null;
    /** The GPU process's Pss over the same samples, when there is one. */
    gpuFirstMB: number | null;
    gpuLastMB: number | null;
    gpuMbPerMin: number | null;
}

/** The tab renderer's growth over `samples`, skipping those in the first `skipMs` (the load and login settling). */
export function summarize(variant: string, samples: readonly GrowthSample[], skipMs = 60_000): GrowthSummary {
    const ok = samples.filter(s => s.renderers.some(r => !r.gpu));
    const last = ok[ok.length - 1];
    const pid = last ? [...last.renderers].filter(r => !r.gpu).sort((a, b) => b.pssKb - a.pssKb)[0]!.pid : null;
    const t0 = ok[0]?.at ?? 0;
    const series = ok
        .filter(s => s.at - t0 >= skipMs)
        .flatMap(s => {
            const r = s.renderers.find(x => x.pid === pid);
            return r ? [{ at: s.at, tick: s.tick, mb: (r.pssKb * 1024) / 1e6 }] : [];
        });
    const perMin = slope(series.map(p => ({ x: (p.at - t0) / 60_000, y: p.mb })));
    const ticked = series.filter((p): p is typeof p & { tick: number } => p.tick !== null);
    const perTick = slope(ticked.map(p => ({ x: p.tick, y: p.mb })));
    const round = (x: number | null, d: number) => (x === null ? null : Number(x.toFixed(d)));
    const gpu = ok
        .filter(s => s.at - t0 >= skipMs)
        .flatMap(s => {
            const r = s.renderers.find(x => x.gpu);
            return r ? [{ x: (s.at - t0) / 60_000, y: (r.pssKb * 1024) / 1e6 }] : [];
        });
    return {
        variant,
        samples: series.length,
        minutes: series.length ? round((series[series.length - 1]!.at - series[0]!.at) / 60_000, 1)! : 0,
        ticks: ticked.length > 1 ? ticked[ticked.length - 1]!.tick - ticked[0]!.tick : null,
        pid,
        firstMB: round(series[0]?.mb ?? null, 1),
        lastMB: round(series[series.length - 1]?.mb ?? null, 1),
        mbPerMin: round(perMin, 2),
        mbPerTick: round(perTick, 4),
        gpuFirstMB: round(gpu[0]?.y ?? null, 1),
        gpuLastMB: round(gpu[gpu.length - 1]?.y ?? null, 1),
        gpuMbPerMin: round(slope(gpu), 2),
    };
}

/** Every process descended from `root` (not `root` itself), from /proc. */
function procDescendants(root: number): number[] {
    const parent = new Map<number, number>();
    for (const d of readdirSync('/proc')) {
        if (!/^\d+$/.test(d)) continue;
        try {
            // pid (comm) state ppid ...; comm may hold spaces and parentheses
            const stat = readFileSync(`/proc/${d}/stat`, 'utf8');
            const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
            parent.set(Number(d), ppid);
        } catch {
            // gone between the listing and the read
        }
    }
    const under = new Set([root]);
    for (let grew = true; grew; ) {
        grew = false;
        for (const [pid, ppid] of parent) if (under.has(ppid) && !under.has(pid)) under.add(pid), (grew = true);
    }
    under.delete(root);
    return [...under];
}

async function readRenderers(chromePid: number): Promise<RendererReading[]> {
    if (process.platform === 'linux') {
        return procDescendants(chromePid).flatMap(pid => {
            try {
                // Chrome rewrites its process title on Linux: a renderer's cmdline is one space-joined string, not NUL-separated args.
                const args = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split(/[\0\s]+/);
                const gpu = args.includes('--type=gpu-process');
                if (!gpu && !args.includes('--type=renderer')) return [];
                const m = parseSmapsRollup(readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8'));
                return m ? [{ pid, ...m, ...(gpu ? { gpu: true as const } : {}) }] : [];
            } catch {
                return [];
            }
        });
    }
    const p = Bun.spawn(['ps', '-A', '-o', 'pid=,ppid=,rss=,args='], { stdout: 'pipe', stderr: 'ignore' });
    const procs = (await new Response(p.stdout).text()).split('\n').flatMap(line => {
        const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line);
        return m ? [{ pid: Number(m[1]), ppid: Number(m[2]), rss: Number(m[3]), args: m[4]! }] : [];
    });
    const under = new Set([chromePid]);
    for (let grew = true; grew; ) {
        grew = false;
        for (const x of procs) if (under.has(x.ppid) && !under.has(x.pid)) under.add(x.pid), (grew = true);
    }
    return procs.filter(x => x.pid !== chromePid && under.has(x.pid) && /(^|\s)--type=renderer(\s|$)/.test(x.args)).map(x => ({ pid: x.pid, pssKb: x.rss, rssKb: x.rss }));
}

/** Cuts the page's `{"type":"state",...}` gateway sends to every `n`th; the game socket's binary sends pass. */
export function throttleExpression(n: number): string {
    return `(() => {
        if (window.__rs778Throttle) return 'already';
        window.__rs778Throttle = { n: ${n}, seen: 0, sent: 0 };
        const t = window.__rs778Throttle;
        const send = WebSocket.prototype.send;
        WebSocket.prototype.send = function (d) {
            if (typeof d === 'string' && d.startsWith('{"type":"state"')) {
                if (t.seen++ % t.n !== 0) return;
                t.sent++;
            }
            return send.call(this, d);
        };
        return 'ok';
    })()`;
}

const A = { x: 3222, z: 3218 };
const B = { x: 3233, z: 3220 };

/** Back and forth between A and B until `end` (epoch ms): arrive (or 20 ticks), stand 2 ticks, turn. */
async function walkLoop(sdk: Session['sdk'], end: number): Promise<number> {
    let to = B;
    let walks = 0;
    while (Date.now() < end) {
        await sdk.sendWalk(to.x, to.z, true);
        const target = to;
        await waitUntil(sdk, s => near(s, target.x, target.z, 1), { maxTicks: 20 });
        await waitTicks(sdk, 2);
        to = to === B ? A : B;
        walks++;
    }
    return walks;
}

/** Far apart, each in a region of its own, none in the Wilderness. */
const TOWNS: readonly { x: number; z: number }[] = [
    { x: 3222, z: 3218 }, // Lumbridge
    { x: 3212, z: 3428 }, // Varrock
    { x: 2965, z: 3380 }, // Falador
    { x: 3093, z: 3245 }, // Draynor
    { x: 3293, z: 3174 }, // Al Kharid
    { x: 3094, z: 3491 }, // Edgeville
    { x: 2757, z: 3477 }, // Camelot
    { x: 2662, z: 3305 }, // Ardougne
];

/** A teleport to the next town every 10 ticks until `end`. */
async function teleLoop(sdk: Session['sdk'], end: number): Promise<number> {
    let n = 0;
    while (Date.now() < end) {
        const t = TOWNS[++n % TOWNS.length]!;
        await tele(sdk, t.x, t.z);
        await waitTicks(sdk, 10);
    }
    return n;
}

/** The pathfinder's walks Lumbridge -> Draynor -> Falador -> Barbarian Village -> Varrock -> Lumbridge until `end`; a failed walk teleports on. */
const ROUTE: readonly { x: number; z: number }[] = [
    { x: 3093, z: 3245 },
    { x: 3013, z: 3355 },
    { x: 3082, z: 3420 },
    { x: 3185, z: 3436 },
    { x: 3222, z: 3218 },
];
async function travelLoop(session: Pick<Session, 'sdk' | 'bot'>, end: number, say: (m: string) => void): Promise<number> {
    let n = 0;
    while (Date.now() < end) {
        const t = ROUTE[n++ % ROUTE.length]!;
        const r = await session.bot.walkTo(t.x, t.z, 3, { timeout: Math.max(1_000, Math.min(180_000, end - Date.now())) });
        if (!r.success && Date.now() < end) {
            say(`walk to ${t.x},${t.z} failed (${r.message}): teleporting there`);
            await tele(session.sdk, t.x, t.z);
        }
    }
    return n;
}

function work(v: Variant, session: Pick<Session, 'sdk' | 'bot'>, end: number, say: (m: string) => void): Promise<number> {
    if (v.work === 'tele') return teleLoop(session.sdk, end);
    if (v.work === 'travel') return travelLoop(session, end, say);
    return walkLoop(session.sdk, end);
}

function flag(name: string, fallback: string): string {
    const hit = process.argv.find(a => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
}

async function child(bot: string, name: string, v: Variant, minutes: number, cdpPort: number, out: string): Promise<void> {
    const file = join(out, `${name}.jsonl`);
    const say = (m: string) => console.log(`[${name}] ${m}`);
    const chrome = await launchLabBrowser(bot, { cdpPort, ...(v.headed ? { headless: false, windowSize: [1920, 1080] as const } : {}), ...(v.args ? { extraArgs: v.args } : {}) });
    const chromePid = chrome.browser.process()?.pid;
    if (!chromePid) throw new Error('no Chrome pid');
    if (v.chrome === 'detached') {
        await chrome.browser.disconnect();
        say('puppeteer disconnected: no DevTools session stays attached');
    }
    const cdp = `http://127.0.0.1:${cdpPort}`;
    let session: Session | null = null;
    const samples: GrowthSample[] = [];
    const timers: ReturnType<typeof setInterval>[] = [];
    try {
        session = await openSession(bot, { client: 'browser', launch: true, insecureQueryLogin: true, readyTimeoutMs: 180_000 });
        const s = session;
        await leaveTutorial(s);
        // the far towns' NPCs must not kill a level-3 lab bot
        await setStats(s.sdk, { hitpoints: 70, attack: 70, strength: 70, defence: 70 });
        await mustTele(s.sdk, A.x, A.z);
        if (v.throttle) say(`throttle: ${JSON.stringify((await evaluateInTab(cdp, bot, throttleExpression(v.throttle)))?.value)}`);
        const sample = async () => {
            const reading: GrowthSample = { variant: name, at: Date.now(), tick: s.sdk.getState()?.tick ?? null, renderers: [] };
            try {
                reading.renderers = await readRenderers(chromePid);
            } catch (e) {
                reading.error = e instanceof Error ? e.message : String(e);
            }
            samples.push(reading);
            appendFileSync(file, JSON.stringify(reading) + '\n');
            const top = reading.renderers.filter(r => !r.gpu).sort((a, b) => b.pssKb - a.pssKb)[0];
            const gpu = reading.renderers.find(r => r.gpu);
            const mbOf = (r: RendererReading | undefined) => (r ? ((r.pssKb * 1024) / 1e6).toFixed(1) : '-');
            say(`tick=${reading.tick} renderers=${reading.renderers.filter(r => !r.gpu).length} tabMB=${mbOf(top)} gpuMB=${mbOf(gpu)}`);
        };
        await sample();
        timers.push(setInterval(() => void sample(), 30_000));
        if (v.discard) {
            timers.push(
                setInterval(async () => {
                    try {
                        const targets = (await (await fetch(`${cdp}/json/list`)).json()) as CdpTarget[];
                        const [tab] = botTabs(targets, bot);
                        if (tab?.webSocketDebuggerUrl) await cdpCommands(tab.webSocketDebuggerUrl, [{ method: 'Runtime.discardConsoleEntries' }, { method: 'Log.clear' }]);
                    } catch (e) {
                        say(`discard failed: ${e instanceof Error ? e.message : String(e)}`);
                    }
                }, 60_000),
            );
        }
        const end = Date.now() + minutes * 60_000 + 5_000;
        if (v.runTs) {
            const { runChainOnSession } = await import('../run');
            const step: ChainStep = {
                id: 'GROW',
                kind: 'step',
                name: `walk loop (${name})`,
                logoutSafe: true,
                preconditions: st => (st.inGame ? true : 'not in game'),
                postconditions: () => true,
                run: async ctx => void (await work(v, ctx, end, say)),
            };
            const ran = await runChainOnSession(s, {
                log: labLog(`tab-growth-${name}`),
                chain: [step],
                reservation: new ReservationWatch(join(tmpdir(), `rs778-no-reservation-${name}.json`), { label: name }),
                label: name,
                tabMemory: { chunk: name, chromePid },
            });
            say(`chain: code ${ran.result.code}`);
        } else {
            say(`${v.work ?? 'walk'}s: ${await work(v, s, end, say)}`);
        }
        await sample();
    } finally {
        for (const t of timers) clearInterval(t);
        if (session) await closeSession(session).catch(() => {});
        process.kill(chromePid, 'SIGKILL');
    }
    const summary = summarize(name, samples);
    writeFileSync(join(out, `${name}.summary.json`), JSON.stringify(summary));
    console.log(`RESULT tab-growth ${JSON.stringify({ ...summary, ...v })}`);
}

async function parent(): Promise<void> {
    const bots = flag('bots', '').split(',').filter(Boolean);
    const names = flag('variants', 'baseline,detached').split(',').filter(Boolean);
    for (const n of names) if (!VARIANTS[n]) throw new Error(`unknown variant ${n}: ${Object.keys(VARIANTS).join(', ')}`);
    if (bots.length < names.length) throw new Error(`--bots names ${bots.length} bot(s) for ${names.length} variant(s)`);
    const minutes = flag('minutes', '10');
    const out = flag('out', join(process.env.LAB_LOG ?? tmpdir(), `tab-growth-${Date.now()}`));
    mkdirSync(out, { recursive: true });
    const basePort = Number(flag('cdp-port', String(Number(process.env.WEB_PORT ?? '9300') + 10)));
    console.log(`tab growth: ${names.length} variant(s), ${minutes} min, out ${out}`);
    const kids = names.map((name, i) => {
        const env = { ...process.env, SPEEDRUN_TABMEM: VARIANTS[name]!.tabmem ? 'on' : 'off' };
        const log = join(out, `${name}.out`);
        const p = Bun.spawn(['bun', '--no-install', import.meta.path, bots[i]!, `--variant=${name}`, `--minutes=${minutes}`, `--cdp-port=${basePort + i}`, `--out=${out}`], {
            env,
            stdout: Bun.file(log),
            stderr: Bun.file(join(out, `${name}.err`)),
        });
        return { name, log, p };
    });
    const codes = await Promise.all(kids.map(k => k.p.exited));
    for (const [i, k] of kids.entries()) {
        const text = existsSync(k.log) ? readFileSync(k.log, 'utf8') : '';
        const line = text.split('\n').find(l => l.startsWith('RESULT tab-growth '));
        console.log(line ?? `RESULT tab-growth ${JSON.stringify({ variant: k.name, failed: `exit ${codes[i]}`, tail: text.split('\n').slice(-8).join(' | ') })}`);
    }
    process.exit(codes.every(c => c === 0) ? 0 : 1);
}

if (import.meta.main) {
    const variant = flag('variant', '');
    if (!variant) await parent();
    else {
        const v = VARIANTS[variant];
        if (!v) throw new Error(`unknown variant ${variant}`);
        const bot = process.argv.slice(2).find(a => !a.startsWith('-'));
        if (!bot) throw new Error('usage: measure-tab-growth.ts <bot> --variant=<v>');
        await child(bot, variant, v, Number(flag('minutes', '10')), Number(flag('cdp-port', '9310')), flag('out', tmpdir()));
        process.exit(0);
    }
}
