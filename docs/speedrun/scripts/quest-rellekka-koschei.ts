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
// form (npc_changetype on the same NPC) and opens one dialogue page. Form 4 (255
// attack and defence, strength 5, attacks every tick) cannot be beaten: when
// one of its hits would leave you on exactly 0 hitpoints you "die honourably"
// (playerhit_n_melee_viking, line 391), which passes the trial, teleports you up
// beside Thorvald and opens his dialogue. So form 4 costs about your remaining
// hitpoints in ticks.
//
// Each run resets %viking to 1 and Thorvald's progress to started, fights
// unarmed in the given style (default 1, aggressive), and prints the phases.

import { runScript } from '../../../sdk/runner';
import type { BotWorldState } from '../../../sdk/types';
import { dropItems, opLoc, wield } from '../../../speedrun/lib/act';
import { fight } from '../../../speedrun/lib/combat';
import { converse } from '../../../speedrun/lib/converse';
import { clickContinue } from '../../../speedrun/lib/dialogue';
import { currentTick, nextTick, waitTicks, waitUntil } from '../../../speedrun/lib/wait';
import { findNpc, invCount, invItem, pos, skillLevel, stateOf, worn, type StateLike } from '../../../speedrun/lib/world';
import { result } from '../../../speedrun/lab/record';
import { clearInventory, dropMatching, getvar, give, mustTele, setStats, setvar } from '../../../speedrun/lab/setup';
const THORVALD_STARTED = 1 << 16; // quest_viking.constant

const args = process.argv.slice(3).filter(a => !a.startsWith('-'));
const nums = args.filter(a => /^\d+$/.test(a)).map(Number);
const stat = (i: number) => nums[i] ?? 70;
const att = stat(0), str = stat(1), def = stat(2), hp = stat(3);
const runs = Number(args.find(a => a.startsWith('runs='))?.slice(5) ?? 1);
const style = Number(args.find(a => a.startsWith('style='))?.slice(6) ?? 1);
// food=N gives N sharks (food is not on the trial's forbidden list) and eats one
// below half hitpoints during forms 1-3; never during form 4, which must kill you.
const food = Number(args.find(a => a.startsWith('food='))?.slice(5) ?? 0);
// eatAt=N eats at or below N hitpoints (default half). Forms 1-3 hit for at most
// about 3, 5 and 7 (npc_melee_maxhit at strength 20/40/60), so a low threshold
// carries few hitpoints into form 4, which then ends sooner.
const eatAtArg = args.find(a => a.startsWith('eatAt='));
const eatAt = eatAtArg ? Number(eatAtArg.slice(6)) : Math.floor(hp / 2);
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

/** The in-game name of a debug obj name: amulet_of_strength is "Amulet of strength". */
const display = (obj: string) => new RegExp(`^${obj.replace(/_/g, ' ')}$`, 'i');

// The form is read from Koschei's npc type id (viking_enemy1..4 = 1290..1293,
// npc.pack), not from his defeat pages, which a mistimed click could swallow.
const ENEMY1 = 1290;
const koschei = (s: StateLike) => stateOf(s)?.nearbyNpcs.find(n => n.id >= ENEMY1 && n.id <= ENEMY1 + 3) ?? null;
const formOf = (s: StateLike) => {
    const k = koschei(s);
    return k ? k.id - ENEMY1 + 1 : 0;
};
/** Honour death: teleported up beside Thorvald, whose dialogue follows. */
const honour = (s: BotWorldState) => s.player?.level === 1 && s.player.worldZ < 4000;

await runScript(async ({ bot, sdk }) => {
    await bot.dismissBlockingUI();
    await clearInventory(sdk);
    await sdk.sendSetCombatStyle(style);
    const all: unknown[] = [];
    process.on('exit', () => result('rellekka-koschei', { stats: `${att}/${str}/${def} ${hp}hp`, partial: all.length < runs, runs: all }));

    for (let run = 0; run < runs; run++) {
        await setStats(sdk, { attack: att, strength: str, defence: def, hitpoints: hp, prayer: pray ? 99 : 1 });
        if (amulet && !worn(sdk, display(amulet))) {
            await give(sdk, amulet);
            await wield(sdk, display(amulet));
        }
        if (boost) {
            for (const [obj, re] of [['3dose2attack', /Super attack/], ['3dose2strength', /Super strength/]] as const) {
                await give(sdk, obj);
                const pot = invItem(sdk, re);
                if (pot) await sdk.sendUseItem(pot.slot, 1);
                await waitTicks(sdk, 3);
            }
            await dropMatching(sdk, [/Vial|Super/]);
        }
        await setvar(sdk, 'viking', 1);
        await setvar(sdk, 'viking_bits', THORVALD_STARTED);
        if (food > 0) await give(sdk, 'shark', food);
        if (brew + brew4 > 0) await give(sdk, '4dosepotionofzamorak', Math.ceil((brew + brew4) / 4));
        await mustTele(sdk, 2667, 3693, 0);
        const out: Record<string, unknown> = { run };
        const t0 = currentTick(sdk);
        const ladder = await opLoc(sdk, { x: 2667, z: 3694, op: 'Climb-down', radius: 5 }, 'Climb-down', s => pos(s).z > 9000, { maxTicks: 20 });
        const down = ladder.ok ? t0 + ladder.ticks : null;
        out.ladderDown = ladder.ok ? ladder.ticks : null;
        let dosesDrunk = 0;
        while (dosesDrunk < brew && !findNpc(sdk, /Koschei/)) {
            const pot = invItem(sdk, /Zamorak potion/i);
            if (!pot) break;
            await sdk.sendUseItem(pot.slot, 1);
            dosesDrunk++;
            await waitTicks(sdk, 3);
        }
        out.dosesDrunk = dosesDrunk;
        out.hpAfterBrew = sdk.getState()?.player?.hp;
        out.defAfterBrew = skillLevel(sdk, 'Defence');
        const spawned = await waitUntil(sdk, s => findNpc(s, /Koschei/) !== null, { maxTicks: 90 });
        out.spawnWait = spawned.ok ? spawned.tick - (down ?? t0) : null;
        if (!spawned.ok) throw new Error('Koschei never spawned');

        const forms: number[] = [];
        let form = formOf(sdk);
        let formStart = currentTick(sdk);
        let pages = 0;
        let levelUps = 0;
        let eaten = 0;
        let minHp = sdk.getState()?.player?.hp ?? 0;
        let hpAtForm4: number | null = null;
        if (pray) {
            await bot.activatePrayer('ultimate_strength');
            await bot.activatePrayer('incredible_reflexes');
        }
        out.boostedAtt = skillLevel(sdk, 'Attack');
        out.boostedStr = skillLevel(sdk, 'Strength');
        let done = false;
        // One fight() per form: it ends on the form change (done), a defeat page
        // (a non-level-up dialogue), the honour-death teleport, or his hitpoints
        // at 0 the tick before the change. Food only before form 4.
        while (currentTick(sdk) - t0 < 2000) {
            const s = sdk.getState()!;
            minHp = Math.min(minHp, s.player?.hp ?? minHp);
            if (honour(s)) {
                forms.push(s.tick - formStart);
                const d = await converse(sdk, [], { keep: true, idle: 2 });
                pages += d.pages;
                done = true;
                break;
            }
            if (s.player?.isDead) break;
            const f = formOf(s);
            if (f > form) {
                forms.push(s.tick - formStart);
                formStart = s.tick;
                form = f;
                if (form === 4) {
                    hpAtForm4 = s.player?.hp ?? null;
                    let n = 0;
                    while (n < brew4 && pos(sdk).level === 2) {
                        if (sdk.getState()?.dialog.isOpen) await clickContinue(sdk);
                        const pot = invItem(sdk, /Zamorak potion/i);
                        if (!pot) break;
                        await sdk.sendUseItem(pot.slot, 1);
                        n++;
                        await waitTicks(sdk, 2);
                    }
                    out.form4Doses = n;
                    out.hpAfterForm4Brew = sdk.getState()?.player?.hp;
                }
            }
            const k = koschei(sdk);
            if (!k) {
                await nextTick(sdk);
                continue;
            }
            const r = await fight(sdk, k, {
                maxTicks: 2000 - (currentTick(sdk) - t0),
                done: st => honour(st) || formOf(st) > form,
                onDialog: 'stop',
                ...(form < 4 && food > 0 ? { eatBelow: eatAt + 1, food: /Shark/ } : {}),
            });
            levelUps += r.levelUps;
            eaten += r.eats;
            minHp = Math.min(minHp, r.minHp);
            if (r.end === 'died' || r.end === 'timeout') break;
            if (r.end === 'dialog' && !honour(sdk.getState()!)) {
                const d = await converse(sdk, [], { keep: true, idle: 1, maxTicks: 30 });
                pages += d.pages;
            } else if (r.end !== 'done' && r.end !== 'dialog') {
                await nextTick(sdk);
            }
        }
        Object.assign(out, {
            total: currentTick(sdk) - t0,
            forms,
            pages,
            levelUps,
            eaten,
            died: sdk.getState()?.player?.isDead === true || pos(sdk).z < 3400,
            minHp,
            hpAtForm4,
            done,
            viking: await getvar(sdk, 'viking'),
            sword: invCount(sdk, /Fremennik blade|sword/i),
        });
        console.log('run', JSON.stringify(out));
        all.push(out);
        await dropItems(sdk, () => true);
    }
}, { timeout: 3_600_000, printState: false });
