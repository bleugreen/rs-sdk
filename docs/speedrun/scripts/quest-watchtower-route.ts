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
// skips earlier phases after forcing the varps they would have set.

import { runScript } from '../../../sdk/runner';
import {
    Recorder, cheat, tele, pos, walk, now, talk, useOnNpc, useOnItem, opLoc, waitPos, logVars, inv,
    setupAccount, hp, runDialog, npcNear, nextState,
} from './quest-wtikov-lib';

const VARS = ['itwatchtower', 'itwatchtower_bits', 'gutanoth_gold'];
const under = (p: { z: number }) => p.z > 6400;

await runScript(async ({ bot, sdk }) => {
    await setupAccount(sdk, bot, {
        attack: 70, strength: 70, defence: 70, hitpoints: 70, agility: 25, mining: 40, herblore: 14, magic: 14,
    }, [
        ['rune_scimitar', 1], ['deathrune', 1], ['gold_bar', 1], ['torch_lit', 1], ['guamvial', 1],
        ['jangerberries', 1], ['ground_bat_bones', 1], ['rune_pickaxe', 1], ['shark', 8],
    ]);
    await bot.equipItem(/rune scimitar/i);
    await cheat(sdk, 'setstat hitpoints 70');

    const rec = new Recorder(sdk);
    const FROM = process.env.FROM ?? 'gorad';
    const phases = ['gorad', 'gate', 'map', 'scared', 'talkers', 'grew', 'mad', 'enclave1', 'wizard1', 'enclave2', 'finish'];
    const run = (p: string) => phases.indexOf(p) >= phases.indexOf(FROM);
    const start: Record<string, [number, number, number]> = {
        gorad: [2577, 3026, 0], gate: [2550, 3033, 0], map: [2549, 3027, 0], scared: [2549, 3027, 0],
        talkers: [2552, 3034, 0], grew: [2524, 3070, 0], mad: [2513, 3082, 0], enclave1: [2529, 3013, 0],
        wizard1: [2540, 3054, 0], enclave2: [2544, 3112, 2], finish: [2540, 3054, 0],
    };
    await tele(sdk, ...start[FROM]);
    await logVars(sdk, VARS);

    if (run('gorad')) {
        rec.start('gorad: kill Gorad for the ogre tooth');
        const t0 = now(sdk);
        const g = npcNear(sdk, /^Gorad$/);
        if (g) await bot.attack(g);
        rec.interact();
        while (!inv(sdk, 'ogretooth') && now(sdk) - t0 < 300) {
            if (hp(sdk) < 30) { await bot.eatFood(/shark/i); rec.interact(); }
            const s = await nextState(sdk);
            if (s.dialog.isOpen) await runDialog(sdk, rec, [], { openTicks: 1 });
        }
        await runDialog(sdk, rec, [], { openTicks: 2 });
        rec.end(inv(sdk, 'ogretooth') ? 'tooth' : 'NO TOOTH');
        await logVars(sdk, VARS);
    }

    if (run('gate')) {
        rec.start('gate: first talk to the east gate guard (pushed to the hill)');
        await walk(bot, sdk, 2550, 3031, 1);
        await talk(sdk, rec, /ogre guard/i, [], 2549, 3029);
        await waitPos(sdk, p => p.z > 3050, 10);
        rec.end(`at ${JSON.stringify(pos(sdk))}`);
        rec.start('gate: back down, gold bar to the guard');
        await walk(bot, sdk, 2550, 3031, 1);
        await useOnNpc(sdk, rec, 'gold_bar', /ogre guard/i, [], 2549, 3029);
        await waitPos(sdk, p => p.z <= 3027, 10);
        rec.end(`at ${JSON.stringify(pos(sdk))}`);
        await logVars(sdk, VARS);
    }

    if (run('map')) {
        if (FROM === 'map') await cheat(sdk, 'setvar gutanoth_gold 2');
        rec.start('map: death rune to a city guard');
        const cg = npcNear(sdk, /city guard/i, 2541, 3031);
        if (cg) await walk(bot, sdk, cg.x, cg.z, 1);
        await useOnNpc(sdk, rec, 'deathrune', /city guard/i);
        rec.end(inv(sdk, 'skavidmap') ? 'map' : 'NO MAP');
        await logVars(sdk, VARS);
    }

    // Skavid caves: each entrance teleports into its own pocket of the
    // underground map (quest_itwatchtower.rs2 skavid_caveN/caveNexit).
    const cave = async (label: string, entrance: [number, number], npcAt: [number, number], npcRe: RegExp, choices: (string | RegExp)[], exit: [number, number], extra?: () => Promise<void>, chooser?: (t: string[], o: string[]) => RegExp | null) => {
        rec.start(`caves: ${label}`);
        await walk(bot, sdk, entrance[0], entrance[1], 1);
        await opLoc(sdk, rec, entrance[0], entrance[1], /./);
        if (!(await waitPos(sdk, under, 10))) console.log(`[cave] ${label}: did not enter, at ${JSON.stringify(pos(sdk))}`);
        await walk(bot, sdk, npcAt[0], npcAt[1], 1);
        await talk(sdk, rec, npcRe, choices, npcAt[0], npcAt[1], chooser);
        if (extra) await extra();
        await walk(bot, sdk, exit[0], exit[1], 1);
        await opLoc(sdk, rec, exit[0], exit[1], /./);
        await waitPos(sdk, p => !under(p), 10);
        rec.end();
        await logVars(sdk, VARS);
    };
    const pickNightshade = async () => {
        const n = await sdk.scanFindGroundItem(/nightshade/i, 15);
        if (!n) { console.log('[nightshade] none in view'); return; }
        const before = sdk.countInventoryItems(/nightshade/i);
        await bot.pickupItem(n);
        rec.interact();
        console.log(`[nightshade] ${before} -> ${sdk.countInventoryItems(/nightshade/i)}`);
    };

    if (run('scared')) {
        if (FROM === 'scared') { await cheat(sdk, 'setvar itwatchtower 6'); await cheat(sdk, 'give skavidmap 1'); }
        await cave('cave5, scared skavid', [2553, 3033], [2499, 9433], /skavid/i, [/not going to hurt/i], [2504, 9442]);
    }
    if (run('talkers')) {
        if (FROM === 'talkers') await cheat(sdk, 'setvar itwatchtower_bits 4096');
        await cave('cave1, skavid (Nod)', [2560, 3022], [2503, 9415], /skavid/i, [/^Nod/], [2497, 9418]);
        await cave('cave4, skavid (Cur)', [2552, 3052], [2500, 9451], /skavid/i, [/^Cur/], [2497, 9451]);
        await cave('cave3, skavid (Ar)', [2539, 3052], [2515, 9452], /skavid/i, [/^Ar/], [2518, 9456]);
        await cave('cave2, skavid (Ig) + nightshade', [2522, 3068], [2530, 9465], /skavid/i, [/^Ig/], [2532, 9470], pickNightshade);
    }
    if (run('grew')) {
        rec.start('grew: talk, then hand over the tooth');
        await walk(bot, sdk, 2513, 3082, 1);
        await talk(sdk, rec, /^Grew$/i, [/don't eat me/i]);
        await talk(sdk, rec, /^Grew$/i, []);
        rec.end(`crystals=${sdk.countInventoryItems(/^Crystal$/)}`);
        await logVars(sdk, VARS);
    }
    if (run('mad')) {
        if (FROM === 'mad') { await cheat(sdk, 'setvar itwatchtower_bits 126976'); await cheat(sdk, 'give skavidmap 1'); }
        const madChooser = (texts: string[]) => {
            const t = texts.join(' ');
            if (/Ar cur/i.test(t)) return /^Gor/;
            if (/Bidith ig/i.test(t)) return /^Cur/;
            if (/Cur tanath/i.test(t)) return /^Bidith/;
            if (/Gor nod/i.test(t)) return /^Tanath/;
            return null;
        };
        await cave('cave6, mad skavid + nightshade', [2527, 3011], [2523, 9411], /mad skavid/i, [], [2521, 9411], pickNightshade, madChooser);
    }
    if (run('enclave1')) {
        if (FROM === 'enclave1') { await cheat(sdk, 'setvar itwatchtower 7'); await cheat(sdk, 'give nightshade 2'); }
        rec.start('enclave1: nightshade on the enclave guard, then out through the cave');
        await walk(bot, sdk, 2506, 3038, 1);
        await useOnNpc(sdk, rec, 'nightshade', /enclave guard/i, [], 2507, 3036);
        await waitPos(sdk, under, 12);
        console.log('[enclave] inside at', JSON.stringify(pos(sdk)));
        await walk(bot, sdk, 2598, 9467, 1);
        await opLoc(sdk, rec, 2598, 9468, /./);
        await waitPos(sdk, p => !under(p), 10);
        rec.end();
        await logVars(sdk, VARS);
    }
    const climbTower = async () => {
        await walk(bot, sdk, 2544, 3110, 1);
        await opLoc(sdk, rec, 2544, 3111, /ladder/i);
        await waitPos(sdk, p => p.level === 1, 10);
        await walk(bot, sdk, 2549, 3112, 1);
        await opLoc(sdk, rec, 2549, 3111, /ladder/i);
        await waitPos(sdk, p => p.level === 2, 10);
    };
    if (run('wizard1')) {
        if (FROM === 'wizard1') await cheat(sdk, 'setvar itwatchtower 8');
        rec.start('wizard1: walk to the Watchtower and climb');
        await climbTower();
        rec.end(`at ${JSON.stringify(pos(sdk))}`);
        rec.start('wizard1: talk (stage 9), mix the potion, wizard enchants it (stage 10)');
        await talk(sdk, rec, /wizard/i, []);
        await useOnItem(sdk, rec, 'jangerberries', 'guamvial');
        await useOnItem(sdk, rec, 'ground_bat_bones', 'guamjangervial');
        await useOnNpc(sdk, rec, 'ogre_potion', /wizard/i, []);
        rec.end(inv(sdk, 'magic_ogre_potion') ? 'magic potion' : 'NO MAGIC POTION');
        await logVars(sdk, VARS);
    }
    if (run('enclave2')) {
        if (FROM === 'enclave2') { await cheat(sdk, 'setvar itwatchtower 10'); await cheat(sdk, 'give magic_ogre_potion 1'); await cheat(sdk, 'give nightshade 1'); }
        rec.start('enclave2: down the tower, walk to the enclave, nightshade on the guard');
        await walk(bot, sdk, 2549, 3112, 1);
        await opLoc(sdk, rec, 2549, 3111, /ladder/i);
        await waitPos(sdk, p => p.level === 1, 10);
        await walk(bot, sdk, 2544, 3112, 1);
        await opLoc(sdk, rec, 2544, 3111, /ladder/i, 1);
        await waitPos(sdk, p => p.level === 0, 10);
        await walk(bot, sdk, 2506, 3038, 1);
        await useOnNpc(sdk, rec, 'nightshade', /enclave guard/i, [], 2507, 3036);
        await waitPos(sdk, under, 12);
        rec.end(`at ${JSON.stringify(pos(sdk))}`);
        rec.start('enclave2: six shamans with the magic potion');
        const shamans: [number, number][] = [[2577, 9451], [2582, 9437], [2592, 9436], [2606, 9438], [2607, 9451], [2599, 9461]];
        for (const [x, z] of shamans) {
            await walk(bot, sdk, x, z, 2);
            await useOnNpc(sdk, rec, 'magic_ogre_potion', /shaman/i, [], x, z);
            await sdk.waitForTicks(1);
        }
        rec.end(`crystals=${sdk.countInventoryItems(/^Crystal$/)}`);
        await logVars(sdk, VARS);
        rec.start('enclave2: mine the rock of Dalgroth, leave');
        await walk(bot, sdk, 2590, 9450, 1);
        await opLoc(sdk, rec, 2590, 9449, /./, 2);
        for (let i = 0; i < 10 && !inv(sdk, 'powering_crystal4'); i++) await nextState(sdk);
        await walk(bot, sdk, 2598, 9467, 1);
        await opLoc(sdk, rec, 2598, 9468, /./);
        await waitPos(sdk, p => !under(p), 10);
        rec.end(`crystals=${sdk.countInventoryItems(/^Crystal$/)}`);
    }
    if (run('finish')) {
        if (FROM === 'finish') {
            await cheat(sdk, 'setvar itwatchtower 10'); await cheat(sdk, 'setvar itwatchtower_bits 786432');
            for (const c of [1, 2, 3, 4]) await cheat(sdk, `give powering_crystal${c} 1`);
        }
        rec.start('finish: walk to the Watchtower and climb');
        await climbTower();
        rec.end();
        rec.start('finish: wizard takes the crystals (stage 11), pull the lever');
        await talk(sdk, rec, /wizard/i, []);
        await logVars(sdk, VARS);
        const magic0 = sdk.getSkillXp('magic') ?? 0;
        await opLoc(sdk, rec, 2543, 3115, /lever/i);
        for (let i = 0; i < 12 && (sdk.getSkillXp('magic') ?? 0) === magic0; i++) await nextState(sdk);
        await runDialog(sdk, rec, [], { openTicks: 6 });
        rec.end(`magic base xp gained ${((sdk.getSkillXp('magic') ?? 0) - magic0) / 25}`);
        rec.start('finish: read the spell scroll');
        const scroll = inv(sdk, 'watchtowerspell');
        if (scroll) { await sdk.sendUseItem(scroll.slot, 1); rec.interact(); await runDialog(sdk, rec, [], { openTicks: 4 }); }
        rec.end();
        await logVars(sdk, VARS);
    }
    rec.summary('Watchtower route');
}, { timeout: 900_000 });
