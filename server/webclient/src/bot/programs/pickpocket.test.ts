import { describe, expect, test } from 'bun:test';
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
 */
function thieve(opts: { ticks: number; outcome: (n: number) => boolean; hp?: number; params?: Record<string, unknown>; kit?: Kit; dialogAt?: (tick: number) => boolean }) {
    const h = new Harness('pp', createPickpocket);
    const kit = { food: 10, bones: 0, blood: 0, air: 0, headless: 0, magic: 80, fletching: 1, ...opts.kit, heads: { ...opts.kit?.heads } };
    let tick = 200;
    let hp = opts.hp ?? 40;
    let freeAt = 0;
    let n = 0;
    let msgId = 0;
    let prayerXp = 0;
    let magicXp = 0;
    let fletchXp = 0;
    const delayed = new Set<number>();
    const msgs: Array<{ text: string; tick: number; id: number }> = [];
    const rolls: Array<{ tick: number; ok: boolean }> = [];
    const failedAttempts: number[] = [];
    const landings: Landing[] = [];
    let attemptAt: number | null = null;
    const inventory = () => [
        ...Array.from({ length: kit.food }, () => ({ name: 'Shark', options: ['Eat', 'Drop'] })),
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
            tick, hp, maxHp: 40,
            skills: {
                Thieving: { xp: rolls.filter(r => r.ok).length * 84 * 25, level: 55 },
                Prayer: { xp: prayerXp, level: 43 },
                Magic: { xp: magicXp, level: kit.magic },
                Fletching: { xp: fletchXp, level: kit.fletching }
            },
            inventory: inv,
            npcs: [{ index: 12, name: 'Knight of Ardougne', options: ['Talk-to', 'Attack', 'Pickpocket'] }],
            messages: msgs.slice(-20),
            dialogOpen: opts.dialogAt?.(tick) ?? false
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
                msgs.push({ text: "You pick the knight's pocket.", tick, id: msgId++ });
                freeAt = a + 2;
            } else {
                msgs.push({ text: "You fail to pick the knight's pocket.", tick, id: msgId++ });
                msgs.push({ text: "You've been stunned!", tick, id: msgId++ });
                hp -= 3;
                delayed.add(a + 2);
                delayed.add(a + 3);
                freeAt = a + 11;
                failedAttempts.push(a);
            }
        }
        // this tick's packets, in the order they were sent
        let dropRest = delayed.has(tick);
        for (const p of pending.filter(p => p.at === tick)) {
            const a = p.sent.action;
            const lastFail = failedAttempts[failedAttempts.length - 1];
            landings.push({ tick, type: a.type, name: p.name, sinceFail: lastFail === undefined ? undefined : tick - lastFail, dropped: dropRest });
            if (dropRest) continue;
            if (a.type === 'interactNpc') {
                if (tick >= freeAt && attemptAt === null) {
                    attemptAt = tick;
                    delayed.add(tick + 1);
                }
            } else if (a.type === 'useInventoryItem' && p.name === 'Shark') {
                hp = Math.min(40, hp + 20);
                kit.food--;
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
        for (const s of h.step(state())) {
            const slot = 'slot' in s.action ? s.action.slot : 'sourceSlot' in s.action ? s.action.sourceSlot : undefined;
            pending.push({ at: tick + 1, sent: s, name: slot === undefined ? undefined : inv[slot]?.name });
        }
    }
    const stunActions = landings.filter(l => l.type !== 'interactNpc' && l.type !== 'clickDialogOption' && !(l.type === 'useInventoryItem' && l.name === 'Shark'));
    return { h, rolls, landings, stunActions, kit, failedAttempts, xp: () => ({ prayerXp, magicXp, fletchXp }) };
}

type Result = { gapAfterSuccess: Record<number, number>; gapAfterFail: Record<number, number>; rollsPerTick: number; rolls: number; fails: number; stun?: StunSummary };

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
        expect(h.sent.every(s => s.action.type === 'interactNpc')).toBe(true);
        expect(r.stun).toBeUndefined();
        // 4 successes at 2 and one failure at 11: 5 rolls per 19 ticks
        expect(r.rollsPerTick).toBeCloseTo(5 / 19, 1);
        expect(rolls.length).toBeGreaterThan(70);
        // the clicks the model drops are the delayed ticks: one per success, two per failure
        expect(landings.filter(l => l.dropped).length).toBeGreaterThan(rolls.length);
    });

    test('eats in a success window, with the click, once HP is low', () => {
        const { h } = thieve({ ticks: 400, outcome: n => n % 4 !== 3, params: { eatBelow: 28 } });
        const eats = h.sent.filter(s => s.action.type === 'useInventoryItem');
        expect(eats.length).toBeGreaterThan(0);
        for (const e of eats) {
            const same = h.sent.filter(s => s.tick === e.tick).map(s => s.action.type);
            expect(same).toEqual(['useInventoryItem', 'interactNpc']);
        }
        expect(h.status.counters.forcedEats ?? 0).toBe(0);
        expect(Object.keys((h.status.result as Result).gapAfterFail)).toEqual(['11']);
    });

    test('forces an eat when the next failure could kill', () => {
        const { h } = thieve({ ticks: 200, hp: 7, outcome: () => false, params: { eatBelow: 0 } });
        expect(h.status.counters.forcedEats).toBeGreaterThan(0);
    });

    test('ends after the requested rolls', () => {
        const { h } = thieve({ ticks: 500, outcome: () => true, params: { rolls: 30, maxTicks: undefined } });
        expect(h.status.phase).toBe('done');
        expect((h.status.result as { rolls: number }).rolls).toBe(30);
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
        // k 2..7: 6 ticks of 4
        expect(r.stun!.firedPerStun).toBe(24);
        expect(stunActions.every(l => !l.dropped && l.sinceFail! >= 4 && l.sinceFail! <= 9)).toBe(true);
        // each of those ticks sends 4 + the click: the whole budget
        const fail = rolls.find(x => !x.ok)!.tick;
        expect(h.sent.filter(s => s.tick === fail + 2).length).toBe(5);
        expect(h.status.deferred).toBe(0);
    });

    test('resolves from the inventory: never more Charges than the runes allow', () => {
        const { h } = thieve({ ticks: 200, outcome: everyFifthFails, kit: { blood: 10, air: 30 }, params: { stunActions: ['charge'] } });
        const charges = h.sent.filter(s => s.action.type === 'clickComponent');
        expect(charges.length).toBe(3);
        const st = (h.status.result as Result).stun!;
        expect(st.fired).toBe(3);
        // the rest of the stuns found nothing to do
        expect(st.dry).toBe(st.stuns - 1);
    });

    test('stops a skill-gated action at its level: no Charge at Magic 99', () => {
        const { h } = thieve({ ticks: 100, outcome: () => false, kit: { blood: 600, air: 600, magic: 99 }, params: { stunActions: ['charge'] } });
        expect(h.sent.some(s => s.action.type === 'clickComponent')).toBe(false);
    });

    test('arrows use the best tier the Fletching level allows', () => {
        const at = (fletching: number) => {
            const { h, stunActions } = thieve({ ticks: 40, outcome: () => false, kit: { headless: 3000, heads: { rune: 600, mithril: 600, bronze: 600 }, fletching }, params: { stunActions: ['arrows'] } });
            expect(stunActions.every(l => !l.dropped)).toBe(true);
            return new Set(stunActions.map(l => l.name));
        };
        expect(at(50)).toEqual(new Set(['Mithril arrowheads']));
        expect(at(80)).toEqual(new Set(['Rune arrowheads']));
        expect(at(10)).toEqual(new Set(['Bronze arrowheads']));
    });

    test('a level-up page is resumed first, at the cost of one delay-free slot', () => {
        let fail = -1;
        const { h, rolls } = thieve({ ticks: 60, outcome: n => n !== 1, ...PACK, dialogAt: t => fail > 0 && t === fail + 2 });
        fail = rolls.find(x => !x.ok)?.tick ?? -1;
        // re-run with the failure's tick known
        const again = thieve({ ticks: 60, outcome: n => n !== 1, ...PACK, dialogAt: t => t === fail + 2 });
        void h;
        const sends = again.h.sent.filter(s => s.tick === fail + 2).map(s => s.action.type);
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

    test('rejects a window outside the stun and unknown presets', () => {
        const h = new Harness('pp', createPickpocket);
        for (const params of [{ stunWindow: [1, 6] }, { stunWindow: [2, 8] }, { stunWindow: [5, 3] }, { stunActions: ['juggle'] }, { stunActions: [{ kind: 'item', item: 'x' }] }, { stunActions: [] }]) {
            const s = h.runtime.start('pp', { maxTicks: 10, stunActions: ['bury'], ...params });
            expect(s.phase).toBe('fault');
            expect(s.fault).toMatch(/bad parameters/);
        }
    });
});
