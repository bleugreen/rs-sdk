import { describe, expect, test } from 'bun:test';
import type { BotWorldState } from '../../../sdk/types';
import type { TickRow } from '../../lib/ticks';
import { burstLine, checkDemoTarget, kitShortfall, LAB_LITE, levelRefusal, magicRefusal, NET_CATCH, netSpot, notKit, ROD_COINS, talkLines } from './fishing-contest-demo';

const inv = (items: Record<string, number>) =>
    ({
        player: { worldX: 3185, worldZ: 3436, level: 0 },
        inventory: Object.entries(items).map(([name, count], slot) => ({ slot, id: slot + 1, name, count })),
        equipment: [],
    }) as unknown as BotWorldState;

const items = (specs: ReturnType<typeof kitShortfall>) => Object.fromEntries(specs.map(s => [String(s.item), s.n]));

describe('kitShortfall', () => {
    test('an empty inventory needs the whole kit, runes for every cast, and the rod money', () => {
        expect(items(kitShortfall(inv({}), 3))).toEqual({
            '/^law rune$/i': 3,
            '/^air rune$/i': 15,
            '/^spade$/i': 1,
            '/^garlic$/i': 1,
            '/^coins$/i': 5 + ROD_COINS,
        });
    });

    test('after the staging cast, the module needs two casts; what is held is not withdrawn again', () => {
        expect(items(kitShortfall(inv({ 'Law rune': 2, 'Air rune': 10, Spade: 1, Garlic: 1, 'Fishing rod': 1, Coins: 5 }), 2))).toEqual({});
        expect(items(kitShortfall(inv({ 'Law rune': 1, 'Air rune': 12, 'Fishing rod': 1, Coins: 3 }), 2))).toEqual({
            '/^law rune$/i': 1,
            '/^spade$/i': 1,
            '/^garlic$/i': 1,
            '/^coins$/i': 2,
        });
    });

    test('a worn air staff covers the air runes', () => {
        const s = inv({ 'Law rune': 3 });
        (s as unknown as { equipment: unknown[] }).equipment = [{ slot: 3, id: 1381, name: 'Staff of air', count: 1 }];
        expect(items(kitShortfall(s, 3))).not.toHaveProperty('/^air rune$/i');
    });
});

describe('levelRefusal (before any staging)', () => {
    const withSkills = (skills: Record<string, number>) =>
        ({ ...inv({}), skills: Object.entries(skills).map(([name, baseLevel]) => ({ name, level: baseLevel, baseLevel, experience: 0 })) }) as unknown as BotWorldState;

    test('Fishing 1 is refused, naming the shortfall (an account that never fished)', () => {
        expect(levelRefusal(withSkills({ Fishing: 1, Magic: 99 }), {})).toBe('base levels short: fishing 1/10');
    });

    test('Magic below Camelot is refused too', () => {
        expect(levelRefusal(withSkills({ Fishing: 10, Magic: 44 }), {})).toBe('base levels short: magic 44/45');
    });

    test('Fishing 10 and Magic 45 pass', () => {
        expect(levelRefusal(withSkills({ Fishing: 10, Magic: 45 }), {})).toBe(true);
    });

    test('with --train-fishing only Magic is checked up front', () => {
        expect(magicRefusal(withSkills({ Fishing: 1, Magic: 99 }), {})).toBe(true);
        expect(magicRefusal(withSkills({ Fishing: 1, Magic: 44 }), {})).toBe('base levels short: magic 44/45');
    });
});

describe('netSpot and the netted catch', () => {
    const npc = (index: number, name: string, distance: number, ops: string[]) => ({ index, name, distance, x: 0, z: 0, optionsWithIndex: ops.map((text, i) => ({ text, opIndex: i + 1 })) });
    const at = (npcs: unknown[]) => ({ ...inv({}), nearbyNpcs: npcs }) as unknown as BotWorldState;

    test('the nearest fishing spot that offers Net, never a Lure or Harpoon spot nearer by', () => {
        const s = at([npc(1, 'Fishing spot', 2, ['Cage', 'Harpoon']), npc(2, 'Fishing spot', 6, ['Net', 'Bait']), npc(3, 'Fishing spot', 4, ['Net', 'Bait']), npc(4, 'Harry', 1, ['Talk-to', 'Trade'])]);
        expect(netSpot(s)?.index).toBe(3);
    });

    test('none in view is null', () => {
        expect(netSpot(at([npc(1, 'Fishing spot', 2, ['Lure', 'Bait'])]))).toBeNull();
    });

    test('the catch to drop is the net catch only', () => {
        expect(['Raw shrimps', 'Raw anchovies', 'Raw giant carp', 'Shrimps'].filter(n => NET_CATCH.test(n))).toEqual(['Raw shrimps', 'Raw anchovies']);
    });
});

test('notKit lists what staging may deposit: never the kit or the runes', () => {
    expect(notKit(inv({ 'Law rune': 2, Coins: 9, Spade: 1, Lobster: 1, 'Rune scimitar': 1 })).sort()).toEqual(['Lobster', 'Rune scimitar']);
});

describe('checkDemoTarget', () => {
    test('the lab only on the local engine, the demo only off it', () => {
        expect(() => checkDemoTarget({ BOT_USERNAME: 'labfc1', SERVER: 'localhost' }, true)).not.toThrow();
        expect(() => checkDemoTarget({ BOT_USERNAME: 'labfc1', SERVER: 'rs-sdk-demo.fly.dev' }, true)).toThrow(/local lab engine/);
        expect(() => checkDemoTarget({ BOT_USERNAME: 'cairn_h55', SERVER: 'localhost' }, false)).toThrow(/demo world/);
        expect(() => checkDemoTarget({ BOT_USERNAME: 'cairn_h55', SERVER: 'rs-sdk-demo.fly.dev' }, false)).not.toThrow();
    });

    test('a forbidden name is refused in any form', () => {
        expect(() => checkDemoTarget({ BOT_USERNAME: 'Cairn Dot Md', SERVER: 'rs-sdk-demo.fly.dev' }, false)).toThrow(/forbidden/);
    });
});

const noteRow = (step: string, meta: Record<string, unknown>): TickRow => ({
    v: 1, kind: 'note', runId: 'r', account: 'a', sessionId: 1, step, startTick: 0, endTick: 0, ticks: 0, wallMs: 0, ok: true, meta, tickMs: 600, at: '',
});

describe('talkLines and burstLine', () => {
    const rows: TickRow[] = [
        noteRow('S20:B', { who: 'dwarf by the stairs', ticks: 15, dialogueTicks: 14, pages: 15, options: 5, matches: true, bursts: 4, failedBursts: 0, clickToDialogue: 1 }),
        noteRow('S20:D', { railing: 'in', clickToOtherSide: 2, resends: 0 }),
        noteRow('S20:H', { who: 'Morris', ticks: 6, dialogueTicks: 5, pages: 4, options: 0, matches: false, bursts: 1, failedBursts: 1 }),
        { ...noteRow('S20:I-bonzo', {}), kind: undefined, ticks: 12 },
    ];

    test('only the conversation notes become talks, with their segment', () => {
        const talks = talkLines(rows);
        expect(talks.map(t => [t.seg, t.ticks, t.failedBursts, t.matches])).toEqual([
            ['B', 15, 0, true],
            ['H', 6, 1, false],
        ]);
    });

    test('the burst line leads with the per-talk ticks, the failed bursts and the shape matches', () => {
        const line = burstLine('demo, browser', 'burst', talkLines(rows));
        expect(line).toStartWith('BURST demo, browser (burst): 2 talks, click to closed B 15, H 6 (mean 10.5); failedBursts 1 of 5; shape matches 1/2.');
        expect(line).toContain('rs/287');
    });
});

test('the lite lab means sum to fishing_contest.md totals', () => {
    const sum = (m: Record<string, number>) => Math.round(Object.values(m).reduce((a, b) => a + b, 0) * 10) / 10;
    expect(sum(LAB_LITE.burst)).toBe(314);
    expect(sum(LAB_LITE.fixed)).toBe(327.3);
});
