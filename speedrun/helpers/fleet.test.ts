import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    activeAccounts,
    ConfigError,
    diffActive,
    HARD_MAX_ACCOUNTS,
    parseFleetConfig
} from './fleet-config';
import { applyBankReport, emptyLedger, LedgerWriter, parseLedger, readLedger } from './ledger';
import { Backoff, backoffDelay, LoginGate } from './backoff';
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
        expect(c.accounts[0]).toEqual({ account: 'cairn_h01', role: 'feathers', options: {}, enabled: true, stallMinutes: 20 });
    });

    test('refuses more than the hard ceiling of enabled accounts, but not disabled extras', () => {
        const many = Array.from({ length: HARD_MAX_ACCOUNTS + 1 }, (_, i) => acct(i));
        expect(problemsOf({ accounts: many }).join()).toContain(`refuses to run more than ${HARD_MAX_ACCOUNTS}`);
        many[0] = { ...many[0]!, enabled: false };
        expect(problemsOf({ accounts: many })).toEqual([]);
        expect(problemsOf({ maxOnline: 61, accounts: [] }).join()).toContain('maxOnline');
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

    test('login gate spaces turns across callers', async () => {
        let clock = 0;
        const waits: number[] = [];
        const gate = new LoginGate(4000, () => clock, async ms => {
            waits.push(ms);
        });
        await Promise.all([gate.turn(), gate.turn(), gate.turn()]);
        expect(waits).toEqual([4000, 8000]);
        clock = 20_000;
        expect(await gate.turn()).toBe(0);
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
