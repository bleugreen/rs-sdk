// Monkey Madness lab fixtures: the game state at the start of each segment
// (speedrun/quests/monkey-madness.ts), for running any segment alone at the
// route's levels. Lab only: staff commands, never imported by the module.
//
// The royal seal is never taken back (mm_caranock.rs2 and mm_lumdo.rs2 only show it), Zooknock returns the mould
// with the enchanted bar, and the sigil is kept: all three are held from their segment to S15's end, where Z
// drops them.
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
// (prayer potions instead of H12's 6, the freed slots going to sharks), --dialogue=fixed|burst.

import type { BotSDK } from '../../../sdk/index';
import { PRAYER_NAMES, type BotWorldState } from '../../../sdk/types';
import { wield } from '../../lib/act';
import { closeSession, openSession, relog } from '../../lib/session';
import { TickLog } from '../../lib/ticks';
import { waitTicks } from '../../lib/wait';
import { chebyshev, configId, pos } from '../../lib/world';
import { inCell, SEGMENTS, segmentName, steps, type MmContext } from '../../quests/monkey-madness';
import { BOUNDARY_STEP, runSteps } from '../../runner/step';
import { arg, botArg, result } from '../common';
import { cheat, clearInventory, give, leaveTutorial, mustTele, setStats, tele } from '../setup';

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
 * H12's kit by debug name (SUPPLIES.md H12, rs/158's 23:40 ruling). Runes: two Varrock casts (1 law, 3 air, 1 fire
 * each: Y's teleport home and the spare for a temple rope pin), Ardougne 2 casts (2 law, 2 water each). 200 rune arrows:
 * one Jungle Demon kill ran dry at 100.
 */
export const KIT: Readonly<Record<string, number>> = {
    gold_bar: 1, ball_of_wool: 1, mm_normal_monkey_bones: 1, banana: 5, magic_shortbow: 1, rune_arrow: 200,
    '4doseprayerrestore': 6, shark: 15, '4doseantipoison': 1, lawrune: 6, airrune: 6, firerune: 2, waterrune: 4,
};

/** Kit items each segment uses up, by the segment that uses them. */
const KIT_SPENT: Readonly<Record<string, Readonly<Record<string, number>>>> = {
    L: { gold_bar: 1 },
    N: { ball_of_wool: 1 },
    O: { banana: 5 },
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
    { letter: 'A', vars: {}, items: {}, tile: NARNODE },
    { letter: 'B', vars: { mm_main: 1, mm_narnode: 3 }, items: { mm_gnome_royal_seal: 1 }, tile: NARNODE },
    { letter: 'C', vars: { mm_main: 2, mm_narnode: 3, mm_caranock: 3 }, items: { mm_gnome_royal_seal: 1 }, tile: { x: 2956, z: 3024, level: 0 }, note: 'mm_main 2 as a played route leaves it (mm_caranock.rs2:51); STARTS has 1' },
    { letter: 'D', vars: { mm_main: 2, mm_narnode: 7, mm_caranock: 3 }, items: { mm_gnome_royal_seal: 1, mm_narnode_orders: 1 }, tile: NARNODE },
    { letter: 'E', vars: { mm_main: 2, mm_narnode: 7, mm_caranock: 3, mm_daero: 4, mm_daero_option_bit_one: 1, mm_daero_option_bit_two: 1, mm_daero_option_bit_three: 1 }, items: { mm_gnome_royal_seal: 1 }, tile: { x: 2393, z: 9892, level: 0 }, note: 'no puzzle-complete flag: the full 255-step scramble is under test (STARTS forces the one-move board)' },
    { letter: 'F', vars: { mm_main: 2, mm_narnode: 7, mm_caranock: 3, mm_daero: 6, ...HANGAR_DONE }, items: { mm_gnome_royal_seal: 1 }, tile: { x: 2649, z: 4508, level: 0 } },
    { letter: 'G', vars: { mm_main: 2, mm_narnode: 7, mm_caranock: 3, mm_daero: 7, ...HANGAR_DONE }, items: { mm_gnome_royal_seal: 1 }, tile: { x: 2893, z: 2726, level: 0 }, note: 'mm_waydar 0 as the flight leaves it (measured: his first talk on the island is the arrival intro)' },
    { letter: 'H', vars: { ...ATOLL_ARRIVED, ...HANGAR_DONE }, items: { mm_gnome_royal_seal: 1 }, tile: { x: 2801, z: 2707, level: 0 } },
    { letter: 'I', vars: { ...ATOLL_ARRIVED, ...HANGAR_DONE, mm_jail_count: 1 }, items: { mm_gnome_royal_seal: 1 }, tile: OUTSIDE_CELL },
    { letter: 'J', vars: { ...ATOLL_ARRIVED, ...HANGAR_DONE, mm_jail_count: 1, mm_garkor: 2 }, items: { mm_gnome_royal_seal: 1 }, tile: GARKOR },
    { letter: 'K', vars: { ...ATOLL_ARRIVED, ...HANGAR_DONE, mm_jail_count: 1, mm_garkor: 2 }, items: { mm_gnome_royal_seal: 1, mm_monkey_dentures: 1, mm_monkey_amulet_mould: 1 }, tile: { x: 2749, z: 2768, level: 0 }, note: 'the western rope lands within 2 of (2749,2768) (quest_mm.rs2:1012-1017)' },
    { letter: 'L', vars: { ...ATOLL_ARRIVED, ...HANGAR_DONE, mm_jail_count: 1, mm_garkor: 2 }, items: { mm_gnome_royal_seal: 1, mm_monkey_dentures: 1, mm_monkey_amulet_mould: 1 }, tile: ZOOKNOCK },
    { letter: 'M', vars: { ...ATOLL_ARRIVED, ...HANGAR_DONE, ...AMULET_DONE, mm_jail_count: 1, mm_garkor: 2 }, items: { mm_gnome_royal_seal: 1, mm_enchanted_gold_bar: 1, mm_monkey_amulet_mould: 1 }, tile: ZOOKNOCK },
    { letter: 'N', vars: { ...ATOLL_ARRIVED, ...HANGAR_DONE, ...AMULET_DONE, mm_jail_count: 2, mm_garkor: 2 }, items: { mm_gnome_royal_seal: 1, mm_enchanted_gold_bar: 1, mm_monkey_amulet_mould: 1 }, tile: OUTSIDE_CELL },
    { letter: 'O', vars: { ...ATOLL_ARRIVED, ...HANGAR_DONE, ...AMULET_DONE, mm_jail_count: 2, mm_garkor: 2 }, items: { mm_gnome_royal_seal: 1, mm_amulet_of_monkey_speak: 1, mm_monkey_amulet_mould: 1 }, tile: { x: 2794, z: 2774, level: 0 }, note: 'N ends out of the trapdoor guards\' box: by the ladders (here, the south ladder\'s foot) or by a walk west' },
    { letter: 'P', vars: { ...ATOLL_ARRIVED, ...HANGAR_DONE, ...AMULET_DONE, mm_jail_count: 2, mm_garkor: 2, mm_monkey_child: 7, mm_monkey_child_waiting_for_talisman: 1 }, items: { mm_gnome_royal_seal: 1, mm_amulet_of_monkey_speak: 1, mm_monkey_talisman: 1, mm_monkey_amulet_mould: 1 }, worn: ['mm_amulet_of_monkey_speak'], tile: { x: 2743, z: 2797, level: 0 } },
    { letter: 'Q', vars: { ...ATOLL_ARRIVED, ...HANGAR_DONE, ...AMULET_DONE, mm_jail_count: 2, mm_garkor: 2, mm_monkey_child: 7, mm_monkey_child_waiting_for_talisman: 1 }, items: { mm_gnome_royal_seal: 1, mm_amulet_of_monkey_speak: 1, mm_monkey_talisman: 1, mm_monkey_amulet_mould: 1 }, worn: ['mm_amulet_of_monkey_speak'], tile: ZOOKNOCK },
    { letter: 'R', vars: { ...CH3_DONE, mm_garkor: 2 }, items: { mm_gnome_royal_seal: 1, mm_amulet_of_monkey_speak: 1, mm_monkey_greegree_for_normal_monkey: 1, mm_monkey_amulet_mould: 1 }, worn: ['mm_amulet_of_monkey_speak'], tile: ZOOKNOCK, note: 'the chapter 3 cutscene returns the player to the tile it was queued from (%mm_cutscene_coord, quest_mm.rs2:469): next to Zooknock' },
    { letter: 'S', vars: { ...CH3_DONE, mm_garkor: 4 }, items: { mm_gnome_royal_seal: 1, mm_amulet_of_monkey_speak: 1, mm_monkey_greegree_for_normal_monkey: 1, mm_monkey_amulet_mould: 1 }, worn: ['mm_amulet_of_monkey_speak', 'mm_monkey_greegree_for_normal_monkey'], tile: GARKOR },
    { letter: 'T', vars: { ...CH3_DONE, mm_garkor: 4, mm_kruk: 1, mm_elder_guard: 1, mm_awowogei: 1 }, items: { mm_gnome_royal_seal: 1, mm_amulet_of_monkey_speak: 1, mm_monkey_greegree_for_normal_monkey: 1, mm_monkey_amulet_mould: 1 }, worn: ['mm_amulet_of_monkey_speak', 'mm_monkey_greegree_for_normal_monkey'], tile: AWOWOGEI },
    { letter: 'U', vars: { ...CH3_DONE, mm_garkor: 4, mm_kruk: 1, mm_elder_guard: 1, mm_awowogei: 1, mm_monkey_minder: 1 }, items: { mm_gnome_royal_seal: 1, mm_amulet_of_monkey_speak: 1, mm_monkey_greegree_for_normal_monkey: 1, mm_monkey_amulet_mould: 1, mm_monkey_in_backpack: 1 }, worn: ['mm_amulet_of_monkey_speak'], tile: { x: 2611, z: 3283, level: 0 }, note: 'where T ends, outside the zoo cage (T measured 2606-2612, 3283-3285); (2614,3273) is walled in, the SDK pathfinder finds no way out of it' },
    { letter: 'V', vars: { ...CH3_DONE, mm_garkor: 4, mm_kruk: 1, mm_elder_guard: 1, mm_awowogei: 1, mm_monkey_minder: 1 }, items: { mm_gnome_royal_seal: 1, mm_amulet_of_monkey_speak: 1, mm_monkey_greegree_for_normal_monkey: 1, mm_monkey_amulet_mould: 1, mm_monkey_in_backpack: 1 }, worn: ['mm_amulet_of_monkey_speak', 'mm_monkey_greegree_for_normal_monkey'], tile: AWOWOGEI },
    { letter: 'W', vars: { ...CH3_DONE, mm_garkor: 4, mm_kruk: 1, mm_elder_guard: 1, mm_awowogei: 2, mm_monkey_minder: 1 }, items: { mm_gnome_royal_seal: 1, mm_amulet_of_monkey_speak: 1, mm_monkey_greegree_for_normal_monkey: 1, mm_monkey_amulet_mould: 1 }, worn: ['mm_amulet_of_monkey_speak', 'mm_monkey_greegree_for_normal_monkey'], tile: AWOWOGEI },
    { letter: 'X', vars: { ...CH3_DONE, mm_main: 5, mm_garkor: 6, mm_kruk: 1, mm_elder_guard: 1, mm_awowogei: 2, mm_monkey_minder: 1 }, items: { mm_gnome_royal_seal: 1, mm_amulet_of_monkey_speak: 1, mm_monkey_greegree_for_normal_monkey: 1, mm_monkey_amulet_mould: 1, mm_sigil: 1 }, worn: ['mm_amulet_of_monkey_speak', 'mm_monkey_greegree_for_normal_monkey', 'rune_arrow'], tile: GARKOR, note: 'as W leaves it: a monkey beside Garkor with the sigil held, the bow in the pack; bit 15 (waiting_for_final_battle) clear, as quest-mm-demon.ts:45-60' },
    { letter: 'Y', vars: { ...CH3_DONE, mm_main: 6, mm_garkor: 7, mm_kruk: 1, mm_elder_guard: 1, mm_awowogei: 2, mm_monkey_minder: 1, mm_been_to_final_battle: 1 }, items: { mm_gnome_royal_seal: 1, mm_amulet_of_monkey_speak: 1, mm_monkey_greegree_for_normal_monkey: 1, mm_monkey_amulet_mould: 1, mm_sigil: 1 }, tile: { x: 2702, z: 9173, level: 1 }, note: 'where X ends, in the arena (measured 4 of 4); Y teleports out from there (Narnode needs only mm_main 6)' },
    { letter: 'Z', vars: { ...CH3_DONE, mm_main: 9, mm_garkor: 7, mm_kruk: 1, mm_elder_guard: 1, mm_awowogei: 2, mm_monkey_minder: 1, mm_been_to_final_battle: 1 }, items: { mm_gnome_royal_seal: 1, mm_amulet_of_monkey_speak: 1, mm_monkey_greegree_for_normal_monkey: 1, mm_monkey_amulet_mould: 1, mm_sigil: 1 }, tile: NARNODE },
];

/** Fixture kit overrides: shark and prayer-potion counts, and the bow by debug name (the 'no magic shortbow' hedge). */
export interface KitOptions { sharks?: number; potions?: number; bow?: string }

/** The kit still held at the start of `letter` (H12 minus what earlier segments used), with `sharks` overriding the shark count. */
export function remainingKit(letter: string, o: KitOptions = {}): Record<string, number> {
    const kit: Record<string, number> = { ...KIT };
    if (o.sharks !== undefined) kit.shark = o.sharks;
    if (o.potions !== undefined) kit['4doseprayerrestore'] = o.potions;
    if (o.bow && o.bow !== 'magic_shortbow') {
        delete kit.magic_shortbow;
        kit[o.bow] = 1;
    }
    for (const [seg, spent] of Object.entries(KIT_SPENT)) {
        if (seg >= letter) continue;
        for (const [name, n] of Object.entries(spent)) kit[name] = Math.max(0, (kit[name] ?? 0) - n);
    }
    return Object.fromEntries(Object.entries(kit).filter(([, n]) => n > 0));
}

export function fixture(letter: string): Fixture {
    const f = FIXTURES.find(x => x.letter === letter);
    if (!f) throw new Error(`no Monkey Madness fixture ${letter}`);
    return f;
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
    const free = INVENTORY_SLOTS - FREE_KEPT - slotsNeeded(letter, { ...o, sharks: 0 });
    const sharks = Math.min(o.sharks ?? KIT.shark!, Math.max(0, free));
    if (sharks > 0) out.push(['shark', sharks]);
    return out;
}

type FixtureSdk = Pick<BotSDK, 'getState' | 'onStateUpdate' | 'sendSay' | 'sendDropItem' | 'sendUseEquipmentItem' | 'sendCloseModal' | 'sendUseItem'>;

/** Put the lab account in `letter`'s start state: route levels, every MM var, the remaining kit, the quest items, the worn items, the tile. */
export async function applyFixture(sdk: FixtureSdk, letter: string, o: KitOptions = {}): Promise<void> {
    const f = fixture(letter);
    await sdk.sendCloseModal();
    // Set up away from anything aggressive (the last run may have ended among the atoll's guards).
    // A knockout's fade or a ladder's delay refuses a teleport for a few ticks, so it is retried.
    for (let k = 0; k < 6 && chebyshev(pos(sdk), STAGING) > 5; k++) if (!(await tele(sdk, STAGING.x, STAGING.z))) await waitTicks(sdk, 5);
    if (chebyshev(pos(sdk), STAGING) > 5) throw new Error(`fixture ${letter}: staging teleport failed (at ${JSON.stringify(pos(sdk))})`);
    await clearInventory(sdk);
    const vars: Array<[string, number]> = [...Object.entries(PREREQ_VARS), ...MM_VARS.map(v => [v, f.vars[v] ?? 0] as [string, number])];
    await Promise.all(vars.map(([k, v]) => cheat(sdk, `setvar ${k} ${v}`)));
    await waitTicks(sdk, Math.ceil(vars.length / 5) + 2);
    // The hangar's board persists per account until it has more than one empty slot (mm_puzzle.rs2 mm_open_puzzle):
    // clear it, so E meets the fresh 255-step scramble a first visit gets.
    if (letter <= 'E') await cheat(sdk, '~clearinv reinitialisation_inv', 1);
    const items = fixtureItems(letter, o);
    for (const [k, n] of items) await give(sdk, k, n);
    const held = sdk.getState()!.inventory;
    for (const [k, n] of items) {
        const id = configId('obj', k);
        const have = held.filter(i => i.id === id).reduce((a, i) => a + i.count, 0);
        if (have < n) throw new Error(`fixture ${letter}: gave ${n} ${k}, holding ${have}`);
    }
    // Levels before the wear, so hitpoints and prayer start full.
    await setStats(sdk, ROUTE_LEVELS);
    await mustTele(sdk, f.tile.x, f.tile.z, f.tile.level);
    // Worn items go on at the tile: a gree-gree is held only inside the monkey zone (mm_greegree.rs2).
    for (const w of f.worn ?? []) {
        const r = await wield(sdk as never, configId('obj', w));
        if (!r.ok) throw new Error(`fixture ${letter}: could not wear ${w}`);
    }
}

/** Lumbridge's courtyard: nothing attacks there. */
const STAGING = { x: 3222, z: 3218 };

/** Rune arrows held and quivered. */
const runeArrows = (s: BotWorldState) => [...s.inventory, ...s.equipment].filter(i => i.name === 'Rune arrow').reduce((n, i) => n + i.count, 0);

/** Prayer potion doses held: Prayer potion(4) is 4, and so on. */
const prayerDoses = (s: BotWorldState) => s.inventory.reduce((n, i) => n + (Number(/^Prayer potion\((\d)\)/i.exec(i.name)?.[1] ?? 0) * i.count), 0);

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
        const d = s.dialog.isOpen ? `${s.dialog.options.length ? 'choice:' + s.dialog.options.map(o => o.text).join('/') : 'page:' + (s.dialog.text ?? '').slice(0, 40)}` : 'none';
        const dialogChanged = d !== dialog;
        dialog = d;
        if (s.tick - last < every && p.hp === hp && !msgs.length && !hits.length && !dialogChanged) return;
        last = s.tick;
        hp = p.hp;
        const sharks = s.inventory.filter(i => i.name === 'Shark').length;
        const by = hits.map(e => `${e.damage}<-${e.sourceType === 'npc' ? (s.nearbyNpcs.find(n => n.index === e.sourceIndex)?.name ?? `npc#${e.sourceIndex}`) : e.sourceType}`);
        const prayers = PRAYER_NAMES.filter((_, i) => s.prayers?.activePrayers[i]);
        console.log(`TRACE t=${s.tick} @${p.worldX},${p.worldZ},${p.level} hp=${p.hp} anim=${p.animId} pp=${s.prayers?.prayerPoints ?? '?'} sharks=${sharks}${prayers.length ? ' pray=' + prayers.join('+') : ''}${by.length ? ' hits=' + by.join(',') : ''}${dialogChanged ? ' dialog=' + dialog : ''}${msgs.length ? ' msgs=' + JSON.stringify(msgs) : ''}`);
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
    const all = steps({ dialogue, note: line => console.log(line), bow: configId('obj', bow) });
    const chosen = all.slice(i0, i1 + 1);
    // --launch: this script owns the client (run with LAB_RUNNERS=0), so it can relog after a fixture's
    // ::setvar calls; those change the varps but not the quest tab state.quests publishes until a login
    // (login.rs2 ~update_questlist). Without it the tab may be stale, which nothing in H-M reads.
    const launch = process.argv.includes('--launch');
    const session = await openSession(botArg(), launch ? { launch: true } : {});
    const { sdk } = session;
    // A bot's first login on this engine's saves is on Tutorial Island, where every fixture's tele() refuses.
    await leaveTutorial(session);
    const table: Record<string, Array<number | string>> = Object.fromEntries(chosen.map(s => [s.name, []]));
    let passes = 0;
    for (let run = 0; run < runs; run++) {
        await applyFixture(sdk, from, { bow, ...(sharks ? { sharks: Number(sharks) } : {}), ...(potions ? { potions: Number(potions) } : {}) });
        if (launch) await relog(session);
        if (prayerAt) {
            const now = sdk.getState()!.prayers?.prayerPoints ?? 0;
            if (now > Number(prayerAt)) await cheat(sdk, `~stat_drain prayer ${now - Number(prayerAt)} 0`, 1);
        }
        const log = TickLog.memory();
        const s0 = sdk.getState()!;
        const hp0 = s0.player!.hp, pp0 = s0.prayers?.prayerPoints, doses0 = prayerDoses(s0);
        const sharks0 = s0.inventory.filter(i => i.name === 'Shark').length;
        const arrows0 = runeArrows(s0);
        const untrace = traceEvery > 0 ? trace(sdk, traceEvery) : () => undefined;
        let error: string | undefined;
        try {
            await runSteps(session, chosen, { log, c: {} as MmContext, shouldStop: () => false });
            passes++;
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
        } finally {
            untrace();
        }
        for (const row of log.rows) if (row.step !== BOUNDARY_STEP && row.step in table) table[row.step]!.push(row.ok ? row.ticks : `fail@${row.ticks}`);
        const boundary = log.rows.filter(r => r.step === BOUNDARY_STEP).reduce((a, r) => a + r.ticks, 0);
        const s = sdk.getState()!;
        result('mm_run', {
            run, from, until, ok: !error, ...(error ? { error } : {}),
            ticks: Object.fromEntries(log.rows.filter(r => r.step !== BOUNDARY_STEP).map(r => [r.step, r.ticks])), boundary,
            hp: [hp0, s.player?.hp], sharks: [sharks0, s.inventory.filter(i => i.name === 'Shark').length],
            prayer: [pp0, s.prayers?.prayerPoints], potionDoses: [doses0, prayerDoses(s)], runeArrows: [arrows0, runeArrows(s)], at: pos(s),
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
    await closeSession(session);
    process.exit(0);
}

if (import.meta.main) await main();
