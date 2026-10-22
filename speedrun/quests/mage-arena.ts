// The Mage Arena (S16, STEP-MANIFEST.md entry 19): Kolodion's five forms under Protect from Magic,
// which unlocks Charge for S18.
//
// From the arrival tile in Kolodion's cellar (2543,4713; legs.ts T15-16 brings SCORED down the mage
// bank ladder) to the god staff in hand in the chamber below, outside the Wilderness. Six
// segments, as docs/speedrun/quests/mage_arena.md's step list and quest-magearena-run.ts:
//   A kit          H13 held (or received from `kitFrom`), the entry check, the gree-gree dropped
//   B kolodion     the talk and the arena teleport (logout-unsafe from here)
//   C fight        the five forms; finish_mage_arena teleports back to the cellar
//   D pool         the sparkling pool to the chamber
//   E statue       a god's statue, and the cape it drops
//   F guardian     the chamber guardian's staff: %magearena 8, Charge unlocked
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
import { dropItems, opLoc, pickup, talkTo } from '../lib/act';
import { fight, prayerActive, prayerDoses, setPrayer } from '../lib/combat';
import { converse, levelUpInterrupt } from '../lib/converse';
import { pageText } from '../lib/dialogue';
import type { ItemPattern } from '../lib/items';
import { runTo } from '../lib/travel';
import { currentTick, waitTicks, waitUntil } from '../lib/wait';
import { findLoc, findNpc, invCount, invItem, messagesSince, npcByIndex, opIndex, pos, skillLevel, skillXp, worn } from '../lib/world';
import type { Check, Observed } from '../runner/step';
import { allOf, inBox, kitSegment, questSteps, slotsCover, talkShape, within, type Box, type KitItem, type QuestItem, type QuestOptions, type Segment } from './segments';

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
    fire_blast: { component: 1181, level: 59, rune: /^death rune$/i, runeName: 'Death rune', air: 5 },
};

/**
 * H13's runes for the fight by spell (SUPPLIES.md H13: 70 blood + 400 air for Fire Wave). Fire
 * Blast's death runes are the lab's maximum casts plus margin (rs/371's pricing; the H13 kit for
 * that column is 'death x N + margin').
 */
export const SPELL_RUNES: Readonly<Record<KolodionSpell, number>> = { fire_wave: 70, fire_blast: 100 };
export const AIR_RUNES = 400;

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

/** S16's share of H13: the fight's runes. The staff of fire is worn (a precondition); the prayer potions are counted as prayer budget. */
export function kit(spell: KolodionSpell): KitItem[] {
    return [
        { item: SPELLS[spell].rune, n: SPELL_RUNES[spell] },
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

/** The entry check as the server runs it: every barred item carried or worn, or null when Kolodion would let SCORED in. */
export function entryRefusal(s: BotWorldState): string | null {
    const bad = [
        ...s.equipment.map(i => [i, barredReason(i, 'worn'), 'worn'] as const),
        ...s.inventory.map(i => [i, barredReason(i, 'carried'), 'carried'] as const),
    ].filter(([, why]) => why !== null);
    return bad.length ? `Kolodion's entry check (mage_arena.rs2:100-138) refuses: ${bad.map(([i, why, where]) => `${i.name} ${where} (${why})`).join(', ')}` : null;
}

// ------------------------------------------------------------------ options

export interface Options extends QuestOptions {
    /** The fight's spell. Default 'fire_wave' (H13's blood runes); 'fire_blast' spends death runes instead and frees the 70 blood for S18. */
    spell?: KolodionSpell;
    /** Which statue (default saradomin). Charge does not care; the god only picks the god spell. */
    god?: God;
    /** Drink a prayer potion below this many points in the fight (default 15). */
    drinkBelow?: number;
    /** Eat a shark below this HP in the fight (default 30; under the prayer nothing should hit). */
    eatBelow?: number;
    /** Fight's tick bound (default 1500). */
    fightMaxTicks?: number;
    /** Counters the fight fills in (casts, runes, xp, prayer), for the lab's report. */
    tally?: FightTally;
    /**
     * The fight is known to be won (%magearena >= 6) though the account is in the cellar: lets
     * segment D start without B having seen it (the lab's D fixture). In the run, B or C sets it.
     */
    fought?: boolean;
}

export const DEFAULT_SPELL: KolodionSpell = 'fire_wave';
export const DEFAULT_GOD: God = 'saradomin';

/** What one fight did, for the lab and the run's record. */
export interface FightTally {
    spell: KolodionSpell;
    /** Arena landing to the cellar landing. */
    ticks: number;
    /** Casts that landed, counted by the spell's rune spent. */
    casts: number;
    /** Cast clicks sent (every 2 ticks while a form is up). */
    clicks: number;
    runesUsed: number;
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
        spell, ticks: 0, casts: 0, clicks: 0, runesUsed: 0, airUsed: 0, magicXp0: 0, magicXp1: 0, magicBase0: 0, magicBase1: 0,
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
const kitHeld = (spell: KolodionSpell): Check<any> => s => {
    const short = kit(spell).filter(k => invCount(s, k.item) < (k.n ?? 1));
    return short.length ? `kit: ${short.map(k => `${String(k.item)} ${invCount(s, k.item)}/${k.n}`).join(', ')}` : true;
};
const inCellarCheck = within(CELLAR, "Kolodion's cellar");
const inChamberCheck = within(CHAMBER, 'the chamber');
const capeHeld: Check<any> = s => (held(s, GOD_CAPE) ? true : 'no god cape held or worn');
const staffHeld: Check<any> = s => (held(s, GOD_STAFF) ? true : 'no god staff held or worn (Charge is %magearena 8: the staff given)');
const noDialog: Check<any> = s => (s.dialog.isOpen || s.modalOpen ? 'a dialogue or modal is still open' : true);

/** The fight's start: everything B needs besides the place. */
export function fightReady(spell: KolodionSpell): Check<any> {
    return allOf(entryClean, noGreegree, kitHeld(spell), fireStaffWorn, spellReady(spell), protectLevel, prayerEnough);
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

export interface FightOpts {
    spell?: KolodionSpell;
    drinkBelow?: number;
    eatBelow?: number;
    maxTicks?: number;
    tally?: FightTally;
    /** Per-tick hook for the lab's trace. */
    onTick?: (s: BotWorldState, target: NearbyNpc | null) => void;
}

/**
 * Fight Kolodion from the arena landing until finish_mage_arena puts SCORED back in the cellar,
 * under Protect from Magic. Only the current stage's form is attacked: the stage starts at the
 * lowest form in view (a resumed fight finds its own) and moves on when the next id appears. A
 * level-up page is dismissed with the cast re-sent behind it (lib/combat.ts); the magic potion is
 * sipped again whenever the boosted level falls below the spell's. Throws on a death, a timeout,
 * or the spell's runes running out.
 */
export async function fightKolodion(sdk: Sdk, o: FightOpts = {}): Promise<FightTally> {
    const spell = o.spell ?? DEFAULT_SPELL;
    const sp = SPELLS[spell];
    const t = o.tally ?? newTally(spell);
    t.spell = spell;
    const s0 = sdk.getState()!;
    const tArena = s0.tick;
    const maxTicks = o.maxTicks ?? 1500;
    const runes0 = invCount(s0, sp.rune);
    const air0 = invCount(s0, /^air rune$/i);
    const doses0 = prayerDoses(s0);
    t.magicXp0 = skillXp(s0, 'magic');
    t.magicBase0 = baseOf(s0, 'magic');
    t.hp0 = s0.player?.hp ?? 0;
    t.hpMin = t.hp0;
    t.prayer0 = s0.prayers?.prayerPoints ?? 0;
    let stage = -1;
    let lastSip = -Infinity;
    const current = (s: BotWorldState): NearbyNpc | undefined => {
        const fs = forms(s);
        if (!fs.length) return undefined;
        if (stage < 0) stage = Math.min(...fs.map(n => n.id)) - FORM_IDS[0];
        if (!fs.some(n => n.id === FORM_IDS[0] + stage) && fs.some(n => n.id === FORM_IDS[0] + stage + 1)) stage++;
        return fs.find(n => n.id === FORM_IDS[0] + stage);
    };
    const lost = (s: BotWorldState) => !inArena(s) && !inCellar(s);
    for (;;) {
        const s = sdk.getState()!;
        if (inCellar(s)) break;
        const elapsed = s.tick - tArena;
        if (elapsed > maxTicks) throw new Error(`fight: no finish in ${maxTicks} ticks at ${JSON.stringify(pos(s))}, stage ${stage}`);
        const w = await waitUntil(sdk, st => inCellar(st) || lost(st) || current(st) !== undefined, { maxTicks: maxTicks - elapsed });
        if (!w.ok) throw new Error(`fight: no form to attack at +${currentTick(sdk) - tArena} (stage ${stage}; in view ${JSON.stringify(forms(sdk.getState()!).map(n => [n.id, n.hp]))})`);
        if (inCellar(w.state)) break;
        if (lost(w.state)) throw new Error(`fight: left the arena at +${w.state.tick - tArena} (${JSON.stringify(pos(w.state))}): a death?`);
        const target = current(w.state)!;
        const tForm = w.state.tick;
        if (invCount(w.state, sp.rune) < 1) throw new Error(`fight: out of ${sp.runeName}s at form ${target.id} (+${tForm - tArena})`);
        const f = await fight(sdk, target, {
            spell: sp.component, castEvery: 2,
            prayer: 'protect_from_magic', drinkBelow: o.drinkBelow ?? 15,
            food: SHARK, eatBelow: o.eatBelow ?? 30,
            onDialog: 'continue',
            maxTicks: maxTicks - (tForm - tArena),
            // over when the form changes type in place: the next form is fought by its own id
            done: st => inCellar(st) || lost(st) || (npcByIndex(st, target.index)?.id ?? target.id) !== target.id,
            onTick: (st, npc) => {
                o.onTick?.(st, npc);
                if (boostedOf(st, 'magic') < sp.level && st.tick - lastSip >= 3 && sipMagic(sdk, st)) {
                    lastSip = st.tick;
                    t.magicSips++;
                    return true; // an inventory click clears the cast: re-send it
                }
                if (invCount(st, sp.rune) < 1) throw new Error(`fight: out of ${sp.runeName}s at form ${target.id} (+${st.tick - tArena})`);
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
    t.runesUsed = runes0 - invCount(s1, sp.rune);
    t.casts = t.runesUsed;
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

/** Shared by the segments of one `steps()` call: what the run has seen that the client cannot show. */
interface RunMemo {
    fought: boolean;
}

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
    // converse reads `until` only while the dialogue is closed: the pages are watched here.
    const unsub = sdk.onStateUpdate(s => {
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
        ...(opts?.drinkBelow !== undefined ? { drinkBelow: opts.drinkBelow } : {}),
        ...(opts?.eatBelow !== undefined ? { eatBelow: opts.eatBelow } : {}),
        ...(opts?.fightMaxTicks !== undefined ? { maxTicks: opts.fightMaxTicks } : {}),
        tally,
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

async function guardianSegment(sdk: Sdk, opts: Options | undefined): Promise<void> {
    if (held(sdk.getState()!, GOD_STAFF)) return;
    let guard = findNpc(sdk, GUARDIAN);
    if (!guard) {
        const r = await runTo(sdk, GUARDIAN_STAND);
        if (!r.ok) throw new Error(`guardian: could not reach him (${r.reason ?? 'unknown'})`);
        guard = findNpc(sdk, GUARDIAN);
    }
    if (!guard) throw new Error('guardian: not in view');
    const d = await talkTo(sdk, guard, [], { ...talkShape(opts, SHAPE_GUARDIAN), openTicks: 60 });
    if (!d.opened) throw new Error('guardian: no dialogue');
    // inv_add before the objbox: the staff is in the pack (or on the floor with a full pack) by now
    await waitUntil(sdk, s => held(s, GOD_STAFF), { maxTicks: 5 });
    if (!held(sdk.getState()!, GOD_STAFF)) {
        const p = await pickup(sdk, GOD_STAFF, { maxTicks: 20 });
        if (!p.ok) throw new Error('guardian: no god staff held (a full pack drops it on the floor)');
    }
}

const slots = (at: (typeof LETTERS)[number]) => slotsCover(QUEST_ITEMS, LETTERS, at);
const stateOf = (o: Observed) => o.state;

export function steps(opts?: Options) {
    const spell = opts?.spell ?? DEFAULT_SPELL;
    const memo: RunMemo = { fought: opts?.fought ?? false };
    const kitA = kitSegment(opts, kit(spell), {
        letter: 'A', label: 'kit',
        preconditions: allOf(inCellarCheck, kolodionLevel, fireStaffWorn, protectLevel, entryClean, slots('A')),
    });
    const segs: Segment[] = [
        {
            ...kitA,
            async run(ctx) {
                await kitA.run(ctx);
                if (invItem(ctx.sdk.getState(), GREEGREE)) {
                    const r = await dropItems(ctx.sdk, i => GREEGREE.test(i.name));
                    if (!r.ok) throw new Error('kit: the monkey greegree was not dropped');
                }
            },
            postconditions: allOf(kitA.postconditions, fightReady(spell)),
        },
        {
            letter: 'B', label: 'kolodion', logoutSafe: false,
            preconditions: allOf(inCellarCheck, fightReady(spell)),
            run: ctx => talkKolodion(ctx.sdk, opts, memo),
            postconditions: s => (inArena(s) || memo.fought ? true : `not in the arena after Kolodion's talk: at ${JSON.stringify(pos(s))}`),
        },
        {
            letter: 'C', label: 'fight', logoutSafe: false,
            preconditions: s => (inArena(s) || memo.fought ? true : 'not in the arena'),
            run: ctx => fightSegment(ctx.sdk, opts, memo),
            postconditions: allOf(inCellarCheck, noDialog),
            // A relog in the arena (16 ticks out of combat) lands back in it: the fight goes on.
            inProgress: o => inArena(stateOf(o)),
        },
        {
            letter: 'D', label: 'pool', logoutSafe: true,
            preconditions: allOf(inCellarCheck, () => (memo.fought ? true : 'the fight is not known to be won (%magearena 6 is not transmitted): B asks Kolodion')),
            run: ctx => poolSegment(ctx.sdk, opts),
            postconditions: inChamberCheck,
            done: o => inChamber(stateOf(o)) || held(stateOf(o), GOD_CAPE) || held(stateOf(o), GOD_STAFF),
        },
        {
            letter: 'E', label: 'statue', logoutSafe: true,
            preconditions: allOf(inChamberCheck, slots('E')),
            run: ctx => statueSegment(ctx.sdk, opts),
            postconditions: capeHeld,
            done: o => held(stateOf(o), GOD_CAPE) || held(stateOf(o), GOD_STAFF),
        },
        {
            letter: 'F', label: 'guardian', logoutSafe: true,
            preconditions: allOf(inChamberCheck, capeHeld, slots('F')),
            run: ctx => guardianSegment(ctx.sdk, opts),
            // Charge unlocked (%magearena 8, charge.rs2:4): the staff is its only evidence. T16-18 drops staff and cape.
            postconditions: allOf(staffHeld, capeHeld, inChamberCheck, noDialog),
            done: o => held(stateOf(o), GOD_STAFF),
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
