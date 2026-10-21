// Woodcutting route model with the auto-retaliate flinch (self-only-methods.md section 3a).
// Same simulator as woodcutting-model.ts (level table, success roll, 1/8 fells, respawn
// scaling, 1 tick per level-up), generalised per band to a cycle length, a number of trees
// reachable from the standing tile, a cost per tree switch and an all-down overhead.
//
//   bun docs/speedrun/scripts/flinch-model.ts [--trials 400]
//
// Inputs for the flinch bands (labels as in docs/speedrun/skills/README.md):
// - measured (flinch-wc.ts, 2026-10-21, fedora, NODE_TICKRATE=300): steady gaps 2 ticks on
//   160 of 166 and 4 on 6, so a step of 2 with probability 0.964 and 4 otherwise; with
//   every tree down the next roll came 30-32 ticks after the fell at D=29, i.e. at the
//   respawn + 2.
// - inferred: a fell with another tree at the same tile costs nothing (the next flinch
//   click goes to the other tree); a switch that needs a 2-tile walk costs 4 ticks (the
//   walk tick sets waypoints, so that hit cannot flinch, and the next hit is 2 later).
// - knife bands: cycle 3 with every tree down at respawn + 3 (inferred, as
//   woodcutting.md); the route documents use 0.765 x the 4-tick totals instead, printed
//   beside it for comparison.
const argv = process.argv.slice(2);
const opt = (n: string, d: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1]! : d; };
const TRIALS = Number(opt('trials', '400'));

const LEVEL_XP: number[] = [0, 0];
{
    let acc = 0;
    for (let level = 1; level <= 98; level++) {
        acc += Math.floor(level + Math.pow(2, level / 10) * 300);
        LEVEL_XP.push(Math.floor(acc / 4) / 25);
    }
}
const levelOf = (xp: number) => { let L = 1; while (L < 99 && xp >= LEVEL_XP[L + 1]!) L++; return L; };

type Tree = { name: string; xp: number; lo: number; hi: number; respawn: number; fellsEveryLog: boolean };
const T: Record<string, Tree> = {
    normal: { name: 'normal', xp: 25, lo: 224, hi: 700, respawn: 160, fellsEveryLog: true },
    oak: { name: 'oak', xp: 37.5, lo: 112, hi: 350, respawn: 30, fellsEveryLog: false },
    willow: { name: 'willow', xp: 67.5, lo: 56, hi: 175, respawn: 30, fellsEveryLog: false },
};
const p = (t: Tree, L: number) => Math.min(Math.floor((t.lo * (99 - L)) / 98) + Math.floor((t.hi * (L - 1)) / 98) + 1, 256) / 256;

// cycle: 'four' | 'knife' | 'flinch'
type Band = { from: number; tree: Tree; cycle: 'four' | 'knife' | 'flinch'; trees: number; switchCost: number };
type Route = { name: string; bands: Band[] };

function simulate(route: Route, players: number, rng: () => number) {
    const scale = (r: number) => Math.floor((r * (4000 - Math.min(players, 2000))) / 4000);
    let xp = 0, t = 0, L = 1;
    let band = route.bands[0]!;
    let deadUntil: number[] = new Array(band.trees).fill(0);
    let lastTree = -1;
    while (L < 99) {
        const nb = [...route.bands].reverse().find(b => L >= b.from)!;
        if (nb !== band) { band = nb; deadUntil = new Array(band.trees).fill(0); lastTree = -1; }
        const { tree, cycle } = band;
        const allDownExtra = cycle === 'four' ? 4 : cycle === 'knife' ? 3 : 2;
        let live = deadUntil.findIndex(d => d <= t);
        if (live < 0 && !tree.fellsEveryLog) {
            const first = Math.min(...deadUntil);
            t = Math.max(t, first);
            live = deadUntil.indexOf(first);
        }
        if (lastTree >= 0 && live !== lastTree) t += band.switchCost;
        lastTree = live;
        let step = cycle === 'four' ? 4 : cycle === 'knife' ? 3 : (rng() < 0.964 ? 2 : 4);
        if (rng() < p(tree, L)) {
            xp += tree.xp;
            if (tree.fellsEveryLog) step += 1;
            else if (rng() < 1 / 8) deadUntil[live] = t + scale(tree.respawn) + allDownExtra;
            const nL = levelOf(xp);
            if (nL > L) { step += 1; L = nL; }
        }
        t += step;
    }
    return t;
}

function mulberry32(a: number) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let x = Math.imul(a ^ (a >>> 15), 1 | a); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }
const mean = (r: Route, players: number) => { const rng = mulberry32(12345); let s = 0; for (let i = 0; i < TRIALS; i++) s += simulate(r, players, rng); return s / TRIALS; };

const normal: Band = { from: 1, tree: T.normal!, cycle: 'four', trees: 3, switchCost: 0 };
const routes: Route[] = [
    { name: '4-tick route (check: woodcutting.md 3,958 demo / 4,001 quiet)', bands: [normal, { from: 15, tree: T.oak!, cycle: 'four', trees: 3, switchCost: 0 }, { from: 73, tree: T.willow!, cycle: 'four', trees: 3, switchCost: 0 }] },
    { name: 'Knife route, simulated at 3 ticks (docs use 0.765 x 4-tick)', bands: [normal, { from: 15, tree: T.oak!, cycle: 'knife', trees: 3, switchCost: 0 }, { from: 73, tree: T.willow!, cycle: 'knife', trees: 3, switchCost: 0 }] },
    { name: 'NPC flinch on the two-willow tile from 73, knife oaks before', bands: [normal, { from: 15, tree: T.oak!, cycle: 'knife', trees: 3, switchCost: 0 }, { from: 73, tree: T.willow!, cycle: 'flinch', trees: 2, switchCost: 0 }] },
    { name: 'NPC flinch on two-tree tiles throughout (oaks 15-73, willows 73-99)', bands: [normal, { from: 15, tree: T.oak!, cycle: 'flinch', trees: 2, switchCost: 0 }, { from: 73, tree: T.willow!, cycle: 'flinch', trees: 2, switchCost: 0 }] },
    { name: 'Helper flinch, Wilderness oaks 15-99, two oaks a 2-tile walk apart', bands: [normal, { from: 15, tree: T.oak!, cycle: 'flinch', trees: 2, switchCost: 4 }] },
    { name: 'Helper flinch, Wilderness oaks 15-99, one oak (wait out every fell)', bands: [normal, { from: 15, tree: T.oak!, cycle: 'flinch', trees: 1, switchCost: 0 }] },
    { name: 'NPC flinch on one oak (the lab tile), 15-99', bands: [normal, { from: 15, tree: T.oak!, cycle: 'flinch', trees: 1, switchCost: 0 }] },
];

console.log('| Route | Ticks to 99, demo (D=20) | Quiet (D=29) |');
console.log('|---|---|---|');
for (const r of routes) console.log(`| ${r.name} | ${mean(r, 1260).toFixed(0)} | ${mean(r, 1).toFixed(0)} |`);
const four = routes[0]!;
console.log(`\nknife as the docs price it (0.765 x 4-tick): demo ${(mean(four, 1260) * 0.765).toFixed(0)}, quiet ${(mean(four, 1) * 0.765).toFixed(0)}`);
