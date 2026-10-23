// Dwarf Cannon: STEP-MANIFEST.md entry 12 (S13), the multicannon unlock.
//
// From the arrival tile beside Commander Lawgof (legs.ts T12-13 ends at 2571,3463 tol 1) to the
// quest complete, back beside Lawgof. Twelve segments, A-L, in the order the content fixes
// (docs/speedrun/quests/dwarf_cannon.md "Step list", the route of quest-mcannon-run.ts):
// railings, the watchtower's remains, the goblin cave's crate, the shed's cannon, Nulodion at the
// Black Guard base (Falador teleport), and Lawgof again (Ardougne teleport). Every varp is
// scope=perm (quest_mcannon.varp), so every segment is logout-safe.
//
// What the content does that this module is built around (server/content/scripts/quests/
// quest_mcannon):
// - Railings (railings.rs2): each try is Inspect, two p_delay(2), a choice, if_close, p_delay(2),
//   then `stat_random(crafting, 60, 150)`: 61/256 at Crafting 1, the level SCORED arrives at. A
//   failure hits for min(3, base HP / 10). At ~42 HP the six railings' ~19 expected failures are
//   more than the HP, so the loop eats before a try whenever HP is at or below three failures'
//   damage, and refuses a try that one failure could kill. A fixed railing says "You have already
//   fixed this railing.", and every railing says "I've fixed all these railings now." from stage
//   2 on, so the loop is its own resume.
// - The broken cannon (mcannon_broken_cannon.rs2): the first inspect is a chat page (stage 7);
//   each later inspect rolls to find a problem (smithing 80-300 or crafting 80-350: 53% at 1/1)
//   and offers a 5-way menu; each fix rolls again. A part already fixed says so, which makes the
//   loop resumable too. With all four bits the next inspect says it is in working order (stage 8).
// - Lawgof's "repaired" dialogue closes (if_close, two p_delay(1)) while he looks into the shed
//   and reopens: the conversation is answered again if it ends before the choice.
// - Stages 1 and 2 have no marker in quest-stages.ts, but the journal tells them apart
//   (mcannon_journal.rs2:11-35): the `done` checks read those phrases through the
//   `journal:mcannon` probe.

import type { BotWorldState, QuestJournalState } from '../../sdk/types';
import { dropItems, invOp, opLoc, openDoor, pickup, talkTo, type ActSdk } from '../lib/act';
import { converse, levelUpInterrupt, type ConverseResult, type ConverseSdk } from '../lib/converse';
import { pageText, type OptionPattern } from '../lib/dialogue';
import type { ItemPattern } from '../lib/items';
import { JOURNAL_FRESH_TICKS, journalProbeName, questDone, questStatus, requireQuestStage, type QuestView, type StageName } from '../lib/quests';
import { CROSSING_HITPOINTS, crossFromKandarin, crossingRestTarget, crossToKandarin, type Traveller } from '../lib/kandarin';
import { logNote } from '../lib/ticks';
import { addRunes, FOOD, inArea, missingRunes, runTo, runeUseOf, spellUse, SPELLS, teleport, type Area, type RuneUseTable, type Spell, type TravelSdk } from '../lib/travel';
import { currentTick, waitOrThrow, waitTicks, waitUntil, type StateSource } from '../lib/wait';
import { chebyshev, findNpc, invCount, invItem, pos, replyAfter, skillLevel, type LocQuery } from '../lib/world';
import type { Check, Observed, StepContext } from '../runner/step';
import { allOf, questSteps, slotsCover, stageAtLeast, talkShape, within, type QuestItem, type QuestOptions, type Segment } from './segments';

export const quest = 'mcannon' as const;
export const stepId = 'S13';

export interface Options extends QuestOptions {
    /** Eat before a railing try at or below this HP. Default: three failures' damage (9 at 30+ base HP). */
    eatAt?: number;
    /** What to eat (default travel.ts FOOD, the usual cooked fish). */
    food?: ItemPattern;
    /** Food held at the start, segment A's precondition (default MIN_FOOD). */
    minFood?: number;
    /** Counters the segments add to (railing tries, shed rolls, eats, damage, lowest HP), for the lab's report. */
    tally?: Tally;
    /**
     * true (default, the run): Falador teleport to Nulodion and Ardougne teleport back. false: walk
     * both ways over White Wolf Mountain (lib/kandarin.ts), for an account without Magic 51 or Plague
     * City, such as a demo throwaway; it needs CROSSING_HITPOINTS instead.
     */
    teleports?: boolean;
}

/**
 * Food the run must hold at the arrival tile: H10's 8 sharks (main, 22:08). The lab measured 34-143
 * railing damage over six chains at 42 HP and up to 6 sharks eaten (rs/257).
 */
export const MIN_FOOD = 8;

/**
 * Tick budgets for the loops that keep the clock moving (wait.ts's idle timeout never fires while
 * they tick): six railings at the measured 19% would take 65 tries at p99, ~820 ticks; the shed at
 * Smithing and Crafting 1 measured 117-276.
 */
export const RAILINGS_MAX_TICKS = 1800;
export const SHED_MAX_TICKS = 900;

// ------------------------------------------------------------------ places and things

/** Commander Lawgof's spawn: legs.ts T12-13 lands within 1 of it. */
export const LAWGOF = { x: 2571, z: 3463 } as const;
export const ARRIVAL: Area = { ...LAWGOF, tol: 1 };
/** Where the walks to Lawgof stop (quest-mcannon-run.ts). */
const LAWGOF_STAND: Area = { x: 2571, z: 3461, tol: 2 };
/** The Black Guard camp around Lawgof, the railings and the shed, for position checks by coordinates. */
export const CAMP = { x0: 2550, z0: 3452, x1: 2585, z1: 3480 } as const;
const LAWGOF_RE = /^dwarf commander$|lawgof/i;

/** Railings mcannonrailing1-6 (loc ids 15-20; bits 5-10 of %mcannonmulti), in the route's order: it ends beside Lawgof. */
export const RAILINGS: ReadonlyArray<{ x: number; z: number; id: number }> = [
    { x: 2556, z: 3475, id: 15 }, { x: 2558, z: 3472, id: 16 }, { x: 2557, z: 3464, id: 17 },
    { x: 2559, z: 3462, id: 18 }, { x: 2564, z: 3460, id: 19 }, { x: 2572, z: 3460, id: 20 },
];
const TOWER_FOOT: Area = { x: 2570, z: 3442, tol: 1 };
const TOWER_LADDER = { x: 2570, z: 3441 } as const;
const CAVE_DOOR: Area = { x: 2623, z: 3394, tol: 2 };
const CRATE = { x: 2571, z: 9850 } as const;
const CRATE_STAND: Area = { x: 2571, z: 9849, tol: 1 };
const MUD_PILE: Area = { x: 2620, z: 9797, tol: 1 };
const SHED_DOOR = { x: 2576, z: 3461 } as const;
const NULODION_DOOR = { x: 3015, z: 3453 } as const;
const NULODION_STAND: Area = { x: 3016, z: 3453, tol: 1 };
/** The Black Guard base's hut and the ground outside its door. */
const BASE = { x0: 3005, z0: 3445, x1: 3022, z1: 3460 } as const;
const NULODION_RE = /^nulodion$/i;
const YOUNGSTER_RE = /^dwarf youngster$/i;

const inCave = (s: BotWorldState | null) => !!s?.player && s.player.worldZ > 9000;
const near = (s: BotWorldState | null, b: { x0: number; z0: number; x1: number; z1: number }) =>
    !!s?.player && s.player.level === 0 && s.player.worldX >= b.x0 && s.player.worldX <= b.x1 && s.player.worldZ >= b.z0 && s.player.worldZ <= b.z1;

const TOOLKIT = /^tool kit$/i;
const NOTES = /^nulodion's notes/i;
const MOULD = /^ammo mould$/i;

/** The segment letters in order, for the free-slot need. */
export const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'] as const;

/**
 * What the content hands the step (quest_mcannon), for the free-slot checks: peak 6 at A-B, 3 at K.
 * The quest scroll's cannonball is a picture, not a reward (quest_mcannon.rs2 send_quest_complete).
 */
export const QUEST_ITEMS: readonly QuestItem[] = [
    // lawgof2.rs2:40 gives six (unstackable); railings.rs2:82 takes one a success.
    { item: /^railing$/i, name: 'Railing', n: 6, from: 'A', until: 'B' },
    // the watchtower's floor 2; lawgof2.rs2:84 takes them.
    { item: /^dwarf remains$/i, name: 'Dwarf remains', from: 'D', until: 'E' },
    // lawgof2.rs2:121; never taken back.
    { item: TOOLKIT, name: 'Tool kit', from: 'H' },
    // nulodion.rs2:22-23; lawgof2.rs2:201-202 takes both.
    { item: NOTES, name: "Nulodion's notes", from: 'K', until: 'L' },
    { item: MOULD, name: 'Ammo mould', from: 'K', until: 'L' },
];
const slots = (at: (typeof LETTERS)[number]) => slotsCover(QUEST_ITEMS, LETTERS, at);

/**
 * What S13 leaves that nothing later uses, dropped at its exit (rs/158's slot ledger). Of the
 * quest's items only the tool kit outlives it: Lawgof takes the notes and the mould
 * (lawgof2.rs2:201-202) and the completion gives nothing. The spare law and water runes are
 * T13-14's Ardougne teleport, and H10 tops the sharks up from what is held.
 */
export const DEAD_AT_EXIT: readonly RegExp[] = [TOOLKIT];
const dead = (i: { name: string }) => DEAD_AT_EXIT.some(p => p.test(i.name));

/** Runes the module casts from the arrival tile: Falador to Nulodion, Ardougne back to Lawgof. T12-13's Ardougne cast is the leg's. */
export const RUNES = addRunes(SPELLS.falador.runes, SPELLS.ardougne.runes);

/** RUNES by segment (lib/travel.ts RuneUseTable): Falador at K, Ardougne at L. No worn staff supplies any of them. */
export const RUNE_USE: RuneUseTable = { K: spellUse('falador'), L: spellUse('ardougne') };

/** What A's travelNeeds wants held: both casts' runes. */
export const RUNE_NEED: RuneUseTable = { A: runeUseOf(RUNES) };

// ------------------------------------------------------------------ conversations (CONVENTIONS.md shapes, read from the scripts)

export const SHAPES = {
    /** lawgof2.rs2:17-42. */
    start: '4c, opt, 6c',
    /** :44-58, all six bits set. */
    railingsDone: '9c',
    /** :71-92, holding the remains. */
    remains: '12c',
    /** dwarfchildtw1.rs2:4-9. */
    lollk: '5c',
    /** lawgof2.rs2:106-126. */
    toolkit: '7c, opt, 2c',
    /** :142-173: the fourth page is followed by if_close and two p_delay(1) while he looks into the shed. */
    repaired: '3c, state, 6c, opt, 4c',
    /** nulodion.rs2:15-29. */
    nulodion: '8c',
    /** lawgof2.rs2:182-203. */
    complete: '12c',
} as const;

// ------------------------------------------------------------------ the tally

/** What the segments did, for the lab report (rs/158 prices the railings and food from it). */
export interface Tally {
    railingTries: number;
    railingFails: number;
    /** Railings found already fixed (a resumed segment B). */
    railingsSkipped: number;
    shedInspects: number;
    /** Inspects that could not find the problem. */
    shedFindFails: number;
    shedFixTries: number;
    shedFixFails: number;
    eats: number;
    /** Ticks from each eat click to the HP rise, summed. */
    eatTicks: number;
    /** HP lost (sum of every drop seen) and the lowest HP seen, during the railings. */
    damage: number;
    minHp: number;
}

export function newTally(): Tally {
    return { railingTries: 0, railingFails: 0, railingsSkipped: 0, shedInspects: 0, shedFindFails: 0, shedFixTries: 0, shedFixFails: 0, eats: 0, eatTicks: 0, damage: 0, minHp: Infinity };
}

// ------------------------------------------------------------------ resume evidence

const JOURNAL = journalProbeName(quest);
const compact = (t: string) => t.replace(/@[a-z0-9]{3}@/gi, '').replace(/\s+/g, '');

/** mcannon_journal.rs2: stage 1 with every railing fixed, or stage 2 before the remains. */
export const J_RAILINGS_DONE = 'Ihaverepairedallthebrokenrailings';
/** Stage 2 without the remains. */
export const J_TOWER = 'checkuponhisguards';
/** Stage 2 holding the remains. */
export const J_REMAINS = 'foundsomedwarf';

/** The Dwarf Cannon journal's text (compacted), from the resume probe or a journal open in the last few ticks; null when neither. */
export function journalText(o: QuestView): string | null {
    const probed = 'probed' in o ? o.probed[JOURNAL] : undefined;
    const s = 'probed' in o ? o.state : o;
    const fresh = s.questJournal && (s.questJournal.open || s.tick - s.questJournal.tick <= JOURNAL_FRESH_TICKS) ? s.questJournal : null;
    const j = (probed && typeof probed === 'object' && 'lines' in probed ? (probed as QuestJournalState) : null) ?? fresh;
    if (!j || compact(j.title) !== 'DwarfCannon') return null;
    return compact(j.lines.join(''));
}

const says = (o: QuestView, ...phrases: string[]) => {
    const t = journalText(o);
    return t !== null && phrases.some(p => t.includes(p));
};
const atLeast = (o: QuestView, stage: StageName<'mcannon'>) => requireQuestStage(o, quest, stage, { atLeast: true }) === true;
const stateOf = (o: QuestView) => ('probed' in o ? o.state : o);
const holds = (o: QuestView, item: ItemPattern) => invCount(stateOf(o), item) > 0;

// ------------------------------------------------------------------ helpers

type Ctx = StepContext<any>;
const sdkOf = (ctx: Ctx) => ctx.sdk as unknown as TravelSdk & ActSdk & ConverseSdk;
const interrupts = () => [levelUpInterrupt()];

/** Run to `to`, retrying a run that ends short ('no tick', a stall): ok only inside the area. */
async function go(ctx: Ctx, to: Area, what: string): Promise<void> {
    const sdk = sdkOf(ctx);
    let why = '';
    for (let i = 0; i < 3; i++) {
        if (inArea(sdk, to)) return;
        const r = await runTo(sdk, to, { bot: ctx.bot });
        if (r.ok) return;
        why = r.reason ?? 'not arrived';
    }
    if (!inArea(sdk, to)) throw new Error(`${what}: run to ${to.x},${to.z} failed (${why}) at ${JSON.stringify(pos(sdk))}`);
}

/**
 * Within this many tiles of a teleport's landing, a re-run segment's cast has already landed. K's walk
 * from the Falador landing to the Black Guard base stays within ~82 of it; the segments start ~400
 * (K, the camp) and ~350 (L, the base) tiles from their landings, so a fresh segment always casts.
 */
const LANDED_WITHIN = 90;

/**
 * Cast `spell` and confirm the landing; a refusal is final, a lost tick is re-cast only if the player has not landed.
 * Near the landing (a segment re-run after its cast landed, on the landing or partway on from it) it casts nothing: the runes are spent.
 */
async function cast(ctx: Ctx, spell: Spell): Promise<void> {
    const sdk = sdkOf(ctx);
    const landing = SPELLS[spell].landing;
    if (chebyshev(pos(sdk), landing) <= LANDED_WITHIN) return;
    let why = '';
    for (let i = 0; i < 2; i++) {
        const r = await teleport(sdk, spell, { walkOnRefusal: false });
        if (r.ok || inArea(sdk, landing)) return;
        why = r.reason ?? 'not landed';
        if (/refused/i.test(why) || r.segments.some(s => /runes short|below|Wilderness/i.test(s.note ?? ''))) break;
    }
    throw new Error(`${spell} teleport failed: ${why}`);
}

/** The walk over White Wolf Mountain, with its retries and crossing settings, logging into the step's TickLog. */
function traveller(ctx: Ctx): Traveller {
    return {
        bot: ctx.bot as unknown as Traveller['bot'],
        sdk: ctx.sdk as unknown as Traveller['sdk'],
        log: (message, data) => logNote(ctx.log, ctx.session, `${stepId}:walk`, { message, ...data }),
        checkSignal: () => {},
    };
}

const walking = (opts: Options | undefined) => opts?.teleports === false;

/** Talk to Lawgof from wherever the segment stands, answering `choices`; the conversation must open and end well. */
async function lawgof(ctx: Ctx, opts: Options | undefined, choices: OptionPattern[], shape: string): Promise<ConverseResult> {
    const sdk = sdkOf(ctx);
    if (chebyshev(pos(sdk), LAWGOF) > 4 || !findNpc(sdk, LAWGOF_RE)) await go(ctx, LAWGOF_STAND, 'to Lawgof');
    const r = await talkTo(sdk, LAWGOF_RE, choices, { openTicks: 40, near: LAWGOF, interrupts: interrupts(), ...talkShape(opts, shape) });
    if (!r.opened) throw new Error('Lawgof: no dialogue opened');
    if (!r.ok) throw new Error(`Lawgof: ${r.reason}`);
    return r;
}

/** Op a loc and wait for `done`. */
async function op(ctx: Ctx, q: LocQuery, option: string | RegExp, done: (s: BotWorldState) => boolean, what: string, maxTicks = 30): Promise<void> {
    const r = await opLoc(sdkOf(ctx), q, option, done, { maxTicks, interrupts: interrupts() });
    if (!r.ok) throw new Error(`${what}: no effect within ${maxTicks} ticks at ${JSON.stringify(pos(ctx.sdk))}`);
}

/**
 * Op a loc whose script prints `started` at once and only opens its dialogue or prints its result
 * after p_delays: the railings' Inspect (two p_delay(2) before the choice) and the cannon's (p_delay(3)
 * before the menu). The click counts as landed on `started`, so act.ts's re-send after 6 idle ticks
 * cannot fire into the delays: on the demo the railing choice opened 6-7 ticks after the click, the
 * re-sent Inspect restarted the search and closed the choice it had opened, and the 'Try' click
 * landed on nothing (rs/257's demo trace). Then waits for `ready` without clicking again. False
 * when the op itself took no effect (a shut door in front of the shed's cannon). Every reply is a
 * replyAfter taken before the click: the browser stamps a reply one tick lower than lite, so a
 * tick filter missed the browser's immediate reply and every roll that opens no dialogue waited
 * out `maxTicks`.
 */
async function opStarted(ctx: Ctx, q: LocQuery, option: string | RegExp, started: Reply, ready: (s: BotWorldState) => boolean, what: string, maxTicks = 40): Promise<boolean> {
    const sdk = sdkOf(ctx);
    const r = await opLoc(sdk, q, option, s => ready(s) || started.seen(s), { maxTicks, interrupts: interrupts() });
    if (!r.ok) return false;
    await waitOrThrow(sdk, ready, 15, `${what}: the dialogue after the op`);
    return true;
}

type Reply = ReturnType<typeof replyAfter>;

/** Wait for `reply` (a replyAfter taken before its click); returns its first message. */
async function message(sdk: StateSource, reply: Reply, maxTicks: number, what: string): Promise<string> {
    await waitOrThrow(sdk, reply.seen, maxTicks, what);
    return reply.first()!;
}

/** One failed railing's damage (railings.rs2:87-90). */
export function railingDamage(baseHp: number): number {
    return Math.min(3, Math.floor(baseHp / 10));
}

const baseHp = (s: BotWorldState | null) => s?.skills.find(k => k.name.toLowerCase() === 'hitpoints')?.baseLevel ?? s?.player?.hp ?? 0;

/** The default eat threshold: three failures' damage, so no streak between eats can reach 0. */
export function defaultEatAt(baseHpLevel: number): number {
    return 3 * railingDamage(baseHpLevel);
}

/** Eat one `food` and wait for HP to rise above `hp`; throws if it does not. */
async function eatOne(sdk: ActSdk & StateSource, food: ItemPattern, hp: number, tally: Tally, what: string): Promise<void> {
    const t0 = currentTick(sdk);
    const r = await invOp(sdk, food, /^eat$/i, st => (st.player?.hp ?? 0) > hp, { maxTicks: 8, resendEvery: 3, maxResends: 2 });
    if (!r.ok) throw new Error(`${what}: eating at HP ${hp} did not raise it`);
    tally.eats++;
    tally.eatTicks += currentTick(sdk) - t0;
}

/**
 * Before a railing try: eat while HP is at or below `eatAt`. Refuses (throws) a try that one
 * failure could kill when there is no food left: a death here costs the run far more than a stop.
 */
async function eatIfLow(ctx: Ctx, opts: Options | undefined, tally: Tally): Promise<void> {
    const sdk = sdkOf(ctx);
    const food = opts?.food ?? FOOD;
    const s = sdk.getState();
    const dmg = railingDamage(baseHp(s));
    const eatAt = opts?.eatAt ?? defaultEatAt(baseHp(s));
    for (let i = 0; i < 4; i++) {
        const hp = sdk.getState()?.player?.hp ?? 0;
        if (hp > eatAt) return;
        if (!invItem(sdk, food)) {
            if (hp <= dmg) throw new Error(`railings: HP ${hp} and no food: one failure (${dmg}) could kill`);
            return;
        }
        await eatOne(sdk, food, hp, tally, 'railings');
    }
}

/**
 * Before a White Wolf Mountain crossing: eat up to the HP kandarin.ts's restForCrossing would
 * otherwise stand still for, one point every 100 ticks. The walk out to Nulodion leaves a 30 HP
 * throwaway on 11-14, and the walk back started there and died (rs/257 execution 2, 1 of 2 runs).
 * With no food left the crossing's own rest takes over.
 */
export async function eatForCrossing(sdk: ActSdk & StateSource, food: ItemPattern, tally: Tally): Promise<void> {
    const target = crossingRestTarget(baseHp(sdk.getState()));
    for (let i = 0; i < 4; i++) {
        const hp = sdk.getState()?.player?.hp ?? 0;
        if (hp >= target || !invItem(sdk, food)) return;
        await eatOne(sdk, food, hp, tally, 'crossing');
    }
}

// ------------------------------------------------------------------ segment runs

const ALREADY_FIXED_RAILING = /already fixed this railing/i;
const RAILING_SEARCH = /^You search the railing/i;
const ALL_RAILINGS_FIXED = /fixed all these railings/i;
const RAILING_RESULT = /no problems|fail and cut/i;

/** Segment B: the six railings, each tried until it holds. */
async function railings(ctx: Ctx, opts: Options | undefined, tally: Tally): Promise<void> {
    const sdk = sdkOf(ctx);
    let lastHp = sdk.getState()?.player?.hp ?? 0;
    tally.minHp = Math.min(tally.minHp, lastHp);
    const stop = sdk.onStateUpdate(s => {
        const hp = s.player?.hp;
        if (hp === undefined) return;
        if (hp < lastHp) tally.damage += lastHp - hp;
        lastHp = hp;
        tally.minHp = Math.min(tally.minHp, hp);
    });
    const deadline = currentTick(sdk) + RAILINGS_MAX_TICKS;
    try {
        for (const r of RAILINGS) {
            for (let attempt = 0; ; attempt++) {
                if (attempt >= 60) throw new Error(`railing at ${r.x},${r.z}: 60 tries without a success`);
                if (currentTick(sdk) > deadline) throw new Error(`railings: over ${RAILINGS_MAX_TICKS} ticks (${tally.railingTries} tries)`);
                await eatIfLow(ctx, opts, tally);
                // Taken before the click: the last try's messages must not count.
                const started = replyAfter(sdk, RAILING_SEARCH);
                const skipped = replyAfter(sdk, ALREADY_FIXED_RAILING);
                const result = replyAfter(sdk, RAILING_RESULT);
                const where = `railing at ${r.x},${r.z}`;
                const landed = await opStarted(ctx, { x: r.x, z: r.z, id: r.id, radius: 25 }, 'Inspect', started, s => s.dialog.isOpen || skipped.seen(s), where);
                if (!landed) throw new Error(`${where}: no effect within 40 ticks at ${JSON.stringify(pos(sdk))}`);
                if (skipped.first()) {
                    tally.railingsSkipped++;
                    break;
                }
                const d = sdk.getState()!.dialog;
                if (ALL_RAILINGS_FIXED.test(pageText(d))) {
                    // Stage 2 or later: every railing is done.
                    await converse(sdk, [], { idle: 1 });
                    return;
                }
                const c = await converse(sdk, ['Try to replace the railing.'], { idle: 1 });
                if (!c.ok || c.options !== 1) throw new Error(`railing at ${r.x},${r.z}: the choice was not answered (${c.reason ?? `${c.options} options`})`);
                tally.railingTries++;
                if (/no problems/i.test(await message(sdk, result, 20, `railing result at ${r.x},${r.z}`))) {
                    // railings.rs2: p_delay(2) before the bit is set; a click inside it is dropped.
                    await waitTicks(sdk, 3);
                    break;
                }
                tally.railingFails++;
            }
        }
    } finally {
        stop();
    }
}

/** Climb a tower ladder with `option`; a ladder offering both ways may ask first. */
async function climb(ctx: Ctx, option: RegExp, answer: RegExp, level: number): Promise<void> {
    const sdk = sdkOf(ctx);
    const there = (s: BotWorldState) => pos(s).level === level;
    const q: LocQuery = level === 1 && pos(sdk).level === 0 ? { x: TOWER_LADDER.x, z: TOWER_LADDER.z, name: /ladder/i, radius: 20 } : { name: /ladder/i, op: option, radius: 8 };
    await op(ctx, q, option, s => there(s) || s.dialog.isOpen, `ladder to level ${level}`, 20);
    if (sdk.getState()!.dialog.isOpen) await converse(sdk, [answer], { until: there, interrupts: interrupts() });
    await waitOrThrow(sdk, there, 20, `tower level ${level}`);
}

async function downTower(ctx: Ctx): Promise<void> {
    while (pos(ctx.sdk).level > 0) await climb(ctx, /climb-down/i, /climb down/i, pos(ctx.sdk).level - 1);
}

const REMAINS = /^dwarf remains$/i;

/** Segment D: up the watchtower, the remains, down again. Starts from any floor. */
async function watchtower(ctx: Ctx): Promise<void> {
    const sdk = sdkOf(ctx);
    if (!invItem(sdk, REMAINS)) {
        if (pos(sdk).level === 0) {
            await go(ctx, TOWER_FOOT, 'to the watchtower');
            await climb(ctx, /climb-up/i, /climb up/i, 1);
        }
        if (pos(sdk).level === 1) await climb(ctx, /climb-up/i, /climb up/i, 2);
        const r = await pickup(sdk, REMAINS, { maxTicks: 20 });
        if (!r.ok) throw new Error('watchtower: the remains did not reach the inventory');
    }
    await downTower(ctx);
}

async function enterCave(ctx: Ctx): Promise<void> {
    await go(ctx, CAVE_DOOR, 'to the goblin cave');
    await op(ctx, { name: /cave entrance/i, radius: 8 }, 'Enter', s => inCave(s), 'into the cave');
}

/** Segment G: the crate frees Lollk, who talks (stage 5). From outside the cave it enters first. */
async function lollk(ctx: Ctx, opts: Options | undefined): Promise<void> {
    const sdk = sdkOf(ctx);
    if (!inCave(sdk.getState())) await enterCave(ctx);
    await go(ctx, CRATE_STAND, 'to the crate');
    const nothing = replyAfter(sdk, /find nothing/i);
    const empty = replyAfter(sdk, /it's empty/i);
    await op(ctx, { x: CRATE.x, z: CRATE.z, name: /crate/i, radius: 20 }, 'Search', s => s.dialog.isOpen || nothing.seen(s) || empty.seen(s), 'the crate');
    if (empty.first()) throw new Error('crate: empty, so the quest is not at stage 4');
    // mcannon_crate.rs2: Lollk already out (a resumed segment) leaves the crate empty-handed; talk to him.
    const r = nothing.first()
        ? await talkTo(sdk, YOUNGSTER_RE, [], { interrupts: interrupts(), ...talkShape(opts, SHAPES.lollk) })
        : await converse(sdk, [], { interrupts: interrupts(), ...talkShape(opts, SHAPES.lollk) });
    if (!r.ok) throw new Error(`Lollk: ${r.reason}`);
}

const CANNON_INSPECTING = /^You inspect the multi cannon/i;
const CANNON_FIX = /manage to fix it|fail to fix it|already fixed this part|need a tool kit/i;
const PARTS = ['Pipe', 'Barrel', 'Axle', 'Shaft'] as const;

/** Segment I: inspect the broken cannon and fix its four parts in turn, until it is in working order. */
async function shed(ctx: Ctx, opts: Options | undefined, tally: Tally): Promise<void> {
    const sdk = sdkOf(ctx);
    await openDoor(sdk, SHED_DOOR.x, SHED_DOOR.z);
    let part = 0;
    const deadline = currentTick(sdk) + SHED_MAX_TICKS;
    for (let i = 0; i < 80; i++) {
        if (currentTick(sdk) > deadline) throw new Error(`cannon: over ${SHED_MAX_TICKS} ticks (${part} parts fixed)`);
        const started = replyAfter(sdk, CANNON_INSPECTING);
        const contraption = replyAfter(sdk, /strange dwarf contraption/i);
        const notFound = replyAfter(sdk, /can't quite find/i);
        const fix = replyAfter(sdk, CANNON_FIX);
        const landed = await opStarted(ctx, { name: /broken multicannon/i, radius: 10 }, 'Inspect', started, s => s.dialog.isOpen || contraption.seen(s) || notFound.seen(s), 'cannon');
        if (!landed) {
            // The shed door shut in front of the bot (dwarf_cannon.md "The shed door").
            await openDoor(sdk, SHED_DOOR.x, SHED_DOOR.z);
            continue;
        }
        if (contraption.first()) return; // stage 8 or later
        tally.shedInspects++;
        if (notFound.first()) {
            tally.shedFindFails++;
            continue;
        }
        const d = sdk.getState()!.dialog;
        if (d.options.length > 1) {
            if (part >= PARTS.length) throw new Error('cannon: every part fixed and the menu still offered');
            const c = await converse(sdk, [PARTS[part]!], { idle: 1 });
            if (!c.ok || c.options !== 1) throw new Error(`cannon: the part choice was not answered (${c.reason ?? `${c.options} options`})`);
            tally.shedFixTries++;
            const m = await message(sdk, fix, 15, 'part fix result');
            if (/need a tool kit/i.test(m)) throw new Error('cannon: no tool kit');
            if (/manage to fix it|already fixed this part/i.test(m)) {
                part++;
                if (/manage to fix it/i.test(m)) await waitTicks(sdk, 3); // p_delay(2) after a fix
            } else tally.shedFixFails++;
            continue;
        }
        const working = /working order/i.test(pageText(d));
        // The first inspect's chat page (stage 7) is followed at once by the next inspect.
        await converse(sdk, [], working ? { interrupts: interrupts() } : { idle: 1 });
        if (working) return;
    }
    throw new Error(`cannon: not repaired after 80 inspects (${part} parts)`);
}

/** Segment J: Lawgof's "repaired" dialogue, answered again if it ends at his look into the shed. */
async function repaired(ctx: Ctx, opts: Options | undefined): Promise<void> {
    const sdk = sdkOf(ctx);
    const choice = 'Ok then, just for you!';
    let r = await lawgof(ctx, opts, [choice], SHAPES.repaired);
    for (let i = 0; i < 2 && r.options === 0; i++) {
        const more = await converse(sdk, r.remaining, { openTicks: 8, interrupts: interrupts(), ...talkShape(opts, '6c, opt, 4c') });
        if (!more.ok) throw new Error(`Lawgof (repaired): ${more.reason}`);
        r = more;
    }
    if (r.options === 0) throw new Error('Lawgof (repaired): the choice never came');
}

/** Segment K: Falador teleport (or the walk), the Black Guard base, Nulodion's notes and mould (stage 10). */
async function nulodion(ctx: Ctx, opts: Options | undefined, tally: Tally): Promise<void> {
    const sdk = sdkOf(ctx);
    if (!near(sdk.getState(), BASE)) {
        if (walking(opts)) {
            await eatForCrossing(sdk, opts?.food ?? FOOD, tally);
            await crossFromKandarin(traveller(ctx), NULODION_STAND, 'the Black Guard base');
        } else await cast(ctx, 'falador');
        await go(ctx, NULODION_STAND, 'to the Black Guard base');
    }
    await openDoor(sdk, NULODION_DOOR.x, NULODION_DOOR.z);
    const r = await talkTo(sdk, NULODION_RE, [], { openTicks: 30, interrupts: interrupts(), ...talkShape(opts, SHAPES.nulodion) });
    if (!r.opened || !r.ok) throw new Error(`Nulodion: ${r.reason ?? 'no dialogue opened'}`);
}

/**
 * Segment L: Ardougne teleport (or the walk), Lawgof takes the notes and mould, the quest completes;
 * its scroll and level-up pages are closed and the dead items dropped. Resumed after the quest
 * completed, it only drops.
 */
async function complete(ctx: Ctx, opts: Options | undefined, tally: Tally): Promise<void> {
    const sdk = sdkOf(ctx);
    if (questStatus(sdk.getState()!, quest) !== 'complete') {
        if (!near(sdk.getState(), CAMP)) {
            if (walking(opts)) {
                await eatForCrossing(sdk, opts?.food ?? FOOD, tally);
                await crossToKandarin(traveller(ctx), LAWGOF_STAND, 'Lawgof');
            } else await cast(ctx, 'ardougne');
        }
        await lawgof(ctx, opts, [], SHAPES.complete);
        await waitOrThrow(sdk, s => questStatus(s, quest) === 'complete', 10, 'Dwarf Cannon complete');
        // The reward's level-up pages and the quest scroll (a modal).
        await converse(sdk, [], { openTicks: 2, idle: 1, closeModals: true, interrupts: interrupts() });
        if (sdk.getState()?.modalOpen) {
            await sdk.sendCloseModal();
            await waitUntil(sdk, s => !s.modalOpen, { maxTicks: 3 });
        }
    }
    const r = await dropItems(sdk, dead);
    if (!r.ok) throw new Error(`exit: the dead items (${(sdk.getState()?.inventory ?? []).filter(dead).map(i => i.name).join(', ')}) were not dropped`);
}

// ------------------------------------------------------------------ checks

const runesHeld: Check<any> = s => missingRunes(s, RUNES) ?? true;
const magic51: Check<any> = s => (skillLevel(s, 'magic') >= SPELLS.ardougne.magic ? true : `Magic ${skillLevel(s, 'magic')} is below ${SPELLS.ardougne.magic} for the Ardougne teleport`);
const foodHeld = (opts: Options | undefined): Check<any> => s => {
    const n = invCount(s, opts?.food ?? FOOD);
    const want = opts?.minFood ?? MIN_FOOD;
    return n >= want ? true : `food: ${n} held, the railings want ${want}`;
};
const notStarted: Check<any> = s => requireQuestStage(s, quest, 'not_started');
const crossingHp: Check<any> = s => (baseHp(s) >= CROSSING_HITPOINTS ? true : `Hitpoints ${baseHp(s)} is below ${CROSSING_HITPOINTS} for the White Wolf Mountain walk`);
/** The teleports' needs, or the walk's. */
const travelNeeds = (opts: Options | undefined): Check<any> => (walking(opts) ? crossingHp : allOf(stageAtLeast('elena', 'complete'), magic51, runesHeld));
const inCamp = within({ ...CAMP }, 'the Black Guard camp');
const noDeadItems: Check<any> = s => {
    const held = (s as BotWorldState).inventory.filter(dead);
    return held.length ? `exit: still holding ${held.map(i => i.name).join(', ')}` : true;
};

// ------------------------------------------------------------------ the segments

export function steps(opts?: Options) {
    const tally = opts?.tally ?? newTally();
    const probes = [JOURNAL] as const;
    const segs: Segment[] = [
        {
            letter: 'A', label: 'lawgof-start', logoutSafe: true,
            preconditions: allOf(within({ x0: ARRIVAL.x - 1, z0: ARRIVAL.z - 1, x1: ARRIVAL.x + 1, z1: ARRIVAL.z + 1 }, 'the arrival tile beside Lawgof'), notStarted, travelNeeds(opts), foodHeld(opts), slots('A')),
            run: async ctx => { await lawgof(ctx, opts, ["Yeah, I'd love to help."], SHAPES.start); },
            postconditions: stageAtLeast(quest, 'tasked_with_fixing_railings'),
            done: o => atLeast(o, 'tasked_with_fixing_railings'),
        },
        {
            letter: 'B', label: 'railings', logoutSafe: true,
            run: ctx => railings(ctx, opts, tally),
            done: o => atLeast(o, 'tasked_with_finding_goblin_cave') || says(o, J_RAILINGS_DONE, J_TOWER, J_REMAINS),
            probes,
        },
        {
            letter: 'C', label: 'lawgof-railings', logoutSafe: true,
            run: async ctx => { await lawgof(ctx, opts, [], SHAPES.railingsDone); },
            done: o => atLeast(o, 'tasked_with_finding_goblin_cave') || says(o, J_TOWER, J_REMAINS),
            probes,
        },
        {
            letter: 'D', label: 'watchtower', logoutSafe: true,
            preconditions: slots('D'),
            run: ctx => watchtower(ctx),
            postconditions: s => (invItem(s, REMAINS) ? true : 'no dwarf remains held'),
            done: o => atLeast(o, 'tasked_with_finding_goblin_cave') || holds(o, REMAINS) || says(o, J_REMAINS),
            probes,
        },
        {
            letter: 'E', label: 'lawgof-remains', logoutSafe: true,
            run: async ctx => { await downTower(ctx); await lawgof(ctx, opts, [], SHAPES.remains); },
            done: o => atLeast(o, 'tasked_with_finding_goblin_cave'),
            probes,
        },
        {
            letter: 'F', label: 'goblin-cave', logoutSafe: true,
            run: ctx => enterCave(ctx),
            done: o => atLeast(o, 'tasked_with_finding_gilobs_son'),
            probes,
        },
        {
            letter: 'G', label: 'lollk', logoutSafe: true,
            run: ctx => lollk(ctx, opts),
            done: o => atLeast(o, 'return_to_dwarf_commander'),
            probes,
        },
        {
            letter: 'H', label: 'lawgof-toolkit', logoutSafe: true,
            preconditions: slots('H'),
            run: async ctx => {
                if (inCave(ctx.sdk.getState())) {
                    await go(ctx, MUD_PILE, 'to the mud pile');
                    await op(ctx, { name: /mud pile/i, radius: 8 }, 'Climb-over', s => !inCave(s), 'out of the cave');
                }
                await lawgof(ctx, opts, ["Ok, I'll see what I can do."], SHAPES.toolkit);
            },
            postconditions: s => (invItem(s, TOOLKIT) ? true : 'no tool kit held'),
            done: o => atLeast(o, 'tasked_with_fixing_cannon'),
            probes,
        },
        {
            letter: 'I', label: 'shed', logoutSafe: true,
            run: ctx => shed(ctx, opts, tally),
            done: o => atLeast(o, 'has_repaired_cannon'),
            probes,
        },
        {
            letter: 'J', label: 'lawgof-repaired', logoutSafe: true,
            run: ctx => repaired(ctx, opts),
            done: o => atLeast(o, 'tasked_with_speaking_to_nulodion'),
            probes,
        },
        {
            letter: 'K', label: 'nulodion', logoutSafe: true,
            preconditions: slots('K'),
            run: ctx => nulodion(ctx, opts, tally),
            postconditions: s => (invItem(s, NOTES) && invItem(s, MOULD) ? true : 'the notes and mould are not both held'),
            done: o => questDone(quest)(o) || (atLeast(o, 'return_to_dwarf_commander_with_notes') && holds(o, NOTES) && holds(o, MOULD)),
            probes,
        },
        {
            letter: 'L', label: 'lawgof-complete', logoutSafe: true,
            run: ctx => complete(ctx, opts, tally),
            postconditions: allOf(stageAtLeast(quest, 'complete'), inCamp, s => (s.dialog.isOpen || s.modalOpen ? 'a dialogue or modal is still open' : true), noDeadItems),
            done: o => questDone(quest)(o) && !stateOf(o).inventory.some(dead),
        },
    ];
    return questSteps(stepId, segs);
}

/** For tests and the lab: the observation `done` checks read. */
export function observed(state: BotWorldState, journal?: Pick<QuestJournalState, 'title' | 'lines'>): Observed {
    return { state, probed: journal ? { [JOURNAL]: { open: false, tick: state.tick, ...journal } } : {} };
}
