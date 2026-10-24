import { beforeEach, describe, expect, test } from 'bun:test';
import type { BotWorldState, InventoryItem, PlayerState } from '../../sdk/types';
import { baseState, drive, FakeSdk } from '../lib/fake-sdk';
import { resolveStart, type StepContext } from '../runner/step';
import * as dragonSlayer from './dragon-slayer';
import * as fightArena from './fight-arena';
import * as mageArena from './mage-arena';
import * as treeGnomeVillage from './tree-gnome-village';
import type { Step } from '../runner/step';
import {
    antipoisonDrunkAt, cureDose, curePoison, entryCure, entryCured, HITMARK_POISON, noteAntipoison, noteSessionStart, poisoned, poisonSeenAt, poisonUnknown, POISON_PERIOD, POISON_WINDOW,
    allOf, baseLevels, DEFAULT_DIALOGUE, doseRestore, drinkPrayerTo, freeSlots, kitSegment, kitWant, prayerCovers, prayerReserve, questSteps, segmentName, slotNeed, slotsCover, stageAtLeast, stageDone,
    talkShape, within, type QuestItem, type Segment,
} from './segments';

const item = (slot: number, name: string, count = 1) => ({ slot, id: slot, name, count, optionsWithIndex: [] }) as unknown as InventoryItem;
const seg = (letter: string, label: string, extra: Partial<Segment> = {}): Segment => ({ letter, label, logoutSafe: true, run: async () => {}, ...extra });
const ctxOf = (sdk: FakeSdk) => ({ sdk, c: {} }) as unknown as StepContext<any>;

describe('questSteps', () => {
    test('names are <stepId>:<letter>-<label>, in order, and runSteps can start at any of them', () => {
        const steps = questSteps('S15', [seg('A', 'narnode'), seg('B', 'daero-orders', { logoutSafe: false })]);
        expect(steps.map(s => s.name)).toEqual(['S15:A-narnode', 'S15:B-daero-orders']);
        expect(steps.map(s => s.logoutSafe)).toEqual([true, false]);
        expect(resolveStart(steps, 'S15:B-daero-orders')).toBe(1);
        expect(segmentName('S11b', 'H2', 'glough')).toBe('S11b:H2-glough');
    });

    test('checks default to passing; done, inProgress, resume and probes pass through only when given', async () => {
        let resumed = false;
        const done = () => true;
        const [a, b] = questSteps('S20', [
            seg('A', 'start'),
            seg('B', 'slug', { done, inProgress: () => false, resume: async () => { resumed = true; }, probes: ['journal:seaslug'] }),
        ]);
        const s = baseState();
        expect(a!.preconditions(s, {})).toBe(true);
        expect(a!.postconditions(s, {})).toBe(true);
        expect('done' in a!).toBe(false);
        expect(b!.done).toBe(done);
        expect(b!.probes).toEqual(['journal:seaslug']);
        await b!.resume!(ctxOf(new FakeSdk()));
        expect(resumed).toBe(true);
    });

    test('rejects bad ids, letters, labels and repeats', () => {
        expect(() => questSteps('S15:x', [seg('A', 'a')])).toThrow(/bad step id/);
        expect(() => questSteps('S15', [])).toThrow(/no segments/);
        expect(() => questSteps('S15', [seg('a', 'x')])).toThrow(/bad segment letter/);
        expect(() => questSteps('S15', [seg('A', 'Narnode Start')])).toThrow(/bad label/);
        expect(() => questSteps('S15', [seg('A', 'x'), seg('A', 'y')])).toThrow(/repeats segment A/);
    });
});

describe('options', () => {
    test('talkShape bursts by default and not in fixed mode', () => {
        expect(DEFAULT_DIALOGUE).toBe('burst');
        expect(talkShape(undefined, '2c, opt, 3c')).toEqual({ shape: '2c, opt, 3c', burst: true });
        expect(talkShape({ dialogue: 'fixed' }, '9c')).toEqual({ shape: '9c', burst: false });
    });
});

describe('checks', () => {
    const at = (x: number, z: number, level = 0) => baseState({ player: { worldX: x, worldZ: z, level } as PlayerState });

    test('within judges by coordinates and level', () => {
        const zoo = within({ x0: 2590, z0: 3260, x1: 2610, z1: 3290 }, 'the zoo');
        expect(zoo(at(2600, 3270), {})).toBe(true);
        expect(zoo(at(2600, 3270, 1), {})).toMatch(/not in the zoo/);
        expect(zoo(at(2500, 3270), {})).toMatch(/at 2500,3270 L0/);
    });

    test('baseLevels names every short skill', () => {
        const s = baseState({ skills: [{ name: 'Ranged', level: 60, baseLevel: 50, experience: 0 }, { name: 'Prayer', level: 40, baseLevel: 40, experience: 0 }] });
        expect(baseLevels({ ranged: 50 })(s, {})).toBe(true);
        expect(baseLevels({ ranged: 50, prayer: 43, magic: 1 })(s, {})).toBe('base levels short: prayer 40/43, magic 0/1');
    });

    test('stage checks read the published quest state', () => {
        const s = baseState({ quests: { cook: 'started' } } as Partial<BotWorldState>);
        expect(stageAtLeast('cook', 'started')(s, {})).toBe(true);
        expect(stageAtLeast('cook', 'complete')(s, {})).not.toBe(true);
        expect(stageDone('cook', 'started')({ state: s, probed: {} }, {})).toBe(true);
    });

    test('allOf returns the first failure', () => {
        const fail = (m: string) => () => m;
        expect(allOf(undefined, () => true)(baseState(), {})).toBe(true);
        expect(allOf(() => true, fail('one'), fail('two'))(baseState(), {})).toBe('one');
    });
});

describe('kitSegment', () => {
    const KIT = [{ item: /^law rune$/i, n: 10 }, { item: 'Banana' }];

    test('kitWant lists only the missing amounts', () => {
        const s = baseState({ inventory: [item(0, 'Law rune', 4), item(1, 'Banana')] });
        expect(kitWant(s, KIT)).toEqual([{ item: /^law rune$/i, amount: 6 }]);
    });

    test('a held kit is only checked: nothing is sent, even with a giver', async () => {
        const sdk = new FakeSdk(baseState({ inventory: [item(0, 'Law rune', 10), item(1, 'Banana', 2)] }));
        const [kit] = questSteps('S15', [kitSegment({ kitFrom: 'cairn_helper' }, KIT)]);
        expect(kit!.name).toBe('S15:A-kit');
        expect(kit!.logoutSafe).toBe(true);
        expect('done' in kit!).toBe(false);
        await kit!.run(ctxOf(sdk));
        expect(sdk.sent).toEqual([]);
        expect(kit!.postconditions(sdk.state!, {})).toBe(true);
    });

    test('missing with no giver fails, naming what is missing', async () => {
        const sdk = new FakeSdk(baseState({ inventory: [item(0, 'Law rune', 4)] }));
        const [kit] = questSteps('S15', [kitSegment(undefined, KIT)]);
        await expect(kit!.run(ctxOf(sdk))).rejects.toThrow(/missing 6 x \/\^law rune\$\/i, 1 x Banana and no kitFrom/);
        expect(kit!.postconditions(sdk.state!, {})).toMatch(/^kit missing/);
    });

    test('missing with a giver asks receiveFrom for the missing amounts', async () => {
        const sdk = new FakeSdk(baseState({ inventory: [] }));
        const [kit] = questSteps('S15', [kitSegment({ kitFrom: 'cairn_helper' }, KIT, { openTimeoutMs: 50 })]);
        await expect(kit!.run(ctxOf(sdk))).rejects.toThrow(/receiveFrom cairn_helper failed \(player_not_found\) wanting 10 x/);
    });

    test('the entry preconditions, letter and label are the module\'s', () => {
        const [kit] = questSteps('S11b', [kitSegment(undefined, KIT, { letter: 'A', label: 'narnode-kit', preconditions: () => 'TGV not complete' })]);
        expect(kit!.name).toBe('S11b:A-narnode-kit');
        expect(kit!.preconditions(baseState(), {})).toBe('TGV not complete');
    });
});

describe('slotNeed and slotsCover', () => {
    const letters = ['A', 'B', 'C', 'D', 'E'];
    const pack = (...names: string[]) => baseState({ inventory: names.map((n, i) => item(i, n)) });
    const filled = (n: number, ...names: string[]) => pack(...names, ...Array.from({ length: n - names.length }, () => 'Bucket'));

    test('an unstackable item takes a slot each; a stack takes one', () => {
        const items: QuestItem[] = [{ item: /^railing$/i, name: 'Railing', n: 6, from: 'A', until: 'B' }, { item: /^cannonball$/i, n: 200, stackable: true, from: 'A' }];
        expect(slotNeed(pack(), items, letters, 'A')).toEqual({ slots: 7, peak: 'A', items: ['6 Railing', '200 /^cannonball$/i'] });
    });

    test('what is already held counts against the need, a held stack fully', () => {
        const items: QuestItem[] = [{ item: /^railing$/i, n: 6, from: 'A', until: 'B' }, { item: /^coins$/i, n: 500, stackable: true, from: 'A' }];
        expect(slotNeed(pack('Railing', 'Railing', 'Coins'), items, letters, 'A').slots).toBe(4);
    });

    test('items taken mid-quest free their slots: the need is the peak, not the sum', () => {
        const items: QuestItem[] = [
            { item: 'Railing', n: 6, from: 'A', until: 'B' },
            { item: 'Remains', from: 'C', until: 'C' },
            { item: 'Tool kit', from: 'D' },
            { item: 'Notes', n: 2, from: 'E' },
        ];
        expect(slotNeed(pack(), items, letters, 'A')).toMatchObject({ slots: 6, peak: 'A' });
        // From C on the railings are behind the step: the peak is E's kit and notes.
        expect(slotNeed(pack(), items, letters, 'C')).toEqual({ slots: 3, peak: 'E', items: ['1 Tool kit', '2 Notes'] });
        // An item received before `at` is not asked for again, held or spent.
        expect(slotNeed(pack(), items, letters, 'E')).toEqual({ slots: 2, peak: 'E', items: ['2 Notes'] });
    });

    test('what the pack holds now and hands back mid-quest frees its slots for later segments', () => {
        const items: QuestItem[] = [
            { item: 'Bomb', from: 'A', until: 'B' },
            { item: /^coins$/i, n: 500, stackable: true, from: 'A', until: 'B' },
            { item: 'Key', n: 3, from: 'C' },
        ];
        // Bomb and coins are held and gone by C, so two of C's three keys go in their slots.
        expect(slotNeed(pack('Bomb', 'Coins'), items, letters, 'A')).toEqual({ slots: 1, peak: 'C', items: ['3 Key'] });
        // Nothing held: the bomb and the stack come in at A and leave by C; the keys need three.
        expect(slotNeed(pack(), items, letters, 'A')).toMatchObject({ slots: 3, peak: 'C' });
        // A config id picks one of several same-named items.
        expect(slotNeed(pack('Map part'), [{ item: 0, from: 'A', until: 'A' }, { item: 1, from: 'B' }], letters, 'A')).toMatchObject({ slots: 0 });
    });

    test('nothing to receive needs nothing; an unknown letter throws', () => {
        expect(slotNeed(pack(), [], letters, 'A')).toEqual({ slots: 0, peak: null, items: [] });
        expect(() => slotNeed(pack(), [{ item: 'x', from: 'Z' }], letters, 'A')).toThrow(/segment Z/);
    });

    test('slotsCover passes at the need exactly and names the shortfall below it', () => {
        const items: QuestItem[] = [{ item: 'Railing', name: 'Railing', n: 6, from: 'B', until: 'C' }];
        const check = slotsCover(items, letters, 'A');
        expect(freeSlots(filled(22))).toBe(6);
        expect(check(filled(22), {})).toBe(true);
        expect(check(filled(24), {})).toBe('inventory: segment B needs 6 free slots (6 Railing), 4 free: 2 short');
    });
});

describe('prayer points (rs/687)', () => {
    const potion = (slot: number, doses: number) => ({ ...item(slot, `Prayer potion(${doses})`), optionsWithIndex: [{ text: 'Drink', opIndex: 1 }] }) as InventoryItem;
    const at = (points: number, inv: InventoryItem[] = [], level = 99) =>
        baseState({ tick: 10, prayers: { activePrayers: [], prayerPoints: points, prayerLevel: level }, inventory: inv });

    /** The server's side of a drink: a dose's restore on the next tick, the potion one dose down, a vial after the last. */
    function potionServer(sdk: FakeSdk, opts: { ignore?: number } = {}): void {
        let ignore = opts.ignore ?? 0;
        sdk.onSend = a => {
            if (a.method !== 'sendUseItem' || ignore-- > 0) return;
            setTimeout(() => sdk.tick(s => {
                const it = s.inventory.find(i => i.slot === a.args[0])!;
                const left = Number(/\((\d)\)/.exec(it.name)![1]) - 1;
                const next = left ? { ...it, name: `Prayer potion(${left})` } : { ...it, name: 'Vial', optionsWithIndex: [] };
                const p = s.prayers;
                return { inventory: s.inventory.map(i => (i === it ? next : i)), prayers: { ...p, prayerPoints: Math.min(p.prayerLevel, p.prayerPoints + doseRestore(p.prayerLevel)) } };
            }), 1);
        };
    }

    test('a dose restores 7 + level/4: 31 at Prayer 99, 30 at 94 (consume_effects.dbrow)', () => {
        expect(doseRestore(99)).toBe(31);
        expect(doseRestore(94)).toBe(30);
    });

    test('the reserve is the points plus every held dose at its restore', () => {
        expect(prayerReserve(at(4))).toBe(4);
        expect(prayerReserve(at(4, [potion(0, 4)]))).toBe(4 + 124);
        expect(prayerReserve(at(10, [potion(0, 2), potion(1, 1)], 94))).toBe(10 + 3 * 30);
    });

    test('prayerCovers refuses naming the need, the points and the doses', () => {
        const g = prayerCovers('S12:G for G-J', 45);
        expect(g(at(45), {})).toBe(true);
        expect(g(at(4), {})).toBe('S12:G for G-J needs ~45 prayer points, has 4 and no prayer potion');
        expect(g(at(4, [potion(0, 1)]), {})).toBe('S12:G for G-J needs ~45 prayer points, has 4 and 1 potion doses (35 in all)');
        expect(g(at(4, [potion(0, 2)]), {})).toBe(true);
    });

    test('drinkPrayerTo drinks one dose at a time until the target, each confirmed before the next', async () => {
        const sdk = new FakeSdk(at(4, [potion(0, 4)]));
        potionServer(sdk);
        expect(await drinkPrayerTo(sdk, 45)).toBe(2);
        expect(sdk.state!.prayers.prayerPoints).toBe(66);
        expect(sdk.state!.inventory[0]!.name).toBe('Prayer potion(2)');
        expect(sdk.sent.filter(a => a.method === 'sendUseItem').map(a => a.args)).toEqual([[0, 1], [0, 1]]);
    });

    test('the target is capped at the level; it stops when the doses run out, leaving the vial', async () => {
        const sdk = new FakeSdk(at(50, [potion(3, 1)]));
        potionServer(sdk);
        expect(await drinkPrayerTo(sdk, 500)).toBe(1);
        expect(sdk.state!.prayers.prayerPoints).toBe(81);
        expect(sdk.state!.inventory.map(i => i.name)).toEqual(['Vial']);
    });

    test('no drink at or above the target, or with no potion held', async () => {
        const full = new FakeSdk(at(99, [potion(0, 4)]));
        expect(await drinkPrayerTo(full, 99)).toBe(0);
        const none = new FakeSdk(at(0));
        expect(await drinkPrayerTo(none, 8)).toBe(0);
        expect([...full.sent, ...none.sent]).toEqual([]);
    });

    test('a drink dropped by a scene delay is re-sent after 3 ticks and lands', async () => {
        const sdk = new FakeSdk(at(4, [potion(0, 4)]));
        potionServer(sdk, { ignore: 1 });
        const run = drinkPrayerTo(sdk, 8);
        for (let i = 0; i < 4; i++) setTimeout(() => sdk.tick(), 2 + i);
        expect(await run).toBe(1);
        expect(sdk.state!.prayers.prayerPoints).toBe(35);
        expect(sdk.sent.filter(a => a.method === 'sendUseItem')).toHaveLength(2);
    });

    test('never clicks while a chat page is open (a pack click closes it): waits, then gives up without a drink', async () => {
        const s = at(4, [potion(0, 4)]);
        const sdk = new FakeSdk({ ...s, dialog: { ...s.dialog, isOpen: true } });
        potionServer(sdk);
        const run = drinkPrayerTo(sdk, 8, 3);
        for (let i = 0; i < 5; i++) setTimeout(() => sdk.tick(), 2 + i);
        expect(await run).toBe(0);
        expect(sdk.sent).toEqual([]);
    });

    test('a drink that never lands throws, naming the points and the doses', async () => {
        const sdk = new FakeSdk(at(0, [potion(0, 4)]));
        potionServer(sdk, { ignore: 1 });
        const run = drinkPrayerTo(sdk, 8, 3);
        for (let i = 0; i < 5; i++) setTimeout(() => sdk.tick(), 2 + i);
        await expect(run).rejects.toThrow(/drink did not land in 3 ticks \(0 points, 4 doses\)/);
    });
});

describe('poison: the published evidence, the shared dose record and the entry cure (rs/755)', () => {
    beforeEach(() => noteAntipoison(-Infinity));
    const hit = (tick: number, hitmark = HITMARK_POISON) =>
        ({ tick, type: 'damage_taken', damage: 2, hitmark, sourceType: 'npc', sourceIndex: -1, targetType: 'player', targetIndex: -1 }) as BotWorldState['combatEvents'][number];
    const msg = (tick: number) => ({ type: 0, text: 'You have been poisoned!', tick, sender: '', fromSelf: false }) as unknown as BotWorldState['gameMessages'][number];
    const potion = (slot: number, name: string) => ({ slot, id: slot, name, count: 1, optionsWithIndex: [{ text: 'Drink', opIndex: 1 }] }) as unknown as InventoryItem;
    const poisonedBare = () => baseState({ tick: 300, combatEvents: [hit(295)] });

    test('a poison hitsplat on the player or the poisoned message is evidence; a hit, an npc splat or no type is not', () => {
        expect(poisonSeenAt(baseState({ combatEvents: [hit(90), hit(95, 1)] }))).toBe(90);
        expect(poisonSeenAt(baseState({ gameMessages: [msg(97)], combatEvents: [hit(90)] }))).toBe(97);
        expect(poisonSeenAt(baseState({ combatEvents: [{ ...hit(90), targetType: 'npc' }, { ...hit(91), hitmark: undefined }] }))).toBe(-Infinity);
    });

    test('poisoned: evidence newer than the last dose and within a poison period (+2) of now', () => {
        const s = (tick: number, at: number) => baseState({ tick, combatEvents: [hit(at)] });
        expect(POISON_WINDOW).toBe(POISON_PERIOD + 2);
        expect(poisoned(s(100, 100))).toBe(true);
        expect(poisoned(s(100 + POISON_WINDOW, 100))).toBe(true);
        expect(poisoned(s(101 + POISON_WINDOW, 100))).toBe(false); // the hit due by now never came: worn off
        noteAntipoison(100);
        expect(antipoisonDrunkAt()).toBe(100);
        expect(poisoned(s(110, 100))).toBe(false); // that dose cured it, whoever drank it
        expect(poisoned(s(130, 129))).toBe(true); // a hit after the dose: it did not land, or a new poisoning
        expect(poisoned(s(110, 100), -Infinity)).toBe(true);
    });

    test("cureDose: a plain Antipoison before any Superantipoison (rs/186), the fewest doses first within a kind; none held, null", () => {
        expect(cureDose(baseState({ inventory: [potion(0, 'Superantipoison(4)'), potion(1, 'Antipoison(3)')] }))?.name).toBe('Antipoison(3)');
        expect(cureDose(baseState({ inventory: [potion(0, 'Superantipoison(1)'), potion(1, 'Antipoison(3)'), potion(2, 'Antipoison(1)')] }))?.name).toBe('Antipoison(1)');
        expect(cureDose(baseState({ inventory: [potion(0, 'Superantipoison(4)'), potion(1, 'Superantipoison(1)')] }))?.name).toBe('Superantipoison(1)');
        expect(cureDose(baseState({ inventory: [potion(0, 'Prayer potion(1)'), potion(1, 'Vial')] }))).toBeNull();
    });

    test('curePoison: clean drinks nothing; poisoned drinks one dose, re-sent once when the first is dropped, and notes it; none held says so', async () => {
        const clean = new FakeSdk(baseState({ inventory: [potion(4, 'Antipoison(2)')] }));
        expect(await curePoison(clean as never, 'T')).toBe('clean');
        expect(clean.sent).toEqual([]);

        const sdk = new FakeSdk(baseState({ tick: 200, inventory: [potion(4, 'Antipoison(2)')], combatEvents: [hit(195)] }));
        let dropped = 1; // the first drink is lost to a scene's delay
        sdk.onSend = (a, f) => {
            if (a.method === 'sendUseItem' && dropped-- <= 0) f.state = { ...f.state!, inventory: [potion(4, 'Antipoison(1)')] };
        };
        expect(await drive(sdk, curePoison(sdk as never, 'T'), 10)).toBe('cured');
        expect(sdk.sent.map(a => a.args)).toEqual([[4, 1], [4, 1]]);
        expect(antipoisonDrunkAt()).toBeGreaterThanOrEqual(200);
        expect(poisoned(sdk.state!)).toBe(false);

        noteAntipoison(-Infinity);
        expect(await curePoison(new FakeSdk(poisonedBare()) as never, 'T')).toBe('none-held');
    });

    test("a client reload (its tick restarts) drops the dose record: the carried poison reads as on, ahead of the old dose or past it", () => {
        const carried = (tick: number) => baseState({ tick, combatEvents: [hit(32)] });
        // The old session drank at t=37 and ran on to t=66.
        noteAntipoison(37);
        expect(poisoned(baseState({ tick: 66 }))).toBe(false);
        // Restarted: the lab's case, A checked at t=38, past the old dose's tick.
        expect(poisoned(carried(38))).toBe(true);
        expect(antipoisonDrunkAt()).toBe(-Infinity);
        // Ahead of the clock with no restart seen yet (the first look after a reload).
        noteAntipoison(-Infinity);
        noteAntipoison(37);
        expect(poisoned(carried(36))).toBe(true);
        expect(antipoisonDrunkAt(36)).toBe(-Infinity);
        // Within one session the record holds.
        noteAntipoison(40);
        expect(poisoned(carried(41))).toBe(false);
    });

    test("curePoison returns once the drink's p_delay is over (its doses-left message), not when the slot changes", async () => {
        const sdk = new FakeSdk(baseState({ tick: 200, inventory: [potion(4, 'Antipoison(2)')], combatEvents: [hit(195)] }));
        sdk.onSend = (a, f) => {
            if (a.method === 'sendUseItem') f.state = { ...f.state!, inventory: [potion(4, 'Antipoison(1)')] };
        };
        const left = { type: 0, text: 'You have 1 dose of potion left.', tick: 203, sender: '', fromSelf: false } as unknown as BotWorldState['gameMessages'][number];
        expect(await drive(sdk, curePoison(sdk as never, 'T'), 10, s => (s.tick + 1 === 203 ? { gameMessages: [left] } : {}))).toBe('cured');
        expect(sdk.state!.tick).toBe(203);
    });

    test('entryCured: the poison check first, naming the shortfall; a held dose passes it, and the run drinks before the body', async () => {
        const order: string[] = [];
        const [k] = questSteps('S10b', entryCured('S10b', ['K'], [seg('K', 'warlord', { preconditions: () => 'other', run: async () => { order.push('body'); } })]));
        expect(k!.preconditions(poisonedBare(), {})).toBe('S10b:K entered poisoned with no antipoison held');
        expect(k!.preconditions({ ...poisonedBare(), inventory: [potion(2, 'Antipoison(3)')] }, {})).toBe('other');
        expect(k!.preconditions(baseState(), {})).toBe('other');
        const sdk = new FakeSdk({ ...poisonedBare(), inventory: [potion(2, 'Antipoison(3)')] });
        sdk.onSend = (a, f) => {
            if (a.method !== 'sendUseItem') return;
            order.push('drink');
            f.state = { ...f.state!, inventory: [potion(2, 'Antipoison(2)')] };
        };
        await drive(sdk, k!.run(ctxOf(sdk)), 10);
        expect(order).toEqual(['drink', 'body']);
        expect(entryCured('S10b', ['K'], [seg('A', 'kit'), seg('K', 'warlord')])[0]!.preconditions).toBeUndefined();
        expect(() => entryCured('S10b', ['Q'], [seg('K', 'warlord')])).toThrow(/no segment Q/);
    });

    describe('a poison carried across a fresh login (rs/786): poisonUnknown and entryCure', () => {
        const held = [potion(4, 'Antipoison(3)')];
        const fresh = (tick: number, o: Partial<BotWorldState> = {}) => baseState({ tick, inventory: held, ...o });
        /** The server's side of a drink: one dose fewer on the next state, a vial after the last. */
        const sip = (name: string) => {
            const m = /^(.*)\((\d)\)$/.exec(name);
            return !m ? name : Number(m[2]) > 1 ? `${m[1]}(${Number(m[2]) - 1})` : 'Vial';
        };
        const drinks = (sdk: FakeSdk, onDrink: () => void = () => {}) => {
            sdk.onSend = (a, f) => {
                if (a.method !== 'sendUseItem') return;
                onDrink();
                f.state = { ...f.state!, inventory: f.state!.inventory.map(i => (i.slot === a.args[0] ? { ...i, name: sip(i.name) } : i)) };
            };
        };

        test('fresh (a launched client under a poison period old) with none seen and a dose held: unknown', () => {
            noteSessionStart(0); // a launched client counts from 0
            expect(poisonUnknown(fresh(4))).toBe(true);
            expect(poisonUnknown(fresh(POISON_PERIOD - 1))).toBe(true);
            expect(poisonUnknown(fresh(POISON_PERIOD))).toBe(false); // a carried poison has shown its first hit by now
        });

        test('fresh after a poison hit or the poisoned message: not unknown, the hitmark path (poisoned) decides', () => {
            expect(poisonUnknown(fresh(12, { combatEvents: [hit(10)] }))).toBe(false);
            expect(poisoned(fresh(12, { combatEvents: [hit(10)] }))).toBe(true);
            expect(poisonUnknown(fresh(12, { gameMessages: [msg(11)] }))).toBe(false);
            expect(poisonUnknown(fresh(12, { combatEvents: [hit(10, 1)] }))).toBe(true); // a melee hit is not poison
        });

        test('after a dose this session, or with none held: not unknown', () => {
            expect(poisonUnknown(fresh(5, { inventory: [] }))).toBe(false);
            expect(poisonUnknown(fresh(5, { inventory: [potion(1, 'Prayer potion(4)'), potion(2, 'Vial')] }))).toBe(false);
            noteAntipoison(6);
            expect(poisonUnknown(fresh(8))).toBe(false);
        });

        test("a new process's first observed tick starts its session (a run.ts restart on a page whose tick counts on); later ticks do not move it", () => {
            expect(poisonUnknown(fresh(5000))).toBe(true);
            expect(poisonUnknown(fresh(5010))).toBe(true);
            expect(poisonUnknown(fresh(5000 + POISON_PERIOD))).toBe(false);
            expect(poisonUnknown(fresh(5040))).toBe(false); // still the session that began at 5000
            noteAntipoison(-Infinity);
            expect(poisonUnknown(fresh(5000, { combatEvents: [hit(4990)] }))).toBe(false); // a hit already on the page: poisoned decides
            expect(poisoned(fresh(5000, { combatEvents: [hit(4990)] }))).toBe(true);
        });

        test('a relaunch (the tick falls) starts a new session: the old dose says nothing; an in-page login is named by noteSessionStart', () => {
            noteAntipoison(480);
            expect(poisonUnknown(fresh(500))).toBe(false);
            expect(poisonUnknown(fresh(4))).toBe(true);
            expect(antipoisonDrunkAt()).toBe(-Infinity);
            noteAntipoison(-Infinity);
            noteSessionStart(0);
            expect(poisonUnknown(fresh(5010))).toBe(false); // a page that counts on: no session start seen since 0
            noteSessionStart(5000);
            expect(poisonUnknown(fresh(5010))).toBe(true);
            expect(poisonUnknown(fresh(5010, { combatEvents: [hit(4990)] }))).toBe(false); // a hit in view: poisoned decides
            expect(poisonUnknown(fresh(5010, { combatEvents: [hit(4970)] }))).toBe(true); // the last session's, long past
            expect(poisonUnknown(fresh(5000 + POISON_PERIOD))).toBe(false);
            expect(poisonUnknown(fresh(3))).toBe(true); // then relaunched
        });

        test('entryCure, fresh with an antipoison(n) held: one dose at once, noted, so a second caller in the session drinks nothing', async () => {
            const sdk = new FakeSdk(fresh(4, { inventory: [potion(3, 'Superantipoison(4)'), potion(8, 'Antipoison(3)')] }));
            drinks(sdk);
            expect(await drive(sdk, entryCure(sdk as never, 'T'), 10)).toBe('blind');
            expect(sdk.sent.map(a => [a.method, ...a.args])).toEqual([['sendUseItem', 8, 1]]);
            expect(sdk.state!.inventory.map(i => i.name)).toEqual(['Superantipoison(4)', 'Antipoison(2)']);
            expect(antipoisonDrunkAt()).toBe(4);
            expect(await drive(sdk, entryCure(sdk as never, 'T'), 5)).toBe('clean');
            expect(sdk.sent).toHaveLength(1);
        });

        test('entryCure, fresh with only the Superantipoison (S16:B): one super dose', async () => {
            const sdk = new FakeSdk(fresh(6, { inventory: [potion(3, 'Superantipoison(4)')] }));
            drinks(sdk);
            expect(await drive(sdk, entryCure(sdk as never, 'T'), 10)).toBe('blind');
            expect(sdk.state!.inventory.map(i => i.name)).toEqual(['Superantipoison(3)']);
        });

        test('entryCure: not fresh and no hit drinks nothing; fresh with none held drinks nothing and does not throw; a seen hit is cured as before', async () => {
            noteSessionStart(0); // a process that has run since its client's launch
            const old = new FakeSdk(fresh(300));
            expect(await entryCure(old as never, 'T')).toBe('clean');
            expect(old.sent).toEqual([]);
            const none = new FakeSdk(fresh(4, { inventory: [] }));
            expect(await entryCure(none as never, 'T')).toBe('clean');
            expect(none.sent).toEqual([]);
            const seen = new FakeSdk(fresh(12, { combatEvents: [hit(10)] }));
            drinks(seen);
            expect(await drive(seen, entryCure(seen as never, 'T'), 10)).toBe('cured');
            expect(seen.sent).toHaveLength(1);
        });

        test("entryCured's fresh letters cure blind before the body; its other letters keep curePoison; a fresh letter must be entry-cured", async () => {
            const order: string[] = [];
            const segs = entryCured('S16', ['B', 'C'], [seg('B', 'kolodion', { run: async () => { order.push('B'); } }), seg('C', 'fight', { run: async () => { order.push('C'); } })], { fresh: ['B'] });
            const [b, c] = questSteps('S16', segs);
            const sdkC = new FakeSdk(fresh(4, { inventory: [potion(3, 'Superantipoison(4)')] }));
            drinks(sdkC);
            await drive(sdkC, c!.run(ctxOf(sdkC)), 10);
            expect(sdkC.sent).toEqual([]);
            const sdkB = new FakeSdk(fresh(4, { inventory: [potion(3, 'Superantipoison(4)')] }));
            drinks(sdkB, () => order.push('drink'));
            await drive(sdkB, b!.run(ctxOf(sdkB)), 10);
            expect(order).toEqual(['C', 'drink', 'B']);
            expect(() => entryCured('S16', ['C'], [seg('B', 'kolodion'), seg('C', 'fight')], { fresh: ['B'] })).toThrow(/fresh-session letters B are not entry-cured/);
        });
    });

    test('each quest step that can be entered poisoned cures first or names it: S10b K, S12 G-J, S16 B-C, S26 L', () => {
        const cases: Array<[string, Step<any>[], string[]]> = [
            ['S10b', treeGnomeVillage.steps(), ['K']],
            ['S12', fightArena.steps(), ['G', 'H', 'I', 'J']],
            ['S16', mageArena.steps(), ['B', 'C']],
            ['S26', dragonSlayer.steps(), ['L']],
        ];
        for (const [id, steps, letters] of cases) {
            for (const l of letters) {
                const st = steps.find(s => s.name.startsWith(`${id}:${l}-`))!;
                expect(st.preconditions(poisonedBare(), {} as never)).toBe(`${id}:${l} entered poisoned with no antipoison held`);
            }
        }
    });
});
