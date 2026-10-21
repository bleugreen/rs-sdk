// Plans the best iron-rock rotation for every iron cluster in the map files and
// reports the sustained ore rate. Offline (no server needed):
//
//   bun docs/speedrun/scripts/mining-rotation-plan.ts [--run 1|2] [--respawn 19]
//       [--link 8] [--min 5] [--beam 150] [--horizon 600] [--show x,z] [--only x,z]
//
// Timing model (rune pickaxe, 100% success at high level), all in server ticks:
//  - A click processed on tick c on a rock the player is already beside runs the
//    first swing on c; if %action_delay < map_clock it schedules the roll for c+2
//    (mining.rs2:76-80). Measured: 3-tick cycle (mining-cycle.ts).
//  - An oploc only fires on a tick in which the player took no step
//    (Player.ts processInteraction: tryInteract(stepsTaken === 0)), so walking to a
//    rock delays its first swing by one tick after arrival.
//  - Timer trick: on the tick after a roll, click a live rock beside you (sets the
//    roll for +2), next tick move up to --run tiles to another rock, and its first
//    swing on arrival+1 finds %action_delay == map_clock and rolls at once
//    (mining.rs2:81-85). The starter rock is not depleted.
//  - A depleted rock reverts --respawn - 1 ticks after the roll and can be clicked
//    (click processed) --respawn ticks after it (Loc.ts turn, player_count.rs2).
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { isTileWalkable } from '../../../sdk/pathfinding';
import { IRON_IDS, arg } from './mining-lib';

const RUN = Number(arg('run', '1'));
const RESPAWN = Number(arg('respawn', '19'));
const LINK = Number(arg('link', '8'));
const MIN = Number(arg('min', '5'));
const BEAM = Number(arg('beam', '150'));
const HORIZON = Number(arg('horizon', '600'));
const WARM = 200;
const SHOW = arg('show', '');
const FREE_STARTER = process.argv.includes('--free-starter');

type P = [number, number];
const key = (p: P) => `${p[0]},${p[1]}`;

// ---- iron rocks from the map files (level 0 only; underground squares are z >= 6400 but still level 0)
const mapsDir = join(import.meta.dir, '../../../server/content/maps');
const rocks: P[] = [];
for (const f of readdirSync(mapsDir)) {
    const m = /^m(\d+)_(\d+)\.jm2$/.exec(f);
    if (!m) continue;
    const mx = Number(m[1]), mz = Number(m[2]);
    let inLoc = false;
    for (const line of readFileSync(join(mapsDir, f), 'utf8').split('\n')) {
        if (line.startsWith('====')) { inLoc = line.includes('LOC'); continue; }
        if (!inLoc) continue;
        const a = /^(\d+) (\d+) (\d+): (\d+)/.exec(line);
        if (a && Number(a[1]) === 0 && IRON_IDS.includes(Number(a[4]))) rocks.push([mx * 64 + Number(a[2]), mz * 64 + Number(a[3])]);
    }
}

// ---- clusters (single-link within LINK tiles)
const clusters: P[][] = [];
const seen = new Set<string>();
for (const r of rocks) {
    if (seen.has(key(r))) continue;
    const comp: P[] = [], st = [r];
    seen.add(key(r));
    while (st.length) {
        const c = st.pop()!;
        comp.push(c);
        for (const o of rocks) if (!seen.has(key(o)) && Math.abs(o[0] - c[0]) <= LINK && Math.abs(o[1] - c[1]) <= LINK) { seen.add(key(o)); st.push(o); }
    }
    if (comp.length >= MIN) clusters.push(comp);
}

function plan(cluster: P[]) {
    const rockSet = new Set(cluster.map(key));
    // standing tiles beside each rock
    const stands: P[] = [];
    const standIdx = new Map<string, number>();
    const adj: number[][] = []; // stand -> rock indices
    cluster.forEach((r, ri) => {
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const t: P = [r[0] + dx!, r[1] + dz!];
            if (rockSet.has(key(t)) || !isTileWalkable(0, t[0], t[1])) continue;
            if (!standIdx.has(key(t))) { standIdx.set(key(t), stands.length); stands.push(t); adj.push([]); }
            adj[standIdx.get(key(t))!]!.push(ri);
        }
    });
    if (!stands.length) return null;
    // Step counts between stands: 8-way BFS over walkable non-rock tiles in a box around the
    // cluster. Ignores wall edges and diagonal corner-cutting rules, so short routes are
    // checked in the lab (mining-rotation.ts) before they are trusted.
    const x0 = Math.min(...cluster.map(r => r[0])) - 6, z0 = Math.min(...cluster.map(r => r[1])) - 6;
    const x1 = Math.max(...cluster.map(r => r[0])) + 6, z1 = Math.max(...cluster.map(r => r[1])) + 6;
    const free = (x: number, z: number) => x >= x0 && x <= x1 && z >= z0 && z <= z1 && !rockSet.has(`${x},${z}`) && isTileWalkable(0, x, z);
    const dist: number[][] = stands.map(a => {
        const d = new Map<string, number>([[key(a), 0]]);
        const q: P[] = [a];
        while (q.length) {
            const c = q.shift()!;
            const dc = d.get(key(c))!;
            if (dc >= 12) continue;
            for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
                const n: P = [c[0] + dx!, c[1] + dz!];
                if (d.has(key(n)) || !free(n[0], n[1])) continue;
                if (dx && dz && (!free(c[0] + dx, c[1]) || !free(c[0], c[1] + dz))) continue;
                d.set(key(n), dc + 1);
                q.push(n);
            }
        }
        return stands.map(b => d.get(key(b)) ?? Infinity);
    });

    type S = { t: number; pos: number; avail: number[]; ores: number; late: number; hist: string[] };
    let beam: S[] = stands.map((_, i) => ({ t: -3, pos: i, avail: cluster.map(() => 0), ores: 0, late: 0, hist: [] }));
    let best: S | null = null;
    while (beam.length) {
        const next: S[] = [];
        for (const s of beam) {
            const R = s.t;
            // --free-starter: something other than a rock sets %action_delay = map_clock + 2 on the
            // tick after each roll (e.g. knife on logs, cut_logs.rs2:83-85; owned by rs/9), so every
            // one-tick move can use the timer trick.
            const starterU = FREE_STARTER ? R + 1 : Math.min(...adj[s.pos]!.map(ri => Math.max(R + 1, s.avail[ri]!)));
            for (let p2 = 0; p2 < stands.length; p2++) {
                const d = dist[s.pos]![p2]!;
                if (d === Infinity) continue;
                for (const q of adj[p2]!) {
                    let T: number;
                    if (d === 0) T = Math.max(R + 1, s.avail[q]!) + 2;
                    else {
                        const m = Math.ceil(d / RUN);
                        T = Math.max(R + 1 + m, s.avail[q]!) + 2; // plain walk
                        if (d <= RUN && Number.isFinite(starterU)) {
                            const Tt = starterU + 2; // timer trick (starter may need to respawn first)
                            if (s.avail[q]! <= Tt && Tt < T) T = Tt;
                        }
                    }
                    if (T > HORIZON) continue;
                    const avail = s.avail.slice();
                    avail[q] = T + RESPAWN;
                    const ns: S = { t: T, pos: p2, avail, ores: s.ores + 1, late: s.late + (T >= WARM ? 1 : 0), hist: SHOW ? [...s.hist, `${T}:${key(stands[p2]!)}>${key(cluster[q]!)}`] : s.hist };
                    next.push(ns);
                }
            }
        }
        if (!next.length) break;
        // keep the states furthest ahead in ores per elapsed tick, dedup by (pos, t)
        next.sort((a, b) => a.t - b.t || b.ores - a.ores);
        const dedup = new Map<string, S>();
        for (const n of next) {
            const k = `${n.pos}|${n.t}|${n.avail.map(a => Math.max(0, a - n.t)).join(',')}`;
            if (!dedup.has(k)) dedup.set(k, n);
        }
        beam = [...dedup.values()].sort((a, b) => (b.ores / (b.t + 3)) - (a.ores / (a.t + 3)) || a.t - b.t).slice(0, BEAM);
        for (const n of beam) if (!best || n.late > best.late || (n.late === best.late && n.t < best.t)) best = n;
    }
    return { stands: stands.length, best };
}

const rows: string[] = [];
const ONLY = arg('only', '');
for (const c of clusters.sort((a, b) => b.length - a.length)) {
    if (ONLY && !c.some(r => key(r) === ONLY)) continue;
    const t0 = Date.now();
    const res = plan(c);
    console.error(`planned ${c.length}-rock cluster at ${key(c[0]!)} in ${Date.now() - t0} ms`);
    if (!res || !res.best) continue;
    const lateTicks = HORIZON - WARM;
    const perOre = lateTicks / Math.max(1, res.best.late);
    const cx = Math.round(c.reduce((a, r) => a + r[0], 0) / c.length), cz = Math.round(c.reduce((a, r) => a + r[1], 0) / c.length);
    rows.push(`${String(c.length).padStart(2)} rocks  centre ${cx},${cz}  stands ${res.stands}  ticks/ore ${perOre.toFixed(2)}  base xp/tick ${(35 / perOre).toFixed(2)}`);
    if (SHOW && c.some(r => key(r) === SHOW)) console.log(res.best.hist.join(' '));
}
console.log(`run=${RUN} respawn=${RESPAWN} (steady state over ticks ${WARM}-${HORIZON})`);
console.log(rows.join('\n'));
