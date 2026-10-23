import { describe, expect, test } from 'bun:test';
import type { BotWorldState, GameMessage } from '../../sdk/types';
import type { BotSDK } from '../../sdk/index';
import { baseState, FakeSdk, flush, type SentAction } from '../lib/fake-sdk';
import { give } from '../lib/trade';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ASK_SLACK_MS, nameHash, newRequestFrom, readTopUpAsk, usableAsk, writeTopUpAsk } from './altar-cue';
import type { Cue } from './altar-cue';
import type { RoleContext } from './role';
import { askOffer, BoneGiver, boneGiverOptions, boneServer, boneWithdrawals, returnWants, carryDue, groupLoadsDone, isFinalLoad, legRan, loadOffer, npcTiles, onOpenSide, onSide, partnerIs, readBoneStatuses, requestUntilOpen, S07_SITES, sideTiles, wallBetween, type BoneStatus, type FlagReader } from './bone-giver';
import { assertDemoStandIn } from './bone-receiver';

const o = { noReplyTicks: 3, resendTicks: 100 };
const msg = (tick: number, text: string): GameMessage => ({ type: 0, text, sender: '', tick, fromSelf: false });
const SENT = 'Sending trade offer...';

function frame(tick: number, messages: GameMessage[] = [], open = false): BotWorldState {
    return baseState({
        tick,
        gameMessages: messages,
        ...(open ? { trade: { isOpen: true, screen: 'offer', partner: 'x', myOffer: [], theirOffer: [], myAccepted: false, partnerAccepted: false } } : {})
    } as Partial<BotWorldState>);
}

// When a click may go out is lib/trade.ts decideTradeClick, tested in trade.test.ts.

/** boneGiverOptions with the mode's scope (S07 bone, S18 courier) unless the test gives one. */
const bgo = (raw: Record<string, unknown>, env?: Record<string, string | undefined>) =>
    boneGiverOptions({ scope: raw.mode === 'on-request' ? { step: 'S18', family: 'courier' } : { step: 'S07', family: 'bone' }, ...raw }, env);

describe('a group of bone givers takes turns (S07 b01-b04)', () => {
    const now = 50_000;
    const st = (account: string, phase: BoneStatus['phase'], readyAt: number | null, extra: Partial<BoneStatus> = {}): BoneStatus => ({ v: 1, account, phase, held: 23, n: 23, trades: 0, bounces: 0, tile: null, readyAt, session: null, final: false, loads: null, ms: now - 500, ...extra });
    const GROUP = ['cairn_b01', 'cairn_b02', 'cairn_b03', 'cairn_b04'];

    test('the server is the giver already requesting or trading; else the loaded giver waiting longest', () => {
        expect(boneServer([st('cairn_b01', 'waiting', 100), st('cairn_b02', 'requested', 900), st('cairn_b03', 'waiting', 50)], GROUP, now)).toBe('cairn_b02');
        expect(boneServer([st('cairn_b01', 'waiting', 100), st('cairn_b03', 'waiting', 50)], GROUP, now)).toBe('cairn_b03');
        expect(boneServer([st('Cairn B04', 'trading', 10)], GROUP, now)).toBe('Cairn B04');
    });

    test('restocking, empty-handed, stale and outside-the-group givers are never the server', () => {
        const statuses = [
            st('cairn_b01', 'restock', null),
            st('cairn_b02', 'waiting', 10, { held: 0 }),
            st('cairn_b03', 'waiting', 20, { ms: now - 6_000 }),
            st('cairn_h70', 'requested', 5)
        ];
        expect(boneServer(statuses, GROUP, now)).toBeUndefined();
        expect(boneServer([...statuses, st('cairn_b04', 'waiting', 999)], GROUP, now)).toBe('cairn_b04');
    });

    describe("the group's last load (finalExtras on one giver, rs/147's ruling)", () => {
        // 16 loads on 4 givers; b03 carries T07-08's runes. trades split so the group has given `done`.
        const at = (done: number, phases: Partial<Record<string, BoneStatus['phase']>> = {}, session = 's1') => {
            const per = [Math.ceil(done / 4), Math.ceil((done - 1) / 4), Math.ceil((done - 2) / 4), Math.ceil((done - 3) / 4)].map(x => Math.max(0, x));
            return GROUP.map((a, i) => st(a, phases[a] ?? 'waiting', 100 * (i + 1), { trades: per[i]!, session, loads: 16, final: a === 'cairn_b03' }));
        };

        test('the group count adds up its givers in the session, an ended giver included and another run\'s file not', () => {
            expect(groupLoadsDone(at(11, { cairn_b01: 'off' }), GROUP)).toBe(11);
            const other = st('cairn_b04', 'off', null, { trades: 9, session: 'old', ms: now - 900_000 });
            const mixed = [...at(11).filter(s => s.account !== 'cairn_b04'), other];
            expect(groupLoadsDone(mixed, GROUP, 's1')).toBe(at(11).filter(s => s.account !== 'cairn_b04').reduce((n, s) => n + s.trades, 0));
            // Without a session given, every status of the group counts, as before sessions (the step passes none yet).
            expect(groupLoadsDone(mixed, GROUP)).toBe(groupLoadsDone(mixed, GROUP, 's1') + 9);
        });

        test('statuses written without session, final or loads (main\'s fixtures, older files): the server is the oldest ready, as before', () => {
            const bare = (account: string, phase: BoneStatus['phase'], readyAt: number | null) =>
                ({ v: 1, account, phase, held: 23, n: 23, trades: 0, bounces: 0, tile: null, readyAt, ms: now - 500 }) as unknown as BoneStatus;
            const statuses = [bare('cairn_b02', 'waiting', 300), bare('cairn_b01', 'waiting', 100), bare('cairn_b03', 'restock', null)];
            expect(boneServer(statuses, GROUP, now)).toBe('cairn_b01');
            expect(groupLoadsDone(statuses, GROUP)).toBe(0);
            // With a session asked for, a status in no session (a giver yet to read the cue) still counts;
            // one in another session does not.
            expect(boneServer(statuses, GROUP, now, 's1')).toBe('cairn_b01');
            expect(boneServer(statuses.map(x => ({ ...x, session: 'old' })), GROUP, now, 's1')).toBeUndefined();
        });

        test('the last load goes to the final giver alone, even when another has waited longer', () => {
            expect(boneServer(at(15), GROUP, now)).toBe('cairn_b03');
            expect(boneServer(at(15, { cairn_b03: 'restock' }), GROUP, now)).toBeUndefined();
        });

        test('within one rotation of the last load the final giver waits it out; before that it takes its turn', () => {
            // done 12-14: fewer than 4 loads before the last, so b03 is passed over though it is oldest of b03, b04.
            for (const done of [12, 13, 14]) expect(boneServer(at(done, { cairn_b01: 'restock', cairn_b02: 'restock' }), GROUP, now)).toBe('cairn_b04');
            expect(boneServer(at(11, { cairn_b01: 'restock', cairn_b02: 'restock' }), GROUP, now)).toBe('cairn_b03');
        });

        test('no server once the group has given its loads; without a final giver the last load is anyone\'s', () => {
            expect(boneServer(at(16), GROUP, now)).toBeUndefined();
            const plain = at(15).map(s => ({ ...s, final: false }));
            expect(boneServer(plain, GROUP, now)).toBe('cairn_b01');
        });

        test('options: the final giver carries a whole load and the extras on every trip', () => {
            const RUNES = [
                { item: 'Law rune', count: 1 },
                { item: 'Air rune', count: 5 }
            ];
            expect(bgo({ group: GROUP, trades: 16, finalExtras: RUNES })).toMatchObject({ n: 23, finalN: 21, trades: 16 });
            expect(() => bgo({ group: GROUP, trades: 16, n: 27, finalExtras: RUNES })).toThrow(/fit 28 slots/);
            expect(() => bgo({ group: GROUP, trades: 16, finalN: 23, n: 22, finalExtras: RUNES })).toThrow(/finalN must be at most n/);
        });
    });

    test('a relaunched giver resumes its trades from its own status file in the same session, and only then', () => {
        const dir = mkdtempSync(join(tmpdir(), 'bone-resume-'));
        writeFileSync(join(dir, 'bones-cairn_b02.json'), JSON.stringify(st('cairn_b02', 'restock', null, { trades: 3, session: 's1' })));
        const logs: string[] = [];
        const ctx = (account: string) => ({ account, options: { group: GROUP, cueDir: dir, scope: { step: 'S07', family: 'bone' } }, sdk: { getState: () => null }, log: (m: string) => logs.push(m) }) as unknown as RoleContext;
        const cue = (session: string) => ({ session }) as unknown as Cue;
        const trades = (g: BoneGiver) => (g as unknown as { trades: number }).trades;
        const same = new BoneGiver(ctx('cairn_b02'));
        same.onCue(cue('s1'));
        expect(trades(same)).toBe(3);
        expect(logs).toEqual(['resumed']);
        const other = new BoneGiver(ctx('cairn_b02'));
        other.onCue(cue('s2'));
        expect(trades(other)).toBe(0);
        // Only the first cue decides: a later cue of the old session changes nothing.
        other.onCue(cue('s1'));
        expect(trades(other)).toBe(0);
    });

    test('status files round-trip from the cue directory', () => {
        const dir = mkdtempSync(join(tmpdir(), 'bone-status-'));
        writeFileSync(join(dir, 'bones-cairn_b01.json'), JSON.stringify(st('cairn_b01', 'waiting', 7)));
        writeFileSync(join(dir, 'giver-cairn_t01.json'), JSON.stringify({ v: 1, account: 'cairn_t01' }));
        expect(readBoneStatuses(dir).map(s => [s.account, s.readyAt])).toEqual([['cairn_b01', 7]]);
        expect(readBoneStatuses(join(dir, 'missing'))).toEqual([]);
    });

    test('options: a group of two or more distinct names, standing mode only', () => {
        expect(bgo({ group: ['cairn_b01', 'Cairn B02'] }).group).toEqual(['cairn_b01', 'cairn_b02']);
        expect(bgo({}).group).toEqual([]);
        expect(() => bgo({ group: ['cairn_b01'] })).toThrow(/at least two/);
        expect(() => bgo({ group: ['cairn_b01', 'cairn_b01'] })).toThrow(/twice/);
        const site = [{ giver: { x: 1, z: 2 }, receiver: { x: 1, z: 3 } }];
        expect(() => bgo({ mode: 'on-request', sites: site, group: ['cairn_b01', 'cairn_b02'] })).toThrow(/standing mode/);
    });
});

describe('the item priority list (S07: dragon bones first, then babydragon, from each giver\'s own bank)', () => {
    const MIX = ['Dragon bones', 'Babydragon bones'];
    const specs = (xs: readonly { item: unknown; n?: unknown }[]) => xs.map(s => [String(s.item), s.n]);

    test('a single item behaves as before: one spec of the whole load, from the one item', () => {
        const o = bgo({});
        expect(o.items).toEqual(['Dragon bones']);
        expect(specs(loadOffer(o, 0))).toEqual([['/^Dragon bones$/i', 23]]);
        expect(specs(loadOffer(o, 0, () => 5))).toEqual([['/^Dragon bones$/i', 23]]);
        expect(boneWithdrawals([{ name: 'Dragon bones', count: 40 }, { name: 'Babydragon bones', count: 99 }], o.items, 23)).toEqual({ specs: [{ item: /^Dragon bones$/i, n: 23 }], short: 0 });
    });

    test('the bank fills a load from the first bone it still holds, then the next', () => {
        const bank = (d: number, b: number) => [{ name: 'Dragon bones', count: d }, { name: 'Babydragon bones', count: b }, { name: 'Law rune', count: 1 }];
        expect(specs(boneWithdrawals(bank(63, 200), MIX, 23).specs)).toEqual([['/^Dragon bones$/i', 23]]);
        expect(specs(boneWithdrawals(bank(17, 200), MIX, 23).specs)).toEqual([['/^Dragon bones$/i', 17], ['/^Babydragon bones$/i', 6]]);
        expect(specs(boneWithdrawals(bank(0, 200), MIX, 23).specs)).toEqual([['/^Babydragon bones$/i', 23]]);
        expect(boneWithdrawals(bank(5, 10), MIX, 23).short).toBe(8);
    });

    test('the load offers what is carried, first item first; the last load keeps finalN and the extras', () => {
        const o = bgo({ item: MIX, group: ['cairn_b01', 'cairn_b02'], trades: 4, finalExtras: [{ item: 'Law rune', count: 1 }, { item: 'Air rune', count: 5 }] });
        const carried = (d: number, b: number) => (name: string) => (name === 'Dragon bones' ? d : b);
        expect(specs(loadOffer(o, 0, carried(17, 6)))).toEqual([['/^Dragon bones$/i', 17], ['/^Babydragon bones$/i', 6]]);
        expect(specs(loadOffer(o, 0, carried(0, 23)))).toEqual([['/^Babydragon bones$/i', 23]]);
        // The final giver holds 23 and offers 21, dragon first, beside the runes.
        expect(specs(loadOffer(o, 3, carried(10, 13)))).toEqual([['/^Dragon bones$/i', 10], ['/^Babydragon bones$/i', 11], ['/^Law rune$/i', 1], ['/^Air rune$/i', 5]]);
    });

    test('options: distinct names, the standing mode only; labSeed on the bank restock only', () => {
        expect(bgo({ item: MIX }).item).toBe('Dragon bones');
        expect(() => bgo({ item: [] })).toThrow(/non-empty list/);
        expect(() => bgo({ item: ['Dragon bones', 'dragon bones'] })).toThrow(/twice/);
        const site = [{ giver: { x: 1, z: 2 }, receiver: { x: 1, z: 3 } }];
        expect(() => bgo({ mode: 'on-request', sites: site, item: MIX })).toThrow(/standing mode/);
        expect(bgo({ restock: { kind: 'bank', labSeed: [{ obj: 'cert_dragon_bones', n: 30 }] } }).restock.labSeed).toEqual([{ obj: 'cert_dragon_bones', n: 30 }]);
        expect(() => bgo({ restock: { kind: 'cheat', labSeed: [{ obj: 'x', n: 1 }] } })).toThrow(/labSeed/);
    });
});

describe('trade-and-return (rehearsal only)', () => {
    test('acceptReturn is off by default and only for the standing mode with a bank restock', () => {
        expect(bgo({}).acceptReturn).toBe(false);
        expect(bgo({ acceptReturn: true }).acceptReturn).toBe(true);
        expect(() => bgo({ acceptReturn: true, restock: { kind: 'cheat' } })).toThrow(/restock kind bank/);
        const site = [{ giver: { x: 1, z: 2 }, receiver: { x: 1, z: 3 } }];
        expect(() => bgo({ mode: 'on-request', sites: site, acceptReturn: true })).toThrow(/standing mode/);
        expect(() => bgo({ acceptReturn: 'yes' })).toThrow(/true or false/);
    });

    test('what it wants back is what it gave, merged by name', () => {
        expect(returnWants([{ name: 'Dragon bones', count: 7 }, { name: 'Babydragon bones', count: 16 }, { name: 'Dragon bones', count: 0 }, { name: 'Law rune', count: 1 }])).toEqual([
            { name: 'Dragon bones', count: 7 },
            { name: 'Babydragon bones', count: 16 },
            { name: 'Law rune', count: 1 }
        ]);
    });

    test("the demo stand-in that returns every load may be any helper but a forbidden name or one of the givers", () => {
        expect(() => assertDemoStandIn('cairn_h94', { returnLoads: true, givers: ['cairn_b01', 'cairn_b02'] })).not.toThrow();
        expect(() => assertDemoStandIn('cairn_b01', { returnLoads: true, givers: ['cairn_b01', 'cairn_b02'] })).toThrow(/neither forbidden nor a giver/);
        expect(() => assertDemoStandIn('cairn', { returnLoads: true, givers: [] })).toThrow(/neither forbidden/);
        // Burying, it is still a run-machine test account only.
        expect(() => assertDemoStandIn('cairn_h94')).toThrow(/run-machine test account/);
    });
});

describe('legRan: a leg ran when it beat one tile a tick', () => {
    test('Falador west bank to the oak tile (126 tiles) in 105 ticks ran; in 130 it is undecided; no position, no verdict', () => {
        const bank = { x: 2946, z: 3368 };
        const oak = { x: 2913, z: 3494 };
        expect(legRan(oak, bank, 105)).toBe(true);
        expect(legRan(oak, bank, 130)).toBeNull();
        expect(legRan({ x: -1, z: -1 }, bank, 50)).toBeNull();
        expect(legRan(oak, bank, 0)).toBeNull();
    });
});

describe('the demo stand-in (bone-receiver off the lab)', () => {
    test('runs only as a run-machine test account, never a fleet, giver or forbidden name', () => {
        expect(() => assertDemoStandIn('cairn_h75')).not.toThrow();
        expect(() => assertDemoStandIn('Cairn H75')).not.toThrow();
        for (const name of ['cairn_h51', 'cairn_b01', 'cairn_mule1', 'cairn_dot_md']) expect(() => assertDemoStandIn(name)).toThrow(/run-machine test account/);
    });
});

describe('bone giver options', () => {
    test('the cue scope is required: bone for the standing mode (S07), courier for on-request (S18)', () => {
        expect(() => boneGiverOptions({})).toThrow(/^scope: a cue scope/);
        expect(bgo({}).scope).toEqual({ step: 'S07', family: 'bone' });
        expect(() => boneGiverOptions({ scope: { step: 'S18', family: 'courier' } })).toThrow(/scope.family must be bone/);
        const site = [{ giver: { x: 1, z: 2 }, receiver: { x: 1, z: 3 } }];
        expect(() => boneGiverOptions({ mode: 'on-request', sites: site, scope: { step: 'S07', family: 'bone' } })).toThrow(/scope.family must be courier/);
    });

    test('defaults: 23 dragon bones, the S07 oak then willow sites, bank restock, until stopped', () => {
        const r = bgo({}, { RC_CUE_DIR: '/tmp/cue' });
        expect(r).toMatchObject({ item: 'Dragon bones', n: 23, siteWaitTicks: 30, noReplyTicks: 2, resendTicks: 100, cueDir: '/tmp/cue' });
        expect(r.sites).toEqual(S07_SITES);
        expect(r.restock.kind).toBe('bank');
        expect(r.trades).toBe(Number.POSITIVE_INFINITY);
        // The giver stands on a tile next to the receiver's.
        for (const s of r.sites) expect(Math.abs(s.giver.x - s.receiver.x) + Math.abs(s.giver.z - s.receiver.z)).toBe(1);
    });

    test('validation', () => {
        expect(() => bgo({ n: 0 })).toThrow(/n must be/);
        expect(() => bgo({ n: 29 })).toThrow(/n must be/);
        expect(() => bgo({ sites: [] })).toThrow(/sites/);
        expect(() => bgo({ sites: [{ giver: { x: 1 }, receiver: { x: 1, z: 2 } }] })).toThrow(/giver needs/);
        expect(() => bgo({ restock: { kind: 'trade' } })).toThrow(/restock.kind/);
        expect(bgo({ trades: 2, restock: { kind: 'cheat' } })).toMatchObject({ trades: 2, restock: { kind: 'cheat' } });
    });
});

describe('finalExtras: the last S07 load also carries T07-08\'s Camelot runes', () => {
    const RUNES = [{ item: 'Law rune', count: 1, obj: 'lawrune' }, { item: 'Air rune', count: 5, obj: 'airrune' }];
    const o = bgo({ trades: 3, finalExtras: RUNES }, {});
    const names = (load: number) => loadOffer(o, load).map(s => [String(s.item), s.n]);

    test('the last load offers bones and runes; earlier loads bones only', () => {
        expect(names(0)).toEqual([['/^Dragon bones$/i', 23]]);
        expect(names(1)).toEqual([['/^Dragon bones$/i', 23]]);
        expect(isFinalLoad(o, 2)).toBe(true);
        // The last load fits the same 23 free slots: 21 bones and the two rune stacks.
        expect(names(2)).toEqual([['/^Dragon bones$/i', 21], ['/^Law rune$/i', 1], ['/^Air rune$/i', 5]]);
        expect(names(2)).toEqual(loadOffer({ ...o, finalN: 21 }, 2).map(s => [String(s.item), s.n]));
        expect(loadOffer(bgo({ trades: 3, finalN: 23, finalExtras: RUNES }, {}), 2)[0]!.n).toBe(23);
        // Without finalExtras no load is special.
        const plain = bgo({ trades: 3 }, {});
        expect(isFinalLoad(plain, 2)).toBe(false);
        expect(loadOffer(plain, 2)).toHaveLength(1);
    });

    test('options: needs a finite trades count, the standing mode, 28 slots, and obj for the lab cheat', () => {
        expect(() => bgo({ finalExtras: RUNES }, {})).toThrow(/needs trades/);
        expect(() => bgo({ trades: 3, finalN: 27, finalExtras: RUNES }, {})).toThrow(/28 slots/);
        expect(() => bgo({ trades: 3, finalN: 0, finalExtras: RUNES }, {})).toThrow(/finalN/);
        expect(bgo({ trades: 3, n: 28, finalExtras: RUNES }, {})).toMatchObject({ finalN: 26 });
        expect(bgo({ trades: 3 }, {}).finalN).toBe(23);
        expect(() => bgo({ trades: 3, finalExtras: [{ item: 'Law rune', count: 0 }] }, {})).toThrow(/whole count/);
        expect(() => bgo({ trades: 3, restock: { kind: 'cheat' }, finalExtras: [{ item: 'Law rune', count: 1 }] }, {})).toThrow(/obj/);
        const site = [{ giver: { x: 1, z: 2 }, receiver: { x: 1, z: 3 } }];
        expect(() => bgo({ mode: 'on-request', sites: site, trades: 3, finalExtras: RUNES }, {})).toThrow(/standing/);
    });

    test('the last load is one burst of three All presses, and the scored account\'s offer is never accepted (no expectTheirs)', async () => {
        const bones = Array.from({ length: 21 }, (_, slot) => ({ slot, id: 536, name: 'Dragon bones', count: 1, optionsWithIndex: [] }));
        const inventory = [...bones, { slot: 21, id: 563, name: 'Law rune', count: 1, optionsWithIndex: [] }, { slot: 22, id: 556, name: 'Air rune', count: 5, optionsWithIndex: [] }];
        const trade = { isOpen: true, screen: 'offer' as const, partner: 'Scored Player', myOffer: [], theirOffer: [], myAccepted: false, partnerAccepted: false };
        const sdk = new FakeSdk(baseState({ tick: 10, inventory, trade } as Partial<BotWorldState>));
        const r = give(sdk, 'Scored Player', loadOffer(o, 2), { openTimeoutMs: 5_000, maxTicks: 6 });
        await flush();
        expect(sdk.sent.splice(0).map(a => [a.method, ...a.args])).toEqual([['sendOfferItem', 0, -1], ['sendOfferItem', 21, -1], ['sendOfferItem', 22, -1], ['sendAcceptTrade']]);
        const mine = [{ slot: 0, id: 536, name: 'Dragon bones', count: 21 }, { slot: 1, id: 563, name: 'Law rune', count: 1 }, { slot: 2, id: 556, name: 'Air rune', count: 5 }];
        const theirs = [{ slot: 0, id: 1351, name: 'Bronze axe', count: 1 }];
        // The scored account puts something up: both accepts reset, and the giver does not re-accept.
        for (let i = 0; i < 3; i++) {
            sdk.tick({ trade: { ...trade, myOffer: mine, theirOffer: theirs } });
            await flush();
        }
        expect(sdk.sent.filter(a => a.method === 'sendAcceptTrade')).toHaveLength(0);
        // On the confirm screen it declines.
        sdk.tick({ trade: { ...trade, screen: 'confirm', myOffer: mine, theirOffer: theirs, partnerAccepted: true } });
        expect(await r).toMatchObject({ ok: false, reason: 'partner confirm offer is not acceptable' });
        expect(sdk.sent.map(a => a.method)).toEqual(['sendDeclineTrade']);
    });
});

describe('on-request mode (S18 top-ups)', () => {
    const scored = 'Cairn H75';
    const hash = nameHash('cairn_h75');
    const req = (tick: number, sender: string): GameMessage => ({ type: 4, text: 'wishes to trade with you.', sender, tick, fromSelf: false });

    test('a request from the scored account is found by its name hash, newest first, only after the last answered', () => {
        const s = frame(20, [req(12, scored), req(18, scored), req(19, 'Someone Else'), msg(19, 'wishes to trade with you.')]);
        expect(newRequestFrom(s, hash, -1)).toBe(18);
        expect(newRequestFrom(s, hash, 18)).toBeNull();
        expect(newRequestFrom(s, nameHash('someone_else'), 0)).toBe(19);
    });

    test('the ask: written by the scored side at the open, used for the trade opened since, once', () => {
        const dir = mkdtempSync(join(tmpdir(), 'bone-ask-'));
        expect(readTopUpAsk(dir)).toBeNull();
        const a = writeTopUpAsk(dir, [{ item: 'bones$', count: 17 }, { item: '^shark$', count: 2 }], 10_000);
        expect(readTopUpAsk(dir)).toEqual(a);
        // the courier saw the trade open a little after the scored side wrote: within the slack
        expect(usableAsk(a, 10_000 + ASK_SLACK_MS, 0)).toEqual(a);
        // written before this trade opened: an earlier trade's ask, never sized onto this one
        expect(usableAsk(a, 10_000 + ASK_SLACK_MS + 1, 0)).toBeNull();
        expect(usableAsk(a, 10_000, 10_000)).toBeNull(); // already served
        expect(() => writeTopUpAsk(dir, [])).toThrow(/at least one/);
        expect(() => writeTopUpAsk(dir, [{ item: 'bones$', count: 0 }])).toThrow(/count/);
        expect(() => writeTopUpAsk(dir, [{ item: '(', count: 1 }])).toThrow(/compile/);
    });

    test('askOffer: each asked item it holds, at most the count, one spec per item; short items reported', () => {
        const inv = [
            ...Array.from({ length: 20 }, () => ({ name: 'Babydragon bones', count: 1 })),
            { name: 'Shark', count: 1 },
            { name: 'Adamant arrowtips', count: 2070 }
        ];
        const r = askOffer({ items: [{ item: 'bones$', count: 18 }, { item: '^shark$', count: 2 }, { item: '^adamant arrow(head|tip)s$', count: 'all' }, { item: '^rune arrow(head|tip)s$', count: 'all' }] }, inv);
        expect(r.specs.map(s => [String(s.item), s.n])).toEqual([['/bones$/i', 18], ['/^shark$/i', 1], ['/^adamant arrow(head|tip)s$/i', 'all']]);
        expect(r.short).toEqual([{ item: '^shark$', asked: 2, held: 1 }, { item: '^rune arrow(head|tip)s$', asked: 'all', held: 0 }]);
    });

    test('carryDue: a once stack drops out after it is delivered; the rest stay', () => {
        const carry = [{ item: 'Shark', count: 2 }, { item: 'Adamant arrowtips', count: 2070, once: true }, { item: 'Rune arrowtips', count: 570, once: true }];
        expect(carryDue(carry, new Set())).toHaveLength(3);
        expect(carryDue(carry, new Set(['adamant arrowtips'])).map(c => c.item)).toEqual(['Shark', 'Rune arrowtips']);
    });

    test('options: on-request needs a waiting site; hold and refill bounds; carry, standing and askWaitTicks', () => {
        expect(() => bgo({ mode: 'on-request' })).toThrow(/needs sites/);
        const site = [{ giver: { x: 2655, z: 3306 }, receiver: { x: 2655, z: 3305 } }];
        expect(bgo({ mode: 'on-request', sites: site })).toMatchObject({ mode: 'on-request', hold: 28, refillBelow: 21, carry: [], standing: false, askWaitTicks: 2 });
        expect(() => bgo({ mode: 'on-request', sites: site, hold: 20, refillBelow: 21 })).toThrow(/refillBelow/);
        expect(() => bgo({ mode: 'sometimes' })).toThrow(/mode/);
        const courier = bgo({ mode: 'on-request', sites: site, item: 'Babydragon bones', hold: 22, refillBelow: 15, standing: true, carry: [{ item: 'Shark', count: 2 }, { item: 'Rune arrowtips', count: 570, once: true }] });
        expect(courier).toMatchObject({ obj: 'babydragon_bones', standing: true, carry: [{ item: 'Shark', count: 2 }, { item: 'Rune arrowtips', count: 570, once: true }] });
        expect(() => bgo({ carry: [{ item: 'Shark', count: 2 }] })).toThrow(/on-request mode/);
        expect(() => bgo({ standing: true })).toThrow(/on-request mode/);
        expect(() => bgo({ mode: 'on-request', sites: site, standing: 'yes' })).toThrow(/standing/);
        expect(() => bgo({ mode: 'on-request', sites: site, restock: { kind: 'cheat' }, carry: [{ item: 'Shark', count: 2 }] })).toThrow(/obj/);
    });
});

describe('requestUntilOpen: the shared standing request', () => {
    const hash = nameHash('Scored Player');
    const scored = { index: 7, name: 'Scored Player', x: 0, z: 0, level: 0, distance: 1, combatLevel: 3 } as unknown as BotWorldState['nearbyPlayers'][number];
    const ctx = (sdk: FakeSdk) => ({ sdk: sdk as unknown as BotSDK, signal: new AbortController().signal });
    const hooks = (sdk: FakeSdk) => ({ receiver: () => sdk.getState()!.nearbyPlayers.find(p => nameHash(p.name) === hash), stopped: () => false, log: () => {} });

    test('requests the receiver found by hash once, and resolves when its click opens the trade', async () => {
        const sdk = new FakeSdk(baseState({ tick: 10, nearbyPlayers: [scored] } as Partial<BotWorldState>));
        const done = requestUntilOpen(ctx(sdk), o, hooks(sdk));
        sdk.tick({ gameMessages: [msg(11, SENT)] });
        sdk.tick();
        sdk.tick({ trade: { isOpen: true, screen: 'offer', partner: 'Scored Player', myOffer: [], theirOffer: [], myAccepted: false, partnerAccepted: false } });
        const r = await done;
        expect(r).toMatchObject({ ok: true, sends: 1, bounces: 0 });
        expect(sdk.sent.filter(a => a.method === 'sendTradeRequest').map(a => a.args[0])).toEqual([7]);
        expect(partnerIs(sdk.getState(), hash)).toBe(true);
        expect(partnerIs(sdk.getState(), nameHash('someone else'))).toBe(false);
    });

    test("the trade opens on the frame after the click (rs/197's demo): no second request goes out", async () => {
        const sdk = new FakeSdk(baseState({ tick: 10, nearbyPlayers: [scored] } as Partial<BotWorldState>));
        const done = requestUntilOpen(ctx(sdk), o, hooks(sdk));
        await Promise.resolve();
        const open = { isOpen: true, screen: 'offer' as const, partner: 'Scored Player', myOffer: [], theirOffer: [], myAccepted: false, partnerAccepted: false };
        sdk.tick({ trade: open, gameMessages: [msg(11, SENT)] });
        expect(await done).toMatchObject({ ok: true, sends: 1, waited: 1 });
        for (let i = 0; i < 4; i++) sdk.tick({ trade: open });
        expect(sdk.sent.filter(a => a.method === 'sendTradeRequest')).toHaveLength(1);
    });

    test('a click the relay holds (its result back 20 ticks later) is not re-sent behind it: a re-click would close the trade it opens', async () => {
        const release: Array<() => void> = [];
        class Held extends FakeSdk {
            override sendAction(a: SentAction) {
                if (a.method !== 'sendTradeRequest') return super.sendAction(a);
                this.sent.push(a);
                return new Promise<{ success: boolean; message: string }>(done => release.push(() => done({ success: true, message: 'ok' })));
            }
        }
        const sdk = new Held(baseState({ tick: 10, nearbyPlayers: [scored] } as Partial<BotWorldState>));
        const done = requestUntilOpen(ctx(sdk), o, hooks(sdk));
        for (let i = 0; i < 20; i++) {
            await Promise.resolve();
            sdk.tick();
        }
        release.shift()!();
        await Promise.resolve();
        sdk.tick({ gameMessages: [msg(31, SENT)] });
        sdk.tick({ gameMessages: [msg(31, SENT)] });
        sdk.tick({ trade: { isOpen: true, screen: 'offer', partner: 'Scored Player', myOffer: [], theirOffer: [], myAccepted: false, partnerAccepted: false } });
        expect(await done).toMatchObject({ ok: true });
        expect(sdk.sent.filter(a => a.method === 'sendTradeRequest')).toHaveLength(1);
    });

    test('gives up once the receiver is out of sight for more than 10 frames', async () => {
        const sdk = new FakeSdk(baseState({ tick: 10, nearbyPlayers: [] } as Partial<BotWorldState>));
        const done = requestUntilOpen(ctx(sdk), o, hooks(sdk));
        for (let i = 0; i < 12; i++) sdk.tick();
        expect(await done).toMatchObject({ ok: false, reason: 'receiver left sight', sends: 0 });
    });
});

describe('S18 side tile: the giver holds an orthogonal neighbour of the scored account', () => {
    const scored = { x: 2662, z: 3305 };
    const knight = { x: 2663, z: 3305 };
    const open: FlagReader = () => false;

    test('every chosen tile is orthogonally adjacent and never the knight\'s, whichever tile the giver starts from', () => {
        for (let dx = -3; dx <= 3; dx++) {
            for (let dz = -3; dz <= 3; dz++) {
                const me = { x: scored.x + dx, z: scored.z + dz };
                const sides = sideTiles(scored, me, [knight], open);
                expect(sides).toHaveLength(3);
                for (const t of sides) {
                    expect(onSide(t, scored)).toBe(true);
                    expect(t).not.toEqual(knight);
                }
            }
        }
    });

    test('the nearest side first: from a corner, one step', () => {
        const sides = sideTiles(scored, { x: scored.x - 1, z: scored.z + 1 }, [knight], open);
        expect(Math.abs(sides[0]!.x - (scored.x - 1)) + Math.abs(sides[0]!.z - (scored.z + 1))).toBe(1);
    });

    test('corners and 2 tiles off are not a side; NPC footprints block every tile they cover', () => {
        expect(onSide({ x: scored.x + 1, z: scored.z + 1 }, scored)).toBe(false);
        expect(onSide({ x: scored.x + 2, z: scored.z }, scored)).toBe(false);
        expect(onSide({ x: scored.x, z: scored.z - 1 }, scored)).toBe(true);
        const s = baseState({ nearbyNpcs: [{ kind: 'npc', id: 1, index: 3, name: 'Knight of Ardougne', x: 9, z: 9, tileX: scored.x - 2, tileZ: scored.z - 1, size: 2 }] } as unknown as Partial<BotWorldState>);
        const tiles = npcTiles(s);
        expect(tiles).toContainEqual({ x: scored.x - 1, z: scored.z });
        expect(sideTiles(scored, scored, tiles, open).some(t => t.x === scored.x - 1 && t.z === scored.z)).toBe(false);
        expect(sideTiles(scored, scored, [knight, ...tiles, { x: scored.x, z: scored.z + 1 }, { x: scored.x, z: scored.z - 1 }], open)).toEqual([]);
    });
});

describe('S18 side tile: never across a wall edge from the scored account', () => {
    // The Ardougne knights' walled column as the SDK collision map has it (rs/459's probe of
    // sdk/pathfinding.ts isFlagged): x=2672 carries WALL_EAST (8) and x=2673 WALL_WEST (128) at
    // z 3299-3303 and 3306-3310; z 3304-3305 is a gap. 2673,3300 also carries LOC (256), a blocking loc.
    const flags = new Map<string, number>();
    const set = (x: number, z: number, f: number) => flags.set(`${x},${z}`, (flags.get(`${x},${z}`) ?? 0) | f);
    for (const z of [3299, 3300, 3301, 3302, 3303, 3306, 3307, 3308, 3309, 3310]) {
        set(2672, z, 8);
        set(2673, z, 128);
    }
    set(2673, 3300, 256);
    const ardougne: FlagReader = (x, z, mask) => ((flags.get(`${x},${z}`) ?? 0) & mask) !== 0;

    test('the side across the x=2672 east-edge wall is refused, from either side of it', () => {
        const west = { x: 2672, z: 3300 };
        const east = { x: 2673, z: 3300 };
        const fromWest = sideTiles(west, east, [], ardougne);
        expect(fromWest).not.toContainEqual(east);
        expect(fromWest).toHaveLength(3);
        expect(sideTiles(east, west, [], ardougne)).not.toContainEqual(west);
        expect(onOpenSide(east, west, ardougne)).toBe(false);
        expect(onOpenSide(west, east, ardougne)).toBe(false);
    });

    test('a wall flagged on only one of the two tiles still counts', () => {
        const oneSided: FlagReader = (x, z, mask) => x === 2673 && z === 3300 && (mask & 128) !== 0;
        expect(wallBetween({ x: 2672, z: 3300 }, { x: 2673, z: 3300 }, oneSided)).toBe(true);
        expect(wallBetween({ x: 2673, z: 3300 }, { x: 2672, z: 3300 }, oneSided)).toBe(true);
        expect(wallBetween({ x: 2672, z: 3300 }, { x: 2672, z: 3301 }, oneSided)).toBe(false);
    });

    test('open-ground sides are kept, nearest first, and the gap in the wall is open', () => {
        const scored = { x: 2672, z: 3300 };
        expect(sideTiles(scored, { x: 2671, z: 3301 }, [], ardougne)).toEqual([
            { x: 2671, z: 3300 },
            { x: 2672, z: 3301 },
            { x: 2672, z: 3299 }
        ]);
        const gap = { x: 2672, z: 3304 };
        expect(sideTiles(gap, gap, [], ardougne)).toContainEqual({ x: 2673, z: 3304 });
        expect(onOpenSide({ x: 2673, z: 3304 }, gap, ardougne)).toBe(true);
    });

    test('a blocking loc tile (a stall) with no wall on the shared edge is kept', () => {
        // 2673,3300's wall is on its west edge; from 2674,3300 the shared edge is its east one.
        const scored = { x: 2674, z: 3300 };
        expect(sideTiles(scored, scored, [], ardougne)).toContainEqual({ x: 2673, z: 3300 });
        expect(onOpenSide({ x: 2673, z: 3300 }, scored, ardougne)).toBe(true);
    });

    test('every side walled or occupied leaves none (stepToSide\'s "no free side tile")', () => {
        const scored = { x: 2672, z: 3300 };
        expect(sideTiles(scored, scored, [{ x: 2671, z: 3300 }, { x: 2672, z: 3301 }, { x: 2672, z: 3299 }], ardougne)).toEqual([]);
        const boxed: FlagReader = (x, z, mask) => x === scored.x && z === scored.z && (mask & (2 | 8 | 32 | 128)) !== 0;
        expect(sideTiles(scored, scored, [], boxed)).toEqual([]);
    });
});

describe('awaitBoneServer counts only the cue session it is given', () => {
    test("a status another run left (41 loads given) makes the unscoped count the last load; with the cue's session the oldest ready giver serves", async () => {
        const { awaitBoneServer } = await import('./bone-giver');
        const { mkdtempSync, writeFileSync } = await import('node:fs');
        const { tmpdir } = await import('node:os');
        const { join } = await import('node:path');
        const dir = mkdtempSync(join(tmpdir(), 'bone-await-'));
        const now = Date.now();
        const G = ['cairn_b01', 'cairn_b02', 'cairn_b03', 'cairn_b04'];
        const put = (account: string, s: Record<string, unknown>) =>
            writeFileSync(join(dir, `bones-${account}.json`), JSON.stringify({ v: 1, account, phase: 'waiting', held: 23, n: 23, trades: 0, bounces: 0, tile: null, readyAt: now - 9_000, session: 's-now', final: false, loads: 42, ms: now, ...s }));
        put('cairn_b01', { readyAt: now - 9_000 });
        put('cairn_b02', { readyAt: now - 5_000 });
        put('cairn_b03', { readyAt: now - 4_000 });
        put('cairn_b04', { readyAt: now - 3_000, final: true });
        // An earlier run's file for the same account name would be overwritten; a renamed copy stands in for a stale writer.
        put('cairn_b02-old', { account: 'cairn_b02', trades: 41, session: 's-old', phase: 'off', readyAt: null });
        const sdk = { getState: () => ({ tick: 7 }) } as never;
        expect((await awaitBoneServer(sdk, dir, G, 5, 's-now')).server).toBe('cairn_b01');
        expect((await awaitBoneServer(sdk, dir, G, 5)).server).toBe('cairn_b04');
    });
});
