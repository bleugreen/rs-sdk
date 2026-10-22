import { describe, expect, test } from 'bun:test';
import type { InventoryItem, TradeItem, TradeState } from '../../sdk/types';
import { baseState, FakeSdk, flush } from '../lib/fake-sdk';
import { giveBackDelivered, giveBackTrade } from './cannon-receiver';

const item = (slot: number, id: number, name: string, count: number) => ({ slot, id, name, count, optionsWithIndex: [] }) as unknown as InventoryItem;
const SET: [string, number][] = [['Cannon base', 1], ['Cannon stand', 1], ['Cannon barrels', 1], ['Cannon furnace', 1], ['Cannonball', 30]];
const load = () => SET.map(([name, count], i) => item(i, 6 + i, name, count));
const MM = [{ item: 'Magic shortbow', count: 1 }, { item: 'Rune arrow', count: 200 }];
const mm = () => [item(0, 861, 'Magic shortbow', 1), item(1, 892, 'Rune arrow', 200)];
const offered = (items: InventoryItem[]): TradeItem[] => items.map((i, slot) => ({ slot, id: i.id, name: i.name, count: i.count }));
const trade = (t: Partial<TradeState>): TradeState => ({ isOpen: true, screen: 'offer', partner: 'cairn_h92', myOffer: [], theirOffer: [], myAccepted: false, partnerAccepted: false, ...t });

describe('the stand-in\'s give-back (H11r direction)', () => {
    test('with expectBack: the set and balls out, the holder\'s bow and 200 arrows in, one trade, judged both ways', async () => {
        const mine = offered(load());
        const theirs = offered(mm());
        const sdk = new FakeSdk(baseState({ tick: 1, inventory: load(), trade: trade({}) }));
        const sent = () => sdk.sent.splice(0).map(a => [a.method, ...a.args]);
        const r = giveBackTrade(sdk, 'cairn_h92', 30, MM);
        await flush();
        // Five All presses and the accept behind them.
        expect(sent()).toEqual([...[0, 1, 2, 3, 4].map(slot => ['sendOfferItem', slot, -1]), ['sendAcceptTrade']]);
        // The holder's offer resets both accepts: accepted again, as it covers expectBack.
        sdk.tick({ inventory: [], trade: trade({ myOffer: mine, theirOffer: theirs, partnerAccepted: true }) });
        await flush();
        expect(sent()).toEqual([['sendAcceptTrade']]);
        sdk.tick({ trade: trade({ screen: 'confirm', myOffer: mine, theirOffer: theirs, partnerAccepted: true }) });
        await flush();
        expect(sent()).toEqual([['sendAcceptTrade']]);
        sdk.tick({ inventory: mm(), trade: undefined });
        await flush();
        const out = await r;
        expect(out.ok).toBe(true);
        expect(out.gave.map(i => [i.name, i.count]).sort()).toEqual([...SET].sort());
        expect(out.received.map(i => [i.name, i.count]).sort()).toEqual([['Magic shortbow', 1], ['Rune arrow', 200]]);
        expect(giveBackDelivered(out, 30, MM)).toBe(true);
    });

    test('with expectBack: a holder offer without the arrows is never accepted, and declined on the confirm screen', async () => {
        const mine = offered(load());
        const bowOnly = offered(mm().slice(0, 1));
        const sdk = new FakeSdk(baseState({ tick: 1, inventory: load(), trade: trade({}) }));
        const methods = () => sdk.sent.splice(0).map(a => a.method);
        const r = giveBackTrade(sdk, 'cairn_h92', 30, MM);
        await flush();
        methods();
        sdk.tick({ inventory: [], trade: trade({ myOffer: mine, theirOffer: bowOnly, partnerAccepted: true }) });
        await flush();
        expect(methods()).toEqual([]);
        sdk.tick({ trade: trade({ screen: 'confirm', myOffer: mine, theirOffer: bowOnly, partnerAccepted: true }) });
        await flush();
        expect(methods()).toEqual(['sendDeclineTrade']);
        expect((await r).ok).toBe(false);
    });

    test('without expectBack: the plain give, nothing taken back', async () => {
        const mine = offered(load());
        const sdk = new FakeSdk(baseState({ tick: 1, inventory: load(), trade: trade({}) }));
        const methods = () => sdk.sent.splice(0).map(a => a.method);
        const r = giveBackTrade(sdk, 'cairn_h92', 30, []);
        await flush();
        expect(methods()).toEqual([...Array(5).fill('sendOfferItem'), 'sendAcceptTrade']);
        sdk.tick({ inventory: [], trade: trade({ myOffer: mine, myAccepted: true, partnerAccepted: true }) });
        await flush();
        sdk.tick({ trade: trade({ screen: 'confirm', myOffer: mine, partnerAccepted: true }) });
        await flush();
        expect(methods()).toEqual(['sendAcceptTrade']);
        sdk.tick({ trade: undefined });
        await flush();
        const out = await r;
        expect(out.ok).toBe(true);
        expect(out.received).toEqual([]);
        expect(giveBackDelivered(out, 30, [])).toBe(true);
    });

    test('delivered both ways: the set out and every expected item in', () => {
        const gave = offered(load());
        expect(giveBackDelivered({ ok: true, gave, received: offered(mm()) }, 30, MM)).toBe(true);
        expect(giveBackDelivered({ ok: true, gave, received: offered(mm().slice(1)) }, 30, MM)).toBe(false);
        expect(giveBackDelivered({ ok: true, gave: gave.slice(1), received: offered(mm()) }, 30, MM)).toBe(false);
        expect(giveBackDelivered({ ok: false, gave, received: offered(mm()) }, 30, MM)).toBe(false);
        // No balls left: the parts alone.
        expect(giveBackDelivered({ ok: true, gave: gave.slice(0, 4), received: [] }, 0, [])).toBe(true);
    });
});
