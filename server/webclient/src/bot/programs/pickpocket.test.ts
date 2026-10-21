import { describe, expect, test } from 'bun:test';
import { createPickpocket } from './pickpocket.js';
import { Harness, makeState } from './testkit.js';

/**
 * The engine's pickpocket timing (thieving.md): a click landing while the player is
 * free rolls at once; a success frees the player 2 ticks later, a failure stuns and
 * frees 11 ticks later with 3 damage. Clicks while not free are dropped.
 */
function thieve(opts: { ticks: number; outcome: (n: number) => boolean; hp?: number; params?: Record<string, unknown>; food?: number }) {
    const h = new Harness('pp', createPickpocket);
    let tick = 200;
    let hp = opts.hp ?? 40;
    let freeAt = 0;
    let n = 0;
    let msgId = 0;
    let food = opts.food ?? 10;
    const msgs: Array<{ text: string; tick: number; id: number }> = [];
    const rolls: Array<{ tick: number; ok: boolean }> = [];
    const state = () => makeState({
        tick, hp, maxHp: 40,
        skills: { Thieving: { xp: rolls.filter(r => r.ok).length * 84 * 25 } },
        inventory: Array.from({ length: food }, () => ({ name: 'Shark', options: ['Eat', 'Drop'] })),
        npcs: [{ index: 12, name: 'Knight of Ardougne', options: ['Talk-to', 'Attack', 'Pickpocket'] }],
        messages: msgs.slice(-20)
    });
    h.start('pp', { maxTicks: opts.ticks, ...opts.params }, state());
    const pending: Array<{ at: number; type: string }> = [];
    for (let i = 0; i < opts.ticks + 5 && h.status.phase === 'running'; i++) {
        tick++;
        for (const p of pending.filter(p => p.at === tick)) {
            if (p.type === 'useInventoryItem') { hp = Math.min(40, hp + 20); food--; }
            if (p.type === 'interactNpc' && tick >= freeAt) {
                const ok = opts.outcome(n++);
                rolls.push({ tick, ok });
                if (ok) {
                    msgs.push({ text: "You pick the knight's pocket.", tick, id: msgId++ });
                    freeAt = tick + 2;
                } else {
                    msgs.push({ text: "You fail to pick the knight's pocket.", tick, id: msgId++ });
                    msgs.push({ text: "You've been stunned!", tick, id: msgId++ });
                    hp -= 3;
                    freeAt = tick + 11;
                }
            }
        }
        for (const s of h.step(state())) pending.push({ at: tick + 1, type: s.action.type });
    }
    return { h, rolls };
}

describe('pickpocket', () => {
    test('clicks every tick; 2 ticks after a success, 11 after a failure', () => {
        const { h, rolls } = thieve({ ticks: 300, outcome: n => n % 5 !== 4 });
        const r = h.status.result as { gapAfterSuccess: Record<number, number>; gapAfterFail: Record<number, number>; rollsPerTick: number };
        expect(Object.keys(r.gapAfterSuccess)).toEqual(['2']);
        expect(Object.keys(r.gapAfterFail)).toEqual(['11']);
        // one click per tick
        const clicks = h.sent.filter(s => s.action.type === 'interactNpc').map(s => s.tick);
        expect(new Set(clicks).size).toBe(clicks.length);
        expect(clicks.length).toBeGreaterThan(290);
        // 4 successes at 2 and one failure at 11: 5 rolls per 19 ticks
        expect(r.rollsPerTick).toBeCloseTo(5 / 19, 1);
        expect(rolls.length).toBeGreaterThan(70);
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
