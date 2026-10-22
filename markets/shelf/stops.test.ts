import { describe, expect, test } from 'bun:test';
import {
    DEFAULT_ROUTE,
    fareBetween,
    inRangingGuild,
    judgeStop,
    livePrices,
    parseArgs,
    parseOptions,
    parseStops,
    parseValueMessage,
    RANGING_GUILD_DOOR,
    shelfRecords,
    shopValue,
    STOPS,
    type StopKey,
    stopOf,
    zoneOf,
    type Zone
} from './stops';

describe('stop table', () => {
    test("ships markets' ten stops and the scan's four in the default route, and the three config-only ones", () => {
        expect([...DEFAULT_ROUTE].sort()).toEqual(['aubury', 'betty', 'dargaud', 'davon', 'drogo', 'gemtrader', 'general-falador', 'general-lumbridge', 'general-varrock', 'grum', 'herquin', 'hickton', 'jiminua', 'zaff']);
        for (const k of DEFAULT_ROUTE) expect(stopOf(k).configOnly).toBeUndefined();
        const configOnly = Object.values(STOPS)
            .filter(s => 'configOnly' in s)
            .map(s => s.key)
            .sort();
        expect(configOnly).toEqual(['irksol', 'lundail', 'magicguild']);
    });

    test('every stop has a matching key, a shopkeeper pattern and a walk target', () => {
        for (const [key, s] of Object.entries(STOPS)) {
            expect(s.key).toBe(key);
            expect(s.npc).toBeInstanceOf(RegExp);
            expect(Number.isInteger(s.stand.x) && Number.isInteger(s.stand.z)).toBe(true);
        }
        expect(STOPS.dargaud.npc.test('Bow and Arrow salesman')).toBe(true);
        expect(STOPS.drogo.npc.test('Drogo dwarf')).toBe(true);
        expect(STOPS.gemtrader.npc.test('Gem trader')).toBe(true);
    });

    test('zones: Al Kharid behind the toll gate, Karamja and Kandarin by ship, the Dwarven Mine on the mainland', () => {
        const zones = Object.fromEntries(DEFAULT_ROUTE.map(k => [k, zoneOf(stopOf(k).stand)]));
        expect(zones).toEqual({
            'general-lumbridge': 'mainland',
            gemtrader: 'alkharid',
            aubury: 'mainland',
            'general-varrock': 'mainland',
            zaff: 'mainland',
            drogo: 'mainland',
            'general-falador': 'mainland',
            herquin: 'mainland',
            grum: 'mainland',
            betty: 'mainland',
            jiminua: 'karamja',
            davon: 'karamja',
            dargaud: 'kandarin',
            hickton: 'kandarin'
        });
        expect(zoneOf({ x: 3222, z: 3218 })).toBe('mainland'); // Lumbridge spawn
    });

    test('Dargaud stands inside the Ranging Guild, the door tiles on either side', () => {
        expect(inRangingGuild(STOPS.dargaud.stand)).toBe(true);
        expect(inRangingGuild(RANGING_GUILD_DOOR.inside)).toBe(true);
        expect(inRangingGuild(RANGING_GUILD_DOOR.outside)).toBe(false);
    });
});

describe('fares and skips', () => {
    test('fareBetween counts the toll each way and 30 per voyage', () => {
        expect(fareBetween('mainland', 'mainland')).toBe(0);
        expect(fareBetween('mainland', 'alkharid')).toBe(10);
        expect(fareBetween('alkharid', 'mainland')).toBe(10);
        expect(fareBetween('mainland', 'karamja')).toBe(30);
        expect(fareBetween('alkharid', 'karamja')).toBe(40);
        expect(fareBetween('mainland', 'kandarin')).toBe(60);
        expect(fareBetween('karamja', 'kandarin')).toBe(30);
        expect(fareBetween('kandarin', 'mainland')).toBe(60);
    });

    test('the default route from Lumbridge costs 80 coins: the toll twice and two voyages', () => {
        let zone: Zone = 'mainland';
        let spent = 0;
        for (const k of DEFAULT_ROUTE) {
            const to = zoneOf(stopOf(k).stand);
            spent += fareBetween(zone, to);
            zone = to;
        }
        expect(spent).toBe(80);
    });

    test('Ranged below 40 skips Dargaud with a reason; 40 goes', () => {
        const at = { zone: 'kandarin' as Zone, coins: 0 };
        const low = judgeStop(STOPS.dargaud, { ...at, ranged: 39 });
        expect(low.go).toBe(false);
        if (!low.go) expect(low.reason).toMatch(/Ranged 39 is below 40/);
        expect(judgeStop(STOPS.dargaud, { ...at, ranged: 40 })).toEqual({ go: true, fare: 0 });
    });

    test('a missing fare skips the stop with a reason', () => {
        const fresh = { zone: 'mainland' as Zone, ranged: 1 };
        const noBoat = judgeStop(STOPS.jiminua, { ...fresh, coins: 25 });
        expect(noBoat.go).toBe(false);
        if (!noBoat.go) expect(noBoat.reason).toMatch(/needs 30 coins .* carries 25/);
        expect(judgeStop(STOPS.jiminua, { ...fresh, coins: 30 })).toEqual({ go: true, fare: 30 });
        expect(judgeStop(STOPS.hickton, { ...fresh, coins: 59 }).go).toBe(false);
        expect(judgeStop(STOPS.hickton, { ...fresh, coins: 60 })).toEqual({ go: true, fare: 60 });
    });

    test('Al Kharid is entered only with the toll out again', () => {
        const fresh = { zone: 'mainland' as Zone, ranged: 1 };
        expect(judgeStop(STOPS.gemtrader, { ...fresh, coins: 10 }).go).toBe(false);
        expect(judgeStop(STOPS.gemtrader, { ...fresh, coins: 20 })).toEqual({ go: true, fare: 20 });
        // Already inside: only the way out.
        expect(judgeStop(STOPS.gemtrader, { zone: 'alkharid', ranged: 1, coins: 0 }).go).toBe(false);
        expect(judgeStop(STOPS.gemtrader, { zone: 'alkharid', ranged: 1, coins: 10 })).toEqual({ go: true, fare: 10 });
    });

    test('mainland stops cost nothing and config-only stops are never visited', () => {
        expect(judgeStop(STOPS.aubury, { zone: 'mainland', ranged: 1, coins: 0 })).toEqual({ go: true, fare: 0 });
        const lundail = judgeStop(STOPS.lundail, { zone: 'mainland', ranged: 99, coins: 1e6 });
        expect(lundail.go).toBe(false);
        if (!lundail.go) expect(lundail.reason).toMatch(/^config only/);
    });
});

describe('live prices', () => {
    // Measured in the lab at Aubury (runeshop: deathrune configured 1,000, cost 30, sell multiplier 1000, haggle 10):
    // Value said 30 at 1,000 and 999 on the shelf, 33 at 989, 36 at 979, while the SDK said 30 throughout.
    const aubury = { buyMultiplier: 550, sellMultiplier: 1000, haggle: 10 };
    test('match the server Value as the shelf drains below its configured stock', () => {
        expect([1000, 999, 989, 979].map(n => livePrices(30, aubury, n, 1000).buy)).toEqual([30, 30, 33, 36]);
    });

    test('stock outside the base config is priced from its whole count, so a general store pays less the more it holds', () => {
        const general = { buyMultiplier: 400, sellMultiplier: 1300, haggle: 30 };
        expect(livePrices(100, general, 1, null)).toEqual({ buy: 127, sell: 37 });
        expect(livePrices(100, general, 10, null)).toEqual({ buy: 100, sell: 10 });
        // The haggle offset caps at 1000: the buy price bottoms out at (1300-1000)/1000 of cost, the offer at 100/1000.
        expect(livePrices(100, general, 50, null)).toEqual({ buy: 30, sell: 10 });
        expect(livePrices(1, general, 50, null).buy).toBe(1); // a purchase never costs 0
        expect(shopValue(100, 30, 400, 1)).toBe(37);
    });
});

describe('records', () => {
    const shop = {
        title: "Aubury's Rune Shop.",
        shopConfig: { buyMultiplier: 600, sellMultiplier: 1000, haggle: 10 },
        shopItems: [
            { slot: 0, id: 554, name: 'Fire rune', count: 4900, baseCost: 4, buyPrice: 4, sellPrice: 2 },
            { slot: 1, id: 562, name: 'Chaos rune', count: 250, baseCost: 90, buyPrice: 90, sellPrice: 54 }
        ]
    };
    const names = new Map([
        [554, 'firerune'],
        [562, 'chaosrune']
    ]);
    const content = { inv: 'runeshop', objName: (id: number) => names.get(id), stockBase: (obj: string) => (obj === 'firerune' ? 5000 : undefined) };
    const read = { stop: 'aubury', read: 1, utc: '2026-10-22T23:00:00.000Z', tick: 1234, at: { x: 3253, z: 3402, level: 0 }, legMs: 61_000, legTicks: 152, shop, values: new Map([[0, 5]]), inv: 'runeshop', content };

    test('one shop line with the config, then one line per shelf slot with the issue-required fields', () => {
        const [head, ...items] = shelfRecords(read);
        expect(head).toEqual({ kind: 'shop', utc: read.utc, stop: 'aubury', read: 1, shopTitle: shop.title, inv: 'runeshop', tick: 1234, shopConfig: shop.shopConfig, items: 2, at: read.at, legMs: 61_000, legTicks: 152 });
        expect(items).toHaveLength(2);
        const required = ['utc', 'stop', 'shopTitle', 'slot', 'itemId', 'name', 'count', 'baseCost', 'buyPrice', 'sellPrice', 'inv', 'obj'];
        for (const r of items) for (const k of required) expect(r).toHaveProperty(k);
        expect(items[0]).toEqual({
            kind: 'item',
            utc: read.utc,
            stop: 'aubury',
            read: 1,
            shopTitle: shop.title,
            inv: 'runeshop',
            tick: 1234,
            slot: 0,
            itemId: 554,
            name: 'Fire rune',
            obj: 'firerune',
            count: 4900,
            stockBase: 5000,
            inBaseConfig: true,
            baseCost: 4,
            buyPrice: 4,
            sellPrice: 2,
            valuePrice: 5,
            // 100 under the configured 5,000: twice the base price (the SDK's buyPrice still says 4).
            computedBuyPrice: 8,
            computedSellPrice: 6
        });
        // Not in the base config: priced from its whole count, and flagged.
        expect(items[1]).toMatchObject({ obj: 'chaosrune', stockBase: null, inBaseConfig: false, valuePrice: null, computedBuyPrice: 9, computedSellPrice: 9 });
        for (const r of [head, ...items]) expect(JSON.parse(JSON.stringify(r))).toEqual(r);
    });

    test('without content the names and computed prices are null and inv is the table name', () => {
        const [head, ...items] = shelfRecords({ ...read, content: null, inv: 'runeshop' });
        expect(head.inv).toBe('runeshop');
        expect(items[0]).toMatchObject({ inv: 'runeshop', obj: null, stockBase: null, inBaseConfig: null, computedBuyPrice: null, valuePrice: 5 });
    });

    test('parseValueMessage reads the server Value reply only', () => {
        expect(parseValueMessage('Fire rune: currently costs 5gp.')).toEqual({ name: 'Fire rune', price: 5 });
        expect(parseValueMessage('Amulet of accuracy: currently costs 168gp.')).toEqual({ name: 'Amulet of accuracy', price: 168 });
        expect(parseValueMessage('Fire rune: shop will buy for 2gp.')).toBeNull();
        expect(parseValueMessage("You don't have enough coins.")).toBeNull();
    });
});

describe('options', () => {
    test('defaults: the whole route, read once', () => {
        expect(parseOptions({})).toEqual({ stops: DEFAULT_ROUTE, out: null, repeat: 1, every: 100 });
    });

    test('command-line flags, both spellings, with the account left alone', () => {
        const flags = parseArgs(['cairn_m1', '--stops', 'aubury,Betty', '--out=/tmp/x.jsonl', '--repeat', '3', '--every=200']);
        expect(flags).toEqual({ stops: 'aubury,Betty', out: '/tmp/x.jsonl', repeat: 3, every: 200 });
        expect(parseOptions(flags)).toEqual({ stops: ['aubury', 'betty'] as StopKey[], out: '/tmp/x.jsonl', repeat: 3, every: 200 });
        expect(() => parseArgs(['--buy', 'yes'])).toThrow(/unknown option/);
        expect(() => parseArgs(['--stops'])).toThrow(/needs a value/);
    });

    test('a typo or a bad number fails before logging in', () => {
        expect(() => parseStops('aubury,aubrey')).toThrow(/unknown stop aubrey/);
        expect(() => parseStops(' , ')).toThrow(/empty/);
        expect(() => parseOptions({ repeat: 0 })).toThrow(/repeat/);
        expect(() => parseOptions({ every: 'soon' })).toThrow(/every/);
        expect(parseOptions({ stops: ['hickton', 'dargaud'] }).stops).toEqual(['hickton', 'dargaud']);
    });
});
