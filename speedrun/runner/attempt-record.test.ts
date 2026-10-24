import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { existsSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { baseState, FakeSdk } from '../lib/fake-sdk';
import { TickLog } from '../lib/ticks';
import { sleep } from '../lib/wait';
import { AttemptRecord, ATTEMPT_RECORD_FILE } from './attempt-record';
import { Observation, resolveResume, ResumeError, runResumable, type Link } from './resume';
import { runSteps, StepError, type Observed, type RunnerSession, type Step } from './step';

const prevTick = process.env.SPEEDRUN_TICK_MS;
beforeAll(() => { process.env.SPEEDRUN_TICK_MS = '5'; });
afterAll(() => { if (prevTick === undefined) delete process.env.SPEEDRUN_TICK_MS; else process.env.SPEEDRUN_TICK_MS = prevTick; });

const dirOf = () => mkdtempSync(join(tmpdir(), 'attempt-record-'));

type C = Record<string, never>;
const step = (name: string, over: Partial<Step<C>> = {}): Step<C> => ({
    name, preconditions: () => true, run: async () => {}, postconditions: () => true, logoutSafe: true, ...over,
});

/** A fake client ticking every 2 ms. */
function ticking(start = baseState({ tick: 0 })) {
    const sdk = new FakeSdk(start);
    const timer = setInterval(() => sdk.tick(), 2);
    return { session: { sdk, bot: {}, name: 'lab', sessionId: 1 } as unknown as RunnerSession, sdk, stop: () => clearInterval(timer) };
}

describe('AttemptRecord: one attempt-scoped file for hand-off rows and step names', () => {
    test('a missing file (its directory too) is nothing recorded, and reading writes nothing', () => {
        const r = new AttemptRecord(join(dirOf(), 'run'), 'a1');
        expect(r.steps.has('S16:F-guardian')).toBe(false);
        expect(r.handOffs.has('H13')).toBe(false);
        expect(r.entries()).toEqual([]);
        expect(existsSync(r.file)).toBe(false);
    });

    test('an empty file (no bytes, or only whitespace) is nothing recorded; a mark writes over it', () => {
        for (const text of ['', '\n  \n']) {
            const d = dirOf();
            writeFileSync(join(d, ATTEMPT_RECORD_FILE), text);
            const r = new AttemptRecord(d, 'a1');
            expect(r.steps.has('S16:F-guardian')).toBe(false);
            expect(r.entries()).toEqual([]);
            r.steps.mark('S16:F-guardian', 7);
            expect(new AttemptRecord(d, 'a1').steps.has('S16:F-guardian')).toBe(true);
        }
    });

    test('a file that does not parse refuses, on read and on mark, naming the file', () => {
        const d = dirOf();
        writeFileSync(join(d, ATTEMPT_RECORD_FILE), '{"v":1,"entries":[');
        const r = new AttemptRecord(d, 'a1');
        expect(() => r.steps.has('S16:F-guardian')).toThrow(/attempt-record\.json does not parse/);
        expect(() => r.handOffs.has('H13')).toThrow(/attempt-record\.json does not parse/);
        expect(() => r.steps.mark('S16:F-guardian', 1)).toThrow(/attempt-record\.json does not parse/);
    });

    test('marked once per attempt; a second instance (another process) reads the marks; a fresh attempt sees none', () => {
        const d = dirOf();
        const r = new AttemptRecord(d, 'a1');
        r.steps.mark('S16:F-guardian', 100);
        r.steps.mark('S16:F-guardian', 200);
        const second = new AttemptRecord(d, 'a1', 4242);
        expect(second.steps.has('S16:F-guardian')).toBe(true);
        expect(second.entries().map(e => [e.attempt, e.kind, e.key, e.tick])).toEqual([['a1', 'step', 'S16:F-guardian', 100]]);
        expect(new AttemptRecord(d, 'a2').steps.has('S16:F-guardian')).toBe(false);
    });

    test('hand-off rows and step names are kept apart: neither answers for the other', () => {
        const r = new AttemptRecord(dirOf(), 'a1');
        r.handOffs.mark('H13', 1);
        r.steps.mark('S15', 2);
        expect([r.handOffs.has('H13'), r.steps.has('H13')]).toEqual([true, false]);
        expect([r.steps.has('S15'), r.handOffs.has('S15')]).toEqual([true, false]);
    });

    test("a cached read still sees another process's marks, and a mark keeps them", () => {
        const d = dirOf();
        const a = new AttemptRecord(d, 'a1');
        const b = new AttemptRecord(d, 'a1', 9999);
        expect(a.steps.has('x')).toBe(false);
        b.steps.mark('x', 1);
        expect(a.steps.has('x')).toBe(true);
        expect(a.steps.has('y')).toBe(false);
        b.handOffs.mark('y', 2);
        expect(a.handOffs.has('y')).toBe(true);
        a.steps.mark('z', 3);
        expect(b.entries().map(e => e.key)).toEqual(['x', 'y', 'z']);
    });

    test('a 300-milestone walk parses the file once', () => {
        const d = dirOf();
        const w = new AttemptRecord(d, 'a1');
        for (let i = 0; i < 300; i++) w.steps.mark(`step-${i}`, i);
        const r = new AttemptRecord(d, 'a1');
        const parse = spyOn(JSON, 'parse');
        try {
            for (let i = 0; i < 300; i++) expect(r.steps.has(`step-${i}`)).toBe(true);
            expect(parse).toHaveBeenCalledTimes(1);
        } finally {
            parse.mockRestore();
        }
    });
});

describe('runSteps marks a step in the record once its postconditions pass', () => {
    test('a passing step is marked; one whose postconditions fail is not', async () => {
        const r = new AttemptRecord(dirOf(), 'a1');
        const { session, stop } = ticking();
        const p = runSteps(session, [step('S16:E-statue'), step('S16:F-guardian', { postconditions: () => 'cape not held' })], { log: TickLog.memory('t'), c: {}, shouldStop: () => false, tickMonitor: false, record: r.steps });
        await expect(p).rejects.toThrow(StepError);
        stop();
        expect(r.steps.has('S16:E-statue')).toBe(true);
        expect(r.steps.has('S16:F-guardian')).toBe(false);
        expect(r.entries()[0]!.tick).toBeGreaterThanOrEqual(0);
    });

    test('a step entered through resume is marked the same way', async () => {
        const r = new AttemptRecord(dirOf(), 'a1');
        const { session, stop } = ticking();
        let resumed = 0;
        await runSteps(session, [step('S16:F-guardian', { resume: async () => void resumed++ }), step('T16-18')], { log: TickLog.memory('t'), c: {}, shouldStop: () => false, tickMonitor: false, startMode: 'resume', record: r.steps });
        stop();
        expect(resumed).toBe(1);
        expect([r.steps.has('S16:F-guardian'), r.steps.has('T16-18')]).toEqual([true, true]);
    });
});

describe('the resume walk reads the record through Observed.record', () => {
    /** The guardian's live check: nothing in the game outlasts S16's exit drops. */
    const guardianDone = (o: Observed) => false || !!o.record?.has('S16:F-guardian');
    const walk = (): Step<C>[] => [
        step('S16:F-guardian', { done: guardianDone }),
        step('T16-18 teleport', { preconditions: () => true }),
        step('thieving:knights', { done: () => false, preconditions: () => true }),
    ];

    test('a milestone whose live check is false but the record has: done, and the walk goes past it', async () => {
        const r = new AttemptRecord(dirOf(), 'a1');
        r.steps.mark('S16:F-guardian', 1);
        const p = await resolveResume(walk(), new Observation(baseState(), {}, undefined, r.steps), {});
        expect([p.step, p.mode, p.lastDone]).toEqual(['thieving:knights', 'run', 0]);
        // Without the mark (a fresh attempt, or no record at all) the walk re-enters the Mage Arena.
        expect((await resolveResume(walk(), new Observation(baseState(), {}, undefined, new AttemptRecord(r.dir, 'a2').steps), {})).step).toBe('S16:F-guardian');
        expect((await resolveResume(walk(), new Observation(baseState()), {})).step).toBe('S16:F-guardian');
    });

    // S21's split as resume.ts sees it: S00's done reads the player, a quest's its stage, both empty out of game.
    const split = (): Step<C>[] => [
        step('S00 tutorial', { done: o => !!o.state.player, preconditions: s => (s.inGame ? true : 'not in game') }),
        step('S05:C-doric-hand-in', { done: o => o.state.inGame && false, preconditions: s => (s.inGame ? true : 'not in game') }),
        step('S21 relog:logout', { done: () => true, preconditions: s => (s.inGame ? true : 'not in game before S21 logout') }),
        step('S21 relog:login', { done: () => false, offline: true }),
    ];

    test('out of the world, a recorded milestone counts as done: the walk reaches the login half, not S00', async () => {
        const r = new AttemptRecord(dirOf(), 'a1');
        for (const n of ['S00 tutorial', 'S05:C-doric-hand-in', 'S21 relog:logout']) r.steps.mark(n, 1);
        const out = baseState({ inGame: false, player: null });
        const p = await resolveResume(split(), new Observation(out, {}, undefined, r.steps), {});
        expect([p.step, p.mode]).toEqual(['S21 relog:login', 'run']);
        // Without the record the walk stops at S00, which cannot start out of game.
        const err = await resolveResume(split(), new Observation(out), {}).catch(e => e);
        expect(err).toBeInstanceOf(ResumeError);
        expect((err as ResumeError).firstUndone).toBe(0);
    });

    test("in the world the record does not override a milestone's own done", async () => {
        const r = new AttemptRecord(dirOf(), 'a1');
        for (const n of ['S00 tutorial', 'S05:C-doric-hand-in', 'S21 relog:logout']) r.steps.mark(n, 1);
        const p = await resolveResume(split(), new Observation(baseState({ inGame: true, player: null }), {}, undefined, r.steps), {});
        expect([p.step, p.firstUndone]).toEqual(['S00 tutorial', 0]);
    });
});

describe('runResumable carries the record into the walk and the steps', () => {
    const steady: Link = {
        isLost: () => false,
        lost: async signal => {
            while (!signal.aborted) await sleep(2);
            return 'stopped watching';
        },
        restored: async () => {},
    };

    test('a milestone recorded by an earlier process is walked past; the step resumed after it is marked', async () => {
        const d = dirOf();
        new AttemptRecord(d, 'a1', 1).steps.mark('S16:F-guardian', 1);
        const r = new AttemptRecord(d, 'a1');
        const ran: string[] = [];
        const steps: Step<C>[] = [
            step('S16:F-guardian', { done: o => !!o.record?.has('S16:F-guardian'), run: async () => void ran.push('guardian') }),
            step('thieving:knights', { done: () => false, inProgress: () => true, resume: async () => void ran.push('knights:resume') }),
        ];
        const { session, stop } = ticking(baseState({ tick: 0, player: { name: 'lab', x: 0, z: 0, worldX: 0, worldZ: 0, level: 0 } as never }));
        const res = await runResumable(session, steps, { log: TickLog.memory('t'), c: {}, link: steady, shouldStop: () => false, record: r.steps, sceneMaxTicks: 2, playerMaxTicks: 2, tickMonitor: false });
        stop();
        expect(res.points.map(p => [p.step, p.mode])).toEqual([['thieving:knights', 'resume']]);
        expect(ran).toEqual(['knights:resume']);
        expect(r.steps.has('thieving:knights')).toBe(true);
    });
});
