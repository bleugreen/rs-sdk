// Monkey Madness: where the temple rope lands. The rope under the trapdoor
// teleports the player to map_findsquare((2807,2785), 1, 2, line of sight)
// (mm_temple.rs2), a random tile beside the trapdoor guards' box; some tiles
// are boxed in by the guards. Climbs it --runs times (Protect from Melee on,
// HP 99) and prints each landing tile, then the counts.
//
// --trapdoor=1 also tries the trapdoor from each landing off its access tile.
//
//   speedrun/lab/lab.sh <bot> speedrun/lab/measure-mm-rope.ts:--runs=15:--trapdoor=1

import { opLoc } from '../lib/act';
import { setPrayer } from '../lib/combat';
import { openSession } from '../lib/session';
import { waitTicks, waitUntil } from '../lib/wait';
import { pos } from '../lib/world';
import { arg, botArg } from './common';
import { cheat, mustTele, setStats } from './setup';

const runs = Number(arg('runs', '15'));
const tryTrapdoor = arg('trapdoor', '0') === '1';
const session = await openSession(botArg());
const { sdk } = session;
await setStats(sdk, { hitpoints: 99, prayer: 94, defence: 1 });
await cheat(sdk, 'setvar mm_main 3');
const counts = new Map<string, number>();
for (let i = 0; i < runs; i++) {
    await mustTele(sdk, 2808, 9200);
    await waitTicks(sdk, 1);
    await setPrayer(sdk, 'protect_from_melee', true);
    const r = await opLoc(sdk, { x: 2808, z: 9201, op: /climb/i, radius: 5 }, /climb/i, s => pos(s).z < 9000, { maxTicks: 20, resendEvery: 5 });
    await waitTicks(sdk, 1);
    const p = pos(sdk);
    const k = `${p.x},${p.z}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
    // From each landing, can the trapdoor (op1: open, then climb down) be used, to draw the landing again?
    let down = 'skipped';
    if (tryTrapdoor && r.ok && k !== '2806,2785') {
        const t0 = sdk.getState()!.tick;
        let sent = -10;
        const d = await waitUntil(sdk, s => {
            if (pos(s).z > 9000) return true;
            if (s.tick - sent >= 3) {
                sent = s.tick;
                const l = s.nearbyLocs.find(x => x.x === 2807 && x.z === 2785 && /trapdoor/i.test(x.name));
                if (l) void sdk.sendInteractLoc(l.x, l.z, l.id, l.optionsWithIndex[0]?.opIndex ?? 1);
            }
            return false;
        }, { maxTicks: 12 });
        const msgs = sdk.getState()!.gameMessages.filter(m => m.tick >= t0).map(m => m.text);
        down = d.ok ? `DOWN in ${sdk.getState()!.tick - t0}` : `no (${JSON.stringify(msgs)})`;
    }
    console.log(`LAND ${i} ${r.ok ? k : 'FAILED'} trapdoor: ${down}`);
    await waitTicks(sdk, 6); // the trapdoor's fade-in (mm_temple.rs2: p_delay 3 + 3) refuses a teleport
}
console.log(`LANDINGS ${JSON.stringify(Object.fromEntries(counts))}`);
await setPrayer(sdk, 'protect_from_melee', false);
process.exit(0);
