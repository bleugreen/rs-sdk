/**
 * The runner's memory (docs/markets/phase2.md 'Memory'): its own figures for the totals line, and two workarounds that
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
