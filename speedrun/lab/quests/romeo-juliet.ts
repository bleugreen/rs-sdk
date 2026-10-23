// Lab acceptance for the Romeo & Juliet module (speedrun/quests/romeo-juliet.ts, S24's R1-R6):
//
//   LAB_RUNNERS=0 speedrun/lab/lab.sh <bot> 'speedrun/lab/quests/romeo-juliet.ts:--from=R1:--until=R6:--runs=3:--dialogue=both:--launch'
//
// SCORED's levels at S24 (the route's post-Monkey-Madness levels; the quest checks none). The pack
// is the inventory ledger's at S24's end (the gold bar; the legs' runes spent) plus what R&J holds
// by each segment: H20's cadava berries, Juliet's message, the potion. Ticks are from Romeo's tile
// (3211,3425); L24c's 4.8 are not in them.

import { questStatus } from '../../lib/quests';
import type { Session } from '../../lib/session';
import type { TickRow } from '../../lib/ticks';
import { ARRIVAL, quest, stepId, steps, type Options } from '../../quests/romeo-juliet';
import { fixturePack, ledgerAfter } from './ledger';
import { labMain, type LabQuest, type QuestFixture } from './run';

export const LEVELS = { attack: 99, strength: 97, defence: 89, hitpoints: 97, magic: 99, prayer: 99, ranged: 54, agility: 75, crafting: 45, herblore: 28 } as const;

const END = ledgerAfter('S24 legs');
const pack = (quest: Record<string, number>) => fixturePack(END, quest);
const BERRIES = { cadavaberries: 1 };
const romeo = { x: ARRIVAL.x, z: ARRIVAL.z };
const juliet = { x: 3158, z: 3426, level: 1 };
const lawrence = { x: 3254, z: 3477 };
const apothecary = { x: 3195, z: 3405 };
const fx = (letter: string, rjquest: number, items: Record<string, number>, tile: QuestFixture['tile'], note?: string): QuestFixture =>
    ({ letter, levels: LEVELS, vars: { rjquest }, ...pack(items), tile, ...(note ? { note } : {}) });

export const FIXTURES: readonly QuestFixture[] = [
    fx('R1', 0, BERRIES, romeo, "the arrival tile (legs.ts L24c: 3211,3425 tol 1), the ledger's S24 pack and H20's berries"),
    fx('R2', 20, { ...BERRIES, julietmessage: 1 }, juliet),
    fx('R3', 30, BERRIES, romeo),
    fx('R4', 40, BERRIES, lawrence),
    fx('R5', 50, { cadava: 1 }, apothecary),
    fx('R6', 60, {}, juliet),
];

/**
 * Reference ticks (fixed dialogue), inferred: a page a tick plus the approach, runs at 0.5 a route
 * tile from the map (Romeo to Juliet's stairs ~60, Juliet to Romeo ~60, Romeo to the church ~55,
 * the church to the Apothecary ~75, the Apothecary to Juliet's stairs ~45), 2 a climb. Sum 242
 * against the manifest's fixed 241 (inferred from page counts, travel inside the quest included).
 */
export const REFERENCE: Readonly<Record<string, number>> = { R1: 43, R2: 40, R3: 36, R4: 50, R5: 33, R6: 40 };

const lab: LabQuest<Options> = {
    title: "Romeo & Juliet (S24 R1-R6, SCORED's post-MM levels; the ledger's S24 pack and H20's berries; from Romeo 3211,3425)",
    stepId,
    steps,
    fixtures: FIXTURES,
    reference: REFERENCE,
    check(session: Session, _f: QuestFixture, rows: readonly TickRow[]) {
        if (!rows.some(r => r.step === `${stepId}:R6-romeo-finish`)) return undefined;
        return questStatus(session.sdk.getState()!, quest) === 'complete' ? undefined : 'Romeo & Juliet is not complete after R12';
    },
};

if (import.meta.main) {
    await labMain(lab);
    process.exit(0);
}
