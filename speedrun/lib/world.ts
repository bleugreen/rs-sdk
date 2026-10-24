// World queries shared by step scripts: where the player is, the nearest NPC
// or loc, what the inventory holds, how far the player actually walked, and
// content config ids by debug name.
//
// Every function takes either a state source (the SDK) or a published state,
// so a predicate handed to `waitUntil` can call them on the state it is given.

import { readFileSync } from 'fs';
import { join } from 'path';
import type { BotSDK } from '../../sdk/index';
import type { BotWorldState, InventoryItem, NearbyLoc, NearbyNpc } from '../../sdk/types';
import { matchesItem, type ItemPattern } from './items';
import { waitUntil, type Pred, type StateSource } from './wait';

export interface Tile {
    x: number;
    z: number;
    level: number;
}

export type StateLike = Pick<StateSource, 'getState'> | BotWorldState | null | undefined;

export function stateOf(src: StateLike): BotWorldState | null {
    if (!src) return null;
    return 'getState' in src ? src.getState() : src;
}

/** The player's tile; -1 in every field before the first in-game state. */
export function pos(src: StateLike): Tile {
    const p = stateOf(src)?.player;
    return { x: p?.worldX ?? -1, z: p?.worldZ ?? -1, level: p?.level ?? -1 };
}

/** p_preventlogout(..., 16) after combat (logout.rs2): the server refuses a logout this many ticks after the last hit. */
export const COMBAT_LOGOUT_TICKS = 16;

/**
 * In combat as the server's logout rule counts it: engaged, or hit within COMBAT_LOGOUT_TICKS.
 * lastDamageTick is -1 when the player was never hit (sdk/types.ts): no window then.
 */
export function inCombatWindow(src: StateLike): boolean {
    const s = stateOf(src);
    const c = s?.player?.combat;
    if (!s || !c) return false;
    return c.inCombat || (c.lastDamageTick >= 0 && s.tick - c.lastDamageTick <= COMBAT_LOGOUT_TICKS);
}

export function chebyshev(a: { x: number; z: number }, b: { x: number; z: number }): number {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

/** The player is within `tol` tiles (Chebyshev) of (x, z) on `level`. */
export function at(x: number, z: number, level = 0, tol = 0): Pred {
    return s => {
        const p = pos(s);
        return p.level === level && chebyshev(p, { x, z }) <= tol;
    };
}

/** Tutorial Island and its dungeon, as `~in_tutorial_island` reads them (util.rs2). */
export function onTutorialIsland(p: { worldX: number; worldZ: number } | null | undefined): boolean {
    if (!p) return false;
    const { worldX: x, worldZ: z } = p;
    return (x >= 3053 && x <= 3156 && z >= 3056 && z <= 3136) || (x >= 3072 && x <= 3118 && z >= 9492 && z <= 9535);
}

/** A number matches the config id; a string is a case-insensitive substring of the name; a RegExp is tested on it. */
export type NamePattern = string | RegExp | number;

function matchesName(e: { id: number; name: string }, p: NamePattern): boolean {
    return matchesItem(e, p);
}

/** The nearest NPC matching `pattern`: by distance, or to `near` when given. */
export function findNpc(src: StateLike, pattern: NamePattern, near?: { x: number; z: number }): NearbyNpc | null {
    const npcs = (stateOf(src)?.nearbyNpcs ?? []).filter(n => matchesName(n, pattern));
    const key = (n: NearbyNpc) => (near ? chebyshev(n, near) : n.distance);
    return npcs.sort((a, b) => key(a) - key(b))[0] ?? null;
}

/**
 * The nearest NPC matching `pattern`, waiting up to `maxTicks` for it to
 * appear: the NPC list lags a teleport or a climb by a tick or two.
 */
export async function waitForNpc(sdk: StateSource, pattern: NamePattern, maxTicks = 10, near?: { x: number; z: number }): Promise<NearbyNpc | null> {
    const r = await waitUntil(sdk, s => findNpc(s, pattern, near) !== null, { maxTicks });
    return r.ok ? findNpc(r.state, pattern, near) : null;
}

/** The NPC with world index `index`, if it is still in view. */
export function npcByIndex(src: StateLike, index: number): NearbyNpc | null {
    return stateOf(src)?.nearbyNpcs.find(n => n.index === index) ?? null;
}

/** A string matches an interaction option exactly (case-insensitive); a RegExp is tested on it. */
export type OpPattern = string | RegExp;

export function matchesOp(text: string, p: OpPattern): boolean {
    if (typeof p === 'string') return text.toLowerCase() === p.toLowerCase();
    p.lastIndex = 0;
    return p.test(text);
}

/** The opIndex of the first option matching `p`, or undefined. */
export function opIndex(target: { optionsWithIndex: ReadonlyArray<{ text: string; opIndex: number }> }, p: OpPattern): number | undefined {
    return target.optionsWithIndex.find(o => matchesOp(o.text, p))?.opIndex;
}

export interface LocQuery {
    /** Exact tile; several locs can share one (a wall and its decoration), so combine with id, name or op. */
    x?: number;
    z?: number;
    id?: number;
    name?: NamePattern;
    /** Only locs that offer this option. */
    op?: OpPattern;
    /** Sort by distance to this tile instead of to the player. */
    near?: { x: number; z: number };
    /** Scan radius when the published list has no match (default 25). */
    radius?: number;
}

export function locMatches(l: NearbyLoc, q: LocQuery): boolean {
    if (q.x !== undefined && l.x !== q.x) return false;
    if (q.z !== undefined && l.z !== q.z) return false;
    if (q.id !== undefined && l.id !== q.id) return false;
    if (q.name !== undefined && !matchesName(l, q.name)) return false;
    if (q.op !== undefined && opIndex(l, q.op) === undefined) return false;
    return true;
}

function nearest(locs: NearbyLoc[], q: LocQuery): NearbyLoc | null {
    const key = (l: NearbyLoc) => (q.near ? chebyshev(l, q.near) : l.distance);
    return locs.filter(l => locMatches(l, q)).sort((a, b) => key(a) - key(b))[0] ?? null;
}

/** The nearest loc matching `q`: from the published list, else from an on-demand scan. */
export async function findLoc(sdk: Pick<BotSDK, 'getState' | 'scanNearbyLocs'> & Partial<StateSource>, q: LocQuery): Promise<NearbyLoc | null> {
    // While the client rebuilds the region (sceneReady false: the browser client after a teleport,
    // a spirit tree or a relog) its loc lists are empty or the old region's, so wait for the built region.
    if (sdk.getState()?.sceneReady === false && sdk.onStateUpdate) await waitUntil(sdk as StateSource, s => s.sceneReady !== false, { maxTicks: 60 });
    return nearest(sdk.getState()?.nearbyLocs ?? [], q) ?? nearest(await sdk.scanNearbyLocs(q.radius ?? 25), q);
}

export function invItem(src: StateLike, pattern: ItemPattern): InventoryItem | null {
    return stateOf(src)?.inventory.find(i => matchesItem(i, pattern)) ?? null;
}

export function invCount(src: StateLike, pattern: ItemPattern): number {
    return (stateOf(src)?.inventory ?? []).filter(i => matchesItem(i, pattern)).reduce((a, i) => a + i.count, 0);
}

export function worn(src: StateLike, pattern: ItemPattern): InventoryItem | null {
    return stateOf(src)?.equipment.find(i => matchesItem(i, pattern)) ?? null;
}

export function skillLevel(src: StateLike, skill: string): number {
    return stateOf(src)?.skills.find(k => k.name.toLowerCase() === skill.toLowerCase())?.level ?? 0;
}

export function skillXp(src: StateLike, skill: string): number {
    return stateOf(src)?.skills.find(k => k.name.toLowerCase() === skill.toLowerCase())?.experience ?? 0;
}

/** Game messages (chat type 0) first published at or after `tick`, optionally matching `re`. */
export function messagesSince(src: StateLike, tick: number, re?: RegExp): string[] {
    return (stateOf(src)?.gameMessages ?? []).filter(m => m.type === 0 && m.tick >= tick && (!re || re.test(m.text))).map(m => m.text);
}

/**
 * The game-message cursor (the SDK's ActionHelpers.getMessageTick rule): the newest message's
 * observation id, the publication it first showed in, or its tick where it has none. Take it
 * before a click; messagesAfter then yields only the replies since. The clients stamp a click's
 * reply on different ticks (the browser on the click's own tick, lite on the next), so no tick
 * offset tells a new reply from the last one's on both; the publication cursor does.
 */
export function messageCursor(src: StateLike): number {
    let c = 0;
    for (const m of stateOf(src)?.gameMessages ?? []) c = Math.max(c, m.observationId ?? m.tick);
    return c;
}

/** Game messages (chat type 0) newer than `cursor` (messageCursor), optionally matching `re`. */
export function messagesAfter(src: StateLike, cursor: number, re?: RegExp): string[] {
    return (stateOf(src)?.gameMessages ?? []).filter(m => m.type === 0 && (m.observationId ?? m.tick) > cursor && (!re || re.test(m.text))).map(m => m.text);
}

/**
 * A click's game-message reply matching `re`: call it just before sending the click. It takes the
 * messageCursor then, so `seen` (a predicate for the state it is given) and `first` (the live
 * state) see only replies published since, on both clients.
 */
export function replyAfter(src: Pick<StateSource, 'getState'>, re: RegExp): { seen: (s: BotWorldState) => boolean; first: () => string | undefined } {
    const cursor = messageCursor(src);
    return { seen: s => messagesAfter(s, cursor, re).length > 0, first: () => messagesAfter(src, cursor, re)[0] };
}

export interface TileCounter {
    /** Tiles stepped since the counter started. */
    readonly tiles: number;
    stop(): void;
}

/**
 * Count the tiles the player actually steps: the Chebyshev move between
 * consecutive published states on one level. A jump longer than `maxStep`
 * (default 2, the run speed) is a teleport or a forced move, not walking.
 */
export function tileCounter(sdk: StateSource, maxStep = 2): TileCounter {
    let last = pos(sdk);
    let tiles = 0;
    const stop = sdk.onStateUpdate(s => {
        const p = pos(s);
        if (p.level === last.level) {
            const d = chebyshev(p, last);
            if (d <= maxStep) tiles += d;
        }
        last = p;
    });
    return {
        get tiles() {
            return tiles;
        },
        stop,
    };
}

/** Tiles along a list of waypoints from `from` (Chebyshev per leg). */
export function routeTiles(from: { x: number; z: number }, waypoints: ReadonlyArray<{ x: number; z: number }>): number {
    let t = 0;
    let p = from;
    for (const w of waypoints) {
        t += chebyshev(p, w);
        p = w;
    }
    return t;
}

export type ConfigKind = 'npc' | 'loc' | 'obj' | 'seq' | 'interface';

const PACK_DIR = join(import.meta.dir, '..', '..', 'server', 'content', 'pack');
const packCache = new Map<ConfigKind, Map<string, number>>();

/**
 * Debug name to config id, from server/content/pack/<kind>.pack. Address
 * quest NPCs, locs and objs by debug name when several share a display name
 * (the three Students at the Digsite).
 */
export function configIds(kind: ConfigKind): Map<string, number> {
    let m = packCache.get(kind);
    if (!m) {
        m = new Map();
        for (const line of readFileSync(join(PACK_DIR, `${kind}.pack`), 'utf8').split('\n')) {
            const i = line.indexOf('=');
            if (i > 0) m.set(line.slice(i + 1).trim(), parseInt(line.slice(0, i), 10));
        }
        packCache.set(kind, m);
    }
    return m;
}

export function configId(kind: ConfigKind, name: string): number {
    const id = configIds(kind).get(name);
    if (id === undefined) throw new Error(`unknown ${kind} config name ${name}`);
    return id;
}
