// Scratch probe: list the locs near a tile and try an item on each Winch.
//   BOTS=dig16 docs/speedrun/scripts/quest-digsite-lab-session.sh bun docs/speedrun/scripts/quest-digsite-probe.ts dig16
import { runScript } from '../../../sdk/runner';
import { cheat, clearInv, give, tele, waitUntil } from './quest-digsite-lab';

await runScript(async ({ bot, sdk }) => {
    await sdk.waitForReady(60_000);
    await bot.skipTutorial();
    await cheat(sdk, 'setstat agility 10');
    await cheat(sdk, 'setvar itexamlevel 6');
    await clearInv(sdk);
    await give(sdk, 'rope');
    await tele(sdk, 3351, 3418);
    const locs = (await sdk.scanNearbyLocs(4)).map(l => `${l.name}#${l.id}@${l.x},${l.z} [${l.optionsWithIndex.map(o => o.text).join('/')}]`);
    console.log(locs.join('\n'));
    for (const w of (await sdk.scanNearbyLocs(4)).filter(l => /winch/i.test(l.name))) {
        sdk.getNewChat({ types: [0], includeSelf: true });
        await sdk.sendUseItemOnLoc(sdk.getInventory()[0].slot, w.x, w.z, w.id);
        await waitUntil(sdk, () => false, 6);
        console.log(`use rope on ${w.id}@${w.x},${w.z}:`, sdk.getNewChat({ types: [0], includeSelf: true }).map(m => m.text), 'pos', sdk.getState()!.player!.worldX, sdk.getState()!.player!.worldZ);
    }
}, { timeout: 180_000 });
