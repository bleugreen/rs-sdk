#!/usr/bin/env bun
// The operator's one-command relog of a dropped run tab (rs/511), from an ssh shell on the run host.
//
//   bun speedrun/tools/relog-now.ts <bot> [--run-dir=<dir>] [--cdp=http://127.0.0.1:9222]
//
// <bot> is the bots/<name> env directory, as run.ts's --bot. --run-dir is run.ts's (default its
// RUN_DIR); --cdp the run tab's Chrome DevTools (default the bot.env CDP_URL, else loopback 9222).
//
// What it does, once:
// 1. takes the run's relog lock (<run dir>/relog.lock, runner/relog-budget.ts) as the operator. If
//    run.ts holds it, run.ts is logging SCORED in itself: it refuses and does nothing;
// 2. asks the page itself (window.gameClient.ingame over DevTools; never the gateway's inGame). In the
//    world already: nothing to do;
//    Refuses, too, between the halves of the split S21 relog (an open planned entry): its login
//    half alone logs SCORED back in;
// 3. checks the relog budget (the planned S21 relog + 3 unplanned, run.ts's and the operator's
//    together); spent: refuses, since run.ts stops at the next drop anyway;
// 4. logs the page in the way session.ts login does: in page first (a one-time token, tab.ts
//    pageLogin), the token URL as the fallback (session.ts openBrowserClient). It does not open an
//    SDK session of its own: a second controller would take the gateway from run.ts;
// 5. waits for the page to be in game with its tick advancing, records a `manual` relog, lets the lock
//    go, and prints one line: `in: ...` (exit 0) or `failed: ...` (exit 1).
// run.ts, if it is waiting after the drop, adopts the session (runner/drop-relog.ts).

import { join } from 'path';
import { RUN_DIR } from '../helpers/altar-cue';
import { cdpUrl, loadBotEnv, mintLoginToken, openBrowserClient, type BotEnv } from '../lib/session';
import { evaluateInTab, pageLogin, type PageLoginStart } from '../lib/tab';
import { sleep, tickMs } from '../lib/wait';
import { RelogBudget, type RelogEntry } from '../runner/relog-budget';

export const DEFAULT_CDP = 'http://127.0.0.1:9222';
/** Ticks (of wall time: the page is the only clock) a login may take: session.ts login's 90 s at 400 ms. */
export const LOGIN_TICKS = 225;

/** The page's in-game flag, its login status and its tick (BotOverlay.serverTick), in one read. */
export interface PageRead {
    inGame: boolean;
    loggingIn: boolean;
    tick: number | null;
    message: string;
}

const READ_EXPRESSION = `(() => {
    const c = window.gameClient;
    if (!c) return null;
    const o = c.botOverlay;
    return { inGame: !!c.ingame, loggingIn: !!c.loginInProgress, tick: o && typeof o.serverTick === 'number' ? o.serverTick : null, message: [c.loginMes1, c.loginMes2].filter(Boolean).join(' ') };
})()`;

export interface RelogNowIO {
    budget: Pick<RelogBudget, 'tryLock' | 'check' | 'record' | 'describe' | 'openPlanned'>;
    /** The page now; null with no tab or no client on it. Throws when DevTools does not answer. */
    read(): Promise<PageRead | null>;
    /** Start an in-page login with a fresh token (tab.ts pageLogin). */
    pageLogin(): Promise<PageLoginStart | null>;
    /** Navigate the tab to a fresh token URL (session.ts openBrowserClient). */
    navigate(): Promise<void>;
    waitTicks(n: number): Promise<void>;
    now(): number;
}

export interface RelogNowResult {
    ok: boolean;
    line: string;
    entry?: RelogEntry;
}

/** Wait for the page in game with its tick advanced past the first in-game read; 'ended' when the login fell back to the title screen. */
async function inWorld(io: RelogNowIO, maxTicks: number): Promise<{ ok: true; tick: number | null } | { ok: false; why: string }> {
    let first: number | null | undefined;
    let idleOut = 0;
    for (let waited = 0; waited < maxTicks; waited++) {
        const p = await io.read().catch(() => null);
        if (p?.inGame) {
            if (first === undefined) first = p.tick;
            else if (p.tick === null || p.tick !== first) return { ok: true, tick: p.tick };
        } else if (p && !p.loggingIn && first === undefined) {
            // Off the title screen's login and not in game: give the page a few ticks to start.
            if (++idleOut > 10) return { ok: false, why: `the login ended on the title screen (${p.message || 'no message'})` };
        }
        await io.waitTicks(1);
    }
    return { ok: false, why: `not in the world within ${maxTicks} ticks` };
}

export async function relogNow(bot: string, io: RelogNowIO): Promise<RelogNowResult> {
    const lock = io.budget.tryLock('operator');
    if (!lock.ok) {
        const h = lock.holder;
        return {
            ok: false,
            line: h.by === 'run'
                ? `failed: run.ts (pid ${h.pid}) is relogging ${bot} itself since ${h.at}; nothing done (run it again only if run.ts gives up)`
                : `failed: another relog-now (pid ${h.pid}) holds the lock since ${h.at}; nothing done`,
        };
    }
    const t0 = io.now();
    try {
        // Between the halves of the split S21 relog SCORED is out on purpose while the givers log in;
        // only its login half (runner/scored-relog.ts) logs it back in, behind the whole ready roster.
        const planned = io.budget.openPlanned();
        if (planned) return { ok: false, line: `failed: the planned ${planned.step} is open (SCORED is out on purpose until its login half); nothing done` };
        const before = await io.read().catch((e: unknown) => {
            throw new Error(`the DevTools port does not answer (${e instanceof Error ? e.message : e})`);
        });
        if (!before) return { ok: false, line: `failed: no tab with a game client for ${bot} on the DevTools port` };
        if (before.inGame) return { ok: true, line: `in: ${bot} is already in the world (page tick ${before.tick ?? '?'}); nothing done` };
        const room = io.budget.check('manual');
        if (room !== true) return { ok: false, line: `failed: ${room}; nothing done` };

        let via: 'page' | 'launch' = 'page';
        let tickBase: number | null = null;
        const start = await io.pageLogin().catch((e: unknown) => ({ started: false, reason: e instanceof Error ? e.message : String(e), tickBase: null, gatewayConnected: null }) as PageLoginStart);
        let got: Awaited<ReturnType<typeof inWorld>>;
        if (start?.started) {
            tickBase = start.tickBase;
            got = await inWorld(io, LOGIN_TICKS);
        } else got = { ok: false, why: `in-page login unavailable (${start?.reason ?? 'no tab'})` };
        if (!got.ok) {
            via = 'launch';
            const firstWhy = got.why;
            await io.navigate();
            got = await inWorld(io, LOGIN_TICKS);
            if (!got.ok) return { ok: false, line: `failed: ${firstWhy}; then the token URL: ${got.why}` };
        }
        const wallMs = io.now() - t0;
        const entry = io.budget.record({ kind: 'manual', by: 'operator', step: null, tick: before.tick ?? -1, via, meta: { ...(tickBase !== null ? { tickBase } : {}), wallMs } });
        return { ok: true, entry, line: `in: ${bot} is back in the world via ${via === 'page' ? 'the page' : 'the token URL'} (page tick ${got.tick ?? '?'}, ${wallMs} ms); ${io.budget.describe()}` };
    } catch (e) {
        return { ok: false, line: `failed: ${e instanceof Error ? e.message : String(e)}` };
    } finally {
        lock.release();
    }
}

export function liveIO(env: BotEnv, cdp: string, runDir: string): RelogNowIO {
    const name = env.BOT_USERNAME;
    const withCdp: BotEnv = { ...env, CDP_URL: cdp };
    return {
        budget: new RelogBudget(runDir),
        read: async () => (await evaluateInTab<PageRead | null>(cdp, name, READ_EXPRESSION))?.value ?? null,
        pageLogin: async () => pageLogin(cdp, name, await mintLoginToken(withCdp)),
        navigate: async () => void (await openBrowserClient(withCdp, { cdp })),
        waitTicks: n => sleep(n * tickMs()),
        now: () => Date.now(),
    };
}

function flag(argv: readonly string[], name: string): string | undefined {
    return argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

if (import.meta.main) {
    const argv = process.argv.slice(2);
    const bot = argv.find(a => !a.startsWith('--'));
    if (!bot) {
        console.error('usage: bun speedrun/tools/relog-now.ts <bot> [--run-dir=<dir>] [--cdp=http://127.0.0.1:9222]');
        process.exit(2);
    }
    const env = loadBotEnv(bot);
    const cdp = flag(argv, 'cdp') ?? cdpUrl(env) ?? DEFAULT_CDP;
    const runDir = flag(argv, 'run-dir') ?? RUN_DIR;
    const r = await relogNow(bot, liveIO(env, cdp, runDir));
    console.log(r.line);
    if (!r.ok) console.error(`(lock and budget: ${join(runDir, 'relog.lock')}, ${join(runDir, 'relogs.json')})`);
    process.exit(r.ok ? 0 : 1);
}
