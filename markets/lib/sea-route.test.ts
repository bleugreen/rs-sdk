import { describe, expect, test } from 'bun:test';
import { BANKS } from '../../speedrun/helpers/buyer';
import { ARDOUGNE_LANDING, faresOf, KARAMJA_LEG, needsTravel, planTrip, routeBetween, type Reaches, type Tile } from './sea-route.ts';

const ARDOUGNE_BANK = { x: 2654, z: 3285 };
const ZOO_IRON = { x: 2603, z: 3235 };
const VARROCK_WEST_BANK = { x: 3185, z: 3436 };
const LUMBRIDGE = { x: 3222, z: 3218 };
/** coins-driver.ts STANDS: the Lumbridge men and the Varrock guards. */
const MEN = { x: 3231, z: 3218 };
const GUARDS = { x: 3210, z: 3462 };
/** Outside the Shilo Village gate (rs/685's shilo-entry probe). */
const SHILO_GATE = { x: 2878, z: 2953 };
/** Inside the Gnome Stronghold's wall, south of the Grand Tree's door, where run3 a02 stood. */
const STRONGHOLD = { x: 2465, z: 3489 };
const MUSA_POINT = { x: 2920, z: 3160 };

/**
 * The long-path map, as passages.ts sees it, cut down to the Stronghold: everything inside its wall (from the gate's
 * inner side at z 3385 north) is closed to a walk from outside, and the other way. Anything else is reachable.
 */
const insideStronghold = (t: Tile) => t.x >= 2400 && t.x <= 2520 && t.z >= 3384 && t.z <= 3530;
const reaches: Reaches = (a, b) => insideStronghold(a) === insideStronghold(b);

const names = (from: Tile, to: Tile, r: Reaches = reaches) => routeBetween(from, to, 3, r).map(l => l.name);

describe('routeBetween', () => {
    test('the Ardougne side to the Exchange: the Brimhaven ship, the Karamja leg, the walk', () => {
        expect(names(ARDOUGNE_BANK, VARROCK_WEST_BANK)).toEqual(['ardougne-brimhaven', 'musa-sarim', 'walk']);
        expect(routeBetween(ZOO_IRON, VARROCK_WEST_BANK, 3, reaches)[1]).toBe(KARAMJA_LEG.out);
    });
    test('and back: the Port Sarim ship, the Ardougne ship, the walk to where it started', () => {
        const back = routeBetween(VARROCK_WEST_BANK, ZOO_IRON, 2, reaches);
        expect(back.map(l => l.name)).toEqual(['sarim-musa', 'brimhaven-ardougne', 'walk']);
        expect(back[0]).toBe(KARAMJA_LEG.in);
        expect(back.at(-1)).toEqual({ kind: 'walk', name: 'walk', to: ZOO_IRON, tolerance: 2 });
    });
    test('a Shilo mule takes the Karamja leg alone', () => {
        expect(routeBetween(SHILO_GATE, VARROCK_WEST_BANK, 3, reaches)).toEqual([KARAMJA_LEG.out, { kind: 'walk', name: 'walk', to: VARROCK_WEST_BANK, tolerance: 3 }]);
        expect(names(VARROCK_WEST_BANK, SHILO_GATE)).toEqual(['sarim-musa', 'walk']);
    });
    test('one land mass: only the walk', () => {
        expect(names(LUMBRIDGE, VARROCK_WEST_BANK)).toEqual(['walk']);
        expect(names(ARDOUGNE_BANK, ZOO_IRON)).toEqual(['walk']);
    });
    test('inside the Gnome Stronghold to the Lumbridge men: out through the gate, then the two ships', () => {
        const legs = routeBetween(STRONGHOLD, MEN, 3, reaches);
        expect(legs.map(l => l.name)).toEqual(['Gnome Stronghold gate', 'ardougne-brimhaven', 'musa-sarim', 'walk']);
        expect(legs[0]).toMatchObject({ kind: 'cross', crossing: { from: { x: 2461, z: 3385 }, to: { x: 2461, z: 3382 } } });
        expect(faresOf(legs)).toBe(60);
    });
    test('into the Stronghold from the mainland: the ships, then in through the gate', () => {
        expect(names(MEN, STRONGHOLD)).toEqual(['sarim-musa', 'brimhaven-ardougne', 'Gnome Stronghold gate', 'walk']);
        expect(names(ARDOUGNE_BANK, STRONGHOLD)).toEqual(['Gnome Stronghold gate', 'walk']);
    });
    test('Karamja to the Varrock guards: the Karamja leg and the walk', () => {
        const legs = routeBetween(MUSA_POINT, GUARDS, 3, reaches);
        expect(legs.map(l => l.name)).toEqual(['musa-sarim', 'walk']);
        expect(faresOf(legs)).toBe(30);
    });
    test('on the real long-path map, from beside the Grand Tree to the Lumbridge men', () => {
        expect(names(STRONGHOLD, MEN, undefined)).toEqual(['Gnome Stronghold gate', 'ardougne-brimhaven', 'musa-sarim', 'walk']);
    });
});

describe('needsTravel', () => {
    test('another land mass, or a passage between', () => {
        expect(needsTravel(STRONGHOLD, MEN, reaches)).toBe(true);
        expect(needsTravel(MUSA_POINT, GUARDS, reaches)).toBe(true);
        expect(needsTravel(STRONGHOLD, ARDOUGNE_LANDING, reaches)).toBe(true);
    });
    test('not on one land mass with nothing between', () => {
        expect(needsTravel(MEN, GUARDS, reaches)).toBe(false);
        expect(needsTravel(ARDOUGNE_BANK, ARDOUGNE_LANDING, reaches)).toBe(false);
        expect(needsTravel(STRONGHOLD, { x: 2470, z: 3420 }, reaches)).toBe(false);
    });
    test('not where no passage helps either: the stall watchdog is the backstop there', () => {
        const nowhere: Reaches = () => false;
        expect(needsTravel(MEN, GUARDS, nowhere)).toBe(false);
    });
});

describe('faresOf', () => {
    test('30 coins a voyage: a round trip from the Ardougne side is 120', () => {
        expect(faresOf(routeBetween(ARDOUGNE_BANK, VARROCK_WEST_BANK, 3, reaches)) + faresOf(routeBetween(VARROCK_WEST_BANK, ARDOUGNE_BANK, 3, reaches))).toBe(120);
        expect(faresOf(routeBetween(SHILO_GATE, VARROCK_WEST_BANK, 3, reaches))).toBe(30);
        expect(faresOf(routeBetween(LUMBRIDGE, VARROCK_WEST_BANK, 3, reaches))).toBe(0);
    });
});

describe('planTrip', () => {
    test('a pack that pays: the route as it is', () => {
        const p = planTrip(STRONGHOLD, MEN, { carried: 60, banked: null }, 3, reaches);
        expect(p).toMatchObject({ ok: true, fares: 60 });
        expect(p.ok && p.legs.map(l => l.name)).toEqual(['Gnome Stronghold gate', 'ardougne-brimhaven', 'musa-sarim', 'walk']);
    });
    test('a02: 0 coins carried in the Stronghold, the bank unseen: out of the gate to the Ardougne south bank for the fares first', () => {
        const p = planTrip(STRONGHOLD, MEN, { carried: 0, banked: null }, 3, reaches);
        expect(p.ok && p.legs.map(l => l.name)).toEqual(['Gnome Stronghold gate', 'fares', 'ardougne-brimhaven', 'musa-sarim', 'walk']);
        expect(p.ok && p.legs[1]).toEqual({ kind: 'fares', name: 'fares', bank: BANKS.ardougneSouth, need: 60 });
    });
    test('a bank seen holding enough with the pack: the fares stop too', () => {
        const p = planTrip(ARDOUGNE_BANK, MEN, { carried: 10, banked: 50 }, 3, reaches);
        expect(p.ok && p.legs.map(l => l.name)).toEqual(['fares', 'ardougne-brimhaven', 'musa-sarim', 'walk']);
    });
    test('refused unmoved when the bank was seen holding too little', () => {
        const p = planTrip(STRONGHOLD, MEN, { carried: 10, banked: 20 }, 3, reaches);
        expect(p).toEqual({ ok: false, fares: 60, reason: 'the route needs 60 coins for its voyages and the pack holds 10; the bank held 20 when last seen' });
    });
    test('refused on Karamja with an empty pack: no fare bank there', () => {
        const p = planTrip(MUSA_POINT, GUARDS, { carried: 0, banked: 5_000 }, 3, reaches);
        expect(p).toEqual({ ok: false, fares: 30, reason: 'the route needs 30 coins for its voyages and the pack holds 0; karamja has no fare bank' });
    });
    test('a trip with no voyage needs no coins', () => {
        expect(planTrip(STRONGHOLD, ARDOUGNE_LANDING, { carried: 0, banked: 0 }, 3, reaches)).toMatchObject({ ok: true, fares: 0 });
    });
});
