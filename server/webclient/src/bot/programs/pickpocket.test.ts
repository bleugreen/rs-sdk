import { describe, expect, test } from 'bun:test';

import '../../lite/test-support/browser-globals.js';

import { createHash } from 'crypto';
import { writeFileSync } from 'fs';

import { createPickpocket } from './pickpocket.js';
import { CHARGE_COMPONENT, type StunSummary } from './stun-actions.js';
import { Harness, makeState, type Sent } from './testkit.js';

interface Kit {
    food?: number;
    bones?: number;
    blood?: number;
    air?: number;
    /** Arrowhead stacks by tier name, e.g. { rune: 300 }. */
    heads?: Record<string, number>;
    headless?: number;
    magic?: number;
    fletching?: number;
}

interface Landing {
    tick: number;
    type: string;
    name?: string;
    /** Ticks after the start of the last failed attempt, when there is one. */
    sinceFail?: number;
    dropped: boolean;
}

/**
 * The engine's pickpocket timing (thieving.md section 4, stun-pack.md section 2). A packet sent
 * on a state lands on the next tick. A click landing on T while the player is free starts an
 * attempt: T+1 is delayed and the roll is on T+1, whose state shows it. A success frees the
 * player on T+2. A failure delays T+2 and T+3, deals 3 damage, and frees the player on T+11.
 * Every packet landing on a delayed tick is dropped. A bury delays the rest of its tick and the
 * next one (p_delay(0)); eating while not free adds 3 to the action delay; Charge and arrows
 * have no delay.
 *
 * With a `helper` standing next to the account: a trade request landing on L opens the trade
 * from L+2 (the helper answers on L+1) for `openTicks` states, then delivers `bones`. A click
 * landing after the request in the same tick replaces it; any packet landing while the trade
 * is open closes it with nothing delivered.
 */
interface ThieveOpts {
    ticks: number;
    outcome: (n: number) => boolean;
    hp?: number;
    /** Hitpoints cap (default 40). */
    maxHp?: number;
    /** Food item name and HP healed per bite (default Shark, 20); a bite uses the whole slot. */
    foodName?: string;
    heal?: number;
    /** HP lost per failure (default 3, a knight). */
    damage?: number;
    /** Thieving level from the number of successes so far (default 55 throughout). */
    level?: (successes: number) => number;
    params?: Record<string, unknown>;
    kit?: Kit;
    dialogAt?: (tick: number) => boolean;
    helper?: { openTicks?: number; bones: number };
}

function thieve(opts: ThieveOpts) {
    const h = new Harness('pp', createPickpocket);
    const kit = { food: 10, bones: 0, blood: 0, air: 0, headless: 0, magic: 80, fletching: 1, ...opts.kit, heads: { ...opts.kit?.heads } };
    const maxHp = opts.maxHp ?? 40;
    const foodName = opts.foodName ?? 'Shark';
    const heal = opts.heal ?? 20;
    const damage = opts.damage ?? 3;
    let bites = 0;
    let tick = 200;
    let hp = opts.hp ?? maxHp;
    let freeAt = 0;
    let n = 0;
    let prayerXp = 0;
    let magicXp = 0;
    let fletchXp = 0;
    const delayed = new Set<number>();
    const msgs: Array<{ text: string; tick: number }> = [];
    const rolls: Array<{ tick: number; ok: boolean }> = [];
    const failedAttempts: number[] = [];
    const landings: Landing[] = [];
    let attemptAt: number | null = null;
    const trade = { requests: 0, replaced: 0, opened: 0, done: 0, broken: 0, openFrom: -1, closeAt: -1, requestedOn: [] as number[], doneOn: [] as number[] };
    const tradeOpen = (t: number) => t >= trade.openFrom && t < trade.closeAt;
    const inventory = () => [
        ...Array.from({ length: kit.food }, () => ({ name: foodName, options: ['Eat', 'Drop'] })),
        ...Array.from({ length: kit.bones }, () => ({ name: 'Dragon bones', options: ['Bury', 'Drop'] })),
        ...(kit.blood ? [{ name: 'Blood rune', count: kit.blood }] : []),
        ...(kit.air ? [{ name: 'Air rune', count: kit.air }] : []),
        ...(kit.headless ? [{ name: 'Headless arrow', count: kit.headless }] : []),
        ...Object.entries(kit.heads).filter(([, c]) => c > 0).map(([tier, c]) => ({ name: `${tier[0]!.toUpperCase()}${tier.slice(1)} arrowheads`, count: c }))
    ];
    let inv = inventory();
    const state = () => {
        inv = inventory();
        return makeState({
            tick, hp, maxHp,
            skills: {
                Thieving: { xp: rolls.filter(r => r.ok).length * 84 * 25, level: opts.level?.(rolls.filter(r => r.ok).length) ?? 55 },
                Prayer: { xp: prayerXp, level: 43 },
                Magic: { xp: magicXp, level: kit.magic },
                Fletching: { xp: fletchXp, level: kit.fletching }
            },
            inventory: inv,
            npcs: [{ index: 12, name: 'Knight of Ardougne', options: ['Talk-to', 'Attack', 'Pickpocket'] }],
            messages: msgs.slice(-20),
            dialogOpen: opts.dialogAt?.(tick) ?? false,
            tradeOpen: tradeOpen(tick),
            players: opts.helper ? [{ index: 7, name: 'helper' }] : []
        });
    };
    h.start('pp', { maxTicks: opts.ticks, ...opts.params }, state());
    const pending: Array<{ at: number; sent: Sent; name?: string }> = [];
    for (let i = 0; i < opts.ticks + 5 && h.status.phase === 'running'; i++) {
        tick++;
        // processPlayers of the last tick's attempt: the roll
        if (attemptAt !== null && tick === attemptAt + 1) {
            const a = attemptAt;
            attemptAt = null;
            const ok = opts.outcome(n++);
            rolls.push({ tick, ok });
            if (ok) {
                msgs.push({ text: "You pick the knight's pocket.", tick });
                freeAt = a + 2;
            } else {
                msgs.push({ text: "You fail to pick the knight's pocket.", tick });
                msgs.push({ text: "You've been stunned!", tick });
                hp -= damage;
                delayed.add(a + 2);
                delayed.add(a + 3);
                freeAt = a + 11;
                failedAttempts.push(a);
            }
        }
        // a trade that ran its course delivers
        if (opts.helper && tick === trade.closeAt) {
            kit.bones += opts.helper.bones;
            trade.done++;
            trade.doneOn.push(tick);
        }
        // this tick's packets, in the order they were sent
        let dropRest = delayed.has(tick);
        let requestedNow = false;
        for (const p of pending.filter(p => p.at === tick)) {
            const a = p.sent.action;
            const lastFail = failedAttempts[failedAttempts.length - 1];
            landings.push({ tick, type: a.type, name: p.name, sinceFail: lastFail === undefined ? undefined : tick - lastFail, dropped: dropRest });
            if (dropRest) continue;
            if (tradeOpen(tick)) {
                // any packet closes an open trade, with nothing delivered
                trade.broken++;
                trade.closeAt = tick;
                trade.openFrom = -1;
            }
            if (a.type === 'interactPlayer' && opts.helper) {
                trade.requests++;
                trade.requestedOn.push(tick);
                requestedNow = true;
                continue;
            }
            if (requestedNow && a.type === 'interactNpc') {
                trade.replaced++;
                requestedNow = false;
            }
            if (a.type === 'interactNpc') {
                if (tick >= freeAt && attemptAt === null) {
                    attemptAt = tick;
                    delayed.add(tick + 1);
                }
            } else if (a.type === 'useInventoryItem' && p.name === foodName) {
                hp = Math.min(maxHp, hp + heal);
                kit.food--;
                bites++;
                if (tick < freeAt) freeAt += 3;
            } else if (a.type === 'useInventoryItem' && p.name === 'Dragon bones') {
                kit.bones--;
                prayerXp += 72 * 25;
                delayed.add(tick + 1);
                dropRest = true;
            } else if (a.type === 'clickComponent' && a.componentId === CHARGE_COMPONENT && kit.blood >= 3 && kit.air >= 3) {
                kit.blood -= 3;
                kit.air -= 3;
                magicXp += 180 * 25;
            } else if (a.type === 'useItemOnItem') {
                const tier = p.name?.split(' ')[0]?.toLowerCase();
                const have = tier ? (kit.heads[tier] ?? 0) : 0;
                const made = Math.min(15, have, kit.headless);
                if (tier) kit.heads[tier] = have - made;
                kit.headless -= made;
                fletchXp += made * 25;
            }
        }
        if (requestedNow && opts.helper) {
            trade.opened++;
            trade.openFrom = tick + 2;
            trade.closeAt = tick + 2 + (opts.helper.openTicks ?? 4);
        }
        for (const s of h.step(state())) {
            const slot = 'slot' in s.action ? s.action.slot : 'sourceSlot' in s.action ? s.action.sourceSlot : undefined;
            pending.push({ at: tick + 1, sent: s, name: slot === undefined ? undefined : inv[slot]?.name });
        }
    }
    const stunActions = landings.filter(l => l.type !== 'interactNpc' && l.type !== 'clickDialogOption' && !(l.type === 'useInventoryItem' && l.name === foodName));
    return { h, rolls, landings, stunActions, kit, failedAttempts, trade, bites: () => bites, hp: () => hp, xp: () => ({ prayerXp, magicXp, fletchXp }) };
}

type Result = {
    reason: string;
    gapAfterSuccess: Record<number, number>;
    gapAfterFail: Record<number, number>;
    gapAfterSuccessEat: Record<number, number>;
    gapAfterFailEat: Record<number, number>;
    rollsPerTick: number;
    rolls: number;
    fails: number;
    eats: number;
    forcedEats: number;
    eatSends: number;
    eatTicksLost: number;
    foodLeft: number;
    levelTicks: Record<number, number>;
    stun?: StunSummary;
};

const everyFifthFails = (n: number) => n % 5 !== 4;
const PACK = { kit: { bones: 14, blood: 6000, air: 6000, food: 4 }, params: { stunActions: ['bury', 'charge'] } };

describe('pickpocket', () => {
    test('clicks every tick; 2 ticks after a success, 11 after a failure', () => {
        const { h, rolls, landings } = thieve({ ticks: 300, outcome: everyFifthFails });
        const r = h.status.result as Result;
        expect(Object.keys(r.gapAfterSuccess)).toEqual(['2']);
        expect(Object.keys(r.gapAfterFail)).toEqual(['11']);
        // one click per tick, and nothing else without stun actions
        const clicks = h.sent.filter(s => s.action.type === 'interactNpc').map(s => s.tick);
        expect(new Set(clicks).size).toBe(clicks.length);
        expect(clicks.length).toBeGreaterThan(290);
        expect(h.sent.every(s => s.action.type === 'interactNpc' || s.action.type === 'useInventoryItem')).toBe(true);
        expect(r.stun).toBeUndefined();
        // 4 successes at 2 and one failure at 11: 5 rolls per 19 ticks
        expect(r.rollsPerTick).toBeCloseTo(5 / 19, 1);
        expect(rolls.length).toBeGreaterThan(70);
        // the clicks the model drops are the delayed ticks: one per success, two per failure
        expect(landings.filter(l => l.dropped).length).toBeGreaterThan(rolls.length);
    });

    test('eats in a success window, with the click, once HP is low', () => {
        const { h, bites } = thieve({ ticks: 400, outcome: n => n % 4 !== 3, params: { eatBelow: 28 } });
        const eats = h.sent.filter(s => s.action.type === 'useInventoryItem');
        expect(eats.length).toBeGreaterThan(0);
        for (const e of eats) {
            const same = h.sent.filter(s => s.tick === e.tick).map(s => s.action.type);
            expect(same).toEqual(['useInventoryItem', 'interactNpc']);
        }
        expect(h.status.counters.forcedEats ?? 0).toBe(0);
        const r = h.status.result as Result;
        expect(Object.keys(r.gapAfterFail)).toEqual(['11']);
        // window bites keep the 2-tick gap: nothing lost to eating
        expect(r.eats).toBe(bites());
        expect(Object.keys(r.gapAfterSuccessEat)).toEqual(['2']);
        expect(r.eatTicksLost).toBe(0);
    });

    test('forces an eat when the next failure could kill', () => {
        const { h } = thieve({ ticks: 200, hp: 7, outcome: () => false, params: { eatBelow: 0 } });
        expect(h.status.counters.forcedEats).toBeGreaterThan(0);
    });

    test('counts the bites that landed, not the eat packets, and prices a stun eat at 3 ticks', () => {
        // fail, fail: 7 -> 4 -> 1, forced at 1; the sends landing on the stun's delayed T+2 and T+3 are dropped
        const { h, bites } = thieve({ ticks: 60, hp: 7, outcome: n => n >= 2, params: { eatBelow: 0 } });
        const r = h.status.result as Result;
        expect(bites()).toBe(1);
        expect(r.eats).toBe(1);
        expect(r.forcedEats).toBe(1);
        expect(r.eatSends).toBe(3);
        expect(r.gapAfterFailEat).toEqual({ 14: 1 });
        expect(r.eatTicksLost).toBe(3);
        expect(r.gapAfterFail).toEqual({ 11: 1, 14: 1 });
    });

    test('at 10 HP the default eatBelow eats in success windows, not only when forced', () => {
        // the default heal 12 makes maxHp - heal negative; the floor is forcedBelow + 1 = 4
        const { h } = thieve({ ticks: 600, maxHp: 10, heal: 12, kit: { food: 28 }, outcome: n => n % 4 !== 3 });
        const r = h.status.result as Result;
        expect(r.eats).toBeGreaterThan(0);
        expect(r.forcedEats).toBe(0);
        expect(h.status.phase).toBe('done');
    });

    test('stopWhenFoodBelow ends with reason food when the last bite is gone and an eat is due', () => {
        // cakes at 10 HP: 4 per bite, eat at 6, forced at 1 (a man's 1 damage)
        const { h, kit, hp } = thieve({
            ticks: 2000, maxHp: 10, kit: { food: 2 }, foodName: 'Cake', heal: 4, damage: 1,
            outcome: n => n % 3 !== 2,
            params: { food: '^(Cake|2/3 cake|Slice of cake)$', eatBelow: 6, forcedBelow: 1, stopWhenFoodBelow: 1 }
        });
        const r = h.status.result as Result;
        expect(h.status.phase).toBe('done');
        expect(r.reason).toBe('food');
        expect(kit.food).toBe(0);
        expect(r.eats).toBe(2);
        expect(r.foodLeft).toBe(0);
        expect(hp()).toBeLessThanOrEqual(6);
        expect(hp()).toBeGreaterThan(1);
    });

    test('stopWhenFoodBelow waits out the stun before stopping at the forced threshold', () => {
        const { h, hp } = thieve({ ticks: 400, hp: 4, kit: { food: 0 }, outcome: () => false, params: { eatBelow: 0, stopWhenFoodBelow: 1 } });
        const r = h.status.result as Result;
        expect(r.reason).toBe('food');
        expect(hp()).toBe(1);
        // stopped at the stun's end: one roll, no attempt after the stop
        expect(r.rolls).toBe(1);
    });

    test('levelTicks records the tick each level was first seen; untilLevel ends with reason level', () => {
        const { h } = thieve({ ticks: 500, outcome: () => true, level: ok => 55 + Math.floor(ok / 10), params: { untilLevel: 58, maxTicks: undefined } });
        const r = h.status.result as Result;
        expect(r.reason).toBe('level');
        expect(Object.keys(r.levelTicks).map(Number)).toEqual([55, 56, 57, 58]);
        expect(r.levelTicks[55]).toBe(0);
        // 10 successes per level at 2 ticks each
        expect(r.levelTicks[57]! - r.levelTicks[56]!).toBe(20);
    });

    describe('retargetTicks', () => {
        const npcs = [
            { index: 12, name: 'Man', options: ['Talk-to', 'Pickpocket'], x: 3201, z: 3200 },
            { index: 13, name: 'Man', options: ['Talk-to', 'Pickpocket'], x: 3204, z: 3200 }
        ];
        // only the farther man (13) is reachable: a click on him rolls a success on the next tick
        const run = (params: Record<string, unknown>) => {
            const h = new Harness('pp', createPickpocket);
            h.start('pp', { rolls: 1, npc: '^Man$', ...params }, makeState({ tick: 1, npcs }));
            const msgs: Array<{ text: string; id: number }> = [];
            let pending: number | undefined;
            for (let t = 2; t < 40 && h.status.phase === 'running'; t++) {
                if (pending === 13) msgs.push({ text: "You pick the man's pocket.", id: t });
                const sent = h.step(makeState({ tick: t, npcs, messages: msgs }));
                pending = (sent.find(s => s.action.type === 'interactNpc')?.action as { npcIndex?: number } | undefined)?.npcIndex;
            }
            return { h, clicks: h.sent.filter(s => s.action.type === 'interactNpc').map(s => (s.action as { npcIndex: number }).npcIndex) };
        };

        test('a target that never rolls is given up for the next nearest', () => {
            const { h, clicks } = run({ retargetTicks: 12 });
            expect(h.status.phase).toBe('done');
            expect(h.status.counters.retargets).toBe(1);
            expect(clicks.slice(0, 13).every(i => i === 12)).toBe(true);
            expect(clicks[clicks.length - 1]).toBe(13);
        });

        test('off by default: the nearest target keeps every click', () => {
            const { h, clicks } = run({});
            expect(h.status.counters.retargets).toBeUndefined();
            expect(clicks.every(i => i === 12)).toBe(true);
            expect(h.status.gauges.target).toBeUndefined();
        });
    });

    describe('prefer', () => {
        // 12 nearest and 14 next, neither reachable; 13 farthest and reachable
        const npcs = [
            { index: 13, name: 'Man', options: ['Talk-to', 'Pickpocket'], x: 3204, z: 3200 },
            { index: 14, name: 'Man', options: ['Talk-to', 'Pickpocket'], x: 3202, z: 3200 },
            { index: 12, name: 'Man', options: ['Talk-to', 'Pickpocket'], x: 3201, z: 3200 }
        ];
        const run = (params: Record<string, unknown>) => {
            const h = new Harness('pp', createPickpocket);
            h.start('pp', { rolls: 1, npc: '^Man$', retargetTicks: 12, ...params }, makeState({ tick: 1, npcs }));
            const msgs: Array<{ text: string; id: number }> = [];
            let pending: number | undefined;
            const targets: number[] = [];
            for (let t = 2; t < 40 && h.status.phase === 'running'; t++) {
                if (pending === 13) msgs.push({ text: "You pick the man's pocket.", id: t });
                const sent = h.step(makeState({ tick: t, npcs, messages: msgs }));
                pending = (sent.find(s => s.action.type === 'interactNpc')?.action as { npcIndex?: number } | undefined)?.npcIndex;
                const g = h.status.gauges.target;
                if (g !== undefined && g !== targets[targets.length - 1]) targets.push(g);
            }
            return { h, targets, clicks: h.sent.filter(s => s.action.type === 'interactNpc').map(s => (s.action as { npcIndex: number }).npcIndex) };
        };

        test('the first listed index is the target, over a nearer one', () => {
            const { h, clicks, targets } = run({ prefer: [13, 12] });
            expect(h.status.phase).toBe('done');
            expect(h.status.counters.retargets).toBeUndefined();
            expect(clicks.every(i => i === 13)).toBe(true);
            expect(targets).toEqual([13]);
        });

        test('a retarget goes to the next listed index, not the next nearest', () => {
            const { h, clicks, targets } = run({ prefer: [12, 13] });
            expect(h.status.phase).toBe('done');
            expect(h.status.counters.retargets).toBe(1);
            expect(clicks.slice(0, 13).every(i => i === 12)).toBe(true);
            expect(clicks).not.toContain(14);
            expect(clicks[clicks.length - 1]).toBe(13);
            expect(targets).toEqual([12, 13]);
        });

        test('listed indices out of sight fall back to the nearest; a bad list is refused', () => {
            const { clicks } = run({ prefer: [99], rolls: 1, maxTicks: 6 });
            expect(clicks[0]).toBe(12);
            expect(() => createPickpocket({ rolls: 1, prefer: [1.5] })).toThrow('prefer must be a list of npc indices');
            expect(() => createPickpocket({ rolls: 1, prefer: 3 })).toThrow('prefer must be a list of npc indices');
        });
    });

    test('a banknote of the food is not food', () => {
        const h = new Harness('pp', createPickpocket);
        const npcs = [{ index: 12, name: 'Knight of Ardougne', options: ['Talk-to', 'Pickpocket'] }];
        const inventory = [{ name: 'Cake', options: [] }, { name: 'Cake', options: ['Eat', 'Drop'] }];
        h.start('pp', { rolls: 5, food: '^Cake$', forcedBelow: 3 }, makeState({ tick: 1, hp: 2, maxHp: 10, npcs, inventory }));
        const sent = h.step(makeState({ tick: 2, hp: 2, maxHp: 10, npcs, inventory }));
        expect(sent.find(s => s.action.type === 'useInventoryItem')?.action).toMatchObject({ slot: 1 });
        expect(h.status.gauges.food).toBe(1);
    });

    test('ends after the requested rolls', () => {
        const { h } = thieve({ ticks: 500, outcome: () => true, params: { rolls: 30, maxTicks: undefined } });
        expect(h.status.phase).toBe('done');
        expect((h.status.result as Result).rolls).toBe(30);
        expect((h.status.result as Result).reason).toBe('rolls');
    });

    test('faults when no target is in sight for 20 ticks', () => {
        const h = new Harness('pp', createPickpocket);
        h.start('pp', { rolls: 5 });
        for (let t = 1; t <= 25; t++) h.step(makeState({ tick: t }));
        expect(h.status.phase).toBe('fault');
    });
});

describe('pickpocket stun actions', () => {
    test("rs/106's plan: three Charges and a bury on k 2, 4, 6, inside the stun, cadence unchanged", () => {
        const plain = thieve({ ticks: 300, outcome: everyFifthFails, kit: PACK.kit });
        const pack = thieve({ ticks: 300, outcome: everyFifthFails, ...PACK });
        const r = pack.h.status.result as Result;
        const p = plain.h.status.result as Result;
        expect(Object.keys(r.gapAfterSuccess)).toEqual(['2']);
        expect(Object.keys(r.gapAfterFail)).toEqual(['11']);
        expect(r.rolls).toBe(p.rolls);
        expect(r.rollsPerTick).toBe(p.rollsPerTick);

        // every stun action lands on T+4..T+10 of its failed attempt, and none is dropped
        expect(pack.stunActions.length).toBeGreaterThan(0);
        for (const l of pack.stunActions) {
            expect(l.dropped).toBe(false);
            expect(l.sinceFail).toBeGreaterThanOrEqual(4);
            expect(l.sinceFail).toBeLessThanOrEqual(10);
        }
        // the stun's sends by offset k from the failure's tick: CCCB + click on 2, 4, 6; the click alone otherwise
        const fail = pack.rolls.find(x => !x.ok)!.tick;
        const byK = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(k => pack.h.sent.filter(s => s.tick === fail + k).map(s => s.action.type).join(','));
        const hhhb = 'clickComponent,clickComponent,clickComponent,useInventoryItem,interactNpc';
        expect(byK).toEqual(['interactNpc', 'interactNpc', hhhb, 'interactNpc', hhhb, 'interactNpc', hhhb, 'interactNpc', 'interactNpc', 'interactNpc']);

        // 3 bones per stun until they run out (14 bones: 4 full stuns and 2 over), 9 Charges while bones last
        const st = r.stun!;
        expect(st.stuns).toBe(r.fails);
        expect(st.rejected).toBe(0);
        expect(st.costly).toBe(0);
        expect(pack.xp().prayerXp).toBe(14 * 72 * 25);
        expect(st.byAction.bury).toBe(14);
        expect(pack.kit.bones).toBe(0);
        expect(pack.h.status.counters['stun:charge']).toBe(st.byAction.charge);
        expect(pack.xp().magicXp).toBe(st.byAction.charge! * 180 * 25);
    });

    test('with no bones every window tick carries four delay-free actions', () => {
        const { h, stunActions, rolls } = thieve({ ticks: 200, outcome: everyFifthFails, kit: { blood: 6000, air: 6000 }, params: { stunActions: ['bury', 'charge'] } });
        const r = h.status.result as Result;
        expect(Object.keys(r.gapAfterFail)).toEqual(['11']);
        expect(stunActions.every(l => !l.dropped && l.sinceFail! >= 4 && l.sinceFail! <= 9)).toBe(true);
        // k 2..7 each send 4 Charges and the click, the whole budget; k 0, 1 and 8 the click alone
        for (const fail of rolls.filter(x => !x.ok).map(x => x.tick).slice(0, -1)) {
            const perK = [0, 1, 2, 3, 4, 5, 6, 7, 8].map(k => h.sent.filter(s => s.tick === fail + k).length);
            expect(perK).toEqual([1, 1, 5, 5, 5, 5, 5, 5, 1]);
        }
        expect(h.status.deferred).toBe(0);
    });

    test('resolves from the inventory: never more Charges than the runes allow', () => {
        const { h } = thieve({ ticks: 200, outcome: everyFifthFails, kit: { blood: 10, air: 30 }, params: { stunActions: ['charge'] } });
        const charges = h.sent.filter(s => s.action.type === 'clickComponent');
        expect(charges.length).toBe(3);
        const st = (h.status.result as Result).stun!;
        expect(st.fired).toBe(3);
        // the rest of the stuns found nothing to do (the run may end inside the last one's window)
        expect(st.dry).toBeGreaterThanOrEqual(st.stuns - 2);
        expect(st.dry).toBeLessThanOrEqual(st.stuns - 1);
    });

    test('stops a skill-gated action at its level: no Charge at Magic 99', () => {
        const { h } = thieve({ ticks: 100, outcome: () => false, kit: { blood: 600, air: 600, magic: 99 }, params: { stunActions: ['charge'] } });
        expect(h.sent.some(s => s.action.type === 'clickComponent')).toBe(false);
    });

    test('arrows use the best tier the Fletching level allows', () => {
        const at = (fletching: number) => {
            // two stuns of 24 arrow actions use 720 of a tier's 1,200 heads
            const { stunActions } = thieve({ ticks: 20, outcome: () => false, kit: { headless: 3000, heads: { rune: 1200, mithril: 1200, bronze: 1200 }, fletching }, params: { stunActions: ['arrows'] } });
            expect(stunActions.length).toBe(48);
            expect(stunActions.every(l => !l.dropped)).toBe(true);
            return new Set(stunActions.map(l => l.name));
        };
        expect(at(50)).toEqual(new Set(['Mithril arrowheads']));
        expect(at(80)).toEqual(new Set(['Rune arrowheads']));
        expect(at(10)).toEqual(new Set(['Bronze arrowheads']));
    });

    test('a level-up page is resumed first, at the cost of one delay-free slot', () => {
        // the model is deterministic: find the failure's tick, then open a page on its k = 2
        const fail = thieve({ ticks: 60, outcome: n => n !== 1, ...PACK }).rolls.find(x => !x.ok)!.tick;
        const { h } = thieve({ ticks: 60, outcome: n => n !== 1, ...PACK, dialogAt: t => t === fail + 2 });
        const sends = h.sent.filter(s => s.tick === fail + 2).map(s => s.action.type);
        expect(sends).toEqual(['clickDialogOption', 'clickComponent', 'clickComponent', 'useInventoryItem', 'interactNpc']);
    });

    test('an action that writes the action delay counts as costly and pushes the next attempt by 3', () => {
        const eat = { name: 'eat', kind: 'item', item: '^shark$', option: '^eat$', delay: 'action', max: 1 };
        const { h } = thieve({ ticks: 200, outcome: everyFifthFails, hp: 20, kit: { food: 20 }, params: { stunActions: [eat], stunWindow: [2, 2], eatBelow: 0 } });
        const r = h.status.result as Result;
        expect(Object.keys(r.gapAfterFail)).toEqual(['14']);
        expect(r.stun!.costly).toBe(r.stun!.stuns);
        expect(h.status.counters.stunCostly).toBe(r.stun!.stuns);
    });

    describe('top-up trades', () => {
        const TOPUP = { name: 'topup', kind: 'player', player: '^helper$', fewer: [{ item: '^dragon bones$', than: 3 }], window: [2, 2] };
        const run = (idleOnInterface: boolean, openTicks?: number) =>
            thieve({ ticks: 260, outcome: everyFifthFails, kit: { bones: 4, blood: 6000, air: 6000, food: 4 }, helper: { bones: 12, openTicks }, params: { stunActions: [TOPUP, 'bury', 'charge'], idleOnInterface } });

        test('a request at +2 owns its tick, the program idles through the trade, and the attempt stays on time', () => {
            const r = run(true);
            const res = r.h.status.result as Result;
            expect(r.trade.replaced).toBe(0);
            expect(r.trade.broken).toBe(0);
            expect(r.trade.done).toBeGreaterThanOrEqual(2);
            // the last may still be open when the run ends
            expect(r.trade.done).toBeGreaterThanOrEqual(r.trade.opened - 1);
            expect(Object.keys(res.gapAfterFail)).toEqual(['11']);
            expect(Object.keys(res.gapAfterSuccess)).toEqual(['2']);
            for (const req of r.trade.requestedOn) {
                // the request lands on T+4 (sent on k = 2), alone in its tick
                const fail = r.failedAttempts.filter(a => a <= req).pop()!;
                expect(req - fail).toBe(4);
                expect(r.landings.filter(l => l.tick === req).map(l => l.type)).toEqual(['interactPlayer']);
                // the top-up stun buries nothing; the trade's ticks carry no packet at all
                expect(r.landings.some(l => l.tick > req && l.tick < fail + 11 && l.name === 'Dragon bones')).toBe(false);
            }
            expect(r.h.status.counters.interfaceTicks).toBeGreaterThanOrEqual(4 * r.trade.done);
            // the stuns that are not top-ups bury three (the first stun's 4 bones leave 1)
            expect(res.stun!.byAction.bury).toBeGreaterThanOrEqual(3 * (res.stun!.stuns - r.trade.opened) - 3);
        });

        test('without idleOnInterface the knight click closes the trade', () => {
            const r = run(false);
            expect(r.trade.broken).toBeGreaterThan(0);
            expect(r.trade.done).toBe(0);
        });

        test('ticks idled on an open trade are not a target that never rolls', () => {
            // open T+6..T+25: without counting the idle ticks, T+26 would be 14 ticks past the stun
            const r = thieve({ ticks: 260, outcome: everyFifthFails, kit: { bones: 4, blood: 6000, air: 6000, food: 4 }, helper: { bones: 12, openTicks: 20 }, params: { stunActions: [TOPUP, 'bury', 'charge'], idleOnInterface: true, retargetTicks: 12 } });
            expect(r.trade.broken).toBe(0);
            expect(r.trade.done).toBeGreaterThan(0);
            expect(r.h.status.counters.retargets ?? 0).toBe(0);
        });

        test('a trade still open on the attempt tick delays the attempt by its extra ticks', () => {
            const r = run(true, 7);
            const res = r.h.status.result as Result;
            expect(r.trade.broken).toBe(0);
            // open T+6..T+12 (7 states): the first click after it lands on T+14
            expect(res.gapAfterFail[14]).toBe(r.trade.opened);
        });
    });

    describe('default-identical (addendum 6)', () => {
        // Every packet the program sends, by tick, in scenarios that use none of the keys added
        // after the stun pack (stopWhenFoodBelow, retargetTicks), fingerprinted from the program
        // as it was before them. The two deliberate default changes are outside these scenarios:
        // the eatBelow floor binds only when maxHp - heal <= forcedBelow, and a banknote of the
        // food is skipped only when one is in the inventory.
        const TOPUP = { name: 'topup', kind: 'player', player: '^helper$', fewer: [{ item: '^dragon bones$', than: 3 }], window: [2, 2] };
        const SCENARIOS: Record<string, ThieveOpts> = {
            cadence: { ticks: 300, outcome: everyFifthFails },
            windowEat: { ticks: 400, outcome: n => n % 4 !== 3, params: { eatBelow: 28 } },
            defaultEat40: { ticks: 400, outcome: n => n % 3 !== 2 },
            defaultEat99: { ticks: 600, maxHp: 99, outcome: n => n % 6 !== 5, kit: { food: 20 } },
            forced: { ticks: 200, hp: 7, outcome: () => false, params: { eatBelow: 0 } },
            stunPack: { ticks: 300, outcome: everyFifthFails, ...PACK },
            dialog: { ticks: 60, outcome: n => n !== 1, ...PACK, dialogAt: t => t % 17 === 0 },
            topupIdle: { ticks: 260, outcome: everyFifthFails, kit: { bones: 4, blood: 6000, air: 6000, food: 4 }, helper: { bones: 12 }, params: { stunActions: [TOPUP, 'bury', 'charge'], idleOnInterface: true } }
        };
        // from the program at 75ce523c (rs/132's stun pack and #177's declarations, before these options)
        const GOLDEN: Record<string, { packets: number; sha256: string }> = {
            cadence: { packets: 304, sha256: 'cccfaf6cff3d8e5de09516b0f74e49621cbf6e30c5ed64f4ee413094ae34781b' },
            windowEat: { packets: 406, sha256: '3de0af7652a81dbbf193d6540b1411e47d81f33ba6483127e10affcc75f62d7e' },
            defaultEat40: { packets: 407, sha256: 'aa4f651a8fbfec653357a3f5a48217cbbc8b0984fc63af015e63a35feafabb9a' },
            defaultEat99: { packets: 608, sha256: 'd03f899e28929c95facdaf6a8471c00487e1b84007861a400d6148cc4d45d3eb' },
            forced: { packets: 210, sha256: '1c204154156119560acf57f9f615458e54bdb92a8d7601f7d3f4034a30b8d2ed' },
            stunPack: { packets: 624, sha256: 'e0d40f331367b92820aacb4123c944df3ca5721a6fcdf5b0319ac23d9fdd9041' },
            dialog: { packets: 77, sha256: '6916cf3211f73476a94289f932e7bb9c930c0552cf40a017173b8cb99225f210' },
            topupIdle: { packets: 370, sha256: 'de88150a3da15a304d1843221961b8b3bf4d97fd61abf3dd66f9b1e33a909d54' }
        };
        const trace = (o: ThieveOpts) => thieve(o).h.sent.map(s => `${s.tick} ${JSON.stringify(s.action)}`);

        test('sends exactly the pre-option packets', () => {
            const now = Object.fromEntries(Object.entries(SCENARIOS).map(([k, o]) => {
                const t = trace(o);
                return [k, { packets: t.length, sha256: createHash('sha256').update(t.join('\n')).digest('hex') }];
            }));
            if (process.env.PICKPOCKET_GOLDEN_WRITE) writeFileSync(process.env.PICKPOCKET_GOLDEN_WRITE, JSON.stringify(now, null, 4));
            expect(now).toEqual(GOLDEN);
        });
    });

    test('a roll line that is not the first message of its publication still counts', () => {
        // every message of one tick shares the publication's observation id
        const npcs = [{ index: 12, name: 'Knight of Ardougne', options: ['Talk-to', 'Attack', 'Pickpocket'] }];
        const h = new Harness('pp', createPickpocket);
        h.start('pp', { rolls: 2 }, makeState({ tick: 1, npcs }));
        const msgs: Array<{ text: string; tick: number }> = [];
        for (let t = 2; t < 30 && h.status.phase === 'running'; t++) {
            if (t === 3) msgs.push({ text: 'You eat the shark.', tick: t }, { text: 'It heals some health.', tick: t }, { text: "You fail to pick the knight's pocket.", tick: t });
            if (t === 14) msgs.push({ text: "You're stunned!", tick: t }, { text: "You pick the knight's pocket.", tick: t });
            h.step(makeState({ tick: t, npcs, messages: msgs }));
        }
        expect(h.status.phase).toBe('done');
        expect(h.status.counters.fails).toBe(1);
        expect(h.status.counters.successes).toBe(1);
        expect(h.status.endedTick).toBe(14);
    });

    test('rejects a window outside the stun and unknown presets', () => {
        const h = new Harness('pp', createPickpocket);
        for (const params of [{ stunWindow: [1, 6] }, { stunWindow: [2, 8] }, { stunWindow: [5, 3] }, { stunActions: ['juggle'] }, { stunActions: [{ kind: 'item', item: 'x' }] }, { stunActions: [] }, { stunActions: [{ kind: 'player' }] }, { stunActions: [{ kind: 'button', component: 1, window: [4, 2] }] }]) {
            const s = h.runtime.start('pp', { maxTicks: 10, stunActions: ['bury'], ...params });
            expect(s.phase).toBe('fault');
            expect(s.fault).toMatch(/bad parameters/);
        }
    });
});
