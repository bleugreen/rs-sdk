// The run owner's side of banked mule delivery (docs/speedrun/helpers/mule-delivery.md, "Run owner"):
// the one implementation of the sequence a `deliveryRun` carrier (helpers/mule.ts) is built to
// obey, shared by run.ts's CueKeeper and lab/mule-delivery.ts. Per row R:
//   1. prepareMule(R): re-selects R and sets its carry-ahead (an identical live prepare is reused,
//      since every prepare advances seq);
//   2. readyFor(readMuleReady(...), { ..., preparationSeq }): a bounded wait that refuses with a
//      reason, never hangs;
//   3. the {R, mule} cue under session deliverySession(run, R), the only session the carrier
//      authorizes, kept fresh by the writer's owner (CueKeeper's rewrite cadence);
//   4. the trade, then the stop; only after R's stop is the carrier's next row prepared (mule.ts
//      defers a prepare that lands while the previous row still owns its cue).
// The initial hold is not here as a step: it must precede the carrier's start (a running carrier with
// no control file stages at once, and a later hold never passes heldFor), so it is `holdCarrier`,
// run by the run host before the launcher (speedrun/tools/mule-hold.ts), never by run.ts.

import { resolve } from 'path';
import { canonName, CueWriter, nameHash } from '../helpers/altar-cue';
import {
    deliverySession, holdMule, prepareMule, readMulePreparation, readMuleReady, readyFor, resumeMuleAttempt, sameWorldTile,
    type MuleHold, type MuleReady, type MuleReadyExpected, type WorldTile,
} from '../helpers/mule-readiness';
import { waitUntil, type StateSource } from '../lib/wait';

/** One delivery row on the run's path: who carries it and where it meets SCORED (mule-itinerary.ts). */
export interface DeliveryRow {
    row: string;
    account: string;
    at: WorldTile;
}

/** The readiness a row's prepare binds: readyFor's expectation with the prepare's generation. */
export type BoundReady = MuleReadyExpected & { preparationSeq: number };

/** Observed ticks a row's cue waits for its carrier's fresh readiness before refusing (4 min at 400 ms). */
export const READY_MAX_TICKS = 600;

export class DeliveryOwner {
    private readonly rows: readonly DeliveryRow[];
    private readonly bound = new Map<string, BoundReady>();

    /**
     * `rows`: the run's delivery rows in chain order (a carrier's rows are served in that order).
     * `attempts`: each carrier's runner attempt (resumeMuleAttempt), 1 when absent.
     */
    constructor(readonly dir: string, readonly runId: string, readonly receiver: string, rows: readonly DeliveryRow[], private readonly attempts: Readonly<Record<string, number>> = {}) {
        deliverySession(runId, 'validate');
        if (new Set(rows.map(r => r.row)).size !== rows.length) throw new Error('delivery rows must be unique');
        this.rows = rows.map(r => ({ ...r, at: { ...r.at } }));
    }

    has(row: string): boolean {
        return this.rows.some(r => r.row === row);
    }

    /** The only session the row's carrier authorizes (mule.ts deliveryAuthorized). */
    session(row: string): string {
        return deliverySession(this.runId, row);
    }

    private entry(row: string): DeliveryRow {
        const e = this.rows.find(r => r.row === row);
        if (!e) throw new Error(`${row} is not a delivery row of run ${this.runId}`);
        return e;
    }

    private attempt(account: string): number {
        return this.attempts[canonName(account)] ?? this.attempts[account] ?? 1;
    }

    /** The carrier's row after `row` in chain order, or null at its last. */
    next(row: string): DeliveryRow | null {
        const e = this.entry(row);
        const mine = this.rows.filter(r => canonName(r.account) === canonName(e.account));
        return mine[mine.indexOf(e) + 1] ?? null;
    }

    /** Each carrier's first row among `rows` (default: all), in chain order. */
    firstRows(rows: readonly string[] = this.rows.map(r => r.row)): DeliveryRow[] {
        const seen = new Set<string>();
        return this.rows.filter(r => rows.includes(r.row) && !seen.has(canonName(r.account)) && !!seen.add(canonName(r.account)));
    }

    /**
     * Select `row` on its carrier: this run's live prepare for exactly this row, attempt, receiver and
     * tile is reused (a resumed process, or a second call); anything else is replaced by a new prepare.
     */
    prepare(row: string): BoundReady {
        const e = this.entry(row);
        const attempt = this.attempt(e.account);
        const expected: MuleReadyExpected = { runId: this.runId, account: e.account, row, receiver: this.receiver, at: e.at };
        const live = readMulePreparation(this.dir, e.account);
        const reuse = live?.op === 'prepare' && live.runId === this.runId && live.row === row && live.attempt === attempt
            && live.session === this.session(row) && live.receiverHash === nameHash(this.receiver) && sameWorldTile(live.at, e.at);
        const seq = reuse ? live.seq : prepareMule(this.dir, { ...expected, attempt }).seq;
        const bound = { ...expected, preparationSeq: seq };
        this.bound.set(row, bound);
        return bound;
    }

    /** The readiness the row's last prepare binds, or null before its prepare. */
    expected(row: string): BoundReady | null {
        return this.bound.get(row) ?? null;
    }

    /** The carrier's status, and whether it is ready for `row` under its prepare (fresh within readyFor's 3 s). */
    ready(row: string, now = Date.now()): { ok: boolean; status: MuleReady | null } {
        const bound = this.bound.get(row);
        const status = readMuleReady(this.dir, this.entry(row).account);
        return { ok: !!bound && readyFor(status, bound, now), status };
    }

    /** Prepare `row` (or reuse its prepare) and wait, over `sdk`'s observed ticks, for its carrier's readiness. */
    async awaitReady(row: string, sdk: StateSource, o: { maxTicks?: number } = {}): Promise<MuleReady> {
        const bound = this.prepare(row);
        const maxTicks = o.maxTicks ?? READY_MAX_TICKS;
        let fault = false;
        const r = await waitUntil(sdk, () => {
            const { ok, status } = this.ready(row);
            fault = status?.phase === 'fault' && status.row === row;
            return ok || fault;
        }, { maxTicks });
        const { ok, status } = this.ready(row);
        if (ok) return status!;
        const seen = status ? `${status.row} ${status.phase}, staged ${status.staged}, preparation ${status.preparationSeq} of ${bound.preparationSeq}` : 'no readiness status';
        throw new Error(`${row}: carrier ${bound.account} ${fault ? 'reports a delivery fault' : `was not ready within ${maxTicks} ticks (${r.ok ? 'readiness expired' : r.reason})`}: ${seen}`);
    }

    /** After `row`'s stop: prepare its carrier's next row (the carry-ahead), or nothing at its last. */
    served(row: string): BoundReady | null {
        const n = this.next(row);
        return n ? this.prepare(n.row) : null;
    }

    /** The row's cue writer for SCORED under the row's delivery session (adopting a persisted one: a resumed step). */
    cueWriter(row: string): CueWriter {
        this.entry(row);
        return new CueWriter(this.dir, this.receiver, { step: row, family: 'mule' }, this.session(row));
    }
}

/**
 * The initial hold on a carrier's first row: written before the carrier's role starts (the run host,
 * before the helper launcher; the lab harness, before its role), it keeps the carrier logged in,
 * stationary and unstaged until this run's own prepare for the row.
 */
export function holdCarrier(dir: string, o: { runId: string; account: string; row: string; receiver: string; at: WorldTile; attempt?: number }): MuleHold {
    return holdMule(dir, { ...o, attempt: o.attempt ?? 1 });
}

/** A carrier's launcher entry (helpers/standalone.ts config `accounts[]`), with the options its mule role runs. */
interface LauncherEntry {
    account?: unknown;
    cueDir?: unknown;
    options?: { deliveryRun?: unknown; serve?: unknown; cueDir?: unknown; packages?: unknown };
}

/**
 * Why the run cannot own its delivery rows, or null. Every row on the path needs the run config's
 * `delivery.run` (a deliverySession token), and the carriers' launcher config must run each row's
 * carrier with that `deliveryRun`, SCORED as `serve`, the run's mule cue directory and a package
 * for the row; a carrier whose attempt this run aborted refuses too. With no delivery row, null.
 */
export function deliveryRefusal(o: {
    run: unknown;
    rows: readonly DeliveryRow[];
    receiver: string;
    dir: string;
    /** The parsed launcher config, or why it could not be read. */
    launcher: unknown;
}): string | null {
    if (!o.rows.length) return null;
    const ids = o.rows.map(r => r.row).join(', ');
    if (typeof o.run !== 'string') return `the run config gives no delivery.run, and the path has delivery rows (${ids}); a carrier refuses every other session`;
    try {
        deliverySession(o.run, 'validate');
    } catch (e) {
        return `delivery.run ${JSON.stringify(o.run)}: ${(e as Error).message}`;
    }
    if (o.launcher instanceof Error) return `the carriers' launcher config: ${o.launcher.message}`;
    const accounts = (o.launcher as { accounts?: unknown } | null)?.accounts;
    if (!Array.isArray(accounts)) return 'the carriers\' launcher config has no accounts list';
    const out: string[] = [];
    for (const r of o.rows) {
        const entry = (accounts as LauncherEntry[]).find(a => typeof a?.account === 'string' && canonName(a.account) === canonName(r.account));
        if (!entry) {
            out.push(`${r.row}: ${r.account} is not in the launcher config`);
            continue;
        }
        const opt = entry.options ?? {};
        if (opt.deliveryRun !== o.run) out.push(`${r.row}: ${r.account} runs deliveryRun ${JSON.stringify(opt.deliveryRun ?? null)}, the run config's delivery.run is ${o.run}`);
        if (typeof opt.serve !== 'string' || canonName(opt.serve) !== canonName(o.receiver)) out.push(`${r.row}: ${r.account} serves another receiver than this run's login`);
        const dir = typeof entry.cueDir === 'string' ? entry.cueDir : opt.cueDir;
        if (typeof dir !== 'string' || resolve(dir) !== resolve(o.dir)) out.push(`${r.row}: ${r.account} reads cue directory ${typeof dir === 'string' ? dir : 'none'}, the run writes ${o.dir}`);
        const packages = Array.isArray(opt.packages) ? opt.packages as { scope?: { step?: unknown; family?: unknown } }[] : [];
        if (!packages.some(p => p?.scope?.step === r.row && p.scope.family === 'mule')) out.push(`${r.row}: ${r.account} has no package for the row`);
    }
    if (out.length) return [...new Set(out)].join('; ');
    return null;
}

/** Each carrier's attempt on (re)start (resumeMuleAttempt, never an operator resume), or why one refuses. */
export function deliveryAttempts(dir: string, runId: string, accounts: readonly string[]): { attempts: Record<string, number> } | { refusal: string } {
    const attempts: Record<string, number> = {};
    try {
        for (const a of new Set(accounts.map(canonName))) attempts[a] = resumeMuleAttempt(dir, a, runId, false).attempt;
    } catch (e) {
        return { refusal: (e as Error).message };
    }
    return { attempts };
}
