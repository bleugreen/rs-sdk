// Summarise a flinch-trace.patch engine log (FLTRACE lines) for one lab run.
//
//   bun docs/speedrun/scripts/flinch-trace-summary.ts <engine.log> [fromTick] [toTick]
//
// Per tick it reads: hits (combat_damage_player runs), retaliate queue runs (busy2 inputs
// and %action_delay before/after, so whether the flinch wrote the clock and, if not, why),
// woodcutting rolls, and the player's own ranged/melee attack firing (an attack label run
// that moves %action_delay forward by its attackrate).
import { readFileSync } from 'fs';

const [file, fromArg, toArg] = process.argv.slice(2);
const from = Number(fromArg ?? 0), to = Number(toArg ?? Infinity);
const lines = readFileSync(file, 'utf8').split('\n').filter(l => l.startsWith('FLTRACE '));

const hits: number[] = [], rolls: number[] = [], fired: number[] = [];
const ret = { write: 0, busy: 0, notExpired: 0, retaliateOff: 0 };
const flinchWrites: number[] = [];
for (const l of lines) {
    const t = Number(l.split(' ')[1]);
    if (t < from || t > to) continue;
    if (/script=\[queue,combat_damage_player\]/.test(l)) hits.push(t);
    if (/roll stat=8 /.test(l)) rolls.push(t);
    const m = /script=\[queue,playerhit_n_retaliate\].* before: inter=(\d) wp=(\d) .*ad=(-?\d+) nodef=(\d+) after: .*ad=(-?\d+)/.exec(l);
    if (m) {
        const [inter, wp, before, nodef, after] = m.slice(1).map(Number);
        if (nodef !== 0) ret.retaliateOff++; // %option_nodef 0 = auto-retaliate on
        else if (inter || wp) ret.busy++;
        else if (before >= t) ret.notExpired++;
        else { ret.write++; flinchWrites.push(t); if (after !== t + 1 && after !== t + 2) console.log(`odd write t=${t} ${before}->${after}`); }
    }
    const a = /script=\[\w+,_\]->\[label,player_(ranged|melee)_attack\].* before: .*ad=(-?\d+) nodef.* after: .*ad=(-?\d+)/.exec(l);
    if (a && Number(a[3]) > Number(a[2]) && Number(a[3]) > t) fired.push(t);
}
const rollAfterWrite = rolls.filter(r => flinchWrites.includes(r - 1)).length;
const gaps: Record<number, number> = {};
for (let i = 1; i < rolls.length; i++) { const g = rolls[i] - rolls[i - 1]; gaps[g] = (gaps[g] ?? 0) + 1; }
console.log(`ticks ${from}-${to === Infinity ? 'end' : to}: hits=${hits.length} rolls=${rolls.length} rollsOnTickAfterFlinchWrite=${rollAfterWrite} ownAttacksFired=${fired.length}${fired.length ? ` (at ${fired.slice(0, 20).join(',')})` : ''}`);
console.log(`retaliate queue runs: flinch write ${ret.write}, busy2 true ${ret.busy}, clock not expired ${ret.notExpired}, auto-retaliate off ${ret.retaliateOff}`);
console.log(`roll gaps (ticks:count): ${Object.entries(gaps).map(([g, c]) => `${g}:${c}`).join(' ')}`);
