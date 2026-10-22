import { describe, expect, test } from 'bun:test';
import type { BotWorldState, CombatEvent, InventoryItem, NearbyNpc, PlayerState } from '../../sdk/types';
import { baseState, drive, FakeSdk, simulateWalking } from '../lib/fake-sdk';
import { approach, attackerOf, damageWatch, DEFAULT_GIVER_TILE, MEET_RADIUS, planApproach } from './kit-return';

const player = (worldX: number, worldZ: number, hp = 10, level = 0) => ({ name: 'kr', x: worldX, z: worldZ, worldX, worldZ, level, hp, maxHp: 10, isDead: false }) as PlayerState;
const item = (slot: number, name: string, count = 1) => ({ slot, id: 1000 + slot, name, count, optionsWithIndex: [] }) as unknown as InventoryItem;
const magic = (level: number) => [{ name: 'Magic', level, baseLevel: level, experience: 0 }];
const lumbridgeRunes = [item(0, 'Air rune', 3), item(1, 'Earth rune', 1), item(2, 'Law rune', 1)];
const state = (x: number, z: number, more: Partial<BotWorldState> = {}) => baseState({ tick: 100, player: player(x, z), skills: magic(1), ...more });
const wizard = (x: number, z: number): NearbyNpc => ({ kind: 'npc', id: 1, index: 7, name: 'Dark wizard', combatLevel: 7, x, z, distance: 1, hp: 12, maxHp: 12, healthPercent: 100, targetIndex: -1, inCombat: true, lastCombatTick: null, animId: -1, spotanimId: -1, optionsWithIndex: [], options: [] });
const hit = (tick: number, damage: number): CombatEvent => ({ tick, type: 'damage_taken', damage, sourceType: 'npc', sourceIndex: 7, targetType: 'player', targetIndex: 0 });

describe('planApproach: walk, teleport first, or refuse', () => {
    test('within the meeting radius on the same level: walk', () => {
        expect(planApproach(state(3240, 3240), DEFAULT_GIVER_TILE)).toEqual({ kind: 'walk', distance: 18 });
        expect(planApproach(state(3222 + MEET_RADIUS, 3222), DEFAULT_GIVER_TILE)).toMatchObject({ kind: 'walk' });
    });

    test('far at Magic 1 (a combat-3 rehearsal account, rs/296 from Ardougne): refused, naming the spell and --at', () => {
        const p = planApproach(state(2603, 3234), DEFAULT_GIVER_TILE);
        expect(p.kind).toBe('refuse');
        const reason = (p as { reason: string }).reason;
        expect(reason).toContain('2603,3234 is 619 tiles from the giver at 3222,3222');
        expect(reason).toContain('lumbridge teleport: Magic 1 is below 31');
        expect(reason).toContain('no home teleport');
        expect(reason).toContain('--at=x,z');
    });

    test('far one tile past the radius, with Magic 31 and the runes: the Lumbridge teleport first', () => {
        const s = state(3222 + MEET_RADIUS + 1, 3222, { skills: magic(31), inventory: lumbridgeRunes });
        expect(planApproach(s, DEFAULT_GIVER_TILE)).toEqual({ kind: 'teleport', spell: 'lumbridge', distance: 31 });
    });

    test('upstairs counts as far even when close', () => {
        const s = baseState({ tick: 100, player: player(3222, 3220, 10, 1), skills: magic(1) });
        expect(planApproach(s, DEFAULT_GIVER_TILE)).toMatchObject({ kind: 'refuse' });
    });

    test('deep Wilderness (the Wilderness Agility course) with Magic and runes: blocked above level 20', () => {
        const s = state(3002, 3940, { skills: magic(99), inventory: lumbridgeRunes });
        const p = planApproach(s, DEFAULT_GIVER_TILE);
        expect(p.kind).toBe('refuse');
        expect((p as { reason: string }).reason).toContain('(Wilderness level 53)');
        expect((p as { reason: string }).reason).toContain('lumbridge teleport: Wilderness level 53 is above 20');
    });

    test('a giver tile no teleport lands near: refused, whatever the account can cast', () => {
        const s = state(2603, 3234, { skills: magic(99), inventory: lumbridgeRunes });
        const p = planApproach(s, { x: 3093, z: 3244 }); // Draynor bank
        expect((p as { reason: string }).reason).toContain('no standard teleport lands within 30 tiles of 3093,3244');
    });
});

describe('damageWatch', () => {
    test('a hitpoint lost names the attacker from the damage event', () => {
        const watch = damageWatch(state(3230, 3222));
        expect(watch(state(3229, 3222, { tick: 101 }))).toBeNull();
        const d = watch(state(3228, 3222, { tick: 102, player: player(3228, 3222, 8), combatEvents: [hit(102, 2)], nearbyNpcs: [wizard(3226, 3223)] }));
        expect(d).toEqual({ tick: 102, hp: 8, by: 'Dark wizard (level 7) at 3226,3223' });
    });

    test('a hit of 0 is an attack too; an event from before the watch is not', () => {
        const watch = damageWatch(state(3230, 3222, { combatEvents: [hit(90, 1)] }));
        expect(watch(state(3229, 3222, { tick: 101, combatEvents: [hit(90, 1)] }))).toBeNull();
        expect(watch(state(3229, 3222, { tick: 102, combatEvents: [hit(90, 1), hit(102, 0)], nearbyNpcs: [wizard(3227, 3222)] }))?.by).toMatch(/^Dark wizard/);
    });

    test('hitpoints regained are not damage, and a later drop from the new high is', () => {
        const watch = damageWatch(baseState({ tick: 100, player: player(3230, 3222, 8) }));
        expect(watch(baseState({ tick: 101, player: player(3230, 3222, 9) }))).toBeNull();
        expect(watch(baseState({ tick: 102, player: player(3230, 3222, 9) }))).toBeNull();
        expect(watch(baseState({ tick: 103, player: player(3230, 3222, 8) }))).toMatchObject({ hp: 8, by: 'an unseen source (no attacker in view)' });
    });

    test('attackerOf falls back to the nearest NPC in combat when the event source is out of view', () => {
        const s = state(3230, 3222, { combatEvents: [{ ...hit(101, 1), sourceIndex: 99 }], nearbyNpcs: [wizard(3229, 3222)] });
        expect(attackerOf(s, 100)).toBe('Dark wizard (level 7) at 3229,3222');
    });
});

describe('approach', () => {
    const sends = (sdk: FakeSdk, method: string) => sdk.sent.filter(a => a.method === method).map(a => a.args);

    test('near: runs to the giver', async () => {
        const sdk = new FakeSdk(state(3240, 3222));
        simulateWalking(sdk);
        const r = await drive(sdk, approach(sdk as never, DEFAULT_GIVER_TILE));
        expect(r).toMatchObject({ ok: true, plan: { kind: 'walk' } });
        expect(Math.abs(sdk.state!.player!.worldX - 3222)).toBeLessThanOrEqual(2);
    });

    test('far without a castable teleport: refused with no click at all', async () => {
        const sdk = new FakeSdk(state(2603, 3234));
        simulateWalking(sdk);
        const r = await drive(sdk, approach(sdk as never, DEFAULT_GIVER_TILE));
        expect(r.ok).toBe(false);
        expect(r.plan.kind).toBe('refuse');
        expect(sdk.sent).toEqual([]);
    });

    test('far with the Lumbridge teleport castable: cast, then the short run', async () => {
        const sdk = new FakeSdk(state(3100, 3300, { skills: magic(31), inventory: lumbridgeRunes }));
        simulateWalking(sdk);
        const prev = sdk.onSend;
        sdk.onSend = (a, f) => {
            prev(a, f);
            if (a.method === 'sendClickComponent') queueMicrotask(() => f.tick({ player: player(3221, 3218) }));
        };
        const r = await drive(sdk, approach(sdk as never, DEFAULT_GIVER_TILE));
        expect(r).toMatchObject({ ok: true, plan: { kind: 'teleport', spell: 'lumbridge' }, runFrom: { x: 3221, z: 3218 } });
        expect(sends(sdk, 'sendClickComponent')).toEqual([[1167]]);
    });

    test('a hit on the way halts the run where it stands, names the attacker, and never resumes', async () => {
        const sdk = new FakeSdk(state(3250, 3222));
        const sim = simulateWalking(sdk);
        // `drive` patches each new tick from the state before it: the hit shows on tick 105.
        const r = await drive(sdk, approach(sdk as never, DEFAULT_GIVER_TILE), 600, s =>
            s.tick === 104 ? { player: { ...s.player!, hp: 9 }, combatEvents: [hit(105, 1)], nearbyNpcs: [wizard(s.player!.worldX - 2, 3222)] } : {});
        expect(r.ok).toBe(false);
        expect(r.damage).toMatchObject({ tick: 105, hp: 9, by: expect.stringMatching(/^Dark wizard \(level 7\)/) });
        expect(r.reason).toMatch(/stopped: took damage from Dark wizard/);
        expect(r.runFrom).toEqual({ x: 3250, z: 3222 });
        // The last click is a walk to the tile the player stood on when the hit showed: the halt.
        const stopAt = sim.clicks.at(-1)!;
        expect(stopAt).toMatchObject({ x: stopAt.from.x, z: stopAt.from.z, tick: 105 });
        const x = sdk.state!.player!.worldX;
        for (let i = 0; i < 5; i++) sdk.tick();
        expect(sdk.state!.player!.worldX).toBe(x);
        expect(x).toBeGreaterThan(3224);
    });
});
