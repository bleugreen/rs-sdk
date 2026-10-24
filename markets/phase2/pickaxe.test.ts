import { describe, expect, test } from 'bun:test';
import { bestPickaxe, hasPickaxe, pickaxeSteps, SIDES } from './pickaxe.ts';

const LUMBRIDGE = { x: 3222, z: 3218 };
const ARDOUGNE_MARKET = { x: 2665, z: 3290 };
const MUSA_POINT = { x: 2924, z: 3180 };
const item = (name: string) => ({ name });
const kinds = (steps: ReturnType<typeof pickaxeSteps>) => steps.map(s => (s.do === 'bank' ? `bank:${s.take}` : s.do));

describe('bestPickaxe', () => {
    test('the best one usable at the level, by pickaxes.obj levelrequire', () => {
        const held = [item('Bronze pickaxe'), item('Rune pickaxe'), item('Adamant pickaxe')];
        expect(bestPickaxe(held, 1)?.name).toBe('Bronze pickaxe');
        expect(bestPickaxe(held, 31)?.name).toBe('Adamant pickaxe');
        expect(bestPickaxe(held, 41)?.name).toBe('Rune pickaxe');
        expect(bestPickaxe([item('Rune pickaxe')], 15)).toBeNull();
        expect(bestPickaxe([item('Bronze axe'), item('Coins')], 99)).toBeNull();
    });
    test('the stage holds with one carried or wielded, not with one too high for the level', () => {
        expect(hasPickaxe({ inventory: [item('Bronze pickaxe')], equipment: [] }, 1)).toBe(true);
        expect(hasPickaxe({ inventory: [], equipment: [item('Iron pickaxe')] }, 15)).toBe(true);
        expect(hasPickaxe({ inventory: [item('Bronze axe')], equipment: [] }, 15)).toBe(false);
        expect(hasPickaxe({ inventory: [item('Adamant pickaxe')], equipment: [] }, 15)).toBe(false);
    });
});

describe('pickaxeSteps', () => {
    test('a fresh or dead account on the mainland earns the price on the men and buys at Bob', () => {
        const steps = pickaxeSteps({ at: LUMBRIDGE, bank: null, coins: 0, mining: 1 });
        expect(kinds(steps)).toEqual(['earn', 'buy']);
        expect(steps.at(-1)).toEqual({ do: 'buy', shop: SIDES.mainland.shop });
    });
    test('with coins in the pack it goes straight to the shop', () => {
        expect(kinds(pickaxeSteps({ at: LUMBRIDGE, bank: [item('Coins'), item('Shark')], coins: 40, mining: 1 }))).toEqual(['buy']);
    });
    test('a pickaxe seen in the bank is fetched first, the shop behind it in case it has gone', () => {
        const steps = pickaxeSteps({ at: LUMBRIDGE, bank: [item('Adamant pickaxe')], coins: 40, mining: 31 });
        expect(kinds(steps)).toEqual(['bank:pickaxe', 'buy']);
        expect(steps[0]).toEqual({ do: 'bank', at: SIDES.mainland.bank, take: 'pickaxe' });
        // one the account cannot use yet is no reason to visit the bank
        expect(kinds(pickaxeSteps({ at: LUMBRIDGE, bank: [item('Adamant pickaxe')], coins: 40, mining: 15 }))).toEqual(['buy']);
    });
    test('on the Ardougne side: Aemad, the coins from the Ardougne bank', () => {
        const steps = pickaxeSteps({ at: ARDOUGNE_MARKET, bank: [], coins: 0, mining: 1 });
        expect(kinds(steps)).toEqual(['bank:coins', 'buy']);
        expect(steps[0]).toEqual({ do: 'bank', at: SIDES.kandarin.bank, take: 'coins' });
        expect(steps[1]).toEqual({ do: 'buy', shop: SIDES.kandarin.shop });
    });
    test('on Karamja it sails to the mainland first', () => {
        expect(kinds(pickaxeSteps({ at: MUSA_POINT, bank: null, coins: 60, mining: 1 }))).toEqual(['sail', 'buy']);
    });
});
