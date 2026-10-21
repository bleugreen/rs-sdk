// Live reachability probe for Isafdar: teleport, then click-walk toward each
// target and report where the client's own routefinder (live map) stops.
//
//   bun docs/speedrun/scripts/quest-regicide-probe.ts <bot> <stage> <x,z> <tx,tz>[;<tx,tz>...]
//
// Each target is clicked repeatedly (a click routes at most ~25 turns inside the
// loaded 104x104 area, primitives.md section 2) until the bot stops moving.

import { runScript } from '../../../sdk/runner';
import { cheat, now, pos, tele, waitTicks, waitUntil } from './quest-primitives-lib';

const [stage, from, targets] = process.argv.slice(3);
const [fx, fz] = from.split(',').map(Number);
const list = targets.split(';').map(t => t.split(',').map(Number));

await runScript(async ({ sdk }) => {
    await cheat(sdk, `setvar regicide_quest ${stage}`);
    await waitTicks(sdk, 1);
    await tele(sdk, fx, fz, 0);
    for (const [tx, tz] of list) {
        const t0 = now(sdk);
        let last = pos(sdk.getState());
        let still = 0;
        while (still < 4 && now(sdk) - t0 < 400) {
            const cur = pos(sdk.getState());
            const clamp = (d: number) => Math.max(-40, Math.min(40, d));
            await sdk.sendWalk(cur.x + clamp(tx - cur.x), cur.z + clamp(tz - cur.z), true);
            await waitTicks(sdk, 3);
            const p = pos(sdk.getState());
            if (p.x === last.x && p.z === last.z) still++;
            else still = 0;
            last = p;
            if (p.x === tx && p.z === tz) break;
        }
        console.log(`RESULT walk ${JSON.stringify({ target: [tx, tz], end: [last.x, last.z], ticks: now(sdk) - t0 })}`);
    }
    void waitUntil;
}, { timeout: 600_000 });
