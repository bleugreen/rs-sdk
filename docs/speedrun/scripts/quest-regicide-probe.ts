// Live reachability probe for Isafdar: teleport, then click-walk toward each
// target and report where the client's own routefinder (live map) stops.
//
//   bun docs/speedrun/scripts/quest-regicide-probe.ts <bot> <stage> <x,z> <tx,tz>[;<tx,tz>...]
//
// Each target is clicked repeatedly (a click routes at most ~25 turns inside the
// loaded 104x104 area, primitives.md section 2) until the bot stops moving.

import { runScript } from '../../../sdk/runner';
import { mustTele, setvar } from '../../../speedrun/lab/setup';
import { currentTick, waitTicks } from '../../../speedrun/lib/wait';
import { pos } from '../../../speedrun/lib/world';

const [stage, from, targets] = process.argv.slice(3);
if (!stage || !from) throw new Error('usage: quest-regicide-probe.ts <bot> <stage> <x,z> <tx,tz>[;<tx,tz>...]');
const [fx, fz] = from.split(',').map(Number) as [number, number];
const list = (targets ?? '').split(';').filter(t => /\d/.test(t)).map(t => t.split(',').map(Number) as [number, number]);

await runScript(async ({ sdk }) => {
    await setvar(sdk, 'regicide_quest', Number(stage));
    await mustTele(sdk, fx, fz, 0);
    if (list.length === 0 || process.argv.includes('--locs')) {
        await waitTicks(sdk, 2);
        const locs = await sdk.scanNearbyLocs(8);
        console.log('RESULT pos', JSON.stringify(pos(sdk)));
        console.log('RESULT locs', JSON.stringify(locs.map(l => `${l.name}#${l.id}@${l.x},${l.z},${l.level}:${l.options.join('/')}`)));
    }
    for (const [tx, tz] of list) {
        const t0 = currentTick(sdk);
        let last = pos(sdk);
        let still = 0;
        while (still < 4 && currentTick(sdk) - t0 < 400) {
            const cur = pos(sdk);
            const clamp = (d: number) => Math.max(-40, Math.min(40, d));
            await sdk.sendWalk(cur.x + clamp(tx - cur.x), cur.z + clamp(tz - cur.z), true);
            await waitTicks(sdk, 3);
            const p = pos(sdk);
            if (p.x === last.x && p.z === last.z) still++;
            else still = 0;
            last = p;
            if (p.x === tx && p.z === tz) break;
        }
        console.log(`RESULT walk ${JSON.stringify({ target: [tx, tz], end: [last.x, last.z], ticks: currentTick(sdk) - t0 })}`);
    }
}, { timeout: 600_000 });
