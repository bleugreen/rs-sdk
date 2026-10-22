import { describe, expect, test } from 'bun:test';
import { isEastOfTollGate } from '../lib/toll-gate';
import { JUG_STORES, jugsOptions } from './jugs';

const cheb = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

describe('jugsOptions', () => {
    test('defaults: the Varrock store, 600 jugs, batches of 26', () => {
        expect(jugsOptions({})).toEqual({ store: 'varrock', target: 600, batch: 26 });
    });

    test('a named store with a target', () => {
        expect(jugsOptions({ store: 'falador', target: 250 })).toEqual({ store: 'falador', target: 250, batch: 26 });
        expect(jugsOptions({ store: 'lumbridge', batch: 20 }).store).toBe('lumbridge');
    });

    test('an unknown or non-string store is refused, naming the stores', () => {
        expect(() => jugsOptions({ store: 'rimmington' })).toThrow(/varrock, falador, lumbridge/);
        expect(() => jugsOptions({ store: 3 })).toThrow(/options.store/);
        expect(() => jugsOptions({ store: 'toString' })).toThrow(/options.store/);
    });
});

describe('JUG_STORES', () => {
    test('Varrock keeps the tiles the role used before stores were added', () => {
        expect(JUG_STORES.varrock).toEqual({ shop: { x: 3216, z: 3414 }, water: { x: 3238, z: 3434 }, bank: { x: 3253, z: 3420 } });
    });

    test('every store is west of the toll gate, with its fountain close to the shop', () => {
        for (const [name, s] of Object.entries(JUG_STORES)) {
            for (const t of [s.shop, s.water, s.bank]) expect({ name, east: isEastOfTollGate(t) }).toEqual({ name, east: false });
            expect({ name, near: cheb(s.shop, s.water) <= 25 }).toEqual({ name, near: true });
        }
    });
});
