import { describe, expect, test } from 'bun:test';
import type { BotSDK } from '../../sdk/index';
import type { InventoryItem, NearbyNpc, PlayerState, SkillState } from '../../sdk/types';
import { FakeSdk, baseState } from '../lib/fake-sdk';
import { STUCK_AFTER, choosePhase, pickTarget, retryDelayTicks, situation, type Source } from './grapes';
import { ITEM, walkCannotSucceed } from './wine-common';

const OPTS = { cooking: 35, fightLevel: 10 };
const item = (slot: number, id: number, name: string, count = 1): InventoryItem => ({ slot, id, name, count, optionsWithIndex: [] });
const skill = (name: string, level: number): SkillState => ({ name, level, baseLevel: level, experience: 0 });
const player = (x: number, z: number, level = 0, inCombat = false): PlayerState =>
    ({ name: 'cairn_h46', worldX: x, worldZ: z, x, z, level, hp: 66, maxHp: 66, combat: { inCombat } }) as unknown as PlayerState;

const SWORD = item(3, 1277, 'Bronze sword');
const HAT = item(0, ITEM.chefsHat, "Chef's hat");
const food = (n: number) => Array.from({ length: n }, (_, i) => item(i, 2140, 'Cooked chicken'));

interface Account {
    at: [number, number, number?];
    combat?: number;
    cooking?: number;
    inventory?: InventoryItem[];
    equipment?: InventoryItem[];
}

function sdkFor(a: Account): BotSDK {
    const c = a.combat ?? 1;
    const fake = new FakeSdk(
        baseState({
            player: player(a.at[0], a.at[1], a.at[2] ?? 0),
            skills: [skill('Attack', c), skill('Strength', c), skill('Defence', c), skill('Hitpoints', Math.max(10, c)), skill('Cooking', a.cooking ?? 1)],
            inventory: a.inventory ?? [],
            equipment: a.equipment ?? []
        })
    );
    return fake as unknown as BotSDK;
}

const phaseOf = (source: Source, a: Account, member: boolean | null = null, kitTried = false) => choosePhase(situation(sdkFor(a), source, OPTS, member), kitTried);

// The two accounts the fleet failed to restart (2026-10-21 08:47 UTC), as they stood.
const H46_AT_HIDEOUT_SPAWN: Account = { at: [3237, 9762], combat: 66, cooking: 44, equipment: [SWORD], inventory: food(2) };
const H40_AT_GUILD_SPAWN: Account = { at: [3143, 3450, 2], combat: 25, cooking: 35, equipment: [HAT, SWORD], inventory: food(3) };

describe('phoenix start-up', () => {
    test('standing at the hideout spawn: a member, so it camps (the fleet restart sent it to the chickens)', () => {
        const s = situation(sdkFor(H46_AT_HIDEOUT_SPAWN), 'phoenix', OPTS, null);
        expect(s.phoenixMember).toBe(true);
        expect(choosePhase(s, false)).toBe('camp-phoenix');
    });

    test('the spawn room makes it a member without food, kit or the fight level', () => {
        expect(phaseOf('phoenix', { at: [3237, 9762], combat: 3, cooking: 1 })).toBe('camp-phoenix');
    });

    test('mid-walk on the surface, membership unknown, able to fight: goes to camp and lets the door decide', () => {
        expect(phaseOf('phoenix', { at: [3250, 3410], combat: 66, cooking: 44, equipment: [SWORD] })).toBe('camp-phoenix');
    });

    test('in the ladder room (outside the door), membership unknown: still the door decides', () => {
        const s = situation(sdkFor({ at: [3244, 9783], combat: 66, equipment: [SWORD] }), 'phoenix', OPTS, null);
        expect(s.phoenixMember).toBeNull();
        expect(choosePhase(s, false)).toBe('camp-phoenix');
    });

    test('refused at the door: trains for the quest first, then runs it', () => {
        expect(phaseOf('phoenix', { at: [3244, 9783], combat: 66, equipment: [SWORD], inventory: food(2) }, false)).toBe('chickens');
        expect(phaseOf('phoenix', { at: [3244, 9783], combat: 66, equipment: [SWORD], inventory: food(8) }, false)).toBe('phoenix-quest');
    });

    test('carrying the intelligence report: straight back to Straven, no training', () => {
        expect(phaseOf('phoenix', { at: [3223, 3395], combat: 3, inventory: [item(0, 761, 'Scroll')] }, false)).toBe('phoenix-quest');
    });

    test('a fresh account trains on chickens before it ever probes the door', () => {
        expect(phaseOf('phoenix', { at: [3222, 3218], combat: 1, equipment: [SWORD] })).toBe('chickens');
    });

    test('Cooking only gates the guild', () => {
        expect(situation(sdkFor(H46_AT_HIDEOUT_SPAWN), 'phoenix', OPTS, null).cookTo).toBe(0);
        expect(situation(sdkFor(H46_AT_HIDEOUT_SPAWN), 'goblins', OPTS, null).cookTo).toBe(0);
        expect(situation(sdkFor(H46_AT_HIDEOUT_SPAWN), 'guild', OPTS, null).cookTo).toBe(35);
    });
});

describe('guild start-up', () => {
    test('at the stand on the top floor with hat and Cooking 35: camps, whatever its food', () => {
        expect(phaseOf('guild', H40_AT_GUILD_SPAWN)).toBe('camp-guild');
    });

    test('camps from any floor or from the walk there', () => {
        for (const at of [[3144, 3446, 1], [3145, 3449, 0], [3143, 3443, 0], [3185, 3436, 0]] as [number, number, number][]) {
            expect(phaseOf('guild', { ...H40_AT_GUILD_SPAWN, at })).toBe('camp-guild');
        }
    });

    test('without the hat: hunts it, after food; below Cooking 35: chickens', () => {
        expect(phaseOf('guild', { at: [3250, 3238], combat: 25, cooking: 35, equipment: [SWORD], inventory: food(8) })).toBe('hat-hunt');
        expect(phaseOf('guild', { at: [3250, 3238], combat: 25, cooking: 35, equipment: [SWORD], inventory: food(2) })).toBe('chickens');
        expect(phaseOf('guild', { at: [3231, 3295], combat: 25, cooking: 20, equipment: [HAT, SWORD], inventory: food(8) })).toBe('chickens');
    });

    test('the tutorial kit is fetched once, only for a fight phase', () => {
        expect(phaseOf('guild', { at: [3222, 3218], combat: 1 })).toBe('fetch-kit');
        expect(phaseOf('guild', { at: [3222, 3218], combat: 1 }, null, true)).toBe('chickens');
        expect(phaseOf('guild', { ...H40_AT_GUILD_SPAWN, equipment: [HAT] })).toBe('camp-guild');
        // Any wielded weapon counts, not only the bronze sword.
        expect(phaseOf('goblins', { at: [2956, 3504], combat: 30, equipment: [item(3, 1323, 'Iron scimitar')], inventory: food(8) })).toBe('goblin-village');
    });
});

describe('goblins restarted mid-fight', () => {
    const goblin = (index: number, x: number, z: number, distance: number, inCombat: boolean): NearbyNpc =>
        ({ index, name: 'Goblin', x, z, distance, inCombat, hp: 5, reachable: true, optionsWithIndex: [{ text: 'Attack', opIndex: 2 }] }) as unknown as NearbyNpc;
    const VILLAGE = { x1: 2940, z1: 3488, x2: 2972, z2: 3520 };

    test('resumes the village with food and level', () => {
        expect(phaseOf('goblins', { at: [2957, 3505], combat: 25, equipment: [SWORD], inventory: food(7) })).toBe('goblin-village');
    });

    test('finishes the goblin already fighting it before picking a closer idle one', () => {
        const s = baseState({
            player: player(2956, 3504, 0, true),
            nearbyNpcs: [goblin(1, 2956, 3505, 1, false), goblin(2, 2957, 3504, 2, true), goblin(3, 2960, 3510, 6, false)]
        });
        expect(pickTarget(s, /^goblin$/i, VILLAGE)?.index).toBe(2);
    });

    test('out of combat: the nearest idle goblin', () => {
        const s = baseState({ player: player(2956, 3504), nearbyNpcs: [goblin(2, 2957, 3504, 2, true), goblin(1, 2956, 3506, 2, false), goblin(3, 2960, 3510, 6, false)] });
        expect(pickTarget(s, /^goblin$/i, VILLAGE)?.index).toBe(1);
    });
});

describe('retries', () => {
    test('a failed cycle waits longer each time, capped at two minutes', () => {
        expect([1, 2, 3, 4, 5, 6, 7, 8].map(retryDelayTicks)).toEqual([5, 10, 20, 40, 80, 160, 200, 200]);
        expect(STUCK_AFTER).toBeGreaterThan(1);
    });

    test('a route on another plane or onto a blocked tile is not retried', () => {
        expect(walkCannotSucceed('No path to (3231, 3295) from (3237, 9762): Destination (3231, 3295) is unreachable — path ends 6471 tiles away')).toBe(true);
        expect(walkCannotSucceed('No path to (3144, 3450) from (3143, 3450): destination tile is blocked')).toBe(true);
        expect(walkCannotSucceed('Walk timed out')).toBe(false);
    });
});
