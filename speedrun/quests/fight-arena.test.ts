import { describe, expect, test } from 'bun:test';
import type { BotWorldState, InventoryItem, NearbyLoc, NearbyNpc, PlayerState, QuestJournalState } from '../../sdk/types';
import { configId } from '../lib/world';
import { baseState, drive, FakeSdk, runeNeedProblems } from '../lib/fake-sdk';
import { journalProbeName } from '../lib/quests';
import { TickLog } from '../lib/ticks';
import { Observation, resolveResume } from '../runner/resume';
import type { RunnerSession, StepContext } from '../runner/step';
import {
    ARENA, ARENA_DRINK_BELOW, ARENA_PRAYER, ARRIVAL, caged, castRunes, census, MAX_RERELEASES, released, DEAD_AT_EXIT, entryCheck, exitCheck, fightOptions, LETTERS, MAX_CASTS, MIN_CASTS, observed, QUEST_ITEMS, quest, RUNE_NEED, RUNE_STAFF, RUNE_USE,
    SHAPES, stepId, steps, TILES,
} from './fight-arena';
import { DEFAULT_DIALOGUE, slotNeed } from './segments';

let nextSlot = 0;
const item = (name: string, count = 1): InventoryItem => ({ slot: nextSlot++, id: 1000 + nextSlot, name, count, optionsWithIndex: [] }) as unknown as InventoryItem;
const skill = (name: string, level: number) => ({ name, level, baseLevel: level, experience: 0 });
const player = (x: number, z: number, hp = 36): PlayerState => ({ name: 'lab', x, z, worldX: x, worldZ: z, level: 0, hp, maxHp: 36 }) as PlayerState;

/** The inventory ledger's pack after H9 (STEP-MANIFEST.md): 14 slots, 14 free. */
const h9Pack = (): InventoryItem[] => [
    item('Knife'), item('Water rune', 4), item('Antipoison(3)'), ...Array.from({ length: 5 }, () => item('Shark')), item('Death rune', 84), item('Chaos rune', 9),
    item('Air rune', 353), item('Fire rune', 1), item('Coins', 5), item('Law rune', 2),
];
const WORN = () => [item('Staff of fire'), item('Amulet of magic')];
const UNIFORM = () => [item('Khazard helmet'), item('Khazard armour')];

function world(o: { at?: { x: number; z: number }; inv?: InventoryItem[]; worn?: InventoryItem[]; status?: 'started' | 'complete'; thieving?: number; points?: number } = {}): BotWorldState {
    nextSlot = 0;
    const at = o.at ?? ARRIVAL;
    return baseState({
        tick: 100,
        inGame: true,
        player: player(at.x, at.z),
        skills: [skill('Attack', 94), skill('Magic', 73), skill('Prayer', 94), skill('Hitpoints', 36), skill('Thieving', o.thieving ?? 1)],
        inventory: o.inv ?? h9Pack(),
        equipment: o.worn ?? WORN(),
        quests: o.status ? ({ [quest]: o.status } as BotWorldState['quests']) : ({} as BotWorldState['quests']),
        prayers: { activePrayers: [], prayerPoints: o.points ?? 94, prayerLevel: 94 },
    });
}

/** A journal showing one stage's marker line (quest-stages.ts). */
const journal = (line: string): Pick<QuestJournalState, 'title' | 'lines'> => ({ title: 'Fight Arena', lines: [line] });
const J = {
    started: journal('I should go to the Fight Arena and try to find her family'),
    drunkGuard: journal('One of the guards told me that he really likes Khali Brew'),
    keys: journal("Now I've got the keys I should try to rescue Lady Servil's family"),
    jail: journal("I'm going to have to fight in the Arena"),
    freed: journal('but I ran away. I should go and tell Lady Servil'),
};

const list = steps();
const letterOf = (name: string) => name.split(':')[1]!.split('-')[0]!;
const byLetter = (l: string) => list.find(s => letterOf(s.name) === l)!;

async function resumeAt(s: BotWorldState, j?: Pick<QuestJournalState, 'title' | 'lines'>): Promise<string | null> {
    const o = observed(s, j);
    const obs = new Observation(s);
    Object.assign(obs.probed, o.probed);
    if (!j) obs.probed[journalProbeName(quest)] = null;
    return (await resolveResume(steps({ dialogue: 'fixed' }), obs, {})).step;
}

function ctxFor(sdk: FakeSdk): StepContext<unknown> {
    const session = { sdk, bot: {}, name: 'lab', sessionId: 0 } as unknown as RunnerSession;
    return { session, sdk, bot: session.bot, c: {}, log: TickLog.memory('t') } as unknown as StepContext<unknown>;
}

describe('segment table', () => {
    test('names are unique, start with S12: and run A..K in order', () => {
        expect(stepId).toBe('S12');
        expect(quest).toBe('arena');
        expect(list.map(s => letterOf(s.name))).toEqual([...LETTERS]);
        expect(list.map(s => s.name)).toEqual([
            'S12:A-lady-start', 'S12:B-uniform', 'S12:C-drunk-guard', 'S12:D-khali-brew', 'S12:E-cell-keys', 'S12:F-jeremy',
            'S12:G-ogre', 'S12:H-scorpion', 'S12:I-bouncer', 'S12:J-arena-door', 'S12:K-lady-reward',
        ]);
    });

    test('logout-unsafe exactly from the walk into the arena (F) to out of the arena door (J)', () => {
        expect(list.filter(s => !s.logoutSafe).map(s => letterOf(s.name))).toEqual(['F', 'G', 'H', 'I', 'J']);
    });

    test('every segment but the arena door leaves a durable mark', () => {
        expect(list.filter(s => !s.done).map(s => letterOf(s.name))).toEqual(['J']);
    });

    test('option defaults: the shared burst dialogue; both modes build the same table', () => {
        expect(DEFAULT_DIALOGUE).toBe('burst');
        expect(steps({ dialogue: 'fixed' }).map(s => s.name)).toEqual(list.map(s => s.name));
    });

    test('the fights: Fire Blast under Protect from Melee', () => {
        const o = fightOptions(undefined);
        expect(o.spell).toBe(1181);
        expect(o.prayer).toBe('protect_from_melee');
        expect(o.onDialog).toBeUndefined(); // a death hook's page ends the fight ('stop')
    });

    test('every conversation shape parses', async () => {
        const { parseShape } = await import('../lib/converse');
        for (const s of Object.values(SHAPES)) expect(() => parseShape(s)).not.toThrow();
    });
});

describe('A: the entry preconditions', () => {
    const pre = (s: BotWorldState) => entryCheck(undefined)(s, {});

    test('pass on the arrival tile with the ledger\'s pack after H9', () => {
        expect(pre(world())).toBe(true);
        expect(byLetter('A').preconditions(world(), {})).toBe(true);
    });
    test('off the arrival tile', () => {
        expect(pre(world({ at: { x: 2570, z: 3199 } }))).toMatch(/arrival tile beside Lady Servil/);
    });
    test('already started', () => {
        expect(pre(world({ status: 'started' }))).toMatch(/Fight Arena/);
    });
    test('Fire Blast\'s runes short', () => {
        const s = world();
        s.inventory.find(i => i.name === 'Death rune')!.count = MIN_CASTS - 1;
        expect(pre(s)).toMatch(/runes for 56 Fire Blasts short: 55\/56 death/);
    });
    test('no staff of fire worn: the fire runes must be in the pack', () => {
        expect(castRunes(10)(world({ worn: [item('Amulet of magic')] }), {})).toMatch(/1\/50 fire and no staff of fire worn/);
    });
    test('no coins for the brew', () => {
        expect(pre(world({ inv: h9Pack().filter(i => i.name !== 'Coins') }))).toMatch(/0 coins and no Khali brew/);
    });
    test('no sharks', () => {
        expect(pre(world({ inv: h9Pack().filter(i => i.name !== 'Shark') }))).toMatch(/food: 0 held/);
    });
    test('no runes for T12-13\'s Ardougne teleport', () => {
        expect(pre(world({ inv: h9Pack().filter(i => i.name !== 'Law rune') }))).toMatch(/T12-13's Ardougne teleport/);
    });
    test('Magic below Fire Blast', () => {
        const s = world();
        s.skills = s.skills.map(k => (k.name === 'Magic' ? skill('Magic', 58) : k));
        expect(pre(s)).toMatch(/magic 58\/59/);
    });
});

describe('the free-slot need (addendum 8)', () => {
    test('peak 2: B\'s helmet and armour (worn in B, so held only there)', () => {
        const n = slotNeed(world(), QUEST_ITEMS, LETTERS, 'A');
        expect(n.slots).toBe(2);
        expect(n.peak).toBe('B');
        expect(n.items).toEqual(['1 Khazard helmet', '1 Khazard armour']);
    });
    test('the reward\'s coins merge with the held stack; with none held they take a slot at K beside the keys', () => {
        const keys = [...h9Pack().filter(i => i.name !== 'Coins'), item('Khazard cell keys')];
        expect(slotNeed(world({ inv: keys }), QUEST_ITEMS, LETTERS, 'K')).toEqual({ slots: 1, peak: 'K', items: ['1 Coins'] });
        expect(slotNeed(world({ inv: [...keys, item('Coins', 3)] }), QUEST_ITEMS, LETTERS, 'K').slots).toBe(0);
    });
    test('the keys leave at K, the brew at E, the uniform at B: no `until` past where the item leaves', () => {
        const until = Object.fromEntries(QUEST_ITEMS.map(q => [q.name, q.until ?? null]));
        expect(until).toEqual({ 'Khazard helmet': 'B', 'Khazard armour': 'B', 'Khali brew': 'E', 'Khazard cell keys': 'K', Coins: null });
    });
    test('a pack one slot short of B\'s uniform is refused at A, naming the shortfall', () => {
        const full = [...h9Pack(), ...Array.from({ length: 13 }, () => item('Bucket'))];
        expect(entryCheck(undefined)(world({ inv: full }), {})).toBe('inventory: segment B needs 2 free slots (1 Khazard helmet, 1 Khazard armour), 1 free: 1 short');
    });
});

describe('resume: from coordinates, the journal, the inventory and the worn set', () => {
    test('nothing done on the arrival tile: A', async () => {
        expect(await resumeAt(world())).toBe('S12:A-lady-start');
    });
    test('started, no uniform: B', async () => {
        expect(await resumeAt(world({ status: 'started' }), J.started)).toBe('S12:B-uniform');
    });
    test('the uniform worn (stage 2 has no journal marker): C', async () => {
        expect(await resumeAt(world({ status: 'started', worn: [...WORN(), ...UNIFORM()], at: TILES.chestStand }))).toBe('S12:C-drunk-guard');
    });
    test('stage 3 holding the brew at the bar: E', async () => {
        const inv = [...h9Pack().filter(i => i.name !== 'Coins'), item('Khali brew')];
        expect(await resumeAt(world({ status: 'started', inv, worn: [...WORN(), ...UNIFORM()], at: TILES.barman }), J.drunkGuard)).toBe('S12:E-cell-keys');
    });
    test('stage 3 without the brew: D', async () => {
        expect(await resumeAt(world({ status: 'started', worn: [...WORN(), ...UNIFORM()], at: TILES.drunkGuard }), J.drunkGuard)).toBe('S12:D-khali-brew');
    });
    test('the keys held beside the drunk guard: F', async () => {
        const inv = [...h9Pack().filter(i => i.name !== 'Coins'), item('Khazard cell keys')];
        expect(await resumeAt(world({ status: 'started', inv, worn: [...WORN(), ...UNIFORM()], at: TILES.drunkGuard }), J.keys)).toBe('S12:F-jeremy');
    });
    test('stage 9 in the cell (a logout there is harmless): H', async () => {
        const inv = [...h9Pack().filter(i => i.name !== 'Coins'), item('Khazard cell keys')];
        expect(await resumeAt(world({ status: 'started', inv, at: { x: 2600, z: 3142 } }), J.jail)).toBe('S12:H-scorpion');
    });
    test('stage 12 still in the arena: J', async () => {
        expect(await resumeAt(world({ status: 'started', at: { x: ARENA.x0 + 10, z: ARENA.z0 + 5 } }), J.freed)).toBe('S12:J-arena-door');
    });
    test('stage 12 out of the arena door: K', async () => {
        expect(await resumeAt(world({ status: 'started', at: { x: 2607, z: 3151 } }), J.freed)).toBe('S12:K-lady-reward');
    });
    test('complete with the keys still held: K (it only drops them)', async () => {
        const inv = [...h9Pack(), item('Khazard cell keys')];
        expect(await resumeAt(world({ status: 'complete', inv, at: TILES.lady }))).toBe('S12:K-lady-reward');
    });
    test('complete and the keys dropped: finished', async () => {
        expect(await resumeAt(world({ status: 'complete', at: TILES.lady }))).toBeNull();
    });
});

describe('K: the exit', () => {
    const done = () => world({ status: 'complete', thieving: 57, at: TILES.lady, worn: [...WORN(), ...UNIFORM()], inv: [...h9Pack().filter(i => i.name !== 'Coins'), item('Coins', 1000)] });
    const post = (s: BotWorldState) => exitCheck(s, {});

    test('passes complete, Thieving 57, by Lady Servil, nothing open, no keys', () => {
        expect(post(done())).toBe(true);
    });
    test('the cell keys are the one dead item: still held fails', () => {
        expect(DEAD_AT_EXIT.map(String)).toEqual([String(/^Khazard cell keys$/i)]);
        const s = done();
        s.inventory.push(item('Khazard cell keys'));
        expect(post(s)).toBe('exit: still holding Khazard cell keys');
    });
    test('Thieving short of the reward\'s 57 fails', () => {
        expect(post(world({ status: 'complete', at: TILES.lady }))).toMatch(/thieving 1\/57/);
    });
    test('a dialogue or the quest scroll still open fails', () => {
        expect(post({ ...done(), modalOpen: true })).toMatch(/still open/);
    });
    test('a resumed K with the quest complete only drops the keys (no talk, no walk), then logs the census', async () => {
        const s = done();
        s.inventory.push(item('Khazard cell keys'));
        const keys = s.inventory.at(-1)!;
        const sdk = new FakeSdk(s);
        let drop = false;
        sdk.onSend = a => { if (a.method === 'sendDropItem') drop = true; };
        const ctx = ctxFor(sdk);
        await drive(sdk, byLetter('K').run(ctx) as Promise<unknown>, 20, st => (drop ? { inventory: st.inventory.filter(i => i.slot !== keys.slot) } : {}));
        expect(sdk.sent.map(a => a.method)).toEqual(['sendDropItem']);
        expect(sdk.sent[0]!.args).toEqual([keys.slot]);
        expect(post(sdk.getState()!)).toBe(true);
        const noteRow = ctx.log.rows.find(r => r.kind === 'note' && r.step === 'S12:K');
        expect((noteRow?.meta as { exitCensus: { free: number } }).exitCensus.free).toBe(14);
    });
    test('the census lists every slot in order, the free count and the worn set', () => {
        const c = census(done());
        expect(c.slots[0]).toMatch(/^\d+: Knife x1$/);
        expect(c.slots.at(-1)).toMatch(/^\d+: Coins x1000$/);
        expect(c.slots.length).toBe(14);
        expect(c.free).toBe(14);
        expect(c.worn).toEqual(['Staff of fire', 'Amulet of magic', 'Khazard helmet', 'Khazard armour']);
    });
});

describe('rune pins: RUNE_USE and RUNE_NEED agree with the entry check (tools/rune-pins.ts)', () => {
    test('RUNE_NEED.A is exactly what entryCheck wants held: MIN_CASTS Fire Blasts and T12-13\'s Ardougne', () => {
        expect(runeNeedProblems(s => entryCheck(undefined)(s, {}), world(), RUNE_NEED.A!)).toEqual([]);
    });
    test('the fights use the measured maximum, inside MIN_CASTS, their fire the staff\'s', () => {
        expect(RUNE_USE.G!.deathrune).toBe(MAX_CASTS);
        expect(MAX_CASTS).toBeLessThanOrEqual(MIN_CASTS);
        expect(RUNE_USE.G!.firerune).toBeUndefined();
        expect(castRunes(1)(world({ worn: [] }), {})).toMatch(new RegExp(RUNE_STAFF, 'i'));
    });
});

describe('H and I: a target still in its cage (rs/693)', () => {
    const scorpion = (x: number, z: number) => ({ kind: 'npc', id: 2, index: 9, name: 'Khazard Scorpion', x, z, tileX: x, tileZ: z, size: 2, distance: 3, hp: 40, maxHp: 40, optionsWithIndex: [{ text: 'Attack', opIndex: 2 }], options: ['Attack'] }) as unknown as NearbyNpc;
    const arenaDoor = (): NearbyLoc => ({ id: configId('loc', 'fightarena_door2'), name: 'Door', x: TILES.arenaDoor.x, z: TILES.arenaDoor.z, level: 0, distance: 1, optionsWithIndex: [{ text: 'Open', opIndex: 1 }], options: ['Open'] }) as NearbyLoc;

    test('caged: east of the gate line (x 2606|2607), the release tile and the arena are not', () => {
        expect(caged(scorpion(2607, 3159))).toBe(true);
        expect(caged(scorpion(2608, 3160))).toBe(true);
        expect(caged(scorpion(2606, 3159))).toBe(false);
        expect(caged(scorpion(2603, 3156))).toBe(false);
    });

    test('released: out of its cage within the wait, no door', async () => {
        const sdk = new FakeSdk({ ...world({ at: { x: 2603, z: 3155 } }), nearbyNpcs: [scorpion(2607, 3159)], nearbyLocs: [arenaDoor()] });
        let t = 0;
        const ran = await drive(sdk, released(ctxFor(sdk), /^Khazard Scorpion$/i, 'Khazard scorpion'), 30, () => (++t === 3 ? { nearbyNpcs: [scorpion(2606, 3159)] } : {}));
        expect(ran).toBe(false);
        expect(sdk.sent).toEqual([]);
    });

    test('released: still caged after the wait, the arena door from inside runs the release again', async () => {
        const sdk = new FakeSdk({ ...world({ at: TILES.arenaDoorInside }), nearbyNpcs: [scorpion(2608, 3160)], nearbyLocs: [arenaDoor()] });
        let releaseAt = -1;
        sdk.onSend = (a, f) => {
            if (a.method === 'sendInteractLoc' && a.args[0] === TILES.arenaDoor.x && a.args[1] === TILES.arenaDoor.z) releaseAt = f.state!.tick + 3;
        };
        const ran = await drive(sdk, released(ctxFor(sdk), /^Khazard Scorpion$/i, 'Khazard scorpion'), 60, s => (releaseAt >= 0 && s.tick + 1 >= releaseAt ? { nearbyNpcs: [scorpion(2606, 3159)] } : {}));
        expect(ran).toBe(true);
        expect(sdk.sent.filter(a => a.method === 'sendInteractLoc').map(a => a.args.slice(0, 2))).toEqual([[TILES.arenaDoor.x, TILES.arenaDoor.z]]);
        expect(MAX_RERELEASES).toBe(2);
    });
});

describe('G-J: the prayer points (rs/687)', () => {
    const inArena = { x: ARENA.x0 + 10, z: ARENA.z0 + 5 };
    const g = (points: number, extra: InventoryItem[] = []) => byLetter('G').preconditions(world({ status: 'started', at: inArena, points, inv: [...h9Pack(), ...extra] }), {});

    test('the stretch need covers the measured 32-38 for G-J, and the fights drink below 8', () => {
        expect(ARENA_PRAYER).toBeGreaterThanOrEqual(38);
        expect(fightOptions(undefined).drinkBelow).toBe(ARENA_DRINK_BELOW);
    });
    test('G refuses a pool that cannot carry the sealed stretch, naming it at the step boundary', () => {
        expect(g(ARENA_PRAYER)).toBe(true);
        // Attempt 3's rehearsal reached G with 4 points and no potion (host, 03:44Z).
        expect(g(4)).toBe('S12:G for G-J needs ~45 prayer points, has 4 and no prayer potion');
    });
    test("H8's Prayer potion(4) covers it: 4 points + 4 doses at Prayer 94", () => {
        expect(g(4, [{ ...item('Prayer potion(4)'), optionsWithIndex: [{ text: 'Drink', opIndex: 1 }] } as InventoryItem])).toBe(true);
        expect(g(4, [item('Prayer potion(1)')])).toBe('S12:G for G-J needs ~45 prayer points, has 4 and 1 potion doses (34 in all)');
    });
});
