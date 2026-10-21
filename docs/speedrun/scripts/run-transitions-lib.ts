// Shared helpers for the run-order transition lab (docs/speedrun/research/run-transitions.md).
// Lab only: staff commands need an engine with LOCAL_STAFF_LEVEL=4 (docs/speedrun/LAB.md).
//
// Clock: every figure is server ticks as the lite client publishes them (state.tick), from the
// tick in which a leg's first action is sent to the first published state that shows the arrival.
import type { BotSDK } from '../../../sdk/index';
import type { BotActions } from '../../../sdk/actions';
import type { BotWorldState } from '../../../sdk/types';

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export type P = { x: number; z: number; level: number };
export type Ctx = { sdk: BotSDK; bot: BotActions; leg?: LegLog };

export const tick = (sdk: BotSDK) => sdk.getState()?.tick ?? -1;
export function pos(sdk: BotSDK): P {
    const p = sdk.getState()?.player;
    return { x: p?.worldX ?? -1, z: p?.worldZ ?? -1, level: p?.level ?? -1 };
}
export const cheb = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
export const result = (name: string, v: unknown) => console.log(`RESULT ${name} ${JSON.stringify(v)}`);
/** Wilderness level as the content computes it (wilderness_levels.rs2): (z - 3520) / 8 + 1 above z 3520. */
export const wildLevel = (z: number) => (z >= 3520 && z < 6400 ? Math.floor((z - 3520) / 8) + 1 : 0);

export async function nextTick(sdk: BotSDK, t = tick(sdk)): Promise<number> {
    const deadline = Date.now() + 20_000;
    while (tick(sdk) <= t) {
        if (Date.now() > deadline) throw new Error(`server ticks stopped arriving at ${t}`);
        await sleep(2);
    }
    return tick(sdk);
}
export async function waitTicks(sdk: BotSDK, n: number) {
    const target = tick(sdk) + n;
    while (tick(sdk) < target) await nextTick(sdk);
}
/** Wait until `pred` holds on a published state; false after `maxTicks`. */
export async function waitFor(sdk: BotSDK, pred: (s: BotWorldState) => boolean, maxTicks: number): Promise<boolean> {
    const t0 = tick(sdk);
    const deadline = Date.now() + 20_000 + maxTicks * 1_000;
    while (true) {
        const s = sdk.getState();
        if (s && pred(s)) return true;
        if (tick(sdk) - t0 > maxTicks || Date.now() > deadline) return false;
        await sleep(5);
    }
}
export async function cheat(sdk: BotSDK, cmd: string) {
    await sdk.sendSay(`::${cmd}`);
    await waitTicks(sdk, 1);
}
export async function tele(sdk: BotSDK, x: number, z: number, level = 0) {
    await sdk.sendSay(`::tele ${level},${x >> 6},${z >> 6},${x & 63},${z & 63}`);
    if (!(await waitFor(sdk, (s) => s.player?.worldX === x && s.player?.worldZ === z && s.player?.level === level, 20))) {
        throw new Error(`staff tele to ${x},${z},${level} failed: at ${JSON.stringify(pos(sdk))}`);
    }
    await waitTicks(sdk, 3); // region and nearby entities load
}

const ISLAND = (p: P) => p.x > 3040 && p.x < 3160 && p.z > 3040 && p.z < 3140;
/** A bot fresh from create-bot.ts is on Tutorial Island without side tabs; the SDK's skip fixes both. */
export async function ensureOffIsland(ctx: Ctx) {
    if (!ISLAND(pos(ctx.sdk))) return;
    const r = await ctx.bot.skipTutorial();
    await waitFor(ctx.sdk, (s) => !ISLAND({ x: s.player!.worldX, z: s.player!.worldZ, level: 0 }), 40);
    console.log(`tutorial skip: ${r.success} ${r.message}; now ${JSON.stringify(pos(ctx.sdk))}`);
}

export interface Setup {
    at: [number, number, number?];
    stats?: Record<string, number>;
    items?: [string, number][];
    vars?: Record<string, number>;
}
const ALL_STATS = ['attack', 'strength', 'defence', 'hitpoints', 'ranged', 'prayer', 'magic', 'agility'];
/** Untimed: empty inventory and equipment, route stats, items, varps, then the start tile. */
export async function setup(ctx: Ctx, s: Setup) {
    const { sdk } = ctx;
    await cheat(sdk, '~clearinv inv');
    await cheat(sdk, '~clearinv worn');
    const stats: Record<string, number> = { attack: 1, strength: 1, defence: 1, hitpoints: 10, ranged: 1, prayer: 1, magic: 1, agility: 1, ...s.stats };
    for (const k of ALL_STATS) void sdk.sendSay(`::setstat ${k} ${stats[k]}`);
    for (const [k, v] of Object.entries(s.vars ?? {})) void sdk.sendSay(`::setvar ${k} ${v}`);
    await waitTicks(sdk, 4);
    for (const [name, n] of s.items ?? []) void sdk.sendSay(`::give ${name} ${n}`);
    await waitTicks(sdk, Math.ceil((s.items?.length ?? 0) / 5) + 2);
    await tele(sdk, s.at[0], s.at[1], s.at[2] ?? 0);
    if (sdk.getState()?.dialog.isOpen) await sdk.sendClickDialog(0);
    await waitTicks(sdk, 2);
}

/** Per-leg log: segments, tiles walked (teleports excluded), clicks, hp. */
export class LegLog {
    t0: number;
    segs: { label: string; ticks: number; note?: string }[] = [];
    tiles = 0;
    movingTicks = 0;
    clicks = 0;
    doorOpens = 0;
    webTries = 0;
    casts = 0;
    hpMin: number;
    private last: P;
    private lastTick: number;
    private unsub: () => void;
    constructor(private sdk: BotSDK) {
        this.t0 = tick(sdk);
        this.last = pos(sdk);
        this.lastTick = this.t0;
        this.hpMin = sdk.getState()?.player?.hp ?? 0;
        this.unsub = sdk.onStateUpdate((s) => {
            if (s.tick === this.lastTick || !s.player) return;
            this.lastTick = s.tick;
            const p = { x: s.player.worldX, z: s.player.worldZ, level: s.player.level };
            const d = cheb(p, this.last);
            if (p.level === this.last.level && d > 0 && d <= 2) {
                this.tiles += d;
                this.movingTicks++;
            }
            this.last = p;
            if (s.player.hp < this.hpMin) this.hpMin = s.player.hp;
        });
    }
    async seg(label: string, fn: () => Promise<string | void>) {
        const a = tick(this.sdk);
        const note = await fn();
        this.segs.push({ label, ticks: tick(this.sdk) - a, ...(note ? { note } : {}) });
    }
    finish() {
        this.unsub();
        return { ticks: tick(this.sdk) - this.t0, segs: this.segs, tiles: this.tiles, movingTicks: this.movingTicks, clicks: this.clicks, doorOpens: this.doorOpens, webTries: this.webTries, casts: this.casts, hpMin: this.hpMin, end: pos(this.sdk) };
    }
}

// ---------- teleports

// Component ids from server/content/pack/interface.pack (quest-primitives-teleports.ts).
export const SPELL = { varrock: 1164, lumbridge: 1167, falador: 1170, camelot: 1174, ardougne: 1540 } as const;
export const ENCHANT_SAPPHIRE = 1155; // Lvl-1 Enchant (magic-cadence-spells.ts)
export const TELE_RUNES: [string, number][] = [['airrune', 100], ['waterrune', 100], ['earthrune', 100], ['firerune', 100], ['lawrune', 50]];

const jumped = (p0: P) => (s: BotWorldState) => !!s.player && (s.player.level !== p0.level || cheb({ x: s.player.worldX, z: s.player.worldZ }, p0) > 15);

export async function castTele(ctx: Ctx, spell: keyof typeof SPELL) {
    const p0 = pos(ctx.sdk);
    await ctx.sdk.sendClickComponent(SPELL[spell]);
    if (ctx.leg) ctx.leg.clicks++;
    if (!(await waitFor(ctx.sdk, jumped(p0), 15))) throw new Error(`${spell} teleport did not land: ${ctx.sdk.getState()?.gameMessages.slice(-3).map((m) => m.text).join(' | ')}`);
}

export async function rubGlory(ctx: Ctx, dest: RegExp) {
    const { sdk } = ctx;
    const it = sdk.getState()!.inventory.find((i) => /glory\(\d\)/i.test(i.name));
    if (!it) throw new Error('no charged glory');
    const op = it.optionsWithIndex.find((o) => /rub/i.test(o.text))!;
    const p0 = pos(sdk);
    await sdk.sendUseItem(it.slot, op.opIndex);
    if (ctx.leg) ctx.leg.clicks++;
    if (!(await waitFor(sdk, (s) => s.dialog.isOpen && !s.dialog.isWaiting && s.dialog.options.some((o) => dest.test(o.text)), 15))) throw new Error('glory: no choice');
    const d = sdk.getState()!.dialog;
    await sdk.sendClickDialog(d.options.find((o) => dest.test(o.text))!.index);
    if (ctx.leg) ctx.leg.clicks++;
    if (!(await waitFor(sdk, jumped(p0), 15))) throw new Error(`glory did not land: ${sdk.getState()?.gameMessages.slice(-3).map((m) => m.text).join(' | ')}`);
}

// ---------- dialogs, locs, npcs

/** Answer a conversation as fast as the client allows (reacting to each published page); resolves when `until` holds. */
export async function converse(ctx: Ctx, start: () => Promise<unknown>, answers: RegExp[], until: (s: BotWorldState) => boolean, maxTicks = 80) {
    const { sdk } = ctx;
    let lastPage = '';
    let pages = 0, choices = 0;
    const unsub = sdk.onStateUpdate((s) => {
        const d = s.dialog;
        if (!d.isOpen || d.isWaiting || !d.pageId || d.pageId === lastPage) return;
        lastPage = d.pageId;
        if (d.options.length > 1) {
            const opt = answers.map((a) => d.options.find((o) => a.test(o.text))).find((o) => o);
            if (!opt) { console.log('NO ANSWER for', d.options.map((o) => o.text)); return; }
            choices++;
            void sdk.sendClickDialog(opt.index);
        } else {
            pages++;
            void sdk.sendClickDialog(0);
        }
        if (ctx.leg) ctx.leg.clicks++;
    });
    await start();
    if (ctx.leg) ctx.leg.clicks++;
    const ok = await waitFor(sdk, until, maxTicks);
    unsub();
    if (!ok) throw new Error(`conversation did not reach its end state (pages ${pages}, choices ${choices}) at ${JSON.stringify(pos(sdk))}`);
    return `${pages} pages, ${choices} choices`;
}

export async function findLoc(ctx: Ctx, match: { id?: number; name?: RegExp }, radius = 15) {
    const near = (await ctx.sdk.scanNearbyLocs(radius)).filter((l) => (match.id === undefined || l.id === match.id) && (!match.name || match.name.test(l.name)));
    near.sort((a, b) => a.distance - b.distance);
    return near[0] ?? null;
}

/** Interact with the nearest matching loc (by id and/or name) and wait for `until`. */
export async function opLoc(ctx: Ctx, match: { id?: number; name?: RegExp; op?: RegExp; at?: [number, number] }, until: (s: BotWorldState) => boolean, maxTicks = 40, answers: RegExp[] = []) {
    const { sdk } = ctx;
    let x: number, z: number, id: number, opIndex: number;
    const l = await findLoc(ctx, match);
    if (l) {
        x = l.x; z = l.z; id = l.id;
        const o = match.op ? l.optionsWithIndex.find((q) => match.op!.test(q.text)) : l.optionsWithIndex[0];
        if (!o) throw new Error(`loc ${l.name} has no op ${match.op}: ${l.optionsWithIndex.map((q) => q.text)}`);
        opIndex = o.opIndex;
    } else if (match.at && match.id !== undefined) {
        // bridge-flagged locs are not listed by the lite client (LAB.md); use the known tile
        [x, z] = match.at; id = match.id; opIndex = 1;
    } else {
        throw new Error(`no loc ${JSON.stringify({ id: match.id, name: String(match.name) })} near ${JSON.stringify(pos(sdk))}`);
    }
    return converse(ctx, () => sdk.sendInteractLoc(x, z, id, opIndex), answers, until, maxTicks);
}

export async function talkNpc(ctx: Ctx, npc: RegExp, answers: RegExp[], until: (s: BotWorldState) => boolean, maxTicks = 80) {
    const { sdk } = ctx;
    const n = sdk.findNearbyNpc(npc);
    if (!n) throw new Error(`npc ${npc} not found near ${JSON.stringify(pos(sdk))}`);
    const op = n.optionsWithIndex.find((o) => /talk/i.test(o.text))!;
    return converse(ctx, () => sdk.sendInteractNpc(n.index, op.opIndex), answers, until, maxTicks);
}

export async function useItemOnLoc(ctx: Ctx, item: RegExp, match: { id?: number; name?: RegExp }, until: (s: BotWorldState) => boolean, maxTicks = 30) {
    const { sdk } = ctx;
    const it = sdk.getState()!.inventory.find((i) => item.test(i.name));
    if (!it) throw new Error(`no ${item} in inventory`);
    const l = await findLoc(ctx, match);
    if (!l) throw new Error(`no loc ${String(match.name ?? match.id)} near ${JSON.stringify(pos(sdk))}`);
    await sdk.sendUseItemOnLoc(it.slot, l.x, l.z, l.id);
    if (ctx.leg) ctx.leg.clicks++;
    if (!(await waitFor(sdk, until, maxTicks))) throw new Error(`${item} on ${l.name}: end state not reached at ${JSON.stringify(pos(sdk))}`);
}

/** Cross a ship's gangplank (primitives.md section 5 disembark). */
export async function disembark(ctx: Ctx) {
    const { sdk } = ctx;
    if (sdk.getState()!.dialog.isOpen) {
        await waitFor(sdk, (s) => !s.dialog.isWaiting, 5);
        await sdk.sendClickDialog(0);
        await waitFor(sdk, (s) => !s.dialog.isOpen, 10);
    }
    const plank = sdk.getState()!.nearbyLocs.filter((l) => /gangplank/i.test(l.name) && l.optionsWithIndex.some((o) => /cross/i.test(o.text))).sort((a, b) => a.distance - b.distance)[0];
    if (!plank) throw new Error('no gangplank');
    const lv = pos(sdk).level;
    await sdk.sendInteractLoc(plank.x, plank.z, plank.id, plank.optionsWithIndex.find((o) => /cross/i.test(o.text))!.opIndex);
    if (ctx.leg) ctx.leg.clicks++;
    if (!(await waitFor(sdk, (s) => s.player!.level !== lv, 20))) throw new Error('gangplank not crossed');
}

// ---------- webs (Mage Arena / Deserted Keep; quest-magearena-travel.ts)

/**
 * Walk through a chain of goal tiles that webs may block. The lite client's static collision
 * keeps a slashed web closed, so the step through it is a server-side walk (sdk.sendWalk).
 */
export async function throughWebs(ctx: Ctx, goals: [number, number][]) {
    const { sdk } = ctx;
    for (const [gx, gz] of goals) {
        for (let attempt = 0; attempt < 16; attempt++) {
            if (cheb(pos(sdk), { x: gx, z: gz }) <= 1) break;
            const p = sdk.findPath(gx, gz);
            if (p.success && p.reachedDestination && p.waypoints.length < 40) {
                await walk(ctx, { x: gx, z: gz }, { tol: 1, noWebs: true });
                continue;
            }
            const webs = (await sdk.scanNearbyLocs(12)).filter((l) => /^web$/i.test(l.name) && l.optionsWithIndex.some((o) => /slash/i.test(o.text)));
            webs.sort((a, b) => a.distance - b.distance);
            const web = webs[0];
            if (!web) {
                await sdk.sendWalk(gx, gz, true);
                if (ctx.leg) ctx.leg.clicks++;
                await waitFor(sdk, (s) => cheb({ x: s.player!.worldX, z: s.player!.worldZ }, { x: gx, z: gz }) <= 1, 60);
                break;
            }
            const knife = sdk.findInventoryItem(/^knife$/i);
            if (!knife) throw new Error('no knife');
            sdk.getNewChat({ types: [0] });
            await sdk.sendUseItemOnLoc(knife.slot, web.x, web.z, web.id);
            if (ctx.leg) { ctx.leg.clicks++; ctx.leg.webTries++; }
            await waitTicks(sdk, Math.max(2, Math.ceil(web.distance / 2) + 1));
            const ok = sdk.getNewChat({ types: [0] }).some((m) => /slash the web apart/i.test(m.text));
            if (ok) {
                await sdk.sendWalk(gx, gz, true);
                if (ctx.leg) ctx.leg.clicks++;
                await waitFor(sdk, (s) => cheb({ x: s.player!.worldX, z: s.player!.worldZ }, { x: gx, z: gz }) <= 1, 60);
                break;
            }
        }
    }
}

// ---------- walking

function buildRoute(sdk: BotSDK, dest: { x: number; z: number }): { x: number; z: number }[] {
    const path = sdk.findPath(dest.x, dest.z, 500);
    if (!path.success || !path.waypoints.length) return [dest];
    const route: { x: number; z: number }[] = [];
    let cur = pos(sdk);
    for (const wp of path.waypoints) {
        let guard = 0;
        while ((cur.x !== wp.x || cur.z !== wp.z) && guard++ < 2000) {
            cur = { ...cur, x: cur.x + Math.sign(wp.x - cur.x), z: cur.z + Math.sign(wp.z - cur.z) };
            route.push({ x: cur.x, z: cur.z });
        }
    }
    return route.length ? route : [dest];
}

async function openNearbyDoor(ctx: Ctx): Promise<boolean> {
    const { sdk } = ctx;
    const doors = (await sdk.scanNearbyLocs(4)).filter((l) => l.optionsWithIndex.some((o) => /^open$/i.test(o.text)));
    doors.sort((a, b) => a.distance - b.distance);
    const d = doors[0];
    if (!d) return false;
    await sdk.sendInteractLoc(d.x, d.z, d.id, d.optionsWithIndex.find((o) => /^open$/i.test(o.text))!.opIndex);
    if (ctx.leg) { ctx.leg.clicks++; ctx.leg.doorOpens++; }
    await waitFor(sdk, () => false, Math.ceil(d.distance / 2) + 2);
    return true;
}

/** The first closed door or gate standing on route tiles [from, to], by the client's loc list. */
function doorOnRoute(sdk: BotSDK, route: { x: number; z: number }[], from: number, to: number) {
    const locs = sdk.getState()!.nearbyLocs.filter((l) => l.optionsWithIndex.some((o) => /^open$/i.test(o.text)));
    if (!locs.length) return null;
    for (let j = from; j <= to && j < route.length; j++) {
        const l = locs.find((q) => q.x === route[j].x && q.z === route[j].z);
        if (l) return { loc: l, j };
    }
    return null;
}

export interface WalkOpts {
    tol?: number;
    reach?: number;
    lead?: number;
    maxTicks?: number;
    noWebs?: boolean;
    /** Stop as soon as this holds (e.g. a wilderness level reached), before the destination. */
    stopWhen?: (s: BotWorldState) => boolean;
    /** Enchant while walking: cast every 3 ticks, never in a walk click's tick. */
    cast?: () => Promise<boolean>;
    /** Eat a shark below 15 hp (Wilderness legs at the route's low Defence). */
    eat?: boolean;
}

/**
 * Run to `dest` with chained clicks: click the furthest route tile within `reach` (Chebyshev),
 * re-click `lead` tiles before it (primitives.md section 2, 84-85 ticks for 165 tiles). Route
 * from the SDK's global collision map; a stall of 3 ticks opens the nearest door, or slashes
 * the nearest web, and re-routes.
 */
export async function walk(ctx: Ctx, dest: { x: number; z: number }, o: WalkOpts = {}) {
    const { sdk } = ctx;
    const tol = o.tol ?? 0, reach = o.reach ?? 20, lead = o.lead ?? 3, maxTicks = o.maxTicks ?? 900;
    const start = tick(sdk);
    let route = buildRoute(sdk, dest);
    let idx = 0;
    let target: { x: number; z: number } | null = null;
    let final = false;
    let lastPos = pos(sdk), lastMove = tick(sdk), clickTick = -99, lastCast = -99, stalls = 0;
    let curReach = reach, lastReachPos = pos(sdk);
    const doorTries = new Map<string, number>();
    const arrived = () => cheb(pos(sdk), dest) <= tol || (!!o.stopWhen && o.stopWhen(sdk.getState()!));
    let t = tick(sdk);
    while (!arrived()) {
        if (tick(sdk) - start > maxTicks) throw new Error(`walk to ${dest.x},${dest.z} exceeded ${maxTicks} ticks at ${JSON.stringify(pos(sdk))}`);
        const p = pos(sdk);
        if (p.x !== lastPos.x || p.z !== lastPos.z) { lastPos = p; lastMove = t; }
        if (o.eat && t !== clickTick) await eatIfLow(ctx);
        let needClick = target === null || (!final && cheb(p, target) <= lead);
        if (!needClick && t - lastMove >= 3 && t - clickTick >= 3) {
            // stalled: door, web, or a combat interruption
            stalls++;
            if (stalls > 12) throw new Error(`walk to ${dest.x},${dest.z} stalled 12 times at ${JSON.stringify(p)}`);
            const opened = await openNearbyDoor(ctx);
            if (!opened && !o.noWebs) {
                const web = (await sdk.scanNearbyLocs(3)).find((l) => /^web$/i.test(l.name));
                if (web) await throughWebs(ctx, [[dest.x, dest.z]]);
            }
            if (!opened) curReach = Math.max(4, Math.floor(curReach / 2));
            route = buildRoute(sdk, dest);
            idx = 0;
            t = tick(sdk);
            lastMove = t;
            needClick = true;
        }
        if (needClick && (!o.cast || t - lastCast >= 3)) {
            // nearest route tile at or after idx
            let best = idx, bd = Infinity;
            for (let i = idx; i < Math.min(route.length, idx + 80); i++) {
                const d = cheb(route[i], p);
                if (d < bd) { bd = d; best = i; }
            }
            if (bd > 4) { route = buildRoute(sdk, dest); best = 0; }
            idx = best;
            let ti = idx;
            for (let i = idx; i < route.length && cheb(route[i], p) <= curReach; i++) ti = i;
            if (cheb(p, lastReachPos) >= 8) { curReach = reach; lastReachPos = p; }
            const door = doorOnRoute(sdk, route, idx, ti);
            const doorKey = door ? `${door.loc.x},${door.loc.z}` : '';
            if (door && (doorTries.get(doorKey) ?? 0) < 2) {
                doorTries.set(doorKey, (doorTries.get(doorKey) ?? 0) + 1);
                // Open it as part of the run: the server walks to the door, then opens it.
                const d = door.loc;
                await sdk.sendInteractLoc(d.x, d.z, d.id, d.optionsWithIndex.find((q) => /^open$/i.test(q.text))!.opIndex);
                if (ctx.leg) { ctx.leg.clicks++; ctx.leg.doorOpens++; }
                await waitFor(sdk, (s) => !s.nearbyLocs.some((l) => l.x === d.x && l.z === d.z && l.optionsWithIndex.some((q) => /^open$/i.test(q.text))), Math.ceil(cheb(p, d) / 2) + 6);
                await nextTick(sdk);
                t = tick(sdk);
                lastMove = t;
                clickTick = t;
                target = null;
                route = buildRoute(sdk, dest);
                idx = 0;
                continue;
            }
            target = route[ti] ?? dest;
            final = ti >= route.length - 1;
            await sdk.sendWalk(target.x, target.z, true);
            if (ctx.leg) ctx.leg.clicks++;
            clickTick = t;
            if (o.cast) lastCast = t - 2; // next cast on the following tick
        } else if (o.cast && t - lastCast >= 3 && t !== clickTick) {
            if (await o.cast()) { lastCast = t; if (ctx.leg) ctx.leg.casts++; }
            else o.cast = undefined;
        }
        t = await nextTick(sdk, t);
    }
    return { ticks: tick(sdk) - start, stalls };
}

/** Eat a shark when hp is low (Wilderness legs); returns true if it ate. */
export async function eatIfLow(ctx: Ctx, below = 15) {
    const s = ctx.sdk.getState()!;
    if ((s.player?.hp ?? 99) >= below) return false;
    const food = s.inventory.find((i) => /^shark$/i.test(i.name));
    if (!food) return false;
    await ctx.sdk.sendUseItem(food.slot, food.optionsWithIndex.find((o) => /eat/i.test(o.text))?.opIndex ?? 1);
    if (ctx.leg) ctx.leg.clicks++;
    return true;
}
