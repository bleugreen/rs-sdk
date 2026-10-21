// Repeated fight samples for the gnome-chain bosses (docs/speedrun/quests/
// {tree_gnome_village,grand_tree,monkey_madness}.md): ticks from the attack
// click to the kill, damage taken, food eaten and prayer points used, at the
// given melee stats, with a rune scimitar and Protect from Melee unless
// PRAYER=off.
// Run: bun docs/speedrun/scripts/quest-gnome-fights.ts <botname> <warlord|blackdemon|jungledemon> [runs=5] [att str def hp]
//   WEAPON=rune_scimitar|rune_warhammer|magic_shortbow (rune arrows given) picks the weapon (default rune_scimitar).
//   warlord:     ::npcadd khazard_warlord next to his spawn (he has no quest gate on attacking).
//   blackdemon:  replays the Grand Tree trapdoor scene at stage 130 (the demon only fights
//                the player Glough summoned it for, grandtree_black_demon.rs2:1-13).
//   jungledemon: Monkey Madness stage 5 with Garkor's sigil worn: the sigil teleports the player to
//                the battle, the squad appears and the demon spawns (mm_demon.rs2:1-165). Protect from
//                Magic stops its wave spells; within 2 tiles it also uses melee (mm_demon.rs2:332-340).
//                Prayer potions are drunk when prayer points fall below 15.

import { runScript } from '../../../sdk/runner';
import { cheat, dialogue, fight, give, locTalkAt, now, pos, result, setstats, setvar, stats, tele, waitTicks, waitUntil } from './quest-gnome-lib';

const WHO = process.argv[3] ?? 'warlord';
const RUNS = Number(process.argv[4] ?? 5);
const [ATT, STR, DEF, HP] = [5, 6, 7, 8].map((i, k) => Number(process.argv[i] ?? [70, 70, 70, 70][k]));
const PRAYER = process.env.PRAYER !== 'off';

await runScript(async ({ bot, sdk }) => {
    const samples: Array<{ ticks: number; damage: number; food: number; prayerUsed: number; died: boolean; hpLeft: number }> = [];
    for (let run = 0; run < RUNS; run++) {
        await cheat(sdk, '~clearinv');
        await setstats(sdk, { attack: ATT, strength: STR, defence: DEF, hitpoints: HP, prayer: 43 });
        const weapon = process.env.WEAPON ?? 'rune_scimitar';
        await give(sdk, weapon, 1);
        if (/bow/.test(weapon)) await give(sdk, 'rune_arrow', 300);
        await give(sdk, 'shark', 16);
        await give(sdk, '4doseprayerrestore', 4);
        await setstats(sdk, { ranged: Number(process.env.RANGED ?? 70) });
        await waitTicks(sdk, 2);
        for (const re of [/scimitar|warhammer|shortbow|longbow/i, /rune arrow/i]) {
            const it = sdk.getState()!.inventory.find(i => re.test(i.name));
            if (it) await bot.equipItem(it.name);
        }
        let target: RegExp;
        if (WHO === 'warlord') {
            await tele(sdk, 2456, 3300);
            await cheat(sdk, 'npcadd khazard_warlord');
            await waitTicks(sdk, 2);
            target = /^Khazard warlord$/i;
        } else if (WHO === 'blackdemon') {
            await setvar(sdk, 'grandtree', 130);
            await tele(sdk, 2487, 3465, 2);
            if (PRAYER) await bot.activatePrayer('protect_from_melee');
            await locTalkAt(sdk, 2487, 3464, /^open$/i, [], { idle: 4 });
            target = /^Black Demon$/i;
        } else if (WHO === 'jungledemon') {
            await setvar(sdk, 'mm_main', 5);
            await setvar(sdk, 'mm_garkor', 6);
            await setvar(sdk, 'mm_waiting_for_final_battle', 0);
            await tele(sdk, 2805, 2759);
            await give(sdk, 'mm_sigil', 1);
            await waitTicks(sdk, 2);
            const t0 = now(sdk);
            const sig = sdk.getState()!.inventory.find(i => /sigil/i.test(i.name))!;
            const d = dialogue(sdk, [], { idle: 3, startTimeout: 80 });
            await sdk.sendUseItem(sig.slot, 2);
            await waitUntil(sdk, s => pos(s).z > 9100 && pos(s).level === 1, 60);
            const tArrive = now(sdk);
            await d;
            const r = await waitUntil(sdk, s => s.nearbyNpcs.some(n => /^Jungle Demon$/i.test(n.name)), 40);
            console.log(`sigil: worn -> arrival ${tArrive - t0} ticks, -> demon spawned ${(r?.tick ?? NaN) - t0} ticks`);
            if (PRAYER) await bot.activatePrayer('protect_from_magic');
            target = /^Jungle Demon$/i;
            if (/bow/.test(process.env.WEAPON ?? '')) {
                // Ranged: step 6 tiles away from the demon first, so it stays on wave spells (melee only
                // within 2 tiles, mm_demon.rs2:332) and Protect from Magic stops all of its damage.
                const dm = sdk.getState()!.nearbyNpcs.find(n => /^Jungle Demon$/i.test(n.name));
                if (dm) {
                    const p = pos(sdk.getState());
                    const dx = Math.sign(p.x - dm.x) || 1, dz = Math.sign(p.z - dm.z) || 1;
                    await sdk.sendWalk(p.x + dx * 6, p.z + dz * 6, true);
                    await waitTicks(sdk, 4);
                }
            }
        } else {
            throw new Error(`fight ${WHO} not wired yet`);
        }
        if (PRAYER && WHO === 'warlord') await bot.activatePrayer('protect_from_melee');
        // Prayer potions keep the protection up through long fights.
        let lastDrink = -10;
        const unsubPray = sdk.onStateUpdate(s => {
            const pr = sdk.getSkill('prayer');
            if (pr && pr.level < 15 && s.tick - lastDrink >= 3) {
                const pot = s.inventory.find(i => /prayer potion|restore/i.test(i.name));
                if (pot) { lastDrink = s.tick; void sdk.sendUseItem(pot.slot, 1); }
            }
        });
        const pr0 = sdk.getSkill('prayer')!.level;
        const diag = sdk.onStateUpdate(s => {
            if (s.tick % 20 !== 0) return;
            const t = s.nearbyNpcs.find(n => target.test(n.name));
            console.log(`  t${s.tick} hp=${s.player?.hp} prayer=${sdk.getSkill('prayer')?.level} active=${JSON.stringify((s as unknown as { prayers?: unknown }).prayers ?? '')} targetDist=${t?.distance} targetHp=${t?.hp}`);
        });
        const f = await fight(sdk, bot, target, { eatBelow: Math.max(20, Math.round(HP * 0.5)) });
        const s = sdk.getState()!;
        const prayerUsed = pr0 - (sdk.getSkill('prayer')!.level);
        samples.push({ ticks: f.ticks, damage: f.damageTaken, food: f.food, prayerUsed, died: f.died, hpLeft: s.player?.hp ?? -1 });
        unsubPray();
        diag();
        console.log(`run ${run}: ${JSON.stringify(samples.at(-1))}`);
        await bot.deactivateAllPrayers();
        // Let any death/respawn or loot settle.
        await waitTicks(sdk, 5);
        void dialogue; void pos; void now; void waitUntil;
    }
    result(`fight_${WHO}_${process.env.WEAPON ?? 'rune_scimitar'}_${ATT}_${STR}_${DEF}_${HP}${PRAYER ? '' : '_noprayer'}`, {
        ticks: stats(samples.map(s => s.ticks)), damage: stats(samples.map(s => s.damage)), food: stats(samples.map(s => s.food)),
        prayerUsed: stats(samples.map(s => s.prayerUsed)), deaths: samples.filter(s => s.died).length, samples,
    });
}, { timeout: 3_600_000 });
