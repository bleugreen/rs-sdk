import { describe, expect, test } from 'bun:test';
import type { BotWorldState, GameMessage } from '../../sdk/types';
import type { BotSDK } from '../../sdk/index';
import { baseState, FakeSdk, type SentAction } from '../lib/fake-sdk';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nameHash, newRequestFrom } from './altar-cue';
import { boneGiverOptions, npcTiles, onSide, partnerIs, readBoneAsk, requestUntilOpen, S07_SITES, sideTiles, usableAsk, writeBoneAsk } from './bone-giver';

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

describe('bone giver options', () => {
    test('defaults: 23 dragon bones, the S07 oak then willow sites, bank restock, until stopped', () => {
        const r = boneGiverOptions({}, { RC_CUE_DIR: '/tmp/cue' });
        expect(r).toMatchObject({ item: 'Dragon bones', n: 23, siteWaitTicks: 30, noReplyTicks: 2, resendTicks: 100, cueDir: '/tmp/cue' });
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

    test('the ask: written by the scored side, used once, and only while fresh', () => {
        const dir = mkdtempSync(join(tmpdir(), 'bone-ask-'));
        expect(readBoneAsk(dir)).toBeNull();
        const a = writeBoneAsk(dir, 17, 1);
        expect(readBoneAsk(dir)).toEqual(a);
        expect(usableAsk(a, 0, a.ms + 1000)).toEqual(a);
        expect(usableAsk(a, 1, a.ms + 1000)).toBeNull(); // already served
        expect(usableAsk(a, 0, a.ms + 61_000)).toBeNull(); // stale
        expect(() => writeBoneAsk(dir, 0, 2)).toThrow();
        expect(() => writeBoneAsk(dir, 29, 2)).toThrow();
    });

    test('options: on-request needs a waiting site; hold and refill bounds', () => {
        expect(() => boneGiverOptions({ mode: 'on-request' })).toThrow(/needs sites/);
        const site = [{ giver: { x: 2655, z: 3306 }, receiver: { x: 2655, z: 3305 } }];
        expect(boneGiverOptions({ mode: 'on-request', sites: site })).toMatchObject({ mode: 'on-request', hold: 28, refillBelow: 21 });
        expect(() => boneGiverOptions({ mode: 'on-request', sites: site, hold: 20, refillBelow: 21 })).toThrow(/refillBelow/);
        expect(() => boneGiverOptions({ mode: 'sometimes' })).toThrow(/mode/);
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

    test('every chosen tile is orthogonally adjacent and never the knight\'s, whichever tile the giver starts from', () => {
        for (let dx = -3; dx <= 3; dx++) {
            for (let dz = -3; dz <= 3; dz++) {
                const me = { x: scored.x + dx, z: scored.z + dz };
                const sides = sideTiles(scored, me, [knight]);
                expect(sides).toHaveLength(3);
                for (const t of sides) {
                    expect(onSide(t, scored)).toBe(true);
                    expect(t).not.toEqual(knight);
                }
            }
        }
    });

    test('the nearest side first: from a corner, one step', () => {
        const sides = sideTiles(scored, { x: scored.x - 1, z: scored.z + 1 }, [knight]);
        expect(Math.abs(sides[0]!.x - (scored.x - 1)) + Math.abs(sides[0]!.z - (scored.z + 1))).toBe(1);
    });

    test('corners and 2 tiles off are not a side; NPC footprints block every tile they cover', () => {
        expect(onSide({ x: scored.x + 1, z: scored.z + 1 }, scored)).toBe(false);
        expect(onSide({ x: scored.x + 2, z: scored.z }, scored)).toBe(false);
        expect(onSide({ x: scored.x, z: scored.z - 1 }, scored)).toBe(true);
        const s = baseState({ nearbyNpcs: [{ kind: 'npc', id: 1, index: 3, name: 'Knight of Ardougne', x: 9, z: 9, tileX: scored.x - 2, tileZ: scored.z - 1, size: 2 }] } as unknown as Partial<BotWorldState>);
        const tiles = npcTiles(s);
        expect(tiles).toContainEqual({ x: scored.x - 1, z: scored.z });
        expect(sideTiles(scored, scored, tiles).some(t => t.x === scored.x - 1 && t.z === scored.z)).toBe(false);
        expect(sideTiles(scored, scored, [knight, ...tiles, { x: scored.x, z: scored.z + 1 }, { x: scored.x, z: scored.z - 1 }])).toEqual([]);
    });
});
