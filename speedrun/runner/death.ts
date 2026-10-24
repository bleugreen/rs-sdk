// What the run does about a death a logout saw (lib/session.ts logoutClean's LogoutWatch, which
// records it on the logout's result and on Session.died). run.ts writes one `(death)` row, ends the
// attempt with EXIT_DIED, and refuses any later run into the same log, a walk from game state and a
// --from alike, until the operator names that death with --r8-recovered after R8's recovery: a
// resume from the respawn would otherwise go on as if nothing had happened.

import { annotation, type AttemptResult } from '../lib/attempt';
import type { LogoutDeath, LogoutResult } from '../lib/session';
import type { TickLog, TickRow } from '../lib/ticks';

export const DEATH_STEP = '(death)';
export const DEATH_ACK_STEP = '(death) acknowledged';

/** run.ts's exit when SCORED died before a logout landed. Not 4: a stop is resumed by running again, a death is not. */
export const EXIT_DIED = 6;

export const R8_RECOVERY = "R8's recovery (RUN-HOST.md 'After a player-kill': the manual procedure, or rs/527's recover-now once it is on the floor)";

/** What --r8-recovered takes to acknowledge the death a `(death)` row records. */
export function deathKey(row: Pick<TickRow, 'runId' | 'startTick'>): string {
    return `${row.runId}@${row.startTick}`;
}

export function deathRow(log: Pick<TickLog, 'runId'>, account: string, sessionId: number, d: LogoutDeath, logout?: LogoutResult): TickRow {
    const { reason, ...seen } = d;
    return annotation(log, account, 'note', DEATH_STEP, {
        sessionId, startTick: d.tick, ok: false, error: reason,
        meta: {
            ...seen,
            ...(logout ? { logout: { ok: logout.ok, clickTick: logout.clickTick, lastInWorldTick: logout.lastInWorldTick, ...(logout.reason ? { reason: logout.reason } : {}), ...(logout.held ? { held: logout.held } : {}) } } : {}),
        },
    });
}

export function operatorLine(row: Pick<TickRow, 'runId' | 'startTick'>): string {
    return `${R8_RECOVERY}, then run again with --r8-recovered=${deathKey(row)}`;
}

/** The attempt's result once SCORED has died, whatever the chain itself ended with. */
export function diedResult(row: TickRow, before: AttemptResult): AttemptResult {
    return { outcome: `DIED: ${row.error} (the chain had ended: ${before.outcome}). Next: ${operatorLine(row)}`, code: EXIT_DIED, paused: null };
}

/**
 * The start's death gate over the log's earlier rows: refused while a `(death)` row stands that no
 * `(death) acknowledged` row covers, unless `ack` (--r8-recovered) names the latest such death, in
 * which case every open one is acknowledged. An `ack` with nothing open is refused too, so a flag left
 * on a command line never acknowledges a later death.
 */
export function deathGate(rows: readonly TickRow[], ack?: string): { refusal: string } | { acknowledge: string[] } {
    const acked = new Set(rows.filter(r => r.step === DEATH_ACK_STEP).flatMap(r => (r.meta?.keys as string[] | undefined) ?? []));
    const open = rows.filter(r => r.step === DEATH_STEP && !acked.has(deathKey(r)));
    const last = open.at(-1);
    if (!last) return ack === undefined ? { acknowledge: [] } : { refusal: `--r8-recovered=${ack} names no unacknowledged death in this log` };
    if (ack === deathKey(last)) return { acknowledge: open.map(deathKey) };
    return {
        refusal: `${last.error ?? 'SCORED died'}. A run from here would resume from the respawn as if nothing happened`
            + `${ack !== undefined ? ` (--r8-recovered=${ack} does not name it)` : ''}. Do ${operatorLine(last)}`,
    };
}

/** The row an acknowledged start writes, so later runs into the log pass the gate. */
export function ackRow(log: Pick<TickLog, 'runId'>, account: string, keys: readonly string[]): TickRow {
    return annotation(log, account, 'gate', DEATH_ACK_STEP, { meta: { keys: [...keys], recovery: 'R8' } });
}
