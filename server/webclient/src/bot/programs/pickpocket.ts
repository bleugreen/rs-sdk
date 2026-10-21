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
// until HP rises.
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
import { baseLevel, FreshMessages, invItem, itemOp, num, oneOf, regex, skillXp } from './util.js';

createPickpocket.params = ['npc', 'option', 'rolls', 'untilLevel', 'maxTicks', 'every', 'eat', 'food', 'heal', 'forcedBelow', 'eatBelow'] as const;
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
    const idleOnInterface = params.idleOnInterface === true;
    const stun = params.stunActions === undefined ? null : new StunPack({ actions: params.stunActions, window: params.stunWindow, perTick: params.stunPerTick });

    const messages = new FreshMessages();
    let started = false;
    let startTick = 0;
    let target: NearbyNpc | undefined;
    let lastStunEnd = -100;
    let lastEatTick = -100;
    let lastHp = 0;
    let noTargetRun = 0;
    let rolls = 0;
    let successes = 0;
    let lastRoll: { tick: number; ok: boolean } | null = null;
    const gapAfterSuccess: Record<number, number> = {};
    const gapAfterFail: Record<number, number> = {};
    let firstRollTick: number | null = null;
    let lastRollTick = 0;
    let eats = 0;
    let forcedEats = 0;
    let startXp = 0;
    let xpNow = 0;
    let lastTick = 0;

    const roll = (t: number, ok: boolean) => {
        if (lastRoll) {
            const h = lastRoll.ok ? gapAfterSuccess : gapAfterFail;
            h[t - lastRoll.tick] = (h[t - lastRoll.tick] ?? 0) + 1;
        }
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
        eats,
        forcedEats,
        baseXp: (xpNow - startXp) / 25,
        ...(stun ? { stun: stun.summary() } : {})
    });

    return {
        stallTicks: 60,
        snapshot: summary,
        onTick(ctx) {
            const s = ctx.state;
            const t = ctx.tick;
            lastTick = t;
            if (!s.player) return;
            if (!started) {
                started = true;
                startTick = t;
                messages.take(s); // what was already on screen is not this run's
                lastHp = s.player.hp;
                startXp = skillXp(s, 'thieving');
            }
            xpNow = skillXp(s, 'thieving');
            const hp = s.player.hp;
            const maxHp = s.player.maxHp;
            const eatBelow = eatBelowParam ?? maxHp - heal;

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
            if (hp < lastHp) ctx.count('hpLost', lastHp - hp);
            lastHp = hp;

            if (rolls >= rollsTarget || t - startTick > maxTicks || (untilLevel && baseLevel(s, 'thieving') >= untilLevel)) return ctx.done(summary());
            if (hp <= 0 || s.player.isDead) return ctx.fault('died', summary());

            if (stun?.holding(t, s)) {
                // a trade request waits for its trade: any packet would replace or close it
                ctx.count('requestHoldTicks');
                return;
            }
            if (idleOnInterface && modalOpen(s)) {
                // a trade (or another modal) owns the account: any packet would close it
                ctx.count('interfaceTicks');
                return;
            }

            if (s.dialog?.isOpen) ctx.send({ type: 'clickDialogOption', optionIndex: 0 }, 'dismiss dialog');

            const food = invItem(s, foodRe);
            if (eat === 'window' && food) {
                const window = picked > 0 && t - lastStunEnd >= 4 && t - lastEatTick >= 3;
                const forced = hp <= forcedBelow;
                if ((window && hp <= eatBelow) || forced) {
                    if (ctx.send({ type: 'useInventoryItem', slot: food.slot, optionIndex: itemOp(food, /^eat$/i, 1) }, forced && !window ? 'eat (forced)' : 'eat')) {
                        eats++;
                        lastEatTick = t;
                        ctx.count('eats');
                        if (!window) {
                            forcedEats++;
                            ctx.count('forcedEats');
                        }
                    }
                }
            } else if (eat === 'window' && !food && hp <= eatBelow) {
                ctx.count('outOfFood');
            }

            // After the page resume and any eat, before the click (an arrow action clears the
            // interaction). A trade request owns its tick: a click after it would replace it.
            if (stun?.act(ctx)) return;

            const cur = target;
            target = cur && s.nearbyNpcs.some(n => n.index === cur.index)
                ? s.nearbyNpcs.find(n => n.index === cur.index)
                : s.nearbyNpcs.filter(n => npcRe.test(n.name)).sort((a, b) => a.distance - b.distance)[0];
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
