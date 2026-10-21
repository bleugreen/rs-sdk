// Dwarf multicannon set-up after the quest: the cannon_setup.rs2 gate, set-up ticks, and firing.
//
//   bun docs/speedrun/scripts/quest-mcannon-setup.ts <botname>
//
// Staff setup (untimed): cannon parts and cannonballs by ::give, %mcannon by ::setvar. It first
// tries Set-up at %mcannon = 10 (one short of complete) to show the gate, then at 11 times
// base -> stand -> barrels -> furnace -> load -> fire, and logs Ranged xp for FIRE_TICKS ticks.
import { runScript } from '../../../sdk/runner';
import { act, opLoc, slotOf } from '../../../speedrun/lib/act';
import { currentTick, waitTicks, waitUntil } from '../../../speedrun/lib/wait';
import { findLoc, invCount, invItem, messagesSince, pos, skillXp } from '../../../speedrun/lib/world';
import { Recorder } from '../../../speedrun/lab/record';
import { clearInventory, give, mustTele, setStats, setvar } from '../../../speedrun/lab/setup';

const FIRE_TICKS = Number(process.env.FIRE_TICKS ?? 60);
// Lumbridge goblins east of the river
const SPOT = [3252, 3236] as const;

await runScript(async ({ sdk }) => {
    const log = (msg: string) => console.log(`[t=${currentTick(sdk)}] ${msg}`);
    const rec = new Recorder(sdk, 'Dwarf multicannon set-up');
    await clearInventory(sdk);
    await give(sdk, ['twpart1', 'twpart2', 'twpart3', 'twpart4'], 1);
    await give(sdk, 'mcannonball', 100);
    await setStats(sdk, { ranged: 70 });
    await mustTele(sdk, SPOT[0], SPOT[1]);

    // the gate: one stage short of complete
    await setvar(sdk, 'mcannon', 10);
    let tg = currentTick(sdk);
    await sdk.sendUseItem(slotOf(sdk, /cannon base/i), 1);
    await waitTicks(sdk, 3);
    for (const m of messagesSince(sdk, tg)) log(`at mcannon 10: ${m}`);

    await setvar(sdk, 'mcannon', 11);
    await waitTicks(sdk, 2);
    let t0 = currentTick(sdk);
    // cannon_setup.rs2 needs the 3x3 around the player free and walkable; try open tiles nearby
    const spots: [number, number][] = [[3248, 3244], [3245, 3240], [3240, 3245], [3256, 3246], [3222, 3218]];
    let placed = false;
    for (const [sx, sz] of spots) {
        await mustTele(sdk, sx, sz);
        t0 = currentTick(sdk);
        await sdk.sendUseItem(slotOf(sdk, /cannon base/i), 1);
        if ((await waitUntil(sdk, s => !invItem(s, /cannon base/i), { maxTicks: 8 })).ok) {
            placed = true;
            log(`base placed at ${sx},${sz}`);
            break;
        }
        for (const m of messagesSince(sdk, t0)) log(`at ${sx},${sz}: ${m}`);
    }
    if (!placed) throw new Error('no spot fitted the cannon');
    log(`base placed at +${currentTick(sdk) - t0}`);
    let clicks = 1;
    const steps: [RegExp, RegExp][] = [
        [/cannon stand/i, /cannon base/i],
        [/cannon barrels/i, /cannon stand/i],
        [/cannon furnace/i, /cannon base/i], // the barrels stage loc is also named "Cannon base"
    ];
    for (const [itemRe, locRe] of steps) {
        const item = invItem(sdk, itemRe)!;
        const loc = await findLoc(sdk, { name: locRe, op: /pick-up/i, radius: 4 });
        if (!loc) throw new Error(`no ${locRe} loc for ${item.name}`);
        const slot = slotOf(sdk, itemRe);
        clicks++;
        if (!(await act(sdk, () => sdk.sendUseItemOnLoc(slot, loc.x, loc.z, loc.id), s => !invItem(s, itemRe), { maxTicks: 20 })).ok) throw new Error(`timed out waiting for: ${item.name} added`);
        log(`${item.name} added at +${currentTick(sdk) - t0}`);
    }
    const cannon = await findLoc(sdk, { name: /multicannon/i, radius: 4 });
    if (!cannon) throw new Error('assembled cannon not found');
    const balls = invCount(sdk, /cannonball/i);
    const ballSlot = slotOf(sdk, /cannonball/i);
    clicks++;
    if (!(await act(sdk, () => sdk.sendUseItemOnLoc(ballSlot, cannon.x, cannon.z, cannon.id), s => invCount(s, /cannonball/i) < balls, { maxTicks: 20 })).ok) throw new Error('timed out waiting for: cannon loaded');
    log(`loaded at +${currentTick(sdk) - t0}`);
    await opLoc(sdk, cannon, 'Fire');
    clicks++;
    rec.add({ name: 'set-up to firing', ticks: currentTick(sdk) - t0, interactions: clicks, note: '4 parts, load, fire click' });

    const xp0 = skillXp(sdk, 'ranged');
    tg = currentTick(sdk);
    await waitTicks(sdk, FIRE_TICKS);
    const xp1 = skillXp(sdk, 'ranged');
    log(`ranged xp over ${FIRE_TICKS} ticks of firing: ${(xp1 - xp0) / 25} base, at ${JSON.stringify(pos(sdk))}`);
    for (const m of messagesSince(sdk, tg).slice(-6)) log(`chat: ${m}`);

    const c2 = await findLoc(sdk, { name: /multicannon/i, radius: 4 });
    if (c2) {
        const tp = currentTick(sdk);
        if (!(await opLoc(sdk, c2, 'Pick-up', s => !!invItem(s, /cannon base/i), { maxTicks: 20 })).ok) throw new Error('timed out waiting for: picked up');
        rec.add({ name: 'pick-up', ticks: currentTick(sdk) - tp, interactions: 1 });
    }
    rec.report();
}, { timeout: 5 * 60_000, printState: false });
