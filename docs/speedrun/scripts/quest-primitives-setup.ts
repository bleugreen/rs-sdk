// Take a fresh lab account off the tutorial and give it what the
// timing-primitive scripts need (Magic 99, teleport runes, coins).
// Run: bun docs/speedrun/scripts/quest-primitives-setup.ts <botname>

import { runScript } from '../../../sdk/runner';
import { cheat, give, now, pos, waitTicks } from './quest-primitives-lib';

await runScript(async ({ bot, sdk }) => {
    const s0 = sdk.getState()!;
    if (s0.modalOpen || pos(s0).x < 3150 && pos(s0).z < 3130) {
        const r = await bot.skipTutorial();
        console.log('skipTutorial:', r.message);
        await waitTicks(sdk, 3);
    }
    for (const [stat, lvl] of [['magic', 99], ['hitpoints', 99], ['attack', 70], ['strength', 70], ['defence', 70], ['agility', 99]] as const) {
        await cheat(sdk, `setstat ${stat} ${lvl}`);
        await waitTicks(sdk, 1);
    }
    const inv = sdk.getState()!.inventory;
    if (!inv.some(i => /law rune/i.test(i.name))) {
        await give(sdk, 'lawrune', 500);
        await give(sdk, 'airrune', 2000);
        await give(sdk, 'firerune', 500);
        await give(sdk, 'waterrune', 500);
        await give(sdk, 'earthrune', 500);
        await give(sdk, 'coins', 100000);
    }
    console.log('tick', now(sdk), 'pos', pos(sdk.getState()), 'inv', sdk.getState()!.inventory.map(i => `${i.name}x${i.count}`).join(', '));
}, { timeout: 120_000 });
