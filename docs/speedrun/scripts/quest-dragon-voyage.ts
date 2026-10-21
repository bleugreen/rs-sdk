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
import { cheat, now, pos, result, tele, waitTicks, waitUntil } from './quest-primitives-lib';
import { clickLoc, converseSeq, routeCounter, talk } from './quest-dragon-lib';

const RUNS = Number(process.argv[3] ?? 2);

await runScript(async ({ bot, sdk }) => {
    const runs = [];
    for (let i = 0; i < RUNS; i++) {
        for (const v of ['dragonquest 8', 'dragon_ned_hired 1', 'dragonquestvar 3']) { await cheat(sdk, 'setvar ' + v); await waitTicks(sdk, 1); }
        await cheat(sdk, 'setstat hitpoints 99'); await waitTicks(sdk, 1);
        const run: Record<string, unknown> = {};

        // board
        await tele(sdk, 3047, 3203);
        await waitTicks(sdk, 3);
        let t = now(sdk);
        await clickLoc(sdk, /^gangplank$/i, /^cross$/i, undefined, { x: 3047, z: 3205, id: 2593, op: 1 });
        let r = await waitUntil(sdk, s => pos(s).level === 1, 20);
        run.board = { ticks: r ? r.tick - t : null, at: pos(sdk.getState()) };
        await waitTicks(sdk, 1);

        // ladder down to Ned's deck
        t = now(sdk);
        await clickLoc(sdk, /^ladder$/i, /^climb-down$/i, { x: 3049, z: 3208 }, { x: 3049, z: 3208, id: 2590, op: 1 });
        r = await waitUntil(sdk, s => pos(s).level === 3, 20);
        run.ladder = { ticks: r ? r.tick - t : null, at: pos(sdk.getState()) };
        await waitTicks(sdk, 2);

        // sail
        // Ned's two pages and the choice, then p_delay(11) on the ship_journey
        // overlay, then three arrival pages (mesbox, Ned, player) on Crandor.
        const tSail = now(sdk);
        const sail = await converseSeq(sdk, () => talk(sdk, /^ned$/i), [/Yep lets go/i], s => pos(s).x < 2900, 80);
        const arrival = await converseSeq(sdk, async () => {}, [], s => !s.dialog.isOpen, 60);
        run.sail = { ...sail, arrival, ticks: now(sdk) - tSail };

        // Crandor surface: out through the broken hull (it does not block; see
        // quest-dragon-wreck-probe.ts) to the rock opening, and climb down.
        // bot.walkTo costs about 0.57 ticks per tile (primitives.md section 2),
        // so routeTiles is recorded to re-cost the walk at 0.5 for chained clicks.
        t = now(sdk);
        let rc = routeCounter(sdk);
        const surfaceStart = pos(sdk.getState());
        const w1 = await bot.walkTo(2834, 3253, 1, { timeout: 60_000 });
        const tWalk1 = now(sdk) - t;
        await clickLoc(sdk, /^rock opening$/i, /^climb-down$/i, undefined, { x: 2833, z: 3255, id: 2609, op: 1 });
        r = await waitUntil(sdk, s => pos(s).z > 9000, 30);
        rc.stop();
        run.surface = { from: surfaceStart, walk: w1.success ? tWalk1 : w1.message, ticks: r ? r.tick - t : null, routeTiles: rc.tiles, at: pos(sdk.getState()), hp: sdk.getState()!.player!.hp };
        await waitTicks(sdk, 1);

        // dungeon: to Elvarg's gate and through it
        t = now(sdk);
        rc = routeCounter(sdk);
        const w2 = await bot.walkTo(2846, 9637, 1, { timeout: 60_000 });
        const tWalk2 = now(sdk) - t;
        await clickLoc(sdk, /^gate$/i, /^open$/i, { x: 2847, z: 9637 }, { x: 2847, z: 9637, id: 2608, op: 1 });
        r = await waitUntil(sdk, s => pos(s).x >= 2847 && pos(s).x <= 2863 && pos(s).z > 9600 && pos(s).z < 9650, 30);
        rc.stop();
        run.dungeon = { walk: w2.success ? tWalk2 : w2.message, ticks: r ? r.tick - t : null, routeTiles: rc.tiles, at: pos(sdk.getState()), hp: sdk.getState()!.player!.hp, chat: sdk.getChat({ limit: 3 }).map(m => m.text) };

        const segs = ['board', 'ladder', 'sail', 'surface', 'dungeon'].map(k => (run[k] as { ticks: number | null }).ticks);
        run.total = segs.every(x => x !== null) ? (segs as number[]).reduce((a, b) => a + b, 0) : null;
        runs.push(run);
        console.log('run', i, JSON.stringify(run));
        // step back out so the next run starts clean
        await tele(sdk, 3047, 3203);
    }
    result('voyage', runs);
}, { timeout: 900_000 });
