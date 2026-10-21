import { describe, expect, test } from 'bun:test';
import { CAMP_LINES, campBudget, DRAYNOR_APPROACH, headlessStep, jailBypass, LUMBRIDGE_WOODS, PATIENT_ADAMANT_PRICE, shelfPrice } from './fletcher';
import { BANKS } from './buyer';

describe('shelfPrice (shop.rs2 calc_shop_value, delta 10)', () => {
    test('adamant arrowtips: 40 on a full shelf of 200, 119 with one left, 120 empty', () => {
        expect(shelfPrice(40, 200, 200)).toBe(40);
        expect(shelfPrice(40, 1, 200)).toBe(119);
        expect(shelfPrice(40, 0, 200)).toBe(120);
    });
    test('the patient cap buys from a shelf of 196 or more', () => {
        expect(shelfPrice(40, 196, 200)).toBeLessThanOrEqual(PATIENT_ADAMANT_PRICE);
        expect(shelfPrice(40, 195, 200)).toBeGreaterThan(PATIENT_ADAMANT_PRICE);
    });
    test('feathers at Gerrant (base 2, shelf 1000): 6 gp at 800', () => {
        expect(shelfPrice(2, 1000, 1000)).toBe(2);
        expect(shelfPrice(2, 800, 1000)).toBe(6);
    });
    test('a shelf above its stock level sells below base, never under 10%', () => {
        expect(shelfPrice(40, 300, 200)).toBe(4);
    });
});

describe('CAMP_LINES', () => {
    test('the two shops together cover the adamant-cap list', () => {
        const sum = (item: string) => [...CAMP_LINES.hickton, ...CAMP_LINES.dargaud].filter(l => l.item === item).reduce((a, l) => a + l.quantity, 0);
        expect(sum('Adamant arrowtips')).toBe(3735);
        expect(sum('Mithril arrowtips')).toBe(225);
        expect(sum('Steel arrowtips')).toBe(135);
        expect(sum('Iron arrowtips')).toBe(90);
        expect(sum('Bronze arrowtips')).toBe(60);
    });
    test('budgets: lines at their caps or 1.5x base, plus 5% and 500', () => {
        expect(campBudget(CAMP_LINES.hickton)).toBe(97184);
        expect(campBudget(CAMP_LINES.dargaud)).toBe(71963);
    });
});

describe('headlessStep', () => {
    const c = (headless: number, shafts: number, feathers: number, logs = 0) => ({ headless, shafts, feathers, logs });
    test('fresh: make shafts', () => expect(headlessStep(c(0, 0, 0), 4245)).toBe('shafts'));
    test('carried logs count as 15 shafts each', () => expect(headlessStep(c(0, 4230, 0, 1), 4245)).toBe('feathers'));
    test('enough shafts, no feathers: feathers', () => expect(headlessStep(c(0, 4245, 100), 4245)).toBe('feathers'));
    test('shafts and feathers: attach', () => expect(headlessStep(c(1000, 3245, 3245), 4245)).toBe('attach'));
    test('partly attached already counts', () => expect(headlessStep(c(4000, 245, 245), 4245)).toBe('attach'));
    test('done at target', () => expect(headlessStep(c(4245, 0, 0), 4245)).toBe('done'));
});

describe('jailBypass', () => {
    test('Lumbridge woods to Draynor bank goes south of the guards, west-bound order', () => {
        expect(jailBypass(LUMBRIDGE_WOODS, BANKS.draynor)).toEqual([...DRAYNOR_APPROACH]);
    });
    test('and back in the reverse order', () => {
        expect(jailBypass(BANKS.draynor, LUMBRIDGE_WOODS)).toEqual([...DRAYNOR_APPROACH].reverse());
    });
    test('no detour on one side, or outside the guards band (Varrock, Port Sarim)', () => {
        expect(jailBypass(LUMBRIDGE_WOODS, { x: 3224, z: 3202 })).toEqual([]);
        expect(jailBypass(BANKS.varrockWest, BANKS.draynor)).toEqual([]);
        expect(jailBypass(BANKS.draynor, { x: 3014, z: 3224 })).toEqual([]);
    });
});
