// Overrun-burst analysis for the demo's tick (docs/speedrun/research/demo-latency.md, 'Overrun
// bursts overnight'). Reads what demo-burst-sampler.ts collects plus any demo-latency-probe.ts
// JSON with a sample phase (rs/85's fedora steadiness windows), scores every PDT minute of tick
// arrivals against the run-night gate, and reports burst lengths and what they line up with.
//
//   bun docs/speedrun/scripts/demo-burst-analysis.ts --pairs=DIR/pairs --windows=a.json,b.json
//       [--playercount=DIR/playercount.tsv] [--fleet=fleet-minutes.csv] [--minutes-out=minutes.tsv]
//
// Tick times: a pair's direct.json carries decoded tick labels (react.ticks), which are exact. A
// sample phase keeps only raw [t, bytes] websocket messages; ticks are rebuilt from messages of
// >= 5 bytes (the 1-4 byte ones are not tick output), merging those under 8 ms apart. Grouping at
// 60 ms, as frameStats does, would merge a catch-up tick into the late tick before it.
//
// Per minute, with intervals between consecutive ticks:
//   (b) interval p90 <= 400 ms
//   (c) catch-ups <= 1 per minute, a catch-up being an interval < 150 ms right after one > 350 ms:
//       the engine runs a fixed 300 ms grid with catch-up (World.ts cycle()), so an overrun tick is
//       followed by one that starts almost at once and leaves no idle window for a reaction.
// A sample (a pair's direct probe, ~1.3 min) is scored the same way over its whole span, and
// against (a) direct >= 58/60 at +0 ms.
//
// Only an Ashburn vantage (edge iad, TCP p50 <= 10 ms) counts toward the gate, the bursts and the
// correlations. A home vantage behind another Fly edge sees the same ticks 60-70 ms later, but its
// path adds single-tick hiccups that read exactly like an overrun and its catch-up (aligned tick
// by tick at 04:04 PDT: 13 catch-ups at home, 0 at Ashburn over the same 245 ticks), so home
// windows are listed for reference only.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const args = new Map<string, string>();
for (const a of process.argv.slice(2)) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    if (m) args.set(m[1]!, m[2] ?? 'true');
}
const P90_MAX = 400;
const CATCH_MAX_PER_MIN = 1;
const LATE_MS = 450;

const pdtFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const pdt = (ms: number) => pdtFmt.format(ms).replace(',', '');
const hhmm = (ms: number) => pdt(ms).slice(11, 16);
const q = (xs: number[], p: number) => {
    const a = [...xs].sort((u, v) => u - v);
    return a[Math.min(a.length - 1, Math.floor(p * a.length))] ?? NaN;
};

/** Interval statistics over a list of tick arrival times. */
function score(ts: number[]) {
    const iv = ts.slice(1).map((t, i) => t - ts[i]!);
    let catchups = 0;
    for (let i = 1; i < iv.length; i++) if (iv[i]! < 150 && iv[i - 1]! > 350) catchups++;
    const minutes = iv.length * 0.3 / 60; // intervals on the 300 ms grid, so partial minutes scale
    const p90 = q(iv, 0.9);
    const perMin = catchups / Math.max(minutes, 1e-9);
    return { n: iv.length, p90, max: Math.max(...iv), late: iv.filter(v => v > LATE_MS).length, catchups, catchPerMin: perMin, b: p90 <= P90_MAX, c: perMin <= CATCH_MAX_PER_MIN };
}

function rebuildTicks(raw: [number, number][]): number[] {
    const out: number[] = [];
    let last = -Infinity;
    for (const [t, bytes] of raw) {
        if (bytes < 5) continue;
        if (t - last >= 8) out.push(t);
        last = t;
    }
    return out;
}

interface Segment { source: string; kind: 'pair' | 'pair-window' | 'window' | 'window-react'; vantage: 'ashburn' | 'east' | 'home'; ticks: number[]; exact: boolean; direct?: { onTime: number; n: number; hist: Record<string, number> }; relay?: Record<string, number>; url?: string; trials?: any[]; players?: number | null }
const segments: Segment[] = [];

const pairsDir = args.get('pairs');
if (pairsDir && existsSync(pairsDir)) {
    for (const f of readdirSync(pairsDir).filter(f => f.endsWith('.json')).sort()) {
        const r = JSON.parse(readFileSync(join(pairsDir, f), 'utf8'));
        const ticks = (r.react?.ticks ?? []).map((t: number[]) => t[1]!);
        const trials = (r.react?.trials ?? []).filter((t: any) => t.delay === 0);
        const hist: Record<string, number> = {};
        for (const t of trials) hist[t.ticks] = (hist[t.ticks] ?? 0) + 1;
        const vantage = r.vantage?.edge_region === 'iad' && (r.vantage?.http_ms?.tcp_connect?.p50 ?? 99) <= 10 ? 'ashburn' : 'east';
        segments.push({ source: f, kind: 'pair', vantage, ticks, exact: true, trials, url: r.runUrl, players: r.vantage?.players_online ?? r.playercountStart,
            direct: { onTime: trials.filter((t: any) => t.ticks === 1).length, n: trials.length, hist }, relay: r.gatewayPath?.reaction_ticks });
        // The same session's sample phase, when the dispatch asked for one: one continuous window.
        const sampleTicks = r.sample?.frames?.raw?.length ? rebuildTicks(r.sample.frames.raw).filter(t => t > ticks.at(-1)! + 150) : [];
        segments.push({ source: f, kind: 'pair-window', vantage, ticks: [...ticks, ...sampleTicks], exact: !sampleTicks.length, players: r.vantage?.players_online ?? r.playercountStart });
    }
}
for (const f of (args.get('windows') ?? '').split(',').filter(Boolean)) {
    const r = JSON.parse(readFileSync(f, 'utf8'));
    if (r.sample?.frames?.raw?.length) segments.push({ source: basename(f), kind: 'window', vantage: 'home', ticks: rebuildTicks(r.sample.frames.raw), exact: false, players: r.playercountStart });
    if (r.react?.ticks?.length) segments.push({ source: basename(f), kind: 'window-react', vantage: 'home', ticks: r.react.ticks.map((t: number[]) => t[1]!), exact: true, players: r.playercountStart });
}
segments.sort((a, b) => a.ticks[0]! - b.ticks[0]!);

// Player count: the sampler's 20 s poll, else the count the segment recorded at its start.
const counts: [number, number][] = [];
const pcPath = args.get('playercount');
if (pcPath && existsSync(pcPath)) {
    for (const line of readFileSync(pcPath, 'utf8').split('\n').slice(1)) {
        const [, epoch, players] = line.split('\t');
        if (epoch && players) counts.push([Number(epoch), Number(players)]);
    }
}
const playersAt = (t: number, fallback: number | null | undefined) => {
    let best: [number, number] | null = null;
    for (const c of counts) if (Math.abs(c[0] - t) < 90_000 && (!best || Math.abs(c[0] - t) < Math.abs(best[0] - t))) best = c;
    return best?.[1] ?? fallback ?? null;
};

// Fleet: rs/41's per-minute series (minute_utc, fleet_online, dev_online, logins, logouts, ...).
const fleet = new Map<number, Record<string, number>>();
const fleetPath = args.get('fleet');
if (fleetPath && existsSync(fleetPath)) {
    const [head, ...rows] = readFileSync(fleetPath, 'utf8').trim().split('\n');
    const cols = head!.split(',').map(s => s.trim());
    for (const row of rows) {
        const v = row.split(',');
        const m = Date.parse(v[0]!.trim().replace(/Z?$/, 'Z'));
        if (!Number.isNaN(m)) fleet.set(Math.floor(m / 60_000), Object.fromEntries(cols.slice(1).map((c, i) => [c, Number(v[i + 1])])));
    }
}
const restarts = [...fleet.entries()].filter(([, r]) => r.fleet_restart).map(([m]) => m * 60_000);
const fleetNear = (t: number) => {
    const m = Math.floor(t / 60_000);
    let logins = 0, logouts = 0;
    for (let k = m - 5; k <= m; k++) {
        logins += fleet.get(k)?.logins ?? 0;
        logouts += (fleet.get(k)?.logouts ?? 0) + (fleet.get(k)?.logout_forced ?? 0);
    }
    return { online: fleet.get(m)?.fleet_online ?? null, churn5: fleet.size ? logins + logouts : null, sinceRestartMin: restarts.filter(r => r <= t).length ? Math.round((t - Math.max(...restarts.filter(r => r <= t))) / 60_000) : null };
};

// ---------------------------------------------------------------- per-minute series
interface Minute { minute: number; source: string; kind: string; exact: boolean; players: number | null; s: ReturnType<typeof score>; fleet: ReturnType<typeof fleetNear> }
const minutes: Minute[] = [];
// The per-minute series uses each pair's whole session (pair-window), Ashburn only.
for (const seg of segments.filter(s => s.kind === 'pair-window' && s.vantage === 'ashburn')) {
    const byMin = new Map<number, number[]>();
    for (const t of seg.ticks) {
        const m = Math.floor(t / 60_000);
        if (!byMin.has(m)) byMin.set(m, []);
        byMin.get(m)!.push(t);
    }
    for (const [m, ts] of [...byMin.entries()].sort((a, b) => a[0] - b[0])) {
        if (ts.length < 60) continue; // under ~18 s of ticks in this minute
        minutes.push({ minute: m * 60_000, source: seg.source, kind: seg.kind, exact: seg.exact, players: playersAt(m * 60_000 + 30_000, seg.players), s: score(ts), fleet: fleetNear(m * 60_000) });
    }
}
const out: string[] = [];
const say = (s = '') => out.push(s);

// ---------------------------------------------------------------- samples (pairs)
say('## Samples');
say();
say('| PDT | source | vantage | online | direct 1:2:3 | relay 1:2 | p90 / max ms | late >450 /min | catch-ups /min | (a) | (b) | (c) |');
say('|---|---|---|---|---|---|---|---|---|---|---|---|');
const agree = { n: 0, aEqB: 0, aEqC: 0 };
for (const seg of segments.filter(s => !(s.kind === 'pair-window' && s.exact))) { // a pair without a sample phase is its pair row
    const s = score(seg.ticks);
    const mins = s.n * 0.3 / 60;
    // 58/60 scaled to runs with other trial counts
    const a = seg.direct && seg.direct.n ? seg.direct.onTime / seg.direct.n >= 58 / 60 : null;
    if (a !== null && seg.vantage === 'ashburn') {
        agree.n++;
        if (a === s.b) agree.aEqB++;
        if (a === s.c) agree.aEqC++;
    }
    const h = seg.direct?.hist ?? {};
    say(`| ${pdt(seg.ticks[0]!).slice(5)} | ${seg.kind}${seg.exact ? '' : ' (rebuilt)'} | ${seg.vantage} | ${playersAt(seg.ticks[0]!, seg.players) ?? ''} | ${seg.direct ? `${h['1'] ?? 0}:${h['2'] ?? 0}:${h['3'] ?? 0}` : ''} | ${seg.relay ? `${seg.relay['1'] ?? 0}:${seg.relay['2'] ?? 0}` : ''} | ${s.p90.toFixed(0)} / ${s.max.toFixed(0)} | ${(s.late / mins).toFixed(1)} | ${s.catchPerMin.toFixed(1)} | ${a === null ? '' : a ? 'pass' : 'FAIL'} | ${s.b ? 'pass' : 'FAIL'} | ${s.c ? 'pass' : 'FAIL'} |`);
}
say();
say(`Ashburn pairs where (b) agrees with (a): ${agree.aEqB}/${agree.n}; where (c) agrees with (a): ${agree.aEqC}/${agree.n}.`);

// ---------------------------------------------------------------- P(miss | next interval)
const B = [[0, 50], [50, 100], [100, 150], [150, 200], [200, 250], [250, Infinity]] as const;
const bins = B.map(() => ({ n: 0, miss: 0 }));
const after = { catch: { n: 0, miss: 0 }, other: { n: 0, miss: 0 } };
for (const seg of segments.filter(s => s.vantage === 'ashburn')) for (const t of seg.trials ?? []) {
    if (t.ticks === 99 || t.nextIntervalMs === null || t.nextIntervalMs === undefined) continue;
    const i = B.findIndex(([lo, hi]) => t.nextIntervalMs >= lo && t.nextIntervalMs < hi);
    bins[i]!.n++;
    if (t.ticks > 1) bins[i]!.miss++;
    const k = t.nextIntervalMs < 150 ? after.catch : after.other;
    k.n++;
    if (t.ticks > 1) k.miss++;
}
say();
say('## P(miss) by the next tick interval (Ashburn direct probe, +0 ms trials)');
say();
say('| next interval ms | ' + B.map(([lo, hi]) => (hi === Infinity ? `>= ${lo}` : `${lo}-${hi}`)).join(' | ') + ' |');
say('|---|' + B.map(() => '---').join('|') + '|');
say('| missed | ' + bins.map(b => `${b.miss}/${b.n}`).join(' | ') + ' |');
say();
say(`next < 150 ms: ${after.catch.miss}/${after.catch.n} missed (${((after.catch.miss / Math.max(1, after.catch.n)) * 100).toFixed(0)}%); otherwise ${after.other.miss}/${after.other.n} (${((after.other.miss / Math.max(1, after.other.n)) * 100).toFixed(1)}%).`);

// ---------------------------------------------------------------- bursts within windows
// A burst is a maximal run of consecutive minutes failing (c) inside one continuous segment;
// a run touching either end of its segment is censored (it may be longer).
say();
say('## Bursts inside continuous windows (minutes failing (c))');
say();
const bursts: { start: number; len: number; censored: boolean; source: string }[] = [];
const segMins = new Map<string, Minute[]>();
for (const m of minutes) {
    const k = `${m.source}/${m.kind}`;
    if (!segMins.has(k)) segMins.set(k, []);
    segMins.get(k)!.push(m);
}
for (const [k, ms] of segMins) {
    if (ms.length < 3) continue; // only windows long enough to see a run end
    let i = 0;
    while (i < ms.length) {
        if (ms[i]!.s.c) { i++; continue; }
        let j = i;
        while (j + 1 < ms.length && !ms[j + 1]!.s.c && ms[j + 1]!.minute - ms[j]!.minute === 60_000) j++;
        bursts.push({ start: ms[i]!.minute, len: j - i + 1, censored: i === 0 || j === ms.length - 1, source: k });
        i = j + 1;
    }
    say(`- ${hhmm(ms[0]!.minute)}-${hhmm(ms.at(-1)!.minute + 60_000)} ${k}: ${ms.map(m => (m.s.c ? (m.s.b ? '.' : 'b') : m.s.b ? 'c' : 'X')).join('')}  (catch-ups/min ${ms.map(m => m.s.catchPerMin.toFixed(0)).join(' ')})`);
}
say();
say('Legend: . passes both, b fails (b) only, c fails (c) only, X fails both.');
const closed = bursts.filter(b => !b.censored).map(b => b.len);
say(`Bursts: ${bursts.length} (${closed.length} closed, lengths ${closed.sort((a, b) => a - b).join(', ') || 'none'} min; censored ${bursts.filter(b => b.censored).map(b => `>=${b.len}`).join(', ') || 'none'}).`);

// ---------------------------------------------------------------- bursts across samples
// Consecutive samples in time (pairs and windows, each scored on (c) over its span): a run of
// failing samples lasted at least first-to-last failing and at most neighbour-pass to neighbour-pass.
say();
say('## Bursts across samples');
say();
const seq = segments.filter(s => s.kind === 'pair-window' && s.vantage === 'ashburn').map(s => ({ t0: s.ticks[0]!, t1: s.ticks.at(-1)!, fail: !score(s.ticks).c, kind: s.kind }));
for (let i = 0; i < seq.length;) {
    if (!seq[i]!.fail) { i++; continue; }
    let j = i;
    while (j + 1 < seq.length && seq[j + 1]!.fail) j++;
    const lo = (seq[j]!.t1 - seq[i]!.t0) / 60_000;
    const hi = ((seq[j + 1]?.t0 ?? NaN) - (seq[i - 1]?.t1 ?? NaN)) / 60_000;
    say(`- ${hhmm(seq[i]!.t0)}-${hhmm(seq[j]!.t1)}: ${j - i + 1} failing sample(s); lasted >= ${lo.toFixed(0)} min, <= ${Number.isNaN(hi) ? 'open' : hi.toFixed(0) + ' min'}`);
    i = j + 1;
}
say(`Samples failing (c): ${seq.filter(s => s.fail).length}/${seq.length}.`);

// ---------------------------------------------------------------- correlations
say();
say('## What failing minutes line up with');
say();
const rate = (ms: Minute[]) => `${ms.filter(m => !m.s.c).length}/${ms.length}`;
const byHour = new Map<string, Minute[]>();
for (const m of minutes) {
    const h = pdt(m.minute).slice(11, 13);
    if (!byHour.has(h)) byHour.set(h, []);
    byHour.get(h)!.push(m);
}
say('| PDT hour | minutes failing (c) | failing (b) | catch-ups/min p50 | players p50 |');
say('|---|---|---|---|---|');
for (const [h, ms] of [...byHour.entries()].sort()) {
    say(`| ${h}:00 | ${rate(ms)} | ${ms.filter(m => !m.s.b).length}/${ms.length} | ${q(ms.map(m => m.s.catchPerMin), 0.5).toFixed(1)} | ${q(ms.map(m => m.players ?? NaN).filter(v => !Number.isNaN(v)), 0.5) || ''} |`);
}
const withP = minutes.filter(m => m.players !== null);
if (withP.length >= 6) {
    const cut = [q(withP.map(m => m.players!), 1 / 3), q(withP.map(m => m.players!), 2 / 3)];
    const tiers = [withP.filter(m => m.players! < cut[0]!), withP.filter(m => m.players! >= cut[0]! && m.players! < cut[1]!), withP.filter(m => m.players! >= cut[1]!)];
    say();
    say(`By player count (terciles at ${cut[0]} and ${cut[1]}): failing (c) ${tiers.map(rate).join(' / ')}.`);
    const xs = withP.map(m => m.players!), ys = withP.map(m => m.s.catchPerMin);
    const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
    const cov = xs.reduce((s, x, i) => s + (x - mx) * (ys[i]! - my), 0);
    const r = cov / Math.sqrt(xs.reduce((s, x) => s + (x - mx) ** 2, 0) * ys.reduce((s, y) => s + (y - my) ** 2, 0));
    say(`Pearson r (players, catch-ups/min) over ${withP.length} minutes: ${r.toFixed(2)}.`);
}
if (fleet.size) {
    const busy = minutes.filter(m => (m.fleet.churn5 ?? 0) >= 3);
    const nearRestart = minutes.filter(m => m.fleet.sinceRestartMin !== null && m.fleet.sinceRestartMin <= 10);
    say();
    say(`Fleet: minutes with >= 3 fleet logins/logouts in the 5 min before: failing (c) ${rate(busy)}; others ${rate(minutes.filter(m => !busy.includes(m)))}.`);
    say(`Within 10 min after a fleet restart: failing (c) ${rate(nearRestart)}; others ${rate(minutes.filter(m => !nearRestart.includes(m)))}.`);
}

console.log(out.join('\n'));
const mo = args.get('minutes-out');
if (mo) {
    const head = ['pdt', 'source', 'kind', 'exact', 'players', 'intervals', 'p90_ms', 'max_ms', 'late_450', 'catchups', 'catchups_per_min', 'b_pass', 'c_pass', 'fleet_online', 'fleet_churn_5min', 'min_since_fleet_restart'];
    writeFileSync(mo, [head.join('\t'), ...minutes.map(m => [pdt(m.minute), m.source, m.kind, m.exact ? 1 : 0, m.players ?? '', m.s.n, m.s.p90.toFixed(0), m.s.max.toFixed(0), m.s.late, m.s.catchups, m.s.catchPerMin.toFixed(2), m.s.b ? 1 : 0, m.s.c ? 1 : 0, m.fleet.online ?? '', m.fleet.churn5 ?? '', m.fleet.sinceRestartMin ?? ''].join('\t'))].join('\n') + '\n');
}
