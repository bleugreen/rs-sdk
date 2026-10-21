// Scratch probe: list the locs near a tile and try an item on a loc.
//   BOTS=tt16 docs/speedrun/scripts/quest-digsite-lab-session.sh bun docs/speedrun/scripts/quest-digsite-probe.ts tt16
import { runScript } from '../../../sdk/runner';
import { cheat, clearInv, give, QuestBot, tele, waitUntil } from './quest-digsite-lab';

await runScript(async ({ bot, sdk }) => {
    await sdk.waitForReady(60_000);
    await bot.skipTutorial();
    const q = new QuestBot(sdk, bot);
    await cheat(sdk, 'setstat smithing 20');
    await cheat(sdk, 'setvar desertrescue 13');
    await clearInv(sdk);
    for (const o of ['bronze_bar', 'hammer', 'thcaptplans']) await give(sdk, o);
    await tele(sdk, 3169, 3046);
    const near = (await sdk.scanNearbyLocs(5)).map(l => `${l.name}#${l.id}@${l.x},${l.z} [${l.optionsWithIndex.map(o => o.text).join('/')}]`);
    console.log(near.join('\n'));
    const a = await q.loc('experimental_anvil');
    console.log('anvil', a.x, a.z, a.id, 'reachable', (a as { reachable?: boolean }).reachable);
    for (const [x, z] of [[3169, 3046], [3170, 3047], [3170, 3048], [3171, 3047]] as const) {
        await bot.walkTo(x, z, 0);
        sdk.getNewChat({ types: [0], includeSelf: true });
        await sdk.sendUseItemOnLoc(q.need('bronze_bar').slot, a.x, a.z, a.id);
        await waitUntil(sdk, () => sdk.getState()!.dialog.isOpen, 12);
        console.log(`from ${x},${z} (at ${sdk.getState()!.player!.worldX},${sdk.getState()!.player!.worldZ}):`, sdk.getNewChat({ types: [0], includeSelf: true }).map(m => m.text), 'dialog', sdk.getState()!.dialog.isOpen, sdk.getState()!.dialog.text?.slice(0, 60));
        if (sdk.getState()!.dialog.isOpen) break;
    }
}, { timeout: 180_000 });
