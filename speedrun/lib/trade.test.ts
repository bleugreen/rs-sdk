import { describe, expect, test } from 'bun:test';
import type { BotWorldState, InventoryItem, TradeItem, TradeState } from '../../sdk/types';
import { baseState } from './fake-sdk';
import { decideGiver, decideReceiver, newGiverCtx, newReceiverCtx, planOffers, sameName, type GiverCtx, type ReceiverCtx } from './trade';

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
});

test('sameName ignores case and space/underscore differences', () => {
    expect(sameName('Sr Lab_2', 'sr_lab 2')).toBe(true);
    expect(sameName('srlab1', 'srlab2')).toBe(false);
});
