import { describe, expect, test } from 'bun:test';
import { bidderOptions, competingBid, decideBid, lineOptions, MAX_OFFERS_PER_LINE, openOwn, type MarketView, type OwnOffer } from './bidder';

const GRAPES = 1987;
const opts = lineOptions({ item: 'Grapes', target: 520, tranche: 150, maxPrice: 3000 });
/** Main's dragon bone line (rs/41): 1,000 steps, a step after an hour without fills, cap 12,000. */
const bones = lineOptions({ item: 'Dragon bones', target: 555, tranche: 30, maxPrice: 12_000, minPrice: 6000, step: 1000, stepAfterIdleMinutes: 60 });

const offer = (over: Partial<OwnOffer> = {}): OwnOffer => ({
    id: 15914,
    item: GRAPES,
    side: 'buy',
    state: 'open',
    price: 1650,
    quantity: 61,
    remaining: 45,
    filled: 16,
    items: 0,
    coins: 0,
    ...over
});

/** A book: other bidders' (qty, price) rows plus our offers, as the market API reports it. */
function book(others: Array<[number, number]>, ours: OwnOffer[] = [], over: Partial<MarketView> = {}): MarketView {
    const all = [...others, ...ours.map(o => [o.remaining, o.price] as [number, number])];
    return {
        bid: all.length ? Math.max(...all.map(([, p]) => p)) : null,
        ask: null,
        buyQuantity: all.reduce((a, [q]) => a + q, 0),
        buyValue: all.reduce((a, [q, p]) => a + q * p, 0),
        lastPrice: 1623,
        ...over
    };
}

describe('competingBid excludes our own offer', () => {
    test('our offer is the best bid: not outbid, others are below (demo book 07:53 UTC)', () => {
        const ours = [offer()];
        const quote = book([[99_508, 1000]], ours);
        expect(quote).toMatchObject({ bid: 1650, buyQuantity: 99_553, buyValue: 99_582_250 });
        const c = competingBid(quote, ours);
        expect(c).toMatchObject({ outbid: false, competing: null, tie: false, belowAvg: 1000 });
    });

    test('a higher bid from someone else is an outbid', () => {
        const ours = [offer()];
        const c = competingBid(book([[99_508, 1000], [50, 1700]], ours), ours);
        expect(c).toMatchObject({ outbid: true, competing: 1700 });
    });

    test('others resting at exactly our price are a tie, not an outbid', () => {
        const ours = [offer()];
        const c = competingBid(book([[30, 1650]], ours), ours);
        expect(c).toMatchObject({ outbid: false, tie: true, competing: 1650 });
    });

    test('alone on the book: no competing bid', () => {
        const ours = [offer()];
        expect(competingBid(book([], ours), ours)).toMatchObject({ outbid: false, competing: null, belowAvg: null });
    });

    test('a quote that predates our offer (market lag) is not an outbid', () => {
        const ours = [offer()];
        const c = competingBid(book([[99_508, 1000]]), ours);
        expect(c).toMatchObject({ outbid: false, stale: true, competing: 1000 });
    });

    test('without an offer of ours, the best bid is the competing bid', () => {
        expect(competingBid(book([[99_508, 1000], [10, 1623]]), [])).toMatchObject({ competing: 1623, outbid: false });
    });

    test('only open buy offers for the item count as ours', () => {
        const offers = [offer(), offer({ id: 2, state: 'completed', remaining: 0 }), offer({ id: 3, item: 995 }), offer({ id: 4, side: 'sell' })];
        expect(openOwn(offers, GRAPES).map(o => o.id)).toEqual([15914]);
    });
});

describe('decideBid', () => {
    test('outbid: cancel ours and replace just above the competitor, funded by the refund', () => {
        const ours = [offer({ remaining: 100, quantity: 100, filled: 0 })];
        const d = decideBid({ held: 116, ours, quote: book([[40, 1700]], ours), coins: 10_000, options: opts });
        expect(d).toMatchObject({ action: 'replace', cancel: [15914], price: 1725, capped: false });
        // 10,000 carried + 165,000 escrow back = 175,000 -> 101 at 1,725
        expect(d.quantity).toBe(101);
    });

    test('still the best bid: hold, no churn', () => {
        const ours = [offer({ remaining: 140, quantity: 150, filled: 10 })];
        const d = decideBid({ held: 116, ours, quote: book([[99_508, 1000]], ours), coins: 500_000, options: opts });
        expect(d.action).toBe('hold');
        expect(d.cancel).toEqual([]);
    });

    test('still the best bid with most of the tranche filled: top up at our price without cancelling', () => {
        const ours = [offer()]; // 45 resting
        const d = decideBid({ held: 116, ours, quote: book([[99_508, 1000]], ours), coins: 400_000, options: opts });
        expect(d).toMatchObject({ action: 'place', price: 1650, quantity: 105, cancel: [] });
    });

    test('no offer: place a tranche just above the competing bid', () => {
        const d = decideBid({ held: 116, ours: [], quote: book([[99_508, 1000], [10, 1623]]), coins: 400_000, options: opts });
        expect(d).toMatchObject({ action: 'place', price: 1648, quantity: 150, coinsShort: 0 });
    });

    test('coins short: place what we can afford and report the shortfall', () => {
        const d = decideBid({ held: 116, ours: [], quote: book([[10, 1623]]), coins: 100_000, options: opts });
        expect(d).toMatchObject({ action: 'place', price: 1648, quantity: 60 });
        expect(d.coinsShort).toBe(150 * 1648 - 100_000);
    });

    test('no coins at all: short, nothing placed', () => {
        const d = decideBid({ held: 116, ours: [], quote: book([[10, 1623]]), coins: 1000, options: opts });
        expect(d).toMatchObject({ action: 'short', quantity: 0 });
    });
});

describe('our price never goes down', () => {
    // Seen live: #15914 at 1,650 filled, and the next tranche went in at 1,025
    // (1,000 + 25) while a seller was asking 1,650.
    test('a new tranche after a fill starts at our earlier price, not just above a lower competitor', () => {
        const d = decideBid({ held: 161, ours: [], quote: book([[99_508, 1000]], [], { ask: 1650 }), coins: 400_000, options: opts, floor: 1650 });
        expect(d).toMatchObject({ action: 'place', price: 1650, quantity: 150 });
    });

    test('minPrice is a floor too', () => {
        const o = lineOptions({ item: 'Grapes', target: 520, maxPrice: 3000, minPrice: 1650 });
        expect(decideBid({ held: 161, ours: [], quote: book([[99_508, 1000]]), coins: 400_000, options: o })).toMatchObject({ price: 1650 });
    });

    test('an open offer below the floor is re-priced up', () => {
        const ours = [offer({ id: 15945, price: 1025, quantity: 1, remaining: 1, filled: 0 })];
        const o = lineOptions({ item: 'Grapes', target: 520, maxPrice: 3000, minPrice: 1650 });
        const d = decideBid({ held: 161, ours, quote: book([[99_508, 1000]], ours), coins: 400_000, options: o });
        expect(d).toMatchObject({ action: 'replace', cancel: [15945], price: 1650 });
    });

    test('the floor never lifts a bid past the cap', () => {
        const d = decideBid({ held: 0, ours: [], quote: book([[10, 1000]]), coins: 1_000_000, options: opts, floor: 3500 });
        expect(d.price).toBe(3000);
    });
});

describe('the 3,000 gp cap', () => {
    test('a competitor past the cap: replace at exactly maxPrice, flagged capped', () => {
        const ours = [offer({ remaining: 100 })];
        const d = decideBid({ held: 116, ours, quote: book([[20, 3100]], ours), coins: 1_000_000, options: opts });
        expect(d).toMatchObject({ action: 'replace', price: 3000, capped: true });
    });

    test('already at the cap and outbid: hold, never raise', () => {
        const ours = [offer({ price: 3000, remaining: 100 })];
        const d = decideBid({ held: 116, ours, quote: book([[20, 3100]], ours), coins: 1_000_000, options: opts });
        expect(d).toMatchObject({ action: 'hold', capped: true, price: 3000, cancel: [] });
    });

    test('a competitor just under the cap is beaten at the cap, not above it', () => {
        const d = decideBid({ held: 116, ours: [], quote: book([[20, 2990]]), coins: 1_000_000, options: opts });
        expect(d).toMatchObject({ action: 'place', price: 3000, capped: false });
    });

    test('a fresh offer against a competitor past the cap rests at the cap', () => {
        const d = decideBid({ held: 0, ours: [], quote: book([[20, 5000]]), coins: 1_000_000, options: opts });
        expect(d).toMatchObject({ action: 'place', price: 3000, capped: true });
    });
});

describe('the target stop', () => {
    test('target held: cancel what rests and stop', () => {
        const ours = [offer({ remaining: 30 })];
        const d = decideBid({ held: 520, ours, quote: book([[50, 2000]], ours), coins: 500_000, options: opts });
        expect(d).toMatchObject({ action: 'done', cancel: [15914] });
    });

    test('target held with nothing resting: done, nothing to cancel, nothing placed', () => {
        const d = decideBid({ held: 600, ours: [], quote: book([[50, 2000]]), coins: 500_000, options: opts });
        expect(d).toMatchObject({ action: 'done', cancel: [], quantity: 0 });
    });

    test('the last tranche is only what is still missing', () => {
        const d = decideBid({ held: 470, ours: [], quote: book([[10, 1623]]), coins: 500_000, options: opts });
        expect(d).toMatchObject({ action: 'place', quantity: 50 });
    });
});

describe('step mode (dragon bones)', () => {
    const boneOffer = (over: Partial<OwnOffer> = {}) => offer({ id: 16015, item: 536, price: 6000, quantity: 30, remaining: 30, filled: 0, ...over });

    test('starts at minPrice above a lower competitor', () => {
        const d = decideBid({ held: 0, ours: [], quote: book([[1254, 5000]]), coins: 500_000, options: bones });
        expect(d).toMatchObject({ action: 'place', price: 6000, quantity: 30 });
    });

    test('an hour without fills: one step up, never a jump', () => {
        const ours = [boneOffer()];
        const quote = book([[1254, 5000]], ours);
        expect(decideBid({ held: 11, ours, quote, coins: 0, options: bones, idleMinutes: 59 }).action).toBe('hold');
        const d = decideBid({ held: 11, ours, quote, coins: 0, options: bones, idleMinutes: 61 });
        expect(d).toMatchObject({ action: 'replace', cancel: [16015], price: 7000 });
    });

    test('a competitor above us: the first whole step above them', () => {
        const ours = [boneOffer()];
        expect(decideBid({ held: 11, ours, quote: book([[50, 6100]], ours), coins: 500_000, options: bones })).toMatchObject({ action: 'replace', price: 7000 });
        expect(decideBid({ held: 11, ours, quote: book([[50, 7000]], ours), coins: 500_000, options: bones })).toMatchObject({ action: 'replace', price: 8000 });
    });

    test('the 12,000 cap: the last step stops at the cap, then hold', () => {
        const at11 = [boneOffer({ price: 11_500 })];
        expect(decideBid({ held: 11, ours: at11, quote: book([], at11), coins: 0, options: bones, idleMinutes: 90 })).toMatchObject({ action: 'replace', price: 12_000 });
        const at12 = [boneOffer({ price: 12_000 })];
        expect(decideBid({ held: 11, ours: at12, quote: book([], at12), coins: 0, options: bones, idleMinutes: 90 })).toMatchObject({ action: 'hold', capped: true });
        expect(decideBid({ held: 11, ours: at12, quote: book([[5, 13_000]], at12), coins: 0, options: bones })).toMatchObject({ action: 'hold', capped: true });
    });

    test('target 555 held: done', () => {
        const ours = [boneOffer()];
        expect(decideBid({ held: 555, ours, quote: book([], ours), coins: 0, options: bones })).toMatchObject({ action: 'done', cancel: [16015] });
    });
});

describe('offer slots', () => {
    test(`no top-up beyond ${MAX_OFFERS_PER_LINE} offers per line (the server has 6 slots per account)`, () => {
        const ours = [offer({ id: 1, remaining: 20 }), offer({ id: 2, remaining: 20 })];
        const d = decideBid({ held: 116, ours, quote: book([[99_508, 1000]], ours), coins: 500_000, options: opts });
        expect(d.action).toBe('hold');
    });
});

describe('options', () => {
    test('line defaults and validation', () => {
        expect(opts).toMatchObject({ target: 520, tranche: 150, maxPrice: 3000, outbidBy: 25, minPrice: 0, step: null, stepAfterIdleMinutes: null });
        expect(() => lineOptions({ target: 520, maxPrice: 3000 })).toThrow(/item/);
        expect(() => lineOptions({ item: 'Grapes', maxPrice: 3000 })).toThrow(/target/);
        expect(() => lineOptions({ item: 'Grapes', target: 520 })).toThrow(/maxPrice/);
        expect(() => lineOptions({ item: 'Grapes', target: 520, maxPrice: 3000, stepAfterIdleMinutes: 60 })).toThrow(/needs step/);
    });

    test('a list of lines in priority order, or one line at the top level', () => {
        const o = bidderOptions({ lines: [{ item: 'Dragon bones', target: 555, maxPrice: 12_000, step: 1000 }, { item: 'Grapes', target: 520, maxPrice: 3000 }], recheckMinutes: 30 });
        expect(o.lines.map(l => l.item)).toEqual(['Dragon bones', 'Grapes']);
        expect(o).toMatchObject({ recheckMinutes: 30, fillCheckMinutes: 3 });
        expect(bidderOptions({ item: 'Grapes', target: 520, maxPrice: 3000 }).lines).toHaveLength(1);
        expect(() => bidderOptions({ lines: [{ item: 'Grapes', target: 1, maxPrice: 1 }, { item: 'grapes', target: 2, maxPrice: 1 }] })).toThrow(/two lines/);
        expect(() => bidderOptions({ lines: [{ item: 'Grapes', target: 1 }] })).toThrow(/lines\[0\]\.maxPrice/);
    });
});
