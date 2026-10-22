import { describe, expect, test } from 'bun:test';
import { regionOf, voyagesBetween } from './ships';

describe('regionOf', () => {
    test('mainland towns', () => {
        for (const t of [
            { x: 3222, z: 3218 }, // Lumbridge
            { x: 3029, z: 3217 }, // Port Sarim dock
            { x: 2955, z: 3215 }, // Rimmington
            { x: 2979, z: 3240 }, // Rimmington mine
            { x: 2880, z: 3410 }, // Taverley
            { x: 3092, z: 3245 } // Draynor bank
        ])
            expect(regionOf(t)).toBe('mainland');
    });
    test('Karamja', () => {
        for (const t of [
            { x: 2954, z: 3147 }, // Musa Point customs
            { x: 2956, z: 3143 }, // the Port Sarim ship lands here
            { x: 2924, z: 3180 }, // Musa Point fishing spots
            { x: 2767, z: 3122 }, // Jiminua
            { x: 2772, z: 3228 }, // Brimhaven customs
            { x: 2775, z: 3234 }, // the Ardougne ship lands here
            { x: 2700, z: 9500 } // Brimhaven dungeon, under Karamja
        ])
            expect(regionOf(t)).toBe('karamja');
    });
    test('Kandarin', () => {
        for (const t of [
            { x: 2683, z: 3268 }, // the Brimhaven ship lands here
            { x: 2641, z: 3171 }, // Port Khazard
            { x: 2613, z: 3294 }, // Aemad
            { x: 2642, z: 3441 }, // Hemenster
            { x: 2820, z: 3487 }, // the tunnel dwarf, west end
            { x: 2493, z: 3488 }, // Gnome Stronghold
            { x: 2553, z: 3574 } // Barbarian Outpost
        ])
            expect(regionOf(t)).toBe('kandarin');
    });
});

describe('voyagesBetween', () => {
    const names = (from: Parameters<typeof voyagesBetween>[0], to: Parameters<typeof voyagesBetween>[1]) => voyagesBetween(from, to).map(v => v.name);
    test('none within a region', () => expect(names('kandarin', 'kandarin')).toEqual([]));
    test('one voyage to and from Karamja', () => {
        expect(names('mainland', 'karamja')).toEqual(['Port Sarim to Karamja']);
        expect(names('karamja', 'mainland')).toEqual(['Musa Point to Port Sarim']);
        expect(names('karamja', 'kandarin')).toEqual(['Brimhaven to Ardougne']);
        expect(names('kandarin', 'karamja')).toEqual(['Ardougne to Brimhaven']);
    });
    test('mainland and Kandarin are two voyages apart, through Karamja', () => {
        expect(names('mainland', 'kandarin')).toEqual(['Port Sarim to Karamja', 'Brimhaven to Ardougne']);
        expect(names('kandarin', 'mainland')).toEqual(['Ardougne to Brimhaven', 'Musa Point to Port Sarim']);
    });
});
