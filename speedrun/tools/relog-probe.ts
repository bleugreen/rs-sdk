#!/usr/bin/env bun
// Relog timing on one account, through the run's own path (rs/147; SCORED's wine relogs, rs/158).
//
//   bun speedrun/tools/relog-probe.ts <bot> [--client=browser|lite] [--n=3] [--json=<file>]
//
// From out of the world: log in (lib/session.ts openSession: on the browser, the tab re-navigated to
// a fresh one-time token over CDP), then N times `logoutClean` and `login`, then a final
// `logoutClean`. Per relog it reports:
//   - the logout click to the confirmed out: ticks (click to the last in-world tick) and ms, and
//     which signal confirmed it (LogoutResult.confirmedBy; a browser tab is confirmed by the page
//     over CDP, never by the gateway);
//   - the confirmed out to back in the world (login's advancing tick), ms;
//   - the click to the first in-world state of the new session, ms, and that state's client tick
//     (the login frames the new session counts before control returns).
// The account must be out of combat (a hit within 16 ticks makes logoutClean wait the window out).
// SIGTERM or SIGINT logs out before exiting; the client is never killed to leave the world.

import { writeFileSync } from 'fs';
import { type ClientKind, closeSession, login, logoutClean, openSession, type Session } from '../lib/session';
import { tickMs, waitTicks } from '../lib/wait';

export interface RelogSample {
    relog: number;
    clickTick: number;
    lastInWorldTick: number;
    /** Click to the last in-world tick of the old session. */
    latencyTicks: number;
    confirmedBy: string | null;
    /** logoutClean's call to its confirmed return (the click is sent at once when out of combat). */
    clickToOutMs: number;
    /** Confirmed out to login's return (the new session's tick advancing). */
    outToInWorldMs: number;
    /** Click to the first in-world state the new session published. */
    clickToFirstStateMs: number | null;
    /** That state's client tick: the new session's login frames. */
    newSessionFirstTick: number | null;
    loginAttempts: number;
}

function arg(name: string): string | undefined {
    return process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

export function formatSamples(samples: readonly RelogSample[], msPerTick: number): string[] {
    const lines = ['relog  click  out-tick  lat  confirmed  click->out ms  out->in-world ms  click->first state ms (ticks @' + msPerTick + ' ms)  new first tick'];
    for (const s of samples) {
        const firstTicks = s.clickToFirstStateMs === null ? '-' : (s.clickToFirstStateMs / msPerTick).toFixed(1);
        lines.push(
            `${String(s.relog).padStart(5)}  ${String(s.clickTick).padStart(5)}  ${String(s.lastInWorldTick).padStart(8)}  ${String(s.latencyTicks).padStart(3)}  ` +
                `${String(s.confirmedBy ?? '-').padEnd(9)}  ${String(s.clickToOutMs).padStart(13)}  ${String(s.outToInWorldMs).padStart(16)}  ` +
                `${String(s.clickToFirstStateMs ?? '-').padStart(21)} (${firstTicks})  ${String(s.newSessionFirstTick ?? '-').padStart(14)}`
        );
    }
    return lines;
}

async function main(): Promise<number> {
    const bot = process.argv.slice(2).find(a => !a.startsWith('--'));
    if (!bot) {
        console.error('usage: bun speedrun/tools/relog-probe.ts <bot> [--client=browser|lite] [--n=3] [--json=<file>]');
        return 2;
    }
    const client = (arg('client') ?? 'browser') as ClientKind;
    const n = Number(arg('n') ?? 3);
    if (!Number.isInteger(n) || n < 1 || n > 10) throw new Error(`--n must be 1 to 10, not ${arg('n')}`);

    const session: Session = await openSession(bot, { client, launch: true, pathfinding: false });
    console.log(`[relog] ${session.name}: in the world (session ${session.sessionId}, tick ${session.lastInWorldTick})`);
    let leaving = false;
    const leave = (code: number) => async () => {
        if (leaving) return;
        leaving = true;
        if (session.expectInWorld) console.log(`[relog] signal: logout ${JSON.stringify(await logoutClean(session).catch(e => String(e)))}`);
        process.exit(code);
    };
    process.on('SIGTERM', leave(143));
    process.on('SIGINT', leave(130));

    // The new session's first in-world state, after the launch and unlike the old session's last.
    let watch: { after: number; oldTick: number; first: { at: number; tick: number } | null } | null = null;
    session.sdk.onStateUpdate(s => {
        if (watch && !watch.first && s.inGame && session.launchedAt >= watch.after && s.tick !== watch.oldTick) watch.first = { at: Date.now(), tick: s.tick };
    });

    const samples: RelogSample[] = [];
    try {
        for (let i = 1; i <= n; i++) {
            await waitTicks(session.sdk, 3);
            const tClick = Date.now();
            const out = await logoutClean(session);
            const tOut = Date.now();
            if (!out.ok) throw new Error(`relog ${i}: logout not confirmed (${out.reason})`);
            watch = { after: tOut, oldTick: session.lastInWorldTick, first: null };
            const li = await login(session);
            const tIn = Date.now();
            const first = watch.first as { at: number; tick: number } | null;
            samples.push({
                relog: i, clickTick: out.clickTick, lastInWorldTick: out.lastInWorldTick, latencyTicks: out.latencyTicks, confirmedBy: out.confirmedBy ?? null,
                clickToOutMs: tOut - tClick, outToInWorldMs: tIn - tOut, clickToFirstStateMs: first ? first.at - tClick : null, newSessionFirstTick: first?.tick ?? null,
                loginAttempts: li.attempts,
            });
            watch = null;
            console.log(`[relog] ${i}: ${JSON.stringify(samples[samples.length - 1])}`);
        }
        await waitTicks(session.sdk, 3);
    } finally {
        if (session.expectInWorld) {
            const out = await logoutClean(session);
            console.log(`[relog] final logout: ${out.ok ? `confirmed by ${out.confirmedBy}, click on tick ${out.clickTick}, ${out.wallMs} ms` : `NOT confirmed (${out.reason})`}`);
        }
    }
    for (const l of formatSamples(samples, tickMs())) console.log(l);
    const json = arg('json');
    if (json) writeFileSync(json, JSON.stringify({ account: session.name, client, msPerTick: tickMs(), samples }, null, 2) + '\n');
    await closeSession(session);
    return 0;
}

if (import.meta.main) process.exit(await main());
