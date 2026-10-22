import { describe, expect, test } from 'bun:test';

import '../../lite/test-support/browser-globals.js';

import { createProbe, type InPageProbeResult } from './probe.js';
import { Harness, makeState } from './testkit.js';

/** Plays a server that applies each walk `latency(trial)` ticks after the label it was sent on. */
function simulate(trials: number, latency: (trial: number) => number, opts: { blocked?: string[] } = {}) {
    const h = new Harness('probe', createProbe);
    let x = 3200;
    let z = 3200;
    let tick = 100;
    h.start('probe', { trials }, makeState({ tick, x, z }));
    const arrivals: Array<{ at: number; x: number; z: number }> = [];
    let n = 0;
    for (let i = 0; i < 1000 && h.status.phase === 'running'; i++) {
        tick++;
        for (const a of arrivals.filter(a => a.at === tick)) { x = a.x; z = a.z; }
        const sent = h.step(makeState({ tick, x, z }));
        for (const s of sent) {
            if (s.action.type !== 'walkTo') continue;
            const { x: wx, z: wz } = s.action;
            if (opts.blocked?.includes(`${wx},${wz}`)) continue;
            arrivals.push({ at: tick + latency(n++), x: wx, z: wz });
        }
    }
    return { h, result: h.status.result as InPageProbeResult, x, z };
}

describe('in-page probe', () => {
    test('reads every trial on time when the server processes each walk on the next tick', () => {
        const { h, result, x, z } = simulate(60, () => 1);
        expect(h.status.phase).toBe('done');
        expect(result.trials).toBe(60);
        expect(result.onTime).toBe(60);
        expect(result.counts).toEqual({ 1: 60 });
        expect(result.path).toBe('in-page');
        // ends where it started
        expect([x, z]).toEqual([3200, 3200]);
        // one walk per label: about one trial per tick on a punctual host
        expect(result.ticks).toBeLessThanOrEqual(62);
    });

    test('records late trials with their offset', () => {
        const { result } = simulate(10, n => (n % 2 ? 2 : 1));
        expect(result.counts).toEqual({ 1: 5, 2: 5 });
        expect(result.onTime).toBe(5);
    });

    test('moves on to the next neighbour when the first is not walkable', () => {
        const { result } = simulate(4, () => 1, { blocked: ['3201,3200'] });
        expect(result.trials).toBe(4);
        expect(result.onTime).toBe(4);
    });
});
