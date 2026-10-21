// Monkey Madness, temple trapdoor reached from the floor above (docs/speedrun/research/quest-speedrun.md, row 1),
// and the zero-drain protect-prayer re-toggle (row 4), measured on the lab server.
// Run: bun docs/speedrun/scripts/quest-mm-temple-ladder.ts <botname> [segments, default LP] [reps, default 5]
//   L  ladder drop: from the temple approach (2795,2786) climb the south bamboo ladder (2794,2773),
//      walk on floor 1 to the tile east of the east ladder's top (2806,2785,1), climb down onto the
//      trapdoor's access tile, open the trapdoor (2807,2785) and climb down. Protect from Melee on.
//   P  prayer: stand on the access tile among the trapdoor guards for 100 ticks with Protect from Melee
//      held (control), then 100 ticks re-toggling it (off + on in one tick) every 4 ticks. Reports
//      prayer points drained and damage taken in each phase.
// The quest scripts gate neither the ladders (quest_mm.rs2:759-771) nor the trapdoor (mm_temple.rs2:1-17).

import { runScript } from '../../../sdk/runner';
import {
    cheat, give, locOpAt, now, pos, result, setstats, setvar, stats, tele, waitTicks, waitUntil,
} from './quest-gnome-lib';

const SEGS = (process.argv[3] ?? 'LP').toUpperCase().split('');
const REPS = Number(process.argv[4] ?? 5);
const PFM = 14; // protect_from_melee, sdk/types.ts PRAYER_INDICES

await runScript(async ({ bot, sdk }) => {
    const hp = () => sdk.getState()!.player!.hp;
    const pp = () => sdk.getState()!.prayers?.prayerPoints ?? -1;
    const reset = async (x: number, z: number, level = 0) => {
        await sdk.sendCloseModal();
        await waitTicks(sdk, 1);
        await cheat(sdk, '~clearinv');
        await setstats(sdk, { hitpoints: 70, prayer: 43 });
        await setvar(sdk, 'treequest', 9);
        await setvar(sdk, 'grandtree', 160);
        await setvar(sdk, 'mm_main', 3);
        await setvar(sdk, 'mm_zooknock', 5);
        await setvar(sdk, 'option_nodef', 1); // auto retaliate off
        await give(sdk, 'shark', 10);
        for (let k = 0; k < 5 && !(await tele(sdk, x, z, level)); k++) await waitTicks(sdk, 5);
        await waitTicks(sdk, 2);
    };
    const eatIfLow = async () => {
        if (hp() < 35) {
            const f = sdk.getState()!.inventory.find(i => /shark/i.test(i.name));
            if (f) await bot.eatFood(f);
        }
    };

    if (SEGS.includes('L')) {
        const totals: number[] = [];
        for (let rep = 1; rep <= REPS; rep++) {
            await reset(2795, 2786);
            await bot.activatePrayer('protect_from_melee');
            const hp0 = hp();
            const t0 = now(sdk);
            const up = await locOpAt(sdk, 2794, 2773, /climb/i, s => pos(s).level === 1, 40);
            const tUp = now(sdk);
            const at1 = pos(sdk.getState());
            const w = await bot.walkTo(2806, 2785, 0);
            const tWalk = now(sdk);
            const at1b = pos(sdk.getState());
            let down = { ticks: NaN, note: 'skipped' } as { ticks: number; note?: string };
            if (at1b.level === 1 && at1b.x === 2806 && at1b.z === 2785) {
                down = await locOpAt(sdk, 2805, 2785, /climb/i, s => pos(s).level === 0, 20);
            }
            const tDown = now(sdk);
            const landing = pos(sdk.getState());
            // Trapdoor: open, then climb down; re-click every 3 ticks (as quest-mm-atoll.ts segment T).
            let clicks = 0;
            let sent = -10;
            const r = await waitUntil(sdk, s => {
                if (pos(s).z > 9000) return true;
                if (s.tick - sent >= 3) {
                    sent = s.tick;
                    clicks++;
                    void sdk.scanNearbyLocs(5).then(ls => {
                        const l = ls.find(l => l.x === 2807 && l.z === 2785);
                        if (l) void sdk.sendInteractLoc(l.x, l.z, l.id, l.optionsWithIndex[0]?.opIndex ?? 1);
                    });
                }
                void eatIfLow();
                return false;
            }, 60);
            const tEnd = r?.tick ?? NaN;
            const total = tEnd - t0;
            if (Number.isFinite(total)) totals.push(total);
            result('ladder_drop', {
                rep, total, climbUp: tUp - t0, landedFloor1: at1, walkFloor1: tWalk - tUp, walkOk: w.success, walkMsg: w.success ? undefined : w.message,
                floor1End: at1b, climbDown: tDown - tWalk, downNote: down.note, landing, trapdoor: tEnd - tDown, trapdoorClicks: clicks,
                hpLost: hp0 - hp(), prayerUsed: 43 - pp(), below: pos(sdk.getState()),
            });
            await bot.deactivateAllPrayers();
        }
        result('ladder_drop_summary', stats(totals));
    }

    if (SEGS.includes('P')) {
        for (const mode of ['held', 'toggled'] as const) {
            await reset(2806, 2785);
            await bot.activatePrayer('protect_from_melee');
            await waitTicks(sdk, 1);
            const hp0 = hp();
            const pp0 = pp();
            const t0 = now(sdk);
            let last = t0;
            let toggles = 0;
            let unprotectedTicks = 0;
            let eaten = 0;
            await waitUntil(sdk, s => {
                if (s.tick - t0 >= 100) return true;
                if (!(s.prayers?.activePrayers?.[PFM] ?? false)) unprotectedTicks++;
                if (mode === 'toggled' && s.tick - last >= 4) {
                    last = s.tick;
                    toggles++;
                    // Off and on in the same tick: the drain timer is cleared and restarted (prayer.rs2:30-44).
                    void sdk.sendTogglePrayer(PFM);
                    void sdk.sendTogglePrayer(PFM);
                }
                if (s.player!.hp < 35) { eaten++; void eatIfLow(); }
                return false;
            }, 120);
            result('prayer_toggle', { mode, ticks: now(sdk) - t0, toggles, prayerUsed: pp0 - pp(), hpNet: hp0 - hp(), eaten, publishedTicksWithoutPfm: unprotectedTicks, at: pos(sdk.getState()) });
            await bot.deactivateAllPrayers();
        }
    }
}, { timeout: 1_800_000 });
