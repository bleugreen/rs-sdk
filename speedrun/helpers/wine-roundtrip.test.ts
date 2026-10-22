import { describe, expect, test } from 'bun:test';

import type { NearbyPlayer } from '../../sdk/types';
import { baseState, drive, FakeSdk } from '../lib/fake-sdk';
import type { RoleContext } from './role';
import { standinRole } from './wine-roundtrip';

const H40: NearbyPlayer = { kind: 'player', index: 7, name: 'Cairn H40', combatLevel: 3, x: 3185, z: 3436, distance: 1 };

function standin(sdk: FakeSdk, options: Record<string, unknown>) {
    const logs: { m: string; d?: Record<string, unknown> }[] = [];
    const ctx = {
        sdk,
        bot: {},
        account: 'cairn_h94',
        options: { giver: 'cairn_h40', count: 520, settleMs: 0, ...options },
        log: (m: string, d?: Record<string, unknown>) => logs.push({ m, d }),
        reportBank: () => {},
        signal: new AbortController().signal,
    } as unknown as RoleContext;
    return { logs, run: standinRole.run(ctx) };
}

describe('wine-roundtrip stand-in', () => {
    test('a giver that never comes into view: it stops cleanly and never clicks to trade', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1 }));
        const { logs, run } = standin(sdk, { giverWaitMs: 50 });
        await run;
        expect(sdk.sent).toEqual([]);
        expect(logs.find(l => l.m === 'result')?.d).toMatchObject({ ok: false, reason: 'cairn_h40 never came into view', sameAsStart: true });
    });

    test("logged in first, it waits for the giver past the trade code's 5-tick give-up, then asks for the trade", async () => {
        const sdk = new FakeSdk(baseState({ tick: 1 }));
        const clicks: number[] = [];
        sdk.onSend = (_a, s) => void clicks.push(s.getState()!.tick);
        const { logs, run } = standin(sdk, { giverWaitMs: 60_000 });
        // h40 arrives at tick 12 (the 21:32Z run gave up by tick 5) and leaves at tick 20, so the trade
        // ends player_not_found with nothing moved.
        await drive(sdk, run, 200, s => ({ nearbyPlayers: s.tick + 1 >= 12 && s.tick + 1 < 20 ? [H40] : [] }));
        expect(clicks.length).toBeGreaterThan(0);
        expect(Math.min(...clicks)).toBeGreaterThanOrEqual(12);
        expect(logs.find(l => l.m === 'result')?.d).toMatchObject({ ok: false, sameAsStart: true });
    });
});
