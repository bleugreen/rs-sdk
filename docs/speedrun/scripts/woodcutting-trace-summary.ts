// Summarise a woodcutting lab run from the engine's own trace (server ticks).
//
// The trace comes from an engine patched with woodcutting-trace.patch:
//   git apply docs/speedrun/scripts/woodcutting-trace.patch   # lab only, never commit
// which prints `WCTRACE <tick> ...` lines for every stat_random roll, xp gain,
// loc_change, OPLOC/OPHELD packet (accepted or rejected) and every tick the player moved.
//
// usage: bun docs/speedrun/scripts/woodcutting-trace-summary.ts <engine.log> [fromLine] [toLine]
//   fromLine/toLine select the part of the log written during one run.
import { readFileSync } from 'fs';

const [file, fromArg, toArg] = process.argv.slice(2);
const all = readFileSync(file, 'utf8').split('\n');
const lines = all.slice(Number(fromArg ?? 0), toArg ? Number(toArg) : undefined).filter(l => l.includes('WCTRACE '));

type Roll = { t: number; lvl: number; lo: number; hi: number; v: number; ok: boolean };
const rolls: Roll[] = [];
const xps: { t: number; fine: number }[] = [];
const locs: { t: number; at: string; to: number; duration: number }[] = [];
const opheld: { t: number; ok: boolean; why?: string }[] = [];
const oploc: { t: number; ok: boolean; why?: string; at: string }[] = [];
const moved: number[] = [];
for (const l of lines) {
    const m = l.slice(l.indexOf('WCTRACE ') + 8).split(' ');
    const t = Number(m[0]);
    const kv = Object.fromEntries(m.slice(2).map(p => p.split('=')).filter(p => p.length === 2));
    switch (m[1]) {
        case 'roll': rolls.push({ t, lvl: +kv.lvl, lo: +kv.lo, hi: +kv.hi, v: +kv.v, ok: kv.ok === '1' }); break;
        case 'xp': if (kv.stat === '8') xps.push({ t, fine: +kv.fine }); break; // 8 = woodcutting
        case 'locchange': locs.push({ t, at: kv.at, to: +kv.to, duration: +kv.duration }); break;
        case 'opheld': opheld.push({ t, ok: m.includes('ok'), why: kv.rejected }); break;
        case 'oploc': oploc.push({ t, ok: m.includes('ok'), why: kv.rejected, at: kv.at }); break;
        case 'moved': moved.push(t); break;
    }
}
if (!rolls.length) { console.log('SUMMARY {"rolls":0}'); process.exit(0); }

// success: observed against the formula, value/256 per roll
const succ = rolls.filter(r => r.ok).length;
const expected = rolls.reduce((n, r) => n + Math.min(r.v, 256) / 256, 0);
const sd = Math.sqrt(rolls.reduce((n, r) => { const p = Math.min(r.v, 256) / 256; return n + p * (1 - p); }, 0));

// gaps between consecutive rolls; the cycle is 4, anything above it is lost time
// a tree depletion is a loc_change on the tick of a successful roll (other world locs,
// such as one on a 500-tick timer, also show up in the trace)
const treeLocs = locs.filter(l => rolls.some(r => r.t === l.t && r.ok));
const depleteTicks = new Set(treeLocs.map(l => l.t));
// phase of each accepted click: ticks since the latest roll at or before it
const clickPhase: Record<number, number> = {};
for (const o of oploc.filter(o => o.ok)) {
    const prev = [...rolls].reverse().find(r => r.t <= o.t);
    if (!prev) continue;
    const ph = Math.min(o.t - prev.t, 9);
    clickPhase[ph] = (clickPhase[ph] ?? 0) + 1;
}
// ticks lost per level-up: the gap after a roll whose xp crossed a level
const levelUpTicks = new Set(lines.filter(l => / levelup /.test(l)).map(l => Number(l.slice(l.indexOf('WCTRACE ') + 8).split(' ')[0])));
const gapHist: Record<number, number> = {};
let lost = 0, lostAfterDepletion = 0, lostOther = 0, waitsAllDown = 0;
const lostEvents: string[] = [];
for (let i = 1; i < rolls.length; i++) {
    const a = rolls[i - 1], b = rolls[i];
    const gap = b.t - a.t;
    gapHist[gap] = (gapHist[gap] ?? 0) + 1;
    if (gap <= 4) continue;
    const extra = gap - 4;
    if (gap > 40) { waitsAllDown++; continue; } // a respawn wait or a deliberate pause, reported separately
    lost += extra;
    if (depleteTicks.has(a.t)) lostAfterDepletion += extra; else lostOther += extra;
    if (lostEvents.length < 25) {
        const window = (t: number) => t > a.t && t < b.t;
        lostEvents.push(`roll@${a.t}->${b.t} +${extra}${depleteTicks.has(a.t) ? ' after-depletion' : ''} opheld@[${opheld.filter(o => window(o.t) || o.t === a.t).map(o => `${o.t}${o.ok ? '' : ':' + o.why}`).join(',')}] oploc@[${oploc.filter(o => window(o.t) || o.t === a.t).map(o => `${o.t}${o.ok ? '' : ':' + o.why}`).join(',')}] moved@[${moved.filter(window).join(',')}]`);
    }
}
const span = rolls[rolls.length - 1].t - rolls[0].t;
const activeSpan = span - rolls.slice(1).reduce((n, r, i) => n + (r.t - rolls[i].t > 40 ? r.t - rolls[i].t - 4 : 0), 0);
const xpBase = xps.reduce((n, x) => n + x.fine, 0) / 10; // tenths -> base xp
const durations: Record<number, number> = {};
for (const l of treeLocs) durations[l.duration] = (durations[l.duration] ?? 0) + 1;
const perTick: Record<number, number> = {};
for (const o of opheld) perTick[o.t] = (perTick[o.t] ?? 0) + 1;
const summary = {
    rolls: rolls.length, successes: succ,
    successRate: +(succ / rolls.length).toFixed(4), expectedRate: +(expected / rolls.length).toFixed(4),
    zScore: +((succ - expected) / sd).toFixed(2),
    levels: [...new Set(rolls.map(r => r.lvl))].slice(0, 10),
    rollGapHistogram: gapHist,
    ticksLost: lost, ticksLostAfterDepletion: lostAfterDepletion, ticksLostOther: lostOther,
    longWaits: waitsAllDown,
    depletions: depleteTicks.size, depletionPerLog: +(depleteTicks.size / succ).toFixed(4),
    respawnDurations: durations,
    xpBase, firstToLastRollTicks: span, activeTicks: activeSpan,
    baseXpPerTickActive: +(xpBase / (activeSpan + 4)).toFixed(3),
    movedTicks: moved.length,
    opheld: opheld.length, opheldRejected: opheld.filter(o => !o.ok).length, maxOpheldInOneTick: Math.max(0, ...Object.values(perTick)),
    oploc: oploc.length, oplocRejected: oploc.filter(o => !o.ok).length,
    clickPhase,
    levelUps: levelUpTicks.size,
};
console.log(`SUMMARY ${JSON.stringify(summary)}`);
for (const e of lostEvents) console.log(`LOST ${e}`);
