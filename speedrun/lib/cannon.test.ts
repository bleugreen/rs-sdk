import { describe, expect, test } from 'bun:test';
import type { BotWorldState, GameMessage, InventoryItem, NearbyLoc, PlayerState } from '../../sdk/types';
import {
    assembledCannon, besideCannon, CannonKeeper, cannonCentre, hasCannonSet, MessageCursor, partsHeld, pickUpCannon, placedCannon, setUpCannon, setupTiles,
} from './cannon';
import { baseState, FakeSdk, flush } from './fake-sdk';

const player = (x = 3288, z = 3810) => ({ worldX: x, worldZ: z, level: 0, hp: 50, maxHp: 50, isDead: false, combat: { inCombat: false, targetIndex: -1, targetType: 'none', lastDamageTick: -1 } }) as unknown as PlayerState;
const inv = (slot: number, name: string, count = 1, op = 'Use'): InventoryItem => ({ slot, id: 100 + slot, name, count, optionsWithIndex: [{ text: op, opIndex: 1 }] });
const kit = (balls = 100): InventoryItem[] => [inv(0, 'Cannon base', 1, 'Set-up'), inv(1, 'Cannon stand'), inv(2, 'Cannon barrels'), inv(3, 'Cannon furnace'), inv(4, 'Cannonball', balls)];
const loc = (name: string, x = 3287, z = 3809, distance = 1): NearbyLoc =>
    ({ id: name.length, name, x, z, level: 0, distance, optionsWithIndex: name === 'Dwarf MultiCannon' ? [{ text: 'Fire', opIndex: 1 }, { text: 'Pick-up', opIndex: 2 }] : [{ text: 'Pick-up', opIndex: 1 }], options: [] }) as unknown as NearbyLoc;
const msg = (tick: number, text: string): GameMessage => ({ tick, text, type: 0, sender: '' }) as unknown as GameMessage;
const st = (patch: Partial<BotWorldState> = {}) => baseState({ tick: 100, player: player(), ...patch });
const sends = (sdk: FakeSdk, method: string) => sdk.sent.filter(a => a.method === method);

async function tick(sdk: FakeSdk, patch: Partial<BotWorldState> | ((s: BotWorldState) => Partial<BotWorldState>) = {}) {
    await flush();
    sdk.tick(patch);
    await flush();
}

describe('cannon state', () => {
    test('parts, set and placed locs are read from the state', () => {
        const s = st({ inventory: kit(), nearbyLocs: [loc('Cannon base', 1, 1, 3), loc('Dwarf MultiCannon', 2, 2, 5)] });
        expect(partsHeld(s)).toBe(4);
        expect(hasCannonSet(s)).toBe(true);
        expect(placedCannon(s)!.name).toBe('Cannon base');
        expect(assembledCannon(s)!.name).toBe('Dwarf MultiCannon');
        expect(hasCannonSet(st({ inventory: kit().slice(1) }))).toBe(false);
    });

    test('the centre is the south-west tile plus one, and beside means within 2 of it', () => {
        const c = loc('Dwarf MultiCannon', 3287, 3809);
        expect(cannonCentre(c)).toEqual({ x: 3288, z: 3810 });
        expect(besideCannon(st({ player: player(3290, 3812) }), c)).toBe(true);
        expect(besideCannon(st({ player: player(3291, 3810) }), c)).toBe(false);
    });

    test('set-up tiles try the spot first, then ring 1, then ring 2', () => {
        const t = setupTiles({ x: 10, z: 10 }, 2);
        expect(t[0]).toEqual({ x: 10, z: 10 });
        expect(t.length).toBe(25);
        expect(t.slice(1, 9).every(p => Math.max(Math.abs(p.x - 10), Math.abs(p.z - 10)) === 1)).toBe(true);
    });

    test('the message cursor returns each message once, across republished states', () => {
        const c = new MessageCursor(st({ gameMessages: [msg(99, 'old')] }));
        expect(c.next(st({ gameMessages: [msg(99, 'old'), msg(100, 'Your cannon is out of ammo!')] }))).toEqual(['Your cannon is out of ammo!']);
        expect(c.next(st({ gameMessages: [msg(99, 'old'), msg(100, 'Your cannon is out of ammo!')] }))).toEqual([]);
    });
});

describe('setUpCannon', () => {
    test('base, then each part the tick the last one leaves the inventory, then load, then Fire', async () => {
        const sdk = new FakeSdk(st({ inventory: kit() }));
        const p = setUpCannon(sdk as never);
        await tick(sdk, s => ({ inventory: s.inventory.filter(i => i.name !== 'Cannon base'), nearbyLocs: [loc('Cannon base')] }));
        await tick(sdk, s => ({ inventory: s.inventory.filter(i => i.name !== 'Cannon stand'), nearbyLocs: [loc('Cannon stand')] }));
        await tick(sdk, s => ({ inventory: s.inventory.filter(i => i.name !== 'Cannon barrels'), nearbyLocs: [loc('Cannon base')] }));
        await tick(sdk, s => ({ inventory: s.inventory.filter(i => i.name !== 'Cannon furnace'), nearbyLocs: [loc('Dwarf MultiCannon')] }));
        await tick(sdk, () => ({ inventory: [inv(4, 'Cannonball', 70)], gameMessages: [msg(105, 'You load the cannon with 30 cannonballs.')] }));
        const r = await p;
        expect(r).toMatchObject({ ok: true, ticks: 5, assembledTick: 104, refused: 0 });
        expect(sdk.sent.map(a => a.method)).toEqual(['sendUseItem', 'sendUseItemOnLoc', 'sendUseItemOnLoc', 'sendUseItemOnLoc', 'sendUseItemOnLoc', 'sendInteractLoc']);
        expect(sends(sdk, 'sendUseItemOnLoc').map(a => a.args[0])).toEqual([1, 2, 3, 4]);
        expect(sends(sdk, 'sendInteractLoc')[0]!.args).toEqual([3287, 3809, 'Dwarf MultiCannon'.length, 1]);
    });

    test('a refused tile moves on to the next candidate', async () => {
        const sdk = new FakeSdk(st({ inventory: kit() }));
        const p = setUpCannon(sdk as never, { tiles: [{ x: 3288, z: 3810 }, { x: 3289, z: 3810 }], fire: false });
        await tick(sdk, { gameMessages: [msg(101, "There isn't enough space to set up here.")] });
        await tick(sdk, { player: player(3289, 3810) });
        expect(sends(sdk, 'sendWalk')[0]!.args).toEqual([3289, 3810, true]);
        await tick(sdk, s => ({ inventory: s.inventory.filter(i => i.name !== 'Cannon base'), nearbyLocs: [loc('Cannon base')] }));
        await tick(sdk, s => ({ inventory: s.inventory.filter(i => i.name !== 'Cannon stand') }));
        await tick(sdk, s => ({ inventory: s.inventory.filter(i => i.name !== 'Cannon barrels') }));
        await tick(sdk, s => ({ inventory: s.inventory.filter(i => i.name !== 'Cannon furnace'), nearbyLocs: [loc('Dwarf MultiCannon')] }));
        expect(await p).toMatchObject({ ok: true, refused: 1 });
        expect(sends(sdk, 'sendUseItem').length).toBe(2);
    });

    test('a part-built cannon (a restart mid set-up) is finished, not placed again', async () => {
        const sdk = new FakeSdk(st({ inventory: kit().slice(2), nearbyLocs: [loc('Cannon stand')] }));
        const p = setUpCannon(sdk as never, { fire: false });
        await tick(sdk, s => ({ inventory: s.inventory.filter(i => i.name !== 'Cannon barrels') }));
        await tick(sdk, s => ({ inventory: s.inventory.filter(i => i.name !== 'Cannon furnace'), nearbyLocs: [loc('Dwarf MultiCannon')] }));
        expect(await p).toMatchObject({ ok: true });
        expect(sends(sdk, 'sendUseItem')).toEqual([]);
        expect(sends(sdk, 'sendUseItemOnLoc').map(a => a.args[0])).toEqual([2, 3]);
    });

    test('a second cannon is refused for good, not tried on every tile', async () => {
        const sdk = new FakeSdk(st({ inventory: kit() }));
        const p = setUpCannon(sdk as never, { tiles: setupTiles({ x: 3288, z: 3810 }) });
        await tick(sdk, { gameMessages: [msg(101, 'You cannot construct more than one Cannon at a time.')] });
        const r = await p;
        expect(r.ok).toBe(false);
        expect(r.reason).toMatch(/already owned/);
        expect(sends(sdk, 'sendUseItem').length).toBe(1);
    });
});

describe('CannonKeeper', () => {
    const cannon = loc('Dwarf MultiCannon');
    const at = (tick: number, patch: Partial<BotWorldState> = {}) => st({ tick, inventory: [inv(4, 'Cannonball', 50)], nearbyLocs: [cannon], ...patch });

    test('tops up every 20 ticks from beside the cannon, and holds attacks until the load shows', () => {
        const k = new CannonKeeper(at(100));
        const sdk = new FakeSdk(at(100));
        for (let t = 101; t < 120; t++) {
            k.observe(at(t));
            expect(k.want(at(t))).toBeNull();
        }
        k.observe(at(120));
        expect(k.want(at(120))).toBe('reload');
        k.send(sdk as never, 'reload', at(120));
        expect(k.holding(at(121))).toBe(true);
        expect(k.want(at(121))).toBeNull();
        k.observe(at(121, { gameMessages: [msg(121, 'You load the cannon with 20 cannonballs.')] }));
        expect(k.holding(at(121))).toBe(false);
        expect(k.loadedBalls).toBe(20);
        expect(sends(sdk, 'sendUseItemOnLoc')[0]!.args).toEqual([4, 3287, 3809, cannon.id]);
    });

    test('away from the cannon it waits out the grace before walking back to load', () => {
        const away = (t: number) => at(t, { player: player(3295, 3810) });
        const k = new CannonKeeper(at(100), { awayGrace: 10 });
        k.observe(away(120));
        expect(k.want(away(120))).toBeNull();
        k.observe(away(130));
        expect(k.want(away(130))).toBe('reload');
    });

    test('out of ammo: reload, then a fresh Fire once the load shows', () => {
        const sdk = new FakeSdk(at(100));
        const k = new CannonKeeper(at(100));
        k.observe(at(105, { gameMessages: [msg(105, 'Your cannon is out of ammo!')] }));
        expect(k.dryEvents).toBe(1);
        expect(k.want(at(105))).toBe('reload');
        k.send(sdk as never, 'reload', at(105));
        k.observe(at(106, { gameMessages: [msg(106, 'You load the cannon with 30 cannonballs.')] }));
        expect(k.want(at(106))).toBe('fire');
        k.send(sdk as never, 'fire', at(106));
        expect(k.refires).toBe(1);
        k.observe(at(107));
        expect(k.want(at(107))).toBeNull();
        expect(sdk.sent.map(a => a.method)).toEqual(['sendUseItemOnLoc', 'sendInteractLoc']);
    });

    test('an unconfirmed top-up stops holding after holdTicks and is retried', () => {
        const sdk = new FakeSdk(at(100));
        const k = new CannonKeeper(at(100), { holdTicks: 4 });
        k.observe(at(120));
        k.send(sdk as never, 'reload', at(120));
        k.observe(at(124));
        expect(k.holding(at(124))).toBe(false);
        expect(k.want(at(124))).toBe('reload');
    });

    test('a decayed cannon wants nothing more', () => {
        const k = new CannonKeeper(at(100), { assembledTick: 0 });
        expect(k.age(at(100))).toBe(100);
        k.observe(at(130, { gameMessages: [msg(130, 'Your cannon has decayed!')] }));
        expect(k.decayed).toBe(true);
        expect(k.want(at(130))).toBeNull();
    });
});

describe('pickUpCannon', () => {
    test('Pick-up by its op, done when the four parts are back; counts the returned balls', async () => {
        const sdk = new FakeSdk(st({ inventory: [inv(4, 'Cannonball', 50)], nearbyLocs: [loc('Dwarf MultiCannon')] }));
        const p = pickUpCannon(sdk as never);
        await tick(sdk, { inventory: [...kit(62)], nearbyLocs: [] });
        expect(await p).toMatchObject({ ok: true, ticks: 1, returned: 12 });
        expect(sends(sdk, 'sendInteractLoc')[0]!.args.at(-1)).toBe(2);
    });

    test('refuses without four free slots', async () => {
        const full = Array.from({ length: 25 }, (_, i) => inv(i, `Item ${i}`));
        const sdk = new FakeSdk(st({ inventory: full, nearbyLocs: [loc('Dwarf MultiCannon')] }));
        const r = await pickUpCannon(sdk as never);
        expect(r.ok).toBe(false);
        expect(r.reason).toMatch(/4 free slots, 3 free/);
        expect(sdk.sent).toEqual([]);
    });
});
