// Reconnect after the server went away (a demo restart, or our own network).
//
// Two kinds of drop need opposite handling, and the watchdog (session.ts) tells
// them apart before acting:
// - The client died or wedged and the server is up. The player is still in the
//   world and on the clock (500 or 1,000 ticks if left alone), so rs/101's path
//   runs at once: a clean logout, or a takeover login by a fresh client.
// - The server is down (/playercount unreachable, or the RestartTracker still in
//   an outage). The world died with the process, so nothing is on the clock and
//   the account will come back at its last checkpoint. There is nothing to take
//   over; the job is to be logged in the moment logins are accepted again
//   (~1.8-2.4 min after the drop on the demo, code 8 refusals before that) and
//   not to burn a client launch per second meanwhile. That is this file.
//
// The runner (runner/resume.ts) is told nothing directly: it sees its link come
// back and walks the manifest from the rolled-back state.

import { demoOrigin, samplePlayerCount, type DemoMonitor, type DemoSample } from './demo-status';
import { abandonClient, login, type Session } from './session';
import { sleep as realSleep } from './wait';

export interface OutageOptions {
    /** One /playercount sample; default the session's SERVER origin. Ignored when `monitor` is given. */
    sample?: () => Promise<DemoSample>;
    /** Shared monitor: samples through it and records our login outcomes, so the status line shows them. */
    monitor?: DemoMonitor;
    /** Between samples while the world does not answer (default 5 s). */
    pollMs?: number;
    /** Between login attempts while logins are refused (default 10 s; refusals last 1.5-2.5 min on the demo). */
    retryMs?: number;
    /** One login attempt's budget (default 45 s lite, 75 s browser: page load plus the ~20 s demo login). */
    loginTimeoutMs?: number;
    /** Give up after this long (default 30 min). */
    deadlineMs?: number;
    /** Awaited before each login attempt: the login-order gate (tick-exact helpers in first). */
    beforeLogin?: () => Promise<void>;
    /** One login attempt; default session.ts login with a single attempt. */
    login?: (session: Session, timeoutMs: number) => Promise<unknown>;
    onEvent?: (e: OutageEvent) => void;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
}

export type OutageEvent =
    | { kind: 'unreachable'; at: number; detail?: string }
    | { kind: 'answering'; at: number; players: number | null }
    | { kind: 'refused'; at: number; attempt: number; detail: string }
    | { kind: 'in-world'; at: number; attempt: number };

export interface OutageResult {
    wallMs: number;
    attempts: number;
    refusals: number;
    /** Wall ms from the start until the world answered /playercount. */
    answerAfterMs: number;
}

/** Pure: what to do next during an outage. */
export function outageStep(i: { reachable: boolean; now: number; deadline: number; childExit: number | null }): 'wait' | 'login' | 'give_up' {
    if (i.childExit === 3 || i.now >= i.deadline) return 'give_up';
    return i.reachable ? 'login' : 'wait';
}

/**
 * Get `session` back into the world after the server went away. Clears any
 * client still running (its socket is dead), waits while the world does not
 * answer, then tries one login every `retryMs` until one lands. Returns once the
 * client is in the world with an advancing tick; the watchdog is resumed by
 * that login.
 */
export async function reconnectAfterOutage(session: Session, opts: OutageOptions = {}): Promise<OutageResult> {
    const now = opts.now ?? Date.now;
    const sleep = opts.sleep ?? realSleep;
    const t0 = now();
    const deadline = t0 + (opts.deadlineMs ?? 30 * 60_000);
    const sample = opts.monitor
        ? async () => {
              const st = await opts.monitor!.sampleNow();
              return { at: st.sampledAt ?? now(), players: st.players, ms: 0 } as DemoSample;
          }
        : (opts.sample ?? (() => samplePlayerCount(demoOrigin(session.env.SERVER))));
    const attemptLogin = opts.login ?? ((s: Session, timeoutMs: number) => login(s, { attempts: 1, timeoutMs }));
    const loginTimeoutMs = opts.loginTimeoutMs ?? (session.client === 'browser' ? 75_000 : 45_000);

    session.watchdog?.pause();
    session.expectInWorld = false;
    if (session.client === 'lite') await abandonClient(session, 2_000).catch(() => {});

    let attempts = 0;
    let refusals = 0;
    let answeredAt: number | null = null;
    for (;;) {
        const s = await sample();
        const step = outageStep({ reachable: s.players !== null, now: now(), deadline, childExit: session.childExit });
        if (step === 'give_up') {
            throw new Error(`${session.name}: not back after ${Math.round((now() - t0) / 1000)} s (${attempts} login attempts, exit ${session.childExit})`);
        }
        if (step === 'wait') {
            opts.onEvent?.({ kind: 'unreachable', at: now(), ...(s.error ? { detail: s.error } : {}) });
            await sleep(opts.pollMs ?? 5_000);
            continue;
        }
        if (answeredAt === null) {
            answeredAt = now();
            opts.onEvent?.({ kind: 'answering', at: answeredAt, players: s.players });
        }
        await opts.beforeLogin?.();
        attempts++;
        try {
            await attemptLogin(session, loginTimeoutMs);
            opts.monitor?.tracker.noteLoginAccepted(now());
            opts.monitor?.publish();
            opts.onEvent?.({ kind: 'in-world', at: now(), attempt: attempts });
            return { wallMs: now() - t0, attempts, refusals, answerAfterMs: answeredAt - t0 };
        } catch (e) {
            refusals++;
            opts.monitor?.tracker.noteLoginRefused(now());
            opts.monitor?.publish();
            opts.onEvent?.({ kind: 'refused', at: now(), attempt: attempts, detail: e instanceof Error ? e.message : String(e) });
            if (session.childExit === 3) continue; // give_up on the next pass
            await sleep(opts.retryMs ?? 10_000);
        }
    }
}

/**
 * The watchdog's `serverDown` probe over a shared monitor: down while the world
 * does not answer, and for the rest of an outage the tracker is still in (the
 * code 8 minutes, when /playercount answers but logins are refused).
 */
export function serverDownProbe(monitor: DemoMonitor): () => Promise<boolean> {
    return async () => {
        const st = await monitor.sampleNow();
        return st.players === null || monitor.tracker.inOutage;
    };
}
