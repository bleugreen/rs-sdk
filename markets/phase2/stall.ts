/**
 * The runner's stall watchdog (docs/markets/phase2.md 'Running'): an account in its method stage whose ledger coin total
 * (carried plus banked) has not moved for `ms` has its method aborted, so its stages run again from wherever it stands.
 * At most `retries` aborts while the coins stay put; after that it is flagged once and left alone. Pure: the runner
 * feeds it each account's ledger readings and asks it on its pump.
 */

export interface StallPolicy {
    /** How long the coins may stay put in the method stage; 0 turns the watchdog off. */
    ms: number;
    /** Aborts before an account is left alone. */
    retries: number;
}

export const DEFAULT_STALL: StallPolicy = { ms: 10 * 60_000, retries: 3 };

export type StallVerdict = { action: 'abort' | 'leave'; retry: number; stalledMs: number; coins: number };

export class StallWatch {
    private coins: number | null = null;
    private since = 0;
    /** Aborts since the coins last moved. */
    retries = 0;
    private left = false;

    /** A ledger reading. Off the method stage the clock stops; it restarts at the next reading in it. */
    observe(inMethod: boolean, coins: number, now: number): void {
        if (!inMethod) return this.pause();
        if (this.coins !== null && coins === this.coins) return;
        if (this.coins !== null) {
            this.retries = 0;
            this.left = false;
        }
        this.coins = coins;
        this.since = now;
    }

    /** Out of the method stage or between sessions: no clock until the next reading. The retries are kept. */
    pause(): void {
        this.coins = null;
    }

    /** Whether to abort the method now, or (once, after the retries) to flag it and leave it. */
    check(now: number, p: StallPolicy): StallVerdict | null {
        if (p.ms <= 0 || this.coins === null || this.left) return null;
        const stalledMs = now - this.since;
        if (stalledMs < p.ms) return null;
        if (this.retries >= p.retries) {
            this.left = true;
            return { action: 'leave', retry: this.retries, stalledMs, coins: this.coins };
        }
        this.retries++;
        this.since = now;
        return { action: 'abort', retry: this.retries, stalledMs, coins: this.coins };
    }
}
