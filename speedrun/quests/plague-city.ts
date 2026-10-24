// Plague City: STEP-MANIFEST.md entry 18 (S08).
//
// From Edmond's arrival tile (2568,3334), where T07-08's Camelot teleport and run leave SCORED, to
// the magic scroll read, which unlocks the Ardougne teleport that T08-09 casts. The route is
// docs/speedrun/scripts/quest-plague-city-segments.ts (plague_city.md's step list), one segment per
// durable stage or travel leg, A to Z.
//
// What the content does that the module is built around (server/content/scripts/quests/quest_elena
// unless named):
// - The quest tab shows only started / complete. Every stage but three has a journal marker
//   (quest-stages.ts): 3-6 share one line, 20-21 have none, 24-25 share one and 29-30 share one. So
//   `done` reads the `journal:elena` probe and, where the journal cannot tell, the inventory (the
//   book Ted takes at 21) or the position (Bravek's room opens only at 25).
// - Alrena grinds the berries in two p_delay(2)s with the chat closed (alrena.rs2:17-22), so her
//   conversation waits for the gas mask, not for a quiet tick.
// - Each bucket of water poured (mud_patch.rs2:41-50) and the cure's two mixes (cakes.rs2:131-143)
//   end on a message box with nothing after it. The next click closes it (Player.clearPendingAction
//   closes the modal), so the pours chain without a continue.
// - Ted only answers the door while he is within 7 tiles of the player (doors.rs2:96), the mourner
//   only speaks at the plague house door while within 14 (doors.rs2:16, :31), and the clerk only
//   advances the quest while Bravek is within 7 tiles of the player when its last page runs
//   (clerk.rs2:52). Each is checked from the dialogue's transcript and retried.
// - The gas mask must be worn to climb the pipe (sewerpipe.rs2:5); nothing in West Ardougne checks
//   it after that.
// - Edmond's reward is queued after his last page (edmond.rs2:41, quest_elena.rs2:4-15): it takes
//   the picture, key, warrant, note and book, adds the magic scroll and 2,425 Mining (one level-up
//   page) and opens the quest-complete scroll.
// - The quest is complete at %elenaquest 29, but the Ardougne teleport needs 30
//   (teleport.rs2:35), set only by reading the scroll (elena_teleport_scroll.rs2:11-15): an objbox
//   ('You memorise what is written on the scroll.'), then the scroll is deleted and a mesbox
//   ('You can now cast the Ardougne Teleport spell'). Read at any other stage the scroll burns and
//   is deleted too, so the read is judged by its pages, never by the scroll leaving alone.
// - Every var is scope=perm, and elena_pipe_used is a 6-tick pipe cooldown: logout-safe throughout.
//
// The exit drops (the slot ledger's T08-09 drops, moved into the step): the spade, the four empty
// buckets and the gas mask (taken off first), and any other quest leftover. H6's 2 law runes stay
// for T08-09's Ardougne teleport, which takes its water from the worn staff of water.

import type { BotSDK } from '../../sdk/index';
import type { BotWorldState, QuestJournalState } from '../../sdk/types';
import { act, actConverse, dropItems, opLoc, openDoor, pickup, talkTo, useOn, wield, type ActSdk } from '../lib/act';
import { converse, levelUpInterrupt, type ConverseResult, type ConverseSdk } from '../lib/converse';
import { classifyPage, clickContinue, clickOption, findOption, pageText, type OptionPattern } from '../lib/dialogue';
import type { ItemPattern } from '../lib/items';
import { journalProbeName, questStatus, requireQuestStage, type QuestView, type StageName } from '../lib/quests';
import { logNote } from '../lib/ticks';
import { inArea, runTo, type Area, type TravelSdk } from '../lib/travel';
import { currentTick, waitOrThrow, waitUntil, type Pred } from '../lib/wait';
import { chebyshev, configId, findNpc, invCount, invItem, opIndex, pos, waitForNpc, worn, type LocQuery } from '../lib/world';
import type { Check, Observed, StepContext } from '../runner/step';
import { allOf, baseLevels, inBox, kitSegment, kitWant, questSteps, slotsCover, talkShape, type Box, type KitItem, type QuestItem, type QuestOptions, type Segment } from './segments';

export const quest = 'elena' as const;
export const stepId = 'S08';

export type Options = QuestOptions;

// ------------------------------------------------------------------ places

/** T07-08's landing beside Edmond (legs.ts `T.edmond`, tolerance 1). */
export const ARRIVAL: Area = { x: 2568, z: 3334, tol: 1 };
export const EDMOND_AT = { x: 2568, z: 3334 } as const;
export const ALRENA_AT = { x: 2573, z: 3333 } as const;
/** The picture's ground spawn in Edmond's house (maps/m40_52.jm2, obj 1510). */
export const PICTURE_AT = { x: 2576, z: 3334 } as const;
/** East of the mud patch, beside it (2566,3331-3333). */
export const MUD_STAND: Area = { x: 2567, z: 3332, tol: 0 };
/**
 * Beside the grill (sewer pipe 2530,9701, 2 wide): the manhole's landing tile (2530,9703) or next to
 * it. The pipe's own front tile (2530,9702) is blocked to the walker (m); the pipe ops path there.
 */
export const PIPE_STAND: Area = { x: 2530, z: 9703, tol: 1 };
/** Edmond waits in the sewer at (2535,9719). */
export const SEWER_EDMOND_AT = { x: 2535, z: 9719 } as const;
/** Where the pipe drops SCORED in West Ardougne (^quest_elena_west_ardy_manhole_tele_coord). */
export const MANHOLE_EXIT = { x: 2529, z: 3304 } as const;
export const JETHICK_AT = { x: 2540, z: 3305 } as const;
/** Outside the Rehnisons' door (2531,3328). */
export const REHNISON_OUT: Area = { x: 2531, z: 3327, tol: 0 };
export const TED_AT = { x: 2531, z: 3331 } as const;
export const MILLI_AT = { x: 2531, z: 3330 } as const;
/** Outside the plague house door (2533,3272). */
export const PLAGUE_OUT: Area = { x: 2533, z: 3273, tol: 0 };
/**
 * East of the clerk, who stands behind his desk at (2528,3317): talked to from here SCORED stays put
 * (m, lab probe), and Bravek's spawn (2536,3314) is inside the script's 7-tile reach. A talk from
 * anywhere else is walked round to (2527,3317), from where Bravek must stand at x 2534 or less (m:
 * 1 try in 3 landed). (2529,3316) is blocked to the walker, and a run stalled there opens Bravek's
 * door, which only says 'Go away' below stage 25.
 */
export const CLERK_STAND: Area = { x: 2529, z: 3317, tol: 0 };
export const CLERK_AT = { x: 2528, z: 3317 } as const;
export const BRAVEK_AT = { x: 2536, z: 3314 } as const;
/** Inside Bravek's room, beside him (the run opens his door on the way). */
export const BRAVEK_STAND: Area = { x: 2535, z: 3314, tol: 1 };
export const ELENA_AT = { x: 2541, z: 9672 } as const;
/** Beside the manhole in West Ardougne (2529,3303). */
export const MANHOLE_STAND: Area = { x: 2529, z: 3304, tol: 0 };
/** Beside the mud pile in the sewer (2561,9738); the climb lands in the garden (2566,3331). */
export const MUD_PILE_STAND: Area = { x: 2561, z: 9737, tol: 1 };
export const EDMOND_STAND: Area = { x: 2567, z: 3333, tol: 1 };

/**
 * Regions, judged by coordinates only (never by what is in sight: after a reconnect the first state
 * has no scene). East: Edmond's house and garden by the wall. West: West Ardougne inside its wall,
 * ground floor (the Rehnisons' upstairs is level 1). The sewer and the plague house basement are
 * both underground (z above 9000), the basement south of the sewer.
 */
export const EAST: Box = { x0: 2558, z0: 3318, x1: 2590, z1: 3350 };
export const WEST: Box = { x0: 2505, z0: 3260, x1: 2557, z1: 3340 };
export const SEWER: Box = { x0: 2510, z0: 9690, x1: 2575, z1: 9760 };
export const BASEMENT: Box = { x0: 2528, z0: 9660, x1: 2548, z1: 9684 };
/** The plague house's ground floor, inside its door (2533,3272). */
export const PLAGUE_HOUSE: Box = { x0: 2530, z0: 3262, x1: 2541, z1: 3271 };
/** The Rehnisons' house inside its door (2531,3328), ground floor; upstairs is the same box on level 1. */
export const REHNISON: Box = { x0: 2524, z0: 3329, x1: 2536, z1: 3336 };
export const REHNISON_UP: Box = { ...REHNISON, level: 1 };
/** Bravek's room, east of his door (2530,3314). */
export const BRAVEK_ROOM: Box = { x0: 2530, z0: 3309, x1: 2541, z1: 3319 };
/** Elena's cell, east of its door (2539,9672). */
export const CELL: Box = { x0: 2540, z0: 9668, x1: 2545, z1: 9676 };

export const inEast = (s: BotWorldState) => inBox(s, EAST);
export const inSewer = (s: BotWorldState) => inBox(s, SEWER);
export const inBasement = (s: BotWorldState) => inBox(s, BASEMENT);
export const inPlagueHouse = (s: BotWorldState) => inBox(s, PLAGUE_HOUSE);
export const inRehnison = (s: BotWorldState) => inBox(s, REHNISON) || inBox(s, REHNISON_UP);
export const inBravekRoom = (s: BotWorldState) => inBox(s, BRAVEK_ROOM);
export const inCell = (s: BotWorldState) => inBox(s, CELL);
/** In West Ardougne on either floor, the houses included. */
export const inWest = (s: BotWorldState) => inBox(s, WEST) || inBox(s, REHNISON_UP);
/** In West Ardougne's streets: not inside the Rehnisons', Bravek's or the plague house. */
export const inWestStreets = (s: BotWorldState) => inBox(s, WEST) && !inRehnison(s) && !inBravekRoom(s) && !inPlagueHouse(s);

// ------------------------------------------------------------------ things

/** Quest objs by config id (the inventory names repeat across objs: three are called 'Bucket of water'). */
export const ITEM = {
    dwellberries: configId('obj', 'dwellberries'),
    water: configId('obj', 'bucket_water'),
    bucket: configId('obj', 'bucket_empty'),
    spade: configId('obj', 'spade'),
    rope: configId('obj', 'rope'),
    dust: configId('obj', 'chocolate_dust'),
    milk: configId('obj', 'bucket_milk'),
    chocMilk: configId('obj', 'chocolaty_milk'),
    snape: configId('obj', 'snape_grass'),
    cure: configId('obj', 'hangover_cure'),
    gasmask: configId('obj', 'gasmask'),
    picture: configId('obj', 'elena_picture'),
    book: configId('obj', 'turnip_book'),
    note: configId('obj', 'scruffy_note'),
    warrant: configId('obj', 'warrant'),
    key: configId('obj', 'elenakey'),
    scroll: configId('obj', 'ardougnescroll'),
    law: /^law rune$/i,
} as const;

/** Locs by config id (loc.pack). */
export const LOC = {
    // maps/m40_52.jm2: plaguemudpatch1 at (2566,3331) and (2566,3333), plaguemudpatch2 between them.
    mudPatch: { x: 2566, z: 3332, id: configId('loc', 'plaguemudpatch2') },
    mudPile: { x: 2561, z: 9738, id: configId('loc', 'plaguemudpile') },
    pipe: { x: 2530, z: 9701, id: configId('loc', 'plaguesewerpipe') },
    manholeClosed: { x: 2529, z: 3303, id: configId('loc', 'plaguemanholeclosed') },
    manholeOpen: { x: 2529, z: 3303, id: configId('loc', 'plaguemanholeopen') },
    rehnisonDoor: { x: 2531, z: 3328, id: configId('loc', 'rehnisondoorshut') },
    stairsUp: { x: 2527, z: 3332, id: configId('loc', 'rehnisonstairs') },
    stairsTop: { id: configId('loc', 'rehnisonstairstop') },
    plagueDoor: { x: 2533, z: 3272, id: configId('loc', 'loc_2535') },
    barrel: { x: 2534, z: 3268, id: configId('loc', 'plaguekeybarrel') },
    basementDown: { x: 2536, z: 3268, id: configId('loc', 'plaguehousestairsdown') },
    basementUp: { x: 2536, z: 9671, id: configId('loc', 'plaguehousestairsup') },
    cellDoor: { x: 2539, z: 9672, id: configId('loc', 'elenagateshut') },
} as const;

/** The segment letters in order, for the free-slot need. */
export const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'] as const;
type Letter = (typeof LETTERS)[number];

/**
 * H6 as this step uses it (SUPPLIES.md H6; the slot ledger's row H6): the quest's items and the
 * law runes for T08-09's Ardougne cast (2), which come in the same trade. No water runes: SCORED
 * wears H1's staff of water until H7, and the cast takes its water from it. The kit check counts
 * held items only (segments.ts kitWant), so a line here is exactly what the trade delivers. The
 * Camelot runes are no longer in it: T07-08's come in H4e.
 */
export const KIT: readonly KitItem[] = [
    { item: /^dwellberries$/i },
    // By name, as the trade offers it; the pours check the obj (bucket_water) itself.
    { item: /^bucket of water$/i, n: 4 },
    { item: /^spade$/i },
    { item: /^rope$/i },
    { item: /^chocolate dust$/i },
    { item: /^bucket of milk$/i },
    { item: /^snape grass$/i },
    { item: ITEM.law, n: 2 },
];

/**
 * Everything the step holds, for the free-slot checks (brief addendum 8). The water buckets come
 * back empty in place (one per pour) and are dropped at Z, so they are one line; the milk becomes
 * the chocolaty milk and then the hangover cure in place, which Bravek takes at S. Edmond's reward
 * (Y) takes the picture, note, warrant and key and adds the scroll, read at Z. The gas mask is worn
 * at K, which frees its slot, and comes off at Z to be dropped. Peak 2 with the kit held (the
 * picture and the gas mask at D); 13 without it.
 */
export const QUEST_ITEMS: readonly QuestItem[] = [
    // alrena.rs2:24
    { item: ITEM.dwellberries, name: 'Dwellberries', from: 'A', until: 'D' },
    // mud_patch.rs2:41-42 (the slot keeps an empty bucket), dropped at the exit.
    { item: /^bucket( of water)?$/i, name: 'Bucket (of water, then empty)', n: 4, from: 'A', until: 'Z' },
    { item: ITEM.spade, name: 'Spade', from: 'A', until: 'Z' },
    // sewerpipe.rs2:25
    { item: ITEM.rope, name: 'Rope', from: 'A', until: 'I' },
    // cakes.rs2:131-142; bravek.rs2:63
    { item: ITEM.dust, name: 'Chocolate dust', from: 'A', until: 'F' },
    { item: ITEM.snape, name: 'Snape grass', from: 'A', until: 'F' },
    { item: /^(bucket of milk|chocolaty milk|hangover cure)$/i, name: 'Bucket of milk (then the hangover cure)', from: 'A', until: 'S' },
    { item: ITEM.law, name: 'Law rune', stackable: true, from: 'A' },
    // quest_elena.rs2:6-10 takes these back at the completion (Y).
    { item: ITEM.picture, name: 'Picture', from: 'C', until: 'Y' },
    { item: ITEM.gasmask, name: 'Gas mask', from: 'D', until: 'K' },
    { item: ITEM.book, name: 'Book', from: 'L', until: 'M' },
    { item: ITEM.note, name: 'A scruffy note', from: 'R', until: 'Y' },
    { item: ITEM.warrant, name: 'Warrant', from: 'S', until: 'Y' },
    { item: ITEM.key, name: 'A small key', from: 'U', until: 'Y' },
    // quest_elena.rs2:11, read at Z (elena_teleport_scroll.rs2:14 deletes it).
    { item: ITEM.scroll, name: 'A magic scroll', from: 'Y', until: 'Z' },
    // Taken off at Z to be dropped: it needs its slot back for a moment.
    { item: ITEM.gasmask, name: 'Gas mask (taken off)', from: 'Z', until: 'Z' },
];
const slots = (at: Letter) => slotsCover(QUEST_ITEMS, LETTERS, at);

/**
 * What S08 leaves that nothing later uses, dropped at its exit: the spade, the empty buckets and the
 * gas mask, and anything of the quest a stray step left (a water bucket, the rope, the cure's
 * ingredients, the quest papers). The H6 runes, the knife and S07's log are not quest items.
 */
export const DEAD_AT_EXIT: readonly number[] = [
    ITEM.spade, ITEM.bucket, ITEM.gasmask, ITEM.water, ITEM.rope, ITEM.dust, ITEM.milk, ITEM.chocMilk, ITEM.snape, ITEM.cure,
    ITEM.dwellberries, ITEM.picture, ITEM.book, ITEM.note, ITEM.warrant, ITEM.key,
];
export const isDead = (i: { id: number }) => DEAD_AT_EXIT.includes(i.id);

// ------------------------------------------------------------------ conversations (CONVENTIONS.md shapes, read from the scripts)

export const SHAPES = {
    /** Edmond at 0 (edmond.rs2:3-8, :63-80): the stage is set after "Where can I find these Dwellberries?". */
    edmondStart: '4c, opt, 4c, opt, 4c, state, 2c',
    /** Alrena at 1 with the berries (alrena.rs2:9-29): the objbox closes the chat for the two grinds. */
    alrena: '3c, state, 3c',
    /** Edmond at 2 (edmond.rs2:19-23). */
    edmondMask: '1c, state, 1c',
    /** Edmond in the sewer at 9 (edmond.rs2:27-32): the stage is set after his last page. */
    sewerEdmond: '3c, state',
    /** Jethick at 10 with the picture (jethick.rs2:6-30): the stage after the picture's objbox, the book after the errand page. */
    jethick: '1c, opt, 4c, state, 3c, state, 1c',
    /** The Rehnisons' door at 20 with the book (doors.rs2:91-118): if_close and the door's teleport after "come in then". */
    tedDoor: '2c, state, 2c',
    /** Ted at 21 (rehnisons.rs2:16-22). */
    ted: '1c, state, 1c',
    /** Milli at 22 (rehnisons.rs2:36-45). */
    milli: '2c, state, 2c',
    /** The plague house door at 23 with the mourner in range (doors.rs2:10-18, :73-90). */
    plagueDoor: '2c, opt, 3c, state, 1c',
    /** The clerk at 24 (clerk.rs2:3-6, :40-56): the stage is decided after "Mr Bravek, there's a ...". */
    clerk: '1c, opt, 2c, opt, 2c, state, 1c',
    /** Bravek at 25 (bravek.rs2:13-48). */
    bravekNote: '1c, opt, 2c, opt, 1c, state, 1c',
    /** Bravek at 26 with the cure (bravek.rs2:55-90). */
    bravekWarrant: '1c, state, 4c, opt, 3c, state, 1c',
    /** The plague house door at 27 with the warrant (doors.rs2:20-45): the door teleport before the last page. */
    warrantDoor: '2c, state, 1c',
    /** Elena at 27 (elena.rs2:4-9). */
    elena: '2c, state, 1c',
    /** Edmond at 28 (edmond.rs2:38-41): the reward is queued after his last page. */
    reward: '2c',
    /** The magic scroll at 29 (elena_teleport_scroll.rs2:11-15). */
    scroll: 'state, 1c',
} as const;

export const CHOICES = {
    edmondStart: [/^What's happened to her\?/i, /^Can I help find her\?/i] as OptionPattern[],
    jethick: [/looking for a woman from East Ardougne/i] as OptionPattern[],
    plagueDoor: [/^I fear not a mere plague/i] as OptionPattern[],
    clerk: [/need permission to enter a plague house/i, /^This is urgent though/i] as OptionPattern[],
    bravekNote: [/^This is really important though/i, /what is in the cure/i] as OptionPattern[],
    bravekWarrant: [/^They won't listen to me/i] as OptionPattern[],
};

/** What a page says when the step it belongs to has worked. */
export const LANDED = {
    /** doors.rs2:89-90: the stage is set before the mourner's last page. */
    plagueDoor: /hopes up|you'd need to apply/i,
    /** clerk.rs2:54 (24 -> 25), or clerk.rs2:58 when the stage was already 25. */
    clerk: /can come in then|will see you now/i,
    /** elena_teleport_scroll.rs2:11 and :15. */
    scrollRead: /memorise what is written|can now cast the Ardougne Teleport/i,
    scrollBurnt: /bursts into flame/i,
};

/** Clerk tries before the step fails. */
export const CLERK_TRIES = 3;
/** clerk.rs2:52 `.npc_find(coord, bravek, 7, 0)`: Bravek within 7 tiles of the player when the page after "Mr Bravek ..." runs. */
export const BRAVEK_REACH = 7;
/** Ticks the clerk's "Mr Bravek ..." page is held open waiting for Bravek to come within reach before it is answered anyway. */
export const BRAVEK_HOLD = 30;
/** The clerk's page after which the script looks for Bravek. */
export const CLERK_CALLS = /Mr\s*Bravek there's a/i;

// ------------------------------------------------------------------ resume evidence

const JOURNAL = journalProbeName(quest);
const stateOf = (o: QuestView): BotWorldState => ('probed' in o ? o.state : o);
const atLeast = (o: QuestView, stage: StageName<typeof quest>) => requireQuestStage(o, quest, stage, { atLeast: true }) === true;
const holds = (o: QuestView | BotWorldState, item: ItemPattern) => invCount(stateOf(o), item) > 0;
const wearsMask = (s: BotWorldState) => worn(s, ITEM.gasmask) !== null;
const started = (s: BotWorldState) => questStatus(s, quest) === 'started';
const complete = (s: BotWorldState) => questStatus(s, quest) === 'complete';

// ------------------------------------------------------------------ helpers

type Ctx = StepContext<any>;
type Sdk = TravelSdk & ActSdk & ConverseSdk & Pick<BotSDK, 'sendUseEquipmentItem'>;
const sdkOf = (ctx: Ctx) => ctx.sdk as unknown as Sdk;
const interrupts = () => [levelUpInterrupt()];
const note = (ctx: Ctx, seg: Letter, meta: Record<string, unknown>) => logNote(ctx.log, ctx.session, `${stepId}:${seg}`, meta);

function fail(seg: Letter, why: string, sdk?: Sdk): never {
    throw new Error(`${stepId}:${seg}: ${why}${sdk ? ` at ${JSON.stringify(pos(sdk))}` : ''}`);
}

/** Run to `to`, retrying a run that ends short ('no tick', a stall): ok only inside the area. */
async function go(ctx: Ctx, seg: Letter, to: Area, what: string): Promise<void> {
    const sdk = sdkOf(ctx);
    let why = '';
    for (let i = 0; i < 3; i++) {
        if (inArea(sdk, to)) return;
        const r = await runTo(sdk, to, { bot: ctx.bot });
        if (r.ok) return;
        why = r.reason ?? 'not arrived';
    }
    if (!inArea(sdk, to)) fail(seg, `run to ${what} (${to.x},${to.z}) failed (${why})`, sdk);
}

/** Record a conversation's shape against the expected one, for the lab report. */
function noteShape(ctx: Ctx, seg: Letter, who: string, r: ConverseResult, extra: Record<string, unknown> = {}): void {
    note(ctx, seg, {
        who, pages: r.pages, options: r.options, ticks: r.ticks,
        ...(r.levelUps ? { levelUps: r.levelUps } : {}),
        ...(r.shape ? { shape: r.shape.seen, expected: r.shape.expected, matches: r.shape.matches, bursts: r.shape.bursts, failedBursts: r.shape.failedBursts } : {}),
        ...extra,
    });
}

function ensure(seg: Letter, who: string, r: ConverseResult, sdk?: Sdk): ConverseResult {
    if (!r.opened) fail(seg, `${who}: no dialogue opened`, sdk);
    if (!r.ok) fail(seg, `${who}: ${r.reason}`, sdk);
    return r;
}

const saw = (r: ConverseResult, re: RegExp) => r.transcript.some(l => re.test(l));

interface TalkSpec {
    who: string;
    npc: RegExp;
    near: { x: number; z: number };
    choices?: OptionPattern[];
    shape: string;
    until?: Pred;
    maxTicks?: number;
}

/** Talk to an NPC and answer it to the end of its shape. */
async function talk(ctx: Ctx, seg: Letter, opts: Options | undefined, t: TalkSpec, extra: Record<string, unknown> = {}): Promise<ConverseResult> {
    const sdk = sdkOf(ctx);
    const r = await talkTo(sdk, t.npc, t.choices ?? [], {
        near: t.near, interrupts: interrupts(), unmatched: 'stop', idle: 1, maxTicks: t.maxTicks ?? 120,
        ...(t.until ? { until: t.until } : {}), ...talkShape(opts, t.shape),
    });
    ensure(seg, t.who, r, sdk);
    noteShape(ctx, seg, t.who, r, { clicks: r.clicks, ...extra });
    return r;
}

interface LocTalkSpec {
    what: string;
    loc: LocQuery;
    op?: RegExp | number;
    choices?: OptionPattern[];
    shape: string;
    /** The conversation is over only once this holds with the chat closed. */
    until?: Pred;
    maxTicks?: number;
}

/**
 * A loc op that opens a dialogue: click (re-sent only after act's idle window), then answer it.
 * Records the click-to-dialogue ticks the browser follow-up needs (brief addendum 11).
 */
async function locTalk(ctx: Ctx, seg: Letter, opts: Options | undefined, t: LocTalkSpec): Promise<ConverseResult> {
    const sdk = sdkOf(ctx);
    const t0 = currentTick(sdk);
    const click = await opLoc(sdk, { radius: 20, ...t.loc }, t.op ?? 1, s => s.dialog.isOpen, { maxTicks: 30, interrupts: interrupts() });
    if (!click.ok) fail(seg, `${t.what}: no dialogue within 30 ticks of the click`, sdk);
    const r = await converse(sdk, t.choices ?? [], {
        openTicks: 3, interrupts: interrupts(), unmatched: 'stop', idle: 1, maxTicks: t.maxTicks ?? 120,
        ...(t.until ? { until: t.until } : {}), ...talkShape(opts, t.shape),
    });
    if (!r.ok) fail(seg, `${t.what}: ${r.reason}`, sdk);
    noteShape(ctx, seg, t.what, r, { locOp: true, clickToDialogue: click.ticks, resends: click.resends, ticks: currentTick(sdk) - t0 });
    return r;
}

/** A loc op with no dialogue (stairs, the manhole, the mud pile, the pipe): click until `arrived`. */
async function locMove(ctx: Ctx, seg: Letter, what: string, loc: LocQuery, arrived: Pred, maxTicks = 20, op: RegExp | number = 1): Promise<void> {
    const sdk = sdkOf(ctx);
    if (arrived(sdk.getState()!)) return;
    const r = await opLoc(sdk, { radius: 20, ...loc }, op, arrived, { maxTicks, interrupts: interrupts() });
    if (!r.ok) fail(seg, `${what}: no arrival within ${maxTicks} ticks`, sdk);
    note(ctx, seg, { loc: what, clickToEffect: r.ticks, resends: r.resends });
}

// ------------------------------------------------------------------ segment runs

/**
 * Edmond's house (maps/m40_52.jm2): its west wall runs along x 2570 with a door at (2570,3333);
 * Edmond waits in the garden outside it, Alrena in the first room, the picture behind a second door
 * at (2574,3333). Both are ordinary doors that shut again on their own, so a talk or a pickup across
 * one finds no route (m: Edmond's 'no dialogue opened' from Alrena's room).
 */
export const HOUSE_DOORS = [{ x: 2570, z: 3333 }, { x: 2574, z: 3333 }] as const;

/**
 * The house doors crossed walking from x `from` to x `to`, in walking order. A door's wall is on its
 * tile's east edge (loc 1530 rotation 2 at 2570,3333; the west wall is loc 1602 rotation 2 along x
 * 2570), so the door tile itself is on the garden side.
 */
export function doorsBetween(from: number, to: number): Array<{ x: number; z: number }> {
    const doors = HOUSE_DOORS.filter(d => Math.min(from, to) <= d.x && d.x < Math.max(from, to));
    return from < to ? doors : [...doors].reverse();
}

/** Open each house door between SCORED and x `toX`. */
async function houseDoors(ctx: Ctx, seg: Letter, toX: number): Promise<void> {
    const sdk = sdkOf(ctx);
    for (const d of doorsBetween(pos(sdk).x, toX)) {
        const t0 = currentTick(sdk);
        const r = await openDoor(sdk, d.x, d.z);
        if (!r.ok) fail(seg, `the house door at ${d.x},${d.z} did not open`, sdk);
        if (r.ticks) note(ctx, seg, { loc: `the house door ${d.x},${d.z}`, clickToOpen: currentTick(sdk) - t0, resends: r.resends });
    }
}

/** Edmond as a talk picks him: the one nearest his spawn. */
export const edmondOf = (s: BotWorldState) => findNpc(s, /^edmond$/i, EDMOND_AT);

/** How many more times toEdmond looks for Edmond when he has moved off the tile it walked to. */
export const EDMOND_REFINDS = 2;

/**
 * Before a talk to Edmond (B, E, Y): open the house doors between SCORED and his live tile, then run
 * to within 1 of it. Edmond wanders 5 tiles from his spawn (edmond.npc sets no wanderrange, so
 * NpcType's default), which takes him into Alrena's room through the west door while it stands open.
 * The door then shuts on its own, the client finds no route to him and every Talk-to click goes
 * unrouted: the live B of run-20261024-022859 failed so, 'no dialogue opened' against the door at
 * (2570,3333) after 48 ticks, and the lab reproduces it with Edmond shut in (2 of 2).
 */
async function toEdmond(ctx: Ctx, seg: Letter): Promise<void> {
    const sdk = sdkOf(ctx);
    for (let i = 0; i <= EDMOND_REFINDS; i++) {
        const e = await waitForNpc(sdk, /^edmond$/i, 10, EDMOND_AT);
        if (!e) fail(seg, 'Edmond is not in sight', sdk);
        await houseDoors(ctx, seg, e.x);
        const beside: Area = { x: e.x, z: e.z, tol: 1 };
        if (inArea(sdk, beside)) return;
        const r = await runTo(sdk, beside, { bot: ctx.bot });
        const now = edmondOf(sdk.getState()!);
        if (r.ok && now && chebyshev(now, pos(sdk)) <= 1) return;
    }
    note(ctx, seg, { edmond: `moved off each tile walked to (${EDMOND_REFINDS + 1} finds); talking from here` });
}

/** C: the picture from its ground spawn in Edmond's house (the run opens the inner door). */
async function picture(ctx: Ctx): Promise<void> {
    const sdk = sdkOf(ctx);
    if (holds(sdk.getState()!, ITEM.picture)) return;
    await houseDoors(ctx, 'C', PICTURE_AT.x);
    await go(ctx, 'C', { ...PICTURE_AT, tol: 1 }, 'the picture');
    // A taken picture respawns (a ground spawn); wait for it rather than fail at once.
    const seen = await waitUntil(sdk, s => s.groundItems.some(g => g.id === ITEM.picture), { maxTicks: 30 });
    if (!seen.ok) fail('C', 'no picture on the ground in Edmond\'s house within 30 ticks', sdk);
    const r = await pickup(sdk, ITEM.picture, { maxTicks: 20 });
    if (!r.ok) fail('C', `the picture was not picked up (${r.reason})`, sdk);
    note(ctx, 'C', { clickToPicture: r.ticks, resends: r.resends });
}

/** F: chocolate dust into the milk, snape grass into the chocolaty milk. Each mix ends on an objbox the next click closes. */
async function cure(ctx: Ctx): Promise<void> {
    const sdk = sdkOf(ctx);
    const t0 = currentTick(sdk);
    if (!holds(sdk.getState()!, ITEM.cure)) {
        if (!holds(sdk.getState()!, ITEM.chocMilk)) {
            const a = await useOn(sdk, ITEM.dust, { item: ITEM.milk }, s => holds(s, ITEM.chocMilk), { maxTicks: 10 });
            if (!a.ok) fail('F', `the chocolate dust did not mix into the milk (${a.reason})`, sdk);
        }
        const b = await useOn(sdk, ITEM.snape, { item: ITEM.chocMilk }, s => holds(s, ITEM.cure), { maxTicks: 10 });
        if (!b.ok) fail('F', `the snape grass did not mix into the chocolaty milk (${b.reason})`, sdk);
    }
    // The last objbox is left for the next click to close, unless nothing follows soon: close it now.
    note(ctx, 'F', { ticks: currentTick(sdk) - t0 });
}

/** mud_patch.rs2: the pages a use on the patch shows when it does not pour. */
const MUD_REFUSED = /no reason to do that|soft enough already/i;
/** mud_patch.rs2:16-22: the dig's objbox, whatever the stage. */
const DIG_PAGE = /you dig|filled in/i;

/** G: the four buckets of water on the mud patch (3 -> 7). Each pour's mesbox is closed by the next pour. */
async function mud(ctx: Ctx): Promise<void> {
    const sdk = sdkOf(ctx);
    await go(ctx, 'G', MUD_STAND, 'the mud patch');
    const pours: number[] = [];
    for (let i = 0; i < 4 && holds(sdk.getState()!, ITEM.water); i++) {
        const before = invCount(sdk, ITEM.water);
        // The pour swaps the slot's bucket of water for an empty bucket; the soft-enough page means the patch is done.
        // The previous pour's mesbox may still be open (this click closes it), so a page counts only by what it says.
        const r = await useOn(sdk, ITEM.water, { loc: LOC.mudPatch }, s => invCount(s, ITEM.water) < before || (s.dialog.isOpen && MUD_REFUSED.test(pageText(s.dialog))), { maxTicks: 15 });
        if (!r.ok) fail('G', `pour ${i + 1}: no effect (${r.reason})`, sdk);
        const s = sdk.getState()!;
        if (invCount(s, ITEM.water) >= before) {
            // A page with no pour: too early (stage 2) or already soft (stage 7).
            const text = pageText(s.dialog);
            await converse(sdk, [], { openTicks: 1, idle: 0 });
            if (/soft enough already/i.test(text)) break;
            fail('G', `the mud patch refused the water: ${text}`, sdk);
        }
        pours.push(r.ticks);
    }
    note(ctx, 'G', { pours });
}

/** H: dig the softened patch with the spade: objbox, the fall into the sewer, a mesbox (7 -> 8). */
async function dig(ctx: Ctx, opts: Options | undefined): Promise<void> {
    const sdk = sdkOf(ctx);
    if (inSewer(sdk.getState()!)) return;
    await go(ctx, 'H', MUD_STAND, 'the mud patch');
    const t0 = currentTick(sdk);
    // The last pour's mesbox may still be open (this click closes it): the dig's own objbox is told by its text.
    const r = await useOn(sdk, ITEM.spade, { loc: LOC.mudPatch }, s => inSewer(s) || (s.dialog.isOpen && DIG_PAGE.test(pageText(s.dialog))), { maxTicks: 15 });
    if (!r.ok) fail('H', `the spade opened nothing (${r.reason})`, sdk);
    const d = await converse(sdk, [], { openTicks: 2, idle: 0, until: inSewer, maxTicks: 20, interrupts: interrupts(), ...talkShape(opts, 'state, 1c') });
    if (!inSewer(sdk.getState()!)) fail('H', `the dig did not drop SCORED into the sewer (${d.transcript.join(' | ')})`, sdk);
    noteShape(ctx, 'H', 'the dig', d, { clickToDialogue: r.ticks, ticks: currentTick(sdk) - t0 });
}

/** I: run to the grill and tie the rope to it (8 -> 9). */
async function rope(ctx: Ctx): Promise<void> {
    const sdk = sdkOf(ctx);
    if (!holds(sdk.getState()!, ITEM.rope)) return;
    await go(ctx, 'I', PIPE_STAND, 'the sewer pipe');
    const r = await useOn(sdk, ITEM.rope, { loc: LOC.pipe }, s => !holds(s, ITEM.rope), { maxTicks: 15 });
    if (!r.ok) fail('I', `the rope was not tied to the grill (${r.reason})`, sdk);
    note(ctx, 'I', { clickToTied: r.ticks, resends: r.resends });
}

/** K: wear the gas mask and climb through the pipe into West Ardougne. */
async function pipe(ctx: Ctx): Promise<void> {
    const sdk = sdkOf(ctx);
    if (inWest(sdk.getState()!)) return;
    await go(ctx, 'K', PIPE_STAND, 'the sewer pipe');
    const w = await wield(sdk, ITEM.gasmask, { maxTicks: 10 });
    if (!w.ok) fail('K', `the gas mask did not go on (${w.reason})`, sdk);
    // ~forcewalk2 to the grill, the squeeze (agility_exactmove) and the telejump: a scripted move, no dialogue.
    await locMove(ctx, 'K', 'the sewer pipe', LOC.pipe, s => inWest(s), 25);
    note(ctx, 'K', { wear: w.ticks });
}

/** M: the Rehnisons' door with the book (20 -> 21): Ted, inside a 7-tile reach, lets SCORED in and takes it. */
async function tedDoor(ctx: Ctx, opts: Options | undefined): Promise<void> {
    const sdk = sdkOf(ctx);
    if (inRehnison(sdk.getState()!) && !holds(sdk.getState()!, ITEM.book)) return;
    await go(ctx, 'M', REHNISON_OUT, "the Rehnisons' door");
    for (let i = 0; i < 3; i++) {
        const r = await locTalk(ctx, 'M', opts, {
            what: "the Rehnisons' door", loc: LOC.rehnisonDoor, shape: SHAPES.tedDoor,
            // The door's if_close and teleport sit between "come in then" and the book's objbox.
            until: s => !holds(s, ITEM.book) && inRehnison(s),
        });
        if (!holds(sdk.getState()!, ITEM.book)) return;
        note(ctx, 'M', { tedOutOfReach: i + 1, transcript: r.transcript.slice(0, 2) });
        // doors.rs2:96: no Ted within 7 tiles, no answer. He wanders inside; give him a moment.
        await waitUntil(sdk, () => false, { maxTicks: 3 });
    }
    fail('M', 'Ted never answered the door', sdk);
}

/** O: up the Rehnisons' stairs, Milli (22 -> 23), and down again. */
async function milli(ctx: Ctx, opts: Options | undefined): Promise<void> {
    const sdk = sdkOf(ctx);
    const s0 = sdk.getState()!;
    if (s0.player && s0.player.level === 0 && !atLeast(s0, 'spoke_to_milli')) {
        await locMove(ctx, 'O', 'the Rehnisons\' stairs up', LOC.stairsUp, s => pos(s).level === 1);
    }
    if (pos(sdk).level === 1 && !atLeast(sdk.getState()!, 'spoke_to_milli')) {
        await talk(ctx, 'O', opts, { who: 'Milli', npc: /^milli/i, near: MILLI_AT, shape: SHAPES.milli });
    }
    await downstairs(ctx, 'O');
}

/** Down the Rehnisons' stairs if upstairs. */
async function downstairs(ctx: Ctx, seg: Letter): Promise<void> {
    if (pos(sdkOf(ctx)).level === 1) await locMove(ctx, seg, 'the Rehnisons\' stairs down', { ...LOC.stairsTop, radius: 8 }, s => pos(s).level === 0);
}

/** P: the plague house door at 23 (23 -> 24), retried while the mourner is out of his 14-tile reach. */
async function plagueDoor(ctx: Ctx, opts: Options | undefined): Promise<void> {
    const sdk = sdkOf(ctx);
    await downstairs(ctx, 'P');
    // From inside the Rehnisons' the run opens their door on its route: at 21 and later it just lets SCORED out (doors.rs2:94).
    await go(ctx, 'P', PLAGUE_OUT, 'the plague house door');
    for (let i = 0; i < 3; i++) {
        const r = await locTalk(ctx, 'P', opts, { what: 'the plague house door (the mourner)', loc: LOC.plagueDoor, choices: CHOICES.plagueDoor, shape: SHAPES.plagueDoor });
        if (saw(r, LANDED.plagueDoor)) return;
        note(ctx, 'P', { mournerOutOfReach: i + 1 });
        await waitUntil(sdk, () => false, { maxTicks: 3 });
    }
    fail('P', 'the mourner never spoke at the plague house door', sdk);
}

/** Bravek within the clerk's reach of the player (Chebyshev, as npc_find searches round the player's tile). */
export function bravekInReach(s: BotWorldState): boolean {
    const b = findNpc(s, /^bravek$/i, BRAVEK_AT);
    return !!b && !!s.player && s.player.level === 0 && chebyshev(pos(s), b) <= BRAVEK_REACH;
}

export interface ClerkTalk {
    landed: boolean;
    pages: number;
    options: number;
    /** Ticks "Mr Bravek ..." was held open for Bravek to come within reach. */
    held: number;
    bravekAtCall: { x: number; z: number } | null;
    from: { x: number; z: number };
    ticks: number;
}

/**
 * One talk with the clerk, answered a page per tick, except that the page after which the script
 * looks for Bravek ("Mr Bravek, there's a ... here") is held open until Bravek stands within 7 tiles
 * of SCORED, for at most BRAVEK_HOLD ticks: from CLERK_STAND he is usually in reach already, and the
 * hold covers his wandering east. converse cannot hold one page, hence this small driver.
 */
async function clerkTalk(sdk: Sdk): Promise<ClerkTalk> {
    const t0 = currentTick(sdk);
    const npc = await waitForNpc(sdk, /^clerk$/i, 10, CLERK_AT);
    if (!npc) throw new Error('no clerk in sight');
    const op = opIndex(npc, /^talk-to$/i) ?? 1;
    const open = await act(sdk, () => sdk.sendInteractNpc(npc.index, op), st => st.dialog.isOpen, { maxTicks: 20 });
    if (!open.ok) throw new Error('the clerk opened no dialogue');
    const queue = [...CHOICES.clerk];
    const out: ClerkTalk = { landed: false, pages: 0, options: 0, held: 0, bravekAtCall: null, from: pos(sdk), ticks: 0 };
    let answered = '';
    let answeredAt = -99;
    let closed = 0;
    for (let guard = 0; guard < 120; guard++) {
        const st = sdk.getState()!;
        const d = st.dialog;
        if (!d.isOpen) {
            if (++closed > 1) break;
        } else {
            closed = 0;
            const key = `${d.pageId ?? ''}|${pageText(d)}|${d.options.map(o => o.text).join('/')}`;
            // A page answered less than 4 ticks ago and still showing is our click in flight.
            const fresh = !d.isWaiting && !(key === answered && st.tick - answeredAt < 4);
            if (fresh) {
                const text = pageText(d);
                if (LANDED.clerk.test(text)) out.landed = true;
                if (classifyPage(d) === 'choice') {
                    const i = queue.findIndex(p => findOption(d, p) !== undefined);
                    if (i < 0) throw new Error(`the clerk offered [${d.options.map(o => o.text).join(' | ')}]`);
                    const c = await clickOption(sdk, queue[i]!);
                    if (c.ok) {
                        queue.splice(i, 1);
                        out.options++;
                        answered = key;
                        answeredAt = st.tick;
                    }
                } else if (CLERK_CALLS.test(text) && !bravekInReach(st) && out.held < BRAVEK_HOLD) {
                    out.held++;
                } else {
                    if (CLERK_CALLS.test(text)) {
                        const b = findNpc(st, /^bravek$/i, BRAVEK_AT);
                        out.bravekAtCall = b ? { x: b.x, z: b.z } : null;
                    }
                    const r = await clickContinue(sdk);
                    if (r.success) {
                        out.pages++;
                        answered = key;
                        answeredAt = st.tick;
                    }
                }
            }
        }
        await waitUntil(sdk, x => x.tick > st.tick, { maxTicks: 3 });
    }
    out.ticks = currentTick(sdk) - t0;
    return out;
}

/**
 * Q: the clerk (24 -> 25). The stage moves only while Bravek is within 7 tiles of the player when
 * the clerk's last page runs (clerk.rs2:52), so that page is held for him (clerkTalk), and a talk
 * that ends without his answer is repeated. Started at 25 (a resume), the clerk says Bravek will see
 * SCORED now, which counts as landed.
 */
async function clerk(ctx: Ctx): Promise<void> {
    const sdk = sdkOf(ctx);
    if (inBravekRoom(sdk.getState()!)) return;
    await go(ctx, 'Q', CLERK_STAND, 'the clerk');
    const tries: ClerkTalk[] = [];
    for (let i = 0; i < CLERK_TRIES; i++) {
        const r = await clerkTalk(sdk);
        tries.push(r);
        if (r.landed) break;
    }
    note(ctx, 'Q', { who: 'the clerk', tries });
    if (!tries.some(t => t.landed)) fail('Q', `Bravek was out of the clerk's reach on all ${CLERK_TRIES} tries`, sdk);
}

/** T: from Bravek's room to the plague house door, and in with the warrant (the mourner looks away). */
async function warrantDoor(ctx: Ctx, opts: Options | undefined): Promise<void> {
    const sdk = sdkOf(ctx);
    if (inPlagueHouse(sdk.getState()!) || inBasement(sdk.getState()!)) return;
    await go(ctx, 'T', PLAGUE_OUT, 'the plague house door');
    for (let i = 0; i < 3; i++) {
        await locTalk(ctx, 'T', opts, { what: 'the plague house door (the warrant)', loc: LOC.plagueDoor, shape: SHAPES.warrantDoor, until: inPlagueHouse });
        if (inPlagueHouse(sdk.getState()!)) return;
        note(ctx, 'T', { mournerOutOfReach: i + 1 });
        await waitUntil(sdk, () => false, { maxTicks: 3 });
    }
    fail('T', 'the mourner never let SCORED in with the warrant', sdk);
}

/** U: search the barrel for the small key. */
async function barrel(ctx: Ctx): Promise<void> {
    const sdk = sdkOf(ctx);
    if (holds(sdk.getState()!, ITEM.key)) return;
    const t0 = currentTick(sdk);
    const r = await opLoc(sdk, { radius: 10, ...LOC.barrel }, 1, s => holds(s, ITEM.key), { maxTicks: 20 });
    if (!r.ok) fail('U', 'the barrel gave no key', sdk);
    // The objbox ('You find a small key in the barrel.') is the script's last page: the stairs click closes it.
    note(ctx, 'U', { loc: 'the barrel', locOp: true, clickToKey: r.ticks, resends: r.resends, ticks: currentTick(sdk) - t0 });
}

/** W: unlock the cell (if outside it) and talk to Elena (27 -> 28). */
async function elena(ctx: Ctx, opts: Options | undefined): Promise<void> {
    const sdk = sdkOf(ctx);
    if (!inCell(sdk.getState()!)) {
        // No run first: the cell door's front tile is the door loc's own tile, so a run aimed at it opens
        // the door on its route, which (key held) unlocks it and teleports SCORED in past the goal (m: +44).
        // The op walks the two tiles from the stairs itself.
        const t0 = currentTick(sdk);
        // plaguehouse.rs2:40-44: 'You unlock the door.', then if_close and the door's teleport.
        const r = await actConverse(sdk, () => sdk.sendInteractLoc(LOC.cellDoor.x, LOC.cellDoor.z, LOC.cellDoor.id, 1), [], { done: inCell, idle: 2, maxTicks: 30 });
        if (!r.ok || !inCell(sdk.getState()!)) fail('W', `the cell door did not let SCORED in (${r.reason ?? ''}; ${r.dialogue?.transcript.join(' | ') ?? ''})`, sdk);
        note(ctx, 'W', { loc: 'the cell door (the key)', locOp: true, clickToDialogue: r.dialogue && r.dialogue.firstTick >= 0 ? r.dialogue.firstTick - t0 : null, clickToInside: r.effectTick - t0, resends: r.resends, ticks: currentTick(sdk) - t0 });
    }
    await talk(ctx, 'W', opts, { who: 'Elena', npc: /^elena$/i, near: ELENA_AT, shape: SHAPES.elena });
}

/**
 * X: from Elena back to Edmond, from wherever on the way SCORED stands: out of the cell, up the
 * basement stairs, out of the plague house, to the manhole, open it, down into the sewer, to the mud
 * pile, up into the garden, to Edmond.
 */
async function backToEdmond(ctx: Ctx): Promise<void> {
    const sdk = sdkOf(ctx);
    const legs: string[] = [];
    for (let guard = 0; guard < 12; guard++) {
        const s = sdk.getState()!;
        if (inEast(s)) {
            await go(ctx, 'X', EDMOND_STAND, 'Edmond');
            legs.push('to Edmond');
            note(ctx, 'X', { legs });
            return;
        }
        if (inCell(s)) {
            await locMove(ctx, 'X', 'the cell door, out', LOC.cellDoor, st => !inCell(st) && inBasement(st));
            legs.push('cell door');
        } else if (inBasement(s)) {
            await locMove(ctx, 'X', 'the basement stairs up', LOC.basementUp, inPlagueHouse);
            legs.push('stairs up');
        } else if (inPlagueHouse(s)) {
            // At 28 and later the door just lets SCORED through (doors.rs2:47, ~open_and_close_door_fast).
            await locMove(ctx, 'X', 'the plague house door, out', LOC.plagueDoor, st => !inPlagueHouse(st) && inBox(st, WEST));
            legs.push('plague house door');
        } else if (inBox(s, WEST) || inBox(s, REHNISON_UP)) {
            await go(ctx, 'X', MANHOLE_STAND, 'the manhole');
            // manhole.rs2: the closed manhole opens (a loc change, no move); the open one climbs down.
            await openManhole(ctx);
            await locMove(ctx, 'X', 'the manhole, down', LOC.manholeOpen, inSewer);
            legs.push('manhole');
        } else if (inSewer(s)) {
            await go(ctx, 'X', MUD_PILE_STAND, 'the mud pile');
            await locMove(ctx, 'X', 'the mud pile, up', LOC.mudPile, inEast);
            legs.push('mud pile');
        } else fail('X', 'lost: not in the cell, the basement, the plague house, West Ardougne, the sewer or Edmond\'s house', sdk);
    }
    fail('X', `no way back to Edmond after ${legs.join(', ')}`, sdk);
}

/** The manhole is open while its open loc stands (500 ticks after the last opening, manhole.rs2): open it if it is not. */
async function openManhole(ctx: Ctx): Promise<void> {
    const sdk = sdkOf(ctx);
    // Wait for the scene before deciding the manhole is closed (a reconnect's first state has none).
    const scene = await waitUntil(sdk, s => s.nearbyLocs.some(l => l.x === LOC.manholeOpen.x && l.z === LOC.manholeOpen.z && (l.id === LOC.manholeOpen.id || l.id === LOC.manholeClosed.id)), { maxTicks: 5 });
    if (!scene.ok) fail('X', 'the manhole is not in sight', sdk);
    const isOpen = (s: BotWorldState) => s.nearbyLocs.some(l => l.x === LOC.manholeOpen.x && l.z === LOC.manholeOpen.z && l.id === LOC.manholeOpen.id);
    if (isOpen(sdk.getState()!)) return;
    await locMove(ctx, 'X', 'the manhole, open', LOC.manholeClosed, isOpen, 10);
}

/**
 * Y: Edmond's reward (28 -> 29). His two pages queue the completion: the scroll and the Mining xp
 * (a level-up page) and the quest-complete scroll, which converse closes.
 */
async function reward(ctx: Ctx, opts: Options | undefined): Promise<void> {
    const sdk = sdkOf(ctx);
    if (!complete(sdk.getState()!)) {
        await go(ctx, 'Y', EDMOND_STAND, 'Edmond');
        await toEdmond(ctx, 'Y');
        await talk(ctx, 'Y', opts, { who: 'Edmond (the reward)', npc: /^edmond$/i, near: EDMOND_AT, shape: SHAPES.reward });
        await waitOrThrow(sdk, s => complete(s) && holds(s, ITEM.scroll), 10, `${stepId}:Y Plague City complete with the magic scroll`);
    }
    const r = await converse(sdk, [], { openTicks: 2, idle: 0, closeModals: true, interrupts: interrupts() });
    if (sdk.getState()?.modalOpen) {
        await sdk.sendCloseModal();
        await waitUntil(sdk, s => !s.modalOpen, { maxTicks: 3 });
    }
    note(ctx, 'Y', { afterReward: r.transcript.length, levelUps: r.levelUps, interrupts: r.interrupts ?? 0 });
}

/** What reading the magic scroll showed: the pages, and whether the scroll left the pack. */
export interface ScrollRead {
    pages: string[];
    read: boolean;
    burnt: boolean;
    consumed: boolean;
}

/** Judge a read from its pages: the memorise objbox or the can-now-cast mesbox, and no burning. */
export function judgeScrollRead(transcript: readonly string[], consumed: boolean): ScrollRead {
    const pages = transcript.filter(l => / page: /.test(l));
    const read = transcript.some(l => LANDED.scrollRead.test(l));
    const burnt = transcript.some(l => LANDED.scrollBurnt.test(l));
    return { pages, read: read && !burnt && consumed, burnt, consumed };
}

/**
 * Z: read the magic scroll (29 -> 30), observed by its pages and the scroll leaving the pack, then
 * take the gas mask off and drop the quest's leftovers. Resumed with no scroll held and the quest
 * complete, the read happened before the reconnect (or the scroll is gone some other way, which
 * T08-09's refused teleport would show), and only the drops are left.
 */
async function scrollAndExit(ctx: Ctx, opts: Options | undefined): Promise<ScrollRead | null> {
    const sdk = sdkOf(ctx);
    let result: ScrollRead | null = null;
    const scroll = invItem(sdk, ITEM.scroll);
    if (scroll) {
        const t0 = currentTick(sdk);
        const op = opIndex(scroll, /^read$/i) ?? 1;
        const click = await act(sdk, () => sdk.sendUseItem(invItem(sdk, ITEM.scroll)?.slot ?? scroll.slot, op), s => s.dialog.isOpen || !holds(s, ITEM.scroll), { resendEvery: 3, maxResends: 2, maxTicks: 10, interrupts: interrupts() });
        if (!click.ok) fail('Z', 'reading the magic scroll opened nothing', sdk);
        const r = await converse(sdk, [], { openTicks: 2, idle: 0, interrupts: interrupts(), maxTicks: 20, until: s => !holds(s, ITEM.scroll), unmatched: 'stop', ...talkShape(opts, SHAPES.scroll) });
        result = judgeScrollRead(r.transcript, !holds(sdk.getState()!, ITEM.scroll));
        noteShape(ctx, 'Z', 'the magic scroll', r, { scrollRead: result, clickToDialogue: click.ticks, ticks: currentTick(sdk) - t0 });
        if (result.burnt) fail('Z', 'the magic scroll burnt: the quest was not at 29 when it was read', sdk);
        if (!result.read) fail('Z', `the scroll read was not observed (pages: ${result.pages.join(' | ') || 'none'}; consumed ${result.consumed})`, sdk);
    }
    await exitDrops(ctx);
    return result;
}

/** Take the gas mask off (it needs a free slot for a moment) and drop every dead item at once. */
export async function exitDrops(ctx: Ctx): Promise<void> {
    const sdk = sdkOf(ctx);
    const t0 = currentTick(sdk);
    const mask = sdk.getState()!.equipment.find(i => i.id === ITEM.gasmask);
    if (mask) {
        const op = mask.optionsWithIndex.find(o => /^remove$/i.test(o.text))?.opIndex ?? 1;
        const r = await act(sdk, () => sdk.sendUseEquipmentItem(mask.slot, op), s => !wearsMask(s), { resendEvery: 3, maxTicks: 12 });
        if (!r.ok) fail('Z', `the gas mask did not come off (${r.reason})`, sdk);
    }
    const d = await dropItems(sdk, isDead);
    if (!d.ok) fail('Z', `exit: the dead items (${(sdk.getState()?.inventory ?? []).filter(isDead).map(i => i.name).join(', ')}) were not dropped`, sdk);
    note(ctx, 'Z', { exitDrops: currentTick(sdk) - t0 });
}

// ------------------------------------------------------------------ checks

const need = (what: string, ok: boolean, why: string): true | string => (ok ? true : `${what}: ${why}`);
const hasItem = (item: ItemPattern, what: string): Check<any> => s => need(what, holds(s, item), 'not held');
const isStarted: Check<any> = s => need('Plague City', started(s), `not in progress (${questStatus(s, quest) ?? 'unobservable'})`);
const notStarted: Check<any> = s => requireQuestStage(s, quest, 'not_started');
const kitHeld: Check<any> = s => {
    const want = kitWant(s, KIT);
    return want.length ? `kit missing: ${want.map(w => `${w.amount} x ${String(w.item)}`).join(', ')}` : true;
};
const where = (what: string, test: (s: BotWorldState) => boolean): Check<any> => s => need('position', test(s), `not ${what} (at ${pos(s).x},${pos(s).z} L${pos(s).level})`);
const atArrival = where('on the arrival tile beside Edmond', s => inArea(s, ARRIVAL));
const east = where("in Edmond's house or garden", inEast);
const sewer = where('in the sewer', inSewer);
const west = where('in West Ardougne', inWest);
const streets = where("in West Ardougne's streets", inWestStreets);
const rehnisonHouse = where("in the Rehnisons' house", inRehnison);
const plagueHouse = where('in the plague house', inPlagueHouse);
const basement = where('in the plague house basement', inBasement);
const maskHeld: Check<any> = s => need('the gas mask', holds(s, ITEM.gasmask) || wearsMask(s), 'neither held nor worn');
const noDeadItems: Check<any> = s => {
    const held = s.inventory.filter(isDead).map(i => i.name);
    if (wearsMask(s)) held.push('Gas mask (worn)');
    return held.length ? `exit: still holding ${held.join(', ')}` : true;
};
/** The way back, X: anywhere between Elena's cell and Edmond's house, Edmond's reward not yet given. */
const onTheWayBack = where('between the cell and Edmond', s => inCell(s) || inBasement(s) || inPlagueHouse(s) || inWest(s) || inSewer(s) || inEast(s));

// ------------------------------------------------------------------ the segments

export function steps(opts?: Options) {
    const probes = [JOURNAL] as const;
    const segs: Segment[] = [
        kitSegment(opts, KIT, {
            preconditions: allOf(atArrival, notStarted, baseLevels({ magic: 45 }), slots('A')),
        }),
        {
            letter: 'B', label: 'edmond-start', logoutSafe: true,
            // At stage 0 B needs A's kit: the resume walk takes the latest segment that can start and must not skip A.
            preconditions: allOf(east, notStarted, kitHeld, slots('B')),
            run: async ctx => {
                await toEdmond(ctx, 'B');
                await talk(ctx, 'B', opts, { who: 'Edmond (the start)', npc: /^edmond$/i, near: EDMOND_AT, choices: CHOICES.edmondStart, shape: SHAPES.edmondStart, until: started });
            },
            postconditions: isStarted,
            done: o => atLeast(o, 'started'),
        },
        {
            letter: 'C', label: 'picture', logoutSafe: true,
            preconditions: allOf(east, isStarted, slots('C')),
            run: ctx => picture(ctx),
            postconditions: hasItem(ITEM.picture, 'the picture'),
            done: o => holds(o, ITEM.picture) || atLeast(o, 'shown_picture'),
            probes,
        },
        {
            letter: 'D', label: 'alrena', logoutSafe: true,
            preconditions: allOf(east, isStarted, hasItem(ITEM.dwellberries, 'the dwellberries'), slots('D')),
            run: async ctx => {
                if (holds(ctx.sdk.getState()!, ITEM.gasmask)) return;
                await houseDoors(ctx, 'D', ALRENA_AT.x);
                await talk(ctx, 'D', opts, { who: 'Alrena (the gas mask)', npc: /^alrena$/i, near: ALRENA_AT, shape: SHAPES.alrena, until: s => holds(s, ITEM.gasmask) });
            },
            postconditions: hasItem(ITEM.gasmask, 'the gas mask'),
            done: o => atLeast(o, 'gasmask') || holds(o, ITEM.gasmask) || wearsMask(stateOf(o)),
            probes,
        },
        {
            letter: 'E', label: 'edmond-mask', logoutSafe: true,
            preconditions: allOf(east, isStarted, maskHeld),
            run: async ctx => {
                await toEdmond(ctx, 'E');
                await talk(ctx, 'E', opts, { who: 'Edmond (the gas mask)', npc: /^edmond$/i, near: EDMOND_AT, shape: SHAPES.edmondMask });
            },
            done: o => atLeast(o, 'started_mud_patch'),
            probes,
        },
        {
            letter: 'F', label: 'cure', logoutSafe: true,
            preconditions: allOf(isStarted, s => (holds(s, ITEM.chocMilk) || (holds(s, ITEM.dust) && holds(s, ITEM.milk)) ? true : 'the cure: neither the chocolaty milk nor the dust and milk held'), hasItem(ITEM.snape, 'the snape grass')),
            run: ctx => cure(ctx),
            postconditions: hasItem(ITEM.cure, 'the hangover cure'),
            done: o => holds(o, ITEM.cure) || atLeast(o, 'spoke_cured_bravek'),
            probes,
        },
        {
            letter: 'G', label: 'mud', logoutSafe: true,
            preconditions: allOf(east, isStarted, hasItem(ITEM.water, 'the buckets of water')),
            run: ctx => mud(ctx),
            done: o => atLeast(o, 'mud_patch4'),
            probes,
        },
        {
            letter: 'H', label: 'dig', logoutSafe: true,
            preconditions: allOf(east, isStarted, hasItem(ITEM.spade, 'the spade')),
            run: ctx => dig(ctx, opts),
            postconditions: sewer,
            done: o => atLeast(o, 'opened_tunnel'),
            probes,
        },
        {
            letter: 'I', label: 'rope', logoutSafe: true,
            preconditions: allOf(sewer, isStarted, hasItem(ITEM.rope, 'the rope')),
            run: ctx => rope(ctx),
            done: o => atLeast(o, 'tied_rope'),
            probes,
        },
        {
            letter: 'J', label: 'sewer-edmond', logoutSafe: true,
            preconditions: allOf(sewer, isStarted),
            run: async ctx => {
                await go(ctx, 'J', { ...SEWER_EDMOND_AT, tol: 2 }, 'Edmond in the sewer');
                await talk(ctx, 'J', opts, { who: 'Edmond (the grill)', npc: /^edmond$/i, near: SEWER_EDMOND_AT, shape: SHAPES.sewerEdmond });
            },
            done: o => atLeast(o, 'opened_pipe'),
            probes,
        },
        {
            letter: 'K', label: 'pipe', logoutSafe: true,
            preconditions: allOf(sewer, isStarted, maskHeld),
            run: ctx => pipe(ctx),
            postconditions: allOf(west, s => need('the gas mask', wearsMask(s), 'not worn')),
        },
        {
            letter: 'L', label: 'jethick', logoutSafe: true,
            preconditions: allOf(streets, isStarted, hasItem(ITEM.picture, 'the picture'), slots('L')),
            run: async ctx => {
                await go(ctx, 'L', { x: JETHICK_AT.x - 1, z: JETHICK_AT.z, tol: 2 }, 'Jethick');
                await talk(ctx, 'L', opts, { who: 'Jethick', npc: /^jethick$/i, near: JETHICK_AT, choices: CHOICES.jethick, shape: SHAPES.jethick, until: s => holds(s, ITEM.book) });
            },
            postconditions: hasItem(ITEM.book, 'the book'),
            done: o => atLeast(o, 'shown_picture'),
            probes,
        },
        {
            letter: 'M', label: 'rehnison-door', logoutSafe: true,
            preconditions: allOf(west, isStarted, hasItem(ITEM.book, 'the book')),
            run: ctx => tedDoor(ctx, opts),
            postconditions: allOf(rehnisonHouse, s => need('the book', !holds(s, ITEM.book), 'still held')),
            // 20 and 21 share the journal: Ted takes the book at the door, so a held book means 20.
            done: o => atLeast(o, 'returned_book') || (atLeast(o, 'shown_picture') && !holds(o, ITEM.book)),
            probes,
        },
        {
            letter: 'N', label: 'ted', logoutSafe: true,
            preconditions: allOf(rehnisonHouse, isStarted),
            run: async ctx => {
                await talk(ctx, 'N', opts, { who: 'Ted Rehnison', npc: /^ted rehnison$/i, near: TED_AT, shape: SHAPES.ted });
            },
            done: o => atLeast(o, 'spoken_martha_ted'),
            probes,
        },
        {
            letter: 'O', label: 'milli', logoutSafe: true,
            preconditions: allOf(rehnisonHouse, isStarted),
            run: ctx => milli(ctx, opts),
            done: o => atLeast(o, 'spoke_to_milli'),
            probes,
        },
        {
            letter: 'P', label: 'plague-door', logoutSafe: true,
            preconditions: allOf(west, isStarted),
            run: ctx => plagueDoor(ctx, opts),
            done: o => atLeast(o, 'spoke_to_plague_house'),
            probes,
        },
        {
            letter: 'Q', label: 'clerk', logoutSafe: true,
            preconditions: allOf(west, isStarted),
            run: ctx => clerk(ctx),
            // 24 and 25 share the journal; Bravek's door opens only at 25 (area_ardougne_west doors.rs2:25).
            done: o => atLeast(o, 'spoke_to_bravek') || inBravekRoom(stateOf(o)),
            probes,
        },
        {
            letter: 'R', label: 'bravek-note', logoutSafe: true,
            preconditions: allOf(west, isStarted, slots('R')),
            run: async ctx => {
                if (holds(ctx.sdk.getState()!, ITEM.note)) return;
                await go(ctx, 'R', BRAVEK_STAND, 'Bravek');
                await talk(ctx, 'R', opts, { who: 'Bravek (the note)', npc: /^bravek$/i, near: BRAVEK_AT, choices: CHOICES.bravekNote, shape: SHAPES.bravekNote, until: s => holds(s, ITEM.note) });
            },
            postconditions: hasItem(ITEM.note, 'the scruffy note'),
            done: o => atLeast(o, 'spoke_to_bravek') || holds(o, ITEM.note),
            probes,
        },
        {
            letter: 'S', label: 'bravek-warrant', logoutSafe: true,
            preconditions: allOf(west, isStarted, hasItem(ITEM.cure, 'the hangover cure'), slots('S')),
            run: async ctx => {
                await go(ctx, 'S', BRAVEK_STAND, 'Bravek');
                await talk(ctx, 'S', opts, { who: 'Bravek (the cure, the warrant)', npc: /^bravek$/i, near: BRAVEK_AT, choices: CHOICES.bravekWarrant, shape: SHAPES.bravekWarrant, until: s => holds(s, ITEM.warrant) });
            },
            postconditions: hasItem(ITEM.warrant, 'the warrant'),
            done: o => atLeast(o, 'spoke_cured_bravek') || holds(o, ITEM.warrant),
            probes,
        },
        {
            letter: 'T', label: 'plague-house', logoutSafe: true,
            preconditions: allOf(west, isStarted, hasItem(ITEM.warrant, 'the warrant')),
            run: ctx => warrantDoor(ctx, opts),
            postconditions: plagueHouse,
        },
        {
            letter: 'U', label: 'barrel-key', logoutSafe: true,
            preconditions: allOf(plagueHouse, isStarted, slots('U')),
            // The barrel's op walks the two tiles from the door itself; the tile south of it (2534,3269) is blocked (m).
            run: ctx => barrel(ctx),
            postconditions: hasItem(ITEM.key, 'the small key'),
            done: o => holds(o, ITEM.key) || atLeast(o, 'freed_elena'),
            probes,
        },
        {
            letter: 'V', label: 'basement', logoutSafe: true,
            preconditions: allOf(plagueHouse, isStarted, hasItem(ITEM.key, 'the small key')),
            run: ctx => locMove(ctx, 'V', 'the plague house stairs down', LOC.basementDown, inBasement),
            postconditions: basement,
        },
        {
            letter: 'W', label: 'elena', logoutSafe: true,
            preconditions: allOf(basement, isStarted, s => (inCell(s) || holds(s, ITEM.key) ? true : 'the cell: outside it without the small key')),
            run: ctx => elena(ctx, opts),
            done: o => atLeast(o, 'freed_elena'),
            probes,
        },
        {
            letter: 'X', label: 'back-to-edmond', logoutSafe: true,
            preconditions: allOf(isStarted, onTheWayBack),
            run: ctx => backToEdmond(ctx),
            postconditions: east,
        },
        {
            letter: 'Y', label: 'edmond-reward', logoutSafe: true,
            preconditions: allOf(east, s => (started(s) || complete(s) ? true : 'Plague City: not started'), slots('Y')),
            run: ctx => reward(ctx, opts),
            postconditions: allOf(s => requireQuestStage(s, quest, 'complete', { atLeast: true }), s => (s.dialog.isOpen || s.modalOpen ? 'a dialogue or modal is still open' : true)),
            done: o => complete(stateOf(o)),
        },
        {
            letter: 'Z', label: 'scroll', logoutSafe: true,
            preconditions: allOf(s => (complete(s) ? true : 'Plague City: not complete'), slots('Z')),
            run: async ctx => {
                await scrollAndExit(ctx, opts);
            },
            postconditions: allOf(
                s => requireQuestStage(s, quest, 'complete', { atLeast: true }),
                s => need('the magic scroll', !holds(s, ITEM.scroll), 'still held: the Ardougne teleport stays locked at 29'),
                noDeadItems,
            ),
            done: o => complete(stateOf(o)) && !holds(o, ITEM.scroll) && noDeadItems(stateOf(o), undefined) === true,
        },
    ];
    return questSteps(stepId, segs);
}

/** For tests and the lab: the observation `done` checks read. */
export function observed(state: BotWorldState, journal?: Pick<QuestJournalState, 'title' | 'lines'>): Observed {
    return { state, probed: journal ? { [JOURNAL]: { open: false, tick: state.tick, ...journal } } : {} };
}

