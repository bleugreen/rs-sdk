// RUN-ORDER.md and STEP-MANIFEST.md re-summed from their own tables, with the cross-checks a
// fold-in must keep: section 2's step table against its "Steps and legs" row, section 6's leg
// cells against the table's legs, section 7's lines against its total rows, the M / I / E split
// against the knife-on total, STEP-MANIFEST.md section 1 against the step table, the burst-fails
// line against the quests still exposed, and S16's Magic 77 with O43a on.
//
//   bun docs/speedrun/scripts/run-order-sums.ts
//   EXPECT=34914.4,32624.7,37569.4,35738.7,38305.4,36504.7 bun docs/speedrun/scripts/run-order-sums.ts
//   FROM=34842,32520.7,37497,35634.7,38233,36400.7 EXPECT=... bun docs/speedrun/scripts/run-order-sums.ts
//   bun docs/speedrun/scripts/run-order-sums.ts --write-ladder   (regenerates section 7's margin ladder)
//
// EXPECT pins section 7's six totals (knife on expected / best, knife off in force, knife off
// without rs/162); a bookkeeping change runs it before and after with the same EXPECT. Exits 1 on
// any mismatch. FROM names the six totals before a re-pricing and prints each one's change. Figures may carry half ticks (legs measured to 0.5, the Grand Tree's segment A).
import { readFileSync, writeFileSync } from 'node:fs';
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
const EXPOSED = ['S16'];
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

// The browser door-click sensitivity (fold-in 31; main 15:3x): +1 a door or gate click on the scored path
// outside the rows priced on the browser, host-measured (rs/413, rs/401, rs/484 on bgsrv-mac). #419 closed
// R29's ~+9 stall a door. The quests priced only on lite are counted from their route tables' rows that
// pass a door (trapdoors and the way-in leg excluded), an upper bound (i); the skill rows' gate clicks are
// listed from their modules. S08 (fold-in 31) and S11b (fold-in 28) are priced on the browser.
const LITE_ONLY: Record<string, string> = { S15: 'monkey_madness.md', S16: 'mage_arena.md' };
const SKILL_GATES: Record<string, number> = { "S17's ridge gate (agility.ts RIDGE_GATE)": 1 };
let doors = 0;
const byQuest = Object.entries(LITE_ONLY).map(([row, f]) => {
    const n = readFileSync(join(dir, 'quests', f), 'utf8').split('\n')
        .filter(l => /^\| ?([A-Z]\d?|\d+) \|/.test(l) && !/Camelot teleport/.test(l))
        .reduce((k, l) => k + (l.replace(/trapdoor/gi, '').match(/\bdoors?\b/gi) ?? []).length, 0);
    doors += n;
    return `${row} ${n}`;
});
const gateClicks = Object.values(SKILL_GATES).reduce((a, b) => a + b, 0);
export const doorClicks = doors + gateClicks;
console.log(`browser door-click sensitivity: ${byQuest.join(', ')}, ${Object.entries(SKILL_GATES).map(([k, v]) => `${k} ${v}`).join(', ')}: +${doorClicks} (i, +1 a click)`);
const dcRow = ro.find(l => l.startsWith('| **Browser door-click**'));
const dc = dcRow?.match(/\| \*\*\+(\d+) \(i\)\*\* \|/);
if (!dc) fail.push('the sensitivity table has no "Browser door-click" row with a bold +N (i)');
else eq(doorClicks, Number(dc[1]), 'the browser door-click count against its sensitivity row');

// The scenario rows: each column's knife-on total is section 7's every-line-held total plus its deltas.
const scen = (lead: string) => ro.find(l => l.startsWith(lead));
const deltaRow = scen('| **Deltas**'), totRow = scen('| **Knife-on total**');
if (!deltaRow || !totRow) fail.push('section 7 has no scenario Deltas / Knife-on total rows');
const inForce = totRow ? pair(cells(totRow)[1]!) : [0, 0];
if (deltaRow && totRow) cells(deltaRow).slice(1).forEach((c, i) => {
    const [de, db] = pair(c.replace(/\+/g, '')), [te, tb] = pair(cells(totRow)[i + 1]!);
    eq(sums[0]! + de, te, `scenario column ${i + 1}: every line held plus its deltas (expected)`);
    eq(sums[1]! + db, tb, `scenario column ${i + 1}: every line held plus its deltas (best)`);
});

// The margin ladder (fold-in 31; main 15:5x-18:0x via rs/158): the row in force's best, expected and bad
// rows against the record, then every open line signed and sized, with its label, owner, what closes it
// and whether the bad row sums it. Written between its markers by `--write-ladder`; otherwise checked.
const RECORD = 35916;
type Line = { label: string; ticks: number | null; size?: string; mie: string; owner: string; closes: string; summed: 'yes' | 'no' | 'closed' | 'blocking' | 'attempt-ending' };
const bf1 = r1(bf);
const UNFAV: Line[] = [
    { label: "Monkey Madness's bad case: one rope pin (~392 a pin, 130.7 of it in the expected)", ticks: 261.3, mie: 'i', owner: 'rs/185, rs/201', closes: 'a route that avoids the pin (lever 3)', summed: 'yes' },
    { label: "S13's railings at p90 (37 tries at the formula rate; the variance is the server's roll, 23.8% at Crafting 1, not click timing)", ticks: 150, mie: 'i', owner: 'rs/257', closes: 'a priced line (main 18:0x); a Crafting or Smithing level before S13 (lever 4) narrows it', summed: 'yes' },
    { label: `Burst dialogue fails on the night (${burstFails.map(([id, d]) => `${id} +${r1(d)}`).join(', ')}; by script)`, ticks: bf1, mie: 'm', owner: 'rs/185 (O51)', closes: "S16's browser burst run", summed: 'yes' },
    { label: "H12o's two legs at their measured 6 against the priced 4 (+2 a leg)", ticks: 4, mie: 'm', owner: 'rs/201, rs/41', closes: "the gate round's chains", summed: 'yes' },
    { label: "S18d at 70-74 Superheat stuns (+16 at the bound against the expected's +9)", ticks: 7, mie: 'i', owner: 'rs/147', closes: "S18's browser band (rs/522's lab: 72 stuns, Fletching 98, inside the +9)", summed: 'yes' },
    { label: 'Browser door-click, host-measured (rs/413, rs/401, rs/484 on bgsrv-mac): +1 a click outside the browser-priced rows', ticks: doorClicks, mie: 'i', owner: 'rs/496', closes: "rs/496's twin rows", summed: 'yes' },
    { label: "S10b K: a contested warlord, a bounded wait for its 300-tick respawn once rs/520 lands", ticks: 300, size: '+~300', mie: 'i', owner: 'rs/520, rs/185', closes: 'needs another player at K; the boundary check holds logged out first', summed: 'no' },
    { label: "S11b's tree doors, both open: a wait for one to close", ticks: null, size: '~+4 a crossing', mie: 'm', owner: 'rs/521, rs/536', closes: 'needs other players at both doors', summed: 'no' },
    { label: 'Competition, a fail plus a resume (S26 C/E/G, S19, S11b N1, S13 D, S08, S20 H, S12 C/E/F/H, S24; R54)', ticks: null, size: 'tens to ~100 each', mie: 'i', owner: 'rs/185, rs/520', closes: 'needs another player; a range, not summed', summed: 'no' },
    { label: 'A Wilderness death (R8): r8-deaths.ts by phase, recovery staged (rs/526)', ticks: null, size: '~24-209 a death', mie: 'i', owner: 'rs/41, rs/526, rs/186', closes: "rs/526's packages rechecked; recover-now or RUN-HOST's manual fallback", summed: 'no' },
    { label: 'A pre-H13 Wilderness death: the iron substitute for the lost Khazard set (rs/201)', ticks: 20, size: '+~20 at X + the recovery', mie: 'i', owner: 'rs/201, rs/526', closes: "R8a / R8b's iron med helm and platebody", summed: 'no' },
    { label: "After a death in S27 (R8d1): raw materials held (steel 300, rune arrows 570, rs/41 01:44Z); the bow pending, so S27 bow-only until it is held; the balls not yet smithed: the cannon's recovery needs up to ~1,200 with 116 spare held, a gap of ~1,084 (~1,154 after the rehearsal's ~70; h92's smithing window waiting on rs/496); unstaged", ticks: null, size: 'unpriced', mie: 'e', owner: 'rs/41, rs/526', closes: "rs/41's stock received and rs/526's corrected packages rechecked", summed: 'no' },
    { label: "S21's unconfirmed logout (rs/310's session D: 117 in the world after a tab-path logout); once rs/511 is on the floor, a logout not confirmed within 4 ticks re-sends (lab: 21 of 21 confirmed by the page, 0 ticks, 1 send each)", ticks: null, size: 'unpriced (manual) until rs/511 is on the floor', mie: 'm', owner: 'rs/511, rs/490', closes: "rs/511 on the floor (not a start condition, main); the operator's check until then", summed: 'no' },
    { label: "A dropped session with no restart (R53): once rs/511 is on the floor ~25 a drop (24-26 from the drop to back in the world) plus the step cost (T23-24 94 to 87 / 84; S25e's bank burst 121 to 118; Fishing's fly band +25% to +60% a drop, 21 of it the gate re-probe); the budget S21's relog + 3 unplanned, run.ts and the operator together", ticks: null, size: 'unpriced (manual) until rs/511 is on the floor; then ~25 a drop + the step cost', mie: 'm', owner: 'rs/511, rs/186', closes: "rs/511 on the floor (not a start condition, main); RUN-HOST's manual relog until then", summed: 'no' },
    { label: "A drop at Wilderness level 21+ between the keep and the spiders (R8, R53): run.ts resumes at the leg's last run hop above 20 (deepWildernessHop), else a ResumeError, the operator walking SCORED south to 20 and restarting from the teleport; unit-tested only, a fallback, not a measured row", ticks: null, size: 'the walk back + the teleport again', mie: 'i', owner: 'rs/511, rs/186', closes: "a lab acceptance of rs/511's deepWildernessHop", summed: 'no' },
];
const ENDING: Line[] = [
    { label: "Helper delivery readiness (R52): rs/529 multi-location mule delivery + rs/532 runner consumer + generated configs with a measured route per served location", ticks: null, mie: '-', owner: 'rs/41', closes: 'accepted by 09:00Z, else main rules between a bounded extension inside the 13:00Z freeze and postponing attempt 1', summed: 'blocking' },
    { label: "H13's hand-back fails on the untradeable Khazard set (R51)", ticks: null, mie: '-', owner: 'rs/488', closes: 'rs/539 (the drop fix) merged', summed: 'attempt-ending' },
    { label: 'Possibly run-ending competition (R54): S16 C, S10b K, S12 G-I (no own monster released, resuming from F), S15 X', ticks: null, mie: 'i', owner: 'rs/185, rs/520, rs/488', closes: "rs/520's guard if honestly accepted; RUN-HOST's boundary checks before S16 C, S10b K and S12 F", summed: 'attempt-ending' },
    { label: "S11b's tree doors: neither shows Open within 8 ticks, a stop with a reason", ticks: null, mie: 'm', owner: 'rs/536', closes: 'rs/536 merged', summed: 'attempt-ending' },
    { label: 'A death on the atoll (R37): S15 assumes survival', ticks: null, mie: '-', owner: 'rs/185, rs/201', closes: "the kit gate's chains", summed: 'attempt-ending' },
    { label: "S18's rune-tier cliff (R50)", ticks: null, mie: '-', owner: 'rs/522', closes: 'closed: merged as #439 (835049bf)', summed: 'closed' },
    { label: "The 4-per-tick cap items (the quests' bursts +23, S18's cast tick, S25c +1, S27's fletching +14)", ticks: null, mie: 'm', owner: 'rs/507, rs/396', closes: 'closed: the cap measured at 5', summed: 'closed' },
];
const FAV: Line[] = [
    { label: 'MM burst dialogue (rs/513): no-go for attempt 1 (0 of 3 fast-dialogue chains)', ticks: -351, size: '~-351 (fold-in 14\'s assumed size, history)', mie: 'i', owner: 'rs/513', closes: 'lands after attempt 1, on its burst gate and segment acceptance', summed: 'no' },
    { label: "S18's crowded knight (rs/479): the crowd pins the knight", ticks: -190, size: 'up to ~-190', mie: 'i', owner: 'rs/479', closes: 'a note', summed: 'no' },
    { label: "S17's band under the model (rs/310: 52-99 in 4,886 against 4,982, one run)", ticks: -96, mie: 'm', owner: 'rs/310', closes: 'a note', summed: 'no' },
    { label: "Post-attempt: Fletching 99 inside S18, Charge pin ~154 (the bar drops off the cast ticks)", ticks: null, size: '-2 to -10', mie: 'i', owner: 'rs/147', closes: 'after attempt 1', summed: 'no' },
    { label: 'Charge on the new engine (rs/466: holds)', ticks: null, size: 'its +1,100 sensitivity removed', mie: 'm', owner: 'rs/466', closes: 'closed', summed: 'closed' },
];
const fmt = (x: number) => x.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const vsRecord = (t: number) => (t > RECORD ? `${fmt(t - RECORD)} over` : `${fmt(RECORD - t)} under`);
const signed = (x: number) => `${x >= 0 ? '+' : ''}${fmt(x)}`;
const [exp0, best0] = inForce as [number, number];
const summedLines = UNFAV.filter(l => l.summed === 'yes');
const badAdd = summedLines.reduce((a, l) => a + (l.ticks ?? 0), 0);
const mm = UNFAV[0]!.ticks!, s13 = UNFAV[1]!.ticks!;
const row = (l: Line) => `| ${l.label} | ${l.size ?? (l.ticks === null ? '-' : signed(l.ticks))} | ${l.mie} | ${l.owner} | ${l.closes} | ${l.summed} |`;
const ladder = [
    '| The row in force (knife on, the forecast at 2026-10-23 with the bones as staged) | Ticks | Against 35,916 |',
    '|---|---|---|',
    `| **Best** | ${fmt(best0)} | ${vsRecord(best0)} |`,
    `| **Expected** | **${fmt(exp0)}** | **${vsRecord(exp0)}** |`,
    `| Expected + Monkey Madness's bad case alone | ${fmt(exp0 + mm)} | ${vsRecord(exp0 + mm)} |`,
    `| Expected + S13's railings at p90 alone | ${fmt(exp0 + s13)} | ${vsRecord(exp0 + s13)} |`,
    `| Expected + both together (an accepted attempt-1 risk, not a start condition; main 18:0x) | ${fmt(exp0 + mm + s13)} | ${vsRecord(exp0 + mm + s13)} |`,
    `| **Bad**: the expected + every line marked 'yes' below, live together (${summedLines.length} lines, ${signed(badAdd)}) | **${fmt(exp0 + badAdd)}** | **${vsRecord(exp0 + badAdd)}** |`,
    '',
    '| Line | Ticks | m / i / e | Owner | What closes it | In the bad row |',
    '|---|---|---|---|---|---|',
    '| **Unfavourable** | | | | | |',
    ...UNFAV.map(row),
    '| **Attempt-ending, blocking or closed (unpriced: the cost is the attempt)** | | | | | |',
    ...ENDING.map(row),
    '| **Favourable, shown, never summed** | | | | | |',
    ...FAV.map(row),
    `| **The burst-fails line** (dialogue failing on the night): the quests still exposed, ${burstFails.map(([id, d]) => `${id} +${r1(d)}`).join(', ')} (S15 on its fixed basis and S08 browser-accepted off it since fold-in 31) | ${signed(bf1)} | m | rs/185 (O51) | each quest's browser burst run | yes (above) |`,
];
const START = '<!-- margin-ladder:start (generated by run-order-sums.ts --write-ladder; do not edit by hand) -->';
const END = '<!-- margin-ladder:end -->';
const roText = ro.join('\n');
const a = roText.indexOf(START), b = roText.indexOf(END);
if (a < 0 || b < a) fail.push('RUN-ORDER.md has no margin-ladder markers');
else {
    const body = `${START}\n${ladder.join('\n')}\n${END}`;
    if (process.argv.includes('--write-ladder')) {
        writeFileSync(join(dir, 'RUN-ORDER.md'), roText.slice(0, a) + body + roText.slice(b + END.length));
        console.log('margin ladder written');
    } else if (roText.slice(a, b + END.length) !== body) fail.push('the margin ladder in RUN-ORDER.md is stale: run with --write-ladder');
}
console.log(`margin ladder: best ${fmt(best0)}, expected ${fmt(exp0)} (${vsRecord(exp0)}), MM bad ${fmt(exp0 + mm)}, S13 p90 ${fmt(exp0 + s13)}, both ${fmt(exp0 + mm + s13)}, bad ${fmt(exp0 + badAdd)} (${vsRecord(exp0 + badAdd)})`);

if (fail.length) { console.error(`FAIL\n${fail.join('\n')}`); process.exit(1); }
console.log('every cross-check passes');
