// Lab acceptance for the Doric's Quest module (speedrun/quests/dorics-quest.ts, S05):
//
//   LAB_RUNNERS=0 speedrun/lab/lab.sh <bot> 'speedrun/lab/quests/dorics-quest.ts:--from=A:--until=C:--runs=3:--dialogue=both:--launch'
//
// --shut-in starts B and C outside Doric's west door with the door closed and Doric inside his room:
// the wander case that leaves every Talk-to unrouted without the talk's approach (lib/approach.ts).
//
// SCORED's levels on arrival at S05 (RUN-ORDER.md): Magic 59 (S04), Firemaking 99 (S03), Mining 1,
// Hitpoints 10. The pack is the inventory ledger's after H4 (STEP-MANIFEST.md, walked by
// tools/slot-ledger.ts: the ores, the air talisman, the law and air runes, the staff of water worn),
// so segment A finds H4 landed and costs nothing here: the trade with the rings is runner/handoff.ts's
// swap, measured by rs/285 at 6 ticks with the 20 rings and 6 without. Ticks are from Doric's tile
// (2952,3451): T04-05's 44 are not in them.

import type { BotWorldState } from '../../../sdk/types';
import { openDoor, opLoc } from '../../lib/act';
import { npcTile } from '../../lib/approach';
import { questStatus } from '../../lib/quests';
import type { Session } from '../../lib/session';
import type { TickRow } from '../../lib/ticks';
import { waitUntil } from '../../lib/wait';
import { findNpc, opIndex, pos, skillXp } from '../../lib/world';
import { result } from '../common';
import { ARRIVAL, quest, stepId, steps, type Options } from '../../quests/dorics-quest';
import { fixturePack, ledgerAfter } from './ledger';
import { labMain, type LabQuest, type QuestFixture } from './run';

export const LEVELS = { magic: 59, firemaking: 99, mining: 1, hitpoints: 10 } as const;

const AFTER_H4 = fixturePack(ledgerAfter('H4'));
const SHUT_IN = process.argv.includes('--shut-in');

/**
 * Doric's room (maps/m46_53): x 2950-2953, z 3449-3452. Its west door, loc 1530 at (2949,3450), has
 * its wall on the tile's east edge, so the door tile is outside; Doric's wanderrange 3 reaches it.
 */
export const ROOM = { x0: 2950, z0: 3449, x1: 2953, z1: 3452 } as const;
export const WEST_DOOR = { x: 2949, z: 3450 } as const;
/** Outside the west door, inside the module's HOUSE box (its preconditions hold). */
export const OUTSIDE_WEST = { x: 2948, z: 3450 } as const;

const tile = SHUT_IN ? OUTSIDE_WEST : { x: ARRIVAL.x, z: ARRIVAL.z };
const DORIC = /^doric$/i;
const inRoom = (s: BotWorldState) => {
    const d = findNpc(s, DORIC, ARRIVAL);
    if (!d) return false;
    const t = npcTile(d);
    return t.x >= ROOM.x0 && t.x <= ROOM.x1 && t.z >= ROOM.z0 && t.z <= ROOM.z1;
};
const doorShut = (s: BotWorldState) => s.nearbyLocs.some(l => l.x === WEST_DOOR.x && l.z === WEST_DOOR.z && /door/i.test(l.name) && opIndex(l, /^open$/i) !== undefined);
/** The west door standing open: an opened door's loc can sit on a tile beside its doorway (m: none with Close at 2949,3450 once opened). */
const openDoorLoc = (s: BotWorldState) => s.nearbyLocs.find(l => Math.max(Math.abs(l.x - WEST_DOOR.x), Math.abs(l.z - WEST_DOOR.z)) <= 1 && /door/i.test(l.name) && opIndex(l, /^close$/i) !== undefined);

/** Doric inside his room, SCORED outside, the west door closed between them; retried while he wanders out. */
async function shutDoricIn(session: Session): Promise<void> {
    const sdk = session.sdk;
    for (let i = 0; i < 6; i++) {
        // Let him back in when he stands outside it.
        if (!inRoom(sdk.getState()!) && doorShut(sdk.getState()!)) await openDoor(sdk, WEST_DOOR.x, WEST_DOOR.z);
        await waitUntil(sdk, inRoom, { maxTicks: 40 });
        const open = openDoorLoc(sdk.getState()!);
        if (!doorShut(sdk.getState()!) && open) await opLoc(sdk, open, /^close$/i, doorShut, { maxTicks: 15 });
        const s = sdk.getState()!;
        if (inRoom(s) && doorShut(s) && pos(s).x <= WEST_DOOR.x) {
            const d = findNpc(s, DORIC, ARRIVAL)!;
            result('S05_shut_in', { tick: s.tick, doric: npcTile(d), reachable: d.reachable ?? 'unpublished', player: pos(s), attempt: i + 1 });
            return;
        }
    }
    throw new Error('shut-in: could not leave Doric inside with the west door closed in 6 tries');
}

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
    title: SHUT_IN
        ? "Doric's Quest (S05, SCORED's levels; the ledger's pack after H4; Doric shut in: SCORED outside the closed west door at 2948,3450)"
        : "Doric's Quest (S05, SCORED's levels: Magic 59, Mining 1, HP 10; the ledger's pack after H4; from Doric's tile 2952,3451)",
    stepId,
    steps,
    fixtures: FIXTURES,
    reference: REFERENCE,
    async prepare(session: Session, f: QuestFixture) {
        xp0 = skillXp(session.sdk, 'mining');
        if (SHUT_IN && f.letter !== 'A') await shutDoricIn(session);
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
