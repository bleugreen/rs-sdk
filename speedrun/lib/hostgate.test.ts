import { afterEach, describe, expect, test } from 'bun:test';
import type { BotWorldState, PlayerState } from '../../sdk/types';
import { baseState, FakeSdk, flush } from './fake-sdk';
import { DEFAULT_THRESHOLD, gateDecision, HostGate, latencyHistogram, probeOnTime, summarizeProbe } from './hostgate';

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
        expect(summarizeProbe([1, 1, 2, 1, 3])).toEqual({ trials: 5, onTime: 3, fraction: 0.6, lateTicks: [1, 2] });
    });

    test('no trials is fraction 0, not NaN', () => {
        expect(summarizeProbe([])).toEqual({ trials: 0, onTime: 0, fraction: 0, lateTicks: [] });
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
        expect(gateDecision(r)).toBe(false);
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
    const r = (onTime: number, trials = 20) => summarizeProbe([...Array(onTime).fill(1), ...Array(trials - onTime).fill(2)]);
    test('default threshold allows one late trial in 20', () => {
        expect(DEFAULT_THRESHOLD).toBe(0.95);
        expect(gateDecision(r(20))).toBe(true);
        expect(gateDecision(r(19))).toBe(true);
        expect(gateDecision(r(18))).toBe(false);
        // rs/53's loaded host: 23 of 60 on time
        expect(gateDecision(r(23, 60))).toBe(false);
    });
    test('a stricter threshold', () => {
        expect(gateDecision(r(19), 1)).toBe(false);
        expect(gateDecision(r(20), 1)).toBe(true);
    });
});

describe('HostGate', () => {
    test('probes first, then only after a slip while on, rate-limited', async () => {
        const w = walkWorld();
        const lines: string[] = [];
        const gate = new HostGate(w.sdk as never, { probe: { trials: 4 }, minProbeGapTicks: 50, log: l => lines.push(l) });
        expect(gate.on).toBe(false);
        expect(gate.due(w.sdk.state!.tick)).toBe(true);
        expect(await drive(w, gate.probe('start'))).toBe(true);
        const t = w.sdk.state!.tick;
        expect(gate.due(t + 10_000)).toBe(false); // on: no periodic probe
        gate.slip();
        expect(gate.due(t + 10)).toBe(false); // too soon after the last probe
        expect(gate.due(t + 50)).toBe(true);
        expect(lines).toEqual([`T${t} gate (start): 4/4 on time, latency 1:4, 5 ticks -> manipulate`]);
    });

    test('switches off on a bad probe, re-probes periodically, and switches back', async () => {
        let bad = true;
        const w = walkWorld(() => (bad ? 1 : 0));
        const lines: string[] = [];
        const gate = new HostGate(w.sdk as never, { probe: { trials: 4 }, offReprobeTicks: 200, minProbeGapTicks: 50, log: l => lines.push(l) });
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
        expect(lines[1]).toMatch(/^T\d+ gate \(slip\): 0\/4 on time, latency 2:4, \d+ ticks -> SWITCH manipulate -> plain$/);
        expect(lines[2]).toMatch(/SWITCH plain -> manipulate$/);
        expect(gate.switches()).toMatch(/^T\d+ manipulate->plain T\d+ plain->manipulate$/);
    });

    test('a host that starts bad is off from the first probe, and that is not a switch', async () => {
        const w = walkWorld(() => 1);
        const gate = new HostGate(w.sdk as never, { probe: { trials: 4 } });
        expect(await drive(w, gate.probe('start'))).toBe(false);
        expect(gate.history[0]!.switched).toBe(false);
        expect(gate.switches()).toBe('');
    });
});
