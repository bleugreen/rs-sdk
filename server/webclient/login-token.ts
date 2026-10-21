// One-time login tokens, so a page served by proxy.ts can log an account in
// without its password ever appearing in a URL or a process argument.
//
//   1. A launcher that can read the account's bot.env (session.ts,
//      speedrun/tools/tab-login.ts) POSTs /bot/login-token with
//      {bot, proof}, where proof = loginTokenProof(BOT_USERNAME, PASSWORD), and
//      gets back a random token: single use, valid for LOGIN_TOKEN_TTL_MS.
//   2. It navigates the tab to /bot?bot=NAME&token=T over the Chrome DevTools
//      protocol (a websocket message, not a command line).
//   3. The page strips the token from its address bar and POSTs it to
//      /bot/login, which consumes it and answers with the credentials read
//      from bot.env. The page keeps them in memory only (GatewayConnection.ts).
//
// The proof is why other users on the host cannot mint a token: the proxy only
// listens on TCP, which carries no peer uid, so the minter shows it holds the
// password without sending it. Both endpoints answer loopback peers only.

import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import fs from 'fs';
import path from 'path';

export const LOGIN_TOKEN_TTL_MS = 60_000;

/** Account directory names under --bots-dir: a game username, never a path. */
const ACCOUNT = /^[A-Za-z0-9_][A-Za-z0-9_ -]{0,11}$/;

export interface BotCredentials {
    username: string;
    password: string;
}

/** An error with the HTTP status the proxy answers it with. */
export class LoginError extends Error {
    constructor(readonly status: number, message: string) {
        super(message);
    }
}

/** What a minter sends to show it holds the account's password without sending it. */
export function loginTokenProof(username: string, password: string): string {
    return createHmac('sha256', password).update(`rs-proxy-login-token:${username.toLowerCase()}`).digest('hex');
}

export function proofMatches(creds: BotCredentials, proof: string): boolean {
    const want = Buffer.from(loginTokenProof(creds.username, creds.password));
    const got = Buffer.from(proof);
    return got.length === want.length && timingSafeEqual(got, want);
}

export function isLoopbackAddress(address: string | undefined | null): boolean {
    if (!address) return false;
    const a = address.replace(/^::ffff:/i, '');
    return a === '::1' || a.startsWith('127.');
}

/**
 * Read <botsDir>/<account>/bot.env. Refuses a file other users can read: the
 * point of this path is that the password lives only in a mode-600 file.
 */
export function readBotCredentials(botsDir: string, account: string): BotCredentials {
    if (!ACCOUNT.test(account)) throw new LoginError(400, `not an account name: ${JSON.stringify(account)}`);
    const file = path.join(botsDir, account, 'bot.env');
    let mode: number;
    try {
        mode = fs.statSync(file).mode;
    } catch {
        throw new LoginError(404, `no bot.env for ${account} under ${botsDir}`);
    }
    if ((mode & 0o077) !== 0) {
        throw new LoginError(403, `${file} is mode ${(mode & 0o777).toString(8)}: other users can read it; chmod 600 it`);
    }
    const env: Record<string, string> = {};
    for (const line of fs.readFileSync(file, 'utf-8').split('\n')) {
        const t = line.trim();
        const eq = t.indexOf('=');
        if (t && !t.startsWith('#') && eq > 0) env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
    }
    const username = env.BOT_USERNAME;
    const password = env.PASSWORD;
    if (!username || !password) throw new LoginError(500, `${file} needs BOT_USERNAME and PASSWORD`);
    if (username.toLowerCase() !== account.toLowerCase()) {
        throw new LoginError(500, `${file} is for ${username}, not ${account}: name the directory after BOT_USERNAME`);
    }
    return { username, password };
}

/** Live tokens, in memory only: a restarted proxy has none. */
export class LoginTokens {
    private readonly live = new Map<string, { account: string; expiresAt: number }>();

    constructor(
        private readonly ttlMs: number = LOGIN_TOKEN_TTL_MS,
        private readonly now: () => number = Date.now
    ) {}

    mint(account: string): string {
        this.sweep();
        const token = randomBytes(32).toString('base64url');
        this.live.set(token, { account: account.toLowerCase(), expiresAt: this.now() + this.ttlMs });
        return token;
    }

    /**
     * Consume a token. Any presented token is spent, matching or not, so a
     * wrong guess at the account cannot be retried with the same token.
     */
    redeem(token: string, account: string): 'ok' | 'unknown' | 'expired' | 'wrong-account' {
        const entry = this.live.get(token);
        if (!entry) return 'unknown';
        this.live.delete(token);
        if (this.now() >= entry.expiresAt) return 'expired';
        if (entry.account !== account.toLowerCase()) return 'wrong-account';
        return 'ok';
    }

    get size(): number {
        this.sweep();
        return this.live.size;
    }

    private sweep(): void {
        const now = this.now();
        for (const [token, entry] of this.live) {
            if (now >= entry.expiresAt) this.live.delete(token);
        }
    }
}
