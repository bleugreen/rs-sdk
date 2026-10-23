import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import type { BotWorldState } from '../../sdk/types';
import { baseState, drive, FakeSdk } from '../lib/fake-sdk';
import { TickLog } from '../lib/ticks';
import { Observation, resolveResume } from '../runner/resume';
import type { Step } from '../runner/step';
import * as m from './mining';

// runGatedProgram is the page's loop; here it records what the band asks of it and levels up.
const gatedCalls: Array<{ name: string; params: Record<string, unknown>; opts: Record<string, unknown> }> = [];
let onGated: (sdk: FakeSdk, params: Record<string, unknown>) => void = () => {};
/** Replaces the whole program for a test that needs the band's abort signal. */
let gatedImpl: ((sdk: FakeSdk, params: Record<string, unknown>, opts: { signal: AbortSignal }) => Promise<{ segments: never[]; ended: string }>) | null = null;
const realDeps = { ...m.deps };
beforeAll(() => {
    m.deps.inPageGate = (() => ({ summary: () => 'fake gate' })) as never;
    m.deps.runGatedProgram = (async (sdk: FakeSdk, name: string, params: Record<string, unknown>, opts: Record<string, unknown>) => {
        gatedCalls.push({ name, params, opts });
        if (gatedImpl) return gatedImpl(sdk, params, opts as { signal: AbortSignal });
        onGated(sdk, params);
        return { segments: [], ended: 'done' };
    }) as never;
});
afterAll(() => Object.assign(m.deps, realDeps));

class MiningSdk extends FakeSdk {
    sendDropItem(slot: number) {
        this.push(s => ({ inventory: s.inventory.filter(i => i.slot !== slot) }));
        return this.sendAction({ method: 'sendDropItem', args: [slot] });
    }
}

/** Each tick that sends drops is followed by one server tick, so dropOres's nextTick resolves with no timer. */
class DropTickSdk extends MiningSdk {
    private due = false;
    override sendDropItem(slot: number) {
        if (!this.due) {
            this.due = true;
            setTimeout(() => {
                this.due = false;
                this.tick();
            }, 0);
        }
        return super.sendDropItem(slot);
    }
}

const item = (name: string, slot: number) => ({ slot, id: 1000 + slot, name, count: 1, optionsWithIndex: [] });
const skills = (level: number) => [{ name: 'Mining', level, baseLevel: level, experience: 0 }];
const rockLocs = (steps: string) =>
    m.parseSteps(steps).map(st => ({ id: 2092, name: 'Rocks', x: st.rock[0], z: st.rock[1], level: 0, distance: 1, options: ['Mine'], optionsWithIndex: [{ text: 'Mine', opIndex: 1 }] }));
const atZoo = (level: number, inv = ['Rune pickaxe', 'Knife', 'Logs']): BotWorldState =>
    baseState({
        skills: skills(level),
        inventory: inv.map(item),
        player: { worldX: 2604, worldZ: 3235, level: 0 } as BotWorldState['player'],
        nearbyLocs: [...rockLocs(m.ROTATIONS.five!.steps), ...rockLocs(m.ROTATIONS.six!.steps)] as unknown as BotWorldState['nearbyLocs'],
    });
const ctxFor = (sdk: FakeSdk) => ({ session: { sdk, bot: {}, name: 'cairn_test', sessionId: 1 }, sdk, bot: {}, c: {}, log: TickLog.memory('t') }) as never;
const obs = (s: BotWorldState) => ({ state: s, probed: {} });

describe('respawn', () => {
    test('player_count.rs2: floor(20 x (4000 - min(players, 2000)) / 4000)', () => {
        expect(m.respawnFor(1)).toBe(19);
        expect(m.respawnFor(23)).toBe(19);
        expect(m.respawnFor(1262)).toBe(13);
        expect(m.respawnFor(1000)).toBe(15);
        expect(m.respawnFor(5000)).toBe(10);
        expect(m.respawnFor(1262, 10)).toBe(6);
    });
    test('scheduled for 150 players fewer: never shorter than the engine', () => {
        for (let p = 0; p <= 2500; p += 37) expect(m.scheduledRespawn(p)).toBeGreaterThanOrEqual(m.respawnFor(p));
        expect(m.scheduledRespawn(1262)).toBe(14);
    });
});

describe('rotations', () => {
    test('every lap: moves of at most 4 tiles, each stand beside its rock', () => {
        for (const [name, r] of Object.entries(m.ROTATIONS)) expect([name, m.lapModel(r.steps, 13).problems]).toEqual([name, []]);
    });
    test('the five-rock lap holds 3 ticks per ore up to D=15, the six-rock up to D=18, and D=19 waits once a lap', () => {
        expect(m.lapModel(m.ROTATIONS.five!.steps, 13).ticksPerOre).toBe(3);
        expect(m.lapModel(m.ROTATIONS.five!.steps, 15).ticksPerOre).toBe(3);
        expect(m.lapModel(m.ROTATIONS.five!.steps, 16).ticksPerOre).toBeGreaterThan(3);
        expect(m.lapModel(m.ROTATIONS.six!.steps, 18).ticksPerOre).toBe(3);
        // measured 3.50 at D=19 (mining.md section 4)
        expect(m.lapModel(m.ROTATIONS.six!.steps, 19)).toMatchObject({ ticksPerOre: 3.5, waits: 1 });
    });
    test('the respawn picks the lap', () => {
        expect([10, 13, 15].map(m.rotationFor)).toEqual(['five', 'five', 'five']);
        expect([16, 18, 19].map(m.rotationFor)).toEqual(['six', 'six', 'six']);
    });
    test('plain reference: measured at D=13 and D=19, linear between', () => {
        expect(m.plainTicksPerOre(13)).toBe(3.61);
        expect(m.plainTicksPerOre(19)).toBe(3.84);
        expect(m.plainTicksPerOre(10)).toBe(3.61);
    });
});

describe('pickaxes', () => {
    const kit = ['Bronze pickaxe', 'Steel pickaxe', 'Mithril pickaxe', 'Adamant pickaxe', 'Rune pickaxe'].map((n, i) => item(n, i));
    test('the engine takes the best pickaxe the level allows (pickaxe_checker.rs2)', () => {
        expect([1, 5, 6, 20, 21, 30, 31, 40, 41, 99].map(l => m.pickaxeRate(kit, l))).toEqual([7, 7, 5, 5, 4, 4, 3, 3, 2, 2]);
        expect(m.pickaxeRate([item('Rune pickaxe', 0)], 30)).toBeNull();
    });
    test('the rate table knife-mine reads', () => {
        expect(m.rateTable(kit)).toEqual([[41, 2], [31, 3], [21, 4], [6, 5], [0, 7]]);
        expect(m.rateTable([item('Rune pickaxe', 0)])).toEqual([[41, 2]]);
    });
    test('iron success (mine.dbrow 96/350)', () => {
        expect(Math.round(m.ironChance(15) * 256)).toBe(133);
        expect(Math.round(m.ironChance(41) * 256)).toBe(199);
        expect(m.ironChance(63)).toBe(1);
    });
});

describe('steps', () => {
    const names = (o?: Record<string, unknown>) => m.steps(o).map(s => s.name);
    test('stable unique names; the run (travel none) keeps only the zoo walk of the travel', () => {
        const all = names();
        expect(new Set(all).size).toBe(all.length);
        expect(all).toEqual(['mining.prep', 'mining.copper', 'mining.travel: Port Sarim', 'mining.travel: ship to Karamja', 'mining.travel: Brimhaven', 'mining.travel: ship to Ardougne', 'mining.travel: zoo', 'mining.iron-15', 'mining.iron-63']);
        expect(names({ travel: 'none' })).toEqual(['mining.prep', 'mining.copper', 'mining.travel: zoo', 'mining.iron-15', 'mining.iron-63']);
    });
    test('every band has done, is logout-safe and is done from its end level on', () => {
        const bands = m.steps().filter(s => s.done);
        expect(bands.map(s => s.name)).toEqual(['mining.copper', 'mining.iron-15', 'mining.iron-63']);
        expect(bands.every(s => s.logoutSafe)).toBe(true);
        const doneAt = (lvl: number) => bands.map(s => s.done!(obs(atZoo(lvl)), {}));
        expect(doneAt(1)).toEqual([false, false, false]);
        expect(doneAt(15)).toEqual([true, false, false]);
        expect(doneAt(41)).toEqual([true, false, false]);
        expect(doneAt(64)).toEqual([true, true, false]);
        expect(doneAt(99)).toEqual([true, true, true]);
    });
    test('`to` caps the bands', () => {
        expect(names({ to: 15, travel: 'none' })).toEqual(['mining.prep', 'mining.copper', 'mining.travel: zoo']);
        expect(names({ to: '40', travel: 'none' })).toContain('mining.iron-15');
        expect(names({ to: 40, travel: 'none' })).not.toContain('mining.iron-63');
    });
    test('the bury seam is not built; bad options throw', () => {
        expect(() => m.steps({ bury: 200 })).toThrow(/not built/);
        expect(() => m.steps({ rotation: 'seven' })).toThrow();
        expect(() => m.steps({ technique: 'fast' as never })).toThrow();
        expect(() => m.steps({ respawn: 'soon' })).toThrow();
    });
    test('regions for the travel legs', () => {
        expect(m.region([3222, 3222])).toBe('mainland');
        expect(m.region([2977, 3246])).toBe('mainland');
        expect(m.region([3027, 3218])).toBe('mainland');
        expect(m.region([2956, 3146])).toBe('karamja');
        expect(m.region([2775, 3228])).toBe('karamja');
        expect(m.region([2683, 3268])).toBe('ardougne');
        expect(m.region([2604, 3235])).toBe('ardougne');
    });
});

describe('prep', () => {
    test('drops only the starter kit, never the pickaxe, knife, logs or coins, up to 4 free slots', async () => {
        const inv = ['Bronze axe', 'Tinderbox', 'Small fishing net', 'Shrimps', 'Bucket', 'Pot', 'Bread', 'Bronze pickaxe', 'Bronze dagger', 'Bronze sword', 'Wooden shield', 'Shortbow', 'Bronze arrow', 'Air rune', 'Mind rune', 'Water rune', 'Earth rune', 'Body rune',
            'Steel pickaxe', 'Mithril pickaxe', 'Adamant pickaxe', 'Rune pickaxe', 'Knife', 'Logs', 'Logs', 'Logs', 'Logs', 'Coins'];
        const sdk = new MiningSdk(baseState({ skills: skills(1), inventory: inv.map(item) }));
        let t = 100;
        const timer = setInterval(() => sdk.tick({ tick: ++t }), 1);
        try {
            await m.steps()[0]!.run(ctxFor(sdk));
        } finally {
            clearInterval(timer);
        }
        const left = sdk.state!.inventory.map(i => i.name);
        expect(left.length).toBe(24);
        for (const keep of ['Bronze pickaxe', 'Rune pickaxe', 'Knife', 'Logs', 'Coins']) expect(left).toContain(keep);
        expect(sdk.sent.every(a => a.method === 'sendDropItem')).toBe(true);
    });
    test('drops nothing at the run (Mining 64)', async () => {
        const sdk = new MiningSdk(baseState({ skills: skills(64), inventory: Array.from({ length: 28 }, (_, i) => item(i ? 'Bread' : 'Rune pickaxe', i)) }));
        await m.steps()[0]!.run(ctxFor(sdk));
        expect(sdk.sent).toEqual([]);
    });
});

describe('iron bands', () => {
    const ironStep = (name: string, o: Record<string, unknown> = {}) => m.steps({ travel: 'none', respawn: 13, technique: 'knife', ...o }).find(s => s.name === name)!;
    const runBand = async (name: string, level: number, inv?: string[], o: Record<string, unknown> = {}) => {
        gatedCalls.length = 0;
        const sdk = new MiningSdk(atZoo(level, inv));
        onGated = (s, params) => s.push({ skills: skills(params.untilLevel as number) });
        const ctx = ctxFor(sdk);
        await ironStep(name, o).run(ctx);
        return { sdk, calls: [...gatedCalls], log: (ctx as unknown as { log: TickLog }).log };
    };
    test('15-63: failed rolls on, the held pickaxes, the chosen lap, rolls per drop from the success chance', async () => {
        const { sdk, calls, log } = await runBand('mining.iron-15', 15, ['Bronze pickaxe', 'Steel pickaxe', 'Mithril pickaxe', 'Adamant pickaxe', 'Rune pickaxe', 'Knife', 'Logs']);
        expect(calls.length).toBe(1);
        expect(calls[0]!.name).toBe('knife-mine');
        expect(calls[0]!.params).toEqual({ steps: m.ROTATIONS.five!.steps, respawn: 13, untilLevel: 63, rate: [[41, 2], [31, 3], [21, 4], [6, 5], [0, 7]], success: 'iron', selfStarter: true });
        expect(typeof calls[0]!.opts.beforeRestart).toBe('function');
        expect(calls[0]!.opts.technique).toBe('knife');
        const rpd = calls[0]!.opts.rollsPerDrop as (s: BotWorldState) => number;
        expect(rpd(atZoo(15))).toBeCloseTo(256 / 133, 6);
        expect(m.miningLevel(sdk.state)).toBe(63);
        expect(log.rows.some(r => r.step === '(band) mining.iron-15' && r.kind === 'program')).toBe(true);
    });
    test('63-99 (the run band) never sets success', async () => {
        const { calls } = await runBand('mining.iron-63', 64);
        expect(calls.length).toBe(1);
        expect(calls[0]!.params.success).toBeUndefined();
        expect(calls[0]!.params).toMatchObject({ untilLevel: 99, respawn: 13, rate: [[41, 2]] });
        expect(calls[0]!.opts.rollsPerDrop).toBeUndefined();
    });
    test('respawn 19 runs the six-rock lap', async () => {
        const { calls } = await runBand('mining.iron-63', 70, undefined, { respawn: 19 });
        expect(calls[0]!.params.steps).toBe(m.ROTATIONS.six!.steps);
    });
    test('without logs the band goes plain', async () => {
        const { calls } = await runBand('mining.iron-63', 70, ['Rune pickaxe', 'Knife']);
        expect(calls[0]!.opts.technique).toBe('plain');
    });
    test('auto: one gate with the explicit measured window and the plain reference at D', async () => {
        const gateOpts: Array<Record<string, unknown>> = [];
        const fake = m.deps.inPageGate;
        m.deps.inPageGate = ((_: unknown, o: Record<string, unknown>) => (gateOpts.push(o), { summary: () => 'fake gate' })) as never;
        try {
            const { calls } = await runBand('mining.iron-63', 70, undefined, { technique: 'auto' });
            expect(calls[0]!.opts.technique).toBe('auto');
        } finally {
            m.deps.inPageGate = fake;
        }
        expect(gateOpts.length).toBe(1);
        expect(gateOpts[0]).toMatchObject({ plainTicksPerRoll: 3.61, measureDrops: 120 });
        expect(m.GATE_MEASURE_DROPS).toBe(120);
    });
    test('a restart drops the ores an interrupted run left before starting, and logs them', async () => {
        gatedCalls.length = 0;
        const inv = ['Rune pickaxe', 'Knife', 'Logs', 'Iron ore', 'Iron ore', 'Bread', 'Iron ore', 'Iron ore', 'Iron ore', 'Iron ore'];
        const sdk = new MiningSdk(atZoo(92, inv));
        let left: string[] = [];
        onGated = (s, params) => {
            left = s.state!.inventory.map(i => i.name);
            s.push({ skills: skills(params.untilLevel as number) });
        };
        const ctx = ctxFor(sdk);
        let t = 100;
        const timer = setInterval(() => sdk.tick({ tick: ++t }), 1);
        try {
            await m.steps({ travel: 'none', respawn: 13, technique: 'knife' }).find(s => s.name === 'mining.iron-63')!.run(ctx);
        } finally {
            clearInterval(timer);
        }
        expect(gatedCalls.length).toBe(1);
        expect(left).toEqual(['Rune pickaxe', 'Knife', 'Logs', 'Bread']);
        expect(sdk.sent.filter(a => a.method === 'sendDropItem').length).toBe(6);
        const band = (ctx as unknown as { log: TickLog }).log.rows.find(r => r.step === '(band) mining.iron-63')!;
        expect((band.meta as { oreDrops: Array<{ ores: number }> }).oreDrops.map(d => d.ores)).toEqual([6]);
    });
    test('a band already passed does nothing', async () => {
        const { calls } = await runBand('mining.iron-15', 64);
        expect(calls).toEqual([]);
    });
});

// ------------------------------------------------------------------ the default path

/**
 * A scripted zoo band at D=13: two ores left in the pack; a run that sees a foreign ore and a
 * rock back 16 ticks after it emptied (the respawn watch aborts, D becomes 16, the six-rock lap);
 * a run that restarts its technique with an ore in the pack and a lap rock empty for 4 ticks.
 * Returns every send, every program start and the band row's fields as they were before the
 * fallback, with their ticks.
 */
async function defaultPathTrace(mod: typeof m, o: Record<string, unknown>): Promise<string[]> {
    const trace: string[] = [];
    const saved = { ...mod.deps };
    const five = mod.parseSteps(mod.ROTATIONS.five!.steps);
    const six = mod.parseSteps(mod.ROTATIONS.six!.steps);
    const sdk = new DropTickSdk(atZoo(70, ['Rune pickaxe', 'Knife', 'Logs', 'Iron ore', 'Iron ore']));
    sdk.onSend = a => trace.push(`T${sdk.state!.tick} ${a.method} ${a.args.join(',')}`);
    const setRockLive = (p: readonly [number, number], live: boolean) =>
        sdk.push(s => ({ nearbyLocs: s.nearbyLocs.map(l => (l.x === p[0] && l.z === p[1] ? { ...l, id: live ? 2092 : 450 } : l)) }));
    const addOre = (slot: number) => sdk.push(s => ({ inventory: [...s.inventory, item('Iron ore', slot)] }));
    const lapName = (steps: unknown) => Object.entries(mod.ROTATIONS).find(([, r]) => r.steps === steps)?.[0];
    let run = 0;
    mod.deps.inPageGate = (() => ({ summary: () => 'fake gate' })) as never;
    mod.deps.runGatedProgram = (async (_: unknown, name: string, params: Record<string, unknown>, opts: Record<string, any>) => {
        run++;
        trace.push(`T${sdk.state!.tick} ${name} ${lapName(params.steps)} respawn ${params.respawn} until ${params.untilLevel} ${opts.technique} params [${Object.keys(params).sort()}] opts [${Object.keys(opts).sort()}]`);
        if (run === 1) {
            sdk.tick();
            setRockLive(five[0]!.rock, false);
            addOre(10);
            for (let i = 0; i < 15; i++) sdk.tick();
            setRockLive(five[0]!.rock, true);
            sdk.tick();
            return { segments: [], ended: opts.signal.aborted ? 'aborted' : 'done' };
        }
        addOre(11);
        setRockLive(six[1]!.rock, false);
        const t = sdk.state!.tick;
        await drive(sdk as never, opts.beforeRestart('plain', { technique: 'knife', reason: 'slow' }), 40, s => (s.tick >= t + 4 ? { nearbyLocs: s.nearbyLocs.map(l => (l.x === six[1]!.rock[0] && l.z === six[1]!.rock[1] ? { ...l, id: 2092 } : l)) } : {}));
        trace.push(`T${sdk.state!.tick} restarted`);
        sdk.tick({ skills: skills(params.untilLevel as number) });
        return { segments: [], ended: 'done' };
    }) as never;
    const ctx = ctxFor(sdk);
    try {
        await mod.steps({ travel: 'none', respawn: 13, technique: 'knife', ...o }).find(s => s.name === 'mining.iron-63')!.run(ctx);
    } finally {
        Object.assign(mod.deps, saved);
    }
    const meta = (ctx as unknown as { log: TickLog }).log.rows.find(r => r.step === '(band) mining.iron-63')!.meta as Record<string, unknown>;
    for (const k of ['players', 'respawn', 'rotation', 'restarts', 'restartWaits', 'oreDrops', 'faults', 'observedRespawn', 'gate', 'segments']) trace.push(`${k} ${JSON.stringify(meta[k])}`);
    return trace;
}

describe('the default path (no fallback)', () => {
    // main's mining.ts before the fallback (blob 9abec9d) gives exactly this trace
    const MAIN = [
        'T100 sendDropItem 3',
        'T100 sendDropItem 4',
        'T101 knife-mine five respawn 13 until 99 knife params [rate,respawn,selfStarter,steps,untilLevel] opts [beforeRestart,log,onSegment,signal,technique]',
        'T118 sendDropItem 10',
        'T119 knife-mine six respawn 16 until 99 knife params [rate,respawn,selfStarter,steps,untilLevel] opts [beforeRestart,log,onSegment,signal,technique]',
        'T119 sendDropItem 11',
        'T124 restarted',
        'players null',
        'respawn 16',
        'rotation "six"',
        'restarts [{"tick":118,"why":"observed respawn 16 > scheduled 13","D":16,"rotation":"five"}]',
        'restartWaits [{"tick":120,"ticks":4,"after":"knife:slow","next":"plain","ok":true}]',
        'oreDrops [{"tick":100,"ores":2},{"tick":118,"ores":1},{"tick":119,"ores":1}]',
        'faults 0',
        'observedRespawn {"6":1,"16":1}',
        'gate null',
        'segments []',
    ];
    test('fallback none, and no fallback, behave as main did: the same sends, program starts, waits and row', async () => {
        const none = await defaultPathTrace(m, {});
        expect(none).toEqual(MAIN);
        expect(await defaultPathTrace(m, { fallback: 'none' })).toEqual(MAIN);
    });
});

// ------------------------------------------------------------------ contention

type Loc = { id: number; name: string; x: number; z: number; level: number; distance: number; options: string[]; optionsWithIndex: { text: string; opIndex: number }[] };
const rock = (x: number, z: number, live = true): Loc => ({ id: live ? 2092 : 450, name: 'Rocks', x, z, level: 0, distance: 1, options: ['Mine'], optionsWithIndex: [{ text: 'Mine', opIndex: 1 }] });
const siteLocs = (site: string) => [...new Map(Object.values(m.SITES[site]!.rotations).flatMap(r => m.parseSteps(r.steps)).map(st => [`${st.rock}`, rock(st.rock[0], st.rock[1])])).values()];
const lapOf = (site: string, D = 13) => m.parseSteps(m.SITES[site]!.rotations[m.lapFor(site, D)]!.steps);
const xpSkills = (level: number, xp: number, extra: Array<[string, number]> = []) => [{ name: 'Mining', level, baseLevel: level, experience: xp }, ...extra.map(([name, l]) => ({ name, level: l, baseLevel: l, experience: 0 }))];
/** SCORED at S09: Defence 1, Hitpoints 10, Prayer ~94, Magic 59 (RUN-ORDER.md S04, S07/S25b, S10b). */
const SCORED: Array<[string, number]> = [['Attack', 1], ['Strength', 1], ['Defence', 1], ['Hitpoints', 10], ['Ranged', 1], ['Prayer', 94], ['Magic', 59]];
const setRock = (sdk: FakeSdk, p: [number, number], live: boolean, patch: Partial<BotWorldState> = {}) =>
    sdk.tick(s => ({ nearbyLocs: s.nearbyLocs.map(l => (l.x === p[0] && l.z === p[1] ? rock(p[0], p[1], live) : l)) as never, ...patch }));

describe('ContestWatch: another player\'s ore is a lap depletion with no xp of ours', () => {
    const lap: Array<[number, number]> = [[2605, 3235], [2602, 3236]];
    const start = () => new FakeSdk(baseState({ tick: 100, skills: xpSkills(70, 1000), nearbyLocs: lap.map(p => rock(...p)) as never }));
    test('our depletion (xp on the same label or the next) is ours; one without xp is foreign two labels on', () => {
        const sdk = start();
        const events: m.ContestEvent[] = [];
        const w = new m.ContestWatch(sdk as never, () => lap, e => events.push(e));
        sdk.tick();
        setRock(sdk, lap[0]!, false, { skills: xpSkills(70, 1050) }); // ours: same label
        setRock(sdk, lap[1]!, false);
        sdk.tick({ skills: xpSkills(70, 1100) }); // ours: xp one label late
        sdk.tick();
        sdk.tick();
        expect(events).toEqual([]);
        expect(w.own).toBe(2);
        setRock(sdk, lap[0]!, true);
        setRock(sdk, lap[0]!, false); // someone else's
        expect(events).toEqual([]);
        sdk.tick();
        expect(events).toEqual([]);
        sdk.tick();
        expect(events).toEqual([{ tick: 108, kind: 'depletion', rock: '2605,3235' }]);
        expect(w.recent(108)).toBe(1);
        expect(w.recent(108 + m.CONTEST_WINDOW)).toBe(0);
        w.stop();
    });
    test('a rock dead on arrival or out of view is not evidence', () => {
        const sdk = new FakeSdk(baseState({ tick: 100, skills: xpSkills(70, 0), nearbyLocs: [rock(2605, 3235, false), rock(2602, 3236)] as never }));
        const events: m.ContestEvent[] = [];
        const w = new m.ContestWatch(sdk as never, () => lap, e => events.push(e));
        sdk.tick();
        sdk.tick({ nearbyLocs: [] }); // the scene reloading
        sdk.tick({ nearbyLocs: [rock(2605, 3235), rock(2602, 3236)] as never });
        for (let i = 0; i < 4; i++) sdk.tick();
        expect(events).toEqual([]);
        w.stop();
    });
    test('a depletion hidden by a scene reload is not evidence and takes no xp (the lab trace at ardougneNorth)', () => {
        const three: Array<[number, number]> = [[2711, 3329], [2712, 3329], [2713, 3332]];
        const sdk = new FakeSdk(baseState({ tick: 258, skills: xpSkills(97, 1000), nearbyLocs: three.map(p => rock(...p)) as never }));
        const events: m.ContestEvent[] = [];
        const w = new m.ContestWatch(sdk as never, () => three, e => events.push(e));
        sdk.tick({ skills: xpSkills(97, 1875) }); // T259: our ore off the first rock
        sdk.tick({ nearbyLocs: [] }); // T260: the region loads
        sdk.tick({ nearbyLocs: [rock(2711, 3329, false), rock(2712, 3329), rock(2713, 3332)] as never }); // T261: seen dead
        sdk.tick({ skills: xpSkills(97, 2750) }); // T262: the second ore
        setRock(sdk, three[1]!, false); // T263: its depletion
        sdk.tick({ skills: xpSkills(97, 3625) }); // T264
        setRock(sdk, three[2]!, false); // T265
        for (let i = 0; i < 4; i++) sdk.tick();
        expect(events).toEqual([]);
        expect(w.own).toBe(2);
        w.stop();
    });
    test('the limit: CONTEST_RETRIES events are retried, one more trips', () => {
        const w = new m.ContestWatch({ onStateUpdate: () => () => {} } as never, () => lap);
        for (let i = 0; i < m.CONTEST_RETRIES; i++) w.lapTimeout(100 + i);
        expect(w.tripped(110)).toBe(false);
        w.lapTimeout(110);
        expect(w.tripped(110)).toBe(true);
        expect(w.tripped(100 + m.CONTEST_WINDOW)).toBe(false);
        expect(m.CONTEST_RETRIES).toBe(2);
    });
});

describe('sites', () => {
    test('every site lap: moves of at most 4, stands beside rocks, 3.00 per ore at D=13 and 15', () => {
        for (const [site, s] of Object.entries(m.SITES)) {
            for (const [name, r] of Object.entries(s.rotations)) expect([site, name, m.lapModel(r.steps, 13).problems]).toEqual([site, name, []]);
            const five = s.rotations.five!.steps;
            expect([site, m.lapModel(five, 13).ticksPerOre, m.lapModel(five, 15).ticksPerOre]).toEqual([site, 3, 3]);
        }
        expect(m.lapModel(m.SITES.rellekka!.rotations.six!.steps, 18).ticksPerOre).toBe(3);
        expect(m.lapFor('rellekka', 17)).toBe('six');
        expect(m.lapFor('ardougneNorth', 17)).toBe('five');
        expect(m.SITES.zoo!.rotations).toBe(m.ROTATIONS);
    });
    test('combat level (Player.getCombatLevel): SCORED at S09 is 43, one over the bears\' 42', () => {
        const at = (extra: Array<[string, number]>) => m.combatLevel(baseState({ skills: xpSkills(64, 0, extra) }));
        expect(at(SCORED)).toBe(43);
        expect(at(SCORED.map(([n, l]) => [n, n === 'Prayer' ? 93 : l] as [string, number]))).toBe(42);
        expect(at([])).toBe(3);
    });
    test('fallback: none, auto, or named sites', () => {
        expect(m.parseFallback(undefined)).toEqual({ sites: [], acceptHazards: false });
        expect(m.parseFallback('none').sites).toEqual([]);
        expect(m.parseFallback('auto')).toEqual({ sites: ['ardougneNorth', 'rellekka', 'wilderness31'], acceptHazards: false });
        expect(m.parseFallback('ardougneNorth,rellekka')).toEqual({ sites: ['ardougneNorth', 'rellekka'], acceptHazards: false });
        expect(m.parseFallback(['rellekka'], true)).toEqual({ sites: ['rellekka'], acceptHazards: true });
        expect(m.steps({ fallback: 'rellekka', acceptHazards: 'true' })).toBeDefined();
        expect(() => m.parseFallback('zoo')).toThrow();
        expect(() => m.parseFallback('varrock')).toThrow();
        expect(() => m.steps({ fallback: 'nowhere' })).toThrow();
    });
    test('next site: allowed by combat unless acceptHazards, not recently contested first, then the nearest', () => {
        const auto = m.parseFallback('auto');
        const none = new Map<string, number>();
        expect(m.nextSite('zoo', [2604, 3235], 43, auto, none, 1000)).toBe('ardougneNorth');
        expect(m.nextSite('zoo', [2604, 3235], 42, auto, none, 1000)).toBeUndefined();
        expect(m.nextSite('zoo', [2604, 3235], 126, auto, none, 1000)).toBe('ardougneNorth');
        expect(m.nextSite('ardougneNorth', [2713, 3330], 43, auto, new Map([['zoo', 900]]), 1000)).toBe('zoo');
        // a named list is held to safeFrom too (rs/158): rellekka (129) is skipped at 43, all of it at 3
        const named = m.parseFallback('ardougneNorth,rellekka');
        expect(m.nextSite('zoo', [2604, 3235], 43, named, none, 1000)).toBe('ardougneNorth');
        expect(m.nextSite('ardougneNorth', [2713, 3330], 43, named, new Map([['zoo', 900]]), 1000)).toBe('zoo');
        expect(m.nextSite('zoo', [2604, 3235], 3, named, none, 1000)).toBeUndefined();
        expect(m.nextSite('zoo', [2604, 3235], 42, m.parseFallback('rellekka'), none, 1000)).toBeUndefined();
        // acceptHazards: every listed site, hazards and all
        const hazards = m.parseFallback('ardougneNorth,rellekka', true);
        expect(m.nextSite('zoo', [2604, 3235], 3, hazards, none, 1000)).toBe('ardougneNorth');
        expect(m.nextSite('ardougneNorth', [2713, 3330], 3, hazards, new Map([['zoo', 900]]), 1000)).toBe('rellekka');
        expect(m.nextSite('ardougneNorth', [2713, 3330], 3, hazards, new Map([['zoo', 900]]), 900 + m.CONTEST_WINDOW)).toBe('zoo');
        expect(m.nextSite('zoo', [2604, 3235], 42, m.parseFallback('auto', true), none, 1000)).toBe('ardougneNorth');
    });
});

describe('contested iron bands', () => {
    const band = (o: Record<string, unknown>) => m.steps({ travel: 'none', respawn: 13, technique: 'knife', ...o }).find(s => s.name === 'mining.iron-63')!;
    const atSite = (site: string, level: number, extra: Array<[string, number]> = []) => {
        const c = m.SITES[site]!.centre;
        return baseState({ tick: 100, skills: xpSkills(level, 1000, extra), inventory: ['Rune pickaxe', 'Knife', 'Logs'].map(item), player: { worldX: c[0], worldZ: c[1], level: 0 } as BotWorldState['player'], nearbyLocs: siteLocs(site) as never });
    };
    const ctxWithWalk = (sdk: FakeSdk, walks: string[]) =>
        ({
            session: { sdk, name: 'cairn_test', sessionId: 1 }, sdk, c: {}, log: TickLog.memory('t'),
            bot: {
                walkTo: async (x: number, z: number) => {
                    const to = Object.keys(m.SITES).find(n => Math.max(Math.abs(m.SITES[n]!.centre[0] - x), Math.abs(m.SITES[n]!.centre[1] - z)) <= m.SITE_RADIUS)!;
                    walks.push(to);
                    for (let i = 0; i < 5; i++) sdk.tick();
                    sdk.tick({ player: { worldX: x, worldZ: z, level: 0 } as BotWorldState['player'], nearbyLocs: siteLocs(to) as never });
                    return { success: true, message: 'ok' };
                },
            },
        }) as never;
    /** A passer-by's ore off the lap's first rock, then the rock back: one contest event per program run at the zoo. */
    const passerBy = (sdk: FakeSdk, site: string) => {
        const r = lapOf(site)[0]!.rock;
        sdk.tick(); // the watch sees the lap live first
        setRock(sdk, r, false);
        sdk.tick();
        sdk.tick();
        setRock(sdk, r, true);
    };
    const bandRow = (ctx: unknown) => (ctx as { log: TickLog }).log.rows.find(r => r.step === '(band) mining.iron-63')!;
    afterEach(() => {
        gatedImpl = null;
    });

    test('uncontested, the fallback changes nothing: the same program call and the zoo', async () => {
        const run = async (o: Record<string, unknown>) => {
            gatedCalls.length = 0;
            const sdk = new MiningSdk(atZoo(70));
            onGated = (s, params) => s.push({ skills: skills(params.untilLevel as number) });
            const ctx = ctxFor(sdk);
            await band(o).run(ctx);
            return { calls: [...gatedCalls], row: bandRow(ctx) };
        };
        const plain = await run({});
        const auto = await run({ fallback: 'auto' });
        expect(auto.calls.length).toBe(1);
        expect(auto.calls[0]!.params).toEqual(plain.calls[0]!.params);
        expect(Object.keys(auto.calls[0]!.opts).sort()).toEqual(Object.keys(plain.calls[0]!.opts).sort());
        expect(auto.calls[0]!.opts.technique).toBe(plain.calls[0]!.opts.technique);
        expect(plain.row.meta).toMatchObject({ site: 'zoo', contest: { fallback: [], foreign: 0, retries: 0, switches: [] } });
        expect(auto.row.meta).toMatchObject({ site: 'zoo', contest: { fallback: ['ardougneNorth', 'rellekka', 'wilderness31'], foreign: 0, retries: 0, switches: [] } });
    });

    test('without a fallback a foreign ore is only logged: no abort, no retry', async () => {
        gatedCalls.length = 0;
        const sdk = new MiningSdk(atSite('zoo', 70));
        gatedImpl = async (s, params) => {
            passerBy(s, 'zoo');
            s.tick({ skills: xpSkills(params.untilLevel as number, 9e6) });
            return { segments: [], ended: 'done' };
        };
        const ctx = ctxFor(sdk);
        await band({}).run(ctx);
        expect(gatedCalls.length).toBe(1);
        expect(bandRow(ctx).meta).toMatchObject({ contest: { foreign: 1, retries: 0, switches: [] } });
    });

    test('two retries in place, then the third contest event leaves for the nearest allowed site', async () => {
        gatedCalls.length = 0;
        const sdk = new MiningSdk(atSite('zoo', 70, SCORED));
        gatedImpl = async (s, params, opts) => {
            if (Math.abs(s.state!.player!.worldX - 2604) <= m.SITE_RADIUS) {
                passerBy(s, 'zoo');
                expect(opts.signal.aborted).toBe(true);
                return { segments: [], ended: 'aborted' };
            }
            s.tick({ skills: xpSkills(params.untilLevel as number, 9e6) });
            return { segments: [], ended: 'done' };
        };
        const walks: string[] = [];
        const ctx = ctxWithWalk(sdk, walks);
        await band({ fallback: 'ardougneNorth' }).run(ctx);
        expect(gatedCalls.length).toBe(m.CONTEST_RETRIES + 2);
        expect(gatedCalls.slice(0, 3).every(c => c.params.steps === m.ROTATIONS.five!.steps)).toBe(true);
        expect(gatedCalls[3]!.params.steps).toBe(m.SITES.ardougneNorth!.rotations.five!.steps);
        expect(walks).toEqual(['ardougneNorth']);
        const meta = bandRow(ctx).meta as Record<string, any>;
        expect(meta.site).toBe('ardougneNorth');
        expect(meta.contest).toMatchObject({ foreign: 3, retries: 2 });
        expect(meta.contest.switches).toMatchObject([{ from: 'zoo', to: 'ardougneNorth', walkTicks: 6, events: 3 }]);
        expect(meta.restarts).toEqual([]);
    });

    test('after a switch the ores the contested lap left are dropped before the new circuit starts', async () => {
        gatedCalls.length = 0;
        const sdk = new DropTickSdk(atSite('zoo', 70, SCORED));
        let zooRuns = 0;
        let packAtStart: string[] = [];
        gatedImpl = async (s, params) => {
            if (Math.abs(s.state!.player!.worldX - 2604) <= m.SITE_RADIUS) {
                passerBy(s, 'zoo');
                // the run that trips the contest is cut off with its last ores in the pack
                if (++zooRuns === m.CONTEST_RETRIES + 1) s.push(st => ({ inventory: [...st.inventory, item('Iron ore', 10), item('Iron ore', 11)] }));
                return { segments: [], ended: 'aborted' };
            }
            packAtStart = s.state!.inventory.map(i => i.name);
            s.tick({ skills: xpSkills(params.untilLevel as number, 9e6) });
            return { segments: [], ended: 'done' };
        };
        const walks: string[] = [];
        const ctx = ctxWithWalk(sdk, walks);
        await band({ fallback: 'ardougneNorth' }).run(ctx);
        expect(walks).toEqual(['ardougneNorth']);
        expect(gatedCalls[3]!.params.steps).toBe(m.SITES.ardougneNorth!.rotations.five!.steps);
        expect(packAtStart).toEqual(['Rune pickaxe', 'Knife', 'Logs']);
        expect(sdk.sent.filter(a => a.method === 'sendDropItem').map(a => a.args[0])).toEqual([10, 11]);
        const meta = bandRow(ctx).meta as Record<string, any>;
        const sw = meta.contest.switches[0];
        // dropped at the new site, on arrival
        expect(meta.oreDrops).toEqual([{ tick: sw.tick + sw.walkTicks, ores: 2 }]);
    });

    test("main's 17:53 ruling: auto at combat 3 (a rehearsal account) starts at the zoo and logs the fallback unavailable", async () => {
        const sdk = new MiningSdk(atSite('zoo', 70));
        expect(m.combatLevel(sdk.state!)).toBe(3);
        expect(band({ fallback: 'auto' }).preconditions(sdk.state!, {})).toBe(true);
        const lines: string[] = [];
        const spy = spyOn(console, 'log').mockImplementation((...a: unknown[]) => void lines.push(a.join(' ')));
        try {
            onGated = (s, params) => s.push({ skills: xpSkills(params.untilLevel as number, 9e6) });
            await band({ fallback: 'auto' }).run(ctxFor(sdk));
        } finally {
            spy.mockRestore();
        }
        expect(lines.filter(l => /fallback unavailable/.test(l))).toEqual([
            '[mining.iron-63] fallback unavailable at combat 3: no site it may use is safe (ardougneNorth needs 43, rellekka 129, wilderness31 never); mining the zoo through any contest',
        ]);
    });

    test('auto at combat 3, contested past the switch count: one program run mines through every event at the zoo, no abort, no walk', async () => {
        gatedCalls.length = 0;
        const sdk = new MiningSdk(atSite('zoo', 70));
        let aborted: boolean | null = null;
        gatedImpl = async (s, params, opts) => {
            for (let i = 0; i < m.CONTEST_RETRIES + 3; i++) passerBy(s, 'zoo');
            aborted = opts.signal.aborted;
            s.tick({ skills: xpSkills(params.untilLevel as number, 9e6) });
            return { segments: [], ended: 'done' };
        };
        const walks: string[] = [];
        const ctx = ctxWithWalk(sdk, walks);
        await band({ fallback: 'auto' }).run(ctx);
        expect(aborted).toBe(false);
        expect(walks).toEqual([]);
        expect(gatedCalls.length).toBe(1);
        expect(bandRow(ctx).meta).toMatchObject({ site: 'zoo', restarts: [], contest: { foreign: m.CONTEST_RETRIES + 3, retries: 0, switches: [] } });
    });

    test('auto at combat 3, a lap that is not whole: each wait of D+10 is logged as an event and the band waits on, never failing', async () => {
        gatedCalls.length = 0;
        const zoo = atSite('zoo', 70);
        const first = lapOf('zoo')[0]!.rock;
        const sdk = new MiningSdk({ ...zoo, nearbyLocs: zoo.nearbyLocs.map(l => (l.x === first[0] && l.z === first[1] ? rock(first[0], first[1], false) : l)) as never });
        gatedImpl = async (s, params) => (s.tick({ skills: xpSkills(params.untilLevel as number, 9e6) }), { segments: [], ended: 'done' });
        const walks: string[] = [];
        const ctx = ctxWithWalk(sdk, walks);
        // the rock comes back between the third wait's end (100 + 3 x 23) and the fourth's
        let n = 0;
        const timer = setInterval(() => (++n === 80 ? setRock(sdk, first, true) : sdk.tick()), 1);
        try {
            await band({ fallback: 'auto' }).run(ctx);
        } finally {
            clearInterval(timer);
        }
        expect(walks).toEqual([]);
        expect(gatedCalls.length).toBe(1);
        const meta = bandRow(ctx).meta as Record<string, any>;
        expect(meta.site).toBe('zoo');
        expect(meta.contest.events.map((e: m.ContestEvent) => e.kind)).toEqual(['lap', 'lap', 'lap']);
    });

    test('a combat that rises mid-band to 43 makes the fallback available: the next events retry, then switch to ardougneNorth', async () => {
        const at42 = SCORED.map(([n, l]) => [n, n === 'Prayer' ? 93 : l] as [string, number]);
        const sdk = new MiningSdk(atSite('zoo', 70, at42));
        gatedImpl = async (s, params, opts) => {
            if (s.state!.player!.worldX < 2650) {
                passerBy(s, 'zoo');
                // the first event, at 42, does not abort; then Prayer 94 makes the account 43
                if (!opts.signal.aborted) s.push({ skills: xpSkills(70, 1000, SCORED) });
                return { segments: [], ended: opts.signal.aborted ? 'aborted' : 'done' };
            }
            s.tick({ skills: xpSkills(params.untilLevel as number, 9e6, SCORED) });
            return { segments: [], ended: 'done' };
        };
        const walks: string[] = [];
        const ctx = ctxWithWalk(sdk, walks);
        await band({ fallback: 'auto' }).run(ctx);
        expect(walks).toEqual(['ardougneNorth']);
        expect(bandRow(ctx).meta).toMatchObject({ site: 'ardougneNorth', contest: { foreign: 3, retries: 1 } });
    });

    test('auto at SCORED\'s combat 43 leaves the zoo for ardougneNorth', async () => {
        gatedCalls.length = 0;
        const sdk = new MiningSdk(atSite('zoo', 70, SCORED));
        gatedImpl = async (s, params) => {
            if (s.state!.player!.worldX < 2650) return (passerBy(s, 'zoo'), { segments: [], ended: 'aborted' });
            s.tick({ skills: xpSkills(params.untilLevel as number, 9e6, SCORED) });
            return { segments: [], ended: 'done' };
        };
        const walks: string[] = [];
        await band({ fallback: 'auto' }).run(ctxWithWalk(sdk, walks));
        expect(walks).toEqual(['ardougneNorth']);
    });

    test("rs/158's ruling mid-band: at 43 a named list's unsafe site is never entered, unless acceptHazards", async () => {
        // contested at the zoo, then at ardougneNorth: the second switch may go to rellekka (129) or the zoo
        const run = async (o: Record<string, unknown>) => {
            const sdk = new MiningSdk(atSite('zoo', 70, SCORED));
            const walks: string[] = [];
            gatedImpl = async (s, params) => {
                if (walks.length < 2) return (passerBy(s, walks.length ? 'ardougneNorth' : 'zoo'), { segments: [], ended: 'aborted' });
                s.tick({ skills: xpSkills(params.untilLevel as number, 9e6, SCORED) });
                return { segments: [], ended: 'done' };
            };
            const ctx = ctxWithWalk(sdk, walks);
            await band({ fallback: ['ardougneNorth', 'rellekka'], ...o }).run(ctx);
            return { walks, switches: (bandRow(ctx).meta as Record<string, any>).contest.switches.map((w: { to: string }) => w.to) };
        };
        expect(await run({})).toEqual({ walks: ['ardougneNorth', 'zoo'], switches: ['ardougneNorth', 'zoo'] });
        expect(await run({ acceptHazards: true })).toEqual({ walks: ['ardougneNorth', 'rellekka'], switches: ['ardougneNorth', 'rellekka'] });
    });

    test('at combat 42 with no safe site, contests make no switch and the band mines on at the zoo; acceptHazards switches', async () => {
        const at42 = SCORED.map(([n, l]) => [n, n === 'Prayer' ? 93 : l] as [string, number]);
        for (const fallback of ['auto', ['ardougneNorth', 'rellekka']]) {
            const stays = new MiningSdk(atSite('zoo', 70, at42));
            gatedImpl = async (s, params) => {
                if (s.state!.player!.worldX >= 2650) throw new Error('switched away from the zoo at combat 42');
                for (let i = 0; i <= m.CONTEST_RETRIES; i++) passerBy(s, 'zoo');
                s.tick({ skills: xpSkills(params.untilLevel as number, 9e6, at42) });
                return { segments: [], ended: 'done' };
            };
            const none: string[] = [];
            const ctx = ctxWithWalk(stays, none);
            await band({ fallback }).run(ctx);
            expect(none).toEqual([]);
            expect(bandRow(ctx).meta).toMatchObject({ site: 'zoo', contest: { foreign: m.CONTEST_RETRIES + 1, retries: 0, switches: [] } });

            const sdk = new MiningSdk(atSite('zoo', 70, at42));
            gatedImpl = async (s, params) => {
                if (s.state!.player!.worldX < 2650) return (passerBy(s, 'zoo'), { segments: [], ended: 'aborted' });
                s.tick({ skills: xpSkills(params.untilLevel as number, 9e6, at42) });
                return { segments: [], ended: 'done' };
            };
            const walks: string[] = [];
            await band({ fallback, acceptHazards: true }).run(ctxWithWalk(sdk, walks));
            expect(walks).toEqual(['ardougneNorth']);
        }
    });

    test('a lap that is never whole: each wait of D+10 is an event, the third leaves', async () => {
        gatedCalls.length = 0;
        const zoo = atSite('zoo', 70, SCORED);
        const first = lapOf('zoo')[0]!.rock;
        const sdk = new MiningSdk({ ...zoo, nearbyLocs: zoo.nearbyLocs.map(l => (l.x === first[0] && l.z === first[1] ? rock(first[0], first[1], false) : l)) as never });
        gatedImpl = async (s, params) => (s.tick({ skills: xpSkills(params.untilLevel as number, 9e6) }), { segments: [], ended: 'done' });
        const walks: string[] = [];
        const ctx = ctxWithWalk(sdk, walks);
        const timer = setInterval(() => sdk.tick(), 1);
        try {
            await band({ fallback: 'ardougneNorth' }).run(ctx);
        } finally {
            clearInterval(timer);
        }
        expect(walks).toEqual(['ardougneNorth']);
        expect(gatedCalls.length).toBe(1);
        expect((bandRow(ctx).meta as Record<string, any>).contest.events.map((e: m.ContestEvent) => e.kind)).toEqual(['lap', 'lap', 'lap']);
    });

    test('resumed at a fallback site: the zoo walk stays put and the band mines there', async () => {
        gatedCalls.length = 0;
        const sdk = new MiningSdk(atSite('ardougneNorth', 70, SCORED));
        const zooWalk = m.steps({ travel: 'none', fallback: 'ardougneNorth' }).find(s => s.name === 'mining.travel: zoo')!;
        const walks: string[] = [];
        await zooWalk.run(ctxWithWalk(sdk, walks));
        expect(walks).toEqual([]);
        expect(band({ fallback: 'ardougneNorth' }).preconditions(sdk.state!, {})).toBe(true);
        expect(band({}).preconditions(sdk.state!, {})).toMatch(/not at the zoo cluster/);
        onGated = (s, params) => s.push({ skills: skills(params.untilLevel as number) });
        await band({ fallback: 'ardougneNorth' }).run(ctxWithWalk(sdk, walks));
        expect(gatedCalls[0]!.params.steps).toBe(m.SITES.ardougneNorth!.rotations.five!.steps);
    });

    test("the combat gate: never at the zoo (main's 17:53 ruling); a band resumed at a fallback site keeps rs/158's gate unless acceptHazards", () => {
        // SCORED at Prayer 93 is combat 42, at 94 combat 43
        const at = (site: string, mining: number, prayer: number) => atSite(site, mining, SCORED.map(([n, l]) => [n, n === 'Prayer' ? prayer : l] as [string, number]));
        expect([m.combatLevel(at('zoo', 70, 93)), m.combatLevel(at('zoo', 70, 94)), m.SITES.ardougneNorth!.safeFrom]).toEqual([42, 43, 43]);
        const refusal = (needs: string) => `combat 42: no site the contested-rock fallback may use is safe (${needs})`;
        for (const [name, mining] of [['mining.iron-15', 45], ['mining.iron-63', 70]] as const) {
            const pre = (site: string, o: Record<string, unknown>, prayer: number) =>
                [name, m.steps({ travel: 'none', respawn: 13, technique: 'knife', ...o }).find(s => s.name === name)!.preconditions(at(site, mining, prayer), {})];
            for (const o of [{ fallback: 'auto' }, { fallback: ['ardougneNorth'] }, { fallback: ['rellekka'] }, { fallback: 'rellekka,wilderness31' }, { fallback: ['rellekka'], acceptHazards: true }, { fallback: ['rellekka'], acceptHazards: false }, { fallback: 'none' }, {}]) {
                expect(pre('zoo', o, 93)).toEqual([name, true]);
                expect(pre('zoo', o, 94)).toEqual([name, true]);
            }
            // resumed at ardougneNorth after a switch: as before the ruling
            expect(pre('ardougneNorth', { fallback: 'auto' }, 93)).toEqual([name, refusal('ardougneNorth needs 43, rellekka 129, wilderness31 never')]);
            expect(pre('ardougneNorth', { fallback: ['ardougneNorth'] }, 93)).toEqual([name, refusal('ardougneNorth needs 43')]);
            expect(pre('ardougneNorth', { fallback: ['ardougneNorth'], acceptHazards: 'true' }, 93)).toEqual([name, true]);
            expect(pre('ardougneNorth', { fallback: 'auto' }, 94)).toEqual([name, true]);
            expect(pre('ardougneNorth', {}, 93)).toEqual([name, 'not at the zoo cluster (2713,3330)']);
        }
        // a band already past is done whatever the combat
        expect(band({ fallback: 'auto' }).preconditions(at('zoo', 99, 93), {})).toBe(true);
        expect(() => m.steps({ acceptHazards: 'yes' })).toThrow(/acceptHazards must be true or false/);
    });
});

describe('the slot ledger (rs/158 specs 3 and 4)', () => {
    const runOpts = { travel: 'none', respawn: 13, technique: 'knife', kitGiver: 'cairn_h01', dropAtExit: true } as const;
    const step = (name: string, o: Record<string, unknown> = runOpts) => m.steps(o).find(s => s.name === name)!;
    const names = (s: BotWorldState) => s.inventory.map(i => i.name);

    test('both are opt-in: a rehearsal (no kitGiver, no dropAtExit) has neither step; the run has both, around the iron bands', () => {
        expect(m.steps({ travel: 'none' }).map(s => s.name)).toEqual(['mining.prep', 'mining.copper', 'mining.travel: zoo', 'mining.iron-15', 'mining.iron-63']);
        expect(m.steps(runOpts).map(s => s.name)).toEqual(['mining.prep', 'mining.copper', 'mining.travel: zoo', 'mining.kit: H4p', 'mining.iron-15', 'mining.iron-63', 'mining.exit']);
        expect(() => m.steps({ kitGiver: '' })).toThrow(/kitGiver/);
        expect(() => m.steps({ dropAtExit: 'yes' })).toThrow(/dropAtExit/);
        expect(m.steps({ dropAtExit: 'false' }).map(s => s.name)).not.toContain('mining.exit');
    });

    test("H4p and S09: at the zoo with S07's knife and log, one receive brings the rune pickaxe and 1 log; 4 slots used, the band's 4 free", async () => {
        const sdk = new MiningSdk(atZoo(64, ['Knife', 'Logs']));
        const calls: Array<{ partner: string; want: unknown }> = [];
        const real = m.deps.receiveFrom;
        m.deps.receiveFrom = (async (s: FakeSdk, partner: string, o: { want: unknown }) => {
            calls.push({ partner, want: o.want });
            const st = s.state!;
            s.push({ tick: st.tick + 5, inventory: [...st.inventory, item('Rune pickaxe', 2), item('Logs', 3)] });
            return { ok: true, ticks: 5, received: [] };
        }) as never;
        const kit = step('mining.kit: H4p');
        try {
            expect(kit.preconditions(sdk.state!, {})).toBe(true);
            await kit.run(ctxFor(sdk));
        } finally {
            m.deps.receiveFrom = real;
        }
        expect(calls).toEqual([{ partner: 'cairn_h01', want: [...m.H4P_KIT] }]);
        expect(m.H4P_KIT).toEqual([{ item: /^rune pickaxe$/i, amount: 1 }, { item: /^logs$/i, amount: 1 }]);
        expect(names(sdk.state!)).toEqual(['Knife', 'Logs', 'Rune pickaxe', 'Logs']);
        expect(28 - sdk.state!.inventory.length).toBe(24);
        expect(kit.postconditions(sdk.state!, {})).toBe(true);
        expect(kit.done!(obs(sdk.state!), {})).toBe(true);
        expect(step('mining.iron-63').preconditions(sdk.state!, {})).toBe(true);
    });

    test("H4p's free-slot precondition counts the kit's 2 and the band's 4; a kit already held trades nothing", async () => {
        const crowded = (n: number) => atZoo(64, ['Knife', ...Array.from({ length: n }, () => 'Shark')]);
        const kit = step('mining.kit: H4p');
        expect(kit.preconditions(crowded(21), {})).toBe(true);
        expect(kit.preconditions(crowded(22), {})).toBe("23 other items: H4p's rune pickaxe and log and the band need 6 free slots");
        // ores do not count: the band drops them first
        expect(kit.preconditions(atZoo(64, ['Knife', ...Array(21).fill('Shark'), 'Iron ore', 'Iron ore']), {})).toBe(true);
        const held = atZoo(64, ['Rune pickaxe', 'Knife', 'Logs']);
        expect(kit.done!(obs(held), {})).toBe(true);
        const sdk = new MiningSdk(held);
        await kit.run(ctxFor(sdk));
        expect(sdk.sent).toEqual([]);
        expect(kit.done!(obs(atZoo(99, [])), {})).toBe(true);
    });

    test('S09: each iron band refuses with fewer than 4 free slots (ores count as free)', () => {
        const full = (n: number, extra: string[] = []) => atZoo(64, ['Rune pickaxe', 'Knife', 'Logs', ...Array.from({ length: n }, () => 'Shark'), ...extra]);
        const band = step('mining.iron-63');
        expect(band.preconditions(full(21), {})).toBe(true);
        expect(band.preconditions(full(22), {})).toBe('25 other items: need 4 free slots (ore, a gem, a stray fletch)');
        expect(band.preconditions(full(21, ['Iron ore', 'Iron ore']), {})).toBe(true);
    });

    test("H7: at 99 the exit drops the pickaxe, every log and the lap's leftover ore in one tick's batch, never the knife; the pack is the knife alone", async () => {
        const sdk = new MiningSdk(atZoo(99, ['Knife', 'Logs', 'Rune pickaxe', 'Logs', 'Logs', 'Iron ore']));
        const exit = step('mining.exit');
        expect(exit.preconditions(sdk.state!, {})).toBe(true);
        expect(exit.done!(obs(sdk.state!), {})).toBe(false);
        await exit.run(ctxFor(sdk));
        expect(sdk.sent.map(a => a.args[0])).toEqual([1, 2, 3, 4, 5]);
        expect(names(sdk.state!)).toEqual(['Knife']);
        expect(exit.postconditions(sdk.state!, {})).toBe(true);
        expect(exit.done!(obs(sdk.state!), {})).toBe(true);
        // H7 adds 6 logs, the staff and amulet, the antipoison, 2 sharks and 3 rune stacks: 13 against 27 free
        expect(28 - sdk.state!.inventory.length).toBeGreaterThanOrEqual(13);
    });

    test('the drops go out without waiting: a drop sent and not yet published passes the postcondition; the knife and other items stay', async () => {
        const sdk = new FakeSdk(atZoo(99, ['Rune pickaxe', 'Knife', 'Logs', 'Logs', 'Shark']));
        const exit = step('mining.exit');
        await exit.run(ctxFor(sdk));
        expect(sdk.sent.map(a => [a.method, a.args[0]])).toEqual([['sendDropItem', 0], ['sendDropItem', 2], ['sendDropItem', 3]]);
        expect(exit.postconditions(sdk.state!, {})).toBe(true);
        expect(exit.done!(obs(sdk.state!), {})).toBe(false);
        expect(exit.preconditions(atZoo(98), {})).toMatch(/Mining 98 < 99/);
    });

    test('more than five to drop: five a tick', async () => {
        const sdk = new MiningSdk(atZoo(99, ['Knife', ...Array(7).fill('Logs')]));
        let t = 100;
        const timer = setInterval(() => sdk.tick({ tick: ++t }), 1);
        try {
            await step('mining.exit').run(ctxFor(sdk));
        } finally {
            clearInterval(timer);
        }
        expect(sdk.sent.length).toBe(7);
        expect(names(sdk.state!)).toEqual(['Knife']);
    });
});

describe('mining.exit stays done after S09 (rs/558; runner/step.ts: a done milestone stays done for the rest of the run)', () => {
    /** rs/186's chain.ts S09_MINING, and its pick of iron-63 and the exit. */
    const s09 = () => m.steps({ travel: 'none', dropAtExit: true, fallback: 'auto' }).filter(s => ['mining.iron-63', 'mining.exit'].includes(s.name));
    const exit = () => s09().find(s => s.name === 'mining.exit')!;
    const at = (x: number, z: number, inv: string[], level = 99): BotWorldState => ({ ...atZoo(level, inv), player: { worldX: x, worldZ: z, level: 0 } as BotWorldState['player'] });
    const ELKOY = [2504, 3191] as const;
    /** Past H7 (STEP-MANIFEST.md's ledger): S07's knife, H7's 6 logs, antipoison and sharks. */
    const PAST_H7 = ['Knife', ...Array<string>(6).fill('Logs'), 'Antipoison(3)', 'Shark', 'Shark'];
    const logs = (s: BotWorldState) => s.inventory.filter(i => /^logs$/i.test(i.name)).length;

    test('past H7 (Mining 99, 6 logs, at Elkoy) the exit is done, and at every later position that holds EXIT_DROPS', () => {
        expect(exit().done!(obs(at(...ELKOY, PAST_H7)), {})).toBe(true);
        // S18 at the knights with the courier's ore, S22's fly spots with H18's logs, S25's booth with H21d's gems
        expect(exit().done!(obs(at(2670, 3305, ['Knife', ...Array<string>(14).fill('Iron ore')])), {})).toBe(true);
        expect(exit().done!(obs(at(3241, 3248, Array<string>(10).fill('Logs'))), {})).toBe(true);
        expect(exit().done!(obs(at(3185, 3436, ['Chisel', 'Uncut sapphire', 'Uncut diamond'])), {})).toBe(true);
        expect(exit().done!(obs(at(...ELKOY, PAST_H7, 98)), {})).toBe(false);
    });

    test('at an S09 site a crash before the drop leaves it not done, so the re-run still drops; every stand the exit can run on is inside its site', () => {
        expect(exit().done!(obs(atZoo(99, ['Rune pickaxe', 'Knife'])), {})).toBe(false);
        expect(exit().done!(obs(atZoo(99, ['Knife', 'Iron ore'])), {})).toBe(false);
        expect(exit().done!(obs(atZoo(99, ['Knife'])), {})).toBe(true);
        for (const [name, site] of Object.entries(m.SITES)) {
            for (const r of Object.values(site.rotations)) {
                for (const { stand } of m.parseSteps(r.steps)) expect([name, stand, exit().done!(obs(at(stand[0], stand[1], ['Rune pickaxe', 'Knife'])), {})]).toEqual([name, stand, false]);
            }
        }
    });

    test('resolveResume on a stand-in of the chain from S09 to S10b: past H7 it resumes at S10b, never re-entering mining.exit; before the drop it resumes at mining.exit', async () => {
        const leg: Step<any> = { name: 'T09-10 run the zoo to Elkoy', preconditions: () => true, run: async () => {}, postconditions: () => true, logoutSafe: true };
        const s10b: Step<any> = { name: 'S10b', preconditions: s => (logs(s) >= 6 ? true : 'no logs for Montai'), run: async () => {}, postconditions: () => true, logoutSafe: true, done: () => false };
        // chain.ts's hand-offs: done when the row's items are held, or when the next milestone is (supersededBy)
        const h7: Step<any> = {
            name: 'H7', preconditions: () => 'the H7 giver is not in view', run: async () => {}, postconditions: () => true, logoutSafe: true,
            done: (o, c) => logs(o.state) >= 6 || !!s10b.done!(o, c),
        };
        const slice = [...s09(), leg, h7, s10b];
        const walk = (s: BotWorldState) => resolveResume(slice, new Observation(s), {});

        const past = await walk(at(...ELKOY, PAST_H7));
        expect([past.step, past.mode, past.lastDone]).toEqual(['S10b', 'run', 3]);
        expect(slice.slice(past.index).map(s => s.name)).not.toContain('mining.exit');

        const before = await walk(atZoo(99, ['Rune pickaxe', 'Knife', 'Logs', 'Iron ore']));
        expect([before.step, before.mode]).toEqual(['mining.exit', 'run']);
    });
});
