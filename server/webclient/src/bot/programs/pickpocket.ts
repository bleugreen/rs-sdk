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

import type { NearbyNpc } from '../types.js';
import type { ProgramParams, TickProgram } from './types.js';
import { baseLevel, FreshMessages, invItem, itemOp, num, oneOf, regex, skillXp } from './util.js';

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
        baseXp: (xpNow - startXp) / 25
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
