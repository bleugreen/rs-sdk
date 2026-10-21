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
import * as L from './quest-arthur-lab';
import { findLoc, getVar, now, result, setVar, tele, waitTicks, waitUntil } from './quest-regicide-lab';

const args = process.argv.slice(3).filter(a => !a.startsWith('-'));
const [att, str, def, hp] = [0, 1, 2, 3].map(i => Number(args[i] ?? 70));
const weapon = args[4] ?? 'rune_scimitar';
const runs = Number(args[5] ?? 3);

await runScript(async ({ bot, sdk }) => {
    await bot.dismissBlockingUI();
    await L.setStats(sdk, { attack: att, strength: str, defence: def, hitpoints: hp, agility: 56 });
    for (const item of sdk.getInventory()) await bot.dropItem(item, 'all');
    const gear = [weapon, 'rune_full_helm', 'rune_chainbody', 'rune_platelegs', 'rune_kiteshield', 'amulet_of_strength'];
    for (const g of gear) {
        const named = (i: { name: string }) => i.name.toLowerCase().replace(/ /g, '_') === g;
        if (sdk.getEquipment().some(named)) continue;
        await L.cheat(sdk, `give ${g} 1`, 1);
        await L.waitUntil(sdk, () => sdk.getInventory().some(named), 10);
        const it = sdk.getInventory().find(named);
        if (it) await bot.equipItem(it);
    }
    await sdk.sendSetCombatStyle(1);
    const rows = [];
    for (let run = 0; run < runs; run++) {
        await L.setStats(sdk, { attack: att, strength: str, defence: def, hitpoints: hp });
        if (sdk.countInventoryItems(/Swordfish/) < 8) await L.cheat(sdk, `give swordfish ${8 - sdk.countInventoryItems(/Swordfish/)}`, 1);
        await setVar(sdk, 'regicide_quest', 8);
        await setVar(sdk, 'regicide_bits', 0);
        await tele(sdk, 2234, 3149, 0);
        await waitTicks(sdk, 3);
        const loc = await findLoc(sdk, 2232, 3148, /Dense forest/);
        const t0 = now(sdk);
        await sdk.sendInteractLoc(loc!.x, loc!.z, loc!.id, 1);
        const spawn = await waitUntil(sdk, () => sdk.findNearbyNpc(/Tyras guard/) !== null, 20);
        const guard = sdk.findNearbyNpc(/Tyras guard/);
        if (!guard) { rows.push({ run, error: 'no guard' }); continue; }
        await waitUntil(sdk, s => s.player?.worldX === 2231, 10);
        await waitTicks(sdk, 3); // the cross-over's p_delay(3)
        const tf = now(sdk);
        await bot.attack(guard);
        let eaten = 0, levelUps = 0, minHp = hp;
        let dead: number | null = null;
        while (now(sdk) - tf < 800) {
            const s = sdk.getState()!;
            if (s.dialog.isOpen && L.isLevelUpDialog(sdk)) {
                levelUps++;
                await L.dismissLevelUps(sdk);
                const again = sdk.findNearbyNpc(/Tyras guard/);
                if (again) await bot.attack(again);
                continue;
            }
            const g = s.nearbyNpcs.find(n => /Tyras guard/.test(n.name));
            if (!g || (g.hp === 0)) { dead = s.tick; break; }
            minHp = Math.min(minHp, s.player!.hp);
            if (s.player!.hp < hp * 0.4) {
                await bot.eatFood(/Swordfish/);
                eaten++;
                const again = sdk.findNearbyNpc(/Tyras guard/);
                if (again) await bot.attack(again);
            }
            await sdk.waitForStateUpdate();
        }
        await waitTicks(sdk, 2);
        const stage = await getVar(sdk, 'regicide_quest');
        rows.push({ run, crossToSpawn: spawn ? spawn.tick - t0 : null, fight: dead ? dead - tf : null, minHp, eaten, levelUps, stage });
        result('guard-run', rows[rows.length - 1]);
        await waitTicks(sdk, 20); // out of combat before the next run
    }
    result('guard', { stats: `${att}/${str}/${def}/${hp}`, weapon, rows });
}, { timeout: 1_800_000 });
