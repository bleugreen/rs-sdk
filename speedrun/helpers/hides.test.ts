import { describe, expect, test } from 'bun:test';
import type { GroundItem, InventoryItem, NearbyNpc } from '../../sdk/types';
import { banked, carried, FIELDS, hidesOptions, minCoins, nextStep, pickCow, pickHide, shopNeed, threadNeeded, type Banked, type Carried } from './hides';

const item = (slot: number, name: string, count = 1): InventoryItem => ({ slot, id: 1000 + slot, name, count, optionsWithIndex: [] });
const hides = (n: number, from = 1) => Array.from({ length: n }, (_, i) => item(from + i, 'Cowhide'));
const OPTS = hidesOptions({ field: 'east', target: 400 });
const inv = (over: Partial<Carried> = {}): Carried => ({ hides: 0, leather: 0, thread: 0, needle: 0, coins: 1000, other: 0, freeSlots: 27, ...over });
const bank = (over: Partial<Banked> = {}): Banked => ({ leather: 0, thread: 0, needle: 0, coins: 50_000, hides: 0, ...over });

describe('threadNeeded (leather.rs2: one thread held per body, one deleted on every fifth)', () => {
    test('S25d line: 1,116 bodies need 224 for any leftover %thread_used', () => {
        for (let used = 0; used <= 4; used++) expect(threadNeeded(1116, used)).toBe(224);
    });
    test('the staged 1,142 need 230 in the worst case', () => {
        expect(threadNeeded(1142, 4)).toBe(230);
        expect(threadNeeded(1142, 0)).toBe(229);
    });
    test('small cases by hand', () => {
        expect(threadNeeded(0)).toBe(0);
        expect(threadNeeded(5, 0)).toBe(1); // the 5th body deletes the last thread after it is made
        expect(threadNeeded(6, 0)).toBe(2);
        expect(threadNeeded(1, 4)).toBe(1);
        expect(threadNeeded(2, 4)).toBe(2); // the first body uses it up
    });
});

describe('options', () => {
    test('defaults', () => {
        expect(OPTS).toEqual({ field: 'east', target: 400, thread: 0, needle: 0, carryCoins: 1000 });
    });
    test('refuses a missing target, an unknown field, bad counts and too few coins', () => {
        expect(() => hidesOptions({ field: 'east' })).toThrow(/target/);
        expect(() => hidesOptions({ field: 'moon', target: 1 })).toThrow(/unknown field/);
        expect(() => hidesOptions({ target: 10, thread: -1 })).toThrow(/thread/);
        expect(() => hidesOptions({ target: 10, needle: 1.5 })).toThrow(/needle/);
        expect(() => hidesOptions({ target: 10, carryCoins: minCoins() - 1 })).toThrow(/carryCoins/);
    });
});

describe('carried and banked', () => {
    test('counts stacks and slots; a borrowed earner kebabs count as other', () => {
        const c = carried([item(0, 'Coins', 596), ...hides(3), item(4, 'Hard leather'), item(5, 'Thread', 40), item(6, 'Kebab'), item(7, 'Kebab')]);
        expect(c).toEqual({ hides: 3, leather: 1, thread: 40, needle: 0, coins: 596, other: 2, freeSlots: 20 });
    });
    test('bank totals', () => {
        expect(banked([{ name: 'Hard leather', count: 300 }, { name: 'Coins', count: 9 }, { name: 'Needle', count: 1 }])).toEqual({ leather: 300, thread: 0, needle: 1, coins: 9, hides: 0 });
    });
});

describe('nextStep', () => {
    test('first pass banks (clears food, reads the count) unless it carries hides, which go to the tanner first', () => {
        expect(nextStep({ inv: inv({ other: 9 }), bank: null, shopDue: false }, OPTS)).toBe('bank');
        expect(nextStep({ inv: inv({ hides: 4, freeSlots: 23 }), bank: null, shopDue: false }, OPTS)).toBe('tan');
    });
    test('gathers until the inventory is full of hides, then tans, then banks the leather', () => {
        expect(nextStep({ inv: inv({ hides: 20, freeSlots: 7 }), bank: bank(), shopDue: false }, OPTS)).toBe('gather');
        expect(nextStep({ inv: inv({ hides: 27, freeSlots: 0 }), bank: bank(), shopDue: false }, OPTS)).toBe('tan');
        expect(nextStep({ inv: inv({ leather: 27, freeSlots: 0 }), bank: bank(), shopDue: false }, OPTS)).toBe('bank');
    });
    test('tans a part inventory once it reaches the target', () => {
        expect(nextStep({ inv: inv({ hides: 10, freeSlots: 17 }), bank: bank({ leather: 390 }), shopDue: false }, OPTS)).toBe('tan');
    });
    test('short of coins for a trip: back to the bank', () => {
        expect(nextStep({ inv: inv({ coins: minCoins() - 1 }), bank: bank(), shopDue: false }, OPTS)).toBe('bank');
    });
    test('shops once per bank visit while thread or needles are owed, then gathers', () => {
        const o = hidesOptions({ target: 400, thread: 230, needle: 1 });
        expect(nextStep({ inv: inv(), bank: bank({ thread: 100, needle: 1 }), shopDue: true }, o)).toBe('shop');
        expect(nextStep({ inv: inv(), bank: bank({ thread: 100, needle: 1 }), shopDue: false }, o)).toBe('gather');
        expect(nextStep({ inv: inv({ thread: 100 }), bank: bank({ thread: 100 }), shopDue: false }, o)).toBe('bank');
    });
    test('done only from the bank, with the leather and the shopping both covered', () => {
        const o = hidesOptions({ target: 400, thread: 230, needle: 1 });
        expect(nextStep({ inv: inv(), bank: bank({ leather: 400, thread: 230, needle: 1 }), shopDue: true }, o)).toBe('done');
        expect(nextStep({ inv: inv(), bank: bank({ leather: 400, thread: 200, needle: 1 }), shopDue: false }, o)).toBe('gather');
        expect(nextStep({ inv: inv(), bank: bank({ leather: 399, thread: 230, needle: 1 }), shopDue: false }, o)).toBe('gather');
    });
    test('shopNeed', () => {
        const o = hidesOptions({ target: 1, thread: 230, needle: 1 });
        expect(shopNeed(bank({ thread: 30 }), o)).toEqual({ thread: 200, needle: 1 });
        expect(shopNeed(bank({ thread: 300, needle: 2 }), o)).toBeNull();
    });
});

const cow = (index: number, x: number, z: number, distance: number, over: Partial<NearbyNpc> = {}): NearbyNpc =>
    ({ kind: 'npc', id: 81, index, name: 'Cow', combatLevel: 2, x, z, tileX: x, tileZ: z, distance, hp: 8, maxHp: 8, healthPercent: 100, targetIndex: -1, inCombat: false, lastCombatTick: null, animId: -1, spotanimId: -1, optionsWithIndex: [{ text: 'Attack', opIndex: 2 }], options: ['Attack'], reachable: true, ...over }) as NearbyNpc;
const pile = (x: number, z: number, distance: number, over: Partial<GroundItem> = {}): GroundItem => ({ id: 1739, name: 'Cowhide', count: 1, x, z, distance, reachable: true, ...over });

describe('targets', () => {
    const east = FIELDS.east!;
    test('nearest free cow in the field; skips fought, unreachable, avoided and out-of-field cows', () => {
        const npcs = [
            cow(1, 3250, 3270, 2, { inCombat: true }),
            cow(2, 3251, 3271, 3, { reachable: false }),
            cow(3, 3252, 3272, 4),
            cow(4, 3270, 3270, 1), // across the Al Kharid fence
            cow(5, 3253, 3273, 5),
            cow(6, 3254, 3274, 1.5, { name: 'Cow calf' })
        ];
        expect(pickCow(npcs, east, new Map(), 0)?.index).toBe(3);
        expect(pickCow(npcs, east, new Map([[3, 10]]), 5)?.index).toBe(5);
        expect(pickCow(npcs, east, new Map([[3, 10]]), 10)?.index).toBe(3);
    });
    test('nearest reachable cowhide in the field, not other items or failed tiles', () => {
        const items = [pile(3250, 3270, 3), pile(3251, 3270, 1, { name: 'Raw beef' }), pile(3252, 3270, 2, { reachable: false }), pile(3300, 3270, 1)];
        expect(pickHide(items, east, new Map(), 0)).toMatchObject({ x: 3250 });
        expect(pickHide(items, east, new Map([['3250,3270', 99]]), 0)).toBeUndefined();
    });
    test('every listed cow spawn is inside its field box', () => {
        const spawns: Record<string, [number, number][]> = {
            east: [[3254, 3258], [3258, 3260], [3261, 3259], [3243, 3295], [3244, 3289], [3247, 3284], [3255, 3278], [3256, 3292], [3261, 3270], [3261, 3292]],
            north: [[3154, 3325], [3160, 3318], [3173, 3323], [3197, 3320], [3156, 3342], [3182, 3329], [3197, 3331]]
        };
        for (const [name, tiles] of Object.entries(spawns)) {
            const f = FIELDS[name]!;
            for (const [x, z] of tiles) expect(x >= f.minX && x <= f.maxX && z >= f.minZ && z <= f.maxZ).toBe(true);
        }
    });
});
