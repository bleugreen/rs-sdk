// Lab check of a firemaking row before any dropper is involved (rs/228 plan step 4.1). One bot drops
// a log on every candidate tile in lighting order (its own drops are visible to it at once, and gone
// only at 300 ticks), walks back to where the account would stand, then lights them with
// speedrun/skills/firemaking.ts's own loop at a level where every roll succeeds. So every gap
// other than 4 ticks is the row's geometry (a long step, a turn) or a refused tile, and the
// refusals are the tiles to take out of the planned list.
//
//   NODE_TICKRATE=300 speedrun/lab/lab.sh <bot> speedrun/lab/firemaking-row.ts[:--tiles=<list>]
//
// options: --tiles=<parseTiles list> (default LUMBRIDGE_CANDIDATES), --level=80 (rolls are certain
//   from 43), --logs=magic_logs, --start=3222,3222 (the spawn tile a parked account stands on),
//   --out=<dir> (tick log and per-tick trace; default a fresh directory in $TMPDIR)
//
// It ends when nothing is left to light (the module's maxGap give-up, here 12 ticks) and prints
// RESULT row-check with every refused tile, every gap that wasn't 4 and the tile it ended on.

import { appendFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runScript } from '../../sdk/runner';
import { TickLog, newRunId } from '../lib/ticks';
import { waitUntil } from '../lib/wait';
import type { StepContext } from '../runner/step';
import { lightRow, parseTiles, resolveOptions, TIERS, type Tile } from '../skills/firemaking';
import { arg, botArg, result } from './common';
import { cheat, clearInventory, give, mustTele, setstat } from './setup';

/**
 * The closed lap beside the Lumbridge spawn, with the tiles the map read says refuse a fire left
 * in so the lab confirms them: west along z=3219 from the entry to 3214 (3217 is a wall loc), east
 * along z=3218 to 3243 (3217 again), then west along z=3219 from 3242 (grass decor at 3241 and
 * 3237-3239) back to the entry.
 */
export const LUMBRIDGE_CANDIDATES = '3222-3214@3219;3214-3243@3218;3242-3223@3219';

const bot = botArg();
const tiles = parseTiles(arg('tiles', LUMBRIDGE_CANDIDATES));
const level = Number(arg('level', '80'));
const logs = arg('logs', 'magic_logs');
const [sx, sz] = arg('start', '3222,3222').split(',').map(Number) as [number, number];
const out = arg('out', '') || mkdtempSync(join(tmpdir(), 'fm-row-check-'));
const tier = TIERS.find(t => t.obj === logs);
if (!tier) throw new Error(`--logs must be one of ${TIERS.map(t => t.obj).join(', ')}`);
const isLog = (n: string) => n.toLowerCase() === tier.name.toLowerCase();

await runScript(async ({ bot: actions, sdk }) => {
    await actions.skipTutorial().catch(() => {});
    while (sdk.getState()?.dialog.isOpen) {
        await sdk.sendClickDialog(0);
        await sdk.waitForTicks(1);
    }
    const at = (t: Tile) => sdk.getState()?.player?.worldX === t[0] && sdk.getState()?.player?.worldZ === t[1];
    await clearInventory(sdk);
    await give(sdk, 'tinderbox');
    await setstat(sdk, 'firemaking', level);

    // ---- drop one log per tile, in lighting order
    await mustTele(sdk, tiles[0]![0], tiles[0]![1]);
    const t0 = sdk.getState()!.tick;
    const dropped: Tile[] = [];
    for (const tile of tiles) {
        if (!sdk.getState()!.inventory.some(i => isLog(i.name))) {
            await cheat(sdk, `give ${logs} 27`);
            await waitUntil(sdk, s => s.inventory.filter(i => isLog(i.name)).length >= 20, { maxTicks: 10 });
        }
        if (!at(tile)) {
            await sdk.sendWalk(tile[0], tile[1], true);
            if (!(await waitUntil(sdk, () => at(tile), { maxTicks: 8 })).ok) await mustTele(sdk, tile[0], tile[1]);
        }
        const item = sdk.getState()!.inventory.find(i => isLog(i.name))!;
        await sdk.sendDropItem(item.slot);
        const r = await waitUntil(sdk, s => s.groundItems.some(g => g.x === tile[0] && g.z === tile[1] && isLog(g.name)), { maxTicks: 5 });
        if (r.ok) dropped.push(tile);
        else console.log(`drop on ${tile} not seen`);
    }
    const dropTicks = sdk.getState()!.tick - t0;
    console.log(`dropped ${dropped.length}/${tiles.length} in ${dropTicks} ticks; files in ${out}`);

    // ---- stand where the account would, then light with the module's loop
    await mustTele(sdk, sx, sz);
    sdk.onStateUpdate(s => {
        const p = s.player;
        if (p) appendFileSync(join(out, 'trace.jsonl'), JSON.stringify({ t: s.tick, x: p.worldX, z: p.worldZ, anim: p.animId, run: p.runEnergy, msg: s.gameMessages.slice(-2).map(m => m.text) }) + '\n');
    });
    const log = TickLog.open(`lab-fm-row-check-${newRunId()}`, join(out, 'ticks.jsonl'));
    const ctx = { session: { sdk, bot: actions, name: bot, sessionId: 1 }, sdk, bot: actions, c: {}, log } as unknown as StepContext<any>;
    const o = resolveOptions({ id: 'row-check', tiles, maxGap: 12, waitForRow: 30 });
    let ended = 'reached the target level';
    await lightRow(ctx, o).catch(e => (ended = String(e)));

    const fires = log.rows.filter(r => r.step === 'row-check fire').map(r => r.meta as { n: number; tile: Tile; gap: number | null; fresh: boolean; send: number | null; slip: number });
    const refused = log.rows.filter(r => r.step === 'row-check refused').map(r => (r.meta as { tile: Tile }).tile);
    const gaps: Record<number, number> = {};
    for (const f of fires) if (f.gap !== null) gaps[f.gap] = (gaps[f.gap] ?? 0) + 1;
    const summary = log.rows.find(r => r.step === 'row-check summary')?.meta;
    result('row-check', {
        tiles: tiles.length, dropped: dropped.length, dropTicks, fires: fires.length, ended,
        refused: refused.map(t => t.join(',')),
        gaps,
        offBeat: fires.filter(f => f.gap !== null && f.gap !== 4).map(f => ({ n: f.n, tile: f.tile.join(','), gap: f.gap, fresh: f.fresh, send: f.send })),
        first: fires[0] ? { tile: fires[0].tile.join(','), fixedTicks: summary?.fixedTicks } : null,
        summary
    });
}, { timeout: 0, printState: false });
