// Woodcutting route model: ticks to 99 from any starting base xp (no server needed).
//
//   bun docs/speedrun/scripts/woodcutting-model.ts [--respawn-players 1260] [--trials 400]
//
// Inputs (labels as in docs/speedrun/skills/README.md):
// - read: level table (Player.ts:77-85), success roll floor(lo*(99-L)/98) +
//   floor(hi*(L-1)/98) + 1 > rand(256) (PlayerOps.ts:591-600), rune axe lo/hi, xp,
//   respawn and level requirement per tree (trees.dbrow), 1/8 depletion per log and
//   a fell on every normal-tree log (woodcut.rs2:168-174, 184-188), respawn scaled by
//   floor(r*(4000-min(players,2000))/4000) (player_count.rs2).
// - measured (woodcutting-chop.ts --click predict, engine trace): a roll every 4 ticks
//   while any tree at the standing tile is live; drops and tree switches sent on the
//   tick after a roll cost 0; with every tree down, the next roll comes D+4 ticks after
//   the first of them fell (stock client, reacting to the respawn).
// - inferred: 1 tick per level-up (engine order World.ts:402,793,801; mining.md
//   measured 1). Normal trees (levels 1-15): one log per tree, so each log costs one
//   extra tick of walking to the next tree. Knife cycle: ticks x 0.765, the ratio
//   tick-manipulation.md measured on willows at 99 (4.23 / 5.53 ticks per log).
const argv = process.argv.slice(2);
const opt = (n: string, d: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1]! : d; };
const TRIALS = Number(opt('trials', '400'));
const KNIFE = 0.765;

// level thresholds in base xp
// Player.ts:77-85 stores floor(acc/4)*10 in tenths of game xp for level i+2, i.e.
// floor(acc/4) game xp, which is floor(acc/4)/25 base xp.
const LEVEL_XP: number[] = [0, 0]; // LEVEL_XP[L] = base xp needed for level L
{
    let acc = 0;
    for (let level = 1; level <= 98; level++) {
        acc += Math.floor(level + Math.pow(2, level / 10) * 300);
        LEVEL_XP.push(Math.floor(acc / 4) / 25);
    }
}
const levelOf = (xp: number) => { let L = 1; while (L < 99 && xp >= LEVEL_XP[L + 1]!) L++; return L; };

type Tree = { name: string; req: number; xp: number; lo: number; hi: number; respawn: number; fellsEveryLog: boolean };
const TREES: Tree[] = [
    { name: 'normal', req: 1, xp: 25, lo: 224, hi: 700, respawn: 160, fellsEveryLog: true },
    { name: 'oak', req: 15, xp: 37.5, lo: 112, hi: 350, respawn: 30, fellsEveryLog: false },
    { name: 'willow', req: 30, xp: 67.5, lo: 56, hi: 175, respawn: 30, fellsEveryLog: false },
    { name: 'maple', req: 45, xp: 100, lo: 28, hi: 87, respawn: 120, fellsEveryLog: false },
    { name: 'hollow', req: 45, xp: 82.5, lo: 64, hi: 94, respawn: 86, fellsEveryLog: false },
    { name: 'yew', req: 60, xp: 175, lo: 14, hi: 44, respawn: 200, fellsEveryLog: false },
    { name: 'magic', req: 75, xp: 250, lo: 7, hi: 21, respawn: 400, fellsEveryLog: false },
];
const p = (t: Tree, L: number) => Math.min(Math.floor((t.lo * (99 - L)) / 98) + Math.floor((t.hi * (L - 1)) / 98) + 1, 256) / 256;
// ideal base xp per tick: 4-tick cycle, plus a walking tick per log on normal trees
const ideal = (t: Tree, L: number) => (t.xp * p(t, L)) / (t.fellsEveryLog ? 4 + p(t, L) : 4);
const best = (L: number) => TREES.filter(t => t.req <= L).reduce((a, b) => (ideal(b, L) > ideal(a, L) ? b : a));

function simulate(startXp: number, players: number, rng: () => number) {
    const scale = (r: number) => Math.floor((r * (4000 - Math.min(players, 2000))) / 4000);
    let xp = startXp, t = 0, L = levelOf(xp);
    const reached: number[] = []; reached[L] = 0;
    // 3 trees at the standing tile; deadUntil = first roll tick a felled tree can take.
    // A tree felled at R is back at the end of R+D-1, seen at R+D, clicked then and
    // rolled 4 ticks later: R+D+4 (measured 424 -> 457 at D=29). A roll on tick t uses a
    // tree clicked on t-3, so the predicted rotation uses it from the same tick.
    let deadUntil = [0, 0, 0];
    let tree = best(L);
    while (L < 99) {
        const nb = best(L);
        if (nb !== tree) { tree = nb; deadUntil = [0, 0, 0]; }
        // roll at t on a live tree
        let live = deadUntil.findIndex(d => d <= t);
        if (live < 0 && !tree.fellsEveryLog) {
            const first = Math.min(...deadUntil);
            t = Math.max(t, first);
            live = deadUntil.indexOf(first);
        }
        let step = 4;
        if (rng() < p(tree, L)) {
            xp += tree.xp;
            if (tree.fellsEveryLog) step += 1;
            else if (rng() < 1 / 8) deadUntil[live] = t + scale(tree.respawn) + 4;
            const nL = levelOf(xp);
            if (nL > L) { step += 1; for (let k = L + 1; k <= nL; k++) reached[k] = t + 1; L = nL; }
        }
        t += step;
    }
    return { ticks: reached[99]!, reached };
}

function mulberry32(a: number) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let x = Math.imul(a ^ (a >>> 15), 1 | a); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }

const mean = (start: number, players: number) => {
    const rng = mulberry32(12345);
    let sum = 0;
    for (let i = 0; i < TRIALS; i++) sum += simulate(start, players, rng).ticks;
    return sum / TRIALS;
};

// ---- output ----
console.log('## best tree by level (ideal base xp per tick, rune axe, 4-tick cycle)');
let prev = '';
for (let L = 1; L <= 99; L++) {
    const b = best(L);
    if (b.name !== prev) console.log(`L${L}: ${b.name} ${ideal(b, L).toFixed(2)}  (${TREES.filter(t => t.req <= L).map(t => `${t.name} ${ideal(t, L).toFixed(2)}`).join(', ')})`);
    prev = b.name;
}
for (const L of [15, 30, 45, 60, 75, 90, 99]) console.log(`L${L}: ${TREES.filter(t => t.req <= L).map(t => `${t.name} p=${p(t, L).toFixed(3)} ${ideal(t, L).toFixed(2)}/t`).join(', ')}`);

console.log('\n## ticks to 99 (mean of trials; 3 trees per spot)');
console.log('| Start | Base xp | Level | 4-tick, quiet (D=29) | 4-tick, demo 1,260 online (D=20) | knife x0.765, quiet | knife x0.765, demo |');
console.log('|---|---|---|---|---|---|---|');
for (const [label, xp] of [['Level 1, no quests', 0], ['Monk\'s Friend', 2000], ['Fremennik Trials', 2812.4], ['Monk\'s Friend + Fremennik', 4812.4], ['Hero\'s Quest', 1575], ['Monk\'s Friend + Hero\'s Quest', 3575]] as [string, number][]) {
    const q = mean(xp, 1), d = mean(xp, 1260);
    console.log(`| ${label} | ${xp.toLocaleString('en-US')} | ${levelOf(xp)} | ${q.toFixed(0)} | ${d.toFixed(0)} | ${(q * KNIFE).toFixed(0)} | ${(d * KNIFE).toFixed(0)} |`);
}

console.log('\n## ticks remaining to 99 from the start of each level (4-tick, demo D=20; knife = x0.765)');
console.log('| Level | Base xp | Ticks to 99 |');
console.log('|---|---|---|');
const rng = mulberry32(777);
const acc: number[] = new Array(100).fill(0);
for (let i = 0; i < TRIALS; i++) {
    const r = simulate(0, 1260, rng);
    for (let L = 1; L <= 99; L++) acc[L]! += r.ticks - (r.reached[L] ?? 0);
}
for (const L of [1, 10, 15, 20, 25, 30, 35, 40, 45, 50, 52, 55, 57, 60, 65, 70, 75, 80, 85, 90, 93, 95, 97, 98, 99]) console.log(`| ${L} | ${LEVEL_XP[L]!.toFixed(1)} | ${(acc[L]! / TRIALS).toFixed(0)} |`);
