import { describe, expect, test } from 'bun:test';
import {
    boardValue, costOf, highAlch, lootPerSuccess, lowAlch, objCosts, parseObjCosts, perHour, PICKPOCKET, pickpocketChance, pickpocketPerTick,
    pickpocketTicksPerRoll, restockPerHour, shopBuyTotal, shopSellTotal, shopUnitPrice, spread, ticksPerHour
} from './value';

describe('rates', () => {
    test('an hour is 9,000 ticks at 400 ms and 12,000 at 300 ms', () => {
        expect(ticksPerHour(400)).toBe(9000);
        expect(ticksPerHour(300)).toBe(12000);
        expect(perHour(50, 100, 400)).toBe(4500);
        expect(perHour(5, 0, 400)).toBe(0);
    });
    test('spread', () => {
        expect(spread([])).toEqual({ n: 0, mean: 0, min: 0, max: 0, sd: 0 });
        const s = spread([2, 4, 4, 4, 5, 5, 7, 9]);
        expect(s.n).toBe(8);
        expect(s.mean).toBe(5);
        expect(s.min).toBe(2);
        expect(s.max).toBe(9);
        expect(s.sd).toBeCloseTo(2.138, 3);
    });
});

describe('obj costs', () => {
    test('parses cost lines per section and defaults to 1', () => {
        const c = parseObjCosts(['[a]\nname=A\ncost=300\n\n[b]\nname=B\n', '[c]\ncost=7']);
        expect(c.get('a')).toBe(300);
        expect(c.get('b')).toBe(1);
        expect(c.get('c')).toBe(7);
        expect(costOf('cert_a', c)).toBe(300);
        expect(costOf('nope', c)).toBeUndefined();
    });
    test('reads the real content: the board values the methods table rests on', () => {
        const c = objCosts();
        expect(costOf('coins', c)).toBe(1);
        expect(costOf('ruby_ring', c)).toBe(2025);
        expect(costOf('shark', c)).toBe(300);
        expect(costOf('raw_shark', c)).toBe(300);
        expect(costOf('cert_raw_shark', c)).toBe(300);
        expect(costOf('coal', c)).toBe(45);
        expect(costOf('blankrune', c)).toBe(4);
        expect(costOf('yew_logs', c)).toBe(160);
        expect(costOf('magic_logs', c)).toBe(320);
    });
    test('board value sums cost x count and reports unknown objs', () => {
        const c = parseObjCosts(['[coins]\ncost=1\n[shark]\ncost=300']);
        expect(boardValue([{ obj: 'coins', count: 1000 }, { obj: 'cert_shark', count: 10 }, { obj: 'mystery', count: 1 }], c)).toEqual({ value: 4000, unknown: ['mystery'] });
    });
});

describe('outlets', () => {
    test('alchemy pays 60% and 40% of cost, at least 1', () => {
        expect(highAlch(2025)).toBe(1215);
        expect(lowAlch(2025)).toBe(810);
        expect(highAlch(1)).toBe(1);
    });
    test("Irksol's ruby rings (sell multiplier 500, stock 5): 1,012 at full stock, +1% of cost per ring sold", () => {
        expect(shopUnitPrice(2025, 500, 5, 5)).toBe(1012);
        expect(shopUnitPrice(2025, 500, 4, 5)).toBe(1032);
        expect(shopUnitPrice(2025, 500, 1, 5)).toBe(1093);
        expect(shopBuyTotal(2025, 500, 5, 5, 5)).toBe(1012 + 1032 + 1053 + 1073 + 1093);
        // the shelf holds 5: a sixth is not for sale
        expect(shopBuyTotal(2025, 500, 5, 5, 6)).toBe(shopBuyTotal(2025, 500, 5, 5, 5));
        // and Irksol buys them back at 300/1000
        expect(shopSellTotal(2025, 300, 5, 5, 1)).toBe(607);
    });
    test('a standard shop (multiplier 1000) prices at cost at full stock and caps at 6x below it', () => {
        expect(shopUnitPrice(20, 1000, 1000, 1000)).toBe(20);
        expect(shopUnitPrice(20, 1000, 0, 1000)).toBe(120);
        // a general store (buy 400, delta 30) buying an item it does not stock: 40% of cost, less 3% per held unit
        expect(shopUnitPrice(300, 400, 0, -1, 30)).toBe(120);
        expect(shopUnitPrice(300, 400, 3, -1, 30)).toBe(93);
        // and never below 10% of cost
        expect(shopUnitPrice(300, 400, 100, -1, 30)).toBe(30);
    });
    test('restock per hour is a world clock', () => {
        expect(restockPerHour(500, 400)).toBe(18);
        expect(restockPerHour(500, 300)).toBe(24);
    });
});

describe('pickpocketing', () => {
    test('success chance matches thieving.md (knight 99: 94.1%; paladin 59%; hero 39.5%)', () => {
        expect(pickpocketChance(99, 50, 240)).toBeCloseTo(241 / 256, 6);
        expect(pickpocketChance(99, 50, 150)).toBeCloseTo(151 / 256, 6);
        expect(pickpocketChance(99, 6, 100)).toBeCloseTo(101 / 256, 6);
        expect(pickpocketChance(55, 50, 240)).toBeCloseTo(0.6055, 3);
    });
    test('loot rolls every entry from the last: paladins always pay coins and chaos runes', () => {
        const pal = lootPerSuccess(PICKPOCKET.paladin!.loot);
        expect(pal.get('coins')).toBe(80);
        expect(pal.get('chaosrune')).toBe(2);
    });
    test('heroes always pay 200-300 coins, plus independent rare rolls', () => {
        const h = lootPerSuccess(PICKPOCKET.hero!.loot);
        expect(h.get('coins')).toBe(250);
        expect(h.get('gold_ore')).toBeCloseTo(1 / 128, 6);
        expect(h.get('diamond')).toBeCloseTo(1 / 127, 6);
        expect(h.get('fire_orb')).toBeCloseTo(2 / 126, 6);
        expect(h.get('bloodrune')).toBeCloseTo(5 / 124, 6);
        expect(h.get('jug_wine')).toBeCloseTo(6 / 119, 6);
        expect(h.get('deathrune')).toBeCloseTo((2 * 8) / 113, 6);
    });
    test('a farmer (weight 123 of 128) pays 9 coins 123/128 of the time', () => {
        expect(lootPerSuccess(PICKPOCKET.farmer!.loot).get('coins')).toBeCloseTo((9 * 123) / 128, 6);
    });
    test('ticks per roll: 2 a success, stun + 3 a failure', () => {
        expect(pickpocketTicksPerRoll(1, 8)).toBe(2);
        expect(pickpocketTicksPerRoll(0, 8)).toBe(11);
        expect(pickpocketTicksPerRoll(0, 10)).toBe(13);
    });
    test('knight at 99: about 18.6 coins per tick before walking and eating', () => {
        expect(pickpocketPerTick(PICKPOCKET.knight!, 99).get('coins')!).toBeCloseTo(18.59, 1);
    });
});
