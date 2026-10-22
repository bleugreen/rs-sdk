import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

import { PRAYER_NAMES, type BotWorldState, type InventoryItem, type PrayerName } from '../../../sdk/types';
import { baseState } from '../../lib/fake-sdk';
import { SEGMENTS } from '../../quests/monkey-madness';
import { boundaryCensus, dungeonTraps, fixtureAt, FIXTURES, fixtureItems, FREE_KEPT, KIT, MM_VARS, PIN_START, remainingKit, SegmentUse, slotsNeeded, topUpPlan, topUpReserve } from './monkey-madness';

const packNames = (kind: string) => new Set(readFileSync(join(import.meta.dir, '..', '..', '..', 'server', 'content', 'pack', `${kind}.pack`), 'utf8').split('\n').map(l => l.slice(l.indexOf('=') + 1).trim()));

describe('fixtures', () => {
    test('one per segment, in order', () => {
        expect(FIXTURES.map(f => f.letter)).toEqual(SEGMENTS.map(s => s.letter));
    });

    test('every var is an MM varp or varbit the engine defines', () => {
        const varbits = readFileSync(join(import.meta.dir, '..', '..', '..', 'server', 'content', 'scripts', 'quests', 'quest_mm', 'configs', 'quest_mm.varbit'), 'utf8');
        for (const v of MM_VARS) expect([v, v === 'mm_main' || varbits.includes(`[${v}]`)]).toEqual([v, true]);
        for (const f of FIXTURES) for (const k of Object.keys(f.vars)) expect(MM_VARS as readonly string[]).toContain(k);
    });

    test('every item is an obj debug name; worn items are given', () => {
        const objs = packNames('obj');
        for (const k of Object.keys(KIT)) expect([k, objs.has(k)]).toEqual([k, true]);
        for (const f of FIXTURES) {
            for (const k of Object.keys(f.items)) expect([f.letter, k, objs.has(k)]).toEqual([f.letter, k, true]);
            for (const w of f.worn ?? []) expect([f.letter, w, w in f.items || w in remainingKit(f.letter)]).toEqual([f.letter, w, true]);
        }
    });

    test('mm_main never decreases along the route', () => {
        const mains = FIXTURES.map(f => f.vars.mm_main ?? 0);
        for (let i = 1; i < mains.length; i++) expect(mains[i]!).toBeGreaterThanOrEqual(mains[i - 1]!);
    });

    test('kit is spent by the segment that uses it', () => {
        expect(remainingKit('L').gold_bar).toBe(1);
        expect(remainingKit('M').gold_bar).toBeUndefined();
        expect(remainingKit('P').banana).toBeUndefined();
        // Z still holds the spare Varrock set (a temple rope pin's escape), on top of Ardougne's last cast.
        expect(remainingKit('Z')).toMatchObject({ lawrune: 3, airrune: 3, firerune: 1, waterrune: 2 });
        expect(remainingKit('A', { sharks: 4 }).shark).toBe(4);
    });

    test('a pinned O starts at the Varrock landing with the spare Varrock set spent; no other fixture stages pinned', () => {
        expect(remainingKit('O', { pinned: true })).toMatchObject({ lawrune: KIT.lawrune! - 1, airrune: KIT.airrune! - 3, firerune: KIT.firerune! - 1, waterrune: KIT.waterrune });
        expect(fixtureAt('O', { pinned: true }).tile).toEqual(PIN_START);
        expect(fixtureAt('O').tile).toEqual(FIXTURES.find(f => f.letter === 'O')!.tile);
        expect(() => fixtureAt('N', { pinned: true })).toThrow(/only O/);
    });

    test("H12 (15 sharks, 4 potions, no bananas) fills A's 28 slots with the seal, the bow and arrows worn", () => {
        expect(slotsNeeded('A') + 1).toBe(28);
        // With few enough sharks every fixture fits.
        for (const f of FIXTURES) expect([f.letter, slotsNeeded(f.letter, { sharks: 3 }) <= 28]).toEqual([f.letter, true]);
    });

    test('fixture items put the quest items first and fill only the free slots with sharks', () => {
        for (const f of FIXTURES) {
            const items = fixtureItems(f.letter);
            expect(items.slice(0, Object.keys(f.items).length).map(([k]) => k)).toEqual(Object.keys(f.items));
            const sharks = items.find(([k]) => k === 'shark')?.[1] ?? 0;
            expect([f.letter, slotsNeeded(f.letter, { sharks })]).toEqual([f.letter, Math.min(28 - (f.keepFree ?? FREE_KEPT), slotsNeeded(f.letter))]);
        }
        expect(fixtureItems('K', { sharks: 2 }).find(([k]) => k === 'shark')).toEqual(['shark', 2]);
        // The pre-dose fills A's 28th slot without costing a shark, and only at A.
        const a = fixtureItems('A', { predose: true });
        expect([a.find(([k]) => k === 'shark'), a.find(([k]) => k === '1dose2antipoison')]).toEqual([['shark', KIT.shark!], ['1dose2antipoison', 1]]);
        expect(fixtureItems('B', { predose: true }).some(([k]) => k === '1dose2antipoison')).toBe(false);
    });
});

/** A scripted state: HP, the pack by item name, prayer points and the prayers on, and the hits published so far. */
function st(o: { tick: number; hp: number; inv: string[]; pp?: number; on?: PrayerName[]; hits?: Array<[number, number, number]>; npcs?: Array<[number, string]> }): BotWorldState {
    const inventory: InventoryItem[] = o.inv.map((name, slot) => ({ slot, id: slot, name, count: 1, optionsWithIndex: [] }));
    return baseState({
        tick: o.tick,
        player: { hp: o.hp, maxHp: 42, worldX: 2760, worldZ: 2790, level: 0 } as BotWorldState['player'],
        inventory,
        prayers: { activePrayers: PRAYER_NAMES.map(p => (o.on ?? []).includes(p)), prayerPoints: o.pp ?? 94, prayerLevel: 94 },
        combatEvents: (o.hits ?? []).map(([tick, damage, sourceIndex]) => ({ tick, damage, type: 'damage_taken' as const, sourceType: 'npc' as const, sourceIndex, targetType: 'player' as const, targetIndex: 0 })),
        nearbyNpcs: (o.npcs ?? []).map(([index, name]) => ({ index, name })) as BotWorldState['nearbyNpcs'],
    });
}

const sharks = (n: number) => Array<string>(n).fill('Shark');

describe('consumption census', () => {
    test('a boundary counts sharks, doses, slots and empty vials', () => {
        const b = boundaryCensus(st({ tick: 7, hp: 30, inv: [...sharks(3), 'Prayer potion(4)', 'Prayer potion(2)', 'Vial', 'Gold bar'], pp: 50 }), 'K');
        expect(b).toEqual({ before: 'K', tick: 7, hp: 30, sharks: 3, prayer: 50, doses: 6, slots: 7, vials: 1 });
    });

    test('a segment counts eats, drinks and HP lost; a top-up never counts as use', () => {
        const u = new SegmentUse('K');
        u.see(st({ tick: 1, hp: 42, inv: [...sharks(3), 'Prayer potion(4)'] }));
        u.see(st({ tick: 2, hp: 18, inv: [...sharks(3), 'Prayer potion(4)'] }));
        u.see(st({ tick: 3, hp: 38, inv: [...sharks(2), 'Prayer potion(3)'] }));
        u.see(st({ tick: 4, hp: 38, inv: [...sharks(6), 'Prayer potion(3)', 'Prayer potion(4)'] }));
        const s = u.summary();
        expect([s.eaten, s.drunk, s.hpLost, s.minHp, s.peakSlots, s.deaths]).toEqual([1, 1, 24, 18, 8, 0]);
    });

    test('hits are split by whether a protect prayer was on, once per event, and the hits before the segment are ignored', () => {
        const u = new SegmentUse('H');
        const npcs: Array<[number, string]> = [[5, 'Monkey Archer'], [6, 'Monkey Guard']];
        u.see(st({ tick: 1, hp: 42, inv: [], hits: [[0, 9, 6]], npcs }));
        u.see(st({ tick: 2, hp: 34, inv: [], hits: [[0, 9, 6], [2, 8, 5]], npcs }));
        u.see(st({ tick: 3, hp: 34, inv: [], on: ['protect_from_missiles'], hits: [[0, 9, 6], [2, 8, 5], [3, 0, 5]], npcs }));
        u.see(st({ tick: 5, hp: 29, inv: [], on: ['protect_from_missiles'], hits: [[2, 8, 5], [3, 0, 5], [5, 5, 6]], npcs }));
        const s = u.summary();
        expect(s.hitsUnprayed).toEqual({ 'Monkey Archer': 8 });
        expect(s.hitsPrayed).toEqual({ 'Monkey Guard': 5 });
        expect(s.prayerTicks).toEqual({ protect_from_missiles: 2 });
    });

    test('the dungeon traps are read from the maps, and HP lost on one is counted', () => {
        const traps = dungeonTraps();
        expect(traps.size).toBe(89); // 72 floor spikes, 15 spear traps, 2 spring-trap triggers
        expect(traps.has('2743,9146,0')).toBe(true); // the spring trap by the Zooknock passage
        const u = new SegmentUse('K', traps);
        const at = (tick: number, hp: number, x: number, z: number) => {
            const s = st({ tick, hp, inv: [] });
            return { ...s, player: { ...s.player!, worldX: x, worldZ: z } };
        };
        // The trap's damage is queued, so a loss the tick after stepping off still counts; one later does not.
        u.see(at(1, 30, 2742, 9146));
        u.see(at(2, 28, 2743, 9146));
        u.see(at(3, 26, 2744, 9146));
        u.see(at(4, 24, 2745, 9146));
        expect([u.summary().hpLost, u.summary().trapHp, u.summary().trapTicks]).toEqual([6, 4, 1]);
    });

    test('the top-up fills the free slots less the reserve, potions first', () => {
        const s = st({ tick: 1, hp: 42, inv: [...sharks(20), 'Prayer potion(4)'] });
        expect(topUpPlan(s, topUpReserve('D'), 3)).toEqual([['4doseprayerrestore', 2], ['shark', 3]]);
        expect(topUpPlan(s, topUpReserve('Y', s), 0)).toEqual([['shark', 3]]);
        expect(topUpPlan(st({ tick: 1, hp: 42, inv: sharks(26) }), FREE_KEPT, 2)).toEqual([]);
    });
});
