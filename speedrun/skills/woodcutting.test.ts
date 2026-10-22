import { describe, expect, test } from 'bun:test';
import type { BotWorldState } from '../../sdk/types';
import { baseState, FakeSdk } from '../lib/fake-sdk';
import type { GatedOptions, GatedRun, GatedSegment, InPageGateOptions, SegmentTechnique } from '../lib/gated-program';
import type { HostGate } from '../lib/hostgate';
import type { ProgramStatus } from '../lib/programs';
import { TickLog } from '../lib/ticks';
import type { ReceiveResult } from '../lib/trade';
import { Observation, resolveResume } from '../runner/resume';
import type { StepContext } from '../runner/step';
import {
    BandLedger, bandFor, bandParams, BANDS, erlangB, expectedRolls, modelTicksPerLog, respawnTicks, routeFrom, SITES, skill, steps, successChance,
    summarizeBand, type WoodcuttingOptions
} from './woodcutting';

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
    const frames = { n: 0, p50: 0, p90: 0, max: 0, under150: 0, over350: 0, catchUps: 0, catchUpsLastMinute: 0, catchUpsPerMinute: 0 };
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
