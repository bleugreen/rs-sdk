// Agility route model: turns the measured lap times and fall costs into ticks per
// level band. Every constant is labelled with where it came from; rerun with
//   bun docs/speedrun/scripts/agility-model.ts

// ---- level curve (server/engine/src/engine/entity/Player.ts:77-85), base xp = fine / 10 / 25
const LEVEL_BASE: number[] = [0, 0]; // LEVEL_BASE[L] = base xp needed for level L
{
    let acc = 0;
    for (let i = 0; i < 98; i++) {
        const level = i + 1;
        acc += Math.floor(level + Math.pow(2, level / 10) * 300);
        LEVEL_BASE[i + 2] = (Math.floor(acc / 4) * 10) / 10 / 25;
    }
}
const levelOf = (xp: number) => { let l = 1; while (l < 99 && LEVEL_BASE[l + 1] <= xp) l++; return l; };

// ---- success roll (PlayerOps.ts:591-600)
const succ = (lo: number, hi: number, L: number) => {
    const l = Math.min(L, 99);
    return Math.min(1, (Math.floor((lo * (99 - l)) / 98) + Math.floor((hi * (l - 1)) / 98) + 1) / 256);
};

// ---- Wilderness course (wilderness_course.rs2:76-176), measured with agility-course.ts
const WILD_LAP_XP = 12.5 + 20 + 20 + 20 + 498.9; // 571.4 base, read
const WILD_CLEAN_LAP = 77; // ticks, measured: mean of fall-free laps (n=36, levels 52-99)
const ROPE_FALL_TICKS = 88; // measured: laps with one rope fall took 164-166 vs 77 clean
const ROPE_FALL_XP = 52.5; // inferred: stones+log+pipe are redone (20+20+12.5), bonus waits a loop
const STONE_FALL_TICKS = 21; // measured: lap with one stones fall took 98
const LOG_FALL_TICKS = 53; // measured (n=1): pit, ladder, redo stones, back to the log
const LOG_FALL_XP = 20; // stones redone

function wildRate(L: number) {
    const fr = 1 - succ(200, 250, L), fs = 1 - succ(180, 250, L), fl = 1 - succ(200, 250, L);
    const er = fr / (1 - fr), es = fs / (1 - fs), el = fl / (1 - fl); // expected falls per completed lap
    const ticks = WILD_CLEAN_LAP + er * ROPE_FALL_TICKS + es * STONE_FALL_TICKS + el * LOG_FALL_TICKS;
    const xp = WILD_LAP_XP + er * ROPE_FALL_XP + el * LOG_FALL_XP;
    return { xpPerTick: xp / ticks, lapTicks: ticks, lapXp: xp, fallsPerLap: er + es + el };
}

// ---- sub-52 methods (measured)
const GNOME = 86.5 / 70.7; // gnome_course.rs2, no fails; laps 72,70,70 (agility-course.ts gnome, n=3)
const MONKEYBARS = 20 / 10.09; // shortcuts.rs2:152-196, Edgeville dungeon, level 15 (agility-repeat.ts, n=11 gaps)

function ticksBetween(xpFrom: number, xpTo: number, rate: (L: number) => number) {
    let t = 0;
    let xp = xpFrom;
    while (xp < xpTo - 1e-9) {
        const L = levelOf(xp);
        const next = L < 99 ? Math.min(LEVEL_BASE[L + 1], xpTo) : xpTo;
        t += (next - xp) / rate(L);
        xp = next;
    }
    return t;
}

const best = (L: number, opts: { monkeybars?: boolean; boost?: number } = {}) => {
    if (L >= 52) return wildRate(L + (opts.boost ?? 0)).xpPerTick;
    if (opts.monkeybars && L >= 15) return MONKEYBARS;
    return GNOME;
};

const X99 = LEVEL_BASE[99];
const X52 = LEVEL_BASE[52];
const r = (x: number) => Math.round(x);

console.log('level table check: 52 =', LEVEL_BASE[52].toFixed(1), '93 =', LEVEL_BASE[93].toFixed(1), '99 =', X99.toFixed(1));
console.log('\nWilderness expected rate by level (inferred):');
for (const L of [52, 55, 60, 65, 70, 75, 80, 85, 90, 93, 95, 97, 99]) {
    const w = wildRate(L);
    console.log(`  ${L}: ${w.xpPerTick.toFixed(2)} base/tick, ${w.lapTicks.toFixed(1)} ticks/lap, ${w.fallsPerLap.toFixed(3)} falls/lap`);
}

const low = { gnomeOnly: ticksBetween(0, X52, L => GNOME), gnomeThenBars: ticksBetween(0, X52, L => best(L, { monkeybars: true })) };
const wild52 = ticksBetween(X52, X99, L => best(L));
console.log('\nNo quests:');
console.log(`  1->52 gnome only: ${r(low.gnomeOnly)} ticks; gnome 1->15 then Edgeville monkey bars: ${r(low.gnomeThenBars)} ticks`);
console.log(`  52->99 wilderness: ${r(wild52)} ticks`);
console.log(`  total 1->99: ${r(low.gnomeOnly + wild52)} (safe) / ${r(low.gnomeThenBars + wild52)} (monkey bars)`);

const Q = { grandTree: 7900, regicide: 13750, trollRomance: 8000, undergroundPass: 3000, fremennik: 2812.4, touristPick: 4650, legendsPick: 7650 };
const to99 = (start: number) => (start >= X99 ? 0 : start >= X52 ? ticksBetween(start, X99, L => best(L)) : ticksBetween(start, X52, L => GNOME) + wild52);
const scen: [string, number][] = [
    ['GT + Regicide + TR', Q.grandTree + Q.regicide + Q.trollRomance],
    ['GT + Regicide + TR + UP', Q.grandTree + Q.regicide + Q.trollRomance + Q.undergroundPass],
    ['... + Fremennik', Q.grandTree + Q.regicide + Q.trollRomance + Q.undergroundPass + Q.fremennik],
];
console.log('\nQuest xp scenarios (all quest xp assumed in before training):');
for (const [name, xp] of scen) {
    console.log(`  ${name}: ${xp.toFixed(1)} base -> level ${levelOf(xp)}, ${r(to99(xp))} ticks to 99`);
}
const core = Q.grandTree + Q.regicide + Q.trollRomance + Q.undergroundPass;
console.log('\nValue of each reward (ticks saved), on top of GT+Regicide+TR+UP and on its own from 1:');
const base = to99(core);
for (const [name, xp] of Object.entries(Q)) {
    const without = name in { grandTree: 1, regicide: 1, trollRomance: 1, undergroundPass: 1 } ? to99(core - xp) - base : base - to99(core + xp);
    console.log(`  ${name} (${xp}): saves ${r(without)} ticks in the quest plan; ${r(to99(0) - to99(xp))} ticks from a fresh account`);
}
console.log(`  2 Tourist Trap picks: ${r(base - to99(core + 2 * Q.touristPick))}; 4 Legends picks: ${r(base - to99(core + 4 * Q.legendsPick))}`);
console.log(`  rate the picks displace at the top band: ${wildRate(97).xpPerTick.toFixed(2)} base/tick`);

console.log('\nGrand Tree check (stat(agility) >= 25, quest_grandtree.rs2:25):');
console.log(`  level 25 = ${LEVEL_BASE[25].toFixed(1)} base: ${r(LEVEL_BASE[25] / GNOME)} ticks of gnome laps; level 22 (+3 agility potion) = ${LEVEL_BASE[22].toFixed(1)} base: ${r(LEVEL_BASE[22] / GNOME)} ticks`);

// Agility potion: +3 (consume_effects.dbrow:288-294), decays 1 level per stat-restore cycle
console.log('\nAgility potion (+3 to success rolls) on the Wilderness course:');
for (const L of [52, 70, 93, 96]) {
    console.log(`  at ${L}: ${wildRate(L).xpPerTick.toFixed(2)} -> ${wildRate(L + 3).xpPerTick.toFixed(2)} base/tick`);
}
console.log(`  52->99 with a permanent +3: ${r(ticksBetween(X52, X99, L => best(L, { boost: 3 })))} vs ${r(wild52)} ticks`);
console.log(`  ${levelOf(core)}->99 with a permanent +3: ${r(ticksBetween(core, X99, L => best(L, { boost: 3 })))} vs ${r(base)} ticks`);
