import { describe, expect, test } from 'bun:test';
import { Gatherer, parseCounts, TASKS, withCounts } from './questitems';

/** makes() for the drop tasks reads only the spare rule. */
const gatherer = (spare: boolean) => ({ n: (base: number, extra = 1) => (spare ? base + extra : base) }) as unknown as Gatherer;

describe('questitems counts option', () => {
    test('absent counts leave every task untouched', () => {
        const counts = parseCounts(undefined);
        expect(counts.size).toBe(0);
        expect(withCounts(TASKS.snapegrass!, counts)).toBe(TASKS.snapegrass!);
    });

    test('a count replaces the held target for its item, by name in any case', () => {
        const t = withCounts(TASKS.snapegrass!, parseCounts({ 'snape GRASS': 102 }));
        expect(t.makes(gatherer(true))).toEqual([{ item: 'Snape grass', count: 102 }]);
        expect(t.makes(gatherer(false))).toEqual([{ item: 'Snape grass', count: 102 }]);
        expect(t.id).toBe('snapegrass');
        expect(t.run).toBe(TASKS.snapegrass!.run);
    });

    test('items the count does not name keep the task target', () => {
        const t = withCounts(TASKS.bearmeat!, parseCounts({ 'Snape grass': 102 }));
        expect(t.makes(gatherer(true))).toEqual([{ item: 'Raw bear meat', count: 2 }]);
    });

    test('malformed counts are refused at the boundary', () => {
        expect(() => parseCounts([])).toThrow(/must be an object/);
        expect(() => parseCounts('Snape grass')).toThrow(/must be an object/);
        expect(() => parseCounts(null)).toThrow(/must be an object/);
        expect(() => parseCounts({ 'Snape grass': -1 })).toThrow(/non-negative integer/);
        expect(() => parseCounts({ 'Snape grass': 1.5 })).toThrow(/non-negative integer/);
        expect(() => parseCounts({ 'Snape grass': '100' })).toThrow(/non-negative integer/);
    });

    test("a running task reads its targets from the loop's current task, counts applied", () => {
        // The task's own done check must use the counted target, or a bulk run stops at the default.
        const g = Object.assign(Object.create(Gatherer.prototype) as Gatherer, { spare: true });
        expect(() => g.target('Snape grass')).toThrow(/no task is running/);
        g.current = TASKS.snapegrass!;
        expect(g.target('Snape grass')).toBe(2);
        g.current = withCounts(TASKS.snapegrass!, parseCounts({ 'Snape grass': 102 }));
        expect(g.target('Snape grass')).toBe(102);
        expect(g.wants()).toEqual([{ item: 'Snape grass', count: 102 }]);
        expect(g.target('Raw bear meat')).toBe(0);
    });
});

import type { BotWorldState, NearbyLoc } from '../../sdk/types';
import { contestStep, inContest, MAX_CATCHES_PER_ROUND, nearestBank, pickPipe, pickVine, pipesAssigned, type RoundView, SETS } from './questitems';

const loc = (id: number, distance: number, reachable?: boolean, name = 'Vine'): NearbyLoc => ({ id, name, x: 2631, z: 3497, distance, reachable, optionsWithIndex: [] }) as unknown as NearbyLoc;

describe('pickVine', () => {
    test('the walkable red_worm_vine before a nearer solid vine', () => {
        expect(pickVine([loc(2990, 1, true), loc(58, 2, true)])?.id).toBe(58);
    });
    test('never a vine with no route (the lab run 2 failure), else the nearest', () => {
        expect(pickVine([loc(58, 1, false), loc(2990, 3, true), loc(2991, 2, true)])?.id).toBe(2991);
        expect(pickVine([loc(2990, 1, false), loc(1, 1, true, 'Tree')])).toBeUndefined();
    });
});

describe('pickPipe', () => {
    const pipe = (x: number, distance: number) => ({ id: 41, name: 'Wall Pipe', x, z: 3446, distance, optionsWithIndex: [] }) as unknown as NearbyLoc;
    test('the land tile 2638, not the nearer lake tiles (the lab failure: every use fell on 2637)', () => {
        expect(pickPipe([pipe(2637, 1), pipe(2636, 2), pipe(2638, 2)])?.x).toBe(2638);
    });
    test('none when the land pipe is not in view', () => {
        expect(pickPipe([pipe(2637, 1), pipe(2636, 2)])).toBeUndefined();
    });
});

const round = (r: Partial<RoundView> = {}): RoundView => ({ inside: true, catches: 0, paid: true, atPipes: true, misses: 0, worms: 2, garlic: 1, coins: 20, rod: true, ...r });

describe('contestStep', () => {
    test('enters with worms and the fee, and is done without either', () => {
        expect(contestStep(round({ inside: false }))).toBe('enter');
        expect(contestStep(round({ inside: false, worms: 0 }))).toBe('done');
        expect(contestStep(round({ inside: false, coins: 4 }))).toBe('done');
        // Lab run 3 paid the fee round after round with its rod and garlic left in the bank.
        expect(contestStep(round({ inside: false, garlic: 0 }))).toBe('done');
        expect(contestStep(round({ inside: false, rod: false }))).toBe('done');
    });
    test('a round goes pay, stash, fish', () => {
        expect(contestStep(round({ paid: false, atPipes: false }))).toBe('pay');
        expect(contestStep(round({ atPipes: false }))).toBe('stash');
        expect(contestStep(round())).toBe('fish');
    });
    test('never a third catch: leaves at two', () => {
        expect(MAX_CATCHES_PER_ROUND).toBe(2);
        expect(contestStep(round({ catches: 1, worms: 5 }))).toBe('fish');
        for (const catches of [2, 3, 4]) expect(contestStep(round({ catches, worms: 5 }))).toBe('leave');
    });
    test('leaves a round it did not start, whatever else holds', () => {
        expect(contestStep(round({ catches: null }))).toBe('leave');
        expect(contestStep(round({ catches: null, paid: false, atPipes: false }))).toBe('leave');
    });
    test('leaves when it cannot go on', () => {
        expect(contestStep(round({ worms: 0 }))).toBe('leave');
        expect(contestStep(round({ misses: 2 }))).toBe('leave');
        expect(contestStep(round({ paid: false, coins: 4 }))).toBe('leave');
        expect(contestStep(round({ atPipes: false, garlic: 0 }))).toBe('leave');
    });
    test('never fishes away from the pipes (the stranger\'s spot is the only carp spot)', () => {
        for (const r of [round({ atPipes: false }), round({ atPipes: false, garlic: 0 }), round({ paid: false, atPipes: false })]) expect(contestStep(r)).not.toBe('fish');
    });
});

describe('inContest', () => {
    test('the gate tile and the spots are inside; beyond the gate is not', () => {
        expect(inContest({ x: 2642, z: 3441 })).toBe(true);
        expect(inContest({ x: 2637, z: 3444 })).toBe(true);
        expect(inContest({ x: 2630, z: 3435 })).toBe(true);
        expect(inContest({ x: 2643, z: 3441 })).toBe(false);
        expect(inContest({ x: 2644, z: 3441 })).toBe(false);
    });
});

describe('pipesAssigned', () => {
    const at = (dialogs: { text: string[]; tick: number }[]) => ({ recentDialogs: dialogs.map(d => ({ ...d, interfaceId: 0 })) }) as unknown as BotWorldState;
    test("reads Bonzo's reassignment since the conversation began", () => {
        expect(pipesAssigned(at([{ text: ['Your fishing competition spot is now beside the pipes.'], tick: 105 }]), 100)).toBe(true);
        expect(pipesAssigned(at([{ text: ['Your fishing competition spot is beside the willow tree.'], tick: 105 }]), 100)).toBe(false);
        expect(pipesAssigned(at([{ text: ['Your fishing competition spot is now beside the pipes.'], tick: 90 }]), 100)).toBe(false);
        expect(pipesAssigned(null, 0)).toBe(false);
    });
});

describe('nearestBank', () => {
    test('the nearest on the same land mass', () => {
        expect(nearestBank({ x: 3222, z: 3218 })).toEqual({ x: 3092, z: 3245 }); // Lumbridge -> Draynor
        expect(nearestBank({ x: 2553, z: 3574 })).toEqual({ x: 2725, z: 3491 }); // Barbarian Outpost -> Seers'
        expect(nearestBank({ x: 2641, z: 3171 })).toEqual({ x: 2612, z: 3090 }); // Port Khazard -> Yanille
        expect(nearestBank({ x: 2683, z: 3270 })).toEqual({ x: 2654, z: 3283 }); // Ardougne docks -> Ardougne south
    });
    test('never a mainland bank from Kandarin, though Draynor is nearer to Port Sarim than Seers is', () => {
        expect(nearestBank({ x: 2820, z: 3487 })).toEqual({ x: 2809, z: 3439 }); // tunnel dwarf -> Catherby, not Taverley's side
    });
    test('from Karamja, which has none, the fewest voyages then the nearest', () => {
        expect(nearestBank({ x: 2767, z: 3122 })).toEqual({ x: 2654, z: 3283 }); // Jiminua -> Ardougne south
    });
});

describe('sets', () => {
    test('every task id in a set exists, and ids match keys', () => {
        for (const [name, ids] of Object.entries(SETS)) for (const id of ids) expect(TASKS[id]?.id, `${name}: ${id}`).toBe(id);
    });
    test('the far and carp sets earn their own coins, then train Hitpoints, before going overseas', () => {
        for (const set of [SETS.far!, SETS.carp!]) expect(set.slice(0, 2)).toEqual(['coins', 'hitpoints']);
    });
    test('the carp set never carries more worms into a round than it may catch', () => {
        const g = { counts: new Map(), n: (b: number, e = 1) => b + e, held: () => 0, level: () => 10 } as never;
        const worms = TASKS.carp!.carry!(g).find(w => w.item === 'Red vine worm')!;
        expect(worms.count).toBeLessThanOrEqual(MAX_CATCHES_PER_ROUND);
        expect(TASKS.carp!.stash).toContain('Raw giant carp');
    });
});

describe('far and carp targets', () => {
    const setup = (counts: Record<string, number> = {}, holdings: Record<string, number> = {}) => Object.assign(
        Object.create(Gatherer.prototype) as Gatherer,
        { spare: true, counts: parseCounts(counts), held: (name: string) => holdings[name] ?? 0 },
    );

    test('new shop errands use the running counted target', async () => {
        for (const [id, item, shop] of [['swamppaste', 'Swamp paste', 'khazard'], ['wool', 'Ball of wool', 'aemad'], ['rod', 'Fishing rod', 'gerrant'], ['spade', 'Spade', 'jiminua']]) {
            const calls: unknown[][] = [];
            const g = setup({ [item!]: 5 });
            g.current = withCounts(TASKS[id!]!, parseCounts({ [item!]: 5 }));
            g.buy = async (...args) => { calls.push(args); };
            await g.current.run(g);
            expect(calls[0]?.slice(0, 3)).toEqual([shop, item, 5]);
        }
    });

    test('worm demand follows the carp target, not the spare default', () => {
        const g = setup({ 'Raw giant carp': 7 }, { 'Raw giant carp': 2 });
        expect(TASKS.worms!.makes(g)).toEqual([{ item: 'Red vine worm', count: 5 }]);
        expect(TASKS.carp!.carry!(g).find(w => w.item === 'Red vine worm')?.count).toBe(2);
    });

    test('consumed garlic is not replenished after the carp target is held', () => {
        const g = setup({}, { 'Raw giant carp': 2 });
        expect(TASKS.garlic!.makes(g)).toEqual([]);
    });

    test('every contest trip banks excess worms and ordinary bait before withdrawing two worms', () => {
        expect(TASKS.carp!.stash).toEqual(expect.arrayContaining(['Raw giant carp', 'Red vine worm', 'Fishing bait']));
    });
});

test('Grand Tree descent returns from the grocer to its out-of-view ladder', async () => {
    let at = { x: 2493, z: 3488, level: 1 };
    const walked: number[][] = [];
    const ladder = { id: 1, name: 'Ladder', x: 2466, z: 3495, level: 1, optionsWithIndex: [{ text: 'Climb-down', opIndex: 1 }] };
    const g = new Gatherer({
        signal: new AbortController().signal,
        log: () => {},
        sdk: {
            getState: () => ({ player: { worldX: at.x, worldZ: at.z, level: at.level } }),
            scanNearbyLocs: async () => Math.abs(at.x - ladder.x) < 10 ? [ladder] : [],
        },
        bot: {
            walkTo: async (x: number, z: number) => { walked.push([x, z]); at = { x, z, level: 1 }; return { success: true }; },
            interactLoc: async () => { at.level = 0; return { success: true }; },
        },
    } as never, true, 400);
    g.until = async pred => pred();
    await g.climb('down');
    expect(walked).toEqual([[2466, 3494]]);
    expect(at.level).toBe(0);
});
