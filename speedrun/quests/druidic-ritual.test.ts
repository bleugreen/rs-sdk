import { describe, expect, test } from 'bun:test';
import type { BotWorldState, InventoryItem, PlayerState } from '../../sdk/types';
import { baseState } from '../lib/fake-sdk';
import { Observation, resolveResume } from '../runner/resume';
import { ARRIVAL, CIRCLE_TO_SANFEW, DOOR_OUT, observed, quest, QUEST_ITEMS, LETTERS, stepId, steps } from './druidic-ritual';
import { slotNeed } from './segments';

let nextSlot = 0;
const item = (name: string): InventoryItem => ({ slot: nextSlot++, id: 4000 + nextSlot, name, count: 1, optionsWithIndex: [] }) as unknown as InventoryItem;
const player = (x: number, z: number, level = 0): PlayerState => ({ name: 'lab', x, z, worldX: x, worldZ: z, level, hp: 97, maxHp: 97 }) as PlayerState;
const RAW = ['Raw rat meat', 'Raw bear meat', 'Raw beef', 'Raw chicken'];
const DIPPED = ['Enchanted rat', 'Enchanted bear', 'Enchanted beef', 'Enchanted chicken'];
const pack = (meats: 'raw' | 'dipped' | 'none') => {
    nextSlot = 0;
    return [item('Gold bar'), ...(meats === 'raw' ? RAW : meats === 'dipped' ? DIPPED : []).map(item)];
};
const SANFEW = { x: 2897, z: 3427, level: 1 };
const ROOM = { x: 2892, z: 9831 };
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
    test('S24 D1-D9: Kaqemeex, Sanfew, the cauldron, Sanfew, Kaqemeex; marks on the talks and the dip', () => {
        expect(list.map(s => s.name)).toEqual([
            'S24:D1-kaqemeex-start', 'S24:D2-to-sanfew', 'S24:D3-sanfew', 'S24:D4-to-cauldron', 'S24:D5-cauldron',
            'S24:D6-to-sanfew-meats', 'S24:D7-sanfew-meats', 'S24:D8-to-kaqemeex', 'S24:D9-kaqemeex-reward',
        ]);
        expect(list.filter(s => s.done).map(s => s.name.split(':')[1]!.split('-')[0])).toEqual(['D1', 'D3', 'D5', 'D7', 'D9']);
        expect(list.every(s => s.logoutSafe)).toBe(true);
    });
    test('D2 goes down the west side: its tiles run from the circle south to the house', () => {
        expect(CIRCLE_TO_SANFEW[0]!.z).toBeGreaterThan(CIRCLE_TO_SANFEW.at(-1)!.z);
        expect(CIRCLE_TO_SANFEW.every(t => t.x <= ARRIVAL.x)).toBe(true);
    });
});

describe('preconditions', () => {
    test('D1 at the circle with the four raw meats', () => {
        expect(byLetter('D1').preconditions(at(ARRIVAL, pack('raw')), {})).toBe(true);
        expect(byLetter('D1').preconditions(at(ARRIVAL, pack('none')), {})).toMatch(/meats: no raw rat meat/);
        expect(byLetter('D1').preconditions(at(SANFEW, pack('raw')), {})).toMatch(/stone circle/);
    });
    test('D5 underground with the raw meats; D7 upstairs at Sanfew with the dipped ones', () => {
        expect(byLetter('D5').preconditions(at(DOOR_OUT, pack('raw'), 'started'), {})).toBe(true);
        expect(byLetter('D5').preconditions(at(ARRIVAL, pack('raw'), 'started'), {})).toMatch(/Taverley Dungeon/);
        expect(byLetter('D7').preconditions(at(SANFEW, pack('dipped'), 'started'), {})).toBe(true);
        expect(byLetter('D7').preconditions(at({ ...SANFEW, level: 0 }, pack('dipped'), 'started'), {})).toMatch(/upstairs/);
    });
    test('the free-slot model peaks at the dip, conservatively 4 (the raw meats are credited only after D5)', () => {
        const need = slotNeed(at(ARRIVAL, pack('raw')), QUEST_ITEMS, LETTERS, 'D1');
        expect(need).toMatchObject({ slots: 4, peak: 'D5' });
    });
});

describe('done and resume from the meats held', () => {
    test('fresh at the circle: D1; started with raw meats underground: D5; dipped upstairs: D7; given: D9 at the circle', async () => {
        expect((await walkFrom(at(ARRIVAL, pack('raw')))).step).toBe('S24:D1-kaqemeex-start');
        expect((await walkFrom(at(ROOM, pack('dipped'), 'started'))).step).toBe('S24:D6-to-sanfew-meats');
        expect((await walkFrom(at(SANFEW, pack('dipped'), 'started'))).step).toBe('S24:D7-sanfew-meats');
        expect((await walkFrom(at(ARRIVAL, pack('none'), 'started'))).step).toBe('S24:D9-kaqemeex-reward');
        expect((await walkFrom(at(SANFEW, pack('none'), 'started'))).step).toBe('S24:D8-to-kaqemeex');
        expect((await walkFrom(at(ARRIVAL, pack('none'), 'complete'))).mode).toBe('finished');
    });
    test('D5 done: the four dipped held, or handed over; not with one still raw', () => {
        expect(byLetter('D5').done!(observed(at(ROOM, pack('dipped'), 'started')), {})).toBe(true);
        expect(byLetter('D5').done!(observed(at(ARRIVAL, pack('none'), 'started')), {})).toBe(true);
        const mixed = pack('dipped');
        mixed[1] = item('Raw rat meat');
        expect(byLetter('D5').done!(observed(at(ROOM, mixed, 'started')), {})).toBe(false);
    });
    test('D9: complete at the circle with nothing open', () => {
        expect(byLetter('D9').postconditions(at(ARRIVAL, pack('none'), 'complete'), {})).toBe(true);
        expect(byLetter('D9').postconditions(at(ARRIVAL, pack('none'), 'started'), {})).toMatch(/Druidic Ritual/);
    });
});
