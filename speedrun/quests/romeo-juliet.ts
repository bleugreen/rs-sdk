// Romeo & Juliet: STEP-MANIFEST.md entry 21 (S24's last quest), docs/speedrun/quests/romeo_juliet.md.
//
// From the arrival tile beside Romeo in Varrock Square (L24c ends at 3211,3425 tol 1) to the
// quest complete beside him again (T24-25 starts there), in six segments lettered R1-R6 (S24
// carries three quests), each the run to one NPC and the talk with them: Juliet, Romeo, Father
// Lawrence, the Apothecary, Juliet, Romeo. A resumed segment runs from wherever SCORED stands; its
// preconditions read the stage from the items held (the message, the berries, the potion), never
// from the position.
//
// What the content does (server/content/scripts/areas/area_varrock/scripts):
// - Juliet first, though the leg lands beside Romeo: at stage 0 her "I guess I could find him."
//   leads straight to her message (juliet.rs2:4, :49-64, %rjquest 0 -> 20), which skips Romeo's
//   opening talk (romeo.rs2:17-43, the 10 -> 20 step through her) and walks no further: the route
//   is Juliet, Romeo, the father, the Apothecary and Juliet either way.
// - Romeo at 20 takes the message (romeo.rs2:45-55, 30); Father Lawrence at 30 sends SCORED to the
//   Apothecary (father_lawrence.rs2:54-63, 40); the Apothecary at 40 asks for the berries (50) and
//   at 50 turns H20's cadava berries into the potion (apothecary.rs2:61-82), so he is talked to
//   twice; Juliet at 50 takes the potion (juliet.rs2:87-101, 60); Romeo at 60 queues the
//   completion (romeo.rs2:94-104, quest_romeojuliet.rs2: 5 QP, no xp).
// - Juliet is upstairs (3158,3425 level 1) in the house west of the square (stairs at 3156,3435).
// - %rjquest is scope=perm. The quest tab shows started and complete; the stages between come from
//   the journal probe (no marker on 50) and from the message, the berries and the potion held.

import type { BotWorldState, QuestJournalState } from '../../sdk/types';
import { journalProbeName, questDone, questStatus, requireQuestStage, type QuestView, type StageName } from '../lib/quests';
import type { Area } from '../lib/travel';
import { invCount, pos } from '../lib/world';
import type { Check, Observed, StepContext } from '../runner/step';
import { allOf, inBox, questSteps, slotsCover, within, type Box, type QuestItem, type QuestOptions, type Segment } from './segments';
import { openDoor } from '../lib/act';
import { interrupts, near, questMoves, type TalkSpec } from './small-quest';

export const quest = 'romeojuliet' as const;
export const stepId = 'S24';

export type Options = QuestOptions;

const m = questMoves(stepId);

// ------------------------------------------------------------------ places and things

/** L24c's landing: Romeo (runner/legs.ts T.romeo); he wanders round the square. */
export const ARRIVAL = { x: 3211, z: 3425, tol: 1 } as const;
const ROMEO_AT = { x: 3211, z: 3425 } as const;
export const SQUARE = near(ROMEO_AT, 10);
export const ROMEO_STAND: Area = { x: 3211, z: 3425, tol: 3 };

const JULIET_AT = { x: 3158, z: 3425 } as const;
export const JULIET_STAIRS = { x: 3156, z: 3435 } as const;
export const JULIET_STAIRS_FOOT: Area = { x: 3157, z: 3434, tol: 1 };
/**
 * Juliet's house (maps/m49_53): the stairs room (z 3433-3439) has a door in its north wall at
 * (3160,3440), 53 route tiles from Romeo; the garden side reaches only the kitchen, whose door into
 * the stairs room the SDK pathfinder does not route through from outside (m: "I can't reach
 * that!"). The SDK route stops at a closed door, so the runs go through these tiles, and the run
 * opens the door it stalls at.
 */
export const INTO_JULIETS = [{ x: 3160, z: 3441 }, { x: 3160, z: 3439 }] as const;
export const OUT_OF_JULIETS = [{ x: 3160, z: 3439 }, { x: 3160, z: 3441 }] as const;
/**
 * Upstairs, two doors part the landing (3156,3433) from Juliet's room (z 3424-3426): (3156,3431),
 * then (3159,3427). Each is opened by name and tile (act.ts openDoor: nothing if already open), in
 * order going in and in reverse going out; a run's stall rule opens the nearest door, which upstairs
 * is not always the one in the way (m: 50 ticks stalled at the second).
 */
export const UPSTAIRS_DOORS = [{ x: 3156, z: 3431 }, { x: 3159, z: 3427 }] as const;
/** Her house's ground floor, inside the walls (the kitchen and the stairs room). */
export const JULIETS_HOUSE: Box = { x0: 3156, z0: 3428, x1: 3163, z1: 3439 };
export const JULIET_UP: Box = { x0: 3150, z0: 3418, x1: 3166, z1: 3440, level: 1 };

const LAWRENCE_AT = { x: 3254, z: 3475 } as const;
export const LAWRENCE_STAND: Area = { x: 3254, z: 3477, tol: 2 };
export const CHURCH = near(LAWRENCE_AT, 8);

const APOTHECARY_AT = { x: 3195, z: 3404 } as const;
export const APOTHECARY_STAND: Area = { x: 3195, z: 3405, tol: 2 };
export const APOTHECARY_HOUSE = near(APOTHECARY_AT, 5);

const NPC = { romeo: /^romeo$/i, juliet: /^juliet$/i, lawrence: /^father lawrence$/i, apothecary: /^apothecary$/i } as const;
const ITEM = { message: /^message$/i, berries: /^cadava berries$/i, potion: /^cadava potion$/i } as const;

export const LETTERS = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6'] as const;
type Letter = (typeof LETTERS)[number];

/** Juliet's message (R1 to R2), H20's berries (to R4, where they become the potion), the potion (R4 to R5). Peak 1: the ledger's S24 need. */
export const QUEST_ITEMS: readonly QuestItem[] = [
    { item: ITEM.message, name: 'Message', from: 'R1', until: 'R2' },
    { item: ITEM.berries, name: 'Cadava berries', from: 'R1', until: 'R4' },
    { item: ITEM.potion, name: 'Cadava potion', from: 'R4', until: 'R5' },
];

export const SHAPES = {
    /** juliet.rs2:21-24, :49-51, :56-64: her three pages, "I guess I could find him.", two of hers, the agreement, her reply and the mesbox. */
    juliet: '3c, opt, 6c',
    /** romeo.rs2:45-55: the line, the mesbox (the message goes), his five pages. */
    romeo: '7c',
    /** father_lawrence.rs2:54-63. */
    lawrence: '7c',
    /** apothecary.rs2:84-93 at 40: two lines, his five pages (m: 7; one long line wraps onto a page of its own). */
    apothecaryAsk: '7c',
    /** apothecary.rs2:61-73 at 50: the berries become the potion after the first mesbox. */
    apothecaryBrew: '4c',
    /** juliet.rs2:87-101: two lines, the mesbox (the potion goes), her four pages. */
    potion: '7c',
    /** romeo.rs2:94-104: the completion is queued after his last page. */
    finish: '7c',
} as const;

export const CHOICES = { juliet: [/^I guess I could find him/i] };

// ------------------------------------------------------------------ resume evidence

const JOURNAL = journalProbeName(quest);
const stateOf = (o: QuestView): BotWorldState => ('probed' in o ? o.state : o);
const atLeast = (o: QuestView, stage: StageName<typeof quest>) => requireQuestStage(o, quest, stage, { atLeast: true }) === true;
const holds = (o: QuestView, item: RegExp) => invCount(stateOf(o), item) > 0;
/** Started with none of the three quest items left: the potion is with Juliet (60) or later. */
const late = (o: QuestView) => questStatus(stateOf(o), quest) !== 'not_started' && !holds(o, ITEM.message) && !holds(o, ITEM.berries) && !holds(o, ITEM.potion);
/**
 * At `stage` or later, for a `done` that must stay true as the quest goes on: the journal's reading,
 * else the items (the potion is held only from 50, and none of the three from 60).
 */
const past = (o: QuestView, stage: 'passed_message' | 'spoken_father' | 'juliet_crypt') =>
    atLeast(o, stage) || late(o) || (stage !== 'juliet_crypt' && holds(o, ITEM.potion));

// ------------------------------------------------------------------ moves

const onLevel = (lvl: number) => (s: BotWorldState) => pos(s).level === lvl;

async function upToJuliet(ctx: StepContext<any>, seg: Letter): Promise<void> {
    const sdk = m.sdkOf(ctx);
    if (!inBox(sdk.getState()!, JULIET_UP)) {
        const inside = inBox(sdk.getState()!, JULIETS_HOUSE);
        await m.go(ctx, seg, JULIET_STAIRS_FOOT, "Juliet's stairs", inside ? INTO_JULIETS.slice(1) : INTO_JULIETS);
        await m.locMove(ctx, seg, "Juliet's stairs up", { ...JULIET_STAIRS, op: /^climb-up$/i }, onLevel(1), 20, /^climb-up$/i);
    }
    for (const d of UPSTAIRS_DOORS) await door(ctx, seg, d);
}

async function door(ctx: StepContext<any>, seg: Letter, d: { x: number; z: number }): Promise<void> {
    const sdk = m.sdkOf(ctx);
    const r = await openDoor(sdk, d.x, d.z, { interrupts: interrupts() });
    if (!r.ok) m.fail(seg, `the door at ${d.x},${d.z}: not open within 30 ticks`, sdk);
    if (r.ticks) m.note(ctx, seg, { door: `${d.x},${d.z}`, ticks: r.ticks, resends: r.resends });
}

/** Down Juliet's stairs and out through her two doors to `to` (Romeo). */
async function fromJuliet(ctx: StepContext<any>, seg: Letter, to: Area, what: string): Promise<void> {
    const sdk = m.sdkOf(ctx);
    if (pos(sdk).level === 1) {
        for (const d of [...UPSTAIRS_DOORS].reverse()) await door(ctx, seg, d);
        await m.locMove(ctx, seg, "Juliet's stairs down", { ...JULIET_STAIRS, op: /^climb-down$/i }, onLevel(0), 20, /^climb-down$/i);
    }
    await m.go(ctx, seg, to, what, inBox(sdk.getState()!, JULIETS_HOUSE) ? OUT_OF_JULIETS : undefined);
}

const spec = (who: string, npc: RegExp, at: { x: number; z: number }, shape: string, choices: RegExp[] = []): TalkSpec => ({ who, npc, near: at, shape, choices });

/** R4: at 40 the Apothecary asks for the berries (50); a second talk at 50 brews the potion. */
async function apothecary(ctx: StepContext<any>, opts: Options | undefined): Promise<void> {
    const sdk = m.sdkOf(ctx);
    if (invCount(sdk, ITEM.potion) > 0) return;
    // The journal is not read here: at 40 the first talk asks (6 pages) and leaves no potion; at 50
    // it brews (4 pages). Either way a second talk follows only when no potion is held.
    await m.go(ctx, 'R4', APOTHECARY_STAND, 'the Apothecary');
    await m.talk(ctx, 'R4', opts, spec('the Apothecary (the berries)', NPC.apothecary, APOTHECARY_AT, SHAPES.apothecaryAsk));
    if (invCount(sdk, ITEM.potion) === 0) await m.talk(ctx, 'R4', opts, spec('the Apothecary (the potion)', NPC.apothecary, APOTHECARY_AT, SHAPES.apothecaryBrew));
    if (invCount(sdk, ITEM.potion) === 0) m.fail('R4', 'no cadava potion after two talks with the Apothecary', sdk);
}

async function finish(ctx: StepContext<any>, opts: Options | undefined): Promise<void> {
    if (questStatus(ctx.sdk.getState()!, quest) === 'complete') return;
    await fromJuliet(ctx, 'R6', ROMEO_STAND, 'Romeo');
    const r = await m.talk(ctx, 'R6', opts, spec('Romeo (the finish)', NPC.romeo, ROMEO_AT, SHAPES.finish));
    await m.completion(ctx, 'R6', quest, false, r.startTick);
}

// ------------------------------------------------------------------ checks

const need = (what: string, ok: boolean, why: string): true | string => (ok ? true : `${what}: ${why}`);
/** Started and not complete, from the quest tab (the sub-stages need the journal; this check does not). */
const inProgress: Check<any> = s => (questStatus(s, quest) === 'started' ? true : `Romeo & Juliet: ${questStatus(s, quest) ?? 'unknown'}, not in progress`);
const notComplete: Check<any> = s => (questStatus(s, quest) === 'complete' ? `${stepId}: Romeo & Juliet is already complete` : true);
const hasItem = (item: RegExp, what: string): Check<any> => s => need(what, invCount(s, item) > 0, 'not held');
const lacks = (item: RegExp, what: string): Check<any> => s => need(what, invCount(s, item) === 0, 'still held');
const atSquare = within(SQUARE, 'Varrock Square');
const upstairs = within(JULIET_UP, "Juliet's upstairs room");
const atChurch = within(CHURCH, "Father Lawrence's church");
const atApothecary = within(APOTHECARY_HOUSE, "the Apothecary's house");
/** Not started, the berries held: R1's entry; T.romeo's landing is checked by the leg, not here (a resumed R1 may stand anywhere on the way). */
const notStarted: Check<any> = s => (questStatus(s, quest) === 'not_started' ? true : 'Romeo & Juliet already started');
/** Past Romeo's 30, before the potion: the message gone, the berries held. */
const messagePassed = allOf(inProgress, lacks(ITEM.message, 'the message'), hasItem(ITEM.berries, 'the cadava berries'));

// ------------------------------------------------------------------ the segments

export function steps(opts?: Options) {
    const slots = (at: Letter) => slotsCover(QUEST_ITEMS, LETTERS, at);
    const probes = [JOURNAL] as const;
    const segs: Segment[] = [
        {
            letter: 'R1', label: 'juliet', logoutSafe: true,
            preconditions: allOf(notComplete, s => (holds(s, ITEM.message) ? true : notStarted(s, undefined)), hasItem(ITEM.berries, "H20's cadava berries"), slots('R1')),
            run: async ctx => {
                if (questStatus(ctx.sdk.getState()!, quest) !== 'not_started') return;
                await upToJuliet(ctx, 'R1');
                await m.talk(ctx, 'R1', opts, spec('Juliet (the message)', NPC.juliet, JULIET_AT, SHAPES.juliet, CHOICES.juliet));
            },
            postconditions: allOf(hasItem(ITEM.message, "Juliet's message"), upstairs),
            done: o => holds(o, ITEM.message) || past(o, 'passed_message'),
            probes,
        },
        {
            letter: 'R2', label: 'romeo-message', logoutSafe: true,
            preconditions: allOf(inProgress, hasItem(ITEM.message, "Juliet's message")),
            run: async ctx => {
                await fromJuliet(ctx, 'R2', ROMEO_STAND, 'Romeo');
                await m.talk(ctx, 'R2', opts, spec('Romeo (the message)', NPC.romeo, ROMEO_AT, SHAPES.romeo));
            },
            postconditions: allOf(lacks(ITEM.message, "Juliet's message"), atSquare),
            done: o => past(o, 'passed_message'),
            probes,
        },
        {
            letter: 'R3', label: 'lawrence', logoutSafe: true,
            preconditions: messagePassed,
            run: async ctx => {
                await m.go(ctx, 'R3', LAWRENCE_STAND, 'Father Lawrence');
                await m.talk(ctx, 'R3', opts, spec('Father Lawrence', NPC.lawrence, LAWRENCE_AT, SHAPES.lawrence));
            },
            postconditions: atChurch,
            done: o => past(o, 'spoken_father'),
            probes,
        },
        {
            letter: 'R4', label: 'apothecary', logoutSafe: true,
            preconditions: s => (invCount(s, ITEM.potion) > 0 ? true : messagePassed(s, undefined)),
            run: ctx => apothecary(ctx, opts),
            postconditions: allOf(hasItem(ITEM.potion, 'the cadava potion'), atApothecary),
            done: o => holds(o, ITEM.potion) || past(o, 'juliet_crypt'),
            probes,
        },
        {
            letter: 'R5', label: 'juliet-potion', logoutSafe: true,
            preconditions: allOf(inProgress, hasItem(ITEM.potion, 'the cadava potion')),
            run: async ctx => {
                await upToJuliet(ctx, 'R5');
                await m.talk(ctx, 'R5', opts, spec('Juliet (the potion)', NPC.juliet, JULIET_AT, SHAPES.potion));
            },
            postconditions: lacks(ITEM.potion, 'the cadava potion'),
            done: o => past(o, 'juliet_crypt'),
            probes,
        },
        {
            letter: 'R6', label: 'romeo-finish', logoutSafe: true,
            preconditions: s => (questStatus(s, quest) === 'complete' ? true : allOf(inProgress, lacks(ITEM.potion, 'the cadava potion'), lacks(ITEM.berries, 'the cadava berries'), lacks(ITEM.message, 'the message'))(s, undefined)),
            run: ctx => finish(ctx, opts),
            postconditions: allOf(s => requireQuestStage(s, quest, 'complete'), atSquare, s => (s.dialog.isOpen || s.modalOpen ? 'a dialogue or modal is still open' : true)),
            done: o => questDone(quest)(o),
        },
    ];
    return questSteps(stepId, segs);
}

/** For tests and the lab: the observation `done` checks read, with the journal probe's reading. */
export function observed(state: BotWorldState, journal?: Pick<QuestJournalState, 'title' | 'lines'>): Observed {
    return { state, probed: journal ? { [JOURNAL]: { open: false, tick: state.tick, ...journal } } : {} };
}
