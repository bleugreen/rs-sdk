import { describe, expect, test } from 'bun:test';
import type { BotWorldState } from '../../sdk/types';
import { ARDOUGNE_LANDING } from '../lib/sea-route.ts';
import { STANDS } from '../methods/coins-driver.ts';
import { SITES } from '../methods/hp-train.ts';
import { stageDone, stageStart } from './stages.ts';

const state = (o: { inventory?: string[]; equipment?: string[]; mining?: number; thieving?: number; at?: { x: number; z: number } }): BotWorldState =>
    ({
        inventory: (o.inventory ?? []).map((name, slot) => ({ name, count: 1, slot, optionsWithIndex: [] })),
        equipment: (o.equipment ?? []).map((name, slot) => ({ name, count: 1, slot })),
        skills: [
            { name: 'Mining', baseLevel: o.mining ?? 1 },
            { name: 'Thieving', baseLevel: o.thieving ?? 1 }
        ],
        player: { worldX: o.at?.x ?? 3222, worldZ: o.at?.z ?? 3218, level: 0 }
    }) as unknown as BotWorldState;
const hooks = { admitted: () => true };
const roleState = { get: () => undefined };
const pickaxeDone = (s: BotWorldState) => stageDone({ do: 'pickaxe' }, s, hooks, roleState);

describe('the pickaxe stage', () => {
    test('holds with a usable pickaxe carried or wielded', () => {
        expect(pickaxeDone(state({ inventory: ['Bronze pickaxe'] }))).toBe(true);
        expect(pickaxeDone(state({ equipment: ['Bronze pickaxe'], mining: 15 }))).toBe(true);
        expect(pickaxeDone(state({ inventory: ['Rune pickaxe'], mining: 41 }))).toBe(true);
    });
    test('runs for an account that lost its pickaxe, or holds only one above its level', () => {
        expect(pickaxeDone(state({ inventory: ['Coins', 'Bronze axe'] }))).toBe(false);
        expect(pickaxeDone(state({ inventory: ['Rune pickaxe'], mining: 15 }))).toBe(false);
    });
    test('the wield stage still asks for the pickaxe in the equipment', () => {
        expect(stageDone({ do: 'wield', item: 'pickaxe' }, state({ inventory: ['Bronze pickaxe'] }), hooks, roleState)).toBe(false);
        expect(stageDone({ do: 'wield', item: 'pickaxe' }, state({ equipment: ['Bronze pickaxe'] }), hooks, roleState)).toBe(true);
    });
});

describe('stageStart', () => {
    const KARAMJA = { x: 2920, z: 3160 };
    const STRONGHOLD = { x: 2465, z: 3489 };
    const opts = { options: {} };
    test('the coins stage starts at the Lumbridge men, wherever the account stands', () => {
        expect(stageStart({ do: 'coins', n: 100 }, 'knights', state({ at: STRONGHOLD }), opts)).toEqual(STANDS.man);
    });
    test('the thieving and admission stages at the target the coins driver would pick', () => {
        expect(stageStart({ do: 'thieving', to: 55 }, 'knights', state({ thieving: 10 }), opts)).toEqual(STANDS.man);
        expect(stageStart({ do: 'admission' }, 'knights', state({ thieving: 99, inventory: Array(30).fill('Coins') }), opts)).toEqual(STANDS.guard);
    });
    test("the guards method at the driver's target; a12 redirected to guards on Karamja is sent to the Varrock guards", () => {
        expect(stageStart({ do: 'method', method: 'guards' }, 'guards', state({ at: KARAMJA, thieving: 99, inventory: Array(30).fill('Coins') }), opts)).toEqual(STANDS.guard);
    });
    test('the Ardougne methods on the Ardougne side; a staged Shilo account where it stands', () => {
        expect(stageStart({ do: 'method', method: 'knights' }, 'knights', state({}), opts)).toEqual(ARDOUGNE_LANDING);
        expect(stageStart({ do: 'method', method: 'iron' }, 'iron', state({}), opts)).toEqual(ARDOUGNE_LANDING);
        expect(stageStart({ do: 'method', method: 'shilo' }, 'shilo', state({ at: { x: 2826, z: 2997 } }), opts)).toBeNull();
    });
    test("the ship to Ardougne: thieving.ts's leg from the mainland, a trip from anywhere else", () => {
        expect(stageStart({ do: 'to-ardougne' }, 'knights', state({}), opts)).toBeNull();
        expect(stageStart({ do: 'to-ardougne' }, 'knights', state({ at: KARAMJA }), opts)).toEqual(ARDOUGNE_LANDING);
        expect(stageStart({ do: 'to-ardougne' }, 'knights', state({ at: STRONGHOLD }), opts)).toEqual(ARDOUGNE_LANDING);
    });
    test("the Hitpoints stage at its site; a Kandarin site's first levels on the cows", () => {
        expect(stageStart({ do: 'hp', to: 40 }, 'knights', state({}), { options: {}, hp: { site: 'farm', claims: null as never } })).toEqual(SITES.farm.centre);
        expect(stageStart({ do: 'hp', to: 70 }, 'knights', state({}), { options: {}, hp: { site: 'crabs', claims: null as never } })).toEqual(SITES.cows.centre);
    });
    test('stages that start where the account stands', () => {
        expect(stageStart({ do: 'tutorial' }, 'knights', state({}), opts)).toBeNull();
        expect(stageStart({ do: 'pickaxe' }, 'iron', state({}), opts)).toBeNull();
        expect(stageStart({ do: 'wield', item: 'pickaxe' }, 'iron', state({}), opts)).toBeNull();
    });
});
