// Who stands at a few contested sites, from the public /playerpositions list: one read every
// --every seconds (300 by default, the markets polling floor), --reads times, saved as dated JSON.
//
//   bun markets/scan/headcount.ts [--origin=https://rs-sdk-demo.fly.dev] [--every=300] [--reads=13] [--out=...]
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { demoOrigin } from '../../speedrun/lib/demo-status.ts';

export interface Box {
    name: string;
    x0: number;
    z0: number;
    x1: number;
    z1: number;
}

/** Boxes a few tiles round each site's rocks (rock tiles from the maps' LOC sections). */
export const SITES: Box[] = [
    { name: 'Shilo gem rocks', x0: 2812, z0: 2990, x1: 2834, z1: 3012 },
    { name: 'runite 45_154', x0: 2880, z0: 9856, x1: 2944, z1: 9920 },
    { name: 'runite 47_60', x0: 3008, z0: 3840, x1: 3072, z1: 3904 },
    { name: 'runite 47_160', x0: 3008, z0: 10240, x1: 3072, z1: 10304 },
];

export interface Position {
    name: string;
    x: number;
    z: number;
    level: number;
}

export function inBox(p: Position, b: Box): boolean {
    return p.x >= b.x0 && p.x < b.x1 && p.z >= b.z0 && p.z < b.z1;
}

export function countSites(players: Position[], boxes: Box[] = SITES): { total: number; sites: Record<string, string[]> } {
    const sites: Record<string, string[]> = {};
    for (const b of boxes) sites[b.name] = players.filter(p => inBox(p, b)).map(p => p.name).sort();
    return { total: players.length, sites };
}

if (import.meta.main) {
    const arg = (k: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
    const origin = demoOrigin(arg('origin') ?? 'rs-sdk-demo.fly.dev');
    const every = Math.max(300, Number(arg('every') ?? 300)) * 1000;
    const reads = Number(arg('reads') ?? 13);
    const started = new Date().toISOString();
    const out = arg('out') ?? join(import.meta.dir, '..', '..', 'docs', 'markets', 'data', `headcount-${started.slice(0, 16).replace(':', '')}Z.json`);
    const samples: ({ at: string } & ReturnType<typeof countSites>)[] = [];
    for (let i = 0; i < reads; i++) {
        const at = new Date().toISOString();
        try {
            const res = await fetch(`${origin}/playerpositions`, { signal: AbortSignal.timeout(10_000) });
            const players = (await res.json()) as Position[];
            const s = { at, ...countSites(players) };
            samples.push(s);
            console.log(`${at} players ${s.total} ` + Object.entries(s.sites).map(([k, v]) => `${k}: ${v.length} [${v.join(' ')}]`).join(' | '));
        } catch (e) {
            console.log(`${at} read failed: ${(e as Error).message}`);
        }
        writeFileSync(out, JSON.stringify({ origin, started, everySeconds: every / 1000, sites: SITES, samples }, null, 0).replace(/\},\{"at"/g, '},\n{"at"') + '\n');
        if (i + 1 < reads) await new Promise(r => setTimeout(r, every));
    }
    console.log(`HEADCOUNT DONE ${samples.length} reads -> ${out}`);
}
