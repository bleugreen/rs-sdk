import { describe, expect, test } from 'bun:test';
import { arranged, assignLow, brewOptions, brewsNeeded, dosesHeld, feasible, GRINDS, nextDrink, nextGrind, nextPour, plan, POTIONS, settled, UNICORN_HORN, UNICORN_HORN_DUST, type Want } from './brew';

/** Drink in a model of the engine: each sip takes a dose from the slot nextDrink names. */
function drinkAll(start: number[], w: Want): number[] {
    const inv = start.map((doses, slot) => ({ slot, doses }));
    for (let i = 0; i < 50; i++) {
        const slot = nextDrink(inv.filter(p => p.doses > 0), w);
        if (slot === null) break;
        inv[slot]!.doses--;
    }
    return inv.map(p => p.doses).filter(d => d > 0).sort((x, y) => y - x);
}

/** Decant in a model of the engine (decant_potion.rs2): the used slot gets min(4, a+b), the target the rest (0 = an empty vial). */
function decantAll(start: number[], w: { four: number; three: number }): number[] {
    const inv = start.map((doses, slot) => ({ slot, doses }));
    for (let i = 0; i < 50; i++) {
        const pour = nextPour(inv.filter(p => p.doses > 0), w);
        if (!pour) break;
        const a = inv[pour[0]]!, b = inv[pour[1]]!;
        expect(a.doses).toBeLessThan(4); // the engine refuses a pour with a (4)
        expect(b.doses).toBeLessThan(4);
        const total = a.doses + b.doses;
        a.doses = Math.min(4, total);
        b.doses = total - a.doses;
    }
    return inv.map(p => p.doses).filter(d => d > 0).sort((x, y) => y - x);
}

describe('brewsNeeded', () => {
    test('n (4)s from 3-dose brews cost ceil(4n/3)', () => {
        expect(brewsNeeded([], { four: 4, three: 0 })).toBe(6); // prayer, H12 + H13
        expect(brewsNeeded([], { four: 2, three: 0 })).toBe(3); // superantipoison, H23
        expect(brewsNeeded([], { four: 1, three: 0 })).toBe(2);
        expect(brewsNeeded([], { four: 3, three: 0 })).toBe(4);
    });
    test('a (3) target is one brew each, kept apart from the pooling', () => {
        expect(brewsNeeded([], { four: 0, three: 1 })).toBe(1);
        expect(brewsNeeded([], { four: 1, three: 1 })).toBe(3); // antipoison: H12 (4), H7 (3)
    });
    test('potions already held count', () => {
        expect(brewsNeeded([4, 4, 4, 4], { four: 4, three: 0 })).toBe(0);
        expect(brewsNeeded([4, 2], { four: 2, three: 0 })).toBe(1); // 2 + 3 pours to a (4)
        expect(brewsNeeded([3], { four: 0, three: 1 })).toBe(0);
        expect(brewsNeeded([4], { four: 0, three: 1 })).toBe(0); // a (4) serves for a (3)
        expect(brewsNeeded([1, 1, 1], { four: 1, three: 0 })).toBe(1);
    });
});

describe('nextPour', () => {
    test('six (3)s become four (4)s and a (2)', () => {
        expect(decantAll([3, 3, 3, 3, 3, 3], { four: 4, three: 0 })).toEqual([4, 4, 4, 4, 2]);
    });
    test('three (3)s for one (4) and one (3) keep a (3) whole', () => {
        expect(decantAll([3, 3, 3], { four: 1, three: 1 })).toEqual([4, 3, 2]);
    });
    test('three (3)s for two (4)s', () => {
        expect(decantAll([3, 3, 3], { four: 2, three: 0 })).toEqual([4, 4, 1]);
    });
    test('every brew count brewsNeeded asks for decants to the target', () => {
        for (let four = 0; four <= 6; four++) {
            for (let three = 0; three <= 3; three++) {
                const w = { four, three };
                const out = decantAll(Array(brewsNeeded([], w)).fill(3), w);
                expect(arranged(out, w)).toBe(true);
            }
        }
    });
    test('nothing to do once arranged', () => {
        expect(nextPour([{ slot: 0, doses: 4 }, { slot: 1, doses: 2 }, { slot: 2, doses: 1 }], { four: 1, three: 0 })).toBeNull();
    });
});

describe('(1) and (2) targets', () => {
    test('options: doses 1 and 2 go to the low list, one entry per potion', () => {
        const o = brewOptions({ targets: [{ potion: 'superantipoison', doses: 1, n: 2 }, { potion: 'superantipoison', doses: 4, n: 1 }, { potion: 'prayer', doses: 2, n: 1 }] });
        expect(o.wants.superantipoison).toEqual({ four: 1, three: 0, low: [1, 1] });
        expect(o.wants.prayer).toEqual({ four: 0, three: 0, low: [2] });
        expect(() => brewOptions({ targets: [{ potion: 'prayer', doses: 5, n: 1 }] })).toThrow();
    });
    test('cairn_h84, 2026-10-22: a held Superantipoison(2) and one brew make two (1)s', () => {
        const w: Want = { four: 0, three: 0, low: [1, 1] };
        expect(brewsNeeded([2], w)).toBe(1);
        expect(drinkAll([2, 3], w)).toEqual([1, 1]);
    });
    test('no pour splits a potion: one (4) cannot become two (1)s without a brew', () => {
        expect(brewsNeeded([4], { four: 0, three: 0, low: [1, 1] })).toBe(1);
        expect(brewsNeeded([1, 1], { four: 0, three: 0, low: [1, 1] })).toBe(0);
        expect(brewsNeeded([], { four: 0, three: 0, low: [2] })).toBe(1);
    });
    test('the (4)s and (3)s asked for are never drunk; the smallest spare is', () => {
        const w: Want = { four: 1, three: 1, low: [1] };
        expect(drinkAll([4, 3, 4, 2], w)).toEqual([4, 4, 3, 1]);
        expect(nextDrink([{ slot: 0, doses: 4 }, { slot: 1, doses: 3 }], w)).toBeNull(); // nothing spare: the planner brews one first
        expect(brewsNeeded([4, 3], w)).toBe(1);
    });
    test('every brew count from nothing decants then drinks down to the target', () => {
        for (let four = 0; four <= 3; four++) {
            for (const low of [[1], [2], [1, 1], [2, 1], [1, 1, 1]]) {
                const w: Want = { four, three: 0, low };
                const out = drinkAll(settled(Array(brewsNeeded([], w)).fill(3), w), w);
                expect(out.filter(d => d === 4).length).toBeGreaterThanOrEqual(four);
                for (const d of [1, 2]) expect(out.filter(x => x === d).length).toBeGreaterThanOrEqual(low.filter(x => x === d).length);
            }
        }
    });
    test('drinking waits for the pours', () => {
        expect(nextDrink([{ slot: 0, doses: 3 }, { slot: 1, doses: 3 }], { four: 1, three: 0, low: [1] })).toBeNull();
        expect(assignLow([{ doses: 1 }], [2])).toBeNull();
    });
});

test('feasible and arranged', () => {
    expect(feasible([3, 3], { four: 1, three: 0 })).toBe(true);
    expect(arranged([3, 3], { four: 1, three: 0 })).toBe(false);
    expect(feasible([3], { four: 1, three: 0 })).toBe(false);
});

describe('dosesHeld', () => {
    test('expands bank stacks by dose, other potions ignored', () => {
        const items = [{ id: 2434, count: 2 }, { id: 139, count: 1 }, { id: 143, count: 1 }, { id: 2436, count: 5 }];
        expect(dosesHeld(items, POTIONS.prayer!).sort()).toEqual([1, 3, 4, 4]);
    });
});

describe('plan', () => {
    const wants = brewOptions({ targets: [
        { potion: 'prayer', doses: 4, n: 4 },
        { potion: 'antipoison', doses: 4, n: 1 }, { potion: 'antipoison', doses: 3, n: 1 },
        { potion: 'superantipoison', doses: 4, n: 2 },
        { potion: 'superattack', doses: 3, n: 1 },
        { potion: 'superstrength', doses: 3, n: 1 }
    ] }).wants;
    // h84-like bank: ranarr unf 60, irit unf 42, kwuarm unf 26, marrentill clean 120, vials 15,
    // snape grass 40, eyes 221, limpwurt 2, no horns.
    const bank = [
        { id: 99, count: 60 }, { id: 101, count: 42 }, { id: 105, count: 26 }, { id: 251, count: 120 },
        { id: 227, count: 15 }, { id: 231, count: 40 }, { id: 221, count: 221 }, { id: 225, count: 2 }
    ];
    test('attempt 1: 14 brews, 6 horns to gather, 3 marrentill to mix', () => {
        const p = plan(bank, wants, 63);
        expect(p.brews).toEqual({ prayer: 6, antipoison: 3, superantipoison: 3, superattack: 1, superstrength: 1 });
        expect(p.unf).toEqual({ ranarr: { need: 6, mix: 0 }, marrentill: { need: 3, mix: 3 }, irit: { need: 4, mix: 0 }, kwuarm: { need: 1, mix: 0 } });
        expect(p.secondaries[UNICORN_HORN_DUST]).toBe(6);
        expect(p.gather).toBe(6);
        expect(p.grind).toBe(0);
        expect(p.short).toEqual([]);
    });
    test('held horns are ground before more are gathered', () => {
        const p = plan([...bank, { id: UNICORN_HORN, count: 4 }, { id: UNICORN_HORN_DUST, count: 1 }], wants, 63);
        expect(p.grind).toBe(4);
        expect(p.gather).toBe(1);
    });
    test('names what it cannot get itself, and blocks only the potions that need it', () => {
        const p = plan(bank.filter(i => i.id !== 225 && i.id !== 99), wants, 50);
        expect(p.short).toEqual([
            'superstrength: Herblore 55 (have 50)',
            'ranarr (unf): 6 short',
            'item 225: 1 short'
        ]);
        expect(p.blocked.sort()).toEqual(['prayer', 'superstrength']);
        const irit = plan(bank.filter(i => i.id !== 101), wants, 63);
        expect(irit.blocked.sort()).toEqual(['superantipoison', 'superattack']); // both take irit
    });
    test('nothing left once the targets are held', () => {
        const done = [{ id: 2434, count: 4 }, { id: 2446, count: 1 }, { id: 175, count: 1 }, { id: 2448, count: 2 }, { id: 145, count: 1 }, { id: 2440, count: 1 }];
        const p = plan(done, wants, 63);
        expect(p.brews).toEqual({});
        expect(p.gather + p.grind).toBe(0);
    });
});

describe('brewOptions', () => {
    test('sums targets per potion', () => {
        const o = brewOptions({ targets: [{ potion: 'antipoison', doses: 4, n: 1 }, { potion: 'antipoison', doses: 3, n: 2 }] });
        expect(o.wants).toEqual({ antipoison: { four: 1, three: 2 } });
    });
    test('receiveFrom names a cairn_ account', () => {
        expect(brewOptions({ targets: [{ potion: 'prayer', doses: 4, n: 1 }], receiveFrom: 'cairn_h51' }).receiveFrom).toBe('cairn_h51');
        expect(() => brewOptions({ targets: [{ potion: 'prayer', doses: 4, n: 1 }], receiveFrom: 'someone' })).toThrow();
    });
    test('rejects unknown potions and doses', () => {
        expect(() => brewOptions({})).toThrow();
        expect(() => brewOptions({ targets: [{ potion: 'ranging', doses: 4, n: 1 }] })).toThrow();
        expect(() => brewOptions({ targets: [{ potion: 'prayer', doses: 0, n: 1 }] })).toThrow();
    });
});

describe('grind option', () => {
    test('a grind-only run needs no targets; unknown names are refused', () => {
        const o = brewOptions({ grind: ['scales', 'chocolate'] });
        expect(o.targets).toEqual([]);
        expect(o.grind).toEqual([GRINDS.scales!, GRINDS.chocolate!]);
        expect(() => brewOptions({ grind: ['bones'] })).toThrow();
        expect(() => brewOptions({})).toThrow();
    });
    test('the ids are the content\'s (obj.pack): blue dragon scale 243 -> dust 241, chocolate bar 1973 -> dust 1975', () => {
        expect(GRINDS.scales).toEqual({ from: 243, to: 241 });
        expect(GRINDS.chocolate).toEqual({ from: 1973, to: 1975 });
    });
    test('horns the targets need come first, then each grind entry until none is held', () => {
        const g = [GRINDS.scales!, GRINDS.chocolate!];
        const items = [{ id: 243, count: 30 }, { id: 1973, count: 5 }];
        expect(nextGrind(items, 2, g)).toEqual({ from: UNICORN_HORN, to: UNICORN_HORN_DUST, n: 2 });
        expect(nextGrind(items, 0, g)).toEqual({ from: 243, to: 241, n: 30 });
        expect(nextGrind([{ id: 1973, count: 5 }, { id: 241, count: 30 }], 0, g)).toEqual({ from: 1973, to: 1975, n: 5 });
        expect(nextGrind([{ id: 241, count: 30 }], 0, g)).toBeNull();
    });
});
