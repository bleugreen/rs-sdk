// Lab for Sea Slug's E (the broken glass) with another player taking the glass first (rs/661):
//
//   LAB_RUNNERS=0 LAB_HELPERS=<taker> speedrun/lab/lab.sh <bot> \
//     'speedrun/lab/quests/sea-slug-taker.ts:--taker=<taker>:--take=both:--from=E:--until=F:--runs=3:--launch'
//   (browser: add --client=browser, with this checkout's webclient built)
//
// --take=none|first|both. Before each run, with SCORED on E's fixture tile (the platform landing),
// both spawns holding a glass and both doors shut (lab staging, not counted), the taker (a second
// lab bot on its own lite runner, LAB_HELPERS) teleports onto the glass room's spawn (first) and the
// store room's too (both), picks the glass up and teleports away, a few ticks before E starts: the
// worst case, a respawn a full 100 ticks off. `check` fails a run whose E pickup took another path
// than --take implies (none: spawn, first: second spawn, both: respawn wait) or left a door shut.
//
// The spawns and the store room door are written out here rather than imported, so the same script
// runs against the module before rs/661 (main 1e536f76), whose E failed after a 60-tick wait.

import type { BotWorldState } from '../../../sdk/types';
import { act } from '../../lib/act';
import { closeSession, openSession, type Session } from '../../lib/session';
import type { TickRow } from '../../lib/ticks';
import { waitTicks } from '../../lib/wait';
import { configId, invCount } from '../../lib/world';
import { DOORS, ITEM, stepId, steps, type BridgedDoor, type DoorOutcome, type Options } from '../../quests/sea-slug';
import { arg, result } from '../common';
import { clearInventory, leaveTutorial, mustTele } from '../setup';
import { labMain, STAGING, type LabQuest } from './run';
import { FIXTURES, REFERENCE, shut } from './sea-slug';

const GLASS_AT = { x: 2765, z: 3278 };
const GLASS_AT_2 = { x: 2765, z: 3289 };
const STORE_DOOR: BridgedDoor = {
    label: 'the store room door', level: 0,
    closed: { x: 2765, z: 3287, id: configId('loc', 'loc_1533') },
    open: { x: 2766, z: 3287, id: configId('loc', 'loc_1534') },
};
const LANDING = FIXTURES.find(f => f.letter === 'E')!.tile;

const TAKE = arg('take', 'both');
const PLANS: Record<string, { taken: Array<{ x: number; z: number }>; path: string }> = {
    none: { taken: [], path: 'spawn' },
    first: { taken: [GLASS_AT], path: 'second spawn' },
    both: { taken: [GLASS_AT, GLASS_AT_2], path: 'respawn wait' },
};
const plan = PLANS[TAKE];
if (!plan) throw new Error(`--take=${TAKE}: want none, first or both`);
const TAKER = arg('taker', '');
if (!TAKER && plan.taken.length) throw new Error('--taker=<lab bot> is required unless --take=none');

let taker: Session | null = null;
let run = 0;
let takenAt = -1;

const glassOn = (list: BotWorldState['groundItems'], at: { x: number; z: number }) => list.some(g => g.id === ITEM.glass && g.x === at.x && g.z === at.z);

/** From the landing (both spawns 17 tiles off, in a 25-tile scan): wait until both hold a glass again after the run before. */
async function spawnsBack(s: Session): Promise<number> {
    const t0 = s.sdk.getState()!.tick;
    for (;;) {
        const g = await s.sdk.scanGroundItems(25);
        if (glassOn(g, GLASS_AT) && glassOn(g, GLASS_AT_2)) return s.sdk.getState()!.tick - t0;
        if (s.sdk.getState()!.tick - t0 > 130) throw new Error('lab: the two glass spawns did not both hold a glass within 130 ticks');
        await waitTicks(s.sdk, 2);
    }
}

/** The taker on the spawn's tile picks its glass up. */
async function take(t: Session, at: { x: number; z: number }): Promise<void> {
    await mustTele(t.sdk, at.x, at.z, 0);
    const before = invCount(t.sdk, ITEM.glass);
    const r = await act(t.sdk, () => t.sdk.sendPickup(at.x, at.z, ITEM.glass), s => invCount(s, ITEM.glass) > before, { maxTicks: 20, resendEvery: 3 });
    if (!r.ok) throw new Error(`lab: the taker could not take the glass at ${at.x},${at.z} (${r.reason})`);
}

const lab: LabQuest<Options> = {
    title: `Sea Slug E-F, the taker took ${TAKE === 'none' ? 'nothing' : TAKE === 'first' ? "the glass room's glass" : 'both glasses'} just before E`,
    stepId,
    steps,
    fixtures: FIXTURES,
    reference: REFERENCE,
    async prepare(session: Session) {
        const back = await spawnsBack(session);
        // Both doors shut, as on a first visit; by the taker when there is one, so SCORED stays on its tile.
        const who = taker ?? session;
        const home = taker ? STAGING : LANDING;
        if (taker) {
            await mustTele(taker.sdk, STAGING.x, STAGING.z, 0);
            await clearInventory(taker.sdk);
        }
        for (const d of [DOORS.glass, STORE_DOOR]) await shut(who, d, home);
        for (const at of plan.taken) await take(taker!, at);
        if (taker) await mustTele(taker.sdk, STAGING.x, STAGING.z, 0);
        takenAt = plan.taken.length ? session.sdk.getState()!.tick : -1;
        result(`${stepId}_taker_staged`, { run, take: TAKE, waitedForSpawns: back, scoredTickAtTake: takenAt });
    },
    async check(session: Session, _f, rows: readonly TickRow[]) {
        const notes = rows.filter(r => r.kind === 'note').map(r => ({ step: r.step, ...(r.meta as Record<string, unknown>) }));
        const pickup = notes.find(n => n.pickup === 'the broken glass');
        const seg = (l: string) => rows.find(r => !r.kind && r.step.startsWith(`${stepId}:${l}-`));
        const e = seg('E');
        result(`${stepId}_taker_run`, {
            run: run++, take: TAKE, expect: plan.path, pickup, eTicks: e?.ticks, fTicks: seg('F')?.ticks,
            eStartTicksAfterTake: e && takenAt >= 0 ? e.tick - e.ticks - takenAt : null,
        });
        const doors = notes.filter(n => n.bridgedDoor).map(n => ({ step: n.step, ...(n.bridgedDoor as DoorOutcome) }));
        const shutDoor = doors.find(d => d.after !== 'open');
        if (shutDoor) return `${shutDoor.door} at ${shutDoor.step} ended ${shutDoor.after}`;
        if (!pickup) return 'E recorded no pickup of the broken glass';
        if (pickup.path !== plan.path) return `E took the ${String(pickup.path)} path; --take=${TAKE} expects ${plan.path}`;
        if (!seg('F')?.ok) return 'F did not pass';
        return undefined;
    },
};

if (import.meta.main) {
    if (TAKER && plan.taken.length) {
        taker = await openSession(TAKER);
        await leaveTutorial(taker);
    }
    try {
        await labMain(lab);
    } finally {
        if (taker) await closeSession(taker);
    }
    process.exit(0);
}
