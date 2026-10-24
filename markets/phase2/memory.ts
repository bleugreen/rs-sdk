/**
 * The runner's own memory, for its totals line (docs/markets/phase2.md 'Memory'): resident set, the JS heap in use, and
 * the memory held outside it (buffers, native objects). MB to one decimal.
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
