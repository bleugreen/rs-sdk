// Lab geometry probe behind speedrun/quests/fishing-contest.ts (S20, the self route): where the
// route's locs and NPCs stand, which side of McGrubor's loose railing is the wood, and how far the
// nearest red vine is from it. Prints positions only; no timing.
//
//   LAB_RUNNERS=0 speedrun/lab/lab.sh <bot> 'speedrun/lab/quests/fishing-contest-probe.ts'

import type { NearbyLoc, NearbyNpc } from '../../../sdk/types';
import { opLoc } from '../../lib/act';
import { closeSession, openSession } from '../../lib/session';
import { waitTicks, waitUntil } from '../../lib/wait';
import { runTo } from '../../lib/travel';
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

try {
    await leaveTutorial(session);
    await clearInventory(sdk);
    await setStats(sdk, { fishing: 74, magic: 99, agility: 75 });
    await give(sdk, ['spade']);
    await cheat(sdk, '~energy', 1);


    if (process.argv.includes('--pipe')) {
        // The garlic pipe: each Wall Pipe tile's reachable flag, and a garlic use on it from inside the fence.
        for (const px of [2637, 2636, 2638]) {
            await clearInventory(sdk);
            await give(sdk, ['garlic']);
            await mustTele(sdk, 2637, 3444 + 1);
            await waitUntil(sdk, s => s.nearbyLocs.length > 0, { maxTicks: 10 });
            await waitTicks(sdk, 2);
            const pipes = (await sdk.scanNearbyLocs(6)).filter(l => /pipe/i.test(l.name));
            console.log(`pipes: ${pipes.map(l => `${l.name}#${l.id}@${l.x},${l.z} reachable=${(l as { reachable?: boolean }).reachable}`).join('  ')}`);
            const t0 = sdk.getState()!.tick;
            const slot = sdk.getState()!.inventory.find(i => /garlic/i.test(i.name))!.slot;
            const sent = await sdk.sendUseItemOnLoc(slot, px, 3446, 41);
            await waitTicks(sdk, 8);
            const s = sdk.getState()!;
            console.log(`garlic on pipe ${px},3446: sent ${JSON.stringify(sent).slice(0, 160)}; at ${pos(s).x},${pos(s).z}; garlic ${s.inventory.some(i => /garlic/i.test(i.name)) ? 'held' : 'gone'}; msgs ${JSON.stringify(s.gameMessages.filter(m => m.tick >= t0).map(m => m.text))}`);
        }
        process.exit(0);
    }

    // McGrubor's railing: the squeeze from each side (the tile it ends on, not the approach step), then a
    // real run to the nearest vine from there, its trail, and a dig with the spade.
    for (const side of ['W', 'E'] as const) {
        const from = { x: side === 'W' ? 2661 : 2662, z: 3500 };
        const { locs } = await look(`railing${side}`, from.x, from.z, /railing|gate|vine/i, /forester/i, 40);
        const rail = locs.find(l => /loose railing/i.test(l.name));
        if (!rail) continue;
        const t0 = sdk.getState()!.tick;
        const r = await opLoc(sdk, rail, 1, s => s.gameMessages.some(m => m.tick >= t0 && /squeeze through/i.test(m.text)), { maxTicks: 15, resendEvery: 0 });
        await waitUntil(sdk, s => pos(s).x !== from.x, { maxTicks: 8 });
        await waitTicks(sdk, 2);
        const after = pos(sdk);
        console.log(`squeeze from ${from.x},${from.z}: message ${r.ok} at +${r.ticks}; on ${after.x},${after.z} at +${sdk.getState()!.tick - t0}`);
        const trail: string[] = [];
        const unsub = sdk.onStateUpdate(s => {
            const p = pos(s);
            const last = trail[trail.length - 1];
            const here = `${p.x},${p.z}`;
            if (!last?.endsWith(here)) trail.push(`${s.tick - t0}:${here}`);
        });
        const w0 = sdk.getState()!.tick;
        const walk = await runTo(sdk as never, { x: 2631, z: 3500, tol: 0 }, { bot: session.bot as never });
        unsub();
        const walked = sdk.getState()!.tick - w0;
        console.log(`run to the vine (2631,3500) from ${after.x},${after.z}: ok ${walk.ok} (${walk.reason ?? ''}) ${walked} ticks; trail ${trail.join(' ')}`);
        const vine = (await sdk.scanNearbyLocs(3)).filter(l => /^vine$/i.test(l.name)).sort((a, b) => a.distance - b.distance)[0];
        let dug = 'no vine';
        if (vine) {
            const d0 = sdk.getState()!.tick;
            const dig = await opLoc(sdk, vine, /check/i, s => s.inventory.some(i => /red vine worm/i.test(i.name)), { maxTicks: 15 });
            dug = `${vine.x},${vine.z}#${vine.id}: ${dig.ok ? 'worm' : 'none'} at +${sdk.getState()!.tick - d0}; msgs ${JSON.stringify(sdk.getState()!.gameMessages.filter(m => m.tick >= d0).map(m => m.text))}`;
        }
        console.log(`dig: ${dug}`);
        result(`fc_probe_squeeze${side}`, { from, after, walkOk: walk.ok, walked, trail, dug });
        await clearInventory(sdk);
        await give(sdk, ['spade']);
    }
} finally {
    await closeSession(session);
}
process.exit(0);
