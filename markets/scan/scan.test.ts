import { describe, expect, test } from 'bun:test';
import { parseConfigBlocks, parseInvs, parseMapSection, parseMineRows, parseNpcShops, parseObjs, parsePickpockets, parseScriptShops, parseStalls, type Content } from './content.ts';
import { mergeRows } from './ge-book.ts';
import { atSite, backoff, insideRepo, readSites, SITES } from './headcount.ts';
import { families, sessionsOf, stemOf, summariseSite, type Read } from './headcount-report.ts';
import { askLines, bidLines, buyFromShop, highAlch, pickpocketExpectation, sellToShop, shopAccepts, shopLines, shopValue, thievingLines } from './methods.ts';
import { DEFAULT_RANK, marketPrice, mineRates, respawnAt } from './rank.ts';
import { fletchingRecipes, priceRecipe, smeltingRecipes, smithingRecipes, statChance } from './recipes.ts';
import type { MarketQuote } from '../../sdk/market.ts';

const OBJ = `
[coins]
name=Coins
stackable=yes

[ruby_ring]
name=Ruby ring
cost=2025
// a comment
members=yes

[quest_thing]
name=Thing
cost=500
tradeable=no
respawnrate=30
`;

const PACK = new Map([['coins', 995], ['ruby_ring', 1641], ['cert_ruby_ring', 1642], ['quest_thing', 9]]);

describe('content parsers', () => {
    test('config blocks keep keys in order and skip comments', () => {
        const b = parseConfigBlocks(OBJ);
        expect(b.map(x => x.name)).toEqual(['coins', 'ruby_ring', 'quest_thing']);
        expect(b[1]!.lines.map(l => l.key)).toEqual(['name', 'cost', 'members']);
    });

    test('objs take ObjType defaults: cost 1, tradeable, respawn 100; notes by cert_ name', () => {
        const objs = parseObjs([OBJ], PACK);
        expect(objs.get('coins')).toMatchObject({ id: 995, cost: 1, stackable: true, tradeable: true, members: false, respawnrate: 100, note: null });
        expect(objs.get('ruby_ring')).toMatchObject({ cost: 2025, members: true, note: 1642 });
        expect(objs.get('quest_thing')).toMatchObject({ tradeable: false, respawnrate: 30 });
    });

    test('inv stock lines are obj, base count, restock period', () => {
        const invs = parseInvs(['[cheapringshop]\nscope=shared\nrestock=yes\nstock1=ruby_ring,5,500\n\n[generalshop1]\nallstock=yes\nrestock=yes\nstock1=pot_empty,5,100\n']);
        expect(invs.get('cheapringshop')).toEqual({ name: 'cheapringshop', stock: [{ obj: 'ruby_ring', base: 5, rate: 500 }], restock: true, allstock: false });
        expect(invs.get('generalshop1')!.allstock).toBe(true);
    });

    test('npc shops read their params and flag shopkeeper.param defaults', () => {
        const shops = parseNpcShops([
            '[irksol]\nname=Irksol\nparam=owned_shop,cheapringshop\nparam=shop_sell_multiplier,500\nparam=shop_buy_multiplier,300\nparam=shop_delta,10\nparam=shop_title,irksol\n',
            '[lazy]\nparam=owned_shop,lazyshop\n\n[guard]\nname=Guard\n',
        ]);
        expect(shops).toHaveLength(2);
        expect(shops[0]).toMatchObject({ keeper: 'irksol', inv: 'cheapringshop', sell: 500, buy: 300, delta: 10, defaulted: false });
        expect(shops[1]).toMatchObject({ sell: 100, buy: 60, delta: 10, defaulted: true });
    });

    test('script shops take ~openshop(inv, buy, sell, delta, title)', () => {
        const shops = parseScriptShops([{ file: 'zaff.rs2', text: 'if (x) {\n    ~openshop(memberstaffshop, 550, 1000, 20, "Zaff\'s Superior Staffs!");\n}' }]);
        expect(shops).toEqual([{ keeper: 'zaff.rs2', keeperDisplay: "Zaff's Superior Staffs!", inv: 'memberstaffshop', buy: 550, sell: 1000, delta: 20, title: "Zaff's Superior Staffs!", source: 'script', defaulted: false }]);
    });

    test('map sections give absolute tiles from the mX_Z square', () => {
        const text = '==== LOC ====\n0 4 54: 2111 10 2\n==== OBJ ====\n0 7 60: 1973 1\n1 4 55: 1955 3\n==== NPC ====\n0 2 53: 100\n';
        expect(parseMapSection('maps/m44_46.jm2', text, 'OBJ')).toEqual([{ level: 0, x: 2823, z: 3004, id: 1973, count: 1 }, { level: 1, x: 2820, z: 2999, id: 1955, count: 3 }]);
        expect(parseMapSection('maps/m44_46.jm2', text, 'NPC')).toEqual([{ level: 0, x: 2818, z: 2997, id: 100, count: 1 }]);
        expect(parseMapSection('maps/m44_46.jm2', text, 'LOC')[0]).toMatchObject({ x: 2820, z: 2998, id: 2111 });
    });

    test('mining, pickpocket and stall rows', () => {
        const mines = parseMineRows('[runite_rock_table]\ntable=mining_table\ndata=rock,runiterock1\ndata=rock,runiterock2\ndata=rock_output,runite_ore\ndata=rock_level,85\ndata=rock_successchance,1,18\ndata=rock_respawnrate,2400\n');
        expect(mines[0]).toMatchObject({ rocks: ['runiterock1', 'runiterock2'], output: 'runite_ore', level: 85, chance: [1, 18], respawn: 2400 });
        const pp = parsePickpockets('[pickpocket_paladin]\ntable=pickpocket\ndata=npc,paladin\ndata=level,70\ndata=stun_ticks,8\ndata=success_chance,15,180\ndata=loot,coins,80,80,128\ndata=loot,chaosrune,2,2,128\n');
        expect(pp[0]).toMatchObject({ npcs: ['paladin'], level: 70, chance: [15, 180], loot: [{ obj: 'coins', min: 80, max: 80, weight: 128 }, { obj: 'chaosrune', min: 2, max: 2, weight: 128 }] });
        const st = parseStalls('[stealing_bakery_stall]\ntable=stealing\ndata=loc,bakers_stall_stealing\ndata=level,5\ndata=respawn_ticks,8\ndata=loot,cake,1,1,13,a cake\ndata=loot,bread,1,1,7,some bread\ndata=loot_total,20\n');
        expect(st[0]).toMatchObject({ respawnTicks: 8, lootTotal: 20, loot: [{ obj: 'cake', weight: 13 }, { obj: 'bread', weight: 7 }] });
    });
});

describe('shop.rs2 pricing', () => {
    const irksol = { sell: 500, buy: 300, delta: 10 };
    const store = { sell: 1300, buy: 400, delta: 30 };

    test('at base stock the multiplier applies, truncated', () => {
        expect(buyFromShop(2025, irksol, 5, 5)).toBe(1012);
        expect(sellToShop(2025, irksol, 5, 5)).toBe(607);
    });

    test('each unit below base adds delta per mille, capped at +5000', () => {
        expect(buyFromShop(100, { sell: 1000, delta: 10 }, 999, 1000)).toBe(101);
        expect(buyFromShop(100, { sell: 1000, delta: 10 }, 0, 1000)).toBe(600);
    });

    test('overstock lowers the price by at most 1000 per mille, floored at 100', () => {
        expect(shopValue(100, 10, 1000, 2000)).toBe(10);
        expect(shopValue(100, 30, 1300, 10)).toBe(100);
        expect(shopValue(100, 30, 1300, 50)).toBe(30);
    });

    test('a general store prices an unlisted item on its whole stock, and never sells below 1 gp', () => {
        expect(sellToShop(1000, store, 0, -1)).toBe(400);
        expect(sellToShop(1000, store, 5, -1)).toBe(250);
        expect(buyFromShop(1, store, 100, -1)).toBe(1);
    });

    test('high alchemy pays 0.6 of cost, at least 1', () => {
        expect(highAlch(2025)).toBe(1215);
        expect(highAlch(1)).toBe(1);
    });

    test('shops take listed items, general stores anything tradeable, nobody coins', () => {
        const objs = parseObjs([OBJ], PACK);
        const ring = objs.get('ruby_ring')!;
        expect(shopAccepts({ name: 'x', stock: [], restock: true, allstock: true }, ring)).toBe(true);
        expect(shopAccepts({ name: 'x', stock: [], restock: true, allstock: false }, ring)).toBe(false);
        expect(shopAccepts({ name: 'x', stock: [], restock: true, allstock: true }, objs.get('coins')!)).toBe(false);
        expect(shopAccepts({ name: 'x', stock: [], restock: true, allstock: true }, objs.get('quest_thing')!)).toBe(false);
    });
});

describe('thieving', () => {
    const cost = (o: string) => ({ coins: 1, chaosrune: 15, diamond: 2000 } as Record<string, number>)[o] ?? 0;

    test('pickpocket rolls run last entry first, each against what weight is left', () => {
        const e = pickpocketExpectation([{ obj: 'coins', min: 200, max: 300, weight: 64 }, { obj: 'diamond', min: 1, max: 1, weight: 64 }], cost);
        // diamond: 64/128; then coins: 64/64.
        expect(e.value).toBeCloseTo(0.5 * 2000 + 250);
        expect(e.coins).toBeCloseTo(250);
    });

    test('once the weights are spent, random(0) awards every remaining entry', () => {
        const e = pickpocketExpectation([{ obj: 'coins', min: 80, max: 80, weight: 128 }, { obj: 'chaosrune', min: 2, max: 2, weight: 128 }], cost);
        expect(e.coins).toBe(80);
        expect(e.value).toBe(80 + 30);
    });

    test('stat_random floors both terms like the engine', () => {
        expect(statChance(180, 240, 1)).toBeCloseTo(181 / 256);
        expect(statChance(180, 240, 99)).toBeCloseTo(241 / 256);
        expect(statChance(1, 18, 99)).toBeCloseTo(19 / 256);
        expect(statChance(300, 300, 99)).toBe(1);
    });

    test('stalls award one entry by weight over the total', () => {
        const c = { objs: parseObjs(['[cake]\ncost=50\n[bread]\ncost=12\n']), pickpockets: [], stalls: parseStalls('[s]\ntable=stealing\ndata=loc,stall\ndata=respawn_ticks,8\ndata=loot,cake,1,1,15,a\ndata=loot,bread,1,1,5,b\ndata=loot_total,20\n') } as unknown as Content;
        const [s] = thievingLines(c, statChance);
        expect(s!.valuePerSuccess).toBeCloseTo(0.75 * 50 + 0.25 * 12);
        expect(s!.valuePerTick).toBeCloseTo((0.75 * 50 + 0.25 * 12) / 8);
    });
});

describe('recipes', () => {
    const objs = parseObjs(['[runite_bar]\ncost=5000\n[rune_platebody]\ncost=65000\n[opal_bolttips]\ncost=3\n[bolt]\ncost=1\n[opal_bolt]\ncost=6\n[opal]\ncost=100\n']);

    test('smithing rows turn bars into products', () => {
        const [r] = smithingRecipes('[rune_platebody]\ntable=smithing\ndata=ifproduct,rune_platebody\ndata=product,rune_platebody\ndata=product_amount,1\ndata=levelrequired,99\ndata=bar,runite_bar\ndata=bar_amount,5\n');
        const p = priceRecipe(r!, objs);
        expect(p.inputs).toEqual([{ obj: 'runite_bar', n: 5 }]);
        expect(p.addedPerAction).toBe(40000);
        expect(p.addedPerTick).toBe(40000 / p.cycle.ticks);
    });

    test('tipped bolts spend a plain bolt per tip; bolt tips are cut several from one gem', () => {
        const rows = fletchingRecipes('bolts', '[fletching_opal_tips]\ntable=fletching_table\ndata=item,opal\ndata=product,opal_bolttips,12\n\n[fletching_opal_bolts]\ntable=fletching_table\ndata=item,opal_bolttips\ndata=product,opal_bolt,10\n');
        expect(rows[0]!.inputs).toEqual([{ obj: 'opal', n: 1 }]);
        expect(rows[1]!.inputs).toEqual([{ obj: 'opal_bolttips', n: 10 }, { obj: 'bolt', n: 10 }]);
        expect(priceRecipe(rows[1]!, objs).addedPerAction).toBe(60 - 40);
    });

    test('smelting reads the primary and secondary ingredients', () => {
        const [r] = smeltingRecipes('[smelting_runite_bar]\nparam=product,runite_bar\nparam=levelrequired,85\nparam=ingredient,runite_ore\nparam=bar_count,1\nparam=ingredient_secondary,coal\nparam=ingredient_secondary_count,8\n');
        expect(r!.inputs).toEqual([{ obj: 'runite_ore', n: 1 }, { obj: 'coal', n: 8 }]);
    });
});

const quote = (q: Partial<MarketQuote> & { id: number }): MarketQuote => ({
    name: `item ${q.id}`, basePrice: 1, item: q.id, bid: null, ask: null, buyQuantity: 0, buyValue: 0, sellQuantity: 0, sellValue: 0, lastSellAt: null,
    volume: 0, gross: 0, tax: 0, trades: 0, lastPrice: null, lastTradeAt: null, vwap: null, referencePrice: null, change: null, changePercent: null, marketCap: null, ...q,
});

describe('GE book', () => {
    test('pages merge to one row per item, the later page winning', () => {
        const rows = mergeRows([[quote({ id: 2, bid: 5 }), quote({ id: 1 })], [quote({ id: 2, bid: 6 })]]);
        expect(rows.map(r => [r.id, r.bid])).toEqual([[1, null], [2, 6]]);
    });

    test('a full-depth bid prices at the best bid less the 5% fee; a thin one does not price', () => {
        expect(marketPrice(mergeRows([[quote({ id: 1, bid: 2500, buyQuantity: 9000, buyValue: 22_500_000 })]])[0])).toEqual({ net: 2375, how: 'bid', units: 9000, depthAtBest: true });
        expect(marketPrice(mergeRows([[quote({ id: 1, bid: 1000, buyQuantity: 1, buyValue: 1000 })]])[0]).how).toBe('none');
    });

    test('traded flow prices at the lower of the week mean and the ask, and wins when it pays more than the bid', () => {
        const r = mergeRows([[quote({ id: 1, ask: 399, vwap: 423, volume: 352_894 })]])[0];
        expect(marketPrice(r)).toEqual({ net: 379, how: 'flow', units: 352_894, depthAtBest: true });
        const steel = mergeRows([[quote({ id: 1, bid: 89, buyQuantity: 9650, buyValue: 858_850, ask: 1497, vwap: 1369, volume: 73_672 })]])[0];
        expect(marketPrice(steel)).toMatchObject({ net: 1300, how: 'flow' });
    });

    test('a bid averaging below its best prices at the best, with the week volume as its depth and the depth unverified', () => {
        const coal = mergeRows([[quote({ id: 1, bid: 80, buyQuantity: 6_850_000, buyValue: 85_000_000, vwap: 97, volume: 11_509 })]])[0];
        expect(marketPrice(coal)).toEqual({ net: 76, how: 'bid', units: 11_509, depthAtBest: false });
    });

    test('asks and bids are compared with store cost by id', () => {
        const objs = parseObjs([OBJ], PACK);
        const c = { objs, shops: [], invs: new Map() } as unknown as Content;
        const rows = mergeRows([[quote({ id: 1641, ask: 1000, sellQuantity: 3, sellValue: 3300, bid: 3000, buyQuantity: 10, buyValue: 30000 })]]);
        const [a] = askLines(c, rows);
        expect(a).toMatchObject({ cost: 2025, ask: 1000, meanAsk: 1100, boardPerCoin: 2.025, gainAtDepth: 925 * 3 });
        const [b] = bidLines(c, rows, shopLines(c, 400));
        expect(b).toMatchObject({ obj: 'ruby_ring', net: 2850, bestNonGe: 1215, shopPrice: null });
    });
});

describe('mining rates', () => {
    test('respawns shorten with players online, capped at 2,000 (player_count.rs2)', () => {
        expect(respawnAt(20, 1262)).toBe(13);
        expect(respawnAt(2400, 1400)).toBe(1560);
        expect(respawnAt(200, 5000)).toBe(100);
        expect(respawnAt(200, 0)).toBe(200);
    });

    test('one login works its best site; the world caps every login together', () => {
        const [m] = parseMineRows('[r]\ntable=mining_table\ndata=rock,a\ndata=rock_output,runite_ore\ndata=rock_successchance,1,18\ndata=rock_respawnrate,2400\n');
        const row = { ...m!, count: 5, sites: { '45_154': 2, '47_60': 2, '47_160': 1 } };
        const r = mineRates(row, { ...DEFAULT_RANK, players: 0 });
        const t = 3 / (19 / 256);
        expect(r.world!).toBeCloseTo((5 * 9000) / (2400 + t));
        expect(r.perLogin).toBeCloseTo((2 * 9000) / (2400 + t));
        expect(mineRates(row, DEFAULT_RANK).respawn).toBe(1560);
    });

    test('rocks that respawn faster than a login mines are limited by the login', () => {
        const [m] = parseMineRows('[i]\ntable=mining_table\ndata=rock,a\ndata=rock_output,iron_ore\ndata=rock_successchance,300,300\ndata=rock_respawnrate,20\n');
        const r = mineRates({ ...m!, count: 124, sites: { a: 16 } }, DEFAULT_RANK);
        expect(r.perLogin).toBeCloseTo(9000 / (3 + 40 / 27));
    });
});

describe('headcount sites', () => {
    const shilo = SITES.find(s => s.name === 'Shilo gem rocks')!;
    test('a player counts within the radius of any rock, on its plane only', () => {
        expect(atSite({ x: 2820 - 8, z: 2998, level: 0 }, shilo)).toBe(true);
        expect(atSite({ x: 2820 - 9, z: 2998, level: 0 }, shilo)).toBe(false);
        expect(atSite({ x: 2825 + 8, z: 3003 + 8, level: 0 }, shilo)).toBe(true);
        expect(atSite({ x: 2823, z: 3000, level: 1 }, shilo)).toBe(false);
    });

    test('our accounts are counted, never named', () => {
        const positions = [
            { name: 'Tygem020', x: 2938, z: 9883, level: 0 },
            { name: 'Money Placeholder', x: 2939, z: 9883, level: 0 },
            { name: 'Placeholder One', x: 2940, z: 9884, level: 0 },
            { name: 'Elsewhere', x: 3200, z: 3200, level: 0 },
        ];
        const ex = { excludes: (n: string) => /^(money |placeholder one)/i.test(n) };
        const sites = readSites(positions, ex);
        expect(sites["Heroes' Guild runite"]).toEqual({ ours: 2, rivals: [['Tygem020', 2938, 9883]] });
        expect(sites['Shilo gem rocks']).toEqual({ ours: 0, rivals: [] });
        expect(JSON.stringify(sites)).not.toMatch(/money|placeholder/i);
    });

    test('backoff doubles to a 15-minute ceiling', () => {
        expect([1, 2, 3, 4, 5].map(f => backoff(60, f))).toEqual([120, 240, 480, 900, 900]);
    });

    test('raw polls may not be written inside the repository', () => {
        expect(insideRepo('/repo/docs/markets/data', '/repo')).toBe(true);
        expect(insideRepo('/home/u/.cache/rs-markets', '/repo')).toBe(false);
    });
});

describe('headcount report', () => {
    const at = (m: number) => new Date(Date.UTC(2026, 9, 24, 4, m)).toISOString();
    const read = (m: number, rivals: string[], ours = 0): Read => ({ at: at(m), online: 1200, sites: { S: { ours, rivals: rivals.map(n => [n, 0, 0]) } } });

    test('sessions join gaps up to the limit', () => {
        expect(sessionsOf([0, 1, 2, 5, 6, 20], 2)).toEqual([[0, 6], [20, 20]]);
        expect(sessionsOf([0, 1, 2, 5, 6, 20], 1)).toEqual([[0, 2], [5, 6], [20, 20]]);
    });

    test('dwell, sessions, co-arrivals and our count per site', () => {
        const reads = [read(0, ['A']), read(1, ['A', 'B', 'C'], 1), read(2, ['A', 'B', 'C'], 2), read(3, []), read(4, []), read(5, ['A'])];
        const s = summariseSite('S', reads, 1);
        expect(s.byRival.map(r => [r.name, r.reads, r.sessions, r.longestMin])).toEqual([['A', 4, 2, 2], ['B', 2, 1, 1], ['C', 2, 1, 1]]);
        expect(s.coArrivals).toEqual([{ at: at(1), names: ['B', 'C'] }]);
        expect(s.ours).toEqual({ min: 0, mean: 0.5, max: 2 });
        expect(s.hourly).toEqual([{ hour: '2026-10-24T04Z', reads: 6, distinct: 3, meanRivals: 8 / 6, meanOurs: 0.5 }]);
    });

    test('families group names by their stem', () => {
        expect(stemOf('Tygem020')).toBe('tygem');
        expect(families(['Tygem020', 'Tygem050', 'U238', 'Croesus'])).toEqual({ tygem: ['Tygem020', 'Tygem050'] });
    });
});
