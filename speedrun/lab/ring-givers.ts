#!/usr/bin/env bun
// The S04 ring givers in the lab (SUPPLIES.md H3, magic.ts RING_CONTRACT): one lab account per load
// (rs/41's cairn_h81-h83 on the day), each staged with its load by ::give, standing beside S04's
// start tile (on SCORED's side of any wall, off the Firemaking row), keeping a request standing
// once its load is next and SCORED in view, and giving the load with give() and ANY_OFFER, so it
// takes back whatever SCORED offers (the previous load's enchanted rings). lab/magic-accept.ts's
// s04 mode and lab/dress-rehearsal.ts (--ringers) both use it.
//
//   LOCAL_STAFF_LEVEL=4 bun speedrun/lab/ring-givers.ts --givers=<g1>,<g2>,<g3> --scored=<lab account> --at=<x>,<z> [--avoid=<parseTiles list>] [--loads=3]
//
// The givers are lab.sh LAB_HELPERS (lite runners already up). Prints a `{"message":"ready"}` line once
// every giver stands staged on its tile, then `RESULT ring-givers {...}`. Lab only (labRefusal).

import { findLongPath, getDoorAt, isTileWalkable, type DoorInfo } from '../../sdk/pathfinding';
import { routeTiles } from '../lib/world';
import { closeSession, openSession, type Session } from '../lib/session';
import { ANY_OFFER, clickBack, decideTradeClick, give, newClickCtx, sameName, sendTradeClick, tradeOf } from '../lib/trade';
import { nextTick, waitTicks, waitUntil } from '../lib/wait';
import { ENCHANTS, ROUTE_LOADS, type RingCounts } from '../skills/magic';
import { parseTiles } from '../skills/firemaking';
import { cheat, leaveTutorial, mustTele } from './setup';
import { labRefusal } from './stand-ins';

type Tier = keyof typeof ENCHANTS;
const TIERS = Object.keys(ENCHANTS) as Tier[];

/** Path tiles past which a stand is not "beside" SCORED (RING_CONTRACT: a tile or two; a corner may cost a few more). */
export const GIVER_MAX_STEPS = 4;

/**
 * Walkable tiles near `at` that a player there walks onto in at most GIVER_MAX_STEPS steps, fewest
 * steps first (then the fewest orthogonal tiles away), none in `avoid`. Every door near `at` counts
 * as closed, as it does for a trade request's path: the SDK map opens them all, and the Lumbridge
 * castle's large doors (3217,3218-3219) are a wall SCORED cannot pass (rehearsals/firemaking.md).
 * The route must end on the tile itself, not beside it, so a tile across a wall never counts.
 */
export function giverTiles(n: number, at: { x: number; z: number }, avoid: ReadonlySet<string> = new Set()): Array<{ x: number; z: number }> {
    const r = GIVER_MAX_STEPS;
    const doors: DoorInfo[] = [];
    for (let dx = -r - 1; dx <= r + 1; dx++) for (let dz = -r - 1; dz <= r + 1; dz++) {
        const d = getDoorAt(0, at.x + dx, at.z + dz);
        if (d) doors.push(d);
    }
    const out: Array<{ x: number; z: number; d: number }> = [];
    for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
            if (!dx && !dz) continue;
            const t = { x: at.x + dx, z: at.z + dz };
            if (avoid.has(`${t.x},${t.z}`) || !isTileWalkable(0, t.x, t.z)) continue;
            const wps = findLongPath(0, at.x, at.z, t.x, t.z, 500, doors);
            const end = wps[wps.length - 1];
            if (!end || end.x !== t.x || end.z !== t.z) continue;
            const steps = routeTiles(at, wps);
            if (steps <= r) out.push({ ...t, d: steps * 100 + Math.abs(dx) + Math.abs(dz) });
        }
    }
    out.sort((a, b) => a.d - b.d);
    if (out.length < n) throw new Error(`only ${out.length} reachable giver tiles beside ${at.x},${at.z}`);
    return out.slice(0, n).map(({ x, z }) => ({ x, z }));
}

/** The ::give commands that stage `load` (`ruby_ring 15`). */
export function loadCommands(load: RingCounts): string[] {
    return TIERS.filter(t => (load[t] ?? 0) > 0).map(t => `${t}_ring ${load[t]}`);
}

const ringCount = (load: RingCounts) => Object.values(load).reduce((a, n) => a + (n ?? 0), 0);

/** Clear a giver's pack and worn set, then ::give its load. */
export async function stageLoad(s: Session, load: RingCounts): Promise<void> {
    await cheat(s.sdk, '~clearinv inv');
    await cheat(s.sdk, '~clearinv worn');
    await waitUntil(s.sdk, st => st.inventory.length === 0 && st.equipment.length === 0, { maxTicks: 10 });
    for (const c of loadCommands(load)) await cheat(s.sdk, `give ${c}`);
    const r = await waitUntil(s.sdk, st => st.inventory.length >= ringCount(load), { maxTicks: 15 });
    if (!r.ok) throw new Error(`staging: ${s.sdk.getState()?.inventory.length} slots after ${loadCommands(load).join(', ')}`);
    await waitTicks(s.sdk, 2);
}

export interface Served {
    load: number;
    giver: string;
    ok: boolean;
    ticks: number;
    /** The tick the trade opened on the giver's clock. */
    at: number;
    reason?: string;
}

/**
 * Serve one load: keep a request standing while SCORED is in view and no trade is open (the
 * standing-request rule, lib/trade.ts decideTradeClick: re-send only after a busy bounce or no
 * reply, never once a request landed), decline any other partner, and give the load once SCORED
 * opens the trade. Returns when given, or null when `stop` turns true first.
 */
export async function serveLoad(g: Session, scored: string, load: RingCounts, i: number, stop: () => boolean): Promise<Served | null> {
    let req = newClickCtx();
    while (!stop()) {
        const st = await nextTick(g.sdk);
        const t = tradeOf(st);
        if (!t.isOpen) {
            const p = st.nearbyPlayers.find(x => sameName(x.name, scored));
            if (!p) continue;
            const d = decideTradeClick(st, req, { noReplyTicks: 3, resendTicks: 100 });
            req = d.next;
            if (d.action === 'send') sendTradeClick(g.sdk, p.index, req.sentTick, (sent, tick) => (req = clickBack(req, sent, tick)));
            continue;
        }
        req = newClickCtx();
        if (!sameName(t.partner, scored)) {
            await g.sdk.sendDeclineTrade();
            continue;
        }
        const r = await give(g.sdk, scored, TIERS.filter(k => (load[k] ?? 0) > 0).map(k => ({ item: new RegExp(`^${ENCHANTS[k].ring}$`, 'i') })), { expectTheirs: ANY_OFFER, maxTicks: 40 });
        const served: Served = { load: i + 1, giver: g.name, ok: r.ok, ticks: r.ticks, at: st.tick, ...(r.reason ? { reason: r.reason } : {}) };
        if (r.ok) return served;
    }
    return null;
}

/** Serve every load in order, each giver its own; `log` sees every attempt. */
export async function serveLoads(givers: readonly Session[], scored: string, loads: readonly RingCounts[], stop: () => boolean, log: (s: Served) => void = () => {}): Promise<Served[]> {
    const out: Served[] = [];
    for (let i = 0; i < loads.length; i++) {
        const s = await serveLoad(givers[i]!, scored, loads[i]!, i, stop);
        if (!s) break;
        out.push(s);
        log(s);
    }
    return out;
}

async function main(argv: string[]): Promise<number> {
    const arg = (k: string) => argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
    const names = (arg('givers') ?? '').split(',').filter(Boolean);
    const scored = arg('scored');
    const at = arg('at')?.split(',').map(Number);
    const nLoads = Number(arg('loads') ?? ROUTE_LOADS.length);
    if (!scored || !at || at.length !== 2 || names.length < nLoads) {
        console.error('usage: LOCAL_STAFF_LEVEL=4 bun speedrun/lab/ring-givers.ts --givers=<g1>,<g2>,<g3> --scored=<lab account> --at=<x>,<z> [--avoid=<tiles>] [--loads=3] (one giver per load)');
        return 2;
    }
    const avoid = new Set((arg('avoid') ? parseTiles(arg('avoid')!) : []).map(t => `${t[0]},${t[1]}`));
    const loads = ROUTE_LOADS.slice(0, nLoads);
    const givers: Session[] = [];
    for (const n of names.slice(0, nLoads)) givers.push(await openSession(n, { pathfinding: false }));
    try {
        const g0 = givers[0]!;
        const why = labRefusal({ staffLevel: process.env.LOCAL_STAFF_LEVEL, server: g0.env.SERVER ?? 'localhost', gateway: (g0.sdk as unknown as { config?: { gatewayUrl?: string } }).config?.gatewayUrl ?? '' });
        if (why) {
            console.error(`[ring-givers] REFUSED: ${why}`);
            return 3;
        }
        const tiles = giverTiles(givers.length, { x: at[0]!, z: at[1]! }, avoid);
        for (const [i, g] of givers.entries()) {
            await leaveTutorial(g);
            await stageLoad(g, loads[i]!);
            await mustTele(g.sdk, tiles[i]!.x, tiles[i]!.z);
        }
        console.log(JSON.stringify({ message: 'ready', givers: givers.map((g, i) => ({ giver: g.name, tile: tiles[i], load: loadCommands(loads[i]!) })) }));
        let stopped = false;
        process.on('SIGTERM', () => (stopped = true));
        const served = await serveLoads(givers, scored, loads, () => stopped, s => console.log(JSON.stringify({ message: 'served', ...s })));
        console.log(`RESULT ring-givers ${JSON.stringify({ loads: loads.length, served: served.filter(s => s.ok).length, results: served })}`);
        return served.length === loads.length ? 0 : 1;
    } finally {
        for (const g of givers) await closeSession(g);
    }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
