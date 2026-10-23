import { describe, expect, test } from 'bun:test';
import type { BotWorldState, InventoryItem, PlayerState } from '../../sdk/types';
import { baseState } from '../lib/fake-sdk';
import { Observation, resolveResume } from '../runner/resume';
import { ARRIVAL, LETTERS, observed, quest, stepId, steps, VILLAGE_ARRIVAL } from './goblin-diplomacy';

let nextSlot = 0;
const item = (name: string, count = 1): InventoryItem => ({ slot: nextSlot++, id: 3000 + nextSlot, name, count, optionsWithIndex: [] }) as unknown as InventoryItem;
const player = (x: number, z: number): PlayerState => ({ name: 'lab', x, z, worldX: x, worldZ: z, level: 0, hp: 97, maxHp: 97 }) as PlayerState;

/** H20's Goblin Diplomacy items, or after G2 (two mails dyed), less what the generals took. */
function pack(o: { dyed?: boolean; gave?: Array<'orange' | 'blue' | 'plain'>; bar?: boolean } = {}): InventoryItem[] {
    nextSlot = 0;
    const gave = o.gave ?? [];
    const inv = [item('Law rune', 2), item('Air rune', 6), item('Cadava berries')];
    if (!o.dyed) inv.push(item('Goblin mail'), item('Goblin mail'), item('Goblin mail'), item('Orange dye'), item('Blue dye'));
    else {
        if (!gave.includes('orange')) inv.push(item('Orange goblin mail'));
        if (!gave.includes('blue')) inv.push(item('Blue goblin mail'));
        if (!gave.includes('plain')) inv.push(item('Goblin mail'));
    }
    if (o.bar) inv.push(item('Gold bar'));
    return inv;
}

const at = (a: { x: number; z: number }, inventory: InventoryItem[], tab?: 'started' | 'complete'): BotWorldState =>
    baseState({ tick: 100, quests: (tab ? { [quest]: tab } : {}) as BotWorldState['quests'], player: player(a.x, a.z), inventory, skills: [] });

const list = steps();
const byLetter = (l: string) => list.find(s => s.name.startsWith(`${stepId}:${l}-`))!;
const walkFrom = async (s: BotWorldState, steps0 = list) => {
    const obs = new Observation(s);
    obs.probed['quest-journal:gobdip'] = null;
    for (const st of steps0) for (const p of st.probes ?? []) obs.probed[p] = null;
    return resolveResume(steps0, obs, {});
};

describe('segment table and parts', () => {
    test('S24 G1-G6, unique names, all logout-safe', () => {
        expect(list.map(s => s.name)).toEqual(['S24:G1-bartender', 'S24:G2-dye-mail', 'S24:G3-orange-request', 'S24:G4-orange-mail', 'S24:G5-blue-mail', 'S24:G6-plain-mail']);
        expect(list.every(s => s.logoutSafe && s.done)).toBe(true);
        expect([...LETTERS]).toHaveLength(6);
    });
    test("part 'anchor' is G1-G2 (before L24a), part 'village' G3-G6 (after L24b)", () => {
        expect(steps({ part: 'anchor' }).map(s => s.name)).toEqual(['S24:G1-bartender', 'S24:G2-dye-mail']);
        expect(steps({ part: 'village' }).map(s => s.name)).toEqual(['S24:G3-orange-request', 'S24:G4-orange-mail', 'S24:G5-blue-mail', 'S24:G6-plain-mail']);
    });
});

describe('preconditions', () => {
    test('G1 at the Rusty Anchor with H20; refused elsewhere or short of an item', () => {
        expect(byLetter('G1').preconditions(at(ARRIVAL, pack()), {})).toBe(true);
        expect(byLetter('G1').preconditions(at(VILLAGE_ARRIVAL, pack()), {})).toMatch(/Rusty Anchor/);
        const short = pack().filter(i => i.name !== 'Blue dye');
        expect(byLetter('G1').preconditions(at(ARRIVAL, short), {})).toMatch(/short blue dye/);
    });
    test('the village part needs the generals\' hut and the dyed mails', () => {
        expect(byLetter('G3').preconditions(at(VILLAGE_ARRIVAL, pack({ dyed: true }), 'started'), {})).toBe(true);
        expect(byLetter('G3').preconditions(at(ARRIVAL, pack({ dyed: true }), 'started'), {})).toMatch(/generals/);
        expect(byLetter('G3').preconditions(at(VILLAGE_ARRIVAL, pack(), 'started'), {})).toMatch(/orange goblin mail/);
        expect(byLetter('G3').preconditions(at(VILLAGE_ARRIVAL, pack({ dyed: true })), {})).toMatch(/not in progress/);
    });
});

describe('done and resume, from the tab and the mails held', () => {
    test('anchor: fresh starts G1; started starts G2; dyed is done', async () => {
        const anchor = steps({ part: 'anchor' });
        expect((await walkFrom(at(ARRIVAL, pack()), anchor)).step).toBe('S24:G1-bartender');
        expect((await walkFrom(at(ARRIVAL, pack(), 'started'), anchor)).step).toBe('S24:G2-dye-mail');
        expect((await walkFrom(at(ARRIVAL, pack({ dyed: true }), 'started'), anchor)).mode).toBe('finished');
    });
    test('village: each mail handed over moves the walk on; complete with the bar is finished', async () => {
        const village = steps({ part: 'village' });
        expect((await walkFrom(at(VILLAGE_ARRIVAL, pack({ dyed: true }), 'started'), village)).step).toBe('S24:G3-orange-request');
        expect((await walkFrom(at(VILLAGE_ARRIVAL, pack({ dyed: true, gave: ['orange'] }), 'started'), village)).step).toBe('S24:G5-blue-mail');
        expect((await walkFrom(at(VILLAGE_ARRIVAL, pack({ dyed: true, gave: ['orange', 'blue'] }), 'started'), village)).step).toBe('S24:G6-plain-mail');
        expect((await walkFrom(at(VILLAGE_ARRIVAL, pack({ dyed: true, gave: ['orange', 'blue', 'plain'], bar: true }), 'complete'), village)).mode).toBe('finished');
    });
    test('G3 is done once the orange mail is given (no journal needed), not while it is held', () => {
        expect(byLetter('G3').done!(observed(at(VILLAGE_ARRIVAL, pack({ dyed: true }), 'started')), {})).toBe(false);
        expect(byLetter('G3').done!(observed(at(VILLAGE_ARRIVAL, pack({ dyed: true, gave: ['orange'] }), 'started')), {})).toBe(true);
    });
    test('G6: complete with the gold bar and nothing of the quest left', () => {
        const post = (s: BotWorldState) => byLetter('G6').postconditions(s, {});
        expect(post(at(VILLAGE_ARRIVAL, pack({ dyed: true, gave: ['orange', 'blue', 'plain'], bar: true }), 'complete'))).toBe(true);
        expect(post(at(VILLAGE_ARRIVAL, pack({ dyed: true, gave: ['orange', 'blue', 'plain'] }), 'complete'))).toMatch(/gold bar/);
        expect(post(at(VILLAGE_ARRIVAL, pack({ dyed: true, gave: ['orange', 'blue'], bar: true }), 'complete'))).toMatch(/still holding goblin mail/);
    });
});
