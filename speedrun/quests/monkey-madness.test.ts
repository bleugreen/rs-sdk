import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

import type { BotWorldState, InventoryItem, PlayerState, QuestJournalState } from '../../sdk/types';
import { baseState, drive, FakeSdk } from '../lib/fake-sdk';
import type { ReceiveResult } from '../lib/trade';
import { compactJournal } from '../lib/quests';
import { Observation, resolveResume } from '../runner/resume';
import type { Observed, RunnerSession } from '../runner/step';
import {
    BANANA_TREE_IDS, bananaRoomDrops, DEFAULT_OPTIONS, roomFor, doneAt, EXIT_DROPS, exitState, h12Kit, H12_POTIONS, H12_SHARKS, isWaydarIntroEnd, itemMilestone, setStepNote, stopgapRetry, talkableNpc, JOURNAL_MARKS, JOURNAL_PROBE, journalMilestone, MM_OBJ, mmMilestone, PUZZLE_TILE_IDS,
    BELOW_30_EATING, cureWanted, eatBelowFor, sharksToDrop, topUpRefusal, type TopUp, immunityWanted,
    ARCHER_REACH, AUNT_BOX, crateRoute, crateSteps, entersSleepingZone, SLEEPING_DETOURS, sleepingDetour, GUARD_REACH, legPrayerFor, M_TOPUP_TILE, mLegSize, mTopUpSharks, NO_DWELL, pathTiles, pLegSize, POSTED_ARCHERS, prayerRuns, receiveLeg, RELIGIOUS_GUARDS, SLEEPING_ZONE, tilePrayer, TOPUP_TRIES, TOPUP_WAIT, tradeIdle, type Receive, nextBananaTree, SUPER_IMMUNE_TICKS, offAtoll, patrolLeavesLane, SEGMENT_EATING, topUpWanted, resolveOptions, REWARD_ITEMS, seg, segmentName, SEGMENTS, stepId, steps, templeLeft, treeRouteRefusal, yRoom, type MmContext,
} from './monkey-madness';
import { slotNeed } from './segments';

const item = (id: number, slot = 0): InventoryItem => ({ slot, id, name: `obj ${id}`, count: 1, optionsWithIndex: [] });

/** Lines as the server wraps them: arbitrary breaks, colour tags kept. */
function journal(text: string): QuestJournalState {
    const words = text.split(' ');
    const lines: string[] = [];
    for (let i = 0; i < words.length; i += 4) lines.push(`@str@${words.slice(i, i + 4).join(' ')}`);
    return { title: 'Monkey Madness', lines, open: false, tick: 50 };
}

function obs(o: { status?: 'not_started' | 'started' | 'complete'; text?: string; inv?: number[]; worn?: number[] } = {}): Observed {
    const state = baseState({
        quests: { mm: o.status ?? 'started' },
        inventory: (o.inv ?? []).map((id, i) => item(id, i)),
        equipment: (o.worn ?? []).map((id, i) => item(id, i)),
    } as Partial<BotWorldState>);
    return { state, probed: { [JOURNAL_PROBE]: o.text === undefined ? null : journal(o.text) } };
}

// Journal texts as mm_journal.rs2 builds them at representative points.
const CH1 = '@dre@Chapter 1:||';
const AFTER_A = `${CH1}@dre@King Narnode Shareen:|| @str@Narnode has given me a copy of the Royal Seal so that I may identify myself as his envoy.|| @dbl@I have agreed to investigate the @dre@Karamjan@dbl@ shipyard.`;
const AFTER_B = `${CH1}@str@Narnode has given me a copy of the Royal Seal so that I may identify myself as his envoy.|| @str@I have investigated the Karamjan shipyard.||`;
const MID_E = `${AFTER_B} @str@Narnode has given me some handwritten orders.|| @str@I have been taken to the Underground Military Glider Hangar.|| @dbl@I cannot go on the mission until reinitialisation has been|@dbl@completed.`;
const CH1_DONE = `${CH1}@str@I have found that the 10th squad were indeed blown off course and never reached the shipyard.`;
const AFTER_H = `${CH1_DONE}||@dre@Chapter 2:||@str@I have made my rather painful way to a large village|@str@populated by various types of monkey.`;
const AFTER_I = `${AFTER_H}||@dre@Sergeant Garkor:||@str@I found Sergeant Gakor hiding towards the east of the village.`;
const IN_L = `${AFTER_I}||@str@Zooknock is capable of transforming my body into that of a monkey.`;
const CH3 = `${CH1_DONE}||@dre@Chapter 2:||@str@I have made contact with the rest of the 10th squad||@dre@Chapter 3:||@str@I found Sergeant Gakor hiding`;
const AFTER_R = `${CH3}||@str@I have disguised myself as a Karamjan monkey.||@dbl@I must seek audience with @dre@Awowogei@dbl@, proposing an alliance`;
const AFTER_S = `${CH3}||@dre@Awowogei:||@dbl@To demonstrate my worthiness, I have been asked to rescue one of the Karamjan type of monkey from the zoo in @dre@Ardougne@dbl@.`;
const AFTER_V = `${CH3}||@dre@Awowogei:||@str@I have rescued one of the monkeys from the zoo in Ardougne@str@and have shown the evidence to Awowogei. I appear to have@str@earnt Awowogei's favour.`;
const AFTER_W = `${AFTER_V}||@str@In order to fool this spell, Garkor has given me a sigil which @str@identifies me with the squad.`;
const POST_DEMON = `${CH1_DONE}||@dre@Chapter 2:||@dre@Chapter 3:||@str@I earnt @str@Awowogei's favour.||@dbl@With the help of the 10th squad I managed to slay @dre@Glough's@dbl@ 'pet'||@dbl@I must now report to @dre@King Narnode@dbl@.`;
const REPORTED = POST_DEMON.replace("@dbl@I must now report to @dre@King Narnode@dbl@.", '@str@I have reported to King Narnode.');
const COMPLETE = `${REPORTED}||@red@QUEST COMPLETE!||@dbl@I should find Daero and enroll with the Royal Guard training programme.`;
const TRAINED = `${REPORTED}||@red@QUEST COMPLETE!||@str@I found Daero and enrolled in the Royal Guard training @str@programme.`;

describe('the temple rope pin: the way back and the resume walk', () => {
    const player = (x: number, z: number, level = 0) => ({ name: 'lab', x, z, worldX: x, worldZ: z, level, hp: 30 }) as unknown as PlayerState;
    /** O's start as a chain reaches it: the strung amulet and the mould held (N done), the talisman not yet. */
    const oStage = (x: number, z: number, level = 0, extra: number[] = []) =>
        baseState({ quests: { mm: 'started' }, player: player(x, z, level), inventory: [MM_OBJ.amulet, MM_OBJ.amuletMould, ...extra].map((id, i) => item(id, i)) } as Partial<BotWorldState>);
    // Every place the way back passes through: the Varrock teleport's landing (travel.ts SPELLS), the two spirit trees'
    // landings, Daero's floor of the Grand Tree, the powered hangar, Crash Island (Lumdo's stop), and the atoll's landing.
    const WAY: ReadonlyArray<readonly [string, number, number, number]> = [
        ['Varrock', 3213, 3424, 0], ['the village tree', 2542, 3169, 0], ['the stronghold tree', 2461, 3444, 0], ['Daero', 2484, 3487, 1],
        ['the hangar', 2585, 4516, 0], ['Crash Island', 2894, 2726, 0], ['the atoll landing', 2802, 2707, 0],
    ];

    test('off the atoll: the mainland, the hangar and Crash Island; not the surface, the dungeon, the cellar or under the temple', () => {
        for (const [, x, z, level] of WAY.slice(0, -1)) expect(offAtoll(oStage(x, z, level))).toBe(true);
        for (const [x, z] of [[2802, 2707], [2807, 2785], [2763, 9103], [2782, 9172], [2808, 9201]] as const) expect(offAtoll(oStage(x, z))).toBe(false);
    });

    test('the resume walk enters O by run from every leg of the way back', async () => {
        for (const [where, x, z, level] of WAY) {
            const obs = new Observation(oStage(x, z, level), { [JOURNAL_PROBE]: async () => journal(IN_L) }, {} as RunnerSession);
            const p = await resolveResume(steps(), obs, {} as MmContext);
            expect({ where, step: p.step, mode: p.mode }).toEqual({ where, step: 'S15:O-child', mode: 'run' });
        }
    });

    test("N's end admits the pin's teleport and the clear tiles, and refuses the guards' box", () => {
        expect(templeLeft(oStage(3213, 3424), {} as MmContext)).toBe(true);
        expect(templeLeft(oStage(2794, 2774), {} as MmContext)).toBe(true);
        expect(templeLeft(oStage(2806, 2785), {} as MmContext)).toMatch(/trapdoor guards/);
        expect(templeLeft(oStage(2808, 9201), {} as MmContext)).toMatch(/trapdoor guards/);
    });

    test('the tree route refuses with the backpack monkey carried (DELETES_FOLLOWER_ITEM), and not otherwise', () => {
        expect(treeRouteRefusal(oStage(3213, 3424))).toBeNull();
        expect(treeRouteRefusal(oStage(3213, 3424, 0, [MM_OBJ.monkey]))).toMatch(/monkey/);
    });
});

describe('antipoison cures', () => {
    const at = (o: Partial<Parameters<typeof cureWanted>[0]>) => cureWanted({ tick: 1000, lastPoisoned: 1000, lastDose: -Infinity, ...o });

    test('a fresh poisoning is cured once, in any segment', () => {
        expect(at({})).toBe(true);
        expect(at({ lastDose: 1000 })).toBe(false); // cured this tick
        expect(at({ lastPoisoned: 900, lastDose: 950 })).toBe(false); // a later dose covered it
        expect(at({ lastPoisoned: 960 })).toBe(false); // 40 ticks old: not this poisoning's message
    });
});

describe('O: the banana tree to search', () => {
    const t = (x: number, z: number) => ({ x, z });
    test('the nearest first; after a miss, the nearest other tree; all missed, the nearest again', () => {
        const trees = [t(2746, 2793), t(2741, 2797), t(2745, 2797)];
        const me = { x: 2745, z: 2794 };
        expect(nextBananaTree(trees, me, new Set())).toEqual(t(2746, 2793));
        expect(nextBananaTree(trees, me, new Set(['2746,2793']))).toEqual(t(2745, 2797));
        expect(nextBananaTree(trees, me, new Set(['2746,2793', '2745,2797', '2741,2797']))).toEqual(t(2746, 2793));
        expect(nextBananaTree([], me, new Set())).toBeNull();
    });
});

describe('poison immunity before a dungeon pass', () => {
    test("a super dose's 600 ticks: a dose is wanted once under 60 are left, and never without one held", () => {
        expect(SUPER_IMMUNE_TICKS).toBe(20 * 30);
        expect(immunityWanted(1000, -Infinity, true)).toBe(true);
        expect(immunityWanted(1000, 500, true)).toBe(false);
        expect(immunityWanted(1041, 500, true)).toBe(true);
        expect(immunityWanted(5000, -Infinity, false)).toBe(false);
    });
});

describe('eating policy', () => {
    const at = (hp: number, sharks: number) =>
        baseState({ player: { name: 'lab', x: 0, z: 0, worldX: 0, worldZ: 0, level: 0, hp } as unknown as PlayerState, inventory: Array.from({ length: sharks }, (_, i) => item(MM_OBJ.shark, i)) } as Partial<BotWorldState>);
    /** The worst damage in any 3-tick window per segment over every valid round, without and with the hits near the guards. */
    const WORST_3_TICKS: Record<string, number> = { H: 17, I: 12, J: 15, K: 16, L: 2, M: 11, N: 13, O: 14, P: 15, Q: 2, R: 6 };

    test('the ruled thresholds are 10 + each segment\'s worst 3-tick damage, H-R, everywhere (no corridor column); 20 elsewhere; no top-ups', () => {
        for (const [letter, worst] of Object.entries(WORST_3_TICKS)) expect([letter, eatBelowFor(SEGMENT_EATING, letter)]).toEqual([letter, 10 + worst]);
        expect(Object.keys(SEGMENT_EATING).sort()).toEqual(['below', 'otherwise']);
        for (const letter of 'ABCDEFGSTUVWXYZ') expect([letter, eatBelowFor(SEGMENT_EATING, letter)]).toEqual([letter, 20]);
        expect(SEGMENT_EATING.topUpBelow).toBeUndefined();
    });

    test('the default options eat by the ruled table', () => {
        expect(resolveOptions().eating).toBe(SEGMENT_EATING);
        expect(resolveOptions({ eating: BELOW_30_EATING }).eating).toBe(BELOW_30_EATING);
    });

    test('the below-30 setting eats at 30 everywhere and tops up below 34', () => {
        expect([eatBelowFor(BELOW_30_EATING, 'K'), eatBelowFor(BELOW_30_EATING, 'A'), BELOW_30_EATING.topUpBelow]).toEqual([30, 30, 34]);
    });

    test('a top-up is wanted under its threshold with a shark held, not at it or with none', () => {
        expect(topUpWanted(at(33, 1), 34)).toBe(true);
        expect(topUpWanted(at(34, 3), 34)).toBe(false);
        expect(topUpWanted(at(12, 0), 34)).toBe(false);
    });
});

describe('segments', () => {
    test('26 unique names A-Z, all prefixed S15:', () => {
        const names = SEGMENTS.map(segmentName);
        expect(names).toHaveLength(26);
        expect(new Set(names).size).toBe(26);
        expect(SEGMENTS.map(d => d.letter).join('')).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
        for (const n of names) expect(n.startsWith(`${stepId}:`)).toBe(true);
        expect(names[0]).toBe('S15:A-narnode');
    });

    test('logout-unsafe exactly on E, G, Q, W and X (the manifest stretches)', () => {
        expect(SEGMENTS.filter(d => !d.logoutSafe).map(d => d.letter).join('')).toBe('EGQWX');
    });

    test('travel segments are K, M, P and U', () => {
        expect(SEGMENTS.filter(d => d.travel).map(d => d.letter).join('')).toBe('KMPU');
    });

    test('the stock reference column sums to the doc rows (~4,418)', () => {
        expect(SEGMENTS.reduce((a, d) => a + d.stockRef, 0)).toBe(4418);
    });

    test('option defaults', () => {
        expect(DEFAULT_OPTIONS).toMatchObject({ dialogue: 'fixed', templeMethod: 'ladder', returnMonkey: 'walk' });
        expect(resolveOptions({ returnMonkey: 'glider' })).toMatchObject({ dialogue: 'fixed', templeMethod: 'ladder', returnMonkey: 'glider' });
    });
});

describe("G: Waydar's arrival intro", () => {
    const scripts = join(import.meta.dir, '..', '..', 'server', 'content', 'scripts', 'quests', 'quest_mm', 'scripts');
    /** Every quoted chat line of Waydar's script and of quest_mm.rs2 (the chapter 2 cutscene's pages). */
    const lines = (file: string) => [...readFileSync(join(scripts, file), 'utf8').matchAll(/~\.?chat(?:npc|player|npcnoturn)\("(?:<p,\w+>)?([^"]*)"/g)].map(m => m[1]!);

    test('ends on the intro\'s last page and on no other page G can show', () => {
        const waydar = lines('mm_waydar.rs2');
        expect(waydar.filter(isWaydarIntroEnd)).toEqual(['Of course.']);
        expect(lines('quest_mm.rs2').filter(isWaydarIntroEnd)).toEqual([]);
    });

    test('matches the page as pageText joins it, and not a longer phrase', () => {
        expect(isWaydarIntroEnd('Waydar Of course. Click here to continue')).toBe(true);
        expect(isWaydarIntroEnd('Of course.')).toBe(true);
        expect(isWaydarIntroEnd('Of course not.')).toBe(false);
        expect(isWaydarIntroEnd('Did our glider survive?')).toBe(false);
    });
});

describe('slots and supplies', () => {
    const content = join(import.meta.dir, '..', '..', 'server', 'content');

    test('the banana tree ids are the fruit stages of the quest trees, not the empty one', () => {
        const pack = new Map(readFileSync(join(content, 'pack', 'loc.pack'), 'utf8').split('\n').map(l => l.split('=') as [string, string]).map(([id, n]) => [Number(id), n?.trim()]));
        expect([...BANANA_TREE_IDS].map(id => pack.get(id)).sort()).toEqual(['mm_bananatreefour', 'mm_bananatreefull', 'mm_bananatreeone', 'mm_bananatreethree', 'mm_bananatreetwo']);
    });

    test('H12 fills 28 slots at A with the seal, the bow wielded and the arrows quivered', () => {
        const stackable = /rune|arrow/i;
        const worn = (k: { id?: number; name: RegExp }) => k.id === MM_OBJ.magicShortbow || /arrow/i.test(k.name.source);
        const slots = h12Kit(MM_OBJ.magicShortbow).filter(k => !worn(k)).reduce((n, k) => n + (stackable.test(k.name.source) ? 1 : k.n), 0);
        expect([H12_SHARKS, H12_POTIONS]).toEqual([15, 4]);
        expect(slots + 1).toBe(28); // + the royal seal, A and B; Narnode's orders take its slot in C and D
    });
});

describe('T: the zoo monkey', () => {
    const npc = (index: number, name: string, x: number, z: number, ops: string[]) =>
        ({ index, name, x, z, tileX: x, tileZ: z, optionsWithIndex: ops.map((text, i) => ({ text, opIndex: i + 1 })) }) as unknown as BotWorldState['nearbyNpcs'][number];

    test('a plain monkey nearer the cage entry is passed over for one that offers Talk-to', () => {
        const s = baseState({ nearbyNpcs: [npc(1, 'Monkey', 2603, 3281, ['Attack']), npc(2, 'Monkey', 2605, 3280, ['Talk-to']), npc(3, 'Monkey Minder', 2604, 3281, ['Talk-to'])] } as Partial<BotWorldState>);
        expect(talkableNpc(s, /^Monkey$/, { x: 2604, z: 3281 })?.index).toBe(2);
        expect(talkableNpc(baseState({ nearbyNpcs: [npc(1, 'Monkey', 2603, 3281, ['Attack'])] } as Partial<BotWorldState>), /^Monkey$/, { x: 2604, z: 3281 })).toBeNull();
    });

    test('the cage holds both kinds under one name (maps m40_51: plain monkeys and mm_zoo_monkey)', () => {
        const npcs = readFileSync(join(import.meta.dir, '..', '..', 'server', 'content', 'scripts', 'quests', 'quest_mm', 'configs', 'quest_mm.npc'), 'utf8');
        expect(/\[mm_zoo_monkey\]\nname=Monkey\n[\s\S]*?op1=Talk-to/.test(npcs)).toBe(true);
    });
});

describe('stopgap until rs/309', () => {
    test('retries a dropped action at most `tries` times and notes each miss', async () => {
        const lines: string[] = [];
        setStepNote(l => lines.push(l));
        let n = 0;
        expect(await stopgapRetry('x', 3, async () => ++n === 2)).toBe(true);
        expect([n, lines]).toEqual([2, ['S15 stopgap x: attempt 1 of 3 did not land', 'S15 stopgap x: landed on attempt 2']]);
        n = 0;
        expect(await stopgapRetry('y', 3, async () => (n++, false))).toBe(false);
        expect(n).toBe(3);
        setStepNote(() => {});
    });
});

describe('jail patrol handover', () => {
    const npc = (name: string, x: number, z: number) => ({ kind: 'npc', id: 1, index: name.length, name, combatLevel: 1, x, z, tileX: x, tileZ: z, size: 2, distance: 3, hp: null, maxHp: null, healthPercent: null, targetIndex: -1, inCombat: false }) as never;
    const at = (...g: Array<[string, number, number]>) => {
        const s = baseState();
        s.nearbyNpcs = g.map(([n, x, z]) => npc(n, x, z));
        return s;
    };
    test('fires only when a gorilla steps off the lane top westward', () => {
        expect(patrolLeavesLane(at(['Aberab', 2772, 2801], ['Trefaji', 2767, 2803]), at(['Aberab', 2771, 2801], ['Trefaji', 2767, 2803]))).toBe(true);
        // The incoming gorilla passes the same tiles eastward.
        expect(patrolLeavesLane(at(['Trefaji', 2770, 2801]), at(['Trefaji', 2771, 2801]))).toBe(false);
        expect(patrolLeavesLane(at(['Trefaji', 2771, 2801]), at(['Trefaji', 2772, 2801]))).toBe(false);
        // Down the lane, not off it.
        expect(patrolLeavesLane(at(['Aberab', 2772, 2801]), at(['Aberab', 2772, 2800]))).toBe(false);
        expect(patrolLeavesLane(at(['Monkey Guard', 2772, 2801]), at(['Monkey Guard', 2771, 2801]))).toBe(false);
    });
});

describe('object ids', () => {
    test('match server/content/pack/obj.pack', () => {
        const pack = new Map<string, number>();
        for (const line of readFileSync(join(import.meta.dir, '..', '..', 'server', 'content', 'pack', 'obj.pack'), 'utf8').split('\n')) {
            const i = line.indexOf('=');
            if (i > 0) pack.set(line.slice(i + 1).trim(), Number(line.slice(0, i)));
        }
        const debug: Record<keyof typeof MM_OBJ, string> = {
            royalSeal: 'mm_gnome_royal_seal', orders: 'mm_narnode_orders', dentures: 'mm_monkey_dentures', enchantedBar: 'mm_enchanted_gold_bar',
            amuletMould: 'mm_monkey_amulet_mould', amulet: 'mm_amulet_of_monkey_speak', amuletUnstrung: 'mm_amulet_of_monkey_speak_without_string',
            talisman: 'mm_monkey_talisman', greegree: 'mm_monkey_greegree_for_normal_monkey', monkey: 'mm_monkey_in_backpack', sigil: 'mm_sigil',
            monkeyBones: 'mm_normal_monkey_bones', goldBar: 'gold_bar', ballOfWool: 'ball_of_wool', banana: 'banana', magicShortbow: 'magic_shortbow',
            runeArrow: 'rune_arrow', prayerPotion4: '4doseprayerrestore', superAntipoison4: '4dose2antipoison', superAntipoison1: '1dose2antipoison', shark: 'shark',
        };
        for (const [k, name] of Object.entries(debug)) expect([k, pack.get(name)]).toEqual([k, MM_OBJ[k as keyof typeof MM_OBJ]]);
        PUZZLE_TILE_IDS.forEach((id, i) => expect(pack.get(`reinitialisation_${String(i + 1).padStart(2, '0')}`)).toBe(id));
    });
});

describe('mmMilestone', () => {
    const at = (letter: string) => seg(letter);

    test('not started is -1; the seal alone (journal unread) is A', () => {
        expect(mmMilestone(obs({ status: 'not_started' }))).toBe(-1);
        expect(mmMilestone(obs({ status: 'not_started', inv: [MM_OBJ.royalSeal] }))).toBe(at('A'));
        expect(mmMilestone(obs({ inv: [MM_OBJ.royalSeal] }))).toBe(at('A'));
    });

    test('unobservable (no quest list) is -1', () => {
        const o = obs();
        delete (o.state as Partial<BotWorldState>).quests;
        expect(mmMilestone(o)).toBe(-1);
    });

    test('every journal mark maps to its segment, tags and line breaks ignored', () => {
        for (const [letter, phrase] of JOURNAL_MARKS) expect([letter, journalMilestone(compactJournal(journal(phrase).lines.join('')))]).toEqual([letter, seg(letter)]);
        expect(mmMilestone(obs({ text: AFTER_A, inv: [MM_OBJ.royalSeal] }))).toBe(at('A'));
        expect(mmMilestone(obs({ text: AFTER_B, inv: [MM_OBJ.royalSeal] }))).toBe(at('B'));
        expect(mmMilestone(obs({ text: MID_E, inv: [MM_OBJ.royalSeal] }))).toBe(at('D'));
        expect(mmMilestone(obs({ text: AFTER_H }))).toBe(at('H'));
        expect(mmMilestone(obs({ text: AFTER_I }))).toBe(at('I'));
        expect(mmMilestone(obs({ text: AFTER_R, inv: [MM_OBJ.amulet], worn: [MM_OBJ.greegree] }))).toBe(at('R'));
        expect(mmMilestone(obs({ text: AFTER_S, worn: [MM_OBJ.amulet, MM_OBJ.greegree] }))).toBe(at('S'));
        expect(mmMilestone(obs({ text: AFTER_V, inv: [MM_OBJ.amulet, MM_OBJ.greegree] }))).toBe(at('V'));
        expect(mmMilestone(obs({ text: AFTER_W, inv: [MM_OBJ.sigil] }))).toBe(at('W'));
    });

    test('"seek audience with Awowogei" alone is not R: Garkor says it from need_correct_disguise on', () => {
        const before = `${CH3}||@str@Garkor wants me to seek audience with Awowogei, @str@pretending that I am an envoy||@dbl@I must disguise myself as a Karamjan monkey.`;
        expect(mmMilestone(obs({ text: before, inv: [MM_OBJ.amulet, MM_OBJ.greegree] }))).toBe(at('Q'));
    });

    test('items carry the milestone through chapter 2, where the journal has no new phrase', () => {
        expect(itemMilestone(obs({ inv: [MM_OBJ.dentures] }).state)).toBe(-1);
        expect(mmMilestone(obs({ text: AFTER_I, inv: [MM_OBJ.dentures] }))).toBe(at('I'));
        expect(mmMilestone(obs({ text: AFTER_I, inv: [MM_OBJ.dentures, MM_OBJ.amuletMould] }))).toBe(at('J'));
        // Zooknock took the dentures (story told): the mould alone still shows the cellar done.
        expect(mmMilestone(obs({ text: IN_L, inv: [MM_OBJ.amuletMould, MM_OBJ.goldBar] }))).toBe(at('J'));
        expect(mmMilestone(obs({ text: IN_L, inv: [MM_OBJ.enchantedBar, MM_OBJ.amuletMould] }))).toBe(at('L'));
        expect(mmMilestone(obs({ text: IN_L, inv: [MM_OBJ.amuletUnstrung] }))).toBe(at('L'));
        expect(mmMilestone(obs({ text: IN_L, inv: [MM_OBJ.amulet] }))).toBe(at('N'));
        expect(mmMilestone(obs({ text: IN_L, worn: [MM_OBJ.amulet], inv: [MM_OBJ.talisman] }))).toBe(at('O'));
    });

    test('monotone across consumption and the collapses', () => {
        // Route order of evidence; each later state must not fall below the earlier one.
        const route: Observed[] = [
            obs({ text: AFTER_A, inv: [MM_OBJ.royalSeal] }),
            obs({ text: AFTER_B, inv: [MM_OBJ.royalSeal] }),
            obs({ text: `${AFTER_B} @str@Narnode has given me some handwritten orders.`, inv: [MM_OBJ.royalSeal, MM_OBJ.orders] }),
            obs({ text: MID_E, inv: [MM_OBJ.royalSeal] }),
            obs({ text: `${MID_E.replace(/@dbl@I cannot.*$/, '')}||@str@I have completed reinitialisation.`, inv: [MM_OBJ.royalSeal] }),
            obs({ text: `${MID_E.replace(/@dbl@I cannot.*$/, '')}||@str@I have completed reinitialisation.||@str@Waydar and I landed our glider on a small island`, inv: [MM_OBJ.royalSeal] }),
            obs({ text: `${CH1_DONE}||@dre@Chapter 2:` }),
            obs({ text: AFTER_H }),
            obs({ text: AFTER_I }),
            obs({ text: AFTER_I, inv: [MM_OBJ.dentures, MM_OBJ.amuletMould] }),
            obs({ text: IN_L, inv: [MM_OBJ.amuletMould, MM_OBJ.goldBar] }),
            obs({ text: IN_L, inv: [MM_OBJ.amuletMould] }),
            obs({ text: IN_L, inv: [MM_OBJ.enchantedBar, MM_OBJ.amuletMould] }),
            obs({ text: IN_L, inv: [MM_OBJ.amuletUnstrung] }),
            obs({ text: IN_L, inv: [MM_OBJ.amulet] }),
            obs({ text: IN_L, worn: [MM_OBJ.amulet], inv: [MM_OBJ.talisman, MM_OBJ.monkeyBones] }),
            // Q gives the bones first, so the talisman is the last thing handed over.
            obs({ text: IN_L, worn: [MM_OBJ.amulet], inv: [MM_OBJ.talisman] }),
            obs({ text: CH3, worn: [MM_OBJ.amulet], inv: [MM_OBJ.greegree] }),
            obs({ text: AFTER_R, worn: [MM_OBJ.amulet, MM_OBJ.greegree] }),
            obs({ text: AFTER_S, worn: [MM_OBJ.amulet, MM_OBJ.greegree] }),
            obs({ text: AFTER_S, worn: [MM_OBJ.amulet], inv: [MM_OBJ.greegree, MM_OBJ.monkey] }),
            obs({ text: AFTER_V, worn: [MM_OBJ.amulet, MM_OBJ.greegree] }),
            obs({ text: AFTER_W, worn: [MM_OBJ.amulet], inv: [MM_OBJ.greegree, MM_OBJ.sigil] }),
            obs({ text: POST_DEMON, inv: [MM_OBJ.greegree] }),
            obs({ text: REPORTED }),
            obs({ status: 'complete', text: COMPLETE }),
            obs({ status: 'complete', text: TRAINED }),
        ];
        const ms = route.map(mmMilestone);
        for (let i = 1; i < ms.length; i++) expect([i, ms[i]! >= ms[i - 1]!]).toEqual([i, true]);
        expect(ms.at(-1)).toBe(at('Z'));
        expect(ms.at(-2)).toBe(at('Y'));
        expect(ms.at(-4)).toBe(at('X'));
    });

    test('the post-demon journal alone (items gone) is X; reported is still X; complete is Y', () => {
        expect(mmMilestone(obs({ text: POST_DEMON }))).toBe(at('X'));
        expect(mmMilestone(obs({ text: REPORTED }))).toBe(at('X'));
        expect(mmMilestone(obs({ status: 'complete', text: COMPLETE }))).toBe(at('Y'));
        // The quest tab alone (probe failed) still shows Y.
        expect(mmMilestone(obs({ status: 'complete' }))).toBe(at('Y'));
    });

    test('doneAt is milestone >= index', () => {
        const o = obs({ text: AFTER_I });
        expect(doneAt('H')(o)).toBe(true);
        expect(doneAt('I')(o)).toBe(true);
        expect(doneAt('J')(o)).toBe(false);
    });
});

describe("the aunt's loop", () => {
    test('house time left falls along the loop and is 0 in the house', async () => {
        const { AUNT_LOOP, auntWindowLeft, auntLoopAt, AUNT_BACK_IN } = await import('./monkey-madness');
        let prev = Infinity;
        for (const [x, z] of AUNT_LOOP) {
            const left = auntWindowLeft({ x, z });
            expect(left).toBeLessThanOrEqual(prev);
            prev = left;
        }
        expect(auntWindowLeft({ x: 2743, z: 2791 })).toBe(AUNT_BACK_IN - 2 - 1);
        expect(auntWindowLeft({ x: 2739, z: 2794 })).toBe(0);
        expect(auntLoopAt({ x: 2742, z: 2794 })).toBeNull(); // her first wait, inside
        expect(auntWindowLeft({ x: 2743, z: 2792 })).toBe(0); // her second wait, inside
    });
    test('the loop is contiguous: each tile departs when the next arrives, one step apart', async () => {
        const { AUNT_LOOP } = await import('./monkey-madness');
        for (let i = 1; i < AUNT_LOOP.length; i++) {
            const [x0, z0, , d0] = AUNT_LOOP[i - 1]!;
            const [x1, z1, a1] = AUNT_LOOP[i]!;
            expect(a1).toBe(d0);
            expect(Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0))).toBe(1);
        }
    });
});

describe('stepping away from the demon', () => {
    test('straight away from it, inside the arena', async () => {
        const { awayFrom, ARENA } = await import('./monkey-madness');
        expect(awayFrom({ x: 2720, z: 9180 }, { x: 2717, z: 9177 })).toEqual({ x: 2726, z: 9186 });
        // Against the arena's east edge the straight line is out: turn.
        const t = awayFrom({ x: 2748, z: 9180 }, { x: 2745, z: 9180 });
        expect(t.x).toBeGreaterThanOrEqual(ARENA.x0 + 2);
        expect(t.x).toBeLessThanOrEqual(ARENA.x1 - 2);
        expect(Math.max(Math.abs(t.x - 2745), Math.abs(t.z - 9180))).toBeGreaterThan(3);
    });
});

describe('exit', () => {
    const strength = (xp: number) => ({ name: 'Strength', level: 1, baseLevel: 1, experience: xp });
    const state = (inv: number[], worn: number[] = [], xp = 35_000) => baseState({
        inventory: inv.map((id, i) => item(id, i)),
        equipment: worn.map((id, i) => item(id, i)),
        skills: [strength(xp)],
    } as Partial<BotWorldState>);

    test('the exit drops are the seal, the mould and the sigil', () => {
        expect([...EXIT_DROPS].sort()).toEqual([MM_OBJ.royalSeal, MM_OBJ.amuletMould, MM_OBJ.sigil].sort());
    });

    test('the exit holds none of them, held or worn, and has the training xp', () => {
        expect(exitState(state([MM_OBJ.amulet, MM_OBJ.greegree]), {} as never)).toBe(true);
        for (const id of EXIT_DROPS) {
            expect(exitState(state([id]), {} as never)).toMatch(/S15's exit drops/);
            expect(exitState(state([], [id]), {} as never)).toMatch(/S15's exit drops/);
        }
        expect(exitState(state([], [], 34_999), {} as never)).toMatch(/below Daero/);
    });
});

describe("J: room for the crates' items", () => {
    const pack = (others: number, sharks: number) => baseState({
        inventory: [
            ...Array.from({ length: others }, (_, i) => item(2000 + i, i)),
            ...Array.from({ length: sharks }, (_, i) => item(MM_OBJ.shark, others + i)),
        ],
    } as Partial<BotWorldState>);
    const j = roomFor(MM_OBJ.dentures, MM_OBJ.amuletMould);

    test('a chain arrives with one free slot: the sharks eaten for room cover the rest', () => {
        expect(j(pack(12, 15), {} as never)).toBe(true);
    });

    test('refuses a full pack with no shark to eat', () => {
        expect(j(pack(28, 0), {} as never)).toMatch(/2 slots needed, 0 free and 0 sharks/);
    });
});

describe("O: room for the five picked bananas", () => {
    // `others` filler slots, `sharks` sharks and `bananas` bananas, each one slot.
    const pack = (others: number, sharks: number, bananas = 0) => baseState({
        inventory: [
            ...Array.from({ length: others }, (_, i) => item(2000 + i, i)),
            ...Array.from({ length: sharks }, (_, i) => item(MM_OBJ.shark, others + i)),
            ...Array.from({ length: bananas }, (_, i) => item(MM_OBJ.banana, others + sharks + i)),
        ],
    } as Partial<BotWorldState>);

    test('no drop with five free slots', () => {
        expect(bananaRoomDrops(pack(11, 12))).toBe(0);
    });

    test("a chain's arrival (one free slot) sets four sharks down", () => {
        expect(bananaRoomDrops(pack(15, 12))).toBe(4);
    });

    test('bananas already held count toward the five', () => {
        expect(bananaRoomDrops(pack(15, 10, 2))).toBe(2);
        expect(bananaRoomDrops(pack(15, 8, 5))).toBe(0);
    });

    test('refuses when the sharks cannot make the room', () => {
        expect(() => bananaRoomDrops(pack(26, 1))).toThrow(/no room for 5 bananas: 1 free and 1 sharks/);
    });
});

describe("Y: room for Narnode's reward", () => {
    const named = (name: string, slot: number, count = 1): InventoryItem => ({ slot, id: 1000 + slot, name, count, optionsWithIndex: [] });
    const pack = (n: number, coins: boolean) => baseState({
        inventory: [...(coins ? [named('Coins', 0, 30)] : []), ...Array.from({ length: n - (coins ? 1 : 0) }, (_, i) => named('Shark', i + 1))],
    } as Partial<BotWorldState>);
    const letters = SEGMENTS.map(d => d.letter);

    test('4 free slots with no coin stack held, 3 with one', () => {
        expect(slotNeed(pack(20, false), REWARD_ITEMS, letters, 'Y').slots).toBe(4);
        expect(slotNeed(pack(20, true), REWARD_ITEMS, letters, 'Y').slots).toBe(3);
    });

    test('the precondition passes and refuses on exactly those counts', () => {
        expect(yRoom(pack(24, false), {} as never)).toBe(true);
        expect(yRoom(pack(25, false), {} as never)).toMatch(/needs 4 free slots.*1 short/);
        expect(yRoom(pack(25, true), {} as never)).toBe(true);
        expect(yRoom(pack(26, true), {} as never)).toMatch(/needs 3 free slots/);
    });

    test('the mould and sigil held count as room: Y drops them before the reward', () => {
        const withDead = (n: number) => baseState({
            inventory: [
                ...Array.from({ length: n - 2 }, (_, i) => named('Shark', i)),
                item(MM_OBJ.amuletMould, n - 2), item(MM_OBJ.sigil, n - 1),
            ],
        } as Partial<BotWorldState>);
        expect(yRoom(withDead(26), {} as never)).toBe(true);
        expect(yRoom(withDead(27), {} as never)).toMatch(/needs 4 free slots/);
    });

    test('sharks count as room (J\'s rule): 1 short with 2 sharks drops 1 and proceeds; with no sharks or dead items it refuses', () => {
        const withSharks = (others: number, sharks: number) => baseState({
            inventory: [...Array.from({ length: others }, (_, i) => named('Rune', i)), ...Array.from({ length: sharks }, (_, i) => item(MM_OBJ.shark, others + i))],
        } as Partial<BotWorldState>);
        const s = withSharks(23, 2); // 25 held, 3 free, 4 needed
        expect(yRoom(s, {} as never)).toBe(true);
        expect(sharksToDrop(s, 4)).toBe(1);
        expect(sharksToDrop(withSharks(20, 2), 4)).toBe(0);
        expect(yRoom(withSharks(25, 0), {} as never)).toMatch(/needs 4 free slots/);
    });
});

describe('the zone prayer by location', () => {
    const MELEE = 'protect_from_melee';
    const MISSILES = 'protect_from_missiles';
    const AUNT_WAIT = { x: 2749, z: 2791 };

    test('the posted archers are exactly the map\'s mm_posted_archer spawns on level 0', () => {
        const root = join(import.meta.dir, '..', '..', 'server', 'content');
        const id = readFileSync(join(root, 'pack', 'npc.pack'), 'utf8').split('\n').map(l => l.split('=')).find(([, n]) => n?.trim() === 'mm_posted_archer')![0]!;
        const npcs = readFileSync(join(root, 'maps', 'm43_43.jm2'), 'utf8').split('==== NPC ====')[1]!.split('====')[0]!;
        const spawns = [...npcs.matchAll(/^(\d+) (\d+) (\d+): (\d+)/gm)].filter(m => m[4] === id).map(m => ({ level: Number(m[1]), x: 43 * 64 + Number(m[2]), z: 43 * 64 + Number(m[3]) }));
        expect(spawns.every(s => s.level === 0)).toBe(true);
        const key = (p: { x: number; z: number }) => `${p.x},${p.z}`;
        expect(spawns.map(key).sort()).toEqual(POSTED_ARCHERS.map(key).sort());
    });

    test('Melee beside a religious guard out of every posted archer\'s reach, and in the aunt\'s box; Missiles elsewhere', () => {
        // The temple ladder's foot, beside the guard at (2795,2775); the corridor south of the temple; the first floor.
        expect([tilePrayer({ x: 2794, z: 2774 }, 0), tilePrayer({ x: 2795, z: 2780 }, 0), tilePrayer({ x: 2797, z: 2785 }, 1)]).toEqual([MELEE, MELEE, MELEE]);
        // The 13:34 round's archer-sized hits under Melee: I at (2791,2770), J's NW edge, both in reach of a post.
        expect([tilePrayer({ x: 2791, z: 2770 }, 0), tilePrayer({ x: 2785, z: 2775 }, 0), tilePrayer({ x: 2784, z: 2772 }, 0)]).toEqual([MISSILES, MISSILES, MISSILES]);
        // The aunt's box: the wait tile and the child's tile; the town and the bamboo bridges (level 2, no guards).
        expect([tilePrayer(AUNT_WAIT, 0), tilePrayer({ x: 2743, z: 2795 }, 0), tilePrayer({ x: 2770, z: 2780 }, 0), tilePrayer({ x: 2790, z: 2790 }, 2)]).toEqual([MELEE, MELEE, MISSILES, MISSILES]);
    });

    test('the 11 no-dwell tiles are each in a guard\'s and an archer\'s reach, so walked under Missiles', () => {
        expect(NO_DWELL).toHaveLength(11);
        for (const t of NO_DWELL) {
            expect(RELIGIOUS_GUARDS[0]!.some(g => Math.max(Math.abs(g.x - t.x), Math.abs(g.z - t.z)) <= GUARD_REACH)).toBe(true);
            expect(POSTED_ARCHERS.some(a => Math.max(Math.abs(a.x - t.x), Math.abs(a.z - t.z)) <= ARCHER_REACH)).toBe(true);
            expect(tilePrayer(t, 0)).toBe(MISSILES);
        }
    });

    test('a walk\'s tiles step diagonally first, as the server walks, the start excluded', () => {
        expect(pathTiles({ x: 0, z: 0 }, [{ x: 3, z: 1 }])).toEqual([{ x: 1, z: 1 }, { x: 2, z: 1 }, { x: 3, z: 1 }]);
        expect(pathTiles({ x: 0, z: 0 }, [{ x: 0, z: 0 }])).toEqual([]);
    });

    test("O's walk to the wait tile is under Missiles: from the jail yard one run, from the temple Missiles once past the guards", () => {
        // From outside the cell (a knockout's way into the town): no guard near, and the wait tile's lone Melee tile is absorbed.
        expect(prayerRuns({ x: 2765, z: 2794 }, [AUNT_WAIT], 0)).toEqual([{ to: AUNT_WAIT, prayer: MISSILES, tiles: 16 }]);
        // From N's end at the temple ladder's foot: Melee beside the guards, then Missiles to the wait tile (gate chain b's death).
        const runs = prayerRuns({ x: 2794, z: 2774 }, [AUNT_WAIT], 0);
        expect(runs.map(r => r.prayer)).toEqual([MELEE, MISSILES]);
        expect(runs[1]!.to).toEqual(AUNT_WAIT);
        // The Melee run ends on a guard-reach tile: the switch to Missiles comes as the walk leaves the guards.
        expect(tilePrayer(runs[0]!.to, 0)).toBe(MELEE);
        expect(RELIGIOUS_GUARDS[0]!.some(g => Math.max(Math.abs(g.x - runs[0]!.to.x), Math.abs(g.z - runs[0]!.to.z)) <= GUARD_REACH)).toBe(true);
    });

    test('a walk inside the aunt\'s box (the wait tile to the child) is one Melee run; out of it (P\'s start), Missiles at once', () => {
        expect(prayerRuns(AUNT_WAIT, [{ x: 2743, z: 2795 }], 0).map(r => r.prayer)).toEqual([MELEE]);
        expect(tilePrayer({ x: AUNT_BOX.x1 + 1, z: AUNT_WAIT.z }, 0)).toBe(MISSILES);
        expect(prayerRuns(AUNT_WAIT, [{ x: 2770, z: 2780 }], 0).map(r => r.prayer)).toEqual([MISSILES]);
    });

    test('a run shorter than two tiles costs no switch', () => {
        for (const runs of [prayerRuns({ x: 2765, z: 2794 }, [AUNT_WAIT], 0), prayerRuns({ x: 2794, z: 2774 }, [AUNT_WAIT], 0)]) {
            expect(runs.every((r, i) => i === runs.length - 1 || r.tiles >= 2)).toBe(true);
            expect(runs.every((r, i) => i === 0 || r.prayer !== runs[i - 1]!.prayer)).toBe(true);
        }
    });

    test('unsplit legs: Melee when any run is (K\'s roof walk on floor 1), Missiles on the bridges', () => {
        expect(legPrayerFor({ x: 2787, z: 2795 }, { x: 2794, z: 2774 }, 1)).toBe(MELEE);
        expect(legPrayerFor({ x: 2786, z: 2793 }, { x: 2787, z: 2795 }, 2)).toBe(MISSILES);
    });
});

describe("J: the crate building's steps", () => {
    const DENTURES_EAST = { x: 2768, z: 2769 };
    test('from inside the south door: east along z 2764, up x 2770, then the ruled (2770,2768) -> (2769,2769) -> (2768,2769)', () => {
        const steps = crateSteps({ x: 2764, z: 2764 }, crateRoute({ x: 2764, z: 2764 }, DENTURES_EAST));
        expect(steps.slice(0, 6)).toEqual([2765, 2766, 2767, 2768, 2769, 2770].map(x => ({ x, z: 2764 })));
        expect(steps.slice(-3)).toEqual([{ x: 2770, z: 2768 }, { x: 2769, z: 2769 }, DENTURES_EAST]);
        expect(steps.every((t, i) => Math.max(Math.abs(t.x - (steps[i - 1] ?? { x: 2764 }).x), Math.abs(t.z - (steps[i - 1] ?? { z: 2764 }).z)) === 1)).toBe(true);
        // On to the hole crate from the dentures by the x 2770 spine: (2769,2767) holds the thread crate.
        const hole = crateSteps(DENTURES_EAST, crateRoute(DENTURES_EAST, { x: 2769, z: 2766 }));
        expect(hole).toEqual([{ x: 2769, z: 2769 }, { x: 2770, z: 2769 }, { x: 2770, z: 2768 }, { x: 2770, z: 2767 }, { x: 2770, z: 2766 }, { x: 2769, z: 2766 }]);
        expect(hole.some(t => t.x === 2769 && t.z === 2767)).toBe(false);
    });

    test("refuses a step into the Sleeping Monkey's zone (x 2762-2767, z 2767-2772)", () => {
        expect(SLEEPING_ZONE).toMatchObject({ x0: 2762, z0: 2767, x1: 2767, z1: 2772 });
        expect(() => crateSteps(DENTURES_EAST, [{ x: 2766, z: 2769 }])).toThrow(/Sleeping Monkey's zone at 2767,2769/);
    });

    test("a human walk crossing the zone goes by the corner nearest its goal whose own route keeps out", () => {
        // North-east of the building, bound for the bridge ladder, on a route through it (straight routes here).
        const from = { x: 2772, z: 2780 }, to = { x: 2803, z: 2735 };
        expect(entersSleepingZone(from, [{ x: 2763, z: 2760 }])).toBe(true);
        const straight = (p: { x: number; z: number }) => [p];
        expect(sleepingDetour(from, to, straight)).toEqual({ x: 2771, z: 2763 });
        // With the south-east corner's route crossing the zone too, the north-east one.
        const viaZone = (p: { x: number; z: number }) => (p.x === 2771 && p.z === 2763 ? [{ x: 2765, z: 2770 }, p] : [p]);
        expect(sleepingDetour(from, to, viaZone)).toEqual({ x: 2775, z: 2774 });
        expect(SLEEPING_DETOURS.every(d => !entersSleepingZone(d, [d]))).toBe(true);
    });
});

describe('the atoll top-ups (H12o)', () => {
    const P_ROW = { want: [{ item: /^Shark$/i, amount: 9 }, { item: /^Superantipoison\(4\)$/i, amount: 1 }], slots: 10 };
    const held = (n: number) => baseState({ inventory: Array.from({ length: n }, (_, i) => item(MM_OBJ.shark, i)) } as Partial<BotWorldState>);

    test('off by default: no option, no top-up', () => {
        expect(resolveOptions().topUpFrom).toBeUndefined();
    });

    test("P's row is refused, with the reason, when the pack lacks the slots; M's is the free slots less one", () => {
        expect(topUpRefusal(held(18), P_ROW, 'helper')).toBeNull();
        expect(topUpRefusal(held(19), P_ROW, 'helper')).toMatch(/needs 10 free slots, 9 free/);
        expect(pLegSize(P_ROW, 'helper')(held(19))).toMatch(/9 free/);
        expect([mTopUpSharks(held(20)), mTopUpSharks(held(27)), mTopUpSharks(held(28))]).toEqual([7, 0, 0]);
        expect(mLegSize(held(26))).toEqual({ want: [{ item: /^Shark$/i, amount: 1 }] });
        expect(mLegSize(held(27))).toMatch(/no free slot to spare/);
        expect(M_TOPUP_TILE).toEqual({ x: 2763, z: 2704 });
    });

    const me = (anim: number, x = 2803) => ({ name: 'scored', x, z: 2724, worldX: x, worldZ: 2724, level: 0, hp: 30, maxHp: 42, animId: anim }) as unknown as PlayerState;
    const helper = { kind: 'player', index: 7, name: 'Helper', combatLevel: 60, x: 2802, z: 2724 } as BotWorldState['nearbyPlayers'][number];
    const start = (o: { anim?: number; helperInView?: boolean } = {}) =>
        new FakeSdk(baseState({ tick: 1, player: me(o.anim ?? -1), nearbyPlayers: o.helperInView === false ? [] : [helper], inventory: [item(MM_OBJ.shark, 0)] } as Partial<BotWorldState>));
    const okReceive = { ok: true, ticks: 4, received: [{ slot: -1, id: MM_OBJ.shark, name: 'Shark', count: 9 }] } as ReceiveResult;
    const stub = (results: ReceiveResult[]) => {
        const calls: Array<{ tick: number; noReplyTicks?: number; want: unknown }> = [];
        const receive: Receive = async (sdk, _p, opts) => {
            calls.push({ tick: sdk.getState()!.tick, noReplyTicks: opts.noReplyTicks, want: opts.want });
            return results[Math.min(calls.length - 1, results.length - 1)]!;
        };
        return { calls, receive };
    };

    test('SCORED is idle for a trade click only standing still, with no animation, chat, modal or trade open', () => {
        const s = (tick: number, o: Partial<BotWorldState> & { anim?: number; x?: number } = {}) => baseState({ tick, player: me(o.anim ?? -1, o.x), ...o } as Partial<BotWorldState>);
        expect(tradeIdle(s(1), s(2))).toBe(true);
        expect(tradeIdle(null, s(2))).toBe(false);
        expect(tradeIdle(s(2), s(2))).toBe(false);
        expect(tradeIdle(s(1, { anim: 829 }), s(2))).toBe(false); // the drink on the landing tick (gate chain a)
        expect(tradeIdle(s(1, { x: 2802 }), s(2))).toBe(false);
        expect(tradeIdle(s(1), s(2, { modalOpen: true }))).toBe(false);
        expect(tradeIdle(s(1), s(2, { dialog: { isOpen: true, options: [], isWaiting: false } }))).toBe(false);
        expect(tradeIdle(s(1), s(2, { trade: { isOpen: true, screen: 'offer', partner: 'Helper', myOffer: [], theirOffer: [], myAccepted: false, partnerAccepted: false } } as Partial<BotWorldState>))).toBe(false);
    });

    test('waits for SCORED to be idle (a drink in progress), then accepts, re-sending a dropped click at once beside the helper', async () => {
        const lines: string[] = [];
        setStepNote(l => lines.push(l));
        const sdk = start({ anim: 829 });
        const { calls, receive } = stub([okReceive]);
        const r = await drive(sdk, receiveLeg(sdk as never, 'Helper', 'P', pLegSize(P_ROW, 'Helper'), receive), 100, s => ({ player: me(s.tick < 4 ? 829 : -1) }));
        expect(r).toMatchObject({ ok: true, attempts: 1, received: '9 Shark' });
        expect(calls).toHaveLength(1);
        expect(calls[0]!.tick).toBeGreaterThanOrEqual(5);
        expect(calls[0]!.noReplyTicks).toBe(2);
        expect(lines.some(l => /S15:P top-up from Helper: attempt 1/.test(l))).toBe(true);
    });

    test('one bounded retry after a failed trade', async () => {
        const lines: string[] = [];
        setStepNote(l => lines.push(l));
        const sdk = start();
        const { calls, receive } = stub([{ ok: false, ticks: 0, received: [], reason: 'no_response' }, okReceive]);
        const r = await drive(sdk, receiveLeg(sdk as never, 'Helper', 'M', mLegSize, receive), 100);
        expect(r).toMatchObject({ ok: true, attempts: 2 });
        expect(calls).toHaveLength(2);
        expect(lines.some(l => /attempt 1 of 2: no_response; SCORED at the click: idle/.test(l))).toBe(true);
    });

    test('moves on without the top-up after the second failure, with the helper out of view, or with no room, never throwing', async () => {
        const lines: string[] = [];
        setStepNote(l => lines.push(l));
        let sdk = start();
        let s = stub([{ ok: false, ticks: 0, received: [], reason: 'closed' }]);
        expect(await drive(sdk, receiveLeg(sdk as never, 'Helper', 'P', pLegSize(P_ROW, 'Helper'), s.receive), 100)).toMatchObject({ ok: false, attempts: TOPUP_TRIES, reason: 'closed' });
        expect(s.calls).toHaveLength(TOPUP_TRIES);
        expect(lines.at(-1)).toMatch(/S15:P top-up from Helper: moving on without it after 2 attempt\(s\)/);

        sdk = start({ helperInView: false });
        s = stub([okReceive]);
        const r = await drive(sdk, receiveLeg(sdk as never, 'Helper', 'P', pLegSize(P_ROW, 'Helper'), s.receive), 100);
        expect(r).toMatchObject({ ok: false, attempts: 0 });
        expect(r.ticks).toBeGreaterThanOrEqual(TOPUP_WAIT);
        expect(s.calls).toHaveLength(0);

        sdk = new FakeSdk(baseState({ tick: 1, player: me(-1), nearbyPlayers: [helper], inventory: Array.from({ length: 27 }, (_, i) => item(MM_OBJ.shark, i)) } as Partial<BotWorldState>));
        s = stub([okReceive]);
        expect(await drive(sdk, receiveLeg(sdk as never, 'Helper', 'M', mLegSize, s.receive), 100)).toMatchObject({ ok: false, attempts: 0, reason: expect.stringMatching(/no free slot/) });
        expect(s.calls).toHaveLength(0);
    });
});
