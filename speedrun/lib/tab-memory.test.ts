import { describe, expect, test } from 'bun:test';
import type { ChainStep } from '../runner/chain';
import { formatRunReport, runReport } from '../runner/run-report';
import { formatTabMemory, pageMemoryOf, type PageMemory, rendererRssKb, startRunTabMemory, startTabMemorySampler, type TabMemoryMinute, tabMemoryLine, tabMemoryRow, tabMemoryTrends } from './tab-memory';
import { parseLog, report, TickLog } from './ticks';

const page = (heapMB: number, nodes: number): PageMemory => ({ heapUsed: heapMB * 1e6, heapTotal: 64e6, nodes, documents: 1, listeners: 56 });
const T0 = Date.parse('2026-10-22T20:00:00Z');

function clock() {
    let t = T0;
    return { now: () => t, advance: (ms: number) => void (t += ms) };
}

describe('startTabMemorySampler', () => {
    test('one reading per sample, minutes numbered from 0, a failed read recorded and the next one read again', async () => {
        const c = clock();
        const out: TabMemoryMinute[] = [];
        let n = 0;
        const s = startTabMemorySampler(
            { page: async () => (++n === 2 ? Promise.reject(new Error('no tab for cairn_x')) : page(40 + n, 1000 + n)), renderers: async () => [300_000, 20_000] },
            { emit: m => void out.push(m), now: c.now, timer: false },
        );
        for (let i = 0; i < 3; i++) {
            await s.sample();
            c.advance(60_000);
        }
        await s.stop();
        expect(out.map(m => [m.minute, m.at - T0])).toEqual([[0, 0], [1, 60_000], [2, 120_000]]);
        expect(out[0]!.page).toEqual(page(41, 1001));
        expect(out[1]!.page).toBeUndefined();
        expect(out[1]!.pageError).toBe('no tab for cairn_x');
        expect(out[1]!.rssKb).toEqual([300_000, 20_000]);
        expect(out[2]!.page).toEqual(page(43, 1003));
    });

    test('never throws: a probe that throws synchronously, a hung read bounded and the minute behind it recorded as pending, an emit that throws', async () => {
        const out: TabMemoryMinute[] = [];
        let hang = true;
        const s = startTabMemorySampler(
            {
                page: () => {
                    if (hang) return new Promise<PageMemory>(() => {});
                    throw new Error('sync throw');
                },
                noRss: 'no Chrome pid',
            },
            { emit: m => void out.push(m), readTimeoutMs: 30, timer: false },
        );
        const first = s.sample();
        await s.sample(); // while the first is still out
        await first;
        hang = false;
        await s.sample();
        expect(out.map(m => [m.minute, m.pageError, m.rssNone])).toEqual([
            [1, 'previous reading still pending', 'no Chrome pid'],
            [0, 'page: no reading in 30 ms', 'no Chrome pid'],
            [2, 'sync throw', 'no Chrome pid'],
        ]);

        const err0 = console.error;
        console.error = () => {};
        try {
            const t = startTabMemorySampler({ page: async () => page(1, 1) }, { emit: () => { throw new Error('disk full'); }, timer: false });
            await expect(t.sample()).resolves.toBeUndefined();
        } finally {
            console.error = err0;
        }
    });

    test('on its timer: a reading at start and one per interval until stop', async () => {
        const out: TabMemoryMinute[] = [];
        const s = startTabMemorySampler({ page: async () => page(40, 1000) }, { emit: m => void out.push(m), intervalMs: 25 });
        await Bun.sleep(90);
        await s.stop();
        const n = out.length;
        expect(n).toBeGreaterThanOrEqual(3);
        expect(out.map(m => m.minute)).toEqual([...Array(n).keys()]);
        await Bun.sleep(60);
        expect(out.length).toBe(n);
    });
});

describe('the readings', () => {
    test('pageMemoryOf: the Performance.getMetrics figures; throws without the heap or the node count', () => {
        const metrics = [
            { name: 'Documents', value: 2 }, { name: 'Nodes', value: 1204 }, { name: 'JSEventListeners', value: 56 },
            { name: 'JSHeapUsedSize', value: 48_200_000 }, { name: 'JSHeapTotalSize', value: 64_000_000 },
        ];
        expect(pageMemoryOf({ metrics })).toEqual({ heapUsed: 48_200_000, heapTotal: 64_000_000, nodes: 1204, documents: 2, listeners: 56 });
        expect(() => pageMemoryOf({ metrics: metrics.filter(m => m.name !== 'Nodes') })).toThrow(/no JSHeapUsedSize or Nodes/);
        expect(() => pageMemoryOf(undefined)).toThrow();
    });

    test("rendererRssKb: the renderers among the Chrome pid's descendants (under a zygote too), not another Chrome's", () => {
        const ps = [
            '  100     1  90000 /chrome/headless_shell --remote-debugging-port=9305',
            '  104   101 300000 /chrome/headless_shell --type=renderer --lang=en-US',
            '  101   100   5000 /chrome/headless_shell --type=zygote',
            '  102   100  40000 /chrome/headless_shell --type=gpu-process',
            '  103   100  20000 /chrome/headless_shell --type=renderer --renderer-client-id=5',
            '  200     1  80000 /other/chrome',
            '  201   200 999999 /other/chrome --type=renderer',
            'garbage line',
        ].join('\n');
        expect(rendererRssKb(ps, 100)).toEqual([300_000, 20_000]);
        expect(rendererRssKb(ps, 999)).toEqual([]);
    });
});

describe('the row', () => {
    test('a TABMEM line in meta, the figures beside it, listed apart by report and outside the total', () => {
        const log = TickLog.memory('r1');
        const m: TabMemoryMinute = { minute: 3, at: Date.parse('2026-10-22T20:51:00.123Z'), page: page(48.2, 1204), rssKb: [300_000, 4_883] };
        const row = tabMemoryRow(log, { name: 'cairn_dress', sessionId: 2 }, m, 'S10..S14');
        expect(row.meta!.line).toBe('TABMEM minute=3 at=2026-10-22T20:51:00Z chunk=S10..S14 heapMB=48.2/64.0 nodes=1204 docs=1 listeners=56 rssMB=312.2 renderers=2');
        expect(row.meta).toMatchObject({ minute: 3, chunk: 'S10..S14', heapUsed: 48.2e6, nodes: 1204, rssKb: 304_883, renderersKb: [300_000, 4_883] });
        expect([row.kind, row.step, row.ok, row.ticks, row.at]).toEqual(['tabmem', 'tabmem', true, 0, '2026-10-22T20:51:00.123Z']);
        const rep = report(parseLog(JSON.stringify(row) + '\n'));
        expect([rep.totalTicks, rep.annotations]).toEqual([0, [{ kind: 'tabmem', step: 'tabmem', count: 1, totalTicks: 0 }]]);
    });

    test('a failed read and an unread RSS say so in the line and the meta', () => {
        const m: TabMemoryMinute = { minute: 0, at: T0, pageError: 'CDP Performance.getMetrics: no reply in 5000 ms', rssNone: 'no Chrome pid' };
        expect(tabMemoryLine(m)).toBe('TABMEM minute=0 at=2026-10-22T20:00:00Z heap=ERR(CDP Performance.getMetrics: no reply in 5000 ms) rssMB=- (no Chrome pid)');
        expect(tabMemoryLine({ minute: 1, at: T0, page: page(1, 2), rssError: 'ps exited 1' })).toEndWith('rssMB=ERR(ps exited 1)');
        const row = tabMemoryRow(TickLog.memory('r1'), { name: 'a', sessionId: 1 }, m);
        expect(row.meta).toMatchObject({ pageError: m.pageError, rssNone: 'no Chrome pid' });
        expect(row.meta).not.toHaveProperty('chunk');
        expect(row.meta).not.toHaveProperty('heapUsed');
    });

    test('startRunTabMemory: none for a lite session or with SPEEDRUN_TABMEM=off', () => {
        const session = { name: 'a', sessionId: 1, client: 'browser' as const, env: { BOT_USERNAME: 'a', CDP_URL: 'http://127.0.0.1:1' } as never };
        expect(startRunTabMemory({ ...session, client: 'lite' }, TickLog.memory('r1'))).toBeNull();
        expect(startRunTabMemory(session, TickLog.memory('r1'), {}, { SPEEDRUN_TABMEM: 'off' })).toBeNull();
    });
});

describe('the report', () => {
    const at = (min: number) => T0 + min * 60_000;
    const rows = [
        tabMemoryRow({ runId: 'r1' }, { name: 'a', sessionId: 1 }, { minute: 0, at: at(0), page: page(40, 1000), rssKb: [300_000] }, 'S10..S14'),
        tabMemoryRow({ runId: 'r1' }, { name: 'a', sessionId: 1 }, { minute: 1, at: at(1), pageError: 'no tab', rssError: 'ps exited 1' }, 'S10..S14'),
        tabMemoryRow({ runId: 'r1' }, { name: 'a', sessionId: 1 }, { minute: 30, at: at(30), page: page(50, 1100), rssKb: [350_000] }, 'S10..S14'),
        tabMemoryRow({ runId: 'r2' }, { name: 'a', sessionId: 1 }, { minute: 0, at: at(60), page: page(30, 900), rssNone: 'no Chrome pid' }),
    ];

    test('per chunk: first and last of each metric, the slope per hour between them, failed reads counted', () => {
        const [a, b] = tabMemoryTrends(rows);
        expect(a).toEqual({
            chunk: 'S10..S14', samples: 3, failed: 1, minutes: 30,
            heapMB: { first: 40, last: 50, perHour: 20 },
            nodes: { first: 1000, last: 1100, perHour: 200 },
            rssMB: { first: expect.closeTo(307.2, 5), last: expect.closeTo(358.4, 5), perHour: expect.closeTo(102.4, 5) },
        });
        expect(b).toEqual({ chunk: 'r2', samples: 1, failed: 0, minutes: 0, heapMB: { first: 30, last: 30, perHour: null }, nodes: { first: 900, last: 900, perHour: null }, rssMB: null, rssNone: 'no Chrome pid' });
    });

    test('formatRunReport prints them, and says so when no tab was sampled', () => {
        const chain = [] as unknown as ChainStep[];
        const text = formatRunReport(runReport(rows, chain, '## 2. Step table\n\n## 3. Next\n'));
        expect(text).toContain('tab memory (first -> last, change per hour):');
        expect(text).toContain('  S10..S14: 3 sample(s) over 30 min, 1 failed read(s); heap 40.0 -> 50.0 MB (+20.0 MB/h); nodes 1000 -> 1100 (+200 /h); renderer RSS 307.2 -> 358.4 MB (+102.4 MB/h)');
        expect(text).toContain('  r2: 1 sample(s) over 0 min; heap 30.0 -> 30.0 MB (- MB/h); nodes 900 -> 900 (- /h); renderer RSS not read (no Chrome pid)');
        expect(formatTabMemory([])).toEqual(['tab memory: none sampled (lite client, SPEEDRUN_TABMEM=off, or no DevTools origin)']);
    });
});
