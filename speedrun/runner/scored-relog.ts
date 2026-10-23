// SCORED's in-page relog before S21 (rs/186's ruling). S21's body-altar givers log in on the open of
// the {S21, altar} cue (skills/runecraft.ts preLoginStep) and report ready; SCORED then relogs, so the
// server's per-address login order puts it behind every giver, and runecraft.ts's giverSchedule, which
// reads SCORED's login time from session.launchedAt (set by the relog's login), grants each of them
// the tuned 7-tick schedule. The relog is lib/session.ts relog, the one cooking.ts uses.
//
// A login refused with code 7 (world full) is retried after helpers/backoff.ts's pause for that code
// and is not a failure; any other failed relog fails the step. Which reply the server gave is read off
// the client's title screen (its login messages, server/webclient/src/client/Client.ts) over DevTools:
// lib/session.ts login reports no reply code.

import { loginFailurePolicy } from '../helpers/backoff';
import { cdpUrl, login, relog, type LoginResult, type RelogResult, type Session } from '../lib/session';
import { pageLoginState } from '../lib/tab';
import { sleep, tickMs } from '../lib/wait';
import type { Step, StepContext } from './step';

/** The title screen's text for the login replies the relog tells apart (Client.ts's loginMes1 and loginMes2). */
const REPLY_TEXT: readonly (readonly [number, RegExp])[] = [
    [5, /Your account is already logged in\./],
    [7, /This world is full\./],
    [8, /Login server offline\./],
    [9, /Login limit exceeded\./],
    [13, /Could not complete login\./],
    [14, /The server is being updated\./],
    [16, /Login attempts exceeded\./],
];

/** The login reply a title screen's message shows, or null for none the relog tells apart. */
export function loginReplyCode(message: string): number | null {
    return REPLY_TEXT.find(([, re]) => re.test(message))?.[0] ?? null;
}

export const WORLD_FULL = 7;
/** World-full refusals retried before the step gives up: about 15 minutes at backoff.ts's 60 s pause. */
export const WORLD_FULL_RETRIES = 15;

export interface ScoredRelogDeps {
    relog(session: Session): Promise<RelogResult>;
    /** A login after a refused one (the relog's logout is done). */
    login(session: Session): Promise<LoginResult>;
    /** The login reply the client's title screen shows now; null when it is in game, shows none, or cannot be read. */
    replyCode(session: Session): Promise<number | null>;
    sleep(ms: number): Promise<void>;
}

export const defaultRelogDeps: ScoredRelogDeps = {
    relog: s => relog(s),
    login: s => login(s, { inPage: true }),
    replyCode: async s => {
        const cdp = s.client === 'browser' ? cdpUrl(s.env) : undefined;
        if (!cdp) return null;
        const st = await pageLoginState(cdp, s.name).catch(() => null);
        return st && !st.inGame ? loginReplyCode(st.message) : null;
    },
    sleep,
};

export const SCORED_RELOG = 'S21 relog';

export interface ScoredRelogOptions {
    name?: string;
    /** World-full refusals retried before the step fails (default WORLD_FULL_RETRIES). */
    worldFullRetries?: number;
    deps?: Partial<ScoredRelogDeps>;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** SCORED's relog as a chain step, with one 0-tick note row: how it got in, the world-full retries, and the login time giverSchedule reads. */
export function scoredRelogStep(o: ScoredRelogOptions = {}): Step<any> {
    const name = o.name ?? SCORED_RELOG;
    const deps = { ...defaultRelogDeps, ...o.deps };
    const retries = o.worldFullRetries ?? WORLD_FULL_RETRIES;
    const run = async (ctx: StepContext<any>) => {
        const session = ctx.session as Session;
        const startTick = ctx.sdk.getState()?.tick ?? -1;
        let worldFull = 0;
        let got: { via: string; attempts: number; loginWallMs: number } | null = null;
        let error: unknown = null;
        try {
            let next = async () => {
                const r = await deps.relog(session);
                return { via: r.via, attempts: r.attempts, loginWallMs: r.loginWallMs };
            };
            for (;;) {
                try {
                    got = await next();
                    break;
                } catch (e) {
                    const code = await deps.replyCode(session);
                    if (code !== WORLD_FULL) throw new Error(`${name}: ${message(e)}${code !== null ? ` (login reply ${code})` : ''}`);
                    if (++worldFull > retries) throw new Error(`${name}: the world was full on ${worldFull} logins in a row (retried ${retries} times): ${message(e)}`);
                    await deps.sleep(loginFailurePolicy(WORLD_FULL).accountDelayMs);
                    next = async () => {
                        const r = await deps.login(session);
                        return { via: r.via, attempts: r.attempts, loginWallMs: r.wallMs };
                    };
                }
            }
        } catch (e) {
            error = e;
            throw e;
        } finally {
            const endTick = ctx.sdk.getState()?.tick ?? startTick;
            ctx.log.append({
                v: 1,
                kind: 'note',
                runId: ctx.log.runId,
                account: session.name,
                sessionId: session.sessionId,
                step: name,
                startTick,
                endTick,
                ticks: 0,
                wallMs: 0,
                ok: !error,
                ...(error ? { error: message(error) } : {}),
                meta: { kind: 'scored-relog', ...(got ?? {}), worldFull, loggedInAt: session.launchedAt },
                tickMs: tickMs(),
                at: new Date().toISOString(),
            });
        }
    };
    return { name, preconditions: s => (s.inGame ? true : 'not in game'), postconditions: s => (s.inGame ? true : 'not in game after the relog'), run, resume: run, logoutSafe: true };
}
