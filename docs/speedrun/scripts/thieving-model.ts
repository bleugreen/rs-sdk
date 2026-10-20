#!/usr/bin/env bun
/**
 * Thieving route model. Inputs are read from content (targets) and measured
 * with thieving-pickpocket.ts (cadence); outputs are inferred.
 *
 *   bun docs/speedrun/scripts/thieving-model.ts [--overhead=0.2]
 *
 * Per roll: a success costs 2 ticks, a failure costs stun_ticks + 3 (11 for
 * stun 8, 13 for heroes' stun 10), plus --overhead ticks of walking after a
 * wandering target (measured 0.1-0.5 per roll depending on the knight).
 * Expected ticks per success at level L = 2 + (1-p)/p * (stun+3) + overhead/p.
 */
const argv = process.argv.slice(2);
const OVERHEAD = Number(argv.find(a => a.startsWith('--overhead='))?.slice(11) ?? '0.2');

// Player.ts levelExperience: fine units (tenths of game xp); base = game / 25.
const levelBase: number[] = [0, 0];
let acc = 0;
for (let level = 1; level < 99; level++) {
    acc += Math.floor(level + Math.pow(2, level / 10) * 300);
    levelBase[level + 1] = (Math.floor(acc / 4) * 10) / 10 / 25;
}
const levelOf = (xp: number) => { let l = 1; while (l < 99 && levelBase[l + 1] <= xp) l++; return l; };

// pickpocket.dbrow: level, experience (tenths), stun_ticks, stun_damage, success_chance lo,hi.
type Target = { name: string; level: number; xp: number; stun: number; dmg: number; lo: number; hi: number; where: string };
const TARGETS: Target[] = [
    { name: 'Man/Woman', level: 1, xp: 8.0, stun: 8, dmg: 1, lo: 180, hi: 240, where: 'Ardougne market' },
    { name: 'Farmer', level: 10, xp: 14.5, stun: 8, dmg: 1, lo: 150, hi: 240, where: 'not near Ardougne' },
    { name: 'Warrior', level: 25, xp: 26.0, stun: 8, dmg: 2, lo: 100, hi: 240, where: 'Ardougne (warrior women), Al-Kharid' },
    { name: 'Rogue', level: 32, xp: 36.5, stun: 8, dmg: 2, lo: 74, hi: 240, where: 'Rogues\' Castle, deep Wilderness' },
    { name: 'Guard', level: 40, xp: 46.8, stun: 8, dmg: 2, lo: 50, hi: 240, where: 'Ardougne market' },
    { name: 'Fremennik', level: 45, xp: 65.0, stun: 8, dmg: 2, lo: 40, hi: 240, where: 'Rellekka, needs Fremennik Trials' },
    { name: 'Knight of Ardougne', level: 55, xp: 84.3, stun: 8, dmg: 3, lo: 50, hi: 240, where: 'Ardougne market' },
    { name: 'Watchman', level: 65, xp: 137.5, stun: 8, dmg: 3, lo: 15, hi: 160, where: 'Yanille' },
    { name: 'Paladin', level: 70, xp: 151.8, stun: 8, dmg: 3, lo: 50, hi: 150, where: 'Ardougne market/castle' },
    { name: 'Gnome', level: 75, xp: 198.3, stun: 8, dmg: 1, lo: 8, hi: 120, where: 'Tree Gnome Stronghold' },
    { name: 'Hero', level: 80, xp: 273.3, stun: 10, dmg: 4, lo: 6, hi: 100, where: 'Ardougne market' },
];
const p = (t: Target, L: number) => {
    const l = Math.min(L, 99);
    return (Math.floor((t.lo * (99 - l)) / 98) + Math.floor((t.hi * (l - 1)) / 98) + 1) / 256;
};
const ticksPerSuccess = (t: Target, L: number) => 2 + ((1 - p(t, L)) / p(t, L)) * (t.stun + 3) + OVERHEAD / p(t, L);
const rate = (t: Target, L: number) => t.xp / ticksPerSuccess(t, L);

// Allowed target sets.
const ROUTES: Record<string, string[]> = {
    ardougne: ['Man/Woman', 'Warrior', 'Guard', 'Knight of Ardougne'],
    all: TARGETS.map(t => t.name),
};

/** Walk success by success from startXp to 99, always on the best allowed target. */
function route(startXp: number, allowed: string[]) {
    let xp = startXp, ticks = 0, varTicks = 0, fails = 0, hp = 0;
    const bands: { name: string; from: number; to: number; ticks: number }[] = [];
    while (xp < levelBase[99]) {
        const L = levelOf(xp);
        const t = TARGETS.filter(x => allowed.includes(x.name) && x.level <= L).sort((a, b) => rate(b, L) - rate(a, L))[0];
        const q = p(t, L);
        const f = (1 - q) / q; // expected failures per success (geometric)
        ticks += ticksPerSuccess(t, L);
        varTicks += ((1 - q) / (q * q)) * (t.stun + 3) ** 2;
        fails += f; hp += f * t.dmg;
        const last = bands[bands.length - 1];
        if (last?.name === t.name) { last.to = levelOf(xp + t.xp); last.ticks += ticksPerSuccess(t, L); }
        else bands.push({ name: t.name, from: L, to: levelOf(xp + t.xp), ticks: ticksPerSuccess(t, L) });
        xp += t.xp;
    }
    return { ticks: Math.round(ticks), sd: Math.round(Math.sqrt(varTicks)), fails: Math.round(fails), hpLost: Math.round(hp), bands };
}

console.log(`overhead ${OVERHEAD} ticks/roll; level 55 = ${levelBase[55].toFixed(1)} base, 99 = ${levelBase[99].toFixed(1)} base\n`);
console.log('Base xp per tick by level (best few targets):');
for (const L of [1, 10, 20, 25, 30, 32, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 99]) {
    const row = TARGETS.filter(t => t.level <= L).map(t => `${t.name} ${rate(t, L).toFixed(2)} (p ${p(t, L).toFixed(3)})`);
    console.log(`  L${L}: ${row.slice(-4).join(' | ')}`);
}
const quests: [string, number][] = [
    ['none', 0],
    ['Fight Arena', 2175],
    ['Fight Arena + Tourist Trap x1', 2175 + 4650],
    ['Fight Arena + Tourist Trap x2', 2175 + 9300],
    ['Fight Arena + TT x2 + Legends x1', 2175 + 9300 + 7650],
    ['Fight Arena + TT x2 + Legends x4', 2175 + 9300 + 30600],
];
for (const [routeName, allowed] of Object.entries(ROUTES)) {
    console.log(`\nRoute '${routeName}':`);
    for (const [q, xp] of quests) {
        const r = route(xp, allowed);
        console.log(`  start ${q} (${xp} base, level ${levelOf(xp)}): ${r.ticks} ticks (sd ${r.sd}), ${r.fails} fails, ${r.hpLost} hp lost`);
        if (xp === 0 || xp === 2175) for (const b of r.bands) console.log(`      ${b.name} ${b.from}-${b.to}: ${Math.round(b.ticks)} ticks`);
    }
}
// Value of one more quest pick at a given starting xp: ticks saved per pick.
console.log('\nTicks saved by adding a Thieving quest pick on top of a start (route ardougne):');
for (const [label, base] of [['from 0', 0], ['from Fight Arena', 2175], ['after FA+TT2', 11475]] as [string, number][]) {
    const r0 = route(base, ROUTES.ardougne).ticks;
    console.log(`  ${label}: +4,650 saves ${r0 - route(base + 4650, ROUTES.ardougne).ticks}, +7,650 saves ${r0 - route(base + 7650, ROUTES.ardougne).ticks}`);
}
