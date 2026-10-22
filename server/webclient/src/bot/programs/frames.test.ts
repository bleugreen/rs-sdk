import { describe, expect, test } from 'bun:test';

import '../../lite/test-support/browser-globals.js';

import { FrameStats, LoopRate } from './frames.js';

/** A FrameStats fed these intervals from t = 0. */
function fed(gaps: number[], tickMs?: number): FrameStats {
    const f = new FrameStats(tickMs);
    let t = 0;
    f.add(0);
    for (const g of gaps) f.add((t += g));
    return f;
}

describe('FrameStats', () => {
    test('a steady 300 ms cadence has no catch-ups', () => {
        const f = new FrameStats(300);
        for (let i = 0; i <= 200; i++) f.add(i * 300);
        expect(f.summary()).toMatchObject({ n: 200, p50: 310, p90: 310, max: 300, catchUps: 0, underHalfT: 0, overSevenSixthsT: 0, T: 300, TSource: 'driver' });
    });

    test('a short interval right after a long one is a catch-up; either alone is not', () => {
        // overrun then catch-up; short alone; long alone; another catch-up
        const s = fed([300, 520, 80, 300, 100, 400, 300, 380, 20], 300).summary();
        expect(s.catchUps).toBe(2);
        expect(s.catchUpsLastMinute).toBe(2);
        expect(s.underHalfT).toBe(3);
        expect(s.overSevenSixthsT).toBe(3);
    });

    test('catch-ups older than a minute leave the last-minute count', () => {
        const f = new FrameStats(300);
        f.add(0); f.add(400); f.add(450);
        for (let t = 750; t <= 70_000; t += 300) f.add(t);
        expect(f.summary().catchUps).toBe(1);
        expect(f.summary().catchUpsLastMinute).toBe(0);
    });

    test('at T = 400: under 200 after over 466.7 ms', () => {
        expect(fed([400, 480, 180], 400).summary()).toMatchObject({ catchUps: 1, underHalfT: 1, overSevenSixthsT: 1, T: 400 });
        expect(fed([400, 440, 180], 400).summary()).toMatchObject({ catchUps: 0, underHalfT: 1, overSevenSixthsT: 0 });
        // a catch-up at T = 300, not at T = 400
        expect(fed([400, 420, 140], 400).summary().catchUps).toBe(0);
        expect(fed([300, 420, 140], 300).summary().catchUps).toBe(1);
    });

    test("without the driver's T, the run's median interval rounded to 50 ms stands for it", () => {
        const f = fed([...Array(20).fill(396), 480, 180]);
        expect(f.summary()).toMatchObject({ T: 400, TSource: 'median', catchUps: 1 });
        // the same intervals judged at a fixed 300 count every one as long
        expect(fed([...Array(20).fill(396), 480, 180], 300).summary()).toMatchObject({ overSevenSixthsT: 21, catchUps: 0 });
        expect(new FrameStats().summary()).toMatchObject({ n: 0, T: null, TSource: null });
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
