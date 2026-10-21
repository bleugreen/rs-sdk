import { describe, expect, test } from 'bun:test';
import { canIdentify, herbOptions, herbTally, nextMix, unfList, UNID_HERBS } from './herbs';

describe('nextMix', () => {
    const bank = [{ id: 249, count: 30 }, { id: 259, count: 5 }, { id: 227, count: 10 }];
    test('mixes the highest-level herb the level allows', () => {
        expect(nextMix(bank, 50, unfList(undefined))).toEqual({ herb: 259, unf: 101 }); // irit
        expect(nextMix(bank, 44, unfList(undefined))).toEqual({ herb: 249, unf: 91 }); // guam until 45
    });
    test('needs vials of water', () => {
        expect(nextMix(bank.filter(i => i.id !== 227), 99, unfList(undefined))).toBeNull();
    });
    test('unfList rejects unknown herbs', () => {
        expect(() => unfList(['torstol'])).toThrow();
        expect(unfList(['guam', 'irit'])).toEqual(['irit', 'guam']);
    });
});

test('canIdentify follows each herb\'s level', () => {
    expect(canIdentify(199, 3)).toBe(true); // guam
    expect(canIdentify(209, 39)).toBe(false); // irit needs 40
    expect(canIdentify(209, 40)).toBe(true);
    expect(canIdentify(227, 99)).toBe(false); // a vial is not a herb
});

describe('herbTally', () => {
    test('counts herbs by name and ignores other ids', () => {
        const t = herbTally({ 209: 3, 199: 5, 227: 4, 995: 100 });
        expect(t.total).toBe(8);
        expect(t.byHerb).toEqual({ irit: 3, guam: 5 });
    });
    test('knows the irit and guam ids', () => {
        expect(UNID_HERBS[209]).toBe('irit');
        expect(UNID_HERBS[199]).toBe('guam');
    });
});

describe('herbOptions', () => {
    test('defaults to the Edgeville chaos druids, training to 40, looting herbs and vials', () => {
        const o = herbOptions({});
        expect(o.bones.spot.id).toBe('chaos_druids');
        expect(o.bones.train).toBe(40);
        expect(o.bones.spot.bones.test('Herb')).toBe(true);
        expect(o.bones.loot.test('Vial of water')).toBe(true);
        expect(o.bones.loot.test('Bones')).toBe(false);
    });
    test('accepts the Taverley spot and rejects non-herb spots', () => {
        expect(herbOptions({ spot: 'chaos_druids_taverley' }).bones.spot.id).toBe('chaos_druids_taverley');
        expect(() => herbOptions({ spot: 'hill_giants' })).toThrow();
    });
});
