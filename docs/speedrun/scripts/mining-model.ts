// Route model for Mining 1 -> 99 (docs/speedrun/skills/mining.md section 2). Offline.
//
//   bun docs/speedrun/scripts/mining-model.ts [--extra 1.61] [--levelup 0.5]
//
// Inputs, each labelled in the doc:
//  - xp curve: Player.ts levelExperience (read)
//  - success: stat_random, PlayerOps.ts (read); iron 96/350, copper and tin 128/400
//    (mine.dbrow); 1 roll in 256 goes to the gem table and gives no xp (mining.rs2)
//  - pickaxe mining_rate by level: iron 6 (lvl 1), steel 5 (6), mithril 4 (21),
//    adamant 3 (31), rune 2 (41) (pickaxes.obj, read)
//  - iron ticks per ore = (rate + extra) + (rate + 1) * (1 - p) / p, where rate + extra
//    is the measured rotation cost of a successful ore with a rune pickaxe (extra 1.61 on
//    the 6-rock zoo cluster at the demo's respawn 13, 1.84 at respawn 19; mining-rotation.ts)
//    and a failed roll costs rate + 1 (one more swing; measured cycle 3 at rate 2)
//  - copper/tin below 15: stay on one rock, (rate + 2) / p ticks per ore (the success's
//    p_delay(0) rejects the next click for a tick; read, mining.rs2 + OpLocHandler.ts)
//  - level-ups: +levelup ticks each (1 measured for a stay transition, 0 for a walk)
import { arg } from './mining-lib';

const EXTRA = Number(arg('extra', '1.61'));
const LVLUP = Number(arg('levelup', '0.5'));

const fine: number[] = [];
let acc = 0;
for (let i = 0; i < 99; i++) {
    const L = i + 1;
    acc += Math.floor(L + Math.pow(2, L / 10) * 300);
    fine.push(Math.floor(acc / 4) * 10);
}
const baseFor = (L: number) => (L <= 1 ? 0 : fine[L - 2]! / 10 / 25);
const succ = (L: number, lo: number, hi: number) => Math.min(1, (Math.floor((lo * (99 - L)) / 98) + Math.floor((hi * (L - 1)) / 98) + 1) / 256);
const rate = (L: number) => (L >= 41 ? 2 : L >= 31 ? 3 : L >= 21 ? 4 : L >= 6 ? 5 : 6);
const GEM = 255 / 256;

function perOre(L: number): [number, number] {
    const r = rate(L);
    if (L < 15) return [(r + 2) / (succ(L, 128, 400) * GEM), 17.5];
    const p = succ(L, 96, 350) * GEM;
    return [r + EXTRA + ((r + 1) * (1 - p)) / p, 35];
}

function route(L0: number, xp0?: number) {
    const bands = new Map<number, number>();
    let total = 0;
    const start = xp0 ?? baseFor(L0);
    for (let L = L0; L < 99; L++) {
        const lo = Math.max(baseFor(L), start), hi = baseFor(L + 1);
        if (hi <= lo) continue;
        const [t, x] = perOre(L);
        const dt = ((hi - lo) / x) * t + LVLUP;
        bands.set(L, dt);
        total += dt;
    }
    return { total, bands };
}

console.log(`extra=${EXTRA} levelup=${LVLUP}`);
const levelOf = (xp: number) => { let L = 1; while (L < 99 && baseFor(L + 1) <= xp) L++; return L; };
for (const [name, xp0] of [['level 1', 0], ["Doric's Quest (1,300 base)", 1300], ['Plague City (2,425 base)', 2425], ["Doric + Plague City (3,725 base, on route)", 3725], ['Digsite (15,300 base)', 15300], ['Doric + Digsite (16,600 base)', 16600]] as const) {
    console.log(`${name}: level ${levelOf(xp0)}, ${route(levelOf(xp0), xp0).total.toFixed(0)} ticks to 99`);
}
const { bands } = route(1);
for (const [a, b] of [[1, 15], [15, 41], [41, 49], [49, 63], [63, 80], [80, 86], [86, 90], [90, 99]]) {
    let s = 0;
    for (const [L, t] of bands) if (L >= a! && L < b!) s += t;
    console.log(`  band ${a}-${b}: ${s.toFixed(0)} ticks`);
}
console.log('ticks per ore:', [1, 15, 21, 31, 41, 49, 55, 63, 99].map(L => `${L}:${perOre(L)[0].toFixed(2)}`).join(' '));
