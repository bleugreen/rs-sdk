import { describe, expect, test } from 'bun:test';
import type { NearbyLoc, NearbyNpc, PlayerState } from '../../sdk/types';
import { baseState, FakeSdk } from './fake-sdk';
import { at, configId, findLoc, findNpc, invCount, messagesSince, pos, routeTiles, tileCounter, waitForNpc } from './world';

const player = (worldX: number, worldZ: number, level = 0) => ({ worldX, worldZ, level, hp: 10, maxHp: 10 }) as PlayerState;
const npc = (index: number, name: string, x: number, z: number, distance: number): NearbyNpc =>
    ({ kind: 'npc', id: 100 + index, index, name, x, z, distance, hp: 5, maxHp: 5, optionsWithIndex: [{ text: 'Talk-to', opIndex: 1 }], options: ['Talk-to'] }) as NearbyNpc;
const loc = (id: number, name: string, x: number, z: number, distance: number, ops: string[]): NearbyLoc =>
    ({ id, name, x, z, level: 0, distance, optionsWithIndex: ops.map((text, i) => ({ text, opIndex: i + 1 })), options: ops });

describe('world', () => {
    test('pos and at accept the SDK or a state', () => {
        const sdk = new FakeSdk(baseState({ player: player(3200, 3200, 1) }));
        expect(pos(sdk as never)).toEqual({ x: 3200, z: 3200, level: 1 });
        expect(pos(null)).toEqual({ x: -1, z: -1, level: -1 });
        expect(at(3201, 3199, 1, 1)(sdk.state!)).toBe(true);
        expect(at(3201, 3199, 0, 1)(sdk.state!)).toBe(false);
    });

    test('findNpc: nearest by distance, by tile, or by config id', () => {
        const s = baseState({ nearbyNpcs: [npc(1, 'Guard', 10, 10, 5), npc(2, 'Guard', 20, 20, 3)] });
        expect(findNpc(s, /guard/i)?.index).toBe(2);
        expect(findNpc(s, 'guard', { x: 11, z: 11 })?.index).toBe(1);
        expect(findNpc(s, 101)?.index).toBe(1);
        expect(findNpc(s, /monk/i)).toBeNull();
    });

    test('waitForNpc waits for the list to catch up', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1 }));
        const p = waitForNpc(sdk as never, /guard/i, 5);
        sdk.tick();
        sdk.tick({ nearbyNpcs: [npc(7, 'Guard', 1, 1, 1)] });
        expect((await p)?.index).toBe(7);
    });

    test('findLoc filters by tile, op and name, and scans when the published list has no match', async () => {
        const door = loc(1530, 'Door', 3200, 3200, 2, ['Open']);
        const deco = loc(99, 'Wall decoration', 3200, 3200, 2, []);
        const ladder = loc(1747, 'Ladder', 3205, 3205, 6, ['Climb-up', 'Climb-down']);
        const sdk = Object.assign(new FakeSdk(baseState({ nearbyLocs: [deco, door] })), { scanNearbyLocs: async () => [deco, door, ladder] });
        expect((await findLoc(sdk as never, { x: 3200, z: 3200, op: 'open' }))?.id).toBe(1530);
        expect((await findLoc(sdk as never, { op: /climb-up/i }))?.id).toBe(1747);
        expect(await findLoc(sdk as never, { op: 'climb' })).toBeNull(); // string ops match exactly
    });

    test('findLoc waits for the region to be built before it reads the loc lists', async () => {
        const tree = loc(1317, 'Spirit tree', 2542, 3170, 1, ['Talk-to', 'Travel']);
        const sdk = new FakeSdk(baseState({ tick: 1, sceneReady: false, nearbyLocs: [] }));
        let found: NearbyLoc | null | undefined;
        const p = findLoc(sdk as never, { op: /travel/i }).then(l => (found = l));
        await Promise.resolve();
        sdk.tick();
        await Promise.resolve();
        expect(found).toBeUndefined();
        sdk.tick({ sceneReady: true, nearbyLocs: [tree] });
        await p;
        expect(found?.id).toBe(1317);
    });

    test('invCount sums stacks; messagesSince keeps game messages from a tick on', () => {
        const s = baseState({
            inventory: [{ slot: 0, id: 1, name: 'Shark', count: 1, optionsWithIndex: [] }, { slot: 1, id: 1, name: 'Shark', count: 1, optionsWithIndex: [] }],
            gameMessages: [{ type: 0, text: 'old', sender: '', tick: 5, fromSelf: false }, { type: 0, text: 'You can\'t reach that!', sender: '', tick: 9, fromSelf: false }, { type: 2, text: 'hi', sender: 'x', tick: 9, fromSelf: false }],
        });
        expect(invCount(s, /^shark$/i)).toBe(2);
        expect(messagesSince(s, 8)).toEqual(['You can\'t reach that!']);
        expect(messagesSince(s, 0, /reach/)).toEqual(['You can\'t reach that!']);
    });

    test('tileCounter counts steps and skips teleports and level changes', () => {
        const sdk = new FakeSdk(baseState({ player: player(0, 0) }));
        const c = tileCounter(sdk as never);
        sdk.tick({ player: player(2, 1) });
        sdk.tick({ player: player(4, 3) });
        sdk.tick({ player: player(400, 3) }); // teleport
        sdk.tick({ player: player(401, 3, 1) }); // climb
        sdk.tick({ player: player(402, 3, 1) });
        c.stop();
        expect(c.tiles).toBe(5);
    });

    test('routeTiles and configId', () => {
        expect(routeTiles({ x: 0, z: 0 }, [{ x: 3, z: 1 }, { x: 3, z: 5 }])).toBe(7);
        expect(Number.isInteger(configId('obj', 'shark'))).toBe(true);
        expect(() => configId('npc', 'no_such_npc_name')).toThrow();
    });
});
