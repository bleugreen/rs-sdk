import { describe, expect, test } from 'bun:test';

import type { InventoryItem } from '../../sdk/types';
import { planOffers } from '../lib/trade';
import { decideStall, displayName, giveSpecs, kitHeld, kitOptions, kitSlots, lastContact, LUMBRIDGE_SPAWN, parseKit, splitLogs, STALL_BACKOFF_TICKS, stallOptions, type StallView } from './kits';

const inv = (items: [number, number, string, number][]): InventoryItem[] =>
    items.map(([slot, id, name, count]) => ({ slot, id, name, count, optionsWithIndex: [] }));

/** rs/147's kits (2026-10-21). */
const KITS = {
    cairn_chops: 'rune_axe:1,knife:1,logs:1',
    cairn_casts: 'fly_fishing_rod:1,feather:800,knife:1,logs:1',
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
            { item: 'Logs', amount: 1, noted: false }
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
        expect(kitSlots(parseKit(KITS.cairn_casts))).toBe(4);
        expect(kitSlots(parseKit(KITS.cairn_steals))).toBe(2);
        expect(kitSlots(parseKit(KITS.cairn_jumps))).toBe(8);
        expect(kitSlots(parseKit('knife:3'))).toBe(3);
    });
});

describe('options', () => {
    test('every rs/147 kit fits a fresh account; defaults stand at the tutorial exit', () => {
        const o = kitOptions({ kits: KITS, serve: 'cairn_chops' });
        expect(o.serve).toBe('cairn_chops');
        expect(o.stand).toEqual(LUMBRIDGE_SPAWN);
        expect(o.returns.sort()).toEqual(Object.keys(KITS).sort());
        expect(kitOptions({ kits: KITS }).serve).toBeNull();
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
        expect(kitHeld(inv([[0, 309, 'Fly fishing rod', 1], [1, 314, 'Feather', 799], [2, 946, 'Knife', 1], [3, 1511, 'Logs', 1]]), kit)).toBe(false);
        expect(kitHeld(inv([[0, 309, 'Fly fishing rod', 1], [1, 314, 'Feather', 800], [2, 946, 'Knife', 1], [3, 1511, 'Logs', 1]]), kit)).toBe(true);
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
