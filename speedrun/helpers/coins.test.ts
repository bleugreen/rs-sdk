import { describe, expect, test } from 'bun:test';
import { planErrand, type PlanInput } from './coins';

const at = (over: Partial<PlanInput>): PlanInput => ({
    target: 'warrior',
    east: true,
    coins: 200,
    food: 20,
    thieving: 60,
    bankEmpty: false,
    atStation: true,
    kebabs: 24,
    bankAt: 3000,
    ...over
});

describe('planErrand: the toll gate', () => {
    test('h64/h65 on the demo: in Al-Kharid with 24 coins, no food, empty bank -> buy kebabs, never walk west', () => {
        expect(planErrand(at({ coins: 24, food: 0, bankEmpty: true, thieving: 41 }))).toEqual({ do: 'kebabs' });
        expect(planErrand(at({ coins: 1, food: 0, bankEmpty: true }))).toEqual({ do: 'kebabs' });
    });

    test('in Al-Kharid with no coins and no food: bank first, then pickpocket the warriors without food', () => {
        expect(planErrand(at({ coins: 0, food: 0 }))).toEqual({ do: 'withdraw', east: true });
        expect(planErrand(at({ coins: 0, food: 0, bankEmpty: true }))).toEqual({ do: 'earn', on: 'warrior', until: 24 });
    });

    test('heading east for food: toll plus kebab money, else bank, else the Lumbridge men', () => {
        const west = { east: false, food: 0 };
        expect(planErrand(at({ ...west, coins: 34 }))).toEqual({ do: 'cross', toEast: true });
        expect(planErrand(at({ ...west, coins: 25 }))).toEqual({ do: 'withdraw', east: false });
        expect(planErrand(at({ ...west, coins: 25, bankEmpty: true }))).toEqual({ do: 'earn', on: 'man', until: 34 });
    });

    test('heading east with food carried needs only the toll', () => {
        expect(planErrand(at({ east: false, coins: 10 }))).toEqual({ do: 'cross', toEast: true });
        expect(planErrand(at({ east: false, coins: 9, bankEmpty: true }))).toEqual({ do: 'earn', on: 'man', until: 10 });
    });

    test('guards with food: cross west; broke in Al-Kharid: earn the toll on the warriors', () => {
        expect(planErrand(at({ target: 'guard', coins: 10 }))).toEqual({ do: 'cross', toEast: false });
        expect(planErrand(at({ target: 'guard', coins: 3, bankEmpty: true }))).toEqual({ do: 'earn', on: 'warrior', until: 10 });
    });

    test('men while in Al-Kharid: cross west, or stranded below the warriors level', () => {
        expect(planErrand(at({ target: 'man', food: 0, coins: 10 }))).toEqual({ do: 'cross', toEast: false });
        expect(planErrand(at({ target: 'man', food: 0, coins: 0, bankEmpty: true, thieving: 10 }))).toEqual({ do: 'stranded' });
    });
});

describe('planErrand: on the right side', () => {
    test('bank at bankAt, walk to the station, then thieve', () => {
        expect(planErrand(at({ coins: 3000 }))).toEqual({ do: 'bank' });
        expect(planErrand(at({ atStation: false }))).toEqual({ do: 'go' });
        expect(planErrand(at({}))).toEqual({ do: 'thieve' });
    });

    test('men need no food and never bank', () => {
        expect(planErrand(at({ target: 'man', east: false, food: 0, coins: 5000 }))).toEqual({ do: 'thieve' });
    });

    test('guards out of food go east for kebabs', () => {
        expect(planErrand(at({ target: 'guard', east: false, food: 0, coins: 200 }))).toEqual({ do: 'cross', toEast: true });
    });
});
