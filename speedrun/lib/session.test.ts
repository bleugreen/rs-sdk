import { describe, expect, test } from 'bun:test';
import { fakeCdp } from './fake-cdp';
import { FakeSdk, flush } from './fake-sdk';
import { loginTokenProof } from '../../server/webclient/login-token';
import {
    LOGOUT_BUTTON,
    abandonClient,
    backoffMs,
    browserUrl,
    loggedOutBy,
    login,
    logoutClean,
    mintLoginToken,
    openBrowserClient,
    parseBotEnv,
    startWatchdog,
    watchdogDecision,
    type LogoutResult,
    type Session,
    type WatchdogEvent,
    type WatchdogInputs,
} from './session';

const healthy: WatchdogInputs = {
    expectInWorld: true,
    paused: false,
    now: 10_000,
    msSinceAdvance: 300,
    staleMs: 3_000,
    gateway: 'active',
    childExit: null,
    nextAttemptAt: 0,
    msSinceLaunch: 60_000,
    tickedSinceLaunch: true,
    launchGraceMs: 30_000,
    logoutFailed: false,
    msSinceProgress: null,
    progressStaleMs: null,
    serverDown: false,
};

describe('watchdogDecision', () => {
    test('healthy session is left alone', () => {
        expect(watchdogDecision(healthy)).toBe('ok');
    });

    test('a wedged client that is still running is logged out, not relaunched', () => {
        expect(watchdogDecision({ ...healthy, msSinceAdvance: 3_001 })).toBe('logout');
        expect(watchdogDecision({ ...healthy, gateway: 'dead' })).toBe('logout');
        expect(watchdogDecision({ ...healthy, gateway: 'stale' })).toBe('logout');
    });

    test('the clean logout does not wait for the relaunch backoff', () => {
        expect(watchdogDecision({ ...healthy, msSinceAdvance: 5_000, nextAttemptAt: 60_000 })).toBe('logout');
    });

    test('relaunches only once the logout did not land, and then respects the backoff', () => {
        const failed = { ...healthy, msSinceAdvance: 5_000, logoutFailed: true };
        expect(watchdogDecision(failed)).toBe('relaunch');
        expect(watchdogDecision({ ...failed, nextAttemptAt: 12_000 })).toBe('wait');
    });

    test('a dead lite child is relaunched at once: there is no socket to log out on', () => {
        expect(watchdogDecision({ ...healthy, childExit: 1 })).toBe('relaunch');
        expect(watchdogDecision({ ...healthy, childExit: 137, nextAttemptAt: 12_000 })).toBe('wait');
    });

    test('server gone: an exited or wedged client waits for the world instead of a takeover', () => {
        expect(watchdogDecision({ ...healthy, childExit: 1, serverDown: true })).toBe('outage');
        expect(watchdogDecision({ ...healthy, msSinceAdvance: 5_000, serverDown: true })).toBe('outage');
        expect(watchdogDecision({ ...healthy, msSinceAdvance: 5_000, logoutFailed: true, nextAttemptAt: 60_000, serverDown: true })).toBe('outage');
        // A healthy client is left alone whatever the probe says, and exit 3 still gives up.
        expect(watchdogDecision({ ...healthy, serverDown: true })).toBe('ok');
        expect(watchdogDecision({ ...healthy, childExit: 3, serverDown: true })).toBe('give_up');
    });

    test('never relaunches an outdated client (exit 3)', () => {
        expect(watchdogDecision({ ...healthy, childExit: 3 })).toBe('give_up');
    });

    test('no-op while paused or when the account is meant to be out', () => {
        expect(watchdogDecision({ ...healthy, childExit: 1, paused: true })).toBe('ok');
        expect(watchdogDecision({ ...healthy, msSinceAdvance: 9_000, expectInWorld: false })).toBe('ok');
    });

    test('a client still logging in is not stale, but its exit still counts', () => {
        const fresh = { ...healthy, msSinceLaunch: 3_500, tickedSinceLaunch: false, msSinceAdvance: 3_500, gateway: 'dead' as const };
        expect(watchdogDecision(fresh)).toBe('ok');
        expect(watchdogDecision({ ...fresh, childExit: 1 })).toBe('relaunch');
        expect(watchdogDecision({ ...fresh, msSinceLaunch: 31_000, msSinceAdvance: 31_000 })).toBe('logout');
    });

    test('a stalled bot on a healthy client is stopped (opt-in), a wedged client takes precedence', () => {
        const tracked = { ...healthy, progressStaleMs: 30_000 };
        expect(watchdogDecision({ ...tracked, msSinceProgress: 10_000 })).toBe('ok');
        expect(watchdogDecision({ ...tracked, msSinceProgress: 30_001 })).toBe('stop');
        expect(watchdogDecision({ ...tracked, msSinceProgress: 30_001, msSinceAdvance: 5_000 })).toBe('logout');
        expect(watchdogDecision({ ...healthy, msSinceProgress: 999_999 })).toBe('ok');
    });
});

// ------------------------------------------------------------------ the watchdog acting on it

interface FakeChild {
    pid: number;
    exited: Promise<number>;
    killed: string[];
    kill(sig?: string): void;
    exit(code: number): void;
}

function fakeChild(): FakeChild {
    let resolve!: (code: number) => void;
    const child: FakeChild = {
        pid: 4242,
        exited: new Promise<number>(r => (resolve = r)),
        killed: [],
        kill(sig = 'SIGTERM') {
            child.killed.push(sig);
            resolve(137);
        },
        exit: code => resolve(code),
    };
    return child;
}

function fakeSession(over: Partial<Session> = {}): { session: Session; sdk: FakeSdk & { checkBotStatus(): Promise<unknown> }; child: FakeChild } {
    const sdk = Object.assign(new FakeSdk(), { checkBotStatus: async () => ({ status: 'active', inGame: true }) });
    const child = fakeChild();
    const now = Date.now();
    const session = {
        name: 'srtest',
        client: 'lite',
        env: { BOT_USERNAME: 'srtest', PASSWORD: 'x' },
        sdk,
        bot: null,
        sessionId: 1,
        expectInWorld: true,
        child,
        childExit: null,
        lastInWorldTick: 100,
        lastAdvanceAt: now,
        launchedAt: now - 60_000,
        lastProgressAt: now,
        watchdog: null,
        logPath: '/dev/null',
        ...over,
    } as unknown as Session;
    void child.exited.then(code => {
        if (session.child === (child as unknown)) session.childExit = code;
    });
    return { session, sdk, child };
}

const loggedOut: LogoutResult = { ok: true, clickTick: 100, lastInWorldTick: 100, latencyTicks: 0, wallMs: 300 };

/** Records calls; logout and login behave like logoutClean and login do to the session. */
function recorder(logoutOk: boolean) {
    const calls: string[] = [];
    return {
        calls,
        actions: {
            logout: async (s: Session) => {
                calls.push('logout');
                s.watchdog?.pause();
                s.expectInWorld = false;
                return logoutOk ? loggedOut : { ...loggedOut, ok: false, reason: 'still in game after timeout' };
            },
            login: async (s: Session) => {
                calls.push('login');
                s.expectInWorld = true;
                s.watchdog?.resume();
            },
            relaunch: async () => {
                calls.push('relaunch');
            },
            reconnect: async (s: Session) => {
                calls.push('reconnect');
                s.expectInWorld = true;
                s.watchdog?.resume();
            },
        },
    };
}

describe('startWatchdog response', () => {
    test('wedged client: clean logout, then log back in; the running client is never killed', async () => {
        const { session, child } = fakeSession({ lastAdvanceAt: Date.now() - 10_000 });
        const rec = recorder(true);
        const events: WatchdogEvent[] = [];
        const wd = startWatchdog(session, { timer: false, actions: rec.actions, onEvent: e => events.push(e) });
        await wd.check();
        expect(rec.calls).toEqual(['logout', 'login']);
        expect(child.killed).toEqual([]);
        expect(wd.logouts).toBe(1);
        expect(wd.relaunches).toBe(0);
        expect(events.map(e => e.verdict)).toEqual(['logout', 'logout', 'relaunch']);
        expect(events[1]!.reason).toMatch(/^logged out/);
        expect(session.expectInWorld).toBe(true);
        await wd.check(); // healthy again after the relog
        expect(rec.calls).toEqual(['logout', 'login']);
    });

    test('a logout that does not land falls back to a relaunch on the next check', async () => {
        const { session } = fakeSession({ lastAdvanceAt: Date.now() - 10_000 });
        const rec = recorder(false);
        const wd = startWatchdog(session, { timer: false, actions: rec.actions });
        await wd.check();
        expect(rec.calls).toEqual(['logout']);
        expect(session.expectInWorld).toBe(true);
        await wd.check();
        expect(rec.calls).toEqual(['logout', 'relaunch']);
        expect(wd.relaunches).toBe(1);
    });

    test('a dead client is relaunched without a logout attempt', async () => {
        const { session, child } = fakeSession();
        child.exit(1);
        await child.exited;
        const rec = recorder(true);
        const wd = startWatchdog(session, { timer: false, actions: rec.actions });
        await wd.check();
        expect(rec.calls).toEqual(['relaunch']);
    });

    test('a client that died with the server is reconnected, never killed, logged out or relaunched', async () => {
        const { session, child } = fakeSession();
        child.exit(1);
        await child.exited;
        const rec = recorder(true);
        let probes = 0;
        const wd = startWatchdog(session, { timer: false, actions: rec.actions, serverDown: async () => (probes++, true) });
        await wd.check();
        expect(rec.calls).toEqual(['reconnect']);
        expect(wd.outages).toBe(1);
        expect(wd.relaunches).toBe(0);
        expect(probes).toBe(1);
    });

    test('the server probe is asked only when the client looks unhealthy, and an up server keeps the takeover path', async () => {
        const { session } = fakeSession();
        const rec = recorder(true);
        let probes = 0;
        const wd = startWatchdog(session, { timer: false, actions: rec.actions, serverDown: async () => (probes++, false) });
        await wd.check();
        expect(probes).toBe(0);
        session.lastAdvanceAt = Date.now() - 10_000;
        await wd.check();
        expect(probes).toBe(1);
        expect(rec.calls).toEqual(['logout', 'login']);
    });

    test('a stalled bot is logged out and left out', async () => {
        const { session } = fakeSession({ lastProgressAt: Date.now() - 600_000 });
        const rec = recorder(true);
        const events: WatchdogEvent[] = [];
        const wd = startWatchdog(session, { timer: false, progressStaleTicks: 100, actions: rec.actions, onEvent: e => events.push(e) });
        await wd.check();
        expect(rec.calls).toEqual(['logout']);
        expect(session.expectInWorld).toBe(false);
        expect(events.map(e => e.verdict)).toEqual(['stop', 'stop']);
        await wd.check();
        expect(rec.calls).toEqual(['logout']);
    });
});

describe('abandonClient', () => {
    test('clicks logout and lets the client exit on its own', async () => {
        const { session, sdk, child } = fakeSession();
        sdk.onSend = a => {
            if (a.method === 'sendClickComponent' && a.args[0] === LOGOUT_BUTTON) child.exit(1);
        };
        await abandonClient(session, 500);
        expect(sdk.sent.map(a => a.method)).toEqual(['sendClickComponent']);
        expect(child.killed).toEqual([]);
    });

    test('kills a client that does not exit after the click', async () => {
        const { session, child } = fakeSession();
        await abandonClient(session, 50);
        expect(child.killed).toEqual(['SIGKILL']);
    });
});

describe('logoutClean and the post-combat window', () => {
    const combat = (lastDamageTick: number) => ({ player: { combat: { inCombat: false, targetIndex: -1, targetType: 'none', lastDamageTick } } as never });
    /** A lite session whose child exits on the logout click; records the tick of the click. */
    function atTick(tick: number, lastDamageTick: number) {
        const f = fakeSession({ lastInWorldTick: tick });
        f.sdk.state = { ...f.sdk.state!, tick, ...combat(lastDamageTick) };
        const clicks: number[] = [];
        f.sdk.onSend = (a, sdk) => {
            if (a.method === 'sendClickComponent' && a.args[0] === LOGOUT_BUTTON) {
                clicks.push(sdk.state!.tick);
                f.child.exit(0);
            }
        };
        return { ...f, clicks };
    }

    test('never damaged (lastDamageTick -1): the click goes out at once, even in the first 16 ticks', async () => {
        const { session, clicks } = atTick(6, -1);
        const r = await logoutClean(session, { timeoutMs: 1_000 });
        expect(r.ok).toBe(true);
        expect(r.clickTick).toBe(6);
        expect(clicks).toEqual([6]);
    });

    test('a hit within 16 ticks waits out the window (from the later of now and the hit, + 17)', async () => {
        const { session, sdk, clicks } = atTick(100, 95);
        const out = logoutClean(session, { timeoutMs: 1_000 });
        for (let t = 101; t <= 116; t++) {
            await flush();
            sdk.tick();
            expect(clicks).toEqual([]);
        }
        await flush();
        sdk.tick(); // 117 = max(100, 95) + 16 + 1
        const r = await out;
        expect(clicks).toEqual([117]);
        expect(r).toMatchObject({ ok: true, clickTick: 117 });
    });

    test('a hit longer ago than 16 ticks does not wait', async () => {
        const { session, clicks } = atTick(100, 83);
        expect((await logoutClean(session, { timeoutMs: 1_000 })).ok).toBe(true);
        expect(clicks).toEqual([100]);
    });
});

describe('logoutClean on a browser tab: the page confirms, never the gateway', () => {
    /** A browser session whose SDK state stays in game and whose gateway says `gateway`. */
    function browserSession(cdp: string | undefined, gateway: { status: string; inGame: boolean }) {
        const f = fakeSession({ client: 'browser', child: null, lastInWorldTick: 40 } as Partial<Session>);
        (f.session as { env: Record<string, string> }).env = { BOT_USERNAME: 'srtest', PASSWORD: 'x', ...(cdp ? { CDP_URL: cdp } : {}) };
        f.sdk.checkBotStatus = async () => gateway;
        f.sdk.state = { ...f.sdk.state!, tick: 40 };
        return f;
    }

    test('a stale gateway still reading inGame true: the page says out, so the logout is confirmed', async () => {
        const cdp = fakeCdp('srtest');
        try {
            const { session, sdk } = browserSession(cdp.origin, { status: 'stale', inGame: true });
            sdk.onSend = a => {
                if (a.method === 'sendClickComponent' && a.args[0] === LOGOUT_BUTTON) cdp.page.inGame = false;
            };
            const r = await logoutClean(session, { timeoutMs: 2_000 });
            expect(r).toMatchObject({ ok: true, clickTick: 40, lastInWorldTick: 40, latencyTicks: 0, confirmedBy: 'page' });
            expect(sdk.state!.inGame).toBe(true); // the published state never said out
            expect(cdp.page.evaluations).toBeGreaterThan(0);
        } finally {
            cdp.stop();
        }
    });

    test('a gateway saying dead or out is not trusted while the page is still in game', async () => {
        const cdp = fakeCdp('srtest');
        try {
            const { session } = browserSession(cdp.origin, { status: 'dead', inGame: false });
            const r = await logoutClean(session, { timeoutMs: 300 });
            expect(r).toMatchObject({ ok: false, reason: 'still in game after timeout' });
            expect(r.confirmedBy).toBeUndefined();
            expect(await loggedOutBy(session)).toBeNull();
        } finally {
            cdp.stop();
        }
    });

    test('no tab for the bot is not out (a closed tab is a dropped client); no DevTools port is not out either', async () => {
        const cdp = fakeCdp('srtest');
        try {
            cdp.page.tab = false;
            expect(await loggedOutBy(browserSession(cdp.origin, { status: 'dead', inGame: false }).session)).toBeNull();
        } finally {
            cdp.stop();
        }
        // Nothing listens there any more: the probe fails, which is not a confirmation.
        expect(await loggedOutBy(browserSession(cdp.origin, { status: 'dead', inGame: false }).session)).toBeNull();
    });

    test('without CDP only the published state confirms a browser logout', async () => {
        const { session, sdk } = browserSession(undefined, { status: 'dead', inGame: false });
        expect(await loggedOutBy(session)).toBeNull();
        sdk.push({ inGame: false });
        expect(await loggedOutBy(session)).toBe('state');
    });

    test('the lite client keeps its signals: the child exit, else the gateway', async () => {
        const { session, child } = fakeSession();
        expect(await loggedOutBy(session)).toBeNull();
        child.exit(0);
        await child.exited;
        await flush();
        expect(await loggedOutBy(session)).toBe('child');
        const attached = fakeSession({ child: null });
        attached.sdk.checkBotStatus = async () => ({ status: 'dead', inGame: false });
        expect(await loggedOutBy(attached.session)).toBe('gateway');
    });
});

test('backoff doubles from 1 s and caps at 30 s', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(backoffMs)).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]);
});

describe('browserUrl', () => {
    const env = parseBotEnv('# c\nBOT_USERNAME=srlab1\nPASSWORD=s3cr3t pw\nSERVER=localhost:9300\n');
    const proxied = { ...env, SERVER: 'rs-sdk-demo.fly.dev', CLIENT_URL: 'http://127.0.0.1:8899/bot?server=rs-sdk-demo.fly.dev&gateway=ws://127.0.0.1:7780' };
    const secret = [env.PASSWORD, encodeURIComponent(env.PASSWORD), 'password='];

    test('parseBotEnv', () => {
        expect(env.BOT_USERNAME).toBe('srlab1');
        expect(() => parseBotEnv('SERVER=x')).toThrow();
    });

    test('with a token source the URL never embeds PASSWORD, whatever the env says', () => {
        // The run client through proxy.ts: the page URL already carries ?server= and ?gateway=.
        const url = browserUrl(proxied, { token: 'tok-1' });
        expect(url).toBe('http://127.0.0.1:8899/bot?server=rs-sdk-demo.fly.dev&gateway=ws://127.0.0.1:7780&bot=srlab1&token=tok-1');
        for (const e of [proxied, { ...proxied, SERVER: 'localhost:9300', CLIENT_URL: 'http://127.0.0.1:8899/bot' }]) {
            const u = browserUrl(e, { token: 'tok-2' });
            for (const s of secret) expect(u).not.toContain(s);
        }
        // A token is only good at the page server that minted it.
        expect(() => browserUrl(env, { token: 'tok-3' })).toThrow(/CLIENT_URL/);
    });

    test('the query-string password only for a local lab world, and only when asked for', () => {
        const insecure = { insecureQueryLogin: true } as const;
        expect(browserUrl(env, insecure)).toBe('http://localhost:9300/bot?bot=srlab1&password=s3cr3t%20pw');
        expect(browserUrl({ ...env, CLIENT_URL: 'http://127.0.0.1:8899/bot?server=localhost:9300' }, insecure))
            .toBe('http://127.0.0.1:8899/bot?server=localhost:9300&bot=srlab1&password=s3cr3t%20pw');
        expect(() => browserUrl({ ...env, SERVER: 'rs-sdk-demo.fly.dev' }, insecure)).toThrow(/local lab only/);
        expect(() => browserUrl(proxied, insecure)).toThrow(/local lab only/);
    });

    test('mintLoginToken sends a proof, not the password', async () => {
        const sent: { url: string; body: string }[] = [];
        const token = await mintLoginToken(proxied, async (url, init) => {
            sent.push({ url, body: String(init.body) });
            return new Response(JSON.stringify({ token: 'minted' }));
        });
        expect(token).toBe('minted');
        expect(sent.map(s => s.url)).toEqual(['http://127.0.0.1:8899/bot/login-token']);
        expect(JSON.parse(sent[0]!.body)).toEqual({ bot: 'srlab1', proof: loginTokenProof('srlab1', env.PASSWORD) });
        for (const s of secret) expect(sent[0]!.body).not.toContain(s);
        await expect(mintLoginToken(proxied, async () => new Response('{"error":"nope"}', { status: 403 }))).rejects.toThrow(/HTTP 403/);
    });

    test('a browser launch without CDP refuses the token form rather than put it on a command line', async () => {
        await expect(openBrowserClient(proxied, {})).rejects.toThrow(/CDP/);
    });
});

describe('login with inPage: the tab logs back in where it is', () => {
    const PASSWORD = 's3cr3t-Pw9';

    /** A logged-out browser session whose SDK still holds the old session's last state (tick 40). */
    function pageSession(cdp: ReturnType<typeof fakeCdp>) {
        const f = fakeSession({ client: 'browser', child: null, lastInWorldTick: 40, expectInWorld: false } as Partial<Session>);
        (f.session as { env: Record<string, string> }).env = { BOT_USERNAME: 'srtest', PASSWORD, CDP_URL: cdp.origin, CLIENT_URL: cdp.clientUrl };
        f.sdk.state = { ...f.sdk.state!, tick: 40 };
        // openSession's tracker, which fakeSession does not install.
        f.sdk.onStateUpdate(s => {
            if (s.inGame && s.tick !== f.session.lastInWorldTick) {
                f.session.lastInWorldTick = s.tick;
                f.session.lastAdvanceAt = Date.now();
            }
        });
        cdp.client.ingame = false;
        cdp.client.botOverlay!.serverTick = 40;
        return f;
    }

    /** The server accepts the login: the page is in game, then publishes two ticks. */
    function getsIn(cdp: ReturnType<typeof fakeCdp>, sdk: FakeSdk, first?: number) {
        setTimeout(() => {
            cdp.client.ingame = true;
            cdp.client.loginInProgress = false;
            if (first === undefined) sdk.tick();
            else sdk.push({ tick: first });
            setTimeout(() => sdk.tick(), 30);
        }, 30);
    }

    test('no navigation, one token redeemed in the page, and the new session counts on from the page tick', async () => {
        const cdp = fakeCdp('srtest', PASSWORD);
        try {
            const { session, sdk } = pageSession(cdp);
            cdp.hooks.onAutoLogin = () => getsIn(cdp, sdk);
            const r = await login(session, { inPage: true, timeoutMs: 3_000 });
            expect(r).toMatchObject({ via: 'page', attempts: 1, tickBase: 40 });
            expect(session).toMatchObject({ sessionId: 2, tickBase: 40, expectInWorld: true });
            expect(sdk.state!.tick - session.tickBase).toBe(2);
            expect(cdp.page.navigations).toEqual([]);
            expect(cdp.page.minted).toHaveLength(1);
            expect(cdp.page.redeemed).toEqual(cdp.page.minted);
            for (const e of cdp.page.expressions) expect(e).not.toContain(PASSWORD);
        } finally {
            cdp.stop();
        }
    });

    test('an in-page login that ends on the title screen is retried by navigating the tab', async () => {
        const cdp = fakeCdp('srtest', PASSWORD);
        try {
            const { session, sdk } = pageSession(cdp);
            cdp.hooks.onAutoLogin = () => {
                setTimeout(() => {
                    cdp.client.loginInProgress = false;
                    cdp.client.loginMes1 = 'Your account is already logged in.';
                    cdp.client.loginMes2 = 'Try again in 60 secs...';
                }, 30);
            };
            cdp.hooks.onNavigate = () => getsIn(cdp, sdk, 1);
            const r = await login(session, { inPage: true, timeoutMs: 5_000 });
            expect(r).toMatchObject({ via: 'launch', attempts: 2, tickBase: 0 });
            expect(cdp.page.autoLogins).toHaveLength(1);
            expect(cdp.page.navigations).toHaveLength(1);
        } finally {
            cdp.stop();
        }
    });

    test('a page that cannot log itself in is navigated instead, and the fresh client counts from 0', async () => {
        const cdp = fakeCdp('srtest', PASSWORD);
        try {
            const { session, sdk } = pageSession(cdp);
            cdp.page.hasClient = false;
            cdp.hooks.onNavigate = () => getsIn(cdp, sdk, 1);
            const r = await login(session, { inPage: true, timeoutMs: 3_000 });
            expect(r).toMatchObject({ via: 'launch', attempts: 1, tickBase: 0 });
            expect(cdp.page.navigations).toHaveLength(1);
            expect(cdp.page.navigations[0]).toContain('token=');
            expect(cdp.page.autoLogins).toEqual([]);
        } finally {
            cdp.stop();
        }
    });

    test('without inPage a browser login still navigates the tab (unchanged default)', async () => {
        const cdp = fakeCdp('srtest', PASSWORD);
        try {
            const { session, sdk } = pageSession(cdp);
            cdp.hooks.onNavigate = () => getsIn(cdp, sdk, 1);
            const r = await login(session, { timeoutMs: 3_000 });
            expect(r).toMatchObject({ via: 'launch', tickBase: 0 });
            expect(cdp.page.navigations).toHaveLength(1);
            expect(cdp.page.expressions.some(e => e.includes('autoLogin'))).toBe(false);
            // The old page's gateway socket is closed for good before the navigation.
            expect(cdp.client.botOverlay!.gateway).toMatchObject({ connected: false, preventReconnect: true });
        } finally {
            cdp.stop();
        }
    });
});
