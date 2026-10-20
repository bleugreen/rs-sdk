// Probe: dialogue mechanics against the Haunted Mine zealot (lab only).
// bun docs/speedrun/scripts/quest-hauntedmine-probe.ts <botname>
import { runScript } from '../../../sdk/runner';
import { cheat, dialog, getvar, pos, tele } from './quest-pip-hm-lib';

await runScript(async ({ sdk }) => {
    await cheat(sdk, 'setvar hauntedmine 0');
    await tele(sdk, 3444, 3256);
    console.log('pos', pos(sdk), 'hauntedmine', await getvar(sdk, 'hauntedmine'));
    const z = sdk.findNearbyNpc(/zealot/i)!;
    console.log('zealot', z?.name, z?.x, z?.z, z?.index);
    const t0 = sdk.getState()!.tick;
    await sdk.sendInteractNpc(z.index, 1);
    const r = await dialog(sdk, ['Saradomin', 'seeking challenges', 'What quest is that', 'other way into the mines', 'must be going'], { log: true, waitOpen: 30 });
    console.log('dialog ticks', sdk.getState()!.tick - t0, r.pages, r.options);
    console.log('hauntedmine', await getvar(sdk, 'hauntedmine'), 'bits', await getvar(sdk, 'hauntedmine_bits'));
    const locs = await sdk.scanNearbyLocs(15);
    console.log(locs.slice(0, 8).map(l => `${l.name}@${l.x},${l.z},${l.level} [${l.options.join('/')}]`).join('\n'));
}, { timeout: 120_000 });
