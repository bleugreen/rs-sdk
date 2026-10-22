import { describe, expect, test } from 'bun:test';
import { LOST_AFTER_TICKS } from '../runner/resume';
import { FakeSdk } from './fake-sdk';
import { fakeClock as jest, peek, tickEvery, useFakeTicks } from './fake-ticks';
import { IDLE_TICKS, nextTick, waitOrThrow, waitTicks, waitUntil, type WaitResult } from './wait';

useFakeTicks();

test('the idle timeout outlasts the resumable runner stale-session threshold', () => {
    expect(IDLE_TICKS).toBeGreaterThanOrEqual(LOST_AFTER_TICKS);
});

describe('slow but steady ticks', () => {
    test('waitTicks(300) at 340 ms a tick resolves (102 s, past the old 93.9 s total budget)', async () => {
        const sdk = new FakeSdk();
        const p = waitTicks(sdk, 300);
        tickEvery(sdk, 340, 300);
        expect((await p).tick).toBe(400);
    });

    test('a stall shorter than IDLE_TICKS is not a dead client', async () => {
        const sdk = new FakeSdk();
        const p = nextTick(sdk);
        jest.advanceTimersByTime(IDLE_TICKS * 300 - 1);
        expect(await peek(p)).toBeUndefined();
        sdk.tick();
        expect((await p).tick).toBe(101);
    });
});

describe('a client that stops publishing', () => {
    test('fails with reason idle IDLE_TICKS x tickMs after the last tick, whatever maxTicks is', async () => {
        const sdk = new FakeSdk();
        const p = waitUntil(sdk, () => false, { maxTicks: 10_000 });
        tickEvery(sdk, 300, 5);
        jest.advanceTimersByTime(IDLE_TICKS * 300 - 1);
        expect(await peek(p)).toBeUndefined();
        jest.advanceTimersByTime(1);
        expect(await p).toMatchObject({ ok: false, reason: 'idle', tick: 105 });
    });

    test('republishes within one tick do not hold the idle timer off', async () => {
        const sdk = new FakeSdk();
        const p = waitUntil(sdk, () => false, { maxTicks: 10_000 });
        sdk.tick();
        for (let i = 0; i < IDLE_TICKS - 1; i++) {
            jest.advanceTimersByTime(300);
            sdk.push({});
        }
        jest.advanceTimersByTime(300);
        expect(await p).toMatchObject({ ok: false, reason: 'idle', tick: 101 });
    });

    test('waitTicks, nextTick and waitOrThrow say no tick arrived', async () => {
        const sdk = new FakeSdk();
        const waits = [waitTicks(sdk, 300), nextTick(sdk), waitOrThrow(sdk, () => false, 50, 'the bank')];
        for (const w of waits) w.catch(() => {});
        jest.advanceTimersByTime(IDLE_TICKS * 300);
        await expect(waits[0]!).rejects.toThrow(`waitTicks(300): no new tick for ${IDLE_TICKS} ticks`);
        await expect(waits[1]!).rejects.toThrow(`nextTick: no new tick for ${IDLE_TICKS} ticks`);
        await expect(waits[2]!).rejects.toThrow(/no new tick for \d+ ticks .* waiting for: the bank/);
    });

    test('SPEEDRUN_TICK_MS scales the idle timer', async () => {
        process.env.SPEEDRUN_TICK_MS = '50';
        const sdk = new FakeSdk();
        const p = waitUntil(sdk, () => false, { maxTicks: 10_000 });
        jest.advanceTimersByTime(IDLE_TICKS * 50 - 1);
        expect(await peek(p)).toBeUndefined();
        jest.advanceTimersByTime(1);
        expect(await p).toMatchObject({ ok: false, reason: 'idle', tick: 100 });
    });
});

describe('maxTicks', () => {
    test('reached with steady ticks: fails with reason maxTicks', async () => {
        const sdk = new FakeSdk();
        const p = waitUntil(sdk, () => false, { maxTicks: 5 });
        tickEvery(sdk, 300, 6);
        const r: WaitResult = await p;
        expect(r).toMatchObject({ ok: false, reason: 'maxTicks', tick: 106 });
    });

    test('waitOrThrow reports the ticks that passed', async () => {
        const sdk = new FakeSdk();
        const p = waitOrThrow(sdk, () => false, 5, 'the bank');
        p.catch(() => {});
        tickEvery(sdk, 300, 6);
        await expect(p).rejects.toThrow('timed out after 6 ticks waiting for: the bank');
    });

    test('keeps counting across a relaunch that restarts the tick clock', async () => {
        const sdk = new FakeSdk();
        const p = waitUntil(sdk, () => false, { maxTicks: 5 });
        tickEvery(sdk, 300, 3);
        sdk.push({ tick: 0 });
        tickEvery(sdk, 300, 2);
        expect(await peek(p)).toBeUndefined();
        tickEvery(sdk, 300, 1);
        expect(await p).toMatchObject({ ok: false, reason: 'maxTicks', tick: 3 });
    });

    test('waitTicks across a relaunch throws instead of waiting for the new clock to reach the old target', async () => {
        const sdk = new FakeSdk();
        const p = waitTicks(sdk, 10);
        p.catch(() => {});
        tickEvery(sdk, 300, 4);
        sdk.push({ tick: 0 });
        tickEvery(sdk, 300, 10);
        await expect(p).rejects.toThrow(/waitTicks\(10\): tick 110 not reached in 13 ticks/);
    });
});
