// Ticks per expected roll of an in-page knife-cycle run, split by the catch-ups of the minute each
// log fell in, read from a browser session's output (session.sh in data/browser-rows/host-scripts,
// variant in-page-oak).
//
//   bun docs/speedrun/scripts/knife-minutes.ts <session dir> [--phases=knife,plain] [--chance=32,100]
//       [--level=N] [--limit=2] [--soft=400,225] [--json=PATH]
//
// Stamps. On a page at main c14428fc or later the harness polls knife-cycle's status every 2.5 s:
// {t, n, k, pr, sl, rs, lu, sw} = the program's tick, marks.successes' count and its last 12 ticks
// (stamp i of k is success number n - k.length + 1 + i), and the counters phaseResyncs, slips,
// resyncs, levelUps and switches. Older sessions (rs/130) carry xp and level lines instead ({t, r, x}
// polls and the result's logTail); both are read. Each poll pairs a wall time with the program's
// tick, which maps ticks to wall time.
//
// Levels. A log is weighted at the level it was rolled at. With logTail level lines the level-up's
// tick is exact; otherwise each rise of the levelUps counter between two polls is put on the first
// log in that window (exact when the window holds one log, the usual case at a 2.5 s poll).
//
// Minutes. Ticks on the page are inbound game frames of 5+ bytes grouped when under 8 ms apart
// (page-send-delays.ts). A catch-up is an interval < 150 ms right after one > 350 ms (the gate's
// (c), demo-latency.md section 10); a soft pair one < --soft[1] ms after one > --soft[0] ms (section 9,
// 'Miss rate by the next tick interval'). Each gap between consecutive logs belongs to the log that
// ends it, and is classed two ways: by the wall-clock minute of that log (calm when the minute's
// catch-ups, scaled to a full minute, are at most --limit), and by the catch-ups in the 60 s before
// it (what the in-run monitor sees). Each gap is weighted by 1/p at that log's level,
// p(L) = stat_random(L, lo, hi) from --chance (oak with a bronze axe 32,100; normal tree 64,200).
//
// Resyncs. An off-phase roll (phaseResyncs) fires on an xp tick, so it belongs to a log. A gap of
// 21+ ticks whose end log is no phase resync is an honest miss run; a 4-tick gap or a gap ending in a
// phase resync is timing. `slips` counts the 'resync (no xp)' re-locks.
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const dir = process.argv[2];
const flag = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
if (!dir) { console.error('usage: knife-minutes.ts <session dir> [--phases=knife,plain] [--chance=32,100] [--level=N] [--limit=2] [--soft=400,225] [--json=PATH]'); process.exit(2); }
const phases = (flag('phases') ?? 'knife,plain').split(',');
const [lo, hi] = (flag('chance') ?? '32,100').split(',').map(Number) as [number, number];
const [softLong, softShort] = (flag('soft') ?? '400,225').split(',').map(Number) as [number, number];
const LIMIT = Number(flag('limit') ?? 2);
const p = (L: number) => Math.min(1, (Math.floor((lo * (99 - L)) / 98) + Math.floor((hi * (L - 1)) / 98) + 1) / 256);
const r2 = (x: number) => Math.round(x * 100) / 100;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

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
    if (iv[i - 1]! > softLong && iv[i]! < softShort) softs.push(ticks[i + 1]!);
}
const within = (xs: number[], a: number, b: number) => xs.filter(x => x > a && x <= b).length;

let level = Number(flag('level') ?? readFileSync(join(dir, 'knife-full.log'), 'utf8').match(/woodcutting (\d+)/)?.[1] ?? NaN);
const report: Record<string, unknown> = { chance: [lo, hi], limit: LIMIT, soft: [softLong, softShort], pageTicks: ticks.length, catchUps: catchUps.length, softs: softs.length };

type Poll = { wall: number; t: number; n?: number; pr?: number; sl?: number; rs?: number; lu?: number; sw?: number; fc?: number; fu?: number; fo?: number; fn?: number };
const BINS = [['0-2', 2], ['2-5', 5], ['5-10', 10], ['over 10', Infinity]] as const;
const binOf = (rate: number) => BINS.find(([, top]) => rate <= top)![0];
for (const phase of phases) {
    const polls: Poll[] = [];
    const stamps = new Map<number, number>(); // success number (1-based) -> tick
    const events = new Map<number, { xp: boolean; level?: number }>(); // logTail / old-format lines
    let final: any = null;
    let text: string;
    try { text = readFileSync(join(dir, `${phase}-full.log`), 'utf8'); } catch { console.log(`${phase}: no log`); continue; }
    // The log's result line is cut at 4000 characters; <phase>.json holds the whole final status.
    try {
        const whole = readFileSync(join(dir, `${phase}.json`), 'utf8').trim();
        const at = text.match(/^(\S+Z) result /m)?.[1];
        if (at) text = text.replace(/^\S+Z result .*$/m, '') + `\n${at} result ${whole}\n`;
    } catch { /* no json: the log's line it is */ }
    for (const l of text.split('\n')) {
        const m = l.match(/^(\S+Z) (progress|result) (\{.*\})\s*$/);
        if (!m) continue;
        let j: any;
        try { j = JSON.parse(m[3]!); } catch { continue; }
        const wall = Date.parse(m[1]!);
        if (m[2] === 'result') {
            final = j;
            if (typeof j.tick === 'number') polls.push({ wall, t: j.tick, n: j.marks?.successes?.count, pr: j.counters?.phaseResyncs ?? 0, sl: j.counters?.slips ?? 0, rs: j.counters?.resyncs ?? 0, lu: j.counters?.levelUps ?? 0, sw: j.counters?.switches ?? 0,
                fc: j.frames?.catchUps, fu: j.frames?.under150, fo: j.frames?.over350, fn: j.frames?.n });
            const mk = j.marks?.successes;
            if (mk) mk.ticks.forEach((t: number, i: number) => stamps.set(mk.count - mk.ticks.length + 1 + i, t));
        } else if (Array.isArray(j.k)) {
            if (j.ph && j.ph !== 'running') continue;
            polls.push({ wall, t: j.t, n: j.n, pr: j.pr, sl: j.sl, rs: j.rs, lu: j.lu, sw: j.sw, fc: j.fc, fu: j.fu, fo: j.fo, fn: j.fn });
            j.k.forEach((t: number, i: number) => stamps.set(j.n - j.k.length + 1 + i, t));
        } else if (typeof j.t === 'number') polls.push({ wall, t: j.t });
        for (const e of (j.x ?? j.logTail ?? []) as string[]) {
            const x = e.match(/^T(\d+) (xp|level (\d+))/);
            if (!x) continue;
            const t = Number(x[1]);
            const ev = events.get(t) ?? { xp: false };
            if (x[2] === 'xp') ev.xp = true; else ev.level = Number(x[3]);
            events.set(t, ev);
        }
    }
    polls.sort((a, b) => a.wall - b.wall);
    if (polls.length < 2) { console.log(`${phase}: no progress polls`); continue; }
    const wallOf = (t: number) => {
        let i = polls.findIndex(q => q.t >= t);
        if (i <= 0) i = i === 0 ? 1 : polls.length - 1;
        const a = polls[i - 1]!, b = polls[i]!;
        return b.t === a.t ? a.wall : a.wall + ((t - a.t) * (b.wall - a.wall)) / (b.t - a.t);
    };
    const startLevel = level;
    type Log = { n: number; tick: number; level: number; wall: number; phaseResync: boolean };
    const logs: Log[] = [];
    let missed = 0;
    if (stamps.size) {
        const ns = [...stamps.keys()].sort((a, b) => a - b);
        for (let i = ns[0]!; i <= ns[ns.length - 1]!; i++) if (!stamps.has(i)) missed++;
        missed += ns[0]! - 1;
        for (const n of ns) logs.push({ n, tick: stamps.get(n)!, level, wall: wallOf(stamps.get(n)!), phaseResync: false });
        // Counter rises between consecutive polls land on the first logs of that window.
        const counted = polls.filter(q => q.lu !== undefined);
        const levelUpAt = new Set<number>();
        for (let i = 1; i < counted.length; i++) {
            const a = counted[i - 1]!, b = counted[i]!;
            const inWin = logs.filter(g => g.tick > a.t && g.tick <= b.t);
            for (let k = 0; k < (b.pr ?? 0) - (a.pr ?? 0) && k < inWin.length; k++) inWin[k]!.phaseResync = true;
            for (let k = 0; k < (b.lu ?? 0) - (a.lu ?? 0) && k < inWin.length; k++) levelUpAt.add(inWin[k]!.tick);
        }
        // logTail's exact level-up ticks replace the inferred ones they cover.
        const exact = [...events].filter(([, ev]) => ev.level).map(([t]) => t);
        if (exact.length) {
            const from = Math.min(...[...events.keys()]);
            for (const t of [...levelUpAt]) if (t >= from) levelUpAt.delete(t);
            for (const t of exact) levelUpAt.add(t);
        }
        for (const g of logs) {
            g.level = level;
            if (levelUpAt.has(g.tick)) level++;
        }
    } else {
        // rs/130's format: xp and level lines; a level line shares the tick of the xp that raised it.
        for (const [t, ev] of [...events].sort((a, b) => a[0] - b[0])) {
            if (ev.xp) logs.push({ n: logs.length + 1, tick: t, level, wall: wallOf(t), phaseResync: false });
            if (ev.level) level = ev.level;
        }
    }
    // The program's catch-ups (from each PLAYER_INFO message's arrival, glued pairs included), when
    // the polls carry them: each rise between two polls is spread evenly over that window. Otherwise
    // the page's frame groups, which merge glued pairs and can split one tick's frames in two.
    const fcPolls = polls.filter(q => typeof q.fc === 'number' && q.wall >= (polls[0]?.wall ?? 0));
    const progCatchUps: number[] = [];
    for (let i = 1; i < fcPolls.length; i++) {
        const a = fcPolls[i - 1]!, b = fcPolls[i]!, d = b.fc! - a.fc!;
        for (let k = 1; k <= d; k++) progCatchUps.push(a.wall + ((b.wall - a.wall) * k) / (d + 1));
    }
    const source = fcPolls.length >= 2 ? 'program' : 'page frames';
    const cu = source === 'program' ? progCatchUps : catchUps;
    const pageInRun = within(catchUps, polls[0]!.wall, polls[polls.length - 1]!.wall);
    const minuteOf = (w: number) => Math.floor(w / 60000) * 60000;
    const t0 = logs[0]?.wall ?? 0, t1 = logs[logs.length - 1]?.wall ?? 0;
    const minutes = new Map<number, { catchUps: number; softs: number; spanMs: number; rate: number; softRate: number; calm: boolean }>();
    for (let m = minuteOf(t0); m <= t1; m += 60000) {
        const a = Math.max(m, t0), b = Math.min(m + 60000, t1);
        const c = within(cu, a, b), s = within(softs, a, b);
        const rate = b > a ? (c * 60000) / (b - a) : 0;
        minutes.set(m, { catchUps: c, softs: s, spanMs: b - a, rate: r2(rate), softRate: r2(b > a ? (s * 60000) / (b - a) : 0), calm: rate <= LIMIT });
    }
    const gaps = logs.slice(1).map((g, i) => {
        const prev = logs[i]!;
        const min = minutes.get(minuteOf(g.wall))!;
        const ticks = g.tick - prev.tick;
        // Plain swings every 4 ticks, so a 4-tick gap is its cadence, not a timing slip.
        const kind = g.phaseResync || (ticks === 4 && phase !== 'plain') ? 'timing' : ticks >= 21 ? 'honest' : 'other';
        return { ticks, level: g.level, p: r3(p(g.level)), expRolls: 1 / p(g.level), calm: min.calm, bin: binOf(min.rate), contiguous: g.n === prev.n + 1,
            trailing60: within(cu, g.wall - 60000, g.wall), trailingSoft60: within(softs, g.wall - 60000, g.wall),
            catchUpsInGap: within(cu, prev.wall, g.wall), softsInGap: within(softs, prev.wall, g.wall), kind };
    }).filter(g => g.contiguous);
    type G = typeof gaps[0];
    const sum = (xs: G[]) => {
        const t = xs.reduce((a, g) => a + g.ticks, 0), r = xs.reduce((a, g) => a + g.expRolls, 0);
        return { logs: xs.length, ticks: t, perLog: r2(t / xs.length), expRolls: r2(r), perExpectedRoll: r2(t / r) };
    };
    const split = {
        all: sum(gaps),
        minuteCalm: sum(gaps.filter(g => g.calm)), minuteBusy: sum(gaps.filter(g => !g.calm)),
        trailingCalm: sum(gaps.filter(g => g.trailing60 <= LIMIT)), trailingBusy: sum(gaps.filter(g => g.trailing60 > LIMIT)),
        softCalm: sum(gaps.filter(g => g.trailingSoft60 <= LIMIT)), softBusy: sum(gaps.filter(g => g.trailingSoft60 > LIMIT))
    };
    // rs/158's bins: minutes by catch-ups per minute, with the gaps that ended in them.
    const bins = BINS.map(([name]) => {
        const ms = [...minutes.values()].filter(v => binOf(v.rate) === name);
        return { bin: name, minutesObserved: r2(ms.reduce((a, v) => a + v.spanMs, 0) / 60000), ...sum(gaps.filter(g => g.bin === name)) };
    });
    const hist: Record<string, number> = {};
    for (const g of gaps) hist[g.ticks] = (hist[g.ticks] ?? 0) + 1;
    const levels = logs.length ? `${logs[0]!.level}-${level}` : '?';
    const ps = logs.length ? `${r3(p(logs[0]!.level))}-${r3(p(logs[logs.length - 1]!.level))}` : '?';
    const last = polls[polls.length - 1]!;
    const counters = final?.counters ?? { phaseResyncs: last.pr, slips: last.sl, resyncs: last.rs, levelUps: last.lu, switches: last.sw };
    const kinds = { honest: gaps.filter(g => g.kind === 'honest').length, timing: gaps.filter(g => g.kind === 'timing').length,
        timingFourTick: gaps.filter(g => g.kind === 'timing' && g.ticks === 4).length, timingPhaseResync: gaps.filter(g => g.kind === 'timing' && g.ticks !== 4).length };
    const line = (label: string, s: ReturnType<typeof sum>) => console.log(`  ${label.padEnd(30)} ${s.logs} gaps, ${s.ticks} ticks, ${s.perLog} per log, ${s.perExpectedRoll} per expected roll (Σ1/p ${s.expRolls})`);
    console.log(`${phase}: ${logs.length} logs stamped (${stamps.size ? `marks, ${missed} not stamped` : 'log lines'}; ${polls.length} polls), Woodcutting ${levels} (start ${startLevel}), p ${ps}`);
    const lastFc = fcPolls[fcPolls.length - 1];
    console.log(`  catch-ups from ${source}${lastFc ? ` (program ${lastFc.fc} over ${lastFc.fn} intervals, under 150 ms ${lastFc.fu}, over 350 ms ${lastFc.fo}; page frame groups ${pageInRun})` : ` (${pageInRun} in the run)`}`);
    line('all', split.all);
    line(`minute catch-ups <= ${LIMIT}/min`, split.minuteCalm);
    line(`minute catch-ups >  ${LIMIT}/min`, split.minuteBusy);
    line(`trailing 60 s catch-ups <= ${LIMIT}`, split.trailingCalm);
    line(`trailing 60 s catch-ups >  ${LIMIT}`, split.trailingBusy);
    line(`trailing 60 s soft pairs <= ${LIMIT}`, split.softCalm);
    line(`trailing 60 s soft pairs >  ${LIMIT}`, split.softBusy);
    console.log(`  minutes: ${[...minutes].map(([m, v]) => `${new Date(m).toISOString().slice(11, 16)}Z ${v.catchUps} catch-ups, ${v.softs} soft in ${Math.round(v.spanMs / 1000)} s (${v.rate}/min, ${v.calm ? 'calm' : 'busy'})`).join('; ')}`);
    for (const b of bins) console.log(`  bin ${b.bin.padEnd(8)} catch-ups/min: ${b.minutesObserved} min, ${b.logs} gaps, Σ1/p ${b.expRolls}, ${b.ticks} ticks, ${b.logs ? b.perExpectedRoll : '-'} per expected roll`);
    console.log(`  gap histogram (ticks:count): ${Object.entries(hist).map(([k, v]) => `${k}:${v}`).join(' ')}`);
    console.log(`  resyncs: honest miss runs (21+ ticks, no phase resync) ${kinds.honest}; timing ${kinds.timing} (4-tick ${kinds.timingFourTick}, phase resync ${kinds.timingPhaseResync}); counters ${JSON.stringify(counters)}`);
    for (const [label, test] of [['gaps of 3', (g: G) => g.ticks === 3], ['longer gaps', (g: G) => g.ticks > 3], ['timing gaps', (g: G) => g.kind === 'timing'], ['honest miss runs', (g: G) => g.kind === 'honest']] as const) {
        const xs = gaps.filter(test);
        console.log(`  ${label}: ${xs.length}; with a catch-up inside ${xs.filter(g => g.catchUpsInGap).length}, with a soft pair inside ${xs.filter(g => g.softsInGap).length}`);
    }
    report[phase] = { levels, startLevel, p: ps, missed, catchUpSource: source, programFrames: lastFc ?? null, pageCatchUpsInRun: pageInRun, bins, ...split, kinds, counters, histogram: hist, minutes: Object.fromEntries([...minutes].map(([m, v]) => [new Date(m).toISOString(), v])), logs, gaps };
}
const out = flag('json');
if (out) writeFileSync(out, JSON.stringify(report, null, 1));
