import { describe, expect, test } from 'bun:test';
import type { ActionResult, BotAction, BotWorldState } from '../../sdk/types';
import { DirectBridge, type DirectBotClient, loadActionQueue } from './direct';
import { waitForFreshState } from './fresh-state';
import { BotSDK } from '../../sdk/index';

/** A lite client stand-in: states carry the tick, actions are recorded beside each flush. */
function fakeClient(over: Partial<DirectBotClient> = {}) {
    const calls: string[] = [];
    let collected = 0;
    const client: DirectBotClient = {
        collectBotState: tick => {
            collected++;
            return { tick, inGame: true, player: { name: 'me', worldX: 3200, worldZ: 3200 }, inventory: [], gameMessages: [], nearbyPlayers: [], skills: [] } as unknown as BotWorldState;
        },
        executeBotAction: (a: BotAction) => {
            calls.push(`exec ${a.type}`);
            return { success: true, message: 'ok' } as ActionResult;
        },
        flush: () => calls.push('flush'),
        getMaxMessageLength: () => 80,
        ...over,
    };
    return { client, calls, collected: () => collected };
}

async function connected(client: DirectBotClient) {
    const bridge = new DirectBridge(client, await loadActionQueue(), 5);
    const sdk = new BotSDK({ botUsername: 'cairn_h70', gatewayUrl: 'direct://cairn_h70', autoReconnect: false, autoLaunchBrowser: false, readyTimeout: 0, openSocket: bridge.openSocket });
    await sdk.connect();
    return { bridge, sdk };
}

const settle = () => new Promise(r => setTimeout(r, 0));

describe('DirectBridge', () => {
    test('no SDK attached: a tick collects nothing', async () => {
        const f = fakeClient();
        const bridge = new DirectBridge(f.client, await loadActionQueue());
        bridge.onTick(1);
        expect(f.collected()).toBe(0);
    });

    test('a state listener sees the tick inside onTick, and its action is executed and flushed before onTick returns', async () => {
        const f = fakeClient();
        const { bridge, sdk } = await connected(f.client);
        const seen: number[] = [];
        sdk.onStateUpdate(s => {
            seen.push(s.tick);
            if (s.tick === 3) void sdk.sendTradeRequest(7);
        });
        bridge.onTick(1);
        bridge.onTick(2); // a drain that held two ticks moves the label by two
        expect(seen).toEqual([1, 3]);
        expect(f.calls).toEqual(['exec interactPlayer', 'flush']);
        await sdk.disconnect();
    });

    test('the giver step pattern: offer and accept sent together run back to back on the same tick', async () => {
        const f = fakeClient();
        const { bridge, sdk } = await connected(f.client);
        const results: Promise<ActionResult>[] = [];
        sdk.onStateUpdate(s => {
            if (s.tick !== 1) return;
            results.push(sdk.sendOfferItem(0, -1), sdk.sendClickComponent(3420));
        });
        bridge.onTick(1);
        expect(f.calls).toEqual(['exec clickComponentWithOption', 'flush', 'exec clickComponent', 'flush']);
        expect((await Promise.all(results)).map(r => r.success)).toEqual([true, true]);
        await sdk.disconnect();
    });

    test('the state after an action is published later, never re-entering a running listener', async () => {
        const f = fakeClient();
        const { bridge, sdk } = await connected(f.client);
        let depth = 0;
        let maxDepth = 0;
        const seen: number[] = [];
        sdk.onStateUpdate(s => {
            depth++;
            maxDepth = Math.max(maxDepth, depth);
            seen.push(s.tick);
            if (seen.length === 1) void sdk.sendClickComponent(1);
            depth--;
        });
        bridge.onTick(1);
        expect(seen).toEqual([1]);
        await settle();
        expect(seen).toEqual([1, 1]); // the post-action republication of tick 1
        expect(maxDepth).toBe(1);
        await sdk.disconnect();
    });

    test('a late SDK gets the last state on connect, and passes the fresh-state gate on the next two ticks', async () => {
        const f = fakeClient();
        const bridge = new DirectBridge(f.client, await loadActionQueue(), 5);
        const first = new BotSDK({ botUsername: 'x', gatewayUrl: 'direct://x', autoReconnect: false, autoLaunchBrowser: false, readyTimeout: 0, openSocket: bridge.openSocket });
        await first.connect();
        bridge.onTick(4);
        const sdk = new BotSDK({ botUsername: 'x', gatewayUrl: 'direct://x', autoReconnect: false, autoLaunchBrowser: false, readyTimeout: 0, openSocket: bridge.openSocket });
        await sdk.connect();
        await settle();
        expect(sdk.getState()?.tick).toBe(4);
        const fresh = waitForFreshState(sdk, { timeoutMs: 1000 });
        bridge.onTick(1);
        bridge.onTick(1);
        expect((await fresh).state.tick).toBe(6);
        await first.disconnect();
        await sdk.disconnect();
    });

    test('an async action holds the queue; the next one runs when it settles', async () => {
        let release: (r: ActionResult) => void = () => {};
        const f = fakeClient();
        const exec = f.client.executeBotAction;
        f.client.executeBotAction = a => (a.type === 'countDialog' ? new Promise<ActionResult>(r => (release = r)) : exec(a));
        const { sdk } = await connected(f.client);
        f.calls.push('-');
        const a = sdk.sendCountDialog(23);
        const b = sdk.sendClickComponent(5);
        expect(f.calls).toEqual(['-', 'flush']);
        release({ success: true, message: 'submitted' } as ActionResult);
        expect((await a).message).toBe('submitted');
        await b;
        expect(f.calls).toEqual(['-', 'flush', 'flush', 'exec clickComponent', 'flush']);
        await sdk.disconnect();
    });

    test('a wait holds the queue for its frames', async () => {
        const f = fakeClient();
        const { sdk } = await connected(f.client);
        const t0 = Date.now();
        const w = sdk.sendWait(4);
        const next = sdk.sendClickComponent(9);
        expect(f.calls).toEqual(['exec wait', 'flush']);
        expect((await w).message).toBe('Wait complete');
        await next;
        expect(f.calls.slice(2)).toEqual(['exec clickComponent', 'flush']);
        expect(Date.now() - t0).toBeGreaterThanOrEqual(15); // 4 frames of 5 ms, less timer slack
        await sdk.disconnect();
    });

    test('an action that throws reports an execution error and frees the queue', async () => {
        const f = fakeClient({
            executeBotAction: a => {
                if (a.type === 'clickComponent') throw new Error('boom');
                return { success: true, message: 'ok' } as ActionResult;
            },
        });
        const { sdk } = await connected(f.client);
        const r = await sdk.sendClickComponent(1);
        expect(r).toMatchObject({ success: false, reason: 'execution_error' });
        expect((await sdk.sendWalk(1, 2)).success).toBe(true);
        await sdk.disconnect();
    });

    test('close: the SDK sees a disconnect and stops receiving states', async () => {
        const f = fakeClient();
        const { bridge, sdk } = await connected(f.client);
        const states: string[] = [];
        sdk.onConnectionStateChange(s => states.push(s));
        bridge.close();
        await settle();
        expect(sdk.isConnected()).toBe(false);
        expect(states).toContain('disconnected');
        const n = f.collected();
        bridge.onTick(1);
        expect(f.collected()).toBe(n);
    });
});
