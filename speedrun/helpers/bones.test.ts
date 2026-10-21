import { describe, expect, test } from 'bun:test';
import { gearRank, isClutter, keepOnBank, parseOptions } from './bones';

describe('keepOnBank', () => {
    const done = { fishing: 50, cooking: 50 };
    test('keeps food, the fly fishing kit and the brass key', () => {
        for (const n of ['Trout', 'Salmon', 'Shrimps', 'Raw trout', 'Fly fishing rod', 'Feather', 'Brass key']) expect(keepOnBank(n, done)).toBe(true);
    });
    test('banks bones, coins and loot', () => {
        for (const n of ['Big bones', 'Coins', 'Nature rune', 'Limpwurt root', 'Iron kiteshield']) expect(keepOnBank(n, done)).toBe(false);
    });
    test('keeps the net and raw net fish only while cooking practice needs them', () => {
        expect(keepOnBank('Small fishing net', { fishing: 10, cooking: 1 })).toBe(true);
        expect(keepOnBank('Raw shrimps', { fishing: 25, cooking: 10 })).toBe(true);
        expect(keepOnBank('Small fishing net', done)).toBe(false);
        expect(keepOnBank('Raw shrimps', done)).toBe(false);
    });
    test('keeps the spot requirement', () => {
        expect(keepOnBank('Dusty key', done, /^dusty key$/i)).toBe(true);
        expect(keepOnBank('Dusty key', done)).toBe(false);
    });
});

test('isClutter: raw net fish once Cooking is 15, and burnt food', () => {
    expect(isClutter('Raw shrimps', 14)).toBe(false);
    expect(isClutter('Raw shrimps', 15)).toBe(true);
    expect(isClutter('Raw anchovies', 40)).toBe(true);
    expect(isClutter('Burnt fish', 1)).toBe(true);
    expect(isClutter('Raw trout', 40)).toBe(false);
    expect(isClutter('Shrimps', 40)).toBe(false);
});

test('gearRank orders metals and prefers kiteshields and full helms', () => {
    const tier = (n: string) => gearRank(n)?.tier ?? -1;
    expect(tier('Iron kiteshield')).toBeGreaterThan(tier('Iron sq shield'));
    expect(tier('Steel sq shield')).toBeGreaterThan(tier('Iron kiteshield'));
    expect(tier('Iron sq shield')).toBeGreaterThan(tier('Wooden shield'));
    expect(gearRank('Mithril scimitar')).toMatchObject({ slot: 'weapon', metal: 'mithril', skill: 'Attack' });
    expect(gearRank('Dragon scimitar')).toBeNull();
    expect(gearRank('Big bones')).toBeNull();
});

test('parseOptions defaults and rejects unknown spots', () => {
    const o = parseOptions({});
    expect(o.spot.id).toBe('hill_giants');
    expect(o.train).toBe(50);
    expect(o.fish).toBe(true);
    expect(parseOptions({ spot: 'baby_blue', train: 60, fish: false })).toMatchObject({ train: 60, fish: false });
    expect(() => parseOptions({ spot: 'green_dragons' })).toThrow(/unknown spot/);
});