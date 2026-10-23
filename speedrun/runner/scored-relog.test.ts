import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { baseState, FakeSdk } from '../lib/fake-sdk';
import type { LoginResult, LogoutResult, Session } from '../lib/session';
import { TickLog } from '../lib/ticks';
import { RelogBudget } from './relog-budget';
import { Observation, resolveResume } from './resume';
import { loginReplyCode, scoredLoginStep, scoredLogoutStep, SCORED_RELOG, WORLD_FULL, type ScoredRelogDeps } from './scored-relog';
import { runSteps, type Step, type StepContext } from './step';

const loginResult = (): LoginResult => ({ wallMs: 900, attempts: 1, via: 'page', tickBase: 0, run: {} as LoginResult['run'], retaliate: {} as LoginResult['retaliate'] });
function setup(over: Partial<ScoredRelogDeps> = {}) {
    const sdk = new FakeSdk(baseState({ tick: 50, inGame: true }));
    const session = { sdk, bot: {}, name: 'lab_scored', sessionId: 1, launchedAt: 1_000, client: 'browser', expectInWorld: true } as unknown as Session;
    const budget = new RelogBudget(mkdtempSync(join(tmpdir(), 'scored-relog-')));
    const log = TickLog.memory('relog-test');
    const calls: string[] = [];
    const ctx = { session, sdk, bot: {}, c: {}, log } as unknown as StepContext<unknown>;
    const deps: ScoredRelogDeps = {
        logout: async () => {
            calls.push('logout'); sdk.state!.inGame = false; session.expectInWorld = false;
            return { ok: true, clickTick: 50, lastInWorldTick: 50, latencyTicks: 0, wallMs: 20, confirmedBy: 'page' };
        },
        confirmOut: async () => (calls.push('page out'), true),
        login: async () => {
            calls.push('login'); sdk.state!.inGame = true; session.expectInWorld = true; session.launchedAt = 5_000;
            return loginResult();
        },
        replyCode: async () => null,
        sleep: async ms => { calls.push(`sleep ${ms}`); },
        ...over
    };
    const beforeLogin = async () => { calls.push('recheck ready'); expect(session.expectInWorld).toBe(false); };
    return { sdk, session, budget, log, calls, ctx, deps, beforeLogin };
}
const note = (log: TickLog) => log.rows.find(r => r.kind === 'note' && r.step === SCORED_RELOG);

describe("SCORED's split S21 relog", () => {
    test('confirmed logout -> ready wait while out -> in-page login -> first trade, with no SCORED ticks between halves', async () => {
        const t = setup();
        const opts = { budget: t.budget, deps: t.deps, beforeLogin: t.beforeLogin };
        const ready: Step<any> = { name: 'ready', offline: true, logoutSafe: true, preconditions: () => true, postconditions: () => true, run: async () => {
            expect(t.session.expectInWorld).toBe(false);
            t.calls.push('ready while out');
            // Longer than a state freshness window: the next boundary must not await a client tick.
            await Bun.sleep(10);
        } };
        const login = scoredLoginStep(opts);
        const band: Step<any> = { name: 'trade', logoutSafe: true, preconditions: () => true, postconditions: () => true, run: async () => { t.calls.push('first trade'); } };
        // Run only through login: the next live step requires an actual fresh post-login tick.
        await runSteps(t.session, [scoredLogoutStep(opts), ready, login], { log: t.log, c: {}, shouldStop: () => false, tickMonitor: false });
        await band.run(t.ctx);
        expect(t.calls).toEqual(['logout', 'page out', 'ready while out', 'recheck ready', 'login', 'first trade']);
        expect(t.sdk.getState()!.tick).toBe(50);
        expect(t.budget.used()).toEqual({ planned: 1, unplanned: 0 });
        expect(t.budget.planned(SCORED_RELOG)).toBe('closed');
        expect(note(t.log)).toMatchObject({ ok: true, ticks: 0, meta: { via: 'page', loggedInAt: 5_000, logout: { confirmedBy: 'page', clickTick: 50 } } });
    });

    test('resume before logout runs all, between halves selects login, after login skips both', async () => {
        const t = setup();
        const opts = { budget: t.budget, deps: t.deps, beforeLogin: t.beforeLogin };
        const logout = scoredLogoutStep(opts), login = scoredLoginStep(opts);
        const ready: Step<any> = { name: 'ready', offline: true, preconditions: () => true, postconditions: () => true, run: async () => {}, logoutSafe: true };
        const band: Step<any> = { name: 'trade', preconditions: s => s.inGame ? true : 'out', postconditions: () => true, done: () => false, run: async () => {}, logoutSafe: true };
        const steps = [logout, ready, login, band];
        expect((await resolveResume(steps, new Observation(t.sdk.state!), {})).step).toBe(logout.name);
        await logout.run(t.ctx);
        const reopened = new RelogBudget(t.budget.dir);
        expect(reopened.planned(SCORED_RELOG)).toBe('open');
        expect((await resolveResume(steps, new Observation(t.sdk.state!), {})).step).toBe(login.name);
        await login.run(t.ctx);
        expect((await resolveResume(steps, new Observation(t.sdk.state!), {})).step).toBe('trade');
        await logout.run(t.ctx);
        await login.run(t.ctx);
        expect(t.calls.filter(c => c === 'logout')).toHaveLength(1);
        expect(t.calls.filter(c => c === 'login')).toHaveLength(1);
    });

    test('unconfirmed logout never opens the planned entry', async () => {
        for (const deps of [{ logout: async () => ({ ok: false, reason: 'timeout' } as LogoutResult) }, { confirmOut: async () => false }]) {
            const t = setup(deps);
            await expect(scoredLogoutStep({ budget: t.budget, deps: t.deps }).run(t.ctx)).rejects.toThrow(/logout failed|page out not confirmed/);
            expect(t.budget.planned(SCORED_RELOG)).toBeNull();
            expect(t.budget.holder()).toBeNull();
        }
    });

    test('world full retries only the login and rechecks all givers after its pause', async () => {
        const t = setup();
        const goodLogin = t.deps.login;
        let attempts = 0;
        t.deps.login = async s => {
            if (++attempts === 1) { t.calls.push('full'); throw new Error('full'); }
            return goodLogin(s);
        };
        t.deps.replyCode = async () => WORLD_FULL;
        await scoredLogoutStep({ budget: t.budget, deps: t.deps }).run(t.ctx);
        await scoredLoginStep({ budget: t.budget, deps: t.deps, beforeLogin: t.beforeLogin }).run(t.ctx);
        expect(t.calls).toEqual(['logout', 'page out', 'recheck ready', 'full', 'sleep 60000', 'recheck ready', 'login']);
        expect(note(t.log)).toMatchObject({ ok: true, meta: { worldFull: 1 } });
        expect(t.budget.entries()).toHaveLength(1);
    });

    test('other refusals fail immediately; world-full exhaustion leaves the same planned entry open', async () => {
        for (const code of [9, null, WORLD_FULL]) {
            const t = setup({ login: async () => { throw new Error('login failed'); }, replyCode: async () => code });
            await scoredLogoutStep({ budget: t.budget, deps: t.deps }).run(t.ctx);
            await expect(scoredLoginStep({ budget: t.budget, deps: t.deps, beforeLogin: t.beforeLogin, worldFullRetries: 2 }).run(t.ctx)).rejects.toThrow(code === 9 ? 'login reply 9' : code === null ? 'login failed' : 'world was full on 3 logins');
            expect(t.budget.planned(SCORED_RELOG)).toBe('open');
            expect(t.budget.used()).toEqual({ planned: 1, unplanned: 0 });
            expect(t.budget.holder()).toBeNull();
        }
    });

    test('missing readiness never logs in, and an operator lock prevents either half racing it', async () => {
        const t = setup();
        await scoredLogoutStep({ budget: t.budget, deps: t.deps }).run(t.ctx);
        await expect(scoredLoginStep({ budget: t.budget, deps: t.deps, beforeLogin: async () => { throw new Error('giver missing'); } }).run(t.ctx)).rejects.toThrow('giver missing');
        expect(t.calls).not.toContain('login');
        const lock = t.budget.tryLock('operator');
        try {
            await expect(scoredLoginStep({ budget: t.budget, deps: t.deps, beforeLogin: t.beforeLogin }).run(t.ctx)).rejects.toThrow('held by operator');
            await expect(scoredLogoutStep({ budget: t.budget, deps: t.deps }).run(t.ctx)).rejects.toThrow('held by operator');
        } finally { if (lock.ok) lock.release(); }
    });


    test('each planned login retry delegates the final guard; a failed guard keeps the same entry open', async () => {
        const t = setup();
        await scoredLogoutStep({ budget: t.budget, deps: t.deps }).run(t.ctx);
        let checks = 0;
        t.deps.login = async (_session, guard) => { guard!(); throw new Error('must not send login'); };
        await expect(scoredLoginStep({ budget: t.budget, deps: t.deps, beforeLogin: t.beforeLogin,
            beforeDispatch: () => { checks++; throw new Error('roster stale at dispatch'); },
        }).run(t.ctx)).rejects.toThrow('roster stale at dispatch');
        expect(checks).toBe(1);
        expect(t.budget.planned(SCORED_RELOG)).toBe('open');
        expect(t.budget.used()).toEqual({ planned: 1, unplanned: 0 });
        expect(t.budget.holder()).toBeNull();
    });

    test('title-screen replies retain their codes', () => {
        expect(loginReplyCode('This world is full.')).toBe(7);
        expect(loginReplyCode('Login server offline.')).toBe(8);
        expect(loginReplyCode('Login limit exceeded.')).toBe(9);
        expect(loginReplyCode('The server is being updated.')).toBe(14);
        expect(loginReplyCode('Login attempts exceeded.')).toBe(16);
        expect(loginReplyCode('Connecting...')).toBeNull();
    });
});
