// Watchtower: measured shortcut route.
//
//   docs/speedrun/scripts/quest-wtikov-lab.sh <newbot> docs/speedrun/scripts/quest-watchtower-route.ts
//
// Use a fresh bot name per run: the script never resets the quest varps.
// The route never starts the quest at the wizard. Gorad's tooth only needs
// %itwatchtower < 4 (gorad.rs2), the death rune buys the skavid map at any
// stage <= 5 and sets stage 6 (city_guard.rs2), and Grew talks at stage >= 2
// (grew.rs2), so the fingernails, the relic chain and Toban/Og are skipped.
//
// Setup (stats, items, the start teleport) is not counted. FROM=<phase>
// skips earlier phases after forcing the varps they would have set. A segment
// ends at its last effect: an arrival, a dialogue closing, an item landing.

import { runScript } from '../../../sdk/runner';
import { invOp, opLoc, pickup, talkTo, walkTo, wield } from '../../../speedrun/lib/act';
import { fight } from '../../../speedrun/lib/combat';
import { converse, type ConverseOptions, type ConverseResult } from '../../../speedrun/lib/converse';
import type { OptionPattern } from '../../../speedrun/lib/dialogue';
import type { ItemPattern } from '../../../speedrun/lib/items';
import { waitUntil } from '../../../speedrun/lib/wait';
import { configId, findLoc, findNpc, invCount, invItem, pos, skillXp, type Tile } from '../../../speedrun/lib/world';
import { Recorder } from '../../../speedrun/lab/record';
import { getvar, give, mustTele, setStats, setvar } from '../../../speedrun/lab/setup';

const VARS = ['itwatchtower', 'itwatchtower_bits', 'gutanoth_gold'];
const under = (p: { z: number }) => p.z > 6400;
const obj = (name: string) => configId('obj', name);
// Over once closed for 2 ticks; a choice no queued pattern answers takes its
// first option; a modal opened between pages is closed.
const DLG: ConverseOptions = { idle: 2, unmatched: 'first', closeModals: true };

/**
 * The mad skavid's answer depends on the phrase he said earlier in the
 * conversation (quest_itwatchtower.rs2); null when none has been said yet.
 */
function madChooser(transcript: string): RegExp | null {
    if (/Ar cur/i.test(transcript)) return /^Gor/;
    if (/Bidith ig/i.test(transcript)) return /^Cur/;
    if (/Cur tanath/i.test(transcript)) return /^Bidith/;
    if (/Gor nod/i.test(transcript)) return /^Tanath/;
    return null;
}

await runScript(async ({ bot, sdk }) => {
    await sdk.waitForReady(60_000);
    const p0 = pos(sdk);
    if (sdk.getState()!.modalOpen || (p0.x < 3150 && p0.z < 3130)) {
        const r = await bot.skipTutorial();
        console.log('[setup] tutorial', r.message, JSON.stringify(pos(sdk)));
    }
    await setStats(sdk, { attack: 70, strength: 70, defence: 70, hitpoints: 70, agility: 25, mining: 40, herblore: 14, magic: 14 });
    for (const [o, n] of [
        ['rune_scimitar', 1], ['deathrune', 1], ['gold_bar', 1], ['torch_lit', 1], ['guamvial', 1],
        ['jangerberries', 1], ['ground_bat_bones', 1], ['rune_pickaxe', 1], ['shark', 8],
    ] as [string, number][]) await give(sdk, o, n);
    await wield(sdk, /rune scimitar/i);
    await setStats(sdk, { hitpoints: 70 });

    const rec = new Recorder(sdk, 'Watchtower route');
    const FROM = process.env.FROM ?? 'gorad';
    const phases = ['gorad', 'gate', 'map', 'scared', 'talkers', 'grew', 'mad', 'enclave1', 'wizard1', 'enclave2', 'finish'];
    const run = (p: string) => phases.indexOf(p) >= phases.indexOf(FROM);
    const start: Record<string, [number, number, number]> = {
        gorad: [2577, 3026, 0], gate: [2550, 3033, 0], map: [2549, 3027, 0], scared: [2549, 3027, 0],
        talkers: [2552, 3034, 0], grew: [2524, 3070, 0], mad: [2513, 3082, 0], enclave1: [2529, 3013, 0],
        wizard1: [2540, 3054, 0], enclave2: [2544, 3112, 2], finish: [2540, 3054, 0],
    };
    const s0 = start[FROM];
    if (!s0) throw new Error(`unknown FROM=${FROM}; phases ${phases.join(', ')}`);
    await mustTele(sdk, ...s0);

    const logVars = async () => {
        const out: string[] = [];
        for (const n of VARS) out.push(`${n}=${await getvar(sdk, n)}`);
        console.log('[vars] ' + out.join(' ') + ' @' + JSON.stringify(pos(sdk)));
    };
    await logVars();

    const walk = async (x: number, z: number, tol = 1) => {
        const r = await walkTo(bot, sdk, x, z, tol);
        if (!r.ok) console.log(`[walk] to ${x},${z} failed: ${r.message}; at ${JSON.stringify(pos(sdk))}`);
        rec.mark();
    };
    /** Wait until the player's tile satisfies `pred`; the segment's effect is the arrival. */
    const waitPos = async (pred: (p: Tile) => boolean, maxTicks: number) => {
        const r = await waitUntil(sdk, s => pred(pos(s)), { maxTicks });
        rec.mark(r.ok ? r.tick : undefined);
        return r.ok;
    };
    const record = (r: ConverseResult) => rec.dialogue(r);
    const near = (at?: [number, number]) => (at ? { x: at[0], z: at[1] } : undefined);
    const talk = async (npc: RegExp, choices: OptionPattern[] = [], at?: [number, number]) => {
        const n = findNpc(sdk, npc, near(at));
        if (!n) { console.log(`[npc] none matching ${npc}`); return null; }
        const r = await talkTo(sdk, n, choices, { ...DLG, openTicks: 30 });
        rec.interact(r.clicks);
        return record(r);
    };
    /**
     * Talk where the answer depends on what was said before: drive until a
     * choice page no pattern answers, let `choose` pick from the transcript so
     * far (the first option when it has no answer), and resume with that pick.
     */
    const talkChoosing = async (npc: RegExp, at: [number, number], choose: (transcript: string) => RegExp | null) => {
        const n = findNpc(sdk, npc, near(at));
        if (!n) { console.log(`[npc] none matching ${npc}`); return null; }
        const first = await talkTo(sdk, n, [], { ...DLG, openTicks: 30, unmatched: 'stop' });
        rec.interact(first.clicks);
        let r: ConverseResult = record(first);
        const seen = [...r.transcript];
        for (let i = 0; i < 20 && !r.ok && /^no choice/.test(r.reason ?? ''); i++) {
            const d = sdk.getState()!.dialog;
            const pick = choose(seen.join(' '));
            const pattern = pick && d.options.some(o => pick.test(o.text)) ? pick : d.options[0]?.text;
            r = await converse(sdk, pattern === undefined ? [] : [pattern], { ...DLG, unmatched: 'stop' });
            record(r);
            seen.push(...r.transcript);
        }
        return r;
    };
    /** Use an inventory item on an NPC near `at` and answer the dialogue it opens. */
    const useOnNpc = async (item: ItemPattern, npc: RegExp, choices: OptionPattern[] = [], at?: [number, number]) => {
        const it = invItem(sdk, item);
        const n = findNpc(sdk, npc, near(at));
        if (!it || !n) { console.log(`[use] missing item ${String(item)}=${!!it} or npc ${npc}=${!!n}`); return null; }
        const conv = converse(sdk, choices, { ...DLG, openTicks: 30 });
        await sdk.sendUseItemOnNpc(it.slot, n.index);
        rec.interact();
        return record(await conv);
    };
    const useOnItem = async (a: ItemPattern, b: ItemPattern, choices: OptionPattern[] = []) => {
        const ia = invItem(sdk, a), ib = invItem(sdk, b);
        if (!ia || !ib) { console.log(`[use] missing ${String(a)}=${!!ia} ${String(b)}=${!!ib}`); return null; }
        const conv = converse(sdk, choices, { ...DLG, openTicks: 4 });
        await sdk.sendUseItemOnItem(ia.slot, ib.slot);
        rec.interact();
        return record(await conv);
    };
    /** Op the loc nearest (x, z) whose name matches, then answer whatever dialogue it opens. */
    const loc = async (x: number, z: number, name: RegExp, op = 1, choices: OptionPattern[] = []) => {
        const l = await findLoc(sdk, { name, near: { x, z }, radius: 20 });
        if (!l) { console.log(`[loc] none matching ${name} near ${x},${z}`); return null; }
        const conv = converse(sdk, choices, { ...DLG, openTicks: 25 });
        await opLoc(sdk, l, op);
        rec.interact();
        return record(await conv);
    };

    if (run('gorad')) {
        rec.begin('gorad: kill Gorad for the ogre tooth');
        const TOOTH = obj('ogretooth');
        // gorad.rs2 [queue,defeat_gorad] puts the tooth straight into the inventory, then an objbox
        const f = await fight(sdk, /^Gorad$/, { food: /shark/i, eatBelow: 30, onDialog: 'continue', maxTicks: 300, done: s => !!invItem(s, TOOTH) });
        rec.interact(f.attacks + f.eats);
        rec.mark();
        record(await converse(sdk, [], { ...DLG, openTicks: 2 }));
        rec.end(invItem(sdk, TOOTH) ? 'tooth' : `NO TOOTH (fight ${f.end})`);
        await logVars();
    }

    if (run('gate')) {
        rec.begin('gate: first talk to the east gate guard (pushed to the hill)');
        await walk(2550, 3031, 1);
        await talk(/ogre guard/i, [], [2549, 3029]);
        await waitPos(p => p.z > 3050, 10);
        rec.end(`at ${JSON.stringify(pos(sdk))}`);
        rec.begin('gate: back down, gold bar to the guard');
        await walk(2550, 3031, 1);
        await useOnNpc(obj('gold_bar'), /ogre guard/i, [], [2549, 3029]);
        await waitPos(p => p.z <= 3027, 10);
        rec.end(`at ${JSON.stringify(pos(sdk))}`);
        await logVars();
    }

    if (run('map')) {
        if (FROM === 'map') await setvar(sdk, 'gutanoth_gold', 2);
        rec.begin('map: death rune to a city guard');
        const cg = findNpc(sdk, /city guard/i, { x: 2541, z: 3031 });
        if (cg) await walk(cg.x, cg.z, 1);
        await useOnNpc(obj('deathrune'), /city guard/i);
        rec.end(invItem(sdk, obj('skavidmap')) ? 'map' : 'NO MAP');
        await logVars();
    }

    // Skavid caves: each entrance teleports into its own pocket of the
    // underground map (quest_itwatchtower.rs2 skavid_caveN/caveNexit).
    const cave = async (label: string, entrance: [number, number], npcAt: [number, number], npcRe: RegExp, choices: OptionPattern[], exit: [number, number], extra?: () => Promise<void>, chooser?: (transcript: string) => RegExp | null) => {
        rec.begin(`caves: ${label}`);
        await walk(entrance[0], entrance[1], 1);
        await loc(entrance[0], entrance[1], /./);
        if (!(await waitPos(under, 10))) console.log(`[cave] ${label}: did not enter, at ${JSON.stringify(pos(sdk))}`);
        await walk(npcAt[0], npcAt[1], 1);
        if (chooser) await talkChoosing(npcRe, npcAt, chooser);
        else await talk(npcRe, choices, npcAt);
        if (extra) await extra();
        await walk(exit[0], exit[1], 1);
        await loc(exit[0], exit[1], /./);
        await waitPos(p => !under(p), 10);
        rec.end();
        await logVars();
    };
    const pickNightshade = async () => {
        const before = invCount(sdk, /nightshade/i);
        const r = await pickup(sdk, /nightshade/i).catch(() => null);
        if (!r) { console.log('[nightshade] none in view'); return; }
        rec.interact();
        if (r.ok) rec.mark();
        console.log(`[nightshade] ${before} -> ${invCount(sdk, /nightshade/i)}`);
    };

    if (run('scared')) {
        if (FROM === 'scared') { await setvar(sdk, 'itwatchtower', 6); await give(sdk, 'skavidmap', 1); }
        await cave('cave5, scared skavid', [2553, 3033], [2499, 9433], /skavid/i, [/not going to hurt/i], [2504, 9442]);
    }
    if (run('talkers')) {
        if (FROM === 'talkers') await setvar(sdk, 'itwatchtower_bits', 4096);
        await cave('cave1, skavid (Nod)', [2560, 3022], [2503, 9415], /skavid/i, [/^Nod/], [2497, 9418]);
        await cave('cave4, skavid (Cur)', [2552, 3052], [2500, 9451], /skavid/i, [/^Cur/], [2497, 9451]);
        await cave('cave3, skavid (Ar)', [2539, 3052], [2515, 9452], /skavid/i, [/^Ar/], [2518, 9456]);
        await cave('cave2, skavid (Ig) + nightshade', [2522, 3068], [2530, 9465], /skavid/i, [/^Ig/], [2532, 9470], pickNightshade);
    }
    if (run('grew')) {
        rec.begin('grew: talk, then hand over the tooth');
        await walk(2513, 3082, 1);
        await talk(/^Grew$/i, [/don't eat me/i]);
        await talk(/^Grew$/i, []);
        rec.end(`crystals=${invCount(sdk, /^Crystal$/)}`);
        await logVars();
    }
    if (run('mad')) {
        if (FROM === 'mad') { await setvar(sdk, 'itwatchtower_bits', 126976); await give(sdk, 'skavidmap', 1); }
        await cave('cave6, mad skavid + nightshade', [2527, 3011], [2523, 9411], /mad skavid/i, [], [2521, 9411], pickNightshade, madChooser);
    }
    if (run('enclave1')) {
        if (FROM === 'enclave1') { await setvar(sdk, 'itwatchtower', 7); await give(sdk, 'nightshade', 2); }
        rec.begin('enclave1: nightshade on the enclave guard, then out through the cave');
        await walk(2506, 3038, 1);
        await useOnNpc(obj('nightshade'), /enclave guard/i, [], [2507, 3036]);
        await waitPos(under, 12);
        console.log('[enclave] inside at', JSON.stringify(pos(sdk)));
        await walk(2598, 9467, 1);
        await loc(2598, 9468, /./);
        await waitPos(p => !under(p), 10);
        rec.end();
        await logVars();
    }
    const climbTower = async () => {
        await walk(2544, 3110, 1);
        await loc(2544, 3111, /ladder/i);
        await waitPos(p => p.level === 1, 10);
        await walk(2549, 3112, 1);
        await loc(2549, 3111, /ladder/i);
        await waitPos(p => p.level === 2, 10);
    };
    if (run('wizard1')) {
        if (FROM === 'wizard1') await setvar(sdk, 'itwatchtower', 8);
        rec.begin('wizard1: walk to the Watchtower and climb');
        await climbTower();
        rec.end(`at ${JSON.stringify(pos(sdk))}`);
        rec.begin('wizard1: talk (stage 9), mix the potion, wizard enchants it (stage 10)');
        await talk(/wizard/i, []);
        await useOnItem(obj('jangerberries'), obj('guamvial'));
        await useOnItem(obj('ground_bat_bones'), obj('guamjangervial'));
        await useOnNpc(obj('ogre_potion'), /wizard/i, []);
        rec.end(invItem(sdk, obj('magic_ogre_potion')) ? 'magic potion' : 'NO MAGIC POTION');
        await logVars();
    }
    if (run('enclave2')) {
        if (FROM === 'enclave2') { await setvar(sdk, 'itwatchtower', 10); await give(sdk, ['magic_ogre_potion', 'nightshade'], 1); }
        rec.begin('enclave2: down the tower, walk to the enclave, nightshade on the guard');
        await walk(2549, 3112, 1);
        await loc(2549, 3111, /ladder/i);
        await waitPos(p => p.level === 1, 10);
        await walk(2544, 3112, 1);
        await loc(2544, 3111, /ladder/i, 1);
        await waitPos(p => p.level === 0, 10);
        await walk(2506, 3038, 1);
        await useOnNpc(obj('nightshade'), /enclave guard/i, [], [2507, 3036]);
        await waitPos(under, 12);
        rec.end(`at ${JSON.stringify(pos(sdk))}`);
        rec.begin('enclave2: six shamans with the magic potion');
        const shamans: [number, number][] = [[2577, 9451], [2582, 9437], [2592, 9436], [2606, 9438], [2607, 9451], [2599, 9461]];
        for (const [x, z] of shamans) {
            await walk(x, z, 2);
            await useOnNpc(obj('magic_ogre_potion'), /shaman/i, [], [x, z]);
            await sdk.waitForTicks(1);
        }
        rec.end(`crystals=${invCount(sdk, /^Crystal$/)}`);
        await logVars();
        rec.begin('enclave2: mine the rock of Dalgroth, leave');
        await walk(2590, 9450, 1);
        const CRYSTAL4 = obj('powering_crystal4');
        const mined = waitUntil(sdk, s => !!invItem(s, CRYSTAL4), { maxTicks: 40 });
        await loc(2590, 9449, /./, 2);
        const m = await mined;
        if (m.ok) rec.mark(m.tick);
        await walk(2598, 9467, 1);
        await loc(2598, 9468, /./);
        await waitPos(p => !under(p), 10);
        rec.end(`crystals=${invCount(sdk, /^Crystal$/)}`);
    }
    if (run('finish')) {
        if (FROM === 'finish') {
            await setvar(sdk, 'itwatchtower', 10);
            await setvar(sdk, 'itwatchtower_bits', 786432);
            await give(sdk, ['powering_crystal1', 'powering_crystal2', 'powering_crystal3', 'powering_crystal4'], 1);
        }
        rec.begin('finish: walk to the Watchtower and climb');
        await climbTower();
        rec.end();
        rec.begin('finish: wizard takes the crystals (stage 11), pull the lever');
        await talk(/wizard/i, []);
        await logVars();
        const magic0 = skillXp(sdk, 'magic');
        const xp = waitUntil(sdk, s => skillXp(s, 'magic') !== magic0, { maxTicks: 40 });
        await loc(2543, 3115, /lever/i);
        const x = await xp;
        if (x.ok) rec.mark(x.tick);
        record(await converse(sdk, [], { ...DLG, openTicks: 6 }));
        rec.end(`magic base xp gained ${(skillXp(sdk, 'magic') - magic0) / 25}`);
        rec.begin('finish: read the spell scroll');
        const SCROLL = obj('watchtowerspell');
        if (invItem(sdk, SCROLL)) {
            const conv = converse(sdk, [], { ...DLG, openTicks: 4 });
            await invOp(sdk, SCROLL, /^read$/i);
            rec.interact();
            record(await conv);
        }
        rec.end();
        await logVars();
    }
    rec.report();
}, { timeout: 900_000 });
