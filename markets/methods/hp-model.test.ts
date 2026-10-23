import { describe, expect, test } from 'bun:test';
import {
    attackRoll,
    bestWeapon,
    chooseSite,
    chooseStyle,
    shopPays,
    damagePerTick,
    defenceRoll,
    expectedSwings,
    hitChance,
    kebabHeal,
    kebabsFor,
    marksFor,
    maxHit,
    modelTicks,
    prayerBoost,
    prayersFor,
    reached,
    SCIMITARS,
    TARGETS,
    weaponPlan
} from './hp-model';

const [, iron, steel, mithril] = SCIMITARS as [unknown, (typeof SCIMITARS)[number], (typeof SCIMITARS)[number], (typeof SCIMITARS)[number]];

describe('the engine formulas', () => {
    test('max hit: floor((effective strength x (bonus + 64) + 320) / 640), +3 on aggressive', () => {
        expect(maxHit({ attack: 1, strength: 1, weapon: iron, train: 'strength' })).toBe(1);
        expect(maxHit({ attack: 40, strength: 40, weapon: mithril, train: 'strength' })).toBe(7);
        expect(maxHit({ attack: 99, strength: 99, weapon: mithril, train: 'strength' })).toBe(14);
        // accurate drops the +3: (107 x 84 + 320) / 640 = 14.54
        expect(maxHit({ attack: 99, strength: 99, weapon: mithril, train: 'attack' })).toBe(14);
        expect(maxHit({ attack: 1, strength: 99, weapon: mithril, train: 'strength', prayers: { attack: 100, strength: 115 } })).toBe(16);
    });
    test('rolls and the hit chance', () => {
        expect(attackRoll({ attack: 1, strength: 1, weapon: iron, train: 'attack' })).toBe(12 * 74);
        expect(defenceRoll(TARGETS.crab)).toBe(640);
        expect(defenceRoll(TARGETS.cow)).toBe(10 * 43);
        expect(hitChance(852, 640)).toBeCloseTo(1 - 642 / 1706, 9);
        expect(hitChance(100, 200)).toBeCloseTo(100 / 402, 9);
    });
    test('expected swings: a 1-hp npc hit every swing for 0..1 takes 2', () => {
        expect(expectedSwings(1, 1, 1)).toBeCloseTo(2, 9);
        expect(expectedSwings(0, 0.5, 3)).toBe(0);
        expect(expectedSwings(50, 0.9, 7)).toBeGreaterThan(expectedSwings(50, 0.9, 14));
    });
    test('damage per tick at the crabs, Attack and Strength 40, mithril: 0.72, the lab probe measured 0.71', () => {
        expect(damagePerTick({ attack: 40, strength: 40, weapon: mithril, train: 'strength' }, TARGETS.crab)).toBeCloseTo(0.72, 1);
    });
});

describe('the style choice (never Defence)', () => {
    const owned = SCIMITARS;
    test('a fresh account takes Attack 2 (cheap accuracy), then Strength', () => {
        expect(chooseStyle({ attack: 1, strength: 1, owned, target: TARGETS.crab })).toBe('attack');
        expect(chooseStyle({ attack: 2, strength: 1, owned, target: TARGETS.crab })).toBe('strength');
        expect(chooseStyle({ attack: 10, strength: 10, owned, target: TARGETS.crab })).toBe('strength');
    });
    test('Attack 19 with the mithril scimitar carried: the level that wields it wins', () => {
        expect(chooseStyle({ attack: 19, strength: 40, owned, target: TARGETS.crab })).toBe('attack');
    });
    test('a capped skill hands over to the other, and both capped stays on Strength', () => {
        expect(chooseStyle({ attack: 99, strength: 80, owned, target: TARGETS.crab })).toBe('strength');
        expect(chooseStyle({ attack: 80, strength: 99, owned, target: TARGETS.crab })).toBe('attack');
        expect(chooseStyle({ attack: 99, strength: 99, owned, target: TARGETS.crab })).toBe('strength');
    });
    test('the integrated path keeps Strength ahead of Attack (the model reaches HP 30 at Attack 20, Strength 40, as the lab did)', () => {
        const rows = modelTicks(TARGETS.cow, 30);
        expect(rows.at(-1)).toMatchObject({ hp: 30, attack: 20, strength: 40 });
        for (const r of modelTicks(TARGETS.crab, 80)) expect(r.strength).toBeGreaterThan(r.attack);
    });
});

describe('the weapon path', () => {
    test('one visit buys every tier the coins cover, cheapest first', () => {
        expect(weaponPlan(1700, 20).map(w => w.name)).toEqual(['Iron scimitar', 'Steel scimitar', 'Mithril scimitar']);
        expect(weaponPlan(600, 20).map(w => w.name)).toEqual(['Iron scimitar', 'Steel scimitar']);
        expect(weaponPlan(500, 20).map(w => w.name)).toEqual(['Iron scimitar']);
        expect(weaponPlan(100, 20)).toEqual([]);
    });
    test('the best wieldable weapon follows Attack', () => {
        expect(bestWeapon(4, 10, SCIMITARS, TARGETS.crab)?.name).toBe('Iron scimitar');
        expect(bestWeapon(5, 10, SCIMITARS, TARGETS.crab)?.name).toBe('Steel scimitar');
        expect(bestWeapon(20, 40, SCIMITARS, TARGETS.crab)?.name).toBe('Mithril scimitar');
        expect(bestWeapon(30, 40, [steel], TARGETS.crab)?.name).toBe('Steel scimitar');
        expect(bestWeapon(1, 1, [mithril], TARGETS.crab)).toBeNull();
    });
});

describe('the site and the shop', () => {
    test('the cows to ~52 Hitpoints, the crabs route above (its crossing and food runs then pay)', () => {
        expect(chooseSite(30)).toBe('cows');
        expect(chooseSite(40)).toBe('cows');
        expect(chooseSite(50)).toBe('cows');
        expect(chooseSite(60)).toBe('crabs');
        expect(chooseSite(70)).toBe('crabs');
        expect(chooseSite(99)).toBe('crabs');
    });
    test("Zeke's errand does not pay on the cows below the crossover; the crabs route always shops", () => {
        expect(shopPays(40, 'cows')).toBe(false);
        expect(shopPays(50, 'cows')).toBe(false);
        expect(shopPays(70, 'cows')).toBe(true);
        expect(shopPays(40, 'crabs')).toBe(true);
    });
});

describe('the stopping rule and the marks', () => {
    test('done once the Hitpoints base level reaches the target', () => {
        expect(reached(70, 70)).toBe(true);
        expect(reached(71, 70)).toBe(true);
        expect(reached(69, 70)).toBe(false);
    });
    test('marks every ten levels from 30, the target included', () => {
        expect(marksFor(70)).toEqual([30, 40, 50, 60, 70]);
        expect(marksFor(99)).toEqual([30, 40, 50, 60, 70, 80, 90, 99]);
        expect(marksFor(75)).toEqual([30, 40, 50, 60, 70, 75]);
    });
});

describe('food and prayers', () => {
    test('a kebab heals 3 + 7%, 6 + 14% or 7 + 24% of base Hitpoints: ~5.9 at 30, ~9.9 at 80', () => {
        expect(kebabHeal(30)).toBeCloseTo(190 / 32, 9);
        expect(kebabHeal(80)).toBeCloseTo(9.9375, 9);
        expect(kebabsFor(30, 30)).toBe(0);
        expect(kebabsFor(30, 99)).toBeGreaterThan(kebabsFor(30, 70));
    });
    test('the best Strength and Attack prayers by level, Protect from Melee only when asked', () => {
        expect(prayersFor(3, true)).toEqual([]);
        expect(prayersFor(31, false)).toEqual(['ultimate_strength', 'improved_reflexes']);
        expect(prayersFor(43, false)).toEqual(['ultimate_strength', 'incredible_reflexes']);
        expect(prayersFor(43, true)).toEqual(['ultimate_strength', 'incredible_reflexes', 'protect_from_melee']);
        expect(prayerBoost(prayersFor(34, false))).toEqual({ attack: 115, strength: 115 });
    });
});
