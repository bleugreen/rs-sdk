import { afterEach, describe, expect, test } from 'bun:test';
import { type DirectConnection, type DirectLogoutResult, type DirectSession, type DirectSessionClient, directLogoutText, startDirectSession } from './direct';
import { LOGOUT_BUTTON } from './session';

const NO_TIMEOUT = 206;
type Frame = 'tick' | 'logout';

/**
 * An engine socket and lite client in one script. The test plays the server: `deliver` puts
 * frames on the socket (a PLAYER_INFO tick, or LOGOUT) and fires the message event the session
 * pumps on; `serverClose` hangs up. `wire` lists what the client flushed to the server.
 */
function scripted(opts: { inGame?: boolean } = {}) {
    const listeners: Record<'message' | 'close', (() => void)[]> = { message: [], close: [] };
    let closedByServer = false;
    let closedByClient = false;
    const inbox: Frame[] = [];
    const pending: string[] = [];
    const wire: string[] = [];
    let ingame = opts.inGame ?? true;
    let loggedOut = false;
    let onTick: ((n: number) => void) | null = null;
    const conn: DirectConnection = {
        socket: { addEventListener: (type, l) => listeners[type].push(l) },
        get isClosed() {
            return closedByServer || closedByClient;
        },
        close: () => {
            closedByClient = true;
        },
    };
    const client: DirectSessionClient = {
        setOnGameTickCallback: cb => (onTick = cb),
        getPlayerPosition: () => ({ worldX: 3222, worldZ: 3218 }),
        isInGame: () => ingame && !conn.isClosed,
        isLoggedOut: () => loggedOut,
        walkTo: () => ({ moved: true }),
        flush: () => {
            if (conn.isClosed) return;
            wire.push(...pending.splice(0));
        },
        async pumpPackets() {
            while (!loggedOut && inbox.length) {
                if (inbox.shift() === 'logout') {
                    loggedOut = true;
                    ingame = false;
                } else onTick?.(1);
            }
        },
        tickCycle: () => {},
        writeOpcode: op => pending.push(op === NO_TIMEOUT ? 'NO_TIMEOUT' : `op ${op}`),
        say: () => {},
        isModalOpen: () => false,
        getModalInterface: () => -1,
        acceptCharacterDesign: () => false,
        clickComponent: id => {
            if (!client.isInGame()) return false;
            pending.push(`IF_BUTTON ${id}`);
            return true;
        },
    };
    const settle = () => Bun.sleep(2);
    return {
        conn,
        client,
        wire,
        clicks: () => wire.filter(w => w === `IF_BUTTON ${LOGOUT_BUTTON}`).length,
        closedByClient: () => closedByClient,
        async deliver(...frames: Frame[]) {
            for (const f of frames) {
                inbox.push(f);
                for (const l of listeners.message) l();
                await settle();
            }
        },
        async serverClose() {
            closedByServer = true;
            for (const l of listeners.close) l();
            await settle();
        },
        settle,
    };
}

const open: DirectSession[] = [];
function start(s: ReturnType<typeof scripted>) {
    const session = startDirectSession(s.conn, s.client, { host: 'localhost:8960', origin: 'http://localhost:8960', noTimeoutOpcode: NO_TIMEOUT });
    open.push(session);
    return session;
}
afterEach(() => {
    for (const s of open.splice(0)) s.close();
});

/** Track a promise's settlement so a test can assert it has not resolved yet. */
function watch<T>(p: Promise<T>) {
    const w: { done: boolean; value?: T } = { done: false };
    void p.then(v => Object.assign(w, { done: true, value: v }));
    return w;
}

describe('direct session logout', () => {
    test('clicks logout, waits for the server LOGOUT, then closes the socket itself', async () => {
        const s = scripted();
        const session = start(s);
        await s.deliver('tick', 'tick');
        const out = watch(session.logout());
        await s.settle();
        expect(s.wire).toEqual([`IF_BUTTON ${LOGOUT_BUTTON}`]);
        // the server has not answered: the session must not have dropped the socket
        expect(out.done).toBe(false);
        expect(s.closedByClient()).toBe(false);

        await s.deliver('tick', 'logout');
        expect(out.done).toBe(true);
        expect(out.value).toMatchObject({ ok: true, via: 'logout', clicks: 1, clickTick: 2, endTick: 3 } satisfies Partial<DirectLogoutResult>);
        expect(s.closedByClient()).toBe(true);
    });

    test('the server closing the socket after the click counts as out', async () => {
        const s = scripted();
        const session = start(s);
        await s.deliver('tick');
        const p = session.logout();
        await s.settle();
        await s.serverClose();
        expect(await p).toMatchObject({ ok: true, via: 'server-close', clicks: 1 });
    });

    test('refused in the post-combat window: re-clicks after retryTicks, then out', async () => {
        const s = scripted();
        const session = start(s);
        await s.deliver('tick');
        const out = watch(session.logout({ retryTicks: 3 }));
        await s.settle();
        await s.deliver('tick', 'tick');
        expect(s.clicks()).toBe(1);
        await s.deliver('tick');
        expect(s.clicks()).toBe(2);
        expect(out.done).toBe(false);
        await s.deliver('logout');
        expect(out.value).toMatchObject({ ok: true, via: 'logout', clicks: 2, clickTick: 1, endTick: 4 });
    });

    test('never confirmed: closes at the deadline and reports it', async () => {
        const s = scripted();
        const session = start(s);
        await s.deliver('tick');
        const r = await session.logout({ timeoutMs: 40 });
        expect(r).toMatchObject({ ok: false, via: null, clicks: 1 });
        expect(r.reason).toMatch(/still in the world/);
        expect(s.closedByClient()).toBe(true);
    });

    test('a second call returns the first result and sends no second click', async () => {
        const s = scripted();
        const session = start(s);
        await s.deliver('tick');
        const a = session.logout();
        const b = session.logout();
        expect(b).toBe(a);
        await s.settle();
        await s.deliver('logout');
        expect((await a).ok).toBe(true);
        expect(s.clicks()).toBe(1);
    });

    test('not logged in, or the socket already gone: no click, and not ok', async () => {
        const notIn = scripted({ inGame: false });
        expect(await start(notIn).logout()).toMatchObject({ ok: false, clicks: 0, reason: 'not in game' });
        expect(notIn.closedByClient()).toBe(true);

        const dropped = scripted();
        const session = start(dropped);
        await dropped.deliver('tick');
        await dropped.serverClose();
        expect(await session.logout()).toMatchObject({ ok: false, clicks: 0, reason: 'socket closed by the server before the logout' });
    });

    test('keepalives stop once the session is logged out', async () => {
        const s = scripted();
        const session = start(s);
        await s.deliver('tick');
        const p = session.logout();
        await s.settle();
        await s.deliver('logout');
        await p;
        const sent = s.wire.length;
        await Bun.sleep(1100);
        expect(s.wire.length).toBe(sent);
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
