import { describe, expect, test } from 'bun:test';

import type { InventoryItem } from '../../sdk/types';
import { baseState } from '../lib/fake-sdk';
import { handOffFrom } from '../runner/handoff';
import { countsDiffer, gained, standInPlan } from './mule-standin';

const TABLE = `
| row | in | out | equip | needAtStart | source |
|---|---|---|---|---|---|
| H12 | gold bar x1 [u]; law rune x6 [s] | staff of fire x1 (swap); mithril scimitar x1 (swap); knife x1 (swap); coins all (swap) | +magic shortbow; -staff of fire | 2 | fixture (r) |
| S15 | - | - | - | 0 | fixture (r) |
`;
const item = (slot: number, id: number, name: string, count = 1): InventoryItem => ({ slot, id, name, count, optionsWithIndex: [] });

describe('mule-standin', () => {
    test('gained and countsDiffer compare by obj id', () => {
        const before = new Map([[995, 10], [385, 1]]);
        const after = new Map([[995, 25], [385, 1], [2357, 1]]);
        expect(gained(before, after)).toEqual([{ id: 995, n: 15 }, { id: 2357, n: 1 }]);
        expect(countsDiffer(before, before)).toEqual([]);
        expect(countsDiffer(before, after)).toEqual(['obj 995: 10 -> 25', 'obj 2357: 0 -> 1']);
    });

    test('the stand-in plan: no equip changes; a give line runs only on mule surplus it holds', () => {
        const own = new Map([[995, 40]]);
        const s = baseState({
            // Seeded from the mule: the staff and the knife; the coins are the stand-in's own; no scimitar.
            inventory: [item(0, 1387, 'Staff of fire'), item(1, 946, 'Knife'), item(2, 995, 'Coins', 40)],
        });
        const { plan, notExercised } = standInPlan(handOffFrom(TABLE, 'H12'), s, own);
        expect(plan.wield).toEqual([]);
        expect(plan.unwield).toEqual([]);
        expect(plan.give.map(g => g.name)).toEqual(['staff of fire', 'knife']);
        expect(plan.receive.map(r => r.name)).toEqual(['gold bar', 'law rune']);
        expect(notExercised).toEqual([
            '+magic shortbow (equip; the stand-in never equips)',
            '-staff of fire (equip)',
            'gives mithril scimitar: not held (no surplus seeded)',
            "gives coins: the stand-in's own, not the mule's",
        ]);
    });

    test('a give line the stand-in wears is not exercised', () => {
        const s = baseState({ inventory: [item(0, 946, 'Knife')], equipment: [item(3, 1387, 'Staff of fire')] });
        const { plan, notExercised } = standInPlan(handOffFrom(TABLE, 'H12'), s, new Map());
        expect(plan.give.map(g => g.name)).toEqual(['knife']);
        expect(notExercised).toContain('gives staff of fire: worn by the stand-in');
    });
});
