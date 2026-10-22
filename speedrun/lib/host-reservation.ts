// The host reservation and the claim it runs under (docs/speedrun/rehearsals/HOST.md, 'Run-capable
// twin' and 'Claims'): read before every login and at every logout-safe boundary by any harness that
// logs an account into the twin (speedrun/rehearse.ts, speedrun/run.ts).

import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

/**
 * The host reservation (docs/speedrun/rehearsals/HOST.md, 'Run-capable twin' and 'Claims'): one
 * JSON object `{"owner", "until", "reason"}`, which host's claim lock `rs-claim` writes for every
 * holder (it adds logins, what, taken, touched; a preempt makes host the owner and records the
 * holder it displaced under `displaced.owner`). It is live while `until` is in the future. While a
 * live one is not the attempt's own claim (claimOwner()), no attempt or claim starts, and an attempt
 * in flight logs out at its next logout-safe boundary and does not restart.
 */
export const RESERVATION_FILE = 'host-reserved.json';
/** Overrides the default path ($HOME/host-reserved.json); --host-reservation overrides both. */
export const RESERVATION_ENV = 'SPEEDRUN_HOST_RESERVATION';
/** Exit code: refused at pre-flight, or paused mid-attempt, because the host is reserved. */
export const EXIT_HOST_RESERVED = 5;

/** The rs-claim owner the attempt runs under when --claim-owner is not given. */
export const CLAIM_OWNER_ENV = 'SPEEDRUN_CLAIM_OWNER';

export interface HostReservation {
    owner: string;
    until: string;
    reason: string;
    /** A preempt: the holder whose claim host's replaced (rs-claim's `displaced.owner`). */
    displaced?: string;
}

export type ReservationState =
    | { state: 'none' }
    | { state: 'expired'; reservation: HostReservation }
    | { state: 'live'; reservation: HostReservation }
    | { state: 'malformed'; error: string };

export function reservationPath(flag?: string, env: Readonly<Record<string, string | undefined>> = process.env): string {
    return flag ?? env[RESERVATION_ENV] ?? join(env.HOME ?? homedir(), RESERVATION_FILE);
}

/** --claim-owner, else $SPEEDRUN_CLAIM_OWNER; undefined: the attempt runs under no claim of its own. */
export function claimOwner(flag?: string, env: Readonly<Record<string, string | undefined>> = process.env): string | undefined {
    const v = (flag ?? env[CLAIM_OWNER_ENV] ?? '').trim();
    return v || undefined;
}

/** The file's text (null: no file) at `now`. Malformed: not a JSON object, or an `until` that is not a time. */
export function judgeReservation(text: string | null, now: number): ReservationState {
    if (text === null) return { state: 'none' };
    let o: unknown;
    try {
        o = JSON.parse(text);
    } catch (e) {
        return { state: 'malformed', error: `not JSON (${e instanceof Error ? e.message : e})` };
    }
    if (!o || typeof o !== 'object' || Array.isArray(o)) return { state: 'malformed', error: 'not a JSON object' };
    const r = o as Record<string, unknown>;
    const until = typeof r.until === 'string' ? Date.parse(r.until) : Number.NaN;
    if (!Number.isFinite(until)) return { state: 'malformed', error: `"until" is not a time (${JSON.stringify(r.until ?? null)})` };
    const d = r.displaced as Record<string, unknown> | null | undefined;
    const displaced = d && typeof d === 'object' && typeof d.owner === 'string' ? d.owner : undefined;
    const reservation: HostReservation = { owner: String(r.owner ?? '?'), until: r.until as string, reason: String(r.reason ?? ''), ...(displaced ? { displaced } : {}) };
    return until > now ? { state: 'live', reservation } : { state: 'expired', reservation };
}

export function readReservation(path: string, now: number = Date.now()): ReservationState {
    let text: string | null;
    try {
        text = readFileSync(path, 'utf-8');
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') return { state: 'malformed', error: `unreadable (${e instanceof Error ? e.message : e})` };
        text = null;
    }
    return judgeReservation(text, now);
}

export function reservationText(r: HostReservation): string {
    return `${r.owner} until ${r.until}${r.reason ? ` (${r.reason})` : ''}${r.displaced ? `, preempting ${r.displaced}` : ''}`;
}

/** One `rs-claim touch OWNER`: its exit code (null: it did not finish in time, or could not start) and output. */
export interface ClaimTouch {
    code: number | null;
    out: string;
}
export type ClaimToucher = (owner: string) => Promise<ClaimTouch>;
/** rs-claim's exit code for a touch by a holder host has preempted. */
export const TOUCH_PREEMPTED = 3;
export const TOUCH_TIMEOUT_MS = 10_000;
/** At most one touch per this, however close the boundaries fall. */
export const TOUCH_EVERY_MS = 60_000;

/** rs-claim on PATH, else $HOME/.local/bin/rs-claim, else null (not installed: nothing is touched). */
export function claimBin(env: Readonly<Record<string, string | undefined>> = process.env): string | null {
    const onPath = env.PATH ? Bun.which('rs-claim', { PATH: env.PATH }) : null;
    if (onPath) return onPath;
    const home = join(env.HOME ?? homedir(), '.local', 'bin', 'rs-claim');
    return existsSync(home) ? home : null;
}

/** Runs `<bin> touch OWNER`, killed after `timeoutMs`. Never throws. */
export function claimToucher(bin: string, timeoutMs = TOUCH_TIMEOUT_MS): ClaimToucher {
    return async owner => {
        try {
            const p = Bun.spawn([bin, 'touch', owner], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
            const kill = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
            try {
                const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
                const text = `${out}${err}`.trim();
                return p.signalCode ? { code: null, out: text || `no answer in ${timeoutMs / 1000} s` } : { code: p.exitCode, out: text };
            } finally {
                clearTimeout(kill);
            }
        } catch (e) {
            return { code: null, out: `could not run ${bin}: ${e instanceof Error ? e.message : e}` };
        }
    };
}

/**
 * Reads the file afresh on every check; each distinct warning prints once. With `owner`, that
 * owner's claim is the attempt's own: live, it blocks nothing; stale, it warns and blocks nothing
 * (nobody else holds the machine). Any other live owner blocks, and a preempt of ours is host's.
 */
export class ReservationWatch {
    private readonly warned = new Set<string>();
    private touching: Promise<void> | null = null;
    private lastTouchAt = Number.NEGATIVE_INFINITY;
    private preempted: string | null = null;
    constructor(
        readonly path: string,
        private readonly opts: {
            now?: () => number;
            warn?: (msg: string) => void;
            /** The rs-claim owner the attempt runs under. */
            owner?: string;
            /** Renews the claim at boundaries (with `owner`); exit 3 is host's preempt. */
            touch?: ClaimToucher | null;
            touchEveryMs?: number;
            /** The caller's tag on its warnings (default 'rehearse'). */
            label?: string;
        } = {}
    ) {}

    get owner(): string | undefined {
        return this.opts.owner;
    }

    private now(): number {
        return this.opts.now ? this.opts.now() : Date.now();
    }

    private warnOnce(key: string, msg: string): void {
        if (this.warned.has(key)) return;
        this.warned.add(key);
        (this.opts.warn ?? console.warn)(`[${this.opts.label ?? 'rehearse'}] WARNING: ${msg}`);
    }

    /** What keeps a login from starting now: a live reservation that is not our claim, or null. */
    check(): HostReservation | null {
        const s = readReservation(this.path, this.now());
        const owner = this.opts.owner;
        if (s.state === 'malformed') {
            this.warnOnce(`malformed:${s.error}`, `${this.path} is malformed, so it is not a live reservation: ${s.error}`);
            return null;
        }
        if (s.state === 'none') {
            if (owner) this.warnOnce('none', `no claim in ${this.path}, though the attempt runs under ${owner}'s: take it (rs-claim take ${owner} ...) before an attempt`);
            return null;
        }
        const r = s.reservation;
        const ours = owner !== undefined && r.owner === owner;
        if (s.state === 'expired') {
            if (ours) this.warnOnce(`stale:${r.until}`, `our claim went stale (${reservationText(r)}); nobody else holds the machine, so the attempt goes on: renew it (rs-claim touch ${owner}) or take it again`);
            return null;
        }
        return ours ? null : r;
    }

    /**
     * At a logout-safe step boundary: a preempt the last touch reported, else check(). While the
     * claim is ours it starts the next touch in the background (the runner's stop hook is
     * synchronous, and a touch can wait on rs-claim's lock), so its answer counts at a later boundary.
     */
    boundary(): HostReservation | null {
        if (this.preempted !== null) {
            const s = readReservation(this.path, this.now());
            if (s.state === 'live' && s.reservation.owner !== this.opts.owner) return s.reservation;
            return { owner: 'host', until: new Date(this.now()).toISOString(), reason: `rs-claim touch exited ${TOUCH_PREEMPTED}: ${this.preempted}`, ...(this.opts.owner ? { displaced: this.opts.owner } : {}) };
        }
        const r = this.check();
        if (!r) this.startTouch();
        return r;
    }

    /** Resolves once the touch in flight (if any) has been accounted for. */
    settled(): Promise<void> {
        return this.touching ?? Promise.resolve();
    }

    private startTouch(): void {
        const { owner, touch } = this.opts;
        if (!owner || !touch || this.touching) return;
        const t = this.now();
        if (t - this.lastTouchAt < (this.opts.touchEveryMs ?? TOUCH_EVERY_MS)) return;
        this.lastTouchAt = t;
        this.touching = touch(owner)
            .then(r => {
                if (r.code === TOUCH_PREEMPTED) this.preempted = r.out || 'PREEMPTED';
                else if (r.code !== 0) this.warnOnce(`touch:${r.code}:${r.out}`, `rs-claim touch ${owner} ${r.code === null ? 'did not answer' : `exited ${r.code}`}${r.out ? `: ${r.out}` : ''}; the claim file is still read at every boundary`);
            })
            .catch(e => this.warnOnce(`touch:${e}`, `rs-claim touch ${owner} failed: ${e instanceof Error ? e.message : e}`))
            .finally(() => {
                this.touching = null;
            });
    }
}

/** Pre-flight, and before each login: why nothing may log in, or null to go. */
export function reservationRefusal(watch: ReservationWatch): string | null {
    const r = watch.check();
    if (!r) return null;
    const whose = watch.owner ? (r.displaced === watch.owner ? `, which preempts our claim (${watch.owner})` : `, not our claim (${watch.owner})`) : '';
    return `the host is reserved by ${reservationText(r)} (${watch.path})${whose}: no attempt or claim starts while it is live; run again once it is gone or expired`;
}
