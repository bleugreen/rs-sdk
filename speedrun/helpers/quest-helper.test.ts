import { describe, expect, test } from 'bun:test';
import type { BotWorldState, InventoryItem } from '../../sdk/types';
import { baseState } from '../lib/fake-sdk';
import * as grandTree from '../quests/grand-tree';
import * as tgv from '../quests/tree-gnome-village';
import { gtPlan, kitCheck, mmPlan, ROYAL_SEAL, TGV_KIT, tgvPlan, type QuestPlan } from './quest-helper';

let slot = 0;
const item = (name: string, count = 1, id = 9000 + slot): InventoryItem => ({ slot: slot++, id, name, count, optionsWithIndex: [] }) as unknown as InventoryItem;
const state = (over: Partial<BotWorldState> = {}): BotWorldState => {
    slot = 0;
    return baseState({ tick: 1, ...over });
};
const at = (x: number, z: number, level = 0) => ({ name: 'h', x, z, worldX: x, worldZ: z, level, hp: 99, maxHp: 99 }) as BotWorldState['player'];

const letters = (stepId: string, names: string[]) => names.map(n => new RegExp(`^${stepId}:([A-Z][0-9]?)-`).exec(n)?.[1]);

describe('the plans name real segments, exactly the ruled ones', () => {
    const check = (plan: QuestPlan, stepId: string, names: string[], subs: string[], legs: string[]) => {
        const real = letters(stepId, names);
        expect(Object.keys(plan.substitute).sort()).toEqual([...subs].sort());
        expect(Object.keys(plan.legs).sort()).toEqual([...legs].sort());
        for (const k of [...subs, ...legs]) expect(real).toContain(k);
    };

    test('Tree Gnome Village: A, B, H, K substituted, no legs', () => {
        check(tgvPlan(), tgv.stepId, tgv.steps({ dialogue: 'fixed' }).map(s => s.name), ['A', 'B', 'H', 'K'], []);
    });

    test('The Grand Tree: A, I, N1, N2 substituted; legs before B, C and J', () => {
        check(gtPlan(), grandTree.stepId, grandTree.steps({ dialogue: 'fixed' }).map(s => s.name), ['A', 'I', 'N1', 'N2'], ['B', 'C', 'J']);
    });

    test('Monkey Madness: only A', () => {
        // The MM module is pinned off main (rs/185's e5161ba4), so only the plan's own shape is held here.
        expect(Object.keys(mmPlan().substitute)).toEqual(['A']);
        expect(Object.keys(mmPlan().legs)).toEqual([]);
    });
});

describe('kitCheck', () => {
    const kit = (logs: number, sharks: number, weapon = true) =>
        state({ inventory: [...Array.from({ length: logs }, () => item('Logs')), item('Shark', 1), ...Array.from({ length: sharks - 1 }, () => item('Shark'))], equipment: weapon ? [item('Rune scimitar')] : [] });

    test('passes with the logs, the sharks and the scimitar worn', () => {
        expect(kitCheck(kit(6, TGV_KIT.sharks), TGV_KIT)).toBe(true);
    });
    test('names what is short', () => {
        expect(kitCheck(kit(5, TGV_KIT.sharks), TGV_KIT)).toMatch(/5 logs, needs 6/);
        expect(kitCheck(kit(6, 3), TGV_KIT)).toMatch(/3 sharks/);
        expect(kitCheck(kit(6, TGV_KIT.sharks, false), TGV_KIT)).toMatch(/not worn/);
    });
});

describe('substituted checks replace SCORED-only gates', () => {
    test("TGV A: the helper's kit, not H7 (no staff of fire, no runes, Prayer 1)", () => {
        const s = state({
            quests: { tree: 'not_started' } as BotWorldState['quests'],
            inventory: [...Array.from({ length: 6 }, () => item('Logs')), ...Array.from({ length: TGV_KIT.sharks }, () => item('Shark'))],
            equipment: [item('Rune scimitar')],
            player: at(tgv.ARRIVAL.x, tgv.ARRIVAL.z),
        });
        const a = tgvPlan().substitute.A!;
        expect(a.preconditions!(s, {})).toBe(true);
        expect(a.postconditions!(s, {})).toBe(true);
        expect(tgv.kitCheck(s)).not.toBe(true);
    });

    test('GT A: needs TGV complete and the tree door, not Plague City, Magic or Prayer', () => {
        const a = gtPlan().substitute.A!;
        const door = at(grandTree.TILES.arrival.x, grandTree.TILES.arrival.z);
        expect(a.preconditions!(state({ quests: { tree: 'complete', grandtree: 'not_started' } as BotWorldState['quests'], player: door }), {})).toBe(true);
        expect(a.preconditions!(state({ quests: { tree: 'started', grandtree: 'not_started' } as BotWorldState['quests'], player: door }), {})).toMatch(/Tree Gnome Village/);
        expect(a.preconditions!(state({ quests: { tree: 'complete', grandtree: 'not_started' } as BotWorldState['quests'], player: at(3200, 3200) }), {})).toMatch(/not at the Grand Tree door/);
    });

    test('MM A: both prerequisite quests complete, MM not started (or the seal already held)', () => {
        const a = mmPlan().substitute.A!;
        const q = (mm: string) => ({ tree: 'complete', grandtree: 'complete', mm }) as unknown as BotWorldState['quests'];
        expect(a.preconditions!(state({ quests: q('not_started') }), {})).toBe(true);
        expect(a.preconditions!(state({ quests: q('started') }), {})).toMatch(/Monkey Madness is started/);
        expect(a.preconditions!(state({ quests: q('started'), inventory: [item('Royal seal', 1, ROYAL_SEAL)] }), {})).toBe(true);
        expect(a.preconditions!(state({ quests: { tree: 'complete', grandtree: 'started', mm: 'not_started' } as unknown as BotWorldState['quests'] }), {})).toMatch(/Grand Tree/);
    });
});
