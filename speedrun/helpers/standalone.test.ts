import { describe, expect, test } from 'bun:test';

import { checkBotEnv, helpersReady, parseLaunchConfig, RoleLoop, type RoleProcess, roleEnv } from './standalone';

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
        expect(c.accounts.map(a => a.account)).toEqual(['cairn_h70', 'cairn_h75']);
        expect(c.accounts[1]).toMatchObject({ receiver: true, final: true, after: 'ready', args: [] });
        expect(c.runDir.endsWith('run-machine')).toBe(true);
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
    });
});

describe('helpersReady', () => {
    const a = (account: string, state: 'online' | 'logging-in', receiver = false) => ({ account, role: 'r', receiver, state, loggedInAt: null, logins: 1 });
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

function harness(entry: { final?: boolean; ignoreTerm?: boolean } = {}) {
    const procs: FakeRole[] = [];
    const lines: string[] = [];
    const finals: string[] = [];
    let stopping = false;
    const loop = new RoleLoop(
        { account: 'cairn_h70', role: 'altar-giver', final: entry.final ?? false },
        {
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
        expect(h.lines.some(l => /restarting in 15s/.test(l))).toBe(true);
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
