// Offline map of the Underground Pass: flood-fills the walkable regions from
// the SDK's bundled collision data (8-way moves checked with the engine's own
// canTravel), then reports which region each quest loc/NPC sits in and which
// regions each obstacle loc borders. No server needed.
//
//   bun docs/speedrun/scripts/quest-underground-pass-map.ts [regions|dist x,z,l x,z,l ...]
//
// `regions` prints every obstacle and the regions next to it. `dist` prints the
// 8-way step count (route tiles at run speed) between consecutive points.

import * as rsmod from '../../../server/vendor/rsmod-pathfinder';
import { CollisionType } from '../../../server/vendor/rsmod-pathfinder';
import { initPathfinding } from '../../../sdk/pathfinding';
import { execSync } from 'child_process';

initPathfinding();

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const can = (l: number, x: number, z: number, dx: number, dz: number) => rsmod.canTravel(l, x, z, dx, dz, 1, 0, CollisionType.NORMAL);
const key = (l: number, x: number, z: number) => `${l},${x},${z}`;

/** BFS from one tile; returns step counts to every reachable tile within the box. */
export function bfs(l: number, sx: number, sz: number, limit = 6000): Map<string, number> {
    const dist = new Map<string, number>([[key(l, sx, sz), 0]]);
    const q: Array<[number, number]> = [[sx, sz]];
    for (let i = 0; i < q.length && dist.size < limit * 10; i++) {
        const [x, z] = q[i];
        const d = dist.get(key(l, x, z))!;
        for (const [dx, dz] of DIRS) {
            const k = key(l, x + dx, z + dz);
            if (dist.has(k) || !can(l, x, z, dx, dz)) continue;
            dist.set(k, d + 1);
            q.push([x + dx, z + dz]);
        }
    }
    return dist;
}

const find = (kind: string, names: string) =>
    execSync(`bun ${import.meta.dir}/quest-regicide-find.ts ${kind} ${names}`).toString().split('\n')
        .map(line => line.match(/^(\S+)\t\((\d+),(\d+),(\d+)\)/)).filter(Boolean)
        .map(m => ({ name: m![1], x: Number(m![2]), z: Number(m![3]), l: Number(m![4]) }))
        .filter(p => (p.z > 9500 && p.z < 9950) || (p.l === 1 && p.z > 4500 && p.z < 4750 && p.x > 1980 && p.x < 2200));

const mode = process.argv[2] ?? 'regions';
if (mode === 'dist') {
    const pts = process.argv.slice(3).map(s => s.split(',').map(Number));
    for (let i = 0; i + 1 < pts.length; i++) {
        const [ax, az, al] = pts[i];
        const [bx, bz] = pts[i + 1];
        const d = bfs(al ?? 0, ax, az);
        // allow arriving next to a blocked target tile (an NPC or loc)
        let best: number | undefined = d.get(key(al ?? 0, bx, bz));
        if (best === undefined) {
            for (const [dx, dz] of DIRS) {
                const v = d.get(key(al ?? 0, bx + dx, bz + dz));
                if (v !== undefined && (best === undefined || v + 0 < best)) best = v;
            }
        }
        console.log(`(${ax},${az},${al ?? 0}) -> (${bx},${bz}): ${best ?? 'unreachable'} tiles`);
    }
} else {
    // Label regions by flooding from every listed point.
    const region = new Map<string, number>();
    const sizes: number[] = [0];
    const label = (l: number, x: number, z: number): number | undefined => {
        const k = key(l, x, z);
        if (region.has(k)) return region.get(k);
        const d = bfs(l, x, z);
        if (d.size <= 1) {
            // isolated or blocked tile: no region
            let open = false;
            for (const [dx, dz] of DIRS) if (can(l, x, z, dx, dz)) open = true;
            if (!open) return undefined;
        }
        const id = sizes.length;
        sizes.push(d.size);
        for (const kk of d.keys()) region.set(kk, id);
        return id;
    };
    const near = (p: { x: number; z: number; l: number }) => {
        const out = new Set<number>();
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
            const r = label(p.l, p.x + dx, p.z + dz);
            if (r !== undefined) out.add(r);
        }
        return [...out];
    };
    const groups: Array<[string, string]> = [
        ['loc', 'upass_caveentrance2 cave_exit_upass rockslide2_obstacle_upass oldbridge_guiderope old_bridge_up upass_lever_up upass_pipe4 upass_pipe5 loc_2274 loc_2276 obstical_rockswing_middle portcullis_upass portcullis_lever_up upass_grilltrap_hand_holds upass_speartrap upass_double_springtrap_trigger upass_logtrap_trigger furnace_upass cave_well caverockpile upass_swampbubbles1'],
        ['loc', 'mudpile_upass cavefood1 cave_railings2 cave_railings3 cave_railings5 upass_mud cavewalltunnel_upass_tocells upass_ledge walkway_upass_narrow_mid_top upass_pipe6 upass_unicorn_doorr upass_unicorn_doorl unicorncage_destroyed_upass bloodwell_upass cavetempledoor2l cavetempledoor2r upass_last_out'],
        ['loc', 'cavewalltunnel_upass_down cavewalltunnel_upass_up bridgecollapsed1 bridgecollapsed2 cavewitch_door cavewitchchest upassshutchest1 upass_templedoor_closed_right upass_templedoor_closed_left cave_temple_altar upass_cage_dummy ibantomb_left upassdwarfbrewbarrel'],
        ['npc', 'caveguide2 caveguide3 caveguide5 boulder_upass unicorn_upass upass_paladin1 upass_paladin2 upass_paladin3 cavewitch cavewitchcat upassdwarf1 upassdwarf2 upassdwarf3 kalrag othainian doomion holthion iban ibanmonk'],
        ['obj', 'caveorb2 caveorb3 caveorb4 woodplank'],
    ];
    for (const [kind, names] of groups) {
        for (const p of find(kind, names)) {
            console.log(`${kind} ${p.name}\t(${p.x},${p.z},${p.l})\tregions ${JSON.stringify(near(p))}`);
        }
    }
    console.log('region sizes:', sizes.map((s, i) => `${i}:${s}`).slice(1).join(' '));
}
