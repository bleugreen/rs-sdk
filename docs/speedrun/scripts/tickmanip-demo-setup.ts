// Ready a fresh demo account for knife woodcutting on normal trees, with no staff cheats
// (docs/speedrun/skills/tick-manipulation.md, "Run-time host gate").
//
//   bun docs/speedrun/scripts/tickmanip-demo-setup.ts <bot> [--logs=4] [--stand=3194,3230]
//
// Skips the tutorial (the kit has a bronze axe, tutorial.rs2), takes the knife from its
// Lumbridge ground spawn beside Bob's Axes (obj 946 at 3224,3202, m50_50.jm2; it respawns
// if another player just took it), drops kit items the test does not use, and chops normal
// trees at --stand (default: the normal trees west of Lumbridge castle) until it holds --logs
// logs. It ends among those trees, where tickmanip-cycle.ts --mode=tree-<technique> --demo
// then works.
import { runScript } from '../../../sdk/runner';

const flag = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
const LOGS = Number(flag('logs') ?? 4);
const STAND = (flag('stand') ?? '3194,3230').split(',').map(Number) as [number, number];
const KNIFE: [number, number] = [3224, 3202];
const KEEP = /^(bronze axe|knife|logs)$/i;

await runScript(async ({ bot, sdk }) => {
    await bot.skipTutorial();
    await sdk.waitForTicks(3);
    const inv = () => sdk.getState()?.inventory ?? [];
    const has = (re: RegExp) => inv().some(i => re.test(i.name));
    const pos = () => { const p = sdk.getState()?.player; return p ? `${p.worldX},${p.worldZ}` : '?'; };
    console.log(`start at ${pos()}, inventory: ${inv().map(i => i.name).join(', ')}`);

    if (!has(/^knife$/i)) {
        const w = await bot.walkTo(KNIFE[0], KNIFE[1], 1);
        console.log(`walk to the knife spawn: ${w.message} (at ${pos()})`);
        for (let attempt = 0; attempt < 40 && !has(/^knife$/i); attempt++) {
            const onGround = sdk.getState()?.groundItems.find(g => /^knife$/i.test(g.name));
            if (onGround) {
                const r = await bot.pickupItem(onGround);
                console.log(`pick up knife: ${r.success ? 'ok' : r.message}`);
            } else {
                await sdk.waitForTicks(10); // taken by someone else: wait for the respawn
            }
        }
        if (!has(/^knife$/i)) throw new Error('no knife after waiting for the spawn');
    }

    for (const item of inv().filter(i => !KEEP.test(i.name))) await sdk.sendDropItem(item.slot);
    await sdk.waitForTicks(2);
    const w = await bot.walkTo(STAND[0], STAND[1], 2);
    console.log(`walk to the trees: ${w.message} (at ${pos()})`);

    for (let attempt = 0; attempt < 30 && inv().filter(i => /^logs$/i.test(i.name)).length < LOGS; attempt++) {
        const r = await bot.chopTree();
        if (!r.success) {
            console.log(`chop: ${r.message} at ${pos()}`);
            await sdk.waitForTicks(5);
        }
    }
    const s = sdk.getState()!;
    const trees = s.nearbyLocs.filter(l => /^tree$/i.test(l.name) && l.distance <= 10);
    console.log(`ready at ${pos()}: knife ${has(/^knife$/i)}, logs ${inv().filter(i => /^logs$/i.test(i.name)).length}, woodcutting ${s.skills.find(k => k.name.toLowerCase() === 'woodcutting')?.baseLevel}, ${trees.length} trees within 10 tiles`);
}, { timeout: 15 * 60_000, printState: false });
