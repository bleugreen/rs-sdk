// Probe: how does the player get off the Lady Lumbridge wreck on Crandor?
// The sail lands the player inside the hull at (2851,3235,0)
// (crandor_tele_coord, quest_dragon.constant:17), boxed in by blocking hull
// locs. This tries the exits in turn and logs where each one leads.
// Run: bun docs/speedrun/scripts/quest-dragon-wreck-probe.ts <botname>

import { runScript } from '../../../sdk/runner';
import { cheat, now, pos, result, tele, waitTicks, waitUntil } from './quest-primitives-lib';

await runScript(async ({ bot, sdk }) => {
    const log: unknown[] = [];
    const near = (r = 6) => sdk.getState()!.nearbyLocs.filter(l => l.distance <= r && l.optionsWithIndex.length).map(l => `${l.name}@${l.x},${l.z} [${l.optionsWithIndex.map(o => o.text).join('/')}]`);
    const step = async (label: string, act: () => Promise<unknown>, ticks = 10) => {
        const p0 = pos(sdk.getState());
        const t0 = now(sdk);
        await act();
        await waitTicks(sdk, ticks);
        const entry = { label, from: p0, to: pos(sdk.getState()), ticks: now(sdk) - t0, locs: near() };
        log.push(entry);
        console.log(JSON.stringify(entry));
    };
    await cheat(sdk, 'setvar dragonquest 9'); await waitTicks(sdk, 1);
    await tele(sdk, 2851, 3235, 0);
    log.push({ start: pos(sdk.getState()), locs: near() });
    await step('walk north out of the hull', () => sdk.sendWalk(2851, 3239, true), 8);
    await tele(sdk, 2851, 3235, 0);
    await step('walk west along the hull', () => sdk.sendWalk(2844, 3235, true), 8);
    await tele(sdk, 2851, 3235, 0);
    await step('climb the hold ladder (1747) at 2848,3235', () => sdk.sendInteractLoc(2848, 3235, 1747, 1), 8);
    if (pos(sdk.getState()).level === 1) {
        await step('deck: walk to the bow', () => sdk.sendWalk(2846, 3235, true), 8);
        await step('deck: walk past the bow', () => sdk.sendWalk(2843, 3235, true), 8);
        await step('deck: walk to the shore', () => sdk.sendWalk(2846, 3240, true), 8);
    }
    const pf = await bot.walkTo(2833, 3253, 2, { timeout: 30_000 });
    log.push({ walkToRockOpening: pf, at: pos(sdk.getState()) });
    console.log('walkTo', JSON.stringify(pf), JSON.stringify(pos(sdk.getState())));
    result('wreck', log);
}, { timeout: 180_000 });
