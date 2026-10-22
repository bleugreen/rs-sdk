// Lab acceptance of H6, the log-row dropper (speedrun/helpers/fm-row.ts): the role
// drops the route's 157 logs on cairn_f01 while a stand-in SCORED lights them with
// firemaking.md's route (firemaking-line.ts --mode=ground --logs=auto, level 1 to 99,
// on the same snake). Through lab.sh, which starts the engine and both lite clients:
//
//   NODE_TICKRATE=300 LAB_HELPERS=cairn_f01 speedrun/lab/lab.sh cairn_f02 speedrun/lab/fm-row.ts
//
// Options: --dropper=cairn_f01, --row=3019,3362,27, --rows=2, --lead=4, --fires=157,
//   --restock-ticks=N (the role's restockTicks; the lab restocks by ::give in a few ticks)
//
// It reports, from SCORED's side: the gaps between successes, which of them waited on
// a log that was not yet in view ("missing-log gaps"), and for every log how many
// ticks before SCORED wanted it the log turned public ("ahead"). The public tick is
// the dropper's drop plus the reveal latency measured on log 0, which SCORED waits
// on in view; SCORED's own first sight of each log (within its 15-tile view) is
// reported beside it as a check. Log 0 is left out of "ahead": SCORED waits on it
// by design (logZeroWait). Per-tick logs: scored.jsonl and dropper.jsonl in the
// run's directory.
import { appendFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { nameHash } from '../helpers/altar-cue';
import { TickPeriod, tickMs } from '../lib/wait';
import { arg, botArg, result } from './common';

const ROOT = resolve(import.meta.dir, '..', '..');
const scored = botArg();
const dropper = arg('dropper', 'cairn_f01');
const [x, z, len] = arg('row', '3019,3362,27').split(',').map(Number) as [number, number, number];
const rows = Number(arg('rows', '2'));
const lead = Number(arg('lead', '4'));
const fires = Number(arg('fires', '157'));
const restockTicks = arg('restock-ticks', '');
const base = mkdtempSync(join(tmpdir(), 'fm-row-lab-'));
const scoredLog = join(base, 'scored.jsonl');
const ms = tickMs();

// ------------------------------------------------------------------ the dropper

interface RoleLine {
    message?: string;
    phase?: string;
    i?: number;
    tick?: number;
    ms?: number;
    [k: string]: unknown;
}
const roleLines: RoleLine[] = [];
const options = {
    start: 'sighted',
    scoredSha256: nameHash(scored),
    restock: { kind: 'cheat' },
    row: { x, z, len, rows },
    lead,
    ...(restockTicks ? { restockTicks: Number(restockTicks) } : {})
};
console.log(`fm-row lab: dropper ${dropper}, stand-in SCORED ${scored}, row ${x},${z} x${len} x${rows}, lead ${lead}, files in ${base}`);
const role = Bun.spawn([process.execPath, 'speedrun/helpers/fm-row.ts', dropper], {
    cwd: ROOT,
    env: { ...process.env, ROLE_OPTIONS: JSON.stringify(options), HELPER_LAB_TELE: '1' },
    stdout: 'pipe',
    stderr: 'inherit'
});
let armed!: () => void;
const armedP = new Promise<void>(r => (armed = r));
void (async () => {
    const decoder = new TextDecoder();
    let buf = '';
    const reader = role.stdout.getReader();
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        for (let i; (i = buf.indexOf('\n')) >= 0; buf = buf.slice(i + 1)) {
            const text = buf.slice(0, i).trim();
            if (!text.startsWith('{')) continue;
            const line = JSON.parse(text) as RoleLine;
            roleLines.push(line);
            appendFileSync(join(base, 'dropper.jsonl'), text + '\n');
            if (line.message !== 'drop') console.log(`dropper ${text}`);
            if (line.message === 'phase' && line.phase === 'armed') armed();
        }
    }
})();
const armedOk = await Promise.race([armedP.then(() => true), Bun.sleep(180_000).then(() => false)]);
if (!armedOk) {
    console.log('dropper never armed');
    role.kill('SIGTERM');
    await role.exited;
    process.exit(1);
}

// ------------------------------------------------------------------ the stand-in SCORED

const line = Bun.spawn(
    [process.execPath, 'docs/speedrun/scripts/firemaking-line.ts', scored, '--mode=ground', '--logs=auto', '--level=1', '--hold=0', '--until=99',
        `--fires=${fires}`, `--row=${x},${z},${len}`, `--rows=${rows}`, '--wait=150', `--out=${scoredLog}`],
    { cwd: ROOT, stdout: 'inherit', stderr: 'inherit' }
);
const lineCode = await line.exited;
role.kill('SIGTERM');
const roleCode = await Promise.race([role.exited, Bun.sleep(30_000).then(() => 'timeout')]);

// ------------------------------------------------------------------ analysis

interface Tick {
    t: number;
    ms: number;
    idx: number;
    ev: string[];
    seen?: number[];
}
const ticks = readFileSync(scoredLog, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as Tick);
// Wall gaps become ticks at the period SCORED observed over its own log, not the nominal one.
const observed = new TickPeriod(ms);
for (const tk of ticks) observed.see(tk.t, tk.ms);
const periodMsObserved = observed.ms;
const needAt = new Map<number, Tick>();
const lightAt = new Map<number, Tick>();
const seenAt = new Map<number, Tick>();
const successes: Tick[] = [];
for (const tk of ticks) {
    if (tk.ev.includes('success')) successes.push(tk);
    const wants = tk.ev.some(e => e === 'light' || e.startsWith('nolog'));
    if (wants && !needAt.has(tk.idx)) needAt.set(tk.idx, tk);
    if (tk.ev.includes('light') && !lightAt.has(tk.idx)) lightAt.set(tk.idx, tk);
    for (const i of tk.seen ?? []) if (!seenAt.has(i)) seenAt.set(i, tk);
}
const drops = new Map<number, RoleLine>();
for (const l of roleLines) if (l.message === 'drop' && typeof l.i === 'number') drops.set(l.i, l);

// Reveal latency: SCORED stands on log 0's tile from the start and lights it the tick it turns public.
const d0 = drops.get(0);
const l0 = lightAt.get(0);
const revealTicks = d0?.ms && l0 ? Math.round((l0.ms - d0.ms) / periodMsObserved) : null;

const gaps: Record<number, number> = {};
const missingGaps: Array<{ i: number; gap: number; waited: number }> = [];
for (let n = 1; n < successes.length; n++) {
    const gap = successes[n]!.t - successes[n - 1]!.t;
    gaps[gap] = (gaps[gap] ?? 0) + 1;
    const i = successes[n]!.idx - 1;
    const need = needAt.get(i);
    const light = lightAt.get(i);
    const waited = need && light ? light.t - need.t : 0;
    if (waited > 0) missingGaps.push({ i, gap, waited });
}
// Log 0 is the one SCORED waits on by design: it shows up at the row as dropping starts.
const n0 = needAt.get(0);
const logZeroWait = n0 && l0 ? l0.t - n0.t : null;
const ahead: number[] = [];
const aheadSeen: number[] = [];
for (const [i, need] of needAt) {
    if (i === 0) continue;
    const d = drops.get(i);
    if (d?.ms && revealTicks !== null) ahead.push(Math.round((need.ms - d.ms) / periodMsObserved) - revealTicks);
    const s = seenAt.get(i);
    if (s) aheadSeen.push(need.t - s.t);
}
const dist = (xs: number[]) => {
    const out: Record<number, number> = {};
    for (const v of xs) out[v] = (out[v] ?? 0) + 1;
    return out;
};
const lost = roleLines.filter(l => l.message === 'lost').length;
const early = roleLines.filter(l => l.message === 'drop' && l.early).length;
result('fm-row', {
    successes: successes.length,
    ticksFirstToLast: successes.length > 1 ? successes.at(-1)!.t - successes[0]!.t : null,
    gaps,
    missingLogGaps: missingGaps.length,
    missingLogGapsOver4: missingGaps.filter(g => g.gap > 4),
    revealTicksFromDrop: revealTicks,
    logZeroWait,
    aheadMax: ahead.length ? Math.max(...ahead) : null,
    aheadMin: ahead.length ? Math.min(...ahead) : null,
    aheadDistribution: dist(ahead),
    aheadBySightMax: aheadSeen.length ? Math.max(...aheadSeen) : null,
    dropped: drops.size,
    lost,
    early,
    lineExit: lineCode,
    roleExit: roleCode,
    files: base
});
process.exit(lineCode === 0 && missingGaps.filter(g => g.gap > 4).length === 0 ? 0 : 1);
