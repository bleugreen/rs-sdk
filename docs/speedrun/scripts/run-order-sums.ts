// RUN-ORDER.md and STEP-MANIFEST.md re-summed from their own tables, with the cross-checks a
// fold-in must keep: section 2's step table against its "Steps and legs" row, section 6's leg
// cells against the table's legs, section 7's lines against its total rows, the M / I / E split
// against the knife-on total, STEP-MANIFEST.md section 1 against the step table, the burst-fails
// line against the quests still exposed, and S16's Magic 77 with O43a on.
//
//   bun docs/speedrun/scripts/run-order-sums.ts
//   EXPECT=34914.4,32624.7,37569.4,35738.7,38305.4,36504.7 bun docs/speedrun/scripts/run-order-sums.ts
//   FROM=34842,32520.7,37497,35634.7,38233,36400.7 EXPECT=... bun docs/speedrun/scripts/run-order-sums.ts
//
// EXPECT pins section 7's six totals (knife on expected / best, knife off in force, knife off
// without rs/162); a bookkeeping change runs it before and after with the same EXPECT. Exits 1 on
// any mismatch. FROM names the six totals before a re-pricing and prints each one's change. Figures may carry half ticks (legs measured to 0.5, the Grand Tree's segment A).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { baseToXp, levelForXp } from '../../../speedrun/lib/xp.ts';

const dir = join(import.meta.dir, '..');
const ro = readFileSync(join(dir, 'RUN-ORDER.md'), 'utf8').split('\n');
const man = readFileSync(join(dir, 'STEP-MANIFEST.md'), 'utf8').split('\n');
const cells = (l: string) => l.split('|').slice(1, -1).map(x => x.trim());
const num = (t: string) => Number(t.replace(/[*,]/g, ''));
const NUM = String.raw`[+-]?[\d,]+(?:\.\d+)?`;
const lead = (s: string) => {
    const m = s.replace(/\*/g, '').match(new RegExp(`^(?:knife )?(${NUM})`));
    if (!m) throw new Error(`no leading figure in: ${s.slice(0, 60)}`);
    return num(m[1]!);
};
const pair = (cell: string) => {
    const m = cell.match(new RegExp(String.raw`\*{0,2}(${NUM}) \/ (${NUM})`));
    if (!m) throw new Error(`no pair in: ${cell.slice(0, 60)}`);
    return [num(m[1]!), num(m[2]!)] as const;
};
const r1 = (x: number) => Math.round(x * 10) / 10;
const fail: string[] = [];
const eq = (a: number, b: number, what: string) => { if (Math.abs(a - b) > 0.05) fail.push(`${what}: ${r1(a)} against ${r1(b)}`); };

// Section 2: every row's own figure; S25 is the block row (S25a + S25c + S25d + S25e).
const h = ro.findIndex(l => l.startsWith('| ID | Kind |'));
let se = 0, sb = 0, le = 0, lb = 0, footer: string[] = [];
const byKind: Record<string, number> = {};
for (const l of ro.slice(h + 2)) {
    if (!l.startsWith('|')) break;
    const c = cells(l);
    if (c[0] === '') { footer = c; break; }
    if (c[0] === 'S25') continue;
    const e = lead(c[5]!), b = lead(c[6]!);
    const leg = c[0]!.startsWith('T') || c[0] === 'S24 legs';
    if (leg) { le += e; lb += b; } else { se += e; sb += b; }
    const k = `${leg ? 'legs' : 'steps'} ${c[1]}`;
    byKind[k] = (byKind[k] ?? 0) + e;
}
console.log(`section 2: steps ${r1(se)} / ${r1(sb)}, legs ${r1(le)} / ${r1(lb)}, sum ${r1(se + le)} / ${r1(sb + lb)}; its row ${footer[5]} / ${footer[6]}`);
console.log(`  expected by Kind: ${Object.entries(byKind).map(([k, v]) => `${k} ${r1(v)}`).join('; ')}`);
eq(se + le, num(footer[5]!), 'section 2 expected against its "Steps and legs" row');
eq(sb + lb, num(footer[6]!), 'section 2 best against its "Steps and legs" row');

// The burst-fails line (section 7's go/no-go table): each quest not yet browser-confirmed reverts from
// its burst expected to its row's fixed fallback ('**fixed N m**' or '**Fixed fallback N m'); a quest
// leaves EXPOSED when its browser run confirms its burst figure (main's ruling, fold-in 24).
const EXPOSED = ['S15', 'S16', 'S08'];
const burstFails = EXPOSED.map(id => {
    const l = ro.slice(h + 2).find(x => x.startsWith(`| ${id} |`));
    if (!l) throw new Error(`section 2 has no ${id} row`);
    const fx = l.match(new RegExp(String.raw`\*\*[Ff]ixed (?:fallback )?(${NUM}) m`));
    if (!fx) throw new Error(`${id}: no fixed fallback figure in its row`);
    return [id, num(fx[1]!) - lead(cells(l)[5]!)] as const;
});
const bf = burstFails.reduce((a, [, d]) => a + d, 0);
const bfRow = ro.find(l => l.startsWith('| **Burst dialogue fails on the night'));
const bfCell = bfRow && cells(bfRow)[1]!.match(new RegExp(String.raw`^\*\*\+(${NUM})\*\*`));
console.log(`burst-fails line: ${burstFails.map(([id, d]) => `${id} +${r1(d)}`).join(', ')} = +${r1(bf)}; the go/no-go table says +${bfCell?.[1] ?? '?'}`);
if (!bfCell) fail.push('the go/no-go table has no "Burst dialogue fails on the night" row with a bold +N');
else eq(bf, num(bfCell[1]!), 'the burst-fails line against the go/no-go table');

// Section 6: the legs column's labelled figures.
const s6 = ro.findIndex(l => l.startsWith('| Steps | Legs'));
let s6legs = 0;
for (const l of ro.slice(s6 + 2)) {
    const c = cells(l);
    if (c[0]!.startsWith('**Run-wide')) break;
    for (const m of c[1]!.matchAll(new RegExp(`(${NUM}) [mir]\\b`, 'g'))) s6legs += num(m[1]!);
}
console.log(`section 6: legs ${r1(s6legs)}`);
eq(s6legs, le, 'section 6 legs against section 2');

// Section 7: each line, with 'same' and the bracketed 'without rs/162, history' cells.
const st = ro.findIndex(l => l.startsWith('| Line (tally id) |'));
const sums = [0, 0, 0, 0, 0, 0];
let total: string[] = [], totalH: string[] = [];
for (const l of ro.slice(st + 2)) {
    const c = cells(l);
    if (c[0]!.startsWith('**Total**')) { total = c; continue; }
    if (c[0]!.startsWith('Total, knife off without')) { totalH = c; break; }
    const on = pair(c[2]!);
    const off = c[3] === 'same' ? on : pair(c[3]!);
    const hm = c[3]!.match(new RegExp(String.raw`\((${NUM}) \/ (${NUM}) without rs\/162, history\)`));
    const hi = hm ? [num(hm[1]!), num(hm[2]!)] : off;
    [on[0], on[1], off[0], off[1], hi[0]!, hi[1]!].forEach((v, i) => (sums[i]! += v));
    console.log(`  ${c[0]}: ${on.join(' / ')}`);
}
const want = [...pair(total[2]!), ...pair(total[3]!), ...pair(totalH[3]!)];
console.log(`section 7: knife on ${r1(sums[0]!)} / ${r1(sums[1]!)}; knife off in force ${r1(sums[2]!)} / ${r1(sums[3]!)}; without rs/162 (history) ${r1(sums[4]!)} / ${r1(sums[5]!)}`);
sums.forEach((v, i) => eq(v, want[i]!, `section 7 column ${i + 1} against its total row`));
const exp = process.env.EXPECT?.split(',').map(Number);
if (exp) exp.forEach((v, i) => eq(sums[i]!, v, `section 7 column ${i + 1} against EXPECT`));
const from = process.env.FROM?.split(',').map(Number);
if (from) {
    const d = sums.map((v, i) => r1(v - from[i]!)).map(x => (x > 0 ? `+${x}` : `${x}`));
    console.log(`change against FROM: knife on ${d[0]} / ${d[1]}; knife off in force ${d[2]} / ${d[3]}; without rs/162 (history) ${d[4]} / ${d[5]}`);
}

// M / I / E split.
const mie = ro.filter(l => /^\| [MIE]: /.test(l)).map(l => num(cells(l)[1]!));
const mieSum = mie.reduce((a, b) => a + b, 0);
console.log(`M / I / E: ${mie.join(' / ')} = ${r1(mieSum)} (${mie.map(v => `${((100 * v) / sums[0]!).toFixed(1)}%`).join(' / ')})`);
eq(mieSum, sums[0]!, 'M / I / E against the knife-on total');

// Scenario rows (section 7) and the headline's.
for (const l of ro.filter(l => l.startsWith('| **Knife-on total**') || l.startsWith('| Against the record (exp)'))) console.log(`scenarios: ${cells(l).join(' | ')}`);

// STEP-MANIFEST.md section 1.
const mh = man.findIndex(l => l.startsWith('| Rank | # | Entry |'));
let ms = 0, msb = 0, ml = 0, mlb = 0;
for (const l of man.slice(mh + 2)) {
    if (!l.startsWith('|')) break;
    const c = cells(l);
    if (!/^[\d,]/.test(c[5]!)) continue; // the run chain's row carries no step ticks
    if (c[2] === 'Transition legs') { ml = lead(c[5]!); mlb = lead(c[6]!); } else { ms += lead(c[5]!); msb += lead(c[6]!); }
}
console.log(`STEP-MANIFEST.md section 1: steps ${r1(ms)} / ${r1(msb)}, legs ${r1(ml)} / ${r1(mlb)}`);
eq(ms, se, 'manifest steps (expected) against section 2'); eq(msb, sb, 'manifest steps (best) against section 2');
eq(ml, le, 'manifest legs (expected) against section 2'); eq(mlb, lb, 'manifest legs (best) against section 2');

// O43a's guard: with defensive casting on, S16 must still arrive at Magic 77 (Fire Wave's 75 boosted
// and S18's Charge at 80 rest on it); the sensitivity row states the arrival, the Magic O43a gives up
// and the result, and this re-derives the level from the engine's curve.
const o43a = ro.join('\n').match(new RegExp(String.raw`S16 would arrive at (${NUM}) - (${NUM}) = (${NUM}) base Magic, still level (\d+)`));
if (!o43a) fail.push('O43a: no "S16 would arrive at A - B = C base Magic, still level L" sentence in RUN-ORDER.md');
else {
    const [arrive, cost, left, lvl] = [num(o43a[1]!), num(o43a[2]!), num(o43a[3]!), Number(o43a[4])];
    const level = levelForXp(baseToXp(left));
    console.log(`O43a: S16 arrives at ${arrive} - ${cost} = ${r1(arrive - cost)} base Magic, level ${level} (the row says ${lvl})`);
    eq(arrive - cost, left, 'O43a: the arrival less the Magic it gives up');
    if (level !== lvl) fail.push(`O43a: level ${level} against the row's ${lvl}`);
    if (level < 77) fail.push(`O43a: S16 would arrive at Magic ${level}, under 77`);
}

// R29's closed-door sensitivity (rs/484): a browser walk misses a closed door at click time and stalls
// ~+9 before opening it. Browser-measured rows carry it; this counts, in the quest docs of the quests
// measured only on lite, the route-table rows that pass a door (trapdoors and the way-in leg excluded):
// an upper bound (i), since doors a module opens by click are not hopRun's to miss.
const LITE_ONLY: Record<string, string> = { S08: 'plague_city.md', S11b: 'grand_tree.md', S15: 'monkey_madness.md', S16: 'mage_arena.md' };
let doors = 0;
const byQuest = Object.entries(LITE_ONLY).map(([row, f]) => {
    const n = readFileSync(join(dir, 'quests', f), 'utf8').split('\n')
        .filter(l => /^\| ?([A-Z]\d?|\d+) \|/.test(l) && !/Camelot teleport/.test(l))
        .reduce((k, l) => k + (l.replace(/trapdoor/gi, '').match(/\bdoors?\b/gi) ?? []).length, 0);
    doors += n;
    return `${row} ${n}`;
});
console.log(`R29 door sensitivity (lite-only quests): ${byQuest.join(', ')}; ${doors} doors x ~9 = ~+${doors * 9} at most (i)`);

if (fail.length) { console.error(`FAIL\n${fail.join('\n')}`); process.exit(1); }
console.log('every cross-check passes');
