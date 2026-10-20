// Walking distances for the gnome-chain quest legs, computed offline on the
// SDK's collision map (sdk/pathfinding.ts, doors treated as open). No server
// needed. Ticks at run speed are ceil(tiles / 2).
// Also finds a search order through the 15 Daconia roots under the Grand Tree
// (daconia_coords.enum) that minimises the expected cost of finding the rock,
// which sits under one root chosen uniformly (king_narnode.rs2:70).
// Run: bun docs/speedrun/scripts/quest-gnome-routes.ts

import { pathTiles } from './quest-gnome-lib';

type P = [number, number, number?];
const legs: Array<[string, P, P]> = [
    // Tree Gnome Village (cross-checks of the walked legs in quest-tree-full.ts)
    ['TGV maze entrance (Elkoy) -> loose railing', [2504, 3193], [2515, 3160]],
    ['TGV railing -> King Bolren', [2515, 3161], [2541, 3171]],
    ['TGV Elkoy exit -> Commander Montai', [2504, 3191], [2523, 3212]],
    ['TGV ballista -> crumbled wall', [2511, 3210], [2509, 3252]],
    ['TGV stronghold ladder -> Elkoy', [2503, 3253], [2504, 3193]],
    ['TGV Elkoy exit -> warlord area', [2504, 3191], [2459, 3300]],
    ['TGV warlord -> Elkoy', [2456, 3297], [2504, 3193]],
    ['TGV arrival: Ardougne teleport -> maze entrance', [2661, 3305], [2504, 3193]],
    ['TGV arrival: Battlefield young tree -> maze entrance (tree unusable before TGV)', [2555, 3259], [2504, 3193]],
    // The Grand Tree
    ['GT stronghold spirit tree -> Narnode', [2461, 3444], [2466, 3496]],
    ['GT village spirit tree -> Hazelmere ladder', [2542, 3169], [2677, 3088]],
    ['GT Ardougne teleport -> Hazelmere ladder', [2661, 3305], [2677, 3088]],
    ['GT Hazelmere ladder (L0) -> village spirit tree', [2677, 3088], [2543, 3169]],
    ['GT Narnode -> Glough house ladder', [2466, 3496], [2476, 3464]],
    ['GT Glough house ladder -> Narnode', [2476, 3464], [2466, 3496]],
    ['GT Narnode -> Grand Tree ladder', [2466, 3496], [2466, 3494]],
    ['GT Glough house ladder -> Grand Tree ladder', [2476, 3464], [2466, 3494]],
    ['GT L1 Glough house: ladder -> cupboard', [2476, 3463, 1], [2476, 3464, 1]],
    ['GT L3 jail door -> glider pilot', [2466, 3496, 3], [2464, 3501, 3]],
    ['GT Karamja crash site -> shipyard gate', [2917, 3058], [2944, 3041]],
    ['GT shipyard gate (inside) -> foreman', [2945, 3041], [2999, 3043]],
    ['GT return: Varrock teleport -> Varrock young tree', [3213, 3424], [3177, 3505]],
    ['GT return: Ardougne teleport -> Battlefield young tree', [2661, 3305], [2555, 3259]],
    ['GT return: shipyard -> stronghold gate on foot', [2999, 3043], [2461, 3382]],
    ['GT stronghold spirit tree -> Grand Tree ladder', [2461, 3444], [2466, 3494]],
    ['GT Grand Tree ladder -> Anita stairs', [2466, 3494], [2389, 3511]],
    ['GT Anita stairs -> Glough house ladder', [2389, 3511], [2476, 3464]],
    ['GT L1 Glough house: chest -> climb tree', [2482, 3463, 1], [2484, 3465, 1]],
    ['GT underground: trapdoor landing -> Narnode', [2491, 9864], [2464, 9896]],
];

console.log('leg\ttiles\truntkicks\treached'.replace('runtkicks', 'run ticks'));
for (const [name, a, b] of legs) {
    const r = pathTiles(a[2] ?? 0, a[0], a[1], b[0], b[1]);
    console.log(`${name}\t${r.tiles}\t${Math.ceil(r.tiles / 2)}\t${r.reached}`);
}

// ─── Daconia roots ──────────────────────────────────────────────────────────
// daconia_coords.enum, 0_38_154_x_z -> (2432 + x, 9856 + z). Value 0 duplicates
// the coord of value 1; %daconia_rock_root is random_range(1, 15).
const roots: Array<[number, number]> = [
    [24, 30], [25, 25], [23, 18], [11, 22], [7, 25], [12, 37], [20, 37], [33, 35],
    [36, 34], [35, 40], [41, 41], [49, 48], [53, 29], [58, 33], [35, 16],
].map(([x, z]) => [2432 + x, 9856 + z]);
const narnode: [number, number] = [2464, 9896];
const pts = [narnode, ...roots];
const n = pts.length;
const d: number[][] = pts.map(() => Array(n).fill(0));
for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
        const r = pathTiles(0, pts[i][0], pts[i][1], pts[j][0], pts[j][1]);
        d[i][j] = d[j][i] = r.reached ? r.tiles : 9999;
    }
}
// Ticks to walk `tiles` at run speed.
const t = (tiles: number) => Math.ceil(tiles / 2);
const SEARCH = Number(process.env.ROOT_SEARCH_TICKS ?? 3);
// Expected ticks from Narnode, searching roots in `order` until the rock turns up, then back to Narnode.
function expected(order: number[]): { mean: number; worst: number } {
    let walked = 0, prev = 0, sum = 0, worst = 0;
    for (let k = 0; k < order.length; k++) {
        walked += t(d[prev][order[k]]);
        prev = order[k];
        const cost = walked + (k + 1) * SEARCH + t(d[prev][0]);
        sum += cost;
        worst = Math.max(worst, cost);
    }
    return { mean: sum / order.length, worst };
}
let best = Array.from({ length: n - 1 }, (_, i) => i + 1);
// Nearest-neighbour start, then 2-opt and swap moves on the expected cost.
{
    const left = new Set(best);
    const nn: number[] = [];
    let cur = 0;
    while (left.size) {
        let bi = -1;
        for (const j of left) if (bi < 0 || d[cur][j] < d[cur][bi]) bi = j;
        nn.push(bi);
        left.delete(bi);
        cur = bi;
    }
    best = nn;
}
let improved = true;
while (improved) {
    improved = false;
    for (let i = 0; i < best.length; i++) {
        for (let j = i + 1; j < best.length; j++) {
            const rev = [...best.slice(0, i), ...best.slice(i, j + 1).reverse(), ...best.slice(j + 1)];
            const sw = [...best];
            [sw[i], sw[j]] = [sw[j], sw[i]];
            for (const cand of [rev, sw]) {
                if (expected(cand).mean < expected(best).mean - 1e-9) {
                    best = cand;
                    improved = true;
                }
            }
        }
    }
}
const e = expected(best);
console.log(`\nDaconia roots, search ticks per root ${SEARCH}: expected ${e.mean.toFixed(1)} ticks from Narnode and back, worst ${e.worst}`);
console.log('order (root enum value @ tile, walk tiles from previous):');
let prev = 0;
for (const k of best) {
    console.log(`  ${k} @ (${pts[k][0]},${pts[k][1]})  ${d[prev][k]}`);
    prev = k;
}
const unreachable = pts.map((p, i) => (d[0][i] >= 9999 && i > 0 ? `${i}@(${p[0]},${p[1]})` : '')).filter(Boolean);
if (unreachable.length) console.log('unreachable from Narnode:', unreachable.join(' '));
