import { describe, expect, test } from 'bun:test';
import { Spells } from '../../sdk/spells';
import type { ListLine } from './buyer';
import {
    castsToLevel,
    GUILD_ITEMS,
    inKeep,
    KEEP_WEB_OUT,
    RUIN_WEBS_IN,
    RUIN_WEBS_OUT,
    limitToCarry,
    manifestLines,
    PLACES,
    purchaseBudget,
    runesOptions,
    shopCost,
    shopUnitPrice,
    staffLines,
    strikeFor,
    trainingLines,
    xpForLevel
} from './runes';

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

describe('options and the purchase lists', () => {
    test('defaults', () => {
        const o = runesOptions({});
        expect(o.phases).toEqual(['fund', 'shops', 'talismans', 'magic', 'guild', 'lundail']);
        expect(o.targets['Cosmic rune']).toBe(62);
        expect(o.funders.map(String)).toEqual(['/^cairn_h47$/i']);
        // Never stand idle in a shop by default (random events find a still account twice as often).
        expect(o.shopWaitTicks).toBe(0);
        expect(o.maxCarry).toBe(30_000);
    });
    test('unknown phases are refused', () => {
        expect(() => runesOptions({ phases: ['shops', 'fish'] })).toThrow(/unknown phase fish/);
    });
    test('Zaff sells the staves; the staff of earth only while training', () => {
        const o = runesOptions({});
        expect(staffLines(o, true).map(l => l.item)).toEqual(['Staff of water', 'Staff of fire', 'Staff of earth']);
        expect(staffLines(o, false).map(l => l.item)).toEqual(['Staff of water', 'Staff of fire']);
        expect(staffLines(o, true).every(l => l.shop === 'zaff' && l.maxWaitTicks === 0)).toBe(true);
    });
    test('training lines: air and mind for a chunk of casts at one shop', () => {
        const o = runesOptions({});
        const lines = trainingLines(o, 'betty', 300);
        expect(lines.map(l => [l.item, l.quantity, l.shop])).toEqual([
            ['Air rune', 300, 'betty'],
            ['Mind rune', 300, 'betty']
        ]);
        expect(trainingLines(o, 'aubury', 0)).toEqual([]);
    });
    test('the guild covers every manifest rune but cosmic', () => {
        const lines = manifestLines(runesOptions({}), 'magicGuild', GUILD_ITEMS, 0);
        expect(lines.map(l => l.item).sort()).toEqual(Object.keys(runesOptions({}).targets).filter(k => / rune$/.test(k) && k !== 'Cosmic rune').sort());
        expect(lines.find(l => l.item === 'Blood rune')!.quantity).toBe(570);
    });
});

describe('coins carried never exceed one capped purchase', () => {
    const held = (m: Record<string, number>) => (item: string) => m[item] ?? 0;
    const line = (item: string, quantity: number, maxPrice: number): ListLine => ({ item, quantity, maxPrice, source: 'shop', shop: 'magicGuild' });

    test('the budget is every missing unit at its cap', () => {
        expect(purchaseBudget([line('Blood rune', 570, 300), line('Law rune', 50, 120)], held({ 'Law rune': 20 }))).toBe(570 * 300 + 30 * 120);
    });
    test('the guild purchase is cut into trips of at most maxCarry, first lines first', () => {
        const lines = [line('Blood rune', 570, 300), line('Law rune', 50, 120)];
        const cut = limitToCarry(lines, held({ 'Blood rune': 10 }), 30_000);
        expect(cut).toEqual([{ ...lines[0]!, quantity: 110 }]); // 100 more blood at 300 = 30,000
        expect(purchaseBudget(cut, held({ 'Blood rune': 10 }))).toBe(30_000);
    });
    test('lines already held are dropped and a small purchase passes whole', () => {
        const lines = [line('Air rune', 300, 12), line('Mind rune', 300, 9)];
        expect(limitToCarry(lines, held({ 'Air rune': 300 }), 30_000)).toEqual([lines[1]!]);
    });
    test('for any purchase, the cut budget fits maxCarry', () => {
        let seed = 7;
        const rnd = (n: number) => (seed = (seed * 48271) % 2147483647) % n;
        for (let k = 0; k < 500; k++) {
            const lines = Array.from({ length: 1 + rnd(6) }, (_, i) => line(`Item ${i}`, rnd(2000), 1 + rnd(400)));
            const have = held(Object.fromEntries(lines.map(l => [String(l.item), rnd(500)])));
            const maxCarry = rnd(60_000);
            const cut = limitToCarry(lines, have, maxCarry);
            expect(purchaseBudget(cut, have)).toBeLessThanOrEqual(maxCarry);
            for (const c of cut) expect(c.quantity).toBeLessThanOrEqual(lines.find(l => l.item === c.item)!.quantity);
        }
    });
});

describe('the Deserted Keep', () => {
    test('the lever is inside the keep, the web is its north edge', () => {
        expect(inKeep(PLACES.keepLever.x, PLACES.keepLever.z)).toBe(true);
        expect(inKeep(PLACES.keepWebSouth.x, PLACES.keepWebSouth.z)).toBe(true);
        expect(inKeep(PLACES.keepWebNorth.x, PLACES.keepWebNorth.z)).toBe(false);
        expect(inKeep(PLACES.arenaLadder.x, PLACES.arenaLadder.z)).toBe(false);
    });
    test('every web crossing steps two tiles straight through its web', () => {
        for (const c of [KEEP_WEB_OUT, ...RUIN_WEBS_IN, ...RUIN_WEBS_OUT]) {
            expect(Math.abs(c.from.x - c.to.x) + Math.abs(c.from.z - c.to.z)).toBe(2);
            expect((c.from.x + c.to.x) / 2).toBe(c.web.x);
            expect((c.from.z + c.to.z) / 2).toBe(c.web.z);
        }
    });
    test('the ruin route chains east to west into the ladder, and back out the same way', () => {
        expect(RUIN_WEBS_IN[0]!.to).toEqual(RUIN_WEBS_IN[1]!.from);
        expect(RUIN_WEBS_IN[1]!.to).toEqual({ x: 3092, z: 3957 }); // beside the ladder at (3091, 3957)
        expect(RUIN_WEBS_OUT.map(c => c.name)).toEqual(['the ruin west web', 'the ruin east web']);
        expect(RUIN_WEBS_OUT[1]!.to).toEqual({ x: 3096, z: 3957 });
    });
});
