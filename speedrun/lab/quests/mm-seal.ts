// Lab: S15:A re-run with Monkey Madness already started at given_seal (mm_main 1, mm_narnode 3), as a run that lost
// the royal seal after A leaves it (rs/764 F8). Fixture A's kit and tile (lab/quests/monkey-madness.ts), H12 taken as
// served (kitServed), then by --seal:
//   none  no seal, the fixture's 1 free slot: A takes Narnode's spare from his menu and ends holding it
//   held  the seal held: A's precondition passes and A ends with no talk
//   full  no seal and 0 free (a shark in the free slot): A's precondition is the named refusal
//
//   LAB_RUNNERS=0 speedrun/lab/lab.sh <bot> speedrun/lab/quests/mm-seal.ts:--seal=none speedrun/lab/quests/mm-seal.ts:--seal=held ...

import { closeSession, openSession, relog } from '../../lib/session';
import { questStatus } from '../../lib/quests';
import { TickLog } from '../../lib/ticks';
import { pos } from '../../lib/world';
import { MM_OBJ, seg, steps, type MmContext } from '../../quests/monkey-madness';
import { runSteps } from '../../runner/step';
import { arg, botArg, result } from '../common';
import { give, leaveTutorial, setVars } from '../setup';
import { applyFixture } from './monkey-madness';

const mode = arg('seal', 'none');
if (!['none', 'held', 'full'].includes(mode)) throw new Error(`--seal=${mode}: want none, held or full`);

const session = await openSession(botArg(), { launch: true });
const { sdk } = session;
await leaveTutorial(session);
const A = steps({ note: line => console.log(line), kitServed: () => true })[seg('A')]!;

await applyFixture(sdk, 'A');
await setVars(sdk, { mm_main: 1, mm_narnode: 3 });
if (mode === 'held') await give(sdk, 'mm_gnome_royal_seal', 1);
if (mode === 'full') await give(sdk, 'shark', 1);
// ::setvar changes the varps but not the quest tab until a login (login.rs2 ~update_questlist).
await relog(session);

const sealed = () => [...sdk.getState()!.inventory, ...sdk.getState()!.equipment].some(i => i.id === MM_OBJ.royalSeal);
const s0 = sdk.getState()!;
const staged = { mode, mm: questStatus(s0, 'mm'), free: 28 - s0.inventory.length, seal: sealed(), at: pos(s0), tick: s0.tick };
result('seal_staged', staged);
const pre = A.preconditions(s0, {} as MmContext);
result('seal_pre', { mode, pre });

let error: string | undefined;
const sent: string[] = [];
const unsent = sdk.onStateUpdate(() => undefined);
if (pre === true) {
    const log = TickLog.memory();
    try {
        await runSteps(session, [A], { log, c: {} as MmContext, shouldStop: () => false, from: 0, startMode: 'run' });
    } catch (e) {
        error = e instanceof Error ? e.message : String(e);
    }
    const s1 = sdk.getState()!;
    result('seal_run', { mode, ok: !error, ...(error ? { error } : {}), seal: sealed(), dialogOpen: s1.dialog.isOpen, ticks: log.rows.map(r => [r.step, r.ticks, r.ok]), free: 28 - s1.inventory.length, at: pos(s1) });
}
unsent();
void sent;
await closeSession(session);
process.exit(0);
