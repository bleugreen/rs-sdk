// Lab geometry probe behind speedrun/quests/fishing-contest.ts (S20, the self route): where the
// route's locs and NPCs stand, which side of McGrubor's loose railing is the wood, and how far the
// nearest red vine is from it. Prints positions only; no timing.
//
//   LAB_RUNNERS=0 speedrun/lab/lab.sh <bot> 'speedrun/lab/quests/fishing-contest-probe.ts'

import type { NearbyLoc, NearbyNpc } from '../../../sdk/types';
import { opLoc } from '../../lib/act';
import { closeSession, openSession } from '../../lib/session';
import { waitTicks, waitUntil } from '../../lib/wait';
import { pos } from '../../lib/world';
import { botArg, result } from '../common';
import { cheat, clearInventory, give, leaveTutorial, mustTele, setStats } from '../setup';

const session = await openSession(botArg(), { launch: true });
const { sdk } = session;

const fmtLoc = (l: NearbyLoc) => `${l.name}#${l.id}@${l.x},${l.z}[${l.options.join('/')}]`;
const fmtNpc = (n: NearbyNpc) => `${n.name}#${n.id}/i${n.index}@${n.x},${n.z}[${(n as unknown as { options?: string[] }).options?.join('/') ?? ''}]`;

async function look(label: string, x: number, z: number, locRe: RegExp, npcRe: RegExp, radius = 30): Promise<{ locs: NearbyLoc[]; npcs: NearbyNpc[] }> {
    await mustTele(sdk, x, z);
    await waitUntil(sdk, s => s.nearbyLocs.length > 0, { maxTicks: 10 });
    await waitTicks(sdk, 2);
    const locs = (await sdk.scanNearbyLocs(radius)).filter(l => locRe.test(l.name));
    const npcs = (sdk.getState()?.nearbyNpcs ?? []).filter(n => npcRe.test(n.name));
    console.log(`\n== ${label} at ${JSON.stringify(pos(sdk))}`);
    console.log(`locs: ${locs.map(fmtLoc).join('  ')}`);
    console.log(`npcs: ${npcs.map(fmtNpc).join('  ')}`);
    result(`fc_probe_${label}`, { at: pos(sdk), locs: locs.map(fmtLoc), npcs: npcs.map(fmtNpc) });
    return { locs, npcs };
}

function pathLen(x: number, z: number): number {
    const p = sdk.findPath(x, z, 500);
    return p.success && p.reachedDestination !== false ? p.waypoints.length : -1;
}

try {
    await leaveTutorial(session);
    await clearInventory(sdk);
    await setStats(sdk, { fishing: 74, magic: 99, agility: 75 });
    await give(sdk, ['spade']);
    await cheat(sdk, '~energy', 1);

    await look('stairs', 2820, 3486, /stair/i, /dwarf/i, 10);
    await look('hemenster', 2644, 3441, /gate|pipe|fence/i, /bonzo|morris|stranger|fishing spot|grandpa|joshua|dave/i, 20);

    // McGrubor's railing from both sides: which one the squeeze moves into, and the vines' path from there.
    for (const side of [-1, 1]) {
        const { locs } = await look(`railing${side < 0 ? 'W' : 'E'}`, 2662 + (side < 0 ? -1 : 1), 3500, /railing|gate|vine/i, /forester/i, 40);
        const rail = locs.find(l => /loose railing/i.test(l.name));
        if (!rail) continue;
        const before = pos(sdk);
        const r = await opLoc(sdk, rail, 1, s => pos(s).x !== before.x || pos(s).z !== before.z, { maxTicks: 15 });
        await waitTicks(sdk, 3);
        const after = pos(sdk);
        const vines = (await sdk.scanNearbyLocs(40)).filter(l => /^vine$/i.test(l.name) && l.options.some(o => /check/i.test(o)));
        const ranked = vines
            .map(v => ({ v, d: Math.max(...[[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => -pathLen(v.x + dx!, v.z + dz!))) }))
            .map(({ v, d }) => ({ v, steps: -d }))
            .sort((a, b) => (a.steps < 0 ? 1e9 : a.steps) - (b.steps < 0 ? 1e9 : b.steps));
        console.log(`squeeze from ${before.x},${before.z}: ok ${r.ok} in ${r.ticks} -> ${after.x},${after.z}; vines by path: ${ranked.slice(0, 8).map(({ v, steps }) => `${v.x},${v.z}#${v.id}:${steps}`).join('  ')}`);
        result(`fc_probe_squeeze${side < 0 ? 'W' : 'E'}`, { before, ok: r.ok, ticks: r.ticks, after, vines: ranked.map(({ v, steps }) => ({ x: v.x, z: v.z, id: v.id, steps })) });
    }
} finally {
    await closeSession(session);
}
process.exit(0);
