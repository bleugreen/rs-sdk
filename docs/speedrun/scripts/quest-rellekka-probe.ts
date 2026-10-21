// Scratch probe used while building the Fremennik scripts: lists the locs near
// a tile and, optionally, uses an inventory item on one of them and prints the
// game messages that follow.
//
//   bun docs/speedrun/scripts/quest-rellekka-probe.ts <bot> <x> <z> [itemRegex] [locNameRegex]

import { runScript } from '../../../sdk/runner';
import * as L from './quest-rellekka-lib';

const [x, z, item, locName] = process.argv.slice(3);

await runScript(async ({ bot, sdk }) => {
    const locs = (await sdk.scanNearbyLocs(6)).filter(l => Math.abs(l.x - Number(x)) <= 2 && Math.abs(l.z - Number(z)) <= 2);
    for (const l of locs) console.log('loc', l.name, l.id, l.x, l.z, JSON.stringify(l.options));
    console.log('pos', JSON.stringify(L.pos(sdk)), 'inv', sdk.getInventory().map(i => i.name).join(', '));
    if (item) {
        const loc = locs.find(l => l.x === Number(x) && l.z === Number(z) && (!locName || new RegExp(locName, 'i').test(l.name)))!;
        const it = sdk.findInventoryItem(new RegExp(item, 'i'))!;
        const n0 = sdk.getState()!.gameMessages.length;
        const r = await bot.useItemOnLoc(it, loc);
        console.log('useItemOnLoc', JSON.stringify(r));
        await sdk.waitForTicks(8);
        console.log('msgs', JSON.stringify(sdk.getState()!.gameMessages.slice(Math.max(0, n0 - 2)).map(m => m.text)));
        console.log('pos', JSON.stringify(L.pos(sdk)), 'inv', sdk.getInventory().map(i => i.name).join(', '));
    }
}, { timeout: 120_000, printState: false });
