// Lab acceptance for the Sea Slug module (speedrun/quests/sea-slug.ts, S19):
//
//   LAB_RUNNERS=0 speedrun/lab/lab.sh <bot> 'speedrun/lab/quests/sea-slug.ts:--from=A:--until=Q:--runs=3:--dialogue=both:--launch'
//   (browser: add --client=browser, with this checkout's webclient built)
//
// SCORED's levels on arrival at S19 (RUN-ORDER.md rows S02-S18): Firemaking 99 (S03, so the rub
// cannot fail), Fishing 1 (the reward's), Magic 99 (S18c), Agility 75 (S11b), Ranged 50 (S14, for
// the quivered rune arrows). Its pack (the slot ledger's walk after H15, which is traded during S18):
// water rune 8, law rune 7, air runes (x? in the ledger; 20 here), the swamp paste and the unlit torch,
// 5 used and 23 free; worn the staff of fire and the rune arrows (the m'speak amulet is left off:
// worn items take no slot and nothing here reads it). Each fixture stages that pack less what the
// quest has used, plus what it has handed over, and %seaslugquest. Ticks are from Caroline's tile
// (2716,3302): T18-19's run is not in them, nor is H15 (traded during S18), which A only checks.
//
// A full chain (--from=A) first shuts both bridged doors if an earlier run left them open (lab
// staging, not counted), so every run opens both; `check` fails a run whose trace has a bridged door
// that did not end open, and after Q confirms the quest complete, the reward's Fishing xp and the
// exit drops.

import type { NearbyLoc } from '../../../sdk/types';
import { opLoc } from '../../lib/act';
import type { TickRow } from '../../lib/ticks';
import { questStatus } from '../../lib/quests';
import type { Session } from '../../lib/session';
import { waitTicks, waitUntil } from '../../lib/wait';
import { skillLevel, skillXp } from '../../lib/world';
import { DOORS, doorState, isDead, quest, stepId, steps, type BridgedDoor, type DoorOutcome, type Options } from '../../quests/sea-slug';
import { result } from '../common';
import { mustTele } from '../setup';
import { applyFixture, labMain, type LabQuest, type QuestFixture } from './run';

export const LEVELS = { firemaking: 99, fishing: 1, magic: 99, agility: 75, ranged: 50, hitpoints: 70 } as const;

/** SCORED's own pack at S19 after H15's swap: the H15 runes on top of what S18 left. */
const BASE = { lawrune: 7, waterrune: 8, airrune: 20 } as const;
const WORN = ['staff_of_fire', 'rune_arrow'] as const;

type Items = Record<string, number>;
/** Quest items first: a full pack drops a ::give silently. The rune arrows are given to be worn. */
const pack = (q: Items): Items => ({ ...q, ...BASE, staff_of_fire: 1, rune_arrow: 570 });

const H15 = { swamppaste: 1, torch_unlit: 1 };
const PLATFORM = { torch_unlit: 1 };
const GLASS = { torch_unlit: 1, broken_glass: 1 };
const DRY = { torch_unlit: 1, broken_glass: 1, dry_sticks: 1 };
const LIT = { torch_lit: 1, broken_glass: 1, dry_sticks: 1 };

const fx = (letter: string, stage: number, q: Items, tile: QuestFixture['tile'], note?: string): QuestFixture => ({
    letter, levels: LEVELS, vars: { seaslugquest: stage }, items: pack(q), worn: WORN, tile, ...(note ? { note } : {}),
});

const CAROLINE = { x: 2716, z: 3302 };
const BY_HOLGART = { x: 2721, z: 3305 };
const LANDING = { x: 2782, z: 3273 };
const ISLAND = { x: 2800, z: 3320 };
const IN_KENNITH_ROOM = { x: 2764, z: 3286, level: 1 };

export const FIXTURES: readonly QuestFixture[] = [
    fx('A', 0, H15, CAROLINE, "Caroline's tile (T18-19: 2716,3302 tol 1), H15 held"),
    fx('B', 0, H15, CAROLINE),
    fx('C', 1, H15, CAROLINE),
    fx('D', 2, H15, BY_HOLGART),
    fx('E', 3, PLATFORM, LANDING),
    fx('F', 3, GLASS, { x: 2765, z: 3278 }),
    fx('G', 3, DRY, { x: 2784, z: 3289 }),
    fx('H', 4, DRY, IN_KENNITH_ROOM),
    fx('I', 5, DRY, ISLAND),
    fx('J', 6, DRY, { x: 2794, z: 3321 }),
    fx('K', 6, DRY, LANDING),
    fx('L', 7, LIT, LANDING),
    fx('M', 8, LIT, IN_KENNITH_ROOM),
    fx('N', 9, LIT, { x: 2766, z: 3288, level: 1 }),
    fx('O', 10, LIT, IN_KENNITH_ROOM),
    fx('P', 11, LIT, { x: 2768, z: 3290, level: 1 }),
    fx('Q', 11, LIT, { x: 2722, z: 3305 }),
];

/**
 * Reference ticks per segment on the fixed client, from sea_slug.md's step rows (measured with the
 * proven script, fixed lite client plus the bridge patch): B row 3 (15), C 4 (13), D 5 (18), E 6-7
 * (19 + 1), F 8-9 (21 + 3), G 10-12 (5 + 20 + 11), H 13-15 (15 + 24 + 15), I 16, J 17 (13), K 18
 * (0: the rub fell inside the walk as the rows were assembled), L 19-21 (30 + 11 + 8), M 22 (10),
 * N 23 (10), O 24 (13), P 25-27 (12 + 24 + 14), Q 28 (15). A is 0 here (H15 is traded during S18).
 * Sum 356; with sea_slug.md's 5-tick trade row, the entry's fixed fallback 361 (394 less its 33 of
 * travel).
 */
export const REFERENCE: Readonly<Record<string, number>> = {
    A: 0, B: 15, C: 13, D: 18, E: 20, F: 24, G: 36, H: 54, I: 16, J: 13, K: 0, L: 49, M: 10, N: 10, O: 13, P: 50, Q: 15,
};

/** 7,175 base Fishing at the server's rate 25 (caroline.rs2:45 stat_advance in tenths; WorldConfig xp rate). */
const REWARD_XP = 71750 * 2.5;
let xp0 = 0;

/** Shut `d` if it stands open (lab staging before a full chain), from beside it, then come back. */
export async function shut(session: Session, d: BridgedDoor, back: QuestFixture['tile']): Promise<void> {
    const sdk = session.sdk;
    await mustTele(sdk, d.open.x, d.open.z, d.level);
    await waitUntil(sdk, s => doorState(s, d) !== 'unseen', { maxTicks: 60 });
    if (doorState(sdk.getState()!, d) === 'open') {
        const open = sdk.getState()!.nearbyLocs.find(l => l.x === d.open.x && l.z === d.open.z && l.id === d.open.id) as NearbyLoc;
        const r = await opLoc(sdk, open, /^close$/i, s => doorState(s, d) === 'closed', { maxTicks: 10 });
        if (!r.ok) throw new Error(`lab: could not shut ${d.label}`);
    }
    await mustTele(sdk, back.x, back.z, back.level ?? 0);
    await waitTicks(sdk, 2);
}

const lab: LabQuest<Options> = {
    title: "Sea Slug (S19, SCORED's levels: Firemaking 99, Fishing 1; from Caroline's tile 2716,3302)",
    stepId,
    steps,
    fixtures: FIXTURES,
    reference: REFERENCE,
    async applyFixture(session: Session, f: QuestFixture) {
        await applyFixture(session, f);
        if (f.letter === 'A') for (const d of [DOORS.glass, DOORS.kennith]) await shut(session, d, f.tile);
    },
    async prepare(session: Session) {
        xp0 = skillXp(session.sdk, 'fishing');
    },
    async check(session: Session, _f: QuestFixture, rows: readonly TickRow[]) {
        const doors = rows.filter(r => r.kind === 'note' && (r.meta as { bridgedDoor?: unknown }).bridgedDoor).map(r => ({ step: r.step, ...(r.meta as { bridgedDoor: DoorOutcome }).bridgedDoor }));
        result(`${stepId}_doors`, { doors });
        const shutDoor = doors.find(d => d.after !== 'open');
        if (shutDoor) return `${shutDoor.door} at ${shutDoor.step} ended ${shutDoor.after} (before ${shutDoor.before})`;
        if (!rows.some(r => r.step === `${stepId}:Q-caroline-reward` && !r.kind)) return undefined;
        const s = session.sdk.getState()!;
        if (questStatus(s, quest) !== 'complete') return 'the quest is not complete after Q';
        const gained = skillXp(s, 'fishing') - xp0;
        result(`${stepId}_reward`, { fishingXpGained: gained, fishingLevel: skillLevel(s, 'fishing'), expected: REWARD_XP });
        if (gained < REWARD_XP) return `Fishing xp gained ${gained}, the reward is ${REWARD_XP}`;
        const dead = s.inventory.filter(isDead).map(i => i.name);
        if (dead.length) return `exit: still holding ${dead.join(', ')}`;
        return undefined;
    },
};

if (import.meta.main) {
    await labMain(lab);
    process.exit(0);
}
