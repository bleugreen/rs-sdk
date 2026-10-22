import { describe, expect, test } from 'bun:test';
import { FakeSdk } from '../lib/fake-sdk';
import { fakeClock, peek, tickEvery, useFakeTicks } from '../lib/fake-ticks';
import { IDLE_TICKS } from '../lib/wait';
import { until } from './altar-room';

describe('until', () => {
    useFakeTicks();

    test('counts 2 x (ticks + 5) ticks however slowly they come (30 at 340 ms is 10.2 s, past the old 9 s budget)', async () => {
        const sdk = new FakeSdk();
        const ctx = { sdk: sdk as never };
        const hit = until(ctx, s => s.tick >= 130, 10);
        const miss = until(ctx, () => false, 10);
        tickEvery(sdk, 340, 30);
        expect(await hit).toBe(true);
        expect(await peek(miss)).toBeUndefined();
        tickEvery(sdk, 340, 1);
        expect(await miss).toBe(false);
    });

    test('a client that stops publishing ends it false', async () => {
        const sdk = new FakeSdk();
        const p = until({ sdk: sdk as never }, () => false, 1_000);
        fakeClock.advanceTimersByTime(IDLE_TICKS * 300);
        expect(await p).toBe(false);
    });
});
