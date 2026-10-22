// Fake wall time for tests of tick waits: a tick is `fakeClock.advanceTimersByTime(ms)`
// followed by `sdk.tick()`, so an idle timer sees the wall time between ticks.

import { afterEach, beforeEach, jest as bunJest } from 'bun:test';
import type { BotWorldState } from '../../sdk/types';
import type { FakeSdk } from './fake-sdk';

// The locked @types/bun (1.2.15) predates bun:test's fake timers, which the
// runtime CI pins (1.4.x) has; this names the part of that API used here.
export const fakeClock = bunJest as unknown as { useFakeTimers(): void; useRealTimers(): void; advanceTimersByTime(ms: number): void };

/** Run each test of the enclosing describe (or file) on fake timers with SPEEDRUN_TICK_MS=`ms`, restoring both afterwards. */
export function useFakeTicks(ms = 300): void {
    const saved = process.env.SPEEDRUN_TICK_MS;
    beforeEach(() => {
        process.env.SPEEDRUN_TICK_MS = String(ms);
        fakeClock.useFakeTimers();
    });
    afterEach(() => {
        fakeClock.useRealTimers();
        if (saved === undefined) delete process.env.SPEEDRUN_TICK_MS;
        else process.env.SPEEDRUN_TICK_MS = saved;
    });
}

/** `n` times: let `ms` of fake time pass, then publish the next tick with `patch`. */
export function tickEvery(sdk: FakeSdk, ms: number, n: number, patch: Partial<BotWorldState> = {}): void {
    for (let i = 0; i < n; i++) {
        fakeClock.advanceTimersByTime(ms);
        sdk.tick(patch);
    }
}

/** Let queued promise callbacks run without any fake time passing (`flush` is a timer, so it would not). */
export async function microtasks(n = 20): Promise<void> {
    for (let i = 0; i < n; i++) await Promise.resolve();
}

/** The settled value of `p` so far, or undefined while it is pending. */
export async function peek<T>(p: Promise<T>): Promise<T | undefined> {
    const pending = Symbol();
    const r = await Promise.race([p, Promise.resolve(pending)]);
    return r === pending ? undefined : (r as T);
}
