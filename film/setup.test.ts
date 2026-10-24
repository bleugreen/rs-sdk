import { describe, expect, test } from 'bun:test';
import { parseSetup } from './setup';

describe('parseSetup', () => {
    test('accepts a full spec and an empty one', () => {
        const spec = { leaveTutorial: true, clearInventory: true, stats: { firemaking: 80 }, give: { magic_logs: 27 }, tele: [3019, 3362, 0], cheats: ['~energy'], settleTicks: 2 };
        expect(parseSetup(spec)).toEqual(spec as never);
        expect(parseSetup(undefined)).toEqual({});
    });

    test('refuses unknown keys and bad values, naming them', () => {
        expect(() => parseSetup({ stat: {} })).toThrow("unknown key 'stat'");
        expect(() => parseSetup({ stats: { firemaking: 100 } })).toThrow('stats.firemaking');
        expect(() => parseSetup({ give: { 'Magic logs': 1 } })).toThrow('debug name');
        expect(() => parseSetup({ tele: [3019] })).toThrow('tele');
        expect(() => parseSetup({ cheats: ['::give coins 1'] })).toThrow('cheats');
        expect(() => parseSetup([])).toThrow('object');
    });
});
