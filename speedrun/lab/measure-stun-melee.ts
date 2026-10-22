// stunhitpoint's melee, reproduced (docs/speedrun/research/melee-rate.md).
//
//   speedrun/lab/lab.sh <bot> speedrun/lab/measure-stun-melee.ts[:--phase=str|att|hp][:--ticks=N][:--boost=0|1]
//
// The account's page (Strength 99 at 4,966, Attack 99 at 8,498, Hitpoints 99 at 17,058, Prayer 43 at
// 178, Magic 47 at 1,260, 2 QP by 1,538, Defence untrained) fits plain melee after Waterfall's
// 13,750 base Attack and Strength (level 83). This script puts a bot in that state by staff command and
// trains one phase on the ogres west of Yanille, as the account would:
//
//   str  aggressive, Attack 83, Strength 83 -> 99   (until Strength 99, unless --ticks)
//   att  accurate,   Attack 83 -> 99, Strength 99   (until Attack 99, unless --ticks)
//   hp   aggressive, Attack and Strength 99, a --ticks window (default 1,000): the Hitpoints-only rate
//
// Kit: rune scimitar and amulet of strength (Defence 1 wears nothing else that adds damage), Protect
// from Melee, which zeroes NPC melee damage (npc_combat_melee.rs2), so Hitpoints can start at the
// phase's real level. --boost=1 adds Ultimate Strength and Incredible Reflexes (both under 43).
// Prayer is topped back to 43 by ::setstat when it falls below 10, a stand-in for prayer potions:
// the points used are reported so the potions can be priced (17 points a dose at Prayer 43). A real
// drink is an inventory op and clears the attack, which the stand-in does not; the cost is a
// re-attack per dose.
//
// Units: published xp is game xp (base x 25). Level 99 is 998,458 game xp on this server's curve
// (speedrun/lib/xp.ts), not RuneScape's 13,034,431, and the issue that asked for this priced the
// account on the latter, so the RESULT also gives the rate on that scale (x 13.05) for comparison.

import type { BotWorldState, NearbyNpc, PrayerName } from '../../sdk/types';
import { startLevelUpWatcher } from '../lib/levelup';
import { closeSession, openSession } from '../lib/session';
import { waitTicks, waitUntil } from '../lib/wait';
import { levelForXp, xpForLevel, XP_RATE } from '../lib/xp';
import { arg, botArg, result } from './common';
import { cheat, clearInventory, give, mustTele, setStats } from './setup';

const PHASE = arg('phase', 'str') as 'str' | 'att' | 'hp';
const BOOST = arg('boost', '0') === '1';
const OGRES = { x: 2499, z: 3093, npc: /^Ogre$/i };
/** RuneScape's level-99 xp over this server's: what the issue's "xp per tick" figures are scaled by. */
const RS_SCALE = 13_034_431 / xpForLevel(99);

const PHASES = {
    str: { style: 1, trained: 'strength', stats: { attack: 83, strength: 83, hitpoints: 10 }, until: 99, ticks: 0 },
    att: { style: 0, trained: 'attack', stats: { attack: 83, strength: 99, hitpoints: 76 }, until: 99, ticks: 0 },
    hp: { style: 1, trained: 'hitpoints', stats: { attack: 99, strength: 99, hitpoints: 87 }, until: 0, ticks: 1000 },
} as const;
const P = PHASES[PHASE];
if (!P) throw new Error(`--phase must be str, att or hp, got ${PHASE}`);
const TICKS = Number(arg('ticks', String(P.ticks)));

const session = await openSession(botArg());
const { sdk, bot } = session;
const xp = (s: BotWorldState, k: string) => s.skills.find(x => x.name.toLowerCase() === k)?.experience ?? 0;
const lvl = (s: BotWorldState, k: string) => s.skills.find(x => x.name.toLowerCase() === k)?.baseLevel ?? 0;

// ── fixture (untimed) ──
await bot.skipTutorial().catch(() => {});
for (const [i, on] of (sdk.getState()!.prayers?.activePrayers ?? []).entries()) if (on) await sdk.sendTogglePrayer(i);
await mustTele(sdk, 3093, 3493); // away from the ogres while the fixture is made
await clearInventory(sdk);
await setStats(sdk, { ...P.stats, defence: 1, prayer: 43, magic: 47 });
await give(sdk, ['rune_scimitar', 'amulet_of_strength']);
await give(sdk, 'shark', 5);
for (const it of [...sdk.getState()!.inventory].filter(i => /scimitar|amulet/i.test(i.name))) {
    const r = await bot.equipItem(it);
    if (!r.success) throw new Error(`equip ${it.name}: ${r.message}`);
}
await waitTicks(sdk, 2);
await mustTele(sdk, OGRES.x, OGRES.z);
for (let i = 0; i < 5 && sdk.getState()!.combatStyle?.currentStyle !== P.style; i++) {
    await sdk.sendSetCombatStyle(P.style);
    await waitTicks(sdk, 2);
}
if (sdk.getState()!.combatStyle?.currentStyle !== P.style) throw new Error('combat style not set');
const wanted: PrayerName[] = ['protect_from_melee', ...(BOOST ? ['ultimate_strength', 'incredible_reflexes'] as const : [])];
const ensurePrayers = async () => {
    for (const p of wanted) if (!sdk.isPrayerActive(p)) { await sdk.sendTogglePrayer(p); await waitTicks(sdk, 1); }
};
await ensurePrayers();
const s0 = sdk.getState()!;
console.log(`setup: phase=${PHASE} boost=${BOOST} levels=${JSON.stringify(Object.fromEntries(['attack', 'strength', 'defence', 'hitpoints', 'prayer'].map(k => [k, lvl(s0, k)])))} equipment=${s0.equipment.map(e => e.name).join(', ')} prayers=${wanted.filter(p => sdk.isPrayerActive(p)).join(',')}`);

// ── measurement ──
const watcher = startLevelUpWatcher(sdk);
const skills = ['attack', 'strength', 'hitpoints'] as const;
const xp0 = Object.fromEntries(skills.map(k => [k, xp(s0, k)])) as Record<string, number>;
const levelTicks: Array<{ skill: string; level: number; tick: number }> = [];
const lastLvl = Object.fromEntries(skills.map(k => [k, lvl(s0, k)])) as Record<string, number>;
let tFirst = -1, tLast = -1, target: number | null = null, targetSince = -1, lastClick = -100;
let swings = 0, damage = 0, kills = 0, retargetTicks = 0, prayerPointsUsed = 0, refills = 0, damageTaken = 0, eats = 0;
let lastPrayer = s0.prayers?.prayerPoints ?? 43, lastHp = s0.player?.hp ?? 10, lastPrayerCheck = -10;
const seen = new Set<string>();
const banned = new Map<number, number>();
const lastHitOn = new Map<number, number>();

const pick = (s: BotWorldState): NearbyNpc | null =>
    s.nearbyNpcs.filter(n => OGRES.npc.test(n.name) && n.hp !== 0 && (banned.get(n.index) ?? -1) < s.tick).sort((a, b) => a.distance - b.distance)[0] ?? null;
const attack = (n: NearbyNpc, t: number) => {
    lastClick = t;
    void sdk.sendInteractNpc(n.index, n.optionsWithIndex?.find(o => /^attack$/i.test(o.text))?.opIndex ?? 2);
};

await new Promise<void>(resolve => {
    let finished = false;
    const unsub = sdk.onStateUpdate(s => {
        if (finished) return;
        const t = s.tick;
        for (const e of s.combatEvents ?? []) {
            const key = `${e.tick}:${e.type}:${e.sourceIndex}:${e.targetIndex}:${e.damage}`;
            if (seen.has(key)) continue;
            seen.add(key);
            if (e.type === 'damage_dealt' && e.sourceType === 'player') {
                swings++;
                damage += e.damage;
                lastHitOn.set(e.targetIndex, e.tick);
                if (tFirst < 0) tFirst = e.tick;
            }
        }
        for (const k of skills) {
            const L = lvl(s, k);
            if (L > lastLvl[k]!) { levelTicks.push({ skill: k, level: L, tick: tFirst < 0 ? 0 : t - tFirst }); lastLvl[k] = L; }
        }
        // Prayer: count points spent; top back up to 43 below 10 (the potion stand-in).
        const pp = s.prayers?.prayerPoints ?? lastPrayer;
        if (pp < lastPrayer) prayerPointsUsed += lastPrayer - pp;
        lastPrayer = pp;
        if (pp < 10 && t - lastPrayerCheck >= 3) { lastPrayerCheck = t; refills++; void cheat(sdk, 'setstat prayer 43'); }
        if (t - lastPrayerCheck >= 3 && wanted.some(p => !sdk.isPrayerActive(p))) { lastPrayerCheck = t; void ensurePrayers(); }
        const hp = s.player?.hp ?? lastHp;
        if (hp < lastHp) damageTaken += lastHp - hp;
        lastHp = hp;
        if (hp * 2 < (s.player?.maxHp ?? hp) && t - lastClick >= 3) {
            const shark = s.inventory.find(i => /shark/i.test(i.name));
            if (shark) { eats++; lastClick = t; void sdk.sendUseItem(shark.slot, shark.optionsWithIndex.find(o => /^eat$/i.test(o.text))?.opIndex ?? 1); }
        }
        // Targeting: stay on the target until it dies; skip one that takes no hit for 10 ticks.
        const cur = target !== null ? s.nearbyNpcs.find(n => n.index === target && n.hp !== 0) : undefined;
        if (cur && t - Math.max(lastHitOn.get(cur.index) ?? -1, targetSince) > 10) { banned.set(cur.index, t + 50); target = null; }
        else if (!cur && target !== null) { kills++; target = null; }
        if (target === null) {
            if (tFirst >= 0) retargetTicks++;
            const n = pick(s);
            if (n && t - lastClick >= 1) { target = n.index; targetSince = t; attack(n, t); }
        } else if (cur && !s.player?.combat?.inCombat && t - lastClick >= 6) attack(cur, t);
        if (tFirst >= 0 && (t - tFirst) % 500 === 0 && t > tFirst) {
            console.log(`progress ${PHASE}: tick ${t - tFirst}, ${P.trained} ${lvl(s, P.trained)}, hitpoints ${lvl(s, 'hitpoints')}, kills ${kills}, prayer used ${prayerPointsUsed}`);
        }
        const done = P.until ? lvl(s, P.trained) >= P.until : tFirst >= 0 && t - tFirst >= TICKS;
        if ((TICKS && tFirst >= 0 && t - tFirst >= TICKS) || done || s.player?.isDead || (tFirst < 0 && t - s0.tick > 150)) {
            tLast = t; finished = true; unsub(); resolve();
        }
    });
});
watcher.stop();
const s1 = sdk.getState()!;
const span = tLast - tFirst;
const gainedBase = Object.fromEntries(skills.map(k => [k, +((xp(s1, k) - xp0[k]!) / XP_RATE).toFixed(1)])) as Record<string, number>;
const trainedBase = PHASE === 'hp' ? gainedBase.hitpoints! : gainedBase[P.trained]!;
const perTick = trainedBase / span;
result(`stun_melee_${PHASE}${BOOST ? '_boost' : ''}`, {
    phase: PHASE, boost: BOOST, ticks: span, died: !!s1.player?.isDead,
    start: Object.fromEntries(skills.map(k => [k, levelForXp(xp0[k]!)])), end: Object.fromEntries(skills.map(k => [k, lvl(s1, k)])),
    gainedBase,
    trainedBasePerTick: +perTick.toFixed(3),
    trainedGameXpPerTick: +(perTick * XP_RATE).toFixed(1),
    trainedRsScalePerTick: +(perTick * XP_RATE * RS_SCALE).toFixed(0),
    hpBasePerTick: +(gainedBase.hitpoints! / span).toFixed(3),
    swings, meanSwing: +(damage / Math.max(1, swings)).toFixed(2), kills, retargetTicks,
    prayerPointsUsed, prayerDoses: +(prayerPointsUsed / 17).toFixed(1), refills, damageTaken, eats,
    levelTicks: levelTicks.filter(l => l.skill === P.trained || PHASE === 'hp').map(l => `${l.level}@${l.tick}`).join(' '),
    hpLevelTicks: levelTicks.filter(l => l.skill === 'hitpoints').map(l => `${l.level}@${l.tick}`).join(' '),
});
for (const p of wanted) if (sdk.isPrayerActive(p)) await sdk.sendTogglePrayer(p);
await waitUntil(sdk, () => false, { maxTicks: 2 });
await closeSession(session);
process.exit(0);
