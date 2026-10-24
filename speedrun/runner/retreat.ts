// Leaving the world after a step that failed among aggressive NPCs. The server refuses a logout
// while SCORED is in combat (lib/world.ts inCombatWindow), and logoutClean holds through that
// window, so a step failing at the Wilderness poison spiders left SCORED standing among them while
// they hit it: the host's twin rehearsal lost two accounts so (S14 failing at its precondition and
// at its cannon set-up, the logout refused and SCORED dead). A step that declares `retreat`
// (runner/step.ts) walks out of their reach first. lib/attempt.ts runAttempt calls this on its
// failure path, the one place an attempt leaves the world after a failed step, for run.ts and
// rehearse.ts alike.
//
// - SCORED in the combat window when the step failed: the retreat, then the logout.
// - Out of it: the logout as before; only one refused for combat (a hit landing with the click)
//   brings the retreat, then a second logout.
// - The retreat is bounded (RETREAT_MAX_TICKS observed ticks, a wall-clock backstop for a client
//   gone quiet) and fenced (runner/fence.ts): past the bound, nothing it sends reaches the game.
//   One that throws or overruns does not stop the logout; the outcome names both.
// - A death during the retreat (runner/death.ts DeathWatch) goes on Session.died, which run.ts turns
//   into the `(death)` row and EXIT_DIED, as for one during the logout's hold.
// - A `(retreat)` row records what was done: the failed step, why, the tiles, the ticks, the logout.

import { annotation } from '../lib/attempt';
import { LOGOUT_REFUSED_COMBAT, type LogoutResult, type Session } from '../lib/session';
import type { TickLog } from '../lib/ticks';
import { tickMs } from '../lib/wait';
import { inCombatWindow, pos, type Tile } from '../lib/world';
import { DeathWatch } from './death';
import { Fence } from './fence';
import type { Step, StepContext } from './step';

export const RETREAT_STEP = '(retreat)';

/**
 * Observed ticks a retreat may take before the logout goes ahead without it. The cannon steps' walk
 * out of the spiders' reach is at most about 55 tiles from anywhere they start (skills/ranged.ts
 * SITE_RADIUS of the spot), under 30 ticks running.
 */
export const RETREAT_MAX_TICKS = 50;

export interface RetreatReport {
    /** The failed step's name. */
    step: string;
    /** What called for it: SCORED in the combat window at the failure, or a logout refused for combat. */
    why: 'combat window' | 'logout refused';
    /** The retreat returned within its bound and SCORED did not die. */
    ok: boolean;
    /** What it threw, or its bound. */
    error?: string;
    timedOut?: true;
    /** The death DeathWatch saw while it ran. */
    died?: string;
    from: Tile;
    to: Tile;
    startTick: number;
    endTick: number;
}

export interface FailureExit {
    /** Null: no retreat ran (out of combat, and the logout was not refused). */
    retreat: RetreatReport | null;
    /** The last logout made. */
    logout: LogoutResult;
}

export interface FailureExitOptions {
    log: TickLog;
    account: string;
    /** The attempt's logout (logoutClean). */
    logout: () => Promise<LogoutResult>;
    /** Default RETREAT_MAX_TICKS. */
    maxTicks?: number;
}

/** Out of the world after `step` failed, retreating first where its fight would refuse the logout. `step` declares `retreat`. */
export async function leaveAfterFailure(session: Session, step: Step<any>, o: FailureExitOptions): Promise<FailureExit> {
    const s = session.sdk.getState();
    if (s?.inGame && s.player && inCombatWindow(s)) {
        const retreat = await runRetreat(session, step, 'combat window', o);
        return recorded(session, o, retreat, await o.logout());
    }
    const first = await o.logout();
    const now = session.sdk.getState();
    if (first.ok || first.reason !== LOGOUT_REFUSED_COMBAT || !now?.inGame || !now.player) return { retreat: null, logout: first };
    const retreat = await runRetreat(session, step, 'logout refused', o);
    return recorded(session, o, retreat, await o.logout());
}

async function runRetreat(session: Session, step: Step<any>, why: RetreatReport['why'], o: FailureExitOptions): Promise<RetreatReport> {
    const sdk = session.sdk;
    const s0 = sdk.getState()!;
    const maxTicks = o.maxTicks ?? RETREAT_MAX_TICKS;
    const watch = new DeathWatch(s0, `retreating after "${step.name}" failed`);
    const unwatch = sdk.onStateUpdate(st => watch.see(st));
    const fence = new Fence();
    const unfence = fence.install(sdk);
    const attempt = fence.open();
    const ctx: StepContext<any> = { session, sdk, bot: session.bot, c: {}, log: o.log };
    const ran = fence.run(attempt, () => step.retreat!(ctx)).then(
        () => null,
        (e: unknown) => (e instanceof Error ? e.message : String(e)),
    );
    // The fence stays up until the retreat itself settles: an overrun one keeps running, refused.
    void ran.finally(unfence);
    let unbound = () => {};
    const bound = new Promise<'bound'>(resolve => {
        const timer = setTimeout(() => resolve('bound'), Math.max(1, 2 * maxTicks * tickMs()));
        const off = sdk.onStateUpdate(st => {
            if (st.tick - s0.tick >= maxTicks) resolve('bound');
        });
        unbound = () => {
            clearTimeout(timer);
            off();
        };
    });
    let r: string | null | 'bound';
    try {
        r = await Promise.race([ran, bound]);
    } finally {
        unbound();
        unwatch();
    }
    if (r === 'bound') attempt.abort(`the retreat's ${maxTicks}-tick bound`);
    const s1 = sdk.getState() ?? s0;
    const death = watch.death();
    if (death) session.died ??= death;
    const error = r === 'bound' ? `still walking after its ${maxTicks}-tick bound` : (r ?? undefined);
    return {
        step: step.name, why, ok: !error && !death,
        ...(error ? { error } : {}), ...(r === 'bound' ? { timedOut: true as const } : {}), ...(death ? { died: death.reason } : {}),
        from: pos(s0), to: pos(s1), startTick: s0.tick, endTick: s1.tick,
    };
}

function recorded(session: Session, o: FailureExitOptions, retreat: RetreatReport, logout: LogoutResult): FailureExit {
    const { step, startTick, endTick, ok, error, ...seen } = retreat;
    o.log.append(annotation(o.log, o.account, 'note', RETREAT_STEP, {
        sessionId: session.sessionId, startTick, endTick, ok,
        ...(error ? { error } : {}),
        meta: {
            step, ...seen,
            logout: { ok: logout.ok, clickTick: logout.clickTick, ...(logout.sends !== undefined ? { sends: logout.sends } : {}), ...(logout.reason ? { reason: logout.reason } : {}) },
        },
    }));
    return { retreat, logout };
}

/** The exit as the attempt's outcome says it: the retreat, if one ran, and the logout. */
export function describeExit(x: FailureExit): string {
    const t = (p: Tile) => `(${p.x},${p.z})`;
    const out = x.logout.ok ? 'logged out' : `logout NOT confirmed (${x.logout.reason ?? 'no reason'})`;
    const r = x.retreat;
    if (!r) return out;
    const walk = `${t(r.from)} to ${t(r.to)}, ${Math.max(0, r.endTick - r.startTick)} ticks`;
    if (r.died) return `DIED retreating (${walk}): ${r.died}; ${out}`;
    if (!r.ok) return `retreat FAILED (${r.why}; ${walk}): ${r.error}; ${out} anyway`;
    return `retreated out of reach (${r.why}; ${walk}), then ${out}`;
}
