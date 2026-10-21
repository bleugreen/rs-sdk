// Print the world coordinates of every map placement of the named locs,
// NPCs or ground-item spawns (exact config names, or a regex with /.../). Reads the packed name
// tables in server/content/pack and the .jm2 map files; no server needed.
//
//   bun docs/speedrun/scripts/quest-regicide-find.ts loc|npc|obj <name-or-/regex/>...

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const root = join(import.meta.dir, '../../../server/content');
const [kind, ...names] = process.argv.slice(2);
if ((kind !== 'loc' && kind !== 'npc' && kind !== 'obj') || names.length === 0) {
    console.error('usage: quest-regicide-find.ts loc|npc|obj <name-or-/regex/>...');
    process.exit(1);
}

const idToName = new Map<number, string>();
for (const line of readFileSync(join(root, 'pack', `${kind}.pack`), 'utf8').split('\n')) {
    const eq = line.indexOf('=');
    if (eq > 0) idToName.set(Number(line.slice(0, eq)), line.slice(eq + 1).trim());
}
const matchers = names.map(n => (n.startsWith('/') && n.endsWith('/') ? new RegExp(n.slice(1, -1)) : new RegExp(`^${n}$`)));
const wanted = new Set([...idToName].filter(([, name]) => matchers.some(m => m.test(name))).map(([id]) => id));

const section = `==== ${kind.toUpperCase()} ====`;
const rows: string[] = [];
for (const file of readdirSync(join(root, 'maps')).filter(f => /^m\d+_\d+\.jm2$/.test(f))) {
    const [, mx, mz] = file.match(/^m(\d+)_(\d+)/)!.map(Number);
    const text = readFileSync(join(root, 'maps', file), 'utf8');
    const start = text.indexOf(section);
    if (start < 0) continue;
    for (const line of text.slice(start + section.length).split('\n')) {
        if (line.startsWith('====')) break;
        const m = line.match(/^(\d+) (\d+) (\d+): (\d+)(?: (\d+) (\d+))?/);
        if (!m || !wanted.has(Number(m[4]))) continue;
        const [level, lx, lz, id] = [m[1], m[2], m[3], m[4]].map(Number);
        const x = mx * 64 + lx;
        const z = mz * 64 + lz;
        const extra = m[5] ? ` shape=${m[5]} angle=${m[6]}` : '';
        rows.push(`${idToName.get(id)}\t(${x},${z},${level})\t${level}_${mx}_${mz}_${lx}_${lz}${extra}`);
    }
}
rows.sort();
console.log(rows.join('\n') || '(no placements)');
