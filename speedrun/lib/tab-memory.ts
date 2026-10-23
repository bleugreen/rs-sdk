// The browser tab's memory, once a minute: a report-only sampler that writes one `tabmem` row (a
// `TABMEM` line in its meta, on stdout too) per minute of a browser session, beside the TICKMON rows.
// It acts on nothing and never fails or holds up a step: every read is bounded, a failed or
// late read is written as such in that minute's row, and nothing it does throws into the run.
//
// What it reads, per minute:
// - the page's JS heap (used and total) and its DOM node, document and event-listener counts, from
//   CDP `Performance.getMetrics` on the bot's tab (lib/tab.ts botTabs). Not `performance.memory`:
//   without --enable-precise-memory-info Chrome quantizes it and refreshes it at most every 20
//   minutes, so a minute's reading would mostly repeat the last. `Nodes` counts every node the
//   renderer holds, detached ones not yet collected included: the count a DOM leak grows;
// - the resident memory of each renderer under the Chrome this script launched (lab/browser.ts
//   launchLabBrowser's process), from `ps`, and their sum. Renderers are found by `--type=renderer`
//   among the launched pid's descendants (on Linux they sit under the zygote, not the browser). A
//   Chrome the script did not launch (the run machine's, reached by CDP_URL) has no known pid, and
//   the row says so instead of guessing which renderer is the tab's.
//
// The run report (runner/run-report.ts) prints each chunk's first and last value of each metric
// and its slope per hour (tabMemoryTrends).

import { cdpUrl, type Session } from './session';
import { botTabs, cdpCommands, type CdpTarget } from './tab';
import type { TickLog, TickRow } from './ticks';
import { tickMs } from './wait';

export const TABMEM_STEP = 'tabmem';
const MB = 1e6;

/** One `Performance.getMetrics` reading of the page. Heap sizes in bytes. */
export interface PageMemory {
    heapUsed: number;
    heapTotal: number;
    nodes: number;
    documents: number;
    listeners: number;
}

export interface TabMemoryProbe {
    /** The page's reading; throws when it cannot be read. */
    page(): Promise<PageMemory>;
    /** Each renderer's RSS in KiB; absent when the Chrome's pid is not known (`noRss` says why). */
    renderers?: () => Promise<number[]>;
    noRss?: string;
}

/** One minute's reading: each half either read or carrying why not. */
export interface TabMemoryMinute {
    /** 0 for the reading taken as the sampler started. */
    minute: number;
    /** Wall clock (epoch ms) the reading began. */
    at: number;
    page?: PageMemory;
    pageError?: string;
    /** Per renderer, KiB. */
    rssKb?: number[];
    rssError?: string;
    /** Why the renderer RSS is not read at all (no Chrome pid). */
    rssNone?: string;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const mb = (bytes: number) => (bytes / MB).toFixed(1);
const sum = (xs: readonly number[]) => xs.reduce((a, x) => a + x, 0);

/** The page's figures from a `Performance.getMetrics` reply; throws when the heap or node count is missing. */
export function pageMemoryOf(reply: unknown): PageMemory {
    const metrics = (reply as { metrics?: { name: string; value: number }[] } | null)?.metrics ?? [];
    const m = new Map(metrics.map(x => [x.name, x.value]));
    const heapUsed = m.get('JSHeapUsedSize');
    const nodes = m.get('Nodes');
    if (heapUsed === undefined || nodes === undefined) throw new Error('Performance.getMetrics: no JSHeapUsedSize or Nodes in the reply');
    return { heapUsed, heapTotal: m.get('JSHeapTotalSize') ?? 0, nodes, documents: m.get('Documents') ?? 0, listeners: m.get('JSEventListeners') ?? 0 };
}

/** The bot's tab's reading over Chrome's DevTools port: the metrics domain is enabled, read and disabled on one connection. */
export function cdpPageMemory(cdpOrigin: string, botName: string, timeoutMs = 5_000): () => Promise<PageMemory> {
    const base = cdpOrigin.replace(/\/+$/, '');
    return async () => {
        const targets = (await (await fetch(`${base}/json/list`, { signal: AbortSignal.timeout(timeoutMs) })).json()) as CdpTarget[];
        const [tab] = botTabs(targets, botName);
        if (!tab?.webSocketDebuggerUrl) throw new Error(`no tab for ${botName} on ${base}`);
        const [, metrics] = await cdpCommands(tab.webSocketDebuggerUrl, [{ method: 'Performance.enable' }, { method: 'Performance.getMetrics' }, { method: 'Performance.disable' }], timeoutMs);
        return pageMemoryOf(metrics);
    };
}

/**
 * The RSS (KiB) of each renderer descended from `chromePid`, from `ps -A -o pid=,ppid=,rss=,args=`
 * output (the same columns on macOS and Linux procps), in the order ps lists them.
 */
export function rendererRssKb(psText: string, chromePid: number): number[] {
    const procs = psText.split('\n').flatMap(line => {
        const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line);
        return m ? [{ pid: Number(m[1]), ppid: Number(m[2]), rss: Number(m[3]), args: m[4]! }] : [];
    });
    const under = new Set([chromePid]);
    // ps lists parents before children only by accident: grow the set until it stops growing.
    for (let grew = true; grew; ) {
        grew = false;
        for (const p of procs) if (under.has(p.ppid) && !under.has(p.pid)) under.add(p.pid), (grew = true);
    }
    return procs.filter(p => p.pid !== chromePid && under.has(p.pid) && /(^|\s)--type=renderer(\s|$)/.test(p.args)).map(p => p.rss);
}

/** The renderers' RSS under `chromePid`, read with `ps`; throws when ps fails or finds none. */
export function psRenderers(chromePid: number, timeoutMs = 5_000): () => Promise<number[]> {
    return async () => {
        const p = Bun.spawn(['ps', '-A', '-o', 'pid=,ppid=,rss=,args='], { stdout: 'pipe', stderr: 'ignore' });
        const kill = setTimeout(() => p.kill(), timeoutMs);
        try {
            const [text, code] = await Promise.all([new Response(p.stdout).text(), p.exited]);
            if (code !== 0) throw new Error(`ps exited ${code}`);
            const rss = rendererRssKb(text, chromePid);
            if (!rss.length) throw new Error(`no renderer under Chrome pid ${chromePid}`);
            return rss;
        } finally {
            clearTimeout(kill);
        }
    };
}

function bounded<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
    let t: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_, reject) => (t = setTimeout(() => reject(new Error(`${what}: no reading in ${ms} ms`)), ms)));
    return Promise.race([p, late]).finally(() => clearTimeout(t));
}

export interface TabMemoryOptions {
    emit: (m: TabMemoryMinute) => void;
    /** Between readings (default 60 000 ms). */
    intervalMs?: number;
    /** A reading not back in this long is recorded as failed (default 10 000 ms). */
    readTimeoutMs?: number;
    /** Wall clock (default Date.now). */
    now?: () => number;
    /** Default true: a reading now and one every `intervalMs`. false leaves them to `sample()` (tests). */
    timer?: boolean;
}

export interface TabMemorySampler {
    /** Take one reading now and emit it. Never rejects. */
    sample(): Promise<void>;
    /** No more readings; resolves once one in flight has been emitted (bounded by `readTimeoutMs`). Idempotent. */
    stop(): Promise<void>;
}

export function startTabMemorySampler(probe: TabMemoryProbe, opts: TabMemoryOptions): TabMemorySampler {
    const now = opts.now ?? Date.now;
    const readMs = opts.readTimeoutMs ?? 10_000;
    let minute = 0;
    let pending: Promise<void> | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let stopped = false;

    const emit = (m: TabMemoryMinute) => {
        try {
            opts.emit(m);
        } catch (e) {
            console.error(`[tabmem] could not write minute ${m.minute}: ${message(e)}`);
        }
    };

    async function read(m: TabMemoryMinute): Promise<void> {
        const [page, rss] = await Promise.allSettled([
            bounded(Promise.resolve().then(() => probe.page()), readMs, 'page'),
            probe.renderers ? bounded(Promise.resolve().then(() => probe.renderers!()), readMs, 'renderers') : Promise.resolve(null),
        ]);
        if (page.status === 'fulfilled') m.page = page.value;
        else m.pageError = message(page.reason);
        if (!probe.renderers) m.rssNone = probe.noRss ?? 'no Chrome pid';
        else if (rss.status === 'fulfilled') m.rssKb = rss.value!;
        else m.rssError = message(rss.reason);
        emit(m);
    }

    function sample(): Promise<void> {
        const m: TabMemoryMinute = { minute: minute++, at: now() };
        if (pending) {
            // The last reading has not come back: this minute is a failed read, not a second one queued behind it.
            m.pageError = 'previous reading still pending';
            if (probe.renderers) m.rssError = 'previous reading still pending';
            else m.rssNone = probe.noRss ?? 'no Chrome pid';
            emit(m);
            return Promise.resolve();
        }
        const p = read(m).catch(e => console.error(`[tabmem] minute ${m.minute}: ${message(e)}`)).finally(() => {
            if (pending === p) pending = null;
        });
        pending = p;
        return p;
    }

    if (opts.timer !== false) {
        void sample();
        timer = setInterval(() => void sample(), opts.intervalMs ?? 60_000);
        (timer as { unref?: () => void }).unref?.();
    }

    return {
        sample: () => (stopped ? Promise.resolve() : sample()),
        async stop() {
            stopped = true;
            if (timer) clearInterval(timer);
            timer = null;
            await pending;
        },
    };
}

/**
 * `TABMEM minute=3 at=2026-10-22T20:51:00Z chunk=S10..S14 heapMB=48.2/64.0 nodes=1204 docs=1 listeners=56 rssMB=312.4 renderers=1`;
 * a failed half reads `heap=ERR(<why>)` or `rssMB=ERR(<why>)`, an unread RSS `rssMB=- (<why>)`.
 */
export function tabMemoryLine(m: TabMemoryMinute, chunk?: string): string {
    const at = new Date(m.at).toISOString().replace(/\.\d+Z$/, 'Z');
    const page = m.page ? `heapMB=${mb(m.page.heapUsed)}/${mb(m.page.heapTotal)} nodes=${m.page.nodes} docs=${m.page.documents} listeners=${m.page.listeners}` : `heap=ERR(${m.pageError ?? 'unknown'})`;
    const rss = m.rssKb ? `rssMB=${mb(sum(m.rssKb) * 1024)} renderers=${m.rssKb.length}` : m.rssError ? `rssMB=ERR(${m.rssError})` : `rssMB=- (${m.rssNone ?? 'not read'})`;
    return `TABMEM minute=${m.minute} at=${at}${chunk ? ` chunk=${chunk}` : ''} ${page} ${rss}`;
}

export function tabMemoryRow(log: Pick<TickLog, 'runId'>, session: { name: string; sessionId: number }, m: TabMemoryMinute, chunk?: string): TickRow {
    return {
        v: 1, kind: 'tabmem', runId: log.runId, account: session.name, sessionId: session.sessionId, step: TABMEM_STEP,
        startTick: -1, endTick: -1, ticks: 0, wallMs: 0, ok: true,
        meta: {
            line: tabMemoryLine(m, chunk), minute: m.minute, ...(chunk ? { chunk } : {}),
            ...(m.page ?? {}), ...(m.pageError ? { pageError: m.pageError } : {}),
            ...(m.rssKb ? { rssKb: sum(m.rssKb), renderersKb: m.rssKb } : {}), ...(m.rssError ? { rssError: m.rssError } : {}), ...(m.rssNone ? { rssNone: m.rssNone } : {}),
        },
        tickMs: tickMs(), at: new Date(m.at).toISOString(),
    };
}

/** What the run tells the sampler: the launched Chrome's pid (for the renderer RSS) and the chunk's label. */
export interface TabMemorySetting {
    chromePid?: number;
    chunk?: string;
}

/**
 * The session's sampler: one `tabmem` row a minute in the run log and the `TABMEM` line on stdout.
 * Null for a lite session, with SPEEDRUN_TABMEM=off, or with no DevTools origin to read the tab by.
 */
export function startRunTabMemory(
    session: Pick<Session, 'name' | 'sessionId' | 'client' | 'env'>,
    log: TickLog,
    setting: TabMemorySetting = {},
    env: Record<string, string | undefined> = process.env,
): TabMemorySampler | null {
    if (session.client !== 'browser' || env.SPEEDRUN_TABMEM?.toLowerCase() === 'off') return null;
    const cdp = cdpUrl(session.env);
    if (!cdp) {
        console.log('[tabmem] off: no CDP_URL or SPEEDRUN_CDP_URL to reach the tab by');
        return null;
    }
    const probe: TabMemoryProbe = {
        page: cdpPageMemory(cdp, session.env.BOT_USERNAME),
        ...(setting.chromePid ? { renderers: psRenderers(setting.chromePid) } : { noRss: "no Chrome pid: this script did not launch the tab's Chrome" }),
    };
    return startTabMemorySampler(probe, {
        emit: m => {
            const row = tabMemoryRow(log, session, m, setting.chunk);
            log.append(row);
            console.log(row.meta!.line);
        },
    });
}

/** A metric's first and last reading in a chunk, and the change per hour between them (null with one reading). */
export interface Trend {
    first: number;
    last: number;
    perHour: number | null;
}

export interface TabMemoryTrend {
    /** The rows' `meta.chunk`, else their run id. */
    chunk: string;
    samples: number;
    /** Rows with a failed half (page or renderer RSS). */
    failed: number;
    /** From the first row to the last. */
    minutes: number;
    heapMB: Trend | null;
    nodes: Trend | null;
    rssMB: Trend | null;
    /** Why the renderer RSS was never read (the first row's), when it was not. */
    rssNone?: string;
}

function trend(points: readonly { t: number; v: number }[]): Trend | null {
    if (!points.length) return null;
    const a = points[0]!;
    const b = points[points.length - 1]!;
    const hours = (b.t - a.t) / 3_600_000;
    return { first: a.v, last: b.v, perHour: hours > 0 ? (b.v - a.v) / hours : null };
}

/** Per chunk, in the order chunks first appear: the `tabmem` rows' first, last and slope per hour of heap, nodes and renderer RSS. */
export function tabMemoryTrends(rows: readonly TickRow[]): TabMemoryTrend[] {
    const chunks = new Map<string, TickRow[]>();
    for (const r of rows) {
        if (r.kind !== 'tabmem') continue;
        const key = typeof r.meta?.chunk === 'string' ? r.meta.chunk : r.runId;
        chunks.set(key, [...(chunks.get(key) ?? []), r]);
    }
    return [...chunks].map(([chunk, rs]) => {
        const series = (f: (meta: Record<string, unknown>) => unknown) =>
            rs.flatMap(r => {
                const v = f(r.meta ?? {});
                return typeof v === 'number' ? [{ t: Date.parse(r.at), v }] : [];
            });
        const span = Date.parse(rs[rs.length - 1]!.at) - Date.parse(rs[0]!.at);
        const none = rs.find(r => typeof r.meta?.rssNone === 'string')?.meta?.rssNone as string | undefined;
        return {
            chunk,
            samples: rs.length,
            failed: rs.filter(r => r.meta?.pageError || r.meta?.rssError).length,
            minutes: Math.round(span / 60_000),
            heapMB: trend(series(m => (typeof m.heapUsed === 'number' ? m.heapUsed / MB : undefined))),
            nodes: trend(series(m => m.nodes)),
            rssMB: trend(series(m => (typeof m.rssKb === 'number' ? (m.rssKb * 1024) / MB : undefined))),
            ...(none ? { rssNone: none } : {}),
        };
    });
}

/** The report's lines: a header and one line per chunk (one line saying none when no tab was sampled). */
export function formatTabMemory(trends: readonly TabMemoryTrend[]): string[] {
    if (!trends.length) return ['tab memory: none sampled (lite client, SPEEDRUN_TABMEM=off, or no DevTools origin)'];
    const signed = (x: number, digits: number) => `${x >= 0 ? '+' : ''}${x.toFixed(digits)}`;
    const show = (name: string, t: Trend | null, digits: number, unit: string) =>
        t ? `${name} ${t.first.toFixed(digits)} -> ${t.last.toFixed(digits)}${unit ? ` ${unit}` : ''} (${t.perHour === null ? '-' : signed(t.perHour, digits)} ${unit ? `${unit}/h` : '/h'})` : `${name} not read`;
    return [
        'tab memory (first -> last, change per hour):',
        ...trends.map(t =>
            `  ${t.chunk}: ${t.samples} sample(s) over ${t.minutes} min${t.failed ? `, ${t.failed} failed read(s)` : ''}; ` +
            [show('heap', t.heapMB, 1, 'MB'), show('nodes', t.nodes, 0, ''), t.rssMB || !t.rssNone ? show('renderer RSS', t.rssMB, 1, 'MB') : `renderer RSS not read (${t.rssNone})`].join('; '),
        ),
    ];
}
