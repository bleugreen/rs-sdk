import { describe, expect, test } from 'bun:test';
import type { BotWorldState } from '../../sdk/types';
import { baseState, FakeSdk } from '../lib/fake-sdk';
import type { GatedOptions, GatedRun, GatedSegment, InPageGateOptions } from '../lib/gated-program';
import type { HostGate } from '../lib/hostgate';
import type { ProgramStatus } from '../lib/programs';
import { report, TickLog } from '../lib/ticks';
import { xpForLevel } from '../lib/xp';
import { Observation, resolveResume } from '../runner/resume';
import type { Step, StepContext } from '../runner/step';
import {
    bandFor, DRAYNOR, expectedRolls, feathersNeeded, FLY_PARAMS, flyRollsPerCatch, type FishingOptions, NET_METHOD, PLAIN_TICKS_PER_ROLL, RIVER,
    rollYield, skill, steps, summarizeBand, type BandSegment
} from './fishing';

const S22 = 240300; // 9,612 base
const LUMBRIDGE = { x: 3222, z: 3222 };

function item(slot: number, name: string, count = 1) {
    return { slot, id: 100 + slot, name, count, optionsWithIndex: [] };
}

const FLY_KIT = ['Fly fishing rod', 'Knife', 'Logs'];

function state(o: { level?: number; xp?: number; at?: { x: number; z: number }; items?: string[]; feathers?: number; tick?: number }): BotWorldState {
    const xp = o.xp ?? xpForLevel(o.level ?? 1);
    const level = o.level ?? (() => { let l = 1; while (l < 99 && xpForLevel(l + 1) <= xp) l++; return l; })();
    const names = o.items ?? [];
    return baseState({
        tick: o.tick ?? 1000,
        player: { worldX: (o.at ?? RIVER).x, worldZ: (o.at ?? RIVER).z } as BotWorldState['player'],
        skills: [{ name: 'Fishing', level, baseLevel: level, experience: xp }, { name: 'Fletching', level: 1, baseLevel: 1, experience: 0 }],
        inventory: [...names.map((n, i) => item(i, n)), ...(o.feathers ? [item(names.length, 'Feather', o.feathers)] : [])]
    });
}

function status(p: Partial<ProgramStatus> = {}): ProgramStatus {
    const frames = { n: 0, p50: 0, p90: 0, max: 0, under150: 0, over350: 0, catchUps: 0, catchUpsLastMinute: 0, catchUpsPerMinute: 0 };
    return { runId: 1, name: 'knife-cycle', phase: 'done', params: {}, startedTick: 1000, tick: 1100, progressTick: 1100, counters: {}, gauges: {}, packets: 0, deferred: 0, skippedTicks: 0, maxTickMs: 0, frames, publish: frames, react: { n: 0, p50: 0, p90: 0, max: 0 }, loops: { last: 0, p10Last10s: 0, min: 0 }, ...p };
}

interface Call {
    name: string;
    params: Record<string, unknown>;
    opts: GatedOptions;
}

/** A scripted gated loop: records the call, then moves the state to the band's end in one segment. */
function harness(start: BotWorldState, opts: Partial<FishingOptions> = {}, script?: (sdk: FakeSdk, call: Call) => GatedRun | undefined) {
    const sdk = new FakeSdk(start);
    const calls: Call[] = [];
    const gates: Array<{ opts: InPageGateOptions; gate: HostGate }> = [];
    const walks: Array<[number, number]> = [];
    const runGated = (async (_sdk: unknown, name: string, params: Record<string, unknown>, o: GatedOptions): Promise<GatedRun> => {
        const call = { name, params, opts: o };
        calls.push(call);
        const scripted = script?.(sdk, call);
        if (scripted) return scripted;
        const s = sdk.getState()!;
        const f = s.skills.find(k => k.name === 'Fishing')!;
        const toXp = typeof params.untilXp === 'number' ? params.untilXp : xpForLevel(params.untilLevel as number);
        const endLevel = typeof params.untilLevel === 'number' ? params.untilLevel : f.baseLevel;
        sdk.push({ tick: s.tick + 500, skills: [{ ...f, experience: toXp, level: endLevel, baseLevel: endLevel }, ...s.skills.filter(k => k !== f)] });
        const seg: GatedSegment = { technique: o.technique === 'plain' ? 'plain' : 'knife', reason: 'done', status: status({ startedTick: s.tick, tick: s.tick + 500, endedTick: s.tick + 500, counters: { rolls: 100 }, result: { rolls: 100, histogram: { 3: 90, 6: 9 }, moves: 1, moveGaps: [12] } }) };
        o.onSegment?.(seg);
        return { segments: [seg], ended: 'done' };
    }) as unknown as FishingOptions['runGated'];
    const makeGate = ((_: unknown, g: InPageGateOptions) => {
        const gate = { history: [], switches: () => '' } as unknown as HostGate;
        gates.push({ opts: g, gate });
        return gate;
    }) as unknown as FishingOptions['makeGate'];
    const bot = {
        walkTo: async (x: number, z: number) => {
            walks.push([x, z]);
            sdk.push({ player: { ...sdk.getState()!.player!, worldX: x, worldZ: z } });
            return { success: true, message: 'ok' };
        }
    };
    const log = TickLog.memory('t');
    const all = steps({ runGated, makeGate, ...opts });
    const ctx = { session: { sdk, bot, name: 'cairn_test', sessionId: 1 }, sdk, bot, c: {}, log } as unknown as StepContext<Record<string, never>>;
    const byName = (n: string) => all.find(s => s.name === n)!;
    return { sdk, calls, gates, walks, log, all, ctx, byName };
}

describe('fishing: the roll model (fishing.struct, read) against the measured runs', () => {
    test('20-99 expects about the 673-677 catches measured (fishing.md section 2)', () => {
        const e = expectedRolls('fly', xpForLevel(20), xpForLevel(99));
        expect(Math.abs(e.catches - 675) / 675).toBeLessThan(0.02);
        // the plain reference is the measured 4,837 ticks over these rolls
        expect(4837 / e.rolls).toBeCloseTo(PLAIN_TICKS_PER_ROLL, 2);
    });

    test('78-99 expects about the manifest\'s 520 catches; net 1-20 about the 10 measured', () => {
        expect(Math.round(expectedRolls('fly', S22, xpForLevel(99)).catches)).toBe(517);
        expect(Math.round(expectedRolls('net', 0, xpForLevel(20)).catches)).toBe(10);
    });

    test('catch chance per roll matches the read figures (25% at 20 ... 85% at 99)', () => {
        const pct = (l: number) => Math.round(rollYield('fly', l).p * 100);
        expect([20, 30, 50, 70, 90, 99].map(pct)).toEqual([25, 42, 57, 69, 80, 85]);
        // the net: 19% at 1, 26% at 10, 41% at 15 (anchovies rolled first)
        expect([1, 10, 15].map(l => Math.round(rollYield('net', l).p * 100))).toEqual([19, 26, 41]);
        expect(flyRollsPerCatch(state({ level: 99 }))).toBeCloseTo(1 / rollYield('fly', 99).p, 6);
    });

    test('feathers: the 800 kit covers 20-99 and 600 covers S22, each with the 15% margin', () => {
        expect(feathersNeeded(xpForLevel(20), xpForLevel(99))).toBe(783);
        expect(feathersNeeded(S22, xpForLevel(99))).toBe(595);
        expect(feathersNeeded(xpForLevel(99), xpForLevel(99))).toBe(0);
    });
});

describe('fishing: bands from state', () => {
    test('bandFor at levels 1, 19, 20, 78 and 99', () => {
        expect(bandFor(state({ level: 1 }))).toBe('fishing:net-1-20');
        expect(bandFor(state({ level: 19 }))).toBe('fishing:net-1-20');
        expect(bandFor(state({ level: 20 }))).toBe('fishing:fly-20-78');
        expect(bandFor(state({ xp: S22 }))).toBe('fishing:fly-78-99');
        expect(bandFor(state({ xp: S22 - 1 }))).toBe('fishing:fly-20-78');
        expect(bandFor(state({ level: 99 }))).toBeNull();
        expect(bandFor(state({ level: 60 }), { to: 50 })).toBeNull();
    });

    test('the module convention: skill, unique stable names, every step logout-safe, bands are milestones', () => {
        const { all } = harness(state({ level: 1 }));
        expect(skill).toBe('fishing');
        expect(all.map(s => s.name)).toEqual(['fishing:to-draynor', 'fishing:net-1-20', 'fishing:to-river', 'fishing:fly-20-78', 'fishing:fly-78-99']);
        expect(all.every(s => s.logoutSafe)).toBe(true);
        expect(all.filter(s => s.done).map(s => s.name)).toEqual(['fishing:net-1-20', 'fishing:fly-20-78', 'fishing:fly-78-99']);
        expect(all.filter(s => s.done).every(s => s.inProgress && s.resume)).toBe(true);
    });

    test('options from the harness CLI arrive as strings and are validated', () => {
        expect(() => steps({ to: '99', runStartXp: String(S22) })).not.toThrow();
        expect(() => steps({ to: 100 })).toThrow(/to must be/);
        expect(() => steps({ technique: 'fast' as never })).toThrow(/technique/);
        expect(() => steps({ runStartXp: 10 })).toThrow(/runStartXp/);
    });
});

describe('fishing: preconditions', () => {
    const pre = (step: string, s: BotWorldState, opts: Partial<FishingOptions> = {}) => harness(s, opts).byName(step).preconditions(s, {} as never);

    test('a fly band needs the river, level 20, a rod, the band\'s feathers, and a knife and log unless plain', () => {
        const ok = state({ level: 20, items: FLY_KIT, feathers: 800 });
        expect(pre('fishing:fly-20-78', ok)).toBe(true);
        expect(pre('fishing:fly-20-78', state({ level: 20, items: FLY_KIT, feathers: 800, at: LUMBRIDGE }))).toMatch(/not within 8 tiles of 3241,3248/);
        expect(pre('fishing:fly-20-78', state({ level: 20, items: ['Knife', 'Logs'], feathers: 800 }))).toBe('no fly fishing rod');
        expect(pre('fishing:fly-20-78', state({ level: 20, items: ['Fly fishing rod'], feathers: 800 }))).toMatch(/needs a knife and a normal log/);
        expect(pre('fishing:fly-20-78', state({ level: 20, items: ['Fly fishing rod'], feathers: 800 }), { technique: 'plain' })).toBe(true);
        expect(pre('fishing:fly-78-99', state({ xp: S22, items: FLY_KIT, feathers: 500 }))).toBe('500 feathers, 595 needed to reach the band end (Fishing 78)');
        expect(pre('fishing:fly-78-99', state({ xp: S22, items: FLY_KIT, feathers: 600 }))).toBe(true);
    });

    test('the net band needs Draynor, the starter net and a free slot', () => {
        const at = DRAYNOR;
        expect(pre('fishing:net-1-20', state({ level: 1, at, items: ['Small fishing net'] }))).toBe(true);
        expect(pre('fishing:net-1-20', state({ level: 1, at }))).toBe('no small fishing net');
        expect(pre('fishing:net-1-20', state({ level: 1, at, items: ['Small fishing net', ...Array(27).fill('Bread')] }))).toBe('no free inventory slot');
        expect(pre('fishing:net-1-20', state({ level: 1, items: ['Small fishing net'] }))).toMatch(/3088,3229/);
    });

    test('a band already passed has no preconditions: it is a no-op', () => {
        for (const name of ['fishing:net-1-20', 'fishing:fly-20-78', 'fishing:fly-78-99']) expect(pre(name, state({ level: 99, at: LUMBRIDGE }))).toBe(true);
    });
});

describe('fishing: running the bands', () => {
    test('at 99 every step is a no-op: no walk, no program', async () => {
        const h = harness(state({ level: 99, at: LUMBRIDGE }));
        for (const s of h.all) await s.run(h.ctx);
        expect(h.walks).toEqual([]);
        expect(h.calls).toEqual([]);
        for (const s of h.all) expect(s.postconditions(h.sdk.getState()!, {} as never)).toBe(true);
    });

    test('from level 1 at Lumbridge: walk, net, walk, fly to S22, fly to 99, with the parameters per band', async () => {
        const h = harness(state({ level: 1, at: LUMBRIDGE, items: ['Small fishing net', ...FLY_KIT], feathers: 800 }));
        for (const s of h.all) {
            expect(s.preconditions(h.sdk.getState()!, {} as never)).toBe(true);
            await s.run(h.ctx);
            expect(s.postconditions(h.sdk.getState()!, {} as never)).toBe(true);
        }
        expect(h.walks).toEqual([[DRAYNOR.x, DRAYNOR.z], [RIVER.x, RIVER.z]]);
        expect(h.calls.map(c => c.name)).toEqual(['knife-cycle', 'knife-cycle', 'knife-cycle']);
        const [net, fly1, fly2] = h.calls as [Call, Call, Call];
        expect(net.params).toEqual({ method: NET_METHOD, dropEach: true, followSpot: true, untilLevel: 20 });
        expect(net.opts).toMatchObject({ technique: 'plain' });
        expect(net.opts.gate).toBeUndefined();
        expect(net.opts.rollsPerDrop).toBeUndefined();
        expect(fly1.params).toEqual({ ...FLY_PARAMS, untilXp: S22 });
        expect(fly2.params).toEqual({ ...FLY_PARAMS, untilLevel: 99 });
        for (const c of [fly1, fly2]) expect(c.opts).toMatchObject({ technique: 'auto', rollsPerDrop: flyRollsPerCatch });
        // a fresh gate per fly band, each judged against the plain roll cadence
        expect(h.gates).toHaveLength(2);
        expect(fly1.opts.gate).toBe(h.gates[0]!.gate);
        expect(fly2.opts.gate).toBe(h.gates[1]!.gate);
        expect(h.gates.every(g => g.opts.plainTicksPerRoll === PLAIN_TICKS_PER_ROLL)).toBe(true);
    });

    test('a fixed technique gets no gate', async () => {
        const h = harness(state({ xp: S22, items: FLY_KIT, feathers: 600 }), { technique: 'knife' });
        await h.byName('fishing:fly-78-99').run(h.ctx);
        expect(h.gates).toHaveLength(0);
        expect(h.calls[0]!.opts).toMatchObject({ technique: 'knife' });
        expect(h.calls[0]!.opts.gate).toBeUndefined();
    });

    test('each segment and the band summary are logged as 0-tick rows, so the report total is the band\'s own', async () => {
        const h = harness(state({ xp: S22, items: FLY_KIT, feathers: 600 }));
        await h.byName('fishing:fly-78-99').run(h.ctx);
        expect(h.log.rows.map(r => r.step)).toEqual(['fishing:fly-78-99:segment', 'fishing:fly-78-99:summary']);
        expect(h.log.rows.every(r => r.ticks === 0)).toBe(true);
        expect(report(h.log.rows).totalTicks).toBe(0);
        expect(h.log.rows[0]!.meta).toMatchObject({ technique: 'knife', reason: 'done', fromXp: S22, toXp: xpForLevel(99) });
        expect(h.log.rows[1]!.meta).toMatchObject({ ended: 'done', startLevel: 78, endLevel: 99, catches: 100 });
    });

    test('out of feathers: the band stops the program and fails naming the level', async () => {
        const h = harness(state({ xp: S22, items: FLY_KIT, feathers: 600 }), {}, (sdk, call) => {
            const s = sdk.getState()!;
            sdk.push({ inventory: s.inventory.filter(i => i.name !== 'Feather'), skills: s.skills.map(k => (k.name === 'Fishing' ? { ...k, level: 85, baseLevel: 85, experience: xpForLevel(85) } : k)) });
            call.opts.onProgress?.(status({ phase: 'running' }), 'knife');
            expect(call.opts.signal?.aborted).toBe(true);
            return { segments: [], ended: 'aborted' };
        });
        await expect(h.byName('fishing:fly-78-99').run(h.ctx)).rejects.toThrow('out of feathers at Fishing 85');
    });

    test('a completed fletch takes the last log: the band stops the knife loop and finishes plain', async () => {
        const h = harness(state({ xp: S22, items: FLY_KIT, feathers: 600 }), {}, (sdk, call) => {
            if (call.opts.technique === 'plain') return undefined;
            const s = sdk.getState()!;
            sdk.push({ inventory: s.inventory.filter(i => i.name !== 'Logs') });
            call.opts.onProgress?.(status({ phase: 'running' }), 'knife');
            expect(call.opts.signal?.aborted).toBe(true);
            return { segments: [], ended: 'aborted' };
        });
        await h.byName('fishing:fly-78-99').run(h.ctx);
        expect(h.calls.map(c => c.opts.technique)).toEqual(['auto', 'plain']);
        expect(h.calls[1]!.opts.gate).toBeUndefined();
        expect(h.byName('fishing:fly-78-99').postconditions(h.sdk.getState()!, {} as never)).toBe(true);
        expect(h.log.rows.find(r => r.step === 'fishing:fly-78-99:summary')!.meta).toMatchObject({ ended: 'done', kitLost: 'out of logs at Fishing 78' });
    });

    test('a loop that ends without reaching the band end fails the step', async () => {
        const h = harness(state({ xp: S22, items: FLY_KIT, feathers: 600 }), {}, () => ({ segments: [], ended: 'stopped' }));
        await expect(h.byName('fishing:fly-78-99').run(h.ctx)).rejects.toThrow(/ended stopped at Fishing 78/);
    });
});

describe('fishing: resume from game state (runner/resume.ts)', () => {
    const point = async (s: BotWorldState) => {
        const { all } = harness(s);
        const p = await resolveResume(all as Step<Record<string, never>>[], new Observation(s), {} as never);
        return `${p.mode} ${p.step}`;
    };
    const kit = { items: ['Small fishing net', ...FLY_KIT], feathers: 800 };

    test('the walk enters the right step for where the account stands', async () => {
        expect(await point(state({ level: 1, at: LUMBRIDGE, ...kit }))).toBe('run fishing:to-draynor');
        expect(await point(state({ level: 12, at: DRAYNOR, ...kit }))).toBe('resume fishing:net-1-20');
        expect(await point(state({ level: 20, at: DRAYNOR, ...kit }))).toBe('run fishing:to-river');
        expect(await point(state({ level: 50, ...kit }))).toBe('resume fishing:fly-20-78');
        expect(await point(state({ xp: S22, ...kit }))).toBe('resume fishing:fly-78-99');
        expect(await point(state({ level: 50, at: LUMBRIDGE, ...kit }))).toBe('run fishing:to-river');
        expect(await point(state({ level: 99, at: LUMBRIDGE }))).toBe('finished null');
    });
});

describe('fishing: summarizeBand', () => {
    const seg = (technique: 'knife' | 'plain', reason: GatedSegment['reason'], fromXp: number, toXp: number, ticks: number, catches: number, extra: Record<string, unknown> = {}, counters: Record<string, number> = {}): BandSegment => ({
        technique, reason, fromXp, toXp,
        status: status({ startedTick: 1000, endedTick: 1000 + ticks, tick: 1000 + ticks, counters: { rolls: catches, ...counters }, result: { rolls: catches, ...extra } })
    });

    test('ticks per expected roll first, per catch second, per segment, per technique and for the band', () => {
        const mid = xpForLevel(90);
        const end = xpForLevel(99);
        const a = seg('knife', 'probe', S22, mid, 900, 230, { histogram: { 3: 200, 4: 20, 9: 9 }, moves: 1, moveGaps: [14], levelUps: 12 }, { phaseResyncs: 2, slips: 1 });
        const b = seg('plain', 'done', mid, end, 1500, 280, { histogram: { 5: 250, 10: 29 }, levelUps: 9 });
        const s = summarizeBand('fly', [a, b]);
        const ea = expectedRolls('fly', S22, mid).rolls;
        const eb = expectedRolls('fly', mid, end).rolls;
        expect(s.segments[0]!.ticksPerExpectedRoll).toBeCloseTo(900 / ea, 3);
        expect(s.segments[0]!.ticksPerCatch).toBeCloseTo(900 / 230, 3);
        expect(s.segments[1]!.ticksPerExpectedRoll).toBeCloseTo(1500 / eb, 3);
        expect(s.byTechnique.knife!.ticksPerExpectedRoll).toBeCloseTo(900 / ea, 3);
        expect(s.byTechnique.plain!.ticksPerCatch).toBeCloseTo(1500 / 280, 3);
        expect(s.ticks).toBe(2400);
        expect(s.catches).toBe(510);
        expect(s.ticksPerExpectedRoll).toBeCloseTo(2400 / (ea + eb), 2);
        expect(s.histogram).toEqual({ 3: 200, 4: 20, 5: 250, 9: 9, 10: 29 });
        expect(s.gap3Share).toBeCloseTo(200 / 508, 3);
        expect(s.segments[0]!.gap3Share).toBeCloseTo(200 / 229, 3);
        expect(s.medianGap).toBe(5);
        expect(s.moveCosts).toEqual([9]);
        expect(s).toMatchObject({ moves: 1, phaseResyncs: 2, slips: 1, levelUps: 21 });
        expect(s.switches).toEqual(['knife->plain (probe)']);
    });

    test('reads rs/159\'s renamed counter when it lands', () => {
        const renamed: BandSegment = { ...seg('knife', 'done', S22, xpForLevel(99), 2000, 0), status: status({ startedTick: 0, endedTick: 2000, counters: { logs: 517 } }) };
        expect(summarizeBand('fly', [renamed]).catches).toBe(517);
    });
});
