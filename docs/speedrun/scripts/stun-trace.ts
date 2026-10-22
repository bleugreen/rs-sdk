// The server's view of each pickpocket stun, from an engine log written with DECODE_TRACE=<bot>
// (rs/317's temporary trace in NetworkPlayer.decodeIn and Player.messageGame; it is not in the
// engine: re-apply it for a lab with `git show cb742c6a9d | git apply`, and take it out again after).
// Results: stun-pack.md section 13.
//
//   bun docs/speedrun/scripts/stun-trace.ts <engine.log> [--show=6]
//
// Timing (stun-pack.md section 2): an attempt on server tick T rolls on T+1 = F, the tick of the
// failure message. A packet the client sends on observing offset k lands on T+2+k = F+1+k, so server
// tick F+j carries the bundle sent on k = j-1; T+4..T+10 (j = 3..9) is the window and T+11
// (j = 10) the next attempt. Each decoded user op prints as a letter, upper case when its handler
// accepted it and lower case when it refused (a delayed player): C IF_BUTTON (Charge, a page
// button), A OPHELDU (arrows), B OPHELD (bury, eat), M MOVE_OPCLICK, N OPNPC, R RESUME_PAUSEBUTTON,
// P OPPLAYER, X a cheat, ? anything else. `|` marks a tick the user limit cut short with bytes
// still waiting (a deferral).

import { readFileSync } from 'fs';

const file = process.argv[2];
if (!file) throw new Error('usage: stun-trace.ts <engine.log> [--show=6]');
const show = Number(process.argv.find(a => a.startsWith('--show='))?.slice(7) ?? '6');
const LETTER: Record<string, string> = { IfButton: 'C', OpHeldU: 'A', OpHeld: 'B', MoveClick: 'M', OpNpc: 'N', ResumePauseButton: 'R', OpPlayer: 'P', ClientCheat: 'X' };

interface Tick { ops: string[]; defer: boolean; msgs: string[] }
const ticks = new Map<number, Tick>();
const at = (t: number) => ticks.get(t) ?? (ticks.set(t, { ops: [], defer: false, msgs: [] }), ticks.get(t)!);
for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /DTRACE (\d+) (.*)$/.exec(line);
    if (!m) continue;
    const t = at(Number(m[1]));
    const rest = m[2]!;
    if (rest.startsWith('msg=')) { t.msgs.push(rest.slice(4)); continue; }
    const ops = /ops=(\S*)/.exec(rest)?.[1] ?? '';
    for (const o of ops.split(',').filter(Boolean)) {
        const ok = o.endsWith('+');
        const l = LETTER[o.slice(0, -1)] ?? '?';
        t.ops.push(ok ? l : l.toLowerCase());
    }
    if (/DEFER/.test(rest)) t.defer = true;
}

const sorted = [...ticks.keys()].sort((a, b) => a - b);
const withMsg = (re: RegExp) => sorted.filter(t => ticks.get(t)!.msgs.some(m => re.test(m)));
const fails = withMsg(/You fail to pick/);
const attempts = withMsg(/You attempt to pick/);
const picks = withMsg(/You pick the/);
const levelUps = withMsg(/Congratulations/);
const deferTicks = sorted.filter(t => ticks.get(t)!.defer);

interface Stun { f: number; gap: number | null; deferJ: number[]; lostH: number; levelJ: number[]; landedJ: number[]; row: string[] }
const stuns: Stun[] = fails.map(f => {
    const next = attempts.find(a => a > f);
    const row: string[] = [];
    const deferJ: number[] = [], levelJ: number[] = [], landedJ: number[] = [];
    let lostH = 0;
    for (let j = 1; j <= 11; j++) {
        const t = ticks.get(f + j);
        if (!t) { row.push('-'); continue; }
        if (t.defer) deferJ.push(j);
        if (t.msgs.some(m => /Congratulations/.test(m))) levelJ.push(j);
        // a delay-free action the server refused: it arrived on a tick the player was delayed
        if (j >= 3 && j <= 10) lostH += t.ops.filter(o => o === 'c' || o === 'a').length;
        for (const o of t.ops) if (o === 'C' || o === 'A') landedJ.push(j);
        row.push((t.ops.join('') || '-') + (t.defer ? '|' : ''));
    }
    return { f, gap: next === undefined ? null : next - f, deferJ, lostH, levelJ, landedJ, row };
});

const mean = (a: number[]) => (a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(3) : null);
const hist = (a: number[]) => a.reduce<Record<number, number>>((h, g) => ((h[g] = (h[g] ?? 0) + 1), h), {});
const gaps = (ss: Stun[]) => ss.map(s => s.gap).filter((g): g is number => g !== null && g < 30);
const deferred = stuns.filter(s => s.deferJ.some(j => j >= 3 && j <= 10));
const clean = stuns.filter(s => !deferred.includes(s));
const inStun = new Set(stuns.flatMap(s => s.deferJ.map(j => s.f + j)));
const byK: Record<string, number> = {};
for (const s of stuns) for (const j of s.deferJ) byK[`k${j - 1}`] = (byK[`k${j - 1}`] ?? 0) + 1;

console.log(`RESULT trace ${JSON.stringify({
    attempts: attempts.length, successes: picks.length, failures: fails.length, levelUps: levelUps.length,
    deferTicks: deferTicks.length, deferTicksInStuns: inStun.size, deferTicksOutside: deferTicks.length - inStun.size,
    stunsWithDeferral: deferred.length, deferralsByK: byK,
    lostDelayFreeInWindow: stuns.reduce((a, s) => a + s.lostH, 0),
    failToNextAttempt: { all: { mean: mean(gaps(stuns)), hist: hist(gaps(stuns)) }, deferred: { mean: mean(gaps(deferred)), hist: hist(gaps(deferred)) }, clean: { mean: mean(gaps(clean)), hist: hist(gaps(clean)) } },
    levelUpInStunByJ: hist(stuns.flatMap(s => s.levelJ)),
    // delay-free actions (C, A) the server accepted, per stun and by the tick they landed on; j >= 9 is T+10 or
    // later, where xp can queue a level-up page that blocks the next attempt
    delayFreeLanded: { perStun: mean(stuns.map(s => s.landedJ.length)), byJ: hist(stuns.flatMap(s => s.landedJ)) },
    xpLateStuns: (() => {
        const late = stuns.filter(s => s.landedJ.some(j => j >= 9));
        const paged = stuns.filter(s => s.levelJ.some(j => j >= 9));
        const rest = stuns.filter(s => !late.includes(s));
        return { landedAtJ9plus: late.length, gap: { mean: mean(gaps(late)), hist: hist(gaps(late)) }, levelUpAtJ9plus: paged.length, levelUpGap: { mean: mean(gaps(paged)), hist: hist(gaps(paged)) }, others: { mean: mean(gaps(rest)) } };
    })()
})}`);
const head = 'j(k)   ' + Array.from({ length: 11 }, (_, i) => `+${i + 1}(${i})`.padEnd(9)).join('');
console.log('\nper stun, server ticks F+1..F+11 (k = j-1); gap = next attempt - F (10 on time)\n' + head);
const sample = [...stuns.slice(0, show), ...deferred.slice(0, show)].filter((s, i, a) => a.indexOf(s) === i);
for (const s of sample) console.log(`F=${s.f} gap=${s.gap} ${s.deferJ.length ? `defer@j${s.deferJ.join(',')}` : ''}${s.levelJ.length ? ` lvl@j${s.levelJ.join(',')}` : ''}\n       ${s.row.map(r => r.padEnd(9)).join('')}`);
