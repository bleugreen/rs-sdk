import { describe, expect, test } from 'bun:test';
import type { MarketQuote } from '../lib/market.ts';
import { accountLine, bookValue, methodRates, netOfFee, storeValue, totalsLine, type AccountLine, type AccountSnapshot, type Stack, type Valuer } from './ledger.ts';

const COINS = (n: number): Stack => ({ id: 995, name: 'Coins', count: n });
const SHARK = (n: number): Stack => ({ id: 385, name: 'Shark', count: n });
const IRON = (n: number): Stack => ({ id: 440, name: 'Iron ore', count: n });
const JUNK = (n: number): Stack => ({ id: 9999, name: 'Mystery', count: n });

const quote = (id: number, bid: number, buyQuantity: number, buyValue: number): MarketQuote =>
    ({ id, name: '', basePrice: 0, item: id, bid, ask: null, buyQuantity, buyValue, sellQuantity: 0, sellValue: 0 }) as unknown as MarketQuote;

const valuer: Valuer = {
    cost: s => ({ 385: 300, 440: 17 })[s.id],
    quote: id => (id === 440 ? quote(440, 110, 1000, 80_000) : undefined)
};

const snap = (o: Partial<AccountSnapshot> = {}): AccountSnapshot => ({
    account: 'acct01',
    method: 'knights',
    stage: 'method',
    session: 1,
    tick: 500,
    carried: [COINS(1_234), SHARK(5)],
    bank: [COINS(50_000), SHARK(100), IRON(10)],
    bankTick: 450,
    deaths: 0,
    ...o
});

describe('values', () => {
    test('store value counts coins at 1 and lists unknown costs', () => {
        expect(storeValue([COINS(10), SHARK(2), JUNK(3)], valuer.cost)).toEqual({ value: 610, unknown: ['Mystery'] });
    });
    test('book value sells into the bids less the fee; no bid is unpriced', () => {
        const b = bookValue([COINS(7), IRON(10), IRON(5), SHARK(1)], valuer.quote);
        // 15 ore into a 1,000-deep bid: between the 80 mean and the 110 best
        expect(b.low).toBe(7 + netOfFee(15 * 80));
        expect(b.high).toBe(7 + netOfFee(15 * 110));
        expect(b.unpriced).toEqual(['Shark']);
        expect(bookValue([IRON(1500)], valuer.quote).unpriced).toEqual(['Iron ore (500 past the bids)']);
    });
    test('netOfFee burns floor(gross / 20)', () => {
        expect(netOfFee(425)).toBe(404);
        expect(netOfFee(19)).toBe(19);
    });
});

describe('ledger lines', () => {
    const now = new Date('2026-10-23T12:00:00Z');

    test('an account line has coins, store and book value, and when the bank was seen', () => {
        const l = accountLine(snap(), valuer, now);
        expect(l).toEqual({
            kind: 'account',
            t: '2026-10-23T12:00:00.000Z',
            account: 'acct01',
            method: 'knights',
            stage: 'method',
            session: 1,
            tick: 500,
            coins: { carried: 1_234, banked: 50_000, total: 51_234 },
            bank: { seenTick: 450, store: 50_000 + 30_000 + 170, book: { low: 50_000 + netOfFee(800), high: 50_000 + netOfFee(1_100) }, unpriced: ['Shark'], unknownCost: [] },
            carriedStore: 1_234 + 1_500,
            msPerTick: null,
            deaths: 0,
            pos: null,
            target: null,
            workTicks: null
        });
        expect(JSON.parse(JSON.stringify(l))).toEqual(l);
    });

    test('an account line carries its tile and the npc its method works', () => {
        const l = accountLine(snap({ pos: [2660, 3305], target: { index: 41, x: 2661, z: 3305 } }), valuer, now);
        expect(l.pos).toEqual([2660, 3305]);
        expect(l.target).toEqual({ index: 41, x: 2661, z: 3305 });
    });

    test('before the first bank visit the banked values are null, not zero', () => {
        const l = accountLine(snap({ bank: null, bankTick: null }), valuer, now);
        expect(l.coins).toEqual({ carried: 1_234, banked: null, total: 1_234 });
        expect(l.bank).toEqual({ seenTick: null, store: null, book: null, unpriced: [], unknownCost: [] });
    });

    test('totals sum the accounts by method and price the merged banks once against the bids', () => {
        const a = snap({ bank: [COINS(100), IRON(800)], deaths: 2 });
        const b = snap({ account: 'acct02', method: 'iron', stage: 'mining', carried: [COINS(5)], bank: [IRON(800)] });
        const c = snap({ account: 'acct03', method: 'guards', stage: 'hp', carried: [], bank: null, bankTick: null });
        const t = totalsLine([a, b, c], valuer, { pending: 1, inWorld: 2 }, now, true);
        expect(t.kind).toBe('totals');
        expect(t.final).toBe(true);
        expect(t.accounts).toBe(3);
        expect(t.coins).toBe(1_234 + 100 + 5);
        expect(t.bankStore).toBe(100 + 1_600 * 17);
        expect(t.bankUnseen).toBe(1);
        expect(t.deaths).toBe(2);
        expect(t.stages).toEqual({ 'method:knights': 1, mining: 1, hp: 1 });
        expect(t.byMethod).toEqual({ knights: { accounts: 1, coins: 1_334, bankStore: 100 + 800 * 17 }, iron: { accounts: 1, coins: 5, bankStore: 800 * 17 }, guards: { accounts: 1, coins: 0, bankStore: 0 } });
        // 1,600 ore against a 1,000-deep bid: the whole side, once, not 800 twice
        expect(t.bankBook.low).toBe(100 + netOfFee(80_000));
        expect(t.bankBook.unpriced).toEqual(['Iron ore (600 past the bids)']);
    });
});

test('methodRates: per account, its longest stretch on the method in one session', () => {
    const line = (account: string, session: number, tick: number, coins: number, stage = 'method', store = coins): AccountLine =>
        ({ kind: 'account', account, method: 'knights', stage, session, tick, coins: { carried: 0, banked: coins, total: coins }, bank: { store } }) as AccountLine;
    const r = methodRates(
        [line('a', 1, 0, 0, 'hp'), line('a', 1, 100, 0), line('a', 1, 1_100, 4_200), line('a', 2, 0, 4_200), line('a', 2, 50, 4_400), line('b', 1, 0, 0), line('b', 1, 9_000, 1_000_000, 'method', 900_000)],
        400
    );
    expect(r).toEqual([
        { account: 'a', method: 'knights', ticks: 1_000, coins: 4_200, bankStore: 4_200, coinsPerHour: 37_800, boardPerHour: 37_800 },
        { account: 'b', method: 'knights', ticks: 9_000, coins: 1_000_000, bankStore: 900_000, coinsPerHour: 1_000_000, boardPerHour: 900_000 }
    ]);
});

test('methodRates: a stretch starts where the bank was first seen', () => {
    const line = (tick: number, carried: number, banked: number | null): AccountLine =>
        ({ kind: 'account', account: 'i', method: 'iron', stage: 'method', session: 1, tick, coins: { carried, banked, total: carried + (banked ?? 0) }, bank: { store: banked === null ? null : banked + 1_700 } }) as AccountLine;
    // 5,000 coins banked before the method show up at the first bank visit: they are not earnings
    const [r] = methodRates([line(0, 100, null), line(500, 100, 5_000), line(1_400, 0, 5_100)], 400);
    expect(r).toMatchObject({ ticks: 900, coins: 0, bankStore: 100 });
    expect(r!.boardPerHour).toBe(1_000);
});
