// Goblin Diplomacy: STEP-MANIFEST.md entry 25 (S24's first quest), docs/speedrun/quests/goblin_diplomacy.md.
//
// S24 runs three quests under one step id. Goblin Diplomacy is split round the Taverley legs:
// its first part at the Rusty Anchor (T23-24 ends at the bartender, 3045,3257 tol 1), then L24a,
// Druidic Ritual and L24b, then its second part with the generals in Goblin Village (L24b ends
// at 2957,3511 tol 1), then L24c and Romeo & Juliet (runner/legs.ts). `steps({ part })` returns
// one part for run.ts to place between the legs; without `part` it returns both, in order.
// Segments are lettered G1-G6 so the three quests' names stay apart under S24.
//
// What the content does (server/content/scripts):
// - The bartender starts it: "Not very busy in here today, is it?" (bartender.rs2:18,
//   quest_gobdip.rs2:13-19, %goblinquest 0 -> 1).
// - The orange and blue goblin mails are untradeable (quest_gobdip.obj), so SCORED dyes two of
//   H20's three mails itself: a dye used on a mail (goblin_mail.rs2:1-12, no p_delay, no stage
//   check). Both uses go out in one tick, each on its own mail and dye slot, so the server's
//   slot check sees neither changed by the other.
// - The generals: General Wartface's Talk-to greets (3 pages: him, Bentnoze, him) and then
//   answers by stage (quest_gobdip.rs2:71-115): at 1 the third option sets 2; at 2, 3 and 4 the
//   orange, the blue and the plain mail go one a talk (3, 4, 5), and at 5 the completion is
//   queued (:58-65: 200 base Crafting, 5 QP, a gold bar, which H21a takes back later).
// - %goblinquest's sub-stages are not on the quest tab: will_bring_armour (2) comes from the
//   journal probe, the later ones from the mails held (each talk deletes the mail it takes).

import type { BotWorldState, QuestJournalState } from '../../sdk/types';
import { journalProbeName, questDone, questStatus, requireQuestStage, type QuestView } from '../lib/quests';
import { waitUntil } from '../lib/wait';
import { invCount } from '../lib/world';
import type { Check, Observed, StepContext } from '../runner/step';
import { allOf, questSteps, slotsCover, within, type QuestItem, type QuestOptions, type Segment } from './segments';
import { near, questMoves } from './small-quest';

export const quest = 'gobdip' as const;
export const stepId = 'S24';

export type Part = 'anchor' | 'village';
export interface Options extends QuestOptions {
    /** One part for the run chain: 'anchor' (G1-G2, before L24a) or 'village' (G3-G6, after L24b). Default both. */
    part?: Part;
}

const m = questMoves(stepId);

// ------------------------------------------------------------------ places and things

/** T23-24's landing: the Rusty Anchor's bartender (runner/legs.ts T.rustyAnchor). */
export const ARRIVAL = { x: 3045, z: 3257, tol: 1 } as const;
/** L24b's landing: the generals (runner/legs.ts T.goblinGenerals). */
export const VILLAGE_ARRIVAL = { x: 2957, z: 3511, tol: 1 } as const;
const BARTENDER_AT = { x: 3045, z: 3257 } as const;
const BARTENDER_RE = /^bartender$/i;
/** General Wartface (npc 297) at (2957,3511), Bentnoze beside him at (2958,3511) (maps). */
const WARTFACE_AT = { x: 2957, z: 3511 } as const;
const WARTFACE_RE = /^general wartface$/i;
export const RUSTY_ANCHOR = near(BARTENDER_AT, 6);
export const GENERALS = near(WARTFACE_AT, 6);

const ITEM = {
    mail: /^goblin mail$/i,
    orange: /^orange goblin mail$/i,
    blue: /^blue goblin mail$/i,
    orangeDye: /^orange dye$/i,
    blueDye: /^blue dye$/i,
    bar: /^gold bar$/i,
} as const;

export const LETTERS = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6'] as const;
type Letter = (typeof LETTERS)[number];
const PARTS: Readonly<Record<Part, readonly Letter[]>> = { anchor: ['G1', 'G2'], village: ['G3', 'G4', 'G5', 'G6'] };

/**
 * The free-slot model (brief addendum 8): H20's three mails and two dyes are already held; the dyes
 * are spent at G2, which adds the two dyed mails (taken at G4 and G5); the plain mail goes at G6,
 * which adds the gold bar. Conservative at G2 (the dyes' slots are credited only after it): 2.
 */
export const QUEST_ITEMS: readonly QuestItem[] = [
    { item: ITEM.orangeDye, name: 'Orange dye', from: 'G1', until: 'G2' },
    { item: ITEM.blueDye, name: 'Blue dye', from: 'G1', until: 'G2' },
    { item: ITEM.orange, name: 'Orange goblin mail', from: 'G2', until: 'G4' },
    { item: ITEM.blue, name: 'Blue goblin mail', from: 'G2', until: 'G5' },
    { item: ITEM.bar, name: 'Gold bar', from: 'G6' },
];

export const SHAPES = {
    /** bartender.rs2:10-18 opens on the choice; quest_gobdip.rs2:14-17: two lines each way. */
    bartender: 'opt, 4c',
    /** The greeting (3 pages), the stage-1 choice, the orange request (quest_gobdip.rs2:21-27: 5 pages). */
    request: '3c, opt, 5c',
    /** The greeting, "Oh it you.", the orange handed over and the three replies (:89-97, :29-36). */
    orange: '9c',
    /** The greeting, the blue handed over, the three replies and the player's line (:99-106, :38-47). */
    blue: '9c',
    /** The greeting, the plain mail handed over and the four replies; the completion is queued (:108-115, :49-58). */
    brown: '9c',
} as const;

export const CHOICES = {
    bartender: [/^Not very busy in here today/i],
    request: [/^Do you want me to pick an armour colour/i],
};

// ------------------------------------------------------------------ resume evidence

const JOURNAL = journalProbeName(quest);
const stateOf = (o: QuestView): BotWorldState => ('probed' in o ? o.state : o);
const atLeast = (o: QuestView, stage: 'started' | 'will_bring_armour' | 'complete') => requireQuestStage(o, quest, stage, { atLeast: true }) === true;
const holds = (o: QuestView, item: RegExp) => invCount(stateOf(o), item) > 0;
const started = (o: QuestView) => atLeast(o, 'started');
/** Dyed: both dyes spent (nothing else on the route uses them). */
const dyed = (o: QuestView) => started(o) && !holds(o, ITEM.orangeDye) && !holds(o, ITEM.blueDye);
/** Each dyed mail is gone only once a general took it. */
const orangeGiven = (o: QuestView) => dyed(o) && !holds(o, ITEM.orange);
const blueGiven = (o: QuestView) => orangeGiven(o) && !holds(o, ITEM.blue);

// ------------------------------------------------------------------ segment runs

async function bartender(ctx: StepContext<any>, opts: Options | undefined): Promise<void> {
    if (questStatus(ctx.sdk.getState()!, quest) !== 'not_started') return;
    await m.talk(ctx, 'G1', opts, { who: 'the bartender', npc: BARTENDER_RE, near: BARTENDER_AT, choices: CHOICES.bartender, shape: SHAPES.bartender });
}

/** G2: both dyes on two of the plain mails, sent in one tick; any use the server dropped is re-sent alone. */
async function dye(ctx: StepContext<any>): Promise<void> {
    const sdk = m.sdkOf(ctx);
    const t0 = sdk.getState()!.tick;
    const noDyes = (s: BotWorldState) => invCount(s, ITEM.orangeDye) === 0 && invCount(s, ITEM.blueDye) === 0;
    for (let attempt = 0; attempt < 3 && !noDyes(sdk.getState()!); attempt++) {
        const s = sdk.getState()!;
        const mails = s.inventory.filter(i => ITEM.mail.test(i.name));
        const dyes = [ITEM.orangeDye, ITEM.blueDye].map(d => s.inventory.find(i => d.test(i.name))).filter(i => i !== undefined);
        if (mails.length < dyes.length) m.fail('G2', `${dyes.length} dyes and ${mails.length} plain goblin mail`, sdk);
        dyes.forEach((d, k) => void sdk.sendUseItemOnItem(d.slot, mails[k]!.slot));
        await waitUntil(sdk, noDyes, { maxTicks: 3 });
    }
    if (!noDyes(sdk.getState()!)) m.fail('G2', 'the dyes were not used on the mail', sdk);
    m.note(ctx, 'G2', { dyeTicks: sdk.getState()!.tick - t0 });
}

const general = (who: string, shape: string, choices: RegExp[] = []) => async (ctx: StepContext<any>, seg: Letter, opts: Options | undefined) =>
    m.talk(ctx, seg, opts, { who, npc: WARTFACE_RE, near: WARTFACE_AT, choices, shape });

const request = general('General Wartface (the orange request)', SHAPES.request, CHOICES.request);
const giveOrange = general('General Wartface (the orange mail)', SHAPES.orange);
const giveBlue = general('General Wartface (the blue mail)', SHAPES.blue);
const giveBrown = general('General Wartface (the plain mail)', SHAPES.brown);

async function finish(ctx: StepContext<any>, opts: Options | undefined): Promise<void> {
    if (questStatus(ctx.sdk.getState()!, quest) === 'complete') return;
    const r = await giveBrown(ctx, 'G6', opts);
    await m.completion(ctx, 'G6', quest, true, r.startTick);
}

// ------------------------------------------------------------------ checks

/** Started and not complete, from the quest tab (the sub-stages need the journal; this check does not). */
const inProgress: Check<any> = s => (questStatus(s, quest) === 'started' ? true : `Goblin Diplomacy: ${questStatus(s, quest) ?? 'unknown'}, not in progress`);
const need = (what: string, ok: boolean, why: string): true | string => (ok ? true : `${what}: ${why}`);
const atAnchor = within(RUSTY_ANCHOR, 'the Rusty Anchor');
const atGenerals = within(GENERALS, "the generals' hut in Goblin Village");
const notComplete: Check<any> = s => (questStatus(s, quest) === 'complete' ? `${stepId}: Goblin Diplomacy is already complete` : true);
const h20: Check<any> = s => {
    const short = [
        invCount(s, ITEM.mail) + invCount(s, ITEM.orange) + invCount(s, ITEM.blue) < 3 ? 'goblin mail x3' : '',
        invCount(s, ITEM.orangeDye) + invCount(s, ITEM.orange) < 1 ? 'orange dye' : '',
        invCount(s, ITEM.blueDye) + invCount(s, ITEM.blue) < 1 ? 'blue dye' : '',
    ].filter(Boolean);
    return short.length ? `H20's Goblin Diplomacy items: short ${short.join(', ')}` : true;
};
const hasItem = (item: RegExp, what: string): Check<any> => s => need(what, invCount(s, item) > 0, 'not held');
const noLeftovers: Check<any> = s => {
    const left = [ITEM.mail, ITEM.orange, ITEM.blue, ITEM.orangeDye, ITEM.blueDye].filter(p => invCount(s, p) > 0).map(p => p.source.replace(/[\^$]/g, ''));
    return left.length ? `exit: still holding ${left.join(', ')}` : true;
};

// ------------------------------------------------------------------ the segments

export function steps(opts?: Options) {
    const slots = (at: Letter) => slotsCover(QUEST_ITEMS, LETTERS, at);
    const probes = [JOURNAL] as const;
    const segs: Segment[] = [
        {
            letter: 'G1', label: 'bartender', logoutSafe: true,
            preconditions: allOf(atAnchor, notComplete, h20, slots('G1')),
            run: ctx => bartender(ctx, opts),
            postconditions: s => requireQuestStage(s, quest, 'started', { atLeast: true }),
            done: started,
        },
        {
            letter: 'G2', label: 'dye-mail', logoutSafe: true,
            preconditions: allOf(s => requireQuestStage(s, quest, 'started', { atLeast: true }), notComplete, h20),
            run: ctx => dye(ctx),
            postconditions: allOf(hasItem(ITEM.orange, 'the orange goblin mail'), hasItem(ITEM.blue, 'the blue goblin mail')),
            done: dyed,
        },
        {
            letter: 'G3', label: 'orange-request', logoutSafe: true,
            preconditions: allOf(atGenerals, inProgress, hasItem(ITEM.orange, 'the orange goblin mail'), slots('G3')),
            run: ctx => request(ctx, 'G3', opts).then(() => undefined),
            done: o => atLeast(o, 'will_bring_armour') || orangeGiven(o),
            probes,
        },
        {
            letter: 'G4', label: 'orange-mail', logoutSafe: true,
            preconditions: allOf(atGenerals, inProgress, hasItem(ITEM.orange, 'the orange goblin mail')),
            run: ctx => giveOrange(ctx, 'G4', opts).then(() => undefined),
            postconditions: s => need('orange goblin mail', invCount(s, ITEM.orange) === 0, 'still held'),
            done: orangeGiven,
        },
        {
            letter: 'G5', label: 'blue-mail', logoutSafe: true,
            preconditions: allOf(atGenerals, inProgress, hasItem(ITEM.blue, 'the blue goblin mail')),
            run: ctx => giveBlue(ctx, 'G5', opts).then(() => undefined),
            postconditions: s => need('blue goblin mail', invCount(s, ITEM.blue) === 0, 'still held'),
            done: blueGiven,
        },
        {
            letter: 'G6', label: 'plain-mail', logoutSafe: true,
            preconditions: allOf(atGenerals, s => (questStatus(s, quest) === 'complete' ? true : allOf(inProgress, hasItem(ITEM.mail, 'the plain goblin mail'), slots('G6'))(s, undefined))),
            run: ctx => finish(ctx, opts),
            postconditions: allOf(s => requireQuestStage(s, quest, 'complete'), hasItem(ITEM.bar, 'the gold bar'), s => (s.dialog.isOpen || s.modalOpen ? 'a dialogue or modal is still open' : true), noLeftovers),
            done: o => questDone(quest)(o),
        },
    ];
    const keep = opts?.part ? PARTS[opts.part] : LETTERS;
    return questSteps(stepId, segs.filter(s => keep.includes(s.letter as Letter)));
}

/** For tests and the lab: the observation `done` checks read, with the journal probe's reading. */
export function observed(state: BotWorldState, journal?: Pick<QuestJournalState, 'title' | 'lines'>): Observed {
    return { state, probed: journal ? { [JOURNAL]: { open: false, tick: state.tick, ...journal } } : {} };
}
