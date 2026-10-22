import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { baseState, FakeSdk } from '../../lib/fake-sdk';
import { LOGOUT_BUTTON } from '../../lib/session';
import { TickLog, type TickRow } from '../../lib/ticks';
import type { QuestOptions } from '../../quests/segments';
import { BOUNDARY_STEP, type RunnerSession, type Step } from '../../runner/step';
import { loopbackPort } from '../loopback-gateway';
import {
    applySubstitutes, checkDemoTarget, DRIVER_SUFFIX, fixedOptions, formatDemoTable, LEG_PREFIX, probesFor, refuseChat, rowSource, runDemoQuest, withLegs, type QuestModule,
} from './demo-quest';

const prevTick = process.env.SPEEDRUN_TICK_MS;
beforeAll(() => { process.env.SPEEDRUN_TICK_MS = '5'; });
afterAll(() => { if (prevTick === undefined) delete process.env.SPEEDRUN_TICK_MS; else process.env.SPEEDRUN_TICK_MS = prevTick; });

/** A session whose fake client ticks every 2 ms until stopped. */
function ticking(): { session: RunnerSession; sdk: FakeSdk; stop: () => void } {
    const sdk = new FakeSdk(baseState({ tick: 0 }));
    const timer = setInterval(() => sdk.tick(), 2);
    return { session: { sdk, bot: {}, name: 'cairn_t', sessionId: 0 } as unknown as RunnerSession, sdk, stop: () => clearInterval(timer) };
}

type Trace = string[];

/** A three-segment module (S99 A-C) whose runs append to `trace`; `done` marks per letter. */
function fakeModule(trace: Trace, done: Partial<Record<'A' | 'B' | 'C', boolean>> = {}, seen: { opts?: QuestOptions } = {}): QuestModule {
    const seg = (letter: 'A' | 'B' | 'C', label: string, over: Partial<Step<any>> = {}): Step<any> => ({
        name: `S99:${letter}-${label}`,
        preconditions: () => true,
        run: async () => { trace.push(letter); },
        postconditions: () => true,
        logoutSafe: true,
        done: () => done[letter] ?? false,
        ...over,
    });
    return {
        stepId: 'S99',
        steps(opts) {
            seen.opts = opts;
            return [seg('A', 'kit'), seg('B', 'talk', { probes: ['journal:magearena'] }), seg('C', 'fight', { postconditions: () => 'module post' })];
        },
    };
}

const stepNames = (rows: readonly TickRow[]) => rows.filter(r => !r.kind && r.step !== BOUNDARY_STEP).map(r => r.step);

describe('checkDemoTarget', () => {
    test('--lab only on the local engine, the demo path only off it', () => {
        expect(() => checkDemoTarget({ BOT_USERNAME: 'x', SERVER: 'localhost:9300' }, { lab: true, fleetAccount: false })).not.toThrow();
        expect(() => checkDemoTarget({ BOT_USERNAME: 'x', SERVER: 'demo.example' }, { lab: true, fleetAccount: false })).toThrow(/local lab/);
        expect(() => checkDemoTarget({ BOT_USERNAME: 'x', SERVER: '127.0.0.1:9300' }, { lab: false, fleetAccount: false })).toThrow(/demo world/);
    });

    test('a cairn_* account needs --fleet-account on the demo', () => {
        expect(() => checkDemoTarget({ BOT_USERNAME: 'cairn_h55', SERVER: 'demo.example' }, { lab: false, fleetAccount: false })).toThrow(/--fleet-account/);
        expect(() => checkDemoTarget({ BOT_USERNAME: 'cairn_h55', SERVER: 'demo.example' }, { lab: false, fleetAccount: true })).not.toThrow();
        expect(() => checkDemoTarget({ BOT_USERNAME: 'quietfern', SERVER: 'demo.example' }, { lab: false, fleetAccount: false })).not.toThrow();
    });
});

describe('loopbackPort', () => {
    test('only ws://127.0.0.1:<port>', () => {
        expect(loopbackPort('ws://127.0.0.1:7466')).toBe(7466);
        expect(loopbackPort('ws://127.0.0.1:7466/')).toBe(7466);
        expect(() => loopbackPort('wss://rs-sdk-demo.example/gateway')).toThrow(/tenet 12/);
        expect(() => loopbackPort(undefined)).toThrow(/GATEWAY_URL/);
    });
});

describe('fixedOptions', () => {
    test('forces fixed and passes every other key through', () => {
        expect(fixedOptions({ spell: 'fire_blast', keepSharks: 1 } as never)).toEqual({ spell: 'fire_blast', keepSharks: 1, dialogue: 'fixed' } as never);
        expect(fixedOptions({ dialogue: 'fixed' })).toEqual({ dialogue: 'fixed' });
    });

    test('refuses burst rather than changing it silently', () => {
        expect(() => fixedOptions({ dialogue: 'burst' })).toThrow(/fixed dialogue only/);
    });
});

describe('refuseChat', () => {
    test('refuses staff commands and plain chat until undone', async () => {
        const sdk = new FakeSdk();
        const undo = refuseChat(sdk);
        await expect(sdk.sendSay('::give shark 5')).rejects.toThrow(/no staff command/);
        await expect(sdk.sendSay('hello')).rejects.toThrow(/no chat/);
        expect(sdk.sent).toEqual([]);
        undo();
        await sdk.sendSay('ok');
        expect(sdk.sent.map(s => s.method)).toEqual(['sendSay']);
    });
});

describe('applySubstitutes', () => {
    const steps = () => fakeModule([], { B: true }).steps();

    test('by letter or name: run replaced, row renamed, done, probes and logoutSafe kept', async () => {
        const ran: string[] = [];
        const out = applySubstitutes(steps(), 'S99', { b: { run: async () => { ran.push('sub'); } }, 'S99:C-fight': { run: async () => {}, postconditions: () => true } });
        expect(out.map(s => s.name)).toEqual(['S99:A-kit', `S99:B-talk${DRIVER_SUFFIX}`, `S99:C-fight${DRIVER_SUFFIX}`]);
        const b = out[1]!;
        expect(b.done?.({} as never, {})).toBe(true);
        expect(b.probes).toEqual(['journal:magearena']);
        expect(b.logoutSafe).toBe(true);
        await b.run({} as never);
        expect(ran).toEqual(['sub']);
        expect(out[2]!.postconditions({} as never, {})).toBe(true);
    });

    test('preconditions default to none; postconditions default to the module step', () => {
        const base = steps().map(s => (s.name === 'S99:C-fight' ? { ...s, preconditions: () => 'module pre', resume: async () => {} } : s));
        const [, , c] = applySubstitutes(base, 'S99', { C: { run: async () => {} } });
        expect(c!.preconditions({} as never, {})).toBe(true);
        expect(c!.postconditions({} as never, {})).toBe('module post');
        expect(c!.resume).toBeUndefined();
    });

    test('an unknown key is an error', () => {
        expect(() => applySubstitutes(steps(), 'S99', { Z: { run: async () => {} } })).toThrow(/substitute "Z": no such segment/);
    });
});

describe('withLegs', () => {
    test('a leg sits just before its segment as leg:<name>, logout-safe and never a milestone', () => {
        const out = withLegs(fakeModule([]).steps(), 'S99', { B: async () => {} });
        expect(out.map(s => s.name)).toEqual(['S99:A-kit', `${LEG_PREFIX}S99:B-talk`, 'S99:B-talk', 'S99:C-fight']);
        expect(out[1]!.logoutSafe).toBe(true);
        expect(out[1]!.done).toBeUndefined();
    });

    test('legs before the start are dropped with their segments', () => {
        const out = withLegs(fakeModule([]).steps(), 'S99', { A: async () => {}, C: async () => {} }, 1);
        expect(out.map(s => s.name)).toEqual(['S99:B-talk', `${LEG_PREFIX}S99:C-fight`, 'S99:C-fight']);
    });

    test('an unknown key is an error', () => {
        expect(() => withLegs(fakeModule([]).steps(), 'S99', { Q: async () => {} })).toThrow(/leg "Q"/);
    });
});

describe('probesFor', () => {
    test('journal probes come from the steps; other names must be given', () => {
        const steps = fakeModule([]).steps();
        expect(Object.keys(probesFor(steps))).toEqual(['journal:magearena']);
        const odd = [{ ...steps[0]!, probes: ['bank'] }];
        expect(() => probesFor(odd)).toThrow(/probe "bank"/);
        expect(Object.keys(probesFor(odd, { bank: async () => null }))).toEqual(['bank']);
    });
});

describe('runDemoQuest', () => {
    test('the resume walk starts after the last done milestone, in fixed dialogue, without logging out', async () => {
        const { session, sdk, stop } = ticking();
        const trace: Trace = [];
        const seen: { opts?: QuestOptions } = {};
        // A and B done: the walk starts at C. B's journal probe runs while the walk passes it.
        const mod = fakeModule(trace, { A: true, B: true }, seen);
        const r = await runDemoQuest(session, { module: mod, opts: { spell: 'fire_blast' } as never, probes: { 'journal:magearena': async () => null }, substitute: { C: { run: async () => { trace.push('C*'); }, postconditions: () => true } } });
        stop();
        expect(r.error).toBeUndefined();
        expect(r.finished).toBe(true);
        expect(r.start).toMatchObject({ step: `S99:C-fight${DRIVER_SUFFIX}`, mode: 'run' });
        expect(trace).toEqual(['C*']);
        expect(seen.opts).toEqual({ spell: 'fire_blast', dialogue: 'fixed' } as never);
        expect(stepNames(r.rows)).toEqual([`S99:C-fight${DRIVER_SUFFIX}`]);
        expect(sdk.sent.some(a => a.method === 'sendClickComponent' && a.args[0] === LOGOUT_BUTTON)).toBe(false);
    });

    test('--from wins over the walk and runs that segment\'s leg', async () => {
        const { session, stop } = ticking();
        const trace: Trace = [];
        const r = await runDemoQuest(session, { module: fakeModule(trace, { A: true, B: true, C: true }), from: 'A', until: 'B', legs: { A: async () => { trace.push('leg'); } } });
        stop();
        expect(r.error).toBeUndefined();
        expect(r.start).toMatchObject({ step: 'S99:A-kit', mode: 'run', reason: 'operator --from' });
        expect(trace).toEqual(['leg', 'A', 'B']);
        expect(stepNames(r.rows)).toEqual([`${LEG_PREFIX}S99:A-kit`, 'S99:A-kit', 'S99:B-talk']);
    });

    test('a window already done runs nothing', async () => {
        const { session, stop } = ticking();
        const trace: Trace = [];
        const r = await runDemoQuest(session, { module: fakeModule(trace, { A: true, B: true, C: true }), probes: { 'journal:magearena': async () => null } });
        stop();
        expect(r).toMatchObject({ start: null, finished: true });
        expect(trace).toEqual([]);
    });

    test('a failing step comes back as an error with its rows, not a throw', async () => {
        const { session, stop } = ticking();
        const trace: Trace = [];
        const r = await runDemoQuest(session, { module: fakeModule(trace), from: 'B', probes: { 'journal:magearena': async () => null } });
        stop();
        expect(trace).toEqual(['B', 'C']);
        expect(r.finished).toBe(false);
        expect(r.error).toMatch(/S99:C-fight" postcondition failed: module post/);
        expect(r.rows.some(row => row.step === 'S99:C-fight:postcondition' && !row.ok)).toBe(true);
    });

    test('chat is refused during the run and allowed again after', async () => {
        const { session, sdk, stop } = ticking();
        const said: string[] = [];
        const mod: QuestModule = {
            stepId: 'S98',
            steps: () => [{
                name: 'S98:A-talk', logoutSafe: true, preconditions: () => true, postconditions: () => true,
                run: async ctx => { await (ctx.sdk as unknown as FakeSdk).sendSay('::setvar x 1').catch(e => said.push(String(e))); },
            }],
        };
        const r = await runDemoQuest(session, { module: mod, from: 'A' });
        stop();
        expect(r.error).toBeUndefined();
        expect(said[0]).toMatch(/no staff command/);
        expect(sdk.sent.filter(a => a.method === 'sendSay')).toEqual([]);
        await sdk.sendSay('after');
        expect(sdk.sent.filter(a => a.method === 'sendSay').length).toBe(1);
    });
});

describe('formatDemoTable', () => {
    test('labels module, driver and leg rows and sums the module steps apart', () => {
        const row = (step: string, ticks: number, ok = true): TickRow => ({ v: 1, runId: 'r', account: 'a', sessionId: 0, step, startTick: 0, endTick: ticks, ticks, wallMs: 0, ok, tickMs: 600, at: '' });
        const rows = [row(`${LEG_PREFIX}S99:A-kit`, 150), row(BOUNDARY_STEP, 2), row('S99:A-kit', 3), row(`S99:B-talk${DRIVER_SUFFIX}`, 40), row('S99:C-fight', 300)];
        expect(rows.map(r => rowSource(r.step))).toEqual(['leg', 'boundary', 'module', 'driver', 'module']);
        const t = formatDemoTable(rows);
        expect(t).toContain(`| S99:B-talk${DRIVER_SUFFIX} | driver | 40 | yes |`);
        expect(t).toContain('| **Module steps** | module | 303 | |');
        expect(t).toContain('| **Total** | all | 495 | |');
    });
});
