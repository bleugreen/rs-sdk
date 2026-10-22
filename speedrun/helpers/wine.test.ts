import { describe, expect, test } from 'bun:test';
import type { BotSDK } from '../../sdk/index';
import type { BotWorldState, InventoryItem } from '../../sdk/types';
import { baseState, FakeSdk } from '../lib/fake-sdk';
import { awaitRelogReturn, buttonAmount, giveWine, pairsForRound, planMakes } from './wine';
import { ITEM } from './wine-common';

const flush = () => new Promise(r => setTimeout(r, 0));
const SCORED = { nearbyPlayers: [{ index: 9, name: 'SCORED', combatLevel: 90, x: 3185, z: 3436, distance: 1 }] } as unknown as Partial<BotWorldState>;
const NOBODY = { nearbyPlayers: [] } as unknown as Partial<BotWorldState>;

describe('awaitRelogReturn and giveWine afterRelog (S25c: the giver requests on the receiver\'s relog 1)', () => {
    test('seen, gone, back: resolves on the first state back; an absence before the receiver arrives does not arm it', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1, ...NOBODY }));
        let back: number | null | undefined;
        void awaitRelogReturn(sdk as unknown as BotSDK, 'scored', 5_000).then(t => (back = t));
        sdk.tick(NOBODY);
        sdk.tick(SCORED); // arrives at the booth (S25e): seen, not yet the relog
        await flush();
        expect(back).toBeUndefined();
        sdk.tick(SCORED);
        sdk.tick(NOBODY); // relog 1's logout
        sdk.tick(NOBODY);
        await flush();
        expect(back).toBeUndefined();
        sdk.tick(SCORED); // tick 7: back
        await flush();
        expect(back).toBe(7);
    });

    test('a give-up on any of the three waits is null', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1, ...SCORED }));
        expect(await awaitRelogReturn(sdk as unknown as BotSDK, 'SCORED', 20)).toBeNull();
    });

    test('giveWine afterRelog sends no trade request before the receiver is back, then requests at once', async () => {
        const notes = [{ slot: 0, id: ITEM.wineNote, name: 'Unfermented wine', count: 520, optionsWithIndex: [] }] as unknown as InventoryItem[];
        const sdk = new FakeSdk(baseState({ tick: 1, ...SCORED, inventory: notes }));
        const log: string[] = [];
        const ctx = { sdk: sdk as unknown as BotSDK, bot: {} as never, log: (m: string) => void log.push(m) };
        const done = giveWine(ctx, 'SCORED', -1, 300, { afterRelog: true, cueTimeoutMs: 5_000 });
        const requests = () => sdk.sent.filter(a => a.method === 'sendTradeRequest').length;
        sdk.tick(SCORED);
        sdk.tick(NOBODY);
        await flush();
        expect(requests()).toBe(0);
        sdk.tick(SCORED);
        await flush();
        expect(requests()).toBe(1);
        expect(log).toContain('wine giver: receiver back after its relog');
        // the fake never opens the trade: the open gives up at its wall-clock bound
        expect((await done).success).toBe(false);
    });
});

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

describe('buttonAmount', () => {
    test('at most three 10/5/1 clicks, never the X dialog', () => {
        expect(buttonAmount(13, 500)).toBe(12);
        expect(buttonAmount(14, 500)).toBe(12);
        expect(buttonAmount(12, 500)).toBe(12);
        expect(buttonAmount(9, 500)).toBe(7);
        expect(buttonAmount(4, 500)).toBe(3);
        expect(buttonAmount(0, 500)).toBe(0);
    });

    test('the whole stack is one All click', () => {
        expect(buttonAmount(13, 13)).toBe(13);
        expect(buttonAmount(13, 9)).toBe(9);
    });
});
