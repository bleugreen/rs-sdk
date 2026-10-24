// Monkey Madness: the jail exit (quests/monkey-madness.ts leaveCell) from
// inside the cell, logging the player's and both patrol gorillas' tiles every
// tick, so a knockout can be laid against what the patrol was doing.
//
//   speedrun/lab/lab.sh <bot> speedrun/lab/measure-mm-jail-exit.ts:--runs=3

import { openSession } from '../lib/session';
import { currentTick, waitTicks } from '../lib/wait';
import { leaveCell, inCell } from '../quests/monkey-madness';
import { ROUTE_LEVELS } from './quests/monkey-madness';
import { arg, botArg, result } from './common';
import { cheat, mustTele, setStats } from './setup';

const runs = Number(arg('runs', '3'));
const session = await openSession(botArg());
const { sdk } = session;

await cheat(sdk, 'setvar mm_main 3');
await setStats(sdk, ROUTE_LEVELS);
for (let run = 0; run < runs; run++) {
    await mustTele(sdk, 2774, 2794);
    await waitTicks(sdk, 2);
    let jailed = 0;
    let wasIn = true;
    const stop = sdk.onStateUpdate(s => {
        const p = s.player!;
        const g = s.nearbyNpcs.filter(n => /^(Aberab|Trefaji)$/.test(n.name)).map(n => `${n.name[0]}${n.tileX ?? n.x},${n.tileZ ?? n.z}`).sort().join(' ');
        const now = inCell(s);
        if (now && !wasIn) jailed++;
        wasIn = now;
        console.log(`JAIL t=${s.tick} me=${p.worldX},${p.worldZ}${now ? '(cell)' : ''} ${g}`);
    });
    const t0 = currentTick(sdk);
    let error: string | undefined;
    let r: Awaited<ReturnType<typeof leaveCell>> | undefined;
    try {
        r = await leaveCell(sdk as never);
    } catch (e) {
        error = String(e);
    }
    stop();
    result('mm_jail_exit', { run, ok: !error, error, ticks: currentTick(sdk) - t0, rejailed: jailed, ...r });
}
process.exit(0);
