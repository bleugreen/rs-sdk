// Lab acceptance for the Fishing Contest module (speedrun/quests/fishing-contest.ts, S20, the self
// route):
//
//   LAB_RUNNERS=0 speedrun/lab/lab.sh <bot> 'speedrun/lab/quests/fishing-contest.ts:--from=A:--until=N:--runs=3:--dialogue=both:--launch'
//
// SCORED's levels on arrival at S20 (RUN-ORDER.md): Fishing 74 (S19; the reward takes it to 78),
// Magic 99 (S18c), Agility 75 (S11b, the run energy's restore). Each fixture stages SCORED's pack
// at that point (the slot ledger's walk after H16, with H16's carp and bait swapped for the self
// route's spade and garlic: 8 slots used, 20 free), plus what the quest has handed over by then,
// and the quest varps (%fishingcompo, %hemenster_comp_stage, %hemenster_pipe_stashed). Ticks are
// from the arrival tile beside the tunnel stairs (2820,3486): T19-20's 39.5 are not in them.

import type { TickRow } from '../../lib/ticks';
import { questStatus } from '../../lib/quests';
import { skillXp } from '../../lib/world';
import { quest, stepId, steps, type Options } from '../../quests/fishing-contest';
import { labMain, type LabQuest, type QuestFixture } from './run';
import type { Session } from '../../lib/session';

const LEVELS = { fishing: 74, magic: 99, agility: 75, hitpoints: 70 } as const;

/** H16 as the self route stages it, and what is left of the runes after each Camelot cast (2 per cast: 5 air, 1 law). */
const pack = (casts: number, extra: Record<string, number> = {}, kit: { garlic?: boolean; coins?: boolean } = {}): Record<string, number> => ({
    ...extra,
    fishing_rod: 1,
    spade: 1,
    ...(kit.garlic === false ? {} : { garlic: 1 }),
    ...(kit.coins === false ? {} : { coins: 5 }),
    lawrune: 10 - casts,
    airrune: 23 - 5 * casts,
    waterrune: 9,
    body_talisman: 1,
});

const vars = (fishingcompo: number, comp = 0, stashed = 0) => ({ fishingcompo, hemenster_comp_stage: comp, hemenster_pipe_stashed: stashed });
const ARRIVAL = { x: 2820, z: 3486 };
const INSIDE_GATE = { x: 2642, z: 3441 };
const BY_PIPE = { x: 2637, z: 3445 };

const fx = (letter: string, v: Record<string, number>, items: Record<string, number>, tile: QuestFixture['tile'], note?: string): QuestFixture => ({
    letter, levels: LEVELS, vars: v, items, tile, ...(note ? { note } : {}),
});

const PASS = { fishing_competition_pass: 1 };
const WORM = { ...PASS, red_vine_worm: 1 };

export const FIXTURES: readonly QuestFixture[] = [
    fx('A', vars(0), pack(0), ARRIVAL, 'the arrival tile (T19-20: 2820,3486 tol 1)'),
    fx('B', vars(0), pack(0), ARRIVAL),
    fx('C', vars(1), pack(0, PASS), ARRIVAL),
    fx('D', vars(1), pack(1, PASS), { x: 2661, z: 3500 }),
    fx('E', vars(1), pack(1, PASS), { x: 2662, z: 3500 }),
    fx('F', vars(1), pack(1, WORM), { x: 2631, z: 3500 }),
    fx('G', vars(1), pack(1, WORM), { x: 2661, z: 3500 }),
    fx('H', vars(1), pack(1, WORM), { x: 2643, z: 3441 }),
    fx('I', vars(1), pack(1, WORM), INSIDE_GATE),
    fx('J', vars(2, 1), pack(1, WORM, { coins: false }), { x: 2640, z: 3440 }),
    fx('K', vars(3, 1, 1), pack(1, WORM, { garlic: false, coins: false }), BY_PIPE),
    fx('L', vars(3, 2, 1), pack(1, { ...PASS, raw_giant_carp: 1 }, { garlic: false, coins: false }), BY_PIPE),
    fx('M', vars(4, 2, 1), pack(1, { ...PASS, hemenster_fishing_trophy: 1 }, { garlic: false, coins: false }), BY_PIPE),
    fx('N', vars(4, 2, 1), pack(2, { ...PASS, hemenster_fishing_trophy: 1 }, { garlic: false, coins: false }), ARRIVAL),
];

/**
 * Reference ticks per segment (fixed dialogue), from fishing_contest.md: the helper route's measured
 * rows for what both routes share (B the stairs talk 25, H the gate 5, I Bonzo 11, K the catch 10, L
 * Bonzo 10, M the teleport and run 4 + 36, N the dwarf 9) and the self route's measured walks and
 * inferred interactions (C 4 + 58, D 2, E 38 + 3, F 40 + 2, G 62, J 4 + 2 pages). Sum 325, the doc's
 * self route (~367 from Caroline) less the trade and the arrival; i.
 */
export const REFERENCE: Readonly<Record<string, number>> = { A: 0, B: 25, C: 62, D: 2, E: 41, F: 42, G: 62, H: 5, I: 11, J: 6, K: 10, L: 10, M: 40, N: 9 };

/** 2,437 base Fishing at the server's rate 25 (quest_fishingcompo.rs2:112; WorldConfig XP rate). */
const REWARD_XP = 24370 * 2.5;
let xp0 = 0;

const lab: LabQuest<Options> = {
    title: `Fishing Contest (S20, self route, SCORED's levels: Fishing 74, Magic 99, Agility 75; from the arrival tile 2820,3486)`,
    stepId,
    steps,
    fixtures: FIXTURES,
    reference: REFERENCE,
    async prepare(session: Session) {
        xp0 = skillXp(session.sdk, 'fishing');
    },
    check(session: Session, _f: QuestFixture, rows: readonly TickRow[]) {
        if (!rows.some(r => r.step === `${stepId}:N-dwarf-trophy`)) return undefined;
        const s = session.sdk.getState()!;
        if (questStatus(s, quest) !== 'complete') return 'the quest is not complete after N';
        const gained = skillXp(s, 'fishing') - xp0;
        if (gained < REWARD_XP) return `Fishing xp gained ${gained}, the reward is ${REWARD_XP}`;
        return undefined;
    },
};

if (import.meta.main) {
    await labMain(lab);
    process.exit(0);
}
