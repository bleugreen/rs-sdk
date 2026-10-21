// Dragon Slayer: the Elvarg fight, from the first attack click to the kill
// (the quest completes on the kill, elvarg.rs2:13-14).
// Run: bun docs/speedrun/scripts/quest-dragon-elvarg.ts <botname> <profile> [runs]
// Profiles (base levels set with ::setstat; gear spawned with ::give):
//   70   Attack/Strength/Defence 70, Hitpoints 70
//   50   Attack/Strength/Defence 50, Hitpoints 50
//   40   Attack/Strength/Defence 40, Hitpoints 40 (rune scimitar needs 40)
//   99   Attack/Strength/Defence 99, Hitpoints 99
// Gear for every profile: rune scimitar (aggressive, slash), rune full helm,
// rune chainbody, rune platelegs, amulet of strength, Dragonfire shield
// (antidragonbreathshield), 20 sharks. Eats a shark when hp < 45% of max.
// Each run: setvar dragonquest 9 (sailed to Crandor), reset the stats, stand
// outside the lair gate, open it, attack Elvarg. Ticks are reported from the
// gate click and from the first attack click.

import { runScript } from '../../../sdk/runner';
import { cheat, give, invCount, now, pos, result, tele, waitTicks, waitUntil } from './quest-primitives-lib';
import { clickLoc } from './quest-dragon-lib';

const PROFILE = process.argv[3] ?? '70';
const RUNS = Number(process.argv[4] ?? 3);
const LVL = Number(PROFILE);
const GEAR = ['rune_scimitar', 'rune_full_helm', 'rune_chainbody', 'rune_platelegs', 'amulet_of_strength', 'antidragonbreathshield'];
const GEAR_RE = /^(rune scimitar|rune full helm|rune chainbody|rune platelegs|amulet of strength|dragonfire shield)$/i;

await runScript(async ({ sdk }) => {
    const runs = [];
    for (let i = 0; i < RUNS; i++) {
        for (const [stat, lvl] of [['attack', LVL], ['strength', LVL], ['defence', LVL], ['hitpoints', LVL], ['prayer', 1]] as const) { await cheat(sdk, `setstat ${stat} ${lvl}`); await waitTicks(sdk, 1); }
        await cheat(sdk, 'setvar dragonquest 9'); await waitTicks(sdk, 1);
        // gear: give whatever is not worn or held, then wear it
        for (const g of GEAR) {
            const name = g.replace(/_/g, ' ').replace('antidragonbreathshield', 'dragonfire shield');
            const has = sdk.getState()!.equipment.some(e => e.name.toLowerCase() === name) || sdk.getState()!.inventory.some(e => e.name.toLowerCase() === name);
            if (!has) await give(sdk, g, 1);
        }
        for (const it of sdk.getState()!.inventory.filter(x => GEAR_RE.test(x.name))) {
            const op = it.optionsWithIndex.find(o => /wield|wear/i.test(o.text));
            if (op) { await sdk.sendUseItem(it.slot, op.opIndex); await waitTicks(sdk, 1); }
        }
        const sharks = invCount(sdk.getState(), /^shark$/i);
        if (sharks < 20) await give(sdk, 'shark', 20 - sharks);
        await sdk.sendSetCombatStyle(1); // scimitar: aggressive (slash)
        await waitTicks(sdk, 1);

        await tele(sdk, 2845, 9637);
        // Elvarg respawns 15 ticks after a kill (quest_dragon.npc respawnrate)
        await waitUntil(sdk, s => s.nearbyNpcs.some(n => /^elvarg$/i.test(n.name)), 40);
        const xp0 = Object.fromEntries(sdk.getState()!.skills.map(s => [s.name.toLowerCase(), s.experience]));

        const tGate = now(sdk);
        await clickLoc(sdk, /^gate$/i, /^open$/i, { x: 2847, z: 9637 });
        const inside = await waitUntil(sdk, s => pos(s).x >= 2848, 20);
        const gateTicks = inside ? inside.tick - tGate : null;

        let eaten = 0, levelUps = 0, minHp = 999, dmgTaken = 0, lastHp = sdk.getState()!.player!.hp, breaths = 0, hits = 0;
        let busy = false;
        const tAttack = now(sdk);
        let killTick: number | null = null;
        const unsub = sdk.onStateUpdate(s => {
            const p = s.player!;
            if (p.hp < lastHp) { dmgTaken += lastHp - p.hp; hits++; }
            lastHp = p.hp;
            minHp = Math.min(minHp, p.hp);
            if (busy) return;
            if (s.dialog.isOpen && !s.dialog.isWaiting) { // level-up (or quest) dialog: dismiss it
                busy = true; levelUps++;
                void sdk.sendClickDialog(0).finally(() => { busy = false; });
                return;
            }
            if (p.hp < p.maxHp * 0.45) {
                const food = s.inventory.find(x => /^shark$/i.test(x.name));
                const op = food?.optionsWithIndex.find(o => /eat/i.test(o.text));
                if (food && op) { busy = true; eaten++; void sdk.sendUseItem(food.slot, op.opIndex).finally(() => { busy = false; }); return; }
            }
        });
        const chatSeen = new Set<string>();
        const chatUnsub = sdk.onStateUpdate(() => {
            for (const m of sdk.getChat({ limit: 5 })) if (/absorbs most of the dragon fire/i.test(m.text) && !chatSeen.has(m.text + m.tick)) { chatSeen.add(m.text + m.tick); breaths++; }
        });
        // attack, and re-attack if the player stops attacking while Elvarg lives
        let attacks = 0;
        while (now(sdk) - tAttack < 600) {
            const s = sdk.getState()!;
            const e = s.nearbyNpcs.find(n => /^elvarg$/i.test(n.name));
            if (!e || (e.hp === 0)) { killTick = now(sdk); break; }
            if (s.player!.isDead) break;
            const fighting = s.player!.combat?.inCombat || (s.player as any).combat?.targetIndex === e.index;
            if (!fighting && !s.dialog.isOpen && attacks < 200) {
                const op = e.optionsWithIndex.find(o => /attack/i.test(o.text));
                if (op) { await sdk.sendInteractNpc(e.index, op.opIndex); attacks++; }
            }
            await waitTicks(sdk, 1);
        }
        // the quest completes on the kill and teleports the player to (2846,9636)
        const done = await waitUntil(sdk, s => s.varps?.dragonquest !== 9 || pos(s).x <= 2846, 15);
        unsub(); chatUnsub();
        await waitTicks(sdk, 3);
        const xp1 = Object.fromEntries(sdk.getState()!.skills.map(s => [s.name.toLowerCase(), s.experience]));
        const gained = Object.fromEntries(Object.keys(xp1).filter(k => xp1[k] !== xp0[k]).map(k => [k, xp1[k] - xp0[k]]));
        const run = {
            profile: PROFILE, gateTicks, fightTicks: killTick !== null ? killTick - tAttack : null,
            gateToKill: killTick !== null ? killTick - tGate : null, attackClicks: attacks,
            eaten, levelUpDialogs: levelUps, minHp, dmgTaken, hitsTaken: hits, breathMessages: breaths,
            died: sdk.getState()!.player!.isDead || sdk.getState()!.player!.respawnCount > 0,
            endPos: pos(sdk.getState()), questEnded: done !== null, xpGained: gained,
        };
        runs.push(run);
        console.log('run', i, JSON.stringify(run));
        // close the quest-complete scroll if it is up
        if (sdk.getState()!.modalOpen) { await sdk.sendCloseModal(); await waitTicks(sdk, 1); }
        while (sdk.getState()!.dialog.isOpen) { await sdk.sendClickDialog(0); await waitTicks(sdk, 1); }
    }
    result(`elvarg.${PROFILE}`, runs);
}, { timeout: 1_800_000 });
