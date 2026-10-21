// Retry pacing for the fleet supervisor: per-account exponential backoff that
// forgets old failures once something has stayed up, a fleet-wide login rate
// limit, and what each login refusal from the server means for both.

export interface BackoffPolicy {
    initialMs: number;
    maxMs: number;
    /** A run that lasted at least this long counts as healthy and resets the sequence. */
    resetAfterMs: number;
    /** Multiplier per consecutive failure (default 2). */
    factor?: number;
    /** Random extra delay as a fraction of the base delay, so a fleet that fell over together does not retry in lockstep (default 0.5). */
    jitter?: number;
}

/** Delay before retry number `attempt` (0-based), before jitter. */
export function backoffDelay(attempt: number, policy: BackoffPolicy): number {
    const factor = policy.factor ?? 2;
    return Math.min(policy.maxMs, policy.initialMs * factor ** Math.max(0, attempt));
}

export class Backoff {
    private attempt = 0;

    constructor(
        private readonly policy: BackoffPolicy,
        private readonly random: () => number = Math.random
    ) {}

    /**
     * Record a failure of a run that started at `startedAt` and return how long
     * to wait before the next one. A run that survived resetAfterMs is not part
     * of a failure streak, so the wait starts over from initialMs.
     */
    failure(startedAt: number | null, now: number): number {
        if (startedAt !== null && now - startedAt >= this.policy.resetAfterMs) this.attempt = 0;
        const base = backoffDelay(this.attempt, this.policy);
        this.attempt++;
        return Math.round(base + base * (this.policy.jitter ?? 0.5) * this.random());
    }

    reset(): void {
        this.attempt = 0;
    }

    get failures(): number {
        return this.attempt;
    }
}

export interface LoginLimitPolicy {
    /** Sustained logins per minute, fleet-wide. */
    perMinute: number;
    /** Logins allowed back to back before the sustained rate applies. */
    burst: number;
    /** Never two logins closer than this. */
    minSpacingMs: number;
}

/**
 * Fleet-wide login rate limit: a token bucket (`burst` tokens, refilled at
 * `perMinute`) plus a minimum spacing, shared by first logins and re-logins.
 * The demo's login server answers a burst with "Too many login attempts", and
 * a network blip or a world restart drops every account at once, so the fleet
 * must come back gradually. Callers are served in arrival order. `pause()`
 * holds every login until a time, for refusals that are about the server or
 * the IP rather than one account.
 */
export class LoginLimiter {
    private tokens: number;
    private updatedAt: number;
    private lastGrant = Number.NEGATIVE_INFINITY;
    private pausedUntil = 0;

    constructor(
        private policy: LoginLimitPolicy,
        private readonly now: () => number = Date.now,
        private readonly sleep: (ms: number) => Promise<void> = ms => new Promise(r => setTimeout(r, ms))
    ) {
        this.tokens = policy.burst;
        this.updatedAt = now();
    }

    setPolicy(policy: LoginLimitPolicy): void {
        this.policy = policy;
        this.tokens = Math.min(this.tokens, policy.burst);
    }

    pause(untilMs: number): void {
        this.pausedUntil = Math.max(this.pausedUntil, untilMs);
    }

    get pausedUntilMs(): number {
        return this.pausedUntil;
    }

    /** Book the next login slot and return its absolute time. */
    reserve(): number {
        const ratePerMs = this.policy.perMinute / 60_000;
        let at = Math.max(this.now(), this.updatedAt, this.lastGrant + this.policy.minSpacingMs, this.pausedUntil);
        let tokens = Math.min(this.policy.burst, this.tokens + (at - this.updatedAt) * ratePerMs);
        if (tokens < 1) {
            at += Math.ceil((1 - tokens) / ratePerMs - 1e-6); // the epsilon absorbs float error, not real time
            tokens = 1;
        }
        this.tokens = tokens - 1;
        this.updatedAt = at;
        this.lastGrant = at;
        return at;
    }

    /** Wait for a login slot. A pause that began while waiting sends the caller back to the queue. */
    async take(): Promise<void> {
        for (;;) {
            const wait = this.reserve() - this.now();
            if (wait > 0) await this.sleep(wait);
            if (this.now() >= this.pausedUntil) return;
        }
    }
}

export interface LoginFailurePolicy {
    /** This account waits at least this long before its next attempt. */
    accountDelayMs: number;
    /** Every login in the fleet waits this long. */
    fleetPauseMs: number;
    /** Retrying cannot fix it soon; a person should look. */
    needsAttention: boolean;
}

/**
 * What a login refusal (the engine's login response code, see LOGIN_RESPONSE in
 * server/webclient/src/lite/net/GameConnection.ts) means for retrying. `streak`
 * counts consecutive refusals with the same code for this account.
 */
export function loginFailurePolicy(code: number, streak = 1): LoginFailurePolicy {
    const n = Math.max(1, streak);
    switch (code) {
        case 9: // login limit exceeded
        case 16: // too many login attempts: back off hard, and slow everybody
            return { accountDelayMs: Math.min(20 * 60_000, 5 * 60_000 * 2 ** (n - 1)), fleetPauseMs: 2 * 60_000, needsAttention: false };
        case 7: // world full
        case 8: // login server offline
        case 13: // could not complete login
        case 14: // server being updated
            return { accountDelayMs: 60_000, fleetPauseMs: 60_000, needsAttention: false };
        case 3: // invalid username or password
        case 4: // account disabled
        case 18: // account locked
            return { accountDelayMs: 30 * 60_000, fleetPauseMs: 0, needsAttention: true };
        default: // 5 (already logged in: the engine holds a dropped session ~10 s) and anything else
            return { accountDelayMs: 0, fleetPauseMs: 0, needsAttention: false };
    }
}
