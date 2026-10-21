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
    parseFleetConfig
} from './fleet-config';
import { applyBankReport, emptyLedger, LedgerWriter, parseLedger, readLedger } from './ledger';
import { Backoff, backoffDelay, LoginLimiter, loginFailurePolicy } from './backoff';
import { parseEvents, summariseEvents, type FleetEvent } from './events';
import { createAccountEnv, generatePassword, nextAccountName, parseBotEnv, parseRange, rangeNames } from './accounts';

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
