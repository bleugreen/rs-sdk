// Models for the delay-free skills (rs/37): levels, the wine fermentation timer, and route
// totals from measured cycle lengths. No server needed.
//
//   bun docs/speedrun/scripts/delayfree-model.ts levels <base xp> [...]
//   bun docs/speedrun/scripts/delayfree-model.ts wine [--trials=20000]
//   bun docs/speedrun/scripts/delayfree-model.ts routes
//
// wine: Monte Carlo of the fermentation timer exactly as wine.rs2:22-70 runs it. Bank:
//   15 batches of floor(N/15), each one stat_random(cooking, 48, 352) roll for the whole
//   batch at the CURRENT level, then N % 15 single rolls; then each inventory wine singly.
//   stat_random: floor(lo*(99-L)/98) + floor(hi*(L-1)/98) + 1 > rand(256)
//   (server/engine/src/engine/script/handlers/PlayerOps.ts, STAT_RANDOM). A good wine is
//   110 base (stat_advance(cooking, 1100)); the server multiplies by 25.
// routes: ticks from a start level to 99 for each skill's route, from the per-inventory
//   cycle lengths measured with delayfree-cycle.ts (bbs, NODE_TICKRATE=300).

const LEVEL_XP: number[] = []; // game xp at the start of level L (Player.ts:77-85)
{
    let acc = 0;
    LEVEL_XP[1] = 0;
    for (let i = 0; i < 98; i++) {
        acc += Math.floor(i + 1 + Math.pow(2, (i + 1) / 10) * 300);
        LEVEL_XP[i + 2] = Math.floor(acc / 4);
    }
}
const levelOf = (xp: number) => { let l = 1; while (l < 99 && xp >= LEVEL_XP[l + 1]!) l++; return l; };
const baseOf = (level: number) => LEVEL_XP[level]! / 25;
const statRandom = (level: number, lo: number, hi: number) =>
    Math.floor((lo * (99 - level)) / 98) + Math.floor((hi * (level - 1)) / 98) + 1 > Math.floor(Math.random() * 256);
const chance = (level: number, lo: number, hi: number) =>
    Math.min(256, Math.floor((lo * (99 - level)) / 98) + Math.floor((hi * (level - 1)) / 98) + 1) / 256;

const args = process.argv.slice(2);
const flag = (k: string, d: number) => Number(args.find(a => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
const cmd = args[0] ?? 'wine';

if (cmd === 'levels') {
    for (const a of args.slice(1)) {
        const b = Number(a);
        console.log(`${b} base -> level ${levelOf(b * 25)} (that level starts at ${baseOf(levelOf(b * 25)).toFixed(1)} base)`);
    }
}

/** One firing of the timer; returns the new game xp. */
function ferment(xp: number, bank: number, inv: number): number {
    const batch = Math.floor(bank / 15);
    if (batch > 0) for (let i = 0; i < 15; i++) if (statRandom(levelOf(xp), 48, 352)) xp += 2750 * batch;
    for (let i = 0; i < bank % 15; i++) if (statRandom(levelOf(xp), 48, 352)) xp += 2750;
    for (let i = 0; i < inv; i++) if (statRandom(levelOf(xp), 48, 352)) xp += 2750;
    return xp;
}

if (cmd === 'wine') {
    const T = flag('trials', 20000);
    const goal = LEVEL_XP[99]!;
    console.log(`99 = ${goal} game xp = ${(goal / 25).toFixed(1)} base = ${Math.ceil(goal / 2750)} good wines; fermentation succeeds always from level ${[...Array(99).keys()].map(i => i + 1).find(l => chance(l, 48, 352) >= 1)} (chance at 1: ${(chance(1, 48, 352) * 100).toFixed(1)}%)`);
    const run = (label: string, plan: Array<[number, number]>, startXp = 0) => {
        let ok = 0, sumLevel = 0;
        const short: number[] = [];
        for (let t = 0; t < T; t++) {
            let xp = startXp;
            for (const [bank, inv] of plan) xp = ferment(xp, bank, inv);
            if (xp >= goal) ok++; else short.push(Math.ceil((goal - xp) / 2750));
            sumLevel += levelOf(xp);
        }
        short.sort((a, b) => a - b);
        const wines = plan.reduce((a, [b, i]) => a + b + i, 0);
        console.log(`${label.padEnd(52)} wines ${String(wines).padStart(4)}  P(99) ${(ok / T * 100).toFixed(1).padStart(5)}%  mean level ${(sumLevel / T).toFixed(1)}  when short: median ${short[Math.floor(short.length / 2)] ?? 0} wines missing`);
    };
    console.log('\n-- one firing at Cooking 1 (wines all in the bank) --');
    for (const n of [450, 520, 600, 750, 900, 1200]) run(`${n} in the bank at one login`, [[n, 0]]);
    console.log('\n-- two firings: a small first batch, the rest at the next login --');
    for (const [a, b] of [[15, 435], [29, 420], [30, 420], [45, 405], [60, 390]] as const) run(`${a} then ${b}`, [[a, 0], [b, 0]]);
    run('29 bank + 28 inventory, then 400', [[29, 28], [400, 0]]);
    console.log('\n-- two firings, sized for the safe margin --');
    for (const b of [380, 400, 440]) run(`30 then ${b}`, [[30, 0], [b, 0]]);
    console.log('\n-- pre-levelled by ugthanki kebabs (120 base each, 100% from level 37), then one firing --');
    for (const lvl of [37, 50, 60, 68]) {
        const need = Math.ceil((goal - LEVEL_XP[lvl]!) / 2750);
        run(`from level ${lvl} (${Math.ceil(baseOf(lvl) / 120)} kebabs), ${need} wines`, [[need, 0]], LEVEL_XP[lvl]!);
        run(`from level ${lvl}, ${need + 15} wines`, [[need + 15, 0]], LEVEL_XP[lvl]!);
    }
}

if (cmd === 'routes') {
    // Per-inventory cycle, ticks (open-to-open), measured on bbs at 300 ms with delayfree-cycle.ts.
    // fast = tick-driven fire-and-forget script on the stock lite client; stock = SDK porcelain.
    interface Band { level: number; xp: number; name: string }
    const routes: Record<string, { perInv: number; fast: number; stock: number; bands: Band[] }> = {
        herblore: {
            perInv: 14, fast: 5.07, stock: 21.14, bands: [
                { level: 3, xp: 25, name: 'attack' }, { level: 12, xp: 50, name: 'strength' }, { level: 22, xp: 62.5, name: 'restore' },
                { level: 26, xp: 67.5, name: 'energy' }, { level: 30, xp: 75, name: 'defence' }, { level: 38, xp: 87.5, name: 'prayer' },
                { level: 45, xp: 100, name: 'super attack' }, { level: 50, xp: 112.5, name: 'fishing' }, { level: 52, xp: 117.5, name: 'super energy' },
                { level: 55, xp: 125, name: 'super strength' }, { level: 60, xp: 137.5, name: 'weapon poison' }, { level: 63, xp: 142.5, name: 'super restore' },
                { level: 66, xp: 150, name: 'super defence' }, { level: 69, xp: 157.5, name: 'antifire' }, { level: 72, xp: 162.5, name: 'ranging' },
                { level: 76, xp: 172.5, name: 'magic' }, { level: 78, xp: 175, name: 'zamorak' }]
        },
        crafting: {
            perInv: 27, fast: 8.2, stock: 31.9, bands: [
                { level: 1, xp: 15 * 0.6, name: 'opal (about 60% success early)' }, { level: 20, xp: 50, name: 'sapphire' }, { level: 27, xp: 67.5, name: 'emerald' },
                { level: 34, xp: 85, name: 'ruby' }, { level: 43, xp: 107.5, name: 'diamond' }, { level: 55, xp: 137.5, name: 'dragonstone' }]
        },
        'crafting (diamond only above 43)': {
            perInv: 27, fast: 8.62, stock: 31.9, bands: [
                { level: 1, xp: 9, name: 'opal' }, { level: 20, xp: 50, name: 'sapphire' }, { level: 27, xp: 67.5, name: 'emerald' },
                { level: 34, xp: 85, name: 'ruby' }, { level: 43, xp: 107.5, name: 'diamond' }]
        },
        'cooking (kebab)': { perInv: 14, fast: 5.48, stock: 22, bands: [{ level: 1, xp: 120, name: 'ugthanki kebab' }] }
    };
    const ticks = (r: (typeof routes)[string], start: number, cycle: number) => {
        let xp = LEVEL_XP[start]!, actions = 0;
        while (xp < LEVEL_XP[99]!) {
            const b = [...r.bands].reverse().find(x => x.level <= levelOf(xp))!;
            xp += b.xp * 25;
            actions++;
        }
        const inventories = Math.ceil(actions / r.perInv);
        return { actions, inventories, ticks: Math.round(inventories * cycle) };
    };
    for (const [name, r] of Object.entries(routes)) {
        console.log(`\n${name}: ${r.perInv} per inventory, fast cycle ${r.fast} ticks, stock ${r.stock}`);
        for (const start of [1, 3, 28, 42, 43, 55, 57, 66]) {
            if (start < r.bands[0]!.level) continue;
            const f = ticks(r, start, r.fast), s = ticks(r, start, r.stock);
            console.log(`  from ${String(start).padStart(2)} (${baseOf(start).toFixed(0).padStart(5)} base): ${f.actions} actions, ${f.inventories} inventories; fast ${f.ticks} ticks, stock ${s.ticks} ticks`);
        }
    }
    // Fletching: stackable, 5 actions per tick, no bank (measured 1->99 in 50 ticks).
    const arrows = [[1, 19.5], [15, 37.5], [30, 75], [45, 112.5], [60, 150], [75, 187.5]] as const;
    console.log('\nfletching (arrows, 15 per action, 5 actions per tick, no bank):');
    for (const start of [1, 25, 35, 75]) {
        let xp = LEVEL_XP[start]!, actions = 0;
        while (xp < LEVEL_XP[99]!) { xp += [...arrows].reverse().find(a => a[0] <= levelOf(xp))![1] * 25; actions++; }
        console.log(`  from ${start}: ${actions} actions = ${Math.ceil(actions / 5)} ticks at 5 per tick, ${actions} ticks at 1 per tick (stock)`);
    }
}
