// Two lab checks behind docs/speedrun/quests/grand_tree.md's risk notes.
//
//   LAB_RUNNERS=0 speedrun/lab/lab.sh <bot> 'speedrun/lab/quests/grand-tree-probes.ts'
//
// translation: at stage 20, answer Narnode's first set wrongly and follow the wrong-only sets to
//   their end, then run segment C from the same spot. Shows where a wrong answer ends and that a
//   fresh talk at stage 20 starts the choices again.
// demon: at stage 130 with every prayer off, open the trapdoor, run Glough's scene, then stand
//   still for 40 ticks without attacking. Logs HP and the demon's distance each tick; Protect from
//   Melee goes on if HP falls below 15, so the probe never dies.

import { opLoc, talkTo } from '../../lib/act';
import { converse } from '../../lib/converse';
import { closeSession, openSession, relog } from '../../lib/session';
import { TickLog } from '../../lib/ticks';
import { waitTicks } from '../../lib/wait';
import { findNpc, pos, skillLevel } from '../../lib/world';
import { BOUNDARY_STEP, runSteps } from '../../runner/step';
import { demonInSight, steps, TILES } from '../../quests/grand-tree';
import { botArg, result } from '../common';
import { cheat, clearInventory, give, mustTele, setStats, setvar } from '../setup';

const session = await openSession(botArg(), { launch: true });
const { sdk } = session;

async function fixture(stage: number, at: [number, number, number], items: string[]): Promise<void> {
    await clearInventory(sdk);
    await setStats(sdk, { attack: 80, strength: 1, defence: 1, hitpoints: 28, magic: 64, prayer: 94, agility: 22 });
    await setvar(sdk, 'treequest', 9);
    await setvar(sdk, 'elenaquest', 30);
    await setvar(sdk, 'grandtree', stage);
    await give(sdk, items);
    await mustTele(sdk, at[0], at[1], at[2]);
    await relog(session);
    await waitTicks(sdk, 2);
}

try {
    await cheat(sdk, 'setvar tutorial 1000');

    // ---- translation
    await fixture(20, [2464, 3497, 0], ['grandtree_translationbook', 'grandtree_scroll']);
    const wrong = await talkTo(sdk, /^King Narnode( Shareen)?$/i, [/I think so/i, /time has come to attack/i, /./, /./, /./, /./], { idle: 3 });
    console.log(`wrong answers: ok ${wrong.ok}, ${wrong.transcript.length} pages; last: ${wrong.transcript.slice(-3).join(' | ')}`);
    const log = TickLog.open(`lab-grand-tree-probe-translation-${Date.now()}`);
    let retalk = '';
    try {
        await runSteps(session, [steps()[2]!], { log, c: {}, shouldStop: () => false });
    } catch (e) {
        retalk = e instanceof Error ? e.message : String(e);
    }
    const cRow = log.rows.find(r => !r.kind && r.step !== BOUNDARY_STEP);
    console.log(`segment C after the wrong answers: ${retalk ? `FAILED ${retalk}` : `done in ${cRow?.ticks} ticks`}`);
    result('grand_tree_probe_translation', { wrongOk: wrong.ok, wrongPages: wrong.transcript, retalkOk: !retalk, retalkError: retalk || undefined, retalkTicks: cRow?.ticks });

    // ---- demon
    await fixture(130, [2487, 3465, 2], []);
    const trail: string[] = [];
    const hp0 = skillLevel(sdk, 'hitpoints');
    let lowest = hp0;
    let protectedAt = -1;
    const unsub = sdk.onStateUpdate(s => {
        const hp = skillLevel(s, 'hitpoints');
        lowest = Math.min(lowest, hp);
        const d = findNpc(s, /^Black demon$/i);
        trail.push(`[${s.tick}] hp ${hp} demon ${d ? `@${d.distance}` : '-'} dialog ${s.dialog?.isOpen ? 'open' : '-'}`);
        if (hp < 15 && protectedAt < 0) {
            protectedAt = s.tick;
            void sdk.sendTogglePrayer('protect_from_melee');
        }
    });
    try {
        const prayersOn = (sdk.getState()?.prayers?.activePrayers ?? []).filter(Boolean).length;
        await opLoc(sdk, { name: /trapdoor/i, near: TILES.trapdoor, radius: 3 }, /^open$/i, s => pos(s).z > 6400, { maxTicks: 20 });
        const scene = await converse(sdk, [], { idle: 2, openTicks: 20, maxTicks: 80, until: demonInSight, closeModals: true, unmatched: 'stop' });
        const hpScene = skillLevel(sdk, 'hitpoints');
        await waitTicks(sdk, 40);
        const hpEnd = skillLevel(sdk, 'hitpoints');
        console.log(`demon: prayers on at the trapdoor ${prayersOn}; scene ${scene.transcript.length} pages, demon in sight ${demonInSight(sdk.getState()!)}; hp ${hp0} -> ${hpScene} after the scene -> ${hpEnd} after 40 still ticks; lowest ${lowest}; protect forced at ${protectedAt}`);
        console.log(`  trail:\n  ${trail.slice(-60).join('\n  ')}`);
        result('grand_tree_probe_demon', { prayersOn, scenePages: scene.transcript.length, hp0, hpScene, hpEnd, lowest, protectedAt });
    } finally {
        unsub();
    }
} finally {
    await closeSession(session);
}
process.exit(0);
