// Post-hoc analysis of demo-latency-probe.ts JSON files (docs/speedrun/research/demo-latency.md).
//
//   bun docs/speedrun/scripts/demo-latency-analyze.ts [--window-min=3] [--p90=400] [--max=600] file.json...
//
// 1. Overrun attribution: for the react trials at +0 ms, the share that missed the next tick when
//    the next tick interval (trigger frame to the following frame) was under 200 ms, against the
//    share otherwise. The engine schedules ticks on a fixed 300 ms grid with up to two ticks of
//    catch-up (World.ts cycle()), so a long tick is followed by one that starts almost at once,
//    leaving no idle gap for a reaction to the long tick.
// 2. Steadiness gate: over every rolling window of --window-min minutes of tick arrivals (react
//    session frames, or sample phase frames), whether the tick interval p90 <= --p90 and max <=
//    --max. Reports the share of windows that pass.
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (k: string, d: number) => Number(args.find(a => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
const WIN = opt('window-min', 3) * 60_000;
const P90 = opt('p90', 400);
const MAX = opt('max', 600);
const files = args.filter(a => !a.startsWith('--'));

/** Tick arrival times from raw [t, bytes] messages: messages under 60 ms apart are one tick. */
function tickTimes(raw: [number, number][]): number[] {
    const out: number[] = [];
    let last = -Infinity;
    for (const [t] of raw) {
        if (t - last >= 60) out.push(t);
        last = t;
    }
    return out;
}
const q = (xs: number[], p: number) => {
    const a = [...xs].sort((u, v) => u - v);
    return a[Math.min(a.length - 1, Math.floor(p * a.length))] ?? NaN;
};

const agg = { short: { n: 0, miss: 0 }, other: { n: 0, miss: 0 }, windows: 0, pass: 0 };
for (const f of files) {
    const r = JSON.parse(readFileSync(f, 'utf8'));
    const lines: string[] = [`${f}: ${r.label} ${r.startedPdt} PDT, online ${r.playercountStart}-${r.playercountEnd}`];
    const trials = (r.react?.trials ?? []).filter((t: any) => t.delay === 0 && t.ticks !== 99);
    const short = { n: 0, miss: 0 };
    const other = { n: 0, miss: 0 };
    for (const t of trials) {
        if (t.nextIntervalMs === null || t.nextIntervalMs === undefined) continue;
        const b = t.nextIntervalMs < 200 ? short : other;
        b.n++;
        if (t.ticks > 1) b.miss++;
    }
    agg.short.n += short.n; agg.short.miss += short.miss; agg.other.n += other.n; agg.other.miss += other.miss;
    if (short.n + other.n) lines.push(`  +0 ms trials: next interval < 200 ms: ${short.miss}/${short.n} missed; otherwise: ${other.miss}/${other.n} missed`);
    for (const [name, raw] of [['react session', r.react?.frames?.raw], ['sample phase', r.sample?.frames?.raw]] as const) {
        if (!raw?.length) continue;
        const ts = tickTimes(raw);
        let windows = 0;
        let pass = 0;
        // windows start every 30 s
        for (let w0 = ts[0]!; w0 + WIN <= ts.at(-1)!; w0 += 30_000) {
            const iv: number[] = [];
            for (let i = 1; i < ts.length; i++) if (ts[i - 1]! >= w0 && ts[i]! <= w0 + WIN) iv.push(ts[i]! - ts[i - 1]!);
            if (iv.length < 10) continue;
            windows++;
            if (q(iv, 0.9) <= P90 && Math.max(...iv) <= MAX) pass++;
        }
        agg.windows += windows; agg.pass += pass;
        lines.push(`  ${name}: ${ts.length} ticks; ${WIN / 60_000}-min windows passing p90<=${P90} and max<=${MAX}: ${pass}/${windows}`);
    }
    console.log(lines.join('\n'));
}
console.log(`ALL: +0 ms misses with next interval < 200 ms ${agg.short.miss}/${agg.short.n}; otherwise ${agg.other.miss}/${agg.other.n}; gate windows passing ${agg.pass}/${agg.windows}`);
