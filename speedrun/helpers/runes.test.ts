import { describe, expect, test } from 'bun:test';
import { Spells } from '../../sdk/spells';
import { castsToLevel, runesOptions, shopCost, shopList, shopUnitPrice, strikeFor, xpForLevel } from './runes';

describe('shop prices (shop.rs2 calc_shop_value)', () => {
    test('full shelf sells at base', () => {
        expect(shopUnitPrice(15, 30, 0)).toBe(15);
        expect(shopUnitPrice(50, 10, 0)).toBe(50);
    });
    test('each unit below stock adds delta/1000 of base, floored', () => {
        expect(shopUnitPrice(50, 10, 1)).toBe(50); // 50 * 1010 / 1000 = 50.5
        expect(shopUnitPrice(50, 10, 2)).toBe(51);
        expect(shopUnitPrice(15, 30, 19)).toBe(23); // Lundail's last cosmic on a full-to-empty drain
    });
    test('markup caps at 6x base (5000 / 1000 added)', () => {
        expect(shopUnitPrice(50, 10, 500)).toBe(300);
        expect(shopUnitPrice(50, 10, 900)).toBe(300);
    });
    test('drain costs match the first report', () => {
        expect(shopCost(15, 30, 20)).toBe(376); // 20 cosmics from Lundail
        expect(shopCost(50, 10, 570)).toBe(108_250); // 570 blood from a full Magic Guild shelf
        expect(shopCost(40, 30, 50)).toBe(3_450); // 50 laws from Lundail
    });
});

describe('Magic training', () => {
    test('xp table', () => {
        expect(xpForLevel(1)).toBe(0);
        expect(xpForLevel(2)).toBe(83);
        expect(xpForLevel(66)).toBe(496_254);
        expect(xpForLevel(99)).toBe(13_034_431);
    });
    test('casts to 66 at 25x and 13 base xp per cast', () => {
        expect(castsToLevel(0, 66)).toBe(Math.ceil(496_254 / 325));
        expect(castsToLevel(496_254, 66)).toBe(0);
        expect(castsToLevel(600_000, 66)).toBe(0);
    });
    test('wind strike below 9, earth strike with a staff of earth from 9', () => {
        expect(strikeFor(1)).toEqual({ spell: Spells.WIND_STRIKE, name: 'Wind Strike', staff: null });
        expect(strikeFor(9).spell).toBe(Spells.EARTH_STRIKE);
        expect(strikeFor(65).staff).toBe('Staff of earth');
    });
});

describe('options and the shop list', () => {
    test('defaults', () => {
        const o = runesOptions({});
        expect(o.phases).toEqual(['fund', 'shops', 'talismans', 'magic', 'guild', 'lundail']);
        expect(o.targets['Cosmic rune']).toBe(62);
        expect(o.funders.map(String)).toEqual(['/^cairn_h03$/i']);
    });
    test('unknown phases are refused', () => {
        expect(() => runesOptions({ phases: ['shops', 'fish'] })).toThrow(/unknown phase fish/);
    });
    test('training adds air, mind and a staff of earth; Betty repeats the rune lines as a second shelf', () => {
        const o = runesOptions({ targets: { 'Air rune': 100, 'Mind rune': 4 } });
        const list = shopList(o, 50);
        const air = list.filter(l => l.item === 'Air rune');
        expect(air.map(l => l.shop)).toEqual(['aubury', 'betty']);
        expect(air.every(l => l.quantity === 150)).toBe(true);
        expect(list.find(l => l.item === 'Mind rune')!.quantity).toBe(54);
        expect(list.find(l => l.item === 'Staff of earth')!.shop).toBe('zaff');
        // Shop-less lines never reach the buyer.
        expect(list.some(l => /cosmic|blood|law|talisman/i.test(String(l.item)))).toBe(false);
    });
    test('no training: no staff of earth', () => {
        const list = shopList(runesOptions({}), 0);
        expect(list.some(l => l.item === 'Staff of earth')).toBe(false);
        expect(list.find(l => l.item === 'Air rune')!.quantity).toBe(1650);
    });
});
