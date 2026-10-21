#!/usr/bin/env bun
/**
 * Boosted cannon-finish lab (rs/91): the dwarf multicannon at the Wilderness poison
 * spiders with the player's own attacks alongside, under five supply/prayer kits, with
 * real food and potions (no ::setstat survival inside the window).
 *
 *   bun docs/speedrun/scripts/cannon-kit.ts <bot> --config=N [flags]
 *
 * Configs (Package B's cannon + rapid knives phase, rs/59's brief):
 *   1  control: rune knives on rapid, Protect from Melee held, prayer potion sipped
 *      when the points fall a dose below max, sharks
 *   2  as 1, Protect from Melee flicked (off+on in one tick, every 4 ticks), attack
 *      re-sent in the same tick after the toggles
 *   3  as 2 + ranging potion (re-sipped at half boost) + amulet of glory
 *   4  as 3 + one super antipoison dose and no sharks
 *   5  rune scimitar, defensive melee, super attack + super strength (re-sipped at
 *      half boost), glory, Protect from Melee + Ultimate Strength + Incredible
 *      Reflexes flicked, super antipoison, no sharks (--melee=0: cannon only,
 *      auto-retaliate off)
 *
 * Flags: --ticks=400  --stats=att,str,def,rng,hp,pray (default 99,99,99,85,97,43)
 *        --out=PATH (per-tick JSONL)  --melee=0|1 (config 5)
 *
 * Flick schedule (phase = ticks since the window opened, mod 4). Every prayer toggle
 * runs p_clearpendingaction (skill_prayer/scripts/prayers/*.rs2), so the attack is
 * re-sent after the toggles in the same burst:
 *   PfM only   phase 0: PfM off, PfM on, attack                      (3 packets)
 *   three      phase 0: PfM off, US off, IR off, PfM on, attack      (5 packets)
 *              phase 1: US on, IR on, attack                         (3 packets)
 * Sips, eats, cannon top-ups and dialog clicks go on phases 2-3 only: a sip or eat
 * ends in p_delay, and a prayer button sent while delayed is dropped (protected
 * script access, Player.ts canAccess), which would leave the prayer on and let the
 * drain timer fire. In the hold config (1) they go on any tick.
 *
 * Measures (base xp = game xp / 25): Ranged, Defence, Hitpoints per tick; the hand
 * attack's damage (Hitpoints xp / 1.33) and so the cannon's Ranged share; balls used
 * and xp per ball; knives thrown (equipment count) per tick against the 2-tick ideal;
 * melee hit ticks (Defence xp ticks) and their gap histogram; player attack-animation
 * starts; damage taken, food and potion doses used; prayer points start/end and the
 * share of ticks each wanted prayer was active; packets this script sent per tick,
 * and how many ticks exceeded the engine's 5 user events (NetworkPlayer.ts: a sixth
 * is not refused, it is decoded the next tick).
 */
import { runScript } from '../../../sdk/runner';
import type { BotWorldState, NearbyLoc, NearbyNpc } from '../../../sdk/types';

const argv = process.argv.slice(2);
const flag = (name: string, def?: string) => {
    const hit = argv.find(a => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : def;
};
const BOT = argv.find(a => !a.startsWith('--')) ?? 'bot';
const CONFIG = Number(flag('config', '1'));
const TICKS = Number(flag('ticks', '400'));
const [ATT, STR, DEF, RNG, HP, PRAY] = flag('stats', '99,99,99,85,97,43')!.split(',').map(Number);
const MELEE = flag('melee', '1') !== '0';
const AT = [3288, 3810, 0];
const NPC = /^Poison spider$/i;
const OUT = flag('out', `${process.env.TMPDIR ?? '/tmp'}/cannon-kit-${BOT}-c${CONFIG}${CONFIG === 5 && !MELEE ? 'idle' : ''}-r${RNG}.jsonl`)!;

const KNIVES = CONFIG <= 4;
const PFM = 14, US = 10, IR = 11;
const FLICK: number[] = CONFIG === 1 ? [] : CONFIG === 5 ? [PFM, US, IR] : [PFM];
const WANTED = CONFIG === 5 ? [PFM, US, IR] : [PFM];
const RANGING = CONFIG === 3 || CONFIG === 4;
const SUPERS = CONFIG === 5;
const GLORY = CONFIG >= 3;
const ANTIPOISON = CONFIG >= 4;
const FOOD = CONFIG <= 3;
const EAT_BELOW = Math.floor(HP * 0.6);
const SAFETY_HP = 20; // ::setstat heal, counted and reported; should not happen
const RELOAD_EVERY = 20;
const SKILLS = ['Attack', 'Strength', 'Defence', 'Ranged', 'Hitpoints'] as const;

await runScript(async ({ bot, sdk }) => {
    const nextTick = (after: number) => new Promise<BotWorldState>(resolve => {
        const now = sdk.getState();
        if (now && now.tick > after) return resolve(now);
        const off = sdk.onStateUpdate(s => { if (s.tick > after) { off(); resolve(s); } });
    });
    const tick = () => sdk.getState()!.tick;
    const waitTicks = async (n: number) => { let t = tick(); for (let i = 0; i < n; i++) t = (await nextTick(t)).tick; };
    const say = async (m: string) => { await sdk.sendSay(m); await waitTicks(1); };
    const tele = (x: number, z: number, l = 0) => say(`::tele ${l},${x >> 6},${z >> 6},${x & 63},${z & 63}`);
    const xpOf = (s: BotWorldState, name: string) => s.skills.find(k => k.name === name)?.experience ?? 0;
    const sk = (s: BotWorldState, name: string) => s.skills.find(k => k.name.toLowerCase() === name.toLowerCase())!;
    const chatSeen = new Set<string>();
    const freshChat = (s: BotWorldState) => {
        const out: string[] = [];
        for (const m of s.gameMessages) {
            const k = `${m.observationId ?? ''}|${m.tick}|${m.text}`;
            if (chatSeen.has(k)) continue;
            chatSeen.add(k); out.push(m.text);
        }
        return out;
    };
    const dismiss = async () => { for (let i = 0; i < 10 && sdk.getState()?.dialog.isOpen; i++) { await sdk.sendClickDialog(0); await waitTicks(1); } };
    const cannonLoc = (re: RegExp, opt?: RegExp): NearbyLoc | undefined =>
        sdk.getNearbyLocs().filter(l => re.test(l.name) && (!opt || l.options.some(o => opt.test(o)))).sort((a, b) => a.distance - b.distance)[0];

    await sdk.waitForCondition(s => (s.player?.worldX ?? 0) > 0, 15000);
    await bot.skipTutorial().catch(() => {});
    await dismiss();
    freshChat(sdk.getState()!);

    // ---- staff set-up (untimed) ----
    for (const [i, on] of (sdk.getState()!.prayers?.activePrayers ?? []).entries()) if (on) { await sdk.sendTogglePrayer(i); }
    if (sdk.findInventoryItem(/cannon|multicannon/i) || sdk.getNearbyLocs().some(l => /multicannon|cannon base|cannon stand/i.test(l.name))) {
        const c = cannonLoc(/multicannon|cannon/i, /pick-up/i);
        if (c) { await bot.interactLoc(c, 'Pick-up'); await waitTicks(3); }
    }
    await say('::~clearinv');
    for (const e of sdk.getEquipment()) { await sdk.sendUseEquipmentItem(e.slot, 1); await waitTicks(1); }
    await say('::~clearinv');
    await say('::setvar mcannon 11');
    await say('::setvar ownedmcannon -1'); // cannon_setup.rs2:59-63 refuses a second cannon
    await say('::setvar rockthrower 0');
    const names = ['attack', 'strength', 'defence', 'ranged', 'hitpoints', 'prayer'];
    const levels = [ATT, STR, DEF, RNG, HP, PRAY];
    for (let i = 0; i < 6; i++) await say(`::setstat ${names[i]} ${levels[i]}`);
    const KNIFE_N = 1000;
    await say(KNIVES ? `::give rune_knife ${KNIFE_N}` : '::give rune_scimitar 1');
    if (GLORY) await say('::give amulet_of_glory 1');
    for (const o of ['twpart1', 'twpart2', 'twpart3', 'twpart4']) await say(`::give ${o} 1`);
    await say('::give mcannonball 500');
    const supplies: [string, number][] = [];
    if (FOOD) supplies.push(['shark', 12]);
    supplies.push(['4doseprayerrestore', CONFIG === 1 ? 3 : 1]);
    if (RANGING) supplies.push(['4doserangerspotion', 1]);
    if (SUPERS) supplies.push(['4dose2attack', 1], ['4dose2strength', 1]);
    if (ANTIPOISON) supplies.push(['4dose2antipoison', 1]);
    for (const [o, n] of supplies) for (let i = 0; i < n; i++) await say(`::give ${o} 1`);
    await waitTicks(2);
    for (const re of [KNIVES ? /rune knife/i : /rune scimitar/i, GLORY ? /glory/i : null]) {
        if (!re) continue;
        const item = sdk.findInventoryItem(re);
        if (item) { await bot.equipItem(item); await waitTicks(1); }
    }
    const styleWanted = KNIVES ? /rapid/i : /defensive|block/i;
    const styles = sdk.getState()!.combatStyle?.styles ?? [];
    const styleIdx = Math.max(0, styles.findIndex(s => styleWanted.test(`${s.name} ${(s as any).type ?? ''}`)));
    await sdk.sendSetCombatStyle(KNIVES ? 1 : 3);
    await waitTicks(1);
    if (sdk.getState()!.combatStyle?.currentStyle !== (KNIVES ? 1 : 3)) await sdk.sendSetCombatStyle(styleIdx);
    const retaliate = !(CONFIG === 5 && !MELEE);
    await sdk.sendClickComponent(retaliate ? 150 : 151); // controls:com_2 on, com_3 off (player_controls.rs2:5-21)
    await waitTicks(1);
    await dismiss();

    // ---- cannon set-up at the spiders ----
    const ring: [number, number][] = [[0, 0]];
    for (let r = 1; r <= 4; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) if (Math.max(Math.abs(dx), Math.abs(dz)) === r) ring.push([dx, dz]);
    let placed = false;
    for (const [dx, dz] of ring) {
        await tele(AT[0] + dx, AT[1] + dz, AT[2]);
        await waitTicks(1);
        const base = sdk.findInventoryItem(/cannon base/i)!;
        await sdk.sendUseItem(base.slot, 1);
        for (let i = 0; i < 6 && sdk.findInventoryItem(/cannon base/i); i++) await waitTicks(1);
        if (!sdk.findInventoryItem(/cannon base/i)) { placed = true; break; }
    }
    if (!placed) throw new Error('no tile fitted the cannon');
    for (const [itemRe, locRe] of [[/cannon stand/i, /cannon base/i], [/cannon barrels/i, /cannon stand/i], [/cannon furnace/i, /cannon base/i]] as [RegExp, RegExp][]) {
        const item = sdk.findInventoryItem(itemRe)!;
        const loc = cannonLoc(locRe, /pick-up/i);
        if (!loc) throw new Error(`no ${locRe} loc`);
        await sdk.sendUseItemOnLoc(item.slot, loc.x, loc.z, loc.id);
        for (let i = 0; i < 20 && sdk.findInventoryItem(itemRe); i++) await waitTicks(1);
    }
    let cannon = cannonLoc(/multicannon/i)!;
    if (!cannon) throw new Error('assembled cannon not found');
    const ballSlot = () => sdk.findInventoryItem(/cannonball/i)?.slot ?? -1;
    const balls0 = sdk.findInventoryItem(/cannonball/i)!.count;
    await sdk.sendUseItemOnLoc(ballSlot(), cannon.x, cannon.z, cannon.id);
    for (let i = 0; i < 20 && (sdk.findInventoryItem(/cannonball/i)?.count ?? 0) === balls0; i++) await waitTicks(1);
    for (const i of WANTED) { await sdk.sendTogglePrayer(i); }
    await sdk.sendInteractLoc(cannon.x, cannon.z, cannon.id, 1);
    await waitTicks(1);
    await dismiss();
    // Open the window with every wanted prayer on, so the first flick burst (phase 0) turns them all off.
    for (let i = 0; i < 8 && !WANTED.every(p => sdk.getState()!.prayers?.activePrayers?.[p]); i++) {
        if (i === 4) for (const p of WANTED) if (!sdk.getState()!.prayers?.activePrayers?.[p]) await sdk.sendTogglePrayer(p);
        await waitTicks(1);
    }
    const cx = cannon.x + 1, cz = cannon.z + 1;

    // ---- firing window ----
    const log = Bun.file(OUT).writer();
    let state = sdk.getState()!;
    const tFire = state.tick;
    const last: Record<string, number> = Object.fromEntries(SKILLS.map(n => [n, xpOf(state, n)]));
    const sum: Record<string, number> = Object.fromEntries(SKILLS.map(n => [n, 0]));
    const knivesStart = sdk.getEquipment().find(e => /rune knife/i.test(e.name))?.count ?? 0;
    const ballsStart = (sdk.findInventoryItem(/cannonball/i)?.count ?? 0) + 30; // the loaded 30
    let lastHp = state.player!.hp, dmgTaken = 0, safetyHeals = 0, reloads = 0, refires = 0, attacks = 0, dialogs = 0;
    let points0 = -1, pointsMin = 99, pointsEnd = -1;
    const doses: Record<string, number> = {};
    const prayerUp = new Map<number, number>(WANTED.map(i => [i, 0]));
    let lastReload = tFire, dry = false, target: NearbyNpc | undefined, lastConsume = -10, reattackUntil = -10, observed = 0;
    const packetsPerTick: number[] = [];
    let overCap = 0, maxPackets = 0, failed = 0;
    const failures: Record<string, number> = {};
    const defHits: number[] = [], hpTicks: number[] = [], rangedTicks: number[] = [];
    let animStarts = 0, lastAnim = -1;
    const animIds: Record<number, number> = {};
    const perWindow: Record<string, number>[] = [];
    const consumedAt: number[] = [];
    const intended: boolean[] = Array.from({ length: 15 }, (_, i) => WANTED.includes(i));
    let restores = 0;

    while (tick() - tFire < TICKS) {
        state = await nextTick(state.tick);
        const t = state.tick, rel = t - tFire, phase = (rel - 1) % 4;
        observed++;
        const ev: string[] = [];
        const msgs = freshChat(state);
        let packets = 0;
        const send = (what: string, p: Promise<{ success: boolean; message?: string }>) => {
            packets++;
            p.then(r => { if (!r.success) { failed++; failures[what] = (failures[what] ?? 0) + 1; } }).catch(() => { failed++; });
        };
        // xp
        const d: Record<string, number> = {};
        for (const n of SKILLS) { const x = xpOf(state, n); if (x !== last[n]) { d[n] = (x - last[n]) / 25; if (d[n] > 0) sum[n] += d[n]; last[n] = x; } }
        if ((d.Defence ?? 0) > 0) defHits.push(rel);
        if ((d.Hitpoints ?? 0) > 0) hpTicks.push(rel);
        if ((d.Ranged ?? 0) > 0) rangedTicks.push(rel);
        const w = Math.floor(rel / 100);
        perWindow[w] ??= { Ranged: 0, Defence: 0, Hitpoints: 0 };
        for (const n of ['Ranged', 'Defence', 'Hitpoints']) perWindow[w][n] += Math.max(d[n] ?? 0, 0);
        // animation starts (the player's own swing/throw; block animations show too)
        const anim = state.player!.animId;
        if (anim !== -1 && anim !== lastAnim) { animStarts++; animIds[anim] = (animIds[anim] ?? 0) + 1; }
        lastAnim = anim;
        // hp, prayer
        const hp = state.player!.hp;
        if (hp < lastHp) dmgTaken += lastHp - hp;
        lastHp = hp;
        const pts = state.prayers?.prayerPoints ?? -1;
        if (points0 < 0) points0 = pts;
        pointsMin = Math.min(pointsMin, pts); pointsEnd = pts;
        const act = state.prayers?.activePrayers ?? [];
        for (const i of WANTED) if (act[i]) prayerUp.set(i, prayerUp.get(i)! + 1);
        if (msgs.some(m => /out of ammo/i.test(m))) { dry = true; ev.push('dry'); }

        const flickTick0 = FLICK.length > 0 && phase === 0;
        const flickTick1 = FLICK.length === 3 && phase === 1;
        const freeTick = FLICK.length === 0 || phase >= 2;

        // target upkeep
        const alive = (n?: NearbyNpc) => !!n && state.nearbyNpcs.some(o => o.index === n.index && (o.hp ?? 1) > 0);
        const pick = () => {
            const cands = state.nearbyNpcs.filter(n => NPC.test(n.name) && (n.hp ?? 1) > 0 && n.optionsWithIndex.some(o => /attack/i.test(o.text)));
            cands.sort((a, b) => Number(b.inCombat) - Number(a.inCombat) || a.distance - b.distance);
            return cands[0];
        };
        const attack = (why: string) => {
            if (CONFIG === 5 && !MELEE) return;
            if (!alive(target)) target = pick();
            const live = target && state.nearbyNpcs.find(o => o.index === target!.index);
            const op = live?.optionsWithIndex.find(o => /attack/i.test(o.text));
            if (live && op) { send('attack', sdk.sendInteractNpc(live.index, op.opIndex)); attacks++; ev.push(why); }
        };

        // 1) flick bursts. Toggles are chosen from the script's own record of what it
        // has switched (`intended`), not from the published prayer state, which shows a
        // toggle about two ticks after it is sent.
        const toggle = (i: number) => { send('prayer', sdk.sendTogglePrayer(i)); intended[i] = !intended[i]; };
        if (flickTick0) {
            for (const i of FLICK) if (intended[i]) toggle(i);
            toggle(PFM);
            attack('flick-attack');
        } else if (flickTick1) {
            toggle(US); toggle(IR);
            attack('flick-attack');
        }
        // Phase 3's published state shows phase 1's toggles: if one was dropped (sent while
        // delayed), the prayer is off though intended on; switch it on again.
        if (FLICK.length > 0 && phase === 3) for (const i of WANTED) if (intended[i] && !act[i] && pts > 0) { send('prayer', sdk.sendTogglePrayer(i)); restores++; ev.push(`restore-prayer-${i}`); }
        if (FLICK.length === 0 && !act[PFM] && pts > 0 && rel % 5 === 0) send('prayer', sdk.sendTogglePrayer(PFM));

        // 2) dialogs, consumes, cannon on free ticks
        if (freeTick) {
            if (state.dialog.isOpen) { send('dialog', sdk.sendClickDialog(0)); dialogs++; ev.push('dialog'); }
            if (hp > 0 && hp < SAFETY_HP) { send('cheat', sdk.sendSay(`::setstat hitpoints ${HP}`)); safetyHeals++; lastHp = HP; ev.push('SAFETY-HEAL'); }
            if (t - lastConsume >= 3) {
                const inv = state.inventory;
                const find = (re: RegExp) => inv.find(i => re.test(i.name));
                const boost = (k: string) => { const s = sk(state, k); return s.level - s.baseLevel; };
                let use: { re: RegExp; what: string } | null = null;
                if (FOOD && hp < EAT_BELOW && find(/^shark$/i)) use = { re: /^shark$/i, what: 'shark' };
                else if (ANTIPOISON && !doses.superantipoison && find(/super ?anti/i)) use = { re: /super ?anti/i, what: 'superantipoison' };
                else if (RANGING && boost('ranged') <= (4 + Math.floor(sk(state, 'ranged').baseLevel * 0.1)) / 2 && find(/ranging/i)) use = { re: /ranging/i, what: 'ranging' };
                else if (SUPERS && boost('strength') <= (5 + Math.floor(sk(state, 'strength').baseLevel * 0.15)) / 2 && find(/super ?str/i)) use = { re: /super ?str/i, what: 'superstrength' };
                else if (SUPERS && boost('attack') <= (5 + Math.floor(sk(state, 'attack').baseLevel * 0.15)) / 2 && find(/super ?att/i)) use = { re: /super ?att/i, what: 'superattack' };
                else if (CONFIG === 1 && pts <= PRAY - (7 + Math.floor(PRAY / 4)) && find(/prayer potion/i)) use = { re: /prayer potion/i, what: 'prayerpotion' };
                else if (FLICK.length > 0 && pts < 10 && find(/prayer potion/i)) use = { re: /prayer potion/i, what: 'prayerpotion' };
                if (use) {
                    const item = find(use.re)!;
                    const op = item.optionsWithIndex.find(o => /^(eat|drink)$/i.test(o.text));
                    send(use.what, sdk.sendUseItem(item.slot, op?.opIndex ?? 1));
                    doses[use.what] = (doses[use.what] ?? 0) + 1;
                    lastConsume = t; consumedAt.push(rel); reattackUntil = t + 2; ev.push(`consume-${use.what}`);
                }
            }
            const due = dry || t - lastReload >= RELOAD_EVERY;
            if (due && ballSlot() >= 0 && packets < 5) {
                cannon = cannonLoc(/multicannon/i) ?? cannon;
                send('reload', sdk.sendUseItemOnLoc(ballSlot(), cannon.x, cannon.z, cannon.id));
                reloads++; lastReload = t; ev.push('reload');
                if (dry) { send('fire', sdk.sendInteractLoc(cannon.x, cannon.z, cannon.id, 1)); refires++; dry = false; }
            }
        }
        // 3) attack upkeep outside the flick bursts: after a consume (OPHELD clears the
        // interaction; the delayed tick drops it, so re-send on the next two ticks), or when idle.
        if (!flickTick0 && !flickTick1 && packets < 5) {
            const engaged = state.player!.combat?.inCombat && alive(target);
            if ((t <= reattackUntil && t > lastConsume) || !engaged) attack(engaged ? 'reattack-after-consume' : 'attack');
        }

        packetsPerTick.push(packets);
        maxPackets = Math.max(maxPackets, packets);
        if (packets > 5) overCap++;
        const npcs = state.nearbyNpcs.filter(n => NPC.test(n.name)).map(n => [(n.tileX ?? n.x) - cx, (n.tileZ ?? n.z) - cz, n.hp ?? -1]);
        log.write(JSON.stringify({ t: rel, d, hp, pts, act: WANTED.map(i => (act[i] ? 1 : 0)), anim, packets, ev, npcs: npcs.length, msg: msgs.filter(m => !/^\s*$/.test(m)).slice(0, 3) }) + '\n');
    }
    await log.end();
    const span = tick() - tFire;

    // ---- wrap-up: prayers off, pick the cannon up, count balls and knives ----
    const sEnd = sdk.getState()!;
    for (const [i, on] of (sEnd.prayers?.activePrayers ?? []).entries()) if (on) await sdk.sendTogglePrayer(i);
    const knivesEnd = sdk.getEquipment().find(e => /rune knife/i.test(e.name))?.count ?? 0;
    cannon = cannonLoc(/multicannon/i) ?? cannon;
    await sdk.sendInteractLoc(cannon.x, cannon.z, cannon.id, 2);
    for (let i = 0; i < 30 && !sdk.findInventoryItem(/cannon base/i); i++) await waitTicks(1);
    const ballsEnd = sdk.findInventoryItem(/cannonball/i)?.count ?? 0;
    const ballsUsed = ballsStart - ballsEnd;

    const g = Object.fromEntries(SKILLS.map(n => [n, +sum[n].toFixed(1)]));
    const handDamage = g.Hitpoints / 1.33;
    const handRanged = KNIVES ? handDamage * 4 : 0;
    const cannonRanged = g.Ranged - handRanged;
    const thrown = KNIVES ? knivesStart - knivesEnd : 0;
    const gaps = (xs: number[]) => { const h: Record<number, number> = {}; for (let i = 1; i < xs.length; i++) { const gp = xs[i] - xs[i - 1]; h[gp] = (h[gp] ?? 0) + 1; } return h; };
    const per = (v: number) => +(v / span).toFixed(3);
    const hist: Record<number, number> = {};
    for (const p of packetsPerTick) hist[p] = (hist[p] ?? 0) + 1;
    console.log('RESULT ' + JSON.stringify({
        config: CONFIG, melee: CONFIG === 5 ? MELEE : undefined, stats: [ATT, STR, DEF, RNG, HP, PRAY], ticks: span, observed,
        rangedLevels: [RNG, sk(sEnd, 'ranged').baseLevel], defenceLevels: [DEF, sk(sEnd, 'defence').baseLevel],
        gainedBase: g, perTick: { Ranged: per(g.Ranged), Defence: per(g.Defence), Hitpoints: per(g.Hitpoints), Attack: per(g.Attack), Strength: per(g.Strength) },
        cannonRanged: +cannonRanged.toFixed(1), cannonPerTick: per(cannonRanged), handRangedPerTick: per(handRanged),
        ballsUsed, shotsPerTick: per(ballsUsed), cannonXpPerBall: +(cannonRanged / Math.max(1, ballsUsed)).toFixed(2),
        knivesThrown: thrown, throwsPerTick: per(thrown), throwIdeal: KNIVES ? 0.5 : undefined,
        hitpointsXpTicks: hpTicks.length, hpXpTickGaps: gaps(hpTicks), defenceXpTicks: defHits.length, defenceXpTickGaps: gaps(defHits),
        animStarts, animStartsPerTick: per(animStarts), animIds,
        dmgTaken, dmgTakenPerTick: per(dmgTaken), doses, consumedAt, safetyHeals,
        prayer: { start: points0, min: pointsMin, end: pointsEnd, used: points0 - pointsEnd, activeShare: Object.fromEntries([...prayerUp].map(([i, n]) => [i, +(n / observed).toFixed(3)])) },
        attacks, reloads, refires, dialogs, prayerRestores: restores,
        packets: { total: packetsPerTick.reduce((a, b) => a + b, 0), max: maxPackets, ticksOver5: overCap, histogram: hist, failed, failures },
        per100: perWindow.map(o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, +v.toFixed(0)]))),
        endLevels: { attack: [sk(sEnd, 'attack').level, sk(sEnd, 'attack').baseLevel], strength: [sk(sEnd, 'strength').level, sk(sEnd, 'strength').baseLevel], ranged: [sk(sEnd, 'ranged').level, sk(sEnd, 'ranged').baseLevel] },
        log: OUT,
    }));
}, { timeout: 0, printState: false });
