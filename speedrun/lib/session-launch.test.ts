// Attempt 3's 04:2xZ start, end to end (rs/668). The loopback gateway held a lite one-off's cached
// state for the account; the tab's token login reached the game, then the page's game socket
// dropped, leaving a socketless body in the world. openSession must refuse that launch with its
// reason, quickly, and leave the account confirmed logged out, instead of waiting 120 s for the
// cached state to advance and walking away with the body still in the world.
//
// The real openSession and BotSDK run against a fake tab (fake-cdp.ts: the page scripts in tab.ts run
// for real) and a fake world's player list, twice: once against a gateway that behaves as upstream's
// does (it hands a new controller the cached state whether or not its client is still connected), and
// once against our own gateway, which no longer does.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { join } from 'path';
import type { BotWorldState } from '../../sdk/types';
import { fakeCdp, fakeWorld, type FakeCdp, type FakeWorld } from './fake-cdp';
import { baseState } from './fake-sdk';
import { LOGOUT_BUTTON, openSession, ROOT } from './session';

const BOT = 'srtest';
const PASSWORD = 'x';

/** The lite one-off's last published state, as the gateway cached it: in game, placed, entities around. */
const cachedLite: BotWorldState = { ...baseState(), tick: 5000, inGame: true };

/** A gateway as upstream's answers sdk_connect: the cached state goes to the new controller at once. */
function upstreamGateway(cached: BotWorldState) {
    const server = Bun.serve({
        port: 0,
        hostname: '127.0.0.1',
        fetch: (req, srv) => (srv.upgrade(req) ? undefined : new Response('Gateway Service')),
        websocket: {
            message(ws, m) {
                const msg = JSON.parse(String(m)) as { type: string; mode?: string };
                if (msg.type !== 'sdk_connect') return;
                ws.send(JSON.stringify({ type: 'sdk_connected', success: true, mode: msg.mode, otherControllers: 0 }));
                ws.send(JSON.stringify({ type: 'sdk_state', state: cached, stateReceivedAt: Date.now() - 210_000 }));
            },
        },
    });
    return { url: `ws://127.0.0.1:${server.port}`, stop: () => server.stop(true) };
}

/** A client registering with a gateway as the account's publisher (what a lite runner or a page's overlay does). */
async function publisher(gatewayUrl: string, clientId: string): Promise<WebSocket> {
    const ws = new WebSocket(gatewayUrl);
    await new Promise<void>((resolve, reject) => {
        ws.onopen = () => {
            ws.send(JSON.stringify({ type: 'connected', username: BOT, password: PASSWORD, clientId }));
            resolve();
        };
        ws.onerror = () => reject(new Error(`publisher ${clientId}: no gateway at ${gatewayUrl}`));
    });
    return ws;
}

/**
 * The tab, as at 04:2xZ: on the navigation it loads, its token login reaches the game (the body
 * enters the world), `inGame` optionally publishes, then the game socket drops: the page's reconnect
 * fails and it lands on the title screen, while the body stays in the world. A later in-page login
 * takes the body over; the logout button takes it out of the world.
 */
function tab0420(cdp: FakeCdp, world: FakeWorld, inGame: (launch: string) => void = () => {}) {
    cdp.client.ingame = false;
    cdp.client.botAutoLoginAttempted = false;
    cdp.hooks.onNavigate = url => {
        const launch = new URL(url).searchParams.get('launch') ?? '';
        cdp.client.ingame = false;
        cdp.client.loadingComplete = false;
        cdp.client.botAutoLoginAttempted = false;
        setTimeout(() => {
            cdp.client.loadingComplete = true;
            cdp.client.botAutoLoginAttempted = true;
            cdp.client.ingame = true;
            world.players.add(BOT);
            inGame(launch);
            setTimeout(() => {
                cdp.client.ingame = false;
                cdp.client.loginMes1 = 'Connection lost';
            }, 300);
        }, 200);
    };
    cdp.hooks.onAutoLogin = () =>
        void setTimeout(() => {
            cdp.client.loginInProgress = false;
            cdp.client.ingame = true;
        }, 100);
    cdp.hooks.onClickComponent = id => {
        if (id !== LOGOUT_BUTTON) return;
        cdp.client.ingame = false;
        world.players.delete(BOT);
    };
}

function env(cdp: FakeCdp, world: FakeWorld, gatewayUrl: string) {
    return { BOT_USERNAME: BOT, PASSWORD, CDP_URL: cdp.origin, CLIENT_URL: `${cdp.origin}/bot?server=${world.host}`, GATEWAY_URL: gatewayUrl, SHOW_CHAT: 'true' };
}

async function startFails(cdp: FakeCdp, world: FakeWorld, gatewayUrl: string): Promise<{ error: Error; ms: number }> {
    const t0 = Date.now();
    const error = await openSession(BOT, { client: 'browser', launch: true, pathfinding: false, env: env(cdp, world, gatewayUrl) }).then(
        () => new Error('openSession did not refuse'),
        (e: Error) => e
    );
    return { error, ms: Date.now() - t0 };
}

function expectRefusedAndLoggedOut(r: { error: Error; ms: number }, cdp: FakeCdp, world: FakeWorld) {
    expect(r.error.message).toMatch(/refusing launch [0-9a-f]{12}: the page's login ended without getting in, or it dropped out of the game \(title screen: Connection lost\); nothing was sent to the account/);
    expect(r.error.message).toMatch(/; logged out, confirmed \(1 logout click\(s\), 1 takeover login\(s\)/);
    // A refusal in seconds, not the 120 s advance wait.
    expect(r.ms).toBeLessThan(30_000);
    expect(cdp.page.navigations).toHaveLength(1);
    expect(cdp.page.navigations[0]).toMatch(/[?&]launch=[0-9a-f]{12}&token=/);
    expect(cdp.page.autoLogins).toHaveLength(1);
    expect(cdp.page.clicks).toEqual([LOGOUT_BUTTON]);
    expect(world.players.has(BOT)).toBe(false);
}

describe('the 04:2xZ start: a cached state, a page login, the page socket drops (rs/668)', () => {
    let prevTick: string | undefined;
    let cdp: FakeCdp;
    let world: FakeWorld;
    beforeEach(() => {
        prevTick = process.env.SPEEDRUN_TICK_MS;
        process.env.SPEEDRUN_TICK_MS = '100';
        cdp = fakeCdp(BOT, PASSWORD);
        world = fakeWorld();
    });
    afterEach(() => {
        if (prevTick === undefined) delete process.env.SPEEDRUN_TICK_MS;
        else process.env.SPEEDRUN_TICK_MS = prevTick;
        cdp.stop();
        world.stop();
    });

    test("through upstream's gateway, which hands over the lite one-off's cached state: refused, then confirmed logged out", async () => {
        const gw = upstreamGateway(cachedLite);
        try {
            tab0420(cdp, world);
            expectRefusedAndLoggedOut(await startFails(cdp, world, gw.url), cdp, world);
        } finally {
            gw.stop();
        }
    });

    describe('through our gateway', () => {
        const PORT = 20000 + Math.floor(Math.random() * 10000);
        const URL_ = `ws://127.0.0.1:${PORT}`;
        let gateway: ReturnType<typeof Bun.spawn> | null = null;
        beforeAll(async () => {
            gateway = Bun.spawn({
                cmd: ['bun', join(ROOT, 'server', 'gateway', 'gateway.ts')],
                env: { ...process.env, AGENT_PORT: String(PORT), GATEWAY_HOSTNAME: '127.0.0.1', LOGIN_SERVER: 'false', ENGINE_MANAGEMENT_URL: 'http://127.0.0.1:1' },
                stdout: 'ignore',
                stderr: 'ignore',
            });
            const deadline = Date.now() + 15_000;
            for (;;) {
                const up = await fetch(`http://127.0.0.1:${PORT}/status`, { signal: AbortSignal.timeout(500) }).then(r => r.ok, () => false);
                if (up) break;
                if (Date.now() > deadline) throw new Error('gateway did not boot');
                await Bun.sleep(100);
            }
        });
        afterAll(() => {
            gateway?.kill();
        });

        test('the lite one-off published and left; the page publishes once, then drops: refused, then confirmed logged out', async () => {
            const lite = await publisher(URL_, `${BOT}-lite`);
            lite.send(JSON.stringify({ type: 'state', state: cachedLite }));
            await Bun.sleep(100);
            lite.close();
            let page: WebSocket | null = null;
            tab0420(cdp, world, launch => {
                void publisher(URL_, `${BOT}-page`).then(ws => {
                    page = ws;
                    ws.send(JSON.stringify({ type: 'state', state: { ...baseState(), tick: 1, inGame: true, launch } }));
                });
            });
            try {
                expectRefusedAndLoggedOut(await startFails(cdp, world, URL_), cdp, world);
            } finally {
                (page as WebSocket | null)?.close();
            }
        });
    });
});
