// S07's knife-off figures on rs/162's in-page plain and plain + bury rates, the knife + bury oak
// band from WC 15, and RUN-ORDER.md section 7's re-sum for fold-in 9 (rs/206).
//
//   bun docs/speedrun/scripts/s07-knife-off.ts
//
// Inputs:
// - read: the demo's level table (Player.ts, as woodcutting-model.ts builds it) and the rune-axe
//   catch chance floor(lo*(99-L)/98) + floor(hi*(L-1)/98) + 1 over 256 (PlayerOps.ts, trees.dbrow);
//   S06's runes per essence floor(level/11) + 1 at the air altar (runecraft.rs2, runecraft.dbrow).
// - measured (rs/162, local engine at 300 ms, visible tab, rune axe, 600 ticks a run, per-roll
//   figures weighted by the sum of 1/p): plain and plain + bury on oak 60-75 and willow 88-93; the
//   four techniques on oak from WC 15. This script reproduces that session's sums of 1/p.
// - the totals before this fold-in are RUN-ORDER.md section 7 at 3fd84ea9.
const LX: number[] = [0, 0];
{
    let acc = 0;
    for (let l = 1; l <= 98; l++) {
        acc += Math.floor(l + Math.pow(2, l / 10) * 300);
        LX.push(Math.floor(acc / 4) / 25);
    }
}
const levelOf = (x: number) => { let L = 1; while (L < 99 && x >= LX[L + 1]!) L++; return L; };
type Tree = { xp: number; lo: number; hi: number };
const OAK: Tree = { xp: 37.5, lo: 112, hi: 350 };
const WILLOW: Tree = { xp: 67.5, lo: 56, hi: 175 };
const p = (t: Tree, L: number) => Math.min(Math.floor((t.lo * (99 - L)) / 98) + Math.floor((t.hi * (L - 1)) / 98) + 1, 256) / 256;
function walk(t: Tree, xp0: number, stop: (xp: number, logs: number) => boolean) {
    let xp = xp0, logs = 0, rolls = 0;
    while (!stop(xp, logs)) { rolls += 1 / p(t, levelOf(xp)); xp += t.xp; logs++; }
    return { xp, logs, rolls, L: levelOf(xp) };
}
const band = (t: Tree, a: number, b: number) => walk(t, LX[a]!, xp => xp >= LX[b]!).rolls;
const r = (x: number) => Math.round(x);
const f = (x: number, d = 1) => x.toFixed(d);

// Expected rolls by band
const oak = band(OAK, 15, 73), oak15to60 = band(OAK, 15, 60), oak60 = band(OAK, 60, 73), willow = band(WILLOW, 73, 99);
console.log(`expected rolls: oak 15-73 ${f(oak)} (15-60 ${f(oak15to60)}, 60-73 ${f(oak60)}); willow 73-99 ${f(willow)}`);

// rs/162's oak-from-15 session: check the sums of 1/p and the end levels
const low = { knife: [0.261, 168.4], knifeBury: [0.276, 177.4], plain: [0.191, 126.4], plainBury: [0.140, 95.4] } as const;
const lowRun: Record<string, ReturnType<typeof walk>> = {};
for (const [k, [lpt, sum]] of Object.entries(low)) {
    const n = Math.round(lpt * 600);
    lowRun[k] = walk(OAK, LX[15]!, (_x, l) => l >= n);
    console.log(`  from WC 15, ${k}: ${n} logs, sum 1/p ${f(lowRun[k]!.rolls)} (rs/162 ${sum}), ends L${lowRun[k]!.L}`);
}

// Knife-on oak band from the knife + bury run: 600 ticks m, the rest of the band at the run's rate (i)
const kbRate = 600 / low.knifeBury[1];
const kbRest = (oak - low.knifeBury[1]) * kbRate;
const oakKnife = 600 + kbRest;
console.log(`knife + bury oak 15-73: 600 m + ${f(oak - low.knifeBury[1])} rolls x ${f(kbRate, 3)} = ${f(kbRest)} i -> ${r(oakKnife)} (S07 had 586: ${r(oakKnife) - 586 >= 0 ? '+' : ''}${r(oakKnife) - 586})`);
const S07knife = 14 + r(oakKnife) + 2386;
console.log(`S07 knife: 14 + ${r(oakKnife)} + 2,386 = ${S07knife}; S07 bone capacity at 0.329: ${r(0.329 * (r(oakKnife) + 2386))} (was 978 on 2,972)`);
console.log(`cross-check: willow knife per expected roll at the lite ratio = 0.765 x 3,119 / ${f(willow)} = ${f(0.765 * 3119 / willow, 3)} (knife + bury measured 3.02); oak at WC 60 3.247 (knife + bury 60-75 measured 3.28)`);
console.log(`  the lab's oak respawn (D ~29 at ~2 online) against the demo's ~20: woodcutting.md 812 / 796 = ${f(812 / 796, 3)}, so ~${r(oakKnife * (1 - 796 / 812))} of the oak band is respawn`);

// Knife-off rates (ticks per expected roll)
const plainLow = 600 / low.plain[1];            // plain alone, WC 15 to L67, m
const plainOak = 4.93, plainWillow = 4.13;      // plain alone, m
const pbOak = (4.26 + 4.32) / 2, pbWillow = (3.97 + 3.81) / 2; // plain + bury, m (two runs each)
const bOak = (0.197 + 0.194) / 2, bWillow = (0.229 + 0.224) / 2; // bones a tick with trades, i
console.log(`rates: plain from 15 ${f(plainLow, 3)}, plain oak 60-75 ${plainOak}, plain willow ${plainWillow}; plain + bury oak ${pbOak} willow ${pbWillow}; bones a tick with trades oak ${f(bOak, 4)} willow ${f(bWillow, 4)}`);

const oakPlain = 600 + (oak - low.plain[1]) * plainOak;              // band-weighted plain alone
const oakPB60 = oak15to60 * plainLow + oak60 * pbOak;                 // plain alone to 60, plain + bury 60-73
const willowPlain = willow * plainWillow;
const willowPBall = willow * pbWillow;
const capWillow = bWillow * willowPBall, capOak60 = bOak * oak60 * pbOak;
function willowWith(bones: number) {
    const ticks = bones / bWillow, rolls = ticks / pbWillow;
    return rolls >= willow ? willowPBall : ticks + (willow - rolls) * plainWillow;
}
console.log(`oak 15-73 plain alone: 600 m + ${f(oak - low.plain[1])} x ${plainOak} = ${f(oakPlain)}; with plain + bury from 60: ${f(oak15to60)} x ${f(plainLow, 3)} + ${f(oak60)} x ${pbOak} = ${f(oakPB60)}`);
console.log(`willow 73-99 plain alone ${f(willowPlain)}; plain + bury throughout ${f(willowPBall)}; holds ${f(capWillow)} bones; oak 60-73 plain + bury holds ${f(capOak60)}`);

const S07plain = 14 + r(oakPlain) + r(willowPlain);
const w355 = willowWith(355);
const S07pb = 14 + r(oakPlain) + r(w355);
console.log(`S07 knife off, no rs/162: 14 + ${r(oakPlain)} + ${r(willowPlain)} = ${S07plain} (was 3,881)`);
console.log(`S07 knife off, rs/162, 355 bones in the willow band: 14 + ${r(oakPlain)} + ${r(w355)} = ${S07pb} (bury stretch ${r(355 / bWillow)} ticks)`);

// Section 7 re-sum
const before = { onE: 34526, onB: 31655, offE: 38180, offB: 35732, pbE: 37555, pbB: 35072 };
const rc = { e: 6, b: 6 };     // S06 54 -> 58, S21 1,132 -> 1,134
const drop = 2;                // S06's air runes dropped on T06-07, i
const onE = before.onE + (S07knife - 2986) + rc.e + drop, onB = before.onB + rc.b + drop;
const offE = before.offE + (S07plain - 3881) + rc.e + drop, offB = before.offB + (S07plain - 3881) + rc.b + drop;
const pbE = before.pbE + (S07pb - 3881) + (95 - 110) + rc.e + drop, pbB = before.pbB + (S07pb - 3881) + (65 - 75) + rc.b + drop;
console.log(`\ntotals: knife on ${onE} / ${onB}; knife off in force ${offE} / ${offB}; with rs/162 ${pbE} / ${pbB}`);
const rec = 35916;
console.log(`against the record: on ${onE - rec} / ${onB - rec}; off ${offE - rec} / ${offB - rec}; rs/162 ${pbE - rec} / ${pbB - rec}`);

// Section 7's table, line by line (knife on exp/best, knife off exp/best, with rs/162)
const lines: [string, number, number, number, number, number, number][] = [
    ['Quests (42)', 11714, 10831, 11714, 10831, 11714, 10831],
    ['Agility (43)', 4327, 3934, 4327, 3934, 4327, 3934],
    ['Mining (44)', 3116, 3116, 4170, 4170, 4170, 4170],
    ['Woodcutting (45)', S07knife, 2969, S07plain, S07plain, S07pb, S07pb],
    ['Fishing (46)', 1995, 1969, 3410, 3410, 3410, 3410],
    ['Thieving (47)', 2000, 1908, 2000, 1908, 2000, 1908],
    ['Combat (48)', 2021, 1961, 2021, 1961, 2021, 1961],
    ['Magic (49)', 222, 222, 222, 222, 222, 222],
    ['Prayer (50)', 95, 65, 735, 735, 95, 65],
    ['Smithing (51)', 1147, 1107, 1147, 1107, 1147, 1107],
    ['Firemaking (52)', 695, 650, 695, 650, 695, 650],
    ['Runecraft (53)', 1192, 1192, 1192, 1192, 1192, 1192],
    ['Fletching + Crafting + Cooking + Herblore (54)', 341, 277, 341, 277, 341, 277],
    ['Overhead (55)', 1483, 1462, 1483, 1462, 1483, 1462],
    ['Contention, retries, boundary idle (56)', 400, 0, 400, 0, 400, 0],
    ['Demo latency and overrun (57)', 800, 0, 450, 0, 450, 0],
];
const col = (i: number) => lines.reduce((s, l) => s + (l[i] as number), 0);
console.log(`section 7 table sums: knife on ${col(1)} / ${col(2)}; knife off ${col(3)} / ${col(4)}; with rs/162 ${col(5)} / ${col(6)}`);
if (col(1) !== onE || col(2) !== onB || col(3) !== offE || col(4) !== offB || col(5) !== pbE || col(6) !== pbB) throw new Error('table does not re-sum to the totals');

// Overhead (55): legs 1,382, claim 8, H1 8, hand-offs 49 (47 + the T06-07 drop), level-ups 25 / 15, relog tail 3 / 0, restarts 8 / 0
console.log(`overhead (55): ${1382 + 8 + 8 + 49 + 25 + 3 + 8} / ${1382 + 8 + 8 + 49 + 15}`);
// Runecraft (53): S06 58 m + S21 161 x 7 + 7
console.log(`runecraft (53): 58 + ${161 * 7 + 7} = ${58 + 161 * 7 + 7}; robust S21 ${161 * 8 + 7}`);

// M / I / E split of the knife-on expected
const M = 8687 + 58 + 600, I = 23164 - 54 + 2 + (S07knife - 600 - 2986) + drop, E = 2675;
console.log(`M/I/E: ${M} / ${I} / ${E} = ${M + I + E} (${f((100 * M) / onE, 0)}% / ${f((100 * I) / onE, 0)}% / ${f((100 * E) / onE, 0)}%)`);
if (M + I + E !== onE) throw new Error('M/I/E does not re-sum');

// Scenario rows (knife on): deltas unchanged
for (const [name, de, db] of [['forecast at 2026-10-23 (in force)', 430, 413], ['every line held', 0, 0], ["rs/41's 09:35 plan", 326, 326], ['today (conservative)', 717, 653], ['today, the ~85 at the booth', 836, 781]] as const)
    console.log(`  ${name}: ${onE + de} / ${onB + db}, ${onE + de - rec} against the record`);
console.log(`  MM bad case +860: in force ${onE + 430 + 860 - rec}, conservative ${onE + 717 + 860 - rec}, booth ${onE + 836 + 860 - rec}; fish route +927: ${onE + 430 + 927 - rec}, ${onE + 717 + 927 - rec}, ${onE + 836 + 927 - rec}`);

// Sensitivities
console.log(`\nknife gate off all night: +${offE - onE} (+${pbE - onE} with rs/162)`);
const booth = 2.07, s07Bone = 6 / 23, lapBone = 0.32, rowBones = 220, rowBonesBooth = 339, prayerOn = 95;
{
    const wc = S07plain - S07knife, over = -140;
    const bones = 200 * lapBone + 863 * booth + 30 - rowBones - prayerOn;
    const bonesOff = 1063 * booth - rowBonesBooth - prayerOn;
    console.log(`S07 gate off alone, conservative, no rs/162: S07 +${wc}, overrun ${over}, bones +${r(bones)} -> +${r(wc + over + bones)}; Mining bury off too +${r(bonesOff)} -> +${r(wc + over + bonesOff)}`);
    const inS07 = Math.floor(capWillow) + Math.floor(capOak60);
    const wcPB = 14 + r(oakPB60) + r(willowPBall) - S07knife;
    const toLap = 200, toBooth = 1063 - inS07 - toLap;
    const bonesPB = inS07 * s07Bone + toLap * lapBone + 30 + toBooth * booth - rowBones - prayerOn;
    const bonesPBoff = inS07 * s07Bone + (1063 - inS07) * booth - rowBonesBooth - prayerOn;
    console.log(`  with rs/162: S07 holds ${inS07} (willow ${Math.floor(capWillow)}, oak from 60 ${Math.floor(capOak60)}), the lap ${toLap}, the booth ${toBooth}; S07 +${wcPB} (oak ${r(oakPB60)}, willow ${r(willowPBall)}), overrun ${over}, bones +${r(bonesPB)} -> +${r(wcPB + over + bonesPB)}; Mining bury off: booth ${1063 - inS07}, bones +${r(bonesPBoff)} -> +${r(wcPB + over + bonesPBoff)}`);
}

// Knife off all night, by scenario row (Mining's stay2 is inert under plain, so past S07 it is the booth)
{
    const other = { forecast: 430 - 52, conservative: 717 - 220 };
    // no rs/162: every non-stun bone at the booth; the column already has 355 there
    const fNo = (554 - 355) * booth, cNo = (1063 - 355) * booth;
    // rs/162: the forecast's 554 fit the willow band
    const fPB = (554 - 355) * s07Bone + (r(willowWith(554)) - r(w355));
    const inS07 = Math.floor(capWillow) + Math.floor(capOak60);
    const cPB = (inS07 - 355) * s07Bone + (1063 - inS07) * booth + (r(willowPBall) - r(w355)) + (r(oakPB60) - r(oakPlain));
    console.log(`\nknife off all night, forecast row: no rs/162 bones +${r(fNo)} (199 more at the booth) -> ${offE + r(fNo) + other.forecast}; rs/162 bones ${r(fPB)} (all 554 in the willow band, willow ${r(willowWith(554))}) -> ${pbE + r(fPB) + other.forecast}`);
    console.log(`knife off all night, conservative row: no rs/162 +${r(cNo)} (all 1,063 at the booth) -> ${offE + r(cNo) + other.conservative}; rs/162 +${r(cPB)} (S07 ${inS07}, booth ${1063 - inS07}) -> ${pbE + r(cPB) + other.conservative}`);
    console.log(`  other lines: forecast +${other.forecast}, conservative +${other.conservative}`);
}

// Axe sensitivities on the new S07
console.log(`\naxe: adamant +${r(S07knife * 0.13)} / mithril +${r(S07knife * 0.28)} knife; plain +${r(S07plain * 0.13)} / +${r(S07plain * 0.28)}; best +386 / +831`);
// S06's air runes
{
    let xp = 0, runes = 0; const lv: number[] = [];
    for (let k = 0; k < 7; k++) { const L = levelOf(xp); lv.push(L); runes += 27 * (Math.floor(L / 11) + 1); xp += 27 * 5; }
    console.log(`S06: crafts at levels ${lv.join(', ')}: ${runes} air runes`);
}
