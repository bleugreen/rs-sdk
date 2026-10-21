import { describe, expect, test } from 'bun:test';
import { FakeSdk } from './fake-sdk';
import {
    LOGOUT_BUTTON,
    abandonClient,
    backoffMs,
    browserUrl,
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

test('parseBotEnv and browserUrl', () => {
    const env = parseBotEnv('# c\nBOT_USERNAME=srlab1\nPASSWORD=p w\nSERVER=localhost:9300\n');
    expect(env.BOT_USERNAME).toBe('srlab1');
    expect(browserUrl(env)).toBe('http://localhost:9300/bot?bot=srlab1&password=p%20w');
    expect(browserUrl({ ...env, SERVER: 'rs-sdk-demo.fly.dev' })).toBe('https://rs-sdk-demo.fly.dev/bot?bot=srlab1&password=p%20w');
    expect(() => parseBotEnv('SERVER=x')).toThrow();
});
