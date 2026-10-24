import { beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { findLongPath } from '../../sdk/pathfinding';
import { nameHash, readCue, readTopUpAsk } from '../helpers/altar-cue';

import type { BotWorldState, InventoryItem, PlayerState, QuestJournalState } from '../../sdk/types';
import { baseState, drive, FakeSdk, FakeTradePartner, flush, simulateWalking } from '../lib/fake-sdk';
import { askFor, handOffFrom } from '../runner/handoff';
import type { ReceiveResult } from '../lib/trade';
import { compactJournal } from '../lib/quests';
import { wield } from '../lib/act';
import { Observation, resolveResume } from '../runner/resume';
import type { Observed, RunnerSession } from '../runner/step';
import {
    BANANA_TREE_IDS, bananaRoomDrops, cureBeforeSwap, dropDead, preDose, gtSwap, h12Plan, h12Wants, kitMissing, LOST_SEAL, narnodeTalk, DEFAULT_OPTIONS, roomFor, doneAt, EXIT_DROPS, exitState, h12Kit, H12_POTIONS, H12_SHARKS, waydarIntroWatch, itemMilestone, setStepNote, talkableNpc, JOURNAL_MARKS, JOURNAL_PROBE, journalMilestone, MM_OBJ, mmMilestone, PUZZLE_TILE_IDS,
    BELOW_30_EATING, cureWanted, eatBelowFor, sharksToDrop, GARKOR_WEST, isMonkeyChatter, CAGE, CAGE_NORTH_STRIP, CAGE_TILES, inCage, letOut, letOutPick, LET_OUT_ATTEMPTS, MINDER_REACH, nearestFire, sceneBuilt, tileIn, underTemple, scorpionsNear, SCORPION_CLOSE, SCORPION_REACH, sigilRoom, h12oLeg, legCue, pFinalStop, closeLeftTrade, DECLINE_TICKS, H12O_M_ROW, mTopUpCap, ASK_SHARK, ASK_SUPER_ANTIPOISON, H12O_SCOPE, onTradeOpen, P_TOPUP_MAX_SHARKS, pTopUpAsk, immunityWanted,
    AREAS, inArea, inCell, zooknockWay, type ZooknockLegs, CHAT_DRINK_FLOOR, DRINK_BELOW, packClickAllowed, upkeep, X_PRAYER,
    ARCHER_REACH, AUNT_BOX, crateRoute, crateSteps, entersSleepingZone, SLEEPING_DETOURS, sleepingDetour, GUARD_REACH, legPrayerFor, M_TOPUP_TILE, mLegSize, mTopUpSharks, NO_DWELL, pathTiles, pLegSize, POSTED_ARCHERS, prayerRuns, receiveLeg, RELIGIOUS_GUARDS, SLEEPING_ZONE, tilePrayer, TOPUP_TRIES, TOPUP_WAIT, tradeIdle, type Receive, nextBananaTree, SUPER_IMMUNE_TICKS, offAtoll, patrolLeavesLane, SEGMENT_EATING, topUpWanted, resolveOptions, REWARD_ITEMS, seg, segmentName, SEGMENTS, stepId, steps, templeLeft, treeRouteRefusal, yRoom, type MmContext,
} from './monkey-madness';
import { noteAntipoison, slotNeed } from './segments';
import { objPack } from '../lib/obj-pack';
import { MANIFEST } from '../tools/slot-ledger';
import { planMuleDeliveryFixtures, type FixtureItem } from '../lab/mule-delivery-fixtures';

// The run's antipoison record (segments.ts noteAntipoison) is module state: no test inherits another's dose.
beforeEach(() => noteAntipoison(-Infinity));

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

/** A poison tick on the player, as the collector publishes it (hitmark 2). */
const poisonHit = (tick: number) => ({ tick, type: 'damage_taken', damage: 2, hitmark: 2, sourceType: 'npc', sourceIndex: -1, targetType: 'player', targetIndex: -1 }) as BotWorldState['combatEvents'][number];

describe('antipoison cures', () => {
    const at = (o: { tick?: number; hitAt?: number; lastDose?: number }) =>
        cureWanted(baseState({ tick: o.tick ?? 1000, combatEvents: o.hitAt === undefined ? [] : [poisonHit(o.hitAt)] }), o.lastDose ?? -Infinity);

    test('a poison that is on is cured once, in any segment, one carried into it included', () => {
        expect(at({ hitAt: 1000 })).toBe(true);
        expect(at({ hitAt: 975 })).toBe(true); // carried in: its last hit before upkeep's first look, no message
        expect(at({ hitAt: 1000, lastDose: 1000 })).toBe(false); // cured this tick
        expect(at({ hitAt: 900, lastDose: 950 })).toBe(false); // a later dose covered it
        expect(at({ hitAt: 960 })).toBe(false); // 40 ticks without a hit: worn off
        expect(at({ hitAt: 999, lastDose: 998 })).toBe(false); // never within 3 ticks of a dose
        expect(at({})).toBe(false);
        expect(at({ tick: 36, hitAt: 32, lastDose: 37 })).toBe(true); // a dose from before a client reload (the tick restarts at 0)
    });
});

describe('upkeep holds its pack clicks while a chat is open (a pack click closes the talk)', () => {
    const MELEE = 9; // protect_from_melee in PRAYER_NAMES order
    const melee = () => Array.from({ length: 15 }, (_, i) => i === MELEE);
    const drinkable = (slot: number, name: string): InventoryItem => ({ slot, id: 0, name, count: 1, optionsWithIndex: [{ text: 'Drink', opIndex: 1 }] });
    const page = { isOpen: true, options: [], isWaiting: false, allComponents: [{ text: 'Has Aunty given you the toy yet?' }] } as unknown as BotWorldState['dialog'];
    const closed = { isOpen: false, options: [], isWaiting: false } as BotWorldState['dialog'];
    const pp = (n: number) => ({ activePrayers: melee(), prayerPoints: n, prayerLevel: 94 });
    beforeEach(() => noteAntipoison(-Infinity));

    /** Upkeep running on scripted state from `tick`, `pp` points under Protect from Melee; `end` stops it. */
    async function running(o: { tick: number; points: number; inventory: InventoryItem[]; extra?: Partial<BotWorldState> }) {
        const sdk = new FakeSdk(baseState({ tick: o.tick, autoRetaliateEnabled: false, prayers: pp(o.points), inventory: o.inventory, player: { hp: 42 } as PlayerState, ...o.extra }));
        let end!: () => void;
        const done = upkeep(sdk as never, () => new Promise<void>(r => (end = r)));
        await flush();
        const uses = () => sdk.sent.filter(a => a.method === 'sendUseItem' || a.method === 'sendDropItem');
        return { sdk, uses, stop: async () => { end(); await done; } };
    }

    test('the gate: shut while a chat page is open', () => {
        expect(packClickAllowed({ dialog: page })).toBe(false);
        expect(packClickAllowed({ dialog: closed })).toBe(true);
        expect(CHAT_DRINK_FLOOR).toBeLessThan(DRINK_BELOW);
    });

    test("rs/513 chain 1's O: the child's page opens as prayer falls to 19; no drink until the chat closes, then one", async () => {
        const u = await running({ tick: 2134, points: 20, inventory: [drinkable(6, 'Prayer potion(3)')] });
        u.sdk.tick({ prayers: pp(19), dialog: page }); // t=2135: the page and the crossing in one tick
        await flush();
        expect(u.uses()).toEqual([]);
        u.sdk.tick({ dialog: page });
        u.sdk.tick({ prayers: pp(18), dialog: page });
        await flush();
        expect(u.uses()).toEqual([]);
        u.sdk.tick({ dialog: closed });
        await flush();
        expect(u.uses()).toEqual([{ method: 'sendUseItem', args: [6, 1] }]);
        expect(u.sdk.state!.tick).toBe(2138);
        await u.stop();
    });

    test('a chat still open at the floor gets the drink: only a stuck chat holds prayer that long', async () => {
        const u = await running({ tick: 500, points: 20, inventory: [drinkable(3, 'Prayer potion(4)')] });
        u.sdk.tick({ prayers: pp(CHAT_DRINK_FLOOR), dialog: page });
        await flush();
        expect(u.uses()).toEqual([]);
        u.sdk.tick({ prayers: pp(CHAT_DRINK_FLOOR - 1), dialog: page });
        await flush();
        expect(u.uses()).toEqual([{ method: 'sendUseItem', args: [3, 1] }]);
        await u.stop();
    });

    test('a poisoning during a chat: the antipoison waits for the chat to close, inside the cure window', async () => {
        const u = await running({ tick: 10_000, points: 60, inventory: [drinkable(4, 'Superantipoison(3)')] });
        u.sdk.tick(s => ({ dialog: page, gameMessages: [{ type: 0, text: 'You have been poisoned!', tick: s.tick + 1, sender: '', fromSelf: false }] }));
        u.sdk.tick({ dialog: page });
        await flush();
        expect(u.uses()).toEqual([]);
        u.sdk.tick({ dialog: closed });
        await flush();
        expect(u.uses()).toEqual([{ method: 'sendUseItem', args: [4, 1] }]);
        await u.stop();
    });

    test('a poison carried in (its last hit before upkeep started, no message) is cured on the first state, once', async () => {
        const u = await running({ tick: 3000, points: 60, inventory: [drinkable(5, 'Superantipoison(4)')], extra: { combatEvents: [poisonHit(2990)] } });
        u.sdk.tick();
        await flush();
        u.sdk.tick();
        u.sdk.tick();
        await flush();
        expect(u.uses()).toEqual([{ method: 'sendUseItem', args: [5, 1] }]);
        await u.stop();
    });

    test('the first poison hitsplat in a clean stretch gets the dose (no message needed)', async () => {
        const u = await running({ tick: 4000, points: 60, inventory: [drinkable(5, 'Superantipoison(4)')] });
        u.sdk.tick();
        await flush();
        expect(u.uses()).toEqual([]);
        u.sdk.tick(s => ({ combatEvents: [poisonHit(s.tick + 1)] }));
        await flush();
        expect(u.uses()).toEqual([{ method: 'sendUseItem', args: [5, 1] }]);
        await u.stop();
    });

    test('an empty vial is dropped only once the chat closes', async () => {
        const u = await running({ tick: 700, points: 60, inventory: [{ slot: 8, id: 229, name: 'Vial', count: 1, optionsWithIndex: [] }] });
        u.sdk.tick({ dialog: page });
        u.sdk.tick({ dialog: page });
        await flush();
        expect(u.uses()).toEqual([]);
        u.sdk.tick({ dialog: closed });
        await flush();
        expect(u.uses()).toEqual([{ method: 'sendDropItem', args: [8] }]);
        await u.stop();
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
        expect(immunityWanted(100, 500, true)).toBe(true); // a dose from before a client reload covers nothing
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

    test('the intro opens on a chat page and holds no state page, so its first close is its end', () => {
        const src = readFileSync(join(scripts, 'mm_waydar.rs2'), 'utf8');
        const intro = src.slice(src.indexOf('case ^mm_not_started :'), src.indexOf('[label,waydar_lumdo]'));
        expect(intro.split('\n')[1]).toMatch(/~chatplayer\(/);
        expect(intro).not.toMatch(/p_delay|fade|p_teleport|inv_(add|del)/);
        expect(lines('mm_waydar.rs2').filter(l => l === 'Of course.')).toHaveLength(1);
    });

    const page = (kind: 'continue' | 'choice', isWaiting = false) => ({
        dialog: kind === 'continue'
            ? { isOpen: true, isWaiting, options: [{ index: 1, text: 'Click here to continue', buttonType: 6, componentId: 1 }] }
            : { isOpen: true, isWaiting, options: ['What shall we do now?', 'I cannot convince Lumdo to take us to the island...'].map((text, i) => ({ index: i + 1, text, buttonType: 1, componentId: 2 + i })) },
    });
    const shut = { dialog: { isOpen: false, isWaiting: false, options: [] } };

    test('the intro, page by page or burst with only its first page published, is over at its close', () => {
        for (const seen of [[page('continue'), page('continue', true), page('continue'), page('continue'), shut], [page('continue'), shut]]) {
            const w = waydarIntroWatch();
            for (const s of seen.slice(0, -1)) w.see(s as never);
            expect(w.over).toBe(false);
            w.see(seen.at(-1) as never);
            expect(w.over).toBe(true);
        }
    });

    test('a talk that opens on the menu is never the intro, through the cutscene\'s closed fade', () => {
        const w = waydarIntroWatch();
        for (const s of [shut, page('choice'), page('continue'), shut, page('continue'), shut]) w.see(s as never);
        expect(w.over).toBe(false);
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


describe("the backpack monkey's chatter, and the minder's let-out from the cage (T, U)", () => {
    const page = (...texts: string[]) => ({ allComponents: texts.map(text => ({ text })) }) as never;

    test('every page of the chatter is chatter, the snore\'s player page too; an NPC\'s page is not', () => {
        expect(isMonkeyChatter(page('The monkey in your backpack...', "I'm hungry!", 'Click here to continue'))).toBe(true);
        // The snore's middle page as the lab traced it: the player's name, the line, the continue.
        expect(isMonkeyChatter(page('Mmlab201', 'The what?', 'Click here to continue'))).toBe(true);
        expect(isMonkeyChatter(page('Waydar', 'Shall we return to Crash Island?', 'Click here to continue'))).toBe(false);
        expect(isMonkeyChatter(page('Mmlab201', 'The what? No, the where.', 'Click here to continue'))).toBe(false);
    });

    const npc = (index: number, x: number, z: number) =>
        ({ kind: 'npc', id: 1, index, name: 'Monkey Minder', combatLevel: 1, x, z, tileX: x, tileZ: z, size: 1, distance: 3, hp: null, maxHp: null, healthPercent: null, targetIndex: -1, inCombat: false, optionsWithIndex: [{ text: 'Talk-to', opIndex: 1 }], options: ['Talk-to'] }) as never;
    const me = (x: number, z: number) => ({ worldX: x, worldZ: z, level: 0, x, z, hp: 42, maxHp: 42 }) as never;
    const at = (x: number, z: number, ...n: never[]) => baseState({ player: me(x, z), nearbyNpcs: n });
    // What stands inside the railing (maps/m40_51.jm2): the trees' 2x2 footprints (jungletree1 at (2599,3277) and
    // (2602,3276), jungletree2 at (2604,3278) and (2598,3275)), the walled post at (2602,3278), the bridge supports.
    const BLOCKED = new Set([
        '2599,3277', '2600,3277', '2599,3278', '2600,3278', '2602,3276', '2603,3276', '2602,3277', '2603,3277',
        '2604,3278', '2605,3278', '2604,3279', '2605,3279', '2598,3275', '2599,3275', '2598,3276', '2599,3276',
        '2602,3278', '2602,3281', '2605,3281',
    ]);
    const standable = (t: { x: number; z: number }) => !BLOCKED.has(`${t.x},${t.z}`);

    test('the cage tiles: the four zones the minder tests, each tile once (59)', () => {
        expect(CAGE_TILES.length).toBe(59);
        expect(new Set(CAGE_TILES.map(t => `${t.x},${t.z}`)).size).toBe(59);
        expect(CAGE_TILES.every(t => CAGE.some(a => tileIn({ ...t, level: 0 }, a)))).toBe(true);
        expect(CAGE_TILES.filter(t => tileIn({ ...t, level: 0 }, CAGE_NORTH_STRIP)).length).toBe(6);
    });

    test("from forced T run 2's tile, a minder the north strip reaches is asked from the strip", () => {
        // Run 2 stood on (2603,3278) between the post, a tree and a trunk for all nine clicks.
        const p = letOutPick(at(2603, 3278, npc(5987, 2608, 3279)), standable)!;
        expect({ index: p.minder.index, stand: p.stand, distance: p.distance }).toEqual({ index: 5987, stand: { x: 2605, z: 3280 }, distance: 3 });
        // North: the strip's nearest standable tiles, never the bridge support at (2605,3281).
        const n = letOutPick(at(2603, 3278, npc(7, 2604, 3285)), standable)!;
        expect(tileIn({ ...n.stand, level: 0 }, CAGE_NORTH_STRIP) && standable(n.stand) && n.distance).toBe(4);
    });

    test('a minder out of the strip\'s reach is asked from the nearest standable cage tile', () => {
        const p = letOutPick(at(2604, 3281, npc(3, 2596, 3273)), standable)!;
        expect({ stand: p.stand, distance: p.distance }).toEqual({ stand: { x: 2598, z: 3274 }, distance: 2 });
        // The nearest tile when blocked is passed over: with (2598,3274) unstandable, the next nearest.
        const q = letOutPick(at(2604, 3281, npc(3, 2596, 3273)), t => standable(t) && !(t.x === 2598 && t.z === 3274))!;
        expect(q.stand).not.toEqual({ x: 2598, z: 3274 });
        expect(q.distance).toBe(3);
    });

    test('the minder that refused is passed over; none in reach of any standable tile is no pick', () => {
        const two = at(2603, 3278, npc(1, 2608, 3279), npc(2, 2604, 3285));
        expect(letOutPick(two, standable)?.minder.index).toBe(1);
        expect(letOutPick(two, standable, 1)?.minder.index).toBe(2);
        expect(letOutPick(at(2603, 3278, npc(1, 2608, 3279)), standable, 1)).toBeNull();
        expect(letOutPick(at(2603, 3278, npc(1, 2606 + MINDER_REACH + 1, 3279)), standable)).toBeNull();
        expect(letOutPick(at(2603, 3278, npc(1, 2608, 3279)), () => false)).toBeNull();
    });

    /**
     * The cage on a FakeSdk: the player runs between cage tiles, and a click on a minder in `answers` opens its page,
     * whose continue lets the player out beside it (mm_monkey_minder.rs2:13-25); any other click opens nothing, as a
     * minder with no line of sight.
     */
    function cage(o: { x: number; z: number; minders: never[]; answers: number[]; inv?: number[]; worn?: number[] }) {
        const sdk = new FakeSdk(baseState({
            tick: 1, player: me(o.x, o.z), nearbyNpcs: o.minders, inventory: (o.inv ?? []).map((id, i) => item(id, i)), equipment: (o.worn ?? []).map((id, i) => item(id, i)),
        } as Partial<BotWorldState>));
        sdk.pathTo = (x, z) => ({ success: true, waypoints: [{ x, z, level: 0 }], reachedDestination: standable({ x, z }) });
        // The walk is the server's (it routes round the trees); the sim only moves the player there.
        const walk = simulateWalking(sdk);
        const asked: Array<{ index: number; from: { x: number; z: number }; tick: number }> = [];
        let next: 'page' | 'out' | null = null;
        const prev = sdk.onSend;
        sdk.onSend = (a, f) => {
            prev(a, f);
            const p = f.state!.player!;
            if (a.method === 'sendInteractNpc') {
                asked.push({ index: a.args[0] as number, from: { x: p.worldX, z: p.worldZ }, tick: f.state!.tick });
                if (o.answers.includes(a.args[0] as number)) next = 'page';
            } else if (f.state!.dialog.isOpen && /^(sendClickDialog|clickDialogByText|sendClickComponent)$/.test(a.method)) next = 'out';
        };
        const each = (s: BotWorldState): Partial<BotWorldState> => {
            const n = next;
            next = null;
            if (n === 'page') {
                return { dialog: { isOpen: true, isWaiting: false, pageId: 'minder', options: [{ index: 1, text: 'Click here to continue', buttonType: 6, componentId: 10 }], allComponents: [{ text: 'Monkey Minder' }, { text: 'My word - what are you doing in there?' }, { text: 'Click here to continue' }] } as never };
            }
            if (n === 'out') {
                walk.target = null;
                return { dialog: { isOpen: false, options: [], isWaiting: false }, player: { ...s.player!, worldX: 2609, worldZ: 3281, x: 2609, z: 3281 } };
            }
            return {};
        };
        return { sdk, asked, each };
    }

    test('a refusal is recovered: the refusing minder is passed over, the next asked after a step to its tile', async () => {
        const notes: string[] = [];
        setStepNote(l => notes.push(l));
        const { sdk, asked, each } = cage({ x: 2603, z: 3278, minders: [npc(1, 2608, 3279), npc(2, 2604, 3285)], answers: [2] });
        await drive(sdk, letOut({ sdk } as never), 300, each);
        expect(inCage(sdk.getState()!)).toBe(false);
        const firstOf = (i: number) => asked.find(a => a.index === i)!;
        expect(asked[0]!.index).toBe(1);
        expect(firstOf(1).from).toEqual({ x: 2605, z: 3280 });
        expect(firstOf(2).from).toEqual({ x: 2604, z: 3281 });
        expect(firstOf(2).tick).toBeGreaterThan(firstOf(1).tick);
        expect(notes.filter(l => /let-out \d: minder #\d at \d+,\d+, distance \d from \d+,\d+/.test(l)).length).toBe(2);
        expect(notes.some(l => /let-out 1: minder #1 .*refused/.test(l))).toBe(true);
        expect(notes.at(-1)).toMatch(/out after 2 attempts in \d+ ticks/);
        setStepNote(() => {});
    });

    test('every minder refusing: at most LET_OUT_ATTEMPTS clicks, then the throw', async () => {
        const { sdk, asked, each } = cage({ x: 2603, z: 3278, minders: [npc(1, 2608, 3279), npc(2, 2604, 3285)], answers: [] });
        const err = await drive(sdk, letOut({ sdk } as never), 400, each).then(() => null, e => (e as Error).message);
        expect(err).toMatch(/did not let the player out: 5 attempts/);
        expect(asked.length).toBeLessThanOrEqual(LET_OUT_ATTEMPTS * 2); // ClickGuard may re-send an unanswered post-step click once
        expect(new Set(asked.map(a => a.index))).toEqual(new Set([1, 2]));
    });

    test('U entered from the cage (a re-run after T threw there) lets the player out before anything else', async () => {
        const { sdk, asked, each } = cage({
            x: 2603, z: 3278, minders: [npc(2, 2604, 3285)], answers: [2], inv: [MM_OBJ.monkey, MM_OBJ.greegree], worn: [MM_OBJ.amulet],
        });
        const u = steps()[seg('U')]!;
        expect(u.preconditions(sdk.getState()!, {} as MmContext)).toBe(true);
        await drive(sdk, u.run({ sdk, bot: { walkTo: async () => ({ success: false, message: 'test' }) } } as never), 120, each).catch(() => undefined);
        const firstAway = sdk.sent.findIndex(a => a.method === 'sendWalk' && !CAGE_TILES.some(t => t.x === a.args[0] && t.z === a.args[1]));
        const firstAsk = sdk.sent.findIndex(a => a.method === 'sendInteractNpc');
        expect(asked[0]?.index).toBe(2);
        expect(firstAsk).toBeGreaterThanOrEqual(0);
        if (firstAway >= 0) expect(firstAsk).toBeLessThan(firstAway);
        expect(inCage(sdk.getState()!)).toBe(false);
    });

    test('the re-run after a throw in the cage enters U (the monkey held proves T done)', async () => {
        const s = baseState({ quests: { mm: 'started' }, player: me(2603, 3278), inventory: [MM_OBJ.monkey, MM_OBJ.greegree].map((id, i) => item(id, i)), equipment: [item(MM_OBJ.amulet)] } as Partial<BotWorldState>);
        const p = await resolveResume(steps(), new Observation(s, { [JOURNAL_PROBE]: async () => journal(AFTER_S) }, {} as RunnerSession), {} as MmContext);
        expect({ step: p.step, mode: p.mode }).toEqual({ step: 'S15:U-return', mode: 'run' });
    });
});

describe("N's start under the temple", () => {
    const nStage = (x: number, z: number, worn: number[] = []) => baseState({
        quests: { mm: 'started' }, player: { worldX: x, worldZ: z, level: 0, x, z, hp: 42 } as never,
        inventory: [MM_OBJ.enchantedBar, MM_OBJ.amuletMould, MM_OBJ.ballOfWool].map((id, i) => item(id, i)), equipment: worn.map((id, i) => item(id, i)),
    } as Partial<BotWorldState>);

    test("N's preconditions admit the atoll's surface and the trapdoor's landing, and refuse the dungeon", () => {
        const n = steps()[seg('N')]!;
        expect(underTemple(nStage(2807, 9201))).toBe(true);
        expect(n.preconditions(nStage(2807, 9201), {} as MmContext)).toBe(true);
        expect(n.preconditions(nStage(2794, 2774), {} as MmContext)).toBe(true);
        expect(n.preconditions(nStage(2763, 9103), {} as MmContext)).toMatch(/under the temple/);
        expect(n.preconditions(nStage(2807, 9201, [MM_OBJ.greegree]), {} as MmContext)).toMatch(/gree-gree/);
    });

    test('the re-run after a throw under the temple, the bar still held, enters N', async () => {
        const p = await resolveResume(steps(), new Observation(nStage(2807, 9201), { [JOURNAL_PROBE]: async () => journal(IN_L) }, {} as RunnerSession), {} as MmContext);
        expect({ step: p.step, mode: p.mode }).toEqual({ step: 'S15:N-temple', mode: 'run' });
    });
});

describe('landing frames on the browser client (a region rebuild: sceneReady false, no locs or NPCs)', () => {
    const fire = { id: 4765, name: 'Wall of flame', x: 2811, z: 9208, level: 0, distance: 4, optionsWithIndex: [], options: [] } as never;
    const landed = () => new FakeSdk(baseState({ tick: 1, sceneReady: false, nearbyLocs: [], player: { worldX: 2807, worldZ: 9201, level: 0, x: 2807, z: 9201, hp: 42 } as never } as Partial<BotWorldState>));

    test("N's fire is found after the trapdoor's landing frame, not refused on it (rs/513's browser chains)", async () => {
        const sdk = landed();
        sdk.scanLocs = [];
        let n = 0;
        const f = await drive(sdk, nearestFire(sdk as never), 30, () => (++n < 3 ? {} : { sceneReady: true, nearbyLocs: [fire] }));
        expect(f).toEqual({ x: 2811, z: 9208, id: 4765 });
        expect(n).toBe(3);
    });

    test('the scene wait passes a built frame at once and holds an unbuilt one until it is built', async () => {
        const ready = new FakeSdk(baseState({ tick: 1, sceneReady: true } as Partial<BotWorldState>));
        await drive(ready, sceneBuilt(ready as never), 1);
        expect(ready.getState()!.tick).toBe(1);
        const sdk = landed();
        let n = 0;
        await drive(sdk, sceneBuilt(sdk as never), 30, () => (++n < 4 ? {} : { sceneReady: true }));
        expect(sdk.getState()!.sceneReady).toBe(true);
        expect(n).toBe(4);
    });
});

describe("Crash Island's scorpions (G) and the sigil's slot (Z)", () => {
    const npc = (name: string, x: number, z: number, o: { hp?: number | null; target?: number } = {}) =>
        ({ kind: 'npc', id: 1, index: x, name, combatLevel: 38, x, z, tileX: x, tileZ: z, size: 1, distance: 3, hp: o.hp ?? null, maxHp: null, healthPercent: null, targetIndex: o.target ?? -1, inCombat: false }) as never;
    const by = (...n: never[]) => baseState({ player: { worldX: 2898, worldZ: 2729, level: 0, x: 2898, z: 2729, hp: 42 } as never, nearbyNpcs: n });
    const ME = 32769;

    test('a scorpion is a threat within SCORPION_CLOSE, or within SCORPION_REACH targeting a player; wandering, dead or another NPC, not', () => {
        expect(scorpionsNear(by(npc('Scorpion', 2898, 2730))).length).toBe(1);
        expect(scorpionsNear(by(npc('Scorpion', 2898 + SCORPION_CLOSE, 2729))).length).toBe(1);
        expect(scorpionsNear(by(npc('Scorpion', 2898 + SCORPION_CLOSE + 1, 2729)))).toEqual([]); // wandering
        expect(scorpionsNear(by(npc('Scorpion', 2898 + SCORPION_REACH, 2729, { target: ME }))).length).toBe(1);
        expect(scorpionsNear(by(npc('Scorpion', 2898 + SCORPION_REACH + 1, 2729, { target: ME })))).toEqual([]);
        expect(scorpionsNear(by(npc('Scorpion', 2898 + 5, 2729, { target: 3 })))).toEqual([]); // an NPC target
        expect(scorpionsNear(by(npc('Scorpion', 2899, 2729, { hp: 0 })))).toEqual([]);
        expect(scorpionsNear(by(npc('Waydar', 2899, 2729, { target: ME }), npc('Lumdo', 2896, 2727)))).toEqual([]);
    });

    test("the worn sigil's slot: free, else a shark dropped, else none", () => {
        const pack = (sharks: number, other: number) =>
            baseState({ inventory: [...Array.from({ length: sharks }, (_, i) => item(MM_OBJ.shark, i)), ...Array.from({ length: other }, (_, i) => item(MM_OBJ.greegree, sharks + i))] } as Partial<BotWorldState>);
        expect(sigilRoom(pack(13, 14))).toBe('free');
        expect(sigilRoom(pack(13, 15))).toBe('drop a shark');
        expect(sigilRoom(pack(0, 28))).toBe('none');
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

    test('the exit holds none of them, held or worn, has the training xp, and wears the M\'speak amulet', () => {
        expect(exitState(state([MM_OBJ.greegree], [MM_OBJ.amulet]), {} as never)).toBe(true);
        expect(exitState(state([MM_OBJ.amulet, MM_OBJ.greegree]), {} as never)).toMatch(/M'speak amulet is not worn/);
        for (const id of EXIT_DROPS) {
            expect(exitState(state([id], [MM_OBJ.amulet]), {} as never)).toMatch(/S15's exit drops/);
            expect(exitState(state([], [id]), {} as never)).toMatch(/S15's exit drops/);
        }
        expect(exitState(state([], [MM_OBJ.amulet], 34_999), {} as never)).toMatch(/below Daero/);
    });

    /**
     * A neck slot as the engine has it for these two objs (quest_mm.obj: both wearpos=front): a wear swaps whatever is in
     * the slot into the pack. Clicks land a tick later.
     */
    test("R's sigil pushes the M'speak amulet into the pack; Z drops the sigil and the amulet is worn at S15's exit", async () => {
        const NECK = 2;
        const neck = new Set<number>([MM_OBJ.amulet, MM_OBJ.sigil]);
        const packed = (id: number, slot: number): InventoryItem => ({ slot, id, name: `obj ${id}`, count: 1, optionsWithIndex: [{ text: 'Wear', opIndex: 2 }] });
        const worn = (id: number): InventoryItem => ({ slot: NECK, id, name: `obj ${id}`, count: 1, optionsWithIndex: [{ text: 'Remove', opIndex: 1 }] });
        const freeSlot = (inv: readonly InventoryItem[]) => { for (let q = 0; ; q++) if (!inv.some(i => i.slot === q)) return q; };
        const sdk = new FakeSdk(baseState({
            tick: 1,
            inventory: [packed(MM_OBJ.sigil, 0), ...Array.from({ length: 12 }, (_, i) => ({ ...item(MM_OBJ.shark, i + 1) }))],
            equipment: [worn(MM_OBJ.amulet), { ...item(MM_OBJ.greegree, 3) }],
            skills: [strength(35_000)],
        } as Partial<BotWorldState>));
        const pending: { method: string; args: unknown[] }[] = [];
        sdk.onSend = a => pending.push(a);
        const each = (st: BotWorldState): Partial<BotWorldState> => {
            let inv = st.inventory;
            let eq = st.equipment;
            for (const a of pending.splice(0)) {
                const slot = a.args[0] as number;
                if (a.method === 'sendDropItem') inv = inv.filter(i => i.slot !== slot);
                if (a.method === 'sendUseEquipmentItem') {
                    const e = eq.find(x => x.slot === slot);
                    if (e) { eq = eq.filter(x => x !== e); inv = [...inv, packed(e.id, freeSlot(inv))]; }
                }
                if (a.method === 'sendUseItem') {
                    const it = inv.find(i => i.slot === slot);
                    if (!it || !neck.has(it.id)) continue;
                    const off = eq.filter(e => e.slot === NECK);
                    inv = inv.filter(i => i !== it);
                    for (const o of off) inv = [...inv, packed(o.id, freeSlot(inv))];
                    eq = [...eq.filter(e => e.slot !== NECK), worn(it.id)];
                }
            }
            return { inventory: inv, equipment: eq };
        };
        // R: the sigil goes on (demonFight's wield) and the amulet is in the pack.
        expect((await drive(sdk, wield(sdk as never, MM_OBJ.sigil), 10, each)).ok).toBe(true);
        const fought = sdk.getState()!;
        expect(fought.equipment.some(e => e.id === MM_OBJ.sigil)).toBe(true);
        expect(fought.inventory.some(i => i.id === MM_OBJ.amulet)).toBe(true);
        expect(exitState(fought, {} as never)).toMatch(/S15's exit drops/);
        // Z: the sigil off and dropped, then the amulet back on.
        await drive(sdk, dropDead(sdk as never, () => {}), 30, each);
        const end = sdk.getState()!;
        expect(end.inventory.some(i => i.id === MM_OBJ.sigil || i.id === MM_OBJ.amulet)).toBe(false);
        expect(end.equipment.map(e => e.id).sort()).toEqual([MM_OBJ.amulet, MM_OBJ.greegree].sort());
        expect(end.inventory.length).toBe(12);
        expect(exitState(end, {} as never)).toBe(true);
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

describe("J's walk from Garkor (the collision map)", () => {
    // The pathfinder's route length in tiles: its corners walked as the server steps (a diagonal first).
    const routed = (from: { x: number; z: number }, to: { x: number; z: number }) => pathTiles(from, findLongPath(0, from.x, from.z, to.x, to.z).map(p => ({ x: p.x, z: p.z }))).length;
    const cheb = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

    test('every leg after the first is as short as its Chebyshev distance: no walled pocket routed round', () => {
        const pts = GARKOR_WEST.points;
        for (let i = 1; i < pts.length; i++) expect(routed(pts[i - 1]!, pts[i]!)).toBe(cheb(pts[i - 1]!, pts[i]!));
        // The old first point: walled but for its north side, 4 away and ~40 tiles round.
        expect(routed({ x: 2799, z: 2769 }, { x: 2795, z: 2772 })).toBeGreaterThan(30);
    });

    test('the first point is north of the Elder Guards, and the click to it keeps clear of them', () => {
        const garkor = { x: 2805, z: 2762 };
        const first = GARKOR_WEST.points[0]!;
        expect(cheb(garkor, first)).toBeLessThanOrEqual(GARKOR_WEST.within);
        const tiles = pathTiles(garkor, findLongPath(0, garkor.x, garkor.z, first.x, first.z).map(p => ({ x: p.x, z: p.z })));
        expect(tiles.filter(t => t.x >= 2797 && t.x <= 2802 && t.z >= 2756 && t.z <= 2761)).toEqual([]);
    });
});

describe('the atoll top-ups (H12o)', () => {
    const held = (n: number) => baseState({ inventory: Array.from({ length: n }, (_, i) => item(MM_OBJ.shark, i)) } as Partial<BotWorldState>);

    test('off by default: no option, no top-up', () => {
        expect(resolveOptions().topUpFrom).toBeUndefined();
    });

    test("P is sized at the landing: the super antipoison, then min(9, free - 2) sharks (rs/158); nothing free moves on", () => {
        expect(pTopUpAsk(held(21))).toEqual({ antipoison: 1, sharks: 5 }); // 7 free
        expect(pTopUpAsk(held(26))).toEqual({ antipoison: 1, sharks: 0 }); // 2 free
        expect(pTopUpAsk(held(27))).toEqual({ antipoison: 1, sharks: 0 }); // 1 free
        expect(pTopUpAsk(held(28))).toBeNull(); // 0 free
        expect(pTopUpAsk(held(10))).toEqual({ antipoison: 1, sharks: P_TOPUP_MAX_SHARKS });
        expect(pLegSize(held(21))).toEqual({ want: [{ item: /^Superantipoison\(4\)$/i, amount: 1 }], ask: [{ item: ASK_SUPER_ANTIPOISON, count: 1 }, { item: ASK_SHARK, count: 5 }] });
        expect(pLegSize(held(26))).toEqual({ want: [{ item: /^Superantipoison\(4\)$/i, amount: 1 }], ask: [{ item: ASK_SUPER_ANTIPOISON, count: 1 }] });
        expect(pLegSize(held(28))).toMatch(/no free slot for H12o-P \(0 free\)/);
        // The ask's patterns match the game's names as mule.ts reads them (case-insensitive).
        expect(new RegExp(ASK_SUPER_ANTIPOISON, 'i').test('Superantipoison(4)')).toBe(true);
        expect(new RegExp(ASK_SUPER_ANTIPOISON, 'i').test('Superantipoison(3)')).toBe(false);
        expect(new RegExp(ASK_SHARK, 'i').test('Shark')).toBe(true);
    });

    test("M is the free slots less one, asked as sharks", () => {
        expect([mTopUpSharks(held(20)), mTopUpSharks(held(27)), mTopUpSharks(held(28))]).toEqual([7, 0, 0]);
        expect(mLegSize(held(26))).toEqual({ want: [{ item: /^Shark$/i, amount: 1 }], ask: [{ item: ASK_SHARK, count: 1 }] });
        expect(mLegSize(held(27))).toMatch(/no free slot to spare/);
        expect(M_TOPUP_TILE).toEqual({ x: 2763, z: 2704 });
        expect(H12O_SCOPE).toEqual({ M: { step: 'H12oM', family: 'mule' }, P: { step: 'H12oP', family: 'mule' } });
    });

    test("M's cap is its ledger row's `shark to N`: 15 in the manifest, so free 17 asks 15 (fold 30: min(row, free - 1))", () => {
        expect(mTopUpCap()).toBe(15);
        expect(mTopUpSharks(held(11))).toBe(15); // 17 free
        expect(mLegSize(held(11))).toEqual({ want: [{ item: /^Shark$/i, amount: 1 }], ask: [{ item: ASK_SHARK, count: 15 }] });
        // 7, 2, 1 and 0 free: 6, 1, 0 and 0 (no leg at 1 or 0).
        expect([21, 26, 27, 28].map(n => mTopUpSharks(held(n)))).toEqual([6, 1, 0, 0]);
        expect(mLegSize(held(27))).toMatch(/no free slot to spare/);
        // Read from the row, not a constant: another manifest's N is the cap.
        const ledger = (n: number) =>
            `## Inventory ledger\n\n| row | in | out | equip | needAtStart | source |\n|---|---|---|---|---|---|\n| ${H12O_M_ROW} | shark to ${n} [u] | - | - | 0 | r |\n`;
        expect(mTopUpCap(ledger(9))).toBe(9);
        expect(mTopUpSharks(held(11), mTopUpCap(ledger(9)))).toBe(9);
        expect(() => mTopUpCap('## Inventory ledger\n')).toThrow(/no H12o-M row/);
    });

    test('the ask is written once, on the first frame that shows the trade with the helper open', () => {
        const sdk = new FakeSdk(baseState({ tick: 1 }));
        const writes: number[] = [];
        const stop = onTradeOpen(sdk, 'Helper', s => writes.push(s.tick));
        const trade = (partner: string) => ({ trade: { isOpen: true, screen: 'offer', partner, myOffer: [], theirOffer: [], myAccepted: false, partnerAccepted: false } }) as Partial<BotWorldState>;
        sdk.tick();
        sdk.tick(trade('Someone else'));
        sdk.tick(trade('helper'));
        sdk.tick(trade('Helper'));
        stop();
        expect(writes).toEqual([4]);
    });

    test('receiveLeg writes the leg\'s scoped ask in the ask directory when the trade opens', async () => {
        setStepNote(() => {});
        const dir = mkdtempSync(join(tmpdir(), 'mm-ask-'));
        const sdk = new FakeSdk(baseState({ tick: 1, player: me(-1), nearbyPlayers: [helper], inventory: Array.from({ length: 21 }, (_, i) => item(MM_OBJ.shark, i)) } as Partial<BotWorldState>));
        const receive: Receive = async s => {
            (s as unknown as FakeSdk).tick({ trade: { isOpen: true, screen: 'offer', partner: 'Helper', myOffer: [], theirOffer: [], myAccepted: false, partnerAccepted: false } } as Partial<BotWorldState>);
            return okReceive;
        };
        const r = await drive(sdk, receiveLeg(sdk as never, 'Helper', 'P', pLegSize, { receive, cueDir: dir }), 100);
        expect(r.ok).toBe(true);
        expect(readTopUpAsk(dir)).toMatchObject({ v: 2, scope: { step: 'H12oP', family: 'mule' }, items: [{ item: ASK_SUPER_ANTIPOISON, count: 1 }, { item: ASK_SHARK, count: 5 }] });
    });

    // P's leg with its cues, as h45 reads them: the exact ask written at each free count (rs/158), then P's stop.
    const pLegAt = async (free: number) => {
        setStepNote(() => {});
        const dir = mkdtempSync(join(tmpdir(), 'mm-p-'));
        const sdk = new FakeSdk(baseState({ tick: 1, player: me(-1), nearbyPlayers: [helper], inventory: Array.from({ length: 28 - free }, (_, i) => item(MM_OBJ.shark, i)) } as Partial<BotWorldState>));
        let trades = 0;
        const receive: Receive = async s => {
            trades++;
            (s as unknown as FakeSdk).tick({ trade: { isOpen: true, screen: 'offer', partner: 'Helper', myOffer: [], theirOffer: [], myAccepted: false, partnerAccepted: false } } as Partial<BotWorldState>);
            return okReceive;
        };
        const r = await drive(sdk, h12oLeg(sdk as never, { from: 'Helper', p: true, cueDir: dir }, 'P', receive), 100);
        return { r, trades, ask: readTopUpAsk(dir), cue: readCue(dir) };
    };

    test('P writes exactly its ask lines at 7, 2 and 1 free, none and no trade at 0 free, and its stop every time', async () => {
        const anti = { item: '^superantipoison\\(4\\)$', count: 1 };
        expect(anti.item).toBe(ASK_SUPER_ANTIPOISON);
        const at7 = await pLegAt(7);
        expect(at7.ask!.items).toEqual([anti, { item: '^shark$', count: 5 }]);
        expect(at7.ask!.scope).toEqual({ step: 'H12oP', family: 'mule' });
        for (const free of [2, 1]) {
            const x = await pLegAt(free);
            expect(x.ask!.items).toEqual([anti]);
            expect(x.cue).toMatchObject({ scope: { step: 'H12oP', family: 'mule' }, stop: true });
        }
        const at0 = await pLegAt(0);
        expect(at0.trades).toBe(0);
        expect(at0.ask).toBeNull();
        expect(at0.r).toMatchObject({ ok: false, attempts: 0 });
        expect(at0.cue).toMatchObject({ scope: { step: 'H12oP', family: 'mule' }, stop: true });
        expect(at7.cue).toMatchObject({ scope: { step: 'H12oP', family: 'mule' }, stop: true, final: true });
        expect(at0.cue).toMatchObject({ final: true });
    });

    test("P's final stop on every exit, once: a throw before the leg, and the leg nested in the segment's wrap", async () => {
        const writes: string[] = [];
        setStepNote(l => {
            const m = /H12o cue (open|stop)( final)? \((H12o[MP])\)/.exec(l);
            if (m) writes.push(`${m[3]} ${m[1]}${m[2] ?? ''}`);
        });
        const dir = mkdtempSync(join(tmpdir(), 'mm-pfin-'));
        const t = { from: 'Helper', p: true, cueDir: dir };
        const sdk = new FakeSdk(baseState({ tick: 1, player: me(-1), nearbyPlayers: [helper], inventory: Array.from({ length: 21 }, (_, i) => item(MM_OBJ.shark, i)) } as Partial<BotWorldState>));
        // The segment throws before the leg (the bridge jump failed): the stop still goes out, final.
        const err = await pFinalStop(sdk as never, t, async () => { throw new Error('the bridge jump did not land'); }).then(() => null, e => (e as Error).message);
        expect(err).toMatch(/bridge jump/);
        expect(writes).toEqual(['H12oP stop final']);
        expect(readCue(dir)).toMatchObject({ scope: { step: 'H12oP', family: 'mule' }, stop: true, final: true });
        // The leg inside the segment's wrap: one final stop, not two.
        writes.length = 0;
        const receive: Receive = async () => okReceive;
        await drive(sdk, pFinalStop(sdk as never, t, () => h12oLeg(sdk as never, t, 'P', receive)), 100);
        expect(writes).toEqual(['H12oP stop final']);
        // No P leg configured: nothing written.
        writes.length = 0;
        await pFinalStop(sdk as never, { from: 'Helper', m: true, cueDir: dir }, async () => undefined);
        expect(writes).toEqual([]);
        setStepNote(() => {});
    });

    test('a receive that times out with the trade open declines it, and the leg moves on without the top-up', async () => {
        const notes: string[] = [];
        setStepNote(l => notes.push(l));
        const sdk = new FakeSdk(baseState({ tick: 1, player: me(-1), nearbyPlayers: [helper], inventory: Array.from({ length: 21 }, (_, i) => item(MM_OBJ.shark, i)) } as Partial<BotWorldState>));
        const open = { trade: { isOpen: true, screen: 'offer', partner: 'Helper', myOffer: [], theirOffer: [], myAccepted: true, partnerAccepted: false } } as Partial<BotWorldState>;
        const closed = { trade: { isOpen: false, screen: null, partner: null, myOffer: [], theirOffer: [], myAccepted: false, partnerAccepted: false } } as Partial<BotWorldState>;
        let declined = false;
        sdk.onSend = a => { if (a.method === 'sendDeclineTrade') declined = true; };
        // The helper opened the trade and never accepted: receiveFrom's window ran out with it open.
        const receive: Receive = async s => {
            (s as unknown as FakeSdk).tick(open);
            return { ok: false, ticks: 60, received: [], reason: 'timeout' } as ReceiveResult;
        };
        const r = await drive(sdk, receiveLeg(sdk as never, 'Helper', 'P', pLegSize, { receive, cueDir: mkdtempSync(join(tmpdir(), 'mm-dec-')) }), 200, () => (declined ? closed : {}));
        expect(r).toMatchObject({ ok: false, attempts: 2, reason: 'timeout' });
        expect(sdk.sent.filter(a => a.method === 'sendDeclineTrade').length).toBe(2);
        expect(sdk.getState()!.trade?.isOpen).toBe(false);
        expect(notes.filter(l => /the trade was left open; closed/.test(l)).length).toBe(2);
        // A decline the server ignores: the window is closed outright after DECLINE_TICKS.
        const stuck = new FakeSdk(baseState({ tick: 1, player: me(-1), ...open } as Partial<BotWorldState>));
        let shut = false;
        stuck.onSend = a => { if (a.method === 'sendCloseModal') shut = true; };
        await drive(stuck, closeLeftTrade(stuck as never, 'P'), 20, () => (shut ? closed : {}));
        expect(stuck.sent.map(a => a.method)).toEqual(['sendDeclineTrade', 'sendCloseModal']);
        expect(stuck.getState()!.tick).toBeGreaterThanOrEqual(1 + DECLINE_TICKS);
        setStepNote(() => {});
    });

    test("M: after a trade no stop, then P's open; with no trade M's stop, then P's open; legCue opens without a stop", async () => {
        const run = async (ok: boolean) => {
            const dir = mkdtempSync(join(tmpdir(), 'mm-m-'));
            const sdk = new FakeSdk(baseState({ tick: 1, player: me(-1), nearbyPlayers: [helper], inventory: [item(MM_OBJ.shark, 0)] } as Partial<BotWorldState>));
            // legCue notes each write as it makes it: cue.json keeps only the last.
            const writes: string[] = [];
            setStepNote(l => {
                const m = /H12o cue (open|stop) \((H12o[MP])\)/.exec(l);
                if (m) writes.push(`${m[2]} ${m[1]}`);
            });
            const receive: Receive = async () => (ok ? okReceive : ({ ok: false, ticks: 0, received: [], reason: 'declined' } as ReceiveResult));
            await drive(sdk, h12oLeg(sdk as never, { from: 'Helper', m: true, p: true, cueDir: dir }, 'M', receive), 200);
            return { cue: readCue(dir), writes };
        };
        const good = await run(true);
        expect(good.cue).toMatchObject({ scope: { step: 'H12oP', family: 'mule' } });
        expect(good.cue!.stop).toBeUndefined();
        expect(good.writes).toEqual(['H12oP open']);
        const bad = await run(false);
        expect(bad.writes).toEqual(['H12oM stop', 'H12oP open']);
        setStepNote(() => {});
        const dir = mkdtempSync(join(tmpdir(), 'mm-open-'));
        legCue(new FakeSdk(baseState({ tick: 9, player: me(-1) } as Partial<BotWorldState>)) as never, dir, 'M', 'open');
        expect(readCue(dir)).toMatchObject({ scope: { step: 'H12oM', family: 'mule' }, receiver: { sha256: nameHash('scored') } });
        expect(readCue(dir)!.stop).toBeUndefined();
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
        const r = await drive(sdk, receiveLeg(sdk as never, 'Helper', 'P', pLegSize, { receive }), 100, s => ({ player: me(s.tick < 4 ? 829 : -1) }));
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
        const r = await drive(sdk, receiveLeg(sdk as never, 'Helper', 'M', mLegSize, { receive }), 100);
        expect(r).toMatchObject({ ok: true, attempts: 2 });
        expect(calls).toHaveLength(2);
        expect(lines.some(l => /attempt 1 of 2: no_response; SCORED at the click: idle/.test(l))).toBe(true);
    });

    test('moves on without the top-up after the second failure, with the helper out of view, or with no room, never throwing', async () => {
        const lines: string[] = [];
        setStepNote(l => lines.push(l));
        let sdk = start();
        let s = stub([{ ok: false, ticks: 0, received: [], reason: 'closed' }]);
        expect(await drive(sdk, receiveLeg(sdk as never, 'Helper', 'P', pLegSize, { receive: s.receive }), 100)).toMatchObject({ ok: false, attempts: TOPUP_TRIES, reason: 'closed' });
        expect(s.calls).toHaveLength(TOPUP_TRIES);
        expect(lines.at(-1)).toMatch(/S15:P top-up from Helper: moving on without it after 2 attempt\(s\)/);

        sdk = start({ helperInView: false });
        s = stub([okReceive]);
        const r = await drive(sdk, receiveLeg(sdk as never, 'Helper', 'P', pLegSize, { receive: s.receive }), 100);
        expect(r).toMatchObject({ ok: false, attempts: 0 });
        expect(r.ticks).toBeGreaterThanOrEqual(TOPUP_WAIT);
        expect(s.calls).toHaveLength(0);

        sdk = new FakeSdk(baseState({ tick: 1, player: me(-1), nearbyPlayers: [helper], inventory: Array.from({ length: 27 }, (_, i) => item(MM_OBJ.shark, i)) } as Partial<BotWorldState>));
        s = stub([okReceive]);
        expect(await drive(sdk, receiveLeg(sdk as never, 'Helper', 'M', mLegSize, { receive: s.receive }), 100)).toMatchObject({ ok: false, attempts: 0, reason: expect.stringMatching(/no free slot/) });
        expect(s.calls).toHaveLength(0);
    });
});

describe("P's way to Zooknock: a knockout during H12o-P's wait (zooknockWay)", () => {
    const at = (p: { x: number; z: number }) => ({ name: 'scored', x: p.x, z: p.z, worldX: p.x, worldZ: p.z, level: 0, hp: 42, maxHp: 42, animId: -1 }) as unknown as PlayerState;
    const TOWN = { x: 2790, z: 2780 };
    const LANDING = { x: 2803, z: 2724 };
    const CELL = { x: 2772, z: 2794 };
    const LADDER_BOTTOM = { x: 2763, z: 9104 };
    const ZOOKNOCK = { x: 2804, z: 9145 };

    /**
     * P from the town with its legs faked as moves, and H12o-P's real leg (its helper never in view), all in P's final-stop
     * wrap. `knock`: SCORED lands in the cell that many ticks into the leg's wait, or as the first jump ends.
     */
    const runP = async (knock: { duringLeg?: number; inFirstJump?: boolean } = {}) => {
        const notes: string[] = [];
        setStepNote(l => notes.push(l));
        const dir = mkdtempSync(join(tmpdir(), 'mm-pko-'));
        const t = { from: 'Helper', p: true, cueDir: dir };
        const sdk = new FakeSdk(baseState({ tick: 1, player: at(TOWN), nearbyPlayers: [] } as Partial<BotWorldState>));
        const move = (p: { x: number; z: number }) => sdk.tick({ player: at(p) });
        const calls = { jump: 0, pLeg: 0, ladder: 0, walk: 0 };
        const jumpsFromCell: boolean[] = [];
        let legFrom = -1;
        const legs: ZooknockLegs = {
            roofs: async () => { throw new Error('the roofs are not on the way from the town'); },
            jump: async () => {
                calls.jump++;
                jumpsFromCell.push(inCell(sdk.getState()!));
                if (knock.inFirstJump && calls.jump === 1) {
                    move(CELL);
                    throw new Error('the bridge ladder did not move the player');
                }
                move(LANDING);
            },
            pLeg: async () => {
                calls.pLeg++;
                legFrom = sdk.getState()!.tick;
                return h12oLeg(sdk as never, t, 'P');
            },
            ladder: async () => { calls.ladder++; move(LADDER_BOTTOM); },
            // As go(): no route from the cell.
            walk: async () => {
                calls.walk++;
                const p = sdk.getState()!.player!;
                if (!inArea(sdk.getState()!, AREAS.dungeon)) throw new Error(`walk to ${ZOOKNOCK.x},${ZOOKNOCK.z} failed at ${p.worldX},${p.worldZ}`);
                move(ZOOKNOCK);
            },
        };
        let knocked = false;
        const each = (s: BotWorldState): Partial<BotWorldState> => {
            if (knock.duringLeg === undefined || knocked || legFrom < 0 || s.tick < legFrom + knock.duringLeg) return {};
            knocked = true;
            return { player: at(CELL) };
        };
        const error = await drive(sdk, pFinalStop(sdk as never, t, () => zooknockWay(sdk as never, legs)), 300, each).then(() => null, e => (e as Error).message);
        setStepNote(() => {});
        const p = sdk.getState()!.player!;
        return {
            error, calls, jumpsFromCell, end: { x: p.worldX, z: p.worldZ }, notes,
            finalStops: notes.filter(l => /S15:P H12o cue stop final \(H12oP\)/.test(l)).length,
            skipped: notes.filter(l => /S15:P top-up: not tried again after a knockout/.test(l)).length,
            cue: readCue(dir),
        };
    };

    test('knocked into the cell during the wait: the leg moves on, jailSafe retries from the cell, and P reaches Zooknock', async () => {
        const r = await runP({ duringLeg: 8 });
        // The old shape (the walk after a jailSafe errand that returned in the cell) threw here: walk to 2804,9145 failed at 2772,2794.
        expect(r.error).toBeNull();
        expect(r.notes.some(l => /S15:P top-up from Helper: moving on without it after 0 attempt\(s\)/.test(l))).toBe(true);
        expect(r.jumpsFromCell).toEqual([false, true]);
        expect(r.calls).toEqual({ jump: 2, pLeg: 1, ladder: 1, walk: 1 });
        expect(r.end).toEqual(ZOOKNOCK);
    });

    test("the retry does not run the P leg again and writes no second final stop: one skip noted, one final stop", async () => {
        const r = await runP({ duringLeg: 8 });
        expect(r.calls.pLeg).toBe(1);
        expect(r.skipped).toBe(1);
        expect(r.finalStops).toBe(1);
        expect(r.cue).toMatchObject({ scope: { step: 'H12oP', family: 'mule' }, stop: true, final: true });
    });

    test('with no knockout the way is unchanged: one jump, the leg, the ladder and the walk', async () => {
        const r = await runP();
        expect(r.error).toBeNull();
        expect(r.calls).toEqual({ jump: 1, pLeg: 1, ladder: 1, walk: 1 });
        expect(r.skipped).toBe(0);
        expect(r.finalStops).toBe(1);
        expect(r.end).toEqual(ZOOKNOCK);
    });

    test('a knockout before the leg (in the jump) still runs the leg once on the retry', async () => {
        const r = await runP({ inFirstJump: true });
        expect(r.error).toBeNull();
        expect(r.jumpsFromCell).toEqual([false, true]);
        expect(r.calls).toEqual({ jump: 2, pLeg: 1, ladder: 1, walk: 1 });
        expect(r.skipped).toBe(0);
        expect(r.finalStops).toBe(1);
    });
});

describe("the Grand Tree swap's hand-back (GT_HANDBACK) against the ledger's H12 row", () => {
    // H12's before-state and outs, walked from STEP-MANIFEST.md's inventory ledger. The overrides only resolve the
    // row's `any` returns to the walked counts (a wrong count leaves the plan unresolved); the antipoison is H7's Antipoison(3), obj 175.
    const concrete = (id: number, count: number) => ({ items: [{ id, count }], reason: 'the ledger walk' });
    const plan = planMuleDeliveryFixtures({
        manifest: readFileSync(MANIFEST, 'utf8'), rows: ['H12'], onRequest: [], pack: objPack(),
        overrides: { H12: {
            takeBacks: { 'antipoison(*)': concrete(175, 1), 'coins @995': concrete(995, 1000), 'death rune': concrete(560, 49), 'chaos rune': concrete(562, 16) },
        } },
    });
    const h12 = plan.fixtures[0]!;
    const slots = (items: readonly FixtureItem[]) => items.reduce((n, i) => n + (i.kind === 'u' ? i.count : 1), 0);
    const held = (items: readonly FixtureItem[]) => baseState({
        inventory: items.flatMap(i => Array.from({ length: i.kind === 'u' ? i.count : 1 }, () => ({ id: i.id, name: i.name, count: i.kind === 'u' ? 1 : i.count, optionsWithIndex: [] }))).map((i, slot) => ({ ...i, slot })) as InventoryItem[],
    });
    const bow = 861;

    test('the plan resolves from the ledger', () => {
        expect(plan.unresolved).toEqual([]);
        expect(plan.ok).toBe(true);
    });

    test("h12Plan gives back exactly the row's takebacks, each by one pattern", () => {
        const give = h12Plan(held(h12.beforeInventory), { bow }).give.map(g => g.item as RegExp);
        expect(give).toHaveLength(h12.takeBacks.length);
        for (const t of h12.takeBacks) expect(give.filter(p => p.test(t.name)).map(String)).toHaveLength(1);
        for (const p of give) expect(h12.takeBacks.some(t => p.test(t.name))).toBe(true);
    });

    test('with Superantipoison(1), Superantipoison(4) and Antipoison(3) held, only the Antipoison(3) goes back', () => {
        const s = baseState({ inventory: ['Superantipoison(1)', 'Superantipoison(4)', 'Antipoison(3)'].map((name, slot) => ({ slot, id: 100 + slot, name, count: 1, optionsWithIndex: [] })) as InventoryItem[] });
        const potions = h12Plan(s, { bow }).give.filter(g => s.inventory.some(i => (g.item as RegExp).test(i.name)));
        expect(potions.flatMap(g => s.inventory.filter(i => (g.item as RegExp).test(i.name)).map(i => i.name))).toEqual(['Antipoison(3)']);
    });

    test('from the walked before-state the swap ends within 28 slots', () => {
        const give = h12Plan(held(h12.beforeInventory), { bow }).give.map(g => g.item as RegExp);
        const kept = h12.beforeInventory.filter(i => !give.some(p => p.test(i.name)));
        // A received stack joins a held one of the same object (the runes) and takes no new slot.
        const added = h12.receive.filter(r => r.kind === 'u' || !kept.some(k => k.id === r.id));
        // 21 since H10's shark top-up to 10 (fold-in 43a): 2 more sharks held at H12 than at to 8
        expect(slots(h12.beforeInventory)).toBe(21);
        expect(slots(kept) + slots(added)).toBeLessThanOrEqual(28);
    });
});

describe('X: the prayer points (rs/687)', () => {
    const x = () => steps()[seg('X')]!;
    const named = (name: string, slot: number): InventoryItem => ({ slot, id: 2434, name, count: 1, optionsWithIndex: [{ text: 'Drink', opIndex: 1 }] });
    const atX = (points: number, extra: InventoryItem[] = []) => baseState({
        quests: { mm: 'started' },
        inventory: [item(MM_OBJ.sigil, 0), item(DEFAULT_OPTIONS.bow, 1), item(MM_OBJ.runeArrow, 2), ...extra],
        prayers: { activePrayers: [], prayerPoints: points, prayerLevel: 94 },
    } as Partial<BotWorldState>);
    test('the demon under Protect from Magic: the five measured kills took 44-64 (94 down to 30-50)', () => {
        expect(X_PRAYER).toBeGreaterThanOrEqual(64);
        expect(x().preconditions(atX(X_PRAYER), {} as MmContext)).toBe(true);
        expect(x().preconditions(atX(10), {} as MmContext)).toBe('S15:X for the Jungle Demon needs ~70 prayer points, has 10 and no prayer potion');
    });
    test('held doses count: 10 points and two doses at 30 make 70', () => {
        expect(x().preconditions(atX(10, [named('Prayer potion(2)', 3)]), {} as MmContext)).toBe(true);
    });
});

describe('S15:A cures a poison carried in from S14 (rs/755)', () => {
    beforeEach(() => noteAntipoison(-Infinity));
    const potion = (slot: number, name: string, id = 0): InventoryItem => ({ slot, id, name, count: 1, optionsWithIndex: [{ text: 'Drink', opIndex: 1 }] });
    const page = { isOpen: true, options: [], isWaiting: false, allComponents: [{ text: 'Welcome to the Grand Tree.' }] } as unknown as BotWorldState['dialog'];
    const closed = { isOpen: false, options: [], isWaiting: false } as BotWorldState['dialog'];
    const sip = (name: string) => {
        const m = /^(.*)\((\d)\)$/.exec(name)!;
        return Number(m[2]) > 1 ? `${m[1]}(${Number(m[2]) - 1})` : 'Vial';
    };
    /** Drinks and drops take effect as the engine's would, seen on the next tick. */
    function potionServer(sdk: FakeSdk) {
        sdk.onSend = (a, f) => {
            const slot = a.args[0] as number;
            if (a.method === 'sendUseItem') f.state = { ...f.state!, inventory: f.state!.inventory.map(i => (i.slot === slot ? { ...i, name: sip(i.name) } : i)) };
            if (a.method === 'sendDropItem') f.state = { ...f.state!, inventory: f.state!.inventory.filter(i => i.slot !== slot) };
        };
    }

    test("poisoned with H7's Antipoison(1): it is drunk before the swap, its vial dropped, and the pack is the kit's 27 (rs/158)", async () => {
        const kit = Array.from({ length: 27 }, (_, i): InventoryItem => ({ slot: i, id: 1000 + i, name: `Kit item ${i}`, count: 1, optionsWithIndex: [] }));
        const sdk = new FakeSdk(baseState({ tick: 5000, inventory: [...kit, potion(27, 'Antipoison(1)')], combatEvents: [poisonHit(4985)] }));
        potionServer(sdk);
        await drive(sdk, cureBeforeSwap(sdk as never), 20);
        expect(sdk.sent).toEqual([{ method: 'sendUseItem', args: [27, 1] }, { method: 'sendDropItem', args: [27] }]);
        expect(sdk.state!.inventory).toHaveLength(27);
        expect(sdk.state!.inventory.some(i => /vial|antipoison/i.test(i.name))).toBe(false);
    });

    test("poisoned holding H7's Antipoison(3) and a Superantipoison(4): the plain one is drunk before the swap", async () => {
        const sdk = new FakeSdk(baseState({ tick: 5000, inventory: [potion(3, 'Superantipoison(4)', MM_OBJ.superAntipoison4), potion(8, 'Antipoison(3)')], combatEvents: [poisonHit(4990)] }));
        potionServer(sdk);
        await drive(sdk, cureBeforeSwap(sdk as never), 10);
        expect(sdk.sent).toEqual([{ method: 'sendUseItem', args: [8, 1] }]);
        expect(sdk.state!.inventory.map(i => i.name)).toEqual(['Superantipoison(4)', 'Antipoison(2)']);
    });

    test('a cure upkeep sent a tick before (while A eats) is waited out: its vial is dropped before the swap sizes', async () => {
        const kit = Array.from({ length: 27 }, (_, i): InventoryItem => ({ slot: i, id: 1000 + i, name: `Kit item ${i}`, count: 1, optionsWithIndex: [] }));
        const sdk = new FakeSdk(baseState({ tick: 5000, inventory: [...kit, potion(27, 'Antipoison(1)')], combatEvents: [poisonHit(4985)] }));
        potionServer(sdk);
        noteAntipoison(4999);
        let n = 0;
        await drive(sdk, cureBeforeSwap(sdk as never), 20, s => (++n === 1 ? { inventory: s.inventory.map(i => (i.slot === 27 ? { ...i, name: 'Vial' } : i)) } : {}));
        expect(sdk.sent).toEqual([{ method: 'sendDropItem', args: [27] }]);
        expect(sdk.state!.inventory).toHaveLength(27);
    });

    test('a dose record ahead of the clock (another session) is not waited on: clean, the swap starts at once', async () => {
        const sdk = new FakeSdk(baseState({ tick: 5000, inventory: [potion(27, 'Antipoison(1)')] }));
        noteAntipoison(9000);
        await drive(sdk, cureBeforeSwap(sdk as never), 5);
        expect(sdk.sent).toEqual([]);
        expect(sdk.state!.tick).toBe(5000);
    });

    test('not poisoned: nothing is drunk before or after the swap', async () => {
        noteSessionStart(0); // the process has run since the client's launch: not a fresh session
        const sdk = new FakeSdk(baseState({ tick: 5000, inventory: [potion(3, 'Antipoison(3)'), potion(4, 'Superantipoison(4)', MM_OBJ.superAntipoison4)] }));
        potionServer(sdk);
        await drive(sdk, cureBeforeSwap(sdk as never), 5);
        await drive(sdk, preDose(sdk as never), 5);
        expect(sdk.sent).toEqual([]);
    });

    test("poisoned with no antipoison(*) before the swap: one dose of H12's Superantipoison(4) after it, before Narnode, never during a chat", async () => {
        const sdk = new FakeSdk(baseState({ tick: 6000, combatEvents: [poisonHit(5992)] }));
        potionServer(sdk);
        await drive(sdk, cureBeforeSwap(sdk as never), 5);
        expect(sdk.sent).toEqual([]);
        // The swap has delivered the kit's super (no Superantipoison(1) this time); a page is up as preDose starts.
        sdk.push({ inventory: [potion(3, 'Superantipoison(4)', MM_OBJ.superAntipoison4)], dialog: page });
        const p = preDose(sdk as never);
        await flush();
        sdk.tick({ dialog: page });
        await flush();
        expect(sdk.sent).toEqual([]);
        await drive(sdk, p, 10, () => ({ dialog: closed }));
        expect(sdk.sent).toEqual([{ method: 'sendUseItem', args: [3, 1] }]);
        expect(sdk.state!.inventory.map(i => i.name)).toEqual(['Superantipoison(3)']);
    });

    // rs/786: a fresh client session (a relog or resume into A, the tick restarted) shows a carried poison only at its
    // first hit, 30 ticks in, after the trade has opened. The lab's old-code run: the trade opened 8 ticks in, H7's
    // Antipoison(3) went back undrunk, and the hit came at 30.
    test("a fresh session with H7's Antipoison(1) and no hit seen: one dose before the swap, its vial dropped, the pack the kit's 27", async () => {
        const kit = Array.from({ length: 27 }, (_, i): InventoryItem => ({ slot: i, id: 1000 + i, name: `Kit item ${i}`, count: 1, optionsWithIndex: [] }));
        const sdk = new FakeSdk(baseState({ tick: 5, inventory: [...kit, potion(27, 'Antipoison(1)')] }));
        potionServer(sdk);
        await drive(sdk, cureBeforeSwap(sdk as never), 20);
        expect(sdk.sent).toEqual([{ method: 'sendUseItem', args: [27, 1] }, { method: 'sendDropItem', args: [27] }]);
        expect(sdk.state!.inventory).toHaveLength(27);
        expect(sdk.state!.inventory.some(i => /vial|antipoison/i.test(i.name))).toBe(false);
    });

    test('a fresh session holding Antipoison(3) and the Superantipoison(4): the plain one before the swap, and nothing more after it', async () => {
        const sdk = new FakeSdk(baseState({ tick: 5, inventory: [potion(3, 'Superantipoison(4)', MM_OBJ.superAntipoison4), potion(8, 'Antipoison(3)')] }));
        potionServer(sdk);
        await drive(sdk, cureBeforeSwap(sdk as never), 10);
        await drive(sdk, preDose(sdk as never), 5);
        expect(sdk.sent).toEqual([{ method: 'sendUseItem', args: [8, 1] }]);
        expect(sdk.state!.inventory.map(i => i.name)).toEqual(['Superantipoison(4)', 'Antipoison(2)']);
    });

    test("a fresh served resume (no swap) with only H12's Superantipoison(4): preDose drinks one super dose before Narnode", async () => {
        const sdk = new FakeSdk(baseState({ tick: 7, inventory: [potion(3, 'Superantipoison(4)', MM_OBJ.superAntipoison4)] }));
        potionServer(sdk);
        await drive(sdk, preDose(sdk as never), 10);
        expect(sdk.sent).toEqual([{ method: 'sendUseItem', args: [3, 1] }]);
        expect(sdk.state!.inventory.map(i => i.name)).toEqual(['Superantipoison(3)']);
    });

    test('a run.ts restart on a page that counts on (first tick seen 5000, no fall): fresh, so the plain antipoison is drunk before the swap', async () => {
        const sdk = new FakeSdk(baseState({ tick: 5000, inventory: [potion(3, 'Superantipoison(4)', MM_OBJ.superAntipoison4), potion(8, 'Antipoison(3)')] }));
        potionServer(sdk);
        await drive(sdk, cureBeforeSwap(sdk as never), 10);
        expect(sdk.sent).toEqual([{ method: 'sendUseItem', args: [8, 1] }]);
    });

    test('a fresh session with no antipoison held: nothing drunk and nothing thrown; not fresh and no hit: nothing drunk', async () => {
        const none = new FakeSdk(baseState({ tick: 5 }));
        await drive(none, cureBeforeSwap(none as never), 5);
        await drive(none, preDose(none as never), 5);
        expect(none.sent).toEqual([]);
        const old = new FakeSdk(baseState({ tick: 40, inventory: [potion(8, 'Antipoison(3)')] }));
        await drive(old, cureBeforeSwap(old as never), 5);
        expect(old.sent).toEqual([]);
    });
});

describe("the Grand Tree swap leaves the kit complete, however low SCORED arrives (attempt 4: 3 held, 12 asked, one eaten in A's first ticks, 14 at the check)", () => {
    // Mid-process, not a fresh session: the trade's own shape is under test, not the fresh-session dose.
    beforeEach(() => noteSessionStart(0));
    const BOW = DEFAULT_OPTIONS.bow;
    const SHARK = MM_OBJ.shark;
    // H12's kit but its sharks, already held, so the trade moves only sharks; the bow and arrows worn from H11r.
    const KIT = [
        [2357, 'Gold bar', 1], [1759, 'Ball of wool', 1], [3183, 'Monkey bones', 1],
        ...Array.from({ length: H12_POTIONS }, () => [2434, 'Prayer potion(4)', 1] as const), [2448, 'Superantipoison(4)', 1],
        [563, 'Law rune', 6], [556, 'Air rune', 6], [554, 'Fire rune', 2], [555, 'Water rune', 4],
        [946, 'Knife', 1], // a GT_HANDBACK item: SCORED gives as it takes, as on the route
    ] as const;
    const shark = (slot: number): InventoryItem => ({ slot, id: SHARK, name: 'Shark', count: 1, optionsWithIndex: [{ text: 'Eat', opIndex: 1 }] });
    const pack = (sharks: number, without: string[] = []): InventoryItem[] => [
        ...KIT.filter(([, name]) => !without.includes(name)).map(([id, name, count], slot) => ({ slot, id, name, count, optionsWithIndex: [] }) as InventoryItem),
        ...Array.from({ length: sharks }, (_, i) => shark(KIT.length + i)),
    ];
    const worn = [
        { slot: 3, id: BOW, name: 'Magic shortbow', count: 1, optionsWithIndex: [] },
        { slot: 13, id: MM_OBJ.runeArrow, name: 'Rune arrow', count: 200, optionsWithIndex: [] },
    ] as InventoryItem[];
    const atDoor = (sharks: number, hp = 42, without: string[] = []) => baseState({
        tick: 1675, inGame: true, autoRetaliateEnabled: false, inventory: pack(sharks, without), equipment: worn,
        quests: { tree: 'complete', grandtree: 'complete' },
        player: { name: 'scored', x: 2465, z: 3488, worldX: 2465, worldZ: 3488, level: 0, hp, maxHp: 42 } as PlayerState,
    } as Partial<BotWorldState>);
    /** `s` with every held `from` renamed `to`: a dose drunk from each. */
    const dosed = (s: BotWorldState, from: string, to: string): BotWorldState => ({ ...s, inventory: s.inventory.map(i => (i.name === from ? { ...i, name: to } : i)) });
    const H12 = handOffFrom(readFileSync(MANIFEST, 'utf8'), 'H12');
    const sharksHeld = (s: BotWorldState) => s.inventory.filter(i => i.id === SHARK).length;
    const h55 = { kind: 'player', index: 7, name: 'Helper', combatLevel: 90, x: 2466, z: 3488 } as BotWorldState['nearbyPlayers'][number];

    /**
     * SCORED at the tree door under A's upkeep, h55 standing on its request and in reach from tick `inView` (h55's approach:
     * attempt 4's window). h55 offers the top-up ask's sharks: sized at the step's start (`asked: 'start'`, chain.ts before
     * rs/763) or on the trade's open frame (`'open'`). `hits` lands poison damage by tick offset; an eat lands a tick after
     * its click.
     */
    async function swapAt(o: { held: number; hp: number; asked: 'start' | 'open'; inView?: number; hits?: Record<number, number> }) {
        const s0 = atDoor(o.held, o.hp);
        const sharksAsked = (s: BotWorldState): number => {
            const c = askFor(s, H12).find(a => new RegExp(a.item, 'i').test('Shark'))?.count;
            return typeof c === 'number' ? c : 0;
        };
        const offer = [{ slot: 0, id: SHARK, name: 'Shark', count: sharksAsked(s0) }];
        const sdk = new FakeTradePartner({ ...s0, nearbyPlayers: o.inView ? [] : [h55] }, offer, { partner: 'Helper', stacks: t => /rune|arrow/i.test(t.name), weapon: n => /bow$/i.test(n) });
        const serve = sdk.onSend;
        const eaten: number[] = [];
        let bite: number | null = null;
        sdk.onSend = (a, f) => {
            const it = a.method === 'sendUseItem' ? sdk.state!.inventory.find(i => i.slot === a.args[0]) : undefined;
            if (it?.id === SHARK) {
                eaten.push(sdk.state!.tick);
                bite = it.slot;
                return;
            }
            if (a.method === 'sendTradeRequest' && o.asked === 'open') offer[0]!.count = sharksAsked(sdk.state!);
            serve(a, f);
        };
        const each = (cur: BotWorldState): Partial<BotWorldState> => {
            const at = cur.tick + 1 - s0.tick;
            let hp = cur.player!.hp;
            let inventory = cur.inventory;
            if (bite !== null) {
                inventory = inventory.filter(i => i.slot !== bite);
                hp = Math.min(42, hp + 20);
                bite = null;
            }
            hp = Math.max(0, hp - (o.hits?.[at] ?? 0));
            return { player: { ...cur.player!, hp }, inventory, ...(o.inView && at >= o.inView ? { nearbyPlayers: [h55] } : {}) };
        };
        setStepNote(() => {});
        const error = await drive(sdk, upkeep(sdk as never, () => gtSwap({ sdk } as never, { bow: BOW, kitFrom: 'Helper' })), 200, each).then(() => null, e => (e as Error).message);
        return { error, end: sdk.state!, eaten, firstClick: sdk.tradeClicks[0] ?? null, asked: sharksAsked(s0) };
    }

    test('h12Wants: false with the kit complete (15 sharks), true one shark short or without any kit line', () => {
        expect(h12Wants(atDoor(H12_SHARKS), { bow: BOW })).toBe(false);
        expect(h12Wants(atDoor(H12_SHARKS + 1), { bow: BOW })).toBe(false);
        expect(h12Wants(atDoor(H12_SHARKS - 1), { bow: BOW })).toBe(true);
        expect(h12Wants(atDoor(H12_SHARKS, 42, ['Superantipoison(4)']), { bow: BOW })).toBe(true);
        expect(h12Wants({ ...atDoor(H12_SHARKS), equipment: [] }, { bow: BOW })).toBe(true);
        for (const n of [0, 3, 14, 15, 16]) expect(h12Wants(atDoor(n), { bow: BOW })).toBe(h12Plan(atDoor(n), { bow: BOW }).want.length > 0);
    });

    test("the potion lines count by potion at any dose: attempt 4's cure from the kit's only super leaves it at (3), and the kit is complete", () => {
        const served = atDoor(H12_SHARKS);
        expect(h12Wants(dosed(served, 'Superantipoison(4)', 'Superantipoison(3)'), { bow: BOW })).toBe(false);
        expect(h12Wants(dosed(served, 'Superantipoison(4)', 'Superantipoison(1)'), { bow: BOW })).toBe(false);
        expect(h12Wants(atDoor(H12_SHARKS, 42, ['Superantipoison(4)']), { bow: BOW })).toBe(true);
        // H7's plain antipoison is a handback, never the kit's super.
        expect(h12Wants(dosed(served, 'Superantipoison(4)', 'Antipoison(3)'), { bow: BOW })).toBe(true);
        expect(h12Wants(dosed(served, 'Prayer potion(4)', 'Prayer potion(2)'), { bow: BOW })).toBe(false);
        const three = { ...served, inventory: served.inventory.filter((i, k, all) => i.name !== 'Prayer potion(4)' || all.findIndex(j => j.name === i.name) !== k) };
        expect(h12Wants(three, { bow: BOW })).toBe(true);
    });

    test("served (attempt 4's shape): a kit shark eaten and a super dose drunk after H12's serve never re-open the want; the bow, arrows and quest items still count", () => {
        const after = dosed(atDoor(H12_SHARKS - 1), 'Superantipoison(4)', 'Superantipoison(3)');
        expect(h12Wants(after, { bow: BOW, served: true })).toBe(false);
        expect(h12Wants(atDoor(0, 42, ['Superantipoison(4)', 'Law rune']), { bow: BOW, served: true })).toBe(false);
        expect(h12Wants(atDoor(H12_SHARKS - 1), { bow: BOW })).toBe(true);
        expect(kitMissing(after, BOW, { served: true })).toEqual([]);
        expect(h12Wants({ ...after, equipment: [] }, { bow: BOW, served: true })).toBe(true);
        expect(kitMissing(atDoor(H12_SHARKS, 42, ['Gold bar']), BOW, { served: true })).toEqual([[/^Gold bar$/, 1]]);
    });

    test("served: A's precondition passes without a giver and gtSwap trades nothing, so A's body starts", async () => {
        const after = dosed(atDoor(H12_SHARKS - 1), 'Superantipoison(4)', 'Superantipoison(3)');
        const a = (o: Parameters<typeof steps>[0]) => steps(o)[seg('A')]!;
        expect(a({ kitServed: () => true }).preconditions(after, {} as MmContext)).toBe(true);
        expect(a({}).preconditions(after, {} as MmContext)).toMatch(/H12 kit short and no kitFrom: 1 \^Shark\$/);
        expect(a({ kitFrom: 'Helper' }).preconditions(after, {} as MmContext)).toBe(true);
        expect(a({ kitFrom: 'Helper', kitServed: () => true }).preconditions(atDoor(H12_SHARKS, 42, ['Gold bar']), {} as MmContext)).toMatch(/served this attempt: 1 \^Gold bar\$/);

        const sdk = new FakeSdk(after);
        await drive(sdk, gtSwap({ sdk } as never, { bow: BOW, kitFrom: 'Helper', kitServed: () => true }), 20);
        expect(sdk.sent.map(a => a.method)).not.toContain('sendTradeRequest');
        const short = new FakeSdk(atDoor(H12_SHARKS, 42, ['Gold bar']));
        await expect(drive(short, gtSwap({ sdk: short } as never, { bow: BOW, kitFrom: 'Helper', kitServed: () => true }), 20)).rejects.toThrow(/H12 was served this attempt and the kit lacks 1 \^Gold bar\$/);
        expect(short.sent.map(a => a.method)).not.toContain('sendTradeRequest');
    });

    describe("A after a lost royal seal: Narnode's menu re-issues it (mm_narnode.rs2:152-168)", () => {
        const started = (s: BotWorldState): BotWorldState => ({ ...s, quests: { ...s.quests, mm: 'started' } });
        const a = () => steps({ kitServed: () => true })[seg('A')]!;
        const narnode = readFileSync(join(import.meta.dir, '..', '..', 'server', 'content', 'scripts', 'quests', 'quest_mm', 'scripts', 'mm_narnode.rs2'), 'utf8');
        const menu = (fn: string) => [...narnode.split('\n').find(l => l.includes(`~${fn}("What am I meant to do?"`))!.matchAll(/"([^"]+)"/g)].map(m => m[1]!);

        test("the talk's options are the script's own: the lost-seal option on the 4-option menu, then out by 'I'll be back later.' on the 3-option one", () => {
            const talk = narnodeTalk(started(atDoor(13))) as { choices: RegExp[] };
            expect(menu('p_choice4').filter(t => talk.choices[0]!.test(t))).toEqual(['I\'ve lost my copy of the Royal Seal...']);
            expect(menu('p_choice3').filter(t => talk.choices[0]!.test(t))).toEqual([]);
            expect(menu('p_choice3').filter(t => talk.choices[1]!.test(t))).toEqual(['I\'ll be back later.']);
            expect(talk.choices[0]).toBe(LOST_SEAL);
        });

        test('started, no seal, 1 free slot: A is admitted and picks the lost-seal option', () => {
            const s = started(atDoor(14));
            expect(28 - s.inventory.length).toBe(1);
            expect(narnodeTalk(s)).toEqual({ choices: [LOST_SEAL, expect.any(RegExp)], start: false });
            expect(a().preconditions(s, {} as MmContext)).toBe(true);
        });

        test("started, no seal, 0 free: the named refusal, from A's precondition and from narnodeTalk (run's check after the swap)", () => {
            const s = started(atDoor(15));
            expect(narnodeTalk(s)).toBe("S15:A needs 1 free slot for Narnode's spare seal (0 free)");
            expect(a().preconditions(s, {} as MmContext)).toBe("S15:A needs 1 free slot for Narnode's spare seal (0 free)");
        });

        test('not started: the start talk, unchanged; started with the seal held: no talk; past B (the orders held): refused', () => {
            expect(narnodeTalk(atDoor(13))).toEqual({ choices: [/^Yes$/], start: true });
            expect(a().preconditions(atDoor(13), {} as MmContext)).toBe(true);
            const sealed = started(atDoor(12));
            const withSeal = { ...sealed, inventory: [...sealed.inventory, { slot: 27, id: MM_OBJ.royalSeal, name: 'Royal seal', count: 1, optionsWithIndex: [] }] };
            expect(narnodeTalk(withSeal)).toBeNull();
            expect(a().preconditions(withSeal, {} as MmContext)).toBe(true);
            const pastB = { ...sealed, inventory: [...sealed.inventory, { slot: 27, id: MM_OBJ.orders, name: 'Orders', count: 1, optionsWithIndex: [] }] };
            expect(a().preconditions(pastB, {} as MmContext)).toBe('S15 is past B: Narnode no longer re-issues the royal seal');
        });

        test("a full pack is refused before the start talk too (the seal is given the same way); a held seal needs no slot", () => {
            expect(28 - atDoor(15).inventory.length).toBe(0);
            expect(narnodeTalk(atDoor(15))).toBe("S15:A needs 1 free slot for Narnode's seal (0 free)");
            expect(a().preconditions(atDoor(15), {} as MmContext)).toBe("S15:A needs 1 free slot for Narnode's seal (0 free)");
            expect(narnodeTalk(atDoor(14))).toEqual({ choices: [/^Yes$/], start: true });
            const sealed = started(atDoor(14));
            const full = { ...sealed, inventory: [...sealed.inventory, { slot: 27, id: MM_OBJ.royalSeal, name: 'Royal seal', count: 1, optionsWithIndex: [] }] };
            expect(28 - full.inventory.length).toBe(0);
            expect(narnodeTalk(full)).toBeNull();
        });
    });

    test("14 held: the runner's ask and gtSwap's want are both 1 shark, the swap brings 1, and the kit is complete at 15", async () => {
        const s = atDoor(14);
        expect(askFor(s, H12)).toEqual([{ item: expect.stringMatching(/shark/i), count: 1 }]);
        expect(h12Plan(s, { bow: BOW }).want).toEqual([{ item: /^Shark$/, amount: 1 }]);
        const r = await swapAt({ held: 14, hp: 42, asked: 'start' });
        expect(r.error).toBeNull();
        expect(r.asked).toBe(1);
        expect(sharksHeld(r.end)).toBe(H12_SHARKS);
        expect(kitMissing(r.end, BOW)).toEqual([]);
        expect(r.end.inventory.some(i => i.name === 'Knife')).toBe(false);
    });

    test("attempt 4: 3 held, 12 asked; poison takes HP under the eat threshold before h55 is in reach: no eat until the kit is checked, so it is complete at 15", async () => {
        const r = await swapAt({ held: 3, hp: 35, asked: 'start', inView: 3, hits: { 1: 30 } });
        expect(r.asked).toBe(12);
        expect(r.error).toBeNull();
        expect(r.eaten).toEqual([]);
        expect(sharksHeld(r.end)).toBe(H12_SHARKS);
        expect(kitMissing(r.end, BOW)).toEqual([]);
    });

    test("arriving at ~1 HP (attempt 4's T14-15b): upkeep's eat lands before the trade, the open-frame ask counts it, and the kit is complete at 15", async () => {
        const r = await swapAt({ held: 3, hp: 1, asked: 'open' });
        expect(r.error).toBeNull();
        expect(r.eaten.length).toBeGreaterThan(0);
        expect(r.eaten.every(t => r.firstClick !== null && t < r.firstClick)).toBe(true);
        expect(r.end.player!.hp).toBeGreaterThanOrEqual(SEGMENT_EATING.otherwise);
        expect(sharksHeld(r.end)).toBe(H12_SHARKS);
        expect(kitMissing(r.end, BOW)).toEqual([]);
    });

    test('an ask sized before that eat (at the step start) cannot cover the want: the swap refuses inside the trade and never completes short', async () => {
        const r = await swapAt({ held: 3, hp: 1, asked: 'start' });
        expect(r.error).toMatch(/the Grand Tree swap with Helper failed/);
        expect(sharksHeld(r.end)).toBeLessThan(H12_SHARKS);
    });
});

describe('an H12o receive leg under upkeep: the eat lands before the leg is sized, and none lands between the sizing and the trade', () => {
    const SHARK = MM_OBJ.shark;
    const helper = { kind: 'player', index: 7, name: 'Helper', combatLevel: 60, x: 2802, z: 2724 } as BotWorldState['nearbyPlayers'][number];
    const shark = (slot: number): InventoryItem => ({ slot, id: SHARK, name: 'Shark', count: 1, optionsWithIndex: [{ text: 'Eat', opIndex: 1 }] });

    test('arriving at 1 HP with sharks held: every eat is clicked and landed before the sizing, and the trade sees the pack the leg was sized on', async () => {
        const sdk = new FakeSdk(baseState({
            tick: 1, autoRetaliateEnabled: false, nearbyPlayers: [helper], inventory: Array.from({ length: 5 }, (_, i) => shark(i)),
            player: { name: 'scored', x: 2803, z: 2724, worldX: 2803, worldZ: 2724, level: 0, hp: 1, maxHp: 42, animId: -1 } as unknown as PlayerState,
        } as Partial<BotWorldState>));
        const eaten: number[] = [];
        let bite: number | null = null;
        sdk.onSend = a => {
            const it = a.method === 'sendUseItem' ? sdk.state!.inventory.find(i => i.slot === a.args[0]) : undefined;
            if (it?.id === SHARK) {
                eaten.push(sdk.state!.tick);
                bite = it.slot;
            }
        };
        const each = (cur: BotWorldState): Partial<BotWorldState> => {
            if (bite === null) return {};
            const slot = bite;
            bite = null;
            return { inventory: cur.inventory.filter(i => i.slot !== slot), player: { ...cur.player!, hp: Math.min(42, cur.player!.hp + 20) } };
        };
        const sized: Array<{ tick: number; sharks: number }> = [];
        const size: typeof mLegSize = s => {
            sized.push({ tick: s.tick, sharks: s.inventory.filter(i => i.id === SHARK).length });
            return mLegSize(s);
        };
        const calls: Array<{ tick: number; sharks: number }> = [];
        const receive: Receive = async s => {
            const st = s.getState()!;
            calls.push({ tick: st.tick, sharks: st.inventory.filter(i => i.id === SHARK).length });
            return { ok: true, ticks: 4, received: [{ slot: -1, id: SHARK, name: 'Shark', count: 9 }] } as ReceiveResult;
        };
        setStepNote(() => {});
        const r = await drive(sdk, upkeep(sdk as never, () => receiveLeg(sdk as never, 'Helper', 'M', size, { receive, cueDir: mkdtempSync(join(tmpdir(), 'mm-eat-')) })), 100, each);
        expect(r.ok).toBe(true);
        expect(eaten.length).toBeGreaterThan(0);
        expect(sized).toHaveLength(1);
        // An eat lands a tick after its click: each one is in the pack the leg was sized on.
        expect(eaten.every(t => t + 1 <= sized[0]!.tick)).toBe(true);
        expect(calls).toEqual([{ tick: sized[0]!.tick, sharks: sized[0]!.sharks }]);
        expect(sdk.state!.inventory.filter(i => i.id === SHARK)).toHaveLength(sized[0]!.sharks);
    });
});
