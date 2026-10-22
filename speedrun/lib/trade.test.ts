import { describe, expect, test } from 'bun:test';
import type { BotWorldState, GameMessage, InventoryItem, TradeItem, TradeState } from '../../sdk/types';
import { baseState, FakeSdk, flush } from './fake-sdk';
import { fakeClock, microtasks, peek, tickEvery, useFakeTicks } from './fake-ticks';
import { IDLE_TICKS, STALLED } from './wait';
import { offerSatisfies as sdkOfferSatisfies } from '../../sdk/trade-helpers';
import { clickBack, decideGiver, decideReceiver, decideTradeClick, give, newClickCtx, newGiverCtx, newReceiverCtx, DROPPED_TICKS, offerSatisfies, OPEN_MAX_TICKS, openBackstopMs, openTrade, planOffers, receiveFrom, RESEND_TICKS, sameName, SETTLE_TICKS, type ClickCtx, type GiverCtx, type ReceiverCtx, type TradeSdk, type WantSpec } from './trade';
import type { SentAction } from './fake-sdk';

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

    test('openTrade with noReplyTicks re-sends a request the engine dropped (sent while delayed) on the second frame without an answer, not 8 s later', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1, ...nearH30 }));
        const t0 = Date.now();
        const result = receiveFrom(sdk as unknown as TradeSdk, 'cairn_h30', { maxTicks: 5, noReplyTicks: DROPPED_TICKS });
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

    test('give with resendTicks Infinity never re-sends a standing request (the wine giver: 27 ticks would miss login + 19)', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1, ...nearH30, inventory: [inv(0, 1996, 'Unfermented wine', 520)] }));
        const result = give(sdk as unknown as TradeSdk, 'cairn_h30', [{ item: 1996, n: 'all' }], { openMaxTicks: 40, noReplyTicks: DROPPED_TICKS, resendTicks: Infinity });
        await flush();
        expect(requests(sdk)).toBe(1);
        sdk.push({ tick: 2, gameMessages: [sending(2)] });
        for (let t = 3; t <= 35; t++) sdk.push({ tick: t });
        await flush();
        expect(requests(sdk)).toBe(1);
        for (let t = 36; t <= 45; t++) sdk.push({ tick: t });
        expect((await result).ok).toBe(false);
    });

    test('openTrade does not re-send a request answered on its landing frame, nor count an older answer as this one', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1, ...nearH30, gameMessages: [sending(1)] }));
        const result = receiveFrom(sdk as unknown as TradeSdk, 'cairn_h30', { maxTicks: 5, noReplyTicks: DROPPED_TICKS });
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

    describe('openTrade counts observed ticks (fake timers, 300 ms nominal)', () => {
        useFakeTicks(300);

        test('maxTicks 30 opens a trade answered on tick 29 at 340 ms a tick (9.9 s, past a 30 x 300 ms wall bound)', async () => {
            const sdk = new FakeSdk(baseState({ tick: 0, ...nearH30 }));
            const result = openTrade(sdk as unknown as TradeSdk, 'cairn_h30', { maxTicks: 30 });
            await microtasks();
            for (let i = 0; i < 28; i++) {
                tickEvery(sdk, 340, 1);
                await microtasks();
            }
            fakeClock.advanceTimersByTime(340);
            sdk.tick({ trade: openWithH30 });
            expect(await result).toMatchObject({ ok: true, firstClickTick: 0 });
        });

        test('maxTicks 30 gives up after 30 observed ticks, however slowly they come, and not before', async () => {
            const sdk = new FakeSdk(baseState({ tick: 0, ...nearH30 }));
            const result = openTrade(sdk as unknown as TradeSdk, 'cairn_h30', { maxTicks: 30 });
            await microtasks();
            for (let i = 0; i < 30; i++) {
                tickEvery(sdk, 500, 1);
                await microtasks();
            }
            expect(await peek(result)).toBeUndefined();
            tickEvery(sdk, 500, 1);
            expect(await result).toMatchObject({ ok: false, reason: 'no_response' });
        });
    });

    for (const ms of [300, 400]) {
        describe(`the default open counts OPEN_MAX_TICKS observed ticks at ${ms} ms a tick`, () => {
            useFakeTicks(ms);

            test('openTrade with no bounds gives up after OPEN_MAX_TICKS ticks, and not before, at a tick 25% slower than nominal', async () => {
                const sdk = new FakeSdk(baseState({ tick: 0, ...nearH30 }));
                const result = openTrade(sdk as unknown as TradeSdk, 'cairn_h30');
                await microtasks();
                for (let i = 0; i < OPEN_MAX_TICKS; i++) {
                    tickEvery(sdk, ms * 1.25, 1);
                    await microtasks();
                }
                expect(await peek(result)).toBeUndefined();
                tickEvery(sdk, ms * 1.25, 1);
                expect(await result).toMatchObject({ ok: false, reason: 'no_response' });
            });

            test('receiveFrom inherits it: open on tick OPEN_MAX_TICKS - 1', async () => {
                const sdk = new FakeSdk(baseState({ tick: 0, ...nearH30 }));
                const result = receiveFrom(sdk as unknown as TradeSdk, 'cairn_h30');
                await microtasks();
                for (let i = 0; i < OPEN_MAX_TICKS - 2; i++) {
                    tickEvery(sdk, ms, 1);
                    await microtasks();
                }
                fakeClock.advanceTimersByTime(ms);
                sdk.tick({ trade: openWithH30 });
                await microtasks();
                expect(await peek(result)).toBeUndefined(); // open: now trading, not given up
            });

            test('the wall backstop is 2 x OPEN_MAX_TICKS ticks of nominal time', () => {
                expect(openBackstopMs(OPEN_MAX_TICKS)).toBe(2 * OPEN_MAX_TICKS * ms);
                expect(openBackstopMs(Infinity)).toBe(Infinity);
            });
        });
    }

    describe('a request the engine drops while we are delayed (a stun\'s p_delay)', () => {
        const near = { nearbyPlayers: [{ index: 7, name: 'cairn_h30', combatLevel: 3, x: 0, z: 0, distance: 1 }] } as unknown as Partial<BotWorldState>;
        const requests = (sdk: FakeSdk) => sdk.sent.filter(a => a.method === 'sendTradeRequest').length;
        const sent = (tick: number): Partial<BotWorldState> => ({ tick, gameMessages: [{ type: 0, text: 'Sending trade offer...', sender: '', tick, fromSelf: false }] });
        const openAt = (tick: number): Partial<BotWorldState> => ({ tick, trade: { isOpen: true, screen: 'offer', partner: 'cairn_h30', myOffer: [], theirOffer: [], myAccepted: false, partnerAccepted: false } });

        test('noReplyTicks re-sends a request that drew no message, and the re-sent one opens the trade', async () => {
            const sdk = new FakeSdk(baseState({ tick: 10, ...near }));
            const result = receiveFrom(sdk as unknown as TradeSdk, 'cairn_h30', { noReplyTicks: 2, openMaxTicks: 9, maxTicks: 9 });
            await flush();
            expect(requests(sdk)).toBe(1);
            sdk.push({ tick: 11 });
            await flush();
            expect(requests(sdk)).toBe(1);
            sdk.push({ tick: 12 });
            await flush();
            expect(requests(sdk)).toBe(2);
            sdk.push(sent(13));
            await flush();
            sdk.push({ tick: 14 });
            sdk.push({ tick: 15 });
            await flush();
            expect(requests(sdk)).toBe(2);
            sdk.push(openAt(16));
            await flush();
            for (let t = 17; t <= 19; t++) sdk.push({ tick: t, trade: undefined });
            const t0 = Date.now();
            const r = await result;
            expect(r.ok).toBe(false);
            expect(r.reason).toBe('closed without the items arriving');
            expect(Date.now() - t0).toBeLessThan(1_000);
            expect(requests(sdk)).toBe(2);
        });

        test('a request the engine acknowledged is not re-sent by noReplyTicks', async () => {
            const sdk = new FakeSdk(baseState({ tick: 10, ...near }));
            const result = receiveFrom(sdk as unknown as TradeSdk, 'cairn_h30', { noReplyTicks: 2, openMaxTicks: 6 });
            await flush();
            sdk.push(sent(11));
            for (let t = 12; t <= 16; t++) sdk.push({ tick: t });
            await flush();
            expect(requests(sdk)).toBe(1);
            sdk.push({ tick: 17 });
            const r = await result;
            expect(r.ok).toBe(false);
            expect(r.reason).toBe('no_response');
        });

        test('openMaxTicks ends the open on game ticks, not on the wall clock', async () => {
            const sdk = new FakeSdk(baseState({ tick: 10, ...near }));
            const t0 = Date.now();
            const result = receiveFrom(sdk as unknown as TradeSdk, 'cairn_h30', { noReplyTicks: 2, openMaxTicks: 4, openTimeoutMs: 60_000 });
            for (let t = 11; t <= 15; t++) {
                await flush();
                sdk.push({ tick: t });
            }
            const r = await result;
            expect(r).toMatchObject({ ok: false, reason: 'no_response' });
            expect(requests(sdk)).toBe(3);
            expect(Date.now() - t0).toBeLessThan(2_000);
        });

        test('stopIf ends an unanswered open on the frame it fires, with no further request', async () => {
            const sdk = new FakeSdk(baseState({ tick: 10, ...near, inventory: [inv(0, 1351, 'Bronze axe')] }));
            const t0 = Date.now();
            const result = give(sdk as unknown as TradeSdk, 'cairn_h30', [{ item: /^bronze axe$/i, n: 1 }], { openTimeoutMs: 60_000, stopIf: s => (s.tick >= 12 ? 'hit' : null) });
            for (let t = 11; t <= 12; t++) {
                await flush();
                sdk.push({ tick: t });
            }
            const r = await result;
            expect(r).toMatchObject({ ok: false, reason: 'stopped: hit' });
            expect(requests(sdk)).toBe(1);
            expect(Date.now() - t0).toBeLessThan(2_000);
        });

        test('stopIf with the trade open declines it', async () => {
            const sdk = new FakeSdk(baseState({ tick: 10, ...near, inventory: [inv(0, 1351, 'Bronze axe')] }));
            const result = give(sdk as unknown as TradeSdk, 'cairn_h30', [{ item: /^bronze axe$/i, n: 1 }], { stopIf: s => (s.tick >= 12 ? 'hit' : null) });
            await flush();
            sdk.push(openAt(11));
            await flush();
            sdk.push({ tick: 12 });
            const r = await result;
            expect(r).toMatchObject({ ok: false, reason: 'stopped: hit' });
            expect(sdk.sent.some(a => a.method === 'sendDeclineTrade')).toBe(true);
        });

        test('default-identical: without noReplyTicks an unanswered request is not re-sent within 8 s', async () => {
            const sdk = new FakeSdk(baseState({ tick: 10, ...near }));
            const result = receiveFrom(sdk as unknown as TradeSdk, 'cairn_h30', { maxTicks: 5 });
            for (let t = 11; t <= 20; t++) {
                await flush();
                sdk.push({ tick: t });
            }
            await flush();
            expect(requests(sdk)).toBe(1);
            sdk.push(openAt(21));
            await flush();
            sdk.push({ tick: 30, trade: undefined });
            await result;
            expect(requests(sdk)).toBe(1);
        });
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

    describe('on a slow minute (fake timers)', () => {
        useFakeTicks();
        const slowly = (sdk: FakeSdk, f: BotWorldState) => {
            fakeClock.advanceTimersByTime(340);
            show(sdk, f);
        };

        test('receiveFrom() receives a trade completing on tick 98 at 340 ms a tick (33.3 s, past the old 33 s budget)', async () => {
            const sdk = new FakeSdk(frame(0, fromH30({})));
            const result = receiveFrom(sdk as unknown as TradeSdk, 'cairn_h30');
            await microtasks();
            tickEvery(sdk, 340, 95); // the partner takes its time; our offer screen stays empty
            slowly(sdk, frame(96, fromH30({ theirOffer: offer, partnerAccepted: true })));
            slowly(sdk, frame(97, fromH30({ screen: 'confirm', theirOffer: offer })));
            slowly(sdk, frame(98, null, kit));
            const r = await result;
            expect(r).toMatchObject({ ok: true, ticks: 98 });
            expect(r.received.map(i => [i.id, i.count]).sort()).toEqual([[1437, 200], [1438, 1]]);
        });

        test('a client that stops publishing mid-trade ends it as STALLED', async () => {
            const sdk = new FakeSdk(frame(0, fromH30({})));
            const result = receiveFrom(sdk as unknown as TradeSdk, 'cairn_h30');
            await microtasks();
            tickEvery(sdk, 300, 5);
            fakeClock.advanceTimersByTime(IDLE_TICKS * 300 - 1);
            expect(await peek(result)).toBeUndefined();
            fakeClock.advanceTimersByTime(1);
            expect(await result).toMatchObject({ ok: false, ticks: 5, received: [], reason: STALLED });
        });
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

// ---------------------------------------------------------------- the one click rule

describe('decideTradeClick: when a trade click may go out', () => {
    const m = (tick: number, text: string): GameMessage => ({ type: 0, text, sender: '', tick, fromSelf: false });
    const BUSY = 'Cairnsup is busy at the moment.';
    const SENT = 'Sending trade offer...';
    const beside = { noReplyTicks: DROPPED_TICKS };
    const f = (tick: number, messages: GameMessage[] = [], open = false) =>
        baseState({ tick, gameMessages: messages, ...(open ? { trade: { isOpen: true, screen: 'offer' as const, partner: 'x', myOffer: [], theirOffer: [], myAccepted: false, partnerAccepted: false } } : {}) });
    /** Frames through the rule; each click's action result comes back on `back(sentTick)` (default: at once). */
    function run(frames: BotWorldState[], back: (sent: number) => number = s => s, rule = {}): { actions: string[]; ctx: ClickCtx } {
        let ctx = newClickCtx();
        const actions: string[] = [];
        const pending: number[] = [];
        for (const fr of frames) {
            for (const sent of [...pending]) if (back(sent) <= fr.tick) { ctx = clickBack(ctx, sent, back(sent)); pending.splice(pending.indexOf(sent), 1); }
            const d = decideTradeClick(fr, ctx, rule);
            ctx = d.next;
            actions.push(d.action === 'send' ? `send:${d.why}` : d.action);
            if (d.action === 'send') {
                if (back(ctx.sentTick) <= fr.tick) ctx = clickBack(ctx, ctx.sentTick, fr.tick);
                else pending.push(ctx.sentTick);
            }
        }
        return { actions, ctx };
    }

    test('sends once, holds once it stood, opens when the partner clicks', () => {
        const r = run([f(10), f(10), f(11, [m(11, SENT)]), f(12, [m(11, SENT)]), f(36, [m(11, SENT)]), f(37, [m(11, SENT)], true)]);
        expect(r.actions).toEqual(['send:first', 'wait', 'wait', 'wait', 'wait', 'open']);
        expect(r.ctx).toMatchObject({ sends: 1, bounces: 0 });
    });

    test('a busy refusal is re-sent on the frame that shows it; an older refusal does not count against a newer click', () => {
        const r = run([f(10), f(11, [m(11, BUSY)]), f(12, [m(11, BUSY), m(12, BUSY)]), f(13, [m(12, BUSY), m(13, SENT)]), f(14, [m(13, SENT)])]);
        expect(r.actions).toEqual(['send:first', 'send:busy', 'send:busy', 'wait', 'wait']);
        expect(r.ctx).toMatchObject({ sends: 3, bounces: 2, sentTick: 12 });
        expect(run([f(10), f(11, [m(11, BUSY)]), f(12, [m(11, BUSY)])]).actions).toEqual(['send:first', 'send:busy', 'wait']);
    });

    test('player chat that happens to match is not an answer', () => {
        const chat: GameMessage = { type: 2, text: 'Sending trade offer...?', sender: 'someone', tick: 11, fromSelf: false };
        expect(run([f(10), f(11, [chat]), f(12, [chat])], s => s, beside).actions).toEqual(['send:first', 'wait', 'send:dropped']);
    });

    test(`beside the partner (noReplyTicks DROPPED_TICKS), a dropped click is re-sent ${DROPPED_TICKS} frames after its result came back`, () => {
        expect(run([f(10), f(11), f(12), f(13)], s => s, beside).actions).toEqual(['send:first', 'wait', 'send:dropped', 'wait']);
        expect(run([f(10), f(11), f(12), f(13)], s => s, { noReplyTicks: 3 }).actions).toEqual(['send:first', 'wait', 'wait', 'send:dropped']);
    });

    test('a relay-held click: nothing more while its result is pending (20 ticks), then its "sent" stands', () => {
        const frames = Array.from({ length: 22 }, (_, i) => f(10 + i));
        frames.push(f(32, [m(31, SENT)]), f(33, [m(31, SENT)]), f(34, [m(31, SENT)], true));
        const r = run(frames, s => (s === 10 ? 30 : s));
        expect(r.actions[0]).toBe('send:first');
        expect(r.actions.filter(a => a.startsWith('send'))).toEqual(['send:first']);
        expect(r.actions.at(-1)).toBe('open');
    });

    test('silence after a relay-held result counts from its return, not from the send', () => {
        // result back on 30; no reply on 31; dropped on 32, not on 12
        const r = run(Array.from({ length: 24 }, (_, i) => f(10 + i)), s => (s === 10 ? 30 : s), beside);
        expect(r.actions.indexOf('send:dropped')).toBe(22);
    });

    test('by default (walk-safe: the server answers only once we are adjacent) an unanswered click waits RESEND_TICKS', () => {
        const r = run(Array.from({ length: RESEND_TICKS + 2 }, (_, i) => f(10 + i)));
        expect(r.actions.filter(a => a.startsWith('send'))).toEqual(['send:first', 'send:dropped']);
        expect(r.actions.indexOf('send:dropped')).toBe(RESEND_TICKS);
    });

    test(`a request that stood is re-sent only after RESEND_TICKS (${RESEND_TICKS}) from its result`, () => {
        const r = run([f(10), f(11, [m(11, SENT)]), f(10 + RESEND_TICKS - 1, [m(11, SENT)]), f(10 + RESEND_TICKS, [m(11, SENT)])]);
        expect(r.actions).toEqual(['send:first', 'wait', 'wait', 'send:standing']);
    });

    test('screens open: never a click', () => {
        expect(run([f(10, [], true), f(11, [], true), f(30, [], true)]).actions).toEqual(['open', 'open', 'open']);
    });
});

describe('openTrade: the one driver', () => {
    const near = { nearbyPlayers: [{ index: 7, name: 'cairn_h30', combatLevel: 3, x: 0, z: 0, distance: 1 }] } as unknown as Partial<BotWorldState>;
    const opened = { isOpen: true, screen: 'offer' as const, partner: 'cairn_h30', myOffer: [], theirOffer: [], myAccepted: false, partnerAccepted: false };
    const sentMsg = (tick: number): GameMessage => ({ type: 0, text: 'Sending trade offer...', sender: '', tick, fromSelf: false });
    const clicks = (sdk: FakeSdk) => sdk.sent.filter(a => a.method === 'sendTradeRequest').length;

    /** The demo relay: a trade click's action result comes back only when the test releases it. */
    class HeldFake extends FakeSdk {
        release: Array<() => void> = [];
        override sendAction(a: SentAction) {
            if (a.method !== 'sendTradeRequest') return super.sendAction(a);
            this.sent.push(a);
            return new Promise<{ success: boolean; message: string }>(done => this.release.push(() => done({ success: true, message: 'ok' })));
        }
    }

    test('the trade opens on the frame after the click: one click, resolved on that frame', async () => {
        const sdk = new FakeSdk(baseState({ tick: 10, ...near }));
        const p = openTrade(sdk as unknown as TradeSdk, 'cairn_h30', { maxTicks: 10 });
        await flush();
        expect(clicks(sdk)).toBe(1);
        sdk.push({ tick: 11, trade: opened, gameMessages: [sentMsg(11)] });
        const r = await p;
        expect(r).toMatchObject({ ok: true, firstClickTick: 10, openTick: 11, sends: 1, landedTick: -1 });
        sdk.push({ tick: 12, trade: opened });
        sdk.push({ tick: 13, trade: opened });
        await flush();
        expect(clicks(sdk)).toBe(1);
    });

    test('a relay-batched click: result pending for 20 ticks, then "sent": no second click before it, and the trade it opens stays open', async () => {
        const sdk = new HeldFake(baseState({ tick: 10, ...near }));
        const p = openTrade(sdk as unknown as TradeSdk, 'cairn_h30', { maxTicks: 60 });
        await flush();
        for (let tick = 11; tick <= 30; tick++) sdk.push({ tick });
        await flush();
        expect(clicks(sdk)).toBe(1);
        sdk.release.shift()!();
        await flush();
        sdk.push({ tick: 31, gameMessages: [sentMsg(31)] });
        sdk.push({ tick: 32, gameMessages: [sentMsg(31)] });
        sdk.push({ tick: 33, gameMessages: [sentMsg(31)] });
        await flush();
        expect(clicks(sdk)).toBe(1);
        sdk.push({ tick: 34, trade: opened, gameMessages: [sentMsg(31)] });
        expect(await p).toMatchObject({ ok: true, sends: 1, landedTick: 31, openTick: 34 });
    });

    test('closeModals: CLOSE_MODAL goes out with a click while a modal is open', async () => {
        const sdk = new FakeSdk(baseState({ tick: 10, ...near, modalOpen: true }));
        const p = openTrade(sdk as unknown as TradeSdk, 'cairn_h30', { maxTicks: 10, closeModals: true });
        await flush();
        expect(sdk.sent.map(a => a.method)).toEqual(['sendCloseModal', 'sendTradeRequest']);
        sdk.push({ tick: 11, trade: opened, modalOpen: false });
        expect(await p).toMatchObject({ ok: true });
    });

    test('stopped ends the open without another click', async () => {
        const sdk = new FakeSdk(baseState({ tick: 10, ...near }));
        let stop = false;
        const p = openTrade(sdk as unknown as TradeSdk, 'cairn_h30', { stopped: () => stop, timeoutMs: Infinity });
        await flush();
        stop = true;
        sdk.push({ tick: 11 });
        expect(await p).toMatchObject({ ok: false, reason: 'stopped', sends: 1 });
    });
});

describe('offerSatisfies: speedrun\'s one want rule', () => {
    // Unfinished potion: 91 the guam obj, 92 its note; the two Air rune entries one stack split in two.
    const offer: TradeItem[] = [
        { slot: 0, id: 556, name: 'Air rune', count: 300 },
        { slot: 1, id: 556, name: 'Air rune', count: 100 },
        { slot: 2, id: 91, name: 'Unfinished potion', count: 1 },
        { slot: 3, id: 92, name: 'Unfinished potion', count: 40 },
        { slot: 4, id: 2434, name: 'Prayer potion(4)', count: 2 },
    ];
    const byName: Array<[WantSpec[], boolean]> = [
        [[{ item: 'Air rune', amount: 400 }], true], // exact name, a stack split across two entries summed
        [[{ item: 'Air rune', amount: 401 }], false],
        [[{ item: 'air RUNE', amount: 400 }], true], // case-blind
        [[{ item: 'rune', amount: 400 }], true], // a substring
        [[{ item: 'Unfinished potion', amount: 41 }], true], // a noted and an unnoted stack alike
        [[{ item: /^prayer potion\(\d\)$/i, amount: 2 }], true],
        [[{ item: /^prayer potion\(\d\)$/i, amount: 3 }], false],
        [[{ item: 'Air rune', amount: 400 }, { item: 'Shark' }], false], // every want, default amount 1
        [[{ item: 'Shark', amount: 0 }], true],
        [[], true],
    ];

    test('a name want counts exactly as sdk/trade-helpers.ts offerSatisfies does', () => {
        for (const [want, expected] of byName) {
            expect([offerSatisfies(want, offer), sdkOfferSatisfies(want as Parameters<typeof sdkOfferSatisfies>[0], offer)]).toEqual([expected, expected]);
        }
        expect(offerSatisfies(undefined, [])).toBe(true);
    });

    test('an id want counts that obj only: the note and the unnoted obj are told apart', () => {
        expect(offerSatisfies([{ item: 92, amount: 40 }], offer)).toBe(true);
        expect(offerSatisfies([{ item: 92, amount: 41 }], offer)).toBe(false);
        expect(offerSatisfies([{ item: 91, amount: 1 }, { item: 556, amount: 400 }], offer)).toBe(true);
    });
});
