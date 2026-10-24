// Who stands at the scarce gathering sites, from the public /playerpositions list: one read every --every seconds
// (60 at the least), for --hours, one JSON line per read. A player counts at a site when on the rocks' plane and within
// the site's radius (Chebyshev, in tiles) of any of its rocks; rock tiles are the maps' LOC entries for gemrock and
// runiterock1/2. Our own accounts (markets/lib/accounts.ts) are dropped and recorded as a count only.
//
//   bun markets/scan/headcount.ts --out=FILE.jsonl [--raw=DIR] [--every=60] [--hours=13] [--origin=rs-sdk-demo.fly.dev]
//
// The file's first line describes the run; each later line is a read: { at, online, sites: { [site]: { ours,
// rivals: [name, x, z][] } } }, or { at, error } when the read failed. A failed read doubles the wait, up to 15
// minutes, until one succeeds. --raw appends every read's full position list (our names included) to DIR, which
// must lie outside this repository. markets/scan/headcount-report.ts summarises a file.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { writerExclusion, type Exclusion } from '../lib/accounts.ts';
import { Gentle } from '../lib/demo.ts';
import { parsePositions, type Position } from '../lib/positions.ts';

export interface Site {
    name: string;
    level: number;
    rocks: [number, number][];
    radius: number;
}

const SHILO_GEMS: [number, number][] = [[2820, 2998], [2821, 2998], [2821, 3000], [2823, 2999], [2823, 3002], [2825, 3001], [2825, 3003]];
const SURFACE_RUNITE: [number, number][] = [[3059, 3885], [3060, 3884]];

/** The scarce sites, 8 tiles round their rocks, plus a wider ring round the Wilderness runite for passers-by. */
export const SITES: Site[] = [
    { name: 'Shilo gem rocks', level: 0, rocks: SHILO_GEMS, radius: 8 },
    { name: "Heroes' Guild runite", level: 0, rocks: [[2937, 9882], [2941, 9884]], radius: 8 },
    { name: 'Wilderness surface runite', level: 0, rocks: SURFACE_RUNITE, radius: 8 },
    { name: 'Lava Maze runite', level: 0, rocks: [[3046, 10265]], radius: 8 },
    { name: 'Wilderness surface runite, 24-tile ring', level: 0, rocks: SURFACE_RUNITE, radius: 24 },
];

export function atSite(p: Pick<Position, 'x' | 'z' | 'level'>, site: Site): boolean {
    return p.level === site.level && site.rocks.some(([x, z]) => Math.max(Math.abs(p.x - x), Math.abs(p.z - z)) <= site.radius);
}

export interface SiteRead {
    /** Our own accounts at the site: a count, never names. */
    ours: number;
    rivals: [name: string, x: number, z: number][];
}

export function readSites(positions: Position[], ex: Pick<Exclusion, 'excludes'>, sites: Site[] = SITES): Record<string, SiteRead> {
    const out: Record<string, SiteRead> = {};
    for (const site of sites) {
        const here = positions.filter(p => atSite(p, site));
        const rivals = here.filter(p => !ex.excludes(p.name));
        out[site.name] = {
            ours: here.length - rivals.length,
            rivals: rivals.map((p): [string, number, number] => [p.name, p.x, p.z]).sort((a, b) => a[0].localeCompare(b[0])),
        };
    }
    return out;
}

export const MIN_EVERY_S = 60;
export const MAX_BACKOFF_S = 900;

/** Seconds to wait after `failures` consecutive failed reads. */
export const backoff = (everyS: number, failures: number): number => Math.min(MAX_BACKOFF_S, everyS * 2 ** failures);

export function insideRepo(path: string, repo = resolve(import.meta.dir, '..', '..')): boolean {
    const rel = relative(repo, resolve(path));
    return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/'));
}

if (import.meta.main) {
    const arg = (k: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
    const ex = writerExclusion();
    const everyS = Number(arg('every') ?? MIN_EVERY_S);
    if (!(everyS >= MIN_EVERY_S)) throw new Error(`--every must be at least ${MIN_EVERY_S} seconds`);
    const hours = Number(arg('hours') ?? 13);
    const out = arg('out');
    if (!out) throw new Error('--out=FILE.jsonl is required');
    const raw = arg('raw');
    if (raw && insideRepo(raw)) throw new Error('--raw holds our names and must be outside the repository');
    if (raw) mkdirSync(raw, { recursive: true });
    mkdirSync(dirname(resolve(out)), { recursive: true });
    // One attempt per read: the backoff below is the only retry.
    const g = new Gentle({ server: arg('origin') ?? 'rs-sdk-demo.fly.dev', attempts: 1, timeoutMs: 20_000 });
    const started = new Date();
    const stopAt = started.getTime() + hours * 3_600_000;
    writeFileSync(out, JSON.stringify({ v: 2, origin: g.origin, started: started.toISOString(), everySeconds: everyS, hours, excluded: ex.source ? 'names list + always-excluded' : 'always-excluded only (placeholder)', sites: SITES }) + '\n');
    let failures = 0;
    let reads = 0;
    for (let next = Date.now(); next < stopAt; ) {
        const at = new Date().toISOString();
        try {
            const body = await g.json<unknown>('/playerpositions');
            const positions = parsePositions(body);
            const sites = readSites(positions, ex);
            appendFileSync(out, JSON.stringify({ at, online: positions.length, sites }) + '\n');
            if (raw) appendFileSync(join(raw, `raw-${at.slice(0, 13)}Z.jsonl`), JSON.stringify({ at, players: body }) + '\n');
            console.log(`${at} online ${positions.length} | ` + Object.entries(sites).map(([k, s]) => `${k}: ${s.rivals.length}+${s.ours}`).join(' | '));
            failures = 0;
            reads++;
        } catch (e) {
            failures++;
            const msg = e instanceof Error ? e.message : String(e);
            appendFileSync(out, JSON.stringify({ at, error: msg }) + '\n');
            console.log(`${at} read failed (${failures} in a row): ${msg}`);
        }
        next += 1000 * (failures ? backoff(everyS, failures) : everyS);
        if (next < stopAt) await Bun.sleep(Math.max(0, next - Date.now()));
    }
    console.log(`HEADCOUNT DONE ${reads} reads -> ${out}`);
}
