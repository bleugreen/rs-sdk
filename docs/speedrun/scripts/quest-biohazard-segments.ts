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
// Steps use actConverse through the recording helpers in quest-plague-city-segments.ts:
// both a required effect and any dialogue must finish; delayed pages retain the idle grace window.

import { runScript } from '../../../sdk/runner';
import { castTeleport, invOp, pickup, slotOf, wield } from '../../../speedrun/lib/act';
import { fight } from '../../../speedrun/lib/combat';
import { currentTick, waitUntil, type Pred } from '../../../speedrun/lib/wait';
import { findLoc, findNpc, invCount, opIndex, pos, worn } from '../../../speedrun/lib/world';
import { Recorder, result } from '../../../speedrun/lab/record';
import { dropMatching, ensureItem, getvar, give, mustTele, setStats, setvar } from '../../../speedrun/lab/setup';
import { atLevel, has, longWalk, step, talk, timed, walk, type StepOpts } from './quest-plague-city-segments';

const all = ['east', 'west', 'hq', 'rimmington', 'varrock', 'finale'];
const args = process.argv.slice(3);
const picked = args.filter(a => !a.startsWith('-'));
const segments = picked.length ? picked : all;
const flag = (k: string, d: number) => Number(args.find(a => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
const STATS = { attack: flag('att', 70), strength: flag('str', 70), defence: flag('def', 70), hitpoints: flag('hp', 70) };

// %bioerrand bits (quest_biohazard.constant): each boy holds the right vial.
const ERRAND_ALL_CORRECT = (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4) | (1 << 5) | (1 << 6);

const GOWN = /^Doctors' gown$/i;
const PRIEST = /^Priest gown$/i;

await runScript(async ({ bot, sdk }) => {
    await bot.dismissBlockingUI();
    const rec = new Recorder(sdk, 'Biohazard segments');
    const out: Record<string, unknown> = {};
    const stage = (v: number) => setvar(sdk, 'biohazard', v);
    const quest = async (label: string) => {
        out[label] = await getvar(sdk, 'biohazard');
        console.log(`  biohazard after ${label}: ${out[label]}`);
    };
    const S = (label: string, click: () => Promise<unknown>, o?: StepOpts) => step(rec, sdk, label, click, o);
    const T = (label: string, npc: RegExp, o?: StepOpts) => talk(rec, sdk, label, npc, o);
    const W = (label: string, x: number, z: number) => walk(rec, sdk, bot, label, x, z);
    const LW = (label: string, x: number, z: number) => longWalk(rec, sdk, bot, label, x, z);
    // The loc is looked up before the step starts; a re-sent click repeats the same one.
    const opAt = async (x: number, z: number, op: RegExp, name?: RegExp) => {
        const l = await findLoc(sdk, { x, z, op, name });
        if (!l) throw new Error(`no loc at ${x},${z} with ${op} ${name ?? ''}`);
        const i = opIndex(l, op)!;
        return () => sdk.sendInteractLoc(l.x, l.z, l.id, i);
    };
    const useOnLoc = (item: RegExp, x: number, z: number, id: number) => {
        const slot = slotOf(sdk, item);
        return () => sdk.sendUseItemOnLoc(slot, x, z, id);
    };
    const locHas = (x: number, z: number, op: RegExp): Pred => s => s.nearbyLocs.some(l => l.x === x && l.z === z && l.options.some(o => op.test(o)));
    const teleport = () => timed(rec, sdk, 'Ardougne teleport', () => castTeleport(sdk, 'ardougne'));

    // Free inventory space: Elena only hands over each vial while more than one slot is free.
    await dropMatching(sdk, [/^(Bronze .*|Tinderbox|Small fishing net|Shrimps|Pot|Bread|Wooden shield|Shortbow|Mind rune|Body rune|Picture|Book|Warrant|A small key|A scruffy note|Hangover cure|Spade|Rope|Bucket.*|Chocolaty milk|Chocolate dust|Snape grass|Dwellberries)$/i]);
    await setvar(sdk, 'elenaquest', 30);
    await setvar(sdk, 'regicide_quest', 0);
    await ensureItem(sdk, 'coins', /^Coins$/i, 100);

    for (const seg of segments) {
        console.log(`\n-- ${seg}`);
        if (seg === 'east') {
            await stage(0);
            await dropMatching(sdk, [/^(Bird feed|Pigeon cage|Distillator)$/i]);
            await mustTele(sdk, 2592, 3340);
            await S('Elena door (in)', await opAt(2592, 3339, /Open/), { done: s => pos(s).z <= 3338, idle: 0 });
            await T('Elena: start (0->1)', /^Elena$/, { choices: [/I'll try to retrieve it for you/] });
            await quest('elena');
            await S('Elena door (out)', await opAt(2592, 3339, /Open/), { done: s => pos(s).z >= 3339, idle: 0 });
            await W('Elena -> Jerico', 2612, 3325);
            await T('Jerico (1->2)', /^Jerico$/);
            await quest('jerico');
            await S('open Jerico cupboard', await opAt(2611, 3326, /Open/), { done: locHas(2611, 3326, /Search/), idle: 0 });
            await S('search the cupboard: bird feed', await opAt(2611, 3326, /Search/), { done: has(/^Bird feed$/i) });
            const cage = (await sdk.scanGroundItems(15)).filter(g => /^Pigeon cage$/i.test(g.name)).sort((a, b) => a.distance - b.distance)[0];
            if (!cage) throw new Error('no pigeon cage on the ground');
            out.cageAt = { x: cage.x, z: cage.z, reachable: cage.reachable };
            // bot.pickupItem walks next to the item (sendPickup alone does not route).
            await S(`pick up a pigeon cage (${cage.x},${cage.z}), walking from the cupboard`, () => bot.pickupItem(cage), { done: has(/^Pigeon cage$/i), idle: 0, maxTicks: 120 });
            await W('pigeons -> watch tower', 2564, 3303);
            const tower = await findLoc(sdk, { name: /watch ?tower/i, radius: 6 });
            if (!tower) throw new Error('no watch tower loc');
            await S('bird feed on the watch tower (2->3)', useOnLoc(/^Bird feed$/i, tower.x, tower.z, tower.id), { done: s => invCount(s, /^Bird feed$/i) === 0, idle: 3 });
            await sdk.waitForTicks(2);
            await quest('birdfeed');
            const cageSlot = slotOf(sdk, /^Pigeon cage$/i);
            await S('open the pigeon cage (3->4)', () => sdk.sendUseItem(cageSlot, 1), { done: has(/^Pigeon cage$/i), idle: 6 });
            await quest('pigeons');
            await W('watch tower -> Omart', 2559, 3268);
            await T('Omart: rope ladder over the wall (4->5)', /^Omart$/, { choices: [/Ok, lets do it/], idle: 7, done: s => pos(s).x <= 2557 });
            out.overWall = pos(sdk);
            await quest('ladder');
        } else if (seg === 'west') {
            await stage(5);
            await dropMatching(sdk, [/^(Rotten apples|Doctors' gown|Key|Distillator)$/i]);
            for (const e of sdk.getEquipment()) if (GOWN.test(e.name)) await bot.unequipItem(e);
            await dropMatching(sdk, [GOWN]);
            await setStats(sdk, STATS);
            for (const g of ['rune_scimitar', 'rune_full_helm', 'rune_platelegs', 'rune_kiteshield', 'amulet_of_strength']) {
                const named = new RegExp(`^${g.replace(/_/g, ' ')}$`, 'i');
                if (worn(sdk, named)) continue;
                await give(sdk, g);
                await wield(sdk, named);
            }
            await sdk.sendSetCombatStyle(1);
            if (Math.abs(pos(sdk).x - 2556) > 2 || Math.abs(pos(sdk).z - 3267) > 2) await mustTele(sdk, 2556, 3267);
            const apple = (await sdk.scanGroundItems(90)).find(g => /^Rotten apples?$/i.test(g.name));
            out.appleAt = apple && { x: apple.x, z: apple.z, distance: apple.distance };
            await W('ladder landing -> rotten apple', 2535, 3333);
            await timed(rec, sdk, 'pick up the rotten apple', () => pickup(sdk, /^Rotten apples?$/i));
            // The cauldron is inside the mourner HQ yard; the way in is the fence at (2541,3331)
            // ("Climb-over", general_use/scripts/fence.rs2, no requirement).
            await S('climb the yard fence (in), walking from the apple', await opAt(2541, 3331, /Climb-over/), { done: s => pos(s).x >= 2542, idle: 0, maxTicks: 60 });
            out.fenceInside = pos(sdk);
            await S('rotten apple on the cauldron (5->6)', useOnLoc(/^Rotten apples?$/i, 2543, 3332, 2043), { idle: 4, done: s => invCount(s, /^Rotten apples?$/i) === 0, maxTicks: 60 });
            await sdk.waitForTicks(4);
            await quest('stew');
            await S('climb the yard fence (out)', await opAt(2541, 3331, /Climb-over/), { done: s => pos(s).x <= 2541, idle: 0, maxTicks: 60 });
            // forceapproach=east on a cupboard placed at angle 1 means it opens from the south side.
            await W('fence -> nurse cupboard (south side)', 2518, 3275);
            await S('open the nurse cupboard', await opAt(2517, 3276, /Open/), { done: locHas(2517, 3276, /Search/), idle: 0 });
            await S("search: doctors' gown", await opAt(2517, 3276, /Search/), { done: has(GOWN), idle: 0 });
            await timed(rec, sdk, "wear the doctors' gown", () => wield(sdk, GOWN));
            // Front door from the street; (2551,3328) joins the yard to the HQ instead.
            await W('nurse -> HQ front door', 2551, 3320);
        } else if (seg === 'hq') {
            if (((await getvar(sdk, 'biohazard')) ?? 0) !== 6) await stage(6);
            await dropMatching(sdk, [/^(Key|Distillator)$/i]);
            if (!worn(sdk, GOWN)) {
                await ensureItem(sdk, 'doctor_gown', GOWN);
                await wield(sdk, GOWN);
            }
            await setStats(sdk, STATS);
            const p = pos(sdk);
            if (p.level !== 0 || p.x !== 2551 || p.z !== 3320) await mustTele(sdk, 2551, 3320);
            await S('HQ front door ("In you go doc")', await opAt(2551, 3320, /Open/), { done: s => pos(s).z >= 3321 });
            await W('HQ -> spiral stairs', 2543, 3325);
            await S('spiral stairs up', await opAt(2542, 3324, /Climb-up/), { done: atLevel(1), idle: 0 });
            await W('stairs -> upstairs door', 2546, 3325);
            await S('upstairs door', await opAt(2547, 3325, /Open/), { done: s => pos(s).x >= 2547, idle: 0 });
            // Fight one of the two sick mourners for the key (death queue, mourner.rs2).
            const hasKey = has(/^Key$/i);
            const target = findNpc(sdk, /^Mourner$/);
            if (!target) throw new Error('no mourner upstairs');
            out.mourner = { combatLevel: target.combatLevel, at: [target.x, target.z] };
            await rec.seg('fight a sick mourner: attack click to key', async row => {
                const t0 = currentTick(sdk);
                const f = await fight(sdk, target, { done: hasKey, maxTicks: 200 });
                // The key comes from the death queue, a tick or two after the kill.
                const key = f.end === 'done' ? { ok: true, tick: t0 + f.ticks } : await waitUntil(sdk, hasKey, { maxTicks: 10 });
                rec.interact(f.attacks);
                row.levelUps += f.levelUps;
                rec.mark(key.tick);
                out.fight = { ticks: key.tick - t0, key: key.ok, end: f.end, levelUps: f.levelUps, attacks: f.attacks, firstHit: f.engaged };
                return key.ok ? undefined : `no key (${f.end})`;
            });
            const gate = await findLoc(sdk, { name: /Gate/, op: 'Open', radius: 8 });
            if (!gate) throw new Error('no gate upstairs');
            const gateOp = opIndex(gate, 'Open')!;
            await S('open the gate (key in inventory)', () => sdk.sendInteractLoc(gate.x, gate.z, gate.id, gateOp), { done: s => pos(s).x >= 2552, idle: 0, maxTicks: 30 });
            await S('search the crate: distillator (6->7)', await opAt(2554, 3327, /Search/), { done: has(/^Distillator$/i), idle: 0 });
            await quest('crate');
            await teleport();
            await LW('teleport -> Elena door', 2592, 3340);
            await S('Elena door (in)', await opAt(2592, 3339, /Open/), { done: s => pos(s).z <= 3338, idle: 0 });
            await T('Elena: distillator -> vials and sample (7->10)', /^Elena$/, { idle: 5, done: has(/^Plague sample$/i) });
            await quest('elenaDistillator');
        } else if (seg === 'rimmington') {
            await stage(10);
            await setvar(sdk, 'bioerrand', 0);
            await dropMatching(sdk, [/^(Touch paper)$/i]);
            for (const [o, re] of [['ethenea', /^Ethanea$/i], ['liquid_honey', /^Liquid honey$/i], ['sulphuric_broline', /^Sulphuric broline$/i], ['plaguesample', /^Plague sample$/i]] as const) await ensureItem(sdk, o, re);
            await mustTele(sdk, 2934, 3212);
            await T('chemist (10->12)', /^Chemist$/, { choices: [/I'm Elena's friend/, /touch paper for a guy called Guidor/] });
            await quest('chemist');
            await W('chemist -> errand boys', 2933, 3218);
            await T('Hops: sulphuric broline', /^Hops$/, { choices: [/sulphuric broline/] });
            await T('Chancy: liquid honey', /^Chancy$/, { choices: [/liquid honey/] });
            await T('DeVinci: ethenea', /^DeVinci$/, { choices: [/ethenea/] });
            out.bioerrand = await getvar(sdk, 'bioerrand');
        } else if (seg === 'karamja') {
            await ensureItem(sdk, 'plaguesample', /^Plague sample$/i);
            await mustTele(sdk, 2772, 3230);
            await LW('Brimhaven dock -> Musa Point customs officer', 2954, 3148);
            out.sampleKept = invCount(sdk, /^Plague sample$/i) > 0;
        } else if (seg === 'varrock') {
            await stage(12);
            await setvar(sdk, 'bioerrand', ERRAND_ALL_CORRECT);
            await dropMatching(sdk, [/^(Ethanea|Liquid honey|Sulphuric broline)$/i]);
            await ensureItem(sdk, 'plaguesample', /^Plague sample$/i);
            await ensureItem(sdk, 'touch_paper', /^Touch paper$/i);
            // Both halves are named "Priest gown" (quest_biohazard.obj); Guidor's door checks both worn.
            const wornPriest = (s: { equipment: Array<{ name: string }> }) => s.equipment.filter(e => PRIEST.test(e.name)).length;
            if (wornPriest(sdk.getState()!) < 2) {
                await give(sdk, ['priest_gown', 'priest_robe']);
                for (let n = invCount(sdk, PRIEST); n > 0; n--) await invOp(sdk, PRIEST, /^(wear|wield)$/i, s => invCount(s, PRIEST) < n || wornPriest(s) >= 2);
            }
            await mustTele(sdk, 3262, 3405);
            await S('Varrock gate: the search', await opAt(3264, 3405, /Open/), { done: s => pos(s).x >= 3265, idle: 4 });
            await W('gate -> Hops', 3268, 3390);
            await T('Hops: sulphuric broline back', /^Hops$/, { idle: 4, done: has(/^Sulphuric broline$/i) });
            await T('Chancy: liquid honey back', /^Chancy$/, { idle: 4, done: has(/^Liquid honey$/i) });
            await T('DeVinci: ethenea back', /^DeVinci$/, { done: has(/^Ethanea$/i) });
            await W('errand boys -> Guidor door', 3282, 3382);
            await S("Guidor's door (priest gown)", await opAt(3282, 3382, /Open/), { done: s => pos(s).x >= 3283, idle: 0 });
            await T('Guidor (12->14)', /^Guidor$/, { choices: [/I've come to ask your assistance/, /sent by your old pupil Elena/, /So what does that mean exactly/] });
            await quest('guidor');
        } else if (seg === 'westgate') {
            // After Biohazard: King Lathas -> the West Ardougne wall doors (open for %biohazard = 16,
            // area_ardougne_west/scripts/doors.rs2) -> Koftik at the Underground Pass entrance.
            await stage(16);
            await mustTele(sdk, 2577, 3293, 1);
            await W('Lathas -> castle stairs (L1)', 2571, 3296);
            await S('castle stairs down', await opAt(2571, 3295, /Climb-down/), { done: atLevel(0), idle: 0 });
            await W('castle stairs -> wall doors (east side)', 2559, 3300);
            const doors = (await sdk.scanNearbyLocs(5)).filter(l => /door/i.test(l.name) && l.x >= 2556 && l.x <= 2559).sort((a, b) => a.distance - b.distance);
            out.wallDoors = doors.map(d => [d.name, d.x, d.z, d.options]);
            const door = doors[0];
            if (!door) throw new Error('no wall door');
            await S('wall doors: through to West Ardougne', () => sdk.sendInteractLoc(door.x, door.z, door.id, 1), { done: s => pos(s).x <= 2556, idle: 0, maxTicks: 30 });
            await LW('wall doors -> Koftik (2436,3315)', 2437, 3315);
        } else if (seg === 'finale') {
            await stage(14);
            await mustTele(sdk, 3285, 3383);
            await teleport();
            await LW('teleport -> Elena door', 2592, 3340);
            await S('Elena door (in)', await opAt(2592, 3339, /Open/), { done: s => pos(s).z <= 3338, idle: 0 });
            await T('Elena: report (14->15)', /^Elena$/);
            await quest('elenaReport');
            await S('Elena door (out)', await opAt(2592, 3339, /Open/), { done: s => pos(s).z >= 3339, idle: 0 });
            await LW('Elena -> castle stairs', 2572, 3295);
            await S('castle stairs up', await opAt(2571, 3295, /Climb-up/), { done: atLevel(1), idle: 0 });
            await LW('stairs -> King Lathas', 2577, 3293);
            await T('King Lathas: complete (15->16)', /^King Lathas$/, { choices: [/I don't understand/], idle: 4 });
            await sdk.waitForTicks(2);
            if (sdk.getState()!.modalOpen) await S('close the quest-complete scroll', () => sdk.sendCloseModal(), { done: s => !s.modalOpen, idle: 0 });
            await quest('lathas');
        }
    }
    rec.report();
    result('biohazard-out', out);
}, { timeout: 1_800_000, printState: false });
