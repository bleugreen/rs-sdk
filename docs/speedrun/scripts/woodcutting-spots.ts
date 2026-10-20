// Static map survey for Woodcutting spots (no server needed).
//
// For each tree type, finds standing tiles that are orthogonally adjacent to the
// footprint of two or more trees of that type (so a depleted tree can be swapped
// for another without walking), and lists NPC spawns within 15 tiles whose hunt
// mode attacks players. Tiles flagged blocked (f1) or covered by a tree footprint
// are excluded; other blocking locs (fences, rocks) are not modelled, so verify a
// chosen tile in the lab.
//
// usage: bun docs/speedrun/scripts/woodcutting-spots.ts [tree ...]
//        e.g. bun docs/speedrun/scripts/woodcutting-spots.ts willowtree oaktree
import { readFileSync, readdirSync } from 'fs';
import { execSync } from 'child_process';

const root = 'server/content';
const SIZE: Record<string, number> = { oaktree: 3, willowtree: 2, mapletree: 2, yewtree: 2, magictree: 2 };
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SIZE);
const HOSTILE = /^(ranged|constant_|notbusy_|aggressive_|bigmonster_|cowardly)/;

function pack(name: string): Record<number, string> {
    const out: Record<number, string> = {};
    for (const line of readFileSync(`${root}/pack/${name}.pack`, 'utf8').split('\n')) {
        const [id, n] = line.split('=');
        if (n) out[Number(id)] = n;
    }
    return out;
}
const locPack = pack('loc');
const npcPack = pack('npc');

const npcCfg: Record<string, Record<string, string>> = {};
for (const f of execSync(`find ${root}/scripts -name '*.npc'`).toString().trim().split('\n')) {
    let cur: Record<string, string> | null = null;
    for (const line of readFileSync(f, 'utf8').split('\n')) {
        const h = line.match(/^\[(.+)\]/);
        if (h) { cur = {}; npcCfg[h[1]] = cur; continue; }
        const kv = line.match(/^(\w+)=(.*)$/);
        if (cur && kv) cur[kv[1]] = kv[2];
    }
}

type Tree = { type: string; x: number; z: number };
const trees: Tree[] = [];
const hostiles: { name: string; x: number; z: number; vislevel?: string; huntmode: string }[] = [];
const blocked = new Set<string>();
const key = (x: number, z: number) => `${x},${z}`;

for (const f of readdirSync(`${root}/maps`)) {
    const m = f.match(/^m(\d+)_(\d+)\.jm2$/);
    if (!m) continue;
    const mx = Number(m[1]) * 64, mz = Number(m[2]) * 64;
    let section = '';
    for (const line of readFileSync(`${root}/maps/${f}`, 'utf8').split('\n')) {
        if (line.startsWith('====')) { section = line; continue; }
        const p = line.match(/^(\d+) (\d+) (\d+): (.*)$/);
        if (!p || p[1] !== '0') continue; // ground level only
        const x = mx + Number(p[2]), z = mz + Number(p[3]);
        if (section.includes('MAP')) {
            const fl = p[4].match(/\bf(\d+)/);
            if (fl && (Number(fl[1]) & 1)) blocked.add(key(x, z));
        } else if (section.includes('LOC')) {
            const name = locPack[Number(p[4].split(' ')[0])];
            if (wanted.includes(name)) trees.push({ type: name, x, z });
        } else if (section.includes('NPC')) {
            const name = npcPack[Number(p[4].split(' ')[0])];
            const c = npcCfg[name];
            if (c?.huntmode && HOSTILE.test(c.huntmode)) hostiles.push({ name, x, z, vislevel: c.vislevel, huntmode: c.huntmode });
        }
    }
}

for (const type of wanted) {
    const size = SIZE[type];
    const list = trees.filter(t => t.type === type);
    const covered = new Set<string>();
    for (const t of list) for (let dx = 0; dx < size; dx++) for (let dz = 0; dz < size; dz++) covered.add(key(t.x + dx, t.z + dz));
    // tile -> trees it can reach (orthogonal side adjacency, corners excluded)
    const reach = new Map<string, Tree[]>();
    for (const t of list) {
        const sides: [number, number][] = [];
        for (let i = 0; i < size; i++) sides.push([t.x - 1, t.z + i], [t.x + size, t.z + i], [t.x + i, t.z - 1], [t.x + i, t.z + size]);
        for (const [x, z] of sides) {
            const k = key(x, z);
            if (blocked.has(k) || covered.has(k)) continue;
            if (!reach.has(k)) reach.set(k, []);
            reach.get(k)!.push(t);
        }
    }
    const spots = [...reach.entries()].filter(([, ts]) => ts.length >= 2).sort((a, b) => b[1].length - a[1].length);
    console.log(`## ${type}: ${list.length} trees, ${spots.length} tiles reaching 2+ trees`);
    const seen = new Set<string>();
    for (const [tile, ts] of spots) {
        const sig = ts.map(t => key(t.x, t.z)).sort().join(' ');
        if (seen.has(sig)) continue; // one tile per distinct tree set
        seen.add(sig);
        const [x, z] = tile.split(',').map(Number);
        const near = hostiles.filter(h => Math.max(Math.abs(h.x - x), Math.abs(h.z - z)) <= 15);
        const counts: Record<string, number> = {};
        for (const h of near) counts[`${h.name}(${h.huntmode},vis${h.vislevel})`] = (counts[`${h.name}(${h.huntmode},vis${h.vislevel})`] ?? 0) + 1;
        const hostileText = Object.entries(counts).map(([k, v]) => `${k}x${v}`).join(', ') || 'none';
        console.log(`stand (${tile}) reaches ${ts.length}: ${ts.map(t => `(${t.x},${t.z})`).join(' ')} | hostile<=15: ${hostileText}`);
    }
}
