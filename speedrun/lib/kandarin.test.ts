import { describe, expect, test } from 'bun:test';
import type { BotWorldState } from '../../sdk/types';
import type { BotSDK } from '../../sdk/index';
import { baseState, FakeSdk } from './fake-sdk';
import { fakeClock, microtasks, tickEvery, useFakeTicks } from './fake-ticks';
import { cheb, COW_PEN, CROSSING_HITPOINTS, crossingRestTarget, crossingSettings, inCowPen, inKandarin, restForCrossing, TAVERLEY, westOfTaverley, type Traveller } from './kandarin';

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

describe('restForCrossing', () => {
    /** Hitpoints regenerate one per 100 ticks when `regen`; the clock moves only in waitForTicks. */
    function account(hp: number, base = 30, regen = true) {
        let tick = 0;
        const logs: string[] = [];
        const sdk = {
            getSkill: () => ({ level: hp, baseLevel: base }),
            getState: () => ({ tick, player: { worldX: 3092, worldZ: 3245, level: 0 } }),
            waitForTicks: async (n: number) => {
                const before = Math.floor(tick / 100);
                tick += n;
                if (regen) hp = Math.min(base, hp + Math.floor(tick / 100) - before);
            }
        };
        let aborted = false;
        const t = { bot: {}, sdk, log: (m: string) => logs.push(m), checkSignal: () => { if (aborted) throw new Error('aborted'); } } as unknown as Traveller;
        return { t, logs, hp: () => hp, tick: () => tick, abort: () => { aborted = true; } };
    }

    test('the target is 30, or full below it', () => {
        expect(crossingRestTarget(30)).toBe(30);
        expect(crossingRestTarget(55)).toBe(30);
        expect(crossingRestTarget(18)).toBe(18);
    });

    test('a rested account crosses at once', async () => {
        const a = account(30);
        await restForCrossing(a.t);
        expect(a.tick()).toBe(0);
        expect(a.logs).toEqual([]);
        const b = account(31, 55);
        await restForCrossing(b.t);
        expect(b.tick()).toBe(0);
    });

    test('a woodcutter back from a crossing on 14/30 rests to 30 before the next one', async () => {
        const a = account(14);
        await restForCrossing(a.t);
        expect(a.hp()).toBe(30);
        expect(a.tick()).toBe(1600);
        expect(a.logs).toEqual(['resting before the crossing', 'rested']);
    });

    test('Hitpoints that never move: carries on after the regeneration time plus two minutes', async () => {
        const a = account(14, 30, false);
        await restForCrossing(a.t);
        expect(a.logs).toEqual(['resting before the crossing', 'rest cut short']);
        expect(a.tick()).toBeGreaterThan(1800);
        expect(a.tick()).toBeLessThanOrEqual(1810);
    });

    test('an abort stops the rest', async () => {
        const a = account(14, 30, false);
        a.abort();
        await expect(restForCrossing(a.t)).rejects.toThrow(/aborted/);
    });
});


for (const ms of [300, 400]) {
    describe(`crossingSettings at ${ms} ms a tick: auto-retaliate is confirmed in observed ticks`, () => {
        useFakeTicks(ms);

        test('off on the 9th tick of a server 50% slower than nominal is waited for, with one press (past the old 3 s wall bound)', async () => {
            const sdk = new FakeSdk(baseState({ tick: 0, autoRetaliateEnabled: true }));
            const logs: string[] = [];
            const p = crossingSettings(sdk as unknown as BotSDK, m => logs.push(m));
            await microtasks();
            tickEvery(sdk, ms * 1.5, 8);
            await microtasks();
            fakeClock.advanceTimersByTime(ms * 1.5);
            sdk.tick({ autoRetaliateEnabled: false });
            await p;
            expect(logs).toEqual([]);
            expect(sdk.sent.filter(a => a.method === 'sendClickComponent').length).toBe(1);
        });
    });
}
