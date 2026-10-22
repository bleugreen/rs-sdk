// Lab check of the Taverley blue dragon safe tile (speedrun/helpers/dragons.ts).
//
//   speedrun/lab/lab.sh <bot> 'speedrun/lab/measure-dragons.ts:--kills=20:--magic=45:--spell=fire_bolt'
//
// Staff commands set the stats, give a staff of fire and runes, and teleport to the
// tile. The script then casts on any adult blue dragon it can reach without moving,
// telegrabs the drops it can reach, and logs per tick: hitpoint drops, hitsplats on
// the player (a 0 is still an attack), every tick off the tile, and the closest any
// dragon's footprint came. RESULT lines: one per kill, then a summary.
//
// --style=ranged uses --bow/--arrows instead (e.g. maple_longbow, adamant_arrow).
// --spot=x,z tests another tile. --loot=none skips telegrab.
import type { BotWorldState, GroundItem, NearbyNpc } from '../../sdk/types';
import { castDecision, collisionLineOfSight, dropGrabbable, footprintDistance, outsideEveryLeash, SAFE_TILE, type Tile } from '../helpers/dragons';
import { openSession } from '../lib/session';
import { waitTicks, waitUntil } from '../lib/wait';
import { arg, botArg, result } from './common';
import { cheat, give, leaveTutorial, setstat, tele } from './setup';

const SPELLS: Record<string, number> = { fire_bolt: 1169, fire_blast: 1181, earth_bolt: 1166, water_bolt: 1163, fire_strike: 1158 };
const TELEGRAB = 1168;
const style = arg('style', 'magic');
const spellName = arg('spell', 'fire_bolt');
const spell = SPELLS[spellName]!;
const range = Number(arg('range', '10'));
const wantKills = Number(arg('kills', '20'));
const maxMins = Number(arg('mins', '40'));
const loot = arg('loot', 'telegrab');
const [sx, sz] = arg('spot', `${SAFE_TILE.x},${SAFE_TILE.z}`).split(',').map(Number);
const spot: Tile = { x: sx!, z: sz! };

const session = await openSession(botArg());
const { sdk, bot } = session;
await leaveTutorial(session);
const los = await collisionLineOfSight();

// ---- fixture ----
for (const [skill, lv] of [['magic', arg('magic', '45')], ['ranged', arg('ranged', '70')], ['hitpoints', arg('hp', '60')], ['defence', arg('defence', '1')]] as const) {
    await setstat(sdk, skill, Number(lv));
}
const inv = () => sdk.getState()?.inventory ?? [];
for (const i of inv()) await sdk.sendDropItem(i.slot);
await waitTicks(sdk, 2);
if (style === 'magic') {
    await give(sdk, ['staff_of_fire']);
    await bot.equipItem(/^staff of fire$/i);
    await give(sdk, ['airrune'], 5000);
    await give(sdk, ['chaosrune'], 1000);
    await give(sdk, ['deathrune'], 1000);
} else {
    await give(sdk, [arg('bow', 'maple_longbow')]);
    await bot.equipItem(/longbow|shortbow/i);
    await give(sdk, [arg('arrows', 'adamant_arrow')], 2000);
    await bot.equipItem(/arrow/i);
}
await give(sdk, ['lawrune'], 500);
// Run off (controls:com_4) so an unwanted approach moves one tile a tick, auto-retaliate off (controls:com_3).
await sdk.sendClickComponent(152);
await sdk.sendClickComponent(151);
if (!(await tele(sdk, spot.x, spot.z))) throw new Error('tele failed');
result('fixture', { spot, outsideEveryLeash: outsideEveryLeash(spot), style, spell: spellName, range, skills: sdk.getState()?.skills.filter(s => s.baseLevel > 1).map(s => `${s.name} ${s.baseLevel}`) });

// ---- per-tick monitor ----
const at = (s: BotWorldState | null | undefined): Tile => ({ x: s?.player?.worldX ?? 0, z: s?.player?.worldZ ?? 0 });
const sw = (n: NearbyNpc): Tile => ({ x: n.tileX ?? n.x, z: n.tileZ ?? n.z });
const adults = (s: BotWorldState | null | undefined) => (s?.nearbyNpcs ?? []).filter(n => /^blue dragon$/i.test(n.name));
const roomNpcs = (s: BotWorldState | null | undefined) => (s?.nearbyNpcs ?? []).filter(n => /blue dragon$/i.test(n.name));
let lastHp = sdk.getState()?.player?.hp ?? 0;
let hpLost = 0;
let splats = 0;
let offTileTicks = 0;
let closest = 99;
const seenSplat = new Set<string>();
const killedAt = new Map<number, number>();
const seenMsg = new Set<string>();
const guard = arg('guard', '1') === '1';
let traceUntil = -1;
let lastGuardTick = -1;
let dead = false;
let kills = 0;
sdk.onStateUpdate(s => {
    const p = s.player;
    if (!p) return;
    if (p.hp < lastHp) { hpLost += lastHp - p.hp; result('DAMAGE', { tick: s.tick, from: lastHp, to: p.hp, pos: at(s) }); }
    lastHp = p.hp;
    for (const e of s.combatEvents ?? []) {
        if (e.targetType !== 'player') continue;
        const k = `${e.tick}:${e.damage}:${e.sourceIndex}`;
        if (seenSplat.has(k)) continue;
        seenSplat.add(k);
        splats++;
        result('SPLAT', { tick: e.tick, damage: e.damage, source: e.sourceIndex });
    }
    const pos = at(s);
    for (const m of s.gameMessages ?? []) {
        const k = `${(m as { tick?: number }).tick}:${(m as { text?: string }).text}`;
        if (seenMsg.has(k)) continue;
        seenMsg.add(k);
        result('MSG', { tick: s.tick, text: (m as { text?: string }).text });
    }
    const off = pos.x !== spot.x || pos.z !== spot.z;
    if (off || s.tick <= traceUntil) result('TRACE', { tick: s.tick, pos, anim: p.animId, adults: adults(s).map(n => ({ i: n.index, sw: sw(n), hp: n.hp, d: footprintDistance(spot, sw(n), 4), los: los(spot, sw(n), 4) })) });
    if (off) {
        offTileTicks++;
        // Guard: the moment the player is off the tile, walk straight back (a walk clears the interaction).
        if (guard && p.hp > 0 && lastGuardTick !== s.tick) { lastGuardTick = s.tick; void sdk.sendWalk(spot.x, spot.z, false); }
    }
    if (p.hp === 0) dead = true;
    for (const n of roomNpcs(s)) {
        const d = footprintDistance(pos, sw(n), n.size ?? (/baby/i.test(n.name) ? 2 : 4));
        if (d < closest) closest = d;
        if (d <= 1) result('ADJACENT', { tick: s.tick, npc: n.name, index: n.index, sw: sw(n), pos });
        if (/^blue dragon$/i.test(n.name) && n.hp === 0 && (killedAt.get(n.index) ?? -999) < s.tick - 40) {
            killedAt.set(n.index, s.tick);
            kills++;
        }
    }
});

async function backToSpot(): Promise<void> {
    const s = sdk.getState();
    const p = at(s);
    if (p.x === spot.x && p.z === spot.z) return;
    result('OFF_TILE', { tick: s?.tick, pos: p });
    await sdk.sendWalk(spot.x, spot.z, false);
    await waitUntil(sdk, st => at(st).x === spot.x && at(st).z === spot.z, { maxTicks: 10 });
}

const MAXHIT: Record<string, number> = { fire_bolt: 12, fire_blast: 16, earth_bolt: 11, water_bolt: 10, fire_strike: 8 };
const hold = arg('hold', '1') === '1';
const decide = (n: NearbyNpc) => castDecision(spot, { sw: sw(n), size: n.size ?? 4, hp: n.hp }, hold ? (MAXHIT[spellName] ?? 12) : -1, range, los);
const reachable = (n: NearbyNpc) => (n.hp ?? 1) > 0 && decide(n) === 'cast';
let holdTicks = 0;
const LOOT = /^(dragon bones|blue dragonhide)$/i;
// Not our own tile: that is where the lab drops loot to make room.
const grabbable = (g: GroundItem) => LOOT.test(g.name) && footprintDistance(spot, g, 1) >= 1 && dropGrabbable(spot, g, los);

const xpOf = (skill: string) => sdk.getState()?.skills.find(k => k.name === skill)?.experience ?? 0;
const t0 = sdk.getState()!.tick;
const wall0 = Date.now();
let casts = 0, grabs = 0, grabFails = 0, idleTicks = 0;
let lastKills = 0, lastKillTick = t0;
const got = { bones: 0, hides: 0 };
const count = (re: RegExp) => inv().filter(i => re.test(i.name)).reduce((a, i) => a + i.count, 0);

while (!dead && kills < wantKills && Date.now() - wall0 < maxMins * 60_000) {
  try {
    await backToSpot();
    const s = sdk.getState()!;
    if (kills > lastKills) {
        result('kill', { n: kills, ticks: s.tick - lastKillTick, at: s.tick - t0 });
        lastKills = kills;
        lastKillTick = s.tick;
    }
    // Loot first: drops last 200 ticks, dragons respawn after 60.
    if (loot === 'telegrab') {
        const g = (s.groundItems ?? []).find(grabbable);
        if (g && inv().length < 27) {
            const before = count(LOOT);
            result('GRAB', { tick: s.tick, item: g.name, at: { x: g.x, z: g.z }, d: footprintDistance(spot, g, 1) });
            traceUntil = s.tick + 8;
            await sdk.sendSpellOnGroundItem(g.x, g.z, g.id, TELEGRAB);
            const r = await waitUntil(sdk, st => (st.inventory ?? []).filter(i => LOOT.test(i.name)).reduce((a, i) => a + i.count, 0) > before, { maxTicks: 8 });
            if (r.ok) { grabs++; if (/bones/i.test(g.name)) got.bones++; else got.hides++; } else grabFails++;
            result('GRABBED', { ok: r.ok, item: g.name });
            await waitTicks(sdk, 1);
            continue;
        }
        if (inv().length >= 26) {
            for (const i of inv().filter(i => LOOT.test(i.name))) await sdk.sendDropItem(i.slot);
            await waitTicks(sdk, 2);
            continue;
        }
    }
    const target = adults(s).filter(reachable).sort((a, b) => (a.hp ?? 999) - (b.hp ?? 999))[0];
    if (!target) {
        if (adults(s).some(n => (n.hp ?? 1) > 0 && decide(n) === 'hold')) holdTicks++;
        idleTicks++;
        await waitTicks(sdk, 1);
        continue;
    }
    const xpBefore = xpOf(style === 'magic' ? 'Magic' : 'Ranged');
    result('CAST', { tick: s.tick, index: target.index, sw: sw(target), hp: target.hp, d: footprintDistance(spot, sw(target), 4), los: los(spot, sw(target), 4), pos: at(s) });
    traceUntil = s.tick + 8;
    if (style === 'magic') await sdk.sendSpellOnNpc(target.index, spell);
    else await sdk.sendInteractNpc(target.index, 2);
    casts++;
    await waitUntil(sdk, () => xpOf(style === 'magic' ? 'Magic' : 'Ranged') > xpBefore, { maxTicks: 6 });
    if (style === 'magic') await waitTicks(sdk, 4);
    else {
        // Bows keep attacking on their own; re-check reach every tick and stop by stepping onto the tile.
        for (let i = 0; i < 5; i++) {
            const cur = sdk.getState()!.nearbyNpcs.find(n => n.index === target.index);
            if (!cur || !reachable(cur)) { await sdk.sendWalk(spot.x, spot.z, false); break; }
            await waitTicks(sdk, 1);
        }
    }
  } catch (e) {
    // A client stall (waitTicks throws) is logged and survived, as a role must.
    result('ERR', { error: String(e) });
    await Bun.sleep(3000);
  }
}
const ticks = sdk.getState()!.tick - t0;
result('summary', {
    kills, ticks, ticksPerKill: kills ? +(ticks / kills).toFixed(1) : null, killsPerHourAt300ms: kills ? +(kills / (ticks * 0.3 / 3600)).toFixed(1) : null,
    casts, castsPerKill: kills ? +(casts / kills).toFixed(1) : null, idleTicks, holdTicks, grabs, grabFails, got,
    hpLost, splats, offTileTicks, closestFootprint: closest,
    runesLeft: inv().filter(i => /rune$/i.test(i.name)).map(i => `${i.name} ${i.count}`),
    skills: sdk.getState()?.skills.filter(k => k.baseLevel > 1).map(k => `${k.name} ${k.baseLevel}`)
});
process.exit(0);
