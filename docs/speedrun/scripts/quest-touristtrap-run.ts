// The Tourist Trap, played start to finish on a lab account in route order,
// with every segment timed in server ticks (stock lite client).
//
//   NODE_TICKRATE=300 BOTS=tt16 docs/speedrun/scripts/quest-digsite-lab-session.sh \
//       bun docs/speedrun/scripts/quest-touristtrap-run.ts tt16 [start|mine] [thieving] [melee]
//
// Setup (not timed): Smithing 20 and Fletching 10 (the enforced minimums),
// Thieving (default 25) for the slave's lock, melee (default 70/70/70 with a
// rune scimitar) for the Mercenary Captain, the quest varps reset, and the
// helper's one trade spawned with ::give: three full waterskins, a Shantay
// pass, desert shirt, robe and boots, two bronze bars, 30 feathers, a hammer
// and the scimitar. The glory teleport to Al Kharid is a ::tele to its landing
// tile, so add the measured 6 ticks (primitives.md section 4).
//
// `mine` starts at stage 16 (darts learned, pineapple in hand) inside the
// camp, in slave clothes, for the underground half.
//
// Prints SEG <json> per segment and SUMMARY <json> at the end.
import { runScript } from '../../../sdk/runner';
import { cheat, clearInv, give, QuestBot, tele, tick, waitUntil } from './quest-digsite-lab';

const FROM = process.argv[3] ?? 'start';
const THIEVING = parseInt(process.argv[4] ?? '25');
const MELEE = parseInt(process.argv[5] ?? '70');

await runScript(async ({ bot, sdk }) => {
    await sdk.waitForReady(60_000);
    await bot.skipTutorial();
    const q = new QuestBot(sdk, bot);
    const S = q.S;
    const p = () => sdk.getState()!.player!;
    const hp = () => sdk.getSkill('hitpoints')!.level;

    // ---------- setup, not timed ----------
    const statsSet: [string, number][] = [['hitpoints', MELEE], ['attack', MELEE], ['strength', MELEE], ['defence', MELEE], ['thieving', THIEVING], ['smithing', 20], ['fletching', 10], ['agility', 1]];
    for (const [s, l] of statsSet) await cheat(sdk, `setstat ${s} ${l}`);
    await cheat(sdk, 'setvar desertrescue_map_mechanisms 0');
    await clearInv(sdk);
    for (const slot of sdk.getEquipment()) await sdk.sendUseEquipmentItem(slot.slot, 1);
    await waitUntil(sdk, () => false, 3);
    const xp0 = sdk.getSkills().map(s => [s.name, s.experience] as const);

    // Rowdy Guards (level 43, huntmode cowardly, huntrange 1) attack a player
    // who passes next to them unless the player is too strong for them. If
    // one has, kill it and report the cost.
    const rowdy: { segment: string; ticks: number; hpLost: number }[] = [];
    const defend = async () => {
        const me = sdk.getState()!.player!;
        const hit = me.combat?.inCombat || (me.combat?.lastDamageTick ?? -1) >= tick(sdk) - 6;
        const g = sdk.getNearbyNpcs().filter(n => n.id === q.id(q.NPC, 'rowdymineguard') && n.distance <= 2)[0];
        if (!hit || !g) return false;
        const t0 = tick(sdk), hp0 = hp();
        while (sdk.getNearbyNpcs().some(n => n.index === g.index) && tick(sdk) - t0 < 400) {
            if (sdk.getState()!.dialog.isOpen) await q.settle(() => true, 10);
            const atk = sdk.getNearbyNpcs().find(n => n.index === g.index)?.optionsWithIndex.find(o => /attack/i.test(o.text));
            if (atk && !sdk.getState()!.player!.combat?.inCombat) await sdk.sendInteractNpc(g.index, atk.opIndex);
            await waitUntil(sdk, () => false, 3);
        }
        rowdy.push({ segment: S.cur?.name ?? '?', ticks: tick(sdk) - t0, hpLost: hp0 - hp() });
        console.log(`  rowdy guard fight in ${S.cur?.name}: ${tick(sdk) - t0} ticks`);
        S.mark();
        return true;
    };
    /** S.run, but if a Rowdy Guard interrupts, kill it and run `retry` (default fn). */
    const seg = (name: string, fn: () => Promise<void | string>, retry?: () => Promise<void | string>) =>
        S.run(name, async () => {
            try {
                const r = await fn();
                await defend();
                return r;
            } catch (e) {
                if (await defend()) return await (retry ?? fn)();
                throw e;
            }
        });

    let lockTries = 0, bars = 0, featherTries = 0, cartTries = 0, fightTicks = 0, fightHpLost = 0;

    if (FROM === 'start') {
        await cheat(sdk, 'setvar desertrescue 0');
        for (const [o, n] of [['water_skin4', 1], ['water_skin4', 1], ['water_skin4', 1], ['shantay_pass', 1], ['desert_shirt', 1], ['desert_robe', 1], ['desert_boots', 1], ['bronze_bar', 1], ['bronze_bar', 1], ['feather', 30], ['hammer', 1], ['rune_scimitar', 1]] as const) await give(sdk, o, n);
        await tele(sdk, 3293, 3163); // glory: Al Kharid landing, +6 ticks
    } else if (FROM === 'shabim') {
        // stage 10 (pineapple errand), just outside the camp gate, slave clothes carried
        await cheat(sdk, 'setvar desertrescue 10');
        for (const [o, n] of [['water_skin4', 1], ['water_skin4', 1], ['slave_shirt', 1], ['slave_robe', 1], ['slave_boots', 1], ['metal_key', 1], ['bronze_bar', 1], ['bronze_bar', 1], ['feather', 30], ['hammer', 1]] as const) await give(sdk, o, n);
        await tele(sdk, 3272, 3029);
    } else {
        await cheat(sdk, 'setvar desertrescue 16');
        for (const [o, n] of [['water_skin4', 1], ['water_skin4', 1], ['slave_shirt', 1], ['slave_robe', 1], ['slave_boots', 1], ['metal_key', 1], ['tentipineapple', 1]] as const) await give(sdk, o, n);
        await tele(sdk, 3301, 3034);
        for (const o of ['slave_shirt', 'slave_robe', 'slave_boots']) await q.invOp(o, /wear/i, () => q.worn(o));
    }
    const tStart = tick(sdk);

    if (FROM === 'start') {
        await seg('wear the desert clothes (3 clicks)', async () => {
            for (const o of ['desert_shirt', 'desert_robe', 'desert_boots']) await q.invOp(o, /wear/i, () => q.worn(o));
        });
        await seg('Al Kharid glory landing -> Shantay Pass (walk)', async () => {
            await q.walk(3302, 3118, 1);
        });
        await seg('Shantay Pass, first crossing (disclaimer)', async () => {
            await q.opLoc('shantay_pass_henge_doorway', 1, () => p().worldZ < 3116, { choices: [/poster doesn't scare me/] });
        });
        await seg('Irena: start the quest', async () => {
            await q.talk('irena', [/What's the matter/, /Is there a reward/, /Okay Irena, calm down/]);
        });
        await seg('Shantay Pass -> Mercenary Captain (walk)', async () => {
            await q.walk(3271, 3031, 2);
        });
        await seg('wield the scimitar', async () => {
            await q.invOp('rune_scimitar', /wield/i, () => q.worn('rune_scimitar'));
        });
        await seg('Mercenary Captain: provoke the duel', async () => {
            await q.talk('desertminingcaptain', [/Wow! A real captain/, /work for a tough guy/, /something for a strong Captain/, /don't think I can do that/, /funny captain/]);
        });
        await seg('fight the Mercenary Captain', async () => {
            const t0 = tick(sdk);
            const hp0 = hp();
            const capt = await q.npc('desertminingcaptain');
            const atk = capt.optionsWithIndex.find(o => /attack/i.test(o.text));
            if (atk) {
                S.action();
                await sdk.sendInteractNpc(capt.index, atk.opIndex);
            }
            await q.settle(() => !!q.inv('metal_key'), 600);
            fightTicks = tick(sdk) - t0;
            fightHpLost = hp0 - hp();
            return `${fightTicks} ticks, ${fightHpLost} hp lost`;
        });
        await seg('unwield the scimitar', async () => {
            await q.unequip('rune_scimitar');
        });
        await seg('camp gate: enter with the metal key', async () => {
            await q.opLoc('miningcampgateclosedl', 1, () => p().worldX > 3273);
        });
        await seg('gate -> slave (walk)', async () => {
            await q.walk(3301, 3031, 1);
        });
        const retry = /Yeah I'll give it another go|Yes, I'll trade|let's give it a go/;
        const slaveTalk = async (choices: RegExp[]) => {
            const r = await q.talk('mining_slave_male', [...choices, ...Array(12).fill(retry)], { allowUnused: true });
            lockTries += r.transcript.filter(t => /another go/.test(t)).length;
            console.log('  worn after the trade:', sdk.getEquipment().map(e => e.name).join(', '));
            if (!q.worn('slave_robe')) throw new Error('no slave clothes');
            return `${lockTries} lock retries`;
        };
        await seg('slave: talk, pick the lock, trade clothes',
            () => slaveTalk([/I've just arrived/, /that sounds interesting/, /What's that then/, /I can try to undo them/, /funny you should say that/, /let's give it a go/]),
            () => slaveTalk([]));
        await seg('slave -> mine doors (walk)', async () => {
            await q.walk(3301, 3033, 0);
        });
        await seg('mine doors: enter the mine', async () => {
            await q.opLoc('thttmineentrancel', 1, () => p().worldZ > 9000);
        });
        console.log('  worn after entering the mine:', sdk.getEquipment().map(e => e.name).join(', '), '| inv:', sdk.getInventory().map(i => i.name).join(', '));
        await seg('cave guard: ask for another area (pineapple errand)', async () => {
            await q.walk(3279, 9418, 1);
            await q.talk('desertminingmercenary2', [/mine in a different area/, /quite right sir/, /understand each other perfectly/]);
        });
        await seg('mine exit doors: back to the surface', async () => {
            await q.opLoc('thttmineexitl', 1, () => p().worldZ < 9000);
        });
        await seg('remove the slave clothes (3 clicks)', async () => {
            for (const o of ['slave_shirt', 'slave_robe', 'slave_boots']) await q.unequip(o);
        });
        await seg('mine doors -> camp gate (walk)', async () => {
            await q.walk(3274, 3029, 1);
        });
        await seg('camp gate: leave', async () => {
            await q.opLoc('miningcampgateclosedl', 1, () => p().worldX <= 3273);
        });
    }
    if (FROM === 'start' || FROM === 'shabim') {
        await seg('camp gate -> Al Shabim (walk)', async () => {
            await q.walk(3172, 3026, 2);
        });
        await seg('Al Shabim: pineapple errand, Bedabin key', async () => {
            await q.talk('al_shabim', [/looking for a pineapple/, /Yes, I'm interested/]);
            if (!q.inv('thbedobinkey')) throw new Error('no Bedabin key');
        });
        await seg('Al Shabim -> camp gate (walk)', async () => {
            await q.walk(3272, 3029, 1);
        });
        await seg('camp gate: enter', async () => {
            await q.opLoc('miningcampgateclosedl', 1, () => p().worldX > 3273);
        });
        await seg('gate -> Siad ladder (walk) and climb', async () => {
            await q.walk(3290, 3035, 1);
            await q.opLoc('ladder', 1, () => p().level === 1, { near: [3290, 3036] });
        });
        await seg('Siad: bookcase, sailing chat, chest (plans)', async () => {
            await q.opLoc('capt_siad_bookcase', 2, () => true, { dialog: true });
            await q.talk('capt_siad', [/I wanted to have a chat/, /a lot of books/, /interested in sailing/, /cut of your jib/]);
            await q.opLoc('captain_siads_chest_closed', 1, () => !!q.inv('thcaptplans'));
        });
        await seg('Siad: ladder down', async () => {
            await q.opLoc('laddertop', 1, () => p().level === 0, { near: [3290, 3036] });
        });
        await seg('ladder -> camp gate (walk)', async () => {
            await q.walk(3274, 3029, 1);
        });
        await seg('camp gate: leave', async () => {
            await q.opLoc('miningcampgateclosedl', 1, () => p().worldX <= 3273);
        });
        await seg('camp gate -> Al Shabim (walk)', async () => {
            await q.walk(3172, 3026, 2);
        });
        await seg('Al Shabim: show the plans', async () => {
            await q.useOnNpc('thcaptplans', 'al_shabim', () => true, [/Yes, I'm very interested/, /kind of curious/]);
        });
        await seg('tent guard: talk (plans in hand), enter the tent', async () => {
            // Talking walks you to the door and in (bedabin_nomad_guard.rs2:27-38);
            // using the plans on him only moves you one tile north.
            await q.walk(3170, 3043, 1);
            await q.talk('bedabin_guard');
            await q.settle(() => p().worldZ >= 3046, 20);
            // the guard's script ends with p_delay(3) after the teleport; a click inside it is lost
            await waitUntil(sdk, () => false, 4);
            S.mark();
        });
        await seg('anvil: forge the dart tip', async () => {
            while (!q.inv('thprotodarttip')) {
                if (!q.inv('bronze_bar')) throw new Error('out of bronze bars');
                bars++;
                const n = q.count('bronze_bar');
                await q.useOnLoc('bronze_bar', 'experimental_anvil', () => q.count('bronze_bar') < n && !sdk.getState()!.dialog.isOpen, { choices: [/Yes, I'd like to try/] });
                await q.settle(() => true, 5);
            }
            return `${bars} bars used`;
        });
        await seg('feathers on the tip: prototype dart', async () => {
            while (!q.inv('thprotodart')) {
                featherTries++;
                const f = q.count('feather');
                await q.useOnObj('feather', 'thprotodarttip', () => q.count('feather') < f || !!q.inv('thprotodart'));
                await q.settle(() => true, 8);
            }
            return `${featherTries} attempts`;
        });
        await seg('leave the tent', async () => {
            const z0 = p().worldZ;
            await q.opLoc('bedabin_tentdoor', 1, () => p().worldZ < z0);
        });
        await seg('Al Shabim: show the dart (pineapple)', async () => {
            await q.walk(3172, 3026, 2);
            await q.talk('al_shabim');
            if (!q.inv('tentipineapple')) throw new Error('no pineapple');
        });
        await seg('Al Shabim -> camp gate (walk)', async () => {
            await q.walk(3272, 3029, 1);
        });
        await seg('camp gate: enter', async () => {
            await q.opLoc('miningcampgateclosedl', 1, () => p().worldX > 3273);
        });
        await seg('wear the slave clothes (3 clicks)', async () => {
            for (const o of ['slave_shirt', 'slave_robe', 'slave_boots']) await q.invOp(o, /wear/i, () => q.worn(o));
        });
    }

    await seg('gate -> mine doors (walk)', async () => {
        await q.walk(3301, 3033, 0);
    });
    await seg('mine doors: enter the mine', async () => {
        await q.opLoc('thttmineentrancel', 1, () => p().worldZ > 9000);
    });
    await seg('cave guard: hand over the pineapple', async () => {
        await q.walk(3279, 9418, 1);
        await q.talk('desertminingmercenary2');
        if (q.inv('tentipineapple')) throw new Error('pineapple not taken');
    });
    await seg('cave passage east', async () => {
        await q.opLoc('thminecavel', 1, () => p().worldX >= 3285, { near: [3281, 9415] });
    });
    await seg('empty barrel by the lower mine cart', async () => {
        await q.opLoc('thminebarrel_empty', 2, () => !!q.inv('thminebarrel_empty'), { near: [3303, 9418], choices: [/Yeah, cool/] });
    });
    await seg('lower mine cart: ride to the deep mine', async () => {
        while (p().worldX < 3310) {
            cartTries++;
            const hp0 = hp();
            await q.opLoc('touristtrap_minecart', 2, () => p().worldX >= 3310 || hp() < hp0, { near: [3303, 9417], choices: [/Yes, of course/] });
            await q.settle(() => true, 5);
        }
        return `${cartTries} tries`;
    });
    await seg('mine cart -> Ana (walk)', async () => {
        await q.walk(3303, 9464, 2);
    });
    await seg('Ana: into the barrel', async () => {
        await q.useOnNpc('thminebarrel_empty', 'ana', () => !!q.inv('thanainabarrel'));
    });
    await seg('Ana -> upper mine cart (walk)', async () => {
        await q.walk(3318, 9431, 1);
    });
    await seg('upper mine cart: send Ana down', async () => {
        await q.useOnLoc('thanainabarrel', 'touristtrap_minecart', () => !q.inv('thanainabarrel') && !sdk.getState()!.dialog.isOpen, { near: [3318, 9430] });
        await waitUntil(sdk, () => sdk.getNewChat({ types: [0], includeSelf: true }).some(m => /returns/.test(m.text)), 10);
        S.mark();
    });
    let backTries = 0;
    await seg('upper mine cart: ride back', async () => {
        while (p().worldX > 3310) {
            backTries++;
            const hp0 = hp();
            await q.opLoc('touristtrap_minecart', 2, () => p().worldX <= 3310 || hp() < hp0, { near: [3318, 9430], choices: [/Yes, of course/] });
            await q.settle(() => true, 5);
        }
        cartTries += backTries;
        return `${backTries} tries`;
    });
    await seg('barrel by the lower cart: Ana', async () => {
        await q.opLoc('thminebarrel_empty', 2, () => !!q.inv('thanainabarrel'), { near: [3303, 9418] });
    });
    await seg('lift guard: Ana onto the lift', async () => {
        await q.useOnLoc('thanainabarrel', 'ropepullthingy2', () => !q.inv('thanainabarrel'), { choices: [/Yes please/, /very gregarious/] });
    });
    await seg('cave passage west', async () => {
        await q.opLoc('thminecaver', 1, () => p().worldX <= 3280, { near: [3283, 9415] });
    });
    await seg('mine exit doors: back to the surface', async () => {
        await q.walk(3278, 9424, 1);
        await q.opLoc('thttmineexitl', 1, () => p().worldZ < 9000);
    });
    await seg('mine doors -> surface winch (walk)', async () => {
        await q.walk(3280, 3018, 1);
    });
    await seg('surface winch: haul Ana up', async () => {
        await q.opLoc('ropepullthingy', 2, () => true, { dialog: true });
    });
    await seg('upper barrel: pick up Ana', async () => {
        await q.opLoc('thminebarrel_full', 2, () => !!q.inv('thanainabarrel'), { near: [3278, 3017] });
    });
    await seg('mine cart: load Ana', async () => {
        await q.useOnLoc('thanainabarrel', 'loc_2682', () => !q.inv('thanainabarrel'));
    });
    await seg('cart driver: talk him into leaving', async () => {
        await q.talk('mining_cart_driver', [/Nice cart/, /One wagon wheel/, /One good turn/, /shot perhaps/, /In for a penny/, /it's like this/, /Prison riot/, /You can't leave me here/]);
    });
    await seg('mine cart: ride out with Ana', async () => {
        await q.opLoc('loc_2682', 2, () => !!q.inv('thanainabarrel'), { choices: [/Yes, I'll get on/] });
    });
    await seg('cart drop -> Irena (walk)', async () => {
        await q.walk(3303, 3112, 1);
    });
    const agi0 = sdk.getSkill('agility')!.experience;
    await seg('Irena and Ana: rewards (Agility twice)', async () => {
        await q.talk('irena', [/^Agility/, /^Agility/]);
        await q.settle(() => sdk.getSkill('agility')!.experience >= agi0 + 2 * 116_250, 40);
    });

    const xp = Object.fromEntries(sdk.getSkills().map(s => [s.name, s.experience - (xp0.find(x => x[0] === s.name)?.[1] ?? 0)]).filter(([, v]) => (v as number) > 0));
    console.log('SUMMARY ' + JSON.stringify({ from: FROM, thieving: THIEVING, melee: MELEE, wallTicks: tick(sdk) - tStart, segmentTotal: S.total(), lockTries, bars, featherTries, cartTries, fightTicks, fightHpLost, hpLeft: hp(), gameXp: xp }, null, 2));
}, { timeout: 3_600_000 });
