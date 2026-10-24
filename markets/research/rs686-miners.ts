#!/usr/bin/env bun
// rs/686: how many players stand next to an ore rock, per raw /playerpositions read (markets/scan/headcount.ts --raw).
// Mining an ordinary rock rolls a random gem (skill_mining/scripts/mining.rs2), so this headcount bounds the gems that
// reach the world outside Shilo. Counts only: no names are kept or printed. Rock tiles are every map LOC whose type is a
// mining_table rock, excluding gem rocks and rune essence (which never roll the random gem).
//
//   bun markets/research/rs686-miners.ts RAW_DIR [--json=OUT.json]
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const CONTENT = resolve(import.meta.dir, '../../server/content');
const NO_RANDOM_GEM = new Set(['gem_rock', 'essence']);

/** loc name -> ore name for every mining_table rock that rolls the random gem. */
export function oreRocks(dbrow: string): Map<string, string> {
    const out = new Map<string, string>();
    for (const block of dbrow.split(/\n(?=\[)/)) {
        const row = /^\[(\w+)\]/.exec(block)?.[1];
        if (!row || !/table=mining_table/.test(block) || [...NO_RANDOM_GEM].some(k => row.includes(k))) continue;
        const ore = /data=ore_name,(\S+)/.exec(block)?.[1] ?? row;
        if (ore === 'gems' || ore === 'essence') continue;
        for (const m of block.matchAll(/data=rock,(\w+)/g)) out.set(m[1]!, ore);
    }
    return out;
}

function rockTiles(): Map<string, string> {
    const rocks = oreRocks(readFileSync(join(CONTENT, 'scripts/skill_mining/configs/mine.dbrow'), 'utf8'));
    const ids = new Map<number, string>();
    for (const l of readFileSync(join(CONTENT, 'pack/loc.pack'), 'utf8').split('\n')) {
        const m = /^(\d+)=(\S+)/.exec(l);
        if (m && rocks.has(m[2]!)) ids.set(Number(m[1]), rocks.get(m[2]!)!);
    }
    // Every tile within one of a rock (where a miner stands), keyed level,x,z, to the ore.
    const tiles = new Map<string, string>();
    for (const f of readdirSync(join(CONTENT, 'maps')).filter(f => f.endsWith('.jm2'))) {
        const sq = /m(\d+)_(\d+)/.exec(f)!;
        let inLoc = false;
        for (const raw of readFileSync(join(CONTENT, 'maps', f), 'utf8').split('\n')) {
            const line = raw.trim();
            if (line.startsWith('====')) {
                inLoc = line === '==== LOC ====';
                continue;
            }
            const m = inLoc && /^(\d+) (\d+) (\d+): (\d+)/.exec(line);
            if (!m || !ids.has(Number(m[4]))) continue;
            const [lv, x, z] = [Number(m[1]), Number(sq[1]) * 64 + Number(m[2]), Number(sq[2]) * 64 + Number(m[3])];
            for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) tiles.set(`${lv},${x + dx},${z + dz}`, ids.get(Number(m[4]))!);
        }
    }
    return tiles;
}

if (import.meta.main) {
    const { values, positionals } = parseArgs({ args: Bun.argv.slice(2), allowPositionals: true, options: { json: { type: 'string' } } });
    const dir = positionals[0]!;
    const tiles = rockTiles();
    const reads: { at: string; online: number; miners: number; byOre: Record<string, number> }[] = [];
    for (const f of readdirSync(dir).filter(f => f.endsWith('.jsonl')).sort()) {
        for (const line of readFileSync(join(dir, f), 'utf8').split('\n').filter(Boolean)) {
            const { at, players } = JSON.parse(line) as { at: string; players: { x: number; z: number; level: number }[] };
            const byOre: Record<string, number> = {};
            for (const p of players) {
                const ore = tiles.get(`${p.level},${p.x},${p.z}`);
                if (ore) byOre[ore] = (byOre[ore] ?? 0) + 1;
            }
            reads.push({ at, online: players.length, miners: Object.values(byOre).reduce((a, b) => a + b, 0), byOre });
        }
    }
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
    const ores = [...new Set(reads.flatMap(r => Object.keys(r.byOre)))].sort();
    const summary = {
        reads: reads.length,
        window: [reads[0]?.at, reads[reads.length - 1]?.at],
        rockTiles: tiles.size,
        miners: { min: Math.min(...reads.map(r => r.miners)), mean: mean(reads.map(r => r.miners)), max: Math.max(...reads.map(r => r.miners)) },
        meanByOre: Object.fromEntries(ores.map(o => [o, mean(reads.map(r => r.byOre[o] ?? 0))])),
        hourly: Object.entries(Object.groupBy(reads, r => r.at.slice(0, 13) + 'Z')).map(([hour, rs]) => ({ hour, online: mean(rs!.map(r => r.online)), miners: mean(rs!.map(r => r.miners)) })),
    };
    console.log(JSON.stringify(summary, null, 1));
    if (values.json) writeFileSync(values.json, JSON.stringify(summary, null, 1) + '\n');
}
