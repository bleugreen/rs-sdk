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
    for (const m of c[1]!.matchAll(new RegExp(`(${NUM}) [mire]\\b`, 'g'))) s6legs += num(m[1]!);
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
type Line = { label: string; ticks: number | null; size?: string; mie: string; owner: string; closes: string; summed: 'yes' | 'no' | 'closed' | 'blocking' | 'attempt-ending' | 'unverified resume (attempt 2)'  };
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
    { label: 'A Wilderness death (R8): r8-deaths.ts by phase, recovery staged (rs/526)', ticks: null, size: '~24-209 a death', mie: 'i', owner: 'rs/41, rs/526, rs/186', closes: "rs/526's default-cost fix proven from the JSON (4e34e949 fail-closed, rs/41's recheck 26/26); recover-now or RUN-HOST's manual fallback", summed: 'no' },
    { label: 'A pre-H13 Wilderness death: the iron substitute for the lost Khazard set (rs/201)', ticks: 20, size: '+~20 at X + the recovery', mie: 'i', owner: 'rs/201, rs/526', closes: "R8a / R8b's iron med helm and platebody", summed: 'no' },
    { label: "After a death in S27 (R8d1): stock held, staging pending (rs/41 / rs/331 via rs/158, fold-in 32: 1 magic shortbow and 570 rune arrows on h68; cannonballs 2,616 on h92: attempt 1's H11 + H23 take 1,300, the rehearsal ~70, leaving ~1,246 for an S27 re-supply of up to ~1,200); the spawn helper (h94) not yet staged, pending rs/526's cost-default fix and rs/41's go", ticks: null, size: 'stock held, staging pending', mie: 'e', owner: 'rs/41, rs/526', closes: "h94 staged; then R8d1 priced as a recovery (R8)", summed: 'no' },
    { label: "S21's unconfirmed logout (rs/310's session D: 117 in the world after a tab-path logout); once rs/547 is on the floor, a logout not confirmed within 4 ticks re-sends (lab: 21 of 21 confirmed by the page, 0 ticks, 1 send each)", ticks: null, size: 'unpriced (manual) until rs/547 is on the floor', mie: 'm', owner: 'rs/547, rs/490', closes: "rs/547 on the floor (not a start condition, main); the operator's check until then", summed: 'no' },
    { label: "A dropped session with no restart (R53): once rs/547 (rs/511's successor) is on the floor, ~24-25 a drop from the drop to back in the world, a leg or bank burst's step cost inside it (T23-24, S25e), S22 about 46 a drop (24-25 + 21 for fishing.ts's gate re-probe, kept by design; rs/147 via rs/511's lab); the budget S21's relog + 3 unplanned, run.ts and the operator together; it holds from S09 on as well since A (#462) and B (#453) are on main (fold-in 35)", ticks: null, size: 'unpriced (manual) until rs/547 is on the floor; then ~24-25 a drop (S22 ~46)', mie: 'm', owner: 'rs/547, rs/186', closes: "rs/547 on the floor (not a start condition, main); RUN-HOST's manual relog until then", summed: 'no' },
    { label: "Helper readiness fails closed under load: on a CPU-starved machine a helper's held-status goes stale past 3 s against its 400 ms writes, so a healthy helper reads as not ready and its hand-off is sat out (main 22:3x; the load ceiling under 4.0, RUN-HOST step 6; 2.18 / 2.27 peak measured with the recording on and no helpers)", ticks: null, size: "a sat-out hand-off, at that step's fallback", mie: 'i', owner: 'rs/496, the host', closes: "rs/496's rehearsal measuring load with S21's ~22 givers on the machine; unpriced until then", summed: 'no' },
    { label: "Any step that throws: run.ts never re-invokes it (runner/step.ts:281-282), so the operator re-runs the same command (RUN-HOST, 'Re-running after a StepError') and resolveResume enters the first undone step through its resume; attempt-ending instead where the step's resume does not admit its own post-throw state (the lines below); S00 has none (start.ts at ee75d700: every throw inside skip, entered only from Tutorial Island); a throw in combat (logout refused) is relaunched at once in the live session (RUN-HOST, main 23:3x)", ticks: null, size: '~150-450 a throw (i)', mie: 'i', owner: 'rs/186, rs/574', closes: "rs/574's measured kill-and-re-run (rs/546's successor)", summed: 'no' },
    { label: "The walker: bot.walkTo looping in-tick on steps the webclient's pathfinder refuses (rs/548; rs/186's fix at 01304312, byte-identical to 5bb7ce28, on main as #459 (a1ce2209, rs/564), browser-accepted by rs/556 on bgsrv-ub: K 3 of 3, M 3 of 3, S06's in-room walk, T10-11 and T14-15 3 of 3 each), S15 K and M the only known tiles, why the browser's collision map disagrees with the server's OPEN; and rs/564's nearer-tile fallback, which also fires on ordinary out_of_range refusals (seen on lite after knockouts and on the browser, no failures; main)", ticks: null, size: '+1 a refused step on every scored browser bot.walkTo, plus ~2-3 a waypoint where the fallback fires on an out_of_range refusal (once ~150 in a maze) on every scored bot.walkTo', mie: 'i', owner: 'rs/186, rs/556, rs/564', closes: 'the collision-map disagreement explained; the fallback narrowed to client_rejected after attempt 1', summed: 'no' },
    { label: "S15 G, a jungle scorpion present, the fix on main with the Monkey Madness module (#455, d62b78aa) (rs/201 exec 9's lab: forced adjacent 117 / 103 / 102, staged 117 / 103 / 112, against the row's 90-92; 0 damage)", ticks: null, size: '+12 to +27 a visit and 2-3 prayer points; absent +0', mie: 'm', owner: 'rs/201, rs/185', closes: 'a sensitivity outside the expected', summed: 'no' },
    { label: "S15 T, once rs/575 is on main: a minder refusal recovered inside T by follow-up (c) (exclude the refusing minder, reposition to a clear-line cage tile, wait up to 40 ticks, 5 tries; rs/201 exec 9, bgsrv-mac, lite, 400 ms: forced T 6 of 6, 107 / 108 / 106 / 106 / 114 / 107, mean 108; run 4 recovered a real refusal)", ticks: 9, size: '~+9 an occurrence', mie: 'm', owner: 'rs/185, rs/201', closes: 'a sensitivity outside the expected; attempt-ending until rs/575 merges (below)', summed: 'no' },
    { label: "S15 T, once rs/575 is on main: a throw after (c)'s 5 tries, then the operator's re-run (the relaunch enters U, which lets SCORED out of the cage first; U's 328 otherwise unchanged)", ticks: 28, size: '~+28 an occurrence (relog ~13 + U let-out 15)', mie: 'm', owner: 'rs/185, rs/201', closes: 'a sensitivity outside the expected; attempt-ending until rs/575 merges (below)', summed: 'no' },
    { label: "S15 N, once rs/575 is on main: a throw right after the trapdoor landing under the temple, then the re-run at once in the live session (N's precondition admits onAtoll || underTemple; resumed N finished in 50)", ticks: 120, size: '~+120 an occurrence beyond the 54 already spent (~69 of logout refused in combat, 27.6 s of tries, + N 50)', mie: 'm', owner: 'rs/185, rs/201', closes: "a sensitivity outside the expected; attempt-ending until rs/575 merges (below); never wait out the logout (one lab attempt died there; RUN-HOST's in-combat rule)", summed: 'no' },
    { label: "S15 P, the helper present but never accepting (rs/201's follow-up (b), lab, 400 ms: P moves on after 2 attempts, each open trade window declined in 1 tick, h45 sent home by the final stop; replaces the 0-1 tick note for leaving with the trade open and the earlier ~40 for an absent helper)", ticks: 128, size: '+128 (measured on (b), pending its snapshot)', mie: 'm', owner: 'rs/185, rs/201', closes: "(b)'s snapshot (rs/185 19462917, filed behind rs/575); a sensitivity outside the expected", summed: 'no' },
    { label: "S15 P, the helper not answering at all (rs/201's follow-up (b), lab, 400 ms)", ticks: 44, size: '+44 (measured on (b), pending its snapshot)', mie: 'm', owner: 'rs/185, rs/201', closes: "(b)'s snapshot; a sensitivity outside the expected", summed: 'no' },
    { label: "S15 P, a knockout during the helper wait at the jump landing: P throws and its resume admits the state (rs/185's code read at 19462917: knocked into the cell, P's pre passes, monkey-madness.ts:2892; toZooknock's town branch :2169, leaveCell first :1298, the climb, the jump :2178, P's leg with its 30-tick helper wait :2180; left at the landing outside town, the jump and leg are skipped); never seen on the scored path (rs/463: nothing attacks a waiting 10-HP account on that tile, the nearest danger 22 tiles; 0 in tonight's 3 lite gate runs, the clean browser chain and every P run; exec 9's one case a deliberately exercised failure path)", ticks: null, size: 'operator restart ~150-450 (i) + leave cell, re-walk, re-jump and leg ~60-170 (i); rate unmeasured', mie: 'i', owner: 'rs/185', closes: "rs/566's jailSafe wrap (attempt 2) recovers it in-process, without the operator", summed: 'no' },
    { label: "S15 P: a non-trade throw in receiveLeg left h45 logged in; (b) writes a final stop on every P exit (lab-accepted)", ticks: null, size: "no ticks; +1 session on SCORED's address through S21 (27 of 45, rs/41) until (b)'s snapshot", mie: 'i', owner: 'rs/185, rs/41', closes: "(b)'s snapshot (behind rs/575); h45's logout is one rule through the fleet API", summed: 'no' },
    { label: "A drop at Wilderness level 21+ between the keep and the spiders (R8, R53): run.ts resumes at the leg's last run hop above 20 (deepWildernessHop), else a ResumeError, the operator walking SCORED south to 20 and restarting from the teleport; unit-tested only, a fallback, not a measured row", ticks: null, size: 'the walk back + the teleport again', mie: 'i', owner: 'rs/547, rs/186', closes: "a lab acceptance of rs/547's deepWildernessHop (rs/511's)", summed: 'no' },
];
const ENDING: Line[] = [
    { label: "Helper delivery readiness (R52): rs/529 multi-location mule delivery + rs/532 runner consumer + generated configs with a measured route per served location, for three carriers (main 19:2x): east mule1, west h55 and an H20-only h03 (config and lab only); rs/551's delivery engine travels as fleet snapshot 12 (rs/555), its proof ending 08:44Z (01:44 PDT)", ticks: null, mie: '-', owner: 'rs/41', closes: 'fleet snapshot 12 merged with the consumer and a measured route per served location, by 09:00Z, else main rules between a bounded extension inside the 13:00Z freeze and postponing attempt 1', summed: 'blocking' },
    { label: "H13's hand-back fails on the untradeable Khazard set (R51)", ticks: null, mie: '-', owner: 'rs/488, rs/567', closes: "rs/567 (H13's drop mode re-derived on main, #441's successor; rs/539's PR #441 stalled) merged", summed: 'attempt-ending' },
    { label: 'Possibly run-ending competition (R54): S16 C, S10b K, S12 G-I (no own monster released, resuming from F), S15 X', ticks: null, mie: 'i', owner: 'rs/185, rs/520, rs/488', closes: "rs/520's guard if honestly accepted; RUN-HOST's boundary checks before S16 C, S10b K and S12 F", summed: 'attempt-ending' },
    { label: "S11b's tree doors: neither shows Open within 8 ticks, a stop with a reason", ticks: null, mie: 'm', owner: 'rs/536', closes: 'closed: rs/536 on main as #436 (36d29bf9; rs/521 dfae255a)', summed: 'closed' },
    { label: 'A death on the atoll (R37): S15 assumes survival', ticks: null, mie: '-', owner: 'rs/185, rs/201', closes: "the kit gate passed in fold-in 33 (three clean A-Z chains on 8e02fecc, 0 deaths, lowest HP 14, 13-14 sharks left) and the browser A-Z clean (rs/513 / rs/185, 23:35 PDT: 4,328, 0 deaths, lowest HP 18, 12 sharks left); still unpriced", summed: 'attempt-ending' },
    { label: "S15 G: the jungle scorpion on Crash Island killed SCORED's stand-in during Waydar's Lumdo talk (rs/513's chain; Defence 1); the fix lab-accepted (rs/201 exec 9, 8dad5fba, the lab on 30e027bc: forced adjacent 3 of 3, staged 3 of 3, 0 damage), travelling inside the Monkey Madness module snapshot", ticks: null, mie: 'm', owner: "rs/201 (exec 9's builder), rs/185", closes: 'closed: the Monkey Madness module on main as #455 (d62b78aa, gate commit 8e02fecc); now the sensitivity line above (+12 to +27, 2-3 prayer points)', summed: 'closed' },
    { label: "S15 G in transit after the landing (monkey-madness.ts:2642): a scorpion death while waiting, before or after clearScorpions (:2448) is checked; 0 in 29 on the fixed module (6 of 6 in the lab; g5c killed a scorpion in 11 ticks, no damage), its one trigger tonight, gate round 1 at 16:48, before the clearScorpions fix", ticks: null, size: 'unpriced, rate unknown, residual', mie: 'm', owner: 'rs/185, rs/201', closes: 'no fix pending for attempt 1', summed: 'attempt-ending' },
    { label: "S15 K: the walk fails on the browser client at tile (2727,9137), 0 of 2 (bot.walkTo looping in-tick on steps the webclient's pathfinder refuses, rs/548, then Stuck); the lite client passes 2 of 2", ticks: null, mie: 'm', owner: 'rs/186, rs/556', closes: "the walker fix accepted by rs/556 (bgsrv-ub, 400 ms, browser: K 3 of 3, 627 / 479 / 463; M 3 of 3) and on main as #459 (a1ce2209); rs/513's clean browser A-Z (K 439, M 418); the line clears when rs/575 merges (rs/158)", summed: 'attempt-ending' },
    { label: "S15 T: the let-out fails when the cage blocks line of sight (confirmed, rs/201: from the cage tile (2603,3278) a wooden post box and jungle trees inside the railing block every minder; all 8 successful let-outs clicked from the cage's open north strip; the approach needs distance and line of sight, PathingEntity.ts:435, the module checks distance only and re-picks the same minder 3 times), then throws (monkey-madness.ts:2940); the post-throw state is not admitted (T done by itemMilestone :219, so a re-run enters U, whose zooToDaero throws from inside the cage, :1698-1702)", ticks: null, size: '~1 in 12-15 an attempt (i, the natural rate; forced runs set the failure up, the gate A-Z 0 of 3)', mie: 'i', owner: 'rs/185, rs/201', closes: "rs/575 merged (follow-up (c) + (d) from rs/185 f9ce39fa; (c) lab-accepted, forced T 6 of 6); then the two measured lines above, ~+9 recovered inside T and ~+28 on a re-run, in place of fold-in 33's +10 to +40 (i)", summed: 'attempt-ending' },
    { label: "S15 U: Waydar's flight never started (gate round 2, chain a): the snore chatter's middle page swallowed Waydar's talk (rs/201, 20:3x)", ticks: null, mie: 'm', owner: 'rs/201, rs/185', closes: 'closed: fix 631f5ed6 accepted (forced U 6 of 6 in the kit gate) and on main with the module, #455 (d62b78aa); +0', summed: 'closed' },
    { label: "S15 N under the temple (N's precondition :2745, a ResumeError): (c) covers only a throw right after the landing; N's later windows (after the bar is fired, after stringing) are not admitted (rs/185); (d) browser-accepted (rs/513: N 3 of 3, 110 / 115 / 140)", ticks: null, size: 'later windows unpriced', mie: 'r', owner: 'rs/185', closes: "the landing window: rs/575 merged, then the measured ~+120 line above; the later windows: rs/566, attempt 2", summed: 'attempt-ending' },
    { label: "S15 Q between the talisman consumed and the bones used (:2825-2829, Q's precondition :2816): a few-tick window between two Zooknock item uses; resuming it needs a milestone change, so Q is out of (c) (rs/185)", ticks: null, size: 'unpriced, a few-tick window', mie: 'r', owner: 'rs/185', closes: 'rs/566, attempt 2 (a milestone change)', summed: 'attempt-ending' },
    { label: "S15 J inside the Sleeping Monkey's zone (monkey-madness.ts:533, :2683): 0 in 17 runs; the route refuses zone crossings", ticks: null, size: 'unpriced, rate unknown', mie: 'm', owner: 'rs/185', closes: 'no fix pending for attempt 1', summed: 'attempt-ending' },
    { label: "S15 X out of rune arrows (monkey-madness.ts:2005): 0 in 12 runs with 200 arrows; arrows used 56 / 57 / 61 / 65 / 65 / 70 / 75 / 77 (n = 8, the kit gate's chains and the clean browser A-Z's 56 included), p90 ~76, so the 200 is ~2.6 times the p90", ticks: null, size: 'unpriced; the kit margin protects it', mie: 'm', owner: 'rs/185, rs/201', closes: "the kit's 200 rune arrows against p90 ~76", summed: 'attempt-ending' },
    { label: "Throws that end the attempt in rs/147's steps: S07 a knife log fletched (knife-cycle.ts:500-501), the axe, knife or log gone after oak (:929, :932), Camelot runes missing at Woodcutting 99 (legs.ts:118-119); S11a off plane 0; S17 a death or no food (no restock; the retreat timeout unclear); S18 its supply refusals (:629, :636 the ore deadlock, :664, :666, :653 / :631, :650), :971, :959; S22 out of feathers (:762), logs used up then the re-entry faults (:665, :726); S09's manual restarts hold since B is on main (#453)", ticks: null, mie: 'r', owner: 'rs/147', closes: "each module's fix; every other throw in S07, S09, S11a, S17, S18 and S22 a manual restart ~150-450 (i)", summed: 'attempt-ending' },
    { label: "rs/560's three resume gaps, on a non-link throw or a drop inside the window: Dwarf Cannon K (the re-cast after the Falador landing, which leaves L one law rune short for Ardougne; L alone was already safe), Grand Tree M (partial twigs), Fishing Contest M (the Camelot landing); DC K's fix accepted (f998ce99, dwarf-cannon.ts: within 90 tiles of a teleport landing a re-run K or L casts nothing; rs/560's forced drop on the Falador landing, bgsrv-mac, lite, 400 ms, m: K re-entered and completed in 91 ticks with no re-cast, then L in 114 with exactly its 2 law and 2 water), attempt-ending until it is on main, then a manual restart; GT M's fix accepted (4aad5ca6, grand-tree.ts: M is inProgress with 1-3 twigs; rs/560's forced drop with 2 of 4 twigs placed, bgsrv-mac, lite, 400 ms, m: resumed in M and finished the last two in 6 ticks), attempt-ending until it is on main, then a manual restart; FC M's fix accepted (f998ce99, fishing-contest.ts; rs/560's forced drop on the Camelot landing with no cast left, bgsrv-mac, lite, 400 ms, m: resumed in M, walked to the tunnel in 35 ticks, N completed in 12), attempt-ending until it is on main, then a manual restart; all three lab-accepted and on main as #463 (4ec69af6, rs/572: be4f9a60 via rs/185), so each is now a manual restart; no figure moves; Dragon Slayer J and Sea Slug D are not gaps (the content deletes the item and moves the stage in one script, ned.rs2:231-232, holgart_ardougne.rs2:44-45; rs/560, rs/185)", ticks: null, mie: 'r', owner: 'rs/560, rs/185', closes: 'closed: on main as #463 (4ec69af6); a throw or drop inside each window is now a manual restart ~150-450 (i)', summed: 'closed' },
    { label: "Sea Slug E (stage 3, ashore, the paste gone): a drop during Holgart's pages or at 'I'll come back later', after which the re-run throws at E, 'not on the platform's ground floor' (rs/560, confirmed by rs/185)", ticks: null, size: 'unpriced', mie: 'r', owner: 'rs/560, rs/185', closes: 'an attempt-2 fix', summed: 'attempt-ending' },
    { label: "Resume gaps that need design, no fix for attempt 1 (main): Plague City's missing scroll (S08 Y, :798, silent: the Ardougne teleport locks later), Tree Gnome Village K (the 35-cast precondition, :678) and M/N, Grand Tree N2 (the demon alive with the chaos runes out, :620, or a pit death), Mage Arena a death (:503) or runes out (:506)", ticks: null, mie: 'r', owner: 'rs/185', closes: 'attempt 2', summed: 'attempt-ending' },
    { label: "rs/185's other non-admitting resumes: S12 F (:671); S13 B with no food (:353), F unclear; S16 won but in the cellar on a fresh process (memo.fought :622 / :640); S19 H (:705); S20 I (:336-339) and L (:385-387); S26 C armour bought, not worn (:947-949), H and I; runResumable re-walks resolveResume on a link drop (resume.ts:281-299), so these bite on drops too", ticks: null, mie: 'r', owner: 'rs/185', closes: "rs/185's one-line fixes, sent to main; attempt-ending until each is on main", summed: 'attempt-ending' },
    { label: "rs/186's modules, ending the attempt: S14 a death at the spiders (ranged.ts:443; the respawn is away from the site, :740, :754); S25c with the wine exhausted (cooking.ts:503, by design: R17's fallback)", ticks: null, mie: 'r', owner: 'rs/186', closes: 'no fix pending for attempt 1', summed: 'attempt-ending' },
    { label: "rs/186's modules, wrongly skipped on a re-run (done passes): S25a's hand-back failed (smithing.ts:909 / 915; done :1035), so the products stay in the pack; S14's cannon pick-up once Ranged reaches its target (ranged.ts:584; done :731)", ticks: null, mie: 'r', owner: 'rs/186, rs/562', closes: 'rs/562 merged; attempt-ending until then', summed: 'attempt-ending' },
    { label: "rs/186's modules, an operator fix before the re-run: S21's relog, logout half (scored-relog.ts:86: out with no open entry; log SCORED in by hand, then re-run; fix rs/562); S25a not near the anvil (smithing.ts:754, preconditions :1019; walk there); S06 or S21 outside the altar room (runecraft.ts:873 / 879, preconditions :616; re-enter through the ruins); S02 admitted only while the runes cover the worst-case casts inside the site radius (magic.ts:746, :591-605); S03's trade refill at level 1 needs free slots (firemaking.ts:905 / 911, :1033-1034)", ticks: null, size: 'the fix + ~150-450 (i)', mie: 'r', owner: 'rs/186, rs/562', closes: "RUN-HOST's re-run checks; rs/562 for S21's relog", summed: 'no' },
    { label: "rs/186's modules, unverified (a read-only audit): the hand-offs with the partner absent or the trade failed (handoff.ts:356, :426), runecraft.ts:903, smithing.ts:853 / 858, cooking.ts:423-424, fletching.ts:363 at 0 xp, and the S05 / S23 quest segments (no inProgress or resume; small-quest.ts:76); admitted: the rest of S04, S03, the Runecraft bands and S21's pre-login, S27, S25b, S25d, S25e, the S24 quests while the carried item is held, and the legs partway (legs.ts:177)", ticks: null, mie: '-', owner: 'rs/186', closes: 'the attempt-2 audit', summed: 'unverified resume (attempt 2)' },
    { label: "S15's unverified resumes (main 21:4x: an attempt-2 audit, no lab tonight): A (kitFrom), E (:2590), F after daero_complete, N pinned with a failed teleport, O (:1823, :1885), X (:2016), Z (dropDead), the cell cases K, P and R (no leaveCell)", ticks: null, mie: '-', owner: 'rs/185', closes: 'the attempt-2 audit', summed: 'unverified resume (attempt 2)' },
    { label: "The quests' unverified resumes (rs/185): Plague City D and H, Tree Gnome Village A, Grand Tree I, Fight Arena B, E and G, Dwarf Cannon F, Mage Arena A, Fishing Contest C, Dragon Slayer E, F, G and L", ticks: null, mie: '-', owner: 'rs/185', closes: 'the attempt-2 audit', summed: 'unverified resume (attempt 2)' },
    { label: "S15 browser acceptance A-Z: met (rs/513 / rs/185, 23:35 PDT: one clean A-Z chain on the browser client, 400 ms, fixed dialogue, Defence 1, both H12o top-ups delivered, on the gate module + the walker fix + (c) + (d): 4,328 ticks, 0 deaths, lowest HP 18, sharks 15 to 12, prayer doses 16 to 4, rune arrows 56 used, no pin or knockout); a measured browser sample (n = 1) beside S15's row, not a new expected (main)", ticks: null, mie: 'm', owner: 'rs/201, rs/513, rs/185', closes: 'closed: met; K, M and N\'s landing lines clear with rs/575', summed: 'closed' },
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
    '| **Attempt-ending, blocking, unverified or closed (unpriced: the cost is the attempt)** | | | | | |',
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
