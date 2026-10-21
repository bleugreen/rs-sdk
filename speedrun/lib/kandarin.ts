// Getting a low-level account from the Lumbridge side into Kandarin (Seers'
// Village, Catherby, the Ranging Guild, the Dwarf Cannon camp): travel with
// retries, the settings the White Wolf Mountain crossing needs, and training on
// the Lumbridge cows. Every role that makes the walk uses this module.
//
// The only land route into Kandarin for a fresh account goes over White Wolf
// Mountain (the dwarf tunnel needs Fishing Contest, done on the far side).
// Measured by the woodcutter role (docs/speedrun/helpers/woodcutter.md, "The
// crossing"): 10 Hitpoints with auto-retaliate on died 4 times in 4; 10
// Hitpoints running with it off died every time (the switchback passes the White
// wolf sentries twice and the wolf pack once: wolves hit 2-4, the Big Wolf 7,
// 10-17 damage per attempt); 30 Hitpoints running with it off arrived 12 times
// in 14. A death keeps one unit of each of the three priciest items
// (death.rs2), so a carried coin stack is lost: carry coins only with Hitpoints
// well above 30.
import type { BotActions } from '../../sdk/actions';
import type { BotSDK } from '../../sdk/index';
import type { BotWorldState } from '../../sdk/types';

export interface Pt {
    x: number;
    z: number;
}

type Log = (message: string, data?: Record<string, unknown>) => void;

/** What the walking and training helpers need from a role's context. */
export interface Traveller {
    bot: BotActions;
    sdk: BotSDK;
    log: Log;
    /** Throws to stop the role (checked between steps). */
    checkSignal: () => void;
}

/** Player controls tab buttons (server/content/pack/interface.pack, player_controls.rs2). */
export const IF_AUTO_RETALIATE_OFF = 151; // controls:com_3
export const IF_RUN_ON = 153; // controls:com_5

/** Hitpoints level to have before the first crossing (see the header). */
export const CROSSING_HITPOINTS = 30;

/** East of the mountain, past Falador's walls: the leg every crossing walks through (walkTo plans each leg). */
export const TAVERLEY: Pt = { x: 2880, z: 3410 };
/** West of Taverley, on the mountain or past it, above ground: the walk to Seers' is one leg from here. */
export const westOfTaverley = (p: Pt): boolean => p.x < 2870 && p.z < 6400;

/** Inside the Lumbridge cow pen (x 3242-3265, z 3255-3298; learnings/combat.md). */
export const COW_PEN: Pt = { x: 3253, z: 3285 };
export const inCowPen = (p: Pt): boolean => p.x >= 3242 && p.x <= 3265 && p.z >= 3255 && p.z <= 3298;

/** Seers' Village, Catherby and the Ranging Guild, on the ground floor. */
export const inKandarin = (s: BotWorldState | null): boolean =>
    !!s?.player && s.player.level === 0 && s.player.worldX >= 2650 && s.player.worldX <= 2830 && s.player.worldZ >= 3370 && s.player.worldZ <= 3530;

/** Chebyshev distance in tiles. */
export const cheb = (a: Pt, b: Pt): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

function pos(sdk: BotSDK) {
    const p = sdk.getState()?.player;
    return p ? { x: p.worldX, z: p.worldZ, level: p.level } : null;
}

/**
 * Auto-retaliate off and run on. White Wolf Mountain's wolves (level 25, and
 * the level-73 Big Wolf, wanderrange 20) are aggressive to a low-level account;
 * with auto-retaliate on, the first hit queues p_opnpc (auto_retaliate.rs2) and
 * replaces the walk with a fight the account cannot win.
 */
export async function crossingSettings(sdk: BotSDK, log: Log): Promise<void> {
    for (let attempt = 1; attempt <= 3 && sdk.getState()?.autoRetaliateEnabled !== false; attempt++) {
        await sdk.sendClickComponent(IF_AUTO_RETALIATE_OFF);
        try {
            await sdk.waitForCondition(s => s.autoRetaliateEnabled === false, 3000);
        } catch {
            log('auto-retaliate still on', { attempt, reported: sdk.getState()?.autoRetaliateEnabled });
        }
    }
    // Run energy is infinite on the demo (NODE_INFINITE_RUN); the toggle makes
    // every step a run step instead of relying on per-click run.
    await sdk.sendClickComponent(IF_RUN_ON);
}

/** Walk with the SDK pathfinder, retrying from wherever the last attempt stopped. Throws on death or after 6 tries. */
export async function travel(t: Traveller, dest: Pt, tolerance = 2, what = '', timeout = 180_000): Promise<void> {
    for (let attempt = 1; attempt <= 6; attempt++) {
        t.checkSignal();
        await t.bot.dismissBlockingUI();
        if (t.sdk.getState()?.player?.isDead) await t.sdk.waitForTicks(10);
        const here = pos(t.sdk);
        if (here && cheb(here, dest) <= tolerance) return;
        const r = await t.bot.walkTo(dest.x, dest.z, tolerance, { timeout });
        if (r.success) return;
        if (/died/i.test(r.message)) {
            // A death resets nothing here, but the respawn may have: re-apply before the caller retries.
            await crossingSettings(t.sdk, t.log);
            throw new Error(`died walking to ${what}`);
        }
        t.log('walk retry', { to: what || dest, attempt, reason: r.message, at: pos(t.sdk) });
        await t.sdk.waitForTicks(3);
    }
    throw new Error(`could not reach ${what || JSON.stringify(dest)} from ${JSON.stringify(pos(t.sdk))}`);
}

/** From the Lumbridge side to `dest` in Kandarin, over White Wolf Mountain. */
export async function crossToKandarin(t: Traveller, dest: Pt, what: string): Promise<void> {
    await crossingSettings(t.sdk, t.log);
    t.log('crossing to Kandarin', { from: pos(t.sdk), to: what, hitpoints: t.sdk.getSkill('Hitpoints')?.level });
    const t0 = t.sdk.getState()?.tick ?? 0;
    await travel(t, TAVERLEY, 4, 'Taverley', 300_000);
    await travel(t, dest, 3, what, 300_000);
    t.log('arrived in Kandarin', { at: what, ticks: (t.sdk.getState()?.tick ?? 0) - t0, hitpoints: t.sdk.getSkill('Hitpoints')?.level });
}

/**
 * Fight the Lumbridge cows until `done()`, in the first combat style that trains
 * `skill` (Strength with a melee weapon, Ranged with a bow and arrows equipped).
 * Cows hit for at most 1, so nothing here can die. Returns the kills.
 */
export async function trainOnCows(t: Traveller, skill: 'Strength' | 'Attack' | 'Defence' | 'Ranged', done: () => boolean): Promise<number> {
    await travel(t, COW_PEN, 4, 'Lumbridge cow pen');
    const state = () => {
        const s = t.sdk.getState();
        if (!s?.player) throw new Error('no game state');
        return s;
    };
    const style = state().combatStyle?.styles.find(s => s.trainsSkills.includes(skill));
    if (style && state().combatStyle?.currentStyle !== style.index) await t.sdk.sendSetCombatStyle(style.index);
    let kills = 0;
    while (!done()) {
        t.checkSignal();
        await t.bot.dismissBlockingUI();
        const s = state();
        if (s.player!.isDead) throw new Error('died at the cows');
        const me = { x: s.player!.worldX, z: s.player!.worldZ };
        if (!inCowPen(me)) await travel(t, COW_PEN, 4, 'Lumbridge cow pen');
        const cow = s.nearbyNpcs
            .filter(n => /^cow$/i.test(n.name) && !n.inCombat && inCowPen(n) && n.optionsWithIndex.some(o => /attack/i.test(o.text)))
            .sort((a, b) => a.distance - b.distance)[0];
        if (!cow) {
            await t.sdk.waitForTicks(2);
            continue;
        }
        const r = await t.bot.attack(cow);
        if (!r.success) {
            await t.sdk.waitForTicks(1);
            continue;
        }
        // Until the cow is gone (dead) or the fight has visibly stopped.
        let idle = 0;
        for (let i = 0; i < 100; i++) {
            await t.sdk.waitForTicks(1);
            const st = t.sdk.getState();
            if (!st?.player) break;
            if (st.dialog.isOpen) await t.bot.dismissBlockingUI();
            if (!st.nearbyNpcs.some(n => n.index === cow.index && /^cow$/i.test(n.name))) {
                kills++;
                break;
            }
            idle = st.player.combat?.inCombat ? 0 : idle + 1;
            if (idle >= 8) break;
        }
    }
    return kills;
}

/**
 * Train Hitpoints on the cows (Strength style) to `target` before a crossing.
 * Hitpoints 30 is ~190 damage dealt (1.33 base Hitpoints xp per damage, xp 25x on
 * the demo), ~24 cows; measured 661-1,488 ticks (19-31 kills). The Strength
 * trained alongside speeds the kills up. Returns the kills (0 when already there).
 */
export async function trainHitpointsOnCows(t: Traveller, target = CROSSING_HITPOINTS): Promise<number> {
    const hp = () => t.sdk.getSkill('Hitpoints')?.baseLevel ?? 10;
    if (hp() >= target) return 0;
    const t0 = t.sdk.getState()?.tick ?? 0;
    t.log('training hitpoints for the crossing', { hitpoints: hp(), target });
    const kills = await trainOnCows(t, 'Strength', () => hp() >= target);
    t.log('trained for the crossing', { hitpoints: hp(), kills, ticks: (t.sdk.getState()?.tick ?? 0) - t0, strength: t.sdk.getSkill('Strength')?.baseLevel });
    return kills;
}