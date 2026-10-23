import { describe, expect, test } from 'bun:test';
import { fallbackMix, PLAN_B_MIX } from './plan.ts';
import { KnightsRamp, rateBetween } from './ramp.ts';

const MIN = 60_000;
const cfg = { steps: [8, 20, 43], holdMinutes: 15, dropPct: 10, admitTimeoutMinutes: 30 };

/** A fake rate source: n logins, each at `perLogin` gp a tick with a little spread. */
const rates = (n: number, perLogin: number) => Array.from({ length: n }, (_, i) => perLogin * (1 + ((i % 3) - 1) * 0.02));

/** Drive the ramp: each step works at the rate `rateAt(logins)` gives, and holds as configured. */
function drive(rateAt: (logins: number) => number) {
    const r = new KnightsRamp(cfg, 0);
    let now = 0;
    while (r.phase === 'admitting' || r.phase === 'holding') {
        now += 5 * MIN; // the step's logins reach the knights
        expect(r.update(now, true)).toBe(true);
        expect(r.holdDue(now + 15 * MIN - 1)).toBe(false);
        now += 15 * MIN;
        expect(r.holdDue(now)).toBe(true);
        r.evaluate(rates(r.admitted(), rateAt(r.admitted())), now);
    }
    return r;
}

describe('KnightsRamp', () => {
    test('admits 8, then 20, then 43 while the rate per login holds', () => {
        // 4.2 gp a tick per login (the lab's ~126k an hour), down 5% at 43
        const r = drive(n => (n >= 43 ? 4.0 : 4.2));
        expect(r.phase).toBe('done');
        expect(r.admitted()).toBe(43);
        expect(r.decisions.map(d => [d.step, d.logins, d.action])).toEqual([
            [1, 8, 'next'],
            [2, 20, 'next'],
            [3, 43, 'done']
        ]);
        expect(r.decisions[2]!.ratio).toBeCloseTo(4.0 / 4.2, 6);
    });

    test('stops when a step falls more than 10% below the first, and the rest go to plan B', () => {
        const r = drive(n => (n >= 20 ? 3.7 : 4.2));
        expect(r.phase).toBe('stopped');
        expect(r.admitted()).toBe(20);
        const d = r.decisions.at(-1)!;
        expect(d.action).toBe('stop');
        expect(d.reason).toMatch(/11\.9% below the first step's 4\.20 \(limit 10%\)/);
        expect(Object.fromEntries(fallbackMix(43 - r.admitted(), PLAN_B_MIX))).toEqual({ iron: 6, heroes: 4, guards: 13 });
    });

    test('a drop of exactly the limit does not stop it', () => {
        expect(drive(n => (n >= 20 ? 4.2 * 0.9 : 4.2)).phase).toBe('done');
    });

    test('the hold starts at the admission timeout when not every login reached the knights', () => {
        const r = new KnightsRamp(cfg, 0);
        expect(r.update(29 * MIN, false)).toBe(false);
        expect(r.update(30 * MIN, false)).toBe(true);
        expect(r.holdStart).toBe(30 * MIN);
    });

    test('a hold with nobody measured holds again', () => {
        const r = new KnightsRamp(cfg, 0);
        r.update(0, true);
        const d = r.evaluate([], 15 * MIN);
        expect(d.action).toBe('repeat');
        expect(r.phase).toBe('holding');
        expect(r.holdDue(15 * MIN)).toBe(false);
        expect(r.holdDue(30 * MIN)).toBe(true);
    });

    test('one step only: done after its first hold', () => {
        const r = new KnightsRamp({ ...cfg, steps: [6] }, 0);
        r.update(0, true);
        expect(r.evaluate([4, 4.1], 15 * MIN).action).toBe('done');
    });

    test('rateBetween measures within one session only', () => {
        expect(rateBetween({ session: 1, tick: 100, coins: 0 }, { session: 1, tick: 200, coins: 420 })).toBe(4.2);
        expect(rateBetween({ session: 1, tick: 100, coins: 0 }, { session: 2, tick: 200, coins: 420 })).toBeNull();
        expect(rateBetween(undefined, { session: 2, tick: 200, coins: 420 })).toBeNull();
    });
});
