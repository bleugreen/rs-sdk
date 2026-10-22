import { describe, expect, test } from 'bun:test';
import { LOST_AFTER_TICKS } from '../runner/resume';
import { FakeSdk } from './fake-sdk';
import { fakeClock as jest, peek, tickEvery, useFakeTicks } from './fake-ticks';
import type { BotWorldState } from '../../sdk/types';
import { failureReason, IDLE_PERIOD_MIN_SPAN_MS, IDLE_TICKS, idleBoundMs, nextTick, onStates, STALLED, tickPeriod, waitOrThrow, waitTicks, waitUntil, type WaitResult } from './wait';

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

describe('an idle bound for a known silent window', () => {
    test('silence past IDLE_TICKS is not yet; the wait fails only after its own bound, reporting the silence', async () => {
        const sdk = new FakeSdk();
        const p = waitUntil(sdk, s => s.tick === 102, { maxTicks: 8, idle: { ticks: 100 } });
        tickEvery(sdk, 300, 1);
        jest.advanceTimersByTime(100 * 300 - 1);
        expect(await peek(p)).toBeUndefined();
        jest.advanceTimersByTime(1);
        expect(await p).toMatchObject({ ok: false, reason: 'idle', tick: 101, silentMs: 100 * 300 });
    });

    test('a silent gap shorter than the bound ends in the landing tick', async () => {
        const sdk = new FakeSdk();
        const p = waitUntil(sdk, s => s.tick === 102, { maxTicks: 8, idle: { ticks: 100 } });
        tickEvery(sdk, 300, 1);
        tickEvery(sdk, 20_000, 1);
        expect(await p).toMatchObject({ ok: true, tick: 102 });
    });

    test('scales with the observed tick period, never below tickMs', () => {
        let ms = 0;
        const at = (period: ReturnType<typeof tickPeriod>, tick: number, t: number) => { ms = t; period.see({ tick } as BotWorldState); };
        const slow = tickPeriod(60_000, () => ms);
        for (let k = 0; k <= 10; k++) at(slow, 100 + k, 400 * k);
        expect(idleBoundMs({ ticks: 100, period: slow })).toBe(100 * 400);
        const burst = tickPeriod(60_000, () => ms);
        for (let k = 0; k <= 20; k++) at(burst, 100 + k, 150 * k);
        expect(idleBoundMs({ ticks: 100, period: burst })).toBe(100 * 300);
        const short = tickPeriod(60_000, () => ms);
        at(short, 1, 0);
        at(short, 2, IDLE_PERIOD_MIN_SPAN_MS - 1);
        expect(idleBoundMs({ ticks: 100, period: short })).toBe(100 * 300);
        expect(idleBoundMs()).toBe(IDLE_TICKS * 300);
    });
});

describe('maxTicks', () => {
    test('reached with steady ticks: fails with reason maxTicks', async () => {
        const sdk = new FakeSdk();
        const p = waitUntil(sdk, () => false, { maxTicks: 5 });
        tickEvery(sdk, 300, 6);
        const r: WaitResult = await p;
        expect(r).toMatchObject({ ok: false, reason: 'maxTicks', tick: 106, silentMs: 0 });
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

describe('onStates', () => {
    test('feeds the current state first, then every state, until step returns a value', async () => {
        const sdk = new FakeSdk();
        const seen: number[] = [];
        const p = onStates(sdk, 10, s => (seen.push(s.tick), s.tick === 102 ? 'two' : undefined));
        tickEvery(sdk, 300, 2);
        expect(await p).toEqual({ ok: true, value: 'two' });
        expect(seen).toEqual([100, 101, 102]);
    });

    test('300 ticks at 340 ms a tick reach the step (102 s; no total-time budget)', async () => {
        const sdk = new FakeSdk();
        const p = onStates(sdk, 300, s => (s.tick === 400 ? s.tick : undefined));
        tickEvery(sdk, 340, 300);
        expect(await p).toEqual({ ok: true, value: 400 });
    });

    test('maxTicks and idle failures, and the reason text each reports', async () => {
        const sdk = new FakeSdk();
        const ticks = onStates(sdk, 3, () => undefined);
        tickEvery(sdk, 300, 4);
        expect(await ticks).toEqual({ ok: false, reason: 'maxTicks' });
        const idle = onStates(sdk, 10_000, () => undefined);
        jest.advanceTimersByTime(IDLE_TICKS * 300);
        expect(await idle).toEqual({ ok: false, reason: 'idle' });
        expect([failureReason('maxTicks'), failureReason('idle')]).toEqual(['timeout', STALLED]);
    });
});

describe('tickPeriod', () => {
    /** A client publishing tick `tick` at `t` ms, on a clock of its own. */
    const client = (windowMs: number) => {
        let ms = 0;
        const p = tickPeriod(windowMs, () => ms);
        const at = (tick: number, t: number) => {
            ms = t;
            p.see({ tick } as BotWorldState);
        };
        return { p, at };
    };

    test('ms per tick from the ticks seen, null until they span minSpanMs; republishes within a tick do not count', () => {
        const { p, at } = client(60_000);
        for (let k = 0; k <= 50; k++) at(100 + k, 350 * k);
        expect(p.msPerTick(20_000)).toBeNull();
        for (let k = 51; k <= 100; k++) {
            at(100 + k, 350 * k);
            at(100 + k, 350 * k + 120);
        }
        expect(p.msPerTick(20_000)).toBe(350);
    });

    test('only the window counts: 300 ms ticks for 30 s, then 400 ms ticks for the last 40 s', () => {
        const { p, at } = client(40_000);
        let [ms, tick] = [0, 0];
        for (; ms < 30_000; ms += 300) at(tick++, ms);
        for (const end = ms + 40_000; ms <= end; ms += 400) at(tick++, ms);
        expect(p.msPerTick(20_000)).toBe(400);
    });

    test('a relaunch restarts the measurement', () => {
        const { p, at } = client(60_000);
        for (let k = 0; k <= 100; k++) at(500 + k, 350 * k);
        expect(p.msPerTick(20_000)).toBe(350);
        at(3, 60_000);
        expect(p.msPerTick(0)).toBeNull();
        for (let k = 1; k <= 80; k++) at(3 + k, 60_000 + 300 * k);
        expect(p.msPerTick(20_000)).toBe(300);
    });
});
