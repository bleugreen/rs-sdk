// Session: clean logout latency, re-login wall time, and watchdog recovery
// from a killed lite runner. Launches and kills its own client, so run it
// for a bot that lab.sh did not start a runner for:
//   LAB_BOTS=srlab3 speedrun/lab/lab.sh srlab1 speedrun/lab/measure-session.ts:--bot=srlab3
//
// The kill trial answers: does a fresh login succeed while the dropped player
// is still in the world (the engine's takeover path), or is it refused until
// the 500-tick no-connection timeout?

import { readFileSync } from 'fs';
import { closeSession, login, logoutClean, openSession, startWatchdog, waitAdvancingTick, type WatchdogEvent } from '../lib/session';
import { sleep, tickMs, waitTicks } from '../lib/wait';
import { arg, result } from './common';
import { tele, VARROCK_WEST_BANK } from './setup';

const n = Number(arg('n', '3'));
const name = arg('bot', 'srlab3');
const session = await openSession(name, { launch: true, pathfinding: false });
const { sdk } = session;
await tele(sdk, VARROCK_WEST_BANK.x, VARROCK_WEST_BANK.z);

// 1. Logout and re-login.
for (let i = 0; i < n; i++) {
    await waitTicks(sdk, 3);
    const out = await logoutClean(session);
    const relog = await login(session);
    result('logout', { ...out, reloginWallMs: relog.wallMs });
}

// 2. Watchdog: kill -9 the lite runner mid-world.
const events: WatchdogEvent[] = [];
const wd = startWatchdog(session, { staleTicks: 10, onEvent: e => events.push(e) });
for (let i = 0; i < n; i++) {
    await waitTicks(sdk, 5);
    const killTick = sdk.getState()!.tick;
    const sessionBefore = session.sessionId;
    const relaunchesBefore = wd.relaunches;
    const logins = (readFileSync(session.logPath, 'utf-8').match(/logged into/g) ?? []).length;
    const posBefore = sdk.getState()!.player;
    const t0 = Date.now();
    session.child!.kill('SIGKILL');
    // Wait for the watchdog to relaunch and the new client to tick in world.
    while (session.sessionId === sessionBefore && Date.now() - t0 < 60_000) await sleep(50);
    const relaunchAt = Date.now();
    let back = false;
    try {
        await waitAdvancingTick(session, 60_000);
        back = true;
    } catch {}
    const backAt = Date.now();
    const runnerLog = readFileSync(session.logPath, 'utf-8');
    const posAfter = sdk.getState()?.player;
    result('watchdog kill', {
        killTick,
        newSessionTick: sdk.getState()?.tick,
        samePosition: posBefore?.worldX === posAfter?.worldX && posBefore?.worldZ === posAfter?.worldZ,
        detectMs: relaunchAt - t0,
        backInWorldMs: backAt - t0,
        ticksLostApprox: Math.round((backAt - t0) / tickMs()),
        relaunches: wd.relaunches - relaunchesBefore,
        newLogins: (runnerLog.match(/logged into/g) ?? []).length - logins,
        loginOk: back,
        runnerLogTail: runnerLog.trim().split('\n').slice(-4),
    });
}
wd.stop();
result('watchdog events', events);

await logoutClean(session);
await closeSession(session);
process.exit(0);
