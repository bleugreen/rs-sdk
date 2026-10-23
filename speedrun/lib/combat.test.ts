import { describe, expect, test } from 'bun:test';
import type { BotWorldState, CombatEvent, DialogState, InventoryItem, NearbyNpc, PlayerState } from '../../sdk/types';
import { ATTACK_REFUSALS, fight, npcClaim, PRAYER_LEVELS, setPrayer, Upkeep, type FightOptions } from './combat';
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

async function tick(sdk: FakeSdk, patch: Parameters<FakeSdk['tick']>[0] = {}) {
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

// ------------------------------------------------------------------ a shared world (rs/520)

const mob = (index: number, distance: number, targetIndex = -1, hp: number | null = 10, lastCombatTick: number | null = null): NearbyNpc =>
    ({ kind: 'npc', id: 1, index, name: 'Sir Mordred', x: distance, z: 0, distance, hp, maxHp: 10, targetIndex, inCombat: targetIndex >= 0, lastCombatTick, optionsWithIndex: [{ text: 'Attack', opIndex: 2 }], options: ['Attack'] }) as NearbyNpc;
const other = (index: number, npcIndex: number) => ({ kind: 'player', index, name: 'someone', combatLevel: 90, x: 1, z: 1, distance: 2, combatTargetType: 'npc', combatTargetIndex: npcIndex, inCombat: true }) as BotWorldState['nearbyPlayers'][number];
const gm = (id: number, tick: number, text = 'Someone else is fighting that.') => ({ type: 0, text, tick, observationId: id }) as BotWorldState['gameMessages'][number];
type End = { type: 'player' | 'npc'; index: number };
const ev = (tick: number, type: CombatEvent['type'], damage: number, src: End, tgt: End): CombatEvent => ({ tick, type, damage, sourceType: src.type, sourceIndex: src.index, targetType: tgt.type, targetIndex: tgt.index });
const me: End = { type: 'player', index: -1 };
const n = (index: number): End => ({ type: 'npc', index });
const onMelee = (on: boolean, pts = 40) => ({ activePrayers: Array(15).fill(false).map((_, i) => i === 14 && on), prayerPoints: pts, prayerLevel: 43 });
const SELF = 32768 + 40; // a player slot no visible other player holds: the player's own
/** 8 is nearer and another player's fight (player 5 targets it, it faces player 5); 7 faces us. */
const contested = { nearbyNpcs: [mob(8, 1, 32768 + 5), mob(7, 4, SELF)], nearbyPlayers: [other(5, 8)] };

/** Run `fight` over a scripted tick sequence (then idle ticks until it ends) and return what it sent. */
async function play(target: Parameters<typeof fight>[1], opts: FightOptions, init: Partial<BotWorldState>, script: Array<Partial<BotWorldState> | ((s: BotWorldState) => Partial<BotWorldState>)>) {
    const sdk = new FakeSdk(baseState({ tick: 100, player: player(20, false), ...init }));
    let done = false;
    const p = fight(sdk as never, target, opts).then(r => { done = true; return r; });
    for (const step of script) {
        if (done) break;
        await tick(sdk, step as never);
    }
    for (let i = 0; i < 60 && !done; i++) await tick(sdk);
    const r = await p;
    return { r, sdk, sent: sdk.sent.map(a => [a.method, ...a.args.map(x => (x instanceof RegExp ? String(x) : x))]) };
}

describe('fight: existing callers, options off (rs/520)', () => {
    // Recorded from lib/combat.ts before rs/520 (7dacc4de), with contention in view: the default
    // path keeps the nearest NPC and re-sends through every refusal, packet for packet.
    const lvl = page('l', 'Congratulations, you just advanced a Magic level.');
    const shark = { slot: 3, id: 385, name: 'Shark', count: 1, optionsWithIndex: [{ text: 'Eat', opIndex: 1 }] } as InventoryItem;
    test('melee', async () => {
        const { r, sent } = await play(/mordred/i, { maxTicks: 12 }, contested, [
            { gameMessages: [gm(1, 101)] },
            { combatEvents: [ev(102, 'damage_taken', 3, n(8), me)] },
            { gameMessages: [gm(1, 101), gm(2, 103, "I'm already under attack!")] },
            {}, {}, { gameMessages: [gm(1, 101), gm(2, 103, "I'm already under attack!"), gm(3, 106)] },
        ]);
        expect(sent).toEqual([['sendInteractNpc', 8, 2], ['sendInteractNpc', 8, 2], ['sendInteractNpc', 8, 2]]);
        expect(r).toMatchObject({ end: 'timeout', ticks: 13, attacks: 3, targetIndex: 8, dealt: 0, taken: 3, refused: [], switches: 0, waited: 0 });
    });
    test('spell under a prayer, eating', async () => {
        const { r, sent } = await play(/mordred/i, { spell: 1181, castEvery: 2, prayer: 'protect_from_melee', eatBelow: 10, maxTicks: 9 },
            { ...contested, prayers: onMelee(false), inventory: [shark] }, [
            { gameMessages: [gm(1, 101)], prayers: onMelee(true) },
            { combatEvents: [ev(102, 'damage_taken', 9, n(8), me)], player: player(8) },
            {}, { gameMessages: [gm(1, 101), gm(2, 104)] },
        ]);
        const cast = ['sendSpellOnNpc', 8, 1181];
        const eat = ['sendUseItem', 3, 1];
        expect(sent).toEqual([cast, eat, cast, cast, eat, cast, cast, eat, cast]);
        expect(r).toMatchObject({ end: 'timeout', ticks: 10, attacks: 6, targetIndex: 8, taken: 9 });
    });
    test('an NPC passed as the target', async () => {
        const { r, sent } = await play(mob(7, 4, SELF), {}, contested, [
            { gameMessages: [gm(1, 101)] },
            { combatEvents: [ev(102, 'damage_dealt', 4, me, n(7))] },
            {},
            { combatEvents: [ev(102, 'damage_dealt', 4, me, n(7)), ev(104, 'kill', 0, me, n(7))] },
        ]);
        expect(sent).toEqual([['sendInteractNpc', 7, 2]]);
        expect(r).toMatchObject({ end: 'killed', ticks: 4, attacks: 1, targetIndex: 7, dealt: 4 });
    });
    test('a level-up page mid-cast', async () => {
        const { r, sent } = await play(/mordred/i, { spell: 1169, maxTicks: 20 }, contested, [
            { gameMessages: [gm(1, 101)] },
            { dialog: lvl },
            { dialog: closed },
            { combatEvents: [ev(104, 'damage_taken', 2, n(8), me)] },
            { nearbyNpcs: [mob(8, 1, 32768 + 5, 0), mob(7, 4, SELF)] },
        ]);
        const cast = ['sendSpellOnNpc', 8, 1169];
        expect(sent).toEqual([cast, ['clickDialogByText', '/^Click here to continue$/'], cast, cast]);
        expect(r).toMatchObject({ end: 'killed', ticks: 5, attacks: 3, targetIndex: 8 });
    });
    test('attack: false', async () => {
        const { r, sent } = await play(/mordred/i, { attack: false }, contested, [
            { combatEvents: [ev(101, 'damage_taken', 2, n(7), me)] },
            { gameMessages: [gm(1, 102)] },
            { nearbyNpcs: [mob(7, 4, SELF)] },
            { nearbyNpcs: [mob(7, 4, SELF)] },
        ]);
        expect(sent).toEqual([]);
        expect(r).toMatchObject({ end: 'gone', ticks: 4, attacks: 0, targetIndex: 8, taken: 2 });
    });
});

describe('npcClaim', () => {
    const s = (npcs: NearbyNpc[], players = [other(5, 8)]) => baseState({ nearbyNpcs: npcs, nearbyPlayers: players });
    test('facing a slot no visible player holds is ours; within reach only', () => {
        expect(npcClaim(s([mob(7, 4, SELF)]), mob(7, 4, SELF))).toBe('ours');
        expect(npcClaim(s([mob(7, 12, SELF)]), mob(7, 12, SELF))).toBe('others');
    });
    test("another player's fight: that player's target, or facing that player", () => {
        expect(npcClaim(s([mob(8, 1)]), mob(8, 1))).toBe('others');
        expect(npcClaim(s([mob(9, 1, 32768 + 5)], [other(5, 3)]), mob(9, 1, 32768 + 5))).toBe('others');
    });
    test('a hit names it only when nothing else does', () => {
        expect(npcClaim(s([mob(6, 2)], []), mob(6, 2))).toBe('none');
        expect(npcClaim(s([mob(6, 2)], []), mob(6, 2), new Set([6]))).toBe('ours');
        expect(npcClaim(s([mob(8, 1)]), mob(8, 1), new Set([8]))).toBe('others');
    });
    test('the refusal texts the scripts give', () => {
        expect(ATTACK_REFUSALS.lock.test('Someone else is fighting that.')).toBe(true);
        expect(ATTACK_REFUSALS.notYours.test("It's not after you...")).toBe(true);
        expect(ATTACK_REFUSALS.notYours.test('That is not your enemy!')).toBe(true);
        expect(ATTACK_REFUSALS.underAttack.test("I'm already under attack!")).toBe(true);
    });
});

describe('fight: adoptHitter', () => {
    test("a second player's same-name NPC nearer than ours: ours is attacked", async () => {
        const { r, sent } = await play(/mordred/i, { adoptHitter: true, maxTicks: 3 }, contested, []);
        expect(sent[0]).toEqual(['sendInteractNpc', 7, 2]);
        expect(r).toMatchObject({ targetIndex: 7, switches: 0 });
    });
    test("before ours shows, the nearest unclaimed beats the nearer other player's", async () => {
        const { sent } = await play(/mordred/i, { adoptHitter: true, maxTicks: 3 }, { nearbyNpcs: [mob(8, 1), mob(7, 4)], nearbyPlayers: [other(5, 8)] }, []);
        expect(sent[0]).toEqual(['sendInteractNpc', 7, 2]);
    });
    test('ours identified by its hit: switch to it as soon as one shows', async () => {
        const both = { nearbyNpcs: [mob(8, 1), mob(7, 4)] };
        const { r, sent } = await play(/mordred/i, { adoptHitter: true, maxTicks: 8 }, both, [
            {}, {}, { combatEvents: [ev(103, 'damage_taken', 2, n(7), me)] }, {},
        ]);
        expect(sent.slice(0, 2).map(a => a[1])).toEqual([8, 7]);
        expect(sent.slice(1).every(a => a[1] === 7)).toBe(true);
        expect(r).toMatchObject({ targetIndex: 7, switches: 1 });
    });
    test('and when ours turns to face the player', async () => {
        const { sent } = await play(/mordred/i, { adoptHitter: true, maxTicks: 6 }, { nearbyNpcs: [mob(8, 1), mob(7, 4)] }, [
            {}, {}, { nearbyNpcs: [mob(8, 1), mob(7, 4, SELF)] },
        ]);
        expect(sent.map(a => a[1])).toEqual([8, 7]);
    });
    test('no switch away from a target it is damaging', async () => {
        const { sent } = await play(/mordred/i, { adoptHitter: true, maxTicks: 6 }, { nearbyNpcs: [mob(8, 1), mob(7, 4)] }, [
            { combatEvents: [ev(101, 'damage_dealt', 3, me, n(8))] }, {}, { nearbyNpcs: [mob(8, 1), mob(7, 4, SELF)] },
        ]);
        expect(sent.every(a => a[1] === 8)).toBe(true);
    });
    test("\"I'm already under attack!\": the attacker is picked instead", async () => {
        const { r, sent } = await play(/mordred/i, { adoptHitter: true, maxTicks: 4 }, { nearbyNpcs: [mob(8, 1), mob(7, 12, SELF)] }, [
            { gameMessages: [gm(1, 101, "I'm already under attack!")], nearbyNpcs: [mob(8, 1), mob(7, 9, SELF)] },
        ]);
        expect(sent.map(a => a[1])).toEqual([8, 7]);
        expect(r.targetIndex).toBe(7);
    });
});

describe('fight: contested', () => {
    test('the refusal excludes that NPC and the next is attacked; the reply is never re-sent through', async () => {
        const both = { nearbyNpcs: [mob(8, 1), mob(7, 4)] };
        const { r, sent } = await play(/mordred/i, { contested: { waitTicks: 20 }, maxTicks: 10 }, both, [{ gameMessages: [gm(1, 101)] }]);
        expect(sent[0]).toEqual(['sendInteractNpc', 8, 2]);
        expect(sent.slice(1).every(a => a[1] === 7)).toBe(true);
        expect(r).toMatchObject({ refused: [8], switches: 1, targetIndex: 7 });
    });
    test('a reply from before the attack does not count', async () => {
        const { r } = await play(/mordred/i, { contested: { waitTicks: 20 }, maxTicks: 4 }, { gameMessages: [gm(1, 99)], nearbyNpcs: [mob(8, 1), mob(7, 4)] }, []);
        expect(r).toMatchObject({ refused: [], targetIndex: 8 });
    });
    test("none left: a bounded wait with no attacks, then 'contested'", async () => {
        const both = { nearbyNpcs: [mob(8, 1, -1, 10, 100), mob(7, 4, -1, 10, 100)] };
        // Both stay in another fight (hit every tick), so neither lock lifts.
        const busy = (s: BotWorldState) => ({ nearbyNpcs: [mob(8, 1, -1, 10, s.tick), mob(7, 4, -1, 10, s.tick)] });
        const { r, sent } = await play(/mordred/i, { contested: { waitTicks: 15 }, maxTicks: 200 }, both, [
            { gameMessages: [gm(1, 101)] },
            s => ({ ...busy(s), gameMessages: [gm(1, 101), gm(2, 102)] }),
            ...Array.from({ length: 30 }, () => busy),
        ]);
        expect(sent).toEqual([['sendInteractNpc', 8, 2], ['sendInteractNpc', 7, 2]]);
        expect(r).toMatchObject({ ok: false, end: 'contested', refused: [8, 7], waited: 15, ticks: 17 });
    });
    test('a lock lifts once the other fight has stopped for 8 ticks', async () => {
        const { r, sent } = await play(/mordred/i, { contested: { waitTicks: 40 }, maxTicks: 30 }, { nearbyNpcs: [mob(8, 1, -1, 10, 100)] }, [
            { gameMessages: [gm(1, 101)] },
        ]);
        expect(sent.length).toBeGreaterThanOrEqual(2);
        expect(sent.every(a => a[1] === 8)).toBe(true);
        expect(r).toMatchObject({ refused: [8], waited: 8, end: 'timeout' });
    });
    test('"not your enemy" never lifts', async () => {
        const { r, sent } = await play(/demon/i, { contested: { waitTicks: 30 }, maxTicks: 60 }, { nearbyNpcs: [{ ...mob(8, 1), name: 'Jungle Demon' }] }, [
            { gameMessages: [gm(1, 101, 'That is not your enemy!')] },
        ]);
        expect(sent.length).toBe(1);
        expect(r).toMatchObject({ end: 'contested', refused: [8], waited: 30 });
    });
    test('prayer-aware: off while nothing attacks the wait, back on before the attack that re-engages', async () => {
        const sdk = new FakeSdk(baseState({ tick: 100, player: player(20, false), nearbyNpcs: [mob(8, 1, -1, 10, 100)], prayers: onMelee(true) }));
        // The fake server applies prayer toggles at once.
        sdk.onSend = (a, f) => {
            if (a.method === 'sendTogglePrayer') f.state = { ...f.state!, prayers: onMelee(!f.state!.prayers.activePrayers[14]) };
        };
        const p = fight(sdk as never, /mordred/i, { prayer: 'protect_from_melee', contested: { waitTicks: 40 }, maxTicks: 14 });
        await tick(sdk, { gameMessages: [gm(1, 101)] });
        await tick(sdk);
        expect(sdk.state!.prayers.activePrayers[14]).toBe(false);
        for (let i = 0; i < 14; i++) await tick(sdk);
        const r = await p;
        const methods = sdk.sent.map(a => a.method);
        expect(methods).toEqual(['sendInteractNpc', 'sendTogglePrayer', 'sendTogglePrayer', 'sendInteractNpc', ...methods.slice(4)]);
        expect(r).toMatchObject({ refused: [8], end: 'timeout' });
    });
    test('hit during the wait: the prayer stays on', async () => {
        const sdk = new FakeSdk(baseState({ tick: 100, player: player(20, false), nearbyNpcs: [mob(8, 1, -1, 10, 100)], prayers: onMelee(true) }));
        const p = fight(sdk as never, /mordred/i, { prayer: 'protect_from_melee', contested: { waitTicks: 6 }, maxTicks: 30 });
        await tick(sdk, { gameMessages: [gm(1, 101)], nearbyNpcs: [mob(8, 1, -1, 10, 101)], combatEvents: [ev(101, 'damage_taken', 0, n(9), me)] });
        for (let i = 0; i < 8; i++) await tick(sdk, s => ({ combatEvents: [ev(s.tick, 'damage_taken', 0, n(9), me)], nearbyNpcs: [mob(8, 1, -1, 10, s.tick)] }));
        expect((await p).end).toBe('contested');
        expect(sends(sdk, 'sendTogglePrayer')).toEqual([]);
    });
    test('an NPC passed as the target (formPicker): waitTicks 0 ends at the refusal, naming it', async () => {
        const { r, sent } = await play(mob(7, 4), { spell: 1181, contested: { waitTicks: 0 } }, { nearbyNpcs: [mob(8, 1), mob(7, 4)] }, [
            { gameMessages: [gm(1, 101, 'Someone else is fighting that.')] },
        ]);
        expect(sent).toEqual([['sendSpellOnNpc', 7, 1181]]);
        expect(r).toMatchObject({ ok: false, end: 'contested', refused: [7], ticks: 1 });
    });
});

describe('Upkeep', () => {
    test('holdPrayer: no toggle on and no drink while held', () => {
        const sdk = new FakeSdk();
        const u = new Upkeep(sdk as never, { prayer: 'protect_from_melee', drinkBelow: 8 });
        u.holdPrayer = true;
        const st = baseState({ tick: 1, inventory: [item(2, 'Prayer potion(4)', 'Drink')], prayers: onMelee(false, 5) });
        expect(u.step(st)).toBe(false);
        expect(sdk.sent).toEqual([]);
    });

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
