// Times the troll-chain fights on a local server (docs/speedrun/scripts/quest-troll-lab.sh).
//
//   bun docs/speedrun/scripts/quest-troll-fights.ts <bot> <dad|general|arrg> <min|p70|p99> [runs=5] [weapon=rune_scimitar]
//
// Profiles (all with helper-supplied gear: rune scimitar, rune full helm,
// platebody, platelegs, kiteshield, amulet of strength, 20 swordfish; style
// "slash" = aggressive):
//   min = 40 Attack/Strength/Defence/Hitpoints (rune gear's own requirement)
//   p70 = 70/70/70, 70 Hitpoints
//   p99 = 99/99/99, 99 Hitpoints
//
// What each run times (ticks from the first click to the event):
//   dad     - quest_troll varp at started (10), standing inside the arena; Attack
//             Dad, continue "Tiny human brave", re-attack after each knockback
//             (troll_champion.rs2:40-89), until "Stop! You win" (hp < 20,
//             troll_champion.rs2:116) and the "I'll be going now" click.
//   general - quest_troll at 10, level 2 of the stronghold at the top-door
//             arrival tile; attack the nearest Troll General until the prison
//             key lands (troll_commander.rs2:4) and is picked up.
//   arrg    - troll_love at dispose_of_arrg (35) beside Arrg on level 1; talk,
//             pick "I am here to kill you!", get teleported to the arena
//             (arrg.rs2:66), kill the attackable Arrg (140 hp, alternates melee
//             and a poisoning rock throw, arrg.rs2:82-126).
import { runScript } from '../../../sdk/runner';
import type { BotSDK } from '../../../sdk/index';
import type { BotActions } from '../../../sdk/actions';
import type { NearbyNpc } from '../../../sdk/types';
import { dropItems, pickup, talkTo, wield } from '../../../speedrun/lib/act';
import { fight } from '../../../speedrun/lib/combat';
import { advance, pageText } from '../../../speedrun/lib/dialogue';
import { isLevelUpPage } from '../../../speedrun/lib/levelup';
import { currentTick, waitTicks, waitUntil, type Pred } from '../../../speedrun/lib/wait';
import { chebyshev, findNpc, opIndex, pos, waitForNpc, type NamePattern } from '../../../speedrun/lib/world';
import { result, stats } from '../../../speedrun/lab/record';
import { clearInventory, ensureItem, give, mustTele, setStats, setvar } from '../../../speedrun/lab/setup';

const [, , , fightArg = 'dad', profileArg = 'p70', runsArg = '5', weaponArg = 'rune_scimitar'] = process.argv;
const RUNS = parseInt(runsArg);
const PROFILES: Record<string, number> = { min: 40, p70: 70, p99: 99 };
// "+pray" suffix: 70 Prayer and Protect from Melee on for every run (npc melee
// checks it in npc_combat_melee.rs2:44; Arrg's rock throw is ranged and is not blocked).
const PRAY = profileArg.endsWith('+pray');
const LV = PROFILES[profileArg.replace('+pray', '')]!;
if (!LV) throw new Error(`unknown profile ${profileArg}`);

const GEAR = [weaponArg, 'rune_full_helm', 'rune_platebody', 'rune_platelegs', 'rune_kiteshield', 'amulet_of_strength'];
const FOOD = /^swordfish$/i;

async function kit(sdk: BotSDK) {
    await clearInventory(sdk);
    await setStats(sdk, { attack: LV, strength: LV, defence: LV, hitpoints: LV });
    await give(sdk, GEAR);
    for (const g of [new RegExp('^' + weaponArg.replace(/_/g, ' ') + '$', 'i'), /rune full helm/i, /rune platebody/i, /rune platelegs/i, /rune kiteshield/i, /amulet of strength/i]) {
        await wield(sdk, g).then(r => { if (!r.ok) console.log('equip', g, 'not worn'); }, e => console.log('equip', g, e?.message));
    }
    await give(sdk, 'swordfish', 20);
    await sdk.sendSetCombatStyle(1);
}

async function topUp(bot: BotActions, sdk: BotSDK) {
    await ensureItem(sdk, 'swordfish', FOOD, 20);
    await setStats(sdk, { hitpoints: LV, ...(PRAY ? { prayer: 70 } : {}) });
    if (PRAY && !sdk.isPrayerActive('protect_from_melee')) await bot.activatePrayer('protect_from_melee').catch(e => console.log('pray', e?.message ?? e));
}

interface FightLog { levelUps: number; ticks: number; attacks: number; knockbacks: number; eats: number; pages: number; hpLost: number; dealt: number; died: boolean; end: string }

/**
 * One troll fight on combat.fight, until `done` holds or the target dies,
 * eating below 60% hp and clicking through the pages the fight opens. The
 * troll-specific part rides on its onTick hook: a knockback (a jump of 4+
 * tiles) or standing still 2 ticks more than 2 tiles from the target re-sends
 * the attack. Hp lost, knockbacks and pages are counted from the published states.
 */
async function trollFight(sdk: BotSDK, target: NamePattern | NearbyNpc, done?: Pred, maxTicks = 900): Promise<FightLog> {
    const t0 = currentTick(sdk);
    let last = pos(sdk), lastHp = sdk.getState()!.player!.hp, lastTick = -1, idle = 0, knockbacks = 0, hpLost = 0, pages = 0;
    let jumped = false, lastPage = '', lastNudge = -99;
    const watch = sdk.onStateUpdate(s => {
        if (s.tick === lastTick || !s.player) return;
        lastTick = s.tick;
        const p = pos(s);
        const jump = chebyshev(p, last);
        if (jump >= 4) { knockbacks++; jumped = true; }
        idle = jump === 0 ? idle + 1 : 0;
        last = p;
        if (s.player.hp < lastHp) hpLost += lastHp - s.player.hp;
        lastHp = s.player.hp;
        const d = s.dialog;
        if (!d.isOpen) lastPage = '';
        else if (!d.isWaiting && !isLevelUpPage(s)) {
            const key = d.pageId ?? pageText(d);
            if (key !== lastPage) { lastPage = key; pages++; }
        }
    });
    try {
        const f = await fight(sdk, target, {
            food: FOOD, eatBelow: LV * 0.6, maxTicks, onDialog: 'continue', reattackAfter: 1,
            ...(PRAY ? { prayer: 'protect_from_melee' as const } : {}),
            ...(done ? { done } : {}),
            onTick: (s, t) => {
                if ((s.tick - t0) % 20 === 0) {
                    const p = pos(s);
                    console.log(`  t+${s.tick - t0} me ${p.x},${p.z} hp ${s.player!.hp} | ${t ? `${t.name} hp ${t.hp}/${t.maxHp} d${t.distance} inCombat ${t.inCombat}` : 'no target'} | combat ${s.player!.combat.inCombat}->${s.player!.combat.targetIndex}`);
                }
                const nudge = jumped || (!!t && t.distance > 2 && idle >= 2);
                jumped = false;
                if (nudge && s.tick - lastNudge >= 2) {
                    lastNudge = s.tick;
                    return true;
                }
                return false;
            },
        });
        if (f.end === 'timeout' || f.end === 'no target') throw new Error(`fight ${f.end}: ${JSON.stringify(f)}`);
        return { levelUps: f.levelUps, ticks: f.ticks, attacks: f.attacks, knockbacks, eats: f.eats, pages: pages + f.levelUps, hpLost, dealt: f.dealt, died: f.died, end: f.end };
    } finally {
        watch();
    }
}

await runScript(async ({ bot, sdk }) => {
    await bot.skipTutorial().catch(() => {});
    console.log('kit', currentTick(sdk));
    await kit(sdk);
    console.log('kitted', currentTick(sdk), sdk.getState()!.player!.hp);
    const runs: Array<Record<string, unknown>> = [];
    for (let i = 0; i < RUNS; i++) {
        await topUp(bot, sdk);
        console.log(`run ${i + 1} start tick ${currentTick(sdk)}`);
        if (fightArg === 'dad') {
            await setvar(sdk, 'troll_quest', 10);
            await setvar(sdk, 'troll_varbit', 0);
            await mustTele(sdk, 2903, 3616);
            await waitUntil(sdk, s => { const d = findNpc(s, /^Dad$/); return !!d && (d.hp ?? 120) >= 100; }, { maxTicks: 120 });
            // Dad surrenders below 20 hp (troll_champion.rs2:116): his hp drops under 20,
            // then the "Stop! You win" page and a two-way choice open.
            const won: Pred = s => { const d = findNpc(s, /^Dad$/); return (d?.hp != null && d.hp < 20) || /Stop! You win/.test(pageText(s.dialog)); };
            const f = await trollFight(sdk, /^Dad$/, won);
            const surrendered = currentTick(sdk);
            for (let k = 0; k < 6; k++) {
                const r = await advance(sdk, { choose: /going now/i, maxTicks: 6 });
                if (r.kind === 'none') break;
                if (r.ok) f.pages++;
                if (r.ok && r.kind === 'choice') break;
            }
            runs.push({ ...f, surrenderTick: surrendered, totalTicks: currentTick(sdk) - surrendered + f.ticks });
        } else if (fightArg === 'general') {
            await setvar(sdk, 'troll_quest', 10);
            await dropItems(sdk, it => /prison key/i.test(it.name));
            await mustTele(sdk, 2837, 10090, 2);
            if (!(await waitForNpc(sdk, /^Troll General$/, 200))) throw new Error('no general');
            await waitTicks(sdk, 2);
            const gens = sdk.getState()!.nearbyNpcs.filter(n => n.name === 'Troll General');
            console.log('  generals:', gens.map(n => `${n.index}@${n.x},${n.z} d${n.distance} reach ${n.reachable}`).join(' '));
            const tgt = gens.filter(n => n.reachable !== false).sort((a, b) => a.distance - b.distance)[0] ?? gens[0]!;
            const idx = tgt.index;
            // The general's death queue drops the key (troll_commander.rs2:4-5): the fight
            // ends when the general is gone or at 0 hp, then scan for the key.
            const f = await trollFight(sdk, tgt);
            const t1 = currentTick(sdk);
            let key = null;
            for (let k = 0; k < 15 && !key; k++) { key = await sdk.scanFindGroundItem(/prison key/i, 8); if (!key) await waitTicks(sdk, 1); }
            if (!key) {
                console.log('  ground:', (await sdk.scanGroundItems(8)).map(g => `${g.name}@${g.x},${g.z}`).join(' '), '| general:', JSON.stringify(sdk.getState()!.nearbyNpcs.find(m => m.index === idx) ?? null).slice(0, 200));
                throw new Error(`no prison key dropped (${JSON.stringify(f)})`);
            }
            await pickup(sdk, /prison key/i, { maxTicks: 20 });
            runs.push({ ...f, startDist: tgt.distance, pickupTicks: currentTick(sdk) - t1, totalTicks: f.ticks + currentTick(sdk) - t1 });
            await waitTicks(sdk, 2);
        } else if (fightArg === 'arrg') {
            await setvar(sdk, 'troll_quest', 50);
            await setvar(sdk, 'troll_love', 35);
            await mustTele(sdk, 2828, 10097, 1);
            const t0 = currentTick(sdk);
            // talk until we are teleported to the arena (level 0)
            const talk = await talkTo(sdk, /^Arrg$/, [/here to kill you/i], { openTicks: 20, idle: 1, until: s => pos(s).level === 0 });
            const talkPages = { pages: talk.pages, clicks: talk.options };
            const tTele = talk.endTick >= 0 ? talk.endTick : currentTick(sdk);
            const attackable = (n: NearbyNpc) => n.name === 'Arrg' && opIndex(n, /attack/i) !== undefined;
            const w = await waitUntil(sdk, s => s.nearbyNpcs.some(attackable), { maxTicks: 10 });
            const a = w.state?.nearbyNpcs.find(attackable);
            if (!a) throw new Error(`no attackable Arrg at ${JSON.stringify(pos(sdk))}`);
            const f = await trollFight(sdk, a);
            runs.push({ ...f, talkTicks: tTele - t0, ...talkPages, totalTicks: currentTick(sdk) - t0 });
            await waitTicks(sdk, 6);
        }
        console.log(`run ${i + 1}`, JSON.stringify(runs[runs.length - 1]));
    }
    const fightTicks = runs.map(r => r.ticks as number);
    result(`${fightArg}-${profileArg}-${weaponArg}`, {
        fight: stats(fightTicks),
        total: stats(runs.map(r => r.totalTicks as number)),
        eats: stats(runs.map(r => r.eats as number)),
        levelUps: stats(runs.map(r => r.levelUps as number)),
        knockbacks: stats(runs.map(r => r.knockbacks as number)),
        hpLost: stats(runs.map(r => r.hpLost as number)),
        deaths: runs.filter(r => r.died).length,
    });
}, { timeout: 3_600_000, printState: false });
