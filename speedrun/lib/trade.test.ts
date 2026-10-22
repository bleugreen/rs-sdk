import { describe, expect, test } from 'bun:test';
import type { BotWorldState, GameMessage, InventoryItem, TradeItem, TradeState } from '../../sdk/types';
import { baseState, FakeSdk, flush } from './fake-sdk';
import { decideGiver, decideReceiver, give, newGiverCtx, newReceiverCtx, planOffers, receiveFrom, sameName, SETTLE_TICKS, type GiverCtx, type ReceiverCtx, type TradeSdk } from './trade';

const inv = (slot: number, id: number, name: string, count = 1): InventoryItem => ({ slot, id, name, count, optionsWithIndex: [] });
const ti = (id: number, name: string, count: number): TradeItem => ({ slot: 0, id, name, count });
const ORE = ti(441, 'Iron ore', 10);

function frame(tick: number, trade: Partial<TradeState> | null, inventory: InventoryItem[] = []): BotWorldState {
    const t: TradeState | undefined = trade === null ? undefined : {
        isOpen: true, screen: 'offer', partner: 'helper', myOffer: [], theirOffer: [], myAccepted: false, partnerAccepted: false, ...trade,
    };
    return baseState({ tick, inventory, ...(t ? { trade: t } : {}) });
}

/** Run frames through decideReceiver, collecting the actions. */
function runReceiver(ctx: ReceiverCtx, frames: BotWorldState[]): string[] {
    const out: string[] = [];
    for (const f of frames) {
        const d = decideReceiver(f, ctx);
        ctx = d.next;
        out.push(d.action);
    }
    return out;
}

describe('decideReceiver', () => {
    const want = [{ item: 'Iron ore', amount: 10 }];

    test('accepts the offer screen once per tick when want is satisfied', () => {
        const ctx = newReceiverCtx('helper', [], want);
        expect(runReceiver(ctx, [
            frame(1, { theirOffer: [] }),
            frame(2, { theirOffer: [ORE] }),
            frame(2, { theirOffer: [ORE] }), // same-tick republish: no second accept
            frame(3, { theirOffer: [ORE], myAccepted: true }),
        ])).toEqual(['wait', 'accept', 'wait', 'wait']);
    });

    test('offer changes after our accept: re-accept only once it satisfies want again', () => {
        const ctx = newReceiverCtx('helper', [], want);
        expect(runReceiver(ctx, [
            frame(1, { theirOffer: [ORE] }),
            frame(2, { theirOffer: [ti(441, 'Iron ore', 5)] }), // partner removed some: server reset our accept
            frame(3, { theirOffer: [ti(441, 'Iron ore', 5)] }),
            frame(4, { theirOffer: [ti(441, 'Iron ore', 12)] }),
        ])).toEqual(['accept', 'wait', 'wait', 'accept']);
    });

    test('item swapped between screens: decline on the confirm screen', () => {
        const ctx = newReceiverCtx('helper', [], want);
        expect(runReceiver(ctx, [
            frame(1, { theirOffer: [ORE] }),
            frame(2, { screen: 'confirm', theirOffer: [ti(2349, 'Bronze bar', 10)] }),
        ])).toEqual(['accept', 'decline']);
    });

    test('an empty confirm-screen offer is not read yet: wait, accept when it fills, decline if it stays empty', () => {
        expect(runReceiver(newReceiverCtx('helper', [], want), [
            frame(1, { theirOffer: [ORE] }),
            frame(2, { screen: 'confirm', theirOffer: [] }),
            frame(3, { screen: 'confirm', theirOffer: [ORE] }),
        ])).toEqual(['accept', 'wait', 'accept']);
        expect(runReceiver(newReceiverCtx('helper', [], want), [
            frame(1, { theirOffer: [ORE] }),
            frame(2, { screen: 'confirm', theirOffer: [] }),
            frame(3, { screen: 'confirm', theirOffer: [] }),
            frame(4, { screen: 'confirm', theirOffer: [] }),
            frame(5, { screen: 'confirm', theirOffer: [] }),
        ])).toEqual(['accept', 'wait', 'wait', 'wait', 'decline']);
    });

    test('no want: accept when the partner accepts, then decline a short count on confirm', () => {
        const ctx = newReceiverCtx('helper', []);
        expect(runReceiver(ctx, [
            frame(1, { theirOffer: [ORE] }),
            frame(2, { theirOffer: [ORE], partnerAccepted: true }),
            frame(3, { screen: 'confirm', theirOffer: [ti(441, 'Iron ore', 9)] }),
        ])).toEqual(['wait', 'accept', 'decline']);
    });

    test('declines when our own offer is not empty', () => {
        const ctx = newReceiverCtx('helper', [], want);
        expect(runReceiver(ctx, [frame(1, { theirOffer: [ORE], myOffer: [ti(995, 'Coins', 1)] })])).toEqual(['decline']);
    });

    test('declines a trade opened with someone else', () => {
        const ctx = newReceiverCtx('helper', [], want);
        expect(runReceiver(ctx, [frame(1, { partner: 'stranger', theirOffer: [ORE] })])).toEqual(['decline']);
    });

    test('the offer-to-confirm close blip does not count as done or closed', () => {
        const ctx = newReceiverCtx('helper', [], want);
        expect(runReceiver(ctx, [
            frame(1, { theirOffer: [ORE] }),
            frame(2, null), // transient closed frame
            frame(3, { screen: 'confirm', theirOffer: [ORE] }),
            frame(4, null, [inv(0, 441, 'Iron ore', 10)]),
        ])).toEqual(['accept', 'wait', 'accept', 'done']);
    });

    test('closed without the items is final after 2 ticks', () => {
        const ctx = newReceiverCtx('helper', [], want);
        expect(runReceiver(ctx, [
            frame(1, { theirOffer: [ORE] }),
            frame(2, null),
            frame(3, null),
            frame(4, null),
        ])).toEqual(['accept', 'wait', 'wait', 'closed']);
    });

    test('done needs the confirmed items in the inventory delta', () => {
        const ctx = newReceiverCtx('helper', [inv(0, 441, 'Iron ore', 3)], want);
        const actions = runReceiver(ctx, [
            frame(1, { theirOffer: [ORE] }),
            frame(2, { screen: 'confirm', theirOffer: [ORE] }),
            frame(3, null, [inv(0, 441, 'Iron ore', 3)]), // closed, not yet arrived
            frame(4, null, [inv(0, 441, 'Iron ore', 13)]),
        ]);
        expect(actions).toEqual(['accept', 'accept', 'wait', 'done']);
    });
});

describe('decideGiver', () => {
    const items = [inv(0, 441, 'Iron ore', 1), inv(1, 441, 'Iron ore', 1), inv(2, 995, 'Coins', 100)];
    const mk = (): GiverCtx => newGiverCtx('receiver', items, planOffers(items, 'all'));
    const mine = [ti(441, 'Iron ore', 2), ti(995, 'Coins', 100)];

    function runGiver(ctx: GiverCtx, frames: BotWorldState[]): string[] {
        const out: string[] = [];
        for (const f of frames) {
            const d = decideGiver(f, ctx);
            ctx = d.next;
            out.push(d.action);
        }
        return out;
    }

    test('bursts on first sight of the offer screen, then accepts the confirm screen', () => {
        expect(runGiver(mk(), [
            frame(1, { partner: 'receiver' }, items),
            frame(2, { partner: 'receiver', myOffer: mine, myAccepted: true }, []),
            frame(3, { partner: 'receiver', screen: 'confirm', myOffer: mine }, []),
            frame(4, null, []),
        ])).toEqual(['burst', 'wait', 'accept', 'done']);
    });

    test('re-accepts once per tick after a reset, only with a complete offer', () => {
        expect(runGiver(mk(), [
            frame(1, { partner: 'receiver' }, items),
            frame(2, { partner: 'receiver', myOffer: [mine[0]!] }), // half landed
            frame(3, { partner: 'receiver', myOffer: mine }), // accept was reset
            frame(3, { partner: 'receiver', myOffer: mine }),
            frame(4, { partner: 'receiver', myOffer: mine, myAccepted: true }),
        ])).toEqual(['burst', 'wait', 'accept', 'wait', 'wait']);
    });

    test('declines when the partner puts something up we did not expect', () => {
        expect(runGiver(mk(), [
            frame(1, { partner: 'receiver' }, items),
            frame(2, { partner: 'receiver', screen: 'confirm', myOffer: mine, theirOffer: [ti(1, 'Junk', 1)] }),
        ])).toEqual(['burst', 'decline']);
    });

    test('declines when our confirm offer differs from the plan', () => {
        expect(runGiver(mk(), [
            frame(1, { partner: 'receiver' }, items),
            frame(2, { partner: 'receiver', screen: 'confirm', myOffer: [mine[1]!] }),
        ])).toEqual(['burst', 'decline']);
    });
});

// The confirm accept that completes a trade runs [if_close,tradeconfirm], whose
// inv_stoptransmit packets go out mid-tick, ahead of the tick's inventory update
// and close. One published state then shows the confirm screen open with both
// lists empty and the inventory unchanged. On the demo (2026-10-21 16:04 UTC)
// cairn_h30's give() declined on that state and reported a trade that completed.
describe('trade completion race: cairn_h30 gives cairn_h71 a talisman and 200 noted essence', () => {
    const kit = [inv(0, 1438, 'Air talisman', 1), inv(1, 1437, 'Rune essence', 200)];
    const offer = [ti(1438, 'Air talisman', 1), ti(1437, 'Rune essence', 200)];
    const specs = [{ item: 'Air talisman', n: 1 }, { item: 'Rune essence', n: 200 }];
    const giverCtx = (): GiverCtx => newGiverCtx('cairn_h71', kit, planOffers(kit, specs));
    const toH71 = (t: Partial<TradeState>) => ({ partner: 'cairn_h71', ...t });
    const fromH30 = (t: Partial<TradeState>) => ({ partner: 'cairn_h30', ...t });

    function decisions<C>(decide: (s: BotWorldState, c: C) => { next: C; action: string }, ctx: C, frames: BotWorldState[]) {
        return frames.map(f => {
            const d = decide(f, ctx);
            ctx = d.next;
            return d;
        });
    }

    // While offered, the giver's items sit in the trade, not its inventory.
    const giverFrames = (completion: Partial<TradeState>) => [
        frame(1, toH71({}), kit),
        frame(2, toH71({ myOffer: offer, myAccepted: true }), []),
        frame(3, toH71({ screen: 'confirm', myOffer: offer }), []),
        frame(4, toH71({ screen: 'confirm', ...completion }), []),
        frame(5, null, []),
    ];

    test('giver: the emptied confirm screen is waited out, and the close shows the items gone', () => {
        expect(decisions(decideGiver, giverCtx(), giverFrames({ myOffer: [], theirOffer: [] })).map(d => d.action))
            .toEqual(['burst', 'wait', 'accept', 'wait', 'done']);
    });

    // The server's "Accepted trade.", sent to both players as the items swap.
    const accepted = (tick: number): GameMessage => ({ type: 0, text: 'Accepted trade.', sender: '', tick, fromSelf: false });
    const said = (f: BotWorldState, ...messages: GameMessage[]): BotWorldState => ({ ...f, gameMessages: messages });

    // The browser client's sendDeclineTrade closes the modal locally, so a giver
    // that declined is shown the trade closed with its offered items still out of
    // the inventory, before the server has said how the trade ended.
    test('giver: a late decline is not settled by the local close; the server\'s "Accepted trade." settles it', () => {
        const ds = decisions(decideGiver, giverCtx(), [
            ...giverFrames({ myOffer: [offer[1]!] }), // decline at 4, local close at 5
            said(frame(6, null, []), accepted(5)),
        ]);
        expect(ds.map(d => d.action)).toEqual(['burst', 'wait', 'accept', 'decline', 'wait', 'done']);
        expect(ds[3]).toMatchObject({ reason: 'my confirm offer is not what was planned', settle: true });
    });

    test('giver: a late decline closed locally before the refund is a failure once the items come back', () => {
        // "Accepted trade." from an earlier trade is still in the chat history.
        const stale = accepted(0);
        const ds = decisions(decideGiver, giverCtx(), [
            frame(1, toH71({}), kit),
            frame(2, toH71({ screen: 'confirm', myOffer: offer }), []),
            frame(3, toH71({ screen: 'confirm', myOffer: [offer[1]!] }), []),
            frame(4, toH71({ screen: 'confirm', myOffer: [offer[1]!] }), []),
            frame(5, toH71({ screen: 'confirm', myOffer: [offer[1]!] }), []),
            frame(6, toH71({ screen: 'confirm', myOffer: [offer[1]!] }), []), // still open: decline again
            frame(7, null, []), // the browser's local close
            frame(8, null, []),
            frame(9, null, kit), // the server's refund
        ].map(f => said(f, stale)));
        expect(ds.map(d => d.action)).toEqual(['burst', 'accept', 'decline', 'wait', 'wait', 'decline', 'wait', 'wait', 'closed']);
        expect(ds[8]).toMatchObject({ reason: 'my confirm offer is not what was planned' });
    });

    test('giver: a late decline with no word from the server fails as unsettled, never as given', () => {
        const closed = Array.from({ length: SETTLE_TICKS + 1 }, (_, i) => frame(5 + i, null, []));
        const ds = decisions(decideGiver, giverCtx(), [...giverFrames({ myOffer: [offer[1]!] }).slice(0, 4), ...closed]);
        expect(ds.slice(4, -1).every(d => d.action === 'wait')).toBe(true);
        expect(ds.at(-1)).toMatchObject({ action: 'closed', reason: 'no settlement seen after declining: my confirm offer is not what was planned' });
    });

    test('giver: a decline before our confirm accept is final', () => {
        const ds = decisions(decideGiver, giverCtx(), [
            frame(1, toH71({}), kit),
            frame(2, toH71({ screen: 'confirm', myOffer: [offer[1]!] }), []),
        ]);
        expect(ds[1]).toMatchObject({ action: 'decline', settle: false });
    });

    test('receiver: the emptied confirm screen is waited out, and the close shows the items arrived', () => {
        expect(decisions(decideReceiver, newReceiverCtx('cairn_h30', []), [
            frame(1, fromH30({ theirOffer: offer, partnerAccepted: true })),
            frame(2, fromH30({ screen: 'confirm', theirOffer: offer })),
            frame(3, fromH30({ screen: 'confirm', theirOffer: [] })),
            frame(4, null, kit),
        ]).map(d => d.action)).toEqual(['accept', 'accept', 'wait', 'done']);
    });

    test('receiver: a decline after our confirm accept settles on the inventory', () => {
        const ds = decisions(decideReceiver, newReceiverCtx('cairn_h30', []), [
            frame(1, fromH30({ theirOffer: offer, partnerAccepted: true })),
            frame(2, fromH30({ screen: 'confirm', theirOffer: offer })),
            frame(3, fromH30({ screen: 'confirm', theirOffer: [offer[0]!] })),
            frame(4, null, kit),
        ]);
        expect(ds.map(d => d.action)).toEqual(['accept', 'accept', 'decline', 'done']);
        expect(ds[2]).toMatchObject({ settle: true });
    });

    test('receiver: after a late decline, "Accepted trade." waits longer for the items but never stands in for them', () => {
        const late = [
            frame(1, fromH30({ theirOffer: offer, partnerAccepted: true })),
            frame(2, fromH30({ screen: 'confirm', theirOffer: offer })),
            frame(3, fromH30({ screen: 'confirm', theirOffer: [offer[0]!] })),
        ];
        const closed = (n: number) => Array.from({ length: n }, (_, i) => said(frame(4 + i, null), accepted(3)));
        const arrives = decisions(decideReceiver, newReceiverCtx('cairn_h30', []), [...late, ...closed(4), frame(8, null, kit)]);
        expect(arrives.map(d => d.action)).toEqual(['accept', 'accept', 'decline', 'wait', 'wait', 'wait', 'wait', 'done']);
        const never = decisions(decideReceiver, newReceiverCtx('cairn_h30', []), [...late, ...closed(SETTLE_TICKS + 1)]);
        expect(never.at(-1)).toMatchObject({ action: 'closed', reason: 'confirm screen offer does not match' });
        expect(never.slice(3, -1).every(d => d.action === 'wait')).toBe(true);
    });

    // FakeSdk.push merges into the last state; a closed frame has to clear `trade`.
    const show = (sdk: FakeSdk, f: BotWorldState) => sdk.push({ ...f, trade: f.trade });

    test('give() reports the completed trade as given, without declining', async () => {
        const sdk = new FakeSdk(frame(1, toH71({}), kit));
        const result = give(sdk as unknown as TradeSdk, 'cairn_h71', specs);
        await flush();
        for (const f of giverFrames({ myOffer: [], theirOffer: [] }).slice(1)) show(sdk, f);
        const r = await result;
        expect(r.ok).toBe(true);
        expect(r.gave.map(i => [i.id, i.count]).sort()).toEqual([[1437, 200], [1438, 1]]);
        expect(sdk.sent.map(a => a.method)).not.toContain('sendDeclineTrade');
    });

    // As in the browser client: the decline closes the trade at once, locally.
    function closeLocallyOnDecline(sdk: FakeSdk) {
        sdk.onSend = a => {
            if (a.method === 'sendDeclineTrade') queueMicrotask(() => show(sdk, frame(sdk.getState()!.tick, null, [])));
        };
    }

    test('give() does not report a late decline as given when the local close comes before the refund', async () => {
        const sdk = new FakeSdk(frame(1, toH71({}), kit));
        closeLocallyOnDecline(sdk);
        const result = give(sdk as unknown as TradeSdk, 'cairn_h71', specs);
        await flush();
        show(sdk, frame(2, toH71({ screen: 'confirm', myOffer: offer }), []));
        show(sdk, frame(3, toH71({ screen: 'confirm', myOffer: [offer[1]!] }), []));
        await flush();
        expect(sdk.getState()!.trade).toBeUndefined();
        show(sdk, frame(4, null, []));
        show(sdk, frame(5, null, kit));
        const r = await result;
        expect(r).toMatchObject({ ok: false, gave: [], reason: 'my confirm offer is not what was planned' });
    });

    test('give() reports a late decline as given once the server says "Accepted trade."', async () => {
        const sdk = new FakeSdk(frame(1, toH71({}), kit));
        closeLocallyOnDecline(sdk);
        const result = give(sdk as unknown as TradeSdk, 'cairn_h71', specs);
        await flush();
        show(sdk, frame(2, toH71({ screen: 'confirm', myOffer: offer }), []));
        show(sdk, frame(3, toH71({ screen: 'confirm', myOffer: [offer[1]!] }), []));
        await flush();
        show(sdk, said(frame(4, null, []), accepted(3)));
        const r = await result;
        expect(r.ok).toBe(true);
        expect(r.reason).toBe('completed as the decline landed: my confirm offer is not what was planned');
        expect(r.gave.map(i => [i.id, i.count]).sort()).toEqual([[1437, 200], [1438, 1]]);
    });

    test('openTrade (via receiveFrom) re-sends a refused request on the frame that shows the refusal, not 8 s later', async () => {
        const near = { nearbyPlayers: [{ index: 7, name: 'cairn_h30', combatLevel: 3, x: 0, z: 0, distance: 1 }] } as unknown as Partial<BotWorldState>;
        const sdk = new FakeSdk(baseState({ tick: 1, ...near }));
        const t0 = Date.now();
        const result = receiveFrom(sdk as unknown as TradeSdk, 'cairn_h30', { maxTicks: 5 });
        await flush();
        expect(sdk.sent.filter(a => a.method === 'sendTradeRequest')).toHaveLength(1);
        sdk.push({ tick: 2, gameMessages: [{ type: 0, text: 'Cairn_h30 is busy at the moment.', sender: '', tick: 2, fromSelf: false }] });
        await flush();
        expect(sdk.sent.filter(a => a.method === 'sendTradeRequest')).toHaveLength(2);
        // the same refusal on the next frame is not a second refusal
        sdk.push({ tick: 3 });
        await flush();
        expect(sdk.sent.filter(a => a.method === 'sendTradeRequest')).toHaveLength(2);
        sdk.push({ tick: 4, trade: { isOpen: true, screen: 'offer', partner: 'cairn_h30', myOffer: [], theirOffer: [], myAccepted: false, partnerAccepted: false } });
        await flush();
        sdk.push({ tick: 20, trade: undefined });
        await result;
        expect(Date.now() - t0).toBeLessThan(2_000);
    });

    const nearH30 = { nearbyPlayers: [{ index: 7, name: 'cairn_h30', combatLevel: 3, x: 0, z: 0, distance: 1 }] } as unknown as Partial<BotWorldState>;
    const openWithH30 = { isOpen: true, screen: 'offer' as const, partner: 'cairn_h30', myOffer: [], theirOffer: [], myAccepted: false, partnerAccepted: false };
    const sending = (tick: number): GameMessage => ({ type: 0, text: 'Sending trade offer...', sender: '', tick, fromSelf: false });
    const requests = (sdk: FakeSdk) => sdk.sent.filter(a => a.method === 'sendTradeRequest').length;

    test('openTrade re-sends a request the engine dropped (sent while delayed) on the second frame without an answer, not 8 s later', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1, ...nearH30 }));
        const t0 = Date.now();
        const result = receiveFrom(sdk as unknown as TradeSdk, 'cairn_h30', { maxTicks: 5 });
        await flush();
        expect(requests(sdk)).toBe(1);
        // the click lands on 2 while we are delayed: no word from the engine; frame 2 may still be early for it
        sdk.push({ tick: 2 });
        await flush();
        expect(requests(sdk)).toBe(1);
        sdk.push({ tick: 3 });
        await flush();
        expect(requests(sdk)).toBe(2);
        // this one is processed ("Sending trade offer..."): it stands, and is not re-sent
        sdk.push({ tick: 4, gameMessages: [sending(4)] });
        sdk.push({ tick: 5 });
        sdk.push({ tick: 6 });
        await flush();
        expect(requests(sdk)).toBe(2);
        sdk.push({ tick: 7, trade: openWithH30 });
        await flush();
        sdk.push({ tick: 20, trade: undefined });
        await result;
        expect(Date.now() - t0).toBeLessThan(2_000);
    });

    test('openTrade does not re-send a request answered on its landing frame, nor count an older answer as this one', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1, ...nearH30, gameMessages: [sending(1)] }));
        const result = receiveFrom(sdk as unknown as TradeSdk, 'cairn_h30', { maxTicks: 5 });
        await flush();
        // the previous click's "Sending trade offer..." (tick 1) does not answer this one
        sdk.push({ tick: 2 });
        sdk.push({ tick: 3 });
        await flush();
        expect(requests(sdk)).toBe(2);
        // answered on its landing frame (4): standing, not re-sent
        sdk.push({ tick: 4, gameMessages: [sending(1), sending(4)] });
        sdk.push({ tick: 5 });
        sdk.push({ tick: 6 });
        await flush();
        expect(requests(sdk)).toBe(2);
        sdk.push({ tick: 6, trade: openWithH30 });
        await flush();
        sdk.push({ tick: 20, trade: undefined });
        await result;
    });

    test('receiveFrom() reports a trade that completed as its decline landed as received', async () => {
        const sdk = new FakeSdk(frame(1, fromH30({ theirOffer: offer, partnerAccepted: true })));
        const result = receiveFrom(sdk as unknown as TradeSdk, 'cairn_h30');
        await flush();
        show(sdk, frame(2, fromH30({ screen: 'confirm', theirOffer: offer })));
        show(sdk, frame(3, fromH30({ screen: 'confirm', theirOffer: [offer[0]!] })));
        show(sdk, frame(4, null, kit));
        const r = await result;
        expect(r.ok).toBe(true);
        expect(r.reason).toBe('completed as the decline landed: confirm screen offer does not match');
        expect(r.received.map(i => [i.id, i.count]).sort()).toEqual([[1437, 200], [1438, 1]]);
        expect(sdk.sent.map(a => a.method)).toContain('sendDeclineTrade');
    });
});

describe('planOffers', () => {
    test('one entry per distinct id; All unless a count is asked for; X last', () => {
        const items = [inv(0, 1, 'A', 1), inv(1, 1, 'A', 1), inv(2, 2, 'B', 100), inv(3, 3, 'C', 50)];
        expect(planOffers(items, 'all').map(e => [e.slot, e.amounts, e.expected])).toEqual([
            [0, [-1], 2],
            [2, [-1], 100],
            [3, [-1], 50],
        ]);
        expect(planOffers(items, [{ item: 'C', n: 28 }, { item: 'B', n: 15 }]).map(e => [e.name, e.amounts])).toEqual([
            ['B', [10, 5]],
            ['C', [28]],
        ]);
    });

    test('an unstackable item (one per slot) gets a single press, never 10 then 5 on the same slot', () => {
        const bones = Array.from({ length: 20 }, (_, s) => inv(s, 536, 'Dragon bones', 1));
        const items = [...bones, inv(20, 385, 'Shark', 1), inv(21, 385, 'Shark', 1), inv(22, 995, 'Coins', 100)];
        expect(planOffers(items, [{ item: 'Dragon bones', n: 15 }, { item: 'Shark', n: 1 }, { item: 'Coins', n: 15 }]).map(e => [e.name, e.amounts, e.expected])).toEqual([
            ['Shark', [1], 1],
            ['Coins', [10, 5], 15],
            ['Dragon bones', [15], 15],
        ]);
        expect(planOffers(items, [{ item: 'Dragon bones', n: 10 }]).map(e => e.amounts)).toEqual([[10]]);
        expect(planOffers(items, [{ item: 'Dragon bones', n: 20 }]).map(e => e.amounts)).toEqual([[-1]]);
    });
});

test('sameName ignores case and space/underscore differences', () => {
    expect(sameName('Sr Lab_2', 'sr_lab 2')).toBe(true);
    expect(sameName('srlab1', 'srlab2')).toBe(false);
});
