// Monkey Madness: the enchanted bar on the Wall of flame under the temple
// (quest_mm.rs2 opu_mm_firewall). Lists each wall of flame near the trapdoor's
// landing and tries the bar on the nearest ones in turn, with Protect from
// Melee on (zombie monkeys spawn round the landing and beside both fires),
// logging the player's tile, animation and messages after each try.
//
//   speedrun/lab/lab.sh <bot> speedrun/lab/measure-mm-fire.ts:--tries=4

import { setPrayer } from '../lib/combat';
import { openSession } from '../lib/session';
import { waitTicks, waitUntil } from '../lib/wait';
import { pos } from '../lib/world';
import { arg, botArg } from './common';
import { cheat, clearInventory, give, mustTele, setStats } from './setup';

const tries = Number(arg('tries', '4'));
const session = await openSession(botArg());
const { sdk } = session;
const BAR = 4007, UNSTRUNG = 4022;

await setStats(sdk, { hitpoints: 99, prayer: 94, defence: 1 });
await cheat(sdk, 'setvar mm_main 3');
await mustTele(sdk, 2807, 9201);
await waitTicks(sdk, 2);
await setPrayer(sdk, 'protect_from_melee', true);
const walls = (await sdk.scanNearbyLocs(20)).filter(l => /^Wall of flame$/i.test(l.name)).sort((a, b) => a.distance - b.distance);
for (const w of walls) console.log(`WALL ${w.x},${w.z} id=${w.id} dist=${w.distance} ops=${w.options.join('/')}`);
for (const w of walls.slice(0, tries)) {
    await clearInventory(sdk);
    await give(sdk, ['mm_enchanted_gold_bar', 'mm_monkey_amulet_mould']);
    await mustTele(sdk, 2807, 9201);
    await waitTicks(sdk, 2);
    const bar = sdk.getState()!.inventory.find(i => i.id === BAR);
    if (!bar) { console.log('no bar given'); continue; }
    const t0 = sdk.getState()!.tick;
    const anims = new Set<number>();
    const stop = sdk.onStateUpdate(s => { if (s.player?.animId !== undefined) anims.add(s.player.animId); });
    await sdk.sendUseItemOnLoc(bar.slot, w.x, w.z, w.id);
    const r = await waitUntil(sdk, s => s.inventory.some(i => i.id === UNSTRUNG), { maxTicks: 20 });
    stop();
    const msgs = sdk.getState()!.gameMessages.filter(m => m.tick >= t0).map(m => m.text);
    console.log(`TRY wall ${w.x},${w.z} id=${w.id}: ${r.ok ? 'SMITHED' : 'nothing'} after ${sdk.getState()!.tick - t0} ticks, at ${JSON.stringify(pos(sdk))}, anims ${[...anims].join(',')}, msgs ${JSON.stringify(msgs)}`);
    if (r.ok) break;
}
await setPrayer(sdk, 'protect_from_melee', false);
process.exit(0);
