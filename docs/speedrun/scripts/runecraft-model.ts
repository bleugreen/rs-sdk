// Runecraft route model: crafts and ticks to 99 for an altar sequence, using
// the engine's level table (Player.ts:77-85) and a measured cycle length.
// One craft converts every essence held (runecraft.rs2:68-99); xp per essence
// from runecraft.dbrow. Travel between altars is not modelled (runecraft.md
// section 6 costs it separately).
// Run: bun docs/speedrun/scripts/runecraft-model.ts

const levelExp: number[] = [];
let acc = 0;
for (let level = 1; level <= 99; level++) {
    acc += Math.floor(level + Math.pow(2, level / 10) * 300);
    levelExp.push(Math.floor(acc / 4) * 10); // tenths of game xp; level L needs levelExp[L-2]
}
const need = (L: number) => (L <= 1 ? 0 : levelExp[L - 2]); // tenths of game xp
const levelOf = (x: number) => { for (let i = 98; i >= 0; i--) if (x >= levelExp[i]) return Math.min(i + 2, 99); return 1; };
const XPRATE = 25;

const ALT: Record<string, { level: number; xp: number }> = {
    air: { level: 1, xp: 50 }, mind: { level: 2, xp: 55 }, water: { level: 5, xp: 60 }, earth: { level: 9, xp: 65 },
    fire: { level: 14, xp: 70 }, body: { level: 20, xp: 75 }, cosmic: { level: 27, xp: 80 }, chaos: { level: 35, xp: 85 },
    nature: { level: 44, xp: 90 }, law: { level: 54, xp: 95 },
};

// route: list of [altar, untilLevel]; the last band runs to 99.
function run(route: Array<[string, number]>, ess: number, cycle: number, startBase = 0) {
    let x = Math.round(startBase * XPRATE * 10);
    const bands: Array<{ altar: string; from: number; to: number; crafts: number; essence: number; ticks: number }> = [];
    let total = 0, totalEss = 0;
    for (const [altar, until] of route) {
        const a = ALT[altar];
        const from = levelOf(x);
        if (from < a.level) throw new Error(`${altar} needs ${a.level}, at ${from}`);
        let crafts = 0;
        const goal = need(Math.min(until, 99));
        while (x < goal) { x += ess * a.xp * XPRATE; crafts++; }
        bands.push({ altar, from, to: levelOf(x), crafts, essence: crafts * ess, ticks: crafts * cycle });
        total += crafts; totalEss += crafts * ess;
        if (x >= need(99)) break;
    }
    return { crafts: total, essence: totalEss, ticks: total * cycle, bands };
}

console.log(`base xp for 99: ${need(99) / 10 / XPRATE}; 44: ${need(44) / 250}; 54: ${need(54) / 250}`);
const routes: Record<string, Array<[string, number]>> = {
    'air 1-44, nature 44-99': [['air', 44], ['nature', 99]],
    'air 1-54, law 54-99': [['air', 54], ['law', 99]],
    'air 1-44, nature 44-54, law 54-99': [['air', 44], ['nature', 54], ['law', 99]],
    'air 1-20, body 20-44, nature 44-99': [['air', 20], ['body', 44], ['nature', 99]],
    'air 1-99': [['air', 99]],
    'nature from 44 only': [['nature', 99]],
    'law from 54 only': [['law', 99]],
};
const cadences: Array<[string, number, number]> = [
    ['tuned, 27/trade, 7 ticks (measured)', 27, 7],
    ['robust, 27/trade, 8 ticks (measured)', 27, 8],
    ['stock SDK, 27/trade, 15 ticks (measured)', 27, 15],
    ['resident helper, 28/trade, 7 ticks (inferred)', 28, 7],
];
for (const [cname, ess, cyc] of cadences) {
    console.log(`\n== ${cname}`);
    for (const [rname, r] of Object.entries(routes)) {
        const start = rname.startsWith('nature from') ? need(44) / 250 : rname.startsWith('law from') ? need(54) / 250 : 0;
        const m = run(r, ess, cyc, start);
        console.log(`${rname.padEnd(40)} crafts ${String(m.crafts).padStart(4)}  essence ${String(m.essence).padStart(5)}  ticks ${String(m.ticks).padStart(5)}  | ${m.bands.map(b => `${b.altar} ${b.from}->${b.to}: ${b.crafts}`).join(', ')}`);
    }
}
// Helpers outside the room (law: helpers lack Troll Stronghold): measured stock
// 32 ticks for 26 essence at law, 25 at nature.
console.log('\n== helpers outside the room, stock, 26/trade (measured cycle)');
console.log('law 54-99 at 32 ticks:', run([['law', 99]], 26, 32, need(54) / 250).ticks, ' nature 44-99 at 25 ticks:', run([['nature', 99]], 26, 25, need(44) / 250).ticks);
