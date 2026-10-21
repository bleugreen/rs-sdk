// Anvils near banks (docs/speedrun/skills/smithing.md): scans every map square's LOC section for
// anvils (loc 2783 anvil, 2782 Doric's anvil, 4306 Fremennik anvil; loc.pack) and banks (2213
// bankbooth, 4483 Castle Wars bank chest) and lists each anvil with its nearest bank by
// Chebyshev tile distance. A rough guide to walking ticks (run covers 2 tiles per tick); walls
// and doors are not modelled, so measure the shortlisted sites.
//
//   bun docs/speedrun/scripts/smithing-anvils.ts [--top 10]
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const top = Number(process.argv[process.argv.indexOf('--top') + 1] || 10);
const MAPS = join(import.meta.dir, '../../../server/content/maps');
const ANVILS: Record<number, string> = { 2783: 'anvil', 2782: 'doric_anvil', 4306: 'viking_anvil' };
const BANKS: Record<number, string> = { 2213: 'bankbooth', 4483: 'castlewars_bankchest' };

type P = { x: number; z: number; level: number; id: number };
const anvils: P[] = [];
const banks: P[] = [];
for (const f of readdirSync(MAPS)) {
    const m = f.match(/^m(\d+)_(\d+)\.jm2$/);
    if (!m) continue;
    const mx = Number(m[1]) * 64;
    const mz = Number(m[2]) * 64;
    let inLoc = false;
    for (const line of readFileSync(join(MAPS, f), 'utf8').split('\n')) {
        if (line.startsWith('====')) { inLoc = line.includes('LOC'); continue; }
        if (!inLoc) continue;
        const l = line.match(/^(\d+) (\d+) (\d+): (\d+)/);
        if (!l) continue;
        const p = { level: Number(l[1]), x: mx + Number(l[2]), z: mz + Number(l[3]), id: Number(l[4]) };
        if (ANVILS[p.id]) anvils.push(p);
        if (BANKS[p.id]) banks.push(p);
    }
}
const rows = anvils.map(a => {
    const same = banks.filter(b => b.level === a.level);
    const near = same.sort((p, q) => Math.max(Math.abs(p.x - a.x), Math.abs(p.z - a.z)) - Math.max(Math.abs(q.x - a.x), Math.abs(q.z - a.z)))[0];
    const d = near ? Math.max(Math.abs(near.x - a.x), Math.abs(near.z - a.z)) : Infinity;
    return { a, near, d };
}).sort((p, q) => p.d - q.d);
console.log(`${anvils.length} anvils, ${banks.length} bank locs`);
console.log('| Anvil (x,z,level) | Type | Nearest bank (x,z) | Type | Chebyshev tiles |');
console.log('|---|---|---|---|---|');
for (const r of rows.slice(0, top)) {
    console.log(`| ${r.a.x},${r.a.z},${r.a.level} | ${ANVILS[r.a.id]} | ${r.near ? `${r.near.x},${r.near.z}` : '-'} | ${r.near ? BANKS[r.near.id] : '-'} | ${r.d} |`);
}
