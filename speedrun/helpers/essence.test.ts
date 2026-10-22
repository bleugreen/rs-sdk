import { describe, expect, test } from 'bun:test';
import type { BotActions } from '../../sdk/actions';
import type { BotSDK } from '../../sdk/index';
import type { BotWorldState, InventoryItem, NearbyLoc } from '../../sdk/types';
import { FakeSdk, baseState } from '../lib/fake-sdk';
import { microtasks, peek, tickEvery, useFakeTicks } from '../lib/fake-ticks';
import { DIALOG_GAP_TICKS, EssenceMiner, MINE_STALL_TICKS } from './essence';
import { memoryRoleState } from './role';

/** FakeSdk plus the two BotSDK members the miner reads that the shared fake lacks. */
class MinerSdk extends FakeSdk {
    countInventoryItems(pattern: RegExp): number {
        return this.getInventory().filter(i => pattern.test(i.name)).reduce((n, i) => n + i.count, 0);
    }
    /** BotSDK.waitForTicks without its wall-clock safety timeout. */
    waitForTicks(n = 1): Promise<BotWorldState> {
        const target = this.state!.tick + n;
        return new Promise(resolve => {
            const off = this.onStateUpdate(s => {
                if (s.tick >= target) {
                    off();
                    resolve(s);
                }
            });
        });
    }
}

const ROCK = { id: 2491, name: 'Rocks rune essence ore', x: 2911, z: 4832, level: 0, distance: 2, optionsWithIndex: [{ text: 'Mine', opIndex: 1 }] } as unknown as NearbyLoc;
const essence = (slot: number) => ({ id: 1436, name: 'Rune essence', count: 1, slot, optionsWithIndex: [] }) as unknown as InventoryItem;

function harness() {
    const sdk = new MinerSdk(baseState({ player: { worldX: 2910, worldZ: 4830, level: 0 } as BotWorldState['player'] }));
    sdk.scanLocs = [ROCK];
    const clicks: number[] = [];
    const bot = {
        dismissBlockingUI: async () => {},
        interactLoc: async () => {
            clicks.push(sdk.state!.tick);
            return { success: true, message: 'ok' };
        },
        talkTo: async () => ({ success: true, message: 'ok' })
    };
    const miner = new EssenceMiner({
        sdk: sdk as unknown as BotSDK,
        bot: bot as unknown as BotActions,
        account: 'test',
        options: {},
        signal: new AbortController().signal,
        state: memoryRoleState(),
        log: () => {},
        reportBank: () => {}
    });
    return { sdk, miner, clicks };
}

// The same tick counts at the production tick and at the demo's slow 370 ms tick.
for (const ms of [300, 370]) {
    describe(`at ${ms} ms a tick`, () => {
        useFakeTicks(ms);
        const step = async (sdk: MinerSdk, patch: Partial<BotWorldState> = {}) => {
            tickEvery(sdk, ms, 1, patch);
            await microtasks(50);
        };

        test(`mineUntilFull clicks the rock again only after ${MINE_STALL_TICKS} ticks pass without a gain`, async () => {
            const { sdk, miner, clicks } = harness();
            const t0 = sdk.state!.tick;
            const done = miner.mineUntilFull();
            await microtasks(50);
            expect(clicks).toEqual([t0]);
            for (let i = 0; i < MINE_STALL_TICKS; i++) await step(sdk);
            expect(clicks).toEqual([t0]);
            await step(sdk);
            expect(clicks).toEqual([t0, t0 + MINE_STALL_TICKS + 1]);
            await step(sdk, { inventory: Array.from({ length: 28 }, (_, i) => essence(i)) });
            expect(await done).toBe(28);
        });

        test('a gain restarts the stall count', async () => {
            const { sdk, miner, clicks } = harness();
            const t0 = sdk.state!.tick;
            const done = miner.mineUntilFull();
            await microtasks(50);
            for (let i = 0; i < 4; i++) await step(sdk);
            await step(sdk, { inventory: [essence(0)] });
            for (let i = 0; i < MINE_STALL_TICKS; i++) await step(sdk);
            expect(clicks).toEqual([t0]);
            await step(sdk);
            expect(clicks).toEqual([t0, t0 + 5 + MINE_STALL_TICKS + 1]);
            await step(sdk, { inventory: Array.from({ length: 28 }, (_, i) => essence(i)) });
            expect(await done).toBe(28);
        });

        test(`converse ends only once the dialog has been closed for more than ${DIALOG_GAP_TICKS} ticks`, async () => {
            const { sdk, miner } = harness();
            const done = miner.converse(/^aubury$/i, []);
            await microtasks(50);
            for (let i = 0; i < DIALOG_GAP_TICKS; i++) {
                await step(sdk);
                expect(await peek(done)).toBeUndefined();
            }
            await step(sdk);
            expect(await peek(done)).toEqual({ lines: [], offered: [] });
        });
    });
}
