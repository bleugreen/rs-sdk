import { describe, expect, test } from 'bun:test';
import type { InventoryItem } from '../../sdk/types';
import { baseState, FakeSdk } from '../lib/fake-sdk';
import { BANKS, SHOPS } from './buyer';
import type { RoleContext } from './role';
import { inGuild, parseOptions, RuneArrows } from './rune-arrows';

describe('inGuild', () => {
    test('the guild door: north-west of it is outside, the teleport lands inside', () => {
        expect(inGuild({ x: 2657, z: 3439 })).toBe(false);
        expect(inGuild({ x: 2659, z: 3437 })).toBe(true);
        // South of the door counts as inside in its script (seen live: the role stood here).
        expect(inGuild({ x: 2658, z: 3437 })).toBe(true);
        expect(inGuild({ x: 2658, z: 3438 })).toBe(false);
    });

    test("Dargaud's stand is inside; Seers' bank and the far side of the north-east barricade are not", () => {
        expect(inGuild(SHOPS.dargaud!.stand)).toBe(true);
        expect(inGuild(BANKS.seers)).toBe(false);
        expect(inGuild({ x: 2680, z: 3437 })).toBe(false);
    });
});

describe('parseOptions', () => {
    test('defaults', () => {
        expect(parseOptions({})).toEqual({ target: 650, maxPrice: 410, bankEvery: 100, crossingHitpoints: 30, extras: [] });
    });

    test('numbers override; junk falls back', () => {
        expect(parseOptions({ target: 100, maxPrice: 600, bankEvery: 0, crossingHitpoints: 'x' })).toEqual({ target: 100, maxPrice: 600, bankEvery: 1, crossingHitpoints: 30, extras: [] });
    });

    test('extras keep only complete lines', () => {
        const extras = [{ item: 'Mithril arrowtips', target: 750, maxPrice: 24 }, { item: 'Adamant arrowtips', target: 0, maxPrice: 60 }, { target: 5 }];
        expect(parseOptions({ extras }).extras).toEqual([{ item: 'Mithril arrowtips', target: 750, maxPrice: 24 }]);
    });
});

class FakeBankSdk extends FakeSdk {
    bank: { slot: number; id: number; name: string; count: number }[] = [];
    getBankItems() {
        return this.bank.filter(i => i.count > 0);
    }
    async waitForCondition() {
        return this.state!;
    }
}

describe('bankAtSeers: the next goal from what the bank holds', () => {
    function setup(bank: { name: string; count: number }[], options: Record<string, unknown> = {}) {
        const sdk = new FakeBankSdk(baseState({ player: { worldX: BANKS.seers.x, worldZ: BANKS.seers.z } as never, inventory: [] }));
        const items = bank.map((b, slot) => ({ slot, id: b.name === 'Coins' ? 995 : 892, ...b }));
        sdk.bank = items;
        const coins = () => sdk.getState()!.inventory.find(i => i.name === 'Coins')?.count ?? 0;
        const bot = {
            async walkTo() {
                return { success: true, message: 'there' };
            },
            async openBank() {
                return { success: true, message: 'open' };
            },
            async closeBank() {
                return { success: true, message: 'closed' };
            },
            async withdrawItem(_: unknown, n: number) {
                const c = items.find(i => i.name === 'Coins')!;
                c.count -= n;
                sdk.push({ inventory: [{ id: 995, name: 'Coins', count: coins() + n, slot: 0 } as InventoryItem] });
                return { success: true, message: 'withdrawn' };
            },
            async depositItem() {
                return { success: true, message: 'deposited' };
            }
        };
        const logs: string[] = [];
        const ctx = { bot, sdk, account: 'cairn_h91', options: {}, log: (m: string) => logs.push(m), reportBank: () => {}, signal: new AbortController().signal } as unknown as RoleContext;
        return { role: new RuneArrows(ctx, parseOptions(options)), coins, logs };
    }

    test('carries coins for the next 100 arrows at the cap', async () => {
        const { role, coins } = setup([{ name: 'Rune arrow', count: 250 }, { name: 'Coins', count: 50_000 }]);
        expect(await role.bankAtSeers()).toBe(350);
        expect(coins()).toBe(41_000);
    });

    test('short of coins: a smaller goal, as many arrows as the coins buy at the cap', async () => {
        const { role } = setup([{ name: 'Rune arrow', count: 250 }, { name: 'Coins', count: 20_000 }]);
        expect(await role.bankAtSeers()).toBe(250 + 48);
    });

    test('the last stretch stops at the target', async () => {
        const { role, coins } = setup([{ name: 'Rune arrow', count: 600 }, { name: 'Coins', count: 50_000 }]);
        expect(await role.bankAtSeers()).toBe(650);
        expect(coins()).toBe(50 * 410);
    });

    test('extras still wanted add their coins; rune arrows done leaves goal 0 but coins carried', async () => {
        const extras = [{ item: 'Mithril arrowtips', target: 750, maxPrice: 24 }];
        const both = setup([{ name: 'Rune arrow', count: 0 }, { name: 'Coins', count: 100_000 }], { target: 100, maxPrice: 700, extras });
        expect(await both.role.bankAtSeers()).toBe(100);
        expect(both.coins()).toBe(100 * 700 + 300 * 24);
        const runeDone = setup([{ name: 'Rune arrow', count: 100 }, { name: 'Coins', count: 100_000 }], { target: 100, maxPrice: 700, extras });
        expect(await runeDone.role.bankAtSeers()).toBe(0);
        expect(runeDone.coins()).toBe(300 * 24);
    });

    test('target held, or no coins for one arrow: 0 (stop)', async () => {
        expect(await setup([{ name: 'Rune arrow', count: 650 }, { name: 'Coins', count: 50_000 }]).role.bankAtSeers()).toBe(0);
        const broke = setup([{ name: 'Rune arrow', count: 10 }, { name: 'Coins', count: 409 }]);
        expect(await broke.role.bankAtSeers()).toBe(0);
        expect(broke.logs).toContain('out of coins');
    });
});
