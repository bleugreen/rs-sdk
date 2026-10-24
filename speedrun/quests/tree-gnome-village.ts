// Tree Gnome Village: STEP-MANIFEST.md entry 14 (S10b), the gate to Monkey Madness and the spirit trees.
//
// From Elkoy at the maze entrance (2504,3191), where leg T09-10 leaves SCORED, to the quest
// complete beside King Bolren and the village spirit tree, where T10-11 takes the tree. The route
// is docs/speedrun/scripts/quest-tree-full.ts with the warlord by Fire Blast under Protect from
// Melee (rs/56) at SCORED's arrival levels (Attack, Strength and Defence 1, 10 Hitpoints).
//
// What the content does that the module is built around (server/content/scripts):
// - Elkoy only guides once Bolren has spoken (elkoy.rs2), so the first way in is the 201-tile maze
//   walk and the loose railing (gnomevillage_fence.rs2); every later way in is Elkoy's jump to
//   (2515,3159), beside the railing. Bolren's start and orb conversations end with Elkoy jumping
//   SCORED back out to (2504,3191) (king_bolren.rs2 @elkoy_leavemaze_*): those pages are `state`
//   pages in the shapes, never burst across.
// - The ballista's coordinates are fixed at 0004 / 0003 / 0005 (quest_tree.rs2 oploc2,catabow).
// - Two Khazard commanders guard the stronghold: one speaks and attacks after the crumbled-wall
//   climb if within 4 tiles, the other when the orb chest opens if within 5 (quest_tree.rs2). At
//   10 HP and Defence 1 that is near-certain death unprotected, so Protect from Melee is on from
//   the crumbled wall to the foot of the ladder down (main, 20:52 PDT). Every toggle is sent
//   standing still: a prayer click clears a pending action, so one sent mid-walk cancels the walk.
// - The warlord's death hands over the orbs (khazard_warlord.rs2 @defeat_warlord) and he fights
//   plain melee, so Protect from Melee blocks all of it.
// - Bolren's ceremony takes the orbs, queues the completion (king_bolren.rs2 queue
//   tree_quest_complete) and chants for ~17 ticks with the chat closed. A logout between the orbs
//   leaving and the queue firing loses both: stage 8 with no orbs, recovered only by killing the
//   warlord again. That stretch is segment M (logoutSafe: false); N waits out the chant to the
//   quest scroll.
// - The maze's giants and wolf hunt SCORED's combat 43 (all.hunt [cowardly]), so Protect from
//   Melee is on through the maze walk too (segment B), and on the way to the warlord through the
//   wolves (segment K).
//
// Slot ledger (rs/158, 00:58 PDT): the staff of water leaves the pack at A, once the staff of fire
// is wielded (nothing after S10b casts with it: S11b brings water runes in H8), and the gnome
// amulet at N as soon as it arrives. Neither has a later use, and dropping both keeps S11b's
// segment L its free slots.
//
// Stage observation: the quest tab shows only started / complete; every %treequest stage has a
// journal marker (quest-stages.ts), so `done` reads the `journal:tree` probe. Preconditions judge
// the rest from coordinates and items (rs/185 addendum 4).

import type { BotWorldState, PrayerName } from '../../sdk/types';
import { act, actConverse, dropItems, openDoor, talkTo, type ActSdk } from '../lib/act';
import { COMBAT_SPELLS, combatSpellUse, fight, prayerActive, setPrayer, type CombatSpell, type FightResult } from '../lib/combat';
import { converse, levelUpInterrupt, type ConverseResult, type ConverseSdk } from '../lib/converse';
import { pageText, type OptionPattern } from '../lib/dialogue';
import { matchesItem, type ItemPattern } from '../lib/items';
import { journalProbeName, questPoints, questStatus, requireQuestStage, type QuestView } from '../lib/quests';
import { logNote } from '../lib/ticks';
import { inArea, runTo, type Area, type RuneUseTable, type TravelSdk } from '../lib/travel';
import { receiveFrom, type WantSpec } from '../lib/trade';
import { currentTick, waitUntil, type Pred } from '../lib/wait';
import { chebyshev, configId, findLoc, invCount, opIndex, pos, skillXp, worn, type LocQuery } from '../lib/world';
import type { StageName } from '../data/quest-stages';
import type { Check, Observed, StepContext } from '../runner/step';
import { allOf, baseLevels, drinkPrayerTo, prayerCovers, questSteps, slotsCover, stageAtLeast, talkShape, type QuestItem, type QuestOptions, type Segment } from './segments';

/**
 * Prayer points B needs for the three protect stretches, the maze (B), the stronghold (H) and the
 * warlord (K), counting held doses: ~20 + ~6 + ~43 measured (rs/342's lab, 94 to 74 to 68 to ~25),
 * with margin (rs/687's budget). S10b carries no potion, so the pool is what S07's bones left (99).
 */
export const PRAYER_B_TO_K = 75;
/** K's walk and fight: ~43 measured (rs/342); attempt 3's live fight alone used 21 (m) of a 192-tick K. */
export const PRAYER_K = 45;

export const quest = 'tree' as const;
export const stepId = 'S10b';

export interface Options extends QuestOptions {
    // dialogue: default DEFAULT_DIALOGUE (burst). kitFrom: the H7 giver at Elkoy; absent, or the kit
    // already held, means segment A only checks it.
    /** The warlord's spell (default 'fire_blast', Magic 59; 'fire_bolt' is the fallback, 165 m against 133). */
    warlordSpell?: CombatSpell;
    /** Observation only: each conversation's result (the lab prints its shape match). */
    onTalk?: (who: string, r: ConverseResult) => void;
}

export function resolveOptions(o: Options = {}): { warlordSpell: CombatSpell } & Options {
    return { ...o, warlordSpell: o.warlordSpell ?? 'fire_blast' };
}

// ------------------------------------------------------------------ places

/** Where T09-10 leaves SCORED: one south of ^elkoy_entrance_coord (quest_tree.constant), where Bolren's dialogues also drop it. */
export const ARRIVAL = { x: 2504, z: 3191 } as const;
/** Elkoy's jump into the maze, beside the loose railing (^elkoy_maze_coord). */
export const JUMP_IN = { x: 2515, z: 3159 } as const;
/** The maze-side tile of the loose railing; squeezing through moves SCORED one tile north. */
export const RAIL_OUT = { x: 2515, z: 3160 } as const;
export const BOLREN = { x: 2541, z: 3171 } as const;
export const VILLAGE_TREE = { x: 2543, z: 3168 } as const;
export const MONTAI = { x: 2523, z: 3212 } as const;
/** The crumbled wall's south tile, where its climb starts (quest_tree.rs2: loc_coord z - 1). */
export const WALL_FOOT = { x: 2509, z: 3252 } as const;
export const STRONGHOLD_DOOR = { x: 2505, z: 3256 } as const;
export const LADDER = { x: 2503, z: 3252 } as const;
/** Beside the warlord's post (quest-gnome-fights.ts spawned him here). */
export const WARLORD = { x: 2456, z: 3300 } as const;

/**
 * Inside the village fence (coordinates only). The maze wraps the village on every side, so this
 * is the fence's own outline: gnomefence and the loose railing in maps/m39_49.jm2, a west part
 * south to the railing (z 3161), the main yard south to z 3158, and the annex round the spirit tree.
 */
export const VILLAGE: readonly { x0: number; x1: number; z0: number; z1: number }[] = [
    { x0: 2514, x1: 2521, z0: 3161, z1: 3175 },
    { x0: 2522, x1: 2542, z0: 3158, z1: 3175 },
    { x0: 2543, x1: 2547, z0: 3167, z1: 3172 },
];
export function inVillage(s: BotWorldState): boolean {
    const p = pos(s);
    return p.level === 0 && VILLAGE.some(r => p.x >= r.x0 && p.x <= r.x1 && p.z >= r.z0 && p.z <= r.z1);
}
/** On the maze side of the loose railing, where Elkoy's jump lands. */
export function atRailOut(s: BotWorldState): boolean {
    const p = pos(s);
    return p.level === 0 && p.z <= RAIL_OUT.z && chebyshev(p, RAIL_OUT) <= 2;
}
/** The Khazard stronghold north of the crumbled wall, either floor. */
export function inStronghold(s: BotWorldState): boolean {
    const p = pos(s);
    return p.x >= 2495 && p.x <= 2520 && p.z >= 3254 && p.z <= 3270;
}
const nearArrival = (s: BotWorldState) => pos(s).level === 0 && chebyshev(pos(s), ARRIVAL) <= 2;

// ------------------------------------------------------------------ items

export const ITEM = {
    logs: /^Logs$/i,
    staffOfFire: /^Staff of fire$/i,
    staffOfWater: /^Staff of water$/i,
    amuletOfMagic: /^Amulet of magic$/i,
    antipoison: /^Antipoison\(\d\)$/i,
    shark: /^Shark$/i,
    death: /^Death rune$/i,
    chaos: /^Chaos rune$/i,
    air: /^Air rune$/i,
    // Both are named "Orb of protection" (quest_tree.obj): only the object id tells the chest's
    // single orb from the warlord's pair.
    orb: configId('obj', 'orb_of_protection'),
    orbs: configId('obj', 'orbs_of_protection'),
    gnomeAmulet: /^Gnome amulet$/i,
} as const;

/** One H7 line: at least `n` held (or worn, for `wear`). */
export interface KitLine {
    item: RegExp;
    /** For refusals and the ledger check. */
    name: string;
    /** What the giver offers, for receiveFrom (exact name). */
    give: RegExp;
    n: number;
    stackable?: boolean;
    /** Worn at the end of segment A. */
    wear?: boolean;
}

/**
 * H7, the pre-MM trade at Elkoy (SUPPLIES.md H7; STEP-MANIFEST.md's inventory ledger row H7):
 * 6 logs for Montai, the staff of fire and amulet of magic for the spell fights, an Antipoison(4)
 * for S14, 2 sharks, and Fire Blast and Fire Bolt runes. No prayer potions and no bones: S07 leaves
 * Prayer ~94. The unit tests hold this list to the inventory ledger's row H7 in STEP-MANIFEST.md
 * (rs/158's), so a change there fails here.
 */
export const H7: readonly KitLine[] = [
    { item: ITEM.logs, name: 'Logs', give: /^Logs$/i, n: 6 },
    { item: ITEM.staffOfFire, name: 'Staff of fire', give: /^Staff of fire$/i, n: 1, wear: true },
    { item: ITEM.amuletOfMagic, name: 'Amulet of magic', give: /^Amulet of magic$/i, n: 1, wear: true },
    // The ledger stages an Antipoison(3) (obj 3doseantipoison); SUPPLIES.md still says (4): either serves S14.
    { item: ITEM.antipoison, name: 'Antipoison', give: /^Antipoison\(\d\)$/i, n: 1 },
    { item: ITEM.shark, name: 'Shark', give: /^Shark$/i, n: 2 },
    { item: ITEM.death, name: 'Death rune', give: /^Death rune$/i, n: 110, stackable: true },
    { item: ITEM.chaos, name: 'Chaos rune', give: /^Chaos rune$/i, n: 40, stackable: true },
    { item: ITEM.air, name: 'Air rune', give: /^Air rune$/i, n: 550, stackable: true },
];

const have = (s: BotWorldState, l: KitLine) => invCount(s, l.item) + (l.wear && worn(s, l.item) ? 1 : 0);

/** What the pack (and worn slots) still lack of H7, as receiveFrom wants it. */
export function h7Want(s: BotWorldState): WantSpec[] {
    return H7.map(l => ({ item: l.give, amount: l.n - have(s, l) })).filter(w => w.amount > 0);
}

/** The segment letters in order, for the free-slot need. */
export const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N'] as const;
type Letter = (typeof LETTERS)[number];

/**
 * What the step receives, for the free-slot checks (rs/185 addendum 8): H7 at A (the staff and
 * amulet only until they are worn; the staff of water they free is dropped at once), the logs
 * until Montai takes them at E, the orb from the stronghold chest (H) to Bolren (J), the orbs
 * from the warlord (K) to the ceremony (M), and the gnome amulet, dropped at N.
 */
export const QUEST_ITEMS: readonly QuestItem[] = [
    ...H7.map((l): QuestItem => ({
        item: l.item, name: l.name, n: l.stackable ? 1 : l.n, stackable: !!l.stackable, from: 'A',
        ...(l.wear ? { until: 'A' } : l.item === ITEM.logs ? { until: 'E' } : {}),
    })),
    { item: ITEM.orb, name: 'Orb of protection', from: 'H', until: 'J' },
    { item: ITEM.orbs, name: 'Orbs of protection', from: 'K', until: 'M' },
    { item: ITEM.gnomeAmulet, name: 'Gnome amulet', from: 'N', until: 'N' },
];
const slots = (at: Letter) => slotsCover(QUEST_ITEMS, LETTERS, at);

/** Casts the runes must cover: rs/56's 133-tick kill at the 5-tick cast delay is ~27; 165 by Fire Bolt ~33. */
export const WARLORD_CASTS = 35;
/** The warlord's Fire Blasts at their measured maximum: rs/342's lab kills at K took 20-26 casts (m, 300 ms, n = 7). */
export const WARLORD_MAX_CASTS = 26;

/** The worn staff whose element RUNE_USE leaves out (kitCheck wants it worn). */
export const RUNE_STAFF = 'staff of fire';

/** The step's runes on the route (lib/travel.ts RuneUseTable): the warlord's casts at K, at their measured maximum. */
export const RUNE_USE: RuneUseTable = { K: combatSpellUse(resolveOptions().warlordSpell, WARLORD_MAX_CASTS, RUNE_STAFF) };

/** What K's precondition wants held: WARLORD_CASTS casts' runes. */
export const RUNE_NEED: RuneUseTable = { K: combatSpellUse(resolveOptions().warlordSpell, WARLORD_CASTS, RUNE_STAFF) };
/** The reward, `stat_advance(attack, 114500)` (tenths) at the engine's 25x rate. */
export const REWARD_ATTACK_XP = 286_250;

// ------------------------------------------------------------------ conversation shapes (CONVENTIONS.md, read from the scripts)

// A page a conversation must be seen to show (its `expect`, the proof the stage moved) starts a
// continue run, so a blind burst never skips publishing it: the page before it is `state`.
export const SHAPES = {
    /** king_bolren.rs2 case not_started; the last page is Elkoy's, after his jump out. */
    bolrenStart: '5c, opt, 8c, opt, 3c, state, 1c',
    /** commander_montai.rs2, started; "as quick as you can" is the expect page. */
    montaiWood: '7c, opt, state, 1c',
    /** spoken_montai with 6 logs. */
    montaiLogs: '4c',
    /** given_logs_montai; "braver than most" is the expect page. */
    montaiCoords: '8c, opt, state, 3c',
    /** quest_tree.rs2 oploc2,catabow: a mesbox, three choices, the shot (if_close, p_delay), the hit. */
    ballista: '1c, opt, opt, opt, state, 1c',
    /** crumbled wall: one mesbox, then the climb's forced move. */
    wall: '1c',
    /** the open chest's search: one mesbox. */
    chest: '1c',
    /** elkoy.rs2 @elkoy_retrieved_orb_outside: the jump is after "follow me". */
    elkoyOrb: '4c, opt, 1c, state, 1c',
    /** king_bolren.rs2 retrieved_orb; Elkoy's "Good luck friend" after the jump. */
    bolrenOrb: '12c, opt, 2c, state, 1c',
    /** elkoy.rs2 @elkoy_hero_outside. */
    elkoyOrbs: '5c, opt, 1c, state, 1c',
    /** king_bolren.rs2 defeated_warlord: the orbs leave after the seventh page, then the chant's mesbox closes the chat. */
    bolrenOrbs: '6c, state, state',
    /** After the chant: the orbs rest, then Bolren's thanks and the amulet. */
    ceremony: '7c',
} as const;

// ------------------------------------------------------------------ evidence

const JOURNAL = journalProbeName(quest);
const PROBES = [JOURNAL] as const;
const stateOf = (o: QuestView): BotWorldState => ('probed' in o ? o.state : o);
const atLeast = (o: QuestView, stage: StageName<'tree'>) => requireQuestStage(o, quest, stage, { atLeast: true }) === true;
const complete = (s: BotWorldState) => questStatus(s, quest) === 'complete';
const started = (s: BotWorldState) => questStatus(s, quest) === 'started';
const holds = (s: BotWorldState, item: ItemPattern) => invCount(s, item) > 0;

const isStarted: Check<any> = s => (started(s) ? true : `Tree Gnome Village is ${questStatus(s, quest) ?? 'unobservable'}, not started`);
const notStarted: Check<any> = s => requireQuestStage(s, quest, 'not_started');
const check = (ok: boolean, why: string): true | string => (ok ? true : why);

function spellRunes(s: BotWorldState, spell: CombatSpell, casts: number): true | string {
    const sp = COMBAT_SPELLS[spell];
    if (invCount(s, sp.rune) < casts) return `holds ${invCount(s, sp.rune)} ${sp.runeName} runes, the warlord wants ${casts}`;
    if (invCount(s, ITEM.air) < sp.air * casts) return `holds ${invCount(s, ITEM.air)} air runes, the warlord wants ${sp.air * casts}`;
    return check(!!worn(s, ITEM.staffOfFire), 'the staff of fire is not worn (it supplies the fire runes)');
}

/** The entry's preconditions other than the kit (STEP-MANIFEST.md entry 14). */
export function entryCheck(opts: Options = {}): Check<any> {
    const spell = resolveOptions(opts).warlordSpell;
    return allOf(
        s => check(nearArrival(s), `not at Elkoy's maze entrance (${ARRIVAL.x},${ARRIVAL.z}): at ${pos(s).x},${pos(s).z},${pos(s).level}`),
        notStarted,
        stageAtLeast('elena', 'complete'),
        baseLevels({ magic: COMBAT_SPELLS[spell].magic, prayer: 43 }),
        slots('A'),
    );
}

/** H7 held, the staff of fire and amulet of magic worn, the staff of water gone. */
export function kitCheck(s: BotWorldState): true | string {
    for (const l of H7) {
        if (l.wear) {
            if (!worn(s, l.item)) return `${l.name} not worn`;
        } else if (have(s, l) < l.n) return `holds ${have(s, l)} of H7's ${l.n} ${l.name}`;
    }
    return check(!holds(s, ITEM.staffOfWater), 'the staff of water is still held (dropped at A, rs/158)');
}

/** S10b's exit state: complete, the reward, beside the village spirit tree, the gnome amulet gone. */
export function exitCheck(s: BotWorldState): true | string {
    if (!complete(s)) return `Tree Gnome Village is ${questStatus(s, quest)}, not complete`;
    if (skillXp(s, 'attack') < REWARD_ATTACK_XP) return `Attack xp ${skillXp(s, 'attack')}, below the reward's ${REWARD_ATTACK_XP}`;
    if ((questPoints(s) ?? 0) < 2) return `quest points ${questPoints(s)}`;
    if (holds(s, ITEM.gnomeAmulet)) return 'still holds the gnome amulet (dropped at N, rs/158)';
    if (holds(s, ITEM.orbs) || holds(s, ITEM.orb)) return 'still holds an orb';
    if (s.dialog.isOpen || s.modalOpen) return 'a dialogue or the quest scroll is still open';
    const p = pos(s);
    return check(p.level === 0 && chebyshev(p, VILLAGE_TREE) <= 8, `not beside the village spirit tree (at ${p.x},${p.z},${p.level})`);
}

// ------------------------------------------------------------------ moves

type Ctx = StepContext<any>;
type Sdk = TravelSdk & ActSdk & ConverseSdk & Parameters<typeof fight>[0];
const sdkOf = (ctx: Ctx) => ctx.sdk as unknown as Sdk;
const interrupts = () => [levelUpInterrupt()];
const note = (ctx: Ctx, seg: string, meta: Record<string, unknown>) => logNote(ctx.log, ctx.session, `${stepId}:${seg}`, meta);

/**
 * Eat a shark on the run at this HP or below. Montai's catapult (commander_montai.rs2 ai_timer)
 * lands within 5 tiles of (2524,3238) for random(4) typeless damage, which no prayer blocks, and
 * the battlefield routes cross it four times; the maze's giant hits for up to 3 too. At 10 HP a
 * hit of at most 3 after eating at 4 never kills.
 */
export const EAT_AT = 4;

/** Run to `to`, retrying a run that ends short; ok only inside the area. */
async function go(ctx: Ctx, to: Area, what: string): Promise<void> {
    const sdk = sdkOf(ctx);
    let why = '';
    for (let i = 0; i < 3; i++) {
        if (inArea(sdk, to)) return;
        const r = await runTo(sdk, to, { bot: ctx.bot, eat: { food: ITEM.shark, below: EAT_AT + 1 } });
        if (r.ok) return;
        why = r.reason ?? 'not arrived';
    }
    if (!inArea(sdk, to)) throw new Error(`${what}: run to ${to.x},${to.z} failed (${why}) at ${JSON.stringify(pos(sdk))}`);
}

/** setPrayer, sent standing still; a prayer that does not turn stops the step. The ticks to the state showing it. */
async function pray(ctx: Ctx, name: PrayerName, on: boolean): Promise<number> {
    const r = await setPrayer(sdkOf(ctx), name, on);
    if (!r.ok) throw new Error(`${name} did not turn ${on ? 'on' : 'off'}: ${r.reason}`);
    return r.ticks;
}

interface Talk {
    choices?: OptionPattern[];
    shape: string;
    /** Over once this also holds with the chat closed (a jump after the last page, an item taken). */
    until?: Pred;
    /** A page shown only once the stage moved: the conversation must show it. */
    expect?: RegExp;
    near?: { x: number; z: number };
}

/** Talk to an NPC and answer the conversation; it must open, end well, and show `expect`. */
async function talk(ctx: Ctx, opts: Options, npc: RegExp, t: Talk): Promise<ConverseResult> {
    const sdk = sdkOf(ctx);
    let seen = false;
    const stop = sdk.onStateUpdate(s => {
        if (t.expect?.test(pageText(s.dialog))) seen = true;
    });
    try {
        const until: Pred = s => (!t.expect || seen) && (!t.until || t.until(s));
        const r = await talkTo(sdk, npc, t.choices ?? [], {
            idle: 2, openTicks: 30, maxTicks: 400, unmatched: 'stop', closeModals: true, findTicks: 15, until, interrupts: interrupts(),
            ...(t.near ? { near: t.near } : {}), ...talkShape(opts, t.shape),
        });
        opts.onTalk?.(npc.source, r);
        if (!r.opened) throw new Error(`${npc.source}: no conversation opened after ${r.clicks} clicks`);
        if (!r.ok) throw new Error(`${npc.source}: ${r.reason} at ${JSON.stringify(pos(sdk))}; last pages: ${r.transcript.slice(-4).join(' | ')}`);
        if (t.expect && !seen) throw new Error(`${npc.source}: the conversation never showed /${t.expect.source}/`);
        return r;
    } finally {
        stop();
    }
}

/** A loc op that opens pages (a mesbox, the ballista's menus), finished once `done` holds and the chat has closed. */
async function locTalk(ctx: Ctx, opts: Options, what: string, q: LocQuery, op: RegExp, choices: OptionPattern[], shape: string, done: Pred, maxTicks = 60): Promise<ConverseResult | undefined> {
    const sdk = sdkOf(ctx);
    const l = await findLoc(sdk, { ...q, op });
    if (!l) throw new Error(`${what}: no loc ${JSON.stringify({ ...q, op: String(op) })} near ${JSON.stringify(pos(sdk))}`);
    const r = await actConverse(sdk, () => sdk.sendInteractLoc(l.x, l.z, l.id, opIndex(l, op)!), choices, {
        done, idle: 2, maxTicks, closeModals: true, unmatched: 'stop', interrupts: interrupts(), resendEvery: 5, ...talkShape(opts, shape),
    });
    if (r.dialogue) opts.onTalk?.(what, r.dialogue);
    if (!r.ok) throw new Error(`${what}: ${r.reason} at ${JSON.stringify(pos(sdk))}`);
    return r.dialogue;
}

/** A loc op confirmed by `done`. */
async function loc(ctx: Ctx, what: string, q: LocQuery, op: RegExp, done: Pred, maxTicks = 30): Promise<void> {
    const sdk = sdkOf(ctx);
    const l = await findLoc(sdk, { ...q, op });
    if (!l) throw new Error(`${what}: no loc ${JSON.stringify({ ...q, op: String(op) })} near ${JSON.stringify(pos(sdk))}`);
    const r = await act(sdk, () => sdk.sendInteractLoc(l.x, l.z, l.id, opIndex(l, op)!), done, { maxTicks, resendEvery: 5, interrupts: interrupts() });
    if (!r.ok) throw new Error(`${what}: ${op} on (${l.x},${l.z}) did not take within ${maxTicks} ticks at ${JSON.stringify(pos(sdk))}`);
}

/** Squeeze through the loose railing into the village, from the maze side. */
async function squeeze(ctx: Ctx): Promise<void> {
    if (inVillage(sdkOf(ctx).getState()!)) return;
    await loc(ctx, 'loose railing', { name: /loose railing/i, near: RAIL_OUT, radius: 10 }, /^squeeze/i, inVillage, 20);
}

/** From anywhere in the village, close enough to Bolren that the talk's approach is a short op-click. */
async function toBolren(ctx: Ctx): Promise<void> {
    await squeeze(ctx);
    await go(ctx, { ...BOLREN, tol: 6 }, 'to Bolren');
}

/** From anywhere outside the village, to Elkoy at the maze entrance. */
async function toElkoy(ctx: Ctx): Promise<void> {
    await go(ctx, { ...ARRIVAL, tol: 3 }, 'to Elkoy');
}

/** Elkoy's jump into the maze, beside the railing. */
async function elkoyIn(ctx: Ctx, opts: Options, shape: string): Promise<void> {
    await talk(ctx, opts, /^Elkoy$/i, { choices: [/^Yes please/i], shape, until: atRailOut, near: ARRIVAL });
}

const ORB_CHEST_OPEN = /^Open chest$/i;
const ORB_CHEST_CLOSED = /^Closed chest$/i;

/**
 * Segment H: Protect from Melee on at the wall's foot, over the crumbled wall, through the door,
 * up the ladder, the chest's orb, down the ladder, the prayer off at its foot. Every move is
 * skipped when its effect is already there, so a resumed H starts wherever SCORED stands.
 */
async function stronghold(ctx: Ctx, opts: Options): Promise<Record<string, unknown>> {
    const sdk = sdkOf(ctx);
    const s0 = sdk.getState()!;
    const report: Record<string, unknown> = { hp0: s0.player?.hp, prayer0: s0.prayers?.prayerPoints };
    let lastHp = s0.player?.hp ?? 0;
    let damage = 0;
    const stop = sdk.onStateUpdate(s => {
        const hp = s.player?.hp;
        if (hp === undefined) return;
        if (hp < lastHp) damage += lastHp - hp;
        lastHp = hp;
    });
    try {
        const st = () => sdk.getState()!;
        if (!holds(st(), ITEM.orb) && pos(sdk).level === 0 && !inStronghold(st())) {
            await go(ctx, { ...WALL_FOOT, tol: 0 }, 'to the crumbled wall');
            report.prayerOnTicks = await pray(ctx, 'protect_from_melee', true);
            const t = currentTick(sdk);
            await locTalk(ctx, opts, 'crumbled wall', { name: /crumbled wall/i, near: WALL_FOOT, radius: 10 }, /^climb-over$/i, [], SHAPES.wall, inStronghold, 40);
            report.wallTicks = currentTick(sdk) - t;
        }
        if (inStronghold(st()) && !prayerActive(st(), 'protect_from_melee')) report.prayerOnTicks = await pray(ctx, 'protect_from_melee', true);
        if (!holds(st(), ITEM.orb) && pos(sdk).level === 0) {
            // The commander's lines hold SCORED ~5 ticks after the climb; openDoor re-sends a dropped click.
            const d = await openDoor(sdk, STRONGHOLD_DOOR.x, STRONGHOLD_DOOR.z, { maxTicks: 40, interrupts: interrupts() });
            report.door = { ok: d.ok, ticks: d.ticks, resends: d.resends };
            if (!d.ok) throw new Error(`the stronghold door at ${STRONGHOLD_DOOR.x},${STRONGHOLD_DOOR.z} did not open`);
            await loc(ctx, 'ladder up', { name: /^ladder$/i, near: LADDER, radius: 12 }, /^climb-up$/i, s => pos(s).level === 1);
        }
        if (!holds(st(), ITEM.orb) && pos(sdk).level === 1) {
            const chestOpen = (s: BotWorldState) => s.nearbyLocs.some(l => ORB_CHEST_OPEN.test(l.name));
            if (!chestOpen(st())) await loc(ctx, 'open the chest', { name: ORB_CHEST_CLOSED, radius: 12 }, /^open$/i, chestOpen);
            await locTalk(ctx, opts, 'search the chest', { name: ORB_CHEST_OPEN, radius: 12 }, /^search$/i, [], SHAPES.chest, s => holds(s, ITEM.orb), 40);
        }
        if (pos(sdk).level === 1) await loc(ctx, 'ladder down', { name: /^ladder$/i, radius: 12 }, /^climb-down$/i, s => pos(s).level === 0);
        report.prayerOffTicks = await pray(ctx, 'protect_from_melee', false);
        const s1 = st();
        return { ...report, damage, hp1: s1.player?.hp, prayer1: s1.prayers?.prayerPoints };
    } finally {
        stop();
    }
}

export interface WarlordReport {
    spell: CombatSpell;
    ticks: number;
    /** Death (or chaos) runes spent: one per cast. What SUPPLIES sizes H7 by. */
    casts: number;
    clicks: number;
    dealt: number;
    taken: number;
    prayerUsed: number;
    levelUps: number;
    eats: number;
    minHp: number;
    end: string;
    prayerOnTicks: number;
}

/** Segment K's fight: Protect from Melee on (already, from the run), the spell until the kill, the orbs' page, the prayer off. */
async function killWarlord(ctx: Ctx, opts: Options): Promise<WarlordReport> {
    const sdk = sdkOf(ctx);
    const spell = resolveOptions(opts).warlordSpell;
    const sp = COMBAT_SPELLS[spell];
    const runes0 = invCount(sdk, sp.rune);
    const prayerOnTicks = await pray(ctx, 'protect_from_melee', true);
    const f: FightResult = await fight(sdk, /^Khazard warlord$/i, {
        spell: sp.component, prayer: 'protect_from_melee', eatBelow: 6, food: ITEM.shark, maxTicks: 1500, findTicks: 15, onDialog: 'continue',
        done: s => holds(s, ITEM.orbs),
    });
    const report: WarlordReport = {
        spell, ticks: f.ticks, casts: runes0 - invCount(sdk, sp.rune), clicks: f.attacks, dealt: f.dealt, taken: f.taken, prayerUsed: f.prayerUsed,
        levelUps: f.levelUps, eats: f.eats, minHp: f.minHp, end: f.end, prayerOnTicks,
    };
    if (!f.ok) throw new Error(`the warlord fight ended '${f.end}' (${JSON.stringify(report)})`);
    // The kill's mesbox hands over the orbs (khazard_warlord.rs2 @defeat_warlord).
    await converse(sdk, [], { idle: 1, openTicks: 6, maxTicks: 40, closeModals: true, unmatched: 'stop', interrupts: interrupts() });
    const got = await waitUntil(sdk, s => holds(s, ITEM.orbs), { maxTicks: 10 });
    if (!got.ok) throw new Error('the warlord died but the orbs of protection never arrived');
    await pray(ctx, 'protect_from_melee', false);
    return report;
}

/** Segment N: the chant, the last pages and the queued completion; the scroll closed and the gnome amulet dropped. */
async function ceremony(ctx: Ctx, opts: Options): Promise<Record<string, unknown>> {
    const sdk = sdkOf(ctx);
    const t0 = currentTick(sdk);
    if (!complete(sdk.getState()!) || sdk.getState()!.dialog.isOpen) {
        // The chant keeps the chat closed ~17 ticks (king_bolren.rs2: p_walk, four chants, p_delay(6)).
        const r = await converse(sdk, [], {
            idle: 2, openTicks: 40, maxTicks: 200, closeModals: false, unmatched: 'stop', interrupts: interrupts(), until: complete, ...talkShape(opts, SHAPES.ceremony),
        });
        opts.onTalk?.('ceremony', r);
        if (!r.ok) throw new Error(`ceremony: ${r.reason}`);
    }
    const done = await waitUntil(sdk, complete, { maxTicks: 20 });
    if (!done.ok) throw new Error('the ceremony ended without the quest completing: stage 8 with the orbs gone means the warlord must be killed again (segment K)');
    const tScroll = currentTick(sdk);
    // The reward's level-up pages and the quest scroll (a modal).
    await converse(sdk, [], { idle: 1, openTicks: 2, maxTicks: 30, closeModals: true, interrupts: interrupts() });
    if (sdk.getState()?.modalOpen) {
        await sdk.sendCloseModal();
        await waitUntil(sdk, s => !s.modalOpen, { maxTicks: 3 });
    }
    const amulet = await waitUntil(sdk, s => holds(s, ITEM.gnomeAmulet), { maxTicks: 3 });
    if (amulet.ok) {
        const d = await dropItems(sdk, i => matchesItem(i, ITEM.gnomeAmulet));
        if (!d.ok) throw new Error('the gnome amulet would not drop');
    }
    return { chantToComplete: tScroll - t0, amuletDropped: amulet.ok };
}

// ------------------------------------------------------------------ the segments

export function steps(input: Options = {}) {
    const opts = resolveOptions(input);
    const spell = opts.warlordSpell;
    const kitEssentials: Check<any> = s => all(need(s, ITEM.logs, 6, 'logs'), check(!!worn(s, ITEM.staffOfFire), 'the staff of fire is not worn'));
    const segs: Segment[] = [
        {
            letter: 'A', label: 'kit', logoutSafe: true,
            preconditions: entryCheck(opts),
            run: async ctx => {
                const sdk = sdkOf(ctx);
                const want = h7Want(sdk.getState()!);
                if (want.length) {
                    if (!opts.kitFrom) throw new Error(`kit: missing ${want.map(w => `${w.amount} x ${String(w.item)}`).join(', ')} and no kitFrom to receive H7 from`);
                    const r = await receiveFrom(ctx.sdk, opts.kitFrom, { want });
                    if (!r.ok) throw new Error(`H7 from ${opts.kitFrom}: ${r.reason}`);
                }
                // Both worn in one tick; the staff of water drops into the freed slot and goes at once.
                const toWear = H7.filter(l => l.wear && !worn(sdk, l.item));
                if (toWear.length) {
                    const w = await act(sdk, async () => {
                        for (const l of toWear) {
                            const it = sdk.getState()!.inventory.find(i => matchesItem(i, l.item));
                            if (it) await sdk.sendUseItem(it.slot, opIndex(it, /^(wear|wield)$/i) ?? 2);
                        }
                    }, s => toWear.every(l => worn(s, l.item)), { maxTicks: 8, resendEvery: 3, maxResends: 1 });
                    if (!w.ok) throw new Error(`kit: could not wear ${toWear.map(l => l.name).join(', ')}`);
                }
                const d = await dropItems(sdk, i => matchesItem(i, ITEM.staffOfWater));
                if (!d.ok) throw new Error('kit: the staff of water would not drop');
            },
            postconditions: kitCheck,
        },
        {
            letter: 'B', label: 'maze', logoutSafe: true,
            preconditions: allOf(notStarted, kitEssentials, s => check(pos(s).level === 0 && !inVillage(s), 'already inside the village'), prayerCovers('S10b:B for B-K', PRAYER_B_TO_K)),
            run: async ctx => {
                await drinkPrayerTo(sdkOf(ctx), PRAYER_B_TO_K);
                // The maze's giants (level 28, spawns 2507,3149, 2545,3144, 2548,3147) and its wolf
                // (64, 2548,3179) hunt combat 43 within 2 tiles (all.hunt [cowardly]: nottoostrong);
                // the giant at 2548,3147 hit SCORED 3-5 a pass in 5 of 5 lab passes at 10 HP. All
                // melee: Protect from Melee from the entrance to the railing, toggled standing.
                const toggles = { on: 0, off: 0 };
                if (!atRailOut(sdkOf(ctx).getState()!)) {
                    toggles.on = await pray(ctx, 'protect_from_melee', true);
                    await go(ctx, { ...RAIL_OUT, tol: 0 }, 'through the maze to the loose railing');
                }
                toggles.off = await pray(ctx, 'protect_from_melee', false);
                note(ctx, 'B-maze', { prayerToggleTicks: toggles });
                await squeeze(ctx);
            },
            postconditions: allOf(s => check(inVillage(s), `not inside the village (at ${pos(s).x},${pos(s).z})`), s => check(!prayerActive(s, 'protect_from_melee'), 'Protect from Melee is still on')),
        },
        {
            letter: 'C', label: 'bolren-start', logoutSafe: true,
            preconditions: allOf(notStarted, s => check(inVillage(s), 'not inside the village')),
            run: async ctx => {
                await toBolren(ctx);
                await talk(ctx, opts, /^King Bolren$/i, { choices: [/Can I help at all/i, /glad to help/i], shape: SHAPES.bolrenStart, until: s => started(s) && nearArrival(s), near: BOLREN });
            },
            postconditions: allOf(isStarted, s => check(nearArrival(s), 'Elkoy did not lead SCORED out of the maze')),
            done: o => atLeast(o, 'started'),
        },
        {
            letter: 'D', label: 'montai-wood', logoutSafe: true,
            preconditions: allOf(isStarted, s => need(s, ITEM.logs, 6, 'logs')),
            run: async ctx => {
                await go(ctx, { ...MONTAI, tol: 6 }, 'to Montai');
                await talk(ctx, opts, /^Commander Montai$/i, { choices: [/gather some wood/i], shape: SHAPES.montaiWood, expect: /as quick as you can/i, near: MONTAI });
            },
            done: o => atLeast(o, 'spoken_montai'),
            probes: PROBES,
        },
        {
            letter: 'E', label: 'montai-logs', logoutSafe: true,
            preconditions: allOf(isStarted, s => need(s, ITEM.logs, 6, 'logs')),
            run: async ctx => {
                await go(ctx, { ...MONTAI, tol: 6 }, 'to Montai');
                await talk(ctx, opts, /^Commander Montai$/i, { shape: SHAPES.montaiLogs, until: s => !holds(s, ITEM.logs), near: MONTAI });
            },
            postconditions: s => check(!holds(s, ITEM.logs), 'Montai did not take the logs'),
            done: o => atLeast(o, 'given_logs_montai'),
            probes: PROBES,
        },
        {
            letter: 'F', label: 'montai-coords', logoutSafe: true,
            preconditions: isStarted,
            run: async ctx => {
                await go(ctx, { ...MONTAI, tol: 6 }, 'to Montai');
                await talk(ctx, opts, /^Commander Montai$/i, { choices: [/try my best/i], shape: SHAPES.montaiCoords, expect: /braver than most/i, near: MONTAI });
            },
            done: o => atLeast(o, 'finding_trackers'),
            probes: PROBES,
        },
        {
            letter: 'G', label: 'ballista', logoutSafe: true,
            preconditions: isStarted,
            run: async ctx => {
                let hit = false;
                const stop = sdkOf(ctx).onStateUpdate(s => {
                    if (/front entrance is reduced to rubble/i.test(pageText(s.dialog))) hit = true;
                });
                try {
                    await locTalk(ctx, opts, 'ballista', { name: /^ballista$/i, near: MONTAI, radius: 25 }, /^fire$/i, [/^0004$/, /^0003$/, /^0005$/], SHAPES.ballista, () => hit, 80);
                } finally {
                    stop();
                }
                if (!hit) throw new Error('the ballista missed (the coordinates were not 0004 / 0003 / 0005)');
            },
            done: o => atLeast(o, 'ballista_fired'),
            probes: PROBES,
        },
        {
            letter: 'H', label: 'stronghold', logoutSafe: true,
            preconditions: allOf(isStarted, slots('H')),
            run: async ctx => { note(ctx, 'H-stronghold', await stronghold(ctx, opts)); },
            postconditions: allOf(
                s => need(s, ITEM.orb, 1, 'orbs of protection'),
                s => check(pos(s).level === 0, 'still upstairs in the stronghold'),
                s => check(!prayerActive(s, 'protect_from_melee'), 'Protect from Melee is still on'),
            ),
            done: o => atLeast(o, 'retrieved_orb') && pos(stateOf(o)).level === 0,
            probes: PROBES,
        },
        {
            letter: 'I', label: 'elkoy-orb', logoutSafe: true,
            preconditions: allOf(isStarted, s => need(s, ITEM.orb, 1, 'orbs of protection'), s => check(pos(s).level === 0 && !inVillage(s) && !atRailOut(s), 'already at the village')),
            run: async ctx => {
                await pray(ctx, 'protect_from_melee', false);
                await toElkoy(ctx);
                await elkoyIn(ctx, opts, SHAPES.elkoyOrb);
            },
            postconditions: s => check(atRailOut(s), 'Elkoy did not jump SCORED to the railing'),
        },
        {
            letter: 'J', label: 'bolren-orb', logoutSafe: true,
            preconditions: allOf(isStarted, s => need(s, ITEM.orb, 1, 'orbs of protection'), s => check(inVillage(s) || atRailOut(s), 'not at the village')),
            run: async ctx => {
                await toBolren(ctx);
                await talk(ctx, opts, /^King Bolren$/i, { choices: [/find the warlord/i], shape: SHAPES.bolrenOrb, until: s => !holds(s, ITEM.orb) && nearArrival(s), near: BOLREN });
            },
            postconditions: allOf(s => check(!holds(s, ITEM.orb), 'Bolren did not take the orb'), s => check(nearArrival(s), 'Elkoy did not lead SCORED out')),
            done: o => atLeast(o, 'returned_first_orb'),
            probes: PROBES,
        },
        {
            letter: 'K', label: 'warlord', logoutSafe: true,
            // Also the recovery from a ceremony lost to a logout: stage 8 with no orbs (the warlord gives them again).
            preconditions: allOf(isStarted, slots('K'), s => check(!holds(s, ITEM.orb) && !holds(s, ITEM.orbs), 'holds an orb'), s => spellRunes(s, spell, WARLORD_CASTS), baseLevels({ magic: COMBAT_SPELLS[spell].magic, prayer: 43 }), prayerCovers('S10b:K for the walk and the warlord', PRAYER_K)),
            run: async ctx => {
                await drinkPrayerTo(sdkOf(ctx), PRAYER_K);
                // Six wolves (level 64, maps m38_51 / m39_51) roam the way to the warlord and hunt
                // combat 43; at 10 HP they hit SCORED 2-3 in the lab. The prayer goes on standing at
                // the start and stays on through the fight. The way back (L) is at ~28 HP after
                // the Fire Blasts' Hitpoints xp, and runs unprotected.
                const on = await pray(ctx, 'protect_from_melee', true);
                await go(ctx, { ...WARLORD, tol: 4 }, 'to the warlord');
                note(ctx, 'K-warlord', { prayerOnTicks: on, warlord: await killWarlord(ctx, opts) });
            },
            postconditions: allOf(s => need(s, ITEM.orbs, 1, 'orbs of protection (the warlord\'s)'), s => check(!prayerActive(s, 'protect_from_melee'), 'Protect from Melee is still on')),
            done: o => complete(stateOf(o)) || (atLeast(o, 'defeated_warlord') && holds(stateOf(o), ITEM.orbs)),
            probes: PROBES,
        },
        {
            letter: 'L', label: 'elkoy-orbs', logoutSafe: true,
            preconditions: allOf(isStarted, s => need(s, ITEM.orbs, 1, 'orbs of protection'), s => check(pos(s).level === 0 && !inVillage(s) && !atRailOut(s), 'already at the village')),
            run: async ctx => {
                await toElkoy(ctx);
                await elkoyIn(ctx, opts, SHAPES.elkoyOrbs);
            },
            postconditions: s => check(atRailOut(s), 'Elkoy did not jump SCORED to the railing'),
        },
        {
            // Unsafe from the orbs leaving to the scroll: the queued completion dies with a logout.
            letter: 'M', label: 'bolren-orbs', logoutSafe: false,
            preconditions: allOf(isStarted, s => need(s, ITEM.orbs, 1, 'orbs of protection'), s => check(inVillage(s) || atRailOut(s), 'not at the village')),
            run: async ctx => {
                await toBolren(ctx);
                await talk(ctx, opts, /^King Bolren$/i, { shape: SHAPES.bolrenOrbs, until: s => !holds(s, ITEM.orbs), near: BOLREN });
            },
            postconditions: s => check(!holds(s, ITEM.orbs), 'Bolren did not take the orbs'),
        },
        {
            letter: 'N', label: 'ceremony', logoutSafe: true,
            preconditions: allOf(s => check(started(s) || complete(s), 'Tree Gnome Village is not started'), s => check(!holds(s, ITEM.orbs), 'the orbs are still held'), s => check(inVillage(s), 'not in the village'), slots('N')),
            run: async ctx => { note(ctx, 'N-ceremony', await ceremony(ctx, opts)); },
            postconditions: exitCheck,
            done: o => complete(stateOf(o)),
        },
    ];
    return questSteps(stepId, segs);
}

function need(s: BotWorldState, item: ItemPattern, n: number, label: string): true | string {
    return invCount(s, item) >= n ? true : `holds ${invCount(s, item)} ${label}, needs ${n}`;
}

function all(...checks: Array<true | string>): true | string {
    return checks.find(c => c !== true) ?? true;
}

/** For tests and the lab: the observation `done` checks read. */
export function observed(state: BotWorldState, journal?: { title: string; lines: string[] }): Observed {
    return { state, probed: journal ? { [JOURNAL]: { open: false, tick: state.tick, ...journal } } : {} };
}
