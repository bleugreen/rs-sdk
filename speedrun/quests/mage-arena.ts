// The Mage Arena (S16, STEP-MANIFEST.md entry 19): Kolodion's five forms under Protect from Magic,
// which unlocks Charge for S18.
//
// From the arrival tile in Kolodion's cellar (2543,4713; legs.ts T15-16 brings SCORED down the mage
// bank ladder) to the god staff in hand in the chamber below, outside the Wilderness. Six
// segments, as docs/speedrun/quests/mage_arena.md's step list and quest-magearena-run.ts:
//   A kit          H13 held (or received from `kitFrom`), the entry check, the gree-gree dropped; with
//                  `h13At: 'cellar'`, H13's one swap with `kitFrom` on the arrival tile first
//   B kolodion     the talk and the arena teleport (logout-unsafe from here)
//   C fight        the five forms; finish_mage_arena teleports back to the cellar
//   D pool         the sparkling pool to the chamber
//   E statue       a god's statue, and the cape it drops
//   F guardian     the chamber guardian's staff: %magearena 8, Charge unlocked; then the exit drops
//                  (the god staff, the god cape and the sharks above S18's 2: the ledger's T16-18 row)
//
// What the content does that this module is built around (server/content/scripts/areas/
// area_mage_arena/scripts):
// - Kolodion refuses anyone carrying or wearing gloves, a helmet, body or leg armour, a shield, a
//   melee or ranged weapon, arrows, logs, bow parts, clue items or cannon parts
//   (mage_arena.rs2:100-138 ~can_enter_mage_arena, checked at kolodion.rs2:93 and :106). Staves,
//   amulets, capes, runes, food, potions, a knife and the gree-gree pass. `entryRefusal` reads the
//   same categories from the obj configs, by item id.
// - Each form only accepts spells from its own stage (907 + stage); leftovers of an aborted run are
//   refused. A form's death sets the next stage and spawns the next form (kolodion_fight.rs2).
// - Every Kolodion attack is a god spell; Protect from Magic blocks all of them
//   (npc_combat_magic.rs2:37) and so all their drains. Without it Flames of Zamorak drains Magic
//   below Fire Wave's 75 within two hits (mage_arena.md "Fights", m).
// - %magearena is not transmitted (rs/114) and the arena is not on the quest list, so the only
//   evidence of a stage is the cape (7) and the staff (8). In the cellar the stage before and after
//   the fight looks the same; Kolodion's reply tells them apart (kolodion.rs2:15-23: 'You return,
//   young conjurer' at 1-5, 'You're a tough one' at 6), so segment B is where a resumed run enters.
// - Fire Wave and Charge check the boosted level (magic.rs2:22); Kolodion's start the base level
//   (kolodion.rs2:6, 60). A magic potion is +4 (consume_effects.dbrow 1magic_consumable_effect).

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import type { BotSDK } from '../../sdk/index';
import type { BotWorldState, InventoryItem, NearbyNpc } from '../../sdk/types';
import { applyEquip, handOffMissing, handOffPre, itemPattern, loadHandOff, matches, runHandOff, slotPlan, tradeLanded, wanted, type Given, type HandOffPlan, type HandOffReport } from '../runner/handoff';
import { dropItems, opLoc, pickup, talkTo } from '../lib/act';
import { fight, prayerActive, prayerDoses, setPrayer } from '../lib/combat';
import { converse, levelUpInterrupt } from '../lib/converse';
import { pageText } from '../lib/dialogue';
import { matchesItem, type ItemPattern } from '../lib/items';
import { logNote } from '../lib/ticks';
import { runTo, sumUse, type RuneName, type RuneUse, type RuneUseTable } from '../lib/travel';
import { currentTick, waitTicks, waitUntil } from '../lib/wait';
import { findLoc, findNpc, invCount, invItem, messagesSince, npcByIndex, opIndex, pos, skillLevel, skillXp, worn } from '../lib/world';
import type { Check, Observed, StepContext } from '../runner/step';
import { allOf, inBox, kitSegment, questSteps, slotNeed, slotsCover, talkShape, within, type Box, type KitItem, type QuestItem, type QuestOptions, type Segment } from './segments';

export const quest = 'magearena' as const;
export const stepId = 'S16';

// ------------------------------------------------------------------ spells and gods

export type KolodionSpell = 'fire_wave' | 'fire_blast';

/**
 * The two spells the fight can use (magic_combat_spells.dbrow; magic.rs2:22 checks `level` against
 * the boosted level). The staff of fire covers the fire runes, so only `rune` and air are carried.
 */
export const SPELLS: Readonly<Record<KolodionSpell, { component: number; level: number; rune: RegExp; runeName: string; air: number }>> = {
    fire_wave: { component: 1189, level: 75, rune: /^blood rune$/i, runeName: 'Blood rune', air: 5 },
    fire_blast: { component: 1181, level: 59, rune: /^death rune$/i, runeName: 'Death rune', air: 4 },
};

/**
 * H13's runes for the fight by spell. Fire Wave: 90 blood (main's ruling, 10-22): 25 measured fights
 * from the route's arrival cast 42-59 times and one outlasted 70 (still on the last form at +383
 * ticks; m, lab, 300 ms, rs/371). Fire Blast: its lab maximum plus margin, 57-78 casts over 3
 * fights, so 78 + 12.
 */
export const SPELL_RUNES: Readonly<Record<KolodionSpell, number>> = { fire_wave: 90, fire_blast: 90 };

/**
 * The guard behind a spell: when its runes run out mid-fight the fight finishes on this one, since
 * every form takes any combat spell. Fire Wave falls back to Fire Blast on death runes, which
 * SCORED holds none of at S16 (H12 hands Fight Arena's back), so H13 carries FALLBACK_RUNES.
 */
export const FALLBACK: Readonly<Record<KolodionSpell, KolodionSpell | null>> = { fire_wave: 'fire_blast', fire_blast: null };
export const FALLBACK_RUNES = 25;
/**
 * Air for the guarded path (rs/158's ruling, 10-22): every Fire Wave's 5 and then every fallback
 * Fire Blast's 4, 550, as H13 stages it. Fire Blast's own 90 casts take 360 of it.
 */
export const AIR_RUNES = SPELL_RUNES.fire_wave * SPELLS.fire_wave.air + FALLBACK_RUNES * SPELLS.fire_blast.air;

export type God = 'saradomin' | 'guthix' | 'zamorak';
/** The statues (chamber.rs2; mage_arena.md step 10). Praying puts the cape on the tile south of it. */
export const STATUES: Readonly<Record<God, { x: number; z: number }>> = {
    saradomin: { x: 2500, z: 4721 },
    guthix: { x: 2507, z: 4724 },
    zamorak: { x: 2516, z: 4721 },
};

/** Kolodion's forms in stage order (mage_arena.npc; the `mage_arena_bosses` enum): kolhuman 907 to koldemon 911. */
export const FORM_IDS = [907, 908, 909, 910, 911] as const;

export const MAGIC_POTION_BOOST = 4;
export const PROTECT_PRAYER_LEVEL = 37;
/** Kolodion's own start check (kolodion.rs2:6), on the base level. */
export const KOLODION_MAGIC = 60;

/**
 * Prayer points the fight must have at the start, counting each potion dose at its restore (7 +
 * 25% of the level, consume_effects.dbrow). Protect from Magic drains ~1 point per 5.2 ticks; the
 * slowest measured fight used 67 points in 354 ticks and one run ran dry at tick 408 (mage_arena.md
 * "Fights", m): 90 covers ~470 ticks.
 */
export const PRAYER_BUDGET = 90;

// ------------------------------------------------------------------ places

/** Kolodion's cellar under the mage bank (outside the Wilderness, x < 2944). */
export const CELLAR: Box = { x0: 2530, z0: 4704, x1: 2552, z1: 4726 };
/** The arrival tile (legs.ts T15-16 `kolodionCellar`). */
export const ARRIVAL = { x: 2543, z: 4713 } as const;
/** The arena, Wilderness level 52 (^mage_arena_start_coord 3105,3934). */
export const ARENA: Box = { x0: 3070, z0: 3900, x1: 3140, z1: 3970 };
/** The chamber the pool leads to (2509,4689), statues to the north, guardian at (2506,4696). */
export const CHAMBER: Box = { x0: 2488, z0: 4680, x1: 2526, z1: 4730 };
const POOL = /sparkling pool/i;
const GUARDIAN = /chamber guardian/i;
const GUARDIAN_STAND = { x: 2506, z: 4699, tol: 2 } as const;

export const inCellar = (s: BotWorldState | null | undefined) => !!s && inBox(s, CELLAR);
export const inArena = (s: BotWorldState | null | undefined) => !!s && inBox(s, ARENA);
export const inChamber = (s: BotWorldState | null | undefined) => !!s && inBox(s, CHAMBER);

// ------------------------------------------------------------------ items

export const GOD_CAPE = /^cape of (saradomin|guthix|zamorak)$/i;
export const GOD_STAFF = /^staff of (saradomin|guthix|zamorak)$/i;
export const FIRE_STAFF = /^staff of fire$/i;
export const GREEGREE = /^monkey greegree$/i;
export const MAGIC_POTION = /^magic potion\(\d\)$/i;
const SHARK = /^shark$/i;

/** The segment letters in order, for the free-slot need. */
export const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;

/** What the content hands the step: the cape (chamber.rs2:19, picked up) and the staff (chamber_guardian.rs2:14). T16-18 drops both. */
export const QUEST_ITEMS: readonly QuestItem[] = [
    { item: GOD_CAPE, name: 'God cape', from: 'E' },
    { item: GOD_STAFF, name: 'God staff', from: 'F' },
];

/**
 * S16's exit drops, the inventory ledger's T16-18 row done at F's end (as Dwarf Cannon drops its tool
 * kit and Monkey Madness its seal inside their steps): the god staff (untradeable) and the god cape
 * are dead once %magearena is 8, which the staff's handing-over sets (chamber_guardian.rs2:15);
 * Charge needs neither (charge.rs2 checks the stage). The sharks go down to S18's 2.
 */
export const EXIT_DROPS: readonly RegExp[] = [GOD_STAFF, GOD_CAPE];
export const KEEP_SHARKS = 2;

/** The inventory items the exit drops: every EXIT_DROPS item, and the sharks after the first `keepSharks`. */
export function exitDropItems(s: BotWorldState, keepSharks = KEEP_SHARKS): InventoryItem[] {
    const dead = s.inventory.filter(i => EXIT_DROPS.some(p => p.test(i.name)));
    const sharks = s.inventory.filter(i => SHARK.test(i.name)).slice(Math.max(0, keepSharks));
    return [...dead, ...sharks];
}

/** The exit's state: none of EXIT_DROPS held or worn, at most `keepSharks` sharks. */
export function exitClean(keepSharks = KEEP_SHARKS): Check<any> {
    return s => {
        const kept = EXIT_DROPS.filter(p => held(s, p)).map(String);
        const sharks = invCount(s, SHARK);
        if (kept.length) return `still holding ${kept.join(', ')} (S16's exit drops, the ledger's T16-18 row)`;
        return sharks <= keepSharks ? true : `${sharks} sharks held, S18 takes ${keepSharks} (the ledger's T16-18 row)`;
    };
}

/**
 * S16's share of H13: the fight's runes, the fallback's included. The staff of fire is worn (a
 * precondition); the prayer potions are counted as prayer budget. `spellRunes` lowers the spell's
 * count (the lab's lever for a forced run-out).
 */
export function kit(spell: KolodionSpell, spellRunes = SPELL_RUNES[spell]): KitItem[] {
    const fb = FALLBACK[spell];
    return [
        { item: SPELLS[spell].rune, n: spellRunes },
        ...(fb ? [{ item: SPELLS[fb].rune, n: FALLBACK_RUNES }] : []),
        { item: /^air rune$/i, n: AIR_RUNES },
    ];
}

// The entry check's categories (mage_arena.rs2:100-138), worn and carried, and the items it
// names by type.
const BARRED_CATEGORIES = new Set([
    'armour_hands', 'armour_helmet', 'armour_body', 'armour_legs', 'armour_shield',
    'weapon_slash', 'weapon_blunt', 'weapon_stab', 'weapon_crossbow', 'weapon_axe', 'weapon_pickaxe', 'weapon_javelin',
    'weapon_2h_sword', 'weapon_spear', 'weapon_spiked', 'weapon_thrown', 'weapon_scythe', 'weapon_bow', 'weapon_claws',
    'weapon_polearm', 'arrows',
]);
/** Carried only (the check reads `inv`, not `worn`, for these). */
const BARRED_CARRIED_CATEGORIES = new Set([
    'unstrung_bow', 'category_22', 'trail_clue_easy', 'trail_clue_medium', 'trail_clue_hard',
    'trail_casket_easy', 'trail_casket_medium', 'trail_casket_hard', 'cannon_parts',
]);
const BARRED_CARRIED_OBJS = new Set(['headless_arrow', 'arrow_shaft', 'bow_string']);

const CONTENT_DIR = join(import.meta.dir, '..', '..', 'server', 'content');
let objTable: Map<number, { debug: string; category?: string }> | null = null;

/** obj id -> debug name and category, from server/content/pack/obj.pack and the .obj configs. */
function objs(): Map<number, { debug: string; category?: string }> {
    if (objTable) return objTable;
    const ids = new Map<string, number>();
    for (const line of readFileSync(join(CONTENT_DIR, 'pack', 'obj.pack'), 'utf8').split('\n')) {
        const i = line.indexOf('=');
        if (i > 0) ids.set(line.slice(i + 1).trim(), parseInt(line.slice(0, i), 10));
    }
    const cats = new Map<string, string>();
    const scripts = join(CONTENT_DIR, 'scripts');
    for (const f of readdirSync(scripts, { recursive: true }) as string[]) {
        if (!f.endsWith('.obj')) continue;
        let cur: string | null = null;
        for (const line of readFileSync(join(scripts, f), 'utf8').split('\n')) {
            const head = /^\[([^\]]+)\]/.exec(line);
            if (head) cur = head[1]!;
            else if (cur && line.startsWith('category=')) cats.set(cur, line.slice('category='.length).trim());
        }
    }
    objTable = new Map();
    for (const [debug, id] of ids) {
        const category = cats.get(debug);
        objTable.set(id, category ? { debug, category } : { debug });
    }
    return objTable;
}

/** Why Kolodion would refuse this item, or null: its category or type as ~can_enter_mage_arena reads it. */
export function barredReason(item: Pick<InventoryItem, 'id' | 'name'>, where: 'worn' | 'carried'): string | null {
    const o = objs().get(item.id);
    if (!o) return null;
    if (o.category && BARRED_CATEGORIES.has(o.category)) return o.category;
    if (where === 'carried' && o.category && BARRED_CARRIED_CATEGORIES.has(o.category)) return o.category;
    if (where === 'carried' && BARRED_CARRIED_OBJS.has(o.debug)) return o.debug;
    return null;
}

/** An item Kolodion's entry check bars, where SCORED has it, and the category or type it is barred by. */
export interface Barred {
    item: InventoryItem;
    where: 'worn' | 'carried';
    why: string;
}

/** Every item the entry check bars, worn and carried, read by item id (barredReason). */
export function entryBarred(s: BotWorldState): Barred[] {
    const of = (item: InventoryItem, where: Barred['where']): Barred[] => {
        const why = barredReason(item, where);
        return why === null ? [] : [{ item, where, why }];
    };
    return [...s.equipment.flatMap(i => of(i, 'worn')), ...s.inventory.flatMap(i => of(i, 'carried'))];
}

/** The entry check as the server runs it: every barred item carried or worn, or null when Kolodion would let SCORED in. */
export function entryRefusal(s: BotWorldState): string | null {
    const bad = entryBarred(s);
    return bad.length ? `Kolodion's entry check (mage_arena.rs2:100-138) refuses: ${bad.map(b => `${b.item.name} ${b.where} (${b.why})`).join(', ')}` : null;
}

// ------------------------------------------------------------------ options

export interface Options extends QuestOptions {
    /** The fight's spell. Default 'fire_wave' (H13's blood runes); 'fire_blast' spends death runes instead and frees the blood for S18. */
    spell?: KolodionSpell;
    /** The spell runes the kit wants (default SPELL_RUNES[spell], H13). The lab lowers it to force the fallback. */
    spellRunes?: number;
    /** Which statue (default saradomin). Charge does not care; the god only picks the god spell. */
    god?: God;
    /** Drink a prayer potion below this many points in the fight (default 15). */
    drinkBelow?: number;
    /** Eat a shark below this HP in the fight (default 30; under the prayer nothing should hit). */
    eatBelow?: number;
    /** Sharks kept at the exit (default KEEP_SHARKS, S18's 2); the rest are dropped with the god staff and cape. */
    keepSharks?: number;
    /** Fight's tick bound (default 1500). */
    fightMaxTicks?: number;
    /** Counters the fight fills in (casts, runes, xp, prayer), for the lab's report. */
    tally?: FightTally;
    /**
     * The fight is known to be won (%magearena >= 6) though the account is in the cellar: lets
     * segment D start without B having seen it (the lab's D fixture). In the run, B or C sets it.
     */
    fought?: boolean;
    /**
     * Where H13 is handed (rs/158's proposal, rs/488; main rules on adopting it). 'ardougne' (the
     * default): at the Ardougne teleport landing before T15-16, so A finds the staff of fire worn and
     * the entry check clean and only tops the kit up from `kitFrom`. 'cellar': here on the arrival
     * tile, outside the Wilderness, so the fight's runes never cross it; A does H13's one swap with
     * `kitFrom` (cellarPlan) and wields the staff, and the entry check and the staff move to A's
     * postconditions.
     */
    h13At?: H13At;
    /** The cellar swap's ledger row (default STEP-MANIFEST.md's H13, read when the steps are built in cellar mode). */
    h13Plan?: HandOffPlan;
    /** The cellar swap's report (its ticks and what moved), for the lab. */
    onH13?: (r: HandOffReport) => void;
}

export type H13At = 'ardougne' | 'cellar';
export const DEFAULT_H13_AT: H13At = 'ardougne';
/** The inventory ledger row the cellar swap trades. */
export const H13_ROW = 'H13';

export const DEFAULT_SPELL: KolodionSpell = 'fire_wave';
export const DEFAULT_GOD: God = 'saradomin';

/**
 * Fire Wave's measured maximum from the route's arrival: 42-59 casts over rs/371's 25 counted fights
 * (m, lab, 300 ms). One more fight outlasted 70 casts uncounted, so RUNE_USE declares the guarded
 * worst case instead (rs/158's ruling): SPELL_RUNES' Waves, then the fallback's Blasts.
 */
export const FIRE_WAVE_MAX_CASTS = 59;

/** The rune each spell uses up, by debug name (SPELLS' `rune`). */
const SPELL_RUNE: Readonly<Record<KolodionSpell, RuneName>> = { fire_wave: 'bloodrune', fire_blast: 'deathrune' };
/** `casts` casts of `spell`, its fire the staff's. */
const castUse = (spell: KolodionSpell, casts: number): RuneUse => ({ [SPELL_RUNE[spell]]: casts, airrune: SPELLS[spell].air * casts });

/** The worn staff whose element RUNE_USE leaves out (fightReady wants it worn). */
export const RUNE_STAFF = 'staff of fire';

/**
 * The step's runes on the route (lib/travel.ts RuneUseTable): the fight (C) at its guarded worst case,
 * the spell's kit all spent and then the fallback's, since the measured maximum is open past 70.
 * Leftover blood merges into S18's stack, so the ledger never counts on it.
 */
export const RUNE_USE: RuneUseTable = {
    C: sumUse(castUse(DEFAULT_SPELL, SPELL_RUNES[DEFAULT_SPELL]), FALLBACK[DEFAULT_SPELL] ? castUse(FALLBACK[DEFAULT_SPELL]!, FALLBACK_RUNES) : {}),
};

/** What fightReady wants held from B on (A receives it): the default spell's kit, its fallback's included. */
export const RUNE_NEED: RuneUseTable = {
    B: sumUse(
        { [SPELL_RUNE[DEFAULT_SPELL]]: SPELL_RUNES[DEFAULT_SPELL], airrune: AIR_RUNES },
        FALLBACK[DEFAULT_SPELL] ? { [SPELL_RUNE[FALLBACK[DEFAULT_SPELL]!]]: FALLBACK_RUNES } : {},
    ),
};


/** What one fight did, for the lab and the run's record. */
export interface FightTally {
    spell: KolodionSpell;
    /** Arena landing to the cellar landing. */
    ticks: number;
    /** Casts that landed, counted by the runes spent (the spell's and the fallback's). */
    casts: number;
    /** Cast clicks sent (every 2 ticks while a form is up). */
    clicks: number;
    /** The spell's own runes. */
    runesUsed: number;
    /** The fallback taken when the spell's runes ran out: its spell, the fight tick it started, its runes spent. */
    fallback: { spell: KolodionSpell; at: number; runesUsed: number } | null;
    /** Npc indices of an earlier fight's leftover forms that this fight ignored (formPicker). */
    ignored: number[];
    airUsed: number;
    /** Game xp (base = /25). */
    magicXp0: number;
    magicXp1: number;
    magicBase0: number;
    magicBase1: number;
    hp0: number;
    hpMin: number;
    hp1: number;
    prayer0: number;
    prayer1: number;
    /** Points drained, potion doses drunk, potions sipped. */
    prayerUsed: number;
    doses: number;
    magicSips: number;
    eats: number;
    levelUps: number;
    forms: Array<{ id: number; ticks: number }>;
}

export function newTally(spell: KolodionSpell = DEFAULT_SPELL): FightTally {
    return {
        spell, ticks: 0, casts: 0, clicks: 0, runesUsed: 0, fallback: null, ignored: [], airUsed: 0, magicXp0: 0, magicXp1: 0, magicBase0: 0, magicBase1: 0,
        hp0: 0, hpMin: 0, hp1: 0, prayer0: 0, prayer1: 0, prayerUsed: 0, doses: 0, magicSips: 0, eats: 0, levelUps: 0, forms: [],
    };
}

// ------------------------------------------------------------------ checks

const baseOf = (s: BotWorldState, skill: string) => s.skills.find(k => k.name.toLowerCase() === skill)?.baseLevel ?? 0;
const boostedOf = (s: BotWorldState, skill: string) => skillLevel(s, skill);
const held = (s: BotWorldState, p: ItemPattern) => !!invItem(s, p) || !!worn(s, p);

/** Prayer points the fight can draw: points now plus each held dose at its restore. */
export function prayerBudget(s: BotWorldState): number {
    const level = s.prayers?.prayerLevel ?? baseOf(s, 'prayer');
    return (s.prayers?.prayerPoints ?? 0) + prayerDoses(s) * (7 + Math.floor(level / 4));
}

/** The spell castable for the whole fight: boosted at its level now, or a magic potion held that lifts the base to it. */
export function spellReady(spell: KolodionSpell): Check<any> {
    return s => {
        const need = SPELLS[spell].level;
        if (boostedOf(s, 'magic') >= need) return true;
        if (baseOf(s, 'magic') + MAGIC_POTION_BOOST >= need && invItem(s, MAGIC_POTION)) return true;
        return `${spell} needs Magic ${need} (boosted, magic.rs2:22): base ${baseOf(s, 'magic')}, boosted ${boostedOf(s, 'magic')}, ${invItem(s, MAGIC_POTION) ? 'a magic potion held' : 'no magic potion'}`;
    };
}

const kolodionLevel: Check<any> = s => (baseOf(s, 'magic') >= KOLODION_MAGIC ? true : `Kolodion wants base Magic ${KOLODION_MAGIC} (kolodion.rs2:6): base ${baseOf(s, 'magic')}`);
const fireStaffWorn: Check<any> = s => (worn(s, FIRE_STAFF) ? true : 'the staff of fire is not wielded (it covers the spell\'s fire runes)');
const protectLevel: Check<any> = s => ((s.prayers?.prayerLevel ?? baseOf(s, 'prayer')) >= PROTECT_PRAYER_LEVEL ? true : `Protect from Magic needs Prayer ${PROTECT_PRAYER_LEVEL}`);
const prayerEnough: Check<any> = s => (prayerBudget(s) >= PRAYER_BUDGET ? true : `prayer: ${s.prayers?.prayerPoints ?? 0} points and ${prayerDoses(s)} potion doses make ${prayerBudget(s)}, the fight wants ${PRAYER_BUDGET}`);
const entryClean: Check<any> = s => entryRefusal(s) ?? true;
const noGreegree: Check<any> = s => (invItem(s, GREEGREE) ? 'the monkey greegree is still held (dropped at S16\'s start: untradeable and dead)' : true);
const runeName = (p: string | RegExp) => String(p).replace(/^\/\^?|\$?\/i?$/g, '');
const kitHeld = (spell: KolodionSpell, spellRunes?: number): Check<any> => s => {
    const short = kit(spell, spellRunes).filter(k => invCount(s, k.item) < (k.n ?? 1));
    return short.length ? `kit (H13): ${short.map(k => `${runeName(k.item)} ${invCount(s, k.item)} held, want >= ${k.n}`).join('; ')}` : true;
};
const inCellarCheck = within(CELLAR, "Kolodion's cellar");
const inChamberCheck = within(CHAMBER, 'the chamber');
const capeHeld: Check<any> = s => (held(s, GOD_CAPE) ? true : 'no god cape held or worn');
const chargeSeen = (memo: { chargeUnlocked: boolean }): Check<any> => () => (memo.chargeUnlocked ? true : 'Charge not seen unlocked: no god staff from the guardian (%magearena 8)');
const noDialog: Check<any> = s => (s.dialog.isOpen || s.modalOpen ? 'a dialogue or modal is still open' : true);

/** The fight's start: everything B needs besides the place. */
export function fightReady(spell: KolodionSpell, spellRunes?: number): Check<any> {
    return allOf(entryClean, noGreegree, kitHeld(spell, spellRunes), fireStaffWorn, spellReady(spell), protectLevel, prayerEnough);
}

// ------------------------------------------------------------------ H13 in the cellar

/**
 * H13 as the cellar swap trades it: the ledger row, with every item the entry check bars that the row
 * neither gives nor drops added by obj id and all of it (runHandOff takes a worn one off first): to
 * its gives when tradeable, to its drops when the engine refuses it in a trade. The extras are read
 * off the state the swap starts from.
 */
export function cellarPlan(s: BotWorldState, row: HandOffPlan): HandOffPlan {
    const give: Given[] = [];
    const drop: Given[] = [];
    for (const { item } of entryBarred(s)) {
        if ([...row.give, ...row.drop, ...give, ...drop].some(g => matches(g, item))) continue;
        (untradeable(item.id) ? drop : give).push({ name: item.name.toLowerCase(), pattern: itemPattern(item.name), ids: [item.id], perObj: true, count: 'all' });
    }
    return give.length || drop.length ? { ...row, give: [...row.give, ...give], drop: [...row.drop, ...drop] } : row;
}

/** The fight's kit lines the swap leaves short: held now plus what the row's `in` adds. */
function kitShortAfter(s: BotWorldState, row: HandOffPlan, items: readonly KitItem[]): string[] {
    return items.flatMap(k => {
        const n = k.n ?? 1;
        const adds = row.receive.filter(r => matchesItem({ id: r.ids?.[0] ?? -1, name: r.name }, k.item)).reduce((a, r) => a + wanted(s, r), 0);
        const have = invCount(s, k.item) + adds;
        return have < n ? [`${runeName(k.item)} ${have} of ${n}`] : [];
    });
}

/**
 * A's start in cellar mode, before the swap: the helper named and in view, nothing the row hands in
 * that Kolodion bars, the row's `in` covering the fight's kit, every item the swap gives held, and
 * room for the swap and then for E's cape and F's staff. Once the swap has landed (a resume) only
 * the slots are asked again.
 */
function cellarReady(row: HandOffPlan, kitFrom: string | undefined, items: readonly KitItem[]): Check<any> {
    const at = `${row.id} in the cellar`;
    return s => {
        const plan = cellarPlan(s, row);
        if (tradeLanded(s, plan)) return slots('A')(s, undefined);
        if (!kitFrom) return `${at}: no kitFrom, the helper on the arrival tile to swap with (h13At 'cellar')`;
        const both = entryBarred(s).filter(b => row.receive.some(r => matches(r, b.item)));
        if (both.length) return `${at}: the row hands in ${both.map(b => b.item.name).join(', ')}, which Kolodion's entry check bars`;
        const short = kitShortAfter(s, row, items);
        if (short.length) return `${at}: the row's in leaves the fight's kit short: ${short.join('; ')}`;
        const pre = handOffPre(s, plan, kitFrom);
        if (pre !== true) return `${at}: ${pre}`;
        // The gree-gree is dropped after the swap: one slot back.
        const free = slotPlan(s, plan).after + (held(s, GREEGREE) ? 1 : 0);
        const need = slotNeed(s, QUEST_ITEMS, LETTERS, 'A');
        return free >= need.slots ? true : `inventory: ${free} free slots after the ${row.id} swap and the gree-gree's drop, segment ${need.peak} needs ${need.slots} (${need.items.join(', ')}): ${need.slots - free} short`;
    };
}

/** The row's post-swap state: every `in` held, every given item gone, the staff worn and the gree-gree off. */
const h13Done = (row: HandOffPlan): Check<any> => s => {
    const missing = handOffMissing(s, row);
    return missing.length ? `${row.id} after the cellar swap: ${missing.join('; ')}` : true;
};

/** The swap, or after a logout that landed it, only the equip changes. */
async function cellarSwap(sdk: Sdk, row: HandOffPlan, kitFrom: string | undefined, onReport?: (r: HandOffReport) => void): Promise<void> {
    const plan = cellarPlan(sdk.getState()!, row);
    if (tradeLanded(sdk.getState()!, plan)) return applyEquip(sdk, plan);
    if (!kitFrom) throw new Error(`${row.id} in the cellar: no kitFrom to swap with`);
    await runHandOff(sdk, plan, kitFrom, onReport ? { onReport } : {});
}

// ------------------------------------------------------------------ the arena player log

/** Players within this many tiles (Chebyshev) of SCORED in the arena get a note row. */
export const ARENA_WATCH_TILES = 15;
/** The note rows' step name. */
export const ARENA_PLAYERS_NOTE = `${stepId}:arena-players`;

/** One player seen near SCORED in the arena. Never the name. `form`: the Kolodion form being fought, null on B's landing. */
export interface ArenaSighting {
    tick: number;
    distance: number;
    combatLevel: number;
    form: number | null;
}

/**
 * The players within ARENA_WATCH_TILES of SCORED in the arena that `seen` has not had at this form.
 * `seen` keys on the player's world slot, so a player is logged once per form however long it stays.
 */
export function arenaSightings(s: BotWorldState, form: number | null, seen: Set<string>): ArenaSighting[] {
    const me = s.player;
    if (!me || !inArena(s)) return [];
    const out: ArenaSighting[] = [];
    for (const p of s.nearbyPlayers) {
        const distance = Math.max(Math.abs(p.x - me.worldX), Math.abs(p.z - me.worldZ));
        if (distance > ARENA_WATCH_TILES) continue;
        const key = `${p.index}@${form ?? 'landing'}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ tick: s.tick, distance, combatLevel: p.combatLevel, form });
    }
    return out;
}

// ------------------------------------------------------------------ the fight

/** The SDK surface the segments use (BotSDK in the run; lib/fake-sdk.ts in tests). */
type Sdk = BotSDK;

const firstOp = (i: InventoryItem, re: RegExp) => i.optionsWithIndex.find(o => re.test(o.text))?.opIndex;

/** Drink one dose of the magic potion, if held; true when sent. */
function sipMagic(sdk: Sdk, s: BotWorldState): boolean {
    const pot = invItem(s, MAGIC_POTION);
    if (!pot) return false;
    void sdk.sendUseItem(pot.slot, firstOp(pot, /^drink$/i) ?? 1);
    return true;
}

/** Kolodion's forms that can be attacked now. */
const forms = (s: BotWorldState) => s.nearbyNpcs.filter(n => n.name === 'Kolodion' && n.hp !== 0 && opIndex(n, /attack/i) !== undefined && (FORM_IDS as readonly number[]).includes(n.id));

/**
 * Which form in view is this fight's own, stage by stage. Forms live 1000 ticks and Kolodion's
 * teleport clears only out-of-combat leftovers of the stage it starts (kolodion.rs2:136-141), so a
 * fight aborted at a later form leaves it standing in the arena; with SCORED's own form attacking
 * (single-way combat) casts at a leftover are refused and the fight never moves. `ignore` holds
 * the leftovers' npc indices, which the talk reads off the landing tick, before this fight's form
 * spawns. The stage starts at the lowest form in view that is not ignored (a resumed fight finds its
 * own) and moves on when the next id appears.
 */
export function formPicker(ignore: readonly number[] = []): { current(s: BotWorldState): NearbyNpc | undefined; readonly stage: number } {
    const skip = new Set(ignore);
    let stage = -1;
    return {
        get stage() {
            return stage;
        },
        current(s) {
            const fs = forms(s).filter(n => !skip.has(n.index));
            if (!fs.length) return undefined;
            if (stage < 0) stage = Math.min(...fs.map(n => n.id)) - FORM_IDS[0];
            if (!fs.some(n => n.id === FORM_IDS[0] + stage) && fs.some(n => n.id === FORM_IDS[0] + stage + 1)) stage++;
            return fs.find(n => n.id === FORM_IDS[0] + stage);
        },
    };
}

export interface FightOpts {
    spell?: KolodionSpell;
    /** Finish on this spell when the first's runes run out (default FALLBACK[spell]; null: none, the fight throws). */
    fallback?: KolodionSpell | null;
    /** Npc indices of forms an earlier fight left in the arena (formPicker): never targeted. */
    ignore?: readonly number[];
    drinkBelow?: number;
    eatBelow?: number;
    maxTicks?: number;
    tally?: FightTally;
    /** Per-tick hook for the lab's trace. */
    onTick?: (s: BotWorldState, target: NearbyNpc | null) => void;
}

/**
 * Fight Kolodion from the arena landing until finish_mage_arena puts SCORED back in the cellar,
 * under Protect from Magic. Only the current stage's form is attacked (formPicker). A level-up page is dismissed with the cast re-sent behind it (lib/combat.ts); the magic potion is
 * sipped again whenever the boosted level falls below the spell's. When the spell's runes run out
 * the fight goes on with the fallback's (FALLBACK). Throws on a death, a timeout, or no runes for
 * either.
 */
export async function fightKolodion(sdk: Sdk, o: FightOpts = {}): Promise<FightTally> {
    const spell = o.spell ?? DEFAULT_SPELL;
    const fb = o.fallback === undefined ? FALLBACK[spell] : o.fallback;
    let sp = SPELLS[spell];
    const t = o.tally ?? newTally(spell);
    t.spell = spell;
    t.fallback = null;
    t.ignored = [...(o.ignore ?? [])];
    const s0 = sdk.getState()!;
    const tArena = s0.tick;
    const maxTicks = o.maxTicks ?? 1500;
    const runes0 = invCount(s0, sp.rune);
    const fbRunes0 = fb ? invCount(s0, SPELLS[fb].rune) : 0;
    const castable = (st: BotWorldState) => invCount(st, sp.rune) >= 1;
    /** Out of the spell's runes: switch to the fallback if its runes are held; false when there is nothing left to cast. */
    const fallBack = (st: BotWorldState): boolean => {
        if (!fb || t.fallback || invCount(st, SPELLS[fb].rune) < 1) return false;
        sp = SPELLS[fb];
        t.fallback = { spell: fb, at: st.tick - tArena, runesUsed: 0 };
        return true;
    };
    const air0 = invCount(s0, /^air rune$/i);
    const doses0 = prayerDoses(s0);
    t.magicXp0 = skillXp(s0, 'magic');
    t.magicBase0 = baseOf(s0, 'magic');
    t.hp0 = s0.player?.hp ?? 0;
    t.hpMin = t.hp0;
    t.prayer0 = s0.prayers?.prayerPoints ?? 0;
    const picker = formPicker(o.ignore);
    const current = (s: BotWorldState) => picker.current(s);
    let lastSip = -Infinity;
    const lost = (s: BotWorldState) => !inArena(s) && !inCellar(s);
    for (;;) {
        const s = sdk.getState()!;
        if (inCellar(s)) break;
        const elapsed = s.tick - tArena;
        if (elapsed > maxTicks) throw new Error(`fight: no finish in ${maxTicks} ticks at ${JSON.stringify(pos(s))}, stage ${picker.stage}`);
        const w = await waitUntil(sdk, st => inCellar(st) || lost(st) || current(st) !== undefined, { maxTicks: maxTicks - elapsed });
        if (!w.ok) throw new Error(`fight: no form to attack at +${currentTick(sdk) - tArena} (stage ${picker.stage}; in view ${JSON.stringify(forms(sdk.getState()!).map(n => [n.id, n.index, n.hp]))}; ignored ${JSON.stringify(o.ignore ?? [])})`);
        if (inCellar(w.state)) break;
        if (lost(w.state)) throw new Error(`fight: left the arena at +${w.state.tick - tArena} (${JSON.stringify(pos(w.state))}): a death?`);
        const target = current(w.state)!;
        const tForm = w.state.tick;
        if (!castable(w.state) && !fallBack(w.state)) throw new Error(`fight: out of ${sp.runeName}s${fb && t.fallback ? ` (after the ${fb} fallback)` : ''} at form ${target.id} (+${tForm - tArena})`);
        const f = await fight(sdk, target, {
            spell: sp.component, castEvery: 2,
            prayer: 'protect_from_magic', drinkBelow: o.drinkBelow ?? 15,
            food: SHARK, eatBelow: o.eatBelow ?? 30,
            onDialog: 'continue',
            maxTicks: maxTicks - (tForm - tArena),
            // over when the form changes type in place (the next form is fought by its own id), or
            // when the runes run out (the loop falls back, or throws)
            done: st => inCellar(st) || lost(st) || (npcByIndex(st, target.index)?.id ?? target.id) !== target.id || !castable(st),
            onTick: (st, npc) => {
                o.onTick?.(st, npc);
                if (boostedOf(st, 'magic') < sp.level && st.tick - lastSip >= 3 && sipMagic(sdk, st)) {
                    lastSip = st.tick;
                    t.magicSips++;
                    return true; // an inventory click clears the cast: re-send it
                }
                return false;
            },
        });
        t.clicks += f.attacks;
        t.eats += f.eats;
        t.levelUps += f.levelUps;
        t.hpMin = Math.min(t.hpMin, f.minHp);
        t.prayerUsed += f.prayerUsed;
        t.forms.push({ id: target.id, ticks: f.ticks });
        if (f.died || f.end === 'timeout') throw new Error(`fight: ${f.end} at form ${target.id}, +${currentTick(sdk) - tArena}, ${JSON.stringify(pos(sdk))}`);
    }
    const s1 = sdk.getState()!;
    t.ticks = s1.tick - tArena;
    t.runesUsed = runes0 - invCount(s1, SPELLS[spell].rune);
    // set inside fallBack: read through the declared type, not the `null` narrowed above
    const taken = t.fallback as FightTally['fallback'];
    if (taken && fb) taken.runesUsed = fbRunes0 - invCount(s1, SPELLS[fb].rune);
    t.casts = t.runesUsed + (taken?.runesUsed ?? 0);
    t.airUsed = air0 - invCount(s1, /^air rune$/i);
    t.hp1 = s1.player?.hp ?? 0;
    t.prayer1 = s1.prayers?.prayerPoints ?? 0;
    t.doses = doses0 - prayerDoses(s1);
    return t;
}

/** After the fight: the xp the fight paid shows a tick or so after the last hit; read it once the cellar is reached. */
function closeTally(t: FightTally, s: BotWorldState): void {
    t.magicXp1 = skillXp(s, 'magic');
    t.magicBase1 = baseOf(s, 'magic');
}

// ------------------------------------------------------------------ segments

/** Kolodion's opening, read from kolodion.rs2 (mage_arena.md "Dialogue runs"): the last page is the teleport. */
const SHAPE_KOLODION = '2c, opt, 3c, opt, 4c, opt, 3c, state';
/** chamber.rs2:14-22: the chant mesbox, the cape on the ground, the second mesbox. */
const SHAPE_STATUE = 'state, 1c';
/** chamber_guardian.rs2:10-16: four pages, then the staff and stage 8 before the objbox. */
const SHAPE_GUARDIAN = '4c, state';

const TOUGH_ONE = /you're a tough one|what now\?|step into the magic pool/i;
const REFUSED = /cannot enter the arena while carrying weapons or armour/i;

/** chamber_guardian.rs2:21-23, his default once %magearena is 8: the staff was given before. */
const HELLO_AGAIN = /are you looking for another staff/i;

/** Shared by the segments of one `steps()` call: what the run has seen that the client cannot show. */
interface RunMemo {
    fought: boolean;
    /** %magearena 8 seen: the staff in hand, or the guardian's stage-8 greeting. */
    chargeUnlocked: boolean;
    /** Forms in view on the arena landing tick of this run's talk: an earlier fight's leftovers (formPicker). */
    leftovers: number[];
    /** The arena player log: the form being fought (null before the first), and who was logged at which. */
    form: number | null;
    seenPlayers: Set<string>;
}

/** Log arenaSightings as note rows for as long as the returned unsubscribe is not called. Logs only. */
function watchArena(ctx: StepContext<any>, memo: RunMemo): () => void {
    const target = ctx.session ?? ctx.sdk;
    return ctx.sdk.onStateUpdate(s => {
        for (const row of arenaSightings(s, memo.form, memo.seenPlayers)) logNote(ctx.log, target, ARENA_PLAYERS_NOTE, { ...row });
    });
}

const staffDropped = (s: BotWorldState) => s.groundItems.some(g => GOD_STAFF.test(g.name) && g.distance <= 3);
/** The guardian's staff seen: held, or on the ground beside SCORED where the exit dropped it. */
const staffSeen = (s: BotWorldState) => held(s, GOD_STAFF) || (inChamber(s) && staffDropped(s));
/** F's durable mark once the exit drops are out: neither god item held, the dropped staff on the ground beside SCORED. */
const exitedChamber = (s: BotWorldState) => inChamber(s) && !held(s, GOD_STAFF) && !held(s, GOD_CAPE) && staffDropped(s);

async function talkKolodion(sdk: Sdk, opts: Options | undefined, memo: RunMemo): Promise<void> {
    const spell = opts?.spell ?? DEFAULT_SPELL;
    const s0 = sdk.getState()!;
    // Fire Wave at base 74-75: one dose now (+4, falling a level per 100 ticks; the fight re-sips).
    if (boostedOf(s0, 'magic') < SPELLS[spell].level || (spell === 'fire_wave' && baseOf(s0, 'magic') <= 75 && boostedOf(s0, 'magic') <= baseOf(s0, 'magic'))) {
        if (sipMagic(sdk, s0)) {
            if (opts?.tally) opts.tally.magicSips++;
            await waitUntil(sdk, s => boostedOf(s, 'magic') > baseOf(s, 'magic'), { maxTicks: 5 });
        }
    }
    const p = await setPrayer(sdk, 'protect_from_magic', true);
    if (!p.ok) throw new Error(`kolodion: Protect from Magic would not go on (${p.reason})`);
    const kol = findNpc(sdk, /^Kolodion$/) ?? undefined;
    let refused = false;
    let won = false;
    let landed = false;
    memo.leftovers = [];
    // converse reads `until` only while the dialogue is closed: the pages are watched here. The
    // landing tick is caught here too: this fight's form spawns at least a tick after it
    // (kolodion.rs2:142-194), so whatever form is in view then is a leftover.
    const unsub = sdk.onStateUpdate(s => {
        if (!landed && inArena(s)) {
            landed = true;
            memo.leftovers = forms(s).map(n => n.index);
        }
        const text = pageText(s.dialog);
        if (REFUSED.test(text)) refused = true;
        if (TOUGH_ONE.test(text)) won = true;
    });
    const r = await talkTo(sdk, kol ?? /^Kolodion$/, ['Can I fight here?', 'Yes indeedy.', "Ok, let's fight."], {
        ...talkShape(opts, SHAPE_KOLODION),
        interrupts: [levelUpInterrupt()],
        openTicks: 20,
        maxTicks: 120,
        until: s => inArena(s) || refused || won,
    }).finally(unsub);
    if (refused || messagesSince(sdk, s0.tick, REFUSED).length) throw new Error(`kolodion: ${entryRefusal(sdk.getState()!) ?? 'refused entry (weapons or armour carried)'}`);
    if (won) {
        memo.fought = true;
        await setPrayer(sdk, 'protect_from_magic', false);
        return;
    }
    if (!r.ok && !inArena(sdk.getState())) throw new Error(`kolodion: no arena teleport (${r.reason ?? 'unknown'}) at ${JSON.stringify(pos(sdk))}`);
}

async function fightSegment(sdk: Sdk, opts: Options | undefined, memo: RunMemo): Promise<void> {
    if (memo.fought && !inArena(sdk.getState())) return;
    const tally = opts?.tally ?? newTally(opts?.spell ?? DEFAULT_SPELL);
    await fightKolodion(sdk, {
        ...(opts?.spell ? { spell: opts.spell } : {}),
        ignore: memo.leftovers,
        ...(opts?.drinkBelow !== undefined ? { drinkBelow: opts.drinkBelow } : {}),
        ...(opts?.eatBelow !== undefined ? { eatBelow: opts.eatBelow } : {}),
        ...(opts?.fightMaxTicks !== undefined ? { maxTicks: opts.fightMaxTicks } : {}),
        tally,
        onTick: (_, npc) => {
            if (npc) memo.form = npc.id;
        },
    });
    memo.fought = true;
    // finish_mage_arena: the landing, then Kolodion's congratulations (5 pages, mage_arena.rs2:154-156).
    if (prayerActive(sdk.getState()!, 'protect_from_magic')) await setPrayer(sdk, 'protect_from_magic', false);
    await converse(sdk, [], { openTicks: 8, idle: 2, interrupts: [levelUpInterrupt()] });
    closeTally(tally, sdk.getState()!);
}

async function poolSegment(sdk: Sdk, opts: Options | undefined): Promise<void> {
    const t0 = currentTick(sdk);
    const pool = await findLoc(sdk, { name: POOL, radius: 20 });
    if (!pool) throw new Error(`pool: no sparkling pool in view at ${JSON.stringify(pos(sdk))}`);
    // mage_arena.rs2:47-50: a mesbox before the jump once %magearena >= 6; below 6 only wet boots.
    const r = await opLoc(sdk, pool, /^step-into$/i, s => s.dialog.isOpen || messagesSince(s, t0, /boots get wet/i).length > 0, { maxTicks: 60 });
    if (messagesSince(sdk, t0, /boots get wet/i).length) throw new Error('pool: "Your boots get wet": %magearena is below 6, the fight is not won');
    if (!r.ok) throw new Error(`pool: no mesbox (${r.reason ?? 'timeout'})`);
    const d = await converse(sdk, [], { ...talkShape(opts, 'state'), until: inChamber, maxTicks: 80 });
    if (!inChamber(sdk.getState())) throw new Error(`pool: not in the chamber (${d.reason ?? 'unknown'}) at ${JSON.stringify(pos(sdk))}`);
}

async function statueSegment(sdk: Sdk, opts: Options | undefined): Promise<void> {
    const god = opts?.god ?? DEFAULT_GOD;
    if (!held(sdk.getState()!, GOD_CAPE)) {
        const st = STATUES[god];
        const statue = await findLoc(sdk, { x: st.x, z: st.z, radius: 40 });
        if (!statue) throw new Error(`statue: no loc at ${st.x},${st.z}`);
        const t0 = currentTick(sdk);
        const r = await opLoc(sdk, statue, statue.options[0]!, s => s.dialog.isOpen, { maxTicks: 60 });
        if (!r.ok) throw new Error(`statue: no mesbox (${r.reason ?? 'timeout'})`);
        // idle 1: the cape drop follows at once
        await converse(sdk, [], { ...talkShape(opts, SHAPE_STATUE), idle: 1 });
        let cape = null;
        for (let i = 0; i < 40 && !cape; i++) {
            cape = (await sdk.scanGroundItems(15)).find(g => GOD_CAPE.test(g.name)) ?? null;
            if (!cape) await waitTicks(sdk, 1);
        }
        if (!cape) throw new Error(`statue: no cape on the ground (${messagesSince(sdk, t0).join(' | ')})`);
        const p = await pickup(sdk, GOD_CAPE, { maxTicks: 30 });
        if (!p.ok) throw new Error('statue: the cape was not picked up');
    }
}

/** Within talking range: the talk click is sent from here, so a dropped one is re-sent after a few ticks, not after a walk's worth. */
const GUARDIAN_NEAR = 4;

async function guardianSegment(sdk: Sdk, opts: Options | undefined, memo: RunMemo): Promise<void> {
    // Only this attempt's evidence counts: the staff in hand, or dropped beside SCORED by an earlier attempt's exit.
    memo.chargeUnlocked = staffSeen(sdk.getState()!);
    if (!memo.chargeUnlocked) {
        let guard = findNpc(sdk, GUARDIAN);
        if (!guard || guard.distance > GUARDIAN_NEAR) {
            const r = await runTo(sdk, GUARDIAN_STAND);
            if (!r.ok) throw new Error(`guardian: could not reach him (${r.reason ?? 'unknown'})`);
            guard = findNpc(sdk, GUARDIAN);
        }
        if (!guard) throw new Error('guardian: not in view');
        let again = false;
        const unsub = sdk.onStateUpdate(s => {
            if (HELLO_AGAIN.test(pageText(s.dialog))) again = true;
        });
        // 'No thanks.' answers only his stage-8 choice (a run resumed after the drop); the first visit has none.
        const d = await talkTo(sdk, guard, ['No thanks.'], { ...talkShape(opts, SHAPE_GUARDIAN), openTicks: 12 }).finally(unsub);
        if (!d.opened) throw new Error('guardian: no dialogue');
        if (again) memo.chargeUnlocked = true;
        else {
            // inv_add before the objbox: the staff is in the pack (or on the floor with a full pack) by now
            await waitUntil(sdk, s => held(s, GOD_STAFF), { maxTicks: 5 });
            if (!held(sdk.getState()!, GOD_STAFF)) {
                const p = await pickup(sdk, GOD_STAFF, { maxTicks: 20 });
                if (!p.ok) throw new Error('guardian: no god staff held (a full pack drops it on the floor)');
            }
            memo.chargeUnlocked = true;
        }
    }
    await exitDrop(sdk, opts?.keepSharks ?? KEEP_SHARKS);
}

/** Drop exitDropItems in one tick (a drop is a 0-tick op standing still), then check none is left. */
async function exitDrop(sdk: Sdk, keepSharks: number): Promise<void> {
    for (let i = 0; i < 3; i++) {
        const pick = new Set<object>(exitDropItems(sdk.getState()!, keepSharks));
        if (!pick.size) break;
        await dropItems(sdk, it => pick.has(it));
    }
    const left = exitClean(keepSharks)(sdk.getState()!, undefined);
    if (left !== true) throw new Error(`exit: ${left}`);
}

const slots = (at: (typeof LETTERS)[number]) => slotsCover(QUEST_ITEMS, LETTERS, at);
const stateOf = (o: Observed) => o.state;

/** Untradeable and dead once S15 is over: dropped at A's end, before Kolodion's check. */
async function dropGreegree(sdk: Sdk): Promise<void> {
    if (!invItem(sdk.getState(), GREEGREE)) return;
    const r = await dropItems(sdk, i => GREEGREE.test(i.name));
    if (!r.ok) throw new Error('kit: the monkey greegree was not dropped');
}

/** A with H13 handed at the Ardougne landing: the kit topped up from `kitFrom` if short, the gree-gree dropped. */
function ardougneKit(opts: Options | undefined, spell: KolodionSpell): Segment {
    const kitA = kitSegment(opts, kit(spell, opts?.spellRunes), {
        letter: 'A', label: 'kit',
        preconditions: allOf(inCellarCheck, kolodionLevel, fireStaffWorn, protectLevel, entryClean, slots('A')),
    });
    return {
        ...kitA,
        async run(ctx) {
            await kitA.run(ctx);
            await dropGreegree(ctx.sdk);
        },
        postconditions: allOf(kitA.postconditions, fightReady(spell, opts?.spellRunes)),
    };
}

/**
 * A with H13 handed here: the one swap with `kitFrom` (cellarPlan: the row plus whatever Kolodion
 * bars), the staff wielded, the gree-gree dropped. SCORED arrives with the bow, the arrows and the
 * Khazard armour and without the staff, so the entry check and the staff are postconditions.
 */
function cellarKit(opts: Options | undefined, spell: KolodionSpell): Segment {
    const row = opts?.h13Plan ?? loadHandOff(H13_ROW);
    return {
        letter: 'A', label: 'kit', logoutSafe: true,
        // No knife check: a knife held is T15-16's need (the Deserted Keep's webs, cut before the
        // cellar), not S16's. Kolodion lets one in, so the row may still hand it over here.
        preconditions: allOf(inCellarCheck, kolodionLevel, protectLevel, cellarReady(row, opts?.kitFrom, kit(spell, opts?.spellRunes))),
        async run(ctx) {
            await cellarSwap(ctx.sdk, row, opts?.kitFrom, opts?.onH13);
            await dropGreegree(ctx.sdk);
        },
        postconditions: allOf(fireStaffWorn, entryClean, h13Done(row), fightReady(spell, opts?.spellRunes), slots('A')),
    };
}

export function steps(opts?: Options) {
    const spell = opts?.spell ?? DEFAULT_SPELL;
    const keepSharks = opts?.keepSharks ?? KEEP_SHARKS;
    const memo: RunMemo = { fought: opts?.fought ?? false, chargeUnlocked: false, leftovers: [], form: null, seenPlayers: new Set() };
    const segs: Segment[] = [
        (opts?.h13At ?? DEFAULT_H13_AT) === 'cellar' ? cellarKit(opts, spell) : ardougneKit(opts, spell),
        {
            letter: 'B', label: 'kolodion', logoutSafe: false,
            preconditions: allOf(inCellarCheck, fightReady(spell, opts?.spellRunes)),
            async run(ctx) {
                memo.form = null;
                const unwatch = watchArena(ctx, memo);
                try {
                    await talkKolodion(ctx.sdk, opts, memo);
                } finally {
                    unwatch();
                }
            },
            postconditions: s => (inArena(s) || memo.fought ? true : `not in the arena after Kolodion's talk: at ${JSON.stringify(pos(s))}`),
        },
        {
            letter: 'C', label: 'fight', logoutSafe: false,
            preconditions: s => (inArena(s) || memo.fought ? true : 'not in the arena'),
            async run(ctx) {
                const unwatch = watchArena(ctx, memo);
                try {
                    await fightSegment(ctx.sdk, opts, memo);
                } finally {
                    unwatch();
                }
            },
            postconditions: allOf(inCellarCheck, noDialog),
            // A relog in the arena (16 ticks out of combat) lands back in it: the fight goes on.
            inProgress: o => inArena(stateOf(o)),
        },
        {
            letter: 'D', label: 'pool', logoutSafe: true,
            preconditions: allOf(inCellarCheck, () => (memo.fought ? true : 'the fight is not known to be won (%magearena 6 is not transmitted): B asks Kolodion')),
            run: ctx => poolSegment(ctx.sdk, opts),
            postconditions: inChamberCheck,
            done: o => inChamber(stateOf(o)) || held(stateOf(o), GOD_CAPE) || held(stateOf(o), GOD_STAFF) || exitedChamber(stateOf(o)),
        },
        {
            letter: 'E', label: 'statue', logoutSafe: true,
            preconditions: allOf(inChamberCheck, slots('E')),
            run: ctx => statueSegment(ctx.sdk, opts),
            postconditions: capeHeld,
            done: o => held(stateOf(o), GOD_CAPE) || held(stateOf(o), GOD_STAFF) || exitedChamber(stateOf(o)),
        },
        {
            letter: 'F', label: 'guardian', logoutSafe: true,
            preconditions: allOf(inChamberCheck, capeHeld, slots('F')),
            run: ctx => guardianSegment(ctx.sdk, opts, memo),
            // Charge unlocked (%magearena 8, charge.rs2:4): the staff in hand (or the guardian's stage-8 greeting) is
            // its only evidence, seen before the exit drops put the staff and cape on the floor.
            postconditions: allOf(chargeSeen(memo), exitClean(keepSharks), inChamberCheck, noDialog),
            done: o => exitedChamber(stateOf(o)),
        },
    ];
    return questSteps(stepId, segs);
}

/** The exit's Magic: base level and xp, for the run's record (S18 wants boosted 80; a sip covers 79). */
export function exitMagic(s: BotWorldState): { base: number; boosted: number; xp: number; chargeReady: boolean; sipNeeded: boolean } {
    const base = baseOf(s, 'magic');
    const boosted = boostedOf(s, 'magic');
    return { base, boosted, xp: skillXp(s, 'magic'), chargeReady: boosted >= 80, sipNeeded: boosted < 80 && base + MAGIC_POTION_BOOST >= 80 };
}
