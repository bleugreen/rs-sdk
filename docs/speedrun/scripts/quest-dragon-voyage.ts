// Dragon Slayer voyage: from the Port Sarim dock to standing inside Elvarg's
// lair gate, split into segments.
// Run: bun docs/speedrun/scripts/quest-dragon-voyage.ts <botname> [runs]
//
// Start state (set with ::setvar): %dragonquest 8 (map given to Ned),
// %dragon_ned_hired 1, %dragonquestvar 3 (hull patched), i.e. the state the
// player has after handing Ned the map (ned.rs2 give_map_to_ned).
// Segments:
//  board   click the gangplank (3047,3205) from the dock to standing on deck
//  ladder  climb down the deck ladder (3049,3208,1) to Ned's deck (level 3)
//  sail    talk to Ned, "Yep lets go!" (dragonslayer_ned.rs2:4-31): dialogue,
//          p_delay(11) and the 3 arrival pages, until the dialogue closes on Crandor
//  surface walk from the wreck to the rock opening (2833,3255) and climb down
//  dungeon walk to Elvarg's gate (2847,9637), open it, stand inside the lair

import { runScript } from '../../../sdk/runner';
import type { BotSDK } from '../../../sdk/index';
import type { BotWorldState, NearbyLoc } from '../../../sdk/types';
import { mustTele, setStats, setvar } from '../../../speedrun/lab/setup';
import { result } from '../../../speedrun/lab/record';
import { opLoc, talkTo, walkTo } from '../../../speedrun/lib/act';
import { converse, dialogueRuns, type ConverseResult } from '../../../speedrun/lib/converse';
import { currentTick, waitTicks } from '../../../speedrun/lib/wait';
import { findLoc, pos, tileCounter } from '../../../speedrun/lib/world';

const RUNS = Number(process.argv[3] ?? 2);

/**
 * The Lady Lumbridge's gangplank and deck ladder sit on a bridge-flagged map
 * level the lite client does not list, so a loc is addressed by tile and loc
 * id (loc.pack) when no listed loc matches; op 1 is its named option.
 */
async function locAt(sdk: BotSDK, x: number, z: number, id: number, name: string, op: string): Promise<NearbyLoc> {
    return (await findLoc(sdk, { x, z, id })) ?? { id, name, x, z, level: pos(sdk).level, distance: 0, options: [op], optionsWithIndex: [{ text: op, opIndex: 1 }] };
}

const inLair = (s: BotWorldState) => { const p = pos(s); return p.x >= 2847 && p.x <= 2863 && p.z > 9600 && p.z < 9650; };
const summary = (r: ConverseResult) => ({ ok: r.ok, opened: r.opened, ticks: r.opened ? r.ticks : null, pages: r.pages, options: r.options, levelUps: r.levelUps, runs: dialogueRuns(r.transcript), ...(r.reason ? { reason: r.reason } : {}) });

await runScript(async ({ bot, sdk }) => {
    const runs = [];
    for (let i = 0; i < RUNS; i++) {
        await setvar(sdk, 'dragonquest', 8);
        await setvar(sdk, 'dragon_ned_hired', 1);
        await setvar(sdk, 'dragonquestvar', 3);
        await setStats(sdk, { hitpoints: 99 });
        const run: Record<string, unknown> = {};

        // board
        await mustTele(sdk, 3047, 3203);
        await waitTicks(sdk, 3);
        const board = await opLoc(sdk, await locAt(sdk, 3047, 3205, 2593, 'Gangplank', 'Cross'), /^cross$/i, s => pos(s).level === 1, { maxTicks: 20 });
        run.board = { ticks: board.ok ? board.ticks : null, resends: board.resends, at: pos(sdk) };
        await waitTicks(sdk, 1);

        // ladder down to Ned's deck
        const ladder = await opLoc(sdk, await locAt(sdk, 3049, 3208, 2590, 'Ladder', 'Climb-down'), /^climb-down$/i, s => pos(s).level === 3, { maxTicks: 20 });
        run.ladder = { ticks: ladder.ok ? ladder.ticks : null, resends: ladder.resends, at: pos(sdk) };
        await waitTicks(sdk, 2);

        // sail
        // Ned's two pages and the choice, then p_delay(11) on the ship_journey
        // overlay, then three arrival pages (mesbox, Ned, player) on Crandor.
        // The conversation can end on the teleport before the arrival pages
        // open, so a second one answers them if they are still to come; the
        // segment ends where the last of the two did.
        const sail = await talkTo(sdk, /^ned$/i, [/Yep lets go/i], { until: s => pos(s).x < 2900, maxTicks: 80 });
        const arrival = await converse(sdk, [], { openTicks: 10, maxTicks: 60 });
        const sailEnd = arrival.opened ? arrival.endTick : sail.endTick;
        run.sail = { ...summary(sail), arrival: summary(arrival), ticks: sail.ok && sailEnd >= 0 ? sailEnd - sail.startTick : null };

        // Crandor surface: out through the broken hull (it does not block; see
        // quest-dragon-wreck-probe.ts) to the rock opening, and climb down.
        // bot.walkTo costs about 0.57 ticks per tile (primitives.md section 2),
        // so routeTiles is recorded to re-cost the walk at 0.5 for chained clicks.
        let t = currentTick(sdk);
        let rc = tileCounter(sdk, 3);
        const surfaceStart = pos(sdk);
        const w1 = await walkTo(bot, sdk, 2834, 3253, 1);
        const rock = await locAt(sdk, 2833, 3255, 2609, 'Rock opening', 'Climb-down');
        let tc = currentTick(sdk);
        const down = await opLoc(sdk, rock, /^climb-down$/i, s => pos(s).z > 9000, { maxTicks: 30 });
        rc.stop();
        run.surface = { from: surfaceStart, walk: w1.ok ? w1.ticks : w1.message, ticks: down.ok ? tc + down.ticks - t : null, routeTiles: rc.tiles, at: pos(sdk), hp: sdk.getState()!.player!.hp };
        await waitTicks(sdk, 1);

        // dungeon: to Elvarg's gate and through it
        t = currentTick(sdk);
        rc = tileCounter(sdk, 3);
        const w2 = await walkTo(bot, sdk, 2846, 9637, 1);
        const gate = await locAt(sdk, 2847, 9637, 2608, 'Gate', 'Open');
        tc = currentTick(sdk);
        const through = await opLoc(sdk, gate, /^open$/i, inLair, { maxTicks: 30 });
        rc.stop();
        run.dungeon = { walk: w2.ok ? w2.ticks : w2.message, ticks: through.ok ? tc + through.ticks - t : null, routeTiles: rc.tiles, at: pos(sdk), hp: sdk.getState()!.player!.hp, chat: sdk.getChat({ limit: 3 }).map(m => m.text) };

        const segs = ['board', 'ladder', 'sail', 'surface', 'dungeon'].map(k => (run[k] as { ticks: number | null }).ticks);
        run.total = segs.every(x => x !== null) ? (segs as number[]).reduce((a, b) => a + b, 0) : null;
        runs.push(run);
        console.log('run', i, JSON.stringify(run));
        // step back out so the next run starts clean
        await mustTele(sdk, 3047, 3203);
    }
    result('voyage', runs);
}, { timeout: 900_000 });
