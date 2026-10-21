import { describe, expect, test } from 'bun:test';
import { chooseBar, ironOreShort, planOreBuy, planPickaxePurchase, readOpts, type BarChoice } from './smelter';

const COAL = 453;
const IRON = 440;
const MITH = 447;
const ADDY = 449;
const IRON_BAR = 2351;
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

    test('steel quota: a full trip, or what the quota still needs, then stop at the quota', () => {
        const quota = { steel: 40, iron: 0 };
        // 8 iron is less than a trip (9) and less than the 40 owed: wait for more ore.
        expect(chooseBar(choice({ smithing: 72, tier: 'adamant', quota, banked: bank({ [IRON]: 8, [COAL]: 500 }) }))).toBeNull();
        expect(chooseBar(choice({ smithing: 72, tier: 'adamant', quota, banked: bank({ [IRON]: 9, [COAL]: 500 }) }))).toBe('steel');
        // Only 3 owed: 3 sets are enough to start.
        expect(chooseBar(choice({ smithing: 72, tier: 'adamant', quota, banked: bank({ [IRON]: 3, [COAL]: 500, [STEEL_BAR]: 37 }) }))).toBe('steel');
        expect(chooseBar(choice({ smithing: 72, tier: 'adamant', quota, banked: bank({ [IRON]: 30, [COAL]: 500, [STEEL_BAR]: 40 }) }))).toBeNull();
    });

    test('adamantite comes before the quota bars', () => {
        const banked = bank({ [ADDY]: 25, [IRON]: 30, [COAL]: 500 });
        expect(chooseBar(choice({ smithing: 72, quota: { steel: 40, iron: 10 }, banked }))).toBe('addy');
    });

    test('iron quota counts two ore per bar', () => {
        const quota = { steel: 0, iron: 9 };
        expect(chooseBar(choice({ smithing: 72, tier: 'adamant', quota, banked: bank({ [IRON]: 17 }) }))).toBeNull();
        expect(chooseBar(choice({ smithing: 72, tier: 'adamant', quota, banked: bank({ [IRON]: 18 }) }))).toBe('iron');
    });
});

describe('ironOreShort', () => {
    test('steel takes one ore per bar, iron two, less the ore already held', () => {
        const q = { steel: 75, iron: 9 };
        expect(ironOreShort(q, bank({}))).toBe(75 + 18);
        expect(ironOreShort(q, bank({ [STEEL_BAR]: 70, [IRON_BAR]: 9, [IRON]: 2 }))).toBe(3);
        expect(ironOreShort(q, bank({ [STEEL_BAR]: 75, [IRON_BAR]: 9 }))).toBe(0);
        expect(ironOreShort(q, bank({ [IRON]: 200 }))).toBe(0);
    });
});

describe('planOreBuy', () => {
    test('coins first, then just enough spare coal', () => {
        // h20: 670 coins, 1,331 coal; 349 steel owed (698 coal) at ask 109, coal bid 80.
        const p = planOreBuy(349, 109, 670, 1331, 698, 80)!;
        // Spare coal is 1,331 - 698 - 300 = 333, worth 25,308 after tax: 238 ore at 109.
        expect(p.buy).toBe(238);
        expect(p.sellCoal).toBe(333);
        const rich = planOreBuy(349, 109, 50_000, 1331, 698, 80)!;
        expect(rich).toEqual({ buy: 349, sellCoal: 0 });
    });

    test('sells only the coal the shortfall needs', () => {
        const p = planOreBuy(100, 109, 1000, 5000, 200, 80)!;
        expect(p.buy).toBe(100);
        expect(p.sellCoal).toBe(Math.ceil((100 * 109 - 1000) / 76));
    });

    test('nothing to buy or nothing to pay with', () => {
        expect(planOreBuy(0, 109, 1000, 5000, 0, 80)).toBeNull();
        expect(planOreBuy(50, 109, 50, 100, 0, 80)).toBeNull();
        expect(planOreBuy(50, 109, 50, 5000, 0, null)).toBeNull();
    });
});

describe('readOpts', () => {
    test('defaults: the Dwarven Mine for adamantite, no quotas, the site sets the combat level', () => {
        const o = readOpts({});
        expect(o.addy).toBe('dwarven');
        expect(o.combat).toBeNull();
        expect(o.quota).toEqual({ steel: 0, iron: 0 });
    });

    test('quotas and overrides', () => {
        const o = readOpts({ steel: 75, iron: 9.5, addy: 'none', combat: 40, site: 'dwarven' });
        expect(o.quota).toEqual({ steel: 75, iron: 9 });
        expect(o.addy).toBe('none');
        expect(o.combat).toBe(40);
        expect(o.site).toBe('dwarven');
        expect(readOpts({ addy: 'wilderness', steel: -3 }).addy).toBe('dwarven');
        expect(readOpts({ addy: 'alkharid' }).addy).toBe('alkharid');
        expect(readOpts({ site: 'alkharid' }).site).toBe('alkharid');
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
