import { describe, expect, test } from 'bun:test';
import type { BotWorldState, InventoryItem, PlayerState } from '../../sdk/types';
import { baseState } from '../lib/fake-sdk';
import { Observation, resolveResume } from '../runner/resume';
import { ARRIVAL, LETTERS, observed, QUEST_ITEMS, quest, stepId, steps } from './cooks-assistant';
import { slotNeed } from './segments';

let nextSlot = 0;
const item = (name: string, count = 1): InventoryItem => ({ slot: nextSlot++, id: 2000 + nextSlot, name, count, optionsWithIndex: [] }) as unknown as InventoryItem;
const player = (x: number, z: number): PlayerState => ({ name: 'lab', x, z, worldX: x, worldZ: z, level: 0, hp: 97, maxHp: 97 }) as PlayerState;
const filler = (n: number) => Array.from({ length: n }, (_, i) => item(`Junk ${i}`));

/** The ledger's pack after H19: the three items and T23-24's Falador runes. */
const h19 = (kit = true) => {
    nextSlot = 0;
    return [...(kit ? [item('Egg'), item('Bucket of milk'), item('Pot of flour')] : []), item('Law rune', 1), item('Air rune', 3), item('Water rune', 1)];
};
const runes = () => h19(false);

function arrival(inventory: InventoryItem[] = h19(), tab?: 'started' | 'complete', over: Partial<BotWorldState> = {}): BotWorldState {
    return baseState({
        tick: 100,
        quests: (tab ? { [quest]: tab } : {}) as BotWorldState['quests'],
        skills: [{ name: 'Cooking', level: 1, baseLevel: 1, experience: 0 }],
        player: player(ARRIVAL.x, ARRIVAL.z),
        inventory,
        ...over,
    });
}

const list = steps();
const byLetter = (l: string) => list.find(s => s.name.startsWith(`${stepId}:${l}-`))!;

describe('segment table', () => {
    test('S23: the kit, the start, the hand-in; logout-safe; marks on B and C', () => {
        expect(stepId).toBe('S23');
        expect(quest).toBe('cook');
        expect(list.map(s => s.name)).toEqual(['S23:A-kit', 'S23:B-cook-start', 'S23:C-cook-hand-in']);
        expect(list.every(s => s.logoutSafe)).toBe(true);
        expect(list.filter(s => s.done).map(s => s.name)).toEqual(['S23:B-cook-start', 'S23:C-cook-hand-in']);
        expect(steps({ dialogue: 'fixed' }).map(s => s.name)).toEqual(list.map(s => s.name));
        expect([...LETTERS]).toEqual(['A', 'B', 'C']);
    });
});

describe('A: the entry preconditions', () => {
    const pre = (s: BotWorldState) => byLetter('A').preconditions(s, {});
    test('pass in the kitchen with H19 held', () => expect(pre(arrival())).toBe(true));
    test('refuse outside the kitchen, or with the quest complete', () => {
        expect(pre(arrival(h19(), undefined, { player: player(3222, 3218) }))).toMatch(/kitchen/);
        expect(pre(arrival(runes(), 'complete'))).toMatch(/already complete/);
    });
    test('without the kit A needs its three slots, and refuses a full pack naming them', () => {
        expect(slotNeed(arrival(runes()), QUEST_ITEMS, LETTERS, 'A').slots).toBe(3);
        expect(slotNeed(arrival(), QUEST_ITEMS, LETTERS, 'A').slots).toBe(0);
        expect(pre(arrival([...runes(), ...filler(23)]))).toBe('inventory: segment A needs 3 free slots (1 Egg, 1 Bucket of milk, 1 Pot of flour), 2 free: 1 short');
    });
    test('the kit is the postcondition; without a giver a missing kit fails', () => {
        expect(byLetter('A').postconditions(arrival(), {})).toBe(true);
        expect(byLetter('A').postconditions(arrival(runes()), {})).toMatch(/kit missing/);
    });
});

describe('B and C', () => {
    test('B at stage 0 needs the kit; C needs the started stage and the kit', () => {
        expect(byLetter('B').preconditions(arrival(runes()), {})).toMatch(/kit missing/);
        expect(byLetter('B').preconditions(arrival(), {})).toBe(true);
        expect(byLetter('C').preconditions(arrival(), {})).toMatch(/Cook's Assistant/);
        expect(byLetter('C').preconditions(arrival(h19(), 'started'), {})).toBe(true);
        expect(byLetter('C').preconditions(arrival(runes(), 'started'), {})).toMatch(/kit missing/);
    });
    test('C passes complete with the kit gone and nothing open; fails while an item or a page is left', () => {
        const post = (s: BotWorldState) => byLetter('C').postconditions(s, {});
        expect(post(arrival(runes(), 'complete'))).toBe(true);
        expect(post(arrival(h19(), 'complete'))).toMatch(/still holding/);
        expect(post(arrival(runes(), 'complete', { dialog: { isOpen: true } as BotWorldState['dialog'] }))).toMatch(/still open/);
    });
});

describe('resume', () => {
    const walkFrom = async (s: BotWorldState) => resolveResume(list, new Observation(s), {});
    test('fresh with the kit: B (A is a no-op); without it: A; started: C; complete: finished', async () => {
        expect((await walkFrom(arrival())).step).toBe('S23:B-cook-start');
        expect((await walkFrom(arrival(runes()))).step).toBe('S23:A-kit');
        expect((await walkFrom(arrival(h19(), 'started'))).step).toBe('S23:C-cook-hand-in');
        expect((await walkFrom(arrival(runes(), 'complete'))).mode).toBe('finished');
        expect(byLetter('C').done!(observed(arrival(runes(), 'complete')), {})).toBe(true);
    });
});
