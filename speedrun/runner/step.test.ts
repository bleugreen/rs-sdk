import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { baseState, FakeSdk, runToggleServer } from '../lib/fake-sdk';
import { IF_RUN_OFF, IF_RUN_ON, runIsOn } from '../lib/run-mode';
import { report, TickLog, type TickRow } from '../lib/ticks';
import { sleep, waitUntil } from '../lib/wait';
import { BOUNDARY_STEP, resolveStart, runSteps, StepError, type RunnerSession, type Step } from './step';

const prevTick = process.env.SPEEDRUN_TICK_MS;
beforeAll(() => { process.env.SPEEDRUN_TICK_MS = '5'; });
afterAll(() => { if (prevTick === undefined) delete process.env.SPEEDRUN_TICK_MS; else process.env.SPEEDRUN_TICK_MS = prevTick; });

/** A session whose fake client ticks every 2 ms while the test runs. */
function fakeSession(): { session: RunnerSession; sdk: FakeSdk; stop: () => void } {
    const { session, sdk } = manualSession(0);
    const timer = setInterval(() => sdk.tick(), 2);
    return { session, sdk, stop: () => clearInterval(timer) };
}

/** A session whose fake client ticks only when the test says so. */
function manualSession(tick: number): { session: RunnerSession; sdk: FakeSdk } {
    const sdk = new FakeSdk(baseState({ tick }));
    const session = { sdk, bot: {}, name: 'lab', sessionId: 0 } as unknown as RunnerSession;
    return { session, sdk };
}

type C = { trace: string[] };

function step(name: string, over: Partial<Step<C>> = {}): Step<C> {
    return {
        name,
        preconditions: () => true,
        run: async ({ c }) => { c.trace.push(name); },
        postconditions: () => true,
        logoutSafe: false,
        ...over,
    };
}

const stepRows = (rows: TickRow[]) => rows.filter(r => r.step !== BOUNDARY_STEP);
const boundaries = (rows: TickRow[]) => rows.filter(r => r.step === BOUNDARY_STEP);
const fake = (sdk: unknown) => sdk as FakeSdk;

describe('runSteps', () => {
    test('runs every step in order and logs one row each', async () => {
        const { session, stop } = fakeSession();
        const log = TickLog.memory('t');
        const c = { trace: [] as string[] };
        const r = await runSteps(session, [step('a'), step('b')], { log, c, shouldStop: () => false });
        stop();
        expect(r).toEqual({ completed: 2 });
        expect(c.trace).toEqual(['a', 'b']);
        expect(report(stepRows(log.rows)).steps.map(s => [s.step, s.count, s.failures])).toEqual([['a', 1, 0], ['b', 1, 0]]);
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
        expect(stepRows(log.rows).map(r => [r.step, r.ok])).toEqual([['a', true], ['a:postcondition', false]]);
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
        expect(boundaries(log.rows).map(r => r.meta?.to)).toEqual(['a', 'b', '(logout)']);
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

// These sessions tick only from inside the steps (or a timer a step sets), so
// any wait the runner should not take hangs the test instead of passing by luck.
describe('runSteps boundaries', () => {
    beforeAll(() => { process.env.SPEEDRUN_TICK_MS = '1000'; });
    afterAll(() => { process.env.SPEEDRUN_TICK_MS = '5'; });

    test('a three-step chain whose steps end mid-tick spends 0 boundary ticks', async () => {
        const { session, sdk } = manualSession(10);
        const log = TickLog.memory('t');
        const c = { trace: [] as string[] };
        // Each step sends one action, sees two ticks pass, and returns mid-tick.
        const walk = (name: string) => step(name, {
            run: async ({ sdk, c }) => {
                c.trace.push(name);
                await fake(sdk).sendWalk(1, 1);
                fake(sdk).tick();
                fake(sdk).tick();
            },
        });
        const r = await runSteps(session, [walk('a'), walk('b'), walk('c')], { log, c, shouldStop: () => false });
        expect(r).toEqual({ completed: 3 });
        expect(c.trace).toEqual(['a', 'b', 'c']);
        expect(stepRows(log.rows).map(r => [r.step, r.startTick, r.ticks])).toEqual([['a', 10, 2], ['b', 12, 2], ['c', 14, 2]]);
        expect(boundaries(log.rows).map(r => [r.meta?.from, r.meta?.to, r.ticks, r.meta?.waits])).toEqual([
            ['(start)', 'a', 0, []],
            ['a', 'b', 0, []],
            ['b', 'c', 0, []],
            ['c', '(end)', 0, []],
        ]);
        expect(report(log.rows).totalTicks).toBe(sdk.getState()!.tick - 10);
    });

    test('a failing precondition waits exactly one tick, then is checked again', async () => {
        const { session, sdk } = manualSession(10);
        const log = TickLog.memory('t');
        const seen: number[] = [];
        const steps = [
            step('a', { run: async () => { sdk.tick(); } }),
            step('b', {
                preconditions: s => {
                    seen.push(s.tick);
                    if (s.tick >= 12) return true;
                    setTimeout(() => sdk.tick(), 1);
                    return 'door not open yet';
                },
            }),
        ];
        await runSteps(session, steps, { log, c: { trace: [] }, shouldStop: () => false });
        expect(seen).toEqual([11, 12]);
        const ab = boundaries(log.rows).find(r => r.meta?.from === 'a')!;
        expect([ab.ticks, ab.meta?.waits]).toEqual([1, ['pre-recheck']]);
    });

    test('a precondition that still fails after the one-tick re-check throws, checked exactly twice', async () => {
        const { session, sdk } = manualSession(10);
        const log = TickLog.memory('t');
        const c = { trace: [] as string[] };
        const seen: number[] = [];
        const p = runSteps(session, [step('a', {
            preconditions: s => {
                seen.push(s.tick);
                setTimeout(() => sdk.tick(), 1);
                return 'not at the bank';
            },
        })], { log, c, shouldStop: () => false });
        await expect(p).rejects.toThrow('precondition failed: not at the bank');
        expect(seen).toEqual([10, 11]);
        expect(c.trace).toEqual([]);
        expect(log.rows.map(r => r.step)).toEqual(['a:precondition']);
    });

    test('a postcondition that holds a tick late passes on the re-check', async () => {
        const { session, sdk } = manualSession(10);
        const log = TickLog.memory('t');
        const steps = [step('a', {
            run: async () => { setTimeout(() => sdk.tick(), 1); },
            postconditions: s => (s.tick >= 11 ? true : 'not landed'),
        })];
        await runSteps(session, steps, { log, c: { trace: [] }, shouldStop: () => false });
        const end = boundaries(log.rows).find(r => r.meta?.to === '(end)')!;
        expect([end.ticks, end.meta?.waits]).toEqual([1, ['post-recheck']]);
    });

    test('a step that spent the tick\'s 5 user events hands off on the next tick, not later', async () => {
        const { session, sdk } = manualSession(10);
        const log = TickLog.memory('t');
        let bSawTick = -1;
        const steps = [
            step('a', {
                run: async ({ sdk }) => {
                    await Promise.all([1, 2, 3, 4, 5].map(i => fake(sdk).sendBankDeposit(i, 1)));
                    setTimeout(() => fake(sdk).tick(), 1);
                },
            }),
            step('b', { run: async ({ sdk }) => { bSawTick = sdk.getState()!.tick; } }),
        ];
        await runSteps(session, steps, { log, c: { trace: [] }, shouldStop: () => false });
        expect(bSawTick).toBe(11);
        const ab = boundaries(log.rows).find(r => r.meta?.from === 'a')!;
        expect([ab.ticks, ab.meta?.waits]).toEqual([1, ['budget']]);
        expect(ab.meta?.budget).toMatchObject({ tick: 10, sent: 5, pending: 0, free: 0 });
        expect(sdk.sent.length).toBe(5);
    });

    test('with room left in the tick\'s budget the next step starts in the same tick', async () => {
        const { session } = manualSession(10);
        const log = TickLog.memory('t');
        const steps = [
            step('a', { run: async ({ sdk }) => { await Promise.all([1, 2, 3, 4].map(i => fake(sdk).sendBankDeposit(i, 1))); } }),
            step('b'),
        ];
        await runSteps(session, steps, { log, c: { trace: [] }, shouldStop: () => false });
        const ab = boundaries(log.rows).find(r => r.meta?.from === 'a')!;
        expect([ab.ticks, ab.meta?.waits]).toEqual([0, []]);
        expect(ab.meta?.budget).toMatchObject({ sent: 4, free: 1 });
    });
});

describe('runSteps and the run toggle', () => {
    const presses = (sdk: FakeSdk) => sdk.sent.filter(a => a.method === 'sendClickComponent').map(a => a.args[0]);

    test('without an opt-out nothing is pressed: login already turned run on', async () => {
        const { session, sdk, stop } = fakeSession();
        sdk.onSend = runToggleServer(sdk);
        await runSteps(session, [step('a'), step('b')], { log: TickLog.memory('t'), c: { trace: [] }, shouldStop: () => false });
        stop();
        expect(presses(sdk)).toEqual([]);
    });

    test('running: false walks that step: run off before it, on again before the next step', async () => {
        const { session, sdk, stop } = fakeSession();
        sdk.onSend = runToggleServer(sdk);
        const saw: Record<string, boolean | null> = {};
        const record = (name: string): Partial<Step<C>> => ({ run: async ({ sdk: s }) => { saw[name] = runIsOn(s.getState()); } });
        const steps = [step('a', record('a')), step('lap', { ...record('lap'), running: false }), step('c', record('c'))];
        await runSteps(session, steps, { log: TickLog.memory('t'), c: { trace: [] }, shouldStop: () => false });
        stop();
        expect(saw).toEqual({ a: true, lap: false, c: true });
        expect(presses(sdk)).toEqual([IF_RUN_OFF, IF_RUN_ON]);
    });

    test('an opt-out the server will not take fails that step\'s precondition, before it runs', async () => {
        const { session, sdk, stop } = fakeSession();
        sdk.onSend = runToggleServer(sdk, { ignore: Infinity });
        const log = TickLog.memory('t');
        const c = { trace: [] as string[] };
        const err = await runSteps(session, [step('lap', { running: false })], { log, c, shouldStop: () => false }).catch(e => e);
        stop();
        expect(err).toBeInstanceOf(StepError);
        expect((err as StepError).phase).toBe('precondition');
        expect(c.trace).toEqual([]);
        expect(log.rows.some(r => r.step === 'lap:precondition' && !r.ok)).toBe(true);
    });
});

describe('runSteps on a stale state', () => {
    beforeAll(() => { process.env.SPEEDRUN_TICK_MS = '20'; });
    afterAll(() => { process.env.SPEEDRUN_TICK_MS = '5'; });

    test('a state older than one tick of wall time is waited past before the next check', async () => {
        const { session, sdk } = manualSession(10);
        const log = TickLog.memory('t');
        const seen: number[] = [];
        const steps = [
            step('a', { run: async () => { sdk.tick(); setTimeout(() => sdk.tick(), 70); await sleep(40); } }),
            step('b', { preconditions: s => { seen.push(s.tick); return true; } }),
        ];
        await runSteps(session, steps, { log, c: { trace: [] }, shouldStop: () => false });
        expect(seen).toEqual([12]);
        const ab = boundaries(log.rows).find(r => r.meta?.from === 'a')!;
        expect([ab.ticks, ab.meta?.waits]).toEqual([1, ['stale']]);
    });
});

describe('runSteps across a relog inside a step', () => {
    /** A session at tick 139 whose fake client ticks every 2 ms; the step bumps it as a relog would. */
    function relogSession() {
        const sdk = new FakeSdk(baseState({ tick: 139 }));
        const s = { sdk, bot: {}, name: 'lab', sessionId: 1, launchId: 1, tickBase: 0 };
        const timer = setInterval(() => sdk.tick(), 2);
        return { s, session: s as unknown as RunnerSession, stop: () => clearInterval(timer) };
    }

    test("a step that relogs in page mid-step logs its own span, not the page's end tick", async () => {
        const { s, session, stop } = relogSession();
        const log = TickLog.memory('t');
        const wine = step('S25c', {
            run: async ({ sdk }) => {
                const t = sdk.getState()!.tick;
                await waitUntil(sdk, st => st.tick >= t + 30, { maxTicks: 200 });
                // An in-page login: a new game session on the page's own count.
                s.sessionId++;
                s.tickBase = sdk.getState()!.tick;
                await waitUntil(sdk, st => st.tick >= t + 73, { maxTicks: 200 });
            },
        });
        await runSteps(session, [wine], { log, c: { trace: [] }, shouldStop: () => false });
        stop();
        const r = stepRows(log.rows).find(x => x.step === 'S25c')!;
        expect(r.sessionId).toBe(2);
        expect(r.startTick).toBeGreaterThanOrEqual(139);
        expect(r.ticks).toBe(r.endTick - r.startTick);
        expect(r.ticks).toBeGreaterThanOrEqual(73);
        expect(r.crossedSession).toBeUndefined();
        expect(report(stepRows(log.rows)).lowerBound).toBe(false);
        // The boundary after it is on the same count too.
        expect(boundaries(log.rows).every(b => b.crossedSession === undefined)).toBe(true);
    });

    test('a relaunch inside a step is flagged, its count the new client\'s', async () => {
        const { s, session, stop } = relogSession();
        const log = TickLog.memory('t');
        const wine = step('S25c', {
            run: async ({ sdk }) => {
                const t = sdk.getState()!.tick;
                await waitUntil(sdk, st => st.tick >= t + 30, { maxTicks: 200 });
                s.sessionId++;
                s.launchId++;
                fake(sdk).push({ tick: 0 });
                await waitUntil(sdk, st => st.tick < t && st.tick >= 20, { maxTicks: 200 });
            },
        });
        await runSteps(session, [wine], { log, c: { trace: [] }, shouldStop: () => false });
        stop();
        const r = stepRows(log.rows).find(x => x.step === 'S25c')!;
        expect(r.crossedSession).toBe(true);
        expect(r.ticks).toBe(r.endTick);
        expect(report(stepRows(log.rows)).lowerBound).toBe(true);
    });
});
