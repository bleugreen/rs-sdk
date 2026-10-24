import { describe, expect, test } from 'bun:test';
import { faresOf, KARAMJA_LEG, routeBetween } from './sea-route.ts';

const ARDOUGNE_BANK = { x: 2654, z: 3285 };
const ZOO_IRON = { x: 2603, z: 3235 };
const VARROCK_WEST_BANK = { x: 3185, z: 3436 };
const LUMBRIDGE = { x: 3222, z: 3218 };
/** Outside the Shilo Village gate (rs/685's shilo-entry probe). */
const SHILO_GATE = { x: 2878, z: 2953 };

const names = (from: { x: number; z: number }, to: { x: number; z: number }) => routeBetween(from, to).map(l => l.name);

describe('routeBetween', () => {
    test('the Ardougne side to the Exchange: the Brimhaven ship, the Karamja leg, the walk', () => {
        expect(names(ARDOUGNE_BANK, VARROCK_WEST_BANK)).toEqual(['ardougne-brimhaven', 'musa-sarim', 'walk']);
        expect(routeBetween(ZOO_IRON, VARROCK_WEST_BANK)[1]).toBe(KARAMJA_LEG.out);
    });
    test('and back: the Port Sarim ship, the Ardougne ship, the walk to where it started', () => {
        const back = routeBetween(VARROCK_WEST_BANK, ZOO_IRON, 2);
        expect(back.map(l => l.name)).toEqual(['sarim-musa', 'brimhaven-ardougne', 'walk']);
        expect(back[0]).toBe(KARAMJA_LEG.in);
        expect(back.at(-1)).toEqual({ kind: 'walk', name: 'walk', to: ZOO_IRON, tolerance: 2 });
    });
    test('a Shilo mule takes the Karamja leg alone', () => {
        expect(routeBetween(SHILO_GATE, VARROCK_WEST_BANK)).toEqual([KARAMJA_LEG.out, { kind: 'walk', name: 'walk', to: VARROCK_WEST_BANK, tolerance: 3 }]);
        expect(names(VARROCK_WEST_BANK, SHILO_GATE)).toEqual(['sarim-musa', 'walk']);
    });
    test('one land mass: only the walk', () => {
        expect(names(LUMBRIDGE, VARROCK_WEST_BANK)).toEqual(['walk']);
        expect(names(ARDOUGNE_BANK, ZOO_IRON)).toEqual(['walk']);
    });
});

describe('faresOf', () => {
    test('30 coins a voyage: a round trip from the Ardougne side is 120', () => {
        expect(faresOf(routeBetween(ARDOUGNE_BANK, VARROCK_WEST_BANK)) + faresOf(routeBetween(VARROCK_WEST_BANK, ARDOUGNE_BANK))).toBe(120);
        expect(faresOf(routeBetween(SHILO_GATE, VARROCK_WEST_BANK))).toBe(30);
        expect(faresOf(routeBetween(LUMBRIDGE, VARROCK_WEST_BANK))).toBe(0);
    });
});
