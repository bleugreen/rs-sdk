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

describe('one source for the row: the holder\'s serve built from the ledger rows SCORED\'s step reads', () => {
    test('H11 and H23 as the ledger in force carries them, every obj resolvable for labStock', async () => {
        const { serveFromLedger, returnExtrasFromLedger } = await import('./cannon-receiver');
        const { objPack } = await import('../lib/obj-pack');
        const h11 = serveFromLedger('H11');
        expect(h11.balls).toBe(100);
        expect(h11.extras.map(e => [e.item, e.count])).toEqual([['mithril scimitar', 1], ['law rune', 4], ['water rune', 4]]);
        // Fold-in 24: H11 carries no sharks, H23 a fixed 2 (no top-up on either cannon row).
        expect(h11.topUps).toEqual([]);
        const h23 = serveFromLedger('H23');
        expect(h23.balls).toBe(1200);
        expect(h23.extras.map(e => [e.item, e.count])).toContainEqual(['shark', 2]);
        expect(h23.extras.map(e => e.item)).toContain('magic shortbow');
        expect(h23.topUps).toEqual([]);
        for (const e of [...h11.extras, ...h23.extras, ...h11.topUps, ...h23.topUps]) expect(objPack().ids.has(e.obj)).toBe(true);
        // The take-back is exactly the H11r row's `in` (two-way since fold-in 23: the bow and the arrows).
        const { handOffFrom } = await import('../runner/handoff');
        const { readFileSync } = await import('fs');
        const { MANIFEST } = await import('../tools/slot-ledger');
        const h11r = handOffFrom(readFileSync(MANIFEST, 'utf8'), 'H11r');
        expect(returnExtrasFromLedger().map(e => [e.item, e.count])).toEqual(h11r.receive.map(r => [r.name, r.count]));
        expect(() => serveFromLedger('H9')).toThrow('not a cannon row');
    });

    test('a give-only H11r row returns nothing; the two-way row returns the bow and arrows, by obj name for labStock', async () => {
        const { returnExtrasFromLedger } = await import('./cannon-receiver');
        const { readFileSync } = await import('fs');
        const { MANIFEST } = await import('../tools/slot-ledger');
        const text = readFileSync(MANIFEST, 'utf8');
        const row = text.split('\n').find(l => l.startsWith('| H11r |'))!;
        const giveOnly = text.replace(row, `| H11r | - | ${row.split('|')[3]!.trim().replace(/\(swap/g, '(trade')} | - | 0 | fixture (r) |`);
        expect(returnExtrasFromLedger(giveOnly)).toEqual([]);
        expect(returnExtrasFromLedger(text).map(e => [e.item, e.count, e.obj])).toEqual([['magic shortbow', 1, 'magic_shortbow'], ['rune arrow', 200, 'rune_arrow']]);
    });

    test('serveDrift: a serve equal to the row is clean; the staged shark 2 against a top-up to 9 is reported', async () => {
        const { serveDrift, serveFromLedger } = await import('./cannon-receiver');
        const { readFileSync } = await import('fs');
        const { MANIFEST } = await import('../tools/slot-ledger');
        // A cannon row with a top-up, as H11 was before fold-in 24.
        const withTopUp = readFileSync(MANIFEST, 'utf8').replace(/^\| H11 \| /m, '| H11 | shark to 9 [u]; ');
        const h11 = serveFromLedger('H11', withTopUp);
        const exact = { balls: 100, extras: [...h11.extras, { item: 'Shark', count: 9 }] };
        expect(serveDrift({ balls: 100, extras: [...h11.extras] }, { ...h11, topUps: [] })).toEqual([]);
        expect(serveDrift(exact, h11)).toEqual(['H11: shark served a fixed 9 against a top-up to 9: SCORED declines unless it holds at least 0 (size it from the ledger walk)']);
        const staged = serveDrift({ balls: 100, extras: [{ item: 'Mithril scimitar', count: 1 }, { item: 'Law rune', count: 4 }, { item: 'Water rune', count: 4 }, { item: 'Shark', count: 2 }] }, h11);
        expect(staged.join('\n')).toContain('shark served a fixed 2 against a top-up to 9');
        expect(serveDrift({ balls: 1200, extras: [{ item: 'Magic shortbow', count: 1 }] }, serveFromLedger('H23')).length).toBeGreaterThan(1);
    });
});

describe('the stand-in receives the whole row, through the run\'s own step sequence', () => {
    test('S14 is row H11, S27 row H23; the receive wants every in of the row, and a set-only delivery is short', async () => {
        const { cannonRow } = await import('./cannon-receiver');
        const { handOffFrom, handOffMissing } = await import('../runner/handoff');
        const { readFileSync } = await import('fs');
        const { MANIFEST } = await import('../tools/slot-ledger');
        expect([cannonRow({ step: 'S14', family: 'cannon' }), cannonRow({ step: 'S27', family: 'cannon' }), cannonRow({ step: 'S14', family: 'cannon' }, 'H23')]).toEqual(['H11', 'H23', 'H23']);
        expect(() => cannonRow({ step: 'S99', family: 'cannon' })).toThrow('no ledger row');
        const plan = handOffFrom(readFileSync(MANIFEST, 'utf8'), 'H11');
        expect(plan.receive.map(r => r.name)).toEqual(['cannon base', 'cannon stand', 'cannon barrels', 'cannon furnace', 'cannonball', 'mithril scimitar', 'law rune', 'water rune']);
        const setOnly = baseState({ inventory: load() });
        const short = handOffMissing({ ...setOnly, inventory: setOnly.inventory.map(i => (i.name === 'Cannonball' ? { ...i, count: 100 } : i)) }, plan);
        expect(short).toEqual(['mithril scimitar 0 of 1', 'law rune 0 of 4', 'water rune 0 of 4']);
    });
});
