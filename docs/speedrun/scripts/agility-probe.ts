// Smoke test for the agility lab: prints position, Agility xp and tick, then
// checks that ::setstat and ::tele work.
//   bun docs/speedrun/scripts/agility-probe.ts <bot>
import { runScript } from '../../../sdk/runner';
import { cheat, tele, pos, tick, agilityXp } from './agility-lib';

await runScript(async ({ bot, sdk }) => {
    await bot.skipTutorial().catch(e => console.log('skipTutorial:', e?.message ?? e));
    console.log('start', pos(sdk), 'tick', tick(sdk), 'xp', agilityXp(sdk.getState()));
    await cheat(sdk, 'setstat agility 52');
    await tele(sdk, 3004, 3937);
    console.log('after', pos(sdk), 'tick', tick(sdk), 'level', sdk.getSkill('Agility'));
    const locs = await sdk.scanNearbyLocs(20);
    console.log(locs.filter(l => l.options.length).map(l => `${l.id}:${l.name}@${l.x},${l.z} [${l.options.join('|')}]`).join('\n'));
}, { timeout: 120_000 });
