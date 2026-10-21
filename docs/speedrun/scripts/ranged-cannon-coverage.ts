#!/usr/bin/env bun
/**
 * Cannon coverage from a ranged-cannon.ts JSONL log: for every logged tick,
 * which of the cannon's 8 directions had a live target inside one of its three
 * search squares (cannon_fire.rs2:10-89: Chebyshev radius 1 around a point 3
 * tiles out, radius 2 at 7, radius 5 at 14; diagonals at 2, 5, 12), measured
 * from the npc's SW tile (ScriptIterators.ts NpcHuntAllCommandIterator,
 * distanceToSW). The cannon checks one direction per tick, so the mean covered
 * fraction is the shot rate an unlimited supply of line of sight would give.
 *
 *   bun docs/speedrun/scripts/ranged-cannon-coverage.ts <log.jsonl>
 */
const file = process.argv[2];
const rays: [number, number][] = [[0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1]];
const blobs = (dir: number) => {
    const [ux, uz] = rays[dir];
    const diag = ux !== 0 && uz !== 0;
    const steps = diag ? [2, 5, 12] : [3, 7, 14];
    return steps.map((s, i) => ({ x: ux * s, z: uz * s, r: [1, 2, 5][i] }));
};
const B = rays.map((_, d) => blobs(d));
const covered = (npcs: number[][], d: number) => npcs.some(([x, z, hp]) => hp !== 0 && B[d].some(b => Math.max(Math.abs(x - b.x), Math.abs(z - b.z)) <= b.r));
let ticks = 0, sum = 0;
const perDir = new Array(8).fill(0);
const near: Record<string, number> = {};
for (const line of (await Bun.file(file).text()).split('\n')) {
    if (!line) continue;
    const r = JSON.parse(line);
    if (!r.npcs) continue;
    ticks++;
    let c = 0;
    for (let d = 0; d < 8; d++) if (covered(r.npcs, d)) { perDir[d]++; c++; }
    sum += c / 8;
    for (const [x, z, hp] of r.npcs) {
        if (hp === 0) continue;
        const k = Math.max(Math.abs(x - r.me[0]), Math.abs(z - r.me[1])) <= 1 ? 'adjacentToPlayer' : Math.max(Math.abs(x), Math.abs(z)) <= 19 ? 'inReach' : 'outOfReach';
        near[k] = (near[k] ?? 0) + 1;
    }
}
console.log(JSON.stringify({
    ticks, coveredFraction: +(sum / ticks).toFixed(3),
    perDirection: perDir.map(v => +(v / ticks).toFixed(2)),
    liveTargetsPerTick: Object.fromEntries(Object.entries(near).map(([k, v]) => [k, +(v / ticks).toFixed(2)])),
}));
