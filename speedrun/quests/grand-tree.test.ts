import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { BotSDK } from '../../sdk/index';
import type { BotWorldState, InventoryItem, NearbyLoc, NearbyNpc, PlayerState, QuestJournalState } from '../../sdk/types';
import { PRAYER_INDICES } from '../../sdk/types';
import { QUESTS } from '../data/quest-stages';
import { baseState, drive, FakeSdk, runeNeedProblems, type SentAction } from '../lib/fake-sdk';
import { sumUse } from '../lib/travel';
import { journalProbeName } from '../lib/quests';
import { TickLog } from '../lib/ticks';
import { configId } from '../lib/world';
import { Observation, resolveResume } from '../runner/resume';
import type { Observed, RunnerSession, StepContext } from '../runner/step';
import {
    AGILITY_AFTER, ardougneTeleport, climbToPillars, crossTreeDoor, DEMON_CASTS, DEMON_MAX_CASTS, DEMON_PRAYER, entryCheck, exitCheck, FREE_SLOTS, gtStage, H8, ITEM, kitCheck, PILLARS, resolveOptions, ROOTS,
    RUNE_NEED, RUNE_STAFF, RUNE_USE, searchRoot, steps, TILES, TREE_DOOR_CLICKS, TREE_DOOR_WAIT,
} from './grand-tree';

const prevTick = process.env.SPEEDRUN_TICK_MS;
beforeAll(() => { process.env.SPEEDRUN_TICK_MS = '5'; });
afterAll(() => { if (prevTick === undefined) delete process.env.SPEEDRUN_TICK_MS; else process.env.SPEEDRUN_TICK_MS = prevTick; });

let nextSlot = 0;
function item(name: string, count = 1, ops: string[] = []): InventoryItem {
    return { slot: nextSlot++, id: 1000 + nextSlot, name, count, optionsWithIndex: ops.map((text, i) => ({ text, opIndex: i + 1 })) };
}
const skill = (name: string, level: number, base = level) => ({ name, level, baseLevel: base, experience: 0 });
const player = (x: number, z: number, level = 0): PlayerState => ({ name: 'lab', x, z, worldX: x, worldZ: z, level, hp: 28, maxHp: 28 } as PlayerState);
const locAt = (name: string, x: number, z: number, ops: string[], id = 1): NearbyLoc =>
    ({ id, name, x, z, level: 0, distance: 1, optionsWithIndex: ops.map((text, i) => ({ text, opIndex: i + 1 })), options: ops } as unknown as NearbyLoc);

/** SCORED at the Grand Tree door with the route's levels and H7 leftovers plus H8. */
function routeState(over: Partial<BotWorldState> = {}): BotWorldState {
    nextSlot = 0;
    return baseState({
        tick: 100,
        quests: { tree: 'complete', elena: 'complete' },
        skills: [skill('Attack', 80), skill('Magic', 64), skill('Prayer', 94), skill('Agility', 22), skill('Hitpoints', 28)],
        player: player(TILES.arrival.x, TILES.arrival.z),
        equipment: [item('Staff of fire'), item('Amulet of magic')],
        inventory: [
            item('Law rune', 5), item('Water rune', 4), item('Air rune', 440), item('Fire rune', 1), item('Chaos rune', 40), item('Death rune', 83),
            item('Shark', 1, ['Eat']), item('Shark', 1, ['Eat']), item('Antipoison(4)'), item('Agility potion(4)', 1, ['Drink']),
        ],
        prayers: { activePrayers: Array(15).fill(false), prayerPoints: 94, prayerLevel: 94 },
        ...over,
    });
}

const replaceItem = (s: BotWorldState, name: RegExp, next: InventoryItem | null): InventoryItem[] =>
    s.inventory.flatMap(i => (name.test(i.name) ? (next ? [{ ...next, slot: i.slot }] : []) : [i]));

function ticking(sdk: FakeSdk): () => void {
    const t = setInterval(() => sdk.tick(), 5);
    return () => clearInterval(t);
}

function ctxFor(sdk: FakeSdk): StepContext<unknown> {
    const session = { sdk, bot: {}, name: 'lab', sessionId: 0 } as unknown as RunnerSession;
    return { session, sdk: session.sdk, bot: session.bot, c: {}, log: TickLog.memory('t') };
}

const sentOf = (sdk: FakeSdk, method: string) => sdk.sent.filter(a => a.method === method);
const asSdk = (f: FakeSdk) => f as unknown as BotSDK;

describe('segment table', () => {
    const list = steps();
    test('names are unique, start with S11b: and run A..P', () => {
        const names = list.map(s => s.name);
        expect(new Set(names).size).toBe(names.length);
        expect(names.every(n => n.startsWith('S11b:'))).toBe(true);
        expect(names.map(n => n.slice(5).split('-')[0])).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N1', 'N2', 'O', 'P']);
    });
    test('only N1 (the trapdoor to the demon) is logout-unsafe, and it is the only transient step', () => {
        expect(list.filter(s => !s.logoutSafe).map(s => s.name)).toEqual(['S11b:N1-trapdoor']);
        expect(list.filter(s => !s.done).map(s => s.name)).toEqual(['S11b:N1-trapdoor']);
    });
    test('option defaults: the shared burst dialogue, Fire Bolt; both modes build', () => {
        expect(resolveOptions()).toEqual({ dialogue: 'burst', demonSpell: 'fire_bolt' });
        expect(steps({ dialogue: 'burst' })).toHaveLength(17);
        expect(steps({ dialogue: 'fixed' })).toHaveLength(17);
    });
});

describe('A: entry preconditions and the kit', () => {
    const a = steps()[0]!;
    test('pass on the route inventory', () => {
        expect(a.preconditions(routeState(), {})).toBe(true);
    });
    test('no potion at Agility 22 fails', () => {
        const s = routeState();
        expect(a.preconditions({ ...s, inventory: replaceItem(s, /Agility potion/, null) }, {})).toMatch(/no Agility potion.*22.*needs 25/);
    });
    test('no potion at Agility 25 passes', () => {
        const s = routeState();
        const skills = s.skills.map(k => (k.name === 'Agility' ? skill('Agility', 25) : k));
        expect(kitCheck({ ...s, skills, inventory: replaceItem(s, /Agility potion/, null) })).toBe(true);
    });
    test('8 free slots after the kit fails', () => {
        const s = routeState();
        const filler = Array.from({ length: 28 - s.inventory.length - (FREE_SLOTS - 1) }, () => item('Bones'));
        expect(kitCheck({ ...s, inventory: [...s.inventory, ...filler] })).toMatch(/8 free slots, needs 9/);
    });
    test('Plague City not complete fails', () => {
        expect(entryCheck(routeState({ quests: { tree: 'complete', elena: 'started' } }))).toMatch(/Plague City is not complete/);
    });
    test('chaos below 35 fails with Fire Bolt, not with Fire Blast', () => {
        const s = routeState();
        const low = { ...s, inventory: replaceItem(s, /Chaos rune/, item('Chaos rune', 30)) };
        expect(kitCheck(low)).toMatch(/holds 30 chaos runes \(35 casts\), needs 35/);
        expect(kitCheck(low, { demonSpell: 'fire_blast' })).toBe(true);
    });
    test('the staff of fire must be worn and SCORED must be at the door', () => {
        expect(entryCheck(routeState({ equipment: [] }))).toMatch(/staff of fire/);
        expect(entryCheck(routeState({ player: player(2400, 3400) }))).toMatch(/not at the Grand Tree door/);
    });

    async function runA(opts: { kitFrom?: string }): Promise<{ sdk: FakeSdk; error: string }> {
        const sdk = new FakeSdk(routeState());
        const stop = ticking(sdk);
        try {
            await steps(opts)[0]!.run(ctxFor(sdk));
            return { sdk, error: '' };
        } catch (e) {
            return { sdk, error: String(e) };
        } finally {
            stop();
        }
    }
    test('with no kitFrom, A only checks the kit', async () => {
        const { sdk, error } = await runA({});
        expect(sentOf(sdk, 'sendTradeRequest')).toHaveLength(0);
        expect(error).toMatch(/tree door in: neither tree door/); // past the kit, at the door (no door in this fake world)
    });
    test('with a kitFrom and the kit already held, A does not trade', async () => {
        const { sdk, error } = await runA({ kitFrom: 'Ashburn' });
        expect(sentOf(sdk, 'sendTradeRequest')).toHaveLength(0);
        expect(error).toMatch(/tree door in/);
    });
});

describe('the tree doors: another player has just opened one (gnome_gate.rs2 open_tree_door)', () => {
    // Each door's open form (loc_change for 6 ticks) has no name and no ops.
    const closedL = locAt('Tree Door', TILES.door.x, TILES.door.z, ['Open'], 1967);
    const closedR = locAt('Tree Door', TILES.doorRight.x, TILES.doorRight.z, ['Open'], 1968);
    const openL = locAt('null', TILES.door.x, TILES.door.z, [], 1969);
    const openR = locAt('null', TILES.doorRight.x, TILES.doorRight.z, [], 1970);
    const into = (s: BotWorldState) => s.player!.worldZ >= 3493;
    const outOf = (s: BotWorldState) => s.player!.worldZ <= 3491;

    /** A door click forcemoves SCORED two tiles across; `clicks` gets each click's tick and args. */
    function doorway(x: number, z: number, locs: NearbyLoc[], opts: { pass?: boolean } = {}) {
        const sdk = new FakeSdk(routeState({ player: player(x, z), nearbyLocs: locs }));
        const clicks: Array<{ tick: number; args: unknown[] }> = [];
        sdk.onSend = (a, f) => {
            if (a.method !== 'sendInteractLoc') return;
            clicks.push({ tick: f.state!.tick, args: a.args });
            if (opts.pass !== false) f.tick(s => ({ player: player(s.player!.worldX, s.player!.worldZ + (s.player!.worldZ < 3492 ? 2 : -2)) }));
        };
        return { sdk, clicks };
    }

    test('going in with both doors open: waits for one to close, then clicks it', async () => {
        const { sdk, clicks } = doorway(2465, 3491, [openL, openR]);
        await drive(sdk, crossTreeDoor(asSdk(sdk), 'tree door in', into), 60, s => (s.tick >= 103 ? { nearbyLocs: [closedL, openR] } : {}));
        expect(clicks).toHaveLength(1);
        expect(clicks[0]!.args).toEqual([TILES.door.x, TILES.door.z, 1967, 1]);
        expect(clicks[0]!.tick).toBeGreaterThanOrEqual(103);
        expect(sdk.state!.player!.worldZ).toBe(3493);
    });

    test('going out with both doors open: the right door closes first and is the one clicked', async () => {
        const { sdk, clicks } = doorway(2465, 3493, [openL, openR]);
        await drive(sdk, crossTreeDoor(asSdk(sdk), 'tree door out', outOf), 60, s => (s.tick >= 105 ? { nearbyLocs: [openL, closedR] } : {}));
        expect(clicks).toHaveLength(1);
        expect(clicks[0]!.args).toEqual([TILES.doorRight.x, TILES.doorRight.z, 1968, 1]);
        expect(clicks[0]!.tick).toBeGreaterThanOrEqual(105);
        expect(sdk.state!.player!.worldZ).toBe(3491);
    });

    test('with only the left door open, the right one is clicked at once, no wait', async () => {
        const { sdk, clicks } = doorway(2465, 3491, [openL, closedR]);
        await drive(sdk, crossTreeDoor(asSdk(sdk), 'tree door in', into), 60);
        expect(clicks).toHaveLength(1);
        expect(clicks[0]!.args.slice(0, 3)).toEqual([TILES.doorRight.x, TILES.doorRight.z, 1968]);
        expect(clicks[0]!.tick).toBe(100);
    });

    test('both doors closed: the nearer one, as before', async () => {
        const { sdk, clicks } = doorway(2464, 3493, [closedL, closedR]);
        await drive(sdk, crossTreeDoor(asSdk(sdk), 'tree door out', outOf), 60);
        expect(clicks.map(c => c.args.slice(0, 2))).toEqual([[TILES.door.x, TILES.door.z]]);
    });

    test(`both doors held open past ${TREE_DOOR_WAIT} ticks: refuses with a reason and no click`, async () => {
        const { sdk, clicks } = doorway(2465, 3491, [openL, openR]);
        const err = await drive(sdk, crossTreeDoor(asSdk(sdk), 'tree door in', into).then(() => '', e => String(e)), 60);
        expect(err).toMatch(new RegExp(`tree door in: neither tree door \\(2464,3492\\) nor \\(2466,3492\\) showed Open within ${TREE_DOOR_WAIT} ticks`));
        expect(clicks).toHaveLength(0);
        expect(sdk.state!.tick - 100).toBeLessThanOrEqual(TREE_DOOR_WAIT + 2);
    });

    test(`clicks that never cross stop after ${TREE_DOOR_CLICKS}`, async () => {
        const { sdk, clicks } = doorway(2465, 3493, [closedL, closedR], { pass: false });
        const err = await drive(sdk, crossTreeDoor(asSdk(sdk), 'tree door out', outOf).then(() => '', e => String(e)), 200);
        expect(err).toMatch(new RegExp(`tree door out: ${TREE_DOOR_CLICKS} tree door clicks did not cross`));
        expect(clicks.length).toBeGreaterThanOrEqual(TREE_DOOR_CLICKS);
    });
});

describe('stage observation', () => {
    const stages: ReadonlyArray<{ value: number; journal?: string }> = QUESTS.grandtree.stages;
    const marker = (v: number) => stages.find(s => s.value === v)!.journal;
    const journal = (v: number): QuestJournalState => ({ title: 'The Grand Tree', lines: [marker(v) ?? 'I spoke to Charlie and agreed to search'], open: false, tick: 100 });
    const observed = (v: number, extra: InventoryItem[] = []): Observed => {
        const s = baseState({ inGame: true, quests: { grandtree: v === 160 ? 'complete' : v === 0 ? undefined! : 'started' } as BotWorldState['quests'], inventory: extra });
        if (v === 0) s.quests = {};
        return { state: s, probed: v > 0 && v < 160 ? { [journalProbeName('grandtree')]: journal(v) } : {} };
    };
    const order = () => item('Lumber order');

    test('60 and 90 share no marker: the lumber order decides', () => {
        expect(gtStage(observed(60))).toBe(60);
        expect(gtStage(observed(90, [order()]))).toBe(90);
    });
    test('without a journal, a started quest reads as its lowest started stage', () => {
        expect(gtStage(baseState({ inGame: true, quests: { grandtree: 'started' } }))).toBe(10);
    });

    const list = steps();
    const reading = (v: number) => observed(v, v >= 90 && v < 160 ? [order()] : []);
    const cases: Array<[string, number]> = [
        ['B', 20], ['C', 30], ['D', 40], ['E', 50], ['F', 60], ['G', 70], ['H', 80], ['I', 90], ['J', 100], ['K', 110], ['L', 120], ['M', 130], ['N2', 140], ['O', 150], ['P', 160],
    ];
    for (const [letter, v] of cases) {
        test(`${letter}: done at ${v}, not at ${v - 10}`, () => {
            const step = list.find(s => s.name.slice(5).split('-')[0] === letter)!;
            expect(step.done!(reading(v), {})).toBe(true);
            expect(step.done!(reading(v - 10), {})).toBe(false);
            if (letter !== 'P') expect(step.probes).toEqual(['journal:grandtree']);
        });
    }
    test('A: done once the tab says started', () => {
        expect(list[0]!.done!(observed(10), {})).toBe(true);
        expect(list[0]!.done!(observed(0), {})).toBe(false);
    });
});

describe('M: the climb', () => {
    const refusal = { isOpen: true, options: [], isWaiting: false, allComponents: [{ text: 'You need at least 25 Agility to climb the tree.' }] } as unknown as BotWorldState['dialog'];
    const gloughFloor = (inventory: (s: BotWorldState) => InventoryItem[]) => {
        const s = routeState({ player: player(2477, 3463, 1) });
        return { ...s, inventory: inventory(s), nearbyLocs: [locAt('Tree', TILES.climbTree.x, TILES.climbTree.z, ['Climb-up'])] };
    };

    test('a refusal means another dose and another climb', async () => {
        const sdk = new FakeSdk(gloughFloor(s => s.inventory));
        let climbs = 0;
        const agility = (lv: number) => (s: BotWorldState) => s.skills.map(k => (k.name === 'Agility' ? skill('Agility', lv, 22) : k));
        sdk.onSend = (a: SentAction, f) => {
            if (a.method === 'sendUseItem') f.tick(s => ({ skills: agility(25)(s) }));
            if (a.method === 'sendInteractLoc') {
                climbs++;
                // The first climb lands just after the boost timer took a level.
                if (climbs === 1) f.tick(s => ({ skills: agility(24)(s), dialog: refusal }));
                else f.tick({ player: player(2485, 3465, 2) });
            }
            if (a.method === 'sendClickDialog') f.tick({ dialog: { isOpen: false, options: [], isWaiting: false } });
        };
        const stop = ticking(sdk);
        try {
            expect(await climbToPillars(asSdk(sdk))).toEqual({ doses: 2, refusals: 1 });
        } finally {
            stop();
        }
        expect(sdk.state!.player!.level).toBe(2);
    });

    test('no dose left is a hard error naming the fallback', async () => {
        const sdk = new FakeSdk(gloughFloor(s => replaceItem(s, /Agility potion/, null)));
        const stop = ticking(sdk);
        try {
            await expect(climbToPillars(asSdk(sdk))).rejects.toThrow(/no Agility potion dose left.*lap the Gnome course to 25 in S11a/);
        } finally {
            stop();
        }
        expect(sentOf(sdk, 'sendInteractLoc')).toHaveLength(0);
    });
});

describe('M re-run after some pillars took their twigs', () => {
    const PLATFORM = { x: 2486, z: 3465 };
    const journal: QuestJournalState = { title: 'The Grand Tree', lines: [QUESTS.grandtree.stages.find(s => s.value === 120)!.journal!], open: false, tick: 100 };
    /** Stage 120 on the pillar platform holding the twigs of `held` (PILLARS indices), with the route's Agility potion. */
    function platform(held: readonly number[]): Observed {
        const s = routeState({ player: player(PLATFORM.x, PLATFORM.z, 2), quests: { tree: 'complete', elena: 'complete', grandtree: 'started' } as BotWorldState['quests'] });
        s.inventory.push(item('Lumber order'), ...held.map(i => ({ ...item('Twigs'), id: configId('obj', PILLARS[i]!.twig) })));
        s.nearbyLocs = PILLARS.map((p, i) => locAt('Pillar', p.x, p.z, [], 50 + i));
        return { state: s, probed: { [journalProbeName('grandtree')]: journal } };
    }
    const resumeAt = async (o: Observed) => {
        const obs = new Observation(o.state);
        Object.assign(obs.probed, o.probed);
        return resolveResume(steps(), obs, {});
    };

    for (const held of [[3], [1, 3], [0, 2, 3]] as const) {
        test(`${held.length} of 4 twigs held: the walk resumes M`, async () => {
            const point = await resumeAt(platform(held));
            expect(point.step).toBe('S11b:M-pillars');
            expect(point.mode).toBe('resume');
        });
    }
    test('the normal path is unchanged: all 4 held starts M through run', async () => {
        const point = await resumeAt(platform([0, 1, 2, 3]));
        expect(point.step).toBe('S11b:M-pillars');
        expect(point.mode).toBe('run');
    });
    test('resumed with 2 twigs on the platform, M uses only those two on their own pillars and ends with none', async () => {
        const o = platform([1, 3]);
        const sdk = new FakeSdk(o.state);
        sdk.onSend = (a, f) => {
            if (a.method !== 'sendUseItemOnLoc') return;
            const slot = a.args[0] as number;
            f.tick(s => ({ inventory: s.inventory.filter(i => i.slot !== slot) }));
        };
        const m = steps().find(s => s.name === 'S11b:M-pillars')!;
        await drive(sdk, m.run(ctxFor(sdk)) as Promise<unknown>, 120);
        expect(sentOf(sdk, 'sendUseItemOnLoc').map(a => [a.args[1], a.args[2]])).toEqual([[PILLARS[1].x, PILLARS[1].z], [PILLARS[3].x, PILLARS[3].z]]);
        expect(m.postconditions(sdk.getState()!, {})).toBe(true);
    });
});

describe('B/C: the Ardougne teleport', () => {
    const refuse = (f: FakeSdk) => f.tick(s => ({ gameMessages: [{ type: 0, text: "You haven't learnt how to cast this spell yet.", tick: s.tick + 1, sender: '', fromSelf: false }] as BotWorldState['gameMessages'] }));
    const inNarnodeRoom = (withScroll: boolean) => {
        const s = routeState({ player: player(TILES.narnode.x, TILES.narnode.z) });
        return { ...s, inventory: withScroll ? [...s.inventory, item('A magic scroll', 1, ['Read'])] : s.inventory };
    };

    test('refused with the scroll held: read it and cast again', async () => {
        const sdk = new FakeSdk(inNarnodeRoom(true));
        let casts = 0;
        sdk.onSend = (a, f) => {
            if (a.method === 'sendClickComponent') {
                casts++;
                if (casts === 1) refuse(f);
                else f.tick({ player: player(2661, 3301) });
            }
            if (a.method === 'sendUseItem') {
                f.tick(s => ({ inventory: replaceItem(s, /magic scroll/, null), dialog: { isOpen: true, options: [], isWaiting: false, allComponents: [{ text: 'You memorise what is written on the scroll.' }] } as unknown as BotWorldState['dialog'] }));
            }
            if (a.method === 'sendClickDialog') f.tick({ dialog: { isOpen: false, options: [], isWaiting: false } });
        };
        const stop = ticking(sdk);
        try {
            const r = await ardougneTeleport(asSdk(sdk));
            expect(r.scrollRead).toBe(true);
            expect(r.scroll!.consumed).toBe(true);
            expect(r.scroll!.pages.join(' ')).toMatch(/memorise/);
        } finally {
            stop();
        }
        expect(casts).toBe(2);
        expect(sdk.state!.player!.worldX).toBe(2661);
    });

    test('refused with no scroll: a hard error', async () => {
        const sdk = new FakeSdk(inNarnodeRoom(false));
        sdk.onSend = (a, f) => { if (a.method === 'sendClickComponent') refuse(f); };
        const stop = ticking(sdk);
        try {
            await expect(ardougneTeleport(asSdk(sdk))).rejects.toThrow(/no magic scroll/);
        } finally {
            stop();
        }
    });
});

describe('N: the trapdoor and the demon', () => {
    const trapdoor = locAt('Trapdoor', TILES.trapdoor.x, TILES.trapdoor.z, ['Open'], 7);
    const demon = { kind: 'npc', id: 3, index: 42, name: 'Black demon', combatLevel: 172, x: 2480, z: 9866, distance: 9, hp: 100, optionsWithIndex: [{ text: 'Attack', opIndex: 2 }] } as unknown as NearbyNpc;
    const platform = (npcs: NearbyNpc[] = []) => routeState({ quests: { tree: 'complete', elena: 'complete', grandtree: 'started' }, player: player(2486, 3465, 2), nearbyLocs: [trapdoor], nearbyNpcs: npcs });
    const toggle = (s: BotWorldState) => {
        const active = [...s.prayers.activePrayers];
        active[PRAYER_INDICES.protect_from_melee] = !active[PRAYER_INDICES.protect_from_melee];
        return { prayers: { ...s.prayers, activePrayers: active } };
    };

    test('N1 with a demon already in sight does not open the trapdoor', async () => {
        const sdk = new FakeSdk(platform([demon]));
        const stop = ticking(sdk);
        try {
            await steps()[13]!.run(ctxFor(sdk));
        } finally {
            stop();
        }
        expect(sentOf(sdk, 'sendInteractLoc')).toHaveLength(0);
    });

    test('N2 entered with no demon in sight re-opens the trapdoor, then kills by Fire Bolt', async () => {
        const sdk = new FakeSdk(platform());
        sdk.onSend = (a, f) => {
            if (a.method === 'sendTogglePrayer') f.tick(toggle);
            if (a.method === 'sendInteractLoc') {
                f.tick({ player: player(2491, 9864), nearbyLocs: [locAt('Broken ladder', 2492, 9864, [])] });
                f.tick({ nearbyNpcs: [demon] });
            }
            if (a.method === 'sendSpellOnNpc') f.tick({ nearbyNpcs: [{ ...demon, hp: 0 } as NearbyNpc] });
        };
        const ctx = ctxFor(sdk);
        const stop = ticking(sdk);
        try {
            await steps()[14]!.run(ctx);
        } finally {
            stop();
        }
        const opened = sentOf(sdk, 'sendInteractLoc');
        expect(opened).toHaveLength(1);
        expect(opened[0]!.args.slice(0, 2)).toEqual([TILES.trapdoor.x, TILES.trapdoor.z]);
        expect(sentOf(sdk, 'sendSpellOnNpc')[0]!.args).toEqual([42, 1169]);
        const notes = ctx.log.rows.filter(r => r.kind === 'note' && r.meta && 'demon' in r.meta);
        expect((notes[0]!.meta!.demon as { reopened: boolean; end: string }).reopened).toBe(true);
        expect((notes[0]!.meta!.demon as { end: string }).end).toBe('killed');
        // Prayer on before the trapdoor, off after the kill.
        expect(sentOf(sdk, 'sendTogglePrayer')).toHaveLength(2);
        expect(sdk.state!.prayers.activePrayers[PRAYER_INDICES.protect_from_melee]).toBe(false);
        // The dead demon still in the npc list does not fail the step.
        expect(steps()[14]!.postconditions(sdk.state!, {})).toBe(true);
    });
    test('without the staff of fire worn, N needs the spell\'s fire runes', () => {
        const s = platform();
        expect(steps()[13]!.preconditions(s, {})).toBe(true);
        expect(steps()[14]!.preconditions({ ...s, equipment: [] }, {})).toMatch(/holds 1 fire runes and no staff of fire worn, needs 4/);
        expect(steps({ demonSpell: 'fire_blast' })[14]!.preconditions({ ...s, equipment: [] }, {})).toMatch(/needs 5/);
    });
});

describe('P: searching a root', () => {
    const empty = "You search the root but don't find anything.";
    const msg = (text: string, tick: number, observationId: number) => ({ type: 0, text, tick, observationId, sender: '', fromSelf: false });

    test('an empty root stamped on the click\'s own tick (the browser) is recognised after one click', async () => {
        const [x, z] = ROOTS[10]!;
        // The previous root's reply is already in the history; it must not end this search.
        const s0 = routeState({ player: player(x, z + 1), nearbyLocs: [locAt('Root', x, z, ['Search'], 9)] });
        const sdk = new FakeSdk({ ...s0, gameMessages: [msg(empty, s0.tick - 3, 7)] as BotWorldState['gameMessages'] });
        sdk.onSend = (a, f) => {
            if (a.method === 'sendInteractLoc') f.tick(s => ({ gameMessages: [...s.gameMessages, msg(empty, s.tick, 8)] as BotWorldState['gameMessages'] }));
        };
        const stop = ticking(sdk);
        try {
            expect(await searchRoot(asSdk(sdk), 10)).toBe(false);
        } finally {
            stop();
        }
        expect(sentOf(sdk, 'sendInteractLoc')).toHaveLength(1);
    });
});

describe('P: the exit state', () => {
    const done = (agility: number) => routeState({
        quests: { tree: 'complete', elena: 'complete', grandtree: 'complete' },
        skills: [skill('Attack', 90), skill('Magic', 70), skill('Prayer', 94), skill('Agility', agility), skill('Hitpoints', 30)],
        player: player(TILES.narnodeRoots.x, TILES.narnodeRoots.z + 1),
    });
    test('complete, rewarded and beside Narnode in the roots passes', () => {
        expect(exitCheck(done(AGILITY_AFTER))).toBe(true);
        expect(steps()[16]!.postconditions(done(AGILITY_AFTER), {})).toBe(true);
    });
    test('Agility short of the reward fails', () => {
        expect(exitCheck(done(AGILITY_AFTER - 1))).toMatch(/Agility 74 after the reward/);
    });
    test('still holding the rock or above ground fails', () => {
        const s = done(AGILITY_AFTER);
        expect(exitCheck({ ...s, inventory: [...s.inventory, item('Daconia rock')] })).toMatch(/Daconia rock/);
        expect(exitCheck({ ...s, player: player(TILES.narnode.x, TILES.narnode.z) })).toMatch(/not beside Narnode in the roots/);
    });
});

describe('rune pins: RUNE_USE and RUNE_NEED agree with the kit (tools/rune-pins.ts)', () => {
    test('RUNE_NEED.A is exactly what kitCheck wants held', () => {
        expect(runeNeedProblems(s => kitCheck(s), routeState(), RUNE_NEED.A!)).toEqual([]);
    });
    test("the teleports at B, C and J are H8's law, water and air, J's fire the staff's", () => {
        const h8 = (it: RegExp) => H8.find(w => w.item === it)!.amount;
        expect(sumUse(RUNE_USE.B!, RUNE_USE.C!, RUNE_USE.J!)).toEqual({ lawrune: h8(ITEM.law), waterrune: h8(ITEM.water), airrune: h8(ITEM.air) });
        expect(entryCheck(routeState({ equipment: [] }))).toMatch(new RegExp(RUNE_STAFF, 'i'));
    });
    test("N2's Fire Bolts are the measured maximum, inside the kit's DEMON_CASTS", () => {
        expect(RUNE_USE.N2!.chaosrune).toBe(DEMON_MAX_CASTS);
        expect(DEMON_MAX_CASTS).toBeLessThanOrEqual(DEMON_CASTS);
        expect(RUNE_USE.N2!.firerune).toBeUndefined();
    });
});

describe('the prayer points (rs/687)', () => {
    const n1 = () => steps().find(s => s.name === 'S11b:N1-trapdoor')!;
    const onPlatform = (points: number, extra: InventoryItem[] = []) => {
        const s = routeState({ quests: { tree: 'complete', elena: 'complete', grandtree: 'started' }, player: player(2486, 3465, 2) });
        return { ...s, inventory: [...s.inventory, ...extra], prayers: { ...s.prayers, prayerPoints: points } };
    };
    test('H8 brings a Prayer potion(4) for N2 and S12', () => {
        expect(H8.some(w => String(w.item) === String(/^Prayer potion\(4\)$/i) && w.amount === 1)).toBe(true);
    });
    test('N1 wants the trapdoor scene and the demon: ~35 (N2 used 28 live)', () => {
        expect(DEMON_PRAYER).toBeGreaterThanOrEqual(28 + 5);
        expect(n1().preconditions(onPlatform(DEMON_PRAYER), {})).toBe(true);
        expect(n1().preconditions(onPlatform(4), {})).toBe('S11b:N1 for the trapdoor and the demon needs ~35 prayer points, has 4 and no prayer potion');
        expect(n1().preconditions(onPlatform(4, [item('Prayer potion(4)', 1, ['Drink'])]), {})).toBe(true);
    });
});
