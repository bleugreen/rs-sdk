import { describe, expect, test } from 'bun:test';
import type { InventoryItem } from '../../sdk/types';
import { pairsForRound, planMakes } from './wine';
import { ITEM } from './wine-common';

const item = (slot: number, id: number, name: string, count = 1): InventoryItem => ({ slot, id, name, count, optionsWithIndex: [] }) as unknown as InventoryItem;

describe('planMakes', () => {
    test('pairs the k-th grapes with the k-th jug of water, in slot order', () => {
        const inv = [
            item(0, ITEM.wineNote, 'Unfermented wine', 40),
            item(3, ITEM.jugWater, 'Jug of water'),
            item(1, ITEM.grapes, 'Grapes'),
            item(2, ITEM.grapes, 'Grapes'),
            item(4, ITEM.jugWater, 'Jug of water')
        ];
        expect(planMakes(inv)).toEqual([
            [1, 3],
            [2, 4]
        ]);
    });

    test('is bounded by the scarcer ingredient and by the limit', () => {
        const inv = [item(0, ITEM.grapes, 'Grapes'), item(1, ITEM.grapes, 'Grapes'), item(2, ITEM.grapes, 'Grapes'), item(5, ITEM.jugWater, 'Jug of water'), item(6, ITEM.jugWater, 'Jug of water')];
        expect(planMakes(inv)).toHaveLength(2);
        expect(planMakes(inv, 1)).toEqual([[0, 5]]);
        expect(planMakes(inv, 0)).toEqual([]);
    });

    test('ignores empty jugs and wine', () => {
        const inv = [item(0, ITEM.grapes, 'Grapes'), item(1, ITEM.jugEmpty, 'Jug'), item(2, ITEM.wine, 'Unfermented wine')];
        expect(planMakes(inv)).toEqual([]);
    });
});

describe('pairsForRound', () => {
    test('two slots per wine: 27 free slots beside the note stack make 13', () => {
        expect(pairsForRound(27, 500, 500, Infinity)).toBe(13);
        expect(pairsForRound(28, 500, 500, Infinity)).toBe(14);
    });

    test('bounded by either ingredient and by the wines still wanted', () => {
        expect(pairsForRound(27, 4, 500, Infinity)).toBe(4);
        expect(pairsForRound(27, 500, 7, Infinity)).toBe(7);
        expect(pairsForRound(27, 500, 500, 3)).toBe(3);
    });

    test('never negative', () => {
        expect(pairsForRound(27, 500, 500, -5)).toBe(0);
        expect(pairsForRound(0, 0, 0, 10)).toBe(0);
    });
});
