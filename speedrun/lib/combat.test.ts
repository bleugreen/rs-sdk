import { describe, expect, test } from 'bun:test';
import type { BotWorldState, CombatEvent, DialogState, InventoryItem, NearbyNpc, PlayerState } from '../../sdk/types';
import { fight, PRAYER_LEVELS, setPrayer, Upkeep } from './combat';
import { baseState, FakeSdk, flush } from './fake-sdk';

const player = (hp: number, inCombat = true) => ({ worldX: 0, worldZ: 0, level: 0, hp, maxHp: 20, isDead: false, combat: { inCombat, targetIndex: -1, targetType: 'none', lastDamageTick: -1 } }) as unknown as PlayerState;
const npc = (index: number, hp: number | null = 10): NearbyNpc =>
    ({ kind: 'npc', id: 1, index, name: 'Sir Mordred', x: 1, z: 1, distance: 1, hp, maxHp: 10, optionsWithIndex: [{ text: 'Attack', opIndex: 2 }], options: ['Attack'] }) as NearbyNpc;
const page = (pageId: string, text: string): DialogState => ({
    isOpen: true, isWaiting: false, pageId, options: [{ index: 1, text: 'Click here to continue', buttonType: 6, componentId: 10 }],
    allComponents: [{ id: 1, type: 4, buttonType: 0, option: '', text }],
});
const closed: DialogState = { isOpen: false, options: [], isWaiting: false };
const hit = (tick: number, type: CombatEvent['type'], damage = 1, targetIndex = 7): CombatEvent => ({ tick, type, damage, sourceType: 'player', sourceIndex: 0, targetType: 'npc', targetIndex });
const item = (slot: number, name: string, op: string): InventoryItem => ({ slot, id: slot, name, count: 1, optionsWithIndex: [{ text: op, opIndex: 1 }] });

function arena(extra: Partial<BotWorldState> = {}) {
    return new FakeSdk(baseState({ tick: 100, player: player(20), nearbyNpcs: [npc(7)], ...extra }));
}

async function tick(sdk: FakeSdk, patch: Partial<BotWorldState> = {}) {
    await flush();
    sdk.tick(patch);
    await flush();
}

const sends = (sdk: FakeSdk, method: string) => sdk.sent.filter(a => a.method === method);

describe('fight', () => {
    test('attacks the target by index and ends on its kill event', async () => {
        const sdk = arena();
        const p = fight(sdk as never, /mordred/i);
        await tick(sdk, { combatEvents: [hit(101, 'damage_dealt', 4)] });
        await tick(sdk, { combatEvents: [hit(101, 'damage_dealt', 4), hit(102, 'kill', 0)] });
        const r = await p;
        expect(r).toMatchObject({ ok: true, end: 'killed', ticks: 2, dealt: 4, hits: 1, engaged: 1, targetIndex: 7 });
        expect(sends(sdk, 'sendInteractNpc')[0]!.args).toEqual([7, 2]);
    });

    test('rs/12: a level-up box is dismissed on the tick it shows, with the same target re-attacked behind it', async () => {
        const sdk = arena();
        const p = fight(sdk as never, /mordred/i);
        await tick(sdk);
        const before = sdk.sent.length;
        await tick(sdk, { dialog: page('l', 'Congratulations, you just advanced a Strength level.') });
        const burst = sdk.sent.slice(before);
        expect(burst.map(a => a.method)).toEqual(['clickDialogByText', 'sendInteractNpc']);
        expect(burst[1]!.args).toEqual([7, 2]);
        await tick(sdk, { dialog: { ...page('l', ''), isWaiting: true } });
        await tick(sdk, { dialog: page('u', 'You can now wield Steel weapons.') }); // the unlock page that follows
        await tick(sdk, { dialog: closed, nearbyNpcs: [npc(7, 0)] });
        expect(await p).toMatchObject({ ok: true, end: 'killed', levelUps: 2 });
    });

    test('rs/12: a quest page that opens mid-fight ends the fight instead of being clicked', async () => {
        const sdk = arena({ recentDialogs: [{ text: ['Congratulations, you just advanced a Hitpoints level.'], tick: 100, interfaceId: 1 }] });
        const p = fight(sdk as never, /mordred/i);
        await tick(sdk, { dialog: page('m', 'STOP! Please... spare my son.') });
        expect(await p).toMatchObject({ ok: true, end: 'dialog', levelUps: 0 });
        expect(sends(sdk, 'clickDialogByText')).toEqual([]);
    });

    test('rs/56: under a protect prayer, "in combat" without dealing damage re-engages after stallTicks', async () => {
        const sdk = arena({ prayers: { activePrayers: Array(15).fill(false).map((_, i) => i === 14), prayerPoints: 40, prayerLevel: 43 } });
        const p = fight(sdk as never, /mordred/i, { prayer: 'protect_from_melee', maxTicks: 12 });
        for (let i = 0; i < 12; i++) await tick(sdk); // in combat the whole time, never hitting
        await tick(sdk);
        const r = await p;
        expect(r.end).toBe('timeout');
        expect(r.attacks).toBeGreaterThanOrEqual(2);
        // Without the prayer the same picture is a normal fight: no re-attack.
        const plain = arena();
        const q = fight(plain as never, /mordred/i, { maxTicks: 12 });
        for (let i = 0; i < 13; i++) await tick(plain);
        expect((await q).attacks).toBe(1);
    });

    test('damage to another NPC does not hide a protected target stall', async () => {
        const sdk = arena();
        const p = fight(sdk as never, /mordred/i, { prayer: 'protect_from_melee', maxTicks: 10 });
        for (let i = 1; i <= 11; i++) {
            await tick(sdk, { combatEvents: [hit(100 + i, 'damage_dealt', 4, 8)] });
        }
        expect(await p).toMatchObject({ end: 'timeout', dealt: 0, hits: 0, engaged: -1 });
        expect(sends(sdk, 'sendInteractNpc').length).toBeGreaterThanOrEqual(2);
        expect(sends(sdk, 'sendInteractNpc').every(a => a.args[0] === 7)).toBe(true);
    });

    test('upkeep inside the fight: eats below the threshold and re-sends the attack that tick', async () => {
        const sdk = arena({ inventory: [item(3, 'Shark', 'Eat')] });
        const p = fight(sdk as never, /mordred/i, { eatBelow: 10, maxTicks: 3 });
        await tick(sdk, { player: player(6) });
        const tickSends = sdk.sent.slice(1).map(a => a.method);
        expect(tickSends).toEqual(['sendUseItem', 'sendInteractNpc']);
        await tick(sdk);
        await tick(sdk);
        await tick(sdk);
        expect((await p).eats).toBe(1);
    });

    test('the target leaving view for two ticks ends the fight; done ends it too', async () => {
        const sdk = arena();
        const p = fight(sdk as never, /mordred/i);
        await tick(sdk, { nearbyNpcs: [] });
        await tick(sdk, { nearbyNpcs: [] });
        expect(await p).toMatchObject({ ok: true, end: 'gone' });
        const t = arena();
        const q = fight(t as never, /mordred/i, { done: s => s.tick >= 102 });
        await tick(t);
        await tick(t);
        expect(await q).toMatchObject({ end: 'done', ticks: 2 });
    });

    test('scripted death waits through zero hp and disappearance for the quest outcome', async () => {
        const sdk = arena();
        const p = fight(sdk as never, /mordred/i, { endOnTargetDeath: false });
        let ended = false;
        void p.then(() => { ended = true; });
        await tick(sdk, { nearbyNpcs: [npc(7, 0)] });
        await tick(sdk, { nearbyNpcs: [] });
        await tick(sdk);
        expect(ended).toBe(false);
        await tick(sdk, { dialog: page('m', 'STOP! Please... spare my son.') });
        expect(await p).toMatchObject({ end: 'dialog', ticks: 4 });
    });

    test('scripted death preserves real hp for a weapon swap and ends on the teleport', async () => {
        const sdk = arena();
        const health: Array<number | null | undefined> = [];
        const p = fight(sdk as never, /mordred/i, {
            endOnTargetDeath: false,
            done: s => s.tick >= 103,
            onTick: (_s, target) => { health.push(target?.hp); },
        });
        await tick(sdk, { nearbyNpcs: [npc(7, 0)] });
        await tick(sdk, { nearbyNpcs: [npc(7, 10)] });
        await tick(sdk);
        expect(await p).toMatchObject({ end: 'done', ticks: 3 });
        expect(health).toEqual([0, 10]);
    });

    test('no target in view', async () => {
        const sdk = arena({ nearbyNpcs: [] });
        const p = fight(sdk as never, /mordred/i, { findTicks: 1 });
        await tick(sdk);
        await tick(sdk);
        expect(await p).toMatchObject({ ok: false, end: 'no target' });
    });
});

describe('Upkeep', () => {
    test('keeps the prayer on and drinks below the threshold, spaced out', () => {
        const sdk = new FakeSdk();
        const u = new Upkeep(sdk as never, { prayer: 'protect_from_melee', drinkBelow: 8 });
        const st = (tick: number, pts: number, on: boolean) => baseState({ tick, inventory: [item(2, 'Prayer potion(4)', 'Drink')], prayers: { activePrayers: Array(15).fill(false).map((_, i) => i === 14 && on), prayerPoints: pts, prayerLevel: 43 } });
        expect(u.step(st(1, 20, false))).toBe(false);
        expect(u.step(st(2, 18, false))).toBe(false); // toggle spacing
        expect(u.step(st(3, 7, true))).toBe(true); // drink
        expect(u.step(st(4, 6, true))).toBe(false); // spaced
        expect(sdk.sent.map(a => a.method)).toEqual(['sendTogglePrayer', 'sendUseItem']);
        expect(u.step(st(5, 6, false))).toBe(false); // switched off again: toggled back on
        expect(sdk.sent.at(-1)!.method).toBe('sendTogglePrayer');
        expect(u.prayerUsed).toBe(14);
    });
});

describe('setPrayer', () => {
    const MELEE = 14;
    const prayers = (on: boolean, points = 43, level = 43) => {
        const activePrayers = Array(15).fill(false);
        activePrayers[MELEE] = on;
        return { prayers: { activePrayers, prayerPoints: points, prayerLevel: level } };
    };

    test('the level table matches the prayer book', () => {
        expect(PRAYER_LEVELS.thick_skin).toBe(1);
        expect(PRAYER_LEVELS.protect_items).toBe(25);
        expect(PRAYER_LEVELS.protect_from_melee).toBe(43);
    });

    test('already as asked: no click', async () => {
        const sdk = arena(prayers(true));
        expect(await setPrayer(sdk as never, 'protect_from_melee', true)).toEqual({ ok: true, ticks: 0, toggles: 0 });
        expect(sdk.sent).toEqual([]);
    });

    test('turns it on, confirmed by the published state', async () => {
        const sdk = arena(prayers(false));
        const p = setPrayer(sdk as never, 'protect_from_melee', true);
        await tick(sdk);
        await tick(sdk, prayers(true));
        expect(await p).toEqual({ ok: true, ticks: 2, toggles: 1 });
        expect(sends(sdk, 'sendTogglePrayer').map(a => a.args[0])).toEqual(['protect_from_melee']);
    });

    test('turns it off', async () => {
        const sdk = arena(prayers(true));
        const p = setPrayer(sdk as never, 'protect_from_melee', false);
        await tick(sdk, prayers(false));
        expect(await p).toMatchObject({ ok: true, toggles: 1 });
    });

    test('refuses without sending below the level or with no points', async () => {
        const low = arena(prayers(false, 40, 42));
        expect(await setPrayer(low as never, 'protect_from_melee', true)).toMatchObject({ ok: false, reason: 'level' });
        const empty = arena(prayers(false, 0));
        expect(await setPrayer(empty as never, 'protect_from_melee', true)).toMatchObject({ ok: false, reason: 'no points' });
        expect([...low.sent, ...empty.sent]).toEqual([]);
    });

    test('a dropped toggle is sent again after retryAfter ticks, never sooner', async () => {
        const sdk = arena(prayers(false));
        const p = setPrayer(sdk as never, 'protect_from_melee', true, { retryAfter: 3 });
        await tick(sdk);
        await tick(sdk);
        expect(sends(sdk, 'sendTogglePrayer').length).toBe(1);
        await tick(sdk);
        expect(sends(sdk, 'sendTogglePrayer').length).toBe(2);
        await tick(sdk, prayers(true));
        expect(await p).toMatchObject({ ok: true, toggles: 2, ticks: 4 });
    });
});
