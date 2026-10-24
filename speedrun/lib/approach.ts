// The approach before a talk to an NPC that wanders: an NPC with a wander range can walk through an
// open door into another room, the door shuts behind it, and every Talk-to click then goes
// unrouted (the browser's 'unrouted - ap-range', the lite client's cant_reach) until the talk gives
// up: attempt 3's S08 B on Edmond, 'no dialogue opened' after ~48 ticks (rs/665). `approachNpc`
// finds the NPC's live tile, opens the closed doors on the way to it, runs to within 1 and checks
// it is still there, then leaves the talk click to the caller. When nothing stands between, it
// sends nothing: the talk click's own server-side approach walks the player there as before.
//
// The doors are found from the SDK route, never from a module's map notes: the SDK pathfinder
// routes through every door (sdk/pathfinding.ts unmasks door walls), and a door's wall lies on an
// edge of its own tile, so a route crosses a door only by stepping into or out of that tile.

import type { BotSDK } from '../../sdk/index';
import type { NearbyLoc, NearbyNpc } from '../../sdk/types';
import { openDoor, type ActOptions } from './act';
import { CLOSED_DOOR, expandRoute, inArea, runTo, type Area, type TravelSdk, type WalkBot } from './travel';
import { currentTick, waitUntil, type StateSource } from './wait';
import { chebyshev, findNpc, pos, waitForNpc, type NamePattern, type StateLike } from './world';

/**
 * The closed doors and gates the SDK route from the player to `to` crosses, in walking order: each
 * listed closed door whose tile is the player's own or a route tile. Waits for a built scene first
 * (a browser frame published mid-rebuild lists no locs). Only the published loc list is read, so a
 * door beyond it is not found; the run that follows opens a door on its route itself.
 */
export async function doorsBetween(sdk: StateSource & Pick<BotSDK, 'findPath'>, to: { x: number; z: number }): Promise<NearbyLoc[]> {
    if (sdk.getState()?.sceneReady === false) await waitUntil(sdk, s => s.sceneReady !== false, { maxTicks: 60 });
    const s = sdk.getState();
    const closed = s?.nearbyLocs.filter(CLOSED_DOOR) ?? [];
    if (!s || !closed.length) return [];
    const from = pos(s);
    const path = sdk.findPath(to.x, to.z, 500);
    const points = path.success && path.waypoints.length ? [...path.waypoints, to] : [to];
    const out: NearbyLoc[] = [];
    for (const t of [from, ...expandRoute(from, points)]) {
        for (const d of closed) if (d.x === t.x && d.z === t.z && !out.includes(d)) out.push(d);
    }
    return out;
}

/** The NPC's route tile (NearbyNpc.tileX/Z; x/z trail a moving NPC) where the client publishes it. */
export function npcTile(n: NearbyNpc): { x: number; z: number } {
    return { x: n.tileX ?? n.x, z: n.tileZ ?? n.z };
}

/** The player stands within 1 of the NPC's footprint (on its level). */
export function besideNpc(src: StateLike, n: NearbyNpc): boolean {
    const p = pos(src);
    const t = npcTile(n);
    const size = n.size ?? 1;
    return Math.max(Math.max(t.x - p.x, p.x - (t.x + size - 1), 0), Math.max(t.z - p.z, p.z - (t.z + size - 1), 0)) <= 1;
}

export interface ApproachOptions {
    /** Pick the candidate nearest this tile (the NPC's spawn), as talkTo's `near` does. */
    near?: { x: number; z: number };
    /** Ticks each find waits for the NPC to come into view (default 10, talkTo's). */
    findTicks?: number;
    /** Further finds when the NPC has moved off the tile walked to (default 2). */
    refinds?: number;
    /** For the run's bot.walkTo fallback. */
    bot?: WalkBot;
    /** Pages dismissed while a door opens (the level-up pages). */
    interrupts?: ActOptions['interrupts'];
}

export interface ApproachResult {
    ok: boolean;
    /** The NPC as last found: the one to talk to. */
    npc?: NearbyNpc;
    /** From the call to the end of the approach: 0 when nothing stood between. */
    ticks: number;
    /** Finds made (1 when the first find settled it). */
    finds: number;
    /** The doors opened, in order. */
    doors: Array<{ x: number; z: number }>;
    /** Runs to within 1 of the NPC's live tile. */
    runs: number;
    reason?: string;
    /** Set when the NPC moved off every tile walked to: the talk goes from where the player stands. */
    note?: string;
}

/**
 * Before a talk: find the NPC (bounded wait), and when something stands between, open the closed
 * doors on the route to its live tile and run to within 1 of it, re-finding it up to `refinds` more
 * times when it has moved off. Nothing stands between when the client can route to it
 * (NearbyNpc.reachable) or, where the client does not say, no closed door lies on the route. Never
 * throws: an NPC not in sight, or a door that will not open, is `ok: false` with the reason.
 */
export async function approachNpc(sdk: TravelSdk, npc: NamePattern, opts: ApproachOptions = {}): Promise<ApproachResult> {
    const t0 = currentTick(sdk);
    const findTicks = opts.findTicks ?? 10;
    const refinds = opts.refinds ?? 2;
    const doors: ApproachResult['doors'] = [];
    let runs = 0;
    let finds = 0;
    const done = (ok: boolean, extra: Partial<ApproachResult>): ApproachResult => ({ ok, ticks: currentTick(sdk) - t0, finds, doors, runs, ...extra });
    try {
        let last: NearbyNpc | undefined;
        while (finds <= refinds) {
            finds++;
            const n = await waitForNpc(sdk, npc, findTicks, opts.near);
            if (!n) return done(false, { reason: `not in sight within ${findTicks} ticks (find ${finds})` });
            last = n;
            const between = n.reachable === true ? [] : await doorsBetween(sdk, npcTile(n));
            // The client routes to it, or no listed door is in the way and nothing says otherwise.
            if (!between.length && (n.reachable !== false || besideNpc(sdk, n))) return done(true, { npc: n });
            for (const d of between) {
                const r = await openDoor(sdk, d.x, d.z, { interrupts: opts.interrupts });
                if (!r.ok) return done(false, { npc: n, reason: `the door at ${d.x},${d.z} did not open (${r.reason ?? 'not open'})` });
                doors.push({ x: d.x, z: d.z });
            }
            const beside: Area = { ...npcTile(n), level: pos(sdk).level, tol: 1 };
            if (!inArea(sdk, beside)) {
                runs++;
                await runTo(sdk, beside, opts.bot ? { bot: opts.bot } : {});
            }
            const now = findNpc(sdk.getState(), npc, opts.near);
            if (now) last = now;
            if (now && besideNpc(sdk, now) && now.reachable !== false && !(await doorsBetween(sdk, npcTile(now))).length) return done(true, { npc: now });
        }
        return done(true, { npc: last, note: `moved off each tile walked to (${finds} finds); talking from here` });
    } catch (e) {
        return done(false, { reason: `approach: ${e instanceof Error ? e.message : String(e)}` });
    }
}
