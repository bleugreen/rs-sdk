import { describe, expect, test } from 'bun:test';
import type { BotWorldState } from '../../sdk/types';
import { eatDecision, parseKnights, pickKnight } from './probe-knights';
import { parseArgs } from './probe-sampler';

const parse = (...argv: string[]) => parseKnights(parseArgs(argv));

describe('options', () => {
    test('defaults', () => {
        expect(parse('acc', '--minutes', '30')).toEqual({ account: 'acc', minutes: 30, out: null, withdraw: 1000, food: 20, bankAt: 25_000, keepCoins: 500, foodSource: ['shop'] });
        expect(parse('acc', '--minutes', '5', '--food-source', 'shop,stall').foodSource).toEqual(['shop', 'stall']);
    });
    test('overrides and validation', () => {
        expect(parse('acc', '--minutes', '5', '--food-source', 'shop', '--food', '10', '--out', 'k.jsonl')).toMatchObject({ foodSource: ['shop'], food: 10, out: 'k.jsonl' });
        expect(() => parse('acc', '--minutes', '5', '--food-source', 'sharks')).toThrow(/food-source/);
        expect(() => parse('acc', '--minutes', '5', '--withdraw', '50')).toThrow(/at least 70/);
        expect(() => parse('acc', '--minutes', '5', '--food', '28')).toThrow(/at most 27/);
        expect(() => parse('acc', '--minutes', '5', '--bank-at', '400')).toThrow(/above --keep-coins/);
        expect(() => parse('acc', '--minutes', '5', '--sell', '1')).toThrow(/--sell/);
    });
});

describe('eating', () => {
    const base = { hp: 10, maxHp: 10, success: false, tick: 100, stunEnd: 0, lastEat: 0, haveFood: true };
    test('free in a success window once a bite fits', () => {
        expect(eatDecision({ ...base, hp: 6, success: true })).toBe('free');
        expect(eatDecision({ ...base, hp: 7, success: true })).toBeNull();
        // a stun just ended: not a window yet
        expect(eatDecision({ ...base, hp: 6, success: true, stunEnd: 98 })).toBeNull();
    });
    test('forced when one more failure (3) could leave 0 or less', () => {
        expect(eatDecision({ ...base, hp: 4 })).toBe('forced');
        expect(eatDecision({ ...base, hp: 4, lastEat: 99 })).toBeNull();
        expect(eatDecision({ ...base, hp: 4, haveFood: false })).toBeNull();
    });
});

describe('target', () => {
    const npc = (index: number, x: number, z: number, distance: number, name = 'Knight of Ardougne') =>
        ({ index, name, x, z, distance, optionsWithIndex: [{ text: 'Pickpocket', opIndex: 3 }] });
    const s = (npcs: unknown[]) => ({ tick: 500, nearbyNpcs: npcs }) as unknown as BotWorldState;
    test('keeps the current knight, else the nearest in range, never one far from the anchor', () => {
        const world = s([npc(1, 2670, 3306, 4), npc(2, 2671, 3304, 1), npc(3, 2690, 3305, 0), npc(4, 2670, 3305, 0, 'Paladin')]);
        expect(pickKnight(world, 1, new Map())?.index).toBe(1);
        expect(pickKnight(world, null, new Map())?.index).toBe(2);
        expect(pickKnight(world, null, new Map([[2, 600]]))?.index).toBe(1);
        expect(pickKnight(s([npc(3, 2690, 3305, 0)]), null, new Map())).toBeUndefined();
    });
});
