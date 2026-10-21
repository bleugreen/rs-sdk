// Mage Arena travel in: Ardougne teleport landing -> wilderness lever -> Deserted Keep -> mage bank
// ladder -> Kolodion in the cellar.
//
//   bun docs/speedrun/scripts/quest-magearena-travel.ts <botname>
//
// Setup (untimed): teleport to the Ardougne teleport landing (magic_spells.dbrow tele_coord
// 0_41_51_37_37), a knife in the inventory for the webs (a knife has no weapon category, so
// can_enter_mage_arena accepts it). Each segment logs ticks and the walked route length.
import { runScript } from '../../../sdk/runner';
import { cheat, log, pos, talkThrough, tele, tick, waitTicks, waitUntil } from './quest-unlocks-lib';

await runScript(async ({ bot, sdk }) => {
    if (!sdk.findInventoryItem(/^knife$/i)) await cheat(sdk, 'give knife 1');
    await tele(sdk, 2661, 3301);
    await waitTicks(sdk, 3);
    const t0 = tick(sdk);

    // 1. walk to the lever and pull it
    const lever = (await sdk.scanNearbyLocs(15)).find((l) => /lever/i.test(l.name));
    let leverLoc = lever;
    if (!leverLoc) {
        const r = await bot.walkTo(2563, 3311, 2);
        log(sdk, `walk to lever: ${JSON.stringify(r).slice(0, 160)} at ${JSON.stringify(pos(sdk))}`, t0);
        leverLoc = (await sdk.scanNearbyLocs(10)).find((l) => /lever/i.test(l.name));
    }
    if (!leverLoc) throw new Error('lever not found');
    const tWalk1 = tick(sdk);
    log(sdk, `SEG ardougne->lever: ${tWalk1 - t0} ticks, ${leverLoc.name} at ${leverLoc.x},${leverLoc.z}`, t0);
    await bot.interactLoc(leverLoc, leverLoc.options[0]);
    const d1 = await talkThrough(sdk, ["Yes I'm brave."], { idleMs: 600 });
    await waitUntil(sdk, () => pos(sdk).z > 3800, 30, 'arrive at the Deserted Keep');
    const tKeep = tick(sdk);
    log(sdk, `SEG lever: ${tKeep - tWalk1} ticks, ${d1.pages} pages, ${d1.options} options, now ${JSON.stringify(pos(sdk))}`, t0);

    // 2. Deserted Keep -> ladder at 3091,3957; webs at 3093/3095,3957 and 3158,3951
    const from2 = pos(sdk);
    let route = sdk.findPath ? sdk.findPath(3092, 3957) : null;
    log(sdk, `path keep->ladder: ${JSON.stringify(route)?.slice(0, 200)}`, t0);
    for (let attempt = 0; attempt < 6; attempt++) {
        const r = await bot.walkTo(3092, 3957, 1);
        log(sdk, `walk to ladder attempt ${attempt}: ${JSON.stringify(r).slice(0, 160)} at ${JSON.stringify(pos(sdk))}`, t0);
        if (Math.abs(pos(sdk).x - 3092) <= 1 && Math.abs(pos(sdk).z - 3957) <= 1) break;
        const web = (await sdk.scanNearbyLocs(3)).find((l) => /^web$/i.test(l.name));
        if (web) {
            const knife = sdk.findInventoryItem(/^knife$/i)!;
            const u = await bot.useItemOnLoc(knife, web);
            log(sdk, `knife on web at ${web.x},${web.z}: ${JSON.stringify(u).slice(0, 120)}`, t0);
            await waitTicks(sdk, 3);
        }
    }
    const tLadder = tick(sdk);
    log(sdk, `SEG keep->ladder: ${tLadder - tKeep} ticks from ${JSON.stringify(from2)} to ${JSON.stringify(pos(sdk))}`, t0);

    // 3. climb down, walk to Kolodion
    const ladder = (await sdk.scanNearbyLocs(5)).find((l) => /ladder/i.test(l.name));
    if (!ladder) throw new Error('ladder not found');
    await bot.interactLoc(ladder, 'Climb-down');
    await waitUntil(sdk, () => pos(sdk).z > 4600, 20, 'arrive in the cellar');
    const tCellar = tick(sdk);
    log(sdk, `SEG ladder down: ${tCellar - tLadder} ticks, now ${JSON.stringify(pos(sdk))}`, t0);
    const kol = sdk.findNearbyNpc(/^Kolodion$/);
    log(sdk, `Kolodion at ${kol?.x},${kol?.z} distance ${kol?.distance}`, t0);
    log(sdk, `TOTAL ardougne landing -> cellar: ${tCellar - t0} ticks`, t0);
}, { timeout: 5 * 60_000, printState: false });
