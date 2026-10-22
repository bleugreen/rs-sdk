import { describe, expect, test } from 'bun:test';
import {
    castable, castDecision, castsAvailable, castsCarried, decideStep, DOOR_INSIDE, dragonOptions, EMPTY_KIT, footprintDistance, kitIn, leashHolds, outsideEveryLeash,
    affordableLaws, atGuild, foodOnly, foodPlan, minTripLaws, purchasePlan, SAFE_ROUTE, SAFE_TILE, spellFor, TAVERLEY_ADULTS, tripCost, tripKit, type Kit, type View
} from './dragons';

const o = dragonOptions({});
const STAFF_ONLY: Kit = { ...EMPTY_KIT, staff: 1 };
const losAll = () => true;

describe('leash geometry', () => {
    test('the safe tile is outside every adult and baby leash', () => {
        expect(outsideEveryLeash(SAFE_TILE)).toBe(true);
    });
    test('the leash is maxrange + 1 Chebyshev from the spawn, corners excluded', () => {
        const s = TAVERLEY_ADULTS[0]!;
        expect(leashHolds(s, { x: s.x + 7, z: s.z })).toBe(true);
        expect(leashHolds(s, { x: s.x + 8, z: s.z })).toBe(false);
        expect(leashHolds(s, { x: s.x + 7, z: s.z + 7 })).toBe(false);
    });
    test('SAFE_ROUTE: king moves from inside the door to the tile, never in an adult leash', () => {
        expect(SAFE_ROUTE[0]).toEqual(DOOR_INSIDE);
        expect(SAFE_ROUTE.at(-1)).toEqual(SAFE_TILE);
        for (let i = 1; i < SAFE_ROUTE.length; i++) {
            const a = SAFE_ROUTE[i - 1]!, b = SAFE_ROUTE[i]!;
            expect(Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z))).toBe(1);
        }
        for (const t of SAFE_ROUTE) expect(outsideEveryLeash(t, TAVERLEY_ADULTS)).toBe(true);
    });
    test('footprintDistance is 0 under a footprint and counts from its nearest edge', () => {
        expect(footprintDistance({ x: 2900, z: 9800 }, { x: 2899, z: 9799 }, 4)).toBe(0);
        expect(footprintDistance(SAFE_TILE, { x: 2899, z: 9802 }, 4)).toBe(5);
    });
});

describe('castDecision', () => {
    const near = { sw: { x: 2899, z: 9802 }, size: 4 };
    test('casts at a reachable dragon, refuses one out of range or sight', () => {
        expect(castDecision(SAFE_TILE, { ...near, hp: 80 }, 12, 10, losAll)).toBe('cast');
        expect(castDecision(SAFE_TILE, { sw: { x: 2880, z: 9790 }, size: 4, hp: 80 }, 12, 10, losAll)).toBe('out_of_reach');
        expect(castDecision(SAFE_TILE, { ...near, hp: 80 }, 12, 10, () => false)).toBe('out_of_reach');
    });
    test('holds a killing blow while the drop could not be telegrabbed', () => {
        // In reach of its footprint, but its SW tile (where it drops) is hidden.
        const los = (_f: unknown, sw: { x: number; z: number }, size: number) => size === 4 || sw.x !== 2899;
        expect(castDecision(SAFE_TILE, { ...near, hp: 10 }, 12, 10, los)).toBe('hold');
        expect(castDecision(SAFE_TILE, { ...near, hp: 10 }, -1, 10, los)).toBe('cast');
    });
});

describe('spells and kits', () => {
    test('spell by Magic level: wind strike, wind bolt from 17, wind blast from 41', () => {
        expect(spellFor(1).name).toBe('wind_strike');
        expect(spellFor(17).name).toBe('wind_bolt');
        expect(spellFor(40).name).toBe('wind_bolt');
        expect(spellFor(41).name).toBe('wind_blast');
        expect(spellFor(70, false).name).toBe('wind_bolt');
    });
    test('a trip kit carries no air, telegrab laws from 33, and the runes of every spell usable within 5 levels', () => {
        expect(tripKit(5, o)).toMatchObject({ mind: 500, chaos: 0, death: 0, law: 0 });
        expect(tripKit(12, o)).toMatchObject({ mind: 500, chaos: 500, death: 0, law: 0 });
        expect(tripKit(17, o)).toMatchObject({ mind: 0, chaos: 500, death: 0, law: 0 });
        expect(tripKit(36, o)).toMatchObject({ mind: 0, chaos: 500, death: 500, law: 25 });
        // Casting wind blast: its deaths are the trip, chaos a half-trip fallback.
        expect(tripKit(45, o)).toMatchObject({ mind: 0, chaos: 250, death: 500, law: 25 });
        expect(tripKit(45, { ...o, blast: false })).toMatchObject({ chaos: 500, death: 0 });
        expect('air' in tripKit(45, o)).toBe(false);
    });
    test('castable falls back from wind blast to wind bolt when the deaths run out, never to wind strike', () => {
        const k: Kit = { ...EMPTY_KIT, death: 2, chaos: 5, mind: 50, staff: 1 };
        expect(castable(45, k)!.name).toBe('wind_blast');
        expect(castable(45, { ...k, death: 0 })!.name).toBe('wind_bolt');
        expect(castable(45, { ...k, death: 0, chaos: 0 })).toBeNull();
        expect(castable(10, k)!.name).toBe('wind_strike');
        expect(castsAvailable(45, k)).toBe(7);
        expect(castsAvailable(45, { ...k, staff: 0 })).toBe(0);
    });
    test('casts carried is bounded by the spell rune and needs the staff', () => {
        const k: Kit = { ...EMPTY_KIT, death: 30, chaos: 7, staff: 1 };
        expect(castsCarried(k, spellFor(45))).toBe(30);
        expect(castsCarried(k, spellFor(30))).toBe(7);
        expect(castsCarried({ ...k, staff: 0 }, spellFor(45))).toBe(0);
    });
    test('kitIn counts worn and carried items by kind; air runes and a staff of fire are not the kit', () => {
        const k = kitIn([{ name: 'Air rune', count: 100 }, { name: 'Law rune', count: 3 }, { name: 'Staff of fire', count: 1 }, { name: 'Shark', count: 1 }, { name: 'Shark', count: 1 }, { name: 'Dusty key', count: 1 }, { name: 'Death rune', count: 40 }], 'Shark');
        expect(k).toEqual({ ...EMPTY_KIT, law: 3, death: 40, food: 2, key: 1 });
        expect(kitIn([{ name: 'Staff of air', count: 1 }], 'Shark').staff).toBe(1);
    });
});

describe('decideStep', () => {
    const kit = (over: Partial<Kit> = {}): Kit => ({ ...tripKit(45, o), ...over });
    const base: View = { tutorial: false, melee: 40, magic: 45, where: 'surface', freeSlots: 20, carried: kit(), banked: { ...EMPTY_KIT }, coins: 0, loot: 0 };
    const step = (v: Partial<View>) => decideStep({ ...base, ...v }, o);
    test('tutorial, then melee training, then a first bank look', () => {
        expect(step({ tutorial: true })).toBe('tutorial');
        expect(step({ melee: 10 })).toBe('train');
        expect(step({ banked: null })).toBe('look');
    });
    test('in the room: farm until full or out of runes or laws', () => {
        expect(step({ where: 'room' })).toBe('farm');
        expect(step({ where: 'room', freeSlots: 0 })).toBe('leave');
        expect(step({ where: 'room', carried: kit({ death: 0 }) })).toBe('farm'); // wind bolt
        expect(step({ where: 'room', carried: kit({ death: 0, chaos: 0, mind: 500 }) })).toBe('leave'); // never wind strike
        expect(step({ where: 'room', carried: kit({ law: 0 }) })).toBe('leave');
        expect(step({ where: 'room', magic: 20, carried: kit({ law: 0, death: 0 }) })).toBe('farm');
    });
    test('below keyMagic: spells on cows while the pack pays for them, before the key', () => {
        const strike = { ...EMPTY_KIT, staff: 1, mind: 100, chaos: 100 };
        expect(step({ magic: 1, carried: strike })).toBe('trainMagic');
        expect(step({ magic: 40, carried: strike })).toBe('trainMagic');
        expect(step({ magic: 41, carried: { ...strike, law: 25, food: 4 } })).toBe('key');
        expect(step({ magic: 1, carried: { ...strike, key: 1 } })).not.toBe('trainMagic');
        expect(step({ magic: 1, carried: { ...EMPTY_KIT }, coins: 0 })).toBe('fund');
    });
    test('the room needs no melee: a death-free farm never stops to retrain', () => {
        expect(step({ where: 'room', melee: 1 })).toBe('farm');
    });
    test('with a kit: the dusty key first, then in', () => {
        expect(step({ carried: kit({ key: 0 }) })).toBe('key');
        expect(step({})).toBe('enter');
        expect(step({ where: 'dungeon' })).toBe('enter');
    });
    test('without a kit: the bank if it holds one, else buy, else wait for coins', () => {
        const none = { ...EMPTY_KIT, key: 1 };
        expect(step({ carried: none, banked: kit() })).toBe('bank');
        expect(step({ carried: none, coins: 10 })).toBe('fund');
        expect(step({ carried: none, coins: tripCost(45, o, EMPTY_KIT) })).toBe('buy');
        expect(step({ carried: { ...none, staff: 1 }, coins: tripCost(45, o, STAFF_ONLY) })).toBe('buy');
        // Short of a full trip's laws, a trip with the fewest worth walking in with is bought.
        const partial = tripCost(45, o, EMPTY_KIT, minTripLaws(45, o));
        expect(partial).toBeLessThan(tripCost(45, o, EMPTY_KIT));
        expect(step({ carried: none, coins: partial })).toBe('buy');
        expect(step({ carried: none, coins: partial - 1 })).toBe('fund');
    });
    test('never walks the dungeon with less than minFood: after the Jailer it banks', () => {
        // cairn_h55, 2026-10-21 18:21: key in hand, both sharks eaten on the Jailer, 6 hp.
        const afterJailer = kit({ food: 0 });
        expect(step({ where: 'dungeon', carried: afterJailer, banked: { ...EMPTY_KIT, food: 6 } })).toBe('bank');
        expect(step({ where: 'dungeon', carried: kit({ food: o.minFood - 1 }), banked: { ...EMPTY_KIT, food: 6 } })).toBe('bank');
        expect(step({ where: 'dungeon', carried: kit({ food: o.minFood }) })).toBe('enter');
        expect(step({ carried: kit({ food: 0, key: 0 }), banked: { ...EMPTY_KIT, food: 6 } })).toBe('bank');
    });
    test('only food short: buy food alone, never a rune trip, or wait for coins for it', () => {
        const hungry = { carried: kit({ food: 0 }), banked: { ...EMPTY_KIT } };
        expect(foodOnly({ ...base, ...hungry }, o)).toBe(true);
        expect(step({ ...hungry, coins: o.tripFood * o.prices.food })).toBe('buy');
        expect(step({ ...hungry, coins: 100 })).toBe('fund');
        expect(foodOnly({ ...base, carried: kit({ food: 0, law: 0 }), banked: { ...EMPTY_KIT } }, o)).toBe(false);
        expect(foodPlan({ ...EMPTY_KIT, food: 1 }, o).lines).toEqual([{ item: o.food, quantity: o.tripFood, source: 'ge', maxPrice: o.prices.food }]);
        expect(foodPlan({ ...EMPTY_KIT, food: o.tripFood }, o).lines).toEqual([]);
    });
    test('any bones outside the room bank first, even with runes or coins for a trip', () => {
        expect(step({ where: 'dungeon', loot: 4, carried: kit({ mind: 0, chaos: 0 }), coins: 38_000 })).toBe('bank');
        expect(step({ where: 'dungeon', loot: 4 })).toBe('bank');
        expect(step({ where: 'room', loot: 4 })).toBe('farm');
    });
    test('from Magic 66 the guild tops chaos and death up last, and never sells the laws', () => {
        const held: Kit = { ...EMPTY_KIT, staff: 1, law: 21, food: 4 };
        expect(atGuild(65, o)).toBe(false);
        expect(atGuild(66, o)).toBe(true);
        const coins = tripCost(72, o, held, minTripLaws(72, o));
        const plan = purchasePlan(coins, 72, held, o);
        expect(plan.trips).toBe(1);
        expect(plan.lines.map(l => `${l.shop ?? l.source}:${l.item}`)).toEqual([
            'ge:Law rune', 'aubury:Chaos rune', 'aubury:Death rune', 'betty:Chaos rune', 'betty:Death rune', 'magicGuild:Chaos rune', 'magicGuild:Death rune', 'ge:Shark'
        ]);
        expect(purchasePlan(coins, 72, held, dragonOptions({ guild: 100 })).lines.some(l => l.shop === 'magicGuild')).toBe(false);
    });
    test('a full pack of bones goes to the bank before shopping', () => {
        expect(step({ carried: { ...EMPTY_KIT }, loot: 24, freeSlots: 0, coins: 10 })).toBe('bank');
    });
});

describe('purchasePlan', () => {
    test('nothing when the coins do not cover one trip', () => {
        expect(purchasePlan(1000, 45, { ...EMPTY_KIT }, o)).toEqual({ trips: 0, lines: [] });
    });
    test('staff first, then Aubury before the exchange, targets are holdings', () => {
        const held = { ...EMPTY_KIT, death: 100 };
        // Coins for two trips still buy one: the shops other players use are drained trip by trip.
        const coins = tripCost(45, o, EMPTY_KIT) + tripCost(45, o, STAFF_ONLY);
        const plan = purchasePlan(coins, 45, held, o);
        expect(plan.trips).toBe(1);
        expect(plan.lines.map(l => `${l.source}:${l.shop ?? ''}:${l.item}`)).toEqual(['ge::Law rune', 'shop:zaff:Staff of air', 'shop:aubury:Chaos rune', 'shop:aubury:Death rune', 'shop:betty:Chaos rune', 'shop:betty:Death rune', 'ge::Shark']);
        expect(plan.lines.find(l => l.item === 'Law rune')!.quantity).toBe(25);
        expect(plan.lines.find(l => l.item === 'Death rune')!.quantity).toBe(500);
    });
    test('caps at buyTrips and keeps larger holdings', () => {
        const plan = purchasePlan(100_000_000, 45, { ...EMPTY_KIT, staff: 1, law: 500 }, o);
        expect(plan.trips).toBe(o.buyTrips);
        expect(plan.lines.some(l => /staff/i.test(String(l.item)))).toBe(false);
        expect(plan.lines.find(l => l.item === 'Law rune')!.quantity).toBe(500);
    });
    test('coins short of a full trip buy one trip with the laws they cover', () => {
        const coins = tripCost(45, o, EMPTY_KIT, 12) + 100;
        expect(affordableLaws(coins, 45, o, EMPTY_KIT)).toBe(12);
        const plan = purchasePlan(coins, 45, { ...EMPTY_KIT }, o);
        expect(plan.trips).toBe(1);
        expect(plan.lines.find(l => l.item === 'Law rune')!.quantity).toBe(12);
        expect(plan.lines.find(l => l.item === 'Chaos rune')!.quantity).toBe(tripKit(45, o).chaos);
        expect(purchasePlan(tripCost(45, o, EMPTY_KIT, 4), 45, { ...EMPTY_KIT }, o).trips).toBe(0);
    });
    test('what is held is not paid for again (cairn_h55 after its death: staff, 2 laws, 6 sharks)', () => {
        expect(tripCost(45, o, tripKit(45, o))).toBe(0);
        const held = { ...EMPTY_KIT, staff: 1, law: 2, food: 6 };
        const p = o.prices;
        expect(tripCost(41, o, STAFF_ONLY) - tripCost(41, o, held)).toBe(2 * p.law + o.tripFood * p.food);
        // decideStep and purchasePlan agree at the edge, so a 'buy' always has lines.
        const edge = tripCost(41, o, held, minTripLaws(41, o));
        const v: View = { tutorial: false, melee: 20, magic: 41, where: 'surface', freeSlots: 20, carried: { ...EMPTY_KIT, key: 1 }, banked: held, coins: 0, loot: 0 };
        expect(decideStep({ ...v, coins: edge }, o)).toBe('buy');
        expect(purchasePlan(edge, 41, held, o).trips).toBe(1);
        expect(decideStep({ ...v, coins: edge - 1 }, o)).toBe('fund');
        expect(purchasePlan(edge - 1, 41, held, o).trips).toBe(0);
        expect(affordableLaws(edge, 41, o, held)).toBe(minTripLaws(41, o));
    });
    test('a trip is priced at the expected shop prices, not the caps (cairn_h56 with 23 laws held)', () => {
        const held: Kit = { ...EMPTY_KIT, law: 23, mind: 126, food: 4 };
        const s = o.shopPrices;
        const cost = tripCost(87, o, held, minTripLaws(87, o));
        expect(cost).toBe(250 * s.chaos + 500 * s.death + s.staff);
        expect(cost).toBeLessThan(250 * o.prices.chaos + 500 * o.prices.death + o.prices.staff);
        const v: View = { tutorial: false, melee: 20, magic: 87, where: 'surface', freeSlots: 20, carried: { ...held, key: 1 }, banked: { ...EMPTY_KIT }, coins: cost, loot: 0 };
        expect(decideStep(v, o)).toBe('buy');
        expect(decideStep({ ...v, coins: cost - 1 }, o)).toBe('fund');
    });
    test('150,000 gp funds a Magic 45 trip', () => {
        expect(purchasePlan(150_000, 45, { ...EMPTY_KIT }, o).trips).toBe(1);
    });
    test('training levels buy mind runes, no laws', () => {
        const plan = purchasePlan(100_000, 5, { ...EMPTY_KIT, staff: 1 }, o);
        expect(plan.lines.map(l => l.item)).toEqual(['Mind rune', 'Shark']);
    });
});
