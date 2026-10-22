import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { BotActions } from '../../sdk/actions';
import type { BotSDK } from '../../sdk/index';
import type { BankItem, BotWorldState, InventoryItem, TradeItem, TradeState } from '../../sdk/types';
import { baseState, FakeSdk, flush } from '../lib/fake-sdk';
import { clickBack, newClickCtx, RESEND_TICKS, type ClickCtx } from '../lib/trade';
import {
    accountMatches,
    afterServe,
    canonName,
    countById,
    courierPicks,
    cueEpoch,
    decidePreRequest,
    firstSlotPerId,
    giveOpenTrade,
    holds,
    isStackableName,
    muleOptions,
    packageItems,
    packageOf,
    muleCueAction,
    newCue,
    packageForCue,
    requestPackage,
    planPackage,
    playerPattern,
    sameItems,
    serveStaged,
    stagedExactly,
    toRegExps,
    topUpCounts,
    type Package
} from './mule';
import { ASK_SLACK_MS, readTopUpAsk, usableAsk, writeTopUpAsk, type CueScope } from './altar-cue';

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

    test('a cue scoped to a hand-off asks for the package keyed to it, for the account the mule serves only', () => {
        const keyed: Package[] = [
            { name: 'h4k', scope: { step: 'H4k', family: 'mule' }, items: [{ item: 'Rune axe', amount: 1 }] },
            { name: 'h4e', scope: { step: 'H4e', family: 'mule' }, items: [{ item: 'Law rune', amount: 1 }], onRequest: true },
        ];
        const dir = mkdtempSync(join(tmpdir(), 'mule-cue-'));
        const cue = requestPackage(dir, 'cairn_h94', 'H4e', { tick: 10, ms: 1_000 });
        expect(cue.scope).toEqual({ step: 'H4e', family: 'mule' });
        expect(packageForCue(cue, keyed, 'Cairn H94')?.name).toBe('h4e');
        expect(packageForCue(cue, keyed, 'cairn_h95')).toBeNull();
        expect(packageForCue({ ...cue, scope: { step: 'S07', family: 'mule' } }, keyed, 'cairn_h94')).toBeNull();
        expect(packageForCue({ ...cue, scope: { step: 'H4e', family: 'bone' } }, keyed, 'cairn_h94')).toBeNull();
        expect(packageForCue(cue, pkgs, 'cairn_h94')).toBeNull(); // unkeyed packages answer no cue
    });

    test('a cue session asks once; a rewrite of it asks nothing; a stop withdraws the request', () => {
        const start = 1_000_000;
        const c = { session: 'a', seq: 1, ms: start };
        expect(muleCueAction(c, null, start)).toBe('ask');
        expect(muleCueAction({ ...c, seq: 2 }, { session: 'a', seq: 1 }, start)).toBe('none'); // fresh beacons: the served package is not re-staged
        expect(muleCueAction({ ...c, seq: 3, stop: true }, { session: 'a', seq: 2 }, start)).toBe('stop');
        expect(muleCueAction({ ...c, seq: 3, stop: true }, { session: 'a', seq: 3 }, start)).toBe('none'); // seen already
        expect(muleCueAction({ ...c, session: 'b' }, { session: 'a', seq: 3 }, start)).toBe('ask');
        expect(muleCueAction({ ...c, session: 'b', stop: true }, { session: 'a', seq: 3 }, start)).toBe('stop');
        expect(muleCueAction({ ...c, ms: start - 120_000 }, null, start)).toBe('none');
    });

    test('a mule the launcher logged in on a cue serves that cue, however long the login took', () => {
        const now = 2_000_000;
        expect(cueEpoch({}, now)).toBe(now);
        expect(cueEpoch({ LOGIN_CUE_MS: 'soon' }, now)).toBe(now);
        const opened = now - 5 * 60_000; // H12o's cue opened, then a slow login
        const epoch = cueEpoch({ LOGIN_CUE_MS: String(opened) }, now);
        expect(epoch).toBe(opened);
        expect(muleCueAction({ session: 'h12o', seq: 1, ms: opened }, null, epoch)).toBe('ask');
        expect(muleCueAction({ session: 'h12o', seq: 1, ms: opened }, null, now)).toBe('none'); // without it: stale
        expect(cueEpoch({ LOGIN_CUE_MS: String(now + 1000) }, now)).toBe(now); // never later than the start
    });

    test('a cue is acted on once: a new session or a later write; never one from before the mule started', () => {
        const start = 1_000_000;
        const c = { session: 'a', seq: 1, ms: start };
        expect(newCue(c, null, start)).toBe(true);
        expect(newCue(c, { session: 'a', seq: 1 }, start)).toBe(false);
        expect(newCue({ ...c, seq: 2 }, { session: 'a', seq: 1 }, start)).toBe(true);
        expect(newCue({ ...c, session: 'b' }, { session: 'a', seq: 5 }, start)).toBe(true);
        expect(newCue({ ...c, ms: start - 120_000 }, null, start)).toBe(false);
        expect(newCue(null, null, start)).toBe(false);
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
        for (const n of ['Coins', 'Law rune', 'Rune arrows', 'Mithril dart tips', 'Feather', 'Rune arrowtips', 'Thread', 'Nails']) expect(isStackableName(n)).toBe(true);
        for (const n of ['Rune essence', 'Logs', 'Shark', 'Rune platebody', 'Knife']) expect(isStackableName(n)).toBe(false);
        expect(isStackableName('Rune knife')).toBe(true);
    });
});

describe('order mode with packages served on request', () => {
    const p = (name: string, onRequest = false): Package => ({ name, items: [{ item: 'Logs', amount: 1 }], ...(onRequest ? { onRequest: true as const } : {}) });
    const ordered = [p('h4k'), p('h6'), p('h4p')];

    test('the due package served: the order advances', () => {
        expect(afterServe(ordered, 1, ordered[1]!)).toEqual({ nextIndex: 2, pending: ordered[2]! });
        expect(afterServe(ordered, 2, ordered[2]!)).toEqual({ nextIndex: 3, pending: null });
    });

    test('a fallback asked for by name in between (H4e): the due package comes up again, none skipped', () => {
        expect(afterServe(ordered, 1, p('h4e', true))).toEqual({ nextIndex: 1, pending: ordered[1]! });
    });

    test('packageOf reads onRequest, and only as a boolean', () => {
        expect(packageOf({ name: 'h4e', items: [{ item: 'Law rune', amount: 1 }], onRequest: true })).toEqual({ name: 'h4e', items: [{ item: 'Law rune', amount: 1 }], onRequest: true });
        expect(packageOf({ name: 'h6', items: [{ item: 'Law rune', amount: 1 }], onRequest: false })).toEqual({ name: 'h6', items: [{ item: 'Law rune', amount: 1 }] });
        expect(() => packageOf({ name: 'x', items: [], onRequest: 'yes' })).toThrow('onRequest must be true or false');
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

describe('top-up lines (H12 `shark to 15`): the count comes from the scored account\'s scoped ask', () => {
    const SCOPE: CueScope = { step: 'S15', family: 'mule' };
    const SHARK = 385;
    const GOLD = 2357;
    const sharks = (n: number, from = 0): InventoryItem[] => Array.from({ length: n }, (_, i) => ({ slot: from + i, id: SHARK, name: 'Shark', count: 1, optionsWithIndex: [] }));
    const gold: InventoryItem = { slot: 15, id: GOLD, name: 'Gold bar', count: 1, optionsWithIndex: [] };
    const h12 = packageOf({ name: 'h12', scope: SCOPE, items: [{ item: 'Gold bar', amount: 1 }, { item: 'Shark', topUp: { max: 15 } }] });
    const ask = (items: { item: string; count: number | 'all' }[]) => ({ items });
    const trade = (t: Partial<TradeState>): TradeState => ({ isOpen: true, screen: 'offer', partner: 'Cairn Scored', myOffer: [], theirOffer: [], myAccepted: false, partnerAccepted: false, ...t });
    const closed: TradeState = { isOpen: false, screen: null, partner: null, myOffer: [], theirOffer: [], myAccepted: false, partnerAccepted: false };
    const sends = (sdk: FakeSdk) => sdk.sent.splice(0).map(a => [a.method, ...a.args]);
    const settle = async () => {
        for (let i = 0; i < 5; i++) await flush();
    };

    test('options: { item | id, topUp: { max } } with the package scope (family mule); a fixed package is parsed exactly as before', () => {
        expect(h12).toEqual({ name: 'h12', scope: SCOPE, items: [{ item: 'Gold bar', amount: 1 }, { item: 'Shark', topUp: { max: 15 } }] });
        expect(packageOf({ name: 'wine', items: [{ item: 'Jug of wine', amount: 28 }] })).toEqual({ name: 'wine', items: [{ item: 'Jug of wine', amount: 28 }] });
        expect(() => packageItems('p', [{ item: 'Shark', amount: 2, topUp: { max: 15 } }])).toThrow(/no amount/);
        expect(() => packageItems('p', [{ item: 'Shark', topUp: { max: 0 } }])).toThrow(/topUp.max/);
        expect(() => packageItems('p', [{ item: 'Shark', topUp: {} }])).toThrow(/topUp.max/);
        expect(() => packageOf({ name: 'p', items: [{ item: 'Shark', topUp: { max: 15 } }] })).toThrow(/scope/);
        expect(() => packageOf({ name: 'p', scope: { step: 'S18', family: 'courier' }, items: [{ item: 'Shark', topUp: { max: 15 } }] })).toThrow(/family must be mule/);
        // A fixed package may carry its scope: the key a cue asks for it by.
        expect(packageOf({ name: 'p', scope: SCOPE, items: [{ item: 'Shark', amount: 2 }] })).toEqual({ name: 'p', scope: SCOPE, items: [{ item: 'Shark', amount: 2 }] });
        expect(() => packageOf({ name: 'p', scope: { step: 'H4', family: 'bone' }, items: [{ item: 'Shark', amount: 2 }] })).toThrow(/family must be mule/);
        expect(() => muleOptions({ requestFile: '/tmp/x' })).toThrow(/requestFile is gone/);
        expect(() => packageOf({ name: 'p', scope: SCOPE, items: [{ item: 'Shark', amount: 2 }, { item: 'shark', topUp: { max: 15 } }] })).toThrow(/another line/);
        const o = muleOptions({ packages: [{ name: 'wine', items: [{ item: 'Jug of wine', amount: 28 }] }] }, { RC_CUE_DIR: '/tmp/cue-x' });
        expect(o).toMatchObject({ askWaitTicks: 3, cueDir: '/tmp/cue-x', packages: [{ name: 'wine', items: [{ item: 'Jug of wine', amount: 28 }] }] });
        expect(() => muleOptions({ askWaitTicks: -1 })).toThrow(/askWaitTicks/);
    });

    test('staging: a top-up line is staged up to its max, after the fixed lines, as far as the bank and the slots allow; never missing', () => {
        const plan = planPackage(h12, bank([[SHARK, 'Shark', 40], [GOLD, 'Gold bar', 3]]));
        expect(plan.withdrawals.map(w => [w.bankItem.id, w.amount, !!w.topUp])).toEqual([[GOLD, 1, false], [SHARK, 15, true]]);
        expect(plan.slots).toBe(16);
        expect(plan.missing).toEqual([]);
        expect(plan.topUpShort).toEqual([]);
        const few = planPackage(h12, bank([[SHARK, 'Shark', 7], [GOLD, 'Gold bar', 3]]));
        expect(few.withdrawals.map(w => [w.bankItem.id, w.amount])).toEqual([[GOLD, 1], [SHARK, 7]]);
        expect(few.topUpShort).toEqual([{ item: 'Shark', max: 15, staged: 7 }]);
        const none = planPackage(h12, bank([[GOLD, 'Gold bar', 3]]));
        expect(none.missing).toEqual([]);
        expect(none.topUpShort).toEqual([{ item: 'Shark', max: 15, staged: 0 }]);
        // 20 unnoted fixed slots leave room for 8 of the 15
        const full = planPackage(packageOf({ name: 'f', scope: SCOPE, items: [{ item: 'Jug of wine', amount: 20 }, { item: 'Shark', topUp: { max: 15 } }] }), bank([[1993, 'Jug of wine', 40], [SHARK, 'Shark', 40]]));
        expect(full.slots).toBe(28);
        expect(full.topUpShort).toEqual([{ item: 'Shark', max: 15, staged: 8 }]);
    });

    test('the clamp: the ask, within [0, max] and what the mule holds; all means up to max', () => {
        const inv15 = [...sharks(15), gold];
        const n = (a: ReturnType<typeof ask> | null, inventory = inv15) => topUpCounts(h12, inventory, a).map(t => [t.asked, t.n]);
        expect(n(ask([{ item: '^shark$', count: 9 }]))).toEqual([[9, 9]]);
        expect(n(ask([{ item: '^shark(?:\\(\\d\\))?$', count: 9 }]))).toEqual([[9, 9]]); // rs/393's itemPattern form
        expect(n(ask([{ item: '^shark$', count: 20 }]))).toEqual([[20, 15]]); // at most max
        expect(n(ask([{ item: '^shark$', count: 9 }]), [...sharks(7), gold])).toEqual([[9, 7]]); // at most what it holds
        expect(n(ask([{ item: '^shark$', count: 'all' }]), [...sharks(12), gold])).toEqual([['all', 12]]);
        expect(n(ask([{ item: '^lobster$', count: 4 }]))).toEqual([[null, 0]]); // names none of it
        expect(n(null)).toEqual([[null, 0]]); // no ask, none
        expect(topUpCounts(h12, inv15, ask([{ item: '^shark$', count: 9 }]))).toEqual([{ item: 'Shark', id: SHARK, max: 15, held: 15, asked: 9, n: 9 }]);
    });

    test('the scope gate (altar-cue usableAsk): a mule reader takes only its own scope; the courier only an unscoped ask', () => {
        const dir = mkdtempSync(join(tmpdir(), 'mule-ask-'));
        const mule = writeTopUpAsk(dir, [{ item: '^shark$', count: 9 }], 10_000, SCOPE);
        expect(readTopUpAsk(dir)).toEqual({ v: 2, items: [{ item: '^shark$', count: 9 }], ms: 10_000, scope: SCOPE });
        expect(usableAsk(mule, 10_000 + ASK_SLACK_MS, 0, SCOPE)).toEqual(mule);
        expect(usableAsk(mule, 10_000, 0, { step: 'S16', family: 'mule' })).toBeNull(); // another step
        expect(usableAsk(mule, 10_000, 0, { step: 'S15', family: 'courier' })).toBeNull(); // another family
        expect(usableAsk(mule, 10_000, 0)).toBeNull(); // the S18 courier never takes a mule ask
        const courier = writeTopUpAsk(dir, [{ item: 'bones$', count: 17 }], 10_000);
        expect(readTopUpAsk(dir)).toEqual({ v: 2, items: [{ item: 'bones$', count: 17 }], ms: 10_000 }); // unchanged shape, no scope key
        expect(usableAsk(courier, 10_000, 0)).toEqual(courier);
        expect(usableAsk(courier, 10_000, 0, SCOPE)).toBeNull(); // the mule never takes the courier's
        expect(usableAsk(mule, 10_000 + ASK_SLACK_MS + 1, 0, SCOPE)).toBeNull(); // written before the open
        expect(usableAsk(mule, 10_000, 10_000, SCOPE)).toBeNull(); // already served
        expect(() => writeTopUpAsk(dir, [{ item: '^shark$', count: 9 }], 1, { step: 'S15', family: 'nobody' as CueScope['family'] })).toThrow(/family/);
    });

    test('end to end: the ask is 9, so mule1 offers exactly 9 of its 15 sharks beside the fixed lines, and confirms', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'mule-ask-'));
        const staged = [...sharks(15), gold];
        const openMs = Date.now();
        writeTopUpAsk(dir, [{ item: '^shark(?:\\(\\d\\))?$', count: 9 }], openMs + 5, SCOPE);
        const sdk = new FakeSdk(baseState({ tick: 1, inventory: staged, trade: trade({}) }));
        const result = serveStaged(sdk as unknown as BotSDK, {} as BotActions, { partner: 'cairn_scored', pkg: h12, held: countById(staged), ask: { dir, openMs, lastServedMs: 0, maxTicks: 3 } });
        await settle();
        // The gold bar's All press first, the sharks' X of 9 last, then the accept.
        expect(sends(sdk)).toEqual([['sendOfferItem', 15, -1], ['sendOfferItem', 0, 9], ['sendAcceptTrade']]);
        const mine: TradeItem[] = [{ slot: 0, id: SHARK, name: 'Shark', count: 9 }, { slot: 1, id: GOLD, name: 'Gold bar', count: 1 }];
        sdk.tick({ inventory: sharks(6), trade: trade({ myOffer: mine, myAccepted: true }) });
        await flush();
        expect(sends(sdk)).toEqual([]);
        sdk.tick({ trade: trade({ screen: 'confirm', myOffer: mine, partnerAccepted: true }) });
        await flush();
        expect(sends(sdk)).toEqual([['sendAcceptTrade']]);
        sdk.tick({ trade: closed });
        const r = await result;
        expect(r.success).toBe(true);
        expect(r.gave.map(i => [i.id, i.count]).sort()).toEqual([[SHARK, 9], [GOLD, 1]].sort());
        expect(r.topUps).toEqual([{ item: 'Shark', id: SHARK, max: 15, held: 15, asked: 9, n: 9 }]);
        expect(r.ask?.ms).toBe(openMs + 5);
    });

    for (const [label, write] of [
        ['no ask at all', (_dir: string, _ms: number) => {}],
        ['an unscoped (S18 courier) ask', (dir: string, ms: number) => void writeTopUpAsk(dir, [{ item: '^shark$', count: 9 }], ms)],
        ['an ask for another step', (dir: string, ms: number) => void writeTopUpAsk(dir, [{ item: '^shark$', count: 9 }], ms, { step: 'S16', family: 'mule' })],
        ['an ask for another family', (dir: string, ms: number) => void writeTopUpAsk(dir, [{ item: '^shark$', count: 9 }], ms, { step: 'S15', family: 'courier' })]
    ] as const) {
        test(`${label}: after askWaitTicks the fixed lines go alone, no shark is offered, and it is logged`, async () => {
            const dir = mkdtempSync(join(tmpdir(), 'mule-ask-'));
            const staged = [...sharks(15), gold];
            const openMs = Date.now();
            write(dir, openMs + 5);
            const logs: string[] = [];
            const sdk = new FakeSdk(baseState({ tick: 1, inventory: staged, trade: trade({}) }));
            const result = serveStaged(sdk as unknown as BotSDK, {} as BotActions, { partner: 'cairn_scored', pkg: h12, held: countById(staged), ask: { dir, openMs, lastServedMs: 0, maxTicks: 3 }, log: m => logs.push(m) });
            for (let i = 0; i < 4; i++) {
                await Bun.sleep(25);
                expect(sdk.sent).toEqual([]); // nothing goes out while the ask is awaited
                sdk.tick();
            }
            for (let i = 0; i < 20 && !sdk.sent.some(a => a.method === 'sendAcceptTrade'); i++) {
                await Bun.sleep(25);
                sdk.tick();
            }
            expect(sends(sdk)).toEqual([['sendOfferItem', 15, -1], ['sendAcceptTrade']]);
            expect(logs).toContain('top-up: no usable ask; offering none of the top-up lines');
            for (let i = 0; i < 4; i++) sdk.tick({ trade: closed });
            const r = await result;
            expect(r.topUps).toEqual([{ item: 'Shark', id: SHARK, max: 15, held: 15, asked: null, n: 0 }]);
            expect(r.ask).toBeNull();
        });
    }

    test('a package without a top-up behaves exactly as before: no wait for an ask (even one addressed to the mule), all of each staged id', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'mule-ask-'));
        writeTopUpAsk(dir, [{ item: '^shark$', count: 1 }], Date.now(), SCOPE);
        const kit = inv([[0, SHARK, 'Shark', 1], [1, SHARK, 'Shark', 1], [2, 554, 'Fire rune', 300]]);
        const pkg = packageOf({ name: 'kit', items: [{ item: 'Shark', amount: 2 }, { item: 'Fire rune', amount: 300 }] });
        const sdk = new FakeSdk(baseState({ tick: 1, inventory: kit, trade: trade({ partner: 'Cairn H05' }) }));
        const result = serveStaged(sdk as unknown as BotSDK, {} as BotActions, { partner: 'cairn_h05', pkg, held: countById(kit), ask: { dir, openMs: 0, lastServedMs: 0, maxTicks: 3 } });
        await flush();
        expect(sends(sdk)).toEqual([['sendOfferItem', 0, -1], ['sendOfferItem', 2, -1], ['sendAcceptTrade']]);
        const mine: TradeItem[] = [{ slot: 0, id: SHARK, name: 'Shark', count: 2 }, { slot: 1, id: 554, name: 'Fire rune', count: 300 }];
        sdk.tick({ inventory: [], trade: trade({ partner: 'Cairn H05', myOffer: mine, myAccepted: true }) });
        sdk.tick({ trade: trade({ partner: 'Cairn H05', screen: 'confirm', myOffer: mine, partnerAccepted: true }) });
        await flush();
        sdk.tick({ trade: closed });
        const r = await result;
        expect(r).toMatchObject({ success: true, topUps: [], ask: null });
        expect(r.gave.map(i => [i.id, i.count]).sort()).toEqual([[SHARK, 2], [554, 300]]);
        expect(planPackage(pkg, bank([[SHARK, 'Shark', 10], [554, 'Fire rune', 1000]])).topUpShort).toEqual([]);
    });
});
