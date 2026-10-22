import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { objName } from '../lib/items';
import { AMULET_ENCHANTS, enchantOptions, enchantPlan, planWithdrawals, RUNES } from './enchant';

const SAPPHIRE = 1694;
const RUBY = 1698;
const UNSTRUNG_SAPPHIRE = 1675;
const AMULET_OF_MAGIC = 1727;
const bank = (lines: Record<number, number>) => Object.entries(lines).map(([id, count]) => ({ id: Number(id), count }));
const runes = { [RUNES.cosmic]: 190, [RUNES.fire]: 285, [RUNES.water]: 95 };

describe('the enchant table', () => {
    test('ids name the strung amulets, their products and the runes in obj.pack', () => {
        expect(AMULET_ENCHANTS.map(e => [objName(e.from), objName(e.product)])).toEqual([
            ['strung_sapphire_amulet', 'amulet_of_magic'],
            ['strung_ruby_amulet', 'amulet_of_strength']
        ]);
        expect([objName(RUNES.fire), objName(RUNES.water), objName(RUNES.cosmic)]).toEqual(['firerune', 'waterrune', 'cosmicrune']);
    });

    test('levels, runes and products match magic_spells.dbrow', () => {
        const dbrow = readFileSync(join(import.meta.dir, '../../server/content/scripts/skill_magic/configs/magic_spells.dbrow'), 'utf8');
        const spell = (n: number) => dbrow.split(/\n(?=\[)/).find(b => b.startsWith(`[magic_spell_enchant_level${n}]`))!;
        const lvl1 = spell(1);
        const lvl3 = spell(3);
        expect(lvl1).toContain('data=levelrequired,7');
        expect(lvl1).toContain('data=runesrequired,waterrune,1,cosmicrune,1,');
        expect(lvl1).toContain('data=convertobj,strung_sapphire_amulet,amulet_of_magic,');
        expect(lvl3).toContain('data=levelrequired,49');
        expect(lvl3).toContain('data=runesrequired,firerune,5,cosmicrune,1,');
        expect(lvl3).toContain('data=convertobj,strung_ruby_amulet,amulet_of_strength,');
        const [sapphire, ruby] = AMULET_ENCHANTS;
        expect([sapphire!.spell, sapphire!.level, sapphire!.runes]).toEqual([1, 7, { [RUNES.water]: 1, [RUNES.cosmic]: 1 }]);
        expect([ruby!.spell, ruby!.level, ruby!.runes]).toEqual([3, 49, { [RUNES.fire]: 5, [RUNES.cosmic]: 1 }]);
    });
});

describe('enchantPlan', () => {
    test('one of each amulet: two casts and the runes for both', () => {
        const p = enchantPlan(bank({ [SAPPHIRE]: 1, [RUBY]: 1, ...runes }), 66);
        expect(p.short).toEqual([]);
        expect(p.casts.map(e => e.productName)).toEqual(['Amulet of magic', 'Amulet of strength']);
        expect(Object.fromEntries(p.runes)).toEqual({ [RUNES.water]: 1, [RUNES.cosmic]: 2, [RUNES.fire]: 5 });
        expect(planWithdrawals(p)).toEqual([
            { item: SAPPHIRE, n: 1, asNote: false },
            { item: RUBY, n: 1, asNote: false },
            { item: RUNES.water, n: 1 },
            { item: RUNES.cosmic, n: 2 },
            { item: RUNES.fire, n: 5 }
        ]);
    });

    test('unstrung amulets and finished products are not cast on', () => {
        expect(enchantPlan(bank({ [UNSTRUNG_SAPPHIRE]: 3, [AMULET_OF_MAGIC]: 1, ...runes }), 99)).toEqual({ casts: [], runes: new Map(), short: [] });
    });

    test('a level short for any amulet withdraws nothing', () => {
        const p = enchantPlan(bank({ [SAPPHIRE]: 1, [RUBY]: 1, ...runes }), 48);
        expect(p.casts).toEqual([]);
        expect(p.short).toEqual(["Magic 48 is below Lvl-3 Enchant's 49 (1 ruby amulet)"]);
    });

    test('a rune short withdraws nothing and says which', () => {
        const p = enchantPlan(bank({ [SAPPHIRE]: 1, [RUBY]: 1, [RUNES.cosmic]: 1, [RUNES.fire]: 4, [RUNES.water]: 1 }), 66);
        expect(p.casts).toEqual([]);
        expect(p.short).toEqual(['2 Cosmic rune needed, 1 banked', '5 Fire rune needed, 4 banked']);
    });

    test('max limits each amulet and drops the runes it would have used', () => {
        const p = enchantPlan(bank({ [SAPPHIRE]: 4, [RUBY]: 1, [RUNES.cosmic]: 2, [RUNES.water]: 2 }), 66, { sapphire: 2, ruby: 0 });
        expect(p.short).toEqual([]);
        expect(p.casts.map(e => e.amulet)).toEqual(['sapphire', 'sapphire']);
        expect(Object.fromEntries(p.runes)).toEqual({ [RUNES.water]: 2, [RUNES.cosmic]: 2 });
    });

    test('casts fill the inventory beside one slot per rune stack', () => {
        const p = enchantPlan(bank({ [SAPPHIRE]: 30, ...runes }), 66);
        expect(p.casts.length).toBe(26);
        expect(Object.fromEntries(p.runes)).toEqual({ [RUNES.water]: 26, [RUNES.cosmic]: 26 });
    });
});

describe('enchantOptions', () => {
    test('defaults: no bank tile, no limit', () => {
        expect(enchantOptions({})).toEqual({ max: {} });
        expect(enchantOptions({ bank: { x: 3185, z: 3436 }, max: { ruby: 1 } })).toEqual({ bank: { x: 3185, z: 3436 }, max: { ruby: 1 } });
    });

    test('refuses what it cannot honour', () => {
        expect(() => enchantOptions({ amulets: {} })).toThrow("unknown option 'amulets'");
        expect(() => enchantOptions({ max: { emerald: 1 } })).toThrow('max.emerald');
        expect(() => enchantOptions({ max: { ruby: -1 } })).toThrow('max.ruby');
        expect(() => enchantOptions({ bank: { x: 1 } })).toThrow('bank must be');
    });
});
