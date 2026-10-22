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
    answerThreat, bandFor, DRAYNOR, expectedRolls, feathersNeeded, FLY_PARAMS, flyRollsPerCatch, type FishingOptions, GUARD_DEFAULTS, type GuardIo, NET_METHOD, PLAIN_TICKS_PER_ROLL, RIVER,
    rollYield, SAFE, skill, steps, summarizeBand, threatOf, type BandSegment
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
    return { runId: 1, name: 'knife-cycle', phase: 'done', params: {}, startedTick: 1000, tick: 1100, progressTick: 1100, counters: {}, gauges: {}, marks: {}, packets: 0, deferred: 0, skippedTicks: 0, maxTickMs: 0, frames, publish: frames, react: { n: 0, p50: 0, p90: 0, max: 0 }, loops: { last: 0, p10Last10s: 0, min: 0 }, ...p };
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
        const seg: GatedSegment = { technique: o.technique === 'plain' ? 'plain' : 'knife', reason: 'done', status: status({ startedTick: s.tick, tick: s.tick + 500, endedTick: s.tick + 500, counters: { successes: 100 }, result: { successes: 100, histogram: { 3: 90, 6: 9 }, moves: 1, moveGaps: [12] } }) };
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
        status: status({ startedTick: 1000, endedTick: 1000 + ticks, tick: 1000 + ticks, counters: { successes: catches, ...counters }, result: { successes: catches, ...extra } })
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

    test('catches are read from knife-cycle\'s successes counter, with no result', () => {
        const bare: BandSegment = { ...seg('knife', 'done', S22, xpForLevel(99), 2000, 0), status: status({ startedTick: 0, endedTick: 2000, counters: { successes: 517 } }) };
        expect(summarizeBand('fly', [bare]).catches).toBe(517);
    });
});

// ------------------------------------------------------------------ spider guard

const SPIDER_INDEX = 412;

function fighter(o: { hp?: number; at?: { x: number; z: number }; spiderAt?: { x: number; z: number }; tick?: number; hits?: Array<{ tick: number; index?: number }>; spiderHp?: number | null; food?: number; inCombat?: boolean }): Partial<BotWorldState> {
    const at = o.at ?? RIVER;
    const sp = o.spiderAt ?? at;
    return {
        tick: o.tick ?? 1000,
        player: { worldX: at.x, worldZ: at.z, hp: o.hp ?? 10, maxHp: 10, isDead: false, lifeId: 1, respawnCount: 0, combat: { inCombat: o.inCombat ?? false, targetIndex: o.inCombat ? SPIDER_INDEX : -1, targetType: o.inCombat ? 'npc' : 'none', lastDamageTick: -1 } } as unknown as BotWorldState['player'],
        combatEvents: (o.hits ?? []).map(h => ({ tick: h.tick, type: 'damage_taken' as const, damage: 1, sourceType: 'npc' as const, sourceIndex: h.index ?? SPIDER_INDEX, targetType: 'player' as const, targetIndex: -1 })),
        nearbyNpcs: [...(o.spiderHp === null ? [] : [{ kind: 'npc', id: 59, index: SPIDER_INDEX, name: 'Giant spider', combatLevel: 2, x: sp.x, z: sp.z, tileX: sp.x, tileZ: sp.z, distance: 1, hp: o.spiderHp ?? 5, maxHp: 5, healthPercent: null, targetIndex: -1, inCombat: true, lastCombatTick: null, animId: -1, spotanimId: -1, optionsWithIndex: [], options: ['Attack'] }]), { kind: 'npc', id: 1, index: 7, name: 'Fishing spot', combatLevel: 0, x: 3239, z: 3242, distance: 2, hp: null, maxHp: null, healthPercent: null, targetIndex: -1, inCombat: false, lastCombatTick: null, animId: -1, spotanimId: -1, optionsWithIndex: [], options: [] }] as BotWorldState['nearbyNpcs'],
        inventory: Array.from({ length: o.food ?? 2 }, (_, i) => ({ slot: i, id: 300 + i, name: i ? 'Bread' : 'Shrimps', count: 1, optionsWithIndex: [{ text: 'Eat', opIndex: 1 }] }))
    };
}

/** A scripted session: each wait advances one tick through `world(tick)`; the calls are recorded. */
function scriptedIo(sdk: FakeSdk, world: (tick: number, s: BotWorldState, io: { attacked: number; ate: number }) => Partial<BotWorldState>) {
    const seen = { attacked: 0, ate: 0, walks: [] as Array<[number, number]> };
    const io: GuardIo = {
        state: () => sdk.getState(),
        wait: async n => {
            for (let i = 0; i < n; i++) sdk.push(s => ({ tick: s.tick + 1, ...world(s.tick + 1, s, seen) }));
        },
        walkTo: async (x, z) => {
            seen.walks.push([x, z]);
            sdk.push(s => ({ tick: s.tick + 5, player: { ...s.player!, worldX: x, worldZ: z } }));
            return true;
        },
        attack: async () => {
            seen.attacked++;
            return true;
        },
        eat: async () => {
            seen.ate++;
            sdk.push(s => ({ player: { ...s.player!, hp: s.player!.hp + 3 }, inventory: s.inventory.slice(1) }));
            return true;
        }
    };
    return { io, seen };
}

describe('fishing: spider guard, the threat', () => {
    const at = (o: Parameters<typeof fighter>[0]) => baseState(fighter(o));

    test('a hit with a spider beside us is answered at or below atHp (8 of 10), not above', () => {
        expect(threatOf(at({ hp: 10 }), 0)).toBeNull();
        expect(threatOf(at({ hp: 9, hits: [{ tick: 990 }] }), 0)).toBeNull();
        expect(threatOf(at({ hp: 8, hits: [{ tick: 990 }, { tick: 995 }] }), 0)).toEqual({ tick: 995, index: SPIDER_INDEX, name: 'Giant spider', hp: 8 });
    });

    test('the attacker is the spider beside us, whatever the event names as its source (the fishing spot, in the lab)', () => {
        expect(threatOf(at({ hp: 7, hits: [{ tick: 990, index: 7 }] }), 0)).toMatchObject({ index: SPIDER_INDEX, name: 'Giant spider' });
        // two tiles away still counts, three does not
        expect(threatOf(at({ hp: 7, spiderAt: { x: RIVER.x + 2, z: RIVER.z - 2 }, hits: [{ tick: 990, index: 7 }] }), 0)).toMatchObject({ name: 'Giant spider' });
        expect(threatOf(at({ hp: 7, spiderAt: { x: RIVER.x, z: RIVER.z - 3 }, hits: [{ tick: 990, index: 7 }] }), 0)).toBeNull();
    });

    test('only hits after `since` count; with no spider beside us only eatAt answers', () => {
        expect(threatOf(at({ hp: 6, hits: [{ tick: 990 }] }), 990)).toBeNull();
        expect(threatOf(at({ hp: 6, spiderHp: null, hits: [{ tick: 990, index: 7 }] }), 0)).toBeNull();
        expect(threatOf(at({ hp: 4, spiderHp: null, hits: [{ tick: 990, index: 7 }] }), 0)).toMatchObject({ name: 'Fishing spot', hp: 4 });
        expect(threatOf(at({ hp: 3, spiderHp: null, hits: [{ tick: 990, index: 99 }] }), 0)).toMatchObject({ name: 'unknown' });
    });

    test('the safe tile is out of both river spiders\' chase: more than maxrange + 1 = 13 from each spawn', () => {
        // and from the south spot tiles (3239, 3241-3244), where a lab ::npcadd spider spawns
        for (const spawn of [{ x: 3243, z: 3236 }, { x: 3245, z: 3232 }, { x: 3240, z: 3242 }]) expect(Math.max(Math.abs(SAFE.x - spawn.x), Math.abs(SAFE.z - spawn.z))).toBeGreaterThan(13);
    });
});

describe('fishing: spider guard, an engagement', () => {
    const threat = { tick: 1000, index: SPIDER_INDEX, name: 'Giant spider', hp: 8 };

    test('flee: it runs to the safe tile and ends when no hit lands for quietTicks and no spider is beside us', async () => {
        const sdk = new FakeSdk(baseState(fighter({ hp: 8, hits: [{ tick: 1000 }] })));
        const { io, seen } = scriptedIo(sdk, () => ({}));
        const ev = await answerThreat(io, threat);
        expect(seen.walks).toEqual([[SAFE.x, SAFE.z]]);
        expect(ev).toMatchObject({ fled: true, fought: false, killed: false, end: 'quiet', ate: 0, hpFrom: 8, hpTo: 8, startTick: 1000, endTick: 1010, ticks: 10 });
        expect(seen.attacked).toBe(0);
    });

    test('a spider that follows is not quiet: once it stands beside us at the safe tile it is fought', async () => {
        const sdk = new FakeSdk(baseState(fighter({ hp: 8, hits: [{ tick: 1000 }] })));
        // it walks 1 tile a tick toward the safe tile and hits once it arrives; it dies to the first attack
        const { io, seen } = scriptedIo(sdk, (t, s, n) => {
            const spider = s.nearbyNpcs.find(m => m.index === SPIDER_INDEX);
            if (!spider) return {};
            if (n.attacked) return { nearbyNpcs: s.nearbyNpcs.filter(m => m.index !== SPIDER_INDEX) };
            const z = Math.min(SAFE.z - 1, spider.tileZ! + 1);
            const there = z === SAFE.z - 1;
            return {
                nearbyNpcs: s.nearbyNpcs.map(m => (m.index === SPIDER_INDEX ? { ...m, x: SAFE.x, tileX: SAFE.x, z, tileZ: z } : m)),
                combatEvents: there ? [...s.combatEvents, { tick: t, type: 'damage_taken', damage: 1, sourceType: 'npc', sourceIndex: 7, targetType: 'player', targetIndex: -1 }] : s.combatEvents
            };
        });
        const ev = await answerThreat(io, threat);
        expect(ev).toMatchObject({ fought: true, killed: true, end: 'killed', attacker: 'Giant spider' });
        expect(seen.attacked).toBe(1);
    });

    test('fight: a spider that still hits at the safe tile is fought to its death, eating at eatAt', async () => {
        const sdk = new FakeSdk(baseState(fighter({ hp: 6, hits: [{ tick: 1000 }] })));
        // it stays beside us and hits 1 every 2 ticks; once attacked it loses 1 hitpoint every 4 ticks
        const { io, seen } = scriptedIo(sdk, (t, s, n) => {
            const spider = s.nearbyNpcs.find(m => m.index === SPIDER_INDEX);
            const hp = spider && n.attacked && t % 4 === 0 ? spider.hp! - 1 : spider?.hp;
            const hit = spider && t % 2 === 0;
            const p = s.player!;
            return {
                player: { ...s.player!, hp: hit ? s.player!.hp - 1 : s.player!.hp, combat: { ...s.player!.combat, inCombat: n.attacked > 0, targetType: 'npc', targetIndex: SPIDER_INDEX } },
                combatEvents: hit ? [...s.combatEvents, { tick: t, type: 'damage_taken', damage: 1, sourceType: 'npc', sourceIndex: SPIDER_INDEX, targetType: 'player', targetIndex: -1 }] : s.combatEvents,
                nearbyNpcs: hp === undefined || (hp ?? 0) <= 0 ? s.nearbyNpcs.filter(m => m.index !== SPIDER_INDEX) : s.nearbyNpcs.map(m => (m.index === SPIDER_INDEX ? { ...m, hp, x: p.worldX, tileX: p.worldX, z: p.worldZ, tileZ: p.worldZ } : m))
            };
        });
        const ev = await answerThreat(io, threat);
        expect(ev).toMatchObject({ fled: true, fought: true, killed: true, end: 'killed' });
        expect(seen.attacked).toBeGreaterThanOrEqual(1);
        expect(seen.ate).toBeGreaterThanOrEqual(1);
        expect(ev.hpTo).toBeGreaterThan(0);
    });

    test('an attacker that is not a spider is fled from, never fought', async () => {
        const sdk = new FakeSdk(baseState(fighter({ hp: 4, hits: [{ tick: 1000, index: 7 }] })));
        const { io, seen } = scriptedIo(sdk, (t, s) => ({ combatEvents: [...s.combatEvents, { tick: t, type: 'damage_taken', damage: 0, sourceType: 'npc', sourceIndex: 7, targetType: 'player', targetIndex: -1 }] }));
        const ev = await answerThreat(io, { ...threat, index: 7, name: 'Dark wizard', hp: 4 }, { ...GUARD_DEFAULTS, maxWait: 10 });
        expect(ev).toMatchObject({ fought: false, end: 'timeout' });
        expect(seen.attacked).toBe(0);
        expect(seen.ate).toBe(1);
    });

    test('a death during the engagement ends it as died', async () => {
        const sdk = new FakeSdk(baseState(fighter({ hp: 2, hits: [{ tick: 1000 }], food: 0 })));
        const { io } = scriptedIo(sdk, (_t, s) => ({ player: { ...s.player!, hp: 0, isDead: true } }));
        expect((await answerThreat(io, threat)).end).toBe('died');
    });
});

describe('fishing: spider guard in the fly bands', () => {
    const start = () => baseState({ ...state({ xp: S22, items: FLY_KIT, feathers: 600 }), ...fighter({}), skills: state({ xp: S22 }).skills, inventory: state({ xp: S22, items: FLY_KIT, feathers: 600 }).inventory });
    const hitOnFirstRun = (sdk: FakeSdk, call: Call): GatedRun | undefined => {
        if ((call as Call & { n?: number }).n) return undefined;
        (call as Call & { n?: number }).n = 1;
        sdk.push(s => ({ tick: s.tick + 1, player: { ...s.player!, hp: 8 }, combatEvents: [{ tick: s.tick + 1, type: 'damage_taken', damage: 1, sourceType: 'npc', sourceIndex: 7, targetType: 'player', targetIndex: -1 }], nearbyNpcs: fighter({}).nearbyNpcs! }));
        call.opts.onProgress?.(status({ phase: 'running' }), 'knife');
        return call.opts.signal?.aborted ? { segments: [], ended: 'aborted' } : undefined;
    };

    test('off by default: a spider hit does not stop the program', async () => {
        let n = 0;
        const h = harness(start(), {}, (sdk, call) => (n++ ? undefined : hitOnFirstRun(sdk, call)));
        await h.byName('fishing:fly-78-99').run(h.ctx);
        expect(h.calls).toHaveLength(1);
        expect(h.log.rows.map(r => r.step)).not.toContain('fishing:fly-78-99:guard');
    });

    test('on: the hit stops the run, the guard answers it, and the band resumes on the same gate', async () => {
        let n = 0;
        const answered: number[] = [];
        const io = (): GuardIo => ({
            state: () => null,
            wait: async () => {},
            walkTo: async () => true,
            attack: async () => true,
            eat: async () => true
        });
        const h = harness(start(), {
            spiderGuard: 'true',
            guardIo: ((ctx: StepContext<Record<string, never>>) => {
                const base = io();
                const sdk = ctx.sdk as unknown as FakeSdk;
                return {
                    ...base,
                    state: () => sdk.getState(),
                    wait: async () => void sdk.push(s => ({ tick: s.tick + 1 })),
                    walkTo: async (x: number, z: number) => {
                        answered.push(sdk.getState()!.tick);
                        sdk.push(s => ({ tick: s.tick + 5, player: { ...s.player!, worldX: x, worldZ: z } }));
                        return true;
                    }
                };
            }) as never
        }, (sdk, call) => (n++ ? undefined : hitOnFirstRun(sdk, call)));
        await h.byName('fishing:fly-78-99').run(h.ctx);
        expect(answered).toHaveLength(1);
        expect(h.calls).toHaveLength(2);
        expect(h.calls[0]!.opts.gate).toBeDefined();
        expect(h.calls[0]!.opts.gate === h.calls[1]!.opts.gate).toBe(true);
        expect(h.gates).toHaveLength(1);
        const guardRow = h.log.rows.find(r => r.step === 'fishing:fly-78-99:guard')!;
        expect(guardRow.ticks).toBe(0);
        expect(guardRow.meta).toMatchObject({ attacker: 'Giant spider', end: 'quiet', fled: true, engagement: 1 });
        expect(h.log.rows.find(r => r.step === 'fishing:fly-78-99:summary')!.meta).toMatchObject({ ended: 'done', guard: { engagements: 1 } });
    });

    test('the net band never runs the guard; guard options from the CLI are validated', () => {
        expect(() => steps({ spiderGuard: 'true', guard: { atHp: '7', eatAt: '3' } })).not.toThrow();
        expect(() => steps({ spiderGuard: 'true', guard: { atHp: 'x' } })).toThrow(/guard.atHp/);
        expect(() => steps({ spiderGuard: 'true', guard: { bogus: 1 } as never })).toThrow(/unknown guard option bogus/);
    });
});
