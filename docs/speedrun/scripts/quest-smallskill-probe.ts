// Lists locs (with options), ground items and NPCs around a tile, for building
// the step lists of the small self-skill quests. Optional varp set first.
// Run: PROBE='x z level [radius] [varp=value ...]' bash docs/speedrun/scripts/quest-smallskill-lab.sh <bot> docs/speedrun/scripts/quest-smallskill-probe.ts

import { runScript } from '../../../sdk/runner';
import { waitTicks } from '../../../speedrun/lib/wait';
import { mustTele, setvar } from '../../../speedrun/lab/setup';

const args = (process.env.PROBE ?? '').trim().split(/\s+/);
const [x, z, level, radius] = args.slice(0, 4).map(Number);
const vars = args.slice(4).filter(a => a.includes('=')).map(a => a.split('=') as [string, string]);

await runScript(async ({ sdk }) => {
    for (const [k, v] of vars) await setvar(sdk, k, Number(v));
    await mustTele(sdk, x!, z!, level!);
    await waitTicks(sdk, 3);
    const r = radius || 15;
    for (const l of (await sdk.scanNearbyLocs(r)).filter(l => process.env.ALL || l.optionsWithIndex.length > 0)) {
        console.log(`LOC ${l.name} (${l.x},${l.z},${l.level ?? '?'}) id=${l.id} ops=${l.optionsWithIndex.map(o => o.opIndex + ':' + o.text).join('/')}`);
    }
    for (const g of await sdk.scanGroundItems(r)) console.log(`OBJ ${g.name} (${g.x},${g.z}) id=${g.id}`);
    for (const n of sdk.getState()!.nearbyNpcs) console.log(`NPC ${n.name} (${n.x},${n.z}) idx=${n.index} lvl=${n.combatLevel} ops=${n.optionsWithIndex.map(o => o.opIndex + ':' + o.text).join('/')}`);
}, { timeout: 120_000 });
