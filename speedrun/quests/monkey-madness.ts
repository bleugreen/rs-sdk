// Monkey Madness (S15): the step module the scored run chains, one Step per
// segment A-Z (docs/speedrun/STEP-MANIFEST.md section 3 entry 2,
// docs/speedrun/quests/monkey_madness.md).
//
// Resume. The quest's varps are not published, and the shared stage table
// has exact markers only for mm_main 0, 6, 9 and 10. But the journal
// (quest_mm/scripts/mm_journal.rs2) is built from the sub-varps, and almost
// every segment leaves either a journal line whose presence is guarded by its
// sub-varp or a quest item. `mmMilestone` is the highest segment any of that
// evidence shows, so each segment's `done` (milestone >= its index) holds for
// every later state even though items are consumed and the journal collapses
// a chapter's text once the next chapter starts. Only phrases whose presence
// (not colour) changes are used, so colour tags in the published lines do
// not matter.
//
// Travel segments (K, M, P, U) have no `done`: their preconditions name the
// region they start in, so the resume walk (runner/resume.ts) picks the
// travel leg or the segment after it by where the player stands. Every
// atoll body starts by getting to where it works from (out of the cell, into
// the town, to its NPC), so a segment entered after a drop finishes the same
// way as one entered in order.
//
// The temple rope pin. N's rope can land the player among the trapdoor
// guards, who pin them in about 1 climb in 6; N then waits PIN_WAIT ticks and
// teleports to Varrock. The amulet is already strung by then, so N is done
// (the amulet is its milestone) and N ends off the atoll. O starts with the
// way back (wayBack: spirit trees to the stronghold, then U's hangar route),
// and its preconditions admit any tile off the atoll, so the resume walk
// enters O from wherever on that way a restart finds the player.

import type { BotWorldState, PrayerName } from '../../sdk/types';
import type { QuestKey } from '../data/quest-stages';
import { act, actConverse, dropItems, invOp, opLoc, pickup, slotOf, talkTo, useOn, walkTo, wield } from '../lib/act';
import { fight, prayerActive, setPrayer, Upkeep } from '../lib/combat';
import { converse, type ConverseResult, type Interrupt } from '../lib/converse';
import { classifyPage, pageText, type PageKind } from '../lib/dialogue';
import { compactJournal, journalProbeName, journalText, questStatus, type QuestView } from '../lib/quests';
import { DROPPED_TICKS, receiveFrom, sameName, swap, tradeOf, type GiveSpec, type ReceiveResult, type WantSpec } from '../lib/trade';
import { deletesFollowerItem, glide, GNOME_STRONGHOLD_GATE, passGate, runTo, SPIRIT_TREES, spiritTree, teleport, teleportRefusal, type Hop } from '../lib/travel';
import { solveOnPanel } from '../lib/puzzle';
import { currentTick, waitTicks, waitUntil, type Pred } from '../lib/wait';
import { chebyshev, findLoc, invCount, messagesSince, pos, waitForNpc, type StateLike } from '../lib/world';
import type { Check, Observed, Step, StepContext } from '../runner/step';
import { ANTIPOISON, antipoisonDrunkAt, cureDose, curePoison, DRINK_RESEND_TICKS, drinkDelayOver, drinkPrayerTo, noteAntipoison, poisoned, poisonSeenAt, prayerCovers, slotNeed, slotsCover, talkShape, type DialogueMode, type QuestItem } from './segments';
import { CHILD_TALISMAN, CHILD_TALKS, childTalkNeed, lumdoRefuses, MM_SHAPES, narnodeComplete } from './monkey-madness-shapes';
import { cueDir, CueWriter, writeTopUpAsk, type AskItem, type CueScope } from '../helpers/altar-cue';
import { itemLabel, MANIFEST, parseLedger } from '../tools/slot-ledger';
import { readFileSync } from 'fs';

export const quest: QuestKey = 'mm';
export const stepId = 'S15';

export interface Options {
    /** Default 'fixed'. 'burst' clears each conversation's continue runs blind by its shape (monkey-madness-shapes.ts, segments.ts talkShape). */
    dialogue?: DialogueMode;
    /** The H12 giver; absent: the kit must already be held. */
    kitFrom?: string;
    /**
     * Whether H12 is recorded served this attempt (the runner's attempt record). Served, the kit's consumed lines count as
     * delivered, so a shark eaten or a dose drunk after the serve never re-opens the swap. Absent: never served.
     */
    kitServed?: () => boolean;
    /** Default 'ladder' (rs/59's drop); a failed drop falls back to 'wait' inside segment N. */
    templeMethod?: 'ladder' | 'wait';
    /** Default 'walk'; 'glider' is Barnaby's ship to Brimhaven, a walk, and the Gandius glider. */
    returnMonkey?: 'walk' | 'glider';
    /** Diagnostic lines (the timing choices behind a random step); the lab prints them. Default: dropped. */
    note?: (line: string) => void;
    /** When sharks are eaten. Default SEGMENT_EATING (the ruled per-segment thresholds, no top-ups). */
    eating?: EatPolicy;
    /**
     * The atoll top-ups (SUPPLIES.md H12o): one helper's two receive legs, M's at the dungeon exit ladder's top and P's on
     * the bridge jump's landing. Off when absent (the default); run.ts passes the ledger row's helper and items.
     */
    topUpFrom?: TopUp;
    /**
     * The bow the kit carries for the Jungle Demon (X), by object id. Default the magic shortbow (H12); any bow whose
     * level requirement is at least the rune arrows' fires them (player_ranged.rs2 player_ranged_check_ammo).
     */
    bow?: number;
}

export const DEFAULT_OPTIONS: Required<Omit<Options, 'kitFrom' | 'kitServed' | 'eating' | 'topUpFrom'>> = { dialogue: 'fixed', templeMethod: 'ladder', returnMonkey: 'walk', note: () => {}, bow: 861 /* MM_OBJ.magicShortbow, declared below */ };

export function resolveOptions(o: Options = {}): Required<Omit<Options, 'kitFrom' | 'kitServed' | 'topUpFrom'>> & Pick<Options, 'kitFrom' | 'kitServed' | 'topUpFrom'> {
    return { ...DEFAULT_OPTIONS, eating: SEGMENT_EATING, ...o };
}

/**
 * Object ids (server/content/pack/obj.pack). Several quest items share a
 * display name (both M'speak amulets, every gree-gree), so they are told
 * apart by id.
 */
export const MM_OBJ = {
    royalSeal: 4004, // mm_gnome_royal_seal
    orders: 4005, // mm_narnode_orders
    dentures: 4006, // mm_monkey_dentures
    enchantedBar: 4007, // mm_enchanted_gold_bar
    amuletMould: 4020, // mm_monkey_amulet_mould
    amulet: 4021, // mm_amulet_of_monkey_speak (strung)
    amuletUnstrung: 4022, // mm_amulet_of_monkey_speak_without_string
    talisman: 4023, // mm_monkey_talisman
    greegree: 4031, // mm_monkey_greegree_for_normal_monkey (the Karamjan monkey)
    monkey: 4033, // mm_monkey_in_backpack
    sigil: 4035, // mm_sigil
    monkeyBones: 3183, // mm_normal_monkey_bones
    goldBar: 2357,
    ballOfWool: 1759,
    banana: 1963,
    magicShortbow: 861,
    runeArrow: 892,
    prayerPotion4: 2434, // 4doseprayerrestore
    superAntipoison4: 2448, // 4dose2antipoison, "Superantipoison(4)"
    superAntipoison1: 185, // 1dose2antipoison: H12's optional pre-dose, drunk at A
    shark: 385,
} as const;

/** The hangar panel's grid (reinitialisation_puzzle:com_3) and its tiles reinitialisation_01..24. */
export const PUZZLE_COMPONENT = 11130;
export const PUZZLE_TILE_IDS: readonly number[] = Array.from({ length: 24 }, (_, i) => 3904 + 2 * i);

export type Basis = 'M' | 'R' | 'T' | 'I';

export interface SegmentDef {
    letter: string;
    label: string;
    /** False inside the manifest's logout-unsafe stretches; each such stretch ends with its segment. */
    logoutSafe: boolean;
    /** Travel only: no milestone, chosen by the region its preconditions name. */
    travel?: true;
    /** Stock ticks from the quest doc's rows (monkey_madness.md), and their basis. */
    stockRef: number;
    basis: string;
}

/**
 * The segments in route order. A-G keep quest-mm-full.ts's STARTS letters;
 * H-Z follow the route through chapters 2-4 (the atoll scripts' own letters
 * collide with these and are not used).
 */
export const SEGMENTS: readonly SegmentDef[] = [
    { letter: 'A', label: 'narnode', logoutSafe: true, stockRef: 50, basis: 'M' },
    { letter: 'B', label: 'shipyard', logoutSafe: true, stockRef: 142, basis: 'M' },
    { letter: 'C', label: 'report', logoutSafe: true, stockRef: 115, basis: 'M' },
    { letter: 'D', label: 'daero', logoutSafe: true, stockRef: 93, basis: 'M' },
    { letter: 'E', label: 'hangar', logoutSafe: false, stockRef: 81, basis: 'M/I' },
    { letter: 'F', label: 'waydar', logoutSafe: true, stockRef: 42, basis: 'M' },
    { letter: 'G', label: 'lumdo', logoutSafe: false, stockRef: 153, basis: 'M' },
    { letter: 'H', label: 'jail1', logoutSafe: true, stockRef: 88, basis: 'M' },
    { letter: 'I', label: 'garkor', logoutSafe: true, stockRef: 95, basis: 'T+R' },
    { letter: 'J', label: 'cellar', logoutSafe: true, stockRef: 122, basis: 'M' },
    { letter: 'K', label: 'dungeon1', logoutSafe: true, travel: true, stockRef: 374, basis: 'T+M' },
    { letter: 'L', label: 'amulet', logoutSafe: true, stockRef: 158, basis: 'R' },
    { letter: 'M', label: 'jail2', logoutSafe: true, travel: true, stockRef: 382, basis: 'M' },
    { letter: 'N', label: 'temple', logoutSafe: true, stockRef: 83, basis: 'M/I' },
    { letter: 'O', label: 'child', logoutSafe: true, stockRef: 233, basis: 'T+R' },
    { letter: 'P', label: 'dungeon2', logoutSafe: true, travel: true, stockRef: 374, basis: 'T+M' },
    { letter: 'Q', label: 'greegree', logoutSafe: false, stockRef: 86, basis: 'R' },
    { letter: 'R', label: 'disguise', logoutSafe: true, stockRef: 389, basis: 'M+T' },
    { letter: 'S', label: 'mission', logoutSafe: true, stockRef: 141, basis: 'R+T' },
    { letter: 'T', label: 'zoo', logoutSafe: true, stockRef: 124, basis: 'M+R' },
    { letter: 'U', label: 'return', logoutSafe: true, travel: true, stockRef: 365, basis: 'T+I' },
    { letter: 'V', label: 'awowogei', logoutSafe: true, stockRef: 20, basis: 'R' },
    { letter: 'W', label: 'sigil', logoutSafe: false, stockRef: 115, basis: 'R' },
    { letter: 'X', label: 'demon', logoutSafe: false, stockRef: 311, basis: 'M (100 ms)' },
    { letter: 'Y', label: 'narnode2', logoutSafe: true, stockRef: 219, basis: 'R/M' },
    { letter: 'Z', label: 'daero2', logoutSafe: true, stockRef: 63, basis: 'R+I' },
];

export function segmentName(d: Pick<SegmentDef, 'letter' | 'label'>): string {
    return `${stepId}:${d.letter}-${d.label}`;
}

/** Segment index by letter. */
export function seg(letter: string): number {
    const i = SEGMENTS.findIndex(d => d.letter === letter);
    if (i < 0) throw new Error(`no Monkey Madness segment ${letter}`);
    return i;
}

export const JOURNAL_PROBE = journalProbeName('mm');

/**
 * Journal phrases and the segment each one proves done. Each is guarded in
 * mm_journal.rs2 by the sub-varp the segment sets (the guard in brackets).
 * Chapter 1's lines collapse once mm_main passes 2, and chapters 2-3's once
 * it reaches 6; a later phrase or item covers each collapse.
 */
export const JOURNAL_MARKS: ReadonlyArray<readonly [letter: string, phrase: string]> = [
    ['A', 'Narnode has given me a copy of the Royal Seal'], // mm_narnode >= given_seal
    ['B', 'I have investigated the Karamjan shipyard'], // mm_caranock > p2
    ['C', 'Narnode has given me some handwritten orders'], // mm_narnode >= received_orders
    ['D', 'I have been taken to the Underground Military Glider Hangar'], // mm_daero > learnt_mission
    ['E', 'I have completed reinitialisation'], // mm_daero > started_reinit
    ['F', 'Waydar and I landed our glider'], // mm_waydar > 0
    ['G', 'Chapter 2:'], // mm_main > shown_seal
    ['G', 'I have found that the 10th squad were indeed blown off'], // mm_main > shown_seal (chapter 1 collapsed)
    ['H', 'I have made my rather painful way to a large village'], // mm_jail_count > 0 (mm_main 3-5)
    ['I', 'I found Sergeant Gakor'], // mm_garkor > 0 (the source's spelling)
    ['Q', 'Chapter 3:'], // mm_main >= completed_ch2
    ['R', 'I have disguised myself as a Karamjan monkey'], // mm_garkor > need_correct_disguise, mm_awowogei 0
    ['S', 'rescue one of the Karamjan type of monkey'], // mm_awowogei = sent_mission
    ['V', "earnt Awowogei's favour"], // mm_awowogei > sent_mission, and the chapter 3 summary at mm_main >= 6
    ['W', 'Garkor has given me a sigil'], // mm_garkor > learned_plan
    ['X', 'With the help of the 10th squad I managed to slay'], // mm_main >= defeated_demon
    ['Z', 'I found Daero and enrolled'], // mm_main > complete
];

const MARKS = JOURNAL_MARKS.map(([letter, phrase]) => [seg(letter), compactJournal(phrase)] as const);
/** Zooknock's story told (mm_zooknock > learned_story): segment L has begun. */
const ZOOKNOCK_STORY = compactJournal('Zooknock is capable of transforming my body');

function holds(s: BotWorldState, id: number): boolean {
    return s.inventory.some(i => i.id === id) || s.equipment.some(i => i.id === id);
}

function stateOf(o: QuestView): BotWorldState {
    return 'probed' in o ? o.state : o;
}

/** The highest segment the held and worn quest items prove done, or -1. */
export function itemMilestone(s: BotWorldState, journal: string | null = null): number {
    const h = (id: number) => holds(s, id);
    if (h(MM_OBJ.sigil)) return seg('W');
    if (h(MM_OBJ.monkey)) return seg('T');
    if (h(MM_OBJ.greegree)) return seg('Q');
    if (h(MM_OBJ.talisman)) return seg('O');
    if (h(MM_OBJ.amulet)) return seg('N');
    if (h(MM_OBJ.enchantedBar) || h(MM_OBJ.amuletUnstrung)) return seg('L');
    // Zooknock takes the dentures, the bar and the mould one use at a time and
    // hands back the enchanted bar with the mould: once his story is told,
    // either ingredient still held means the cellar was done.
    if (h(MM_OBJ.dentures) && h(MM_OBJ.amuletMould)) return seg('J');
    if ((h(MM_OBJ.dentures) || h(MM_OBJ.amuletMould)) && journal?.includes(ZOOKNOCK_STORY)) return seg('J');
    if (h(MM_OBJ.orders)) return seg('C');
    if (h(MM_OBJ.royalSeal)) return seg('A');
    return -1;
}

/** The highest segment the journal's text proves done, or -1. */
export function journalMilestone(journal: string | null): number {
    if (!journal) return -1;
    let m = -1;
    for (const [i, phrase] of MARKS) if (i > m && journal.includes(phrase)) m = i;
    return m;
}

/**
 * The index of the highest segment whose mark the observation shows (-1 for
 * none): the maximum over the `journal:mm` probe (or a fresh journal in
 * state), the quest items held or worn, and the quest tab's complete status
 * (segment Y).
 */
export function mmMilestone(o: Observed | BotWorldState): number {
    const s = stateOf(o);
    const status = questStatus(s, 'mm');
    if (status === null || status === 'not_started') return holds(s, MM_OBJ.royalSeal) ? seg('A') : -1;
    const journal = journalText(o, 'mm');
    let m = Math.max(journalMilestone(journal), itemMilestone(s, journal));
    if (status === 'complete') m = Math.max(m, seg('Y'));
    return m;
}

/** Step.done for segment `letter`. */
export function doneAt(letter: string): (o: Observed) => boolean {
    const i = seg(letter);
    return o => mmMilestone(o) >= i;
}

/** The hangar puzzle was started and not finished: mm_daero = started_reinit. */
export const REINIT_PENDING = compactJournal('I cannot go on the mission until reinitialisation');

// ------------------------------------------------------------------ places

export interface Area { x0: number; z0: number; x1: number; z1: number; level?: number }

/** Ape Atoll's areas, from the quest scripts' coordinates (quest_mm.rs2, mm_archer.rs2, ape_atoll_dungeon.rs2). */
export const AREAS = {
    /** The jail cell a knockout lands in (mm_archer.rs2:74, mm_jail.rs2:49); the door row is z 2795. */
    cell: { x0: 2770, z0: 2793, x1: 2776, z1: 2795, level: 0 },
    /** The atoll's surface, every level (mapsquares 42_42..43_43). */
    atoll: { x0: 2688, z0: 2688, x1: 2815, z1: 2815 },
    /** The dungeon under the landing, ladder (2763,9103) to Zooknock (2804,9145). */
    dungeon: { x0: 2688, z0: 9088, x1: 2815, z1: 9159, level: 0 },
    /** The warehouse cellar under the crate over the hole. */
    cellar: { x0: 2752, z0: 9160, x1: 2815, z1: 9180, level: 0 },
    /** The western warehouse the cellar's western rope climbs into (its ground door is locked). */
    westWarehouse: { x0: 2744, z0: 2763, x1: 2756, z1: 2772 },
} as const satisfies Record<string, Area>;

export function tileIn(p: { x: number; z: number; level?: number }, a: Area): boolean {
    return p.x >= a.x0 && p.x <= a.x1 && p.z >= a.z0 && p.z <= a.z1 && (a.level === undefined || (p.level ?? 0) === a.level);
}

export function inArea(src: StateLike, a: Area): boolean {
    return tileIn(pos(src), a);
}

export const inCell = (src: StateLike) => inArea(src, AREAS.cell);

/**
 * On the atoll's ground outside the town: the landing, the dungeon ladder and
 * the ravine to the west gate. The bridge is one-way into it
 * (quest_mm.rs2:1022-1043) and the gate opens only for a monkey (:1113-1117),
 * so a human gets into the town from here only by being knocked out.
 */
export function outsideTown(src: StateLike): boolean {
    const p = pos(src);
    return inArea(src, AREAS.atoll) && p.level === 0 && (p.z <= 2731 || (p.x <= 2730 && p.z <= 2766));
}

/**
 * Off Ape Atoll altogether, neither on its surface nor under it (mapsquares 42_142..43_144: the dungeon, the cellar,
 * under the temple): the mainland, the hangar or Crash Island. Where a temple-rope pin's Varrock teleport leaves the
 * player, and every leg of the way back.
 */
export function offAtoll(src: StateLike): boolean {
    const p = pos(src);
    return !(p.x >= AREAS.atoll.x0 && p.x <= AREAS.atoll.x1 && ((p.z >= AREAS.atoll.z0 && p.z <= AREAS.atoll.z1) || (p.z >= 9088 && p.z <= 9279)));
}

const LANDING = { x: 2801, z: 2707 };
const RAVINE_END = { x: 2713, z: 2767 };
const CELL_DOOR = { x: 2771, z: 2795 };
const GARKOR = { x: 2805, z: 2762 };
const DENTURE_CRATE = { x: 2767, z: 2769 };
/** The denture crate's only side outside the sleeping guard's zone (mm_sleeping_monkey_guard.rs2:5). */
const HOLE_CRATE = { x: 2769, z: 2765 };
const MOULD_CRATE = { x: 2782, z: 9172 };
const WEST_ROPE = { x: 2764, z: 9165 };
const WEST_ROPE_TOP = { x: 2749, z: 2768 };
const BRIDGE_LADDER = { x: 2803, z: 2734 };
const JUMP_SQUARE = { x: 2803, z: 2727 };
const DUNGEON_LADDER = { x: 2763, z: 2703 };
const DUNGEON_EXIT = { x: 2763, z: 9103 };
const ZOOKNOCK = { x: 2804, z: 9145 };
/** The west gate's two doors (quest_mm.rs2:1110-1145): opened only by a gree-gree wearer, who is moved 3 tiles through. */
const WEST_GATE = { x: 2719, z: 2766 };
/** South of the west gate, on the ravine side. */
const WEST_GATE_SOUTH = { x: 2720, z: 2765 };
const KRUK = { x: 2726, z: 2765 };
/**
 * Kruk wanders a strip east of the west gate (x 2725-2736, z 2740-2770) that no walk reaches: the gate's passage on
 * either side and the town are walled off from it, and the mm_post fence closes its east side (lab/measure-mm-kruk.ts:
 * from (2737,2765) neither a walk click nor a Talk-to gets in). The way in is over the gate: up the west watchtower's
 * ladder at (2713,2766) to the level 2 bridge, east along it, and down the east watchtower's ladder at (2729,2766)
 * from the bridge's east end, which lands in the strip.
 */
const WATCHTOWER_WEST = { x: 2713, z: 2766 };
const WATCHTOWER_EAST = { x: 2729, z: 2766 };
const BRIDGE_EAST_END = { x: 2730, z: 2766 };
/**
 * Elder Guard 2 at Awowogei's door (mm_elder_guard.rs2:12-51). He answers only from his south side: more than one tile
 * north of him, the player is shown out instead.
 */
const ELDER_GUARD = { x: 2801, z: 2757 };
const ELDER_GUARD_SOUTH = { x: 2801, z: 2755 };
/** Inside Awowogei's hall, the doorway's inner tile: Elder Guard 2's entry teleport ends here (mm_elder_guard.rs2:30-38). */
const HALL_DOOR_IN = { x: 2802, z: 2759 };
/** Awowogei's throne (loc 4771, mm_awowogei.rs2:27-93); Uwogo and Murowoi beside it must be within 7 of the player. */
const THRONE = { x: 2802, z: 2765 };
/** Ardougne zoo, inside the gree-gree zone (quest_mm.rs2:1102-1108: 0_40_51_32_1 to 0_41_51_15_23). */
export const ZOO = { x0: 2592, z0: 3265, x1: 2639, z1: 3287, level: 0 } as const;
/** The monkey cage's four zones, as the minder tests them (mm_monkey_minder.rs2:7). */
export const CAGE: readonly Area[] = [
    { x0: 2598, z0: 3274, x1: 2600, z1: 3277, level: 0 }, { x0: 2598, z0: 3276, x1: 2600, z1: 3278, level: 0 },
    { x0: 2600, z0: 3276, x1: 2604, z1: 3282, level: 0 }, { x0: 2605, z0: 3276, x1: 2606, z1: 3281, level: 0 },
];
export const inCage = (src: StateLike) => CAGE.some(a => inArea(src, a));
/** East of the cage, by the minder spawned at (2608,3279) (maps/m40_51.jm2; the others at (2595,3277), (2602,3274)). */
const ZOO_EAST = { x: 2610, z: 3279 };
const CAGE_ENTRY = { x: 2604, z: 3281 };
const MINDER = /^Monkey Minder$/i;
/**
 * A caged player's talk reaches a minder only from within 5 tiles (mm_monkey_minder.rs2: p_aprange(5)), and only with a
 * line of sight: the talk is an approach trigger, which the engine fires only while isApproached holds
 * (PathingEntity.inApproachDistance, rsmod hasLineOfSight). The client can't route out of the cage, so every click is an
 * unrouted ap-range send, and `reachable` is false for every minder outside it.
 */
export const MINDER_REACH = 5;

/** Every tile of the cage's zones, once each. */
export const CAGE_TILES: ReadonlyArray<{ x: number; z: number }> = (() => {
    const tiles = new Map<string, { x: number; z: number }>();
    for (const a of CAGE) for (let x = a.x0; x <= a.x1; x++) for (let z = a.z0; z <= a.z1; z++) tiles.set(`${x},${z}`, { x, z });
    return [...tiles.values()];
})();
/**
 * The cage's north strip. Every let-out that a minder answered at the first click was asked from here (8 of 8, lab
 * 10-22): it looks through the railing (blockrange=no) and is clear of what stands inside the cage (maps/m40_51.jm2): a
 * one-tile post box at (2602,3278) whose wood2 walls block a line of sight, and three 2x2 trees, at (2599,3277),
 * (2602,3276) and (2604,3278). Forced T run 2 asked a minder 3-4 tiles away nine times from (2603,3278), between the
 * post, a tree and a trunk, and was never answered.
 */
export const CAGE_NORTH_STRIP: Area = { x0: 2603, z0: 3280, x1: 2605, z1: 3281, level: 0 };
/** The let-out's bounds: attempts, and the ticks in which a new attempt may start (rs/185 and main, 10-22). */
export const LET_OUT_ATTEMPTS = 5;
export const LET_OUT_TICKS = 150;
/** The longest wait for a minder in reach (another one than the minder that just refused) before an attempt. */
export const LET_OUT_WAIT = 40;
/**
 * Ticks for a minder's first page after the click. An answered talk opens on the tick the server takes the click (the
 * approach trigger runs at once, and its first line is a chatnpc), so a click that opens nothing in this time was refused.
 */
export const LET_OUT_OPEN = 5;

export interface LetOutPick {
    minder: BotWorldState['nearbyNpcs'][number];
    /** The cage tile to ask from. */
    stand: { x: number; z: number };
    /** The minder's distance from `stand`. */
    distance: number;
}

/** Whether sort key `a` comes before `b`, element by element. */
function keyBefore(a: readonly number[], b: readonly number[]): boolean {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! < b[i]!;
    return false;
}

/**
 * The minder to ask and the cage tile to ask from. The SDK can't test a line of sight, so the pick asks from the north
 * strip whenever a minder there is in reach, and otherwise from the standable cage tile nearest a minder; ties go to
 * the shorter step from the player. `standable` says whether the player can stand on a tile (the SDK's pathfinder); the
 * minder `exclude` (the one that just refused) is never picked.
 */
export function letOutPick(s: BotWorldState, standable: (t: { x: number; z: number }) => boolean, exclude: number | null = null): LetOutPick | null {
    const p = pos(s);
    const stands = CAGE_TILES.filter(standable);
    let best: { pick: LetOutPick; key: number[] } | null = null;
    for (const m of s.nearbyNpcs) {
        if (!MINDER.test(m.name) || m.index === exclude) continue;
        const mt = { x: m.tileX ?? m.x, z: m.tileZ ?? m.z };
        for (const t of stands) {
            const d = chebyshev(t, mt);
            if (d < 1 || d > MINDER_REACH) continue;
            const key = [tileIn(t, CAGE_NORTH_STRIP) ? 0 : 1, d, chebyshev(t, p)];
            if (!best || keyBefore(key, best.key)) best = { pick: { minder: m, stand: t, distance: d }, key };
        }
    }
    return best?.pick ?? null;
}

/**
 * The backpack monkey's chat (mm_zoo_monkey.rs2:108-139): every 5-50 ticks while the player is not busy, a page
 * headed "The monkey in your backpack...", or for the snore, that and the player's "The what?". Matched per component:
 * the player's page joins to "<name> The what? Click here to continue", and a talk that took it for its NPC's opening
 * never re-clicked the click the chatter had swallowed (U's Waydar, 1 in 6 lab runs and a gate chain).
 */
export function isMonkeyChatter(d: Pick<BotWorldState['dialog'], 'allComponents'>): boolean {
    return (d.allComponents ?? []).some(c => /monkey in your backpack/i.test(c.text) || /^The what\?$/i.test(c.text.trim()));
}

export const MONKEY_CHATTER: Interrupt = {
    name: 'backpack monkey',
    match: s => isMonkeyChatter(s.dialog),
    dismiss: 'continue',
};

// The gnome side, for the return with the monkey (U) and the report (Y, Z).
/** The tile south of the Gnome Stronghold's south gate (travel.ts GNOME_STRONGHOLD_GATE) the walk from the zoo aims at. */
const GNOME_GATE_SOUTH = { x: 2461, z: 3382 };
/** North of the gate: inside the stronghold's walls. */
const inStronghold = (src: StateLike) => pos(src).z >= GNOME_STRONGHOLD_GATE.loc.z + 2 && pos(src).x < 2560 && pos(src).z < 3600;
/** The Grand Tree's scripted door (forcemoves 2 tiles), its trunk ladder and the two NPCs (speedrun/quests/grand-tree.ts TILES). */
const TREE_DOOR = { x: 2464, z: 3492 };
const TREE_DOOR_OUTSIDE = { x: 2465, z: 3490 };
const TREE_LADDER = { x: 2466, z: 3495 };
const NARNODE = { x: 2464, z: 3497 };
/** Daero on the tree's first floor (quest-mm-full.ts D3). */
const DAERO = { x: 2484, z: 3487 };
const inGrandTree = (src: StateLike) => {
    const p = pos(src);
    return p.x >= 2455 && p.x <= 2495 && p.z >= 3480 && p.z <= 3510 && (p.level > 0 || p.z >= 3493);
};
/** The powered hangar (Daero's blindfold lands at 0_41_70_25_36; mm_daero.rs2 tests mapsquares 40_70-41_71). */
export const HANGAR = { x0: 2560, z0: 4480, x1: 2687, z1: 4607, level: 0 } as const;
/** Crash Island (Waydar's flight lands at 0_45_42_13_37; mm_waydar.rs2 tests mapsquare 45_42). */
export const CRASH_ISLAND = { x0: 2880, z0: 2688, x1: 2943, z1: 2751, level: 0 } as const;
/** Varrock's spirit tree's foot (grand-tree.ts TILES.varrockTreeFoot): the tree hop needs the tree within 25 tiles. */
const VARROCK_TREE_FOOT = { x: 3177, z: 3505 };

/** The chapter 3 (level 0) and chapter 4 (level 1) cutscenes' mapsquare 41_71 (quest_mm.rs2:169-255). */
const CUTSCENE_ZONE = { x0: 2624, z0: 4544, x1: 2687, z1: 4607 } as const;

/**
 * Out of the western warehouse over the roofs: the warehouse's ground door
 * (2744,2767) is locked (quest_mm.rs2:1019), so up its two ladders, along
 * the level-2 bamboo bridges to the reverse ladder at (2787,2795), and down
 * through the temple's first floor. Measured 112 ticks to the bridge ladder
 * (speedrun/lab/measure-mm-routes.ts, ROOFS).
 */
const ROOFS: ReadonlyArray<{ x: number; z: number; climb?: true }> = [
    { x: 2752, z: 2767, climb: true }, { x: 2748, z: 2768, climb: true }, { x: 2786, z: 2793 },
    { x: 2787, z: 2795, climb: true }, { x: 2794, z: 2774 }, { x: 2794, z: 2773, climb: true },
];

/**
 * Elder guards near (2800,2758) stand in the pathfinder's route (NPCs are not
 * in its collision data), so from Garkor the walk west starts north of them at
 * (2799,2769), then follows the pathfinder's own corners towards the crates.
 * (2795,2772), the old first point, is a pocket walled on every side but the
 * north: its click was routed round by (2787,2773) and (2783,2783), ~20 ticks,
 * through a posted archer's reach (exec 8's J runs, an 8-10 hit each).
 */
export const GARKOR_WEST: Via = { points: [{ x: 2799, z: 2769 }, { x: 2790, z: 2764 }, { x: 2783, z: 2763 }], within: 12 };

/**
 * The Elder Guards at Awowogei's door (2798-2801, 2757-2760) hit any adjacent
 * human (mm_elder_guard.rs2), and the pathfinder's line to Garkor can pass
 * them, so Garkor is approached from the north.
 */
/**
 * Into the crate building (x 2759-2770, z 2764-2772) by its south door. The
 * Sleeping Monkey (spawned at (2760,2771)) wakes and summons guards, a named
 * one always knocking out, when a human enters SLEEPING_ZONE
 * (mm_sleeping_monkey_guard.rs2, quest_mm.rs2 aa_summon_guards). The
 * building's north entrance lies in that zone and the pathfinder cuts across
 * it, so the walk goes round to the south door's outside tile, the door's op
 * moves the player in (CRATE_DOOR), and inside the player keeps to z 2764 and
 * x 2770 up to CRATE_STRIP_ENTRY and reaches both crates from x 2768 or more
 * by single-tile steps (crateSteps). A walk click onto the door's tile is no
 * way in: it counts as arrived from outside, and the next click inside was
 * routed round through the north entrance (rs/201 exec 8's J-P smoke, t 88-101).
 */
const CRATES_SOUTH = [{ x: 2771, z: 2763 }] as const;
/** The south door (mm_bamboo_door_secure, op1 open_and_close_door2: the player is moved through) and the tile outside it. */
const CRATE_DOOR = { x: 2764, z: 2764 };
const CRATE_DOOR_OUTSIDE = { x: 2764, z: 2763 };
const CRATE_STRIP_ENTRY = { x: 2770, z: 2768 };
/** Inside the crate building's walls (maps/m43_43.jm2: walls x 2759 and z 2764 / 2772). */
const inCrateBuilding = (src: StateLike) => {
    const p = pos(src);
    return p.level === 0 && p.x >= 2760 && p.x <= 2770 && p.z >= 2764 && p.z <= 2771;
};

/** mm_sleeping_monkey_guard.rs2's zone: a human stepping in wakes the Sleeping Monkey, whose summoned guard always knocks out. */
export const SLEEPING_ZONE = { x0: 2762, z0: 2767, x1: 2767, z1: 2772, level: 0 } as const;

/**
 * Single-tile steps from `from` through `points` in the crate building (a diagonal first, as the server steps), so no
 * route the pathfinder or the server picks can cut a corner into SLEEPING_ZONE. Throws when a step would enter it.
 */
export function crateSteps(from: { x: number; z: number }, points: ReadonlyArray<{ x: number; z: number }>): Array<{ x: number; z: number }> {
    const steps = pathTiles(from, points);
    const bad = steps.find(t => tileIn({ ...t, level: 0 }, SLEEPING_ZONE));
    if (bad) throw new Error(`a crate step from ${from.x},${from.z} enters the Sleeping Monkey's zone at ${bad.x},${bad.z}`);
    return steps;
}

/** The tile east of the denture crate, the only side outside the sleeping guard's zone. */
const DENTURES_EAST = { x: 2768, z: 2769 };

/**
 * The crate steps' route from `from`: east along its row to the x 2770 spine (z 2764 from the door, z 2769 from the
 * dentures), along the spine, and in. The thread crate at (2769,2767) blocks its tile (maps/m43_43.jm2), so the hole
 * crate's access tile (2769,2766) is reached from (2770,2766); the dentures by the ruled (2770,2768), (2769,2769).
 */
export function crateRoute(from: { x: number; z: number }, to: { x: number; z: number }): Array<{ x: number; z: number }> {
    const pts = from.x === 2770 ? [] : [{ x: 2770, z: from.z }];
    if (to.x === DENTURES_EAST.x && to.z === DENTURES_EAST.z) pts.push(CRATE_STRIP_ENTRY, { x: 2769, z: 2769 }, to);
    else pts.push({ x: 2770, z: to.z }, to);
    return pts;
}

/**
 * Corners round the crate building for a human walk whose route crosses SLEEPING_ZONE (gate chain a's P walk from the
 * aunt to the bridge took the building as a shortcut and was knocked out at t 2359): north-east, south-east, north-west.
 * Each is a tile a logged chain walked.
 */
export const SLEEPING_DETOURS: ReadonlyArray<{ x: number; z: number }> = [{ x: 2775, z: 2774 }, { x: 2771, z: 2763 }, { x: 2762, z: 2775 }];

export const entersSleepingZone = (from: { x: number; z: number }, points: ReadonlyArray<{ x: number; z: number }>) => pathTiles(from, points).some(t => tileIn({ ...t, level: 0 }, SLEEPING_ZONE));

/** The detour to walk first: of those whose own route from `from` keeps out of the zone, the nearest to `to`; null with none. */
export function sleepingDetour(from: { x: number; z: number }, to: { x: number; z: number }, route: (p: { x: number; z: number }) => ReadonlyArray<{ x: number; z: number }>): { x: number; z: number } | null {
    const ok = SLEEPING_DETOURS.filter(d => chebyshev(d, from) > 0 && !entersSleepingZone(from, route(d)));
    ok.sort((a, b) => chebyshev(a, to) - chebyshev(b, to));
    return ok[0] ?? null;
}

/**
 * J's hard abort: the first state showing a human inside SLEEPING_ZONE trips it (noted), and `check`, called between the
 * crate approach's steps and searches, then throws before any more clicks go out from there.
 */
function sleepingZoneWatch(sdk: Sdk): { check(): void; stop(): void } {
    let at: string | null = null;
    const stop = sdk.onStateUpdate(s => {
        if (at || !s.player || wearing(s, MM_OBJ.greegree)) return;
        const p = pos(s);
        if (!tileIn(p, SLEEPING_ZONE)) return;
        at = `${p.x},${p.z}`;
        stepNote(`S15:J stepped into the Sleeping Monkey's zone at ${at} (t=${s.tick})`);
    });
    return {
        check: () => {
            if (at) throw new Error(`hard abort: a human stepped into the Sleeping Monkey's zone at ${at}`);
        },
        stop,
    };
}
const CRATES_FROM_GARKOR: Via = { points: [...GARKOR_WEST.points, ...CRATES_SOUTH], within: 12 };
const CRATES: Via = { points: CRATES_SOUTH, within: 80 };

/** Already in the crate building's safe strip (z 2764-2769, x 2768-2770): no detour needed. */
const inCrateStrip = (src: StateLike) => {
    const p = pos(src);
    return p.level === 0 && p.x >= 2768 && p.x <= 2770 && p.z >= 2764 && p.z <= 2769;
};

const GARKOR_NORTH: Via = { points: [{ x: 2804, z: 2770 }, { x: 2806, z: 2766 }], within: 80 };

/**
 * The temple, by rs/59's ladder drop (quest_mm.rs2:759-771: a bamboo ladder
 * moves the player one level on their own tile). Up the south ladder, along
 * floor 1, and down the east ladder onto (2806,2785), the trapdoor's only
 * access tile inside the guards' box.
 */
const TEMPLE_LADDER = { x: 2794, z: 2773 };
const TEMPLE_LADDER_FOOT = { x: 2794, z: 2774 };
const TEMPLE_DROP_TOP = { x: 2806, z: 2785 }; // floor 1, beside the east ladder's top (2805,2785)
const TEMPLE_DROP_LADDER = { x: 2805, z: 2785 };
const TRAPDOOR = { x: 2807, z: 2785 };
const TRAPDOOR_ACCESS = { x: 2806, z: 2785 };
/** Under the trapdoor (mm_temple.rs2: 0_43_143_55_49); the rope up lands within 2 of the trapdoor. */
const TEMPLE_ROPE = { x: 2808, z: 9201 };
/**
 * The rope's open sides, south and west first (maps/m43_143.jm2: cave wall on its east). From a diagonal tile the server
 * answers "I can't reach that!", and zombie monkeys standing on the sides kept a chain there for 30 ticks.
 */
export const TEMPLE_ROPE_SIDES: ReadonlyArray<{ x: number; z: number }> = [{ x: 2808, z: 9200 }, { x: 2807, z: 9201 }, { x: 2808, z: 9202 }];

/** West of the trapdoor guards' hunt range (spawns (2803-2805, 2783-2786), maxrange 2). */
const TEMPLE_CLEAR = { x: 2795, z: 2786 };

/**
 * The Monkey's Aunt patrols round the house the monkey child stays in
 * (configs/quest_mm.npc patrol1-8, every 2 ticks huntall radius 5,
 * mm_monkeys_aunt.rs2). Inside the house zone (x 2740-2746, z 2792-2798)
 * a human is safe from her exactly while she is out of it. Measured at 300
 * ms (lab/measure-mm-patrol.ts --npc=Aunt, two cycles): she leaves by the
 * south door at (2743,2791), loops south and through the garden, and is back
 * in at (2740,2794) 76 ticks later; then about 50 ticks inside. Each entry:
 * a tile of the loop and the ticks since she left at which she arrives and
 * departs (waits included).
 */
export const AUNT_LOOP: ReadonlyArray<readonly [x: number, z: number, arrive: number, depart: number]> = [
    [2743, 2791, 0, 1], [2743, 2790, 1, 2], [2743, 2789, 2, 3], [2743, 2788, 3, 4], [2743, 2787, 4, 10],
    [2742, 2786, 10, 11], [2741, 2786, 11, 17], [2740, 2786, 17, 18], [2739, 2786, 18, 19], [2738, 2786, 19, 20], [2737, 2786, 20, 26],
    [2736, 2787, 26, 27], [2736, 2788, 27, 28], [2736, 2789, 28, 29], [2736, 2790, 29, 30], [2736, 2791, 30, 31], [2736, 2792, 31, 37],
    [2735, 2792, 37, 38], [2734, 2792, 38, 39], [2733, 2792, 39, 55], [2734, 2793, 55, 56], [2735, 2794, 56, 57], [2736, 2794, 57, 58],
    [2737, 2794, 58, 74], [2738, 2794, 74, 75], [2739, 2794, 75, 76],
];
/** Ticks after leaving at which the aunt is back in the house. */
export const AUNT_BACK_IN = 76;
/** From this far into her loop the house's door is more than 5 tiles from her: the walk in is safe. */
export const AUNT_DOOR_CLEAR = 20;

export const AUNT_HOUSE = { x0: 2740, z0: 2792, x1: 2746, z1: 2798, level: 0 } as const;

/**
 * Where the aunt is in her loop, from her tile: `[earliest, latest]` ticks
 * since she left the house, or null when she is in the house (or off the
 * measured loop, which is treated the same: not safe).
 */
export function auntLoopAt(at: { x: number; z: number }): [number, number] | null {
    const e = AUNT_LOOP.find(([x, z]) => x === at.x && z === at.z);
    return e ? [e[2], e[3]] : null;
}

/** Ticks of safe house time left, judged from the aunt's tile alone: 0 when she is in or entering the house. */
export function auntWindowLeft(at: { x: number; z: number }): number {
    const e = auntLoopAt(at);
    return e ? Math.max(0, AUNT_BACK_IN - 2 - e[1]) : 0;
}

/**
 * The child is in the house; a human waits for the aunt's loop here, exactly
 * (one tile off is in range): 6 from every tile of her loop (her hunt radius
 * is 5), 7 from the nearest posted Monkey Archer (2752,2782) (huntrange and
 * attackrange 6, configs/quest_mm.npc), and 6 in a straight line from the
 * house's south door. At (2750,2787), within the archers' range, a human
 * without a prayer died waiting. Padulah (aggressive melee, strength 130,
 * huntrange 10, patrolling x 2754-2761, z 2781-2788) reaches every tile
 * near the door, so the wait is prayed with Protect from Melee.
 */
const AUNT_WAIT = { x: 2749, z: 2791 };
const CHILD = { x: 2743, z: 2795 };

/**
 * When a shark is eaten. `below`: per segment letter, eat under this HP; `otherwise` for the segments not listed.
 * `topUpBelow`, when set: inside O and P, before each dialogue and each ladder (which block eating), eat under it.
 */
export interface EatPolicy {
    below: Readonly<Partial<Record<string, number>>>;
    otherwise: number;
    topUpBelow?: number;
}

/**
 * The temple's Monkey Guards (mm_religious_guard: level 167, attack and strength 130, aggressive melee, hunt range 5),
 * spawned around the temple on the ground and its first floor (maps/m43_43.jm2). Under the town walks' Protect from
 * Missiles their 12-15 hits landed in full in J, K and N (rs/201's J/K per-hit trace, 10-22).
 */
export const RELIGIOUS_GUARDS: Readonly<Record<number, ReadonlyArray<{ x: number; z: number }>>> = {
    0: [{ x: 2788, z: 2778 }, { x: 2793, z: 2782 }, { x: 2793, z: 2789 }, { x: 2795, z: 2775 }],
    1: [{ x: 2790, z: 2790 }, { x: 2797, z: 2780 }, { x: 2797, z: 2791 }],
};
/** A guard's hunt range plus one: a leg passing this close to a spawn is walked under Protect from Melee. */
export const GUARD_REACH = 6;

/**
 * The town's posted Monkey Archers (mm_posted_archer: aggressive ranged, attack range 6, wanderrange 0), all on level 0
 * (maps/m43_43.jm2). Under Protect from Melee beside the temple, archer-sized hits landed at I (2791,2770) and J
 * (2783-2788, 2772-2780) in rs/201 execution 7's 13:34 round, in reach of the posts at (2785,2768) and (2780,2773).
 */
export const POSTED_ARCHERS: ReadonlyArray<{ x: number; z: number }> = [
    { x: 2752, z: 2782 }, { x: 2754, z: 2778 }, { x: 2755, z: 2774 }, { x: 2756, z: 2789 }, { x: 2759, z: 2756 }, { x: 2761, z: 2778 },
    { x: 2762, z: 2793 }, { x: 2765, z: 2779 }, { x: 2767, z: 2784 }, { x: 2769, z: 2754 }, { x: 2770, z: 2774 }, { x: 2772, z: 2781 },
    { x: 2774, z: 2787 }, { x: 2775, z: 2756 }, { x: 2777, z: 2790 }, { x: 2780, z: 2773 }, { x: 2785, z: 2768 }, { x: 2789, z: 2754 },
    { x: 2791, z: 2763 },
];
export const ARCHER_REACH = 6;

/**
 * The aunt's box: her house (AUNT_HOUSE) and the wait tile (AUNT_WAIT), where she and Padulah, both melee, reach a human
 * who waits or talks. Melee there; every walk to it goes by the town's zone (rs/158 and main, 10-22 14:1x: gate chain b
 * died walking from the temple to the wait tile under Melee, the town's archers hitting 9-11).
 */
export const AUNT_BOX = { x0: 2740, z0: 2791, x1: 2749, z1: 2798, level: 0 } as const;

export type ZonePrayer = 'protect_from_melee' | 'protect_from_missiles';

/**
 * The zone prayer on a tile of the atoll as a human, the one location rule for H-P's walks, waits and talks: Melee in the
 * aunt's box, and within GUARD_REACH of a religious guard's spawn on the tile's level unless a posted archer reaches the
 * tile too; Missiles everywhere else (the town's archers reach almost every street).
 */
export function tilePrayer(p: { x: number; z: number }, level: number): ZonePrayer {
    if (level === 0 && tileIn({ ...p, level }, AUNT_BOX)) return 'protect_from_melee';
    if (!(RELIGIOUS_GUARDS[level] ?? []).some(g => chebyshev(p, g) <= GUARD_REACH)) return 'protect_from_missiles';
    if (level === 0 && POSTED_ARCHERS.some(a => chebyshev(p, a) <= ARCHER_REACH)) return 'protect_from_missiles';
    return 'protect_from_melee';
}

/**
 * The corridor's no-dwell tiles, in reach of both a religious guard and a posted archer (rs/158, 10-22 14:1x): no prayer
 * covers a stop there, so no waypoint, wait or climb of the module lies on one.
 */
export const NO_DWELL: ReadonlyArray<{ x: number; z: number }> = [
    ...[2774, 2775, 2776, 2777, 2778, 2779].map(z => ({ x: 2786, z })),
    ...[2787, 2788, 2789, 2790, 2791].map(x => ({ x, z: 2774 })),
];

/** A run of one zone prayer shorter than this takes its neighbour's: each switch is a stop, the toggle made standing. */
export const MIN_PRAYER_RUN = 2;

export interface PrayerRun {
    to: { x: number; z: number };
    prayer: ZonePrayer;
    tiles: number;
}

/** The tiles a walk from `from` through `points` steps on, `from` excluded: a diagonal step first, as the server walks. */
export function pathTiles(from: { x: number; z: number }, points: ReadonlyArray<{ x: number; z: number }>): Array<{ x: number; z: number }> {
    const out: Array<{ x: number; z: number }> = [];
    let c = { x: from.x, z: from.z };
    for (const p of points) {
        while (c.x !== p.x || c.z !== p.z) {
            c = { x: c.x + Math.sign(p.x - c.x), z: c.z + Math.sign(p.z - c.z) };
            out.push(c);
        }
    }
    return out;
}

/**
 * A walk from `from` through `points` on `level`, split where tilePrayer changes along its tiles. Each run is walked
 * under its prayer, set standing at the previous run's end (a prayer click mid-walk cancels the walk, rs/241). A run
 * under MIN_PRAYER_RUN tiles is absorbed by the run before it (the first by the one after), so a clipped corner costs
 * no stop.
 */
export function prayerRuns(from: { x: number; z: number }, points: ReadonlyArray<{ x: number; z: number }>, level: number): PrayerRun[] {
    const tiles = pathTiles(from, points);
    if (!tiles.length) return [{ to: { x: from.x, z: from.z }, prayer: tilePrayer(from, level), tiles: 0 }];
    let runs: PrayerRun[] = [];
    const add = (r: PrayerRun) => {
        const last = runs[runs.length - 1];
        if (last && last.prayer === r.prayer) {
            last.to = r.to;
            last.tiles += r.tiles;
        } else runs.push({ ...r });
    };
    for (const t of tiles) add({ to: t, prayer: tilePrayer(t, level), tiles: 1 });
    for (let i = runs.findIndex(r => r.tiles < MIN_PRAYER_RUN); i >= 0 && runs.length > 1; i = runs.findIndex(r => r.tiles < MIN_PRAYER_RUN)) {
        const short = runs.splice(i, 1)[0]!;
        if (i > 0) {
            runs[i - 1]!.to = short.to;
            runs[i - 1]!.tiles += short.tiles;
        } else runs[0]!.tiles += short.tiles;
        const was = runs;
        runs = [];
        for (const r of was) add(r);
    }
    return runs;
}

/** One prayer for a leg walked unsplit (a ladder's approach, the bridge jump): Melee when any of its runs is. */
export function legPrayerFor(from: { x: number; z: number }, to: { x: number; z: number }, level: number): ZonePrayer {
    return prayerRuns(from, [to], level).some(r => r.prayer === 'protect_from_melee') ? 'protect_from_melee' : 'protect_from_missiles';
}

/**
 * The ruled policy (rs/158 and main, 10-22 14:1x): eat below 10 + the segment's worst damage in any 3-tick window, hits
 * and poison, with the hits within GUARD_REACH of a guard spawn left out, everywhere. The zone prayer removed the guards'
 * 12-15 hits in the 13:34 round, so the corridor's higher thresholds are gone. No top-ups. A shark heals 20 against a
 * 42 max, so a threshold of 23 or less wastes nothing.
 */
export const SEGMENT_EATING: EatPolicy = {
    below: { H: 27, I: 22, J: 25, K: 26, L: 12, M: 21, N: 23, O: 24, P: 25, Q: 12, R: 16 },
    otherwise: 20,
};

/**
 * Exec 7's first gate chains: eat below 30, and in O and P a top-up below 34 before each dialogue and ladder. Measured:
 * 69-85 HP of each chain's healing went over the 42 max (about 4 sharks), and both clean chains ran out by R.
 */
export const BELOW_30_EATING: EatPolicy = { below: {}, otherwise: 30, topUpBelow: 34 };

/** The HP `policy` eats under in segment `letter`. */
export function eatBelowFor(policy: EatPolicy, letter: string): number {
    return policy.below[letter] ?? policy.otherwise;
}

/** A top-up eat is wanted before a dialogue or a ladder: under `topUpBelow` with a shark held. */
export function topUpWanted(s: BotWorldState, topUpBelow: number): boolean {
    return (s.player?.hp ?? 0) < topUpBelow && invCount(s, MM_OBJ.shark) > 0;
}

/** The running segment's eat thresholds, set by stepFor before each body runs. */
let eating: { below: number; topUpBelow?: number } = { below: SEGMENT_EATING.otherwise };

/** The running segment's dialogue mode, set by stepFor before each body runs. */
let dialogue: DialogueMode = DEFAULT_OPTIONS.dialogue;

/**
 * Converse options for a conversation of `shape` (MM_SHAPES) in `mode`: talkShape's in burst; none in fixed, so a
 * fixed run's converse calls carry exactly the options they had before burst existed.
 */
export function dialogueOptions(mode: DialogueMode, shape: string): ReturnType<typeof talkShape> | Record<string, never> {
    return mode === 'burst' ? talkShape({ dialogue: mode }, shape) : {};
}

const shaped = (shape: string) => dialogueOptions(dialogue, shape);

/** Note a burst conversation against its shape: the pages seen, whether they matched, and the bursts. */
function noteShape(label: string, r: ConverseResult | undefined): void {
    if (dialogue !== 'burst') return;
    const s = r?.shape;
    if (!r || !s) return stepNote(`S15 shape ${label}: no dialogue`);
    const how = s.burst ? `bursts ${s.bursts}, failed ${s.failedBursts}, ${s.burstPages}/${r.pages} pages burst` : 'fixed';
    stepNote(`S15 shape ${label}: ${s.matches ? 'match' : 'MISMATCH'} seen [${s.seen}] expected [${s.expected}], ${r.ticks} ticks, ${how}${s.stopped ? `, stopped ${s.stopped}` : ''}${r.ok ? '' : `, not ok: ${r.reason ?? 'unknown'}`}`);
}

/** Drink a prayer potion below this many points while a prayer is on (a dose restores 30 at Prayer 94). */
export const DRINK_BELOW = 20;

/**
 * Prayer points X needs for the Jungle Demon under Protect from Magic, counting held doses: the five
 * measured kills took 94 down to 30-50, 44-64 points (rs/201), with margin (rs/687's budget).
 */
export const X_PRAYER = 70;

// ------------------------------------------------------------------ actions

export type MmContext = Record<string, never>;
type Ctx = StepContext<MmContext>;
type Sdk = Ctx['sdk'];

const where = (sdk: Sdk) => JSON.stringify(pos(sdk));

/** The controls tab's auto-retaliate off button (interface.pack controls:com_3, player_controls.rs2). */
const IF_AUTO_RETALIATE_OFF = 151;

/**
 * Auto-retaliate off, confirmed from the published state. The atoll's
 * spiders, snakes and scorpions attack a human unprovoked, and with
 * auto-retaliate on each hit turns the player on them, which cancels a crate
 * search or a talk mid-dialogue. The button applies only when the server can
 * take the player's protected access (player_controls.rs2: p_finduid);
 * while the player is busy it just resyncs the varp, so it is retried over
 * about 30 ticks. Left on, it costs time (searches repeat), not the segment.
 */
async function noRetaliate(sdk: Sdk, note: (line: string) => void = () => {}): Promise<void> {
    for (let i = 0; i < 8 && sdk.getState()?.autoRetaliateEnabled !== false; i++) {
        await sdk.sendClickComponent(IF_AUTO_RETALIATE_OFF);
        await waitUntil(sdk, s => s.autoRetaliateEnabled === false, { maxTicks: 4 });
    }
    if (sdk.getState()?.autoRetaliateEnabled !== false) note('S15: auto-retaliate stayed on after 8 clicks');
}

/**
 * The prayer points under which upkeep drinks even with a chat open. Only a stuck chat gets here: from DRINK_BELOW a
 * protect prayer's drain (about a point per 5 ticks at no prayer bonus) takes some 70 ticks to reach it, and the longest
 * chat open under a protect prayer in rs/513's five A-Z chains was 12 ticks.
 */
export const CHAT_DRINK_FLOOR = 5;

/**
 * Whether upkeep may click a pack item for a drink, an antipoison or a vial drop now. Every pack click closes the open chat
 * (OpHeldHandler: clearPendingAction, closeModal), so one sent in the tick a talk's page opens ends the talk: rs/513
 * chain 1's O lost the child's talisman talk that way, to a prayer potion drunk on its first page. Held while a chat is
 * open; the drink goes on the first tick it is closed. A main modal (a chapter card) is not held for: the module closes
 * those itself, so a drink that closes one costs nothing.
 */
export function packClickAllowed(s: Pick<BotWorldState, 'dialog'>): boolean {
    return !s.dialog.isOpen;
}

/**
 * Upkeep while `fn` runs, on the atoll and on the gnome half alike: auto-retaliate off, a shark below the segment's eat threshold, the
 * antipoison on a poisoning and a prayer potion below DRINK_BELOW while a prayer is on. Measured: B's walk through the
 * Karamja jungle poisoned the player, and with no cure the poison killed a 42 HP player in E's hangar. The drinks and the
 * vial drop wait out an open chat (packClickAllowed); the eat is the shared Upkeep's and does not.
 */
export async function upkeep<T>(sdk: Sdk, fn: () => Promise<T>): Promise<T> {
    await noRetaliate(sdk);
    const u = new Upkeep(sdk, { eatBelow: eating.below, food: MM_OBJ.shark });
    let lastDrink = -Infinity;
    let lastVialDrop = -Infinity;
    // The wildlife's poison (aa_wildlife.rs2) keeps ticking into the next stretch, and S14's spiders' into A: the antipoison
    // ends it and grants immunity. A poison already on when upkeep starts is cured on its first state.

    const stop = sdk.onStateUpdate(s => {
        // An H12o receive leg owns the pack while it trades: an eat, a drink or a drop would delay SCORED past its trade
        // click (a delayed player's click is dropped) or close the open trade.
        if (trading || tradeOf(s).isOpen) return;
        void u.step(s);
        const clickable = packClickAllowed(s);
        if (clickable && cureWanted(s, antipoisonDrunkAt(s.tick))) {
            const cure = cureDose(s);
            if (cure) {
                noteAntipoison(s.tick);
                stepNote(`S15 antipoison: ${cure.name} to cure a poisoning at t=${s.tick} (poison seen at t=${poisonSeenAt(s)})`);
                void sdk.sendUseItem(cure.slot, cure.optionsWithIndex.find(o => /^drink$/i.test(o.text))?.opIndex ?? 1);
            }
        }
        // A potion's last dose leaves an empty vial (potions.obj next_obj_stage); it would hold a slot to the end.
        const vial = s.inventory.find(i => /^Vial$/i.test(i.name));
        if (vial && clickable && s.tick - lastVialDrop >= 2) {
            lastVialDrop = s.tick;
            void sdk.sendDropItem(vial.slot);
        }
        // Upkeep drinks only for a prayer it manages itself; the atoll's protect prayers come and go by stretch.
        const p = s.prayers;
        if (!p || p.prayerPoints >= DRINK_BELOW || !p.activePrayers.some(Boolean) || s.tick - lastDrink < 3) return;
        if (!clickable && p.prayerPoints >= CHAT_DRINK_FLOOR) return;
        const pot = s.inventory.find(i => /^Prayer potion/i.test(i.name));
        if (!pot) return;
        lastDrink = s.tick;
        void sdk.sendUseItem(pot.slot, pot.optionsWithIndex.find(o => /^drink$/i.test(o.text))?.opIndex ?? 1);
    });
    try {
        return await fn();
    } finally {
        stop();
    }
}

/**
 * Ticks of poison immunity a super antipoison dose gives: %poison to -20 (anti_poison.rs2), stepped by 1 every 30 ticks
 * (poison.rs2 set_poison_timer). The dungeon's spikes and spear traps skip their poison while %poison is negative
 * (ape_atoll_dungeon.rs2).
 */
export const SUPER_IMMUNE_TICKS = 600;

/**
 * Whether to drink an antipoison now: whenever the poison is on (segments.ts `poisoned`: a poison hit or the poisoned
 * message newer than the last dose), a poison carried into the segment included, never within 3 ticks of a dose, in every
 * segment. Deferring C's cure (the Karamja jungle) to save the dose for H-R was measured to fail the HP
 * floor: in 2 of 3 chains the poison held HP to 20 through Daero's blindfold pages, where no eat can land, and an
 * 11 then took it to 9 in E.
 */
export function cureWanted(s: Pick<BotWorldState, 'tick' | 'combatEvents' | 'gameMessages'>, lastDose: number): boolean {
    // A dose ahead of the clock is from before a client reload (the tick restarts): none, as `poisoned` reads it.
    const dose = lastDose > s.tick ? -Infinity : lastDose;
    return poisoned(s, dose) && s.tick - dose >= 3;
}

/**
 * A dose is wanted on entering a dungeon pass: one is held, and the last dose's immunity has under 60 ticks left. A dose
 * ahead of `now` is from before a client reload (the tick restarts) and is not trusted to cover the pass.
 */
export function immunityWanted(now: number, lastDose: number, held: boolean): boolean {
    return held && (lastDose > now || now - lastDose > SUPER_IMMUNE_TICKS - 60);
}

/**
 * H12's optional pre-dose (rs/158's zero-slot option): a one-dose super antipoison in the 28th slot, drunk at A's start
 * (the vial dropped by upkeep) before Narnode's seal needs the slot. Its ~600 ticks of immunity cover the gnome half's
 * Karamja jungle (B, C), so the 4-dose potion's doses all reach H-R. With none brought, a poison still on after the swap
 * (no antipoison(*) was held before it, cureBeforeSwap) takes one dose of H12's Superantipoison(4) here, after the swap has
 * sized the kit and before Narnode's talk opens; clean, nothing is drunk.
 */
export async function preDose(sdk: Sdk): Promise<void> {
    const s = sdk.getState()!;
    const dose = s.inventory.find(i => i.id === MM_OBJ.superAntipoison1);
    // The kit's super line takes any dose (h12Kit), so a lone one-dose super may be all the kit has: never pre-dose that.
    // A poison that is on is still cured, from it if it is the only dose held (upkeep would drink it on its next state).
    const lone = !!dose && !s.inventory.some(i => i.slot !== dose.slot && KIT_SUPER.test(i.name));
    if (!dose || lone) {
        if (lone) stepNote('S15 antipoison: no pre-dose, the one-dose super is the kit\'s only super');
        if ((await curePoison(sdk, 'S15:A after the swap')) === 'cured') stepNote(`S15 antipoison: a Superantipoison dose at A after the swap, t=${antipoisonDrunkAt()}`);
        return;
    }
    const at = currentTick(sdk);
    noteAntipoison(at);
    void sdk.sendUseItem(dose.slot, dose.optionsWithIndex.find(o => /^drink$/i.test(o.text))?.opIndex ?? 1);
    const r = await waitUntil(sdk, s => !s.inventory.some(i => i.id === MM_OBJ.superAntipoison1), { maxTicks: 4 });
    if (!r.ok) throw new Error(`the pre-dose super antipoison was not drunk (at ${where(sdk)})`);
    await drinkDelayOver(sdk, at);
    stepNote(`S15 antipoison: the pre-dose at A, t=${at} (immune to about t=${at + SUPER_IMMUNE_TICKS})`);
}

/** Drink an antipoison dose before a dungeon pass when immunityWanted, so the pass's spikes and spears never poison. */
async function immune(sdk: Sdk, pass: string): Promise<void> {
    const s = sdk.getState()!;
    const dose = s.inventory.find(i => ANTIPOISON.test(i.name));
    if (!immunityWanted(s.tick, antipoisonDrunkAt(s.tick), !!dose)) return;
    const names = () => sdk.getState()!.inventory.filter(i => ANTIPOISON.test(i.name)).map(i => i.name).join(',');
    const before = names();
    noteAntipoison(s.tick);
    void sdk.sendUseItem(dose!.slot, dose!.optionsWithIndex.find(o => /^drink$/i.test(o.text))?.opIndex ?? 1);
    await waitUntil(sdk, () => names() !== before, { maxTicks: 3 });
    stepNote(`S15 antipoison: a dose before ${pass} at t=${s.tick} (immune to about t=${s.tick + SUPER_IMMUNE_TICKS})`);
}

/** On while O's and P's bodies run (withTopUps): climb, talk and P's bridge jump then top up first. */
let topUps = false;

async function withTopUps<T>(fn: () => Promise<T>): Promise<T> {
    const was = topUps;
    topUps = true;
    try {
        return await fn();
    } finally {
        topUps = was;
    }
}

/**
 * Until the running upkeep's eats bring HP to `below` or the sharks run out (a shark every 3 ticks; at most 12 ticks):
 * at once when HP is already there or unknown. Upkeep eats on its own; this only waits for it to land.
 */
async function eatenUpTo(sdk: Sdk, below: number): Promise<void> {
    const fed = (s: BotWorldState) => s.player?.hp === undefined || s.player.hp >= below || invCount(s, MM_OBJ.shark) === 0;
    if (fed(sdk.getState()!)) return;
    await waitUntil(sdk, fed, { maxTicks: 12 });
}

/**
 * The top-up eat before a dialogue or a ladder, inside withTopUps and only when the policy has one. Under the eat
 * threshold the running upkeep eats on its own, so the top-up waits for that eat first rather than sending a second.
 */
async function topUp(sdk: Sdk): Promise<void> {
    const top = eating.topUpBelow;
    if (!topUps || top === undefined || sdk.getState()!.dialog.isOpen) return;
    if ((sdk.getState()!.player?.hp ?? 0) < eating.below) await waitUntil(sdk, s => (s.player?.hp ?? 0) >= eating.below || invCount(s, MM_OBJ.shark) === 0, { maxTicks: 4 });
    const s = sdk.getState()!;
    if (!topUpWanted(s, top)) return;
    const shark = s.inventory.find(i => i.id === MM_OBJ.shark)!;
    const n = invCount(s, MM_OBJ.shark);
    void sdk.sendUseItem(shark.slot, shark.optionsWithIndex.find(o => /^eat$/i.test(o.text))?.opIndex ?? 1);
    await waitUntil(sdk, x => invCount(x, MM_OBJ.shark) < n, { maxTicks: 3 });
}

/** Dismiss whatever chat pages are open (Lumo's welcome in the cell, an objbox). */
async function dismiss(sdk: Sdk): Promise<void> {
    if (!sdk.getState()?.dialog.isOpen) return;
    await converse(sdk, [], { openTicks: 1, idle: 2, unmatched: 'first', maxTicks: 40 });
}

/**
 * Wait out a region rebuild: while the browser client rebuilds after a teleport, a ladder or a trapdoor (sceneReady
 * false), its NPC and loc lists are empty or the old region's. For a one-shot read on a landing frame; lib/world.ts
 * findLoc waits the same way for locs.
 */
export async function sceneBuilt(sdk: Sdk): Promise<void> {
    if (sdk.getState()?.sceneReady === false) await waitUntil(sdk, s => s.sceneReady !== false, { maxTicks: 60 });
}

async function go(ctx: Ctx, to: { x: number; z: number }, tol = 0): Promise<void> {
    const r = await walkTo(ctx.bot, ctx.sdk, to.x, to.z, tol);
    if (!r.ok) throw new Error(`walk to ${to.x},${to.z} failed at ${where(ctx.sdk)}: ${r.message}`);
}

/** One walk click, re-sent until within `tol`; false when a knockout sent the player to the cell instead. */
async function click(sdk: Sdk, to: { x: number; z: number }, tol = 1): Promise<boolean> {
    const r = await act(sdk, () => sdk.sendWalk(to.x, to.z, true), s => inCell(s) || (pos(s).level === 0 && chebyshev(pos(s), to) <= tol), { resendEvery: 3, maxResends: 20, maxTicks: 60 });
    if (!r.ok) throw new Error(`click-walk to ${to.x},${to.z} stopped at ${where(sdk)}`);
    return !inCell(sdk);
}

/** Climb the ladder or rope at (x, z) on the player's level; done when the level changes or the player jumps between surface and underground. */
async function climb(sdk: Sdk, at: { x: number; z: number }, op: RegExp = /climb/i, extra: { interrupts?: readonly Interrupt[] } = {}): Promise<void> {
    await topUp(sdk);
    const p0 = pos(sdk);
    const moved: Pred = s => {
        const p = pos(s);
        return p.level !== p0.level || Math.abs(p.z - p0.z) > 1000;
    };
    const r = await opLoc(sdk, { ...at, op, radius: 15 }, op, moved, { resendEvery: 5, maxTicks: 30, ...extra });
    if (!r.ok) {
        const d = sdk.getState()?.dialog;
        throw new Error(`${r.loc.name} at ${at.x},${at.z} did not move the player (at ${where(sdk)}; dialog ${d?.isOpen ? (d.allComponents ?? []).map(c => c.text).join('/') : 'closed'})`);
    }
}

/** The jail patrol's gorillas (mm_jail.rs2 mm_jail_patrol). */
const PATROL = /^(Aberab|Trefaji)$/;
/** The top of the lane north of the cell door, where the patrol's shuttle turns (configs/quest_mm.enum mm_jail_patrol_route). */
const LANE_TOP = { x: 2772, z: 2801 };

/**
 * The jail yard: the cell door opens into a walled lane (x 2772-2773) whose
 * only way out is at its top, west through (2770,2798) and along z 2798 to
 * (2765,2798), then south. That is the gorillas' own patrol route, and a
 * gorilla knocks out any human within 1 tile in line of sight. Measured at
 * 300 ms (lab/measure-mm-patrol.ts), the active gorilla shuttles the lane for
 * about 110 ticks, then steps off its top to (2771,2801), walks down to
 * (2770,2798), west to (2767,2798) and north up x 2767, where it pauses about
 * 8 ticks; the other gorilla appears at (2768,2798) about 10 ticks later.
 * The way out is to follow the outgoing gorilla: pick the lock as it steps
 * off the lane top, and run west along z 2798 while it stands at z 2800+.
 */
const YARD_ESCAPE: ReadonlyArray<{ x: number; z: number; tol: number }> = [
    { ...LANE_TOP, tol: 1 }, { x: 2770, z: 2798, tol: 0 }, { x: 2765, z: 2798, tol: 0 }, { x: 2765, z: 2794, tol: 1 },
];

/** In the jail yard outside the cell: the lane and the patrol's corridor. */
export function inYard(src: StateLike): boolean {
    const p = pos(src);
    return p.level === 0 && !inCell(src) && p.x >= 2766 && p.x <= 2773 && p.z >= 2796 && p.z <= 2802;
}

const gorillas = (s: BotWorldState) => new Map(s.nearbyNpcs.filter(n => PATROL.test(n.name)).map(n => [n.name, `${n.tileX ?? n.x},${n.tileZ ?? n.z}`]));

/** Between two states, a patrol gorilla stepped off the lane top westward: the start of the yard's one clear window. */
export function patrolLeavesLane(prev: BotWorldState, cur: BotWorldState): boolean {
    const a = gorillas(prev), b = gorillas(cur);
    for (const [name, at] of b) if (at === `${LANE_TOP.x - 1},${LANE_TOP.z}` && a.get(name) === `${LANE_TOP.x},${LANE_TOP.z}`) return true;
    return false;
}

/**
 * Out of the cell and the jail yard (mm_jail.rs2:1-11: the lock is a Thieving
 * roll of 95/295, 82% a try at level 57). Waits for the patrol's handover,
 * picks at most twice inside it, and runs YARD_ESCAPE; a knockout on the way
 * just puts the player back in the cell for the next handover.
 */
export async function leaveCell(sdk: Sdk): Promise<{ picks: number; waited: number }> {
    const t0 = currentTick(sdk);
    let picks = 0, waited = 0;
    while (inCell(sdk) || inYard(sdk)) {
        if (currentTick(sdk) - t0 > 500) throw new Error(`still in the jail after ${picks} lock picks (at ${where(sdk)})`);
        if (inCell(sdk)) {
            await dismiss(sdk);
            const w0 = currentTick(sdk);
            let prev = sdk.getState()!;
            const r = await waitUntil(sdk, s => {
                const hit = patrolLeavesLane(prev, s) || !inCell(s);
                prev = s;
                return hit;
            }, { maxTicks: 160 });
            waited += currentTick(sdk) - w0;
            if (!r.ok) continue;
            for (let k = 0; k < 2 && inCell(sdk); k++) {
                const door = await findLoc(sdk, { ...CELL_DOOR, op: /pick/i, radius: 10 });
                if (!door) break;
                const sent = currentTick(sdk);
                picks++;
                await opLoc(sdk, door, /pick/i);
                await waitUntil(sdk, s => !inCell(s) || messagesSince(s, sent, /fail to pick/i).length > 0, { maxTicks: 8 });
            }
            // A pick that outran the wait above still opens the door: standing outside it is the one fatal place.
            if (inCell(sdk)) await waitUntil(sdk, s => !inCell(s), { maxTicks: 6 });
            if (inCell(sdk)) continue;
        }
        for (const w of YARD_ESCAPE) {
            let jailed: boolean;
            try {
                jailed = !(await click(sdk, w, w.tol));
            } catch (e) {
                // A knockout mid-walk lands in the cell: the escape starts again from the door.
                if (!inCell(sdk)) throw new Error(`the yard walk to ${w.x},${w.z} stopped at ${where(sdk)}: ${e instanceof Error ? e.message : e}`);
                jailed = true;
            }
            if (jailed) break;
        }
    }
    return { picks, waited };
}

/**
 * Walk the ravine towards the west gate until a ravine archer knocks the
 * player out (1 in 20 shots, mm_archer.rs2:51-53) and the jail cell holds them.
 * The archers (Ranged 110) hit a Defence 1 player almost every shot, about
 * 20 shots per knockout, which kills at 42 HP, so the walk prays Protect from
 * Missiles: it zeroes their damage (npc_combat_ranged.rs2:49-51) while the
 * knockout roll, made before the hit roll, still lands.
 */
async function knockout(ctx: Ctx): Promise<void> {
    await praying(ctx.sdk, 'protect_from_missiles', () => ravine(ctx));
}

/** Run `fn` with `prayer` on, and turn it off after unless it was already on (calls nest). */
async function praying<T>(sdk: Sdk, prayer: PrayerName, fn: () => Promise<T>): Promise<T> {
    const s = sdk.getState();
    if (s && prayerActive(s, prayer)) return fn();
    const r = await setPrayer(sdk, prayer, true);
    if (!r.ok) throw new Error(`${prayer} did not turn on: ${r.reason}`);
    try {
        return await fn();
    } finally {
        await setPrayer(sdk, prayer, false);
    }
}

async function ravine(ctx: Ctx): Promise<void> {
    const { sdk } = ctx;
    for (let leg = 0; leg < 6 && !inCell(sdk); leg++) {
        const to = leg % 2 === 0 ? RAVINE_END : LANDING;
        let walked = false;
        const w = ctx.bot.walkTo(to.x, to.z, 1).finally(() => (walked = true));
        const r = await waitUntil(sdk, s => inCell(s) || walked, { maxTicks: 600 });
        if (inCell(sdk)) {
            // The walk gives up once there is no route from the cell; let it, so it sends nothing more.
            await Promise.race([w, waitTicks(sdk, 20)]);
            return;
        }
        if (!r.ok) break;
    }
    if (!inCell(sdk)) throw new Error(`not knocked out in the ravine (at ${where(sdk)})`);
}

/**
 * Run a town errand again whenever it fails because the player was knocked
 * out into the cell (archers, guards and the patrol all can, mid-search or
 * mid-talk). The errand must skip what is already done; up to `tries` runs.
 */
async function jailSafe<T>(sdk: Sdk, fn: () => Promise<T>, tries = 4): Promise<T> {
    for (let i = 1; ; i++) {
        try {
            return await fn();
        } catch (e) {
            // The knockout's fade takes a few ticks before the teleport into the cell.
            const jailed = inCell(sdk) || (await waitUntil(sdk, inCell, { maxTicks: 12 })).ok;
            if (!jailed || i >= tries) throw e;
        }
    }
}

/** From anywhere on the atoll's surface into the town as a human: knocked out if outside it, then out of the cell. */
export async function toTown(ctx: Ctx): Promise<void> {
    if (!inCell(ctx.sdk) && outsideTown(ctx.sdk)) await knockout(ctx);
    if (inCell(ctx.sdk)) await leaveCell(ctx.sdk);
    if (outsideTown(ctx.sdk) || !inArea(ctx.sdk, AREAS.atoll)) throw new Error(`not in the town (at ${where(ctx.sdk)})`);
}

/** Waypoints walked before a town destination, when the player starts within `within` tiles of the first. */
interface Via {
    points: ReadonlyArray<{ x: number; z: number }>;
    within: number;
}

/**
 * Walk in the town as a human. Guards and the jail patrol can knock the
 * player out on the way; then it leaves the cell and walks again. `via`
 * points within 12 tiles are walk clicks (the client's own router); farther
 * ones are walked with the pathfinder.
 */
const PROTECTS: readonly PrayerName[] = ['protect_from_melee', 'protect_from_missiles'];

/**
 * Walk in the town as a human under the zone prayer: each leg split into prayerRuns along its own tiles (the
 * pathfinder's route, for a walk and a via click alike). Guards and the jail patrol can knock the player out
 * on the way; then it leaves the cell and walks again. With `keep` the last run's prayer stays on, for a caller that
 * stands or walks on in the same zone; otherwise every protect prayer goes off at the end.
 */
async function townGo(ctx: Ctx, to: { x: number; z: number }, tol = 0, via: Via | readonly Via[] = [], o: { keep?: boolean; click?: boolean } = {}): Promise<void> {
    const { sdk } = ctx;
    try {
        await townGoZoned(ctx, to, tol, via, !!o.click);
    } finally {
        if (!o.keep) for (const p of PROTECTS) if (prayerActive(sdk.getState()!, p)) await setPrayer(sdk, p, false);
    }
}

/** Turn `prayer` on while standing, before a run's first click; each switch is noted with its tile (rs/158's toggle count). */
async function zonePrayer(sdk: Sdk, prayer: ZonePrayer, to: { x: number; z: number }): Promise<void> {
    if (prayerActive(sdk.getState()!, prayer)) return;
    const p = pos(sdk);
    const r = await setPrayer(sdk, prayer, true);
    if (!r.ok) throw new Error(`${prayer} did not turn on: ${r.reason}`);
    stepNote(`S15 zone prayer: ${prayer} at ${p.x},${p.z},${p.level} for the run to ${to.x},${to.z}`);
}

/** The zone prayer for one unsplit leg from here to `to` (legPrayerFor), set while standing. */
async function legPrayer(sdk: Sdk, to: { x: number; z: number }): Promise<void> {
    const p = pos(sdk);
    await zonePrayer(sdk, legPrayerFor(p, to, p.level), to);
}

/** Stand under the zone prayer of the player's own tile (a wait, a talk, a search). */
async function standPrayer(sdk: Sdk): Promise<void> {
    const p = pos(sdk);
    await zonePrayer(sdk, tilePrayer(p, p.level), p);
}

/** The pathfinder's route to `to` as points to walk through, ending on `to`; the straight line when it finds none. */
function routeTo(sdk: Sdk, to: { x: number; z: number }): Array<{ x: number; z: number }> {
    const r = sdk.findPath(to.x, to.z, 500);
    const pts = r.success ? r.waypoints.map(w => ({ x: w.x, z: w.z })) : [];
    const last = pts[pts.length - 1];
    if (!last || last.x !== to.x || last.z !== to.z) pts.push({ x: to.x, z: to.z });
    return pts;
}

/**
 * One leg to `to`, by a walk click (a via point within 12) or the pathfinder's walk, run by run under the zone prayer.
 * False when a knockout put the player in the cell on the way.
 */
async function zoneLeg(ctx: Ctx, to: { x: number; z: number }, tol: number, how: 'click' | 'walk'): Promise<boolean> {
    const { sdk } = ctx;
    // A human's walk whose route crosses the Sleeping Monkey's zone goes by a corner of the crate building first.
    for (let k = 0; k < 2 && how === 'walk' && pos(sdk).level === 0 && !wearing(sdk.getState()!, MM_OBJ.greegree); k++) {
        const here = pos(sdk);
        if (!entersSleepingZone(here, routeTo(sdk, to))) break;
        const d = sleepingDetour(here, to, p => routeTo(sdk, p));
        stepNote(`S15 walk to ${to.x},${to.z} from ${here.x},${here.z} crosses the Sleeping Monkey's zone: ${d ? `by ${d.x},${d.z} first` : 'no detour keeps out of it'}`);
        if (!d) break;
        if (!(await zoneLeg(ctx, d, 1, 'walk'))) return false;
    }
    const from = pos(sdk);
    // A click is routed by the server over the same collision as the pathfinder, so both plan on its route: a straight
    // line misses a click's bends (J's old first via, walled to the south, routed round through an archer's reach).
    const runs = prayerRuns(from, routeTo(sdk, to), from.level);
    for (const [i, run] of runs.entries()) {
        const last = i === runs.length - 1;
        await zonePrayer(sdk, run.prayer, run.to);
        const goal = last ? to : run.to;
        if (how === 'click') {
            if (!(await click(sdk, goal, last ? tol : 1))) return false;
            continue;
        }
        const r = await walkTo(ctx.bot, sdk, goal.x, goal.z, last ? tol : 1);
        if (inCell(sdk)) return false;
        if (!r.ok) throw new Error(`walk to ${goal.x},${goal.z} failed at ${where(sdk)}: ${r.message}`);
    }
    return !inCell(sdk);
}

/** `clickLast`: the final leg is a walk click when within 12 (no SDK walk left running behind it). */
async function townGoZoned(ctx: Ctx, to: { x: number; z: number }, tol: number, vias: Via | readonly Via[], clickLast = false): Promise<void> {
    const { sdk } = ctx;
    const options = Array.isArray(vias) ? (vias as readonly Via[]) : [vias as Via];
    for (let attempt = 0; attempt < 4; attempt++) {
        if (inCell(sdk)) await leaveCell(sdk);
        let clear = true;
        const via = options.find(v => v.points.length && chebyshev(pos(sdk), v.points[0]!) <= v.within);
        if (via) {
            for (const v of via.points) {
                clear = await zoneLeg(ctx, v, 1, chebyshev(pos(sdk), v) <= 12 ? 'click' : 'walk');
                if (!clear) break;
            }
        }
        if (!clear) continue;
        if (await zoneLeg(ctx, to, tol, clickLast && chebyshev(pos(sdk), to) <= 12 ? 'click' : 'walk')) return;
    }
    throw new Error(`knocked out on every attempt to reach ${to.x},${to.z}`);
}

/** The click for an op on the loc at `at`, found once. */
async function locClick(sdk: Sdk, at: { x: number; z: number }, op: RegExp): Promise<() => Promise<unknown>> {
    const loc = await findLoc(sdk, { ...at, op, radius: 15 });
    if (!loc) throw new Error(`no loc with ${op} at ${at.x},${at.z} (at ${where(sdk)})`);
    const o = loc.optionsWithIndex.find(x => op.test(x.text))!.opIndex;
    return () => sdk.sendInteractLoc(loc.x, loc.z, loc.id, o);
}

/** Search a crate and answer its yes/no page; done when `got` holds. */
/**
 * Search a crate and take what it offers. Any hit on the player, even a
 * 0-damage one from the atoll's wildlife or archers, closes the crate's chat
 * before the choice, so the search is repeated until `got` holds; a knockout
 * into the cell ends it (the caller's jailSafe takes over).
 */
async function searchCrate(sdk: Sdk, at: { x: number; z: number }, yes: RegExp, got: Pred, label: string, shape: string, note: (line: string) => void = () => {}): Promise<void> {
    let reason = '';
    for (let i = 0; i < 6 && !inCell(sdk); i++) {
        // The crate's inv_add gives nothing into a full pack (quest_mm.rs2:924-942). H12 fills it (rs/158, 07:0x), and J and
        // K eat 4-6 sharks anyway, so one is eaten for room now; above 22 HP part of its 20 is overheal (noted, for the price).
        if (freeSlots(sdk.getState()!) === 0 && !got(sdk.getState()!)) {
            const hp = sdk.getState()!.player?.hp ?? 0;
            const n = invCount(sdk, MM_OBJ.shark);
            const e = n > 0 ? await invOp(sdk, MM_OBJ.shark, /^eat$/i, s => invCount(s, MM_OBJ.shark) < n, { maxTicks: 6 }) : null;
            note(`S15 ${label}: ate for room at HP ${hp} (overheal ${Math.max(0, hp + 20 - (sdk.getState()!.player?.maxHp ?? 42))})${e?.ok ? '' : ', the eat did not land'}`);
        }
        // The crate's script waits p_delay(2) before its choice (quest_mm.rs2:904-969), inside act's 5-tick re-send:
        // the click-to-dialogue ticks are noted for the shared re-send race (rs/309).
        const r = await actConverse(sdk, await locClick(sdk, at, /search/i), [yes], { done: got, maxTicks: 25, idle: 3, resendEvery: 5, ...shaped(shape) });
        note(`S15 ${label}: dialogue at click+${r.dialogue && r.dialogue.firstTick >= 0 ? r.dialogue.firstTick - r.startTick : 'none'}, resends ${r.resends}`);
        noteShape(label, r.dialogue);
        if (r.ok || got(sdk.getState()!)) return;
        reason = r.reason ?? '';
    }
    throw new Error(`${label}: ${reason} (at ${where(sdk)})`);
}

/** Use an inventory item on the NPC and answer what it says; done when `effect` holds. */
async function useOnNpc(sdk: Sdk, item: number, npcName: RegExp, effect: Pred, shape: string, idle = 3): Promise<void> {
    const npc = await waitForNpc(sdk, npcName, 10);
    if (!npc) throw new Error(`no ${npcName} near ${where(sdk)}`);
    const r = await actConverse(sdk, () => sdk.sendUseItemOnNpc(slotOf(sdk, item), npc.index), [], { done: effect, maxTicks: 60, idle, resendEvery: 5, ...shaped(shape) });
    noteShape(`use ${item} on ${npc.name}`, r.dialogue);
    if (!r.ok) throw new Error(`use ${item} on ${npc.name}: ${r.reason}`);
}

/** Talk to an NPC through a scripted conversation; throws on a choice the list does not answer, or when fewer than `minPages` pages were seen. */
async function talk(sdk: Sdk, npc: RegExp, choices: RegExp[], o: { shape: string; near?: { x: number; z: number }; minPages?: number; idle?: number }): Promise<void> {
    await topUp(sdk);
    const r = await talkTo(sdk, npc, choices, { maxTicks: 900, idle: o.idle ?? 3, ...(o.near ? { near: o.near } : {}), ...shaped(o.shape) });
    noteShape(`talk ${npc.source}`, r);
    if (!r.ok || !r.opened) throw new Error(`talk to ${npc}: ${r.reason ?? 'no dialogue'}`);
    if (r.pages < (o.minPages ?? 0)) throw new Error(`talk to ${npc}: ${r.pages} pages, expected at least ${o.minPages}: ${r.transcript.slice(-3).join(' / ')}`);
}

/** In the dungeon under the temple (mapsquare 43_143, z 9152+). */
export const underTemple = (src: StateLike) => {
    const p = pos(src);
    return p.z >= 9180 && p.x >= 2752 && p.x <= 2815;
};

/**
 * The fire under the temple nearest the player (mm_iban_firewall_straight/diagonal, quest_mm.rs2 opu_mm_firewall). Looked
 * up on the trapdoor's landing frame, so through findLoc, which waits out the browser client's region rebuild.
 */
export async function nearestFire(sdk: Sdk): Promise<{ x: number; z: number; id: number }> {
    const f = await findLoc(sdk, { name: /^Wall of flame$/i, radius: 15 });
    if (!f) throw new Error(`no fire under the temple near ${where(sdk)}`);
    return { x: f.x, z: f.z, id: f.id };
}

/**
 * Down the temple trapdoor. 'ladder': up the south ladder, along floor 1,
 * down the east ladder onto the access tile (33-36 ticks, 4 of 4, rs/59).
 * 'wait', and the ladder's fallback when the drop does not land on the
 * access tile: walk onto it whenever the guards leave it free. Then open the
 * trapdoor and climb down, clicking every 3 ticks.
 */
async function trapdoor(ctx: Ctx, method: 'ladder' | 'wait'): Promise<{ method: 'ladder' | 'wait' }> {
    const { sdk } = ctx;
    let used = method;
    if (method === 'ladder' && !(pos(sdk).level === 0 && chebyshev(pos(sdk), TRAPDOOR_ACCESS) === 0)) {
        if (pos(sdk).level === 0) await climb(sdk, TEMPLE_LADDER);
        await go(ctx, TEMPLE_DROP_TOP, 0);
        await climb(sdk, TEMPLE_DROP_LADDER);
        if (!(pos(sdk).level === 0 && chebyshev(pos(sdk), TRAPDOOR_ACCESS) === 0)) used = 'wait';
    }
    let sent = -10;
    const r = await waitUntil(sdk, s => {
        if (underTemple(s)) return true;
        if (s.tick - sent < 3) return false;
        sent = s.tick;
        const p = pos(s);
        if (p.level !== 0 || p.x !== TRAPDOOR_ACCESS.x || p.z !== TRAPDOOR_ACCESS.z) {
            void sdk.sendWalk(TRAPDOOR_ACCESS.x, TRAPDOOR_ACCESS.z, true);
            return false;
        }
        // Closed: Open; open: Climb-down. Both are op1 (mm_temple.rs2), and the loc id changes between them.
        const l = s.nearbyLocs.find(x => x.x === TRAPDOOR.x && x.z === TRAPDOOR.z && /trapdoor/i.test(x.name));
        if (l) void sdk.sendInteractLoc(l.x, l.z, l.id, l.optionsWithIndex[0]?.opIndex ?? 1);
        else void sdk.scanNearbyLocs(3).then(ls => {
            const t = ls.find(x => x.x === TRAPDOOR.x && x.z === TRAPDOOR.z);
            if (t) void sdk.sendInteractLoc(t.x, t.z, t.id, t.optionsWithIndex[0]?.opIndex ?? 1);
        });
        return false;
    }, { maxTicks: used === 'ladder' ? 40 : 200 });
    if (!r.ok) throw new Error(`not down the temple trapdoor by '${used}' (at ${where(sdk)})`);
    return { method: used };
}

/**
 * Away from the trapdoor guards after the temple rope, which lands within 2
 * of the trapdoor (mm_temple.rs2). On its access tile (2806,2785), walled on
 * three sides with the guards boxing the fourth, a walk out sticks while they
 * hit (measured: stuck 50 ticks, 2 sharks), and from (2807,2786) the walk
 * west stuck for 850 ticks: the guards' 2x2 bodies close every gap in turn,
 * and NPCs are not in the pathfinder's collision. The way out is the ladder
 * drop reversed: the ground-floor ladder at (2805,2785) is inside the box
 * and next to most landing tiles, so it is clicked every 3 ticks until a
 * gap lets the player reach it; then across floor 1 and down the south
 * ladder to (2794,2774).
 */
/**
 * The clicks out of the trapdoor guards' box, for up to `maxTicks`: ok once
 * on floor 1 (the ladder) or 4+ tiles from the trapdoor (a walk west). The
 * access tile (for the ladder) is reachable from most landings only in the
 * first ticks, before the guards close in to attack and hold their tiles
 * (measured: 14 of 19 landings reached it in 6-12 ticks,
 * lab/measure-mm-rope.ts). So the ladder first, three sends; then a walk west
 * (the south landings' way) alternating with the ladder. The caller prays.
 */
export async function templeEscape(sdk: Sdk, maxTicks: number): Promise<{ ok: boolean; ticks: number; via?: 'ladder' | 'walk' }> {
    const t0 = currentTick(sdk);
    const ladder = await findLoc(sdk, { ...TEMPLE_DROP_LADDER, op: /climb/i, radius: 5 });
    if (!ladder) throw new Error(`no ladder at the trapdoor (at ${where(sdk)})`);
    const op = ladder.optionsWithIndex.find(o => /climb/i.test(o.text))!.opIndex;
    const clear = (s: BotWorldState) => pos(s).level === 0 && chebyshev(pos(s), TRAPDOOR) >= 4;
    let sent = -10, sends = 0;
    const r = await waitUntil(sdk, s => {
        if (pos(s).level === 1 || clear(s)) return true;
        if (s.tick - sent >= 3) {
            sent = s.tick;
            const onAccess = chebyshev(pos(s), TRAPDOOR_ACCESS) === 0;
            sends++;
            if (onAccess || sends <= 3 || sends % 2 === 0) void sdk.sendInteractLoc(ladder.x, ladder.z, ladder.id, op);
            else void sdk.sendWalk(TEMPLE_CLEAR.x, TEMPLE_CLEAR.z, true);
        }
        return false;
    }, { maxTicks });
    const ticks = currentTick(sdk) - t0;
    if (!r.ok) return { ok: false, ticks };
    return { ok: true, ticks, via: pos(sdk).level === 1 ? 'ladder' : 'walk' };
}

/**
 * Up the temple rope from one of its open sides, standing exactly on it: a walk click onto the side, then the climb.
 * "I can't reach that!" (or no climb in 12 ticks) moves on to the next side. The landing up top is the server's random
 * tile 1-2 from the trapdoor (mm_temple.rs2 oploc1: map_findsquare), so no approach here changes the pin odds.
 */
async function ropeUp(sdk: Sdk): Promise<void> {
    for (let i = 0; i < 2 * TEMPLE_ROPE_SIDES.length && underTemple(sdk); i++) {
        const side = TEMPLE_ROPE_SIDES[i % TEMPLE_ROPE_SIDES.length]!;
        await act(sdk, () => sdk.sendWalk(side.x, side.z, true), s => chebyshev(pos(s), side) === 0 || !underTemple(s), { resendEvery: 3, maxTicks: 9 });
        if (chebyshev(pos(sdk), side) !== 0) {
            stepNote(`S15:N rope: could not stand on ${side.x},${side.z} (at ${where(sdk)})`);
            continue;
        }
        const rope = await findLoc(sdk, { ...TEMPLE_ROPE, op: /climb/i, radius: 5 });
        if (!rope) throw new Error(`no climbing rope at ${TEMPLE_ROPE.x},${TEMPLE_ROPE.z} (at ${where(sdk)})`);
        const op = rope.optionsWithIndex.find(o => /climb/i.test(o.text))!.opIndex;
        const t0 = currentTick(sdk);
        await act(sdk, () => sdk.sendInteractLoc(rope.x, rope.z, rope.id, op), s => !underTemple(s) || messagesSince(s, t0, /can't reach/i).length > 0, { resendEvery: 4, maxTicks: 12 });
        if (underTemple(sdk)) stepNote(`S15:N rope: no climb from ${side.x},${side.z}; ${messagesSince(sdk.getState()!, t0, /can't reach/i).length ? "I can't reach that!" : 'no answer'}`);
    }
    if (underTemple(sdk)) throw new Error(`the temple rope did not take the player up from any side (at ${where(sdk)})`);
}

/** The bounded wait on a temple-rope pin before the teleport out: the only pin that freed itself did so at 49 ticks. */
export const PIN_WAIT = 50;

/**
 * Out of the trapdoor guards' box after the temple rope. `escaped`: pinned past PIN_WAIT and teleported to Varrock
 * (H12's spare Varrock set); the caller's next step is wayBack. Measured (lab/measure-mm-pin.ts): a pin that lasts this
 * long held 400+ ticks in 2 of 3; a relog is refused in combat (3 of 3); the Varrock teleport lands in 4 ticks (3 of 3).
 */
async function templeOut(ctx: Ctx): Promise<{ pinned: number; escaped: boolean }> {
    const { sdk } = ctx;
    const p = pos(sdk);
    if (p.level !== 0 || chebyshev(p, TRAPDOOR) > 3) return { pinned: 0, escaped: false };
    return praying(sdk, 'protect_from_melee', async () => {
        const r = await templeEscape(sdk, PIN_WAIT);
        if (!r.ok) {
            const t = await teleport(sdk, 'varrock');
            if (!t.ok) throw new Error(`pinned by the trapdoor guards for ${r.ticks} ticks, and the Varrock teleport failed: ${t.reason} (at ${where(sdk)})`);
            stepNote(`S15 temple pin: held ${r.ticks} ticks, then the Varrock teleport in ${t.ticks}`);
            return { pinned: r.ticks, escaped: true };
        }
        const pinned = r.ticks;
        if (pos(sdk).level === 1) {
            await go(ctx, TEMPLE_LADDER_FOOT, 0);
            await climb(sdk, TEMPLE_LADDER);
        }
        return { pinned, escaped: false };
    });
}

/** Take a worn item off (its Remove op); done when it is no longer worn. */
async function unwear(sdk: Sdk, id: number): Promise<void> {
    const w = sdk.getState()!.equipment.find(i => i.id === id);
    if (!w) return;
    const op = w.optionsWithIndex.find(o => /^remove$/i.test(o.text))?.opIndex ?? 1;
    const r = await act(sdk, () => sdk.sendUseEquipmentItem(w.slot, op), s => !s.equipment.some(i => i.id === id), { resendEvery: 3, maxTicks: 12 });
    if (!r.ok) throw new Error(`${w.name} did not come off: ${r.reason}`);
}

const wearing = (s: BotWorldState, id: number) => s.equipment.some(i => i.id === id);

/**
 * Hold the Karamja gree-gree. It goes on only inside the gree-gree zone (the atoll, its dungeon, the zoo) and not
 * within 10 ticks of combat (mm_greegree.rs2:1-10), so a refused hold is retried after a short wait.
 */
async function asMonkey(sdk: Sdk): Promise<void> {
    for (let i = 0; i < 4 && !wearing(sdk.getState()!, MM_OBJ.greegree); i++) {
        if (i > 0) await waitTicks(sdk, 5);
        await dismiss(sdk);
        await wield(sdk, MM_OBJ.greegree, { maxTicks: 6 });
    }
    if (!wearing(sdk.getState()!, MM_OBJ.greegree)) throw new Error(`the gree-gree did not go on (at ${where(sdk)}): ${sdk.getState()!.gameMessages.slice(-2).map(m => m.text).join(' | ')}`);
}

/**
 * A chapter cutscene (3 on level 0, 4 on level 1), already queued: the teleport into mapsquare 41_71, its pages
 * and fades, and the teleport back to the tile it was queued from (%mm_cutscene_coord), then the chapter card.
 */
async function chapterCutscene(sdk: Sdk, level: 0 | 1, label: string, shape: string): Promise<number> {
    const zone: Area = { ...CUTSCENE_ZONE, level };
    let entered = inArea(sdk, zone);
    const r = await converse(sdk, [], {
        idle: 6, openTicks: 40, maxTicks: 400, unmatched: 'stop', closeModals: true, ...shaped(shape),
        until: s => {
            if (tileIn(pos(s), zone)) entered = true;
            return entered && !tileIn(pos(s), zone);
        },
    });
    noteShape(`the ${label} cutscene`, r);
    if (!entered || inArea(sdk, zone)) throw new Error(`the ${label} cutscene did not finish: ${r.reason ?? `${r.pages} pages`} (at ${where(sdk)})`);
    // The chapter card can open just after the teleport back.
    const card = await waitUntil(sdk, s => s.modalOpen, { maxTicks: 4 });
    if (card.ok) await sdk.sendCloseModal();
    await dismiss(sdk);
    return r.pages;
}

/** As a monkey from the ravine side through the west gate into the town (the gate moves the player 3 tiles north). */
async function throughWestGate(ctx: Ctx): Promise<void> {
    const { sdk } = ctx;
    await go(ctx, WEST_GATE_SOUTH, 1);
    const r = await actConverse(sdk, await locClick(sdk, WEST_GATE, /^open$/i), [], { done: s => pos(s).z >= WEST_GATE.z + 2, maxTicks: 20, idle: 1, resendEvery: 5 });
    if (!r.ok && pos(sdk).z < WEST_GATE.z + 2) throw new Error(`the west gate did not let the monkey through: ${r.reason} (at ${where(sdk)})`);
}

const CHATTER = { interrupts: [MONKEY_CHATTER] } as const;

// ------------------------------------------------------------------ the gnome half (A-G)

/** Daero's blindfold before reinitialisation lands in the unpowered hangar (mm_daero.rs2:234: 0_37_154_25_36). */
export const OLD_HANGAR = { x0: 2368, z0: 9856, x1: 2431, z1: 9919, level: 0 } as const;
/** The powered hangar's arrival after the hangar cutscene (quest-mm-full.ts E3). */
const POWERED = { x: 2649, z: 4507 };
/** Daero in the powered hangar (quest-mm-full.ts F1). */
const DAERO_HANGAR = { x: 2648, z: 4512 };
/** Karamja's shipyard: the west gate the worker opens for the seal, and Caranock (quest-mm-full.ts B5-B8). */
const SHIPYARD_GATE = { x: 2945, z: 3041 };
const SHIPYARD_GATE_FOOT = { x: 2943, z: 3041 };
const CARANOCK = { x: 2956, z: 3024 };
/** Inside the shipyard's fence, east of its west gate (the glider's landing, (2971,2969), is south of it). */
const inShipyard = (src: StateLike) => {
    const p = pos(src);
    return p.level === 0 && p.x >= SHIPYARD_GATE.x && p.x <= 3000 && p.z >= 3000 && p.z <= 3070;
};
/** The Gandius glider's pilot, near its landing (GLIDERS.gandius in travel.ts). */
const GANDIUS_PILOT = { x: 2970, z: 2974 };
const NARNODE_NPC = /^King Narnode( Shareen)?$/i;

/**
 * One line of H12's kit: at least `n` held or worn of items whose name matches (or, for the bow, whose id is `id`).
 * `consumed`: eaten, drunk or cast on the route, so once H12 is served the line counts as delivered.
 */
interface KitLine { name: RegExp; n: number; id?: number; consumed?: true }

/** The kit's super antipoison at any dose: one drunk for a cure is still the kit's super. */
const KIT_SUPER = /^Superantipoison\(\d\)$/;

/**
 * H12's food (rs/158, 10-22 07:0x): the measured A-Z demand is 14-15 sharks and about 13 prayer doses (three chains);
 * 15 sharks is what fits, with the 12 other kit slots and the seal or the orders held A-D, and the +1 margin is an
 * acceptance check (a shark left at the end) instead of a carried shark.
 */
export const H12_SHARKS = 15;
export const H12_POTIONS = 4;

/**
 * H12 (STEP-MANIFEST.md H12 row): the quest's ingredients, the bow and 200 rune arrows (worn from the swap on), 4 prayer
 * potions, a super antipoison, Ardougne and two Varrock casts, and sharks topped up to 15. The potion lines count by
 * potion at any dose (main, attempt 4): SCORED poisoned on the way in drinks a cure from the kit's only super.
 */
export function h12Kit(bow: number): KitLine[] {
    return [
        // No bananas: O searches them from the trees in the aunt's house (BANANA_TREES).
        { name: /^Gold bar$/, n: 1 }, { name: /^Ball of wool$/, n: 1 }, { name: /^Monkey bones$/, n: 1 },
        { name: /bow$/i, n: 1, id: bow }, { name: /^Rune arrow$/, n: 200 },
        { name: /^Prayer potion\(\d\)$/, n: H12_POTIONS, consumed: true }, { name: KIT_SUPER, n: 1, consumed: true },
        // Ardougne 2 casts (2 law, 2 water each), Varrock 2 casts (1 law, 3 air, 1 fire each).
        { name: /^Law rune$/, n: 6, consumed: true }, { name: /^Air rune$/, n: 6, consumed: true }, { name: /^Fire rune$/, n: 2, consumed: true }, { name: /^Water rune$/, n: 4, consumed: true },
        { name: /^Shark$/, n: H12_SHARKS, consumed: true },
    ];
}

const carried = (s: BotWorldState, k: KitLine) =>
    [...s.inventory, ...s.equipment].filter(i => (k.id !== undefined ? i.id === k.id : k.name.test(i.name))).reduce((a, i) => a + i.count, 0);

/**
 * What H12 still lacks, held or worn: `[name, missing]`. With `served` (H12 recorded served this attempt) only the lines
 * the route does not consume are checked: the consumed ones were delivered, and eating or drinking since is the route's.
 */
export function kitMissing(s: BotWorldState, bow: number, o: { served?: boolean } = {}): Array<[RegExp, number]> {
    return h12Kit(bow).filter(k => !(o.served && k.consumed)).map(k => [k.name, k.n - carried(s, k)] as [RegExp, number]).filter(([, n]) => n > 0);
}

/** Whether the Grand Tree swap has anything to take: false once the kit is complete, held or worn (kitMissing). */
export function h12Wants(s: BotWorldState, o: { bow: number; served?: boolean }): boolean {
    return kitMissing(s, o.bow, o).length > 0;
}

const kitText = (lines: Array<[RegExp, number]>) => lines.map(([n, k]) => `${k} ${n.source}`).join(', ');

/**
 * What SCORED hands back in the Grand Tree swap: the ledger's H12 row outs (STEP-MANIFEST.md, inventory ledger, H12),
 * all seven: S14's staff of fire, H7's antipoison (any dose left; the anchor keeps Superantipoison(1) and (4), H12's
 * own, out), the mithril scimitar, the knife, and all the coins, death runes and chaos runes. Holding any of them
 * through the swap leaves SCORED over 28 slots, and the game closes a both-accepted trade that does not fit.
 */
export const GT_HANDBACK: readonly RegExp[] = [/^Staff of fire$/i, /^Antipoison\(\d\)$/i, /^Mithril scimitar$/i, /^Knife$/i, /^Coins$/i, /^Death rune$/i, /^Chaos rune$/i];

/**
 * The Grand Tree swap's plan from the state: give back the GT_HANDBACK items held, want what H12 still lacks (kitMissing
 * as amounts). No want means no trade: the kit was already placed (run.ts's H12 hand-off at the tree door).
 */
export function h12Plan(s: BotWorldState, o: { bow: number; served?: boolean }): { give: GiveSpec[]; want: WantSpec[] } {
    return {
        give: GT_HANDBACK.filter(p => s.inventory.some(i => p.test(i.name))).map(item => ({ item })),
        want: kitMissing(s, o.bow, o).map(([item, amount]) => ({ item, amount })),
    };
}

/**
 * A's cure before the Grand Tree swap sizes the kit (rs/185's order: the eat, this cure, then the sizing and the trading
 * hold). A poison carried in from S14 is cured from the antipoison held, H7's (it leaves in the swap anyway, GT_HANDBACK),
 * before the trade opens: a poison tick runs if_close (poison.rs2:36), which would close it. An emptied dose's Vial is
 * dropped before returning: GT_HANDBACK takes none and A's pack is the kit's 27, read by the sizing next. Waits on the
 * inventory for both. A runs under upkeep, which cures on its own state too and can win the race while A's eat lands: a
 * dose noted in the last DRINK_RESEND_TICKS is waited out before the vial check, so its vial is not left for the sizing.
 * With nothing held it drinks nothing; preDose cures after the swap.
 */
export async function cureBeforeSwap(sdk: Sdk): Promise<void> {
    const cure = await curePoison(sdk, 'S15:A before the swap');
    if (cure === 'cured') stepNote(`S15 antipoison: cured before the Grand Tree swap, t=${antipoisonDrunkAt()}`);
    const sent = antipoisonDrunkAt();
    const since = currentTick(sdk) - sent;
    if (cure !== 'cured' && since >= 0 && since < DRINK_RESEND_TICKS) await waitUntil(sdk, s => s.tick - sent >= DRINK_RESEND_TICKS, { maxTicks: DRINK_RESEND_TICKS });
    const vial = () => sdk.getState()!.inventory.find(i => /^Vial$/i.test(i.name));
    for (let i = 0; i < 4 && vial(); i++) {
        if (!packClickAllowed(sdk.getState()!)) await waitUntil(sdk, packClickAllowed, { maxTicks: 10 });
        const v = vial()!;
        void sdk.sendDropItem(v.slot);
        await waitUntil(sdk, s => !s.inventory.some(x => x.slot === v.slot && /^Vial$/i.test(x.name)), { maxTicks: 3 });
    }
    if (vial()) throw new Error(`an empty vial was not dropped before the Grand Tree swap (at ${where(sdk)})`);
}

/**
 * The Grand Tree hand-off before A: one swap() with the giver (lib/trade.ts) by h12Plan, only when H12 is short; then
 * the bow is wielded and the arrows quivered, which they stay until the gree-gree at R. Once H12 is served this attempt
 * (`kitServed`) it trades nothing: the lines the route keeps are checked, and the wield follows.
 *
 * A runs under upkeep, which eats whenever no trade is open. A shark eaten after the want (and the giver's top-up ask) is
 * sized leaves the kit short of 15 with the swap reported done: attempt 4 held 3, asked and was served 12, and one was
 * eaten inside A before the check (arrival at ~1 HP, poisoned). So upkeep's eat lands first, and upkeep is held from the
 * want's read to the kit's check. The ask must be sized after that eat too: chain.ts askedOnTrade, on the open frame.
 * A poison is cured first (cureBeforeSwap), after upkeep's eat and before the want's read.
 */
export async function gtSwap(ctx: Pick<Ctx, 'sdk'>, o: Pick<Resolved, 'bow' | 'kitFrom' | 'kitServed'>): Promise<void> {
    const { sdk } = ctx;
    if (o.kitServed?.()) {
        const short = kitMissing(sdk.getState()!, o.bow, { served: true });
        if (short.length) throw new Error(`H12 was served this attempt and the kit lacks ${kitText(short)}`);
    } else {
        await eatenUpTo(sdk, eating.below);
        await cureBeforeSwap(sdk);
        trading = true;
        try {
            const plan = h12Plan(sdk.getState()!, o);
            if (plan.want.length) {
                if (!o.kitFrom) throw new Error(`H12 kit short (${plan.want.map(w => `${w.amount} ${(w.item as RegExp).source}`).join(', ')}) and no kitFrom`);
                const r = await swap(sdk as never, o.kitFrom, plan.give, plan.want, { closeModals: true });
                if (!r.ok) throw new Error(`the Grand Tree swap with ${o.kitFrom} failed: ${r.reason ?? 'unknown'}`);
                const still = kitMissing(sdk.getState()!, o.bow);
                if (still.length) throw new Error(`after the swap the kit still lacks ${kitText(still)}`);
            }
        } finally {
            trading = false;
        }
    }
    for (const id of [o.bow, MM_OBJ.runeArrow]) {
        if (wearing(sdk.getState()!, id)) continue;
        const w = await wield(sdk, id, { maxTicks: 6 });
        if (!w.ok) throw new Error(`could not wear ${id} at the swap: ${w.reason}`);
    }
}

/** Narnode's menu option for a spare seal, offered once the quest is started and no seal is held (mm_narnode.rs2:152, :174). */
export const LOST_SEAL = /^I've lost my copy of the Royal Seal/;
/** The menu's way out, re-offered after the spare is given (mm_narnode.rs2:169-171, :175). */
const BACK_LATER = /^I'll be back later/;

/**
 * A's talk with Narnode for the royal seal: the quest's start ('Yes'); with the quest started and the seal lost, the
 * spare from his menu (`inv_add` with no room check, so a full pack is a named refusal), then out of the menu; nothing
 * with the seal held. The menu holds only before Caranock is asked (mm_narnode.rs2:145): later, A is past re-running.
 */
export function narnodeTalk(s: BotWorldState): { choices: RegExp[]; start: boolean } | null | string {
    if ((questStatus(s, 'mm') ?? 'not_started') === 'not_started') return { choices: [/^Yes$/], start: true };
    if (holds(s, MM_OBJ.royalSeal)) return null;
    if (freeSlots(s) < 1) return `S15:A needs 1 free slot for Narnode's spare seal (${freeSlots(s)} free)`;
    return { choices: [LOST_SEAL, BACK_LATER], start: false };
}

/** Glide from the pilot in reach (Ta Quir Priw on the tree's top floor, or Gandius) to `to` (travel.ts glide). */
async function glideTo(sdk: Sdk, to: 'gandius' | 'ta_quir_priw'): Promise<void> {
    const r = await glide(sdk, to);
    if (!r.ok) throw new Error(`the glider to ${to}: ${r.reason} (at ${where(sdk)})`);
}

/** Into the Grand Tree by its scripted door, and to `level` by the trunk ladder. */
async function intoTree(ctx: Ctx, level: number): Promise<void> {
    const { sdk } = ctx;
    if (!inGrandTree(sdk)) {
        const r = await runTo(sdk, { ...TREE_DOOR_OUTSIDE, tol: 1 }, { bot: ctx.bot });
        if (!r.ok) throw new Error(`run to the Grand Tree's door stopped at ${where(sdk)}: ${r.reason}`);
        const d = await opLoc(sdk, { ...TREE_DOOR, op: /^open$/i, radius: 6 }, /^open$/i, s => pos(s).z >= TREE_DOOR.z + 1, { resendEvery: 5, maxTicks: 20, ...CHATTER });
        if (!d.ok) throw new Error(`the Grand Tree's door did not let the player in (at ${where(sdk)})`);
    }
    for (let i = 0; i < 4 && pos(sdk).level !== level; i++) {
        const up = pos(sdk).level < level;
        if (chebyshev(pos(sdk), TREE_LADDER) > 3) await go(ctx, TREE_LADDER, 2);
        // The backpack monkey chatters whenever the player stands still (mm_zoo_monkey.rs2:108), and act() never re-sends
        // under an open page: measured, 2 of 3 runs stood 30 ticks at the ladder just inside the door.
        await climb(sdk, TREE_LADDER, up ? /^climb-up$/i : /^climb-down$/i, CHATTER);
    }
    if (pos(sdk).level !== level) throw new Error(`not on the Grand Tree's level ${level} (at ${where(sdk)})`);
}

/**
 * From the mainland (by `toDaero`, which ends beside Daero on the Grand Tree's first floor), the powered hangar or
 * Crash Island to Ape Atoll's landing: Daero's blindfold to the hangar (mm_daero.rs2 daero_return_hangar, any mm_main
 * once he has left the tree), Waydar's glider to Crash Island (mm_waydar.rs2:5-19, from mm_main arrived_atoll) and
 * Lumdo's boat (mm_lumdo.rs2, lumdo_travelled). By region, so a resume picks up the leg it stands in. None of the three
 * runs post_tele_checks, so a backpack monkey rides along (travel.ts DELETES_FOLLOWER_ITEM).
 */
async function hangarRoute(ctx: Ctx, toDaero: () => Promise<void>): Promise<void> {
    const { sdk } = ctx;
    // The backpack monkey's chatter page after a talk click no longer counts as the click's answer (rs/411's page rules
    // in lib/act, rs/481), so each hop is one talk.
    const hop = async (label: string, npc: RegExp, choices: RegExp[], arrived: (s: BotWorldState) => boolean, opts: Record<string, unknown>, shape: string) => {
        const r = await talkTo(sdk, npc, choices, { maxTicks: 120, ...opts, until: arrived, ...CHATTER, ...shaped(shape) });
        noteShape(`hop ${npc.source}`, r);
        if (!arrived(sdk.getState()!)) throw new Error(`${label}: ${r.reason ?? r.transcript.slice(-2).join(' / ')} (at ${where(sdk)})`);
    };
    if (!inArea(sdk, AREAS.atoll) && !inArea(sdk, HANGAR) && !inArea(sdk, CRASH_ISLAND)) {
        await toDaero();
        // Daero (mm_daero.rs2:218-238): Yes, the blindfold, a fade, the powered hangar.
        await hop('Daero did not take the player to the hangar', /^Daero$/i, [/^Yes$/], s => inArea(s, HANGAR), { idle: 4, near: DAERO }, MM_SHAPES.daeroReturn);
    }
    // "Shall we return to Crash Island?" (mm_waydar.rs2:5-19): Yes, the glider map, a p_delay(3), the island.
    if (inArea(sdk, HANGAR)) await hop('Waydar did not fly to Crash Island', /^Waydar$/i, [/^Yes$/], s => inArea(s, CRASH_ISLAND), { idle: 4, closeModals: false }, MM_SHAPES.waydarReturn);
    if (inArea(sdk, CRASH_ISLAND)) await hop('Lumdo did not sail to the atoll', /^Lumdo$/i, [], s => inArea(s, AREAS.atoll), { idle: 2 }, MM_SHAPES.lumdoSail);
}

/** Varrock to the stronghold: Varrock's young spirit tree goes only to Tree Gnome Village (spirit_tree.rs2, loc_1317), whose tree goes on. */
const TREE_ROUTE: readonly Hop[] = [{ kind: 'teleport', spell: 'varrock' }, { kind: 'tree', to: 'village' }, { kind: 'tree', to: 'stronghold' }];

/** Why TREE_ROUTE must not be taken from this state, or null: its teleport and spirit trees delete a backpack monkey. */
export function treeRouteRefusal(s: BotWorldState): string | null {
    if (!holds(s, MM_OBJ.monkey) || !deletesFollowerItem(TREE_ROUTE)) return null;
    return 'the monkey is in the backpack, and a teleport or spirit tree deletes it (teleport.rs2 post_tele_checks)';
}

/**
 * To the Gnome Stronghold by TREE_ROUTE: the Varrock teleport unless already near Varrock's tree (or at the village's,
 * where a resume may find the player between the two hops), then the trees.
 */
async function treesToStronghold(ctx: Ctx): Promise<void> {
    const { sdk } = ctx;
    if (inStronghold(sdk) || inGrandTree(sdk)) return;
    const refused = treeRouteRefusal(sdk.getState()!);
    if (refused) throw new Error(refused);
    const atVillage = pos(sdk).level === 0 && chebyshev(pos(sdk), SPIRIT_TREES.village.landing) <= 10;
    if (!atVillage) {
        if (!(pos(sdk).level === 0 && chebyshev(pos(sdk), VARROCK_TREE_FOOT) <= 150)) {
            await unwear(sdk, MM_OBJ.greegree); // a worn gree-gree hides the magic tab
            await dismiss(sdk);
            const t = await teleport(sdk, 'varrock');
            if (!t.ok) throw new Error(`the Varrock teleport: ${t.reason} (at ${where(sdk)})`);
        }
        const r = await runTo(sdk, { ...VARROCK_TREE_FOOT, tol: 1 }, { bot: ctx.bot });
        if (!r.ok) throw new Error(`run to Varrock's spirit tree stopped at ${where(sdk)}: ${r.reason}`);
        const v = await spiritTree(sdk, 'village');
        if (!v.ok) throw new Error(`spirit tree to the village: ${v.reason}`);
    }
    const s = await spiritTree(sdk, 'stronghold');
    if (!s.ok) throw new Error(`spirit tree to the stronghold: ${s.reason}`);
}

/**
 * The way back to the atoll's landing after a temple-rope pin's Varrock teleport (main's ruling: wait PIN_WAIT,
 * teleport, return and finish): TREE_ROUTE to the stronghold, into the tree to Daero, then the hangar route. No monkey is
 * carried at N or O. The caller's toTown is the knockout into the town that H takes.
 */
async function wayBack(ctx: Ctx, note: (line: string) => void): Promise<void> {
    const t0 = currentTick(ctx.sdk);
    await hangarRoute(ctx, async () => {
        await treesToStronghold(ctx);
        await intoTree(ctx, 1);
        if (chebyshev(pos(ctx.sdk), DAERO) > 3) await go(ctx, DAERO, 2);
    });
    note(`S15:O way back to the atoll after a temple pin: ${currentTick(ctx.sdk) - t0} ticks`);
}

/**
 * The walk home with the monkey (returnMonkey 'walk'): from the zoo to the stronghold's south gate, through it, into
 * the Grand Tree and up to Daero. No teleport or spirit tree: both delete the monkey (teleport.rs2 post_tele_checks).
 */
async function zooToDaero(ctx: Ctx): Promise<void> {
    const { sdk } = ctx;
    if (!inStronghold(sdk) && !inGrandTree(sdk)) {
        const r = await runTo(sdk, { ...GNOME_GATE_SOUTH, tol: 2 }, { bot: ctx.bot });
        if (!r.ok) throw new Error(`run to the Gnome Stronghold's gate stopped at ${where(sdk)}: ${r.reason}`);
        // The shared helper answers Femi's first-visit scene (gnome_gate.rs2, femi.rs2) and ends north of the gate.
        const g = await passGate(sdk, GNOME_STRONGHOLD_GATE, GNOME_STRONGHOLD_GATE.sides.north);
        if (!g.ok) throw new Error(`the Gnome Stronghold's gate: ${g.reason} (at ${where(sdk)})`);
        stepNote(`S15:U gate: ${g.ticks} ticks, ${g.clicks} clicks, ${g.dialogues} dialogues, ${g.pages} pages`);
    }
    await intoTree(ctx, 1);
    if (chebyshev(pos(sdk), DAERO) > 3) await go(ctx, DAERO, 2);
}

/**
 * Out of the zoo's cage as a human, beside the minder (mm_monkey_minder.rs2:13-25): T's end, and U's start when a re-run
 * finds the player caged. Each attempt picks a minder and a cage tile (letOutPick), steps there and clicks once; a
 * minder that opens nothing in LET_OUT_OPEN refused (no line of sight) and is passed over for the next pick, which
 * waits up to LET_OUT_WAIT for another in reach, then takes the same minder again from wherever it now stands. At
 * most LET_OUT_ATTEMPTS, started within LET_OUT_TICKS, then the throw. Every attempt is noted for rs/158's price.
 */
export async function letOut(ctx: Ctx): Promise<void> {
    const { sdk } = ctx;
    const st = () => sdk.getState()!;
    await unwear(sdk, MM_OBJ.greegree);
    const standable = (t: { x: number; z: number }) => {
        const p = pos(st());
        return (p.x === t.x && p.z === t.z) || sdk.findPath(t.x, t.z, 60).reachedDestination === true;
    };
    const t0 = st().tick;
    let exclude: number | null = null;
    let why = 'no minder within reach';
    let attempts = 0;
    while (attempts < LET_OUT_ATTEMPTS && inCage(sdk) && st().tick - t0 < LET_OUT_TICKS) {
        attempts++;
        const w0 = st().tick;
        await waitUntil(sdk, s => !!letOutPick(s, standable, exclude), { maxTicks: Math.min(LET_OUT_WAIT, LET_OUT_TICKS - (w0 - t0)) });
        let pick = letOutPick(st(), standable, exclude);
        const again = !pick && exclude !== null;
        if (again) pick = letOutPick(st(), standable, null);
        const waited = st().tick - w0;
        if (!pick) {
            why = `no minder within ${MINDER_REACH} of a cage tile`;
            stepNote(`S15:T let-out ${attempts}: no minder within ${MINDER_REACH} of a cage tile after ${waited} ticks`);
            continue;
        }
        const stand = pick.stand;
        const from = pos(st());
        if (from.x !== stand.x || from.z !== stand.z) {
            await act(sdk, () => sdk.sendWalk(stand.x, stand.z, true), s => pos(s).x === stand.x && pos(s).z === stand.z, { resendEvery: 3, maxTicks: 12 });
        }
        // The minder walks meanwhile: it is asked from wherever the step ended, if still in reach.
        const m = st().nearbyNpcs.find(n => n.index === pick!.minder.index) ?? pick.minder;
        const mt = { x: m.tileX ?? m.x, z: m.tileZ ?? m.z };
        const at = pos(st());
        const d = chebyshev(mt, at);
        const head = `S15:T let-out ${attempts}: minder #${m.index} at ${mt.x},${mt.z}, distance ${d} from ${at.x},${at.z}` +
            `${from.x !== at.x || from.z !== at.z ? ` (stepped from ${from.x},${from.z})` : ''}, waited ${waited} ticks${again ? ' (the minder that refused, again)' : ''}`;
        if (d < 1 || d > MINDER_REACH) {
            why = `the minder walked out of reach (${d})`;
            stepNote(`${head}: walked out of reach, not asked`);
            continue;
        }
        const c0 = st().tick;
        const r = await talkTo(sdk, m, [], { attempts: 1, openTicks: LET_OUT_OPEN, maxTicks: 60, idle: 6, until: s => !inCage(s), interrupts: [MONKEY_CHATTER], ...shaped(MM_SHAPES.minderOut) });
        noteShape(`T minder (out, attempt ${attempts})`, r);
        why = r.reason ?? r.transcript.slice(-2).join(' / ');
        stepNote(`${head}, ${r.clicks} click, ${st().tick - c0} ticks: ${inCage(sdk) ? `refused (${why})` : 'out'}`);
        if (inCage(sdk)) exclude = m.index;
    }
    const ticks = st().tick - t0;
    if (inCage(sdk)) throw new Error(`the minder did not let the player out: ${attempts} attempts in ${ticks} ticks, last: ${why} (at ${where(sdk)})`);
    stepNote(`S15:T let-out: out after ${attempts} attempt${attempts === 1 ? '' : 's'} in ${ticks} ticks`);
}

const AUNT = /^The Monkey's Aunt$/;

/**
 * The five talks with the monkey child (mm_monkey_child.rs2), each started
 * only when the aunt's loop leaves it enough time in the house. Between
 * windows, and through the toy's 100-tick timer, the player waits outside at
 * AUNT_WAIT.
 */
async function childTalks(ctx: Ctx, note: (line: string) => void, progress: ChildProgress): Promise<void> {
    const { sdk } = ctx;
    if (holds(sdk.getState()!, MM_OBJ.talisman)) return;
    const child = /^Monkey child$/i;
    // Each talk: its choices, its shape and the house time it needs in this dialogue mode, with the walk in (CHILD_TALKS).
    const choices: Record<string, RegExp[]> = { uncle: [/monkey's uncle/i], 'bananas wanted': [/How many bananas/i] };
    const talks = CHILD_TALKS.map(t => ({ name: t.name, choices: choices[t.name] ?? [], shape: t.shape, need: childTalkNeed(t, dialogue), ...(t.name === 'bananas' ? { pick: true as const } : {}) }));
    /** The aunt's loops the four talks used: each talk's `leftAt` (her last exit), counted once each. */
    const loops = new Set<number>();
    let leftAt = -Infinity;
    let seenIn = false;
    const aunt = () => sdk.getState()!.nearbyNpcs.find(n => AUNT.test(n.name));
    const auntTile = () => {
        const a = aunt();
        return a ? { x: a.tileX ?? a.x, z: a.tileZ ?? a.z } : null;
    };
    // Ticks since the aunt left the house, when that was seen; else her tile's latest.
    const stop = sdk.onStateUpdate(s => {
        const a = s.nearbyNpcs.find(n => AUNT.test(n.name));
        if (!a) return;
        const t = { x: a.tileX ?? a.x, z: a.tileZ ?? a.z };
        if (tileIn(t, AUNT_HOUSE)) seenIn = true;
        else if (seenIn && t.x === 2743 && t.z === 2791) {
            leftAt = s.tick;
            seenIn = false;
        }
    });
    const left = () => {
        const t = auntTile();
        if (!t) return { left: 0, since: -1 };
        const since = currentTick(sdk) - leftAt;
        const loop = auntLoopAt(t);
        if (!loop) return { left: 0, since: -1 };
        const e = since >= loop[0] && since <= loop[1] ? since : loop[1];
        return { left: Math.max(0, AUNT_BACK_IN - 2 - e), since: Math.max(e, loop[0]) };
    };
    const inHouse = () => inArea(sdk, AUNT_HOUSE);
    /**
     * To the wait tile under the town's zone prayer (Missiles, Melee only on the tiles beside the temple's guards), then
     * Melee standing on it, in the aunt's box. The prayer stays on through the walk in and the talks, and into P, whose
     * first run switches it standing.
     */
    const toWait = async () => {
        if (chebyshev(pos(sdk), AUNT_WAIT) > 0) await townGo(ctx, AUNT_WAIT, 0, [], { keep: true });
        await standPrayer(sdk);
    };
    /** Out of the house to the wait tile, then until the aunt's loop has `need` house ticks left and the door is clear of her. */
    const window = async (need: number) => {
        const ok = () => {
            const w = left();
            return w.left >= need && w.since >= AUNT_DOOR_CLEAR;
        };
        if (inHouse() && ok()) return;
        await toWait();
        const r = await waitUntil(sdk, () => ok(), { maxTicks: 260 });
        if (!r.ok) throw new Error(`the aunt's loop gave no ${need}-tick window in 260 ticks (aunt at ${JSON.stringify(auntTile())})`);
    };
    try {
        for (const [i, t] of talks.entries()) {
            if (i < progress.talks) continue;
            // The bananas come from the house's own trees, searched in the same window as the talk that gives them.
            // A knockout after the set-down: the sharks on the ground come back before any more go down.
            if (t.pick && progress.setDown) {
                if (!tileIn(progress.setDown.at, AUNT_HOUSE)) await toWait();
                await retakeSharks(sdk, progress, note);
            }
            const toPick = t.pick ? Math.max(0, BANANAS - invCount(sdk, MM_OBJ.banana)) : 0;
            const drop = t.pick ? bananaRoomDrops(sdk.getState()!) : 0;
            // A drop is one tick; taking the sharks back inside the house costs about SHARK_RETAKE_TICKS each.
            await window(t.need + toPick * BANANA_SEARCH_TICKS + (drop ? 1 + drop * SHARK_RETAKE_TICKS : 0));
            if (drop) {
                let k = drop;
                const d = await dropItems(sdk, i => i.id === MM_OBJ.shark && k-- > 0);
                if (!d.ok) throw new Error(`could not set ${drop} sharks down for the bananas' room (at ${where(sdk)})`);
                progress.setDown = { n: drop, at: pos(sdk), tick: currentTick(sdk) };
                note(`S15:O set ${drop} sharks down at ${pos(sdk).x},${pos(sdk).z} for the bananas' room`);
            }
            if (toPick) {
                const p = await searchBananas(sdk, BANANAS);
                note(`S15:O bananas: ${p.searches} searches, ${p.ticks} ticks, aunt ${JSON.stringify(auntTile())}, ${JSON.stringify(left())}`);
            }
            note(`S15:O talk '${t.name}' at t=${currentTick(sdk)}: aunt ${JSON.stringify(auntTile())}, ${JSON.stringify(left())}, left seen at ${leftAt}, need ${t.need}`);
            loops.add(leftAt);
            await talk(sdk, child, t.choices, { near: CHILD, shape: t.shape });
            if (t.pick) {
                if (invCount(sdk, MM_OBJ.banana) > 0) throw new Error('the child did not take the bananas');
                progress.given = currentTick(sdk);
                // Back up at once if they lie in the house (in the same window); else at the wait tile, below.
                if (progress.setDown && tileIn(progress.setDown.at, AUNT_HOUSE)) await retakeSharks(sdk, progress, note);
            }
            progress.talks = i + 1;
        }
        if (loops.size) note(`S15:O child talks: ${loops.size} aunt loop(s) for ${progress.talks === talks.length ? 'all four' : 'the talks run here'} (dialogue ${dialogue}; her exits at ${[...loops].map(t => (Number.isFinite(t) ? t : 'already out')).join(', ')})`);
        const given = progress.given ?? currentTick(sdk);
        // The toy's timer (mm_monkey_child.rs2:142, settimer 100) runs from the bananas; the aunt is back in long before it ends.
        await toWait();
        if (progress.setDown) await retakeSharks(sdk, progress, note);
        await waitUntil(sdk, s => s.tick - given >= 101, { maxTicks: 120 });
        // Seven pages (the objbox the last), plus the 6-tile walk in: with 12 left, the aunt came back mid-talk once.
        await window(childTalkNeed(CHILD_TALISMAN, dialogue));
        note(`S15:O talk 'talisman' at t=${currentTick(sdk)}: aunt ${JSON.stringify(auntTile())}, ${JSON.stringify(left())}, left seen at ${leftAt}`);
        await topUp(sdk);
        const r = await talkTo(sdk, child, [], { maxTicks: 60, idle: 3, near: CHILD, ...shaped(CHILD_TALISMAN.shape) });
        noteShape('the child (talisman)', r);
        if (!holds(sdk.getState()!, MM_OBJ.talisman)) throw new Error(`no talisman from the child: ${r.reason ?? r.transcript.slice(-2).join(' / ')}`);
        await dismiss(sdk);
        // Out before the aunt is back: both in the house is the one unsafe place. O ends here, Melee on.
        await toWait();
    } finally {
        stop();
    }
}

/**
 * How far the child's talks got, kept by O across knockout retries: quest varps never reach the client, so a re-run
 * resumes from here rather than from the child's dialogue. `given` is the tick the bananas were handed in, which
 * starts the toy's server timer.
 */
export interface ChildProgress {
    talks: number;
    given?: number;
    /** Sharks set down for the bananas' room and not yet taken back (a player's drop lies 300 ticks, drop.rs2). */
    setDown?: { n: number; at: { x: number; z: number; level: number }; tick: number };
}

/**
 * The most ticks set-down sharks may lie before they are back in hand: main's bound (rs/185, 10-22), 20 under the
 * engine's objRevealTicks (100), when a player's drop becomes visible to everyone (WorldConfig.ts).
 */
export const SET_DOWN_MAX_TICKS = 80;

/** Ticks to take one set-down shark back, the step onto its tile included (a planning figure for the aunt's window). */
const SHARK_RETAKE_TICKS = 3;

/**
 * Sharks to set down so the five bananas fit at once: the child takes them only five or more together
 * (mm_child_give_bananas), they do not stack, and a search with a full pack picks nothing (banana_tree.rs2).
 * A chain reaches O with about one free slot, so the sharks go on the ground for the pick and come back after the
 * hand-in. Throws when even every shark is not enough.
 */
export function bananaRoomDrops(s: BotWorldState): number {
    const short = Math.max(0, BANANAS - invCount(s, MM_OBJ.banana)) - freeSlots(s);
    if (short <= 0) return 0;
    const sharks = invCount(s, MM_OBJ.shark);
    if (sharks < short) throw new Error(`no room for ${BANANAS} bananas: ${freeSlots(s)} free and ${sharks} sharks to set down`);
    return short;
}

/**
 * Take back the sharks O set down, noting the ticks they lay against SET_DOWN_MAX_TICKS. A shark missing at the
 * pickup fails the step: it is a kit-gate failure (rs/185's ruling), never absorbed as a quiet supply loss.
 */
async function retakeSharks(sdk: Sdk, progress: ChildProgress, note: (line: string) => void): Promise<void> {
    const set = progress.setDown;
    if (!set) return;
    let got = 0;
    for (let i = 0; i < set.n; i++) {
        const lying = (await sdk.scanGroundItems(15)).some(g => g.id === MM_OBJ.shark);
        if (!lying) break;
        const r = await pickup(sdk, MM_OBJ.shark, { maxTicks: 15 });
        if (!r.ok) break;
        got++;
    }
    progress.setDown = undefined;
    const lay = currentTick(sdk) - set.tick;
    note(`S15:O set-down: ${got} of ${set.n} sharks back after ${lay} ticks (bound ${SET_DOWN_MAX_TICKS})${lay > SET_DOWN_MAX_TICKS ? ' SETDOWN_OVER_BOUND' : ''}`);
    if (got < set.n) throw new Error(`kit gate: ${set.n - got} of ${set.n} set-down sharks missing at the pickup, ${lay} ticks after the drop`);
}

/** The child wants 5 bananas (mm_monkey_child.rs2). */
const BANANAS = 5;
/** Ticks a search of a banana tree takes, the walk between trees included (a planning figure for the aunt's window). */
const BANANA_SEARCH_TICKS = 2;
/**
 * The banana trees with fruit (quest_mm.loc mm_bananatreefull, -four ... -one; mm_bananatreeempty, 4754, has none).
 * The five full ones stand in the aunt's house, round the child: a search adds one banana and turns the tree one
 * stage emptier (banana_tree.rs2), so one tree gives five.
 */
export const BANANA_TREE_IDS: ReadonlySet<number> = new Set([4749, 4750, 4751, 4752, 4753]);

/** Search the house's banana trees, nearest first, until `want` bananas are held. */
/** The banana tree to search next: the nearest not yet missed in this pick, else the nearest; null with none in fruit. */
export function nextBananaTree<T extends { x: number; z: number }>(trees: readonly T[], me: { x: number; z: number }, missed: ReadonlySet<string>): T | null {
    const near = [...trees].sort((a, b) => chebyshev(a, me) - chebyshev(b, me));
    return near.find(t => !missed.has(`${t.x},${t.z}`)) ?? near[0] ?? null;
}

async function searchBananas(sdk: Sdk, want: number): Promise<{ searches: number; ticks: number }> {
    const t0 = currentTick(sdk);
    let searches = 0;
    const missed = new Set<string>();
    for (let i = 0; i < want + 4 && invCount(sdk, MM_OBJ.banana) < want; i++) {
        const me = pos(sdk);
        const trees = (await sdk.scanNearbyLocs(12)).filter(l => BANANA_TREE_IDS.has(l.id) && tileIn({ x: l.x, z: l.z, level: 0 }, AUNT_HOUSE));
        const tree = nextBananaTree(trees, me, missed);
        if (!tree) throw new Error(`no banana tree with fruit in the aunt's house (at ${where(sdk)})`);
        const n = invCount(sdk, MM_OBJ.banana);
        const op = tree.optionsWithIndex.find(o => /^search$/i.test(o.text))?.opIndex ?? 1;
        searches++;
        const r = await act(sdk, () => sdk.sendInteractLoc(tree.x, tree.z, tree.id, op), s => invCount(s, MM_OBJ.banana) > n, { resendEvery: 4, maxTicks: 15 });
        // A hit and the upkeep's eat mid-search cancel the loc op (measured, gate chain b at t 2171); the loop's own bound
        // (want + 4 searches) is the retry.
        if (!r.ok) {
            missed.add(`${tree.x},${tree.z}`);
            stepNote(`S15:O banana tree at ${tree.x},${tree.z}: no banana in 15 ticks (at ${where(sdk)}); searching another`);
        }
    }
    if (invCount(sdk, MM_OBJ.banana) < want) throw new Error(`${invCount(sdk, MM_OBJ.banana)} bananas after ${searches} searches`);
    return { searches, ticks: currentTick(sdk) - t0 };
}

/** The nearest NPC named `name` that offers Talk-to: the zoo's cage also holds plain monkeys (op2 Attack only) of the same name. */
export function talkableNpc(s: BotWorldState, name: RegExp, near: { x: number; z: number }): BotWorldState['nearbyNpcs'][number] | null {
    const at = (n: BotWorldState['nearbyNpcs'][number]) => ({ x: n.tileX ?? n.x, z: n.tileZ ?? n.z });
    const ok = s.nearbyNpcs.filter(n => name.test(n.name) && n.optionsWithIndex.some(o => /^talk-to$/i.test(o.text)));
    ok.sort((a, b) => chebyshev(at(a), near) - chebyshev(at(b), near));
    return ok[0] ?? null;
}

/** The running step's note, for helpers that have no options in reach (set by stepFor; tests set it directly). */
let stepNote: (line: string) => void = () => {};
export function setStepNote(note: (line: string) => void): void {
    stepNote = note;
}

/** The final battle's arena (mm_demon.rs2: zone 1_42_143, level 1). */
export const ARENA = { x0: 2688, z0: 9152, x1: 2751, z1: 9215, level: 1 } as const;
const DEMON = /^Jungle Demon$/i;
/** The demon (size 3) melees on half its attacks within 2 tiles of its edge (mm_demon.rs2:332-340): from its centre tile, 3. */
export const DEMON_TOO_CLOSE = 4;

/**
 * A tile about `far` tiles from `from` on the far side of the player, for
 * stepping away from the demon; straight away, else turned 45 degrees either
 * way when the straight line leaves the arena.
 */
export function awayFrom(me: { x: number; z: number }, from: { x: number; z: number }, far = 6): { x: number; z: number } {
    const dx = Math.sign(me.x - from.x) || 1, dz = Math.sign(me.z - from.z) || 1;
    const tries: Array<[number, number]> = [[dx, dz], [dx, 0], [0, dz], [dx, -dz], [-dx, dz]];
    for (const [ax, az] of tries) {
        const t = { x: me.x + ax * far, z: me.z + az * far };
        if (tileIn({ ...t, level: 1 }, { ...ARENA, x0: ARENA.x0 + 2, z0: ARENA.z0 + 2, x1: ARENA.x1 - 2, z1: ARENA.z1 - 2 })) return t;
    }
    return { x: me.x - dx * far, z: me.z - dz * far };
}

/**
 * The Jungle Demon with the magic shortbow under Protect from Magic
 * (quest_mm.md Fight: 267 ticks mean at 100 ms, 3 of 3 from 6+ tiles). The
 * sigil goes on while still a monkey beside Garkor (a human there is knocked
 * out); its timer (10 ticks) teleports the player into the arena, where the
 * bow replaces the gree-gree. Whenever the demon's centre comes within
 * DEMON_TOO_CLOSE, step about 6 tiles away and shoot again: at Defence 1 and
 * 42 HP its melee is the danger, and Protect from Magic stops only its spells.
 */
async function demonFight(ctx: Ctx, note: (line: string) => void, bow: number): Promise<void> {
    const { sdk } = ctx;
    const st = () => sdk.getState()!;
    // Protect from Magic before the teleport: on arrival the battle's intro blocks both prayer toggles and equips for
    // several ticks, and in that window a wave spell (max 31) hit for 25 at 42 HP. Prayers carry across the teleport.
    await praying(sdk, 'protect_from_magic', async () => {
        if (!inArea(sdk, ARENA)) {
            const w = await wield(sdk, MM_OBJ.sigil);
            if (!w.ok) throw new Error(`the sigil did not go on: ${w.reason}`);
            const r = await waitUntil(sdk, s => inArea(s, ARENA), { maxTicks: 90 });
            if (!r.ok) throw new Error(`the sigil did not teleport (at ${where(sdk)}): ${st().gameMessages.slice(-3).map(m => m.text).join(' | ')}`);
        }
        // The battle's intro (Garkor's queued line, the squad, the demon) opens chats that block inventory ops, so the bow
        // and arrows go on in a loop that clears any open chat between tries.
        const equipped = (id: number) => st().equipment.some(i => i.id === id);
        for (let i = 0; i < 8 && !(equipped(bow) && equipped(MM_OBJ.runeArrow)); i++) {
            await dismiss(sdk);
            if (!equipped(bow)) await wield(sdk, bow, { maxTicks: 5 });
            if (!equipped(MM_OBJ.runeArrow) && invCount(sdk, MM_OBJ.runeArrow) > 0) await wield(sdk, MM_OBJ.runeArrow, { maxTicks: 5 });
        }
        if (!equipped(bow)) throw new Error(`the bow did not go on; dialog ${st().dialog.isOpen ? (st().dialog.allComponents ?? []).map(c => c.text).join('/') : 'closed'}; worn ${st().equipment.map(i => i.name).join(', ')}; msgs ${st().gameMessages.slice(-4).map(m => m.text).join(' | ')}`);
        const spawn = await waitUntil(sdk, s => s.nearbyNpcs.some(n => DEMON.test(n.name)), { maxTicks: 60 });
        if (!spawn.ok) throw new Error(`no Jungle Demon in the arena (at ${where(sdk)})`);
        let steps = 0;
        const centre = (n: { x: number; z: number; tileX?: number; tileZ?: number }) => ({ x: n.tileX ?? n.x, z: n.tileZ ?? n.z });
        const f = await fight(sdk, DEMON, {
            prayer: 'protect_from_magic', drinkBelow: DRINK_BELOW, stallTicks: 8, eatBelow: eating.below, food: MM_OBJ.shark,
            maxTicks: 2000, onDialog: 'continue',
            onTick: async (s, target) => {
                // An empty quiver does no damage while the demon drains every dose (a measured death), so it fails at once.
                if (!s.equipment.some(i => i.id === MM_OBJ.runeArrow) && invCount(s, MM_OBJ.runeArrow) === 0) {
                    throw new Error(`out of rune arrows against the Jungle Demon (prayer ${s.skills.find(k => k.name === 'Prayer')?.level ?? '?'}, at ${where(sdk)})`);
                }
                if (!target || chebyshev(pos(s), centre(target)) > DEMON_TOO_CLOSE) return false;
                const to = awayFrom(pos(s), centre(target));
                steps++;
                await sdk.sendWalk(to.x, to.z, true);
                await waitUntil(sdk, x => chebyshev(pos(x), to) <= 1, { maxTicks: 6 });
                return true;
            },
        });
        note(`S15:X demon: ${f.end} in ${f.ticks} ticks, taken ${f.taken}, eats ${f.eats}, drinks ${f.drinks}, level-ups ${f.levelUps}, step-aways ${steps}`);
        if (!(f.end === 'killed' || f.end === 'gone')) throw new Error(`the Jungle Demon fight ended '${f.end}' (at ${where(sdk)})`);
    });
}

/**
 * From anywhere in the town, the western warehouse or the dungeon, to
 * Zooknock as a human (segments K and P): over the roofs if in the western
 * warehouse, the bridge's ladder, the jump off its end, the dungeon ladder,
 * and the dungeon. Protect from Missiles in the town (its Monkey Archers
 * reach the warehouse, the roofs and the streets), Protect from Melee below
 * (zombies and skeletons, configs/quest_mm.npc).
 */
async function toZooknock(ctx: Ctx, topUpFrom?: TopUp): Promise<void> {
    const { sdk } = ctx;
    await upkeep(sdk, () => zooknockWay(sdk, {
        async roofs() {
            // The roofs cross the temple's first floor among its religious guards: the zone prayer per step.
            for (const r of ROOFS) {
                await legPrayer(sdk, r);
                if (r.climb) await climb(sdk, r);
                else await go(ctx, r);
            }
        },
        async jump() {
            if (pos(sdk).level === 0) {
                // The zone prayer stays on up the ladder; the jump's leg below keeps or switches it standing.
                await townGo(ctx, { x: BRIDGE_LADDER.x, z: BRIDGE_LADDER.z + 1 }, 0, [], { keep: true });
                await climb(sdk, BRIDGE_LADDER);
            }
            // The jump off the bridge's end: 1 HP, refused while a monkey (quest_mm.rs2:1036-1043).
            await topUp(sdk);
            await legPrayer(sdk, JUMP_SQUARE);
            const r = await opLoc(sdk, { ...JUMP_SQUARE, op: /jump/i, radius: 15 }, /jump/i, s => outsideTown(s), { resendEvery: 5, maxTicks: 40 });
            if (!r.ok) throw new Error(`the bridge jump did not land (at ${where(sdk)})`);
        },
        ...(topUpFrom?.p ? { pLeg: () => h12oLeg(sdk, topUpFrom, 'P') } : {}),
        async ladder() {
            const foot = { x: DUNGEON_LADDER.x, z: DUNGEON_LADDER.z + 1 };
            await legPrayer(sdk, foot);
            await go(ctx, foot, 1);
            await immune(sdk, 'the dungeon (ladder)');
            // A climb click lost under a hit is re-sent by lib/act's rules (rs/411, rs/481).
            await climb(sdk, DUNGEON_LADDER);
        },
        walk: () => praying(sdk, 'protect_from_melee', () => logStalls(sdk, 'dungeon walk', () => go(ctx, ZOOKNOCK, 2))),
    }));
}

/** toZooknock's legs, each from where the one before left the player (zooknockWay runs them). */
export interface ZooknockLegs {
    /** Over the roofs, from the western warehouse's ground floor. */
    roofs: () => Promise<void>;
    /** From anywhere in the town (the cell included) up the bridge and off its end, outside the town. */
    jump: () => Promise<void>;
    /** H12o-P's leg at the jump's landing, when P has a top-up. */
    pLeg?: () => Promise<unknown>;
    /** From outside the town down the dungeon ladder. */
    ladder: () => Promise<void>;
    /** The dungeon walk to Zooknock. */
    walk: () => Promise<void>;
}

/**
 * The way to Zooknock: everything above ground under jailSafe, then the dungeon walk. A knockout during H12o-P's leg
 * (the archers reach the landing) does not make the leg throw: it moves on without the top-up with SCORED in the cell.
 * So the jailSafe errand ends only in the dungeon, and throws otherwise, which retries it from the cell. The leg runs
 * at most once: on a retry its helper may already have had P's final stop, and the cue writer won't reopen a final
 * session, so the retry walks on without the top-up.
 */
export async function zooknockWay(sdk: Sdk, legs: ZooknockLegs): Promise<void> {
    let pTried = false;
    await jailSafe(sdk, async () => {
        if (inArea(sdk, AREAS.westWarehouse) && pos(sdk).level === 0) await legs.roofs();
        if (inArea(sdk, AREAS.atoll) && !outsideTown(sdk)) {
            await legs.jump();
            if (legs.pLeg && pTried) stepNote(`S15:P top-up: not tried again after a knockout (at ${where(sdk)}); on to the dungeon without it`);
            else if (legs.pLeg) {
                pTried = true;
                await legs.pLeg();
            }
        }
        if (outsideTown(sdk)) await legs.ladder();
        if (!inArea(sdk, AREAS.dungeon)) throw new Error(`not in the dungeon for the walk to Zooknock (at ${where(sdk)})`);
    });
    await legs.walk();
}

/** Ticks without a step before a walk counts as held (a zombie in the dungeon's corridors, K and P). */
export const STALL_TICKS = 5;

/** Run a walk, noting each stretch of STALL_TICKS or more without a step outside a dialogue, with the NPCs within 2. */
async function logStalls<T>(sdk: Sdk, label: string, fn: () => Promise<T>): Promise<T> {
    let at = pos(sdk);
    let since = currentTick(sdk);
    let noted = false;
    const stop = sdk.onStateUpdate(s => {
        const p = pos(s);
        if (p.x !== at.x || p.z !== at.z) {
            at = p;
            since = s.tick;
            noted = false;
            return;
        }
        if (noted || s.dialog.isOpen || s.tick - since < STALL_TICKS) return;
        noted = true;
        const near = s.nearbyNpcs.filter(n => chebyshev({ x: n.tileX ?? n.x, z: n.tileZ ?? n.z }, p) <= 2).map(n => `${n.name}@${n.tileX ?? n.x},${n.tileZ ?? n.z}`);
        stepNote(`S15 ${label}: no step for ${STALL_TICKS} ticks at ${p.x},${p.z} (t=${s.tick}), beside ${near.join(' ') || 'no NPC'}`);
    });
    try {
        return await fn();
    } finally {
        stop();
    }
}

/**
 * The atoll top-ups (SUPPLIES.md H12o), one helper's two receive legs (rs/158 and main, 10-22 14:1x), each sized from
 * SCORED's state as it arrives and sent to the helper as a top-up ask (altar-cue.ts writeTopUpAsk, the H10/H12/H22
 * path): the helper can't see SCORED's pack. `m`: sharks into the free slots less one (mTopUpSharks) at the dungeon
 * exit ladder's top in M, until a chain proves a full pack safe from M to P. `p`: the super antipoison and sharks
 * (pTopUpAsk) on the bridge jump's landing in P. The helper waits idle on P's tile between the two.
 */
export interface TopUp {
    from: string;
    m?: boolean;
    p?: boolean;
    /**
     * The helper's cue directory (h45's, docs/speedrun/helpers/mule.md): each leg's request cue, its ask and its stop.
     * Default cueDir().
     */
    cueDir?: string;
}

/** Each leg's cue and ask scope: its package name in h45's config, family 'mule' (docs/speedrun/helpers/mule.md, rs/158). */
export const H12O_SCOPE = { M: { step: 'H12oM', family: 'mule' }, P: { step: 'H12oP', family: 'mule' } } as const satisfies Record<string, CueScope>;
/** H12o-M's ledger row, STEP-MANIFEST.md's inventory ledger: `shark to N`, the most sharks the leg asks for. */
export const H12O_M_ROW = 'H12o-M';

/** H12o-M's shark cap, the N of its ledger row's `shark to N` (read once). */
export function mTopUpCap(manifest?: string): number {
    if (manifest === undefined && mCap !== null) return mCap;
    const { rows } = parseLedger(manifest ?? readFileSync(MANIFEST, 'utf8'));
    const row = rows.find(r => r.row === H12O_M_ROW);
    const shark = row?.in.find(e => e.topUp && /^shark$/i.test(itemLabel(e)));
    if (!shark || typeof shark.count !== 'number') throw new Error(`the ledger has no ${H12O_M_ROW} row with a \`shark to N\` entry`);
    if (manifest === undefined) mCap = shark.count;
    return shark.count;
}
let mCap: number | null = null;

/**
 * An H12o leg's cue (CueWriter scoped H12O_SCOPE[leg], SCORED the receiver), a new session each write. An open logs
 * h45 in through the launcher's loginOn (M) and sends it to the leg's tile, clearing the wildlife there; a stop sends it
 * on from M, or logs it out after P (the launcher's stopOn). One cue.json per directory: P's open replaces M's cue.
 */
export function legCue(sdk: Pick<Sdk, 'getState'>, dir: string, leg: TopUpLeg, action: 'open' | 'stop', o: { final?: boolean } = {}): void {
    const s = sdk.getState()!;
    const w = new CueWriter(dir, s.player!.name, H12O_SCOPE[leg]);
    const beacons = [{ tick: s.tick, ms: Date.now() }];
    if (action === 'open') w.write({ beacons, turns: [] });
    else w.stop(beacons, o.final ? { final: true } : {});
    stepNote(`S15:${leg} H12o cue ${action}${o.final ? ' final' : ''} (${H12O_SCOPE[leg].step}) at t=${s.tick}`);
}
export type TopUpLeg = keyof typeof H12O_SCOPE;

/** The ask's name patterns (case-insensitive RegExp sources, as mule.ts topUpCounts matches them). */
export const ASK_SHARK = '^shark$';
export const ASK_SUPER_ANTIPOISON = '^superantipoison\\(4\\)$';

/** H12o-P's most sharks (SUPPLIES.md's row). */
export const P_TOPUP_MAX_SHARKS = 9;

/**
 * H12o-P's size at the landing (rs/158, 10-22 15:2x): the super antipoison first (R ran out, and no other leg carries
 * one), then min(9, free - 2) sharks, keeping one slot free; 1 or 2 free: the antipoison alone; none free: null, move on.
 */
export function pTopUpAsk(s: BotWorldState): { antipoison: 1; sharks: number } | null {
    const free = freeSlots(s);
    if (free <= 0) return null;
    return { antipoison: 1, sharks: Math.max(0, Math.min(P_TOPUP_MAX_SHARKS, free - 2)) };
}

/** The dungeon exit ladder's top, where M climbs out and takes H12o-M. */
export const M_TOPUP_TILE = { x: 2763, z: 2704 } as const;

/** H12o-M's sharks: every free slot less one, at most the ledger row's cap (0: no leg); the count SCORED asks for. */
export function mTopUpSharks(s: BotWorldState, cap = mTopUpCap()): number {
    return Math.min(cap, Math.max(0, freeSlots(s) - 1));
}

/** Ticks a receive leg waits for the helper to be in view. */
export const TOPUP_WAIT = 30;
/** Ticks a receive leg waits for SCORED to be idle before its trade click (it clicks after them anyway, noted). */
export const IDLE_WAIT = 10;
/** Trade attempts a leg makes before moving on without its top-up. */
export const TOPUP_TRIES = 2;

/** On while a receive leg trades: upkeep sends nothing then. */
let trading = false;

/**
 * SCORED can make a trade click that lands: no chat, modal or trade open, no animation (an eat, a drink, a climb) and
 * the same tile on two successive states. Gate chain a's H12o-P (13:34 round) clicked as the landing's prayer-potion
 * drink went out; the server drops a delayed player's click without a word (lib/trade.ts), and no re-send fit its
 * 20-tick window, so the helper's requests stood unanswered.
 */
export function tradeIdle(prev: BotWorldState | null, s: BotWorldState): boolean {
    const a = prev?.player;
    const b = s.player;
    if (!prev || !a || !b || s.tick <= prev.tick) return false;
    return !s.dialog.isOpen && !s.modalOpen && !tradeOf(s).isOpen && a.animId === -1 && b.animId === -1 && a.worldX === b.worldX && a.worldZ === b.worldZ && a.level === b.level;
}

/**
 * A receive leg's size from SCORED's state at its click: the ask it sends the helper, and what it accepts, which is
 * looser than the ask (a helper short of sharks still delivers the rest); or why it takes nothing.
 */
export type LegSize = (s: BotWorldState) => { want: WantSpec[]; ask: AskItem[] } | string;

export const mLegSize: LegSize = s => {
    const n = mTopUpSharks(s);
    return n > 0 ? { want: [{ item: /^Shark$/i, amount: 1 }], ask: [{ item: ASK_SHARK, count: n }] } : `no free slot to spare for H12o-M (${freeSlots(s)} free)`;
};

export const pLegSize: LegSize = s => {
    const a = pTopUpAsk(s);
    if (!a) return `no free slot for H12o-P (${freeSlots(s)} free)`;
    const ask: AskItem[] = [{ item: ASK_SUPER_ANTIPOISON, count: a.antipoison }, ...(a.sharks > 0 ? [{ item: ASK_SHARK, count: a.sharks }] : [])];
    return { want: [{ item: /^Superantipoison\(4\)$/i, amount: 1 }], ask };
};

/**
 * Calls `write` once, on the first state that shows a trade with `partner` open: the frame a mule-family helper's
 * awaitAsk counts from (altar-cue.ts usableAsk). Returns the unsubscribe.
 */
export function onTradeOpen(sdk: Pick<Sdk, 'onStateUpdate'>, partner: string, write: (s: BotWorldState) => void): () => void {
    let done = false;
    const stop = sdk.onStateUpdate(s => {
        const t = tradeOf(s);
        if (done || !t.isOpen || !sameName(t.partner, partner)) return;
        done = true;
        write(s);
    });
    return stop;
}

export interface LegResult {
    ok: boolean;
    attempts: number;
    ticks: number;
    received?: string;
    reason?: string;
}

export type Receive = (sdk: Sdk, partner: string, opts: { want: WantSpec[]; maxTicks: number; openMaxTicks: number; noReplyTicks?: number }) => Promise<ReceiveResult>;
const receiveFromHelper: Receive = (sdk, partner, opts) => receiveFrom(sdk as never, partner, opts);

const busyState = (s: BotWorldState) =>
    `dialog ${s.dialog.isOpen ? 'open' : 'closed'}, modal ${s.modalOpen}, trade ${tradeOf(s).isOpen ? 'open' : 'closed'}, anim ${s.player?.animId ?? '?'}, at ${s.player?.worldX},${s.player?.worldZ}`;

/** Ticks a declined trade has to close before the window is closed outright. */
export const DECLINE_TICKS = 3;

/**
 * A receive that ended with the trade window still open (a timeout: the helper never accepted) leaves both players held
 * in it, the helper unable to go home and SCORED's next click refused. Decline it; if it is still open after
 * DECLINE_TICKS, close the window.
 */
export async function closeLeftTrade(sdk: Sdk, label: TopUpLeg): Promise<void> {
    if (!tradeOf(sdk.getState()!).isOpen) return;
    const t0 = currentTick(sdk);
    await sdk.sendDeclineTrade();
    let w = await waitUntil(sdk, s => !tradeOf(s).isOpen, { maxTicks: DECLINE_TICKS });
    if (!w.ok) {
        await sdk.sendCloseModal();
        w = await waitUntil(sdk, s => !tradeOf(s).isOpen, { maxTicks: DECLINE_TICKS });
    }
    stepNote(`S15:${label} top-up: the trade was left open; ${w.ok ? 'closed' : 'STILL OPEN'} after ${currentTick(sdk) - t0} ticks`);
}

/**
 * One H12o receive leg. Waits up to TOPUP_WAIT for the helper in view and up to IDLE_WAIT for SCORED to be idle
 * (tradeIdle), then sizes the leg and asks for the trade (receiveFrom, accepting the leg's want; DROPPED_TICKS beside
 * the helper, so a dropped click is re-sent at once) with upkeep held, writing the leg's ask (H12O_SCOPE) on the first
 * frame that shows the trade open. One retry; after it, or with the helper not in view or no room, the segment moves on
 * without the top-up, noted. It never throws for the trade.
 */
export async function receiveLeg(sdk: Sdk, from: string, label: TopUpLeg, size: LegSize, o: { receive?: Receive; cueDir?: string } = {}): Promise<LegResult> {
    const receive = o.receive ?? receiveFromHelper;
    const askDir = o.cueDir ?? cueDir();
    const t0 = currentTick(sdk);
    const moveOn = (reason: string, attempts: number): LegResult => {
        stepNote(`S15:${label} top-up from ${from}: moving on without it after ${attempts} attempt(s), ${currentTick(sdk) - t0} ticks: ${reason}`);
        return { ok: false, attempts, ticks: currentTick(sdk) - t0, reason };
    };
    const helper = (s: BotWorldState) => s.nearbyPlayers.find(p => sameName(p.name, from));
    const seen = await waitUntil(sdk, s => !!helper(s), { maxTicks: TOPUP_WAIT });
    if (!seen.ok) return moveOn(`the helper was not in view within ${TOPUP_WAIT} ticks`, 0);
    let reason = '';
    for (let attempt = 1; attempt <= TOPUP_TRIES; attempt++) {
        // As gtSwap: upkeep's eat lands first, then upkeep is held from the idle wait and the sizing through the trade, so
        // no eat changes the pack between the leg's size and its trade.
        await eatenUpTo(sdk, eating.below);
        trading = true;
        let s: BotWorldState;
        let idle: Awaited<ReturnType<typeof waitUntil>>;
        let r: ReceiveResult;
        try {
            let prev: BotWorldState | null = null;
            idle = await waitUntil(sdk, st => {
                const ok = tradeIdle(prev, st);
                prev = st;
                return ok;
            }, { maxTicks: IDLE_WAIT });
            s = sdk.getState()!;
            const sized = size(s);
            if (typeof sized === 'string') return moveOn(sized, attempt - 1);
            const h = helper(s);
            const beside = !!h && chebyshev(pos(s), { x: h.x, z: h.z }) <= 1;
            const asked = sized.ask.map(a => `${a.count} ${a.item}`).join(', ');
            const unask = onTradeOpen(sdk, from, st => {
                writeTopUpAsk(askDir, sized.ask, Date.now(), H12O_SCOPE[label]);
                stepNote(`S15:${label} top-up ask (${H12O_SCOPE[label].step}) at t=${st.tick}, ${freeSlots(st)} free: ${asked}`);
            });
            try {
                r = await receive(sdk, from, { want: sized.want, maxTicks: 60, openMaxTicks: 20, ...(beside ? { noReplyTicks: DROPPED_TICKS } : {}) });
            } finally {
                unask();
                await closeLeftTrade(sdk, label);
            }
        } finally {
            trading = false;
        }
        if (r.ok) {
            const received = r.received.map(i => `${i.count} ${i.name}`).join(', ');
            stepNote(`S15:${label} top-up from ${from}: attempt ${attempt}, ${currentTick(sdk) - t0} ticks, received ${received}`);
            return { ok: true, attempts: attempt, ticks: currentTick(sdk) - t0, received };
        }
        reason = r.reason ?? 'failed';
        stepNote(`S15:${label} top-up attempt ${attempt} of ${TOPUP_TRIES}: ${reason}; SCORED at the click: ${idle.ok ? 'idle' : `not idle within ${IDLE_WAIT} ticks`}, ${busyState(s)}`);
    }
    return moveOn(reason, TOPUP_TRIES);
}

/**
 * One H12o leg with its cues: the receive leg (its ask on the open frame), then the leg's stop where h45 needs one (P's
 * always, logging it out; M's only with no trade, since after a trade the mule moves on to P by itself), then, after M,
 * P's open.
 */
export async function h12oLeg(sdk: Sdk, t: TopUp, leg: TopUpLeg, receive?: Receive): Promise<LegResult> {
    const dir = t.cueDir ?? cueDir();
    const run = () => receiveLeg(sdk, t.from, leg, leg === 'M' ? mLegSize : pLegSize, { cueDir: dir, ...(receive ? { receive } : {}) });
    if (leg === 'P') return pFinalStop(sdk, t, run);
    const r = await run();
    if (!r.ok) legCue(sdk, dir, leg, 'stop');
    if (t.p) legCue(sdk, dir, 'P', 'open');
    return r;
}

/**
 * Run `fn` with H12o-P's final stop (Cue.final: the scope is done, the launcher logs h45 out) written on its every exit,
 * a throw included, and only once however many calls nest: P's leg and P's whole segment both wrap in it, so a segment
 * that throws before the leg (a failed jump, a knockout) still sends h45 home.
 */
export async function pFinalStop<T>(sdk: Sdk, t: TopUp | undefined, fn: () => Promise<T>): Promise<T> {
    if (!t?.p || pStopping) return fn();
    pStopping = true;
    try {
        return await fn();
    } finally {
        pStopping = false;
        legCue(sdk, t.cueDir ?? cueDir(), 'P', 'stop', { final: true });
    }
}
let pStopping = false;

// ------------------------------------------------------------------ segments

type Resolved = ReturnType<typeof resolveOptions>;

interface Body {
    preconditions: Check<MmContext>;
    /** Preconditions that depend on the options; replaces `preconditions` when given. */
    pre?: (o: Resolved) => Check<MmContext>;
    run(ctx: Ctx, o: Resolved): Promise<void>;
    postconditions?: Check<MmContext>;
    inProgress?: (o: Observed) => boolean;
    resume?(ctx: Ctx): Promise<void>;
    /** Its run picks up a fight already on (runner/step.ts Step.startsInCombat). */
    startsInCombat?: true;
}

const onAtoll: Check<MmContext> = s => inArea(s, AREAS.atoll) || `not on Ape Atoll's surface (at ${JSON.stringify(pos(s))})`;
const inTown: Check<MmContext> = s => (inArea(s, AREAS.atoll) && !outsideTown(s) && !inCell(s)) || `not free in the town (at ${JSON.stringify(pos(s))})`;
const human: Check<MmContext> = s => !s.equipment.some(i => i.id === MM_OBJ.greegree) || 'wearing the gree-gree';
/** On the atoll's surface, or off the atoll: O's start, where a temple-rope pin's teleport leaves the way back to it. */
const onAtollOrAway: Check<MmContext> = s => inArea(s, AREAS.atoll) || offAtoll(s) || `under the atoll (at ${JSON.stringify(pos(s))})`;
/** N's end: out of the trapdoor guards' box on the atoll, or teleported off it from a pin. */
export const templeLeft: Check<MmContext> = s =>
    offAtoll(s) || (inArea(s, AREAS.atoll) && chebyshev(pos(s), TRAPDOOR) >= 4) || `still among the trapdoor guards (at ${JSON.stringify(pos(s))})`;

/** Inside Awowogei's hall: north of Elder Guard 2's door (he shows out anyone more than 1 tile north of him). */
export function inThroneRoom(src: StateLike): boolean {
    const p = pos(src);
    return p.level === 0 && p.z >= ELDER_GUARD.z + 2 && p.z <= THRONE.z + 3 && p.x >= ELDER_GUARD.x - 6 && p.x <= THRONE.x + 1;
}

/**
 * Narnode's reward (mm_narnode.rs2:89-99): 10,000 coins and 3 diamonds. mm_narnode_reward checks only 3 free slots, but
 * the diamonds are unstackable, so with no coin stack held it takes 4; with only 3 free, one diamond is lost.
 */
export const REWARD_ITEMS: readonly QuestItem[] = [
    { item: /^Coins$/i, name: 'coins', stackable: true, from: 'Y' },
    { item: /^Diamond$/i, name: 'diamond', n: 3, from: 'Y' },
];
const yCover = slotsCover(REWARD_ITEMS, SEGMENTS.map(d => d.letter), 'Y');
/** Slots Narnode's reward needs now, by segments.ts slotNeed: 4 with no coin stack held, 3 with one. */
const yNeed = (s: BotWorldState) => slotNeed(s, REWARD_ITEMS, SEGMENTS.map(d => d.letter), 'Y').slots;
/**
 * Y's room for the reward: free slots, plus the EXIT_DROPS held, which Y drops before the reward when it is short
 * (Z would drop them at the exit anyway, so dropping them early costs nothing).
 */
export const yRoom: Check<MmContext> = (s, c) => {
    const r = yCover(s, c);
    if (r === true) return true;
    const dead = s.inventory.filter(i => EXIT_DROPS.includes(i.id)).length;
    // Sharks count as room as for J's crates (roomWithSharks); after R they are surplus, so Y drops what it needs.
    return roomWithSharks(s) + dead >= yNeed(s) || r;
};

/**
 * Quest items dead after S15, dropped by Z (rs/318's inventory ledger, fold-in 18): the royal seal (never taken back,
 * mm_caranock.rs2 and mm_lumdo.rs2 only show it), the amulet mould (Zooknock returns it) and the sigil.
 */
export const EXIT_DROPS: readonly number[] = [MM_OBJ.royalSeal, MM_OBJ.amuletMould, MM_OBJ.sigil];

/** S15's exit: Daero's training xp, none of EXIT_DROPS held or worn, and the M'speak amulet worn (the ledger's, S15 to H22). */
export const exitState: Check<MmContext> = s => {
    if (skillXp(s, 'Strength') < DAERO_STRENGTH_XP) return `Strength xp ${skillXp(s, 'Strength')} is below Daero's ${DAERO_STRENGTH_XP}`;
    const kept = EXIT_DROPS.filter(id => holds(s, id));
    if (kept.length) return `still holding ${kept.join(', ')} (S15's exit drops)`;
    return wearing(s, MM_OBJ.amulet) || `the M'speak amulet is not worn (the inventory ledger has it worn from S15 to H22)`;
};

/** Drop every held `id` (no-op if none), confirmed from the published inventory. */
async function dropHeld(sdk: Sdk, id: number): Promise<void> {
    for (let i = 0; i < 3 && invCount(sdk, id) > 0; i++) {
        for (const it of sdk.getState()!.inventory.filter(x => x.id === id)) void sdk.sendDropItem(it.slot);
        await waitUntil(sdk, s => invCount(s, id) === 0, { maxTicks: 3 });
    }
    if (invCount(sdk, id) > 0) throw new Error(`could not drop ${id}`);
}

/**
 * Drop EXIT_DROPS, each pass in one tick (a drop is a 0-tick inventory op while the player stands still). The sigil
 * needs a free slot to come off, and the atoll top-ups can leave the pack full at Z, so the pack's drops go first; if
 * the pack is still full, one shark goes too (sigilRoom: HP is at Daero's reward maximum by then). Once the sigil is
 * off, the M'speak amulet goes back on: both are neck items (quest_mm.obj wearpos=front), so the demon fight's sigil
 * pushed it into the pack, and the inventory ledger has it worn, not a pack slot, from S15 to H22.
 */
export async function dropDead(sdk: Sdk, note: (line: string) => void = stepNote): Promise<void> {
    const dropAll = async () => {
        for (let i = 0; i < 3 && EXIT_DROPS.some(id => invCount(sdk, id) > 0); i++) {
            for (const it of sdk.getState()!.inventory.filter(x => EXIT_DROPS.includes(x.id))) void sdk.sendDropItem(it.slot);
            await waitUntil(sdk, s => !EXIT_DROPS.some(id => invCount(s, id) > 0), { maxTicks: 3 });
        }
    };
    await dropAll();
    if (sdk.getState()!.equipment.some(i => i.id === MM_OBJ.sigil)) {
        if (sigilRoom(sdk.getState()!) === 'drop a shark') {
            note(`S15: the pack is full with the sigil worn; a shark dropped for its slot`);
            const shark = sdk.getState()!.inventory.find(i => i.id === MM_OBJ.shark)!;
            void sdk.sendDropItem(shark.slot);
            await waitUntil(sdk, s => freeSlots(s) > 0, { maxTicks: 3 });
        }
        await unwear(sdk, MM_OBJ.sigil);
        await dropAll();
    }
    const left = EXIT_DROPS.filter(id => holds(sdk.getState()!, id));
    if (left.length) throw new Error(`could not drop ${left.join(', ')}`);
    if (invCount(sdk, MM_OBJ.amulet) > 0) {
        const w = await wield(sdk, MM_OBJ.amulet, { maxTicks: 6 });
        if (!w.ok) throw new Error(`the M'speak amulet did not go back on after the sigil: ${w.reason}`);
    }
}

/**
 * How the worn sigil gets its free slot once the pack's EXIT_DROPS are gone: there is one, a shark is dropped for it, or
 * nothing in the pack can go.
 */
export function sigilRoom(s: BotWorldState): 'free' | 'drop a shark' | 'none' {
    if (freeSlots(s) > 0) return 'free';
    return invCount(s, MM_OBJ.shark) > 0 ? 'drop a shark' : 'none';
}

/**
 * The jungle scorpions (mm_jungle_scorpion: Attack and Strength 50 at +100, a 15 max hit; 15 hp, ranged defence 0) wander
 * Crash Island and attack a player standing at a talk. Every NPC melee swing closes the player's chat, hit or miss and
 * under a protect prayer too (npc_combat_melee.rs2 playerhit_n_melee's if_close), so Waydar's 14-page Lumdo order can't
 * finish beside one: a measured death in G, every shark eaten while the talk waited for a cutscene the swing had closed.
 * The island keeps several within ~8 tiles of Waydar, wandering, and G's earlier runs talked beside them unharmed, so
 * only one that is a threat is shot first: within SCORPION_CLOSE, or within SCORPION_REACH with a player targeted (the
 * client packs a player target as index + 32768; a wandering NPC targets nothing).
 */
export const SCORPION_CLOSE = 2;
export const SCORPION_REACH = 8;

export function scorpionsNear(s: BotWorldState): BotWorldState['nearbyNpcs'] {
    const p = pos(s);
    return s.nearbyNpcs.filter(n => {
        if (!/^Scorpion$/i.test(n.name) || n.hp === 0) return false;
        const d = chebyshev({ x: n.tileX ?? n.x, z: n.tileZ ?? n.z }, p);
        return d <= SCORPION_CLOSE || (d <= SCORPION_REACH && n.targetIndex >= 32768);
    });
}

/** Shoot every scorpion that is a threat (scorpionsNear), under Protect from Melee; throws if one still is after 4 fights. */
async function clearScorpions(sdk: Sdk, note: (line: string) => void): Promise<void> {
    await sceneBuilt(sdk); // the glider's landing frame
    for (let i = 0; i < 4; i++) {
        const n = scorpionsNear(sdk.getState()!)[0];
        if (!n) return;
        const f = await praying(sdk, 'protect_from_melee', () =>
            fight(sdk, n, { prayer: 'protect_from_melee', eatBelow: eating.below, food: MM_OBJ.shark, maxTicks: 60, onDialog: 'continue' }),
        );
        note(`S15:G scorpion at ${n.tileX ?? n.x},${n.tileZ ?? n.z}: ${f.end} in ${f.ticks} ticks, taken ${f.taken}`);
    }
    if (scorpionsNear(sdk.getState()!).length) throw new Error(`a scorpion still a threat on Crash Island after 4 fights (at ${where(sdk)})`);
}

/**
 * Waydar's first talk after the flight, watched beside it: a talk that opens on a continue page is his arrival intro
 * (mm_waydar.rs2:65-70, four pages and no state page), over once its dialogue has closed; one that opens on the menu is
 * the Lumdo talk, which this never ends. Judged by the opening page because a burst clears the intro's last page
 * without the client publishing it.
 */
export function waydarIntroWatch(): { see(s: Pick<BotWorldState, 'dialog'>): void; readonly over: boolean } {
    let opened: PageKind | null = null;
    let over = false;
    return {
        see(s) {
            if (s.dialog.isOpen) opened ??= classifyPage(s.dialog);
            else if (opened === 'continue') over = true;
        },
        get over() {
            return over;
        },
    };
}

/** Daero's option 1 grants 35,000 Strength xp (mm_daero.rs2:294-302: stat_advance(strength, 350000), tenths). */
export const DAERO_STRENGTH_XP = 35_000;

const skillXp = (s: BotWorldState, name: string) => s.skills.find(k => k.name === name)?.experience ?? 0;

export const freeSlots = (s: BotWorldState) => 28 - s.inventory.length;

/**
 * Room for each of `ids` not already held: the crates' `inv_add` gives nothing into a full pack (quest_mm.rs2:924-942),
 * and searchCrate eats a shark for room when the pack is full, so a shark held counts as a slot to come.
 */
/** Free slots plus the sharks held: a shark is eaten (J's crates) or dropped (Y's reward) to make room. */
export const roomWithSharks = (s: BotWorldState) => freeSlots(s) + invCount(s, MM_OBJ.shark);

/** How many sharks to drop so `need` slots are free (0 when they already are). */
export function sharksToDrop(s: BotWorldState, need: number): number {
    return Math.min(invCount(s, MM_OBJ.shark), Math.max(0, need - freeSlots(s)));
}

export const roomFor = (...ids: number[]): Check<MmContext> => s => {
    const need = ids.filter(id => !holds(s, id)).length;
    const room = roomWithSharks(s);
    return room >= need || `${need} slots needed, ${freeSlots(s)} free and ${invCount(s, MM_OBJ.shark)} sharks to eat for room`;
};
const all = (...cs: Check<MmContext>[]): Check<MmContext> => (s, c) => {
    for (const f of cs) {
        const r = f(s, c);
        if (r !== true) return r;
    }
    return true;
};
const holding = (...ids: number[]): Check<MmContext> => s => ids.every(id => holds(s, id)) || `missing ${ids.filter(id => !holds(s, id)).join(', ')}`;
const atZooknock: Check<MmContext> = s => (inArea(s, AREAS.dungeon) && chebyshev(pos(s), ZOOKNOCK) <= 4) || `not at Zooknock (at ${JSON.stringify(pos(s))})`;

const BODIES: Partial<Record<string, Body>> = {
    A: {
        preconditions: () => true,
        pre: o => all(
            s => questStatus(s, 'tree') === 'complete' || 'Tree Gnome Village is not complete',
            s => questStatus(s, 'grandtree') === 'complete' || 'The Grand Tree is not complete',
            s => {
                const short = kitMissing(s, o.bow, { served: o.kitServed?.() });
                return !short.length || (!!o.kitFrom && !o.kitServed?.()) || `H12 kit short and ${o.kitFrom ? 'served this attempt' : 'no kitFrom'}: ${kitText(short)}`;
            },
            // Started and the seal gone is A's to mend only before Caranock: from B on Narnode reports, not re-issues.
            s => mmMilestone(s) < seg('B') || 'S15 is past B: Narnode no longer re-issues the royal seal',
            // The seal's room is judged here only when no swap will change the pack; otherwise run judges it after the swap.
            s => kitMissing(s, o.bow, { served: o.kitServed?.() }).length > 0 || typeof narnodeTalk(s) !== 'string' || (narnodeTalk(s) as string),
            s => (inGrandTree(s) && pos(s).level === 0) || chebyshev(pos(s), TREE_DOOR_OUTSIDE) <= 10 || `not at the Grand Tree (at ${JSON.stringify(pos(s))})`,
        ),
        async run(ctx, o) {
            const { sdk } = ctx;
            await gtSwap(ctx, o);
            await preDose(sdk);
            const talk = narnodeTalk(sdk.getState()!);
            if (typeof talk === 'string') throw new Error(talk);
            await intoTree(ctx, 0);
            if (talk?.start) {
                // "Start Monkey Madness?" Yes (mm_narnode.rs2:124-140): the story, the seal and its objbox, the chapter card.
                const r = await talkTo(sdk, NARNODE_NPC, talk.choices, { maxTicks: 200, idle: 4, near: NARNODE, closeModals: true, until: s => holds(s, MM_OBJ.royalSeal), ...shaped(MM_SHAPES.narnodeStart) });
                noteShape('A Narnode', r);
                if (!holds(sdk.getState()!, MM_OBJ.royalSeal)) throw new Error(`no royal seal from Narnode: ${r.reason ?? r.transcript.slice(-2).join(' / ')}`);
                await dismiss(sdk);
            } else if (talk) {
                const r = await talkTo(sdk, NARNODE_NPC, talk.choices, { maxTicks: 120, idle: 4, near: NARNODE, closeModals: true, ...shaped(MM_SHAPES.narnodeSpareSeal) });
                noteShape('A Narnode spare seal', r);
                stepNote(`S15:A Narnode's spare seal: ${holds(sdk.getState()!, MM_OBJ.royalSeal) ? 'held' : 'NOT held'} after ${r.ticks} ticks, ${r.pages} pages`);
                if (!holds(sdk.getState()!, MM_OBJ.royalSeal)) throw new Error(`no spare royal seal from Narnode: ${r.reason ?? r.transcript.slice(-2).join(' / ')}`);
            }
        },
        postconditions: holding(MM_OBJ.royalSeal),
    },
    B: {
        preconditions: all(holding(MM_OBJ.royalSeal), s => inGrandTree(s) || s.player !== null && pos(s).z < 3100 || 'not in the Grand Tree or on Karamja'),
        async run(ctx) {
            const { sdk } = ctx;
            if (inGrandTree(sdk)) {
                await intoTree(ctx, 3);
                await glideTo(sdk, 'gandius');
            }
            // The shipyard's west gate: at mm_main started its worker's pages end with the seal shown, mm_main to
            // shown_seal and the gate opened (quest_grandtree.rs2 _shipyard_gate, mm_caranock.rs2:45-61). The glider
            // lands south of the yard, east of the gate, so the gate is taken unless the player is already inside.
            if (!inShipyard(sdk)) {
                await go(ctx, SHIPYARD_GATE_FOOT, 1);
                const g = await actConverse(sdk, await locClick(sdk, SHIPYARD_GATE, /^open$/i), [], { done: s => pos(s).x >= SHIPYARD_GATE.x, maxTicks: 90, idle: 8, resendEvery: 10, ...shaped(MM_SHAPES.shipyardGate) });
                noteShape('B shipyard gate', g.dialogue);
                if (pos(sdk).x < SHIPYARD_GATE.x) throw new Error(`the shipyard gate did not open: ${g.reason} (at ${where(sdk)})`);
            }
            await go(ctx, CARANOCK, 1);
            await talk(sdk, /Caranock$/i, [], { near: CARANOCK, minPages: 6, shape: MM_SHAPES.caranock });
            // The seal's last use was the gate: only the shipyard worker needs it (mm_caranock.rs2:50), and Lumdo's
            // no-seal branch at G ends the same way (mm_lumdo.rs2:39-47). Its slot goes to a shark from here on.
            await dropHeld(sdk, MM_OBJ.royalSeal);
        },
    },
    C: {
        preconditions: s => inGrandTree(s) || (s.player !== null && pos(s).z < 3100) || 'not in the Grand Tree or on Karamja',
        async run(ctx) {
            const { sdk } = ctx;
            if (!inGrandTree(sdk)) {
                await go(ctx, GANDIUS_PILOT, 2);
                await glideTo(sdk, 'ta_quir_priw');
            }
            await intoTree(ctx, 0);
            // The report; Narnode writes the orders behind a p_delay(3) (mm_narnode.rs2 p4-p6).
            const r = await talkTo(sdk, NARNODE_NPC, [], { maxTicks: 200, idle: 6, near: NARNODE, closeModals: true, until: s => holds(s, MM_OBJ.orders), ...shaped(MM_SHAPES.narnodeOrders) });
            noteShape('C Narnode', r);
            if (!holds(sdk.getState()!, MM_OBJ.orders)) throw new Error(`no orders from Narnode: ${r.reason ?? r.transcript.slice(-2).join(' / ')}`);
            await dismiss(sdk);
        },
        postconditions: holding(MM_OBJ.orders),
    },
    D: {
        preconditions: s => holds(s, MM_OBJ.orders) || inArea(s, OLD_HANGAR) || 'no orders for Daero',
        async run(ctx) {
            const { sdk } = ctx;
            if (inArea(sdk, OLD_HANGAR)) return;
            await intoTree(ctx, 1);
            if (chebyshev(pos(sdk), DAERO) > 3) await go(ctx, DAERO, 2);
            // The orders, the decode (p_delay 3), then "Leave" only after all three topics were opened (mm_daero.rs2:129-133).
            const r = await talkTo(sdk, /^Daero$/i, [/journey/i, /Return to previous/i, /10th squad/i, /Return to previous/i, /Caranock/i, /Return to previous/i, /^Leave/i, /Who is it/i], {
                maxTicks: 300, idle: 8, near: DAERO, closeModals: true, until: s => inArea(s, OLD_HANGAR), ...shaped(MM_SHAPES.daeroOrders),
            });
            noteShape('D Daero', r);
            if (!inArea(sdk, OLD_HANGAR)) throw new Error(`Daero did not take the player to the hangar: ${r.reason ?? r.transcript.slice(-2).join(' / ')}`);
            await dismiss(sdk);
        },
        postconditions: s => inArea(s, OLD_HANGAR) || 'not in the hangar',
    },
    E: {
        preconditions: s => inArea(s, OLD_HANGAR) || inArea(s, HANGAR) || 'not in the hangar',
        inProgress: o => !!journalText(o, 'mm')?.includes(REINIT_PENDING),
        async run(ctx, o) {
            const { sdk } = ctx;
            if (inArea(sdk, HANGAR)) return;
            // Daero introduces Waydar (mm_daero.rs2 daero_left_grandtree): mm_daero to started_reinit. Once said, he
            // answers with a menu instead, so the talk is skipped when the reinitialisation line is in the journal.
            const journal = journalText(sdk.getState()!, 'mm');
            if (!journal?.includes(REINIT_PENDING)) {
                await talk(sdk, /^Daero$/i, [], { minPages: 10, idle: 4, shape: MM_SHAPES.daeroWaydar });
                await dismiss(sdk);
            }
            const panel = await findLoc(sdk, { name: /reinitialisation panel/i, radius: 20 });
            if (!panel) throw new Error(`no Reinitialisation Panel near ${where(sdk)}`);
            const op = panel.optionsWithIndex.find(x => /operate/i.test(x.text))?.opIndex ?? 1;
            const open = await act(sdk, () => sdk.sendInteractLoc(panel.x, panel.z, panel.id, op), s => !!s.interface.inventories?.some(i => i.componentId === PUZZLE_COMPONENT), { resendEvery: 8, maxTicks: 40 });
            if (!open.ok) throw new Error(`the panel did not open (at ${where(sdk)})`);
            // 5 clicks a tick: 9 of 9 scrambles solved, 11-17 ticks (lab/measure-mm-puzzle.ts).
            const p = await solveOnPanel(sdk, { componentId: PUZZLE_COMPONENT, tileIds: PUZZLE_TILE_IDS, perTick: 5 });
            o.note(`S15:E puzzle: ${p.planned} moves planned, ${p.moves} sent, ${p.solves} solves, ${p.ticks} ticks`);
            // The rumble and the hangar cutscene, then the powered hangar (about 20 ticks, measured).
            const r = await waitUntil(sdk, s => pos(s).level === 0 && chebyshev(pos(s), POWERED) <= 4, { maxTicks: 90 });
            if (!r.ok) throw new Error(`no powered hangar after the puzzle (at ${where(sdk)})`);
            await dismiss(sdk);
        },
        postconditions: s => inArea(s, HANGAR) || 'not in the powered hangar',
    },
    F: {
        preconditions: s => inArea(s, HANGAR) || inArea(s, CRASH_ISLAND) || 'not in the powered hangar',
        async run(ctx) {
            const { sdk } = ctx;
            if (inArea(sdk, CRASH_ISLAND)) return;
            if (chebyshev(pos(sdk), DAERO_HANGAR) > 3) await go(ctx, DAERO_HANGAR, 1);
            // Daero at reinit_complete orders Waydar to fly (mm_daero.rs2:30-42): mm_daero to daero_complete.
            const d = await talkTo(sdk, /^Daero$/i, [], { maxTicks: 120, idle: 4, near: DAERO_HANGAR, ...shaped(MM_SHAPES.daeroReinit) });
            noteShape('F Daero', d);
            if (!d.ok) throw new Error(`Daero: ${d.reason}`);
            const r = await talkTo(sdk, /^Waydar$/i, [/^Yes$/], { maxTicks: 120, idle: 4, closeModals: false, until: s => inArea(s, CRASH_ISLAND), ...shaped(MM_SHAPES.waydarFly) });
            noteShape('F Waydar', r);
            if (!inArea(sdk, CRASH_ISLAND)) throw new Error(`Waydar did not fly to Crash Island: ${r.reason ?? r.transcript.slice(-2).join(' / ')}`);
        },
        postconditions: s => inArea(s, CRASH_ISLAND) || 'not on Crash Island',
    },
    G: {
        // clearScorpions fights whatever scorpion threatens SCORED before Lumdo's talk.
        startsInCombat: true,
        preconditions: s => inArea(s, CRASH_ISLAND) || inArea(s, AREAS.atoll) || 'not on Crash Island',
        async run(ctx, o) {
            const { sdk } = ctx;
            if (inArea(sdk, AREAS.atoll)) return;
            // Lumdo (no choices): proof by the seal, then he won't take the player (mm_lumdo.rs2:32-75).
            await clearScorpions(sdk, o.note);
            const l = await talkTo(sdk, /^Lumdo$/i, [], { maxTicks: 120, idle: 3, ...shaped(lumdoRefuses(holds(sdk.getState()!, MM_OBJ.royalSeal))) });
            noteShape('G Lumdo', l);
            if (!l.ok) throw new Error(`Lumdo: ${l.reason}`);
            // Waydar orders Lumdo (within 10 tiles), then the chapter 2 cutscene, which ends on the atoll (mm_waydar.rs2:54-82).
            const onAtoll = (s: BotWorldState) => inArea(s, AREAS.atoll) && pos(s).level === 0;
            // The flight leaves mm_waydar at 0, so the first talk is his 4-page arrival intro (mm_waydar.rs2:65-70), which
            // sets it to arrived; only the next talk offers the Lumdo option. converse's `until` sees closed states only, so
            // the intro is watched beside the talk (waydarIntroWatch), and the talk ends as soon as it has closed. A hit
            // taken ends it too (a swing closed the chat): the scorpions are cleared and the talk is asked again. The talk's
            // shape is the intro's until an intro has been seen to close, then the Lumdo order's.
            // The order to Lumdo and the cutscene play only with Lumdo within 10 tiles of the player (mm_waydar.rs2:82);
            // his distance when the menu shows is noted.
            let introDone = false;
            for (let i = 0; i < 4 && !onAtoll(sdk.getState()!); i++) {
                await clearScorpions(sdk, o.note);
                const intro = waydarIntroWatch();
                let menuSeen = false;
                let struck = false;
                const t0 = sdk.getState()!.tick;
                const unwatch = sdk.onStateUpdate(s => {
                    intro.see(s);
                    if (s.combatEvents.some(e => e.type === 'damage_taken' && e.tick > t0)) struck = true;
                    if (!menuSeen && classifyPage(s.dialog) === 'choice') {
                        menuSeen = true;
                        const lumdo = s.nearbyNpcs.find(n => /^Lumdo$/i.test(n.name));
                        o.note(`S15:G Waydar's menu at t=${s.tick}: Lumdo ${lumdo ? `${chebyshev({ x: lumdo.tileX ?? lumdo.x, z: lumdo.tileZ ?? lumdo.z }, pos(s))} tiles away` : 'not in view'} (the cutscene needs 10 or less)`);
                    }
                });
                try {
                    // The arrival intro first, then the talk with the cutscene; on a resume past the intro the first talk
                    // leaves the intro's shape at its opening choice and goes a page per tick.
                    const w = await talkTo(sdk, /^Waydar$/i, [/cannot convince Lumdo/i], {
                        maxTicks: 400, idle: 3, closeModals: true, until: s => onAtoll(s) || intro.over || struck, ...shaped(introDone ? MM_SHAPES.waydarLumdo : MM_SHAPES.waydarIntro),
                    });
                    if (intro.over) introDone = true;
                    noteShape(`G Waydar (talk ${i + 1})`, w);
                    o.note(`S15:G Waydar: ${w.pages} pages, ${w.ticks} ticks${intro.over ? ' (arrival intro)' : ''}${struck ? ' (struck)' : ''}${onAtoll(sdk.getState()!) ? ', on the atoll' : ''}`);
                } finally {
                    unwatch();
                }
            }
            if (!onAtoll(sdk.getState()!)) throw new Error(`not on the atoll after the chapter 2 cutscene (at ${where(sdk)})`);
            const card = await waitUntil(sdk, s => s.modalOpen, { maxTicks: 4 });
            if (card.ok) await sdk.sendCloseModal();
            await dismiss(sdk);
        },
        postconditions: onAtoll,
    },
    H: {
        preconditions: all(onAtoll, human),
        run: ctx => upkeep(ctx.sdk, () => toTown(ctx)),
        postconditions: inTown,
    },
    I: {
        preconditions: all(onAtoll, human),
        async run(ctx) {
            await upkeep(ctx.sdk, () => jailSafe(ctx.sdk, async () => {
                await toTown(ctx);
                await townGo(ctx, GARKOR, 1, GARKOR_NORTH);
                // 25 pages, no choice (mm_garkor.rs2:95-126): garkor 0 -> 2.
                await talk(ctx.sdk, /garkor/i, [], { near: GARKOR, minPages: 20, shape: MM_SHAPES.garkorFirst });
            }));
        },
    },
    J: {
        preconditions: all(onAtoll, human, roomFor(MM_OBJ.dentures, MM_OBJ.amuletMould)),
        async run(ctx, o) {
            const { sdk } = ctx;
            await upkeep(sdk, () => jailSafe(sdk, async () => {
                await toTown(ctx);
                const zone = sleepingZoneWatch(sdk);
                try {
                    const toCrate = async (to: { x: number; z: number }) => {
                        if (!inCrateBuilding(sdk)) {
                            // The last stretch by click, at tolerance 0: an SDK walk's sends were still arriving after the
                            // door had moved the player in, and walked them back out (exec 8's J trace, t 96-100).
                            await townGo(ctx, CRATE_DOOR_OUTSIDE, 0, [CRATES_FROM_GARKOR, CRATES], { click: true });
                            // An eat cancels the op (upkeep ate twice at the door in the same trace), so it re-sends every 3.
                            const d = await opLoc(sdk, { ...CRATE_DOOR, op: /^open$/i, radius: 3 }, /^open$/i, s => inCrateBuilding(s) || inCell(s), { resendEvery: 3, maxTicks: 24 });
                            if (inCell(sdk)) throw new Error('knocked out at the crate building\'s south door');
                            if (!d.ok) throw new Error(`the crate building's south door did not take the player in (at ${where(sdk)})`);
                        }
                        zone.check();
                        for (const t of crateSteps(pos(sdk), crateRoute(pos(sdk), to))) {
                            if (!(await click(sdk, t, 0))) throw new Error(`knocked out stepping to ${t.x},${t.z} in the crate building`);
                            zone.check();
                        }
                    };
                    if (!holds(sdk.getState()!, MM_OBJ.dentures)) {
                        await toCrate(DENTURES_EAST);
                        await searchCrate(sdk, DENTURE_CRATE, /^Yes$/, s => holds(s, MM_OBJ.dentures), 'denture crate', MM_SHAPES.dentureCrate, o.note);
                        zone.check();
                    }
                    if (!inArea(sdk, AREAS.cellar)) {
                        await toCrate({ x: HOLE_CRATE.x, z: HOLE_CRATE.z + 1 });
                        await searchCrate(sdk, HOLE_CRATE, /Yes, I'm sure/, s => inArea(s, AREAS.cellar), 'crate over the hole', MM_SHAPES.holeCrate, o.note);
                    }
                } finally {
                    zone.stop();
                }
                if (!holds(sdk.getState()!, MM_OBJ.amuletMould)) {
                    await go(ctx, { x: MOULD_CRATE.x, z: MOULD_CRATE.z - 1 }, 1);
                    await searchCrate(sdk, MOULD_CRATE, /^Yes$/, s => holds(s, MM_OBJ.amuletMould), 'mould crate', MM_SHAPES.mouldCrate, o.note);
                }
                await go(ctx, { x: WEST_ROPE.x, z: WEST_ROPE.z + 1 }, 1);
                await climb(sdk, WEST_ROPE);
            }));
        },
        postconditions: all(holding(MM_OBJ.dentures, MM_OBJ.amuletMould), s => inArea(s, AREAS.westWarehouse) || `not at the western rope's top (at ${JSON.stringify(pos(s))})`),
    },
    K: {
        preconditions: all(holding(MM_OBJ.dentures, MM_OBJ.amuletMould), s => inArea(s, AREAS.atoll) || inArea(s, AREAS.dungeon) || 'not on the atoll or in its dungeon'),
        run: ctx => toZooknock(ctx),
        postconditions: atZooknock,
    },
    X: {
        // demonFight skips the sigil off the arena and fights the demon in view: a takeover mid-fight re-enters through run.
        startsInCombat: true,
        preconditions: () => true,
        pre: o => all(holding(MM_OBJ.sigil, o.bow), s => invCount(s, MM_OBJ.runeArrow) > 0 || s.equipment.some(i => i.id === MM_OBJ.runeArrow) || 'no rune arrows', prayerCovers('S15:X for the Jungle Demon', X_PRAYER)),
        async run(ctx, o) {
            await drinkPrayerTo(ctx.sdk, DRINK_BELOW);
            await demonFight(ctx, o.note, o.bow);
        },
    },
    P: {
        preconditions: all(human, holding(MM_OBJ.talisman, MM_OBJ.monkeyBones), s => inArea(s, AREAS.atoll) || inArea(s, AREAS.dungeon) || 'not on the atoll or in its dungeon'),
        run: (ctx, o) => withTopUps(() => pFinalStop(ctx.sdk, o.topUpFrom, () => toZooknock(ctx, o.topUpFrom))),
        postconditions: atZooknock,
    },
    L: {
        preconditions: all(s => inArea(s, AREAS.dungeon) || 'not in the dungeon', s => holds(s, MM_OBJ.dentures) || holds(s, MM_OBJ.amuletMould) || 'no dentures or mould'),
        async run(ctx) {
            const { sdk } = ctx;
            if (chebyshev(pos(sdk), ZOOKNOCK) > 3) await upkeep(sdk, () => go(ctx, ZOOKNOCK, 2));
            // The story to need_items (mm_zooknock.rs2:28-37, 304-345), then the amulet's list and back out (259-280).
            await talk(sdk, /zooknock/i, [/What do we need for the monkey amulet\?/, /I'll be back later/], { near: ZOOKNOCK, minPages: 4, shape: MM_SHAPES.zooknockStory });
            const bar: Pred = s => holds(s, MM_OBJ.enchantedBar);
            for (const [id, shape] of [[MM_OBJ.dentures, MM_SHAPES.zooknockDentures], [MM_OBJ.goldBar, MM_SHAPES.zooknockGoldBar]] as const) {
                const n = invCount(sdk, id);
                if (n > 0) await useOnNpc(sdk, id, /zooknock/i, s => invCount(s, id) < n || bar(s), shape);
            }
            // The last item completes the amulet check: four pages, a p_delay(4), then the enchanted bar and the mould back (mm_zooknock.rs2:186-197).
            if (!bar(sdk.getState()!)) await useOnNpc(sdk, MM_OBJ.amuletMould, /zooknock/i, bar, MM_SHAPES.zooknockMould, 6);
            await dismiss(sdk);
        },
        postconditions: holding(MM_OBJ.enchantedBar, MM_OBJ.amuletMould),
    },
    N: {
        preconditions: all(s => inArea(s, AREAS.atoll) || underTemple(s) || `not on Ape Atoll's surface or under the temple (at ${JSON.stringify(pos(s))})`, human,
            holding(MM_OBJ.enchantedBar, MM_OBJ.amuletMould, MM_OBJ.ballOfWool)),
        async run(ctx, o) {
            const { sdk } = ctx;
            await upkeep(sdk, async () => {
                if (!underTemple(sdk)) {
                    await jailSafe(sdk, async () => {
                        await toTown(ctx);
                        // Under the zone prayer to the ladder's foot, beside the guard at (2795,2775): the walk's last run
                        // is Melee and stays on into the trapdoor's own block, so no hand-over leaves an unprayed tick
                        // there (gate chain b: 7 + 12).
                        if (o.templeMethod !== 'wait' && pos(sdk).level === 0 && chebyshev(pos(sdk), TRAPDOOR_ACCESS) > 0) {
                            await townGo(ctx, TEMPLE_LADDER_FOOT, 0, [], { keep: true });
                        }
                    });
                }
                // Trapdoor guards above; zombie monkeys round the landing and beside both fires below (maps/m43_143.jm2), all melee.
                const out = await praying(sdk, 'protect_from_melee', async () => {
                    if (!underTemple(sdk)) await trapdoor(ctx, o.templeMethod);
                    const st = () => sdk.getState()!;
                    if (holds(st(), MM_OBJ.enchantedBar)) {
                        // Measured: the wall at (2811,9208), the nearest to the landing, takes it from (2810,9208) (lab/measure-mm-fire.ts).
                        // An eat on the way cancels the use, so it is re-sent while nothing happens; there is one bar, and done ends it.
                        const fire = await nearestFire(sdk);
                        const r = await useOn(sdk, MM_OBJ.enchantedBar, { loc: fire }, s => holds(s, MM_OBJ.amuletUnstrung), { maxTicks: 30, resendEvery: 4, maxResends: 5 });
                        if (!r.ok) throw new Error(`enchanted bar on the fire: ${r.reason} (at ${where(sdk)})`);
                    }
                    await dismiss(sdk); // the Crafting level-up
                    if (holds(st(), MM_OBJ.amuletUnstrung)) {
                        const r = await useOn(sdk, MM_OBJ.ballOfWool, { item: MM_OBJ.amuletUnstrung }, s => holds(s, MM_OBJ.amulet), { maxTicks: 10, resendEvery: 3, maxResends: 3 });
                        if (!r.ok) throw new Error(`wool on the amulet: ${r.reason}`);
                    }
                    await ropeUp(sdk);
                    // templeOut inside the same prayer: turned off and on again between them, the trapdoor guards' 13 in
                    // the one unprayed tick took chain 1 from 23 HP to 10.
                    return templeOut(ctx);
                });
                o.note(`S15:N temple guards held the player ${out.pinned} ticks after the rope${out.escaped ? '; teleported to Varrock, O takes the way back' : ''}`);
                // The approach turned it on before the trapdoor's own block, which therefore leaves it on.
                if (prayerActive(sdk.getState()!, 'protect_from_melee')) await setPrayer(sdk, 'protect_from_melee', false);
            });
        },
        postconditions: all(holding(MM_OBJ.amulet), templeLeft),
    },
    O: {
        preconditions: all(onAtollOrAway, human, s => holds(s, MM_OBJ.amulet) || 'no strung amulet',
            s => {
                if (holds(s, MM_OBJ.talisman)) return true;
                try {
                    bananaRoomDrops(s);
                    return true;
                } catch (e) {
                    return (e as Error).message;
                }
            }),
        async run(ctx, o) {
            const { sdk } = ctx;
            const progress: ChildProgress = { talks: 0 };
            await withTopUps(() => upkeep(sdk, () => jailSafe(sdk, async () => {
                if (!offAtoll(sdk)) await templeOut(ctx);
                if (offAtoll(sdk)) await wayBack(ctx, o.note);
                await toTown(ctx);
                const w = await wield(sdk, MM_OBJ.amulet);
                if (!w.ok) throw new Error(`the amulet did not go on: ${w.reason}`);
                // The zone prayer by location (rs/158 and main, 10-22 14:1x): Missiles on the walks, Melee standing and
                // talking in the aunt's box. O ends on the wait tile with Melee on, so P's start has no unprayed tick.
                await childTalks(ctx, o.note, progress);
            })));
        },
        postconditions: holding(MM_OBJ.talisman),
    },
    Q: {
        // Zooknock's dungeon is full of aggressive undead and Q's walk and talk run under Protect from Melee: a
        // takeover there re-enters through run, never a hold that refuses on the first swing (rs/185).
        startsInCombat: true,
        preconditions: all(human, s => inArea(s, AREAS.dungeon) || 'not in the dungeon', s => holds(s, MM_OBJ.greegree) || (holds(s, MM_OBJ.talisman) && holds(s, MM_OBJ.monkeyBones)) || 'no talisman and bones'),
        async run(ctx, o) {
            const { sdk } = ctx;
            await upkeep(sdk, async () => {
                const gree: Pred = s => holds(s, MM_OBJ.greegree);
                if (!gree(sdk.getState()!)) {
                    if (chebyshev(pos(sdk), ZOOKNOCK) > 3) await praying(sdk, 'protect_from_melee', () => go(ctx, ZOOKNOCK, 2));
                    // The talisman, then the bones, which complete the talisman check: one page, a p_delay(4), the
                    // gree-gree, an objbox and three pages, with the chapter 3 cutscene queued (mm_zooknock.rs2:203-228).
                    for (const [id, shape] of [[MM_OBJ.talisman, MM_SHAPES.zooknockTalisman], [MM_OBJ.monkeyBones, MM_SHAPES.zooknockBones]] as const) {
                        const n = invCount(sdk, id);
                        if (n > 0 && !gree(sdk.getState()!)) await useOnNpc(sdk, id, /zooknock/i, s => invCount(s, id) < n || gree(s), shape, 6);
                    }
                    const w = await waitUntil(sdk, gree, { maxTicks: 15 });
                    if (!w.ok) throw new Error('Zooknock gave no gree-gree for the talisman and bones');
                }
                if (!inArea(sdk, AREAS.dungeon) || sdk.getState()!.dialog.isOpen) {
                    const pages = await chapterCutscene(sdk, 0, 'chapter 3', MM_SHAPES.chapter3);
                    o.note(`S15:Q chapter 3: ${pages} pages`);
                } else {
                    // Still beside Zooknock with the gree-gree: the cutscene is queued behind the closing pages, or done.
                    const started = await waitUntil(sdk, s => s.dialog.isOpen || tileIn(pos(s), { ...CUTSCENE_ZONE, level: 0 }), { maxTicks: 8 });
                    if (started.ok) o.note(`S15:Q chapter 3: ${await chapterCutscene(sdk, 0, 'chapter 3', MM_SHAPES.chapter3)} pages`);
                }
            });
        },
        postconditions: all(holding(MM_OBJ.greegree), s => inArea(s, AREAS.dungeon) || `not back beside Zooknock after the chapter 3 cutscene (at ${JSON.stringify(pos(s))})`),
    },
    R: {
        preconditions: all(holding(MM_OBJ.greegree, MM_OBJ.amulet), s => inArea(s, AREAS.dungeon) || inArea(s, AREAS.atoll) || 'not on the atoll or in its dungeon'),
        async run(ctx) {
            const { sdk } = ctx;
            await upkeep(sdk, async () => {
                // The dungeon is inside the gree-gree zone (quest_mm.rs2:1102-1108), and a monkey is never jailed.
                await asMonkey(sdk);
                if (inArea(sdk, AREAS.dungeon)) {
                    await immune(sdk, 'the dungeon (R)');
                    await praying(sdk, 'protect_from_melee', () => go(ctx, { x: DUNGEON_EXIT.x, z: DUNGEON_EXIT.z + 1 }, 1));
                    await climb(sdk, DUNGEON_EXIT);
                }
                if (outsideTown(sdk)) await throughWestGate(ctx);
                await go(ctx, GARKOR_NORTH.points[0]!, 2);
                // Garkor with the Karamja gree-gree worn: 3 pages, then seek_alliance's 2 (mm_garkor.rs2:61-74, 129-140).
                await talk(sdk, /garkor/i, [], { near: GARKOR, minPages: 4, shape: MM_SHAPES.garkorAlliance });
            });
        },
        postconditions: s => wearing(s, MM_OBJ.greegree) || 'not a monkey',
    },
    S: {
        preconditions: all(onAtoll, s => wearing(s, MM_OBJ.greegree) || 'not a monkey', s => wearing(s, MM_OBJ.amulet) || 'the amulet is not worn'),
        async run(ctx) {
            const { sdk } = ctx;
            await upkeep(sdk, async () => {
                // Elder Guard 2 from his south side (5 pages; elder_guard 1), Kruk at the west gate (6 pages, then his
                // escort to the throne room, mm_kruk.rs2:24-34), and Awowogei's mission (20 pages; awowogei 1).
                await go(ctx, ELDER_GUARD_SOUTH, 0);
                await talk(sdk, /^Elder Guard$/i, [], { near: ELDER_GUARD, minPages: 4, shape: MM_SHAPES.elderGuardFirst });
                await go(ctx, WATCHTOWER_WEST, 1);
                // Measured: the base ladder takes the player straight to the bridge (level 2).
                for (let i = 0; i < 2 && pos(sdk).level < 2; i++) await climb(sdk, WATCHTOWER_WEST, /^climb-up$/i);
                await go(ctx, BRIDGE_EAST_END, 0);
                for (let i = 0; i < 2 && pos(sdk).level > 0; i++) await climb(sdk, WATCHTOWER_EAST, /^climb-down$/i);
                const escorted = (s: BotWorldState) => chebyshev(pos(s), THRONE) <= 4;
                const k = await talkTo(sdk, /^Kruk$/i, [], { maxTicks: 120, idle: 6, until: escorted, near: KRUK, ...shaped(MM_SHAPES.kruk) });
                noteShape('S Kruk', k);
                if (!escorted(sdk.getState()!)) throw new Error(`Kruk did not escort the player: ${k.reason ?? k.transcript.slice(-2).join(' / ')} (at ${where(sdk)})`);
                await dismiss(sdk);
                const r = await actConverse(sdk, await locClick(sdk, THRONE, /./), [], { maxTicks: 120, idle: 3, resendEvery: 6, ...shaped(MM_SHAPES.awowogeiMission) });
                noteShape('S Awowogei', r.dialogue);
                if (!r.ok || (r.dialogue?.pages ?? 0) < 15) {
                    const d = r.dialogue;
                    throw new Error(`Awowogei: ${r.reason ?? `${d?.pages ?? 0} pages`} after ${r.ticks} ticks, ${r.resends} resends; dialogue ${d ? `opened ${d.opened}, ${d.pages} pages, ${d.transcript.slice(-3).join(' / ')}` : 'not run'} (at ${where(sdk)})`);
                }
            });
        },
        postconditions: s => chebyshev(pos(s), THRONE) <= 6 || 'not beside the throne',
    },
    T: {
        preconditions: all(holding(MM_OBJ.greegree), s => wearing(s, MM_OBJ.amulet) || 'the amulet is not worn',
            s => holds(s, MM_OBJ.monkey) || inArea(s, ZOO) || (teleportRefusal(s, 'ardougne') ?? true)),
        async run(ctx) {
            const { sdk } = ctx;
            const st = () => sdk.getState()!;
            if (!holds(st(), MM_OBJ.monkey)) {
                if (!inArea(sdk, ZOO)) {
                    // A worn gree-gree hides the magic tab (quest_mm.rs2 mm_greegree_transmogrify: if_settab(null,
                    // ^tab_magic)), and the server drops every spell click with no message: measured, both Ardougne and
                    // Varrock casts as a monkey timed out, and the same cast as a human landed in 4 ticks. No monkey is
                    // carried yet, so the teleport loses nothing.
                    await unwear(sdk, MM_OBJ.greegree);
                    const t = await teleport(sdk, 'ardougne');
                    if (!t.ok) throw new Error(`the Ardougne teleport: ${t.reason}`);
                    await go(ctx, ZOO_EAST, 1);
                }
                if (!inCage(sdk)) {
                    // As a Karamja monkey, the minder puts the player in the cage (mm_monkey_minder.rs2:28-50).
                    await asMonkey(sdk);
                    const r = await talkTo(sdk, MINDER, [], { maxTicks: 120, idle: 6, until: inCage, ...shaped(MM_SHAPES.minderIn) });
                    noteShape('T minder (in)', r);
                    if (!inCage(sdk)) throw new Error(`the minder did not cage the monkey: ${r.reason ?? r.transcript.slice(-2).join(' / ')} (at ${where(sdk)})`);
                }
                // 18 pages, no choice; the amulet is all it needs (mm_zoo_monkey.rs2:1-35).
                await sceneBuilt(sdk); // the minder's telejump into the cage
                const zooMonkey = talkableNpc(st(), /^Monkey$/, CAGE_ENTRY);
                if (!zooMonkey) throw new Error(`no monkey to talk to in the cage (at ${where(sdk)})`);
                const m = await talkTo(sdk, zooMonkey, [], { maxTicks: 120, idle: 3, until: s => holds(s, MM_OBJ.monkey), ...shaped(MM_SHAPES.zooMonkey) });
                noteShape('T zoo monkey', m);
                if (!holds(st(), MM_OBJ.monkey)) throw new Error(`no monkey in the backpack: ${m.reason ?? m.transcript.slice(-2).join(' / ')}`);
            }
            if (inCage(sdk)) await letOut(ctx);
            await dismiss(sdk);
        },
        postconditions: all(holding(MM_OBJ.monkey, MM_OBJ.greegree), s => !inCage(s) || 'still in the cage'),
    },
    U: {
        preconditions: all(holding(MM_OBJ.monkey, MM_OBJ.greegree), s => wearing(s, MM_OBJ.amulet) || 'the amulet is not worn'),
        async run(ctx) {
            const { sdk } = ctx;
            // A re-run after T threw in the cage enters here: the monkey held proves T done (itemMilestone).
            if (inCage(sdk)) await letOut(ctx);
            await hangarRoute(ctx, () => zooToDaero(ctx));
            await upkeep(sdk, async () => {
                await asMonkey(sdk);
                if (outsideTown(sdk)) await throughWestGate(ctx);
            });
        },
        postconditions: all(holding(MM_OBJ.monkey), s => wearing(s, MM_OBJ.greegree) || 'not a monkey', inTown),
    },
    V: {
        preconditions: all(onAtoll, holding(MM_OBJ.monkey), s => wearing(s, MM_OBJ.greegree) || 'not a monkey', s => wearing(s, MM_OBJ.amulet) || 'the amulet is not worn'),
        async run(ctx) {
            const { sdk } = ctx;
            await upkeep(sdk, async () => {
                if (!inThroneRoom(sdk)) {
                    // Elder Guard 2 from his south side: at kruk_spoken he lets the player straight in (mm_elder_guard.rs2:27-40).
                    await go(ctx, ELDER_GUARD_SOUTH, 0);
                    const g = await talkTo(sdk, /^Elder Guard$/i, [], { maxTicks: 60, idle: 3, near: ELDER_GUARD, until: inThroneRoom, ...CHATTER, ...shaped(MM_SHAPES.elderGuardIn) });
                    noteShape('V Elder Guard', g);
                    if (!inThroneRoom(sdk)) throw new Error(`the Elder Guard did not let the player in: ${g.reason ?? g.transcript.slice(-2).join(' / ')} (at ${where(sdk)})`);
                }
                // "Have you brought with you a captive?" Yes: the monkey goes, then mm_awowogei_success's 7 pages (mm_awowogei.rs2:40-50, 105-116).
                const r = await actConverse(sdk, await locClick(sdk, THRONE, /./), [], { maxTicks: 90, idle: 3, resendEvery: 6, ...CHATTER, ...shaped(MM_SHAPES.awowogeiCaptive) });
                noteShape('V Awowogei', r.dialogue);
                if (holds(sdk.getState()!, MM_OBJ.monkey)) throw new Error(`Awowogei did not take the monkey: ${r.reason ?? `${r.dialogue?.pages ?? 0} pages`} (at ${where(sdk)})`);
                await dismiss(sdk);
            });
        },
        postconditions: s => !holds(s, MM_OBJ.monkey) || 'the monkey is still in the backpack',
    },
    W: {
        preconditions: all(onAtoll, s => wearing(s, MM_OBJ.greegree) || 'not a monkey', s => wearing(s, MM_OBJ.amulet) || 'the amulet is not worn'),
        async run(ctx, o) {
            const { sdk } = ctx;
            await upkeep(sdk, async () => {
                if (holds(sdk.getState()!, MM_OBJ.sigil)) return;
                if (inThroneRoom(sdk)) {
                    // From inside, Elder Guard 2 shows the player out 3 tiles south (mm_elder_guard.rs2:19-25). Measured: from
                    // deeper in the hall the server's approach to him stops two tiles short and no dialogue opens; from the
                    // doorway's inner tile, where his entry teleport lands, it opens at once.
                    if (chebyshev(pos(sdk), HALL_DOOR_IN) > 0) await click(sdk, HALL_DOOR_IN, 0);
                    const g = await talkTo(sdk, /^Elder Guard$/i, [], { maxTicks: 60, idle: 3, near: ELDER_GUARD, until: s => !inThroneRoom(s), ...shaped(MM_SHAPES.elderGuardOut) });
                    noteShape('W Elder Guard', g);
                    if (inThroneRoom(sdk)) throw new Error(`the Elder Guard did not show the player out: ${g.reason ?? g.transcript.slice(-2).join(' / ')}`);
                }
                if (chebyshev(pos(sdk), GARKOR) > 2) {
                    for (const p of GARKOR_NORTH.points) await go(ctx, p, 1);
                }
                // Garkor at awowogei_complete_mission: 6 pages, then the chapter 4 cutscene (mm_garkor.rs2:129-137,
                // quest_mm.rs2:211); at learned_plan (the cutscene seen): the plan, then the sigil (mm_garkor.rs2:25-47).
                const ch4 = (s: BotWorldState) => tileIn(pos(s), { ...CUTSCENE_ZONE, level: 1 });
                // On a resume past the cutscene this first talk is the plan's, which leaves the lead-in's shape at its sixth page.
                const first = await talkTo(sdk, /garkor/i, [], { maxTicks: 120, idle: 3, near: GARKOR, until: s => ch4(s) || holds(s, MM_OBJ.sigil), ...shaped(MM_SHAPES.garkorChapter4) });
                noteShape('W Garkor (chapter 4)', first);
                if (ch4(sdk.getState()!) || (!holds(sdk.getState()!, MM_OBJ.sigil) && (await waitUntil(sdk, ch4, { maxTicks: 8 })).ok)) {
                    o.note(`S15:W chapter 4: ${await chapterCutscene(sdk, 1, 'chapter 4', MM_SHAPES.chapter4)} pages`);
                } else if (!holds(sdk.getState()!, MM_OBJ.sigil)) {
                    throw new Error(`Garkor started neither the chapter 4 cutscene nor the plan: ${first.reason ?? first.transcript.slice(-2).join(' / ')} (at ${where(sdk)})`);
                }
                const r = holds(sdk.getState()!, MM_OBJ.sigil) ? first : await talkTo(sdk, /garkor/i, [], { maxTicks: 120, idle: 3, near: GARKOR, until: s => holds(s, MM_OBJ.sigil), ...shaped(MM_SHAPES.garkorSigil) });
                if (r !== first) noteShape('W Garkor (sigil)', r);
                if (!holds(sdk.getState()!, MM_OBJ.sigil)) throw new Error(`no sigil from Garkor: ${r.reason ?? r.transcript.slice(-2).join(' / ')} (at ${where(sdk)})`);
                await dismiss(sdk);
            });
        },
        postconditions: all(holding(MM_OBJ.sigil), s => wearing(s, MM_OBJ.greegree) || 'not a monkey'),
    },
    Y: {
        preconditions: yRoom,
        async run(ctx) {
            const { sdk } = ctx;
            // Narnode needs only mm_main = defeated_demon (mm_narnode.rs2:14), so the teleport goes from wherever the
            // kill left the player, skipping Garkor's and Zooknock's way out of the arena (mm_demon.rs2:476-524).
            await treesToStronghold(ctx);
            await intoTree(ctx, 0);
            if (freeSlots(sdk.getState()!) < yNeed(sdk.getState()!)) await dropDead(sdk);
            const drop = sharksToDrop(sdk.getState()!, yNeed(sdk.getState()!));
            if (drop > 0) {
                let k = drop;
                const d = await dropItems(sdk, i => i.id === MM_OBJ.shark && k-- > 0);
                if (!d.ok) throw new Error(`could not drop ${drop} sharks for Narnode's reward (at ${where(sdk)})`);
            }
            // The report (14 pages), the reward and its objbox, the quest-complete scroll, then Narnode's training pages.
            const sigil = holds(sdk.getState()!, MM_OBJ.sigil) || wearing(sdk.getState()!, MM_OBJ.sigil);
            const r = await talkTo(sdk, /^King Narnode( Shareen)?$/i, [], { maxTicks: 200, idle: 3, near: NARNODE, closeModals: true, until: s => questStatus(s, 'mm') === 'complete', ...shaped(narnodeComplete(sigil)) });
            noteShape('Y Narnode', r);
            if (questStatus(sdk.getState()!, 'mm') !== 'complete') throw new Error(`Narnode did not complete the quest: ${r.reason ?? r.transcript.slice(-2).join(' / ')} (at ${where(sdk)})`);
            await dismiss(sdk);
        },
        postconditions: s => questStatus(s, 'mm') === 'complete' || 'Monkey Madness is not complete',
    },
    Z: {
        preconditions: s => questStatus(s, 'mm') === 'complete' || 'Monkey Madness is not complete',
        async run(ctx) {
            const { sdk } = ctx;
            await dismiss(sdk);
            await intoTree(ctx, 1);
            if (chebyshev(pos(sdk), DAERO) > 3) await go(ctx, DAERO, 2);
            const xp0 = skillXp(sdk.getState()!, 'Strength');
            // daero_training (mm_daero.rs2:240-312): 10 pages, option 1, "Several hours later...", then the xp.
            const r = await talkTo(sdk, /^Daero$/i, [/^Focus on increasing strength and stamina/], {
                maxTicks: 150, idle: 4, near: DAERO, closeModals: true, until: s => skillXp(s, 'Strength') >= xp0 + DAERO_STRENGTH_XP, ...shaped(MM_SHAPES.daeroTraining),
            });
            noteShape('Z Daero', r);
            if (skillXp(sdk.getState()!, 'Strength') < xp0 + DAERO_STRENGTH_XP) throw new Error(`no training xp from Daero: ${r.reason ?? r.transcript.slice(-2).join(' / ')}`);
            await dismiss(sdk);
            await dropDead(sdk);
        },
        postconditions: exitState,
    },
    M: {
        preconditions: all(s => inArea(s, AREAS.dungeon) || inArea(s, AREAS.atoll) || 'not on the atoll or in its dungeon', holding(MM_OBJ.enchantedBar)),
        async run(ctx, o) {
            const { sdk } = ctx;
            const t = o.topUpFrom;
            // H12oM opens as M sets off from Zooknock: ~300 ticks before the ladder's top, h45 needing ~100 (mule.md).
            if (t?.m && inArea(sdk, AREAS.dungeon)) legCue(sdk, t.cueDir ?? cueDir(), 'M', 'open');
            await upkeep(sdk, async () => {
                if (inArea(sdk, AREAS.dungeon)) {
                    await immune(sdk, 'the dungeon (M)');
                    await praying(sdk, 'protect_from_melee', () => go(ctx, { x: DUNGEON_EXIT.x, z: DUNGEON_EXIT.z + 1 }, 1));
                    await climb(sdk, DUNGEON_EXIT);
                }
                // H12o-M on the ladder's top, before the knockout walk, sized to the free slots there.
                if (t && pos(sdk).level === 0 && chebyshev(pos(sdk), M_TOPUP_TILE) <= 3) {
                    if (t.m) await h12oLeg(sdk, t, 'M');
                    else if (t.p) legCue(sdk, t.cueDir ?? cueDir(), 'P', 'open');
                }
                await toTown(ctx);
            });
        },
        postconditions: inTown,
    },
};

export function stepFor(d: SegmentDef, o: Resolved): Step<MmContext> {
    const name = segmentName(d);
    const body = BODIES[d.letter];
    // The gnome half (A-G) runs under the same upkeep as the atoll segments, which wrap their own bodies.
    const run: Step<MmContext>['run'] = body ? ctx => {
        stepNote = o.note;
        dialogue = o.dialogue;
        eating = {
            below: eatBelowFor(o.eating, d.letter),
            ...(o.eating.topUpBelow !== undefined ? { topUpBelow: o.eating.topUpBelow } : {}),
        };
        return d.letter <= 'G' ? upkeep(ctx.sdk, () => body.run(ctx, o)) : body.run(ctx, o);
    } : async () => {
        throw new Error(`${name} is not written yet`);
    };
    const step: Step<MmContext> = {
        name,
        logoutSafe: d.logoutSafe,
        preconditions: body?.pre?.(o) ?? body?.preconditions ?? (() => `${name} is not written yet`),
        run,
        postconditions: body?.postconditions ?? (() => true),
        ...(d.travel ? {} : { done: doneAt(d.letter), probes: [JOURNAL_PROBE] }),
        ...(body?.inProgress ? { inProgress: body.inProgress } : {}),
        // A body with inProgress and no resume is written to re-enter through run (E reads the journal and
        // skips Daero's talk): named as the resume entry, since the walk never re-enters a logout-unsafe
        // step mid-step through run alone (runner/resume.ts).
        ...(body?.resume ? { resume: body.resume } : body?.inProgress ? { resume: run } : {}),
        ...(body?.startsInCombat ? { startsInCombat: true as const } : {}),
    };
    return step;
}

/** The module's steps, one per segment A-Z. */
export function steps(opts: Options = {}): Step<MmContext>[] {
    const o = resolveOptions(opts);
    return SEGMENTS.map(d => stepFor(d, o));
}
