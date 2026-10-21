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
        await L.setStats(sdk, { attack: att, strength: str, defence: def, hitpoints: hp, prayer: 1 });
        await L.cheat(sdk, 'setvar viking 1');
        await L.cheat(sdk, `setvar viking_bits ${THORVALD_STARTED}`);
        if (food > 0) await L.cheat(sdk, `give shark ${food}`, 2);
        await L.tele(sdk, 2667, 3693, 0);
        await sdk.waitForTicks(3);
        const out: Record<string, unknown> = { run };
        const ladder = (await sdk.scanNearbyLocs(5)).find(l => l.x === 2667 && l.z === 3694 && l.options.includes('Climb-down'));
        if (!ladder) throw new Error('Thorvald ladder not found');
        const t0 = L.tick(sdk);
        await bot.interactLoc(ladder, 'Climb-down');
        const down = await L.waitUntil(sdk, () => L.pos(sdk).z > 9000, 20);
        out.ladderDown = down === null ? null : down - t0;
        const spawned = await L.waitUntil(sdk, () => sdk.findNearbyNpc(/Koschei/) !== null, 90);
        out.spawnWait = spawned === null ? null : spawned - (down ?? t0);
        if (spawned === null) throw new Error('Koschei never spawned');

        const forms: number[] = [];
        let formStart = L.tick(sdk);
        let pages = 0;
        let levelUps = 0;
        let eaten = 0;
        let minHp = sdk.getState()!.player!.hp;
        let hpAtForm4: number | null = null;
        await bot.attack(sdk.findNearbyNpc(/Koschei/)!);
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
            if (s.dialog.isOpen) {
                if (L.isLevelUpDialog(sdk)) {
                    levelUps++;
                    await L.dismissLevelUps(sdk);
                } else {
                    // A defeat page ("It seems you have some idea of combat...").
                    forms.push(L.tick(sdk) - formStart);
                    formStart = L.tick(sdk);
                    const d = await L.talkThrough(sdk, [], { settleTicks: 1, maxTicks: 30 });
                    pages += d.pages;
                    if (forms.length === 3) hpAtForm4 = sdk.getState()!.player!.hp;
                }
                const k = sdk.findNearbyNpc(/Koschei/);
                if (k) await bot.attack(k);
                continue;
            }
            if (p.isDead) break;
            if (forms.length < 3 && p.hp < p.maxHp * 0.5 && sdk.countInventoryItems(/Shark/) > 0) {
                await bot.eatFood(/Shark/);
                eaten++;
                const k2 = sdk.findNearbyNpc(/Koschei/);
                if (k2) await bot.attack(k2);
                continue;
            }
            const k = sdk.findNearbyNpc(/Koschei/);
            if (k && !p.combat.inCombat && L.tick(sdk) % 5 === 0) await bot.attack(k);
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
