import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { type Cue, type CueScope, CueWriter, readCue } from './altar-cue';
import { cueEpoch, muleCueAction, muleOptions } from './mule';
import { DIRECT_IN_WORLD, DIRECT_IN_WORLD_RE, DIRECT_LOGOUT_RE, DIRECT_REFUSED_RE } from './role';
import {
    accountCueDir,
    assertDistinctCueDirs,
    checkBotEnv,
    closedText,
    CueGate,
    DEFAULT_LOGIN_WAIT_MINUTES,
    directLogoutBudgetMs,
    gateEvent,
    type GateState,
    helperReady,
    helpersReady,
    LAUNCHER_LOGIN_POLICY,
    type LoginWait,
    parseLaunchConfig,
    RoleLoop,
    type RoleProcess,
    roleEnv,
    sameCueDir,
    type ScopeClosed,
    ScopeSessions,
    type Stoppable,
    StopRequest,
    stopAllWithin,
    stopSummary,
    waitWhileListed
} from './standalone';

const gw = 'ws://127.0.0.1:7795';

describe('launcher config', () => {
    test('defaults, order kept', () => {
        const c = parseLaunchConfig({
            accounts: [
                { account: 'cairn_h70', role: 'altar-giver', options: { slot: 0 } },
                { account: 'cairn_h75', role: 'altar-receiver', receiver: true, final: true, after: 'ready' }
            ]
        });
        expect(c.gatewayPort).toBe(7795);
        expect(c.loginSpacingMs).toBe(5000);
        expect(c.stopDeadlineMs).toBe(25_000);
        expect(c.accounts.map(a => a.account)).toEqual(['cairn_h70', 'cairn_h75']);
        expect(c.accounts[1]).toMatchObject({ receiver: true, final: true, after: 'ready', args: [], path: 'relay' });
        expect(c.runDir.endsWith('run-machine')).toBe(true);
    });

    test('path: relay by default, direct per account, nothing else', () => {
        const c = parseLaunchConfig({
            accounts: [
                { account: 'cairn_h70', role: 'altar-giver', path: 'direct' },
                { account: 'cairn_h71', role: 'altar-giver' }
            ]
        });
        expect(c.accounts.map(a => a.path)).toEqual(['direct', 'relay']);
        expect(() => parseLaunchConfig({ accounts: [{ account: 'cairn_h70', role: 'idle', path: 'gateway' }] })).toThrow(/path must be relay or direct/);
    });

    test('roles that already run standalone are accepted, with extra args', () => {
        const c = parseLaunchConfig({
            accounts: [
                { account: 'cairn_mule1', role: 'mule', options: { packages: [] } },
                { account: 'cairn_h40', role: 'wine', options: { receiver: 'cairn_h05' } },
                { account: 'cairn_h31', role: 'mule', args: ['courier'] }
            ]
        });
        expect(c.accounts[2]!.args).toEqual(['courier']);
    });

    test('refuses the scored account, non-helper names, duplicates, unknown roles', () => {
        expect(() => parseLaunchConfig({ accounts: [{ account: 'www_cairn_md', role: 'idle' }] })).toThrow();
        expect(() => parseLaunchConfig({ accounts: [{ account: 'cairn_dot_md', role: 'idle' }] })).toThrow(/refusing/);
        expect(() => parseLaunchConfig({ accounts: [{ account: 'someone', role: 'idle' }] })).toThrow(/cairn_/);
        expect(() => parseLaunchConfig({ accounts: [{ account: 'cairn_h70', role: 'idle' }, { account: 'cairn_h70', role: 'idle' }] })).toThrow(/twice/);
        expect(() => parseLaunchConfig({ accounts: [{ account: 'cairn_h70', role: 'no-such-role' }] })).toThrow(/no speedrun/);
        expect(() => parseLaunchConfig({ accounts: [] })).toThrow();
        expect(() => parseLaunchConfig({ gatewayPort: 80, accounts: [{ account: 'cairn_h70', role: 'idle' }] })).toThrow(/gatewayPort/);
    });

    test('existing configs read as before: no cue gate, the shared cue directory', () => {
        const c = parseLaunchConfig({ accounts: [{ account: 'cairn_h70', role: 'altar-giver', options: { slot: 0, scope: { step: 'S06', family: 'altar' } } }] });
        expect(c.accounts[0]).toMatchObject({ stopOn: null, loginOn: null, cueDir: null });
        expect(accountCueDir(c.accounts[0]!, '/tmp/run', {})).toBe('/tmp/run/rc-cue');
        expect(accountCueDir(c.accounts[0]!, '/tmp/run', { RC_CUE_DIR: '/tmp/cues' })).toBe('/tmp/cues');
    });

    test('stopOn: a scope; loginOn: a scope and a bounded wait, its scope the stop scope unless stopOn names another', () => {
        const c = parseLaunchConfig({
            accounts: [
                { account: 'cairn_h70', role: 'altar-giver', path: 'direct', stopOn: { step: 'S06', family: 'altar' } },
                { account: 'cairn_h45', role: 'mule', loginOn: { step: 'H12o', family: 'mule' } },
                { account: 'cairn_h71', role: 'altar-giver', loginOn: { step: 'S21', family: 'altar', waitMinutes: 90 }, stopOn: { step: 'S21x', family: 'altar' } },
                { account: 'cairn_f01', role: 'fm-row', stopOn: { step: 'S03', family: 'fmrow' } },
                { account: 'cairn_h80', role: 'mule', stopOn: { step: 'S04', family: 'ring' } }
            ]
        });
        const [s06, h12o, s21, s03, s04] = c.accounts;
        expect(s06).toMatchObject({ stopOn: { step: 'S06', family: 'altar' }, loginOn: null });
        expect(h12o).toMatchObject({ loginOn: { step: 'H12o', family: 'mule', waitMs: DEFAULT_LOGIN_WAIT_MINUTES * 60_000 }, stopOn: { step: 'H12o', family: 'mule' } });
        expect(s21).toMatchObject({ loginOn: { step: 'S21', family: 'altar', waitMs: 90 * 60_000 }, stopOn: { step: 'S21x', family: 'altar' } });
        expect(s03!.stopOn).toEqual({ step: 'S03', family: 'fmrow' });
        expect(s04!.stopOn).toEqual({ step: 'S04', family: 'ring' });
        expect(DEFAULT_LOGIN_WAIT_MINUTES * 60_000).toBeGreaterThan(9 * 3600_000); // longer than the run
    });

    test('cue gate settings are checked', () => {
        const one = (extra: Record<string, unknown>) => () => parseLaunchConfig({ accounts: [{ account: 'cairn_h70', role: 'idle', ...extra }] });
        expect(one({ stopOn: { step: 'S06', family: 'bones' } })).toThrow(/accounts\[0\]\.stopOn: .*family must be one of/);
        expect(one({ stopOn: { family: 'altar' } })).toThrow(/needs a step/);
        expect(one({ loginOn: { step: 'S21' } })).toThrow(/accounts\[0\]\.loginOn: .*family/);
        expect(one({ loginOn: { step: 'S21', family: 'altar', waitMinutes: 0 } })).toThrow(/waitMinutes/);
        expect(one({ loginOn: { step: 'S21', family: 'altar' }, after: 'ready' })).toThrow(/alternatives/);
    });

    test("cueDir: per account, and the same directory as the role's options.cueDir", () => {
        const root = resolve(import.meta.dir, '..', '..');
        const own = parseLaunchConfig({ accounts: [{ account: 'cairn_h45', role: 'idle', cueDir: 'run-machine/h12o-cue' }] }, root).accounts[0]!;
        expect(own.cueDir).toBe(join(root, 'run-machine', 'h12o-cue'));
        expect(accountCueDir(own, '/tmp/run', { RC_CUE_DIR: '/tmp/cues' })).toBe(join(root, 'run-machine', 'h12o-cue'));
        const fromOptions = parseLaunchConfig({ accounts: [{ account: 'cairn_h45', role: 'idle', options: { cueDir: '/var/cue' } }] }, root).accounts[0]!;
        expect(fromOptions.cueDir).toBe('/var/cue');
        expect(() => parseLaunchConfig({ accounts: [{ account: 'cairn_h45', role: 'idle', cueDir: '/a', options: { cueDir: '/b' } }] }, root)).toThrow(/differ/);
        expect(parseLaunchConfig({ accounts: [{ account: 'cairn_h45', role: 'idle', cueDir: '/a', options: { cueDir: '/a' } }] }, root).accounts[0]!.cueDir).toBe('/a');
    });

    test('stopDeadlineMs: settable, never below 5 s', () => {
        expect(parseLaunchConfig({ stopDeadlineMs: 12_000, accounts: [{ account: 'cairn_h70', role: 'idle' }] }).stopDeadlineMs).toBe(12_000);
        expect(() => parseLaunchConfig({ stopDeadlineMs: 1000, accounts: [{ account: 'cairn_h70', role: 'idle' }] })).toThrow(/stopDeadlineMs/);
        expect(() => parseLaunchConfig({ stopDeadlineMs: 'soon', accounts: [{ account: 'cairn_h70', role: 'idle' }] })).toThrow(/stopDeadlineMs/);
    });
});

describe('stopAllWithin: one deadline for the whole stop', () => {
    const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
    function account(stopMs: number | 'hang' | 'throw') {
        const a = { deadlines: [] as number[], kills: 0 } as Stoppable & { deadlines: number[]; kills: number };
        a.stop = async deadline => {
            a.deadlines.push(deadline);
            if (stopMs === 'hang') return new Promise<void>(() => undefined);
            if (stopMs === 'throw') throw new Error('logout failed');
            await sleep(stopMs);
        };
        a.kill = () => void a.kills++;
        return a;
    }

    test('accounts stop in parallel, not one after another, and none is killed', async () => {
        const accounts = [account(80), account(80), account(80), account(80)];
        const t0 = Date.now();
        const deadline = t0 + 2000;
        expect(await stopAllWithin(accounts, deadline)).toBe(0);
        expect(Date.now() - t0).toBeLessThan(250); // serial would be >= 320
        expect(accounts.every(a => a.kills === 0)).toBe(true);
        expect(accounts.every(a => a.deadlines.length === 1 && a.deadlines[0] === deadline)).toBe(true);
    });

    test('at the deadline an account still stopping is killed; the others are not, and the call returns by then', async () => {
        const quick = account(20);
        const stuck = account('hang');
        const t0 = Date.now();
        expect(await stopAllWithin([quick, stuck], t0 + 150)).toBe(1);
        const took = Date.now() - t0;
        expect(took).toBeGreaterThanOrEqual(140);
        expect(took).toBeLessThan(400);
        expect(stuck.kills).toBe(1);
        expect(quick.kills).toBe(0);
    });

    test('a stop that fails counts as finished (it has its own fallbacks), not as late', async () => {
        const failing = account('throw');
        expect(await stopAllWithin([failing], Date.now() + 500)).toBe(0);
        expect(failing.kills).toBe(0);
    });

    test('StopRequest: the deadline runs from the first request; later ones change nothing', async () => {
        const req = new StopRequest(5000, () => undefined);
        expect(req.deadline).toBe(Infinity);
        const t0 = Date.now();
        req.request('SIGTERM');
        await req.requested;
        expect(req.deadline - t0).toBeGreaterThanOrEqual(5000);
        expect(req.deadline - t0).toBeLessThan(5050);
        const first = req.deadline;
        await sleep(20);
        req.request('final role exited', 3);
        expect(req).toMatchObject({ why: 'SIGTERM', code: 0, deadline: first });
        req.finished();
    });

    test('StopRequest: the watchdog fires at the deadline if the stop is still pending, never after finished()', async () => {
        let overdue = 0;
        const pending = new StopRequest(60, () => void overdue++, 10);
        pending.request('SIGTERM');
        await sleep(40);
        expect(overdue).toBe(0);
        await sleep(80);
        expect(overdue).toBe(1);

        let late = 0;
        const done = new StopRequest(60, () => void late++, 10);
        done.request('SIGINT');
        done.finished();
        await sleep(120);
        expect(late).toBe(0);
    });

    test('a deadline already past kills every account at once', async () => {
        const a = account('hang');
        const b = account('hang');
        expect(await stopAllWithin([a, b], Date.now() - 1)).toBe(2);
        expect(a.kills + b.kills).toBe(2);
    });
});

describe('credentials and role environment', () => {
    const env = { BOT_USERNAME: 'cairn_h70', PASSWORD: 'pw', SERVER: 'rs-sdk-demo.fly.dev' };

    test('bot.env checks', () => {
        expect(checkBotEnv(env, 'cairn_h70', gw)).toBeNull();
        expect(checkBotEnv({ ...env, BOT_USERNAME: 'cairn_h71' }, 'cairn_h70', gw)).toMatch(/expected cairn_h70/);
        expect(checkBotEnv({ ...env, PASSWORD: '' }, 'cairn_h70', gw)).toMatch(/PASSWORD/);
        expect(checkBotEnv({ ...env, GATEWAY_URL: 'wss://elsewhere' }, 'cairn_h70', gw)).toMatch(/bypass/);
        expect(checkBotEnv({ ...env, GATEWAY_URL: gw }, 'cairn_h70', gw)).toBeNull();
    });

    test('the role talks to the loopback gateway with its options and cue directory', () => {
        const e = parseLaunchConfig({ accounts: [{ account: 'cairn_h70', role: 'altar-giver', options: { slot: 1 } }] }).accounts[0]!;
        const r = roleEnv({ PATH: '/bin', GATEWAY_URL: 'wss://public' }, { ...env, GATEWAY_URL: 'wss://x' }, e, gw, '/tmp/run', 123);
        expect(r).toMatchObject({ PATH: '/bin', BOT_USERNAME: 'cairn_h70', PASSWORD: 'pw', SERVER: 'rs-sdk-demo.fly.dev', GATEWAY_URL: gw, LOGGED_IN_AT: '123', RC_CUE_DIR: '/tmp/run/rc-cue', SHOW_CHAT: 'false' });
        expect(JSON.parse(r.ROLE_OPTIONS!)).toEqual({ slot: 1 });
        expect(r.HELPER_PATH).toBe('relay');
    });

    test("an account's own cue directory reaches its role; a role logged in on a cue learns that cue's time", () => {
        const e = parseLaunchConfig({ accounts: [{ account: 'cairn_h45', role: 'mule', cueDir: '/tmp/h12o-cue', loginOn: { step: 'H12o', family: 'mule' } }] }).accounts[0]!;
        const r = roleEnv({ RC_CUE_DIR: '/tmp/shared' }, env, e, gw, '/tmp/run', 123, 25_000, 4567);
        expect(r).toMatchObject({ RC_CUE_DIR: '/tmp/h12o-cue', LOGIN_CUE_MS: '4567' });
        const plain = parseLaunchConfig({ accounts: [{ account: 'cairn_h70', role: 'altar-giver' }] }).accounts[0]!;
        expect(roleEnv({ RC_CUE_DIR: '/tmp/shared' }, env, plain, gw, '/tmp/run', 123).LOGIN_CUE_MS).toBeUndefined();
        expect(roleEnv({ RC_CUE_DIR: '/tmp/shared' }, env, plain, gw, '/tmp/run', 123).RC_CUE_DIR).toBe('/tmp/shared');
    });

    test('a direct-path role is told so, and gets its credentials by environment only', () => {
        const e = parseLaunchConfig({ accounts: [{ account: 'cairn_h70', role: 'altar-giver', path: 'direct' }] }).accounts[0]!;
        const r = roleEnv({ PATH: '/bin' }, env, e, gw, '/tmp/run', 123);
        expect(r).toMatchObject({ HELPER_PATH: 'direct', BOT_USERNAME: 'cairn_h70', PASSWORD: 'pw', SERVER: 'rs-sdk-demo.fly.dev' });
        expect(e.args).toEqual([]);
    });

    test("the direct role's in-world and refusal lines are the ones the launcher matches", () => {
        expect(DIRECT_IN_WORLD_RE.test(DIRECT_IN_WORLD('cairn_h70', 'localhost:9470'))).toBe(true);
        expect(DIRECT_REFUSED_RE.exec('[direct] login refused (code 5): Your account is already logged in.')?.[1]).toBe('5');
    });

    test("a direct role's logout budget ends before the launcher's per-account kill; a relay role gets none", () => {
        const direct = parseLaunchConfig({ accounts: [{ account: 'cairn_h70', role: 'altar-giver', path: 'direct' }] }).accounts[0]!;
        const relay = parseLaunchConfig({ accounts: [{ account: 'cairn_h70', role: 'altar-giver' }] }).accounts[0]!;
        expect(roleEnv({}, env, direct, gw, '/tmp/run', 123).DIRECT_LOGOUT_MS).toBe('20000');
        expect(roleEnv({}, env, direct, gw, '/tmp/run', 123, 60_000).DIRECT_LOGOUT_MS).toBe('55000');
        expect(roleEnv({}, env, relay, gw, '/tmp/run', 123).DIRECT_LOGOUT_MS).toBeUndefined();
        // The kill comes at the deadline less the gateway's 2 s; the budget ends at least 1 s before it, even at the minimum deadline.
        for (const d of [5000, 25_000, 60_000, 300_000]) expect(directLogoutBudgetMs(d)).toBeLessThanOrEqual(d - 2000 - 1000);
    });

    test("the launcher reads the logout outcome from the direct role's last line", () => {
        // role.ts runDirect's line(): JSON with the outcome in `logout`.
        const roleLine = JSON.stringify({ t: 'x', account: 'cairn_t06', role: 'idle', path: 'direct', message: 'logout: QUEUED (...)', logout: 'queued' });
        expect(DIRECT_LOGOUT_RE.exec(roleLine)?.[1]).toBe('queued');
        expect(DIRECT_LOGOUT_RE.exec(JSON.stringify({ message: 'logout: clicking', budgetMs: 20_000 }))).toBeNull();
    });
});

describe('stopSummary', () => {
    test("rs/214's 22-account stop: 13 out, 9 queued behind the server's removal queue, named", () => {
        const n = (i: number) => `cairn_t${String(i).padStart(2, '0')}`;
        const queued = [6, 7, 8, 9, 15, 16, 17, 20, 22];
        const accounts = Array.from({ length: 22 }, (_, i) => ({ account: n(i + 1), logout: queued.includes(i + 1) ? ('queued' as const) : ('out' as const) }));
        const s = stopSummary(accounts);
        expect(s).toStartWith('13 logged out; 9 logout queued at the server');
        expect(s).toContain(queued.map(n).join(', '));
        expect(s).toContain('waits until the server no longer lists it');
        expect(s).not.toContain('killed');
    });
    test('a clean stop names nobody; never-started accounts are not counted', () => {
        expect(stopSummary([{ account: 'cairn_h70', logout: 'out' }, { account: 'cairn_h71', logout: null }])).toBe('1 logged out');
        expect(stopSummary([{ account: 'cairn_h70', logout: 'killed' }, { account: 'cairn_h71', logout: 'not-in-world' }])).toMatch(
            /^1 killed at the deadline before reporting: cairn_h70; 1 not in the world\. The next launch/
        );
    });
});

describe('waitWhileListed', () => {
    const clock = () => {
        let t = 0;
        return { now: () => t, pause: async (ms: number) => void (t += ms) };
    };
    test('waits while the server lists the account, then goes on as soon as it is gone', async () => {
        const c = clock();
        const answers = [true, true, true, false];
        let waits = 0;
        const r = await waitWhileListed(async () => answers.shift()!, { maxMs: 60_000, everyMs: 5000, stopped: () => false, onWait: () => waits++, ...c });
        expect(r).toEqual({ result: 'absent', waitedMs: 15_000, waited: true });
        expect(waits).toBe(1);
    });
    test('not listed, or no answer: no wait at all', async () => {
        expect(await waitWhileListed(async () => false, { maxMs: 60_000, everyMs: 5000, stopped: () => false, ...clock() })).toEqual({ result: 'absent', waitedMs: 0, waited: false });
        expect(await waitWhileListed(async () => null, { maxMs: 60_000, everyMs: 5000, stopped: () => false, ...clock() })).toEqual({ result: 'unknown', waitedMs: 0, waited: false });
    });
    test('a check that takes time is not a wait: never listed means waited false, whatever waitedMs says', async () => {
        // the launcher logged "left the world after 1s" for accounts that were never listed: /playerpositions took 1 s to answer
        const c = clock();
        let waits = 0;
        const slowCheck = async () => {
            await c.pause(1200);
            return false;
        };
        const r = await waitWhileListed(slowCheck, { maxMs: 60_000, everyMs: 5000, stopped: () => false, onWait: () => waits++, ...c });
        expect(r).toEqual({ result: 'absent', waitedMs: 1200, waited: false });
        expect(waits).toBe(0);
    });
    test('bounded: still listed at maxMs gives up; a stop ends the wait', async () => {
        expect(await waitWhileListed(async () => true, { maxMs: 12_000, everyMs: 5000, stopped: () => false, ...clock() })).toEqual({ result: 'still-listed', waitedMs: 12_000, waited: true });
        let checks = 0;
        const r = await waitWhileListed(async () => (checks++, true), { maxMs: 60_000, everyMs: 5000, stopped: () => checks >= 2, ...clock() });
        expect(r.result).toBe('stopped');
        expect(checks).toBe(2);
    });
});

describe('helpersReady: ready-or-waiting', () => {
    type Acct = Parameters<typeof helpersReady>[0][number];
    const a = (account: string, state: Acct['state'], receiver = false): Acct => ({ account, role: 'r', receiver, path: 'relay', state, loggedInAt: null, logins: 1 });
    const gated = (x: Acct, login: string | null, stop: string | null, state: GateState): Acct => ({ ...x, cue: { login, stop, state, ms: 1 } });
    test('every helper online; receivers do not count', () => {
        expect(helpersReady([a('cairn_h70', 'online'), a('cairn_h75', 'logging-in', true)])).toBe(true);
        expect(helpersReady([a('cairn_h70', 'online'), a('cairn_h71', 'logging-in')])).toBe(false);
        expect(helpersReady([a('cairn_h75', 'online', true)])).toBe(false);
    });
    test('a family logged out waiting for its login cue counts as ready (S03 droppers, S04 ring givers, S21 givers before the pre-login)', () => {
        const s21 = (n: number) => gated(a(`cairn_t${n}`, 'awaiting-cue'), 'S21/altar', 'S21/altar', 'waiting');
        expect(helpersReady([a('cairn_h70', 'online'), s21(1), s21(19)])).toBe(true);
        // Every helper cued: the run's start gate still passes (an empty roster of online helpers is not 'not ready').
        expect(helpersReady([s21(1), s21(19), gated(a('cairn_f01', 'queued'), 'S03/fmrow', 'S03/fmrow', 'waiting')])).toBe(true);
    });
    test('once its cue opens, a cued helper counts only when it is online', () => {
        const opening = gated(a('cairn_t1', 'logging-in'), 'S21/altar', 'S21/altar', 'opened');
        expect(helpersReady([a('cairn_h70', 'online'), opening])).toBe(false);
        expect(helpersReady([a('cairn_h70', 'online'), { ...opening, state: 'online' }])).toBe(true);
        expect(helpersReady([a('cairn_h70', 'online'), { ...opening, state: 'backoff' }])).toBe(false);
    });
    test('out of the run on its gate counts (scope closed, or no cue in time); stood down between segments is online; any other stop is not ready', () => {
        expect(helpersReady([a('cairn_h70', 'online'), gated(a('cairn_e11', 'stopped'), null, 'S06/altar', 'stopped')])).toBe(true);
        expect(helpersReady([a('cairn_h70', 'online'), gated(a('cairn_e11', 'stopping'), null, 'S06/altar', 'stopped')])).toBe(true);
        expect(helpersReady([a('cairn_h70', 'online'), gated(a('cairn_h45', 'stopped'), 'H12oM/mule', 'H12oP/mule', 'expired')])).toBe(true);
        expect(helpersReady([a('cairn_h70', 'online'), gated(a('cairn_t1', 'online'), 'S21/altar', 'S21/altar', 'stood-down')])).toBe(true);
        expect(helpersReady([a('cairn_h70', 'online'), gated(a('cairn_h72', 'logging-in'), null, 'S06/altar', 'watching')])).toBe(false);
        expect(helpersReady([a('cairn_h70', 'online'), a('cairn_h73', 'stopped')])).toBe(false); // stopped for another reason
    });
    test('helperReady: the per-account rule', () => {
        expect(helperReady({ state: 'online' })).toBe(true);
        expect(helperReady({ state: 'queued' })).toBe(false);
        expect(helperReady({ state: 'awaiting-cue', cue: { login: 'S21/altar', stop: 'S21/altar', state: 'waiting', ms: 1 } })).toBe(true);
    });
});

describe('the launcher login policy', () => {
    test('one exported policy: burst 3, then 6 a minute, at least 4 s apart', () => {
        expect(LAUNCHER_LOGIN_POLICY).toEqual({ perMinute: 6, burst: 3, minSpacingMs: 4000 });
    });
});

describe('ScopeSessions: a scope closes on its final stop or the next scope after a stop', () => {
    const S21: CueScope = { step: 'S21', family: 'altar' };
    const S22: CueScope = { step: 'S22', family: 'bone' };
    let seq = 0;
    const cue = (scope: CueScope, session: string, o: { stop?: boolean; final?: boolean; ms?: number } = {}): Cue => ({
        v: 1,
        scope,
        session,
        seq: ++seq,
        receiver: { sha256: 'x' },
        beacons: [{ tick: 1, ms: 1 }],
        schedule: 'robust',
        open: 5,
        turns: [],
        ...(o.stop ? { stop: true } : {}),
        ...(o.final ? { final: true } : {}),
        ms: o.ms ?? 1000
    });

    test('S21 as runecraft.ts writes it: segment stops stand down, new sessions reopen, the final stop closes', () => {
        const s = new ScopeSessions(S21, 100);
        expect(s.own(cue(S21, 'pre-login'))).toBe('open');
        expect(s.own(cue(S21, 'program-1'))).toBeNull(); // a new session while open: still open
        expect(s.own(cue(S21, 'program-1', { stop: true }))).toBe('stood-down');
        expect(s.own(cue(S21, 'program-1', { stop: true }))).toBeNull(); // a rewrite
        expect(s.own(cue(S21, 'robust-restart'))).toBe('open');
        expect(s.own(cue(S21, 'robust-restart', { stop: true }))).toBe('stood-down');
        expect(s.own(cue(S21, 'hand-back'))).toBe('open');
        expect(s.own(cue(S21, 'hand-back', { stop: true }))).toBe('stood-down');
        expect(s.state).toBe('stood-down');
        expect(s.own(cue(S21, 'hand-back', { stop: true, final: true }))).toBe('closed');
        expect(s.closed).toMatchObject({ why: 'final', scope: S21, cue: { session: 'hand-back', final: true } });
        expect(s.own(cue(S21, 'later'))).toBeNull(); // decided once
    });

    test('another scope after a stop closes it; another scope while it is open does not', () => {
        const s = new ScopeSessions(S21, 100);
        s.own(cue(S21, 'a'));
        expect(s.other(cue(S22, 'b'))).toBeNull(); // no stop yet: S21 is not over
        expect(s.state).toBe('open');
        s.own(cue(S21, 'a', { stop: true }));
        const next = cue(S22, 'c');
        expect(s.other(next)).toBe('closed');
        expect(s.closed).toMatchObject({ why: 'next-scope', cue: { scope: S22, session: 'c' }, after: { session: 'a', stop: true } });
    });

    test('cues from before the launch change nothing, the next scope included', () => {
        const s = new ScopeSessions(S21, 100);
        expect(s.own(cue(S21, 'old', { stop: true, final: true, ms: 50 }))).toBeNull();
        s.own(cue(S21, 'a'));
        s.own(cue(S21, 'a', { stop: true }));
        expect(s.other(cue(S22, 'old', { ms: 50 }))).toBeNull();
        expect(s.state).toBe('stood-down');
    });

    test('gateEvent: a cue from before the launch is nothing; then open, stop or final', () => {
        expect(gateEvent({ ms: 99 }, 100)).toBeNull();
        expect(gateEvent({ ms: 99, stop: true, final: true }, 100)).toBeNull();
        expect(gateEvent({ ms: 100 }, 100)).toBe('open');
        expect(gateEvent({ ms: 150, stop: true }, 100)).toBe('stop');
        expect(gateEvent({ ms: 150, stop: true, final: true }, 100)).toBe('final');
    });
});

describe('the cue gate', () => {
    const H12O: CueScope = { step: 'H12o', family: 'mule' };
    const S21: CueScope = { step: 'S21', family: 'altar' };
    const beacon = [{ tick: 1, ms: 1 }];
    const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
    const never = new Promise<void>(() => undefined);

    function gate(o: { login?: CueScope | null; stop?: CueScope | null; since?: number } = {}) {
        const dir = mkdtempSync(join(tmpdir(), 'cue-gate-'));
        const stops: ScopeClosed[] = [];
        const sessions: string[] = [];
        const logs: string[] = [];
        const g = new CueGate({
            dir,
            login: o.login === undefined ? H12O : o.login,
            stop: o.stop === undefined ? (o.login ?? H12O) : o.stop,
            since: o.since ?? Date.now() - 1,
            onStop: c => stops.push(c),
            onSession: (ev, c) => sessions.push(`${ev} ${c.session}`),
            log: l => logs.push(l),
            pollMs: 5
        });
        const writer = (scope: CueScope) => new CueWriter(dir, 'scored', scope);
        return { g, dir, stops, sessions, logs, writer };
    }

    test("logs in on the open of a cue addressed to its scope only: another step's or another family's cue does nothing", async () => {
        const t = gate();
        let settled: LoginWait | null = null;
        void t.g.waitForLogin(5000, never).then(w => (settled = w));
        t.writer({ step: 'H12', family: 'mule' }).write({ beacons: beacon, turns: [] }); // another step, same family
        await sleep(30);
        t.writer({ step: 'H12o', family: 'ring' }).write({ beacons: beacon, turns: [] }); // same step, another family
        await sleep(30);
        t.writer({ step: 'S06', family: 'altar' }).stop(beacon, { final: true }); // another scope's final stop
        await sleep(30);
        expect(settled).toBeNull();
        expect(t.stops).toEqual([]);
        const open = t.writer(H12O).write({ beacons: beacon, turns: [] });
        await sleep(30);
        expect(settled).toMatchObject({ result: 'open', cue: { session: open.session, seq: 1, scope: H12O } });
        t.g.close();
    });

    test('an S21 segment stop then a new session keeps the giver in; the final stop logs it out, once', async () => {
        const t = gate({ login: S21 });
        const pre = t.writer(S21);
        pre.write({ beacons: beacon, turns: [] }); // the pre-login cue
        expect((await t.g.waitForLogin(5000, never)).result).toBe('open');
        const program = t.writer(S21);
        program.write({ beacons: beacon, turns: [] });
        await sleep(30);
        program.stop(beacon); // the segment's stop
        await sleep(30);
        expect(t.stops).toEqual([]);
        const restart = t.writer(S21); // the robust restart, the stock rung, the hand-back
        restart.write({ beacons: beacon, turns: [] });
        await sleep(30);
        expect(t.stops).toEqual([]);
        expect(t.sessions).toEqual([`open ${pre.session}`, `stood-down ${program.session}`, `open ${restart.session}`]);
        restart.stop(beacon);
        await sleep(30);
        expect(t.stops).toEqual([]);
        restart.stop(beacon, { final: true });
        await sleep(30);
        restart.stop(beacon, { final: true });
        await sleep(30);
        expect(t.stops.map(c => [c.why, c.cue.session, c.cue.final])).toEqual([['final', restart.session, true]]);
        expect(closedText(t.stops[0]!)).toMatch(/^final stop for S21\/altar \(session .+, seq 3\)$/);
        t.g.close();
    });

    test("a next scope's open after the stop logs it out; one while the scope is open does not", async () => {
        const t = gate({ login: null, stop: S21 });
        const w = t.writer(S21);
        w.write({ beacons: beacon, turns: [] });
        await sleep(30);
        t.writer({ step: 'S19', family: 'courier' }).write({ beacons: beacon, turns: [] }); // S21 not stopped: nothing
        await sleep(30);
        expect(t.stops).toEqual([]);
        w.write({ beacons: beacon, turns: [] });
        await sleep(30);
        w.stop(beacon);
        await sleep(30);
        expect(t.stops).toEqual([]);
        const next = t.writer({ step: 'S22', family: 'bone' }).write({ beacons: beacon, turns: [] });
        await sleep(30);
        expect(t.stops.map(c => [c.why, c.cue.scope.step, c.cue.session])).toEqual([['next-scope', 'S22', next.session]]);
        expect(closedText(t.stops[0]!)).toMatch(/^cue for S22\/bone \(session .+, seq 1\) after S21\/altar's stop \(session .+, seq 3\)$/);
        t.g.close();
    });

    test('before the login: a final stop keeps it out for good; a plain stop keeps it waiting for the next open', async () => {
        const a = gate();
        a.writer(H12O).stop(beacon, { final: true });
        const w = await a.g.waitForLogin(5000, never);
        expect(w).toMatchObject({ result: 'stop', closed: { why: 'final' } });
        await sleep(1);
        expect(a.stops.length).toBe(1);
        a.writer(H12O).write({ beacons: beacon, turns: [] }); // a new session opening later
        await sleep(30);
        expect((await a.g.waitForLogin(5000, never)).result).toBe('stop');
        a.g.close();

        const b = gate();
        let settled: LoginWait | null = null;
        void b.g.waitForLogin(5000, never).then(r => (settled = r));
        b.writer(H12O).stop(beacon);
        await sleep(30);
        expect(settled).toBeNull();
        const open = b.writer(H12O).write({ beacons: beacon, turns: [] });
        await sleep(30);
        expect(settled).toMatchObject({ result: 'open', cue: { session: open.session } });
        b.g.close();

        const c = gate();
        c.writer(H12O).stop(beacon);
        await sleep(20);
        c.writer({ step: 'S22', family: 'bone' }).write({ beacons: beacon, turns: [] });
        expect(await c.g.waitForLogin(5000, never)).toMatchObject({ result: 'stop', closed: { why: 'next-scope' } });
        c.g.close();
    });

    test("loginOn with another stopOn: the login scope's close keeps it out, and so does the stop scope's", async () => {
        const other: CueScope = { step: 'S21b', family: 'altar' };
        const a = gate({ login: S21, stop: other });
        a.writer(S21).stop(beacon, { final: true });
        expect((await a.g.waitForLogin(5000, never)).result).toBe('stop');
        expect(a.stops).toEqual([]); // not the stop scope: the launcher keeps it out itself
        a.g.close();
        const b = gate({ login: S21, stop: other });
        b.writer(other).stop(beacon, { final: true });
        expect((await b.g.waitForLogin(5000, never)).result).toBe('stop');
        await sleep(1);
        expect(b.stops.length).toBe(1);
        b.g.close();
    });

    test('H12o: logged in on H12oM, out when H12oP closes; the login scope moving on does not log it out', async () => {
        const M: CueScope = { step: 'H12oM', family: 'mule' };
        const P: CueScope = { step: 'H12oP', family: 'mule' };
        const t = gate({ login: M, stop: P });
        const m = t.writer(M);
        m.write({ beacons: beacon, turns: [] });
        expect((await t.g.waitForLogin(5000, never)).result).toBe('open');
        m.stop(beacon);
        await sleep(20);
        const p = t.writer(P);
        p.write({ beacons: beacon, turns: [] }); // the next scope after M's stop: M closes, which is not the stop scope
        await sleep(30);
        expect(t.stops).toEqual([]);
        p.stop(beacon, { final: true });
        await sleep(30);
        expect(t.stops.map(c => [c.why, c.scope.step])).toEqual([['final', 'H12oP']]);
        t.g.close();
    });

    test('the wait is bounded: no cue in time is expired; a launcher stop ends it as stopped', async () => {
        const t = gate();
        const t0 = Date.now();
        expect(await t.g.waitForLogin(80, never)).toEqual({ result: 'expired' });
        expect(Date.now() - t0).toBeGreaterThanOrEqual(70);
        expect(await t.g.waitForLogin(5000, sleep(20))).toEqual({ result: 'stopped' });
        t.g.close();
    });

    test("cue.json from before the launch opens nothing and stops nothing (an earlier attempt's)", async () => {
        const dir = mkdtempSync(join(tmpdir(), 'cue-gate-'));
        new CueWriter(dir, 'scored', H12O).write({ beacons: beacon, turns: [] });
        const s06 = new CueWriter(dir, 'scored', { step: 'S06', family: 'altar' });
        s06.stop(beacon, { final: true });
        const stops: ScopeClosed[] = [];
        const logs: string[] = [];
        const since = Date.now() + 1;
        await sleep(5);
        const g = new CueGate({ dir, login: null, stop: { step: 'S06', family: 'altar' }, since, onStop: c => stops.push(c), log: l => logs.push(l), pollMs: 5 });
        await sleep(30);
        expect(stops).toEqual([]);
        expect(logs.some(l => /written before this launch ignored/.test(l))).toBe(true);
        s06.stop(beacon, { final: true }); // this launch's final stop
        await sleep(30);
        expect(stops.length).toBe(1);
        g.close();
    });

    test('a stop-only gate (stopOn) reports its close and nothing else', async () => {
        const S06: CueScope = { step: 'S06', family: 'altar' };
        const t = gate({ login: null, stop: S06 });
        const w = t.writer(S06);
        w.write({ beacons: beacon, turns: [] });
        await sleep(30);
        expect(t.stops).toEqual([]);
        w.stop(beacon, { final: true });
        await sleep(30);
        expect(t.stops.map(c => [c.why, c.cue.stop, c.cue.final])).toEqual([['final', true, true]]);
        t.g.close();
    });
});

describe('a login-only folder (loginOn.cueDir): the login trigger apart from the role folder', () => {
    const root = resolve(import.meta.dir, '..', '..');
    const H12O: CueScope = { step: 'H12o', family: 'mule' };
    const M: CueScope = { step: 'H12oM', family: 'mule' };
    const P: CueScope = { step: 'H12oP', family: 'mule' };
    const beacon = [{ tick: 1, ms: 1 }];
    const open = { beacons: beacon, turns: [] };
    const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
    const never = new Promise<void>(() => undefined);
    const botEnv = { BOT_USERNAME: 'cairn_h45', PASSWORD: 'pw', SERVER: 'rs-sdk-demo.fly.dev' };
    /** h45's entry as rs/551 generates it: MM's module writes h45-cue, run.ts writes h45-login. */
    const h45 = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
        account: 'cairn_h45',
        role: 'mule',
        cueDir: 'run-machine/h45-cue',
        loginOn: { ...H12O, cueDir: 'run-machine/h45-login' },
        stopOn: P,
        ...extra
    });
    const parse = (e: Record<string, unknown>) => parseLaunchConfig({ accounts: [e] }, root).accounts[0]!;
    const without = (e: Record<string, unknown>, key: string) => Object.fromEntries(Object.entries(e).filter(([k]) => k !== key));

    function folders(o: { since?: number } = {}) {
        const base = mkdtempSync(join(tmpdir(), 'login-folder-'));
        const roleDir = join(base, 'h45-cue');
        const loginDir = join(base, 'h45-login');
        const stops: ScopeClosed[] = [];
        const sessions: string[] = [];
        const logs: string[] = [];
        const since = o.since ?? Date.now() - 1;
        const gate = () =>
            new CueGate({
                dir: roleDir,
                loginDir,
                login: H12O,
                stop: P,
                since,
                onStop: c => stops.push(c),
                onSession: (ev, c) => sessions.push(`${ev} ${c.scope.step} ${c.session}`),
                log: l => logs.push(l),
                pollMs: 5
            });
        return { roleDir, loginDir, stops, sessions, logs, gate, role: (s: CueScope) => new CueWriter(roleDir, 'scored', s), login: () => new CueWriter(loginDir, 'scored', H12O) };
    }

    test('parsed: the login folder resolves against the checkout beside the role folder; without it, the one-folder gate as before', () => {
        const e = parse(h45());
        expect(e.loginOn).toEqual({ ...H12O, waitMs: DEFAULT_LOGIN_WAIT_MINUTES * 60_000, cueDir: join(root, 'run-machine', 'h45-login') });
        expect(e).toMatchObject({ cueDir: join(root, 'run-machine', 'h45-cue'), stopOn: P, final: false });
        expect(parse(h45({ cueDir: '/var/h45-cue', loginOn: { ...H12O, cueDir: '/var/h45-login' } })).loginOn!.cueDir).toBe('/var/h45-login');
        expect(parse(h45({ cueDir: undefined, options: { cueDir: 'run-machine/h45-cue' } })).cueDir).toBe(join(root, 'run-machine', 'h45-cue'));
        const plain = parse({ account: 'cairn_h45', role: 'mule', loginOn: H12O });
        expect(plain.loginOn!.cueDir).toBeNull();
        expect(plain.stopOn).toEqual(H12O);
    });

    test('refused: no path, no role folder, the role folder again (by any spelling), no stopOn, stopOn the trigger scope, final', () => {
        const bad = (e: Record<string, unknown>) => () => parse(e);
        expect(bad(h45({ loginOn: { ...H12O, cueDir: '' } }))).toThrow(/accounts\[0\]\.loginOn\.cueDir: a folder path is required/);
        expect(bad(h45({ loginOn: { ...H12O, cueDir: 7 } }))).toThrow(/a folder path is required \(got 7\)/);
        expect(bad(h45({ loginOn: { step: 'H12o', family: 'mules', cueDir: 'run-machine/h45-login' } }))).toThrow(/loginOn: a cue scope's family must be one of/);
        expect(bad(without(h45(), 'cueDir'))).toThrow(/needs the role's own cue folder named too/);
        expect(bad(h45({ loginOn: { ...H12O, cueDir: 'run-machine/h45-cue' } }))).toThrow(/is the role's cue folder; the login folder must be another \(one writer per folder\)/);
        expect(bad(h45({ loginOn: { ...H12O, cueDir: join(root, 'run-machine', '.', 'h45-cue') } }))).toThrow(/one writer per folder/);
        expect(bad({ ...without(h45(), 'cueDir'), options: { cueDir: 'run-machine/h45-login' } })).toThrow(/one writer per folder/);
        expect(bad(without(h45(), 'stopOn'))).toThrow(/needs stopOn/);
        expect(bad(h45({ stopOn: H12O }))).toThrow(/stopOn must be another scope than the login trigger's H12o\/mule/);
        expect(bad(h45({ final: true }))).toThrow(/final would stop the whole launcher/);
        expect(bad(h45({ after: 'ready' }))).toThrow(/alternatives/);
    });

    test("the role gets only its own folder: RC_CUE_DIR is the role folder, the options are untouched, the login cue's time is all that crosses", () => {
        const e = parse(h45({ options: { serveMode: 'request', carried: true } }));
        const r = roleEnv({ RC_CUE_DIR: '/tmp/shared' }, botEnv, e, gw, '/tmp/run', 123, 25_000, 4567);
        expect(r.RC_CUE_DIR).toBe(join(root, 'run-machine', 'h45-cue'));
        expect(JSON.parse(r.ROLE_OPTIONS!)).toEqual({ serveMode: 'request', carried: true });
        expect(r.LOGIN_CUE_MS).toBe('4567');
        expect(Object.values(r).some(v => v.includes('h45-login'))).toBe(false);
    });

    test("a login cue alone never serves a trade: the mule reads the role folder, and only MM's cue there asks", () => {
        const t = folders();
        const e = parse(h45({ cueDir: t.roleDir, loginOn: { ...H12O, cueDir: t.loginDir } }));
        const trigger = t.login().write(open);
        const env = roleEnv({}, botEnv, e, gw, '/tmp/run', Date.now(), 25_000, trigger.ms);
        const mule = muleOptions(JSON.parse(env.ROLE_OPTIONS!), env);
        expect(mule.cueDir).toBe(t.roleDir);
        expect(readCue(mule.cueDir)).toBeNull();
        expect(muleCueAction(readCue(mule.cueDir), null, cueEpoch(env))).toBe('none');
        t.role(M).write(open);
        expect(muleCueAction(readCue(mule.cueDir), null, cueEpoch(env))).toBe('ask');
    });

    test("only the login folder logs in: the trigger's scope or MM's M open written in the role folder opens nothing", async () => {
        const t = folders();
        const g = t.gate();
        expect(g.watching).toEqual([t.roleDir, t.loginDir]);
        let settled: LoginWait | null = null;
        void g.waitForLogin(5000, never).then(w => (settled = w));
        t.role(H12O).write(open);
        await sleep(30);
        t.role(M).write(open);
        await sleep(30);
        expect(settled).toBeNull();
        const trigger = t.login().write(open);
        await sleep(30);
        expect(settled).toMatchObject({ result: 'open', cue: { session: trigger.session, scope: H12O } });
        expect(g.watching).toEqual([t.roleDir]); // the login folder is not read again
        g.close();
    });

    test("after the login the login folder's stop, final and reopen do nothing; MM's P stands down on a plain stop and logs out on its final, once", async () => {
        const t = folders();
        const g = t.gate();
        const trigger = t.login();
        trigger.write(open);
        expect((await g.waitForLogin(5000, never)).result).toBe('open');
        trigger.stop(beacon);
        await sleep(20);
        trigger.stop(beacon, { final: true });
        await sleep(20);
        t.login().write(open); // a second trigger session: the login is decided once, no second login
        await sleep(20);
        expect(t.stops).toEqual([]);
        expect(t.sessions).toEqual([]);
        expect(await g.waitForLogin(5000, never)).toMatchObject({ result: 'open', cue: { session: trigger.session, seq: 1 } });
        const m = t.role(M);
        m.write(open);
        await sleep(20);
        m.stop(beacon); // M's stop when nothing was traded
        await sleep(20);
        const p = t.role(P);
        p.write(open);
        await sleep(20);
        p.stop(beacon);
        await sleep(20);
        expect(t.stops).toEqual([]);
        expect(t.sessions).toEqual([`open H12oP ${p.session}`, `stood-down H12oP ${p.session}`]);
        p.stop(beacon, { final: true });
        await sleep(20);
        p.stop(beacon, { final: true });
        await sleep(20);
        expect(t.stops.map(c => [c.why, c.scope.step, c.cue.session])).toEqual([['final', 'H12oP', p.session]]);
        g.close();
        expect(g.watching).toEqual([]);
    });

    test('the role folder closing first refuses the login for good: its final, or the next scope after its stop; no late login', async () => {
        const a = folders();
        const ga = a.gate();
        a.role(P).stop(beacon, { final: true });
        expect(await ga.waitForLogin(5000, never)).toMatchObject({ result: 'stop', closed: { why: 'final', scope: P } });
        await sleep(1);
        expect(a.stops.length).toBe(1);
        expect(ga.watching).toEqual([a.roleDir]); // settled: the login folder is let go
        a.login().write(open);
        await sleep(30);
        expect((await ga.waitForLogin(5000, never)).result).toBe('stop');
        ga.close();

        const b = folders();
        const gb = b.gate();
        const p = b.role(P);
        p.write(open);
        await sleep(20);
        p.stop(beacon);
        await sleep(20);
        b.role({ step: 'S22', family: 'bone' }).write(open);
        expect(await gb.waitForLogin(5000, never)).toMatchObject({ result: 'stop', closed: { why: 'next-scope', scope: P } });
        b.login().write(open);
        await sleep(30);
        expect((await gb.waitForLogin(5000, never)).result).toBe('stop');
        gb.close();
    });

    test("the trigger's own folder before the open: its final keeps the helper out, a plain stop keeps it waiting", async () => {
        const a = folders();
        const ga = a.gate();
        a.login().stop(beacon, { final: true });
        expect(await ga.waitForLogin(5000, never)).toMatchObject({ result: 'stop', closed: { why: 'final', scope: H12O } });
        expect(a.stops).toEqual([]); // the stop scope is P's: the launcher keeps it out itself
        ga.close();
        const b = folders();
        const gb = b.gate();
        let settled: LoginWait | null = null;
        void gb.waitForLogin(5000, never).then(w => (settled = w));
        b.login().stop(beacon);
        await sleep(30);
        expect(settled).toBeNull();
        b.login().write(open);
        await sleep(30);
        expect(settled).toMatchObject({ result: 'open' });
        gb.close();
    });

    test("both on disk at once, in either write order and whichever watcher fires first: the role folder's final wins over the open", async () => {
        for (let i = 0; i < 12; i++) {
            const t = folders();
            const g = t.gate();
            if (i % 2) {
                t.login().write(open);
                t.role(P).stop(beacon, { final: true });
            } else {
                t.role(P).stop(beacon, { final: true });
                t.login().write(open);
            }
            expect(await g.waitForLogin(5000, never)).toMatchObject({ result: 'stop', closed: { why: 'final', scope: P } });
            g.close();
        }
        // Both written before the gate starts reading (this launch's): the role folder is read first.
        const t = folders();
        t.login().write(open);
        t.role(P).stop(beacon, { final: true });
        const g = t.gate();
        expect(await g.waitForLogin(5000, never)).toMatchObject({ result: 'stop', closed: { why: 'final' } });
        g.close();
    });

    test('just before the login, stopClosedNow re-reads the role folder: a final written since the last poll already counts', async () => {
        const t = folders();
        const g = t.gate();
        t.login().write(open);
        expect((await g.waitForLogin(5000, never)).result).toBe('open');
        expect(g.stopClosedNow()).toBeNull();
        t.role(P).stop(beacon, { final: true });
        expect(g.stopClosedNow()).toMatchObject({ why: 'final', scope: P }); // synchronously, before any poll
        await sleep(1);
        expect(t.stops.length).toBe(1);
        g.close();
    });

    test("this launch's role final written before the gate reads keeps the helper out; an earlier launch's cues count for nothing, whatever their session", async () => {
        const since = Date.now();
        await sleep(2);
        const a = folders({ since });
        a.role(P).stop(beacon, { final: true }); // after the launcher's start, before its gate is armed
        const ga = a.gate();
        a.login().write(open);
        expect(await ga.waitForLogin(5000, never)).toMatchObject({ result: 'stop', closed: { why: 'final' } });
        ga.close();

        const base = folders({ since: Date.now() + 1_000_000 }); // only to name two folders with stale cues in them
        const earlierP = base.role(P);
        earlierP.write(open);
        earlierP.stop(beacon, { final: true });
        base.login().write(open);
        await sleep(5);
        const stops: ScopeClosed[] = [];
        const logs: string[] = [];
        const g = new CueGate({ dir: base.roleDir, loginDir: base.loginDir, login: H12O, stop: P, since: Date.now(), onStop: c => stops.push(c), log: l => logs.push(l), pollMs: 5 });
        let settled: LoginWait | null = null;
        void g.waitForLogin(5000, never).then(w => (settled = w));
        await sleep(30);
        expect(settled).toBeNull();
        expect(stops).toEqual([]);
        expect(logs.filter(l => /written before this launch ignored/.test(l)).length).toBe(1);
        const trigger = base.login().write(open);
        await sleep(30);
        expect(settled).toMatchObject({ result: 'open', cue: { session: trigger.session } });
        earlierP.write(open); // the earlier writer's session going on in this launch: counts by its write time
        await sleep(20);
        earlierP.stop(beacon, { final: true });
        await sleep(30);
        expect(stops.map(c => [c.why, c.cue.session])).toEqual([['final', earlierP.session]]);
        g.close();
    });

    test('folder identity: the role folder by another path, or through a symlink, is refused; a login folder needs a login scope', () => {
        const t = folders();
        mkdirSync(t.roleDir, { recursive: true });
        const link = join(t.roleDir, '..', 'h45-link');
        symlinkSync(t.roleDir, link);
        const opts = { login: H12O, stop: P, since: 0, onStop: () => undefined, log: () => undefined, pollMs: 5 };
        expect(() => new CueGate({ ...opts, dir: t.roleDir, loginDir: link })).toThrow(/one writer per folder/);
        expect(() => new CueGate({ ...opts, dir: t.roleDir, loginDir: join(t.roleDir, '.') })).toThrow(/one writer per folder/);
        expect(() => new CueGate({ ...opts, login: null, dir: t.roleDir, loginDir: t.loginDir })).toThrow(/needs a login scope/);
        expect(sameCueDir(t.roleDir, link)).toBe(true);
        expect(sameCueDir(t.roleDir, t.loginDir)).toBe(false);
        assertDistinctCueDirs(t.roleDir, t.loginDir);
        expect(existsSync(t.loginDir)).toBe(true);
    });

    test('without a login folder the gate is as before: one folder, one watcher for a shared scope, no re-read', () => {
        const dir = mkdtempSync(join(tmpdir(), 'cue-gate-'));
        const opts = { dir, since: 0, onStop: () => undefined, log: () => undefined, pollMs: 5 };
        const shared = new CueGate({ ...opts, login: H12O, stop: H12O });
        expect(shared.watching).toEqual([dir]);
        shared.close();
        const two = new CueGate({ ...opts, login: M, stop: P });
        expect(two.watching).toEqual([dir, dir]);
        two.close();
        expect(two.watching).toEqual([]);
    });
});

/** A role process the test ends by hand; it ends itself on SIGTERM unless told to ignore it. */
class FakeRole implements RoleProcess {
    exitCode: number | null = null;
    signals: string[] = [];
    readonly exited: Promise<number | null>;
    private end!: (code: number | null) => void;
    constructor(
        readonly pid: number,
        private readonly ignoreTerm = false
    ) {
        this.exited = new Promise(r => (this.end = r));
    }
    exit(code: number): void {
        if (this.exitCode !== null) return;
        this.exitCode = code;
        this.end(code);
    }
    kill(signal: 'SIGTERM' | 'SIGKILL'): void {
        this.signals.push(signal);
        if (signal === 'SIGKILL' || !this.ignoreTerm) this.exit(143);
    }
}

function harness(entry: { final?: boolean; ignoreTerm?: boolean; beforeSpawn?: () => Promise<void> } = {}) {
    const procs: FakeRole[] = [];
    const lines: string[] = [];
    const finals: string[] = [];
    let stopping = false;
    const loop = new RoleLoop(
        { account: 'cairn_h70', role: 'altar-giver', final: entry.final ?? false },
        {
            ...(entry.beforeSpawn ? { beforeSpawn: entry.beforeSpawn } : {}),
            spawn: () => {
                const p = new FakeRole(100 + procs.length, entry.ignoreTerm);
                procs.push(p);
                return p;
            },
            isStopping: () => stopping,
            log: l => lines.push(l),
            onFinal: why => finals.push(why),
            killGraceMs: 20
        }
    );
    const tick = () => new Promise(r => setTimeout(r, 0));
    return { loop, procs, lines, finals, tick, stop: () => (stopping = true) };
}

describe('RoleLoop: restart on client relaunch', () => {
    test('a relaunch terminates the running role and starts a fresh one at once', async () => {
        const h = harness();
        void h.loop.start();
        await h.tick();
        expect(h.procs.length).toBe(1);
        await h.loop.relaunched();
        await h.tick();
        expect(h.procs[0]!.signals).toEqual(['SIGTERM']);
        expect(h.procs.length).toBe(2);
        expect(h.loop.running).toBe(h.procs[1]!);
        expect(h.lines.some(l => /client relaunched; restarting role altar-giver/.test(l))).toBe(true);
        expect(h.lines.some(l => /restarting in/.test(l))).toBe(false);
    });

    test('a role that ignores SIGTERM is killed after the grace', async () => {
        const h = harness({ ignoreTerm: true });
        void h.loop.start();
        await h.tick();
        await h.loop.relaunched();
        await h.tick();
        expect(h.procs[0]!.signals).toEqual(['SIGTERM', 'SIGKILL']);
        expect(h.procs.length).toBe(2);
    });

    test('a final role terminated for a relaunch does not stop the launcher', async () => {
        const h = harness({ final: true });
        void h.loop.start();
        await h.tick();
        await h.loop.relaunched();
        await h.tick();
        expect(h.finals).toEqual([]);
        expect(h.procs.length).toBe(2);
        h.procs[1]!.exit(0);
        await h.tick();
        expect(h.finals).toEqual(['cairn_h70: final role altar-giver exited with code 0']);
    });

    test('a relaunch during the failure backoff starts the role without waiting it out', async () => {
        const h = harness();
        void h.loop.start();
        await h.tick();
        h.procs[0]!.exit(1);
        await h.tick();
        expect(h.lines.some(l => /role exited with code 1; restarting in \d+s/.test(l))).toBe(true);
        expect(h.procs.length).toBe(1);
        await h.loop.relaunched();
        await h.tick();
        expect(h.procs.length).toBe(2);
    });

    test('a role that finished its job is not restarted by a relaunch', async () => {
        const h = harness();
        const done = h.loop.start();
        await h.tick();
        h.procs[0]!.exit(0);
        await done;
        await h.loop.relaunched();
        await h.tick();
        expect(h.procs.length).toBe(1);
        expect(h.procs[0]!.signals).toEqual([]);
    });

    test('nothing restarts once the launcher is stopping', async () => {
        const h = harness();
        void h.loop.start();
        await h.tick();
        h.stop();
        await h.loop.relaunched();
        h.procs[0]!.exit(143);
        await h.loop.done;
        expect(h.procs.length).toBe(1);
    });
});

describe('RoleLoop: a start that is a login (direct path)', () => {
    test('every start waits for beforeSpawn first', async () => {
        let open: () => void = () => {};
        let calls = 0;
        const h = harness({
            beforeSpawn: () => {
                calls++;
                return new Promise<void>(r => (open = r));
            }
        });
        void h.loop.start();
        await h.tick();
        expect(calls).toBe(1);
        expect(h.procs.length).toBe(0); // waiting for its login slot
        open();
        await h.tick();
        expect(h.procs.length).toBe(1);
        await h.loop.relaunched();
        await h.tick();
        expect(calls).toBe(2);
        expect(h.procs.length).toBe(1);
        open();
        await h.tick();
        expect(h.procs.length).toBe(2);
    });

    test('a stop while waiting for a login slot starts nothing', async () => {
        let open: () => void = () => {};
        const h = harness({ beforeSpawn: () => new Promise<void>(r => (open = r)) });
        const done = h.loop.start();
        await h.tick();
        h.stop();
        open();
        await done;
        expect(h.procs.length).toBe(0);
    });
});
