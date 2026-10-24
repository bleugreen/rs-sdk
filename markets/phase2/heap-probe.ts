/**
 * Lab memory probe for the phase-2 runner (docs/markets/phase2.md 'Memory'). Preloaded into the runner by
 * `lab.ts --heap=1`, which sets PHASE2_HEAP_DIR to its --out:
 *
 *   PHASE2_HEAP_DIR=/tmp/out bun --preload ./markets/phase2/heap-probe.ts markets/phase2/run.ts <plan.json> ...
 *
 * Every minute it appends a line to $PHASE2_HEAP_DIR/memory.jsonl: process.memoryUsage(), bun:jsc's heapStats()
 * (object count, and the PHASE2_HEAP_TYPES most common object types by count) and the allocator's memoryUsage(). Every
 * PHASE2_HEAP_GC_EVERY-th line (default 5; 0 never) is taken after a full collection (`gc: true`), so what is retained
 * reads apart from garbage not yet collected. Those collections bound the garbage too, so measure a runner's RSS as
 * it runs live with 0. At each minute in PHASE2_HEAP_SNAPSHOTS (default 5,60) it also writes heap-<minute>.heapsnapshot, a V8-format
 * snapshot after a full collection, which `heap-diff.ts` compares. Nothing happens without PHASE2_HEAP_DIR.
 *
 * Writing a snapshot is not free: in rs/767's baseline the minute-5 snapshot (86 MB) was followed by a transient climb
 * to 1.6 GB RSS before the next full collection, so read the minutes after a snapshot as the probe's, not the runner's.
 */
import { heapStats, memoryUsage as allocatorUsage } from 'bun:jsc';
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.env.PHASE2_HEAP_DIR;
if (dir) {
    const snapshots = new Set((process.env.PHASE2_HEAP_SNAPSHOTS ?? '5,60').split(',').filter(Boolean).map(Number));
    const types = Number(process.env.PHASE2_HEAP_TYPES ?? 80);
    /** Every Nth line after a full collection; 0 never, which is how a live runner behaves. */
    const gcEvery = Number(process.env.PHASE2_HEAP_GC_EVERY ?? 5);
    const mb = (b: number) => Math.round((b / 1_048_576) * 10) / 10;
    let minute = 0;
    const sample = () => {
        minute++;
        const snap = snapshots.has(minute);
        const gc = snap || (gcEvery > 0 && minute % gcEvery === 0);
        let gcMs: number | null = null;
        if (gc) {
            const t = performance.now();
            Bun.gc(true);
            gcMs = Math.round(performance.now() - t);
        }
        const m = process.memoryUsage();
        const h = heapStats();
        const a = allocatorUsage();
        const line = {
            t: new Date().toISOString(),
            minute,
            gc,
            gcMs,
            rssMb: mb(m.rss),
            heapUsedMb: mb(m.heapUsed),
            heapTotalMb: mb(m.heapTotal),
            externalMb: mb(m.external),
            arrayBuffersMb: mb(m.arrayBuffers),
            jsc: { heapSizeMb: mb(h.heapSize), heapCapacityMb: mb(h.heapCapacity), extraMemoryMb: mb(h.extraMemorySize), objects: h.objectCount, protectedObjects: h.protectedObjectCount, globalObjects: h.globalObjectCount },
            allocator: { currentMb: mb(a.current), peakMb: mb(a.peak), commitMb: mb(a.currentCommit), pageFaults: a.pageFaults },
            types: Object.fromEntries(
                Object.entries(h.objectTypeCounts)
                    .sort((x, y) => y[1] - x[1])
                    .slice(0, types)
            )
        };
        appendFileSync(join(dir, 'memory.jsonl'), JSON.stringify(line) + '\n');
        if (snap) {
            const t = performance.now();
            writeFileSync(join(dir, `heap-${minute}.heapsnapshot`), Bun.generateHeapSnapshot('v8'));
            appendFileSync(join(dir, 'memory.jsonl'), JSON.stringify({ t: new Date().toISOString(), minute, snapshot: `heap-${minute}.heapsnapshot`, ms: Math.round(performance.now() - t) }) + '\n');
        }
    };
    setInterval(sample, 60_000).unref();
}
