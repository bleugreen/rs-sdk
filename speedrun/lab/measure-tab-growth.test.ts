import { describe, expect, test } from 'bun:test';
import { parseSmapsRollup, slope, summarize, throttleExpression, type GrowthSample } from './measure-tab-growth';

describe('measure-tab-growth', () => {
    test('parseSmapsRollup reads Pss and Rss in KiB', () => {
        const text = '55d0c0000000-7ffd00000000 ---p 00000000 00:00 0  [rollup]\nRss:              523412 kB\nPss:              498120 kB\nPss_Anon:         401000 kB\n';
        expect(parseSmapsRollup(text)).toEqual({ pssKb: 498120, rssKb: 523412 });
        expect(parseSmapsRollup('Rss: 1 kB\n')).toBeNull();
    });

    test('slope is the least-squares gradient', () => {
        expect(slope([{ x: 0, y: 1 }, { x: 1, y: 3 }, { x: 2, y: 5 }])).toBeCloseTo(2);
        expect(slope([{ x: 1, y: 1 }])).toBeNull();
        expect(slope([{ x: 1, y: 1 }, { x: 1, y: 2 }])).toBeNull();
    });

    test("summarize follows the tab's renderer (largest at the end) after the first minute", () => {
        const at0 = 1_000_000;
        const samples: GrowthSample[] = [0, 0.5, 1, 1.5, 2, 2.5, 3].map((min, i) => ({
            variant: 'v',
            at: at0 + min * 60_000,
            tick: 100 + i * 200,
            // pid 2 is the tab: 500 MB + 100 MB/min (warm-up sample far off the line); pid 1 is flat
            renderers: [
                { pid: 1, pssKb: 50_000, rssKb: 60_000 },
                { pid: 2, pssKb: i === 0 ? 900_000 : ((500 + 100 * min) * 1e6) / 1024, rssKb: 0 },
            ],
        }));
        const s = summarize('v', samples);
        expect(s.pid).toBe(2);
        expect(s.samples).toBe(5);
        expect(s.mbPerMin).toBeCloseTo(100, 1);
        // 200 ticks per half minute: 100 MB/min is 0.25 MB/tick
        expect(s.mbPerTick).toBeCloseTo(0.25, 3);
        expect(s.ticks).toBe(800);
    });

    test('throttleExpression drops all but every nth state send, passing other sends', () => {
        const sent: unknown[] = [];
        class FakeSocket {
            send(d: unknown) {
                sent.push(d);
            }
        }
        const window: Record<string, unknown> = {};
        new Function('window', 'WebSocket', `return ${throttleExpression(3)}`)(window, FakeSocket);
        const ws = new FakeSocket();
        for (let i = 0; i < 7; i++) ws.send(`{"type":"state","n":${i}}`);
        ws.send('{"type":"actionResult"}');
        ws.send(new Uint8Array([1]));
        expect(sent.filter(d => typeof d === 'string' && d.startsWith('{"type":"state"')).length).toBe(3);
        expect(sent).toContain('{"type":"actionResult"}');
        expect(sent.length).toBe(5);
    });
});
