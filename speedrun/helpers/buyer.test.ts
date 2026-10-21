import { describe, expect, test } from 'bun:test';
import type { GEOffer, MarketQuote } from '../../sdk/index';
import type { InventoryItem } from '../../sdk/types';
import { baseState, FakeSdk } from '../lib/fake-sdk';
import { Buyer } from './buyer';
import type { RoleContext } from './role';

const GRAPES = 1987;
const GRAPES_NOTE = 1988;

/** FakeSdk plus the Grand Exchange surface the buyer reads. */
class FakeGeSdk extends FakeSdk {
    offers: GEOffer[] = [];
    geOpen = false;
    quote: Partial<MarketQuote> = { id: GRAPES, name: 'Grapes', bid: 1623, ask: null, sellQuantity: 0 };
    getGEState() {
        return this.geOpen ? ({ offers: this.offers } as unknown as ReturnType<import('../../sdk/index').BotSDK['getGEState']>) : null;
    }
    getInventory(): InventoryItem[] {
        return this.state!.inventory;
    }
    getBankItems() {
        return [];
    }
    async getMarketItems() {
        return { items: [{ id: GRAPES, name: 'Grapes' }] };
    }
    async getMarketItem() {
        return this.quote;
    }
    async waitForStateUpdate() {
        return this.tick();
    }
    async waitForCondition() {
        return this.state!;
    }
}

function setup(offers: Partial<GEOffer>[]) {
    const sdk = new FakeGeSdk(baseState({ player: { worldX: 3185, worldZ: 3438 } as never, inventory: [{ id: 995, name: 'Coins', count: 500_000, slot: 0 } as InventoryItem] }));
    sdk.offers = offers.map(o => ({ id: 1, slot: 0, item: GRAPES, name: 'Grapes', side: 'buy', quantity: 0, price: 1050, remaining: 0, filled: 0, state: 'open', items: 0, coins: 0, gross: 0, tax: 0, ...o }) as GEOffer);
    const calls: string[] = [];
    const placed: unknown[] = [];
    const bot = {
        async openGE() {
            calls.push('openGE');
            sdk.geOpen = true;
            return { success: true, message: 'open' };
        },
        async collectGE() {
            calls.push('collectGE');
            const items = sdk.offers.reduce((a, o) => a + o.items, 0);
            const coins = sdk.offers.reduce((a, o) => a + o.coins, 0);
            sdk.offers = sdk.offers.map(o => ({ ...o, items: 0, coins: 0 })).filter(o => o.state === 'open');
            sdk.push(s => ({ inventory: [...s.inventory, { id: GRAPES_NOTE, name: 'Grapes', count: items, slot: 1 } as InventoryItem].filter(i => i.count > 0) }));
            return { success: true, message: 'collected', items, coins };
        },
        async placeGEOffer(req: unknown) {
            calls.push('placeGEOffer');
            placed.push(req);
            return { success: true, message: 'placed' };
        },
        async closeInterface() {
            sdk.geOpen = false;
            return { success: true, message: 'closed' };
        }
    };
    const logs: string[] = [];
    const ctx = {
        bot,
        sdk,
        account: 'cairn_h61',
        options: {},
        log: (m: string) => logs.push(m),
        reportBank: () => {},
        signal: new AbortController().signal
    } as unknown as RoleContext;
    return { buyer: new Buyer(ctx), sdk, calls, placed };
}

describe('Buyer.buyAtGE collects before counting', () => {
    test('a filled but uncollected offer counts toward the target: no duplicate offer (#15910)', async () => {
        // #15804 filled 100 grapes while the account was away; they sit in the exchange.
        const { buyer, calls, placed } = setup([{ id: 15804, state: 'completed', quantity: 100, filled: 100, items: 100 }]);
        const r = await buyer.buyAtGE({ item: 'Grapes', quantity: 100, source: 'ge', maxPrice: 1050 });
        expect(calls.indexOf('collectGE')).toBeGreaterThan(-1);
        expect(calls).not.toContain('placeGEOffer');
        expect(placed).toEqual([]);
        expect(r).toMatchObject({ heldBefore: 100, note: 'already held' });
    });

    test('only the shortfall after collecting is bought', async () => {
        const { buyer, calls, placed } = setup([{ id: 15804, state: 'completed', quantity: 100, filled: 100, items: 100 }]);
        const r = await buyer.buyAtGE({ item: 'Grapes', quantity: 194, source: 'ge', maxPrice: 1050 }, 0);
        expect(calls.indexOf('collectGE')).toBeLessThan(calls.indexOf('placeGEOffer'));
        expect(placed).toEqual([{ item: GRAPES, side: 'buy', quantity: 94, price: 1050 }]);
        expect(r.heldBefore).toBe(100);
    });

    test('nothing waiting in the exchange: no collect call', async () => {
        const { buyer, calls } = setup([]);
        await buyer.buyAtGE({ item: 'Grapes', quantity: 10, source: 'ge', maxPrice: 1050 }, 0);
        expect(calls.slice(0, 2)).toEqual(['openGE', 'placeGEOffer']);
    });
});
