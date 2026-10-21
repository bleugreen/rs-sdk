// Smoke test for the troll-chain lab: tick clock, ::tele, ::setvar, and the
// ids of the npcs and locs at a few quest sites.
//   bun docs/speedrun/scripts/quest-troll-probe.ts <bot>
import { runScript } from '../../../sdk/runner';
import { cheat, tele, pos, now, lastMessages } from './quest-troll-lib';

await runScript(async ({ bot, sdk }) => {
    await bot.skipTutorial().catch(e => console.log('skipTutorial:', e?.message ?? e));
    console.log('start', pos(sdk.getState()), 'tick', now(sdk));
    await cheat(sdk, 'setvar troll_quest 10');
    console.log('setvar ->', lastMessages(sdk.getState(), 3));
    for (const [x, z, l] of [[2898, 3618, 0], [2837, 10090, 2], [2827, 10070, 1], [2820, 3560, 0]] as const) {
        await tele(sdk, x, z, l);
        const locs = (await sdk.scanNearbyLocs(15)).filter(l => l.options.length);
        console.log(`== ${x},${z},${l} tick ${now(sdk)}`);
        console.log(' npcs:', sdk.getState()!.nearbyNpcs.map(n => `${n.id}:${n.name}(${n.combatLevel})@${n.x},${n.z}[${n.options.join('|')}]`).join(' '));
        console.log(' locs:', locs.map(l => `${l.id}:${l.name}@${l.x},${l.z}[${l.options.join('|')}]`).join(' '));
    }
}, { timeout: 180_000 });
