import { describe, expect, test } from 'bun:test';
import type { BotWorldState } from '../../sdk/types';
import { cheb, COW_PEN, CROSSING_HITPOINTS, inCowPen, inKandarin, TAVERLEY, westOfTaverley } from './kandarin';

const at = (x: number, z: number, level = 0) => ({ player: { worldX: x, worldZ: z, level } }) as unknown as BotWorldState;

describe('kandarin geometry', () => {
    test('Seers, Catherby and the Ranging Guild are in Kandarin; Lumbridge, Taverley and upstairs are not', () => {
        expect(inKandarin(at(2725, 3491))).toBe(true); // Seers bank
        expect(inKandarin(at(2809, 3439))).toBe(true); // Catherby bank
        expect(inKandarin(at(2672, 3434))).toBe(true); // Ranging Guild shop
        expect(inKandarin(at(3222, 3218))).toBe(false); // Lumbridge
        expect(inKandarin(at(TAVERLEY.x, TAVERLEY.z))).toBe(false);
        expect(inKandarin(at(2725, 3491, 1))).toBe(false);
        expect(inKandarin(null)).toBe(false);
    });
    test('west of Taverley: on the mountain and past it, not Taverley itself or underground', () => {
        expect(westOfTaverley({ x: 2850, z: 3440 })).toBe(true);
        expect(westOfTaverley(TAVERLEY)).toBe(false);
        expect(westOfTaverley({ x: 2800, z: 9800 })).toBe(false);
    });
    test('the cow pen holds its own centre', () => {
        expect(inCowPen(COW_PEN)).toBe(true);
        expect(inCowPen({ x: 3241, z: 3285 })).toBe(false);
    });
    test('cheb and the crossing gate', () => {
        expect(cheb({ x: 0, z: 0 }, { x: 3, z: -5 })).toBe(5);
        expect(CROSSING_HITPOINTS).toBe(30);
    });
});