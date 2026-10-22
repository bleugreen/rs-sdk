// Monkey Madness patrols on the lab engine: log named NPCs' tiles every tick
// while the player stands still, to find the windows a route can use.
//
// Default: the jail patrol's gorillas (Aberab, Trefaji) from inside the cell.
// The yard's exit runs from the cell door north to (2772,2801), then west
// through (2766,2799), along the patrol's own route (configs/quest_mm.enum
// mm_jail_patrol_route).
//
// --npc and --at measure another patrol, e.g. the Monkey's Aunt (configs/
// quest_mm.npc patrol1-8) round the house the monkey child is in, from a
// tile more than 5 from her route (her hunt radius, mm_monkeys_aunt.rs2):
//
//   speedrun/lab/lab.sh <bot> speedrun/lab/measure-mm-patrol.ts:--ticks=300
//   speedrun/lab/lab.sh <bot> speedrun/lab/measure-mm-patrol.ts:--ticks=400:--npc=Aunt|Monkey Child:--at=2752,2797

import { openSession } from '../lib/session';
import { waitTicks } from '../lib/wait';
import { arg, botArg } from './common';
import { cheat, mustTele } from './setup';

const ticks = Number(arg('ticks', '300'));
const npc = new RegExp(arg('npc', '^(Aberab|Trefaji)$'));
const [x, z] = arg('at', '2774,2794').split(',').map(Number) as [number, number];
const session = await openSession(botArg());
const { sdk } = session;

await cheat(sdk, 'setvar mm_main 3');
await mustTele(sdk, x, z);
await waitTicks(sdk, 2);
let last = '';
const stop = sdk.onStateUpdate(s => {
    const g = s.nearbyNpcs.filter(n => npc.test(n.name)).map(n => `${n.name.replace(/^The |[^A-Za-z]/g, '')}@${n.tileX ?? n.x},${n.tileZ ?? n.z}`).sort().join(' ');
    if (g !== last) console.log(`PATROL t=${s.tick} ${g}`);
    last = g;
});
await waitTicks(sdk, ticks);
stop();
process.exit(0);
