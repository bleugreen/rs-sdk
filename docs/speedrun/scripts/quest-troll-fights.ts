// Times the troll-chain fights on a local server (docs/speedrun/scripts/quest-troll-lab.sh).
//
//   bun docs/speedrun/scripts/quest-troll-fights.ts <bot> <dad|general|arrg> <min|p70|p99> [runs=5]
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
import { cheat, tele, give, setStats, clearInv, now, pos, waitTicks, waitUntil, findNpc, dialogText, invCount, stats, result } from './quest-troll-lib';

const [, , , fightArg = 'dad', profileArg = 'p70', runsArg = '5'] = process.argv;
const RUNS = parseInt(runsArg);
const PROFILES: Record<string, number> = { min: 40, p70: 70, p99: 99 };
const LV = PROFILES[profileArg];
if (!LV) throw new Error(`unknown profile ${profileArg}`);

const GEAR = ['rune_scimitar', 'rune_full_helm', 'rune_platebody', 'rune_platelegs', 'rune_kiteshield', 'amulet_of_strength'];

async function kit(bot: BotActions, sdk: BotSDK) {
    await clearInv(bot, sdk);
    await setStats(sdk, { attack: LV, strength: LV, defence: LV, hitpoints: LV });
    for (const g of GEAR) await give(sdk, g);
    for (const g of [/rune scimitar/i, /rune full helm/i, /rune platebody/i, /rune platelegs/i, /rune kiteshield/i, /amulet of strength/i]) await bot.equipItem(g).catch(e => console.log('equip', g, e?.message));
    await give(sdk, 'swordfish', 20);
    await sdk.sendSetCombatStyle(1);
}

async function topUp(bot: BotActions, sdk: BotSDK) {
    const have = invCount(sdk.getState(), /^swordfish$/i);
    if (have < 20) await give(sdk, 'swordfish', 20 - have);
    await cheat(sdk, `setstat hitpoints ${LV}`);
}

interface FightLog { ticks: number; attacks: number; knockbacks: number; eats: number; pages: number; hpLost: number; dealt: number; died: boolean }

/** Fight `target` until `done()` holds. Re-sends Attack when idle and out of reach, eats below half hp. */
async function fight(bot: BotActions, sdk: BotSDK, target: () => NearbyNpc | undefined, done: () => boolean, maxTicks = 900): Promise<FightLog> {
    const t0 = now(sdk);
    const log: FightLog = { ticks: 0, attacks: 0, knockbacks: 0, eats: 0, pages: 0, hpLost: 0, dealt: 0, died: false };
    let last = pos(sdk.getState()), lastHp = sdk.getState()!.player!.hp, lastTick = t0, idle = 0, lastAttack = -99;
    const evSeen = new Set<number>();
    const first = target();
    if (!first) throw new Error('no target');
    await sdk.sendInteractNpc(first.index, first.options.findIndex(o => /attack/i.test(o)) + 1);
    log.attacks++;
    lastAttack = now(sdk);
    while (!done()) {
        await waitUntil(sdk, s => s.tick > lastTick, 5);
        const s = sdk.getState()!;
        lastTick = s.tick;
        if (s.tick - t0 > maxTicks) throw new Error('fight timeout');
        for (const e of s.combatEvents ?? []) {
            const k = e.observationId ?? e.tick * 1000 + e.damage;
            if (evSeen.has(k)) continue;
            evSeen.add(k);
            if (e.type === 'damage_dealt') log.dealt += e.damage;
        }
        const p = pos(s), hp = s.player!.hp;
        if (hp < lastHp) log.hpLost += lastHp - hp;
        lastHp = hp;
        if (s.player!.isDead) { log.died = true; break; }
        const jump = Math.max(Math.abs(p.x - last.x), Math.abs(p.z - last.z));
        if (jump >= 4) log.knockbacks++;
        idle = jump === 0 ? idle + 1 : 0;
        last = p;
        if (done()) break;
        if (s.dialog.isOpen && !s.dialog.isWaiting && s.dialog.options.length === 0) {
            await sdk.sendClickDialog(0);
            log.pages++;
            continue;
        }
        if (hp * 2 < LV && invCount(s, /^swordfish$/i) > 0) {
            await bot.eatFood(/^swordfish$/i);
            log.eats++;
            lastAttack = -99; // eating interrupts the attack; re-attack next tick
            continue;
        }
        const t = target();
        if (!t) continue;
        const engaged = s.player!.combat.inCombat && s.player!.combat.targetIndex === t.index;
        if ((jump >= 4 || (!engaged && idle >= 2) || (t.distance > 2 && idle >= 2)) && s.tick - lastAttack >= 2) {
            await sdk.sendInteractNpc(t.index, t.options.findIndex(o => /attack/i.test(o)) + 1);
            log.attacks++;
            lastAttack = s.tick;
        }
    }
    log.ticks = now(sdk) - t0;
    return log;
}

await runScript(async ({ bot, sdk }) => {
    await bot.skipTutorial().catch(() => {});
    await kit(bot, sdk);
    const runs: Array<Record<string, unknown>> = [];
    for (let i = 0; i < RUNS; i++) {
        await topUp(bot, sdk);
        if (fightArg === 'dad') {
            await cheat(sdk, 'setvar troll_quest 10');
            await cheat(sdk, 'setvar troll_varbit 0');
            await tele(sdk, 2903, 3616);
            await waitUntil(sdk, () => !!findNpc(sdk, /^Dad$/) && (findNpc(sdk, /^Dad$/)!.hp ?? 120) >= 100, 120);
            let surrendered = -1;
            const f = await fight(bot, sdk, () => findNpc(sdk, /^Dad$/), () => /Stop! You win/.test(dialogText(sdk.getState())));
            surrendered = now(sdk);
            await waitUntil(sdk, s => s.dialog.isOpen && s.dialog.options.length > 0, 10);
            await sdk.clickDialogByText(/going now/i).catch(() => sdk.sendClickDialog(0));
            await waitUntil(sdk, s => !/going now/.test(dialogText(s)), 5);
            runs.push({ ...f, surrenderTick: surrendered, totalTicks: now(sdk) - surrendered + f.ticks });
        } else if (fightArg === 'general') {
            await cheat(sdk, 'setvar troll_quest 10');
            for (const it of sdk.getInventory().filter(x => /prison key/i.test(x.name))) await bot.dropItem(it, 'all');
            await tele(sdk, 2837, 10090, 2);
            const gen = await waitUntil(sdk, () => !!findNpc(sdk, /^Troll General$/), 200);
            if (!gen) throw new Error('no general');
            const tgt = findNpc(sdk, /^Troll General$/)!;
            const idx = tgt.index;
            const keyOnGround = () => (sdk.getState()?.groundItems ?? []).some(g => /prison key/i.test(g.name));
            const f = await fight(bot, sdk, () => sdk.getState()?.nearbyNpcs.find(n => n.index === idx), keyOnGround);
            const t1 = now(sdk);
            const key = sdk.getState()!.groundItems.find(g => /prison key/i.test(g.name))!;
            await bot.pickupItem(key);
            await waitUntil(sdk, s => invCount(s, /prison key/i) > 0, 20);
            runs.push({ ...f, startDist: tgt.distance, pickupTicks: now(sdk) - t1, totalTicks: f.ticks + now(sdk) - t1 });
            await waitTicks(sdk, 2);
        } else if (fightArg === 'arrg') {
            await cheat(sdk, 'setvar troll_quest 50');
            await cheat(sdk, 'setvar troll_love 35');
            await tele(sdk, 2828, 10097, 1);
            const t0 = now(sdk);
            const arrg = findNpc(sdk, /^Arrg$/)!;
            await sdk.sendInteractNpc(arrg.index, 1);
            await waitUntil(sdk, s => s.dialog.isOpen, 20);
            const talkPages = { pages: 0, clicks: 0 };
            // drive until we are teleported to the arena
            while (pos(sdk.getState()).level !== 0) {
                const r = await waitUntil(sdk, s => (s.dialog.isOpen && !s.dialog.isWaiting) || pos(s).level === 0, 10);
                if (!r) break;
                if (pos(r.state).level === 0) break;
                if (r.state.dialog.options.length) { await sdk.clickDialogByText(/here to kill you/i); talkPages.clicks++; }
                else { await sdk.sendClickDialog(0); talkPages.pages++; }
                await waitUntil(sdk, s => s.tick > r.tick, 3);
            }
            const tTele = now(sdk);
            await waitUntil(sdk, () => !!sdk.getState()?.nearbyNpcs.find(n => n.name === 'Arrg' && n.options.some(o => /attack/i.test(o))), 10);
            const a = sdk.getState()!.nearbyNpcs.find(n => n.name === 'Arrg' && n.options.some(o => /attack/i.test(o)))!;
            const idx = a.index;
            const f = await fight(bot, sdk, () => sdk.getState()?.nearbyNpcs.find(n => n.index === idx), () => {
                const n = sdk.getState()?.nearbyNpcs.find(m => m.index === idx);
                return !n || n.hp === 0;
            });
            runs.push({ ...f, talkTicks: tTele - t0, ...talkPages, totalTicks: now(sdk) - t0 });
            await waitTicks(sdk, 6);
        }
        console.log(`run ${i + 1}`, JSON.stringify(runs[runs.length - 1]));
    }
    const fightTicks = runs.map(r => r.ticks as number);
    result(`${fightArg}-${profileArg}`, {
        fight: stats(fightTicks),
        total: stats(runs.map(r => r.totalTicks as number)),
        eats: stats(runs.map(r => r.eats as number)),
        knockbacks: stats(runs.map(r => r.knockbacks as number)),
        hpLost: stats(runs.map(r => r.hpLost as number)),
        deaths: runs.filter(r => r.died).length,
    });
}, { timeout: 3_600_000, printState: false });
