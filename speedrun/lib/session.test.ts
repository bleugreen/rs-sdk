import { describe, expect, test } from 'bun:test';
import { baseState } from './fake-sdk';
import { backoffMs, browserUrl, logoutBurst, parseBotEnv, watchdogDecision, type WatchdogInputs } from './session';

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
};

describe('watchdogDecision', () => {
    test('healthy session is left alone', () => {
        expect(watchdogDecision(healthy)).toBe('ok');
    });

    test('relaunches on a stalled tick, a dead or stale gateway, or a lite exit', () => {
        expect(watchdogDecision({ ...healthy, msSinceAdvance: 3_001 })).toBe('relaunch');
        expect(watchdogDecision({ ...healthy, gateway: 'dead' })).toBe('relaunch');
        expect(watchdogDecision({ ...healthy, gateway: 'stale' })).toBe('relaunch');
        expect(watchdogDecision({ ...healthy, childExit: 1 })).toBe('relaunch');
    });

    test('never relaunches an outdated client (exit 3)', () => {
        expect(watchdogDecision({ ...healthy, childExit: 3 })).toBe('give_up');
    });

    test('no-op while paused or when the account is meant to be out', () => {
        expect(watchdogDecision({ ...healthy, childExit: 1, paused: true })).toBe('ok');
        expect(watchdogDecision({ ...healthy, childExit: 1, expectInWorld: false })).toBe('ok');
    });

    test('a client still logging in is not stale, but its exit still counts', () => {
        const fresh = { ...healthy, msSinceLaunch: 3_500, tickedSinceLaunch: false, msSinceAdvance: 3_500, gateway: 'dead' as const };
        expect(watchdogDecision(fresh)).toBe('ok');
        expect(watchdogDecision({ ...fresh, childExit: 1 })).toBe('relaunch');
        expect(watchdogDecision({ ...fresh, msSinceLaunch: 31_000, msSinceAdvance: 31_000 })).toBe('relaunch');
    });

    test('waits out the backoff window', () => {
        expect(watchdogDecision({ ...healthy, gateway: 'dead', nextAttemptAt: 12_000 })).toBe('wait');
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

describe('logoutBurst', () => {
    test('just the logout button when no page is open', () => {
        expect(logoutBurst(baseState())).toEqual(['logout']);
        expect(logoutBurst(null)).toEqual(['logout']);
    });

    test('a continue page (a level-up) is dismissed in the same burst, first', () => {
        const page = baseState({ dialog: { isOpen: true, isWaiting: false, options: [{ index: 1, text: 'Click here to continue', buttonType: 6 }] } as never });
        expect(logoutBurst(page)).toEqual(['continue', 'logout']);
    });

    test('a choice page is never answered', () => {
        const choice = baseState({ dialog: { isOpen: true, isWaiting: false, options: [{ index: 1, text: 'Yes' }, { index: 2, text: 'No' }] } as never });
        expect(logoutBurst(choice)).toEqual(['logout']);
    });
});
