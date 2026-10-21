// Engine restart mid-run: what a crash loses, how fast the run is back, and
// where it resumes. Forced the way the demo dies (SIGKILL, no shutdown save).
//
//   LAB_RUNNERS=0 LAB_BOTS="srrs2 srrs3" NODE_TICKRATE=300 speedrun/lab/lab.sh srrs1 \
//     speedrun/lab/measure-restart.ts:--partner=srrs2:--churn=srrs3
//
// Three accounts: SCORED (the bot argument) runs a six-step manifest under
// runResumable with the watchdog's outage path; PARTNER trades it coins;
// CHURN only logs in and out, standing in for "any other player" on the demo.
//
//   S1 trade-1   PARTNER gives 100 coins            milestone: coins >= base+100
//   S2 level-1   ::advancestat woodcutting +1         milestone: woodcutting >= L0+1
//   S3 churn     CHURN logs out (a world checkpoint)  transient
//   S4 trade-2   PARTNER gives 50 more coins          milestone: coins >= base+150
//   S5 level-2   woodcutting +2                       milestone: woodcutting >= L0+2
//   S6 idle      wait, SIGKILL the engine the first time, then woodcutting +3
//
// The oracle is the save the next login loads: the GE checkpoint row
// (server/engine/data/market.sqlite, accounts.save; PlayerLoading.ts prefers it
// to the .sav), playtime as a g4s at byte 24 and woodcutting xp in the stat
// block. Expected: the restart rolls SCORED and PARTNER back to S3's
// checkpoint, trade-2 and level-2 together, playtime included, and the walk
// resumes at S4.

import { Database } from 'bun:sqlite';
import { existsSync, openSync, readFileSync } from 'fs';
import { join } from 'path';
import type { Subprocess } from 'bun';
import type { BotWorldState } from '../../sdk/types';
import { DemoMonitor } from '../lib/demo-status';
import { startLevelUpWatcher } from '../lib/levelup';
import { reconnectAfterOutage, serverDownProbe } from '../lib/reconnect';
import { ROOT, closeSession, login, logoutClean, openSession, startWatchdog, type Session } from '../lib/session';
import { TickLog, newRunId } from '../lib/ticks';
import { give, receiveFrom } from '../lib/trade';
import { sleep, tickMs, waitTicks, waitUntil } from '../lib/wait';
import { runResumable, sessionLink, type ResumeEvent } from '../runner/resume';
import type { Step } from '../runner/step';
import { arg, botArg, result } from './common';
import { cheat, tele, VARROCK_WEST_BANK } from './setup';

const SCORED = botArg();
const PARTNER = arg('partner', 'srrs2');
const CHURN = arg('churn', 'srrs3');
const IDLE_TICKS = Number(arg('idle', '40'));
const WEB_PORT = Number(process.env.WEB_PORT ?? 9300);
const LAB_LOG = process.env.LAB_LOG ?? join(process.env.TMPDIR ?? '/tmp', 'speedrun-lab');
const DB = join(ROOT, 'server', 'engine', process.env.GE_DATABASE ?? 'data/market.sqlite');
const WOODCUTTING = 8; // stat index (attack, defence, strength, hitpoints, ranged, prayer, magic, cooking, woodcutting)

// ------------------------------------------------------------------ oracle

interface Saved { playtime: number; wcXp: number }

function checkpointOf(name: string): Saved | null {
    if (!existsSync(DB)) return null;
    const db = new Database(DB, { readonly: true });
    try {
        const row = db.query<{ save: Uint8Array }, [string]>('SELECT save FROM accounts WHERE owner=?').get(name.toLowerCase());
        if (!row) return null;
        const v = new DataView(row.save.buffer, row.save.byteOffset, row.save.byteLength);
        return { playtime: v.getInt32(24), wcXp: v.getInt32(28 + 5 * WOODCUTTING) };
    } finally {
        db.close();
    }
}

const coins = (s: BotWorldState | null) => s?.inventory.filter(i => /^coins$/i.test(i.name)).reduce((n, i) => n + i.count, 0) ?? 0;
const wc = (s: BotWorldState | null) => s?.skills.find(k => k.name === 'Woodcutting')?.baseLevel ?? 1;

// ------------------------------------------------------------------ engine

let engineChild: Subprocess | null = null;
let restarts = 0;

function killEngine(): number {
    const pid = engineChild?.pid ?? Number(readFileSync(join(LAB_LOG, 'engine.pid'), 'utf-8').trim());
    process.kill(pid, 'SIGKILL');
    return pid;
}

/** Start a replacement engine the way lab.sh does; resolves at 'World ready'. */
async function startEngine(): Promise<number> {
    const t0 = Date.now();
    const log = join(LAB_LOG, `engine-restart-${++restarts}.log`);
    engineChild = Bun.spawn(['bun', 'run', 'src/app.ts'], {
        cwd: join(ROOT, 'server', 'engine'),
        env: { ...process.env, BUILD_VERIFY: 'false', BUILD_LIVE_RELOAD: 'false', LOCAL_STAFF_LEVEL: '4' },
        stdout: openSync(log, 'a'),
        stderr: openSync(log, 'a'),
    });
    while (Date.now() - t0 < 300_000) {
        if (existsSync(log) && readFileSync(log, 'utf-8').includes('World ready')) return Date.now() - t0;
        await sleep(200);
    }
    throw new Error(`replacement engine not ready in 300 s (${log})`);
}

process.on('exit', () => {
    try {
        engineChild?.kill('SIGKILL');
    } catch {}
});

// ------------------------------------------------------------------ sessions

const monitor = new DemoMonitor(`http://localhost:${WEB_PORT}`, { file: null, everyMs: 1_000 });

async function ready(name: string, prep: (s: Session) => Promise<void>): Promise<Session> {
    const s = await openSession(name, { launch: true, pathfinding: false });
    await cheat(s.sdk, 'setvar tutorial 1000');
    await waitTicks(s.sdk, 2);
    await tele(s.sdk, VARROCK_WEST_BANK.x, VARROCK_WEST_BANK.z);
    await prep(s);
    // Tabs are set at login off the tutorial island (probe-engine.ts ensureTabs).
    await logoutClean(s);
    await login(s);
    await waitTicks(s.sdk, 3);
    return s;
}

/** True once `s` is in the world with a tick advancing after `since`. */
async function inWorld(s: Session, since: number, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (s.expectInWorld && s.sdk.getState()?.inGame && s.lastAdvanceAt > since && Date.now() - s.lastAdvanceAt < 3 * tickMs()) return;
        await sleep(100);
    }
    throw new Error(`${s.name} not in the world`);
}

async function main(): Promise<void> {
    const t: Record<string, number> = {};
    monitor.start();
    const scored = await ready(SCORED, async s => {
        await cheat(s.sdk, 'setstat woodcutting 10');
        await waitTicks(s.sdk, 2);
    });
    const partner = await ready(PARTNER, async s => {
        await cheat(s.sdk, 'give coins 10000');
        await waitTicks(s.sdk, 2);
    });
    const churn = await ready(CHURN, async () => {});
    startLevelUpWatcher(scored.sdk);

    // The watchdogs: each reconnects on its own once logins are accepted; SCORED
    // waits for PARTNER first (the login-order gate the tick-exact helpers need).
    let dropAt = 0;
    const wdP = startWatchdog(partner, {
        serverDown: serverDownProbe(monitor),
        actions: { reconnect: s => reconnectAfterOutage(s, { monitor, pollMs: 1_000, retryMs: 2_000 }) },
    });
    const wdS = startWatchdog(scored, {
        serverDown: serverDownProbe(monitor),
        onEvent: e => console.log(`[watchdog ${SCORED}] ${e.verdict}: ${e.reason}`),
        actions: {
            reconnect: s => reconnectAfterOutage(s, {
                monitor, pollMs: 1_000, retryMs: 2_000,
                beforeLogin: () => inWorld(partner, dropAt, 120_000),
                onEvent: e => {
                    if (e.kind === 'answering') t.answering ??= e.at;
                    if (e.kind === 'refused') t.refusals = (t.refusals ?? 0) + 1;
                    if (e.kind === 'in-world') t.inWorld ??= e.at;
                },
            }),
        },
    });

    const base = coins(scored.sdk.getState());
    const L0 = wc(scored.sdk.getState());
    const partnerBase = coins(partner.sdk.getState());
    result('start', { base, L0, partnerBase, scored: checkpointOf(SCORED), partner: checkpointOf(PARTNER) });

    const near = () => tele(partner.sdk, VARROCK_WEST_BANK.x + 1, VARROCK_WEST_BANK.z);
    const trade = (n: number) => async () => {
        await near();
        const [r, g] = await Promise.all([
            receiveFrom(scored.sdk, PARTNER, { want: [{ item: /coins/i, amount: n }] }),
            give(partner.sdk, SCORED, [{ item: /coins/i, n }]),
        ]);
        if (!r.ok || !g.ok) throw new Error(`trade ${n}: receiver ${r.reason ?? 'ok'}, giver ${g.reason ?? 'ok'}`);
    };
    const levelTo = (lvl: number) => async () => {
        await cheat(scored.sdk, `advancestat woodcutting ${lvl}`);
        const r = await waitUntil(scored.sdk, s => wc(s) >= lvl, { maxTicks: 10 });
        if (!r.ok) throw new Error(`woodcutting did not reach ${lvl}`);
    };
    let c1: { saved: Saved | null; partner: Saved | null; tick: number; session: number } | null = null;
    let kill: { tick: number; at: number; session: number } | null = null;

    type C = Record<string, never>;
    const always = () => true as const;
    const steps: Step<C>[] = [
        { name: 'trade-1', preconditions: always, run: trade(100), postconditions: s => coins(s) >= base + 100 || 'no coins', logoutSafe: true, done: o => coins(o.state) >= base + 100 },
        { name: 'level-1', preconditions: always, run: levelTo(L0 + 1), postconditions: always, logoutSafe: true, done: o => wc(o.state) >= L0 + 1 },
        {
            name: 'churn', preconditions: always, postconditions: always, logoutSafe: true,
            run: async () => {
                const out = await logoutClean(churn);
                if (!out.ok) throw new Error(`churn logout: ${out.reason}`);
                await sleep(500);
                c1 = { saved: checkpointOf(SCORED), partner: checkpointOf(PARTNER), tick: scored.sdk.getState()!.tick, session: scored.sessionId };
                result('checkpoint-by-other-logout', c1);
            },
        },
        { name: 'trade-2', preconditions: always, run: trade(50), postconditions: s => coins(s) >= base + 150 || 'no coins', logoutSafe: true, done: o => coins(o.state) >= base + 150 },
        { name: 'level-2', preconditions: always, run: levelTo(L0 + 2), postconditions: always, logoutSafe: true, done: o => wc(o.state) >= L0 + 2 },
        {
            name: 'idle', preconditions: always, postconditions: always, logoutSafe: true, done: o => wc(o.state) >= L0 + 3,
            run: async () => {
                await waitTicks(scored.sdk, IDLE_TICKS);
                if (!kill) {
                    kill = { tick: scored.sdk.getState()!.tick, at: Date.now(), session: scored.sessionId };
                    result('before-kill', { coins: coins(scored.sdk.getState()), wc: wc(scored.sdk.getState()), partnerCoins: coins(partner.sdk.getState()), saved: checkpointOf(SCORED) });
                    dropAt = Date.now();
                    killEngine();
                    t.kill = Date.now();
                    void startEngine().then(ms => { t.engineReady = Date.now(); result('engine-ready', { wallMs: ms }); });
                    await waitTicks(scored.sdk, 5); // throws: the world is gone
                }
                await levelTo(L0 + 3)();
            },
        },
    ];

    const log = TickLog.open(`lab-restart-${newRunId()}`);
    const events: ResumeEvent[] = [];
    let afterRestart: Record<string, unknown> | null = null;
    const r = await runResumable(scored, steps, {
        log, c: {}, link: sessionLink(scored), shouldStop: () => false, logout: async () => {},
        onEvent: e => {
            events.push(e);
            console.log(`[resume] ${JSON.stringify(e)}`);
            if (e.kind === 'drop') t.dropSeen = Date.now();
            if (e.kind === 'restored') {
                t.restored = Date.now();
                afterRestart = { coins: coins(scored.sdk.getState()), wc: wc(scored.sdk.getState()), partnerCoins: coins(partner.sdk.getState()), saved: checkpointOf(SCORED), partnerSaved: checkpointOf(PARTNER), tick: scored.sdk.getState()!.tick };
            }
            if (e.kind === 'resume' && kill && !t.resumed) t.resumed = Date.now();
        },
    });
    // One more checkpoint by another player's logout, to read the loaded playtime back.
    const resumedRow = log.rows.find(row => row.step === 'trade-2' && row.sessionId !== kill?.session);
    await openSession(CHURN, { launch: true, pathfinding: false }).then(async s => { await waitTicks(s.sdk, 3); await logoutClean(s); await closeSession(s); });
    await sleep(500);
    const end = { saved: checkpointOf(SCORED), tick: scored.sdk.getState()!.tick, session: scored.sessionId };

    const k = kill as { tick: number; at: number; session: number } | null;
    const cp = c1 as { saved: Saved | null; tick: number } | null;
    result('resume-points', r.points.map(p => `${p.step}:${p.mode}`));
    result('after-restart', afterRestart);
    result('timing-ms', {
        killToEngineReady: t.engineReady - t.kill, killToDropSeen: t.dropSeen - t.kill, killToAnswering: t.answering - t.kill,
        killToInWorld: t.inWorld - t.kill, killToRestored: t.restored - t.kill, killToResumed: t.resumed - t.kill, refusals: t.refusals ?? 0,
    });
    if (k && cp?.saved && end.saved) {
        // Ticks SCORED was in the world after the checkpoint and before the kill, which the crash erased.
        const lostTicks = k.tick - cp.tick;
        // New session: ticks from its first tick to the end checkpoint; tick counter restarted at the relaunch.
        const newSessionTicks = end.tick;
        result('playtime', {
            atCheckpoint: cp.saved.playtime, atEnd: end.saved.playtime, lostTicks,
            // If the crash rolled playtime back with progress: atEnd = atCheckpoint + newSessionTicks (+/- 2).
            rollbackResidual: end.saved.playtime - cp.saved.playtime - newSessionTicks,
        });
    }
    if (resumedRow) result('resumed-step', { step: resumedRow.step, ticks: resumedRow.ticks, sessionId: resumedRow.sessionId });
    result('resume-rows', log.rows.filter(row => row.step.startsWith('(')).map(row => ({ step: row.step, ticks: row.ticks, wallMs: row.wallMs, meta: row.meta })));

    wdS.stop();
    wdP.stop();
    monitor.stop();
    for (const s of [scored, partner]) {
        await logoutClean(s).catch(() => {});
        await closeSession(s);
    }
}

await main().catch(async e => {
    console.error(e);
    process.exit(1);
});
process.exit(0);
