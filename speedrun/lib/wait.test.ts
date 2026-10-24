import { describe, expect, test } from 'bun:test';
import { LOST_AFTER_TICKS } from '../runner/resume';
import { FakeSdk } from './fake-sdk';
import { fakeClock as jest, microtasks, peek, tickEvery, useFakeTicks } from './fake-ticks';
import type { ActionResult, BotWorldState } from '../../sdk/types';
import {
    CLIENT_IDLE_LOGOUT_MS, DEMO_TICK_MS, failureReason, IDLE_PERIOD_MIN_SPAN_MS, IDLE_TICKS, idleBoundMs, KEEP_INPUT_MS, nextTick, onStates, periodMs, serverClock, STALLED, TickPeriod, tickMs, waitOrThrow, waitTicks, waitUntil,
    type KeepInputEvent, type WaitResult,
} from './wait';

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
        const slow = new TickPeriod();
        for (let k = 0; k <= 20; k++) slow.see(100 + k, 400 * k);
        expect(idleBoundMs({ ticks: 100, period: slow })).toBe(100 * 400);
        const burst = new TickPeriod();
        for (let k = 0; k <= 20; k++) burst.see(100 + k, 150 * k);
        expect(idleBoundMs({ ticks: 100, period: burst })).toBe(100 * 300);
        const short = new TickPeriod();
        short.see(1, 0);
        short.see(2, IDLE_PERIOD_MIN_SPAN_MS - 1);
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

describe('TickPeriod.msPerTick: the observed period, once it has watched long enough', () => {
    test('null until measured and the arrivals span minSpanMs; republishes within a tick do not count', () => {
        const p = new TickPeriod();
        for (let k = 0; k <= 50; k++) p.see(100 + k, 350 * k);
        expect(p.msPerTick(20_000)).toBeNull();
        for (let k = 51; k <= 100; k++) {
            p.see(100 + k, 350 * k);
            p.see(100 + k, 350 * k + 120);
        }
        expect(p.msPerTick(20_000)).toBe(350);
    });

    test('the rolling window follows a change: 300 ms ticks for 30 s, then 400 ms ticks for 40 s', () => {
        const p = new TickPeriod();
        let [ms, tick] = [0, 0];
        for (; ms < 30_000; ms += 300) p.see(tick++, ms);
        for (const end = ms + 40_000; ms <= end; ms += 400) p.see(tick++, ms);
        expect(p.msPerTick(20_000)).toBe(400);
    });

    test('a relaunch restarts the span, so the time away is not read as ticks; the period stands', () => {
        const p = new TickPeriod();
        for (let k = 0; k <= 100; k++) p.see(500 + k, 350 * k);
        p.see(3, 60_000);
        p.see(4, 60_350);
        expect(p.msPerTick(20_000)).toBe(350);
    });
});

describe('the tick length at 300 and 400 ms', () => {
    test('tickMs falls back to DEMO_TICK_MS (400), the demo since its 2026-10-22 restart', () => {
        expect(DEMO_TICK_MS).toBe(400);
        expect(tickMs({})).toBe(400);
        expect(tickMs({ NODE_TICKRATE: '300' })).toBe(300);
    });

    for (const ms of [300, 400]) {
        test(`at ${ms} ms: periodMs and serverClock read the observed period once trusted, the nominal before`, () => {
            process.env.SPEEDRUN_TICK_MS = '400';
            const p = new TickPeriod();
            expect(periodMs(p)).toBe(400);
            for (let k = 0; k <= 20; k++) p.see(k, k * ms);
            expect(periodMs(p)).toBe(ms);
            const clock = serverClock(100, 0, p);
            expect(clock(10 * ms)).toBe(110);
            expect(serverClock(100, 0)(10 * 400)).toBe(110);
            process.env.SPEEDRUN_TICK_MS = '300';
        });

        test(`at ${ms} ms a tick: the default idle bound fires after IDLE_TICKS ticks of silence, not before`, async () => {
            process.env.SPEEDRUN_TICK_MS = String(ms);
            const sdk = new FakeSdk();
            const p = waitUntil(sdk, () => false, { maxTicks: 10_000 });
            tickEvery(sdk, ms, 3);
            jest.advanceTimersByTime(IDLE_TICKS * ms - 1);
            expect(await peek(p)).toBeUndefined();
            jest.advanceTimersByTime(1);
            expect(await p).toMatchObject({ ok: false, reason: 'idle', tick: 103 });
            process.env.SPEEDRUN_TICK_MS = '300';
        });
    }
});

describe('keep-input through a long wait (the client idle logout, rs/648)', () => {
    const waits = (sdk: FakeSdk) => sdk.sent.filter(a => a.method === 'sendWait');
    /** `n` ticks `ms` of wall time apart on the clock the keep-input reads, letting a sent wait settle between them. */
    async function hold(sdk: FakeSdk, clock: { t: number }, ms: number, n: number): Promise<void> {
        for (let i = 0; i < n; i++) {
            clock.t += ms;
            sdk.tick();
            await microtasks(3);
        }
    }

    test('one keep-input a tenth of the way to the client idle logout', () => {
        expect(CLIENT_IDLE_LOGOUT_MS).toBe(600_000);
        expect(KEEP_INPUT_MS * 10).toBe(CLIENT_IDLE_LOGOUT_MS);
    });

    test('a wait that ends within 60 s of wall time sends nothing', async () => {
        const sdk = new FakeSdk();
        const clock = { t: 0 };
        const p = waitUntil(sdk, s => s.tick === 249, { maxTicks: 10_000, keepInput: { sdk, now: () => clock.t } });
        await hold(sdk, clock, 400, 149);
        expect(clock.t).toBe(59_600);
        expect(await p).toMatchObject({ ok: true, tick: 249 });
        expect(sdk.sent).toEqual([]);
    });

    test('a 6.5-minute wait sends one a minute (6), each a single one-tick wait, and none once it has resolved', async () => {
        const sdk = new FakeSdk();
        const clock = { t: 0 };
        const events: KeepInputEvent[] = [];
        const p = waitUntil(sdk, s => s.tick === 100 + 975, { maxTicks: 10_000, keepInput: { sdk, now: () => clock.t, onInput: e => events.push(e) } });
        await hold(sdk, clock, 400, 975);
        expect(clock.t).toBe(390_000);
        expect((await p).ok).toBe(true);
        expect(waits(sdk)).toEqual(Array.from({ length: 6 }, () => ({ method: 'sendWait', args: [1] })));
        expect(events.map(e => e.tick)).toEqual([250, 400, 550, 700, 850, 1000]);
        expect(events.map(e => [e.n, e.idleMs])).toEqual([1, 2, 3, 4, 5, 6].map(n => [n, 60_000]));
        await hold(sdk, clock, 400, 600);
        expect(waits(sdk)).toHaveLength(6);
    });

    test('a wait that fails (maxTicks) stops sending at its failure', async () => {
        const sdk = new FakeSdk();
        const clock = { t: 0 };
        const p = waitUntil(sdk, () => false, { maxTicks: 200, keepInput: { sdk, now: () => clock.t } });
        await hold(sdk, clock, 400, 201);
        expect(await p).toMatchObject({ ok: false, reason: 'maxTicks' });
        expect(waits(sdk)).toHaveLength(1);
        await hold(sdk, clock, 400, 600);
        expect(waits(sdk)).toHaveLength(1);
    });

    test('one in flight at a time: a keep-input that has not settled holds the next back', async () => {
        const sdk = new FakeSdk();
        const clock = { t: 0 };
        let calls = 0;
        let release: (r: ActionResult) => void = () => {};
        const keep = { sendWait: () => (calls++, new Promise<ActionResult>(r => (release = r))) };
        const p = waitUntil(sdk, () => false, { maxTicks: 10_000, keepInput: { sdk: keep, now: () => clock.t } });
        await hold(sdk, clock, 400, 750);
        expect(calls).toBe(1);
        release({ success: true, message: 'Wait complete' });
        await microtasks(5);
        await hold(sdk, clock, 400, 1);
        expect(calls).toBe(2);
        void p;
    });

    test('a keep-input that fails or throws does not stop the next', async () => {
        const sdk = new FakeSdk();
        const clock = { t: 0 };
        let calls = 0;
        const keep = {
            sendWait: (): Promise<ActionResult> => {
                calls++;
                if (calls === 1) throw new Error('not connected');
                return Promise.reject(new Error('timed out'));
            },
        };
        void waitUntil(sdk, () => false, { maxTicks: 10_000, keepInput: { sdk: keep, now: () => clock.t } });
        await hold(sdk, clock, 400, 450);
        expect(calls).toBe(3);
    });

    test('a wait without keepInput sends nothing however long it stands', async () => {
        const sdk = new FakeSdk();
        const clock = { t: 0 };
        void waitUntil(sdk, () => false, { maxTicks: 10_000 });
        await hold(sdk, clock, 400, 2_000);
        expect(sdk.sent).toEqual([]);
    });
});
