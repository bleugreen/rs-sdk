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
// NPCs, locs and objs are addressed by config debug name, never by display
// name, because several quest NPCs share one (the three Students). A segment
// ends at the tick its last effect was seen (dialogue closed, item arrived).
//
// Prints a SEG line per segment, the segment table with a RESULT line, and
// SUMMARY <json> at the end. Each segment's `burst` is its dialogue ticks if
// every continue run went as one blind burst.
import { runScript } from '../../../sdk/runner';
import { act, dropItems, pickup, slotOf, talkTo, walkTo } from '../../../speedrun/lib/act';
import { burstTicks, converse, type ConverseResult } from '../../../speedrun/lib/converse';
import { currentTick, waitTicks, waitUntil, type Pred } from '../../../speedrun/lib/wait';
import { chebyshev, configId, findLoc, invCount, invItem, messagesSince, opIndex, pos, skillLevel, skillXp, stateOf, waitForNpc, type StateLike } from '../../../speedrun/lib/world';
import { clearInventory, give, mustTele, setStats, setvar } from '../../../speedrun/lab/setup';
import { Recorder, stats } from '../../../speedrun/lab/record';

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

const NPC = (k: string) => configId('npc', k);
const LOC = (k: string) => configId('loc', k);
const OBJ = (k: string) => configId('obj', k);

await runScript(async ({ bot, sdk }) => {
    await sdk.waitForReady(60_000);
    await bot.skipTutorial();
    const S = new Recorder(sdk, 'digsite-run');

    const has = (k: string, s: StateLike = sdk) => invItem(s, OBJ(k)) !== null;
    const stuck = (what: string) => new Error(`timed out in ${S.cur?.name}: ${what}; at ${JSON.stringify(pos(sdk))}; chat ${JSON.stringify(messagesSince(sdk, 0).slice(-4))}`);
    const dlg = (r: ConverseResult) => {
        S.dialogue(r);
        if (S.cur) S.cur.burst = Number(S.cur.burst ?? 0) + burstTicks(r.transcript);
        return r;
    };
    const npc = async (key: string) => {
        const n = await waitForNpc(sdk, NPC(key), 10);
        if (!n) throw new Error(`no ${key} in view at ${JSON.stringify(pos(sdk))}`);
        return n;
    };
    const loc = async (key: string, near?: [number, number]) => {
        const l = await findLoc(sdk, { id: LOC(key), radius: 40, ...(near ? { near: { x: near[0], z: near[1] } } : {}) });
        if (!l) throw new Error(`no ${key} in view at ${JSON.stringify(pos(sdk))}`);
        return l;
    };
    /**
     * One click, then any dialogue it opens, until `until` holds with none open.
     * `dialog`: the click's effect is a dialogue, so wait for it to open first.
     */
    const clickThen = async (what: string, click: () => Promise<unknown>, until: Pred, o: { dialog?: boolean; choices?: RegExp[]; maxTicks?: number } = {}) => {
        const maxTicks = o.maxTicks ?? 80;
        const t0 = currentTick(sdk);
        const a = await act(sdk, click, s => s.dialog.isOpen || (!o.dialog && until(s)), { maxTicks });
        S.interact(1 + a.resends);
        if (!a.ok) throw stuck(what);
        if (!sdk.getState()?.dialog.isOpen) return S.mark(t0 + a.ticks);
        const r = dlg(await converse(sdk, o.choices ?? [], { until, idle: 1, maxTicks }));
        if (!r.ok) throw stuck(`${what}: ${r.reason}`);
    };
    type LocOpts = { near?: [number, number]; dialog?: boolean; choices?: RegExp[] };
    const opLoc = async (key: string, op: number, until: Pred, o: LocOpts = {}) => {
        const l = await loc(key, o.near);
        await clickThen(`op ${op} on ${key}`, () => sdk.sendInteractLoc(l.x, l.z, l.id, op), until, o);
    };
    const useOnLoc = async (obj: string, key: string, until: Pred, o: LocOpts = {}) => {
        const l = await loc(key, o.near);
        const slot = slotOf(sdk, OBJ(obj));
        await clickThen(`${obj} on ${key}`, () => sdk.sendUseItemOnLoc(slot, l.x, l.z, l.id), until, o);
    };
    // Every hand-over opens the NPC's dialogue; it is run until `until` holds.
    const useOnNpc = async (obj: string, key: string, until: Pred = () => true, choices: RegExp[] = []) => {
        const n = await npc(key);
        const slot = slotOf(sdk, OBJ(obj));
        await clickThen(`${obj} on ${key}`, () => sdk.sendUseItemOnNpc(slot, n.index), until, { dialog: true, choices });
    };
    const useOnObj = async (src: string, dst: string, until: Pred) => {
        const a = slotOf(sdk, OBJ(src));
        const b = slotOf(sdk, OBJ(dst));
        await clickThen(`${src} on ${dst}`, () => sdk.sendUseItemOnItem(a, b), until, { maxTicks: 60 });
    };
    const talk = async (key: string, choices: RegExp[] = []) => {
        const r = await talkTo(sdk, NPC(key), choices, { openTicks: 60, idle: 2 });
        S.interact(r.clicks);
        if (!r.opened) throw new Error(`${key}: no dialogue opened`);
        dlg(r);
        if (!r.ok) throw stuck(`${key}: ${r.reason}`);
        if (r.remaining.length) throw new Error(`${key}: dialogue ended with unused choices ${r.remaining.join(', ')}`);
        return r;
    };
    const take = async (obj: string) => {
        const t0 = currentTick(sdk);
        const r = await pickup(sdk, OBJ(obj));
        S.interact(1 + r.resends);
        if (!r.ok) throw stuck(`pick up ${obj}`);
        S.mark(t0 + r.ticks);
    };
    /** Answer a dialogue left open (a pickpocket's or a dig's message box), then mark. */
    const settleOpen = async () => {
        if (sdk.getState()?.dialog.isOpen) dlg(await converse(sdk, [], { idle: 1 }));
        S.mark();
    };
    /** bot.walkTo, checked: walked again once, then throws if not within tolerance + 1. */
    const walk = async (x: number, z: number, tol = 1) => {
        for (let attempt = 0; attempt < 2; attempt++) {
            await walkTo(bot, sdk, x, z, tol);
            if (chebyshev(pos(sdk), { x, z }) <= tol + 1) return S.mark();
            console.log(`  walk to ${x},${z} ended at ${JSON.stringify(pos(sdk))}; retrying`);
        }
        throw new Error(`walk to ${x},${z} failed, at ${JSON.stringify(pos(sdk))}`);
    };
    const keepIds = new Set(KEEP.map(OBJ));
    /** Drop items not in KEEP until `free` slots are empty. */
    const makeRoom = async (free = 3) => {
        const inv = sdk.getState()?.inventory ?? [];
        let need = free - (28 - inv.length);
        if (need <= 0) return;
        if (inv.filter(i => !keepIds.has(i.id)).length < need) throw new Error('inventory full of kept items');
        S.interact(need);
        const r = await dropItems(sdk, i => !keepIds.has(i.id) && need-- > 0);
        if (!r.ok) throw stuck('make room');
    };

    // ---------- setup, not timed ----------
    await setStats(sdk, { hitpoints: 99, thieving: 25, herblore: 10, agility: 10, magic: 25 });
    for (const v of ['itexamlevel', 'itexam_bits', 'itexam_errands']) await setvar(sdk, v, 0);
    await clearInventory(sdk);
    await give(sdk, ['cup_of_tea', 'opal', 'rope', 'rope', 'vial_empty', 'charcoal', 'pestle_and_mortar', 'tinderbox']);
    await mustTele(sdk, 3361, 3340);
    const xp0 = sdk.getSkills().map(s => [s.name, s.experience] as const);
    const tStart = currentTick(sdk);
    let pans = 0, picks = 0, fails = 0, digs = 0;

    // `cave` (argv[3]) starts at the mine shaft permit (stage 6, talisman shown,
    // bit 7) with the items held at that point and the liquid already identified.
    const fromCave = process.argv[3] === 'cave';
    if (fromCave) {
        await setvar(sdk, 'itexamlevel', 6);
        await setvar(sdk, 'itexam_bits', 1 << 7);
        await clearInventory(sdk);
        await give(sdk, ['rope', 'rope', 'nitroglycerin', 'charcoal', 'pestle_and_mortar', 'tinderbox', 'trowel', 'specimen_jar', 'specimen_brush']);
        await mustTele(sdk, 3370, 3427);
    }

    if (!fromCave) {
    await S.seg('examiner: start the quest', async () => {
        await talk('examiner', [/Can I take an exam/]);
    });

    // Varrock teleport: add 4 ticks for the cast (not in this segment).
    await mustTele(sdk, 3213, 3424);
    await S.seg('Varrock teleport landing -> curator (walk)', async () => {
        await walk(3257, 3446, 2);
    });
    await S.seg('curator: stamp the letter', async () => {
        await talk('curator');
        if (!has('recommendedletter')) throw new Error('no stamped letter');
    });
    await S.seg('curator -> examiner (walk)', async () => {
        await walk(3361, 3340, 1);
    });
    await S.seg('examiner: deliver the letter (forced first exam, failed)', async () => {
        await talk('examiner', [/./, /./, /./]);
    });
    await S.seg('bush: rock sample 3', async () => {
        await opLoc('digsitebushsample', 1, s => has('rock_sample3', s));
    });
    await S.seg('panning tray off the ground', async () => {
        await walk(3368, 3378, 3);
        await take('tray_empty');
    });
    await S.seg('panning guide: give tea', async () => {
        await talk('panning_guide');
        if (has('cup_of_tea')) throw new Error('tea not taken');
    });
    await S.seg('pan until rock sample 2', async () => {
        while (!has('rock_sample2')) {
            await makeRoom();
            await opLoc('panning_point', 1, s => has('tray_mud', s), { near: [3376, 3372] });
            const tray = invItem(sdk, OBJ('tray_mud'));
            const op = tray ? opIndex(tray, /search/i) : undefined;
            if (!tray || op === undefined) throw new Error('no searchable tray of mud');
            await clickThen('search the tray', () => sdk.sendUseItem(tray.slot, op), s => !has('tray_mud', s), { dialog: true, maxTicks: 30 });
            pans++;
        }
        return `${pans} pans`;
    });
    await S.seg('pickpocket workmen until rock sample 1 and a specimen brush', async () => {
        const invKey = (s: StateLike) => (stateOf(s)?.inventory ?? []).map(i => `${i.id}x${i.count}`).join();
        while (!(has('rock_sample1') && has('specimen_brush'))) {
            await makeRoom();
            const w = await npc('digworkman1');
            const op = opIndex(w, /steal-from/i);
            if (op === undefined) throw new Error('the workman has no Steal-from option');
            const before = invKey(sdk);
            const hp = skillLevel(sdk, 'hitpoints');
            S.interact();
            await sdk.sendInteractNpc(w.index, op);
            await waitUntil(sdk, s => invKey(s) !== before || skillLevel(s, 'hitpoints') < hp || s.dialog.isOpen, { maxTicks: 30 });
            picks++;
            if (skillLevel(sdk, 'hitpoints') < hp) {
                fails++;
                // Stunned for 8 ticks from the failure (digsite_workman.rs2:79-80); the
                // hp drop is seen about a tick after it, and a click inside the stun is dropped.
                await waitTicks(sdk, 8);
            }
            await settleOpen();
        }
        return `${picks} attempts, ${fails} failed`;
    });
    await S.seg('sacks: specimen jar', async () => {
        await opLoc('digsamplesacks', 1, s => has('specimen_jar', s), { near: [3359, 3398] });
    });
    await S.seg('students: hand over the three rock samples', async () => {
        await useOnNpc('rock_sample1', 'student1', s => !has('rock_sample1', s));
        await useOnNpc('rock_sample2', 'student3', s => !has('rock_sample2', s));
        await useOnNpc('rock_sample3', 'student2', s => !has('rock_sample3', s));
    });
    await S.seg('students -> examiner (walk)', async () => {
        await walk(3361, 3340, 1);
    });
    await S.seg('examiner: exam 1', async () => {
        await talk('examiner', EXAM1);
        if (!has('trowel')) throw new Error('exam 1 not passed');
    });
    await S.seg('examiner -> barrel (walk)', async () => {
        await walk(3364, 3377, 1);
    });
    await S.seg('barrel: open with trowel, fill vial', async () => {
        await useOnLoc('trowel', 'digbarrelclosed', () => true, { near: [3364, 3378], dialog: true });
        await useOnLoc('vial_empty', 'digbarrelclosed', s => has('unidentified_liquid', s), { near: [3364, 3378] });
    });
    await S.seg('barrel -> students (walk)', async () => {
        await walk(3360, 3403, 2);
    });
    await S.seg('students: exam 2 notes', async () => {
        await talk('student1');
        await talk('student3');
        await talk('student2');
    });
    await S.seg('students -> examiner (walk)', async () => {
        await walk(3361, 3340, 1);
    });
    await S.seg('examiner: exam 2', async () => {
        await talk('examiner', EXAM2);
    });
    await S.seg('examiner -> students (walk)', async () => {
        await walk(3360, 3403, 2);
    });
    await S.seg('students: exam 3 notes (student2 twice, for the opal)', async () => {
        await talk('student1');
        await talk('student3');
        await talk('student2');
        await talk('student2');
        if (has('opal')) throw new Error('opal not taken');
    });
    await S.seg('students -> examiner (walk)', async () => {
        await walk(3361, 3340, 1);
    });
    await S.seg('examiner: exam 3', async () => {
        await talk('examiner', EXAM3);
    });
    await S.seg('examiner -> level 3 site (walk)', async () => {
        await walk(3354, 3409, 1);
    });
    await S.seg('dig the level 3 site until the Talisman of Zaros', async () => {
        while (!has('digtalisman')) {
            await makeRoom();
            const soil = (await sdk.scanNearbyLocs(8)).filter(l => /soil/i.test(l.name) && l.x >= 3350 && l.x <= 3357 && l.z >= 3404 && l.z <= 3412).sort((a, b) => a.distance - b.distance)[0];
            if (!soil) throw new Error('no level 3 soil');
            const t = currentTick(sdk);
            S.interact();
            await sdk.sendUseItemOnLoc(slotOf(sdk, OBJ('trowel')), soil.x, soil.z, soil.id);
            // every dig ends in "You find nothing." or "You carefully clean your find..." (area_digsite.rs2:441-507)
            const r = await waitUntil(sdk, s => messagesSince(s, t + 1, /^You find nothing|carefully clean your find/).length > 0, { maxTicks: 30 });
            await settleOpen();
            if (r.ok) digs++;
            else console.log('dig: no result seen');
        }
        return `${digs} digs`;
    });
    await S.seg('level 3 site -> expert (walk)', async () => {
        await walk(3356, 3334, 1);
    });
    await S.seg('expert: talisman (invitation letter) and the liquid', async () => {
        await useOnNpc('digtalisman', 'archaeological_expert', s => has('digexpertscroll', s));
        await useOnNpc('unidentified_liquid', 'archaeological_expert', s => has('nitroglycerin', s));
    });
    await S.seg('expert -> workman (walk)', async () => {
        await walk(3358, 3387, 2);
    });
    await S.seg('workman: invitation letter (mine shaft permit)', async () => {
        await useOnNpc('digexpertscroll', 'digworkman1', s => !has('digexpertscroll', s));
    });
    await S.seg('workman -> private winch (walk)', async () => {
        await walk(3370, 3427, 1);
    });
    }
    await S.seg('private winch: tie rope, descend', async () => {
        const ropes = invCount(sdk, OBJ('rope'));
        await useOnLoc('rope', 'digwinch2', s => invCount(s, OBJ('rope')) < ropes);
        await opLoc('digwinch2', 1, s => pos(s).z > 9000);
    });
    await S.seg('private cave: workman 2 chest key', async () => {
        await talk('digworkman2', [/invited to research/, /chest key/, /I don't suppose/, /^Please\?/, /Aww\.\.\. go on/, /^Pretty please!$/, /with sugar on top/]);
        if (!has('digchestkey')) throw new Error('no chest key');
    });
    await S.seg('private cave: arcenia root', async () => {
        await take('arcenia_root');
    });
    await S.seg('private cave: ladder up', async () => {
        await opLoc('winchladder1', 1, s => pos(s).z < 9000);
    });
    await S.seg('winch -> chest (walk)', async () => {
        await walk(3374, 3379, 1);
    });
    await S.seg('chest: unlock, take the powder', async () => {
        await useOnLoc('digchestkey', 'digchestclosed', s => !has('digchestkey', s));
        await waitTicks(sdk, 1);
        await opLoc('digchestopen', 1, s => has('unidentified_powder', s), { near: [3374, 3378] });
    });
    await S.seg('chest -> expert (walk)', async () => {
        await walk(3356, 3334, 1);
    });
    await S.seg('expert: identify the powder', async () => {
        await useOnNpc('unidentified_powder', 'archaeological_expert', s => has('ammonium_nitrate', s));
    });
    await S.seg('mix the compound (4 item-on-item uses)', async () => {
        await useOnObj('nitroglycerin', 'ammonium_nitrate', s => has('precharcoalmixture', s));
        await useOnObj('pestle_and_mortar', 'charcoal', s => has('ground_charcoal', s));
        await useOnObj('ground_charcoal', 'precharcoalmixture', s => has('postcharcoalmixture', s));
        await useOnObj('arcenia_root', 'postcharcoalmixture', s => has('digcompound', s));
    });
    await S.seg('expert -> public winch (walk)', async () => {
        await walk(3352, 3418, 1);
    });
    await S.seg('public winch: tie rope, descend', async () => {
        const ropes = invCount(sdk, OBJ('rope'));
        await useOnLoc('rope', 'digwinch1', s => invCount(s, OBJ('rope')) < ropes);
        await opLoc('digwinch1', 1, s => pos(s).z > 9000);
    });
    await S.seg('bricks: pour the compound, light it, run', async () => {
        await walk(3379, 9826, 0);
        await useOnLoc('digcompound', 'digblastbrick', s => !has('digcompound', s));
        await useOnLoc('tinderbox', 'digblastbrick', s => pos(s).z < 9790 && pos(s).z > 9700);
    });
    await S.seg('altar cave: pick up the stone tablet', async () => {
        await walk(3374, 9748, 1);
        await take('zarosstonetablet');
    });
    await S.seg('altar cave: ladder up', async () => {
        await opLoc('winchladder2', 1, s => pos(s).z < 9000);
    });
    await S.seg('winch -> expert (walk)', async () => {
        await walk(3356, 3334, 1);
    });
    const mining0 = skillXp(sdk, 'mining');
    await S.seg('expert: the tablet, quest complete', async () => {
        await useOnNpc('zarosstonetablet', 'archaeological_expert', s => skillXp(s, 'mining') > mining0 + 100_000);
    });

    S.report();
    const burst = S.segments.reduce((a, s) => a + Number(s.burst ?? 0), 0);
    const xp = Object.fromEntries(sdk.getSkills().map(s => [s.name, s.experience - (xp0.find(x => x[0] === s.name)?.[1] ?? 0)]).filter(([, v]) => (v as number) > 0));
    console.log('SUMMARY ' + JSON.stringify({ wallTicks: currentTick(sdk) - tStart, segmentTotal: { ...S.total(), burst }, pans, picks, fails, digs, hpLeft: skillLevel(sdk, 'hitpoints'), gameXp: xp, segTicks: stats(S.segments.map(s => s.ticks)) }, null, 2));
}, { timeout: 3_600_000 });
