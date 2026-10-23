// S21's planned relog spans a confirmed logout, the givers' login-free ready wait, and an
// in-page login. The persistent budget is the checkpoint between the halves; one entry stays open
// while SCORED is deliberately out and closes only after the login succeeds.

import { loginFailurePolicy } from '../helpers/backoff';
import { cdpUrl, login, logoutClean, type LoginResult, type LogoutResult, type Session } from '../lib/session';
import { pageInGame, pageLoginState } from '../lib/tab';
import { sleep, tickMs } from '../lib/wait';
import { RelogBudget } from './relog-budget';
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
    logout(session: Session): Promise<LogoutResult>;
    confirmOut(session: Session): Promise<boolean>;
    login(session: Session): Promise<LoginResult>;
    replyCode(session: Session): Promise<number | null>;
    sleep(ms: number): Promise<void>;
}

export const defaultRelogDeps: ScoredRelogDeps = {
    logout: s => logoutClean(s),
    confirmOut: async s => {
        if (s.client !== 'browser') return !s.sdk.getState()?.inGame || s.childExit !== null;
        const cdp = cdpUrl(s.env);
        return !!cdp && (await pageInGame(cdp, s.name)) === false;
    },
    login: s => login(s, { inPage: true, attempts: 1 }),
    replyCode: async s => {
        const cdp = s.client === 'browser' ? cdpUrl(s.env) : undefined;
        if (!cdp) return null;
        const st = await pageLoginState(cdp, s.name).catch(() => null);
        return st && !st.inGame ? loginReplyCode(st.message) : null;
    },
    sleep,
};

export const SCORED_RELOG = 'S21 relog';
export const SCORED_LOGOUT = 'S21 relog:logout';
export const SCORED_LOGIN = 'S21 relog:login';

export interface ScoredRelogOptions {
    budget: RelogBudget;
    worldFullRetries?: number;
    deps?: Partial<ScoredRelogDeps>;
}

const message = (e: unknown) => e instanceof Error ? e.message : String(e);

function locked(budget: RelogBudget) {
    const lock = budget.tryLock('run');
    if (!lock.ok) throw new Error(`S21 relog: relog lock held by ${lock.holder.by} (pid ${lock.holder.pid})`);
    return lock;
}

/** Opens the single planned entry only after both the logout and page-out confirmation. */
export function scoredLogoutStep(o: ScoredRelogOptions): Step<any> {
    const deps = { ...defaultRelogDeps, ...o.deps };
    const run = async (ctx: StepContext<any>) => {
        const lock = locked(o.budget);
        try {
            if (o.budget.planned(SCORED_RELOG)) return;
            const allowed = o.budget.check('planned');
            if (allowed !== true) throw new Error(allowed);
            const out = await deps.logout(ctx.session as Session);
            if (!out.ok) throw new Error(`S21 relog: logout failed: ${out.reason}`);
            if (!(await deps.confirmOut(ctx.session as Session))) throw new Error('S21 relog: page out not confirmed');
            o.budget.beginPlanned(SCORED_RELOG, out.clickTick, { ...out });
        } finally { lock.release(); }
    };
    return {
        name: SCORED_LOGOUT,
        preconditions: s => s.inGame ? true : 'not in game before S21 logout',
        postconditions: () => o.budget.planned(SCORED_RELOG) ? true : 'S21 logout not recorded',
        done: () => o.budget.planned(SCORED_RELOG) !== null,
        run, resume: run, logoutSafe: true,
    };
}

/** Every attempt rechecks the required givers, including after a world-full pause or a restart. */
export function scoredLoginStep(o: ScoredRelogOptions & { beforeLogin(ctx: StepContext<any>): Promise<void> }): Step<any> {
    const deps = { ...defaultRelogDeps, ...o.deps };
    const retries = o.worldFullRetries ?? WORLD_FULL_RETRIES;
    const run = async (ctx: StepContext<any>) => {
        if (o.budget.hasPlanned(SCORED_RELOG)) return;
        if (o.budget.planned(SCORED_RELOG) !== 'open') throw new Error('S21 relog: no confirmed logout to resume');
        const session = ctx.session as Session;
        const startTick = ctx.sdk.getState()?.tick ?? -1;
        let worldFull = 0;
        let got: LoginResult | null = null;
        let error: unknown = null;
        const lock = locked(o.budget);
        try {
            for (;;) {
                await o.beforeLogin(ctx);
                try {
                    got = await deps.login(session);
                    o.budget.endPlanned(SCORED_RELOG, got.via, { attempts: got.attempts, wallMs: got.wallMs, loggedInAt: session.launchedAt });
                    break;
                } catch (e) {
                    const code = await deps.replyCode(session);
                    if (code !== WORLD_FULL) throw new Error(`${SCORED_RELOG}: ${message(e)}${code !== null ? ` (login reply ${code})` : ''}`);
                    if (++worldFull > retries) throw new Error(`${SCORED_RELOG}: the world was full on ${worldFull} logins in a row (retried ${retries} times): ${message(e)}`);
                    await deps.sleep(loginFailurePolicy(WORLD_FULL).accountDelayMs);
                }
            }
        } catch (e) {
            error = e;
            throw e;
        } finally {
            lock.release();
            ctx.log.append({
                v: 1, kind: 'note', runId: ctx.log.runId, account: session.name,
                sessionId: session.sessionId, step: SCORED_RELOG, startTick,
                endTick: ctx.sdk.getState()?.tick ?? startTick, ticks: 0, wallMs: 0,
                ok: !error, ...(error ? { error: message(error) } : {}),
                meta: { kind: 'scored-relog', ...(got ? { via: got.via, attempts: got.attempts, loginWallMs: got.wallMs } : {}),
                    logout: o.budget.entries().find(e => e.kind === 'planned' && e.step === SCORED_RELOG)?.meta?.logout,
                    worldFull, loggedInAt: session.launchedAt },
                tickMs: tickMs(), at: new Date().toISOString(),
            });
        }
    };
    return {
        name: SCORED_LOGIN, offline: true,
        preconditions: () => o.budget.planned(SCORED_RELOG) === 'open' ? true : 'no open S21 relog',
        postconditions: s => o.budget.hasPlanned(SCORED_RELOG) && s.inGame ? true : 'not in game after S21 login',
        done: () => o.budget.hasPlanned(SCORED_RELOG),
        run, resume: run, logoutSafe: true,
    };
}
