// The Dig Site's three random finds, measured per attempt and per find:
//   A. pickpocketing a workman until both Rock sample 1 and a Specimen brush
//      are in the pack (quest stage 2, digsite_workman.rs2:48-116)
//   B. panning until Rock sample 2 (stage 2, tea already given, area_digsite.rs2:5-69)
//   C. digging a level 3 site with a trowel until the Talisman of Zaros
//      (stage 5, area_digsite.rs2:400-507)
//
//   BOTS=dig16 docs/speedrun/scripts/quest-lab-session.sh \
//       bun docs/speedrun/scripts/quest-digsite-finds.ts dig16 [trials] [thieving]
//
// Each trial resets the inventory and the quest varps, so the attempt counts
// are independent draws. The script reacts to each result as soon as the
// state shows it, so the ticks per attempt include a bot's own latency.
import { runScript } from '../../../sdk/runner';
import { cheat, clearInv, drainChat, findLoc, findNpcWithOp, geometric, give, has, invSlot, runDialog, stats, tele, tick, waitForMessage } from './quest-lab';

const TRIALS = parseInt(process.argv[3] ?? '10');
const THIEVING = parseInt(process.argv[4] ?? '25');

await runScript(async ({ bot, sdk }) => {
    await sdk.waitForReady(60_000);
    await bot.skipTutorial();
    await cheat(sdk, 'setstat hitpoints 99');
    await cheat(sdk, `setstat thieving ${THIEVING}`);
    await cheat(sdk, 'setstat herblore 10');
    await cheat(sdk, 'setstat agility 10');

    // ---------- A: pickpocket workman ----------
    const pickTrials: { attempts: number; successes: number; ticks: number }[] = [];
    const pickGaps: number[] = [];
    let pickOk = 0, pickTotal = 0;
    for (let t = 0; t < TRIALS; t++) {
        await clearInv(sdk);
        await cheat(sdk, 'setvar itexamlevel 2');
        await tele(sdk, 3360, 3393);
        drainChat(sdk);
        let attempts = 0, successes = 0;
        const t0 = tick(sdk);
        let last = t0;
        while (!(has(sdk, /^Rock sample 1$/) && has(sdk, /^Specimen brush$/))) {
            const w = findNpcWithOp(sdk, /^Digsite workman$/, /pickpocket/i);
            if (!w) { await sdk.waitForTicks(1); continue; }
            await sdk.sendInteractNpc(w.npc.index, w.opIndex);
            const m = await waitForMessage(sdk, [/You steal|You find a specimen|You fail to pick/], 40);
            if (!m) continue;
            if (sdk.getState()!.dialog.isOpen) await sdk.sendClickDialog(0);
            attempts++;
            pickTotal++;
            if (!/fail/.test(m.text)) { successes++; pickOk++; }
            // A failed attempt stuns for 8 ticks (digsite_workman.rs2:79-80) and a
            // click during the stun is dropped, so wait it out before clicking.
            else await sdk.waitForTicks(8);
            const now = tick(sdk);
            pickGaps.push(now - last);
            last = now;
        }
        pickTrials.push({ attempts, successes, ticks: tick(sdk) - t0 });
        console.log(`pickpocket trial ${t}: ${attempts} attempts, ${successes} successes, ${tick(sdk) - t0} ticks`);
    }

    // ---------- B: panning ----------
    const panTrials: { pans: number; ticks: number }[] = [];
    const panCycle: number[] = [];
    for (let t = 0; t < TRIALS; t++) {
        await clearInv(sdk);
        await cheat(sdk, 'setvar itexamlevel 2');
        await cheat(sdk, 'setvar itexam_bits 2'); // bit 1: tea given to the panning guide
        await give(sdk, 'tray_empty');
        await tele(sdk, 3377, 3373);
        let pans = 0;
        const t0 = tick(sdk);
        while (!has(sdk, /^Rock sample 2$/)) {
            const c0 = tick(sdk);
            const point = await findLoc(sdk, /panning point/i, () => true, 6);
            if (!point) throw new Error('no panning point');
            drainChat(sdk);
            await sdk.sendInteractLoc(point.x, point.z, point.id, 1);
            await sdk.waitForCondition(s => s.inventory.some(i => i.name === 'Panning tray' && i.optionsWithIndex.some(o => /search/i.test(o.text))) && s.dialog.isOpen, 30_000)
                .catch(() => null);
            await runDialog(sdk, [], { settleTicks: 1 });
            const tray = sdk.getInventory().find(i => i.name === 'Panning tray');
            const searchOp = tray?.optionsWithIndex.find(o => /search/i.test(o.text));
            if (!tray || !searchOp) throw new Error('no muddy tray');
            drainChat(sdk);
            await sdk.sendUseItem(tray.slot, searchOp.opIndex);
            await waitForMessage(sdk, [/search the contents/], 10);
            await sdk.waitForCondition(s => s.dialog.isOpen, 10_000).catch(() => null);
            await runDialog(sdk, [], { settleTicks: 1 });
            pans++;
            panCycle.push(tick(sdk) - c0);
            if (sdk.getInventory().length > 25) { const keep = has(sdk, /^Rock sample 2$/); await clearInv(sdk); await give(sdk, 'tray_empty'); if (keep) await give(sdk, 'rock_sample2'); }
        }
        panTrials.push({ pans, ticks: tick(sdk) - t0 });
        console.log(`panning trial ${t}: ${pans} pans, ${tick(sdk) - t0} ticks`);
    }

    // ---------- C: level 3 dig ----------
    const digTrials: { digs: number; ticks: number }[] = [];
    const digCycle: number[] = [];
    const tools = async () => { await give(sdk, 'trowel'); await give(sdk, 'specimen_jar'); await give(sdk, 'specimen_brush'); };
    for (let t = 0; t < TRIALS; t++) {
        await clearInv(sdk);
        await cheat(sdk, 'setvar itexamlevel 5');
        await cheat(sdk, 'setvar itexam_bits 0');
        await tools();
        await tele(sdk, 3353, 3410);
        let digs = 0;
        const t0 = tick(sdk);
        while (!has(sdk, /^Talisman of zaros$/i)) {
            const c0 = tick(sdk);
            const soil = await findLoc(sdk, /soil/i, l => l.x >= 3350 && l.x <= 3357 && l.z >= 3404 && l.z <= 3412, 8);
            if (!soil) throw new Error('no level 3 soil');
            const trowel = invSlot(sdk, /^Trowel$/)!;
            drainChat(sdk);
            await sdk.sendUseItemOnLoc(trowel.slot, soil.x, soil.z, soil.id);
            const m = await waitForMessage(sdk, [/You find|You carefully clean/], 30);
            if (!m) { console.log('dig: no result message'); continue; }
            await sdk.waitForTicks(1);
            if (sdk.getState()!.dialog.isOpen) await runDialog(sdk, [], { settleTicks: 1 });
            digs++;
            digCycle.push(tick(sdk) - c0);
            if (sdk.getInventory().length > 25) { const keep = has(sdk, /^Talisman of zaros$/i); await clearInv(sdk); await tools(); if (keep) await give(sdk, 'digtalisman'); }
        }
        digTrials.push({ digs, ticks: tick(sdk) - t0 });
        console.log(`dig trial ${t}: ${digs} digs, ${tick(sdk) - t0} ticks`);
    }

    const summary = {
        thieving: THIEVING,
        pickpocket: {
            successRate: +(pickOk / pickTotal).toFixed(3),
            ticksPerAttempt: stats(pickGaps),
            attemptsPerTrial: stats(pickTrials.map(x => x.attempts)),
            successesPerTrial: stats(pickTrials.map(x => x.successes)),
            ticksPerTrial: stats(pickTrials.map(x => x.ticks)),
        },
        panning: {
            ticksPerPan: stats(panCycle),
            pansPerTrial: stats(panTrials.map(x => x.pans)),
            ticksPerTrial: stats(panTrials.map(x => x.ticks)),
            analytic: geometric(3 / 40),
        },
        dig: {
            ticksPerDig: stats(digCycle),
            digsPerTrial: stats(digTrials.map(x => x.digs)),
            ticksPerTrial: stats(digTrials.map(x => x.ticks)),
            analytic: geometric(1 / 20),
        },
    };
    console.log('SUMMARY ' + JSON.stringify(summary, null, 2));
}, { timeout: 3_600_000 });
