#!/usr/bin/env bun
/**
 * Ranks dwarf multicannon sites from content data alone (no server needed).
 *
 *   bun docs/speedrun/scripts/ranged-cannon-sites.ts [--minhp=20] [--top=40] [--radius=10]
 *
 * Reads server/content/maps/multiway.csv (8x8 multi-combat zones), the NPC
 * section of every server/content/maps/m*.jm2 ("level lx lz: npcid"), the id
 * table server/content/pack/npc.pack and the npc configs under
 * server/content/scripts (hitpoints, defence, rangedefence, respawnrate,
 * huntmode, op2). For every multi-combat spawn of an attackable NPC with at
 * least --minhp hitpoints it counts the qualifying spawns within --radius tiles
 * (Chebyshev) on the same level and inside multi-combat zones, and prints the
 * densest clusters with their composition. The cannon searches up to 14+5
 * tiles from its centre along 8 rays (cannon_fire.rs2:10-89), so a radius of
 * about 10 is what one cannon can keep busy.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dir, '../../../server/content');
const arg = (k: string, d: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const MINHP = Number(arg('minhp', '20'));
const TOP = Number(arg('top', '40'));
const RADIUS = Number(arg('radius', '10'));
const SINGLE = process.argv.includes('--single'); // include single-combat spawns (hand-ranged targets)
const MAXRDEF = Number(arg('maxrdef', '9999'));

// multi-combat zones
const multi = new Set<string>();
for (const line of fs.readFileSync(`${ROOT}/maps/multiway.csv`, 'ascii').split(/\r?\n/)) {
    if (!line || line.startsWith('//')) continue;
    const [y, mx, mz, lx, lz] = line.split('_').map(Number);
    multi.add(`${y}_${((mx << 6) + lx) >> 3}_${((mz << 6) + lz) >> 3}`);
}
const isMulti = (y: number, x: number, z: number) => multi.has(`${y}_${x >> 3}_${z >> 3}`);

// npc id -> debugname
const names = new Map<number, string>();
for (const line of fs.readFileSync(`${ROOT}/pack/npc.pack`, 'ascii').split(/\r?\n/)) {
    const m = /^(\d+)=(\S+)/.exec(line);
    if (m) names.set(Number(m[1]), m[2]);
}

// npc configs
type Npc = { name: string; hp: number; def: number; rdef: number; sdef: number; multi: boolean; respawn: number; hunt: string; op2: boolean; level: number; attack: number };
const npcs = new Map<string, Npc>();
const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.npc') ? [path.join(dir, e.name)] : []);
for (const file of walk(`${ROOT}/scripts`)) {
    let cur: Npc | null = null;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const h = /^\[(\w+)\]/.exec(line);
        if (h) { cur = { name: h[1], hp: 1, def: 1, rdef: 0, sdef: 0, multi: false, respawn: 100, hunt: '', op2: false, level: 0, attack: 1 }; npcs.set(h[1], cur); continue; }
        if (!cur) continue;
        const [k, v] = line.split('=');
        if (k === 'hitpoints') cur.hp = Number(v);
        else if (k === 'defence') cur.def = Number(v);
        else if (k === 'attack') cur.attack = Number(v);
        else if (k === 'respawnrate') cur.respawn = Number(v);
        else if (k === 'huntmode') cur.hunt = v;
        else if (k === 'vislevel') cur.level = Number(v);
        else if (k === 'op2' && /attack/i.test(v)) cur.op2 = true;
        else if (k === 'param' && v?.startsWith('rangedefence,')) cur.rdef = Number(v.split(',')[1]);
        else if (k === 'param' && v?.startsWith('slashdefence,')) cur.sdef = Number(v.split(',')[1]);
        else if (k === 'param' && v?.startsWith('npc_forcemulti,')) cur.multi = !['0', '^false'].includes(v.split(',')[1]);
    }
}

// spawns
type Spawn = { y: number; x: number; z: number; npc: Npc };
const spawns: Spawn[] = [];
for (const f of fs.readdirSync(`${ROOT}/maps`).filter(f => /^m\d+_\d+\.jm2$/.test(f))) {
    const [mx, mz] = f.slice(1, -4).split('_').map(Number);
    const text = fs.readFileSync(`${ROOT}/maps/${f}`, 'ascii');
    const i = text.indexOf('==== NPC ====');
    if (i < 0) continue;
    for (const line of text.slice(i).split(/\r?\n/).slice(1)) {
        if (line.startsWith('====')) break;
        const m = /^(\d+) (\d+) (\d+): (\d+)/.exec(line);
        if (!m) continue;
        const npc = npcs.get(names.get(Number(m[4])) ?? '');
        if (!npc) continue;
        spawns.push({ y: Number(m[1]), x: (mx << 6) + Number(m[2]), z: (mz << 6) + Number(m[3]), npc });
    }
}

const good = spawns.filter(s => s.npc.op2 && s.npc.hp >= MINHP && s.npc.rdef <= MAXRDEF && (SINGLE || s.npc.multi || isMulti(s.y, s.x, s.z)));
// cluster: greedy, densest centre first, members removed
const used = new Set<Spawn>();
const out: string[] = [];
const scored = good.map(s => ({ s, near: good.filter(o => o.y === s.y && Math.max(Math.abs(o.x - s.x), Math.abs(o.z - s.z)) <= RADIUS) }))
    .sort((a, b) => b.near.length - a.near.length);
for (const { s, near } of scored) {
    if (used.has(s)) continue;
    const members = near.filter(o => !used.has(o));
    if (members.length < 3) continue;
    members.forEach(o => used.add(o));
    const comp = new Map<string, number>();
    for (const o of members) comp.set(o.npc.name, (comp.get(o.npc.name) ?? 0) + 1);
    const desc = [...comp].sort((a, b) => b[1] - a[1]).map(([n, c]) => {
        const k = npcs.get(n)!;
        return `${c}x ${n}(lvl${k.level} hp${k.hp} def${k.def} rdef${k.rdef} sdef${k.sdef} resp${k.respawn}${k.hunt ? ' ' + k.hunt : ''})`;
    }).join(', ');
    const hpSum = members.reduce((a, o) => a + o.npc.hp, 0);
    // hp regenerated per tick if every member were killed the moment it respawned
    const hpTick = members.reduce((a, o) => a + o.npc.hp / Math.max(o.npc.respawn, 1), 0);
    const multiTag = members.every(o => isMulti(o.y, o.x, o.z) || o.npc.multi) ? 'multi' : 'SINGLE';
    out.push(`${members.length} spawns, ${hpSum} hp, ${hpTick.toFixed(1)} hp/tick respawn-bound, ${multiTag}, centre (${s.x},${s.z}) level ${s.y} tele ${s.y},${s.x >> 6},${s.z >> 6},${s.x & 63},${s.z & 63}: ${desc}`);
    if (out.length >= TOP) break;
}
console.log(`${multi.size} multi zones, ${spawns.length} spawns, ${good.length} attackable multi spawns with hp >= ${MINHP}`);
for (const l of out) console.log(l);
