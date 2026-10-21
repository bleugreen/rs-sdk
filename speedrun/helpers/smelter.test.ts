import { describe, expect, test } from 'bun:test';
import { chooseBar, planPickaxePurchase, type BarChoice } from './smelter';

const COAL = 453;
const IRON = 440;
const MITH = 447;
const ADDY = 449;
const STEEL_BAR = 2353;

const bank = (items: Record<number, number>) => (id: number) => items[id] ?? 0;
const choice = (over: Partial<BarChoice>): BarChoice => ({
    smithing: 51,
    banked: bank({}),
    mode: 'full',
    tier: 'auto',
    smeltMin: 25,
    continuing: false,
    ...over
});

describe('chooseBar', () => {
    test('a production session waits for smeltMin sets, then continues on any set', () => {
        const banked = bank({ [MITH]: 15, [COAL]: 43 });
        expect(chooseBar(choice({ banked }))).toBeNull();
        expect(chooseBar(choice({ banked, continuing: true }))).toBe('mith');
        expect(chooseBar(choice({ banked: bank({ [MITH]: 30, [COAL]: 120 }) }))).toBe('mith');
    });

    test('sets are limited by coal as well as ore', () => {
        // 30 mithril but only 10 sets of coal
        expect(chooseBar(choice({ banked: bank({ [MITH]: 30, [COAL]: 40 }) }))).toBeNull();
    });

    test('smelt mode smelts whatever it has', () => {
        expect(chooseBar(choice({ mode: 'smelt', banked: bank({ [MITH]: 1, [COAL]: 4 }) }))).toBe('mith');
    });

    test('adamantite needs Smithing 70 and is skipped for tier mithril', () => {
        const banked = bank({ [ADDY]: 40, [MITH]: 40, [COAL]: 400 });
        expect(chooseBar(choice({ smithing: 69, banked }))).toBe('mith');
        expect(chooseBar(choice({ smithing: 70, banked }))).toBe('addy');
        expect(chooseBar(choice({ smithing: 70, banked, tier: 'mithril' }))).toBe('mith');
    });

    test('training bars only in full mode below Smithing 50', () => {
        const banked = bank({ [IRON]: 9, [COAL]: 18 });
        expect(chooseBar(choice({ smithing: 35, banked }))).toBe('steel');
        expect(chooseBar(choice({ smithing: 35, banked, mode: 'mine' }))).toBeNull();
        expect(chooseBar(choice({ smithing: 50, banked }))).toBeNull();
    });
});

describe('planPickaxePurchase', () => {
    const RUNE = { id: 1275, name: 'Rune pickaxe', level: 41, price: 32000 };
    const ADAMANT = { id: 1271, name: 'Adamant pickaxe', level: 31, price: 3200 };
    const candidates = [RUNE, ADAMANT];

    test('aims at the best pickaxe the whole lot funds, selling only the coal it needs', () => {
        // h21 on the demo: 25 coins and 56 coal at a 150 gp bid -> adamant, 23 coal.
        const plan = planPickaxePurchase(candidates, 25, [{ id: COAL, n: 56, price: 150 }]);
        expect(plan?.target.name).toBe('Adamant pickaxe');
        expect(plan?.sell).toEqual([{ id: COAL, n: 23, price: 150 }]);
    });

    test('bars are sold whole', () => {
        // h20 on the demo: 8,730 coins and 36 steel bars at 700 gp -> rune.
        const plan = planPickaxePurchase(candidates, 8730, [{ id: STEEL_BAR, n: 36, price: 700 }]);
        expect(plan?.target.name).toBe('Rune pickaxe');
        expect(plan?.sell).toEqual([{ id: STEEL_BAR, n: 36, price: 700 }]);
    });

    test('the plan covers the price after tax', () => {
        const offers = [{ id: STEEL_BAR, n: 10, price: 700 }, { id: COAL, n: 500, price: 150 }];
        const plan = planPickaxePurchase(candidates, 0, offers)!;
        const raised = plan.sell.reduce((s, o) => s + Math.floor(o.n * o.price * 0.95), 0);
        expect(plan.target.name).toBe('Rune pickaxe');
        expect(raised).toBeGreaterThanOrEqual(RUNE.price);
        expect(plan.sell.find(o => o.id === COAL)!.n).toBeLessThan(500);
    });

    test('nothing affordable', () => {
        expect(planPickaxePurchase(candidates, 25, [{ id: COAL, n: 10, price: 150 }])).toBeNull();
    });
});
