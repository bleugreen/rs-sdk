import { describe, expect, test } from 'bun:test';
import { type DirectClient, type DirectLogoutResult, type DirectLogoutTarget, type DirectSessionEnd, directLogoutText, directProbeSdk, logoutDirect } from './direct';
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
