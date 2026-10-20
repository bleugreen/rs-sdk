// Movement timing: run/walk tiles per tick, run energy drain, single-click
// reach, and the cost of a long walk with bot.walkTo versus an eager clicker.
// Run: bun docs/speedrun/scripts/quest-primitives-movement.ts <botname> [section]
//
// Observed positions are the client's interpolated entity tile
// (StateCollector.ts worldX = player.x >> 7), which trails the server by about
// one tick, so every observed arrival carries that one tick.

import { runScript } from '../../../sdk/runner';
import type { BotSDK } from '../../../sdk/index';
import { at, now, pos, result, stats, tele, trace, waitTicks, waitUntil } from './quest-primitives-lib';

const cheb = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

/** One click to (x,z); per-tick displacement, first-move delay and arrival. */
async function oneClick(sdk: BotSDK, x: number, z: number, running: boolean, maxTicks = 80) {
    const tr = trace(sdk);
    const t0 = now(sdk);
    const start = pos(sdk.getState());
    await sdk.sendWalk(x, z, running);
    const arr = await waitUntil(sdk, at(x, z), maxTicks);
    await waitTicks(sdk, 1);
    tr.stop();
    const rows = tr.rows.filter(r => r.tick >= t0);
    const steps: number[] = [];
    for (let i = 1; i < rows.length; i++) steps.push(cheb(rows[i], rows[i - 1]));
    const firstMove = rows.findIndex((r, i) => i > 0 && steps[i - 1] > 0);
    const moving = steps.filter(s => s > 0);
    return {
        from: start, to: { x, z }, chebyshev: cheb(start, { x, z }), arrived: arr !== null,
        clickToArrive: arr ? arr.tick - t0 : null,
        firstMoveTick: firstMove > 0 ? rows[firstMove].tick - t0 : null,
        tilesWalked: moving.reduce((a, b) => a + b, 0), movingTicks: moving.length,
        tilesPerMovingTick: moving.length ? Math.round((moving.reduce((a, b) => a + b, 0) / moving.length) * 100) / 100 : 0,
        energy: { start: rows[0]?.energy, end: rows[rows.length - 1]?.energy, min: Math.min(...rows.map(r => r.energy)) },
    };
}

/** Walk a long route by clicking the furthest route tile within `reach`, re-clicking `lead` tiles before the leg ends. */
async function eagerWalk(sdk: BotSDK, x: number, z: number, reach = 30, lead = 4) {
    const t0 = now(sdk);
    const tr = trace(sdk);
    let clicks = 0;
    // Route once: a global path query takes long enough to cost idle ticks if
    // repeated before every click.
    const path = await sdk.sendFindPath(x, z, 500);
    if (!path.success || !path.waypoints.length) throw new Error('no path ' + path.error);
    const t1 = now(sdk);
    let next = 0;
    for (let guard = 0; guard < 60; guard++) {
        const p = pos(sdk.getState());
        if (p.x === x && p.z === z) break;
        let target = path.waypoints[next];
        for (let i = next; i < path.waypoints.length && cheb(path.waypoints[i], p) <= reach; i++) { target = path.waypoints[i]; next = i; }
        await sdk.sendWalk(target.x, target.z, true);
        clicks++;
        const final = target.x === x && target.z === z;
        await waitUntil(sdk, s => cheb(pos(s), target) <= (final ? 0 : lead), 60);
    }
    const arrive = now(sdk);
    tr.stop();
    const rows = tr.rows;
    let tiles = 0;
    const hist: Record<number, number> = {};
    for (let i = 1; i < rows.length; i++) { const d = cheb(rows[i], rows[i - 1]); tiles += d; hist[d] = (hist[d] ?? 0) + 1; }
    return { stepHistogram: hist, clicks, ticks: arrive - t0, routeQueryTicks: t1 - t0, walkTicks: arrive - t1, tilesWalked: tiles, idealTicks: Math.ceil(tiles / 2) };
}

async function sdkWalk(sdk: BotSDK, bot: any, x: number, z: number) {
    const t0 = now(sdk);
    const tr = trace(sdk);
    const r = await bot.walkTo(x, z, 0);
    const arrive = now(sdk);
    tr.stop();
    let tiles = 0;
    const rows = tr.rows;
    let idle = 0;
    const hist: Record<number, number> = {};
    for (let i = 1; i < rows.length; i++) { const d = cheb(rows[i], rows[i - 1]); tiles += d; if (d === 0) idle++; hist[d] = (hist[d] ?? 0) + 1; }
    return { stepHistogram: hist, ok: r.success, msg: r.message, ticks: arrive - t0, tilesWalked: tiles, idleTicks: idle, idealTicks: Math.ceil(tiles / 2) };
}

// Optional section filter: run20 walk10 reach long energy
const ONLY = process.argv[3];
const want = (s: string) => !ONLY || ONLY === s;

await runScript(async ({ bot, sdk }) => {
    // Open ground on the Lumbridge-Draynor road (west of the castle).
    const A = { x: 3200, z: 3226 };
    const runs = [];
    for (let i = 0; i < (want('run20') ? 3 : 0); i++) {
        await tele(sdk, A.x, A.z);
        runs.push(await oneClick(sdk, A.x - 20, A.z, true));
    }
    if (runs.length) result('movement.run20', { runs, clickToArrive: stats(runs.map(r => r.clickToArrive ?? NaN)), firstMove: stats(runs.map(r => r.firstMoveTick ?? NaN)), tilesPerMovingTick: stats(runs.map(r => r.tilesPerMovingTick)) });

    const walks = [];
    for (let i = 0; i < (want('walk10') ? 2 : 0); i++) {
        await tele(sdk, A.x, A.z);
        walks.push(await oneClick(sdk, A.x - 10, A.z, false));
    }
    if (walks.length) result('movement.walk10', { walks, tilesPerMovingTick: stats(walks.map(r => r.tilesPerMovingTick)) });

    // Single-click reach: how far can one click go?
    const reach = [];
    for (const d of want('reach') ? [30, 40, 45, 50, 55, 60, 70] : []) {
        await tele(sdk, A.x, A.z);
        await waitTicks(sdk, 2);
        const r = await oneClick(sdk, A.x - d, A.z, true, Math.ceil(d / 2) + 10);
        const p = pos(sdk.getState());
        reach.push({ d, arrived: r.arrived, clickToArrive: r.clickToArrive, endedAt: p, tilesWalked: r.tilesWalked });
    }
    if (reach.length) result('movement.singleClickReach', reach);

    // Long route: Lumbridge castle courtyard -> Draynor bank, twice each way of clicking.
    const L = { x: 3222, z: 3218 }, D = { x: 3093, z: 3244 };
    const eager = [], sdkw = [];
    for (let i = 0; i < (want('long') ? 2 : 0); i++) {
        await tele(sdk, L.x, L.z);
        eager.push(await eagerWalk(sdk, D.x, D.z));
        await tele(sdk, L.x, L.z);
        sdkw.push(await sdkWalk(sdk, bot, D.x, D.z));
    }
    if (eager.length) result('movement.lumbridgeToDraynor', { chebyshev: cheb(L, D), eager, sdkWalkTo: sdkw });

    // Energy over a long run (both legs above plus this).
    if (!want('energy')) return;
    await tele(sdk, L.x, L.z);
    const tr = trace(sdk);
    await eagerWalk(sdk, D.x, D.z);
    await eagerWalk(sdk, L.x, L.z);
    tr.stop();
    result('movement.energy', { ticks: tr.rows.length, min: Math.min(...tr.rows.map(r => r.energy)), max: Math.max(...tr.rows.map(r => r.energy)) });
}, { timeout: 600_000 });
