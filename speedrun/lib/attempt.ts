// One attempt's chain under its stops: runResumable with the host reservation read at every
// logout-safe boundary, Ctrl-C, and the caller's own gate, shared by speedrun/rehearse.ts and
// speedrun/run.ts.

import { type Link, type ResumeEvent, runResumable } from '../runner/resume';
import type { Step } from '../runner/step';
import { EXIT_HOST_RESERVED, type HostReservation, type ReservationWatch, reservationText } from './host-reservation';
import type { LogoutResult, Session } from './session';
import type { RowKind, TickLog, TickRow } from './ticks';
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
    /** Read at every logout-safe boundary (ReservationWatch.boundary), before the other stops. */
    reservation: ReservationWatch;
    /** Ctrl-C asked for a stop. */
    stopAsked: () => boolean;
    /** Why the rehearsal tab's in-page probe refuses ((c) failed), or null. */
    gateStop: () => string | null;
    /** Leave the world: logoutClean, page-confirmed. Clearing `expectInWorld` keeps the watchdog from relaunching. */
    logout: () => Promise<LogoutResult>;
    onEvent?: (e: ResumeEvent) => void;
    /** The caller's tag on its console lines (default 'rehearse'). */
    label?: string;
}

export interface AttemptResult {
    outcome: string;
    code: number;
    /** Set when a live host reservation stopped the attempt. */
    paused: HostReservation | null;
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
            ...(o.from !== undefined ? { from: o.from } : {}),
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
            };
        }
        const gate = o.gateStop();
        if (gate) return { outcome: `REFUSED after the in-page probe (${gate}); logged out`, code: 3, paused: null };
        return { outcome: `stopped before "${before}"; logged out`, code: 4, paused: null };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // A step that logged out on purpose (a PausedForPlayer pause) left the world itself.
        const r = !session.expectInWorld ? { outcome: `paused by the step, already logged out: ${msg}`, code: 4 } : { outcome: `FAILED: ${msg}`, code: 1 };
        console.error(`[${o.label ?? 'rehearse'}] ${r.outcome}`);
        return { ...r, paused: null };
    }
}
