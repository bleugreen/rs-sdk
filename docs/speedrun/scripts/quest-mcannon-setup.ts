// Dwarf multicannon set-up after the quest: the cannon_setup.rs2 gate, set-up ticks, and firing.
//
//   bun docs/speedrun/scripts/quest-mcannon-setup.ts <botname>
//
// Staff setup (untimed): cannon parts and cannonballs by ::give, %mcannon by ::setvar. It first
// tries Set-up at %mcannon = 10 (one short of complete) to show the gate, then at 11 times
// base -> stand -> barrels -> furnace -> load -> fire, and logs Ranged xp for FIRE_TICKS ticks.
import { runScript } from '../../../sdk/runner';
import { cheat, clock, log, pos, tele, waitTicks, waitUntil } from './quest-unlocks-lib';

const FIRE_TICKS = Number(process.env.FIRE_TICKS ?? 60);
// Lumbridge goblins east of the river
const SPOT = [3252, 3236];

await runScript(async ({ bot, sdk }) => {
    for (const it of sdk.getInventory()) await bot.dropItem(it);
    for (const o of ['twpart1', 'twpart2', 'twpart3', 'twpart4']) await cheat(sdk, `give ${o} 1`);
    await cheat(sdk, 'give mcannonball 100');
    await cheat(sdk, 'setstat ranged 70');
    await tele(sdk, SPOT[0], SPOT[1]);

    // the gate: one stage short of complete
    await cheat(sdk, 'setvar mcannon 10');
    sdk.getNewChat({ types: [0] });
    const base = () => sdk.findInventoryItem(/cannon base/i)!;
    await sdk.sendUseItem(base().slot, 1);
    await waitTicks(sdk, 3);
    for (const m of sdk.getNewChat({ types: [0] })) log(sdk, `at mcannon 10: ${m.text}`);

    await cheat(sdk, 'setvar mcannon 11');
    await waitTicks(sdk, 2);
    const t0 = clock(sdk);
    await sdk.sendUseItem(base().slot, 1);
    try {
        await waitUntil(sdk, () => !sdk.findInventoryItem(/cannon base/i), 20, 'base placed');
    } catch (e) {
        for (const m of sdk.getNewChat({ types: [0] })) log(sdk, `chat: ${m.text}`);
        throw e;
    }
    log(sdk, `base placed at +${clock(sdk) - t0}`);
    const steps: [RegExp, RegExp][] = [
        [/cannon stand/i, /cannon base/i],
        [/cannon barrels/i, /cannon stand/i],
        [/cannon furnace/i, /cannon base/i], // the barrels stage loc is also named "Cannon base"
    ];
    for (const [itemRe, locRe] of steps) {
        const item = sdk.findInventoryItem(itemRe)!;
        const loc = (await sdk.scanNearbyLocs(4)).find((l) => locRe.test(l.name) && l.options.some((o) => /pick-up/i.test(o)));
        if (!loc) throw new Error(`no ${locRe} loc for ${item.name}`);
        await bot.useItemOnLoc(item, loc);
        await waitUntil(sdk, () => !sdk.findInventoryItem(itemRe), 20, `${item.name} added`);
        log(sdk, `${item.name} added at +${clock(sdk) - t0}`);
    }
    const cannon = (await sdk.scanNearbyLocs(4)).find((l) => /multicannon/i.test(l.name));
    if (!cannon) throw new Error('assembled cannon not found');
    const balls = sdk.findInventoryItem(/cannonball/i)!;
    await bot.useItemOnLoc(balls, cannon);
    await waitUntil(sdk, () => (sdk.findInventoryItem(/cannonball/i)?.count ?? 0) < balls.count, 20, 'cannon loaded');
    log(sdk, `loaded at +${clock(sdk) - t0}`);
    await bot.interactLoc(cannon, 'Fire');
    const tFire = clock(sdk);
    log(sdk, `SEG set-up to firing: ${tFire - t0} ticks (4 parts, load, fire click)`);

    const xp0 = sdk.getSkill('Ranged')?.experience ?? 0;
    await waitTicks(sdk, FIRE_TICKS);
    const xp1 = sdk.getSkill('Ranged')?.experience ?? 0;
    log(sdk, `ranged xp over ${FIRE_TICKS} ticks of firing: ${(xp1 - xp0) / 25} base, at ${JSON.stringify(pos(sdk))}`);
    for (const m of sdk.getNewChat({ types: [0] }).slice(-6)) log(sdk, `chat: ${m.text}`);

    const c2 = (await sdk.scanNearbyLocs(4)).find((l) => /multicannon/i.test(l.name));
    if (c2) {
        const tp = clock(sdk);
        await bot.interactLoc(c2, 'Pick-up');
        await waitUntil(sdk, () => !!sdk.findInventoryItem(/cannon base/i), 20, 'picked up');
        log(sdk, `SEG pick-up: ${clock(sdk) - tp} ticks`);
    }
}, { timeout: 5 * 60_000, printState: false });
