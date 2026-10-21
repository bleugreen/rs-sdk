import { describe, expect, test } from 'bun:test';

import '../../lite/test-support/browser-globals.js';

import { MARK_TAIL, parseProgramCommand, ProgramRuntime } from './runtime.js';
import { declared, Harness, makeState } from './testkit.js';
import type { TickProgram } from './types.js';

const burst = (n: number): TickProgram => ({
    onTick(ctx) {
        for (let i = 0; i < n; i++) ctx.send({ type: 'dropItem', slot: i });
        ctx.progress();
    }
});

describe('ProgramRuntime', () => {
    test('runs the program once per decoded tick and publishes counters', () => {
        const h = new Harness('count', declared(() => ({ onTick: ctx => { ctx.count('ticks'); ctx.progress(); if (ctx.tick === 12) ctx.done({ ok: true }); } }), ['a']));
        const s = h.start('count', { a: 1 }, makeState({ tick: 9 }));
        expect(s.phase).toBe('running');
        expect(s.startedTick).toBe(9);
        for (let t = 10; t <= 13; t++) h.step(makeState({ tick: t }));
        expect(h.status.counters.ticks).toBe(3);
        expect(h.status.phase).toBe('done');
        expect(h.status.result).toEqual({ ok: true });
        expect(h.status.endedTick).toBe(12);
        expect(h.ended?.runId).toBe(s.runId);
    });

    test('refuses the sixth packet in a tick and counts it deferred', () => {
        const h = new Harness('burst', () => burst(7));
        h.start('burst');
        expect(h.step(makeState({ tick: 1 }))).toHaveLength(5);
        expect(h.status.packets).toBe(5);
        expect(h.status.deferred).toBe(2);
        // the budget is per tick
        expect(h.step(makeState({ tick: 2 }))).toHaveLength(5);
    });

    test('a rejected action is not counted against the budget', () => {
        const h = new Harness('burst', () => burst(1));
        h.reject.add('dropItem');
        h.start('burst');
        h.step(makeState({ tick: 1 }));
        expect(h.status.packets).toBe(0);
        expect(h.status.counters.rejected).toBe(1);
    });

    test('starting replaces the running program in one call', () => {
        const stopped: string[] = [];
        const h = new Harness('a', () => ({ onTick: c => c.progress(), onStop: why => stopped.push(why) }));
        h.runtime.register('b', declared(() => ({ onTick: c => c.progress() })));
        const a = h.start('a');
        const b = h.runtime.start('b');
        expect(stopped).toEqual(['replaced']);
        expect(b.runId).toBe(a.runId + 1);
        expect(a.phase).toBe('replaced');
        expect(h.runtime.status()?.name).toBe('b');
    });

    test('stop keeps the last status readable with its snapshot', () => {
        const h = new Harness('a', () => ({ onTick: c => c.progress(), snapshot: () => ({ partial: 1 }) }));
        h.start('a');
        h.step(makeState({ tick: 1 }));
        const s = h.runtime.stop();
        expect(s?.phase).toBe('stopped');
        expect(s?.result).toEqual({ partial: 1 });
        expect(h.runtime.active).toBe(false);
        expect(h.runtime.status()?.phase).toBe('stopped');
    });

    test('a mark publishes a running count and its last MARK_TAIL ticks while the run goes', () => {
        const h = new Harness('mark', () => ({ onTick: c => { if (c.tick % 2 === 0) c.mark('even'); c.progress(); } }));
        h.start('mark');
        h.step(makeState({ tick: 1 }));
        expect(h.status.marks).toEqual({});
        h.step(makeState({ tick: 2 }));
        expect(h.status.marks.even).toEqual({ count: 1, ticks: [2] });
        for (let t = 3; t <= 200; t++) h.step(makeState({ tick: t }));
        expect(h.status.phase).toBe('running');
        expect(h.status.marks.even!.count).toBe(100);
        expect(h.status.marks.even!.ticks).toHaveLength(MARK_TAIL);
        expect(h.status.marks.even!.ticks.at(0)).toBe(200 - 2 * (MARK_TAIL - 1));
        expect(h.status.marks.even!.ticks.at(-1)).toBe(200);
    });

    test('an ended run carries its last log lines', () => {
        const h = new Harness('talk', () => ({ onTick: c => { c.log('hello'); c.progress(); } }));
        h.start('talk');
        for (let t = 1; t <= 50; t++) h.step(makeState({ tick: t }));
        h.runtime.stop();
        expect(h.status.logTail).toHaveLength(40);
        expect(h.status.logTail!.at(-2)).toBe('T50 hello');
        expect(h.status.logTail!.at(-1)).toBe('stopped');
    });

    test('an exception faults the program instead of escaping into the game loop', () => {
        const h = new Harness('boom', () => ({ onTick: () => { throw new Error('bad'); } }));
        h.start('boom');
        expect(() => h.step(makeState({ tick: 1 }))).not.toThrow();
        expect(h.status.phase).toBe('fault');
        expect(h.status.fault).toContain('bad');
    });

    test('a program with no progress for stallTicks faults', () => {
        const h = new Harness('idle', () => ({ onTick: () => {} }));
        h.start('idle', { stallTicks: 3 }, makeState({ tick: 0 }));
        for (let t = 1; t <= 3; t++) h.step(makeState({ tick: t }));
        expect(h.status.phase).toBe('running');
        h.step(makeState({ tick: 4 }));
        expect(h.status.phase).toBe('fault');
        expect(h.status.fault).toContain('stalled');
    });

    test('counts skipped ticks when the page decodes several in one pass', () => {
        const h = new Harness('a', () => ({ onTick: c => c.progress() }));
        h.start('a');
        h.step(makeState({ tick: 1 }));
        h.step(makeState({ tick: 4 }), 3);
        expect(h.status.skippedTicks).toBe(2);
    });

    test('publishes frame cadence from raw arrivals and publication cadence from passes', () => {
        let now = 0;
        const rt = new ProgramRuntime({ dispatch: () => ({ success: true, message: '' }), now: () => now });
        rt.register('a', declared(() => ({ onTick: c => c.progress() })));
        rt.start('a');
        rt.onTick(makeState({ tick: 1 }), 1, [0]);
        now = 300;
        rt.onTick(makeState({ tick: 2 }), 1, [300]);
        // an overrun: the next frame is late and the one after follows at once; the page
        // decodes both in one pass
        now = 900;
        rt.onTick(makeState({ tick: 4 }), 2, [820, 880]);
        const s = rt.status()!;
        expect(s.frames).toMatchObject({ n: 3, catchUps: 1, under150: 1, over350: 1 });
        expect(s.publish).toMatchObject({ n: 2, catchUps: 0, max: 600 });
        expect(s.skippedTicks).toBe(1);
        // arrival of the newest decoded frame to the decision: 0, 0, then 900 - 880
        expect(s.react).toMatchObject({ n: 3, max: 20 });
    });

    test('a factory that throws reports bad parameters as a fault', () => {
        const rt = new ProgramRuntime({ dispatch: () => ({ success: true, message: '' }) });
        rt.register('x', declared(() => { throw new Error('trials must be a number'); }));
        const r = rt.command({ op: 'start', name: 'x', params: {} });
        expect(r.success).toBe(false);
        expect(r.message).toContain('trials must be a number');
        expect(rt.active).toBe(false);
    });

    test('a start with declared keys runs; one undeclared key faults naming the key and the program', () => {
        const made: unknown[] = [];
        const factory = declared(p => { made.push(p); return { onTick: c => c.progress() }; }, ['trials', 'maxWait']);
        const rt = new ProgramRuntime({ dispatch: () => ({ success: true, message: '' }) });
        rt.register('p', factory);
        expect(rt.start('p', { trials: 3, maxWait: 2, stallTicks: 9 }).phase).toBe('running');
        expect(made).toEqual([{ trials: 3, maxWait: 2, stallTicks: 9 }]);
        rt.stop();
        const r = rt.command({ op: 'start', name: 'p', params: { trials: 3, untilXp: 1 } });
        expect(r.success).toBe(false);
        expect(r.message).toContain('untilXp');
        expect(r.message).toContain('p does not declare');
        expect(rt.status()?.phase).toBe('fault');
        expect(rt.status()?.fault).toContain('untilXp');
        expect(rt.active).toBe(false);
        // the factory never saw the faulted start
        expect(made).toHaveLength(1);
    });

    test('an undeclared key on a start replaces the running program and faults, like any bad parameter', () => {
        const h = new Harness('a', () => ({ onTick: c => c.progress() }));
        const first = h.start('a');
        const second = h.runtime.start('a', { dropEach: true });
        expect(first.phase).toBe('replaced');
        expect(second.phase).toBe('fault');
        expect(second.fault).toBe('bad parameters: a does not declare dropEach (accepts: stallTicks)');
    });

    test('registering a factory without a declaration is refused', () => {
        const rt = new ProgramRuntime({ dispatch: () => ({ success: true, message: '' }) });
        const bare = (() => ({ onTick: () => {} })) as unknown as Parameters<ProgramRuntime['register']>[1];
        expect(() => rt.register('bare', bare)).toThrow(/declares no parameter keys/);
    });

    test('unknown program names are refused', () => {
        const rt = new ProgramRuntime({ dispatch: () => ({ success: true, message: '' }) });
        expect(rt.command({ op: 'start', name: 'nope' }).success).toBe(false);
    });

    test('does not run while logged out', () => {
        const h = new Harness('a', () => burst(1));
        h.start('a');
        expect(h.step(makeState({ tick: 1, inGame: false }))).toHaveLength(0);
    });
});

describe('parseProgramCommand', () => {
    test('validates the wire payload', () => {
        expect(parseProgramCommand({ op: 'start', name: 'probe', params: { trials: 60 } })).toEqual({ op: 'start', name: 'probe', params: { trials: 60 } });
        expect(parseProgramCommand({ op: 'stop' })).toEqual({ op: 'stop' });
        expect(typeof parseProgramCommand({ op: 'start' })).toBe('string');
        expect(typeof parseProgramCommand({ op: 'start', name: 'x', params: [1] })).toBe('string');
        expect(typeof parseProgramCommand({ op: 'jump' })).toBe('string');
        expect(typeof parseProgramCommand(null)).toBe('string');
    });
});
