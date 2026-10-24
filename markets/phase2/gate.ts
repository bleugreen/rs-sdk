/**
 * The login gate: every login the phase-2 runner makes from its address asks here first. Pure; the clock is
 * passed in.
 *
 * Rules (docs/markets/scaling-limits.md):
 * - Never start a login for an account whose previous login has not answered. A second request while the login
 *   server still holds the first is refused with code 16 (row 4); the demo's code 16 sightings were such retries
 *   (rs/519). An attempt that ended without an answer (the socket dropped first) holds the account for
 *   `unansweredHoldMs`, the bound on how long the login server keeps a request.
 * - Hold sessions, pending logins included, at or below `maxSessions`, the plan's count.
 * - Space login starts `spacingMs` apart, and after a refusal leave the account (or, for code 7, the address)
 *   alone for the code's hold: 16 s for code 16 (the device limiter's window, should production ever be on),
 *   15 s for code 5 (the takeover throttle is 10 s), 60 s for code 7 (the address or the world is full).
 * - After `maxRefusals` refusals in a row the account is given up.
 */

export type GateState = 'out' | 'pending' | 'in' | 'failed';

export interface GatePolicy {
    maxSessions: number;
    spacingMs: number;
    unansweredHoldMs: number;
    /** Hold after a refusal, by login response code. */
    refusedHoldMs: Readonly<Record<number, number>>;
    otherRefusedHoldMs: number;
    /** Codes whose hold applies to every account (the address is full). */
    addressCodes: readonly number[];
    /** Hold after a session ends, before the same account logs in again. */
    endedHoldMs: number;
    maxRefusals: number;
}

export const DEFAULT_POLICY: GatePolicy = {
    maxSessions: 45,
    spacingMs: 2_000,
    unansweredHoldMs: 60_000,
    refusedHoldMs: { 16: 16_000, 5: 15_000, 7: 60_000 },
    otherRefusedHoldMs: 30_000,
    addressCodes: [7],
    endedHoldMs: 2_000,
    maxRefusals: 5
};

export type LoginAnswer = { ok: true } | { ok: false; code: number };

export type GateVerdict = { ok: true } | { ok: false; reason: string; /** epoch ms worth asking again at; Infinity: not until something changes */ retryAt: number };

interface Entry {
    state: GateState;
    since: number;
    /** Not before this time (a hold after a refusal, an unanswered attempt or an ended session). */
    holdUntil: number;
    refusals: number;
    attempts: number;
}

export class LoginGate {
    private readonly accounts = new Map<string, Entry>();
    private lastStart = Number.NEGATIVE_INFINITY;
    private addressHoldUntil = Number.NEGATIVE_INFINITY;

    constructor(readonly policy: GatePolicy = DEFAULT_POLICY) {}

    private entry(account: string): Entry {
        let e = this.accounts.get(account);
        if (!e) {
            e = { state: 'out', since: 0, holdUntil: Number.NEGATIVE_INFINITY, refusals: 0, attempts: 0 };
            this.accounts.set(account, e);
        }
        return e;
    }

    state(account: string): GateState {
        return this.entry(account).state;
    }

    /** Sessions held now: logins in flight and accounts in the world. */
    sessions(): { pending: number; inWorld: number } {
        let pending = 0;
        let inWorld = 0;
        for (const e of this.accounts.values()) {
            if (e.state === 'pending') pending++;
            else if (e.state === 'in') inWorld++;
        }
        return { pending, inWorld };
    }

    /** Whether `account` may start a login now. Pure: `tryStart` is what takes the place. */
    check(account: string, now: number): GateVerdict {
        const e = this.entry(account);
        if (e.state === 'pending') return { ok: false, reason: 'its previous login has not answered', retryAt: Infinity };
        if (e.state === 'in') return { ok: false, reason: 'already in the world', retryAt: Infinity };
        if (e.state === 'failed') return { ok: false, reason: `given up after ${e.refusals} refusals`, retryAt: Infinity };
        if (now < e.holdUntil) return { ok: false, reason: 'held after its last attempt', retryAt: e.holdUntil };
        if (now < this.addressHoldUntil) return { ok: false, reason: 'the address is held after a code 7', retryAt: this.addressHoldUntil };
        const { pending, inWorld } = this.sessions();
        if (pending + inWorld >= this.policy.maxSessions) return { ok: false, reason: `${pending + inWorld} sessions is the plan's ${this.policy.maxSessions}`, retryAt: Infinity };
        if (now < this.lastStart + this.policy.spacingMs) return { ok: false, reason: 'spacing logins', retryAt: this.lastStart + this.policy.spacingMs };
        return { ok: true };
    }

    /** Take the place if `check` allows: the account is pending until `answered` or `unanswered`. */
    tryStart(account: string, now: number): GateVerdict {
        const v = this.check(account, now);
        if (!v.ok) return v;
        const e = this.entry(account);
        e.state = 'pending';
        e.since = now;
        e.attempts++;
        this.lastStart = now;
        return v;
    }

    /** The server answered the login. */
    answered(account: string, answer: LoginAnswer, now: number): void {
        const e = this.entry(account);
        if (e.state !== 'pending') throw new Error(`answered: ${account} has no login in flight (${e.state})`);
        e.since = now;
        if (answer.ok) {
            e.state = 'in';
            e.refusals = 0;
            return;
        }
        e.refusals++;
        const hold = this.policy.refusedHoldMs[answer.code] ?? this.policy.otherRefusedHoldMs;
        e.holdUntil = now + hold;
        if (this.policy.addressCodes.includes(answer.code)) this.addressHoldUntil = Math.max(this.addressHoldUntil, now + hold);
        e.state = e.refusals >= this.policy.maxRefusals ? 'failed' : 'out';
    }

    /** The attempt ended with no answer from the server (the connection failed first). */
    unanswered(account: string, now: number): void {
        const e = this.entry(account);
        if (e.state !== 'pending') throw new Error(`unanswered: ${account} has no login in flight (${e.state})`);
        e.state = 'out';
        e.since = now;
        e.holdUntil = now + this.policy.unansweredHoldMs;
    }

    /** A session that was in the world has ended (a logout, or the server dropped it). */
    ended(account: string, now: number): void {
        const e = this.entry(account);
        if (e.state !== 'in') return;
        e.state = 'out';
        e.since = now;
        e.holdUntil = now + this.policy.endedHoldMs;
    }

    /** Never log this account in again. */
    giveUp(account: string): void {
        const e = this.entry(account);
        if (e.state === 'out') e.state = 'failed';
    }
}
