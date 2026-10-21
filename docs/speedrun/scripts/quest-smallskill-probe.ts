// Lists locs (with options), ground items and NPCs around a tile, for building
// the step lists of the small self-skill quests. Optional varp set first.
// Run: bash docs/speedrun/scripts/quest-smallskill-lab.sh <bot> docs/speedrun/scripts/quest-smallskill-probe.ts -- x z level [radius] [varp=value ...]
// (the bot name is appended last by the lab wrapper)

import { runScript } from '../../../sdk/runner';
import { setvar, tele, waitTicks } from './quest-smallskill-lib';

const args = process.argv.slice(2).filter(a => a !== '--');
args.pop(); // bot name
const [x, z, level, radius] = args.slice(0, 4).map(Number);
const vars = args.slice(4).filter(a => a.includes('=')).map(a => a.split('=') as [string, string]);

await runScript(async ({ sdk }) => {
    for (const [k, v] of vars) await setvar(sdk, k, Number(v));
    await tele(sdk, x!, z!, level!);
    await waitTicks(sdk, 3);
    const r = radius || 15;
    for (const l of (await sdk.scanNearbyLocs(r)).filter(l => l.optionsWithIndex.length > 0)) {
        console.log(`LOC ${l.name} (${l.x},${l.z},${l.level ?? '?'}) id=${l.id} ops=${l.optionsWithIndex.map(o => o.opIndex + ':' + o.text).join('/')}`);
    }
    for (const g of await sdk.scanGroundItems(r)) console.log(`OBJ ${g.name} (${g.x},${g.z}) id=${g.id}`);
    for (const n of sdk.getState()!.nearbyNpcs) console.log(`NPC ${n.name} (${n.x},${n.z}) idx=${n.index} lvl=${n.combatLevel} ops=${n.optionsWithIndex.map(o => o.opIndex + ':' + o.text).join('/')}`);
}, { timeout: 120_000 });
