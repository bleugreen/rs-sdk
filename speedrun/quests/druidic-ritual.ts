// Druidic Ritual: STEP-MANIFEST.md entry 22 (S24's second quest), docs/speedrun/quests/druidic_ritual.md.
//
// From the arrival tile beside Kaqemeex at Taverley's stone circle (L24a ends at 2924,3486 tol 1)
// to the quest complete beside him again (L24b starts there), in nine segments lettered D1-D9 (S24
// carries three quests): Kaqemeex's start, up to Sanfew, Sanfew, down into Taverley Dungeon to the
// cauldron's prison door, the four meats dipped, back up to Sanfew, the meats handed over, back to
// Kaqemeex, the reward.
//
// What the content does (server/content/scripts):
// - Kaqemeex (areas/area_taverly/scripts/kaqemeex.rs2): "I'm in search of a quest.", then "Ok, I
//   will try and help." sets %druidquest 1 (:76). At 3 his one page queues the completion (:94,
//   quest_druid.rs2:1-6: 250 base Herblore, 4 QP), which queues his 15-page Herblore tutorial
//   (:8-12); the tutorial is closed, not read: nothing on the route needs it.
// - Sanfew stands upstairs in his house (2897,3426 level 1; spiral stairs at 2898,3428). At 1 he
//   sets 2 (sanfew.rs2:40); at 2 he takes the four enchanted meats and sets 3 (:56-64).
// - The Cauldron of Thunder (2893,9831, quest_druid.rs2:14-37) enchants one raw meat a use, only at
//   stage 2. The enchanted meats are untradeable, so SCORED dips them itself; H20 brings the raw
//   ones. Its prison door (2889,9830-9831) opened from the west first wakes the two suits of
//   armour beside it, one an open, and only the third open lets the player through (prison_doors.rs2:
//   the door teleports them onto its tile). The suits fight back; at S24's levels they are harmless.
// - %druidquest is scope=perm. The quest tab shows started and complete; stages 2 and 3 come from
//   the journal probe or from the meats held (raw, then enchanted, then none).

import type { BotWorldState, QuestJournalState } from '../../sdk/types';
import { opLoc, useOn } from '../lib/act';
import { clickContinue } from '../lib/dialogue';
import { journalProbeName, questDone, questStatus, requireQuestStage, type QuestView } from '../lib/quests';
import type { Area } from '../lib/travel';
import { currentTick, waitUntil } from '../lib/wait';
import { invCount, messagesSince, pos, replyAfter } from '../lib/world';
import type { Check, Observed, StepContext } from '../runner/step';
import { allOf, inBox, questSteps, slotsCover, within, type Box, type QuestItem, type QuestOptions, type Segment } from './segments';
import { interrupts, near, questMoves } from './small-quest';

export const quest = 'druid' as const;
export const stepId = 'S24';

export type Options = QuestOptions;

const m = questMoves(stepId);

// ------------------------------------------------------------------ places and things

/** L24a's landing: Kaqemeex (runner/legs.ts T.kaqemeex). */
export const ARRIVAL = { x: 2924, z: 3486, tol: 1 } as const;
const KAQEMEEX_AT = { x: 2924, z: 3486 } as const;
const KAQEMEEX_RE = /^kaqemeex$/i;
export const STONE_CIRCLE = near(KAQEMEEX_AT, 6);
export const KAQEMEEX_STAND: Area = { x: 2924, z: 3486, tol: 2 };

/** Sanfew upstairs (npc 454 at 2897,3426 level 1) and his spiral stairs (2898,3428). */
const SANFEW_AT = { x: 2897, z: 3426 } as const;
const SANFEW_RE = /^sanfew$/i;
export const SANFEW_UP: Box = { x0: 2893, z0: 3423, x1: 2902, z1: 3432, level: 1 };
export const STAIRS = { x: 2898, z: 3428 } as const;
/** The ground floor tile beside the stairs. */
export const STAIRS_FOOT: Area = { x: 2898, z: 3427, tol: 1 };

/** Taverley Dungeon: its ladder down at (2884,3397) lands beside the ladder up at (2884,9797). */
export const LADDER_TOP = { x: 2884, z: 3397 } as const;
export const LADDER_TOP_STAND: Area = { x: 2884, z: 3398, tol: 1 };
export const LADDER_BOTTOM = { x: 2884, z: 9797 } as const;
export const LADDER_BOTTOM_STAND: Area = { x: 2884, z: 9798, tol: 1 };
/** The prison doors (cauldrondoor_l 2889,9830; cauldrondoor 2889,9831); west of x 2889 is outside. */
export const DOOR = { x: 2889, z: 9831 } as const;
export const DOOR_OUT: Area = { x: 2888, z: 9831, tol: 1 };
export const CAULDRON = { x: 2893, z: 9831, id: 2142 } as const;
/** The cauldron room, east of the prison doors. */
export const CAULDRON_ROOM: Box = { x0: 2889, z0: 9826, x1: 2898, z1: 9836 };
export const DUNGEON: Box = { x0: 2860, z0: 9780, x1: 2900, z1: 9840 };

const underground = (s: BotWorldState) => pos(s).z > 9000;
const inRoom = (s: BotWorldState) => inBox(s, CAULDRON_ROOM);

const MEATS = [
    { raw: /^raw rat meat$/i, dipped: /^enchanted rat$/i, name: 'raw rat meat' },
    { raw: /^raw bear meat$/i, dipped: /^enchanted bear$/i, name: 'raw bear meat' },
    { raw: /^raw beef$/i, dipped: /^enchanted beef$/i, name: 'raw beef' },
    { raw: /^raw chicken$/i, dipped: /^enchanted chicken$/i, name: 'raw chicken' },
] as const;

export const LETTERS = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9'] as const;
type Letter = (typeof LETTERS)[number];

/** The raw meats (H20's) go in the cauldron at D5, which adds their enchanted forms, taken at D7. */
export const QUEST_ITEMS: readonly QuestItem[] = MEATS.flatMap(x => [
    { item: x.raw, name: x.name, from: 'D1', until: 'D5' },
    { item: x.dipped, name: x.name.replace(/^raw /, 'enchanted '), from: 'D5', until: 'D7' },
]);

export const SHAPES = {
    /** kaqemeex.rs2:1-5, :43-56, :73-78: hello, his question, the quest, his two pages on the circle, the yes and his reply. */
    start: '2c, opt, 4c, opt, 3c',
    /** sanfew.rs2:1-3, :24-26, :34-51: his question, the ritual, his two pages (stage 2 after them), the last choice, two lines. */
    sanfew: '1c, opt, 3c, opt, 2c',
    /** sanfew.rs2:53-66: the meats asked for, given (stage 3 after the fourth page), sent back to Kaqemeex. */
    meats: '5c',
    /** kaqemeex.rs2:1-2, :91-94: hello and his one page, then the completion is queued. */
    reward: '2c',
} as const;

export const CHOICES = {
    start: [/^I'm in search of a quest/i, /^Ok, I will try and help/i],
    sanfew: [/^I've been sent to help purify/i, /^Ok, I'll do that then/i],
};

/** Kaqemeex's queued tutorial (quest_druid.rs2:8-12, kaqemeex.rs2:97-112). */
const TUTORIAL = /fundamentals of Herblore|Herblore is the skill|vial|Guam leaf|Attack potion|Council|Good luck with your Herblore|Thanks for your help/i;

// ------------------------------------------------------------------ resume evidence

const JOURNAL = journalProbeName(quest);
const stateOf = (o: QuestView): BotWorldState => ('probed' in o ? o.state : o);
const atLeast = (o: QuestView, stage: 'started' | 'spoken_sanfew' | 'given_ingredients' | 'complete') => requireQuestStage(o, quest, stage, { atLeast: true }) === true;
const count = (o: QuestView, p: RegExp) => invCount(stateOf(o), p);
const allDipped = (o: QuestView) => MEATS.every(x => count(o, x.dipped) > 0);
const noMeat = (o: QuestView) => MEATS.every(x => count(o, x.raw) === 0 && count(o, x.dipped) === 0);
/** Dipped: the four enchanted meats held, or handed over (started, none of either form left). */
const dipped = (o: QuestView) => atLeast(o, 'started') && (allDipped(o) || noMeat(o));
/** Given: started and no meat of either form (Sanfew takes the enchanted ones; nothing else spends the raw). */
const given = (o: QuestView) => atLeast(o, 'started') && noMeat(o);

// ------------------------------------------------------------------ moves

const onLevel = (lvl: number) => (s: BotWorldState) => pos(s).level === lvl && !underground(s);

/**
 * From the stone circle the SDK route swings east round the circle and enters Sanfew's house from
 * the east (m: 55 ticks to his room); the way back runs straight down the west side through his
 * west door (m: 41). These are that way's tiles (the lab's trace).
 */
export const CIRCLE_TO_SANFEW = [{ x: 2913, z: 3483 }, { x: 2898, z: 3475 }, { x: 2896, z: 3459 }, { x: 2893, z: 3443 }, { x: 2892, z: 3435 }] as const;

async function upToSanfew(ctx: StepContext<any>, seg: Letter, fromCircle: boolean): Promise<void> {
    const sdk = m.sdkOf(ctx);
    if (inBox(sdk.getState()!, SANFEW_UP)) return;
    await m.go(ctx, seg, STAIRS_FOOT, "Sanfew's stairs", fromCircle && inBox(sdk.getState()!, STONE_CIRCLE) ? CIRCLE_TO_SANFEW : undefined);
    await m.locMove(ctx, seg, "Sanfew's stairs up", { ...STAIRS, op: /^climb-up$/i }, onLevel(1), 20, /^climb-up$/i);
}

async function downFromSanfew(ctx: StepContext<any>, seg: Letter): Promise<void> {
    const sdk = m.sdkOf(ctx);
    if (pos(sdk).level !== 1) return;
    await m.locMove(ctx, seg, "Sanfew's stairs down", { ...STAIRS, op: /^climb-down$/i }, onLevel(0), 20, /^climb-down$/i);
}

/** Through the prison doors: from the west each open wakes a suit until both are up, then lets the player through. */
async function prisonDoor(ctx: StepContext<any>, seg: Letter, inward: boolean): Promise<void> {
    const sdk = m.sdkOf(ctx);
    const passed = (s: BotWorldState) => (inward ? inRoom(s) : underground(s) && !inRoom(s));
    const t0 = currentTick(sdk);
    let clicks = 0;
    let suits = 0;
    while (!passed(sdk.getState()!) && clicks < 6) {
        clicks++;
        // Taken just before the click: the browser stamps the suit's message on the click's own tick
        // and lite on the next, so no tick offset tells this open's reply from the last one's on both
        // (m: the browser run missed open 2's at sent + 1).
        const reply = replyAfter(sdk, /suit of armour comes to life/i);
        const woke = reply.seen;
        const r = await opLoc(sdk, { x: DOOR.x, z: DOOR.z, name: /^prison door$/i, op: /^open$/i, radius: 12 }, /^open$/i, s => passed(s) || woke(s), { maxTicks: 12, resendEvery: 0, interrupts: interrupts() });
        if (r.ok && woke(sdk.getState()!) && !passed(sdk.getState()!)) suits++;
        else if (!r.ok) m.fail(seg, `the prison door: no answer within 12 ticks of open ${clicks}`, sdk);
    }
    if (!passed(sdk.getState()!)) m.fail(seg, `the prison door: not through after ${clicks} opens`, sdk);
    m.note(ctx, seg, { door: inward ? 'in' : 'out', clicks, suitsWoken: suits, ticks: currentTick(sdk) - t0 });
}

async function toCauldron(ctx: StepContext<any>): Promise<void> {
    const sdk = m.sdkOf(ctx);
    if (underground(sdk.getState()!)) return;
    await downFromSanfew(ctx, 'D4');
    await m.go(ctx, 'D4', LADDER_TOP_STAND, 'the Taverley Dungeon ladder');
    await m.locMove(ctx, 'D4', 'the dungeon ladder down', { ...LADDER_TOP, op: /^climb-down$/i }, underground, 20, /^climb-down$/i);
}

/** D5: to the prison door, through it, and each raw meat used on the cauldron. */
async function cauldron(ctx: StepContext<any>): Promise<void> {
    const sdk = m.sdkOf(ctx);
    const raw = () => MEATS.filter(x => invCount(sdk, x.raw) > 0);
    if (!raw().length) return;
    if (!inRoom(sdk.getState()!)) {
        await m.go(ctx, 'D5', DOOR_OUT, "the cauldron's prison door");
        await prisonDoor(ctx, 'D5', true);
    }
    const t0 = currentTick(sdk);
    for (const x of raw()) {
        const r = await useOn(sdk, x.raw, { loc: { ...CAULDRON } }, s => invCount(s, x.dipped) > 0 && invCount(s, x.raw) === 0, { maxTicks: 15 });
        if (!r.ok) m.fail('D5', `${x.name} on the cauldron: ${r.reason}`, sdk);
    }
    m.note(ctx, 'D5', { dips: MEATS.length, dipTicks: currentTick(sdk) - t0 });
}

async function backToSanfew(ctx: StepContext<any>): Promise<void> {
    const sdk = m.sdkOf(ctx);
    if (underground(sdk.getState()!)) {
        if (inRoom(sdk.getState()!)) await prisonDoor(ctx, 'D6', false);
        await m.go(ctx, 'D6', LADDER_BOTTOM_STAND, 'the dungeon ladder');
        await m.locMove(ctx, 'D6', 'the dungeon ladder up', { ...LADDER_BOTTOM, op: /^climb-up$/i }, s => !underground(s), 20, /^climb-up$/i);
    }
    await upToSanfew(ctx, 'D6', false);
}

/**
 * D9: Kaqemeex's one page, the completion, then what it opens: the Herblore level-up page is
 * answered; his queued tutorial and the quest scroll are closed (one close a page set, never read).
 */
async function reward(ctx: StepContext<any>, opts: Options | undefined): Promise<void> {
    const sdk = m.sdkOf(ctx);
    if (questStatus(sdk.getState()!, quest) !== 'complete') {
        const r = await m.talk(ctx, 'D9', opts, { who: 'Kaqemeex (reward)', npc: KAQEMEEX_RE, near: KAQEMEEX_AT, shape: SHAPES.reward });
        const t0 = currentTick(sdk);
        const since = r.startTick;
        const levelMsg = (s: BotWorldState) => messagesSince(s, since, /^Congratulations, you just advanced/i).length > 0;
        let closes = 0;
        let answers = 0;
        let quiet = 0;
        let lastSent = -1;
        // Settled once complete, the level-up seen, and nothing open for two ticks running.
        await waitUntil(sdk, s => {
            const open = s.dialog.isOpen || s.modalOpen;
            if (!open) {
                quiet = questStatus(s, quest) === 'complete' && levelMsg(s) ? quiet + 1 : 0;
                return quiet >= 2;
            }
            quiet = 0;
            if (s.tick === lastSent || s.dialog.isWaiting) return false;
            lastSent = s.tick;
            const text = s.dialog.isOpen ? (s.recentDialogs?.[0]?.text.join(' ') ?? '') : '';
            if (s.dialog.isOpen && /just advanced|Congratulations/i.test(text) && !TUTORIAL.test(text)) {
                answers++;
                void clickContinue(sdk);
            } else {
                closes++;
                void sdk.sendCloseModal();
            }
            return false;
        }, { maxTicks: 30 });
        if (questStatus(sdk.getState()!, quest) !== 'complete') m.fail('D9', 'Druidic Ritual not complete after Kaqemeex', sdk);
        m.note(ctx, 'D9', { completion: true, levelUpAnswers: answers, closes, ticks: currentTick(sdk) - t0 });
    }
}

// ------------------------------------------------------------------ checks

const need = (what: string, ok: boolean, why: string): true | string => (ok ? true : `${what}: ${why}`);
const atCircle = within(STONE_CIRCLE, "Kaqemeex's stone circle");
const upstairs = within(SANFEW_UP, "Sanfew's upstairs room");
const notComplete: Check<any> = s => (questStatus(s, quest) === 'complete' ? `${stepId}: Druidic Ritual is already complete` : true);
const rawHeld: Check<any> = s => {
    const short = MEATS.filter(x => invCount(s, x.raw) === 0 && invCount(s, x.dipped) === 0).map(x => x.name);
    return short.length ? `H20's Druidic Ritual meats: no ${short.join(', ')}` : true;
};
const dippedHeld: Check<any> = s => {
    const short = MEATS.filter(x => invCount(s, x.dipped) === 0).map(x => x.name.replace(/^raw /, 'enchanted '));
    return short.length ? `not held: ${short.join(', ')}` : true;
};
/** Started and not complete, from the quest tab (the sub-stages need the journal; this check does not). */
const inProgress: Check<any> = s => (questStatus(s, quest) === 'started' ? true : `Druidic Ritual: ${questStatus(s, quest) ?? 'unknown'}, not in progress`);
const overground: Check<any> = s => need('position', !underground(s), 'in Taverley Dungeon');
const inDungeon: Check<any> = s => need('position', inBox(s, DUNGEON), `not in Taverley Dungeon (at ${pos(s).x},${pos(s).z})`);

// ------------------------------------------------------------------ the segments

export function steps(opts?: Options) {
    const slots = (at: Letter) => slotsCover(QUEST_ITEMS, LETTERS, at);
    const probes = [JOURNAL] as const;
    const segs: Segment[] = [
        {
            letter: 'D1', label: 'kaqemeex-start', logoutSafe: true,
            preconditions: allOf(atCircle, notComplete, rawHeld, slots('D1')),
            run: async ctx => {
                if (questStatus(ctx.sdk.getState()!, quest) !== 'not_started') return;
                await m.talk(ctx, 'D1', opts, { who: 'Kaqemeex (start)', npc: KAQEMEEX_RE, near: KAQEMEEX_AT, choices: CHOICES.start, shape: SHAPES.start });
            },
            postconditions: s => requireQuestStage(s, quest, 'started', { atLeast: true }),
            done: o => atLeast(o, 'started'),
        },
        {
            letter: 'D2', label: 'to-sanfew', logoutSafe: true,
            preconditions: allOf(inProgress, overground, rawHeld),
            run: ctx => upToSanfew(ctx, 'D2', true),
            postconditions: upstairs,
        },
        {
            letter: 'D3', label: 'sanfew', logoutSafe: true,
            preconditions: allOf(upstairs, inProgress, rawHeld),
            run: ctx => m.talk(ctx, 'D3', opts, { who: 'Sanfew (the ritual)', npc: SANFEW_RE, near: SANFEW_AT, choices: CHOICES.sanfew, shape: SHAPES.sanfew }).then(() => undefined),
            done: o => atLeast(o, 'spoken_sanfew') || dipped(o),
            probes,
        },
        {
            letter: 'D4', label: 'to-cauldron', logoutSafe: true,
            preconditions: allOf(inProgress, rawHeld),
            run: ctx => toCauldron(ctx),
            postconditions: inDungeon,
        },
        {
            letter: 'D5', label: 'cauldron', logoutSafe: true,
            preconditions: allOf(inDungeon, inProgress, rawHeld, slots('D5')),
            run: ctx => cauldron(ctx),
            postconditions: dippedHeld,
            done: dipped,
        },
        {
            letter: 'D6', label: 'to-sanfew-meats', logoutSafe: true,
            preconditions: allOf(inProgress, dippedHeld),
            run: ctx => backToSanfew(ctx),
            postconditions: upstairs,
        },
        {
            letter: 'D7', label: 'sanfew-meats', logoutSafe: true,
            preconditions: allOf(upstairs, inProgress, dippedHeld),
            run: ctx => m.talk(ctx, 'D7', opts, { who: 'Sanfew (the meats)', npc: SANFEW_RE, near: SANFEW_AT, shape: SHAPES.meats }).then(() => undefined),
            postconditions: s => need('enchanted meats', MEATS.every(x => invCount(s, x.dipped) === 0), 'still held'),
            done: given,
        },
        {
            letter: 'D8', label: 'to-kaqemeex', logoutSafe: true,
            preconditions: allOf(inProgress, overground, s => need('meats', given(s), 'not handed to Sanfew')),
            run: async ctx => {
                await downFromSanfew(ctx, 'D8');
                await m.go(ctx, 'D8', KAQEMEEX_STAND, 'Kaqemeex');
            },
            postconditions: atCircle,
        },
        {
            letter: 'D9', label: 'kaqemeex-reward', logoutSafe: true,
            preconditions: allOf(atCircle, s => (questStatus(s, quest) === 'complete' ? true : allOf(inProgress, s2 => need('meats', given(s2), 'not handed to Sanfew'))(s, undefined))),
            run: ctx => reward(ctx, opts),
            postconditions: allOf(s => requireQuestStage(s, quest, 'complete'), atCircle, s => (s.dialog.isOpen || s.modalOpen ? 'a dialogue or modal is still open' : true)),
            done: o => questDone(quest)(o),
        },
    ];
    return questSteps(stepId, segs);
}

/** For tests and the lab: the observation `done` checks read, with the journal probe's reading. */
export function observed(state: BotWorldState, journal?: Pick<QuestJournalState, 'title' | 'lines'>): Observed {
    return { state, probed: journal ? { [JOURNAL]: { open: false, tick: state.tick, ...journal } } : {} };
}
