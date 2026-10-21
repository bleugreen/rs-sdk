import { describe, expect, test } from 'bun:test';
import { canIdentify, herbOptions, herbTally, nextMix, shopNeeds, unfList, UNID_HERBS } from './herbs';

describe('shopNeeds', () => {
    const list = unfList(undefined);
    test('a vial for every herb on the list, identified or not, less the vials held', () => {
        // 10 clean guam, 4 unidentified irit, 3 clean marrentill (not on the default list), 5 vials of water, 2 empty vials
        const bank = [{ id: 249, count: 10 }, { id: 209, count: 4 }, { id: 251, count: 3 }, { id: 227, count: 5 }, { id: 229, count: 2 }];
        expect(shopNeeds(bank, list).vials).toBe(7);
    });
    test('an eye of newt for every guam and irit, as herb or unfinished potion', () => {
        const bank = [{ id: 249, count: 10 }, { id: 209, count: 4 }, { id: 91, count: 6 }, { id: 101, count: 1 }, { id: 255, count: 9 }, { id: 221, count: 5 }];
        expect(shopNeeds(bank, list).eyes).toBe(16);
    });
    test('a fixed eye of newt target overrides the match', () => {
        expect(shopNeeds([{ id: 221, count: 50 }], list, 432).eyes).toBe(382);
        expect(shopNeeds([{ id: 221, count: 500 }], list, 432).eyes).toBe(0);
    });
});

describe('nextMix', () => {
    const bank = [{ id: 249, count: 30 }, { id: 259, count: 5 }, { id: 227, count: 10 }];
    test('mixes the highest-level herb the level allows', () => {
        expect(nextMix(bank, 50, unfList(undefined))).toEqual({ herb: 259, unf: 101 }); // irit
        expect(nextMix(bank, 44, unfList(undefined))).toEqual({ herb: 249, unf: 91 }); // guam until 45
    });
    test('needs vials of water', () => {
        expect(nextMix(bank.filter(i => i.id !== 227), 99, unfList(undefined))).toBeNull();
    });
    test('the default list is the herb-table mix, without marrentill', () => {
        expect(unfList(undefined)).toEqual(['kwuarm', 'avantoe', 'irit', 'ranarr', 'harralander', 'tarromin', 'guam']);
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
