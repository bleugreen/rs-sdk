// Monkey Madness lab fixtures: the game state at the start of each segment
// (speedrun/quests/monkey-madness.ts), for running any segment alone at the
// route's levels. Lab only: staff commands, never imported by the module.
//
// The royal seal is held only through B (the module drops it after Caranock's gate: nothing later reads it), Zooknock
// returns the mould with the enchanted bar, and the sigil is kept: those two are held to S15's end, where Z drops them.
// No bananas are carried: O searches them from the trees in the aunt's house.
//
// Sub-varp values are cumulative and follow what a played route leaves
// (configs/quest_mm.constant, configs/quest_mm.varbit; ::setvar takes varbit
// names). Where a fixture differs from quest-mm-full.ts's STARTS it says why.
//
// Run as a script it is the module's acceptance runner (the CLI of the
// planned lab/quests/run.ts): set up the fixture of --from, run the segments
// --from..--until, and print each segment's ticks over --runs runs.
//
//   speedrun/lab/lab.sh <bot> speedrun/lab/quests/monkey-madness.ts:--from=H:--until=J:--runs=3
//   LAB_RUNNERS=0 speedrun/lab/lab.sh <bot> speedrun/lab/quests/monkey-madness.ts:--from=H:--launch   (relogs after each fixture)
//
// Other flags: --trace=N (tile, HP, prayer, hits, dialog and knockouts), --sharks=N, --potions=N
// (prayer potions instead of H12's 6, the freed slots going to sharks), --dialogue=fixed|burst, --client=lite|browser, --pinned (O only:
// start at the Varrock teleport's landing with the spare Varrock set spent, as a temple-rope pin leaves it).
// Consumption: every run prints a census (mm_census: the state at each segment boundary and what each segment
// used) and the end a mean/max table. --trade=D tops up before D with ::give (the gnome-half helper trade):
// prayer potions to --topPotions=N held (default 2), then sharks into the free slots less topUpReserve.
// --stage=all also tops up before every later segment, so a chain survives to measure what it eats.
// --throwAt=T|N (with --launch): the run throws at that point as a crash would (THROW_POINTS), then relogs and resumes
// through the runner's resolveResume to --until, as a manual re-run does; mm_resume and mm_resumed report it.
// --neverAccept (P): H12o-P's helper is a second lab session on P's tile that opens SCORED's trade, offers the super
// antipoison and never accepts; the run reports what it saw and the leg's last cue (P's final stop expected).
// --loadCap=L: a run due while the host's 1-minute load is L or more starts only after a minute under L (a shared lab host).
// --absentHelper (P): H12o-P's helper is an account that never logs in, so P's leg waits TOPUP_WAIT and moves on.
// --knockout=N (P): N ticks after SCORED first stands at the bridge jump's landing, a staged knockout (stagedKnockout).
// --talismanDrain (O): rs/513 chain 1's failure staged: when the child's talisman page opens, prayer is drained to
// DRINK_BELOW - 1, so upkeep's prayer drink falls due while the talk is open (mm_talisman_drain reports it).
// --poison=SEV: SCORED is poisoned (::~poison, cheat_other.rs2) before the first segment and carries it in: the run starts
// --poisonAge=N ticks (default 4) after the first poison hit, so 'You have been poisoned!' is over 32 ticks old and only the
// hitsplat shows it, as at attempt 4's A. Any --poison first resets %poison to 0 (a carried poison or an antipoison's
// immunity), so --poison=0 stages a clean run. --hp=N lowers current HP to N (::~hit) after it. mm_run reports the poison hits
// taken during the run and the antipoison doses before and after.
// --h45 on a chain with P and not M: M's cues are written first (M's open, then its stop and P's open), as M leaves them
// when it trades nothing, so h45 is logged in and serving P when P lands.

import { mkdtempSync, readFileSync } from 'fs';
import { hostname, loadavg, tmpdir } from 'os';
import { join } from 'path';

import type { BotSDK } from '../../../sdk/index';
import { PRAYER_NAMES, type BotWorldState } from '../../../sdk/types';
import { wield } from '../../lib/act';
import { closeSession, loadBotEnv, logoutClean, openSession, relog, type Session } from '../../lib/session';
import { isTradeRequest, openTrade, sameName, tradeOf } from '../../lib/trade';
import { readCue } from '../../helpers/altar-cue';
import { TickLog } from '../../lib/ticks';
import { waitTicks, waitUntil } from '../../lib/wait';
import { chebyshev, configId, pos } from '../../lib/world';
import { BELOW_30_EATING, DRINK_BELOW, H12_POTIONS, H12_SHARKS, inCage, inCell, JOURNAL_PROBE, legCue, MM_OBJ, outsideTown, underTemple, REWARD_ITEMS, SEGMENT_EATING, SEGMENTS, segmentName, steps, type EatPolicy, type MmContext, type TopUp } from '../../quests/monkey-madness';
import { slotNeed } from '../../quests/segments';
import { H45_BOT, h45Env, launchH45, stageH45, type H45Launcher } from '../h45';
import { journalProbe } from '../../lib/quests';
import { Observation, resolveResume } from '../../runner/resume';
import { BOUNDARY_STEP, runSteps, type Step } from '../../runner/step';
import { launchLabBrowser } from '../browser';
import { arg, botArg, result } from '../common';
import { cheat, clearInventory, give, leaveTutorial, mustTele, readVars, setStats, setVars, tele } from '../setup';

/** Route levels at S15 (RUN-ORDER S15, coordinator 15:40 for Prayer 94; Thieving and Agility from S12 and S11b). */
export const ROUTE_LEVELS = {
    attack: 99, defence: 1, strength: 1, hitpoints: 42, ranged: 50, prayer: 94, magic: 76, thieving: 57, agility: 75,
} as const;

/**
 * The prerequisite quests' final stages (Tree Gnome Village, The Grand Tree), Plague City's read scroll (S08; the
 * Ardougne teleport of T needs elenaquest 30, ^elena_complete_read_scroll, teleport.rs2:35), and Femi never met: the
 * route reaches the stronghold only by spirit tree before U, whose walk home is its first pass of the south gate.
 */
export const PREREQ_VARS = { treequest: 9, grandtree: 160, elenaquest: 30, femi_help: 0 } as const;

/** Every MM var a fixture may set; each fixture sets all of them, so state from a previous fixture never leaks. */
export const MM_VARS = [
    'mm_main', 'mm_narnode', 'mm_caranock', 'mm_daero', 'mm_waydar', 'mm_lumdo', 'mm_garkor', 'mm_zooknock', 'mm_monkey_child',
    'mm_kruk', 'mm_elder_guard', 'mm_awowogei', 'mm_jail_count', 'mm_monkey_minder', 'mm_zooknock_monkey_relic',
    'mm_daero_option_bit_one', 'mm_daero_option_bit_two', 'mm_daero_option_bit_three', 'mm_hangar_puzzle_complete', 'mm_hangar_cutscene_flag',
    'mm_player_is_unconscious', 'mm_zooknock_has_gold_bar', 'mm_zooknock_has_amulet_mould', 'mm_zooknock_has_dentures',
    'mm_zooknock_has_magical_talisman', 'mm_zooknock_has_monkey_relic', 'mm_zooknock_player_is_collecting_for_amulet',
    'mm_zooknock_player_is_collecting_for_talisman', 'mm_monkey_child_waiting_for_talisman', 'mm_waiting_for_final_battle', 'mm_been_to_final_battle',
] as const;
export type MmVar = (typeof MM_VARS)[number];

/**
 * H12's kit by debug name (SUPPLIES.md H12; rs/158's 23:40 ruling, food per its 10-22 07:0x ruling). Runes: two Varrock casts (1 law, 3 air, 1 fire
 * each: Y's teleport home and the spare for a temple rope pin), Ardougne 2 casts (2 law, 2 water each). 200 rune arrows:
 * one Jungle Demon kill ran dry at 100.
 */
export const KIT: Readonly<Record<string, number>> = {
    gold_bar: 1, ball_of_wool: 1, mm_normal_monkey_bones: 1, magic_shortbow: 1, rune_arrow: 200,
    '4doseprayerrestore': H12_POTIONS, shark: H12_SHARKS, '4dose2antipoison': 1, lawrune: 6, airrune: 6, firerune: 2, waterrune: 4,
};

/** Kit items each segment uses up, by the segment that uses them. */
const KIT_SPENT: Readonly<Record<string, Readonly<Record<string, number>>>> = {
    L: { gold_bar: 1 },
    N: { ball_of_wool: 1 },
    Q: { mm_normal_monkey_bones: 1 },
    T: { lawrune: 2, waterrune: 2 }, // the Ardougne teleport to the zoo
    Y: { lawrune: 1, airrune: 3, firerune: 1 }, // the Varrock teleport home
};

export interface Fixture {
    letter: string;
    /** MM vars that are not 0 at this segment's start. */
    vars: Partial<Record<MmVar, number>>;
    /** Quest items held (debug name -> count), on top of the remaining kit. */
    items: Readonly<Record<string, number>>;
    /** Worn at the start (debug names; each must also be given). */
    worn?: readonly string[];
    tile: { x: number; z: number; level: number };
    /** Slots left empty after the sharks (default FREE_KEPT): what the segments ahead pick up before any shark goes. */
    keepFree?: number;
    note?: string;
}

const ATOLL_ARRIVED = { mm_main: 3, mm_narnode: 7, mm_caranock: 3, mm_daero: 7, mm_waydar: 1, mm_lumdo: 3 } as const;
const HANGAR_DONE = { mm_daero_option_bit_one: 1, mm_daero_option_bit_two: 1, mm_daero_option_bit_three: 1, mm_hangar_puzzle_complete: 1 } as const;
const AMULET_DONE = { mm_zooknock: 5, mm_zooknock_has_gold_bar: 1, mm_zooknock_has_amulet_mould: 1, mm_zooknock_has_dentures: 1, mm_zooknock_player_is_collecting_for_talisman: 1 } as const;
const CH3_DONE = { ...ATOLL_ARRIVED, ...HANGAR_DONE, ...AMULET_DONE, mm_main: 4, mm_zooknock: 6, mm_zooknock_player_is_collecting_for_talisman: 0, mm_zooknock_has_magical_talisman: 1, mm_zooknock_has_monkey_relic: 1, mm_zooknock_monkey_relic: 5, mm_monkey_child: 7, mm_monkey_child_waiting_for_talisman: 1, mm_jail_count: 2 } as const;
const ZOOKNOCK = { x: 2804, z: 9145, level: 0 };
const GARKOR = { x: 2805, z: 2762, level: 0 };
/** Out of the jail yard, where leaveCell ends (quests/monkey-madness.ts YARD_ESCAPE); the tile beside the cell door is on the patrol route. */
const OUTSIDE_CELL = { x: 2765, z: 2794, level: 0 };
const NARNODE = { x: 2465, z: 3496, level: 0 };
const AWOWOGEI = { x: 2802, z: 2762, level: 0 }; // where Kruk's escort leaves the player (mm_kruk.rs2:29)

export const FIXTURES: readonly Fixture[] = [
    { letter: 'A', vars: {}, items: {}, worn: ['magic_shortbow', 'rune_arrow'], keepFree: 1, tile: NARNODE, note: 'as the Grand Tree swap leaves it (bow wielded, arrows quivered); the one free slot is for the seal' },
    { letter: 'B', vars: { mm_main: 1, mm_narnode: 3 }, items: { mm_gnome_royal_seal: 1 }, tile: NARNODE },
    { letter: 'C', vars: { mm_main: 2, mm_narnode: 3, mm_caranock: 3 }, items: {}, tile: { x: 2956, z: 3024, level: 0 }, note: 'mm_main 2 as a played route leaves it (mm_caranock.rs2:51); STARTS has 1' },
    { letter: 'D', vars: { mm_main: 2, mm_narnode: 7, mm_caranock: 3 }, items: { mm_narnode_orders: 1 }, tile: NARNODE },
    { letter: 'E', vars: { mm_main: 2, mm_narnode: 7, mm_caranock: 3, mm_daero: 4, mm_daero_option_bit_one: 1, mm_daero_option_bit_two: 1, mm_daero_option_bit_three: 1 }, items: {}, tile: { x: 2393, z: 9892, level: 0 }, note: 'no puzzle-complete flag: the full 255-step scramble is under test (STARTS forces the one-move board)' },
    { letter: 'F', vars: { mm_main: 2, mm_narnode: 7, mm_caranock: 3, mm_daero: 6, ...HANGAR_DONE }, items: {}, tile: { x: 2649, z: 4508, level: 0 } },
    { letter: 'G', vars: { mm_main: 2, mm_narnode: 7, mm_caranock: 3, mm_daero: 7, ...HANGAR_DONE }, items: {}, worn: ['magic_shortbow', 'rune_arrow'], tile: { x: 2893, z: 2726, level: 0 }, note: 'mm_waydar 0 as the flight leaves it (measured: his first talk on the island is the arrival intro)' },
    { letter: 'H', vars: { ...ATOLL_ARRIVED, ...HANGAR_DONE }, items: {}, tile: { x: 2801, z: 2707, level: 0 } },
    { letter: 'I', vars: { ...ATOLL_ARRIVED, ...HANGAR_DONE, mm_jail_count: 1 }, items: {}, tile: OUTSIDE_CELL },
    { letter: 'J', vars: { ...ATOLL_ARRIVED, ...HANGAR_DONE, mm_jail_count: 1, mm_garkor: 2 }, items: {}, tile: GARKOR },
    { letter: 'K', vars: { ...ATOLL_ARRIVED, ...HANGAR_DONE, mm_jail_count: 1, mm_garkor: 2 }, items: { mm_monkey_dentures: 1, mm_monkey_amulet_mould: 1 }, tile: { x: 2749, z: 2768, level: 0 }, note: 'the western rope lands within 2 of (2749,2768) (quest_mm.rs2:1012-1017)' },
    { letter: 'L', vars: { ...ATOLL_ARRIVED, ...HANGAR_DONE, mm_jail_count: 1, mm_garkor: 2 }, items: { mm_monkey_dentures: 1, mm_monkey_amulet_mould: 1 }, tile: ZOOKNOCK },
    { letter: 'M', vars: { ...ATOLL_ARRIVED, ...HANGAR_DONE, ...AMULET_DONE, mm_jail_count: 1, mm_garkor: 2 }, items: { mm_enchanted_gold_bar: 1, mm_monkey_amulet_mould: 1 }, tile: ZOOKNOCK },
    { letter: 'N', vars: { ...ATOLL_ARRIVED, ...HANGAR_DONE, ...AMULET_DONE, mm_jail_count: 2, mm_garkor: 2 }, items: { mm_enchanted_gold_bar: 1, mm_monkey_amulet_mould: 1 }, tile: OUTSIDE_CELL },
    { letter: 'O', vars: { ...ATOLL_ARRIVED, ...HANGAR_DONE, ...AMULET_DONE, mm_jail_count: 2, mm_garkor: 2 }, items: { mm_amulet_of_monkey_speak: 1, mm_monkey_amulet_mould: 1 }, tile: { x: 2794, z: 2774, level: 0 }, note: 'N ends out of the trapdoor guards\' box: by the ladders (here, the south ladder\'s foot) or by a walk west' },
    { letter: 'P', vars: { ...ATOLL_ARRIVED, ...HANGAR_DONE, ...AMULET_DONE, mm_jail_count: 2, mm_garkor: 2, mm_monkey_child: 7, mm_monkey_child_waiting_for_talisman: 1 }, items: { mm_amulet_of_monkey_speak: 1, mm_monkey_talisman: 1, mm_monkey_amulet_mould: 1 }, worn: ['mm_amulet_of_monkey_speak'], tile: { x: 2743, z: 2797, level: 0 } },
    { letter: 'Q', vars: { ...ATOLL_ARRIVED, ...HANGAR_DONE, ...AMULET_DONE, mm_jail_count: 2, mm_garkor: 2, mm_monkey_child: 7, mm_monkey_child_waiting_for_talisman: 1 }, items: { mm_amulet_of_monkey_speak: 1, mm_monkey_talisman: 1, mm_monkey_amulet_mould: 1 }, worn: ['mm_amulet_of_monkey_speak'], tile: ZOOKNOCK },
    { letter: 'R', vars: { ...CH3_DONE, mm_garkor: 2 }, items: { mm_amulet_of_monkey_speak: 1, mm_monkey_greegree_for_normal_monkey: 1, mm_monkey_amulet_mould: 1 }, worn: ['mm_amulet_of_monkey_speak'], tile: ZOOKNOCK, note: 'the chapter 3 cutscene returns the player to the tile it was queued from (%mm_cutscene_coord, quest_mm.rs2:469): next to Zooknock' },
    { letter: 'S', vars: { ...CH3_DONE, mm_garkor: 4 }, items: { mm_amulet_of_monkey_speak: 1, mm_monkey_greegree_for_normal_monkey: 1, mm_monkey_amulet_mould: 1 }, worn: ['mm_amulet_of_monkey_speak', 'mm_monkey_greegree_for_normal_monkey'], tile: GARKOR },
    { letter: 'T', vars: { ...CH3_DONE, mm_garkor: 4, mm_kruk: 1, mm_elder_guard: 1, mm_awowogei: 1 }, items: { mm_amulet_of_monkey_speak: 1, mm_monkey_greegree_for_normal_monkey: 1, mm_monkey_amulet_mould: 1 }, worn: ['mm_amulet_of_monkey_speak', 'mm_monkey_greegree_for_normal_monkey'], tile: AWOWOGEI },
    { letter: 'U', vars: { ...CH3_DONE, mm_garkor: 4, mm_kruk: 1, mm_elder_guard: 1, mm_awowogei: 1, mm_monkey_minder: 1 }, items: { mm_amulet_of_monkey_speak: 1, mm_monkey_greegree_for_normal_monkey: 1, mm_monkey_amulet_mould: 1, mm_monkey_in_backpack: 1 }, worn: ['mm_amulet_of_monkey_speak'], tile: { x: 2611, z: 3283, level: 0 }, note: 'where T ends, outside the zoo cage (T measured 2606-2612, 3283-3285); (2614,3273) is walled in, the SDK pathfinder finds no way out of it' },
    { letter: 'V', vars: { ...CH3_DONE, mm_garkor: 4, mm_kruk: 1, mm_elder_guard: 1, mm_awowogei: 1, mm_monkey_minder: 1 }, items: { mm_amulet_of_monkey_speak: 1, mm_monkey_greegree_for_normal_monkey: 1, mm_monkey_amulet_mould: 1, mm_monkey_in_backpack: 1 }, worn: ['mm_amulet_of_monkey_speak', 'mm_monkey_greegree_for_normal_monkey'], tile: AWOWOGEI },
    { letter: 'W', vars: { ...CH3_DONE, mm_garkor: 4, mm_kruk: 1, mm_elder_guard: 1, mm_awowogei: 2, mm_monkey_minder: 1 }, items: { mm_amulet_of_monkey_speak: 1, mm_monkey_greegree_for_normal_monkey: 1, mm_monkey_amulet_mould: 1 }, worn: ['mm_amulet_of_monkey_speak', 'mm_monkey_greegree_for_normal_monkey'], tile: AWOWOGEI },
    { letter: 'X', vars: { ...CH3_DONE, mm_main: 5, mm_garkor: 6, mm_kruk: 1, mm_elder_guard: 1, mm_awowogei: 2, mm_monkey_minder: 1 }, items: { mm_amulet_of_monkey_speak: 1, mm_monkey_greegree_for_normal_monkey: 1, mm_monkey_amulet_mould: 1, mm_sigil: 1 }, worn: ['mm_amulet_of_monkey_speak', 'mm_monkey_greegree_for_normal_monkey', 'rune_arrow'], tile: GARKOR, note: 'as W leaves it: a monkey beside Garkor with the sigil held, the bow in the pack; bit 15 (waiting_for_final_battle) clear, as quest-mm-demon.ts:45-60' },
    { letter: 'Y', vars: { ...CH3_DONE, mm_main: 6, mm_garkor: 7, mm_kruk: 1, mm_elder_guard: 1, mm_awowogei: 2, mm_monkey_minder: 1, mm_been_to_final_battle: 1 }, items: { mm_amulet_of_monkey_speak: 1, mm_monkey_greegree_for_normal_monkey: 1, mm_monkey_amulet_mould: 1, mm_sigil: 1 }, tile: { x: 2702, z: 9173, level: 1 }, note: 'where X ends, in the arena (measured 4 of 4); Y teleports out from there (Narnode needs only mm_main 6)' },
    { letter: 'Z', vars: { ...CH3_DONE, mm_main: 9, mm_garkor: 7, mm_kruk: 1, mm_elder_guard: 1, mm_awowogei: 2, mm_monkey_minder: 1, mm_been_to_final_battle: 1 }, items: { mm_amulet_of_monkey_speak: 1, mm_monkey_greegree_for_normal_monkey: 1, mm_monkey_amulet_mould: 1, mm_sigil: 1 }, tile: NARNODE },
];

/**
 * Fixture kit overrides: shark and prayer-potion counts, and the bow by debug name (the 'no magic shortbow' hedge).
 * `pinned` (O only): the state a temple-rope pin leaves, at PIN_START with the spare Varrock set spent. `defence`: the
 * Defence level staged instead of ROUTE_LEVELS' 1 (O43a: defensive casting at S10b-S12 brings it to about 37).
 */
export interface KitOptions { sharks?: number; potions?: number; bow?: string; pinned?: boolean; defence?: number; antipoison?: number; predose?: boolean }

/** Where a temple-rope pin's Varrock teleport lands (travel.ts SPELLS.varrock): O's start after a pin. */
export const PIN_START = { x: 3213, z: 3424, level: 0 };
/** The spare Varrock set (H12) that the pin's teleport spends. */
const PIN_SPENT: Readonly<Record<string, number>> = { lawrune: 1, airrune: 3, firerune: 1 };

/** The kit still held at the start of `letter` (H12 minus what earlier segments used), with `sharks` overriding the shark count. */
export function remainingKit(letter: string, o: KitOptions = {}): Record<string, number> {
    const kit: Record<string, number> = { ...KIT };
    if (o.sharks !== undefined) kit.shark = o.sharks;
    if (o.potions !== undefined) kit['4doseprayerrestore'] = o.potions;
    if (o.antipoison !== undefined) kit['4dose2antipoison'] = o.antipoison;
    if (o.bow && o.bow !== 'magic_shortbow') {
        delete kit.magic_shortbow;
        kit[o.bow] = 1;
    }
    const spends = Object.entries(KIT_SPENT).filter(([seg]) => seg < letter).map(([, spent]) => spent);
    if (o.pinned) spends.push(PIN_SPENT);
    for (const spent of spends) {
        for (const [name, n] of Object.entries(spent)) kit[name] = Math.max(0, (kit[name] ?? 0) - n);
    }
    return Object.fromEntries(Object.entries(kit).filter(([, n]) => n > 0));
}

export function fixture(letter: string): Fixture {
    const f = FIXTURES.find(x => x.letter === letter);
    if (!f) throw new Error(`no Monkey Madness fixture ${letter}`);
    return f;
}

/** `letter`'s fixture as staged under `o`: a pinned O starts at PIN_START. */
export function fixtureAt(letter: string, o: KitOptions = {}): Fixture {
    const f = fixture(letter);
    if (!o.pinned) return f;
    if (letter !== 'O') throw new Error(`--pinned stages only O (the segment after the temple rope), not ${letter}`);
    return { ...f, tile: PIN_START, note: 'teleported to Varrock from a temple-rope pin' };
}

/** Stackable kit entries (one slot whatever the count). */
const STACKABLE = new Set(['rune_arrow', 'lawrune', 'airrune', 'firerune', 'waterrune']);

/** Inventory slots a fixture's items and kit take (worn items excluded). */
export function slotsNeeded(letter: string, o: KitOptions = {}): number {
    const f = fixture(letter);
    const all: Record<string, number> = { ...remainingKit(letter, o) };
    for (const [k, n] of Object.entries(f.items)) all[k] = (all[k] ?? 0) + n;
    let slots = 0;
    for (const [k, n] of Object.entries(all)) {
        const worn = f.worn?.includes(k) ? 1 : 0;
        slots += STACKABLE.has(k) ? (worn ? 0 : 1) : Math.max(0, n - worn);
    }
    return slots;
}

export const INVENTORY_SLOTS = 28;
export const FREE_KEPT = 2;

/**
 * What a fixture gives, in giving order: the quest items, then the kit
 * without sharks, then as many sharks as fit (up to `sharks`, default the
 * kit's), leaving FREE_KEPT slots empty. H12 as written overflows 28 slots,
 * and `::give` into a full inventory drops silently, so the food is what
 * gives way.
 */
export function fixtureItems(letter: string, o: KitOptions = {}): Array<[string, number]> {
    const f = fixture(letter);
    const kit = remainingKit(letter, { ...o, sharks: 0 });
    const out: Array<[string, number]> = [];
    for (const [k, n] of Object.entries(f.items)) out.push([k, n + (kit[k] ?? 0)]);
    for (const [k, n] of Object.entries(kit)) if (!(k in f.items)) out.push([k, n]);
    // Two slots stay free: the most any segment picks up (J's dentures and mould).
    const free = INVENTORY_SLOTS - (f.keepFree ?? FREE_KEPT) - slotsNeeded(letter, { ...o, sharks: 0 });
    const sharks = Math.min(o.sharks ?? KIT.shark!, Math.max(0, free));
    if (sharks > 0) out.push(['shark', sharks]);
    // The pre-dose takes A's kept-free slot only until it is drunk at A's start, before Narnode's seal arrives.
    if (o.predose && letter === 'A') out.push(['1dose2antipoison', 1]);
    return out;
}

type FixtureSdk = Pick<BotSDK, 'getState' | 'onStateUpdate' | 'sendSay' | 'sendDropItem' | 'sendUseEquipmentItem' | 'sendCloseModal' | 'sendUseItem'>;

/** Put the lab account in `letter`'s start state: route levels, every MM var, the remaining kit, the quest items, the worn items, the tile. */
export async function applyFixture(sdk: FixtureSdk, letter: string, o: KitOptions = {}): Promise<void> {
    const f = fixtureAt(letter, o);
    await sdk.sendCloseModal();
    // Set up away from anything aggressive (the last run may have ended among the atoll's guards).
    // A knockout's fade or a ladder's delay refuses a teleport for a few ticks, so it is retried.
    for (let k = 0; k < 6 && chebyshev(pos(sdk), STAGING) > 5; k++) if (!(await tele(sdk, STAGING.x, STAGING.z))) await waitTicks(sdk, 5);
    if (chebyshev(pos(sdk), STAGING) > 5) throw new Error(`fixture ${letter}: staging teleport failed (at ${JSON.stringify(pos(sdk))})`);
    await clearInventory(sdk);
    await setVars(sdk, { ...PREREQ_VARS, ...Object.fromEntries(MM_VARS.map(v => [v, f.vars[v] ?? 0])) });
    // The hangar's board persists per account until it has more than one empty slot (mm_puzzle.rs2 mm_open_puzzle):
    // clear it, so E meets the fresh 255-step scramble a first visit gets.
    if (letter <= 'E') await cheat(sdk, '~clearinv reinitialisation_inv', 1);
    // The sharks go in last, after the wear: slotsNeeded counts worn items as out of the pack, but they are given into
    // it first, so sharks given before the wear overflow it (A: 12 kit + bow + arrows + 15 sharks is 29).
    const items = fixtureItems(letter, o);
    const verify = (list: Array<[string, number]>) => {
        const held = sdk.getState()!.inventory;
        for (const [k, n] of list) {
            const id = configId('obj', k);
            const have = held.filter(i => i.id === id).reduce((a, i) => a + i.count, 0);
            if (have < n) throw new Error(`fixture ${letter}: gave ${n} ${k}, holding ${have}`);
        }
    };
    const food = items.filter(([k]) => k === 'shark');
    const rest = items.filter(([k]) => k !== 'shark');
    for (const [k, n] of rest) await give(sdk, k, n);
    verify(rest);
    // Levels before the wear, so hitpoints and prayer start full.
    await setStats(sdk, { ...ROUTE_LEVELS, ...(o.defence !== undefined ? { defence: o.defence } : {}) });
    await mustTele(sdk, f.tile.x, f.tile.z, f.tile.level);
    // Worn items go on at the tile: a gree-gree is held only inside the monkey zone (mm_greegree.rs2).
    for (const w of f.worn ?? []) {
        const r = await wield(sdk as never, configId('obj', w));
        if (!r.ok) throw new Error(`fixture ${letter}: could not wear ${w}`);
    }
    for (const w of ROUTE_WORN) {
        await give(sdk, w, 1);
        const r = await wield(sdk as never, configId('obj', w));
        if (!r.ok) throw new Error(`fixture ${letter}: could not wear ${w}`);
    }
    for (const [k, n] of food) await give(sdk, k, n);
    verify(food);
}

/** Why the account is not in `letter`'s start state, or null: off the fixture's tile, or a var reading back otherwise. */
export async function fixtureDrift(sdk: Pick<BotSDK, 'getState' | 'onStateUpdate' | 'sendSay'>, letter: string, o: KitOptions = {}): Promise<string | null> {
    const f = fixtureAt(letter, o);
    const at = pos(sdk);
    if (at.level !== f.tile.level || chebyshev(at, f.tile) > 3) return `at ${JSON.stringify(at)}, not the fixture's tile ${JSON.stringify(f.tile)}`;
    const want: Record<string, number> = { ...PREREQ_VARS, ...Object.fromEntries(MM_VARS.map(v => [v, f.vars[v] ?? 0])) };
    const got = await readVars(sdk, Object.keys(want));
    const off = Object.entries(want).filter(([k, v]) => got.get(k.toLowerCase()) !== v);
    return off.length ? `vars read back otherwise: ${off.map(([k, v]) => `${k} ${got.get(k.toLowerCase()) ?? '?'} (want ${v})`).join(', ')}` : null;
}

/**
 * Worn through all of S15 on the route, from S12's reward to H13's swap (STEP-MANIFEST.md section 4, S12 and H13):
 * Fight Arena's Khazard helmet and platemail. Given and worn after the fixture's own wear, before the sharks.
 */
export const ROUTE_WORN: readonly string[] = ['khazard_helmet', 'khazard_platemail'];

/** Lumbridge's courtyard: nothing attacks there. */
const STAGING = { x: 3222, z: 3218 };

/** Rune arrows held and quivered. */
const runeArrows = (s: BotWorldState) => [...s.inventory, ...s.equipment].filter(i => i.name === 'Rune arrow').reduce((n, i) => n + i.count, 0);

/** Prayer potion doses held: Prayer potion(4) is 4, and so on. */
const prayerDoses = (s: BotWorldState) => s.inventory.reduce((n, i) => n + (Number(/^Prayer potion\((\d)\)/i.exec(i.name)?.[1] ?? 0) * i.count), 0);

/** The poison hitsplats on the player after `tick` (hitmark 2, poison.rs2; inline so the lab drives older quest code too). */
const poisonHitsAfter = (s: BotWorldState, tick: number) =>
    (s.combatEvents ?? []).filter(e => e.type === 'damage_taken' && e.targetType === 'player' && e.hitmark === 2 && e.tick > tick);
const antipoisonDoses = (s: BotWorldState) => s.inventory.reduce((n, i) => n + (Number(/antipoison\((\d)\)/i.exec(i.name)?.[1] ?? 0) * i.count), 0);
const sharksHeld = (s: BotWorldState) => s.inventory.filter(i => i.name === 'Shark').length;
const potionsHeld = (s: BotWorldState) => s.inventory.filter(i => /^Prayer potion\(\d\)/i.test(i.name)).length;
const PROTECT = new Set(['protect_from_melee', 'protect_from_missiles', 'protect_from_magic']);
const activePrayers = (s: BotWorldState) => PRAYER_NAMES.filter((_, i) => s.prayers?.activePrayers[i]);

/** What a chain holds at a segment boundary (main's consumption ruling, rs/201 comment 18). */
export interface BoundaryCensus {
    before: string;
    tick: number;
    hp: number;
    sharks: number;
    prayer: number;
    doses: number;
    /** Inventory slots used (worn items excluded), and the empty vials among them: a potion's last dose leaves its vial. */
    slots: number;
    vials: number;
    /** What the lab's top-up gave at this boundary (debug name -> count); absent when nothing was given. */
    given?: Record<string, number>;
}

export function boundaryCensus(s: BotWorldState, before: string): BoundaryCensus {
    return {
        before, tick: s.tick, hp: s.player?.hp ?? 0, sharks: sharksHeld(s), prayer: s.prayers?.prayerPoints ?? 0, doses: prayerDoses(s),
        slots: s.inventory.length, vials: s.inventory.filter(i => /^Vial$/i.test(i.name)).length,
    };
}

/**
 * The atoll dungeon's trap tiles (loc origins): floor spikes, spear traps and spring-trap triggers. Each is checked
 * every tick against the player's own tile (ape_atoll_dungeon.rs2 mm_dungeon_spikes, mm_dungeon_wallspikes,
 * mm_springtrap) and hurts whatever prayer is on: 7% of current HP + 1 with a poison, or 8% of base HP + 1.
 */
export function dungeonTraps(root = join(import.meta.dir, '..', '..', '..', 'server', 'content')): Set<string> {
    const names = new Set(['mm_floorspikes', 'mm_speartrap', 'mm_double_springtrap_trigger']);
    const ids = new Set(readFileSync(join(root, 'pack', 'loc.pack'), 'utf8').split('\n').map(l => l.split('=')).filter(([, n]) => names.has(n?.trim() ?? '')).map(([id]) => id!));
    const out = new Set<string>();
    for (const [mx, mz] of [[42, 142], [43, 142], [42, 143], [43, 143]] as const) {
        const locs = readFileSync(join(root, 'maps', `m${mx}_${mz}.jm2`), 'utf8').split('==== LOC ====')[1] ?? '';
        for (const m of locs.matchAll(/^(\d+) (\d+) (\d+): (\d+)/gm)) if (ids.has(m[4]!)) out.add(`${mx * 64 + Number(m[2])},${mz * 64 + Number(m[3])},${m[1]}`);
    }
    return out;
}

/**
 * What one segment used, from the published states it saw: sharks eaten and doses drunk (decreases only, so a
 * top-up between segments never counts), the peak slots held, the lowest HP, HP lost, ticks under each prayer,
 * and damage by source, split into hits taken under a protect prayer and hits taken with none on.
 */
export class SegmentUse {
    eaten = 0;
    drunk = 0;
    antipoison = 0;
    peakSlots = 0;
    minHp = Infinity;
    hpLost = 0;
    /** HP lost on ticks the player stood on a dungeon trap tile, and the ticks spent on one. */
    trapHp = 0;
    trapTicks = 0;
    deaths = 0;
    prayerTicks: Record<string, number> = {};
    hitsPrayed: Record<string, number> = {};
    hitsUnprayed: Record<string, number> = {};
    private prev: BotWorldState | null = null;
    private seenHits = new Set<string>();

    constructor(readonly seg: string, private readonly traps: ReadonlySet<string> = new Set()) {}

    see(s: BotWorldState): void {
        if (!s.player) return;
        const hitKey = (e: BotWorldState['combatEvents'][number]) => `${e.tick}:${e.sourceType}:${e.sourceIndex}:${e.damage}`;
        const hits = s.combatEvents.filter(e => e.type === 'damage_taken');
        const prev = this.prev;
        this.prev = s;
        this.peakSlots = Math.max(this.peakSlots, s.inventory.length);
        this.minHp = Math.min(this.minHp, s.player.hp);
        if (!prev?.player) {
            for (const e of hits) this.seenHits.add(hitKey(e));
            return;
        }
        this.eaten += Math.max(0, sharksHeld(prev) - sharksHeld(s));
        this.drunk += Math.max(0, prayerDoses(prev) - prayerDoses(s));
        this.antipoison += Math.max(0, antipoisonDoses(prev) - antipoisonDoses(s));
        const lost = Math.max(0, prev.player.hp - s.player.hp);
        this.hpLost += lost;
        if (prev.player.hp > 0 && s.player.hp === 0) this.deaths++;
        const dt = Math.max(0, s.tick - prev.tick);
        const onTrap = (p: NonNullable<BotWorldState['player']>) => this.traps.has(`${p.worldX},${p.worldZ},${p.level}`);
        if (onTrap(s.player)) this.trapTicks += dt;
        if (lost > 0 && (onTrap(s.player) || onTrap(prev.player))) this.trapHp += lost;
        const on = activePrayers(prev);
        for (const p of on) this.prayerTicks[p] = (this.prayerTicks[p] ?? 0) + dt;
        const prayed = activePrayers(s).some(p => PROTECT.has(p));
        for (const e of hits) {
            const k = hitKey(e);
            if (this.seenHits.has(k)) continue;
            this.seenHits.add(k);
            if (e.damage <= 0) continue;
            const who = e.sourceType === 'npc' ? (s.nearbyNpcs.find(n => n.index === e.sourceIndex)?.name ?? `npc#${e.sourceIndex}`) : e.sourceType;
            const into = prayed ? this.hitsPrayed : this.hitsUnprayed;
            into[who] = (into[who] ?? 0) + e.damage;
        }
    }

    summary() {
        return {
            seg: this.seg, eaten: this.eaten, drunk: this.drunk, antipoison: this.antipoison, peakSlots: this.peakSlots, minHp: Number.isFinite(this.minHp) ? this.minHp : null,
            hpLost: this.hpLost, trapHp: this.trapHp, trapTicks: this.trapTicks, deaths: this.deaths, prayerTicks: this.prayerTicks, hitsPrayed: this.hitsPrayed, hitsUnprayed: this.hitsUnprayed,
        };
    }
}

/** Free slots a top-up leaves before `letter`: J's crates add the dentures and the mould; Y needs its reward's slotNeed. */
export function topUpReserve(letter: string, s?: BotWorldState): number {
    if (letter !== 'Y') return FREE_KEPT;
    return s ? slotNeed(s, REWARD_ITEMS, SEGMENTS.map(d => d.letter), 'Y').slots : 4;
}

/**
 * A lab top-up: fill the free slots, less `reserve`, with prayer potions up to `potions` held, then sharks. It stands
 * in for a helper's trade (main's gnome-half trade) or, with --stage=all, keeps a consumption chain alive.
 */
export function topUpPlan(s: BotWorldState, reserve: number, potions: number): Array<[string, number]> {
    let free = INVENTORY_SLOTS - s.inventory.length - reserve;
    if (free <= 0) return [];
    const pots = Math.min(free, Math.max(0, potions - potionsHeld(s)));
    free -= pots;
    const out: Array<[string, number]> = [];
    if (pots > 0) out.push(['4doseprayerrestore', pots]);
    if (free > 0) out.push(['shark', free]);
    return out;
}

/** With --trace=N: print tick, tile, HP, sharks held and any new game messages every N ticks, and on every HP change. */
function trace(sdk: Pick<BotSDK, 'onStateUpdate'>, every: number): () => void {
    let last = -Infinity, hp = -1, seen = Infinity, lastHit = -1;
    let prev: BotWorldState | null = null;
    let dialog = 'none';
    return sdk.onStateUpdate(s => {
        const p = s.player;
        if (!p) return;
        const was = prev?.player;
        if (was && prev && inCell(s) && !inCell(prev) && chebyshev(pos(prev), pos(s)) > 1) {
            const near = prev.nearbyNpcs.filter(n => chebyshev({ x: n.tileX ?? n.x, z: n.tileZ ?? n.z }, pos(prev!)) <= 6).map(n => `${n.name}@${n.tileX ?? n.x},${n.tileZ ?? n.z}${n.targetIndex >= 0 ? '>' + n.targetIndex : ''}`);
            console.log(`TRACE t=${s.tick} KNOCKOUT from ${was.worldX},${was.worldZ} hp ${was.hp}->${p.hp} near=${near.join(' ')}`);
        }
        prev = s;
        // By observation id, not buffer length: the published buffer is capped, so its length stops growing.
        const obs = (m: { observationId?: number; tick: number }) => m.observationId ?? m.tick;
        const msgs = s.gameMessages.filter(m => obs(m) > seen).map(m => m.text);
        seen = Math.max(seen === Infinity ? -1 : seen, ...s.gameMessages.map(obs));
        const hits = s.combatEvents.filter(e => e.type === 'damage_taken' && e.tick > lastHit);
        if (hits.length) lastHit = Math.max(...hits.map(e => e.tick));
        // The page's text with its options: a bare 'Click here to continue' does not tell an NPC's page from the chatter.
        const text = (s.dialog.allComponents ?? []).map(c => c.text).join(' ').replace(/\s+/g, ' ').trim().slice(0, 70);
        const d = s.dialog.isOpen ? `${s.dialog.options.length ? 'choice:' + s.dialog.options.map(o => o.text).join('/') : 'page'}${s.dialog.isWaiting ? '(waiting)' : ''} [${text || (s.dialog.text ?? '').slice(0, 40)}]` : 'none';
        const dialogChanged = d !== dialog;
        dialog = d;
        if (s.tick - last < every && p.hp === hp && !msgs.length && !hits.length && !dialogChanged) return;
        last = s.tick;
        hp = p.hp;
        const sharks = s.inventory.filter(i => i.name === 'Shark').length;
        const by = hits.map(e => `${e.damage}<-${e.sourceType === 'npc' ? (s.nearbyNpcs.find(n => n.index === e.sourceIndex)?.name ?? `npc#${e.sourceIndex}`) : e.sourceType}`);
        // Hit events carry no source index here (npc#-1): who stood within 2, and whom each targets, names the source.
        if (hits.some(e => e.damage > 0)) {
            const near = s.nearbyNpcs.filter(n => chebyshev({ x: n.tileX ?? n.x, z: n.tileZ ?? n.z }, pos(s)) <= 2).map(n => `${n.name}@${n.tileX ?? n.x},${n.tileZ ?? n.z}${n.targetIndex >= 0 ? '>' + n.targetIndex : ''}`);
            by.push(`near=[${near.join(' ')}]`);
        }
        const prayers = PRAYER_NAMES.filter((_, i) => s.prayers?.activePrayers[i]);
        console.log(`TRACE t=${s.tick} @${p.worldX},${p.worldZ},${p.level} hp=${p.hp} anim=${p.animId} pp=${s.prayers?.prayerPoints ?? '?'} sharks=${sharks}${prayers.length ? ' pray=' + prayers.join('+') : ''}${by.length ? ' hits=' + by.join(',') : ''}${dialogChanged ? ' dialog=' + dialog : ''}${msgs.length ? ' msgs=' + JSON.stringify(msgs) : ''}`);
    });
}

/** --trace: one CLICK line per send SCORED's code makes, with the tick, for click timing (send to landing, re-sends). */
function logClicks(sdk: BotSDK): void {
    for (const m of ['sendWalk', 'sendInteractLoc', 'sendInteractNpc', 'sendUseItemOnLoc', 'sendUseItemOnNpc', 'sendUseItem', 'sendTogglePrayer', 'sendClickComponent', 'sendTradeRequest', 'sendAcceptTrade', 'sendDeclineTrade'] as const) {
        const rec = sdk as unknown as Record<string, (...a: unknown[]) => unknown>;
        const orig = rec[m]!.bind(sdk);
        rec[m] = (...a: unknown[]) => {
            console.log(`CLICK t=${sdk.getState()?.tick ?? -1} ${m} ${JSON.stringify(a)}`);
            return orig(...a);
        };
    }
}

/** Mean and max over the runs, per boundary (state on arrival) and per segment (what it used). */
function printCensus(cs: ReadonlyArray<{ boundaries: BoundaryCensus[]; uses: Array<ReturnType<SegmentUse['summary']>> }>): void {
    const agg = (xs: number[]) => (xs.length ? `${(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1)}/${Math.max(...xs)}` : '-');
    const aggMin = (xs: number[]) => (xs.length ? `${(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1)}/${Math.min(...xs)}` : '-');
    console.log('\nboundary (before) | n | HP mean/min | sharks mean/min | prayer mean/min | doses mean/min | slots mean/max | vials max | given');
    const keys = [...new Set(cs.flatMap(c => c.boundaries.map(b => b.before)))];
    for (const k of keys) {
        const bs = cs.flatMap(c => c.boundaries.filter(b => b.before === k));
        const given = bs.map(b => (b.given ? Object.entries(b.given).map(([n, v]) => `${v} ${n}`).join('+') : '')).filter(Boolean);
        console.log(`${k} | ${bs.length} | ${aggMin(bs.map(b => b.hp))} | ${aggMin(bs.map(b => b.sharks))} | ${aggMin(bs.map(b => b.prayer))} | ${aggMin(bs.map(b => b.doses))} | ${agg(bs.map(b => b.slots))} | ${Math.max(...bs.map(b => b.vials))} | ${given.join(', ')}`);
    }
    console.log('\nsegment | n | eaten mean/max | drunk mean/max | antipoison doses (sum) | peak slots mean/max | min HP mean/min | HP lost mean/max | on traps HP mean/max | deaths | prayer ticks (mean) | unprayed damage by source (sum over runs) | prayed damage by source (sum over runs; npc#-1 is poison or a trap)');
    const segs = [...new Set(cs.flatMap(c => c.uses.map(u => u.seg)))];
    for (const k of segs) {
        const us = cs.flatMap(c => c.uses.filter(u => u.seg === k));
        const pt: Record<string, number> = {};
        for (const u of us) for (const [p, t] of Object.entries(u.prayerTicks)) pt[p] = (pt[p] ?? 0) + t / us.length;
        const un: Record<string, number> = {};
        for (const u of us) for (const [p, d] of Object.entries(u.hitsUnprayed)) un[p] = (un[p] ?? 0) + d;
        const pr: Record<string, number> = {};
        for (const u of us) for (const [p, d] of Object.entries(u.hitsPrayed)) pr[p] = (pr[p] ?? 0) + d;
        const fmt = (r: Record<string, number>) => Object.entries(r).map(([p, v]) => `${p} ${v.toFixed(0)}`).join(', ') || '-';
        console.log(`${k} | ${us.length} | ${agg(us.map(u => u.eaten))} | ${agg(us.map(u => u.drunk))} | ${us.reduce((a, u) => a + u.antipoison, 0)} | ${agg(us.map(u => u.peakSlots))} | ${aggMin(us.map(u => u.minHp ?? 0))} | ${agg(us.map(u => u.hpLost))} | ${agg(us.map(u => u.trapHp))} | ${us.reduce((a, u) => a + u.deaths, 0)} | ${fmt(pt)} | ${fmt(un)} | ${fmt(pr)}`);
    }
}

/**
 * Where --throwAt throws: the first send of a matching method in a matching state. T: the let-out's first click, caged
 * with the monkey held (a re-run must enter U and let out there). N: the first click on the trapdoor's landing with the
 * enchanted bar held (a re-run must re-enter N under the temple).
 */
const THROW_POINTS: Record<string, { method: RegExp; when: (s: BotWorldState) => boolean }> = {
    T: { method: /^sendInteractNpc$/, when: s => inCage(s) && s.inventory.some(i => i.id === MM_OBJ.monkey) },
    N: { method: /^send/, when: s => underTemple(s) && s.inventory.some(i => i.id === MM_OBJ.enchantedBar) },
};

/**
 * Arm a throw on `sdk`'s send methods: the first send matching `point` rejects, as a crash at that click would, and every
 * send after it rejects too, so nothing left of the thrown run acts, until the returned disarm restores the methods.
 */
function armThrow(sdk: BotSDK, letter: string, point: (typeof THROW_POINTS)[string], onThrow: (tick: number) => void): () => void {
    const saved: Array<[string, unknown]> = [];
    let thrown = false;
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(sdk)).filter(n => n.startsWith('send') && typeof (sdk as never)[n] === 'function');
    for (const name of methods) {
        const orig = (sdk as unknown as Record<string, (...a: unknown[]) => unknown>)[name]!;
        saved.push([name, Object.prototype.hasOwnProperty.call(sdk, name) ? orig : undefined]);
        (sdk as unknown as Record<string, unknown>)[name] = (...a: unknown[]) => {
            const st = sdk.getState();
            if (!thrown && st && point.method.test(name) && point.when(st)) {
                thrown = true;
                onThrow(st.tick);
                console.log(`lab: thrown at ${letter} on ${name}(${a.join(',')}), tick ${st.tick}, at ${JSON.stringify(pos(st))}`);
            }
            if (thrown) return Promise.reject(new Error(`lab: thrown at ${letter}`));
            return orig.apply(sdk, a);
        };
    }
    return () => {
        for (const [name, own] of saved) {
            if (own === undefined) delete (sdk as unknown as Record<string, unknown>)[name];
            else (sdk as unknown as Record<string, unknown>)[name] = own;
        }
    };
}

/**
 * --neverAccept's helper: the h45 account, logged in on P's tile, requests a trade whenever SCORED stands within 3 tiles
 * with none open (SCORED's own request then opens it), offers its super antipoison once per trade, and never accepts.
 */
function neverAcceptHelper(h: Session, scored: string): { stop: () => { requests: number; opened: number; offered: number } } {
    let lastReq = -1;
    let busy = false;
    let offeredIn = false;
    const seen = { requests: 0, opened: 0, offered: 0 };
    const un = h.sdk.onStateUpdate(s => {
        const t = tradeOf(s);
        if (t.isOpen) {
            if (!offeredIn && sameName(t.partner, scored)) {
                offeredIn = true;
                seen.opened++;
                const anti = s.inventory.find(i => /^superantipoison\(4\)$/i.test(i.name));
                if (anti) {
                    seen.offered++;
                    void h.sdk.sendOfferItem(anti.slot, 1);
                }
            }
            return;
        }
        offeredIn = false;
        for (const m of s.gameMessages) {
            if (m.tick > lastReq && /trade/i.test(m.text)) {
                lastReq = m.tick;
                if (isTradeRequest(m)) seen.requests++;
                console.log(`lab never-accept helper: t=${s.tick} msg type ${m.type}: ${m.text}`);
            }
        }
        // Request back whenever SCORED stands close with no trade open: with SCORED's own request, that opens it.
        const p = s.nearbyPlayers.find(x => sameName(x.name, scored));
        if (busy || !p || chebyshev({ x: p.x, z: p.z }, pos(s)) > 3) return;
        busy = true;
        void openTrade(h.sdk as never, scored, { maxTicks: 20 }).finally(() => { busy = false; });
    });
    return { stop: () => { un(); return seen; } };
}

/** --absentHelper's helper: a lab account name no session logs in as. */
const ABSENT_HELPER = 'cairn_labnone';
/** Where the bridge jump lands (quest_mm.rs2:1043): P's H12o leg waits here. */
const JUMP_LANDING = { x: 2803, z: 2724 };
/** A tile in the jail cell, where every town knockout lands (mm_archer.rs2's p_telejump: 0_43_43_18_41 + 0-6, 0-1). */
const CELL_TILE = { x: 2772, z: 2794 };

/**
 * --knockout=N: N ticks after SCORED first stands outside the town within 1 of the jump's landing, a staff tele into
 * the jail cell. No staff command runs the town's knockout queues (aa_archer_knockout and the others have no
 * debugproc), and a lab archer's 1 in 20 roll can't be timed into the wait, so this stages their end state: SCORED in
 * the cell, mid-leg. Unlike a real knockout it sets no unconscious flag and queues no Lumo dialogue.
 */
function stagedKnockout(sdk: BotSDK, after: number, run: number): () => void {
    let landed = -1;
    let done = false;
    const un = sdk.onStateUpdate(s => {
        if (done) return;
        if (landed < 0 && outsideTown(s) && chebyshev(pos(s), JUMP_LANDING) <= 1) landed = s.tick;
        if (landed < 0 || s.tick < landed + after) return;
        done = true;
        const from = pos(s);
        const t0 = s.tick;
        void tele(sdk as never, CELL_TILE.x, CELL_TILE.z).then(ok => {
            const st = sdk.getState()!;
            result('mm_knockout', { run, landedTick: landed, sentTick: t0, from, ok, inCell: inCell(st), at: pos(st), tick: st.tick });
        });
    });
    return un;
}

/**
 * --talismanDrain: once the child's talisman page ('Has Aunty given you the toy yet?') opens, drain prayer to
 * DRINK_BELOW - 1, as rs/513 chain 1's O crossed 20 in the tick that page opened. The drain lands a tick or so after
 * the page, still inside the talk, which is the window the module's drink must keep out of.
 */
function talismanDrain(sdk: BotSDK, run: number): () => void {
    let fired = false;
    return sdk.onStateUpdate(s => {
        if (fired || !s.dialog.isOpen) return;
        if (!/given you the toy yet/i.test((s.dialog.allComponents ?? []).map(c => c.text).join(' '))) return;
        fired = true;
        const pp = s.prayers?.prayerPoints ?? 0;
        result('mm_talisman_drain', { run, tick: s.tick, pp, to: DRINK_BELOW - 1, prayers: PRAYER_NAMES.filter((_, i) => s.prayers?.activePrayers[i]) });
        if (pp >= DRINK_BELOW) void cheat(sdk, `~stat_drain prayer ${pp - (DRINK_BELOW - 1)} 0`);
    });
}

async function main(): Promise<void> {
    const from = arg('from', 'H').toUpperCase();
    const until = arg('until', from).toUpperCase();
    const runs = Number(arg('runs', '1'));
    const dialogue = arg('dialogue', 'fixed') as 'fixed' | 'burst';
    const sharks = arg('sharks', '');
    const traceEvery = Number(arg('trace', '0'));
    /** Prayer potions in the kit instead of H12's 6, the freed slots going to sharks. */
    const potions = arg('potions', '');
    /** Prayer points at the start instead of full (e.g. 40: N's end after a 200-tick pin by the trapdoor guards). */
    const prayerAt = arg('prayer', '');
    /** The Jungle Demon's bow by obj debug name instead of H12's magic shortbow (e.g. yew_shortbow). */
    const bow = arg('bow', 'magic_shortbow');
    const i0 = SEGMENTS.findIndex(d => d.letter === from);
    const i1 = SEGMENTS.findIndex(d => d.letter === until);
    if (i0 < 0 || i1 < i0) throw new Error(`bad --from=${from} --until=${until}`);
    /** --eat=segment (default, the ruled table) | below30 (exec 7's first gate chains) | N (eat below N everywhere, no top-ups). */
    const eat = arg('eat', 'segment');
    const eating: EatPolicy = eat === 'segment' ? SEGMENT_EATING : eat === 'below30' ? BELOW_30_EATING : { below: {}, otherwise: Number(eat) };
    if (!Number.isFinite(eating.otherwise)) throw new Error(`bad --eat=${eat}`);
    console.log(`eating: ${eat} ${JSON.stringify(eating)}`);
    // --launch: this script owns the client (run with LAB_RUNNERS=0), so it can relog after a fixture's
    // ::setvar calls; those change the varps but not the quest tab state.quests publishes until a login
    // (login.rs2 ~update_questlist). Without it the tab may be stale, which nothing in H-M reads.
    // --client=browser: this checkout's page in a headless lab tab (lab/browser.ts), launched and owned here, as
    // lab/quests/run.ts's labMain does (build the bundle first: `bun run build` in server/webclient).
    const client = arg('client', 'lite');
    if (client !== 'lite' && client !== 'browser') throw new Error(`--client=${client}: want lite or browser`);
    const launch = process.argv.includes('--launch') || client === 'browser';
    const chrome = client === 'browser' ? await launchLabBrowser(botArg()) : null;
    const session = await openSession(botArg(), client === 'browser' ? { client: 'browser', launch: true, insecureQueryLogin: true } : launch ? { launch: true } : {});
    console.log(`client: ${client}`);
    const { sdk } = session;
    // A bot's first login on this engine's saves is on Tutorial Island, where every fixture's tele() refuses.
    await leaveTutorial(session);
    if (traceEvery > 0) logClicks(sdk);
    /**
     * --h45: H12o's helper for both legs, as on run day (lab/h45.ts): a stand-in h45 staged logged out on P's tile and
     * the launcher running its mule role, logged in by the module's H12oM cue, out on its H12oP stop. Restaged with a
     * fresh launcher for every run; --gw=N is the launcher's loopback gateway port (default 8479).
     */
    const useH45 = process.argv.includes('--h45');
    const gw = Number(arg('gw', '8479'));
    const scoredAccount = loadBotEnv(botArg()).BOT_USERNAME!;
    // The cue directory is the launcher's, set per run below; steps() keeps this object, so the module reads it then.
    const neverAccept = process.argv.includes('--neverAccept');
    const absentHelper = process.argv.includes('--absentHelper');
    const topUpFrom: TopUp | undefined = useH45 ? { from: h45Env().account, m: true, p: true, cueDir: '' }
        : neverAccept ? { from: h45Env().account, p: true, cueDir: '' }
        : absentHelper ? { from: ABSENT_HELPER, p: true, cueDir: '' } : undefined;
    const knockout = arg('knockout', '');
    if (knockout && !(Number(knockout) >= 0)) throw new Error(`bad --knockout=${knockout}`);
    const all = steps({ dialogue, note: line => console.log(line), bow: configId('obj', bow), eating, ...(topUpFrom ? { topUpFrom } : {}) });
    const chosen = all.slice(i0, i1 + 1);
    /** The gnome-half trade's boundary (a segment letter): a ::give top-up before it, as the helper's trade. */
    const trade = arg('trade', '').toUpperCase();
    /** all: also top up before every later segment, so a consumption chain survives (lab staging, not a kit). */
    const stage = arg('stage', '');
    const topPotions = Number(arg('topPotions', '2'));
    // A census step before each segment and after the last: the boundary's state, the top-up, and the next
    // segment's use tracker. Their rows are named lab:*, so the segment figures stay the segments' own.
    const traps = dungeonTraps();
    let use: SegmentUse | null = null;
    let boundaries: BoundaryCensus[] = [];
    let uses: Array<ReturnType<SegmentUse['summary']>> = [];
    const letters = SEGMENTS.slice(i0, i1 + 1).map(d => d.letter);
    const census = (next: string | null): Step<MmContext> => ({
        name: `lab:census>${next ?? 'end'}`, logoutSafe: true, preconditions: () => true, postconditions: () => true,
        async run(ctx) {
            if (use) uses.push(use.summary());
            const b = boundaryCensus(ctx.sdk.getState()!, next ?? 'end');
            const topUp = next !== null && trade !== '' && (next === trade || (stage === 'all' && next > trade));
            const plan = topUp ? topUpPlan(ctx.sdk.getState()!, topUpReserve(next!, ctx.sdk.getState()!), topPotions) : [];
            for (const [k, n] of plan) await give(ctx.sdk, k, n);
            if (plan.length) b.given = Object.fromEntries(plan);
            boundaries.push(b);
            use = next ? new SegmentUse(next, traps) : null;
        },
    });
    const chain: Step<MmContext>[] = [...chosen.flatMap((s, k) => [census(letters[k]!), s]), census(null)];
    const table: Record<string, Array<number | string>> = Object.fromEntries(chosen.map(s => [s.name, []]));
    let passes = 0;
    const censuses: Array<{ boundaries: BoundaryCensus[]; uses: Array<ReturnType<SegmentUse['summary']>> }> = [];
    /** --pinned: O from the Varrock teleport's landing, as a temple-rope pin leaves it (the way back is O's start). */
    const pinned = process.argv.includes('--pinned');
    /** --defence=N: Defence staged at N (the O43a gate chains), stated on every result with the in-game level and xp. */
    const defence = arg('defence', '');
    /** --antipoison=N: super antipoison(4) potions in the kit instead of H12's 1. */
    const antipoison = arg('antipoison', '');
    /** --predose: H12 also carries a one-dose super antipoison, drunk at A's start (rs/158's zero-slot option). */
    const predose = process.argv.includes('--predose');
    const spawn = arg('spawn', '');
    const spawnAt = arg('spawnAt', '');
    const poisonArg = arg('poison', '');
    const poisonSeverity = Number(poisonArg || '0');
    const poisonAge = Number(arg('poisonAge', '4'));
    const hpTo = arg('hp', '');
    const loadCap = Number(arg('loadCap', '0'));
    const throwAt = arg('throwAt', '').toUpperCase();
    const throwPoint = throwAt ? THROW_POINTS[throwAt] : undefined;
    if (throwAt && !throwPoint) throw new Error(`--throwAt=${throwAt}: want ${Object.keys(THROW_POINTS).join(' or ')}`);
    if (throwAt && !launch) throw new Error('--throwAt needs --launch (the relaunch is a relog)');
    const kitOpts: KitOptions = { bow, pinned, predose, ...(defence ? { defence: Number(defence) } : {}), ...(antipoison ? { antipoison: Number(antipoison) } : {}), ...(sharks ? { sharks: Number(sharks) } : {}), ...(potions ? { potions: Number(potions) } : {}) };
    /** --throwAt's re-run: a relog, the resume walk over every segment, then the segments from its point to --until. */
    async function relaunch(run: number, thrownTick: number): Promise<void> {
        if (thrownTick < 0) {
            result('mm_resume', { run, throwAt, thrown: false });
            return;
        }
        const t0 = Date.now();
        // The game refuses a logout in combat, or the client times out on it (N's landing among the zombie monkeys). Waiting it out there is a death
        // (measured: nothing eats or prays for the thrown run), so the re-run then resumes at once in the live session.
        let relogged = true;
        try {
            await relog(session);
        } catch (e) {
            if (!/logout (refused|failed)/.test(String(e))) throw e;
            relogged = false;
            console.log(`lab: relaunch without a relog: ${String(e)}`);
        }
        const obs = new Observation(sdk.getState()!, { [JOURNAL_PROBE]: journalProbe('mm') } as never, session);
        const point = await resolveResume(all, obs, {} as MmContext);
        const s0 = sdk.getState()!;
        result('mm_resume', { run, throwAt, thrown: true, thrownTick, relogMs: Date.now() - t0, relogged, mode: point.mode, step: point.step, reason: point.reason, lastDone: point.lastDone, firstUndone: point.firstUndone, at: pos(s0), tick: s0.tick });
        const log2 = TickLog.memory();
        const untrace2 = traceEvery > 0 ? trace(sdk, traceEvery) : () => undefined;
        let err: string | undefined;
        try {
            await runSteps(session, all.slice(0, i1 + 1), { log: log2, c: {} as MmContext, shouldStop: () => false, from: point.index, startMode: point.mode === 'resume' ? 'resume' : 'run', observed: obs });
        } catch (e) {
            err = e instanceof Error ? e.message : String(e);
        } finally {
            untrace2();
        }
        const s1 = sdk.getState()!;
        result('mm_resumed', {
            run, ok: !err, ...(err ? { error: err } : {}), ticks: Object.fromEntries(log2.rows.filter(r => r.step !== BOUNDARY_STEP).map(r => [r.step, r.ticks])),
            boundary: log2.rows.filter(r => r.step === BOUNDARY_STEP).reduce((a, r) => a + r.ticks, 0), at: pos(s1), hp: s1.player?.hp,
        });
    }
    for (let run = 0; run < runs; run++) {
        if (loadCap > 0 && loadavg()[0]! >= loadCap) {
            const w0 = Date.now();
            for (let under = 0; under < 6; ) {
                under = loadavg()[0]! < loadCap ? under + 1 : 0;
                if (under < 6) await Bun.sleep(10_000);
            }
            console.log(`run ${run}: held ${Math.round((Date.now() - w0) / 1000)} s for the load cap ${loadCap}`);
        }
        // A relog has once come back somewhere else with an older pack (G run 2, 05:27: Lumbridge, then a death), and a
        // fixture once stalled on a client that stopped publishing: both are re-staged, at most three times.
        for (let attempt = 1; ; attempt++) {
            try {
                await applyFixture(sdk, from, kitOpts);
                if (launch) await relog(session);
                const bad = await fixtureDrift(sdk, from, kitOpts);
                if (!bad) break;
                throw new Error(bad);
            } catch (e) {
                const why = e instanceof Error ? e.message : String(e);
                console.log(`fixture ${from} attempt ${attempt}: ${why}`);
                if (attempt >= 3) throw e;
                if (launch) await relog(session);
            }
        }
        if (prayerAt) {
            const now = sdk.getState()!.prayers?.prayerPoints ?? 0;
            if (now > Number(prayerAt)) await cheat(sdk, `~stat_drain prayer ${now - Number(prayerAt)} 0`, 1);
        }
        // --spawn=<npc>: one spawned before the first segment (G's jungle scorpion, mm_jungle_scorpion), on the staged tile
        // or on --spawnAt=x,z (a tele there and back: ::npcadd spawns at the player's tile).
        if (spawn) {
            const back = pos(sdk.getState()!);
            const at = spawnAt ? spawnAt.split(',').map(Number) : null;
            if (at) await mustTele(sdk, at[0]!, at[1]!, back.level);
            await cheat(sdk, `npcadd ${spawn}`, 2);
            if (at) await mustTele(sdk, back.x, back.z, back.level);
        }
        // %poison is perm and outlives a relog, and an antipoison leaves it negative (immune, poison_player ignored): reset first.
        if (poisonArg) await cheat(sdk, 'setvar poison 0', 2);
        if (poisonSeverity > 0) {
            const t0 = sdk.getState()!.tick;
            await cheat(sdk, `~poison ${poisonSeverity}`);
            const first = await waitUntil(sdk, s => poisonHitsAfter(s, t0).length > 0, { maxTicks: 40 });
            if (!first.ok) throw new Error(`--poison=${poisonSeverity}: no poison hit within 40 ticks of t=${t0}`);
            const firstHitAt = poisonHitsAfter(sdk.getState()!, t0)[0]!.tick;
            await waitTicks(sdk, poisonAge);
            result('mm_poison_staged', { run, severity: poisonSeverity, poisonedAt: t0, firstHitAt, startTick: sdk.getState()!.tick });
        }
        if (hpTo) {
            const hp = sdk.getState()!.player!.hp;
            if (hp > Number(hpTo)) await cheat(sdk, `~hit ${hp - Number(hpTo)}`);
            await waitUntil(sdk, s => (s.player?.hp ?? 0) <= Number(hpTo), { maxTicks: 5 });
        }
        const runStart = sdk.getState()!.tick;
        const poisonHits = new Map<number, number>();
        const unpoison = sdk.onStateUpdate(s => {
            for (const e of poisonHitsAfter(s, runStart)) poisonHits.set(e.tick, e.damage);
        });
        const antipoison0 = antipoisonDoses(sdk.getState()!);
        const log = TickLog.memory();
        const s0 = sdk.getState()!;
        const def = s0.skills.find(k => k.name === 'Defence');
        result('mm_staged', { run, host: hostname(), load1: Number(loadavg()[0]!.toFixed(2)), defence: { level: def?.baseLevel, xp: def?.experience }, hp: s0.player?.hp, worn: s0.equipment.map(i => i.name) });
        const hp0 = s0.player!.hp, pp0 = s0.prayers?.prayerPoints, doses0 = prayerDoses(s0);
        const sharks0 = s0.inventory.filter(i => i.name === 'Shark').length;
        const arrows0 = runeArrows(s0);
        const untrace = traceEvery > 0 ? trace(sdk, traceEvery) : () => undefined;
        use = null;
        boundaries = [];
        uses = [];
        const unuse = sdk.onStateUpdate(s => use?.see(s));
        let launcher: H45Launcher | null = null;
        let never: { session: Session; helper: ReturnType<typeof neverAcceptHelper> } | null = null;
        if (topUpFrom && neverAccept) {
            await stageH45();
            topUpFrom.cueDir = mkdtempSync(join(tmpdir(), 'mm-never-'));
            const hs = await openSession(H45_BOT, { launch: true });
            never = { session: hs, helper: neverAcceptHelper(hs, sdk.getState()!.player!.name) };
        } else if (topUpFrom && absentHelper) {
            topUpFrom.cueDir = mkdtempSync(join(tmpdir(), 'mm-absent-'));
        } else if (topUpFrom) {
            await stageH45();
            launcher = launchH45({ scoredAccount, gatewayPort: gw, tick: () => sdk.getState()?.tick ?? -1 });
            topUpFrom.cueDir = launcher.cueDir;
            if (letters.includes('P') && !letters.includes('M')) {
                // The cue gate counts only cues written after the launcher started, so M's open waits for it to stand
                // at awaiting-cue; h45 logs in on that open (loginOn), and M's stop then sends it on to P.
                const state = () => launcher!.status()?.state ?? null;
                const until = async (want: string, ticks: number) => { for (let i = 0; i < ticks && state() !== want; i++) await waitTicks(sdk, 1); return state() === want; };
                const armed = await until('awaiting-cue', 150);
                legCue(sdk, launcher.cueDir, 'M', 'open');
                const online = await until('online', 150);
                await waitTicks(sdk, 10);
                legCue(sdk, launcher.cueDir, 'M', 'stop');
                legCue(sdk, launcher.cueDir, 'P', 'open');
                result('mm_h45_prelude', { run, armed, online, state: state(), tick: sdk.getState()!.tick });
            }
        }
        const unknock = knockout ? stagedKnockout(sdk, Number(knockout), run) : () => undefined;
        const undrain = process.argv.includes('--talismanDrain') ? talismanDrain(sdk, run) : () => undefined;
        const unstage = async () => {
            if (never) {
                const seen = never.helper.stop();
                const hs = never.session.sdk.getState();
                const cue = readCue(topUpFrom!.cueDir!);
                result('mm_never_accept', { run, ...seen, helperTradeOpen: hs ? tradeOf(hs).isOpen : null, scoredTradeOpen: tradeOf(sdk.getState()!).isOpen, cue: cue ? { step: cue.scope.step, stop: cue.stop ?? false, final: cue.final ?? false, seq: cue.seq } : null });
                await logoutClean(never.session).catch(() => undefined);
                await closeSession(never.session).catch(() => undefined);
                never = null;
            }
            if (!launcher) return;
            const hands = launcher.role(/^hand-off$/).map(l => l.data);
            result('mm_h45', { run, handOffs: hands, wildlife: launcher.role(/^wildlife$/).length, state: launcher.status()?.state ?? null });
            await launcher.stop();
        };
        let error: string | undefined;
        let thrownTick = -1;
        const disarm = throwPoint ? armThrow(sdk, throwAt, throwPoint, t => { thrownTick = t; }) : () => undefined;
        try {
            await runSteps(session, chain, { log, c: {} as MmContext, shouldStop: () => false });
            passes++;
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
        } finally {
            disarm();
            unpoison();
            unknock();
            undrain();
            await unstage();
            untrace();
            unuse();
            if (use) uses.push((use as SegmentUse).summary());
        }
        result('mm_census', { run, ok: !error, boundaries, uses });
        censuses.push({ boundaries, uses });
        for (const row of log.rows) if (row.step !== BOUNDARY_STEP && row.step in table) table[row.step]!.push(row.ok ? row.ticks : `fail@${row.ticks}`);
        const boundary = log.rows.filter(r => r.step === BOUNDARY_STEP).reduce((a, r) => a + r.ticks, 0);
        if (throwPoint) await relaunch(run, thrownTick);
        const s = sdk.getState()!;
        result('mm_run', {
            run, from, until, ok: !error, ...(error ? { error } : {}),
            ticks: Object.fromEntries(log.rows.filter(r => r.step !== BOUNDARY_STEP && !r.step.startsWith('lab:')).map(r => [r.step, r.ticks])), boundary,
            hp: [hp0, s.player?.hp], sharks: [sharks0, s.inventory.filter(i => i.name === 'Shark').length],
            prayer: [pp0, s.prayers?.prayerPoints], potionDoses: [doses0, prayerDoses(s)], runeArrows: [arrows0, runeArrows(s)], at: pos(s),
            antipoisonDoses: [antipoison0, antipoisonDoses(s)], poisonHits: [...poisonHits].map(([tick, damage]) => ({ tick, damage })),
        });
    }
    console.log(`\nMonkey Madness ${from}..${until}, ${passes}/${runs} clean (dialogue ${dialogue})`);
    console.log('segment | stock ref | runs | mean | delta');
    for (const d of SEGMENTS.slice(i0, i1 + 1)) {
        const t = table[segmentName(d)]!;
        const ok = t.filter((x): x is number => typeof x === 'number');
        const mean = ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : NaN;
        console.log(`${segmentName(d)} | ${d.stockRef} | ${t.join(', ')} | ${mean.toFixed(0)} | ${ok.length ? (mean - d.stockRef >= 0 ? '+' : '') + (mean - d.stockRef).toFixed(0) : '-'}`);
    }
    result('mm_table', { from, until, runs, passes, table });
    printCensus(censuses);
    await closeSession(session);
    await chrome?.kill();
    process.exit(0);
}

if (import.meta.main) await main();
