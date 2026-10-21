// Probe: how does the player get off the Lady Lumbridge wreck on Crandor?
// The sail lands the player inside the hull at (2851,3235,0)
// (crandor_tele_coord, quest_dragon.constant:17), boxed in by blocking hull
// locs. This tries the exits in turn and logs where each one leads.
// Run: bun docs/speedrun/scripts/quest-dragon-wreck-probe.ts <botname>

import { runScript } from '../../../sdk/runner';
import { mustTele, setvar } from '../../../speedrun/lab/setup';
import { result } from '../../../speedrun/lab/record';
import { walkTo } from '../../../speedrun/lib/act';
import { currentTick, waitTicks } from '../../../speedrun/lib/wait';
import { pos } from '../../../speedrun/lib/world';

await runScript(async ({ bot, sdk }) => {
    const log: unknown[] = [];
    const near = (r = 6) => sdk.getState()!.nearbyLocs.filter(l => l.distance <= r && l.optionsWithIndex.length).map(l => `${l.name}@${l.x},${l.z} [${l.optionsWithIndex.map(o => o.text).join('/')}]`);
    // One raw click, then a fixed wait: the probe logs where each exit leads.
    const step = async (label: string, click: () => Promise<unknown>, ticks = 10) => {
        const p0 = pos(sdk);
        const t0 = currentTick(sdk);
        await click();
        await waitTicks(sdk, ticks);
        const entry = { label, from: p0, to: pos(sdk), ticks: currentTick(sdk) - t0, locs: near() };
        log.push(entry);
        console.log(JSON.stringify(entry));
    };
    await setvar(sdk, 'dragonquest', 9);
    await mustTele(sdk, 2851, 3235, 0);
    log.push({ start: pos(sdk), locs: near() });
    await step('walk north out of the hull', () => sdk.sendWalk(2851, 3239, true), 8);
    await mustTele(sdk, 2851, 3235, 0);
    await step('walk west along the hull', () => sdk.sendWalk(2844, 3235, true), 8);
    await mustTele(sdk, 2851, 3235, 0);
    await step('climb the hold ladder (1747) at 2848,3235', () => sdk.sendInteractLoc(2848, 3235, 1747, 1), 8);
    if (pos(sdk).level === 1) {
        await step('deck: walk to the bow', () => sdk.sendWalk(2846, 3235, true), 8);
        await step('deck: walk past the bow', () => sdk.sendWalk(2843, 3235, true), 8);
        await step('deck: walk to the shore', () => sdk.sendWalk(2846, 3240, true), 8);
    }
    const pf = await walkTo(bot, sdk, 2833, 3253, 2);
    log.push({ walkToRockOpening: pf, at: pos(sdk) });
    console.log('walkTo', JSON.stringify(pf), JSON.stringify(pos(sdk)));
    result('wreck', log);
}, { timeout: 180_000 });
