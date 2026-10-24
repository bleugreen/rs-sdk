/**
 * The runner's memory and load (docs/markets/phase2.md 'Memory'): its own figures for the totals line, and two workarounds that
 * take what sdk/ and the lite client hold per process and per login down to what they use.
 *
 * - The SDK pathfinder imports sdk/collision-data.json (27.5 MB) as a module and reads it once, in initPathfinding()
 *   behind its `initialized` guard. The module's default and named exports keep the parsed 1.27M tile arrays alive for
 *   the life of the process anyway: ~235 MB of RSS that nothing reads. `initPathfindingAndRelease` builds the grid, then
 *   empties those arrays in place (a module binding can't be reassigned from outside).
 * - The lite session (server/webclient/src/lite/session.ts startSession) calls LocIndex.load at every login, which
 *   reads the 14 MB disk cache into a fresh copy, though LocIndex is read-only and meant to be shared by every bot in the
 *   process. `shareLocIndex` makes the load return one copy per versionlist CRC.
 *
 * Both belong in sdk/ and the lite client; until they move there, the runner calls these at its start.
 */
export interface MemoryLine {
    rssMb: number;
    heapUsedMb: number;
    externalMb: number;
    arrayBuffersMb: number;
}

const mb = (b: number) => Math.round((b / 1_048_576) * 10) / 10;

export function memoryLine(m: Pick<NodeJS.MemoryUsage, 'rss' | 'heapUsed' | 'external' | 'arrayBuffers'> = process.memoryUsage()): MemoryLine {
    return { rssMb: mb(m.rss), heapUsedMb: mb(m.heapUsed), externalMb: mb(m.external), arrayBuffersMb: mb(m.arrayBuffers) };
}

export interface LoadLine {
    /** CPU time over wall time since the last read, % of one core (every account's JS runs on one thread). */
    cpuPct: number;
    /** How late a 100 ms timer fired since the last read: the delay any account's reaction to a tick waits behind. */
    lagP50Ms: number;
    lagP99Ms: number;
    lagMaxMs: number;
    /** Full collections the runner forced since the last read (`--gc-seconds`), and the longest. */
    gcs?: number;
    gcMaxMs?: number;
}

/** Lag samples kept between reads; a read empties them. Past this the max still counts. */
const LAG_KEEP = 6_000;

/** The runner's load for its totals line: CPU share and event-loop lag (a timer's drift), each since the last read. */
export class LoadMeter {
    private lags: number[] = [];
    private lagMax = 0;
    private last: number;
    private cpu: { user: number; system: number };
    private wall: number;
    private readonly timer: ReturnType<typeof setInterval>;
    private readonly gcTimer: ReturnType<typeof setInterval> | null = null;
    private gcs = 0;
    private gcMax = 0;

    constructor(
        private readonly everyMs = 100,
        private readonly now: () => number = () => performance.now(),
        private readonly cpuUsage: () => { user: number; system: number } = () => process.cpuUsage(),
        /** Force a full collection this often (0: never), see `collect`. */
        private readonly gcEveryMs = 0,
        private readonly gc: () => void = () => Bun.gc(true)
    ) {
        this.last = this.wall = now();
        this.cpu = cpuUsage();
        this.timer = setInterval(() => this.tick(), everyMs);
        this.timer.unref?.();
        if (gcEveryMs > 0) {
            this.gcTimer = setInterval(() => this.collect(), gcEveryMs);
            this.gcTimer.unref?.();
        }
    }

    /**
     * One forced full collection. Each account's published state is serialised and parsed every tick (thousands of
     * objects with the bank open), and JSC let that garbage reach ~1.5 GB of heap between its own collections in the
     * lab; a full collection over the ~300k live objects takes ~30 ms (docs/markets/phase2.md 'Memory').
     */
    collect(): void {
        const t = this.now();
        this.gc();
        this.gcs++;
        this.gcMax = Math.max(this.gcMax, this.now() - t);
    }

    /** @internal The timer's callback: one drift sample. */
    tick(): void {
        const t = this.now();
        const lag = Math.max(0, t - this.last - this.everyMs);
        this.last = t;
        this.lagMax = Math.max(this.lagMax, lag);
        if (this.lags.length < LAG_KEEP) this.lags.push(lag);
    }

    get held(): number {
        return this.lags.length;
    }

    read(): LoadLine {
        const t = this.now();
        const c = this.cpuUsage();
        const wallUs = (t - this.wall) * 1000;
        const cpuPct = wallUs > 0 ? Math.round(((c.user - this.cpu.user + c.system - this.cpu.system) / wallUs) * 1000) / 10 : 0;
        const sorted = [...this.lags].sort((a, b) => a - b);
        const at = (q: number) => (sorted.length ? Math.round(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!) : 0);
        const line: LoadLine = { cpuPct, lagP50Ms: at(0.5), lagP99Ms: at(0.99), lagMaxMs: Math.round(this.lagMax), ...(this.gcEveryMs > 0 ? { gcs: this.gcs, gcMaxMs: Math.round(this.gcMax) } : {}) };
        this.lags = [];
        this.lagMax = 0;
        this.gcs = 0;
        this.gcMax = 0;
        this.cpu = c;
        this.wall = t;
        return line;
    }

    stop(): void {
        clearInterval(this.timer);
        if (this.gcTimer) clearInterval(this.gcTimer);
    }
}

/** Empty every array property of `source` in place; returns how many entries were dropped. */
export function emptyArrays(source: Record<string, unknown>): number {
    let n = 0;
    for (const v of Object.values(source)) {
        if (!Array.isArray(v)) continue;
        n += v.length;
        v.length = 0;
    }
    return n;
}

/**
 * Build the SDK pathfinder's grid, then release the collision JSON it was built from. Returns the entries dropped (0 when
 * already released). The pathfinder never reads the JSON again in this process.
 */
export async function initPathfindingAndRelease(): Promise<number> {
    (await import('../../sdk/pathfinding')).initPathfinding();
    // computed, as speedrun/lib/direct.ts loads the lite client: the type checker never parses the 27.5 MB file
    const json = (await import(new URL('../../sdk/collision-data.json', import.meta.url).href)) as { default: Record<string, unknown> };
    return emptyArrays(json.default);
}

export interface LocIndexOptions {
    origin: string;
    cacheDir: string;
    versionlistCrc: number;
    quiet?: boolean;
}

export interface LocIndexLoader {
    load(opts: LocIndexOptions): Promise<unknown>;
}

const SHARED = Symbol.for('markets.phase2.sharedLocIndex');

/**
 * Make `loader.load` return one promise per (origin, cache dir, versionlist CRC). A new CRC (the server's maps repacked)
 * drops the old copy; a failed load is not kept, so the next login tries again. Idempotent.
 */
export function shareLoads(loader: LocIndexLoader): void {
    if ((loader.load as unknown as Record<symbol, unknown>)[SHARED]) return;
    const load = loader.load.bind(loader);
    let held: { key: string; index: Promise<unknown> } | null = null;
    const shared = (opts: LocIndexOptions): Promise<unknown> => {
        const key = `${opts.origin} ${opts.cacheDir} ${opts.versionlistCrc >>> 0}`;
        if (held?.key === key) return held.index;
        const index = load(opts);
        const entry = { key, index };
        held = entry;
        index.catch(() => {
            if (held === entry) held = null;
        });
        return index;
    };
    loader.load = Object.assign(shared, { [SHARED]: true });
}

const LITE = new URL('../../server/webclient/src/lite/', import.meta.url);

/** One LocIndex for every lite session this process starts (the same module instance session.ts imports). */
export async function shareLocIndex(): Promise<void> {
    const { LocIndex } = (await import(new URL('world/LocIndex.ts', LITE).href)) as { LocIndex: LocIndexLoader };
    shareLoads(LocIndex);
}
