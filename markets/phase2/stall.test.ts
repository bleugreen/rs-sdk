import { describe, expect, test } from 'bun:test';
import { StallWatch } from './stall';

const MIN = 60_000;
const p = { ms: 10 * MIN, retries: 2 };

describe('StallWatch', () => {
    test('coins that keep moving never stall', () => {
        const w = new StallWatch();
        for (let t = 0; t <= 60 * MIN; t += MIN) {
            w.observe(true, t, t);
            expect(w.check(t, p)).toBeNull();
        }
    });

    test('coins still for the threshold abort, once per threshold, then are left after the retries', () => {
        const w = new StallWatch();
        const verdicts: (string | null)[] = [];
        for (let t = 0; t <= 45 * MIN; t += MIN / 2) {
            w.observe(true, 500, t);
            verdicts.push(w.check(t, p)?.action ?? null);
        }
        const at = (a: string) => verdicts.flatMap((v, i) => (v === a ? [i / 2] : []));
        expect(at('abort')).toEqual([10, 20]);
        expect(at('leave')).toEqual([30]);
    });

    test('coins moving again reset the retries', () => {
        const w = new StallWatch();
        w.observe(true, 500, 0);
        expect(w.check(10 * MIN, p)?.action).toBe('abort');
        expect(w.check(20 * MIN, p)?.action).toBe('abort');
        w.observe(true, 550, 21 * MIN);
        expect(w.retries).toBe(0);
        expect(w.check(30 * MIN, p)).toBeNull();
        expect(w.check(31 * MIN, p)).toEqual({ action: 'abort', retry: 1, stalledMs: 10 * MIN, coins: 550 });
    });

    test('time off the method stage or between sessions does not count', () => {
        const w = new StallWatch();
        w.observe(true, 500, 0);
        w.observe(false, 500, 5 * MIN);
        expect(w.check(30 * MIN, p)).toBeNull();
        w.observe(true, 500, 30 * MIN);
        expect(w.check(39 * MIN, p)).toBeNull();
        w.pause();
        expect(w.check(41 * MIN, p)).toBeNull();
        w.observe(true, 500, 50 * MIN);
        expect(w.check(60 * MIN, p)?.action).toBe('abort');
    });

    test('a threshold of 0 turns it off', () => {
        const w = new StallWatch();
        w.observe(true, 500, 0);
        expect(w.check(600 * MIN, { ms: 0, retries: 3 })).toBeNull();
    });
});
