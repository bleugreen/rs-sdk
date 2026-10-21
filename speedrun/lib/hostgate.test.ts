import { afterEach, describe, expect, test } from 'bun:test';
import type { BotWorldState, PlayerState } from '../../sdk/types';
import { baseState, FakeSdk, flush } from './fake-sdk';
import { gateDecision, HostGate, latencyHistogram, probeOnTime, summarizeProbe, ticksPerDrop } from './hostgate';

const HOME: [number, number] = [3200, 3200];
const player = (x: number, z: number) => ({ name: 'probe', worldX: x, worldZ: z }) as PlayerState;

/**
 * A server stand-in for walks: a walk sent while label c is current steps the player on
 * tick c+1+late(n) (n counts walks from 0). Walks to a blocked tile go nowhere.
 */
function walkWorld(late: (n: number) => number = () => 0, blocked: Set<string> = new Set()) {
    const sdk = new FakeSdk(baseState({ tick: 100, player: player(...HOME) }));
    let n = 0;
    const queue: { at: number; x: number; z: number }[] = [];
    sdk.onSend = (a, f) => {
        if (a.method !== 'sendWalk') return;
        const [x, z] = a.args as [number, number];
        const at = f.state!.tick + 1 + late(n++);
        if (!blocked.has(`${x},${z}`)) queue.push({ at, x, z });
    };
    const step = () =>
        sdk.tick((s: BotWorldState) => {
            const due = queue.filter(q => q.at <= s.tick + 1);
            if (!due.length) return {};
            for (const d of due) queue.splice(queue.indexOf(d), 1);
            const last = due[due.length - 1]!;
            return { player: player(last.x, last.z) };
        });
    const walks = () => sdk.sent.filter(a => a.method === 'sendWalk');
    return { sdk, step, walks };
}

/** Tick the world until `p` settles (or `max` ticks pass). */
async function drive<T>(w: { step: () => unknown }, p: Promise<T>, max = 400): Promise<T> {
    let settled = false;
    p.then(() => (settled = true), () => (settled = true));
    await flush();
    for (let i = 0; i < max && !settled; i++) {
        w.step();
        await flush();
    }
    return p;
}

describe('summarizeProbe', () => {
    test('counts latency 1 as on time and lists how late the rest were', () => {
        expect(summarizeProbe([1, 1, 2, 1, 3])).toMatchObject({ trials: 5, onTime: 3, fraction: 0.6, lateTicks: [1, 2] });
    });

    test('distribution: counts per offset, dominant offset, and agreement between consecutive trials', () => {
        // rs/26's demo probe shape: no trial at 1, most at 3
        const demo = summarizeProbe([3, 3, 2, 3, 2, 2, 3, 3]);
        expect(demo).toMatchObject({ counts: { 2: 3, 3: 5 }, mode: 3, modeFraction: 5 / 8, onTime: 0 });
        expect(demo.sameAsPrevious).toBeCloseTo(3 / 7);
        // a steady 3 ticks: never on time, but every starter agrees with its bootstrap
        expect(summarizeProbe([3, 3, 3, 3])).toMatchObject({ mode: 3, modeFraction: 1, sameAsPrevious: 1, fraction: 0 });
        // ties go to the smaller offset
        expect(summarizeProbe([2, 1, 2, 1]).mode).toBe(1);
    });

    test('no trials is fraction 0, not NaN', () => {
        expect(summarizeProbe([])).toEqual({ trials: 0, onTime: 0, fraction: 0, lateTicks: [], counts: {}, mode: 0, modeFraction: 0, sameAsPrevious: 0 });
    });

    test('histogram for logs', () => {
        expect(latencyHistogram([2, 1, 1, 9, 1])).toBe('1:3 2:1 9:1');
    });
});

describe('probeOnTime', () => {
    test('a quiet host: every trial on time, back on the start tile', async () => {
        const w = walkWorld();
        const r = await drive(w, probeOnTime(w.sdk as never));
        expect(r).toMatchObject({ trials: 20, onTime: 20, fraction: 1, lateTicks: [], lost: 0 });
        expect(r.latencies).toEqual(Array(20).fill(1));
        // one walk per label after the first fresh one: 20 trials in 21 labels
        expect(r.ticks).toBe(21);
        expect(w.walks().length).toBe(20);
        expect(w.walks()[0]!.args).toEqual([HOME[0] + 1, HOME[1], false]);
        expect(w.sdk.state!.player).toMatchObject({ worldX: HOME[0], worldZ: HOME[1] });
    });

    test('late packets are counted with their lateness', async () => {
        const w = walkWorld(n => (n % 4 === 0 ? 1 : 0));
        const r = await drive(w, probeOnTime(w.sdk as never));
        expect(r).toMatchObject({ trials: 20, onTime: 15, fraction: 0.75, lateTicks: [1, 1, 1, 1, 1] });
    });

    test('an odd trial count walks home afterwards, uncounted', async () => {
        const w = walkWorld();
        const r = await drive(w, probeOnTime(w.sdk as never, { trials: 5 }));
        expect(r.trials).toBe(5);
        expect(w.walks().length).toBe(6);
        expect(w.walks()[5]!.args).toEqual([HOME[0], HOME[1], false]);
        expect(w.sdk.state!.player).toMatchObject({ worldX: HOME[0], worldZ: HOME[1] });
    });

    test('a blocked neighbour is skipped without counting a trial', async () => {
        const w = walkWorld(() => 0, new Set([`${HOME[0] + 1},${HOME[1]}`]));
        const r = await drive(w, probeOnTime(w.sdk as never, { trials: 4, maxWait: 3 }));
        expect(r).toMatchObject({ trials: 4, onTime: 4, lost: 0 });
        expect(w.walks().slice(1).every(a => a.args[0] !== HOME[0] + 1)).toBe(true);
        expect(w.walks()[1]!.args).toEqual([HOME[0] - 1, HOME[1], false]);
    });

    test('the walkable filter picks the neighbour up front', async () => {
        const w = walkWorld();
        const r = await drive(w, probeOnTime(w.sdk as never, { trials: 2, walkable: (x, z) => z === HOME[1] + 1 && x === HOME[0] }));
        expect(r.onTime).toBe(2);
        expect(w.walks()[0]!.args).toEqual([HOME[0], HOME[1] + 1, false]);
    });

    test('no walkable neighbour: no trials, a reason, and the gate stays off', async () => {
        const w = walkWorld(() => 0, new Set(['3201,3200', '3199,3200', '3200,3201', '3200,3199']));
        const r = await drive(w, probeOnTime(w.sdk as never, { maxWait: 2 }));
        expect(r).toMatchObject({ trials: 0, fraction: 0, reason: 'no walkable neighbour' });
        expect(gateDecision(r, { plainCycle: 4 }).on).toBe(false);
    });

    test('a walk that never lands, once the tile is known walkable, is a lost trial', async () => {
        const w = walkWorld(n => (n === 3 ? 1000 : 0));
        const r = await drive(w, probeOnTime(w.sdk as never, { trials: 6, maxWait: 4 }));
        expect(r.lost).toBe(1);
        expect(r.latencies).toEqual([1, 1, 1, 5, 1, 1]);
        expect(r).toMatchObject({ trials: 6, onTime: 5, lateTicks: [4] });
    });

    test('not in game: resolves at once with a reason', async () => {
        const sdk = new FakeSdk(baseState({ player: null }));
        expect(await probeOnTime(sdk as never)).toMatchObject({ trials: 0, reason: 'not in game' });
    });

    describe('a client that stops publishing', () => {
        const saved = process.env.SPEEDRUN_TICK_MS;
        afterEach(() => {
            if (saved === undefined) delete process.env.SPEEDRUN_TICK_MS;
            else process.env.SPEEDRUN_TICK_MS = saved;
        });
        test('rejects', async () => {
            process.env.SPEEDRUN_TICK_MS = '2';
            const w = walkWorld();
            await expect(probeOnTime(w.sdk as never, { maxWait: 2 })).rejects.toThrow(/stopped publishing/);
        });
    });
});

describe('gateDecision', () => {
    const wc = { plainCycle: 4 };
    const fly = { plainCycle: 5 };
    const mine = { plainCycle: 3.61, missCost: 9 };
    test('a quiet host manipulates everywhere', () => {
        const quiet = summarizeProbe(Array(20).fill(1));
        for (const m of [wc, fly, mine]) expect(gateDecision(quiet, m)).toMatchObject({ on: true, p: 1, knife: 3, lead: 0 });
    });
    test('a steady latency is fine for a self-anchored loop and needs a lead when anchored on xp', () => {
        const steady = summarizeProbe(Array(20).fill(3));
        expect(gateDecision(steady, wc)).toMatchObject({ on: true, p: 1, lead: 2 });
        expect(gateDecision(steady, { ...wc, anchor: 'xp' })).toMatchObject({ on: true, p: 1, lead: 2 });
    });
    test('the threshold on p follows from the plain cycle and the miss cost', () => {
        // knife 3 + (1-p) * miss < plain: woodcutting p > 0.75, fly p > 0.6, iron p > 0.93
        const jitter = (same: number) => {
            // 21 trials alternating in runs so that `same` of 20 consecutive pairs agree
            const xs = [2];
            for (let i = 0; i < 20; i++) xs.push(i < same ? xs[i]! : 5 - xs[i]!);
            return summarizeProbe(xs);
        };
        expect(jitter(16).sameAsPrevious).toBe(0.8);
        expect(gateDecision(jitter(16), wc).on).toBe(true);
        expect(gateDecision(jitter(14), wc).on).toBe(false);
        expect(gateDecision(jitter(14), fly).on).toBe(true);
        expect(gateDecision(jitter(18), mine).on).toBe(false);
        expect(gateDecision(jitter(19), mine).on).toBe(true);
    });
    test('an empty probe says no', () => {
        expect(gateDecision(summarizeProbe([]), wc).on).toBe(false);
    });
});

describe('ticksPerDrop', () => {
    test('span over gaps', () => {
        expect(ticksPerDrop([10, 13, 16, 22])).toBe(4);
        expect(ticksPerDrop([10])).toBeNaN();
    });
});

describe('HostGate', () => {
    test('probes first, then only after a slip while on, rate-limited', async () => {
        const w = walkWorld();
        const lines: string[] = [];
        const gate = new HostGate(w.sdk as never, { model: { plainCycle: 4 }, probe: { trials: 4 }, minProbeGapTicks: 50, log: l => lines.push(l) });
        expect(gate.on).toBe(false);
        expect(gate.due(w.sdk.state!.tick)).toBe(true);
        expect(await drive(w, gate.probe('start'))).toBe(true);
        const t = w.sdk.state!.tick;
        expect(gate.due(t + 10_000)).toBe(false); // on: no periodic probe
        gate.slip();
        expect(gate.due(t + 10)).toBe(false); // too soon after the last probe
        expect(gate.due(t + 50)).toBe(true);
        expect(lines).toEqual([`T${t} gate (start): latency 1:4 of 4, same as previous 1.00, in 5 ticks; p 1.00, predicted knife 3.00 vs plain 4.00, lead 0 -> manipulate`]);
    });

    test('a steady 2-tick host stays on with lead 1', async () => {
        const w = walkWorld(() => 1);
        const gate = new HostGate(w.sdk as never, { model: { plainCycle: 4 }, probe: { trials: 4 } });
        expect(await drive(w, gate.probe('start'))).toBe(true);
        expect(gate.lead).toBe(1);
    });

    test('switches off on a jittery probe, re-probes periodically, and switches back', async () => {
        let bad = true;
        const w = walkWorld(n => (bad ? n % 2 : 0));
        const lines: string[] = [];
        const gate = new HostGate(w.sdk as never, { model: { plainCycle: 4 }, probe: { trials: 4 }, offReprobeTicks: 200, minProbeGapTicks: 50, log: l => lines.push(l) });
        bad = false;
        await drive(w, gate.probe('start'));
        expect(gate.on).toBe(true);
        bad = true;
        gate.slip();
        await drive(w, gate.probe('slip'));
        expect(gate.on).toBe(false);
        const tOff = w.sdk.state!.tick;
        gate.slip(); // ignored while off
        expect(gate.due(tOff + 199)).toBe(false);
        expect(gate.due(tOff + 200)).toBe(true);
        bad = false;
        await drive(w, gate.probe('periodic'));
        expect(gate.on).toBe(true);
        expect(gate.history.map(h => [h.why, h.on, h.switched])).toEqual([
            ['start', true, false],
            ['slip', false, true],
            ['periodic', true, true],
        ]);
        expect(lines[1]).toMatch(/^T\d+ gate \(slip\): latency 1:2 2:2 of 4, same as previous 0.00, .* -> SWITCH manipulate -> plain$/);
        expect(lines[2]).toMatch(/SWITCH plain -> manipulate$/);
        expect(gate.switches()).toMatch(/^T\d+ manipulate->plain T\d+ plain->manipulate$/);
        const [, off, on] = gate.history;
        expect(gate.plainTicks(on!.tick + 1000)).toBe(on!.tick - off!.tick);
    });

    test('a host that starts bad is off from the first probe, and that is not a switch', async () => {
        const w = walkWorld(n => n % 2);
        const gate = new HostGate(w.sdk as never, { model: { plainCycle: 4 }, probe: { trials: 4 } });
        expect(await drive(w, gate.probe('start'))).toBe(false);
        expect(gate.history[0]!.switched).toBe(false);
        expect(gate.switches()).toBe('');
    });

    test('measured override: a knife stretch no faster than plain switches off and holds off', async () => {
        const w = walkWorld();
        const lines: string[] = [];
        const gate = new HostGate(w.sdk as never, { model: { plainCycle: 4 }, probe: { trials: 2 }, measureDrops: 4, plainTicksPerDrop: 4, measuredOffTicks: 1000, offReprobeTicks: 200, minProbeGapTicks: 0, log: l => lines.push(l) });
        await drive(w, gate.probe('start'));
        const t = w.sdk.state!.tick;
        // a fast stretch keeps it on
        for (const d of [0, 3, 6, 9]) expect(gate.drop(t + d)).toBe(false);
        expect(gate.on).toBe(true);
        // after a probe the stretch restarts; a slow one switches off
        await drive(w, gate.probe('slip'));
        const t2 = w.sdk.state!.tick;
        expect([0, 5, 10].map(d => gate.drop(t2 + d))).toEqual([false, false, false]);
        expect(gate.drop(t2 + 15)).toBe(true);
        expect(gate.on).toBe(false);
        expect(lines.at(-1)).toBe(`T${t2 + 15} gate (measured): knife 5.00 ticks per drop over 4 drops, plain 4.00 -> SWITCH manipulate -> plain`);
        expect(gate.due(t2 + 15 + 999)).toBe(false);
        expect(gate.due(t2 + 15 + 1000)).toBe(true);
        expect(gate.switches()).toBe(`T${t2 + 15} manipulate->plain (measured)`);
    });

    test('measured override without a configured plain rate uses the last measured plain stretch', async () => {
        const w = walkWorld(n => n % 2);
        const gate = new HostGate(w.sdk as never, { model: { plainCycle: 4 }, probe: { trials: 4 }, measureDrops: 3, offReprobeTicks: 0, minProbeGapTicks: 0 });
        await drive(w, gate.probe('start')); // jittery: off
        const t = w.sdk.state!.tick;
        for (const d of [0, 4, 8]) gate.drop(t + d); // plain 4 ticks per drop
        const w2 = walkWorld();
        (gate as unknown as { sdk: unknown }).sdk = w2.sdk;
        await drive(w2, gate.probe('periodic')); // quiet now: on
        expect(gate.on).toBe(true);
        const t2 = w2.sdk.state!.tick;
        expect([0, 3].map(d => gate.drop(t2 + d))).toEqual([false, false]);
        expect(gate.drop(t2 + 6)).toBe(false); // 3 per drop beats 4
        expect(gate.on).toBe(true);
    });
});
