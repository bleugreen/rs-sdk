// skills/ranged.ts at the Wilderness poison spiders, through the module itself:
// S14 timed from the step's start (cannon set-up included) to Ranged 50 base, and
// S27's phases measured in fixed windows from the first shot, with the S27 total
// predicted from the measured rates (the plan of docs/speedrun/scripts/cannon-kit-model.ts).
//
//   LAB_RUNNERS=0 speedrun/lab/lab.sh <bot> speedrun/lab/measure-ranged.ts[:--mode=s14|s27|both|decay][:--n=1][:--ticks=400]
//       [:--windows=melee55,melee85,bow70,bow85,bow99][:--flick=4][:--reset-at=N]
//
// --mode=decay (rs/794) runs S27's own session options in the melee phase from a fresh set-up
// until 50 ticks past the first cannon's decay (DECAY_TICKS), so the session must pick the cannon
// up and set it again (CANNON_RESET_AT) to finish; it reports each re-set and its tick cost.
// --reset-at=N re-sets at N instead and stops at N + 50 (a short check of the mechanics).
//
// A window name is <melee|bow><Ranged level>, with a control suffix that leaves it out
// of the prediction: `rune` (melee: rs/91's config-5 kit, rune scimitar and glory, to
// tell the module from the weapon) or `bare` (bow: no ranging potion, as rs/124 measured).
// A segment, <melee|bow><from>to<to> (melee67to70, bow67to70), starts at Defence 99 with the
// scimitar wielded and runs until Ranged <to>: what `finish.bowFrom` changes, measured from one
// start both ways (the bow segment pays its own gear switch). Segments report ticks, not rates.
//
// The script launches its own client (LAB_RUNNERS=0) because it relogs once: the quest
// tab's colours are sent by ~update_questlist, which ::setvar does not run and login
// does, so %mcannon 11 shows as Dwarf Cannon complete (questDone) only after a relog.
//
// Fixtures are staff-made (untimed): %mcannon 11 (Dwarf Cannon complete), the cannon
// set and balls, the route's stats and kit by ::setstat / ::give, a tele to the spot.
// S14: Attack 99, Hitpoints 42, Prayer 43, Defence 1, the mithril scimitar wielded,
// 5 sharks, an antipoison(4) drunk at the first poisoning. S27: post-Dragon Slayer
// stats (Attack and Strength 99, Defence 98, Prayer 99), H23's potions and 12 sharks,
// no glory; melee windows at Ranged 55 (the phase's real level) and 85 (rs/91's).

import type { BotWorldState } from '../../sdk/types';
import { DECAY_TICKS, pickUpCannon, placedCannon } from '../lib/cannon';
import { questDone } from '../lib/quests';
import { closeSession, openSession, relog } from '../lib/session';
import { waitTicks, waitUntil } from '../lib/wait';
import { invItem, opIndex } from '../lib/world';
import { levelForXp, xpForLevel, XP_RATE } from '../lib/xp';
import {
    cannonSessionOptions, cannonSessionStep, combatFinishOptions, combatFinishStep, runSession, SPIDERS, type Phase, type RangedOptions, type RangedSdk, type SessionResult,
} from '../skills/ranged';
import { arg, botArg, result } from './common';
import { clearInventory, give, setStats, setvar, tele } from './setup';

const MODE = arg('mode', 'both');
const N = Number(arg('n', '1'));
const TICKS = Number(arg('ticks', '400'));
const WINDOWS = arg('windows', 'melee55,melee85,bow70,bow85,bow99').split(',').filter(Boolean);
const FLICK = Number(arg('flick', '4'));
const RESET_AT = arg('reset-at', '');

const session = await openSession(botArg(), { launch: true });
const { sdk, bot } = session;
const rsdk = sdk as unknown as RangedSdk;
const log = (line: string, data?: Record<string, unknown>) => console.log(`[t${sdk.getState()?.tick}] ${line}${data ? ' ' + JSON.stringify(data) : ''}`);
const opts: RangedOptions = { flickEvery: FLICK, log };

async function dismiss() {
    for (let i = 0; i < 10 && sdk.getState()?.dialog.isOpen; i++) {
        await sdk.sendClickDialog(0);
        await waitTicks(sdk, 1);
    }
}

async function fixture(stats: Record<string, number>, items: [obj: string, n: number][], wield: RegExp[]) {
    await bot.skipTutorial().catch(() => {});
    await dismiss();
    const on = (sdk.getState()!.prayers?.activePrayers ?? []).flatMap((a, i) => (a ? [i] : []));
    for (const i of on) await sdk.sendTogglePrayer(i);
    if (placedCannon(sdk.getState())) {
        await tele(sdk, SPIDERS.x, SPIDERS.z);
        await pickUpCannon(sdk).catch(() => undefined);
    }
    // Away from the spiders while the fixture is made: they attack a Defence-1 account at once.
    await tele(sdk, 3093, 3493);
    await clearInventory(sdk);
    await setvar(sdk, 'mcannon', 11);
    await setvar(sdk, 'ownedmcannon', -1); // forget a previous run's cannon (cannon_setup.rs2)
    await setvar(sdk, 'poison', 0);
    await setStats(sdk, stats);
    for (const [obj, n] of items) await give(sdk, obj, n);
    for (const re of wield) {
        const it = invItem(sdk, re);
        if (!it) throw new Error(`fixture: no ${re} to wield`);
        await sdk.sendUseItem(it.slot, opIndex(it, /^(wield|wear)$/i) ?? 2);
        await waitUntil(sdk, s => !invItem(s, re), { maxTicks: 5 });
    }
    await dismiss();
    await tele(sdk, SPIDERS.x, SPIDERS.z);
    await waitTicks(sdk, 1);
}

const xpBase = (s: BotWorldState, n: string) => (s.skills.find(k => k.name === n)?.experience ?? 0) / XP_RATE;
const summary = (r: SessionResult) => ({
    ticks: r.ticks, setUpTicks: r.setUpTicks, firingTicks: r.endTick - r.fireTick, pickUpTicks: r.pickUpTicks,
    phases: r.phases.map(p => ({ phase: p.phase, ticks: p.ticks, perTick: Object.fromEntries(Object.entries(p.xp).map(([k, v]) => [k, +(v / Math.max(1, p.ticks)).toFixed(2)])) })),
    prayer: r.prayer, damageTaken: r.damageTaken, minHp: r.minHp, consumes: r.consumes, attacks: r.attacks, levelUps: r.levelUps,
    bursts: r.bursts, restores: r.restores, reloads: r.reloads, refires: r.refires, dryEvents: r.dryEvents, ballsUsed: r.ballsUsed, arrowsUsed: r.arrowsUsed, perTickUsed: { balls: +(r.ballsUsed / Math.max(1, r.endTick - r.fireTick)).toFixed(3), arrows: +(r.arrowsUsed / Math.max(1, r.endTick - r.fireTick)).toFixed(3) }, overBudget: r.overBudget, resets: r.resets, end: r.end,
});

// ---------------------------------------------------------------- S14
async function s14(run: number) {
    await fixture(
        { attack: 99, strength: 1, defence: 1, ranged: 1, hitpoints: 42, prayer: 43 },
        [['mithril_scimitar', 1], ['twpart1', 1], ['twpart2', 1], ['twpart3', 1], ['twpart4', 1], ['mcannonball', 150], ['shark', 5], ['4doseantipoison', 1]],
        [/^mithril scimitar$/i],
    );
    const step = cannonSessionStep(opts);
    const pre = step.preconditions(sdk.getState()!, {} as never);
    if (pre !== true) throw new Error(`S14 precondition: ${pre}`);
    const s0 = sdk.getState()!;
    const r = await runSession(rsdk, cannonSessionOptions(opts));
    const s1 = sdk.getState()!;
    const post = step.postconditions(s1, {} as never);
    const out = { run, ...summary(r), rangedBase: +(xpBase(s1, 'Ranged') - xpBase(s0, 'Ranged')).toFixed(0), rangedLevel: levelForXp(xpBase(s1, 'Ranged') * XP_RATE), post, target: 132, within10pct: Math.abs(r.ticks - 132) <= 13.2 };
    result('S14', out);
    return out;
}

/** S27's fixture items: the weapons and arrows, the cannon set and balls, H23's potions and 12 sharks. */
function s27Kit(control: string, balls = 1200): [obj: string, n: number][] {
    return [
        [control === 'rune' ? 'rune_scimitar' : 'mithril_scimitar', 1], ...(control === 'rune' ? [['amulet_of_glory', 1] as [string, number]] : []), ['magic_shortbow', 1], ['rune_arrow', 1000], ['twpart1', 1], ['twpart2', 1], ['twpart3', 1], ['twpart4', 1], ['mcannonball', balls],
        ...(control === 'bare' ? [] : [['4doserangerspotion', 1], ['4doserangerspotion', 1], ['4doserangerspotion', 1]] as [string, number][]), ['4dose2antipoison', 1], ['4dose2attack', 1], ['4dose2strength', 1], ['4doseantipoison', 1],
        ['shark', 12],
    ];
}

// ---------------------------------------------------------------- S27 past the cannon's decay (rs/794)
async function decay(run: number) {
    // Melee at 0.6 balls a tick for ~2,550 ticks.
    await fixture({ attack: 99, strength: 99, defence: 98, ranged: 55, hitpoints: 90, prayer: 99 }, s27Kit('', 2000), [/^mithril scimitar$/i]);
    const pre = combatFinishStep(opts).preconditions(sdk.getState()!, {} as never);
    if (pre !== true) throw new Error(`S27 precondition (decay): ${pre}`);
    const base = combatFinishOptions(opts);
    const resetAt = RESET_AT ? Number(RESET_AT) : base.resetAt!;
    const until = (RESET_AT ? resetAt : DECAY_TICKS) + 50;
    const r = await runSession(rsdk, { ...base, resetAt, phaseOf: () => 'melee', stop: (s, fire) => s.tick - fire >= until, maxTicks: until + 200 });
    result('S27 decay', {
        run, resetAt, until, firstCannonDecayAt: DECAY_TICKS, resets: r.resets, resetTicks: r.resets.map(x => x.ticks),
        pass: r.end === 'stopped' && r.resets.length === 1 && r.resets[0]!.why === 'age' && r.endTick - r.fireTick >= until, ...summary(r),
    });
}

// ---------------------------------------------------------------- S27 windows
interface WindowRate { window: string; phase: Phase; ranged: number; /** Ranged level at mid-window, where the model places the rate. */ mid: number; control: string; ticks: number; R: number; D: number; H: number; prayer: SessionResult['prayer']; refires: number; dryEvents: number }

async function s27Window(name: string): Promise<WindowRate> {
    const m = /^(melee|bow)(\d+)(?:to(\d+))?(rune|bare)?$/.exec(name);
    if (!m) throw new Error(`window ${name}: melee<level>[rune], bow<level>[bare] or <melee|bow><from>to<to>`);
    const to = m[3] ? Number(m[3]) : null;
    // After Defence 99 the melee spec is S27's 'scimitar' phase (the same kit, its own row).
    const phase: Phase = m[1] === 'melee' ? (to ? 'scimitar' : 'melee') : 'bow';
    const ranged = Number(m[2]);
    const control = to ? 'segment' : (m[4] ?? '');
    const wopts: RangedOptions = control === 'rune' ? { ...opts, scimitar: /^rune scimitar$/i } : opts;
    await fixture(
        { attack: 99, strength: 99, defence: phase === 'melee' ? 98 : 99, ranged, hitpoints: 90, prayer: 99 },
        s27Kit(control),
        control === 'rune' ? [/^rune scimitar$/i, /^amulet of glory/i] : [/^mithril scimitar$/i],
    );
    const pre = combatFinishStep(wopts).preconditions(sdk.getState()!, {} as never);
    if (pre !== true) throw new Error(`S27 precondition (${name}): ${pre}`);
    const r = await runSession(rsdk, {
        ...combatFinishOptions(wopts),
        phaseOf: () => phase,
        stop: (s, fire) => (to ? (s.skills.find(k => k.name === 'Ranged')?.baseLevel ?? 1) >= to : s.tick - fire >= TICKS),
    });
    const row = r.phases[0]!;
    const per = (v: number) => +(v / Math.max(1, row.ticks)).toFixed(2);
    const mid = levelForXp(Math.round((xpForLevel(ranged) / XP_RATE + (row.xp.Ranged / 2)) * XP_RATE));
    const w: WindowRate = { window: name, phase, ranged, mid, control, ticks: row.ticks, R: per(row.xp.Ranged), D: per(row.xp.Defence), H: per(row.xp.Hitpoints), prayer: r.prayer, refires: r.refires, dryEvents: r.dryEvents };
    if (to) {
        result(`S27 ${name}`, { window: name, from: ranged, to, firingTicks: r.endTick - r.fireTick, ticks: r.ticks, setUpTicks: r.setUpTicks, R: w.R, H: w.H, attacks: r.attacks, prayer: r.prayer, refires: r.refires, overBudget: r.overBudget, end: r.end });
        return w;
    }
    const target = phase === 'melee' || phase === 'scimitar' ? { R: 13.66, D: 7.65 } : { R: ({ 70: 15.77, 85: 19.02, 99: 20.43 } as Record<number, number>)[ranged] };
    const within = Object.fromEntries(Object.entries(target).filter(([, v]) => v !== undefined).map(([k, v]) => [k, +((w[k as 'R' | 'D'] / v! - 1) * 100).toFixed(1)]));
    result(`S27 ${name}`, { ...w, targetPerTick: target, deltaPct: within, prayerFlat: r.prayer.end >= r.prayer.start - 1 && r.prayer.min >= r.prayer.start - 3, ...summary(r) });
    return w;
}

/**
 * cannon-kit-model.ts plan (e) on measured rates: melee to the Defence gap, then the
 * cannon with the scimitar (still meleeing: specFor's default) to Ranged 70, then the bow.
 * Ranged rates are linear in level between measured windows and flat outside them.
 */
function predict(ws: WindowRate[]) {
    const curve = (pts: [number, number][]) => (l: number) => {
        const c = [...pts].sort((a, b) => a[0] - b[0]);
        if (!c.length) return NaN;
        if (l <= c[0]![0]) return c[0]![1];
        for (let i = 1; i < c.length; i++) if (l <= c[i]![0]) { const [l0, v0] = c[i - 1]!, [l1, v1] = c[i]!; return v0 + ((v1 - v0) * (l - l0)) / (l1 - l0); }
        return c[c.length - 1]![1];
    };
    const melee = ws.filter(w => w.phase === 'melee' && !w.control), bow = ws.filter(w => w.phase === 'bow' && !w.control);
    if (!melee.length || !bow.length) return null;
    const meleeR = curve(melee.map(w => [w.mid, w.R])), meleeH = curve(melee.map(w => [w.mid, w.H]));
    const D = melee.reduce((a, w) => a + w.D, 0) / melee.length;
    const bowR = curve(bow.map(w => [w.mid, w.R])), bowH = curve(bow.map(w => [w.mid, w.H]));
    const LV = (l: number) => xpForLevel(l) / XP_RATE;
    const R0 = LV(50) + 485, D_GAP = 1288; // Ranged 50 from S14 + the Jungle Demon; Defence gap after Dragon Slayer
    // Level by level (by index, so float rounding at a boundary cannot stall it), until
    // Ranged reaches `to` or `maxT` ticks pass; returns the ticks, Hitpoints and Ranged reached.
    const integrate = (from: number, to: number, rate: (l: number) => number, by: (l: number) => number, maxT = Infinity) => {
        let t = 0, x = from, h = 0;
        for (let l = levelForXp(Math.round(from * XP_RATE)); l <= 99 && x < to && t < maxT; l++) {
            const end = l < 99 ? Math.min(to, LV(l + 1)) : to;
            if (end <= x) continue;
            const dt = Math.min((end - x) / rate(l), maxT - t);
            t += dt; h += by(l) * dt; x += rate(l) * dt;
        }
        return { t, h, x };
    };
    const tMelee = D_GAP / D; // the Defence gap closes at D per tick
    const meleePhase = integrate(R0, LV(99), meleeR, meleeH, tMelee);
    const rAfterMelee = meleePhase.x, hMelee = meleePhase.h;
    const scim = integrate(rAfterMelee, LV(70), meleeR, meleeH);
    const bowPhase = integrate(Math.max(rAfterMelee, LV(70)), LV(99), bowR, bowH);
    const hp = hMelee + scim.h + bowPhase.h;
    const rows = [4220, 4938].map(gap => ({ hitpointsGap: gap, hitpointsAfter: Math.max(0, gap - hp), hitpointsTicks: Math.max(0, gap - hp) / meleeH(99) }));
    const fight = tMelee + scim.t + bowPhase.t;
    return {
        melee: +tMelee.toFixed(0), rangedAfterMelee: levelForXp(rAfterMelee * XP_RATE), scimitar: +scim.t.toFixed(0), bow: +bowPhase.t.toFixed(0), fight: +fight.toFixed(0),
        hitpointsByProduct: +hp.toFixed(0),
        totals: rows.map(r => ({ ...r, hitpointsAfter: +r.hitpointsAfter.toFixed(0), hitpointsTicks: +r.hitpointsTicks.toFixed(0), total: +(fight + r.hitpointsTicks).toFixed(0) })),
        note: 'set-up (~10) and pick-up are outside these totals; the 1,889 expectation is 1,857 + 20 (no glory) + 12 (mithril), both of which these rates already carry',
    };
}

/** Dwarf Cannon complete as the quest tab shows it: the varp, then a relog so login's ~update_questlist colours the tab. */
async function cannonQuestDone() {
    await bot.skipTutorial().catch(() => {});
    await dismiss();
    if (questDone('mcannon')(sdk.getState()!)) return;
    await tele(sdk, 3093, 3493);
    await setvar(sdk, 'mcannon', 11);
    const r = await relog(session);
    await waitUntil(sdk, s => questDone('mcannon')(s), { maxTicks: 10 });
    result('quest tab', { mcannon: sdk.getState()?.quests?.mcannon ?? null, relogAttempts: r.attempts });
}

try {
    await cannonQuestDone();
    if (MODE === 'decay') for (let i = 0; i < N; i++) {
        try { await decay(i); } catch (e) { result('S27 decay error', { run: i, error: String(e) }); }
    }
    if (MODE === 's14' || MODE === 'both') for (let i = 0; i < N; i++) {
        try { await s14(i); } catch (e) { result('S14 error', { run: i, error: String(e) }); }
    }
    if (MODE === 's27' || MODE === 'both') {
        const ws: WindowRate[] = [];
        for (let i = 0; i < N; i++) for (const w of WINDOWS) {
            try { ws.push(await s27Window(w)); } catch (e) { result(`S27 ${w} error`, { run: i, error: String(e) }); }
        }
        const segs = [...new Set(ws.filter(w => w.control === 'segment').map(w => w.window))];
        if (segs.length) result('S27 segments', Object.fromEntries(segs.map(name => {
            const t = ws.filter(w => w.window === name).map(w => w.ticks);
            return [name, { runs: t, mean: +(t.reduce((a, b) => a + b, 0) / t.length).toFixed(1) }];
        })));
        result('S27 rates', ws.map(w => ({ window: w.window, mid: w.mid, R: w.R, D: w.D, H: w.H, prayer: w.prayer, refires: w.refires })));
        result('S27 prediction', predict(ws));
    }
} finally {
    await closeSession(session).catch(() => undefined);
}
process.exit(0);
