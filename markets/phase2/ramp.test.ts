import { describe, expect, test } from 'bun:test';
import { fallbackMix, PLAN_B_MIX } from './plan.ts';
import { holdRates, incumbentRatio, KnightsRamp, rateBetween, type RampReading } from './ramp.ts';

const MIN = 60_000;
const cfg = { steps: [8, 20, 43], holdMinutes: 15, dropPct: 10, admitTimeoutMinutes: 30 };

/** A fake rate source: n logins (a01, a02 ...), each at `perLogin` gp a tick with a little spread. */
const rates = (n: number, perLogin: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`a${String(i + 1).padStart(2, '0')}`, perLogin * (1 + ((i % 3) - 1) * 0.02)]));

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
        expect(Object.fromEntries(fallbackMix(43 - r.admitted(), PLAN_B_MIX))).toEqual({ iron: 7, heroes: 4, guards: 12 });
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

    test('a hold with nobody measured waits for the step again, its timeout counted afresh', () => {
        const r = new KnightsRamp(cfg, 0);
        r.update(30 * MIN, false);
        const d = r.evaluate({}, 45 * MIN);
        expect(d.action).toBe('repeat');
        expect(r.phase).toBe('admitting');
        expect(r.stepNumber).toBe(1);
        expect(r.holdDue(60 * MIN)).toBe(false);
        expect(r.update(74 * MIN, false)).toBe(false);
        expect(r.update(50 * MIN, true)).toBe(true);
        expect(r.holdStart).toBe(50 * MIN);
    });

    test('one step only: done after its first hold', () => {
        const r = new KnightsRamp({ ...cfg, steps: [6] }, 0);
        r.update(0, true);
        expect(r.evaluate({ a01: 4, a02: 4.1 }, 15 * MIN).action).toBe('done');
    });

    test("a later step pairs the incumbents' rates with their first-step rates", () => {
        const r = new KnightsRamp(cfg, 0);
        r.update(0, true);
        const first = r.evaluate({ a01: 16, a02: 15, a03: 17 }, 15 * MIN);
        expect(first.incumbents).toBeNull();
        expect(first.perLogin).toEqual({ a01: 16, a02: 15, a03: 17 });
        r.update(20 * MIN, true);
        // the incumbents lose 5%; two newcomers earn less still
        const d = r.evaluate({ a01: 15.2, a02: 14.25, a03: 16.15, a09: 12, a10: 12.5 }, 35 * MIN);
        expect(d.incumbents?.logins).toBe(3);
        expect(d.incumbents?.ratio).toBeCloseTo(0.95, 6);
        expect(d.ratio).toBeCloseTo(14.25 / 16, 6);
    });
});

describe('holdRates', () => {
    /** Readings every 20 s from `from` to `to` (minutes) at `gpTick` gp a tick (400 ms ticks), coins counted from 0 at `from`. */
    const readings = (from: number, to: number, gpTick: number, session = 1): RampReading[] => {
        const out: RampReading[] = [];
        for (let at = from * MIN; at <= to * MIN; at += 20_000) out.push({ at, session, tick: at / 400, coins: Math.round(((at - from * MIN) / 400) * gpTick) });
        return out;
    };
    /** An arrival: nothing for its first `idle` minutes on the method, then `gpTick`. */
    const arrival = (from: number, idle: number, to: number, gpTick: number): RampReading[] =>
        readings(from, to, 0).map(r => (r.at < (from + idle) * MIN ? r : { ...r, coins: Math.round(((r.at - (from + idle) * MIN) / 400) * gpTick) }));

    test('without a warm-up a newcomer that arrived with the hold reads low; with one it reads its working rate', () => {
        const logins = [
            { alias: 'a01', methodAt: 0, readings: readings(0, 40, 16) },
            { alias: 'a09', methodAt: 20 * MIN, readings: arrival(20, 3, 40, 16) }
        ];
        // the live case: the hold starts as the newcomer arrives and runs 15 minutes
        const old = holdRates(logins, 20 * MIN, 0, 7.5 * MIN);
        expect(old.a01).toBeCloseTo(16, 1);
        expect(old.a09!).toBeLessThan(16 * 0.85);
        const warm = holdRates(logins, 20 * MIN, 5 * MIN, 7.5 * MIN);
        expect(warm.a01).toBeCloseTo(16, 1);
        expect(warm.a09).toBeCloseTo(16, 0);
    });

    test('a login measured over less than the minimum span is left out', () => {
        const logins = [{ alias: 'a09', methodAt: 30 * MIN, readings: readings(30, 40, 16) }];
        // warm from 35 minutes, 5 minutes of readings left: under the 7.5 minimum
        expect(holdRates(logins, 25 * MIN, 5 * MIN, 7.5 * MIN)).toEqual({});
        expect(Object.keys(holdRates(logins, 25 * MIN, 0, 7.5 * MIN))).toEqual(['a09']);
    });

    test('a login off the method now is measured from the hold start; a relog in the hold is not measured across', () => {
        const off = [{ alias: 'a02', methodAt: null, readings: readings(0, 30, 15) }];
        expect(holdRates(off, 10 * MIN, 5 * MIN, 7.5 * MIN).a02).toBeCloseTo(15, 1);
        const relog = [{ alias: 'a03', methodAt: 0, readings: [...readings(0, 18, 15), ...readings(18.5, 30, 15, 2)] }];
        expect(holdRates(relog, 10 * MIN, 0, 7.5 * MIN)).toEqual({});
    });

    test('incumbentRatio pairs by alias and ignores logins only in one step', () => {
        expect(incumbentRatio({ a01: 10, a02: 20 }, { a01: 9, a02: 20, a09: 1 })).toEqual({ logins: 2, ratio: 0.95 });
        expect(incumbentRatio({ a01: 10 }, { a09: 9 })).toBeNull();
    });

    test('rateBetween measures within one session only', () => {
        expect(rateBetween({ session: 1, tick: 100, coins: 0 }, { session: 1, tick: 200, coins: 420 })).toBe(4.2);
        expect(rateBetween({ session: 1, tick: 100, coins: 0 }, { session: 2, tick: 200, coins: 420 })).toBeNull();
        expect(rateBetween(undefined, { session: 2, tick: 200, coins: 420 })).toBeNull();
    });
});
