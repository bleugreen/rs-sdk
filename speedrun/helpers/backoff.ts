// Retry pacing for the fleet supervisor: exponential backoff that forgets old
// failures once something has stayed up, and a gate that spaces logins out
// across the whole fleet.

export interface BackoffPolicy {
    initialMs: number;
    maxMs: number;
    /** A run that lasted at least this long counts as healthy and resets the sequence. */
    resetAfterMs: number;
    /** Multiplier per consecutive failure (default 2). */
    factor?: number;
    /** Random extra delay as a fraction of the base delay, so a fleet that fell over together does not retry in lockstep (default 0.2). */
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
        return Math.round(base + base * (this.policy.jitter ?? 0.2) * this.random());
    }

    reset(): void {
        this.attempt = 0;
    }

    get failures(): number {
        return this.attempt;
    }
}

/**
 * Serialises logins: each `turn()` resolves no sooner than `spacingMs` after the
 * previous one did. The engine and the demo's login server see one fleet, so a
 * world restart that drops every account must not turn into a burst of
 * simultaneous re-logins.
 */
export class LoginGate {
    private nextAt = 0;

    constructor(
        private spacingMs: number,
        private readonly now: () => number = Date.now,
        private readonly sleep: (ms: number) => Promise<void> = ms => new Promise(r => setTimeout(r, ms))
    ) {}

    setSpacing(ms: number): void {
        this.spacingMs = ms;
    }

    /** Reserve the next login slot and wait for it. Returns the wait in ms. */
    async turn(): Promise<number> {
        const now = this.now();
        const at = Math.max(now, this.nextAt);
        this.nextAt = at + this.spacingMs;
        const wait = at - now;
        if (wait > 0) await this.sleep(wait);
        return wait;
    }
}
