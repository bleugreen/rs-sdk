// Pickpocket cadence: click the target every server tick, eat in success windows.
// Ported from docs/speedrun/scripts/thieving-pickpocket.ts (its realistic `--eat=auto`
// policy); the cadence and its sources are in docs/speedrun/skills/thieving.md.
//
// A success costs 2 ticks and a failure 11 (an 8-tick stun plus 3). Clicks during a
// stun are dropped, not queued, so the program clicks through the stun's last tick:
// clicking every tick needs no reaction at all, and in the page each click leaves
// in the pass that decoded the tick.
//
// Eating adds 3 to the action delay. In the tick of the click that follows a
// success, at least 4 ticks after the last stun ended, it leaves the 2-tick cadence
// intact; during a stun it costs 3 ticks. So the program eats in such a success
// window once HP is at or below `eatBelow`, and at once only when HP is at or
// below `forcedBelow` (the next failure's damage could kill), re-sending each tick
// until HP rises. `eatBelow` defaults to `maxHp - heal`, but never below
// `forcedBelow + 1`: at 10 Hitpoints `maxHp - heal` is negative and would leave
// every eat to the forced path, inside a stun.
//
// An eat send can be rejected (the player is delayed), so `eats` and `forcedEats`
// count bites that landed, seen as a change in the food slots, and `eatSends` the
// packets. A banknote of the food shares its name but has no Eat option, so it is
// not food. The roll gap that follows a bite is also kept apart
// (`gapAfterSuccessEat`, `gapAfterFailEat`), and `eatTicksLost` sums what those
// gaps cost over the plain 2 and 11: the time lost to eating.
//
// `stopWhenFoodBelow: n` (off by default) ends the run with `reason: 'food'` once fewer
// than n food items are left and the program would need to eat: in a success window at
// or below `eatBelow`, or at or below `forcedBelow` once the stun is over. Either way the
// player is free to walk to a bank at once. Every end carries its `reason`, and
// `levelTicks` the tick (from the start) each Thieving level was first seen.
//
// `retargetTicks: n` (off by default): the nearest target by distance can be one the
// player cannot reach (behind a wall, inside a building), so clicks route nowhere and
// nothing rolls. With no roll for n ticks outside a stun and outside an idle trade, the
// program avoids that target for AVOID_TICKS and takes the next nearest. A knight's
// longest follow is about 8 ticks, so 12 never fires on a reachable target.
//
// `prefer: [npcIndex, ...]` (off by default): whenever the program takes a fresh target (its
// first, one given up by `retargetTicks`, or one gone from sight) it takes the first listed
// index that matches `npc`, is in sight and is not avoided, and only then the nearest. The step
// module orders the list (thieving.ts `knight`), so a retarget off the first goes to the second.
// With a list, the target's index is published as the `target` gauge.
//
// Stun actions (`stunActions`, off by default): rs/106's stun pack. On the ticks of the window
// after a failure (`stunWindow`, offsets from the tick that shows it) the program sends actions
// resolved from the inventory, ahead of the knight click: bury, Charge, arrowheads on headless
// arrows, or any item, item-on-item, spell-on-item or button template. Timing, costs and the
// template shape are in stun-actions.ts. The click still goes out every tick, last.
//
// Top-up trades (stun-pack.md section 5). The knight click goes out on every tick, stun ticks
// included, and a click closes an open trade, as do an inventory op and Charge's if_close; a
// click sent after a trade request in the same tick also replaces the request's interaction.
// Two ways to run a top-up inside a stun:
//
// - In the program (preferred): a `player` stun action sends the request, gated with `fewer`
//   (e.g. fewer than 3 bones) and placed first in `stunActions`, so it goes out at offset +2.
//   It owns its tick (no click, no other stun action), the program sends nothing more until
//   the trade opens (at most REQUEST_HOLD ticks), and with `idleOnInterface: true` the
//   program sends nothing at all while the trade is open (no page resume, no eat, no stun
//   action, no click), resuming on the first tick it is closed. The step module only accepts
//   the offer and confirm screens. rs/106's trades requested at +2 completed at +7 or +8, so
//   the click sent on +9, which lands on T+11, keeps the next attempt on time; a trade still
//   open then delays the attempt by the ticks it stays open.
// - Stop and restart: the module stops the program before its own request and restarts it once
//   the trade is done, by +9 at the latest. The restarted program has not seen that failure,
//   so it sends no stun actions for the rest of that stun (a top-up stun buries nothing in
//   rs/106's plan either). Stopping targets come from game state (untilLevel, maxTicks), so a
//   restart loses nothing but `rolls`, which counts from the restart.

import type { NearbyNpc } from '../types.js';
import { modalOpen, StunPack } from './stun-actions.js';
import type { ProgramParams, TickProgram } from './types.js';
import { baseLevel, FreshMessages, itemOp, num, oneOf, regex, skillXp } from './util.js';

export type PickpocketEnd = 'level' | 'rolls' | 'maxTicks' | 'food';

/** How long a target given up by `retargetTicks` stays avoided. */
const AVOID_TICKS = 100;

createPickpocket.params = ['npc', 'option', 'rolls', 'untilLevel', 'maxTicks', 'every', 'eat', 'food', 'heal', 'forcedBelow', 'eatBelow', 'stopWhenFoodBelow', 'retargetTicks', 'prefer', 'idleOnInterface', 'stunActions', 'stunWindow', 'stunPerTick'] as const;
export function createPickpocket(params: ProgramParams): TickProgram {
    const npcRe = regex(params.npc, '^Knight of Ardougne$', 'npc');
    const opRe = regex(params.option, '^pickpocket$', 'option');
    const rollsTarget = num(params.rolls, Infinity, 'rolls');
    const untilLevel = num(params.untilLevel, 0, 'untilLevel');
    const maxTicks = num(params.maxTicks, Infinity, 'maxTicks');
    if (rollsTarget === Infinity && !untilLevel && maxTicks === Infinity) throw new Error('give rolls, untilLevel or maxTicks');
    const every = Math.max(1, num(params.every, 1, 'every'));
    const eat = oneOf(params.eat, ['window', 'none'] as const, 'window', 'eat');
    const foodRe = regex(params.food, '^(shark|lobster|swordfish|monkfish|tuna|salmon|trout)$', 'food');
    const heal = num(params.heal, 12, 'heal');
    const forcedBelow = num(params.forcedBelow, 3, 'forcedBelow');
    const eatBelowParam = params.eatBelow === undefined ? undefined : num(params.eatBelow, 0, 'eatBelow');
    const stopBelow = num(params.stopWhenFoodBelow, 0, 'stopWhenFoodBelow');
    const retargetTicks = num(params.retargetTicks, 0, 'retargetTicks');
    const preferParam = params.prefer ?? [];
    if (!Array.isArray(preferParam) || !preferParam.every(i => Number.isInteger(i) && i >= 0)) throw new Error('prefer must be a list of npc indices');
    const prefer: readonly number[] = preferParam;
    const idleOnInterface = params.idleOnInterface === true;
    const stun = params.stunActions === undefined ? null : new StunPack({ actions: params.stunActions, window: params.stunWindow, perTick: params.stunPerTick });

    const freshTarget = (candidates: NearbyNpc[]): NearbyNpc | undefined =>
        prefer.map(i => candidates.find(n => n.index === i)).find(n => n !== undefined) ?? candidates.sort((a, b) => a.distance - b.distance)[0];

    const messages = new FreshMessages();
    let started = false;
    let startTick = 0;
    let target: NearbyNpc | undefined;
    let targetSince = 0;
    let lastIdleTick = -100;
    const avoid = new Map<number, number>();
    let lastStunEnd = -100;
    let lastEatTick = -100;
    let lastEatForced = false;
    let lastHp = 0;
    let noTargetRun = 0;
    let rolls = 0;
    let successes = 0;
    let lastRoll: { tick: number; ok: boolean } | null = null;
    const gapAfterSuccess: Record<number, number> = {};
    const gapAfterFail: Record<number, number> = {};
    const gapAfterSuccessEat: Record<number, number> = {};
    const gapAfterFailEat: Record<number, number> = {};
    let eatTicksLost = 0;
    let bitSinceRoll = false;
    let firstRollTick: number | null = null;
    let lastRollTick = 0;
    let eats = 0;
    let forcedEats = 0;
    let eatSends = 0;
    let hpLost = 0;
    let foodKey = '';
    let foodSlots = 0;
    let startXp = 0;
    let xpNow = 0;
    let lastTick = 0;
    let level = 0;
    const levelTicks: Record<number, number> = {};

    const roll = (t: number, ok: boolean) => {
        if (lastRoll) {
            const gap = t - lastRoll.tick;
            const h = lastRoll.ok ? gapAfterSuccess : gapAfterFail;
            h[gap] = (h[gap] ?? 0) + 1;
            if (bitSinceRoll) {
                const he = lastRoll.ok ? gapAfterSuccessEat : gapAfterFailEat;
                he[gap] = (he[gap] ?? 0) + 1;
                eatTicksLost += Math.max(0, gap - (lastRoll.ok ? 2 : 11));
            }
        }
        bitSinceRoll = false;
        lastRoll = { tick: t, ok };
        rolls++;
        if (ok) successes++;
        if (firstRollTick === null) firstRollTick = t;
        lastRollTick = t;
    };

    const summary = () => ({
        npc: target?.name,
        rolls,
        successes,
        fails: rolls - successes,
        successRate: rolls ? Math.round((successes / rolls) * 10000) / 10000 : 0,
        ticks: lastTick - startTick,
        rollsPerTick: firstRollTick !== null && lastRollTick > firstRollTick ? Math.round(((rolls - 1) / (lastRollTick - firstRollTick)) * 10000) / 10000 : 0,
        gapAfterSuccess,
        gapAfterFail,
        gapAfterSuccessEat,
        gapAfterFailEat,
        eats,
        forcedEats,
        eatSends,
        eatTicksLost,
        hpLost,
        foodLeft: foodSlots,
        level,
        /** Ticks from the start at which each Thieving level was first observed (the start level at 0). */
        levelTicks,
        baseXp: (xpNow - startXp) / 25,
        ...(stun ? { stun: stun.summary() } : {})
    });

    const finish = (ctx: { done(result?: unknown): void }, reason: PickpocketEnd) => ctx.done({ ...summary(), reason });

    return {
        stallTicks: 60,
        snapshot: summary,
        onTick(ctx) {
            const s = ctx.state;
            const t = ctx.tick;
            lastTick = t;
            if (!s.player) return;
            const foodNow = s.inventory.filter(i => foodRe.test(i.name) && i.optionsWithIndex.some(o => /^eat$/i.test(o.text)));
            const key = foodNow.map(i => `${i.slot}:${i.name}`).join('|');
            if (!started) {
                started = true;
                startTick = t;
                messages.take(s); // what was already on screen is not this run's
                lastHp = s.player.hp;
                startXp = skillXp(s, 'thieving');
                level = baseLevel(s, 'thieving');
                levelTicks[level] = 0;
                foodKey = key;
                foodSlots = foodNow.length;
            }
            xpNow = skillXp(s, 'thieving');
            const lvl = baseLevel(s, 'thieving');
            if (lvl > level) {
                for (let l = level + 1; l <= lvl; l++) levelTicks[l] = t - startTick;
                level = lvl;
            }
            const hp = s.player.hp;
            const maxHp = s.player.maxHp;
            const eatBelow = eatBelowParam ?? Math.max(forcedBelow + 1, maxHp - heal);

            // A bite is the food slots changing, without growing, in the ticks after an
            // eat was sent (a cake's bite renames its slot; a fish's empties it). Food a
            // trade adds grows the slots and is not a bite.
            if (key !== foodKey) {
                if (t - lastEatTick <= 3 && foodNow.length <= foodSlots) {
                    eats++;
                    ctx.count('eats');
                    bitSinceRoll = true;
                    if (lastEatForced) {
                        forcedEats++;
                        ctx.count('forcedEats');
                    }
                }
                foodKey = key;
            }
            foodSlots = foodNow.length;
            ctx.gauge('food', foodSlots);

            // Rolls are timed by their messages, emitted on the roll tick.
            let picked = 0;
            const rollsBefore = rolls;
            for (const m of messages.take(s)) {
                if (/^You pick the/i.test(m.text)) {
                    picked++;
                    roll(t, true);
                } else if (/You fail to pick/i.test(m.text)) {
                    roll(t, false);
                    ctx.count('fails');
                    stun?.failure(t);
                } else if (/You've been stunned/i.test(m.text)) {
                    lastStunEnd = t + 8;
                } else if (/during combat/i.test(m.text)) {
                    ctx.count('combatBlocks');
                }
            }
            if (picked) ctx.count('successes', picked);
            if (rolls > rollsBefore) {
                ctx.count('rolls', rolls - rollsBefore);
                ctx.progress();
            }
            if (hp < lastHp) {
                hpLost += lastHp - hp;
                ctx.count('hpLost', lastHp - hp);
            }
            lastHp = hp;

            if (untilLevel && lvl >= untilLevel) return finish(ctx, 'level');
            if (rolls >= rollsTarget) return finish(ctx, 'rolls');
            if (t - startTick > maxTicks) return finish(ctx, 'maxTicks');
            if (hp <= 0 || s.player.isDead) return ctx.fault('died', summary());

            if (stun?.holding(t, s)) {
                // a trade request waits for its trade: any packet would replace or close it
                ctx.count('requestHoldTicks');
                lastIdleTick = t;
                return;
            }
            if (idleOnInterface && modalOpen(s)) {
                // a trade (or another modal) owns the account: any packet would close it
                ctx.count('interfaceTicks');
                lastIdleTick = t;
                return;
            }

            const window = picked > 0 && t - lastStunEnd >= 4;
            const forced = hp <= forcedBelow;
            if (stopBelow > 0 && foodNow.length < stopBelow && ((window && hp <= eatBelow) || (forced && t >= lastStunEnd))) return finish(ctx, 'food');

            if (s.dialog?.isOpen) ctx.send({ type: 'clickDialogOption', optionIndex: 0 }, 'dismiss dialog');

            const food = foodNow[0];
            if (eat === 'window' && food) {
                const eatWindow = window && t - lastEatTick >= 3;
                if ((eatWindow && hp <= eatBelow) || forced) {
                    if (ctx.send({ type: 'useInventoryItem', slot: food.slot, optionIndex: itemOp(food, /^eat$/i, 1) }, forced && !eatWindow ? 'eat (forced)' : 'eat')) {
                        eatSends++;
                        lastEatTick = t;
                        lastEatForced = !eatWindow;
                        ctx.count('eatSends');
                    }
                }
            } else if (eat === 'window' && !food && hp <= eatBelow) {
                ctx.count('outOfFood');
            }

            // After the page resume and any eat, before the click (an arrow action clears the
            // interaction). A trade request owns its tick: a click after it would replace it.
            if (stun?.act(ctx)) return;

            if (retargetTicks > 0 && target && t - Math.max(targetSince, lastRollTick, lastStunEnd + 3, lastIdleTick) > retargetTicks) {
                avoid.set(target.index, t + AVOID_TICKS);
                target = undefined;
                ctx.count('retargets');
            }
            const cur = target;
            target = cur && s.nearbyNpcs.some(n => n.index === cur.index)
                ? s.nearbyNpcs.find(n => n.index === cur.index)
                : freshTarget(s.nearbyNpcs.filter(n => npcRe.test(n.name) && !((avoid.get(n.index) ?? 0) > t)));
            if (target && target.index !== cur?.index) {
                targetSince = t;
                if (prefer.length) ctx.gauge('target', target.index);
            }
            const op = target?.optionsWithIndex.find(o => opRe.test(o.text));
            if ((t - startTick) % every !== 0) return;
            if (target && op) {
                noTargetRun = 0;
                ctx.send({ type: 'interactNpc', npcIndex: target.index, optionIndex: op.opIndex }, `pickpocket #${target.index}`);
            } else {
                ctx.count('noTarget');
                if (++noTargetRun >= 20) return ctx.fault('no target in sight for 20 ticks', summary());
            }
        }
    };
}
