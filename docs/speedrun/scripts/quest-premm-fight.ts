// Pre-Monkey-Madness quest fights at the levels the route actually gives
// (docs/speedrun/quests/pre_mm_fights.md): low Hitpoints, Defence 1 until Holy
// Grail, combat stats from quest xp only, Protect from Melee from helper-fed
// Prayer, and spells for the fights a 1-Attack account cannot melee.
//
//   bun docs/speedrun/scripts/quest-premm-fight.ts <bot> <warlord|blackdemon|mordred|titan> [runs=3] [key=value ...]
//
// Keys (defaults in brackets):
//   stats=att,str,def,hp,prayer,magic   levels set with ::setstat [1,1,1,10,43,51]
//   mode=melee|fire_bolt|fire_blast     melee, or cast that spell on every attack [melee]
//   weapon=<obj>                        melee weapon [rune_scimitar]; magic uses staff_of_fire
//   armour=none|rune|monk               rune = full helm, chainbody, platelegs, kiteshield (base Defence 40);
//                                       monk = monk's robe top and bottom + holy symbol (prayer +19) [none]
//   protect=melee|none                  Protect from Melee [melee]
//   ppots=N food=N                      Prayer potion(4)s and sharks carried [4, 0]
//   drinkBelow=N eatBelow=N             prayer points / hitpoints thresholds [8, half of max hp]
//   swap=N                              titan: wield Excalibur at <= N Titan hitpoints [30]
//   cap=N                               give up after N ticks [1500]
//
// Every run resets stats, inventory and the quest varp, so runs are independent
// samples. Fight ticks run from the first attack click to: the kill (warlord,
// demon), Morgan Le Faye's dialogue (Mordred's death hook, sir_mordred.rs2:7-14),
// or the death teleport past the Titan (black_knight_titan.rs2:10-30). The fight
// itself is speedrun/lib/combat.ts's: level-ups dismissed with the attack re-sent
// on the same tick, prayer / potion / food upkeep, and a re-attack when Protect
// from Melee stalls it. Deaths are recorded, not prevented: there is no survival
// cheat. Quote fight ticks from a lab run at NODE_TICKRATE=300
// (docs/speedrun/quests/CONVENTIONS.md).

import { runScript } from '../../../sdk/runner';
import type { BotSDK } from '../../../sdk/index';
import type { BotActions } from '../../../sdk/actions';
import type { BotWorldState } from '../../../sdk/types';
import { act, invOp, opLoc, slotOf, wield } from '../../../speedrun/lib/act';
import { fight, prayerDoses } from '../../../speedrun/lib/combat';
import { converse } from '../../../speedrun/lib/converse';
import { pageText } from '../../../speedrun/lib/dialogue';
import type { Pred } from '../../../speedrun/lib/wait';
import { configId, findNpc, invCount, pos, skillXp, waitForNpc } from '../../../speedrun/lib/world';
import { result, stats } from '../../../speedrun/lab/record';
import { cheat, clearInventory, give, mustTele, setStats, setvar } from '../../../speedrun/lab/setup';

const argv = process.argv.slice(3);
const WHO = argv[0] ?? 'warlord';
const RUNS = Number(/^\d+$/.test(argv[1] ?? '') ? argv[1] : 3);
const kv = Object.fromEntries(argv.filter(a => a.includes('=')).map(a => a.split('=', 2) as [string, string]));
const [ATT = 1, STR = 1, DEF = 1, HP = 10, PRAY = 43, MAG = 51] = (kv.stats ?? '1,1,1,10,43,51').split(',').map(Number);
const MODE = kv.mode ?? 'melee';
const WEAPON = kv.weapon ?? 'rune_scimitar';
const ARMOUR = kv.armour ?? 'none';
const PROTECT = (kv.protect ?? 'melee') === 'melee';
const PPOTS = Number(kv.ppots ?? 4);
const FOOD = Number(kv.food ?? 0);
const DRINK_BELOW = Number(kv.drinkBelow ?? 8);
const EAT_BELOW = Number(kv.eatBelow ?? Math.ceil(HP / 2));
const SWAP = Number(kv.swap ?? 30);
const CAP = Number(kv.cap ?? 1500);
const SPELL: Record<string, number> = { fire_bolt: 1169, fire_blast: 1181 };
const MAGIC = MODE !== 'melee';
const SKILLS = ['Attack', 'Strength', 'Defence', 'Hitpoints', 'Magic', 'Prayer'] as const;
const XP_RATE = 25; // server/engine/src/util/WorldConfig.ts:102

async function reset(sdk: BotSDK, bot: BotActions) {
    await bot.deactivateAllPrayers().catch(() => {}); // a crashed earlier script may have left one on
    await clearInventory(sdk);
    await setStats(sdk, { attack: ATT, strength: STR, defence: DEF, hitpoints: HP, prayer: PRAY, magic: MAG });
    const gear = MAGIC ? ['staff_of_fire', 'amulet_of_magic'] : [WEAPON, 'amulet_of_strength'];
    if (ARMOUR === 'rune') gear.push('rune_full_helm', 'rune_chainbody', 'rune_platelegs', 'rune_kiteshield');
    if (ARMOUR === 'monk') gear.push('monkrobetop', 'monkrobebottom', 'blessedstar');
    await give(sdk, gear);
    for (const g of gear) if (!(await wield(sdk, configId('obj', g))).ok) throw new Error(`could not wield ${g}`);
    if (MAGIC) {
        await give(sdk, ['chaosrune', 'deathrune'], 300);
        await give(sdk, 'airrune', 2000);
    }
    if (PPOTS) await give(sdk, '4doseprayerrestore', PPOTS);
    if (FOOD) await give(sdk, 'shark', FOOD);
    if (!MAGIC) await sdk.sendSetCombatStyle(1); // aggressive: Strength xp, best max hit
    await sdk.waitForTicks(2);
}

interface Sample {
    won: boolean; died: boolean; ticks: number; casts: number; levelUps: number; reheals: number;
    damageTaken: number; minHp: number; sharks: number; prayerDoses: number; prayerPointsUsed: number;
    swappedAtTitanHp?: number | null; xpBase: Record<string, number>; note?: string;
}

async function runFight(sdk: BotSDK, target: RegExp): Promise<Sample> {
    const s0 = sdk.getState()!;
    const xp0 = Object.fromEntries(SKILLS.map(n => [n, skillXp(s0, n)]));
    const doses0 = prayerDoses(s0), sharks0 = invCount(s0, /^Shark$/i);
    // The nearest match is the one we fight; fight() tracks it by index so a second
    // spawn (the warlord also has a static spawn at his post) is never counted.
    const npc = findNpc(sdk, target);
    if (!npc) throw new Error(`no ${target} in view`);
    const titan = WHO === 'titan';
    // The Titan's reheal: "Puny mortal... I... Am... INVINCIBLE!!!" when the killing hit lands without Excalibur.
    let reheals = 0;
    let counted = false;
    const stopCounting = titan
        ? sdk.onStateUpdate(s => {
              if (!s.dialog.isOpen) counted = false;
              else if (!counted && /Puny mortal|INVINCIBLE/i.test(pageText(s.dialog))) {
                  counted = true;
                  reheals++;
              }
          })
        : () => {};
    let swapped: number | null = null;
    const pastTitan: Pred = s => pos(s).x >= 0 && pos(s).x < 2791;
    const r = await fight(sdk, npc, {
        endOnTargetDeath: WHO !== 'mordred' && !titan,
        ...(MAGIC ? { spell: SPELL[MODE]! } : { reattackAfter: 6 }),
        ...(PROTECT ? { prayer: 'protect_from_melee' as const, drinkBelow: DRINK_BELOW } : {}),
        eatBelow: EAT_BELOW,
        food: /^Shark$/i,
        maxTicks: CAP,
        // Mordred: Morgan Le Faye's plea is the end. Elsewhere a non-level-up page is clicked through.
        onDialog: WHO === 'mordred' ? 'stop' : 'continue',
        ...(titan ? {
            done: pastTitan,
            onTick: async (s: BotWorldState, t: { hp: number | null } | null) => {
                if (swapped !== null || t?.hp == null || t.hp > SWAP || !invCount(s, /^Excalibur$/i)) return false;
                swapped = t.hp;
                await invOp(sdk, /^Excalibur$/i, /^wield$/i);
                return true;
            },
        } : {}),
    });
    stopCounting();
    const won = WHO === 'mordred' ? r.end === 'dialog' : titan ? r.end === 'done' : r.ok;
    const s1 = sdk.getState()!;
    const xpBase = Object.fromEntries(SKILLS.map(n => [n, Math.round((skillXp(s1, n) - xp0[n]!) / XP_RATE)]));
    return {
        won, died: r.died, ticks: r.ticks, casts: MAGIC ? r.attacks : 0, levelUps: r.levelUps, reheals, damageTaken: r.taken, minHp: r.minHp,
        sharks: sharks0 - invCount(s1, /^Shark$/i), prayerDoses: doses0 - prayerDoses(s1), prayerPointsUsed: r.prayerUsed,
        swappedAtTitanHp: titan ? swapped : undefined, xpBase,
        ...(r.end === 'timeout' ? { note: 'CAP' } : won || r.died ? {} : { note: r.end }),
    };
}

await runScript(async ({ bot, sdk }) => {
    await bot.dismissBlockingUI();
    const samples: Sample[] = [];
    for (let run = 0; run < RUNS; run++) {
        if (sdk.getState()!.player!.isDead) await sdk.waitForTicks(10);
        await reset(sdk, bot);
        await sdk.waitForTicks(3); // let the prayer points from ::setstat land before the fight reads them
        let target: RegExp;
        if (WHO === 'warlord') {
            // He has no quest gate on attacking (quest-gnome-fights.ts); spawn one beside his post.
            await mustTele(sdk, 2456, 3300);
            await cheat(sdk, 'npcadd khazard_warlord', 2);
            target = /^Khazard warlord$/i;
            if (PROTECT) await bot.activatePrayer('protect_from_melee');
        } else if (WHO === 'blackdemon') {
            // Replays the Grand Tree trapdoor scene at stage 130; the demon only fights the player
            // Glough summoned it for (grandtree_black_demon.rs2:1-13).
            target = /^Black Demon$/i;
            await setvar(sdk, 'grandtree', 130);
            await mustTele(sdk, 2487, 3465, 2);
            if (PROTECT) await bot.activatePrayer('protect_from_melee');
            const conv = converse(sdk, [], { idle: 4, closeModals: true, unmatched: 'stop' });
            await opLoc(sdk, { x: 2487, z: 3464, op: /^open$/i }, /^open$/i, s => s.dialog.isOpen || findNpc(s, target) !== null, { maxTicks: 30 });
            await conv;
            await waitForNpc(sdk, target, 20);
        } else if (WHO === 'mordred') {
            // %arthur 3; up the keep's two staircases from the crate landing (quest-merlins-crystal-mordred.ts).
            await setvar(sdk, 'arthur', 3);
            await mustTele(sdk, 2778, 3401, 0);
            for (const lvl of [1, 2]) {
                const up = await opLoc(sdk, { name: /Staircase/, op: 'Climb-up', radius: 15 }, 'Climb-up', s => pos(s).level === lvl, { maxTicks: 40 });
                if (!up.ok) throw new Error(`staircase to level ${lvl}: ${up.reason}`);
            }
            target = /^Sir Mordred$/;
            await waitForNpc(sdk, target, 20);
            if (PROTECT) await bot.activatePrayer('protect_from_melee');
        } else if (WHO === 'titan') {
            // %grail 4, whistle in from the Karamja crossing (quest-holy-grail-realm.ts).
            await give(sdk, ['excalibur', 'magic_whistle']);
            await setvar(sdk, 'grail', 4);
            await mustTele(sdk, 2741, 3235, 0);
            await sdk.waitForTicks(2);
            await act(sdk, () => sdk.sendUseItem(slotOf(sdk, /Magic whistle/i), 1), s => pos(s).z > 4600, { maxTicks: 30 });
            target = /^Black Knight Titan$/;
            await waitForNpc(sdk, target, 20);
            if (PROTECT) await bot.activatePrayer('protect_from_melee');
        } else throw new Error(`unknown fight ${WHO}`);
        await sdk.waitForTicks(1);
        const r = await runFight(sdk, target);
        samples.push(r);
        console.log(`run ${run}: ${JSON.stringify(r)}`);
        if (WHO === 'mordred' && r.won) await converse(sdk, [/Tell me how to untrap Merlin/, /OK I will go do all that/i], { keep: true });
        await bot.deactivateAllPrayers().catch(() => {});
        await sdk.waitForTicks(r.died ? 15 : 4);
        await bot.dismissBlockingUI();
    }
    const won = samples.filter(x => x.won);
    const stat = (xs: number[]) => (xs.length ? stats(xs) : null);
    result(WHO, {
        tickrate: process.env.NODE_TICKRATE ?? '(lab script sets it)', stats: { ATT, STR, DEF, HP, PRAY, MAG }, mode: MODE, weapon: MAGIC ? 'staff_of_fire' : WEAPON, armour: ARMOUR, protect: PROTECT,
        runs: samples.length, wins: won.length, deaths: samples.filter(x => x.died).length, capped: samples.filter(x => x.note === 'CAP').length,
        ticks: stat(won.map(x => x.ticks)), prayerPointsUsed: stat(won.map(x => x.prayerPointsUsed)), prayerDoses: stat(won.map(x => x.prayerDoses)),
        sharks: stat(won.map(x => x.sharks)), damageTaken: stat(samples.map(x => x.damageTaken)), minHp: Math.min(...samples.map(x => x.minHp)),
        levelUps: stat(samples.map(x => x.levelUps)), hpXp: stat(won.map(x => x.xpBase.Hitpoints!)),
    });
}, { timeout: 3 * 3_600_000, printState: false });
