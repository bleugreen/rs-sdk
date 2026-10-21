import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    activeAccounts,
    ConfigError,
    diffActive,
    FORBIDDEN_ACCOUNTS,
    HARD_MAX_ACCOUNTS,
    parseForbiddenList,
    parseFleetConfig,
    returnAssignment,
    type AccountConfig
} from './fleet-config';
import { memoryRoleState, openRoleState, type Role, type RoleContext } from './role';
import { applyBankReport, emptyLedger, LedgerWriter, parseLedger, readLedger } from './ledger';
import { Backoff, backoffDelay, LoginLimiter, loginFailurePolicy } from './backoff';
import { parseEvents, summariseEvents, type FleetEvent } from './events';
import { createAccountEnv, generatePassword, nextAccountName, parseBotEnv, parseRange, rangeNames } from './accounts';
import { waitForFreshState } from '../lib/fresh-state';
import { stubGateway } from '../lib/stub-gateway';

const acct = (n: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    account: `cairn_h${String(n).padStart(2, '0')}`,
    role: 'feathers',
    ...extra
});

function problemsOf(raw: unknown): string[] {
    try {
        parseFleetConfig(raw);
        return [];
    } catch (e) {
        expect(e).toBeInstanceOf(ConfigError);
        return (e as ConfigError).problems;
    }
}

describe('fleet config', () => {
    test('fills defaults', () => {
        const c = parseFleetConfig({ accounts: [acct(1)] });
        expect(c.maxOnline).toBe(40);
        expect(c.gatewayPort).toBe(7790);
        expect(c.loginStaggerMs).toBe(4000);
        expect([c.loginsPerMinute, c.loginBurst]).toEqual([4, 3]);
        expect(problemsOf({ loginsPerMinute: 60, accounts: [] }).join()).toContain('loginsPerMinute');
        expect(c.accounts[0]).toEqual({ account: 'cairn_h01', role: 'feathers', options: {}, enabled: true, stallMinutes: 20 });
    });

    test('refuses more than the hard ceiling of enabled accounts, but not disabled extras', () => {
        const many = Array.from({ length: HARD_MAX_ACCOUNTS + 1 }, (_, i) => acct(i));
        expect(problemsOf({ accounts: many }).join()).toContain(`refuses to run more than ${HARD_MAX_ACCOUNTS}`);
        many[0] = { ...many[0]!, enabled: false };
        expect(problemsOf({ accounts: many })).toEqual([]);
        expect(problemsOf({ maxOnline: 61, accounts: [] }).join()).toContain('maxOnline');
    });

    test('the private forbidden list parses names and display forms, ignoring comments', () => {
        expect(parseForbiddenList('# the scored account\nWww Cairn Zz\n\n  cairn_x1  # spare\n')).toEqual(['www_cairn_zz', 'cairn_x1']);
    });

    test('never runs the former scored-account candidate www_cairn_md', () => {
        expect(FORBIDDEN_ACCOUNTS.has('www_cairn_md')).toBe(true);
        const problems = problemsOf({ accounts: [{ account: 'www_cairn_md', role: 'feathers' }] });
        expect(problems).toHaveLength(1);
        expect(problems[0]).toMatch(/www_cairn_md/);
    });

    test('refuses the scored account, foreign names, duplicates and bad roles, all at once', () => {
        const problems = problemsOf({
            accounts: [
                { account: 'cairn_dot_md', role: 'feathers' },
                { account: 'stunbaron', role: 'feathers' },
                acct(1),
                acct(1),
                { account: 'cairn_h02', role: '../evil' },
                { account: 'cairn_h03', role: 'feathers', option: {} }
            ]
        });
        expect(problems).toHaveLength(5);
        expect(problems.join('\n')).toMatch(/cairn_dot_md is not a helper account/);
        expect(problems.join('\n')).toMatch(/stunbaron/);
        expect(problems.join('\n')).toMatch(/listed twice/);
        expect(problems.join('\n')).toMatch(/role must match/);
        expect(problems.join('\n')).toMatch(/unknown key "option"/);
    });

    test('gateway port is confined to the fleet block', () => {
        expect(problemsOf({ gatewayPort: 7780, accounts: [] }).join()).toContain('gatewayPort');
        expect(problemsOf({ gatewayPort: 7795, accounts: [] })).toEqual([]);
    });

    test('active accounts are enabled entries in file order, capped at maxOnline', () => {
        const c = parseFleetConfig({ maxOnline: 2, accounts: [acct(1), acct(2, { enabled: false }), acct(3), acct(4)] });
        expect(activeAccounts(c).map(a => a.account)).toEqual(['cairn_h01', 'cairn_h03']);
    });

    test('reload diff separates new, removed and re-roled accounts', () => {
        const before = parseFleetConfig({ accounts: [acct(1), acct(2), acct(3)] }).accounts;
        const after = parseFleetConfig({
            accounts: [acct(1), acct(2, { options: { pen: 'fred' } }), acct(4)]
        }).accounts;
        const d = diffActive(before, after);
        expect(d.start.map(a => a.account)).toEqual(['cairn_h04']);
        expect(d.stop).toEqual(['cairn_h03']);
        expect(d.changed.map(a => a.account)).toEqual(['cairn_h02']);
    });
});

describe('then: where an account goes when its role finishes', () => {
    const coinsOptions = { mode: 'earn', spot: { x: 3290, z: 3170 }, keep: [1, 2] };
    const handoverEntry = (extra: Record<string, unknown> = {}) => ({
        account: 'cairn_h63',
        role: 'handover',
        options: { handovers: [{ to: 'cairn_h53', items: [{ item: 'Coins', n: 100_000 }] }] },
        then: { role: 'coins', options: coinsOptions },
        stallMinutes: 30,
        ...extra
    });

    test('parsed and validated', () => {
        const c = parseFleetConfig({ accounts: [handoverEntry(), acct(1)] });
        expect(c.accounts[0]!.then).toEqual({ role: 'coins', options: coinsOptions });
        expect(c.accounts[1]!.then).toBeUndefined();
        expect(parseFleetConfig({ accounts: [handoverEntry({ then: { role: 'coins' } })] }).accounts[0]!.then).toEqual({ role: 'coins', options: {} });
        const problems = problemsOf({ accounts: [handoverEntry({ then: { role: '../x', option: {} } }), handoverEntry({ account: 'cairn_h64', then: 'coins' })] });
        expect(problems.join('\n')).toMatch(/then: role must match/);
        expect(problems.join('\n')).toMatch(/then: unknown key "option"/);
        expect(problems.join('\n')).toMatch(/then must be/);
    });

    test('returnAssignment: the entry takes the then role and options exactly and keeps its other settings', () => {
        const raw = { maxOnline: 30, accounts: [acct(1), handoverEntry()] };
        const finished = parseFleetConfig(raw).accounts[1]!;
        const r = returnAssignment(raw, finished);
        if (typeof r === 'string') throw new Error(r);
        expect(r.config.maxOnline).toBe(30);
        expect((r.config.accounts as unknown[])[0]).toEqual(acct(1));
        expect((r.config.accounts as unknown[])[1]).toEqual({ account: 'cairn_h63', role: 'coins', options: coinsOptions, stallMinutes: 30 });
        expect(r.next).toEqual({ account: 'cairn_h63', role: 'coins', options: coinsOptions, enabled: true, stallMinutes: 30 });
        // The input is not modified.
        expect(raw.accounts[1]).toEqual(handoverEntry());
    });

    test('returnAssignment leaves an entry someone reassigned, or one with no then, alone', () => {
        const finished = parseFleetConfig({ accounts: [handoverEntry()] }).accounts[0]!;
        expect(returnAssignment({ accounts: [handoverEntry({ role: 'woodcutter' })] }, finished)).toMatch(/now assigns cairn_h63 woodcutter/);
        expect(returnAssignment({ accounts: [handoverEntry({ options: { handovers: [] } })] }, finished)).toMatch(/now assigns/);
        expect(returnAssignment({ accounts: [handoverEntry({ then: undefined })] }, finished)).toMatch(/no "then"/);
        expect(returnAssignment({ accounts: [] }, finished)).toMatch(/no longer in fleet.json/);
    });

    test('a then-only change is not a reassignment on reload', () => {
        const before = parseFleetConfig({ accounts: [handoverEntry()] }).accounts;
        const after = parseFleetConfig({ accounts: [handoverEntry({ then: { role: 'idle' } })] }).accounts;
        expect(diffActive(before, after)).toEqual({ start: [], stop: [], changed: [] });
    });
});

describe('FleetRoleLoop: a role that returns has finished', () => {
    const settle = async () => {
        for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 0));
    };
    /** A role that runs until its signal aborts, like a gathering loop. */
    const forever = (name: string): Role => ({
        name,
        produces: [],
        run: ctx => new Promise<void>(resolve => ctx.signal.addEventListener('abort', () => resolve(), { once: true }))
    });

    async function harness(raw: { accounts: Record<string, unknown>[] }, roles: Record<string, Role>) {
        const { FleetRoleLoop } = await import('./fleet');
        const runs: { role: string; options: Record<string, unknown> }[] = [];
        const notes: string[] = [];
        const events: Record<string, unknown>[] = [];
        const attention: string[] = [];
        const delays: number[] = [];
        const disk = { raw: raw as unknown };
        let stopping = false;
        const loop = new FleetRoleLoop(parseFleetConfig(raw).accounts[0]!, {
            load: async name => roles[name] ?? Promise.reject(new Error(`no role ${name}`)),
            context: async (cfg, signal) => ({ account: cfg.account, options: cfg.options, signal, state: memoryRoleState(), log: () => {} }) as unknown as RoleContext,
            run: (role, ctx) => {
                runs.push({ role: role.name, options: ctx.options });
                return role.run(ctx);
            },
            started: () => {},
            failed: () => {},
            attention: text => attention.push(text),
            note: text => notes.push(text),
            event: (type, fields) => events.push({ type, ...fields }),
            returnTo: async (finished: AccountConfig) => {
                const r = returnAssignment(disk.raw, finished);
                if (typeof r === 'string') return null;
                disk.raw = r.config;
                return r.next;
            },
            isStopping: () => stopping,
            sleep: async ms => {
                delays.push(ms);
            }
        });
        return { loop, runs, notes, events, attention, delays, disk, stop: () => (stopping = true) };
    }

    const handoverH63 = { account: 'cairn_h63', role: 'handover', options: { handovers: [{ to: 'cairn_h53', items: [{ item: 'Coins', n: 100_000 }] }] } };
    let handoverRuns = 0;
    const handover: Role = {
        name: 'handover',
        produces: [],
        run: async () => {
            handoverRuns++;
        }
    };

    test('2026-10-21 21:32 h63: handover finished and the supervisor must not run it again, this session or the next', async () => {
        handoverRuns = 0;
        const h = await harness({ accounts: [handoverH63] }, { handover });
        const session = new AbortController();
        const running = h.loop.run(session.signal);
        await settle();
        expect(handoverRuns).toBe(1);
        expect(h.loop.finished).toBe(true);
        expect(h.notes).toContain('[fleet] role handover finished; not restarting it');
        expect(h.notes.some(n => /restarting it in/.test(n))).toBe(false);
        expect(h.events).toEqual([{ type: 'role_finished', then: null }]);
        session.abort(new Error('game session ended'));
        await running;

        // A re-login starts a new session on the same loop: still finished.
        const next = new AbortController();
        const again = h.loop.run(next.signal);
        await settle();
        expect(handoverRuns).toBe(1);
        next.abort();
        await again;
    });

    test('with then: the account goes back to its previous role with its exact options, written to fleet.json first', async () => {
        handoverRuns = 0;
        const coinsOptions = { mode: 'earn', spot: { x: 3290, z: 3170 }, keep: ['Coins', 'Lobster'] };
        const h = await harness({ accounts: [{ ...handoverH63, then: { role: 'coins', options: coinsOptions }, stallMinutes: 30 }] }, { handover, coins: forever('coins') });
        const session = new AbortController();
        const running = h.loop.run(session.signal);
        await settle();
        expect(h.runs).toEqual([
            { role: 'handover', options: handoverH63.options },
            { role: 'coins', options: coinsOptions }
        ]);
        expect((h.disk.raw as { accounts: unknown[] }).accounts).toEqual([{ account: 'cairn_h63', role: 'coins', options: coinsOptions, stallMinutes: 30 }]);
        expect(h.loop.cfg).toMatchObject({ role: 'coins', options: coinsOptions });
        expect(h.loop.cfg.then).toBeUndefined();
        expect(h.loop.finished).toBe(false);
        expect(h.delays).toEqual([]);
        session.abort();
        await running;
    });

    test('an uncertain outcome also finishes, asks for a person, and still returns the account', async () => {
        const uncertain: Role = { name: 'handover', produces: [], run: async () => ({ attention: 'handover uncertain to cairn_h53: check the receiver before giving again' }) };
        const h = await harness({ accounts: [{ ...handoverH63, then: { role: 'coins' } }] }, { handover: uncertain, coins: forever('coins') });
        const session = new AbortController();
        const running = h.loop.run(session.signal);
        await settle();
        expect(h.runs.map(r => r.role)).toEqual(['handover', 'coins']);
        expect(h.attention).toEqual(['handover uncertain to cairn_h53: check the receiver before giving again']);
        expect(h.events[0]).toMatchObject({ type: 'role_finished', then: 'coins', needsAttention: true });
        expect(h.notes.some(n => n.includes('!!! ATTENTION'))).toBe(true);
        session.abort();
        await running;
    });

    test('a role that throws is restarted with backoff; one stopped by a stall is restarted at once', async () => {
        let n = 0;
        const flaky: Role = {
            name: 'feathers',
            produces: [],
            run: async () => {
                if (++n <= 2) throw new Error(`boom ${n}`);
                await new Promise(() => {});
            }
        };
        const h = await harness({ accounts: [acct(1)] }, { feathers: flaky });
        const session = new AbortController();
        const running = h.loop.run(session.signal);
        await settle();
        expect(n).toBe(3);
        expect(h.delays.length).toBe(2);
        expect(h.delays[0]!).toBeGreaterThanOrEqual(15_000);
        expect(h.loop.finished).toBe(false);
        h.loop.ctl!.abort(new Error('stalled'));
        await settle();
        expect(h.delays[2]).toBe(3_000);
        session.abort();
        await running;
    });

    test('a finished account idles until reassigned, then runs the new role', async () => {
        handoverRuns = 0;
        const h = await harness({ accounts: [handoverH63] }, { handover, coins: forever('coins') });
        const session = new AbortController();
        const running = h.loop.run(session.signal);
        await settle();
        expect(h.loop.finished).toBe(true);
        h.loop.reconfigure(parseFleetConfig({ accounts: [{ account: 'cairn_h63', role: 'coins' }] }).accounts[0]!);
        await settle();
        expect(h.runs.map(r => r.role)).toEqual(['handover', 'coins']);
        // A reload that only changes `then` of the finished assignment does not start it again.
        h.loop.reconfigure(parseFleetConfig({ accounts: [handoverH63] }).accounts[0]!);
        await settle();
        expect(handoverRuns).toBe(2);
        h.loop.update(parseFleetConfig({ accounts: [{ ...handoverH63, then: { role: 'idle' } }] }).accounts[0]!);
        await settle();
        expect(handoverRuns).toBe(2);
        expect(h.loop.finished).toBe(true);
        session.abort();
        await running;
    });
});

describe('role state on disk', () => {
    test('survives a reopen; a corrupt file refuses to open rather than read as empty', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'role-state-'));
        const path = join(dir, 'sub', 'cairn_h63.json');
        const a = await openRoleState(path);
        expect(a.get('handover/x/0')).toBeUndefined();
        await Promise.all([a.set('handover/x/0', { outcome: 'giving' }), a.set('handover/x/1', { outcome: 'delivered' })]);
        await a.set('handover/x/0', { outcome: 'uncertain' });
        const b = await openRoleState(path);
        expect([b.get('handover/x/0'), b.get('handover/x/1')]).toEqual([{ outcome: 'uncertain' }, { outcome: 'delivered' }]);
        await b.set('handover/x/1', undefined);
        expect((await openRoleState(path)).get('handover/x/1')).toBeUndefined();
        await writeFile(path, '{"torn');
        await expect(openRoleState(path)).rejects.toThrow(/not a JSON object/);
    });
});

describe('ledger', () => {
    const report = (account: string, asOf: string, items: { id: number; name: string; count: number }[]) => ({
        account,
        role: 'feathers',
        asOf,
        items
    });

    test('per-account snapshots replace, totals sum across accounts by name', () => {
        let l = emptyLedger();
        l = applyBankReport(l, report('cairn_h01', '2026-10-21T04:00:00.000Z', [{ id: 314, name: 'Feather', count: 100 }]));
        l = applyBankReport(l, report('cairn_h02', '2026-10-21T04:01:00.000Z', [
            { id: 314, name: 'Feather', count: 50 },
            { id: 526, name: 'Bones', count: 3 }
        ]));
        expect(l.totals).toEqual({ Bones: 3, Feather: 150 });
        l = applyBankReport(l, report('cairn_h01', '2026-10-21T04:02:00.000Z', [{ id: 314, name: 'Feather', count: 400 }]));
        expect(l.totals).toEqual({ Bones: 3, Feather: 450 });
        expect(l.asOf).toBe('2026-10-21T04:02:00.000Z');
        expect(Object.keys(l.totals)).toEqual(['Bones', 'Feather']);
    });

    test('an older report never overwrites a newer snapshot', () => {
        let l = applyBankReport(emptyLedger(), report('cairn_h01', '2026-10-21T05:00:00.000Z', [{ id: 314, name: 'Feather', count: 900 }]));
        l = applyBankReport(l, report('cairn_h01', '2026-10-21T04:00:00.000Z', [{ id: 314, name: 'Feather', count: 10 }]));
        expect(l.totals.Feather).toBe(900);
    });

    test('duplicate and empty rows are normalised', () => {
        const l = applyBankReport(emptyLedger(), report('cairn_h01', '2026-10-21T04:00:00.000Z', [
            { id: 314, name: 'Feather', count: 5 },
            { id: 314, name: 'Feather', count: 7 },
            { id: 1, name: 'Nothing', count: 0 }
        ]));
        expect(l.accounts.cairn_h01!.bank).toEqual([{ id: 314, name: 'Feather', count: 12 }]);
    });

    test('round-trips through its file format, recomputing totals', () => {
        const l = applyBankReport(emptyLedger(), report('cairn_h01', '2026-10-21T04:00:00.000Z', [{ id: 314, name: 'Feather', count: 5 }]));
        const tampered = JSON.stringify({ ...l, totals: { Feather: 99999 } });
        expect(parseLedger(tampered)!.totals).toEqual({ Feather: 5 });
        expect(parseLedger('{nope')).toBeNull();
    });

    test('writer serialises concurrent reports and appends history; a corrupt file is moved aside', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'ledger-'));
        const path = join(dir, 'stockpile.json');
        await writeFile(path, 'garbage');
        const w = new LedgerWriter(path, join(dir, 'history.jsonl'));
        await Promise.all([
            w.record(report('cairn_h01', '2026-10-21T04:00:00.000Z', [{ id: 314, name: 'Feather', count: 5 }])),
            w.record(report('cairn_h02', '2026-10-21T04:00:01.000Z', [{ id: 314, name: 'Feather', count: 6 }]))
        ]);
        const onDisk = await readLedger(path);
        expect(onDisk.totals).toEqual({ Feather: 11 });
        expect((await readFile(join(dir, 'history.jsonl'), 'utf8')).trim().split('\n')).toHaveLength(2);
    });
});

describe('backoff', () => {
    const policy = { initialMs: 10_000, maxMs: 60_000, resetAfterMs: 300_000, jitter: 0 };

    test('doubles up to the cap', () => {
        expect([0, 1, 2, 3, 4].map(a => backoffDelay(a, policy))).toEqual([10_000, 20_000, 40_000, 60_000, 60_000]);
    });

    test('a run that stayed up resets the streak; a quick death does not', () => {
        const b = new Backoff(policy, () => 0);
        expect(b.failure(null, 0)).toBe(10_000);
        expect(b.failure(1_000, 5_000)).toBe(20_000);
        expect(b.failure(10_000, 20_000)).toBe(40_000);
        expect(b.failure(100_000, 100_000 + 300_000)).toBe(10_000);
    });

    test('jitter only ever adds delay, bounded by the fraction', () => {
        const b = new Backoff({ ...policy, jitter: 0.5 }, () => 0.999);
        const d = b.failure(null, 0);
        expect(d).toBeGreaterThan(10_000);
        expect(d).toBeLessThanOrEqual(15_000);
    });

});

describe('login limiter', () => {
    const policy = { perMinute: 4, burst: 3, minSpacingMs: 4000 };

    test('a burst, then the sustained rate, never closer than the spacing', () => {
        const limiter = new LoginLimiter(policy, () => 0);
        // 3 tokens spaced 4 s, then one token per 15 s (4 per minute).
        expect(Array.from({ length: 6 }, () => limiter.reserve())).toEqual([0, 4000, 8000, 15000, 30000, 45000]);
    });

    test('a whole fleet dropping at once comes back gradually', () => {
        const limiter = new LoginLimiter(policy, () => 0);
        const slots = Array.from({ length: 40 }, () => limiter.reserve());
        // 40 accounts take about 9.5 minutes, and no minute holds more than burst + rate.
        expect(slots.at(-1)!).toBeGreaterThan(9 * 60_000);
        for (let m = 0; m < 10; m++) {
            expect(slots.filter(t => t >= m * 60_000 && t < (m + 1) * 60_000).length).toBeLessThanOrEqual(policy.burst + policy.perMinute);
        }
    });

    test('the bucket refills while idle, up to the burst', () => {
        let clock = 0;
        const limiter = new LoginLimiter(policy, () => clock);
        for (let i = 0; i < 3; i++) limiter.reserve();
        clock = 10 * 60_000;
        expect([limiter.reserve(), limiter.reserve(), limiter.reserve(), limiter.reserve()].map(t => t - clock)).toEqual([0, 4000, 8000, 15000]);
    });

    test('a pause holds every login, including callers already waiting', async () => {
        let clock = 0;
        const limiter = new LoginLimiter(policy, () => clock, async ms => {
            clock += ms;
            if (clock >= 4000 && clock < 5000) limiter.pause(120_000); // a refusal lands while this caller waits
        });
        await limiter.take(); // t=0
        await limiter.take(); // booked for 4000, paused meanwhile
        expect(clock).toBeGreaterThanOrEqual(120_000);
    });

    test('refusal policy: code 16 backs off hard and pauses the fleet; credentials need a person', () => {
        expect(loginFailurePolicy(16)).toEqual({ accountDelayMs: 300_000, fleetPauseMs: 120_000, needsAttention: false });
        expect(loginFailurePolicy(16, 2).accountDelayMs).toBe(600_000);
        expect(loginFailurePolicy(16, 9).accountDelayMs).toBe(1_200_000);
        expect(loginFailurePolicy(8).fleetPauseMs).toBe(60_000);
        expect(loginFailurePolicy(3).needsAttention).toBe(true);
        expect(loginFailurePolicy(5)).toEqual({ accountDelayMs: 0, fleetPauseMs: 0, needsAttention: false });
    });
});

describe('events', () => {
    const at = (iso: string, type: FleetEvent['type'], account?: string, extra: Record<string, unknown> = {}): FleetEvent => ({ t: iso, type, ...(account ? { account } : {}), ...extra });

    test('clusters are minutes where trouble hit two or more accounts, or the gateway', () => {
        const events = [
            at('2026-10-21T05:04:10Z', 'sdk_stall', 'cairn_h50'),
            at('2026-10-21T05:04:40Z', 'sdk_stall', 'cairn_h51'),
            at('2026-10-21T05:10:00Z', 'session_end', 'cairn_h01'),
            at('2026-10-21T05:20:05Z', 'gateway_exit', undefined, { code: 130 }),
            at('2026-10-21T05:21:00Z', 'login_error', 'cairn_h02', { code: 16 }),
            at('2026-10-21T05:21:30Z', 'login_error', 'cairn_h03', { code: 16 }),
            at('2026-10-21T05:22:00Z', 'login', 'cairn_h02'),
            at('2026-10-21T03:00:00Z', 'session_end', 'cairn_h09') // outside the hour
        ];
        const s = summariseEvents(events, Date.parse('2026-10-21T05:30:00Z'));
        expect(s.counts).toEqual({ sdk_stall: 2, session_end: 1, gateway_exit: 1, login_error: 2, login: 1 });
        expect(s.loginErrors).toEqual({ '16': 2 });
        expect(s.clusters.map(c => [c.minute, c.accounts])).toEqual([
            ['2026-10-21T05:21:00.000Z', ['cairn_h02', 'cairn_h03']],
            ['2026-10-21T05:20:00.000Z', []],
            ['2026-10-21T05:04:00.000Z', ['cairn_h50', 'cairn_h51']]
        ]);
    });

    test('a torn last line is skipped', () => {
        expect(parseEvents('{"t":"2026-10-21T05:00:00Z","type":"login"}\n{"t":"2026-')).toHaveLength(1);
    });
});

describe('role phase lines', () => {
    test('either form names the phase; other lines are not phases', async () => {
        const { describePhase } = await import('./fleet');
        expect(describePhase('phase', { phase: 'gather' })).toBe('gather');
        expect(describePhase('phase', { from: 'train', to: 'gather' })).toBe('gather');
        expect(describePhase('phase gather')).toBe('gather');
        expect(describePhase('phase: train')).toBe('train');
        expect(describePhase('phased out')).toBeNull();
        expect(describePhase('banked', { phase: 'x' })).toBeNull();
    });
});

describe('accounts', () => {
    test('ranges and next free name', () => {
        expect(rangeNames(parseRange('h01-h04'))).toEqual(['cairn_h01', 'cairn_h02', 'cairn_h03', 'cairn_h04']);
        expect(rangeNames(parseRange('h10-14'))).toHaveLength(5);
        expect(nextAccountName(['cairn_h01', 'cairn_h03'], parseRange('h01-h04'))).toBe('cairn_h02');
        expect(nextAccountName(['cairn_h01', 'cairn_h02'], parseRange('h01-h02'))).toBeNull();
        expect(() => parseRange('h4-h1')).toThrow();
        expect(() => parseRange('mule1234567')).toThrow();
    });

    test('passwords are 12 alphanumerics', () => {
        expect(generatePassword()).toMatch(/^[A-Za-z0-9]{12}$/);
    });

    test('env file is private, parseable, and never overwritten', async () => {
        const bots = await mkdtemp(join(tmpdir(), 'bots-'));
        const path = await createAccountEnv(bots, 'cairn_h01');
        const env = parseBotEnv(await readFile(path, 'utf8'));
        expect(env.BOT_USERNAME).toBe('cairn_h01');
        expect(env.SERVER).toBe('rs-sdk-demo.fly.dev');
        expect(env.PASSWORD).toMatch(/^[A-Za-z0-9]{12}$/);
        expect((await stat(path)).mode & 0o777).toBe(0o600);
        expect((await stat(join(bots, 'cairn_h01'))).mode & 0o777).toBe(0o700);
        await expect(createAccountEnv(bots, 'cairn_h01')).rejects.toThrow(/already exists/);
        expect(parseBotEnv(await readFile(path, 'utf8')).PASSWORD).toBe(env.PASSWORD!);
        await expect(createAccountEnv(bots, 'cairn_dot_md')).rejects.toThrow(/refusing/);
    });
});

describe('session state after a re-login', () => {
    const coins = { slot: 0, id: 995, name: 'Coins', count: 2750, optionsWithIndex: [] };
    const kebab = { slot: 1, id: 1971, name: 'Kebab', count: 1, optionsWithIndex: [] };
    const worldState = (tick: number, inventory: unknown[]) => ({
        tick,
        inGame: true,
        player: { name: 'cairn_h05', worldX: 3185, worldZ: 3436 },
        inventory
    });

    async function connectedSdk(url: string) {
        const { BotSDK } = await import('../../sdk/index');
        const sdk = new BotSDK({
            botUsername: 'cairn_h05',
            password: 'unused',
            gatewayUrl: url,
            connectionMode: 'control',
            autoReconnect: false,
            autoLaunchBrowser: false,
            readyTimeout: 0
        });
        await sdk.connect();
        return sdk;
    }

    /** Resolves once the SDK holds a state with `tick`, so a test can look at what it cached. */
    const holds = (sdk: { waitForCondition(p: (s: { tick: number }) => boolean, ms: number): Promise<unknown> }, tick: number) =>
        sdk.waitForCondition(s => s.tick === tick, 2000);

    test('re-enable: a new SDK is handed the pre-trip state, and the role starts on the new session instead', async () => {
        const gw = stubGateway();
        // The account's last state in the fleet, from before it left for its trip: it still carries the coins.
        gw.publish(worldState(9000, [coins, kebab]), Date.now() - 10 * 60_000);
        const sdk = await connectedSdk(gw.url);
        try {
            // The fleet starts its wait as soon as connect() returns, before the replay lands.
            let started = false;
            const gate = waitForFreshState(sdk, { timeoutMs: 5000 }).then(r => ((started = true), r));
            await holds(sdk, 9000);
            expect(sdk.getInventory().map(i => i.name)).toEqual(['Coins', 'Kebab']); // what the role would have seen
            await Bun.sleep(50);
            expect(started).toBe(false);

            // The new client session: its tick count starts again, and the coins were given away on the trip.
            gw.publish({ ...worldState(1, [kebab]), player: null });
            gw.publish(worldState(2, [kebab]));
            gw.publish(worldState(3, [kebab]));
            const { state, passedOver } = await gate;
            expect(state.tick).toBe(3);
            expect(passedOver).toEqual([9000]);
            // The role's context reads this same SDK: from here on it sees only the new session.
            expect(sdk.getState()!.tick).toBe(3);
            expect(sdk.getInventory().map(i => i.name)).toEqual(['Kebab']);
        } finally {
            await sdk.disconnect();
            gw.stop();
        }
    });

    test('relaunch: an SDK kept across sessions waits past its own cached state', async () => {
        const gw = stubGateway();
        const sdk = await connectedSdk(gw.url);
        try {
            gw.publish(worldState(4321, [coins]));
            await holds(sdk, 4321);
            // The old client is gone; the SDK still holds its last state.
            const gate = waitForFreshState(sdk, { timeoutMs: 5000 });
            gw.publish(worldState(3, []));
            gw.publish(worldState(4, []));
            const { state, passedOver } = await gate;
            expect([state.tick, passedOver]).toEqual([4, [4321]]);
            expect(sdk.getInventory()).toEqual([]);
        } finally {
            await sdk.disconnect();
            gw.stop();
        }
    });

    test('times out rather than start on a replayed state when no client publishes', async () => {
        const gw = stubGateway();
        gw.publish(worldState(9000, [coins]), Date.now() - 60_000);
        const sdk = await connectedSdk(gw.url);
        try {
            await holds(sdk, 9000);
            await expect(waitForFreshState(sdk, { timeoutMs: 200 })).rejects.toThrow(/no fresh game state/);
        } finally {
            await sdk.disconnect();
            gw.stop();
        }
    });
});
