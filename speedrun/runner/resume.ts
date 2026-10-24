// The resume protocol: where the run continues after a restart, from the game
// state, never from the run script's memory.
//
// A demo restart rolls the account back to its last world checkpoint (seconds
// old on the demo; docs/speedrun/RESILIENCE.md), and a dropped client leaves
// the step half done. Either way the script's own idea of "the step I was in"
// is wrong, so every (re)start walks the manifest against what the game shows:
//
// 1. Milestones are the steps with `done`. The walk finds the first milestone
//    whose `done` is false (k), and the last one before it that is done.
// 2. Between them, the latest step that can start now wins: from k back to the
//    step after the last done milestone, a step whose `inProgress` holds is
//    entered through `resume`; otherwise one whose preconditions hold is
//    entered through `run`. Transient steps (travel, banking) before k are
//    skipped when the state already shows their effect.
// 3. Nothing qualifies: stop for the operator with every candidate's reason.
//
// A step with `logoutSafe: false` (a fight, a queued completion) is never re-entered mid-step
// through `run` from the top. A dropped player stays in the world for 500 ticks, so a relogin
// inside that window is a session takeover that lands on the same tile with the fight still on
// (World.ts TIMEOUT_NO_CONNECTION). For such a step the walk enters through `resume` when
// `inProgress` holds and the step has one; when `inProgress` holds without `resume`, or when
// `run` would start it in combat (lib/world.ts inCombatWindow, the server's logout rule) and the
// step does not declare `startsInCombat`, the walk stops there with a MidStepError instead of
// walking further back. runResumable waits, bounded, for the combat to end, observes again and
// walks again; still mid-step, the run stops for the operator naming the step and the reason.
//
// Probes (a bank-open probe, a quest-journal read) cost ticks, so they run only
// when a step the walk evaluates declares them, once per walk.
//
// Each walk starts by turning run on (lib/run-mode.ts), however the session
// came back: a relaunched client or reloaded page logged in without login().
// It first waits, bounded in observed ticks, for a state that carries the player (awaitPlayer): a
// reloaded or relaunched client can publish frames before it, and S00's `done` (skills/start.ts)
// reads the player, so a walk on such a frame sees S00 undone and refuses 'not in game'.
// It then waits for the client's own scene-ready signal (lib/wait.ts awaitScene,
// the one wait the launch path uses too) before it observes: a fresh login shows
// "Loading - please wait." for tens of ticks on the browser client, and its
// nearby locs and NPCs are empty then, which is also what a normal empty scene
// looks like, so only the flag can tell.
//
// runResumable runs that walk, then the steps, and on a dropped connection
// abandons the step attempt (runner/fence.ts), waits for the session to come
// back (the watchdog's reconnect, lib/reconnect.ts), and walks again.

import type { BotWorldState } from '../../sdk/types';
import { ensureRunOn } from '../lib/run-mode';
import type { Session } from '../lib/session';
import { startRunTickMonitor } from '../lib/tick-monitor';
import {
    tickCounter,
    tickSpan,
    type TickLog,
} from '../lib/ticks';
import {
    awaitScene,
    currentTick,
    idleBoundMs,
    nextTick,
    periodMs,
    sleep,
    tickMs,
    waitUntil,
} from '../lib/wait';
import { Fence } from './fence';
import { journalProbeNamed } from '../lib/quests';
import { COMBAT_LOGOUT_TICKS, inCombatWindow } from '../lib/world';
import { resolveStart, runSteps, type Observed, type RunnerSession, type RunStepsOptions, type RunStepsResult, type Step } from './step';

export type Probe = (session: RunnerSession) => Promise<unknown>;

export interface ResumePoint {
    /** Step index to start at; steps.length when the run is complete. */
    index: number;
    mode: 'run' | 'resume' | 'finished';
    step: string | null;
    /** Last milestone found done (-1 if none) and the first not done (steps.length if none). */
    lastDone: number;
    firstUndone: number;
    reason: string;
    observed: Observed;
}

export class ResumeError extends Error {
    constructor(readonly candidates: { step: string; why: string }[], readonly lastDone: number, readonly firstUndone: number) {
        super(`no step can start from the observed state (last done milestone #${lastDone}, first undone #${firstUndone}): ${candidates.map(c => `${c.step}: ${c.why}`).join('; ')}`);
        this.name = 'ResumeError';
    }
}

/**
 * A logoutSafe:false step the walk would re-enter mid-step (see the file comment). `combat`: the
 * observed state is in the combat window, so a wait for the fight to end may change the answer.
 */
export class MidStepError extends ResumeError {
    constructor(readonly index: number, readonly step: string, readonly why: string, readonly combat: boolean, lastDone: number, firstUndone: number) {
        super([{ step, why }], lastDone, firstUndone);
        this.message = `${step} cannot be re-entered mid-step (logoutSafe: false): ${why}`;
    }
}

function combatWhy(s: BotWorldState): string {
    const c = s.player?.combat;
    const hit = c && c.lastDamageTick >= 0 ? `hit ${s.tick - c.lastDamageTick} ticks ago` : 'not hit';
    return `in combat (${c?.inCombat ? 'engaged' : 'not engaged'}, ${hit}; the window ends ${COMBAT_LOGOUT_TICKS} ticks after the last hit)`;
}

/**
 * A step module's exported `PROBES` when it is a record of probes (skills/cooking.ts,
 * skills/prayer.ts). A list of names (a quest's journal probes) provides none itself.
 */
export function moduleProbes(m: object): Record<string, Probe> {
    const p = (m as { readonly PROBES?: unknown }).PROBES;
    if (!p || typeof p !== 'object' || Array.isArray(p)) return {};
    return Object.fromEntries(Object.entries(p).filter((e): e is [string, Probe] => typeof e[1] === 'function'));
}

/**
 * runResumable's `probes` for `steps`: every name a step declares (Step.probes), from the modules'
 * exported PROBES or, for a quest journal, lib/quests.ts. Throws naming each probe nothing provides,
 * so a chain refuses before it starts instead of at the resume walk that needs it.
 */
export function stepProbes(steps: ReadonlyArray<Pick<Step<never>, 'name' | 'probes'>>, modules: ReadonlyArray<object>): Record<string, Probe> {
    const provided: Record<string, Probe> = Object.assign({}, ...modules.map(moduleProbes));
    const out: Record<string, Probe> = {};
    const missing = new Map<string, string>();
    for (const s of steps) {
        for (const n of s.probes ?? []) {
            if (n in out || missing.has(n)) continue;
            const p = provided[n] ?? journalProbeNamed(n);
            if (p) out[n] = p;
            else missing.set(n, s.name);
        }
    }
    if (missing.size) throw new Error(`no probe for ${[...missing].map(([n, step]) => `"${n}" (${step})`).join(', ')}: export it in the step module's PROBES`);
    return out;
}

/** Lazily probed view of the game, shared by one walk. */
export class Observation implements Observed {
    readonly probed: Record<string, unknown> = {};
    constructor(readonly state: BotWorldState, private readonly probes: Readonly<Record<string, Probe>> = {}, private readonly session?: RunnerSession) {}

    async ensure(names: readonly string[] | undefined): Promise<void> {
        for (const n of names ?? []) {
            if (n in this.probed) continue;
            const p = this.probes[n];
            if (!p || !this.session) throw new Error(`step needs probe "${n}", which the runner was not given`);
            this.probed[n] = await p(this.session).catch(() => null);
        }
    }
}

/** Walk the manifest against the observation. See the file comment for the rule. */
export async function resolveResume<C>(steps: ReadonlyArray<Step<C>>, obs: Observation, c: C): Promise<ResumePoint> {
    let lastDone = -1;
    let firstUndone = steps.length;
    for (let i = 0; i < steps.length; i++) {
        const s = steps[i]!;
        if (!s.done) continue;
        await obs.ensure(s.probes);
        if (s.done(obs, c)) lastDone = i;
        else {
            firstUndone = i;
            break;
        }
    }
    const point = (index: number, mode: ResumePoint['mode'], reason: string): ResumePoint => ({
        index, mode, step: steps[index]?.name ?? null, lastDone, firstUndone, reason, observed: obs,
    });
    // Trailing transients after the last milestone still have to run.
    const top = Math.min(firstUndone, steps.length - 1);
    if (top <= lastDone) return point(steps.length, 'finished', 'every milestone is done');
    const why: { step: string; why: string }[] = [];
    for (let j = top; j > lastDone; j--) {
        const s = steps[j]!;
        await obs.ensure(s.probes);
        if (s.inProgress?.(obs, c)) {
            if (s.logoutSafe || s.resume) return point(j, 'resume', `${s.name} is in progress`);
            throw new MidStepError(j, s.name, 'in progress with no resume entry, and run would restart it from the top', inCombatWindow(obs.state), lastDone, firstUndone);
        }
        const pre = s.preconditions(obs.state, c);
        const at = pre === true && s.marker ? await markerPlace(steps, j, obs, c) : pre;
        if (at === true) {
            if (!s.logoutSafe && !s.marker && !s.startsInCombat && inCombatWindow(obs.state)) throw new MidStepError(j, s.name, combatWhy(obs.state), true, lastDone, firstUndone);
            return point(j, 'run', `${s.name} can start`);
        }
        why.push({ step: s.name, why: at });
    }
    throw new ResumeError(why, lastDone, firstUndone);
}

/**
 * Whether the walk stands at marker `j` (Step.marker): the step before it finished (its
 * postconditions hold and it is not in progress), or the step after it is in progress or can start.
 * The reason otherwise, so the walk goes on down to the unfinished step before it.
 */
async function markerPlace<C>(steps: ReadonlyArray<Step<C>>, j: number, obs: Observation, c: C): Promise<true | string> {
    const prev = steps[j - 1];
    const next = steps[j + 1];
    if (!prev || !next) return true;
    await obs.ensure(prev.probes);
    if (prev.postconditions(obs.state, c) === true && !prev.inProgress?.(obs, c)) return true;
    await obs.ensure(next.probes);
    if (next.inProgress?.(obs, c) || next.preconditions(obs.state, c) === true) return true;
    return `a marker: ${prev.name} has not finished and ${next.name} cannot start`;
}

// ------------------------------------------------------------------ link

/** The connection as the runner sees it. */
export interface Link {
    /** Resolves with a reason once the session is lost; stops watching when `signal` aborts. */
    lost(signal: AbortSignal): Promise<string>;
    /** Resolves once the session is back in the world with an advancing tick; rejects at `timeoutMs`, or when `signal` aborts. */
    restored(timeoutMs: number, signal?: AbortSignal): Promise<void>;
    /** True while the session is lost. */
    isLost(): boolean;
}

/**
 * The demo can go silent for ~2 s with nothing wrong (1,987 ms with no frames,
 * 07:50 PDT, rs/102), so silence alone counts only past ~5 s. A real drop is
 * seen sooner through the socket closing (the lite runner exits at once).
 */
export const LOST_AFTER_TICKS = 17;

export interface SessionLinkOptions {
    /** Ticks without an advancing in-world tick before the session counts as lost (default LOST_AFTER_TICKS). */
    staleTicks?: number;
    pollMs?: number;
    /**
     * The page's own in-game flag (lib/tab.ts pageInGame; null: unknown). A browser page that falls
     * out of the world stops publishing rather than publishing inGame false, so without this a drop
     * is seen only at `staleTicks`, the same bound the watchdog acts on. With it the page is asked
     * once the tick has stood PAGE_CHECK_TICKS, and an out page is lost at once (run.ts's drop path).
     */
    pageInGame?: () => Promise<boolean | null>;
}

/** Ticks the tick may stand before the link asks the page whether it is still in the world. */
export const PAGE_CHECK_TICKS = 3;

/**
 * A Link over a live Session. Lost: the lite child exited, the client publishes
 * inGame false, or the tick stopped advancing for `staleTicks`, each only while
 * the account is meant to be in the world: after an intended logout (logoutClean
 * clears `expectInWorld`, from a step or a stop) the lite runner exits and the
 * client goes quiet, and neither is a drop. Restored: an advancing in-world tick
 * after the loss, from whichever client the watchdog (or the caller's recover)
 * brought back.
 */
export function sessionLink(session: Session, opts: SessionLinkOptions = {}): Link {
    // Silence has no ticks to count: N ticks at the longer of the nominal and observed period.
    const staleMs = () => idleBoundMs({ ticks: opts.staleTicks ?? LOST_AFTER_TICKS, period: session.period });
    const pollMs = opts.pollMs ?? 100;
    let lostAt = 0;
    // When the page last read out of the world (0: not since the tick last advanced).
    let pageOutAt = 0;
    let pageAskedAt = 0;
    const why = (): string | null => {
        if (session.client === 'lite' && session.child && session.childExit !== null && session.expectInWorld) return `client exited (${session.childExit})`;
        const s = session.sdk.getState();
        if (s && !s.inGame && session.expectInWorld) return 'client out of game';
        if (pageOutAt && session.lastAdvanceAt > pageOutAt) pageOutAt = 0;
        if (pageOutAt && session.expectInWorld) return 'page out of game';
        const since = Date.now() - session.lastAdvanceAt;
        if (since > staleMs() && session.expectInWorld) return `no tick for ~${Math.round(since / periodMs(session.period))} ticks (${since} ms)`;
        return null;
    };
    const askPage = async () => {
        const ask = opts.pageInGame;
        const now = Date.now();
        if (!ask || !session.expectInWorld || now - session.lastAdvanceAt <= PAGE_CHECK_TICKS * tickMs() || now - pageAskedAt < tickMs()) return;
        pageAskedAt = now;
        if ((await ask().catch(() => null)) === false && session.lastAdvanceAt < now) pageOutAt = Date.now();
    };
    return {
        isLost: () => why() !== null,
        lost: async signal => {
            while (!signal.aborted) {
                await askPage();
                const w = why();
                if (w) {
                    lostAt = Date.now();
                    return w;
                }
                await sleep(pollMs);
            }
            return 'stopped watching';
        },
        restored: async (timeoutMs, signal) => {
            const deadline = Date.now() + timeoutMs;
            const since = Math.max(lostAt, 1);
            // Back means two different in-world ticks seen after the loss, so a
            // replayed stale state does not count. The watchdog's login already
            // waited for that, so this usually resolves on the first poll.
            let first: number | null = null;
            while (Date.now() < deadline) {
                if (signal?.aborted) throw new Error(`${session.name}: stopped waiting to be back in the world`);
                const s = session.sdk.getState();
                if (s?.inGame && session.expectInWorld && session.lastAdvanceAt > since && why() === null) {
                    if (first === null) first = session.sessionId * 1e9 + s.tick;
                    const relaunched = session.launchedAt > since && session.lastAdvanceAt > session.launchedAt;
                    if (relaunched || session.sessionId * 1e9 + s.tick !== first) return;
                }
                await sleep(Math.min(pollMs, 20));
            }
            throw new Error(`${session.name}: not back in the world within ${timeoutMs} ms`);
        },
    };
}

// ------------------------------------------------------------------ runner

/** How lib/programs.ts awaitProgram says the page under a program was replaced. */
const RELOADED = /page reloaded/i;

export const RESUME_STEP = '(resume)';
export const DROP_STEP = '(drop)';

export type ResumeEvent =
    | { kind: 'resume'; attempt: number; point: Omit<ResumePoint, 'observed'> }
    | { kind: 'drop'; attempt: number; reason: string; step: string | null; tick: number }
    | { kind: 'restored'; attempt: number; wallMs: number };

export interface ResumableOptions<C> extends Omit<RunStepsOptions<C>, 'from' | 'startMode' | 'observed' | 'signal'> {
    link: Link;
    probes?: Readonly<Record<string, Probe>>;
    /** Operator override for the first attempt only (`--from`); later attempts always walk. */
    from?: number | string;
    /** Bring the session back after a drop (`at`: the step it cut and the tick). Default: wait for `link.restored` (the watchdog reconnects). */
    recover?: (reason: string, at: { step: string | null; tick: number }) => Promise<void>;
    /** Give up after this many drops (default 20). */
    maxDrops?: number;
    /** Longest wait for the session to come back (default 30 min: a restart takes ~2-3). */
    restoreTimeoutMs?: number;
    onEvent?: (e: ResumeEvent) => void;
    /** Bound on each walk's scene wait (default lib/wait.ts SCENE_READY_MAX_TICKS); past it the walk observes anyway. */
    sceneMaxTicks?: number;
    /** Bound on each walk's wait for a mid-step combat to end (default MID_STEP_HOLD_TICKS); past it the run stops with the MidStepError. */
    midStepHoldTicks?: number;
    /** Bound on each walk's wait for a state with the player (default PLAYER_MAX_TICKS); past it the walk observes anyway. */
    playerMaxTicks?: number;
}

/**
 * Observed ticks a walk waits for a takeover's fight to end before it refuses: the combat window
 * (COMBAT_LOGOUT_TICKS after the last hit) plus room for auto-retaliate to finish a quest NPC.
 * Not measured; nothing eats or prays while it waits.
 */
export const MID_STEP_HOLD_TICKS = 100;

export interface MidStepHold {
    step: string;
    why: string;
    ticks: number;
}

/**
 * The walk, holding for a mid-step combat (MidStepError with `combat`): wait until the account is
 * out of the combat window, observe again and walk again. A new hit during the hold, a window that
 * does not end within the bound, or a second MidStepError stops the run for the operator.
 */
async function walkHeld<C>(session: RunnerSession, steps: ReadonlyArray<Step<C>>, obs: Observation, opts: ResumableOptions<C>): Promise<{ point: ResumePoint; hold?: MidStepHold }> {
    try {
        return { point: await resolveResume(steps, obs, opts.c) };
    } catch (e) {
        if (!(e instanceof MidStepError) || !e.combat) throw e;
        const t0 = currentTick(session.sdk);
        const maxTicks = opts.midStepHoldTicks ?? MID_STEP_HOLD_TICKS;
        // A hit after the walk's observation: something is still attacking SCORED, and idling on is worse than stopping.
        const lastHit = obs.state.player?.combat?.lastDamageTick ?? -1;
        const hitAgain = (st: BotWorldState) => (st.player?.combat?.lastDamageTick ?? -1) > lastHit;
        const w = await waitUntil(session.sdk, st => !inCombatWindow(st) || hitAgain(st), { maxTicks });
        const s = session.sdk.getState()!;
        if (hitAgain(s)) throw new MidStepError(e.index, e.step, `${combatWhy(s)}: hit again ${currentTick(session.sdk) - t0} ticks into the hold, so something is still attacking`, true, e.lastDone, e.firstUndone);
        if (!w.ok) throw new MidStepError(e.index, e.step, `${combatWhy(s)} after a ${maxTicks}-tick wait for the fight to end`, true, e.lastDone, e.firstUndone);
        const hold = { step: e.step, why: e.why, ticks: currentTick(session.sdk) - t0 };
        return { point: await resolveResume(steps, new Observation(s, opts.probes, session), opts.c), hold };
    }
}

/**
 * Observed ticks a walk waits for a state with the player. A login publishes it within a few ticks;
 * an account out on purpose (S21's open relog, whose login half the walk must reach) publishes none,
 * and costs the walk this bound or the idle bound once.
 */
export const PLAYER_MAX_TICKS = 30;

/** Wait, bounded in observed ticks, for a published state with the player. Never a fault: past the bound the caller observes what it has. */
export async function awaitPlayer(sdk: RunnerSession['sdk'], maxTicks = PLAYER_MAX_TICKS): Promise<{ ready: boolean; ticks: number }> {
    const t0 = currentTick(sdk);
    const r = await waitUntil(sdk, s => !!s.player, { maxTicks });
    return { ready: r.ok, ticks: currentTick(sdk) - t0 };
}

export interface ResumableResult extends RunStepsResult {
    drops: number;
    points: Omit<ResumePoint, 'observed'>[];
}

function row(log: TickLog, session: RunnerSession, step: string, startTick: number, startCounter: number, t0: number, meta: Record<string, unknown>, ok = true): void {
    const endTick = currentTick(session.sdk);
    const span = tickSpan(startTick, endTick, startCounter, tickCounter(session));
    log.append({
        v: 1, runId: log.runId, account: session.name, sessionId: session.sessionId, step, startTick, endTick, ticks: span.ticks,
        wallMs: Date.now() - t0, ok, meta, ...(span.crossedSession ? { crossedSession: true } : {}), tickMs: tickMs(), at: new Date().toISOString(),
    });
}

/**
 * Run the manifest to the end, surviving drops: walk from the game state, run,
 * and on a lost link abandon the attempt, recover, and walk again. Errors that
 * are not a lost link (a failed postcondition with the session healthy) are
 * thrown as runSteps throws them.
 */
export async function runResumable<C>(session: RunnerSession, steps: ReadonlyArray<Step<C>>, opts: ResumableOptions<C>): Promise<ResumableResult> {
    const fence = new Fence();
    const unfence = fence.install(session.sdk);
    // One monitor across every attempt, so its minutes run on through a drop.
    const monitor = startRunTickMonitor(session, opts.log, opts.tickMonitor);
    const points: Omit<ResumePoint, 'observed'>[] = [];
    let drops = 0;
    try {
        for (let attempt = 1; ; attempt++) {
            const t0 = Date.now();
            const startTick = currentTick(session.sdk);
            const startCounter = tickCounter(session);
            if (!session.sdk.getState()) await nextTick(session.sdk);
            const player = await awaitPlayer(session.sdk, opts.playerMaxTicks);
            // Whatever brought the session back (the watchdog's login or relaunch, a
            // reloaded page) left a fresh login, and a fresh login walks.
            const runMode = await ensureRunOn(session.sdk);
            // Never a fault: a scene that does not load in time is observed as it is and the row says so.
            const scene = await awaitScene(session.sdk, opts.sceneMaxTicks);
            const state = session.sdk.getState()!;
            const obs = new Observation(state, opts.probes, session);
            let point: ResumePoint;
            let hold: MidStepHold | undefined;
            if (attempt === 1 && opts.from !== undefined) {
                const index = resolveStart(steps, opts.from);
                point = { index, mode: 'run', step: steps[index]?.name ?? null, lastDone: -1, firstUndone: -1, reason: 'operator --from', observed: obs };
            } else {
                ({ point, hold } = await walkHeld(session, steps, obs, opts));
            }
            const { observed: _o, ...summary } = point;
            points.push(summary);
            row(opts.log, session, RESUME_STEP, startTick, startCounter, t0, { attempt, ...summary, probes: Object.keys(point.observed.probed), run: runMode, scene, player, ...(hold ? { hold } : {}) });
            opts.onEvent?.({ kind: 'resume', attempt, point: summary });
            if (point.mode === 'finished') return { completed: 0, drops, points };

            const a = fence.open();
            const attemptSession = session.sessionId;
            const watch = new AbortController();
            const lost = opts.link.lost(watch.signal).then(reason => ({ lost: reason }) as const);
            let running = point.index;
            const tracked = steps.map((s, i) => ({
                ...s,
                run: (ctx: Parameters<Step<C>['run']>[0]) => ((running = i), s.run.call(s, ctx)),
                ...(s.resume ? { resume: (ctx: Parameters<Step<C>['run']>[0]) => ((running = i), s.resume!.call(s, ctx)) } : {}),
            }));
            const run = fence
                .run(a, () => runSteps(session, tracked, { ...opts, tickMonitor: false, from: point.index, startMode: point.mode === 'resume' ? 'resume' : 'run', observed: point.observed, signal: a.signal }))
                .then(r => ({ result: r }) as const, (e: unknown) => ({ error: e }) as const);
            const first = await Promise.race([run, lost]);
            watch.abort();

            let reason: string;
            if ('result' in first) {
                if (!first.result.aborted) return { ...first.result, drops, points };
                reason = a.reason || 'aborted';
            } else if ('error' in first) {
                // A drop can surface as the step's own error, sometimes after the
                // link is already back: rs/97's awaitProgram rejects "page reloaded"
                // once the reloaded page publishes. Those resume; anything else is real.
                const msg = first.error instanceof Error ? first.error.message : String(first.error);
                const cut = opts.link.isLost() || session.sessionId !== attemptSession || RELOADED.test(msg);
                if (!cut) throw first.error;
                reason = `step cut by the drop: ${msg}`;
            } else {
                reason = first.lost;
            }
            const dropTick = currentTick(session.sdk);
            a.abort(reason);
            drops++;
            const current = steps[Math.min(running, steps.length - 1)]?.name ?? null;
            opts.onEvent?.({ kind: 'drop', attempt, reason, step: current, tick: dropTick });
            if (drops > (opts.maxDrops ?? 20)) throw new Error(`gave up after ${drops - 1} drops (last: ${reason})`);
            const r0 = Date.now();
            const dropCounter = tickCounter(session);
            await (opts.recover ? opts.recover(reason, { step: current, tick: dropTick }) : opts.link.restored(opts.restoreTimeoutMs ?? 30 * 60_000));
            row(opts.log, session, DROP_STEP, dropTick, dropCounter, r0, { attempt, reason, step: current, recoverMs: Date.now() - r0 }, false);
            opts.onEvent?.({ kind: 'restored', attempt, wallMs: Date.now() - r0 });
        }
    } finally {
        monitor?.stop();
        unfence();
    }
}
