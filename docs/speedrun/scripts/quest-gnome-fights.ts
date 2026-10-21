// Repeated fight samples for the gnome-chain bosses (docs/speedrun/quests/
// {tree_gnome_village,grand_tree,monkey_madness}.md): ticks from the attack
// click to the kill, damage taken, food eaten and prayer points used, at the
// given melee stats, with a rune scimitar and Protect from Melee unless
// PRAYER=off.
// Run: bun docs/speedrun/scripts/quest-gnome-fights.ts <botname> <warlord|blackdemon|jungledemon> [runs=5] [att str def hp]
//   warlord:     ::npcadd khazard_warlord next to his spawn (he has no quest gate on attacking).
//   blackdemon:  replays the Grand Tree trapdoor scene at stage 130 (the demon only fights
//                the player Glough summoned it for, grandtree_black_demon.rs2:1-13).
//   jungledemon: replays Monkey Madness's demon summoning (see mm-demon section below).

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
        await give(sdk, 'rune_scimitar', 1);
        await give(sdk, 'shark', 20);
        await waitTicks(sdk, 2);
        const sc = sdk.getState()!.inventory.find(i => /scimitar/i.test(i.name));
        if (sc) await bot.equipItem(sc.name);
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
        } else {
            throw new Error(`fight ${WHO} not wired yet`);
        }
        if (PRAYER && WHO !== 'blackdemon') await bot.activatePrayer('protect_from_melee');
        const pr0 = sdk.getSkill('prayer')!.level;
        const f = await fight(sdk, bot, target, { eatBelow: Math.max(20, Math.round(HP * 0.5)) });
        const s = sdk.getState()!;
        const prayerUsed = pr0 - (sdk.getSkill('prayer')!.level);
        samples.push({ ticks: f.ticks, damage: f.damageTaken, food: f.food, prayerUsed, died: f.died, hpLeft: s.player?.hp ?? -1 });
        console.log(`run ${run}: ${JSON.stringify(samples.at(-1))}`);
        await bot.deactivateAllPrayers();
        // Let any death/respawn or loot settle.
        await waitTicks(sdk, 5);
        void dialogue; void pos; void now; void waitUntil;
    }
    result(`fight_${WHO}_${ATT}_${STR}_${DEF}_${HP}${PRAYER ? '' : '_noprayer'}`, {
        ticks: stats(samples.map(s => s.ticks)), damage: stats(samples.map(s => s.damage)), food: stats(samples.map(s => s.food)),
        prayerUsed: stats(samples.map(s => s.prayerUsed)), deaths: samples.filter(s => s.died).length, samples,
    });
}, { timeout: 3_600_000 });
