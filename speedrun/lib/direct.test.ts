import { describe, expect, test } from 'bun:test';
import { DirectBridge, type DirectBotClient, type DirectClient, type DirectLogoutResult, type DirectLogoutTarget, type DirectSessionEnd, directLogoutText, directProbeSdk, loadActionQueue, logoutDirect } from './direct';
import type { ActionResult, BotAction, BotWorldState } from '../../sdk/types';
import { BotSDK } from '../../sdk/index';
import { waitForFreshState } from './fresh-state';
import { LOGOUT_BUTTON } from './session';

/**
 * A scripted engine socket under a direct session. The test plays the server: `tick` decodes a
 * PLAYER_INFO (through the real directProbeSdk adapter), `logout` delivers LOGOUT, `hangUp`
 * closes the socket from the server side. `wire` lists what the client flushed; `closed` is
 * whether this side closed the socket.
 */
function scripted(opts: { inGame?: boolean } = {}) {
    let onTick: ((n: number) => void) | null = null;
    let ingame = opts.inGame ?? true;
    let closed = false;
    let endWith: (e: DirectSessionEnd) => void = () => {};
    const ended = new Promise<DirectSessionEnd>(r => (endWith = r));
    const pending: string[] = [];
    const wire: string[] = [];
    const client: DirectClient & DirectLogoutTarget['client'] = {
        setOnGameTickCallback: cb => (onTick = cb),
        getPlayerPosition: () => ({ worldX: 3222, worldZ: 3218 }),
        isInGame: () => ingame && !closed,
        walkTo: () => ({ moved: true }),
        flush: () => {
            if (!closed) wire.push(...pending.splice(0));
        },
        clickComponent: id => {
            if (!client.isInGame()) return false;
            pending.push(`IF_BUTTON ${id}`);
            return true;
        },
    };
    const target: DirectLogoutTarget = {
        sdk: directProbeSdk(client),
        client,
        ended,
        close: () => {
            closed = true;
            endWith({ reason: 'closed' });
        },
    };
    const settle = () => Bun.sleep(1);
    return {
        target,
        wire,
        clicks: () => wire.filter(w => w === `IF_BUTTON ${LOGOUT_BUTTON}`).length,
        closed: () => closed,
        settle,
        async tick(n = 1) {
            for (let i = 0; i < n; i++) {
                onTick?.(1);
                await settle();
            }
        },
        async logout() {
            ingame = false;
            endWith({ reason: 'logged-out' });
            await settle();
        },
        async hangUp() {
            endWith({ reason: 'disconnected' });
            await settle();
        },
    };
}

/** Track a promise's settlement so a test can assert it has not resolved yet. */
function watch<T>(p: Promise<T>) {
    const w: { done: boolean; value?: T } = { done: false };
    void p.then(v => Object.assign(w, { done: true, value: v }));
    return w;
}

/**
 * Run `f` with every timer firing `earlyMs` before it is due. Timers may fire a little before
 * performance.now() reaches the time they were armed for; this makes that happen every time.
 * Bun.sleep (the scripted server's settle) does not go through setTimeout, so it is unaffected.
 */
async function withEarlyTimers<T>(earlyMs: number, f: () => Promise<T>): Promise<T> {
    const real = globalThis.setTimeout;
    globalThis.setTimeout = ((cb: () => void, ms = 0) => real(cb, Math.max(0, ms - earlyMs))) as unknown as typeof setTimeout;
    try {
        return await f();
    } finally {
        globalThis.setTimeout = real;
    }
}

describe('logoutDirect', () => {
    test('clicks logout, waits for the server LOGOUT, then closes the socket itself', async () => {
        const s = scripted();
        await s.tick(2);
        const out = watch(logoutDirect(s.target));
        await s.settle();
        expect(s.wire).toEqual([`IF_BUTTON ${LOGOUT_BUTTON}`]);
        // the server has not answered: the socket must still be open
        expect(out.done).toBe(false);
        expect(s.closed()).toBe(false);

        await s.tick();
        await s.logout();
        expect(out.value).toMatchObject({ ok: true, via: 'logout', clicks: 1, clickTick: 2, endTick: 3 } satisfies Partial<DirectLogoutResult>);
        expect(s.closed()).toBe(true);
    });

    test('the server hanging up after the click counts as out', async () => {
        const s = scripted();
        await s.tick();
        const p = logoutDirect(s.target);
        await s.settle();
        await s.hangUp();
        expect(await p).toMatchObject({ ok: true, via: 'server-close', clicks: 1 });
        expect(s.closed()).toBe(true);
    });

    test('refused in the post-combat window: re-clicks every retryTicks, then out', async () => {
        const s = scripted();
        await s.tick();
        const out = watch(logoutDirect(s.target, { retryTicks: 3 }));
        await s.settle();
        await s.tick(2);
        expect(s.clicks()).toBe(1);
        await s.tick();
        expect(s.clicks()).toBe(2);
        expect(out.done).toBe(false);
        await s.logout();
        expect(out.value).toMatchObject({ ok: true, via: 'logout', clicks: 2, clickTick: 1, endTick: 4 });
    });

    test('never confirmed: closes at the deadline and reports it', async () => {
        const s = scripted();
        await s.tick();
        const r = await logoutDirect(s.target, { timeoutMs: 40 });
        expect(r).toMatchObject({ ok: false, via: null, clicks: 1 });
        expect(r.reason).toMatch(/still in the world/);
        expect(s.closed()).toBe(true);
    });

    test('never confirmed, with the deadline timer firing early: no extra click at the deadline', async () => {
        const s = scripted();
        await s.tick();
        const r = await withEarlyTimers(10, () => logoutDirect(s.target, { timeoutMs: 40 }));
        expect(r).toMatchObject({ ok: false, via: null, clicks: 1 });
        expect(r.reason).toMatch(/still in the world/);
        expect(s.clicks()).toBe(1);
        expect(s.closed()).toBe(true);
    });

    test('not logged in, or the session already over: no click, and only a LOGOUT counts', async () => {
        const notIn = scripted({ inGame: false });
        expect(await logoutDirect(notIn.target)).toMatchObject({ ok: false, clicks: 0, reason: 'not in game' });
        expect(notIn.closed()).toBe(true);

        const dropped = scripted();
        await dropped.hangUp();
        expect(await logoutDirect(dropped.target)).toMatchObject({ ok: false, clicks: 0, reason: 'session ended before a logout: disconnected' });

        const already = scripted();
        await already.logout();
        expect(await logoutDirect(already.target)).toMatchObject({ ok: true, via: 'logout', clicks: 0 });
        expect(already.wire).toEqual([]);
    });
});

describe('directLogoutText', () => {
    test('names how the server took the player out, or that it did not', () => {
        expect(directLogoutText({ ok: true, via: 'logout', clicks: 1, clickTick: 10, endTick: 11, wallMs: 312.4 })).toBe(
            'out of the world: server sent LOGOUT 1 tick(s) after the first click (1 click, 312 ms)'
        );
        expect(directLogoutText({ ok: false, via: null, clicks: 2, clickTick: 10, endTick: 40, wallMs: 10000, reason: 'still in the world after 10000 ms' })).toMatch(
            /^NOT CONFIRMED \(still in the world after 10000 ms; 2 clicks, 10000 ms\)/
        );
    });
});

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

const nextTurn = () => new Promise(r => setTimeout(r, 0));

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
        await nextTurn();
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
        await nextTurn();
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
        f.client.executeBotAction = a => (a.type === 'submitCountDialog' ? new Promise<ActionResult>(r => (release = r)) : exec(a));
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
        await nextTurn();
        expect(sdk.isConnected()).toBe(false);
        expect(states).toContain('disconnected');
        const n = f.collected();
        bridge.onTick(1);
        expect(f.collected()).toBe(n);
    });
});
