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
// NPCs, locs and objs are addressed by config debug name. A segment ends at
// the tick its last effect was seen (dialogue closed, item arrived).
//
// Prints a SEG line per segment, the segment table with a RESULT line, and
// SUMMARY <json> at the end. Each segment's `burst` is its dialogue ticks if
// every continue run went as one blind burst.
import { runScript } from '../../../sdk/runner';
import { act, pickup, slotOf, talkTo, walkTo, wield } from '../../../speedrun/lib/act';
import { fight, prayerActive } from '../../../speedrun/lib/combat';
import { burstTicks, converse, type ConverseResult } from '../../../speedrun/lib/converse';
import { currentTick, waitTicks, waitUntil, type Pred } from '../../../speedrun/lib/wait';
import { chebyshev, configId, findLoc, findNpc, invCount, invItem, messagesSince, opIndex, pos, skillLevel, skillXp, waitForNpc, worn, type StateLike } from '../../../speedrun/lib/world';
import { clearInventory, give, mustTele, setStats, setvar } from '../../../speedrun/lab/setup';
import { Recorder } from '../../../speedrun/lab/record';

const FROM = process.argv[3] ?? 'start';
const THIEVING = parseInt(process.argv[4] ?? '25');
const MELEE = parseInt(process.argv[5] ?? '70');
// `pray` (argv[6]): Prayer 43, and Protect from Melee switched on whenever a Rowdy Guard attacks
const PRAY = process.argv[6] === 'pray';

const NPC = (k: string) => configId('npc', k);
const LOC = (k: string) => configId('loc', k);
const OBJ = (k: string) => configId('obj', k);

await runScript(async ({ bot, sdk }) => {
    await sdk.waitForReady(60_000);
    await bot.skipTutorial();
    const S = new Recorder(sdk, 'touristtrap-run');
    const hp = () => skillLevel(sdk, 'hitpoints');

    const has = (k: string, s: StateLike = sdk) => invItem(s, OBJ(k)) !== null;
    const isWorn = (k: string, s: StateLike = sdk) => worn(s, OBJ(k)) !== null;
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
    /** Talk and answer; `until`: the conversation is over only once it holds too (a scene that closes the chat mid-way). */
    const talk = async (key: string, choices: RegExp[] = [], o: { allowUnused?: boolean; until?: Pred } = {}) => {
        const r = await talkTo(sdk, NPC(key), choices, { openTicks: 60, idle: 2, ...(o.until ? { until: o.until } : {}) });
        S.interact(r.clicks);
        if (!r.opened) throw new Error(`${key}: no dialogue opened`);
        dlg(r);
        if (!r.ok) throw stuck(`${key}: ${r.reason}`);
        if (r.remaining.length && !o.allowUnused) throw new Error(`${key}: dialogue ended with unused choices ${r.remaining.join(', ')}`);
        return r;
    };
    const wear = async (key: string) => {
        if (isWorn(key)) return;
        const t0 = currentTick(sdk);
        const a = await wield(sdk, OBJ(key), { maxTicks: 20 });
        S.interact(1 + a.resends);
        if (!a.ok) throw stuck(`wear ${key}`);
        S.mark(t0 + a.ticks);
    };
    const unequip = async (key: string) => {
        const e = worn(sdk, OBJ(key));
        if (!e) throw new Error(`${key} not worn`);
        const t0 = currentTick(sdk);
        const a = await act(sdk, () => sdk.sendUseEquipmentItem(e.slot, opIndex(e, /remove/i) ?? 1), s => !isWorn(key, s), { maxTicks: 20 });
        S.interact(1 + a.resends);
        if (!a.ok) throw stuck(`remove ${key}`);
        S.mark(t0 + a.ticks);
    };
    /** Answer a dialogue left open, then mark. */
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

    // ---------- setup, not timed ----------
    const statsSet: Record<string, number> = { hitpoints: MELEE, attack: MELEE, strength: MELEE, defence: MELEE, thieving: THIEVING, smithing: 20, fletching: 10, agility: 1 };
    if (PRAY) statsSet.prayer = 43;
    await setStats(sdk, statsSet);
    await setvar(sdk, 'desertrescue_map_mechanisms', 0);
    await clearInventory(sdk);
    const xp0 = sdk.getSkills().map(s => [s.name, s.experience] as const);

    // Rowdy Guards (level 43, huntmode cowardly, huntrange 1) attack a player
    // who passes next to them unless the player is too strong for them. If
    // one has, kill it and report the cost.
    const rowdy: { segment: string; ticks: number; hpLost: number; prayerUsed: number }[] = [];
    const prayerPts = () => sdk.getPrayerState()?.prayerPoints ?? 0;
    const defend = async () => {
        const s = sdk.getState();
        const me = s?.player;
        if (!s || !me) return false;
        const hit = me.combat?.inCombat || (me.combat?.lastDamageTick ?? -1) >= s.tick - 6;
        const g = findNpc(s, NPC('rowdymineguard'));
        if (!hit || !g || g.distance > 2) return false;
        const hp0 = hp();
        if (PRAY) S.interact(); // the prayer toggle
        const f = await fight(sdk, g, { maxTicks: 400, onDialog: 'continue', ...(PRAY ? { prayer: 'protect_from_melee' as const } : {}) });
        S.interact(f.attacks);
        const after = sdk.getState();
        if (PRAY && after && prayerActive(after, 'protect_from_melee')) {
            S.interact();
            await sdk.sendTogglePrayer('protect_from_melee');
        }
        rowdy.push({ segment: S.cur?.name ?? '?', ticks: f.ticks, hpLost: hp0 - hp(), prayerUsed: f.prayerUsed });
        console.log(`  rowdy guard fight in ${S.cur?.name}: ${f.ticks} ticks (${f.end}), ${hp0 - hp()} hp, ${f.prayerUsed} prayer`);
        S.mark();
        return true;
    };
    /** S.seg, but if a Rowdy Guard interrupts, kill it and run `retry` (default fn). */
    const seg = (name: string, fn: () => Promise<void | string>, retry?: () => Promise<void | string>) =>
        S.seg(name, async () => {
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
        await setvar(sdk, 'desertrescue', 0);
        await give(sdk, ['water_skin4', 'water_skin4', 'water_skin4', 'shantay_pass', 'desert_shirt', 'desert_robe', 'desert_boots', 'hammer', 'rune_scimitar']);
        await give(sdk, 'bronze_bar', 6);
        await give(sdk, 'feather', 80);
        await mustTele(sdk, 3293, 3163); // glory: Al Kharid landing, +6 ticks
    } else if (FROM === 'shabim') {
        // stage 10 (pineapple errand), just outside the camp gate, slave clothes carried
        await setvar(sdk, 'desertrescue', 10);
        await give(sdk, ['water_skin4', 'water_skin4', 'slave_shirt', 'slave_robe', 'slave_boots', 'metal_key', 'hammer']);
        await give(sdk, 'bronze_bar', 6);
        await give(sdk, 'feather', 80);
        await mustTele(sdk, 3272, 3029);
    } else {
        await setvar(sdk, 'desertrescue', 16);
        await give(sdk, ['water_skin4', 'water_skin4', 'slave_shirt', 'slave_robe', 'slave_boots', 'metal_key', 'tentipineapple']);
        await mustTele(sdk, 3301, 3034);
        for (const o of ['slave_shirt', 'slave_robe', 'slave_boots']) await wear(o);
    }
    const tStart = currentTick(sdk);

    if (FROM === 'start') {
        await seg('wear the desert clothes (3 clicks)', async () => {
            for (const o of ['desert_shirt', 'desert_robe', 'desert_boots']) await wear(o);
        });
        await seg('Al Kharid glory landing -> Shantay Pass (walk)', async () => {
            await walk(3302, 3118, 1);
        });
        await seg('Shantay Pass, first crossing (disclaimer)', async () => {
            await opLoc('shantay_pass_henge_doorway', 1, s => pos(s).z < 3116, { choices: [/poster doesn't scare me/] });
        });
        await seg('Irena: start the quest', async () => {
            await talk('irena', [/What's the matter/, /Is there a reward/, /Okay Irena, calm down/]);
        });
        await seg('Shantay Pass -> Mercenary Captain (walk)', async () => {
            await walk(3271, 3031, 2);
        });
        await seg('wield the scimitar', async () => {
            await wear('rune_scimitar');
        });
        await seg('Mercenary Captain: provoke the duel', async () => {
            await talk('desertminingcaptain', [/Wow! A real captain/, /work for a tough guy/, /something for a strong Captain/, /don't think I can do that/, /funny captain/]);
        });
        await seg('fight the Mercenary Captain', async () => {
            const t0 = currentTick(sdk);
            const hp0 = hp();
            const keyHeld = (s: StateLike) => has('metal_key', s);
            const capt = await npc('desertminingcaptain');
            const f = await fight(sdk, capt, { maxTicks: 600, done: keyHeld });
            S.interact(f.attacks);
            if (!f.ok) throw new Error(`Mercenary Captain fight ended: ${f.end}`);
            // He drops the key with an objbox (mercenary_captain.rs2:215-216).
            let end = t0 + f.ticks;
            const r = dlg(await converse(sdk, [], { until: keyHeld, idle: 1, openTicks: 10, maxTicks: 100 }));
            if (r.opened) end = r.endTick;
            if (!keyHeld(sdk)) throw new Error(`no metal key after the fight (${f.end})`);
            S.mark(end);
            fightTicks = end - t0;
            fightHpLost = hp0 - hp();
            return `${fightTicks} ticks, ${fightHpLost} hp lost`;
        });
        await seg('unwield the scimitar', async () => {
            await unequip('rune_scimitar');
        });
        await seg('camp gate: enter with the metal key', async () => {
            await opLoc('miningcampgateclosedl', 1, s => pos(s).x > 3273);
        });
        await seg('gate -> slave (walk)', async () => {
            await walk(3301, 3031, 1);
        });
        const retry = /Yeah I'll give it another go|Yes, I'll trade|let's give it a go/;
        const slaveTalk = async (choices: RegExp[]) => {
            const r = await talk('mining_slave_male', [...choices, ...Array<RegExp>(12).fill(retry)], { allowUnused: true });
            // option clicks only: the failure's message box also says "another go"
            lockTries += r.transcript.filter(t => /^\[\d+\] > .*another go/.test(t)).length;
            console.log('  worn after the trade:', sdk.getEquipment().map(e => e.name).join(', '));
            if (!isWorn('slave_robe')) throw new Error('no slave clothes');
            return `${lockTries} lock retries`;
        };
        await seg('slave: talk, pick the lock, trade clothes',
            () => slaveTalk([/I've just arrived/, /that sounds interesting/, /What's that then/, /I can try to undo them/, /funny you should say that/, /let's give it a go/]),
            () => slaveTalk([]));
        await seg('slave -> mine doors (walk)', async () => {
            await walk(3301, 3033, 0);
        });
        await seg('mine doors: enter the mine', async () => {
            await opLoc('thttmineentrancel', 1, s => pos(s).z > 9000);
        });
        console.log('  worn after entering the mine:', sdk.getEquipment().map(e => e.name).join(', '), '| inv:', sdk.getInventory().map(i => i.name).join(', '));
        await seg('cave guard: ask for another area (pineapple errand)', async () => {
            await walk(3279, 9418, 1);
            await talk('desertminingmercenary2', [/mine in a different area/, /quite right sir/, /understand each other perfectly/]);
        });
        await seg('mine exit doors: back to the surface', async () => {
            await opLoc('thttmineexitl', 1, s => pos(s).z < 9000);
        });
        await seg('remove the slave clothes (3 clicks)', async () => {
            for (const o of ['slave_shirt', 'slave_robe', 'slave_boots']) await unequip(o);
        });
        await seg('mine doors -> camp gate (walk)', async () => {
            await walk(3274, 3029, 1);
        });
        await seg('camp gate: leave', async () => {
            await opLoc('miningcampgateclosedl', 1, s => pos(s).x <= 3273);
        });
    }
    if (FROM === 'start' || FROM === 'shabim') {
        await seg('camp gate -> Al Shabim (walk)', async () => {
            await walk(3172, 3026, 2);
        });
        await seg('Al Shabim: pineapple errand, Bedabin key', async () => {
            await talk('al_shabim', [/looking for a pineapple/, /Yes, I'm interested/]);
            if (!has('thbedobinkey')) throw new Error('no Bedabin key');
        });
        await seg('Al Shabim -> camp gate (walk)', async () => {
            await walk(3272, 3029, 1);
        });
        await seg('camp gate: enter', async () => {
            await opLoc('miningcampgateclosedl', 1, s => pos(s).x > 3273);
        });
        await seg('gate -> Siad ladder (walk) and climb', async () => {
            await walk(3290, 3035, 1);
            await opLoc('ladder', 1, s => pos(s).level === 1, { near: [3290, 3036] });
        });
        await seg('Siad: bookcase, sailing chat, chest (plans)', async () => {
            await opLoc('capt_siad_bookcase', 2, () => true, { dialog: true });
            await talk('capt_siad', [/I wanted to have a chat/, /a lot of books/, /interested in sailing/, /cut of your jib/]);
            await opLoc('captain_siads_chest_closed', 1, s => has('thcaptplans', s));
        });
        await seg('Siad: ladder down', async () => {
            await opLoc('laddertop', 1, s => pos(s).level === 0, { near: [3290, 3036] });
        });
        await seg('ladder -> camp gate (walk)', async () => {
            await walk(3274, 3029, 1);
        });
        await seg('camp gate: leave', async () => {
            await opLoc('miningcampgateclosedl', 1, s => pos(s).x <= 3273);
        });
        await seg('camp gate -> Al Shabim (walk)', async () => {
            await walk(3172, 3026, 2);
        });
        await seg('Al Shabim: show the plans', async () => {
            await useOnNpc('thcaptplans', 'al_shabim', () => true, [/Yes, I'm very interested/, /kind of curious/]);
        });
        await seg('tent guard: talk (plans in hand), enter the tent', async () => {
            // Talking walks you to the door and in (bedabin_nomad_guard.rs2:27-38);
            // using the plans on him only moves you one tile north.
            await walk(3170, 3043, 1);
            await talk('bedabin_guard', [], { until: s => pos(s).z >= 3046 });
            // the guard's script ends with p_delay(3) after the teleport; a click inside it is lost
            await waitTicks(sdk, 4);
            S.mark();
        });
        await seg('anvil: forge the dart tip', async () => {
            while (!has('thprotodarttip')) {
                if (!has('bronze_bar')) throw new Error('out of bronze bars');
                bars++;
                // The bar is deleted at the start of the forge (quest_desertrescue.rs2:612), so
                // wait for the outcome: the tip, or the waste message.
                const t = currentTick(sdk);
                const outcome = (s: StateLike) => messagesSince(s, t + 1, /waste the bronze bar/).length > 0 || has('thprotodarttip', s);
                await useOnLoc('bronze_bar', 'experimental_anvil', outcome, { choices: [/Yes, I'd like to try/] });
                await settleOpen();
            }
            return `${bars} bars used`;
        });
        await seg('feathers on the tip: prototype dart', async () => {
            while (!has('thprotodart')) {
                featherTries++;
                const f = invCount(sdk, OBJ('feather'));
                await useOnObj('feather', 'thprotodarttip', s => invCount(s, OBJ('feather')) < f || has('thprotodart', s));
                await settleOpen();
            }
            return `${featherTries} attempts`;
        });
        await seg('leave the tent', async () => {
            const z0 = pos(sdk).z;
            await opLoc('bedabin_tentdoor', 1, s => pos(s).z < z0);
        });
        await seg('Al Shabim: show the dart (pineapple)', async () => {
            await walk(3172, 3026, 2);
            // the scene closes the dialogue for a p_delay(2) mid-way (al_shabim.rs2:53-55)
            await talk('al_shabim', [], { until: s => has('tentipineapple', s) });
        });
        await seg('Al Shabim -> camp gate (walk)', async () => {
            await walk(3272, 3029, 1);
        });
        await seg('camp gate: enter', async () => {
            await opLoc('miningcampgateclosedl', 1, s => pos(s).x > 3273);
        });
        await seg('wear the slave clothes (3 clicks)', async () => {
            for (const o of ['slave_shirt', 'slave_robe', 'slave_boots']) await wear(o);
        });
    }

    await seg('gate -> mine doors (walk)', async () => {
        await walk(3301, 3033, 0);
    });
    await seg('mine doors: enter the mine', async () => {
        await opLoc('thttmineentrancel', 1, s => pos(s).z > 9000);
    });
    await seg('cave guard: hand over the pineapple', async () => {
        await walk(3279, 9418, 1);
        await talk('desertminingmercenary2');
        if (has('tentipineapple')) throw new Error('pineapple not taken');
    });
    await seg('cave passage east', async () => {
        await opLoc('thminecavel', 1, s => pos(s).x >= 3285, { near: [3281, 9415] });
    });
    await seg('empty barrel by the lower mine cart', async () => {
        await opLoc('thminebarrel_empty', 2, s => has('thminebarrel_empty', s), { near: [3303, 9418], choices: [/Yeah, cool/] });
    });
    await seg('lower mine cart: ride to the deep mine', async () => {
        while (pos(sdk).x < 3310) {
            cartTries++;
            const hp0 = hp();
            await opLoc('touristtrap_minecart', 2, s => pos(s).x >= 3310 || skillLevel(s, 'hitpoints') < hp0, { near: [3303, 9417], choices: [/Yes, of course/] });
            await settleOpen();
        }
        return `${cartTries} tries`;
    });
    await seg('mine cart -> Ana (walk)', async () => {
        await walk(3303, 9464, 2);
    });
    await seg('Ana: into the barrel', async () => {
        await useOnNpc('thminebarrel_empty', 'ana', s => has('thanainabarrel', s));
    });
    await seg('Ana -> upper mine cart (walk)', async () => {
        await walk(3318, 9431, 1);
    });
    await seg('upper mine cart: send Ana down', async () => {
        const t = currentTick(sdk);
        await useOnLoc('thanainabarrel', 'touristtrap_minecart', s => !has('thanainabarrel', s) && !s.dialog.isOpen, { near: [3318, 9430] });
        const w = await waitUntil(sdk, s => messagesSince(s, t, /returns/).length > 0, { maxTicks: 10 });
        S.mark(w.tick);
    });
    let backTries = 0;
    await seg('upper mine cart: ride back', async () => {
        while (pos(sdk).x > 3310) {
            backTries++;
            const hp0 = hp();
            await opLoc('touristtrap_minecart', 2, s => pos(s).x <= 3310 || skillLevel(s, 'hitpoints') < hp0, { near: [3318, 9430], choices: [/Yes, of course/] });
            await settleOpen();
        }
        cartTries += backTries;
        return `${backTries} tries`;
    });
    await seg('barrel by the lower cart: Ana', async () => {
        await opLoc('thminebarrel_empty', 2, s => has('thanainabarrel', s), { near: [3303, 9418] });
    });
    await seg('lift guard: Ana onto the lift', async () => {
        await useOnLoc('thanainabarrel', 'ropepullthingy2', s => !has('thanainabarrel', s), { choices: [/Yes please/, /very gregarious/] });
    });
    await seg('cave passage west', async () => {
        await opLoc('thminecaver', 1, s => pos(s).x <= 3280, { near: [3283, 9415] });
    });
    await seg('mine exit doors: back to the surface', async () => {
        await opLoc('thttmineexitl', 1, s => pos(s).z < 9000);
    });
    await seg('mine doors -> surface winch (walk)', async () => {
        await walk(3280, 3018, 1);
    });
    await seg('surface winch: haul Ana up', async () => {
        await opLoc('ropepullthingy', 2, () => true, { dialog: true });
    });
    await seg('upper barrel: pick up Ana', async () => {
        await opLoc('thminebarrel_full', 2, s => has('thanainabarrel', s), { near: [3278, 3017] });
    });
    await seg('mine cart: load Ana', async () => {
        await useOnLoc('thanainabarrel', 'loc_2682', s => !has('thanainabarrel', s));
    });
    await seg('cart driver: talk him into leaving', async () => {
        await talk('mining_cart_driver', [/Nice cart/, /One wagon wheel/, /One good turn/, /shot perhaps/, /In for a penny/, /it's like this/, /Prison riot/, /You can't leave me here/]);
    });
    await seg('mine cart: ride out with Ana', async () => {
        await opLoc('loc_2682', 2, s => has('thanainabarrel', s), { choices: [/Yes, I'll get on/] });
    });
    await seg('cart drop -> Irena (walk)', async () => {
        await walk(3303, 3112, 1);
    });
    const agi0 = skillXp(sdk, 'agility');
    await seg('Irena and Ana: rewards (Agility twice)', async () => {
        // Ana's part closes the dialogue for a p_delay(2) before the picks (ana.rs2:9-17)
        await talk('irena', [/^Agility/, /^Agility/], { allowUnused: true, until: s => skillXp(s, 'agility') >= agi0 + 2 * 116_250 });
    });

    S.report();
    const burst = S.segments.reduce((a, s) => a + Number(s.burst ?? 0), 0);
    const xp = Object.fromEntries(sdk.getSkills().map(s => [s.name, s.experience - (xp0.find(x => x[0] === s.name)?.[1] ?? 0)]).filter(([, v]) => (v as number) > 0));
    console.log('SUMMARY ' + JSON.stringify({ from: FROM, thieving: THIEVING, melee: MELEE, pray: PRAY, rowdy, prayerLeft: prayerPts(), wallTicks: currentTick(sdk) - tStart, segmentTotal: { ...S.total(), burst }, lockTries, bars, featherTries, cartTries, fightTicks, fightHpLost, hpLeft: hp(), gameXp: xp }, null, 2));
}, { timeout: 3_600_000 });
