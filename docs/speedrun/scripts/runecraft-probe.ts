// Altar-room geometry: teleport into each altar room and outside each ruins,
// and print the altar, exit portal and ruins locs with their tiles, plus the
// route-tile distances that set the walking part of a cycle.
// Run: bun docs/speedrun/scripts/runecraft-probe.ts <bot>[,...] [altar ...]

import { ALTARS, connect, pos, result, tele, waitTicks } from './runecraft-lib';

const bot = process.argv[2].split(',').pop()!;
const which = process.argv.slice(3).filter(a => !a.startsWith('-'));
const names = which.length ? which : Object.keys(ALTARS);

const sdk = await connect(bot);
for (const name of names) {
    const a = ALTARS[name];
    const row: Record<string, unknown> = { altar: name };
    if (await tele(sdk, a.enter.x, a.enter.z, a.enter.level)) {
        await waitTicks(sdk, 2);
        const locs = sdk.getNearbyLocs().filter(l => /altar|portal/i.test(l.name));
        row.inside = locs.map(l => ({ name: l.name, id: l.id, x: l.x, z: l.z, dist: l.distance, options: l.options }));
        row.enterTile = pos(sdk.getState());
    } else row.inside = 'tele failed';
    if (await tele(sdk, a.exit.x, a.exit.z, a.exit.level)) {
        await waitTicks(sdk, 2);
        const locs = sdk.getNearbyLocs().filter(l => /ruins|altar/i.test(l.name) && l.distance < 15);
        row.outside = locs.map(l => ({ name: l.name, id: l.id, x: l.x, z: l.z, dist: l.distance }));
    } else row.outside = 'tele failed';
    result('probe', row);
}
await sdk.disconnect();
process.exit(0);
