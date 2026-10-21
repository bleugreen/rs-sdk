import { describe, expect, test } from 'bun:test';

import { baseState, FakeSdk } from './fake-sdk';
import { describeFreshState, waitForFreshState } from './fresh-state';

const player = { name: 'cairn_h05', worldX: 3182, worldZ: 3440 } as never;
const inWorld = (tick: number, extra = {}) => ({ tick, inGame: true, player, ...extra });

describe('waitForFreshState', () => {
    test('the state the SDK holds never counts, even when the next one advances from it', async () => {
        const sdk = new FakeSdk(baseState(inWorld(4321)));
        const wait = waitForFreshState(sdk as never, { timeoutMs: 1000 });
        sdk.push(inWorld(4322)); // first after the call: not yet a pair
        sdk.push(inWorld(4323));
        const r = await wait;
        expect(r.state.tick).toBe(4323);
        expect(r.passedOver).toEqual([4321]);
    });

    test('a replayed pre-trip state is passed over; the new session restarts its ticks', async () => {
        const sdk = new FakeSdk(null);
        const wait = waitForFreshState(sdk as never, { timeoutMs: 1000 });
        sdk.push(inWorld(9000, { inventory: [{ slot: 0, id: 995, name: 'Coins', count: 2750, optionsWithIndex: [] }] }));
        sdk.push(inWorld(9000)); // replayed again on an SDK reconnect: same tick, no advance
        sdk.push({ tick: 1, inGame: false, player: null, inventory: [] }); // the new client, still logging in
        sdk.push(inWorld(2, { inventory: [] }));
        sdk.push(inWorld(3, { inventory: [] }));
        const r = await wait;
        expect(r.state.tick).toBe(3);
        expect(r.state.inventory).toEqual([]);
        expect(r.passedOver).toEqual([9000]);
        expect(describeFreshState(r)).toBe('tick 3 (passed over 9000): inventory 0 stacks; ');
    });

    test('a tick that goes backwards (a new session after a short one) starts the pair again', async () => {
        const sdk = new FakeSdk(null);
        const wait = waitForFreshState(sdk as never, { timeoutMs: 1000 });
        sdk.push(inWorld(40)); // replay
        sdk.push(inWorld(1)); // new session
        sdk.push(inWorld(2));
        const r = await wait;
        expect([r.state.tick, r.passedOver]).toEqual([2, [40]]);
    });

    test('times out naming what it saw, and aborts with the signal', async () => {
        const sdk = new FakeSdk(baseState(inWorld(9000)));
        await expect(waitForFreshState(sdk as never, { timeoutMs: 30 })).rejects.toThrow(/no fresh game state within 0.03s; in-game ticks seen: 9000/);
        const ctl = new AbortController();
        const wait = waitForFreshState(sdk as never, { timeoutMs: 5000, signal: ctl.signal });
        ctl.abort(new Error('role stopped'));
        await expect(wait).rejects.toThrow('role stopped');
    });
});
