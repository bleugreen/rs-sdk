import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CueWatcher, nameHash, readCue, writeJsonAtomicSync } from '../helpers/altar-cue';
import { boneServer, readBoneStatuses } from '../helpers/bone-giver';
import type { BotWorldState, InventoryItem, TradeItem } from '../../sdk/types';
import { baseState, FakeSdk } from '../lib/fake-sdk';
import type { GatedOptions, GatedRun, GatedSegment, InPageGateOptions, SegmentTechnique } from '../lib/gated-program';
import type { HostGate } from '../lib/hostgate';
import type { ProgramStatus } from '../lib/programs';
import { TickLog } from '../lib/ticks';
import { decideReceiver, newReceiverCtx, type GiveSpec, type ReceiveResult, type SwapResult, type WantSpec } from '../lib/trade';
import { Observation, resolveResume } from '../runner/resume';
import type { StepContext } from '../runner/step';
import {
    BandLedger, bandFor, bandParams, BANDS, BoneCue, CAMELOT_RUNES, erlangB, expectedRolls, FOOTPRINT, freeDirs, handBackSpecs, hitBetween, MEASURE_DROPS, modelTicksPerLog, NORMAL_KEEP, PROBE_DIRS, respawnTicks, routeFrom, ROUTES,
    S07_BONE_CUE, SITES, skill, steps, successChance, summarizeBand, type WoodcuttingOptions
} from './woodcutting';
import { createKnifeCycle, CYCLE_METHODS } from '../../server/webclient/src/bot/programs/knife-cycle';
import type { ProgramAction, ProgramContext } from '../../server/webclient/src/bot/programs/types';
import { bonesParam, buryable } from '../../server/webclient/src/bot/programs/util';

const OAK = SITES.oak.stand;
const WILLOW = SITES.willow.stand;
const LUMBRIDGE = [3222, 3222] as const;
const KIT = ['Rune axe', 'Knife', 'Logs'];

function item(slot: number, name: string, count = 1) {
    return { slot, id: 100 + slot, name, count, optionsWithIndex: [] };
}

function state(o: { level?: number; at?: readonly [number, number]; items?: string[]; worn?: string[]; bones?: number; prayer?: number; tick?: number; fill?: number }): BotWorldState {
    const level = o.level ?? 1;
    const names = [...(o.items ?? KIT), ...Array.from({ length: o.bones ?? 0 }, () => 'Dragon bones'), ...Array.from({ length: o.fill ?? 0 }, () => 'Pot')];
    const at = o.at ?? (level >= 73 ? WILLOW : OAK);
    return baseState({
        tick: o.tick ?? 1000,
        player: { worldX: at[0], worldZ: at[1] } as BotWorldState['player'],
        skills: [
            { name: 'Woodcutting', level, baseLevel: level, experience: 0 },
            { name: 'Fletching', level: 1, baseLevel: 1, experience: 0 },
            { name: 'Prayer', level: o.prayer ?? 1, baseLevel: o.prayer ?? 1, experience: 0 }
        ],
        inventory: names.map((n, i) => item(i, n)),
        equipment: (o.worn ?? []).map((n, i) => item(i, n))
    });
}

function status(p: Partial<ProgramStatus> = {}): ProgramStatus {
    const frames = { n: 0, p50: 0, p90: 0, max: 0, underHalfT: 0, overSevenSixthsT: 0, catchUps: 0, catchUpsLastMinute: 0, catchUpsPerMinute: 0, T: 300, TSource: 'driver' as const };
    return { runId: 1, name: 'knife-cycle', phase: 'running', params: {}, startedTick: 1000, tick: 1000, progressTick: 1000, counters: {}, gauges: {}, marks: {}, packets: 0, deferred: 0, skippedTicks: 0, maxTickMs: 0, frames, publish: frames, react: { n: 0, p50: 0, p90: 0, max: 0 }, loops: { last: 0, p10Last10s: 0, min: 0 }, ...p };
}

const setLevel = (sdk: FakeSdk, level: number, patch: Partial<BotWorldState> = {}) =>
    sdk.push(s => ({ ...patch, skills: s.skills.map(k => (k.name === 'Woodcutting' ? { ...k, level, baseLevel: level } : k)) }));

interface Call {
    params: (t: SegmentTechnique) => Record<string, unknown>;
    opts: GatedOptions;
    signal?: AbortSignal;
}

type Script = (sdk: FakeSdk, call: Call, n: number) => Promise<GatedRun | undefined> | GatedRun | undefined;

/** A scripted gated loop: by default one segment that takes the state to the band's end. */
function harness(start: BotWorldState, opts: Partial<WoodcuttingOptions> = {}, script?: Script, receive?: (sdk: FakeSdk) => ReceiveResult) {
    const sdk = new FakeSdk(start);
    const calls: Call[] = [];
    const gates: Array<{ opts: InPageGateOptions; gate: HostGate }> = [];
    const walks: Array<[number, number, number]> = [];
    const receives: Array<{ partner: string; want: unknown }> = [];
    const lines: string[] = [];
    const runGated = (async (_sdk: unknown, name: string, params: Call['params'], o: GatedOptions): Promise<GatedRun> => {
        expect(name).toBe('knife-cycle');
        const call: Call = { params, opts: o, ...(o.signal ? { signal: o.signal } : {}) };
        calls.push(call);
        const scripted = await script?.(sdk, call, calls.length);
        if (scripted) return scripted;
        const s = sdk.getState()!;
        const technique: SegmentTechnique = o.technique === 'plain' ? 'plain' : 'knife';
        const end = params(technique).untilLevel as number;
        setLevel(sdk, end, { tick: s.tick + 300 });
        const seg: GatedSegment = { technique, reason: 'done', status: status({ runId: calls.length, phase: 'done', startedTick: s.tick, tick: s.tick + 300, endedTick: s.tick + 300, counters: { successes: 60 }, result: { histogram: { 3: 50, 6: 10 } } }) };
        o.onSegment?.(seg);
        return { segments: [seg], ended: 'done' };
    }) as unknown as WoodcuttingOptions['runGated'];
    const makeGate = ((_: unknown, g: InPageGateOptions) => {
        const gate = { history: [], switches: () => '' } as unknown as HostGate;
        gates.push({ opts: g, gate });
        return gate;
    }) as unknown as WoodcuttingOptions['makeGate'];
    const recv = (async (_sdk: unknown, partner: string, o: { want?: unknown }) => {
        receives.push({ partner, want: o.want });
        const r = receive ? receive(sdk) : { ok: true, ticks: 5, received: [] };
        if (r.ok) {
            const s = sdk.getState()!;
            const n = s.inventory.length;
            sdk.push({ tick: s.tick + 5, inventory: [...s.inventory, ...Array.from({ length: 23 }, (_, i) => item(n + i, 'Dragon bones'))] });
        }
        return r;
    }) as unknown as WoodcuttingOptions['receive'];
    const bot = {
        walkTo: async (x: number, z: number, tol: number) => {
            walks.push([x, z, tol]);
            sdk.push({ player: { ...sdk.getState()!.player!, worldX: x, worldZ: z } });
            return { success: true, message: 'ok' };
        }
    };
    const log = TickLog.memory('t');
    const all = steps({ runGated, makeGate, receive: recv, log: l => lines.push(l), ...opts });
    const ctx = { session: { sdk, bot, name: 'cairn_test', sessionId: 1 }, sdk, bot, c: {}, log } as unknown as StepContext<Record<string, never>>;
    const byName = (n: string) => all.find(s => s.name === n)!;
    return { sdk, calls, gates, walks, receives, lines, log, all, ctx, byName };
}

const drops_ = (sdk: FakeSdk): number[] => (sdk.sent as Array<{ method?: string; args?: unknown[] }>).filter(a => a.method === 'sendDropItem').map(a => a.args![0] as number);

const done = (h: ReturnType<typeof harness>, s: BotWorldState) => h.all.filter(st => st.done?.({ state: s, probed: {} }, {})).map(st => st.name);

describe('woodcutting: the tree model (read)', () => {
    test('success per roll with the rune axe matches woodcutting.md: 88% at 1, 57% at oak 15, 56% at willow 73, 68.75% at 99', () => {
        expect(successChance('normal', 1)).toBeCloseTo(225 / 256, 6);
        expect(successChance('normal', 15)).toBe(1);
        expect(successChance('oak', 15)).toBeCloseTo(147 / 256, 6);
        expect(Math.round(successChance('oak', 30) * 100)).toBe(71);
        expect(Math.round(successChance('oak', 45) * 100)).toBe(86);
        expect(successChance('oak', 60)).toBeCloseTo(255 / 256, 6);
        expect(successChance('oak', 61)).toBe(1);
        expect(successChance('willow', 73)).toBeCloseTo(143 / 256, 6);
        expect(Math.round(successChance('willow', 90) * 100)).toBe(64);
        expect(successChance('willow', 99)).toBe(0.6875);
    });

    test('respawn D: 29 with one player and at 23 (rs/147, 13:02), 20 at 1,260, floor 15', () => {
        expect(respawnTicks(1)).toBe(29);
        expect(respawnTicks(23)).toBe(29);
        expect(respawnTicks(1260)).toBe(20);
        expect(respawnTicks(5000)).toBe(15);
    });

    test('ticks per log: the bare lattice is cycle / p (willow 99 knife 4.36), D adds the all-three-down share', () => {
        expect(modelTicksPerLog('willow', 99, 'knife')).toBeCloseTo(3 / 0.6875, 6);
        expect(modelTicksPerLog('willow', 99, 'plain')).toBeCloseTo(4 / 0.6875, 6);
        expect(erlangB(1, 1)).toBeCloseTo(0.5, 9);
        expect(erlangB(2, 2)).toBeCloseTo(0.4, 9);
        const atD29 = modelTicksPerLog('willow', 99, 'knife', 29);
        expect(atD29).toBeCloseTo(4.364 / (1 - erlangB((0.6875 / 3 / 8) * 33, 3)), 2);
        expect(atD29).toBeGreaterThan(modelTicksPerLog('willow', 99, 'knife', 20));
        // normal trees fall on every log: a walking tick each
        expect(modelTicksPerLog('normal', 15)).toBe(5);
    });

    test('expected rolls sum logs / p(level)', () => {
        expect(expectedRolls('oak', { 15: 147, 61: 10 })).toBeCloseTo(256 + 10, 6);
        expect(expectedRolls('willow', new Map([[99, 11]]))).toBeCloseTo(16, 6);
    });
});

describe('woodcutting: bands from state', () => {
    test('the module convention: skill, unique stable names, all logout-safe, bands are milestones with resume', () => {
        const h = harness(state({}));
        expect(skill).toBe('woodcutting');
        expect(h.all.map(s => s.name)).toEqual(['woodcutting:walk-oaks', 'woodcutting:normal-1-15', 'woodcutting:oak-15-73', 'woodcutting:walk-willows', 'woodcutting:willow-73-99']);
        expect(h.all.every(s => s.logoutSafe)).toBe(true);
        expect(h.all.filter(s => s.done).map(s => s.name)).toEqual(BANDS.map(b => b.name));
        expect(h.all.filter(s => s.done).every(s => s.inProgress && s.resume)).toBe(true);
    });

    test('bandFor and done from WC 1, 14, 15, 50, 73 and 99', () => {
        const h = harness(state({}));
        expect([1, 14, 15, 50, 73, 99].map(level => bandFor(state({ level })))).toEqual([
            'woodcutting:normal-1-15', 'woodcutting:normal-1-15', 'woodcutting:oak-15-73', 'woodcutting:oak-15-73', 'woodcutting:willow-73-99', null
        ]);
        expect(done(h, state({ level: 14 }))).toEqual([]);
        expect(done(h, state({ level: 15 }))).toEqual(['woodcutting:normal-1-15']);
        expect(done(h, state({ level: 73 }))).toEqual(['woodcutting:normal-1-15', 'woodcutting:oak-15-73']);
        expect(done(h, state({ level: 99 }))).toEqual(BANDS.map(b => b.name));
    });

    test('to < 99 clips the bands: to=50 ends inside oak, and the willow walk never runs', async () => {
        expect(bandFor(state({ level: 50 }), { to: 50 })).toBeNull();
        expect(bandFor(state({ level: 49 }), { to: '50' })).toBe('woodcutting:oak-15-73');
        const h = harness(state({ level: 40 }), { to: 50 });
        expect(done(h, state({ level: 50 }))).toEqual(BANDS.map(b => b.name));
        await h.byName('woodcutting:oak-15-73').run(h.ctx);
        expect(h.calls[0]!.params('knife').untilLevel).toBe(50);
        await h.byName('woodcutting:walk-willows').run(h.ctx);
        expect(h.walks.filter(w => w[0] === WILLOW[0])).toEqual([]);
    });

    test('a band already passed is a no-op: no program, no gate, no walk', async () => {
        const h = harness(state({ level: 99 }));
        for (const s of h.all) await s.run(h.ctx);
        expect(h.calls).toHaveLength(0);
        expect(h.gates).toHaveLength(0);
        expect(h.walks).toHaveLength(0);
    });

    test('inProgress: in the band, at its stand, at its tree level', () => {
        const h = harness(state({}));
        const ip = (n: string, s: BotWorldState) => h.byName(n).inProgress!({ state: s, probed: {} }, {});
        expect(ip('woodcutting:oak-15-73', state({ level: 40 }))).toBe(true);
        expect(ip('woodcutting:oak-15-73', state({ level: 40, at: LUMBRIDGE }))).toBe(false);
        expect(ip('woodcutting:oak-15-73', state({ level: 10 }))).toBe(false);
        expect(ip('woodcutting:willow-73-99', state({ level: 80 }))).toBe(true);
        expect(ip('woodcutting:willow-73-99', state({ level: 80, at: OAK }))).toBe(false);
    });

    test('resume from game state: in a band at its stand resumes it; away from it the walk comes first', async () => {
        const h = harness(state({}));
        const at = async (s: BotWorldState) => {
            const p = await resolveResume(h.all, new Observation(s), {} as never);
            return `${p.mode} ${p.step}`;
        };
        expect(await at(state({ level: 1, at: LUMBRIDGE }))).toBe('run woodcutting:walk-oaks');
        expect(await at(state({ level: 1 }))).toBe('resume woodcutting:normal-1-15');
        expect(await at(state({ level: 40 }))).toBe('resume woodcutting:oak-15-73');
        // Away from the oaks inside the oak band, no walk sits between the done normal band and
        // the oak band: the walk names the stand, and --from=woodcutting:walk-oaks gets there
        // (the passed normal band is a no-op).
        await expect(at(state({ level: 40, at: LUMBRIDGE }))).rejects.toThrow(/oak-15-73: not within 8 tiles of 2914,3494/);
        expect(await at(state({ level: 73, at: OAK }))).toBe('run woodcutting:walk-willows');
        expect(await at(state({ level: 80, at: OAK }))).toBe('run woodcutting:walk-willows');
        expect(await at(state({ level: 80 }))).toBe('resume woodcutting:willow-73-99');
        expect(await at(state({ level: 99 }))).toBe('finished null');
    });

    test('options from the CLI arrive as strings and are validated', () => {
        expect(() => steps({ to: '99', plainTicksPerRoll: '4.2', bury: 'true', boneGiver: 'giver', boneLoad: '23', prayerTo: '0', hold: '0.15' })).not.toThrow();
        expect(() => steps({ to: 100 })).toThrow(/to/);
        expect(() => steps({ technique: 'fast' as never })).toThrow(/technique/);
        expect(() => steps({ bury: true, to: 15 })).toThrow(/oak or willow/);
        expect(() => steps({ bury: true, technique: 'plain' })).toThrow(/knife/);
        expect(() => steps({ boneGiver: 'giver' })).toThrow(/without bury/);
        expect(() => steps({ plainTicksPerRoll: '0' })).toThrow(/plainTicksPerRoll/);
        expect(() => steps({ sites: JSON.stringify({ willow: { stand: [3058, 3253], trees: [[3057, 3251]] } }) })).not.toThrow();
    });
});

describe('woodcutting: preconditions', () => {
    const pre = (n: string, s: BotWorldState, o: Partial<WoodcuttingOptions> = {}) => harness(s, o).byName(n).preconditions(s, {});

    test('any axe worn or in the pack; the rune axe carried (never wielded) is the plan, others warn', () => {
        expect(pre('woodcutting:oak-15-73', state({ level: 15 }))).toBe(true);
        expect(pre('woodcutting:oak-15-73', state({ level: 15, items: ['Knife', 'Logs'], worn: ['Rune axe'] }))).toBe(true);
        expect(pre('woodcutting:oak-15-73', state({ level: 15, items: ['Knife', 'Logs'] }))).toBe('no axe worn or carried');
        expect(pre('woodcutting:oak-15-73', state({ level: 15, items: ['Rune pickaxe', 'Knife', 'Logs'] }))).toBe('no axe worn or carried');
        const h = harness(state({ level: 15, items: ['Adamant axe', 'Knife', 'Logs'] }));
        expect(h.byName('woodcutting:oak-15-73').preconditions(h.sdk.getState()!, {})).toBe(true);
        expect(h.lines.join('\n')).toMatch(/Adamant axe, not a rune axe .*\+441/);
    });

    test('the tree level: oak 15, willow 30', () => {
        expect(pre('woodcutting:oak-15-73', state({ level: 14 }))).toMatch(/oak trees need 15/);
        expect(pre('woodcutting:willow-73-99', state({ level: 29, at: WILLOW }))).toMatch(/willow trees need 30/);
    });

    test('knife and a normal log only where the knife can run: not on normal trees under auto, not under plain', () => {
        const axeOnly = ['Rune axe'];
        expect(pre('woodcutting:oak-15-73', state({ level: 15, items: axeOnly }))).toMatch(/knife and a normal log/);
        expect(pre('woodcutting:normal-1-15', state({ level: 1, items: axeOnly }))).toBe(true);
        expect(pre('woodcutting:normal-1-15', state({ level: 1, items: axeOnly }), { technique: 'knife' })).toMatch(/knife and a normal log/);
        expect(pre('woodcutting:oak-15-73', state({ level: 15, items: axeOnly }), { technique: 'plain' })).toBe(true);
    });

    test('two free slots and the stand', () => {
        expect(pre('woodcutting:oak-15-73', state({ level: 15, fill: 24 }))).toBe('1 free inventory slots, 2 needed');
        expect(pre('woodcutting:oak-15-73', state({ level: 15, fill: 23 }))).toBe(true);
        expect(pre('woodcutting:oak-15-73', state({ level: 15, at: LUMBRIDGE }))).toMatch(/not within 8 tiles of 2914,3494/);
    });

    test('bury: bones or a giver, and room for a load and the log', () => {
        expect(pre('woodcutting:oak-15-73', state({ level: 15 }), { bury: true })).toMatch(/bones in the pack or a bone giver/);
        expect(pre('woodcutting:oak-15-73', state({ level: 15, bones: 5 }), { bury: true })).toBe(true);
        expect(pre('woodcutting:oak-15-73', state({ level: 15 }), { bury: true, bones: { giver: 'g' } })).toBe(true);
        expect(pre('woodcutting:oak-15-73', state({ level: 15, fill: 2 }), { bury: true, bones: { giver: 'g' } })).toMatch(/no room for a 23-bone load/);
        // the normal band never buries
        expect(pre('woodcutting:normal-1-15', state({ level: 1 }), { bury: true })).toBe(true);
    });

    test('a passed band admits any state', () => {
        expect(pre('woodcutting:oak-15-73', state({ level: 80, items: [], at: LUMBRIDGE }))).toBe(true);
    });
});

describe('woodcutting: program parameters per band and technique', () => {
    test('normal under auto runs plain with no gate; oak and willow get a fresh in-page gate each, at 4 plain ticks per roll', async () => {
        const h = harness(state({ level: 1 }));
        await h.byName('woodcutting:normal-1-15').run(h.ctx);
        expect(h.calls[0]!.opts.technique).toBe('plain');
        expect(h.calls[0]!.opts.gate).toBeUndefined();
        expect(h.gates).toHaveLength(0);
        await h.byName('woodcutting:oak-15-73').run(h.ctx);
        await h.byName('woodcutting:walk-willows').run(h.ctx);
        await h.byName('woodcutting:willow-73-99').run(h.ctx);
        expect(h.gates).toHaveLength(2);
        expect(h.gates.map(g => g.opts.plainTicksPerRoll)).toEqual([4, 4]);
        expect(h.gates.map(g => g.opts.measureDrops)).toEqual([120, 120]);
        expect(h.calls[1]!.opts.gate).toBe(h.gates[0]!.gate);
        expect(h.calls[2]!.opts.gate).toBe(h.gates[1]!.gate);
        expect(h.calls.map(c => c.opts.technique)).toEqual(['plain', 'auto', 'auto']);
    });

    test('forced knife reaches normal trees (the 7.24 acceptance); plainTicksPerRoll is the lab\'s calibration', async () => {
        const h = harness(state({ level: 1 }), { technique: 'knife', plainTicksPerRoll: '4.4' });
        await h.byName('woodcutting:normal-1-15').run(h.ctx);
        expect(h.calls[0]!.opts.technique).toBe('knife');
        const g = harness(state({ level: 15 }), { plainTicksPerRoll: '4.4' });
        await g.byName('woodcutting:oak-15-73').run(g.ctx);
        expect(g.gates[0]!.opts.plainTicksPerRoll).toBe(4.4);
    });

    test('trees are always passed on oak and willow, never on normal; untilLevel is the band end', () => {
        const oak = bandParams({}, 'oak', 73);
        expect(oak('knife')).toMatchObject({ method: 'oak', trees: [[2912, 3491], [2914, 3495], [2915, 3492]], untilLevel: 73, reanchor: 'xp', dismiss: 'now' });
        expect(oak('plain').trees).toEqual(oak('knife').trees);
        expect(bandParams({}, 'willow', 99)('plain')).toMatchObject({ method: 'willow', trees: [[2918, 3405], [2919, 3407], [2921, 3405]] });
        expect(bandParams({}, 'normal', 15)('plain')).not.toHaveProperty('trees');
        expect(bandParams({}, 'normal', 15)('plain').method).toBe('tree');
    });

    test('bury on knife segments only, dropEach on plain only, never bury on normal trees', () => {
        const oak = bandParams({ bury: true }, 'oak', 73);
        expect(oak('knife').bury).toBe(true);
        expect(oak('knife')).not.toHaveProperty('dropEach');
        expect(oak('plain').dropEach).toBe(true);
        expect(oak('plain')).not.toHaveProperty('bury');
        expect(bandParams({ bury: 'dragon bones$' }, 'willow', 99)('knife').bury).toBe('dragon bones$');
        expect(bandParams({ bury: true }, 'normal', 15)('knife')).not.toHaveProperty('bury');
        expect(bandParams({}, 'oak', 73)('knife')).not.toHaveProperty('bury');
        expect(bandParams({ hold: '0.15' }, 'willow', 99)('knife').hold).toBe(0.15);
    });

    test('waitRespawn on oak and willow knife segments only, unless turned off', () => {
        expect(bandParams({}, 'oak', 73)('knife').waitRespawn).toBe(true);
        expect(bandParams({}, 'willow', 99)('knife').waitRespawn).toBe(true);
        expect(bandParams({}, 'willow', 99)('plain')).not.toHaveProperty('waitRespawn');
        expect(bandParams({ technique: 'knife' }, 'normal', 15)('knife')).not.toHaveProperty('waitRespawn');
        expect(bandParams({ waitRespawn: 'false' }, 'willow', 99)('knife')).not.toHaveProperty('waitRespawn');
        expect(() => bandParams({ waitRespawn: 'yes' }, 'willow', 99)).toThrow(/waitRespawn/);
    });

    test('every key a band passes is one knife-cycle declares', () => {
        const declared = new Set<string>(createKnifeCycle.params);
        for (const tree of ['normal', 'oak', 'willow'] as const)
            for (const t of ['knife', 'plain'] as const) {
                const p = bandParams({ bury: tree === 'normal' ? undefined : true }, tree, tree === 'normal' ? 15 : 99)(t);
                expect(Object.keys(p).filter(k => !declared.has(k))).toEqual([]);
                expect(() => createKnifeCycle(p)).not.toThrow();
            }
    });

    test("the gate judges its switch-off over 120 logs; the module's gate options still override it", async () => {
        expect(MEASURE_DROPS).toBe(120);
        const h = harness(state({ level: 15 }), { gate: { measureDrops: 60 } });
        await h.byName('woodcutting:oak-15-73').run(h.ctx);
        expect(h.gates[0]!.opts.measureDrops).toBe(60);
    });

    test('route: taverley is SITES and the default; rimmington passes its own trees and free sides; anything else is refused', async () => {
        expect(ROUTES.taverley).toBe(SITES);
        const R = ROUTES.rimmington;
        expect(bandParams({ route: 'rimmington' }, 'oak', 73)('knife').trees).toEqual([[2981, 3205], [2984, 3206], [2985, 3203]]);
        expect(bandParams({ route: 'rimmington' }, 'willow', 99)('knife').trees).toEqual([[3057, 3251], [3057, 3254], [3059, 3252]]);
        // oak (3x3): W, N and E are trees, S is free; willow (2x2): S, N and E are trees, W is free
        expect(freeDirs(R.oak.stand, R.oak.trees!, FOOTPRINT.oak)).toEqual([[0, -1]]);
        expect(freeDirs(R.willow.stand, R.willow.trees!, FOOTPRINT.willow)).toEqual([[-1, 0]]);
        const h = harness(state({ level: 1, at: LUMBRIDGE }), { route: 'rimmington' });
        await h.byName('woodcutting:walk-oaks').run(h.ctx);
        // no waypoints: straight to the stand
        expect(h.walks).toEqual([[2984, 3205, 0]]);
        await h.byName('woodcutting:normal-1-15').run(h.ctx);
        await h.byName('woodcutting:oak-15-73').run(h.ctx);
        await h.byName('woodcutting:walk-willows').run(h.ctx);
        expect(h.walks.at(-1)).toEqual([3058, 3253, 0]);
        await h.byName('woodcutting:willow-73-99').run(h.ctx);
        expect(h.gates.map(g => g.opts.dirs)).toEqual([[[0, -1]], [[-1, 0]]]);
        // the resolved route is on every band row and the walk's first line, so a fallback to taverley shows
        const bands = h.log.rows.filter(r => (r.meta as { kind?: string } | undefined)?.kind === 'wc-band');
        expect(bands.map(r => [(r.meta as { route: string }).route, (r.meta as { stand: number[] }).stand])).toEqual([
            ['rimmington', [2984, 3205]], ['rimmington', [2984, 3205]], ['rimmington', [3058, 3253]]
        ]);
        expect(h.lines[0]).toMatch(/^woodcutting:walk-oaks: route rimmington, from 3222,3222 to 2984,3205/);
        // sites still lay over the route
        expect(bandParams({ route: 'rimmington', sites: JSON.stringify({ willow: { stand: [1, 2], trees: [[3, 4]] } }) }, 'willow', 99)('knife').trees).toEqual([[3, 4]]);
        expect(() => steps({ route: 'lumbridge' })).toThrow(/route must be taverley or rimmington/);
        expect(() => steps({ lighten: true } as WoodcuttingOptions)).not.toThrow();
    });

    test("freeDirs: the stands' neighbours that no tree footprint covers, in the probe's order", () => {
        // willow (2x2): (2918,3405) covers W, (2919,3407) N, (2921,3405) E; only S is free
        expect(freeDirs(SITES.willow.stand, SITES.willow.trees!, FOOTPRINT.willow)).toEqual([[0, -1]]);
        // oak (3x3): (2912,3491) covers S, (2914,3495) N, (2915,3492) E; only W is free
        expect(freeDirs(SITES.oak.stand, SITES.oak.trees!, FOOTPRINT.oak)).toEqual([[-1, 0]]);
        expect(freeDirs([0, 0], [], 2)).toEqual([...PROBE_DIRS]);
    });

    test("each band's gate probes the stand's free neighbours; probeDirs false leaves the page's default", async () => {
        const h = harness(state({ level: 15 }));
        await h.byName('woodcutting:oak-15-73').run(h.ctx);
        await h.byName('woodcutting:walk-willows').run(h.ctx);
        await h.byName('woodcutting:willow-73-99').run(h.ctx);
        expect(h.gates.map(g => g.opts.dirs)).toEqual([[[-1, 0]], [[0, -1]]]);
        const off = harness(state({ level: 15 }), { probeDirs: 'false' });
        await off.byName('woodcutting:oak-15-73').run(off.ctx);
        expect(off.gates[0]!.opts).not.toHaveProperty('dirs');
    });

    test('each log weighs 1 / p at the level the state shows', async () => {
        const h = harness(state({ level: 15 }));
        await h.byName('woodcutting:oak-15-73').run(h.ctx);
        const rpd = h.calls[0]!.opts.rollsPerDrop!;
        expect(rpd(state({ level: 15 }))).toBeCloseTo(256 / 147, 6);
        expect(rpd(state({ level: 70 }))).toBe(1);
    });

    test('oak and willow chop from the stand itself: one exact walk first', async () => {
        const h = harness(state({ level: 15, at: [2912, 3495] }));
        await h.byName('woodcutting:oak-15-73').run(h.ctx);
        expect(h.walks).toEqual([[2914, 3494, 0]]);
        const n = harness(state({ level: 1, at: [2912, 3495] }));
        await n.byName('woodcutting:normal-1-15').run(n.ctx);
        expect(n.walks).toEqual([]);
    });
});

describe('woodcutting: walks', () => {
    test('from Lumbridge the oak walk takes the approach waypoints, then the stand exactly', async () => {
        const h = harness(state({ level: 1, at: LUMBRIDGE }));
        await h.byName('woodcutting:walk-oaks').run(h.ctx);
        expect(h.walks.map(w => [w[0], w[1]])).toEqual([...SITES.approach.map(t => [t[0], t[1]]), [OAK[0], OAK[1]]]);
        expect(h.walks.at(-1)![2]).toBe(0);
        expect(h.byName('woodcutting:walk-oaks').postconditions(h.sdk.getState()!, {})).toBe(true);
    });

    test('the route skips waypoints behind the player', () => {
        expect(routeFrom([2950, 3420], OAK, SITES.approach)).toEqual([[2935, 3450]]);
        expect(routeFrom([2970, 3390], OAK, SITES.approach)).toEqual([[2965, 3395], [2935, 3450]]);
        expect(routeFrom([2920, 3480], OAK, SITES.approach)).toEqual([]);
    });

    test('walks are no-ops near the goal or when their bands are done; the willow walk only from 73', async () => {
        const h = harness(state({ level: 40 }));
        await h.byName('woodcutting:walk-oaks').run(h.ctx);
        await h.byName('woodcutting:walk-willows').run(h.ctx);
        expect(h.walks).toEqual([]);
        const w = harness(state({ level: 73, at: OAK }));
        await w.byName('woodcutting:walk-oaks').run(w.ctx);
        await w.byName('woodcutting:walk-willows').run(w.ctx);
        expect(w.walks).toEqual([[WILLOW[0], WILLOW[1], 0]]);
    });
});

describe('woodcutting: hits and the hpStop guard', () => {
    const player = (s: BotWorldState, hp: number) => ({ ...s.player!, hp });
    const spider = { index: 7, name: 'Giant spider', combatLevel: 2, x: 2985, z: 3206, hp: 5 } as unknown as BotWorldState['nearbyNpcs'][number];
    const far = { index: 8, name: 'Dark wizard', combatLevel: 7, x: 3040, z: 3240, hp: 12 } as unknown as BotWorldState['nearbyNpcs'][number];

    test('hitBetween: only a fall in hitpoints, naming the NPCs within 2 tiles', () => {
        const s0 = state({ level: 15, at: [2984, 3205] });
        const a = { ...s0, player: player(s0, 10) };
        const b = { ...a, tick: a.tick + 1, player: player(a, 9), nearbyNpcs: [spider, far] };
        expect(hitBetween(a, b)).toEqual({ tick: b.tick, at: [2984, 3205], hpFrom: 10, hpTo: 9, near: ['Giant spider (combat 2) at 2985,3206'] });
        expect(hitBetween(b, { ...b, player: player(b, 10) })).toBeNull();
        expect(hitBetween(null, b)).toBeNull();
    });

    test('every hit in a band is a 0-tick row; without hpStop the band runs on', async () => {
        const s0 = state({ level: 15 });
        const h = harness({ ...s0, player: player(s0, 10) }, {}, (sdk, call) => {
            sdk.push(s => ({ tick: s.tick + 1, player: player(s, 3), nearbyNpcs: [spider] }));
            expect(call.signal?.aborted).toBe(false);
            return undefined;
        });
        await h.byName('woodcutting:oak-15-73').run(h.ctx);
        const hits = h.log.rows.filter(r => r.step === 'woodcutting:hit');
        expect(hits).toHaveLength(1);
        expect(hits[0]!.ticks).toBe(0);
        expect(hits[0]!.meta).toMatchObject({ kind: 'wc-hit', step: 'woodcutting:oak-15-73', hpFrom: 10, hpTo: 3 });
        expect(h.lines.some(l => /hit 10 -> 3 at 2914,3494; beside: no NPC/.test(l))).toBe(true);
    });

    test('hpStop: a hit to the stop aborts the program run, writes the summary, and fails the band', async () => {
        const s0 = state({ level: 15 });
        let aborted = false;
        const h = harness({ ...s0, player: player(s0, 5) }, { hpStop: '4' }, (sdk, call) => {
            sdk.push(s => ({ tick: s.tick + 1, player: player(s, 4), nearbyNpcs: [spider] }));
            aborted = call.signal!.aborted;
            const st = sdk.getState()!;
            const seg: GatedSegment = { technique: 'knife', reason: 'aborted', status: status({ phase: 'stopped', startedTick: st.tick - 1, tick: st.tick, endedTick: st.tick }) };
            call.opts.onSegment?.(seg);
            return { segments: [seg], ended: 'aborted' };
        });
        await expect(h.byName('woodcutting:oak-15-73').run(h.ctx)).rejects.toThrow(/hpStop: hitpoints 4, at or below 4/);
        expect(aborted).toBe(true);
        expect(h.calls).toHaveLength(1);
        const summary = h.log.rows.find(r => r.step === 'woodcutting:oak-15-73:summary')!;
        expect(summary.meta).toMatchObject({ ended: 'aborted', route: 'taverley', hpStop: 4, stoppedBy: { hpTo: 4 } });
        expect(() => steps({ hpStop: '-1' })).toThrow(/hpStop/);
    });

    test('hpStop in a walk: the walk stops and the step fails; later states no longer reach the guard', async () => {
        const s0 = state({ level: 1, at: LUMBRIDGE });
        const h = harness({ ...s0, player: player(s0, 6) }, { hpStop: 4, route: 'rimmington' });
        (h.ctx.bot as unknown as { walkTo: unknown }).walkTo = () => {
            h.sdk.push(s => ({ tick: s.tick + 1, player: player(s, 5) }));
            h.sdk.push(s => ({ tick: s.tick + 1, player: player(s, 4) }));
            return new Promise(() => {});
        };
        await expect(h.byName('woodcutting:walk-oaks').run(h.ctx)).rejects.toThrow(/hpStop: hitpoints 4/);
        h.sdk.push(s => ({ tick: s.tick + 1, player: player(s, 3) }));
        expect(h.log.rows.filter(r => r.step === 'woodcutting:hit').map(r => (r.meta as { hpTo: number }).hpTo)).toEqual([5, 4]);
    });
});

describe('woodcutting: postconditions', () => {
    test('the band end, the axe, and the knife and log where the knife ran', () => {
        const h = harness(state({}));
        const post = (n: string, s: BotWorldState) => h.byName(n).postconditions(s, {});
        expect(post('woodcutting:oak-15-73', state({ level: 72 }))).toMatch(/did not reach 73/);
        expect(post('woodcutting:oak-15-73', state({ level: 73 }))).toBe(true);
        expect(post('woodcutting:oak-15-73', state({ level: 73, items: ['Rune axe'] }))).toMatch(/knife or the last normal log/);
        expect(post('woodcutting:normal-1-15', state({ level: 15, items: ['Rune axe'] }))).toBe(true);
    });

    test('Prayer to 94 only with bury, and only on the last band', () => {
        const plain = harness(state({}));
        expect(plain.byName('woodcutting:willow-73-99').postconditions(state({ level: 99 }), {})).toBe(true);
        const b = harness(state({}), { bury: true, bones: { giver: 'g' } });
        expect(b.byName('woodcutting:willow-73-99').postconditions(state({ level: 99, prayer: 93 }), {})).toBe('Prayer 93, below 94');
        expect(b.byName('woodcutting:willow-73-99').postconditions(state({ level: 99, prayer: 94 }), {})).toBe(true);
        expect(b.byName('woodcutting:oak-15-73').postconditions(state({ level: 73, prayer: 40 }), {})).toBe(true);
        const oakLast = harness(state({}), { bury: true, to: 73, prayerTo: 40 });
        expect(oakLast.byName('woodcutting:oak-15-73').postconditions(state({ level: 73, prayer: 39 }), {})).toBe('Prayer 39, below 40');
        const off = harness(state({}), { bury: true, prayerTo: '0' });
        expect(off.byName('woodcutting:willow-73-99').postconditions(state({ level: 99, prayer: 1 }), {})).toBe(true);
    });
});

describe('woodcutting: bone top-ups (lab path)', () => {
    /** A knife run that buries down to `left` bones, publishing the gauge, until aborted or the band ends. */
    const buryingRun = (bonesAt: number[]): Script => async (sdk, call, n) => {
        const s0 = sdk.getState()!;
        const st = (tick: number, left: number) => status({ runId: n, startedTick: s0.tick, tick, counters: { successes: tick - s0.tick }, gauges: { bonesLeft: left } });
        if (n === 1) {
            let t = s0.tick;
            for (const left of bonesAt) {
                sdk.push({ tick: ++t });
                call.opts.onProgress?.(st(t, left), 'knife');
                if (call.signal?.aborted) break;
            }
            const seg: GatedSegment = { technique: 'knife', reason: 'aborted', status: { ...st(t, 0), phase: 'stopped', endedTick: t } };
            call.opts.onSegment?.(seg);
            return { segments: [seg], ended: call.signal?.aborted ? 'aborted' : 'done' };
        }
        return undefined;
    };

    test('the account takes the load on the last bury cycle\'s roll label, then restarts with the same gate', async () => {
        const h = harness(state({ level: 60, bones: 3 }), { bury: true, bones: { giver: 'cairn_giver' } }, buryingRun([3, 2, 1, 0, 0, 0, 0, 0]));
        await h.byName('woodcutting:oak-15-73').run(h.ctx);
        expect(h.receives).toHaveLength(1);
        expect(h.receives[0]!.partner).toBe('cairn_giver');
        expect(h.receives[0]!.want).toEqual([{ item: /bones$/i, amount: 23 }]);
        expect(h.calls).toHaveLength(2);
        expect(h.calls[0]!.signal!.aborted).toBe(true);
        expect(h.calls[1]!.opts.gate).toBe(h.calls[0]!.opts.gate!);
        expect(h.gates).toHaveLength(1);
        // the abort came 2 ticks after the pack first showed none (1004 -> 1006), not at 2 bones
        const load = h.log.rows.find(r => r.step === 'woodcutting:bones-load')!;
        expect(load.startTick).toBe(1006);
        expect(load.ticks).toBe(0);
        expect(load.meta).toMatchObject({ kind: 'wc-bones-load', load: 1, ticks: 5, received: 23 });
        const summary = h.log.rows.find(r => r.step === 'woodcutting:oak-15-73:summary')!;
        expect(summary.meta).toMatchObject({ kind: 'wc-band', ended: 'done', bonesLoads: 1 });
        expect((summary.meta as { bonesTicks: number }).bonesTicks).toBe(5);
    });

    test('an empty pack takes a load before the first start; a failed load fails the band', async () => {
        const h = harness(state({ level: 60 }), { bury: true, bones: { giver: 'g' } });
        await h.byName('woodcutting:oak-15-73').run(h.ctx);
        expect(h.receives).toHaveLength(1);
        expect(h.calls).toHaveLength(1);
        const f = harness(state({ level: 60 }), { bury: true, bones: { giver: 'g' } }, undefined, () => ({ ok: false, ticks: 0, received: [], reason: 'timeout' }));
        await expect(f.byName('woodcutting:oak-15-73').run(f.ctx)).rejects.toThrow(/bone load 1 from g failed: timeout/);
        expect(f.calls).toHaveLength(0);
    });

    test('without a giver an empty pack never stops the run (the program sends the plain knife bundle)', async () => {
        const h = harness(state({ level: 60, bones: 1 }), { bury: true }, buryingRun([1, 0, 0, 0, 0]));
        await h.byName('woodcutting:oak-15-73').run(h.ctx);
        expect(h.receives).toHaveLength(0);
        expect(h.calls).toHaveLength(1);
    });
});

describe('woodcutting: the band ledger and rs/158\'s table', () => {
    test('ticks and logs by level and technique; lattice gaps fit the success; probes between runs', () => {
        const L = new BandLedger('oak', 990, 59);
        // knife run 1 from 1000 (10 probe ticks before it): logs at 1003, 1006, 1012 (lattice), 1014 (off)
        const k = (tick: number, logs: number) => L.observe(status({ runId: 1, startedTick: 1000, tick, counters: { successes: logs } }), 'knife', tick >= 1006 ? 60 : 59);
        k(1001, 0);
        k(1003, 1);
        k(1006, 2); // level 59 -> 60 shows with this log
        k(1012, 3);
        k(1014, 4);
        L.observe(status({ runId: 1, startedTick: 1000, tick: 1015, endedTick: 1015, phase: 'stopped', counters: { successes: 4 } }), 'knife', 60);
        // plain run 2 from 1020: logs at 1024, 1028, 1036
        const p = (tick: number, logs: number) => L.observe(status({ runId: 2, startedTick: 1020, tick, counters: { successes: logs } }), 'plain', 61);
        p(1024, 1);
        p(1028, 2);
        p(1036, 3);
        L.finish(1040);

        const at59 = L.levels.get(59)!;
        expect(at59.probeTicks).toBe(10);
        expect(at59.knife).toEqual({ ticks: 6, logs: 2, expectedRolls: 2 / successChance('oak', 59), latticeLogs: 1, latticeRolls: 1 });
        const at60 = L.levels.get(60)!;
        // 1006-1015 knife at 60; then 5 probe ticks; then 1020-1024 plain filed at 60 (the level before the log)
        expect(at60.knife.ticks).toBe(9);
        expect(at60.knife.logs).toBe(2);
        expect(at60.knife.latticeLogs).toBe(1); // gap 6 = 2 rolls, 1 success; the 2-tick gap is off the lattice
        expect(at60.knife.latticeRolls).toBe(2);
        expect(at60.probeTicks).toBe(5);
        expect(at60.plain.ticks).toBe(4);
        expect(at60.plain.logs).toBe(1);
        const at61 = L.levels.get(61)!;
        expect(at61.plain).toMatchObject({ ticks: 12, logs: 2, latticeLogs: 2, latticeRolls: 3 });
        expect(at61.probeTicks).toBe(4);

        const sum = summarizeBand(L);
        expect(sum.ticks).toBe(50);
        expect(sum.subBands.map(r => [r.from, r.to, r.ticks])).toEqual([[15, 60, 16], [60, 73, 34]]);
        expect(sum.subBands[1]!.knife!.ticksPerLog).toBe(4.5);
        // 1024 opens its run (no gap); 1028 is 1 roll, 1036 is 2: 2 logs over 3 rolls
        expect(sum.subBands[1]!.plain!.fittedSuccess).toBe(0.667);
        expect(sum.subBands[1]!.plain!.ticksPerExpectedRoll).toBeCloseTo(16 / (1 / successChance('oak', 60) + 2), 2);
        expect(sum.knifeShare).toBeCloseTo(15 / 31, 3);
        expect(sum.knife!.latticeTicksPerLog).toBeCloseTo((3 * sum.knife!.expectedRolls) / 4, 2);
    });

    test('willow splits 73-85 and 85-99; levels outside the splits fold into the end rows', () => {
        const L = new BandLedger('willow', 0, 70);
        const at = (runId: number, start: number, tick: number, logs: number, level: number) => L.observe(status({ runId, startedTick: start, tick, counters: { successes: logs } }), 'knife', level);
        at(1, 0, 3, 1, 84);
        at(1, 0, 6, 2, 85);
        at(1, 0, 9, 3, 99);
        at(1, 0, 12, 4, 99);
        L.finish(12);
        const sum = summarizeBand(L, [{ technique: 'knife', reason: 'done', status: status({ endedTick: 12, startedTick: 0, counters: { successes: 4, phaseResyncs: 1, held: 2 }, result: { histogram: { 3: 3 } }, deferred: 1 }) }]);
        expect(sum.subBands.map(r => [r.from, r.to, r.knife?.logs])).toEqual([[73, 85, 2], [85, 99, 2]]);
        expect(sum.counters).toEqual({ phaseResyncs: 1, held: 2 });
        expect(sum.histogram.knife).toEqual({ 3: 3 });
        expect(sum.deferred).toBe(1);
        expect(sum.knife!.fittedSuccess).toBe(1);
    });

    test('the band run writes one tagged row per segment and one band summary, all 0-tick', async () => {
        const h = harness(state({ level: 15 }));
        await h.byName('woodcutting:oak-15-73').run(h.ctx);
        const rows = h.log.rows.filter(r => r.step.startsWith('woodcutting:oak-15-73:'));
        expect(rows.map(r => [r.step, (r.meta as { kind: string }).kind, r.ticks])).toEqual([
            ['woodcutting:oak-15-73:segment', 'wc-segment', 0],
            ['woodcutting:oak-15-73:summary', 'wc-band', 0]
        ]);
        expect(rows[1]!.meta).toMatchObject({ technique: 'auto', startLevel: 15, endLevel: 73, gate: { history: [], switches: '' } });
    });

    test('a band that ends short throws after writing its summary', async () => {
        const h = harness(state({ level: 15 }), {}, (sdk, call) => {
            const seg: GatedSegment = { technique: 'knife', reason: 'stopped', status: status({ phase: 'stopped', endedTick: 1010 }) };
            call.opts.onSegment?.(seg);
            return { segments: [seg], ended: 'stopped' };
        });
        await expect(h.byName('woodcutting:oak-15-73').run(h.ctx)).rejects.toThrow(/ended stopped at Woodcutting 15/);
        expect(h.log.rows.some(r => r.step === 'woodcutting:oak-15-73:summary' && !r.ok)).toBe(true);
    });
});

// ------------------------------------------------------------------ the slot ledger (rs/319)

/**
 * The normal band's plain loop, the real knife-cycle, against a scripted engine: a click on the
 * live tree rolls r0 ticks later, every roll lands a log in the first free slot and fells the tree
 * (a new one stands), a drop empties its slot. The last roll takes the level to the band's end, so
 * the program ends on that label, as at Woodcutting 15. Returns what the pack holds once the
 * drops already sent have landed.
 */
function normalBand(params: Record<string, unknown>, kit: string[], rolls: number) {
    const m = CYCLE_METHODS.tree!;
    const inv: Array<string | null> = [...kit];
    let tick = 1000;
    let xp = 0;
    let treeId = 1;
    let nextRoll: number | null = null;
    let chopping = false;
    let logs = 0;
    const level = () => (logs >= rolls ? 15 : 1);
    const opts = (o: string[]) => o.map((text, i) => ({ text, opIndex: i + 1 }));
    const snapshot = (): BotWorldState => {
        const s = baseState({ tick, player: { worldX: 2914, worldZ: 3494, level: 0, animId: chopping ? 1 : -1, hp: 10, maxHp: 10 } as BotWorldState['player'] });
        return {
            ...s,
            skills: [{ name: 'Woodcutting', level: level(), baseLevel: level(), experience: xp }, { name: 'Fletching', level: 1, baseLevel: 1, experience: 0 }],
            inventory: inv.flatMap((name, slot) => (name === null ? [] : [{ slot, id: 1000 + slot, name, count: 1, optionsWithIndex: opts(['Use', 'Drop']) }])),
            nearbyLocs: [{ id: treeId, name: 'Tree', x: 2915 + (treeId % 2), z: 3494, level: 0, distance: 1, options: ['Chop down'], optionsWithIndex: opts(['Chop down']) }] as unknown as BotWorldState['nearbyLocs']
        };
    };
    // the page runtime's contract, reduced to what a tick needs: 5 packets a tick, done ends the run
    let phase = 'running' as 'running' | 'done' | 'fault';
    const program = createKnifeCycle({ ...params, technique: 'plain' });
    const step = (state: BotWorldState): ProgramAction[] => {
        const sent: ProgramAction[] = [];
        const ctx: ProgramContext = {
            // the page's state type is the SDK's plus page-only fields knife-cycle does not read
            state: state as unknown as ProgramContext['state'], tick: state.tick, ticksAdvanced: 1, nowMs: 0, wallMs: 0, frames: [],
            get budget() { return 5 - sent.length; },
            send: a => (sent.length < 5 ? (sent.push(a), true) : false),
            count: () => {}, gauge: () => {}, starter: () => {}, mark: () => {}, share: () => {}, progress: () => {}, log: () => {},
            done: () => (phase = 'done'),
            fault: r => {
                phase = 'fault';
                throw new Error(`knife-cycle faulted: ${r}`);
            }
        };
        program.onTick(ctx);
        return sent;
    };
    const pending: Array<{ at: number; type: string; locId?: number; slot?: number }> = [];
    const land = () => {
        for (const p of pending.filter(p => p.at === tick)) {
            if (p.type === 'dropItem' && p.slot !== undefined) {
                inv[p.slot] = null;
                chopping = false; // inventory ops clear the interaction
            }
            if (p.type === 'interactLoc' && p.locId === treeId) {
                chopping = true;
                nextRoll ??= tick + m.r0;
            }
        }
    };
    step(snapshot());
    while (phase === 'running' && tick < 1000 + rolls * 20) {
        tick++;
        land();
        if (chopping && nextRoll === tick) {
            xp += 250;
            logs++;
            const free = inv.indexOf(null);
            if (free >= 0) inv[free] = 'Logs';
            else inv.push('Logs');
            treeId++;
            chopping = false;
            nextRoll = null;
        }
        for (const a of step(snapshot())) pending.push({ at: tick + 1, type: a.type, locId: (a as { locId?: number }).locId, slot: (a as { slot?: number }).slot });
    }
    // whatever was sent on the last labels lands
    for (let i = 0; i < 2; i++) {
        tick++;
        land();
    }
    const held = inv.filter((i): i is string => i !== null);
    return { logs, held, used: held.length, phase };
}

describe('woodcutting: the slot ledger, H4k to H4.x (rs/158 spec 1)', () => {
    test('the normal band passes keepProducts 1 on both techniques; oak and willow never carry it; it is an option', () => {
        expect(NORMAL_KEEP).toBe(1);
        expect(bandParams({}, 'normal', 15)('plain').keepProducts).toBe(1);
        expect(bandParams({ technique: 'knife' }, 'normal', 15)('knife').keepProducts).toBe(1);
        expect(bandParams({}, 'oak', 73)('plain')).not.toHaveProperty('keepProducts');
        expect(bandParams({}, 'willow', 99)('knife')).not.toHaveProperty('keepProducts');
        expect(bandParams({ keepProducts: '3' }, 'normal', 15)('plain').keepProducts).toBe(3);
        expect(() => steps({ keepProducts: -1 })).toThrow(/keepProducts/);
        expect(() => steps({ keepProducts: '1.5' })).toThrow(/keepProducts/);
    });

    test("the band's own knife-cycle from H4k's axe, knife and one log: keepProducts 1 ends on 2 logs, the last landing on the label that ends it (rs/196's lab)", () => {
        const r = normalBand(bandParams({}, 'normal', 15)('plain'), ['Rune axe', 'Knife', 'Logs'], 12);
        expect(r.phase).toBe('done');
        expect(r.logs).toBe(12);
        expect(r.held.sort()).toEqual(['Knife', 'Logs', 'Logs', 'Rune axe']);
        expect(28 - r.used).toBe(24);
    });

    test("knife-cycle's own default (3) is the defect: 4 logs, 22 free against H4.x's 24", () => {
        const { keepProducts: _, ...programDefault } = bandParams({}, 'normal', 15)('plain');
        const r = normalBand(programDefault, ['Rune axe', 'Knife', 'Logs'], 12);
        expect(r.held.filter(n => n === 'Logs')).toHaveLength(4);
        expect(28 - r.used).toBe(22);
    });

    test('H4.x: the oak band drops the logs past 1 at its start, before its walk and its first load: the oaks hold the axe, the knife and 1 log, 25 free', async () => {
        const end = normalBand(bandParams({}, 'normal', 15)('plain'), ['Rune axe', 'Knife', 'Logs'], 12);
        const at15 = state({ level: 15, items: end.held, at: [2913, 3493] });
        const h = harness(at15, { bury: true, bones: { giver: 'cairn_b01' } });
        h.sdk.onSend = (a, sdk) => {
            if (a.method === 'sendDropItem') sdk.push(s => ({ inventory: s.inventory.filter(i => i.slot !== a.args[0]) }));
        };
        const oak = h.byName('woodcutting:oak-15-73');
        // the dropped log counts as free: 24 + 1 against the 23-bone load and its log
        expect(oak.preconditions(at15, {})).toBe(true);
        const order: string[] = [];
        const onSend = h.sdk.onSend;
        h.sdk.onSend = (a, sdk) => (order.push(a.method), onSend(a, sdk));
        const walk = h.ctx.bot.walkTo;
        (h.ctx.bot as { walkTo: typeof walk }).walkTo = (async (...args: Parameters<typeof walk>) => (order.push('walkTo'), walk(...args))) as typeof walk;
        await oak.run(h.ctx);
        expect(order.slice(0, 2)).toEqual(['sendDropItem', 'walkTo']);
        const s = h.sdk.getState()!;
        // the bones load (23) arrived after the drop: the kit is the axe, the knife and the first log
        expect(s.inventory.filter(i => !/bones$/i.test(i.name)).map(i => i.name).sort()).toEqual(['Knife', 'Logs', 'Rune axe']);
        expect(s.inventory.filter(i => /^logs$/i.test(i.name))[0]!.slot).toBe(end.held.indexOf('Logs'));
        expect(h.receives).toHaveLength(1);
        // the ledger's H4.x: 25 free at the load, against 23 bones and the chopped log
        expect(28 - (s.inventory.length - 23)).toBe(25);
    });

    test('a pack already at 1 log drops nothing; keepProducts 3 keeps 3 at the start too', async () => {
        const one = harness(state({ level: 15 }));
        await one.byName('woodcutting:oak-15-73').run(one.ctx);
        expect(drops_(one.sdk)).toEqual([]);
        const four = state({ level: 15, items: ['Rune axe', 'Knife', 'Logs', 'Logs', 'Logs', 'Logs'] });
        const three = harness(four, { keepProducts: 3 });
        await three.byName('woodcutting:oak-15-73').run(three.ctx);
        expect(drops_(three.sdk)).toEqual([5]);
        const willow = harness(state({ level: 80, items: ['Rune axe', 'Knife', 'Logs', 'Logs'] }));
        await willow.byName('woodcutting:willow-73-99').run(willow.ctx);
        expect(drops_(willow.sdk)).toEqual([3]);
    });
});

describe('woodcutting: the slot ledger, the hand-back at S07\'s end to T07-08 (rs/158 spec 2)', () => {
    const AXE_ID = 1359;
    const BONES_ID = 536;
    /** SCORED at Woodcutting 99 after the willows: the axe, the knife, the log, and 3 bones the last load left. */
    const at99 = (o: { bones?: number; worn?: boolean; level?: number; runes?: boolean } = {}): BotWorldState => {
        const s = state({ level: o.level ?? 99, items: [], worn: o.worn ? ['Rune axe'] : [] });
        const inv = [
            ...(o.worn ? [] : [{ name: 'Rune axe', id: AXE_ID }]), { name: 'Knife', id: 946 }, { name: 'Logs', id: 1511 },
            ...Array.from({ length: o.bones ?? 3 }, () => ({ name: 'Dragon bones', id: BONES_ID })),
            ...(o.runes ? [{ name: 'Law rune', id: 563, count: 1 }, { name: 'Air rune', id: 556, count: 5 }] : [])
        ];
        return { ...s, inventory: inv.map((it, slot) => ({ slot, id: it.id, name: it.name, count: (it as { count?: number }).count ?? 1, optionsWithIndex: [] })) };
    };
    /** A swap that applies its own delta: the given ids leave, law 1 and air 5 arrive. */
    const swapHarness = (s: BotWorldState, opts: Partial<WoodcuttingOptions>, ok = true) => {
        const calls: Array<{ partner: string; give: GiveSpec[]; want: WantSpec[]; opts: unknown }> = [];
        const fake = (async (sdk: FakeSdk, partner: string, give: GiveSpec[], want: WantSpec[], o: unknown): Promise<SwapResult> => {
            calls.push({ partner, give, want, opts: o });
            if (!ok) return { ok: false, ticks: 30, openTicks: -1, received: [], gave: [], reason: 'no_response' };
            const st = sdk.getState()!;
            const ids = new Set(give.map(g => g.item));
            const kept = st.inventory.filter(i => !ids.has(i.id));
            // swap() reports the inventory delta by item id
            const gave = [...ids].map(id => {
                const its = st.inventory.filter(i => i.id === id);
                return { slot: -1, id: id as number, name: its[0]!.name, count: its.reduce((n, i) => n + i.count, 0) };
            });
            const received = [{ slot: -1, id: 563, name: 'Law rune', count: 1 }, { slot: -1, id: 556, name: 'Air rune', count: 5 }];
            sdk.push({ tick: st.tick + 6, inventory: [...kept, ...received].map((i, slot) => ({ ...i, slot, optionsWithIndex: [] })) });
            return { ok: true, ticks: 6, openTicks: 1, received, gave };
        }) as unknown as WoodcuttingOptions['swap'];
        const h = harness(s, { swap: fake, ...opts });
        return { ...h, swaps: calls, step: h.byName('woodcutting:hand-back') };
    };

    test('off by default (rehearsals keep their axe); true swaps with the bone giver, a string names the partner', () => {
        expect(harness(state({})).all.map(s => s.name)).not.toContain('woodcutting:hand-back');
        const named = harness(state({}), { handBack: 'cairn_b04' }).all.map(s => s.name);
        expect(named.at(-1)).toBe('woodcutting:hand-back');
        expect(() => steps({ handBack: true })).toThrow(/no(ne| bone giver)|name the partner/);
        expect(() => steps({ handBack: 'true', bury: true, boneGiver: 'cairn_b01' })).not.toThrow();
        expect(() => steps({ handBack: '' })).toThrow(/handBack/);
        expect(() => steps({ handBack: 'false' })).not.toThrow();
    });

    test('T07-08: one swap gives the axe and the bones and takes 1 law and 5 air; the pack is the knife, the log and the two rune stacks', async () => {
        const h = swapHarness(at99(), { bury: true, bones: { giver: 'cairn_b02' }, handBack: true });
        expect(h.step.preconditions(h.sdk.getState()!, {})).toBe(true);
        await h.step.run(h.ctx);
        expect(h.swaps).toHaveLength(1);
        expect(h.swaps[0]!.partner).toBe('cairn_b02');
        expect(h.swaps[0]!.give).toEqual([{ item: AXE_ID }, { item: BONES_ID }]);
        expect(h.swaps[0]!.want).toEqual([...CAMELOT_RUNES]);
        const s = h.sdk.getState()!;
        expect(s.inventory.map(i => `${i.name} x${i.count}`)).toEqual(['Knife x1', 'Logs x1', 'Law rune x1', 'Air rune x5']);
        expect(s.inventory).toHaveLength(4);
        expect(h.step.postconditions(s, {})).toBe(true);
        expect(h.step.done!({ state: s, probed: {} }, {})).toBe(true);
        // T07-08's Camelot teleport spends both stacks: 2 slots, the knife and the log, go on to S08
        const row = h.log.rows.find(r => r.step === 'woodcutting:hand-back')!;
        expect(row.ticks).toBe(0);
        expect(row.meta).toMatchObject({ kind: 'wc-hand-back', ticks: 6, gave: ['Rune axe x1', 'Dragon bones x3'], received: ['Law rune x1', 'Air rune x5'] });
    });

    test('no bones left: the axe alone goes; handBackSpecs offers one spec per item id', () => {
        expect(handBackSpecs(at99({ bones: 0 }), /bones$/i)).toEqual([{ item: AXE_ID }]);
        expect(handBackSpecs(at99({ bones: 5 }), /bones$/i)).toEqual([{ item: AXE_ID }, { item: BONES_ID }]);
    });

    test('preconditions: at to, the axe carried, the slots; done once handed back (a resume skips it)', async () => {
        const h = swapHarness(at99(), { handBack: 'cairn_b02' });
        const pre = (s: BotWorldState) => h.step.preconditions(s, {});
        expect(pre(at99({ level: 98 }))).toMatch(/waits for 99/);
        expect(pre(at99({ worn: true }))).toMatch(/worn axe cannot be traded/);
        const full = at99({ bones: 25 });
        expect(full.inventory).toHaveLength(28);
        expect(pre(full)).toBe(true); // the 26 offered free their slots first
        const done = at99({ bones: 0, runes: true });
        expect(pre({ ...done, inventory: done.inventory.filter(i => i.name !== 'Rune axe') })).toBe(true);
        h.sdk.push({ inventory: done.inventory.filter(i => i.name !== 'Rune axe') });
        await h.step.run(h.ctx);
        expect(h.swaps).toHaveLength(0);
    });

    test('a failed swap fails the step and leaves the axe', async () => {
        const h = swapHarness(at99(), { handBack: 'cairn_b02' }, false);
        await expect(h.step.run(h.ctx)).rejects.toThrow(/swap failed: no_response/);
        expect(h.step.postconditions(h.sdk.getState()!, {})).toMatch(/4 axe or bone slots still held/);
        expect(h.log.rows.find(r => r.step === 'woodcutting:hand-back')!.ok).toBe(false);
    });
});

describe("woodcutting: the axe drop at S07's end, the scored run's 0-tick path (rs/158's ruling)", () => {
    test('off by default; with dropAxe it is the last step, after the hand-back when both are set', () => {
        expect(harness(state({})).all.map(s => s.name)).not.toContain('woodcutting:drop-axe');
        expect(harness(state({}), { dropAxe: 'true' }).all.map(s => s.name).at(-1)).toBe('woodcutting:drop-axe');
        expect(harness(state({}), { dropAxe: true, handBack: 'cairn_h01' }).all.map(s => s.name).slice(-2)).toEqual(['woodcutting:hand-back', 'woodcutting:drop-axe']);
        expect(() => steps({ dropAxe: 'yes' })).toThrow(/dropAxe/);
    });

    test("T07-08: the runes came in the last load; at 99 the axe goes without waiting and the pack is the knife, the log and the runes", async () => {
        const at99 = state({ level: 99, items: ['Rune axe', 'Knife', 'Logs', 'Law rune', 'Air rune'] });
        const h = harness(at99, { dropAxe: true });
        const drop = h.byName('woodcutting:drop-axe');
        expect(drop.preconditions(at99, {})).toBe(true);
        expect(drop.done!({ state: at99, probed: {} }, {})).toBe(false);
        const t0 = h.sdk.getState()!.tick;
        await drop.run(h.ctx);
        expect(h.sdk.getState()!.tick).toBe(t0);
        expect(drops_(h.sdk)).toEqual([0]);
        // sent, not yet published: the postcondition passes without a tick's wait
        expect(drop.postconditions(h.sdk.getState()!, {})).toBe(true);
        const after = { ...at99, inventory: at99.inventory.filter(i => i.slot !== 0) };
        expect(after.inventory.map(i => i.name)).toEqual(['Knife', 'Logs', 'Law rune', 'Air rune']);
        expect(drop.done!({ state: after, probed: {} }, {})).toBe(true);
        expect(drop.preconditions(state({ level: 98 }), {})).toMatch(/waits for 99/);
    });

    test('a worn axe is not dropped; a pack without an axe sends nothing', async () => {
        const h = harness(state({ level: 99, items: ['Knife', 'Logs'], worn: ['Rune axe'] }), { dropAxe: true });
        await h.byName('woodcutting:drop-axe').run(h.ctx);
        expect(drops_(h.sdk)).toEqual([]);
    });
});

describe("woodcutting: S07's last bone load carries T07-08's runes, (load - 2) bones, law 1 and air 5 (rs/329's giver, rs/333)", () => {
    const BONES_ID = 536;
    const LAW_ID = 563;
    const AIR_ID = 556;
    const KIT_IDS: Record<string, number> = { 'Rune axe': 1359, Knife: 946, Logs: 1511 };
    const bones = (n: number): TradeItem[] => Array.from({ length: n }, () => ({ slot: -1, id: BONES_ID, name: 'Dragon bones', count: 1 }));
    const RUNES: TradeItem[] = [{ slot: -1, id: LAW_ID, name: 'Law rune', count: 1 }, { slot: -1, id: AIR_ID, name: 'Air rune', count: 5 }];
    /** The giver's offers: a full load, and the last, 2 bones short to make room for the two rune stacks. */
    const FULL = bones(23);
    const LAST = [...bones(21), ...RUNES];

    /** A pack with real ids (bones share one, so the inventory delta reads by id as the engine's does). */
    const pack = (level: number, names: string[], o: { bones?: number; prayer?: number } = {}): BotWorldState => {
        const s = state({ level, items: [], prayer: o.prayer ?? 94 });
        const items: InventoryItem[] = names.map((name, slot) => ({
            slot, id: KIT_IDS[name] ?? (name === 'Law rune' ? LAW_ID : name === 'Air rune' ? AIR_ID : 2000 + slot), name, count: name === 'Air rune' ? 5 : 1, optionsWithIndex: []
        }));
        const all = [...items, ...bones(o.bones ?? 0).map(b => ({ ...b, optionsWithIndex: [{ text: 'Bury', opIndex: 1 }] }))];
        return { ...s, inventory: all.map((i, slot) => ({ ...i, slot })) };
    };
    const into = (inv: readonly InventoryItem[], items: readonly TradeItem[]): InventoryItem[] => {
        const used = new Set(inv.map(i => i.slot));
        const free = Array.from({ length: 28 }, (_, k) => k).filter(k => !used.has(k));
        return [...inv, ...items.map((it, k) => ({ slot: free[k]!, id: it.id, name: it.name, count: it.count, optionsWithIndex: /bones$/i.test(it.name) ? [{ text: 'Bury', opIndex: 1 }] : [] }))];
    };

    /**
     * receiveFrom's decisions, not a stand-in: lib/trade.ts decideReceiver judges the giver's offer
     * against the `want` the band passes, on the offer screen, on the confirm screen and in the
     * inventory delta. An offer that never satisfies the want ends as receiveFrom's does at maxTicks.
     */
    const giver = (offers: TradeItem[][]) => {
        const wants: WantSpec[][] = [];
        const fn = (async (sdk: FakeSdk, partner: string, o: { want?: WantSpec[]; maxTicks?: number }): Promise<ReceiveResult> => {
            wants.push(o.want!);
            const offer = offers[wants.length - 1]!;
            const s0 = sdk.getState()!;
            let ctx = newReceiverCtx(partner, s0.inventory, o.want);
            const open = (screen: 'offer' | 'confirm') => ({ isOpen: true, screen, partner, myOffer: [], theirOffer: offer, myAccepted: false, partnerAccepted: true });
            for (const screen of ['offer', 'confirm'] as const) {
                const d = decideReceiver(sdk.push(s => ({ tick: s.tick + 1, trade: open(screen) })), ctx);
                ctx = d.next;
                if (d.action === 'decline') return { ok: false, ticks: sdk.getState()!.tick - s0.tick, received: [], reason: d.reason };
                if (d.action !== 'accept') return { ok: false, ticks: o.maxTicks ?? 100, received: [], reason: 'timeout' };
            }
            const closed = { isOpen: false, screen: null, partner: null, myOffer: [], theirOffer: [], myAccepted: false, partnerAccepted: false };
            const d = decideReceiver(sdk.push(s => ({ tick: s.tick + 1, trade: closed, inventory: into(s.inventory, offer) })), ctx);
            if (d.action !== 'done') return { ok: false, ticks: sdk.getState()!.tick - s0.tick, received: [], reason: `trade ended ${d.action}` };
            return { ok: true, ticks: sdk.getState()!.tick - s0.tick, received: d.received };
        }) as unknown as WoodcuttingOptions['receive'];
        return { fn, wants };
    };

    /** Run 1 buries the pack's bones, then publishes none until the band stops it for a load; later runs take the level to the band's end. */
    const buryThenLoad: Script = async (sdk, call, n) => {
        if (n !== 1) return undefined;
        const s0 = sdk.getState()!;
        let t = s0.tick;
        sdk.push(s => ({ tick: ++t, inventory: s.inventory.filter(i => !/bones$/i.test(i.name)) }));
        for (let k = 0; k < 4 && !call.signal?.aborted; k++) {
            sdk.push({ tick: ++t });
            call.opts.onProgress?.(status({ runId: 1, startedTick: s0.tick, tick: t, gauges: { bonesLeft: 0 } }), 'knife');
        }
        const seg: GatedSegment = { technique: 'knife', reason: 'aborted', status: status({ runId: 1, phase: 'stopped', startedTick: s0.tick, tick: t, endedTick: t }) };
        call.opts.onSegment?.(seg);
        return { segments: [seg], ended: call.signal?.aborted ? 'aborted' : 'done' };
    };

    const WILLOWS = 'woodcutting:willow-73-99';
    const scored = { bury: true, bones: { giver: 'cairn_b02', lastLoad: 21 } } satisfies Partial<WoodcuttingOptions>;
    const held = (s: BotWorldState) => s.inventory.map(i => `${i.name} x${i.count}`);

    test('the last receive takes 21 bones, law 1 and air 5 after a full load; the runes ride to the band end, 2 slots left for the chopped log', async () => {
        const g = giver([FULL, LAST]);
        const h = harness(pack(97, KIT), { ...scored, receive: g.fn }, buryThenLoad);
        const band = h.byName(WILLOWS);
        expect(band.preconditions(h.sdk.getState()!, {})).toBe(true);
        await band.run(h.ctx);
        expect(g.wants).toHaveLength(2);
        const loads = h.log.rows.filter(r => r.step === 'woodcutting:bones-load');
        expect(loads.map(r => [r.ok, (r.meta as { received: number }).received])).toEqual([[true, 23], [true, 21]]);
        const s = h.sdk.getState()!;
        expect(held(s).filter(n => !/bones/.test(n))).toEqual(['Rune axe x1', 'Knife x1', 'Logs x1', 'Law rune x1', 'Air rune x5']);
        expect(s.inventory.filter(i => /bones$/i.test(i.name))).toHaveLength(21);
        // the ledger's last load: 25 free at the willows hold 21 bones and the two rune stacks, the chopped log the 24th
        expect(28 - s.inventory.length).toBe(2);
        expect(band.postconditions(s, {})).toBe(true);
    });

    test('a full last load (lastLoad = load, rs/329 b5603795 as read): 23 bones and the runes are received and required, and the precondition reserves the rune slots', async () => {
        const full = { bury: true, bones: { giver: 'cairn_b02', lastLoad: 23 } } satisfies Partial<WoodcuttingOptions>;
        const g = giver([FULL, [...FULL, ...RUNES]]);
        const h = harness(pack(97, KIT), { ...full, receive: g.fn }, buryThenLoad);
        const band = h.byName(WILLOWS);
        await band.run(h.ctx);
        expect(g.wants).toEqual([[{ item: /bones$/i, amount: 23 }], [{ item: /bones$/i, amount: 23 }]]);
        const loads = h.log.rows.filter(r => r.step === 'woodcutting:bones-load');
        expect(loads.map(r => [r.ok, (r.meta as { received: number }).received])).toEqual([[true, 23], [true, 23]]);
        const s = h.sdk.getState()!;
        expect(held(s).filter(n => !/bones/.test(n))).toEqual(['Rune axe x1', 'Knife x1', 'Logs x1', 'Law rune x1', 'Air rune x5']);
        expect(band.postconditions(s, {})).toBe(true);
        expect(band.postconditions(pack(99, KIT), {})).toMatch(/Camelot runes \(1 and 5\) are not held/);
        // but it fills the pack: 25 free at the willows hold 23 bones and the two rune stacks, none left for the chopped log
        expect(28 - s.inventory.length).toBe(0);
        expect(band.preconditions(pack(97, KIT), {})).toBe("25 free slots and 0 bones: no room for a 23-bone load, or the last load's 23 bones and 2 rune stacks, and the log");
        // once the runes are in, that load came: a resume needs no room for another
        expect(band.preconditions(pack(98, [...KIT, 'Law rune', 'Air rune'], { bones: 10 }), {})).toBe(true);
    });

    test("the want is at least lastLoad bones: a full load and the runes' load pass both screens, a shorter one never does", () => {
        const g = giver([]);
        harness(pack(97, KIT), { ...scored, receive: g.fn });
        const want: WantSpec[] = [{ item: /bones$/i, amount: 21 }];
        const verdict = (offer: TradeItem[], screen: 'offer' | 'confirm') => {
            const s = pack(97, KIT);
            return decideReceiver({ ...s, trade: { isOpen: true, screen, partner: 'cairn_b02', myOffer: [], theirOffer: offer, myAccepted: false, partnerAccepted: true } }, newReceiverCtx('cairn_b02', s.inventory, want)).action;
        };
        for (const screen of ['offer', 'confirm'] as const) {
            expect(verdict(FULL, screen)).toBe('accept');
            expect(verdict(LAST, screen)).toBe('accept');
            expect(verdict([...FULL, ...RUNES], screen)).toBe('accept');
        }
        expect(verdict([...bones(20), ...RUNES], 'offer')).toBe('wait');
        expect(verdict([...bones(20), ...RUNES], 'confirm')).toBe('decline');
    });

    test('the want the band passes is that one (the default path, without lastLoad, still asks for the full 23)', async () => {
        const g = giver([LAST]);
        const h = harness(pack(97, KIT), { ...scored, receive: g.fn });
        await h.byName(WILLOWS).run(h.ctx);
        expect(g.wants).toEqual([[{ item: /bones$/i, amount: 21 }]]);
        // the rehearsal's want refuses the shrunken load: the trade waits out its ticks and the band fails
        const r = giver([LAST]);
        const rehearsal = harness(pack(97, KIT), { bury: true, bones: { giver: 'cairn_b02' }, receive: r.fn });
        await expect(rehearsal.byName(WILLOWS).run(rehearsal.ctx)).rejects.toThrow(/bone load 1 from cairn_b02 failed: timeout/);
        expect(r.wants).toEqual([[{ item: /bones$/i, amount: 23 }]]);
    });

    test('the bury precondition counts the rune stacks as used and passes before the last load, on a resume after it, and on T07-08\'s pack (24 free)', () => {
        const pre = (s: BotWorldState, o: Partial<WoodcuttingOptions> = scored) => harness(s, o).byName(WILLOWS).preconditions(s, {});
        // before the last load: 25 free hold 21 bones, the two rune stacks and the chopped log
        expect(pre(pack(97, KIT))).toBe(true);
        // a resume after the last load: the runes are in, 10 bones left; 13 free
        const resumed = pack(98, [...KIT, 'Law rune', 'Air rune'], { bones: 10 });
        expect(28 - resumed.inventory.length).toBe(13);
        expect(pre(resumed)).toBe(true);
        // the runes are used slots: with 22 bones beside them one slot is free, and the log needs it
        expect(pre(pack(98, [...KIT, 'Law rune', 'Air rune'], { bones: 22 }))).toBe('1 free inventory slots, 2 needed');
        // without lastLoad nothing changes: the pack must hold room for a full load as before
        expect(pre(resumed, { bury: true, bones: { giver: 'cairn_b02' } })).toMatch(/no room for a 23-bone load and the log/);
        // T07-08: the axe dropped, the knife, the log and the two rune stacks
        const t0708 = pack(99, ['Knife', 'Logs', 'Law rune', 'Air rune']);
        expect(28 - t0708.inventory.length).toBe(24);
        expect(pre(t0708)).toBe(true);
    });

    test('the runes are still held after the band: its postcondition asks for them, and knife-cycle never buries or drops them', () => {
        const h = harness(pack(99, KIT), scored);
        const post = (s: BotWorldState) => h.byName(WILLOWS).postconditions(s, {});
        expect(post(pack(99, [...KIT, 'Law rune', 'Air rune'], { bones: 3 }))).toBe(true);
        expect(post(pack(99, KIT, { bones: 3 }))).toMatch(/law 0 and air 0: the last load's Camelot runes \(1 and 5\) are not held/);
        // the rehearsal carries no runes and its postcondition never asks
        expect(harness(pack(99, KIT), { bury: true, bones: { giver: 'g' } }).byName(WILLOWS).postconditions(pack(99, KIT), {})).toBe(true);
        // what the band runs: bury selects the bones only, and the willow product is the only drop
        const params = bandParams(scored, 'willow', 99)('knife');
        const s = pack(98, [...KIT, 'Law rune', 'Air rune'], { bones: 21 });
        // the page's state type is the SDK's plus page-only fields buryable does not read
        expect(new Set(buryable(s as unknown as Parameters<typeof buryable>[0], bonesParam(params.bury)!).map(i => i.name))).toEqual(new Set(['Dragon bones']));
        const product = new RegExp(CYCLE_METHODS.willow!.product, 'i');
        expect(s.inventory.filter(i => product.test(i.name))).toEqual([]);
    });

    test('lastLoad is validated: an integer from 1 to the load, flat as boneLastLoad from the CLI', () => {
        expect(() => steps({ bury: 'true', boneGiver: 'g', boneLastLoad: '21' })).not.toThrow();
        expect(() => steps({ bury: true, bones: { giver: 'g', load: 20, lastLoad: 21 } })).toThrow(/last load/);
        expect(() => steps({ bury: true, bones: { giver: 'g', lastLoad: 0 } })).toThrow(/last load/);
        expect(() => steps({ bury: true, boneGiver: 'g', boneLastLoad: '21.5' })).toThrow(/last load/);
        expect(() => steps({ bury: true, boneLastLoad: '21' })).toThrow(/last load without a bone giver/);
    });
});

describe("woodcutting: S07's giver group takes turns (rs/383's b01-b04, bones.group)", () => {
    const GROUP = ['cairn_b01', 'cairn_b02', 'cairn_b03', 'cairn_b04'];
    const OAKS = 'woodcutting:oak-15-73';
    const WILLOWS = 'woodcutting:willow-73-99';
    const newDir = () => mkdtempSync(join(tmpdir(), 'wc-group-'));

    /**
     * A giver's bones-<account>.json as bone-giver.ts publishes it: loaded and waiting since `readyAt`, or away
     * restocking, in the session of the cue it has read (none before the step writes one).
     */
    const publish = (dir: string, account: string, readyAt: number | null) =>
        writeJsonAtomicSync(join(dir, `bones-${account}.json`), { v: 1, account, phase: readyAt === null ? 'restock' : 'waiting', held: readyAt === null ? 0 : 23, n: 23, trades: 0, bounces: 0, tile: null, readyAt, session: readCue(dir)?.session ?? null, ms: Date.now() });

    /**
     * The group as its status files show it. All four start loaded at the site, b02 longest, then b03,
     * b01, b04 (the demo's order). The giver that serves a load goes to the bank; the one away since the
     * load before comes back loaded, newest in line. `lastAt`: that load carries 21 bones and the runes.
     */
    const group = (dir: string, o: { start?: Record<string, number | null>; lastAt?: number } = {}) => {
        const ready: Record<string, number | null> = o.start ?? { cairn_b02: 1, cairn_b03: 2, cairn_b01: 3, cairn_b04: 4 };
        let clock = 10;
        let away: string | null = null;
        const current: Record<string, number | null> = {};
        const pub = (a: string, r: number | null) => {
            current[a] = r;
            publish(dir, a, r);
        };
        for (const a of GROUP) pub(a, ready[a] ?? null);
        const receives: Array<{ partner: string; want: unknown }> = [];
        const fn = (async (sdk: FakeSdk, partner: string, opt: { want?: unknown }): Promise<ReceiveResult> => {
            receives.push({ partner, want: opt.want });
            pub(partner, null);
            if (away) pub(away, ++clock);
            away = partner;
            const last = receives.length === o.lastAt;
            const s = sdk.getState()!;
            const add = [...Array.from({ length: last ? 21 : 23 }, () => 'Dragon bones'), ...(last ? ['Law rune', 'Air rune'] : [])];
            sdk.push({ tick: s.tick + 4, inventory: [...s.inventory, ...add.map((n, k) => item(s.inventory.length + k, n, n === 'Air rune' ? 5 : 1))] });
            return { ok: true, ticks: 4, received: [] };
        }) as unknown as WoodcuttingOptions['receive'];
        /** As each giver does on reading a new cue (bone-giver.ts onCue): republish in its session, while the game ticks on. */
        const follow = (sdk: FakeSdk) => {
            const w = new CueWatcher(dir, S07_BONE_CUE, () => {
                for (const a of GROUP) pub(a, current[a] ?? null);
                sdk.push(st => ({ tick: st.tick + 1 }));
            }, { pollMs: 2, log: () => {} });
            return () => w.close();
        };
        return { fn, receives, publish: pub, follow };
    };

    /** Runs 1..`loads` bury the pack and ask for a load; later runs take the band to its end, with `emptyAfter` publishing no bones left on the way. */
    const buryRuns = (loads: number, emptyAfter = false): Script => async (sdk, call, n) => {
        const s0 = sdk.getState()!;
        let t = s0.tick;
        sdk.push(s => ({ tick: ++t, inventory: s.inventory.filter(i => !/bones$/i.test(i.name)) }));
        for (let k = 0; k < 4 && !call.signal?.aborted && (n <= loads || emptyAfter); k++) {
            sdk.push({ tick: ++t });
            call.opts.onProgress?.(status({ runId: n, startedTick: s0.tick, tick: t, gauges: { bonesLeft: 0 } }), 'knife');
        }
        const aborted = !!call.signal?.aborted;
        if (!aborted) setLevel(sdk, call.params('knife').untilLevel as number, { tick: ++t });
        const seg: GatedSegment = { technique: 'knife', reason: aborted ? 'aborted' : 'done', status: status({ runId: n, phase: aborted ? 'stopped' : 'done', startedTick: s0.tick, tick: t, endedTick: t }) };
        call.opts.onSegment?.(seg);
        if (n > loads && aborted) throw new Error(`run ${n} asked for a load past the script's ${loads}`);
        return { segments: [seg], ended: aborted ? 'aborted' : 'done' };
    };

    const loadRows = (h: ReturnType<typeof harness>) => h.log.rows.filter(r => r.step === 'woodcutting:bones-load');

    /** Ticks pushed every few ms, as a live client publishes them while the band waits on a server. */
    const ticking = (sdk: FakeSdk) => {
        const timer = setInterval(() => sdk.push(s => ({ tick: s.tick + 1 })), 2);
        return () => clearInterval(timer);
    };

    test('options: one giver or a group of two or more distinct names (comma-separated from the CLI); serverWait is the group\'s; handBack true needs one giver', () => {
        expect(steps({ bury: true, boneGroup: 'cairn_b01,cairn_b02,cairn_b03,cairn_b04' })).toHaveLength(steps({ bury: true, bones: { group: GROUP } }).length);
        expect(() => steps({ bury: true, bones: { giver: 'g', group: GROUP } })).toThrow(/one bone giver or a group, not both/);
        expect(() => steps({ bury: true, boneGroup: 'cairn_b01' })).toThrow(/at least two giver names/);
        expect(() => steps({ bury: true, bones: { group: ['cairn_b01', 'Cairn B01'] } })).toThrow(/names a giver twice/);
        expect(() => steps({ bury: true, bones: { giver: 'g', serverWait: 50 } })).toThrow(/serverWait is for a bone group/);
        expect(() => steps({ bury: true, bones: { group: GROUP, serverWait: 0 } })).toThrow(/bad serverWait/);
        expect(() => steps({ bones: { group: GROUP } })).toThrow(/a bone giver without bury/);
        expect(() => steps({ bury: true, bones: { group: GROUP }, handBack: true })).toThrow(/a group has no one giver/);
        expect(() => steps({ bury: true, bones: { group: GROUP, lastLoad: 21 } })).not.toThrow();
    });

    test('eight loads go round the four givers in boneServer order (b02, b03, b01, b04, twice), each wanting a full load; the step writes the S07 bone cue and stops it at the end', async () => {
        const dir = newDir();
        const g = group(dir);
        const h = harness(state({ level: 60 }), { bury: true, to: 70, bones: { group: GROUP }, cueDir: dir, receive: g.fn }, buryRuns(7));
        const unfollow = g.follow(h.sdk);
        try {
            await h.byName(OAKS).run(h.ctx);
        } finally {
            unfollow();
        }
        const order = ['cairn_b02', 'cairn_b03', 'cairn_b01', 'cairn_b04'];
        expect(g.receives.map(r => r.partner)).toEqual([...order, ...order]);
        expect(g.receives.every(r => JSON.stringify(r.want) === JSON.stringify([{ item: /bones$/i, amount: 23 }]))).toBe(true);
        // Load 1 waits the tick its givers take to read the step's new cue (they count only its session); the rest wait none.
        const rows = loadRows(h).map(r => [(r.meta as { giver: string }).giver, (r.meta as { serverWait: number }).serverWait, r.ok]);
        expect(rows.map(([a, , ok]) => [a, ok])).toEqual([...order, ...order].map(a => [a, true]));
        expect(rows[0]![1]).toBeGreaterThanOrEqual(1);
        expect(rows[0]![1]).toBeLessThanOrEqual(2);
        expect(rows.slice(1).every(r => r[1] === 0)).toBe(true);
        const cue = readCue(dir)!;
        expect(cue.scope).toEqual(S07_BONE_CUE);
        expect(cue.receiver.sha256).toBe(nameHash('cairn_test'));
        expect(cue.stop).toBe(true);
    });

    test('one cue session spans both burying bands; only the last band stops it', async () => {
        const dir = newDir();
        const g = group(dir);
        const h = harness(state({ level: 60 }), { bury: true, bones: { group: GROUP }, cueDir: dir, receive: g.fn }, buryRuns(1));
        const unfollow = g.follow(h.sdk);
        await h.byName(OAKS).run(h.ctx);
        const oak = readCue(dir)!;
        expect(oak.stop).toBeUndefined();
        h.sdk.push({ player: { ...h.sdk.getState()!.player!, worldX: SITES.willow.stand[0], worldZ: SITES.willow.stand[1] } });
        await h.byName(WILLOWS).run(h.ctx);
        unfollow();
        const willow = readCue(dir)!;
        expect(willow.session).toBe(oak.session);
        expect(willow.seq).toBeGreaterThan(oak.seq);
        expect(willow.stop).toBe(true);
        expect(g.receives.map(r => r.partner)).toEqual(['cairn_b02', 'cairn_b03', 'cairn_b01']);
    });

    test('while no giver serves (all four away) the load waits on observed ticks, then takes the first giver back', async () => {
        const dir = newDir();
        const g = group(dir, { start: {} });
        const h = harness(state({ level: 60 }), { bury: true, bones: { group: GROUP }, cueDir: dir, receive: g.fn }, buryRuns(0));
        const t0 = h.sdk.getState()!.tick;
        h.sdk.onStateUpdate(s => {
            if (s.tick === t0 + 12) g.publish('cairn_b03', 50);
        });
        const stop = ticking(h.sdk);
        try {
            await h.byName(OAKS).run(h.ctx);
        } finally {
            stop();
        }
        expect(g.receives.map(r => r.partner)).toEqual(['cairn_b03']);
        const row = loadRows(h)[0]!;
        expect(row.meta).toMatchObject({ giver: 'cairn_b03', received: 23 });
        expect((row.meta as { serverWait: number }).serverWait).toBeGreaterThanOrEqual(12);
        expect(row.ticks).toBe(0);
    });

    // rs/147: a giver not running today leaves its bones-<account>.json behind; load 1 must not take it as the group's state.
    const STALE = [
        ['no session (a file from before sessions), loaded and waiting longest', { session: null }, 'cairn_b02'],
        ["another run's session, loaded and waiting longest", { session: 'run-old.S07.bone' }, 'cairn_b02'],
        ["another run's session that has given the group's every load", { session: 'run-old.S07.bone', trades: 42, loads: 42, final: true }, undefined],
    ] as const;
    for (const [what, stale, unfiltered] of STALE) {
        test(`S07 load 1 with a stale giver status present (${what}): the band's awaitBoneServer ignores it and takes the giver that publishes in its cue's session`, async () => {
            const dir = newDir();
            const g = group(dir, { start: {} });
            writeJsonAtomicSync(join(dir, 'bones-cairn_b02.json'), { v: 1, account: 'cairn_b02', phase: 'waiting', held: 23, n: 23, trades: 0, bounces: 0, tile: null, readyAt: 1, ms: Date.now(), ...stale });
            // Read without a session, the stale file decides: it would be load 1's partner, or end the group.
            expect<string | undefined>(boneServer(readBoneStatuses(dir), GROUP, Date.now())).toBe(unfiltered);
            const h = harness(state({ level: 60 }), { bury: true, bones: { group: GROUP }, cueDir: dir, receive: g.fn }, buryRuns(0));
            const t0 = h.sdk.getState()!.tick;
            // b03 reads the step's cue and comes back loaded; b02 never runs, so its file is never rewritten.
            h.sdk.onStateUpdate(s => {
                if (s.tick === t0 + 12) g.publish('cairn_b03', 50);
            });
            const stop = ticking(h.sdk);
            try {
                await h.byName(OAKS).run(h.ctx);
            } finally {
                stop();
            }
            expect(g.receives.map(r => r.partner)).toEqual(['cairn_b03']);
            expect(readBoneStatuses(dir).find(s => s.account === 'cairn_b02')!.session).not.toBe(readCue(dir)!.session);
            const row = loadRows(h)[0]!;
            expect(row.meta).toMatchObject({ load: 1, giver: 'cairn_b03', received: 23 });
            expect((row.meta as { serverWait: number }).serverWait).toBeGreaterThanOrEqual(12);
        });
    }

    test('a load that finds no server within serverWait fails the band with a clear refusal, and no trade is clicked', async () => {
        const dir = newDir();
        const g = group(dir, { start: {} });
        const h = harness(state({ level: 60 }), { bury: true, bones: { group: GROUP, serverWait: 6 }, cueDir: dir, receive: g.fn }, buryRuns(0));
        const stop = ticking(h.sdk);
        try {
            await expect(h.byName(OAKS).run(h.ctx)).rejects.toThrow(
                'woodcutting:oak-15-73: bone load 1 from the group (cairn_b01, cairn_b02, cairn_b03, cairn_b04) failed: no giver of the group served within 6 observed ticks'
            );
        } finally {
            stop();
        }
        expect(g.receives).toHaveLength(0);
        expect(h.calls).toHaveLength(0);
        expect(loadRows(h).map(r => [r.ok, (r.meta as { giver: unknown }).giver])).toEqual([[false, null]]);
        // the cue stays up for a resume: a failed band never stops the group
        expect(readCue(dir)!.stop).toBeUndefined();
    });

    test('one giver is unchanged: the same partner every load, no cue written, the same load row', async () => {
        const dir = newDir();
        const empty = harness(state({ level: 60 }), { bury: true, bones: { giver: 'cairn_giver' }, cueDir: dir });
        await empty.byName(OAKS).run(empty.ctx);
        expect(empty.receives.map(r => r.partner)).toEqual(['cairn_giver']);
        expect(readdirSync(dir)).toEqual([]);
        expect(loadRows(empty)[0]!.meta).toEqual({ kind: 'wc-bones-load', band: OAKS, load: 1, ticks: 5, stepTicks: 5, received: 23 });
    });

    for (const [lastAt, from] of [[3, 'cairn_b01'], [4, 'cairn_b04']] as const) {
        test(`the last load's 21 bones and runes from whichever giver serves it (${from}, load ${lastAt}): the same want every load, then no load after the runes`, async () => {
            const dir = newDir();
            const g = group(dir, { lastAt });
            const h = harness(state({ level: 97, prayer: 94 }), { bury: true, bones: { group: GROUP, lastLoad: 21 }, cueDir: dir, receive: g.fn }, buryRuns(lastAt - 1, true));
            const band = h.byName(WILLOWS);
            expect(band.preconditions(h.sdk.getState()!, {})).toBe(true);
            const unfollow = g.follow(h.sdk);
            try {
                await band.run(h.ctx);
            } finally {
                unfollow();
            }
            expect(g.receives.map(r => r.partner)).toEqual(['cairn_b02', 'cairn_b03', 'cairn_b01', 'cairn_b04'].slice(0, lastAt));
            expect(g.receives.at(-1)!.partner).toBe(from);
            expect(g.receives.every(r => JSON.stringify(r.want) === JSON.stringify([{ item: /bones$/i, amount: 21 }]))).toBe(true);
            // the run after the runes buried its bones and published none left, and the band chopped on to its end
            expect(h.calls).toHaveLength(lastAt);
            expect(h.calls.at(-1)!.signal!.aborted).toBe(false);
            const s = h.sdk.getState()!;
            expect(s.inventory.filter(i => /rune$/i.test(i.name)).map(i => `${i.name} x${i.count}`)).toEqual(['Law rune x1', 'Air rune x5']);
            expect(band.postconditions(s, {})).toBe(true);
            expect(readCue(dir)!.stop).toBe(true);
        });
    }
});

describe('woodcutting: the S07 bone cue session across a resume', () => {
    const s = baseState({ tick: 50 });

    test("a resumed process with the attempt's session carries it on; no session or another one starts its own; another receiver is refused", () => {
        const dir = mkdtempSync(join(tmpdir(), 'wc-bonecue-'));
        new BoneCue(dir, 'run-a.S07.bone').write(s, 'Scored Name');
        const first = readCue(dir)!;
        expect([first.session, first.seq, first.scope]).toEqual(['run-a.S07.bone', 1, S07_BONE_CUE]);
        // A new process of the same attempt: the same session, the next seq, so the givers' load count in it holds.
        new BoneCue(dir, 'run-a.S07.bone').write(s, 'Scored Name');
        expect([readCue(dir)!.session, readCue(dir)!.seq]).toEqual(['run-a.S07.bone', 2]);
        new BoneCue(dir, 'run-b.S07.bone').write(s, 'Scored Name');
        expect([readCue(dir)!.session, readCue(dir)!.seq]).toEqual(['run-b.S07.bone', 1]);
        new BoneCue(dir).write(s, 'Scored Name');
        expect(readCue(dir)!.session).not.toMatch(/S07\.bone$/);
        new BoneCue(dir, 'run-c.S07.bone').write(s, 'Scored Name');
        expect(() => new BoneCue(dir, 'run-c.S07.bone').write(s, 'Someone Else')).toThrow('identity mismatch');
    });

    test('boneSession needs a giver group and a nonempty name, and reaches the cue the steps write', () => {
        expect(() => steps({ bury: true, bones: { giver: 'b01' }, boneSession: 'run-a.S07.bone' })).toThrow('there is no group');
        expect(() => steps({ bury: true, bones: { group: ['b01', 'b02'] }, boneSession: ' ' })).toThrow('nonempty');
        expect(steps({ bury: true, bones: { group: ['b01', 'b02'] }, boneSession: 'run-a.S07.bone' }).length).toBeGreaterThan(0);
    });
});
