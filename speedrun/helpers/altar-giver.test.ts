import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BotWorldState } from '../../sdk/types';
import { baseState, FakeSdk, flush } from '../lib/fake-sdk';
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

    test('a receiver out of sight is reported, with nothing sent', async () => {
        const sdk = new FakeSdk(baseState({ tick: 100, inventory: [ESSENCE] }));
        expect(await runTurn(giverWith(sdk), { T: 103, myT: 103, armedTick: 100 })).toBe('no-receiver');
        expect(sdk.sent.filter(a => a.method === 'sendTradeRequest')).toHaveLength(0);
    });
});
