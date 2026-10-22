import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BotWorldState } from '../../sdk/types';
import { baseState, FakeSdk, flush } from '../lib/fake-sdk';
import { fakeClock, microtasks, useFakeTicks } from '../lib/fake-ticks';
import { nameHash, readStatuses } from './altar-cue';
import { AltarGiver, essencePresses, giverOptions } from './altar-giver';
import type { RoleContext } from './role';

const RECEIVER = 'cairn_scored';
const ESSENCE = { slot: 0, id: 1436, name: 'Rune essence', count: 27, optionsWithIndex: [] };

let dir = '';
const tickEnv = process.env.SPEEDRUN_TICK_MS;
beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'altar-giver-test-'));
    process.env.SPEEDRUN_TICK_MS = '5';
});
afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
    if (tickEnv === undefined) delete process.env.SPEEDRUN_TICK_MS;
    else process.env.SPEEDRUN_TICK_MS = tickEnv;
});

const SCOPE = { step: 'S21', family: 'altar' } as const;

function giverWith(sdk: FakeSdk, options: Record<string, unknown> = {}): AltarGiver {
    const ctx = { sdk, bot: {}, account: 'cairn_rcg1', options: { altar: 'nature', cueDir: dir, scope: SCOPE, ...options }, log: () => {}, reportBank: () => {}, signal: new AbortController().signal } as unknown as RoleContext;
    return new AltarGiver(ctx);
}

/** Arm a turn by hand and run it, as serve() does. */
function runTurn(g: AltarGiver, turn: { T: number; myT: number; armedTick: number; schedule?: string }): Promise<string> {
    const a = { key: `s1:${turn.T}`, session: 's1', seq: 1, open: 5, schedule: 'stock', receiverHash: nameHash(RECEIVER), ...turn };
    const inner = g as unknown as { armed: unknown; execute(a: unknown): Promise<string> };
    inner.armed = a;
    return inner.execute(a);
}

describe('altar-giver cue', () => {
    test("a new session's first cue cancels the old session's armed turn and arms the new session's turn for us at once", () => {
        const sdk = new FakeSdk(baseState({ tick: 100, inventory: [ESSENCE] }));
        const g = giverWith(sdk);
        const inner = g as unknown as { armed: { key: string } | null; phase: string; frames: { add(t: number, ms: number): unknown }; onCue(c: unknown): void };
        const ms = Date.now();
        inner.frames.add(100, ms);
        // armed (not started) for the robust restart's turn when the stock rung opens its own session
        inner.phase = 'armed';
        inner.armed = { key: 's1:120', session: 's1', seq: 4, T: 120, myT: 120, open: 5, schedule: 'robust', receiverHash: nameHash(RECEIVER), armedTick: 99 } as unknown as { key: string };
        inner.onCue({ v: 1, scope: SCOPE, session: 's2', seq: 1, receiver: { sha256: nameHash(RECEIVER) }, beacons: [{ tick: 100, ms }], schedule: 'robust', open: 5, turns: [{ giver: 'cairn_rcg1', T: 103, schedule: 'stock' }], ms });
        expect(inner.armed?.key).toBe('s2:103');
        expect(inner.phase).toBe('armed');
    });
});

/** `n` essence, one per slot from slot 0, and the talisman behind them. */
const essenceInv = (n: number) => [...Array.from({ length: n }, (_, slot) => ({ ...ESSENCE, slot, count: 1 })), { slot: n, id: 1438, name: 'Air talisman', count: 1, optionsWithIndex: [] }];

describe('altar-giver offers exactly `essence` by count (S06 at 26 a load, rs/158)', () => {
    const near = { nearbyPlayers: [{ index: 9, name: RECEIVER, combatLevel: 3, x: 0, z: 0, distance: 1 }] } as unknown as Partial<BotWorldState>;
    const offers = (sdk: FakeSdk) => sdk.sent.filter(a => a.method === 'sendOfferItem').map(a => a.args);

    test('27 held, 26 wanted: 10, 10, 5, 1 on the highest essence slot (the engine takes from the lowest first); exactly 26 held: one All', () => {
        expect(essencePresses(baseState({ inventory: essenceInv(27) }), 26)).toEqual([10, 10, 5, 1].map(amount => ({ slot: 26, amount })));
        expect(essencePresses(baseState({ inventory: essenceInv(26) }), 26)).toEqual([{ slot: 25, amount: -1 }]);
        expect(essencePresses(baseState({ inventory: essenceInv(27) }), 27)).toEqual([{ slot: 26, amount: -1 }]);
        // Five or more presses would push the accept past the tick's 5 user events: one Offer-X instead.
        expect(essencePresses(baseState({ inventory: essenceInv(27) }), 24)).toEqual([{ slot: 26, amount: 24 }]);
        expect(essencePresses(baseState({ inventory: essenceInv(25) }), 26)).toBeNull();
    });

    test('a blind tuned turn with 27 held and essence 26 offers 26 by count, never All, with the accept behind on the same frame', async () => {
        const sdk = new FakeSdk(baseState({ tick: 100, inventory: essenceInv(27), ...near }));
        const turn = runTurn(giverWith(sdk, { essence: 26 }), { T: 103, myT: 103, armedTick: 100, schedule: 'tuned' });
        await flush();
        // request lands on T+5 (sent 107), offer and accept on T+6 (sent 108)
        for (let t = 101; t <= 108; t++) {
            sdk.tick({ tick: t });
            await flush();
        }
        expect(offers(sdk)).toEqual([[26, 10], [26, 10], [26, 5], [26, 1]]);
        const methods = sdk.sent.map(a => a.method);
        expect(methods.slice(methods.indexOf('sendOfferItem'))).toEqual(['sendOfferItem', 'sendOfferItem', 'sendOfferItem', 'sendOfferItem', 'sendClickComponent']);
        for (let t = 109; t <= 113; t++) sdk.tick({ tick: t });
        expect(await turn).toBe('missed'); // nobody traded
    });

    test('a stock turn with 27 held and essence 26 offers one exact-count press of 26', async () => {
        const sdk = new FakeSdk(baseState({ tick: 100, inventory: essenceInv(27), ...near }));
        const turn = runTurn(giverWith(sdk, { essence: 26 }), { T: 103, myT: 103, armedTick: 100 });
        await flush();
        sdk.tick({ trade: { isOpen: true, screen: 'offer', partner: RECEIVER, myOffer: [], theirOffer: [], myAccepted: false, partnerAccepted: false } });
        await flush();
        await flush();
        expect(offers(sdk)).toEqual([[0, 26]]);
        expect(sdk.sent.at(-1)?.method).toBe('sendAcceptTrade');
        for (let i = 0; i < 40; i++) sdk.tick();
        expect(await turn).toBe('missed');
    });
});

describe('altar-giver stock turn', () => {
    const near = { nearbyPlayers: [{ index: 9, name: RECEIVER, combatLevel: 3, x: 0, z: 0, distance: 1 }] } as unknown as Partial<BotWorldState>;

    test('requests on the frame it is armed, not on T+K-1, and re-sends on each busy refusal until the receiver is free', async () => {
        // The scored side wrote T three ticks past its craft frame; its request from that frame was
        // dropped (it was delayed). T+K-1 is our frame 107.
        const sdk = new FakeSdk(baseState({ tick: 100, inventory: [ESSENCE], ...near }));
        const turn = runTurn(giverWith(sdk), { T: 103, myT: 103, armedTick: 100 });
        await flush();
        expect(sdk.sent.filter(a => a.method === 'sendTradeRequest')).toEqual([{ method: 'sendTradeRequest', args: [9] }]);
        sdk.push({ tick: 101, gameMessages: [{ type: 0, text: 'Cairn_scored is busy at the moment.', sender: '', tick: 101, fromSelf: false }] });
        await flush();
        expect(sdk.sent.filter(a => a.method === 'sendTradeRequest')).toHaveLength(2);
        // nobody answers: the turn ends missed at the judge tick, and says why
        expect(await turn).toBe('missed');
    });

    test('a turn that did not give reports ready afresh, which lifts the scored side\'s skip (MissBench)', async () => {
        const sdk = new FakeSdk(baseState({ tick: 100, inventory: [ESSENCE] }));
        const g = giverWith(sdk);
        const inner = g as unknown as { phase: string; readyAt: number | null; frames: { add(t: number, ms: number): unknown } };
        inner.phase = 'armed';
        inner.readyAt = 1;
        inner.frames.add(100, Date.now());
        const before = Date.now();
        expect(await runTurn(g, { T: 103, myT: 103, armedTick: 100 })).toBe('no-receiver');
        expect(inner.readyAt).toBeGreaterThanOrEqual(before);
    });

    test('a role whose client stopped delivering ticks (the relay after a client death) keeps its old readyAt, so the skip holds', async () => {
        const sdk = new FakeSdk(baseState({ tick: 100, inventory: [ESSENCE] }));
        const g = giverWith(sdk);
        const inner = g as unknown as { phase: string; readyAt: number | null; frames: { add(t: number, ms: number): unknown } };
        inner.phase = 'armed';
        inner.readyAt = 1;
        inner.frames.add(100, Date.now() - 60_000);
        expect(await runTurn(g, { T: 103, myT: 103, armedTick: 100 })).toBe('no-receiver');
        expect(inner.readyAt).toBe(1);
    });

    test('a receiver out of sight is reported, with nothing sent', async () => {
        const sdk = new FakeSdk(baseState({ tick: 100, inventory: [ESSENCE] }));
        expect(await runTurn(giverWith(sdk), { T: 103, myT: 103, armedTick: 100 })).toBe('no-receiver');
        expect(sdk.sent.filter(a => a.method === 'sendTradeRequest')).toHaveLength(0);
    });
});

describe('the hand-back giver (S21: T21-22 Lumbridge runes, runecraft.ts HandBack)', () => {
    const RUNES = [
        { item: 'Law rune', n: 1 },
        { item: 'Air rune', n: 3 },
        { item: 'Earth rune', n: 1 }
    ];
    const talisman = { slot: 0, id: 1446, name: 'Body talisman', count: 1, optionsWithIndex: [] };
    const runeInv = [talisman, { slot: 1, id: 563, name: 'Law rune', count: 1, optionsWithIndex: [] }, { slot: 2, id: 556, name: 'Air rune', count: 3, optionsWithIndex: [] }, { slot: 3, id: 557, name: 'Earth rune', count: 1, optionsWithIndex: [] }];
    const near = { nearbyPlayers: [{ index: 9, name: RECEIVER, combatLevel: 3, x: 0, z: 0, distance: 1 }] } as unknown as Partial<BotWorldState>;
    const hbGiver = (sdk: FakeSdk) => giverWith(sdk, { altar: 'body', handBack: RUNES });

    test('options: a list of distinct items with whole counts, on the bank restock only', () => {
        expect(giverOptions({ scope: SCOPE, handBack: RUNES }).handBack).toEqual(RUNES);
        expect(giverOptions({ scope: SCOPE }).handBack).toBeUndefined();
        expect(() => giverOptions({ scope: SCOPE, handBack: [] })).toThrow(/non-empty/);
        expect(() => giverOptions({ scope: SCOPE, handBack: [{ item: 'Law rune', n: 0 }] })).toThrow(/whole n/);
        expect(() => giverOptions({ scope: SCOPE, handBack: [{ item: 'Law rune', n: 1 }, { item: 'law rune', n: 1 }] })).toThrow(/twice/);
        expect(() => giverOptions({ scope: SCOPE, handBack: RUNES, restock: { kind: 'cheat' } })).toThrow(/restock kind bank/);
    });

    test('carrying the runes and no essence, its status lists them under handBack with essence 0 (out of the essence feed)', () => {
        const sdk = new FakeSdk(baseState({ tick: 100, inventory: runeInv }));
        const g = hbGiver(sdk);
        (g as unknown as { publish(): void }).publish();
        const st = readStatuses(dir).find(s => s.account === 'cairn_rcg1')!;
        expect(st.handBack).toEqual(RUNES);
        expect(st.essence).toBe(0);
        // An essence giver, or the hand-back giver while still loaded with essence, lists nothing.
        const loaded = new FakeSdk(baseState({ tick: 100, inventory: [ESSENCE, ...runeInv.slice(1).map(i => ({ ...i, slot: i.slot + 1 }))] }));
        (hbGiver(loaded) as unknown as { publish(): void }).publish();
        expect(readStatuses(dir).find(s => s.account === 'cairn_rcg1')!.handBack).toBeUndefined();
    });

    test('a stock turn carrying the items offers exactly the three runes, never the talisman, and the giver is then done', async () => {
        const sdk = new FakeSdk(baseState({ tick: 100, inventory: runeInv, ...near }));
        const g = hbGiver(sdk);
        const turn = runTurn(g, { T: 103, myT: 103, armedTick: 100, items: RUNES } as never);
        await flush();
        expect(sdk.sent.filter(a => a.method === 'sendTradeRequest')).toHaveLength(1);
        const open = { isOpen: true, screen: 'offer' as const, partner: RECEIVER, myOffer: [], theirOffer: [], myAccepted: false, partnerAccepted: false };
        sdk.tick({ trade: open });
        await flush();
        await flush();
        const offered = sdk.sent.filter(a => a.method === 'sendOfferItem').map(a => a.args[0]);
        expect(offered.sort()).toEqual([1, 2, 3]);
        const offer = [
            { slot: 0, id: 563, name: 'Law rune', count: 1 },
            { slot: 1, id: 556, name: 'Air rune', count: 3 },
            { slot: 2, id: 557, name: 'Earth rune', count: 1 }
        ];
        sdk.tick({ trade: { ...open, myOffer: offer, myAccepted: true }, inventory: [talisman] });
        await flush();
        sdk.tick({ trade: { ...open, screen: 'confirm', myOffer: offer }, inventory: [talisman] });
        await flush();
        sdk.tick({ trade: undefined, inventory: [talisman] });
        await flush();
        expect(await turn).toBe('gave');
        const inner = g as unknown as { last: { detail?: string }; gave: number };
        expect(inner.last.detail).toBe('hand-back: 1 Law rune, 3 Air rune, 1 Earth rune');
        expect(inner.gave).toBe(0); // essence trades only
    });

    test('named for the wrong kind of turn, a giver reports not-ready and sends nothing', () => {
        const ms = Date.now();
        const cueFor = (turn: Record<string, unknown>) => ({ v: 1, scope: SCOPE, session: 's9', seq: 1, receiver: { sha256: nameHash(RECEIVER) }, beacons: [{ tick: 100, ms }], schedule: 'robust', open: 5, turns: [{ giver: 'cairn_rcg1', T: 103, schedule: 'stock', ...turn }], ms });
        type Inner = { phase: string; armed: unknown; last?: { outcome: string; detail?: string }; frames: { add(t: number, ms: number): unknown }; onCue(c: unknown): void };
        const ready = (g: AltarGiver) => {
            const inner = g as unknown as Inner;
            inner.frames.add(100, ms);
            inner.phase = 'ready';
            return inner;
        };
        // the hand-back giver named for essence
        const hb = ready(hbGiver(new FakeSdk(baseState({ tick: 100, inventory: runeInv, ...near }))));
        hb.onCue(cueFor({}));
        expect(hb.armed).toBeNull();
        expect(hb.last).toMatchObject({ outcome: 'not-ready', detail: 'named for essence while holding the hand-back' });
        // an essence giver named for the hand-back
        const eg = ready(giverWith(new FakeSdk(baseState({ tick: 100, inventory: [ESSENCE], ...near }))));
        eg.onCue(cueFor({ items: RUNES }));
        expect(eg.armed).toBeNull();
        expect(eg.last).toMatchObject({ outcome: 'not-ready', detail: 'named for a hand-back without its items' });
        // the hand-back giver named for the hand-back arms it, items and all
        const ok = ready(hbGiver(new FakeSdk(baseState({ tick: 100, inventory: runeInv, ...near }))));
        ok.onCue(cueFor({ items: RUNES }));
        expect(ok.armed).toMatchObject({ key: 's9:103', items: RUNES });
    });
});

// Last in the file: useFakeTicks restores SPEEDRUN_TICK_MS to what it was when the file loaded.
describe('altar-giver stock turn on a slow minute (fake timers)', () => {
    useFakeTicks(300);
    const near = { nearbyPlayers: [{ index: 9, name: RECEIVER, combatLevel: 3, x: 0, z: 0, distance: 1 }] } as unknown as Partial<BotWorldState>;

    test('the trade window counts observed ticks: a receiver answering 28 ticks in, at 340 ms a tick (9.5 s, past 30 x 300 ms), still gets the essence', async () => {
        const sdk = new FakeSdk(baseState({ tick: 100, inventory: [ESSENCE], ...near }));
        const turn = runTurn(giverWith(sdk), { T: 103, myT: 103, armedTick: 100 }); // judge 130: 30 ticks to trade in
        const step = async (patch: Partial<BotWorldState> = {}) => {
            fakeClock.advanceTimersByTime(340);
            sdk.tick(patch);
            await microtasks();
        };
        await microtasks();
        for (let i = 0; i < 27; i++) await step();
        const open = { isOpen: true, screen: 'offer' as const, partner: RECEIVER, myOffer: [], theirOffer: [], myAccepted: false, partnerAccepted: false };
        const offer = [{ slot: 0, id: 1436, name: 'Rune essence', count: 27 }];
        await step({ trade: open });
        await step({ trade: { ...open, myOffer: offer, myAccepted: true }, inventory: [] });
        await step({ trade: { ...open, screen: 'confirm', myOffer: offer }, inventory: [] });
        await step({ trade: { ...open, screen: 'confirm' }, inventory: [] });
        await step({ trade: undefined, inventory: [] });
        expect(await turn).toBe('gave');
    });
});
