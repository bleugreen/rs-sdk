import { afterEach, describe, expect, test } from 'bun:test';
import type { BotWorldState, PlayerState } from '../../sdk/types';
import { baseState, FakeSdk, flush } from './fake-sdk';
import { type DirectClient, directProbeSdk } from './direct';
import { directDecision, gateDecision, HostGate, latencyHistogram, probeOnTime, type ProbeState, summarizeProbe, steadinessHistogram, tickSteadiness, ticksPerDrop, vantageDecision, verdictText } from './hostgate';

const HOME: [number, number] = [3200, 3200];
const player = (x: number, z: number) => ({ name: 'probe', worldX: x, worldZ: z }) as PlayerState;

/**
 * A server stand-in for walks: a walk sent while label c is current steps the player on
 * tick c+1+late(n) (n counts walks from 0). Walks to a blocked tile go nowhere. With `gapMs`,
 * tick i arrives gapMs(i) after tick i-1 (`arrivalMs`); `path` marks the fake as that path.
 */
function walkWorld(late: (n: number) => number = () => 0, blocked: Set<string> = new Set(), opts: { gapMs?: (i: number) => number; path?: 'direct' | 'relay' } = {}) {
    const sdk = new FakeSdk(baseState({ tick: 100, player: player(...HOME) }));
    if (opts.path) Object.assign(sdk, { path: opts.path });
    let clock = 0;
    let ticks = 0;
    const arrival = (): Partial<BotWorldState> => (opts.gapMs ? ({ arrivalMs: (clock += opts.gapMs(ticks++)) } as Partial<BotWorldState>) : {});
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
            if (!due.length) return arrival();
            for (const d of due) queue.splice(queue.indexOf(d), 1);
            const last = due[due.length - 1]!;
            return { player: player(last.x, last.z), ...arrival() };
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

    test('records the path, one arrival per tick label, and the steadiness of the stream', async () => {
        // a 300 ms grid with one overrun (480 ms) and its catch-up (120 ms) at ticks 6 and 7
        const w = walkWorld(() => 0, new Set(), { gapMs: i => (i === 6 ? 480 : i === 7 ? 120 : 300) });
        const r = await drive(w, probeOnTime(w.sdk as never, { trials: 10 }));
        expect(r.path).toBe('relay');
        expect(r.tickArrivals.length).toBe(r.ticks);
        expect(r.steadiness).toMatchObject({ n: r.ticks - 1, p50: 300, max: 480, overSevenSixthsT: 1, underHalfT: 1, catchUps: 1, T: 300, TSource: 'median' });
        expect(r.steadiness.histogram).toEqual({ 100: 1, 300: r.ticks - 3, 450: 1 });
    });

    test('a state that moves the label by two adds two arrivals with one time', async () => {
        const w = walkWorld(() => 0, new Set(), { gapMs: () => 300 });
        const p = probeOnTime(w.sdk as never, { trials: 4 });
        await flush();
        w.step();
        await flush();
        // two ticks decoded from one read: the label jumps 2, the second interval is 0
        w.sdk.tick({ tick: w.sdk.state!.tick + 2, arrivalMs: 900 } as Partial<BotWorldState>);
        const r = await drive(w, p);
        expect(r.tickArrivals.slice(0, 3)).toEqual([300, 900, 900]);
    });

    test('steadyMs keeps reading ticks after the trials until the arrivals span that long', async () => {
        const w = walkWorld(() => 0, new Set(), { gapMs: () => 300 });
        const r = await drive(w, probeOnTime(w.sdk as never, { trials: 4, steadyMs: 6000 }));
        expect(r.trials).toBe(4);
        expect(r.steadiness.spanMs).toBe(6000);
        expect(r.tickArrivals.length).toBe(21);
        expect(w.walks().length).toBe(4); // no walks while settling
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
    // n trials, `atMode` of them at 1 tick and the rest at 2
    const dist = (atMode: number, n = 20) => summarizeProbe([...Array(atMode).fill(1), ...Array(n - atMode).fill(2)]);
    test('a quiet host manipulates everywhere', () => {
        const quiet = summarizeProbe(Array(20).fill(1));
        for (const m of [wc, fly, mine]) expect(gateDecision(quiet, m)).toMatchObject({ on: true, p: 1, knife: 3, lead: 0 });
    });
    test('a steady latency costs nothing and sets the lead', () => {
        expect(gateDecision(summarizeProbe(Array(20).fill(3)), wc)).toMatchObject({ on: true, p: 1, knife: 3, lead: 2 });
    });
    test('the threshold on p follows from the plain cycle and the miss cost', () => {
        // knife 3 + (1-p) * miss < plain. Default miss = plain: woodcutting p > 3/4, fly p > 3/5.
        // A miss cost of 9 (an open-loop slip and restart): iron p > 0.93.
        expect(gateDecision(dist(16), wc).on).toBe(true);
        expect(gateDecision(dist(15), wc).on).toBe(false);
        expect(gateDecision(dist(13), fly)).toMatchObject({ on: true, p: 0.65 });
        expect(gateDecision(dist(12), fly)).toMatchObject({ on: false, p: 0.6 });
        expect(gateDecision(dist(19), mine).on).toBe(true);
        expect(gateDecision(dist(18), mine).on).toBe(false);
        // the closed-loop mining executor loses only the late tick
        expect(gateDecision(dist(8), { plainCycle: 3.61, missCost: 1 }).on).toBe(true);
    });
    test('Ashburn-like data passes, bbs-like data does not for woodcutting', () => {
        // main's Azure eastus probe: 51 at 1, 9 at 2 (85% at the dominant offset)
        expect(gateDecision(dist(51, 60), wc)).toMatchObject({ on: true, lead: 0 });
        // rs/62's probes from bbs: 139 at 1, 336 at 2, 5 at 3 (70%): woodcutting plain, fly on
        const bbs = summarizeProbe([...Array(139).fill(1), ...Array(336).fill(2), ...Array(5).fill(3)]);
        expect(gateDecision(bbs, wc)).toMatchObject({ on: false, lead: 1 });
        expect(gateDecision(bbs, fly).on).toBe(true);
        // rs/26 from bbs: 25 at 2, 35 at 3 (58%): plain for both
        const rs26 = summarizeProbe([...Array(25).fill(2), ...Array(35).fill(3)]);
        expect(gateDecision(rs26, wc)).toMatchObject({ on: false, lead: 2 });
        expect(gateDecision(rs26, fly).on).toBe(false);
    });
    test('an empty probe says no', () => {
        expect(gateDecision(summarizeProbe([]), wc).on).toBe(false);
    });
});

describe('tickSteadiness', () => {
    const grid = (gaps: number[]) => gaps.reduce<number[]>((a, g) => [...a, a[a.length - 1]! + g], [0]);
    test('a catch-up is an interval under 150 ms right after one over 350 ms', () => {
        const s = tickSteadiness(grid([300, 360, 140, 300, 340, 140, 300, 400, 160, 300, 500, 0, 300]));
        // 360 then 140 counts; 340 then 140 does not; 400 then 160 does not; 500 then 0 (two ticks in one read) counts
        expect(s).toMatchObject({ n: 13, catchUps: 2, overSevenSixthsT: 3, underHalfT: 3, max: 500, T: 300, TSource: 'median' });
        expect(steadinessHistogram(s)).toBe('0:1 100:2 150:1 300:6 350:1 400:1 500:1');
    });
    test('quantiles match the probe scripts (sorted[floor(p * n)])', () => {
        const s = tickSteadiness(grid([...Array(9).fill(300), 500]));
        expect(s).toMatchObject({ p10: 300, p50: 300, p90: 500, max: 500 });
    });
    test('catch-ups per minute: a window under a minute counts as one minute', () => {
        const burst = [300, 450, 100];
        const short = tickSteadiness(grid([...burst, ...Array(30).fill(300)]));
        expect(short).toMatchObject({ catchUps: 1, catchUpsPerMinute: 1 });
        const twoMinutes = tickSteadiness(grid([...burst, ...burst, ...Array(400 - 6).fill(300)]));
        expect(twoMinutes.catchUps).toBe(2);
        expect(twoMinutes.catchUpsPerMinute).toBeCloseTo(1, 1);
    });
    test('fewer than two arrivals is all zeros', () => {
        expect(tickSteadiness([5])).toMatchObject({ n: 0, spanMs: 0, p90: 0, catchUps: 0, catchUpsPerMinute: 0, histogram: {}, T: null, TSource: null });
    });
});

describe('directDecision', () => {
    const steady = { p90: 351, catchUpsPerMinute: 0, T: 300 };
    const probe = (onTime: number, trials = 60) => ({ onTime, trials, steadiness: steady });
    test('60 of 60 passes, 58 starts but is marginal, 57 is below the floor', () => {
        expect(directDecision(probe(60))).toMatchObject({ on: true, status: 'pass', passAt: 60, floorAt: 58, failures: [], lead: 0 });
        expect(directDecision(probe(59))).toMatchObject({ on: true, status: 'marginal' });
        expect(directDecision(probe(58))).toMatchObject({ on: true, status: 'marginal', failures: [] });
        expect(directDecision(probe(57))).toMatchObject({ on: false, status: 'investigate', failures: ['on time 57/60, under the floor of 58'] });
    });
    test('the floor is configurable, and other trial counts keep the same shares', () => {
        expect(directDecision(probe(57), { floor: 57 })).toMatchObject({ on: true, status: 'marginal', floorAt: 57 });
        expect(directDecision(probe(20, 20))).toMatchObject({ status: 'pass', passAt: 20, floorAt: 20 });
        expect(directDecision(probe(19, 20))).toMatchObject({ status: 'investigate', floorAt: 20 });
        expect(directDecision(probe(0, 0))).toMatchObject({ on: false, status: 'investigate', failures: ['no probe trials'] });
    });
    test('an overrun period reads re-measure, even when it cost trials', () => {
        // rs/83's 04:13 minute: direct 40:16:4, tick p90 486, 22.6 catch-ups per minute
        const v = directDecision({ onTime: 40, trials: 60, steadiness: { p90: 486, catchUpsPerMinute: 22.6, T: 300 } });
        expect(v).toMatchObject({ on: false, status: 're-measure' });
        expect(v.failures[0]).toBe('overrun period, re-measure (22.6 catch-ups per minute over 2)');
        const strict = directDecision({ onTime: 40, trials: 60, steadiness: { p90: 486, catchUpsPerMinute: 22.6, T: 300 } }, { tickP90PassLine: true });
        expect(strict.failures[0]).toBe('overrun period, re-measure (22.6 catch-ups per minute over 2, tick p90 486 ms over 400 (T 300))');
        expect(v.failures[1]).toBe('on time 40/60, under the floor of 58');
        // 60 of 60 re-measures on catch-ups alone (c), and on p90 alone (b) only as a pass line
        expect(directDecision({ onTime: 60, trials: 60, steadiness: { p90: 350, catchUpsPerMinute: 3.3, T: 300 } }).status).toBe('re-measure');
        expect(directDecision({ onTime: 60, trials: 60, steadiness: { p90: 404, catchUpsPerMinute: 0, T: 300 } }, { tickP90PassLine: true }).status).toBe('re-measure');
    });
    test('the catch-up limit is a parameter: default 2 per minute', () => {
        // rs/95's 04:55 minute: 59 of 60 with 1.5 catch-ups per minute
        const v = { onTime: 59, trials: 60, steadiness: { p90: 346, catchUpsPerMinute: 1.5, T: 300 } };
        expect(directDecision(v).on).toBe(true);
        expect(directDecision({ ...v, steadiness: { p90: 346, catchUpsPerMinute: 2, T: 300 } }).on).toBe(true);
        expect(directDecision(v, { maxCatchUpsPerMinute: 1 }).status).toBe('re-measure');
        expect(directDecision(v, { maxTickP90Ms: 340 }).status).toBe('marginal');
        expect(directDecision(v, { maxTickP90Ms: 340, tickP90PassLine: true }).status).toBe('re-measure');
    });
    test('(b) is report-only by default: printed with its value, never in failures or the status', () => {
        const v = directDecision({ onTime: 60, trials: 60, steadiness: { p90: 513, catchUpsPerMinute: 0, T: 300 } });
        expect(v).toMatchObject({ on: true, status: 'pass', failures: [] });
        expect(v.checks.map(k => [k.id, k.role, k.ok])).toEqual([['a', 'pass', true], ['b', 'report', false], ['c', 'pass', true], ['d', 'pass', null]]);
        expect(verdictText(v)).toBe('(a) on time 60/60, pass 60, floor 58 pass; (b) tick p90 513 ms (T 300, report <= 400) over; (c) catch-ups 0/min <= 2 (< 150 after > 350 ms) pass; (d) loop p10 >= 50 not measured: pass');
        const strict = directDecision({ onTime: 60, trials: 60, steadiness: { p90: 513, catchUpsPerMinute: 0, T: 300 } }, { tickP90PassLine: true });
        expect(strict).toMatchObject({ on: false, status: 're-measure' });
        expect(verdictText(strict)).toContain('(b) tick p90 513 ms (T 300, pass <= 400) FAIL;');
    });
    test('a throttled tab fails (d); an in-process probe has no loop rate and is not held to it', () => {
        expect(directDecision({ ...probe(60), loopRateP10: 74 })).toMatchObject({ status: 'pass' });
        const slow = directDecision({ ...probe(60), loopRateP10: 4 });
        expect(slow).toMatchObject({ on: false, status: 'throttled' });
        expect(slow.failures).toEqual(['tab throttled: loop rate p10 4/s under 50 (check the run-machine setup)']);
        expect(directDecision({ ...probe(60), loopRateP10: 45 }, { minLoopRateP10: 40 }).status).toBe('pass');
        expect(directDecision(probe(60)).checks.map(c => [c.id, c.ok])).toEqual([['a', true], ['b', true], ['c', true], ['d', null]]);
    });
    test('without steadiness, (b) and (c) are not measured and (a) decides', () => {
        expect(directDecision({ onTime: 60, trials: 60 })).toMatchObject({ status: 'pass' });
        expect(directDecision({ onTime: 60, trials: 60 }).checks.map(c => c.ok)).toEqual([true, null, null, null]);
    });
});

describe('vantageDecision', () => {
    const eastus = { edge: 'iad', app: 'iad', meshHop: null, connectMs: [2.1, 2.4, 3.0, 2.2, 2.8], players: 1655 };
    test('Ashburn: iad edge, no mesh hop, TCP connect 2-3 ms', () => {
        expect(vantageDecision(eastus)).toMatchObject({ ok: true, connectP50: 2.4, players: 1655, failures: [] });
    });
    test('an iad edge is not enough: the Quebec runner at 24 ms fails by name', () => {
        expect(vantageDecision({ ...eastus, connectMs: [24, 23, 25] })).toMatchObject({ ok: false, failures: ['TCP connect p50 24 ms, over 5'] });
        expect(vantageDecision({ ...eastus, connectMs: [9] }, { maxConnectP50Ms: 10 }).ok).toBe(true);
    });
    test('home: the Los Angeles edge over the mesh', () => {
        const v = vantageDecision({ edge: 'lax', app: 'iad', meshHop: 'edge-dp-ash2', connectMs: [20, 21] });
        expect(v.failures).toEqual(["Fly edge is 'lax', not 'iad'", "the edge forwards over Fly's mesh (edge-dp-ash2): not beside the app", 'TCP connect p50 21 ms, over 5']);
    });
    test('no samples fails; edge any disables the region check', () => {
        expect(vantageDecision({ ...eastus, connectMs: [] }).failures).toEqual(['no TCP connect samples']);
        expect(vantageDecision({ ...eastus, edge: 'ord' }, { edge: 'any' }).ok).toBe(true);
    });
});

describe('directProbeSdk', () => {
    test('the engine-websocket adapter: path direct, labels per PLAYER_INFO, arrival stamps, walk then flush', () => {
        let onTick: ((n: number) => void) | null = null;
        const calls: string[] = [];
        const client: DirectClient = {
            setOnGameTickCallback: cb => (onTick = cb),
            getPlayerPosition: () => ({ worldX: 3200, worldZ: 3201 }),
            isInGame: () => true,
            walkTo: (x, z) => (calls.push(`walk ${x},${z}`), { moved: true }),
            flush: () => calls.push('flush'),
        };
        let at = 1000;
        const sdk = directProbeSdk(client, () => at);
        const seen: ProbeState[] = [];
        sdk.onStateUpdate(s => seen.push(s));
        onTick!(1);
        at = 1300;
        onTick!(2);
        expect(sdk.path).toBe('direct');
        expect(seen).toEqual([
            { tick: 1, inGame: true, player: { worldX: 3200, worldZ: 3201 }, arrivalMs: 1000 },
            { tick: 3, inGame: true, player: { worldX: 3200, worldZ: 3201 }, arrivalMs: 1300 },
        ]);
        void sdk.sendWalk(3201, 3201);
        expect(calls).toEqual(['walk 3201,3201', 'flush']);
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
        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatch(new RegExp(`^T${t} gate \\(start\\): latency 1:4 of 4, same as previous 1.00, in 5 ticks; ticks p50 .* catch-ups .*; p 1.00, predicted knife 3.00 vs plain 4.00, lead 0 -> manipulate$`));
        // 1:2 2:2 would be p 0.5: knife 4.5 against 4, off (see the jittery test below)
    });

    describe('picks the rule by the probe path', () => {
        const wc = { plainCycle: 4 };
        const threeLate = (n: number) => (n === 10 || n === 20 || n === 30 ? 1 : 0);
        test('57 of 60: the relay cost model manipulates, the direct rule does not', async () => {
            const relay = walkWorld(threeLate);
            const rg = new HostGate(relay.sdk as never, { model: wc, probe: { trials: 60 } });
            expect(await drive(relay, rg.probe('start'))).toBe(true);
            expect(rg.history[0]!.verdict).toMatchObject({ path: 'relay', p: 0.95 });

            const direct = walkWorld(threeLate, new Set(), { path: 'direct', gapMs: () => 300 });
            const lines: string[] = [];
            const dg = new HostGate(direct.sdk as never, { model: wc, probe: { trials: 60 }, log: l => lines.push(l) });
            expect(await drive(direct, dg.probe('start'))).toBe(false);
            expect(dg.history[0]!.result!.path).toBe('direct');
            expect(dg.history[0]!.verdict).toMatchObject({ path: 'direct', status: 'investigate', onTime: 57, trials: 60 });
            expect(lines[0]).toMatch(/gate \(start, direct\): latency 1:57 2:3 of 60, .*ticks p50 300 p90 300 max 300 ms, 0 catch-ups \(300:\d+\); \(a\) on time 57\/60, pass 60, floor 58 FAIL; .*: investigate -> plain$/);
        });
        test('direct: 58 of 60 starts, and the direct rule is configurable through GateOptions', async () => {
            const twoLate = (n: number) => (n === 10 || n === 20 ? 1 : 0);
            const w = walkWorld(twoLate, new Set(), { path: 'direct', gapMs: () => 300 });
            const gate = new HostGate(w.sdk as never, { model: wc, probe: { trials: 60 }, direct: { floor: 59 } });
            expect(await drive(w, gate.probe('start'))).toBe(false);
            const w2 = walkWorld(twoLate, new Set(), { path: 'direct', gapMs: () => 300 });
            const gate2 = new HostGate(w2.sdk as never, { model: wc, probe: { trials: 60 } });
            expect(await drive(w2, gate2.probe('start'))).toBe(true);
            expect(gate2.history[0]!.verdict).toMatchObject({ status: 'marginal', lead: 0 });
        });
        test('direct: a burst of overruns during the probe switches the knife off for a re-measure', async () => {
            // every fourth tick overruns to 480 ms and the next follows 120 ms later
            const w = walkWorld(() => 0, new Set(), { path: 'direct', gapMs: i => (i % 4 === 2 ? 480 : i % 4 === 3 ? 120 : 300) });
            const gate = new HostGate(w.sdk as never, { model: wc, probe: { trials: 20 } });
            expect(await drive(w, gate.probe('start'))).toBe(false);
            expect(gate.history[0]!.verdict).toMatchObject({ path: 'direct', status: 're-measure', onTime: 20 });
        });
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
        let jitter = true;
        const w = walkWorld(n => (jitter ? n % 2 : 0));
        const gate = new HostGate(w.sdk as never, { model: { plainCycle: 4 }, probe: { trials: 4 }, measureDrops: 3, offReprobeTicks: 0, minProbeGapTicks: 0 });
        await drive(w, gate.probe('start')); // jittery: off
        const t = w.sdk.state!.tick;
        for (const d of [0, 4, 8]) gate.drop(t + d); // plain 4 ticks per drop
        jitter = false;
        await drive(w, gate.probe('periodic')); // quiet now: on
        expect(gate.on).toBe(true);
        const t2 = w.sdk.state!.tick;
        expect([0, 3].map(d => gate.drop(t2 + d))).toEqual([false, false]);
        expect(gate.drop(t2 + 6)).toBe(false); // 3 per drop beats 4
        expect(gate.on).toBe(true);
    });

    describe('measureDrops sampling', () => {
        const idleSdk = { getState: () => null, onStateUpdate: () => () => {}, sendWalk: async () => {} } as never;
        /** mulberry32: a seeded uniform [0, 1). */
        const seeded = (seed: number) => {
            let a = seed >>> 0;
            return () => {
                a = (a + 0x6d2b79f5) >>> 0;
                let t = a;
                t = Math.imul(t ^ (t >>> 15), t | 1);
                t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
                return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
            };
        };
        // An honest knife: a roll every 3 ticks, success 0.55, against plain at 3.5 ticks per
        // roll (the knife is about 14% faster). Returns the drop the gate switched off on, or 0
        // if it held the knife for the whole stretch.
        const P = 0.55;
        const falseFire = (seed: number, measureDrops: number, stretch = 400) => {
            const gate = new HostGate(idleSdk, { model: { plainCycle: 3.5 }, plainTicksPerDrop: 3.5, measureDrops });
            gate.on = true;
            const roll = seeded(seed);
            for (let tick = 0, n = 0; n < stretch; ) {
                tick += 3;
                if (roll() >= P) continue;
                n++;
                if (gate.drop(tick, 1 / P)) return n;
            }
            return 0;
        };

        test('the default is 120 drops', () => {
            const lines: string[] = [];
            const gate = new HostGate(idleSdk, { model: { plainCycle: 4 }, plainTicksPerDrop: 4, log: l => lines.push(l) });
            gate.on = true;
            // a knife slower than plain (5 ticks per drop) is not judged before drop 120
            for (let i = 0; i < 119; i++) expect(gate.drop(i * 5)).toBe(false);
            expect(gate.drop(119 * 5)).toBe(true);
            expect(lines.at(-1)).toMatch(/over 120 drops/);
        });

        test('at p=0.55 a 30-drop mean switches an honest knife off on luck; a 120-drop mean holds it', () => {
            // the same rolls: 30 crosses the line, 120 never does over the stretch
            expect(falseFire(3, 30)).toBeGreaterThanOrEqual(30);
            expect(falseFire(3, 120)).toBe(0);
            const seeds = Array.from({ length: 200 }, (_, i) => i + 1);
            const at30 = seeds.filter(s => falseFire(s, 30)).length;
            const at120 = seeds.filter(s => falseFire(s, 120)).length;
            expect(at30).toBeGreaterThan(30); // about one stretch in five
            expect(at120).toBeLessThan(8); // under one in twenty-five
        });
    });
});
