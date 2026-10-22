import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BotWorldState, InventoryItem, NearbyLoc, TradeItem } from '../../sdk/types';
import { baseState, FakeSdk, flush } from '../lib/fake-sdk';
import { ANY_OFFER, decideGiver, newGiverCtx, planOffers } from '../lib/trade';
import {
    anvilOptions,
    asDelivered,
    boothOf,
    BOOTH_ID,
    giveSpecs,
    HELPER_TILE,
    itemRe,
    nextStep,
    openBooth,
    plannedGone,
    readAnvilPlan,
    staging,
    validPlan,
    writeAnvilPlan,
    type AnvilPlan
} from './anvil';

const IDS: Record<string, number> = { 'Bronze bar': 2349, 'Iron bar': 2351, 'Adamantite bar': 2361, Hammer: 2347, 'Adamant platebody': 1123, 'Iron platebody': 1115 };
/** One unstackable item per slot, from slot `from` on. */
const items = (name: string, n: number, from = 0): InventoryItem[] => Array.from({ length: n }, (_, i) => ({ slot: from + i, id: IDS[name]!, name, count: 1, optionsWithIndex: [] }));
const note = (name: string, count: number, slot: number): InventoryItem => ({ slot, id: IDS[name]! + 1, name, count, optionsWithIndex: [] });
const plan = (give: Record<string, number>, seq = 3, extra: Partial<AnvilPlan> = {}): AnvilPlan => ({ v: 1, session: 's1', seq, give, ms: 0, ...extra });
const booth = (x: number, z: number, ops: string[]): NearbyLoc =>
    ({ id: BOOTH_ID, name: 'Bank booth', x, z, level: 0, distance: 0, options: ops, optionsWithIndex: ops.map((text, i) => ({ text, opIndex: i + 1 })) }) as NearbyLoc;

describe('the plan file', () => {
    test('a plan of up to 28 positive counts is valid; a stop plan may be empty', () => {
        expect(validPlan(plan({ adamantite_bar: 25 }))).not.toBeNull();
        expect(validPlan(plan({ bronze_bar: 15, iron_bar: 9, hammer: 1 }, 0))).not.toBeNull();
        expect(validPlan(plan({}, 9, { stop: true }))).not.toBeNull();
    });

    test('the final hand-back: collect with an empty give, and only empty', () => {
        expect(validPlan(plan({}, 31, { collect: true }))).not.toBeNull();
        expect(validPlan(plan({ adamantite_bar: 25 }, 31, { collect: true }))).toBeNull();
    });

    test('collect empties the helper first, so the last products fit', () => {
        expect(staging([], {}).exact).toBe(true);
        const st = staging(items('Adamant platebody', 5), {});
        expect(st.exact).toBe(false);
        expect(st.withdraw).toEqual([]);
    });

    test('the delivered record from ctx.state', () => {
        expect(asDelivered({ session: 's1', seq: 4 })).toEqual({ session: 's1', seq: 4 });
        expect(asDelivered(undefined)).toBeNull();
        expect(asDelivered({ session: 's1', seq: 'x' })).toBeNull();
    });

    test('anything else is ignored rather than acted on', () => {
        expect(validPlan(plan({ adamantite_bar: 29 }))).toBeNull();
        expect(validPlan(plan({ steel_bar: 20, iron_bar: 9 }))).toBeNull();
        expect(validPlan(plan({ adamantite_bar: 0 }))).toBeNull();
        expect(validPlan(plan({ 'Adamantite bar': 25 }))).toBeNull();
        expect(validPlan(plan({}))).toBeNull();
        expect(validPlan({ ...plan({ iron_bar: 25 }), seq: -1 })).toBeNull();
        expect(validPlan({ ...plan({ iron_bar: 25 }), v: 2 })).toBeNull();
        expect(validPlan(null)).toBeNull();
    });

    test('round trip through the cue directory; a bad plan is never written', () => {
        const dir = mkdtempSync(join(tmpdir(), 'anvil-test-'));
        expect(readAnvilPlan(dir)).toBeNull();
        writeAnvilPlan(dir, { session: 'abc', seq: 4, give: { mithril_bar: 25 } });
        expect(readAnvilPlan(dir)).toMatchObject({ session: 'abc', seq: 4, give: { mithril_bar: 25 } });
        expect(() => writeAnvilPlan(dir, { session: 'abc', seq: 5, give: { mithril_bar: 30 } })).toThrow();
        expect(readAnvilPlan(dir)?.seq).toBe(4);
        writeAnvilPlan(dir, { session: 'abc', seq: 5, give: {}, stop: true });
        expect(readAnvilPlan(dir)?.stop).toBe(true);
    });
});

describe('itemRe', () => {
    test('a debug name matches its in-game name only', () => {
        expect(itemRe('adamantite_bar').test('Adamantite bar')).toBe(true);
        expect(itemRe('hammer').test('Hammer')).toBe(true);
        expect(itemRe('adamantite_bar').test('Adamant platebody')).toBe(false);
        expect(itemRe('iron_bar').test('Iron bars')).toBe(false);
    });
});

describe('staging: carry exactly the plan', () => {
    const want = { adamantite_bar: 25 };

    test('exactly the bars is ready', () => {
        expect(staging(items('Adamantite bar', 25), want)).toEqual({ exact: true, deposit: [], withdraw: [] });
    });

    test('after a trade: the products go in, 25 bars come out', () => {
        const st = staging(items('Adamant platebody', 5), want);
        expect(st.exact).toBe(false);
        expect(st.deposit.map(i => i.name)).toEqual(['Adamant platebody']); // one deposit-all per id
        expect(st.withdraw).toEqual([{ name: 'adamantite_bar', n: 25 }]);
    });

    test('a short inventory takes only the shortfall', () => {
        expect(staging(items('Adamantite bar', 20), want).withdraw).toEqual([{ name: 'adamantite_bar', n: 5 }]);
    });

    test('over count: all of that id goes back and the exact count comes out', () => {
        const st = staging(items('Adamantite bar', 27), want);
        expect(st.deposit.map(i => i.name)).toEqual(['Adamantite bar']);
        expect(st.withdraw).toEqual([{ name: 'adamantite_bar', n: 25 }]);
    });

    test('a note stack of the same name is not a bar: it goes back', () => {
        const st = staging([...items('Adamantite bar', 20), note('Adamantite bar', 300, 20)], want);
        expect(st.deposit.map(i => i.count)).toEqual([300]);
        expect(st.withdraw).toEqual([{ name: 'adamantite_bar', n: 5 }]);
    });

    test("the first inventory: bronze, iron and the hammer, each to its own count", () => {
        const first = { bronze_bar: 15, iron_bar: 9, hammer: 1 };
        expect(staging([...items('Bronze bar', 15), ...items('Iron bar', 9, 15), ...items('Hammer', 1, 24)], first).exact).toBe(true);
        expect(staging([...items('Bronze bar', 15), ...items('Iron bar', 8, 15)], first).withdraw).toEqual([
            { name: 'iron_bar', n: 1 },
            { name: 'hammer', n: 1 }
        ]);
    });

    test('plannedGone: only once none of the planned items is carried', () => {
        expect(plannedGone(items('Adamant platebody', 5), want)).toBe(true);
        expect(plannedGone([...items('Adamant platebody', 5), ...items('Adamantite bar', 1, 5)], want)).toBe(false);
        expect(plannedGone([note('Adamantite bar', 300, 0)], want)).toBe(true);
    });
});

describe('nextStep', () => {
    const base = { plan: plan({ adamantite_bar: 25 }, 3), delivered: { session: 's1', seq: 2 }, exact: true, onTile: true, receiverInSight: true, cueStop: false };

    test('staged, on the tile, the scored account in sight: request', () => {
        expect(nextStep(base)).toBe('request');
    });

    test('in order: stage, then the tile, then the scored account', () => {
        expect(nextStep({ ...base, exact: false, onTile: false, receiverInSight: false })).toBe('stage');
        expect(nextStep({ ...base, onTile: false, receiverInSight: false })).toBe('go-to-tile');
        expect(nextStep({ ...base, receiverInSight: false })).toBe('wait-receiver');
    });

    test('an inventory already handed over is never staged again; a new session starts over', () => {
        expect(nextStep({ ...base, delivered: { session: 's1', seq: 3 }, exact: false })).toBe('wait-plan');
        expect(nextStep({ ...base, delivered: { session: 'old', seq: 30 }, exact: false })).toBe('stage');
        expect(nextStep({ ...base, delivered: null })).toBe('request');
    });

    test('no plan waits; a stop in the plan or the cue stops', () => {
        expect(nextStep({ ...base, plan: null })).toBe('wait-plan');
        expect(nextStep({ ...base, plan: plan({}, 4, { stop: true }) })).toBe('stop');
        expect(nextStep({ ...base, cueStop: true })).toBe('stop');
    });
});

describe('the trade: bars out, products back in the same trade', () => {
    const inv = items('Adamantite bar', 25);
    const offerPlan = planOffers(inv, giveSpecs({ adamantite_bar: 25 }));
    const mine: TradeItem[] = [{ slot: 0, id: IDS['Adamantite bar']!, name: 'Adamantite bar', count: 25 }];
    const theirs: TradeItem[] = [{ slot: 0, id: IDS['Adamant platebody']!, name: 'Adamant platebody', count: 5 }];
    const frame = (tick: number, screen: 'offer' | 'confirm', their: TradeItem[], myAccepted = false): BotWorldState =>
        baseState({ tick, inventory: inv, trade: { isOpen: true, screen, partner: 'Scored', myOffer: mine, theirOffer: their, myAccepted, partnerAccepted: false } } as Partial<BotWorldState>);

    test('the 25 bars go in one All press', () => {
        expect(offerPlan.map(e => e.amounts)).toEqual([[-1]]);
    });

    test('the products resetting our accept are re-accepted the next tick; the confirm screen is accepted with them', () => {
        let ctx = newGiverCtx('Scored', inv, offerPlan, ANY_OFFER);
        let d = decideGiver(frame(10, 'offer', []), ctx);
        expect(d.action).toBe('burst');
        ctx = d.next;
        d = decideGiver(frame(11, 'offer', theirs), ctx);
        expect(d.action).toBe('accept');
        ctx = d.next;
        d = decideGiver(frame(12, 'confirm', theirs), ctx);
        expect(d.action).toBe('accept');
    });

    test('a scored account handing back nothing (the first trade) is accepted too', () => {
        const ctx = newGiverCtx('Scored', inv, offerPlan, ANY_OFFER);
        const d = decideGiver(frame(12, 'confirm', []), { ...ctx, burstTick: 10, lastAcceptTick: 11 });
        expect(d.action).toBe('accept');
    });
});

describe('anvilOptions and the booth', () => {
    test('defaults: bank restock on the tile beside the anvil, no trade limit', () => {
        const o = anvilOptions({}, { RC_CUE_DIR: '/tmp/cue' });
        expect(o).toMatchObject({ restock: { kind: 'bank', labStock: false }, tile: HELPER_TILE, noReplyTicks: 3, resendTicks: 100, cueDir: '/tmp/cue' });
        expect(o.trades).toBe(Number.POSITIVE_INFINITY);
    });

    test('rejects what it cannot do', () => {
        expect(() => anvilOptions({ restock: { kind: 'trade' } })).toThrow();
        expect(() => anvilOptions({ trades: 0 })).toThrow();
        expect(() => anvilOptions({ tile: { x: 'a', z: 1 } })).toThrow();
    });

    test('boothOf: the booth nearest the anvil, by its quick-use op', () => {
        const s = baseState({ nearbyLocs: [booth(3180, 3440, ['Use', 'Use-quickly']), booth(3187, 3436, ['Use', 'Use-quickly'])] } as Partial<BotWorldState>);
        expect(boothOf(s)).toMatchObject({ loc: { x: 3187, z: 3436 }, op: 2 });
        expect(boothOf(baseState())).toBeNull();
    });
});

describe('openBooth', () => {
    const CLICK = { method: 'sendInteractLoc', args: [3187, 3436, BOOTH_ID, 2] };
    const atBooth = () => new FakeSdk(baseState({ tick: 0, nearbyLocs: [booth(3187, 3436, ['Use', 'Use-quickly'])] } as Partial<BotWorldState>));
    const openBank = (items: { slot: number; id: number; name: string; count: number }[]) => ({ bank: { isOpen: true, items, noteMode: false } });
    /** The promise's value once queued callbacks have run, or 'pending'. */
    const settled = <T>(p: Promise<T>) => Promise.race([p, flush().then(() => 'pending' as const)]);

    test('a stocked bank: one click per tick until it opens; the items may land a frame after the modal', async () => {
        const sdk = atBooth();
        const p = openBooth(sdk as never);
        sdk.push({}); // a republish in the same tick does not click again
        sdk.tick();
        sdk.tick();
        expect(sdk.sent).toEqual([CLICK, CLICK, CLICK]);
        sdk.tick(openBank([]));
        expect(await settled(p)).toBe('pending');
        sdk.push(openBank([{ slot: 0, id: 2361, name: 'Adamantite bar', count: 500 }]));
        expect(await settled(p)).toEqual({ ok: true, clicks: 3, ticks: 3, empty: false });
        sdk.tick();
        expect(sdk.sent.length).toBe(3);
    });

    test('an open, empty bank resolves the next tick instead of waiting for items forever', async () => {
        const sdk = atBooth();
        const p = openBooth(sdk as never);
        sdk.tick(openBank([]));
        sdk.push({});
        expect(await settled(p)).toBe('pending');
        sdk.tick();
        expect(await settled(p)).toEqual({ ok: true, clicks: 1, ticks: 2, empty: true });
        expect(sdk.sent).toEqual([CLICK]);
    });

    test('a bank that never opens gives up after the click limit, with the reason', async () => {
        const sdk = atBooth();
        const p = openBooth(sdk as never, { maxClicks: 5 });
        for (let i = 0; i < 10; i++) sdk.tick();
        expect(await settled(p)).toEqual({ ok: false, clicks: 5, ticks: 5, empty: false, reason: 'clicks' });
        expect(sdk.sent.length).toBe(5);
    });

    test('the tick limit bounds the wait even when no click goes out', async () => {
        const sdk = new FakeSdk(baseState({ tick: 0 }));
        const p = openBooth(sdk as never, { maxTicks: 4 });
        for (let i = 0; i < 4; i++) sdk.tick();
        expect(await settled(p)).toEqual({ ok: false, clicks: 4, ticks: 4, empty: false, reason: 'ticks' });
        expect(sdk.sent).toEqual([]);
    });
});
