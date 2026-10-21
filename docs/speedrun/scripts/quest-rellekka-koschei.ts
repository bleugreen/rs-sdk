// Fremennik Trials, Thorvald's warrior trial: from the Climb-down click on his
// ladder to the end of his congratulations after Koschei's fourth form "kills"
// you.
//
//   bun docs/speedrun/scripts/quest-rellekka-koschei.ts <bot> [att str def hp] [runs=N] [style=N]
//
// Read (viking_thorvald.rs2): the ladder needs no weapon or armour of any kind,
// in the inventory or worn (can_enter_thorvald_trial, line 435); food is allowed
// but not needed. Koschei spawns 20-70 ticks after you arrive
// (longqueue(spawn_viking_enemy, random_range(20, 70)), line 160). Forms 1-3
// (30, 50 and 70 hitpoints) must be beaten; each defeat heals him into the next
// form and opens one dialogue page. Form 4 (255 attack and defence, strength 5,
// attacks every tick) cannot be beaten: when one of its hits would leave you on
// exactly 0 hitpoints you "die honourably" (playerhit_n_melee_viking, line 391),
// which passes the trial, teleports you up beside Thorvald and opens his
// dialogue. So form 4 costs about your remaining hitpoints in ticks.
//
// Each run resets %viking to 1 and Thorvald's progress to started, fights
// unarmed in the given style (default 1, aggressive), and prints the phases.

import { runScript } from '../../../sdk/runner';
import * as L from './quest-arthur-lab';

const args = process.argv.slice(3).filter(a => !a.startsWith('-'));
const nums = args.filter(a => /^\d+$/.test(a)).map(Number);
const [att, str, def, hp] = [0, 1, 2, 3].map(i => nums[i] ?? 70);
const runs = Number(args.find(a => a.startsWith('runs='))?.slice(5) ?? 1);
const style = Number(args.find(a => a.startsWith('style='))?.slice(6) ?? 1);
// food=N gives N sharks (food is not on the trial's forbidden list) and eats one
// below half hitpoints during forms 1-3; never during form 4, which must kill you.
const food = Number(args.find(a => a.startsWith('food='))?.slice(5) ?? 0);
// eatAt=N eats at or below N hitpoints (default half). Forms 1-3 hit for at most
// about 3, 5 and 7 (npc_melee_maxhit at strength 20/40/60), so a low threshold
// carries few hitpoints into form 4, which then ends sooner.
const eatAtArg = args.find(a => a.startsWith('eatAt='));
// boost: drink a super attack and a super strength potion before the ladder.
// amulet=<obj>: wear it (amulets are not on the forbidden list).
// pray: Ultimate Strength and Incredible Reflexes during forms 1-3 (prayer is
// drained at the form 3 defeat anyway, viking_thorvald.rs2:297).
const boost = args.includes('boost');
const amulet = args.find(a => a.startsWith('amulet='))?.slice(7);
const pray = args.includes('pray');
// brew=N drinks N Zamorak brew doses during the forced wait before Koschei
// spawns. Each dose deals 12% of current hitpoints (never lethal) and drains
// Defence by 2 + 10% (consume_effects.dbrow zamorak_brew_effect,
// consume_effects.rs2:56-58), which shortens form 4.
const brew = Number(args.find(a => a.startsWith('brew='))?.slice(5) ?? 0);
// brew4=N drinks N doses instead as soon as form 4 starts (you do not need to
// attack form 4, so the drinks cost nothing and Defence stays up for forms 1-3).
const brew4 = Number(args.find(a => a.startsWith('brew4='))?.slice(6) ?? 0);

// %viking_bits: Thorvald's 2-bit field starts at bit 16 (quest_viking.constant:20).
const THORVALD_STARTED = 1 << 16;

await runScript(async ({ bot, sdk }) => {
    await bot.dismissBlockingUI();
    for (const e of sdk.getEquipment()) await bot.unequipItem(e.name);
    await sdk.waitForTicks(1);
    for (const item of sdk.getInventory()) await sdk.sendDropItem(item.slot);
    await sdk.waitForTicks(2);
    await sdk.sendSetCombatStyle(style);
    const all: unknown[] = [];
    process.on('exit', () => L.report(`Koschei ${att}/${str}/${def} ${hp}hp (partial=${all.length < runs})`, { runs: all }));

    for (let run = 0; run < runs; run++) {
        await L.setStats(sdk, { attack: att, strength: str, defence: def, hitpoints: hp, prayer: pray ? 99 : 1 });
        if (amulet && !sdk.getEquipment().some(e => e.name.toLowerCase().replace(/ /g, '_') === amulet)) {
            await L.cheat(sdk, `give ${amulet} 1`, 2);
            const a = sdk.getInventory().find(i => i.name.toLowerCase().replace(/ /g, '_') === amulet);
            if (a) await bot.equipItem(a);
        }
        if (boost) {
            for (const [obj, re] of [['3dose2attack', /Super attack/], ['3dose2strength', /Super strength/]] as const) {
                await L.cheat(sdk, `give ${obj} 1`, 2);
                const pot = sdk.findInventoryItem(re);
                if (pot) await sdk.sendUseItem(pot.slot, 1);
                await sdk.waitForTicks(3);
            }
            for (const v of sdk.getInventory().filter(i => /Vial|Super/.test(i.name))) await sdk.sendDropItem(v.slot);
            await sdk.waitForTicks(1);
        }
        await L.cheat(sdk, 'setvar viking 1');
        await L.cheat(sdk, `setvar viking_bits ${THORVALD_STARTED}`);
        if (food > 0) await L.cheat(sdk, `give shark ${food}`, 2);
        if (brew + brew4 > 0) await L.cheat(sdk, `give 4dosepotionofzamorak ${Math.ceil((brew + brew4) / 4)}`, 2);
        await L.tele(sdk, 2667, 3693, 0);
        await sdk.waitForTicks(3);
        const out: Record<string, unknown> = { run };
        const ladder = (await sdk.scanNearbyLocs(5)).find(l => l.x === 2667 && l.z === 3694 && l.options.includes('Climb-down'));
        if (!ladder) throw new Error('Thorvald ladder not found');
        const t0 = L.tick(sdk);
        await bot.interactLoc(ladder, 'Climb-down');
        const down = await L.waitUntil(sdk, () => L.pos(sdk).z > 9000, 20);
        out.ladderDown = down === null ? null : down - t0;
        let dosesDrunk = 0;
        while (dosesDrunk < brew && sdk.findNearbyNpc(/Koschei/) === null) {
            const pot = sdk.findInventoryItem(/Zamorak potion/i);
            if (!pot) break;
            await sdk.sendUseItem(pot.slot, 1);
            dosesDrunk++;
            await sdk.waitForTicks(3);
        }
        out.dosesDrunk = dosesDrunk;
        out.hpAfterBrew = sdk.getState()!.player!.hp;
        out.defAfterBrew = sdk.getSkill('Defence')?.level;
        const spawned = await L.waitUntil(sdk, () => sdk.findNearbyNpc(/Koschei/) !== null, 90);
        out.spawnWait = spawned === null ? null : spawned - (down ?? t0);
        if (spawned === null) throw new Error('Koschei never spawned');

        // The form is read from Koschei's npc type id (viking_enemy1..4 = 1290..1293,
        // npc.pack), not from his defeat pages: the SDK's eat action can dismiss a
        // defeat page, which would desynchronise a page count.
        const ENEMY1 = 1290;
        const formOf = () => {
            const k = sdk.getNearbyNpcs().find(n => n.id >= ENEMY1 && n.id <= ENEMY1 + 3);
            return k ? k.id - ENEMY1 + 1 : 0;
        };
        const forms: number[] = [];
        let form = formOf();
        let formStart = L.tick(sdk);
        let pages = 0;
        let levelUps = 0;
        let eaten = 0;
        let minHp = sdk.getState()!.player!.hp;
        let hpAtForm4: number | null = null;
        const eatAt = eatAtArg ? Number(eatAtArg.slice(6)) : Math.floor(hp / 2);
        if (pray) {
            await bot.activatePrayer('ultimate_strength');
            await bot.activatePrayer('incredible_reflexes');
        }
        out.boostedAtt = sdk.getSkill('Attack')?.level;
        out.boostedStr = sdk.getSkill('Strength')?.level;
        const koschei = () => sdk.getNearbyNpcs().find(n => n.id >= ENEMY1 && n.id <= ENEMY1 + 3) ?? null;
        await bot.attack(koschei()!);
        let done = false;
        while (L.tick(sdk) - t0 < 2000) {
            const s = sdk.getState()!;
            const p = s.player!;
            minHp = Math.min(minHp, p.hp);
            if (p.level === 1 && p.worldZ < 4000) {
                // Honour death: teleported up beside Thorvald, whose dialogue follows.
                forms.push(L.tick(sdk) - formStart);
                const d = await L.talkThrough(sdk, [], { settleTicks: 2 });
                pages += d.pages;
                done = true;
                break;
            }
            if (p.isDead) break;
            const f = formOf();
            if (f > form) {
                forms.push(L.tick(sdk) - formStart);
                formStart = L.tick(sdk);
                form = f;
                if (form === 4) {
                    hpAtForm4 = p.hp;
                    let n = 0;
                    while (n < brew4 && sdk.getState()!.player!.level === 2) {
                        if (s.dialog.isOpen) await sdk.clickDialogByText(/continue/i).catch(() => sdk.sendClickDialog(0));
                        const pot = sdk.findInventoryItem(/Zamorak potion/i);
                        if (!pot) break;
                        await sdk.sendUseItem(pot.slot, 1);
                        n++;
                        await sdk.waitForTicks(2);
                    }
                    out.form4Doses = n;
                    out.hpAfterForm4Brew = sdk.getState()!.player!.hp;
                }
            }
            if (s.dialog.isOpen) {
                if (L.isLevelUpDialog(sdk)) {
                    levelUps++;
                    await L.dismissLevelUps(sdk);
                } else {
                    const d = await L.talkThrough(sdk, [], { settleTicks: 1, maxTicks: 30 });
                    pages += d.pages;
                }
                const k = koschei();
                if (k && form < 4) await bot.attack(k);
                continue;
            }
            if (form < 4 && p.hp <= eatAt && sdk.countInventoryItems(/Shark/) > 0) {
                await bot.eatFood(/Shark/);
                eaten++;
                const k2 = koschei();
                if (k2) await bot.attack(k2);
                continue;
            }
            const k = koschei();
            if (k && form < 4 && (!p.combat.inCombat || p.combat.targetIndex !== k.index) && L.tick(sdk) % 3 === 0) await bot.attack(k);
            await sdk.waitForStateUpdate();
        }
        Object.assign(out, {
            total: L.tick(sdk) - t0,
            forms,
            pages,
            levelUps,
            eaten,
            died: sdk.getState()!.player!.isDead || L.pos(sdk).z < 3400,
            minHp,
            hpAtForm4,
            done,
            viking: await L.getVar(sdk, 'viking'),
            sword: sdk.countInventoryItems(/Fremennik blade|sword/i)
        });
        console.log('run', JSON.stringify(out));
        all.push(out);
        for (const item of sdk.getInventory()) await sdk.sendDropItem(item.slot);
        await sdk.waitForTicks(2);
    }
}, { timeout: 3_600_000, printState: false });
