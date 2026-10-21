// The Dig Site's three random finds, measured per attempt and per find:
//   A. pickpocketing a workman until both Rock sample 1 and a Specimen brush
//      are in the pack (quest stage 2, digsite_workman.rs2:48-116)
//   B. panning until Rock sample 2 (stage 2, tea already given, area_digsite.rs2:5-69)
//   C. digging a level 3 site with a trowel until the Talisman of Zaros
//      (stage 5, area_digsite.rs2:400-507)
//
//   BOTS=dig16 docs/speedrun/scripts/quest-digsite-lab-session.sh \
//       bun docs/speedrun/scripts/quest-digsite-finds.ts dig16 [trials] [thieving]
//
// Each trial resets the inventory and the quest varps, so the attempt counts
// are independent draws. The script reacts to each result as soon as the
// state shows it, so the ticks per attempt include a bot's own latency.
import { runScript } from '../../../sdk/runner';
import type { BotWorldState } from '../../../sdk/types';
import { converse } from '../../../speedrun/lib/converse';
import { pageText } from '../../../speedrun/lib/dialogue';
import { currentTick, waitUntil } from '../../../speedrun/lib/wait';
import { invItem, messagesSince, opIndex } from '../../../speedrun/lib/world';
import { clearInventory, give, mustTele, setStats, setvar } from '../../../speedrun/lab/setup';
import { geometric, stats } from '../../../speedrun/lab/record';

const TRIALS = parseInt(process.argv[3] ?? '10');
const THIEVING = parseInt(process.argv[4] ?? '25');

/**
 * The text of a result seen since `tick`: a game message, or an open page's
 * words (item boxes, ~objbox, announce some results without a chat line).
 */
function resultSince(s: BotWorldState, tick: number, re: RegExp): string | null {
    const m = messagesSince(s, tick, re)[0];
    if (m !== undefined) return m;
    const page = pageText(s.dialog);
    return page && re.test(page) ? page : null;
}

const PICKPOCKET = /steal-from|pick.?pocket/i;

await runScript(async ({ bot, sdk }) => {
    await sdk.waitForReady(60_000);
    await bot.skipTutorial();
    await setStats(sdk, { hitpoints: 99, thieving: THIEVING, herblore: 10, agility: 10 });
    const has = (re: RegExp) => invItem(sdk, re) !== null;

    // ---------- A: pickpocket workman ----------
    const pickTrials: { attempts: number; successes: number; ticks: number }[] = [];
    const pickGaps: number[] = [];
    let pickOk = 0, pickTotal = 0;
    for (let t = 0; t < TRIALS; t++) {
        await clearInventory(sdk);
        await setvar(sdk, 'itexamlevel', 2);
        await mustTele(sdk, 3360, 3393);
        if (t === 0) console.log('near workman:', sdk.getNearbyNpcs().slice(0, 8).map(n => `${n.name}[${n.optionsWithIndex.map(o => o.text).join('/')}]`).join(', '));
        let attempts = 0, successes = 0;
        const t0 = currentTick(sdk);
        let last = t0;
        let misses = 0;
        while (!(has(/^Rock sample 1$/) && has(/^Specimen brush$/))) {
            const w = sdk.getState()!.nearbyNpcs.filter(n => /workman/i.test(n.name) && opIndex(n, PICKPOCKET) !== undefined).sort((a, b) => a.distance - b.distance)[0];
            if (!w) {
                if (++misses > 30) throw new Error('no workman with a pickpocket option in view');
                await sdk.waitForTicks(1);
                continue;
            }
            const sent = currentTick(sdk) + 1;
            await sdk.sendInteractNpc(w.index, opIndex(w, PICKPOCKET)!);
            const r = await waitUntil(sdk, s => resultSince(s, sent, /You steal|You find a specimen|You fail to pick/) !== null, { maxTicks: 40 });
            if (!r.ok) { console.log('pickpocket: no result seen'); continue; }
            const text = resultSince(r.state, sent, /You steal|You find a specimen|You fail to pick/)!;
            if (sdk.getState()!.dialog.isOpen) await converse(sdk, [], { idle: 1 });
            attempts++;
            pickTotal++;
            if (!/fail/.test(text)) { successes++; pickOk++; }
            // A failed attempt stuns for 8 ticks (digsite_workman.rs2:79-80) and a
            // click during the stun is dropped, so wait it out before clicking.
            else await sdk.waitForTicks(8);
            const now = currentTick(sdk);
            pickGaps.push(now - last);
            last = now;
        }
        pickTrials.push({ attempts, successes, ticks: currentTick(sdk) - t0 });
        console.log(`pickpocket trial ${t}: ${attempts} attempts, ${successes} successes, ${currentTick(sdk) - t0} ticks`);
    }

    // ---------- B: panning ----------
    const panTrials: { pans: number; ticks: number }[] = [];
    const panCycle: number[] = [];
    for (let t = 0; t < TRIALS; t++) {
        await clearInventory(sdk);
        await setvar(sdk, 'itexamlevel', 2);
        await setvar(sdk, 'itexam_bits', 2); // bit 1: tea given to the panning guide
        await give(sdk, 'tray_empty');
        await mustTele(sdk, 3377, 3373);
        let pans = 0;
        const t0 = currentTick(sdk);
        while (!has(/^Rock sample 2$/)) {
            const c0 = currentTick(sdk);
            const point = (await sdk.scanNearbyLocs(6)).filter(l => /panning point/i.test(l.name)).sort((a, b) => a.distance - b.distance)[0];
            if (!point) throw new Error('no panning point');
            await sdk.sendInteractLoc(point.x, point.z, point.id, 1);
            await waitUntil(sdk, s => s.inventory.some(i => i.name === 'Panning tray' && opIndex(i, /search/i) !== undefined) && s.dialog.isOpen, { maxTicks: 100 });
            await converse(sdk, [], { idle: 1 });
            const tray = sdk.getInventory().find(i => i.name === 'Panning tray');
            const searchOp = tray && opIndex(tray, /search/i);
            if (!tray || searchOp === undefined) throw new Error('no muddy tray');
            const sent = currentTick(sdk) + 1;
            await sdk.sendUseItem(tray.slot, searchOp);
            await waitUntil(sdk, s => resultSince(s, sent, /search the contents/) !== null, { maxTicks: 10 });
            await waitUntil(sdk, s => s.dialog.isOpen, { maxTicks: 30 });
            await converse(sdk, [], { idle: 1 });
            pans++;
            panCycle.push(currentTick(sdk) - c0);
            if (sdk.getInventory().length > 25) { const keep = has(/^Rock sample 2$/); await clearInventory(sdk); await give(sdk, 'tray_empty'); if (keep) await give(sdk, 'rock_sample2'); }
        }
        panTrials.push({ pans, ticks: currentTick(sdk) - t0 });
        console.log(`panning trial ${t}: ${pans} pans, ${currentTick(sdk) - t0} ticks`);
    }

    // ---------- C: level 3 dig ----------
    const digTrials: { digs: number; ticks: number }[] = [];
    const digCycle: number[] = [];
    const tools = () => give(sdk, ['trowel', 'specimen_jar', 'specimen_brush']);
    for (let t = 0; t < TRIALS; t++) {
        await clearInventory(sdk);
        await setvar(sdk, 'itexamlevel', 5);
        await setvar(sdk, 'itexam_bits', 0);
        await tools();
        await mustTele(sdk, 3353, 3410);
        let digs = 0;
        const t0 = currentTick(sdk);
        while (!has(/^Talisman of zaros$/i)) {
            const c0 = currentTick(sdk);
            const soil = (await sdk.scanNearbyLocs(8)).filter(l => /soil/i.test(l.name) && l.x >= 3350 && l.x <= 3357 && l.z >= 3404 && l.z <= 3412).sort((a, b) => a.distance - b.distance)[0];
            if (!soil) throw new Error('no level 3 soil');
            const trowel = invItem(sdk, /^Trowel$/)!;
            const sent = currentTick(sdk) + 1;
            await sdk.sendUseItemOnLoc(trowel.slot, soil.x, soil.z, soil.id);
            const r = await waitUntil(sdk, s => resultSince(s, sent, /You find|You carefully clean/) !== null, { maxTicks: 30 });
            if (!r.ok) { console.log('dig: no result message'); continue; }
            await sdk.waitForTicks(1);
            if (sdk.getState()!.dialog.isOpen) await converse(sdk, [], { idle: 1 });
            digs++;
            digCycle.push(currentTick(sdk) - c0);
            if (sdk.getInventory().length > 25) { const keep = has(/^Talisman of zaros$/i); await clearInventory(sdk); await tools(); if (keep) await give(sdk, 'digtalisman'); }
        }
        digTrials.push({ digs, ticks: currentTick(sdk) - t0 });
        console.log(`dig trial ${t}: ${digs} digs, ${currentTick(sdk) - t0} ticks`);
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
