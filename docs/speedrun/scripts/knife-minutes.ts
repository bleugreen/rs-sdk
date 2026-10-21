// Ticks per expected roll of an in-page knife-cycle run, split by the catch-ups of the minute each
// log fell in, read from a browser session's output (rs/130's session.sh, variant in-page-oak).
//
//   bun docs/speedrun/scripts/knife-minutes.ts <session dir> [--phases=knife,plain] [--chance=32,100]
//       [--level=N] [--limit=2] [--json=PATH]
//
// Per log: the harness polls a compact view of the program's logTail every 3 s (`<phase>-full.log`
// progress lines {t, r, x: ["T611 xp", "T623 level 48", ...]}), so every xp event has its game tick.
// Each poll also pairs a wall time with the program's tick, which maps ticks to wall time. Ticks on
// the page are inbound game frames of 5+ bytes grouped when under 8 ms apart (page-send-delays.ts);
// a catch-up is an interval < 150 ms right after one > 350 ms, a soft pair one < 250 ms after one
// > 350 ms (demo-latency.md section 7). Each wall-clock minute is calm when its catch-ups, scaled to a
// full minute, are at most --limit. Each gap between consecutive logs belongs to the minute of the log
// that ends it, and is weighted by 1/p at that log's level, p(L) = stat_random(L, lo, hi) from
// --chance (the tree's successchance for the axe: oak with a bronze axe 32,100; normal tree 64,200).
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const dir = process.argv[2];
const flag = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
if (!dir) { console.error('usage: knife-minutes.ts <session dir> [--phases=knife,plain] [--chance=32,100] [--level=N] [--limit=2] [--json=PATH]'); process.exit(2); }
const phases = (flag('phases') ?? 'knife,plain').split(',');
const [lo, hi] = (flag('chance') ?? '32,100').split(',').map(Number) as [number, number];
const LIMIT = Number(flag('limit') ?? 2);
const p = (L: number) => Math.min(1, (Math.floor((lo * (99 - L)) / 98) + Math.floor((hi * (L - 1)) / 98) + 1) / 256);
const r2 = (x: number) => Math.round(x * 100) / 100;

type Frame = { t: number; s: string; d: 'in' | 'out'; n: number };
const ticks: number[] = [];
let lastIn = -Infinity;
for (const l of readFileSync(join(dir, 'page/frames.jsonl'), 'utf8').split('\n')) {
    if (!l) continue;
    const f: Frame = JSON.parse(l);
    if (f.s !== 'game' || f.d !== 'in' || f.n < 5) continue;
    if (f.t - lastIn >= 8) ticks.push(f.t);
    lastIn = f.t;
}
const iv = ticks.slice(1).map((t, i) => t - ticks[i]!);
// Wall time of each catch-up and soft pair: the arrival that ends the short interval.
const catchUps: number[] = [], softs: number[] = [];
for (let i = 1; i < iv.length; i++) {
    if (iv[i - 1]! > 350 && iv[i]! < 150) catchUps.push(ticks[i + 1]!);
    if (iv[i - 1]! > 350 && iv[i]! < 250) softs.push(ticks[i + 1]!);
}
const within = (xs: number[], a: number, b: number) => xs.filter(x => x > a && x <= b).length;

let level = Number(flag('level') ?? readFileSync(join(dir, 'knife-full.log'), 'utf8').match(/woodcutting (\d+)/)?.[1] ?? NaN);
const report: Record<string, unknown> = { chance: [lo, hi], limit: LIMIT };
for (const phase of phases) {
    const polls: Array<{ wall: number; t: number }> = [];
    const events = new Map<number, { xp: boolean; level?: number }>();
    for (const l of readFileSync(join(dir, `${phase}-full.log`), 'utf8').split('\n')) {
        const m = l.match(/^(\S+Z) (progress|result) (\{.*\})\s*$/);
        if (!m) continue;
        let j: any;
        try { j = JSON.parse(m[3]!); } catch { continue; }
        const entries: string[] = j.x ?? j.logTail ?? [];
        if (typeof j.t === 'number') polls.push({ wall: Date.parse(m[1]!), t: j.t });
        else if (typeof j.tick === 'number') polls.push({ wall: Date.parse(m[1]!), t: j.tick });
        for (const e of entries) {
            const x = e.match(/^T(\d+) (xp|level (\d+))/);
            if (!x) continue;
            const t = Number(x[1]);
            const ev = events.get(t) ?? { xp: false };
            if (x[2] === 'xp') ev.xp = true; else ev.level = Number(x[3]);
            events.set(t, ev);
        }
    }
    if (polls.length < 2) { console.log(`${phase}: no progress polls`); continue; }
    const wallOf = (t: number) => {
        let i = polls.findIndex(q => q.t >= t);
        if (i <= 0) i = i === 0 ? 1 : polls.length - 1;
        const a = polls[i - 1]!, b = polls[i]!;
        return b.t === a.t ? a.wall : a.wall + ((t - a.t) * (b.wall - a.wall)) / (b.t - a.t);
    };
    // A level line shares the tick of the xp that raised it, so a log is weighted at the level it was cut at.
    const logs: Array<{ tick: number; level: number; wall: number }> = [];
    for (const [t, ev] of [...events].sort((a, b) => a[0] - b[0])) {
        if (ev.xp) logs.push({ tick: t, level, wall: wallOf(t) });
        if (ev.level) level = ev.level;
    }
    const minuteOf = (w: number) => Math.floor(w / 60000) * 60000;
    const t0 = logs[0]?.wall ?? 0, t1 = logs[logs.length - 1]?.wall ?? 0;
    const minutes = new Map<number, { catchUps: number; softs: number; spanMs: number; rate: number; calm: boolean }>();
    for (let m = minuteOf(t0); m <= t1; m += 60000) {
        const a = Math.max(m, t0), b = Math.min(m + 60000, t1);
        const c = within(catchUps, a, b), s = within(softs, a, b);
        const rate = b > a ? (c * 60000) / (b - a) : 0;
        minutes.set(m, { catchUps: c, softs: s, spanMs: b - a, rate: r2(rate), calm: rate <= LIMIT });
    }
    const gaps = logs.slice(1).map((g, i) => {
        const prev = logs[i]!;
        const min = minutes.get(minuteOf(g.wall))!;
        return { ticks: g.tick - prev.tick, level: g.level, expRolls: 1 / p(g.level), calm: min.calm,
            catchUpsInGap: within(catchUps, prev.wall, g.wall), softsInGap: within(softs, prev.wall, g.wall) };
    });
    const sum = (xs: typeof gaps) => {
        const t = xs.reduce((a, g) => a + g.ticks, 0), r = xs.reduce((a, g) => a + g.expRolls, 0);
        return { logs: xs.length, ticks: t, perLog: r2(t / xs.length), expRolls: r2(r), perExpectedRoll: r2(t / r) };
    };
    const all = sum(gaps), calm = sum(gaps.filter(g => g.calm)), busy = sum(gaps.filter(g => !g.calm));
    const hist: Record<string, number> = {};
    for (const g of gaps) hist[g.ticks] = (hist[g.ticks] ?? 0) + 1;
    const levels = logs.length ? `${logs[0]!.level}-${logs[logs.length - 1]!.level}` : '?';
    console.log(`${phase}: ${logs.length} logs stamped (${polls.length} polls), Woodcutting ${levels}, p ${r2(p(logs[0]?.level ?? 1))}-${r2(p(logs[logs.length - 1]?.level ?? 1))}`);
    console.log(`  all:              ${all.logs} gaps, ${all.perLog} ticks per log, ${all.perExpectedRoll} per expected roll (Σ1/p ${all.expRolls})`);
    console.log(`  catch-ups <= ${LIMIT}/min: ${calm.logs} gaps, ${calm.perLog} per log, ${calm.perExpectedRoll} per expected roll`);
    console.log(`  catch-ups >  ${LIMIT}/min: ${busy.logs} gaps, ${busy.perLog} per log, ${busy.perExpectedRoll} per expected roll`);
    console.log(`  minutes: ${[...minutes].map(([m, v]) => `${new Date(m).toISOString().slice(11, 16)}Z ${v.catchUps} catch-ups in ${Math.round(v.spanMs / 1000)} s (${v.rate}/min, ${v.calm ? 'calm' : 'busy'})`).join('; ')}`);
    console.log(`  gap histogram (ticks:count): ${Object.entries(hist).map(([k, v]) => `${k}:${v}`).join(' ')}`);
    for (const [label, test] of [['gaps of 3', (g: typeof gaps[0]) => g.ticks === 3], ['longer gaps', (g: typeof gaps[0]) => g.ticks > 3]] as const) {
        const xs = gaps.filter(test);
        console.log(`  ${label}: ${xs.length}; with a catch-up inside ${xs.filter(g => g.catchUpsInGap).length}, with a soft pair inside ${xs.filter(g => g.softsInGap).length}`);
    }
    report[phase] = { levels, all, calm, busy, histogram: hist, minutes: Object.fromEntries([...minutes].map(([m, v]) => [new Date(m).toISOString(), v])), logs, gaps };
}
const out = flag('json');
if (out) writeFileSync(out, JSON.stringify(report, null, 1));
