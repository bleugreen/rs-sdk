import { describe, expect, test } from 'bun:test';
import { FrameStats, LoopRate } from './frames.js';

describe('FrameStats', () => {
    test('a steady 300 ms cadence has no catch-ups', () => {
        const f = new FrameStats();
        for (let i = 0; i <= 200; i++) f.add(i * 300);
        expect(f.summary()).toMatchObject({ n: 200, p50: 310, p90: 310, max: 300, catchUps: 0, under150: 0, over350: 0 });
    });

    test('a short interval right after a long one is a catch-up; either alone is not', () => {
        const f = new FrameStats();
        let t = 0;
        const at = (gap: number) => { t += gap; f.add(t); };
        f.add(0);
        at(300); at(520); at(80); // overrun then catch-up
        at(300); at(100); // short alone
        at(400); at(300); // long alone
        at(380); at(20); // another catch-up
        const s = f.summary();
        expect(s.catchUps).toBe(2);
        expect(s.catchUpsLastMinute).toBe(2);
        expect(s.under150).toBe(3);
        expect(s.over350).toBe(3);
    });

    test('catch-ups older than a minute leave the last-minute count', () => {
        const f = new FrameStats();
        f.add(0); f.add(400); f.add(450);
        for (let t = 750; t <= 70_000; t += 300) f.add(t);
        expect(f.summary().catchUps).toBe(1);
        expect(f.summary().catchUpsLastMinute).toBe(0);
    });
});

describe('LoopRate', () => {
    test('reports the loop rate per tick interval, its p10 over 10 s and the run minimum', () => {
        const l = new LoopRate();
        let count = 0;
        for (let i = 0; i <= 40; i++) {
            // 74 loops per 300 ms tick... except a throttled stretch of 2 per tick early on
            count += i === 0 ? 0 : i <= 3 ? 1 : 22;
            l.add(i * 300, count);
        }
        const s = l.summary();
        expect(s.last).toBeCloseTo(73.3, 1);
        expect(s.min).toBeCloseTo(3.3, 1);
        // the throttled ticks are more than 10 s old
        expect(s.p10Last10s).toBeCloseTo(73.3, 1);
    });
});
