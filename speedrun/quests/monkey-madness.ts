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
import { converse, type Interrupt } from '../lib/converse';
import { pageText } from '../lib/dialogue';
import { compactJournal, journalProbeName, journalText, questStatus, type QuestView } from '../lib/quests';
import { receiveFrom, sameName, swap, type GiveSpec, type WantSpec } from '../lib/trade';
import { deletesFollowerItem, glide, GNOME_STRONGHOLD_GATE, passGate, runTo, SPIRIT_TREES, spiritTree, teleport, teleportRefusal, type Hop } from '../lib/travel';
import { solveOnPanel } from '../lib/puzzle';
import { currentTick, waitTicks, waitUntil, type Pred } from '../lib/wait';
import { chebyshev, findLoc, invCount, messagesSince, pos, waitForNpc, type StateLike } from '../lib/world';
import type { Check, Observed, Step, StepContext } from '../runner/step';
import { slotNeed, slotsCover, type QuestItem } from './segments';

export const quest: QuestKey = 'mm';
export const stepId = 'S15';

export interface Options {
    /** Default 'fixed'. 'burst' needs rs/200's converse burst mode; until then it is refused. */
    dialogue?: 'burst' | 'fixed';
    /** The H12 giver; absent: the kit must already be held. */
    kitFrom?: string;
    /** Default 'ladder' (rs/59's drop); a failed drop falls back to 'wait' inside segment N. */
    templeMethod?: 'ladder' | 'wait';
    /** Default 'walk'; 'glider' is Barnaby's ship to Brimhaven, a walk, and the Gandius glider. */
    returnMonkey?: 'walk' | 'glider';
    /** Diagnostic lines (the timing choices behind a random step); the lab prints them. Default: dropped. */
    note?: (line: string) => void;
    /** When sharks are eaten. Default SEGMENT_EATING (the ruled per-segment thresholds, no top-ups). */
    eating?: EatPolicy;
    /**
     * The atoll top-up (SUPPLIES.md H12o): a helper parked beside the bridge jump's landing trades this to SCORED as P
     * lands there. Off when absent (the default); run.ts passes the ledger row's helper and items.
     */
    topUpFrom?: TopUp;
    /**
     * The bow the kit carries for the Jungle Demon (X), by object id. Default the magic shortbow (H12); any bow whose
     * level requirement is at least the rune arrows' fires them (player_ranged.rs2 player_ranged_check_ammo).
     */
    bow?: number;
}

export const DEFAULT_OPTIONS: Required<Omit<Options, 'kitFrom' | 'eating' | 'topUpFrom'>> = { dialogue: 'fixed', templeMethod: 'ladder', returnMonkey: 'walk', note: () => {}, bow: 861 /* MM_OBJ.magicShortbow, declared below */ };

export function resolveOptions(o: Options = {}): Required<Omit<Options, 'kitFrom' | 'topUpFrom'>> & Pick<Options, 'kitFrom' | 'topUpFrom'> {
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
const DENTURE_CRATE_EAST = { x: 2768, z: 2769 };
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
 * The backpack monkey's chat (mm_zoo_monkey.rs2:108-139): every 5-50 ticks while the player is not busy, a page
 * headed "The monkey in your backpack...", or for the snore, that and the player's "The what?".
 */
export const MONKEY_CHATTER: Interrupt = {
    name: 'backpack monkey',
    match: s => /monkey in your backpack|^The what\?$/i.test((s.dialog.allComponents ?? []).map(c => c.text).join(' ').trim()),
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
 * in its collision data), so from Garkor the walk west starts with two clicks.
 */
const GARKOR_WEST: Via = { points: [{ x: 2795, z: 2772 }, { x: 2780, z: 2770 }], within: 12 };

/**
 * The Elder Guards at Awowogei's door (2798-2801, 2757-2760) hit any adjacent
 * human (mm_elder_guard.rs2), and the pathfinder's line to Garkor can pass
 * them, so Garkor is approached from the north.
 */
/**
 * Into the crate building (x 2759-2770, z 2764-2772) by its south door. The
 * Sleeping Monkey at (2764,2769) wakes and summons guards, a named one always
 * knocking out, when a human enters x 2762-2767, z 2767-2772
 * (mm_sleeping_monkey_guard.rs2, quest_mm.rs2 aa_summon_guards). The
 * building's north entrance lies in that zone and the pathfinder cuts across
 * it, so the walk goes round to the south door (2764,2763-2764) and inside
 * keeps to z 2764 and x 2770, reaching both crates from x 2768 or more.
 */
const CRATES_SOUTH = [{ x: 2771, z: 2763 }, { x: 2764, z: 2763 }, { x: 2764, z: 2764 }, { x: 2770, z: 2764 }, { x: 2770, z: 2768 }] as const;
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
    /** Per segment letter, the threshold while inside GUARD_CORRIDOR (replacing `below` there). */
    corridor?: Readonly<Partial<Record<string, number>>>;
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
/** rs/158's corridor round the guards, floors 0 and 1, where the corridor eat thresholds apply. */
export const GUARD_CORRIDOR = { x0: 2786, z0: 2774, x1: 2798, z1: 2792 } as const;

export function inGuardCorridor(src: StateLike): boolean {
    const p = pos(src);
    return (p.level === 0 || p.level === 1) && tileIn(p, GUARD_CORRIDOR);
}

/**
 * The protect prayer for a walk leg from `a` to `b` on `level`: Melee when the straight leg passes within GUARD_REACH of
 * a religious guard's spawn on that level, else Missiles (the town's archers). Chosen while standing, before the leg's
 * click: a prayer click mid-walk cancels the walk (rs/241).
 */
export function townLegPrayer(a: { x: number; z: number }, b: { x: number; z: number }, level: number): 'protect_from_melee' | 'protect_from_missiles' {
    const guards = RELIGIOUS_GUARDS[level] ?? [];
    const n = Math.max(1, chebyshev(a, b));
    for (let i = 0; i <= n; i++) {
        const p = { x: Math.round(a.x + ((b.x - a.x) * i) / n), z: Math.round(a.z + ((b.z - a.z) * i) / n) };
        if (guards.some(g => chebyshev(p, g) <= GUARD_REACH)) return 'protect_from_melee';
    }
    return 'protect_from_missiles';
}

/**
 * The ruled policy (main and rs/158, 10-22 11:4x): eat below 10 + the segment's worst damage in any 3-tick window, hits
 * and poison, the max over exec 7's chains (Defence 37) and exec 5's (Defence 1) on bgsrv-mac; no top-ups. A shark heals
 * 20 against a 42 max, so a threshold of 23 or less wastes nothing.
 */
export const SEGMENT_EATING: EatPolicy = {
    // rs/158 13:4x: outside the guards' corridor, 10 + the worst 3-tick window over every valid round with the hits
    // within GUARD_REACH of a guard spawn left out; inside it, 10 + the worst window with them in, until a round shows the
    // zone prayer removes them.
    below: { H: 27, I: 22, J: 25, K: 26, L: 12, M: 21, N: 23, O: 24, P: 25, Q: 12, R: 16 },
    corridor: { J: 39, K: 34, N: 29, O: 31 },
    otherwise: 20,
};

/**
 * Exec 7's first gate chains: eat below 30, and in O and P a top-up below 34 before each dialogue and ladder. Measured:
 * 69-85 HP of each chain's healing went over the 42 max (about 4 sharks), and both clean chains ran out by R.
 */
export const BELOW_30_EATING: EatPolicy = { below: {}, otherwise: 30, topUpBelow: 34 };

/** The HP `policy` eats under in segment `letter`, inside the guards' corridor when `corridor`. */
export function eatBelowFor(policy: EatPolicy, letter: string, corridor = false): number {
    return (corridor ? policy.corridor?.[letter] : undefined) ?? policy.below[letter] ?? policy.otherwise;
}

/** A top-up eat is wanted before a dialogue or a ladder: under `topUpBelow` with a shark held. */
export function topUpWanted(s: BotWorldState, topUpBelow: number): boolean {
    return (s.player?.hp ?? 0) < topUpBelow && invCount(s, MM_OBJ.shark) > 0;
}

/** The running segment's eat thresholds, set by stepFor before each body runs. */
let eating: { below: number; corridorBelow: number; topUpBelow?: number } = { below: SEGMENT_EATING.otherwise, corridorBelow: SEGMENT_EATING.otherwise };

/** The eat threshold where the player stands now. */
const eatBelowAt = (s: BotWorldState) => (inGuardCorridor(s) ? eating.corridorBelow : eating.below);

/** Drink a prayer potion below this many points while a prayer is on (a dose restores 30 at Prayer 94). */
export const DRINK_BELOW = 20;

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
 * Upkeep while `fn` runs, on the atoll and on the gnome half alike: auto-retaliate off, a shark below the segment's eat threshold, the
 * antipoison on a poisoning and a prayer potion below DRINK_BELOW while a prayer is on. Measured: B's walk through the
 * Karamja jungle poisoned the player, and with no cure the poison killed a 42 HP player in E's hangar.
 */
async function upkeep<T>(sdk: Sdk, fn: () => Promise<T>): Promise<T> {
    await noRetaliate(sdk);
    // Upkeep reads eatBelow on every step, so the threshold follows the player into and out of the guards' corridor.
    const uo = { eatBelow: eating.below, food: MM_OBJ.shark };
    const u = new Upkeep(sdk, uo);
    let lastDrink = -Infinity;
    let lastVialDrop = -Infinity;
    // The wildlife's poison (aa_wildlife.rs2) keeps ticking into the next stretch; the antipoison ends it and grants immunity.
    const obs = (m: { observationId?: number; tick: number }) => m.observationId ?? m.tick;
    let seen = Math.max(-1, ...(sdk.getState()?.gameMessages ?? []).map(obs));

    const stop = sdk.onStateUpdate(s => {
        uo.eatBelow = eatBelowAt(s);
        void u.step(s);
        const fresh = s.gameMessages.filter(m => obs(m) > seen);
        if (fresh.length) seen = Math.max(seen, ...fresh.map(obs));
        if (fresh.some(m => /you have been poisoned/i.test(m.text))) lastPoisoned = s.tick;
        if (cureWanted({ tick: s.tick, lastPoisoned, lastDose: lastAntipoison })) {
            const cure = s.inventory.find(i => ANTIPOISON.test(i.name));
            if (cure) {
                lastAntipoison = s.tick;
                stepNote(`S15 antipoison: a dose to cure a poisoning at t=${s.tick} (poisoned at t=${lastPoisoned})`);
                void sdk.sendUseItem(cure.slot, cure.optionsWithIndex.find(o => /^drink$/i.test(o.text))?.opIndex ?? 1);
            }
        }
        // A potion's last dose leaves an empty vial (potions.obj next_obj_stage); it would hold a slot to the end.
        const vial = s.inventory.find(i => /^Vial$/i.test(i.name));
        if (vial && s.tick - lastVialDrop >= 2) {
            lastVialDrop = s.tick;
            void sdk.sendDropItem(vial.slot);
        }
        // Upkeep drinks only for a prayer it manages itself; the atoll's protect prayers come and go by stretch.
        const p = s.prayers;
        if (!p || p.prayerPoints >= DRINK_BELOW || !p.activePrayers.some(Boolean) || s.tick - lastDrink < 3) return;
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

/** Any antipoison's doses by name: H12 carries "Superantipoison(4)" (no space), which `^Antipoison` would never match. */
const ANTIPOISON = /antipoison\(\d\)$/i;

/**
 * Ticks of poison immunity a super antipoison dose gives: %poison to -20 (anti_poison.rs2), stepped by 1 every 30 ticks
 * (poison.rs2 set_poison_timer). The dungeon's spikes and spear traps skip their poison while %poison is negative
 * (ape_atoll_dungeon.rs2).
 */
export const SUPER_IMMUNE_TICKS = 600;

/** The tick of the last antipoison dose this run drank (a cure or a pre-dungeon dose); -Infinity after a restart. */
let lastAntipoison = -Infinity;

/** The tick of the last "You have been poisoned!" this run saw. */
let lastPoisoned = -Infinity;

/**
 * Whether to drink an antipoison now: once per fresh poisoning (within 30 ticks of its message), never within 3 ticks of a
 * dose, in every segment. Deferring C's cure (the Karamja jungle) to save the dose for H-R was measured to fail the HP
 * floor: in 2 of 3 chains the poison held HP to 20 through Daero's blindfold pages, where no eat can land, and an
 * 11 then took it to 9 in E.
 */
export function cureWanted(o: { tick: number; lastPoisoned: number; lastDose: number }): boolean {
    return o.lastPoisoned > o.lastDose && o.tick - o.lastDose >= 3 && o.tick - o.lastPoisoned <= 30;
}

/** A dose is wanted on entering a dungeon pass: one is held, and the last dose's immunity has under 60 ticks left. */
export function immunityWanted(now: number, lastDose: number, held: boolean): boolean {
    return held && now - lastDose > SUPER_IMMUNE_TICKS - 60;
}

/**
 * H12's optional pre-dose (rs/158's zero-slot option): a one-dose super antipoison in the 28th slot, drunk at A's start
 * (the vial dropped by upkeep) before Narnode's seal needs the slot. Its ~600 ticks of immunity cover the gnome half's
 * Karamja jungle (B, C), so the 4-dose potion's doses all reach H-R. A no-op when H12 brought none.
 */
async function preDose(sdk: Sdk): Promise<void> {
    const dose = sdk.getState()!.inventory.find(i => i.id === MM_OBJ.superAntipoison1);
    if (!dose) return;
    lastAntipoison = currentTick(sdk);
    void sdk.sendUseItem(dose.slot, dose.optionsWithIndex.find(o => /^drink$/i.test(o.text))?.opIndex ?? 1);
    const r = await waitUntil(sdk, s => !s.inventory.some(i => i.id === MM_OBJ.superAntipoison1), { maxTicks: 4 });
    if (!r.ok) throw new Error(`the pre-dose super antipoison was not drunk (at ${where(sdk)})`);
    stepNote(`S15 antipoison: the pre-dose at A, t=${lastAntipoison} (immune to about t=${lastAntipoison + SUPER_IMMUNE_TICKS})`);
}

/** Drink an antipoison dose before a dungeon pass when immunityWanted, so the pass's spikes and spears never poison. */
async function immune(sdk: Sdk, pass: string): Promise<void> {
    const s = sdk.getState()!;
    const dose = s.inventory.find(i => ANTIPOISON.test(i.name));
    if (!immunityWanted(s.tick, lastAntipoison, !!dose)) return;
    const names = () => sdk.getState()!.inventory.filter(i => ANTIPOISON.test(i.name)).map(i => i.name).join(',');
    const before = names();
    lastAntipoison = s.tick;
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
            let jailed = false;
            const walked = await stopgapRetry(`yard walk to ${w.x},${w.z}`, 3, async () => {
                try {
                    jailed = !(await click(sdk, w, w.tol));
                    return true;
                } catch {
                    jailed = inCell(sdk);
                    return jailed;
                }
            });
            if (!walked) throw new Error(`the yard walk to ${w.x},${w.z} stopped at ${where(sdk)}`);
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
 * Walk in the town under the zone prayer: each leg (a via click, a pathfinder walk) under townLegPrayer, set while
 * standing before it. The town's Monkey Archers (ranged, attack range 10) poison and hit a Defence 1 human for up to 12;
 * the temple's religious guards hit 12-15 in melee. When the caller already holds a protect prayer, it is left alone.
 */
async function townGo(ctx: Ctx, to: { x: number; z: number }, tol = 0, via: Via | readonly Via[] = []): Promise<void> {
    const { sdk } = ctx;
    if (PROTECTS.some(p => prayerActive(sdk.getState()!, p))) return townGoUnprayed(ctx, to, tol, via, false);
    try {
        await townGoUnprayed(ctx, to, tol, via, true);
    } finally {
        for (const p of PROTECTS) if (prayerActive(sdk.getState()!, p)) await setPrayer(sdk, p, false);
    }
}

/** Set the zone prayer for the leg from here to `to`, while standing; a switch is noted with its tile. */
async function legPrayer(sdk: Sdk, to: { x: number; z: number }): Promise<void> {
    const p = pos(sdk);
    const want = townLegPrayer(p, to, p.level);
    if (prayerActive(sdk.getState()!, want)) return;
    const r = await setPrayer(sdk, want, true);
    if (!r.ok) throw new Error(`${want} did not turn on: ${r.reason}`);
    stepNote(`S15 zone prayer: ${want} at ${p.x},${p.z},${p.level} for the leg to ${to.x},${to.z}`);
}

async function townGoUnprayed(ctx: Ctx, to: { x: number; z: number }, tol: number, vias: Via | readonly Via[], zone = false): Promise<void> {
    const { sdk } = ctx;
    const options = Array.isArray(vias) ? (vias as readonly Via[]) : [vias as Via];
    for (let attempt = 0; attempt < 4; attempt++) {
        if (inCell(sdk)) await leaveCell(sdk);
        let clear = true;
        const via = options.find(v => v.points.length && chebyshev(pos(sdk), v.points[0]!) <= v.within);
        if (via) {
            for (const v of via.points) {
                if (zone) await legPrayer(sdk, v);
                if (chebyshev(pos(sdk), v) <= 12) clear = await click(sdk, v);
                else clear = (await walkTo(ctx.bot, sdk, v.x, v.z, 1)).ok && !inCell(sdk);
                if (!clear) break;
            }
        }
        if (!clear) continue;
        if (zone) await legPrayer(sdk, to);
        const r = await walkTo(ctx.bot, sdk, to.x, to.z, tol);
        if (r.ok) return;
        if (!inCell(sdk)) throw new Error(`walk to ${to.x},${to.z} failed at ${where(sdk)}: ${r.message}`);
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
async function searchCrate(sdk: Sdk, at: { x: number; z: number }, yes: RegExp, got: Pred, label: string, note: (line: string) => void = () => {}): Promise<void> {
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
        const r = await actConverse(sdk, await locClick(sdk, at, /search/i), [yes], { done: got, maxTicks: 25, idle: 3, resendEvery: 5 });
        note(`S15 ${label}: dialogue at click+${r.dialogue && r.dialogue.firstTick >= 0 ? r.dialogue.firstTick - r.startTick : 'none'}, resends ${r.resends}`);
        if (r.ok || got(sdk.getState()!)) return;
        reason = r.reason ?? '';
    }
    throw new Error(`${label}: ${reason} (at ${where(sdk)})`);
}

/** Use an inventory item on the NPC and answer what it says; done when `effect` holds. */
async function useOnNpc(sdk: Sdk, item: number, npcName: RegExp, effect: Pred, idle = 3): Promise<void> {
    const npc = await waitForNpc(sdk, npcName, 10);
    if (!npc) throw new Error(`no ${npcName} near ${where(sdk)}`);
    const r = await actConverse(sdk, () => sdk.sendUseItemOnNpc(slotOf(sdk, item), npc.index), [], { done: effect, maxTicks: 60, idle, resendEvery: 5 });
    if (!r.ok) throw new Error(`use ${item} on ${npc.name}: ${r.reason}`);
}

/** Talk to an NPC through a scripted conversation; throws on a choice the list does not answer, or when fewer than `minPages` pages were seen. */
async function talk(sdk: Sdk, npc: RegExp, choices: RegExp[], o: { near?: { x: number; z: number }; minPages?: number; idle?: number } = {}): Promise<void> {
    await topUp(sdk);
    const r = await talkTo(sdk, npc, choices, { maxTicks: 900, idle: o.idle ?? 3, ...(o.near ? { near: o.near } : {}) });
    if (!r.ok || !r.opened) throw new Error(`talk to ${npc}: ${r.reason ?? 'no dialogue'}`);
    if (r.pages < (o.minPages ?? 0)) throw new Error(`talk to ${npc}: ${r.pages} pages, expected at least ${o.minPages}: ${r.transcript.slice(-3).join(' / ')}`);
}

/** In the dungeon under the temple (mapsquare 43_143, z 9152+). */
const underTemple = (src: StateLike) => {
    const p = pos(src);
    return p.z >= 9180 && p.x >= 2752 && p.x <= 2815;
};

/** The fire under the temple nearest the player (mm_iban_firewall_straight/diagonal, quest_mm.rs2 opu_mm_firewall). */
async function nearestFire(sdk: Sdk): Promise<{ x: number; z: number; id: number }> {
    const fires = (await sdk.scanNearbyLocs(15)).filter(l => /^Wall of flame$/i.test(l.name)).sort((a, b) => a.distance - b.distance);
    const f = fires[0];
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
async function chapterCutscene(sdk: Sdk, level: 0 | 1, label: string): Promise<number> {
    const zone: Area = { ...CUTSCENE_ZONE, level };
    let entered = inArea(sdk, zone);
    const r = await converse(sdk, [], {
        idle: 6, openTicks: 40, maxTicks: 400, unmatched: 'stop', closeModals: true,
        until: s => {
            if (tileIn(pos(s), zone)) entered = true;
            return entered && !tileIn(pos(s), zone);
        },
    });
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

/** One line of H12's kit: at least `n` held or worn of items whose name matches (or, for the bow, whose id is `id`). */
interface KitLine { name: RegExp; n: number; id?: number }

/**
 * H12's food (rs/158, 10-22 07:0x): the measured A-Z demand is 14-15 sharks and about 13 prayer doses (three chains);
 * 15 sharks is what fits, with the 12 other kit slots and the seal or the orders held A-D, and the +1 margin is an
 * acceptance check (a shark left at the end) instead of a carried shark.
 */
export const H12_SHARKS = 15;
export const H12_POTIONS = 4;

/**
 * H12 (SUPPLIES.md H12, rs/158's final ruling 01:38): the quest's ingredients, the bow and 200 rune arrows (worn from
 * the swap on), 2 prayer potions, an antipoison, Ardougne and two Varrock casts, and sharks topped up to 9.
 */
export function h12Kit(bow: number): KitLine[] {
    return [
        // No bananas: O searches them from the trees in the aunt's house (BANANA_TREES).
        { name: /^Gold bar$/, n: 1 }, { name: /^Ball of wool$/, n: 1 }, { name: /^Monkey bones$/, n: 1 },
        { name: /bow$/i, n: 1, id: bow }, { name: /^Rune arrow$/, n: 200 },
        { name: /^Prayer potion\(4\)$/, n: H12_POTIONS }, { name: /^Superantipoison\(4\)$/, n: 1 },
        // Ardougne 2 casts (2 law, 2 water each), Varrock 2 casts (1 law, 3 air, 1 fire each).
        { name: /^Law rune$/, n: 6 }, { name: /^Air rune$/, n: 6 }, { name: /^Fire rune$/, n: 2 }, { name: /^Water rune$/, n: 4 },
        { name: /^Shark$/, n: H12_SHARKS },
    ];
}

const carried = (s: BotWorldState, k: KitLine) =>
    [...s.inventory, ...s.equipment].filter(i => (k.id !== undefined ? i.id === k.id : k.name.test(i.name))).reduce((a, i) => a + i.count, 0);

/** What H12 still lacks, held or worn: `[name, missing]`. */
export function kitMissing(s: BotWorldState, bow: number): Array<[RegExp, number]> {
    return h12Kit(bow).map(k => [k.name, k.n - carried(s, k)] as [RegExp, number]).filter(([, n]) => n > 0);
}

/** What SCORED hands back in the Grand Tree swap (rs/158 01:38): S14's staff of fire, scimitar and knife, and the coins. */
export const GT_HANDBACK: readonly RegExp[] = [/^Staff of fire$/i, /^Mithril scimitar$/i, /^Knife$/i, /^Coins$/i];

/**
 * The Grand Tree swap's plan from the state: give back the GT_HANDBACK items held, want what H12 still lacks (kitMissing
 * as amounts). No want means no trade: the kit was already placed (run.ts's H12 hand-off at the tree door).
 */
export function h12Plan(s: BotWorldState, o: { bow: number }): { give: GiveSpec[]; want: WantSpec[] } {
    return {
        give: GT_HANDBACK.filter(p => s.inventory.some(i => p.test(i.name))).map(item => ({ item })),
        want: kitMissing(s, o.bow).map(([item, amount]) => ({ item, amount })),
    };
}

/**
 * The Grand Tree hand-off before A: one swap() with the giver (lib/trade.ts) by h12Plan, only when H12 is short; then
 * the bow is wielded and the arrows quivered, which they stay until the gree-gree at R.
 */
export async function gtSwap(ctx: Pick<Ctx, 'sdk'>, o: Pick<Resolved, 'bow' | 'kitFrom'>): Promise<void> {
    const { sdk } = ctx;
    const plan = h12Plan(sdk.getState()!, o);
    if (plan.want.length) {
        if (!o.kitFrom) throw new Error(`H12 kit short (${plan.want.map(w => `${w.amount} ${(w.item as RegExp).source}`).join(', ')}) and no kitFrom`);
        const r = await swap(sdk as never, o.kitFrom, plan.give, plan.want, { closeModals: true });
        if (!r.ok) throw new Error(`the Grand Tree swap with ${o.kitFrom} failed: ${r.reason ?? 'unknown'}`);
        const still = kitMissing(sdk.getState()!, o.bow);
        if (still.length) throw new Error(`after the swap the kit still lacks ${still.map(([n, k]) => `${k} ${n.source}`).join(', ')}`);
    }
    for (const id of [o.bow, MM_OBJ.runeArrow]) {
        if (wearing(sdk.getState()!, id)) continue;
        const w = await wield(sdk, id, { maxTicks: 6 });
        if (!w.ok) throw new Error(`could not wear ${id} at the swap: ${w.reason}`);
    }
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
    // stopgap until rs/411: the backpack monkey's chatter page after a talk click is taken as the click's answer, so the
    // click is never re-sent (rs/391's ClickGuard finding): gate chains b and c stood 100 ticks in the hangar, Waydar's
    // talk never opening. Shorter talks, each retried at most twice more.
    const hop = async (label: string, npc: RegExp, choices: RegExp[], arrived: (s: BotWorldState) => boolean, opts: Record<string, unknown>) => {
        let r!: Awaited<ReturnType<typeof talkTo>>;
        const ok = await stopgapRetry(`${label} talk`, 3, async () => {
            r = await talkTo(sdk, npc, choices, { maxTicks: 45, ...opts, until: arrived, ...CHATTER });
            return arrived(sdk.getState()!);
        });
        if (!ok) throw new Error(`${label}: ${r.reason ?? r.transcript.slice(-2).join(' / ')} (at ${where(sdk)})`);
    };
    if (!inArea(sdk, AREAS.atoll) && !inArea(sdk, HANGAR) && !inArea(sdk, CRASH_ISLAND)) {
        await toDaero();
        // Daero (mm_daero.rs2:218-238): Yes, the blindfold, a fade, the powered hangar.
        await hop('Daero did not take the player to the hangar', /^Daero$/i, [/^Yes$/], s => inArea(s, HANGAR), { idle: 4, near: DAERO });
    }
    // "Shall we return to Crash Island?" (mm_waydar.rs2:5-19): Yes, the glider map, a p_delay(3), the island.
    if (inArea(sdk, HANGAR)) await hop('Waydar did not fly to Crash Island', /^Waydar$/i, [/^Yes$/], s => inArea(s, CRASH_ISLAND), { idle: 4, closeModals: false });
    if (inArea(sdk, CRASH_ISLAND)) await hop('Lumdo did not sail to the atoll', /^Lumdo$/i, [], s => inArea(s, AREAS.atoll), { idle: 2 });
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
    // Each talk: its choices and the house time it needs (fixed dialogue, with the walk in).
    const talks: Array<{ name: string; choices: RegExp[]; need: number; pick?: true }> = [
        { name: 'hello', choices: [], need: 12 },
        { name: 'uncle', choices: [/monkey's uncle/i], need: 12 },
        { name: 'bananas wanted', choices: [/How many bananas/i], need: 16 },
        { name: 'bananas', choices: [], need: 16, pick: true },
    ];
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
    /** Out of the house to the wait tile, then until the aunt's loop has `need` house ticks left and the door is clear of her. */
    const window = async (need: number) => {
        const ok = () => {
            const w = left();
            return w.left >= need && w.since >= AUNT_DOOR_CLEAR;
        };
        if (inHouse() && ok()) return;
        if (chebyshev(pos(sdk), AUNT_WAIT) > 0) await townGo(ctx, AUNT_WAIT, 0);
        const r = await praying(sdk, 'protect_from_melee', () => waitUntil(sdk, () => ok(), { maxTicks: 260 }));
        if (!r.ok) throw new Error(`the aunt's loop gave no ${need}-tick window in 260 ticks (aunt at ${JSON.stringify(auntTile())})`);
    };
    try {
        for (const [i, t] of talks.entries()) {
            if (i < progress.talks) continue;
            // The bananas come from the house's own trees, searched in the same window as the talk that gives them.
            // A knockout after the set-down: the sharks on the ground come back before any more go down.
            if (t.pick && progress.setDown) {
                if (!tileIn(progress.setDown.at, AUNT_HOUSE)) await townGo(ctx, AUNT_WAIT, 0);
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
            note(`S15:O talk '${t.name}' at t=${currentTick(sdk)}: aunt ${JSON.stringify(auntTile())}, ${JSON.stringify(left())}, left seen at ${leftAt}`);
            await talk(sdk, child, t.choices, { near: CHILD });
            if (t.pick) {
                if (invCount(sdk, MM_OBJ.banana) > 0) throw new Error('the child did not take the bananas');
                progress.given = currentTick(sdk);
                // Back up at once if they lie in the house (in the same window); else at the wait tile, below.
                if (progress.setDown && tileIn(progress.setDown.at, AUNT_HOUSE)) await retakeSharks(sdk, progress, note);
            }
            progress.talks = i + 1;
        }
        const given = progress.given ?? currentTick(sdk);
        // The toy's timer (mm_monkey_child.rs2:142, settimer 100) runs from the bananas; the aunt is back in long before it ends.
        await townGo(ctx, AUNT_WAIT, 0);
        await praying(sdk, 'protect_from_melee', async () => {
            if (progress.setDown) await retakeSharks(sdk, progress, note);
            return waitUntil(sdk, s => s.tick - given >= 101, { maxTicks: 120 });
        });
        // Seven pages and the objbox, plus the 6-tile walk in: with 12 left, the aunt came back mid-talk once.
        await window(20);
        note(`S15:O talk 'talisman' at t=${currentTick(sdk)}: aunt ${JSON.stringify(auntTile())}, ${JSON.stringify(left())}, left seen at ${leftAt}`);
        await topUp(sdk);
        const r = await talkTo(sdk, child, [], { maxTicks: 60, idle: 3, near: CHILD });
        if (!holds(sdk.getState()!, MM_OBJ.talisman)) throw new Error(`no talisman from the child: ${r.reason ?? r.transcript.slice(-2).join(' / ')}`);
        await dismiss(sdk);
        // Out before the aunt is back: both in the house is the one unsafe place.
        await townGo(ctx, AUNT_WAIT, 0);
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

/**
 * stopgap until rs/309: try an action again when its click, made right after a position jump (a knockout's teleport,
 * a lock-pick through a door, Kruk's escort), was dropped together with every re-send (rs/309/2's cases from rs/201).
 * rs/309 makes lib/act count a click landed on the server's answer; then this function goes and each caller makes
 * one attempt. Every retry is noted, for rs/158's price.
 */
export async function stopgapRetry(label: string, tries: number, attempt: () => Promise<boolean>): Promise<boolean> {
    for (let i = 1; i <= tries; i++) {
        if (await attempt()) {
            if (i > 1) stepNote(`S15 stopgap ${label}: landed on attempt ${i}`);
            return true;
        }
        stepNote(`S15 stopgap ${label}: attempt ${i} of ${tries} did not land`);
    }
    return false;
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
    await upkeep(sdk, async () => {
        await jailSafe(sdk, async () => {
            if (inArea(sdk, AREAS.westWarehouse) && pos(sdk).level === 0) {
                // The roofs cross the temple's first floor among its religious guards: the zone prayer per step.
                for (const r of ROOFS) {
                    await legPrayer(sdk, r);
                    if (r.climb) await climb(sdk, r);
                    else await go(ctx, r);
                }
            }
            if (inArea(sdk, AREAS.atoll) && !outsideTown(sdk)) {
                if (pos(sdk).level === 0) {
                    await townGo(ctx, { x: BRIDGE_LADDER.x, z: BRIDGE_LADDER.z + 1 });
                    await climb(sdk, BRIDGE_LADDER);
                }
                // The jump off the bridge's end: 1 HP, refused while a monkey (quest_mm.rs2:1036-1043).
                await topUp(sdk);
                await legPrayer(sdk, JUMP_SQUARE);
                const r = await opLoc(sdk, { ...JUMP_SQUARE, op: /jump/i, radius: 15 }, /jump/i, s => outsideTown(s), { resendEvery: 5, maxTicks: 40 });
                if (!r.ok) throw new Error(`the bridge jump did not land (at ${where(sdk)})`);
                if (topUpFrom) await receiveTopUp(sdk, topUpFrom);
            }
            if (outsideTown(sdk)) {
                const foot = { x: DUNGEON_LADDER.x, z: DUNGEON_LADDER.z + 1 };
                await legPrayer(sdk, foot);
                await go(ctx, foot, 1);
                await immune(sdk, 'the dungeon (ladder)');
                // stopgap until rs/411: exec 5's chain 2 stood beside this ladder through 30 ticks of op re-sends after a
                // hit and an eat (t 967-968) and never climbed. A fresh walk to the foot and a new climb, at most twice more.
                const down = await stopgapRetry('dungeon ladder', 3, async () => {
                    try {
                        await climb(sdk, DUNGEON_LADDER);
                        return true;
                    } catch {
                        if (inArea(sdk, AREAS.dungeon)) return true;
                        await go(ctx, foot, 1);
                        return false;
                    }
                });
                if (!down) throw new Error(`the bamboo ladder at ${DUNGEON_LADDER.x},${DUNGEON_LADDER.z} did not move the player in 3 climbs (at ${where(sdk)})`);
            }
        });
        await praying(sdk, 'protect_from_melee', () => go(ctx, ZOOKNOCK, 2));
    });
}

/**
 * The atoll top-up (H12o): a helper and what it trades. `slots` is what the items take (a shark a slot, a potion a
 * slot), from the same ledger row as `want`.
 */
export interface TopUp {
    from: string;
    want: readonly WantSpec[];
    slots: number;
}

/** Ticks SCORED waits on the bridge jump's landing for the helper to be in view before asking for the trade. */
export const TOPUP_WAIT = 30;

/** Why SCORED can't take `t` now, or null: the server refuses a trade wholesale into a pack without room. */
export function topUpRefusal(s: BotWorldState, t: TopUp): string | null {
    return freeSlots(s) >= t.slots ? null : `the top-up from ${t.from} needs ${t.slots} free slots, ${freeSlots(s)} free`;
}

/**
 * Take the top-up on the bridge jump's landing (2803,2724). The cue: the helper, parked beside the landing with its
 * give() request standing, is among the players in view; SCORED waits for that up to TOPUP_WAIT ticks, then asks for
 * the trade (receiveFrom), accepting only `want`.
 */
async function receiveTopUp(sdk: Sdk, t: TopUp): Promise<void> {
    const refused = topUpRefusal(sdk.getState()!, t);
    if (refused) throw new Error(refused);
    const t0 = currentTick(sdk);
    const seen = await waitUntil(sdk, s => s.nearbyPlayers.some(p => sameName(p.name, t.from)), { maxTicks: TOPUP_WAIT });
    if (!seen.ok) throw new Error(`the top-up helper ${t.from} was not in view at ${where(sdk)} within ${TOPUP_WAIT} ticks`);
    const r = await receiveFrom(sdk as never, t.from, { want: [...t.want], maxTicks: 60, openMaxTicks: 20 });
    if (!r.ok) throw new Error(`the top-up from ${t.from}: ${r.reason ?? 'failed'} (at ${where(sdk)})`);
    stepNote(`S15:P top-up from ${t.from}: ${currentTick(sdk) - t0} ticks, received ${r.received.map(i => `${i.count} ${i.name}`).join(', ')}`);
}

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

/** S15's exit: Daero's training xp, and none of EXIT_DROPS held or worn. */
export const exitState: Check<MmContext> = s => {
    if (skillXp(s, 'Strength') < DAERO_STRENGTH_XP) return `Strength xp ${skillXp(s, 'Strength')} is below Daero's ${DAERO_STRENGTH_XP}`;
    const kept = EXIT_DROPS.filter(id => holds(s, id));
    return kept.length === 0 || `still holding ${kept.join(', ')} (S15's exit drops)`;
};

/**
 * Drop EXIT_DROPS: the sigil comes off first if worn (it needs a free slot), then every drop goes out in one tick
 * (a drop is a 0-tick inventory op while the player stands still).
 */
/** Drop every held `id` (no-op if none), confirmed from the published inventory. */
async function dropHeld(sdk: Sdk, id: number): Promise<void> {
    for (let i = 0; i < 3 && invCount(sdk, id) > 0; i++) {
        for (const it of sdk.getState()!.inventory.filter(x => x.id === id)) void sdk.sendDropItem(it.slot);
        await waitUntil(sdk, s => invCount(s, id) === 0, { maxTicks: 3 });
    }
    if (invCount(sdk, id) > 0) throw new Error(`could not drop ${id}`);
}

async function dropDead(sdk: Sdk): Promise<void> {
    if (sdk.getState()!.equipment.some(i => i.id === MM_OBJ.sigil)) await unwear(sdk, MM_OBJ.sigil);
    for (let i = 0; i < 3 && EXIT_DROPS.some(id => invCount(sdk, id) > 0); i++) {
        for (const it of sdk.getState()!.inventory.filter(x => EXIT_DROPS.includes(x.id))) void sdk.sendDropItem(it.slot);
        await waitUntil(sdk, s => !EXIT_DROPS.some(id => invCount(s, id) > 0), { maxTicks: 3 });
    }
    const left = EXIT_DROPS.filter(id => invCount(sdk, id) > 0);
    if (left.length) throw new Error(`could not drop ${left.join(', ')}`);
}

/** Waydar's arrival intro on Crash Island ends on his "Of course." (mm_waydar.rs2:70); no later Waydar or cutscene page says it. */
export function isWaydarIntroEnd(text: string): boolean {
    return /\bOf course\.(?!\w)/.test(text);
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
            s => (questStatus(s, 'mm') ?? 'not_started') === 'not_started' || holds(s, MM_OBJ.royalSeal) || 'Monkey Madness is already started',
            s => !kitMissing(s, o.bow).length || !!o.kitFrom || `H12 kit short and no kitFrom: ${kitMissing(s, o.bow).map(([n, k]) => `${k} ${n.source}`).join(', ')}`,
            s => (inGrandTree(s) && pos(s).level === 0) || chebyshev(pos(s), TREE_DOOR_OUTSIDE) <= 10 || `not at the Grand Tree (at ${JSON.stringify(pos(s))})`,
        ),
        async run(ctx, o) {
            const { sdk } = ctx;
            await gtSwap(ctx, o);
            await preDose(sdk);
            await intoTree(ctx, 0);
            // "Start Monkey Madness?" Yes (mm_narnode.rs2:124-140): the story, the seal and its objbox, the chapter card.
            const r = await talkTo(sdk, NARNODE_NPC, [/^Yes$/], { maxTicks: 200, idle: 4, near: NARNODE, closeModals: true, until: s => holds(s, MM_OBJ.royalSeal) });
            if (!holds(sdk.getState()!, MM_OBJ.royalSeal)) throw new Error(`no royal seal from Narnode: ${r.reason ?? r.transcript.slice(-2).join(' / ')}`);
            await dismiss(sdk);
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
                const g = await actConverse(sdk, await locClick(sdk, SHIPYARD_GATE, /^open$/i), [], { done: s => pos(s).x >= SHIPYARD_GATE.x, maxTicks: 90, idle: 8, resendEvery: 10 });
                if (pos(sdk).x < SHIPYARD_GATE.x) throw new Error(`the shipyard gate did not open: ${g.reason} (at ${where(sdk)})`);
            }
            await go(ctx, CARANOCK, 1);
            await talk(sdk, /Caranock$/i, [], { near: CARANOCK, minPages: 6 });
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
            const r = await talkTo(sdk, NARNODE_NPC, [], { maxTicks: 200, idle: 6, near: NARNODE, closeModals: true, until: s => holds(s, MM_OBJ.orders) });
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
                maxTicks: 300, idle: 8, near: DAERO, closeModals: true, until: s => inArea(s, OLD_HANGAR),
            });
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
                await talk(sdk, /^Daero$/i, [], { minPages: 10, idle: 4 });
                await dismiss(sdk);
            }
            const panel = (await sdk.scanNearbyLocs(20)).find(l => /reinitialisation panel/i.test(l.name));
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
            const d = await talkTo(sdk, /^Daero$/i, [], { maxTicks: 120, idle: 4, near: DAERO_HANGAR });
            if (!d.ok) throw new Error(`Daero: ${d.reason}`);
            const r = await talkTo(sdk, /^Waydar$/i, [/^Yes$/], { maxTicks: 120, idle: 4, closeModals: false, until: s => inArea(s, CRASH_ISLAND) });
            if (!inArea(sdk, CRASH_ISLAND)) throw new Error(`Waydar did not fly to Crash Island: ${r.reason ?? r.transcript.slice(-2).join(' / ')}`);
        },
        postconditions: s => inArea(s, CRASH_ISLAND) || 'not on Crash Island',
    },
    G: {
        preconditions: s => inArea(s, CRASH_ISLAND) || inArea(s, AREAS.atoll) || 'not on Crash Island',
        async run(ctx, o) {
            const { sdk } = ctx;
            if (inArea(sdk, AREAS.atoll)) return;
            // Lumdo (no choices): proof by the seal, then he won't take the player (mm_lumdo.rs2:32-75).
            const l = await talkTo(sdk, /^Lumdo$/i, [], { maxTicks: 120, idle: 3 });
            if (!l.ok) throw new Error(`Lumdo: ${l.reason}`);
            // Waydar orders Lumdo (within 10 tiles), then the chapter 2 cutscene, which ends on the atoll (mm_waydar.rs2:54-82).
            const onAtoll = (s: BotWorldState) => inArea(s, AREAS.atoll) && pos(s).level === 0;
            // The flight leaves mm_waydar at 0, so the first talk is his 4-page arrival intro (mm_waydar.rs2:65-70), which
            // sets it to arrived; only the next talk offers the Lumdo option. converse's `until` sees closed states only, so
            // the intro's last page is watched beside the talk, and the talk ends as soon as that page has closed.
            for (let i = 0; i < 2 && !onAtoll(sdk.getState()!); i++) {
                let introOver = false;
                const unwatch = sdk.onStateUpdate(s => {
                    if (isWaydarIntroEnd(pageText(s.dialog))) introOver = true;
                });
                try {
                    const w = await talkTo(sdk, /^Waydar$/i, [/cannot convince Lumdo/i], {
                        maxTicks: 400, idle: 3, closeModals: true, until: s => onAtoll(s) || introOver,
                    });
                    o.note(`S15:G Waydar: ${w.pages} pages, ${w.ticks} ticks${introOver ? ' (arrival intro)' : ''}${onAtoll(sdk.getState()!) ? ', on the atoll' : ''}`);
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
                await talk(ctx.sdk, /garkor/i, [], { near: GARKOR, minPages: 20 });
            }));
        },
    },
    J: {
        preconditions: all(onAtoll, human, roomFor(MM_OBJ.dentures, MM_OBJ.amuletMould)),
        async run(ctx, o) {
            const { sdk } = ctx;
            await upkeep(sdk, () => jailSafe(sdk, async () => {
                await toTown(ctx);
                if (!holds(sdk.getState()!, MM_OBJ.dentures)) {
                    await townGo(ctx, DENTURE_CRATE_EAST, 0, inCrateStrip(sdk) ? [] : [CRATES_FROM_GARKOR, CRATES]);
                    await searchCrate(sdk, DENTURE_CRATE, /^Yes$/, s => holds(s, MM_OBJ.dentures), 'denture crate', o.note);
                }
                if (!inArea(sdk, AREAS.cellar)) {
                    await townGo(ctx, { x: HOLE_CRATE.x, z: HOLE_CRATE.z + 1 }, 0, inCrateStrip(sdk) ? [] : [CRATES_FROM_GARKOR, CRATES]);
                    await searchCrate(sdk, HOLE_CRATE, /Yes, I'm sure/, s => inArea(s, AREAS.cellar), 'crate over the hole', o.note);
                }
                if (!holds(sdk.getState()!, MM_OBJ.amuletMould)) {
                    await go(ctx, { x: MOULD_CRATE.x, z: MOULD_CRATE.z - 1 }, 1);
                    await searchCrate(sdk, MOULD_CRATE, /^Yes$/, s => holds(s, MM_OBJ.amuletMould), 'mould crate', o.note);
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
        preconditions: () => true,
        pre: o => all(holding(MM_OBJ.sigil, o.bow), s => invCount(s, MM_OBJ.runeArrow) > 0 || s.equipment.some(i => i.id === MM_OBJ.runeArrow) || 'no rune arrows'),
        run: (ctx, o) => demonFight(ctx, o.note, o.bow),
    },
    P: {
        preconditions: all(human, holding(MM_OBJ.talisman, MM_OBJ.monkeyBones), s => inArea(s, AREAS.atoll) || inArea(s, AREAS.dungeon) || 'not on the atoll or in its dungeon'),
        run: (ctx, o) => withTopUps(() => toZooknock(ctx, o.topUpFrom)),
        postconditions: atZooknock,
    },
    L: {
        preconditions: all(s => inArea(s, AREAS.dungeon) || 'not in the dungeon', s => holds(s, MM_OBJ.dentures) || holds(s, MM_OBJ.amuletMould) || 'no dentures or mould'),
        async run(ctx) {
            const { sdk } = ctx;
            if (chebyshev(pos(sdk), ZOOKNOCK) > 3) await upkeep(sdk, () => go(ctx, ZOOKNOCK, 2));
            // The story to need_items (mm_zooknock.rs2:28-37, 304-345), then the amulet's list and back out (259-280).
            await talk(sdk, /zooknock/i, [/What do we need for the monkey amulet\?/, /I'll be back later/], { near: ZOOKNOCK, minPages: 4 });
            const bar: Pred = s => holds(s, MM_OBJ.enchantedBar);
            for (const id of [MM_OBJ.dentures, MM_OBJ.goldBar]) {
                const n = invCount(sdk, id);
                if (n > 0) await useOnNpc(sdk, id, /zooknock/i, s => invCount(s, id) < n || bar(s));
            }
            // The last item completes the amulet check: four pages, a p_delay(4), then the enchanted bar and the mould back (mm_zooknock.rs2:186-197).
            if (!bar(sdk.getState()!)) await useOnNpc(sdk, MM_OBJ.amuletMould, /zooknock/i, bar, 6);
            await dismiss(sdk);
        },
        postconditions: holding(MM_OBJ.enchantedBar, MM_OBJ.amuletMould),
    },
    N: {
        preconditions: all(onAtoll, human, holding(MM_OBJ.enchantedBar, MM_OBJ.amuletMould, MM_OBJ.ballOfWool)),
        async run(ctx, o) {
            const { sdk } = ctx;
            await upkeep(sdk, async () => {
                if (!underTemple(sdk)) {
                    await jailSafe(sdk, async () => {
                        await toTown(ctx);
                        // Protect from Melee from here to the temple: the ladder's foot is beside the guard at (2795,2775),
                        // and a hand-over to the trapdoor's prayer there would leave an unprayed tick (gate chain b: 7 + 12).
                        if (o.templeMethod !== 'wait' && pos(sdk).level === 0 && chebyshev(pos(sdk), TRAPDOOR_ACCESS) > 0) {
                            await setPrayer(sdk, 'protect_from_melee', true);
                            await townGo(ctx, TEMPLE_LADDER_FOOT, 0);
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
                // Protect from Melee through every walk between the wait tile and the house, not only the waits: gate chain
                // b took 14 (23 HP to 9) on its first unprayed step off the wait tile.
                await praying(sdk, 'protect_from_melee', () => childTalks(ctx, o.note, progress));
            })));
        },
        postconditions: holding(MM_OBJ.talisman),
    },
    Q: {
        preconditions: all(human, s => inArea(s, AREAS.dungeon) || 'not in the dungeon', s => holds(s, MM_OBJ.greegree) || (holds(s, MM_OBJ.talisman) && holds(s, MM_OBJ.monkeyBones)) || 'no talisman and bones'),
        async run(ctx, o) {
            const { sdk } = ctx;
            await upkeep(sdk, async () => {
                const gree: Pred = s => holds(s, MM_OBJ.greegree);
                if (!gree(sdk.getState()!)) {
                    if (chebyshev(pos(sdk), ZOOKNOCK) > 3) await praying(sdk, 'protect_from_melee', () => go(ctx, ZOOKNOCK, 2));
                    // The talisman, then the bones, which complete the talisman check: one page, a p_delay(4), the
                    // gree-gree, an objbox and three pages, with the chapter 3 cutscene queued (mm_zooknock.rs2:203-228).
                    for (const id of [MM_OBJ.talisman, MM_OBJ.monkeyBones]) {
                        const n = invCount(sdk, id);
                        if (n > 0 && !gree(sdk.getState()!)) await useOnNpc(sdk, id, /zooknock/i, s => invCount(s, id) < n || gree(s), 6);
                    }
                    const w = await waitUntil(sdk, gree, { maxTicks: 15 });
                    if (!w.ok) throw new Error('Zooknock gave no gree-gree for the talisman and bones');
                }
                if (!inArea(sdk, AREAS.dungeon) || sdk.getState()!.dialog.isOpen) {
                    const pages = await chapterCutscene(sdk, 0, 'chapter 3');
                    o.note(`S15:Q chapter 3: ${pages} pages`);
                } else {
                    // Still beside Zooknock with the gree-gree: the cutscene is queued behind the closing pages, or done.
                    const started = await waitUntil(sdk, s => s.dialog.isOpen || tileIn(pos(s), { ...CUTSCENE_ZONE, level: 0 }), { maxTicks: 8 });
                    if (started.ok) o.note(`S15:Q chapter 3: ${await chapterCutscene(sdk, 0, 'chapter 3')} pages`);
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
                await talk(sdk, /garkor/i, [], { near: GARKOR, minPages: 4 });
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
                await talk(sdk, /^Elder Guard$/i, [], { near: ELDER_GUARD, minPages: 4 });
                await go(ctx, WATCHTOWER_WEST, 1);
                // Measured: the base ladder takes the player straight to the bridge (level 2).
                for (let i = 0; i < 2 && pos(sdk).level < 2; i++) await climb(sdk, WATCHTOWER_WEST, /^climb-up$/i);
                await go(ctx, BRIDGE_EAST_END, 0);
                for (let i = 0; i < 2 && pos(sdk).level > 0; i++) await climb(sdk, WATCHTOWER_EAST, /^climb-down$/i);
                const escorted = (s: BotWorldState) => chebyshev(pos(s), THRONE) <= 4;
                const k = await talkTo(sdk, /^Kruk$/i, [], { maxTicks: 120, idle: 6, until: escorted, near: KRUK });
                if (!escorted(sdk.getState()!)) throw new Error(`Kruk did not escort the player: ${k.reason ?? k.transcript.slice(-2).join(' / ')} (at ${where(sdk)})`);
                await dismiss(sdk);
                let r!: Awaited<ReturnType<typeof actConverse>>;
                await stopgapRetry('throne after the escort', 3, async () => {
                    r = await actConverse(sdk, await locClick(sdk, THRONE, /./), [], { maxTicks: 120, idle: 3, resendEvery: 6 });
                    return r.dialogue?.opened === true;
                });
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
                    const r = await talkTo(sdk, MINDER, [], { maxTicks: 120, idle: 6, until: inCage });
                    if (!inCage(sdk)) throw new Error(`the minder did not cage the monkey: ${r.reason ?? r.transcript.slice(-2).join(' / ')} (at ${where(sdk)})`);
                }
                // 16 pages, no choice; the amulet is all it needs (mm_zoo_monkey.rs2:1-35).
                const zooMonkey = talkableNpc(st(), /^Monkey$/, CAGE_ENTRY);
                if (!zooMonkey) throw new Error(`no monkey to talk to in the cage (at ${where(sdk)})`);
                const m = await talkTo(sdk, zooMonkey, [], { maxTicks: 120, idle: 3, until: s => holds(s, MM_OBJ.monkey) });
                if (!holds(st(), MM_OBJ.monkey)) throw new Error(`no monkey in the backpack: ${m.reason ?? m.transcript.slice(-2).join(' / ')}`);
            }
            if (inCage(sdk)) {
                // A human in the cage is let out beside the minder (mm_monkey_minder.rs2:13-25).
                await unwear(sdk, MM_OBJ.greegree);
                const r = await talkTo(sdk, MINDER, [], { maxTicks: 120, idle: 6, until: s => !inCage(s), interrupts: [MONKEY_CHATTER] });
                if (inCage(sdk)) throw new Error(`the minder did not let the player out: ${r.reason ?? r.transcript.slice(-2).join(' / ')}`);
            }
            await dismiss(sdk);
        },
        postconditions: all(holding(MM_OBJ.monkey, MM_OBJ.greegree), s => !inCage(s) || 'still in the cage'),
    },
    U: {
        preconditions: all(holding(MM_OBJ.monkey, MM_OBJ.greegree), s => wearing(s, MM_OBJ.amulet) || 'the amulet is not worn'),
        async run(ctx) {
            const { sdk } = ctx;
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
                    const g = await talkTo(sdk, /^Elder Guard$/i, [], { maxTicks: 60, idle: 3, near: ELDER_GUARD, until: inThroneRoom, ...CHATTER });
                    if (!inThroneRoom(sdk)) throw new Error(`the Elder Guard did not let the player in: ${g.reason ?? g.transcript.slice(-2).join(' / ')} (at ${where(sdk)})`);
                }
                // "Have you brought with you a captive?" Yes: the monkey goes, then mm_awowogei_success's 7 pages (mm_awowogei.rs2:40-50, 105-116).
                const r = await actConverse(sdk, await locClick(sdk, THRONE, /./), [], { maxTicks: 90, idle: 3, resendEvery: 6, ...CHATTER });
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
                    const g = await talkTo(sdk, /^Elder Guard$/i, [], { maxTicks: 60, idle: 3, near: ELDER_GUARD, until: s => !inThroneRoom(s) });
                    if (inThroneRoom(sdk)) throw new Error(`the Elder Guard did not show the player out: ${g.reason ?? g.transcript.slice(-2).join(' / ')}`);
                }
                if (chebyshev(pos(sdk), GARKOR) > 2) {
                    for (const p of GARKOR_NORTH.points) await go(ctx, p, 1);
                }
                // Garkor at awowogei_complete_mission: 6 pages, then the chapter 4 cutscene (mm_garkor.rs2:129-137,
                // quest_mm.rs2:211); at learned_plan (the cutscene seen): the plan, then the sigil (mm_garkor.rs2:25-47).
                const ch4 = (s: BotWorldState) => tileIn(pos(s), { ...CUTSCENE_ZONE, level: 1 });
                const first = await talkTo(sdk, /garkor/i, [], { maxTicks: 120, idle: 3, near: GARKOR, until: s => ch4(s) || holds(s, MM_OBJ.sigil) });
                if (ch4(sdk.getState()!) || (!holds(sdk.getState()!, MM_OBJ.sigil) && (await waitUntil(sdk, ch4, { maxTicks: 8 })).ok)) {
                    o.note(`S15:W chapter 4: ${await chapterCutscene(sdk, 1, 'chapter 4')} pages`);
                } else if (!holds(sdk.getState()!, MM_OBJ.sigil)) {
                    throw new Error(`Garkor started neither the chapter 4 cutscene nor the plan: ${first.reason ?? first.transcript.slice(-2).join(' / ')} (at ${where(sdk)})`);
                }
                const r = holds(sdk.getState()!, MM_OBJ.sigil) ? first : await talkTo(sdk, /garkor/i, [], { maxTicks: 120, idle: 3, near: GARKOR, until: s => holds(s, MM_OBJ.sigil) });
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
            const r = await talkTo(sdk, /^King Narnode( Shareen)?$/i, [], { maxTicks: 200, idle: 3, near: NARNODE, closeModals: true, until: s => questStatus(s, 'mm') === 'complete' });
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
            // daero_training (mm_daero.rs2:240-312): 9 pages, option 1, "Several hours later...", then the xp.
            const r = await talkTo(sdk, /^Daero$/i, [/^Focus on increasing strength and stamina/], {
                maxTicks: 150, idle: 4, near: DAERO, closeModals: true, until: s => skillXp(s, 'Strength') >= xp0 + DAERO_STRENGTH_XP,
            });
            if (skillXp(sdk.getState()!, 'Strength') < xp0 + DAERO_STRENGTH_XP) throw new Error(`no training xp from Daero: ${r.reason ?? r.transcript.slice(-2).join(' / ')}`);
            await dismiss(sdk);
            await dropDead(sdk);
        },
        postconditions: exitState,
    },
    M: {
        preconditions: all(s => inArea(s, AREAS.dungeon) || inArea(s, AREAS.atoll) || 'not on the atoll or in its dungeon', holding(MM_OBJ.enchantedBar)),
        async run(ctx) {
            const { sdk } = ctx;
            await upkeep(sdk, async () => {
                if (inArea(sdk, AREAS.dungeon)) {
                    await immune(sdk, 'the dungeon (M)');
                    await praying(sdk, 'protect_from_melee', () => go(ctx, { x: DUNGEON_EXIT.x, z: DUNGEON_EXIT.z + 1 }, 1));
                    await climb(sdk, DUNGEON_EXIT);
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
    const step: Step<MmContext> = {
        name,
        logoutSafe: d.logoutSafe,
        preconditions: body?.pre?.(o) ?? body?.preconditions ?? (() => `${name} is not written yet`),
        // The gnome half (A-G) runs under the same upkeep as the atoll segments, which wrap their own bodies.
        run: body ? ctx => {
            stepNote = o.note;
            eating = {
                below: eatBelowFor(o.eating, d.letter), corridorBelow: eatBelowFor(o.eating, d.letter, true),
                ...(o.eating.topUpBelow !== undefined ? { topUpBelow: o.eating.topUpBelow } : {}),
            };
            return d.letter <= 'G' ? upkeep(ctx.sdk, () => body.run(ctx, o)) : body.run(ctx, o);
        } : async () => {
            throw new Error(`${name} is not written yet`);
        },
        postconditions: body?.postconditions ?? (() => true),
        ...(d.travel ? {} : { done: doneAt(d.letter), probes: [JOURNAL_PROBE] }),
        ...(body?.inProgress ? { inProgress: body.inProgress } : {}),
        ...(body?.resume ? { resume: body.resume } : {}),
    };
    return step;
}

/** The module's steps, one per segment A-Z. */
export function steps(opts: Options = {}): Step<MmContext>[] {
    const o = resolveOptions(opts);
    if (o.dialogue === 'burst') throw new Error("dialogue 'burst' needs rs/200's converse burst mode, which is not on this branch yet");
    return SEGMENTS.map(d => stepFor(d, o));
}
