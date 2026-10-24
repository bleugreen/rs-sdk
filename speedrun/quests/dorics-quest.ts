// Doric's Quest: STEP-MANIFEST.md entry 30 (S05), docs/speedrun/quests/dorics_quest.md.
//
// From the arrival tile beside Doric (T04-05 ends at 2952,3451 tol 1) to the quest complete beside
// him, in three segments: A, SUPPLIES.md hand-off H4 (the ores, the air talisman and the T05-06 and
// T06-07 runes) as a lib/trade.ts swap that hands back S04's last 20 enchanted rings in the same
// trade; B, Doric's start; C, the hand-in, the reward's pages, and the exit drop of his 180 coins.
//
// H4 is read from the inventory ledger (STEP-MANIFEST.md, through runner/handoff.ts's ledger
// reader), so its items and its free-slot need are the ledger's, never a constant here. The rings
// are the row's `<enchanted ring>` placeholder, the module's to fill: the swap offers what
// skills/magic.ts `enchantedRingSpecs` names (load 3's rings of forging and life, one offer-all per
// item id). The trade server counts offered items as freed (trade.rs2), so the free-slot check
// (handoff.ts `handOffRoom`) credits the rings' slots: segment A refuses up front, naming the
// shortfall, rather than letting the server refuse the trade halfway (main's ruling, 23:31 PDT
// 10-21). With no rings held the trade is a plain delivery.
//
// What the content does (server/content/scripts/quests/quest_doric/scripts/quest_doric.rs2):
// - No level or quest requirement. The hand-in checks 6 clay, 4 copper ore and 2 iron ore (:70)
//   and deletes them (:74-76).
// - The start is %doricquest 0 -> 10 on "Yes, I will get you materials." (:59); the hand-in queues
//   the completion (:80, 1,300 base Mining, :99) and adds 180 coins (:83), which nothing on the
//   route spends: they are dropped at the exit (the ledger's T05-06 drop, moved into the step).
// - %doricquest is scope=perm (quest_doric.varp): every segment is logout-safe, and the quest tab
//   shows each stage (not started, started, complete), so resume needs no journal probe.

import type { BotWorldState } from '../../sdk/types';
import { dropItems } from '../lib/act';
import { questDone, questStatus, requireQuestStage, type QuestView } from '../lib/quests';
import { invCount } from '../lib/world';
import type { Check, Observed, StepContext } from '../runner/step';
import { handOffMissing, handOffPre, handOffRoom, loadHandOff, runHandOff, type Given, type HandOffPlan, type HandOffSdk } from '../runner/handoff';
import { enchantedRingSpecs } from '../skills/magic';
import { MANIFEST } from '../tools/slot-ledger';
import { allOf, baseLevels, questSteps, recorded, segmentName, slotsCover, within, type QuestItem, type QuestOptions, type Segment } from './segments';
import { near, questMoves } from './small-quest';

export const quest = 'doric' as const;
export const stepId = 'S05';

export interface Options extends QuestOptions {
    /** The markdown holding the inventory ledger H4 is read from (default STEP-MANIFEST.md). */
    ledger?: string;
}

const m = questMoves(stepId);

// ------------------------------------------------------------------ places and things

/** T04-05's landing: Doric's tile, tolerance 1 (runner/legs.ts T.doric). */
export const ARRIVAL = { x: 2952, z: 3451, tol: 1 } as const;
/** Doric (npc 284) stands at (2952,3451) in his house north of Falador (maps); his door is open. */
export const DORIC_AT = { x: 2952, z: 3451 } as const;
const DORIC_RE = /^doric$/i;
/** Doric's house and the ground round its door, for position checks by coordinates. */
export const HOUSE = near(DORIC_AT, 4);

const ITEM = {
    clay: /^clay$/i,
    copper: /^copper ore$/i,
    iron: /^iron ore$/i,
    coins: /^coins$/i,
} as const;

/** What the hand-in checks and takes (quest_doric.rs2:70-76). */
export const ORES = [{ item: ITEM.clay, n: 6 }, { item: ITEM.copper, n: 4 }, { item: ITEM.iron, n: 2 }] as const;

export const LETTERS = ['A', 'B', 'C'] as const;
type Letter = (typeof LETTERS)[number];

/**
 * What the content hands over inside the step, for the free-slot checks: the 180 coins at C,
 * dropped at C's exit. H4's own need is the ledger row's (segment A, `h4Room`), not listed here.
 */
export const QUEST_ITEMS: readonly QuestItem[] = [{ item: ITEM.coins, name: 'Coins', stackable: true, from: 'C', until: 'C' }];

/** Dead at the exit: Doric's coins (nothing on the route spends them; the ledger drops them on T05-06). */
export const DEAD_AT_EXIT: readonly RegExp[] = [ITEM.coins];
const dead = (i: { name: string }) => DEAD_AT_EXIT.some(p => p.test(i.name));

// ------------------------------------------------------------------ conversations (CONVENTIONS.md shapes, read from the script)

export const SHAPES = {
    /** quest_doric.rs2:35-62: the greeting, the anvils option, the materials option, Doric's order and the goodbye. */
    start: '1c, opt, 2c, opt, 3c',
    /** :69-84: the ores go after the third page (the completion queued), the coins after the fourth. */
    handIn: '5c',
} as const;

export const CHOICES = {
    start: [/^I wanted to use your anvils/i, /^Yes, I will get you materials/i],
};

// ------------------------------------------------------------------ H4

/** The ledger names the rings `<enchanted ring>` (a placeholder) or, in the older fixtures, `enchanted ring`. */
const RING_ENTRY = /^enchanted ring$/i;

/**
 * H4 as the trade runs it from `s`: the ledger row's items, plus the enchanted rings `s` holds as
 * one give per item id (magic.ts `enchantedRingSpecs`). Throws on any other placeholder in the row.
 */
export function h4Plan(s: BotWorldState, ledger: string = MANIFEST): HandOffPlan {
    return h4PlanOf(s, loadHandOff('H4', ledger));
}

/** h4Plan from the ledger's H4 row already read (a ledger held as text: lab/dress-rehearsal.ts KIT_PLANS). */
export function h4PlanOf(s: BotWorldState, row: HandOffPlan): HandOffPlan {
    const other = row.placeholders.filter(p => !/^<enchanted ring>/i.test(p));
    if (other.length) throw new Error(`${stepId}: H4 has placeholders this module does not fill: ${other.join(', ')}`);
    const give = row.give.filter(g => !RING_ENTRY.test(g.name));
    const ids = enchantedRingSpecs(s).map(g => g.item as number);
    const rings: Given[] = ids.length ? [{ name: 'enchanted ring', pattern: RING_ENTRY, ids, perObj: true, count: 'all' }] : [];
    return { ...row, give: [...give, ...rings], placeholders: [] };
}

/** H4 has landed: every item in, no ring left. */
export const h4Landed = (s: BotWorldState, ledger?: string) => handOffMissing(s, h4Plan(s, ledger)).length === 0;

/** Segment A's free-slot refusal: H4's items fit, counting the slots the rings free once offered. */
export function h4Room(opts?: Options): Check<any> {
    return s => {
        if (h4Landed(s, opts?.ledger)) return true;
        const plan = h4Plan(s, opts?.ledger);
        const r = handOffRoom(s, plan);
        return r === true ? true : `${r} (STEP-MANIFEST.md inventory ledger, row H4 line ${plan.line}); refused before the trade`;
    };
}

async function h4(ctx: StepContext<any>, opts: Options | undefined): Promise<void> {
    const sdk = m.sdkOf(ctx);
    const s = sdk.getState()!;
    const plan = h4Plan(s, opts?.ledger);
    const missing = handOffMissing(s, plan);
    if (!missing.length) return;
    const giver = opts?.kitFrom;
    if (!giver) return m.fail('A', `H4 not delivered (${missing.join('; ')}) and no kitFrom to trade with`);
    const pre = handOffPre(s, plan, giver);
    if (pre !== true) return m.fail('A', pre);
    const r = await runHandOff(sdk as unknown as HandOffSdk, plan, giver);
    m.note(ctx, 'A', { trade: r.trade, ticks: r.ticks, openTicks: r.openTicks, gave: r.gave, received: r.received });
}

// ------------------------------------------------------------------ segment runs

async function start(ctx: StepContext<any>, opts: Options | undefined): Promise<void> {
    if (questStatus(ctx.sdk.getState()!, quest) !== 'not_started') return;
    await m.talk(ctx, 'B', opts, { who: 'Doric (start)', npc: DORIC_RE, near: DORIC_AT, choices: CHOICES.start, shape: SHAPES.start });
}

/**
 * Segment C. The completion is queued two pages before the coins arrive (quest_doric.rs2:80, :83),
 * so the coins are dropped the tick they land: the drop closes Doric's last page, which says
 * nothing the route needs, and the queued completion runs regardless. Then the Mining level-up page
 * is answered.
 */
async function handIn(ctx: StepContext<any>, opts: Options | undefined): Promise<void> {
    const sdk = m.sdkOf(ctx);
    if (questStatus(sdk.getState()!, quest) !== 'complete') {
        let dropAt = -1;
        const stop = sdk.onStateUpdate(s => {
            const c = dropAt < 0 ? s.inventory.find(dead) : undefined;
            if (!c) return;
            dropAt = s.tick;
            void sdk.sendDropItem(c.slot);
        });
        const t0 = sdk.getState()!.tick;
        try {
            await m.talk(ctx, 'C', opts, { who: 'Doric (hand-in)', npc: DORIC_RE, near: DORIC_AT, shape: SHAPES.handIn });
        } finally {
            stop();
        }
        m.note(ctx, 'C', { coinsDropped: dropAt >= 0 ? `+${dropAt - t0}` : 'not in the talk' });
        await m.completion(ctx, 'C', quest, true, t0);
    }
    const d = await dropItems(sdk, dead);
    if (!d.ok) m.fail('C', `exit: ${(sdk.getState()?.inventory ?? []).filter(dead).map(i => i.name).join(', ')} not dropped`);
}

// ------------------------------------------------------------------ checks

const atDoric = within(HOUSE, "Doric's house");
const notComplete: Check<any> = s => (questStatus(s, quest) === 'complete' ? `${stepId}: Doric's Quest is already complete` : true);
const oresHeld: Check<any> = s => {
    const short = ORES.filter(o => invCount(s, o.item) < o.n).map(o => `${o.n - invCount(s, o.item)} ${o.item.source.replace(/[\^$]/g, '')}`);
    return short.length ? `the hand-in items: short ${short.join(', ')}` : true;
};
const noDeadItems: Check<any> = s => {
    const held = s.inventory.filter(dead);
    return held.length ? `exit: still holding ${held.map(i => i.name).join(', ')}` : true;
};
const stateOf = (o: QuestView): BotWorldState => ('probed' in o ? o.state : o);
const atLeast = (o: QuestView, stage: 'started' | 'complete') => requireQuestStage(o, quest, stage, { atLeast: true }) === true;

// ------------------------------------------------------------------ the segments

export function steps(opts?: Options) {
    const slots = (at: Letter) => slotsCover(QUEST_ITEMS, LETTERS, at);
    const segs: Segment[] = [
        {
            letter: 'A', label: 'h4-swap', logoutSafe: true,
            preconditions: allOf(atDoric, notComplete, h4Room(opts)),
            run: ctx => h4(ctx, opts),
            postconditions: s => {
                const missing = handOffMissing(s, h4Plan(s, opts?.ledger));
                return missing.length ? `H4 after the trade: ${missing.join('; ')}` : true;
            },
            // Monotone for the resume walk: once started, the ores stay until C and the rings are gone.
            done: o => atLeast(o, 'started') || h4Landed(stateOf(o), opts?.ledger),
        },
        {
            letter: 'B', label: 'doric-start', logoutSafe: true,
            // At stage 0 B needs H4: the resume walk takes the latest segment that can start, and must
            // not start B on a fresh arrival before the trade.
            preconditions: allOf(atDoric, notComplete, s => (atLeast(s, 'started') ? true : h4Landed(s, opts?.ledger) ? true : 'H4 not delivered yet')),
            run: ctx => start(ctx, opts),
            postconditions: s => requireQuestStage(s, quest, 'started', { atLeast: true }),
            done: o => atLeast(o, 'started'),
        },
        {
            letter: 'C', label: 'doric-hand-in', logoutSafe: true,
            preconditions: allOf(atDoric, s => (questStatus(s, quest) === 'complete' ? true : allOf(s2 => requireQuestStage(s2, quest, 'started'), oresHeld, slots('C'))(s, undefined))),
            run: ctx => handIn(ctx, opts),
            postconditions: allOf(s => requireQuestStage(s, quest, 'complete'), baseLevels({ mining: 49 }), s => (s.dialog.isOpen || s.modalOpen ? 'a dialogue or modal is still open' : true), noDeadItems),
            // The coins clause proves C's exit drop, and coins come back from later steps (H9 on), so past S05
            // the attempt's step record stands in for it. The quest stays required either way.
            done: o => questDone(quest)(o) && (!stateOf(o).inventory.some(dead) || recorded(o, segmentName(stepId, 'C', 'doric-hand-in'))),
        },
    ];
    return questSteps(stepId, segs);
}

/** For tests and the lab: the observation `done` checks read (the quest tab shows every stage). */
export function observed(state: BotWorldState): Observed {
    return { state, probed: {} };
}
