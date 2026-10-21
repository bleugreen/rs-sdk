// Melee xp-rate measurement (docs/speedrun/skills/combat.md).
//
// Trains one melee style on a real target and logs the server tick of every
// hitsplat the player deals, every xp drop, every kill, every retarget and
// every eat/drink. Reports base xp per tick to the trained skill and to
// Hitpoints over the whole sample, including retarget gaps, overkill and
// respawn waits.
//
// Run: bun docs/speedrun/scripts/combat-rate.ts <bot> <site> [key=value ...]
//   site:   camp (troll camp outside Troll Stronghold), dp (Death Plateau troll camp),
//           moss (Brimhaven moss giants), or any key of SITES below.
//   att=70 str=70 def=70 hp=70 prayer=80   levels set with ::setstat before the run
//   style=aggressive|accurate|defensive|controlled   (scimitar buttons 1/0/3/2)
//   ticks=1500        sample length in server ticks (after the first swing)
//   until=<level>     stop when the trained skill reaches this level instead
//   pots=1            drink super attack + super strength (+ super defence when style=defensive)
//                     whenever the boost falls to half of its fresh value
//   pray=1            Ultimate Strength + Incredible Reflexes (Steel Skin too if pray=3)
//   weapon=rune_scimitar  gear=<comma list of debug names> (default kit below)
//   eat=50            eat a shark below this % of max hp
//   hold=0            hold=1 resets the trained level with ::setstat whenever it rises
//                     (this also wipes potion boosts, so use it only with pots=0)
//
// Clock: state.tick counts PLAYER_INFO packets, one per server tick.

import { runScript } from '../../../sdk/runner';
import type { BotSDK } from '../../../sdk/index';
import type { BotWorldState, NearbyNpc } from '../../../sdk/types';

type Site = { x: number; z: number; level?: number; npc: RegExp; box?: [number, number, number, number] };
const SITES: Record<string, Site> = {
    camp: { x: 2849, z: 3679, npc: /^Mountain Troll$/i, box: [2836, 2862, 3666, 3692] },
    dp: { x: 2866, z: 3591, npc: /^Mountain Troll$/i, box: [2850, 2880, 3580, 3597] },
    moss: { x: 2695, z: 3210, npc: /^Moss giant$/i, box: [2684, 2706, 3198, 3222] },
    icegiant: { x: 2886, z: 9950, npc: /^Ice giant$/i },
    ogre: { x: 2499, z: 3093, npc: /^Ogre$/i },
    firegiant: { x: 2575, z: 9893, npc: /^Fire giant$/i },
    lesserdemon: { x: 2838, z: 9560, npc: /^Lesser demon$/i },
};

const args = Object.fromEntries(process.argv.slice(4).map(a => a.split('=') as [string, string]));
const SITE_NAME = process.argv[3] ?? 'camp';
const site = SITES[SITE_NAME];
if (!site) throw new Error(`unknown site ${SITE_NAME}`);
const num = (k: string, d: number) => (args[k] !== undefined ? Number(args[k]) : d);
const ATT = num('att', 70), STR = num('str', 70), DEF = num('def', 70), HP = num('hp', 70), PRAY = num('prayer', 80);
const STYLE = (args.style ?? 'aggressive') as 'accurate' | 'aggressive' | 'controlled' | 'defensive';
const STYLE_BUTTON = { accurate: 0, aggressive: 1, controlled: 2, defensive: 3 }[STYLE];
const TRAINED = { accurate: 'attack', aggressive: 'strength', controlled: 'strength', defensive: 'defence' }[STYLE];
const TICKS = num('ticks', 1500);
const UNTIL = args.until ? Number(args.until) : null;
const POTS = num('pots', 1) === 1;
const PRAYMODE = num('pray', 1);
const EAT = num('eat', 50);
const HOLD = num('hold', 0) === 1;
const WEAPON = args.weapon ?? 'rune_scimitar';
// Default kit: what the scored account can wear on the planned quest route. The rune
// platebody needs Dragon Slayer and the Warrior helm (+3 str) The Fremennik Trials,
// both skipped by rs/3; the climbing boots (+2 str) need Death Plateau, which is on it.
const GEAR = (args.gear ?? 'amulet_of_strength,rune_full_helm,rune_chainbody,rune_platelegs,rune_kiteshield,death_climbingboots').split(',').filter(Boolean);

function now(sdk: BotSDK): number { return sdk.getState()?.tick ?? -1; }
function waitUntil(sdk: BotSDK, pred: (s: BotWorldState) => boolean, maxTicks = 100): Promise<BotWorldState | null> {
    return new Promise(resolve => {
        const cur = sdk.getState();
        if (cur && pred(cur)) return resolve(cur);
        const start = cur?.tick ?? 0;
        let done = false;
        const finish = (v: BotWorldState | null) => { if (done) return; done = true; unsub(); clearTimeout(wall); resolve(v); };
        const unsub = sdk.onStateUpdate(s => { if (pred(s)) finish(s); else if (s.tick - start > maxTicks) finish(null); });
        const wall = setTimeout(() => finish(null), (maxTicks + 20) * 700);
    });
}
async function waitTicks(sdk: BotSDK, n: number) { const t = now(sdk); await waitUntil(sdk, s => s.tick >= t + n, n + 5); }
async function cheat(sdk: BotSDK, cmd: string) { await sdk.sendSay('::' + cmd); await waitTicks(sdk, 1); }
function xp(s: BotWorldState, name: string): number { return s.skills.find(k => k.name.toLowerCase() === name)?.experience ?? 0; }
function skill(s: BotWorldState, name: string) { return s.skills.find(k => k.name.toLowerCase() === name); }
function inBox(n: NearbyNpc): boolean {
    if (!site.box) return true;
    const x = n.tileX ?? n.x, z = n.tileZ ?? n.z;
    return x >= site.box[0] && x <= site.box[1] && z >= site.box[2] && z <= site.box[3];
}

await runScript(async ({ bot, sdk }) => {
    // ── setup ──
    await cheat(sdk, '~clearinv');
    // Quest flags the default kit needs: Death Plateau (climbing boots), and Dragon Slayer /
    // The Fremennik Trials in case a gear= override asks for a rune platebody or a Warrior helm.
    await cheat(sdk, 'setvar death_equiproom 80');
    if (/rune_platebody/.test(GEAR.join())) await cheat(sdk, 'setvar dragonquest 10');
    if (/viking_helmet/.test(GEAR.join())) await cheat(sdk, 'setvar viking 10');
    for (const [k, v] of Object.entries({ attack: ATT, strength: STR, defence: DEF, hitpoints: HP, prayer: PRAY })) await cheat(sdk, `setstat ${k} ${v}`);
    for (const g of [WEAPON, ...GEAR]) await cheat(sdk, `give ${g} 1`);
    // ::give lands a tick or two after the chat packet; wait for every piece before equipping.
    await waitUntil(sdk, s => s.inventory.length >= 1 + GEAR.length, 20);
    for (const it of [...sdk.getState()!.inventory]) {
        const r = await bot.equipItem(it);
        if (!r.success) console.log(`equip ${it.name}: ${r.message}`);
    }
    await waitTicks(sdk, 2);
    const equipped = sdk.getState()!.equipment.map(e => e.name);
    const supplies: Array<[string, number]> = [['shark', 12]];
    if (POTS) {
        supplies.push(['4dose2attack', 3], ['4dose2strength', 3]);
        if (STYLE === 'defensive') supplies.push(['4dose2defence', 2]);
    }
    if (PRAYMODE) supplies.push(['4doseprayerrestore', 4]);
    for (const [o, n] of supplies) for (let i = 0; i < n; i++) await cheat(sdk, `give ${o} 1`);
    await cheat(sdk, '~energy');
    await sdk.sendSay(`::tele ${site.level ?? 0},${site.x >> 6},${site.z >> 6},${site.x & 63},${site.z & 63}`);
    await waitUntil(sdk, s => Math.abs((s.player?.worldX ?? 0) - site.x) <= 1 && Math.abs((s.player?.worldZ ?? 0) - site.z) <= 1, 20);
    await waitTicks(sdk, 3);
    for (let i = 0; i < 5 && sdk.getState()!.combatStyle?.currentStyle !== STYLE_BUTTON; i++) {
        await sdk.sendSetCombatStyle(STYLE_BUTTON);
        await waitTicks(sdk, 2);
    }
    if (PRAYMODE) {
        await sdk.sendTogglePrayer('ultimate_strength'); await waitTicks(sdk, 1);
        await sdk.sendTogglePrayer('incredible_reflexes'); await waitTicks(sdk, 1);
        if (PRAYMODE === 3) { await sdk.sendTogglePrayer('steel_skin'); await waitTicks(sdk, 1); }
    }
    const s0 = sdk.getState()!;
    console.log(`setup: site=${SITE_NAME} style=${STYLE} (button ${STYLE_BUTTON}, server style ${s0.combatStyle?.currentStyle}) levels att/str/def/hp=${ATT}/${STR}/${DEF}/${HP} prayer=${PRAY} pots=${POTS} pray=${PRAYMODE} prayers=${JSON.stringify(sdk.getActivePrayers?.() ?? [])}`);
    console.log(`equipment: ${equipped.join(', ')}`);
    console.log(`inventory: ${s0.inventory.map(i => i.name).join(', ')}`);
    if (s0.combatStyle?.currentStyle !== STYLE_BUTTON) throw new Error(`combat style not set: ${JSON.stringify(s0.combatStyle)}`);

    // ── measurement loop ──
    const ev: string[] = [];
    const hits: Array<{ tick: number; dmg: number; target: number }> = [];
    const xpDrops: Array<{ tick: number; skill: string; base: number }> = [];
    const kills: Array<{ tick: number; index: number }> = [];
    let target: number | null = null;
    let lastAttackClick = -100;
    let lastXp: Record<string, number> = {};
    for (const k of ['attack', 'strength', 'defence', 'hitpoints']) lastXp[k] = xp(s0, k);
    const xp0 = { ...lastXp };
    let tFirst = -1, tLast = -1;
    let noTargetTicks = 0, eats = 0, drinks: Record<string, number> = {}, damageTaken = 0;
    let lastHp = s0.player?.hp ?? HP;
    let lastConsume = -10, lastDialog = -10, reattackUntil = -10, targetSince = -1, abandoned = 0;
    // A target that takes no hitsplat for 10 ticks (unreachable, or walked behind an obstacle)
    // is skipped for 50 ticks.
    const banned = new Map<number, number>();
    const seenEvents = new Set<string>();
    let finished = false;
    const startLevel = skill(s0, TRAINED)!.baseLevel;

    const pickTarget = (s: BotWorldState): NearbyNpc | null => {
        const cands = s.nearbyNpcs.filter(n => site.npc.test(n.name) && n.hp !== 0 && inBox(n) && (banned.get(n.index) ?? -1) < s.tick);
        cands.sort((a, b) => a.distance - b.distance);
        return cands[0] ?? null;
    };

    const done = new Promise<void>(resolve => {
        const unsub = sdk.onStateUpdate(s => {
            if (finished) return;
            const t = s.tick;
            // Level-up and other chat dialogs: dismiss at once.
            if (s.dialog?.isOpen && t - lastDialog >= 1) { lastDialog = t; void sdk.sendClickDialog(0); }
            // Hitsplats the player dealt.
            for (const e of s.combatEvents ?? []) {
                const key = `${e.tick}:${e.type}:${e.targetIndex}:${e.damage}:${e.sourceIndex}`;
                if (seenEvents.has(key)) continue;
                seenEvents.add(key);
                if (e.type === 'damage_dealt' && e.sourceType === 'player') {
                    hits.push({ tick: e.tick, dmg: e.damage, target: e.targetIndex });
                    if (tFirst < 0) tFirst = e.tick;
                    ev.push(`${e.tick}\thit\t${e.targetIndex}\t${e.damage}`);
                }
            }
            // xp drops
            for (const k of ['attack', 'strength', 'defence', 'hitpoints']) {
                const v = xp(s, k);
                if (v !== lastXp[k]) {
                    xpDrops.push({ tick: t, skill: k, base: (v - lastXp[k]) / 25 });
                    ev.push(`${t}\txp\t${k}\t${((v - lastXp[k]) / 25).toFixed(2)}`);
                    lastXp[k] = v;
                }
            }
            // damage taken, eating
            const hp = s.player?.hp ?? lastHp;
            if (hp < lastHp) damageTaken += lastHp - hp;
            lastHp = hp;
            const maxHp = s.player?.maxHp ?? HP;
            // 3 ticks between consumes: a boost shows up in the published stats a tick or two
            // after the drink, and a shorter spacing drinks a second dose for nothing.
            if (t - lastConsume >= 3) {
                let use: { slot: number; what: string } | null = null;
                const find = (re: RegExp) => s.inventory.find(i => re.test(i.name));
                const boost = (k: string) => { const sk = skill(s, k)!; return sk.level - sk.baseLevel; };
                const fresh = (k: string) => 5 + Math.floor(skill(s, k)!.baseLevel * 0.15);
                if (hp * 100 < maxHp * EAT && find(/^shark$/i)) use = { slot: find(/^shark$/i)!.slot, what: 'eat' };
                else if (PRAYMODE && (skill(s, 'prayer')?.level ?? 99) < 12 && find(/prayer potion/i)) use = { slot: find(/prayer potion/i)!.slot, what: 'prayer' };
                else if (POTS && boost('strength') <= fresh('strength') / 2 && find(/super strength/i)) use = { slot: find(/super strength/i)!.slot, what: 'superstr' };
                else if (POTS && boost('attack') <= fresh('attack') / 2 && find(/super attack/i)) use = { slot: find(/super attack/i)!.slot, what: 'superatt' };
                else if (POTS && STYLE === 'defensive' && boost('defence') <= fresh('defence') / 2 && find(/super defence/i)) use = { slot: find(/super defence/i)!.slot, what: 'superdef' };
                if (use) {
                    lastConsume = t;
                    if (use.what === 'eat') eats++; else drinks[use.what] = (drinks[use.what] ?? 0) + 1;
                    ev.push(`${t}\tconsume\t${use.what}`);
                    const item = s.inventory.find(i => i.slot === use!.slot)!;
                    const op = item.optionsWithIndex.find(o => /^(eat|drink)$/i.test(o.text));
                    void sdk.sendUseItem(use.slot, op?.opIndex ?? 1);
                    // OPHELD clears the attack interaction (OpHeldHandler.ts clearPendingAction),
                    // so re-send the attack in the same tick; it is processed after the item op.
                    // An attack sent in the same tick does not land (the SDK serialises actions),
                    // so re-attack on each of the next two ticks; a re-click during the attack
                    // cooldown keeps the 4-tick cadence.
                    reattackUntil = t + 2;
                }
            }
            if (t <= reattackUntil && t > lastConsume && target !== null) {
                const tgt = s.nearbyNpcs.find(n => n.index === target && n.hp !== 0);
                if (tgt) {
                    const aop = tgt.optionsWithIndex?.find(o => /^attack$/i.test(o.text));
                    void sdk.sendInteractNpc(tgt.index, aop?.opIndex ?? 2);
                    lastAttackClick = t;
                }
            }
            // Hold the trained level if asked.
            if (HOLD) {
                const sk = skill(s, TRAINED)!;
                const want = { attack: ATT, strength: STR, defence: DEF }[TRAINED as 'attack']!;
                if (sk.baseLevel > want) void sdk.sendSay(`::setstat ${TRAINED} ${want}`);
            }
            // Targeting: keep attacking the current target until it dies, then the nearest live one.
            const cur = target !== null ? s.nearbyNpcs.find(n => n.index === target) : undefined;
            let curDead = !cur || cur.hp === 0;
            if (!curDead && target !== null) {
                const lastOn = [...hits].reverse().find(h => h.target === target)?.tick ?? -1;
                if (t - Math.max(lastOn, targetSince) > 10) {
                    banned.set(target, t + 50);
                    ev.push(`${t}\tabandon\t${target}`);
                    abandoned++;
                    target = null;
                    curDead = true;
                }
            }
            if (curDead && target !== null) {
                // The target died (or left view): record the kill at its last hitsplat.
                const last = [...hits].reverse().find(h => h.target === target);
                if (last && !kills.some(k => k.index === target && k.tick === last.tick)) {
                    kills.push({ tick: last.tick, index: target });
                    ev.push(`${t}\tdead\t${target}\tlasthit=${last.tick}`);
                }
            }
            if (curDead) {
                const nxt = pickTarget(s);
                if (!nxt) { if (tFirst >= 0) noTargetTicks++; }
                else if (t - lastAttackClick >= 1) {
                    target = nxt.index;
                    targetSince = t;
                    lastAttackClick = t;
                    const op = nxt.optionsWithIndex?.find(o => /^attack$/i.test(o.text));
                    ev.push(`${t}\ttarget\t${nxt.index}\tdist=${nxt.distance}`);
                    void sdk.sendInteractNpc(nxt.index, op?.opIndex ?? 2);
                }
            } else if (!s.player?.combat?.inCombat && t - lastAttackClick >= 6) {
                // Re-issue if the interaction dropped (e.g. path blocked).
                lastAttackClick = t;
                const op = cur.optionsWithIndex?.find(o => /^attack$/i.test(o.text));
                ev.push(`${t}\treattack\t${cur.index}`);
                void sdk.sendInteractNpc(cur.index, op?.opIndex ?? 2);
            }
            // Give up if the site never produces a swing (bad teleport tile, no reachable target).
            if (tFirst < 0 && t - s0.tick > 150) { console.log('ABORT: no swing within 150 ticks of setup'); tFirst = s0.tick; tLast = t; finished = true; unsub(); resolve(); return; }
            const lvl = skill(s, TRAINED)!.baseLevel;
            if ((UNTIL !== null && lvl >= UNTIL) || (UNTIL === null && tFirst >= 0 && t - tFirst >= TICKS) || s.player?.isDead) {
                tLast = t;
                finished = true;
                unsub();
                resolve();
            }
        });
    });
    await done;
    const s1 = sdk.getState()!;
    const span = tLast - tFirst;
    const gained: Record<string, number> = {};
    for (const k of ['attack', 'strength', 'defence', 'hitpoints']) gained[k] = (xp(s1, k) - xp0[k]) / 25;
    const gaps = new Map<number, number>();
    for (let i = 1; i < hits.length; i++) { const g = hits[i].tick - hits[i - 1].tick; gaps.set(g, (gaps.get(g) ?? 0) + 1); }
    const nonzero = hits.filter(h => h.dmg > 0);
    // Gap from each killing hitsplat to the next hitsplat on a new target (4 = no loss with a 4-tick weapon).
    const retarget: number[] = [];
    for (const k of kills) {
        const nxt = hits.find(h => h.tick > k.tick);
        if (nxt) retarget.push(nxt.tick - k.tick);
    }
    const killTicks: number[] = [];
    for (const k of kills) {
        const first = hits.find(h => h.target === k.index && h.tick <= k.tick && !kills.some(o => o.index === k.index && o.tick < k.tick && o.tick >= h.tick));
        if (first) killTicks.push(k.tick - first.tick + 4);
    }
    const mean = (xs: number[]) => (xs.length ? +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2) : null);
    const dmg = hits.reduce((a, h) => a + h.dmg, 0);
    const summary = {
        site: SITE_NAME, style: STYLE, trained: TRAINED, levels: { att: ATT, str: STR, def: DEF, hp: HP, prayer: PRAY },
        startLevel, endLevel: skill(s1, TRAINED)!.baseLevel, pots: POTS, pray: PRAYMODE, weapon: WEAPON,
        ticks: span, swings: hits.length, hitsNonzero: nonzero.length, damage: dmg, kills: kills.length,
        maxHitSeen: Math.max(0, ...hits.map(h => h.dmg)),
        gainedBase: gained,
        trainedXpPerTick: +(gained[TRAINED] / span).toFixed(3),
        hpXpPerTick: +(gained.hitpoints / span).toFixed(3),
        allMeleeXpPerTick: +((gained.attack + gained.strength + gained.defence) / span).toFixed(3),
        swingGapHistogram: Object.fromEntries([...gaps.entries()].sort((a, b) => a[0] - b[0])),
        meanSwingDamage: mean(hits.map(h => h.dmg)), hitRate: +(nonzero.length / Math.max(1, hits.length)).toFixed(3),
        meanTicksPerKill: mean(killTicks), meanRetargetGap: mean(retarget), retargetGaps: retarget,
        noTargetTicks, abandoned, eats, drinks, damageTaken, died: !!s1.player?.isDead,
    };
    if (process.env.COMBAT_EVENTS) for (const l of ev) console.log(l);
    console.log(`RESULT combat_rate_${SITE_NAME}_${STYLE}_${ATT}_${STR}_${DEF} ${JSON.stringify(summary)}`);
    if (PRAYMODE) { await bot.deactivateAllPrayers?.(); }
}, { timeout: 3_600_000 });
