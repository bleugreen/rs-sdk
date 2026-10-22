import { describe, expect, test } from 'bun:test';
import type { BotWorldState, InventoryItem, TradeItem } from '../../sdk/types';
import { baseState, FakeSdk, flush, type SentAction } from './fake-sdk';
import { DROPPED_TICKS, RESEND_TICKS, swap, tradeClickReply } from './trade';

// swap() is a driver around decideGiver / decideReceiver (their rules are tested in
// trade.test.ts); these tests run it against a scripted server and partner.

const inv = (slot: number, id: number, name: string, count = 1): InventoryItem => ({ slot, id, name, count, optionsWithIndex: [] });
const ti = (id: number, name: string, count: number): TradeItem => ({ slot: 0, id, name, count });

// Five platebodies out, 25 adamantite bars in: the anvil case.
const PLATE = 1123;
const BAR = 2361;
const plates = (n: number) => Array.from({ length: n }, (_, i) => inv(i + 1, PLATE, 'Adamant platebody'));
const HAMMER = inv(0, 2347, 'Hammer');
const THEIRS = [ti(BAR, 'Adamantite bar', 25)];
const WANT = [{ item: /^adamantite bar$/i, amount: 25 }];

const msg = (text: string, tick: number) => ({ type: 0, text, tick, fromSelf: false }) as unknown as BotWorldState['gameMessages'][number];

class SwapFake extends FakeSdk {
    sendCloseModal() { return this.sendAction({ method: 'sendCloseModal', args: [] }); }
}

interface PartnerOpts {
    /** Our trade clicks before this tick are dropped (we are delayed). */
    busyUntil?: number;
    /** Ticks from our trade click to its effect on the server (1 locally; more through the relay). */
    lag?: number;
    /** The partner declines on the confirm screen after our accept: the server refunds our items. */
    declineOnConfirm?: boolean;
    /** What the partner shows on the confirm screen, if not `theirs`. */
    confirmOffer?: TradeItem[];
}

/**
 * The server and a partner whose request stands: our click opens the screens, it offers
 * `theirs` and accepts each screen. Effects land on the next tick, all of a tick's packets
 * together and in order; the partner re-accepts a tick after our offer resets its accept.
 */
function scriptedPartner(sdk: SwapFake, theirs: TradeItem[], opts: PartnerOpts = {}) {
    const queue: Array<{ due: number; fx: (s: BotWorldState) => Partial<BotWorldState> }> = [];
    const toConfirm = (tr: NonNullable<BotWorldState['trade']>) => ({ trade: { ...tr, screen: 'confirm' as const, theirOffer: opts.confirmOffer ?? tr.theirOffer, myAccepted: false, partnerAccepted: true } });
    sdk.onSend = (a: SentAction) => {
        const s = sdk.state!;
        const later = (fx: (s: BotWorldState) => Partial<BotWorldState>, d = 1) => queue.push({ due: s.tick + d, fx });
        const t = s.trade;
        if (a.method === 'sendTradeRequest' && s.tick >= (opts.busyUntil ?? 0)) {
            // A landed click is always answered; one reaching an open trade closes it (OpPlayerHandler).
            later(cur => {
                const gameMessages = [...cur.gameMessages, msg('Sending trade offer...', cur.tick)];
                if (cur.trade?.isOpen) return { trade: undefined, gameMessages };
                return { gameMessages, trade: { isOpen: true, screen: 'offer', partner: 'helper', myOffer: [], theirOffer: theirs, myAccepted: false, partnerAccepted: true } };
            }, opts.lag ?? 1);
        }
        if (a.method === 'sendCloseModal') later(() => ({ dialog: { ...s.dialog, isOpen: false }, modalOpen: false }));
        if (a.method === 'sendOfferItem') {
            const slot = a.args[0] as number;
            later(cur => {
                const item = cur.inventory.find(i => i.slot === slot);
                if (!item || !cur.trade?.isOpen) return {}; // an empty slot: the server ignores the offer
                const moved = cur.inventory.filter(i => i.id === item.id);
                return {
                    inventory: cur.inventory.filter(i => i.id !== item.id),
                    trade: { ...cur.trade!, myOffer: [...cur.trade!.myOffer, ti(item.id, item.name, moved.reduce((n, i) => n + i.count, 0))], myAccepted: false, partnerAccepted: false },
                };
            });
            // The partner re-accepts; with our accept standing, both screens move to confirm.
            later(cur => {
                const tr = cur.trade;
                if (!tr?.isOpen || tr.screen !== 'offer') return {};
                return tr.myAccepted ? toConfirm(tr) : { trade: { ...tr, partnerAccepted: true } };
            }, 2);
        }
        if (a.method === 'sendAcceptTrade') {
            later(cur => {
                const tr = cur.trade;
                if (!tr?.isOpen) return {};
                if (tr.screen === 'offer') return tr.partnerAccepted ? toConfirm(tr) : { trade: { ...tr, myAccepted: true } };
                if (opts.declineOnConfirm) {
                    const back = tr.myOffer.flatMap(i => Array.from({ length: i.count }, (_, k) => inv(20 + k, i.id, i.name)));
                    return { trade: undefined, inventory: [...cur.inventory, ...back] };
                }
                const gained = tr.theirOffer.flatMap(i => Array.from({ length: i.count }, (_, k) => inv(10 + k, i.id, i.name)));
                return { trade: undefined, inventory: [...cur.inventory, ...gained], gameMessages: [...cur.gameMessages, msg('Accepted trade.', cur.tick)] };
            });
        }
        if (a.method === 'sendDeclineTrade' && t?.isOpen) {
            const back = t.myOffer.flatMap(i => Array.from({ length: i.count }, (_, k) => inv(20 + k, i.id, i.name)));
            later(cur => ({ trade: undefined, inventory: [...cur.inventory, ...back] }));
        }
    };
    return () =>
        sdk.tick(cur => {
            let next = { ...cur, tick: cur.tick + 1 };
            for (let i = 0; i < queue.length; ) {
                if (queue[i]!.due <= next.tick) next = { ...next, ...queue.splice(i, 1)[0]!.fx(next) };
                else i++;
            }
            return next;
        });
}

/**
 * The demo relay: trade clicks are held `hold` ticks before the client executes them (and the
 * server sees them), and their action results come back only then.
 */
class RelayFake extends SwapFake {
    private held: Array<{ due: number; a: SentAction; done: (r: { success: boolean; message: string }) => void }> = [];
    constructor(state: BotWorldState, private hold: number) { super(state); }
    override sendAction(a: SentAction) {
        if (a.method !== 'sendTradeRequest') return super.sendAction(a);
        this.sent.push(a);
        return new Promise<{ success: boolean; message: string }>(done => this.held.push({ due: this.state!.tick + this.hold, a, done }));
    }
    override tick(patch: Parameters<SwapFake['tick']>[0] = {}) {
        const s = super.tick(patch);
        for (const h of this.held.filter(x => x.due <= s.tick)) {
            this.held.splice(this.held.indexOf(h), 1);
            this.onSend(h.a, this);
            h.done({ success: true, message: 'Interacting with player' });
        }
        return this.state!;
    }
}

async function drain<T>(p: Promise<T>, step: () => unknown, max = 200): Promise<T> {
    let settled = false;
    void p.finally(() => (settled = true));
    for (let i = 0; i < max && !settled; i++) {
        await flush();
        if (!settled) step();
    }
    return p;
}

const helperPlayer = { name: 'helper', index: 7 } as unknown as BotWorldState['nearbyPlayers'][number];

describe('swap()', () => {
    test('opens through openTrade: re-clicks a dropped click after DROPPED_TICKS silent frames, closing an open modal with each click, and returns the bars', async () => {
        const sdk = new SwapFake(baseState({ tick: 10, inventory: [HAMMER, ...plates(5)], nearbyPlayers: [helperPlayer], dialog: { isOpen: true, options: [], isWaiting: false }, modalOpen: true }));
        const step = scriptedPartner(sdk, THEIRS, { busyUntil: 12 }); // our last item's delay: clicks before tick 12 drop
        const r = await drain(swap(sdk, 'helper', [{ item: /platebody/i }], WANT, { closeModals: true }), step);
        expect(r).toMatchObject({ ok: true });
        expect(r.reason).toBeUndefined();
        expect(r.received).toEqual([expect.objectContaining({ id: BAR, count: 25 })]);
        expect(r.gave).toEqual([expect.objectContaining({ id: PLATE, count: 5 })]);
        const requests = sdk.sent.filter(a => a.method === 'sendTradeRequest');
        expect(requests.length).toBe(2); // tick 10 dropped, no reply; tick 12 lands
        expect(requests.every(a => a.args[0] === 7)).toBe(true);
        expect(sdk.sent.some(a => a.method === 'sendCloseModal')).toBe(true);
        // The giver's burst: one Offer-All for the five unstackable platebodies, then the accept.
        const offers = sdk.sent.filter(a => a.method === 'sendOfferItem');
        expect(offers).toHaveLength(1);
        expect(sdk.sent.findIndex(a => a.method === 'sendAcceptTrade')).toBeGreaterThan(sdk.sent.indexOf(offers[0]!));
        expect(r.openTicks).toBeGreaterThanOrEqual(2);
    });

    test('frames running behind the server: no second click into the trade the first one opened', async () => {
        const sdk = new SwapFake(baseState({ tick: 10, inventory: [HAMMER, ...plates(5)], nearbyPlayers: [helperPlayer] }));
        const step = scriptedPartner(sdk, THEIRS, { lag: DROPPED_TICKS });
        const r = await drain(swap(sdk, 'helper', [{ item: /platebody/i }], WANT), step);
        expect(r).toMatchObject({ ok: true });
        expect(sdk.sent.filter(a => a.method === 'sendTradeRequest')).toHaveLength(1);
    });

    test('a click the relay holds for many ticks is not re-sent behind it', async () => {
        const sdk = new RelayFake(baseState({ tick: 10, inventory: [HAMMER, ...plates(5)], nearbyPlayers: [helperPlayer] }), 12);
        const step = scriptedPartner(sdk, THEIRS);
        const r = await drain(swap(sdk, 'helper', [{ item: /platebody/i }], WANT, { openTicks: 30 }), step);
        expect(r).toMatchObject({ ok: true });
        expect(sdk.sent.filter(a => a.method === 'sendTradeRequest')).toHaveLength(1);
    });

    test('a landed click that did not open the trade waits for the partner, then clicks again', async () => {
        const sdk = new SwapFake(baseState({ tick: 10, inventory: [HAMMER, ...plates(5)], nearbyPlayers: [helperPlayer] }));
        const step = scriptedPartner(sdk, THEIRS, { busyUntil: 1_000 }); // nothing opens
        let n = 0;
        const answer = () => { if (sdk.sent.filter(a => a.method === 'sendTradeRequest').length > n) { n++; sdk.tick(cur => ({ gameMessages: [...cur.gameMessages, msg('Sending trade offer...', cur.tick + 1)] })); } else step(); };
        const r = await drain(swap(sdk, 'helper', [{ item: /platebody/i }], WANT, { openTicks: RESEND_TICKS + 4 }), answer);
        expect(r).toMatchObject({ ok: false, reason: 'no_response' });
        const at = sdk.sent.filter(a => a.method === 'sendTradeRequest').length;
        expect(at).toBe(2); // the first, and one more after RESEND_TICKS
    });

    test('no tick lost between the screens opening and the burst: the offer goes out on the open frame', async () => {
        const sdk = new SwapFake(baseState({ tick: 10, inventory: [HAMMER, ...plates(5)], nearbyPlayers: [helperPlayer] }));
        const step = scriptedPartner(sdk, THEIRS);
        const at: Record<string, number> = {};
        const inner = sdk.onSend;
        sdk.onSend = (a, s) => {
            at[a.method] ??= sdk.state!.tick;
            inner(a, s);
        };
        const r = await drain(swap(sdk, 'helper', [{ item: /platebody/i }], WANT), step);
        expect(r).toMatchObject({ ok: true, openTicks: 1 });
        expect(at.sendTradeRequest).toBe(10);
        expect(at.sendOfferItem).toBe(11); // the screens open on 11
    });

    test('tradeClickReply reads only replies after the click', () => {
        const s = baseState({ tick: 20, gameMessages: [msg('Sending trade offer...', 9), msg('Helper is busy at the moment.', 12)] });
        expect(tradeClickReply(s, 10)).toBe('busy');
        expect(tradeClickReply(s, 12)).toBeNull();
        expect(tradeClickReply(s, 8)).toBe('sent');
    });

    test('several stacks out, a kit in, noted and unnoted', async () => {
        const items = [inv(0, 1387, 'Staff of fire'), inv(1, 1333, 'Rune scimitar'), inv(2, 556, 'Air rune', 40), inv(3, 533, 'Big bones', 3), inv(4, 533, 'Big bones', 1), inv(5, 534, 'Big bones', 12)];
        const kit = [ti(4024, 'Monkey greegree', 1), ti(1961, 'Banana', 5)];
        const sdk = new SwapFake(baseState({ tick: 10, inventory: items, nearbyPlayers: [helperPlayer] }));
        const step = scriptedPartner(sdk, kit);
        const r = await drain(swap(sdk, 'helper', [{ item: 'Staff of fire' }, { item: 'Rune scimitar' }, { item: 'Air rune' }, { item: 'Big bones' }], [{ item: 'Monkey greegree' }, { item: 'Banana', amount: 5 }]), step);
        expect(r.ok).toBe(true);
        expect(sdk.state!.inventory.map(i => i.name).sort()).toEqual(['Banana', 'Banana', 'Banana', 'Banana', 'Banana', 'Big bones', 'Monkey greegree']);
        // One press per id: the unstackable bones (id 533, two slots) went in one Offer-All.
        expect(sdk.sent.filter(a => a.method === 'sendOfferItem' && a.args[0] === 3)).toHaveLength(1);
    });

    test('nothing to give (the first trade): the receiver takes the bars', async () => {
        const sdk = new SwapFake(baseState({ tick: 10, inventory: [HAMMER], nearbyPlayers: [helperPlayer] }));
        const step = scriptedPartner(sdk, THEIRS);
        const r = await drain(swap(sdk, 'helper', [], WANT), step);
        expect(r.ok).toBe(true);
        expect(r.received).toEqual([expect.objectContaining({ id: BAR, count: 25 })]);
        expect(r.gave).toEqual([]);
        expect(sdk.sent.some(a => a.method === 'sendOfferItem')).toBe(false);
    });

    test('nothing wanted (a pure hand-back): done once our items are gone', async () => {
        const sdk = new SwapFake(baseState({ tick: 10, inventory: [HAMMER, ...plates(4)], nearbyPlayers: [helperPlayer] }));
        const step = scriptedPartner(sdk, []);
        const r = await drain(swap(sdk, 'helper', [{ item: /platebody/i }], []), step);
        expect(r.ok).toBe(true);
        expect(r.gave).toEqual([expect.objectContaining({ id: PLATE, count: 4 })]);
        expect(r.received).toEqual([]);
    });

    test('the partner declines after our confirm accept: our items come back, failed', async () => {
        const sdk = new SwapFake(baseState({ tick: 10, inventory: [HAMMER, ...plates(5)], nearbyPlayers: [helperPlayer] }));
        const step = scriptedPartner(sdk, THEIRS, { declineOnConfirm: true });
        const r = await drain(swap(sdk, 'helper', [{ item: /platebody/i }], WANT), step);
        expect(r.ok).toBe(false);
        expect(r.received).toEqual([]);
        expect(sdk.state!.inventory.filter(i => i.id === PLATE)).toHaveLength(5);
    });

    test('a confirm offer short of want is declined before our confirm accept', async () => {
        const sdk = new SwapFake(baseState({ tick: 10, inventory: [HAMMER, ...plates(5)], nearbyPlayers: [helperPlayer] }));
        const step = scriptedPartner(sdk, THEIRS, { confirmOffer: [ti(BAR, 'Adamantite bar', 24)] });
        const r = await drain(swap(sdk, 'helper', [{ item: /platebody/i }], WANT), step);
        expect(r).toMatchObject({ ok: false, reason: 'partner confirm offer is not acceptable' });
        expect(sdk.sent.filter(a => a.method === 'sendAcceptTrade')).toHaveLength(1); // the burst's offer-screen accept only
    });

    test('refuses an item that is both given and wanted, and a call with nothing either way', async () => {
        const sdk = new SwapFake(baseState({ inventory: [inv(0, BAR, 'Adamantite bar')] }));
        await expect(swap(sdk, 'helper', [{ item: /bar/i }], WANT)).rejects.toThrow(/both given and wanted/);
        await expect(swap(sdk, 'helper', [], [])).rejects.toThrow(/nothing to give/);
    });

    test('the partner never in sight: player_not_found after openTicks', async () => {
        const sdk = new SwapFake(baseState({ tick: 10, inventory: plates(5) }));
        const r = await drain(swap(sdk, 'helper', [{ item: /platebody/i }], WANT, { openTicks: 5 }), () => sdk.tick());
        expect(r).toMatchObject({ ok: false, reason: 'player_not_found', openTicks: -1 });
    });
});
