// Haunted Mine, scored-account route, measured segment by segment (lab only).
//
//   bun docs/speedrun/scripts/quest-hauntedmine-run.ts <botname> [--from=<phase>] [--to=<phase>]
//       [--stats=<n>] [--style=melee|magic] [--food=<sharks>] [--diag]
//
// Phases: zealot, enter, mush, cart, exit, endcart, lift, stairs, boss, reward.
// --from sets up the quest varps, inventory and position for that phase with
// staff commands, so any phase can be re-measured on its own. --stats sets
// Attack/Strength/Defence/Hitpoints (default 70), and Magic with
// --style=magic (Crumble Undead, runes given at the fight); a rune scimitar
// and --food sharks (default 20) are given. --diag stops a stalled Treus
// Dayth fight early and prints what blocks it.
//
// Results and the reasoning behind each workaround: docs/speedrun/quests/haunted_mine.md.
//
// Known lab-only step: the cart puzzle's lever state is read with ::getvar
// (a production bot has no staff access; see haunted_mine.md for the
// no-information protocol and its cost). That read is outside the timed
// segments.
//
// A segment runs from its begin to the tick it is ended. Its `tiles` are the
// tiles actually stepped; the note's "path tiles" are the planned route
// lengths (SDK path to each target) this script has always reported.

import type { BotSDK } from '../../../sdk';
import { runScript } from '../../../sdk/runner';
import { initPathfinding } from '../../../sdk/pathfinding';
import type { BotWorldState, NearbyLoc, NearbyNpc } from '../../../sdk/types';
import * as rsmod from '../../../server/vendor/rsmod-pathfinder';
import { CollisionType } from '../../../server/vendor/rsmod-pathfinder';
import { act, openDoor, talkTo, wield } from '../../../speedrun/lib/act';
import { fight, Upkeep } from '../../../speedrun/lib/combat';
import { converse } from '../../../speedrun/lib/converse';
import { currentTick, nextTick, waitTicks, waitUntil, type Pred } from '../../../speedrun/lib/wait';
import { chebyshev, findLoc, findNpc, invItem, locMatches, messagesSince, pos, routeTiles, skillXp, stateOf, worn, type LocQuery, type NamePattern, type StateLike } from '../../../speedrun/lib/world';
import { cheat, clearInventory, getvar, give, mustTele, setStats, setvar } from '../../../speedrun/lab/setup';
import { Recorder } from '../../../speedrun/lab/record';

type Sdk = BotSDK;

const PHASES = ['zealot', 'enter', 'mush', 'cart', 'exit', 'endcart', 'lift', 'stairs', 'boss', 'reward'] as const;
type Phase = (typeof PHASES)[number];

const arg = (k: string, d: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const FROM = arg('from', 'zealot') as Phase;
const TO = arg('to', 'reward') as Phase;
const STATS = parseInt(arg('stats', '70'), 10);
// --style=magic fights Treus Dayth with Crumble Undead (Magic set to --stats)
const STYLE = arg('style', 'melee') as 'melee' | 'magic';
const FOOD = parseInt(arg('food', '20'), 10); // sharks
const CRUMBLE_UNDEAD = 1171; // magic:crumble_undead

// hauntedmine_bits
const BIT = { b: 1, a: 2, c: 3, d: 4, e: 5, i: 6, j: 7, k: 8, endcartFungus: 9, heardAboutKey: 10, puzzleStarted: 21 };
const LEVERS: Record<number, [number, number]> = { 1: [2785, 4517], 2: [2784, 4517], 3: [2786, 4517], 4: [2786, 4515], 5: [2785, 4515], 6: [2768, 4533], 7: [2769, 4533], 8: [2770, 4533] };
// success path needs b=1, a=1, c=0, d=0, j=0 (hauntedmine_points.rs2:20-29)
const WANT: Record<number, 0 | 1> = { 1: 1, 2: 1, 3: 0, 4: 0, 7: 0 };

const has = (s: StateLike, re: RegExp) => invItem(s, re) !== null;
const on = (x: number, z: number): Pred => s => pos(s).x === x && pos(s).z === z;
const lastMessages = (sdk: Sdk, n = 3) => messagesSince(sdk, 0).slice(-n).join(' | ');

async function energy(sdk: Sdk) {
    await cheat(sdk, '~energy', 1);
}

/** A varp through ::getvar (lab only); throws when the server does not reply. */
async function varp(sdk: Sdk, name: string): Promise<number> {
    const v = await getvar(sdk, name);
    if (v === null) throw new Error(`getvar ${name}: no reply`);
    return v;
}

/** The SDK path length to (x, z), -1 when there is none. */
function pathTiles(sdk: Sdk, x: number, z: number): number {
    const r = sdk.findPath(x, z, 2000);
    return r.success ? routeTiles(pos(sdk), r.waypoints) : -1;
}

function addPath(S: Recorder, tiles: number): void {
    if (S.cur) S.cur.pathTiles = Number(S.cur.pathTiles ?? 0) + Math.max(0, tiles);
}

/** End the open segment now (not at its last dialogue), noting its planned path tiles. */
function endSeg(S: Recorder): void {
    if (!S.cur) return;
    S.note(`path tiles ${Number(S.cur.pathTiles ?? 0)}`);
    S.mark();
    S.end();
}

/**
 * The loc matching `name` (a config id or a name pattern) nearest to `at`.
 * The published loc list covers 15 tiles and can hold a nearer namesake (the
 * tunnel just crawled out of), so a match more than 3 tiles from `at` sends
 * us to a scan of `radius` tiles.
 */
async function locNear(sdk: Sdk, name: NamePattern, at: [number, number], radius = 40): Promise<NearbyLoc | null> {
    const near = { x: at[0], z: at[1] };
    const q: LocQuery = { ...(typeof name === 'number' ? { id: name } : { name }), near, radius };
    const l = await findLoc(sdk, q);
    if (l && chebyshev(l, near) <= 3) return l;
    const scanned = (await sdk.scanNearbyLocs(radius)).filter(x => locMatches(x, q)).sort((a, b) => chebyshev(a, near) - chebyshev(b, near))[0];
    return scanned ?? l;
}

/** op a loc found near a coordinate, logging path length; waits for `done`. */
async function opLoc(sdk: Sdk, S: Recorder, name: NamePattern, at: [number, number], op: number, done: Pred, timeout = 120) {
    const loc = await locNear(sdk, name, at);
    if (!loc) throw new Error(`no loc ${name} near ${at}`);
    addPath(S, pathTiles(sdk, loc.x, loc.z));
    await sendUntil(sdk, S, () => sdk.sendInteractLoc(loc.x, loc.z, loc.id, op), done, timeout, `op ${op} on ${loc.name}@${loc.x},${loc.z}`);
}

/**
 * Send an op and wait for `done`. An op sent while a previous script still
 * holds the player (exactmove, p_delay) is dropped silently, so resend when
 * the player has not moved for 3 ticks with no dialogue open.
 */
async function sendUntil(sdk: Sdk, S: Recorder, send: () => Promise<unknown>, done: Pred, timeout: number, what: string) {
    const r = await act(sdk, send, done, { maxTicks: timeout, resendEvery: 3, maxResends: 40 });
    if (r.resends) S.note(`${what}: resent ${r.resends}x`);
    if (!r.ok) throw new Error(`${what} did not complete; at ${JSON.stringify(pos(sdk))}; ${lastMessages(sdk)}`);
}

/**
 * Cart 1 patrols x=2727 between z=4491 and z=4509 with 3-tick stops
 * (hauntedmine.npc, hauntedmine_cart1), and that track is the only corridor
 * between the ladders at (2734,4503) and (2725,4486). Start the run when the
 * cart is north of the junction and heading north (or parked at the north
 * end): it cannot come back past z=4503 for at least 9 ticks.
 */
//
// The corridor is one tile wide (walls on both sides of x=2727) with two
// dead-end alcoves: (2728,4503) and (2726,4496). The cart pushes anyone on
// the tile ahead of it back one tile (hauntedmine_cart.rs2), so the crossing
// is: get into the alcove that lies between you and the cart, let it pass,
// then run the rest of the corridor behind it.
const ALCOVE_N: [number, number] = [2728, 4503];
const ALCOVE_S: [number, number] = [2726, 4496];

function cart1(s: StateLike): number | null {
    const c = (stateOf(s)?.nearbyNpcs ?? []).find(n => /mine cart/i.test(n.name) && (n.tileX ?? n.x) === 2727);
    return c ? (c.tileZ ?? c.z) : null;
}

async function cart1Dir(sdk: Sdk): Promise<{ z: number; dir: number }> {
    const a = cart1(sdk);
    const b = cart1(await nextTick(sdk));
    if (a === null || b === null) return { z: b ?? a ?? 0, dir: 0 };
    // parked at an end: it will head back
    const dir = b !== a ? Math.sign(b - a) : b >= 4509 ? -1 : b <= 4491 ? 1 : 0;
    return { z: b, dir };
}

async function crossTrack(sdk: Sdk, S: Recorder, heading: 'south' | 'north') {
    const t0 = currentTick(sdk);
    // southbound enters at the north end (z 4509), northbound at the south end (z 4489)
    let alcove: [number, number] | null = null;
    while (!alcove && currentTick(sdk) - t0 < 80) {
        const { z, dir } = await cart1Dir(sdk);
        // The alcove is 7-8 tiles (4 ticks running) from the corridor end; the
        // cart moves 1 tile per tick, so a head-on cart must be at least 6
        // tiles short of the alcove when we set off.
        if (heading === 'south') {
            if (dir > 0 && z <= 4496) alcove = ALCOVE_N; // coming at us: duck at 4503 first
            else if (dir < 0 && z <= 4507) alcove = ALCOVE_S; // going away: follow, duck at 4496
        } else {
            if (dir < 0 && z >= 4503) alcove = ALCOVE_S; // coming at us: duck at 4496 first
            else if (dir > 0 && z >= 4493) alcove = ALCOVE_N; // going away: follow, duck at 4503
        }
    }
    const waitedEntry = currentTick(sdk) - t0;
    if (!alcove) throw new Error('cart 1 never gave an opening');
    const [ax, az] = alcove;
    await sdk.sendWalk(ax, az, true);
    const t1 = currentTick(sdk);
    // wait in the alcove until the cart has gone past it, away from our exit
    const passed = (s: BotWorldState) => {
        const z = cart1(s);
        if (z === null) return true;
        return heading === 'south' ? z > az : z < az;
    };
    const trace: string[] = [];
    const inAlcove = (s: BotWorldState) => {
        const p = pos(s);
        trace.push(`${s.tick}: me ${p.x},${p.z} cart ${cart1(s)}`);
        return p.x === ax && p.z === az;
    };
    if (!(await waitUntil(sdk, inAlcove, { maxTicks: 30 })).ok) throw new Error(`never reached alcove ${alcove}:\n${trace.join('\n')}`);
    const t2 = currentTick(sdk);
    await waitUntil(sdk, passed, { maxTicks: 60 });
    const t3 = currentTick(sdk);
    S.note(`cart 1 (${heading}): entry wait ${waitedEntry}, to alcove ${t2 - t1}, alcove wait ${t3 - t2}, alcove ${alcove.join(',')}`);
}

/**
 * Cart 4 patrols x=2739 between z=4528 and z=4531, parking 4 ticks at each
 * end (14-tick cycle), and that track is the only way from the end-cart
 * ladder to the lift-area ladder (2732,4529). Coming from the north the run
 * needs track tiles 4531..4529 and steps off west at (2738,4528): 2 ticks.
 * Go the tick the cart arrives at its south end; it then sits for 3 more.
 */
async function crossCart4(sdk: Sdk, S: Recorder) {
    const STAGE: [number, number] = [2739, 4532];
    addPath(S, pathTiles(sdk, STAGE[0], STAGE[1]));
    await sdk.sendWalk(STAGE[0], STAGE[1], true);
    if (!(await waitUntil(sdk, on(STAGE[0], STAGE[1]), { maxTicks: 40 })).ok) throw new Error(`did not reach cart 4 staging tile; at ${JSON.stringify(pos(sdk))}`);
    const cart4 = (s: StateLike) => {
        const c = (stateOf(s)?.nearbyNpcs ?? []).find(n => /mine cart/i.test(n.name) && n.x === 2739 && n.z >= 4528 && n.z <= 4531);
        return c ? c.z : null;
    };
    const t0 = currentTick(sdk);
    let prev = cart4(sdk);
    while (currentTick(sdk) - t0 < 30) {
        const z = cart4(await nextTick(sdk));
        if (z === 4528 && prev !== null && prev > 4528) break;
        prev = z;
    }
    const t1 = currentTick(sdk);
    // (2738,4529) is reachable only down the track, and from it the ladder
    // route leaves via (2738,4528), never the cart's parking tile (2739,4528).
    addPath(S, 4);
    await sdk.sendWalk(2738, 4529, true);
    if (!(await waitUntil(sdk, on(2738, 4529), { maxTicks: 15 })).ok) throw new Error(`cart 4 crossing failed; at ${JSON.stringify(pos(sdk))}`);
    S.note(`cart 4 wait ${t1 - t0}, crossing ${currentTick(sdk) - t1}`);
}

/**
 * Route around NPCs. The boss room's loading cranes (size 3) and mine carts
 * are blockwalk NPCs, which neither the SDK path nor the lite client's click
 * route knows about; a walk whose first step is a parked cart goes nowhere.
 * Breadth-first search on static collision with NPC tiles blocked, returning
 * the tile path (excluding the start), or null.
 */
function npcAwarePath(sdk: Sdk, goals: { x: number; z: number }[] | ((x: number, z: number) => boolean), ignore?: number): { x: number; z: number }[] | null {
    initPathfinding();
    const blocked = new Set<string>();
    for (const n of sdk.getNearbyNpcs()) {
        if (n.index === ignore) continue;
        if (/loading crane/i.test(n.name)) for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) blocked.add(`${n.x + i},${n.z + j}`);
        else if (/mine cart|treus|^ghost$/i.test(n.name)) blocked.add(`${n.x},${n.z}`);
    }
    const start = pos(sdk);
    const goalSet = Array.isArray(goals) ? new Set(goals.map(g => `${g.x},${g.z}`)) : null;
    const isGoal = (x: number, z: number) => (goalSet ? goalSet.has(`${x},${z}`) : (goals as (x: number, z: number) => boolean)(x, z));
    const prev = new Map<string, string>([[`${start.x},${start.z}`, '']]);
    const q: [number, number][] = [[start.x, start.z]];
    const D = [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;
    while (q.length) {
        const [x, z] = q.shift()!;
        if (isGoal(x, z)) {
            const out: { x: number; z: number }[] = [];
            let k = `${x},${z}`;
            while (prev.get(k)) { const [a, b] = k.split(',').map(Number); out.push({ x: a!, z: b! }); k = prev.get(k)!; }
            return out.reverse();
        }
        for (const [dx, dz] of D) {
            const nx = x + dx, nz = z + dz, k = `${nx},${nz}`;
            if (prev.has(k) || blocked.has(k) || Math.abs(nx - start.x) > 30 || Math.abs(nz - start.z) > 30) continue;
            if (dx && dz && (blocked.has(`${x + dx},${z}`) || blocked.has(`${x},${z + dz}`))) continue;
            if (!rsmod.canTravel(start.level, x, z, dx, dz, 1, 0, CollisionType.NORMAL)) continue;
            prev.set(k, `${x},${z}`);
            q.push([nx, nz]);
        }
    }
    return null;
}

// Boss-room cart track zones (hauntedmine_boss_ghost.rs2:136-142, local
// 43_69 coords): standing in one makes the boss send that track's cart at us,
// which moves carts into the room's corridors.
const CART_ZONES: [number, number, number, number][] = [
    [30, 40, 32, 40], [31, 30, 31, 37], [33, 31, 33, 36], [39, 31, 39, 36], [41, 30, 41, 37], [39, 40, 42, 40], [29, 46, 43, 46]
].map(([a, b, c, d]) => [2752 + a!, 4416 + b!, 2752 + c!, 4416 + d!]);
const inCartZone = (x: number, z: number) => CART_ZONES.some(([x1, z1, x2, z2]) => x >= x1 && x <= x2 && z >= z1 && z <= z2);

/**
 * Tiles a cart can never cut off: reachable from the hub (2788,4454) with
 * every cart-zone tile, every tile a cart has been seen on, and the cranes
 * blocked. Standing outside this region is how a bot gets shut in a pocket
 * by a parked cart while the boss keeps hitting it.
 */
function safeRegion(sdk: Sdk, cartSeen: Set<string>): Set<string> {
    initPathfinding();
    const blocked = new Set<string>(cartSeen);
    for (const n of sdk.getNearbyNpcs()) {
        if (/loading crane/i.test(n.name)) for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) blocked.add(`${n.x + i},${n.z + j}`);
        if (/mine cart/i.test(n.name)) blocked.add(`${n.x},${n.z}`);
    }
    for (const [x1, z1, x2, z2] of CART_ZONES) for (let x = x1; x <= x2; x++) for (let z = z1; z <= z2; z++) blocked.add(`${x},${z}`);
    const seen = new Set<string>(['2788,4454']);
    const q: [number, number][] = [[2788, 4454]];
    while (q.length) {
        const [x, z] = q.shift()!;
        for (const [dx, dz] of [[0, 1], [1, 0], [0, -1], [-1, 0]] as const) {
            const nx = x + dx, nz = z + dz, k = `${nx},${nz}`;
            if (seen.has(k) || blocked.has(k) || Math.abs(nx - 2788) > 16 || Math.abs(nz - 4454) > 18) continue;
            if (!rsmod.canTravel(0, x, z, dx, dz, 1, 0, CollisionType.NORMAL)) continue;
            seen.add(k);
            q.push([nx, nz]);
        }
    }
    return seen;
}

/**
 * A tile to cast from: in range, line of sight, out of every cart zone. The
 * loading cranes (size-3 NPCs) block the server's line of sight although the
 * static collision does not show it, so the straight line must also miss
 * every crane footprint.
 */
let craneTiles = new Set<string>();

/**
 * Casting tile per boss spot, from casts that landed in lab runs (the boss's
 * six spots: hauntedmine_boss_move). Null when the spot is not recognised.
 */
function tableCastTile(bx: number, bz: number): [number, number] | null {
    if (bz <= 4446) return [2786, 4446]; // s5, south
    if (bx >= 2793 && bz <= 4453) return [2789, 4454]; // s0, east
    if (bx >= 2795 && bz >= 4458) return [2796, 4454]; // s1, north-east
    if (bz >= 4462 && bx >= 2786 && bx <= 2790) return [2787, 4461]; // s2, north
    if (bx <= 2781 && bz >= 4458) return [2779, 4457]; // s3, north-west
    if (bx <= 2782 && bz >= 4453 && bz <= 4456) return [2780, 4457]; // s4, west
    return null;
}
function lineClearOfCranes(x0: number, z0: number, x1: number, z1: number) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0)) * 4;
    for (let i = 1; i < n; i++) {
        const x = Math.round(x0 + ((x1 - x0) * i) / n), z = Math.round(z0 + ((z1 - z0) * i) / n);
        if (craneTiles.has(`${x},${z}`)) return false;
    }
    return true;
}
function castTile(bx: number, bz: number) {
    return (x: number, z: number) =>
        Math.max(Math.abs(x - bx), Math.abs(z - bz)) <= 8 && !inCartZone(x, z) && !craneTiles.has(`${x},${z}`) &&
        rsmod.hasLineOfSight(0, x, z, bx, bz, 1, 1, 1, 1, 0) && lineClearOfCranes(x, z, bx, bz);
}

/** Walk an npc-aware path in short hops (each hop's own route then matches it). */
async function walkHops(sdk: Sdk, path: { x: number; z: number }[], hop = 4): Promise<boolean> {
    for (let i = Math.min(hop, path.length) - 1; i < path.length; i = Math.min(i + hop, path.length - 1)) {
        const t = path[i]!;
        await sdk.sendWalk(t.x, t.z, true);
        const r = await waitUntil(sdk, on(t.x, t.z), { maxTicks: Math.ceil(hop / 2) + 3 });
        if (!r.ok) return false;
        if (i === path.length - 1) break;
    }
    return true;
}

const inMap = (s: StateLike, mx: number, mz: number) => {
    const p = pos(s);
    return p.x >> 6 === mx && p.z >> 6 === mz;
};

async function setup(sdk: Sdk, phase: Phase) {
    await setStats(sdk, { attack: STATS, strength: STATS, defence: STATS, hitpoints: STATS, ...(STYLE === 'magic' ? { magic: STATS } : {}) });
    await clearInventory(sdk);
    await give(sdk, 'chisel');
    if (!worn(sdk, /rune scimitar/i)) await give(sdk, 'rune_scimitar');
    await give(sdk, 'shark', FOOD);
    if (invItem(sdk, /rune scimitar/i)) await wield(sdk, /rune scimitar/i);
    const idx = PHASES.indexOf(phase);
    const stage = idx <= 0 ? 0 : idx <= 5 ? 3 : idx === 6 ? 3 : idx === 7 ? 5 : idx === 8 ? 7 : 9;
    let bits = 0;
    if (idx >= 1) bits |= 1 << BIT.heardAboutKey;
    if (idx === 5) bits |= 1 << BIT.endcartFungus;
    await setvar(sdk, 'hauntedmine', stage);
    await setvar(sdk, 'hauntedmine_bits', bits);
    if (idx >= 1 && idx <= 6 && !has(sdk, /zealot's key/i)) await give(sdk, 'hauntedmine_lift_key');
    if ((idx === 6 || idx === 7) && !has(sdk, /glowing fungus/i)) await give(sdk, 'glowing_fungus');
    if (idx === 9 && !has(sdk, /^key$/i)) await give(sdk, 'hauntedmine_reward_key');
    const start: Record<Phase, [number, number]> = {
        zealot: [3444, 3256], enter: [3446, 3256], mush: [2789, 4487], cart: [2778, 4508], exit: [2770, 4520],
        endcart: [3429, 3227], lift: [2774, 4539], stairs: [2725, 4452], boss: [2811, 4454], reward: [2788, 4454]
    };
    await mustTele(sdk, start[phase][0], start[phase][1]);
    if (phase === 'cart' && !has(sdk, /glowing fungus/i)) await give(sdk, 'glowing_fungus');
    if (phase === 'exit') await setvar(sdk, 'hauntedmine_bits', (1 << BIT.heardAboutKey) | (1 << BIT.endcartFungus));
    await energy(sdk);
    await waitTicks(sdk, 2);
}

/** The Treus Dayth fight, one `combat.fight` per stretch the boss stands in view and attackable. */
async function fightTreus(sdk: Sdk, S: Recorder) {
    const t0 = currentTick(sdk);
    const LIMIT = 1500;
    // The boss fades (type change to "Ghost", no Attack op) and runs to
    // another part of the room on half of the hits it takes
    // (hauntedmine_boss_ghost.rs2 ai_queue1). The type change drops the
    // player's attack, while the client keeps facing it, so the combat
    // target in the bot state is no evidence of attacking: re-click
    // whenever it is attackable and we have not swung for 5 ticks. Each
    // fight therefore ends when Treus Dayth leaves view or fades, and the
    // attack decisions are this script's (`attackNow`), not the loop's own
    // re-attack timers.
    // (2788,4454): the fight's start tile, reachable from every spot,
    // within 10 tiles of all six boss spots, and in the 35_35 crane's
    // zone, so the boss uses the crane attack (max 10) rather than the
    // pickaxe (max 15) on us.
    const IDLE: [number, number] = [2788, 4454];
    if (STYLE === 'magic') {
        await give(sdk, ['airrune', 'earthrune'], 500);
        await give(sdk, 'chaosrune', 200);
    }
    const skill = STYLE === 'magic' ? 'magic' : 'attack';
    const xp0 = skillXp(sdk, skill);
    const msgs0 = sdk.getState()?.gameMessages.length ?? 0;
    let msgSeen = msgs0;
    let swings = 0, moves = 0, approaches = 0, approachTiles = 0, levelUpPages = 0, stalls = 0, castsNoXp = 0, fights = 0;
    let wasVisible = true, died = false, diagStop = false;
    let lastXpTick = t0, lastXp = skillXp(sdk, 'magic'), lastSwing = t0, lastClick = -99, nextLog = t0;
    const badTiles = new Set<string>();
    const cartSeen = new Set<string>();
    const hpLog: string[] = [];
    // Its attacks need no line of sight, so eat whether or not it is in view.
    const FOOD_OPTS = { eatBelow: 31, food: /shark/i };
    const idleUpkeep = new Upkeep(sdk, FOOD_OPTS);
    let fightEats = 0;
    const treus = (s: StateLike) => findNpc(s, /treus dayth/i);
    const killSeen = (s: BotWorldState) => messagesSince(s, t0, /killing strike/i).length > 0 || /killing strike/i.test(s.dialog.text ?? '');

    /** Per tick: swing tracking, the hp/boss log every 25 ticks, and --diag. */
    const observe = async (s: BotWorldState) => {
        const me = s.player;
        if (!me) return;
        if (me.animId !== -1) lastSwing = s.tick;
        if (s.tick < nextLog) return;
        nextLog = s.tick + 25;
        const b = treus(s) ?? findNpc(s, /^ghost$/i);
        const msgs = s.gameMessages.slice(msgSeen).map(m => m.text).filter(t => !/heals some|eat the/i.test(t));
        msgSeen = s.gameMessages.length;
        const near = s.nearbyNpcs.filter(n => Math.max(Math.abs(n.x - me.worldX), Math.abs(n.z - me.worldZ)) <= 6 && !/treus/i.test(n.name)).map(n => `${n.name}@${n.x},${n.z}`);
        hpLog.push(`${s.tick - t0}:${me.hp}/${b ? `${b.name}@${b.x},${b.z} ${b.healthPercent ?? '?'}%` : 'none'} me@${me.worldX},${me.worldZ}${msgs.length ? ` msgs[${msgs.join('; ')}]` : ''}${near.length ? ` npcs[${near.join(' ')}]` : ''}`);
        const bb = treus(s);
        if (process.argv.includes('--diag') && bb && Math.abs(bb.x - me.worldX) + Math.abs(bb.z - me.worldZ) > 1 && s.tick - lastSwing >= 25) {
            console.log(`DIAG stuck at ${me.worldX},${me.worldZ}; boss@${bb.x},${bb.z}; npcs ${s.nearbyNpcs.map(n => `${n.name}@${n.x},${n.z}`).join(' ')}`);
            for (const [dx, dz] of [[0, 1], [1, 0], [-1, 0], [0, -1]] as const) {
                const r = sdk.findPath(bb.x + dx, bb.z + dz, 500);
                const res = await sdk.sendWalk(bb.x + dx, bb.z + dz, true);
                const tr: string[] = [];
                for (let i = 0; i < 8; i++) { await waitTicks(sdk, 1); tr.push(`${pos(sdk).x},${pos(sdk).z}`); }
                console.log(`DIAG walk ${bb.x + dx},${bb.z + dz}: path ${r.success} ${JSON.stringify(r.waypoints)} send ${JSON.stringify(res)} trace ${tr.join(' ')}`);
            }
            diagStop = true;
        }
    };

    /**
     * Move for the next attack and say whether to send it now. Magic: a cast
     * tile in range and line of sight (a tile where two casts earned no xp is
     * struck off for this boss position), back to the hub after 40 ticks
     * without xp, one cast per 5 ticks. Melee: when it reappears or we have
     * not swung for 5 ticks, walk next to it on the npc-aware path first (the
     * lite client's click route fails on the cranes and carts), then attack.
     */
    const attackNow = async (s: BotWorldState, boss: NearbyNpc, reappeared: boolean): Promise<boolean> => {
        const p = pos(s);
        if (STYLE === 'magic') {
            // The SDK's line of sight can disagree with the server's.
            const xpNow = skillXp(s, 'magic');
            if (xpNow > lastXp) { lastXp = xpNow; castsNoXp = 0; lastXpTick = s.tick; }
            const bossKey = `${boss.x},${boss.z}`;
            if (castsNoXp >= 2) { badTiles.add(`${bossKey}>${p.x},${p.z}`); castsNoXp = 0; }
            for (const n of s.nearbyNpcs) {
                if (/mine cart/i.test(n.name)) cartSeen.add(`${n.x},${n.z}`);
                if (/loading crane/i.test(n.name)) for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) craneTiles.add(`${n.x + i},${n.z + j}`);
            }
            const safe = safeRegion(sdk, cartSeen);
            const okAny = (x: number, z: number) => castTile(boss.x, boss.z)(x, z) && !badTiles.has(`${bossKey}>${x},${z}`);
            const okSafe = (x: number, z: number) => safe.has(`${x},${z}`) && okAny(x, z);
            const learned = [...safe].some(k => { const [x, z] = k.split(',').map(Number); return okAny(x!, z!); }) ? okSafe : okAny;
            const tt = tableCastTile(boss.x, boss.z);
            const ok = tt && !badTiles.has(`${bossKey}>${tt[0]},${tt[1]}`) ? (x: number, z: number) => x === tt[0] && z === tt[1] : learned;
            // stalled with no xp for 40 ticks: back to the hub, forget
            if (s.tick - lastXpTick > 40) {
                lastXpTick = s.tick;
                badTiles.clear();
                stalls++;
                const home = npcAwarePath(sdk, [{ x: IDLE[0], z: IDLE[1] }]);
                if (home) await walkHops(sdk, home);
                return false;
            }
            if (!ok(p.x, p.z)) {
                const path = npcAwarePath(sdk, ok, boss.index);
                approaches++;
                if (path) {
                    approachTiles += path.length;
                    await walkHops(sdk, path);
                }
                return false;
            }
            if (!(reappeared || s.tick - lastClick >= 5)) return false;
            castsNoXp++;
            lastClick = s.tick;
            return true;
        }
        if (!(reappeared || (s.tick - lastSwing >= 5 && s.tick - lastClick >= 3))) return false;
        if (Math.abs(p.x - boss.x) + Math.abs(p.z - boss.z) !== 1) {
            const goals = ([[0, 1], [1, 0], [-1, 0], [0, -1]] as const)
                .map(([dx, dz]) => ({ x: boss.x + dx, z: boss.z + dz }))
                .filter(g => rsmod.canTravel(0, g.x, g.z, boss.x - g.x, boss.z - g.z, 1, 0, CollisionType.NORMAL));
            const path = npcAwarePath(sdk, goals, boss.index);
            approaches++;
            if (path) {
                approachTiles += path.length;
                await walkHops(sdk, path);
            }
        }
        lastClick = currentTick(sdk);
        return true;
    };

    while (currentTick(sdk) - t0 < LIMIT && !diagStop) {
        const s = sdk.getState();
        if (!s?.player) throw new Error('no state in the Treus Dayth fight');
        if (killSeen(s)) break;
        if (s.dialog.isOpen) {
            // A dialogue the fight loop stopped on (level-ups it dismisses itself).
            const d = await converse(sdk, [], { idle: 0, openTicks: 0 });
            // the kill's mesbox text is not always in the dialog state;
            // the stage is the ground truth (9 = boss defeated)
            if (d.transcript.some(t => /killing strike|machinery/i.test(t)) || (await varp(sdk, 'hauntedmine')) >= 9) {
                S.dialogue(d);
                break;
            }
            levelUpPages += d.pages + d.levelUps;
            continue;
        }
        if (messagesSince(s, t0, /you are dead/i).length) { died = true; break; }
        idleUpkeep.step(s);
        await observe(s);
        if (diagStop) break;
        const boss = treus(s);
        if (!boss) {
            if (wasVisible) moves++;
            wasVisible = false;
            // The room is ~31 tiles north-south and the boss's six spots
            // lie at its edges, past the 15-tile NPC view from the far
            // side; its attacks need no line of sight. Wait near the
            // centre (36_40 is on its run path, so stand at 34_42).
            const ghost = findNpc(s, /^ghost$/i);
            if (!ghost && !on(IDLE[0], IDLE[1])(s) && s.tick - lastClick >= 3) {
                await sdk.sendWalk(IDLE[0], IDLE[1], true);
                lastClick = s.tick;
            }
            await nextTick(sdk, s.tick);
            continue;
        }
        const reappeared = !wasVisible;
        wasVisible = true;
        if (!(await attackNow(s, boss, reappeared))) {
            await nextTick(sdk, s.tick);
            continue;
        }
        fights++;
        const f = await fight(sdk, boss, {
            ...(STYLE === 'magic' ? { spell: CRUMBLE_UNDEAD, castEvery: Infinity } : { reattackAfter: Infinity }),
            ...FOOD_OPTS,
            maxTicks: Math.max(1, LIMIT - (currentTick(sdk) - t0)),
            done: st => killSeen(st) || !treus(st) || diagStop,
            onTick: async (st, npc) => {
                await observe(st);
                return !diagStop && npc !== null && attackNow(st, npc, false);
            },
        });
        swings += f.attacks;
        fightEats += f.eats;
        levelUpPages += f.levelUps;
        if (f.died) { died = true; break; }
    }
    // melee: 4 xp per damage at 25x; magic: game xp gained, reported raw
    const gained = skillXp(sdk, skill) - xp0;
    const dealt = STYLE === 'magic' ? `${gained} magic xp` : Math.round(gained / 100);
    S.note(`attack clicks ${swings} in ${fights} fights, approach walks ${approaches} (${approachTiles} tiles), level-up pages ${levelUpPages}, struck-off tiles ${badTiles.size}, stalls ${stalls}, fade-outs ${moves}, sharks ${fightEats + idleUpkeep.eats}, damage dealt ~${dealt}, hp left ${sdk.getState()?.player?.hp}${died ? ', DIED' : ''}; hp/boss% ${hpLog.join(' ')}`);
    S.dialogue(await converse(sdk, [], { idle: 1, openTicks: 1 }));
}

const phases: Record<Phase, (sdk: Sdk, S: Recorder) => Promise<void>> = {
    async zealot(sdk, S) {
        S.begin('zealot: start quest, ask about the key, pickpocket');
        const z = findNpc(sdk, /zealot/i);
        if (!z) throw new Error('no zealot in view');
        addPath(S, pathTiles(sdk, z.x, z.z) - 1);
        // Stop on the page that offers the second entrance, with the dialogue open.
        const d = await talkTo(sdk, z, ['Saradomin', 'seeking challenges', 'What quest is that', 'other way into the mines'], { openTicks: 30, idle: 2, unmatched: 'stop' });
        S.dialogue(d);
        if (d.remaining.length || !/second entrance/i.test(d.reason ?? '')) throw new Error(`zealot dialogue ended early: ${d.reason ?? 'closed'}; ${d.remaining.length} choices left`);
        const z2 = findNpc(sdk, /zealot/i);
        if (!z2) throw new Error('zealot gone');
        await sdk.sendInteractNpc(z2.index, 3);
        if (!(await waitUntil(sdk, s => has(s, /key/i), { maxTicks: 30 })).ok) throw new Error('pickpocket failed');
        endSeg(S);
    },

    async enter(sdk, S) {
        // The zealot's side of the ridge reaches the cart tunnel only over the
        // obstacle cart; the back entrances share a ledge reachable only from
        // inside the mine (collision map, see haunted_mine.md).
        S.begin('zealot -> obstacle cart -> cart tunnel (sets stage 3)');
        const before = pos(sdk);
        await opLoc(sdk, S, /mine cart/i, [3445, 3236], 1, s => { const p = pos(s); return p.z <= 3235 || (p.x < 3445 && p.z < 3240); }, 120);
        await waitTicks(sdk, 1);
        S.note(`cart crossing ${before.x},${before.z} -> ${pos(sdk).x},${pos(sdk).z}`);
        await opLoc(sdk, S, /cart tunnel/i, [3440, 3232], 1, s => pos(s).z > 9000, 120);
        endSeg(S);
        S.begin('main half -> out through back entrance 1 -> in through back entrance 2');
        await opLoc(sdk, S, /cart tunnel/i, [3404, 9631], 1, s => pos(s).z < 4000, 120);
        await opLoc(sdk, S, /cart tunnel/i, [3429, 3225], 1, s => pos(s).z > 9000, 120);
        endSeg(S);
        S.begin('ladders: 53_150 -> 43_71 -> 42_70 -> 43_70 mushroom area');
        await opLoc(sdk, S, /ladder/i, [3422, 9625], 1, s => inMap(s, 43, 71));
        await opLoc(sdk, S, /ladder/i, [2798, 4567], 1, s => inMap(s, 42, 70));
        addPath(S, pathTiles(sdk, 2728, 4510));
        await sdk.sendWalk(2728, 4510, true);
        await waitUntil(sdk, on(2728, 4510), { maxTicks: 30 });
        await crossTrack(sdk, S, 'south');
        await opLoc(sdk, S, /ladder/i, [2725, 4486], 1, s => inMap(s, 43, 70));
        endSeg(S);
    },

    async mush(sdk, S) {
        S.begin('pick glowing fungus');
        await opLoc(sdk, S, /glowing fungus/i, [2791, 4496], 1, s => has(s, /glowing fungus/i), 60);
        endSeg(S);
        S.begin('fungus into the start cart');
        const cart = await locNear(sdk, /mine cart/i, [2778, 4506], 40);
        if (!cart || cart.x !== 2778) throw new Error(`start cart not found: ${JSON.stringify(cart)}`);
        const fungus = invItem(sdk, /glowing fungus/i);
        if (!fungus) throw new Error('no glowing fungus');
        addPath(S, pathTiles(sdk, cart.x, cart.z));
        const t0 = currentTick(sdk);
        await sendUntil(sdk, S, () => sdk.sendUseItemOnLoc(fungus.slot, cart.x, cart.z, cart.id), s => messagesSince(s, t0, /place the glowing fungus|already a load/i).length > 0, 60, 'fungus on start cart');
        endSeg(S);
    },

    async cart(sdk, S) {
        if (FROM === 'cart') {
            const cart = await locNear(sdk, /mine cart/i, [2778, 4506], 40);
            const fungus = invItem(sdk, /glowing fungus/i);
            if (!cart || !fungus) throw new Error('(setup) no start cart or no fungus');
            const t0 = currentTick(sdk);
            await sdk.sendUseItemOnLoc(fungus.slot, cart.x, cart.z, cart.id);
            await waitUntil(sdk, s => messagesSince(s, t0, /place the glowing fungus/i).length > 0, { maxTicks: 60 });
        }
        S.begin('points settings: view (randomises levers on first view)');
        await opLoc(sdk, S, /points settings/i, [2769, 4522], 1, s => !!s.modalOpen, 60);
        endSeg(S);
        await sdk.sendCloseModal();
        const bits = await varp(sdk, 'hauntedmine_bits'); // lab-only read of the randomised lever state
        const pulls = Object.entries(WANT).filter(([b, v]) => ((bits >> Number(b)) & 1) !== v).map(([b]) => Number(b));
        console.log(`lever bits ${bits.toString(2)} -> pull ${pulls.join(',') || 'none'}`);
        S.begin(`pull levers ${pulls.join(',') || 'none'}`);
        S.note(`${pulls.length} pulls`);
        // levers 1-5 sit together; 6-8 are in the northern alcove
        for (const b of pulls.sort((x, y) => (x <= 5 ? 0 : 1) - (y <= 5 ? 0 : 1))) {
            const [x, z] = LEVERS[b]!;
            // detect this pull's own message by position: a tick-based check can
            // match the previous pull's message, and the next click would then
            // replace this pull before it happens
            const m0 = sdk.getState()?.gameMessages.length ?? 0;
            await opLoc(sdk, S, 4949 + b, [x, z], 1, s => s.gameMessages.slice(m0).some(m => /old points creak/i.test(m.text)), 80);
        }
        endSeg(S);
        S.begin('points settings: send the cart (success animation)');
        await opLoc(sdk, S, /points settings/i, [2769, 4522], 1, s => !!s.modalOpen, 80);
        const conv = converse(sdk, [], { openTicks: 40, idle: 1 });
        await sdk.sendClickComponent(11708);
        S.dialogue(await conv);
        endSeg(S);
        await sdk.sendCloseModal();
        const after = await varp(sdk, 'hauntedmine_bits');
        if (!((after >> BIT.endcartFungus) & 1)) throw new Error(`fungus did not reach the end cart; bits ${after.toString(2)}`);
    },

    async exit(sdk, S) {
        await energy(sdk);
        S.begin('mushroom half -> surface (ladders up, crawl out back entrance 2)');
        await opLoc(sdk, S, /ladder/i, [2789, 4486], 1, s => inMap(s, 42, 70));
        addPath(S, pathTiles(sdk, 2726, 4488));
        await sdk.sendWalk(2726, 4488, true);
        await waitUntil(sdk, on(2726, 4488), { maxTicks: 30 });
        await crossTrack(sdk, S, 'north');
        await opLoc(sdk, S, /ladder/i, [2734, 4503], 1, s => inMap(s, 43, 71));
        await opLoc(sdk, S, /ladder/i, [2782, 4569], 1, s => inMap(s, 53, 150));
        await opLoc(sdk, S, /cart tunnel/i, [3408, 9623], 1, s => pos(s).z < 4000);
        endSeg(S);
        S.begin('surface -> back entrance 1 -> lift half, ladder down to the end cart');
        await opLoc(sdk, S, /cart tunnel/i, [3430, 3233], 1, s => pos(s).z > 9000);
        await opLoc(sdk, S, /ladder/i, [3413, 9633], 1, s => inMap(s, 43, 71));
        await opLoc(sdk, S, /ladder/i, [2797, 4599], 1, s => inMap(s, 42, 70));
        await opLoc(sdk, S, /ladder/i, [2710, 4540], 1, s => inMap(s, 43, 70));
        endSeg(S);
    },

    async endcart(sdk, S) {
        if (FROM === 'endcart') {
            S.begin('(setup) back entrance 1 -> end cart');
            await opLoc(sdk, S, /cart tunnel/i, [3430, 3233], 1, s => pos(s).z > 9000);
            await opLoc(sdk, S, /ladder/i, [3413, 9633], 1, s => inMap(s, 43, 71));
            await opLoc(sdk, S, /ladder/i, [2797, 4599], 1, s => inMap(s, 42, 70));
            await opLoc(sdk, S, /ladder/i, [2710, 4540], 1, s => inMap(s, 43, 70));
            endSeg(S);
        }
        S.begin('take the fungus from the end cart');
        const cart = await locNear(sdk, /mine cart/i, [2774, 4537], 20);
        if (!cart) throw new Error('end cart not found');
        addPath(S, pathTiles(sdk, cart.x, cart.z));
        const conv = converse(sdk, ['Take it'], { openTicks: 30, idle: 1 });
        await sdk.sendInteractLoc(cart.x, cart.z, cart.id, 1);
        S.dialogue(await conv);
        if (!(await waitUntil(sdk, s => has(s, /glowing fungus/i), { maxTicks: 20 })).ok) throw new Error('no fungus from end cart');
        endSeg(S);
    },

    async lift(sdk, S) {
        await energy(sdk);
        S.begin('end cart -> lift area (ladder up, walk, ladder down)');
        await opLoc(sdk, S, /ladder/i, [2774, 4540], 1, s => inMap(s, 42, 70));
        await crossCart4(sdk, S);
        await opLoc(sdk, S, /ladder/i, [2732, 4529], 1, s => inMap(s, 43, 70));
        endSeg(S);
        S.begin('use the lift key on the valve');
        const valve = await locNear(sdk, /water valve/i, [2808, 4496], 50);
        const key = invItem(sdk, /key/i);
        if (!valve || !key) throw new Error(`no water valve (${!!valve}) or no key (${!!key})`);
        addPath(S, pathTiles(sdk, valve.x, valve.z));
        const t0 = currentTick(sdk);
        await sdk.sendUseItemOnLoc(key.slot, valve.x, valve.z, valve.id);
        if (!(await waitUntil(sdk, s => messagesSince(s, t0, /open the valve/i).length > 0, { maxTicks: 80 })).ok) throw new Error('valve not opened');
        endSeg(S);
        S.begin('valve -> lift, ride down');
        // Three lift locs (lift_side_l 4937, lift_back 4940, lift_side_r
        // 4938) share one handler. From the valve, a click on a lift walks
        // the 59-step route but stops two tiles short at (2805,4493)
        // ("I can't reach that!" or a silent stall); a second click from
        // there enters the lift at once. Time matters: the route crosses the
        // cheeky ghost's zone, which turns the valve off 25 ticks later.
        const lifts = (await sdk.scanNearbyLocs(50)).filter(l => /^lift$/i.test(l.name) && Math.abs(l.x - 2807) <= 2 && Math.abs(l.z - 4493) <= 2 && l.id !== 4940);
        const first = lifts[0];
        if (!first) throw new Error('no lift in view');
        const landed = (s: StateLike) => inMap(s, 42, 69) && pos(s).z <= 4452;
        addPath(S, pathTiles(sdk, first.x, first.z));
        const trace: string[] = [];
        let seen = sdk.getState()?.gameMessages.length ?? 0;
        let clicks = 1;
        await sdk.sendInteractLoc(first.x, first.z, first.id, 1);
        let last = pos(sdk);
        const r = await waitUntil(sdk, s => {
            const p = pos(s);
            const g = findNpc(s, /ghost/i);
            const msgs = s.gameMessages.slice(seen).map(m => m.text);
            seen = s.gameMessages.length;
            trace.push(`${s.tick} ${p.x},${p.z}${g ? ` ghost@${g.x},${g.z}` : ''}${msgs.length ? ' | ' + msgs.join(' | ') : ''}${s.dialog.isOpen ? ' [dlg] ' + (s.dialog.text ?? '') : ''}`);
            if (landed(s)) return true;
            if (s.dialog.isOpen) return true; // "needs to be powered": too late
            const near = Math.max(Math.abs(p.x - 2807), Math.abs(p.z - 4493)) <= 3;
            if (near && p.x === last.x && p.z === last.z && !inMap(s, 42, 69) && clicks < 5) {
                const lift = lifts[clicks % lifts.length]!;
                clicks++;
                void sdk.sendInteractLoc(lift.x, lift.z, lift.id, 1);
            }
            last = p;
            return false;
        }, { maxTicks: 80 });
        if (!r.ok || !landed(sdk)) throw new Error(`lift ride failed:\n${trace.join('\n')}`);
        S.note(`lift clicks ${clicks}`);
        endSeg(S);
    },

    async stairs(sdk, S) {
        await energy(sdk);
        S.begin('flooded level -> stairs down with fungus (to the boss level)');
        await opLoc(sdk, S, /stairs/i, [2746, 4436], 1, s => inMap(s, 43, 69), 120);
        endSeg(S);
        const st = await varp(sdk, 'hauntedmine');
        if (st !== 7) throw new Error(`expected stage 7 after the lit stairs, got ${st}`);
    },

    async boss(sdk, S) {
        await energy(sdk);
        S.begin('walk to the key (through the boss door)');
        const door = await locNear(sdk, /door/i, [2799, 4453], 30);
        if (door && door.options.some(o => /open/i.test(o))) {
            await opLoc(sdk, S, /door/i, [2799, 4453], 1, () => true, 5);
            await waitUntil(sdk, s => pos(s).x <= 2800, { maxTicks: 40 });
        }
        const key = findNpc(sdk, /key/i);
        if (!key) throw new Error('no key in view');
        addPath(S, pathTiles(sdk, key.x, key.z));
        endSeg(S);
        S.begin('take the key: cutscene until Treus Dayth is attackable');
        const conv = converse(sdk, [], { openTicks: 40, idle: 1 });
        await sdk.sendInteractNpc(key.index, 1);
        S.dialogue(await conv);
        await waitUntil(sdk, s => findNpc(s, /treus dayth/i) !== null, { maxTicks: 60 });
        endSeg(S);
        S.begin('fight Treus Dayth');
        await fightTreus(sdk, S);
        endSeg(S);
        const st = await varp(sdk, 'hauntedmine');
        if (st !== 9) throw new Error(`expected stage 9 after the fight, got ${st}`);
    },

    async reward(sdk, S) {
        S.begin('take the key again');
        const key = findNpc(sdk, /key/i);
        if (key) {
            addPath(S, pathTiles(sdk, key.x, key.z));
            const conv = converse(sdk, [], { openTicks: 30, idle: 1 });
            await sdk.sendInteractNpc(key.index, 1);
            S.dialogue(await conv);
        }
        if (!has(sdk, /key/i)) throw new Error('no reward key');
        endSeg(S);
        // The crystal chamber is not connected to the boss room: back out the
        // boss door, up the east stairs to the flooded level, west across it
        // and down the west stairs (hauntedmine_darkstairs.rs2: 4_20 lands at
        // 43_69 6_38), then the reward door.
        await energy(sdk);
        S.begin('boss room -> boss door -> east stairs up');
        // the click route out of the boss room fails on the crane and cart NPCs
        const out = npcAwarePath(sdk, [{ x: 2798, z: 4453 }]);
        if (out) {
            addPath(S, out.length);
            await walkHops(sdk, out, 6);
        }
        const door = await locNear(sdk, /^door$/i, [2799, 4453], 10);
        if (door?.options.some(o => /open/i.test(o))) {
            // a new op replaces a pending one, so wait for the door to open
            // before clicking the stairs
            const t0 = currentTick(sdk);
            const r = await openDoor(sdk, door.x, door.z, { maxTicks: 10 });
            if (!r.ok) throw new Error(`boss door did not open: ${messagesSince(sdk, t0).join(' | ')}`);
        }
        await opLoc(sdk, S, /stairs/i, [2812, 4452], 1, s => inMap(s, 42, 69), 80);
        endSeg(S);
        S.begin('flooded level west -> west stairs down to the crystal chamber');
        // the west stairs are ~58 tiles away, outside the loc scan: walk first
        for (let i = 0; i < 6 && Math.abs(pos(sdk).x - 2694) > 3; i++) {
            const p0 = pos(sdk);
            addPath(S, pathTiles(sdk, 2694, 4437));
            await sdk.sendWalk(2694, 4437, true);
            await waitUntil(sdk, s => Math.abs(pos(s).x - 2694) <= 3 && Math.abs(pos(s).z - 4437) <= 3, { maxTicks: 40 });
            if (pos(sdk).x === p0.x && pos(sdk).z === p0.z) break;
        }
        const west = await locNear(sdk, /stairs/i, [2692, 4436], 15);
        if (!west || Math.abs(west.x - 2692) > 2) throw new Error(`west stairs not found near 2692,4436; at ${JSON.stringify(pos(sdk))}`);
        await opLoc(sdk, S, /stairs/i, [2692, 4436], 1, s => inMap(s, 43, 69), 60);
        endSeg(S);
        S.begin('reward door (sets stage 10)');
        let doorOps = 0;
        for (let i = 0; i < 3; i++) {
            const z0 = pos(sdk).z;
            await opLoc(sdk, S, /large door/i, [2772, 4450], 1, s => pos(s).z !== z0 && Math.abs(pos(s).x - 2772) <= 2, 80);
            doorOps++;
            await waitTicks(sdk, 1);
            if ((await varp(sdk, 'hauntedmine')) === 10) break;
        }
        S.note(`door ops ${doorOps}, now at ${pos(sdk).x},${pos(sdk).z}`);
        endSeg(S);
        const st = await varp(sdk, 'hauntedmine');
        console.log('stage after door', st);
        S.begin('cut a crystal (quest complete)');
        const strBefore = skillXp(sdk, 'strength');
        await opLoc(sdk, S, /crystal/i, [2788, 4428], 1, s => skillXp(s, 'strength') > strBefore, 80);
        S.note(`strength xp +${skillXp(sdk, 'strength') - strBefore} (game xp)`);
        endSeg(S);
    }
};

await runScript(async ({ sdk }) => {
    const S = new Recorder(sdk, `hauntedmine-${FROM}-${TO}-${STATS}-${STYLE}`);
    await setup(sdk, FROM);
    const a = PHASES.indexOf(FROM);
    const b = PHASES.indexOf(TO);
    for (let i = a; i <= b; i++) {
        console.log(`--- phase ${PHASES[i]} (tick ${currentTick(sdk)}, stage ${await varp(sdk, 'hauntedmine')})`);
        await phases[PHASES[i]!](sdk, S);
    }
    S.report();
    console.log('final stage', await varp(sdk, 'hauntedmine'));
}, { timeout: 1_800_000 });
