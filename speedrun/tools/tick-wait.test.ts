import { describe, expect, test } from 'bun:test';
import { TickClock } from './tick-wait';

/** A fake world: the tick advances one per `msPerTick` of fake time, and sleeping advances the time. */
function world(msPerTick: number, start = 100) {
    let ms = 0;
    return {
        clock: new TickClock(() => start + Math.floor(ms / msPerTick), async d => (ms += d)),
        now: () => ms
    };
}

describe('TickClock', () => {
    test('waits for observed ticks, so a slow world takes longer in wall time than N x 300 ms', async () => {
        const w = world(370);
        const t = await w.clock.at(175, { pollMs: 10, clock: w.now });
        expect(t).toBe(175);
        expect(w.now()).toBeGreaterThanOrEqual(75 * 370);
        expect(w.now()).toBeGreaterThan(75 * 300);
    });

    test('returns at once when the tick is already past the target', async () => {
        const w = world(300, 500);
        expect(await w.clock.at(400, { clock: w.now })).toBe(500);
        expect(w.now()).toBe(0);
    });

    test('a tick that stops advancing is an error, not a silent wait', async () => {
        let ms = 0;
        const c = new TickClock(() => 10, async d => (ms += d));
        await expect(c.at(20, { pollMs: 100, stallMs: 1000, clock: () => ms })).rejects.toThrow(/stalled at 10/);
    });
});
