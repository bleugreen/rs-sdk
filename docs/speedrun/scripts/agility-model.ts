// Agility route model: turns the measured lap times and fall costs into ticks per
// level band. Every constant is labelled with where it came from; rerun with
//   bun docs/speedrun/scripts/agility-model.ts [--lap=66] [--sim[=20000] --record=6772 --fixed=1971 --restock=0]
// --lap is the clean Wilderness lap in ticks (default: the 300 ms measurement below).
// --sim adds a lap-by-lap Monte Carlo of the Wilderness bands (each obstacle's fail roll at the
// current level, fall loops repeating) and P(fixed + restock + 52->99 < record).
const argv = process.argv.slice(2);

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
// Clean lap, measured with agility-course.ts. The bot clicks each obstacle after it sees the
// previous one's xp, so the lap carries one packet latency per obstacle:
//   77 at 100 ms (n=36 fall-free laps, levels 52-99);
//   71 at 300 ms, stock lite client (13 of 14 laps, fedora);
//   66 at 300 ms, lite client with the rs/22 publish fix, 1-tick latency (9 of 9, bbs).
// On the demo server packets land 2-3 ticks after the state they answer
// (tickmanip-latency.ts from bbs), so about 71-76 there (inferred: +1 tick per obstacle per tick).
const WILD_CLEAN_LAP = Number(argv.find(a => a.startsWith('--lap='))?.slice(6) ?? '66');
// The fall costs were measured on 77-tick laps. A fall loop is the same walking at the same
// pace, so they scale with the lap (checked at 300 ms: a rope-swing fall cost 80 extra ticks on
// 71-tick laps, scaled 81; a log fall 52 on 69-tick laps, scaled 48, n=1).
const FALL_SCALE = WILD_CLEAN_LAP / 77;
const ROPE_FALL_TICKS = 88 * FALL_SCALE; // measured at 100 ms: laps with one rope fall took 164-166 vs 77 clean
const ROPE_FALL_XP = 52.5; // inferred: stones+log+pipe are redone (20+20+12.5), bonus waits a loop
const STONE_FALL_TICKS = 21 * FALL_SCALE; // measured at 100 ms: lap with one stones fall took 98
const LOG_FALL_TICKS = 53 * FALL_SCALE; // measured at 100 ms (n=1): pit, ladder, redo stones, back to the log
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

console.log(`clean Wilderness lap ${WILD_CLEAN_LAP} ticks (fall costs x${FALL_SCALE.toFixed(3)})`);
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
    // Planned quest route (cairn://p/rs/3): the troll chain is off, UP + Regicide pending rs/15.
    ['GT + UP + Regicide (on route)', Q.grandTree + Q.undergroundPass + Q.regicide],
    ['GT only (if the Regicide chain drops)', Q.grandTree],
    // Grand Tree is the only Agility quest left on the route once the Regicide chain is off;
    // these price each candidate (and their combinations) on top of it.
    ['GT + 2 Tourist Trap picks', Q.grandTree + 2 * Q.touristPick],
    ['GT + Troll Romance', Q.grandTree + Q.trollRomance],
    ['GT + Fremennik', Q.grandTree + Q.fremennik],
    ['GT + 2 TT picks + Troll Romance', Q.grandTree + 2 * Q.touristPick + Q.trollRomance],
    ['GT + 2 TT picks + Fremennik', Q.grandTree + 2 * Q.touristPick + Q.fremennik],
    ['GT + Troll Romance + Fremennik', Q.grandTree + Q.trollRomance + Q.fremennik],
    ['GT + 2 TT picks + Troll Romance + Fremennik', Q.grandTree + 2 * Q.touristPick + Q.trollRomance + Q.fremennik],
    ['GT + UP + Regicide + 1 Tourist Trap pick', Q.grandTree + Q.undergroundPass + Q.regicide + Q.touristPick],
    ['GT + UP + Regicide + 2 Tourist Trap picks', Q.grandTree + Q.undergroundPass + Q.regicide + 2 * Q.touristPick],
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

console.log('\nBands (no quests; best safe method in each band):');
const bands: [number, number, string, (L: number) => number][] = [
    [1, 15, 'gnome', () => GNOME],
    [15, 52, 'gnome (or monkey bars)', () => GNOME],
    [15, 52, 'monkey bars', () => MONKEYBARS],
    [52, 70, 'wilderness', L => best(L)],
    [70, 85, 'wilderness', L => best(L)],
    [85, 93, 'wilderness', L => best(L)],
    [93, 96, 'wilderness', L => best(L)],
    [96, 99, 'wilderness', L => best(L)],
];
for (const [a, b, name, rate] of bands) {
    const xp = LEVEL_BASE[b] - LEVEL_BASE[a];
    console.log(`  ${a}->${b} ${name}: ${xp.toFixed(1)} base, ${r(ticksBetween(LEVEL_BASE[a], LEVEL_BASE[b], rate))} ticks`);
}
console.log(`\nCombos that finish 99 without training (core = GT+Regicide+TR+UP = ${core}, need ${(X99 - core).toFixed(1)} more):`);
for (const [name, xp] of [['1 Legends pick', Q.legendsPick], ['2 Tourist Trap picks', 2 * Q.touristPick], ['Fremennik + 1 Tourist Trap pick', Q.fremennik + Q.touristPick], ['1 Tourist Trap pick', Q.touristPick], ['Fremennik', Q.fremennik]] as [string, number][]) {
    console.log(`  ${name}: ${(core + xp).toFixed(1)} -> ${core + xp >= X99 ? '99, 0 ticks' : `${r(to99(core + xp))} ticks left`}`);
}

// ---- Monte Carlo (--sim): the spread of the Wilderness bands, for a P(#1) against a record row.
// Fall costs measured at 75-85 on 66-tick laps (docs/speedrun/rehearsals/agility.md section 6.6):
// a stones fall +16 ticks (no xp), a log fall +47 (the stones redone, +20 base), a rope-swing fall
// +75 (stones, log and pipe redone, +52.5 base). They add: a lap with a rope and a stones fall was 157.
const simArg = argv.find(a => a === '--sim' || a.startsWith('--sim='));
if (simArg) {
    const N = Number(simArg.split('=')[1] ?? 20000);
    const flagNum = (k: string, d: number) => Number(argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d);
    const record = flagNum('record', 6772), fixed = flagNum('fixed', 1971), restock = flagNum('restock', 0);
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const simBand = (from: number, to: number) => {
        let xp = LEVEL_BASE[from]!, t = 0, laps = 0, falls = 0;
        while (xp < LEVEL_BASE[to]! - 1e-9) {
            const L = levelOf(xp);
            const pr = 1 - succ(200, 250, L), ps = 1 - succ(180, 250, L);
            t += WILD_CLEAN_LAP;
            laps++;
            while (rnd() < pr) { t += 75; xp += 52.5; falls++; }
            while (rnd() < ps) { t += 16; falls++; }
            while (rnd() < pr) { t += 47; xp += 20; falls++; }
            xp += WILD_LAP_XP;
        }
        return { t, laps, falls };
    };
    console.log(`\nMonte Carlo, ${N} runs, clean lap ${WILD_CLEAN_LAP}:`);
    for (const [a, b] of [[52, 99], [75, 85], [85, 99], [75, 99]] as const) {
        const ts: number[] = [];
        let laps = 0, falls = 0;
        for (let i = 0; i < N; i++) { const s = simBand(a, b); ts.push(s.t); laps += s.laps; falls += s.falls; }
        ts.sort((x, y) => x - y);
        const mean = ts.reduce((x, y) => x + y, 0) / N;
        const sd = Math.sqrt(ts.reduce((x, y) => x + (y - mean) ** 2, 0) / N);
        console.log(`  ${a}->${b}: mean ${r(mean)}, sd ${r(sd)}, p5 ${ts[(N * 0.05) | 0]}, p95 ${ts[(N * 0.95) | 0]}; ${(laps / N).toFixed(1)} laps, ${(falls / N).toFixed(1)} falls`);
        if (a === 52 && b === 99) {
            const bar = record - fixed - restock;
            console.log(`  total = ${fixed} fixed + ${restock} restock + 52->99: mean ${r(mean + fixed + restock)}; P(< ${record}) = ${((ts.filter(x => x < bar).length / N) * 100).toFixed(1)}%`);
        }
    }
}
