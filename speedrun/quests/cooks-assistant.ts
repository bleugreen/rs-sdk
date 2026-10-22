// Cook's Assistant: STEP-MANIFEST.md entry 31 (S23), docs/speedrun/quests/cooks_assistant.md.
//
// From the arrival tile beside the cook (T22-23 ends at 3209,3215 tol 1, Lumbridge Castle's
// kitchen) to the quest complete beside him, in three segments: A, the kit (SUPPLIES.md hand-off
// H19: an egg, a bucket of milk, a pot of flour; run.ts trades it on T22-23, so here it is only
// checked unless `kitFrom` is given); B, the cook's start; C, the hand-in and the reward's pages.
//
// What the content does (server/content/scripts/quests/quest_cook/scripts/quest_cook.rs2 and
// areas/area_lumbridge/scripts/cook.rs2):
// - No requirement. The start is "What am I to do?", "What's wrong?", then "Yes, I'll help you."
//   (%cookquest 0 -> 1, quest_cook.rs2:32). The hand-in at 1 takes the three items in one script
//   (:84-87) and queues the completion (:88, 300 base Cooking, :91).
// - Nothing is left over: the bucket and the pot go with the milk and the flour (inv_del of the
//   filled items), so the step has no exit drop.
// - %cookquest is scope=perm (quest_cook.varp) and the quest tab shows each stage, so every
//   segment is logout-safe and resume needs no journal probe.

import type { BotWorldState } from '../../sdk/types';
import { questDone, questStatus, requireQuestStage, type QuestView } from '../lib/quests';
import { invCount } from '../lib/world';
import type { Check, Observed, StepContext } from '../runner/step';
import { allOf, kitSegment, kitWant, questSteps, slotsCover, within, type KitItem, type QuestItem, type QuestOptions, type Segment } from './segments';
import { near, questMoves } from './small-quest';

export const quest = 'cook' as const;
export const stepId = 'S23';

export type Options = QuestOptions;

const m = questMoves(stepId);

/** T22-23's landing: the cook's tile, tolerance 1 (runner/legs.ts T.cook). */
export const ARRIVAL = { x: 3209, z: 3215, tol: 1 } as const;
/** The cook (npc 278) at (3209,3215) in Lumbridge Castle's kitchen (maps). */
export const COOK_AT = { x: 3209, z: 3215 } as const;
const COOK_RE = /^cook$/i;
/** The kitchen, for position checks by coordinates. */
export const KITCHEN = near(COOK_AT, 5);

const ITEM = { egg: /^egg$/i, milk: /^bucket of milk$/i, flour: /^pot of flour$/i } as const;

/** H19's quest items (the T23-24 Falador runes ride in the same trade and are the leg's). */
export const KIT: readonly KitItem[] = [{ item: ITEM.egg }, { item: ITEM.milk }, { item: ITEM.flour }];

export const LETTERS = ['A', 'B', 'C'] as const;
type Letter = (typeof LETTERS)[number];

/** The kit as A receives it, each line until the hand-in takes it (quest_cook.rs2:84-86). */
export const QUEST_ITEMS: readonly QuestItem[] = [
    { item: ITEM.egg, name: 'Egg', from: 'A', until: 'C' },
    { item: ITEM.milk, name: 'Bucket of milk', from: 'A', until: 'C' },
    { item: ITEM.flour, name: 'Pot of flour', from: 'A', until: 'C' },
];

export const SHAPES = {
    /** cook.rs2:9-10, quest_cook.rs2:2-37: the cook's greeting, "What's wrong?", his two pages, "Yes, I'll help you.", the reply. */
    start: '1c, opt, 3c, opt, 2c',
    /** quest_cook.rs2:39-87: his question, the two lines, his thanks, the mesbox after which the items go. */
    handIn: '5c',
} as const;

export const CHOICES = {
    start: [/^What's wrong\?/i, /^Yes, I'll help you/i],
};

async function start(ctx: StepContext<any>, opts: Options | undefined): Promise<void> {
    if (questStatus(ctx.sdk.getState()!, quest) !== 'not_started') return;
    await m.talk(ctx, 'B', opts, { who: 'the cook (start)', npc: COOK_RE, near: COOK_AT, choices: CHOICES.start, shape: SHAPES.start });
}

async function handIn(ctx: StepContext<any>, opts: Options | undefined): Promise<void> {
    const sdk = m.sdkOf(ctx);
    if (questStatus(sdk.getState()!, quest) === 'complete') return;
    const r = await m.talk(ctx, 'C', opts, { who: 'the cook (hand-in)', npc: COOK_RE, near: COOK_AT, shape: SHAPES.handIn });
    await m.completion(ctx, 'C', quest, true, r.startTick);
}

const inKitchen = within(KITCHEN, "Lumbridge Castle's kitchen");
const notComplete: Check<any> = s => (questStatus(s, quest) === 'complete' ? `${stepId}: Cook's Assistant is already complete` : true);
const kitHeld: Check<any> = s => {
    const want = kitWant(s, KIT);
    return want.length ? `kit missing: ${want.map(w => `${w.amount} x ${String(w.item)}`).join(', ')}` : true;
};
const atLeast = (o: QuestView, stage: 'started' | 'complete') => requireQuestStage(o, quest, stage, { atLeast: true }) === true;
const noKitLeft: Check<any> = s => {
    const left = KIT.filter(k => invCount(s, k.item) > 0).map(k => String(k.item));
    return left.length ? `exit: still holding ${left.join(', ')}` : true;
};

export function steps(opts?: Options) {
    const slots = (at: Letter) => slotsCover(QUEST_ITEMS, LETTERS, at);
    const segs: Segment[] = [
        kitSegment(opts, KIT, { preconditions: allOf(inKitchen, notComplete, slots('A')) }),
        {
            letter: 'B', label: 'cook-start', logoutSafe: true,
            // At stage 0 B needs A's kit: a fresh arrival without it must start A, not B.
            preconditions: allOf(inKitchen, notComplete, s => (atLeast(s, 'started') ? true : kitHeld(s, undefined))),
            run: ctx => start(ctx, opts),
            postconditions: s => requireQuestStage(s, quest, 'started', { atLeast: true }),
            done: o => atLeast(o, 'started'),
        },
        {
            letter: 'C', label: 'cook-hand-in', logoutSafe: true,
            preconditions: allOf(inKitchen, s => (questStatus(s, quest) === 'complete' ? true : allOf(s2 => requireQuestStage(s2, quest, 'started'), kitHeld)(s, undefined))),
            run: ctx => handIn(ctx, opts),
            postconditions: allOf(s => requireQuestStage(s, quest, 'complete'), s => (s.dialog.isOpen || s.modalOpen ? 'a dialogue or modal is still open' : true), noKitLeft),
            done: o => questDone(quest)(o),
        },
    ];
    return questSteps(stepId, segs);
}

/** For tests and the lab: the observation `done` checks read (the quest tab shows every stage). */
export function observed(state: BotWorldState): Observed {
    return { state, probed: {} };
}

