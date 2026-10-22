// Lab acceptance for the Plague City module (speedrun/quests/plague-city.ts, S08):
//
//   LAB_RUNNERS=0 speedrun/lab/lab.sh <bot> 'speedrun/lab/quests/plague-city.ts:--from=A:--until=Z:--runs=3:--dialogue=both:--launch'
//
// SCORED's levels on arrival at S08 (RUN-ORDER.md rows S02-S07): Magic 59 (S04), Mining 49 (S05,
// which this quest takes to 64), Firemaking 99, Runecraft 44, Woodcutting 99, Prayer 95 (S07's
// bury, S25b). Its pack (the slot ledger's walk after T07-08): a knife and one log, the staff of
// water worn; then H6 (the quest's items and one Ardougne cast, 2 law and 2 water) staged as the
// trade leaves it. Each fixture stages that pack less what the quest has used by then, plus what
// it has handed over, and %elenaquest. Ticks are from Edmond's arrival tile (2568,3334): T07-08's
// Camelot teleport and run are not in them, nor is H6's trade (9 m, primitives.md section 6),
// which segment A only checks here.
//
// After a run that reached Z, `check` confirms the quest complete, the magic scroll read (Z's note:
// the memorise and can-now-cast pages, the scroll gone), the 2,425 base Mining, and then casts the
// Ardougne teleport from Edmond's house as T08-09 will: it must land.

import type { TickRow } from '../../lib/ticks';
import { questStatus } from '../../lib/quests';
import { teleport, type TravelSdk } from '../../lib/travel';
import { skillXp } from '../../lib/world';
import type { Session } from '../../lib/session';
import { quest, stepId, steps, type Options, type ScrollRead } from '../../quests/plague-city';
import { labMain, type LabQuest, type QuestFixture } from './run';
import { result } from '../common';

export const LEVELS = { magic: 59, mining: 49, firemaking: 99, runecraft: 44, woodcutting: 99, prayer: 95 } as const;

/** SCORED's own pack at S08 (the knife, S07's kept log, the staff of water) and H6's runes. */
const BASE = { knife: 1, logs: 1, staff_of_water: 1, lawrune: 2, waterrune: 2 } as const;
const H6 = { dwellberries: 1, bucket_water: 4, spade: 1, rope: 1, chocolate_dust: 1, bucket_milk: 1, snape_grass: 1 } as const;

type Items = Record<string, number>;
/** Quest items first: a full pack drops a ::give silently. */
const pack = (quest: Items, kit: Items): Items => ({ ...quest, ...kit, ...BASE });

/** The kit as it stands after each phase: the berries go at D, the cure is mixed at F, the water poured at G, the rope tied at I. */
const KIT = {
    full: { ...H6 },
    afterAlrena: { bucket_water: 4, spade: 1, rope: 1, chocolate_dust: 1, bucket_milk: 1, snape_grass: 1 },
    afterCure: { bucket_water: 4, spade: 1, rope: 1, hangover_cure: 1 },
    afterMud: { bucket_empty: 4, spade: 1, rope: 1, hangover_cure: 1 },
    afterRope: { bucket_empty: 4, spade: 1, hangover_cure: 1 },
    afterBravek: { bucket_empty: 4, spade: 1 },
} as const;

const vars = (elenaquest: number) => ({ elenaquest, biohazard: 0 });
const WORN = ['staff_of_water'] as const;
const MASKED = ['staff_of_water', 'gasmask'] as const;

const fx = (letter: string, stage: number, quest: Items, kit: Items, tile: QuestFixture['tile'], worn: readonly string[] = WORN, note?: string): QuestFixture => ({
    letter, levels: LEVELS, vars: vars(stage), items: pack(quest, kit), worn, tile, ...(note ? { note } : {}),
});

const EDMOND = { x: 2568, z: 3334 };
const PIC = { elena_picture: 1 };
const MASK = { gasmask: 1 };

export const FIXTURES: readonly QuestFixture[] = [
    fx('A', 0, {}, KIT.full, EDMOND, WORN, "Edmond's arrival tile (T07-08: 2568,3334 tol 1), H6 staged"),
    fx('B', 0, {}, KIT.full, EDMOND),
    fx('C', 1, {}, KIT.full, EDMOND),
    fx('D', 1, PIC, KIT.full, { x: 2576, z: 3334 }),
    fx('E', 2, { ...PIC, ...MASK }, KIT.afterAlrena, { x: 2573, z: 3334 }),
    fx('F', 3, { ...PIC, ...MASK }, KIT.afterAlrena, EDMOND),
    fx('G', 3, { ...PIC, ...MASK }, KIT.afterCure, EDMOND),
    fx('H', 7, { ...PIC, ...MASK }, KIT.afterMud, { x: 2567, z: 3332 }),
    fx('I', 8, { ...PIC, ...MASK }, KIT.afterMud, { x: 2562, z: 9737 }),
    fx('J', 9, { ...PIC, ...MASK }, KIT.afterRope, { x: 2530, z: 9703 }),
    fx('K', 10, { ...PIC, ...MASK }, KIT.afterRope, { x: 2535, z: 9718 }),
    fx('L', 10, { ...PIC, ...MASK }, KIT.afterRope, { x: 2529, z: 3304 }, MASKED),
    fx('M', 20, { ...PIC, ...MASK, turnip_book: 1 }, KIT.afterRope, { x: 2539, z: 3305 }, MASKED),
    fx('N', 21, { ...PIC, ...MASK }, KIT.afterRope, { x: 2531, z: 3329 }, MASKED),
    fx('O', 22, { ...PIC, ...MASK }, KIT.afterRope, { x: 2531, z: 3330 }, MASKED),
    fx('P', 23, { ...PIC, ...MASK }, KIT.afterRope, { x: 2531, z: 3330 }, MASKED),
    fx('Q', 24, { ...PIC, ...MASK }, KIT.afterRope, { x: 2533, z: 3273 }, MASKED),
    fx('R', 25, { ...PIC, ...MASK }, KIT.afterRope, { x: 2529, z: 3317 }, MASKED),
    fx('S', 26, { ...PIC, ...MASK, scruffy_note: 1 }, KIT.afterRope, { x: 2535, z: 3314 }, MASKED),
    fx('T', 27, { ...PIC, ...MASK, scruffy_note: 1, warrant: 1 }, KIT.afterBravek, { x: 2535, z: 3314 }, MASKED),
    fx('U', 27, { ...PIC, ...MASK, scruffy_note: 1, warrant: 1 }, KIT.afterBravek, { x: 2533, z: 3271 }, MASKED),
    fx('V', 27, { ...PIC, ...MASK, scruffy_note: 1, warrant: 1, elenakey: 1 }, KIT.afterBravek, { x: 2533, z: 3269 }, MASKED),
    fx('W', 27, { ...PIC, ...MASK, scruffy_note: 1, warrant: 1, elenakey: 1 }, KIT.afterBravek, { x: 2537, z: 9670 }, MASKED),
    fx('X', 28, { ...PIC, ...MASK, scruffy_note: 1, warrant: 1, elenakey: 1 }, KIT.afterBravek, { x: 2540, z: 9672 }, MASKED),
    fx('Y', 28, { ...PIC, ...MASK, scruffy_note: 1, warrant: 1, elenakey: 1 }, KIT.afterBravek, { x: 2567, z: 3333 }, MASKED),
    fx('Z', 29, { ...MASK, ardougnescroll: 1 }, KIT.afterBravek, { x: 2567, z: 3333 }, MASKED),
];

/**
 * Reference ticks per segment on the fixed client, from plague_city.md's step rows (stock, measured
 * with the segments script) less one tick per page and option: B step 2 (37 - 17), C 3, D 4 (24 - 7),
 * E 5 (9 - 3), F 6 (8 - 2), G 7-8 (3 + 16 - 4), H 9 (6 - 2), I 10-11 (26 + 5 - 1), J 12 (34 - 4),
 * K 13, L 14 (33 - 12), M 15 (26 - 5), N 16 (8 - 3), O 17 less the door (3 + 14 + 3 - 5), P the door
 * out, the run and 18 (5 + 54 - 8), Q 19 with the expected retries at the fixed rate (47 - 9 + ~8),
 * R 20-21 (11 + 18 - 8), S 22 (26 - 12), T 23-24 (28 + 11 - 4), U 25 (12 - 1), V 26's stairs and
 * run (1 + 3), W 26's unlock and 27 (4 - 1 + 10 - 4), X 28-30 (9 + 22 + 26), Y 31 (10 - 3), Z 32
 * (6 - 2). A is 0 here (the kit staged; the trade is 9 m). Sum 476, with the trade 485, the
 * manifest's 491 fixed less its rounding of the clerk's retries.
 */
export const REFERENCE: Readonly<Record<string, number>> = {
    A: 0, B: 20, C: 16, D: 17, E: 6, F: 6, G: 15, H: 4, I: 30, J: 30, K: 11, L: 21, M: 21, N: 5, O: 15,
    P: 51, Q: 46, R: 21, S: 14, T: 35, U: 11, V: 4, W: 9, X: 57, Y: 7, Z: 4,
};

/** 2,425 base Mining at the server's rate 25 (quest_elena.rs2:12 stat_advance in tenths; the WorldConfig xp rate). */
const REWARD_XP = 24250 * 2.5;
let xp0 = 0;

const lab: LabQuest<Options> = {
    title: `Plague City (S08, SCORED's levels: Magic 59, Mining 49; from Edmond's arrival tile 2568,3334)`,
    stepId,
    steps,
    fixtures: FIXTURES,
    reference: REFERENCE,
    async prepare(session: Session) {
        xp0 = skillXp(session.sdk, 'mining');
    },
    async check(session: Session, _f: QuestFixture, rows: readonly TickRow[]) {
        if (!rows.some(r => r.step === `${stepId}:Z-scroll` && !r.kind)) return undefined;
        const sdk = session.sdk;
        const s = sdk.getState()!;
        if (questStatus(s, quest) !== 'complete') return 'the quest is not complete after Z';
        const read = rows.filter(r => r.kind === 'note' && r.step === `${stepId}:Z`).map(r => (r.meta as { scrollRead?: ScrollRead }).scrollRead).find(Boolean);
        if (!read?.read) return `the scroll read was not observed (${JSON.stringify(read ?? null)})`;
        if (rows.some(r => r.step === `${stepId}:Y-edmond-reward` && !r.kind)) {
            const gained = skillXp(s, 'mining') - xp0;
            if (gained < REWARD_XP) return `Mining xp gained ${gained}, the reward is ${REWARD_XP}`;
        }
        // T08-09's cast: at %elenaquest 29 it is refused ('You haven't learnt how to cast this spell yet.').
        const cast = await teleport(sdk as unknown as TravelSdk, 'ardougne', { walkOnRefusal: false });
        result(`${stepId}_ardougne_cast`, { ok: cast.ok, ticks: cast.ticks, reason: cast.reason ?? null, at: cast.at, scrollPages: read.pages });
        if (!cast.ok) return `the Ardougne teleport after the scroll: ${cast.reason}`;
        return undefined;
    },
};

if (import.meta.main) {
    await labMain(lab);
    process.exit(0);
}
