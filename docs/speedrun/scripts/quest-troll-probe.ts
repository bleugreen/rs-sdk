// Smoke test for the troll-chain lab: tick clock, ::tele, ::setvar, and the
// ids of the npcs and locs at a few quest sites.
//   bun docs/speedrun/scripts/quest-troll-probe.ts <bot>
import { runScript } from '../../../sdk/runner';
import { currentTick } from '../../../speedrun/lib/wait';
import { messagesSince, pos } from '../../../speedrun/lib/world';
import { cheat, mustTele } from '../../../speedrun/lab/setup';

await runScript(async ({ bot, sdk }) => {
    await bot.skipTutorial().catch(e => console.log('skipTutorial:', e?.message ?? e));
    console.log('start', pos(sdk), 'tick', currentTick(sdk));
    const t = currentTick(sdk);
    await cheat(sdk, 'setvar troll_quest 10', 2);
    console.log('setvar ->', messagesSince(sdk, t));
    for (const [x, z, l] of [[2898, 3618, 0], [2837, 10090, 2], [2827, 10070, 1], [2820, 3560, 0]] as const) {
        await mustTele(sdk, x, z, l);
        const locs = (await sdk.scanNearbyLocs(15)).filter(l => l.options.length);
        console.log(`== ${x},${z},${l} tick ${currentTick(sdk)}`);
        console.log(' npcs:', sdk.getState()!.nearbyNpcs.map(n => `${n.id}:${n.name}(${n.combatLevel})@${n.x},${n.z}[${n.options.join('|')}]`).join(' '));
        console.log(' locs:', locs.map(l => `${l.id}:${l.name}@${l.x},${l.z}[${l.options.join('|')}]`).join(' '));
    }
}, { timeout: 180_000 });
