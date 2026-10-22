import { describe, expect, test } from 'bun:test';
import {
    BOWS,
    bowSpec,
    bowsStep,
    type BowHoldings,
    type BowsPlan,
    CAMP_LINES,
    campBudget,
    logsToLevel,
    MAKE_PER_TRIP,
    makeButton,
    trainingBow,
    xpForLevel,
    DRAYNOR_APPROACH,
    headlessStep,
    jailBypass,
    LUMBRIDGE_WOODS,
    PATIENT_ADAMANT_PRICE,
    PATIENT_MITHRIL_PRICE,
    PATIENT_RUNE_PRICE,
    remainingBudget,
    shelfPrice
} from './fletcher';
import { BANKS } from './buyer';

describe('shelfPrice (shop.rs2 calc_shop_value, delta 10)', () => {
    test('adamant arrowtips: 40 on a full shelf of 200, 119 with one left, 120 empty', () => {
        expect(shelfPrice(40, 200, 200)).toBe(40);
        expect(shelfPrice(40, 1, 200)).toBe(119);
        expect(shelfPrice(40, 0, 200)).toBe(120);
    });
    test('the patient adamant cap buys from a shelf of 196 or more', () => {
        expect(shelfPrice(40, 196, 200)).toBeLessThanOrEqual(PATIENT_ADAMANT_PRICE);
        expect(shelfPrice(40, 195, 200)).toBeGreaterThan(PATIENT_ADAMANT_PRICE);
    });
    test('the patient rune cap buys from a shelf of 95 or more (Hickton stock 100)', () => {
        expect(shelfPrice(200, 95, 100)).toBeLessThanOrEqual(PATIENT_RUNE_PRICE);
        expect(shelfPrice(200, 94, 100)).toBeGreaterThan(PATIENT_RUNE_PRICE);
    });
    test('the patient mithril cap buys from a shelf of 382 or more (Hickton stock 400)', () => {
        expect(shelfPrice(16, 382, 400)).toBeLessThanOrEqual(PATIENT_MITHRIL_PRICE);
        expect(shelfPrice(16, 381, 400)).toBeGreaterThan(PATIENT_MITHRIL_PRICE);
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
    test('the two shops together cover the shopping list (supply-fallbacks.md section 3)', () => {
        const sum = (item: string) => [...CAMP_LINES.hickton, ...CAMP_LINES.dargaud].filter(l => l.item === item).reduce((a, l) => a + l.quantity, 0);
        expect(sum('Adamant arrowtips')).toBe(3735);
        expect(sum('Rune arrowtips')).toBe(560);
        expect(sum('Mithril arrowtips')).toBe(1500);
        expect(sum('Steel arrowtips')).toBe(135);
        expect(sum('Iron arrowtips')).toBe(90);
        expect(sum('Bronze arrowtips')).toBe(60);
    });
    test('budgets: lines at their caps or 1.5x base, plus 5% and 500', () => {
        // 60x2 + 90x3 + 135x9 + 2075x41 + 560x210 + 1500x18 = 231,280
        expect(campBudget(CAMP_LINES.hickton)).toBe(Math.ceil(231280 * 1.05) + 500);
        expect(campBudget(CAMP_LINES.dargaud)).toBe(71963);
    });
    test('remainingBudget counts only what is still to buy', () => {
        const lines = [
            { item: 'Adamant arrowtips', quantity: 2075, maxPrice: 41 },
            { item: 'Rune arrowtips', quantity: 560, maxPrice: 210 }
        ];
        const held: Record<string, number> = { 'Adamant arrowtips': 2000, 'Rune arrowtips': 600 };
        expect(remainingBudget(lines, i => held[i] ?? 0)).toBe(Math.ceil(75 * 41 * 1.05) + 500);
        expect(remainingBudget(lines, () => 0)).toBe(campBudget(lines));
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

describe('bows: tables', () => {
    test('xpForLevel is the standard table', () => {
        expect(xpForLevel(1)).toBe(0);
        expect(xpForLevel(2)).toBe(83);
        expect(xpForLevel(73)).toBe(992_895);
        expect(xpForLevel(80)).toBe(1_986_068);
        expect(xpForLevel(99)).toBe(13_034_431);
    });
    test('cut_logs.dbrow levels and xp, obj.pack ids', () => {
        expect(bowSpec('Magic shortbow')).toEqual({ name: 'Magic shortbow', log: 'Magic logs', level: 80, xp: 83.3, unstrung: 72, strung: 861 });
        expect(BOWS['yew shortbow']).toMatchObject({ level: 65, xp: 67.5, unstrung: 68, strung: 857 });
        expect(BOWS['yew longbow']).toMatchObject({ level: 70, xp: 75, unstrung: 66, strung: 855 });
        expect(() => bowSpec('dragon shortbow')).toThrow(/unknown bow/);
    });
    test('trainingBow picks the best xp the level allows from the log', () => {
        expect(trainingBow(73, 'Yew logs')?.name).toBe('Yew longbow');
        expect(trainingBow(67, 'Yew logs')?.name).toBe('Yew shortbow');
        expect(trainingBow(64, 'Yew logs')).toBeNull();
        expect(trainingBow(84, 'Magic logs')?.name).toBe('Magic shortbow');
    });
    test('logsToLevel: 73 -> 80 on yew longbows at 25x is 530 logs', () => {
        expect(logsToLevel(xpForLevel(73), 80, BOWS['yew longbow']!, 25)).toBe(530);
        expect(logsToLevel(xpForLevel(80), 80, BOWS['yew longbow']!, 25)).toBe(0);
    });
});

describe('bowsStep', () => {
    const plan: BowsPlan = {
        lines: [
            { bow: 'yew shortbow', count: 2 },
            { bow: 'magic shortbow', count: 6 }
        ],
        level: 80,
        trainLog: 'Yew logs',
        xpRate: 25
    };
    const held = (h: { strung?: Record<number, number>; unstrung?: Record<number, number>; items?: Record<string, number> }): BowHoldings => ({
        strung: b => h.strung?.[b.strung] ?? 0,
        unstrung: b => h.unstrung?.[b.unstrung] ?? 0,
        item: n => h.items?.[n] ?? 0
    });
    test('at 73 the yew shortbows come first, buying logs and strings', () => {
        expect(bowsStep(73, xpForLevel(73), held({}), plan)).toMatchObject({ kind: 'make', bow: { name: 'Yew shortbow' }, make: 2, cut: 2, buyLogs: 2, buyStrings: 2 });
    });
    test('held unstrung bows are strung before any log is cut', () => {
        const s = bowsStep(73, xpForLevel(73), held({ unstrung: { 68: 1 }, items: { 'Yew logs': 5, 'Bow string': 9 } }), plan);
        expect(s).toMatchObject({ kind: 'make', make: 2, cut: 1, buyLogs: 0, buyStrings: 0 });
    });
    test('hedge done below 80: train on yew longbows, buying what the bank lacks', () => {
        const s = bowsStep(73, xpForLevel(73), held({ strung: { 857: 2 }, items: { 'Yew logs': 30 } }), plan);
        expect(s).toMatchObject({ kind: 'train', bow: { name: 'Yew longbow' }, target: 80, logs: 530, buyLogs: 500 });
    });
    test('at 80 the magic shortbows, at most a trip at a time', () => {
        expect(bowsStep(80, xpForLevel(80), held({ strung: { 857: 2 } }), plan)).toMatchObject({ kind: 'make', bow: { name: 'Magic shortbow' }, make: 6, buyLogs: 6, buyStrings: 6 });
        const big = { ...plan, lines: [{ bow: 'magic shortbow', count: 40 }] };
        expect(bowsStep(80, xpForLevel(80), held({}), big)).toMatchObject({ kind: 'make', make: MAKE_PER_TRIP });
    });
    test('done when every line is held and the level reached', () => {
        expect(bowsStep(80, xpForLevel(80), held({ strung: { 857: 2, 861: 6 } }), plan)).toEqual({ kind: 'done' });
    });
    test('a line above the plan level raises the training target', () => {
        const s = bowsStep(80, xpForLevel(80), held({}), { ...plan, lines: [{ bow: 'magic longbow', count: 1 }] });
        expect(s).toMatchObject({ kind: 'train', target: 85 });
    });
    test('a level no training bow allows is stuck, not a loop', () => {
        expect(bowsStep(60, xpForLevel(60), held({}), { ...plan, lines: [] })).toMatchObject({ kind: 'stuck' });
    });
});

describe('makeButton', () => {
    const b = (index: number, text: string) => ({ index, text });
    test('name button closing its group (Make X, Make 10, Make 5, name): the Make-X of the chosen product', () => {
        const opts = [b(1, 'Make X'), b(2, 'Make 10'), b(3, 'Make 5'), b(4, '\n\n\n\nYew Short Bow'), b(5, 'Make X'), b(6, 'Make 10'), b(7, 'Make 5'), b(8, '\n\n\n\nYew Long Bow')];
        expect(makeButton(opts, opts[7]!)).toEqual({ button: opts[4]!, kind: 'x' });
        expect(makeButton(opts, opts[3]!)).toEqual({ button: opts[0]!, kind: 'x' });
    });
    test('name button opening its group', () => {
        const opts = [b(1, 'Yew Short Bow'), b(2, 'Make X'), b(3, 'Make 10'), b(4, 'Make 5'), b(5, 'Yew Long Bow'), b(6, 'Make X'), b(7, 'Make 10'), b(8, 'Make 5')];
        expect(makeButton(opts, opts[4]!)).toEqual({ button: opts[5]!, kind: 'x' });
    });
    test('no Make X: Make 10, else the name button itself', () => {
        const opts = [b(1, 'Make 10'), b(2, 'Make 5'), b(3, 'Yew Long Bow')];
        expect(makeButton(opts, opts[2]!)).toEqual({ button: opts[0]!, kind: '10' });
        expect(makeButton([b(1, 'Yew Long Bow')], b(1, 'Yew Long Bow'))).toEqual({ button: b(1, 'Yew Long Bow'), kind: '1' });
    });
});
