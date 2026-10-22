import { describe, expect, test } from 'bun:test';
import type { BotWorldState, PlayerState } from '../../sdk/types';
import { baseState, FakeSdk, flush } from './fake-sdk';
import { type GatedSegment, IN_PAGE_RULE, inPageGate, runGatedProgram } from './gated-program';
import { type GateOptions, HostGate, type ProbeResult, summarizeProbe, tickSteadiness } from './hostgate';
import { ProgramError, type ProgramStatus } from './programs';

const frames = (catchUpsLastMinute = 0) => ({ n: 0, p50: 0, p90: 0, max: 0, under150: 0, over350: 0, catchUps: 0, catchUpsLastMinute, catchUpsPerMinute: 0 });

/**
 * The page's program runtime, scripted: `behave` runs on each tick of a running program and
 * moves its counters and phase; the page publishes the status with every state, as the
 * browser does (`state.program`).
 */
class FakePage {
    readonly sdk = new FakeSdk(baseState({ tick: 1000, player: { name: 'p', worldX: 3200, worldZ: 3200 } as PlayerState }));
    readonly starts: Array<{ name: string; params: Record<string, unknown>; tick: number }> = [];
    status: ProgramStatus | null = null;
    catchUpsAt: (tick: number) => number = () => 0;

    constructor(public behave: (st: ProgramStatus, tick: number) => void) {
        Object.assign(this.sdk, { sendAction: (a: { op: string; name: string; params: Record<string, unknown> }) => Promise.resolve(this.handle(a)) });
    }

    private handle(a: { op: string; name: string; params: Record<string, unknown> }) {
        const tick = this.sdk.state!.tick;
        if (a.op === 'start') {
            if (this.status?.phase === 'running') this.status.phase = 'replaced';
            this.status = {
                runId: (this.status?.runId ?? 0) + 1, name: a.name, phase: 'running', params: a.params, startedTick: tick, tick, progressTick: tick,
                counters: {}, gauges: {}, marks: {}, packets: 0, deferred: 0, skippedTicks: 0, maxTickMs: 0,
                frames: frames(), publish: frames(), react: { n: 0, p50: 0, p90: 0, max: 0 }, loops: { last: 0, p10Last10s: 0, min: 0 }
            };
            this.starts.push({ name: a.name, params: a.params, tick });
            return { success: true, message: 'started', data: structuredClone(this.status) };
        }
        if (a.op === 'stop') {
            if (this.status?.phase === 'running') {
                this.status.phase = 'stopped';
                this.status.endedTick = this.status.tick;
            }
            return { success: true, message: 'stopped', data: this.status && structuredClone(this.status) };
        }
        return { success: false, message: `op ${a.op}` };
    }

    tick(): void {
        const st = this.status;
        const t = this.sdk.state!.tick + 1;
        if (st?.phase === 'running') {
            st.tick = t;
            st.frames = frames(this.catchUpsAt(t));
            this.behave(st, t);
        }
        this.sdk.tick({ program: st ? structuredClone(st) : null } as Partial<BotWorldState>);
    }

    /** Gathering runs only. */
    runs() {
        return this.starts.filter(s => s.name !== 'probe');
    }
}

async function drive<T>(page: FakePage, p: Promise<T>, max = 4000): Promise<T> {
    let settled = false;
    p.then(() => (settled = true), () => (settled = true));
    await flush();
    for (let i = 0; i < max && !settled; i++) {
        page.tick();
        await flush();
    }
    return p;
}

const isKnife = (st: ProgramStatus) => st.params.technique === 'knife' || st.params.starter === 'knife';

/**
 * A gathering program: one drop every `knife` or `plain` ticks from the run's start, done
 * at its count budget. `extra` scripts slips, faults and the like by run and offset.
 */
function gather(gaps: { knife: number; plain: number }, extra?: (st: ProgramStatus, off: number) => void) {
    return (st: ProgramStatus, t: number) => {
        const key = st.name === 'knife-mine' ? 'ores' : 'successes';
        const off = t - st.startedTick;
        if (off > 0 && off % (isKnife(st) ? gaps.knife : gaps.plain) === 0) st.counters[key] = (st.counters[key] ?? 0) + 1;
        extra?.(st, off);
        if (st.phase === 'running' && (st.counters[key] ?? 0) >= (st.params[key] as number)) {
            st.phase = 'done';
            st.endedTick = t;
        }
    };
}

function probeResult(onTime: number, trials = 20): ProbeResult {
    const latencies = [...Array(onTime).fill(1), ...Array(trials - onTime).fill(2)];
    return { ...summarizeProbe(latencies), path: 'direct', latencies, lost: 0, ticks: trials, tickArrivals: [], steadiness: tickSteadiness([]), sendMs: [] };
}

/** A gate whose probes read these on-time counts of 20, in order (the last repeats). */
function scriptedGate(page: FakePage, onTimes: number[], opts: Partial<GateOptions> = {}): HostGate {
    const q = [...onTimes];
    return new HostGate(page.sdk, {
        model: { plainCycle: 4 },
        direct: IN_PAGE_RULE,
        plainTicksPerDrop: 4,
        minProbeGapTicks: 10,
        offReprobeTicks: 1000,
        measureDrops: 10,
        probeWith: () => Promise.resolve(probeResult(q.length > 1 ? q.shift()! : q[0]!)),
        ...opts
    });
}

const shape = (segs: GatedSegment[]) => segs.map(s => `${s.technique}:${s.reason}`);
const total = (segs: GatedSegment[], key = 'successes') => segs.reduce((n, s) => n + (s.status.counters[key] ?? 0), 0);

describe('runGatedProgram', () => {
    test('auto: knife while the probe passes; a slip re-probes, and a failing probe runs plain to the end', async () => {
        let slipped = false;
        const page = new FakePage(gather({ knife: 3, plain: 4 }, (st, off) => {
            if (isKnife(st) && off === 30 && !slipped) {
                slipped = true;
                st.counters.slips = 1;
            }
        }));
        const gate = scriptedGate(page, [20, 17]);
        const run = await drive(page, runGatedProgram(page.sdk, 'knife-cycle', { method: 'willow', successes: 40 }, { gate, technique: 'auto' }));
        expect(run.ended).toBe('done');
        expect(shape(run.segments)).toEqual(['knife:probe', 'plain:done']);
        expect(gate.history.map(h => `${h.why}:${h.on}`)).toEqual(['start:true', 'slip:false']);
        const [first, second] = page.runs();
        expect(first!.params).toMatchObject({ method: 'willow', technique: 'knife', successes: 40 });
        // the count budget carries: the plain run gets what the knife run left
        expect(second!.params).toMatchObject({ technique: 'plain', successes: 40 - run.segments[0]!.status.counters.successes! });
        expect(total(run.segments)).toBe(40);
    });

    test('auto: re-probes every offReprobeTicks while plain and goes back to the knife when it passes', async () => {
        const page = new FakePage(gather({ knife: 3, plain: 4 }));
        const gate = scriptedGate(page, [17, 20], { offReprobeTicks: 50 });
        const run = await drive(page, runGatedProgram(page.sdk, 'knife-cycle', { method: 'fly', successes: 30 }, { gate, technique: 'auto' }));
        expect(shape(run.segments)).toEqual(['plain:probe', 'knife:done']);
        expect(gate.history.map(h => `${h.why}:${h.on}`)).toEqual(['start:false', 'off:true']);
        expect(gate.history[1]!.tick - gate.history[0]!.tick).toBeGreaterThanOrEqual(50);
        expect(total(run.segments)).toBe(30);
    });

    test('pause rule: over 5 catch-ups a minute pauses to plain with no probe; under 1 for minTicks re-probes and resumes', async () => {
        const page = new FakePage(gather({ knife: 3, plain: 4 }));
        // 5 is not over 5; 6 is. While paused, 1 is not under 1.
        page.catchUpsAt = t => (t < 1010 ? 0 : t < 1020 ? 5 : t < 1040 ? 6 : t < 1100 ? 1 : 0);
        const gate = scriptedGate(page, [20]);
        const run = await drive(page, runGatedProgram(page.sdk, 'knife-cycle', { method: 'willow', successes: 60 }, { gate, technique: 'auto', pause: { minTicks: 30 } }));
        expect(shape(run.segments)).toEqual(['knife:pause', 'plain:resume', 'knife:done']);
        expect(run.segments[0]!.status.endedTick).toBe(1020);
        expect(run.segments[1]!.status.endedTick).toBe(1100);
        expect(gate.history.map(h => h.why)).toEqual(['start', 'resume']);
        // the paused plain stretch (about 19 drops at 4 ticks, plain's own rate) was not fed to the
        // gate, so it was never measured as a knife stretch no faster than plain
        expect(run.segments[1]!.status.counters.successes).toBeGreaterThan(10);
        expect(gate.history.some(h => h.why === 'measured')).toBe(false);
    });

    test('measured switch-off: a knife slower than plain over measureDrops drops goes plain, with no probe', async () => {
        const page = new FakePage(gather({ knife: 6, plain: 4 }));
        const gate = scriptedGate(page, [20]);
        const run = await drive(page, runGatedProgram(page.sdk, 'knife-cycle', { method: 'willow', successes: 30 }, { gate, technique: 'auto' }));
        expect(shape(run.segments)).toEqual(['knife:measured', 'plain:done']);
        expect(run.segments[0]!.status.counters.successes).toBe(10);
        const m = gate.history.find(h => h.why === 'measured')!;
        expect(m).toMatchObject({ on: false, switched: true, measured: { knife: 6, plain: 4 } });
        expect(gate.history.map(h => h.why)).toEqual(['start', 'measured']);
        expect(total(run.segments)).toBe(30);
    });

    test('measured switch-off: N is measureDrops, and the margin asks the knife to be that share faster', async () => {
        const runWith = async (opts: Partial<GateOptions>) => {
            const page = new FakePage(gather({ knife: 3, plain: 4 }));
            const gate = scriptedGate(page, [20], { plainTicksPerDrop: 3.2, ...opts });
            return (await drive(page, runGatedProgram(page.sdk, 'knife-cycle', { method: 'willow', successes: 40 }, { gate, technique: 'auto' }))).segments;
        };
        // 3.0 ticks per drop beats 3.2: no margin keeps the knife on to the end
        expect(shape(await runWith({}))).toEqual(['knife:done']);
        // 3.0 is not 10% faster than 3.2 (2.88): off after measureDrops drops
        const off = await runWith({ measuredMargin: 0.1, measureDrops: 15 });
        expect(shape(off)).toEqual(['knife:measured', 'plain:done']);
        expect(off[0]!.status.counters.successes).toBe(15);
    });

    test('measured switch-off at margin 0: a dead heat goes plain; strictly faster stays on', async () => {
        const runWith = async (plainTicksPerDrop: number) => {
            const page = new FakePage(gather({ knife: 4, plain: 4 }));
            const gate = scriptedGate(page, [20], { plainTicksPerDrop });
            return shape((await drive(page, runGatedProgram(page.sdk, 'knife-cycle', { method: 'willow', successes: 30 }, { gate, technique: 'auto' }))).segments);
        };
        expect(await runWith(4)).toEqual(['knife:measured', 'plain:done']);
        expect(await runWith(4.01)).toEqual(['knife:done']);
    });

    test('measured switch-off is in ticks per expected roll: each drop weighted by rollsPerDrop', async () => {
        // 6 ticks per log at a 50% success chance is 3 ticks per expected roll, faster than
        // plain's 4; read per log (rs/130's mix-up) it would look slower and switch off
        const runWith = async (rollsPerDrop?: () => number) => {
            const page = new FakePage(gather({ knife: 6, plain: 4 }));
            const gate = scriptedGate(page, [20]);
            const run = await drive(page, runGatedProgram(page.sdk, 'knife-cycle', { method: 'willow', successes: 30 }, { gate, technique: 'auto', ...(rollsPerDrop ? { rollsPerDrop } : {}) }));
            return { segs: shape(run.segments), gate };
        };
        expect((await runWith(() => 2)).segs).toEqual(['knife:done']);
        const perLog = await runWith();
        expect(perLog.segs).toEqual(['knife:measured', 'plain:done']);
        expect(perLog.gate.history[1]!.measured).toEqual({ knife: 6, plain: 4 });
    });

    test('params may depend on the technique (a knife-only bury is left out of plain runs)', async () => {
        const page = new FakePage(gather({ knife: 6, plain: 4 }));
        const gate = scriptedGate(page, [20]);
        const params = (t: 'knife' | 'plain') => ({ method: 'oak', successes: 30, ...(t === 'knife' ? { bury: '^dragon bones$' } : {}) });
        const run = await drive(page, runGatedProgram(page.sdk, 'knife-cycle', params, { gate, technique: 'auto' }));
        expect(shape(run.segments)).toEqual(['knife:measured', 'plain:done']);
        const [knife, plain] = page.runs();
        expect(knife!.params).toMatchObject({ technique: 'knife', bury: '^dragon bones$', successes: 30 });
        expect(plain!.params.bury).toBeUndefined();
        expect(plain!.params).toMatchObject({ technique: 'plain', successes: 20 });
    });

    test('abort stops the running program and resolves aborted', async () => {
        const ac = new AbortController();
        const page = new FakePage(gather({ knife: 3, plain: 4 }, (_, off) => {
            if (off === 20) ac.abort();
        }));
        const gate = scriptedGate(page, [20]);
        const run = await drive(page, runGatedProgram(page.sdk, 'knife-cycle', { method: 'willow', successes: 100 }, { gate, technique: 'auto', signal: ac.signal }));
        expect(run.ended).toBe('aborted');
        expect(shape(run.segments)).toEqual(['knife:aborted']);
        expect(page.status!.phase).toBe('stopped');
        expect(page.runs()).toHaveLength(1);
    });

    test('a fault is reported as a segment and rethrown', async () => {
        const page = new FakePage(gather({ knife: 3, plain: 4 }, (st, off) => {
            if (off === 7) {
                st.phase = 'fault';
                st.fault = 'no knife in the inventory';
            }
        }));
        const segs: GatedSegment[] = [];
        const p = runGatedProgram(page.sdk, 'knife-cycle', { method: 'willow', successes: 10 }, { gate: scriptedGate(page, [20]), technique: 'auto', onSegment: s => segs.push(s) });
        await expect(drive(page, p)).rejects.toBeInstanceOf(ProgramError);
        expect(shape(segs)).toEqual(['knife:fault']);
    });

    test('forced techniques never probe; knife-mine switches by starter and counts ores', async () => {
        for (const technique of ['plain', 'knife'] as const) {
            const page = new FakePage(gather({ knife: 3, plain: 4 }));
            const run = await drive(page, runGatedProgram(page.sdk, 'knife-mine', { steps: '2604,3235>2605,3235', ores: 12 }, { technique }));
            expect(shape(run.segments)).toEqual([`${technique}:done`]);
            expect(page.starts.map(s => s.name)).toEqual(['knife-mine']);
            expect(page.starts[0]!.params.starter).toBe(technique === 'knife' ? 'knife' : 'none');
            expect(total(run.segments, 'ores')).toBe(12);
        }
    });

    test("'auto' without a gate and an unknown program are refused", async () => {
        const page = new FakePage(() => {});
        await expect(runGatedProgram(page.sdk, 'knife-cycle', { successes: 1 }, { technique: 'auto' })).rejects.toThrow('needs a gate');
        await expect(runGatedProgram(page.sdk, 'agility', { laps: 1 }, { technique: 'plain' })).rejects.toThrow('no technique switch');
    });
});

describe('inPageGate', () => {
    // the page's probe program: done on its first tick with these latencies over 22 ticks at 300 ms
    const probePage = (latencies: number[]) =>
        new FakePage((st, t) => {
            if (st.name !== 'probe') return;
            st.phase = 'done';
            st.endedTick = t;
            st.result = { trials: latencies.length, latencies, lost: 0, ticks: 22, tickMs: Array(22).fill(300) };
        });

    test('probes in the page with 20 trials; 19 of 20 keeps the knife on, 18 turns it off', async () => {
        for (const [onTime, on, status] of [[20, true, 'pass'], [19, true, 'marginal'], [18, false, 'investigate']] as const) {
            const page = probePage([...Array(onTime).fill(1), ...Array(20 - onTime).fill(2)]);
            const gate = inPageGate(page.sdk, { plainTicksPerRoll: 4 });
            expect(await drive(page, gate.probe('start'))).toBe(on);
            expect(page.starts).toEqual([{ name: 'probe', params: { trials: 20, maxWait: 8 }, tick: 1000 }]);
            expect(gate.history[0]!.result!.path).toBe('direct');
            expect(gate.history[0]!.verdict).toMatchObject({ status, passAt: 20, floorAt: 19 });
        }
    });

    test('the trial count is exposed, and the rule scales to it', async () => {
        const page = probePage(Array(10).fill(1));
        const gate = inPageGate(page.sdk, { plainTicksPerRoll: 4, trials: 10 });
        expect(await drive(page, gate.probe('start'))).toBe(true);
        expect(page.starts[0]!.params.trials).toBe(10);
        expect(gate.history[0]!.verdict).toMatchObject({ passAt: 10, floorAt: 10 });
    });

    test('arms the measured switch-off from plainTicksPerRoll', () => {
        const page = probePage([]);
        const gate = inPageGate(page.sdk, { plainTicksPerRoll: 4, measureDrops: 3 });
        gate.on = true;
        gate.drop(100);
        gate.drop(105);
        expect(gate.drop(110)).toBe(true);
        expect(gate.history[0]).toMatchObject({ why: 'measured', measured: { knife: 5, plain: 4 } });
    });
});
