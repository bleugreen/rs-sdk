import { describe, expect, test } from 'bun:test';
import type { BotWorldState, InventoryItem, NearbyLoc, PlayerState } from '../../sdk/types';
import { baseState } from '../lib/fake-sdk';
import { chainRunes, legPasses, planPrep } from './demo-legs';

const player = (x: number, z: number) => ({ name: 'h', x, z, worldX: x, worldZ: z, level: 0, hp: 75, maxHp: 75 }) as PlayerState;
const item = (slot: number, name: string, count = 1): InventoryItem => ({ slot, id: 1000 + slot, name, count, optionsWithIndex: [] }) as unknown as InventoryItem;
const booth: NearbyLoc = { id: 2213, name: 'Bank booth', x: 3186, z: 3438, level: 0, distance: 2, optionsWithIndex: [], options: [] } as NearbyLoc;
const state = (x: number, z: number, inventory: InventoryItem[], more: Partial<BotWorldState> = {}) =>
    baseState({ player: player(x, z), skills: [{ name: 'Magic', level: 99, baseLevel: 99, experience: 0 }], equipment: [item(3, 'Staff of air')], inventory, ...more });
const VARROCK_WEST = [3184, 3438] as const;
const COOP = [3233, 3295] as const;

describe('planPrep', () => {
    test('the chain casts Falador three times, Varrock and Lumbridge once each', () => {
        expect(chainRunes()).toEqual({ water: 3, air: 15, law: 5, fire: 1, earth: 1 });
    });

    test("h55 now (02:41Z): every rune held, nothing to buy or withdraw, a teleport to the spawn", () => {
        const s = state(...VARROCK_WEST, [item(0, 'Coins', 18), item(1, 'Water rune', 4), item(2, 'Law rune', 19), item(4, 'Earth rune', 2), item(5, 'Fire rune', 2)]);
        expect(planPrep(s, { withdrawCoins: 200 })).toEqual({ ok: true, spawnTeleport: true, buy: {}, withdraw: 0, shop: null });
    });

    test('attempt 3 (02:16Z, at the coop with earth 2): no margin, so no shop and no bank', () => {
        const s = state(...COOP, [item(0, 'Coins', 18), item(1, 'Water rune', 4), item(2, 'Law rune', 19), item(4, 'Earth rune', 2), item(5, 'Fire rune', 2)]);
        expect(planPrep(s, { withdrawCoins: 200 })).toMatchObject({ ok: true, buy: {}, withdraw: 0, shop: null });
    });

    test('attempt 1 (02:11Z, 0 coins at the bank): withdraw, then the nearer shop for exactly the casts', () => {
        const s = state(...VARROCK_WEST, [item(2, 'Law rune', 20)], { nearbyLocs: [booth] });
        expect(planPrep(s, { withdrawCoins: 200 })).toEqual({ ok: true, spawnTeleport: true, buy: { water: 3, earth: 2, fire: 1 }, withdraw: 200, shop: 'Aubury' });
    });

    test('coins short with no bank in view: refused before any action, never a bank attempt', () => {
        const s = state(...COOP, [item(2, 'Law rune', 20)]);
        expect(planPrep(s, { withdrawCoins: 200 })).toEqual({ ok: false, why: '0 coins carried for 6 runes (up to 150) and no bank in view to withdraw from' });
    });

    test('coins short without --withdraw-coins: refused', () => {
        const s = state(...VARROCK_WEST, [item(2, 'Law rune', 20)], { nearbyLocs: [booth] });
        expect(planPrep(s)).toMatchObject({ ok: false, why: expect.stringMatching(/--withdraw-coins not given/) });
    });

    test('enough coins carried: buys without the bank', () => {
        const s = state(...VARROCK_WEST, [item(0, 'Coins', 500), item(2, 'Law rune', 20)]);
        expect(planPrep(s, { withdrawCoins: 200 })).toMatchObject({ ok: true, withdraw: 0, shop: 'Aubury' });
    });

    test('near the spawn: no prep teleport, so one earth fewer', () => {
        const s = state(3222, 3222, [item(0, 'Coins', 500), item(2, 'Law rune', 20)]);
        expect(planPrep(s)).toMatchObject({ ok: true, spawnTeleport: false, buy: { water: 3, earth: 1, fire: 1 } });
    });

    test('law short or Magic too low: refused (no shop here sells law)', () => {
        expect(planPrep(state(...VARROCK_WEST, [item(2, 'Law rune', 4)]))).toMatchObject({ ok: false, why: '4 law runes, 6 needed (neither shop sells law)' });
        expect(planPrep({ ...state(...VARROCK_WEST, []), skills: [{ name: 'Magic', level: 30, baseLevel: 30, experience: 0 }] })).toMatchObject({ ok: false });
    });

    test('legPasses: 10% of the lab mean, never under a tick, L24c held to its lab spread', () => {
        expect(legPasses('T01-02', 55)).toBe(true);
        expect(legPasses('T01-02', 56)).toBe(false);
        expect(legPasses('L24c', 6)).toBe(true);
        expect(legPasses('L24c', 7)).toBe(false);
    });
});
