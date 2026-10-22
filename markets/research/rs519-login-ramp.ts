// Login limits on one address, measured on a lab engine (markets Q2d, rs/519;
// write-up in docs/markets/scaling-limits.md). No demo login: every connection
// here goes to a lab engine this script boots itself, once per experiment, so the
// in-memory limiters (World.loginAddressAttempts / loginDeviceAttempts, the login
// server's loginRequests and lastTakeover) start empty each time.
//
//   bun markets/research/rs519-login-ramp.ts [e1 e2 e3 e4 e5]
//
// Port block (rs/519): web 9960, management 9961, hiscores 9962, game 44960,
// gateway 7960 (not started), friend 45960, login 43960, logger 43961. Override
// with the usual env names. LAB_LOG (default $TMPDIR/rs519-lab) holds the engine
// logs and the GE ledger.
//
// Every engine runs the demo's committed fly.toml [env] (login server, friend
// server, auto-registration, NODE_DEBUG, 400 ms ticks) with MAX_PLAYERS_PER_IP=50,
// the operator's announced value. The experiments differ only in NODE_PRODUCTION
// and the two NODE_RATELIMIT_* values, the switches the demo's real values for
// which are not public.
//
//   e1  demo config, production off: 52 back-to-back first logins (registrations)
//       from one address; then drop one socket and log in two more.
//   e2  demo config: 45 existing accounts at once; two simultaneous logins of one
//       account; takeover and the takeover throttle.
//   e3  production on, engine defaults (30 per address per 60 s, 5 per uid per
//       15 s): logins 400 ms apart until refused; retries during the lockout;
//       14 s and 16 s of silence.
//   e4  production on, device limiter off: the address limiter alone.
//   e5  production on, engine defaults: the proposed safe ramp for 45 new accounts.

import { spawn, type Subprocess } from 'bun';
import { mkdirSync, openSync, readFileSync } from 'fs';
import { join } from 'path';
import { GameConnection, LoginError, LOGIN_RESPONSE } from '../../server/webclient/src/lite/net/GameConnection.ts';

const ROOT = join(import.meta.dir, '..', '..');
const ENGINE = join(ROOT, 'server', 'engine');
const LOG = process.env.LAB_LOG ?? join(process.env.TMPDIR ?? '/tmp', 'rs519-lab');
mkdirSync(LOG, { recursive: true });

const PORTS = {
    WEB_PORT: process.env.WEB_PORT ?? '9960',
    WEB_MANAGEMENT_PORT: process.env.WEB_MANAGEMENT_PORT ?? '9961',
    HISCORES_WEB_PORT: process.env.HISCORES_WEB_PORT ?? '9962',
    NODE_PORT: process.env.NODE_PORT ?? '44960',
    AGENT_PORT: process.env.AGENT_PORT ?? '7960',
    FRIEND_PORT: process.env.FRIEND_PORT ?? '45960',
    LOGIN_PORT: process.env.LOGIN_PORT ?? '43960',
    LOGGER_PORT: process.env.LOGGER_PORT ?? '43961'
};
const HOST = `localhost:${PORTS.WEB_PORT}`;
const ORIGIN = `http://${HOST}`;

// The demo's committed fly.toml [env], minus ports and file paths, plus the
// operator's announced per-address cap. NODE_MAX_CONNECTED is pinned to the code
// default so a stale data/config/world.json in the slot can't change it.
const DEMO_ENV: Record<string, string> = {
    NODE_DEBUG: 'true',
    BUILD_STARTUP: 'false',
    BUILD_STARTUP_UPDATE: 'false',
    BUILD_VERIFY: 'false',
    BUILD_LIVE_RELOAD: 'false',
    DB_BACKEND: 'sqlite',
    EASY_STARTUP: 'true',
    FRIEND_SERVER: 'true',
    LOGIN_SERVER: 'true',
    NODE_MEMBERS: 'true',
    NODE_RANDOM_EVENTS: 'false',
    NODE_TICKRATE: '400',
    NODE_XPRATE: '25',
    WEBSITE_REGISTRATION: 'false',
    MAX_PLAYERS_PER_IP: '50',
    NODE_MAX_CONNECTED: '1000',
    NODE_RATELIMIT_ADDRESS_LOGIN: '30',
    NODE_RATELIMIT_DEVICE_LOGIN: '5',
    LOCAL_STAFF_LEVEL: '0',
    GE_DATABASE: join(LOG, 'market.sqlite')
};

// Placeholder lab names, unique per run so rows left in the slot's db.sqlite don't collide.
const TOKEN = process.env.RS519_TOKEN ?? Date.now().toString(36).slice(-3);
const acct = (group: string, i: number) => `q${TOKEN}${group}${i}`;
const PASSWORD = 'rs519lab';

const sleep = (ms: number) => Bun.sleep(ms);
const now = () => Date.now();

// ------------------------------------------------------------------ engine

let engine: Subprocess | null = null;
let crc: number[] = [];

async function boot(label: string, extra: Record<string, string>): Promise<void> {
    const path = join(LOG, `engine-${label}.log`);
    const out = openSync(path, 'w');
    const t0 = now();
    engine = spawn(['bun', 'run', 'src/app.ts'], { cwd: ENGINE, env: { ...process.env, ...PORTS, ...DEMO_ENV, ...extra }, stdout: out, stderr: out });
    for (;;) {
        await sleep(1000);
        const text = readFileSync(path, 'utf8');
        if (/EADDRINUSE|Failed to start server/.test(text)) throw new Error(`${label}: a port in the block is taken:\n${text.slice(-800)}`);
        if (engine.exitCode !== null) throw new Error(`${label}: engine exited ${engine.exitCode}:\n${text.slice(-800)}`);
        if (now() - t0 > 900_000) throw new Error(`${label}: engine not ready after 15 min`);
        if (!text.includes('World ready')) continue;
        try {
            const res = await fetch(`${ORIGIN}/crc`);
            if (!res.ok) continue;
            const v = new DataView(await res.arrayBuffer());
            crc = Array.from({ length: 9 }, (_, i) => v.getInt32(i * 4));
            break;
        } catch {
            /* web port not bound yet */
        }
    }
    // the world's login and friend clients connect after the web server binds
    await sleep(3000);
    console.log(`[${label}] engine ready in ${((now() - t0) / 1000).toFixed(1)} s (${Object.entries(extra).map(([k, v]) => `${k}=${v}`).join(' ') || 'demo config'})`);
}

async function halt(): Promise<void> {
    for (const conn of sessions.values()) conn.close();
    sessions.clear();
    if (engine) {
        engine.kill('SIGKILL');
        await engine.exited;
        engine = null;
    }
    await sleep(1500);
}

async function playercount(): Promise<number> {
    const res = await fetch(`${ORIGIN}/playercount`);
    return ((await res.json()) as { count: number }).count;
}

// ------------------------------------------------------------------ logins

type Attempt = { user: string; code: number; startMs: number; ms: number };
const sessions = new Map<string, GameConnection>();
let T0 = now();
let LABEL = '';

function describe(code: number): string {
    if (code === 2) return 'ok';
    if (code === -2) return 'no reply';
    return LOGIN_RESPONSE[code] ?? `code ${code}`;
}

async function attempt(user: string): Promise<Attempt> {
    const start = now();
    let code = 2;
    try {
        const conn = await Promise.race([
            GameConnection.connect({ host: HOST, secured: false, username: user, password: PASSWORD, checksums: crc }),
            sleep(30_000).then(() => {
                throw new Error('timeout');
            })
        ]);
        sessions.get(user)?.close();
        sessions.set(user, conn);
    } catch (err) {
        code = err instanceof LoginError ? err.code : -2;
    }
    const a = { user, code, startMs: start - T0, ms: now() - start };
    console.log(`[${LABEL}] +${(a.startMs / 1000).toFixed(1)}s ${user} ${code} ${describe(code)} (${a.ms} ms)`);
    return a;
}

/** Attempts started at least `spacingMs` apart, each after the previous one answered. */
async function sequence(users: string[], spacingMs: number): Promise<Attempt[]> {
    const out: Attempt[] = [];
    let last = 0;
    for (const u of users) {
        const wait = last + spacingMs - now();
        if (wait > 0) await sleep(wait);
        last = now();
        out.push(await attempt(u));
    }
    return out;
}

function tally(as: Attempt[]): Record<string, number> {
    const t: Record<string, number> = {};
    for (const a of as) t[describe(a.code)] = (t[describe(a.code)] ?? 0) + 1;
    return t;
}

const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : 0;
};

async function experiment<T>(label: string, env: Record<string, string>, body: () => Promise<T>): Promise<T> {
    LABEL = label;
    await boot(label, env);
    T0 = now();
    try {
        return await body();
    } finally {
        await halt();
    }
}

// ------------------------------------------------------------------ experiments

const results: Record<string, unknown> = {};

async function e1() {
    results.e1 = await experiment('e1', { NODE_PRODUCTION: 'false' }, async () => {
        const users = Array.from({ length: 52 }, (_, i) => acct('a', i));
        const t = now();
        const seq = await sequence(users, 0);
        const ramp = now() - t;
        const okMs = seq.filter(a => a.code === 2).map(a => a.ms);
        const firstRefusal = seq.findIndex(a => a.code !== 2);
        const before = await playercount();

        // A dropped socket: the player stays in the world, but its client becomes a
        // NullClientSocket whose address is 'unknown', so the address count falls.
        sessions.get(users[0])!.close();
        sessions.delete(users[0]);
        await sleep(1200);
        const afterDrop = await playercount();
        const extra1 = await attempt(acct('a', 52));
        const extra2 = await attempt(acct('a', 53));
        // The dropped account logs in again from the same address: a takeover, which
        // the per-address cap does not check.
        const back = await attempt(users[0]);
        await sleep(1200);
        const end = await playercount();
        return {
            sequential52: { tally: tally(seq), firstRefusalAt: firstRefusal + 1, rampMs: ramp, medianLoginMs: median(okMs), maxLoginMs: Math.max(...okMs), playercount: before },
            dropOne: { playercountAfterDrop: afterDrop, nextLogin: describe(extra1.code), secondLogin: describe(extra2.code), droppedAccountReturns: describe(back.code), playercountEnd: end }
        };
    });
}

async function e2() {
    results.e2 = await experiment('e2', { NODE_PRODUCTION: 'false' }, async () => {
        const users = Array.from({ length: 45 }, (_, i) => acct('a', i));
        const t = now();
        const all = await Promise.all(users.map(u => attempt(u)));
        const parallelMs = now() - t;
        const pc = await playercount();

        // Two clients for one account at once: the login server answers the second
        // with reply 8 (client code 16) while the first is in flight.
        const fresh = await Promise.all([attempt(acct('d', 0)), attempt(acct('d', 0))]);
        const existing = await Promise.all([attempt(acct('a', 46)), attempt(acct('a', 46))]);

        // Takeover: an account already in the world logs in again.
        const take1 = await attempt(users[1]);
        const take2 = await attempt(users[1]);
        await sleep(10_500);
        const take3 = await attempt(users[1]);
        return {
            parallel45: { tally: tally(all), wallMs: parallelMs, slowestMs: Math.max(...all.map(a => a.ms)), playercount: pc },
            simultaneousSameNewAccount: fresh.map(a => describe(a.code)),
            simultaneousSameExistingAccount: existing.map(a => describe(a.code)),
            takeover: { first: describe(take1.code), immediatelyAgain: describe(take2.code), after10_5s: describe(take3.code) }
        };
    });
}

async function e3() {
    results.e3 = await experiment('e3', { NODE_PRODUCTION: 'true' }, async () => {
        const burst = await sequence(Array.from({ length: 8 }, (_, i) => acct('b', i)), 400);
        // Retrying inside the lockout: every refused attempt refreshes the 15 s TTL.
        const retries: Attempt[] = [];
        for (let i = 0; i < 4; i++) {
            await sleep(5000);
            retries.push(await attempt(acct('b', 8 + i)));
        }
        await sleep(16_000);
        const after16 = await attempt(acct('b', 12));
        // Three more back to back (device count 2-4), then 14 s of silence: still inside the window.
        const three = await sequence([acct('b', 13), acct('b', 14), acct('b', 15)], 400);
        await sleep(14_000);
        const after14 = await attempt(acct('b', 16));
        await sleep(16_000);
        const after16b = await attempt(acct('b', 17));
        return {
            spaced400: { codes: burst.map(a => a.code), firstRefusalAt: burst.findIndex(a => a.code !== 2) + 1 },
            retryEvery5sDuringLockout: retries.map(a => a.code),
            after16sSilence: describe(after16.code),
            threeMore: three.map(a => a.code),
            after14sSilence: describe(after14.code),
            thenAfter16sSilence: describe(after16b.code)
        };
    });
}

async function e4() {
    results.e4 = await experiment('e4', { NODE_PRODUCTION: 'true', NODE_RATELIMIT_DEVICE_LOGIN: '0' }, async () => {
        const burst = await sequence(Array.from({ length: 32 }, (_, i) => acct('c', i)), 400);
        await sleep(30_000);
        const after30 = await attempt(acct('c', 32));
        await sleep(61_000);
        const after61 = await attempt(acct('c', 33));
        return {
            spaced400: { tally: tally(burst), firstRefusalAt: burst.findIndex(a => a.code !== 2) + 1 },
            after30sSilence: describe(after30.code),
            thenAfter61sSilence: describe(after61.code)
        };
    });
}

/**
 * The safe ramp under both production limiters: chunks of 4 logins 400 ms apart,
 * 16 s of silence between chunks (device window 15 s), and 62 s of silence after
 * the 29th (address window 60 s, refused at the 30th).
 */
async function e5() {
    const CHUNK = 4, SPACING = 400, CHUNK_GAP = 16_000, ADDRESS_BUDGET = 29, ADDRESS_GAP = 62_000;
    results.e5 = await experiment('e5', { NODE_PRODUCTION: 'true' }, async () => {
        const users = Array.from({ length: 45 }, (_, i) => acct('f', i));
        const all: Attempt[] = [];
        const t = now();
        let sinceAddressReset = 0;
        let inChunk = 0;
        for (const u of users) {
            if (sinceAddressReset === ADDRESS_BUDGET) {
                await sleep(ADDRESS_GAP);
                sinceAddressReset = 0;
                inChunk = 0;
            } else if (inChunk === CHUNK) {
                await sleep(CHUNK_GAP);
                inChunk = 0;
            } else if (inChunk > 0) {
                await sleep(SPACING);
            }
            all.push(await attempt(u));
            sinceAddressReset++;
            inChunk++;
        }
        const rampMs = now() - t;
        return { schedule: { CHUNK, SPACING, CHUNK_GAP, ADDRESS_BUDGET, ADDRESS_GAP }, tally: tally(all), rampMs, playercount: await playercount() };
    });
}

const EXPERIMENTS: Record<string, () => Promise<void>> = { e1, e2, e3, e4, e5 };
const chosen = process.argv.slice(2).filter(a => a in EXPERIMENTS);
console.log(`rs519 login ramp: token ${TOKEN}, log ${LOG}`);
try {
    for (const name of chosen.length ? chosen : Object.keys(EXPERIMENTS)) {
        await EXPERIMENTS[name]();
        console.log(`RESULT ${name} ${JSON.stringify(results[name])}`);
    }
} finally {
    await halt();
}
console.log(`RESULTS ${JSON.stringify(results)}`);
