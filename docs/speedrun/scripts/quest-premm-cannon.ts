// Pre-Monkey-Madness cannon session at the Wilderness poison spiders (3288,3810)
// at the route's real levels (docs/speedrun/quests/pre_mm_fights.md): Defence 1,
// low Hitpoints, Ranged 1, a melee weapon wielded (the cannon's hit roll uses the
// wielded style, cannon_fire.rs2:116), Protect from Melee from helper-fed
// Prayer. Unlike ranged-cannon.ts (cairn://p/rs/31), there is no survival
// cheat: hitpoints are only restored by eating, so deaths are real.
//
//   bun docs/speedrun/scripts/quest-premm-cannon.ts <bot> [runs=2] [key=value ...]
//
// Keys (defaults in brackets):
//   stats=att,str,def,ranged,hp,prayer   [99,1,1,1,42,43]
//   ticks=N        firing window after the first Fire [150]; Ranged 1->50 is ~113 (ranged.md)
//   until=N        stop early once Ranged reaches level N [0 = off]
//   food=N         sharks carried [5]; eaten below eatBelow hp [12]
//   ppots=N        Prayer potion(4)s; drunk below drinkBelow points [2, 8]
//   antipoison=N   Antipoison(4)s; one dose at the first "You have been poisoned!" and again
//                  whenever poisoned once the immunity lapses [0]
//   protect=melee|none [melee]
// Set-up follows ranged-cannon.ts: %mcannon 11, cannon parts and 500 balls by
// ::give, base placed on the first tile near the spot that fits, top up every 20
// ticks. Poison damage is counted from hitpoint drops that arrive without a
// combat hit (poison.rs2: 30-tick timer, ceil((severity+4)/5) per hit, severity 27).

import { runScript } from '../../../sdk/runner';
import type { BotWorldState } from '../../../sdk/types';
import { act, opLoc, slotOf, wield } from '../../../speedrun/lib/act';
import { Upkeep } from '../../../speedrun/lib/combat';
import { converse } from '../../../speedrun/lib/converse';
import { clickContinue } from '../../../speedrun/lib/dialogue';
import { currentTick, waitTicks } from '../../../speedrun/lib/wait';
import { findLoc, invItem, skillXp } from '../../../speedrun/lib/world';
import { result } from '../../../speedrun/lab/record';
import { clearInventory, give, setStats, setvar, tele } from '../../../speedrun/lab/setup';

const argv = process.argv.slice(3);
const RUNS = Number(/^\d+$/.test(argv[0] ?? '') ? argv[0] : 2);
const kv = Object.fromEntries(argv.filter(a => a.includes('=')).map(a => a.split('=', 2) as [string, string]));
const [ATT = 99, STR = 1, DEF = 1, RNG = 1, HP = 42, PRAY = 43] = (kv.stats ?? '99,1,1,1,42,43').split(',').map(Number);
const TICKS = Number(kv.ticks ?? 150);
const UNTIL = Number(kv.until ?? 0);
const FOOD = Number(kv.food ?? 5), EAT_BELOW = Number(kv.eatBelow ?? 12);
const PPOTS = Number(kv.ppots ?? 2), DRINK_BELOW = Number(kv.drinkBelow ?? 8);
const ANTI = Number(kv.antipoison ?? 0);
const PROTECT = (kv.protect ?? 'melee') === 'melee';
const AT = { x: 3288, z: 3810 };
const XP_RATE = 25; // server/engine/src/util/WorldConfig.ts:102
const CANNON_PART = /multicannon|cannon base|cannon stand/i;
/** Tiles tried for the base, nearest the spot first. */
const PLACE: ReadonlyArray<readonly [number, number]> = [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1], [2, 0], [0, 2]];
/** Each part used on the loc it is built onto. */
const ASSEMBLE: ReadonlyArray<readonly [RegExp, RegExp]> = [[/cannon stand/i, /cannon base/i], [/cannon barrels/i, /cannon stand/i], [/cannon furnace/i, /cannon base/i]];

await runScript(async ({ bot, sdk }) => {
    /** Click through whatever dialogue is open (a level-up, the death message). */
    const dismiss = () => converse(sdk, [], { openTicks: 1, idle: 1, unmatched: 'first' });
    const count = (s: BotWorldState, re: RegExp) => s.inventory.filter(i => re.test(i.name)).reduce((a, i) => a + i.count * (Number(/\((\d)\)$/.exec(i.name)?.[1] ?? 1)), 0);
    const lvl = (s: BotWorldState, n: string) => s.skills.find(k => k.name === n)?.baseLevel ?? 0;
    const multicannon = () => findLoc(sdk, { name: /multicannon/i });
    await bot.skipTutorial().catch(() => {});
    await dismiss();
    const results: unknown[] = [];
    for (let run = 0; run < RUNS; run++) {
        // ---- untimed set-up ----
        await bot.deactivateAllPrayers().catch(() => {});
        const old = await findLoc(sdk, { name: CANNON_PART, op: /^pick-up$/i });
        if (old) await opLoc(sdk, old, /^pick-up$/i, s => !s.nearbyLocs.some(l => CANNON_PART.test(l.name)), { maxTicks: 30 });
        await clearInventory(sdk);
        await setvar(sdk, 'mcannon', 11);
        await setvar(sdk, 'ownedmcannon', -1); // forget a previous run's cannon (cannon_setup.rs2:59-63)
        await setvar(sdk, 'poison', 0);
        await setStats(sdk, { attack: ATT, strength: STR, defence: DEF, ranged: RNG, hitpoints: HP, prayer: PRAY });
        await give(sdk, ['rune_scimitar', 'twpart1', 'twpart2', 'twpart3', 'twpart4']);
        await give(sdk, 'mcannonball', 500);
        if (FOOD) await give(sdk, 'shark', FOOD);
        if (PPOTS) await give(sdk, '4doseprayerrestore', PPOTS);
        if (ANTI) await give(sdk, '4doseantipoison', ANTI);
        if (!(await wield(sdk, /rune scimitar/i)).ok) throw new Error('could not wield the rune scimitar');
        await sdk.sendClickComponent(151); // auto-retaliate off, so only the cannon earns xp (player_controls.rs2)
        await dismiss();
        let placed = false;
        for (const [dx, dz] of PLACE) {
            await tele(sdk, AT.x + dx, AT.z + dz);
            const r = await act(sdk, () => sdk.sendUseItem(slotOf(sdk, /cannon base/i), 1), s => !invItem(s, /cannon base/i), { maxTicks: 6, resendEvery: 0 });
            if (r.ok) { placed = true; break; }
        }
        if (!placed) throw new Error('no tile fitted the cannon');
        for (const [part, onto] of ASSEMBLE) {
            const l = await findLoc(sdk, { name: onto, op: /^pick-up$/i });
            if (!l) throw new Error(`no ${onto} to build the ${part} onto`);
            await act(sdk, () => sdk.sendUseItemOnLoc(slotOf(sdk, part), l.x, l.z, l.id), s => !invItem(s, part), { maxTicks: 20 });
        }
        let cannon = await multicannon();
        if (!cannon) throw new Error('the cannon did not assemble');
        const ballSlot = () => invItem(sdk, /cannonball/i)?.slot ?? -1;
        await sdk.sendUseItemOnLoc(ballSlot(), cannon.x, cannon.z, cannon.id);
        await waitTicks(sdk, 2);
        if (PROTECT) await sdk.sendTogglePrayer('protect_from_melee');
        await sdk.sendInteractLoc(cannon.x, cannon.z, cannon.id, 1);
        await waitTicks(sdk, 1);

        // ---- firing window: real survival ----
        const tFire = currentTick(sdk);
        let s = sdk.getState()!;
        const r0 = skillXp(s, 'Ranged'), hp0 = skillXp(s, 'Hitpoints');
        const food0 = count(s, /^Shark$/i), pp0 = count(s, /^Prayer potion/), ap0 = count(s, /^Antipoison/);
        const upkeep = new Upkeep(sdk, { ...(PROTECT ? { prayer: 'protect_from_melee' as const } : {}), drinkBelow: DRINK_BELOW, eatBelow: EAT_BELOW, food: /^Shark$/i });
        let lastHp = s.player!.hp, minHp = lastHp, dmg = 0, poisonDmg = 0, spiderHits = 0;
        const poisonedAt: number[] = [];
        let lastReload = tFire, lastAnti = -1000, lastContinue = -1, died = false, end = 'window';
        const seen = new Set<string>();
        while (currentTick(sdk) - tFire < TICKS) {
            try { s = await sdk.waitForStateUpdate(); } catch { continue; }
            const p = s.player!;
            if (p.isDead || p.hp <= 0) { died = true; end = 'died'; break; }
            const msgs: string[] = [];
            for (const m of s.gameMessages) { const k = `${m.tick}|${m.text}`; if (!seen.has(k)) { seen.add(k); msgs.push(m.text); } }
            if (msgs.some(m => /You have been poisoned/i.test(m))) poisonedAt.push(s.tick - tFire);
            // a hitpoint drop with a spider hitsplat on us this tick is a melee hit; otherwise it is poison
            const meleeHit = (s.combatEvents ?? []).some(e => e.type === 'damage_taken' && e.tick === s.tick && e.damage > 0);
            if (p.hp < lastHp) { dmg += lastHp - p.hp; if (meleeHit) spiderHits++; else poisonDmg += lastHp - p.hp; }
            lastHp = p.hp; minHp = Math.min(minHp, p.hp);
            if (s.dialog.isOpen) {
                if (s.tick !== lastContinue) { lastContinue = s.tick; await clickContinue(sdk); }
                continue;
            }
            if (upkeep.step(s)) continue; // ate or drank this tick
            if (ANTI && poisonedAt.length && poisonedAt.at(-1)! + tFire > lastAnti) { const it = s.inventory.find(i => /^Antipoison/.test(i.name)); if (it) { await sdk.sendUseItem(it.slot, 1); lastAnti = s.tick; continue; } }
            if (msgs.some(m => /out of ammo/i.test(m)) || s.tick - lastReload >= 20) {
                cannon = (await multicannon()) ?? cannon;
                if (ballSlot() >= 0) await sdk.sendUseItemOnLoc(ballSlot(), cannon.x, cannon.z, cannon.id);
                lastReload = s.tick;
                if (msgs.some(m => /out of ammo/i.test(m))) { await waitTicks(sdk, 1); await sdk.sendInteractLoc(cannon.x, cannon.z, cannon.id, 1); }
            }
            if (UNTIL && lvl(s, 'Ranged') >= UNTIL) { end = `Ranged ${UNTIL}`; break; }
        }
        if (PROTECT) await bot.deactivateAllPrayers().catch(() => {});
        // pick the cannon up so the next run can set it again
        cannon = (await multicannon()) ?? cannon;
        await opLoc(sdk, cannon, /^pick-up$/i, st => !!invItem(st, /cannon base/i), { maxTicks: 30 });
        const s1 = sdk.getState()!;
        const r = {
            run, end, ticks: currentTick(sdk) - tFire, died, rangedLevels: [RNG, lvl(s1, 'Ranged')], rangedBase: Math.round((skillXp(s1, 'Ranged') - r0) / XP_RATE),
            hpXpBase: Math.round((skillXp(s1, 'Hitpoints') - hp0) / XP_RATE), damageTaken: dmg, poisonDamage: poisonDmg, spiderHitsLanded: spiderHits,
            timesPoisoned: poisonedAt.length, firstPoisonedAt: poisonedAt[0] ?? null, minHp, hpEnd: s1.player?.hp,
            sharksEaten: food0 - count(s1, /^Shark$/i), prayerDoses: pp0 - count(s1, /^Prayer potion/), antipoisonDoses: ap0 - count(s1, /^Antipoison/), prayerPointsUsed: upkeep.prayerUsed,
        };
        results.push(r);
        console.log(`run ${run}: ${JSON.stringify(r)}`);
        if (died) { await waitTicks(sdk, 15); await dismiss(); }
    }
    result('cannon', { tickrate: process.env.NODE_TICKRATE ?? '?', stats: { ATT, STR, DEF, RNG, HP, PRAY }, ticks: TICKS, food: FOOD, ppots: PPOTS, antipoison: ANTI, protect: PROTECT, results });
}, { timeout: 3 * 3_600_000, printState: false });
