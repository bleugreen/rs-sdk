import { describe, expect, test } from 'bun:test';
import type { BotWorldState, InventoryItem, PlayerState, SkillState } from '../../sdk/types';
import { baseState, FakeSdk } from '../lib/fake-sdk';
import { EatGuard, eatBlocker } from './eat-guard';

const SHARK = /^shark$/i;
const shark = (slot: number): InventoryItem => ({ slot, id: 385, name: 'Shark', count: 1, optionsWithIndex: [{ text: 'Eat', opIndex: 1 }, { text: 'Drop', opIndex: 5 }] });
const notedShark = (slot: number): InventoryItem => ({ slot, id: 386, name: 'Shark', count: 150, optionsWithIndex: [{ text: 'Drop', opIndex: 5 }] });
const hpSkill = (level: number, base = 80): SkillState => ({ name: 'Hitpoints', level, baseLevel: base, experience: 0 } as SkillState);

function player(x: number, z: number): PlayerState {
    return { worldX: x, worldZ: z, level: 0, hp: 80, maxHp: 80, isDead: false, respawnCount: 0, combat: { inCombat: false } } as unknown as PlayerState;
}

function walking(hp: number, x: number, z: number, extra: Partial<BotWorldState> = {}): Partial<BotWorldState> {
    return { player: player(x, z), skills: [hpSkill(hp)], ...extra };
}

const eatsSent = (sdk: FakeSdk) => sdk.sent.filter(a => a.method === 'sendUseItem');

describe('EatGuard', () => {
    // Regression for rs/48's baby blue probe: cairn_h51 died at (2901, 9800) on the walk in from
    // the dusty-key door, because the role only ate between fights. Here nothing but the guard
    // runs while the player walks south through the dungeon and is hit on the way.
    test('eats while walking, with no other action in flight', () => {
        const sdk = new FakeSdk(baseState({ ...walking(70, 2925, 9803), inventory: [{ slot: 0, id: 1590, name: 'Dusty key', count: 1, optionsWithIndex: [] }, shark(1), shark(2)] }));
        const guard = new EatGuard(sdk, { eatAt: 0.55, food: SHARK }).start();
        sdk.tick(walking(60, 2915, 9803));
        sdk.tick(walking(48, 2905, 9801));
        expect(eatsSent(sdk)).toEqual([]);
        sdk.tick(walking(40, 2901, 9800)); // 40/80 = 0.50: below 0.55
        expect(eatsSent(sdk)).toEqual([{ method: 'sendUseItem', args: [1, 1] }]);
        expect(guard.eats).toBe(1);
        guard.stop();
    });

    test('waits 3 ticks between eats, then eats again while still low (poison)', () => {
        const sdk = new FakeSdk(baseState({ ...walking(30, 2900, 9790), inventory: [shark(0), shark(1), shark(2)] }));
        const guard = new EatGuard(sdk, { eatAt: 0.55, food: SHARK }).start();
        expect(eatsSent(sdk).length).toBe(1);
        sdk.tick(walking(30, 2900, 9789));
        sdk.tick(walking(30, 2900, 9788));
        expect(eatsSent(sdk).length).toBe(1);
        sdk.tick(walking(30, 2900, 9787)); // the eat did not land (or poison ate it): try again
        expect(eatsSent(sdk).length).toBe(2);
        sdk.tick(walking(70, 2900, 9786));
        sdk.tick(walking(70, 2900, 9785));
        sdk.tick(walking(70, 2900, 9784));
        expect(eatsSent(sdk).length).toBe(2);
        guard.stop();
    });

    test('never eats banknotes, and does nothing without food', () => {
        const sdk = new FakeSdk(baseState({ ...walking(20, 3185, 3436), inventory: [notedShark(0)] }));
        const guard = new EatGuard(sdk, { eatAt: 0.55, food: SHARK }).start();
        sdk.tick(walking(20, 3185, 3436));
        expect(eatsSent(sdk)).toEqual([]);
        guard.stop();
    });

    test('holds off while a bank or the exchange is open, and eats once it closes', () => {
        const open = { bank: { isOpen: true, items: [], noteMode: false } } as Partial<BotWorldState>;
        const sdk = new FakeSdk(baseState({ ...walking(20, 2946, 3368), ...open, inventory: [shark(3)] }));
        const guard = new EatGuard(sdk, { eatAt: 0.55, food: SHARK }).start();
        sdk.tick({ ...walking(20, 2946, 3368), ...open });
        expect(eatsSent(sdk)).toEqual([]);
        sdk.tick({ ...walking(20, 2946, 3368), bank: { isOpen: false, items: [], noteMode: false } });
        expect(eatsSent(sdk)).toEqual([{ method: 'sendUseItem', args: [3, 1] }]);
        guard.stop();
    });

    test('a new client tick counter does not suppress eating after reconnect', () => {
        const sdk = new FakeSdk(baseState({ ...walking(20, 2900, 9790), tick: 50000, inventory: [shark(0)] }));
        const guard = new EatGuard(sdk, { eatAt: 0.55, food: SHARK }).start();
        expect(eatsSent(sdk)).toHaveLength(1);
        sdk.push({ tick: 1, inGame: false });
        expect(eatsSent(sdk)).toHaveLength(1);
        sdk.push({ tick: 2, inGame: true });
        expect(eatsSent(sdk)).toHaveLength(2);
        sdk.tick();
        expect(eatsSent(sdk)).toHaveLength(2);
        guard.stop();
    });

    test('stops watching after stop()', () => {
        const sdk = new FakeSdk(baseState({ ...walking(70, 2900, 9790), inventory: [shark(0)] }));
        const guard = new EatGuard(sdk, { eatAt: 0.55, food: SHARK }).start();
        guard.stop();
        sdk.tick(walking(10, 2900, 9790));
        expect(eatsSent(sdk)).toEqual([]);
    });
});

test('eatBlocker names the window that is open', () => {
    const s = baseState(walking(10, 0, 0));
    expect(eatBlocker(s)).toBeNull();
    expect(eatBlocker({ ...s, shop: { ...s.shop, isOpen: true } })).toBe('shop');
    expect(eatBlocker({ ...s, interface: { ...s.interface, isOpen: true } })).toBe('interface');
    expect(eatBlocker({ ...s, player: { ...s.player!, isDead: true } })).toBe('dead');
});
