import { describe, expect, test } from 'bun:test';
import type { BotWorldState, InventoryItem, PlayerState, QuestJournalState } from '../../sdk/types';
import * as pathfinding from '../../sdk/pathfinding';
import { baseState } from '../lib/fake-sdk';
import { configId } from '../lib/world';
import { Observation, resolveResume } from '../runner/resume';
import {
    ARMOURLESS_COST, atLeast, ELVARG_PRAYERS, entryCheck, keyDropped, kitItems, LETTERS, mazeMove, questItems, onCrandor, PROBES, quest, restockWait, SCAVVO_RESTOCK,
    stepId, steps, stockZeroChoice, TILES, usablePrayers, wornKitCheck,
} from './dragon-slayer';
import { kitWant, slotNeed } from './segments';

let slot = 0;
const item = (name: string, count = 1, id = 10_000 + slot) => ({ slot: slot++, id, name, count, optionsWithIndex: [] }) as unknown as InventoryItem;
const obj = (debug: string, name: string, count = 1) => item(name, count, configId('obj', debug));
const part = (n: 1 | 2 | 3) => obj(`mappart${n}`, 'Map part');

const LEVELS = { Attack: 99, Strength: 97, Defence: 89, Hitpoints: 97, Magic: 99, Prayer: 99 };
const WORN = () => [item('Mithril scimitar'), item('Adamant full helm'), item('Amulet of strength')];
const KIT = () => [
    item('Coins', 126_000), item("Wizard's mind bomb"), item('Silk'), item('Lobster pot'), item('Unfired bowl'),
    item('Plank'), item('Plank'), item('Plank'), item('Nails', 12), item('Hammer'),
    ...Array.from({ length: 10 }, () => item('Shark')), item('Law rune', 2), item('Air rune', 6), item('Earth rune'), item('Water rune'),
];

function world(o: { at?: [number, number, number?]; inv?: InventoryItem[]; worn?: InventoryItem[]; status?: 'started' | 'complete'; qp?: number; prayer?: number } = {}): BotWorldState {
    const [x, z, level] = o.at ?? [TILES.arrival.x, TILES.arrival.z, 0];
    return baseState({
        inGame: true,
        player: { name: 'lab', worldX: x, worldZ: z, level: level ?? 0, hp: 97, maxHp: 97 } as PlayerState,
        skills: Object.entries({ ...LEVELS, Prayer: o.prayer ?? LEVELS.Prayer }).map(([name, lv]) => ({ name, level: lv, baseLevel: lv, experience: 0 })),
        inventory: o.inv ?? [],
        equipment: o.worn ?? WORN(),
        quests: o.status ? { [quest]: o.status } : {},
        questPoints: o.qp ?? 32,
    });
}

/** A journal at a stage's marker line (quest-stages.ts), or a markerless one (stages 2-3). */
const journal = (line: string, tick = 100): QuestJournalState => ({ title: 'Dragon Slayer', lines: [line], open: false, tick });
const J = {
    one: journal('I should speak to Oziach, who lives by the cliffs'),
    briefed: journal('I need to find the three pieces of the map and an anti-dragon shield'),
    repaired: journal('I have repaired my ship using wooden planks and steel nails. I still need to find a captain'),
    mapGiven: journal('Now I should go to my ship in Port Sarim and set sail for Crandor'),
    sailed: journal('Now all I need to do is kill the dragon'),
};

async function resumeAt(s: BotWorldState, j?: QuestJournalState): Promise<string | null> {
    const obs = new Observation(s);
    for (const p of PROBES) obs.probed[p] = j ?? null;
    const r = await resolveResume(steps({ dialogue: 'fixed' }), obs, {});
    return r.step;
}

const armour = () => [item('Rune chainbody'), item('Rune platelegs')];
const shield = () => item('Dragonfire shield');

describe('segments', () => {
    test('A-L, named S26:<letter>-<label>, unique, all logout-safe (every varp is scope=perm)', () => {
        const s = steps();
        expect(stepId).toBe('S26');
        expect(quest).toBe('dragon');
        expect(s.map(x => x.name)).toEqual([
            'S26:A-kit', 'S26:B-guildmaster', 'S26:C-scavvo', 'S26:D-oziach', 'S26:E-oracle-chest', 'S26:F-duke',
            'S26:G-maze', 'S26:H-wormbrain', 'S26:I-ship', 'S26:J-ned', 'S26:K-voyage', 'S26:L-elvarg',
        ]);
        expect(new Set(s.map(x => x.name)).size).toBe(s.length);
        expect(s.every(x => x.logoutSafe)).toBe(true);
        // Every segment but the kit (spent later) and nothing else leaves a durable mark.
        expect(s.filter(x => !x.done).map(x => x.name)).toEqual(['S26:A-kit']);
    });

    test('the dialogue option reaches the steps (fixed and burst build the same segments)', () => {
        expect(steps({ dialogue: 'burst' }).map(x => x.name)).toEqual(steps({ dialogue: 'fixed' }).map(x => x.name));
    });
});

describe('entry and kit', () => {
    test('the entry: 32 QP, not started, gear levels, at the guild door', () => {
        expect(entryCheck(world())).toBe(true);
        expect(entryCheck(world({ qp: 31 }))).toMatch(/31 quest points/);
        expect(entryCheck(world({ status: 'started' }))).toMatch(/already started/);
        expect(entryCheck(world({ at: [3213, 3424] }))).toMatch(/not at the Champions' Guild door/);
    });

    test('the kit: H22 as listed, with Scavvo coins only when buying', () => {
        expect(kitWant(world({ inv: KIT() }), kitItems())).toEqual([]);
        expect(kitItems().find(k => String(k.item).includes('Coins'))!.n).toBe(126_000);
        expect(kitItems({ buyArmour: false }).find(k => String(k.item).includes('Coins'))!.n).toBe(12_000);
        expect(kitWant(world({ inv: KIT().filter(i => i.name !== 'Silk') }), kitItems()).map(w => String(w.item))).toEqual(['/^Silk$/i']);
        expect(wornKitCheck(world())).toBe(true);
        expect(wornKitCheck(world({ worn: [item('Rune scimitar'), item('Adamant full helm'), item('Amulet of strength')] }))).toBe(true);
        expect(wornKitCheck(world({ worn: [] }))).toMatch(/scimitar, adamant full helm, amulet of strength/);
    });

    test('the first segment checks the entry and the kit; the last checks the exit state', () => {
        const s = steps();
        expect(s[0]!.preconditions(world({ inv: KIT() }), {})).toBe(true);
        expect(s[0]!.postconditions(world({ inv: KIT() }), {})).toBe(true);
        expect(s[0]!.postconditions(world({ inv: [] }), {})).toMatch(/kit missing/);
        const last = s.at(-1)!;
        expect(last.postconditions(world({ status: 'complete', at: [TILES.exit.x, TILES.exit.z] }), {})).toBe(true);
        expect(last.postconditions(world({ status: 'started' }), {})).toMatch(/not complete/);
        expect(last.postconditions({ ...world({ status: 'complete' }), modalOpen: true }, {})).toMatch(/reward page/);
    });

    test("the exit state holds no maze key, and a kill without the drop resumes at L", async () => {
        const last = steps().at(-1)!;
        const done = world({ status: 'complete', at: [TILES.exit.x, TILES.exit.z] });
        const keyed = world({ status: 'complete', at: [TILES.exit.x, TILES.exit.z], inv: [item('Shark'), item('Maze key')] });
        expect(keyDropped(done)).toBe(true);
        expect(last.postconditions(keyed, {})).toMatch(/maze key is still held/);
        expect(await resumeAt(keyed)).toBe('S26:L-elvarg');
    });
});

describe('free slots (addendum 8)', () => {
    // The inventory ledger's S26 start: H22 (the kit; no Varrock set, so no fire rune) and the m'speak amulet, 3 free.
    const ledger = () => [...KIT(), item("M'speak amulet")];

    test('the letters are the segments', () => {
        expect(steps().map(s => s.name.slice(4, 5))).toEqual([...LETTERS]);
    });

    test("the ledger's start covers the step: the peak is Scavvo's two pieces at C", () => {
        expect(28 - ledger().length).toBe(3);
        expect(slotNeed(world({ inv: ledger() }), questItems(), LETTERS, 'A')).toEqual({ slots: 2, peak: 'C', items: ['1 Rune chainbody', '1 Rune platelegs'] });
        expect(steps()[0]!.preconditions(world({ inv: ledger() }), {})).toBe(true);
        expect(steps()[0]!.preconditions(world({ inv: [...ledger(), item('Bucket'), item('Pot')] }), {})).toBe('inventory: segment C needs 2 free slots (1 Rune chainbody, 1 Rune platelegs), 1 free: 1 short');
    });

    test('the four items the magic door takes make room for the maze; without the armour the peak moves to E', () => {
        // A full pack at G that still holds the magic-door items: they are gone by G, so the coloured key
        // and parts 1 and 2 fit. Stacks are never credited (a remainder may survive).
        expect(questItems().filter(q => q.stackable && q.until !== undefined)).toEqual([]);
        // The slot the Varrock set freed is filled with a non-quest item, so the pack is full.
        const full = world({ status: 'started', inv: [...ledger(), item('Maze key'), part(3), item('Bucket')] });
        expect(28 - full.inventory.length).toBe(0);
        expect(slotNeed(full, questItems(), LETTERS, 'G').slots).toBe(0);
        expect(steps()[6]!.preconditions(full, {})).toBe(true);
        // Without the armour the peak is E: a hand-in is held through the segment that takes it, so E counts
        // Oziach's key and part 3 before the four door items are credited (conservative, and within 3 free).
        expect(slotNeed(world({ inv: ledger() }), questItems({ buyArmour: false }), LETTERS, 'A')).toEqual({ slots: 2, peak: 'E', items: ['1 Maze key', '1 Map part 3'] });
    });

    test('every kit line has a hand-in segment', () => {
        expect(() => questItems()).not.toThrow();
        expect(questItems().filter(q => q.from === 'A').length).toBe(kitItems().length);
    });
});

describe('stage evidence', () => {
    test('items show stage 2: the key, a map part, the map or the shield', () => {
        expect(atLeast(world({ status: 'started' }), 'spoken_to_oziach')).toBe(false);
        expect(atLeast(world({ status: 'started', inv: [item('Maze key')] }), 'spoken_to_oziach')).toBe(true);
        expect(atLeast(world({ status: 'started', inv: [part(3)] }), 'spoken_to_oziach')).toBe(true);
        expect(atLeast(world({ status: 'started', worn: [shield()] }), 'spoken_to_oziach')).toBe(true);
    });

    test('the later stages need the journal; complete passes everything', () => {
        const s = world({ status: 'started' });
        const view = (j: QuestJournalState) => ({ state: s, probed: { [PROBES[0]]: j } });
        expect(atLeast(s, 'repaired_ship')).toBe(false);
        expect(atLeast(view(J.repaired), 'repaired_ship')).toBe(true);
        expect(atLeast(view(J.repaired), 'ned_given_map')).toBe(false);
        expect(atLeast(view(J.sailed), 'ned_given_map')).toBe(true);
        expect(atLeast(world({ status: 'complete' }), 'sailed_to_crandor')).toBe(true);
    });
});

describe('resume: each segment after the one before it', () => {
    const stage2 = (inv: InventoryItem[], worn = [...WORN(), ...armour()], at: [number, number, number?] = [3069, 3516]) => world({ status: 'started', inv, worn, at });
    const cases: Array<[string, BotWorldState, QuestJournalState | undefined, string]> = [
        ['at the door with the kit', world({ inv: KIT() }), undefined, 'S26:B-guildmaster'],
        ['after the Guildmaster', world({ status: 'started', inv: KIT(), at: [3191, 3361] }), J.one, 'S26:C-scavvo'],
        ['after Scavvo', world({ status: 'started', inv: KIT(), worn: [...WORN(), ...armour()], at: [3188, 3355, 1] }), J.one, 'S26:D-oziach'],
        ['after Oziach', stage2([...KIT(), item('Maze key')]), J.briefed, 'S26:E-oracle-chest'],
        ['after the mine chest', stage2([...KIT().slice(5), item('Maze key'), part(3)], undefined, [3057, 9840]), J.briefed, 'S26:F-duke'],
        ['after the Duke', stage2([item('Coins', 12_000), item('Maze key'), part(3)], [...WORN(), ...armour(), shield()], [3212, 3220, 1]), J.briefed, 'S26:G-maze'],
        ['after the maze', stage2([item('Coins', 12_000), item('Maze key'), part(3), part(1)], [...WORN(), ...armour(), shield()], [2942, 3248]), J.briefed, 'S26:H-wormbrain'],
        ['after Wormbrain', stage2([item('Coins', 2000), item('Plank', 3), item('Nails', 12), item('Hammer'), item('Crandor map')], [...WORN(), ...armour(), shield()], [3014, 3189]), J.briefed, 'S26:I-ship'],
        ['after the repair', stage2([item('Crandor map'), item('Hammer')], [...WORN(), ...armour(), shield()], [3047, 3203]), J.repaired, 'S26:J-ned'],
        ['after Ned', stage2([item('Hammer')], [...WORN(), ...armour(), shield()], [3100, 3257]), J.mapGiven, 'S26:K-voyage'],
        ['after the voyage', stage2([item('Shark', 10)], [...WORN(), ...armour(), shield()], [TILES.lairGateOutside.x, TILES.lairGateOutside.z]), J.sailed, 'S26:L-elvarg'],
    ];
    for (const [label, s, j, want] of cases) test(label, async () => expect(await resumeAt(s, j)).toBe(want));

    test('the quest complete: nothing left', async () => {
        expect(await resumeAt(world({ status: 'complete', at: [TILES.exit.x, TILES.exit.z] }))).toBeNull();
    });

    test('a stock-0 go-on without the armour does not send the walk back to Scavvo', async () => {
        expect(await resumeAt(stage2([...KIT(), item('Maze key')], WORN()), J.briefed)).toBe('S26:E-oracle-chest');
    });
});

describe('the death path', () => {
    // death.rs2: the three priciest items are kept, in the inventory; the respawn is Lumbridge.
    const dead = () => world({ status: 'started', inv: [item('Rune platelegs'), item('Rune chainbody'), item('Adamant full helm')], worn: [], at: [3222, 3218] });

    test('a death after sailing resumes at Elvarg, not at the Duke the lost shield would point to', async () => {
        expect(await resumeAt(dead(), J.sailed)).toBe('S26:L-elvarg');
    });

    test('the respawn is off Crandor, which is what sends segment L on the return route', () => {
        expect(onCrandor(dead())).toBe(false);
        expect(onCrandor(world({ at: [TILES.lairGateOutside.x, TILES.lairGateOutside.z] }))).toBe(true);
        expect(onCrandor(world({ at: [2851, 3235] }))).toBe(true);
    });
});

describe('Scavvo at stock 0', () => {
    test('the restock wait is the longest missing half-rate (World.ts:1377, champions_guild.inv)', () => {
        expect(SCAVVO_RESTOCK).toEqual({ chainbody: 15_000, platelegs: 11_500 });
        expect(restockWait(['platelegs'])).toBe(5750);
        expect(restockWait(['chainbody', 'platelegs'])).toBe(7500);
        expect(restockWait([])).toBe(0);
    });

    test('the rule takes the cheaper branch', () => {
        expect(stockZeroChoice(7500, ARMOURLESS_COST)).toBe('go-on');
        expect(stockZeroChoice(5, 30)).toBe('wait');
        expect(stockZeroChoice(30, 30)).toBe('go-on');
    });
});

describe('Elvarg', () => {
    test('the prayers SCORED has the level for', () => {
        expect(usablePrayers(world(), {})).toEqual([...ELVARG_PRAYERS]);
        expect(usablePrayers(world({ prayer: 40 }), {})).toEqual(['ultimate_strength', 'incredible_reflexes']);
        expect(usablePrayers(world(), { elvargPrayers: [] })).toEqual([]);
    });
});

describe("Melzar's Maze rooms (offline pathfinder, every maze door shut)", () => {
    // The collision-map load runs here, at collection, not in a hook: bun holds beforeAll to the same
    // 5 s timeout as a test, and the load is a one-off that took 0.2 s on an idle host and 4.8 s on a
    // loaded one. The test's own bound then covers only the 15 path searches (~0.1 s idle).
    pathfinding.initPathfinding();
    const at = (x: number, z: number, level = 0, inv: InventoryItem[] = []) => mazeMove(world({ at: [x, z, level], inv }))?.label ?? null;
    test('each room maps to its move', () => {
        expect(at(2940, 3248)).toBe('rat, red door');
        expect(at(2940, 3248, 0, [part(1)])).toBe('front door out');
        expect(at(2925, 3253)).toBe('ladder up');
        expect(at(2927, 3252, 1)).toBe('ghost, orange door');
        expect(at(2932, 3253, 1)).toBe('ladder up');
        expect(at(2929, 3254, 2)).toBe('skeleton, yellow door');
        expect(at(2924, 3248, 2)).toBe('ladder down');
        expect(at(2938, 3240, 1)).toBe('ladder down');
        expect(at(2937, 3240)).toBe('cellar ladder');
        expect(at(2933, 9640)).toBe('zombie, blue door');
        expect(at(2930, 9643)).toBe('Melzar, magenta door');
        expect(at(2929, 9652)).toBe('demon, green door');
        expect(at(2935, 9656)).toBe('chest, exit ladder');
        expect(at(2939, 3256, 0, [part(1)])).toBe('exit door');
        expect(at(2942, 3248)).toBeNull();
    }, 10_000);
});
