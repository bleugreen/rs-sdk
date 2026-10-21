import { describe, expect, test } from 'bun:test';
import type { BotWorldState, GameMessage } from '../../sdk/types';
import { baseState } from '../lib/fake-sdk';
import { boneGiverOptions, decideRequest, newRequestCtx, S07_SITES, type RequestCtx } from './bone-giver';

const o = { noReplyTicks: 3, resendTicks: 100 };
const msg = (tick: number, text: string): GameMessage => ({ type: 0, text, sender: '', tick });
const BUSY = 'Cairnsup is busy at the moment.';
const SENT = 'Sending trade offer...';

function frame(tick: number, messages: GameMessage[] = [], open = false): BotWorldState {
    return baseState({
        tick,
        gameMessages: messages,
        ...(open ? { trade: { isOpen: true, screen: 'offer', partner: 'x', myOffer: [], theirOffer: [], myAccepted: false, partnerAccepted: false } } : {})
    } as Partial<BotWorldState>);
}

/** Feed frames through decideRequest; returns each frame's action (with why for sends). */
function run(frames: BotWorldState[], ctx: RequestCtx = newRequestCtx()): { actions: string[]; ctx: RequestCtx } {
    const actions: string[] = [];
    for (const f of frames) {
        const d = decideRequest(f, ctx, o);
        ctx = d.next;
        actions.push(d.action === 'send' ? `send:${d.why}` : d.action);
    }
    return { actions, ctx };
}

describe('decideRequest: a standing request', () => {
    test('sends once, holds once it landed, opens when the receiver clicks', () => {
        const r = run([frame(10), frame(10), frame(11, [msg(11, SENT)]), frame(12, [msg(11, SENT)]), frame(40, [msg(11, SENT)]), frame(41, [msg(11, SENT)], true)]);
        expect(r.actions).toEqual(['send:first', 'wait', 'wait', 'wait', 'wait', 'open']);
        expect(r.ctx).toMatchObject({ sends: 1, bounces: 0, landed: true });
    });

    test('a refusal is re-sent on the frame that carries it, so it lands on the very next tick', () => {
        // A level-up page holds the receiver busy for three ticks; the fourth request lands.
        const r = run([
            frame(10),
            frame(11, [msg(11, BUSY)]),
            frame(12, [msg(11, BUSY), msg(12, BUSY)]),
            frame(13, [msg(11, BUSY), msg(12, BUSY), msg(13, BUSY)]),
            frame(14, [msg(13, BUSY), msg(14, SENT)]),
            frame(15, [msg(14, SENT)])
        ]);
        expect(r.actions).toEqual(['send:first', 'send:bounce', 'send:bounce', 'send:bounce', 'wait', 'wait']);
        expect(r.ctx).toMatchObject({ sends: 4, bounces: 3, landed: true, sentTick: 13 });
    });

    test('an older refusal does not count against a newer request', () => {
        const r = run([frame(10), frame(11, [msg(11, BUSY)]), frame(12, [msg(11, BUSY)])]);
        expect(r.actions).toEqual(['send:first', 'send:bounce', 'wait']);
    });

    test('player chat that happens to match is ignored (only game messages answer)', () => {
        const chat: GameMessage = { type: 2, text: BUSY, sender: 'someone', tick: 11 };
        expect(run([frame(10), frame(11, [chat])]).actions).toEqual(['send:first', 'wait']);
    });

    test('no answer within noReplyTicks: send again', () => {
        expect(run([frame(10), frame(11), frame(12), frame(13)]).actions).toEqual(['send:first', 'wait', 'wait', 'send:no-reply']);
    });

    test('a landed request is refreshed only after resendTicks without a trade', () => {
        const r = run([frame(10), frame(11, [msg(11, SENT)]), frame(109, [msg(11, SENT)]), frame(110, [msg(11, SENT)])]);
        expect(r.actions).toEqual(['send:first', 'wait', 'wait', 'send:stale']);
    });

    test('screens already open (the receiver clicked first): straight to the trade', () => {
        expect(run([frame(10, [], true)]).actions).toEqual(['open']);
    });
});

describe('bone giver options', () => {
    test('defaults: 23 dragon bones, the S07 oak then willow sites, bank restock, until stopped', () => {
        const r = boneGiverOptions({}, { RC_CUE_DIR: '/tmp/cue' });
        expect(r).toMatchObject({ item: 'Dragon bones', n: 23, siteWaitTicks: 30, noReplyTicks: 3, resendTicks: 100, cueDir: '/tmp/cue' });
        expect(r.sites).toEqual(S07_SITES);
        expect(r.restock.kind).toBe('bank');
        expect(r.trades).toBe(Number.POSITIVE_INFINITY);
        // The giver stands on a tile next to the receiver's.
        for (const s of r.sites) expect(Math.abs(s.giver.x - s.receiver.x) + Math.abs(s.giver.z - s.receiver.z)).toBe(1);
    });

    test('validation', () => {
        expect(() => boneGiverOptions({ n: 0 })).toThrow(/n must be/);
        expect(() => boneGiverOptions({ n: 29 })).toThrow(/n must be/);
        expect(() => boneGiverOptions({ sites: [] })).toThrow(/sites/);
        expect(() => boneGiverOptions({ sites: [{ giver: { x: 1 }, receiver: { x: 1, z: 2 } }] })).toThrow(/giver needs/);
        expect(() => boneGiverOptions({ restock: { kind: 'trade' } })).toThrow(/restock.kind/);
        expect(boneGiverOptions({ trades: 2, restock: { kind: 'cheat' } })).toMatchObject({ trades: 2, restock: { kind: 'cheat' } });
    });
});
