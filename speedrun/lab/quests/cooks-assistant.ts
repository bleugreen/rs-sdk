// Lab acceptance for the Cook's Assistant module (speedrun/quests/cooks-assistant.ts, S23):
//
//   LAB_RUNNERS=0 speedrun/lab/lab.sh <bot> 'speedrun/lab/quests/cooks-assistant.ts:--from=A:--until=C:--runs=3:--dialogue=both:--launch'
//
// SCORED's levels at S23 are the route's post-Monkey-Madness combat levels (Dragon Slayer's lab
// uses the same at S26: nothing between trains combat) with Cooking 1. The pack and worn set are
// the inventory ledger's after H19 (the three items, T23-24's Falador runes; the m'speak amulet,
// the staff of fire and the rune arrows worn), so segment A finds the kit held. Ticks are from the
// cook's tile (3209,3215): T22-23's 21 are not in them.

import { questStatus } from '../../lib/quests';
import type { Session } from '../../lib/session';
import type { TickRow } from '../../lib/ticks';
import { skillXp } from '../../lib/world';
import { ARRIVAL, quest, stepId, steps, type Options } from '../../quests/cooks-assistant';
import { fixturePack, ledgerAfter } from './ledger';
import { labMain, type LabQuest, type QuestFixture } from './run';

export const LEVELS = { attack: 99, strength: 97, defence: 89, hitpoints: 97, magic: 99, prayer: 99, ranged: 54, agility: 75, cooking: 1 } as const;

const AFTER_H19 = fixturePack(ledgerAfter('H19'));
const tile = { x: ARRIVAL.x, z: ARRIVAL.z };
const fx = (letter: string, cookquest: number, note?: string): QuestFixture => ({ letter, levels: LEVELS, vars: { cookquest }, ...AFTER_H19, tile, ...(note ? { note } : {}) });

export const FIXTURES: readonly QuestFixture[] = [
    fx('A', 0, "the arrival tile (legs.ts T22-23: 3209,3215 tol 1), the ledger's pack after H19"),
    fx('B', 0),
    fx('C', 1),
];

/**
 * Reference ticks (fixed dialogue): the start measured at 9 on the fixed client (primitives.md
 * section 1, the short branch), the hand-in 5 pages + the reward's page, ~8 i. Sum 17, the
 * manifest's fixed fallback.
 */
export const REFERENCE: Readonly<Record<string, number>> = { A: 0, B: 9, C: 8 };

/** 300 base Cooking at the server's rate 25 (quest_cook.rs2:91). */
const REWARD_XP = 3000 * 2.5;
let xp0 = 0;

const lab: LabQuest<Options> = {
    title: "Cook's Assistant (S23, SCORED's post-MM levels, Cooking 1; the ledger's pack after H19; from the cook's tile 3209,3215)",
    stepId,
    steps,
    fixtures: FIXTURES,
    reference: REFERENCE,
    async prepare(session: Session) {
        xp0 = skillXp(session.sdk, 'cooking');
    },
    check(session: Session, _f: QuestFixture, rows: readonly TickRow[]) {
        if (!rows.some(r => r.step === `${stepId}:C-cook-hand-in`)) return undefined;
        const s = session.sdk.getState()!;
        if (questStatus(s, quest) !== 'complete') return "Cook's Assistant is not complete after C";
        const gained = skillXp(s, 'cooking') - xp0;
        if (gained < REWARD_XP) return `Cooking xp gained ${gained}, the reward is ${REWARD_XP}`;
        return undefined;
    },
};

if (import.meta.main) {
    await labMain(lab);
    process.exit(0);
}
