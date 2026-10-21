// Dragon Slayer: the Elvarg fight, from the first attack click to the kill
// (the quest completes on the kill, elvarg.rs2:13-14).
// Run: bun docs/speedrun/scripts/quest-dragon-elvarg.ts <botname> <profile> [runs]
// Profiles (base levels set with ::setstat; gear spawned with ::give):
//   70   Attack/Strength/Defence 70, Hitpoints 70
//   50   Attack/Strength/Defence 50, Hitpoints 50
//   40   Attack/Strength/Defence 40, Hitpoints 40 (rune scimitar and rune armour need 40)
//   99   Attack/Strength/Defence 99, Hitpoints 99
// Gear for every profile: rune scimitar (aggressive, slash), rune full helm,
// rune chainbody, rune platelegs, amulet of strength, Dragonfire shield
// (antidragonbreathshield), 20 sharks. Eats a shark when hp < 45% of max.
// A run is only fought if all six items are verified worn.
// Each run: setvar dragonquest 9 (sailed to Crandor), reset the stats, stand
// outside the lair gate, open it, attack Elvarg. Ticks are reported from the
// gate click and from the first attack click.

import { runScript } from '../../../sdk/runner';
import { cheat, give, invCount, now, pos, result, tele, waitTicks, waitUntil } from './quest-primitives-lib';
import { clickLoc } from './quest-dragon-lib';

const PROFILE = process.argv[3] ?? '70';
const RUNS = Number(process.argv[4] ?? 3);
const LVL = Number(PROFILE);
const GEAR: Array<[string, RegExp]> = [
    ['rune_scimitar', /^rune scimitar$/i],
    ['rune_full_helm', /^rune full helm$/i],
    ['rune_chainbody', /^rune chainbody$/i],
    ['rune_platelegs', /^rune platelegs$/i],
    ['amulet_of_strength', /^amulet of strength$/i],
    ['antidragonbreathshield', /^dragonfire shield$/i],
];
const inElvargLair = (p: { x: number; z: number; level: number }) => p.level === 0 && p.x >= 2848 && p.x <= 2863 && p.z >= 9628 && p.z <= 9646;

await runScript(async ({ bot, sdk }) => {
    const runs = [];
    for (let i = 0; i < RUNS; i++) {
        for (const [stat, lvl] of [['attack', LVL], ['strength', LVL], ['defence', LVL], ['hitpoints', LVL], ['prayer', 1]] as const) { await cheat(sdk, `setstat ${stat} ${lvl}`); await waitTicks(sdk, 1); }
        await cheat(sdk, 'setvar dragonquest 9'); await waitTicks(sdk, 1);
        // gear: spawn what is missing, wear it, verify
        for (const [obj, re] of GEAR) {
            const st = sdk.getState()!;
            if (!st.equipment.some(e => re.test(e.name)) && !st.inventory.some(e => re.test(e.name))) await give(sdk, obj, 1);
            if (!sdk.getState()!.equipment.some(e => re.test(e.name))) {
                const r = await bot.equipItem(re);
                if (!r.success) console.log('equip failed', obj, r.message);
                await waitTicks(sdk, 1);
            }
        }
        const worn = sdk.getState()!.equipment.map(e => e.name);
        const missing = GEAR.filter(([, re]) => !worn.some(n => re.test(n))).map(([o]) => o);
        if (missing.length) { runs.push({ profile: PROFILE, error: 'gear not worn', missing, worn }); console.log('gear not worn', missing, worn); continue; }
        const sharks = invCount(sdk.getState(), /^shark$/i);
        if (sharks < 20) await give(sdk, 'shark', 20 - sharks);
        await sdk.sendSetCombatStyle(1); // scimitar: aggressive (slash)
        await waitTicks(sdk, 1);

        await tele(sdk, 2845, 9637);
        // Elvarg respawns 15 ticks after a kill (quest_dragon.npc respawnrate)
        await waitUntil(sdk, s => s.nearbyNpcs.some(n => /^elvarg$/i.test(n.name)), 40);
        const xp0 = Object.fromEntries(sdk.getState()!.skills.map(s => [s.name.toLowerCase(), s.experience]));
        const life0 = sdk.getState()!.player!.respawnCount;

        const tGate = now(sdk);
        await clickLoc(sdk, /^gate$/i, /^open$/i, { x: 2847, z: 9637 }, { x: 2847, z: 9637, id: 2608, op: 1 });
        const inside = await waitUntil(sdk, s => inElvargLair(pos(s)), 40);
        const gateTicks = inside ? inside.tick - tGate : null;
        const afterGate = pos(sdk.getState());

        let eaten = 0, levelUps = 0, minHp = 999, dmgTaken = 0, lastHp = sdk.getState()!.player!.hp, hits = 0, maxHit = 0;
        let busy = false;
        const tAttack = now(sdk);
        let killTick: number | null = null;
        let died = false;
        const unsub = sdk.onStateUpdate(s => {
            const p = s.player!;
            if (p.hp < lastHp) { dmgTaken += lastHp - p.hp; hits++; maxHit = Math.max(maxHit, lastHp - p.hp); }
            lastHp = p.hp;
            minHp = Math.min(minHp, p.hp);
            if (busy) return;
            if (s.dialog.isOpen && !s.dialog.isWaiting) { // level-up dialog: dismiss it
                busy = true; levelUps++;
                void sdk.sendClickDialog(0).finally(() => { busy = false; });
                return;
            }
            if (p.hp > 0 && p.hp < p.maxHp * 0.45) {
                const food = s.inventory.find(x => /^shark$/i.test(x.name));
                const op = food?.optionsWithIndex.find(o => /eat/i.test(o.text));
                if (food && op) { busy = true; eaten++; void sdk.sendUseItem(food.slot, op.opIndex).then(() => waitTicks(sdk, 1)).finally(() => { busy = false; }); return; }
            }
        });
        let attacks = 0;
        while (now(sdk) - tAttack < 600) {
            const s = sdk.getState()!;
            if (s.player!.isDead || s.player!.respawnCount > life0 || !inElvargLair(pos(s)) && pos(s).x > 2900) { died = true; break; }
            const e = s.nearbyNpcs.find(n => /^elvarg$/i.test(n.name));
            if (!e || e.hp === 0) { killTick = now(sdk); break; }
            const fighting = s.player!.combat.targetType === 'npc' && s.player!.combat.targetIndex === e.index;
            if (!fighting && !s.dialog.isOpen && attacks < 200) {
                const op = e.optionsWithIndex.find(o => /attack/i.test(o.text));
                if (op) { await sdk.sendInteractNpc(e.index, op.opIndex); attacks++; }
            }
            await waitTicks(sdk, 1);
        }
        // the quest completes on the kill and teleports the player to (2846,9636)
        const done = killTick !== null ? await waitUntil(sdk, s => pos(s).x <= 2846 && pos(s).z < 9700, 15) : null;
        unsub();
        await waitTicks(sdk, 3);
        const xp1 = Object.fromEntries(sdk.getState()!.skills.map(s => [s.name.toLowerCase(), s.experience]));
        const gained = Object.fromEntries(Object.keys(xp1).filter(k => xp1[k] !== xp0[k]).map(k => [k, xp1[k] - xp0[k]]));
        const run = {
            profile: PROFILE, gateTicks, afterGate, fightTicks: killTick !== null ? killTick - tAttack : null,
            gateToKill: killTick !== null ? killTick - tGate : null, attackClicks: attacks, died,
            eaten, levelUpDialogs: levelUps, minHp, dmgTaken, hitsTaken: hits, biggestHit: maxHit,
            endPos: pos(sdk.getState()), questCompleteTeleport: done !== null, xpGained: gained,
        };
        runs.push(run);
        console.log('run', i, JSON.stringify(run));
        if (sdk.getState()!.modalOpen) { await sdk.sendCloseModal(); await waitTicks(sdk, 1); }
        for (let k = 0; k < 10 && sdk.getState()!.dialog.isOpen; k++) { await sdk.sendClickDialog(0); await waitTicks(sdk, 1); }
    }
    result(`elvarg.${PROFILE}`, runs);
}, { timeout: 1_800_000 });
