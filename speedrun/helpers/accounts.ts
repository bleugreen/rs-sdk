// Helper account credentials on the fleet host. A demo account is created by
// its first login with whatever password is sent, so the password must be on
// disk before that login: losing it loses the account and everything in its
// bank. Hence the rules here: write the env file first, never overwrite one.
import { randomInt } from 'node:crypto';
import { chmod, mkdir, open, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ACCOUNT_NAME_RE, FORBIDDEN_ACCOUNTS } from './fleet-config';

export const DEMO_SERVER = 'rs-sdk-demo.fly.dev';

/** A block of numbered names such as h10-h14 (cairn_h10 .. cairn_h14). */
export interface AccountRange {
    stem: string;
    from: number;
    to: number;
    width: number;
}

/** Parse 'h10-h14' (or 'h07', a range of one). */
export function parseRange(spec: string): AccountRange {
    const m = /^([a-z]+)(\d+)(?:-\1?(\d+))?$/.exec(spec.trim());
    if (!m) throw new Error(`bad account range "${spec}": expected e.g. h10-h14`);
    const stem = m[1]!;
    const from = Number(m[2]);
    const to = Number(m[3] ?? m[2]);
    const width = m[2]!.length;
    if (to < from) throw new Error(`bad account range "${spec}": ${to} < ${from}`);
    if (!ACCOUNT_NAME_RE.test(`cairn_${stem}${String(to).padStart(width, '0')}`)) {
        throw new Error(`range "${spec}" yields names longer than 12 characters`);
    }
    return { stem, from, to, width };
}

export function rangeNames(range: AccountRange): string[] {
    const names: string[] = [];
    for (let n = range.from; n <= range.to; n++) names.push(`cairn_${range.stem}${String(n).padStart(range.width, '0')}`);
    return names;
}

/** The first name in the range that has no credentials yet, or null when the range is used up. */
export function nextAccountName(existing: Iterable<string>, range: AccountRange): string | null {
    const taken = new Set(existing);
    return rangeNames(range).find(n => !taken.has(n) && !FORBIDDEN_ACCOUNTS.has(n)) ?? null;
}

const PASSWORD_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** 12 alphanumeric characters, the same shape bots/create-bot.ts makes, from a CSPRNG. */
export function generatePassword(length = 12, pick: (n: number) => number = randomInt): string {
    let out = '';
    for (let i = 0; i < length; i++) out += PASSWORD_ALPHABET[pick(PASSWORD_ALPHABET.length)];
    return out;
}

export function renderBotEnv(username: string, password: string, server = DEMO_SERVER): string {
    return [
        `BOT_USERNAME=${username}`,
        `PASSWORD=${password}`,
        `SERVER=${server}`,
        // The fleet's own SDK connection never prints chat; this only affects ad-hoc scripts.
        'SHOW_CHAT=false',
        ''
    ].join('\n');
}

export function parseBotEnv(text: string): Record<string, string> {
    const env: Record<string, string> = {};
    for (const line of text.split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#') || !t.includes('=')) continue;
        env[t.slice(0, t.indexOf('=')).trim()] = t.slice(t.indexOf('=') + 1).trim();
    }
    return env;
}

/** Account directories already present under bots/. */
export async function listAccounts(botsDir: string): Promise<string[]> {
    try {
        const entries = await readdir(botsDir, { withFileTypes: true });
        return entries.filter(e => e.isDirectory() && ACCOUNT_NAME_RE.test(e.name)).map(e => e.name).sort();
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw e;
    }
}

/**
 * Write bots/<account>/bot.env with a fresh password (directory 700, file 600).
 * Opens with O_EXCL, so an existing file is never touched: that file may hold
 * the only copy of a live account's password.
 */
export async function createAccountEnv(botsDir: string, account: string, server = DEMO_SERVER): Promise<string> {
    if (!ACCOUNT_NAME_RE.test(account) || FORBIDDEN_ACCOUNTS.has(account)) {
        throw new Error(`refusing to create credentials for "${account}"`);
    }
    const dir = join(botsDir, account);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await chmod(dir, 0o700);
    const path = join(dir, 'bot.env');
    const handle = await open(path, 'wx', 0o600).catch((e: NodeJS.ErrnoException) => {
        if (e.code === 'EEXIST') throw new Error(`${path} already exists; not overwriting it`);
        throw e;
    });
    try {
        await handle.writeFile(renderBotEnv(account, generatePassword(), server));
    } finally {
        await handle.close();
    }
    return path;
}
