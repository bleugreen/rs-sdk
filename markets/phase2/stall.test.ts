import { describe, expect, test } from 'bun:test';
import type { BotWorldState } from '../../sdk/types';
import { methodReading, MOVE_TILES, policyFor, stageReading, StallWatch, type StallReading } from './stall';

const MIN = 60_000;
const p = { ms: 10 * MIN, retries: 2 };

const coinsStage = (xp: number, carried: number, x = 3231, z = 3218): StallReading => ({ stage: 'coins', marks: [xp, carried], at: { x, z } });

describe('StallWatch in the method', () => {
    test('coins that keep moving never stall', () => {
        const w = new StallWatch();
        for (let t = 0; t <= 60 * MIN; t += MIN) {
            w.observe(methodReading(t), t);
            expect(w.check(t, 'method', p)).toBeNull();
        }
    });

    test('coins still for the threshold abort, once per threshold, then are left after the retries', () => {
        const w = new StallWatch();
        const verdicts: (string | null)[] = [];
        for (let t = 0; t <= 45 * MIN; t += MIN / 2) {
            w.observe(methodReading(500), t);
            verdicts.push(w.check(t, 'method', p)?.action ?? null);
        }
        const at = (a: string) => verdicts.flatMap((v, i) => (v === a ? [i / 2] : []));
        expect(at('abort')).toEqual([10, 20]);
        expect(at('leave')).toEqual([30]);
    });

    test('coins moving again reset the retries', () => {
        const w = new StallWatch();
        w.observe(methodReading(500), 0);
        expect(w.check(10 * MIN, 'method', p)?.action).toBe('abort');
        expect(w.check(20 * MIN, 'method', p)?.action).toBe('abort');
        w.observe(methodReading(550), 21 * MIN);
        expect(w.retries('method')).toBe(0);
        expect(w.check(30 * MIN, 'method', p)).toBeNull();
        expect(w.check(31 * MIN, 'method', p)).toEqual({ action: 'abort', stage: 'method', retry: 1, stalledMs: 10 * MIN, marks: [550], at: null });
    });

    test('between sessions the clock stops, and a reading from another stage is not the method clock', () => {
        const w = new StallWatch();
        w.observe(methodReading(500), 0);
        w.pause();
        expect(w.check(30 * MIN, 'method', p)).toBeNull();
        w.observe(coinsStage(0, 0), 30 * MIN);
        expect(w.check(45 * MIN, 'method', p)).toBeNull();
        w.observe(methodReading(500), 50 * MIN);
        expect(w.check(59 * MIN, 'method', p)).toBeNull();
        expect(w.check(60 * MIN, 'method', p)?.action).toBe('abort');
    });

    test('aborted, sent round its stages and back without earning: the retries are kept', () => {
        const w = new StallWatch();
        w.observe(methodReading(500), 0);
        expect(w.check(10 * MIN, 'method', p)?.retry).toBe(1);
        w.observe(coinsStage(0, 0), 11 * MIN);
        w.observe(methodReading(500), 12 * MIN);
        expect(w.check(22 * MIN, 'method', p)?.retry).toBe(2);
        expect(w.check(32 * MIN, 'method', p)?.action).toBe('leave');
    });

    test('a threshold of 0 turns it off', () => {
        const w = new StallWatch();
        w.observe(methodReading(500), 0);
        expect(w.check(600 * MIN, 'method', { ms: 0, retries: 3 })).toBeNull();
    });
});

describe('StallWatch in the other stages', () => {
    test('XP or coins moving, or a walk, is progress: a long trip never stalls', () => {
        const w = new StallWatch();
        for (let t = 0, x = 2465; t <= 40 * MIN; t += MIN, x += 10) {
            w.observe(coinsStage(0, 0, x, 3489), t);
            expect(w.check(t, 'coins', p)).toBeNull();
        }
        for (let t = 41 * MIN, xp = 0; t <= 80 * MIN; t += MIN, xp += 8) {
            w.observe(coinsStage(xp, 0, 2865, 3489), t);
            expect(w.check(t, 'coins', p)).toBeNull();
        }
    });

    test('a02: standing still at the Grand Tree with nothing moving stalls the coins stage, then parks after the retries', () => {
        const w = new StallWatch();
        const verdicts: { t: number; action: string; at: unknown }[] = [];
        for (let t = 0; t <= 35 * MIN; t += MIN / 2) {
            // shuffling about a tile or two is no progress
            w.observe(coinsStage(1_000, 0, 2465 + (t / MIN) % 3, 3489), t);
            const v = w.check(t, 'coins', p);
            if (v) verdicts.push({ t: t / MIN, action: v.action, at: v.at });
        }
        expect(verdicts).toEqual([
            { t: 10, action: 'abort', at: { x: 2465, z: 3489 } },
            { t: 20, action: 'abort', at: { x: 2465, z: 3489 } },
            { t: 30, action: 'leave', at: { x: 2465, z: 3489 } }
        ]);
    });

    test(`a move of more than ${MOVE_TILES} tiles restarts the clock and resets the stage's retries`, () => {
        const w = new StallWatch();
        w.observe(coinsStage(0, 0, 3000, 3200), 0);
        expect(w.check(10 * MIN, 'coins', p)?.action).toBe('abort');
        w.observe(coinsStage(0, 0, 3000 + MOVE_TILES, 3200), 11 * MIN);
        expect(w.retries('coins')).toBe(1);
        w.observe(coinsStage(0, 0, 3001 + MOVE_TILES, 3200), 12 * MIN);
        expect(w.retries('coins')).toBe(0);
        expect(w.check(21 * MIN, 'coins', p)).toBeNull();
        expect(w.check(22 * MIN, 'coins', p)?.retry).toBe(1);
    });

    test('a change of stage restarts the clock; each stage keeps its own retries', () => {
        const w = new StallWatch();
        w.observe(coinsStage(0, 0), 0);
        expect(w.check(10 * MIN, 'coins', p)?.retry).toBe(1);
        w.observe({ stage: 'to-ardougne', marks: [0, 0], at: { x: 3231, z: 3218 } }, 15 * MIN);
        expect(w.check(24 * MIN, 'to-ardougne', p)).toBeNull();
        expect(w.check(25 * MIN, 'to-ardougne', p)?.retry).toBe(1);
        expect(w.retries('coins')).toBe(1);
    });
});

describe('stageReading', () => {
    const s = {
        skills: [
            { name: 'Hitpoints', experience: 4_000 },
            { name: 'Thieving', experience: 9_000 },
            { name: 'Mining', experience: 300 }
        ],
        inventory: [{ name: 'Coins', count: 42 }],
        player: { worldX: 2465, worldZ: 3489 }
    } as unknown as BotWorldState;
    test("the stage's own skill, the coins carried and the position", () => {
        expect(stageReading('hp', s)).toEqual({ stage: 'hp', marks: [4_000, 42], at: { x: 2465, z: 3489 } });
        expect(stageReading('coins', s).marks).toEqual([9_000, 42]);
        expect(stageReading('admission', s).marks).toEqual([9_000, 42]);
        expect(stageReading('mining', s).marks).toEqual([300, 42]);
    });
    test('a stage that trains nothing: the coins and the position only', () => {
        expect(stageReading('to-ardougne', s).marks).toEqual([0, 42]);
        expect(stageReading('buy-sharks', s).marks).toEqual([0, 42]);
    });
});

describe('policyFor', () => {
    const method = { ms: 10 * MIN, retries: 3 };
    const stages = { ms: 5 * MIN, retries: 3 };
    test("the method's own; the stages' with an errand's fill wait added", () => {
        expect(policyFor('method', method, stages)).toBe(method);
        expect(policyFor('coins', method, stages, { 'buy-sharks': 12 })).toEqual(stages);
        expect(policyFor('buy-sharks', method, stages, { 'buy-sharks': 12 })).toEqual({ ms: 17 * MIN, retries: 3 });
    });
    test('0 keeps the stages off whatever the grace', () => {
        expect(policyFor('sale', method, { ms: 0, retries: 3 }, { sale: 10 })).toEqual({ ms: 0, retries: 3 });
    });
});
