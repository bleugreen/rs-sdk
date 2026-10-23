import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseInvs, parseMapNpcs, parseNpcOwners, parseObjs, parsePack, parseScriptedOwners, type Content } from './content';
import { buyCost, ceilingPrice, restockPerHour, unitPrice, unitsToCeiling } from './curve';
import { summarize, type GeRead } from './ge';
import { cheapestFill } from './plan';
import { BEGIN, END, detailRows, itemViews, render, splice, type ShelfRead } from './render';
import { shelves, shopRows } from './shops';

const fx = (f: string) => readFileSync(join(import.meta.dir, 'fixtures', f), 'utf8');

function fixtureContent(): Content {
    const invs = new Map(parseInvs(fx('shop.inv'), 'shop.inv').map(i => [i.name, i]));
    const owners = parseNpcOwners(fx('shop.npc'), 'shop.npc');
    const objs = new Map(parseObjs(fx('items.obj')).map(o => [o.debugname, o]));
    const ids = parsePack('565=bloodrune\n556=airrune\n564=cosmicrune\n');
    for (const o of objs.values()) o.id = ids.get(o.debugname);
    const spawns = new Map([
        ['guild_owner_fx', [{ x: 2595, z: 3087, level: 1 }]],
        ['shop_keeper_fx', [{ x: 2757, z: 2770, level: 0 }]],
        ['shop_assistant_fx', [{ x: 2758, z: 2771, level: 0 }]],
    ]);
    return { invs, owners, objs, spawns };
}

describe('content parsing', () => {
    test('stock lines: count and rate, no rate means never restocks; restock flag per inv', () => {
        const [shop, atoll] = parseInvs(fx('shop.inv'));
        expect(shop!.restock).toBe(true);
        expect(shop!.stock).toEqual([
            { obj: 'bloodrune', count: 1000, rate: 300 },
            { obj: 'airrune', count: 3000, rate: 18 },
            { obj: 'cosmicrune', count: 20, rate: 0 },
        ]);
        expect(atoll!.restock).toBe(false);
    });

    test('NPC owners take the shopkeeper param defaults (sell 100, buy 60, delta 10) when unset', () => {
        const owners = parseNpcOwners(fx('shop.npc'));
        expect(owners.map(o => o.npc)).toEqual(['guild_owner_fx', 'shop_keeper_fx', 'shop_assistant_fx']);
        expect(owners[0]).toMatchObject({ inv: 'runeshop_fx', npcName: 'Magic Store owner', sell: 1000, buy: 60, delta: 10 });
        expect(owners[1]).toMatchObject({ sell: 100, buy: 60, delta: 10 });
    });

    test('a script branching on map_members keeps only its members shop', () => {
        const owners = parseScriptedOwners(fx('zaff.rs2'), 'areas/area_varrock/scripts/zaff.rs2');
        expect(owners).toHaveLength(1);
        expect(owners[0]).toMatchObject({ inv: 'memberstaffshop', npc: 'zaff', buy: 550, sell: 1000, delta: 20, scripted: true });
    });

    test('objs: cost defaults to 1, members flag read', () => {
        const objs = parseObjs(fx('items.obj'));
        expect(objs.find(o => o.debugname === 'bloodrune')).toMatchObject({ name: 'Blood rune', cost: 50, members: true });
        expect(objs.find(o => o.debugname === 'cert_airrune')!.cost).toBe(1);
    });

    test('map NPC lines place spawns at square * 64 + local, NPC block only', () => {
        expect(parseMapNpcs(fx('m40_48.jm2'), 'maps/m40_48.jm2')).toEqual([
            { id: 461, at: { level: 1, x: 2595, z: 3095 } },
            { id: 7, at: { level: 0, x: 2562, z: 3075 } },
        ]);
    });
});

describe('price curve', () => {
    const blood = { cost: 50, sell: 1000, delta: 10, base: 1000 };

    test('each unit below base adds delta/1000 of cost, from the base price', () => {
        expect(unitPrice(blood, 1000)).toBe(50);
        // delta 10: 1% of cost a unit, so 100 units down doubles the price.
        expect(unitPrice(blood, 999)).toBe(50);
        expect(unitPrice(blood, 998)).toBe(51);
        expect(unitPrice(blood, 900)).toBe(100);
        // rune-arrows.md: 400 gp plus 4 gp per arrow missing from Dargaud's 400.
        const arrows = { cost: 400, sell: 1000, delta: 10, base: 400 };
        expect(unitPrice(arrows, 340) - unitPrice(arrows, 400)).toBe(240);
    });

    test('ceiling is (sell + 5000)/1000 of cost, reached 5000/delta units below base', () => {
        expect(ceilingPrice(blood)).toBe(300);
        expect(unitsToCeiling(blood)).toBe(500);
        expect(unitPrice(blood, 500)).toBe(300);
        expect(unitsToCeiling({ ...blood, base: 20, delta: 30 })).toBeNull();
    });

    test('570 blood runes from a full Magic Guild shelf cost 108,250 (runes.md)', () => {
        expect(buyCost(blood, 570)).toBe(108_250);
        expect(buyCost(blood, 1001)).toBeNull();
    });

    test('above base the price falls, floored at 100/1000 of cost and 1 gp', () => {
        expect(unitPrice({ cost: 4, sell: 1000, delta: 10, base: 0 }, 2000)).toBe(1);
        expect(unitPrice({ cost: 1000, sell: 1000, delta: 10, base: 0 }, 50)).toBe(500);
    });

    test('restock per hour at 9,000 ticks an hour; 0 for no rate', () => {
        expect(restockPerHour(300)).toBe(30);
        expect(restockPerHour(0)).toBe(0);
    });
});

describe('shop rows', () => {
    test('a keeper and assistant sharing one inv are one shelf', () => {
        const c = fixtureContent();
        const merged = shelves(c);
        expect(merged).toHaveLength(2);
        expect(merged[1]!.owner.npcName).toBe('Shop keeper / Shop assistant');
        expect(merged[1]!.spawns).toHaveLength(2);
    });

    test('a non-restocking inv and a rate-less line restock nothing', () => {
        const rows = shopRows(fixtureContent());
        const atollAir = rows.find(r => r.inv === 'atollshop_fx')!;
        expect(atollAir.restockPerHour).toBe(0);
        expect(rows.find(r => r.obj === 'cosmicrune')!.restockPerHour).toBe(0);
        expect(rows.find(r => r.obj === 'bloodrune')).toMatchObject({ priceAtBase: 50, ceiling: 300, toCeiling: 500, restockPerHour: 30 });
    });
});

describe('cheapest fill', () => {
    const shop = { label: 'guild', pricing: { cost: 50, sell: 1000, delta: 10, base: 1000 } };

    test('buys from the shop until its climbing price passes the GE ask', () => {
        // The shop's price reaches 99 at 98 units below base and 100 at 100; ties go to the shop.
        const f = cheapestFill(150, [shop], { ask: 99, depth: 1000 });
        expect(f.taken.guild).toBe(100);
        expect(f.ge).toBe(50);
        expect(f.marginal).toBe(99);
    });

    test('reports a shortfall when every source runs out', () => {
        const f = cheapestFill(30, [{ label: 'lundail', pricing: { cost: 15, sell: 1000, delta: 30, base: 20 } }], { ask: 10_000, depth: 1 });
        expect(f.units).toBe(21);
        expect(f.ge).toBe(1);
    });

    test('no source: zero units', () => {
        expect(cheapestFill(5, [], null)).toMatchObject({ units: 0, cost: 0, marginal: null });
    });
});

describe('GE summary', () => {
    const reads: GeRead[] = JSON.parse(fx('ge-read.json'));

    test('book mean, 7-day low and high, units per hour over the window', () => {
        const s = summarize(reads[0]!);
        expect(s).toMatchObject({ ask: 1321, askDepth: 100, askMean: 1500, bid: 1301, low: 578, high: 1258 });
        expect(s.perHour).toBe(1008 / 168);
    });

    test('a failed read summarises as empty', () => {
        expect(summarize(reads[1]!)).toMatchObject({ ask: null, askDepth: 0, perHour: null });
    });
});

describe('render', () => {
    const content = fixtureContent();
    const input = (shelf: ShelfRead[] = []) => ({
        supplies: [
            { group: 'Runes' as const, name: 'Blood rune', need: 570 },
            { group: 'Runes' as const, name: 'Air rune', need: 1650 },
            { group: 'Runes' as const, name: 'Cosmic rune', need: 60 },
        ],
        content,
        rows: shopRows(content),
        ge: JSON.parse(fx('ge-read.json')) as GeRead[],
        shelf,
        banks: [{ name: 'yanille', x: 2613, z: 3092 }],
        fleet: () => undefined,
    });

    test('the summary prices the need from the cheapest mix and keeps config-only and pending cells', () => {
        const md = render(input());
        expect(md).toContain('| Blood rune | 570 |  | Magic Store owner: 50 x1,000 | 30 | 1,321 x100 | 1,301 x17,916 | 12,935 (6/h) | 108,250 | 190 |');
        expect(md).toContain('| pending |');
    });

    test('a shelf read fills the live column with its count, price and time', () => {
        const md = render(input([{ inv: 'runeshop_fx', obj: 'airrune', count: 2950, price: 4, at: '2026-10-23T09:12:00Z' }]));
        expect(md).toContain('2,950 at 4 (2026-10-23 09:12Z)');
    });

    test('the detail lists at most five shops per item', () => {
        const v = itemViews(input())[1]!;
        expect(detailRows({ ...v, rows: Array(8).fill(v.rows[0]) }, () => undefined)).toHaveLength(5);
    });

    test('splice replaces only the generated block', () => {
        const doc = `intro\n${BEGIN}\nold\n${END}\noutro\n`;
        expect(splice(doc, 'new')).toBe(`intro\n${BEGIN}\n\nnew\n\n${END}\noutro\n`);
        expect(() => splice('no markers', 'x')).toThrow();
    });
});
