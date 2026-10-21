// Monkey Madness, Ape Atoll entry as a human (docs/speedrun/quests/monkey_madness.md).
// The landing is cut off from the town on foot (the bamboo bridge north of it is
// one-way, quest_mm.rs2:1022-1043, and the west gate opens only for a monkey,
// quest_mm.rs2:1113-1117). A human gets in by being knocked out and jailed:
// walking the western corridor, the ravine archers knock you out on about 1 in 20
// of their shots (mm_archer.rs2:51-53), and you wake in the jail
// (mm_archer.rs2:66-83). Then pick the cell lock (mm_jail.rs2:1-11, Thieving
// stat_random) and leave before a patrolling jail guard punches you back in
// (mm_jail.rs2:181-203).
// Per run this records: ticks from the landing to the knockout, ticks from the
// knockout to waking in the cell, lock-pick attempts and ticks until outside
// the cell, and re-jailings.
// Run: bun docs/speedrun/scripts/quest-mm-jail.ts <botname> [runs=5] [thieving=20]

import { runScript } from '../../../sdk/runner';
import { opLoc } from '../../../speedrun/lib/act';
import { currentTick, waitTicks, waitUntil } from '../../../speedrun/lib/wait';
import { findLoc, messagesSince, pos, type StateLike } from '../../../speedrun/lib/world';
import { result, stats } from '../../../speedrun/lab/record';
import { clearInventory, give, setStats, setvar, tele } from '../../../speedrun/lab/setup';

const RUNS = Number(process.argv[3] ?? 5);
const THIEVING = Number(process.argv[4] ?? 20);

// Jail cell 0_43_43_18_41 .. 24_43 (mm_jail.rs2:49, mm_lumo.rs2:180); the pickable door is at (2771,2795).
const inCell = (s: StateLike) => {
    const p = pos(s);
    return p.level === 0 && p.x >= 2770 && p.x <= 2776 && p.z >= 2793 && p.z <= 2795;
};

await runScript(async ({ bot, sdk }) => {
    const runs: Array<Record<string, number | string | boolean>> = [];
    for (let i = 0; i < RUNS; i++) {
        await sdk.sendCloseModal();
        await setvar(sdk, 'mm_main', 3);
        await setStats(sdk, { hitpoints: 70, thieving: THIEVING });
        await clearInventory(sdk);
        await give(sdk, 'shark', 5);
        // The knockout leaves the player busy for a few ticks; retry the teleport until it lands.
        for (let k = 0; k < 5 && !(await tele(sdk, 2801, 2707)); k++) await waitTicks(sdk, 5);
        await waitTicks(sdk, 2);
        if (inCell(sdk)) { runs.push({ run: i, note: 'teleport failed' }); continue; }
        // 1. Walk the western corridor towards the west watchtower until knocked out.
        const t0 = currentTick(sdk);
        let koTick = -1;
        const unsubKo = sdk.onStateUpdate(s => {
            if (koTick < 0 && (s.player?.hp === 0 || s.player?.isDead)) koTick = s.tick;
        });
        void bot.walkTo(2713, 2767, 1, { timeout: 120_000 });
        const woke = await waitUntil(sdk, inCell, { maxTicks: 600 });
        unsubKo();
        if (!woke.ok) {
            runs.push({ run: i, note: 'no knockout within 600 ticks', pos: JSON.stringify(pos(sdk)) });
            continue;
        }
        const tWake = woke.tick;
        await waitTicks(sdk, 1);
        // 2. Pick the lock until outside the cell (z >= 2796), re-trying after each failure.
        let attempts = 0, rejailed = 0;
        const door = await findLoc(sdk, { x: 2771, z: 2795, radius: 10 });
        const tPick = currentTick(sdk);
        let out = false;
        while (!out && currentTick(sdk) - tPick < 300) {
            const d = await findLoc(sdk, { x: 2771, z: 2795, op: /pick/i, radius: 10 });
            if (d) {
                attempts++;
                await opLoc(sdk, d, /pick/i);
            }
            const r = await waitUntil(sdk, s => pos(s).z >= 2796 || messagesSince(s, s.tick, /fail to pick/i).length > 0, { maxTicks: 8 });
            if (r.ok && pos(r.state).z >= 2796) out = true;
            if (!out && !inCell(sdk)) rejailed++;
        }
        const tOut = currentTick(sdk);
        runs.push({
            run: i, toKnockout: koTick >= 0 ? koTick - t0 : 'n/a', knockoutToCell: koTick >= 0 ? tWake - koTick : 'n/a', landingToCell: tWake - t0,
            pickAttempts: attempts, pickTicks: tOut - tPick, out, rejailed, door: !!door,
        });
        console.log(JSON.stringify(runs.at(-1)));
    }
    const ok = runs.filter(r => r.out === true);
    result(`mm_jail_thieving_${THIEVING}`, {
        landingToCell: stats(ok.map(r => Number(r.landingToCell))), pickTicks: stats(ok.map(r => Number(r.pickTicks))), pickAttempts: stats(ok.map(r => Number(r.pickAttempts))), runs,
    });
}, { timeout: 3_600_000 });
