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
import type { BotWorldState, NearbyLoc } from '../../../sdk/types';
import { ensureItem, give, mustTele, setStats, setvar } from '../../../speedrun/lab/setup';
import { result } from '../../../speedrun/lab/record';
import { opLoc, wield } from '../../../speedrun/lib/act';
import { fight } from '../../../speedrun/lib/combat';
import { converse } from '../../../speedrun/lib/converse';
import { currentTick, waitTicks, waitUntil } from '../../../speedrun/lib/wait';
import { findLoc, invItem, pos, waitForNpc, worn, type Tile } from '../../../speedrun/lib/world';

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
// The lair zone from quest_dragon.rs2:27 (0_44_150_31_28 to 0_44_150_47_46); the gate tiles are its west edge.
const inElvargLair = (p: Tile) => p.level === 0 && p.x >= 2847 && p.x <= 2863 && p.z >= 9628 && p.z <= 9646;
// Elvarg's lair gate (loc.pack); addressed by tile and id when the client does not list it, op 1 being Open.
const GATE = { x: 2847, z: 9637, id: 2608 };
const GATE_LOC: NearbyLoc = { ...GATE, name: 'Gate', level: 0, distance: 0, options: ['Open'], optionsWithIndex: [{ text: 'Open', opIndex: 1 }] };

const skillXp = (s: BotWorldState): Record<string, number> => Object.fromEntries(s.skills.map(k => [k.name.toLowerCase(), k.experience]));

await runScript(async ({ sdk }) => {
    const runs = [];
    for (let i = 0; i < RUNS; i++) {
        await setStats(sdk, { attack: LVL, strength: LVL, defence: LVL, hitpoints: LVL, prayer: 1 });
        await setvar(sdk, 'dragonquest', 9);
        // gear: spawn what is missing, wear it, verify (two passes: a wield can
        // fail while the previous weapon or shield is being swapped out)
        for (const [obj, re] of [...GEAR, ...GEAR]) {
            if (!worn(sdk, re) && !invItem(sdk, re)) await give(sdk, obj, 1);
            if (!worn(sdk, re) && invItem(sdk, re)) {
                const r = await wield(sdk, re);
                if (!r.ok) console.log('equip failed', obj, r.reason);
            }
        }
        const wornNames = sdk.getState()!.equipment.map(e => e.name);
        const missing = GEAR.filter(([, re]) => !worn(sdk, re)).map(([o]) => o);
        if (missing.length) { runs.push({ profile: PROFILE, error: 'gear not worn', missing, worn: wornNames }); console.log('gear not worn', missing, wornNames); continue; }
        await ensureItem(sdk, 'shark', /^shark$/i, 20);
        await sdk.sendSetCombatStyle(1); // scimitar: aggressive (slash)
        await waitTicks(sdk, 1);

        await mustTele(sdk, 2845, 9637);
        // Elvarg respawns 15 ticks after a kill (quest_dragon.npc respawnrate)
        await waitForNpc(sdk, /^elvarg$/i, 40);
        const xp0 = skillXp(sdk.getState()!);
        const life0 = sdk.getState()!.player!.respawnCount;

        const gate = (await findLoc(sdk, GATE)) ?? GATE_LOC;
        const tGate = currentTick(sdk);
        const g = await opLoc(sdk, gate, /^open$/i, s => inElvargLair(pos(s)), { maxTicks: 40 });
        const gateTicks = g.ok ? g.ticks : null;
        const afterGate = pos(sdk);

        // Hits taken, as hitpoint drops between published states.
        let dmgTaken = 0, hits = 0, maxHit = 0, lastHp = sdk.getState()!.player!.hp;
        const unsub = sdk.onStateUpdate(s => {
            const hp = s.player?.hp;
            if (hp === undefined) return;
            if (hp < lastHp) { dmgTaken += lastHp - hp; hits++; maxHit = Math.max(maxHit, lastHp - hp); }
            lastHp = hp;
        });
        const tAttack = currentTick(sdk);
        const f = await fight(sdk, /^elvarg$/i, {
            food: /^shark$/i,
            eatBelow: sdk.getState()!.player!.maxHp * 0.45,
            maxTicks: 600,
            // a death respawns the player in Lumbridge; the kill's quest-complete teleport lands west of the gate
            done: s => (s.player?.respawnCount ?? life0) > life0 || (!inElvargLair(pos(s)) && pos(s).x > 2900),
            onDialog: 'continue',
        });
        const killed = f.end === 'killed';
        const died = f.died || f.end === 'done';
        // the quest completes on the kill and teleports the player to (2846,9636)
        const done = killed ? await waitUntil(sdk, s => pos(s).x <= 2846 && pos(s).z < 9700, { maxTicks: 15 }) : null;
        unsub();
        await waitTicks(sdk, 3);
        const xp1 = skillXp(sdk.getState()!);
        const gained = Object.fromEntries(Object.keys(xp1).filter(k => xp1[k] !== xp0[k]).map(k => [k, (xp1[k] ?? 0) - (xp0[k] ?? 0)]));
        const run = {
            profile: PROFILE, gateTicks, afterGate, fightEnd: f.end, fightTicks: killed ? f.ticks : null,
            gateToKill: killed ? tAttack + f.ticks - tGate : null, attackClicks: f.attacks, died,
            eaten: f.eats, levelUpDialogs: f.levelUps, minHp: f.minHp, dmgTaken, hitsTaken: hits, biggestHit: maxHit,
            endPos: pos(sdk), questCompleteTeleport: done?.ok === true, xpGained: gained,
        };
        runs.push(run);
        console.log('run', i, JSON.stringify(run));
        if (sdk.getState()!.modalOpen) { await sdk.sendCloseModal(); await waitTicks(sdk, 1); }
        if (sdk.getState()!.dialog.isOpen) await converse(sdk, [], { unmatched: 'first', maxTicks: 30 });
    }
    result(`elvarg.${PROFILE}`, runs);
}, { timeout: 1_800_000 });
