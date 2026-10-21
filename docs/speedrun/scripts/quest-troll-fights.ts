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
import { advance, choices, cheat, tele, give, setStats, clearInv, now, pos, waitTicks, waitUntil, findNpc, dialogText, invCount, stats, result } from './quest-troll-lib';

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

function attackOp(n: NearbyNpc): number {
    const o = n.optionsWithIndex.find(x => /attack/i.test(x.text));
    if (!o) throw new Error(`${n.name} has no Attack option: ${n.options.join('|')}`);
    return o.opIndex;
}

interface FightLog { levelUps: number; ticks: number; attacks: number; knockbacks: number; eats: number; pages: number; hpLost: number; dealt: number; died: boolean }

/** Fight `target` until `done()` holds. Re-sends Attack when idle and out of reach, eats below half hp. */
async function fight(bot: BotActions, sdk: BotSDK, target: () => NearbyNpc | undefined, done: () => boolean, maxTicks = 900): Promise<FightLog> {
    const t0 = now(sdk);
    const log: FightLog = { levelUps: 0, ticks: 0, attacks: 0, knockbacks: 0, eats: 0, pages: 0, hpLost: 0, dealt: 0, died: false };
    let last = pos(sdk.getState()), lastHp = sdk.getState()!.player!.hp, lastTick = t0, idle = 0, lastAttack = -99;
    const evSeen = new Set<number>();
    const first = target();
    if (!first) throw new Error('no target');
    await sdk.sendInteractNpc(first.index, attackOp(first));
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
        if ((s.tick - t0) % 20 === 0) {
            const tt = target();
            console.log(`  t+${s.tick - t0} me ${p.x},${p.z} hp ${hp} | ${tt ? `${tt.name} hp ${tt.hp}/${tt.maxHp} d${tt.distance} inCombat ${tt.inCombat}` : 'no target'} | combat ${s.player!.combat.inCombat}->${s.player!.combat.targetIndex} | dialog ${dialogText(s).slice(0, 60)}`);
        }
        if (hp < lastHp) log.hpLost += lastHp - hp;
        lastHp = hp;
        if (s.player!.isDead) { log.died = true; break; }
        const jump = Math.max(Math.abs(p.x - last.x), Math.abs(p.z - last.z));
        if (jump >= 4) log.knockbacks++;
        idle = jump === 0 ? idle + 1 : 0;
        last = p;
        if (done()) break;
        if (s.dialog.isOpen && !s.dialog.isWaiting && choices(s).length === 0) {
            if (/advanced|level/i.test(dialogText(s))) log.levelUps++;
            await advance(sdk, s);
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
            await sdk.sendInteractNpc(t.index, attackOp(t));
            log.attacks++;
            lastAttack = s.tick;
        }
    }
    log.ticks = now(sdk) - t0;
    return log;
}

await runScript(async ({ bot, sdk }) => {
    await bot.skipTutorial().catch(() => {});
    console.log('kit', now(sdk));
    await kit(bot, sdk);
    console.log('kitted', now(sdk), sdk.getState()!.player!.hp);
    const runs: Array<Record<string, unknown>> = [];
    for (let i = 0; i < RUNS; i++) {
        await topUp(bot, sdk);
        console.log(`run ${i + 1} start tick ${now(sdk)}`);
        if (fightArg === 'dad') {
            await cheat(sdk, 'setvar troll_quest 10');
            await cheat(sdk, 'setvar troll_varbit 0');
            await tele(sdk, 2903, 3616);
            await waitUntil(sdk, () => !!findNpc(sdk, /^Dad$/) && (findNpc(sdk, /^Dad$/)!.hp ?? 120) >= 100, 120);
            // Dad surrenders below 20 hp (troll_champion.rs2:116): his hp drops under 20,
            // then the "Stop! You win" page and a two-way choice open.
            const won = () => { const d = findNpc(sdk, /^Dad$/); return (d?.hp != null && d.hp < 20) || /Stop! You win/.test(dialogText(sdk.getState())); };
            const f = await fight(bot, sdk, () => findNpc(sdk, /^Dad$/), won);
            const surrendered = now(sdk);
            for (let k = 0; k < 6; k++) {
                const r = await waitUntil(sdk, s => s.dialog.isOpen && !s.dialog.isWaiting, 6);
                if (!r) break;
                const kind = await advance(sdk, r.state, /going now/i);
                f.pages++;
                await waitUntil(sdk, s => s.tick > r.tick, 3);
                if (kind === 'choice') break;
            }
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
                if ((await advance(sdk, r.state, /here to kill you/i)) === 'choice') talkPages.clicks++;
                else talkPages.pages++;
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
        levelUps: stats(runs.map(r => r.levelUps as number)),
        knockbacks: stats(runs.map(r => r.knockbacks as number)),
        hpLost: stats(runs.map(r => r.hpLost as number)),
        deaths: runs.filter(r => r.died).length,
    });
}, { timeout: 3_600_000, printState: false });
