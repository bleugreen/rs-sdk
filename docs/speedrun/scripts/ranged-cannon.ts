#!/usr/bin/env bun
/**
 * Dwarf multicannon rate lab: sets up a cannon at a site, fires it for a fixed
 * window and logs, per server tick, every xp change, cannon reload, damage taken
 * and (optionally) the player's own melee or hand-ranged attacks alongside.
 *
 *   bun docs/speedrun/scripts/ranged-cannon.ts <bot> [flags]
 *
 * Flags:
 *   --site=NAME       preset: spiders (Wilderness poison spiders, multi),
 *                     monkeys (Ape Atoll dungeon zombie monkeys, multi),
 *                     khazard (Battlefield of Khazard troops, multi),
 *                     firegiants (Waterfall dungeon, single-combat), or none
 *   --at=x,z[,level]  override the site's stand tile
 *   --npc=REGEX       targets for --mode=melee|hand (default: the site's)
 *   --ticks=N         firing window after the first Fire (default 300)
 *   --mode=MODE       idle (cannon only) | melee | hand (attack alongside)
 *   --cannon=0        no cannon: hand-ranged or melee alone at the site
 *   --weapon=OBJ[,N]  debugname (and count, for knives/darts) to wield (default rune_scimitar; idle and melee
 *                     use it, so the cannon rolls with melee accuracy)
 *   --ammo=OBJ,N      thrown weapon / arrows to wield as well (hand mode)
 *   --style=N         combat style button index (default 0)
 *   --stats=a,s,d,r,h,p  Attack, Strength, Defence, Ranged, Hitpoints, Prayer
 *                     (default 99,99,99,1,99,99)
 *   --hold=1          re-set Ranged to its start level on every level-up, so
 *                     the whole window is at one level (default 0)
 *   --pray=NAME       prayer to keep on (default protect_from_melee; none)
 *   --reload=K        top the cannon up every K ticks (default 20; 0 = only
 *                     when it runs dry, then reload and Fire again)
 *   --balls=N         cannonballs given (default 500)
 *   --retaliate=0|1   auto-retaliate (default 1; 0 clicks it off, so in idle
 *                     mode only the cannon earns xp)
 *   --stand=dx,dz     after Fire, walk to this offset from the cannon centre
 *                     and stay there (idle mode; default: where set-up left you)
 *   --out=PATH        JSONL per-tick log (includes target npcs relative to the
 *                     cannon centre, for ranged-cannon-coverage.ts)
 *
 * Survival is by cheat: Hitpoints is ::setstat back to max when it drops
 * under half, and Prayer the same; the damage taken is summed so food can be
 * costed. Ticks are the lite client's count of server ticks (one per
 * PLAYER_INFO). Base xp = game xp / 25. Gains are summed from positive
 * per-tick deltas, because the ::setstat survival cheat resets that skill's xp.
 *
 * Attribution: the cannon gives Ranged only, 2 base per damage
 * (cannon_fire.rs2:116-120); the player's own hits give 4 per damage to the
 * style's skill(s) (2+2 on longrange) plus 1.33 Hitpoints (combat.rs2:144-167).
 * So in hand mode the hand-ranged damage is HP xp / 1.33 and the cannon's
 * share of Ranged is the rest.
 */
import { runScript } from '../../../sdk/runner';
import type { BotWorldState, NearbyLoc, NearbyNpc } from '../../../sdk/types';

const argv = process.argv.slice(2);
const flag = (name: string, def?: string) => {
    const hit = argv.find(a => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : def;
};
const BOT = argv.find(a => !a.startsWith('--')) ?? 'bot';

type Site = { at: [number, number, number]; npc: string; spots?: [number, number][] };
const SITES: Record<string, Site> = {
    // poison spiders, Wilderness ~level 37, multi (maps/multiway.csv "east wilderness")
    spiders: { at: [3288, 3810, 0], npc: '^Poison spider$' },
    // zombie monkeys under Ape Atoll (Monkey Madness area), multi
    monkeys: { at: [2763, 9197, 0], npc: '^Monkey Zombie$' },
    // Battlefield of Khazard, multi ("gnome battlefield")
    khazard: { at: [2524, 3240, 0], npc: '^Khazard' },
    // Waterfall dungeon fire giants, single-combat
    firegiants: { at: [2573, 9895, 0], npc: '^Fire giant$' },
};
const SITE = SITES[flag('site', 'spiders')!] ?? { at: [0, 0, 0], npc: '.' };
const AT = (flag('at')?.split(',').map(Number) ?? SITE.at) as number[];
const NPC = new RegExp(flag('npc', SITE.npc)!, 'i');
const TICKS = Number(flag('ticks', '300'));
const MODE = flag('mode', 'idle')!;
const [WEAPON, WEAPON_N] = flag('weapon', 'rune_scimitar')!.split(',');
const CANNON = flag('cannon', '1') !== '0';
const AMMO = flag('ammo');
const STYLE = Number(flag('style', '0'));
const [ATT, STR, DEF, RNG, HP, PRAY] = flag('stats', '99,99,99,1,99,99')!.split(',').map(Number);
const HOLD = flag('hold', '0') === '1';
const PRAYER = flag('pray', 'protect_from_melee')!;
const RELOAD = Number(flag('reload', '20'));
const BALLS = Number(flag('balls', '500'));
const RETALIATE = flag('retaliate', '1') !== '0';
const STAND = flag('stand')?.split(',').map(Number);
const OUT = flag('out', `${process.env.TMPDIR ?? '/tmp'}/ranged-cannon-${BOT}-${flag('site', 'spiders')}-${MODE}.jsonl`)!;

const SKILLS = ['Attack', 'Strength', 'Defence', 'Ranged', 'Hitpoints'] as const;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

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
    const lvlOf = (s: BotWorldState, name: string) => s.skills.find(k => k.name === name)?.baseLevel ?? 0;
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
    const dismiss = async () => { while (sdk.getState()?.dialog.isOpen) { await sdk.sendClickDialog(0); await waitTicks(1); } };
    const cannonLoc = (re: RegExp, opt?: RegExp): NearbyLoc | undefined =>
        sdk.getNearbyLocs().filter(l => re.test(l.name) && (!opt || l.options.some(o => opt.test(o)))).sort((a, b) => a.distance - b.distance)[0];

    await sdk.waitForCondition(s => (s.player?.worldX ?? 0) > 0, 15000);
    await bot.skipTutorial().catch(() => {});
    await dismiss();
    freshChat(sdk.getState()!);

    // ---- staff setup (untimed) ----
    if (sdk.findInventoryItem(/cannon|multicannon/i) || sdk.getNearbyLocs().some(l => /multicannon|cannon base|cannon stand/i.test(l.name))) {
        const c = cannonLoc(/multicannon|cannon/i, /pick-up/i);
        if (c) { await bot.interactLoc(c, 'Pick-up'); await waitTicks(3); }
    }
    for (const it of sdk.getInventory()) { await sdk.sendDropItem(it.slot); }
    await waitTicks(2);
    await say('::setvar mcannon 11');
    // forget any cannon a previous run left behind (cannon_setup.rs2:59-63 refuses a second one)
    await say('::setvar ownedmcannon -1');
    await say('::setvar rockthrower 0');
    const skillNames = ['attack', 'strength', 'defence', 'ranged', 'hitpoints', 'prayer'];
    const levels = [ATT, STR, DEF, RNG, HP, PRAY];
    for (let i = 0; i < 6; i++) await say(`::setstat ${skillNames[i]} ${levels[i]}`);
    await say(`::give ${WEAPON} ${WEAPON_N ?? 1}`);
    if (AMMO) { const [o, n] = AMMO.split(','); await say(`::give ${o} ${n ?? 1000}`); }
    if (CANNON) {
        for (const o of ['twpart1', 'twpart2', 'twpart3', 'twpart4']) await say(`::give ${o} 1`);
        await say(`::give mcannonball ${BALLS}`);
    }
    await waitTicks(2);
    for (const re of [new RegExp(WEAPON.replace(/_/g, ' '), 'i'), AMMO ? new RegExp(AMMO.split(',')[0].replace(/_/g, ' '), 'i') : null]) {
        if (!re) continue;
        const item = sdk.findInventoryItem(re);
        if (item) { await bot.equipItem(item); await waitTicks(1); }
    }
    await sdk.sendSetCombatStyle(STYLE);
    await sdk.sendClickComponent(RETALIATE ? 150 : 151); // controls:com_2 on, com_3 off (player_controls.rs2:5-21)
    await waitTicks(1);
    await dismiss();

    if (PRAYER !== 'none') { await sdk.sendTogglePrayer(PRAYER as any); await waitTicks(1); }

    const ballSlot = () => sdk.findInventoryItem(/cannonball/i)?.slot ?? -1;
    let cannon: NearbyLoc = { id: 0, name: '', x: AT[0] - 1, z: AT[1] - 1, level: 0, distance: 0, optionsWithIndex: [], options: [] };
    let balls0 = 0, tFire = 0;
    if (!CANNON) { await tele(AT[0], AT[1], AT[2] ?? 0); await waitTicks(2); tFire = tick(); }
    else {
        // ---- set-up (timed from the base click at a tile that fits) ----
        const [ax, az, al] = AT;
        const ring: [number, number][] = [[0, 0]];
        for (let r = 1; r <= 4; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) if (Math.max(Math.abs(dx), Math.abs(dz)) === r) ring.push([dx, dz]);
        let placed = false, tSetup = 0;
        for (const [dx, dz] of ring) {
            await tele(ax + dx, az + dz, al ?? 0);
            await waitTicks(1);
            freshChat(sdk.getState()!);
            tSetup = tick();
            const base = sdk.findInventoryItem(/cannon base/i)!;
            await sdk.sendUseItem(base.slot, 1);
            for (let i = 0; i < 6 && sdk.findInventoryItem(/cannon base/i); i++) await waitTicks(1);
            if (!sdk.findInventoryItem(/cannon base/i)) { placed = true; break; }
            const msgs = freshChat(sdk.getState()!);
            console.log(`no fit at ${ax + dx},${az + dz}: ${msgs.join(' | ')}`);
        }
        if (!placed) throw new Error('no tile fitted the cannon');
        const tBase = tick() - tSetup;
        const steps: [RegExp, RegExp][] = [[/cannon stand/i, /cannon base/i], [/cannon barrels/i, /cannon stand/i], [/cannon furnace/i, /cannon base/i]];
        for (const [itemRe, locRe] of steps) {
            const item = sdk.findInventoryItem(itemRe)!;
            const loc = cannonLoc(locRe, /pick-up/i);
            if (!loc) throw new Error(`no ${locRe} loc`);
            await sdk.sendUseItemOnLoc(item.slot, loc.x, loc.z, loc.id);
            for (let i = 0; i < 20 && sdk.findInventoryItem(itemRe); i++) await waitTicks(1);
        }
        cannon = cannonLoc(/multicannon/i)!;
        if (!cannon) throw new Error('assembled cannon not found');
        balls0 = sdk.findInventoryItem(/cannonball/i)!.count;
        await sdk.sendUseItemOnLoc(ballSlot(), cannon.x, cannon.z, cannon.id);
        for (let i = 0; i < 20 && (sdk.findInventoryItem(/cannonball/i)?.count ?? 0) === balls0; i++) await waitTicks(1);
        await sdk.sendInteractLoc(cannon.x, cannon.z, cannon.id, 1);
        await waitTicks(1);
        tFire = tick();
        console.log(`SETUP base ${tBase} ticks, base click to Fire ${tFire - tSetup} ticks; cannon at ${cannon.x},${cannon.z}; me ${sdk.getState()!.player!.worldX},${sdk.getState()!.player!.worldZ}`);
    }
    if (PRAYER !== 'none' && !sdk.isPrayerActive(PRAYER as any)) await sdk.sendTogglePrayer(PRAYER as any);
    // the loc's SW tile is the cannon origin; the centre is +1,+1 (cannon_fire.rs2:10)
    const cx = cannon.x + 1, cz = cannon.z + 1;
    if (STAND) await sdk.sendWalk(cx + STAND[0], cz + STAND[1], false);

    // ---- firing window ----
    const log = Bun.file(OUT).writer();
    let state = sdk.getState()!;
    const xp0 = Object.fromEntries(SKILLS.map(n => [n, xpOf(state, n)]));
    const last = { ...xp0 };
    const sum: Record<string, number> = Object.fromEntries(SKILLS.map(n => [n, 0]));
    let lastHp = state.player!.hp, dmgTaken = 0, heals = 0, prayerResets = 0, reloads = 0, refires = 0, attacks = 0, dryTicks = 0;
    let lastReload = tFire, rangedDrops = 0, rangedDropsTicks = 0, dry = false;
    const startLvl = lvlOf(state, 'Ranged');
    let target: NearbyNpc | undefined;
    const perWindow: number[] = [];
    while (tick() - tFire < TICKS) {
        state = await nextTick(state.tick);
        const t = state.tick;
        const ev: string[] = [];
        const msgs = freshChat(state);
        const d: Record<string, number> = {};
        for (const n of SKILLS) { const x = xpOf(state, n); if (x !== last[n]) { d[n] = (x - last[n]) / 25; if (d[n] > 0) sum[n] += d[n]; last[n] = x; } }
        if (d.Ranged && !d.Hitpoints) { rangedDrops++; }
        const hp = state.player!.hp;
        if (hp < lastHp) dmgTaken += lastHp - hp;
        lastHp = hp;
        if (state.dialog.isOpen) { await sdk.sendClickDialog(0); ev.push('dialog'); }
        if (HOLD && lvlOf(state, 'Ranged') !== startLvl) { await sdk.sendSay(`::setstat ranged ${startLvl}`); ev.push('hold'); }
        if (hp > 0 && hp < HP / 2) { await sdk.sendSay(`::setstat hitpoints ${HP}`); heals++; lastHp = HP; ev.push('heal'); }
        if (PRAYER !== 'none' && (sdk.getPrayerState()?.prayerPoints ?? 99) < 10) { await sdk.sendSay(`::setstat prayer ${PRAY}`); prayerResets++; }
        if (PRAYER !== 'none' && !sdk.isPrayerActive(PRAYER as any) && (t - tFire) % 5 === 0) await sdk.sendTogglePrayer(PRAYER as any);

        // Cannon upkeep.
        if (msgs.some(m => /out of ammo/i.test(m))) { dry = true; ev.push('dry'); }
        if (dry) dryTicks++;
        const due = dry || (RELOAD > 0 && t - lastReload >= RELOAD);
        let usedClick = false;
        if (CANNON && due && ballSlot() >= 0) {
            cannon = cannonLoc(/multicannon/i) ?? cannon;
            await sdk.sendUseItemOnLoc(ballSlot(), cannon.x, cannon.z, cannon.id);
            reloads++; lastReload = t; usedClick = true; ev.push('reload');
            if (dry) { await sleep(5); await sdk.sendInteractLoc(cannon.x, cannon.z, cannon.id, 1); refires++; dry = false; ev.push('fire'); }
        }

        // Player's own attacks.
        if (MODE !== 'idle') {
            const me = state.player!;
            const alive = (n?: NearbyNpc) => !!n && state.nearbyNpcs.some(o => o.index === n.index && (o.hp ?? 1) > 0);
            const engaged = me.combat?.inCombat && alive(target);
            if (!engaged || usedClick) {
                const cands = state.nearbyNpcs.filter(n => NPC.test(n.name) && (n.hp ?? 1) > 0 && n.optionsWithIndex.some(o => /attack/i.test(o.text)));
                // prefer npcs already in combat (the cannon has hit them, so they are coming at us), then the nearest
                cands.sort((a, b) => Number(b.inCombat) - Number(a.inCombat) || a.distance - b.distance);
                target = cands[0];
                const op = target?.optionsWithIndex.find(o => /attack/i.test(o.text));
                if (target && op && !usedClick) { await sdk.sendInteractNpc(target.index, op.opIndex); attacks++; ev.push('attack'); }
            }
        }
        const w = Math.floor((t - tFire) / 100);
        perWindow[w] = (perWindow[w] ?? 0) + Math.max(d.Ranged ?? 0, 0);
        const npcs = state.nearbyNpcs.filter(n => NPC.test(n.name)).map(n => [(n.tileX ?? n.x) - cx, (n.tileZ ?? n.z) - cz, n.hp ?? -1]);
        const me = [state.player!.worldX - cx, state.player!.worldZ - cz];
        if (STAND && MODE === 'idle' && (me[0] !== STAND[0] || me[1] !== STAND[1]) && (t - tFire) % 4 === 0) await sdk.sendWalk(cx + STAND[0], cz + STAND[1], false);
        log.write(JSON.stringify({ t: t - tFire, d, hp, me, npcs, ev, msg: msgs.filter(m => !/^\s*$/.test(m)).slice(0, 4) }) + '\n');
    }
    await log.end();
    const span = tick() - tFire;
    const gained = Object.fromEntries(SKILLS.map(n => [n, +sum[n].toFixed(1)]));

    // ---- pick up and count balls ----
    if (PRAYER !== 'none' && sdk.isPrayerActive(PRAYER as any)) await sdk.sendTogglePrayer(PRAYER as any);
    let pickup = 0;
    if (CANNON) {
        cannon = cannonLoc(/multicannon/i) ?? cannon;
        const tp = tick();
        await sdk.sendInteractLoc(cannon.x, cannon.z, cannon.id, 2);
        for (let i = 0; i < 30 && !sdk.findInventoryItem(/cannon base/i); i++) await waitTicks(1);
        pickup = tick() - tp;
    }
    const ballsLeft = sdk.findInventoryItem(/cannonball/i)?.count ?? 0;
    const used = CANNON ? balls0 - ballsLeft : 0;
    const ammoLeft = sdk.getEquipment().find(e => new RegExp(WEAPON.replace(/_/g, ' '), 'i').test(e.name))?.count ?? 0;
    const handDmg = (gained.Hitpoints ?? 0) / 1.33;
    // rapid/accurate give 4 Ranged per damage, longrange 2 Ranged + 2 Defence (combat.rs2:155-159)
    const longrange = /long/i.test(String(sdk.getState()!.combatStyle?.styles?.[sdk.getState()!.combatStyle!.currentStyle]?.name ?? ''));
    const handRanged = MODE === 'hand' ? handDmg * (longrange ? 2 : 4) : 0;
    const cannonXp = (gained.Ranged ?? 0) - handRanged;
    console.log(JSON.stringify({
        site: flag('site', 'spiders'), cannon: CANNON, mode: MODE, retaliate: RETALIATE, combatStyle: sdk.getState()!.combatStyle?.styles?.[sdk.getState()!.combatStyle!.currentStyle] ?? STYLE, weapon: WEAPON, ammo: AMMO, style: STYLE, stats: [ATT, STR, DEF, RNG, HP, PRAY], rangedLevels: [startLvl, lvlOf(sdk.getState()!, 'Ranged')],
        tickrate: process.env.NODE_TICKRATE ?? '(see lab)', ticks: span, gainedBase: gained,
        cannonRangedBase: +cannonXp.toFixed(1), cannonPerTick: +(cannonXp / span).toFixed(2),
        totalPerTick: +(Object.values(gained).reduce((a, b) => a + b, 0) / span).toFixed(2),
        perSkillPerTick: Object.fromEntries(Object.entries(gained).map(([k, v]) => [k, +(v / span).toFixed(2)])),
        rangedPer100: perWindow.map(v => +v.toFixed(0)),
        ballsUsed: used, cannonBaseXpPerBall: +(cannonXp / Math.max(used, 1)).toFixed(2), shotsPerTick: +(used / span).toFixed(3),
        cannonHitsWithXp: MODE === 'idle' ? rangedDrops : undefined,
        weaponAmmoUsed: WEAPON_N ? Number(WEAPON_N) - ammoLeft : undefined, reloads, refires, dryTicks, attacks, dmgTaken, heals, prayerResets, pickupTicks: pickup, log: OUT,
    }, null, 1));
}, { timeout: 0, printState: false });
