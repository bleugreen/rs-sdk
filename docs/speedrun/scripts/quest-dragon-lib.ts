// Shared helpers for the Dragon Slayer measurements
// (docs/speedrun/quests/dragon_slayer.md). Not a script itself.

import type { BotSDK } from '../../../sdk/index';
import type { BotWorldState } from '../../../sdk/types';
import { now, pos, waitUntil } from './quest-primitives-lib';

/**
 * Click through a conversation as fast as the stock client allows. Each
 * choice menu consumes the next regex in `answers`, in order, so a menu whose
 * options depend on the stage is answered deterministically. Resolves when
 * `until` holds.
 */
export async function converseSeq(sdk: BotSDK, start: () => Promise<unknown>, answers: RegExp[], until: (s: BotWorldState) => boolean, maxTicks = 200) {
    let lastPage = '';
    let pages = 0, choices = 0, next = 0;
    const unanswered: string[][] = [];
    const unsub = sdk.onStateUpdate(s => {
        const d = s.dialog;
        if (!d.isOpen || d.isWaiting || !d.pageId || d.pageId === lastPage) return;
        lastPage = d.pageId;
        if (d.options.length > 1) {
            const want = answers[next];
            const opt = want ? d.options.find(o => want.test(o.text)) : undefined;
            if (!opt) { unanswered.push(d.options.map(o => o.text)); return; }
            next++;
            choices++;
            void sdk.sendClickDialog(opt.index);
        } else {
            pages++;
            void sdk.sendClickDialog(0);
        }
    });
    const t0 = now(sdk);
    await start();
    const r = await waitUntil(sdk, until, maxTicks);
    unsub();
    return { ticks: r ? r.tick - t0 : null, pages, choices, answered: next, unanswered, at: pos(r?.state ?? sdk.getState()) };
}

export async function talk(sdk: BotSDK, npc: RegExp) {
    const n = sdk.findNearbyNpc(npc, { reachable: true } as any) ?? sdk.findNearbyNpc(npc);
    if (!n) throw new Error('npc not found ' + npc + ' near ' + JSON.stringify(pos(sdk.getState())) + ': ' + sdk.getState()!.nearbyNpcs.map(x => x.name).join(','));
    const op = n.optionsWithIndex.find(o => /talk/i.test(o.text))!;
    await sdk.sendInteractNpc(n.index, op.opIndex);
}

/** Click the nearest loc whose name and option match. */
export async function clickLoc(sdk: BotSDK, name: RegExp, op: RegExp, near?: { x: number; z: number }) {
    const locs = sdk.getState()!.nearbyLocs.filter(l => name.test(l.name) && l.optionsWithIndex.some(o => op.test(o.text)));
    const key = (l: { x: number; z: number; distance: number }) => near ? Math.max(Math.abs(l.x - near.x), Math.abs(l.z - near.z)) : l.distance;
    const loc = locs.sort((a, b) => key(a) - key(b))[0];
    if (!loc) throw new Error(`loc not found ${name} ${op} near ${JSON.stringify(pos(sdk.getState()))}`);
    await sdk.sendInteractLoc(loc.x, loc.z, loc.id, loc.optionsWithIndex.find(o => op.test(o.text))!.opIndex);
    return loc;
}

/**
 * Count the route tiles the player actually walks (sum of per-tick Chebyshev
 * steps on one level), so a measured walk can be re-costed at 0.5 ticks per
 * tile for chained clicks (primitives.md section 2).
 */
export function routeCounter(sdk: BotSDK) {
    let last = pos(sdk.getState());
    let tiles = 0;
    const unsub = sdk.onStateUpdate(s => {
        const p = pos(s);
        if (p.level === last.level) {
            const d = Math.max(Math.abs(p.x - last.x), Math.abs(p.z - last.z));
            if (d <= 3) tiles += d; // larger jumps are teleports, not walking
        }
        last = p;
    });
    return { get tiles() { return tiles; }, stop: unsub };
}

/** Walk with chained clicks of at most `leg` tiles along a list of waypoints. */
export async function walkPath(sdk: BotSDK, path: Array<{ x: number; z: number }>, maxTicks = 300) {
    const t0 = now(sdk);
    for (const wp of path) {
        await sdk.sendWalk(wp.x, wp.z, true);
        const r = await waitUntil(sdk, s => { const p = pos(s); return Math.max(Math.abs(p.x - wp.x), Math.abs(p.z - wp.z)) <= 2; }, maxTicks);
        if (!r) return { ok: false, ticks: now(sdk) - t0, stuckAt: pos(sdk.getState()), wanted: wp };
    }
    // settle on the last waypoint exactly
    const last = path[path.length - 1];
    await waitUntil(sdk, s => { const p = pos(s); return p.x === last.x && p.z === last.z; }, 6);
    return { ok: true, ticks: now(sdk) - t0, at: pos(sdk.getState()) };
}
