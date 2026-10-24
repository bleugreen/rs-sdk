// Monkey Madness: how a monkey reaches Kruk (mm_kruk, spawn (2726,2765) by the
// west gate's watchtower). Stages segment S's fixture, then from each side of
// the gate logs Kruk's live tile, the SDK path toward him, and what a Talk-to
// does over the next ticks (the server's own NPC pathing): the player's tile,
// the dialog and the messages.
//
//   LAB_RUNNERS=0 speedrun/lab/lab.sh <bot> speedrun/lab/measure-mm-kruk.ts:--launch

import { openSession } from '../lib/session';
import { waitTicks } from '../lib/wait';
import { pos } from '../lib/world';
import { applyFixture } from './quests/monkey-madness';
import { botArg } from './common';
import { leaveTutorial, mustTele } from './setup';

const session = await openSession(botArg(), process.argv.includes('--launch') ? { launch: true } : {});
const { sdk } = session;
await leaveTutorial(session);
const starts = [
    { name: 'north (town side)', x: 2722, z: 2768 },
    { name: 'south (ravine side)', x: 2720, z: 2764 },
    { name: 'east of the watchtower', x: 2733, z: 2765 },
    { name: 'where the walk from the elder guard stops', x: 2737, z: 2765 },
    { name: 'where the walk from the elder guard stops, a walk click first', x: 2737, z: 2765, click: { x: 2733, z: 2765 } },
];
for (const st of starts as ReadonlyArray<{ name: string; x: number; z: number; click?: { x: number; z: number } }>) {
    await applyFixture(sdk, 'S', { potions: 2 });
    await mustTele(sdk, st.x, st.z, 0);
    await waitTicks(sdk, 3);
    const kruk = sdk.getState()!.nearbyNpcs.find(n => /^Kruk$/i.test(n.name));
    console.log(`START ${st.name} at ${JSON.stringify(pos(sdk))}: Kruk ${kruk ? `${kruk.tileX ?? kruk.x},${kruk.tileZ ?? kruk.z} dist ${kruk.distance} ops ${kruk.optionsWithIndex.map(o => o.text).join('/')}` : 'not seen'}`);
    if (!kruk) continue;
    for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const tx = (kruk.tileX ?? kruk.x) + dx, tz = (kruk.tileZ ?? kruk.z) + dz;
        const p = sdk.findPath ? await sdk.findPath(tx, tz) : null;
        console.log(`  PATH to ${tx},${tz}: ${p ? `${p.success ? 'ok' : 'FAIL'} ${p.waypoints?.length ?? 0} wp, reached ${p.reachedDestination}` : 'n/a'}`);
    }
    if (st.click) {
        await sdk.sendWalk(st.click.x, st.click.z, true);
        await waitTicks(sdk, 8);
        console.log(`  CLICK to ${st.click.x},${st.click.z}: at ${JSON.stringify(pos(sdk))}`);
    }
    const t0 = sdk.getState()!.tick;
    await sdk.sendInteractNpc(kruk.index, kruk.optionsWithIndex.find(o => /talk/i.test(o.text))?.opIndex ?? 1);
    let last = '';
    for (let i = 0; i < 25; i++) {
        await waitTicks(sdk, 1);
        const s = sdk.getState()!;
        const k = s.nearbyNpcs.find(n => /^Kruk$/i.test(n.name));
        const line = `${JSON.stringify(pos(s))} kruk ${k ? `${k.tileX ?? k.x},${k.tileZ ?? k.z}` : '-'} dialog ${s.dialog.isOpen ? (s.dialog.allComponents ?? []).map(c => c.text).join(' ').slice(0, 60) : '-'}`;
        if (line !== last) console.log(`  t+${s.tick - t0} ${line}`);
        last = line;
        if (s.dialog.isOpen) break;
    }
    console.log(`  MSGS ${JSON.stringify(sdk.getState()!.gameMessages.filter(m => m.tick >= t0).map(m => m.text))}`);
}
process.exit(0);
