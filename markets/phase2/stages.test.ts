import { describe, expect, test } from 'bun:test';
import type { BotWorldState } from '../../sdk/types';
import { stageDone } from './stages.ts';

const state = (o: { inventory?: string[]; equipment?: string[]; mining?: number }): BotWorldState =>
    ({
        inventory: (o.inventory ?? []).map((name, slot) => ({ name, count: 1, slot })),
        equipment: (o.equipment ?? []).map((name, slot) => ({ name, count: 1, slot })),
        skills: [{ name: 'Mining', baseLevel: o.mining ?? 1 }],
        player: { worldX: 3222, worldZ: 3218, level: 0 }
    }) as unknown as BotWorldState;
const hooks = { admitted: () => true };
const roleState = { get: () => undefined };
const pickaxeDone = (s: BotWorldState) => stageDone({ do: 'pickaxe' }, s, hooks, roleState);

describe('the pickaxe stage', () => {
    test('holds with a usable pickaxe carried or wielded', () => {
        expect(pickaxeDone(state({ inventory: ['Bronze pickaxe'] }))).toBe(true);
        expect(pickaxeDone(state({ equipment: ['Bronze pickaxe'], mining: 15 }))).toBe(true);
        expect(pickaxeDone(state({ inventory: ['Rune pickaxe'], mining: 41 }))).toBe(true);
    });
    test('runs for an account that lost its pickaxe, or holds only one above its level', () => {
        expect(pickaxeDone(state({ inventory: ['Coins', 'Bronze axe'] }))).toBe(false);
        expect(pickaxeDone(state({ inventory: ['Rune pickaxe'], mining: 15 }))).toBe(false);
    });
    test('the wield stage still asks for the pickaxe in the equipment', () => {
        expect(stageDone({ do: 'wield', item: 'pickaxe' }, state({ inventory: ['Bronze pickaxe'] }), hooks, roleState)).toBe(false);
        expect(stageDone({ do: 'wield', item: 'pickaxe' }, state({ equipment: ['Bronze pickaxe'] }), hooks, roleState)).toBe(true);
    });
});
