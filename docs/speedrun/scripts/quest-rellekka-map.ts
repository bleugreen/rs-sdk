// Offline lookup of NPC spawns, locs and ground objs by config name, read
// straight from the map files (server/content/maps/*.jm2) and the name packs
// (server/content/pack/{npc,loc,obj}.pack). No server or bot needed:
//
//   bun docs/speedrun/scripts/quest-rellekka-map.ts npc viking_brundt viking_olaf
//   bun docs/speedrun/scripts/quest-rellekka-map.ts loc 'vt_mazeportal.*'
//   bun docs/speedrun/scripts/quest-rellekka-map.ts obj viking_beerkeg
//
// Each argument is an anchored regular expression over config names. Output is
// one line per placement: name, absolute x, z, level, and for locs the shape
// and angle. Used for the coordinates in fremennik_trials.md and
// horror_from_the_deep.md.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '../../../server/content');

function loadPack(kind: string): Map<number, string> {
    const m = new Map<number, string>();
    for (const line of readFileSync(join(root, 'pack', `${kind}.pack`), 'utf8').split('\n')) {
        const eq = line.indexOf('=');
        if (eq > 0) m.set(Number(line.slice(0, eq)), line.slice(eq + 1).trim());
    }
    return m;
}

export interface Placement {
    kind: 'npc' | 'loc' | 'obj';
    name: string;
    x: number;
    z: number;
    level: number;
    shape?: number;
    angle?: number;
}

export function placements(kind: 'npc' | 'loc' | 'obj', patterns: RegExp[]): Placement[] {
    const names = loadPack(kind);
    const header = { npc: '==== NPC ====', loc: '==== LOC ====', obj: '==== OBJ ====' }[kind];
    const out: Placement[] = [];
    for (const file of readdirSync(join(root, 'maps'))) {
        const m = file.match(/^m(\d+)_(\d+)\.jm2$/);
        if (!m) continue;
        const mx = Number(m[1]);
        const mz = Number(m[2]);
        let inSection = false;
        for (const line of readFileSync(join(root, 'maps', file), 'utf8').split('\n')) {
            if (line.startsWith('====')) {
                inSection = line.trim() === header;
                continue;
            }
            if (!inSection) continue;
            const p = line.match(/^(\d+) (\d+) (\d+): (\d+)(?: (\d+))?(?: (\d+))?/);
            if (!p) continue;
            const name = names.get(Number(p[4])) ?? `#${p[4]}`;
            if (!patterns.some(re => re.test(name))) continue;
            const pl: Placement = {
                kind,
                name,
                level: Number(p[1]),
                x: mx * 64 + Number(p[2]),
                z: mz * 64 + Number(p[3])
            };
            if (kind === 'loc') {
                pl.shape = p[5] === undefined ? 10 : Number(p[5]);
                pl.angle = p[6] === undefined ? 0 : Number(p[6]);
            }
            out.push(pl);
        }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name) || a.level - b.level || a.x - b.x || a.z - b.z);
}

if (import.meta.main) {
    const [kind, ...pats] = process.argv.slice(2);
    if (kind !== 'npc' && kind !== 'loc' && kind !== 'obj') {
        console.error('usage: quest-rellekka-map.ts npc|loc|obj <name-regex>...');
        process.exit(1);
    }
    for (const p of placements(kind, pats.map(s => new RegExp(`^(?:${s})$`)))) {
        const extra = p.kind === 'loc' ? ` shape=${p.shape} angle=${p.angle}` : '';
        console.log(`${p.name} (${p.x},${p.z}) level ${p.level}${extra}`);
    }
}
