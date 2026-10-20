// Smoke test for a quest lab session: log in, skip the tutorial, print the
// tick, position and a staff command's reply.
//
//   BOTS=dig16 docs/speedrun/scripts/quest-lab-session.sh bun docs/speedrun/scripts/quest-lab-smoke.ts dig16
import { runScript } from '../../../sdk/runner';

await runScript(async ({ bot, sdk }) => {
    await sdk.waitForReady(60_000);
    await bot.skipTutorial();
    const s = sdk.getState()!;
    console.log(`tick=${s.tick} pos=(${s.player?.worldX},${s.player?.worldZ}) level=${s.player?.level}`);
    await sdk.sendSay('::getcoord');
    await sdk.waitForTicks(2);
    console.log(sdk.getChat({ types: [0], includeSelf: true }).slice(-3).map(m => m.text));
}, { timeout: 180_000 });
