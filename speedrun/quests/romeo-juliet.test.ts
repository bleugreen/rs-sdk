import { describe, expect, test } from 'bun:test';
import type { BotWorldState, InventoryItem, PlayerState } from '../../sdk/types';
import { baseState } from '../lib/fake-sdk';
import { Observation, resolveResume } from '../runner/resume';
import { ARRIVAL, LETTERS, observed, quest, QUEST_ITEMS, stepId, steps, UPSTAIRS_DOORS } from './romeo-juliet';
import { slotNeed } from './segments';

let nextSlot = 0;
const item = (name: string): InventoryItem => ({ slot: nextSlot++, id: 5000 + nextSlot, name, count: 1, optionsWithIndex: [] }) as unknown as InventoryItem;
const player = (x: number, z: number, level = 0): PlayerState => ({ name: 'lab', x, z, worldX: x, worldZ: z, level, hp: 97, maxHp: 97 }) as PlayerState;
const pack = (...names: string[]) => {
    nextSlot = 0;
    return [item('Gold bar'), ...names.map(item)];
};
const JULIET = { x: 3158, z: 3426, level: 1 };
const at = (a: { x: number; z: number; level?: number }, inventory: InventoryItem[], tab?: 'started' | 'complete'): BotWorldState =>
    baseState({ tick: 100, quests: (tab ? { [quest]: tab } : {}) as BotWorldState['quests'], player: player(a.x, a.z, a.level ?? 0), inventory, skills: [] });

const list = steps();
const byLetter = (l: string) => list.find(s => s.name.startsWith(`${stepId}:${l}-`))!;
const walkFrom = async (s: BotWorldState) => {
    const obs = new Observation(s);
    for (const st of list) for (const p of st.probes ?? []) obs.probed[p] = null;
    return resolveResume(list, obs, {});
};

describe('segment table', () => {
    test('S24 R1-R6: Juliet, Romeo, Father Lawrence, the Apothecary, Juliet, Romeo; each with a mark', () => {
        expect(list.map(s => s.name)).toEqual(['S24:R1-juliet', 'S24:R2-romeo-message', 'S24:R3-lawrence', 'S24:R4-apothecary', 'S24:R5-juliet-potion', 'S24:R6-romeo-finish']);
        expect(list.every(s => s.logoutSafe && s.done)).toBe(true);
        expect(UPSTAIRS_DOORS).toHaveLength(2);
    });
    test("the free-slot peak is 1, Juliet's message: the ledger's S24 need", () => {
        expect(slotNeed(at(ARRIVAL, pack('Cadava berries')), QUEST_ITEMS, LETTERS, 'R1')).toMatchObject({ slots: 1, peak: 'R1' });
    });
});

describe('preconditions read the items, not the position', () => {
    test('R1 needs the berries and the quest not started', () => {
        expect(byLetter('R1').preconditions(at(ARRIVAL, pack('Cadava berries')), {})).toBe(true);
        expect(byLetter('R1').preconditions(at(ARRIVAL, pack()), {})).toMatch(/cadava berries/);
        expect(byLetter('R1').preconditions(at(ARRIVAL, pack('Cadava berries'), 'started'), {})).toMatch(/already started/);
    });
    test('R3 and R4 need the message gone and the berries held; R5 the potion; R6 neither', () => {
        expect(byLetter('R3').preconditions(at(ARRIVAL, pack('Cadava berries'), 'started'), {})).toBe(true);
        expect(byLetter('R3').preconditions(at(ARRIVAL, pack('Cadava berries', 'Message'), 'started'), {})).toMatch(/message: still held/);
        expect(byLetter('R5').preconditions(at(ARRIVAL, pack('Cadava potion'), 'started'), {})).toBe(true);
        expect(byLetter('R6').preconditions(at(JULIET, pack(), 'started'), {})).toBe(true);
        expect(byLetter('R6').preconditions(at(JULIET, pack('Cadava potion'), 'started'), {})).toMatch(/potion/);
    });
});

describe('done and resume', () => {
    test('fresh: R1; the message held: R2; the potion held: R5; complete: finished', async () => {
        expect((await walkFrom(at(ARRIVAL, pack('Cadava berries')))).step).toBe('S24:R1-juliet');
        expect((await walkFrom(at(JULIET, pack('Cadava berries', 'Message'), 'started'))).step).toBe('S24:R2-romeo-message');
        expect((await walkFrom(at(ARRIVAL, pack('Cadava potion'), 'started'))).step).toBe('S24:R5-juliet-potion');
        expect((await walkFrom(at(ARRIVAL, pack(), 'complete'))).mode).toBe('finished');
    });
    test('R1 done while the message is held; R4 done while the potion is', () => {
        expect(byLetter('R1').done!(observed(at(JULIET, pack('Cadava berries', 'Message'), 'started')), {})).toBe(true);
        expect(byLetter('R4').done!(observed(at(ARRIVAL, pack('Cadava potion'), 'started')), {})).toBe(true);
        expect(byLetter('R4').done!(observed(at(ARRIVAL, pack('Cadava berries'), 'started')), {})).toBe(false);
    });
    test('R6: complete in Varrock Square, nothing open', () => {
        expect(byLetter('R6').postconditions(at(ARRIVAL, pack(), 'complete'), {})).toBe(true);
        expect(byLetter('R6').postconditions(at(JULIET, pack(), 'complete'), {})).toMatch(/Varrock Square/);
    });
});
