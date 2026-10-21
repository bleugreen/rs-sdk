// The Dig Site, played start to finish on a lab account in route order, with
// every segment timed in server ticks (stock lite client).
//
//   NODE_TICKRATE=300 BOTS=dig16 docs/speedrun/scripts/quest-digsite-lab-session.sh \
//       bun docs/speedrun/scripts/quest-digsite-run.ts dig16
//
// Setup (not timed): stats set to the quest's enforced minimums (Thieving 25,
// Herblore 10, Agility 10), the quest varps reset, and the helper's one trade
// (cup of tea, opal, two ropes, vial, charcoal, pestle and mortar, tinderbox)
// spawned with ::give. The Varrock teleport is a ::tele to the spell's landing
// tile, so add the measured 4 ticks (primitives.md section 4) for the cast.
// The random finds (pickpocket, panning, level 3 dig) are one draw each here;
// quest-digsite-finds.ts measures them per attempt.
//
// Prints SEG <json> per segment and SUMMARY <json> at the end.
import { runScript } from '../../../sdk/runner';
import { cheat, clearInv, give, QuestBot, stats, tele, tick, waitUntil } from './quest-digsite-lab';

// Answers that pass each exam once the students' errands are done (examiner.rs2).
const EXAM1 = [/Yes, I certainly am/, /The study of the earth, its contents, and history/, /All that have passed the appropriate/, /Gloves and boots to be worn/];
const EXAM2 = [/I am ready for the next exam/, /Samples taken in rough form/, /Finds must be carefully handled/, /Always handle with care/];
const EXAM3 = [/I am ready for the last exam/, /Samples cleaned, and carried only in specimen jars/, /Brush carefully and slowly/, /Handle bones very carefully/];

const KEEP = [
    'cup_of_tea', 'opal', 'rope', 'vial_empty', 'charcoal', 'pestle_and_mortar', 'tinderbox', 'coins',
    'digplainletter', 'recommendedletter', 'tray_empty', 'tray_mud', 'rock_sample1', 'rock_sample2', 'rock_sample3',
    'specimen_brush', 'specimen_jar', 'trowel', 'digtalisman', 'digexpertscroll', 'digchestkey', 'unidentified_powder',
    'unidentified_liquid', 'ammonium_nitrate', 'nitroglycerin', 'ground_charcoal', 'precharcoalmixture',
    'postcharcoalmixture', 'digcompound', 'arcenia_root', 'zarosstonetablet',
];

await runScript(async ({ bot, sdk }) => {
    await sdk.waitForReady(60_000);
    await bot.skipTutorial();
    const q = new QuestBot(sdk, bot);
    const S = q.S;

    // ---------- setup, not timed ----------
    for (const [s, l] of [['hitpoints', 99], ['thieving', 25], ['herblore', 10], ['agility', 10], ['magic', 25]] as const) await cheat(sdk, `setstat ${s} ${l}`);
    for (const v of ['itexamlevel', 'itexam_bits', 'itexam_errands']) await cheat(sdk, `setvar ${v} 0`);
    await clearInv(sdk);
    for (const [o, n] of [['cup_of_tea', 1], ['opal', 1], ['rope', 1], ['rope', 1], ['vial_empty', 1], ['charcoal', 1], ['pestle_and_mortar', 1], ['tinderbox', 1]] as const) await give(sdk, o, n);
    await tele(sdk, 3361, 3340);
    const xp0 = sdk.getSkills().map(s => [s.name, s.experience] as const);
    const tStart = tick(sdk);
    const p = () => sdk.getState()!.player!;
    let pans = 0, picks = 0, fails = 0, digs = 0;

    // `cave` (argv[3]) starts at the mine shaft permit (stage 6, talisman shown,
    // bit 7) with the items held at that point and the liquid already identified.
    const fromCave = process.argv[3] === 'cave';
    if (fromCave) {
        await cheat(sdk, 'setvar itexamlevel 6');
        await cheat(sdk, `setvar itexam_bits ${1 << 7}`);
        await clearInv(sdk);
        for (const o of ['rope', 'rope', 'nitroglycerin', 'charcoal', 'pestle_and_mortar', 'tinderbox', 'trowel', 'specimen_jar', 'specimen_brush']) await give(sdk, o, 1);
        await tele(sdk, 3370, 3427);
    }

    if (!fromCave) {
    await S.run('examiner: start the quest', async () => {
        await q.talk('examiner', [/Can I take an exam/]);
    });

    // Varrock teleport: add 4 ticks for the cast (not in this segment).
    await tele(sdk, 3213, 3424);
    await S.run('Varrock teleport landing -> curator (walk)', async () => {
        await q.walk(3257, 3446, 2);
    });
    await S.run('curator: stamp the letter', async () => {
        await q.talk('curator');
        if (!q.inv('recommendedletter')) throw new Error('no stamped letter');
    });
    await S.run('curator -> examiner (walk)', async () => {
        await q.walk(3361, 3340, 1);
    });
    await S.run('examiner: deliver the letter (forced first exam, failed)', async () => {
        await q.talk('examiner', [/./, /./, /./]);
    });
    await S.run('bush: rock sample 3', async () => {
        await q.opLoc('digsitebushsample', 1, () => !!q.inv('rock_sample3'));
    });
    await S.run('panning tray off the ground', async () => {
        await q.walk(3368, 3378, 3);
        await q.pickup('tray_empty');
    });
    await S.run('panning guide: give tea', async () => {
        await q.talk('panning_guide');
        if (q.inv('cup_of_tea')) throw new Error('tea not taken');
    });
    await S.run('pan until rock sample 2', async () => {
        while (!q.inv('rock_sample2')) {
            await q.makeRoom(KEEP);
            await q.opLoc('panning_point', 1, () => !!q.inv('tray_mud'), { near: [3376, 3372] });
            const tray = q.need('tray_mud');
            const op = tray.optionsWithIndex.find(o => /search/i.test(o.text))!;
            S.action();
            await sdk.sendUseItem(tray.slot, op.opIndex);
            await q.settle(() => !q.inv('tray_mud'), 30, [], true);
            pans++;
        }
        return `${pans} pans`;
    });
    await S.run('pickpocket workmen until rock sample 1 and a specimen brush', async () => {
        while (!(q.inv('rock_sample1') && q.inv('specimen_brush'))) {
            await q.makeRoom(KEEP);
            const w = await q.npc('digworkman1');
            const op = w.optionsWithIndex.find(o => /steal-from/i.test(o.text))!;
            const before = sdk.getInventory().map(i => `${i.id}x${i.count}`).join();
            const hp = sdk.getSkill('hitpoints')!.level;
            S.action();
            await sdk.sendInteractNpc(w.index, op.opIndex);
            const t0 = tick(sdk);
            await waitUntil(sdk, () => sdk.getInventory().map(i => `${i.id}x${i.count}`).join() !== before || sdk.getSkill('hitpoints')!.level < hp || sdk.getState()!.dialog.isOpen, 30);
            picks++;
            void t0;
            if (sdk.getSkill('hitpoints')!.level < hp) {
                fails++;
                // Stunned for 8 ticks from the failure (digsite_workman.rs2:79-80); the
                // hp drop is seen about a tick after it, and a click inside the stun is dropped.
                await waitUntil(sdk, () => false, 8);
            }
            await q.settle(() => true, 10);
        }
        return `${picks} attempts, ${fails} failed`;
    });
    await S.run('sacks: specimen jar', async () => {
        await q.opLoc('digsamplesacks', 1, () => !!q.inv('specimen_jar'), { near: [3359, 3398] });
    });
    await S.run('students: hand over the three rock samples', async () => {
        await q.useOnNpc('rock_sample1', 'student1', () => !q.inv('rock_sample1'));
        await q.useOnNpc('rock_sample2', 'student3', () => !q.inv('rock_sample2'));
        await q.useOnNpc('rock_sample3', 'student2', () => !q.inv('rock_sample3'));
    });
    await S.run('students -> examiner (walk)', async () => {
        await q.walk(3361, 3340, 1);
    });
    await S.run('examiner: exam 1', async () => {
        await q.talk('examiner', EXAM1);
        if (!q.inv('trowel')) throw new Error('exam 1 not passed');
    });
    await S.run('examiner -> barrel (walk)', async () => {
        await q.walk(3364, 3377, 1);
    });
    await S.run('barrel: open with trowel, fill vial', async () => {
        await q.useOnLoc('trowel', 'digbarrelclosed', () => true, { near: [3364, 3378], dialog: true });
        await q.useOnLoc('vial_empty', 'digbarrelclosed', () => !!q.inv('unidentified_liquid'), { near: [3364, 3378] });
    });
    await S.run('barrel -> students (walk)', async () => {
        await q.walk(3360, 3403, 2);
    });
    await S.run('students: exam 2 notes', async () => {
        await q.talk('student1');
        await q.talk('student3');
        await q.talk('student2');
    });
    await S.run('students -> examiner (walk)', async () => {
        await q.walk(3361, 3340, 1);
    });
    await S.run('examiner: exam 2', async () => {
        await q.talk('examiner', EXAM2);
    });
    await S.run('examiner -> students (walk)', async () => {
        await q.walk(3360, 3403, 2);
    });
    await S.run('students: exam 3 notes (student2 twice, for the opal)', async () => {
        await q.talk('student1');
        await q.talk('student3');
        await q.talk('student2');
        await q.talk('student2');
        if (q.inv('opal')) throw new Error('opal not taken');
    });
    await S.run('students -> examiner (walk)', async () => {
        await q.walk(3361, 3340, 1);
    });
    await S.run('examiner: exam 3', async () => {
        await q.talk('examiner', EXAM3);
    });
    await S.run('examiner -> level 3 site (walk)', async () => {
        await q.walk(3354, 3409, 1);
    });
    await S.run('dig the level 3 site until the Talisman of Zaros', async () => {
        while (!q.inv('digtalisman')) {
            await q.makeRoom(KEEP);
            const soil = (await sdk.scanNearbyLocs(8)).filter(l => /soil/i.test(l.name) && l.x >= 3350 && l.x <= 3357 && l.z >= 3404 && l.z <= 3412).sort((a, b) => a.distance - b.distance)[0];
            if (!soil) throw new Error('no level 3 soil');
            const n = sdk.getInventory().length;
            const coins = q.count('coins');
            S.action();
            await sdk.sendUseItemOnLoc(q.need('trowel').slot, soil.x, soil.z, soil.id);
            const ok = await waitUntil(sdk, () => sdk.getInventory().length !== n || q.count('coins') !== coins || sdk.getChat({ types: [0] }).slice(-1)[0]?.text === 'You find nothing.', 30);
            if (!ok) console.log('dig: no result seen');
            await q.settle(() => true, 10);
            digs++;
        }
        return `${digs} digs`;
    });
    await S.run('level 3 site -> expert (walk)', async () => {
        await q.walk(3356, 3334, 1);
    });
    await S.run('expert: talisman (invitation letter) and the liquid', async () => {
        await q.useOnNpc('digtalisman', 'archaeological_expert', () => !!q.inv('digexpertscroll'));
        await q.useOnNpc('unidentified_liquid', 'archaeological_expert', () => !!q.inv('nitroglycerin'));
    });
    await S.run('expert -> workman (walk)', async () => {
        await q.walk(3358, 3387, 2);
    });
    await S.run('workman: invitation letter (mine shaft permit)', async () => {
        await q.useOnNpc('digexpertscroll', 'digworkman1', () => !q.inv('digexpertscroll'));
    });
    await S.run('workman -> private winch (walk)', async () => {
        await q.walk(3370, 3427, 1);
    });
    }
    await S.run('private winch: tie rope, descend', async () => {
        const ropes = q.count('rope');
        await q.useOnLoc('rope', 'digwinch2', () => q.count('rope') < ropes);
        await q.opLoc('digwinch2', 1, () => p().worldZ > 9000);
    });
    await S.run('private cave: workman 2 chest key', async () => {
        await q.talk('digworkman2', [/invited to research/, /chest key/, /I don't suppose/, /^Please\?/, /Aww\.\.\. go on/, /^Pretty please!$/, /with sugar on top/]);
        if (!q.inv('digchestkey')) throw new Error('no chest key');
    });
    await S.run('private cave: arcenia root', async () => {
        await q.pickup('arcenia_root');
    });
    await S.run('private cave: ladder up', async () => {
        await q.opLoc('winchladder1', 1, () => p().worldZ < 9000);
    });
    await S.run('winch -> chest (walk)', async () => {
        await q.walk(3374, 3379, 1);
    });
    await S.run('chest: unlock, take the powder', async () => {
        await q.useOnLoc('digchestkey', 'digchestclosed', () => !q.inv('digchestkey'));
        await waitUntil(sdk, () => false, 1);
        await q.opLoc('digchestopen', 1, () => !!q.inv('unidentified_powder'), { near: [3374, 3378] });
    });
    await S.run('chest -> expert (walk)', async () => {
        await q.walk(3356, 3334, 1);
    });
    await S.run('expert: identify the powder', async () => {
        await q.useOnNpc('unidentified_powder', 'archaeological_expert', () => !!q.inv('ammonium_nitrate'));
    });
    await S.run('mix the compound (4 item-on-item uses)', async () => {
        await q.useOnObj('nitroglycerin', 'ammonium_nitrate', () => !!q.inv('precharcoalmixture'));
        await q.useOnObj('pestle_and_mortar', 'charcoal', () => !!q.inv('ground_charcoal'));
        await q.useOnObj('ground_charcoal', 'precharcoalmixture', () => !!q.inv('postcharcoalmixture'));
        await q.useOnObj('arcenia_root', 'postcharcoalmixture', () => !!q.inv('digcompound'));
    });
    await S.run('expert -> public winch (walk)', async () => {
        await q.walk(3352, 3418, 1);
    });
    await S.run('public winch: tie rope, descend', async () => {
        const ropes = q.count('rope');
        await q.useOnLoc('rope', 'digwinch1', () => q.count('rope') < ropes);
        await q.opLoc('digwinch1', 1, () => p().worldZ > 9000);
    });
    await S.run('bricks: pour the compound, light it, run', async () => {
        await q.walk(3379, 9826, 0);
        await q.useOnLoc('digcompound', 'digblastbrick', () => !q.inv('digcompound'));
        await q.useOnLoc('tinderbox', 'digblastbrick', () => p().worldZ < 9790 && p().worldZ > 9700);
    });
    await S.run('altar cave: pick up the stone tablet', async () => {
        await q.walk(3374, 9748, 1);
        await q.pickup('zarosstonetablet');
    });
    await S.run('altar cave: ladder up', async () => {
        await q.opLoc('winchladder2', 1, () => p().worldZ < 9000);
    });
    await S.run('winch -> expert (walk)', async () => {
        await q.walk(3356, 3334, 1);
    });
    const mining0 = sdk.getSkill('mining')!.experience;
    await S.run('expert: the tablet, quest complete', async () => {
        await q.useOnNpc('zarosstonetablet', 'archaeological_expert', () => sdk.getSkill('mining')!.experience > mining0 + 100_000);
    });

    const xp = Object.fromEntries(sdk.getSkills().map(s => [s.name, s.experience - (xp0.find(x => x[0] === s.name)?.[1] ?? 0)]).filter(([, v]) => (v as number) > 0));
    console.log('SUMMARY ' + JSON.stringify({ wallTicks: tick(sdk) - tStart, segmentTotal: S.total(), pans, picks, fails, digs, hpLeft: sdk.getSkill('hitpoints')!.level, gameXp: xp, segTicks: stats(S.list.map(s => s.ticks)) }, null, 2));
}, { timeout: 3_600_000 });
