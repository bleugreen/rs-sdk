// Lab check of the converse burst mode and the quest lab runner, end to end:
// one-segment quest tables built with quests/segments.ts, run through
// lab/quests/run.ts with --dialogue=both. Lab-only examples; the real quest
// modules are speedrun/quests/<quest>.ts.
//
//   LAB_RUNNERS=0 speedrun/lab/lab.sh <bot> speedrun/lab/quests/dialogue-burst.ts:--quest=cook:--from=A:--runs=3:--dialogue=both:--launch
//   LAB_RUNNERS=0 speedrun/lab/lab.sh <bot> speedrun/lab/quests/dialogue-burst.ts:--quest=grandtree:--from=A:--runs=3:--dialogue=both:--launch
//
// (--launch and LAB_RUNNERS=0: the fixtures set quest varps and relog so the
// quest tab shows them; see lab/quests/run.ts.)
//
// Besides the runner's segment table it prints the conversation's own ticks
// (talk click to dialogue closed, ConverseResult.ticks) per mode, which is
// the figure the quest docs record.

import { talkTo } from '../../lib/act';
import type { ConverseResult } from '../../lib/converse';
import { requireQuestStage } from '../../lib/quests';
import { at } from '../../lib/world';
import { questSteps, talkShape, type QuestOptions } from '../../quests/segments';
import { arg } from '../common';
import { stats } from '../record';
import { labMain, type LabQuest } from './run';

/** Every conversation's result, by dialogue mode. */
const talks: Array<{ mode: string; r: ConverseResult }> = [];

/** A conversation's `DIALOGUE` line and its `TRANSCRIPT` lines, as the lab drivers print them. */
export function dialogueLines(mode: string | undefined, r: ConverseResult): string[] {
    return [
        `DIALOGUE ${mode} ticks=${r.ticks} (start ${r.startTick}, first page ${r.firstTick}, closed ${r.endTick}) pages=${r.pages} options=${r.options} levelUps=${r.levelUps} shape=${JSON.stringify(r.shape)}`,
        ...r.transcript.map(line => `  TRANSCRIPT ${line}`),
    ];
}

function record(opts: QuestOptions, r: ConverseResult): void {
    talks.push({ mode: opts.dialogue ?? 'burst', r });
    for (const line of dialogueLines(opts.dialogue, r)) console.log(line);
    if (!r.ok) throw new Error(`conversation failed: ${r.reason}`);
}

/**
 * Cook's Assistant start, the short branch (primitives.md section 1: 6 pages + 2
 * choices): "What am I to do?" (cook.rs2), What's wrong?, three pages, Yes,
 * two pages (quest_cook.rs2).
 */
export const COOK_SHAPE = '1c, opt, 3c, opt, 2c';

export const cook: LabQuest = {
    title: "Cook's Assistant start (lab example)",
    stepId: 'LABcook',
    steps: opts =>
        questSteps('LABcook', [
            {
                letter: 'A',
                label: 'cook-start',
                logoutSafe: true,
                preconditions: s => requireQuestStage(s, 'cook', 'not_started'),
                run: async ({ sdk }) => record(opts, await talkTo(sdk, /^Cook$/, ["What's wrong?", "Yes, I'll help you."], { ...talkShape(opts, COOK_SHAPE), unmatched: 'stop' })),
                postconditions: s => requireQuestStage(s, 'cook', 'started'),
                done: o => requireQuestStage(o, 'cook', 'started', { atLeast: true }) === true,
            },
        ]),
    // The Cook's spawn tile (m50_50.jm2), as quest-primitives-dialogue.ts stands for its measurement.
    fixtures: [{ letter: 'A', vars: { cookquest: 0 }, tile: { x: 3209, z: 3215 } }],
    reference: { A: 9 }, // primitives.md section 1, short branch, click to close at the floor: 9 (measured, n=3)
};

/** The Grand Tree's opening with King Narnode (grand_tree.md, "Dialogue runs": 30 clicks, 10 burst). */
export const GT_SHAPE = '3c, opt, 3c, state, 8c, opt, 13c';
const NARNODE = { x: 2464, z: 3497 };

export const grandtree: LabQuest = {
    title: 'The Grand Tree, King Narnode start (lab example)',
    stepId: 'LABgt',
    steps: opts =>
        questSteps('LABgt', [
            {
                letter: 'A',
                label: 'narnode-start',
                logoutSafe: true,
                // The trapdoor cutscene closes the dialogue mid-conversation (quest-grandtree-full.ts A2): wait it out.
                run: async ({ sdk }) =>
                    record(opts, await talkTo(sdk, /^King Narnode Shareen$|^King Narnode$/i, [/seem worried/, /happy to help/], { ...talkShape(opts, GT_SHAPE), idle: 25, until: at(NARNODE.x, NARNODE.z, 0, 0), unmatched: 'stop' })),
            },
        ]),
    fixtures: [{ letter: 'A', vars: { treequest: 9, grandtree: 0 }, tile: { x: NARNODE.x, z: NARNODE.z } }],
};

if (import.meta.main) {
    const which = arg('quest', 'cook');
    const quest = which === 'grandtree' ? grandtree : which === 'cook' ? cook : null;
    if (!quest) throw new Error(`--quest=${which}: want cook or grandtree`);
    await labMain(quest);
    console.log('\n| Conversation | Mode | Runs (click to closed) | Mean | Min | Max | Pages burst / one per tick | Shape matched |');
    console.log('|---|---|---|---|---|---|---|---|');
    for (const mode of ['fixed', 'burst']) {
        const rs = talks.filter(t => t.mode === mode).map(t => t.r);
        if (!rs.length) continue;
        const st = stats(rs.map(r => r.ticks));
        console.log(`| ${quest.title} | ${mode} | ${rs.map(r => r.ticks).join(', ')} | ${st.mean} | ${st.min} | ${st.max} | ${rs.map(r => `${r.shape?.burstPages}/${r.shape?.stepPages}`).join(', ')} | ${rs.map(r => (r.shape?.matches ? 'yes' : `no: seen ${r.shape?.seen}${r.shape?.stopped ? `; ${r.shape.stopped}` : ''}`)).join('; ')} |`);
    }
    process.exit(0);
}
