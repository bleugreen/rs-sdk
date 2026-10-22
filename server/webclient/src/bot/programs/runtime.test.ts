import { describe, expect, test } from 'bun:test';

import '../../lite/test-support/browser-globals.js';

import { MARK_TAIL, parseProgramCommand, ProgramRuntime, userEventsOf } from './runtime.js';
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
        expect(second.fault).toBe('bad parameters: a does not declare dropEach (accepts: stallTicks, hold)');
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

    test('frames carry each decoded tick with its arrival on the Date.now() scale', () => {
        let now = 1000;
        const seen: Array<readonly { tick: number; ms: number }[]> = [];
        const rt = new ProgramRuntime({ dispatch: () => ({ success: true, message: '' }), now: () => now, wallNow: () => 1.8e12 + now });
        rt.register('a', declared(() => ({ onTick: c => { seen.push(c.frames); c.progress(); } })));
        rt.start('a');
        rt.onTick(makeState({ tick: 7 }), 1, [995]);
        now = 1700;
        rt.onTick(makeState({ tick: 9 }), 2, [1290, 1600]);
        rt.onTick(makeState({ tick: 10 }), 1);
        expect(seen).toEqual([[{ tick: 7, ms: 1.8e12 + 995 }], [{ tick: 8, ms: 1.8e12 + 1290 }, { tick: 9, ms: 1.8e12 + 1600 }], []]);
    });

    test('shared data is published by reference, including what onStop adds', () => {
        const data: { n: number; stop?: boolean } = { n: 0 };
        const h = new Harness('a', () => ({ onTick: c => { data.n++; c.share(data); c.progress(); }, onStop: () => { data.stop = true; } }));
        h.start('a');
        h.step(makeState({ tick: 1 }));
        h.step(makeState({ tick: 2 }));
        expect(h.status.shared).toEqual({ n: 2 });
        h.runtime.stop();
        expect(h.status.shared).toEqual({ n: 2, stop: true });
    });

    test('input reaches the running program; a refusal or no program fails without ending the run', () => {
        const got: unknown[] = [];
        const h = new Harness('a', () => ({ onTick: c => c.progress(), onInput: d => { if (d === 'bad') throw new Error('bad input'); got.push(d); return { ok: true }; } }));
        h.runtime.register('mute', declared(() => ({ onTick: c => c.progress() })));
        expect(h.runtime.command({ op: 'input', data: 1 }).success).toBe(false);
        h.start('a');
        expect(h.runtime.command({ op: 'input', data: { q: [1] } })).toMatchObject({ success: true, data: { ok: true } });
        const bad = h.runtime.command({ op: 'input', data: 'bad' });
        expect(bad).toMatchObject({ success: false, message: 'bad input' });
        expect(h.status.phase).toBe('running');
        expect(got).toEqual([{ q: [1] }]);
        h.runtime.start('mute');
        expect(h.runtime.command({ op: 'input', data: 1 }).message).toContain('takes no input');
    });

    test('does not run while logged out', () => {
        const h = new Harness('a', () => burst(1));
        h.start('a');
        expect(h.step(makeState({ tick: 1, inGame: false }))).toHaveLength(0);
    });
});

describe('hold (the forced-slip test hook)', () => {
    // every third tick: a marker packet, then a starter bundle of two
    const starters = (): TickProgram => ({
        onTick(ctx) {
            if (ctx.tick % 3 === 0) {
                ctx.send({ type: 'dropItem', slot: 9 });
                ctx.starter();
                ctx.send({ type: 'useItemOnItem', sourceSlot: 0, targetSlot: 1 });
                ctx.send({ type: 'clickComponent', componentId: 8889 });
            }
            ctx.progress();
        }
    });
    const runFor = (params: Record<string, unknown>, draws?: number[]) => {
        const q = draws ? [...draws] : null;
        const h = new Harness('s', starters, {
            random: () => {
                if (!q) throw new Error('drew with hold unset');
                return q.shift() ?? 1;
            }
        });
        h.start('s', params, makeState({ tick: 0 }));
        for (let t = 1; t <= 7; t++) h.step(makeState({ tick: t }));
        return h;
    };

    test('unset or 0: nothing is held and nothing is drawn', () => {
        for (const params of [{}, { hold: 0 }]) {
            const h = runFor(params);
            expect(h.timeline()).toEqual(['T3 dropItem,useItemOnItem,clickComponent', 'T6 dropItem,useItemOnItem,clickComponent']);
            expect(h.status.counters.held).toBeUndefined();
        }
    });

    test('a held bundle goes out first on the next tick; sends before the marker are not held', () => {
        const h = runFor({ hold: 1 }, [0, 0]);
        expect(h.timeline()).toEqual(['T3 dropItem', 'T4 useItemOnItem,clickComponent', 'T6 dropItem', 'T7 useItemOnItem,clickComponent']);
        expect(h.status.counters.held).toBe(2);
        expect(h.status.packets).toBe(6);
    });

    test('holds the given share: a draw under hold holds that bundle', () => {
        const h = runFor({ hold: 0.15 }, [0.1, 0.2]);
        expect(h.timeline()).toEqual(['T3 dropItem', 'T4 useItemOnItem,clickComponent', 'T6 dropItem,useItemOnItem,clickComponent']);
        expect(h.status.counters.held).toBe(1);
    });

    test('a held bundle counts against the next tick budget, ahead of that tick sends', () => {
        const h = new Harness('b', () => ({
            onTick(ctx) {
                if (ctx.tick === 1) {
                    ctx.starter();
                    for (let i = 0; i < 3; i++) ctx.send({ type: 'dropItem', slot: i });
                } else for (let i = 10; i < 14; i++) ctx.send({ type: 'dropItem', slot: i });
                ctx.progress();
            }
        }), { random: () => 0 });
        h.start('b', { hold: 1 });
        h.step(makeState({ tick: 1 }));
        h.step(makeState({ tick: 2 }));
        expect(h.sent.map(s => `${s.tick}:${(s.action as { slot: number }).slot}`)).toEqual(['2:0', '2:1', '2:2', '2:10', '2:11']);
        expect(h.status.deferred).toBe(2);
    });

    test('a hold outside [0, 1] is a bad parameter', () => {
        for (const hold of [-0.1, 1.5, '0.2']) {
            const rt = new ProgramRuntime({ dispatch: () => ({ success: true, message: '' }) });
            rt.register('s', declared(starters));
            const r = rt.command({ op: 'start', name: 's', params: { hold } });
            expect(r.success).toBe(false);
            expect(r.message).toContain('hold must be');
        }
    });
});

describe('parseProgramCommand', () => {
    test('validates the wire payload', () => {
        expect(parseProgramCommand({ op: 'start', name: 'probe', params: { trials: 60 } })).toEqual({ op: 'start', name: 'probe', params: { trials: 60 } });
        expect(parseProgramCommand({ op: 'stop' })).toEqual({ op: 'stop' });
        expect(typeof parseProgramCommand({ op: 'start' })).toBe('string');
        expect(typeof parseProgramCommand({ op: 'start', name: 'x', params: [1] })).toBe('string');
        expect(typeof parseProgramCommand({ op: 'jump' })).toBe('string');
        expect(parseProgramCommand({ op: 'input', data: { givers: ['a'] } })).toEqual({ op: 'input', data: { givers: ['a'] } });
        expect(typeof parseProgramCommand({ op: 'input' })).toBe('string');
        expect(typeof parseProgramCommand(null)).toBe('string');
    });
});

describe('ProgramRuntime user-event accounting', () => {
    test('userEventsOf: a routed op is 2, an unrouted one 1, anything else 1', () => {
        expect(userEventsOf({ type: 'interactLoc' })).toBe(2);
        expect(userEventsOf({ type: 'interactLoc', route: false })).toBe(1);
        expect(userEventsOf({ type: 'interactNpc', route: false })).toBe(1);
        expect(userEventsOf({ type: 'pickupItem', route: false })).toBe(1);
        expect(userEventsOf({ type: 'interactPlayer', route: false })).toBe(2);
        expect(userEventsOf({ type: 'useItemOnItem' })).toBe(1);
    });

    test('packets count the events the client reports; a tick of 5 sends with a routed op is over budget, the gate unchanged', () => {
        let routed = true;
        const h = new Harness('burst', () => ({
            onTick(ctx) {
                for (let i = 0; i < 4; i++) ctx.send({ type: 'useItemOnItem', sourceSlot: 14 + i, targetSlot: i });
                ctx.send({ type: 'interactLoc', x: 1, z: 1, locId: 2, optionIndex: 1, ...(routed ? {} : { route: false }) });
                ctx.progress();
            }
        }));
        h.respond = a => (a.type === 'interactLoc' && (a as { route?: boolean }).route !== false ? { success: true, message: 'ok', userEvents: 2 } : undefined);
        h.start('burst');
        h.step(makeState({ tick: 1 }));
        // all five sends went out (the per-send gate is as before), but they are 6 events
        expect(h.sent).toHaveLength(5);
        expect(h.status.packets).toBe(6);
        expect(h.status.deferred).toBe(0);
        expect(h.status.counters.overBudget).toBe(1);
        routed = false;
        h.step(makeState({ tick: 2 }));
        expect(h.sent).toHaveLength(10);
        expect(h.status.packets).toBe(11);
        expect(h.status.counters.overBudget).toBe(1);
    });

    test('a client result without userEvents counts 1 per send, as before', () => {
        const h = new Harness('plain', () => ({
            onTick(ctx) {
                for (let i = 0; i < 5; i++) ctx.send({ type: 'interactNpc', npcIndex: i, optionIndex: 1 });
                ctx.progress();
            }
        }));
        h.start('plain');
        h.step(makeState({ tick: 1 }));
        expect(h.status.packets).toBe(5);
        expect(h.status.counters.overBudget).toBeUndefined();
    });
});
