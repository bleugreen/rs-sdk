/**
 * The markets money accounts: names that must never appear in code, tests, docs, commits, posts or committed data
 * (the repository is public). This is the one place the list is read. It holds names only; credentials stay
 * outside the checkout.
 *
 * The list is a text file, one name per line, `#` starting a comment: `markets/accounts.local.txt` (gitignored) or
 * the path in MARKETS_ACCOUNTS_FILE. Every tool that writes shared data from live reads takes its exclusion from
 * writerExclusion(): it refuses to start when the list is missing or unreadable (fail closed), unless
 * `--placeholder-data` or MARKETS_ALLOW_NO_ACCOUNTS=1 says the output is placeholder data for tests or CI.
 * An empty file counts as present. Our own naming schemes are always excluded too, list or no list (ALWAYS_EXCLUDED):
 * the fleet's `cairn_*`, and markets' `money_*` and `moneybags`, so a stale list file can't leak one of them.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { playerNameKey } from './positions.ts';

export const ACCOUNTS_FILE_ENV = 'MARKETS_ACCOUNTS_FILE';
export const ALLOW_NO_ACCOUNTS_ENV = 'MARKETS_ALLOW_NO_ACCOUNTS';
export const PLACEHOLDER_FLAG = '--placeholder-data';
export const DEFAULT_ACCOUNTS_FILE = resolve(import.meta.dir, '../accounts.local.txt');

export class AccountsListMissing extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'AccountsListMissing';
    }
}

/** Names in a list file's text, as playerNameKey keys. */
export function parseAccounts(text: string): string[] {
    return text
        .split('\n')
        .map(line => line.replace(/#.*$/, '').trim())
        .filter(Boolean)
        .map(playerNameKey);
}

/** The list at `path`, or null if no file exists there; any other read failure throws. */
export function readAccountsFile(path: string): string[] | null {
    try {
        return parseAccounts(readFileSync(path, 'utf8'));
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw new AccountsListMissing(`accounts list ${path} is unreadable (${e instanceof Error ? e.message : e})`);
    }
}

/** Name keys excluded whatever the list holds: a prefix (ending in the key's space for `_`) or a whole name. */
export const ALWAYS_EXCLUDED = { prefixes: ['cairn ', 'money '], names: ['moneybags'] } as const;

export const alwaysExcluded = (key: string): boolean => ALWAYS_EXCLUDED.prefixes.some(p => key.startsWith(p)) || (ALWAYS_EXCLUDED.names as readonly string[]).includes(key);

export class Exclusion {
    private readonly names: Set<string>;
    constructor(
        names: Iterable<string>,
        /** The list file read, or null when running on placeholder data without one. */
        readonly source: string | null
    ) {
        this.names = new Set([...names].map(playerNameKey));
    }

    get size(): number {
        return this.names.size;
    }

    excludes(name: string): boolean {
        const key = playerNameKey(name);
        return alwaysExcluded(key) || this.names.has(key);
    }

    keep<T extends { name: string }>(rows: T[]): T[] {
        return rows.filter(r => !this.excludes(r.name));
    }
}

export interface ExclusionOptions {
    path?: string;
    /** Proceed without a list file (placeholder data only). An unreadable file still refuses. */
    allowMissing?: boolean;
    env?: Record<string, string | undefined>;
}

export function loadExclusion(opts: ExclusionOptions = {}): Exclusion {
    const env = opts.env ?? process.env;
    const path = opts.path ?? env[ACCOUNTS_FILE_ENV] ?? DEFAULT_ACCOUNTS_FILE;
    const names = readAccountsFile(path);
    if (names) return new Exclusion(names, path);
    if (opts.allowMissing || env[ALLOW_NO_ACCOUNTS_ENV] === '1') return new Exclusion([], null);
    throw new AccountsListMissing(
        `no accounts list at ${path}. Tools that write shared data refuse to run without it: set ${ACCOUNTS_FILE_ENV} to the list file, or pass ${PLACEHOLDER_FLAG} (or ${ALLOW_NO_ACCOUNTS_ENV}=1) for placeholder data only`
    );
}

/** For a tool that writes shared data: its exclusion, or exit 2 with the reason. */
export function writerExclusion(argv: string[] = Bun.argv): Exclusion {
    try {
        return loadExclusion({ allowMissing: argv.includes(PLACEHOLDER_FLAG) });
    } catch (e) {
        console.error(`refusing to start: ${e instanceof Error ? e.message : e}`);
        process.exit(2);
    }
}
