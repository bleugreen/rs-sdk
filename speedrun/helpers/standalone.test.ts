import { describe, expect, test } from 'bun:test';

import { DIRECT_IN_WORLD, DIRECT_IN_WORLD_RE, DIRECT_REFUSED_RE } from './role';
import { checkBotEnv, helpersReady, parseLaunchConfig, RoleLoop, type RoleProcess, roleEnv, type Stoppable, stopAllWithin } from './standalone';

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
});

describe('helpersReady', () => {
    const a = (account: string, state: 'online' | 'logging-in', receiver = false) => ({ account, role: 'r', receiver, path: 'relay' as const, state, loggedInAt: null, logins: 1 });
    test('every helper online; receivers do not count', () => {
        expect(helpersReady([a('cairn_h70', 'online'), a('cairn_h75', 'logging-in', true)])).toBe(true);
        expect(helpersReady([a('cairn_h70', 'online'), a('cairn_h71', 'logging-in')])).toBe(false);
        expect(helpersReady([a('cairn_h75', 'online', true)])).toBe(false);
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
