import { describe, expect, test } from 'bun:test';

import type { BotActions } from '../../sdk/actions';
import type { BotSDK } from '../../sdk/index';
import type { BankItem, BotWorldState, InventoryItem, TradeItem, TradeState } from '../../sdk/types';
import { baseState, FakeSdk, flush } from '../lib/fake-sdk';
import { clickBack, newClickCtx, RESEND_TICKS, type ClickCtx } from '../lib/trade';
import {
    accountMatches,
    canonName,
    countById,
    courierPicks,
    decidePreRequest,
    firstSlotPerId,
    giveOpenTrade,
    holds,
    isStackableName,
    packageItems,
    parsePackageRequest,
    planPackage,
    playerPattern,
    sameItems,
    stagedExactly,
    toRegExps,
    type Package
} from './mule';

const bank = (items: [number, string, number][]): BankItem[] => items.map(([id, name, count], slot) => ({ slot, id, name, count }));
const inv = (items: [number, number, string, number][]): InventoryItem[] =>
    items.map(([slot, id, name, count]) => ({ slot, id, name, count, optionsWithIndex: [] }));

describe('account names', () => {
    test('login and display names compare equal', () => {
        expect(canonName('Cairn H05')).toBe('cairn_h05');
        expect(canonName('cairn_dot_md')).toBe(canonName('Cairn Dot Md'));
    });

    test('playerPattern matches the display name exactly', () => {
        const re = playerPattern('cairn_dot_md');
        expect(re.test('Cairn Dot Md')).toBe(true);
        expect(re.test('cairn_dot_md')).toBe(true);
        expect(re.test('Cairn Dot Md2')).toBe(false);
        expect(re.test('xCairn Dot Md')).toBe(false);
    });

    test('courier filter is written against login names but accepts display names', () => {
        const [re] = toRegExps('^cairn_h\\d+$');
        expect(accountMatches('Cairn H05', re!)).toBe(true);
        expect(accountMatches('Cairn H12', re!)).toBe(true);
        expect(accountMatches('Cairn Mule1', re!)).toBe(false);
        expect(accountMatches('Cairn H05 X', re!)).toBe(false);
        expect(accountMatches(null, re!)).toBe(false);
    });
});

describe('packages', () => {
    const pkgs: Package[] = [
        { name: 'wine', items: [{ item: 'Jug of wine', amount: 28 }] },
        { name: 'bars', items: [{ item: 'Adamantite bar', amount: 100, noted: true }, { item: 'Coins', amount: 5000 }] }
    ];

    test('PM text selects a package by name, with or without the pkg prefix', () => {
        expect(parsePackageRequest('bars', pkgs)?.name).toBe('bars');
        expect(parsePackageRequest('pkg WINE ', pkgs)?.name).toBe('wine');
        expect(parsePackageRequest('hello', pkgs)).toBeNull();
    });

    test('plan maps package items onto bank items and counts slots', () => {
        const plan = planPackage(pkgs[1]!, bank([[2361, 'Adamantite bar', 300], [995, 'Coins', 10_000]]));
        expect(plan.missing).toEqual([]);
        expect(plan.withdrawals.map(w => [w.bankItem.id, w.amount, w.noted])).toEqual([
            [2361, 100, true],
            [995, 5000, false]
        ]);
        expect(plan.slots).toBe(2);
    });

    test('plan reports shortfalls and oversize unnoted packages', () => {
        const short = planPackage(pkgs[1]!, bank([[2361, 'Adamantite bar', 50]]));
        expect(short.missing).toEqual([
            { item: 'Adamantite bar', wanted: 100, have: 50 },
            { item: 'Coins', wanted: 5000, have: 0 }
        ]);
        const big = planPackage({ name: 'x', items: [{ item: 'Jug of wine', amount: 30 }] }, bank([[1993, 'Jug of wine', 40]]));
        expect(big.slots).toBe(30);
    });

    test('amount -1 takes the whole bank stack', () => {
        const plan = planPackage({ name: 'all', items: [{ item: 'logs', amount: -1, noted: true }] }, bank([[1511, 'Logs', 77]]));
        expect(plan.withdrawals[0]!.amount).toBe(77);
    });

    // obj.pack: 91 guamvial / 92 cert_guamvial, 99 ranarrvial / 100 cert_ranarrvial, all "Unfinished potion".
    describe('by obj id (H21e: unfinished potions share one name)', () => {
        const UNF = 'Unfinished potion';
        const herbBank = bank([[91, UNF, 483], [99, UNF, 360], [221, 'Eye of newt', 50]]);

        test('a shared name is ambiguous, never the first bank item', () => {
            const plan = planPackage({ name: 'h21e', items: [{ item: UNF, amount: 100, noted: true }] }, herbBank);
            expect(plan.withdrawals).toEqual([]);
            expect(plan.ambiguous).toEqual([{ item: UNF, ids: [91, 99] }]);
        });

        test('each id picks its own bank stack; a note id withdraws noted from the item id', () => {
            const plan = planPackage(
                { name: 'h21e', items: [{ id: 92, amount: 100 }, { id: 99, amount: 50, noted: true }, { item: 'Eye of newt', amount: 50, noted: true }] },
                herbBank
            );
            expect(plan.ambiguous).toEqual([]);
            expect(plan.withdrawals.map(w => [w.bankItem.id, w.amount, w.noted])).toEqual([[91, 100, true], [99, 50, true], [221, 50, true]]);
            expect(plan.slots).toBe(3);
            const short = planPackage({ name: 'x', items: [{ id: 100, amount: 400 }] }, herbBank);
            expect(short.missing).toEqual([{ item: 'obj 100', wanted: 400, have: 360 }]);
        });

        test('staged and offered by id: the guam notes do not stand in for the ranarr notes', () => {
            const held = countById(inv([[0, 92, UNF, 100], [1, 100, UNF, 50]]));
            expect(stagedExactly(inv([[0, 92, UNF, 100], [1, 100, UNF, 50]]), held).exact).toBe(true);
            const wrong = stagedExactly(inv([[0, 92, UNF, 150]]), held);
            expect(wrong.exact).toBe(false);
            expect(wrong.short).toEqual([100]);
            expect(firstSlotPerId(inv([[0, 92, UNF, 100], [1, 100, UNF, 50]])).map(i => i.id)).toEqual([92, 100]);
        });

        test('options: item or id (exactly one); a note id cannot be noted: false; name lines unchanged', () => {
            expect(packageItems('p', [{ id: 92, amount: 5 }, { item: 'Shark', amount: 2 }, { id: 99, amount: -1, noted: true }])).toEqual([
                { id: 92, amount: 5 },
                { item: 'Shark', amount: 2 },
                { id: 99, amount: -1, noted: true }
            ]);
            expect(() => packageItems('p', [{ item: UNF, id: 91, amount: 1 }])).toThrow(/exactly one of item/);
            expect(() => packageItems('p', [{ id: 92, amount: 1, noted: false }])).toThrow(/is a note/);
            expect(() => packageItems('p', [{ id: 9_999_999, amount: 1 }])).toThrow(/not in obj.pack/);
            expect(() => packageItems('p', [{ id: 91, amount: 0 }])).toThrow(/bad amount for obj 91/);
        });
    });

    test('stackable guess covers coins, runes and ammunition but not plain items', () => {
        for (const n of ['Coins', 'Law rune', 'Rune arrows', 'Mithril dart tips', 'Feather', 'Rune arrowtips']) expect(isStackableName(n)).toBe(true);
        for (const n of ['Rune essence', 'Logs', 'Shark', 'Rune platebody', 'Knife']) expect(isStackableName(n)).toBe(false);
        expect(isStackableName('Rune knife')).toBe(true);
    });
});

describe('offer verification', () => {
    test('sameItems is exact multiset equality by id', () => {
        const a = countById([{ id: 1, count: 5 }, { id: 2, count: 1 }, { id: 2, count: 1 }]);
        expect(sameItems(a, new Map([[1, 5], [2, 2]]))).toBe(true);
        expect(sameItems(a, new Map([[1, 5], [2, 1]]))).toBe(false);
        expect(sameItems(a, new Map([[1, 5], [2, 2], [3, 1]]))).toBe(false);
    });

    test('holds tolerates extra inventory but not a shortfall', () => {
        const have = new Map([[1, 5], [2, 2], [9, 1]]);
        expect(holds(have, new Map([[1, 5], [2, 2]]))).toBe(true);
        expect(holds(have, new Map([[1, 6]]))).toBe(false);
    });

    test('one offer per item id, lowest slot first (Offer-All moves every slot of that id)', () => {
        const items = inv([[5, 379, 'Lobster', 1], [0, 379, 'Lobster', 1], [3, 1512, 'Logs', 40], [1, 379, 'Lobster', 1]]);
        expect(firstSlotPerId(items).map(i => [i.slot, i.id])).toEqual([
            [0, 379],
            [3, 1512]
        ]);
    });
});

describe('courier', () => {
    test('picks every matching bank stack, capped by free slots', () => {
        const b = bank([[1511, 'Logs', 100], [1521, 'Oak logs', 50], [995, 'Coins', 10], [1515, 'Yew logs', 0]]);
        expect(courierPicks(b, toRegExps(['logs$']), 28).map(i => i.name)).toEqual(['Logs', 'Oak logs']);
        expect(courierPicks(b, toRegExps(['logs$']), 1).map(i => i.name)).toEqual(['Logs']);
        expect(courierPicks(b, toRegExps([]), 28)).toEqual([]);
    });
});

describe('giveOpenTrade: the two-way swap (lib/trade.ts give with ANY_OFFER)', () => {
    const kit = inv([[0, 385, 'Shark', 1], [1, 385, 'Shark', 1], [2, 554, 'Fire rune', 300]]);
    const mine: TradeItem[] = [{ slot: 0, id: 385, name: 'Shark', count: 2 }, { slot: 1, id: 554, name: 'Fire rune', count: 300 }];
    const theirs: TradeItem[] = [{ slot: 0, id: 1127, name: 'Rune platebody', count: 2 }];
    const trade = (t: Partial<TradeState>): TradeState => ({ isOpen: true, screen: 'offer', partner: 'Cairn H05', myOffer: [], theirOffer: [], myAccepted: false, partnerAccepted: false, ...t });
    const closed: TradeState = { isOpen: false, screen: null, partner: null, myOffer: [], theirOffer: [], myAccepted: false, partnerAccepted: false };
    const methods = (sdk: FakeSdk) => sdk.sent.splice(0).map(a => a.method);

    test('offers the package in one burst, re-accepts after the partner\'s hand-back resets it, confirms, and reports what came back', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1, inventory: kit, trade: trade({}) }));
        const result = giveOpenTrade(sdk as unknown as BotSDK, {} as BotActions, 'cairn_h05', kit);
        await flush();
        // Two shark slots go in one exact press, the runes in one, the accept behind them.
        expect(methods(sdk)).toEqual(['sendOfferItem', 'sendOfferItem', 'sendAcceptTrade']);
        // The scored account's items land after our accept: both accepts reset.
        sdk.tick({ inventory: [], trade: trade({ myOffer: mine, theirOffer: theirs }) });
        await flush();
        expect(methods(sdk)).toEqual(['sendAcceptTrade']);
        sdk.tick({ trade: trade({ screen: 'confirm', myOffer: mine, theirOffer: theirs, partnerAccepted: true }) });
        await flush();
        expect(methods(sdk)).toEqual(['sendAcceptTrade']);
        sdk.tick({ inventory: inv([[0, 1127, 'Rune platebody', 1], [1, 1127, 'Rune platebody', 1]]), trade: closed });
        const r = await result;
        expect(r.success).toBe(true);
        expect(r.gave.map(i => [i.id, i.count]).sort()).toEqual([[385, 2], [554, 300]]);
        expect(r.received.map(i => [i.id, i.count])).toEqual([[1127, 2]]);
        expect(methods(sdk)).toEqual([]);
    });

    test('a trade open with anyone else gives nothing', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1, inventory: kit, trade: trade({ partner: 'Cairn H06' }) }));
        const r = await giveOpenTrade(sdk as unknown as BotSDK, {} as BotActions, 'cairn_h05', kit);
        expect(r.success).toBe(false);
        expect(sdk.sent).toEqual([]);
    });
});

describe('pre-request (lib/trade.ts decideTradeClick)', () => {
    const SCORED = { index: 9, name: 'Cairn Scored', combatLevel: 3, x: 0, z: 0, distance: 4 };
    const open: TradeState = { isOpen: true, screen: 'offer', partner: 'Cairn Scored', myOffer: [], theirOffer: [], myAccepted: false, partnerAccepted: false };
    const f = (tick: number, extra: Partial<BotWorldState> = {}) => baseState({ tick, nearbyPlayers: [SCORED], ...extra } as Partial<BotWorldState>);
    /** Frames through decidePreRequest; each click's result comes back at once. Returns the ticks a request went out on. */
    function run(frames: BotWorldState[], ready = true, click: ClickCtx = newClickCtx()): number[] {
        const sent: number[] = [];
        for (const s of frames) {
            const d = decidePreRequest(s, click, 'cairn_scored', ready);
            click = d.next;
            if (d.send !== undefined) {
                expect(d.send).toBe(9);
                sent.push(s.tick);
                click = clickBack(click, click.sentTick, s.tick);
            }
        }
        return sent;
    }

    test('an open trade is never followed by a request, however long it stays open', () => {
        const frames = [f(10), ...Array.from({ length: 60 }, (_, i) => f(11 + i, { trade: open }))];
        expect(run(frames)).toEqual([10]);
    });

    test('a standing request is re-sent on observed ticks (RESEND_TICKS), not wall clock', () => {
        // the server answers each request "Sending trade offer..." on the tick after it
        const sent = (tick: number) => ({ type: 0, text: 'Sending trade offer...', sender: '', tick, fromSelf: false });
        const second = 10 + RESEND_TICKS;
        const frames = Array.from({ length: 2 * RESEND_TICKS + 1 }, (_, i) => f(10 + i, { gameMessages: [...(i >= 1 ? [sent(11)] : []), ...(10 + i > second ? [sent(second + 1)] : [])] }));
        expect(run(frames)).toEqual([10, second, second + RESEND_TICKS]);
    });

    test('no request while a click is pending, while no package is ready, or with the scored account beyond 12 tiles', () => {
        const pending = { ...newClickCtx(), sentTick: 10, backTick: -1, sends: 1 };
        expect(run([f(11), f(12), f(30)], true, pending)).toEqual([]);
        expect(run([f(10), f(11)], false)).toEqual([]);
        expect(run([f(10, { nearbyPlayers: [{ ...SCORED, distance: 13 }] } as Partial<BotWorldState>)])).toEqual([]);
    });
});

describe('staging: the giver serves only exactly the package', () => {
    const held = countById([{ id: 1637, count: 20 }]);
    test('anything extra, anything short, or nothing staged is refused', () => {
        const rings = Array.from({ length: 20 }, (_, i) => ({ slot: i, id: 1637, name: 'Sapphire ring', count: 1, optionsWithIndex: [] }));
        expect(stagedExactly(rings, held)).toMatchObject({ exact: true });
        expect(stagedExactly([...rings, { slot: 20, id: 1511, name: 'Logs', count: 1, optionsWithIndex: [] }], held)).toMatchObject({ exact: false, extra: ['Logs x1'] });
        expect(stagedExactly(rings.slice(1), held)).toMatchObject({ exact: false, short: [1637] });
        expect(stagedExactly(rings, null).exact).toBe(false);
    });
});
