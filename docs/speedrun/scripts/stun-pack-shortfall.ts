#!/usr/bin/env bun
/**
 * S18 blood-rune shortfall (rs/367): Magic 80-99 by Charge until the blood runes run out, then
 * the cheapest completion, priced against the full-Charge stun pack (stun-pack.md section 15).
 * No server needed.
 *
 *   bun docs/speedrun/scripts/stun-pack-shortfall.ts [N ...]
 *
 * N is the blood runes held in total, before S16's Kolodion reserve (default 100 250 400).
 * Every constant names its source. Labels: m measured, r read, i inferred (arithmetic here),
 * e estimated (an allowance set here by judgement).
 */

const args = process.argv.slice(2).map(Number).filter(n => Number.isFinite(n));
const NS = args.length > 0 ? args : [100, 250, 400];
const f0 = (x: number) => Math.round(x).toLocaleString('en-US');
const sgn = (x: number) => (Math.round(x) > 0 ? '+' : '') + f0(x);
const table = (head: string[], rows: (string | number)[][]) => {
    console.log(`| ${head.join(' | ')} |`);
    console.log(`|${head.map(() => '---').join('|')}|`);
    for (const r of rows) console.log(`| ${r.join(' | ')} |`);
    console.log('');
};

// ---- level table (r: Player.ts levelExperience; base xp = game xp / 25, speedrun/lib/xp.ts) ----
const LEVEL_XP: number[] = [0, 0];
{
    let acc = 0;
    for (let level = 1; level < 99; level++) {
        acc += Math.floor(level + Math.pow(2, level / 10) * 300);
        LEVEL_XP[level + 1] = Math.floor(acc / 4);
    }
}
const base = (level: number) => LEVEL_XP[level]! / 25;
const levelOf = (b: number) => {
    let l = 1;
    while (l < 99 && LEVEL_XP[l + 1]! <= b * 25) l++;
    return l;
};

// ---- spells (r: magic_spells.dbrow, magic_combat_spells.dbrow; experience is tenths) ----
const CHARGE_XP = 180; // 3 blood, 3 fire (staff of fire), 3 air; no p_delay (charge.rs2)
const BLOOD_PER_CHARGE = 3;
const SUPERHEAT_XP = 53; // 1 nature, 4 fire (staff of fire); p_delay(1) (superheat.rs2:67)
const SMITH_BRONZE = 6.2; // smelting.struct productexp 62; Smithing 1, copper + tin
const SMITH_IRON = 12.5; // productexp 125; Smithing 15, iron ore alone (no coal held)
const FIRE_BLAST_XP = 34.5; // 1 death, 5 fire, 4 air; max hit 16; 5-tick attack delay

// ---- route anchors ----
const KOLODION_RESERVE = 70; // r: SUPPLIES.md H13, rs/185 (S16's Fire Wave)
const START = base(80); // r: S18 starts at base 80 (RUN-ORDER S16 80/81; stun-pack.md's lab basis)
const GOAL = base(99);

// ---- the stuns (stun-pack.md sections 2, 3, 14; interleaving.md section 4) ----
// Stocked stuns are failures less top-up stuns: 70 / 81 / 71 lite, 60 / 54 / 69 browser (m).
const STOCKED_STUNS = 70; // i, central
const STOCKED_STUNS_LIVE = { value: STOCKED_STUNS }; // the sensitivity row swaps this
const CASTS_PER_STUN = 2; // r: p_delay(1) at T+4 and T+7 leaves T+10 undelayed for the click;
// m: enchant (the same p_delay(1)) landed 1.92 a stun at +2 and +5 (interleaving.md section 4)
const BONES_PER_STUN = 3; // m: the bury plan's 3.00 a stocked stun, displaced by the 2 casts
const S07_PER_BONE = 0.26; // r: RUN-ORDER section 7, '200 more bones in S07 (+52)'; BP 0.23 m
const SMITH_PAGES = 5; // e: ~75 Smithing levels' pages inside stuns (stun-pack.md section 9's +10 a run over ~140 levels)
const LITE_ATTEMPT_SLIP = 1.1; // m (sensitivity): enchant at +2/+5 took 13.4 to the next attempt against 12.3

// ---- standalone Superheat after S18 (magic.md section 4: 3.00 ticks a cast, m) ----
const SH_TICKS = 3.0; // m
const SH_LOAD = 20; // i: ore a load with S18's leftovers held
const SH_SWAP = 6; // i: the courier's swap, bars back and ore in (stun-pack.md section 5's 5-6 tick trades, m)
const SH_SETUP = 6; // e: the first swap

// ---- the Smithing credit in S25a (smithing.md section 2's measured bands, scaled to S25a's 1,065) ----
const S25A_SCALE = 1065 / 1147; // r: RUN-ORDER S25a 1,065 m against smithing.md's 1,147 m
const BAND_LOW_TICKS = 124; // i: the 1->48 band's 128 (staged helper) less ~4 of first trade, which stays
const BAND_48_68 = 26.0; // m base a tick, steel platebodies
const BAND_68_88 = 35.7; // m, mithril platebodies
function smithingCredit(smithBase: number): number {
    const b48 = base(48), b68 = base(68), b88 = base(88);
    let t = 0;
    t += BAND_LOW_TICKS * Math.min(smithBase, b48) / b48;
    if (smithBase > b48) t += (Math.min(smithBase, b68) - b48) / BAND_48_68;
    if (smithBase > b68) t += (Math.min(smithBase, b88) - b68) / BAND_68_88;
    return t * S25A_SCALE;
}
const smithXp = (casts: number) => Math.min(casts, 12) * SMITH_BRONZE + Math.max(0, casts - 12) * SMITH_IRON;

// ---- S27's combat finish (RUNORDER S27, RG): a Fire Blast phase in place of the bow ----
const CANNON_RATE = 13.0; // m: cannon with the scimitar, 12.30 at Ranged 55, 13.80 at 85
const BOW_RATE = 20.14; // m: cannon + the bow at Ranged 85
const FB_MAGIC_PER_TICK = 8.0; // i: 34.5 a cast over 5 ticks, plus ~1 a tick from damage; 7-9.8 range
const BALLS_PER_TICK = 0.55; // m: S27's 0.5-0.6 a tick
const BALLS_SPARE = 1416 - 1110; // r: 1,416 held, ~1,110 used

interface Plan {
    n: number;
    charge: number;
    chargeBase: number;
    level: number;
    remain: number;
    stuns: number;
    stunCasts: number;
    standalone: number;
    bones: number;
    gross: number;
    credit: number;
    s27: number;
    s27balls: number;
}

function plan(n: number): Plan {
    const runes = Math.max(0, n - KOLODION_RESERVE);
    const charge = Math.min(Math.floor(runes / BLOOD_PER_CHARGE), Math.ceil((GOAL - START) / CHARGE_XP));
    const chargeBase = START + charge * CHARGE_XP;
    const remain = Math.max(0, GOAL - chargeBase);
    const stocked = STOCKED_STUNS_LIVE.value;
    const stunCasts = Math.min(Math.ceil(remain / SUPERHEAT_XP), stocked * CASTS_PER_STUN);
    const stuns = Math.ceil(stunCasts / CASTS_PER_STUN);
    const after = Math.max(0, remain - stunCasts * SUPERHEAT_XP);
    const standalone = Math.ceil(after / SUPERHEAT_XP);
    const bones = stuns * BONES_PER_STUN * S07_PER_BONE;
    const pages = stunCasts > 0 ? SMITH_PAGES * Math.min(1, stuns / stocked) : 0;
    const shTicks = standalone > 0 ? standalone * (SH_TICKS + SH_SWAP / SH_LOAD) + SH_SETUP : 0;
    const gross = bones + pages + shTicks;
    const credit = smithingCredit(smithXp(stunCasts + standalone));
    // the lever: the stuns as above, the remainder by Fire Blast in S27 in place of the bow
    const castTicks = after / FB_MAGIC_PER_TICK;
    const s27Extra = castTicks * (1 - CANNON_RATE / BOW_RATE);
    const s27 = bones + pages + s27Extra - smithingCredit(smithXp(stunCasts));
    return { n, charge, chargeBase, level: levelOf(chargeBase), remain, stuns, stunCasts, standalone, bones, gross, credit, s27, s27balls: s27Extra * BALLS_PER_TICK };
}

// net cost with a different stocked-stun count, less the central figure
function stunSwing(n: number, stuns: number): number {
    const central = plan(n);
    const p = planWith(n, stuns);
    return (p.gross - p.credit) - (central.gross - central.credit);
}
function planWith(n: number, stuns: number): Plan {
    const saved = STOCKED_STUNS_LIVE.value;
    STOCKED_STUNS_LIVE.value = stuns;
    try {
        return plan(n);
    } finally {
        STOCKED_STUNS_LIVE.value = saved;
    }
}
// With the pack failed there are no stuns: Charge standalone at 5 a tick (magic.md, m) and every
// Superheat after S18. RUN-ORDER's +~120 row already carries Charge standalone at +33 (full runes)
// and the stun bones in S07 (+52), so this is the increment on that row.
const CHARGE_STANDALONE_IN_ROW = 33; // r: RUN-ORDER section 7, the stun-pack-fails row
function packFails(p: Plan): number {
    const casts = p.stunCasts + p.standalone;
    const sh = casts > 0 ? casts * (SH_TICKS + SH_SWAP / SH_LOAD) + SH_SETUP : 0;
    return p.charge / 5 + sh - smithingCredit(smithXp(casts)) - CHARGE_STANDALONE_IN_ROW;
}

const worst = (() => {
    const p = plan(KOLODION_RESERVE); // no blood for Charge at all
    return p;
})();
const pureStandalone = (() => {
    const casts = Math.ceil((GOAL - START) / SUPERHEAT_XP);
    const t = casts * (SH_TICKS + SH_SWAP / SH_LOAD) + SH_SETUP;
    return { casts, t, credit: smithingCredit(smithXp(casts)) };
})();

const ps = NS.map(plan);
console.log(`Magic 80 = ${f0(START)} base, 99 = ${f0(GOAL)} base; full Charge = ${Math.ceil((GOAL - START) / CHARGE_XP)} casts, ${Math.ceil((GOAL - START) / CHARGE_XP) * 3} blood (N = ${Math.ceil((GOAL - START) / CHARGE_XP) * 3 + KOLODION_RESERVE}).\n`);
table(['', ...ps.map(p => `N = ${p.n}`), 'No Charge (worst)'], [
    ['Blood for S18 (N - 70)', ...ps.map(p => f0(Math.max(0, p.n - KOLODION_RESERVE))), '0'],
    ['Charge casts', ...ps.map(p => p.charge), 0],
    ['Magic reached by Charge (base xp)', ...ps.map(p => `${p.level} (${f0(p.chargeBase)})`), `80 (${f0(START)})`],
    ['Base xp still to find', ...ps.map(p => f0(p.remain)), f0(worst.remain)],
    ['Superheat in the stuns: casts (stuns)', ...ps.map(p => `${p.stunCasts} (${p.stuns})`), `${worst.stunCasts} (${worst.stuns})`],
    ['Superheat after S18: casts', ...ps.map(p => p.standalone), worst.standalone],
    ['Nature runes / ore (copper+tin 12 each, rest iron)', ...ps.map(p => `${p.stunCasts + p.standalone} / ${p.stunCasts + p.standalone}`), `${worst.stunCasts + worst.standalone} / ${worst.stunCasts + worst.standalone}`],
    ['Bones moved to S07', ...ps.map(p => sgn(p.bones)), sgn(worst.bones)],
    ['Ticks against the full-Charge plan (gross)', ...ps.map(p => sgn(p.gross)), sgn(worst.gross)],
    ['Smithing credit in S25a', ...ps.map(p => sgn(-p.credit)), sgn(-worst.credit)],
    ['Net', ...ps.map(p => sgn(p.gross - p.credit)), sgn(worst.gross - worst.credit)],
    ['Lever: remainder by Fire Blast in S27 (net)', ...ps.map(p => sgn(p.s27)), sgn(worst.s27)],
    ['  extra cannonballs (spare ~306)', ...ps.map(p => f0(p.s27balls)), f0(worst.s27balls)],
    ['Sensitivity: +1.1 a stun attempt slip (lite enchant, m)', ...ps.map(p => sgn(p.stuns * LITE_ATTEMPT_SLIP)), sgn(worst.stuns * LITE_ATTEMPT_SLIP)],
    ['Sensitivity: stocked stuns 55 / 80 in place of 70', ...ps.map(p => `${sgn(stunSwing(p.n, 55))} / ${sgn(stunSwing(p.n, 80))}`), `${sgn(stunSwing(KOLODION_RESERVE, 55))} / ${sgn(stunSwing(KOLODION_RESERVE, 80))}`],
    ['If the stun pack fails too (R31): add to its +~120 row', ...ps.map(p => sgn(packFails(p))), sgn(packFails(worst))],
]);
console.log(`Pure standalone Superheat, no stuns: ${pureStandalone.casts} casts, ${sgn(pureStandalone.t)} gross, ${sgn(pureStandalone.t - pureStandalone.credit)} net.\n`);

// the curve: Charge until the runes run out, then Superheat (stuns first, then after S18)
const curve: (string | number)[][] = [];
for (let n = 70; n <= 570; n += 50) {
    const p = plan(n);
    curve.push([n, p.charge, `${p.level}`, `${p.stunCasts} / ${p.standalone}`, sgn(p.gross), sgn(p.gross - p.credit)]);
}
for (const n of [436, 559]) {
    const p = plan(n);
    curve.push([`${n}`, p.charge, `${p.level}`, `${p.stunCasts} / ${p.standalone}`, sgn(p.gross), sgn(p.gross - p.credit)]);
}
curve.sort((a, b) => Number(a[0]) - Number(b[0]));
table(['N', 'Charge casts', 'Magic by Charge', 'Superheat stuns / after', 'Gross', 'Net of Smithing'], curve);
