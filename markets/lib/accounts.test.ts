import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { AccountsListMissing, loadExclusion, parseAccounts } from './accounts.ts';

const dir = mkdtempSync(join(tmpdir(), 'markets-accounts-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const file = (name: string, text: string) => {
    const p = join(dir, name);
    writeFileSync(p, text);
    return p;
};
const missing = join(dir, 'absent.txt');
const noEnv = {};

test('parseAccounts drops comments and blanks and keys names', () => {
    expect(parseAccounts('# money accounts\nPlaceholder One\n\nplaceholder_two  # note\n')).toEqual(['placeholder one', 'placeholder two']);
});

describe('loadExclusion', () => {
    test('refuses without a list file', () => {
        expect(() => loadExclusion({ path: missing, env: noEnv })).toThrow(AccountsListMissing);
    });

    test('runs on placeholder data with the flag or the env var, still excluding cairn_ names', () => {
        for (const ex of [loadExclusion({ path: missing, allowMissing: true, env: noEnv }), loadExclusion({ path: missing, env: { MARKETS_ALLOW_NO_ACCOUNTS: '1' } })]) {
            expect(ex.source).toBeNull();
            expect(ex.excludes('cairn_h61')).toBe(true);
            expect(ex.excludes('Cairn H61')).toBe(true);
            expect(ex.excludes('nickai3')).toBe(false);
        }
    });

    test('excludes every listed name in board or display form', () => {
        const ex = loadExclusion({ path: file('list.txt', 'Placeholder One\nplaceholder_two # note\n'), env: noEnv });
        expect(ex.size).toBe(2);
        expect(ex.excludes('placeholder_one')).toBe(true);
        expect(ex.excludes('Placeholder Two')).toBe(true);
        expect(ex.keep([{ name: 'placeholder one' }, { name: 'kept' }, { name: 'cairn_mule1' }])).toEqual([{ name: 'kept' }]);
    });

    test('reads the path in MARKETS_ACCOUNTS_FILE', () => {
        const ex = loadExclusion({ env: { MARKETS_ACCOUNTS_FILE: file('env.txt', 'placeholder three') } });
        expect(ex.excludes('Placeholder Three')).toBe(true);
    });

    test('an empty list file counts as present', () => {
        const ex = loadExclusion({ path: file('empty.txt', ''), env: noEnv });
        expect(ex.source).not.toBeNull();
        expect(ex.size).toBe(0);
    });

    test('an unreadable list refuses even with the flag', () => {
        expect(() => loadExclusion({ path: dir, allowMissing: true, env: noEnv })).toThrow('unreadable');
    });
});

describe('writers fail closed (timeline.ts, offline)', () => {
    const data = join(dir, 'data');
    const snapshot = { takenAt: '2026-10-21T08:04:27.000Z', bank: { top: [{ rank: 1, name: 'placeholder_one', gp: 9, items: [] }, { rank: 2, name: 'keptname', gp: 8, items: [] }], searches: {} } };
    const run = (args: string[], env: Record<string, string>) => {
        writeFileSync(join((Bun.spawnSync(['mkdir', '-p', data]), data), 'snapshot-2026-10-21T080427Z.json'), JSON.stringify(snapshot));
        const { MARKETS_ALLOW_NO_ACCOUNTS: _a, MARKETS_ACCOUNTS_FILE: _f, ...base } = process.env;
        const p = Bun.spawnSync(['bun', resolve(import.meta.dir, '../tools/timeline.ts'), `--dir=${data}`, ...args], { env: { ...base, ...env }, stdout: 'pipe', stderr: 'pipe' });
        return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
    };

    test('refuses to start with no list file', () => {
        const r = run([], { MARKETS_ACCOUNTS_FILE: missing });
        expect(r.code).toBe(2);
        expect(r.err).toContain('refusing to start');
    });

    test('runs with --placeholder-data', () => {
        const r = run(['--placeholder-data'], { MARKETS_ACCOUNTS_FILE: missing });
        expect(r.code).toBe(0);
        expect(r.out).toContain('keptname');
    });

    test('drops listed names from its output', () => {
        const r = run([], { MARKETS_ACCOUNTS_FILE: file('writer.txt', 'placeholder_one\n') });
        expect(r.code).toBe(0);
        expect(r.out).toContain('keptname');
        expect(r.out).not.toContain('placeholder');
    });
});
