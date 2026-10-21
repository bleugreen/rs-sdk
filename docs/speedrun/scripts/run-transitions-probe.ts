// Probe a stalled walk: list the locs around a tile with their ops, the SDK route to a
// destination, and what the stock bot.walkTo does from there.
//   bun docs/speedrun/scripts/run-transitions-probe.ts <bot> <x> <z> <destX> <destZ> [level]
import { runScript } from '../../../sdk/runner';
import { ensureOffIsland, pos, tele, tick } from './run-transitions-lib';

const [, , , xs, zs, dxs, dzs, ls = '0'] = process.argv;
await runScript(async ({ bot, sdk }) => {
    await ensureOffIsland({ sdk, bot });
    await tele(sdk, Number(xs), Number(zs), Number(ls));
    const locs = (await sdk.scanNearbyLocs(6)).filter((l) => l.optionsWithIndex.length).map((l) => `${l.name}#${l.id}@${l.x},${l.z} d${l.distance} [${l.optionsWithIndex.map((o) => o.text).join('/')}]`);
    console.log('locs:', locs.join(' ; '));
    const p = sdk.findPath(Number(dxs), Number(dzs), 500);
    console.log('path:', p.success, p.reachedDestination, p.waypoints.slice(0, 12).map((w) => `${w.x},${w.z}`).join(' '));
    const t0 = tick(sdk);
    const r = await bot.walkTo(Number(dxs), Number(dzs), 1);
    console.log('stock walkTo:', r.success, r.message, 'ticks', tick(sdk) - t0, 'at', JSON.stringify(pos(sdk)));
}, { timeout: 600_000, printState: false });
