import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { baseState, FakeSdk } from '../lib/fake-sdk';
import { report, TickLog } from '../lib/ticks';
import { resolveStart, runSteps, StepError, type RunnerSession, type Step } from './step';

const prevTick = process.env.SPEEDRUN_TICK_MS;
beforeAll(() => { process.env.SPEEDRUN_TICK_MS = '5'; });
afterAll(() => { if (prevTick === undefined) delete process.env.SPEEDRUN_TICK_MS; else process.env.SPEEDRUN_TICK_MS = prevTick; });

/** A session whose fake client ticks every 2 ms while the test runs. */
function fakeSession(): { session: RunnerSession; sdk: FakeSdk; stop: () => void } {
    const sdk = new FakeSdk(baseState({ tick: 0 }));
    const timer = setInterval(() => sdk.tick(), 2);
    const session = { sdk, bot: {}, name: 'lab', sessionId: 0 } as unknown as RunnerSession;
    return { session, sdk, stop: () => clearInterval(timer) };
}

function step(name: string, over: Partial<Step<{ trace: string[] }>> = {}): Step<{ trace: string[] }> {
    return {
        name,
        preconditions: () => true,
        run: async ({ c }) => { c.trace.push(name); },
        postconditions: () => true,
        logoutSafe: false,
        ...over,
    };
}

describe('runSteps', () => {
    test('runs every step in order and logs one row each', async () => {
        const { session, stop } = fakeSession();
        const log = TickLog.memory('t');
        const c = { trace: [] as string[] };
        const r = await runSteps(session, [step('a'), step('b')], { log, c, shouldStop: () => false });
        stop();
        expect(r).toEqual({ completed: 2 });
        expect(c.trace).toEqual(['a', 'b']);
        expect(report(log.rows).steps.map(s => [s.step, s.count, s.failures])).toEqual([['a', 1, 0], ['b', 1, 0]]);
    });

    test('a failed precondition stops before run is called', async () => {
        const { session, stop } = fakeSession();
        const log = TickLog.memory('t');
        const c = { trace: [] as string[] };
        const p = runSteps(session, [step('a', { preconditions: () => 'not at the bank' }), step('b')], { log, c, shouldStop: () => false });
        await expect(p).rejects.toThrow(StepError);
        stop();
        expect(c.trace).toEqual([]);
        expect(log.rows.map(r => [r.step, r.ok, r.error])).toEqual([['a:precondition', false, 'not at the bank']]);
    });

    test('a failed postcondition is fatal and logged', async () => {
        const { session, stop } = fakeSession();
        const log = TickLog.memory('t');
        const c = { trace: [] as string[] };
        const p = runSteps(session, [step('a', { postconditions: () => 'inventory not empty' }), step('b')], { log, c, shouldStop: () => false });
        await expect(p).rejects.toThrow('postcondition failed: inventory not empty');
        stop();
        expect(c.trace).toEqual(['a']);
        expect(log.rows.map(r => [r.step, r.ok])).toEqual([['a', true], ['a:postcondition', false]]);
    });

    test('a stop request waits for the next logoutSafe step, then logs out with the resume index', async () => {
        const { session, stop } = fakeSession();
        const log = TickLog.memory('t');
        const c = { trace: [] as string[] };
        let stopRequested = false;
        let loggedOut = 0;
        const steps = [
            step('a', { run: async ({ c }) => { c.trace.push('a'); stopRequested = true; } }), // not safe
            step('b', { logoutSafe: true }),
            step('c'),
        ];
        const r = await runSteps(session, steps, { log, c, shouldStop: () => stopRequested, logout: async () => { loggedOut++; } });
        stop();
        expect(c.trace).toEqual(['a', 'b']);
        expect(r).toEqual({ completed: 2, resumeAt: 2 });
        expect(loggedOut).toBe(1);
    });

    test('from resumes at an index or a step name', async () => {
        expect(resolveStart([{ name: 'a' }, { name: 'b' }], 'b')).toBe(1);
        expect(resolveStart([{ name: 'a' }, { name: 'b' }], 1)).toBe(1);
        expect(() => resolveStart([{ name: 'a' }], 'z')).toThrow();
        const { session, stop } = fakeSession();
        const c = { trace: [] as string[] };
        await runSteps(session, [step('a'), step('b')], { log: TickLog.memory(), c, from: 'b', shouldStop: () => false });
        stop();
        expect(c.trace).toEqual(['b']);
    });
});
