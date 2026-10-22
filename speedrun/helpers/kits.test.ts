import { describe, expect, test } from 'bun:test';

import type { InventoryItem } from '../../sdk/types';
import { planOffers, type GiveResult } from '../lib/trade';
import { memoryRoleState } from './role';
import { BANKS } from './buyer';
import { decideStall, displayName, giveKitOnce, kitDeliveryKey, giveSpecs, kitHeld, kitOptions, kitSlots, lastContact, loadedExactly, loadOptions, LUMBRIDGE_SPAWN, nextReceiver, parseKit, splitLogs, STALL_BACKOFF_TICKS, stallOptions, wantSpecs, type StallView } from './kits';

const inv = (items: [number, number, string, number][]): InventoryItem[] =>
    items.map(([slot, id, name, count]) => ({ slot, id, name, count, optionsWithIndex: [] }));

/** rs/147's kits (2026-10-21). */
const KITS = {
    cairn_chops: 'rune_axe:1,knife:1,logs:5',
    cairn_casts: 'fly_fishing_rod:1,feather:800,knife:1,logs:5',
    cairn_rocks: 'steel_pickaxe:1,mithril_pickaxe:1,adamant_pickaxe:1,rune_pickaxe:1,knife:1,logs:4,coins:60',
    cairn_steals: 'cake:38:noted,coins:100',
    cairn_jumps: 'cake:7,knife:1'
};

describe('kit specs', () => {
    test('debug names become display names', () => {
        expect(displayName('fly_fishing_rod')).toBe('Fly fishing rod');
        expect(displayName('RUNE_AXE')).toBe('Rune axe');
        expect(displayName('logs')).toBe('Logs');
    });

    test('the harness spelling parses, with counts and banknotes', () => {
        expect(parseKit(KITS.cairn_casts)).toEqual([
            { item: 'Fly fishing rod', amount: 1, noted: false },
            { item: 'Feather', amount: 800, noted: false },
            { item: 'Knife', amount: 1, noted: false },
            { item: 'Logs', amount: 5, noted: false }
        ]);
        expect(parseKit(KITS.cairn_steals)[0]).toEqual({ item: 'Cake', amount: 38, noted: true });
        expect(parseKit([{ item: 'Rune axe', amount: 1 }])).toEqual([{ item: 'Rune axe', amount: 1, noted: false }]);
    });

    test('bad kits are refused', () => {
        expect(() => parseKit('')).toThrow(/empty/);
        expect(() => parseKit('knife:0')).toThrow(/bad count/);
        expect(() => parseKit('knife:1:unnoted')).toThrow(/cannot read/);
        expect(() => parseKit('knife:1,knife:2')).toThrow(/twice/);
        expect(() => parseKit(42)).toThrow();
    });

    test('slots: unstackables one each, stacks and notes one', () => {
        expect(kitSlots(parseKit(KITS.cairn_rocks))).toBe(10);
        expect(kitSlots(parseKit(KITS.cairn_casts))).toBe(8);
        expect(kitSlots(parseKit(KITS.cairn_steals))).toBe(2);
        expect(kitSlots(parseKit(KITS.cairn_jumps))).toBe(8);
        expect(kitSlots(parseKit('knife:3'))).toBe(3);
    });
});

describe('options', () => {
    test('every rs/147 kit fits a fresh account; defaults stand at the tutorial exit', () => {
        const o = kitOptions({ kits: KITS, serve: 'cairn_chops' });
        expect(o.serve).toEqual(['cairn_chops']);
        expect(o.stand).toEqual(LUMBRIDGE_SPAWN);
        expect(o.returns.sort()).toEqual(Object.keys(KITS).sort());
        expect(o.keepLogs).toBe(0);
        expect(kitOptions({ kits: KITS }).serve).toEqual([]);
    });

    test('serve as a list keeps its order; a repeat or an unknown receiver is refused', () => {
        expect(kitOptions({ kits: KITS, serve: ['cairn_steals', 'cairn_chops'] }).serve).toEqual(['cairn_steals', 'cairn_chops']);
        expect(() => kitOptions({ kits: KITS, serve: ['cairn_chops', 'CAIRN_CHOPS'] })).toThrow(/twice/);
        expect(() => kitOptions({ kits: KITS, serve: ['cairn_chops', 'cairn_nobody'] })).toThrow(/no kit/);
    });

    test('keepLogs is 0-27', () => {
        expect(kitOptions({ kits: KITS, keepLogs: 15 }).keepLogs).toBe(15);
        expect(() => kitOptions({ kits: KITS, keepLogs: 28 })).toThrow(/keepLogs/);
        expect(() => kitOptions({ kits: KITS, keepLogs: -1 })).toThrow(/keepLogs/);
    });

    test('a kit too big for the receiver, or serving an account with no kit, is refused', () => {
        expect(() => kitOptions({ kits: { cairn_rocks: `${KITS.cairn_rocks},shark:1` } })).toThrow(/11 slots/);
        expect(() => kitOptions({ kits: KITS, serve: 'cairn_nobody' })).toThrow(/no kit/);
        expect(() => kitOptions({ kits: { 'Cairn Chops': 'knife:1' } })).toThrow(/login name/);
    });
});

describe('giving', () => {
    test('specs are exact names: Logs never takes Oak logs, Shark never Raw shark', () => {
        const specs = giveSpecs(parseKit('logs:1,shark:2'));
        const pack = inv([
            [0, 1521, 'Oak logs', 1],
            [1, 1511, 'Logs', 1],
            [2, 383, 'Raw shark', 1],
            [3, 385, 'Shark', 1],
            [4, 385, 'Shark', 1]
        ]);
        const plan = planOffers(pack, specs);
        expect(plan.map(e => [e.id, e.expected])).toEqual([
            [1511, 1],
            [385, 2]
        ]);
    });

    test('the staged mining kit is offered whole, nothing else in the pack (bronze axe) goes', () => {
        const kit = parseKit(KITS.cairn_rocks);
        const pack = inv([
            [0, 1269, 'Steel pickaxe', 1],
            [1, 1273, 'Mithril pickaxe', 1],
            [2, 1271, 'Adamant pickaxe', 1],
            [3, 1275, 'Rune pickaxe', 1],
            [4, 946, 'Knife', 1],
            [5, 1511, 'Logs', 1],
            [6, 1511, 'Logs', 1],
            [7, 1511, 'Logs', 1],
            [8, 1511, 'Logs', 1],
            [9, 995, 'Coins', 60],
            [10, 1351, 'Bronze axe', 1]
        ]);
        expect(kitHeld(pack, kit)).toBe(true);
        const plan = planOffers(pack, giveSpecs(kit));
        expect(plan.map(e => e.id).sort((a, b) => a - b)).toEqual([946, 995, 1269, 1271, 1273, 1275, 1511]);
        // Exactly what is held: one All press each, no count dialogs.
        expect(plan.every(e => e.amounts.length === 1 && e.amounts[0] === -1)).toBe(true);
        expect(plan.find(e => e.id === 1511)!.expected).toBe(4);
    });

    test('kitHeld wants the whole kit', () => {
        const kit = parseKit(KITS.cairn_casts);
        expect(kitHeld(inv([[0, 309, 'Fly fishing rod', 1], [1, 314, 'Feather', 799], [2, 946, 'Knife', 1], [3, 1511, 'Logs', 1], [4, 1511, 'Logs', 1], [5, 1511, 'Logs', 1], [6, 1511, 'Logs', 1], [7, 1511, 'Logs', 1]]), kit)).toBe(false);
        expect(kitHeld(inv([[0, 309, 'Fly fishing rod', 1], [1, 314, 'Feather', 800], [2, 946, 'Knife', 1], [3, 1511, 'Logs', 1], [4, 1511, 'Logs', 1], [5, 1511, 'Logs', 1], [6, 1511, 'Logs', 1], [7, 1511, 'Logs', 1]]), kit)).toBe(true);
    });
});

describe('logs', () => {
    test('logs the bank lacks are chopped; the rest come from the bank', () => {
        const kit = parseKit(KITS.cairn_rocks);
        expect(splitLogs(kit, 0).chop).toBe(4);
        expect(splitLogs(kit, 0).fromBank.some(i => i.item === 'Logs')).toBe(false);
        const some = splitLogs(kit, 3);
        expect(some.chop).toBe(1);
        expect(some.fromBank.find(i => i.item === 'Logs')!.amount).toBe(3);
        expect(splitLogs(kit, 10).chop).toBe(0);
        expect(splitLogs(parseKit(KITS.cairn_steals), 0)).toEqual({ fromBank: parseKit(KITS.cairn_steals), chop: 0 });
    });
});

/** rs/228's six Firemaking droppers (2026-10-21): 157 logs in route order, spares on the last, dropper 5 with 4 magic spares. */
const DROPPERS = {
    cairn_d01: 'logs:2,oak_logs:4,willow_logs:7,maple_logs:13,yew_logs:2',
    cairn_d02: 'yew_logs:22,magic_logs:6',
    cairn_d03: 'magic_logs:28',
    cairn_d04: 'magic_logs:28',
    cairn_d05: 'magic_logs:28',
    cairn_d06: 'magic_logs:21,logs:1,oak_logs:1,willow_logs:1,maple_logs:2,yew_logs:2'
};

describe('a queue of receivers', () => {
    test('every dropper is a full pack; the giver refuses them at the default 10 free slots', () => {
        for (const kit of Object.values(DROPPERS)) expect(kitSlots(parseKit(kit))).toBe(28);
        expect(() => kitOptions({ kits: DROPPERS })).toThrow(/28 slots, the receiver has 10/);
        expect(kitOptions({ kits: DROPPERS, freeSlots: 28 }).serve).toEqual([]);
        const logs = Object.values(DROPPERS).flatMap(k => parseKit(k)).reduce((a, i) => a + i.amount, 0);
        expect(logs).toBe(157 + 11);
    });

    test('nextReceiver passes over every receiver with a record, in order', async () => {
        const serve = Object.keys(DROPPERS);
        const state = memoryRoleState();
        expect(nextReceiver(serve, state)).toBe('cairn_d01');
        await state.set(kitDeliveryKey('cairn_d01'), { outcome: 'delivered' });
        await state.set(kitDeliveryKey('cairn_d02'), { outcome: 'uncertain' });
        expect(nextReceiver(serve, state)).toBe('cairn_d03');
        for (const r of serve) await state.set(kitDeliveryKey(r), { outcome: 'delivered' });
        expect(nextReceiver(serve, state)).toBeNull();
        expect(nextReceiver([], state)).toBeNull();
    });
});

describe('load (the receiving side)', () => {
    const d01 = { from: 'cairn_mule2', kit: DROPPERS.cairn_d01, park: { x: 3232, z: 3220 } };

    test('options: giver, kit, Draynor by default, an optional park tile', () => {
        const o = loadOptions(d01);
        expect(o.from).toBe('cairn_mule2');
        expect(o.bank).toEqual(BANKS.draynor);
        expect(o.park).toEqual({ x: 3232, z: 3220 });
        expect(o.kit.map(i => i.item)).toEqual(['Logs', 'Oak logs', 'Willow logs', 'Maple logs', 'Yew logs']);
        expect(loadOptions({ from: 'cairn_mule2', kit: 'knife:1' }).park).toBeNull();
        expect(() => loadOptions({ from: 'Cairn Mule', kit: 'knife:1' })).toThrow(/login name/);
        expect(() => loadOptions({ from: 'cairn_mule2', kit: 'magic_logs:29' })).toThrow(/29 slots/);
        expect(() => loadOptions('cairn_mule2')).toThrow(/load/);
    });

    test('loaded means the exact kit and nothing else: a starter item left over, or one log short, is not', () => {
        const kit = parseKit('yew_logs:2,magic_logs:3');
        const logs: [number, number, string, number][] = [[0, 1515, 'Yew logs', 1], [1, 1515, 'Yew logs', 1], [2, 1513, 'Magic logs', 1], [3, 1513, 'Magic logs', 1], [4, 1513, 'Magic logs', 1]];
        expect(loadedExactly(inv(logs), kit)).toBe(true);
        expect(loadedExactly(inv([...logs, [5, 590, 'Tinderbox', 1]]), kit)).toBe(false);
        expect(loadedExactly(inv(logs.slice(1)), kit)).toBe(false);
        expect(loadedExactly(inv([...logs, [5, 1513, 'Magic logs', 1]]), kit)).toBe(false);
        expect(loadedExactly([], kit)).toBe(false);
    });

    test('wantSpecs are anchored: Logs never matches Oak logs', () => {
        const [normal, oak] = wantSpecs(parseKit('logs:2,oak_logs:4'));
        expect(normal).toMatchObject({ amount: 2 });
        expect((normal!.item as RegExp).test('Logs')).toBe(true);
        expect((normal!.item as RegExp).test('Oak logs')).toBe(false);
        expect((oak!.item as RegExp).test('oak logs')).toBe(true);
    });
});

describe('stall trip', () => {
    const view = (over: Partial<StallView> = {}): StallView => ({
        tick: 100,
        stallUp: true,
        onTile: true,
        lastContactTick: 0,
        held: 10,
        target: 55,
        freeSlots: 10,
        junk: false,
        hp: 99,
        maxHp: 99,
        hasFood: true,
        ...over
    });

    test('steals only while the stall is up and combat is 11 ticks behind', () => {
        expect(decideStall(view())).toBe('steal');
        expect(decideStall(view({ stallUp: false }))).toBe('wait');
        expect(decideStall(view({ lastContactTick: 100 - STALL_BACKOFF_TICKS + 1 }))).toBe('wait');
        expect(decideStall(view({ lastContactTick: 100 - STALL_BACKOFF_TICKS }))).toBe('steal');
    });

    test('junk is dropped in the gaps, never instead of a steal', () => {
        expect(decideStall(view({ junk: true }))).toBe('steal');
        expect(decideStall(view({ junk: true, stallUp: false }))).toBe('drop');
        expect(decideStall(view({ junk: true, lastContactTick: 99 }))).toBe('drop');
    });

    test('a full pack drops junk first, then banks', () => {
        expect(decideStall(view({ freeSlots: 0, junk: true }))).toBe('drop');
        expect(decideStall(view({ freeSlots: 0 }))).toBe('bank');
    });

    test('target, health and position', () => {
        expect(decideStall(view({ held: 55 }))).toBe('done');
        expect(decideStall(view({ hp: 45 }))).toBe('eat');
        expect(decideStall(view({ hp: 45, hasFood: false }))).toBe('steal');
        expect(decideStall(view({ hp: 30, hasFood: false }))).toBe('flee');
        expect(decideStall(view({ onTile: false }))).toBe('walk');
    });

    test('combat contact comes from events, a held target, the last hit or the refusal message', () => {
        const base = { tick: 500, combatEvents: [], gameMessages: [], player: { combat: { inCombat: false, targetIndex: -1, targetType: 'none', lastDamageTick: -1 } } } as never;
        expect(lastContact(base, 7)).toBe(7);
        const s = (over: Record<string, unknown>) => ({ ...(base as object), ...over }) as never;
        expect(lastContact(s({ combatEvents: [{ tick: 490 }] }), 7)).toBe(490);
        expect(lastContact(s({ player: { combat: { inCombat: true, targetIndex: 3, targetType: 'npc', lastDamageTick: -1 } } }), 7)).toBe(500);
        expect(lastContact(s({ player: { combat: { inCombat: false, targetIndex: -1, targetType: 'none', lastDamageTick: 480 } } }), 7)).toBe(480);
        expect(lastContact(s({ gameMessages: [{ tick: 495, text: "You can't steal from the market stall during combat!" }] }), 7)).toBe(495);
    });

    test('options need the giver; target defaults to 55 and food to kebabs', () => {
        expect(stallOptions({ deliverTo: 'cairn_mule2' })).toEqual({ target: 55, deliverTo: 'cairn_mule2', deliverAt: LUMBRIDGE_SPAWN, food: ['Kebab'] });
        expect(() => stallOptions({})).toThrow(/deliverTo/);
        expect(() => stallOptions({ deliverTo: 'x', target: 0 })).toThrow(/target/);
    });
});

describe('durable hand-off', () => {
    const kit = parseKit('knife:1');
    const result = (over: Partial<GiveResult> = {}): GiveResult => ({ ok: true, ticks: 7, gave: [], sent: 1, ...over });

    test('persists intent before sending and never repeats a delivered kit', async () => {
        const state = memoryRoleState();
        let sends = 0;
        const send = async () => {
            sends++;
            expect(state.get(kitDeliveryKey('cairn_casts'))).toMatchObject({ outcome: 'giving' });
            return result();
        };
        await giveKitOnce(state, 'cairn_casts', kit, send, () => false);
        const restarted = memoryRoleState(JSON.parse(JSON.stringify(state.data)));
        expect(await giveKitOnce(restarted, 'cairn_casts', kit, send, () => true)).toBeNull();
        expect(sends).toBe(1);
        expect(restarted.get(kitDeliveryKey('cairn_casts'))).toMatchObject({ outcome: 'delivered' });
    });

    test('a crash during give and an unreadable prior record fail closed', async () => {
        const state = memoryRoleState();
        await expect(giveKitOnce(state, 'cairn_casts', kit, async () => { throw new Error('disconnected'); }, () => true)).rejects.toThrow('disconnected');
        expect(await giveKitOnce(state, 'cairn_casts', kit, async () => { throw new Error('must not send'); }, () => true)).toBeNull();
        await state.set(kitDeliveryKey('cairn_casts'), null);
        expect(await giveKitOnce(state, 'cairn_casts', kit, async () => result(), () => true)).toBeNull();
    });

    test('only an unopened trade with all items still held can retry', async () => {
        for (const [reason, held, retry] of [
            ['no_response', true, true], ['player_not_found', true, true],
            ['no_response', false, false], ['timeout', true, false],
            ['closed before completing', true, false]
        ] as const) {
            const state = memoryRoleState();
            await giveKitOnce(state, 'cairn_casts', kit, async () => result({ ok: false, reason }), () => held);
            expect(state.get(kitDeliveryKey('cairn_casts')) === undefined).toBe(retry);
        }
    });

    test('a state write failure prevents the trade', async () => {
        let sent = false;
        const state = { get: () => undefined, set: async () => { throw new Error('disk full'); } };
        await expect(giveKitOnce(state, 'cairn_casts', kit, async () => { sent = true; return result(); }, () => true)).rejects.toThrow('disk full');
        expect(sent).toBe(false);
    });
});
