import { describe, expect, test } from 'bun:test';
import type { GEOffer, MarketQuote } from '../../sdk/index';
import type { InventoryItem } from '../../sdk/types';
import { baseState, FakeSdk } from '../lib/fake-sdk';
import { BANKS, Buyer, SHOPS, travelPlan } from './buyer';
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

function setup(offers: Partial<GEOffer>[], at = BANKS.varrockWest, coins = 500_000) {
    const inventory = coins > 0 ? [{ id: 995, name: 'Coins', count: coins, slot: 0 } as InventoryItem] : [];
    const sdk = new FakeGeSdk(baseState({ player: { worldX: at.x, worldZ: at.z } as never, inventory }));
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
        },
        async walkTo(x: number, z: number) {
            calls.push(`walkTo ${x},${z}`);
            return { success: false, message: 'Stuck at (3268, 3227)' };
        },
        async openBank() {
            calls.push('openBank');
            return { success: true, message: 'open' };
        },
        async withdrawItem(_: unknown, n: number) {
            calls.push(`withdraw ${n}`);
            sdk.push(s => ({ inventory: [...s.inventory, { id: 995, name: 'Coins', count: n, slot: 0 } as InventoryItem] }));
            return { success: true, message: 'withdrawn' };
        },
        async closeBank() {
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

describe('from Al Kharid (the toll gate)', () => {
    const AL_KHARID_SHOP = SHOPS.louie!.stand;

    test('a Grand Exchange line walks out first, and stops without the toll instead of openGE walking into the gate', async () => {
        const { buyer, calls } = setup([], AL_KHARID_SHOP, 0);
        const r = await buyer.buyAtGE({ item: 'Grapes', quantity: 10, source: 'ge', maxPrice: 1050 });
        expect(calls).not.toContain('openGE');
        expect(r.note).toMatch(/could not reach the Grand Exchange/);
    });

    test('atBank refuses to open the nearest bank when it could not reach the one asked for', async () => {
        const { buyer, calls } = setup([], AL_KHARID_SHOP, 0);
        await expect(buyer.atBank(BANKS.varrockWest, async () => {})).rejects.toThrow(/could not reach/);
        expect(calls).not.toContain('openBank');
    });

    test('from just west of the gate, a walk steps clear of it first (the pathfinder routes Varrock east through Al Kharid)', async () => {
        const { buyer, calls } = setup([], { x: 3267, z: 3227 }, 0);
        await buyer.walk(BANKS.varrockEast);
        expect(calls[0]).toBe('walkTo 3255,3228');
        expect(calls).toContain(`walkTo ${BANKS.varrockEast.x},${BANKS.varrockEast.z}`);
    });

    test('prepare takes the toll from the Al Kharid bank before trying the gate', async () => {
        const { buyer, sdk, calls } = setup([], BANKS.alKharid, 0);
        sdk.getBankItems = () => [{ id: 995, name: 'Coins', count: 131_418 }] as never;
        // No guard in view: the crossing gives up after a few ticks, which the fake must publish.
        const ticker = setInterval(() => sdk.push(s => ({ tick: s.tick + 1 })), 1);
        await buyer.prepare().finally(() => clearInterval(ticker));
        const withdraw = calls.indexOf('withdraw 10');
        expect(calls.indexOf('openBank')).toBeLessThan(withdraw);
        // crossTollGate walks to the east side of the gate only after the coins are carried.
        expect(calls.indexOf('walkTo 3268,3227')).toBeGreaterThan(withdraw);
    });
});

describe('Buyer.buyAtShop on a restocking shop', () => {
    const RUNE_ARROW = 892;
    /** Dargaud's rune arrows: 400 gp at a full shelf of 400, +4 gp per arrow below it. */
    function shopSetup(shelfAtStart: number) {
        const at = SHOPS.dargaud!.stand;
        const sdk = new FakeGeSdk(baseState({ player: { worldX: at.x, worldZ: at.z } as never, inventory: [{ id: 995, name: 'Coins', count: 100_000, slot: 0 } as InventoryItem] }));
        let shelf = shelfAtStart;
        const show = (isOpen: boolean) =>
            sdk.push({
                shop: {
                    isOpen,
                    title: "Dargaud's Bow and Arrows.",
                    shopItems: isOpen ? [{ slot: 0, id: RUNE_ARROW, name: 'Rune arrow', count: shelf, baseCost: 400, buyPrice: 400, sellPrice: 0 }] : [],
                    playerItems: [],
                    shopConfig: { buyMultiplier: 1000, sellMultiplier: 1000, haggle: 10 }
                }
            });
        const count = (s: { inventory: InventoryItem[] }, id: number) => s.inventory.filter(i => i.id === id).reduce((a, i) => a + i.count, 0);
        const paid: number[] = [];
        const bot = {
            async walkTo() {
                return { success: true, message: 'there' };
            },
            async openShop() {
                show(true);
                return { success: true, message: 'open' };
            },
            async closeShop() {
                show(false);
                return { success: true, message: 'closed' };
            },
            async buyFromShop(_: unknown, n: number) {
                let cost = 0;
                for (let i = 0; i < n; i++, shelf--) cost += paid[paid.push(400 + 4 * (400 - shelf)) - 1]!;
                sdk.push(s => ({
                    inventory: [
                        { id: 995, name: 'Coins', count: count(s, 995) - cost, slot: 0 } as InventoryItem,
                        { id: RUNE_ARROW, name: 'Rune arrow', count: count(s, RUNE_ARROW) + n, slot: 1 } as InventoryItem
                    ]
                }));
                show(true);
                return { success: true, message: 'bought', amountBought: n };
            }
        };
        const ctx = { bot, sdk, account: 'cairn_h91', options: {}, log: () => {}, reportBank: () => {}, signal: new AbortController().signal } as unknown as RoleContext;
        return { buyer: new Buyer(ctx), paid, restock: (n: number) => (shelf += n) };
    }
    const line = (quantity: number) => ({ item: 'Rune arrow', quantity, source: 'shop' as const, shop: 'dargaud', maxPrice: 410, maxWaitTicks: 0 });

    test('probes one unit, then buys only while the next unit is under the cap', async () => {
        const { buyer, paid } = shopSetup(400);
        const r = await buyer.buyAtShop(line(10));
        expect(paid).toEqual([400, 404, 408]);
        expect(r).toMatchObject({ bought: 3, spent: 1212, note: 'price ~412.0 above 410' });
    });

    test('a later call reuses the measured price: no blind probe on a shelf still too dear', async () => {
        const { buyer, paid, restock } = shopSetup(400);
        await buyer.buyAtShop(line(10));
        const again = await buyer.buyAtShop(line(10));
        expect(again.bought).toBe(0);
        expect(paid).toHaveLength(3);
        // Two restocks bring the next arrow back to 404: it buys exactly those two.
        restock(2);
        const after = await buyer.buyAtShop(line(10));
        expect(paid.slice(3)).toEqual([404, 408]);
        expect(after.bought).toBe(2);
    });
});

describe('travelPlan', () => {
    test('surface to surface on one side of the toll gate: just walk', () => {
        expect(travelPlan(BANKS.varrockWest, SHOPS.peksa!.stand)).toEqual(['walk']);
        expect(travelPlan(BANKS.alKharid, SHOPS.shantay!.stand)).toEqual(['walk']);
    });

    test('into and out of Al Kharid pays the toll gate in the right direction', () => {
        expect(travelPlan(SHOPS.gerrant!.stand, SHOPS.louie!.stand)).toEqual(['toll-east', 'walk']);
        expect(travelPlan(SHOPS.shantay!.stand, BANKS.varrockWest)).toEqual(['toll-west', 'walk']);
    });

    test('Nurmof is underground: down from the surface, up to the bank', () => {
        expect(travelPlan(BANKS.varrockWest, SHOPS.nurmof!.stand)).toEqual(['climb-down', 'walk']);
        expect(travelPlan(SHOPS.nurmof!.stand, SHOPS.nurmof!.bank)).toEqual(['climb-up', 'walk']);
    });

    test('Al Kharid to the mine and back: the gate is crossed on the surface', () => {
        expect(travelPlan(BANKS.alKharid, SHOPS.nurmof!.stand)).toEqual(['toll-west', 'climb-down', 'walk']);
        expect(travelPlan(SHOPS.nurmof!.stand, BANKS.alKharid)).toEqual(['climb-up', 'toll-east', 'walk']);
    });

    test('every underground shop says how to get down', () => {
        for (const [name, shop] of Object.entries(SHOPS)) {
            if (shop.stand.z > 6400) expect({ name, below: !!shop.below }).toEqual({ name, below: true });
        }
    });
});

// rs/87: cairn_h54 collected 87 sharks, hit 'cannot afford', and walked off with the exchange
// open; its next openBank took that window for the bank and read the bank as empty.
describe('Buyer.buyAtGE leaves the exchange closed on every return', () => {
    test('cannot afford', async () => {
        const { buyer, sdk } = setup([]);
        const r = await buyer.buyAtGE({ item: 'Grapes', quantity: 10, source: 'ge', maxPrice: 1_000_000_000 }, 0);
        expect(r.note).toMatch(/^cannot afford/);
        expect(sdk.geOpen).toBe(false);
    });
    test('no sellers and no maxPrice', async () => {
        const { buyer, sdk } = setup([]);
        const r = await buyer.buyAtGE({ item: 'Grapes', quantity: 10, source: 'ge' }, 0);
        expect(r.note).toBe('no sellers and no maxPrice');
        expect(sdk.geOpen).toBe(false);
    });
    test('already held and a placed offer', async () => {
        for (const quantity of [100, 194]) {
            const { buyer, sdk } = setup([{ id: 15804, state: 'completed', quantity: 100, filled: 100, items: 100 }]);
            await buyer.buyAtGE({ item: 'Grapes', quantity, source: 'ge', maxPrice: 1050 }, 0);
            expect(sdk.geOpen).toBe(false);
        }
    });
});
