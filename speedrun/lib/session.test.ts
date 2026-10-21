import { describe, expect, test } from 'bun:test';
import { FakeSdk } from './fake-sdk';
import { loginTokenProof } from '../../server/webclient/login-token';
import {
    LOGOUT_BUTTON,
    abandonClient,
    backoffMs,
    browserUrl,
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
