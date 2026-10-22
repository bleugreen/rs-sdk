import { describe, expect, test } from 'bun:test';
import { CHEST_LOC, CHESTS, chestOptions, chestStates, combatLevel, LANDING, LOOTED_LOC, OPENED_LOC, perHour, planStep, refusal, SAFE_COMBAT, zoneOf, type PlanInput } from './chest';

const plan = (over: Partial<PlanInput>): PlanInput => ({
    zone: 'basement',
    at: { x: 2586, z: 9739 },
    chests: ['ready', 'ready'],
    carried: 0,
    bankAt: 40,
    bankBlocked: false,
    stopping: false,
    ...over
});

describe('zoneOf', () => {
    test('the chests and the cellar ladder foot are in the basement', () => {
        for (const c of CHESTS) expect(zoneOf({ ...c, level: 0 })).toBe('basement');
        expect(zoneOf({ x: 2562, z: 9756, level: 0 })).toBe('basement');
    });

    test('inside the tower: ground floor, and its upper floor', () => {
        expect(zoneOf({ x: 2563, z: 3356, level: 0 })).toBe('tower');
        expect(zoneOf({ x: 2560, z: 3356, level: 1 })).toBe('upstairs');
    });

    test('the teleport landing and the door step are near; outside the door is not the tower', () => {
        expect(zoneOf({ ...LANDING, level: 0 })).toBe('near');
        expect(zoneOf({ x: 2566, z: 3356, level: 0 })).toBe('near');
    });

    test('Al-Kharid, Varrock and another dungeon are away', () => {
        expect(zoneOf({ x: 3288, z: 3170, level: 0 })).toBe('away');
        expect(zoneOf({ x: 3185, z: 3436, level: 0 })).toBe('away');
        expect(zoneOf({ x: 2884, z: 9798, level: 0 })).toBe('away');
    });
});

describe('chestStates', () => {
    test('reads each chest from the locs on its tile', () => {
        const locs = [
            { x: 2586, z: 9734, id: CHEST_LOC },
            { x: 2586, z: 9737, id: LOOTED_LOC },
            { x: 2585, z: 9741, id: 1102 }
        ];
        expect(chestStates(locs)).toEqual(['ready', 'looted']);
    });

    test('the opened chest counts as looted, and a chest out of view is unknown', () => {
        expect(chestStates([{ x: 2586, z: 9734, id: OPENED_LOC }])).toEqual(['looted', 'unknown']);
        expect(chestStates([])).toEqual(['unknown', 'unknown']);
    });
});

describe('planStep', () => {
    test('in the cave: the nearest ready chest, the first on a tie', () => {
        expect(planStep(plan({}))).toEqual({ do: 'loot', chest: 1 });
        expect(planStep(plan({ at: { x: 2586, z: 9733 } }))).toEqual({ do: 'loot', chest: 0 });
        expect(planStep(plan({ at: { x: 2590, z: 9735 }, chests: ['ready', 'ready'] })).do).toBe('loot');
        expect(planStep(plan({ chests: ['looted', 'ready'] }))).toEqual({ do: 'loot', chest: 1 });
        expect(planStep(plan({ chests: ['ready', 'unknown'] }))).toEqual({ do: 'loot', chest: 0 });
    });

    test('in the cave with nothing ready: walk until both are in view, then wait for a respawn', () => {
        expect(planStep(plan({ chests: ['unknown', 'looted'] }))).toEqual({ do: 'approach' });
        expect(planStep(plan({ chests: ['looted', 'looted'] }))).toEqual({ do: 'wait' });
    });

    test('the cave never banks, whatever is carried', () => {
        expect(planStep(plan({ carried: 500, chests: ['looted', 'looted'] }))).toEqual({ do: 'wait' });
    });

    test('on the surface: bank at bankAt, otherwise straight back to the door', () => {
        expect(planStep(plan({ zone: 'near', carried: 38 }))).toEqual({ do: 'door' });
        expect(planStep(plan({ zone: 'near', carried: 40 }))).toEqual({ do: 'bank' });
        expect(planStep(plan({ zone: 'near', carried: 80, bankBlocked: true }))).toEqual({ do: 'door' });
    });

    test('in the tower go down; anywhere else travel', () => {
        expect(planStep(plan({ zone: 'tower' }))).toEqual({ do: 'ladder' });
        expect(planStep(plan({ zone: 'upstairs' }))).toEqual({ do: 'downstairs' });
        expect(planStep(plan({ zone: 'away', carried: 100 }))).toEqual({ do: 'travel' });
    });
});

describe('planStep: stopping', () => {
    test('below ground a stop is not honoured: loot, wait, climb on until the trap teleports us out', () => {
        expect(planStep(plan({ stopping: true }))).toEqual({ do: 'loot', chest: 1 });
        expect(planStep(plan({ stopping: true, chests: ['looted', 'looted'] }))).toEqual({ do: 'wait' });
        expect(planStep(plan({ stopping: true, zone: 'tower' }))).toEqual({ do: 'ladder' });
    });

    test('on the surface: bank whatever is carried, then finish', () => {
        expect(planStep(plan({ stopping: true, zone: 'near', carried: 2 }))).toEqual({ do: 'bank' });
        expect(planStep(plan({ stopping: true, zone: 'near', carried: 0 }))).toEqual({ do: 'done' });
        expect(planStep(plan({ stopping: true, zone: 'near', carried: 30, bankBlocked: true }))).toEqual({ do: 'done' });
    });

    test('away from Ardougne a stop finishes at once instead of travelling', () => {
        expect(planStep(plan({ stopping: true, zone: 'away', carried: 50 }))).toEqual({ do: 'done' });
    });
});

describe('who may run it', () => {
    const ones = { attack: 1, strength: 1, defence: 1, hitpoints: 10, prayer: 1, ranged: 1, magic: 1 };

    test('combatLevel matches the engine: a coin earner is 3, cairn_h47 (97 melee) is 111', () => {
        expect(combatLevel(ones)).toBe(3);
        expect(combatLevel({ ...ones, attack: 97, strength: 97, defence: 97, hitpoints: 97 })).toBe(111);
        expect(combatLevel({ ...ones, attack: 85, hitpoints: 69 })).toBe(45);
    });

    test('refuses below twice the ogres level, and below Thieving 59', () => {
        expect(SAFE_COMBAT).toBe(107);
        expect(refusal(106, 99)).toMatch(/ogres/);
        expect(refusal(3, 99)).toMatch(/below 107/);
        expect(refusal(111, 58)).toMatch(/Thieving 58/);
        expect(refusal(111, 99)).toBeNull();
        expect(refusal(90, 99, 80)).toBeNull();
    });
});

describe('options and rates', () => {
    test('defaults, and bad values refused', () => {
        expect(chestOptions({})).toEqual({ bankAt: 40, keepCoins: 1000, target: 0, minCombat: 107, reportTicks: 1000 });
        expect(chestOptions({ bankAt: 0, target: 570 }).bankAt).toBe(2);
        expect(chestOptions({ target: 570 }).target).toBe(570);
        expect(chestOptions({ stopFile: '/tmp/x.chest-stop' }).stopFile).toBe('/tmp/x.chest-stop');
        expect(() => chestOptions({ bankAt: -1 })).toThrow(/bankAt/);
        expect(() => chestOptions({ target: '570' })).toThrow(/target/);
    });

    test('perHour needs a minute of data', () => {
        expect(perHour(4, 59_000)).toBeNull();
        expect(perHour(60, 1_800_000)).toBe(120);
    });
});
