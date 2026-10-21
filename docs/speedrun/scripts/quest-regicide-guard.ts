// Regicide: the old-camp guard. At %regicide_quest = 8 (spoken_tracker2), landing
// on (2231,3149) from the dense forest at (2232,3148) spawns a Tyras guard
// (regicide_old_camp_guard, level 110, 110 hp) that attacks (quest_regicide.rs2:
// 464-466, 602-610). Its death queue (tyras_guard.rs2:28-36) sets stage 9.
//
//   bun docs/speedrun/scripts/quest-regicide-guard.ts <bot> [att str def hp] [weapon] [runs]
//
// Defaults: 70/70/70, 70 hp, rune scimitar on aggressive, rune armour and an
// amulet of strength (the Merlin's Crystal set), swordfish eaten below 40% hp.

import { runScript } from '../../../sdk/runner';
import { dropItems, wield } from '../../../speedrun/lib/act';
import { fight } from '../../../speedrun/lib/combat';
import { currentTick, waitTicks, waitUntil } from '../../../speedrun/lib/wait';
import { findLoc, findNpc, worn } from '../../../speedrun/lib/world';
import { result } from '../../../speedrun/lab/record';
import { ensureItem, getvar, give, mustTele, setStats, setvar } from '../../../speedrun/lab/setup';

const args = process.argv.slice(3).filter(a => !a.startsWith('-'));
const [att, str, def, hp] = [0, 1, 2, 3].map(i => Number(args[i] ?? 70)) as [number, number, number, number];
const weapon = args[4] ?? 'rune_scimitar';
const runs = Number(args[5] ?? 3);
const GUARD = /Tyras guard/;

await runScript(async ({ bot, sdk }) => {
    await bot.dismissBlockingUI();
    await setStats(sdk, { attack: att, strength: str, defence: def, hitpoints: hp, agility: 56 });
    await dropItems(sdk, () => true);
    const gear = [weapon, 'rune_full_helm', 'rune_chainbody', 'rune_platelegs', 'rune_kiteshield', 'amulet_of_strength'];
    for (const g of gear) {
        const named = new RegExp(`^${g.replace(/_/g, ' ')}$`, 'i');
        if (worn(sdk, named)) continue;
        await give(sdk, g);
        await wield(sdk, named);
    }
    await sdk.sendSetCombatStyle(1);
    const rows = [];
    for (let run = 0; run < runs; run++) {
        await setStats(sdk, { attack: att, strength: str, defence: def, hitpoints: hp });
        await ensureItem(sdk, 'swordfish', /Swordfish/, 8);
        await setvar(sdk, 'regicide_quest', 8);
        await setvar(sdk, 'regicide_bits', 0);
        await mustTele(sdk, 2234, 3149, 0);
        await waitTicks(sdk, 3);
        const loc = await findLoc(sdk, { x: 2232, z: 3148, name: /Dense forest/ });
        if (!loc) throw new Error('no dense forest at 2232,3148');
        const t0 = currentTick(sdk);
        await sdk.sendInteractLoc(loc.x, loc.z, loc.id, 1);
        const spawn = await waitUntil(sdk, s => findNpc(s, GUARD) !== null, { maxTicks: 20 });
        const guard = findNpc(sdk, GUARD);
        if (!guard) { rows.push({ run, error: 'no guard' }); continue; }
        await waitUntil(sdk, s => s.player?.worldX === 2231, { maxTicks: 10 });
        await waitTicks(sdk, 3); // the cross-over's p_delay(3)
        // Eat below 40% hp; level-ups are dismissed on the tick they show, with the attack re-sent.
        const f = await fight(sdk, guard, { eatBelow: hp * 0.4, food: /Swordfish/, maxTicks: 800 });
        await waitTicks(sdk, 2);
        const stage = await getvar(sdk, 'regicide_quest');
        rows.push({ run, crossToSpawn: spawn.ok ? spawn.tick - t0 : null, fight: f.end === 'killed' ? f.ticks : null, end: f.end, minHp: f.minHp, eaten: f.eats, levelUps: f.levelUps, stage });
        result('guard-run', rows[rows.length - 1]);
        await waitTicks(sdk, 20); // out of combat before the next run
    }
    result('guard', { stats: `${att}/${str}/${def}/${hp}`, weapon, rows });
}, { timeout: 1_800_000 });
