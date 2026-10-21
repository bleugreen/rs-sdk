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
import type { BotWorldState, NearbyLoc } from '../../../sdk/types';

const argv = process.argv.slice(3);
const RUNS = Number(/^\d+$/.test(argv[0] ?? '') ? argv[0] : 2);
const kv = Object.fromEntries(argv.filter(a => a.includes('=')).map(a => a.split('=', 2) as [string, string]));
const [ATT, STR, DEF, RNG, HP, PRAY] = (kv.stats ?? '99,1,1,1,42,43').split(',').map(Number);
const TICKS = Number(kv.ticks ?? 150);
const UNTIL = Number(kv.until ?? 0);
const FOOD = Number(kv.food ?? 5), EAT_BELOW = Number(kv.eatBelow ?? 12);
const PPOTS = Number(kv.ppots ?? 2), DRINK_BELOW = Number(kv.drinkBelow ?? 8);
const ANTI = Number(kv.antipoison ?? 0);
const PROTECT = (kv.protect ?? 'melee') === 'melee';
const AT: [number, number] = [3288, 3810];

await runScript(async ({ bot, sdk }) => {
    const tick = () => sdk.getState()!.tick;
    const waitTicks = (n: number) => sdk.waitForTicks(n);
    const say = async (m: string) => { await sdk.sendSay(m); await waitTicks(1); };
    const tele = (x: number, z: number) => say(`::tele 0,${x >> 6},${z >> 6},${x & 63},${z & 63}`);
    const dismiss = async () => { for (let i = 0; i < 10 && sdk.getState()?.dialog.isOpen; i++) { await sdk.sendClickDialog(0); await waitTicks(1); } };
    const loc = (re: RegExp, opt?: RegExp): NearbyLoc | undefined =>
        sdk.getNearbyLocs().filter(l => re.test(l.name) && (!opt || l.options.some(o => opt.test(o)))).sort((a, b) => a.distance - b.distance)[0];
    const count = (s: BotWorldState, re: RegExp) => s.inventory.filter(i => re.test(i.name)).reduce((a, i) => a + i.count * (Number(/\((\d)\)$/.exec(i.name)?.[1] ?? 1)), 0);
    const lvl = (s: BotWorldState, n: string) => s.skills.find(k => k.name === n)?.baseLevel ?? 0;
    const xp = (s: BotWorldState, n: string) => s.skills.find(k => k.name === n)?.experience ?? 0;
    await bot.skipTutorial().catch(() => {});
    await dismiss();
    const results: unknown[] = [];
    for (let run = 0; run < RUNS; run++) {
        // ---- untimed set-up ----
        await bot.deactivateAllPrayers().catch(() => {});
        const old = loc(/multicannon|cannon base|cannon stand/i, /pick-up/i);
        if (old) { await sdk.sendInteractLoc(old.x, old.z, old.id, 2); for (let i = 0; i < 30 && loc(/multicannon|cannon base|cannon stand/i); i++) await waitTicks(1); }
        for (const e of sdk.getEquipment()) await sdk.sendUseEquipmentItem(e.slot, 1).catch(() => {});
        await waitTicks(1);
        for (const it of sdk.getInventory()) await sdk.sendDropItem(it.slot);
        await waitTicks(2);
        await say('::setvar mcannon 11');
        await say('::setvar ownedmcannon -1'); // forget a previous run's cannon (cannon_setup.rs2:59-63)
        await say('::setvar poison 0');
        const names = ['attack', 'strength', 'defence', 'ranged', 'hitpoints', 'prayer'];
        for (const [i, v] of [ATT, STR, DEF, RNG, HP, PRAY].entries()) await say(`::setstat ${names[i]} ${v}`);
        for (const o of ['rune_scimitar', 'twpart1', 'twpart2', 'twpart3', 'twpart4']) await say(`::give ${o} 1`);
        await say('::give mcannonball 500');
        if (FOOD) await say(`::give shark ${FOOD}`);
        if (PPOTS) await say(`::give 4doseprayerrestore ${PPOTS}`);
        if (ANTI) await say(`::give 4doseantipoison ${ANTI}`);
        await waitTicks(2);
        await bot.equipItem(sdk.findInventoryItem(/rune scimitar/i)!);
        await sdk.sendClickComponent(151); // auto-retaliate off, so only the cannon earns xp (player_controls.rs2)
        await dismiss();
        let placed = false;
        for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1], [2, 0], [0, 2]]) {
            await tele(AT[0] + dx, AT[1] + dz);
            await waitTicks(1);
            await sdk.sendUseItem(sdk.findInventoryItem(/cannon base/i)!.slot, 1);
            for (let i = 0; i < 6 && sdk.findInventoryItem(/cannon base/i); i++) await waitTicks(1);
            if (!sdk.findInventoryItem(/cannon base/i)) { placed = true; break; }
        }
        if (!placed) throw new Error('no tile fitted the cannon');
        for (const [itemRe, locRe] of [[/cannon stand/i, /cannon base/i], [/cannon barrels/i, /cannon stand/i], [/cannon furnace/i, /cannon base/i]] as [RegExp, RegExp][]) {
            const l = loc(locRe, /pick-up/i)!;
            await sdk.sendUseItemOnLoc(sdk.findInventoryItem(itemRe)!.slot, l.x, l.z, l.id);
            for (let i = 0; i < 20 && sdk.findInventoryItem(itemRe); i++) await waitTicks(1);
        }
        let cannon = loc(/multicannon/i)!;
        const ballSlot = () => sdk.findInventoryItem(/cannonball/i)?.slot ?? -1;
        await sdk.sendUseItemOnLoc(ballSlot(), cannon.x, cannon.z, cannon.id);
        await waitTicks(2);
        if (PROTECT) await sdk.sendTogglePrayer('protect_from_melee');
        await sdk.sendInteractLoc(cannon.x, cannon.z, cannon.id, 1);
        await waitTicks(1);

        // ---- firing window: real survival ----
        const tFire = tick();
        let s = sdk.getState()!;
        const r0 = xp(s, 'Ranged'), hp0 = xp(s, 'Hitpoints');
        const food0 = count(s, /^Shark$/i), pp0 = count(s, /^Prayer potion/), ap0 = count(s, /^Antipoison/);
        let lastHp = s.player!.hp, minHp = lastHp, dmg = 0, poisonDmg = 0, poisonedAt: number[] = [], spiderHits = 0;
        let lastPts = sdk.getPrayerState()?.prayerPoints ?? PRAY, ptsUsed = 0;
        let lastReload = tFire, lastEat = -10, lastDrink = -10, lastAnti = -1000, died = false, end = 'window';
        const seen = new Set<string>();
        while (tick() - tFire < TICKS) {
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
            const pts = sdk.getPrayerState()?.prayerPoints ?? lastPts;
            if (pts < lastPts) ptsUsed += lastPts - pts;
            lastPts = pts;
            if (s.dialog.isOpen) { await sdk.sendClickDialog(0); continue; }
            if (PROTECT && pts > 0 && !sdk.isPrayerActive('protect_from_melee') && (s.tick - tFire) % 3 === 0) await sdk.sendTogglePrayer('protect_from_melee');
            if (pts < DRINK_BELOW && s.tick - lastDrink >= 3) { const it = s.inventory.find(i => /^Prayer potion/.test(i.name)); if (it) { await sdk.sendUseItem(it.slot, 1); lastDrink = s.tick; continue; } }
            if (p.hp < EAT_BELOW && s.tick - lastEat >= 3) { const it = s.inventory.find(i => /^Shark$/i.test(i.name)); if (it) { await sdk.sendUseItem(it.slot, 1); lastEat = s.tick; continue; } }
            if (ANTI && poisonedAt.length && poisonedAt.at(-1)! + tFire > lastAnti) { const it = s.inventory.find(i => /^Antipoison/.test(i.name)); if (it) { await sdk.sendUseItem(it.slot, 1); lastAnti = s.tick; continue; } }
            if (msgs.some(m => /out of ammo/i.test(m)) || s.tick - lastReload >= 20) {
                cannon = loc(/multicannon/i) ?? cannon;
                if (ballSlot() >= 0) await sdk.sendUseItemOnLoc(ballSlot(), cannon.x, cannon.z, cannon.id);
                lastReload = s.tick;
                if (msgs.some(m => /out of ammo/i.test(m))) { await waitTicks(1); await sdk.sendInteractLoc(cannon.x, cannon.z, cannon.id, 1); }
            }
            if (UNTIL && lvl(s, 'Ranged') >= UNTIL) { end = `Ranged ${UNTIL}`; break; }
        }
        if (PROTECT) await bot.deactivateAllPrayers().catch(() => {});
        // pick the cannon up so the next run can set it again (op 2, as in ranged-cannon.ts)
        cannon = loc(/multicannon/i) ?? cannon;
        await sdk.sendInteractLoc(cannon.x, cannon.z, cannon.id, 2);
        for (let i = 0; i < 30 && !sdk.findInventoryItem(/cannon base/i); i++) await waitTicks(1);
        const s1 = sdk.getState()!;
        const r = {
            run, end, ticks: tick() - tFire, died, rangedLevels: [RNG, lvl(s1, 'Ranged')], rangedBase: Math.round((xp(s1, 'Ranged') - r0) / 25),
            hpXpBase: Math.round((xp(s1, 'Hitpoints') - hp0) / 25), damageTaken: dmg, poisonDamage: poisonDmg, spiderHitsLanded: spiderHits,
            timesPoisoned: poisonedAt.length, firstPoisonedAt: poisonedAt[0] ?? null, minHp, hpEnd: s1.player?.hp,
            sharksEaten: food0 - count(s1, /^Shark$/i), prayerDoses: pp0 - count(s1, /^Prayer potion/), antipoisonDoses: ap0 - count(s1, /^Antipoison/), prayerPointsUsed: ptsUsed,
        };
        results.push(r);
        console.log(`run ${run}: ${JSON.stringify(r)}`);
        if (died) { await waitTicks(15); await dismiss(); }
    }
    console.log(`RESULT cannon ${JSON.stringify({ tickrate: process.env.NODE_TICKRATE ?? '?', stats: { ATT, STR, DEF, RNG, HP, PRAY }, ticks: TICKS, food: FOOD, ppots: PPOTS, antipoison: ANTI, protect: PROTECT, results })}`);
}, { timeout: 3 * 3_600_000, printState: false });
