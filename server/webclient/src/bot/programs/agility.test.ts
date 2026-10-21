import { describe, expect, test } from 'bun:test';

import '../../lite/test-support/browser-globals.js';

import { createAgility } from './agility.js';
import type { AgilityCourse } from './agility-courses.js';
import { Harness, makeState } from './testkit.js';

const COURSE: AgilityCourse = {
    start: [3000, 3000, 0],
    lapBonus: 40,
    resume: { b: 'a' },
    steps: [
        { name: 'a', locs: [[1, 3001, 3000]], xp: 10 },
        { name: 'b', locs: [[2, 3002, 3000]], xp: 10 },
        { name: 'c', locs: [[3, 3003, 3000]], xp: 10 + 40 }
    ]
};
const DURATION: Record<number, number> = { 1: 5, 2: 7, 3: 6 };

/** Each obstacle completes `DURATION[id]` ticks after its click lands; `failAt` makes that click fail. */
function run(opts: { ticks: number; params?: Record<string, unknown>; failClick?: number }) {
    const h = new Harness('agl', createAgility);
    let tick = 50;
    let xp = 0;
    let msgId = 0;
    const msgs: Array<{ text: string; tick: number; id: number }> = [];
    const done: Array<{ at: number; id: number; ok: boolean }> = [];
    const completions: Array<{ tick: number; id: number }> = [];
    const xpOf: Record<number, number> = { 1: 10, 2: 10, 3: 50 };
    let clicks = 0;
    const state = () => makeState({
        tick,
        skills: { Agility: { xp: xp * 25 } },
        locs: [1, 2, 3].map(id => ({ id, x: 3000 + id, z: 3000, name: `obstacle ${id}`, options: ['Cross'] })),
        messages: msgs.slice(-10)
    });
    h.start('agl', { course: COURSE, maxTicks: opts.ticks, ...opts.params }, state());
    const pending: Array<{ at: number; id: number }> = [];
    for (let i = 0; i < opts.ticks + 5 && h.status.phase === 'running'; i++) {
        tick++;
        for (const p of pending.filter(p => p.at === tick)) {
            const fail = clicks++ === opts.failClick;
            done.push({ at: tick + (fail ? 2 : DURATION[p.id]!), id: p.id, ok: !fail });
        }
        for (const d of done.filter(d => d.at === tick)) {
            if (d.ok) { xp += xpOf[d.id]!; completions.push({ tick, id: d.id }); }
            else msgs.push({ text: 'You slip and fall.', tick, id: msgId++ });
        }
        for (const s of h.step(state())) if (s.action.type === 'interactLoc') pending.push({ at: tick + 1, id: s.action.locId });
    }
    return { h, completions };
}

describe('agility course', () => {
    test('clicks the next obstacle on the label that shows the previous one done', () => {
        const { h, completions } = run({ ticks: 200 });
        const clickTicks = h.sent.filter(s => s.action.type === 'interactLoc').map(s => s.tick);
        for (const c of completions.filter(c => c.tick < h.status.endedTick!)) expect(clickTicks).toContain(c.tick);
        // a lap is 3 clicks of 1 tick latency plus 5 + 7 + 6
        const r = h.status.result as { ticksPerLap: number; laps: number };
        expect(r.ticksPerLap).toBe(21);
        expect(r.laps).toBeGreaterThan(8);
    });

    test('the plain fallback waits a tick after each completion', () => {
        const { h } = run({ ticks: 200, params: { technique: 'plain', settleTicks: 1 } });
        expect((h.status.result as { ticksPerLap: number }).ticksPerLap).toBe(24);
    });

    test('a fall waits for the fail script and resumes at the course resume step', () => {
        const { h } = run({ ticks: 120, failClick: 1 }); // the first 'b' fails
        expect(h.status.counters.fails).toBe(1);
        const order = h.sent.filter(s => s.action.type === 'interactLoc').map(s => (s.action as { locId: number }).locId);
        // a, b (fail), then back to a per resume, then b, c
        expect(order.slice(0, 5)).toEqual([1, 2, 1, 2, 3]);
    });

    test('ends after the requested laps', () => {
        const { h } = run({ ticks: 500, params: { laps: 4, maxTicks: undefined } });
        expect(h.status.phase).toBe('done');
        expect((h.status.result as { laps: number }).laps).toBe(4);
    });

    test('knows the lab courses by name', () => {
        expect(() => createAgility({ course: 'wilderness', laps: 1 })).not.toThrow();
        expect(() => createAgility({ course: 'nowhere', laps: 1 })).toThrow(/unknown course/);
    });
});
