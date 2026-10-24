// The run's relog budget and the one relog lock, shared by speedrun/run.ts and the operator's
// speedrun/tools/relog-now.ts (rs/511).
//
// Every relog SCORED makes is a login the per-address order and the playtime see, so the run allows a
// fixed number: the planned S21 relog (runner/scored-relog.ts) and UNPLANNED_RELOGS more, whoever
// makes them: run.ts after a dropped session (runner/drop-relog.ts) or the operator by hand. Each one
// is an entry in <run dir>/relogs.json with the step and tick it happened at. run.ts's start gate
// reads it, so a resumed run starts with what the earlier sessions spent.
//
// An adopt (run.ts finds the page still in the world, ticking, with no login sent) is recorded too,
// as kind 'adopt', and never charged: SCORED never left the world, so nothing was spent. Only real
// logins count.
//
// The lock (<run dir>/relog.lock, created exclusively) is the race rule: whoever holds it is the only
// one logging SCORED in. run.ts takes it before its own relog and never starts one while the operator
// holds it; it waits for the operator's to finish and adopts the session it finds. A lock whose
// process is gone is stale and is broken by the next taker. relog-now and run.ts run on the same host
// (the run tab's DevTools is loopback only), so a pid check is enough.

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

export const RELOGS_FILE = 'relogs.json';
export const RELOG_LOCK = 'relog.lock';
/** The planned relogs: S21's (runner/scored-relog.ts). */
export const PLANNED_RELOGS = 1;
/** Relogs after a dropped session, run.ts's and the operator's together. */
export const UNPLANNED_RELOGS = 3;

/**
 * planned: a chain step's own relog. unplanned: run.ts's login after a drop. manual: the operator's
 * (relog-now). adopt: run.ts found the page back in the world with no login of its own; never charged.
 */
export type RelogKind = 'planned' | 'unplanned' | 'manual' | 'adopt';
/** The kinds that are a login and spend the budget. */
export type ChargedKind = Exclude<RelogKind, 'adopt'>;
export type RelogBy = 'run' | 'operator';

export interface RelogEntry {
    kind: RelogKind;
    by: RelogBy;
    /** The chain step it happened in (null: none known, an operator relog outside the run). */
    step: string | null;
    /** The client tick before the relog (-1: none known). */
    tick: number;
    /** ISO time it was recorded. */
    at: string;
    /** page: in-page login; launch: the tab navigated to a token URL; adopted: found back in the world. */
    via: 'page' | 'launch' | 'adopted';
    /** Anything the relog measured (the logout's sends and ticks, the login's wall ms). */
    meta?: Record<string, unknown>;
    /**
     * A planned relog split across two steps (S21: the logout half before the givers' pre-login, the
     * login half after it): true from the logout half's record until the login half closes it.
     * The account is meant to be out meanwhile, which is never a drop.
     */
    open?: boolean;
}

export interface RelogsFile {
    v: 1;
    entries: RelogEntry[];
}

export interface RelogLimits {
    planned: number;
    unplanned: number;
}

export interface RelogLockInfo {
    by: RelogBy;
    pid: number;
    at: string;
}

export type LockResult = { ok: true; release: () => void } | { ok: false; holder: RelogLockInfo };

export class RelogBudgetSpent extends Error {
    override name = 'RelogBudgetSpent';
}

/** Whether process `pid` is alive on this host (a signal-0 probe; EPERM means it exists). */
export function pidAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (e) {
        return (e as NodeJS.ErrnoException).code === 'EPERM';
    }
}

export class RelogBudget {
    readonly file: string;
    readonly lockFile: string;

    constructor(
        readonly dir: string,
        readonly limits: RelogLimits = { planned: PLANNED_RELOGS, unplanned: UNPLANNED_RELOGS },
        private readonly alive: (pid: number) => boolean = pidAlive,
        private readonly pid: number = process.pid
    ) {
        this.file = join(dir, RELOGS_FILE);
        this.lockFile = join(dir, RELOG_LOCK);
    }

    /** The recorded relogs, read from disk each time: the other process writes too. */
    entries(): RelogEntry[] {
        if (!existsSync(this.file)) return [];
        try {
            const f = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<RelogsFile>;
            return Array.isArray(f.entries) ? f.entries : [];
        } catch {
            throw new Error(`${this.file} does not parse: fix or remove it before the run goes on`);
        }
    }

    /** The logins spent; adopts are not among them. */
    used(): RelogLimits {
        const e = this.entries();
        return { planned: e.filter(x => x.kind === 'planned').length, unplanned: e.filter(x => x.kind === 'unplanned' || x.kind === 'manual').length };
    }

    /** The adopts recorded (uncharged). */
    adopts(): number {
        return this.entries().filter(x => x.kind === 'adopt').length;
    }

    /** Whether the planned relog of `step` is recorded and closed (scored-relog.ts's `done`; the login half's). */
    hasPlanned(step: string): boolean {
        return this.entries().some(e => e.kind === 'planned' && e.step === step && !e.open);
    }

    /** The planned relog of `step`: null when none, 'open' between its logout and login halves, else 'closed'. */
    planned(step: string): 'open' | 'closed' | null {
        const e = this.entries().find(x => x.kind === 'planned' && x.step === step);
        return e ? (e.open ? 'open' : 'closed') : null;
    }

    /** The open planned relog, if any: the account is out on purpose between its halves. */
    openPlanned(): RelogEntry | null {
        return this.entries().find(e => e.kind === 'planned' && e.open) ?? null;
    }

    /** The logout half of a split planned relog: one planned entry, open (the logout half's `done`). */
    beginPlanned(step: string, tick: number, meta: Record<string, unknown> = {}): RelogEntry {
        if (this.planned(step)) throw new Error(`the planned relog ${step} is already recorded`);
        return this.record({ kind: 'planned', by: 'run', step, tick, via: 'page', open: true, meta: { logout: meta } });
    }

    /** The login half: closes the open entry of `step` with how it got in; the same one planned relog. */
    endPlanned(step: string, via: RelogEntry['via'], meta: Record<string, unknown> = {}): RelogEntry {
        const all = this.entries();
        const i = all.findIndex(e => e.kind === 'planned' && e.step === step && e.open);
        if (i < 0) throw new Error(`no open planned relog ${step} to close`);
        const closed: RelogEntry = { ...all[i]!, via, open: false, meta: { ...all[i]!.meta, login: meta, closedAt: new Date().toISOString() } };
        this.write([...all.slice(0, i), closed, ...all.slice(i + 1)]);
        return closed;
    }

    /**
     * Rewrite the recorded `entry` (matched on its time, kind, maker, step and tick) with `patch`; its
     * time stays. One login counted once: an adopted session that fell out again and was relogged is
     * the adopt's entry, now the relog's.
     */
    amend(entry: RelogEntry, patch: Partial<Omit<RelogEntry, 'at'>>): RelogEntry {
        const all = this.entries();
        const i = all.findIndex(e => e.at === entry.at && e.kind === entry.kind && e.by === entry.by && e.step === entry.step && e.tick === entry.tick);
        if (i < 0) throw new Error(`no ${entry.kind} relog recorded at ${entry.at} to amend`);
        const next: RelogEntry = { ...all[i]!, ...patch, at: all[i]!.at };
        this.write([...all.slice(0, i), next, ...all.slice(i + 1)]);
        return next;
    }

    /** true when one more relog of `kind` is within the budget, else why not. */
    check(kind: ChargedKind): true | string {
        const u = this.used();
        if (kind === 'planned') return u.planned < this.limits.planned || `the planned relogs are spent (${u.planned}/${this.limits.planned})`;
        return u.unplanned < this.limits.unplanned || `relog budget spent: ${u.unplanned}/${this.limits.unplanned} unplanned relogs used (${this.describe()})`;
    }

    describe(): string {
        const u = this.used();
        const adopts = this.adopts();
        return `planned ${u.planned}/${this.limits.planned}, unplanned ${u.unplanned}/${this.limits.unplanned}${adopts ? `, ${adopts} adopt${adopts === 1 ? '' : 's'} uncharged` : ''}`;
    }

    record(entry: Omit<RelogEntry, 'at'> & { at?: string }): RelogEntry {
        const full: RelogEntry = { ...entry, at: entry.at ?? new Date().toISOString() };
        this.write([...this.entries(), full]);
        return full;
    }

    private write(entries: RelogEntry[]): void {
        const file: RelogsFile = { v: 1, entries };
        mkdirSync(this.dir, { recursive: true });
        const tmp = `${this.file}.${this.pid}.tmp`;
        writeFileSync(tmp, JSON.stringify(file, null, 2) + '\n', { mode: 0o600 });
        renameSync(tmp, this.file);
    }

    /** The lock's holder, or null when it is free; a holder whose process is gone is removed. */
    holder(): RelogLockInfo | null {
        if (!existsSync(this.lockFile)) return null;
        let info: RelogLockInfo | null = null;
        try {
            info = JSON.parse(readFileSync(this.lockFile, 'utf8')) as RelogLockInfo;
        } catch {
            info = null;
        }
        if (info && typeof info.pid === 'number' && this.alive(info.pid)) return info;
        rmSync(this.lockFile, { force: true });
        return null;
    }

    /** Take the lock (exclusive create), breaking a stale one first. */
    tryLock(by: RelogBy): LockResult {
        const held = this.holder();
        if (held) return { ok: false, holder: held };
        mkdirSync(this.dir, { recursive: true });
        const info: RelogLockInfo = { by, pid: this.pid, at: new Date().toISOString() };
        try {
            writeFileSync(this.lockFile, JSON.stringify(info) + '\n', { flag: 'wx', mode: 0o600 });
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
            const h = this.holder();
            return { ok: false, holder: h ?? info };
        }
        let released = false;
        return {
            ok: true,
            release: () => {
                if (released) return;
                released = true;
                const now = this.holder();
                if (now && now.pid === this.pid && now.at === info.at) rmSync(this.lockFile, { force: true });
            },
        };
    }

    /** A fresh run (no log, no --from): the earlier run's relogs and lock do not count. */
    clear(): void {
        rmSync(this.file, { force: true });
        rmSync(this.lockFile, { force: true });
    }
}
