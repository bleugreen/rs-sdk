/**
 * The public demo's HTTP origin and a gentle request gate for every markets/ reader.
 *
 * The SDK's market client wants the game's HTTP origin, but bots know only the gateway URL; speedrun/lib's
 * demoOrigin() is the one place that maps a SERVER value (host, host:port or ws(s) gateway URL) to it.
 * Everything here derives its origin from that, so a lab world works by passing its SERVER value.
 */
import { demoOrigin } from '../../speedrun/lib/demo-status.ts';

export const DEMO_SERVER = 'rs-sdk-demo.fly.dev';
export const DEMO_ORIGIN = demoOrigin(DEMO_SERVER);
export const USER_AGENT = 'rs-sdk-markets-research (+https://github.com/bleugreen/rs-sdk)';
/** One-off reads stay at least this far apart (tenet 28: a request every few seconds at most). */
export const MIN_INTERVAL_MS = 3_000;

export class HttpError extends Error {
    constructor(
        readonly status: number,
        readonly path: string
    ) {
        super(`${path}: HTTP ${status}`);
        this.name = 'HttpError';
    }
}

/** A 4xx other than 429 is an answer, not a hiccup: retrying it only adds load. */
export const retryable = (e: unknown): boolean => !(e instanceof HttpError) || e.status === 429 || e.status >= 500;

export interface GentleOptions {
    /** A bot.env SERVER value or an http(s) origin; default the public demo. */
    server?: string;
    minIntervalMs?: number;
    attempts?: number;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
}

/** Serialises requests at least `minIntervalMs` apart and retries transient failures with backoff. */
export class Gentle {
    readonly origin: string;
    readonly minIntervalMs: number;
    requests = 0;
    private last = Number.NEGATIVE_INFINITY;
    private readonly attempts: number;
    private readonly timeoutMs: number;
    private readonly fetchImpl: typeof fetch;
    private readonly sleep: (ms: number) => Promise<void>;
    private readonly now: () => number;

    constructor(opts: GentleOptions = {}) {
        this.origin = demoOrigin(opts.server ?? DEMO_SERVER);
        this.minIntervalMs = opts.minIntervalMs ?? MIN_INTERVAL_MS;
        this.attempts = opts.attempts ?? 4;
        this.timeoutMs = opts.timeoutMs ?? 30_000;
        // Resolved per call so a test's stub of the global fetch is honoured.
        this.fetchImpl = opts.fetchImpl ?? (((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init)) as typeof fetch);
        this.sleep = opts.sleep ?? (ms => Bun.sleep(ms));
        this.now = opts.now ?? Date.now;
    }

    /** Runs `call` in its turn, retrying failures `canRetry` allows with exponential backoff. */
    async pace<T>(label: string, call: () => Promise<T>, canRetry: (e: unknown) => boolean = retryable): Promise<T> {
        let lastError: unknown;
        for (let attempt = 1; attempt <= this.attempts; attempt++) {
            const wait = this.last + this.minIntervalMs - this.now();
            if (wait > 0) await this.sleep(wait);
            this.last = this.now();
            this.requests++;
            try {
                return await call();
            } catch (e) {
                if (!canRetry(e)) throw e;
                lastError = e;
            }
            if (attempt < this.attempts) await this.sleep(1000 * 2 ** attempt);
        }
        throw new Error(`${label}: gave up after ${this.attempts} attempts (${lastError instanceof Error ? lastError.message : String(lastError)})`);
    }

    text(path: string): Promise<string> {
        return this.pace(path, async () => {
            const res = await this.fetchImpl(this.origin + path, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(this.timeoutMs) });
            if (!res.ok) throw new HttpError(res.status, path);
            return await res.text();
        });
    }

    async json<T>(path: string): Promise<T> {
        return JSON.parse(await this.text(path)) as T;
    }
}
