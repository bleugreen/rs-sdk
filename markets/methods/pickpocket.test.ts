import { describe, expect, test } from 'bun:test';
import { FailureRun, foodToWithdraw, nextErrand, roamTo, routable, shouldEat, toward, unroutable, walkThroughDoors, WalkFailed, type DoorWalk } from './pickpocket';

describe('foodToWithdraw', () => {
    test('leaves a slot for the coins', () => {
        expect(foodToWithdraw(0, 0)).toBe(27);
        expect(foodToWithdraw(2, 0)).toBe(25);
        expect(foodToWithdraw(0, 10)).toBe(10);
        expect(foodToWithdraw(20, 10)).toBe(7);
        expect(foodToWithdraw(27, 0)).toBe(0);
        expect(foodToWithdraw(28, 5)).toBe(0);
    });
    test("keeps a slot for each of the pocket's stacks: a stuck item counts against the room", () => {
        expect(foodToWithdraw(0, 0, 3)).toBe(25);
        expect(foodToWithdraw(1, 0, 3)).toBe(24);
        expect(foodToWithdraw(0, 26, 3)).toBe(25);
    });
});

// the messages sdk/actions.ts walkTo returns; the first two are the demo's trapped knights' (2026-10-24)
const SHORT = 'Path to (2653, 3300) stops 17 tiles short at (2669, 3317) - the rest is unroutable from here (locked door or separate room?)';
const NO_WAY = 'No path to (2654, 3285) from (2671, 3315): no waypoints';

describe('unroutable', () => {
    test('a walk with no route out of the room', () => {
        expect(unroutable(SHORT)).toBe(true);
        expect(unroutable(NO_WAY)).toBe(true);
        expect(unroutable('Stuck at (2671, 3315)')).toBe(true);
        expect(unroutable('Could not reach (2654, 3285) - stopped at (2671, 3315)')).toBe(true);
    });
    test('not a door: death, timeout, a blocked destination, no state', () => {
        expect(unroutable('Walk aborted: player died en route to (2654, 3285)')).toBe(false);
        expect(unroutable('Walk timed out after 120000ms: at (2671, 3315), destination (2654, 3285)')).toBe(false);
        expect(unroutable('No path to (2654, 3285) from (2671, 3315): destination tile is blocked')).toBe(false);
        expect(unroutable('No in-game player state')).toBe(false);
    });
});

/** A DoorWalk whose walks answer `walks` in turn, recording every call. */
function fakeDoors(walks: string[]): DoorWalk & { calls: string[] } {
    const calls: string[] = [];
    return {
        calls,
        walk: async () => {
            const m = walks.shift() ?? 'Arrived';
            calls.push(`walk:${m === 'Arrived' ? 'ok' : 'fail'}`);
            return { ok: m === 'Arrived', message: m };
        },
        openDoor: async () => (calls.push('door'), { success: true, message: 'Door opened' }),
        clickWalk: async t => (calls.push('click'), { ok: true, message: '', at: t }),
        wait: async n => void calls.push(`wait:${n}`),
        log: () => undefined
    };
}

describe('walkThroughDoors', () => {
    const bank = { x: 2654, z: 3285 };
    test('a walk that arrives opens nothing', async () => {
        const d = fakeDoors(['Arrived']);
        await walkThroughDoors(d, bank);
        expect(d.calls).toEqual(['walk:ok']);
    });
    test('unroutable: open the door, click through it, walk again', async () => {
        const d = fakeDoors([NO_WAY, 'Arrived']);
        await walkThroughDoors(d, bank);
        expect(d.calls).toEqual(['walk:fail', 'door', 'click', 'walk:ok']);
    });
    test('still shut: wait, open, click and walk again', async () => {
        const d = fakeDoors([SHORT, NO_WAY, 'Arrived']);
        await walkThroughDoors(d, bank, 5);
        expect(d.calls).toEqual(['walk:fail', 'door', 'click', 'walk:fail', 'wait:5', 'door', 'click', 'walk:ok']);
    });
    test('no way out after both tries: throws, so the bank is not opened from the room', async () => {
        const d = fakeDoors([SHORT, NO_WAY, NO_WAY]);
        await expect(walkThroughDoors(d, bank)).rejects.toBeInstanceOf(WalkFailed);
        expect(d.calls).toEqual(['walk:fail', 'door', 'click', 'walk:fail', 'wait:5', 'door', 'click', 'walk:fail']);
    });
    test('any other failed walk throws without touching a door', async () => {
        const d = fakeDoors(['Walk aborted: player died en route to (2654, 3285)']);
        await expect(walkThroughDoors(d, bank)).rejects.toThrow(/died en route/);
        expect(d.calls).toEqual(['walk:fail']);
    });
});

describe('toward', () => {
    test('the target itself within reach, else the tile `reach` along the way', () => {
        expect(toward({ x: 2671, z: 3315 }, { x: 2654, z: 3285 })).toEqual({ x: 2654, z: 3285 });
        expect(toward({ x: 0, z: 0 }, { x: 100, z: -50 }, 30)).toEqual({ x: 30, z: -15 });
    });
});

describe('routable', () => {
    const anchor = { x: 2667, z: 3306 };
    test('only a path ending on the tile itself counts, and each answer is asked once', () => {
        let asked = 0;
        // the map stops one tile short of the room's floor, across its wall
        const find = (_: unknown, to: { x: number; z: number }) => (asked++, to.z >= 3315 ? [{ x: to.x, z: 3314 }] : [to]);
        const cache = new Map<string, boolean>();
        expect(routable(anchor, { x: 2671, z: 3313 }, find, cache)).toBe(true);
        expect(routable(anchor, { x: 2671, z: 3315 }, find, cache)).toBe(false);
        expect(routable(anchor, { x: 2671, z: 3315 }, find, cache)).toBe(false);
        expect(routable(anchor, { x: 2671, z: 3315 }, () => [], new Map())).toBe(false);
        expect(asked).toBe(2);
    });
});

describe('FailureRun', () => {
    test('reaches its max only on failures in a row', () => {
        const f = new FailureRun(3);
        expect(f.fail()).toBe(false);
        expect(f.fail()).toBe(false);
        f.ok();
        expect(f.fail()).toBe(false);
        expect(f.fail()).toBe(false);
        expect(f.fail()).toBe(true);
    });
});

describe('shouldEat', () => {
    const base = { maxHp: 70, heal: 20, damage: 3, window: true, ticksSinceEat: 10 };
    test('in a success window, eat once a shark would not be wasted', () => {
        expect(shouldEat({ ...base, hp: 51 })).toBe(false);
        expect(shouldEat({ ...base, hp: 50 })).toBe(true);
    });
    test('out of the window, only when the next failure could kill', () => {
        expect(shouldEat({ ...base, hp: 10, window: false })).toBe(false);
        expect(shouldEat({ ...base, hp: 4, window: false })).toBe(true);
        expect(shouldEat({ ...base, hp: 4, window: false, ticksSinceEat: 1 })).toBe(false);
    });
    test('at 10 HP a shark is always partly wasted: eat in the window at two failures from the floor', () => {
        const low = { ...base, maxHp: 10 };
        expect(shouldEat({ ...low, hp: 8 })).toBe(false);
        expect(shouldEat({ ...low, hp: 7 })).toBe(true);
    });
});

describe('nextErrand', () => {
    test('bank when out of food or carrying bankAt coins; else thieve at the station', () => {
        expect(nextErrand({ food: 0, coins: 0, bankAt: 50000, atStation: true })).toBe('bank');
        expect(nextErrand({ food: 5, coins: 50000, bankAt: 50000, atStation: true })).toBe('bank');
        expect(nextErrand({ food: 5, coins: 10, bankAt: 50000, atStation: false })).toBe('go');
        expect(nextErrand({ food: 5, coins: 10, bankAt: 50000, atStation: true })).toBe('thieve');
    });
});

describe('roamTo', () => {
    const spawns = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 30, z: 0 }];
    test('nearest untried spawn, then the round restarts', () => {
        expect(roamTo(spawns, { x: 12, z: 0 }, new Set())).toBe(1);
        expect(roamTo(spawns, { x: 12, z: 0 }, new Set([1]))).toBe(0);
        expect(roamTo(spawns, { x: 12, z: 0 }, new Set([0, 1]))).toBe(2);
        expect(roamTo(spawns, { x: 12, z: 0 }, new Set([0, 1, 2]))).toBe(1);
    });
});
