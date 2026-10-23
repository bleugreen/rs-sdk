import { afterEach, describe, expect, test } from 'bun:test';
import type { BotWorldState, InventoryItem, NearbyNpc } from '../../sdk/types';
import { baseState, FakeSdk } from '../lib/fake-sdk';
import type { StepContext } from '../runner/step';
import { TickLog } from '../lib/ticks';
import * as grandTree from '../quests/grand-tree';
import * as tgv from '../quests/tree-gnome-village';
import { ROUTES } from '../skills/agility';
import { BANKS } from './buyer';
import { AGILITY_COURSES } from '../../server/webclient/src/bot/programs/agility-courses';
import { AGILITY_TO, ARMOUR, freeSlots, gtPlan, kitBank, lapsDone, stepLoc, KIT_COINS, KIT_SHARKS, kitCheck, kitDeposits, kitWithdraws, logShortfall, mmPlan, nearestWaypoint, parsePhases, PHASES, pickTree, approachFirst, transientFault, noLocError, enterTree, demonReentry, pillarRoute, roomDrops, SHARK_FLOOR, TWIG_SLOTS, inShipyardPocket, nextStoneMove, STONES, ROYAL_SEAL, TGV_KIT, tgvPlan, type QuestPlan } from './quest-helper';
import { applySubstitutes, LEG_PREFIX, withLegs } from '../lab/quests/demo-quest';
import type { NearbyLoc } from '../../sdk/types';

let slot = 0;
const item = (name: string, count = 1, id = 9000 + slot): InventoryItem => ({ slot: slot++, id, name, count, optionsWithIndex: [] }) as unknown as InventoryItem;
const state = (over: Partial<BotWorldState> = {}): BotWorldState => {
    slot = 0;
    return baseState({ tick: 1, ...over });
};
const at = (x: number, z: number, level = 0) => ({ name: 'h', x, z, worldX: x, worldZ: z, level, hp: 99, maxHp: 99 }) as BotWorldState['player'];

const letters = (stepId: string, names: string[]) => names.map(n => new RegExp(`^${stepId}:([A-Z][0-9]?)-`).exec(n)?.[1]);

describe('the plans name real segments, exactly the ruled ones', () => {
    const check = (plan: QuestPlan, stepId: string, names: string[], subs: string[], legs: string[]) => {
        const real = letters(stepId, names);
        expect(Object.keys(plan.substitute).sort()).toEqual([...subs].sort());
        expect(Object.keys(plan.legs).sort()).toEqual([...legs].sort());
        for (const k of [...subs, ...legs]) expect(real).toContain(k);
    };

    test('Tree Gnome Village: A, B, H, K substituted, no legs', () => {
        check(tgvPlan(), tgv.stepId, tgv.steps({ dialogue: 'fixed' }).map(s => s.name), ['A', 'B', 'H', 'K'], []);
    });

    test('The Grand Tree: A, I, N1, N2 substituted; legs before B, C, J and L', () => {
        check(gtPlan(), grandTree.stepId, grandTree.steps({ dialogue: 'fixed' }).map(s => s.name), ['A', 'I', 'N1', 'N2'], ['B', 'C', 'J', 'L']);
    });

    test('Monkey Madness: only A', () => {
        // The MM module is pinned off main (rs/185's e5161ba4), so only the plan's own shape is held here.
        expect(Object.keys(mmPlan().substitute)).toEqual(['A']);
        expect(Object.keys(mmPlan().legs)).toEqual([]);
    });
});

describe('kitCheck', () => {
    const kit = (logs: number, sharks: number, weapon = true) =>
        state({ inventory: [...Array.from({ length: logs }, () => item('Logs')), item('Shark', 1), ...Array.from({ length: sharks - 1 }, () => item('Shark'))], equipment: weapon ? [item('Rune scimitar')] : [] });

    test('passes with the logs, the sharks and the scimitar worn', () => {
        expect(kitCheck(kit(6, TGV_KIT.sharks), TGV_KIT)).toBe(true);
    });
    test('names what is short', () => {
        expect(kitCheck(kit(5, TGV_KIT.sharks), TGV_KIT)).toMatch(/5 logs, needs 6/);
        expect(kitCheck(kit(6, 3), TGV_KIT)).toMatch(/3 sharks/);
        expect(kitCheck(kit(6, TGV_KIT.sharks, false), TGV_KIT)).toMatch(/not worn/);
    });
    test('an adamant longsword serves as the weapon (no rune scimitar on the demo)', () => {
        const s = state({ inventory: [...Array.from({ length: 6 }, () => item('Logs')), ...Array.from({ length: TGV_KIT.sharks }, () => item('Shark'))], equipment: [item('Adamant longsword')] });
        expect(kitCheck(s, TGV_KIT)).toBe(true);
    });
});

describe('kitWithdraws', () => {
    const names = (s: BotWorldState) => kitWithdraws(s).map(w => [String(w.item), w.n]);
    test('an empty pack takes the sharks, the weapon, the axe and the fares', () => {
        expect(names(state({ inventory: [], equipment: [] }))).toEqual([[String(/^Shark$/i), KIT_SHARKS], [String(/^(Rune scimitar|Adamant longsword)$/i), 1], ...ARMOUR.map(a => [String(a), 1]), [String(/^Bronze axe$/i), 1], [String(/^Coins$/i), KIT_COINS]]);
    });
    test('only the shortfall, no axe once the logs are held, nothing for a worn weapon', () => {
        const s = state({ inventory: [item('Shark', 1), ...Array.from({ length: 6 }, () => item('Logs')), item('Coins', 1000)], equipment: [item('Adamant longsword'), item('Adamant chainbody'), item('Adamant platelegs'), item('Adamant full helm')] });
        expect(names(s)).toEqual([[String(/^Shark$/i), KIT_SHARKS - 1]]);
    });
});

describe('substituted checks replace SCORED-only gates', () => {
    test("TGV A: the helper's kit, not H7 (no staff of fire, no runes, Prayer 1)", () => {
        const s = state({
            quests: { tree: 'not_started' } as unknown as BotWorldState['quests'],
            inventory: [...Array.from({ length: 6 }, () => item('Logs')), ...Array.from({ length: TGV_KIT.sharks }, () => item('Shark'))],
            equipment: [item('Rune scimitar')],
            player: at(tgv.ARRIVAL.x, tgv.ARRIVAL.z),
        });
        const a = tgvPlan().substitute.A!;
        expect(a.preconditions!(s, {})).toBe(true);
        expect(a.postconditions!(s, {})).toBe(true);
        expect(tgv.kitCheck(s)).not.toBe(true);
    });

    test('GT A: needs TGV complete and the tree door, not Plague City, Magic or Prayer', () => {
        const a = gtPlan().substitute.A!;
        const door = at(grandTree.TILES.arrival.x, grandTree.TILES.arrival.z);
        expect(a.preconditions!(state({ quests: { tree: 'complete', grandtree: 'not_started' } as unknown as BotWorldState['quests'], player: door }), {})).toBe(true);
        expect(a.preconditions!(state({ quests: { tree: 'started', grandtree: 'not_started' } as unknown as BotWorldState['quests'], player: door }), {})).toMatch(/Tree Gnome Village/);
        expect(a.preconditions!(state({ quests: { tree: 'complete', grandtree: 'not_started' } as unknown as BotWorldState['quests'], player: at(3200, 3200) }), {})).toMatch(/not at the Grand Tree door/);
    });

    test('MM A: both prerequisite quests complete, MM not started (or the seal already held)', () => {
        const a = mmPlan().substitute.A!;
        const q = (mm: string) => ({ tree: 'complete', grandtree: 'complete', mm }) as unknown as BotWorldState['quests'];
        expect(a.preconditions!(state({ quests: q('not_started') }), {})).toBe(true);
        expect(a.preconditions!(state({ quests: q('started') }), {})).toMatch(/Monkey Madness is started/);
        expect(a.preconditions!(state({ quests: q('started'), inventory: [item('Royal seal', 1, ROYAL_SEAL)] }), {})).toBe(true);
        expect(a.preconditions!(state({ quests: { tree: 'complete', grandtree: 'started', mm: 'not_started' } as unknown as BotWorldState['quests'] }), {})).toMatch(/Grand Tree/);
    });
});

describe('parsePhases', () => {
    test('the whole climb by default order, or any in-order subset', () => {
        expect(parsePhases(PHASES.join(','))).toEqual([...PHASES]);
        expect(parsePhases('grandtree, mm')).toEqual(['grandtree', 'mm']);
        expect(parsePhases('kit,logs,agility')).toEqual(['kit', 'logs', 'agility']);
    });
    test('refuses unknown, repeated or out-of-order phases', () => {
        expect(() => parsePhases('agility,plague')).toThrow(/unknown phase "plague"/);
        expect(() => parsePhases('tree,tree')).toThrow(/named twice/);
        expect(() => parsePhases('grandtree,tree')).toThrow(/out of order/);
    });
});

describe('nearestWaypoint', () => {
    test('joins the agility route where it passes nearest, not at Lumbridge', () => {
        const route = ROUTES.spawnToGnome;
        // The Grand Exchange: the route's Falador stretch (Chebyshev 200), not its Lumbridge start.
        const i = nearestWaypoint(route, { x: 3165, z: 3487 });
        expect(i).toBeGreaterThan(0);
        expect(route[i]).toEqual([3000, 3287]);
        expect(nearestWaypoint(route, { x: 3201, z: 3237 })).toBe(0);
    });
});

describe("the kit leaves room for Montai's logs", () => {
    const sharks = (n: number) => Array.from({ length: n }, () => item('Shark'));
    test('the full kit and 6 logs fill the pack exactly', () => {
        const s = state({ inventory: [...sharks(KIT_SHARKS), item('Bronze axe'), item('Coins', KIT_COINS)], equipment: [] });
        expect(freeSlots(s)).toBe(TGV_KIT.logs);
        expect(logShortfall(s)).toBe(0);
    });
    test('the login that stalled: 22 sharks, the bronze longsword, the axe, coins and 3 logs', () => {
        const s = state({ inventory: [item('Bronze longsword'), item('Bronze axe'), ...sharks(22), item('Coins', 300), item('Logs'), item('Logs'), item('Logs')] });
        expect(freeSlots(s)).toBe(0);
        expect(logShortfall(s)).toBe(3);
        const d = kitDeposits(s);
        expect(d.some(p => p.test('Bronze longsword'))).toBe(true);
        expect(d.some(p => p.test('Shark'))).toBe(true);
        for (const keep of ['Bronze axe', 'Coins', 'Logs']) expect(d.some(p => p.test(keep))).toBe(false);
    });
    test('nothing to bank for a pack that is only the kit', () => {
        expect(kitDeposits(state({ inventory: [...sharks(KIT_SHARKS), item('Bronze axe'), item('Coins', 10)] }))).toEqual([]);
    });
    test('an outside item with regex characters banks by its exact name', () => {
        const d = kitDeposits(state({ inventory: [item('Ring of dueling(8)')] }));
        expect(d).toHaveLength(1);
        expect(d[0]!.test('Ring of dueling(8)')).toBe(true);
        expect(d[0]!.test('Ring of dueling(7)')).toBe(false);
    });
});

describe('pickTree', () => {
    const loc = (x: number, z: number, name = 'Tree', op = 'Chop down') => ({ x, z, id: 1276, name, optionsWithIndex: [{ text: op, opIndex: 1 }] }) as unknown as NearbyLoc;
    const here = { x: 3256, z: 3243 };
    test('the nearest choppable tree in range, skipping trees given up on and other locs', () => {
        const near = loc(3258, 3243);
        const far = loc(3262, 3250);
        expect(pickTree([far, near, loc(3257, 3243, 'Dead tree'), loc(3256, 3244, 'Tree', 'Examine')], here, new Set())).toBe(near);
        expect(pickTree([far, near], here, new Set(['3258,3243']))).toBe(far);
    });
    test('none in range is null', () => {
        expect(pickTree([loc(3300, 3243)], here, new Set())).toBeNull();
    });
});

describe('kitBank', () => {
    test('west of the toll gate it never picks Al Kharid, even when nearer', () => {
        // Where login 3 stalled: Al Kharid's bank is 77 tiles off but behind the toll.
        expect(kitBank({ x: 3256, z: 3243 })).toEqual(BANKS.draynor);
    });
    test('inside Al Kharid it banks there', () => {
        expect(kitBank({ x: 3269, z: 3164 })).toEqual(BANKS.alKharid);
    });
});

describe('the Gnome course on lite', () => {
    const gnome = AGILITY_COURSES.gnome!;
    const loc = (id: number, x: number, z: number) => ({ x, z, id, name: 'o', optionsWithIndex: [] }) as unknown as NearbyLoc;
    test('stepLoc clicks the nearest published candidate, else the first', () => {
        const net = gnome.steps.find(s => s.name === 'net')!;
        expect(stepLoc(net, [loc(2285, 2473, 3425), loc(2285, 2475, 3425)], { x: 2476, z: 3427 })).toEqual({ id: 2285, x: 2475, z: 3425 });
        expect(stepLoc(net, [], { x: 2476, z: 3428 })).toEqual({ id: 2285, x: 2473, z: 3425 });
    });
    test('the laps end only at the end of a lap, at or past the level', () => {
        expect(lapsDone(AGILITY_TO - 1, 0)).toBe(false);
        expect(lapsDone(AGILITY_TO, 3)).toBe(false);
        expect(lapsDone(AGILITY_TO, 0)).toBe(true);
        expect(gnome.steps.at(-1)!.xp).toBeGreaterThan(gnome.lapBonus);
    });
});

describe('the walk to a quest and its legs', () => {
    // The driver's own order: substitutes rename the steps first, then the legs are placed.
    const placed = (module: typeof tgv | typeof grandTree, plan: QuestPlan) =>
        withLegs(applySubstitutes(module.steps({ dialogue: 'fixed' }), module.stepId, plan.substitute), module.stepId, plan.legs).map(s => s.name);
    test('each plan places its legs over its substituted module', () => {
        expect(placed(tgv, tgvPlan()).filter(n => n.startsWith(LEG_PREFIX))).toHaveLength(Object.keys(tgvPlan().legs).length);
        const gt = placed(grandTree, gtPlan());
        expect(gt.filter(n => n.startsWith(LEG_PREFIX))).toHaveLength(Object.keys(gtPlan().legs).length);
        expect(gt.some(n => n.startsWith(`${LEG_PREFIX}S11b:B-`))).toBe(true);
    });
    test('the approach runs only before a quest is started', () => {
        const q = (quests: Record<string, string>) => state({ quests: quests as unknown as BotWorldState['quests'] });
        expect(approachFirst(q({ tree: 'not_started' }), 'tree')).toBe(true);
        expect(approachFirst(q({ tree: 'started' }), 'tree')).toBe(false);
        expect(approachFirst(q({ tree: 'complete', grandtree: 'not_started' }), 'grandtree')).toBe(true);
        expect(approachFirst(q({ tree: 'complete', grandtree: 'complete', mm: 'started' }), 'mm')).toBe(false);
    });
});

describe('transientFault', () => {
    test('only the Grand Tree door caught in its open form is retried', () => {
        expect(transientFault('tree door out: no loc with /^open$/i at (2464,3492) near {"x":2465,"z":3494,"level":0}')).toBe(true);
        expect(transientFault('step "S11b:E-narnode" run failed: tree door in: no loc with /^open$/i at (2464,3492)')).toBe(true);
        expect(transientFault("Glough's ladder up: no loc with /^climb-up$/i at (2476,3462)")).toBe(false);
        expect(transientFault('spirit tree to khazard: no arrival at 2555,3259: timeout')).toBe(false);
        expect(transientFault(undefined)).toBe(false);
    });
});

describe('off the shipyard pocket by the stepping stones', () => {
    test('the pocket is the crash site and the shipyard, not Musa Point, Brimhaven or the south bank', () => {
        expect(inShipyardPocket({ x: 2945, z: 3034 })).toBe(true); // inside the yard, where segment I ends
        expect(inShipyardPocket({ x: 2917, z: 3058 })).toBe(true); // the glider crash
        expect(inShipyardPocket({ x: 2954, z: 3148 })).toBe(false); // Musa Point
        expect(inShipyardPocket({ x: 2772, z: 3228 })).toBe(false); // Brimhaven
        expect(inShipyardPocket({ x: 2925, z: 2947 })).toBe(false); // south of the river
    });
    test('north bank, each stone in turn, then the step ashore', () => {
        expect(nextStoneMove({ x: 2940, z: 3041 })).toEqual({ kind: 'walk', to: { x: 2925, z: 2951 } });
        expect(nextStoneMove({ x: 2925, z: 2951 })).toEqual({ kind: 'stone', stone: STONES[0] });
        expect(nextStoneMove({ x: 2925, z: 2950 })).toEqual({ kind: 'stone', stone: STONES[1] });
        expect(nextStoneMove({ x: 2925, z: 2949 })).toEqual({ kind: 'stone', stone: STONES[2] });
        expect(nextStoneMove({ x: 2925, z: 2948 })).toEqual({ kind: 'walk', to: { x: 2925, z: 2947 } });
    });
    test('done once south of the river, including where a slip washes up', () => {
        expect(nextStoneMove({ x: 2925, z: 2947 })).toBeNull();
        expect(nextStoneMove({ x: 2931, z: 2945 })).toBeNull();
    });
    test('the stones run north to south, one tile apart, each a click from the one before', () => {
        expect(STONES.map(s => s.z)).toEqual([2950, 2949, 2948]);
        expect(new Set(STONES.map(s => s.x))).toEqual(new Set([2925]));
    });
});

describe('roomDrops: room for the twigs from the helper\'s own surplus', () => {
    const pack = (sharks: number, extra: string[]) => state({ inventory: [...extra.map(n => item(n)), ...Array.from({ length: sharks }, () => item('Shark'))] });
    const quest = ['Hazelmere\'s scroll', 'Translation book', 'Glough\'s journal', 'Lumber order', 'Glough\'s key', 'Invasion plans', 'Coins'];
    test('login 11\'s full pack: the axe, then three sharks', () => {
        const s = pack(20, [...quest, 'Bronze axe']);
        const r = roomDrops(s, TWIG_SLOTS);
        expect(r.short).toBe(0);
        expect(r.drop.map(i => i.name)).toEqual(['Bronze axe', 'Shark', 'Shark', 'Shark']);
    });
    test('nothing when the room is already free', () => {
        expect(roomDrops(pack(10, quest), TWIG_SLOTS)).toEqual({ drop: [], short: 0 });
    });
    test('never a quest item, never below the shark floor', () => {
        // A full pack: the quest items, filler and one shark over the floor.
        const s = pack(SHARK_FLOOR + 1, [...quest, ...Array.from({ length: 27 - quest.length - SHARK_FLOOR }, () => 'Daconia rock')]);
        expect(s.inventory).toHaveLength(28);
        const r = roomDrops(s, TWIG_SLOTS);
        expect(r.drop.map(i => i.name)).toEqual(['Shark']);
        expect(r.short).toBe(TWIG_SLOTS - 1);
    });
});

// ------------------------------------------------------------------ against a fake server

let ticker: ReturnType<typeof setInterval> | null = null;
afterEach(() => {
    if (ticker) clearInterval(ticker);
    ticker = null;
});
const fakeAt = (x: number, z: number, level: number, over: Partial<BotWorldState> = {}) => {
    const fake = new FakeSdk(baseState({ player: at(x, z, level), ...over }));
    ticker = setInterval(() => fake.tick(), 1);
    const log = TickLog.memory('quest-helper-test');
    return { fake, log, ctx: { sdk: fake, bot: {}, log, session: { sdk: fake, name: 'h', sessionId: 1 } } as unknown as StepContext<any> };
};
const GT = grandTree.TILES;
const demon = { index: 7, name: 'Black demon', x: GT.trapdoor.x, z: GT.trapdoor.z + 6400, optionsWithIndex: [{ text: 'Attack', opIndex: 2 }] } as unknown as NearbyNpc;
const trapdoorLoc = { x: GT.trapdoor.x, z: GT.trapdoor.z, id: 2446, name: 'Trapdoor', optionsWithIndex: [{ text: 'Open', opIndex: 1 }] } as unknown as NearbyLoc;

describe('the transient door fault, on the errors the driver actually throws', () => {
    test('enterTree at the door with the door in its open form (no Open loc) throws an error the retry takes', async () => {
        const { ctx } = fakeAt(GT.doorOutside.x, GT.doorOutside.z, 0);
        const err = await enterTree(ctx).then(() => null, (e: Error) => e.message);
        expect(err).toBe(noLocError('tree door in', GT.door, /^open$/i, { x: GT.doorOutside.x, z: GT.doorOutside.z, level: 0 }));
        expect(transientFault(err!)).toBe(true);
        expect(transientFault(`step "S11b:A-narnode[driver]" run failed: ${err}`)).toBe(true);
    });
    test('other missing locs in the driver are not retried', () => {
        expect(transientFault(noLocError('trapdoor', GT.trapdoor, /^open$/i, { x: 0, z: 0, level: 2 }))).toBe(false);
        expect(transientFault(noLocError('tree door in', GT.door, /^close$/i, { x: 0, z: 0, level: 0 }))).toBe(false);
    });
});

describe('N2 after a drop at stage 130 (the demon gone, the resume walk starting at N2)', () => {
    test('pillarRoute: from the roots, the tree, Glough\'s floor or the platform', () => {
        const s = (x: number, z: number, level: number) => state({ player: at(x, z, level) });
        expect(pillarRoute(s(2487, 3466, 2))).toEqual([]);
        expect(pillarRoute(s(2480, 3463, 1))).toEqual(['climb']);
        expect(pillarRoute(s(2465, 3495, 0))).toEqual(['glough', 'climb']);
        expect(pillarRoute(s(GT.narnodeRoots.x, GT.narnodeRoots.z, 0))).toEqual(['roots', 'glough', 'climb']);
    });
    test('on the platform with no demon: opens the trapdoor again and ends with the demon in sight', async () => {
        const { fake, ctx } = fakeAt(2487, 3466, 2, { nearbyLocs: [trapdoorLoc] });
        fake.onSend = (a, f) => {
            if (a.method === 'sendInteractLoc' && a.args[0] === GT.trapdoor.x) setTimeout(() => f.tick({ player: at(GT.trapdoor.x, GT.trapdoor.z + 6400, 0), nearbyNpcs: [demon], nearbyLocs: [] }), 2);
        };
        expect(await demonReentry(ctx)).toEqual({ climb: [] });
        expect(fake.sent.filter(a => a.method === 'sendInteractLoc').map(a => a.args.slice(0, 2))).toEqual([[GT.trapdoor.x, GT.trapdoor.z]]);
        expect(grandTree.demonInSight(fake.state!)).toBe(true);
    });
    test('with the demon already here (no drop): nothing to replay', async () => {
        const { fake, ctx } = fakeAt(GT.trapdoor.x, GT.trapdoor.z + 6400, 0, { nearbyNpcs: [demon] });
        expect(await demonReentry(ctx)).toBeNull();
        expect(fake.sent).toHaveLength(0);
    });
    test('the N2 substitute itself, entered on the platform with no demon: replays the trapdoor, then kills', async () => {
        const { fake, ctx, log } = fakeAt(2487, 3466, 2, { nearbyLocs: [trapdoorLoc] });
        const live = { ...demon, hp: 120, maxHp: 120 } as NearbyNpc;
        fake.onSend = (a, f) => {
            if (a.method === 'sendInteractLoc' && a.args[0] === GT.trapdoor.x) setTimeout(() => f.tick({ player: at(GT.trapdoor.x, GT.trapdoor.z + 6400, 0), nearbyNpcs: [live], nearbyLocs: [] }), 2);
            if (a.method === 'sendInteractNpc') setTimeout(() => f.tick({ nearbyNpcs: [{ ...live, hp: 0 } as NearbyNpc] }), 2);
        };
        // The old substitute threw 'no black demon in sight' here, the reviewer's stage-130 repro.
        await gtPlan().substitute.N2!.run(ctx);
        const sends = fake.sent.map(a => a.method).filter(m => m === 'sendInteractLoc' || m === 'sendInteractNpc');
        expect(sends[0]).toBe('sendInteractLoc');
        expect(sends).toContain('sendInteractNpc');
        const notes = log.rows.filter(r => r.step === 'S11b:N2-demon[driver]').map(r => r.meta);
        expect(notes[0]).toEqual({ reentry: { climb: [] } });
        expect((notes[1] as { demon: { end: string } }).demon.end).toBe('killed');
    });
});
