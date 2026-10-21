// Underground Pass: timed segments, each started from a staged quest state
// (::setvar / ::tele / ::give) and played with real clicks. Travel follows the
// cheapest route from quest-underground-pass-route.ts (see Lab.travel).
//
//   bun docs/speedrun/scripts/quest-underground-pass-segments.ts <bot> <segment> [--grid=342] [--thieving=50] [--agility=99]
//
// Segments:
//   post      after completion: cave entrance to the Iban temple doors and through them
//             (Regicide's second traversal, %upass 10, %regicide_quest 2)
// Prints one line per step and a RESULT line.

import { runScript } from '../../../sdk/runner';
import { Lab, ibanmulti, BIT } from './quest-underground-pass-lib';
import { P, type T } from './quest-underground-pass-route';

const args = process.argv.slice(3);
const segment = args.find(a => !a.startsWith('--')) ?? 'post';
const opt = (name: string, d: number) => Number(args.find(a => a.startsWith(`--${name}=`))?.split('=')[1] ?? d);
// Grid answers are three digits 1-5, each within 1 of the previous (upass_grid.rs2:47-58).
const GRID = opt('grid', 343);
const THIEVING = opt('thieving', 50);
const AGILITY = opt('agility', 99);

await runScript(async ({ bot, sdk }) => {
    const lab = new Lab(sdk, bot);
    const L_sleep = (n: number) => sdk.waitForTicks(n);
    const L_waitGround = async (re: RegExp) => { for (let i = 0; i < 10 && !sdk.getGroundItems().some(g => re.test(g.name)); i++) await sdk.waitForTicks(1); };
    const L_waitBoulder = async () => { for (let i = 0; i < 20 && !lab.npc(/Boulder/); i++) await sdk.waitForTicks(1); };
    await bot.dismissBlockingUI();
    await lab.cheat('setvar biohazard 16'); // ^biohazard_complete, needed by the cave entrance (quest_upass.rs2:81)
    // King Lathas talks Regicide first whenever %regicide_quest > 0 (king_lathas.rs2:2); only `post` sets it.
    await lab.cheat('setvar regicide_quest 0');
    const stats = async (s: Record<string, number>) => { for (const [k, v] of Object.entries(s)) await lab.cheat(`setstat ${k} ${v}`, 1); };
    const clearInv = async () => { for (const it of sdk.getInventory()) { await sdk.sendDropItem(it.slot); await sdk.waitForTicks(1); } };

    /** Walk the trap grid on its safe strips (upass_grid.rs2:61-83), from the east edge to the lever, and pull it. */
    const grid = async (answer: number) => {
        const d = [Math.floor(answer / 100) % 10, Math.floor(answer / 10) % 10, answer % 10];
        const row = (n: number) => 9673 + 2 * (n - 1);
        const pts: T[] = [[2477, row(d[0]), 0], [2474, row(d[0]), 0], [2474, row(d[1]), 0], [2469, row(d[1]), 0], [2469, row(d[2]), 0], [2466, row(d[2]), 0], [2466, 9673, 0]];
        await lab.act(`grid walk (answer ${answer})`, async () => {
            for (const p of pts) {
                if (lab.at(p)) continue;
                await sdk.sendWalk(p[0], p[1], true);
                const ok = await new Promise<boolean>(async res => {
                    for (let i = 0; i < 30; i++) { await sdk.waitForTicks(1); if (lab.at(p)) return res(true); if (lab.pos()[1] < 9600) return res(false); }
                    res(false);
                });
                if (!ok) throw new Error(`grid: did not reach ${p} (at ${lab.pos()})`);
            }
        }, undefined, { tiles: 'see route' });
        await lab.act('portcullis lever', () => lab.clickLoc(3337, 2466, 9672, 1), () => lab.at([2464, 9677, 0]));
    };

    /**
     * Koftik's damp cloth, a lit bronze fire arrow, the shot from (2446,9722).
     * A miss costs the arrow (upass_bridge.rs2:63-71): back to Koftik for another cloth.
     */
    const crossBridge = async () => {
        for (let shot = 1; shot <= 6; shot++) {
            if (shot > 1) await lab.travel('back to Koftik after a miss', [2448, 9716, 0]);
            await lab.talk(`Koftik (damp cloth), shot ${shot}`, /Koftik/, [/litter/i, /./]);
            await lab.act('wrap cloth on bronze arrow', () => lab.useItem(/^Damp cloth$/i, /^Bronze arrow$/i), () => sdk.countInventoryItems(/fire arrow/i) > 0);
            await lab.act('light it with the tinderbox', () => lab.useItem(/^Tinderbox$/i, /fire arrow/i), () => sdk.getInventory().some(i => i.id === 942));
            await lab.act('wield the lit arrow', () => bot.equipItem(/^Bronze fire arrows$/i), () => sdk.getEquipment().some(e => /fire arrows/i.test(e.name)));
            await lab.travel('Koftik -> shooting spot (2446,9722)', P.shootSpot);
            const r = await lab.act(`fire at the guide rope, shot ${shot}`, () => lab.clickLoc(3340, 2443, 9718, 1),
                () => lab.at(P.bridgeWest) || lab.log.slice(-3).some(t => /just misses/.test(t)));
            if (lab.at(P.bridgeWest)) return shot;
            void r;
        }
        throw new Error('bridge: six misses');
    };

    const ATT = opt('att', 70), STR = opt('str', 70), DEF = opt('def', 70), HP = opt('hp', 70);
    /** Melee stats, rune scimitar, rune armour (no platebody: Dragon Slayer), amulet of strength, swordfish. */
    const gear = async (food = 10) => {
        await stats({ attack: ATT, strength: STR, defence: DEF, hitpoints: HP, agility: AGILITY, thieving: THIEVING, ranged: 60, prayer: 1 });
        await clearInv();
        for (const g of ['rune_scimitar', 'rune_full_helm', 'rune_chainbody', 'rune_platelegs', 'rune_kiteshield', 'amulet_of_strength']) {
            const named = (i: { name: string }) => i.name.toLowerCase().replace(/ /g, '_') === g;
            if (sdk.getEquipment().some(named)) continue;
            await lab.give(g, 1);
            const it = sdk.getInventory().find(named);
            if (it) await bot.equipItem(it);
        }
        await lab.give('swordfish', food);
        await sdk.sendSetCombatStyle(1); // aggressive
        await sdk.waitForTicks(2);
    };
    const vars = async (upass: number, bits: number[]) => {
        await lab.cheat(`setvar upass ${upass}`);
        await lab.cheat(`setvar ibanmulti ${ibanmulti([BIT.started, BIT.koftikInsane, ...bits], GRID)}`);
    };
    const take = async (label: string, re: RegExp) => {
        const n0 = sdk.countInventoryItems(re);
        await L_waitGround(re);
        return lab.act(label, async () => {
            const g = sdk.getGroundItems().filter(i => re.test(i.name)).sort((a, b) => a.distance - b.distance)[0];
            if (!g) throw new Error(`no ground item ${re}`);
            await sdk.sendPickup(g.x, g.z, g.id);
        }, () => sdk.countInventoryItems(re) > n0);
    };
    /** Dwarf brew, Iban's ashes from the tomb, Kalrag's blood, the dove: the doll's other three parts. */
    const brewToDove = async () => {
        await lab.travel('-> brew barrel (west side)', P.barrel);
        await lab.act('bucket on the barrel: dwarf brew', () => lab.useOnLoc(/^Bucket$/i, 3344, 2327, 9799), () => sdk.countInventoryItems(/brew/i) > 0);
        await lab.travel('-> Iban\'s tomb', P.tomb);
        await lab.act('brew on the tomb', () => lab.useOnLoc(/brew/i, 3353, 2356, 9800), () => sdk.countInventoryItems(/brew/i) === 0);
        await lab.act('tinderbox on the tomb: Iban\'s ashes', () => lab.useOnLoc(/^Tinderbox$/i, 3353, 2356, 9800), () => sdk.countInventoryItems(/ashes/i) > 0);
        await lab.act('ashes on the doll (p_delay 7)', () => lab.useItem(/ashes/i, /doll/i), () => sdk.countInventoryItems(/ashes/i) === 0);
        await lab.travel('tomb -> Kalrag', P.kalrag);
        await lab.fight('fight Kalrag (lvl 89, 78 hp)', /Kalrag/, { food: /^Swordfish$/i });
        await lab.idle(4);
        lab.record({ label: 'ibanmulti after Kalrag', ticks: 0, value: await lab.getVar('ibanmulti') });
        await lab.travel('Kalrag -> north stairs -> dove cage', P.doveCage);
        await lab.act('search the cage: Iban\'s dove (bitten, no gauntlets)', () => lab.clickLoc(3351, 2134, 4702, 1), () => sdk.countInventoryItems(/dove/i) > 0);
        await lab.act('dove on the doll', () => lab.useItem(/dove/i, /doll/i), () => sdk.countInventoryItems(/dove/i) === 0);
    };
    const ORBS = [BIT.orb1, BIT.orb2, BIT.orb3, BIT.orb4];
    const BADGES = [BIT.badge1, BIT.badge2, BIT.badge3, BIT.horn];

    if (segment === 'start') {
        // King Lathas starts the quest; Koftik outside the cave sets %upass 1.
        await stats({ ranged: 25 });
        await lab.cheat('setvar upass 0');
        await lab.cheat('setvar ibanmulti 0');
        await lab.teleTo(2578, 3294, 1); // inside the throne room door (2575,3293)
        await lab.talk('King Lathas (start, %upass 0)', /King Lathas/);
        lab.record({ label: 'ibanmulti after Lathas', ticks: 0, value: await lab.getVar('ibanmulti') });
        await lab.teleTo(2434, 3313, 0);
        await lab.dialogue('cave entrance at %upass 0: Koftik first dialogue', () => lab.clickLoc(3213, 2433, 3313, 1), [/take my chances/i]);
        lab.record({ label: 'upass after Koftik', ticks: 0, value: await lab.getVar('upass') });
        await lab.act('cave entrance: enter', () => lab.clickLoc(3213, 2433, 3313, 1), () => lab.at(P.landing));
    } else if (segment === 'entry') {
        // %upass 1: into the cave, Koftik's cloth, the bridge shot (2), the rope swing, the grid, the lever.
        await stats({ agility: AGILITY, thieving: THIEVING, ranged: opt('ranged', 60), hitpoints: 99 });
        await vars(1, []);
        await lab.cheat('setvar ibanmulti ' + ibanmulti([BIT.started], GRID));
        await clearInv();
        for (const [n, c] of [['shortbow', 1], ['bronze_arrow', 5], ['tinderbox', 1], ['rope', 2], ['spade', 1], ['swordfish', 5]] as const) await lab.give(n, c);
        await sdk.waitForTicks(2);
        await lab.equip(/^Shortbow$/i);
        await lab.teleTo(2434, 3313, 0);
        const t0 = lab.tick();
        await lab.travel('cave entrance -> Koftik at the bridge', [2448, 9716, 0]);
        const shots = await crossBridge();
        lab.record({ label: 'bridge shots needed', ticks: 0, shots, upass: await lab.getVar('upass') });
        await lab.travel('bridge west bank -> grid east edge (rope swing)', P.gridEast);
        await grid(GRID);
        lab.record({ label: 'TOTAL cave entrance to through the portcullis (known grid)', ticks: lab.tick() - t0 });
    } else if (segment === 'gridfall') {
        // One wrong step on the grid: the fall, the climb out, and back at the east edge.
        await stats({ hitpoints: 99 });
        await vars(2, []);
        await lab.teleTo(...P.gridEast);
        const d1 = Math.floor(GRID / 100);
        const wrong = d1 === 1 ? 2 : 1;
        await lab.act('step onto a trapped grid tile', () => sdk.sendWalk(2475, 9673 + 2 * (wrong - 1), true), () => lab.pos()[1] < 9600);
        // the fall lands on one of the four hand-hold tiles at random (upass_grid.rs2:94); click the one underfoot or next to it
        const p = lab.pos();
        const hold = [[2395, 9559], [2395, 9560], [2396, 9559], [2396, 9560]].sort((a, b) => Math.abs(a[0] - p[0]) + Math.abs(a[1] - p[1]) - Math.abs(b[0] - p[0]) - Math.abs(b[1] - p[1]))[0];
        await lab.act(`climb the protruding rocks out of the pit (landed ${p})`, async () => {
            for (const [x, z] of [hold, [2395, 9559], [2396, 9560], [2395, 9560], [2396, 9559]]) {
                await lab.clickLoc(3365, x, z, 1);
                await L_sleep(3);
                if (lab.pos()[1] > 9600) return;
            }
        }, () => lab.at([2477, 9677, 0]));
    } else if (segment === 'swingfail') {
        // Cost of a failed rope swing: from the pit landing back to the swing with a new rope.
        await stats({ agility: AGILITY, ranged: 60, hitpoints: 99 });
        await vars(2, []);
        await clearInv();
        for (const [n, c] of [['shortbow', 1], ['bronze_arrow', 5], ['tinderbox', 1], ['rope', 1]] as const) await lab.give(n, c);
        await lab.equip(/^Shortbow$/i);
        await lab.teleTo(2485, 9649, 0);
        const t0 = lab.tick();
        await lab.travel('pit landing -> rock pile -> Koftik', [2448, 9716, 0]);
        await crossBridge();
        await lab.travel('bridge west bank -> rope swing done', [2466, 9699, 0]);
        lab.record({ label: 'TOTAL rope swing failure recovery (pit to across the swing)', ticks: lab.tick() - t0 });
    } else if (segment === 'ledgefail') {
        await stats({ agility: AGILITY, thieving: THIEVING, hitpoints: 99 });
        await vars(3, ORBS);
        await clearInv();
        await lab.give('spade', 1);
        await lab.teleTo(2373, 9641, 0);
        await lab.travel('rat pit -> ledge top', P.ledgeTop);
    } else if (segment === 'bridgefall') {
        await stats({ agility: AGILITY, hitpoints: 99 });
        await vars(7, [...ORBS, ...BADGES]);
        for (const land of [[2335, 9821, 0], [2333, 9866, 0]] as T[]) {
            await lab.teleTo(...land);
            await lab.travel(`bridge fall landing ${land} -> back at the bridge (2155,4718)`, [2155, 4721, 1]);
        }
    } else if (segment === 'orbs') {
        // %upass 2, through the portcullis: four orbs, the furnace, the well (-> 3).
        await stats({ agility: AGILITY, thieving: THIEVING, hitpoints: 99 });
        await vars(2, []);
        await clearInv();
        await stats({ hitpoints: HP });
        await lab.give('swordfish', 20);
        await lab.teleTo(...P.afterPortcullis);
        const t0 = lab.tick();
        await lab.travel('portcullis -> orb 1 trap (flat rock)', P.orb1trap);
        for (let k = 0; k < 6 && sdk.countInventoryItems(/^Orb of light$/i) < 1; k++) {
            await lab.dialogue(`disarm the log trap for orb 1, try ${k + 1}`, () => lab.clickLoc(3339, 2382, 9668, 1), [/give it a go/i]);
            await lab.idle();
        }
        await lab.travel('-> orb 2', P.orb2);
        await take('take orb 2', /^Orb of light$/i);
        await lab.travel('-> orb 3', P.orb3);
        await take('take orb 3', /^Orb of light$/i);
        await lab.travel('-> orb 4', P.orb4);
        await take('take orb 4', /^Orb of light$/i);
        lab.record({ label: 'orbs held', ticks: 0, orbs: sdk.countInventoryItems(/^Orb of light$/i) });
        await lab.travel('-> furnace', P.furnace);
        for (let k = 0; k < 4; k++) {
            const before = sdk.countInventoryItems(/^Orb of light$/i);
            await lab.act(`orb ${k + 1} into the furnace`, () => lab.useOnLoc(/^Orb of light$/i, 3294, 2454, 9682), () => sdk.countInventoryItems(/^Orb of light$/i) < before);
        }
        lab.record({ label: 'ibanmulti after furnace', ticks: 0, value: await lab.getVar('ibanmulti') });
        await lab.travel('furnace -> down the well', P.wellBottom);
        lab.record({ label: 'TOTAL portcullis to the well bottom', ticks: lab.tick() - t0, upass: await lab.getVar('upass') });
    } else if (segment === 'area2') {
        // %upass 3: cage, mud, ledge, cages (Thieving 50) or stone bridges, pipe, railing, boulder (-> 4), horn, tunnel.
        await stats({ agility: AGILITY, thieving: THIEVING, hitpoints: 99 });
        await vars(3, ORBS);
        await clearInv();
        await lab.give('spade', 1);
        await lab.give('swordfish', 3);
        await lab.teleTo(...P.wellBottom);
        const t0 = lab.tick();
        await lab.travel('well bottom -> pipe east end', P.pipeEast, { allow: k => THIEVING >= 50 || k !== 'railing5' });
        await lab.act('squeeze through the pipe (%upass 3: 1-tile jump)', () => lab.clickLoc(3237, 2417, 9605, 1), () => lab.at([2412, 9605, 0]));
        await lab.travel('-> unicorn cage', P.unicornCage);
        await lab.act('search the cage: piece of railing', () => lab.clickLoc(3267, 2397, 9605, 2), () => sdk.countInventoryItems(/railing/i) > 0);
        await lab.act('railing on the boulder (unicorn killed)', async () => {
            await L_waitBoulder();
            const b = lab.npc(/Boulder/)!;
            await sdk.sendUseItemOnNpc(sdk.findInventoryItem(/railing/i)!.slot, b.index);
        }, () => sdk.getState()!.dialog.isOpen || lab.pos()[0] < 2380);
        await lab.dialogue('"I heard something breaking."', async () => {}, [/./]);
        lab.record({ label: 'upass after boulder', ticks: 0, value: await lab.getVar('upass'), at: lab.pos() });
        await lab.dialogue('search the smashed cage: unicorn horn', () => lab.clickLoc(3308, 2371, 9603, 1), [/./]);
        await lab.travel('-> tunnel to area 3', P.area3);
        lab.record({ label: 'TOTAL well bottom to area 3', ticks: lab.tick() - t0, horn: sdk.countInventoryItems(/horn/i) });
    } else if (segment === 'paladins') {
        // %upass 4: three paladins, badges and horn into the well, the door (-> 5).
        await gear(15);
        await vars(4, ORBS);
        await lab.give('cave_unicorn_horn', 1);
        await lab.teleTo(...P.area3);
        const t0 = lab.tick();
        await lab.travel('area 3 -> paladins', [2423, 9716, 0]);
        for (const [name, badge] of [['Sir Jerro', 1], ['Sir Carl', 2], ['Sir Harry', 3]] as const) {
            await lab.fight(`fight ${name} (lvl 62, 57 hp)`, new RegExp(name), { food: /^Swordfish$/i });
            await L_sleep(1);
            await take(`pick up ${name}'s badge`, /badge/i).catch(e => lab.record({ label: `badge ${badge} missing`, ticks: 0, err: String(e) }));
        }
        await lab.travel('paladins -> well of flames', P.bloodwell);
        for (const it of [/badge/i, /badge/i, /badge/i, /horn/i]) {
            const n0 = sdk.countInventoryItems(it);
            await lab.act(`throw ${it} into the well`, () => lab.useOnLoc(it, 3305, 2373, 9718), () => sdk.countInventoryItems(it) < n0);
        }
        await lab.act('open the door to Iban\'s cavern', () => lab.clickLoc(3220, 2368, 9717, 1), () => lab.pos()[2] === 1);
        lab.record({ label: 'TOTAL area 3 to the cavern', ticks: lab.tick() - t0, upass: await lab.getVar('upass') });
    } else if (segment === 'cavern') {
        // %upass 5 at the cavern door: Nilhoof (6), cat, witch, chest (7), demons, shadow, brew, ashes, Kalrag, dove.
        await gear(15);
        await vars(5, [...ORBS, ...BADGES]);
        await lab.give('bucket_empty', 1);
        await lab.give('tinderbox', 1);
        await lab.teleTo(...P.mainArrival);
        const t0 = lab.tick();
        await lab.travel('cavern arrival -> south stairs -> dwarves', P.dwarfStairsFoot);
        await lab.travel('-> Nilhoof', P.nilhoof);
        await lab.talk('Nilhoof (%upass 5 -> 6)', /Nilhoof/);
        await lab.travel('Nilhoof -> stairs up', P.stairsSouth);
        await lab.travel('-> witch\'s cat', P.cat);
        await lab.act('pick up the cat', async () => { const c = lab.npc(/Witches cat/)!; await sdk.sendInteractNpc(c.index, 1); }, () => sdk.countInventoryItems(/cat/i) > 0);
        await lab.travel('cat -> witch\'s door', P.witchDoor);
        await lab.act('cat on the witch\'s door (hide, %ibanmulti bit 9)', () => lab.useOnLoc(/cat/i, 3270, 2158, 4566), () => sdk.countInventoryItems(/cat/i) === 0);
        await lab.act('open the door', () => lab.clickLoc(3270, 2158, 4566, 1));
        await lab.dialogue('open the chest: doll, journal, potions (%upass 7)', () => lab.clickLoc(3272, 2157, 4564, 1), [/./]);
        lab.record({ label: 'upass after chest', ticks: 0, value: await lab.getVar('upass'), doll: sdk.countInventoryItems(/doll/i) });
        // the door closes behind you (open_and_close_door3); open it again to leave
        await lab.act('leave the witch\'s house', () => lab.clickLoc(3270, 2158, 4566, 1), () => lab.pos()[1] >= 4566);
        for (const [name, amulet, at] of [['Doomion', /doomion/i, P.doomion], ['Holthion', /holthion/i, P.holthion], ['Othainian', /othanian/i, P.othainian]] as const) {
            await lab.travel(`-> ${name}`, at);
            await lab.fight(`fight ${name} (lvl 91, 87 hp)`, new RegExp(name), { food: /^Swordfish$/i });
            await L_sleep(1);
            await take(`pick up the amulet of ${name}`, amulet).catch(e => lab.record({ label: `amulet ${name} missing`, ticks: 0, err: String(e) }));
        }
        await lab.travel('-> the sealed chest', P.shadowChest);
        await lab.act('open the chest with three amulets: Iban\'s shadow', () => lab.clickLoc(3274, 2136, 4578, 1), () => sdk.countInventoryItems(/shadow/i) > 0);
        await lab.act('shadow on the doll', () => lab.useItem(/shadow/i, /doll/i), () => sdk.countInventoryItems(/shadow/i) === 0);
        await lab.travel('-> south stairs -> dwarves', P.dwarfStairsFoot);
        await brewToDove();
        lab.record({ label: 'TOTAL cavern arrival to the doll complete', ticks: lab.tick() - t0, ibanmulti: await lab.getVar('ibanmulti') });
    } else if (segment === 'brew') {
        // resume the cavern at the dwarves: %upass 7, doll holding the shadow
        await gear(15);
        await vars(7, [...ORBS, ...BADGES, BIT.cat, BIT.shadow]);
        await lab.give('ibandoll', 1);
        await lab.give('bucket_empty', 1);
        await lab.give('tinderbox', 1);
        await lab.teleTo(...P.dwarfStairsFoot);
        const t0 = lab.tick();
        await brewToDove();
        lab.record({ label: 'TOTAL dwarf stairs to the doll complete', ticks: lab.tick() - t0, ibanmulti: await lab.getVar('ibanmulti') });
    } else if (segment === 'never') {
        await lab.travel('-> brew barrel', P.barrel);
        await lab.act('bucket on the barrel: dwarf brew', () => lab.useOnLoc(/^Bucket$/i, 3344, 2327, 9799), () => sdk.countInventoryItems(/brew/i) > 0);
        await lab.travel('-> Iban\'s tomb', P.tomb);
        await lab.act('brew on the tomb', () => lab.useOnLoc(/brew/i, 3353, 2356, 9800), () => sdk.countInventoryItems(/brew/i) === 0);
        await lab.act('tinderbox on the tomb: Iban\'s ashes', () => lab.useOnLoc(/^Tinderbox$/i, 3353, 2356, 9800), () => sdk.countInventoryItems(/ashes/i) > 0);
        await lab.act('ashes on the doll', () => lab.useItem(/ashes/i, /doll/i), () => sdk.countInventoryItems(/ashes/i) === 0);
        await lab.travel('tomb -> Kalrag', P.kalrag);
        await lab.fight('fight Kalrag (lvl 89, 78 hp)', /Kalrag/, { food: /^Swordfish$/i });
        await lab.idle(4);
        lab.record({ label: 'ibanmulti after Kalrag', ticks: 0, value: await lab.getVar('ibanmulti') });
        await lab.travel('Kalrag -> north stairs -> dove cage', P.doveCage);
        await lab.act('search the cage: Iban\'s dove (bitten, no gauntlets)', () => lab.clickLoc(3351, 2134, 4702, 1), () => sdk.countInventoryItems(/dove/i) > 0);
        await lab.act('dove on the doll', () => lab.useItem(/dove/i, /doll/i), () => sdk.countInventoryItems(/dove/i) === 0);
        lab.record({ label: 'TOTAL cavern arrival to the doll complete', ticks: lab.tick() - t0, ibanmulti: await lab.getVar('ibanmulti') });
    } else if (segment === 'iban') {
        // %upass 7, doll complete: a disciple's robes, wear only them, the temple, the doll in the pit (-> 9), Koftik, out.
        await gear(10);
        await vars(7, [...ORBS, ...BADGES, BIT.blood, BIT.dove, BIT.ashes, BIT.shadow]);
        await lab.give('ibandoll', 1);
        await lab.teleTo(...P.doveCage);
        const t0 = lab.tick();
        await lab.travel('dove cage -> disciples', P.disciples);
        await lab.fight('fight an Iban disciple (lvl 13, 20 hp)', /Iban disciple/, { food: /^Swordfish$/i });
        await L_sleep(1);
        await take('pick up a robe', /Robe of zamorak/i);
        await take('pick up the other robe', /Robe of zamorak/i).catch(() => undefined);
        await lab.act('unequip everything', async () => { for (const e of sdk.getEquipment()) { await bot.unequipItem(e); } }, () => sdk.getEquipment().length === 0);
        await lab.act('wear both robes', async () => { for (const r of sdk.getInventory().filter(i => /Robe of zamorak/i.test(i.name))) await bot.equipItem(r); }, () => sdk.getEquipment().length === 2);
        await lab.travel('-> temple doors', P.templeDoor);
        await lab.act('open the temple doors (%upass 8)', () => lab.clickLoc(3334, 2143, 4647, 1), () => lab.pos()[0] <= 2142);
        // a use sent during the doors' forced move (or Iban's bolt knock-back) answers "I can't reach that!": send again
        await lab.act('doll into the pit: Iban destroyed (%upass 9)', async () => {
            for (let k = 0; k < 10; k++) {
                const m0 = lab.log.length;
                await lab.useOnLoc(/doll/i, 3359, 2136, 4647);
                for (let i = 0; i < 4; i++) { await L_sleep(1); if (lab.since(m0).some(t => /throw the doll/i.test(t))) return; }
                if (!lab.since(m0).some(t => /can't reach/i.test(t))) { for (let i = 0; i < 6; i++) { await L_sleep(1); if (lab.since(m0).some(t => /throw the doll/i.test(t))) return; } }
            }
        }, () => lab.pos()[2] === 0, {}, 200);
        lab.record({ label: 'upass after the pit', ticks: 0, value: await lab.getVar('upass'), at: lab.pos(), hp: lab.hp() });
        await lab.travel('thrown from the temple -> Koftik', P.koftik5);
        await lab.talk('Koftik (leads you out)', /Koftik/);
        await L_sleep(3);
        await lab.travel('-> cave exit', P.exit);
        await lab.act('leave the pass', () => lab.clickLoc(3214, 2496, 9713, 1), () => lab.pos()[1] < 4000);
        lab.record({ label: 'TOTAL dove cage to outside the cave', ticks: lab.tick() - t0 });
    } else if (segment === 'handin') {
        await vars(9, []);
        await lab.teleTo(2578, 3294, 1);
        const agi0 = sdk.getSkillXp('agility');
        await lab.talk('King Lathas (hand-in, %upass 9)', /King Lathas/);
        await lab.idle(6);
        lab.record({ label: 'reward', ticks: 0, upass: await lab.getVar('upass'), agilityXpGained: (sdk.getSkillXp('agility') ?? 0) - (agi0 ?? 0) });
    } else if (segment === 'post') {
        await stats({ agility: AGILITY, thieving: THIEVING, ranged: 60, hitpoints: 99 });
        await lab.cheat('setvar upass 10');
        await lab.cheat('setvar regicide_quest 2');
        await lab.cheat(`setvar ibanmulti ${ibanmulti([BIT.started, BIT.orb1, BIT.orb2, BIT.orb3, BIT.orb4, BIT.badge1, BIT.badge2, BIT.badge3, BIT.horn, BIT.koftikInsane], GRID)}`);
        await clearInv();
        for (const [n, c] of [['shortbow', 1], ['bronze_arrow', 5], ['tinderbox', 1], ['rope', 1], ['spade', 1], ['swordfish', 5]] as const) await lab.give(n, c);
        await sdk.waitForTicks(2);
        await lab.equip(/^Shortbow$/i);
        for (const e of sdk.getEquipment()) if (/arrow/i.test(e.name)) await bot.unequipItem(e);
        await lab.teleTo(2434, 3313, 0);
        const t0 = lab.tick();
        await lab.travel('cave entrance -> Koftik at the bridge', [2448, 9716, 0]);
        await crossBridge();
        await lab.travel('bridge west bank -> grid east edge (rope swing)', P.gridEast);
        await grid(GRID);
        await lab.travel('portcullis -> Iban temple doors', P.templeDoor);
        await lab.act('temple doors (east side, %regicide_quest 2)', () => lab.clickLoc(3334, 2143, 4647, 1), () => lab.pos()[0] < 2100);
        lab.record({ label: 'TOTAL cave entrance click to through the temple doors', ticks: lab.tick() - t0, at: lab.pos() });
    } else {
        throw new Error(`unknown segment ${segment}`);
    }
    lab.report(segment);
}, { timeout: 3_600_000, printState: false });
