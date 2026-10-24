// One attempt's chain under its stops: runResumable with the host reservation read at every
// logout-safe boundary, Ctrl-C, and the caller's own gate, shared by speedrun/rehearse.ts and
// speedrun/run.ts.

import { type Link, type Probe, type ResumeEvent, runResumable } from '../runner/resume';
import { describeExit, leaveAfterFailure } from '../runner/retreat';
import { StepError, type RunnerSession, type Step, type StepRecord } from '../runner/step';
import { EXIT_HOST_RESERVED, type HostReservation, type ReservationWatch, reservationText } from './host-reservation';
import type { LogoutResult, Session } from './session';
import type { BotWorldState } from '../../sdk/types';
import type { ProgramStatus } from './programs';
import { type RowKind, tickCounter, type TickLog, type TickRow } from './ticks';
import { tickMs } from './wait';

/** The `gate` annotation row an attempt paused by a live reservation writes. */
export const PAUSE_STEP = '(gate) paused for the gate/run';

export function annotation(
    log: Pick<TickLog, 'runId'>,
    account: string,
    kind: RowKind,
    step: string,
    f: { sessionId?: number; startTick?: number; endTick?: number; ok?: boolean; error?: string; meta?: Record<string, unknown>; crossedSession?: boolean }
): TickRow {
    const startTick = f.startTick ?? -1;
    const endTick = f.endTick ?? startTick;
    return {
        v: 1, kind, runId: log.runId, account, sessionId: f.sessionId ?? 0, step, startTick, endTick,
        ticks: startTick < 0 ? 0 : Math.max(0, endTick - startTick), wallMs: 0, ok: f.ok ?? true,
        ...(f.error ? { error: f.error } : {}), ...(f.meta ? { meta: f.meta } : {}), ...(f.crossedSession ? { crossedSession: true } : {}),
        tickMs: tickMs(), at: new Date().toISOString(),
    };
}

export interface AttemptOptions {
    log: TickLog;
    account: string;
    link: Link;
    from?: number | string;
    /** The probes the chain's steps read on a resume walk (runner/resume.ts stepProbes). */
    probes?: Readonly<Record<string, Probe>>;
    /** The attempt's step record (run.ts's AttemptRecord.steps): runSteps marks each step, the resume walk reads it. */
    record?: StepRecord;
    /** Read at every logout-safe boundary (ReservationWatch.boundary), before the other stops. */
    reservation: ReservationWatch;
    /** Ctrl-C asked for a stop. */
    stopAsked: () => boolean;
    /** Why the rehearsal tab's in-page probe refuses ((c) failed), or null. */
    gateStop: () => string | null;
    /** Leave the world: logoutClean, page-confirmed. Clearing `expectInWorld` keeps the watchdog from relaunching. */
    logout: () => Promise<LogoutResult>;
    /** runSteps' atStop: at a stop's logout-safe boundary, before the logout (run.ts writes its census row). */
    atStop?: (session: RunnerSession, next: Step<any>, index: number) => void;
    /** runResumable's recover after a drop (run.ts: runner/drop-relog.ts); default the link's own restore. */
    recover?: (reason: string, at: { step: string | null; tick: number }) => Promise<void>;
    onEvent?: (e: ResumeEvent) => void;
    /** The caller's tag on its console lines (default 'rehearse'). */
    label?: string;
}

export interface AttemptResult {
    outcome: string;
    code: number;
    /** Set when a live host reservation stopped the attempt. */
    paused: HostReservation | null;
    /** A stop or a pause at a logout-safe boundary: the chain index it resumes at (the --from to give). */
    resumeAt?: number;
}

/**
 * The chain through runResumable with the attempt's stops, polled after each logoutSafe step:
 * the runner has no safe point inside a step, so a long step runs to its end first. A live host
 * reservation logs out there, writes a PAUSE_STEP row and returns EXIT_HOST_RESERVED; nothing here
 * restarts the attempt. Ctrl-C returns 4 and a failed rehearsal-tab gate 3, as before.
 */
export async function runAttempt(session: Session, chain: ReadonlyArray<Step<any>>, o: AttemptOptions): Promise<AttemptResult> {
    const held: { reservation: HostReservation | null; logout: LogoutResult | null } = { reservation: null, logout: null };
    try {
        const r = await runResumable(session, chain, {
            log: o.log,
            c: {},
            link: o.link,
            // The reservation is read first, at every boundary, so a pause is recorded as one even beside a Ctrl-C.
            shouldStop: () => {
                held.reservation ??= o.reservation.boundary();
                return held.reservation !== null || o.stopAsked() || o.gateStop() !== null;
            },
            logout: async () => {
                held.logout = await o.logout();
            },
            ...(o.atStop ? { atStop: o.atStop } : {}),
            ...(o.from !== undefined ? { from: o.from } : {}),
            ...(o.recover ? { recover: o.recover } : {}),
            ...(o.probes ? { probes: o.probes } : {}),
            ...(o.record ? { record: o.record } : {}),
            ...(o.onEvent ? { onEvent: o.onEvent } : {}),
        });
        if (r.resumeAt === undefined) return { outcome: r.drops ? `chain done after ${r.drops} drop(s)` : 'chain done', code: 0, paused: null };
        const before = chain[r.resumeAt]?.name ?? null;
        const res = held.reservation;
        if (res) {
            const out = held.logout;
            o.log.append(annotation(o.log, o.account, 'gate', PAUSE_STEP, {
                sessionId: session.sessionId,
                startTick: out ? out.clickTick : (session.sdk.getState()?.tick ?? -1),
                ok: out?.ok === true,
                ...(out && !out.ok ? { error: `logout not confirmed: ${out.reason}` } : {}),
                meta: { ...res, path: o.reservation.path, before, ...(out ? { logout: out } : {}) },
            }));
            const left = out?.ok ? 'logged out' : `logout NOT confirmed (${out?.reason ?? 'no logout'})`;
            return {
                outcome: `PAUSED for the gate/run: the host is reserved by ${reservationText(res)}; ${left} before "${before}"; run again once the reservation is gone`,
                code: EXIT_HOST_RESERVED,
                paused: res,
                resumeAt: r.resumeAt,
            };
        }
        const gate = o.gateStop();
        if (gate) return { outcome: `REFUSED after the in-page probe (${gate}); logged out`, code: 3, paused: null };
        return { outcome: `stopped before "${before}"; logged out`, code: 4, paused: null, resumeAt: r.resumeAt };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // A step that logged out on purpose (a PausedForPlayer pause) left the world itself.
        const r = !session.expectInWorld ? { outcome: `paused by the step, already logged out: ${msg}`, code: 4 } : { outcome: `FAILED: ${msg}${await retreatedExit(session, chain, e, o)}`, code: 1 };
        console.error(`[${o.label ?? 'rehearse'}] ${r.outcome}`);
        return { ...r, paused: null };
    }
}

/**
 * The exit after a failed step that declares `retreat` (runner/retreat.ts): out of the aggressors'
 * reach, then the logout, said as the outcome's tail. Empty for any other failure, whose logout the
 * caller makes as it always has.
 */
async function retreatedExit(session: Session, chain: ReadonlyArray<Step<any>>, e: unknown, o: AttemptOptions): Promise<string> {
    const failed = e instanceof StepError ? chain.find(s => s.name === e.step) : undefined;
    if (!failed?.retreat) return '';
    try {
        return `; ${describeExit(await leaveAfterFailure(session, failed, { log: o.log, account: o.account, logout: o.logout }))}`;
    } catch (err) {
        return `; the exit after it failed too: ${err instanceof Error ? err.message : String(err)}`;
    }
}

// ------------------------------------------------------------------ trackers (fed every published state)

/** How a game session ended: the attempt's logout, an in-page relog (the page went on counting), or a client relaunch. */
export type SessionEnd = 'logout' | 'relog' | 'relaunch';

/** What SessionClock reads off a session at each state. tickBase and launchId default as in lib/ticks.ts tickCounter. */
export type ClockedSession = Pick<Session, 'sessionId'> & Partial<Pick<Session, 'tickBase' | 'launchId'>>;

/**
 * Per game session (lib/session.ts sessionId): the tick its count starts from (`base`: 0 after a
 * launch, the page's earlier count after an in-page login) and the first and last in-world tick seen.
 */
export class SessionClock {
    readonly sessions = new Map<number, { first: number; last: number; base: number }>();
    private seen: { sessionId: number; counter: number } | null = null;

    observe(sessionId: number, s: Pick<BotWorldState, 'tick' | 'inGame'>, tickBase = 0): void {
        if (!s.inGame) return;
        const e = this.sessions.get(sessionId);
        if (!e) this.sessions.set(sessionId, { first: s.tick, last: s.tick, base: tickBase });
        else e.last = Math.max(e.last, s.tick);
    }

    /**
     * Feed one published state of `session`. When a new game session has begun, the one before it
     * is closed first, as a relog when the count went on (same tickCounter) or a relaunch.
     */
    track(log: TickLog, account: string, session: ClockedSession, s: Pick<BotWorldState, 'tick' | 'inGame'>): TickRow | null {
        const prev = this.seen;
        const counter = tickCounter(session);
        const closed = prev && prev.sessionId !== session.sessionId ? this.close(log, account, prev.sessionId, prev.counter === counter ? 'relog' : 'relaunch') : null;
        this.seen = { sessionId: session.sessionId, counter };
        this.observe(session.sessionId, s, session.tickBase ?? 0);
        return closed;
    }

    /**
     * Append the `(session)` row of a session seen, from its tick base to `endTick` (default its
     * last in-world tick), so its ticks are its own and not the page's earlier sessions'; then forget it.
     */
    close(log: TickLog, account: string, sessionId: number, ended: SessionEnd, endTick?: number, logout?: LogoutResult): TickRow | null {
        const e = this.sessions.get(sessionId);
        if (!e) return null;
        const r = annotation(log, account, 'session', '(session)', {
            sessionId, startTick: e.base, endTick: endTick ?? e.last,
            meta: { firstObservedTick: e.first, ended, ...(e.base ? { tickBase: e.base } : {}), ...(logout ? { logout } : {}) },
        });
        log.append(r);
        this.sessions.delete(sessionId);
        return r;
    }
}

export interface ReachEvent {
    skill: string;
    level: number;
    tick: number;
}

/** A `reach` row; an in-page session's tick base rides in meta, so summarize reads the session's own tick. */
export function reachRow(log: Pick<TickLog, 'runId'>, account: string, session: ClockedSession, r: ReachEvent): TickRow {
    const base = session.tickBase ?? 0;
    return annotation(log, account, 'reach', `(reach) ${r.skill} ${r.level}`, {
        sessionId: session.sessionId, startTick: r.tick, meta: { skill: r.skill, level: r.level, ...(base ? { tickBase: base } : {}) },
    });
}

/** Base-level gains in any skill, one event per level (a multi-level jump gives one per level). */
export class ReachTracker {
    private base: Map<string, number> | null = null;
    observe(s: Pick<BotWorldState, 'skills' | 'tick' | 'inGame'>): ReachEvent[] {
        if (!s.inGame || !s.skills?.length) return [];
        const now = new Map(s.skills.map(k => [k.name.toLowerCase(), k.baseLevel] as const));
        const prev = this.base;
        this.base = now;
        if (!prev) return [];
        const out: ReachEvent[] = [];
        for (const [skill, level] of now) {
            const p = prev.get(skill);
            if (p !== undefined) for (let l = p + 1; l <= level; l++) out.push({ skill, level: l, tick: s.tick });
        }
        return out;
    }
}

/** In-page program runs to log: each run once, at its end (done, fault, stopped, or replaced by the next). */
export class ProgramTracker {
    private last: ProgramStatus | null = null;
    private readonly logged = new Set<string>();
    private static key(st: ProgramStatus): string {
        return `${st.runId}@${st.startedTick}`;
    }
    observe(st: ProgramStatus | null): ProgramStatus[] {
        const out: ProgramStatus[] = [];
        const prev = this.last;
        if (prev && (!st || ProgramTracker.key(st) !== ProgramTracker.key(prev)) && !this.logged.has(ProgramTracker.key(prev))) {
            this.logged.add(ProgramTracker.key(prev));
            out.push(st && prev.phase === 'running' ? { ...prev, phase: 'replaced' } : prev);
        }
        if (st && st.phase !== 'running' && !this.logged.has(ProgramTracker.key(st))) {
            this.logged.add(ProgramTracker.key(st));
            out.push(st);
        }
        if (st) this.last = st;
        return out;
    }
    /** A run still going when the attempt ended. */
    flush(): ProgramStatus[] {
        const prev = this.last;
        if (!prev || this.logged.has(ProgramTracker.key(prev))) return [];
        this.logged.add(ProgramTracker.key(prev));
        return [prev];
    }
}

/** Where a poison was seen: a game message matching /poison/i, or the state's `poisonSeenAt` tick. */
export interface PoisonSighting {
    tick: number;
    source: 'message' | 'hitmark';
    text?: string;
}

/** The poison note a row carries: the sightings between its start and end tick. */
export interface PoisonNote {
    seen: number;
    firstTick: number;
    lastTick: number;
    /** 'hitmark' once any sighting in the row was one, else 'message'. */
    source: PoisonSighting['source'];
    /** The first message's text, when a message was seen. */
    text?: string;
}

export const POISON_MESSAGE = /poison/i;

/** Sightings kept: far more than any one row spans, so a row's note is never cut short by the bound. */
const POISON_KEPT = 2_000;

/**
 * SCORED's hp and poison for the tick log: `stamp` adds `hp` and `maxHp` (from state.player at the
 * row's end, which is when it is appended) and a `poison` note to a row's meta. The poison evidence
 * is each new game message matching /poison/i, and a state's numeric `poisonSeenAt` (the tick a
 * poison hitsplat was last seen) where the client publishes one; the hitmark wins where both are seen.
 * A death is then diagnosable from the log alone: the hp series shows the fall, the notes the poison.
 */
export class VitalsTracker {
    private sightings: PoisonSighting[] = [];
    private messageKeys = new Set<string>();
    private hitmarkAt: number | null = null;
    private lastTick = -1;

    observe(s: Pick<BotWorldState, 'tick' | 'gameMessages'>): void {
        // A client relaunch restarts the tick count: sightings on the old count would land in new rows.
        if (s.tick < this.lastTick) {
            this.sightings = [];
            this.messageKeys.clear();
            this.hitmarkAt = null;
        }
        this.lastTick = s.tick;
        const keys = new Set<string>();
        for (const m of s.gameMessages ?? []) {
            if (!POISON_MESSAGE.test(m.text)) continue;
            const key = `${m.observationId ?? ''}|${m.tick}|${m.text}`;
            keys.add(key);
            if (!this.messageKeys.has(key)) this.sightings.push({ tick: m.tick, source: 'message', text: m.text });
        }
        // The messages are a rolling window: a key is new only against the window seen last.
        this.messageKeys = keys;
        const hit = (s as { poisonSeenAt?: unknown }).poisonSeenAt;
        if (typeof hit === 'number' && Number.isFinite(hit) && hit !== this.hitmarkAt) {
            this.hitmarkAt = hit;
            this.sightings.push({ tick: hit, source: 'hitmark' });
        }
        if (this.sightings.length > POISON_KEPT) this.sightings = this.sightings.slice(-POISON_KEPT);
    }

    /** The poison note for ticks `start` to `end`, or null when none was seen. */
    poisonDuring(start: number, end: number): PoisonNote | null {
        if (start < 0) return null;
        const seen = this.sightings.filter(x => x.tick >= start && x.tick <= Math.max(start, end));
        if (!seen.length) return null;
        const ticks = seen.map(x => x.tick);
        const text = seen.find(x => x.text)?.text;
        return { seen: seen.length, firstTick: Math.min(...ticks), lastTick: Math.max(...ticks), source: seen.some(x => x.source === 'hitmark') ? 'hitmark' : 'message', ...(text ? { text } : {}) };
    }

    /** `row` with `hp`, `maxHp` and `poison` in its meta; a key the row's meta already has is kept. */
    stamp(row: TickRow, s: Pick<BotWorldState, 'player'> | null): TickRow {
        const p = s?.player;
        const poison = this.poisonDuring(row.startTick, row.endTick);
        if (!p && !poison) return row;
        const meta = row.meta ?? {};
        const add: Record<string, unknown> = { ...(p ? { hp: p.hp, maxHp: p.maxHp } : {}), ...(poison ? { poison } : {}) };
        for (const k of Object.keys(add)) if (k in meta) delete add[k];
        return { ...row, meta: { ...meta, ...add } };
    }
}

export function programRow(log: Pick<TickLog, 'runId'>, account: string, sessionId: number, st: ProgramStatus): TickRow {
    return annotation(log, account, 'program', `(program) ${st.name}`, {
        sessionId, startTick: st.startedTick, endTick: st.endedTick ?? st.tick, ok: st.phase !== 'fault', ...(st.fault ? { error: st.fault } : {}),
        meta: {
            runId: st.runId, phase: st.phase, params: st.params, counters: st.counters, gauges: st.gauges, packets: st.packets, deferred: st.deferred,
            skippedTicks: st.skippedTicks, maxTickMs: st.maxTickMs, frames: st.frames, publish: st.publish, react: st.react, loops: st.loops,
            ...(st.last ? { last: st.last } : {}), ...(st.result !== undefined ? { result: st.result } : {}),
        },
    });
}
