import { describe, expect, test } from 'bun:test';
import { GUARD_LEVEL, readOptions, riskTable, safety, successChance, targetFor, type Condition } from './coins-driver.ts';

const o = readOptions({});

describe('targetFor', () => {
    const at = (thieving: number, more: Partial<{ coins: number; food: number; east: boolean }> = {}) => targetFor({ thieving, coins: 500, food: 0, east: false, ...more }, o);
    test("coins.ts's auto order, the guards from the driver's level", () => {
        expect(at(1)).toBe('man');
        expect(at(24)).toBe('man');
        expect(at(25)).toBe('warrior');
        expect(at(GUARD_LEVEL - 1)).toBe('warrior');
        expect(at(GUARD_LEVEL)).toBe('guard');
        expect(targetFor({ thieving: 45, coins: 500, food: 0, east: false }, { ...o, guardLevel: 40 })).toBe('guard');
    });
    test('a broke account west of the toll with no food earns the toll and kebabs on the men', () => {
        expect(at(80, { coins: 33 })).toBe('man');
        expect(at(80, { coins: 34 })).toBe('guard');
        expect(at(80, { coins: 0, food: 12 })).toBe('guard');
        expect(at(80, { coins: 0, east: true })).toBe('guard');
    });
    test('an explicit target is kept', () => {
        expect(targetFor({ thieving: 99, coins: 0, food: 0, east: false }, { ...o, target: 'man' })).toBe('man');
    });
});

describe('safety', () => {
    const c = (x: Partial<Condition>): Condition => ({ target: 'guard', hp: 30, maxHp: 40, food: 10, atGuards: true, ...x });
    test('the men: rest from 3 Hitpoints to 10, eating instead when food is carried', () => {
        expect(safety(c({ target: 'man', hp: 4, food: 0 }), o)).toEqual({ do: 'go' });
        expect(safety(c({ target: 'man', hp: 3, food: 0 }), o)).toEqual({ do: 'rest', to: 10, why: 'floor' });
        expect(safety(c({ target: 'man', hp: 2, food: 2 }), o)).toEqual({ do: 'eat', to: 10, why: 'floor' });
        expect(safety(c({ target: 'man', hp: 1, maxHp: 8, food: 0 }), o)).toMatchObject({ to: 8 });
    });
    test('the food targets: eat up to 5 under the maximum at the floor', () => {
        expect(safety(c({ hp: 11 }), o)).toEqual({ do: 'go' });
        expect(safety(c({ hp: 10 }), o)).toEqual({ do: 'eat', to: 35, why: 'floor' });
        expect(safety(c({ target: 'warrior', hp: 4, atGuards: false }), o)).toEqual({ do: 'eat', to: 35, why: 'floor' });
        // the floor is a third of a low maximum, so eating up always clears it
        expect(safety(c({ hp: 5, maxHp: 15 }), o)).toEqual({ do: 'go' });
        expect(safety(c({ hp: 4, maxHp: 15 }), o)).toEqual({ do: 'eat', to: 10, why: 'floor' });
    });
    test('no walk to or from the kebabs under 60% of the maximum', () => {
        expect(safety(c({ hp: 10, food: 0 }), o)).toEqual({ do: 'rest', to: 24, why: 'floor' });
        expect(safety(c({ hp: 23, food: 0 }), o)).toEqual({ do: 'rest', to: 24, why: 'before the walk to the kebabs' });
        expect(safety(c({ hp: 24, food: 0 }), o)).toEqual({ do: 'go' });
        expect(safety(c({ hp: 34, food: 1 }), o)).toEqual({ do: 'eat', to: 35, why: 'the last food before the walk to the kebabs' });
        expect(safety(c({ hp: 35, food: 1 }), o)).toEqual({ do: 'go' });
        expect(safety(c({ hp: 23, food: 20, atGuards: false }), o)).toEqual({ do: 'eat', to: 35, why: 'before the walk to the guards' });
        expect(safety(c({ hp: 23, food: 20, atGuards: true }), o)).toEqual({ do: 'go' });
        expect(safety(c({ target: 'warrior', hp: 23, food: 20, atGuards: false }), o)).toEqual({ do: 'go' });
    });
});

test('readOptions keeps its own keys and passes the rest to coins.ts', () => {
    const r = readOptions({ target: 'guard', guardLevel: 60, floor: 12, bankAt: 1500, keepCoins: 100 });
    expect(r).toMatchObject({ target: 'guard', guardLevel: 60, floor: 12, walkHpPct: 60, kebabs: 24 });
    expect(r.passthrough).toEqual({ bankAt: 1500, keepCoins: 100 });
    expect(() => readOptions({ target: 'knight' })).toThrow('unknown target');
});

describe('the risk model', () => {
    test('stat_random at the ends of the range', () => {
        expect(successChance(1, 50, 240)).toBe(51 / 256);
        expect(successChance(99, 50, 240)).toBe(241 / 256);
        expect(successChance(120, 50, 240)).toBe(241 / 256);
    });
    test("coins.ts's eating outheals the damage from ~35 on the warriors and only from ~51 on the guards", () => {
        const net = (t: 'warrior' | 'guard', l: number) => {
            const [r] = riskTable(t, [l]);
            return r!.healPerHour - r!.damagePerHour;
        };
        expect(net('warrior', 30)).toBeLessThan(0);
        expect(net('warrior', 35)).toBeGreaterThan(0);
        expect(net('guard', 50)).toBeLessThan(0);
        expect(net('guard', GUARD_LEVEL)).toBeGreaterThan(0);
    });
    test('the guards earn more than the warriors at every level from 30', () => {
        const levels = [30, 40, 50, 60, 70, 80, 90, 99];
        const w = riskTable('warrior', levels);
        const g = riskTable('guard', levels);
        levels.forEach((_, i) => expect(g[i]!.gpPerHour).toBeGreaterThan(w[i]!.gpPerHour));
    });
});
