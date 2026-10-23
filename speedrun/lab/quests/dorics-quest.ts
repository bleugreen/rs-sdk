// Lab acceptance for the Doric's Quest module (speedrun/quests/dorics-quest.ts, S05):
//
//   LAB_RUNNERS=0 speedrun/lab/lab.sh <bot> 'speedrun/lab/quests/dorics-quest.ts:--from=A:--until=C:--runs=3:--dialogue=both:--launch'
//
// SCORED's levels on arrival at S05 (RUN-ORDER.md): Magic 59 (S04), Firemaking 99 (S03), Mining 1,
// Hitpoints 10. The pack is the inventory ledger's after H4 (STEP-MANIFEST.md, walked by
// tools/slot-ledger.ts: the ores, the air talisman, the law and air runes, the staff of water worn),
// so segment A finds H4 landed and costs nothing here: the trade with the rings is runner/handoff.ts's
// swap, measured by rs/285 at 6 ticks with the 20 rings and 6 without. Ticks are from Doric's tile
// (2952,3451): T04-05's 44 are not in them.

import { questStatus } from '../../lib/quests';
import type { Session } from '../../lib/session';
import type { TickRow } from '../../lib/ticks';
import { skillXp } from '../../lib/world';
import { ARRIVAL, quest, stepId, steps, type Options } from '../../quests/dorics-quest';
import { fixturePack, ledgerAfter } from './ledger';
import { labMain, type LabQuest, type QuestFixture } from './run';

export const LEVELS = { magic: 59, firemaking: 99, mining: 1, hitpoints: 10 } as const;

const AFTER_H4 = fixturePack(ledgerAfter('H4'));
const tile = { x: ARRIVAL.x, z: ARRIVAL.z };

const fx = (letter: string, doricquest: number, note?: string): QuestFixture => ({ letter, levels: LEVELS, vars: { doricquest }, ...AFTER_H4, tile, ...(note ? { note } : {}) });

export const FIXTURES: readonly QuestFixture[] = [
    fx('A', 0, "the arrival tile (legs.ts T04-05: 2952,3451 tol 1), the ledger's pack after H4"),
    fx('B', 0),
    fx('C', 10),
];

/**
 * Reference ticks per segment (fixed dialogue), from dorics_quest.md's measured rows: the start 9
 * (approach included), the hand-in 8 (5 pages, the scroll and the level-up page). A is the trade,
 * already landed in these fixtures (0 here; 6 m in rs/285's lab). Sum 17, the manifest's fixed 22
 * less the trade's 5.
 */
export const REFERENCE: Readonly<Record<string, number>> = { A: 0, B: 9, C: 8 };

/** 1,300 base Mining at the server's rate 25 (quest_doric.rs2:99; WorldConfig XP rate). */
const REWARD_XP = 13000 * 2.5;
let xp0 = 0;

const lab: LabQuest<Options> = {
    title: "Doric's Quest (S05, SCORED's levels: Magic 59, Mining 1, HP 10; the ledger's pack after H4; from Doric's tile 2952,3451)",
    stepId,
    steps,
    fixtures: FIXTURES,
    reference: REFERENCE,
    async prepare(session: Session) {
        xp0 = skillXp(session.sdk, 'mining');
    },
    check(session: Session, _f: QuestFixture, rows: readonly TickRow[]) {
        if (!rows.some(r => r.step === `${stepId}:C-doric-hand-in`)) return undefined;
        const s = session.sdk.getState()!;
        if (questStatus(s, quest) !== 'complete') return "Doric's Quest is not complete after C";
        if (s.dialog.isOpen || s.modalOpen) return "Doric's reward pages are still open after C";
        const gained = skillXp(s, 'mining') - xp0;
        if (gained < REWARD_XP) return `Mining xp gained ${gained}, the reward is ${REWARD_XP}`;
        return undefined;
    },
};

if (import.meta.main) {
    await labMain(lab);
    process.exit(0);
}
