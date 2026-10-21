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
    const fromKeep = process.env.FROM === 'keep';
    await tele(sdk, fromKeep ? 3154 : 2661, fromKeep ? 3924 : 3301);
    await waitTicks(sdk, 3);
    const t0 = tick(sdk);

    if (!fromKeep) {
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
    log(sdk, `SEG lever: ${tick(sdk) - tWalk1} ticks, ${d1.pages} pages, ${d1.options} options, now ${JSON.stringify(pos(sdk))}`, t0);
    }
    const tKeep = tick(sdk);

    // 2. Deserted Keep -> ladder at 3091,3957; webs at 3093/3095,3957 and 3158,3951
    const from2 = pos(sdk);
    // The keep's only exit is the web at 3158,3951 (north wall); two more webs guard the ladder.
    // Walk toward each goal; when the path is blocked, knife the nearest web (50% per try).
    let slashTries = 0;
    const goals: [number, number][] = [[3158, 3950], [3158, 3953], [3096, 3957], [3094, 3957], [3092, 3957]];
    for (const [gx, gz] of goals) {
        for (let attempt = 0; attempt < 12; attempt++) {
            if (Math.abs(pos(sdk).x - gx) <= 1 && Math.abs(pos(sdk).z - gz) <= 1) break;
            const p = sdk.findPath(gx, gz);
            if (p.success && p.reachedDestination) {
                const r = await bot.walkTo(gx, gz, 1);
                log(sdk, `walk to ${gx},${gz}: ${r.message} at ${JSON.stringify(pos(sdk))}`, t0);
                continue;
            }
            const webs = (await sdk.scanNearbyLocs(12)).filter((l) => /^web$/i.test(l.name) && l.options.includes('Slash'));
            webs.sort((a, b) => a.distance - b.distance);
            const web = webs[0];
            if (!web) {
                // The client's static collision still holds slashed webs; let the server path it.
                log(sdk, `client finds no path to ${gx},${gz}; sending a direct walk`, t0);
                await sdk.sendWalk(gx, gz, true);
                await waitUntil(sdk, () => Math.abs(pos(sdk).x - gx) <= 1 && Math.abs(pos(sdk).z - gz) <= 1, 80, `walk to ${gx},${gz}`);
                break;
            }
            const knife = sdk.findInventoryItem(/^knife$/i)!;
            sdk.getNewChat({ types: [0] });
            await bot.useItemOnLoc(knife, web);
            slashTries++;
            await waitTicks(sdk, 2);
            const ok = sdk.getNewChat({ types: [0] }).some((m) => /slash the web apart/i.test(m.text));
            log(sdk, `knife on web at ${web.x},${web.z}: ${ok ? 'slashed' : 'failed'}`, t0);
            if (ok) {
                // step through the slashed web with a server-side walk
                await sdk.sendWalk(gx, gz, true);
                await waitUntil(sdk, () => Math.abs(pos(sdk).x - gx) <= 1 && Math.abs(pos(sdk).z - gz) <= 1, 80, `walk to ${gx},${gz}`);
                break;
            }
        }
    }
    log(sdk, `web slash attempts: ${slashTries}`, t0);
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
