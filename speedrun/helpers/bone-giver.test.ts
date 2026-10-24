import { describe, expect, test } from 'bun:test';
import type { BotWorldState, GameMessage } from '../../sdk/types';
import type { BotSDK } from '../../sdk/index';
import { baseState, FakeSdk, FakeTradePartner, flush, type SentAction } from '../lib/fake-sdk';
import { give } from '../lib/trade';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ASK_SLACK_MS, nameHash, newRequestFrom, readTopUpAsk, usableAsk, writeTopUpAsk } from './altar-cue';
import type { Cue } from './altar-cue';
import type { RoleContext } from './role';
import { askOffer, BoneGiver, boneGiverOptions, boneServer, boneWithdrawals, returnWants, carryDue, DEFAULT_BONE_BANK, groupLoadsDone, isFinalLoad, lastLoadGiven, legRan, loadBones, loadOffer, namedSite, npcTiles, onOpenSide, onSide, partnerIs, readBoneStatuses, requestUntilOpen, S07_SITES, sideTiles, wallBetween, type BoneStatus, type FlagReader, type Site } from './bone-giver';
import { CueWriter, readCue, readJson } from './altar-cue';
import { judgeStatus } from '../runner/phase-gate';
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
            // With a session asked for, a status in no session or another counts for nothing.
            expect(boneServer(statuses, GROUP, now, 's1')).toBeUndefined();
            expect(boneServer(statuses.map(x => ({ ...x, session: 'old' })), GROUP, now, 's1')).toBeUndefined();
            expect(groupLoadsDone(statuses.map(x => ({ ...x, trades: 41 })), GROUP, 's1')).toBe(0);
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
        const cue = (session: string) => ({ session, ms: Date.now() }) as unknown as Cue;
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

describe('the cue session binds the group count (rs/41 review)', () => {
    const G = ['cairn_b01', 'cairn_b02', 'cairn_b03', 'cairn_b04'];
    const RUNES = [
        { item: 'Law rune', count: 1 },
        { item: 'Air rune', count: 5 }
    ];
    const status = (account: string, o: Record<string, unknown>) => ({ v: 1, account, phase: 'waiting', held: 23, n: 23, trades: 0, bounces: 0, tile: null, readyAt: Date.now() - 9_000, session: null, final: false, loads: 42, ms: Date.now(), ...o });
    const put = (dir: string, file: string, s: Record<string, unknown>) => writeFileSync(join(dir, file), JSON.stringify(s));

    test('a stale file with no session or another one (41 trades, the final, off or waiting) adds no trades, no final and is never the server', () => {
        for (const stale of [{ session: null }, { session: 's-old' }]) {
            for (const phase of ['off', 'waiting']) {
                const dir = mkdtempSync(join(tmpdir(), 'bone-stale-'));
                put(dir, 'bones-cairn_b02.json', status('cairn_b02', { ...stale, phase, trades: 41, final: true, readyAt: phase === 'waiting' ? 1 : null }));
                put(dir, 'bones-cairn_b01.json', status('cairn_b01', { session: 's-now', readyAt: Date.now() - 5_000 }));
                put(dir, 'bones-cairn_b04.json', status('cairn_b04', { session: 's-now', final: true, readyAt: Date.now() - 4_000 }));
                const all = readBoneStatuses(dir);
                expect(groupLoadsDone(all, G, 's-now')).toBe(0);
                expect(boneServer(all, G, Date.now(), 's-now')).toBe('cairn_b01');
                // Unscoped, the stale 41 would make the next load the last, and a waiting stale final could take it.
                expect(groupLoadsDone(all, G)).toBe(41);
                if (phase === 'waiting') expect(boneServer(all, G, Date.now())).toBe('cairn_b02');
            }
        }
    });

    test('a status counts only from its own account file: a renamed or copied file claiming another account is no phantom and no double count', () => {
        const dir = mkdtempSync(join(tmpdir(), 'bone-phantom-'));
        put(dir, 'bones-cairn_b02.json', status('cairn_b02', { session: 's1', trades: 2 }));
        put(dir, 'bones-cairn_b02-old.json', status('cairn_b02', { session: 's1', trades: 9, readyAt: 1 }));
        put(dir, 'bones-cairn_b05.json', status('cairn_b02', { session: 's1', trades: 7, readyAt: 1 }));
        put(dir, 'bones-cairn_b03.json', status('cairn_b03', { session: 's1', trades: 1 }));
        const all = readBoneStatuses(dir);
        expect(all.map(s => [s.account, s.trades]).sort()).toEqual([['cairn_b02', 2], ['cairn_b03', 1]]);
        expect(groupLoadsDone(all, G, 's1')).toBe(3);
    });

    test('startup: givers publish before any cue, count only their own trades and pick no server; on reading the cue they republish in its session at once, and the receiver finds the oldest ready', async () => {
        const { awaitBoneServer } = await import('./bone-giver');
        const { CueWriter, readCue } = await import('./altar-cue');
        const dir = mkdtempSync(join(tmpdir(), 'bone-startup-'));
        // b02 is not running today: its file is an old run's, before sessions, 41 trades and the final.
        put(dir, 'bones-cairn_b02.json', status('cairn_b02', { trades: 41, final: true, readyAt: 1 }));
        const bones = Array.from({ length: 23 }, (_, i) => ({ slot: i, id: 536, name: 'Dragon bones', count: 1, optionsWithIndex: [] }));
        const state = baseState({ inventory: bones });
        const giver = (account: string) =>
            new BoneGiver({
                account,
                options: { group: G, trades: 42, cueDir: dir, scope: { step: 'S07', family: 'bone' }, ...(account === 'cairn_b04' ? { finalExtras: RUNES } : {}) },
                sdk: { getState: () => state },
                log: () => {}
            } as unknown as RoleContext);
        const live = ['cairn_b01', 'cairn_b03', 'cairn_b04'].map(giver);
        const priv = (g: BoneGiver) => g as unknown as { setPhase(p: string): void; loadsDone(): number; server(): string | undefined };
        for (const g of live) {
            priv(g).setPhase('waiting');
            await Bun.sleep(3);
        }
        expect(readBoneStatuses(dir).filter(s => s.account !== 'cairn_b02').every(s => s.session === null)).toBe(true);
        for (const g of live) {
            expect(priv(g).loadsDone()).toBe(0);
            expect(priv(g).server()).toBeUndefined();
        }
        const w = new CueWriter(dir, 'scored', { step: 'S07', family: 'bone' });
        w.write({ beacons: [{ tick: 1, ms: Date.now() }], turns: [] });
        const cue = readCue(dir)!;
        // Before the givers read it, nothing is in the cue's session: the receiver waits.
        expect(boneServer(readBoneStatuses(dir), G, Date.now(), cue.session)).toBeUndefined();
        for (const g of live) g.onCue(cue);
        const all = readBoneStatuses(dir);
        expect(all.filter(s => s.session === cue.session).map(s => s.account).sort()).toEqual(['cairn_b01', 'cairn_b03', 'cairn_b04']);
        expect(groupLoadsDone(all, G, cue.session)).toBe(0);
        expect(priv(live[0]!).loadsDone()).toBe(0);
        expect(priv(live[0]!).server()).toBe('cairn_b01');
        const sdk = { getState: () => ({ tick: 7 }) } as never;
        expect((await awaitBoneServer(sdk, dir, G, 5, cue.session)).server).toBe('cairn_b01');
    });
});

describe('a travel fault advances the site (attempt 2: b01-b04 looped on an unstandable willow tile)', () => {
    test('each failed travel moves the giver to the next site, wrapping, and the error still surfaces as the fault', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'bone-fault-'));
        const logs: Array<[string, unknown]> = [];
        const state = baseState();
        const g = new BoneGiver({
            account: 'cairn_b01',
            options: { cueDir: dir, scope: { step: 'S07', family: 'bone' } },
            sdk: { getState: () => state },
            signal: new AbortController().signal,
            log: (m: string, d?: unknown) => logs.push([m, d])
        } as unknown as RoleContext);
        const priv = g as unknown as { site: number; cycle(): Promise<void>; held(): number; travel(s: unknown): Promise<void> };
        priv.held = () => 23;
        const tried: unknown[] = [];
        priv.travel = async s => {
            tried.push(s);
            throw new Error('could not stand on 2920,3407');
        };
        await expect(priv.cycle()).rejects.toThrow('could not stand on 2920,3407');
        expect(priv.site).toBe(1);
        await expect(priv.cycle()).rejects.toThrow('could not stand on');
        expect(priv.site).toBe(0);
        expect(tried).toEqual([S07_SITES[0], S07_SITES[1]]);
        expect(logs.filter(([m]) => m === 'travel fault: next site').map(([, d]) => d)).toEqual([
            { from: 0, to: 1, error: 'Error: could not stand on 2920,3407' },
            { from: 1, to: 0, error: 'Error: could not stand on 2920,3407' }
        ]);
    });
});

describe("the S07 cue names SCORED's site (rs/635): the givers go there and wait, without rotating", () => {
    const S07 = { step: 'S07', family: 'bone' } as const;
    const [OAK, WILLOW] = S07_SITES as [Site, Site];
    const G = ['cairn_b01', 'cairn_b02', 'cairn_b03', 'cairn_b04'];
    const bones = () => Array.from({ length: 23 }, (_, i) => ({ slot: i, id: 536, name: 'Dragon bones', count: 1, optionsWithIndex: [] }));
    const player = (t: { x: number; z: number }) => ({ name: 'giver', worldX: t.x, worldZ: t.z, x: t.x, z: t.z, level: 0 }) as unknown as BotWorldState['player'];
    type Priv = { site: number; phase: string; detail: string; cycle(): Promise<void>; travel(s: Site): Promise<void>; restock(n: number): Promise<void> };

    /** A standing giver on its own fake client, standing on `at`'s giver tile with a full load; travel lands on the site's tile at once. */
    function rig(o: { dir?: string; account?: string; at?: Site; prior?: Record<string, unknown>; options?: Record<string, unknown> } = {}) {
        const dir = o.dir ?? mkdtempSync(join(tmpdir(), 'bone-site-'));
        const account = o.account ?? 'cairn_b01';
        if (o.prior) writeFileSync(join(dir, `bones-${account}.json`), JSON.stringify({ v: 1, account, phase: 'waiting', held: 23, n: 23, trades: 0, bounces: 0, tile: null, readyAt: 1, session: null, final: false, loads: null, ms: 1, ...o.prior }));
        const sdk = new FakeSdk(baseState({ inventory: bones(), player: player((o.at ?? OAK).giver) }));
        const logs: Array<[string, unknown]> = [];
        const g = new BoneGiver({
            account,
            options: { cueDir: dir, scope: S07, ...o.options },
            sdk,
            signal: new AbortController().signal,
            log: (m: string, d?: unknown) => logs.push([m, d])
        } as unknown as RoleContext);
        const priv = g as unknown as Priv;
        const walks: Site[] = [];
        priv.travel = async s => {
            walks.push(s);
            sdk.push({ player: player(s.giver) });
        };
        const status = () => readJson<BoneStatus>(join(dir, `bones-${account}.json`));
        return { dir, sdk, g, priv, walks, logs, status };
    }

    /** A scored-side writer of the S07 cue in `dir`: each call writes it naming `site` (none: no site) and returns it as read. */
    const scored = (dir: string, session?: string) => {
        const w = new CueWriter(dir, 'scored', S07, session);
        return (site?: { x: number; z: number }) => {
            w.write({ beacons: [{ tick: 1, ms: Date.now() }], turns: [], ...(site ? { site } : {}) });
            return readCue(dir)!;
        };
    };

    /** Tick every client `n` frames, letting each cycle react to each frame; true once all of `ps` settled. */
    const ticks = async (sdks: FakeSdk | FakeSdk[], ps: Promise<unknown> | Promise<unknown>[], n: number): Promise<boolean> => {
        const all = Array.isArray(ps) ? ps : [ps];
        let left = all.length;
        for (const p of all) p.then(() => left--, () => left--);
        for (let i = 0; i < n && left > 0; i++) {
            await flush();
            for (const sdk of Array.isArray(sdks) ? sdks : [sdks]) sdk.tick();
        }
        await flush();
        return left === 0;
    };

    test('namedSite: the exact receiver tile, else the nearest within 8 tiles; nothing farther, no site and a stop name none; custom sites the same', () => {
        expect(namedSite(S07_SITES, { site: { x: 2914, z: 3494 } })).toBe(0);
        expect(namedSite(S07_SITES, { site: { x: 2920, z: 3406 } })).toBe(1);
        expect(namedSite(S07_SITES, { site: { x: 2918, z: 3400 } })).toBe(1);
        expect(namedSite(S07_SITES, { site: { x: 2920, z: 3415 } })).toBeNull();
        expect(namedSite(S07_SITES, {})).toBeNull();
        expect(namedSite(S07_SITES, null)).toBeNull();
        expect(namedSite(S07_SITES, { site: { x: 2914, z: 3494 }, stop: true })).toBeNull();
        const rimmington: Site[] = [{ giver: { x: 2983, z: 3205 }, receiver: { x: 2984, z: 3205 } }, { giver: { x: 3058, z: 3254 }, receiver: { x: 3058, z: 3253 } }];
        expect(namedSite(rimmington, { site: { x: 3058, z: 3253 } })).toBe(1);
        expect(namedSite(S07_SITES, { site: { x: 3058, z: 3253 } })).toBeNull();
    });

    test('a named site: the giver walks there and waits past siteWaitTicks without rotating; the cue naming the other site breaks the wait and the next cycle walks there', async () => {
        const r = rig();
        const write = scored(r.dir);
        r.g.onCue(write(WILLOW.receiver));
        const c1 = r.priv.cycle();
        // The rotation gives up after siteWaitTicks (30, about 70 frames of until's bound): 300 frames and it still waits.
        expect(await ticks(r.sdk, c1, 300)).toBe(false);
        expect(r.walks).toEqual([WILLOW]);
        expect([r.priv.site, r.priv.phase, r.priv.detail]).toEqual([1, 'waiting', 'site 1']);
        r.g.onCue(write(OAK.receiver));
        expect(await ticks(r.sdk, c1, 3)).toBe(true);
        expect(r.priv.phase).toBe('waiting');
        const c2 = r.priv.cycle();
        expect(await ticks(r.sdk, c2, 5)).toBe(false);
        expect(r.walks).toEqual([WILLOW, OAK]);
        expect([r.priv.site, r.priv.phase, r.priv.detail]).toEqual([0, 'waiting', 'site 0']);
    });

    test('a site named while the giver walks elsewhere: it never publishes waiting there, and goes on to the named site', async () => {
        const r = rig();
        const write = scored(r.dir);
        r.g.onCue(write(WILLOW.receiver));
        r.priv.travel = async s => {
            r.walks.push(s);
            r.sdk.push({ player: player(s.giver) });
            // SCORED moved on while we walked: the cue now names the oaks.
            if (r.walks.length === 1) r.g.onCue(write(OAK.receiver));
        };
        await ticks(r.sdk, r.priv.cycle(), 3);
        expect(r.status()).toMatchObject({ phase: 'travel', detail: 'site 1' });
        await ticks(r.sdk, r.priv.cycle(), 3);
        expect(r.walks).toEqual([WILLOW, OAK]);
        expect(r.status()).toMatchObject({ phase: 'waiting', detail: 'site 0', tile: { x: OAK.giver.x, z: OAK.giver.z } });
    });

    test('a cue naming no site (an older writer, another run) keeps the rotation exactly: siteWaitTicks without the receiver, then the next site', async () => {
        const r = rig();
        r.g.onCue(scored(r.dir)());
        expect(await ticks(r.sdk, r.priv.cycle(), 200)).toBe(true);
        expect(r.walks).toEqual([]);
        expect([r.priv.site, r.priv.phase, r.priv.detail]).toEqual([1, 'travel', 'site 1']);
        expect(await ticks(r.sdk, r.priv.cycle(), 200)).toBe(true);
        expect(r.walks).toEqual([WILLOW]);
        expect([r.priv.site, r.priv.phase, r.priv.detail]).toEqual([0, 'travel', 'site 0']);
    });

    test('after a restock the giver walks back to the site the cue names, not the next in rotation', async () => {
        const r = rig({ at: WILLOW });
        r.g.onCue(scored(r.dir)(WILLOW.receiver));
        // As after a trade at the willows: empty-handed, and the rotation index on the oaks.
        r.sdk.push({ inventory: [] });
        r.priv.site = 0;
        let restocked = 0;
        r.priv.restock = async () => {
            restocked++;
            r.sdk.push({ inventory: bones(), player: player(DEFAULT_BONE_BANK) });
        };
        expect(await ticks(r.sdk, r.priv.cycle(), 5)).toBe(false);
        expect(restocked).toBe(1);
        expect(r.walks).toEqual([WILLOW]);
        expect([r.priv.site, r.priv.phase]).toEqual([1, 'waiting']);
    });

    test('a named site that cannot be stood on is retried, never rotated away from: after 3 failed walks the giver stays, faulted, until the cue names another site', async () => {
        const r = rig();
        const write = scored(r.dir);
        r.g.onCue(write(WILLOW.receiver));
        r.priv.travel = async s => {
            r.walks.push(s);
            throw new Error('could not stand on 2920,3407');
        };
        for (let i = 0; i < 3; i++) {
            await expect(r.priv.cycle()).rejects.toThrow('could not stand on 2920,3407');
            expect(r.priv.site).toBe(1);
        }
        expect(r.walks).toEqual([WILLOW, WILLOW, WILLOW]);
        expect(r.logs.filter(([m]) => m === 'travel fault: named site').map(([, d]) => (d as { tries: number }).tries)).toEqual([1, 2, 3]);
        expect(r.logs.some(([m]) => m === 'travel fault: next site')).toBe(false);
        const stay = r.priv.cycle();
        expect(await ticks(r.sdk, stay, 100)).toBe(false);
        expect(r.walks).toHaveLength(3);
        expect(r.priv.phase).toBe('fault');
        expect(r.priv.detail).toMatch(/^site 1 refused 3 walks: Error: could not stand on 2920,3407/);
        // The phase gate refuses it: correct, SCORED's site has no giver.
        expect(judgeStatus('bone', r.status(), { now: Date.now() }).ok).toBe(false);
        r.g.onCue(write(OAK.receiver));
        expect(await ticks(r.sdk, stay, 3)).toBe(true);
        // Still on the oak tile it never left: the oaks, named now, need no walk.
        await ticks(r.sdk, r.priv.cycle(), 3);
        expect(r.walks).toHaveLength(3);
        expect([r.priv.site, r.priv.phase, r.priv.detail]).toEqual([0, 'waiting', 'site 0']);
    });

    test('before any cue the giver holds on its site (sites[0] at launch) past siteWaitTicks; the first cue breaks the hold', async () => {
        const r = rig();
        const c = r.priv.cycle();
        expect(await ticks(r.sdk, c, 300)).toBe(false);
        expect([r.priv.site, r.priv.phase, r.priv.detail, r.walks.length]).toEqual([0, 'waiting', 'site 0', 0]);
        r.g.onCue(scored(r.dir)(WILLOW.receiver));
        expect(await ticks(r.sdk, c, 3)).toBe(true);
        await ticks(r.sdk, r.priv.cycle(), 3);
        expect(r.walks).toEqual([WILLOW]);
    });

    test("a cue left on disk from before the giver started moves it only in the giver's own last session (a resume); otherwise it holds at the oaks (rs/41)", async () => {
        // A previous attempt's willow-band cue: written a minute before this process, in another session.
        const dir = mkdtempSync(join(tmpdir(), 'bone-stale-cue-'));
        const stale = { ...scored(dir, 'attempt-3.S07.bone')(WILLOW.receiver), ms: Date.now() - 60_000 };
        const r = rig({ dir, prior: { session: 'attempt-2.S07.bone' } });
        r.g.onCue(stale);
        // No cue at all: no site, no receiver hash to trade, no session to count in.
        expect((r.g as unknown as { cue: unknown }).cue).toBeNull();
        expect(r.logs.some(([m]) => m === 'cue ignored: written before this giver started, in another session')).toBe(true);
        const c = r.priv.cycle();
        expect(await ticks(r.sdk, c, 300)).toBe(false);
        expect([r.priv.site, r.priv.phase, r.walks.length]).toEqual([0, 'waiting', 0]);
        // This attempt's first cue, written after the start: it governs.
        r.g.onCue(scored(dir, 'attempt-4.S07.bone')(WILLOW.receiver));
        expect(await ticks(r.sdk, c, 3)).toBe(true);
        await ticks(r.sdk, r.priv.cycle(), 3);
        expect(r.walks).toEqual([WILLOW]);

        // A relaunch mid-session: the old cue is the session its own last status counted in.
        const dir2 = mkdtempSync(join(tmpdir(), 'bone-resume-cue-'));
        const resumed = { ...scored(dir2, 'attempt-4.S07.bone')(WILLOW.receiver), ms: Date.now() - 60_000 };
        const r2 = rig({ dir: dir2, prior: { session: 'attempt-4.S07.bone', trades: 2 } });
        r2.g.onCue(resumed);
        expect(await ticks(r2.sdk, r2.priv.cycle(), 3)).toBe(false);
        expect(r2.walks).toEqual([WILLOW]);
        expect([r2.priv.site, r2.priv.phase]).toEqual([1, 'waiting']);
        expect(r2.status()).toMatchObject({ trades: 2, session: 'attempt-4.S07.bone' });
    });

    test("attempt 3's final stop left in cue.json does not end a giver of the next attempt launched before S07: it holds at the oaks, and the attempt's first cue serves it (rs/41)", async () => {
        const dir = mkdtempSync(join(tmpdir(), 'bone-stale-stop-'));
        const a3 = new CueWriter(dir, 'scored', S07, 'attempt-3.S07.bone');
        a3.write({ beacons: [{ tick: 1, ms: Date.now() - 120_000 }], turns: [], site: WILLOW.receiver });
        a3.stop([{ tick: 2, ms: Date.now() - 60_000 }], { final: true });
        const stop = { ...readCue(dir)!, ms: Date.now() - 60_000 };
        expect(stop).toMatchObject({ stop: true, final: true, site: WILLOW.receiver });
        const r = rig({ dir, prior: { session: 'attempt-3.S07.bone', phase: 'off', trades: 11 } });
        // ...and its own last status from attempt 3 is in that session: the stop is the giver's own session, so it
        // would count. A fresh attempt's giver keeps no such status: its prior is another session's.
        const r4 = rig({ prior: { session: 'attempt-2.S07.bone', phase: 'off' } });
        r4.g.onCue(stop);
        const g4 = r4.g as unknown as { cue: Cue | null; loadsDone(): number };
        // The run loop (`!this.cue?.stop`) goes on, and nothing of attempt 3's session counts.
        expect(g4.cue).toBeNull();
        expect(g4.loadsDone()).toBe(0);
        const c = r4.priv.cycle();
        expect(await ticks(r4.sdk, c, 300)).toBe(false);
        expect([r4.priv.site, r4.priv.phase, r4.walks.length]).toEqual([0, 'waiting', 0]);
        // Attempt 4's S07 opens: its first cue, written after the start, governs.
        r4.g.onCue(scored(r4.dir, 'attempt-4.S07.bone')(OAK.receiver));
        expect(g4.cue?.session).toBe('attempt-4.S07.bone');
        expect(await ticks(r4.sdk, c, 3)).toBe(true);
        expect(await ticks(r4.sdk, r4.priv.cycle(), 300)).toBe(false);
        expect([r4.priv.site, r4.priv.phase, r4.walks.length]).toEqual([0, 'waiting', 0]);
        expect(r4.status()).toMatchObject({ session: 'attempt-4.S07.bone', phase: 'waiting' });
        // The same stop read by a giver whose own last status is in attempt 3's session counts: it stands down.
        r.g.onCue(stop);
        expect(await ticks(r.sdk, r.priv.cycle(), 3)).toBe(true);
        expect(r.walks).toEqual([]);
    });

    test('a stop cue naming no site stands the giver down: no walk, no rotation', async () => {
        const r = rig({ at: WILLOW });
        r.priv.site = 1;
        const w = new CueWriter(r.dir, 'scored', S07);
        w.write({ beacons: [{ tick: 1, ms: Date.now() }], turns: [] });
        w.stop([{ tick: 2, ms: Date.now() }]);
        r.g.onCue(readCue(r.dir)!);
        expect(await ticks(r.sdk, r.priv.cycle(), 3)).toBe(true);
        expect([r.priv.site, r.walks.length, r.priv.phase]).toEqual([1, 0, 'start']);
    });

    test('the group: all four hold at the oaks before the run and pass the phase gate there; the cue naming the oaks keeps them, the willows moves every one, and each passes waiting at the willows', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'bone-site-group-'));
        const rigs = G.map(account => rig({ dir, account, options: { group: G } }));
        const sdks = rigs.map(r => r.sdk);
        const gate = () => rigs.map(r => judgeStatus('bone', r.status(), { now: Date.now() }));
        let cycles = rigs.map(r => r.priv.cycle());
        expect(await ticks(sdks, cycles, 300)).toBe(false);
        expect(rigs.map(r => [r.priv.site, r.priv.phase, r.walks.length])).toEqual(G.map(() => [0, 'waiting', 0]));
        expect(gate().map(v => v.ok)).toEqual([true, true, true, true]);
        expect(gate()[0]!.detail).toMatch(/^waiting on site 0 /);
        const write = scored(dir);
        // The oak band's start: the hold ends, and each is already on its site's tile.
        for (const r of rigs) r.g.onCue(write(OAK.receiver));
        expect(await ticks(sdks, cycles, 3)).toBe(true);
        cycles = rigs.map(r => r.priv.cycle());
        expect(await ticks(sdks, cycles, 300)).toBe(false);
        expect(rigs.map(r => [r.priv.site, r.priv.phase, r.walks.length])).toEqual(G.map(() => [0, 'waiting', 0]));
        // The oak band's end: every giver leaves for the willows.
        for (const r of rigs) r.g.onCue(write(WILLOW.receiver));
        expect(await ticks(sdks, cycles, 3)).toBe(true);
        cycles = rigs.map(r => r.priv.cycle());
        expect(await ticks(sdks, cycles, 300)).toBe(false);
        expect(rigs.map(r => r.walks)).toEqual(G.map(() => [WILLOW]));
        expect(gate().map(v => v.ok)).toEqual([true, true, true, true]);
        expect(gate().every(v => /^waiting on site 1 /.test(v.detail))).toBe(true);
    });
});

describe("the cue's lastLoad (rs/663): the final giver's next load is the last, the runes alone", () => {
    const S07 = { step: 'S07', family: 'bone' } as const;
    const [OAK] = S07_SITES as [Site, Site];
    const G = ['cairn_b01', 'cairn_b02', 'cairn_b03', 'cairn_b04'];
    const RUNES = [{ item: 'Law rune', count: 1, obj: 'lawrune' }, { item: 'Air rune', count: 5, obj: 'airrune' }];
    const now = 50_000;
    const st = (account: string, phase: BoneStatus['phase'], readyAt: number | null, extra: Partial<BoneStatus> = {}): BoneStatus =>
        ({ v: 1, account, phase, held: 23, n: 23, trades: 2, bounces: 0, tile: null, readyAt, session: 's1', final: account === 'cairn_b04', loads: 64, ms: now - 500, ...extra });
    /** b01 has waited longest, b04 least; 8 of 64 loads given unless a giver's `trades` says otherwise. */
    const group = (extra: Partial<Record<string, Partial<BoneStatus>>> = {}) => G.map((a, i) => st(a, 'waiting', 100 * (i + 1), extra[a] ?? {}));

    describe('boneServer', () => {
        test('flagged well before the count: the final giver serves next, though three others waited longer; unflagged it is the oldest ready', () => {
            expect(boneServer(group(), G, now, 's1')).toBe('cairn_b01');
            expect(boneServer(group(), G, now, 's1', true)).toBe('cairn_b04');
        });

        test("the one-rotation bar does not hold under the flag: at 62 of 64 the count passes b04 over, the flag doesn't", () => {
            const late = group({ cairn_b01: { trades: 56 } });
            expect(groupLoadsDone(late, G, 's1')).toBe(62);
            expect(boneServer(late, G, now, 's1')).toBe('cairn_b01');
            expect(boneServer(late, G, now, 's1', true)).toBe('cairn_b04');
        });

        test('b04 restocking, faulted, empty-handed or stale under the flag: no server at all, never another giver (SCORED waits within serverWait, then fails named)', () => {
            for (const b04 of [{ phase: 'restock' as const, readyAt: null }, { phase: 'fault' as const, readyAt: null }, { held: 0 }, { ms: now - 6_000 }]) {
                expect(boneServer(group({ cairn_b04: b04 }), G, now, 's1', true)).toBeUndefined();
                // unflagged the others serve as before
                expect(boneServer(group({ cairn_b04: b04 }), G, now, 's1')).toBe('cairn_b01');
            }
        });

        test("once b04 has served it (lastGiven, in the session) there is no server; another session's lastGiven is nobody's", () => {
            const given = group({ cairn_b04: { lastGiven: true, phase: 'restock', readyAt: null, trades: 3 } });
            expect(lastLoadGiven(given, G, 's1')).toBe(true);
            expect(boneServer(given, G, now, 's1', true)).toBeUndefined();
            // b04's file from another attempt, lastGiven and waiting: it counts for nothing in s1, so no final giver is there and the flag is ignored
            const stale = group({ cairn_b04: { session: 'attempt-3.S07.bone', lastGiven: true } });
            expect(lastLoadGiven(stale, G, 's1')).toBe(false);
            expect(boneServer(stale, G, now, 's1', true)).toBe('cairn_b01');
        });

        test('without a final giver in the session the flag is ignored; with the count spent there is no server, flag or not', () => {
            const plain = group().map(s => ({ ...s, final: false }));
            expect(boneServer(plain, G, now, 's1', true)).toBe('cairn_b01');
            const spent = group({ cairn_b01: { trades: 58 } });
            expect(boneServer(spent, G, now, 's1', true)).toBeUndefined();
        });

        test('without the flag boneServer is exactly the count rule (the parameter defaults to false)', () => {
            const states = [group(), group({ cairn_b01: { trades: 56 } }), group({ cairn_b04: { phase: 'restock', readyAt: null } }), group({ cairn_b01: { trades: 55 }, cairn_b02: { phase: 'restock', readyAt: null } })];
            for (const s of states) expect(boneServer(s, G, now, 's1', false)).toBe(boneServer(s, G, now, 's1') as string);
        });
    });

    describe('the offer', () => {
        const b04 = bgo({ group: G, trades: 64, finalExtras: RUNES }, {});
        const b01 = bgo({ group: G, trades: 64 }, {});
        const names = (offer: ReturnType<typeof loadOffer>) => offer.map(s => [String(s.item), s.n]);

        test("flagged, b04 offers the runes alone at any load; unflagged its count's last load is 21 bones and the runes, earlier ones 23 bones", () => {
            expect(isFinalLoad(b04, 10, true)).toBe(true);
            expect(names(loadOffer(b04, 10, undefined, true))).toEqual([['/^Law rune$/i', 1], ['/^Air rune$/i', 5]]);
            expect(names(loadOffer(b04, 63, undefined, true))).toEqual([['/^Law rune$/i', 1], ['/^Air rune$/i', 5]]);
            expect(isFinalLoad(b04, 10)).toBe(false);
            expect(names(loadOffer(b04, 10))).toEqual([['/^Dragon bones$/i', 23]]);
            expect(names(loadOffer(b04, 63))).toEqual([['/^Dragon bones$/i', 21], ['/^Law rune$/i', 1], ['/^Air rune$/i', 5]]);
        });

        test('a giver without the extras is never the last load: flagged or not it offers a whole load (and boneServer never picks it under the flag)', () => {
            expect(isFinalLoad(b01, 10, true)).toBe(false);
            expect(names(loadOffer(b01, 10, undefined, true))).toEqual([['/^Dragon bones$/i', 23]]);
            expect(loadBones(b01, 10, true)).toBe(23);
            expect(loadBones(b04, 10, true)).toBe(0);
        });
    });

    describe('the cue field (altar-cue.ts, additive)', () => {
        test('written once it stays for the session: a write without it, a resumed writer and the stop all keep it; stop and final are untouched', () => {
            const dir = mkdtempSync(join(tmpdir(), 'bone-lastload-cue-'));
            const b = [{ tick: 1, ms: Date.now() }];
            const w = new CueWriter(dir, 'scored', S07, 'a4.S07.bone');
            w.write({ beacons: b, turns: [], site: OAK.receiver });
            expect(readCue(dir)!.lastLoad).toBeUndefined();
            w.write({ beacons: b, turns: [], lastLoad: true });
            w.write({ beacons: b, turns: [] });
            expect(readCue(dir)).toMatchObject({ lastLoad: true, site: OAK.receiver });
            expect(readCue(dir)!.stop).toBeUndefined();
            const resumed = new CueWriter(dir, 'scored', S07, 'a4.S07.bone');
            expect(resumed.current?.lastLoad).toBe(true);
            resumed.write({ beacons: b, turns: [], site: OAK.receiver });
            expect(readCue(dir)!.lastLoad).toBe(true);
            resumed.stop(b);
            expect(readCue(dir)).toMatchObject({ lastLoad: true, stop: true });
            expect(readCue(dir)!.final).toBeUndefined();
            // another session's writer starts without it
            const next = new CueWriter(dir, 'scored', S07, 'a5.S07.bone');
            next.write({ beacons: b, turns: [] });
            expect(readCue(dir)!.lastLoad).toBeUndefined();
        });

        test('a persisted cue whose lastLoad is not a boolean is no session to resume', () => {
            const dir = mkdtempSync(join(tmpdir(), 'bone-lastload-bad-'));
            new CueWriter(dir, 'scored', S07, 'a4.S07.bone').write({ beacons: [{ tick: 1, ms: 1 }], turns: [] });
            const cue = readJson<Record<string, unknown>>(join(dir, 'cue.json'))!;
            writeFileSync(join(dir, 'cue.json'), JSON.stringify({ ...cue, lastLoad: 'yes' }));
            expect(() => new CueWriter(dir, 'scored', S07, 'a4.S07.bone')).toThrow(/invalid persisted session/);
        });
    });

    describe('the givers', () => {
        const player = (t: { x: number; z: number }) => ({ name: 'giver', worldX: t.x, worldZ: t.z, x: t.x, z: t.z, level: 0 }) as unknown as BotWorldState['player'];
        const scoredP = { index: 7, name: 'scored', x: OAK.receiver.x, z: OAK.receiver.z, level: 0, distance: 1, combatLevel: 3 } as unknown as BotWorldState['nearbyPlayers'][number];
        const pack = (bones = 23, runes = false) => [
            ...Array.from({ length: bones }, (_, slot) => ({ slot, id: 536, name: 'Dragon bones', count: 1, optionsWithIndex: [] })),
            ...(runes ? [{ slot: 23, id: 563, name: 'Law rune', count: 1, optionsWithIndex: [] }, { slot: 24, id: 556, name: 'Air rune', count: 5, optionsWithIndex: [] }] : [])
        ];
        type Priv = { cycle(): Promise<void>; lastLoadDone(): boolean; restock(n: number, extras?: unknown[]): Promise<void>; phase: string; detail: string; trades: number; lastGiven: boolean; cue: Cue | null; server(): string | undefined };
        const putStatus = (dir: string, s: BoneStatus) => writeFileSync(join(dir, `bones-${s.account}.json`), JSON.stringify(s));
        /** The scored side's S07 cue in `dir`, naming the oaks, with or without lastLoad. */
        const scoredCue = (dir: string, session: string, lastLoad: boolean) => {
            new CueWriter(dir, 'scored', S07, session).write({ beacons: [{ tick: 1, ms: Date.now() }], turns: [], site: OAK.receiver, ...(lastLoad ? { lastLoad: true as const } : {}) });
            return readCue(dir)!;
        };
        const others = (dir: string, session: string, extra: Partial<BoneStatus> = {}) => {
            for (const [i, a] of G.slice(0, 3).entries()) putStatus(dir, st(a, 'waiting', Date.now() - 60_000 + i, { session, ms: Date.now(), trades: 3, ...extra }));
        };
        /** A group giver on the oak tile with a fake scored partner in sight that takes whatever it is offered. */
        const rig = (dir: string, account: string, inventory = pack(23, account === 'cairn_b04')) => {
            const sdk = new FakeTradePartner(baseState({ tick: 10, inventory, player: player(OAK.giver), nearbyPlayers: [scoredP] } as Partial<BotWorldState>), [], { partner: 'scored', stacks: t => /rune$/i.test(t.name), weapon: () => false });
            const logs: Array<[string, Record<string, unknown> | undefined]> = [];
            const g = new BoneGiver({
                account,
                options: { group: G, trades: 64, cueDir: dir, scope: S07, noReplyTicks: 3, ...(account === 'cairn_b04' ? { finalExtras: RUNES } : {}) },
                sdk,
                bot: { dismissBlockingUI: async () => {} },
                signal: new AbortController().signal,
                log: (m: string, d?: Record<string, unknown>) => logs.push([m, d])
            } as unknown as RoleContext);
            (sdk as unknown as { waitForReady: () => Promise<void> }).waitForReady = async () => {};
            return { sdk, g, priv: g as unknown as Priv, logs, status: () => readJson<BoneStatus>(join(dir, `bones-${account}.json`))! };
        };
        const drive = async (sdk: FakeSdk, p: Promise<unknown>, n: number): Promise<boolean> => {
            let settled = false;
            p.then(() => (settled = true), () => (settled = true));
            for (let i = 0; i < n && !settled; i++) {
                await flush();
                sdk.tick();
            }
            await flush();
            return settled;
        };
        const offered = (sdk: FakeSdk) => sdk.sent.filter(a => a.method === 'sendOfferItem').map(a => sdk.state!.inventory.find(i => i.slot === a.args[0])?.name ?? a.args[0]);

        test('b04 on the flagged cue: it is the server over three older givers, trades the runes alone, keeps its bones, and publishes lastGiven; the group is then done', async () => {
            const dir = mkdtempSync(join(tmpdir(), 'bone-lastload-b04-'));
            const cue = scoredCue(dir, 'a4.S07.bone', true);
            others(dir, cue.session);
            const r = rig(dir, 'cairn_b04');
            r.g.onCue(cue);
            expect(r.priv.server()).toBe('cairn_b04');
            const offers: number[] = [];
            const serve = r.sdk.onSend;
            r.sdk.onSend = (a, s) => {
                if (a.method === 'sendOfferItem') offers.push(a.args[0] as number);
                serve(a, s);
            };
            expect(await drive(r.sdk, r.priv.cycle(), 80)).toBe(true);
            // the law (slot 23) and air (slot 24) stacks, no bones
            expect(offers).toEqual([23, 24]);
            expect(r.sdk.getState()!.inventory.filter(i => /bones$/i.test(i.name))).toHaveLength(23);
            expect(r.sdk.getState()!.inventory.filter(i => /rune$/i.test(i.name))).toHaveLength(0);
            expect(r.logs.find(([m]) => m === 'trade')![1]).toMatchObject({ ok: true, final: true, lastLoad: true, gave: ['Law rune x1', 'Air rune x5'] });
            expect([r.priv.trades, r.priv.lastGiven, r.priv.lastLoadDone()]).toEqual([1, true, true]);
            // published with its session: the scored side and the other givers read it
            (r.g as unknown as { publish(): void }).publish();
            expect(r.status()).toMatchObject({ lastGiven: true, session: cue.session, trades: 1 });
            const all = readBoneStatuses(dir);
            expect(lastLoadGiven(all, G, cue.session)).toBe(true);
            expect(boneServer(all, G, Date.now(), cue.session, true)).toBeUndefined();
        });

        test('the flag landing mid-trade on a normal load: that trade finishes as the whole load it was, and the next one is the runes alone', async () => {
            const dir = mkdtempSync(join(tmpdir(), 'bone-lastload-midtrade-'));
            const session = 'a4.S07.bone';
            const w = new CueWriter(dir, 'scored', S07, session);
            const beacons = [{ tick: 1, ms: Date.now() }];
            w.write({ beacons, turns: [], site: OAK.receiver });
            // b04 is the oldest ready, the others newer: by the count it serves this load
            others(dir, session, { readyAt: Date.now() });
            const r = rig(dir, 'cairn_b04');
            r.g.onCue(readCue(dir)!);
            expect(r.priv.server()).toBe('cairn_b04');
            const serve = r.sdk.onSend;
            r.sdk.onSend = (a, s) => {
                if (a.method === 'sendOfferItem' && !readCue(dir)!.lastLoad) {
                    w.write({ beacons, turns: [], lastLoad: true });
                    r.g.onCue(readCue(dir)!);
                }
                serve(a, s);
            };
            expect(await drive(r.sdk, r.priv.cycle(), 80)).toBe(true);
            const trades = () => r.logs.filter(([m]) => m === 'trade').map(([, d]) => d!);
            expect(trades()[0]).toMatchObject({ ok: true, final: false, gave: ['Dragon bones x23'] });
            expect([r.priv.trades, r.priv.lastGiven]).toEqual([1, false]);
            // back from the bank with a whole load (restock unchanged), the next trade is the last
            r.priv.restock = async () => {
                r.sdk.push(s => ({ inventory: [...pack(23), ...s.inventory.filter(i => /rune$/i.test(i.name))] }));
            };
            r.sdk.push(s => ({ inventory: [...s.inventory].map((i, k) => ({ ...i, slot: 23 + k })) }));
            expect(await drive(r.sdk, r.priv.cycle(), 80)).toBe(true);
            expect(trades()[1]).toMatchObject({ ok: true, final: true, lastLoad: true, gave: ['Law rune x1', 'Air rune x5'] });
            expect([r.priv.trades, r.priv.lastGiven]).toEqual([2, true]);
        });

        test('a giver without the extras under the flag never requests: it waits queued behind b04, and stands down once b04 has served it', async () => {
            const dir = mkdtempSync(join(tmpdir(), 'bone-lastload-b01-'));
            const cue = scoredCue(dir, 'a4.S07.bone', true);
            putStatus(dir, st('cairn_b04', 'waiting', Date.now(), { session: cue.session, ms: Date.now() }));
            const r = rig(dir, 'cairn_b01');
            r.g.onCue(cue);
            const c = r.priv.cycle();
            expect(await drive(r.sdk, c, 40)).toBe(false);
            expect(r.sdk.sent.filter(a => a.method === 'sendTradeRequest')).toHaveLength(0);
            expect([r.priv.phase, r.priv.detail]).toEqual(['waiting', 'queued behind cairn_b04']);
            putStatus(dir, st('cairn_b04', 'restock', null, { session: cue.session, ms: Date.now(), trades: 3, lastGiven: true }));
            expect(await drive(r.sdk, c, 10)).toBe(true);
            expect(r.priv.lastLoadDone()).toBe(true);
            expect(offered(r.sdk)).toEqual([]);
        });

        test('relaunched in the same session after lastGiven: a giver without the extras and b04 itself both go off at once, with no trade and no second offer of the runes', async () => {
            for (const account of ['cairn_b02', 'cairn_b04']) {
                const dir = mkdtempSync(join(tmpdir(), 'bone-lastload-relaunch-'));
                const cue = scoredCue(dir, 'a4.S07.bone', true);
                putStatus(dir, st('cairn_b04', 'off', null, { session: cue.session, ms: Date.now(), trades: 5, lastGiven: true }));
                if (account !== 'cairn_b04') putStatus(dir, st(account, 'off', null, { session: cue.session, ms: Date.now(), trades: 4 }));
                const r = rig(dir, account);
                await r.g.run();
                expect(r.sdk.sent.filter(a => a.method === 'sendTradeRequest' || a.method === 'sendOfferItem')).toEqual([]);
                expect(r.status()).toMatchObject({ phase: 'off', session: cue.session, trades: account === 'cairn_b04' ? 5 : 4 });
                if (account === 'cairn_b04') {
                    expect(r.priv.lastGiven).toBe(true);
                    expect(r.status().lastGiven).toBe(true);
                    expect(r.logs.some(([m]) => m === 'resumed: the last load was given')).toBe(true);
                }
            }
        });

        test("another session's flagged cue moves no one and sets nothing: no cue, no server, no lastGiven, and b04's prior lastGiven from that session is not restored", async () => {
            const dir = mkdtempSync(join(tmpdir(), 'bone-lastload-stale-'));
            const stale = { ...scoredCue(dir, 'attempt-3.S07.bone', true), ms: Date.now() - 60_000 };
            expect(stale.lastLoad).toBe(true);
            putStatus(dir, st('cairn_b04', 'off', null, { session: 'attempt-2.S07.bone', ms: Date.now() - 60_000, lastGiven: true }));
            const r = rig(dir, 'cairn_b04');
            r.g.onCue(stale);
            expect(r.priv.cue).toBeNull();
            expect([r.priv.server(), r.priv.lastGiven, r.priv.lastLoadDone()]).toEqual([undefined, false, false]);
            // this attempt's first cue, unflagged: b04 counts in it with no lastGiven and serves by the count
            const fresh = scoredCue(dir, 'attempt-4.S07.bone', false);
            r.g.onCue(fresh);
            expect([r.priv.lastGiven, r.priv.lastLoadDone()]).toEqual([false, false]);
            expect(r.priv.server()).toBe('cairn_b04');
            (r.g as unknown as { publish(): void }).publish();
            expect(r.status().lastGiven).toBeUndefined();
        });
    });
});
