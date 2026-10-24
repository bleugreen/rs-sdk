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

// ------------------------------------------------------------------ a tile in range of a target (rs/693)
//
// The fight's case of the same failure: a target the client cannot route to (the browser sends the
// op alone, 'unrouted - ap-range attempt'; lite refuses with cant_reach), and the server, in
// client-routefinder mode, only acts when the player already stands in range with line of sight.
// The live S12:H of 10-24 re-sent Fire Blast at a Khazard Scorpion behind its closed cage gate for
// ~150 ticks with nothing landing. `approachInRange` picks the tile itself (the SDK walk's nearer-
// tile fallback was narrowed, rs/565): the nearest one within `range` of the NPC's live footprint
// that the SDK route reaches exactly and that has line of sight to it.

/** Line of sight from a 1x1 player on `from` to an NPC footprint whose SW tile is `to`. */
export type SightCheck = (level: number, from: { x: number; z: number }, to: { x: number; z: number }, size: number) => boolean;

export interface InRangeOptions extends ApproachOptions {
    /** Candidate tiles tested for a route, nearest the player first (default 48). */
    candidates?: number;
    /** Line of sight (default: the SDK's static collision map; true where it has no data). */
    sight?: SightCheck;
}

export interface InRangeResult extends ApproachResult {
    /** The tile the approach ended on: the one walked to, or the player's own when it already served. */
    tile?: { x: number; z: number };
}

/** Chebyshev distance from `p` to the footprint of `size` whose SW tile is `t` (0 on it). */
export function footprintDistance(p: { x: number; z: number }, t: { x: number; z: number }, size: number): number {
    return Math.max(Math.max(t.x - p.x, p.x - (t.x + size - 1), 0), Math.max(t.z - p.z, p.z - (t.z + size - 1), 0));
}

let staticSight: SightCheck | null = null;

/** The static map's line of sight, loaded on first use so a caller that never needs it never loads the map. */
async function defaultSight(): Promise<SightCheck> {
    if (staticSight) return staticSight;
    try {
        const pf = await import('../../sdk/pathfinding');
        const rsmod = await import('../../server/vendor/rsmod-pathfinder');
        staticSight = (level, from, to, size) => {
            if (!pf.isZoneAllocated(level, from.x, from.z) || !pf.isZoneAllocated(level, to.x, to.z)) return true;
            return rsmod.hasLineOfSight(level, from.x, from.z, to.x, to.z, 1, 1, size, size, 0);
        };
    } catch {
        staticSight = () => true;
    }
    return staticSight;
}

/** The SDK route from the player ends on `t` itself (the player's own tile always does). */
function routesTo(sdk: TravelSdk, t: { x: number; z: number }): boolean {
    const p = pos(sdk);
    if (p.x === t.x && p.z === t.z) return true;
    const r = sdk.findPath(t.x, t.z, 500);
    const last = r.waypoints[r.waypoints.length - 1];
    return r.success && r.reachedDestination !== false && !!last && last.x === t.x && last.z === t.z;
}

/** The nearest tile within `range` of the footprint, with line of sight and an exact SDK route; null when none of the first `max` in sight routes. */
export function pickRangeTile(sdk: TravelSdk, n: NearbyNpc, range: number, sight: SightCheck, max = 48): { x: number; z: number } | null {
    const t = npcTile(n);
    const size = n.size ?? 1;
    const p = pos(sdk);
    const tiles: Array<{ x: number; z: number }> = [];
    for (let x = t.x - range; x <= t.x + size - 1 + range; x++) {
        for (let z = t.z - range; z <= t.z + size - 1 + range; z++) {
            const d = footprintDistance({ x, z }, t, size);
            if (d >= 1 && d <= range) tiles.push({ x, z });
        }
    }
    tiles.sort((a, b) => chebyshev(a, p) - chebyshev(b, p) || footprintDistance(a, t, size) - footprintDistance(b, t, size) || a.x - b.x || a.z - b.z);
    let tried = 0;
    for (const c of tiles) {
        if (!sight(p.level, c, t, size)) continue;
        if (tried++ >= max) break;
        if (routesTo(sdk, c)) return c;
    }
    return null;
}

/**
 * Before a re-sent attack or cast on a target the client cannot route to: find the target's live
 * tile (by world index when given the NPC itself), pick the nearest tile within `range` of its
 * footprint with line of sight and an exact SDK route (range 1: beside it, the melee case), open the
 * closed doors on the way and run there, re-finding it up to `refinds` more times when it has moved
 * out of range. The player's own tile serves when it qualifies: nothing is sent. Never throws: no
 * tile at all is `ok: false`, the reason naming the target and its tile.
 */
export async function approachInRange(sdk: TravelSdk, target: NearbyNpc | NamePattern, range: number, opts: InRangeOptions = {}): Promise<InRangeResult> {
    const t0 = currentTick(sdk);
    const findTicks = opts.findTicks ?? 10;
    const refinds = opts.refinds ?? 2;
    const doors: ApproachResult['doors'] = [];
    let runs = 0;
    let finds = 0;
    const done = (ok: boolean, extra: Partial<InRangeResult>): InRangeResult => ({ ok, ticks: currentTick(sdk) - t0, finds, doors, runs, ...extra });
    const given = typeof target === 'object' && 'index' in target ? target : null;
    const byIndex = given ? given.index : null;
    const name = given ? given.name : String(target);
    const live = (): NearbyNpc | null => (byIndex !== null ? (sdk.getState()?.nearbyNpcs.find(n => n.index === byIndex) ?? null) : findNpc(sdk.getState(), target as NamePattern, opts.near));
    const what = range > 1 ? 'a cast' : 'an attack';
    try {
        const sight = opts.sight ?? (await defaultSight());
        const served = (n: NearbyNpc) => footprintDistance(pos(sdk), npcTile(n), n.size ?? 1) <= range && sight(pos(sdk).level, pos(sdk), npcTile(n), n.size ?? 1);
        let last: NearbyNpc | undefined;
        while (finds <= refinds) {
            finds++;
            const n = byIndex !== null
                ? ((await waitUntil(sdk, () => live() !== null, { maxTicks: findTicks })).ok ? live() : null)
                : await waitForNpc(sdk, target as NamePattern, findTicks, opts.near);
            if (!n) return done(false, { reason: `${name} not in sight within ${findTicks} ticks (find ${finds})` });
            last = n;
            const tile = pickRangeTile(sdk, n, range, sight, opts.candidates ?? 48);
            const t = npcTile(n);
            if (!tile) return done(false, { npc: n, reason: `${n.name} not reachable for ${what} from any tile (at ${t.x},${t.z})` });
            const p = pos(sdk);
            if (tile.x === p.x && tile.z === p.z) return done(true, { npc: n, tile });
            for (const d of await doorsBetween(sdk, tile)) {
                const r = await openDoor(sdk, d.x, d.z, { interrupts: opts.interrupts });
                if (!r.ok) return done(false, { npc: n, reason: `the door at ${d.x},${d.z} did not open (${r.reason ?? 'not open'})` });
                doors.push({ x: d.x, z: d.z });
            }
            runs++;
            await runTo(sdk, { ...tile, level: p.level, tol: 0 }, opts.bot ? { bot: opts.bot } : {});
            const now = live();
            if (now) last = now;
            if (now && served(now)) return done(true, { npc: now, tile: { x: pos(sdk).x, z: pos(sdk).z } });
        }
        const p = pos(sdk);
        return done(true, { npc: last, tile: { x: p.x, z: p.z }, note: `moved out of range of each tile walked to (${finds} finds); acting from here` });
    } catch (e) {
        return done(false, { reason: `approach: ${e instanceof Error ? e.message : String(e)}` });
    }
}

/** A send's result that says it reached no tile: the browser's op without a route (`routed: false`), lite's cant_reach refusal. */
export function unroutedReply(res: unknown): boolean {
    const r = res as { data?: { routed?: unknown }; reason?: unknown; message?: unknown } | null | undefined;
    return r?.data?.routed === false || r?.reason === 'cant_reach' || (typeof r?.message === 'string' && /\(unrouted\b/.test(r.message));
}
