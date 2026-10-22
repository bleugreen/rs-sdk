// H12o feasibility probe (rs/463): a helper at Monkey Madness's end-of-G stage tops SCORED up on Ape Atoll at the
// start of segment P, on the bridge jump's landing (2803,2724) (quest_mm.rs2 mm_jumping_square), outside the town.
//
//   LAB_BOTS=<helper> speedrun/lab/lab.sh <bot> 'speedrun/lab/quests/mm-topup-probe.ts:--helper=<helper>:--rounds=3'
//
// The helper's client is launched by this script (so it can relog); SCORED's is the lab runner's. In order:
//  1. the helper's trip at the end-of-G stage: Daero (Grand Tree), the hangar, Waydar, Crash Island, Lumdo, the landing,
//     and the walk to the tile beside SCORED's (each leg timed; a leg that fails is reported and staged past);
//  2. the helper parked on its tile for --park ticks: HP, hits, and the NPCs that come within 15 tiles;
//  3. --rounds trades of 10 sharks + 1 super antipoison(4) with lib/trade.ts (the helper's give(), SCORED's receiveFrom()),
//     SCORED staged as P starts (route levels, bow worn, --sharks held); round 2 with Protect from Melee on, round 3
//     also poisoned;
//  4. the helper's relog on the tile (does it come back there?);
//  5. SCORED drinks one super antipoison dose (immunity for the pass) and runs the module's segments P..--until from
//     the tile with the sharks it took (default P only).
// Lab only: staff commands throughout.

import type { BotWorldState } from '../../../sdk/types';
import { invOp, talkTo, walkTo, wield } from '../../lib/act';
import { setPrayer } from '../../lib/combat';
import { closeSession, openSession, relog, type Session } from '../../lib/session';
import { TickLog } from '../../lib/ticks';
import { give as giveTo, receiveFrom } from '../../lib/trade';
import { waitTicks, waitUntil } from '../../lib/wait';
import { chebyshev, configId, pos } from '../../lib/world';
import { AREAS, CRASH_ISLAND, HANGAR, inArea, SEGMENTS, steps } from '../../quests/monkey-madness';
import { runSteps } from '../../runner/step';
import { arg, botArg, result } from '../common';
import { cheat, clearInventory, give, leaveTutorial, mustTele, setStats, setVars, tele } from '../setup';
import { dungeonTraps, fixture, fixtureItems, MM_VARS, PREREQ_VARS, ROUTE_LEVELS, ROUTE_WORN, SegmentUse } from './monkey-madness';

/** SCORED's tile: where the bridge jump always lands (quest_mm.rs2:1043, 0_43_42_51_36). */
const TILE = { x: 2803, z: 2724 };
/** The helper's tile, one south of SCORED's. */
const HELPER_TILE = { x: 2803, z: 2723 };
/** Lumdo's drop on the atoll (mm_lumdo.rs2: 0_43_42_50_19). */
const LANDING = { x: 2802, z: 2707 };
const DAERO = { x: 2484, z: 3487, level: 1 };
const STAGING = { x: 3222, z: 3218 };
/** The end of G: what the chapter 2 scene leaves (quest_mm.rs2), plus the hangar done. */
const END_OF_G = {
    mm_main: 3, mm_narnode: 7, mm_caranock: 3, mm_daero: 7, mm_waydar: 1, mm_lumdo: 3,
    mm_daero_option_bit_one: 1, mm_daero_option_bit_two: 1, mm_daero_option_bit_three: 1, mm_hangar_puzzle_complete: 1,
} as const;
const SHARKS = 10;

const rounds = Number(arg('rounds', '3'));
const park = Number(arg('park', '100'));
const held = Number(arg('sharks', '3'));
const until = arg('until', 'P').toUpperCase();

const scored = await openSession(botArg());
const helper = await openSession(arg('helper', 'mmtop2'), { launch: true });
for (const s of [scored, helper]) {
    for (let attempt = 1; ; attempt++) {
        try {
            await leaveTutorial(s);
            break;
        } catch (e) {
            if (attempt >= 3) throw e;
        }
    }
}
const scoredName = scored.sdk.getState()!.player!.name;
const helperName = helper.sdk.getState()!.player!.name;
const tick = (s: Session) => s.sdk.getState()!.tick;
const free = (s: BotWorldState) => 28 - s.inventory.length;
const sharks = (s: BotWorldState) => s.inventory.filter(i => i.name === 'Shark').length;
const superDoses = (s: BotWorldState) => s.inventory.filter(i => /^Superantipoison\(\d\)$/i.test(i.name)).length;

async function homeTele(s: Session): Promise<void> {
    for (let k = 0; k < 6 && chebyshev(pos(s.sdk), STAGING) > 5; k++) if (!(await tele(s.sdk, STAGING.x, STAGING.z))) await waitTicks(s.sdk, 5);
}

/** The helper's pack: 10 sharks and one super antipoison(4), nothing else. */
async function stageHelperPack(): Promise<void> {
    await cheat(helper.sdk, '~clearinv inv', 2);
    await give(helper.sdk, 'shark', SHARKS);
    await give(helper.sdk, '4dose2antipoison', 1);
}

// ------------------------------------------------------------------ 1. the helper's stage and trip
await homeTele(helper);
await clearInventory(helper.sdk);
await setVars(helper.sdk, { treequest: PREREQ_VARS.treequest, grandtree: PREREQ_VARS.grandtree, ...Object.fromEntries(MM_VARS.map(v => [v, (END_OF_G as Record<string, number>)[v] ?? 0])) });
await stageHelperPack();
const helperStats = Object.fromEntries(helper.sdk.getState()!.skills.filter(k => ['Hitpoints', 'Defence', 'Prayer'].includes(k.name)).map(k => [k.name, k.baseLevel]));
const legs: Record<string, number | string> = {};
async function leg(name: string, fn: () => Promise<boolean>): Promise<boolean> {
    const t0 = tick(helper);
    try {
        const ok = await fn();
        legs[name] = ok ? tick(helper) - t0 : `fail@${tick(helper) - t0} at ${JSON.stringify(pos(helper.sdk))}`;
        return ok;
    } catch (e) {
        legs[name] = `error@${tick(helper) - t0}: ${e instanceof Error ? e.message : String(e)}`;
        return false;
    }
}
const onAtoll = (s: BotWorldState) => inArea(s, AREAS.atoll) && pos(s).level === 0;
await mustTele(helper.sdk, DAERO.x, DAERO.z, DAERO.level);
const trip0 = tick(helper);
let tripOk = await leg('daero_to_hangar', async () => {
    await talkTo(helper.sdk, /^Daero$/i, [/^Yes/], { maxTicks: 60, idle: 4, until: s => inArea(s, HANGAR) });
    return (await waitUntil(helper.sdk, s => inArea(s, HANGAR), { maxTicks: 15 })).ok;
});
tripOk &&= await leg('waydar_to_crash_island', async () => {
    await talkTo(helper.sdk, /^Waydar$/i, [/^Yes$/], { maxTicks: 90, idle: 4, closeModals: false, until: s => inArea(s, CRASH_ISLAND) });
    return (await waitUntil(helper.sdk, s => inArea(s, CRASH_ISLAND), { maxTicks: 15 })).ok;
});
tripOk &&= await leg('lumdo_to_atoll', async () => {
    await talkTo(helper.sdk, /^Lumdo$/i, [], { maxTicks: 60, idle: 3, until: onAtoll });
    return (await waitUntil(helper.sdk, onAtoll, { maxTicks: 15 })).ok;
});
const tripTicks = tick(helper) - trip0;
if (!tripOk) await mustTele(helper.sdk, LANDING.x, LANDING.z);
const landedAt = pos(helper.sdk);
await leg('landing_to_tile', async () => (await walkTo(helper.bot, helper.sdk, HELPER_TILE.x, HELPER_TILE.z, 0)).ok);
if (chebyshev(pos(helper.sdk), HELPER_TILE) > 0) await mustTele(helper.sdk, HELPER_TILE.x, HELPER_TILE.z);
result('mm_topup_trip', { helperStats, legs, tripOk, tripTicks, landedAt, at: pos(helper.sdk) });

// ------------------------------------------------------------------ 2. parked: what reaches the helper
const AGGRESSIVE = /^(Jungle spider|Jungle snake|Jungle scorpion|Dugopul|Monkey Archer|Monkey Guard|Padulah)$/i;
const parkSeen = new Map<string, number>();
let parkHits = 0, parkMinHp = Infinity, parkMoved = 0;
const hp0 = helper.sdk.getState()!.player!.hp;
const unpark = helper.sdk.onStateUpdate(s => {
    const me = pos(s);
    parkMinHp = Math.min(parkMinHp, s.player?.hp ?? Infinity);
    if (chebyshev(me, HELPER_TILE) > 0) parkMoved++;
    parkHits += s.combatEvents.filter(e => e.type === 'damage_taken' && e.tick === s.tick).length;
    for (const n of s.nearbyNpcs) {
        const d = chebyshev({ x: n.tileX ?? n.x, z: n.tileZ ?? n.z }, me);
        if (d <= 15) parkSeen.set(n.name, Math.min(parkSeen.get(n.name) ?? 99, d));
    }
});

// SCORED's staging runs while the helper is parked.
const pFix = fixture('P');
const items = fixtureItems('P', { sharks: 0 });
async function stageScoredPack(): Promise<void> {
    await cheat(scored.sdk, '~clearinv inv', 2);
    for (const [k, n] of items) await give(scored.sdk, k, n);
    // The bow and arrows are worn from the Grand Tree swap to R (rs/158 01:38): out of the pack.
    for (const id of ['magic_shortbow', 'rune_arrow']) if (!scored.sdk.getState()!.equipment.some(i => i.id === configId('obj', id))) await wield(scored.sdk as never, configId('obj', id));
    await give(scored.sdk, 'shark', held);
}
await homeTele(scored);
await clearInventory(scored.sdk);
await setVars(scored.sdk, { ...PREREQ_VARS, ...Object.fromEntries(MM_VARS.map(v => [v, pFix.vars[v] ?? 0])) });
await setStats(scored.sdk, ROUTE_LEVELS);
await mustTele(scored.sdk, TILE.x, TILE.z);
for (const [k, n] of items) await give(scored.sdk, k, n);
for (const w of [...(pFix.worn ?? []), ...ROUTE_WORN]) {
    if (!scored.sdk.getState()!.inventory.some(i => i.id === configId('obj', w))) await give(scored.sdk, w, 1);
    const r = await wield(scored.sdk as never, configId('obj', w));
    if (!r.ok) throw new Error(`could not wear ${w}`);
}
await stageScoredPack();
const parkLeft = park - (tick(helper) - trip0 - tripTicks);
if (parkLeft > 0) await waitTicks(helper.sdk, parkLeft);
unpark();
result('mm_topup_park', { ticks: Math.max(park, tick(helper) - trip0 - tripTicks), hpStart: hp0, minHp: parkMinHp, hits: parkHits, offTileStates: parkMoved, npcsWithin15: Object.fromEntries(parkSeen), aggressiveWithin15: [...parkSeen.keys()].filter(n => AGGRESSIVE.test(n)) });

// ------------------------------------------------------------------ 3. the trades
const trades: unknown[] = [];
for (let r = 1; r <= rounds; r++) {
    if (r > 1) {
        await stageHelperPack();
        await stageScoredPack();
    }
    if (chebyshev(pos(scored.sdk), TILE) > 0) await mustTele(scored.sdk, TILE.x, TILE.z);
    if (chebyshev(pos(helper.sdk), HELPER_TILE) > 0) await mustTele(helper.sdk, HELPER_TILE.x, HELPER_TILE.z);
    const variant = r === 1 ? 'plain' : r === 2 ? 'protect_from_melee' : 'protect_from_melee+poisoned';
    if (r >= 2) await setPrayer(scored.sdk as never, 'protect_from_melee', true);
    if (r >= 3) {
        await cheat(scored.sdk, '~poison 6', 1);
        await waitUntil(scored.sdk, s => s.gameMessages.some(m => /poisoned/i.test(m.text)), { maxTicks: 6 });
    }
    await waitTicks(scored.sdk, 2);
    const s0 = scored.sdk.getState()!;
    const before = { sharks: sharks(s0), free: free(s0), supers: superDoses(s0) };
    // A stall monitor: the longest wall gap between consecutive ticks SCORED saw during the trade.
    let lastTick = s0.tick, lastAt = Date.now(), maxGapMs = 0, arrived = -1;
    const unmon = scored.sdk.onStateUpdate(s => {
        if (s.tick !== lastTick) {
            maxGapMs = Math.max(maxGapMs, Date.now() - lastAt);
            lastTick = s.tick;
            lastAt = Date.now();
        }
        if (arrived < 0 && sharks(s) >= before.sharks + SHARKS && superDoses(s) > before.supers) arrived = s.tick;
    });
    // The helper keeps a request standing as soon as SCORED is in view (run night: it is parked first); SCORED's
    // receiveFrom clicks the helper on landing, which accepts it.
    const h0 = tick(helper);
    const giving = giveTo(helper.sdk, scoredName, [{ item: /^Shark$/i, n: 'all' }, { item: /^Superantipoison\(4\)$/i }], { maxTicks: 60 });
    await waitTicks(scored.sdk, 1);
    const t0 = tick(scored);
    const got = await receiveFrom(scored.sdk, helperName, { want: [{ item: /^Shark$/i, amount: SHARKS }, { item: /^Superantipoison\(4\)$/i, amount: 1 }], maxTicks: 60 });
    const gave = await giving;
    await waitUntil(scored.sdk, () => arrived >= 0, { maxTicks: 5 });
    unmon();
    const s1 = scored.sdk.getState()!;
    const row = {
        round: r, variant, ok: got.ok && gave.ok && arrived >= 0,
        scoredStopTicks: arrived >= 0 ? arrived - t0 : null,
        receiveFromTicks: got.ticks, giverTicks: gave.ticks, helperStartTick: h0,
        before, after: { sharks: sharks(s1), free: free(s1), supers: superDoses(s1), hp: s1.player?.hp, prayers: s1.prayers?.activePrayers.some(Boolean) },
        maxTickGapMs: maxGapMs, stalled: maxGapMs > 1500,
        ...(got.reason ? { receiveReason: got.reason } : {}), ...(gave.reason ? { giveReason: gave.reason } : {}),
        messages: s1.gameMessages.filter(m => m.tick >= t0 - 2).map(m => m.text).slice(-8),
    };
    trades.push(row);
    result('mm_topup_trade', row);
    if (r >= 2) await setPrayer(scored.sdk as never, 'protect_from_melee', false);
    await waitTicks(scored.sdk, 3);
}

// ------------------------------------------------------------------ 4. the helper's relog on the tile
let relogRow: unknown;
try {
    const r = await relog(helper, { offlineMs: 3_000 });
    await waitTicks(helper.sdk, 2);
    relogRow = { ok: true, at: pos(helper.sdk), onTile: chebyshev(pos(helper.sdk), HELPER_TILE) === 0, loginWallMs: r.loginWallMs, logoutTicks: r.logout.latencyTicks };
} catch (e) {
    relogRow = { ok: false, error: e instanceof Error ? e.message : String(e), at: pos(helper.sdk) };
}
result('mm_topup_relog', relogRow);

// ------------------------------------------------------------------ 5. SCORED on through P with what it took
const i0 = SEGMENTS.findIndex(d => d.letter === 'P');
const i1 = SEGMENTS.findIndex(d => d.letter === until);
const chain = steps({ note: line => console.log(line) }).slice(i0, i1 + 1);
// The pre-dungeon dose (rs/201's `immune` on newer module revisions): drunk here so P's pass runs immune whichever
// module revision this tree carries.
const dose = scored.sdk.getState()!.inventory.find(i => /^Superantipoison\(\d\)$/i.test(i.name));
if (dose) await invOp(scored.sdk as never, dose.id, /^drink$/i, s => !s.inventory.some(i => i.slot === dose.slot && i.id === dose.id), { maxTicks: 6 });
const use = new SegmentUse(`P..${until}`, dungeonTraps());
const unuse = scored.sdk.onStateUpdate(s => use.see(s));
const log = TickLog.memory();
const sStart = scored.sdk.getState()!;
let error: string | undefined;
try {
    await runSteps(scored, chain, { log, c: {} as never, shouldStop: () => false });
} catch (e) {
    error = e instanceof Error ? e.message : String(e);
}
unuse();
const sEnd = scored.sdk.getState()!;
result('mm_topup_follow', {
    ok: !error, ...(error ? { error } : {}),
    ticks: Object.fromEntries(log.rows.map(row => [row.step, row.ok ? row.ticks : `fail@${row.ticks}`])),
    start: { sharks: sharks(sStart), free: free(sStart), supers: superDoses(sStart), hp: sStart.player?.hp },
    end: { sharks: sharks(sEnd), free: free(sEnd), hp: sEnd.player?.hp, at: pos(sEnd) },
    use: use.summary(),
});

result('mm_topup', { trades: trades.length, allOk: trades.every(t => (t as { ok: boolean }).ok) });
await closeSession(helper);
await closeSession(scored);
process.exit(0);
