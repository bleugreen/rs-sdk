// Biohazard: every segment, measured on a local server with the stock lite
// client. Each segment jumps the account to its stage with ::setvar biohazard
// (and %bioerrand for the Varrock errand boys) and ::tele, gives the items a
// helper would trade, then plays the real route including the short walks.
//
//   bun docs/speedrun/scripts/quest-biohazard-segments.ts <bot> [segment...] [--att=70 --str=70 --def=70 --hp=70]
//
// Segments, in quest order:
//   east      Elena (0->1), Jerico (1->2), his cupboard (bird feed), a pigeon cage,
//             bird feed on the watch tower (2->3), release the pigeons (3->4),
//             Omart and the rope ladder (4->5)
//   west      rotten apple, the stew cauldron (5->6), the nurse's cupboard (doctors'
//             gown), the mourner HQ, the upstairs mourner fight (key), the gate,
//             the crate (6->7), Ardougne teleport, Elena (7->10)
//   rimmington the chemist (10->12), the three errand boys
//   karamja   the Brimhaven dock to Musa Point walk (with the plague sample)
//   varrock   the gate search, the three errand boys, Guidor's door, Guidor (12->14)
//   finale    Ardougne teleport, Elena (14->15), King Lathas (15->16)
// With no segment names every segment except karamja runs. Run
// quest-primitives-setup.ts first (Magic 99 and runes for the teleport).

import { runScript } from '../../../sdk/runner';
import * as L from './quest-arthur-lab';
import { Steps, atLevel, dropAll, ensure, has, near, opLoc, talk, useOnLoc, varp } from './quest-plague-city-lab';

const all = ['east', 'west', 'rimmington', 'varrock', 'finale'];
const args = process.argv.slice(3);
const picked = args.filter(a => !a.startsWith('-'));
const segments = picked.length ? picked : all;
const flag = (k: string, d: number) => Number(args.find(a => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
const STATS = { attack: flag('att', 70), strength: flag('str', 70), defence: flag('def', 70), hitpoints: flag('hp', 70) };

const ARDOUGNE_TELEPORT = 1540; // component id, server/content/pack/interface.pack
// %bioerrand bits (quest_biohazard.constant): each boy holds the right vial.
const ERRAND_ALL_CORRECT = (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4) | (1 << 5) | (1 << 6);

await runScript(async ({ bot, sdk }) => {
    await bot.dismissBlockingUI();
    const S = new Steps(sdk, bot);
    const out: Record<string, unknown> = {};
    const stage = (v: number) => L.cheat(sdk, `setvar biohazard ${v}`);
    const quest = async (label: string) => {
        out[label] = await varp(sdk, 'biohazard');
        console.log(`  biohazard after ${label}: ${out[label]}`);
    };
    const locAt = async (x: number, z: number, re?: RegExp) => {
        const l = (await sdk.scanNearbyLocs(20)).find(l => l.x === x && l.z === z && (!re || re.test(l.name)));
        if (!l) throw new Error(`no loc at ${x},${z} ${re ?? ''}`);
        return l;
    };
    const opAt = (x: number, z: number, opRe: RegExp, re?: RegExp) => async () => {
        const l = await locAt(x, z, re);
        const op = l.optionsWithIndex.find(o => opRe.test(o.text));
        if (!op) throw new Error(`loc ${l.name} at ${x},${z} has no ${opRe}: ${l.options}`);
        return sdk.sendInteractLoc(x, z, l.id, op.opIndex);
    };
    const teleport = () => S.step('Ardougne teleport', () => sdk.sendClickComponent(ARDOUGNE_TELEPORT), { done: near(sdk, 2661, 3301, 3), settle: 0 });

    // Free inventory space: Elena only hands over each vial while more than one slot is free.
    await dropAll(sdk, /^(Bronze .*|Tinderbox|Small fishing net|Shrimps|Pot|Bread|Wooden shield|Shortbow|Mind rune|Body rune|Picture|Book|Warrant|A small key|A scruffy note|Hangover cure|Spade|Rope|Bucket.*|Chocolaty milk|Chocolate dust|Snape grass|Dwellberries)$/i);
    await L.cheat(sdk, 'setvar elenaquest 30');
    await L.cheat(sdk, 'setvar regicide_quest 0');
    await ensure(sdk, 'coins', /^Coins$/i, 100);

    for (const seg of segments) {
        console.log(`\n-- ${seg}`);
        if (seg === 'east') {
            await stage(0);
            await dropAll(sdk, /^(Bird feed|Pigeon cage|Distillator)$/i);
            await L.tele(sdk, 2592, 3340);
            await S.step('Elena door (in)', opAt(2592, 3339, /Open/), { done: () => L.pos(sdk).z <= 3338, settle: 0 });
            await S.step('Elena: start (0->1)', talk(sdk, /^Elena$/), { choices: [/I'll try to retrieve it for you/] });
            await quest('elena');
            await S.step('Elena door (out)', opAt(2592, 3339, /Open/), { done: () => L.pos(sdk).z >= 3339, settle: 0 });
            await S.walk('Elena -> Jerico', 2612, 3325);
            await S.step('Jerico (1->2)', talk(sdk, /^Jerico$/));
            await quest('jerico');
            await S.step('open Jerico cupboard', opAt(2611, 3326, /Open/), { done: () => sdk.getState()!.nearbyLocs.some(l => l.x === 2611 && l.z === 3326 && /Search/.test(l.options.join())), settle: 0 });
            await S.step('search the cupboard: bird feed', opAt(2611, 3326, /Search/), { done: has(sdk, /^Bird feed$/i) });
            const cage = (await sdk.scanGroundItems(15)).filter(g => /^Pigeon cage$/i.test(g.name)).sort((a, b) => a.distance - b.distance)[0];
            if (!cage) throw new Error('no pigeon cage on the ground');
            out.cageAt = { x: cage.x, z: cage.z, reachable: cage.reachable };
            await S.step(`pick up a pigeon cage (${cage.x},${cage.z}), walking from the cupboard`, () => bot.pickupItem(cage), { done: has(sdk, /^Pigeon cage$/i), settle: 0, maxTicks: 120 });
            await S.walk('pigeons -> watch tower', 2564, 3303);
            const tower = (await sdk.scanNearbyLocs(6)).filter(l => /watch ?tower/i.test(l.name)).sort((a, b) => a.distance - b.distance)[0];
            if (!tower) throw new Error('no watch tower loc');
            await S.step('bird feed on the watch tower (2->3)', useOnLoc(sdk, /^Bird feed$/i, tower.x, tower.z, tower.id), { done: () => !sdk.getInventory().some(i => /^Bird feed$/i.test(i.name)), settle: 3 });
            await sdk.waitForTicks(2);
            await quest('birdfeed');
            await S.step('open the pigeon cage (3->4)', async () => { await sdk.sendUseItem(sdk.findInventoryItem(/^Pigeon cage$/i)!.slot, 1); }, { done: has(sdk, /^Pigeon cage$/i), settle: 6 });
            await quest('pigeons');
            await S.walk('watch tower -> Omart', 2559, 3268);
            await S.step('Omart: rope ladder over the wall (4->5)', talk(sdk, /^Omart$/), { choices: [/Ok, lets do it/], settle: 7, done: () => L.pos(sdk).x <= 2557 });
            out.overWall = L.pos(sdk);
            await quest('ladder');
        } else if (seg === 'west') {
            await stage(5);
            await dropAll(sdk, /^(Rotten apples|Doctors' gown|Key|Distillator)$/i);
            for (const e of sdk.getEquipment()) if (/Doctors' gown/i.test(e.name)) await bot.unequipItem(e);
            await dropAll(sdk, /^Doctors' gown$/i);
            await L.setStats(sdk, STATS);
            for (const g of ['rune_scimitar', 'rune_full_helm', 'rune_platelegs', 'rune_kiteshield', 'amulet_of_strength']) {
                const named = (i: { name: string }) => i.name.toLowerCase().replace(/ /g, '_') === g;
                if (sdk.getEquipment().some(named)) continue;
                await L.cheat(sdk, `give ${g} 1`, 2);
                const it = sdk.getInventory().find(named);
                if (it) await bot.equipItem(it);
            }
            await sdk.sendSetCombatStyle(1);
            if (Math.abs(L.pos(sdk).x - 2556) > 2 || Math.abs(L.pos(sdk).z - 3267) > 2) await L.tele(sdk, 2556, 3267);
            const apple = (await sdk.scanGroundItems(90)).find(g => /^Rotten apples?$/i.test(g.name));
            out.appleAt = apple && { x: apple.x, z: apple.z, distance: apple.distance };
            await S.walk('ladder landing -> rotten apple', 2535, 3333);
            const apple2 = (await sdk.scanGroundItems(5)).find(g => /^Rotten apples?$/i.test(g.name));
            if (!apple2) throw new Error('no rotten apple');
            await S.step('pick up the rotten apple', () => sdk.sendPickup(apple2.x, apple2.z, apple2.id), { done: has(sdk, /^Rotten apples?$/i), settle: 0 });
            // The cauldron is inside the mourner HQ yard; the way in is the fence at (2541,3331)
            // ("Climb-over", general_use/scripts/fence.rs2, no requirement).
            await S.step('climb the yard fence (in), walking from the apple', opAt(2541, 3331, /Climb-over/), { done: () => L.pos(sdk).x >= 2542, settle: 0, maxTicks: 60 });
            out.fenceInside = L.pos(sdk);
            await S.step('rotten apple on the cauldron (5->6)', useOnLoc(sdk, /^Rotten apples?$/i, 2543, 3332, 2043), { settle: 4, done: () => !sdk.getInventory().some(i => /^Rotten apples?$/i.test(i.name)), maxTicks: 60 });
            await sdk.waitForTicks(4);
            await quest('stew');
            await S.step('climb the yard fence (out)', opAt(2541, 3331, /Climb-over/), { done: () => L.pos(sdk).x <= 2541, settle: 0, maxTicks: 60 });
            // forceapproach=east on a cupboard placed at angle 1 means it opens from the south side.
            await S.walk('fence -> nurse cupboard (south side)', 2518, 3275);
            await S.step('open the nurse cupboard', opAt(2517, 3276, /Open/), { done: () => sdk.getState()!.nearbyLocs.some(l => l.x === 2517 && l.z === 3276 && /Search/.test(l.options.join())), settle: 0 });
            await S.step("search: doctors' gown", opAt(2517, 3276, /Search/), { done: has(sdk, /^Doctors' gown$/i), settle: 0 });
            await S.step("wear the doctors' gown", async () => { await bot.equipItem(/^Doctors' gown$/i); }, { done: () => sdk.getEquipment().some(e => /Doctors' gown/i.test(e.name)), settle: 0 });
            // Front door from the street; (2551,3328) joins the yard to the HQ instead.
            await S.walk('nurse -> HQ front door', 2551, 3320);
            await S.step('HQ front door ("In you go doc")', opAt(2551, 3320, /Open/), { done: () => L.pos(sdk).z >= 3321 });
            await S.walk('HQ -> spiral stairs', 2543, 3325);
            await S.step('spiral stairs up', opAt(2542, 3324, /Climb-up/), { done: atLevel(sdk, 1), settle: 0 });
            await S.walk('stairs -> upstairs door', 2546, 3325);
            await S.step('upstairs door', opAt(2547, 3325, /Open/), { done: () => L.pos(sdk).x >= 2547, settle: 0 });
            // Fight one of the two sick mourners for the key (death queue, mourner.rs2).
            const t0 = L.tick(sdk);
            const target = sdk.getNearbyNpcs().filter(n => /^Mourner$/.test(n.name)).sort((a, b) => a.distance - b.distance)[0];
            if (!target) throw new Error('no mourner upstairs');
            out.mourner = { combatLevel: target.combatLevel, at: [target.x, target.z] };
            await bot.attack(target);
            let levelUps = 0;
            while (L.tick(sdk) - t0 < 200 && !has(sdk, /^Key$/i)()) {
                if (L.isLevelUpDialog(sdk)) {
                    levelUps += await L.dismissLevelUps(sdk);
                    const again = sdk.getNearbyNpcs().find(n => n.index === target.index);
                    if (again) await bot.attack(again);
                }
                await sdk.waitForStateUpdate();
            }
            const fight = { ticks: L.tick(sdk) - t0, key: has(sdk, /^Key$/i)(), levelUps };
            out.fight = fight;
            S.rows.push({ label: 'fight a sick mourner: attack click to key', ticks: fight.ticks, pages: 0, options: 0, levelUps, transcript: [] });
            console.log(`STEP fight: ${JSON.stringify(fight)}`);
            const gate = (await sdk.scanNearbyLocs(8)).filter(l => /Gate/.test(l.name) && l.options.includes('Open')).sort((a, b) => a.distance - b.distance)[0];
            if (!gate) throw new Error('no gate upstairs');
            await S.step('open the gate (key in inventory)', () => sdk.sendInteractLoc(gate.x, gate.z, gate.id, 1), { done: () => L.pos(sdk).x >= 2552, settle: 0, maxTicks: 30 });
            await S.step('search the crate: distillator (6->7)', opAt(2554, 3327, /Search/), { done: has(sdk, /^Distillator$/i), settle: 0 });
            await quest('crate');
            await teleport();
            await S.longWalk(bot, 'teleport -> Elena door', 2592, 3340);
            await S.step('Elena door (in)', opAt(2592, 3339, /Open/), { done: () => L.pos(sdk).z <= 3338, settle: 0 });
            await S.step('Elena: distillator -> vials and sample (7->10)', talk(sdk, /^Elena$/), { settle: 5, done: has(sdk, /^Plague sample$/i) });
            await quest('elenaDistillator');
        } else if (seg === 'rimmington') {
            await stage(10);
            await L.cheat(sdk, 'setvar bioerrand 0');
            await dropAll(sdk, /^(Touch paper)$/i);
            for (const [o, re] of [['ethenea', /^Ethanea$/i], ['liquid_honey', /^Liquid honey$/i], ['sulphuric_broline', /^Sulphuric broline$/i], ['plaguesample', /^Plague sample$/i]] as const) await ensure(sdk, o, re);
            await L.tele(sdk, 2934, 3212);
            await S.step('chemist (10->12)', talk(sdk, /^Chemist$/), { choices: [/I'm Elena's friend/, /touch paper for a guy called Guidor/] });
            await quest('chemist');
            await S.walk('chemist -> errand boys', 2933, 3218);
            await S.step('Hops: sulphuric broline', talk(sdk, /^Hops$/), { choices: [/sulphuric broline/] });
            await S.step('Chancy: liquid honey', talk(sdk, /^Chancy$/), { choices: [/liquid honey/] });
            await S.step('DeVinci: ethenea', talk(sdk, /^DeVinci$/), { choices: [/ethenea/] });
            out.bioerrand = await varp(sdk, 'bioerrand');
        } else if (seg === 'karamja') {
            await ensure(sdk, 'plaguesample', /^Plague sample$/i);
            await L.tele(sdk, 2772, 3230);
            await S.longWalk(bot, 'Brimhaven dock -> Musa Point customs officer', 2954, 3148);
            out.sampleKept = has(sdk, /^Plague sample$/i)();
        } else if (seg === 'varrock') {
            await stage(12);
            await L.cheat(sdk, `setvar bioerrand ${ERRAND_ALL_CORRECT}`);
            await dropAll(sdk, /^(Ethanea|Liquid honey|Sulphuric broline)$/i);
            await ensure(sdk, 'plaguesample', /^Plague sample$/i);
            await ensure(sdk, 'touch_paper', /^Touch paper$/i);
            // Both halves are named "Priest gown" (quest_biohazard.obj); Guidor's door checks both worn.
            if (sdk.getEquipment().filter(e => /^Priest gown$/i.test(e.name)).length < 2) {
                for (const g of ['priest_gown', 'priest_robe']) await L.cheat(sdk, `give ${g} 1`, 2);
                for (const it of sdk.getInventory().filter(i => /^Priest gown$/i.test(i.name))) {
                    await sdk.sendUseItem(it.slot, 2);
                    await sdk.waitForTicks(2);
                }
            }
            await L.tele(sdk, 3262, 3405);
            await S.step('Varrock gate: the search', opAt(3264, 3405, /Open/), { done: () => L.pos(sdk).x >= 3265, settle: 4 });
            await S.walk('gate -> Hops', 3268, 3390);
            await S.step('Hops: sulphuric broline back', talk(sdk, /^Hops$/), { settle: 4, done: has(sdk, /^Sulphuric broline$/i) });
            await S.step('Chancy: liquid honey back', talk(sdk, /^Chancy$/), { settle: 4, done: has(sdk, /^Liquid honey$/i) });
            await S.step('DeVinci: ethenea back', talk(sdk, /^DeVinci$/), { done: has(sdk, /^Ethanea$/i) });
            await S.walk('errand boys -> Guidor door', 3282, 3382);
            await S.step("Guidor's door (priest gown)", opAt(3282, 3382, /Open/), { done: () => L.pos(sdk).x >= 3283, settle: 0 });
            await S.step('Guidor (12->14)', talk(sdk, /^Guidor$/), { choices: [/I've come to ask your assistance/, /sent by your old pupil Elena/, /So what does that mean exactly/] });
            await quest('guidor');
        } else if (seg === 'finale') {
            await stage(14);
            await L.tele(sdk, 3285, 3383);
            await teleport();
            await S.longWalk(bot, 'teleport -> Elena door', 2592, 3340);
            await S.step('Elena door (in)', opAt(2592, 3339, /Open/), { done: () => L.pos(sdk).z <= 3338, settle: 0 });
            await S.step('Elena: report (14->15)', talk(sdk, /^Elena$/));
            await quest('elenaReport');
            await S.step('Elena door (out)', opAt(2592, 3339, /Open/), { done: () => L.pos(sdk).z >= 3339, settle: 0 });
            await S.longWalk(bot, 'Elena -> castle stairs', 2572, 3295);
            await S.step('castle stairs up', opAt(2571, 3295, /Climb-up/), { done: atLevel(sdk, 1), settle: 0 });
            await S.longWalk(bot, 'stairs -> King Lathas', 2577, 3293);
            await S.step('King Lathas: complete (15->16)', talk(sdk, /^King Lathas$/), { choices: [/I don't understand/], settle: 4 });
            await sdk.waitForTicks(2);
            if (sdk.getState()!.modalOpen) await S.step('close the quest-complete scroll', () => sdk.sendCloseModal(), { done: () => !sdk.getState()!.modalOpen, settle: 0 });
            await quest('lathas');
        }
    }
    S.print('Biohazard segments');
    L.report('varps, positions, fight', out);
}, { timeout: 1_800_000, printState: false });
