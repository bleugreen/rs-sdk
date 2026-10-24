// Fight Arena: STEP-MANIFEST.md entry 17 (S12).
//
// From the arrival tile beside Lady Servil (legs.ts T11-12 ends at 2566,3199 tol 1) to the quest
// complete, back beside her, with the cell keys dropped. Eleven segments, A-K, in the order the
// content fixes (docs/speedrun/quests/fight_arena.md "Step list", the route of quest-arena-run.ts):
// Lady Servil, the guards' chest and the uniform, the drunk guard, the Khali brew from the barman,
// the keys, Jeremy and the arena, the three fights, the arena door, and Lady Servil again.
//
// The fights are Fire Blast (Magic 59; SCORED arrives at ~73) under Protect from Melee. The prayer
// goes on with the ogre fight (the fight loop's upkeep) and stays on through the cell, the scorpion
// and Bouncer until SCORED is out of the arena door: General Khazard attacks at stage 12, the
// scorpion and Bouncer attack the moment the content releases them, and a prayer click inside one
// of the content's conversations or delays would be dropped or would interrupt it. It goes off once,
// standing still, outside the arena door.
//
// What the content does that this module is built around (server/content/scripts/quests/quest_arena):
// - The two prison doors (fightarena_door1) open from inside with no dialogue (check_axis on the
//   door's own tile, then a teleport through). From outside the player says the door is locked and
//   the guard (arena_guard1, within 5 tiles) lets a uniformed player in after his line; with no
//   guard in range the door stays shut after the first page, so the op is tried again.
// - The chest gives the helmet and armour (one mesbox); both must be worn for the north door and
//   the drunk guard. The Khali brew costs 5 coins; the guard takes it and gives the cell keys,
//   which nothing ever deletes (khazard_guard.rs2:122), so the module drops them at its exit.
// - Freeing Jeremy, the ogre's death, Hengrad and the scorpion's death each run a cutscene with
//   pages before and after its delays; each death hook only advances the stage while the player is
//   inside the arena zone (quest_arena.constant ^arena_lower/upper_coord), so a segment never
//   leaves the arena between a kill and its pages.
// - Stages 2 and 4 have no journal marker (quest-stages.ts): B's mark is the uniform worn, D's the
//   brew held; the others read the journal through the `journal:arena` probe.
// - The arena fights are logout-unsafe (the manifest): F (the cutscene into the arena) to J (out of
//   the arena door with the General attacking). Logging out in the cell at stage 9 is harmless:
//   Hengrad starts the escort again, so H resumes from the cell by coordinates.

import type { BotWorldState, PrayerName, QuestJournalState } from '../../sdk/types';
import { actConverse, dropItems, opLoc, talkTo, wield, type ActSdk } from '../lib/act';
import { COMBAT_SPELLS, combatSpellUse, fight, prayerActive, setPrayer, type CombatSdk, type FightOptions, type FightResult } from '../lib/combat';
import { converse, levelUpInterrupt, type ConverseResult, type ConverseSdk } from '../lib/converse';
import { pageText, type OptionPattern } from '../lib/dialogue';
import type { ItemPattern } from '../lib/items';
import { journalProbeName, questStatus, requireQuestStage, type QuestView, type StageName } from '../lib/quests';
import { logNote } from '../lib/ticks';
import { FOOD, inArea, missingRunes, runTo, spellUse, SPELLS as TELEPORTS, sumUse, type Area, type RuneUseTable, type TravelSdk } from '../lib/travel';
import { currentTick, waitUntil, type Pred, type StateSource } from '../lib/wait';
import { configId, findLoc, findNpc, invCount, opIndex, pos, worn, type NamePattern } from '../lib/world';
import type { Check, Observed, StepContext } from '../runner/step';
import { allOf, baseLevels, drinkPrayerTo, inBox, prayerCovers, questSteps, slotsCover, talkShape, within, type Box, type QuestItem, type QuestOptions, type Segment } from './segments';

export const quest = 'arena' as const;
export const stepId = 'S12';

export interface Options extends QuestOptions {
    /** What to eat in a fight (default travel.ts FOOD: H9's sharks). */
    food?: ItemPattern;
    /** Food held at the arrival tile, segment A's precondition (default MIN_FOOD). */
    minFood?: number;
    /** Eat in a fight below this HP (default 15). Under the prayer nothing should land. */
    eatBelow?: number;
    /** Fire Blasts the death and air runes must cover at the start (default MIN_CASTS). */
    minCasts?: number;
}

/** H9's sharks (SUPPLIES.md): insurance only, the prayer chain took no damage (rs/56). */
export const MIN_FOOD = 3;
/** Fire Blasts the fights may take: SUPPLIES.md's T/5 upper bound for the chain, ~56. */
export const MIN_CASTS = 56;
const FIRE_BLAST = COMBAT_SPELLS.fire_blast;
/** The fights' Fire Blasts at their measured maximum: rs/379's chains took 28-35 over G-I (m, lab, fedora, 6 of 6). */
export const MAX_CASTS = 35;

/** The worn staff whose element RUNE_USE leaves out (castRunes counts its fire). */
export const RUNE_STAFF = 'staff of fire';

/**
 * The step's runes on the route (lib/travel.ts RuneUseTable): Fire Blasts at their measured maximum.
 * They were measured as the chain's total over the ogre (G), the scorpion (H) and Bouncer (I), so
 * the whole is declared on G.
 */
export const RUNE_USE: RuneUseTable = { G: combatSpellUse('fire_blast', MAX_CASTS, RUNE_STAFF) };

/** What entryCheck wants held at A: MIN_CASTS Fire Blasts' runes, and T12-13's Ardougne teleport (nextLegRunes). */
export const RUNE_NEED: RuneUseTable = { A: sumUse(combatSpellUse('fire_blast', MIN_CASTS, RUNE_STAFF), spellUse('ardougne', 1, RUNE_STAFF)) };

// ------------------------------------------------------------------ places and things

/** Tiles from the maps and the quest scripts (0_40_49_X_Z is 2560+X, 3136+Z). */
export const TILES = {
    /** legs.ts T11-12's landing beside Lady Servil. */
    arrival: { x: 2566, z: 3199, tol: 1 },
    /** Where the walk back to Lady Servil stops. */
    lady: { x: 2567, z: 3197, tol: 1 },
    chest: { x: 2613, z: 3189 },
    /** Inside the guards' house, north of the chest: from the south (2613,3188) the wall is in the way. */
    chestStand: { x: 2613, z: 3190, tol: 1 },
    /** The north prison door: its tile is inside, the guard lets SCORED onto it from the north. */
    northDoor: { x: 2617, z: 3171 },
    northDoorOutside: { x: 2617, z: 3173, tol: 1 },
    drunkGuard: { x: 2616, z: 3142, tol: 1 },
    /** The west prison door: its tile is inside, the outside is to the west. */
    westDoor: { x: 2585, z: 3141 },
    westDoorInside: { x: 2586, z: 3141, tol: 1 },
    westDoorOutside: { x: 2583, z: 3141, tol: 1 },
    barman: { x: 2567, z: 3140, tol: 1 },
    jeremy: { x: 2618, z: 3167, tol: 1 },
    /** fightarena_door2: opened from inside the arena it forcemoves the player out to (2607,3151). */
    arenaDoor: { x: 2606, z: 3152 },
    arenaDoorInside: { x: 2605, z: 3153, tol: 1 },
} as const satisfies Record<string, { x: number; z: number; tol?: number }>;

export const ARRIVAL: Area = TILES.arrival;
/** ^arena_lower_coord to ^arena_upper_coord: where the death hooks fire. */
export const ARENA: Box = { x0: 2581, z0: 3151, x1: 2606, z1: 3171 };
/** The prison compound inside the two prison doors (each door's own tile is inside). */
export const PRISON: Box = { x0: 2585, z0: 3125, x1: 2630, z1: 3171 };
/** The cell the guards put SCORED in after the ogre (it lands on 2600,3142; Hengrad stands by). */
export const CELL: Box = { x0: 2596, z0: 3142, x1: 2604, z1: 3146 };
/** Around Lady Servil's cart, where the step starts and ends. */
export const LADY_AREA: Box = { x0: 2558, z0: 3190, x1: 2575, z1: 3206 };

export const inArena = (s: BotWorldState) => inBox(s, ARENA);
export const inPrison = (s: BotWorldState) => inBox(s, PRISON) || inBox(s, ARENA);
export const inCell = (s: BotWorldState) => inBox(s, CELL);

export const ITEM = {
    helmet: /^Khazard helmet$/i,
    armour: /^Khazard armour$/i,
    keys: /^Khazard cell keys$/i,
    brew: /^Khali brew$/i,
    coins: /^Coins$/i,
    death: FIRE_BLAST.rune,
    air: /^Air rune$/i,
    fire: /^Fire rune$/i,
    staffOfFire: /^Staff of fire$/i,
} as const;

const NPC = {
    lady: /^Lady Servil$/i,
    barman: /^Khazard barman$/i,
    jeremy: /^Jeremy Servil$/i,
    hengrad: /^Hengrad$/i,
    ogre: /^Khazard Ogre$/i,
    scorpion: /^Khazard Scorpion$/i,
    bouncer: /^Bouncer$/i,
} as const;
/** The drunk guard: four NPCs are named Khazard Guard, so by config id. */
const drunkGuard = (): NamePattern => configId('npc', 'arena_guard2');

const LOC = {
    chestShut: () => configId('loc', 'arena_guard_chest_shut'),
    chestOpen: () => configId('loc', 'arena_guard_chest_open'),
    prisonDoor: () => configId('loc', 'fightarena_door1'),
    arenaDoor: () => configId('loc', 'fightarena_door2'),
};

/** The segment letters in order, for the free-slot need. */
export const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'] as const;

/**
 * What the content hands the step (quest_arena), for the free-slot checks. The helmet and armour
 * leave the pack in B, where they are worn; the guard takes the brew in E and gives the keys,
 * which the module drops at K's end. The reward's coins merge with the 5-coin stack's slot, which
 * the barman frees (or into what is left of a larger stack), so they are kept past the step with
 * no `until`. Peak 2: B's uniform, and the keys with the coins at K.
 */
export const QUEST_ITEMS: readonly QuestItem[] = [
    // quest_arena.rs2:39-40, worn at once (quest_arena.rs2:48: the north door wants both worn).
    { item: ITEM.helmet, name: 'Khazard helmet', from: 'B', until: 'B' },
    { item: ITEM.armour, name: 'Khazard armour', from: 'B', until: 'B' },
    // khazard_barman.rs2:38; khazard_guard.rs2:121 takes it.
    { item: ITEM.brew, name: 'Khali brew', from: 'D', until: 'E' },
    // khazard_guard.rs2:122; never deleted, dropped at K's exit.
    { item: ITEM.keys, name: 'Khazard cell keys', from: 'E', until: 'K' },
    // quest_arena.rs2:269, the reward.
    { item: ITEM.coins, name: 'Coins', stackable: true, from: 'K' },
];
const slots = (at: (typeof LETTERS)[number]) => slotsCover(QUEST_ITEMS, LETTERS, at);

/** What S12 leaves that nothing later uses, dropped at its exit (the inventory ledger's T12-13 row). */
export const DEAD_AT_EXIT: readonly RegExp[] = [ITEM.keys];
export const isDead = (i: { name: string }) => DEAD_AT_EXIT.some(p => p.test(i.name));

// ------------------------------------------------------------------ conversations (CONVENTIONS.md shapes, read from the scripts)

export const SHAPES = {
    /** lady_servil.rs2:29-44: two pages, the choice, its echo and seven more. */
    start: '2c, opt, 8c',
    /** quest_arena.rs2:39-41, the chest's mesbox. */
    chest: '1c',
    /** quest_arena.rs2:52-66 from outside: the player's line, the guard's, then the door. */
    door: '1c, state',
    /** khazard_guard.rs2:93-101, stage 2 in uniform. */
    drunkGuard: '4c',
    /** khazard_barman.rs2:1-37. */
    brew: '2c, opt, 2c',
    /** khazard_guard.rs2:83-123, stage 3 holding the brew. */
    keys: '14c',
    /** jeremy_servil.rs2:57-93: three pages, the walk into the arena, then his plea. */
    jeremy: '2c, state, 1c',
    /** The ogre's death: Justin's thanks and the General's six pages, the cells, the guard's line. */
    ogreDead: '6c, state, 1c',
    /** hengrad.rs2:7-70: ten pages, the escort, the announcer's mesbox. */
    hengrad: '9c, state, 1c',
    /** general_khazard.rs2:76-79: the General, the announcer, then Bouncer is released. */
    scorpionDead: '1c, state',
    /** general_khazard.rs2:81-102: five pages, then he attacks (stage 12). */
    bouncerDead: '4c, state',
    /** lady_servil.rs2:8-13 at stage 12: four pages, then the completion queue. */
    reward: '3c, state',
} as const;

/** Pages the segments wait for across a cutscene. */
const PAGE = {
    quick: /Quick, help him/i,
    likingYou: /taken a liking to you/i,
    scorpion: /favourite scorpion commence/i,
    /** The announcer's mesbox, the scorpion's death hook's last page before Bouncer is released. */
    bouncer: /second round of battle/i,
    killMyself: /pleasure of killing you myself/i,
};

// ------------------------------------------------------------------ resume evidence

const JOURNAL = journalProbeName(quest);
const PROBES = [JOURNAL] as const;
const stateOf = (o: QuestView): BotWorldState => ('probed' in o ? o.state : o);
const atLeast = (o: QuestView, stage: StageName<typeof quest>) => requireQuestStage(o, quest, stage, { atLeast: true }) === true;
const complete = (o: QuestView) => questStatus(stateOf(o), quest) === 'complete';
const holds = (o: QuestView, item: ItemPattern) => invCount(stateOf(o), item) > 0;
export const uniform = (s: BotWorldState) => worn(s, ITEM.helmet) !== null && worn(s, ITEM.armour) !== null;

// ------------------------------------------------------------------ helpers

type Ctx = StepContext<any>;
type Sdk = TravelSdk & ActSdk & ConverseSdk & CombatSdk;
const sdkOf = (ctx: Ctx) => ctx.sdk as unknown as Sdk;
const interrupts = () => [levelUpInterrupt()];
const note = (ctx: Ctx, step: string, meta: Record<string, unknown>) => logNote(ctx.log, ctx.session, step, meta);
const seg = (letter: string) => `${stepId}:${letter}`;

/**
 * The prison's north corridor, walked along x=2618: the cell gates (arena_prisondoor, always locked)
 * stand on x=2617 at z=3159, 3163 and 3167, and a run routed over those tiles stalled there for
 * ~17 ticks in the lab (the stall handler then tries the locked gate: "The gate appears to be locked.").
 */
export const CORRIDOR_SOUTH = [{ x: 2618, z: 3166 }, { x: 2618, z: 3150 }] as const;
export const CORRIDOR_NORTH = [{ x: 2618, z: 3150 }, { x: 2618, z: 3165 }] as const;

/** Run to `to` (through `via`), retrying a run that ends short ('no tick', a stall): ok only inside the area. */
async function go(ctx: Ctx, to: Area, what: string, via?: ReadonlyArray<{ x: number; z: number }>): Promise<void> {
    const sdk = sdkOf(ctx);
    let why = '';
    for (let i = 0; i < 3; i++) {
        if (inArea(sdk, to)) return;
        // A retry starts from wherever the last run stopped: only the waypoints still ahead (south or north of it).
        const z = pos(sdk).z;
        const ahead = via?.filter(p => (to.z < z ? p.z < z : p.z > z));
        const r = await runTo(sdk, to, { bot: ctx.bot, ...(ahead?.length ? { via: ahead } : {}) });
        if (r.ok) return;
        why = r.reason ?? 'not arrived';
    }
    if (!inArea(sdk, to)) throw new Error(`${what}: run to ${to.x},${to.z} failed (${why}) at ${JSON.stringify(pos(sdk))}`);
}

/** A page matching `re` seen since the call: latched by a state listener, for conversations split by a cutscene. */
function pageSeen(sdk: StateSource, re: RegExp): { seen: () => boolean; stop: () => void } {
    let seen = false;
    const check = (s: BotWorldState) => {
        if (!seen && s.dialog.isOpen && re.test(pageText(s.dialog))) seen = true;
    };
    const s0 = sdk.getState();
    if (s0) check(s0);
    const stop = sdk.onStateUpdate(check);
    return { seen: () => seen, stop };
}

/** Talk to an NPC and answer the conversation; it must open and end well (and, with `until`, reach it). */
async function talk(ctx: Ctx, opts: Options | undefined, npc: NamePattern, choices: OptionPattern[], shape: string, what: string, until?: Pred, maxTicks = 300): Promise<ConverseResult> {
    const sdk = sdkOf(ctx);
    const r = await talkTo(sdk, npc, choices, { openTicks: 30, findTicks: 15, maxTicks, interrupts: interrupts(), ...(until ? { until } : {}), ...talkShape(opts, shape) });
    if (!r.opened) throw new Error(`${what}: no dialogue opened at ${JSON.stringify(pos(sdk))}`);
    if (!r.ok) throw new Error(`${what}: ${r.reason}`);
    return r;
}

/**
 * Answer the pages the content opens by itself (a death hook, a cutscene's lines) until `until`
 * holds with the dialogue closed. `expect` is a page that must have shown by then.
 */
async function pages(ctx: Ctx, opts: Options | undefined, shape: string, what: string, until: Pred, expect?: RegExp, maxTicks = 200): Promise<ConverseResult> {
    const sdk = sdkOf(ctx);
    const latch = expect ? pageSeen(sdk, expect) : null;
    try {
        const r = await converse(sdk, [], { openTicks: 40, idle: 1, maxTicks, interrupts: interrupts(), until: s => until(s) && (!latch || latch.seen()), ...talkShape(opts, shape) });
        if (!r.ok) throw new Error(`${what}: ${r.reason} at ${JSON.stringify(pos(sdk))}`);
        return r;
    } finally {
        latch?.stop();
    }
}

/** The prison door at `door` from inside: no dialogue, the door teleports SCORED through. */
async function doorOut(ctx: Ctx, door: { x: number; z: number }, out: Pred, what: string): Promise<void> {
    const sdk = sdkOf(ctx);
    const r = await opLoc(sdk, { x: door.x, z: door.z, id: LOC.prisonDoor(), radius: 12 }, /^open$/i, out, { maxTicks: 30 });
    if (!r.ok) throw new Error(`${what}: the door did not let SCORED out within 30 ticks at ${JSON.stringify(pos(sdk))}`);
}

export interface DoorReport {
    /** Click to the guard's first page (addendum 11's sensitivity: no p_delay before it in the script). */
    clickToDialogue: number;
    /** Click to SCORED on the door's tile, inside. */
    ticks: number;
    tries: number;
}

/**
 * A prison door from outside, uniform worn: the player's line and the guard's, then the door puts
 * SCORED on its tile. With no guard within 5 tiles the content stops after the first page and the
 * door stays shut, so the op is tried again (at most 3 times).
 */
async function doorIn(ctx: Ctx, opts: Options | undefined, door: { x: number; z: number }, inside: Pred, what: string): Promise<DoorReport> {
    const sdk = sdkOf(ctx);
    const t0 = currentTick(sdk);
    let dialogAt = -1;
    const stop = sdk.onStateUpdate(s => {
        if (dialogAt < 0 && s.dialog.isOpen) dialogAt = s.tick;
    });
    try {
        for (let tries = 1; tries <= 3; tries++) {
            const l = await findLoc(sdk, { x: door.x, z: door.z, id: LOC.prisonDoor(), radius: 12 });
            if (!l) throw new Error(`${what}: no prison door at ${door.x},${door.z} near ${JSON.stringify(pos(sdk))}`);
            const r = await actConverse(sdk, () => sdk.sendInteractLoc(l.x, l.z, l.id, opIndex(l, /^open$/i) ?? 1), [], {
                done: inside, idle: 1, maxTicks: 60, interrupts: interrupts(), ...talkShape(opts, SHAPES.door),
            });
            if (r.ok || inside(sdk.getState()!)) return { clickToDialogue: dialogAt < 0 ? -1 : dialogAt - t0, ticks: currentTick(sdk) - t0, tries };
            // A shut door after the first page: the guard was out of range.
            await waitUntil(sdk, s => !s.dialog.isOpen, { maxTicks: 5 });
        }
    } finally {
        stop();
    }
    throw new Error(`${what}: the guard never let SCORED in after 3 tries at ${JSON.stringify(pos(sdk))}`);
}

/** setPrayer, standing still (a prayer click clears a pending action, rs/241); throws if it does not turn. */
async function pray(sdk: Sdk, on: boolean, name: PrayerName = 'protect_from_melee'): Promise<number> {
    const r = await setPrayer(sdk, name, on);
    if (!r.ok) throw new Error(`${name} did not turn ${on ? 'on' : 'off'}: ${r.reason}`);
    return r.ticks;
}

/** HP lost while `run` runs (every drop seen), with the lowest HP. */
async function watchHp<T>(sdk: StateSource, run: () => Promise<T>): Promise<{ value: T; taken: number; minHp: number }> {
    let last = sdk.getState()?.player?.hp ?? 0;
    let taken = 0;
    let minHp = last;
    const stop = sdk.onStateUpdate(s => {
        const hp = s.player?.hp;
        if (hp === undefined) return;
        if (hp < last) taken += last - hp;
        last = hp;
        minHp = Math.min(minHp, hp);
    });
    try {
        return { value: await run(), taken, minHp };
    } finally {
        stop();
    }
}

/**
 * Prayer points G needs for the whole arena stretch, G to J, counting held doses: 32-38 measured
 * (rs/379 lite, rs/401 browser) with margin (rs/687's budget). From G to J SCORED is in the sealed
 * cell or the arena (quest_arena.rs2:62-64), so nothing can be brought in once G starts.
 */
export const ARENA_PRAYER = 45;

/** The fights drink a dose below this; each arena segment drinks up to it first, so its prayer can go on. */
export const ARENA_DRINK_BELOW = 8;

export function fightOptions(opts: Options | undefined): FightOptions {
    return {
        spell: FIRE_BLAST.component,
        prayer: 'protect_from_melee',
        drinkBelow: ARENA_DRINK_BELOW,
        eatBelow: opts?.eatBelow ?? 15,
        food: opts?.food ?? FOOD,
        maxTicks: 1500,
        findTicks: 40,
    };
}

const deathRunes = (s: BotWorldState | null) => (s ? invCount(s, ITEM.death) : 0);

/**
 * A scorpion or Bouncer still in its cage: its tile east of the gate line, the edge between x 2606 and
 * 2607 (the arena_inactivegate pairs at (2606,3159-3160) and (2606,3162-3163) wall that edge). The
 * release (quest_arena.rs2 @arena_release_scorp / _bouncer) opens the gates for 6 ticks and teleports
 * it a tile west; a release whose script never resumed (a session lost with the round's mesbox
 * open) leaves it there, and nothing can reach it: the live S12:H of 10-24 (rs/693).
 */
export const caged = (n: { x: number; tileX?: number }) => (n.tileX ?? n.x) > ARENA.x1;

/** Re-releases tried per fight: the arena door from inside runs the release again. */
export const MAX_RERELEASES = 2;

/**
 * Wait (bounded) for `target` to be out of its cage; still caged or not there, run the release again:
 * the arena door from inside at sent_jail (or defeated_scorpion) gives the guard's line, forcemoves
 * SCORED 2 tiles in and calls the release (quest_arena.rs2:110-116), which for a caged monster opens
 * the gates again. Never for one already out: in combat within 8 ticks the release adds a second.
 * True when it ran the door.
 */
export async function released(ctx: Ctx, target: RegExp, what: string, waitTicks = 12): Promise<boolean> {
    const sdk = sdkOf(ctx);
    const out = (s: BotWorldState) => {
        const n = findNpc(s, target);
        return !!n && !caged(n);
    };
    if ((await waitUntil(sdk, out, { maxTicks: waitTicks })).ok) return false;
    const n = findNpc(sdk, target);
    const t0 = currentTick(sdk);
    await go(ctx, TILES.arenaDoorInside, 'to the arena door (the release again)');
    const l = await findLoc(sdk, { x: TILES.arenaDoor.x, z: TILES.arenaDoor.z, id: LOC.arenaDoor(), radius: 10 });
    if (!l) throw new Error(`${what}: no arena door to run the release again near ${JSON.stringify(pos(sdk))}`);
    const r = await actConverse(sdk, () => sdk.sendInteractLoc(l.x, l.z, l.id, opIndex(l, /^open$/i) ?? 1), [], { done: out, idle: 1, maxTicks: 40, interrupts: interrupts() });
    note(ctx, `${stepId}:release`, { what, caged: n ? { x: n.tileX ?? n.x, z: n.tileZ ?? n.z } : null, ticks: currentTick(sdk) - t0, ok: r.ok });
    return true;
}

/** The first page of each monster's death hook (khazard_ogre.rs2 via justin_servil_saved, general_khazard.rs2). */
export const DEATH_HOOK = {
    ogre: /You saved my life/i,
    scorpion: /Not bad, not bad at all/i,
    bouncer: /Nooooo! Bouncer/i,
} as const;

/**
 * One arena fight to the kill, under the prayer. The fight loop stops on any page that is not a
 * level-up; the death hook's own first page (`hook`) is the kill, any other page (a cutscene's
 * last line still on its way) is answered and the fight goes on, at most 3 times.
 */
async function arenaFight(ctx: Ctx, opts: Options | undefined, target: RegExp, hook: RegExp, what: string, caged = false): Promise<void> {
    const sdk = sdkOf(ctx);
    const runes0 = deathRunes(sdk.getState());
    const fights: FightResult[] = [];
    let stray = 0;
    let rereleases = 0;
    if (caged && (await released(ctx, target, what))) rereleases++;
    for (;;) {
        const r = await fight(sdk, target, { ...fightOptions(opts), approach: { bot: ctx.bot, interrupts: interrupts() } });
        fights.push(r);
        // A target nothing can reach: still caged, so the release runs again (bounded).
        if (r.end === 'unreachable' && caged && rereleases < MAX_RERELEASES) {
            if (await released(ctx, target, what, 0)) {
                rereleases++;
                continue;
            }
        }
        if (!r.ok) break;
        if (r.end !== 'dialog' || hook.test(pageText(sdk.getState()!.dialog))) break;
        if (++stray > 3) break;
        await converse(sdk, [], { openTicks: 1, idle: 1, maxTicks: 30, interrupts: interrupts() });
    }
    const last = fights[fights.length - 1]!;
    const sum = (k: 'ticks' | 'attacks' | 'dealt' | 'taken' | 'levelUps' | 'eats' | 'prayerUsed') => fights.reduce((a, f) => a + f[k], 0);
    note(ctx, `${stepId}:fight`, {
        what, end: last.end, ticks: sum('ticks'), engaged: fights[0]!.engaged, casts: runes0 - deathRunes(sdk.getState()), clicks: sum('attacks'), dealt: sum('dealt'),
        taken: sum('taken'), minHp: Math.min(...fights.map(f => f.minHp)), levelUps: sum('levelUps'), eats: sum('eats'), prayerUsed: sum('prayerUsed'), strayPages: stray,
        ...(rereleases ? { rereleases } : {}), ...(fights.some(f => f.approaches) ? { approaches: fights.reduce((a, f) => a + f.approaches, 0) } : {}),
        ...(last.reason ? { reason: last.reason } : {}),
    });
    const hooked = last.end === 'dialog' && hook.test(pageText(sdk.getState()!.dialog));
    if (!last.ok || (last.end !== 'killed' && !hooked)) throw new Error(`${what}: the fight ended '${last.end}' (${JSON.stringify(last)})`);
}

// ------------------------------------------------------------------ segment runs

/** B: open the chest and search it (unless the uniform is already held or worn), then wear it. */
async function armour(ctx: Ctx, opts: Options | undefined): Promise<void> {
    const sdk = sdkOf(ctx);
    const has = (s: BotWorldState, it: RegExp) => invCount(s, it) > 0 || worn(s, it) !== null;
    const both = (s: BotWorldState) => has(s, ITEM.helmet) && has(s, ITEM.armour);
    if (!both(sdk.getState()!)) {
        await go(ctx, TILES.chestStand, 'to the guards\' chest');
        const shut = await findLoc(sdk, { x: TILES.chest.x, z: TILES.chest.z, id: LOC.chestShut(), radius: 10 });
        if (shut) {
            const r = await opLoc(sdk, shut, /^open$/i, s => s.nearbyLocs.some(l => l.id === LOC.chestOpen() && l.x === TILES.chest.x && l.z === TILES.chest.z), { maxTicks: 20 });
            if (!r.ok) throw new Error('chest: it did not open within 20 ticks');
        }
        const open = await findLoc(sdk, { x: TILES.chest.x, z: TILES.chest.z, id: LOC.chestOpen(), radius: 10 });
        if (!open) throw new Error('chest: no open chest to search');
        const t0 = currentTick(sdk);
        const r = await actConverse(sdk, () => sdk.sendInteractLoc(open.x, open.z, open.id, opIndex(open, /^search$/i) ?? 1), [], {
            done: both, idle: 1, maxTicks: 30, interrupts: interrupts(), ...talkShape(opts, SHAPES.chest),
        });
        if (!r.ok) throw new Error(`chest: the search gave no uniform (${r.reason})`);
        note(ctx, seg('B'), { chestSearch: { ticks: currentTick(sdk) - t0, clickToDialogue: r.dialogue?.opened ? r.dialogue.startTick - t0 : -1 } });
    }
    for (const it of [ITEM.helmet, ITEM.armour]) {
        if (worn(sdk, it)) continue;
        const r = await wield(sdk, it);
        if (!r.ok) throw new Error(`could not wear the ${String(it)}`);
    }
}

/** C: in through the north door (from outside), then the drunk guard's first talk (stage 3). */
async function drunkGuardFirst(ctx: Ctx, opts: Options | undefined): Promise<void> {
    const sdk = sdkOf(ctx);
    if (!inPrison(sdk.getState()!)) {
        await go(ctx, TILES.northDoorOutside, 'to the north prison door');
        const d = await doorIn(ctx, opts, TILES.northDoor, s => inPrison(s), 'north prison door');
        note(ctx, seg('C'), { northDoor: d });
    }
    await go(ctx, TILES.drunkGuard, 'to the drunk guard', pos(sdk).z > 3150 ? CORRIDOR_SOUTH : undefined);
    await talk(ctx, opts, drunkGuard(), [], SHAPES.drunkGuard, 'drunk guard (first)');
}

/** D: out through the west door, the barman's Khali brew. */
async function brew(ctx: Ctx, opts: Options | undefined): Promise<void> {
    const sdk = sdkOf(ctx);
    if (invCount(sdk, ITEM.brew) > 0) return;
    if (inPrison(sdk.getState()!)) {
        await go(ctx, TILES.westDoorInside, 'to the west prison door');
        await doorOut(ctx, TILES.westDoor, s => !inPrison(s), 'west prison door, out');
    }
    await go(ctx, TILES.barman, 'to the barman');
    await talk(ctx, opts, NPC.barman, [/Khali brew/i], SHAPES.brew, 'barman', s => invCount(s, ITEM.brew) > 0);
}

/** E: in through the west door, the brew for the keys (stage 5). */
async function keys(ctx: Ctx, opts: Options | undefined): Promise<void> {
    const sdk = sdkOf(ctx);
    if (!inPrison(sdk.getState()!)) {
        await go(ctx, TILES.westDoorOutside, 'to the west prison door');
        const d = await doorIn(ctx, opts, TILES.westDoor, s => inPrison(s), 'west prison door, in');
        note(ctx, seg('E'), { westDoor: d });
    }
    await go(ctx, TILES.drunkGuard, 'to the drunk guard');
    await talk(ctx, opts, drunkGuard(), [], SHAPES.keys, 'drunk guard (keys)', s => invCount(s, ITEM.keys) > 0);
}

/** F: Jeremy with the keys, the walk into the arena (stage 6) and his plea; the ogre's cutscene follows. */
async function jeremy(ctx: Ctx, opts: Options | undefined): Promise<void> {
    const sdk = sdkOf(ctx);
    // The stretch's prayer drunk here, in the corridor: from Jeremy's plea on, the walk in and the
    // ogre's entry scene drop item clicks, and a drink on one of its pages would close it.
    await drinkPrayerTo(sdk, ARENA_PRAYER);
    await go(ctx, TILES.jeremy, 'to Jeremy', CORRIDOR_NORTH);
    const latch = pageSeen(sdk, PAGE.quick);
    try {
        await talk(ctx, opts, NPC.jeremy, [], SHAPES.jeremy, 'Jeremy', s => inArena(s) && latch.seen(), 120);
    } finally {
        latch.stop();
    }
}

/** G: the ogre under the prayer, then its death hook: the General's pages and the cells (stage 9). */
async function ogre(ctx: Ctx, opts: Options | undefined): Promise<void> {
    const sdk = sdkOf(ctx);
    await arenaFight(ctx, opts, NPC.ogre, DEATH_HOOK.ogre, 'Khazard ogre');
    await pages(ctx, opts, SHAPES.ogreDead, 'the ogre\'s death', s => inCell(s), PAGE.likingYou, 120);
}

/** H: Hengrad, the escort into the arena, the scorpion (stage 10). The prayer goes on in the cell. */
async function scorpion(ctx: Ctx, opts: Options | undefined): Promise<void> {
    const sdk = sdkOf(ctx);
    await drinkPrayerTo(sdk, ARENA_DRINK_BELOW);
    const s = sdk.getState()!;
    if (inCell(s)) {
        if (!prayerActive(s, 'protect_from_melee')) note(ctx, seg('H'), { prayerOnTicks: await pray(sdk, true) });
        const latch = pageSeen(sdk, PAGE.scorpion);
        try {
            await talk(ctx, opts, NPC.hengrad, [], SHAPES.hengrad, 'Hengrad', st => inArena(st) && latch.seen(), 160);
        } finally {
            latch.stop();
        }
    }
    await arenaFight(ctx, opts, NPC.scorpion, DEATH_HOOK.scorpion, 'Khazard scorpion', true);
}

/** I: the General summons Bouncer, Bouncer under the prayer, the General's pages (stage 12, he attacks). */
async function bouncer(ctx: Ctx, opts: Options | undefined): Promise<void> {
    const sdk = sdkOf(ctx);
    if (!findNpc(sdk, NPC.bouncer)) await pages(ctx, opts, SHAPES.scorpionDead, 'the scorpion\'s death', s => findNpc(s, NPC.bouncer) !== null, PAGE.bouncer, 60);
    await drinkPrayerTo(sdk, ARENA_DRINK_BELOW);
    await arenaFight(ctx, opts, NPC.bouncer, DEATH_HOOK.bouncer, 'Bouncer', true);
    await pages(ctx, opts, SHAPES.bouncerDead, 'Bouncer\'s death', () => true, PAGE.killMyself, 60);
}

/** J: out of the arena door (the General attacking), then the prayer off. */
async function arenaDoor(ctx: Ctx): Promise<void> {
    const sdk = sdkOf(ctx);
    if (inArena(sdk.getState()!)) {
        await go(ctx, TILES.arenaDoorInside, 'to the arena door');
        const r = await opLoc(sdk, { x: TILES.arenaDoor.x, z: TILES.arenaDoor.z, id: LOC.arenaDoor(), radius: 10 }, /^open$/i, s => !inArena(s), { maxTicks: 20 });
        if (!r.ok) throw new Error(`arena door: still in the arena after 20 ticks at ${JSON.stringify(pos(sdk))}`);
    }
    const s = sdk.getState()!;
    note(ctx, seg('J'), { prayerPoints: s.prayers?.prayerPoints ?? null, ...(prayerActive(s, 'protect_from_melee') ? { prayerOffTicks: await pray(sdk, false) } : {}) });
}

/**
 * K: out of the prison, Lady Servil's reward (the quest completes), its scroll and level-up pages
 * closed, the cell keys dropped, and the exit census. Resumed after the completion, it only drops.
 */
async function reward(ctx: Ctx, opts: Options | undefined): Promise<void> {
    const sdk = sdkOf(ctx);
    if (questStatus(sdk.getState()!, quest) !== 'complete') {
        if (inPrison(sdk.getState()!)) {
            await go(ctx, TILES.westDoorInside, 'to the west prison door');
            await doorOut(ctx, TILES.westDoor, s => !inPrison(s), 'west prison door, out');
        }
        await go(ctx, TILES.lady, 'to Lady Servil');
        await talk(ctx, opts, NPC.lady, [], SHAPES.reward, 'Lady Servil (reward)', s => questStatus(s, quest) === 'complete');
        // The reward's level-up pages and the quest scroll (a modal).
        await converse(sdk, [], { openTicks: 2, idle: 1, closeModals: true, interrupts: interrupts() });
        if (sdk.getState()?.modalOpen) {
            await sdk.sendCloseModal();
            await waitUntil(sdk, s => !s.modalOpen, { maxTicks: 3 });
        }
    }
    const r = await dropItems(sdk, isDead);
    if (!r.ok) throw new Error(`exit: the dead items (${(sdk.getState()?.inventory ?? []).filter(isDead).map(i => i.name).join(', ')}) were not dropped`);
    note(ctx, seg('K'), { exitCensus: census(sdk.getState()!) });
}

/** The exit inventory, every slot, and the worn set: rs/158's census for the ledger. */
export function census(s: BotWorldState): { slots: string[]; free: number; worn: string[] } {
    return {
        slots: [...s.inventory].sort((a, b) => a.slot - b.slot).map(i => `${i.slot}: ${i.name} x${i.count}`),
        free: 28 - s.inventory.length,
        worn: s.equipment.map(i => i.name),
    };
}

// ------------------------------------------------------------------ checks

const notStarted: Check<any> = s => requireQuestStage(s, quest, 'not_started');
const started: Check<any> = s => (questStatus(s, quest) === 'started' ? true : `Fight Arena is ${questStatus(s, quest) ?? 'unobservable'}, not started`);

/** Fire Blast's runes for `casts` casts: death and air in the pack, fire from a worn staff of fire or the pack. */
export function castRunes(casts: number): Check<any> {
    return s => {
        const short: string[] = [];
        const death = invCount(s, ITEM.death);
        const air = invCount(s, ITEM.air);
        if (death < casts) short.push(`${death}/${casts} death`);
        if (air < casts * FIRE_BLAST.air) short.push(`${air}/${casts * FIRE_BLAST.air} air`);
        if (!worn(s, ITEM.staffOfFire) && invCount(s, ITEM.fire) < casts * FIRE_BLAST.fire) short.push(`${invCount(s, ITEM.fire)}/${casts * FIRE_BLAST.fire} fire and no staff of fire worn`);
        return short.length ? `runes for ${casts} Fire Blasts short: ${short.join(', ')}` : true;
    };
}

const foodHeld = (opts: Options | undefined): Check<any> => s => {
    const n = invCount(s, opts?.food ?? FOOD);
    const want = opts?.minFood ?? MIN_FOOD;
    return n >= want ? true : `food: ${n} held, the fights want ${want} as insurance`;
};

const coinsForBrew: Check<any> = s => (invCount(s, ITEM.coins) >= 5 || invCount(s, ITEM.brew) > 0 ? true : `${invCount(s, ITEM.coins)} coins and no Khali brew: the barman wants 5`);

/** T12-13's Ardougne teleport, which the manifest lists among S12's preconditions (H9 brings it). */
const nextLegRunes: Check<any> = s => {
    const m = missingRunes(s, TELEPORTS.ardougne.runes);
    return m === null ? true : `T12-13's Ardougne teleport: ${m}`;
};

const wearsUniform: Check<any> = s => (uniform(s) ? true : 'the Khazard helmet and armour are not both worn (the north door and the drunk guard want them)');

/** The entry's preconditions on the arrival tile (STEP-MANIFEST.md entry 17). */
export function entryCheck(opts: Options | undefined): Check<any> {
    return allOf(
        within({ x0: ARRIVAL.x - 1, z0: ARRIVAL.z - 1, x1: ARRIVAL.x + 1, z1: ARRIVAL.z + 1 }, 'the arrival tile beside Lady Servil'),
        notStarted,
        baseLevels({ magic: FIRE_BLAST.magic, prayer: 43 }),
        castRunes(opts?.minCasts ?? MIN_CASTS),
        coinsForBrew,
        foodHeld(opts),
        nextLegRunes,
        slots('A'),
    );
}

const inArenaCheck = within(ARENA, 'the arena');
const notInArena: Check<any> = s => (inArena(s) ? 'still inside the arena' : true);

// ------------------------------------------------------------------ the segments

export function steps(opts?: Options) {
    const segs: Segment[] = [
        {
            letter: 'A', label: 'lady-start', logoutSafe: true,
            preconditions: entryCheck(opts),
            run: async ctx => { await talk(ctx, opts, NPC.lady, ['Can I help you?'], SHAPES.start, 'Lady Servil (start)', s => questStatus(s, quest) === 'started'); },
            postconditions: started,
            done: o => questStatus(stateOf(o), quest) !== 'not_started' && questStatus(stateOf(o), quest) !== null,
        },
        {
            letter: 'B', label: 'uniform', logoutSafe: true,
            preconditions: allOf(started, slots('B')),
            run: ctx => armour(ctx, opts),
            postconditions: wearsUniform,
            // Stage 2 has no journal marker: the uniform worn is the mark.
            done: o => complete(o) || uniform(stateOf(o)) || atLeast(o, 'given_khali_brew'),
            probes: PROBES,
        },
        {
            letter: 'C', label: 'drunk-guard', logoutSafe: true,
            preconditions: allOf(started, wearsUniform),
            run: ctx => drunkGuardFirst(ctx, opts),
            done: o => complete(o) || atLeast(o, 'spoken_drunkguard'),
            probes: PROBES,
        },
        {
            letter: 'D', label: 'khali-brew', logoutSafe: true,
            preconditions: allOf(started, coinsForBrew, slots('D')),
            run: ctx => brew(ctx, opts),
            postconditions: s => (invCount(s, ITEM.brew) > 0 ? true : 'no Khali brew held'),
            // Stage 4 is never set: the brew held is the mark until the guard takes it.
            done: o => complete(o) || holds(o, ITEM.brew) || holds(o, ITEM.keys) || atLeast(o, 'given_khali_brew'),
            probes: PROBES,
        },
        {
            letter: 'E', label: 'cell-keys', logoutSafe: true,
            preconditions: allOf(started, wearsUniform, s => (invCount(s, ITEM.brew) > 0 ? true : 'no Khali brew held'), slots('E')),
            run: ctx => keys(ctx, opts),
            postconditions: s => (invCount(s, ITEM.keys) > 0 ? true : 'no cell keys held'),
            done: o => complete(o) || holds(o, ITEM.keys) || atLeast(o, 'given_khali_brew'),
            probes: PROBES,
        },
        {
            letter: 'F', label: 'jeremy', logoutSafe: false,
            preconditions: allOf(started, s => (invCount(s, ITEM.keys) > 0 ? true : 'no cell keys held'), s => (inArena(s) ? 'already in the arena' : true)),
            run: ctx => jeremy(ctx, opts),
            postconditions: inArenaCheck,
            done: o => complete(o) || atLeast(o, 'entered_ogre_fight'),
            probes: PROBES,
        },
        {
            letter: 'G', label: 'ogre', logoutSafe: false,
            preconditions: allOf(started, inArenaCheck, prayerCovers('S12:G for G-J', ARENA_PRAYER)),
            run: ctx => ogre(ctx, opts),
            postconditions: within(CELL, 'the cell'),
            done: o => complete(o) || atLeast(o, 'sent_jail'),
            probes: PROBES,
        },
        {
            letter: 'H', label: 'scorpion', logoutSafe: false,
            preconditions: allOf(started, s => (inCell(s) || inArena(s) ? true : `not in the cell or the arena: at ${pos(s).x},${pos(s).z}`)),
            run: ctx => scorpion(ctx, opts),
            done: o => complete(o) || atLeast(o, 'defeated_scorpion'),
            probes: PROBES,
        },
        {
            letter: 'I', label: 'bouncer', logoutSafe: false,
            preconditions: allOf(started, inArenaCheck),
            run: ctx => bouncer(ctx, opts),
            done: o => complete(o) || atLeast(o, 'freed_servils'),
            probes: PROBES,
        },
        {
            // No durable mark: the walk enters it while SCORED is still in the arena at stage 12.
            letter: 'J', label: 'arena-door', logoutSafe: false,
            preconditions: allOf(started, inArenaCheck),
            run: ctx => arenaDoor(ctx),
            postconditions: allOf(notInArena, s => (prayerActive(s, 'protect_from_melee') ? 'Protect from Melee still on' : true)),
        },
        {
            letter: 'K', label: 'lady-reward', logoutSafe: true,
            preconditions: allOf(notInArena, slots('K')),
            run: ctx => reward(ctx, opts),
            postconditions: exitCheck,
            done: o => complete(o) && !stateOf(o).inventory.some(isDead),
        },
    ];
    return questSteps(stepId, segs);
}

/** The entry's postconditions: the quest complete, Thieving 57 from the reward, out by Lady Servil, nothing open, the keys gone. */
export const exitCheck: Check<any> = allOf(
    s => (questStatus(s, quest) === 'complete' ? true : `Fight Arena is ${questStatus(s, quest)}, not complete`),
    baseLevels({ thieving: 57 }),
    within(LADY_AREA, 'Lady Servil\'s cart'),
    s => (s.dialog.isOpen || s.modalOpen ? 'a dialogue or modal is still open' : true),
    s => {
        const held = s.inventory.filter(isDead);
        return held.length ? `exit: still holding ${held.map(i => i.name).join(', ')}` : true;
    },
);

/** For tests and the lab: the observation `done` checks read. */
export function observed(state: BotWorldState, journal?: Pick<QuestJournalState, 'title' | 'lines'>): Observed {
    return { state, probed: journal ? { [JOURNAL]: { open: false, tick: state.tick, ...journal } } : {} };
}

