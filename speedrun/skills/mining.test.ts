import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { BotWorldState } from '../../sdk/types';
import { baseState, FakeSdk } from '../lib/fake-sdk';
import { TickLog } from '../lib/ticks';
import * as m from './mining';

// runGatedProgram is the page's loop; here it records what the band asks of it and levels up.
const gatedCalls: Array<{ name: string; params: Record<string, unknown>; opts: Record<string, unknown> }> = [];
let onGated: (sdk: FakeSdk, params: Record<string, unknown>) => void = () => {};
const realDeps = { ...m.deps };
beforeAll(() => {
    m.deps.inPageGate = (() => ({ summary: () => 'fake gate' })) as never;
    m.deps.runGatedProgram = (async (sdk: FakeSdk, name: string, params: Record<string, unknown>, opts: Record<string, unknown>) => {
        gatedCalls.push({ name, params, opts });
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

    test("H4p and S09: at the zoo with S07's knife and log, one receive brings the rune pickaxe and 2 logs; 5 slots used, the band's 4 free", async () => {
        const sdk = new MiningSdk(atZoo(64, ['Knife', 'Logs']));
        const calls: Array<{ partner: string; want: unknown }> = [];
        const real = m.deps.receiveFrom;
        m.deps.receiveFrom = (async (s: FakeSdk, partner: string, o: { want: unknown }) => {
            calls.push({ partner, want: o.want });
            const st = s.state!;
            s.push({ tick: st.tick + 5, inventory: [...st.inventory, item('Rune pickaxe', 2), item('Logs', 3), item('Logs', 4)] });
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
        expect(names(sdk.state!)).toEqual(['Knife', 'Logs', 'Rune pickaxe', 'Logs', 'Logs']);
        expect(28 - sdk.state!.inventory.length).toBe(23);
        expect(kit.postconditions(sdk.state!, {})).toBe(true);
        expect(kit.done!(obs(sdk.state!), {})).toBe(true);
        expect(step('mining.iron-63').preconditions(sdk.state!, {})).toBe(true);
    });

    test("H4p's free-slot precondition counts the kit's 3 and the band's 4; a kit already held trades nothing", async () => {
        const crowded = (n: number) => atZoo(64, ['Knife', ...Array.from({ length: n }, () => 'Shark')]);
        const kit = step('mining.kit: H4p');
        expect(kit.preconditions(crowded(20), {})).toBe(true);
        expect(kit.preconditions(crowded(21), {})).toBe("22 other items: H4p's rune pickaxe and 2 logs and the band need 7 free slots");
        // ores do not count: the band drops them first
        expect(kit.preconditions(atZoo(64, ['Knife', ...Array(20).fill('Shark'), 'Iron ore', 'Iron ore']), {})).toBe(true);
        const held = atZoo(64, ['Rune pickaxe', 'Knife', 'Logs', 'Logs']);
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
