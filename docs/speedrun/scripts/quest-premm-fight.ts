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
// or the death teleport past the Titan (black_knight_titan.rs2:10-30).
// Level-up dialogues are dismissed and the attack re-sent. Deaths are recorded,
// not prevented: there is no survival cheat. Quote fight ticks from a lab run
// at NODE_TICKRATE=300 (docs/speedrun/quests/CONVENTIONS.md).

import { runScript } from '../../../sdk/runner';
import type { BotSDK } from '../../../sdk/index';
import type { BotActions } from '../../../sdk/actions';
import type { BotWorldState, NearbyNpc } from '../../../sdk/types';
import * as L from './quest-arthur-lab';
import { locTalkAt } from './quest-gnome-lib';

const argv = process.argv.slice(3);
const WHO = argv[0] ?? 'warlord';
const RUNS = Number(/^\d+$/.test(argv[1] ?? '') ? argv[1] : 3);
const kv = Object.fromEntries(argv.filter(a => a.includes('=')).map(a => a.split('=', 2) as [string, string]));
const [ATT, STR, DEF, HP, PRAY, MAG] = (kv.stats ?? '1,1,1,10,43,51').split(',').map(Number);
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

const objName = (i: { name: string }) => i.name.toLowerCase().replace(/ /g, '_');
const doses = (s: BotWorldState) => s.inventory.filter(i => /^Prayer potion\(\d\)$/.test(i.name)).reduce((a, i) => a + i.count * Number(/\((\d)\)/.exec(i.name)![1]), 0);
const sharks = (s: BotWorldState) => s.inventory.filter(i => /^Shark$/i.test(i.name)).reduce((a, i) => a + i.count, 0);
const xp = (s: BotWorldState, n: string) => s.skills.find(k => k.name === n)?.experience ?? 0;

async function wield(sdk: BotSDK, g: string) {
    const named = (i: { name: string }) => objName(i) === g;
    if (sdk.getEquipment().some(named)) return;
    await L.waitUntil(sdk, () => sdk.getInventory().some(named), 10);
    const it = sdk.getInventory().find(named);
    if (!it) throw new Error(`no ${g} to wield`);
    const op = it.optionsWithIndex.find(o => /wear|wield/i.test(o.text));
    await sdk.sendUseItem(it.slot, op?.opIndex ?? 2);
    if ((await L.waitUntil(sdk, () => sdk.getEquipment().some(named), 6)) === null) throw new Error(`could not wield ${g}`);
}

async function reset(sdk: BotSDK, bot: BotActions) {
    await bot.deactivateAllPrayers().catch(() => {}); // a crashed earlier script may have left one on
    for (let pass = 0; pass < 2; pass++) {
        for (const e of sdk.getEquipment()) await sdk.sendUseEquipmentItem(e.slot, 1).catch(() => {});
        await sdk.waitForTicks(1);
        for (const it of sdk.getInventory()) await sdk.sendDropItem(it.slot).catch(() => {});
        await sdk.waitForTicks(1);
    }
    await L.setStats(sdk, { attack: ATT, strength: STR, defence: DEF, hitpoints: HP, prayer: PRAY, magic: MAG });
    const gear = MAGIC ? ['staff_of_fire', 'amulet_of_magic'] : [WEAPON, 'amulet_of_strength'];
    if (ARMOUR === 'rune') gear.push('rune_full_helm', 'rune_chainbody', 'rune_platelegs', 'rune_kiteshield');
    if (ARMOUR === 'monk') gear.push('monkrobetop', 'monkrobebottom', 'blessedstar');
    for (const g of gear) await L.cheat(sdk, `give ${g} 1`, 1);
    for (const g of gear) await wield(sdk, g);
    if (MAGIC) await L.giveItems(sdk, [['chaosrune', 300], ['deathrune', 300], ['airrune', 2000]]);
    if (PPOTS) await L.cheat(sdk, `give 4doseprayerrestore ${PPOTS}`, 1);
    if (FOOD) await L.cheat(sdk, `give shark ${FOOD}`, 1);
    if (!MAGIC) await sdk.sendSetCombatStyle(1); // aggressive: Strength xp, best max hit
    await sdk.waitForTicks(2);
}

interface Sample {
    won: boolean; died: boolean; ticks: number; casts: number; levelUps: number; reheals: number;
    damageTaken: number; minHp: number; sharks: number; prayerDoses: number; prayerPointsUsed: number;
    swappedAtTitanHp?: number | null; xpBase: Record<string, number>; note?: string;
}

async function fight(sdk: BotSDK, bot: BotActions, target: RegExp): Promise<Sample> {
    let s = sdk.getState()!;
    const xp0 = Object.fromEntries(SKILLS.map(n => [n, xp(s, n)]));
    const doses0 = doses(s), sharks0 = sharks(s);
    let lastHp = s.player!.hp, minHp = lastHp, damageTaken = 0;
    let lastPts = sdk.getPrayerState()?.prayerPoints ?? PRAY, ptsUsed = 0;
    let casts = 0, levelUps = 0, reheals = 0, lastAct = -10, lastDrink = -10, lastEat = -10;
    let swapped: number | null = null;
    let won = false, died = false, note: string | undefined;
    // The nearest match is the one we fight; track it by index so a second spawn
    // (the warlord also has a static spawn at his post) is never counted.
    let npc: NearbyNpc | null = [...s.nearbyNpcs].filter(n => target.test(n.name)).sort((a, b) => a.distance - b.distance)[0] ?? null;
    if (!npc) throw new Error(`no ${target} in view`);
    const idx = npc.index;
    const t0 = s.tick;
    const attack = async (n: NearbyNpc) => {
        if (MAGIC) { await sdk.sendSpellOnNpc(n.index, SPELL[MODE]!); casts++; }
        else { const op = n.optionsWithIndex.find(o => /attack/i.test(o.text)); await sdk.sendInteractNpc(n.index, op?.opIndex ?? 2); }
        lastAct = sdk.getState()!.tick;
    };
    await attack(npc);
    while (true) {
        // A loaded host can stall the engine past the SDK's 5 s wait; keep waiting rather than abort.
        try { s = await sdk.waitForStateUpdate(); } catch { continue; }
        const p = s.player!;
        if (s.tick - t0 > CAP) { note = 'CAP'; break; }
        if (p.isDead || p.hp <= 0) { died = true; break; }
        if (p.hp < lastHp) damageTaken += lastHp - p.hp;
        lastHp = p.hp; minHp = Math.min(minHp, p.hp);
        const pts = sdk.getPrayerState()?.prayerPoints ?? lastPts;
        if (pts < lastPts) ptsUsed += lastPts - pts;
        lastPts = pts;
        if (WHO === 'titan' && p.worldX < 2791) { won = true; break; }
        npc = s.nearbyNpcs.find(n => n.index === idx && target.test(n.name)) ?? null;
        if (s.dialog.isOpen) {
            if (L.isLevelUpDialog(sdk)) { levelUps++; await L.dismissLevelUps(sdk); }
            else if (WHO === 'mordred') { won = true; break; } // Morgan Le Faye: the death hook fired
            else if (WHO === 'titan') { reheals++; await L.talkThrough(sdk, []); } // "INVINCIBLE": killed without Excalibur
            else await sdk.sendClickDialog(0);
            if (npc) await attack(npc);
            continue;
        }
        if (WHO !== 'titan' && WHO !== 'mordred' && (!npc || npc.hp === 0)) { won = true; break; }
        if (PROTECT && pts > 0 && !sdk.isPrayerActive('protect_from_melee') && s.tick - lastAct >= 1) await sdk.sendTogglePrayer('protect_from_melee');
        // the prayer state can lag a fresh ::setstat by a tick or two; never drink in the first 5 ticks
        if (pts < DRINK_BELOW && s.tick - t0 > 5 && (sdk.getSkill('Prayer')?.level ?? pts) < DRINK_BELOW && s.tick - lastDrink >= 3) {
            const pot = s.inventory.find(i => /^Prayer potion/.test(i.name));
            if (pot) { await sdk.sendUseItem(pot.slot, 1); lastDrink = s.tick; if (npc) await attack(npc); continue; }
        }
        if (p.hp < EAT_BELOW && s.tick - lastEat >= 3) {
            const f = s.inventory.find(i => /^Shark$/i.test(i.name));
            if (f) { await sdk.sendUseItem(f.slot, 1); lastEat = s.tick; if (npc) await attack(npc); continue; }
        }
        if (WHO === 'titan' && swapped === null && npc?.hp != null && npc.hp <= SWAP) {
            const ex = s.inventory.find(i => /^Excalibur$/i.test(i.name));
            if (ex) {
                swapped = npc.hp;
                const op = ex.optionsWithIndex.find(o => /wield/i.test(o.text));
                await sdk.sendUseItem(ex.slot, op?.opIndex ?? 2);
                await sdk.waitForTicks(1);
                await attack(npc);
                continue;
            }
        }
        if (!npc) continue;
        // Spells: re-send every 2 ticks (the 5-tick cast delay keeps the rate; as in quest-magearena-run.ts).
        // Melee: re-attack only if combat has dropped.
        if (MAGIC ? s.tick - lastAct >= 2 : (!p.combat?.inCombat && s.tick - lastAct > 6)) await attack(npc);
    }
    const ticks = sdk.getState()!.tick - t0;
    const s1 = sdk.getState()!;
    const xpBase = Object.fromEntries(SKILLS.map(n => [n, Math.round((xp(s1, n) - xp0[n]!) / 25)]));
    return {
        won, died, ticks, casts, levelUps, reheals, damageTaken, minHp,
        sharks: sharks0 - sharks(s1), prayerDoses: doses0 - doses(s1), prayerPointsUsed: ptsUsed,
        swappedAtTitanHp: WHO === 'titan' ? swapped : undefined, xpBase, note,
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
            await L.tele(sdk, 2456, 3300);
            await L.cheat(sdk, 'npcadd khazard_warlord', 2);
            target = /^Khazard warlord$/i;
            if (PROTECT) await bot.activatePrayer('protect_from_melee');
        } else if (WHO === 'blackdemon') {
            // Replays the Grand Tree trapdoor scene at stage 130; the demon only fights the player
            // Glough summoned it for (grandtree_black_demon.rs2:1-13).
            await L.cheat(sdk, 'setvar grandtree 130');
            await L.tele(sdk, 2487, 3465, 2);
            if (PROTECT) await bot.activatePrayer('protect_from_melee');
            await locTalkAt(sdk, 2487, 3464, /^open$/i, [], { idle: 4 });
            target = /^Black Demon$/i;
            await L.waitUntil(sdk, () => sdk.findNearbyNpc(target) !== null, 20);
        } else if (WHO === 'mordred') {
            // %arthur 3; up the keep's two staircases from the crate landing (quest-merlins-crystal-mordred.ts).
            await L.cheat(sdk, 'setvar arthur 3');
            await L.tele(sdk, 2778, 3401, 0);
            for (const lvl of [1, 2]) {
                const st = (await sdk.scanNearbyLocs(15)).find(l => /Staircase/.test(l.name) && l.options.includes('Climb-up'));
                await bot.interactLoc(st!, 'Climb-up');
                await L.waitUntil(sdk, () => L.pos(sdk).level === lvl, 40);
            }
            target = /^Sir Mordred$/;
            await L.waitUntil(sdk, () => sdk.findNearbyNpc(target) !== null, 20);
            if (PROTECT) await bot.activatePrayer('protect_from_melee');
        } else if (WHO === 'titan') {
            // %grail 4, whistle in from the Karamja crossing (quest-holy-grail-realm.ts).
            await L.cheat(sdk, 'give excalibur 1', 1);
            await L.cheat(sdk, 'give magic_whistle 1', 1);
            await L.cheat(sdk, 'setvar grail 4');
            await L.tele(sdk, 2741, 3235, 0);
            await sdk.waitForTicks(2);
            await sdk.sendUseItem(sdk.findInventoryItem(/Magic whistle/i)!.slot, 1);
            await L.waitUntil(sdk, () => L.pos(sdk).z > 4600, 30);
            target = /^Black Knight Titan$/;
            await L.waitUntil(sdk, () => sdk.findNearbyNpc(target) !== null, 20);
            if (PROTECT) await bot.activatePrayer('protect_from_melee');
        } else throw new Error(`unknown fight ${WHO}`);
        await sdk.waitForTicks(1);
        const r = await fight(sdk, bot, target);
        samples.push(r);
        console.log(`run ${run}: ${JSON.stringify(r)}`);
        if (WHO === 'mordred' && r.won) await L.talkThrough(sdk, [/Tell me how to untrap Merlin/, /OK I will go do all that/i]);
        await bot.deactivateAllPrayers().catch(() => {});
        await sdk.waitForTicks(r.died ? 15 : 4);
        await bot.dismissBlockingUI();
    }
    const won = samples.filter(x => x.won);
    const stat = (xs: number[]) => xs.length ? { n: xs.length, min: Math.min(...xs), max: Math.max(...xs), mean: Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) } : null;
    console.log(`RESULT ${WHO} ${JSON.stringify({
        tickrate: process.env.NODE_TICKRATE ?? '(lab script sets it)', stats: { ATT, STR, DEF, HP, PRAY, MAG }, mode: MODE, weapon: MAGIC ? 'staff_of_fire' : WEAPON, armour: ARMOUR, protect: PROTECT,
        runs: samples.length, wins: won.length, deaths: samples.filter(x => x.died).length, capped: samples.filter(x => x.note === 'CAP').length,
        ticks: stat(won.map(x => x.ticks)), prayerPointsUsed: stat(won.map(x => x.prayerPointsUsed)), prayerDoses: stat(won.map(x => x.prayerDoses)),
        sharks: stat(won.map(x => x.sharks)), damageTaken: stat(samples.map(x => x.damageTaken)), minHp: Math.min(...samples.map(x => x.minHp)),
        levelUps: stat(samples.map(x => x.levelUps)), hpXp: stat(won.map(x => x.xpBase.Hitpoints!)),
    })}`);
}, { timeout: 3 * 3_600_000, printState: false });
