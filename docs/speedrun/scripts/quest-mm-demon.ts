// Monkey Madness jungle demon from range (docs/speedrun/quests/monkey_madness.md).
// Sets Monkey Madness to stage 5 with Garkor's sigil (mm_main 5, mm_garkor 6),
// wears the sigil (teleport to the battle, squad, demon: mm_demon.rs2:1-165),
// turns on Protect from Magic, steps 6 tiles away so the demon only casts wave
// spells (melee is used within 2 tiles, mm_demon.rs2:332-340) and kills it with
// a bow or with combat spells. Level-up pages are dismissed and the attack is
// re-sent whenever the attack skill's xp stops rising (a level-up page stops the
// player attacking). Prayer potions are drunk below 15 points.
// Run: bun docs/speedrun/scripts/quest-mm-demon.ts <bot> <bow|magic> [level=70] [runs=3]
//   bow:   magic shortbow (base Ranged 50, tier50.rs2:6) + rune arrows.
//   magic: Fire Blast (Magic 59) on the demon each cast; runes given.

import { runScript } from '../../../sdk/runner';
import { cheat, dialogue, give, now, pos, result, setstats, setvar, stats, tele, waitTicks, waitUntil } from './quest-gnome-lib';
import { Spells } from '../../../sdk/spells';

const MODE = process.argv[3] ?? 'bow';
const LEVEL = Number(process.argv[4] ?? 70);
const RUNS = Number(process.argv[5] ?? 3);
const SPELL = (Spells as Record<string, number>)[process.env.SPELL ?? 'FIRE_BLAST'];

await runScript(async ({ bot, sdk }) => {
    const samples: Array<Record<string, number | boolean | string>> = [];
    for (let run = 0; run < RUNS; run++) {
        await sdk.sendCloseModal();
        await waitTicks(sdk, 2);
        await cheat(sdk, '~clearinv');
        await setstats(sdk, { attack: 70, strength: 70, defence: 70, hitpoints: 70, prayer: 43, ranged: MODE === 'bow' ? LEVEL : 1, magic: MODE === 'magic' ? LEVEL : 1 });
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
            const it = sdk.getState()!.inventory.find(i => re.test(i.name));
            if (it) await bot.equipItem(it.name);
        }
        await setvar(sdk, 'mm_main', 5);
        await setvar(sdk, 'mm_garkor', 6);
        await setvar(sdk, 'mm_waiting_for_final_battle', 0);
        // Out of the battle zone long enough for an earlier run's squad and demon to despawn.
        await tele(sdk, 2805, 2759);
        await waitTicks(sdk, 30);
        await give(sdk, 'mm_sigil', 1);
        await waitTicks(sdk, 2);
        const tWear = now(sdk);
        const sig = sdk.getState()!.inventory.find(i => /sigil/i.test(i.name))!;
        const d = dialogue(sdk, [], { idle: 3, startTimeout: 80 });
        await sdk.sendUseItem(sig.slot, 2);
        await d;
        const sp = await waitUntil(sdk, s => s.nearbyNpcs.some(n => /^Jungle Demon$/i.test(n.name)), 60);
        if (!sp) { samples.push({ run, note: 'no demon' }); continue; }
        const tSpawn = sp.tick;
        await bot.activatePrayer('protect_from_magic');
        const dm = sdk.getState()!.nearbyNpcs.filter(n => /^Jungle Demon$/i.test(n.name)).sort((a, b) => a.distance - b.distance)[0];
        const p = pos(sdk.getState());
        await sdk.sendWalk(p.x + (Math.sign(p.x - dm.x) || 1) * 6, p.z + (Math.sign(p.z - dm.z) || 1) * 6, true);
        await waitTicks(sdk, 4);
        const skill = MODE === 'bow' ? 'ranged' : 'magic';
        const xp0 = sdk.getSkill(skill)!.experience;
        const hp0 = sdk.getState()!.player!.hp;
        let damage = 0, lastHp = hp0, lastXp = xp0, lastXpTick = now(sdk), levelUps = 0, potions = 0, food = 0, died = false;
        const attack = async () => {
            if (MODE === 'bow') await sdk.sendInteractNpc(dm.index, dm.optionsWithIndex.find(o => /attack/i.test(o.text))!.opIndex);
            else await sdk.sendSpellOnNpc(dm.index, SPELL);
        };
        const t0 = now(sdk);
        await attack();
        let killed = false;
        while (now(sdk) - t0 < 2000) {
            await waitTicks(sdk, MODE === 'magic' ? 5 : 2);
            const s = sdk.getState()!;
            if (s.player?.isDead) { died = true; break; }
            const hp = s.player?.hp ?? lastHp;
            if (hp < lastHp) damage += lastHp - hp;
            lastHp = hp;
            if (!s.nearbyNpcs.some(n => n.index === dm.index)) { killed = true; break; }
            if (s.dialog.isOpen) { levelUps++; await sdk.sendClickDialog(0); }
            const xp = sdk.getSkill(skill)!.experience;
            if (xp > lastXp) { lastXp = xp; lastXpTick = s.tick; }
            if (MODE === 'magic' || s.tick - lastXpTick >= 8) await attack();
            const pr = sdk.getSkill('prayer');
            if (pr && pr.level < 15) {
                const pot = s.inventory.find(i => /restore|prayer/i.test(i.name));
                if (pot) { potions++; await sdk.sendUseItem(pot.slot, 1); }
            }
            if (hp < 35) {
                const f = s.inventory.find(i => /shark/i.test(i.name));
                if (f) { food++; await sdk.sendUseItem(f.slot, 1); }
            }
        }
        const kt = now(sdk) - t0;
        const xpBase = Math.round((sdk.getSkill(skill)!.experience - xp0) / 25);
        samples.push({ run, killed, ticks: kt, wearToSpawn: tSpawn - tWear, damage, died, levelUps, potionDoses: potions, food, xpBase });
        console.log(JSON.stringify(samples.at(-1)));
        await bot.deactivateAllPrayers();
        await waitTicks(sdk, 5);
    }
    const ok = samples.filter(s => s.killed === true);
    result(`mm_demon_${MODE}_${LEVEL}`, { kills: ok.length, of: samples.length, ticks: stats(ok.map(s => Number(s.ticks))), damage: stats(samples.map(s => Number(s.damage ?? 0))), samples });
}, { timeout: 3_600_000 });
