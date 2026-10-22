import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BotWorldState } from '../../sdk/types';
import { baseState, FakeSdk, flush } from '../lib/fake-sdk';
import { fakeClock, microtasks, useFakeTicks } from '../lib/fake-ticks';
import { nameHash } from './altar-cue';
import { AltarGiver } from './altar-giver';
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

function giverWith(sdk: FakeSdk): AltarGiver {
    const ctx = { sdk, bot: {}, account: 'cairn_rcg1', options: { altar: 'nature', cueDir: dir }, log: () => {}, reportBank: () => {}, signal: new AbortController().signal } as unknown as RoleContext;
    return new AltarGiver(ctx);
}

/** Arm a turn by hand and run it, as serve() does. */
function runTurn(g: AltarGiver, turn: { T: number; myT: number; armedTick: number }): Promise<string> {
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
        inner.onCue({ v: 1, session: 's2', seq: 1, receiver: { sha256: nameHash(RECEIVER) }, beacons: [{ tick: 100, ms }], schedule: 'robust', open: 5, turns: [{ giver: 'cairn_rcg1', T: 103, schedule: 'stock' }], ms });
        expect(inner.armed?.key).toBe('s2:103');
        expect(inner.phase).toBe('armed');
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
