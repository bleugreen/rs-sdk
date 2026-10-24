import { describe, expect, test } from 'bun:test';
import type { BotWorldState, CombatEvent, DialogState, InventoryItem, NearbyNpc, PlayerState } from '../../sdk/types';
import { fight, PRAYER_LEVELS, setPrayer, Upkeep } from './combat';
import { baseState, drive, FakeSdk, flush, simulateWalking } from './fake-sdk';

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

describe('fight: a target its sends cannot reach (rs/693)', () => {
    const UNROUTED = { success: true, message: 'Casting spell on NPC #7 (unrouted - ap-range attempt)', phase: 'dispatch', data: { routed: false } };
    const CANT_REACH = { success: false, message: 'Failed to interact with NPC: cant_reach', phase: 'routing', reason: 'cant_reach' };
    /** The send records as before and resolves with `res` (or what `res` gives for the state then). */
    function reply(sdk: FakeSdk, method: 'sendSpellOnNpc' | 'sendInteractNpc', res: unknown | ((s: BotWorldState) => unknown)) {
        const orig = (sdk as any)[method].bind(sdk);
        (sdk as any)[method] = async (...a: unknown[]) => {
            await orig(...a);
            return typeof res === 'function' ? (res as (s: BotWorldState) => unknown)(sdk.state!) : res;
        };
    }
    const noRoute = () => ({ success: true, waypoints: [{ x: 0, z: 0, level: 0 }], reachedDestination: false });
    const bot = { walkTo: async () => ({ success: false, message: 'test: no fallback' }) };

    test('the live S12:H shape: every cast unrouted, nothing lands, the own tile the only one: 3 approaches, the wait, then unreachable, not a 600-tick loop', async () => {
        const sdk = arena();
        reply(sdk, 'sendSpellOnNpc', UNROUTED);
        sdk.pathTo = noRoute;
        const r = await drive(sdk, fight(sdk as never, /mordred/i, { spell: 1181, maxTicks: 600, approach: { sight: () => true, bot } }), 700);
        expect(r).toMatchObject({ ok: false, end: 'unreachable', approaches: 3, dealt: 0 });
        expect(r.ticks).toBeLessThan(45);
        expect(r.reason).toMatch(/^Sir Mordred untouched by 3 approaches and 15 ticks' wait \(at 1,1\)$/);
        expect(sends(sdk, 'sendWalk')).toEqual([]);
    });

    test('no tile in range has line of sight and a route: one approach, the bounded wait, unreachable naming the target and its tile', async () => {
        const sdk = arena();
        reply(sdk, 'sendSpellOnNpc', UNROUTED);
        const r = await drive(sdk, fight(sdk as never, /mordred/i, { spell: 1181, approach: { sight: () => false, bot } }), 700);
        expect(r).toMatchObject({ ok: false, end: 'unreachable', approaches: 1, reason: 'Sir Mordred not reachable for a cast from any tile (at 1,1)' });
        expect(r.ticks).toBe(6 + 15);
    });

    test('no signal from the client (an older one): after 4 re-sends and 8 ticks with no effect, the same approach', async () => {
        const sdk = arena();
        const r = await drive(sdk, fight(sdk as never, /mordred/i, { spell: 1181, approach: { sight: () => false, bot } }), 700);
        expect(r).toMatchObject({ end: 'unreachable', approaches: 1 });
        expect(r.ticks).toBe(8 + 15);
    });

    test('an unrouted cast out of reach: the run to the nearest tile in range of the live tile, then the casts land', async () => {
        const sdk = arena({ nearbyNpcs: [{ ...npc(7), x: 14, z: 0 }] });
        simulateWalking(sdk);
        let killAt = -1;
        reply(sdk, 'sendSpellOnNpc', (s: BotWorldState) => {
            if (s.player!.worldX < 4) return UNROUTED;
            if (killAt < 0) killAt = s.tick + 2;
            return { success: true, message: 'ok' };
        });
        const each = (s: BotWorldState): Partial<BotWorldState> => (killAt >= 0 && s.tick + 1 >= killAt ? { combatEvents: [hit(s.tick + 1, 'damage_dealt', 5), hit(s.tick + 1, 'kill', 0)] } : {});
        const r = await drive(sdk, fight(sdk as never, /mordred/i, { spell: 1181, approach: { sight: () => true, bot } }), 200, each);
        expect(r).toMatchObject({ ok: true, end: 'killed', approaches: 1 });
        expect(sdk.state!.player!.worldX).toBe(4);
        expect(sends(sdk, 'sendWalk').length).toBeGreaterThan(0);
    });

    test('an unrouted cast that lands (runes spent every cast) is a ranged cast over an obstacle: never an approach', async () => {
        const sdk = arena({ inventory: [{ ...item(0, 'Death rune', 'Drop'), count: 50 }] });
        reply(sdk, 'sendSpellOnNpc', UNROUTED);
        let t = 0;
        const each = (s: BotWorldState): Partial<BotWorldState> => {
            t++;
            const spend = t % 5 === 0 ? { inventory: s.inventory.map(i => ({ ...i, count: i.count - 1 })) } : {};
            return t >= 30 ? { ...spend, combatEvents: [hit(s.tick + 1, 'kill', 0)] } : spend;
        };
        const r = await drive(sdk, fight(sdk as never, /mordred/i, { spell: 1181, approach: { sight: () => { throw new Error('no approach expected'); }, bot } }), 200, each);
        expect(r).toMatchObject({ ok: true, end: 'killed', approaches: 0 });
    });

    test('melee: an attack refused cant_reach on a fenced-off target: no tile beside it routes, so unreachable for an attack', async () => {
        const sdk = arena({ player: player(20, false), nearbyNpcs: [{ ...npc(7), x: 3, z: 3 }] });
        reply(sdk, 'sendInteractNpc', CANT_REACH);
        sdk.pathTo = () => ({ success: false, waypoints: [] });
        const r = await drive(sdk, fight(sdk as never, /mordred/i, { approach: { sight: () => true, bot } }), 200);
        expect(r).toMatchObject({ ok: false, end: 'unreachable', approaches: 1, reason: 'Sir Mordred not reachable for an attack from any tile (at 3,3)' });
    });

    test('melee with a route: the routed attack walks it (movement is an effect), no approach', async () => {
        const sdk = arena({ player: player(20, false), nearbyNpcs: [{ ...npc(7), x: 6, z: 0 }] });
        let at = 0;
        const each = (s: BotWorldState): Partial<BotWorldState> => {
            at = Math.min(at + 1, 5);
            const p = { ...s.player!, worldX: at, x: at } as PlayerState;
            return at >= 5 && s.tick > 108 ? { player: p, combatEvents: [hit(s.tick + 1, 'damage_dealt', 3), hit(s.tick + 1, 'kill', 0)] } : { player: p };
        };
        const r = await drive(sdk, fight(sdk as never, /mordred/i, { approach: { sight: () => { throw new Error('no approach expected'); }, bot } }), 200, each);
        expect(r).toMatchObject({ ok: true, end: 'killed', approaches: 0 });
    });
});
