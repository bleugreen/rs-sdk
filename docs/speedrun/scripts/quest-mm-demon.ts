// Monkey Madness jungle demon from range (docs/speedrun/quests/monkey_madness.md).
// Sets Monkey Madness to stage 5 with Garkor's sigil (mm_main 5, mm_garkor 6),
// wears the sigil (teleport to the battle, squad, demon: mm_demon.rs2:1-165),
// turns on Protect from Magic, steps 6 tiles away so the demon only casts wave
// spells (melee is used within 2 tiles, mm_demon.rs2:332-340) and kills it with
// a bow or with combat spells. The fight is speedrun/lib/combat's: level-up
// pages are dismissed with the attack re-sent, a bow re-attacks after 8 ticks
// without dealing damage under the prayer, spells are cast every 5 ticks, and
// prayer potions are drunk below 15 points.
// Run: bun docs/speedrun/scripts/quest-mm-demon.ts <bot> <bow|magic> [level=70] [runs=3]
//   bow:   magic shortbow (base Ranged 50, tier50.rs2:6) + rune arrows.
//   magic: Fire Blast (Magic 59) on the demon each cast; runes given.

import { runScript } from '../../../sdk/runner';
import { Spells } from '../../../sdk/spells';
import { slotOf, wield } from '../../../speedrun/lib/act';
import { fight } from '../../../speedrun/lib/combat';
import { converse } from '../../../speedrun/lib/converse';
import { waitTicks, waitUntil, currentTick } from '../../../speedrun/lib/wait';
import { findNpc, invItem, pos, skillXp, worn } from '../../../speedrun/lib/world';
import { result, stats } from '../../../speedrun/lab/record';
import { clearInventory, give, mustTele, setStats, setvar } from '../../../speedrun/lab/setup';

const MODE = process.argv[3] ?? 'bow';
const LEVEL = Number(process.argv[4] ?? 70);
const RUNS = Number(process.argv[5] ?? 3);
const SPELL = (Spells as Record<string, number>)[process.env.SPELL ?? 'FIRE_BLAST'];
// server/engine/src/util/WorldConfig.ts:102 (node.xpRate).
const XP_RATE = 25;

await runScript(async ({ bot, sdk }) => {
    const samples: Array<Record<string, number | boolean | string>> = [];
    for (let run = 0; run < RUNS; run++) {
        await sdk.sendCloseModal();
        await waitTicks(sdk, 2);
        await clearInventory(sdk);
        await setStats(sdk, { attack: 70, strength: 70, defence: 70, hitpoints: 70, prayer: 43, ranged: MODE === 'bow' ? LEVEL : 1, magic: MODE === 'magic' ? LEVEL : 1 });
        if (MODE === 'bow') {
            await give(sdk, 'magic_shortbow', 1);
            await give(sdk, 'rune_arrow', 300);
        } else {
            await give(sdk, 'airrune', 600);
            await give(sdk, 'firerune', 800);
            await give(sdk, 'deathrune', 200);
            await give(sdk, 'bloodrune', 200);
        }
        await give(sdk, '4doseprayerrestore', 6);
        await give(sdk, 'shark', 8);
        await waitTicks(sdk, 2);
        for (const re of [/shortbow/i, /rune arrow/i]) {
            if (invItem(sdk, re)) await wield(sdk, re);
        }
        await setvar(sdk, 'mm_main', 5);
        await setvar(sdk, 'mm_garkor', 6);
        await setvar(sdk, 'mm_waiting_for_final_battle', 0);
        // Out of the battle zone long enough for an earlier run's squad and demon to despawn. Wait at
        // the Ape Atoll landing: a human next to Garkor gets knocked out into the jail, and from
        // Lumbridge the sigil did not fire in the lab (mm_sigil_valid_teleport, mm_demon.rs2:7-14,
        // has no explicit return(true)).
        await sdk.sendCloseModal();
        const sigilWorn = worn(sdk, /sigil/i);
        if (sigilWorn) await bot.unequipItem(sigilWorn.name);
        await mustTele(sdk, 2801, 2707);
        await waitTicks(sdk, 30);
        // Again: a previous kill's queued stage change (mm_demon.rs2:387-389) can land after the first set.
        await setvar(sdk, 'mm_main', 5);
        await setvar(sdk, 'mm_waiting_for_final_battle', 0);
        await give(sdk, 'mm_sigil', 1);
        await waitTicks(sdk, 2);
        const tWear = currentTick(sdk);
        const d = converse(sdk, [], { idle: 3, openTicks: 80, closeModals: true });
        await sdk.sendUseItem(slotOf(sdk, /sigil/i), 2);
        await d;
        const sp = await waitUntil(sdk, s => findNpc(s, /^Jungle Demon$/i) !== null, { maxTicks: 60 });
        if (!sp.ok) {
            const s = sdk.getState()!;
            samples.push({ run, note: 'no demon', pos: JSON.stringify(pos(s)), msgs: s.gameMessages.slice(-4).map(m => m.text).join(' | '), inv: s.inventory.map(i => i.name).join(',') });
            continue;
        }
        const tSpawn = sp.tick;
        await bot.activatePrayer('protect_from_magic');
        const dm = findNpc(sdk, /^Jungle Demon$/i)!;
        const p = pos(sdk);
        await sdk.sendWalk(p.x + (Math.sign(p.x - dm.x) || 1) * 6, p.z + (Math.sign(p.z - dm.z) || 1) * 6, true);
        await waitTicks(sdk, 4);
        const skill = MODE === 'bow' ? 'ranged' : 'magic';
        const xp0 = skillXp(sdk, skill);
        const f = await fight(sdk, dm, {
            ...(MODE === 'magic' ? { spell: SPELL, castEvery: 5 } : {}),
            prayer: 'protect_from_magic', drinkBelow: 15, stallTicks: 8,
            eatBelow: 35, food: 'shark', maxTicks: 2000, onDialog: 'continue',
        });
        const killed = f.end === 'killed' || f.end === 'gone';
        const xpBase = Math.round((skillXp(sdk, skill) - xp0) / XP_RATE);
        samples.push({ run, killed, ticks: f.ticks, wearToSpawn: tSpawn - tWear, damage: f.taken, died: f.died, levelUps: f.levelUps, potionDoses: f.prayerDoses, food: f.eats, xpBase });
        console.log(JSON.stringify(samples.at(-1)));
        await bot.deactivateAllPrayers();
        await waitTicks(sdk, 5);
    }
    const ok = samples.filter(s => s.killed === true);
    result(`mm_demon_${MODE}_${LEVEL}`, { kills: ok.length, of: samples.length, ticks: stats(ok.map(s => Number(s.ticks))), damage: stats(samples.map(s => Number(s.damage ?? 0))), samples });
}, { timeout: 3_600_000 });
