// Take a fresh lab account off the tutorial and give it what the
// timing-primitive scripts need (Magic 99, teleport runes, coins).
// Run: bun docs/speedrun/scripts/quest-primitives-setup.ts <botname>

import { runScript } from '../../../sdk/runner';
import { give, setStats } from '../../../speedrun/lab/setup';
import { currentTick, waitTicks } from '../../../speedrun/lib/wait';
import { invCount, pos } from '../../../speedrun/lib/world';

await runScript(async ({ bot, sdk }) => {
    const p0 = pos(sdk);
    if (sdk.getState()!.modalOpen || p0.x < 3150 && p0.z < 3130) {
        const r = await bot.skipTutorial();
        console.log('skipTutorial:', r.message);
        await waitTicks(sdk, 3);
    }
    await setStats(sdk, { magic: 99, hitpoints: 99, attack: 70, strength: 70, defence: 70, agility: 99 });
    if (invCount(sdk, /law rune/i) === 0) {
        await give(sdk, 'lawrune', 500);
        await give(sdk, 'airrune', 2000);
        await give(sdk, 'firerune', 500);
        await give(sdk, 'waterrune', 500);
        await give(sdk, 'earthrune', 500);
        await give(sdk, 'coins', 100000);
    }
    console.log('tick', currentTick(sdk), 'pos', pos(sdk), 'inv', sdk.getState()!.inventory.map(i => `${i.name}x${i.count}`).join(', '));
}, { timeout: 120_000 });
