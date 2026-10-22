// Per-trial send timing of the in-page probe, read from a browser session's Chrome frame log.
//
//   bun docs/speedrun/scripts/page-send-delays.ts <session dir> [--walk-bytes=9] [--json=PATH]
//
// The session dir is one demo-latency-probe.yml browser run's output (or rs/130's session.sh on the
// run machine): page/frames.jsonl, marks.tsv and browser-probe.json. Ticks are inbound game frames
// of 5+ bytes grouped when under 8 ms apart (demo-latency.md section 3). The probe's walk packet is
// the outbound game frame of --walk-bytes; the probe window must hold exactly one per trial, matched
// in order to browser-probe.json's result.latencies. Every other outbound frame is the client's own
// traffic, reported separately: `demo-browser-page.ts frames` mixes both in one line.
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const dir = process.argv[2];
const flag = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
if (!dir) { console.error('usage: page-send-delays.ts <session dir> [--walk-bytes=9] [--json=PATH]'); process.exit(2); }
const WALK = Number(flag('walk-bytes') ?? 9);

type Frame = { t: number; s: string; d: 'in' | 'out'; n: number };
const frames: Frame[] = readFileSync(join(dir, 'page/frames.jsonl'), 'utf8').split('\n').filter(Boolean)
    .map(l => JSON.parse(l)).filter((f: Frame) => f.s === 'game');
const mark = readFileSync(join(dir, 'marks.tsv'), 'utf8').split('\n').find(l => l.startsWith('browser-probe '));
if (!mark) throw new Error('no browser-probe span in marks.tsv');
const [, from, to] = mark.split(/\s+/).map(Number);
const latencies: number[] = JSON.parse(readFileSync(join(dir, 'browser-probe.json'), 'utf8')).result.latencies;

const ticks: number[] = [];
let last = -Infinity;
for (const f of frames) {
    if (f.d !== 'in' || f.n < 5) continue;
    if (f.t - last >= 8) ticks.push(f.t);
    last = f.t;
}
const tickOf = (t: number) => { let lo = 0, hi = ticks.length - 1, i = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (ticks[m] <= t) { i = m; lo = m + 1; } else hi = m - 1; } return i; };
const r1 = (x: number) => Math.round(x * 10) / 10;
const q = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };

const outs = frames.filter(f => f.d === 'out' && f.t >= from && f.t <= to);
const walks = outs.filter(f => f.n === WALK);
if (walks.length !== latencies.length) throw new Error(`${walks.length} outbound ${WALK}-byte frames in the probe window, ${latencies.length} trials`);
const trials = walks.map((f, trial) => {
    const i = tickOf(f.t);
    return {
        trial, ticks: latencies[trial], sendAfterTickMs: r1(f.t - ticks[i]),
        prevIntervalMs: i > 0 ? r1(ticks[i] - ticks[i - 1]) : null,
        nextIntervalMs: i + 1 < ticks.length ? r1(ticks[i + 1] - ticks[i]) : null,
    };
});
const other = outs.filter(f => f.n !== WALK).map(f => ({ bytes: f.n, afterTickMs: r1(f.t - ticks[tickOf(f.t)]) }));

const send = trials.map(t => t.sendAfterTickMs);
console.log(`walk packets (${WALK} bytes): ${trials.length}, sent after their tick p50 ${q(send, 0.5)} p90 ${q(send, 0.9)} max ${Math.max(...send)} ms`);
const sizes = [...new Set(other.map(o => o.bytes))].sort((a, b) => a - b);
for (const b of sizes) {
    const xs = other.filter(o => o.bytes === b).map(o => o.afterTickMs);
    console.log(`other outbound ${b} bytes: ${xs.length}, after tick p50 ${q(xs, 0.5)} p90 ${q(xs, 0.9)} max ${Math.max(...xs)} ms`);
}
const on = trials.filter(t => t.ticks === 1 && t.nextIntervalMs != null).map(t => t.nextIntervalMs!);
console.log(`next tick interval, on-time trials: p10 ${q(on, 0.1)} p50 ${q(on, 0.5)} (n ${on.length}); under 200 ms: ${on.filter(x => x < 200).length}`);
for (const t of trials.filter(t => t.ticks !== 1)) {
    console.log(`late trial ${t.trial}: ${t.ticks} ticks, sent ${t.sendAfterTickMs} ms after its tick, prev interval ${t.prevIntervalMs}, next ${t.nextIntervalMs}`);
}
const out = flag('json');
if (out) writeFileSync(out, JSON.stringify({ walkBytes: WALK, trials, other }, null, 1));
